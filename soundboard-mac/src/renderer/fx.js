/* global window, AudioContext, OfflineAudioContext */
// Sound effects a scene kit can put on the sounds it plays: Distant room,
// Empty echo, Old radio and Underwater. An effected sound still plays through
// its own <audio> element (so its volume, fades, repeats and progress work as
// before), but the element's output is routed through Web Audio filters.
// The iPhone/iPad app builds the same effects in Audio/SoundEffects.swift;
// keep the two in step.
(function () {
  const EFFECTS = [
    { id: 'distant', name: 'Distant room', icon: 'gate', hint: 'Muffled, through a wall' },
    { id: 'echo', name: 'Empty echo', icon: 'cave', hint: 'A big empty hall' },
    { id: 'radio', name: 'Old radio', icon: 'speaker', hint: 'Thin and crackly' },
    { id: 'underwater', name: 'Underwater', icon: 'wave', hint: 'Deep and murky' },
  ];
  const byId = new Map(EFFECTS.map((e) => [e.id, e]));
  // Voice effects for a recording (recorder.js, voice-edit.js), baked into the
  // saved file. The iPhone/iPad app's are in Audio/VoiceEdit.swift.
  const VOICE = [
    { id: 'radio', name: 'Radio', hint: 'Thin and crackly' },
    { id: 'static', name: 'Static', hint: 'A hissing, crackling line' },
    { id: 'distorted', name: 'Distorted', hint: 'Blown out and harsh' },
    { id: 'robot', name: 'Robot', hint: 'Metallic and buzzing' },
    { id: 'ghost', name: 'Ghost', hint: 'Airy, wavering, far off' },
    { id: 'demon', name: 'Demon', hint: 'Deep, slow and growling' },
    { id: 'distant', name: 'Distant room', hint: 'Muffled, through a wall' },
    { id: 'echo', name: 'Empty echo', hint: 'A big empty hall' },
    { id: 'underwater', name: 'Underwater', hint: 'Deep and murky' },
    { id: 'cave', name: 'Cave', hint: 'Dark, dripping echoes' },
    { id: 'megaphone', name: 'Megaphone', hint: 'Loud, thin and crunchy' },
    { id: 'warble', name: 'Warble', hint: 'Wobbling pitch and volume' },
    { id: 'fairy', name: 'Fairy', hint: 'Faster, higher and sparkling' },
  ];
  // Every effect, for bash clips and Live Session plays (kit effects are VOICE ones too).
  const allById = new Map(VOICE.map((e) => [e.id, e]));

  let ctx = null;
  let sinkId = '';
  const impulses = new Map();

  function context() {
    if (!ctx) {
      ctx = new AudioContext();
      if (sinkId && ctx.setSinkId) ctx.setSinkId(sinkId).catch(() => {});
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  // A room's echo: stereo noise that dies away over `seconds`.
  function impulse(seconds, decay) {
    const key = `${ctx.sampleRate}:${seconds}:${decay}`;
    if (impulses.has(key)) return impulses.get(key);
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * seconds);
    const buffer = ctx.createBuffer(2, length, rate);
    for (let c = 0; c < 2; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
    impulses.set(key, buffer);
    return buffer;
  }

  function filter(type, frequency, q = 0.7, gain = 0) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = q;
    f.gain.value = gain;
    return f;
  }

  function level(value) {
    const g = ctx.createGain();
    g.gain.value = value;
    return g;
  }

  // Connects a → b → c … and returns the first and last.
  function series(...nodes) {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
    return [nodes[0], nodes[nodes.length - 1]];
  }

  // A reverb send: input → convolver → wet gain → out.
  function reverb(input, out, seconds, decay, wet) {
    const conv = ctx.createConvolver();
    conv.buffer = impulse(seconds, decay);
    series(input, conv, level(wet), out);
  }

  // A waveshaper that clips softly; `drive` is how hard.
  function shaper(drive, oversample = '2x') {
    const node = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
    }
    node.curve = curve;
    node.oversample = oversample;
    return node;
  }

  function oscillator(frequency, type = 'sine') {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = frequency;
    return osc;
  }

  // Builds an effect's nodes. Returns { input, output, tail, sources, rate }:
  // tail is how long (seconds) it keeps sounding after the sound stops,
  // sources are oscillators and noise to start with the sound, and rate is
  // how fast to play the sound itself (Demon is slower and deeper).
  function build(id) {
    const input = level(1);
    const output = level(1);
    switch (id) {
      case 'distant': {
        // Through a wall: the highs gone, a little of the room left.
        const [, muffled] = series(input, filter('highpass', 90), filter('lowpass', 420, 0.9), filter('lowpass', 900));
        series(muffled, level(0.75), output);
        reverb(muffled, output, 1.2, 3, 0.4);
        return { input, output, tail: 1.5 };
      }
      case 'echo': {
        // A big empty hall: repeats that fade, and a long reverb.
        series(input, level(0.75), output);
        const delay = ctx.createDelay(2);
        delay.delayTime.value = 0.38;
        const feedback = level(0.48);
        const dark = filter('lowpass', 2800);
        series(input, delay, dark, feedback, delay);
        series(dark, level(0.55), output);
        reverb(input, output, 3.5, 2.2, 0.38);
        return { input, output, tail: 5 };
      }
      case 'radio': {
        // A thin band of sound, a midrange bump and a little crunch.
        const shaper = ctx.createWaveShaper();
        const curve = new Float32Array(1024);
        for (let i = 0; i < curve.length; i++) {
          const x = (i / (curve.length - 1)) * 2 - 1;
          curve[i] = Math.tanh(x * 3) / Math.tanh(3);
        }
        shaper.curve = curve;
        shaper.oversample = '2x';
        series(input, filter('highpass', 480, 0.9), filter('lowpass', 3200, 0.9), filter('peaking', 1500, 1, 6), shaper, level(0.6), output);
        return { input, output, tail: 0.1 };
      }
      case 'underwater': {
        // Deep and murky: a low, resonant muffle in a wet space.
        const [, murk] = series(input, filter('lowpass', 340, 5), filter('lowpass', 700));
        series(murk, level(0.85), output);
        reverb(murk, output, 1.8, 2.5, 0.55);
        return { input, output, tail: 2 };
      }
      case 'static': {
        // A bad line: a narrow band of voice, a little crunch, hiss and crackle.
        series(input, filter('highpass', 350, 0.8), filter('lowpass', 3500, 0.8), shaper(2.5), level(0.85), output);
        const rate = ctx.sampleRate;
        const noise = ctx.createBuffer(1, rate * 2, rate);
        const data = noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.5 + (Math.random() < 0.0006 ? (Math.random() * 2 - 1) : 0);
        const hiss = ctx.createBufferSource();
        hiss.buffer = noise;
        hiss.loop = true;
        series(hiss, filter('bandpass', 2600, 0.6), level(0.09), output);
        return { input, output, tail: 0.3, sources: [hiss] };
      }
      case 'distorted': {
        // Blown out: driven hard into clipping, then tamed.
        series(input, filter('highpass', 120), shaper(25, '4x'), filter('lowpass', 4500), level(0.4), output);
        return { input, output, tail: 0.1 };
      }
      case 'robot': {
        // Ring modulation (the voice times a 55 Hz tone) and a short metallic comb.
        const ring = ctx.createGain();
        ring.gain.value = 0;
        const carrier = oscillator(55);
        carrier.connect(ring.gain);
        input.connect(ring);
        series(input, level(0.2), output);
        const comb = ctx.createDelay(0.1);
        comb.delayTime.value = 0.008;
        series(ring, comb, level(0.55), comb);
        series(ring, level(0.9), output);
        series(comb, level(0.5), output);
        return { input, output, tail: 0.3, sources: [carrier] };
      }
      case 'ghost': {
        // Airy and wavering: a thin, slowly bending double, deep in a long reverb.
        const [, thin] = series(input, filter('highpass', 260), filter('lowpass', 6000));
        series(thin, level(0.5), output);
        const wobble = ctx.createDelay(0.2);
        wobble.delayTime.value = 0.03;
        const lfo = oscillator(0.35);
        const depth = level(0.012);
        series(lfo, depth);
        depth.connect(wobble.delayTime);
        const late = ctx.createDelay(1);
        late.delayTime.value = 0.14;
        series(thin, wobble, level(0.6), output);
        series(thin, late, level(0.3), output);
        reverb(thin, output, 4, 1.6, 1.1);
        return { input, output, tail: 4, sources: [lfo] };
      }
      case 'cave': {
        // A deep cave: dark, long, with dripping echoes.
        const [, dark] = series(input, filter('highpass', 70), filter('lowpass', 2800));
        series(dark, level(0.6), output);
        const drip = ctx.createDelay(1);
        drip.delayTime.value = 0.27;
        const feedback = level(0.35);
        series(dark, drip, filter('lowpass', 1800), feedback, drip);
        series(feedback, level(0.8), output);
        reverb(dark, output, 3.5, 1.4, 0.9);
        return { input, output, tail: 4 };
      }
      case 'megaphone': {
        // Loud and thin: a narrow, shouty band, driven hard.
        series(input, filter('highpass', 700, 1), filter('lowpass', 2600, 1), filter('peaking', 1700, 1.2, 10), shaper(8), level(0.35), output);
        return { input, output, tail: 0.1 };
      }
      case 'warble': {
        // Wobbling: the pitch bends (a moving delay) and the volume pulses.
        const bend = ctx.createDelay(0.1);
        bend.delayTime.value = 0.008;
        const bendLfo = oscillator(5.5);
        const bendDepth = level(0.004);
        series(bendLfo, bendDepth);
        bendDepth.connect(bend.delayTime);
        const pulse = ctx.createGain();
        pulse.gain.value = 0.65;
        const pulseLfo = oscillator(7);
        const pulseDepth = level(0.35);
        series(pulseLfo, pulseDepth);
        pulseDepth.connect(pulse.gain);
        series(input, bend, pulse, output);
        return { input, output, tail: 0.1, sources: [bendLfo, pulseLfo] };
      }
      case 'fairy': {
        // Played faster (so higher), brightened, with a sparkling echo.
        const [, bright] = series(input, filter('highpass', 200), filter('highshelf', 3000, 0.7, 6));
        series(bright, level(0.8), output);
        const sparkle = ctx.createDelay(1);
        sparkle.delayTime.value = 0.09;
        const feedback = level(0.45);
        series(bright, sparkle, filter('highpass', 1200), feedback, sparkle);
        series(feedback, level(0.6), output);
        reverb(bright, output, 2.5, 2, 0.6);
        return { input, output, tail: 3, rate: 1.35 };
      }
      case 'demon': {
        // Played slower (so deeper), growled and darkened, in a stone room.
        const [, growl] = series(input, filter('lowpass', 2400), shaper(4), level(0.7));
        growl.connect(output);
        reverb(growl, output, 1.5, 2.5, 0.3);
        return { input, output, tail: 1.5, rate: 0.72 };
      }
      default:
        input.connect(output);
        return { input, output, tail: 0 };
    }
  }

  // Call before the element's src is set: Web Audio only hears a cross-origin
  // sound that was loaded with CORS.
  function prepare(audio, id) {
    if (!allById.has(id)) return false;
    audio.crossOrigin = 'anonymous';
    return true;
  }

  // Routes an <audio> element through an effect. amount (0…1) is how much
  // of it: the rest of the sound passes through as it is. An effect that
  // changes speed (Demon, Fairy) speeds the element up or down with it.
  function attach(audio, id, amount = 1) {
    if (!allById.has(id) || audio.fx) return;
    try {
      context();
      const source = ctx.createMediaElementSource(audio);
      const chain = { sources: [], rate: 1, ...build(id) };
      const mix = Math.max(0, Math.min(1, Number(amount)));
      const wet = level(Number.isFinite(mix) ? mix : 1);
      const dry = level(Number.isFinite(mix) ? 1 - mix : 0);
      source.connect(chain.input);
      chain.output.connect(wet);
      wet.connect(ctx.destination);
      source.connect(dry);
      dry.connect(ctx.destination);
      if (chain.rate !== 1) {
        audio.preservesPitch = false;
        audio.playbackRate *= chain.rate;
      }
      // Oscillators and hiss run while the sound does.
      if (chain.sources.length) {
        audio.addEventListener('playing', () => {
          for (const s of chain.sources) { try { s.start(); } catch { /* started */ } }
        }, { once: true });
      }
      audio.fx = { id, source, chain, wet, dry };
    } catch {
      // Without Web Audio the sound still plays, just without the effect.
    }
  }

  // Lets the effect's echo die away, then disconnects it.
  function release(audio) {
    const fx = audio && audio.fx;
    if (!fx) return;
    audio.fx = null;
    setTimeout(() => {
      try { fx.source.disconnect(); fx.chain.output.disconnect(); fx.dry.disconnect(); } catch { /* already gone */ }
      for (const s of fx.chain.sources) { try { s.stop(); } catch { /* never started */ } }
    }, (fx.chain.tail + 0.5) * 1000);
  }

  function setOutputDevice(id) {
    sinkId = id || '';
    if (ctx && ctx.setSinkId) ctx.setSinkId(sinkId).catch(() => {});
  }

  const valid = (id) => (byId.has(id) ? id : null);
  // Any effect (bash clips, Live Session plays), or null.
  const validAny = (id) => (allById.has(id) ? id : null);
  // How long an effect rings on after its sound ends, and how it changes speed.
  const infos = new Map();
  const info = (id) => {
    if (!allById.has(id)) return { tail: 0, rate: 1 };
    if (!infos.has(id)) {
      const probe = chain(new OfflineAudioContext(1, 1, 44100), id);
      infos.set(id, { tail: probe.tail, rate: probe.rate });
    }
    return infos.get(id);
  };

  // An effect's nodes on another context (an OfflineAudioContext rendering a recording).
  function chain(context, id) {
    const saved = ctx;
    ctx = context;
    try { return { sources: [], rate: 1, ...build(id) }; } finally { ctx = saved; }
  }

  window.Fx = { EFFECTS, VOICE, chain, validAny, info, get: (id) => byId.get(id) || null, valid, prepare, attach, release, setOutputDevice };
})();
