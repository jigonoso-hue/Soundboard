enum CaptureScript {
    /// Injected into every YouTube page. It routes the page's <video> through
    /// Web Audio, records the samples between two timestamps and streams them
    /// to the app as 16-bit PCM through the "soundboard" message handler.
    static let source = #"""
// BEGIN CAPTURE SCRIPT
(() => {
  if (window.__sb) return;

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

  let ctx = null;
  const taps = new WeakMap();
  let onBuffer = null; // set while a capture is running

  // Once a video is routed through Web Audio it stays that way, so the tap
  // is created lazily on the first capture and reused afterwards.
  function tap(video) {
    if (taps.has(video)) return taps.get(video);
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = ctx || new AC();
    const source = ctx.createMediaElementSource(video);
    const monitor = ctx.createGain(); // what you hear; muted for silent saves
    const processor = ctx.createScriptProcessor(2048, 2, 2);
    const silent = ctx.createGain();
    silent.gain.value = 0;
    source.connect(monitor);
    monitor.connect(ctx.destination);
    source.connect(processor);
    processor.connect(silent);
    silent.connect(ctx.destination);
    processor.onaudioprocess = (e) => { if (onBuffer) onBuffer(e.inputBuffer, video); };
    video.addEventListener('play', () => { ctx.resume(); });
    const t = { processor, monitor };
    taps.set(video, t);
    return t;
  }

  function toBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  let stopPreview = null;
  let cancelCapture = null;

  window.__sb = {
    state() {
      const v = getVideo();
      if (!v) return JSON.stringify({ hasVideo: false, url: location.href });
      return JSON.stringify({
        hasVideo: true,
        currentTime: v.currentTime,
        duration: isFinite(v.duration) ? v.duration : 0,
        paused: v.paused,
        ad: adShowing(),
        title: videoTitle(),
        url: location.href,
      });
    },

    // Plays [start, end] once so the user can check their selection.
    preview(start, end) {
      const v = getVideo();
      if (!v) return 'no-video';
      if (stopPreview) stopPreview();
      const onTime = () => { if (v.currentTime >= end) { v.pause(); if (stopPreview) stopPreview(); } };
      const onPause = () => { if (stopPreview) stopPreview(); };
      stopPreview = () => {
        v.removeEventListener('timeupdate', onTime);
        v.removeEventListener('pause', onPause);
        stopPreview = null;
      };
      v.currentTime = start;
      v.play().then(() => {
        if (!stopPreview) return;
        v.addEventListener('timeupdate', onTime);
        v.addEventListener('pause', onPause);
      }).catch(() => { if (stopPreview) stopPreview(); });
      return 'ok';
    },

    cancel() {
      if (cancelCapture) cancelCapture('Capture cancelled.');
      return 'ok';
    },

    // options.listen = false records without playing the audio out loud.
    capture(start, end, options) {
      run(start, end, options || {}).catch((err) => post({ type: 'error', message: String((err && err.message) || err) }));
      return 'ok';
    },
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function run(start, end, options) {
    const video = getVideo();
    if (!video) throw new Error('Open a YouTube video first.');
    if (!(end > start)) throw new Error('The end time must be after the start time.');
    if (cancelCapture) throw new Error('A capture is already running.');
    if (stopPreview) stopPreview();

    let cancelled = false;
    cancelCapture = () => { cancelled = true; };

    // Let a pre-roll ad finish before starting.
    if (adShowing()) {
      post({ type: 'status', message: 'Waiting for the ad to finish…' });
      video.play().catch(() => {});
      const waitUntil = Date.now() + 180000;
      while (adShowing() && !cancelled && Date.now() < waitUntil) await sleep(250);
      if (cancelled) { cancelCapture = null; throw new Error('Capture cancelled.'); }
      if (adShowing()) { cancelCapture = null; throw new Error('The ad didn\'t finish. Try again.'); }
    }

    const nodes = tap(video);
    try { await ctx.resume(); } catch (e) { /* checked by the watchdog below */ }

    const savedRate = video.playbackRate;
    video.pause();
    video.playbackRate = 1;
    const seekTarget = Math.max(0, start - 0.4);
    const seeked = new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }));
    video.currentTime = seekTarget;
    await Promise.race([seeked, sleep(3000)]);
    nodes.monitor.gain.value = options.listen === false ? 0 : 1;

    const sampleRate = ctx.sampleRate;
    post({ type: 'start', sampleRate, channels: 2 });
    let pending = [];
    let pendingLength = 0;
    let frames = 0;
    let peak = 0;
    let buffers = 0;
    let clock = null;   // media time of the next buffer's first sample
    let written = start; // media time up to which audio has been recorded
    let watchdog = null;

    const flush = () => {
      if (!pendingLength) return;
      const all = new Int16Array(pendingLength);
      let offset = 0;
      for (const part of pending) { all.set(part, offset); offset += part.length; }
      pending = [];
      pendingLength = 0;
      post({ type: 'chunk', data: toBase64(new Uint8Array(all.buffer)) });
    };

    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = (error) => {
        if (finished) return;
        finished = true;
        onBuffer = null;
        cancelCapture = null;
        clearInterval(watchdog);
        video.pause();
        video.playbackRate = savedRate;
        nodes.monitor.gain.value = 1;
        if (error) return reject(new Error(error));
        flush();
        if (!frames) return reject(new Error('No audio was captured.'));
        if (peak < 0.0005) {
          return reject(new Error('Only silence was captured. This video\'s audio may be blocked from capture. Try importing a screen recording instead.'));
        }
        post({ type: 'done', title: videoTitle(), url: location.href, start, end });
        resolve();
      };
      cancelCapture = () => finish('Capture cancelled.');
      if (cancelled) return finish('Capture cancelled.');

      onBuffer = (buffer, v) => {
        buffers++;
        const n = buffer.length;
        if (adShowing()) {
          // Mid-roll ad: skip it and re-anchor when the video comes back.
          clock = null;
          return;
        }
        if (clock === null) {
          // Anchor once playback has really started; after that, advance by
          // exact sample counts so the timeline has no gaps or overlaps.
          if (v.paused || v.currentTime <= seekTarget + 0.01) return;
          clock = v.currentTime - n / sampleRate;
        }
        const left = buffer.getChannelData(0);
        const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
        const out = new Int16Array(n * 2);
        let k = 0;
        for (let i = 0; i < n; i++) {
          const t = clock + i / sampleRate;
          // `written` stops re-anchoring after an ad from recording audio twice.
          if (t < written - 0.5 / sampleRate || t >= end) continue;
          const l = Math.max(-1, Math.min(1, left[i]));
          const r = Math.max(-1, Math.min(1, right[i]));
          peak = Math.max(peak, Math.abs(l), Math.abs(r));
          out[k++] = l < 0 ? l * 0x8000 : l * 0x7fff;
          out[k++] = r < 0 ? r * 0x8000 : r * 0x7fff;
          written = t + 1 / sampleRate;
        }
        clock += n / sampleRate;
        if (k) {
          pending.push(out.subarray(0, k));
          pendingLength += k;
          frames += k / 2;
        }
        if (pendingLength >= sampleRate) flush(); // about every half second
        post({ type: 'progress', time: clock, fraction: Math.max(0, Math.min(1, (clock - start) / (end - start))) });
        if (clock >= end || v.ended) finish();
      };

      let lastWritten = written;
      let stalledFor = 0;
      watchdog = setInterval(() => {
        if (!buffers) {
          stalledFor += 500;
          if (stalledFor > 3000) finish('Audio capture didn\'t start. Tap play on the video once, then try again.');
          return;
        }
        // Ads and short buffering are fine; give up if the video makes no progress for 30s.
        stalledFor = written !== lastWritten || adShowing() ? 0 : stalledFor + 500;
        lastWritten = written;
        if (stalledFor > 30000) finish('The video stopped playing. Check your connection and try again.');
        else if (video.paused) video.play().catch(() => {});
      }, 500);

      video.play().catch((e) => finish('Couldn\'t start playback: ' + e.message));
    });
  }
})();
// END CAPTURE SCRIPT
"""#
}
