/* global window, document, AudioContext, Icons, Fx */
// Shared by the main board and the bash editor windows: bash playback,
// waveform peaks and cover rendering.
(function (root) {
  const ICONS = ['crossed-swords', 'dragon', 'mug', 'flame', 'pine', 'castle', 'skull', 'wave', 'bolt', 'd20', 'wizard-hat', 'moon', 'crown', 'candle', 'dagger', 'shield', 'paw', 'ghost', 'storm', 'lute'];
  const ICON_COLORS = ['#7c6cff', '#ff5d73', '#ffb347', '#6ee7b7', '#5ec8ff', '#d58bff', '#8a6a4f', '#3f4a5a'];
  // The shortest part of a sound a trimmed clip keeps (as in src/bashes.js).
  const MIN_TRIM = 0.02;

  function readPrefs() {
    try { return JSON.parse(localStorage.getItem('prefs') || '{}'); } catch { return {}; }
  }

  // Plays bashes with sample-accurate offsets: every clip is scheduled
  // against the same AudioContext clock.
  class BashPlayer {
    constructor(api) {
      this.api = api;
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.buffers = new Map(); // `${soundId}:${file}` -> Promise<AudioBuffer>
      this.active = null; // { bashId, sources, startedAt, from, duration }
      this.listeners = new Set();
      // Live Session hooks (main board only): onSchedule({ runId, sound, at, volume, dur })
      // for every clip play, with `at` the wall-clock time (ms) of the clip's start;
      // onStop(runId) when the bash stops.
      this.onSchedule = null;
      this.onStop = null;
      this.runs = 0;
      this.applyPrefs();
    }

    applyPrefs() {
      const prefs = readPrefs();
      // gain: a scene kit section's volume slider, for the bash playing from it.
      this.master.gain.value = (typeof prefs.master === 'number' ? prefs.master : 1) * (this.gain ?? 1);
      if (this.ctx.setSinkId) this.ctx.setSinkId(prefs.outputDevice || '').catch(() => {});
    }

    onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

    // A scene kit section's volume slider moved while its bash plays.
    setGain(gain) {
      this.gain = gain;
      this.applyPrefs();
    }
    emit() { for (const fn of this.listeners) fn(this.state()); }

    buffer(sound) {
      const key = `${sound.id}:${sound.file}`;
      if (!this.buffers.has(key)) {
        this.buffers.set(key, this.api.readSound(sound.id)
          .then((bytes) => this.ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)))
          .catch((err) => { this.buffers.delete(key); throw err; }));
      }
      return this.buffers.get(key);
    }

    // Length of the whole bash in seconds (needs the clips' sounds decoded).
    // Infinity when a clip repeats until stopped.
    async duration(bash, sounds) {
      let end = 0;
      for (const clip of bash.clips) {
        const sound = sounds.find((s) => s.id === clip.soundId);
        if (!sound) continue;
        try { end = Math.max(end, clipEnd(clip, (await this.buffer(sound)).duration)); } catch { /* skip */ }
      }
      return Math.min(end, bashLimit(bash));
    }

    async play(bash, sounds, from = 0, gain = 1) {
      this.stop(false);
      this.gain = gain;
      this.applyPrefs();
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      const token = {};
      this.pending = token;

      const entries = [];
      for (const clip of bash.clips) {
        const sound = sounds.find((s) => s.id === clip.soundId);
        if (!sound) continue;
        try { entries.push({ clip, sound, buffer: await this.buffer(sound) }); } catch { /* unreadable sound */ }
      }
      if (this.pending !== token) return; // another play/stop happened while decoding

      const startedAt = this.ctx.currentTime + 0.05;
      // A bash with its own length stops there, whatever is still playing.
      const limit = bashLimit(bash);
      const active = { bashId: bash.id, runId: `${Date.now().toString(36)}-${++this.runs}`, sources: [], startedAt, from, duration: 0, tail: 0, voices: [], limit };
      for (const { clip, sound, buffer } of entries) {
        active.duration = Math.max(active.duration, clipEnd(clip, buffer.duration));
        const gain = this.ctx.createGain();
        gain.gain.value = clip.volume * (sound.volume ?? 1);
        gain.connect(this.master);
        // Squashed or pulled clips play faster or slower (and higher or lower),
        // and an effect (some change speed too) rings on for its tail.
        const fx = clip.fx && typeof Fx !== 'undefined' ? Fx.validAny(clip.fx) : null;
        const fxInfo = fx ? Fx.info(fx) : { tail: 0, rate: 1 };
        const rate = clipRate(clip);
        // A trimmed clip plays only part of its sound.
        const span = clipSpan(clip, buffer.duration);
        const length = (span.end - span.start) / rate;
        active.tail = Math.max(active.tail, fxInfo.tail);
        // Each voice schedules its plays: once, or repeatedly every (length + gap).
        const period = length + (clip.repeat ? clip.repeat.gap : 0);
        const plays = clip.repeat ? (clip.repeat.times || Infinity) : 1;
        // Skip plays that finished before `from`.
        let index = clip.offset >= from || period <= 0 ? 0 : Math.floor((from - clip.offset) / period);
        if (index > 0 && from - (clip.offset + index * period) >= length) index++;
        active.voices.push({
          buffer, gain, period, plays, offset: clip.offset, index, sound, volume: gain.gain.value,
          rate, speed: rate / fxInfo.rate, length, span, endsEarly: span.end < buffer.duration - 0.001, fx, fxAmount: fx ? Math.max(0, Math.min(1, clip.fxAmount ?? 1)) : 0, tail: fxInfo.tail,
        });
        active.sources.push({ gain, source: null });
      }
      const natural = active.duration;
      active.duration = Math.min(natural, limit);
      this.active = active;
      this.schedule();
      // Keep scheduling repeats a little ahead of time while playing.
      this.scheduler = setInterval(() => this.schedule(), 200);
      this.emit();
      clearTimeout(this.endTimer);
      if (Number.isFinite(active.duration)) {
        // Cut at the bash's length (echoes too), or let the last echo ring out.
        const cut = limit <= natural;
        this.endTimer = setTimeout(() => {
          if (this.active === active) this.stop();
        }, (Math.max(0, active.duration - from) + (cut ? 0 : active.tail)) * 1000 + (cut ? 30 : 150));
      }
    }

    // Starts every play due within the next second.
    schedule() {
      const active = this.active;
      if (!active) return;
      const horizon = this.ctx.currentTime + 1;
      for (const voice of active.voices) {
        while (voice.index < voice.plays) {
          const start = voice.offset + voice.index * voice.period; // bash time
          if (start >= active.limit) { voice.index = voice.plays; break; } // after the bash's end
          const when = active.startedAt + (start - active.from);
          if (when > horizon) break;
          const into = Math.max(0, active.from - start); // bash seconds
          // Bash seconds this play sounds for: to its (trimmed) end, or the bash's end.
          const cut = start + voice.length > active.limit;
          const playFor = (cut ? active.limit - start : voice.length) - into;
          if (playFor > 0.001) {
            const source = this.ctx.createBufferSource();
            source.buffer = voice.buffer;
            source.playbackRate.value = voice.rate;
            const startAt = Math.max(when, this.ctx.currentTime);
            // A play that starts or stops part-way through its sound fades over a few
            // milliseconds, so the cut doesn't click.
            let out = source;
            if (voice.span.start > 0 || into > 0 || voice.endsEarly || cut) {
              const env = this.ctx.createGain();
              const edge = Math.min(0.006, playFor / 4);
              env.gain.setValueAtTime(0, startAt);
              env.gain.linearRampToValueAtTime(1, startAt + edge);
              env.gain.setValueAtTime(1, startAt + playFor - edge);
              env.gain.linearRampToValueAtTime(0, startAt + playFor);
              source.connect(env);
              out = env;
            }
            if (voice.fx) {
              // Each play gets its own effect, so its echo and hiss belong to it.
              const chain = Fx.chain(this.ctx, voice.fx);
              const wet = this.ctx.createGain();
              const dry = this.ctx.createGain();
              wet.gain.value = voice.fxAmount;
              dry.gain.value = 1 - voice.fxAmount;
              out.connect(dry);
              dry.connect(voice.gain);
              out.connect(chain.input);
              chain.output.connect(wet);
              wet.connect(voice.gain);
              for (const s of chain.sources) {
                s.start(startAt);
                s.stop(startAt + playFor + chain.tail);
              }
            } else {
              out.connect(voice.gain);
            }
            source.start(startAt, voice.span.start + into * voice.rate, playFor * voice.rate);
            if (this.onSchedule) {
              const at = Date.now() + (startAt - this.ctx.currentTime - into) * 1000;
              this.onSchedule({
                runId: active.runId,
                sound: voice.sound,
                at,
                volume: voice.volume * this.master.gain.value,
                dur: into + playFor,
                // Trimmed: where in the sound it starts, and when it stops if before the sound's end.
                from: voice.span.start,
                stopAt: voice.endsEarly || cut ? at + (into + playFor) * 1000 : null,
                // The clip's own speed: listeners add the effect's (Demon, Fairy) themselves.
                rate: Math.round(voice.speed * 1000) / 1000,
                fx: voice.fx,
                fxAmount: voice.fxAmount,
              });
            }
            active.sources.push({ source, gain: voice.gain });
            source.onended = () => {
              const i = active.sources.findIndex((x) => x.source === source);
              if (i >= 0) active.sources.splice(i, 1);
            };
          }
          voice.index++;
        }
      }
    }

    stop(emit = true) {
      this.pending = null;
      clearTimeout(this.endTimer);
      clearInterval(this.scheduler);
      if (this.active) {
        if (this.onStop) this.onStop(this.active.runId);
        const now = this.ctx.currentTime;
        for (const { source, gain } of this.active.sources) {
          // Tiny fade so stopping mid-sound doesn't click.
          gain.gain.setTargetAtTime(0, now, 0.01);
          if (source) { try { source.stop(now + 0.06); } catch { /* not started */ } }
        }
        this.active = null;
      }
      if (emit) this.emit();
    }

    // { bashId, position (s), duration } while playing, else null.
    state() {
      if (!this.active) return null;
      const { bashId, startedAt, from, duration } = this.active;
      return { bashId, position: from + Math.max(0, this.ctx.currentTime - startedAt), duration };
    }
  }

  // How fast a clip plays: squashed or pulled on the timeline, times its
  // effect's own speed (Demon is slower, Fairy faster).
  function clipRate(clip) {
    const speed = Number(clip.speed) > 0 ? Number(clip.speed) : 1;
    const fxRate = clip.fx && typeof Fx !== 'undefined' && Fx.validAny(clip.fx) ? Fx.info(clip.fx).rate : 1;
    return speed * fxRate;
  }

  // The part of its sound a clip plays, in seconds into the sound: all of it,
  // or what's left between its trims.
  function clipSpan(clip, soundLength) {
    const start = Math.min(Math.max(0, Number(clip.trimStart) || 0), Math.max(0, soundLength - MIN_TRIM));
    const end = Number(clip.trimEnd) > 0 ? Math.min(soundLength, Math.max(start + MIN_TRIM, Number(clip.trimEnd))) : soundLength;
    return { start, end };
  }

  // How long one play of a clip lasts, in bash seconds: its trimmed part, at its speed.
  function clipLength(clip, soundLength) {
    const { start, end } = clipSpan(clip, soundLength);
    return (end - start) / clipRate(clip);
  }

  // Where a bash with its own length stops (Infinity when it has none).
  function bashLimit(bash) {
    const length = Number(bash && bash.length);
    return length > 0 ? length : Infinity;
  }

  // When a clip's last play ends, in bash time (Infinity if it repeats until stopped).
  // soundLength: the sound's own length; trims and speed change how long it lasts.
  function clipEnd(clip, soundLength) {
    const length = clipLength(clip, soundLength);
    if (!clip.repeat) return clip.offset + length;
    if (!clip.repeat.times) return Infinity;
    return clip.offset + clip.repeat.times * length + (clip.repeat.times - 1) * clip.repeat.gap;
  }

  // Fills `el` with the bash's cover: an uploaded image or an icon on a colour.
  const coverCache = new Map();
  async function renderCover(el, bash, api) {
    el.textContent = '';
    el.style.backgroundImage = '';
    if (bash.cover.type === 'image') {
      el.style.background = '#222';
      let url = coverCache.get(bash.cover.file);
      if (url === undefined) {
        url = await api.bashes.coverData(bash.cover.file);
        coverCache.set(bash.cover.file, url);
      }
      if (url) {
        el.style.background = `center / cover no-repeat url("${url}")`;
        return;
      }
    }
    const icon = bash.cover.icon || ICONS[0];
    const color = bash.cover.color || ICON_COLORS[0];
    el.style.background = `linear-gradient(140deg, ${color}, color-mix(in srgb, ${color} 45%, #111))`;
    el.appendChild(Icons.el(icon, { size: 24, color: bash.cover.iconColor || '#ffffff', className: 'cover-icon', art: true }));
  }

  // Min/max peaks for drawing a waveform `columns` wide.
  function peaks(buffer, columns) {
    const data = buffer.getChannelData(0);
    const second = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
    const out = new Float32Array(columns * 2);
    const step = data.length / columns;
    for (let c = 0; c < columns; c++) {
      let min = 0;
      let max = 0;
      const start = Math.floor(c * step);
      const end = Math.min(data.length, Math.floor((c + 1) * step));
      for (let i = start; i < end; i += Math.max(1, Math.floor((end - start) / 200))) {
        const v = second ? (data[i] + second[i]) / 2 : data[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      out[c * 2] = min;
      out[c * 2 + 1] = max;
    }
    return out;
  }

  root.BashCommon = { ICONS, ICON_COLORS, MIN_TRIM, BashPlayer, renderCover, peaks, readPrefs, clipEnd, clipRate, clipSpan, clipLength, bashLimit };
})(window);
