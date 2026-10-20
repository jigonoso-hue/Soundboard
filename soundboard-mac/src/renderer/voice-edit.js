/* global window, OfflineAudioContext, fetch, Fx */
// Editing a recording before it's saved (recorder.js): a voice effect (Fx.VOICE)
// and other sounds mixed in, each with its own volume and start time. The
// edit is rendered offline into the mono recording that gets saved, so it
// plays the same everywhere, Live Session listeners included.
// The iPhone/iPad app does the same in Audio/VoiceEdit.swift.
(function () {
  const MAX_SECONDS = 660; // ten minutes of recording, plus room for an echo or a long sound
  const MAX_LAYERS = 4;

  // A library sound's audio, decoded at the recording's sample rate.
  async function decode(url, sampleRate) {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Couldn’t read that sound.');
    const bytes = await response.arrayBuffer();
    return new OfflineAudioContext(1, 1, sampleRate).decodeAudioData(bytes);
  }

  // voice: the recording (Float32Array, mono). effect: a Fx.VOICE id or null.
  // layers: [{ buffer: AudioBuffer, volume 0…1, start seconds }].
  // Resolves to a Float32Array (mono), kept below clipping.
  async function render({ voice, sampleRate, effect = null, layers = [] }) {
    const probe = effect ? Fx.chain(new OfflineAudioContext(1, 1, sampleRate), effect) : { tail: 0, rate: 1 };
    const voiceSeconds = voice.length / sampleRate / probe.rate + probe.tail;
    const layerSeconds = Math.max(0, ...layers.map((l) => l.start + l.buffer.duration));
    const seconds = Math.min(MAX_SECONDS, Math.max(voiceSeconds, layerSeconds));
    const ctx = new OfflineAudioContext(1, Math.max(1, Math.ceil(seconds * sampleRate)), sampleRate);

    const recording = ctx.createBuffer(1, voice.length, sampleRate);
    recording.copyToChannel(voice, 0);
    const source = ctx.createBufferSource();
    source.buffer = recording;
    if (effect) {
      const chain = Fx.chain(ctx, effect);
      source.playbackRate.value = chain.rate;
      source.connect(chain.input);
      chain.output.connect(ctx.destination);
      for (const s of chain.sources) s.start(0);
    } else {
      source.connect(ctx.destination);
    }
    source.start(0);

    for (const layer of layers.slice(0, MAX_LAYERS)) {
      const s = ctx.createBufferSource();
      s.buffer = layer.buffer;
      const gain = ctx.createGain();
      gain.gain.value = Math.max(0, Math.min(1, layer.volume));
      s.connect(gain);
      gain.connect(ctx.destination);
      s.start(Math.max(0, Math.min(MAX_SECONDS, layer.start)));
    }

    const rendered = await ctx.startRendering();
    const out = rendered.getChannelData(0);
    // Mixing can go over full scale: bring the peak back under it.
    let peak = 0;
    for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
    if (peak > 0.98) {
      const scale = 0.98 / peak;
      for (let i = 0; i < out.length; i++) out[i] *= scale;
    }
    return out;
  }

  window.VoiceEdit = { render, decode, MAX_LAYERS };
})();
