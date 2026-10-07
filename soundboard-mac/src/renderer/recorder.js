/* global api, $, toast, AudioUtils, afterAdding, sounds */
// Record a Sound: record with the microphone, listen back, name it and save it
// to the library as a WAV file (which every device in a Live Session can
// play). Matches the iPad app's RecorderView.
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
    $('#record-listen').textContent = preview && !preview.paused ? '■ Stop' : '▶ Listen';
    drawMeter();
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

  function togglePreview() {
    if (preview && !preview.paused) { stopPreview(); render(); return; }
    if (!previewUrl) return;
    preview = new Audio(previewUrl);
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
    phase = 'idle';
    elapsed = 0;
    levels = new Array(BARS).fill(0);
  }

  async function save() {
    if (phase !== 'recorded' || !wav) return;
    stopPreview();
    const name = $('#record-name').value.trim() || 'Recording';
    try {
      const added = await api.add({ name, data: wav, ext: 'wav' });
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
  $('#record-save').addEventListener('click', (e) => { e.preventDefault(); save(); });
  $('#record-cancel').addEventListener('click', () => { reset(); dialog.close(); });
  dialog.addEventListener('cancel', reset);

  return { open, phase: () => phase };
})();
