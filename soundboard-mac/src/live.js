// Live Session: one app (the host, usually the GM) plays to other copies of
// the app (listeners). The host sends commands, not audio; listeners fetch
// each sound file once, cache it by hash and play it themselves, in sync.
// See live-relay/PROTOCOL.md for the messages.
//
// Two ways to connect, with the same host and listener logic on top:
// - At the table: the host runs a WebSocket server on the local network and
//   advertises it with Bonjour; listeners find it and connect directly.
// - Online: both connect to a relay server, which routes the messages.

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const WebSocket = require('ws');

const { WebSocketServer } = WebSocket;
const VERSION = 1;
const SERVICE_TYPE = 'dungeonradio'; // _dungeonradio._tcp
const CHUNK_SIZE = 256 * 1024;
const MAX_MESSAGE = 1024 * 1024;
const CHUNKS_IN_FLIGHT = 4;
const HASH_RE = /^[0-9a-f]{64}$/;
const EXT_RE = /^[a-z0-9]{1,5}$/;

let Bonjour = null;
try { ({ Bonjour } = require('bonjour-service')); } catch { /* local sessions unavailable */ }

function parse(data) {
  try {
    const message = JSON.parse(data.toString());
    return message && typeof message === 'object' && typeof message.t === 'string' ? message : null;
  } catch {
    return null;
  }
}

function sendJSON(socket, message) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

// Turns what the user typed ("relay.example.com", "https://…") into the relay's WebSocket URL.
function relayUrl(input) {
  let text = String(input || '').trim().replace(/\/+$/, '');
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) text = text.replace(/^http/i, 'ws');
  else if (!/^wss?:\/\//i.test(text)) text = `wss://${text}`;
  if (!/\/live$/.test(text)) text += '/live';
  try { return new URL(text).toString(); } catch { return null; }
}

// SHA-256 of library files, remembered until the file changes.
class FileHasher {
  constructor() { this.cache = new Map(); }

  async hash(file) {
    const stat = await fs.promises.stat(file);
    const key = `${file}:${stat.size}:${stat.mtimeMs}`;
    let entry = this.cache.get(file);
    if (!entry || entry.key !== key) {
      entry = { key, promise: hashFile(file) };
      this.cache.set(file, entry);
      entry.promise.catch(() => this.cache.delete(file));
    }
    return entry.promise;
  }
}

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file).on('error', reject).on('data', (d) => hash.update(d)).on('end', () => resolve(hash.digest('hex')));
  });
}

// Fetches files from the other side of a connection, a few chunks at a time,
// most urgent first, checks their hash and caches them. Used by listeners (files
// from the host) and by the host (players' own sounds). Emits 'arrived' (hash,
// file) and 'failed' (hash).
class FileFetcher extends EventEmitter {
  constructor({ cacheDir, send }) {
    super();
    this.cacheDir = cacheDir;
    this.send = send;
    this.jobs = new Map(); // hash -> { ext, n, next, inFlight, received, chunks }
    this.queue = []; // hashes waiting to be fetched, most urgent first
  }

  cachePath(hash, ext) { return path.join(this.cacheDir, `${hash}.${ext}`); }

  cached(hash, ext) {
    if (!HASH_RE.test(String(hash)) || !EXT_RE.test(String(ext))) return null;
    const file = this.cachePath(hash, ext);
    return fs.existsSync(file) ? file : null;
  }

  want(hash, ext, urgent) {
    if (!HASH_RE.test(String(hash)) || !EXT_RE.test(String(ext))) return;
    if (this.cached(hash, ext)) return;
    if (!this.jobs.has(hash)) this.jobs.set(hash, { ext, n: null, next: 0, inFlight: 0, received: 0, chunks: [] });
    const queued = this.queue.indexOf(hash);
    if (queued >= 0 && !urgent) return;
    if (queued >= 0) this.queue.splice(queued, 1);
    if (urgent) this.queue.unshift(hash); else this.queue.push(hash);
    this.pump();
  }

  // Keeps a few chunk requests in flight for the most urgent file.
  pump() {
    const hash = this.queue[0];
    if (!hash) return;
    const job = this.jobs.get(hash);
    while (job.inFlight < CHUNKS_IN_FLIGHT && (job.n === null ? job.next === 0 : job.next < job.n)) {
      this.send({ t: 'need', hash, i: job.next });
      job.next++;
      job.inFlight++;
      if (job.n === null) break; // learn the chunk count first
    }
  }

