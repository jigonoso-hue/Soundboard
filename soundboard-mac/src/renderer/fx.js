/* global window, AudioContext */
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
    const key = `${seconds}:${decay}`;
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

  // Builds an effect's nodes. Returns { input, output, tail } where tail is
  // how long (seconds) it keeps sounding after the sound stops.
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
      default:
        input.connect(output);
        return { input, output, tail: 0 };
    }
  }

  // Call before the element's src is set: Web Audio only hears a cross-origin
  // sound that was loaded with CORS.
  function prepare(audio, id) {
    if (!byId.has(id)) return false;
    audio.crossOrigin = 'anonymous';
    return true;
  }

  // Routes an <audio> element through an effect.
  function attach(audio, id) {
    if (!byId.has(id) || audio.fx) return;
    try {
      context();
      const source = ctx.createMediaElementSource(audio);
      const chain = build(id);
      source.connect(chain.input);
      chain.output.connect(ctx.destination);
      audio.fx = { id, source, chain };
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
      try { fx.source.disconnect(); fx.chain.output.disconnect(); } catch { /* already gone */ }
    }, (fx.chain.tail + 0.5) * 1000);
  }

  function setOutputDevice(id) {
    sinkId = id || '';
    if (ctx && ctx.setSinkId) ctx.setSinkId(sinkId).catch(() => {});
  }

  const valid = (id) => (byId.has(id) ? id : null);

  window.Fx = { EFFECTS, get: (id) => byId.get(id) || null, valid, prepare, attach, release, setOutputDevice };
})();
