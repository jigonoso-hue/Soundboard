/* global api, $, sounds, prefs, toast, Ambience, Kits, Bashes, isFull, Icons */
// Live Session in the window: the Live dialog, forwarding what the board plays
// to listeners (when hosting), and playing what the host sends (when tuned in).
// The networking lives in the main process (src/live.js).
const Live = (() => {
  const SETTINGS_KEY = 'live';
  const settings = loadSettings();
  let status = { role: null };
  let bonjour = true;
  let tab = 'broadcast';
  let sessions = [];
  let whisperTo = null; // { peer, name } while a whisper is armed
  let busy = false;
  let error = '';

  function loadSettings() {
    const defaults = {
      sessionName: '', yourName: '', mode: 'local', relay: '', code: '',
      volumes: { master: 1, music: 1, sfx: 1, ambience: 1 },
    };
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      return { ...defaults, ...saved, volumes: { ...defaults.volumes, ...(saved.volumes || {}) } };
    } catch {
      return defaults;
    }
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
  }

  const hosting = () => status.role === 'host';
  const listening = () => status.role === 'listen';
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  // ---------------------------------------------------------------------
  // Host: what the board plays goes to listeners.

  let nextPid = 1;
  const pid = () => `${Date.now().toString(36)}-${nextPid++}`;
  const category = (sound) => (isFull(sound) ? 'music' : 'sfx');

  // A sound tile or row started playing.
  function soundPlayed(sound) {
    if (!hosting() || !sound || sound.gmOnly) {
      if (hosting() && sound && sound.gmOnly && whisperTo) toast('GM-only sounds can’t be whispered.', true);
      return;
    }
    const event = {
      t: 'play',
      pid: pid(),
      group: `s:${sound.id}`,
      soundId: sound.id,
      name: sound.name,
      at: Date.now(),
      volume: Math.min(1, (sound.volume ?? 1) * prefs.master),
      cat: category(sound),
      loop: !!sound.repeat && !sound.repeat.gap,
      gap: sound.repeat && sound.repeat.gap ? sound.repeat.gap : 0,
      buzz: !!sound.buzz,
      dur: sound.duration || 0,
    };
    if (whisperTo) {
      event.to = whisperTo.peer;
      toast(`Whispered “${sound.name}” to ${whisperTo.name}.`);
      setWhisper(null);
    }
    api.live.hostEvent(event);
  }

  function soundStopped(soundId) {
    if (hosting()) api.live.hostEvent({ t: 'stop', group: `s:${soundId}` });
  }

  function soundVolume(soundId, volume) {
    if (hosting()) api.live.hostEvent({ t: 'volume', group: `s:${soundId}`, volume });
  }

  function stoppedAll() {
    if (hosting()) api.live.hostEvent({ t: 'stopAll' });
    if (listening()) Mirror.stopAll(false);
  }

  // Bash clips arrive one play at a time from the bash player.
  Bashes.player.onSchedule = ({ runId, sound, at, volume, dur }) => {
    if (!hosting() || !sound || sound.gmOnly) return;
    api.live.hostEvent({
      t: 'play', pid: pid(), group: `b:${runId}`, soundId: sound.id, name: sound.name,
      at, volume: Math.min(1, volume), cat: 'sfx', buzz: !!sound.buzz, dur,
    });
  };
  Bashes.player.onStop = (runId) => {
    if (hosting()) api.live.hostEvent({ t: 'stop', group: `b:${runId}` });
  };

  // Ambience, the open scene kit and what listeners should fetch ahead of
  // time are checked twice a second and sent when they change.
  let lastAmbience = '';
  let lastScene;
  let lastPrefetch = '';
  function syncHostState(force = false) {
    if (!hosting()) return;
    const gmOnly = new Set(sounds.filter((s) => s.gmOnly).map((s) => s.id));
    const layers = Ambience.snapshot().filter((l) => l.kind === 'builtin' || !gmOnly.has(l.ref));
    const ambience = JSON.stringify(layers);
    if (force || ambience !== lastAmbience) {
      lastAmbience = ambience;
      api.live.hostEvent({ t: 'ambience', layers });
    }
    const kit = typeof Kits !== 'undefined' ? Kits.activeKit() : null;
    const scene = kit ? kit.name : null;
    if (force || scene !== lastScene) {
      lastScene = scene;
      api.live.hostEvent({ t: 'scene', name: scene });
    }
    const prefetch = JSON.stringify(prefetchIds(kit, gmOnly));
    if (force || prefetch !== lastPrefetch) {
      lastPrefetch = prefetch;
      api.live.hostEvent({ t: 'prefetch', ids: JSON.parse(prefetch) });
    }
  }
  setInterval(syncHostState, 500);

  // The open kit's sounds (including inside its bashes and ambience), or the
  // library's clips when no kit is open. Full sounds outside kits load on demand.
  function prefetchIds(kit, gmOnly) {
    const ids = [];
    if (kit) {
      const bashes = Bashes.all();
      for (const section of kit.sections) {
        for (const item of section.items || []) {
          if (item.type === 'sound') ids.push(item.id);
          if (item.type === 'bash') {
            const bash = bashes.find((b) => b.id === item.id);
            if (bash) ids.push(...bash.clips.map((c) => c.soundId));
          }
        }
        for (const layer of section.layers || []) if (layer.kind === 'sound') ids.push(layer.ref);
      }
    } else {
      ids.push(...sounds.filter((s) => !isFull(s)).slice(0, 80).map((s) => s.id));
    }
    const known = new Set(sounds.map((s) => s.id));
    return [...new Set(ids)].filter((id) => known.has(id) && !gmOnly.has(id));
  }

  function setWhisper(target) {
    whisperTo = target;
    const bar = $('#whisper-bar');
    bar.textContent = '';
    bar.classList.toggle('hidden', !target);
    if (!target) return;
    bar.append(el('span', null, `Whisper armed: the next sound you play goes only to ${target.name}.`));
    const cancel = el('button', 'mini', 'Cancel');
    cancel.addEventListener('click', () => setWhisper(null));
    bar.append(cancel);
  }

  // ---------------------------------------------------------------------
  // Listener: plays what the host sends, with its own volume sliders.

  const Mirror = (() => {
    const plays = new Map(); // pid -> { audio, group, cat, volume, timer, name, whisper }
    const layers = new Map(); // key -> { audio, volume, fade }

    const level = (cat) => settings.volumes.master * (settings.volumes[cat] ?? 1);
    const sink = (audio) => { if (prefs.outputDevice && audio.setSinkId) audio.setSinkId(prefs.outputDevice).catch(() => {}); };

    function play(cmd) {
      stopPlay(cmd.pid);
      const audio = new Audio(cmd.url);
      sink(audio);
      const entry = { audio, group: cmd.group, cat: cmd.cat, volume: cmd.volume, timer: null, name: cmd.name, whisper: cmd.whisper };
      plays.set(cmd.pid, entry);
      audio.volume = Math.min(1, cmd.volume * level(cmd.cat));
      if (cmd.loop) audio.loop = true;
      const finish = () => { clearTimeout(entry.timer); if (plays.get(cmd.pid) === entry) { plays.delete(cmd.pid); renderNowPlaying(); } };
      const startAt = (position) => {
        audio.currentTime = position;
        audio.play().catch(finish);
        if (cmd.whisper) toast('A whisper only you can hear…');
        if (cmd.buzz) buzz();
        renderNowPlaying();
      };
      audio.addEventListener('ended', () => {
        if (!cmd.gap || plays.get(cmd.pid) !== entry) { finish(); return; }
        entry.timer = setTimeout(() => { if (plays.get(cmd.pid) === entry) { audio.currentTime = 0; audio.play().catch(finish); } }, cmd.gap * 1000);
      });
      audio.addEventListener('error', finish);
      audio.addEventListener('loadedmetadata', () => {
        const wait = cmd.at - Date.now();
        if (wait > 0) { entry.timer = setTimeout(() => startAt(0), wait); return; }
        // Late (joined mid-way, or the file arrived late): start part-way through.
        const elapsed = -wait / 1000;
        const length = audio.duration || 0;
        if (cmd.loop && length) { startAt(elapsed % length); return; }
        if (cmd.gap && length) {
          const period = length + cmd.gap;
          const into = elapsed % period;
          if (into < length) startAt(into);
          else entry.timer = setTimeout(() => startAt(0), (period - into) * 1000);
          return;
        }
        if (elapsed < length - 0.05) startAt(elapsed);
        else finish();
      }, { once: true });
    }

    function stopPlay(id) {
      const entry = plays.get(id);
      if (!entry) return;
      clearTimeout(entry.timer);
      entry.audio.pause();
      entry.audio.removeAttribute('src');
      entry.audio.load();
      plays.delete(id);
    }

    function stopGroup(group) {
      for (const [id, entry] of plays) if (entry.group === group) stopPlay(id);
      renderNowPlaying();
    }

    function setGroupVolume(group, volume) {
      for (const entry of plays.values()) {
        if (entry.group !== group) continue;
        entry.volume = volume;
        entry.audio.volume = Math.min(1, volume * level(entry.cat));
      }
    }

    // Fades a looping layer to `target` over a second and a half.
    function fade(layer, target, then) {
      clearInterval(layer.fade);
      const from = layer.audio.volume;
      const started = Date.now();
      layer.fade = setInterval(() => {
        const t = Math.min(1, (Date.now() - started) / 1500);
        layer.audio.volume = Math.max(0, Math.min(1, from + (target - from) * t));
        if (t >= 1) { clearInterval(layer.fade); if (then) then(); }
      }, 50);
    }

    function setAmbience(list) {
      const keep = new Set(list.map((l) => l.key));
      for (const [key, layer] of layers) {
        if (keep.has(key)) continue;
        layers.delete(key);
        fade(layer, 0, () => { layer.audio.pause(); layer.audio.removeAttribute('src'); layer.audio.load(); });
      }
      for (const item of list) {
        const existing = layers.get(item.key);
        if (existing) {
          existing.volume = item.volume;
          fade(existing, Math.min(1, item.volume * level('ambience')));
          continue;
        }
        const audio = new Audio(item.url);
        audio.loop = true;
        audio.volume = 0;
        sink(audio);
        const layer = { audio, volume: item.volume, fade: null, name: item.name };
        layers.set(item.key, layer);
        audio.play().then(() => fade(layer, Math.min(1, item.volume * level('ambience')))).catch(() => layers.delete(item.key));
      }
      renderNowPlaying();
    }

    function stopAll(ambienceToo) {
      for (const id of [...plays.keys()]) stopPlay(id);
      if (ambienceToo) setAmbience([]);
      renderNowPlaying();
    }

    function applyVolumes() {
      for (const entry of plays.values()) entry.audio.volume = Math.min(1, entry.volume * level(entry.cat));
      for (const layer of layers.values()) { clearInterval(layer.fade); layer.audio.volume = Math.min(1, layer.volume * level('ambience')); }
    }

    function nowPlaying() {
      const names = [];
      for (const entry of plays.values()) if (!entry.whisper && entry.name && !names.includes(entry.name)) names.push(entry.name);
      for (const layer of layers.values()) if (layer.name && !names.includes(layer.name)) names.push(layer.name);
      return names;
    }

    return { play, stopGroup, setGroupVolume, setAmbience, stopAll, applyVolumes, nowPlaying };
  })();

  // Macs can't vibrate; give the window a quick shake instead.
  function buzz() {
    document.body.classList.remove('live-buzz');
    void document.body.offsetWidth;
    document.body.classList.add('live-buzz');
    setTimeout(() => document.body.classList.remove('live-buzz'), 400);
  }

  api.live.onCommand((cmd) => {
    if (!listening()) return;
    switch (cmd.t) {
      case 'play': Mirror.play(cmd); break;
      case 'stop': Mirror.stopGroup(cmd.group); break;
      case 'volume': Mirror.setGroupVolume(cmd.group, cmd.volume); break;
      case 'stopAll': Mirror.stopAll(!!cmd.ambienceToo); break;
      case 'ambience': Mirror.setAmbience(cmd.layers || []); break;
      default: break;
    }
  });

  // ---------------------------------------------------------------------
  // Status and the dialog.

  function setStatus(next) {
    const was = status.role;
    status = next || { role: null };
    if (next && next.error) error = next.error;
    if (was === 'listen' && status.role !== 'listen') Mirror.stopAll(true);
    if (status.role === 'host' && was !== 'host') { lastScene = undefined; syncHostState(true); }
    if (status.role !== 'host') setWhisper(null);
    renderButton();
    if ($('#live-dialog').open) renderDialog();
    if (status.role === 'listen' && status.state === 'ended' && status.error) toast(status.error);
  }

  api.live.onStatus(setStatus);
  api.live.onSessions((list) => {
    sessions = list;
    if ($('#live-dialog').open && !status.role) renderDialog();
  });

  function renderButton() {
    const button = $('#live-btn');
    const label = $('#live-label');
    button.classList.toggle('live-on', hosting() || listening());
    if (hosting()) label.textContent = `Live · ${status.peers ? status.peers.length : 0}`;
    else if (listening()) label.textContent = status.state === 'connected' ? 'Tuned In' : 'Tuning In…';
    else label.textContent = 'Live';
  }

  function field(labelText, input) {
    const label = el('label', null, labelText);
    label.append(input);
    return label;
  }

  function textInput(value, placeholder, onInput, maxLength = 60) {
    const input = el('input');
    input.value = value || '';
    input.placeholder = placeholder;
    input.maxLength = maxLength;
    input.addEventListener('input', () => { onInput(input.value); saveSettings(); });
    return input;
  }

  async function run(action) {
    if (busy) return;
    busy = true;
    error = '';
    renderDialog();
    try {
      setStatus(await action());
    } catch (err) {
      error = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    } finally {
      busy = false;
      renderDialog();
    }
  }

  function renderDialog() {
    const body = $('#live-body');
    body.textContent = '';
    if (hosting()) renderHosting(body);
    else if (listening()) renderListening(body);
    else renderIdle(body);
    if (error) body.append(el('p', 'live-error', error));
  }

  function renderIdle(body) {
    const tabs = el('div', 'segmented live-tabs');
    for (const [id, text] of [['broadcast', 'Broadcast'], ['listen', 'Tune In']]) {
      const b = el('button', tab === id ? 'active' : '', text);
      b.type = 'button';
      b.addEventListener('click', () => { tab = id; error = ''; renderDialog(); api.live.browse(tab === 'listen'); });
      tabs.append(b);
    }
    body.append(tabs);

    if (tab === 'broadcast') {
      body.append(el('p', 'muted small', 'Play to your players’ devices. Each one plays the sounds itself, in sync, with its own volume for music, effects and ambience.'));
      body.append(field('Session name', textInput(settings.sessionName, 'e.g. Friday Night Game', (v) => { settings.sessionName = v; }, 40)));
      const modes = el('div', 'live-modes');
      for (const [id, title, hint] of [
        ['local', 'At the table', 'Players on the same Wi-Fi find your session.'],
        ['online', 'Online', 'Players anywhere join with a code, through a relay server.'],
      ]) {
        const option = el('label', `live-mode${settings.mode === id ? ' selected' : ''}`);
        const radio = el('input');
        radio.type = 'radio';
        radio.name = 'live-mode';
        radio.checked = settings.mode === id;
        radio.addEventListener('change', () => { settings.mode = id; saveSettings(); renderDialog(); });
        const text = el('span');
        text.append(el('b', null, title), el('span', 'muted small', hint));
        option.append(radio, text);
        modes.append(option);
      }
      body.append(modes);
      if (settings.mode === 'online') body.append(relayField());
      if (settings.mode === 'local' && !bonjour) body.append(el('p', 'live-error', 'Local sessions aren’t available in this build. Use Online instead.'));
      const start = el('button', 'primary', busy ? 'Starting…' : 'Start Broadcasting');
      start.type = 'button';
      start.disabled = busy;
      start.addEventListener('click', () => run(() => api.live.hostStart({ name: settings.sessionName, mode: settings.mode, relay: settings.relay })));
      body.append(start);
      return;
    }

    body.append(field('Your name (shown to the GM)', textInput(settings.yourName, 'e.g. Sam', (v) => { settings.yourName = v; }, 40)));
    body.append(el('div', 'live-subhead', 'Sessions on this Wi-Fi'));
    const list = el('div', 'live-list');
    if (!sessions.length) list.append(el('p', 'muted small', 'Looking for sessions on this network…'));
    for (const session of sessions) {
      const row = el('div', 'live-row-item');
      row.append(el('span', null, session.name));
      const join = el('button', 'primary', 'Tune In');
      join.type = 'button';
      join.disabled = busy;
      join.addEventListener('click', () => run(() => api.live.listen({ url: session.url, name: settings.yourName })));
      row.append(join);
      list.append(row);
    }
    body.append(list);
    body.append(el('div', 'live-subhead', 'Online session'));
    const codeRow = el('div', 'live-code-row');
    const code = textInput(settings.code, 'Code, e.g. K7QX2', (v) => { settings.code = v.toUpperCase(); }, 8);
    code.classList.add('live-code-input');
    const join = el('button', 'primary', 'Tune In');
    join.type = 'button';
    join.disabled = busy;
    join.addEventListener('click', () => run(() => api.live.listen({ code: settings.code, relay: settings.relay, name: settings.yourName })));
    codeRow.append(code, join);
    body.append(codeRow, relayField());
  }

  function relayField() {
    const wrap = field('Relay server', textInput(settings.relay, 'e.g. relay.example.com', (v) => { settings.relay = v.trim(); }, 200));
    wrap.append(el('span', 'muted small', 'Everyone in an online session uses the same relay. See live-relay/README.md to run one.'));
    return wrap;
  }

  function renderHosting(body) {
    const head = el('div', 'live-hero');
    head.append(el('div', 'muted small', status.mode === 'online' ? 'Broadcasting online' : 'Broadcasting at the table'));
    head.append(el('div', 'live-hero-name', status.name || 'Live Session'));
    if (status.mode === 'online' && status.code) {
      head.append(el('div', 'live-code', status.code));
      head.append(el('div', 'muted small', 'Players open Live → Tune In and enter this code.'));
    } else {
      head.append(el('div', 'muted small', 'Players on the same Wi-Fi open Live → Tune In and pick this session.'));
    }
    if (status.reconnecting) head.append(el('div', 'live-error', 'Reconnecting to the relay…'));
    body.append(head);

    const peers = status.peers || [];
    body.append(el('div', 'live-subhead', peers.length ? `Listening (${peers.length})` : 'No one has tuned in yet'));
    const list = el('div', 'live-list');
    for (const peer of peers) {
      const row = el('div', 'live-row-item');
      const who = el('span');
      who.append(el('b', null, peer.name));
      if (peer.device) who.append(el('span', 'muted small', ` · ${peer.device}`));
      const whisper = el('button', whisperTo && whisperTo.peer === peer.peer ? 'active' : '', 'Whisper…');
      whisper.type = 'button';
      whisper.title = 'The next sound you play goes only to this player';
      whisper.addEventListener('click', () => {
        setWhisper({ peer: peer.peer, name: peer.name });
        $('#live-dialog').close();
      });
      row.append(who, whisper);
      list.append(row);
    }
    body.append(list);
    body.append(el('p', 'muted small', 'Mark sounds GM only (never sent) or Buzz (vibrates phones) in each sound’s Edit window. Players set their own music, effects and ambience volumes.'));
    const end = el('button', 'danger', 'End Session');
    end.type = 'button';
    end.addEventListener('click', () => run(() => api.live.leave()));
    body.append(end);
  }

  function renderListening(body) {
    const head = el('div', 'live-hero');
    head.append(el('div', 'muted small', status.state === 'connected' ? 'Tuned in to' : 'Connecting to'));
    head.append(el('div', 'live-hero-name', status.host || 'the GM'));
    if (status.scene) head.append(el('div', 'muted small', `Scene: ${status.scene}`));
    body.append(head);

    const sliders = el('div', 'live-sliders');
    for (const [key, text] of [['master', 'Volume'], ['music', 'Music'], ['sfx', 'Effects'], ['ambience', 'Ambience']]) {
      const input = el('input');
      input.type = 'range';
      input.min = '0';
      input.max = '1';
      input.step = '0.01';
      input.value = String(settings.volumes[key]);
      input.addEventListener('input', () => { settings.volumes[key] = Number(input.value); saveSettings(); Mirror.applyVolumes(); });
      sliders.append(field(text, input));
    }
    body.append(sliders);
    body.append(el('div', 'live-subhead', 'Now playing'));
    const now = el('div', 'live-now muted small');
    now.id = 'live-now';
    body.append(now);
    renderNowPlaying();
    const leave = el('button', 'danger', 'Leave Session');
    leave.type = 'button';
    leave.addEventListener('click', () => run(() => api.live.leave()));
    body.append(leave);
  }

  function renderNowPlaying() {
    const now = document.getElementById('live-now');
    if (!now) return;
    const names = Mirror.nowPlaying();
    now.textContent = names.length ? names.join(' · ') : 'Nothing right now.';
  }

  $('#live-btn').addEventListener('click', async () => {
    const current = await api.live.status();
    bonjour = current.bonjour !== false;
    status = current;
    error = '';
    renderButton();
    renderDialog();
    if (!status.role && tab === 'listen') api.live.browse(true);
    $('#live-dialog').showModal();
  });
  $('#live-dialog').addEventListener('close', () => api.live.browse(false));

  api.live.status().then((current) => { bonjour = current.bonjour !== false; setStatus(current); });

  return { soundPlayed, soundStopped, soundVolume, stoppedAll, hosting, listening };
})();
