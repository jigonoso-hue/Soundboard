/* global api, $, toast, AudioUtils, afterAdding, sounds, Fx, VoiceEdit, soundUrl */
// Record a Sound: record with the microphone, listen back, edit it (a voice
// effect, other sounds played along), name it and save it to the library as
// a WAV file (which every device in a Live Session can play). Matches the
// iPad app's RecorderView.
const Recorder = (() => {
  const MAX_SECONDS = 600; // recordings stop on their own after ten minutes
  const BARS = 40;

  let phase = 'idle'; // idle | recording | recorded
  let stream = null;
  let mediaRecorder = null;
  let chunks = [];
  let context = null;
  let analyser = null;
  let frame = 0;
  let startedAt = 0;
  let elapsed = 0;
  let levels = new Array(BARS).fill(0);
  let wav = null; // ArrayBuffer of the finished recording
  let previewUrl = null;
  let preview = null;
  // The edit: a voice effect and sounds played along.
  let voice = null; // the recording (mono samples)
  let voiceRate = 44100;
  let effect = null;
  let layers = []; // { soundId, name, volume, start, buffer }
  let edited = null; // { key, wav, url } for the current edit
  let rendering = false;

  const dialog = $('#record-dialog');
  const timeText = (seconds) => {
    const tenths = Math.floor(seconds * 10);
    return `${Math.floor(tenths / 600)}:${String(Math.floor(tenths / 10) % 60).padStart(2, '0')}.${tenths % 10}`;
  };

  function render() {
    $('#record-time').textContent = timeText(elapsed);
    $('#record-time').classList.toggle('recording', phase === 'recording');
    const button = $('#record-toggle');
    button.classList.toggle('recording', phase === 'recording');
    button.setAttribute('aria-label', phase === 'recording' ? 'Stop recording' : (phase === 'recorded' ? 'Record again' : 'Record'));
    $('#record-hint').textContent = phase === 'recording' ? 'Recording… click to stop.'
      : phase === 'recorded' ? 'Click the red button to record again.' : 'Click to record. Up to 10 minutes.';
    $('#record-after').classList.toggle('hidden', phase !== 'recorded');
    $('#record-save').disabled = phase !== 'recorded';
    $('#record-listen').textContent = rendering ? 'Applying…' : (preview && !preview.paused ? '■ Stop' : '▶ Listen');
    $('#record-listen').disabled = rendering;
    $('#record-save').disabled = phase !== 'recorded' || rendering;
    if (phase === 'recorded') renderEdit();
    drawMeter();
  }

  // ---------- Editing ----------

  const editKey = () => JSON.stringify({ effect, layers: layers.map((l) => [l.soundId, l.volume, l.start]) });
  const hasEdits = () => !!effect || layers.length > 0;

  function renderEdit() {
    const fx = $('#record-fx');
    if (!fx.childElementCount) {
      for (const option of [{ id: null, name: 'None' }, ...Fx.VOICE]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.dataset.fx = option.id || '';
        b.textContent = option.name;
        if (option.hint) b.title = option.hint;
        b.addEventListener('click', () => { effect = option.id; stopPreview(); render(); });
        fx.appendChild(b);
      }
    }
    for (const b of fx.children) b.setAttribute('aria-checked', String((b.dataset.fx || null) === effect));

    const list = $('#record-layers');
    list.textContent = '';
    layers.forEach((layer, index) => {
      const row = document.createElement('div');
      row.className = 'record-layer';
      const name = document.createElement('span');
      name.className = 'record-layer-name';
      name.textContent = layer.name;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'record-layer-remove';
      remove.textContent = '✕';
      remove.setAttribute('aria-label', `Remove ${layer.name}`);
      remove.addEventListener('click', () => { layers.splice(index, 1); stopPreview(); render(); });
      const controls = document.createElement('div');
      controls.className = 'record-layer-controls';
      const volume = document.createElement('input');
      volume.type = 'range';
      volume.min = '0'; volume.max = '1'; volume.step = '0.05';
      volume.value = String(layer.volume);
      volume.addEventListener('input', () => { layer.volume = Number(volume.value); stopPreview(); });
      const start = document.createElement('input');
      start.type = 'number';
      start.min = '0'; start.max = '600'; start.step = '0.1';
      start.value = String(layer.start);
      start.addEventListener('change', () => { layer.start = Math.max(0, Math.min(600, Number(start.value) || 0)); start.value = String(layer.start); stopPreview(); });
      const vLabel = document.createElement('label');
      vLabel.append('Volume', volume);
      const sLabel = document.createElement('label');
      sLabel.append('Starts at', start, 's');
      controls.append(vLabel, sLabel);
      row.append(name, remove, controls);
      list.appendChild(row);
    });

    const add = $('#record-add-layer');
    add.textContent = '';
    const first = document.createElement('option');
    first.value = '';
    first.textContent = layers.length >= VoiceEdit.MAX_LAYERS ? `Up to ${VoiceEdit.MAX_LAYERS} sounds` : '+ Add a sound…';
    add.appendChild(first);
    for (const sound of sounds) {
      const o = document.createElement('option');
      o.value = sound.id;
      o.textContent = sound.name;
      add.appendChild(o);
    }
    add.disabled = layers.length >= VoiceEdit.MAX_LAYERS || !sounds.length;
  }

  async function addLayer(id) {
    const sound = sounds.find((s) => s.id === id);
    if (!sound || layers.length >= VoiceEdit.MAX_LAYERS) return;
    try {
      const buffer = await VoiceEdit.decode(soundUrl(sound), voiceRate);
      layers.push({ soundId: sound.id, name: sound.name, volume: 0.6, start: 0, buffer });
    } catch {
      toast(`Couldn’t read “${sound.name}”.`, true);
    }
    stopPreview();
    render();
  }

  // The file to listen to and save: the recording, or the recording edited.
  async function currentWav() {
    if (!hasEdits()) return { wav, url: previewUrl };
    const key = editKey();
    if (edited && edited.key === key) return edited;
    rendering = true;
    render();
    try {
      const out = await VoiceEdit.render({ voice, sampleRate: voiceRate, effect, layers });
      const data = AudioUtils.encodeWav([out], voiceRate);
      if (edited) URL.revokeObjectURL(edited.url);
      edited = { key, wav: data, url: URL.createObjectURL(new Blob([data], { type: 'audio/wav' })) };
      return edited;
    } finally {
      rendering = false;
      render();
    }
  }

  function drawMeter() {
    const canvas = $('#record-meter');
    const scale = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth || 360;
    const h = canvas.clientHeight || 54;
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    const bar = Math.max(2, w / BARS - 3);
    const color = phase === 'recording' ? 'rgba(255,59,48,0.8)' : getComputedStyle(document.documentElement).getPropertyValue('--muted');
    ctx.fillStyle = color;
    if (phase !== 'recording') ctx.globalAlpha = 0.35;
    levels.forEach((level, i) => {
      const height = Math.max(3, h * level);
      ctx.beginPath();
      ctx.roundRect(i * (bar + 3), (h - height) / 2, bar, height, 1.5);
      ctx.fill();
    });
  }

  function meter() {
    frame = 0;
    if (phase !== 'recording' || !analyser) return;
    const data = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += v * v;
    const db = 20 * Math.log10(Math.sqrt(sum / data.length) || 1e-6);
    // -50 dB and below is silence, as on the iPad.
    levels = [...levels.slice(1), Math.max(0, Math.min(1, (db + 50) / 50))];
    elapsed = (performance.now() - startedAt) / 1000;
    if (elapsed >= MAX_SECONDS) { stop(); return; }
    render();
    frame = requestAnimationFrame(meter);
  }

  async function start() {
    stopPreview();
    try {
      if (!(await api.micAccess())) throw new Error('denied');
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch {
      toast('Dungeon Radio can’t use the microphone. Allow it in System Settings → Privacy & Security → Microphone.', true);
      return;
    }
    context = new AudioContext();
    analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    chunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.addEventListener('dataavailable', (e) => { if (e.data.size) chunks.push(e.data); });
    mediaRecorder.addEventListener('stop', finish, { once: true });
    mediaRecorder.start(250);
    phase = 'recording';
    startedAt = performance.now();
    elapsed = 0;
    levels = new Array(BARS).fill(0);
    render();
    frame = requestAnimationFrame(meter);
  }

  function release() {
    cancelAnimationFrame(frame);
    frame = 0;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    context?.close().catch(() => {});
    context = null;
    analyser = null;
  }

  function stop() {
    if (phase !== 'recording') return;
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    release();
  }

  // Turns the recording into a mono WAV file.
  async function finish() {
    const blob = new Blob(chunks, { type: mediaRecorder?.mimeType || 'audio/webm' });
    mediaRecorder = null;
    chunks = [];
    if (elapsed < 0.2 || !blob.size) { phase = 'idle'; render(); return; }
    try {
      const decoder = new AudioContext();
      const audio = await decoder.decodeAudioData(await blob.arrayBuffer());
      decoder.close().catch(() => {});
      const mono = new Float32Array(audio.length);
      for (let c = 0; c < audio.numberOfChannels; c++) {
        const data = audio.getChannelData(c);
        for (let i = 0; i < data.length; i++) mono[i] += data[i] / audio.numberOfChannels;
      }
      wav = AudioUtils.encodeWav([mono], audio.sampleRate);
      voice = mono;
      voiceRate = audio.sampleRate;
      // A new take: the edit (kept) is applied to it afresh.
      if (edited) URL.revokeObjectURL(edited.url);
      edited = null;
      elapsed = audio.duration;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
      phase = 'recorded';
    } catch {
      phase = 'idle';
      toast('Couldn’t read the recording.', true);
    }
    render();
  }

  function stopPreview() {
    if (preview) { preview.pause(); preview = null; }
  }

  async function togglePreview() {
    if (preview && !preview.paused) { stopPreview(); render(); return; }
    if (!previewUrl || rendering) return;
    let current;
    try { current = await currentWav(); } catch { toast('Couldn’t apply the edit.', true); return; }
    preview = new Audio(current.url);
    preview.addEventListener('ended', () => { preview = null; render(); });
    preview.play().catch(() => {});
    render();
  }

  function reset() {
    stop();
    release();
    stopPreview();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    wav = null;
    voice = null;
    effect = null;
    layers = [];
    if (edited) URL.revokeObjectURL(edited.url);
    edited = null;
    phase = 'idle';
    elapsed = 0;
    levels = new Array(BARS).fill(0);
  }

  async function save() {
    if (phase !== 'recorded' || !wav || rendering) return;
    stopPreview();
    const name = $('#record-name').value.trim() || 'Recording';
    try {
      const { wav: data } = await currentWav();
      const added = await api.add({ name, data, ext: 'wav' });
      reset();
      dialog.close();
      await afterAdding([added]);
    } catch (err) {
      // A free-version limit opens the Premium screen; the recording stays here.
      toast(err && err.premiumLimit ? err.message : 'Couldn’t save the recording.', true);
    }
  }

  function open() {
    reset();
    $('#record-name').value = `Recording ${sounds.length + 1}`;
    dialog.showModal();
    render();
  }

  $('#record-btn').addEventListener('click', open);
  $('#record-toggle').addEventListener('click', () => (phase === 'recording' ? stop() : start()));
  $('#record-listen').addEventListener('click', togglePreview);
  $('#record-add-layer').addEventListener('change', (e) => { const id = e.target.value; e.target.value = ''; if (id) addLayer(id); });
  $('#record-save').addEventListener('click', (e) => { e.preventDefault(); save(); });
  $('#record-cancel').addEventListener('click', () => { reset(); dialog.close(); });
  dialog.addEventListener('cancel', reset);

  return { open, phase: () => phase };
})();
