/* global window, document, AudioContext */
// Shared by the main board and the bash editor windows: bash playback,
// waveform peaks and cover rendering.
(function (root) {
  const ICONS = ['⚔️', '🐉', '🍺', '🔥', '🌲', '🏰', '💀', '🌊', '⚡', '🎲', '🧙', '🌙', '👑', '🕯️', '🗡️', '🛡️', '🐺', '👻', '⛈️', '🎻'];
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
    async duration(bash, sounds) {
      let end = 0;
      for (const clip of bash.clips) {
        const sound = sounds.find((s) => s.id === clip.soundId);
        if (!sound) continue;
        try { end = Math.max(end, clip.offset + (await this.buffer(sound)).duration); } catch { /* skip */ }
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
      const sources = [];
      let duration = 0;
      for (const { clip, sound, buffer } of entries) {
        duration = Math.max(duration, clip.offset + buffer.duration);
        const clipEnd = clip.offset + buffer.duration;
        if (clipEnd <= from) continue;
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        const gain = this.ctx.createGain();
        gain.gain.value = clip.volume * (sound.volume ?? 1);
        source.connect(gain).connect(this.master);
        const delay = Math.max(0, clip.offset - from);
        const into = Math.max(0, from - clip.offset);
        source.start(startedAt + delay, into);
        sources.push({ source, gain });
      }
      this.active = { bashId: bash.id, sources, startedAt, from, duration };
      this.emit();
      clearTimeout(this.endTimer);
      this.endTimer = setTimeout(() => {
        if (this.active && this.active.startedAt === startedAt) this.stop();
      }, Math.max(0, duration - from) * 1000 + 150);
    }

    stop(emit = true) {
      this.pending = null;
      clearTimeout(this.endTimer);
      if (this.active) {
        const now = this.ctx.currentTime;
        for (const { source, gain } of this.active.sources) {
          // Tiny fade so stopping mid-sound doesn't click.
          gain.gain.setTargetAtTime(0, now, 0.01);
          try { source.stop(now + 0.06); } catch { /* not started */ }
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
    const span = document.createElement('span');
    span.className = 'cover-icon';
    span.textContent = icon;
    el.appendChild(span);
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

  root.BashCommon = { ICONS, ICON_COLORS, BashPlayer, renderCover, peaks, readPrefs };
})(window);
