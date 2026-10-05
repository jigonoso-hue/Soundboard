const { app, BrowserWindow, ipcMain, dialog, protocol, shell, globalShortcut, nativeImage, session, Notification } = require('electron');
const path = require('path');
const { Readable } = require('stream');
const fs = require('fs');
const { Library, AUDIO_EXTENSIONS } = require('./library');
const { YtDlp } = require('./ytdlp');
const { BashStore, COVER_TYPES } = require('./bashes');
const { KitStore, KIT_ICONS, KIT_COLORS, COLUMNS } = require('./kits');
const Live = require('./live');

const AMBIENCE_DIR = path.join(__dirname, 'ambience');

// Sounds are served to the renderer over sound://local/<file>, and the
// built-in ambience loops over sound://builtin/<file>.
protocol.registerSchemesAsPrivileged([
  { scheme: 'sound', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } },
]);

// The app was first called Soundboard. Keep its data folder so existing
// libraries carry over (~/Library/Application Support/Soundboard).
app.setPath('userData', path.join(app.getPath('appData'), 'Soundboard'));

// YouTube shows "browser not supported" banners to Electron's default UA.
app.userAgentFallback = app.userAgentFallback.replace(/\s(Electron|clipboard-soundboard|Soundboard|Dungeon Radio)\/\S+/gi, '');

let library;
let bashes;
let kits;
let ytdlp;
const editors = new Map(); // bash id -> editor window
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 900,
    minHeight: 560,
    title: 'Dungeon Radio',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#14141c',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

// Lock down the embedded YouTube browser: our capture preload only, no Node.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (_e, webPreferences, params) => {
    delete webPreferences.preloadURL;
    webPreferences.preload = path.join(__dirname, 'youtube-preload.js');
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    params.partition = 'persist:youtube';
  });
  if (contents.getType() === 'webview') {
    // Open "new window" links inside the same embedded browser.
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) contents.loadURL(url);
      return { action: 'deny' };
    });
  }
});

// Tells every window except `except` (the one that made the change) to refresh.
function broadcast(channel, payload, except) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && win.webContents !== except) win.webContents.send(channel, payload);
  }
}

function openBashEditor(id, { isNew = false } = {}) {
  const existing = editors.get(id);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return;
  }
  const bash = bashes.get(id);
  if (!bash) return;
  // A smaller window with a normal title bar, floating in front of (and
  // offset from) the main window, so it clearly reads as a separate editor.
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  const bounds = parent ? parent.getBounds() : null;
  const width = 1040;
  const height = 640;
  const win = new BrowserWindow({
    width,
    height,
    minWidth: 760,
    minHeight: 480,
    ...(bounds ? { x: Math.round(bounds.x + (bounds.width - width) / 2), y: Math.round(bounds.y + Math.max(40, (bounds.height - height) / 2)) } : {}),
    parent,
    title: `Edit Bash — ${bash.name}`,
    backgroundColor: '#181822',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'bash-editor.html'), { query: { id, new: isNew ? '1' : '0' } });
  editors.set(id, win);
  // With unsaved changes, the red button / ⌘W asks the editor to confirm first.
  win.on('close', (e) => {
    if (dirtyEditors.has(win.webContents.id)) {
      e.preventDefault();
      win.webContents.send('bash-editor:close-requested');
    }
  });
  win.on('closed', () => editors.delete(id));
}

const dirtyEditors = new Set(); // webContents ids of editors with unsaved changes

function syncHotkeys() {
  globalShortcut.unregisterAll();
  const failed = [];
  for (const sound of library.list()) {
    if (!sound.hotkey) continue;
    try {
      const ok = globalShortcut.register(sound.hotkey, () => {
        if (mainWindow) mainWindow.webContents.send('hotkey:play', sound.id);
      });
      if (!ok) failed.push(sound.hotkey);
    } catch {
      failed.push(sound.hotkey);
    }
  }
  return failed;
}

