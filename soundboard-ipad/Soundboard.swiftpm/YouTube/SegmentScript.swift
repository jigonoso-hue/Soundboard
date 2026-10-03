enum SegmentScript {
    /// Injected into every YouTube page before it loads. It watches the audio
    /// the player downloads (the chunks it hands to Media Source Extensions)
    /// and, when asked, stitches the chunks covering [start, end] into an MP4
    /// file for the app. This works on iPadOS, where the page can't record
    /// YouTube's sound, and it doesn't need the audio to play out loud.
    static let source = #"""
// BEGIN SEGMENT SCRIPT
(() => {
  if (window.__sbSeg) return;

  const handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.soundboard;
  const post = (msg) => { if (handler) handler.postMessage(msg); };
  const getVideo = () => document.querySelector('video.html5-main-video') || document.querySelector('video');
  const adShowing = () => {
    const player = document.querySelector('#movie_player');
    return !!(player && player.classList.contains('ad-showing'));
  };
  const videoTitle = () => {
    const el = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, h1.title, #title h1, .slim-video-information-title');
    return (el && el.textContent.trim()) || document.title.replace(/ - YouTube$/, '');
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const MAX_BYTES = 150 * 1024 * 1024;
  const tracks = [];
  const sources = new WeakMap(); // SourceBuffer -> track

  // ---------- Ask for AAC in MP4, which the app can always open ----------

  const rejected = (type) => /webm|opus|vorbis/i.test(String(type || ''));
  for (const MS of [window.MediaSource, window.ManagedMediaSource, window.WebKitMediaSource]) {
    if (!MS || MS.__sbPatched) continue;
    MS.__sbPatched = true;
    if (typeof MS.isTypeSupported === 'function') {
      const original = MS.isTypeSupported.bind(MS);
      MS.isTypeSupported = (type) => !rejected(type) && original(type);
    }
    if (Object.prototype.hasOwnProperty.call(MS.prototype, 'addSourceBuffer')) {
      const add = MS.prototype.addSourceBuffer;
      MS.prototype.addSourceBuffer = function (mime) {
        const buffer = add.call(this, mime);
        if (/^audio\//i.test(String(mime))) sources.set(buffer, newTrack(String(mime)));
        return buffer;
      };
    }
  }
  if (navigator.mediaCapabilities && navigator.mediaCapabilities.decodingInfo) {
    const decodingInfo = navigator.mediaCapabilities.decodingInfo.bind(navigator.mediaCapabilities);
    navigator.mediaCapabilities.decodingInfo = (config) => {
      if (config && config.audio && rejected(config.audio.contentType)) {
        return Promise.resolve({ supported: false, smooth: false, powerEfficient: false });
      }
      return decodingInfo(config);
    };
  }
  if (window.SourceBuffer) {
    const append = window.SourceBuffer.prototype.appendBuffer;
    window.SourceBuffer.prototype.appendBuffer = function (data) {
      const track = sources.get(this);
      if (track) {
        try { record(track, data); } catch (e) { /* never break playback */ }
      }
      return append.call(this, data);
    };
  }

  // ---------- MP4 boxes ----------

  const u32 = (b, p) => ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3];
  const u64 = (b, p) => u32(b, p) * 4294967296 + u32(b, p + 4);
  const fourcc = (b, p) => String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
  const put32 = (b, p, v) => { b[p] = (v >>> 24) & 255; b[p + 1] = (v >>> 16) & 255; b[p + 2] = (v >>> 8) & 255; b[p + 3] = v & 255; };

  function concat(parts) {
    let length = 0;
    for (const part of parts) length += part.length;
    const out = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) { out.set(part, offset); offset += part.length; }
    return out;
  }

  // Child boxes of a container box: [{ type, start, size, header }] with offsets inside `box`.
  function children(box, from) {
    const out = [];
    let p = from === undefined ? 8 : from;
    while (p + 8 <= box.length) {
      let size = u32(box, p);
      let header = 8;
      if (size === 1) { size = u64(box, p + 8); header = 16; }
      if (size === 0) size = box.length - p;
      if (size < header || p + size > box.length) break;
      out.push({ type: fourcc(box, p + 4), start: p, size, header });
      p += size;
    }
    return out;
  }

  function find(box, path, from) {
    let current = { start: 0, size: box.length, header: from === undefined ? 8 : from };
    for (const type of path) {
      const sub = box.subarray(current.start, current.start + current.size);
      const next = children(sub, current.header).find((c) => c.type === type);
      if (!next) return null;
      current = { start: current.start + next.start, size: next.size, header: next.header };
    }
    return current;
  }

  function moovInfo(moov) {
    const mdhd = find(moov, ['trak', 'mdia', 'mdhd']);
    let timescale = 0;
    if (mdhd) {
      const body = mdhd.start + mdhd.header;
      timescale = moov[body] === 1 ? u32(moov, body + 20) : u32(moov, body + 12);
    }
    const trex = find(moov, ['mvex', 'trex']);
    const defaultDuration = trex ? u32(moov, trex.start + trex.header + 12) : 0;
    return { timescale, defaultDuration };
  }

  // Start time (in timescale units) and duration of one moof.
  function moofTiming(moof, defaultDuration) {
    const tfdt = find(moof, ['traf', 'tfdt']);
    if (!tfdt) return null;
    const body = tfdt.start + tfdt.header;
    const time = moof[body] === 1 ? u64(moof, body + 4) : u32(moof, body + 4);

    let sampleDuration = defaultDuration;
    const tfhd = find(moof, ['traf', 'tfhd']);
    if (tfhd) {
      const b = tfhd.start + tfhd.header;
      const flags = u32(moof, b) & 0xffffff;
      let p = b + 8; // version/flags + track_ID
      if (flags & 0x1) p += 8;
      if (flags & 0x2) p += 4;
      if (flags & 0x8) sampleDuration = u32(moof, p);
    }
    let duration = 0;
    const trun = find(moof, ['traf', 'trun']);
    if (trun) {
      const b = trun.start + trun.header;
      const flags = u32(moof, b) & 0xffffff;
      const count = u32(moof, b + 4);
      let p = b + 8;
      if (flags & 0x1) p += 4;
      if (flags & 0x4) p += 4;
      const fields = ['0x100', '0x200', '0x400', '0x800'].filter((f) => flags & Number(f)).length;
      if (flags & 0x100) {
        for (let i = 0; i < count; i++) duration += u32(moof, p + i * fields * 4);
      } else {
        duration = count * sampleDuration;
      }
    }
    return { time, duration, tfdt: body };
  }

  // ---------- Recording what the player appends ----------

  function newTrack(mime) {
    const track = { mime, pending: new Uint8Array(0), ftyp: null, init: null, timescale: 0, defaultDuration: 0, moof: null, frags: new Map(), bytes: 0, lastAppend: 0 };
    tracks.push(track);
    if (tracks.length > 8) tracks.shift();
    return track;
  }

  function toBytes(data) {
    if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
    return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  }

  const sameBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

  function record(track, data) {
    let bytes = toBytes(data);
    if (track.pending.length) bytes = concat([track.pending, bytes]);
    let p = 0;
    while (p + 8 <= bytes.length) {
      let size = u32(bytes, p);
      let header = 8;
      if (size === 1) {
        if (p + 16 > bytes.length) break;
        size = u64(bytes, p + 8);
        header = 16;
      }
      if (size < header) { p = bytes.length; break; } // not MP4: give up on this chunk
      if (p + size > bytes.length) break; // the rest arrives in the next append
      handleBox(track, fourcc(bytes, p + 4), bytes.subarray(p, p + size));
      p += size;
    }
    track.pending = bytes.slice(p);
    if (track.pending.length > 32 * 1024 * 1024) track.pending = new Uint8Array(0);
    track.lastAppend = Date.now();
  }

  function handleBox(track, type, box) {
    if (type === 'ftyp') {
      track.ftyp = box.slice();
    } else if (type === 'moov') {
      const init = concat([track.ftyp || defaultFtyp(), box]);
      // A different stream (another video, or a new format): start over.
      if (track.init && !sameBytes(track.init, init)) { track.frags.clear(); track.bytes = 0; }
      track.init = init;
      Object.assign(track, moovInfo(box));
    } else if (type === 'moof') {
      track.moof = box.slice();
    } else if (type === 'mdat' && track.moof && track.timescale) {
      const timing = moofTiming(track.moof, track.defaultDuration);
      if (timing) {
        const bytes = concat([track.moof, box]);
        const existing = track.frags.get(timing.time);
        if (existing) track.bytes -= existing.bytes.length;
        track.frags.set(timing.time, {
          base: timing.time,
          time: timing.time / track.timescale,
          dur: timing.duration / track.timescale,
          tfdt: timing.tfdt,
          bytes,
        });
        track.bytes += bytes.length;
        trim(track);
      }
      track.moof = null;
    }
  }

  function defaultFtyp() {
    const box = new Uint8Array(24);
    put32(box, 0, 24);
    box.set([102, 116, 121, 112, 105, 115, 111, 54, 0, 0, 0, 0, 105, 115, 111, 54, 109, 112, 52, 49], 4); // ftyp iso6 0 iso6 mp41
    return box;
  }

  // Keep memory bounded: drop the fragments furthest from what's playing.
  function trim(track) {
    if (track.bytes <= MAX_BYTES) return;
    const video = getVideo();
    const now = video ? video.currentTime : 0;
    const list = [...track.frags.values()].sort((a, b) => Math.abs(b.time - now) - Math.abs(a.time - now));
    for (const frag of list) {
      if (track.bytes <= MAX_BYTES * 0.8) break;
      track.frags.delete(frag.base);
      track.bytes -= frag.bytes.length;
    }
  }

  const ordered = (track) => [...track.frags.values()].sort((a, b) => a.time - b.time);

  // How far from `start` the recorded audio reaches without a gap.
  function reach(track, start) {
    let end = null;
    for (const frag of ordered(track)) {
      if (frag.time + frag.dur <= start) continue;
      if (end === null) {
        if (frag.time > start + 0.05) return start;
        end = frag.time + frag.dur;
      } else {
        if (frag.time > end + 0.05) break;
        end = Math.max(end, frag.time + frag.dur);
      }
    }
    return end === null ? start : end;
  }

  function bestTrack(start) {
    let best = null;
    for (const track of tracks) {
      if (!track.init || !track.timescale) continue;
      if (!best || reach(track, start) > reach(best, start)
          || (reach(track, start) === reach(best, start) && track.lastAppend > best.lastAppend)) best = track;
    }
    return best;
  }

  // init + the fragments covering [start, end], re-timed to start at 0.
  function build(track, start, end) {
    const chosen = [];
    let covered = null;
    for (const frag of ordered(track)) {
      if (frag.time + frag.dur <= start) continue;
      if (covered !== null && frag.time < covered - 0.05) continue; // duplicate
      chosen.push(frag);
      covered = frag.time + frag.dur;
      if (covered >= end) break;
    }
    if (!chosen.length) return null;
    const base = chosen[0].base;
    const parts = [track.init];
    for (const frag of chosen) {
      const bytes = frag.bytes.slice();
      const value = frag.base - base;
      if (bytes[frag.tfdt] === 1) {
        put32(bytes, frag.tfdt + 4, Math.floor(value / 4294967296));
        put32(bytes, frag.tfdt + 8, value % 4294967296);
      } else {
        put32(bytes, frag.tfdt + 4, value);
      }
      parts.push(bytes);
    }
    return { bytes: concat(parts), offset: chosen[0].time, until: covered };
  }

  function toBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  // ---------- Capturing a range ----------

  let cancel = null;

  window.__sbSeg = {
    // How many audio streams have been seen (0 = this page can't be captured this way).
    available() { return tracks.filter((t) => t.init).length; },
    capture(start, end, options) {
      run(start, end, options || {}).catch((err) => post({ type: 'error', message: String((err && err.message) || err) }));
      return 'ok';
    },
    cancel() { if (cancel) cancel(); return 'ok'; },
  };

  async function run(start, end, options) {
    const video = getVideo();
    if (!video) throw new Error('Open a YouTube video first.');
    if (!(end > start)) throw new Error('The end time must be after the start time.');
    if (cancel) throw new Error('A capture is already running.');
    // The player may still be loading its first chunks.
    for (let i = 0; i < 20 && !bestTrack(start); i++) await sleep(250);
    if (!bestTrack(start)) { post({ type: 'segments-unavailable' }); return; }

    let cancelled = false;
    cancel = () => { cancelled = true; };
    const saved = { rate: video.playbackRate, muted: video.muted };
    try {
      // Play (muted, and faster than normal) until the player has downloaded the whole range.
      if (reach(bestTrack(start), start) < end - 0.05) {
        post({ type: 'status', message: 'Downloading the audio…' });
        video.muted = true;
        const current = video.currentTime;
        if (current < start - 1 || current > reach(bestTrack(start), start)) video.currentTime = Math.max(0, start - 0.5);
        video.playbackRate = options.rate || 2;
        video.play().catch(() => {});
        let lastReach = -1;
        let stalledFor = 0;
        while (true) {
          await sleep(250);
          if (cancelled) throw new Error('Capture cancelled.');
          const track = bestTrack(start);
          const got = track ? reach(track, start) : start;
          post({ type: 'progress', time: got, fraction: Math.max(0, Math.min(1, (got - start) / (end - start))) });
          if (got >= end - 0.05) break;
          if (adShowing()) { stalledFor = 0; continue; }
          if (video.ended && got < end - 0.05) {
            if (got > start + 0.5) { end = got; break; } // the video is shorter than asked
            throw new Error('The video ended before the audio downloaded. Try again.');
          }
          stalledFor = got !== lastReach ? 0 : stalledFor + 250;
          lastReach = got;
          if (stalledFor > 30000) throw new Error('The download stalled. Check your connection and try again.');
          if (video.paused) video.play().catch(() => {});
          if (video.playbackRate !== (options.rate || 2)) video.playbackRate = options.rate || 2;
        }
      }
    } finally {
      cancel = null;
      video.pause();
      video.playbackRate = saved.rate;
      video.muted = saved.muted;
    }

    const built = build(bestTrack(start), start, end);
    if (!built) throw new Error('No audio was downloaded.');
    post({
      type: 'segments-start',
      mime: bestTrack(start).mime,
      relStart: Math.max(0, start - built.offset),
      relEnd: Math.min(end, built.until) - built.offset,
    });
    const chunk = 768 * 1024;
    for (let i = 0; i < built.bytes.length; i += chunk) {
      post({ type: 'segments-chunk', data: toBase64(built.bytes.subarray(i, i + chunk)) });
    }
    post({ type: 'segments-done', title: videoTitle(), url: location.href, start, end });
  }
})();
// END SEGMENT SCRIPT
"""#
}
