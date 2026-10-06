/* global api, $, sounds, play, prefs, toast, Ambience, Kits, Bashes, isFull, Icons, Themes, ThemeArt, COLORS */
// Live Session in the window: the Live dialog, forwarding what the board plays
// to listeners (when hosting), and playing what the host sends (when tuned in)
// on a full-window stage in the theme's style, with the player's own sound pads.
// The networking lives in the main process (src/live.js). Matches the iPad
// app's LiveSession, LiveView and ListenerStageView.
const Live = (() => {
  const SETTINGS_KEY = 'live';
  // Online sessions go through Dungeon Radio's own relay server. (Tests can
  // point at a local relay with localStorage 'liveTestRelay'.)
  const DEFAULT_RELAY = 'soundboard-r1zt.onrender.com';
  const relayAddress = () => {
    try { return localStorage.getItem('liveTestRelay') || DEFAULT_RELAY; } catch { return DEFAULT_RELAY; }
  };
  const settings = loadSettings();
  let status = { role: null };
  let bonjour = true;
  let tab = 'broadcast';
  let sessions = [];
  // Armed for the next sound: whisper targets (peer id → name) and emphasis (vibrate phones).
  const whisper = new Map();
  let emphasis = false;
  let armedRun = null; // the bash run they apply to: { runId, to, emphasis }
  const seenRuns = new Set();
  let busy = false;
  let error = '';
  const LIMIT = 5;
  const PLAYER_SOUNDS = [
    ['off', 'Off', 'Only you play sounds.'],
    ['own', 'Their own sounds', `Each listener picks up to ${LIMIT} sounds from their own library. When they play one, everyone hears it. You can still use all your sounds.`],
    ['gm', 'My soundboard', `Each listener picks up to ${LIMIT} of your sounds (not broadcaster-only ones). When they play one, everyone hears it. You can still use all your sounds.`],
  ];
  // Listener: what the GM allows, and the GM's sounds to choose from.
  let allowed = 'off';
  let catalog = [];

  function loadSettings() {
    const defaults = {
      sessionName: '', yourName: '', yourAvatar: '', mode: 'local', code: '',
      volumes: { master: 1, music: 1, sfx: 1, ambience: 1 },
      // Which sounds players may play for everyone: 'off', 'own' or 'gm'.
      playerSounds: 'off',
      // A player's chosen sounds: the GM's (catalog ids) and their own (library ids).
      picksGM: [], picksOwn: [],
      // Scene Kit sounds that play for everyone on a natural 20 or a natural 1 ('' for none).
      nat20Sound: '', nat1Sound: '',
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
  // Listeners' pictures: each listener can pick one, shown beside their name
  // for the broadcaster and everyone else (the listener list, Whisper, games,
  // dice). Pictures are small square JPEGs, sent as base64.

  const avatars = new Map(); // peer -> base64 (listening; the host reads its peer list)
  function avatarOf(peer) {
    if (!peer) return '';
    if (hosting()) return (status.peers || []).find((p) => p.peer === peer)?.avatar || '';
    if (listening() && peer === you && settings.yourAvatar) return settings.yourAvatar;
    return avatars.get(peer) || '';
  }
  // A round picture, or the name's first letter when there's none.
  function face(peer, name, size = 28) {
    const data = avatarOf(peer);
    const node = el(data ? 'img' : 'span', 'face');
    node.style.width = node.style.height = `${size}px`;
    if (data) {
      node.src = `data:image/jpeg;base64,${data}`;
      node.alt = '';
    } else {
      node.textContent = (String(name || '?').trim()[0] || '?').toUpperCase();
      node.style.fontSize = `${Math.round(size * 0.45)}px`;
      node.setAttribute('aria-hidden', 'true');
    }
    return node;
  }
  // This listener's own picture (before tuning in too).
  function ownFace(size) {
    if (!settings.yourAvatar) return face(null, settings.yourName || '?', size);
    const img = el('img', 'face');
    img.src = `data:image/jpeg;base64,${settings.yourAvatar}`;
    img.alt = 'Your picture';
    img.style.width = img.style.height = `${size}px`;
    return img;
  }
  api.live.onAvatars((list) => {
    for (const { peer, data } of list) { if (data) avatars.set(peer, data); else avatars.delete(peer); }
    refreshFaces();
  });
  function refreshFaces() {
    if (listening()) Stage.render();
    window.Games?.refresh?.();
  }

  // Choose a picture: cropped to a square from the middle and made small.
  const avatarInput = el('input');
  avatarInput.type = 'file';
  avatarInput.accept = 'image/*';
  avatarInput.hidden = true;
  avatarInput.className = 'avatar-input';
  document.body.append(avatarInput);
  let avatarChosen = null;
  function pickAvatar(then) {
    avatarChosen = then;
    avatarInput.click();
  }
  avatarInput.addEventListener('change', async () => {
    const file = avatarInput.files && avatarInput.files[0];
    avatarInput.value = '';
    if (!file) return;
    try {
      const data = await squareJpeg(file, 192);
      await setAvatar(data);
      avatarChosen?.();
    } catch {
      toast('Couldn’t use that picture.', true);
    }
  });
  async function squareJpeg(file, size) {
    const bitmap = await createImageBitmap(file);
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = el('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#222';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
    bitmap.close();
    // Small enough to send: lower the quality until it fits in 32 KB.
    for (const quality of [0.82, 0.7, 0.55, 0.4]) {
      const data = canvas.toDataURL('image/jpeg', quality).split(',')[1];
      if (data.length * 0.75 <= 32 * 1024) return data;
    }
    throw new Error('too big');
  }
  async function setAvatar(data) {
    settings.yourAvatar = data || '';
    saveSettings();
    await api.live.setAvatar(settings.yourAvatar);
    if ($('#live-dialog').open) renderDialog();
    refreshFaces();
  }

  // ---------------------------------------------------------------------
  // Host: what the board plays goes to listeners.

  let nextPid = 1;
  const pid = () => `${Date.now().toString(36)}-${nextPid++}`;
  const category = (sound) => (isFull(sound) ? 'music' : 'sfx');

  // A sound tile or row started playing. options: { group, fadeIn }.
  function soundPlayed(sound, options = {}) {
    if (!hosting() || !sound || sound.gmOnly) {
      if (hosting() && sound && sound.gmOnly && whisper.size) toast('Broadcaster-only sounds can’t be whispered.', true);
      return;
    }
    const event = {
      t: 'play',
      pid: pid(),
      group: options.group || `s:${sound.id}`,
      soundId: sound.id,
      name: sound.name,
      // Started part-way through (a bookmark): listeners start at the same place.
      at: Date.now() - (options.seek > 0 ? options.seek * 1000 : 0),
      ...(options.fadeIn > 0 ? { fadeIn: options.fadeIn } : {}),
      volume: Math.min(1, (sound.volume ?? 1) * (options.gain ?? 1) * prefs.master),
      cat: category(sound),
      loop: !!sound.repeat && !sound.repeat.gap,
      gap: sound.repeat && sound.repeat.gap ? sound.repeat.gap : 0,
      buzz: !!sound.buzz || emphasis,
      dur: sound.duration || 0,
    };
    if (whisper.size) {
      event.to = [...whisper.keys()];
      toast(`Whispered “${sound.name}” to ${[...whisper.values()].join(', ')}.`);
    } else if (emphasis) {
      toast(`“${sound.name}” played with emphasis.`);
    }
    disarm();
    api.live.hostEvent(event);
  }

  // A playing sound stopped (fading out over `fade` seconds) or changed volume.
  function groupStopped(group, fade = 0) {
    if (hosting()) api.live.hostEvent({ t: 'stop', group, ...(fade > 0 ? { fade } : {}) });
  }

  function groupVolume(group, volume) {
    if (hosting()) api.live.hostEvent({ t: 'volume', group, volume });
  }

  function stoppedAll() {
    if (hosting()) api.live.hostEvent({ t: 'stopAll' });
    if (listening()) Mirror.stopAll(false);
  }

  // Bash clips arrive one play at a time from the bash player.
  // An armed whisper or emphasis applies to every clip of the next bash.
  Bashes.player.onSchedule = ({ runId, sound, at, volume, dur }) => {
    if (!hosting() || !sound || sound.gmOnly) return;
    if (!seenRuns.has(runId)) {
      if (seenRuns.size > 200) seenRuns.clear();
      seenRuns.add(runId);
      if (whisper.size || emphasis) {
        armedRun = { runId, to: whisper.size ? [...whisper.keys()] : null, emphasis };
        disarm();
      }
    }
    const armed = armedRun && armedRun.runId === runId ? armedRun : null;
    api.live.hostEvent({
      t: 'play', pid: pid(), group: `b:${runId}`, soundId: sound.id, name: sound.name,
      at, volume: Math.min(1, volume), cat: 'sfx', buzz: !!sound.buzz || !!(armed && armed.emphasis), dur,
      ...(armed && armed.to ? { to: armed.to } : {}),
    });
  };
  Bashes.player.onStop = (runId) => {
    if (hosting()) api.live.hostEvent({ t: 'stop', group: `b:${runId}` });
  };

  // Now-and-then ambience layers: each time one plays, listeners play it too.
  Ambience.onCue(({ key, kind, ref, name, volume }) => {
    if (!hosting()) return;
    if (kind === 'sound' && sounds.find((s) => s.id === ref)?.gmOnly) return;
    api.live.hostEvent({
      t: 'play', pid: pid(), group: `a:${key}`, name, at: Date.now(), volume: Math.min(1, volume), cat: 'ambience',
      ...(kind === 'builtin' ? { builtin: ref } : { soundId: ref }),
    });
  });
  Ambience.onCueStop((key, fade) => groupStopped(`a:${key}`, fade));

  // Ambience, the open scene kit and what listeners should fetch ahead of
  // time are checked twice a second and sent when they change.
  let lastAmbience = '';
  let lastScene;
  let lastPrefetch = '';
  let lastCatalog = '';
  // A scene change in progress: ambience sent in the next moment fades this long.
  let sceneFade = null;
  // fade: seconds for listeners to fade layers in and out (a scene change).
  function syncHostState(force = false, fade = 0) {
    if (!hosting()) return;
    if (!fade && sceneFade && Date.now() < sceneFade.until) fade = sceneFade.fade;
    const gmOnly = new Set(sounds.filter((s) => s.gmOnly).map((s) => s.id));
    const layers = Ambience.snapshot().filter((l) => l.kind === 'builtin' || !gmOnly.has(l.ref));
    const ambience = JSON.stringify(layers);
    if (force || ambience !== lastAmbience) {
      lastAmbience = ambience;
      api.live.hostEvent({ t: 'ambience', layers, ...(fade > 0 ? { fade } : {}) });
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
    const items = JSON.stringify(catalogItems());
    if (force || items !== lastCatalog) {
      lastCatalog = items;
      api.live.hostEvent({ t: 'catalog', items: JSON.parse(items) });
    }
  }

  // The GM's sounds players may choose from: everything except GM-only sounds.
  // Colours travel as palette positions, as on the iPad.
  function catalogItems() {
    return sounds.filter((s) => !s.gmOnly).map((s) => ({ id: s.id, name: s.name, color: Math.max(0, COLORS.indexOf(s.color)) }));
  }

  // A player played a sound: it plays for everyone, the GM included, in a
  // quarter of a second so every device starts together.
  api.live.onCue(({ peer, name: playerName, cue }) => {
    if (!hosting() || !cue) return;
    const at = Date.now() + 250;
    let url;
    let soundName;
    let volume = 1;
    let buzzIt = false;
    const playId = pid();
    const event = { t: 'play', pid: playId, group: `p:${peer}:${playId}`, at, cat: 'sfx', by: playerName };
    if (cue.kind === 'library') {
      const sound = sounds.find((s) => s.id === cue.soundId);
      if (!sound || sound.gmOnly) return;
      url = `sound://local/${encodeURIComponent(sound.file)}`;
      soundName = sound.name;
      volume = sound.volume ?? 1;
      buzzIt = !!sound.buzz;
      event.soundId = sound.id;
    } else {
      url = cue.url;
      soundName = cue.name || 'Sound';
      event.file = { hash: cue.hash, ext: cue.ext };
    }
    Object.assign(event, { name: soundName, volume, buzz: buzzIt });
    api.live.hostEvent(event);
    const audio = new Audio(url);
    audio.volume = Math.min(1, volume * prefs.master);
    if (prefs.outputDevice && audio.setSinkId) audio.setSinkId(prefs.outputDevice).catch(() => {});
    setTimeout(() => audio.play().catch(() => {}), Math.max(0, at - Date.now()));
    toast(`${playerName} played “${soundName}”.`);
  });
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

  function disarm() {
    whisper.clear();
    emphasis = false;
    renderArmed();
  }

  // The banner and toolbar buttons for what's armed for the next sound.
  function renderArmed() {
    const bar = $('#whisper-bar');
    bar.textContent = '';
    const armed = whisper.size > 0 || emphasis;
    bar.classList.toggle('hidden', !armed);
    bar.classList.toggle('emphasis-only', armed && !whisper.size);
    $('#whisper-btn').classList.toggle('hidden', !hosting());
    $('#emphasis-btn').classList.toggle('hidden', !hosting());
    $('#whisper-btn').classList.toggle('active', whisper.size > 0);
    $('#emphasis-btn').classList.toggle('active', emphasis);
    $('#whisper-label').textContent = whisper.size ? `Whisper (${whisper.size})` : 'Whisper';
    if (!armed) return;
    const parts = [];
    if (whisper.size) parts.push(`whispers to ${[...whisper.values()].join(', ')}`);
    if (emphasis) parts.push('vibrates phones');
    bar.append(el('span', null, `Next sound ${parts.join(' and ')}.`));
    const cancel = el('button', 'mini', 'Cancel');
    cancel.addEventListener('click', disarm);
    bar.append(cancel);
  }

  // The Whisper drop-down: tick one or more listeners.
  function openWhisperMenu() {
    const menu = $('#whisper-menu');
    menu.textContent = '';
    menu.append(el('div', 'menu-title', 'Whisper the next sound to…'));
    const peers = status.peers || [];
    if (!peers.length) menu.append(el('div', 'muted small menu-empty', 'No one has tuned in yet.'));
    for (const peer of peers) {
      const label = el('label', 'menu-check');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = whisper.has(peer.peer);
      box.addEventListener('change', () => {
        if (box.checked) whisper.set(peer.peer, peer.name); else whisper.delete(peer.peer);
        renderArmed();
      });
      label.append(box, face(peer.peer, peer.name, 24), el('span', null, peer.name));
      menu.append(label);
    }
    const rect = $('#whisper-btn').getBoundingClientRect();
    menu.style.top = `${rect.bottom + 6}px`;
    menu.style.left = `${Math.max(8, rect.right - 240)}px`;
    menu.classList.remove('hidden');
  }

  $('#whisper-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if ($('#whisper-menu').classList.contains('hidden')) openWhisperMenu(); else $('#whisper-menu').classList.add('hidden');
  });
  $('#whisper-menu').addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => $('#whisper-menu').classList.add('hidden'));
  $('#emphasis-btn').addEventListener('click', () => { emphasis = !emphasis; renderArmed(); });

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
      const entry = { audio, group: cmd.group, cat: cmd.cat, volume: cmd.volume, timer: null, name: cmd.name, whisper: cmd.whisper, by: cmd.by || null, at: cmd.at };
      plays.set(cmd.pid, entry);
      audio.volume = cmd.fadeIn > 0 ? 0 : Math.min(1, cmd.volume * level(cmd.cat));
      if (cmd.loop) audio.loop = true;
      const finish = () => { clearTimeout(entry.timer); if (plays.get(cmd.pid) === entry) { plays.delete(cmd.pid); renderNowPlaying(); } };
      const startAt = (position) => {
        audio.currentTime = position;
        audio.play().catch(finish);
        // A song crossfading in: what's left of the fade, if it started late.
        if (cmd.fadeIn > 0) {
          const left = Math.max(0, cmd.fadeIn - position);
          rampTo(entry, Math.min(1, entry.volume * level(entry.cat)), left);
        }
        if (cmd.whisper) Stage.whisper();
        if (cmd.buzz) buzz(cmd);
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

    // Fades a playing sound's volume to `target` over `seconds`.
    function rampTo(entry, target, seconds, then) {
      clearInterval(entry.ramp);
      if (!(seconds > 0)) { entry.audio.volume = target; if (then) then(); return; }
      const from = entry.audio.volume;
      const started = Date.now();
      entry.ramp = setInterval(() => {
        const t = Math.min(1, (Date.now() - started) / (seconds * 1000));
        entry.audio.volume = Math.max(0, Math.min(1, from + (target - from) * t));
        if (t >= 1) { clearInterval(entry.ramp); entry.ramp = null; if (then) then(); }
      }, 40);
    }

    function stopPlay(id, fade = 0) {
      const entry = plays.get(id);
      if (!entry) return;
      clearTimeout(entry.timer);
      plays.delete(id);
      const end = () => { entry.audio.pause(); entry.audio.removeAttribute('src'); entry.audio.load(); };
      if (fade > 0 && !entry.audio.paused) rampTo(entry, 0, fade, end);
      else { clearInterval(entry.ramp); end(); }
    }

    function stopGroup(group, fade = 0) {
      for (const [id, entry] of plays) if (entry.group === group) stopPlay(id, fade);
      renderNowPlaying();
    }

    function setGroupVolume(group, volume) {
      for (const entry of plays.values()) {
        if (entry.group !== group) continue;
        entry.volume = volume;
        if (!entry.ramp) entry.audio.volume = Math.min(1, volume * level(entry.cat));
      }
    }

    // Fades a looping layer to `target` over a second and a half (or `seconds`).
    function fade(layer, target, then, seconds = 1.5) {
      clearInterval(layer.fade);
      const from = layer.audio.volume;
      const started = Date.now();
      layer.fade = setInterval(() => {
        const t = Math.min(1, (Date.now() - started) / (seconds * 1000));
        layer.audio.volume = Math.max(0, Math.min(1, from + (target - from) * t));
        if (t >= 1) { clearInterval(layer.fade); if (then) then(); }
      }, 50);
    }

    // seconds: how long layers fade in and out (longer on a scene change).
    function setAmbience(list, seconds = 1.5) {
      const keep = new Set(list.map((l) => l.key));
      for (const [key, layer] of layers) {
        if (keep.has(key)) continue;
        layers.delete(key);
        fade(layer, 0, () => { layer.audio.pause(); layer.audio.removeAttribute('src'); layer.audio.load(); }, seconds);
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
        audio.play().then(() => fade(layer, Math.min(1, item.volume * level('ambience')), null, seconds)).catch(() => layers.delete(item.key));
      }
      renderNowPlaying();
    }

    function stopAll(ambienceToo) {
      for (const id of [...plays.keys()]) stopPlay(id);
      if (ambienceToo) setAmbience([]);
      renderNowPlaying();
    }

    function applyVolumes() {
      for (const entry of plays.values()) if (!entry.ramp) entry.audio.volume = Math.min(1, entry.volume * level(entry.cat));
      for (const layer of layers.values()) { clearInterval(layer.fade); layer.audio.volume = Math.min(1, layer.volume * level('ambience')); }
    }

    // What's playing: sounds and full sounds (with who played them), then ambience.
    function nowPlaying() {
      const items = [];
      const seen = new Set();
      for (const [id, entry] of [...plays].sort((a, b) => a[1].at - b[1].at)) {
        if (entry.whisper || !entry.name) continue;
        // A now-and-then ambience sound (thunder) shows with the ambience.
        const kind = entry.cat === 'music' ? 'music' : entry.cat === 'ambience' ? 'ambience' : 'sound';
        const key = `${kind}-${entry.name}-${entry.by || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({ id, name: entry.name, kind, by: entry.by });
      }
      for (const [key, layer] of [...layers].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        if (layer.name) items.push({ id: `a:${key}`, name: layer.name, kind: 'ambience', by: null });
      }
      return items;
    }

    return { play, stopGroup, setGroupVolume, setAmbience, stopAll, applyVolumes, nowPlaying };
  })();

  // Macs can't vibrate: the stage shakes and flashes, and if the window isn't
  // in front, a notification pops up and the Dock icon bounces.
  function buzz(cmd) {
    document.body.classList.remove('live-buzz');
    void document.body.offsetWidth;
    document.body.classList.add('live-buzz');
    setTimeout(() => document.body.classList.remove('live-buzz'), 450);
    Stage.flash();
    api.live.notify({
      title: `💥 ${status.host || 'The broadcaster'}`,
      body: cmd && cmd.whisper ? 'Something only you can feel…' : (cmd && cmd.name ? cmd.name : 'Brace yourself!'),
    });
  }

  api.live.onCommand((cmd) => {
    if (!listening()) return;
    switch (cmd.t) {
      case 'play': Mirror.play(cmd); break;
      case 'stop': Mirror.stopGroup(cmd.group, cmd.fade || 0); break;
      case 'volume': Mirror.setGroupVolume(cmd.group, cmd.volume); break;
      case 'stopAll': Mirror.stopAll(!!cmd.ambienceToo); break;
      case 'ambience': Mirror.setAmbience(cmd.layers || [], cmd.fade > 0 ? cmd.fade : 1.5); break;
      default: break;
    }
  });


  // ---------------------------------------------------------------------
  // Listeners' sounds (listener): up to five picks that play for everyone.

  api.live.onRules((mode) => {
    allowed = ['own', 'gm'].includes(mode) ? mode : 'off';
    if (allowed === 'own') offerOwnSounds();
    Stage.render();
  });
  api.live.onCatalog((items) => {
    catalog = Array.isArray(items) ? items : [];
    // Drop picks the GM no longer offers.
    const ids = new Set(catalog.map((c) => c.id));
    const kept = settings.picksGM.filter((id) => ids.has(id));
    if (kept.length !== settings.picksGM.length) { settings.picksGM = kept; saveSettings(); }
    Stage.render();
  });

  const paletteColor = (index) => COLORS[((Number(index) || 0) % COLORS.length + COLORS.length) % COLORS.length];

  // The player's chosen sounds for the current rules: [{ id, name, color }].
  function pickedSounds() {
    if (allowed === 'gm') return settings.picksGM.map((id) => catalog.find((c) => c.id === id)).filter(Boolean).map((c) => ({ id: c.id, name: c.name, color: paletteColor(c.color) }));
    if (allowed === 'own') return settings.picksOwn.map((id) => sounds.find((s) => s.id === id)).filter(Boolean).map((s) => ({ id: s.id, name: s.name, color: s.color }));
    return [];
  }

  const picks = () => (allowed === 'gm' ? settings.picksGM : settings.picksOwn);

  function togglePick(id) {
    const list = picks();
    const index = list.indexOf(id);
    if (index >= 0) list.splice(index, 1);
    else if (list.length < LIMIT) list.push(id);
    saveSettings();
    if (allowed === 'own') offerOwnSounds();
  }

  // Plays one of the player's chosen sounds for everyone.
  function playPick(id) {
    if (!listening()) return;
    if (allowed === 'gm') api.live.cue({ id });
    else if (allowed === 'own') api.live.cue({ soundId: id });
  }

  // Sends the host the player's own chosen sounds, so it can fetch them ahead of time.
  function offerOwnSounds() {
    if (!listening() || allowed !== 'own') return;
    api.live.offer(settings.picksOwn.filter((id) => sounds.some((s) => s.id === id)));
  }

  // ---------------------------------------------------------------------
  // The stage: what a player sees while tuned in, in the theme's style. Rings
  // ripple out while sounds play; whispers glow purple; buzz sounds shake and
  // flash; what's playing is grouped into sounds, full sounds and ambience; the
  // player's own pads sit at the bottom when the GM allows them.

  const STAGE_STYLES = {
    tavern: { ink: '#2B1A0C', secondary: '#5B4127', accent: '#9C3D12', ringA: '#7A5228', ringB: '#9C3D12', chip: 'rgba(122,82,40,0.16)', font: 'serif', title: 'serif', symbol: 'note', overlay: 'candle' },
    spaceAge: { ink: '#F6EFDD', secondary: '#A9B6D6', accent: '#2AD4C0', ringA: '#12B5A5', ringB: '#F0643C', chip: 'rgba(12,20,44,0.8)', font: 'rounded', title: 'rounded', symbol: 'speaker', overlay: 'orbit' },
    scifi: { ink: '#DDF6FF', secondary: '#7FB6D4', accent: '#3FD2FF', ringA: '#3FD2FF', ringB: '#1E8FBF', chip: 'rgba(8,32,58,0.8)', font: 'mono', title: 'mono', symbol: 'speaker', overlay: 'radar' },
    academia: { ink: '#F1E6C8', secondary: '#A9A3C9', accent: '#D4A94A', ringA: '#D4A94A', ringB: '#8FA6FF', chip: 'rgba(20,22,74,0.8)', font: 'serif', title: 'serif', symbol: 'moon', overlay: 'sigil' },
    default: { ink: '#FFFFFF', secondary: 'rgba(255,255,255,0.6)', accent: '#FFB35C', ringA: '#FF6A3D', ringB: '#B07CFF', chip: 'rgba(255,255,255,0.12)', font: 'default', title: 'serif', symbol: 'speaker', overlay: 'sparks' },
  };

  const Stage = (() => {
    let root = null;
    let canvas = null;
    let frame = 0;
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

    const style = () => STAGE_STYLES[typeof Themes !== 'undefined' ? Themes.theme : 'dark'] || STAGE_STYLES.default;

    function build() {
      root = el('section', 'live-stage hidden');
      root.id = 'live-stage';
      root.setAttribute('aria-label', 'Live Session');
      canvas = el('canvas', 'stage-anim');
      root.append(canvas, el('div', 'stage-flash'), el('div', 'stage-whisper-glow'));
      const content = el('div', 'stage-content');
      content.id = 'stage-content';
      root.append(content);
      const card = el('div', 'stage-whisper-card');
      card.append(el('div', 'stage-whisper-icon', '👂'), el('div', null, 'A whisper only you can hear…'));
      root.append(card);
      document.getElementById('app').after(root);
      if (typeof Themes !== 'undefined') Themes.onChange(() => { if (!root.classList.contains('hidden')) render(); });
    }

    function show() {
      if (!root) build();
      if (root.classList.contains('hidden')) {
        root.classList.remove('hidden');
        document.body.classList.add('stage-open');
      }
      render();
      if (!frame) frame = requestAnimationFrame(draw);
    }

    function hide() {
      if (!root || root.classList.contains('hidden')) return;
      root.classList.add('hidden');
      document.body.classList.remove('stage-open');
      cancelAnimationFrame(frame);
      frame = 0;
      document.getElementById('live-volumes')?.close();
      document.getElementById('live-picker')?.close();
    }

    function draw(now) {
      frame = 0;
      if (!root || root.classList.contains('hidden')) return;
      const w = root.clientWidth;
      const h = root.clientHeight;
      const scale = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(w * scale) || canvas.height !== Math.round(h * scale)) {
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
      }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.clearRect(0, 0, w, h);
      // Lite (dice effects): the stage holds still, redrawn now and then.
      const still = document.body.dataset.perf === 'lite';
      const time = reduceMotion.matches || still ? 0 : now / 1000;
      ThemeArt.stage(ctx, w, h, time, Mirror.nowPlaying().length > 0, style());
      if (still) {
        frame = -1;
        setTimeout(() => { frame = requestAnimationFrame(draw); }, 1000);
      } else {
        frame = requestAnimationFrame(draw);
      }
    }

    function chip(item, st) {
      const me = (settings.yourName || '').trim().toLowerCase();
      if (item.kind === 'ambience') {
        const c = el('span', 'stage-chip ambience');
        const icon = el('span', 'stage-chip-icon');
        Icons.set(icon, 'wind', '', { size: 13 });
        c.append(icon, el('span', 'stage-chip-name', item.name));
        return c;
      }
      const c = el('span', 'stage-chip');
      const bars = el('span', 'eq-bars');
      bars.append(el('i'), el('i'), el('i'));
      c.append(bars, el('span', 'stage-chip-name', item.name));
      if (item.by) c.append(el('span', 'stage-chip-by', me && item.by.toLowerCase() === me ? 'you' : item.by));
      c.style.setProperty('--chip', st.chip);
      return c;
    }

    function renderNow(container, st) {
      const items = Mirror.nowPlaying();
      const now = el('div', 'stage-now');
      now.id = 'live-now';
      if (!items.length) now.append(el('div', 'stage-secondary', 'Waiting for the broadcaster…'));
      for (const [title, kind] of [['SOUNDS', 'sound'], ['FULL SOUNDS', 'music'], ['AMBIENCE', 'ambience']]) {
        const list = items.filter((i) => i.kind === kind);
        if (!list.length) continue;
        const group = el('div', 'stage-group');
        group.append(el('div', 'stage-group-title', title));
        const row = el('div', 'stage-chips');
        for (const item of list) row.append(chip(item, st));
        group.append(row);
        now.append(group);
      }
      container.append(now);
    }

    function renderPads(container) {
      if (allowed === 'off') return;
      const panel = el('div', 'stage-pads');
      panel.dataset.artSeed = 'stage-pads';
      const head = el('div', 'stage-pads-head');
      head.append(el('div', 'stage-group-title', allowed === 'gm' ? "YOUR PICKS FROM THE BROADCASTER'S SOUNDS" : 'YOUR SOUNDS'));
      const list = pickedSounds();
      const choose = el('button', 'link-btn', list.length ? 'Change' : 'Choose');
      choose.type = 'button';
      choose.addEventListener('click', openPicker);
      head.append(choose);
      panel.append(head);
      if (!list.length) {
        const empty = el('button', 'stage-pads-empty', `＋ Choose up to ${LIMIT} sounds to play for everyone`);
        empty.type = 'button';
        empty.addEventListener('click', openPicker);
        panel.append(empty);
      } else {
        const row = el('div', 'stage-pad-row');
        for (const sound of list) {
          const pad = el('button', 'stage-pad', sound.name);
          pad.type = 'button';
          pad.title = `Play ${sound.name} for everyone`;
          pad.style.setProperty('--pad', sound.color);
          pad.addEventListener('click', () => {
            playPick(sound.id);
            pad.classList.add('pressed');
            setTimeout(() => pad.classList.remove('pressed'), 250);
          });
          row.append(pad);
        }
        panel.append(row);
      }
      container.append(panel);
    }

    function render() {
      if (!root || root.classList.contains('hidden')) return;
      const st = style();
      root.dataset.font = st.font;
      root.style.setProperty('--stage-ink', st.ink);
      root.style.setProperty('--stage-secondary', st.secondary);
      root.style.setProperty('--stage-accent', st.accent);
      root.style.setProperty('--stage-ring', st.ringA);
      root.style.setProperty('--stage-chip', st.chip);
      root.classList.toggle('playing', Mirror.nowPlaying().length > 0);
      const content = root.querySelector('#stage-content');
      content.textContent = '';
      const connected = status.state === 'connected';

      const top = el('div', 'stage-top');
      const live = el('div', `stage-pill${connected ? ' on' : ''}`);
      live.append(el('span', 'stage-dot'), el('span', null, connected ? 'LIVE' : 'CONNECTING'));
      const volumes = el('button', 'stage-pill stage-button', 'Volumes');
      volumes.type = 'button';
      volumes.addEventListener('click', openVolumes);
      const dice = el('button', 'stage-pill stage-button stage-dice-top', 'Dice');
      dice.type = 'button';
      dice.title = 'Roll dice: everyone in the session sees them';
      dice.addEventListener('click', () => window.DiceTray?.open());
      top.append(live, el('span', 'spacer'));
      // The session's handouts, once there are any.
      const handouts = window.Handouts?.count() || 0;
      if (handouts) {
        const list = el('button', 'stage-pill stage-button stage-handouts', `Handouts · ${handouts}`);
        list.type = 'button';
        list.title = 'Pictures the broadcaster has shown this session';
        list.addEventListener('click', () => window.Handouts.openLog());
        top.append(list);
      }
      // Your picture: tap to change it.
      const me = el('button', 'stage-me');
      me.type = 'button';
      me.title = settings.yourAvatar ? 'Change your picture' : 'Add your picture (everyone sees it beside your name)';
      me.setAttribute('aria-label', me.title);
      me.append(ownFace(34));
      me.addEventListener('click', () => pickAvatar());
      top.append(dice, volumes, me);

      const center = el('div', 'stage-center');
      const emblem = el('div', 'stage-emblem');
      Icons.set(emblem, st.symbol, '', { size: 72 });
      center.append(emblem);
      if (connected) {
        center.append(el('div', 'stage-secondary', 'Tuned in to'));
        const name = el('div', 'stage-host', status.host || 'the broadcaster');
        name.dataset.font = st.title;
        center.append(name);
        if (status.scene) {
          const scene = el('div', 'stage-pill stage-scene');
          const icon = el('span');
          Icons.set(icon, 'mask', '', { size: 14 });
          scene.append(icon, el('span', null, status.scene));
          center.append(scene);
        }
      } else {
        center.append(el('div', 'stage-spinner'), el('div', 'stage-secondary', 'Connecting…'));
      }
      renderNow(center, st);

      // Phones: the listener's main action, big and in thumb reach (CSS shows it
      // on narrow screens, where the Dice button at the top is hidden).
      const roll = el('button', 'stage-roll', '🎲 Roll Dice');
      roll.type = 'button';
      roll.addEventListener('click', () => window.DiceTray?.open());
      const bottom = el('div', 'stage-bottom');
      bottom.append(el('span', 'stage-secondary small', 'You can switch to another app; sounds keep playing.'));
      bottom.append(el('span', 'spacer'));
      const leave = el('button', 'stage-leave', 'Leave');
      leave.type = 'button';
      leave.addEventListener('click', () => {
        // eslint-disable-next-line no-alert
        if (window.confirm('Leave the session?')) run(() => api.live.leave());
      });
      bottom.append(leave);

      content.append(top, el('div', 'stage-spacer'), center, el('div', 'stage-spacer'));
      renderPads(content);
      content.append(roll, bottom);
    }

    // The purple glow of a whisper.
    let whisperTimer;
    function whisper() {
      if (!root) return;
      root.classList.add('whispering');
      clearTimeout(whisperTimer);
      whisperTimer = setTimeout(() => root.classList.remove('whispering'), 2800);
    }

    function flash() {
      if (!root) return;
      root.classList.remove('flash');
      void root.offsetWidth;
      root.classList.add('flash');
      setTimeout(() => root.classList.remove('flash'), 600);
    }

    // The listener's volume sliders.
    function openVolumes() {
      let dialog = document.getElementById('live-volumes');
      if (!dialog) {
        dialog = el('dialog');
        dialog.id = 'live-volumes';
        document.body.append(dialog);
      }
      dialog.textContent = '';
      const form = el('form');
      form.method = 'dialog';
      form.append(el('h2', null, 'Your Volumes'));
      for (const [key, text] of [['master', 'Volume'], ['music', 'Music'], ['sfx', 'Effects'], ['ambience', 'Ambience']]) {
        const input = el('input');
        input.type = 'range';
        input.min = '0';
        input.max = '1';
        input.step = '0.01';
        input.value = String(settings.volumes[key]);
        input.setAttribute('aria-label', `${text} volume`);
        input.addEventListener('input', () => { settings.volumes[key] = Number(input.value); saveSettings(); Mirror.applyVolumes(); });
        const row = el('label', 'volume-row');
        row.append(el('span', null, text), input);
        form.append(row);
      }
      form.append(el('p', 'muted small', 'These only change what you hear.'));
      const actions = el('div', 'dialog-actions');
      actions.append(el('span', 'spacer'));
      const done = el('button', 'primary', 'Done');
      done.value = 'done';
      actions.append(done);
      form.append(actions);
      dialog.append(form);
      dialog.showModal();
    }

    // Choose up to five sounds, from the GM's soundboard or your own library.
    function openPicker() {
      let dialog = document.getElementById('live-picker');
      if (!dialog) {
        dialog = el('dialog', 'wide');
        dialog.id = 'live-picker';
        document.body.append(dialog);
        dialog.addEventListener('close', render);
      }
      const fill = () => {
        dialog.textContent = '';
        const form = el('form');
        form.method = 'dialog';
        form.append(el('h2', null, allowed === 'gm' ? "The Broadcaster's Sounds" : 'Your Sounds'));
        const chosen = picks().length;
        form.append(el('div', 'live-subhead', `${chosen} of ${LIMIT} chosen`));
        const list = el('div', 'picker-list');
        const options = allowed === 'gm'
          ? catalog.map((c) => ({ id: c.id, name: c.name, color: paletteColor(c.color) }))
          : sounds.map((s) => ({ id: s.id, name: s.name, color: s.color }));
        if (!options.length) list.append(el('p', 'muted', allowed === 'gm' ? "The broadcaster hasn't any sounds to share yet." : 'Your library is empty. Add sounds to it first.'));
        for (const option of options) {
          const picked = picks().includes(option.id);
          const row = el('label', 'picker-row');
          const box = el('input');
          box.type = 'checkbox';
          box.checked = picked;
          box.disabled = !picked && chosen >= LIMIT;
          box.addEventListener('change', () => { togglePick(option.id); fill(); });
          const dot = el('span', 'picker-dot');
          dot.style.background = option.color;
          row.append(box, dot, el('span', null, option.name));
          list.append(row);
        }
        form.append(list);
        form.append(el('p', 'muted small', 'When you play one of these on the stage, everyone in the session hears it.'));
        const actions = el('div', 'dialog-actions');
        actions.append(el('span', 'spacer'));
        const done = el('button', 'primary', 'Done');
        done.value = 'done';
        actions.append(done);
        form.append(actions);
        dialog.append(form);
      };
      fill();
      dialog.showModal();
    }

    return { show, hide, render, whisper, flash };
  })();

  // ---------------------------------------------------------------------
  // Dice: everyone in the session sees every roll (dice.js draws them).

  function myName() {
    const name = (settings.yourName || '').trim();
    if (hosting()) return name || 'Broadcaster';
    if (listening()) return name || 'Someone';
    return 'You';
  }

  // Asks for a dice colour; the broadcaster's app makes sure no one else has it.
  function claimColor(color) {
    if (hosting()) api.live.hostEvent({ t: 'diceColor', color, name: myName() });
    else if (listening()) api.live.roll({ t: 'diceColor', color });
  }

  function rollStart(start) {
    // The broadcaster can roll for someone else (an enemy's initiative).
    const message = { t: 'roll', ...start, by: (hosting() && start.by) || myName() };
    if (hosting()) api.live.hostEvent(message);
    else if (listening()) api.live.roll(message);
  }

  function rollResult(result) {
    const message = { t: 'rollResult', ...result };
    if (hosting()) api.live.hostEvent(message);
    else if (listening()) api.live.roll(message);
  }

  // This device's id in the session ('host' for the broadcaster).
  let you = null;
  api.live.onRoll((message) => {
    const tray = window.DiceTray;
    if (!tray || !(hosting() || listening())) return;
    if (message.you) you = message.you;
    if (message.t === 'roll') tray.remoteStart(message);
    else if (message.t === 'rollResult') tray.remoteResult(message);
    else if (message.t === 'rolls') tray.setHistory(message.list);
    else if (message.t === 'diceColors') tray.setSessionColors(message.colors || [], message.you);
    else if (message.t === 'customDice') tray.setSharedCustom(message.list);
    // Roll requests, results and the turn order (table.js).
    else if (['ask', 'askClosed', 'askResult', 'turns'].includes(message.t)) window.Table?.receive(message);
    // The buzzer or quiz (games.js).
    else if (message.t === 'game') window.Games?.receive(message);
  });

  // The broadcaster's custom dice, for listeners to roll too.
  function shareCustomDice(list) {
    if (hosting()) api.live.hostEvent({ t: 'customDice', list: list || [] });
  }

  // Roll requests and the turn order go from the broadcaster's window to listeners.
  function tableSend(message) {
    if (hosting()) api.live.hostEvent(message);
  }

  // A natural 20 or 1 plays the broadcaster's chosen sound for everyone.
  const hookNaturals = () => window.DiceTray.onNatural((n) => {
    const id = n === 20 ? settings.nat20Sound : settings.nat1Sound;
    if (!hosting() || !id || !sounds.some((s) => s.id === id)) return;
    play(id);
  });
  // dice.js is a module, so it loads after this script.
  if (window.DiceTray) hookNaturals(); else window.addEventListener('dice-ready', hookNaturals, { once: true });

  // Choose the natural 20 and natural 1 sounds: the Scene Kit's first, then the rest.
  function natSoundsField() {
    const wrap = el('div', 'live-nat-sounds');
    const kit = typeof Kits !== 'undefined' ? Kits.activeKit() : null;
    const inKit = new Set(kit ? kit.sections.flatMap((sec) => sec.items).filter((i) => i.type === 'sound').map((i) => i.id) : []);
    for (const [key, label] of [['nat20Sound', 'Natural 20 sound'], ['nat1Sound', 'Natural 1 sound']]) {
      const select = el('select');
      select.id = `live-${key}`;
      const none = el('option', null, 'None');
      none.value = '';
      select.append(none);
      const groups = kit ? [[kit.name || 'This Scene Kit', sounds.filter((x) => inKit.has(x.id))], ['All sounds', sounds.filter((x) => !inKit.has(x.id))]] : [['Sounds', sounds]];
      for (const [title, list] of groups) {
        if (!list.length) continue;
        const group = el('optgroup');
        group.label = title;
        for (const sound of list) {
          const option = el('option', null, sound.name);
          option.value = sound.id;
          group.append(option);
        }
        select.append(group);
      }
      select.value = sounds.some((x) => x.id === settings[key]) ? settings[key] : '';
      select.addEventListener('change', () => { settings[key] = select.value; saveSettings(); });
      wrap.append(field(label, select));
    }
    wrap.append(el('p', 'muted small', 'Plays for everyone when anyone rolls a natural 20 or a natural 1.'));
    return wrap;
  }

  $('#dice-btn').addEventListener('click', () => window.DiceTray?.open());

  // ---------------------------------------------------------------------
  // Status and the dialog.

  function setStatus(next) {
    const was = status.role;
    status = next || { role: null };
    if (next && next.error) error = next.error;
    if (was === 'listen' && status.role !== 'listen') { Mirror.stopAll(true); allowed = 'off'; catalog = []; }
    // A new session starts a new roll log; when it ends, the recap.
    if (status.role && !was) window.DiceTray?.resetLog();
    if (!status.role && was) {
      you = null;
      window.Table?.reset();
      // Ending your own broadcast: the dialog makes way for the recap.
      if (was === 'host' && !status.error && $('#live-dialog').open) $('#live-dialog').close();
      window.DiceTray?.showRecap();
    }
    // Dice colours belong to the session: claim yours when it starts, forget them when it ends.
    if (!status.role && was) window.DiceTray?.setSessionColors(null);
    if (status.role === 'host' && was !== 'host') {
      you = 'host';
      claimColor(window.DiceTray?.preferredColor() || '#b3261e');
      shareCustomDice(window.DiceTray?.myCustomDice());
    }
    window.Table?.statusChanged();
    window.Games?.statusChanged();
    window.Handouts?.statusChanged();
    // Tuning in: the dialog closes and the stage takes over the window until you leave.
    if (status.role === 'listen') { if ($('#live-dialog').open) $('#live-dialog').close(); Stage.show(); } else Stage.hide();
    // No need to add sounds while broadcasting.
    $('#add-btn').classList.toggle('hidden', status.role === 'host');
    $('#record-btn').classList.toggle('hidden', status.role === 'host');
    if (status.role === 'host' && was !== 'host') { lastScene = undefined; syncHostState(true); }
    if (status.role !== 'host') { whisper.clear(); emphasis = false; $('#whisper-menu').classList.add('hidden'); }
    // Drop whisper targets who left.
    for (const peer of [...whisper.keys()]) if (!(status.peers || []).some((p) => p.peer === peer)) whisper.delete(peer);
    renderArmed();
    renderButton();
    if ($('#live-dialog').open) renderDialog();
    if (status.role === 'listen') Stage.render();
    if (!status.role && was === 'listen' && status.error) {
      if (status.state === 'error') {
        // Couldn't tune in (a wrong code, a full session): back to the dialog with the reason.
        tab = 'listen';
        renderDialog();
        if (!$('#live-dialog').open) $('#live-dialog').showModal();
      } else toast(status.error);
    }
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

  // Listeners' sounds: Off, their own sounds, or picks from the GM's soundboard.
  function playerSoundsField() {
    const wrap = el('div', 'live-player-sounds');
    const select = el('select');
    select.id = 'live-player-sounds';
    for (const [id, label] of PLAYER_SOUNDS) {
      const option = el('option', null, label);
      option.value = id;
      select.append(option);
    }
    select.value = settings.playerSounds;
    const hint = el('p', 'muted small', PLAYER_SOUNDS.find((m) => m[0] === settings.playerSounds)[2]);
    select.addEventListener('change', () => {
      settings.playerSounds = select.value;
      saveSettings();
      hint.textContent = PLAYER_SOUNDS.find((m) => m[0] === settings.playerSounds)[2];
      if (hosting()) api.live.hostEvent({ t: 'playerSounds', mode: settings.playerSounds });
    });
    wrap.append(field("Listeners' sounds", select), hint);
    return wrap;
  }

  function renderDialog() {
    const body = $('#live-body');
    body.textContent = '';
    if (hosting()) renderHosting(body);
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
      body.append(el('p', 'muted small', 'Play to your listeners’ devices. Each one plays the sounds itself, in sync, with its own volume for music, effects and ambience.'));
      body.append(field('Session name', textInput(settings.sessionName, 'e.g. Friday Night Game', (v) => { settings.sessionName = v; }, 40)));
      const modes = el('div', 'live-modes');
      for (const [id, title, hint] of [
        ['local', 'At the table', 'Listeners on the same Wi-Fi find your session.'],
        ['online', 'Online', 'Listeners anywhere join with a code.'],
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
      if (settings.mode === 'local' && !bonjour) body.append(el('p', 'live-error', 'Local sessions aren’t available in this build. Use Online instead.'));
      body.append(playerSoundsField());
      body.append(natSoundsField());
      const start = el('button', 'primary', busy ? 'Starting…' : 'Start Broadcasting');
      start.type = 'button';
      start.disabled = busy;
      start.addEventListener('click', () => run(() => api.live.hostStart({
        name: settings.sessionName, mode: settings.mode, relay: relayAddress(),
        playerSounds: settings.playerSounds, catalog: catalogItems(),
      })));
      body.append(start);
      return;
    }

    // A name is needed to tune in: everyone sees it on your sounds and dice rolls.
    const named = () => (settings.yourName || '').trim().length > 0;
    const nameHint = el('p', 'muted small live-name-hint', 'Enter your name to tune in. Everyone sees it on your sounds and dice rolls.');
    const syncNamed = () => {
      nameHint.classList.toggle('live-error', !named());
      body.querySelectorAll('.tune-in').forEach((b) => { b.disabled = busy || !named(); });
    };
    body.append(field('Your name (required)', textInput(settings.yourName, 'e.g. Sam', (v) => { settings.yourName = v; syncNamed(); }, 40)));
    body.append(nameHint);
    // Your picture, shown beside your name (optional).
    const pictureRow = el('div', 'live-picture-row');
    const preview = ownFace(48);
    const pictureText = el('div', 'live-picture-text');
    pictureText.append(el('b', null, 'Your picture'), el('span', 'muted small', 'Optional. Shown beside your name to everyone.'));
    const choose = el('button', null, settings.yourAvatar ? 'Change…' : 'Choose…');
    choose.type = 'button';
    choose.addEventListener('click', () => pickAvatar());
    pictureRow.append(preview, pictureText, choose);
    if (settings.yourAvatar) {
      const remove = el('button', 'plain', 'Remove');
      remove.type = 'button';
      remove.addEventListener('click', () => setAvatar(''));
      pictureRow.append(remove);
    }
    body.append(pictureRow);
    body.append(el('div', 'live-subhead', 'Sessions on this Wi-Fi'));
    const list = el('div', 'live-list');
    if (!sessions.length) list.append(el('p', 'muted small', 'Looking for sessions on this network…'));
    for (const session of sessions) {
      const row = el('div', 'live-row-item');
      row.append(el('span', null, session.name));
      const join = el('button', 'primary tune-in', 'Tune In');
      join.type = 'button';
      join.addEventListener('click', () => { if (named()) run(() => api.live.listen({ url: session.url, name: settings.yourName.trim(), avatar: settings.yourAvatar })); });
      row.append(join);
      list.append(row);
    }
    body.append(list);
    body.append(el('div', 'live-subhead', 'Online session'));
    const codeRow = el('div', 'live-code-row');
    const code = textInput(settings.code, 'Code, e.g. K7QX2', (v) => { settings.code = v.toUpperCase(); }, 8);
    code.classList.add('live-code-input');
    const join = el('button', 'primary tune-in', 'Tune In');
    join.type = 'button';
    join.addEventListener('click', () => { if (named()) run(() => api.live.listen({ code: settings.code, relay: relayAddress(), name: settings.yourName.trim(), avatar: settings.yourAvatar })); });
    codeRow.append(code, join);
    body.append(codeRow);
    syncNamed();
  }

  function renderHosting(body) {
    const head = el('div', 'live-hero');
    head.append(el('div', 'muted small', status.mode === 'online' ? 'Broadcasting online' : 'Broadcasting at the table'));
    head.append(el('div', 'live-hero-name', status.name || 'Live Session'));
    if (status.mode === 'online' && status.code) {
      head.append(el('div', 'live-code', status.code));
      head.append(el('div', 'muted small', 'Listeners open Live → Tune In and enter this code.'));
      // Send it to players who aren't at the table.
      const copy = (text, button, done) => {
        navigator.clipboard.writeText(text).then(() => {
          button.textContent = done;
          setTimeout(() => { button.textContent = button.dataset.label; }, 1600);
        }).catch(() => toast('Couldn’t copy.', true));
      };
      const share = el('div', 'live-share');
      const codeBtn = el('button', null, 'Copy Code');
      codeBtn.type = 'button';
      codeBtn.dataset.label = 'Copy Code';
      codeBtn.addEventListener('click', () => copy(status.code, codeBtn, 'Copied'));
      const invite = el('button', null, 'Copy Invite');
      invite.type = 'button';
      invite.dataset.label = 'Copy Invite';
      invite.addEventListener('click', () => copy(`Tune in to “${status.name || 'my game'}” on Dungeon Radio: open Live → Tune In and enter the code ${status.code}.`, invite, 'Copied'));
      share.append(codeBtn, invite);
      head.append(share);
    } else {
      head.append(el('div', 'muted small', 'Listeners on the same Wi-Fi open Live → Tune In and pick this session.'));
    }
    if (status.reconnecting) head.append(el('div', 'live-error', 'Reconnecting to the relay…'));
    body.append(head);

    const peers = status.peers || [];
    body.append(el('div', 'live-subhead', peers.length ? `Listening (${peers.length})` : 'No one has tuned in yet'));
    const list = el('div', 'live-list');
    for (const peer of peers) {
      const row = el('div', 'live-row-item');
      const who = el('span', 'live-who');
      who.append(face(peer.peer, peer.name, 30), el('b', null, peer.name));
      if (peer.device) who.append(el('span', 'muted small', ` · ${peer.device}`));
      const whisperButton = el('button', whisper.has(peer.peer) ? 'active' : '', 'Whisper…');
      whisperButton.type = 'button';
      whisperButton.title = 'The next sound you play goes only to this listener';
      whisperButton.addEventListener('click', () => {
        whisper.clear();
        whisper.set(peer.peer, peer.name);
        renderArmed();
        $('#live-dialog').close();
      });
      const kick = el('button', 'danger', 'Remove');
      kick.type = 'button';
      kick.title = 'Remove this listener from the session';
      kick.addEventListener('click', () => {
        // eslint-disable-next-line no-alert
        if (!window.confirm(`Remove ${peer.name} from the session?`)) return;
        api.live.hostEvent({ t: 'kick', peer: peer.peer });
        whisper.delete(peer.peer);
        renderArmed();
      });
      const actions = el('span', 'live-row-actions');
      actions.append(whisperButton, kick);
      row.append(who, actions);
      list.append(row);
    }
    body.append(list);
    body.append(el('p', 'muted small', 'Whisper sends the next sound you play to that listener only. Remove takes a listener out of the session. Mark sounds Broadcaster only (never sent) or Buzz (vibrates phones) in each sound’s Edit window.'));
    body.append(playerSoundsField());
    body.append(natSoundsField());
    const end = el('button', 'danger', 'End Session');
    end.type = 'button';
    end.addEventListener('click', () => {
      const n = (status.peers || []).length;
      if (!window.confirm(n ? `End the session? ${n} listener${n === 1 ? '' : 's'} will be disconnected.` : 'End the session?')) return;
      run(() => api.live.leave());
    });
    body.append(end);
  }

  function renderNowPlaying() { Stage.render(); }

  $('#live-btn').addEventListener('click', async () => {
    const current = await api.live.status();
    bonjour = current.bonjour !== false;
    status = current;
    error = '';
    renderButton();
    if (listening()) { Stage.show(); return; }
    renderDialog();
    if (!status.role && tab === 'listen') api.live.browse(true);
    $('#live-dialog').showModal();
  });
  $('#live-dialog').addEventListener('close', () => api.live.browse(false));

  api.live.status().then((current) => { bonjour = current.bonjour !== false; setStatus(current); });

  return {
    soundPlayed, groupStopped, groupVolume, stoppedAll,
    // Redraws the listener's stage (a handout arrived).
    refreshStage: () => Stage.render(),
    // A scene change: send the new ambience now, fading over `fade` seconds.
    sceneChanged: (fade) => { sceneFade = { fade, until: Date.now() + 1500 }; syncHostState(false, fade); }, hosting, listening, myName, rollStart, rollResult, claimColor,
    shareCustomDice, tableSend,
    you: () => you,
    peers: () => status.peers || [],
    face, avatarOf,
    // A "your turn" nudge: the window shakes and flashes, and a notification if it's behind.
    nudge: (title, body) => {
      document.body.classList.remove('live-buzz');
      void document.body.offsetWidth;
      document.body.classList.add('live-buzz');
      setTimeout(() => document.body.classList.remove('live-buzz'), 450);
      if (listening()) Stage.flash();
      api.live.notify({ title, body });
    },
  };
})();