  onChunk({ hash, i, n, data }) {
    const job = this.jobs.get(hash);
    if (!job || !Number.isInteger(i) || !Number.isInteger(n) || n < 1 || i < 0 || i >= n || job.chunks[i]) return;
    job.n = n;
    job.inFlight = Math.max(0, job.inFlight - 1);
    job.chunks[i] = Buffer.from(String(data || ''), 'base64');
    job.received++;
    if (job.received < n) { this.pump(); return; }
    const bytes = Buffer.concat(job.chunks);
    this.jobs.delete(hash);
    this.queue = this.queue.filter((h) => h !== hash);
    const actual = crypto.createHash('sha256').update(bytes).digest('hex');
    if (actual === hash) {
      const file = this.cachePath(hash, job.ext);
      fs.mkdirSync(this.cacheDir, { recursive: true });
      fs.writeFileSync(`${file}.tmp`, bytes);
      fs.renameSync(`${file}.tmp`, file);
      this.emit('arrived', hash, file);
    } else {
      this.emit('failed', hash);
    }
    this.pump();
  }

  onMissing(hash) {
    this.jobs.delete(hash);
    this.queue = this.queue.filter((h) => h !== hash);
    this.emit('failed', hash);
    this.pump();
  }
}

// A chunk message for part of a file.
async function chunkOf(file, hash, ext, index) {
  let handle;
  try {
    handle = await fs.promises.open(file, 'r');
    const { size } = await handle.stat();
    const total = Math.max(1, Math.ceil(size / CHUNK_SIZE));
    if (!Number.isInteger(index) || index < 0 || index >= total) return null;
    const length = Math.min(CHUNK_SIZE, size - index * CHUNK_SIZE);
    const buffer = Buffer.alloc(Math.max(0, length));
    if (length > 0) await handle.read(buffer, 0, length, index * CHUNK_SIZE);
    return { t: 'chunk', hash, i: index, n: total, ext, data: buffer.toString('base64') };
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

const PLAYER_SOUNDS = ['off', 'own', 'gm'];
const PLAYER_SOUND_LIMIT = 5;

// ---------------------------------------------------------------------------
// Host transports. Both emit 'join' (peer), 'leave' (peer), 'message' (peer, msg)
// and offer send(peer | null, msg) and close().

class LanHostTransport extends EventEmitter {
  constructor({ name }) {
    super();
    this.name = name;
    this.sockets = new Map();
    this.nextPeer = 1;
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = new WebSocketServer({ port: 0, maxPayload: MAX_MESSAGE });
      this.server.once('error', reject);
      this.server.on('listening', () => {
        this.port = this.server.address().port;
        this.publish();
        resolve();
      });
      this.server.on('connection', (socket) => {
        const peer = `l${this.nextPeer++}`;
        this.sockets.set(peer, socket);
        socket.on('error', () => {});
        socket.on('message', (data, isBinary) => {
          if (isBinary) return;
          const message = parse(data);
          if (message) this.emit('message', peer, message);
        });
        socket.on('close', () => {
          this.sockets.delete(peer);
          this.emit('leave', peer);
        });
        this.emit('join', peer);
      });
    });
  }

  publish() {
    if (!Bonjour) return;
    try {
      this.bonjour = new Bonjour();
      // Bonjour names must be unique on the network, so add a short tag.
      const tag = crypto.randomBytes(2).toString('hex');
      this.service = this.bonjour.publish({
        name: `${this.name.slice(0, 50)} (${tag})`,
        type: SERVICE_TYPE,
        port: this.port,
        txt: { name: this.name.slice(0, 60), v: String(VERSION) },
      });
      this.service.on?.('error', () => {});
    } catch {
      this.bonjour = null;
    }
  }

  send(peer, message) {
    if (peer) sendJSON(this.sockets.get(peer), message);
    else {
      const text = JSON.stringify(message);
      for (const socket of this.sockets.values()) if (socket.readyState === WebSocket.OPEN) socket.send(text);
    }
  }

  close() {
    try { this.bonjour?.unpublishAll(() => this.bonjour?.destroy()); } catch { /* ignore */ }
    for (const socket of this.sockets.values()) socket.close(1000, 'ended');
    this.server?.close();
  }
}

class RelayHostTransport extends EventEmitter {
  constructor({ url }) {
    super();
    this.base = relayUrl(url);
    this.closed = false;
    this.peers = new Set();
  }

  start() {
    if (!this.base) return Promise.reject(new Error('Set a relay server address first.'));
    return new Promise((resolve, reject) => {
      this.onFirstRoom = resolve;
      this.onFirstError = reject;
      this.connect();
    });
  }