function registerIpc() {
  ipcMain.handle('sounds:list', () => library.list());

  ipcMain.handle('sounds:import-dialog', async (e) => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      title: 'Add sounds',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio', extensions: AUDIO_EXTENSIONS }],
    });
    if (result.canceled) return [];
    const added = [];
    for (const file of result.filePaths) {
      try { added.push(library.addFromFile(file)); } catch (err) { console.error(err); }
    }
    if (added.length) broadcast('sounds:changed', null, e.sender);
    return added;
  });

  ipcMain.handle('sounds:add', (e, { name, data, ext, source, kind, duration }) => {
    const sound = library.add({ name, data, ext, source, kind, duration });
    broadcast('sounds:changed', null, e.sender);
    return sound;
  });

  // Raw bytes of a library sound, for decoding with Web Audio (bash playback and waveforms).
  ipcMain.handle('sounds:read', (_e, id) => {
    const sound = library.get(id);
    if (!sound) throw new Error('Sound not found');
    return fs.readFileSync(path.join(library.dir, sound.file));
  });

  ipcMain.handle('sounds:update', (e, id, changes) => {
    const sound = library.update(id, changes);
    const failed = 'hotkey' in changes ? syncHotkeys() : [];
    broadcast('sounds:changed', null, e.sender);
    return { sound, sounds: library.list(), failedHotkeys: failed };
  });

  ipcMain.handle('sounds:remove', (e, id) => {
    library.remove(id);
    syncHotkeys();
    broadcast('sounds:changed', null, e.sender);
    if (bashes.pruneSound(id)) broadcast('bashes:changed', bashes.list());
    if (kits.prune('sound', id)) broadcast('kits:changed', kits.list());
  });

  ipcMain.handle('sounds:reorder', (_e, ids) => library.reorder(ids));

  ipcMain.handle('tags:list', () => library.tags());
  ipcMain.handle('tags:add', (e, name) => {
    const tag = library.addTag(name);
    broadcast('sounds:changed', null, e.sender);
    return tag;
  });
  ipcMain.handle('tags:remove', (e, name) => {
    library.removeTag(name);
    broadcast('sounds:changed', null, e.sender);
  });

  ipcMain.handle('sounds:reveal', (_e, id) => {
    const sound = library.get(id);
    if (sound) shell.showItemInFolder(path.join(library.dir, sound.file));
    else shell.openPath(library.dir);
  });

  ipcMain.handle('ambience:builtins', () => fs.readdirSync(AMBIENCE_DIR)
    .filter((f) => f.endsWith('.wav'))
    .map((file) => ({ file, name: titleCase(file.replace(/\.wav$/, '').replace(/-/g, ' ')) })));

  ipcMain.handle('ambience:read-builtin', (_e, file) => {
    const resolved = resolveBuiltin(file);
    if (!resolved) throw new Error('Unknown ambience loop');
    return fs.readFileSync(resolved);
  });

  const ambiencePath = () => path.join(library.dir, 'ambience.json');
  ipcMain.handle('ambience:load', () => {
    try { return JSON.parse(fs.readFileSync(ambiencePath(), 'utf8')); } catch { return null; }
  });
  ipcMain.handle('ambience:save', (_e, state) => {
    fs.writeFileSync(ambiencePath() + '.tmp', JSON.stringify(state, null, 2));
    fs.renameSync(ambiencePath() + '.tmp', ambiencePath());
  });

  ipcMain.handle('youtube:download-audio', async (event, { jobId, url }) => {
    const send = (progress) => { if (!event.sender.isDestroyed()) event.sender.send('youtube:download-progress', jobId, progress); };
    const { file, title, cleanup } = await ytdlp.download(jobId, url, send);
    try {
      send({ message: 'Adding to your library…', percent: 100 });
      const sound = library.addFromFile(file, { name: title || 'YouTube audio', source: { title, url, full: true }, kind: 'full' });
      broadcast('sounds:changed', null, event.sender);
      return sound;
    } finally {
      cleanup();
    }
  });
  ipcMain.handle('youtube:cancel-download', (_e, jobId) => ytdlp.cancel(jobId));

  // ---- Bashes ----
  const bashesChanged = (sender) => broadcast('bashes:changed', bashes.list(), sender);

  ipcMain.handle('bashes:list', () => bashes.list());
  ipcMain.handle('bashes:get', (_e, id) => bashes.get(id));
  ipcMain.handle('bashes:create', (e, options) => {
    const bash = bashes.create(options);
    bashesChanged(e.sender);
    return bash;
  });
  ipcMain.handle('bashes:update', (e, id, changes) => {
    const bash = bashes.update(id, changes);
    bashesChanged(e.sender);
    const editor = editors.get(id);
    if (editor && !editor.isDestroyed()) editor.setTitle(`Edit Bash — ${bash.name}`);
    return bash;
  });
  ipcMain.handle('bashes:duplicate', (e, id) => {
    const bash = bashes.duplicate(id);
    bashesChanged(e.sender);
    return bash;
  });
  ipcMain.handle('bashes:remove', (e, id) => {
    bashes.remove(id);
    if (kits.prune('bash', id)) broadcast('kits:changed', kits.list());
    const editor = editors.get(id);
    if (editor && !editor.isDestroyed()) editor.close();
    bashesChanged(e.sender);
  });
  ipcMain.handle('bash-editor:set-dirty', (e, dirty) => {
    if (dirty) dirtyEditors.add(e.sender.id); else dirtyEditors.delete(e.sender.id);
  });
  ipcMain.handle('bashes:open-editor', (_e, id, options) => openBashEditor(id, options));

  // Picks and shrinks a cover image but doesn't save it: the editor keeps it
  // as an unsaved change until the user clicks Save.
  ipcMain.handle('bashes:pick-cover', async (e) => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      title: 'Choose a cover image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: COVER_TYPES }],
    });
    if (result.canceled || !result.filePaths.length) return null;
    const image = nativeImage.createFromPath(result.filePaths[0]);
    if (image.isEmpty()) throw new Error("That image couldn't be opened.");
    const { width, height } = image.getSize();
    const scaled = Math.max(width, height) > 512
      ? image.resize(width >= height ? { width: 512, quality: 'best' } : { height: 512, quality: 'best' })
      : image;
    return scaled.toPNG().toString('base64');
  });

  ipcMain.handle('bashes:set-cover-data', (e, id, base64) => {
    const bash = bashes.setCoverImage(id, Buffer.from(String(base64), 'base64'), 'png');
    bashesChanged(e.sender);
    return bash;
  });

  // Cover images are handed to the UI as data: URLs.
  ipcMain.handle('bashes:cover-data', (_e, file) => {
    const p = bashes.coverPath(file);
    if (!p || !fs.existsSync(p)) return null;
    const ext = path.extname(p).slice(1).toLowerCase();
    const mime = ext === 'jpg' ? 'jpeg' : ext;
    return `data:image/${mime};base64,${fs.readFileSync(p).toString('base64')}`;
  });

  // ---- Scene Kits ----
  const kitsChanged = (sender) => broadcast('kits:changed', kits.list(), sender);
  ipcMain.handle('kits:list', () => ({ kits: kits.list(), icons: KIT_ICONS, colors: KIT_COLORS, columns: COLUMNS }));
  ipcMain.handle('kits:create', (e, options) => { const kit = kits.create(options); kitsChanged(e.sender); return kit; });
  ipcMain.handle('kits:update', (e, id, changes) => { const kit = kits.update(id, changes); kitsChanged(e.sender); return kit; });
  ipcMain.handle('kits:add-items', (e, id, items, sectionId) => { const kit = kits.addItems(id, items, sectionId, library.list()); kitsChanged(e.sender); return kit; });
  ipcMain.handle('kits:remove-item', (e, id, item, sectionId) => { const kit = kits.removeItem(id, item, sectionId); kitsChanged(e.sender); return kit; });
  ipcMain.handle('kits:duplicate', (e, id) => { const kit = kits.duplicate(id); kitsChanged(e.sender); return kit; });
  ipcMain.handle('kits:remove', (e, id) => { kits.remove(id); kitsChanged(e.sender); });

  registerLiveIpc();

  ipcMain.handle('shell:open-external', (_e, url) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
  });
}

