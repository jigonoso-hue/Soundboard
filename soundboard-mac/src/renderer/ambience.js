/* global api, $, sounds, soundsLoaded, prefs, toast, Kits */
// Ambience: looping background layers (built-in or from the library) with
// their own volumes, mixed under the soundboard. Layers live in the dock at
// the bottom of the window and in scene kits' ambience sections; both play
// through the engine here.
const Ambience = (() => {
  const FADE = 1.5;
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

  async function startVoice(layer) {
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
    gain.gain.linearRampToValueAtTime(layer.volume, now + FADE);
  }

  function stopVoice(layerId, fade = FADE) {
    const voice = voices.get(layerId);
    if (!voice) return;
    voices.delete(layerId);
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
      toggle.title = layer.on ? 'Click to fade out' : 'Click to fade in';
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

      card.append(toggle, remove, volume);
      host.appendChild(card);
    }
    renderAddMenu();
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
    start(id, layer) {
      if (voices.has(id)) return;
      const voice = { ...layer, id };
      external.set(id, voice);
      startVoice(voice);
      render();
      notify();
    },
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
    // Every layer playing right now, for Live Session listeners.
    snapshot() {
      const out = [];
      for (const id of voices.keys()) {
        const layer = state.layers.find((l) => l.id === id) || external.get(id);
        if (layer) out.push({ key: id, kind: layer.kind, ref: layer.ref, name: layerName(layer), volume: layer.volume * state.volume });
      }
      return out;
    },
  };
})();
