const { app, BrowserWindow, ipcMain, dialog, protocol, shell, globalShortcut, nativeImage } = require('electron');
const path = require('path');
const { Readable } = require('stream');
const fs = require('fs');
const { Library, AUDIO_EXTENSIONS } = require('./library');
const { YtDlp } = require('./ytdlp');
const { BashStore, COVER_TYPES } = require('./bashes');

const AMBIENCE_DIR = path.join(__dirname, 'ambience');

// Sounds are served to the renderer over sound://local/<file>, and the
// built-in ambience loops over sound://builtin/<file>.
protocol.registerSchemesAsPrivileged([
  { scheme: 'sound', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } },
]);

// YouTube shows "browser not supported" banners to Electron's default UA.
app.userAgentFallback = app.userAgentFallback.replace(/\s(Electron|clipboard-soundboard|Soundboard)\/\S+/gi, '');

let library;
let bashes;
let ytdlp;
const editors = new Map(); // bash id -> editor window
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 900,
    minHeight: 560,
    title: 'Soundboard',
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

  ipcMain.handle('shell:open-external', (_e, url) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
  });
}

app.whenReady().then(() => {
  library = new Library(path.join(app.getPath('userData'), 'sounds'));
  bashes = new BashStore(library.dir);

  ytdlp = new YtDlp();

  protocol.handle('sound', async (request) => {
    const url = new URL(request.url);
    const file = decodeURIComponent(url.pathname.slice(1));
    const resolved = url.host === 'builtin' ? resolveBuiltin(file) : library.resolveFile(file);
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

function resolveBuiltin(file) {
  const resolved = path.resolve(AMBIENCE_DIR, file);
  return path.dirname(resolved) === AMBIENCE_DIR ? resolved : null;
}

function titleCase(text) {
  return text.replace(/\b\w/g, (c) => c.toUpperCase());
}

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
