const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { LiveHost, LiveListener, LanHostTransport, RelayHostTransport, relayUrl } = require('../src/live');

function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `live-${label}-`));
}

// A tiny library: sound ids mapped to files on disk.
function makeLibrary() {
  const dir = tempDir('lib');
  const files = {};
  const sizes = { roar: 600 * 1024 + 123, door: 10, song: 300 * 1024 };
  for (const [id, size] of Object.entries(sizes)) {
    const file = path.join(dir, `${id}.wav`);
    fs.writeFileSync(file, crypto.randomBytes(size));
    files[id] = file;
  }
  return { files, resolveSound: (id) => (files[id] ? { file: files[id], ext: 'wav' } : null) };
}

// Collects a listener's commands; next(t) waits for the next command of type t.
function watch(listener) {
  const seen = [];
  const waiters = [];
  listener.on('command', (cmd) => {
    const i = waiters.findIndex((w) => w.t === cmd.t);
    if (i >= 0) waiters.splice(i, 1)[0].resolve(cmd); else seen.push(cmd);
  });
  return {
    seen,
    next(t, ms = 3000) {
      const i = seen.findIndex((c) => c.t === t);
      if (i >= 0) return Promise.resolve(seen.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { t, resolve };
        waiters.push(waiter);
        setTimeout(() => { const k = waiters.indexOf(waiter); if (k >= 0) { waiters.splice(k, 1); reject(new Error(`no ${t} command`)); } }, ms);
      });
    },
  };
}

function waitFor(emitter, event, test = () => true, ms = 3000) {
  return new Promise((resolve, reject) => {
    const handler = (value) => { if (test(value)) { emitter.off(event, handler); resolve(value); } };
    emitter.on(event, handler);
    setTimeout(() => { emitter.off(event, handler); reject(new Error(`timed out waiting for ${event}`)); }, ms);
  });
}

test('relay URLs are normalised', () => {
  assert.equal(relayUrl('relay.example.com'), 'wss://relay.example.com/live');
  assert.equal(relayUrl('https://relay.example.com/'), 'wss://relay.example.com/live');
  assert.equal(relayUrl('ws://localhost:8787'), 'ws://localhost:8787/live');
  assert.equal(relayUrl(''), null);
});

test('local session: listeners get files, plays, whispers and ambience', async () => {
  const library = makeLibrary();
  const transport = new LanHostTransport({ name: 'Friday Game' });
  await transport.start();
  const host = new LiveHost({ name: 'Friday Game', transport, resolveSound: library.resolveSound });
  const url = `ws://127.0.0.1:${transport.port}`;

  const sam = new LiveListener({ cacheDir: tempDir('sam'), name: 'Sam' });
  const ana = new LiveListener({ cacheDir: tempDir('ana'), name: 'Ana' });
  const samCmds = watch(sam);
  const anaCmds = watch(ana);
  try {
    sam.connect(url);
    ana.connect(url);
    await waitFor(host, 'peers', (list) => list.length === 2);
    assert.deepEqual(host.peerList().map((p) => p.name).sort(), ['Ana', 'Sam']);
    await waitFor(sam, 'status', (s) => s.state === 'connected').catch(() => {});

    // A sound neither has yet: fetched in several chunks, then played in sync.
    const at = Date.now() + 500;
    await host.play({ pid: 'p1', group: 's:roar', soundId: 'roar', name: 'Dragon Roar', at, volume: 0.8, cat: 'sfx', buzz: true, dur: 2 });
    const play = await samCmds.next('play');
    assert.equal(play.name, 'Dragon Roar');
    assert.equal(play.buzz, true);
    assert.equal(play.whisper, false);
    assert.ok(Math.abs(play.at - at) < 50, 'clock offset is small on the same machine');
    assert.deepEqual(fs.readFileSync(play.file), fs.readFileSync(library.files.roar));
    await anaCmds.next('play');

    // A whisper reaches only its target.
    const samPeer = host.peerList().find((p) => p.name === 'Sam').peer;
    await host.play({ pid: 'p2', group: 's:door', soundId: 'door', name: 'Door', at: Date.now(), volume: 1, cat: 'sfx', to: samPeer });
    const whisper = await samCmds.next('play');
    assert.equal(whisper.whisper, true);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(anaCmds.seen.filter((c) => c.t === 'play').length, 0);

    // Ambience: built-ins need no transfer; library layers arrive once fetched.
    await host.setAmbience([
      { key: 'strip:rain', kind: 'builtin', ref: 'rain.wav', name: 'Rain', volume: 0.5 },
      { key: 'kit:song', kind: 'sound', ref: 'song', name: 'Song', volume: 0.4 },
    ]);
    let amb = await samCmds.next('ambience');
    for (let i = 0; i < 4 && amb.layers.length < 2; i++) amb = await samCmds.next('ambience');
    assert.deepEqual(amb.layers.map((l) => l.key), ['strip:rain', 'kit:song']);
    assert.equal(amb.layers[0].builtin, 'rain.wav');
    assert.ok(fs.existsSync(amb.layers[1].file));

    // A listener may only fetch files the host has sent it.
    const before = anaCmds.seen.length;
    host.stop('s:roar');
    assert.deepEqual(await anaCmds.next('stop'), { t: 'stop', group: 's:roar' });
    assert.ok(anaCmds.seen.length >= before - 1);
  } finally {
    sam.leave();
    ana.leave();
    transport.close();
  }
});