// ---- Live Session (see live.js) ----

let live = null; // { role: 'host', host, transport, mode } or { role: 'listen', listener }
let lanBrowser = null;
const liveCacheDir = () => path.join(app.getPath('userData'), 'live-cache');
const liveHasher = new Live.FileHasher();

function sendToMain(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function liveStatus(extra = {}) {
  if (!live) return { role: null, ...extra };
  if (live.role === 'host') {
    return {
      role: 'host', mode: live.mode, name: live.host.name, code: live.transport.code || null,
      reconnecting: !!live.reconnecting, peers: live.host.peerList(), ...extra,
    };
  }
  const { state, host, scene } = live.listener;
  return { role: 'listen', state, host: host || null, scene: scene || null, ...extra };
}

function endLive() {
  if (!live) return;
  if (live.role === 'host') live.host.end();
  else live.listener.leave();
  live = null;
}

function registerLiveIpc() {
  ipcMain.handle('live:status', () => ({ ...liveStatus(), bonjour: Live.hasBonjour() }));

  ipcMain.handle('live:host-start', async (_e, { name, mode, relay, playerSounds, catalog }) => {
    endLive();
    const sessionName = String(name || '').trim().slice(0, 40) || `${Live.deviceName()}'s game`;
    const transport = mode === 'online'
      ? new Live.RelayHostTransport({ url: relay })
      : new Live.LanHostTransport({ name: sessionName });
    await transport.start();
    const host = new Live.LiveHost({
      name: sessionName,
      transport,
      resolveSound: (id) => {
        const sound = library.get(id);
        const file = sound && library.resolveFile(sound.file);
        return file ? { file, ext: path.extname(file).slice(1).toLowerCase() } : null;
      },
      cacheDir: liveCacheDir(),
    });
    host.setCatalog(catalog);
    host.setPlayerSounds(playerSounds);
    const session = { role: 'host', host, transport, mode: mode === 'online' ? 'online' : 'local' };
    live = session;
    host.on('peers', () => { if (live === session) sendToMain('live:status', liveStatus()); });
    // A player played a sound for everyone: the board plays it here and sends it on.
    host.on('cue', (peer, playerName, cue) => {
      if (live !== session) return;
      const out = { ...cue };
      if (cue.file) {
        out.url = `sound://live/${encodeURIComponent(path.basename(cue.file))}`;
        delete out.file;
      }
      sendToMain('live:cue', { peer, name: playerName, cue: out });
    });
    transport.on('reconnecting', () => { session.reconnecting = true; if (live === session) sendToMain('live:status', liveStatus()); });
    transport.on('connected', () => { session.reconnecting = false; if (live === session) sendToMain('live:status', liveStatus()); });
    transport.on('failed', (err) => {
      if (live !== session) return;
      live = null;
      sendToMain('live:status', liveStatus({ error: err.message }));
    });
    return liveStatus();
  });

  // What the board plays, forwarded to listeners.
  ipcMain.on('live:host-event', (_e, event) => {
    if (!live || live.role !== 'host' || !event) return;
    const { host } = live;
    switch (event.t) {
      case 'play': {
        if (event.file) {
          // A player's own sound, from the cache.
          const file = resolveLiveCache(`${event.file.hash}.${event.file.ext}`);
          if (!file || !fs.existsSync(file)) return;
          host.play({ ...event, file: { hash: event.file.hash, ext: event.file.ext, file } });
        } else host.play(event);
        break;
      }
      case 'playerSounds': host.setPlayerSounds(event.mode); break;
      case 'catalog': host.setCatalog(event.items); break;
      case 'stop': host.stop(event.group); break;
      case 'volume': host.volume(event.group, event.volume); break;
      case 'stopAll': host.stopAll(); break;
      case 'ambience': host.setAmbience(event.layers); break;
      case 'scene': host.setScene(event.name); break;
      case 'prefetch': host.setPrefetch(event.ids); break;
      default: break;
    }
  });

  ipcMain.handle('live:listen', (_e, { url, code, relay, name }) => {
    endLive();
    let target = url;
    if (!target) {
      const base = Live.relayUrl(relay);
      if (!base) throw new Error('Set a relay server address first.');
      const clean = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!clean) throw new Error('Enter the session code from your GM.');
      target = `${base}?role=listen&code=${clean}`;
    } else if (!/^ws:\/\/[^/]+$/.test(target)) {
      throw new Error('That isn’t a local session address.');
    }
    const listener = new Live.LiveListener({ cacheDir: liveCacheDir(), name: String(name || '').trim().slice(0, 40) || Live.deviceName(), device: 'Mac' });
    const session = { role: 'listen', listener };
    live = session;
    listener.on('status', (status) => {
      if (live !== session) return;
      if (status.state === 'error' || status.state === 'ended') live = null;
      sendToMain('live:status', { role: live ? 'listen' : null, ...status });
    });
    listener.on('rules', (mode) => { if (live === session) sendToMain('live:rules', mode); });
    listener.on('catalog', (items) => { if (live === session) sendToMain('live:catalog', items); });
    listener.on('command', (command) => {
      if (command.file) command.url = `sound://live/${encodeURIComponent(path.basename(command.file))}`;
      if (command.layers) {
        for (const layer of command.layers) {
          layer.url = layer.builtin ? `sound://builtin/${encodeURIComponent(layer.builtin)}` : `sound://live/${encodeURIComponent(path.basename(layer.file))}`;
          delete layer.file;
        }
      }
      delete command.file;
      sendToMain('live:command', command);
    });
    listener.connect(target);
    return liveStatus();
  });

  ipcMain.handle('live:leave', () => { endLive(); return liveStatus(); });

  // A player's own sounds: offered to the host so it can fetch them ahead of time.
  ipcMain.handle('live:offer', async (_e, ids) => {
    if (!live || live.role !== 'listen') return;
    const { listener } = live;
    const sounds = [];
    for (const id of (Array.isArray(ids) ? ids : []).slice(0, Live.PLAYER_SOUND_LIMIT)) {
      const sound = library.get(id);
      const file = sound && library.resolveFile(sound.file);
      if (!file) continue;
      try {
        const hash = await liveHasher.hash(file);
        sounds.push({ file, hash, ext: path.extname(file).slice(1).toLowerCase(), name: sound.name });
      } catch { /* skip */ }
    }
    if (live && live.listener === listener) listener.offer(sounds);
  });

  // A player plays one of their picks for everyone: one of the GM's sounds (id),
  // or one of their own (soundId).
  ipcMain.handle('live:cue', async (_e, { id, soundId }) => {
    if (!live || live.role !== 'listen') return;
    if (id) { live.listener.cue(id); return; }
    const sound = library.get(soundId);
    const file = sound && library.resolveFile(sound.file);
    if (!file) return;
    try { live.listener.cueHash(await liveHasher.hash(file)); } catch { /* ignore */ }
  });

  // A buzz while the window isn't in front: a notification and a bounce of the Dock icon.
  ipcMain.on('live:notify', (_e, { title, body }) => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isFocused()) return;
    try {
      if (Notification.isSupported()) new Notification({ title: String(title || 'Dungeon Radio').slice(0, 80), body: String(body || '').slice(0, 200) }).show();
    } catch { /* ignore */ }
    try { app.dock?.bounce('critical'); } catch { /* ignore */ }
  });

  ipcMain.handle('live:browse', (_e, on) => {
    lanBrowser?.stop();
    lanBrowser = null;
    if (!on) return;
    lanBrowser = new Live.LanBrowser();
    lanBrowser.on('sessions', (list) => sendToMain('live:sessions', list));
    lanBrowser.start();
  });
}

