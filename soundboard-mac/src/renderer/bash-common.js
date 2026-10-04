/* global window, document, AudioContext, Icons */
// Shared by the main board and the bash editor windows: bash playback,
// waveform peaks and cover rendering.
(function (root) {
  const ICONS = ['crossed-swords', 'dragon', 'mug', 'flame', 'pine', 'castle', 'skull', 'wave', 'bolt', 'd20', 'wizard-hat', 'moon', 'crown', 'candle', 'dagger', 'shield', 'paw', 'ghost', 'storm', 'lute'];
  const ICON_COLORS = ['#7c6cff', '#ff5d73', '#ffb347', '#6ee7b7', '#5ec8ff', '#d58bff', '#8a6a4f', '#3f4a5a'];

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
      this.master.gain.value = typeof prefs.master === 'number' ? prefs.master : 1;
      if (this.ctx.setSinkId) this.ctx.setSinkId(prefs.outputDevice || '').catch(() => {});
    }

    onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
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
      return end;
    }

    async play(bash, sounds, from = 0) {
      this.stop(false);
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
      const active = { bashId: bash.id, runId: `${Date.now().toString(36)}-${++this.runs}`, sources: [], startedAt, from, duration: 0, voices: [] };
      for (const { clip, sound, buffer } of entries) {
        active.duration = Math.max(active.duration, clipEnd(clip, buffer.duration));
        const gain = this.ctx.createGain();
        gain.gain.value = clip.volume * (sound.volume ?? 1);
        gain.connect(this.master);
        // Each voice schedules its plays: once, or repeatedly every (length + gap).
        const period = buffer.duration + (clip.repeat ? clip.repeat.gap : 0);
        const plays = clip.repeat ? (clip.repeat.times || Infinity) : 1;
        // Skip plays that finished before `from`.
        let index = clip.offset >= from || period <= 0 ? 0 : Math.floor((from - clip.offset) / period);
        if (index > 0 && from - (clip.offset + index * period) >= buffer.duration) index++;
        active.voices.push({ buffer, gain, period, plays, offset: clip.offset, index, sound, volume: gain.gain.value });
        active.sources.push({ gain, source: null });
      }
      this.active = active;
      this.schedule();
      // Keep scheduling repeats a little ahead of time while playing.
      this.scheduler = setInterval(() => this.schedule(), 200);
      this.emit();
      clearTimeout(this.endTimer);
      if (Number.isFinite(active.duration)) {
        this.endTimer = setTimeout(() => {
          if (this.active === active) this.stop();
        }, Math.max(0, active.duration - from) * 1000 + 150);
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
          const when = active.startedAt + (start - active.from);
          if (when > horizon) break;
          const into = Math.max(0, active.from - start);
          if (into < voice.buffer.duration) {
            const source = this.ctx.createBufferSource();
            source.buffer = voice.buffer;
            source.connect(voice.gain);
            const startAt = Math.max(when, this.ctx.currentTime);
            source.start(startAt, into);
            if (this.onSchedule) {
              this.onSchedule({
                runId: active.runId,
                sound: voice.sound,
                at: Date.now() + (startAt - this.ctx.currentTime - into) * 1000,
                volume: voice.volume * this.master.gain.value,
                dur: voice.buffer.duration,
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

  // When a clip's last play ends, in bash time (Infinity if it repeats until stopped).
  function clipEnd(clip, length) {
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
    el.appendChild(Icons.el(icon, { size: 24, color: bash.cover.iconColor || '#ffffff', className: 'cover-icon' }));
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

  root.BashCommon = { ICONS, ICON_COLORS, BashPlayer, renderCover, peaks, readPrefs, clipEnd };
})(window);