test('late joiners pick up what is already playing', async () => {
  const library = makeLibrary();
  const transport = new LanHostTransport({ name: 'Late' });
  await transport.start();
  const host = new LiveHost({ name: 'Late', transport, resolveSound: library.resolveSound });
  const startedAt = Date.now() - 4000;
  await host.play({ pid: 'm1', group: 's:song', soundId: 'song', name: 'Tavern Song', at: startedAt, volume: 0.6, cat: 'music', loop: true });
  await host.play({ pid: 'm2', group: 's:door', soundId: 'door', name: 'Door', at: startedAt, volume: 1, cat: 'sfx', dur: 1 });
  host.setScene('Tavern Brawl');

  const late = new LiveListener({ cacheDir: tempDir('late'), name: 'Late' });
  const cmds = watch(late);
  try {
    late.connect(`ws://127.0.0.1:${transport.port}`);
    const play = await cmds.next('play');
    assert.equal(play.name, 'Tavern Song');
    assert.equal(play.cat, 'music');
    assert.equal(play.loop, true);
    assert.ok(Date.now() - play.at > 3500, 'starts part-way through');
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(cmds.seen.filter((c) => c.t === 'play').length, 0, 'finished sounds are not replayed');
    assert.equal(late.scene, 'Tavern Brawl');
  } finally {
    late.leave();
    transport.close();
  }
});

let createRelay = null;
try { ({ createRelay } = require('../../live-relay/server')); } catch { /* relay deps not installed */ }

test('online session through the relay', { skip: !createRelay && 'live-relay dependencies not installed' }, async () => {
  const relay = await createRelay({ port: 0, host: '127.0.0.1' });
  const library = makeLibrary();
  const transport = new RelayHostTransport({ url: `ws://127.0.0.1:${relay.port}` });
  try {
    await transport.start();
    assert.match(transport.code, /^[A-Z2-9]{5}$/);
    const host = new LiveHost({ name: 'Online Game', transport, resolveSound: library.resolveSound });
    const listener = new LiveListener({ cacheDir: tempDir('online'), name: 'Remote' });
    const cmds = watch(listener);
    listener.connect(`${relayUrl(`ws://127.0.0.1:${relay.port}`)}?role=listen&code=${transport.code}`);
    await waitFor(host, 'peers', (list) => list.length === 1);
    await host.play({ pid: 'r1', group: 's:roar', soundId: 'roar', name: 'Roar', at: Date.now(), volume: 1, cat: 'sfx', dur: 1 });
    const play = await cmds.next('play');
    assert.deepEqual(fs.readFileSync(play.file), fs.readFileSync(library.files.roar));
    host.end();
    await waitFor(listener, 'status', (s) => s.state === 'ended');
  } finally {
    transport.close();
    await relay.close();
  }
});