// Ad and ad-tracking servers, always blocked in the YouTube browser.
const AD_URLS = [
  '*://*.doubleclick.net/*', '*://*.googlesyndication.com/*', '*://*.googleadservices.com/*',
  '*://www.youtube.com/pagead/*', '*://m.youtube.com/pagead/*',
  '*://www.youtube.com/api/stats/ads*', '*://m.youtube.com/api/stats/ads*',
  '*://www.youtube.com/get_midroll_*', '*://*.youtube.com/ptracking*',
];

app.whenReady().then(() => {
  session.fromPartition('persist:youtube').webRequest.onBeforeRequest({ urls: AD_URLS }, (_details, callback) => {
    callback({ cancel: true });
  });
  library = new Library(path.join(app.getPath('userData'), 'sounds'));
  bashes = new BashStore(library.dir);
  kits = new KitStore(library.dir);
  kits.finishMigration(library.list());

  ytdlp = new YtDlp();
  Live.LiveListener.pruneCache(liveCacheDir());

  protocol.handle('sound', async (request) => {
    const url = new URL(request.url);
    const file = decodeURIComponent(url.pathname.slice(1));
    const resolved = url.host === 'builtin' ? resolveBuiltin(file)
      : url.host === 'live' ? resolveLiveCache(file)
      : library.resolveFile(file);
    if (!resolved) return new Response('Not found', { status: 404 });
    return serveFile(resolved, request.headers.get('range'));
  });

  registerIpc();
  createWindow();
  syncHotkeys();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

const MIME_TYPES = {
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg',
  oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', webm: 'audio/webm', aiff: 'audio/aiff', aif: 'audio/aiff',
  caf: 'audio/x-caf',
};

// Serves a file with its size and HTTP range support, so the audio player
// knows how long long tracks are and can seek within them.
async function serveFile(file, range) {
  let stat;
  try { stat = await fs.promises.stat(file); } catch { return new Response('Not found', { status: 404 }); }
  const size = stat.size;
  const headers = {
    'Content-Type': MIME_TYPES[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    // Lets the UI decode sounds with Web Audio (used by ambience layers).
    'Access-Control-Allow-Origin': '*',
  };
  const match = /^bytes=(\d*)-(\d*)$/.exec(range || '');
  if (match && size > 0) {
    let start = match[1] === '' ? size - Number(match[2]) : Number(match[1]);
    let end = match[1] !== '' && match[2] !== '' ? Number(match[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    const stream = Readable.toWeb(fs.createReadStream(file, { start, end }));
    return new Response(stream, {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers: { ...headers, 'Content-Length': String(size) } });
}

// Files a Live Session host sent us, named <sha256>.<ext>.
function resolveLiveCache(file) {
  return /^[0-9a-f]{64}\.[a-z0-9]{1,5}$/.test(file) ? path.join(liveCacheDir(), file) : null;
}

function resolveBuiltin(file) {
  const resolved = path.resolve(AMBIENCE_DIR, file);
  return path.dirname(resolved) === AMBIENCE_DIR ? resolved : null;
}

function titleCase(text) {
  return text.replace(/\b\w/g, (c) => c.toUpperCase());
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  endLive();
  lanBrowser?.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