  connect() {
    const url = new URL(this.base);
    url.searchParams.set('role', 'host');
    if (this.code) { url.searchParams.set('code', this.code); url.searchParams.set('key', this.key); }
    const socket = new WebSocket(url, { maxPayload: MAX_MESSAGE });
    this.socket = socket;
    socket.on('message', (data) => {
      const message = parse(data);
      if (!message) return;
      if (message.t === 'room') {
        this.code = message.code;
        this.key = message.key;
        this.retry = 0;
        this.emit('connected', this.code);
        if (this.onFirstRoom) { this.onFirstRoom(); this.onFirstRoom = null; this.onFirstError = null; }
      } else if (message.t === 'join') {
        this.peers.add(message.peer);
        this.emit('join', message.peer);
      } else if (message.t === 'leave') {
        this.peers.delete(message.peer);
        this.emit('leave', message.peer);
      } else if (message.t === 'msg' && message.msg && typeof message.msg.t === 'string') {
        this.emit('message', message.peer, message.msg);
      } else if (message.t === 'no-room' || message.t === 'busy') {
        this.fail(new Error(message.t === 'busy' ? 'The relay server is full right now.' : 'The session expired on the relay server.'));
      }
    });
    socket.on('error', (err) => {
      if (this.onFirstError) { this.onFirstError(new Error(`Couldn't reach the relay server (${err.message}).`)); this.onFirstRoom = null; this.onFirstError = null; this.closed = true; }
    });
    socket.on('close', () => {
      if (this.closed || this.socket !== socket) return;
      // Listeners stay in the room for a minute; reconnect and resume.
      this.emit('reconnecting');
      for (const peer of this.peers) this.emit('leave', peer);
      this.peers.clear();
      this.retry = (this.retry || 0) + 1;
      if (this.retry > 8) { this.fail(new Error('Lost the connection to the relay server.')); return; }
      this.retryTimer = setTimeout(() => this.connect(), Math.min(8000, 500 * 2 ** this.retry));
    });
  }

  fail(error) {
    this.closed = true;
    clearTimeout(this.retryTimer);
    try { this.socket?.close(); } catch { /* ignore */ }
    if (this.onFirstError) { this.onFirstError(error); this.onFirstRoom = null; this.onFirstError = null; return; }
    this.emit('failed', error);
  }

  send(peer, message) {
    sendJSON(this.socket, peer ? { t: 'send', to: peer, msg: message } : { t: 'send', msg: message });
  }

