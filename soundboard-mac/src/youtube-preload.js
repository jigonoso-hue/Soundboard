// Runs inside the embedded YouTube page. Records the audio of the page's
// <video> element between two timestamps and hands the bytes to the host app.
const { ipcRenderer } = require('electron');

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
