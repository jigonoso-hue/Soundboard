/* global api, $, sounds, soundsLoaded, prefs, toast, Kits */
// Ambience: looping background layers (built-in or from the library) with
// their own volumes, mixed under the soundboard. Layers live in the dock at
// the bottom of the window and in scene kits' ambience sections; both play
// through the engine here.
const Ambience = (() => {
  const FADE = 1.5;
  // "Now and then" choices for a layer: seconds between plays, [shortest, longest].
  const EVERY = [[20, 60], [60, 180], [180, 480]];
  const everyLabel = ([lo, hi]) => (hi <= 60 ? `${lo} s–1 min` : `${Math.round(lo / 60)}–${Math.round(hi / 60)} min`);
  // A layer's "now and then" range, if it has a valid one.
  const cleanEvery = (every) => (Array.isArray(every) && EVERY.some(([lo, hi]) => every[0] === lo && every[1] === hi) ? [every[0], every[1]] : null);
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.connect(ctx.destination);

  let builtins = [];
  // The loops shipped before the app started tracking which ones you've seen.
  const ORIGINAL_BUILTINS = ['campfire.wav', 'cave-drips.wav', 'dark-drone.wav', 'forest-stream.wav',
    'night-forest.wav', 'ocean-waves.wav', 'rain.wav', 'wind.wav'];
  // Persisted: { volume, collapsed, layers: [{ id, kind: 'builtin'|'sound', ref, volume, on }] }
  let state = { volume: 0.8, collapsed: false, layers: [] };
  const voices = new Map(); // layer id -> { gain, stop() }
  const external = new Map(); // voice id -> layer, for layers in scene kits
  const listeners = new Set();
  const notify = () => { for (const fn of listeners) fn(); };
  // Live Session hooks for "now and then" layers: each play, and the layer stopping.
  const cueHooks = { play: new Set(), stop: new Set() };
  const buffers = new Map(); // built-in file -> Promise<AudioBuffer>

  function layerUrl(layer) {
    if (layer.kind === 'builtin') return `sound://builtin/${encodeURIComponent(layer.ref)}`;
    const sound = sounds.find((s) => s.id === layer.ref);
    return sound ? `sound://local/${encodeURIComponent(sound.file)}` : null;
  }

  function layerName(layer) {
    if (layer.kind === 'builtin') return builtins.find((b) => b.file === layer.ref)?.name || layer.ref;
    return sounds.find((s) => s.id === layer.ref)?.name || 'Missing sound';
  }

  let saveTimer;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => api.ambience.save(state), 300);
  }

  // ---------- Audio ----------

  // Built-in loops are decoded into memory so they loop without a gap.
  function loadBuiltin(file) {
    if (!buffers.has(file)) {
      buffers.set(file, api.ambience.readBuiltin(file)
        .then((bytes) => ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)))
        .catch((err) => { buffers.delete(file); throw err; }));
    }
    return buffers.get(file);
  }

  // A "now and then" layer: plays once at a random moment in its range, again
  // and again, until it's switched off.
  async function startOccasional(layer) {
    const url = layerUrl(layer);
    if (!url || voices.has(layer.id)) return;
    if (ctx.state === 'suspended') await ctx.resume();
    const gain = ctx.createGain();
    gain.gain.value = layer.volume;
    gain.connect(master);
    const playingNow = new Set();
    const voice = { gain, occasional: true, timer: null, stop: () => { clearTimeout(voice.timer); for (const end of playingNow) end(); } };
    voices.set(layer.id, voice);
    const [lo, hi] = layer.every;
    const schedule = (a, b) => { voice.timer = setTimeout(fire, (a + Math.random() * (b - a)) * 1000); };
    async function fire() {
      if (voices.get(layer.id) !== voice) return;
      try {
        if (layer.kind === 'builtin') {
          const buffer = await loadBuiltin(layer.ref);
          if (voices.get(layer.id) !== voice) return;
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(gain);
          const end = () => { try { source.stop(); } catch { /* already */ } };
          playingNow.add(end);
          source.onended = () => playingNow.delete(end);
          source.start();
        } else {
          const audio = new Audio();
          audio.crossOrigin = 'anonymous';
          audio.src = url;
          const source = ctx.createMediaElementSource(audio);
          source.connect(gain);
          const end = () => { audio.pause(); audio.removeAttribute('src'); audio.load(); };
          playingNow.add(end);
          audio.addEventListener('ended', () => { playingNow.delete(end); source.disconnect(); });
          await audio.play();
        }
        for (const fn of cueHooks.play) fn({ key: layer.id, kind: layer.kind, ref: layer.ref, name: layerName(layer), volume: layer.volume * state.volume });
      } catch { /* skip this one; try again next time */ }
      schedule(lo, hi);
    }
    // The first one comes sooner, so you hear that it's working.
    schedule(Math.min(3, lo), Math.min(12, lo));
  }

  async function startVoice(layer, fade = FADE) {
    if (layer.every) { startOccasional(layer); return; }
    const url = layerUrl(layer);
    if (!url || voices.has(layer.id)) return;
    if (ctx.state === 'suspended') await ctx.resume();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(master);
    const voice = { gain, stop: () => {} };
    voices.set(layer.id, voice);

    try {
      if (layer.kind === 'builtin') {
        const buffer = await loadBuiltin(layer.ref);
        if (voices.get(layer.id) !== voice) return; // switched off while loading
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(gain);
        source.start(0, Math.random() * buffer.duration); // desync repeated layers
        voice.stop = () => source.stop();
      } else {
        // Library sounds may be hour-long tracks, so stream them instead.
        const audio = new Audio();
        audio.crossOrigin = 'anonymous';
        audio.src = url;
        audio.loop = true;
        const source = ctx.createMediaElementSource(audio);
        source.connect(gain);
        await audio.play();
        if (voices.get(layer.id) !== voice) { audio.pause(); return; }
        voice.stop = () => { audio.pause(); audio.removeAttribute('src'); audio.load(); };
      }
    } catch (err) {
      voices.delete(layer.id);
      external.delete(layer.id);
      gain.disconnect();
      layer.on = false;
      render();
      notify();
      toast(`Couldn't play “${layerName(layer)}”.`, true);
      return;
    }
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(layer.volume, now + fade);
  }

  function stopVoice(layerId, fade = FADE) {
    const voice = voices.get(layerId);
    if (!voice) return;
    voices.delete(layerId);
    if (voice.occasional) {
      clearTimeout(voice.timer);
      for (const fn of cueHooks.stop) fn(layerId, fade);
    }
    const now = ctx.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
    voice.gain.gain.linearRampToValueAtTime(0, now + fade);
    setTimeout(() => { voice.stop(); voice.gain.disconnect(); }, fade * 1000 + 50);
  }

  function setLayerVolume(layer, volume) {
    layer.volume = volume;
    const voice = voices.get(layer.id);
    if (voice) voice.gain.gain.setTargetAtTime(volume, ctx.currentTime, 0.05);
    save();
  }

  // ---------- UI ----------

  function render() {
    const host = $('#amb-layers');
    host.textContent = '';
    host.classList.toggle('hidden', state.collapsed);
    $('#amb-collapse').textContent = `${state.collapsed ? '▸' : '▾'} Ambience`;
    const playing = state.layers.filter((l) => l.on).length + external.size;
    $('#amb-collapse').classList.toggle('active', playing > 0);
    $('#amb-collapse').title = external.size
      ? `Show/hide ambience layers (${external.size} playing from scene kits)` : 'Show/hide ambience layers';
    syncDock();

    for (const layer of state.layers) {
      const card = document.createElement('div');
      card.className = 'layer' + (layer.on ? ' on' : '');

      const toggle = document.createElement('button');
      toggle.className = 'layer-name';
      toggle.textContent = layerName(layer);
      toggle.title = (layer.on ? 'Click to fade out' : 'Click to fade in') + '. Right-click: loop or now and then.';
      toggle.addEventListener('click', () => {
        layer.on = !layer.on;
        if (layer.on) startVoice(layer); else stopVoice(layer.id);
        save();
        render();
      });

      const volume = document.createElement('input');
      volume.type = 'range';
      volume.min = 0;
      volume.max = 1;
      volume.step = 0.01;
      volume.value = layer.volume;
      volume.title = 'Layer volume';
      volume.addEventListener('input', () => setLayerVolume(layer, Number(volume.value)));

      const remove = document.createElement('button');
      remove.className = 'layer-remove';
      Icons.set(remove, 'close', '', { size: 12 });
      remove.title = 'Remove layer';
      remove.addEventListener('click', () => {
        stopVoice(layer.id, 0.3);
        state.layers = state.layers.filter((l) => l !== layer);
        save();
        render();
      });

      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        cueMenu(layer.every, e, (every) => {
          const wasOn = layer.on && voices.has(layer.id);
          if (wasOn) stopVoice(layer.id, 0.3);
          if (every) layer.every = every; else delete layer.every;
          if (wasOn) startVoice(layer);
          save();
          render();
        });
      });
      card.append(toggle, remove);
      // On its own line, so a long name doesn't hide it.
      if (layer.every) card.append(everyBadge(layer.every));
      card.append(volume);
      host.appendChild(card);
    }
    renderAddMenu();
  }

  // A small "every 1–3 min" tag on a now-and-then layer.
  function everyBadge(every) {
    const tag = document.createElement('span');
    tag.className = 'layer-every';
    Icons.set(tag, 'repeat', everyLabel(every), { size: 10 });
    tag.title = `Plays now and then: every ${everyLabel(every)}, at random`;
    return tag;
  }

  // The menu for how a layer plays: looping, or now and then.
  function cueMenu(current, event, choose) {
    const menu = $('#section-menu');
    menu.textContent = '';
    const heading = document.createElement('div');
    heading.className = 'menu-heading';
    heading.textContent = 'Plays';
    menu.appendChild(heading);
    const option = (label, every) => {
      const b = document.createElement('button');
      b.textContent = label;
      const on = every ? current && current[0] === every[0] && current[1] === every[1] : !current;
      if (on) b.className = 'checked';
      b.addEventListener('click', () => { menu.classList.add('hidden'); choose(every); });
      menu.appendChild(b);
    };
    option('Always (loops)', null);
    for (const every of EVERY) option(`Now and then: every ${everyLabel(every)}`, every);
    const hint = document.createElement('div');
    hint.className = 'muted small menu-hint menu-note';
    hint.textContent = 'Now and then plays it once at a random moment in that range, again and again: thunder, a wolf, a distant bell.';
    menu.appendChild(hint);
    menu.style.left = `${Math.min(window.innerWidth - 260, event.clientX)}px`;
    menu.classList.remove('hidden');
    // Kept on screen: above the pointer if there's no room below.
    const height = menu.offsetHeight;
    menu.style.top = `${Math.max(8, Math.min(window.innerHeight - height - 8, event.clientY))}px`;
  }

  function renderAddMenu() {
    const select = $('#amb-add');
    select.length = 1;
    const used = new Set(state.layers.map((l) => `${l.kind}:${l.ref}`));
    const group = (label, items) => {
      const options = items.filter((i) => !used.has(i.value));
      if (!options.length) return;
      const og = document.createElement('optgroup');
      og.label = label;
      for (const item of options) {
        const opt = document.createElement('option');
        opt.value = item.value;
        opt.textContent = item.label;
        og.appendChild(opt);
      }
      select.appendChild(og);
    };
    group('Built-in loops', builtins.map((b) => ({ value: `builtin:${b.file}`, label: b.name })));
    group('Your sounds', sounds.map((s) => ({ value: `sound:${s.id}`, label: s.name })));
  }

  function addLayer(kind, ref, on) {
    let layer = state.layers.find((l) => l.kind === kind && l.ref === ref);
    if (!layer) {
      layer = { id: `${kind}-${ref}-${Date.now()}`, kind, ref, volume: 0.7, on: false };
      state.layers.push(layer);
    }
    if (on && !layer.on) {
      layer.on = true;
      startVoice(layer);
    }
    state.collapsed = false;
    save();
    render();
  }

  $('#amb-add').addEventListener('change', (e) => {
    const value = e.target.value;
    e.target.value = '';
    if (!value) return;
    const [kind, ...rest] = value.split(':');
    addLayer(kind, rest.join(':'), true);
  });

  $('#amb-volume').addEventListener('input', (e) => {
    state.volume = Number(e.target.value);
    master.gain.setTargetAtTime(state.volume, ctx.currentTime, 0.05);
    save();
  });

  // Stops every ambience layer, including the ones started from scene kits.
  function stopAll() {
    for (const layer of state.layers) {
      if (layer.on) { layer.on = false; stopVoice(layer.id); }
    }
    for (const id of [...external.keys()]) stopVoice(id);
    external.clear();
    save();
    render();
    notify();
  }
  $('#amb-stop').addEventListener('click', stopAll);

  // While a scene kit with its own ambience section is open, that section
  // replaces the dock (unless the dock still has layers playing).
  function syncDock() {
    const kit = typeof Kits !== 'undefined' ? Kits.activeKit() : null;
    const kitHasAmbience = !!kit && kit.sections.some((s) => s.kind === 'ambience');
    const dockPlaying = state.layers.some((l) => l.on);
    $('#ambience').classList.toggle('hidden', kitHasAmbience && !dockPlaying);
  }

  $('#amb-collapse').addEventListener('click', () => {
    state.collapsed = !state.collapsed;
    save();
    render();
  });

  async function init() {
    builtins = await api.ambience.builtins();
    const saved = await api.ambience.load();
    const builtinLayer = (b) => ({ id: `builtin-${b.file}`, kind: 'builtin', ref: b.file, volume: 0.7, on: false });
    if (saved && Array.isArray(saved.layers)) {
      state = { ...state, ...saved };
      for (const layer of state.layers) {
        const every = cleanEvery(layer.every);
        if (every) layer.every = every; else delete layer.every;
      }
      // Loops added in an app update show up in the strip; ones the user removed stay removed.
      const known = new Set(saved.knownBuiltins || ORIGINAL_BUILTINS);
      const added = builtins.filter((b) => !known.has(b.file) && !state.layers.some((l) => l.kind === 'builtin' && l.ref === b.file));
      state.layers.push(...added.map(builtinLayer));
    } else {
      // First run: offer every built-in loop, all switched off.
      state.layers = builtins.map(builtinLayer);
    }
    state.knownBuiltins = builtins.map((b) => b.file);
    save();
    master.gain.value = state.volume;
    $('#amb-volume').value = state.volume;
    if (prefs.outputDevice) setOutputDevice(prefs.outputDevice);
    // Layers that were playing last time stay off until clicked; just remember the mix.
    for (const layer of state.layers) layer.on = false;
    render();
  }

  function setOutputDevice(deviceId) {
    if (ctx.setSinkId) ctx.setSinkId(deviceId || '').catch(() => {});
  }

  init();

  return {
    // Called whenever the library changes (sounds added, renamed, deleted).
    syncSounds() {
      if (!soundsLoaded) { render(); return; }
      const ids = new Set(sounds.map((s) => s.id));
      for (const layer of state.layers.filter((l) => l.kind === 'sound' && !ids.has(l.ref))) stopVoice(layer.id, 0.3);
      for (const [id, layer] of external) {
        if (layer.kind === 'sound' && !ids.has(layer.ref)) { stopVoice(id, 0.3); external.delete(id); notify(); }
      }
      const before = state.layers.length;
      state.layers = state.layers.filter((l) => l.kind !== 'sound' || ids.has(l.ref));
      if (state.layers.length !== before) save();
      render();
    },
    addSoundLayer(soundId) {
      addLayer('sound', soundId, true);
    },
    setOutputDevice,
    state: () => state,
    syncDock,
    stopAll,
    // For scene kits' ambience sections. `id` names the voice; `layer` is
    // { kind: 'builtin'|'sound', ref, volume }.
    builtins: () => builtins,
    layerName: (layer) => layerName(layer),
    isPlaying: (id) => voices.has(id),
    playingCount: () => voices.size,
    // options: { fade } seconds to fade in over (a scene change fades slower).
    start(id, layer, options = {}) {
      if (voices.has(id)) return;
      const voice = { ...layer, id };
      const every = cleanEvery(layer.every);
      if (every) voice.every = every; else delete voice.every;
      external.set(id, voice);
      startVoice(voice, options.fade || FADE);
      render();
      notify();
    },
    // A scene change: fades out every layer playing (the strip's and other
    // kits') except the voice ids in `keep`, over `fade` seconds.
    fadeOutAll(keep, fade) {
      for (const layer of state.layers) {
        if (layer.on && !keep.has(layer.id)) { layer.on = false; stopVoice(layer.id, fade); }
      }
      for (const id of [...external.keys()]) {
        if (keep.has(id)) continue;
        external.delete(id);
        stopVoice(id, fade);
      }
      save();
      render();
      notify();
    },
    // A scene kit layer switched between looping and now and then while playing.
    restart(id) {
      const layer = external.get(id);
      if (!layer || !voices.has(id)) return;
      stopVoice(id, 0.3);
      startVoice(layer);
    },
    EVERY,
    everyLabel,
    everyBadge,
    cueMenu,
    onCue(fn) { cueHooks.play.add(fn); },
    onCueStop(fn) { cueHooks.stop.add(fn); },
    stop(id) {
      if (!external.has(id)) return;
      external.delete(id);
      stopVoice(id);
      render();
      notify();
    },
    setVolume(id, volume) {
      const layer = external.get(id);
      if (!layer) return;
      layer.volume = volume;
      const voice = voices.get(id);
      if (voice) voice.gain.gain.setTargetAtTime(volume, ctx.currentTime, 0.05);
    },
    onChange(fn) { listeners.add(fn); },
    // For bookmarks: the ambience volume and every layer playing (the strip's
    // and scene kits'), with how each plays.
    capture() {
      const layers = [];
      for (const id of voices.keys()) {
        const strip = state.layers.find((l) => l.id === id);
        const layer = strip || external.get(id);
        if (!layer) continue;
        layers.push({ id, strip: !!strip, kind: layer.kind, ref: layer.ref, volume: layer.volume, ...(layer.every ? { every: layer.every } : {}) });
      }
      return { volume: state.volume, layers };
    },
    // A bookmark coming back: fades out what isn't in it and fades in what is.
    applyScene(scene, fade) {
      if (Number.isFinite(scene.volume)) {
        state.volume = Math.min(1, Math.max(0, scene.volume));
        master.gain.setTargetAtTime(state.volume, ctx.currentTime, 0.3);
        if ($('#amb-volume')) $('#amb-volume').value = state.volume;
      }
      const list = (scene.layers || []).filter((l) => l.kind === 'builtin' || sounds.some((s) => s.id === l.ref));
      this.fadeOutAll(new Set(list.map((l) => l.id)), fade);
      for (const entry of list) {
        if (entry.strip) {
          let layer = state.layers.find((l) => l.id === entry.id) || state.layers.find((l) => l.kind === entry.kind && l.ref === entry.ref);
          if (!layer) {
            layer = { id: entry.id, kind: entry.kind, ref: entry.ref, volume: entry.volume, on: false };
            state.layers.push(layer);
          }
          layer.volume = entry.volume;
          const every = cleanEvery(entry.every);
          if (every) layer.every = every; else delete layer.every;
          if (!layer.on) { layer.on = true; startVoice(layer, fade); } else voices.get(layer.id)?.gain.gain.setTargetAtTime(layer.volume, ctx.currentTime, 0.3);
        } else if (voices.has(entry.id)) {
          this.setVolume(entry.id, entry.volume);
        } else {
          this.start(entry.id, { kind: entry.kind, ref: entry.ref, volume: entry.volume, every: entry.every }, { fade });
        }
      }
      save();
      render();
      notify();
    },
    // Every layer playing right now, for Live Session listeners.
    snapshot() {
      const out = [];
      for (const [id, voice] of voices) {
        // Now-and-then layers reach listeners one play at a time instead.
        if (voice.occasional) continue;
        const layer = state.layers.find((l) => l.id === id) || external.get(id);
        if (layer) out.push({ key: id, kind: layer.kind, ref: layer.ref, name: layerName(layer), volume: layer.volume * state.volume });
      }
      return out;
    },
  };
})();