  close() {
    this.closed = true;
    clearTimeout(this.retryTimer);
    try { this.socket?.close(1000, 'ended'); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// The host: answers listeners, serves files and forwards what the board plays.

class LiveHost extends EventEmitter {
  // resolveSound(id) -> { file, ext } | null. cacheDir holds players' own sounds.
  // Emits 'peers' and 'cue' (peer, playerName, cue), where cue is
  // { kind: 'library', soundId } or { kind: 'file', hash, ext, name, file }.
  constructor({ name, transport, resolveSound, cacheDir = null, hasher = new FileHasher() }) {
    super();
    this.name = name;
    this.transport = transport;
    this.resolveSound = resolveSound;
    this.cacheDir = cacheDir;
    this.hasher = hasher;
    this.playerSounds = 'off';
    this.catalog = []; // [{ id, name, color }]: the GM's sounds players may choose
    this.peers = new Map(); // peer -> { name, device, allowed: Set<hash>, cued, lastCue, offers, fetcher, waitingCues }
    this.files = new Map(); // hash -> { file, ext }
    this.active = new Map(); // pid -> { message, group, until }
    this.ambience = { t: 'ambience', layers: [] };
    this.scene = { t: 'scene', name: null };
    this.prefetchIds = [];
    // Keeps operations in order (a play waiting on its file hash, then a stop).
    this.tail = Promise.resolve();

    transport.on('join', (peer) => this.peers.set(peer, {
      name: 'Listener', device: '', allowed: new Set(), ready: false,
      cued: new Set(), lastCue: 0, offers: new Map(), fetcher: null, waitingCues: new Set(),
    }));
    transport.on('leave', (peer) => { this.peers.delete(peer); this.emitPeers(); });
    transport.on('message', (peer, message) => this.enqueue(() => this.handle(peer, message)));
  }

  enqueue(operation) {
    this.tail = this.tail.then(operation).catch(() => {});
    return this.tail;
  }

  peerList() {
    return [...this.peers].filter(([, p]) => p.ready).map(([peer, p]) => ({ peer, name: p.name, device: p.device }));
  }

  emitPeers() { this.emit('peers', this.peerList()); }

  async handle(peer, message) {
    const info = this.peers.get(peer);
    if (!info) return;
    if (message.t === 'hello') {
      info.name = String(message.name || 'Listener').slice(0, 40);
      info.device = String(message.device || '').slice(0, 40);
      info.ready = true;
      this.transport.send(peer, { t: 'welcome', peer, host: this.name, v: VERSION });
      this.transport.send(peer, this.scene);
      this.transport.send(peer, this.rulesMessage());
      if (this.playerSounds === 'gm') this.transport.send(peer, this.catalogMessage());
      await this.sendTo(peer, this.ambience);
      const prefetch = await this.prefetchMessage();
      await this.sendTo(peer, prefetch);
      this.pruneActive();
      for (const { message: play } of this.active.values()) await this.sendTo(peer, play);
      this.emitPeers();
    } else if (message.t === 'ping') {
      this.transport.send(peer, { t: 'pong', id: message.id, t0: message.t0, t1: Date.now() });
    } else if (message.t === 'need') {
      await this.sendChunk(peer, info, String(message.hash || ''), Number(message.i) || 0);
    } else if (message.t === 'cue') {
      this.handleCue(peer, info, message);
    } else if (message.t === 'offer') {
      this.handleOffer(peer, info, message);
    } else if (message.t === 'chunk') {
      info.fetcher?.onChunk(message);
    } else if (message.t === 'missing') {
      info.fetcher?.onMissing(String(message.hash || ''));
    }
  }

  // ---- Players' sounds ----

  rulesMessage() { return { t: 'rules', playerSounds: this.playerSounds, limit: PLAYER_SOUND_LIMIT }; }

  catalogMessage() { return { t: 'catalog', sounds: this.catalog }; }

  setPlayerSounds(mode) {
    return this.enqueue(() => {
      this.playerSounds = PLAYER_SOUNDS.includes(mode) ? mode : 'off';
      for (const info of this.peers.values()) {
        info.cued.clear();
        if (this.playerSounds !== 'own') info.offers.clear();
      }
      this.broadcast(this.rulesMessage());
      if (this.playerSounds === 'gm') this.broadcast(this.catalogMessage());
    });
  }

  // items: [{ id, name, color }]: every sound except GM-only ones.
  setCatalog(items) {
    return this.enqueue(() => {
      this.catalog = (items || []).map((i) => ({ id: String(i.id), name: String(i.name || 'Sound').slice(0, 80), color: Number(i.color) || 0 }));
      if (this.playerSounds === 'gm') this.broadcast(this.catalogMessage());
    });
  }

  // Checks a player's request against the rules: the right mode, at most five
  // different sounds per player, and not too fast.
  handleCue(peer, info, message) {
    if (this.playerSounds === 'off' || !info.ready) return;
    const now = Date.now();
    if (now - info.lastCue <= 300) return;
    let key;
    let cue = null;
    if (this.playerSounds === 'gm') {
      const id = String(message.id || '');
      if (!this.catalog.some((c) => c.id === id)) return;
      key = id;
      cue = { kind: 'library', soundId: id };
    } else {
      const hash = String(message.hash || '');
      const offer = info.offers.get(hash);
      if (!offer) return;
      key = hash;
      const file = info.fetcher?.cached(hash, offer.ext);
      if (file) cue = { kind: 'file', hash, ext: offer.ext, name: offer.name, file };
      else {
        // Play it once the file arrives from the player.
        info.waitingCues.add(hash);
        info.fetcher?.want(hash, offer.ext, true);
      }
    }
    if (!info.cued.has(key) && info.cued.size >= PLAYER_SOUND_LIMIT) return;
    info.cued.add(key);
    info.lastCue = now;
    if (cue) this.emit('cue', peer, info.name, cue);
  }

  // A player's own sounds (at most five). The host fetches them ahead of time.
  handleOffer(peer, info, message) {
    if (this.playerSounds !== 'own' || !info.ready || !this.cacheDir) return;
    info.offers.clear();
    for (const item of (Array.isArray(message.sounds) ? message.sounds : []).slice(0, PLAYER_SOUND_LIMIT)) {
      const hash = String(item?.hash || '');
      const ext = String(item?.ext || '');
      if (!HASH_RE.test(hash) || !EXT_RE.test(ext)) continue;
      info.offers.set(hash, { ext, name: String(item.name || 'Sound').slice(0, 60) });
    }
    if (!info.fetcher) {
      const fetcher = new FileFetcher({ cacheDir: this.cacheDir, send: (m) => this.transport.send(peer, m) });
      fetcher.on('arrived', (hash, file) => {
        const current = this.peers.get(peer);
        const offer = current?.offers.get(hash);
        if (!offer || !current.waitingCues.has(hash)) return;
        current.waitingCues.delete(hash);
        this.emit('cue', peer, current.name, { kind: 'file', hash, ext: offer.ext, name: offer.name, file });
      });
      fetcher.on('failed', (hash) => this.peers.get(peer)?.waitingCues.delete(hash));
      info.fetcher = fetcher;
    }
    for (const [hash, offer] of info.offers) info.fetcher.want(hash, offer.ext, false);
  }

  // Sends a message that refers to files, and lets this listener fetch them.
  async sendTo(peer, message) {
    const info = this.peers.get(peer);
    if (!info) return;
    for (const hash of hashesIn(message)) info.allowed.add(hash);
    this.transport.send(peer, message);
  }

  broadcast(message) {
    const hashes = hashesIn(message);
    for (const info of this.peers.values()) for (const hash of hashes) info.allowed.add(hash);
    this.transport.send(null, message);
  }

  async sendChunk(peer, info, hash, index) {
    const entry = this.files.get(hash);
    const chunk = HASH_RE.test(hash) && info.allowed.has(hash) && entry ? await chunkOf(entry.file, hash, entry.ext, index) : null;
    this.transport.send(peer, chunk || { t: 'missing', hash });
  }

  // { hash, ext } for a library sound, registering it to be served.
  async fileFor(soundId) {
    const resolved = this.resolveSound(soundId);
    if (!resolved) return null;
    const hash = await this.hasher.hash(resolved.file);
    this.files.set(hash, resolved);
    return { hash, ext: resolved.ext };
  }

  async prefetchMessage() {
    const files = [];
    for (const id of this.prefetchIds) {
      try { const f = await this.fileFor(id); if (f) files.push(f); } catch { /* skip */ }
    }
    return { t: 'prefetch', files };
  }

  // ---- Called by the board ----

  // play: { pid, group, soundId | file: { hash, ext, file }, name, at, volume, cat, loop, gap, buzz, dur, to, by }
  // `to` (a peer id or a list of them) makes it a whisper to those listeners;
  // `by` names the player who played it.
  play(event) { return this.enqueue(() => this.doPlay(event)); }

  async doPlay(event) {
    let file;
    if (event.file) {
      const { hash, ext } = event.file;
      if (!HASH_RE.test(String(hash)) || !EXT_RE.test(String(ext)) || !event.file.file) return;
      this.files.set(hash, { file: event.file.file, ext });
      file = { hash, ext };
    } else {
      try { file = await this.fileFor(event.soundId); } catch { return; }
    }
    if (!file) return;
    const message = {
      t: 'play',
      pid: String(event.pid),
      group: String(event.group),
      hash: file.hash,
      ext: file.ext,
      name: String(event.name || ''),
      at: Number(event.at) || Date.now(),
      volume: clamp01(event.volume),
      cat: ['sfx', 'music', 'ambience'].includes(event.cat) ? event.cat : 'sfx',
      loop: !!event.loop,
      buzz: !!event.buzz,
      whisper: Array.isArray(event.to) ? event.to.length > 0 : !!event.to,
    };
    if (Number(event.gap) > 0) message.gap = Number(event.gap);
    if (event.by) message.by = String(event.by).slice(0, 40);
    const targets = Array.isArray(event.to) ? event.to : (event.to ? [event.to] : null);
    if (targets) {
      for (const peer of targets) if (this.peers.has(peer)) await this.sendTo(peer, message);
      return;
    }
    const endless = message.loop || message.gap;
    const dur = Number(event.dur);
    this.active.set(message.pid, {
      message,
      group: message.group,
      until: endless || !(dur > 0) ? Infinity : message.at + dur * 1000 + 1000,
    });
    this.broadcast(message);
  }

  stop(group) { return this.enqueue(() => this.doStop(group)); }

  doStop(group) {
    for (const [pid, entry] of this.active) if (entry.group === group) this.active.delete(pid);
    this.broadcast({ t: 'stop', group: String(group) });
  }

  volume(group, volume) { return this.enqueue(() => this.doVolume(group, volume)); }

  doVolume(group, volume) {
    for (const entry of this.active.values()) if (entry.group === group) entry.message.volume = clamp01(volume);
    this.broadcast({ t: 'volume', group: String(group), volume: clamp01(volume) });
  }

  stopAll() {
    return this.enqueue(() => {
      this.active.clear();
      this.broadcast({ t: 'stopAll' });
    });
  }

  // layers: [{ key, kind: 'builtin'|'sound', ref, name, volume }]
  setAmbience(layers) { return this.enqueue(() => this.doSetAmbience(layers)); }

  async doSetAmbience(layers) {
    const out = [];
    for (const layer of layers || []) {
      const base = { key: String(layer.key), name: String(layer.name || ''), volume: clamp01(layer.volume) };
      if (layer.kind === 'builtin') out.push({ ...base, builtin: String(layer.ref) });
      else {
        try { const f = await this.fileFor(layer.ref); if (f) out.push({ ...base, hash: f.hash, ext: f.ext }); } catch { /* skip */ }
      }
    }
    this.ambience = { t: 'ambience', layers: out };
    this.broadcast(this.ambience);
  }

  setScene(name) { return this.enqueue(() => this.doSetScene(name)); }

  doSetScene(name) {
    this.scene = { t: 'scene', name: name || null };
    this.broadcast(this.scene);
  }

  setPrefetch(soundIds) { return this.enqueue(() => this.doSetPrefetch(soundIds)); }

  async doSetPrefetch(soundIds) {
    this.prefetchIds = [...new Set(soundIds || [])];
    this.broadcast(await this.prefetchMessage());
  }

  pruneActive() {
    const now = Date.now();
    for (const [pid, entry] of this.active) if (entry.until < now) this.active.delete(pid);
  }

  end() {
    this.transport.send(null, { t: 'bye' });
    setTimeout(() => this.transport.close(), 200);
  }
}

function hashesIn(message) {
  if (message.t === 'play' && message.hash) return [message.hash];
  if (message.t === 'prefetch') return message.files.map((f) => f.hash);
  if (message.t === 'ambience') return message.layers.filter((l) => l.hash).map((l) => l.hash);
  return [];
}

function clamp01(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
}

// ---------------------------------------------------------------------------
// The listener: syncs its clock to the host, fetches and caches files and
// turns host commands into local ones.
//
// Emits 'status' ({ state, host, scene, error }), 'rules' (playerSounds),
// 'catalog' ([{ id, name, color }]) and 'command' messages with
// local times and file paths:
//   { t: 'play', pid, group, file, name, at, volume, cat, loop, gap, buzz, whisper, by }
//   { t: 'stop', group } · { t: 'volume', group, volume } · { t: 'stopAll' }
//   { t: 'ambience', layers: [{ key, file | builtin, name, volume }] }

class LiveListener extends EventEmitter {
  constructor({ cacheDir, name, device = 'Mac' }) {
    super();
    this.cacheDir = cacheDir;
    this.name = name;
    this.device = device;
    this.offset = 0; // host clock − local clock (ms)
    this.samples = [];
    this.pendingPlays = new Map(); // hash -> [play]
    this.ambienceLayers = [];
    this.offered = new Map(); // this player's own sounds on offer: hash -> { file, ext }
    this.state = 'idle';
    fs.mkdirSync(cacheDir, { recursive: true });
    this.fetcher = new FileFetcher({ cacheDir, send: (m) => sendJSON(this.socket, m) });
    this.fetcher.on('arrived', (hash, file) => this.fileArrived(hash, file));
    this.fetcher.on('failed', (hash) => this.pendingPlays.delete(hash));
  }

  connect(url) {
    this.closed = false;
    this.setState('connecting');
    const socket = new WebSocket(url, { maxPayload: MAX_MESSAGE * 2 });
    this.socket = socket;
    socket.on('open', () => sendJSON(socket, { t: 'hello', name: this.name, device: this.device, v: VERSION }));
    socket.on('message', (data) => {
      const message = parse(data);
      if (message) this.handle(message);
    });
    socket.on('error', (err) => { if (this.state === 'connecting') this.setState('error', `Couldn't connect (${err.message}).`); });
    socket.on('close', () => {
      clearInterval(this.pingTimer);
      if (this.socket !== socket) return;
      if (!this.closed && this.state !== 'error' && this.state !== 'ended') this.setState('ended', 'The session ended.');
    });
  }

  setState(state, error = null) {
    this.state = state;
    this.emit('status', { state, host: this.host || null, scene: this.scene || null, error });
  }

  localTime(hostTime) { return hostTime - this.offset; }

  handle(message) {
    switch (message.t) {
      case 'welcome':
        this.host = String(message.host || 'Game Master');
        this.setState('connected');
        this.startClockSync();
        break;
      case 'no-room': this.setState('error', 'No session with that code. Check it with your GM.'); break;
      case 'full': this.setState('error', 'That session is full.'); break;
      case 'ended':
      case 'bye':
        this.emit('command', { t: 'stopAll', ambienceToo: true });
        this.setState('ended', 'The GM ended the session.');
        this.closed = true;
        this.socket?.close();
        break;
      case 'pong': this.addClockSample(message); break;
      case 'scene':
        this.scene = message.name ? String(message.name) : null;
        this.setState(this.state);
        break;
      case 'rules':
        this.emit('rules', PLAYER_SOUNDS.includes(message.playerSounds) ? message.playerSounds : 'off');
        break;
      case 'catalog':
        this.emit('catalog', (Array.isArray(message.sounds) ? message.sounds : [])
          .filter((i) => i && i.id)
          .map((i) => ({ id: String(i.id), name: String(i.name || 'Sound'), color: Number(i.color) || 0 })));
        break;
      case 'prefetch':
        for (const f of message.files || []) this.want(f.hash, f.ext, false);
        break;
      case 'play': this.onPlay(message); break;
      case 'stop': this.dropPending(message.group); this.emit('command', { t: 'stop', group: String(message.group) }); break;
      case 'volume': this.emit('command', { t: 'volume', group: String(message.group), volume: clamp01(message.volume) }); break;
      case 'stopAll': this.pendingPlays.clear(); this.emit('command', { t: 'stopAll' }); break;
      case 'ambience':
        this.ambienceLayers = Array.isArray(message.layers) ? message.layers : [];
        for (const layer of this.ambienceLayers) if (layer.hash) this.want(layer.hash, layer.ext, true);
        this.emitAmbience();
        break;
      case 'chunk': this.fetcher.onChunk(message); break;
      case 'missing': this.fetcher.onMissing(String(message.hash)); break;
      case 'need': this.serveOffered(String(message.hash || ''), Number(message.i) || 0); break;
      default: break;
    }
  }

  // ---- Clock ----

  startClockSync() {
    let burst = 0;
    const ping = () => sendJSON(this.socket, { t: 'ping', id: crypto.randomUUID(), t0: Date.now() });
    ping();
    clearInterval(this.pingTimer);
    // A quick burst for a good first estimate, then one every 15 s.
    this.pingTimer = setInterval(() => {
      ping();
      burst++;
      if (burst === 6) { clearInterval(this.pingTimer); this.pingTimer = setInterval(ping, 15000); }
    }, 150);
  }

  addClockSample({ t0, t1 }) {
    const t2 = Date.now();
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) return;
    this.samples.push({ rtt: t2 - t0, offset: t1 - (t0 + t2) / 2 });
    if (this.samples.length > 10) this.samples.shift();
    // The round trip with the least delay gives the most accurate offset.
    this.offset = this.samples.reduce((best, s) => (s.rtt < best.rtt ? s : best)).offset;
  }

  // ---- Files ----

  cached(hash, ext) { return this.fetcher.cached(hash, ext); }

  want(hash, ext, urgent) { this.fetcher.want(hash, ext, urgent); }

  // The host fetching one of this player's own sounds.
  async serveOffered(hash, index) {
    const entry = this.offered.get(hash);
    const chunk = entry ? await chunkOf(entry.file, hash, entry.ext, index) : null;
    sendJSON(this.socket, chunk || { t: 'missing', hash });
  }

  // ---- Players' sounds ----

  // Asks the host to play one of the GM's sounds for everyone.
  cue(soundId) { sendJSON(this.socket, { t: 'cue', id: String(soundId) }); }

  // Asks the host to play one of this player's own (offered) sounds for everyone.
  cueHash(hash) { sendJSON(this.socket, { t: 'cue', hash: String(hash) }); }

  // Offers this player's own sounds (at most five): [{ file, hash, ext, name }].
  offer(sounds) {
    this.offered.clear();
    const list = [];
    for (const sound of (sounds || []).slice(0, PLAYER_SOUND_LIMIT)) {
      if (!HASH_RE.test(sound.hash) || !EXT_RE.test(sound.ext)) continue;
      this.offered.set(sound.hash, { file: sound.file, ext: sound.ext });
      list.push({ hash: sound.hash, ext: sound.ext, name: String(sound.name || 'Sound').slice(0, 60) });
    }
    sendJSON(this.socket, { t: 'offer', sounds: list });
  }

  fileArrived(hash, file) {
    const plays = this.pendingPlays.get(hash) || [];
    this.pendingPlays.delete(hash);
    for (const play of plays) this.emitPlay(play, file);
    if (this.ambienceLayers.some((l) => l.hash === hash)) this.emitAmbience();
  }

  dropPending(group) {
    for (const [hash, plays] of this.pendingPlays) {
      const left = plays.filter((p) => p.group !== group);
      if (left.length) this.pendingPlays.set(hash, left); else this.pendingPlays.delete(hash);
    }
  }

  // ---- Commands ----

  onPlay(message) {
    const hash = String(message.hash);
    const ext = String(message.ext);
    const file = this.cached(hash, ext);
    if (file) { this.emitPlay(message, file); return; }
    if (!HASH_RE.test(hash) || !EXT_RE.test(ext)) return;
    const list = this.pendingPlays.get(hash) || [];
    list.push(message);
    this.pendingPlays.set(hash, list);
    this.want(hash, ext, true);
  }

  emitPlay(message, file) {
    this.emit('command', {
      t: 'play',
      pid: String(message.pid),
      group: String(message.group),
      file,
      name: String(message.name || ''),
      at: this.localTime(Number(message.at) || Date.now()),
      volume: clamp01(message.volume),
      cat: ['sfx', 'music', 'ambience'].includes(message.cat) ? message.cat : 'sfx',
      loop: !!message.loop,
      gap: Number(message.gap) > 0 ? Number(message.gap) : 0,
      buzz: !!message.buzz,
      whisper: !!message.whisper,
      by: message.by ? String(message.by).slice(0, 40) : null,
    });
  }

  emitAmbience() {
    const layers = [];
    for (const layer of this.ambienceLayers) {
      const base = { key: String(layer.key), name: String(layer.name || ''), volume: clamp01(layer.volume) };
      if (layer.builtin) layers.push({ ...base, builtin: String(layer.builtin) });
      else {
        const file = this.cached(String(layer.hash), String(layer.ext));
        if (file) layers.push({ ...base, file });
      }
    }
    this.emit('command', { t: 'ambience', layers });
  }

  leave() {
    this.closed = true;
    clearInterval(this.pingTimer);
    try { this.socket?.close(1000, 'left'); } catch { /* ignore */ }
    this.emit('command', { t: 'stopAll', ambienceToo: true });
    this.setState('idle');
  }

  // Deletes cached files not used for `days` days.
  static pruneCache(cacheDir, days = 30) {
    let entries = [];
    try { entries = fs.readdirSync(cacheDir); } catch { return; }
    const cutoff = Date.now() - days * 86400000;
    for (const name of entries) {
      const file = path.join(cacheDir, name);
      try { if (fs.statSync(file).atimeMs < cutoff) fs.rmSync(file, { force: true }); } catch { /* ignore */ }
    }
  }
}

// Finds sessions hosted on the local network.
class LanBrowser extends EventEmitter {
  start() {
    if (!Bonjour) return;
    this.sessions = new Map();
    try {
      this.bonjour = new Bonjour();
      this.browser = this.bonjour.find({ type: SERVICE_TYPE });
      this.browser.on('up', (service) => {
        const address = (service.addresses || []).find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a) && !a.startsWith('169.254.'))
          || (service.addresses || [])[0] || service.host;
        if (!address || !service.port) return;
        const host = address.includes(':') ? `[${address}]` : address;
        this.sessions.set(service.name, { id: service.name, name: service.txt?.name || service.name, url: `ws://${host}:${service.port}` });
        this.emitList();
      });
      this.browser.on('down', (service) => { this.sessions.delete(service.name); this.emitList(); });
    } catch {
      this.bonjour = null;
    }
  }

  emitList() { this.emit('sessions', [...this.sessions.values()]); }

  stop() {
    try { this.browser?.stop(); this.bonjour?.destroy(); } catch { /* ignore */ }
    this.bonjour = null;
  }
}

function deviceName() {
  return os.hostname().replace(/\.local$/, '').replace(/[-_]/g, ' ').slice(0, 40) || 'Mac';
}

module.exports = {
  LiveHost, LiveListener, LanHostTransport, RelayHostTransport, LanBrowser, FileHasher, FileFetcher,
  PLAYER_SOUND_LIMIT,
  relayUrl, deviceName, hasBonjour: () => !!Bonjour, CHUNK_SIZE, VERSION,
};
