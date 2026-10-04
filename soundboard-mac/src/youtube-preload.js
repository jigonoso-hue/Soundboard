// Runs inside the embedded YouTube page. Records the audio of the page's
// <video> element between two timestamps and hands the bytes to the host app.
const { ipcRenderer, contextBridge } = require('electron');

// The ad blocker has to run in the page's own world, before YouTube's scripts.
if (ipcRenderer.sendSync('adblock:enabled')) contextBridge.executeInMainWorld({ func: youtubeAdBlocker });

function getVideo() {
  return document.querySelector('video.html5-main-video') || document.querySelector('video');
}

function adShowing() {
  const player = document.querySelector('#movie_player');
  return !!(player && player.classList.contains('ad-showing'));
}

function videoTitle() {
  const el = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, h1.title, #title h1');
  return (el && el.textContent.trim()) || document.title.replace(/ - YouTube$/, '');
}

ipcRenderer.on('yt:state', (_e, requestId) => {
  const video = getVideo();
  ipcRenderer.sendToHost('yt:state', requestId, video ? {
    hasVideo: true,
    currentTime: video.currentTime,
    duration: Number.isFinite(video.duration) ? video.duration : 0,
    paused: video.paused,
    ad: adShowing(),
    title: videoTitle(),
    url: location.href,
  } : { hasVideo: false, url: location.href });
});

// Plays [start, end] once so the user can check their selection.
let stopPreview = null;
ipcRenderer.on('yt:preview', (_e, { start, end }) => {
  const video = getVideo();
  if (!video) return;
  if (stopPreview) stopPreview();
  const onTime = () => { if (video.currentTime >= end) { video.pause(); stopPreview(); } };
  const onPause = () => stopPreview();
  stopPreview = () => {
    video.removeEventListener('timeupdate', onTime);
    video.removeEventListener('pause', onPause);
    stopPreview = null;
  };
  video.currentTime = start;
  video.play().then(() => {
    if (!stopPreview) return;
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('pause', onPause);
  }).catch(() => stopPreview && stopPreview());
});

let activeCapture = null;

ipcRenderer.on('yt:cancel', () => { if (activeCapture) activeCapture.cancel(); });

ipcRenderer.on('yt:capture', async (_e, { start, end }) => {
  try {
    const result = await capture(start, end, (p) => ipcRenderer.sendToHost('yt:progress', p));
    ipcRenderer.sendToHost('yt:captured', result);
  } catch (err) {
    ipcRenderer.sendToHost('yt:error', err.message || String(err));
  } finally {
    activeCapture = null;
  }
});

const once = (target, event) => new Promise((resolve) => target.addEventListener(event, resolve, { once: true }));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function capture(start, end, progress) {
  const video = getVideo();
  if (!video) throw new Error('Open a YouTube video first.');
  if (adShowing()) throw new Error('An ad is playing. Wait for it to finish, then try again.');
  if (!(end > start)) throw new Error('The end time must be after the start time.');

  if (stopPreview) stopPreview();
  let cancelled = false;
  activeCapture = { cancel: () => { cancelled = true; } };

  const savedRate = video.playbackRate;
  video.pause();
  video.playbackRate = 1;
  // Start slightly early so the recording definitely covers `start`;
  // the host trims to the exact range afterwards.
  const preroll = Math.min(0.3, start);
  video.currentTime = start - preroll;
  await once(video, 'seeked');

  const stream = video.captureStream();
  await video.play();
  if (!stream.getAudioTracks().length) {
    await Promise.race([once(stream, 'addtrack'), sleep(2000)]);
  }
  const audioTracks = stream.getAudioTracks();
  if (!audioTracks.length) {
    video.pause();
    throw new Error('Could not access this video\'s audio.');
  }

  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
  const recorder = new MediaRecorder(new MediaStream(audioTracks), { mimeType, audioBitsPerSecond: 256000 });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = once(recorder, 'stop');

  const recordedFrom = video.currentTime;
  recorder.start(250);

  let interrupted = null;
  while (true) {
    await sleep(20);
    if (cancelled) { interrupted = 'Capture cancelled.'; break; }
    if (adShowing()) { interrupted = 'An ad interrupted the capture. Try again after it ends.'; break; }
    if (video.ended || video.currentTime >= end + 0.05) break;
    if (video.paused) video.play().catch(() => {});
    progress({ current: video.currentTime, start, end });
  }
  const recordedTo = video.currentTime;
  recorder.stop();
  video.pause();
  video.playbackRate = savedRate;
  await stopped;
  if (interrupted) throw new Error(interrupted);

  const blob = new Blob(chunks, { type: mimeType });
  return {
    data: new Uint8Array(await blob.arrayBuffer()),
    // Offsets (seconds into the recording) of the requested range.
    trimStart: Math.max(0, start - recordedFrom),
    trimEnd: Math.max(0, Math.min(end, recordedTo) - recordedFrom),
    title: videoTitle(),
    url: location.href,
  };
}

// BEGIN AD BLOCKER
// Runs in the YouTube page itself, before YouTube's own scripts. Three layers:
// 1. Removes the ad schedule from the video data YouTube sends its player,
//    so most ads never start.
// 2. If an ad still plays: mutes it, jumps to its end and presses "Skip".
// 3. Hides banner and feed ads.
function youtubeAdBlocker() {
  if (window.__sbAdBlocker) return;
  window.__sbAdBlocker = true;

  const AD_KEYS = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams'];
  const hasAds = (obj) => AD_KEYS.some((key) => key in obj);
  const prune = (obj) => {
    try {
      if (!obj || typeof obj !== 'object') return obj;
      for (const key of AD_KEYS) if (key in obj) delete obj[key];
      if (obj.playerResponse && typeof obj.playerResponse === 'object') prune(obj.playerResponse);
      if (Array.isArray(obj)) for (const item of obj) if (item && typeof item === 'object' && item.playerResponse) prune(item.playerResponse);
    } catch (e) { /* never break the page */ }
    return obj;
  };
  const worthPruning = (obj) => !!obj && typeof obj === 'object'
    && (hasAds(obj) || (obj.playerResponse && typeof obj.playerResponse === 'object')
      || (Array.isArray(obj) && obj.some((item) => item && typeof item === 'object' && item.playerResponse)));

  // Video data embedded in the page.
  for (const name of ['ytInitialPlayerResponse']) {
    let value = window[name];
    if (value) prune(value);
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        get: () => value,
        set: (next) => { value = prune(next); },
      });
    } catch (e) { /* already locked */ }
  }

  // Video data the player downloads later (when you open another video).
  const parse = JSON.parse;
  JSON.parse = function () {
    const result = parse.apply(this, arguments);
    return worthPruning(result) ? prune(result) : result;
  };
  if (window.Response && Response.prototype.json) {
    const json = Response.prototype.json;
    Response.prototype.json = function () {
      return json.call(this).then((result) => (worthPruning(result) ? prune(result) : result));
    };
  }

  // Ads that still get through: mute, jump to the end, press Skip.
  const AD_SHOWING = '.html5-video-player.ad-showing, #movie_player.ad-showing, .ad-showing .html5-main-video, .ad-interrupting';
  const SKIP = '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button-container button, .ytm-skip-ad-button, button[class*="skip-ad"], button[class*="skip-button"]';
  let saved = null;
  setInterval(() => {
    try {
      const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
      const skip = document.querySelector(SKIP);
      if (skip) skip.click();
      const ad = !!document.querySelector(AD_SHOWING);
      if (ad && video) {
        if (!saved) saved = { muted: video.muted, rate: video.playbackRate };
        video.muted = true;
        if (Number.isFinite(video.duration) && video.duration > 0 && video.currentTime < video.duration - 0.3) {
          video.currentTime = video.duration - 0.1;
        } else if (video.playbackRate < 16) {
          video.playbackRate = 16;
        }
      } else if (saved && video) {
        video.muted = saved.muted;
        video.playbackRate = saved.rate >= 16 ? 1 : saved.rate;
        saved = null;
      }
    } catch (e) { /* keep going */ }
  }, 250);

  // Banner, feed and sidebar ads.
  const style = document.createElement('style');
  style.textContent = [
    '#masthead-ad', '#player-ads', 'ytd-ad-slot-renderer', 'ytd-in-feed-ad-layout-renderer', 'ytd-banner-promo-renderer',
    'ytd-promoted-sparkles-web-renderer', 'ytd-promoted-video-renderer', 'ytd-display-ad-renderer', 'ytd-statement-banner-renderer',
    'ytd-player-legacy-desktop-watch-ads-renderer', 'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]',
    '.ytp-ad-overlay-container', '.ytp-ad-image-overlay', 'ad-slot-renderer', 'ytm-promoted-sparkles-web-renderer',
    'ytm-companion-ad-renderer', 'ytm-promoted-video-renderer', 'ytm-ad-slot-renderer',
  ].join(',\n') + ' { display: none !important; }';
  const addStyle = () => { if (!style.isConnected) (document.head || document.documentElement).appendChild(style); };
  if (document.documentElement) addStyle();
  document.addEventListener('DOMContentLoaded', addStyle);
}
// END AD BLOCKER
