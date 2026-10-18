const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const { Library } = require('../src/library');
const { BashStore } = require('../src/bashes');
const { KitStore } = require('../src/kits');
const Share = require('../src/library-share');
const Send = require('../src/library-send');

let createRelay = null;
try { ({ createRelay } = require('../../live-relay/server')); } catch { /* relay deps not installed */ }
const skip = !createRelay && 'live-relay dependencies not installed';

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
const stores = (dir) => ({ library: new Library(dir), bashes: new BashStore(dir), kits: new KitStore(dir) });
const noise = (n) => Buffer.from(Array.from({ length: n }, () => Math.floor(Math.random() * 256)));
const open = Send.nodeSocket(WebSocket);
const until = async (fn, label, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 20)); }
  throw new Error(`Timed out: ${label}`);
};

// As the Mac's main process does it: the zip in a file, read and written a piece at a time.
function sendFile(relay, file, summary, onStatus) {
  const size = fs.statSync(file).size;
  const readChunk = async (i) => {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(Math.min(Send.CHUNK, size - i * Send.CHUNK));
      fs.readSync(fd, buf, 0, buf.length, i * Send.CHUNK);
      return buf.toString('base64');
    } finally { fs.closeSync(fd); }
  };
  return Send.startSender({ open, relay, size, readChunk, summary, name: 'Jon’s Mac', onStatus });
}
function receiveInto(relay, code, target, onStatus) {
  const file = path.join(tmp('recv'), 'in.zip');
  return Send.startReceiver({
    open, relay, code, name: 'Sam',
    writeChunk: async (i, data) => fs.appendFileSync(file, Buffer.from(data, 'base64')),
    finish: async (offer) => {
      assert.equal(fs.statSync(file).size, offer.bytes);
      const added = Share.importFromZip(file, target);
      return { ...added, message: Share.describeImport(added) };
    },
    onStatus,
  });
}

test('a library sent with a code arrives in two other libraries', { skip }, async () => {
  const relayServer = await createRelay({ port: 0, host: '127.0.0.1' });
  const relay = `ws://127.0.0.1:${relayServer.port}`;
  try {
    // A library bigger than a few pieces, so it takes many round trips.
    const a = stores(tmp('send-a'));
    for (let i = 0; i < 3; i++) a.library.add({ name: `Song ${i}`, data: noise(400 * 1024), ext: 'mp3', kind: 'full', duration: 90 });
    const kit = a.kits.create({ name: 'The Inn' });
    a.kits.addItems(kit.id, a.library.list().map((s) => ({ type: 'sound', id: s.id })), null, a.library.list());
    const zip = path.join(tmp('zip'), 'lib.zip');
    const summary = Share.exportToZip(zip, a);

    let sent = {};
    const sender = sendFile(relay, zip, summary, (s) => { sent = s; });
    const code = await until(() => sent.code, 'a code');
    assert.match(code, /^[A-Z2-9]{5}$/);

    const b = stores(tmp('recv-b'));
    const c = stores(tmp('recv-c'));
    const seenB = [];
    let lastC = {};
    receiveInto(relay, code.toLowerCase(), b, (s) => seenB.push(s));
    receiveInto(relay, ` ${code} `, c, (s) => { lastC = s; });
    const doneB = await until(() => seenB.find((s) => s.phase === 'done' || s.phase === 'error'), 'b done');
    await until(() => lastC.phase === 'done' || lastC.phase === 'error', 'c done');
    assert.equal(doneB.phase, 'done', doneB.error);
    assert.equal(doneB.message, 'Added 3 sounds and 1 scene kit.');
    assert.equal(lastC.message, 'Added 3 sounds and 1 scene kit.');
    const offer = seenB.find((s) => s.offer).offer;
    assert.deepEqual([offer.name, offer.sounds, offer.kits], ['Jon’s Mac', 3, 1]);
    assert.ok(seenB.some((s) => s.phase === 'receiving' && s.progress > 0 && s.progress < 1), 'progress along the way');
    assert.equal(b.library.list().length, 3);
    assert.equal(b.kits.list()[0].sections.reduce((n, s) => n + s.items.length, 0), 3);

    // The sender sees who got it and what they added.
    await until(() => sent.receivers && sent.receivers.filter((r) => r.done).length === 2, 'sender sees both');
    assert.deepEqual(sent.receivers.map((r) => r.name), ['Sam', 'Sam']);
    assert.equal(sent.receivers[0].message, 'Added 3 sounds and 1 scene kit.');

    // After Stop, the code no longer works.
    sender.stop();
    await new Promise((r) => setTimeout(r, 200));
    let late = {};
    receiveInto(relay, code, stores(tmp('late')), (s) => { late = s; });
    await until(() => late.phase === 'error', 'late error');
    assert.match(late.error, /Nothing is being sent with that code/);
  } finally {
    await relayServer.close();
  }
});

test('a Live Session code, or a sender that leaves halfway, ends with a clear message', { skip }, async () => {
  const relayServer = await createRelay({ port: 0, host: '127.0.0.1' });
  const relay = `ws://127.0.0.1:${relayServer.port}`;
  try {
    // A room whose host never offers a library (a Live Session).
    const host = open(`${relay}/live?role=host`);
    let liveCode = null;
    host.onMessage = (text) => { const m = JSON.parse(text); if (m.t === 'room') liveCode = m.code; };
    await until(() => liveCode, 'live code');
    let s = {};
    const receiver = Send.startReceiver({ open, relay, code: liveCode, writeChunk: async () => {}, finish: async () => ({}), onStatus: (x) => { s = x; } });
    assert.equal(s.phase, 'connecting');
    receiver.cancel();
    host.close();

    // The sender stops in the middle.
    const zip = path.join(tmp('zip2'), 'big.zip');
    fs.writeFileSync(zip, noise(3 * Send.CHUNK));
    let sent = {};
    let reads = 0;
    const sender = Send.startSender({
      open, relay, size: fs.statSync(zip).size, summary: { sounds: 1 },
      readChunk: async (i) => { reads += 1; if (i >= 1) await new Promise((r) => setTimeout(r, 300)); return fs.readFileSync(zip).subarray(i * Send.CHUNK, (i + 1) * Send.CHUNK).toString('base64'); },
      onStatus: (x) => { sent = x; },
    });
    await until(() => sent.code, 'code');
    let got = {};
    Send.startReceiver({ open, relay, code: sent.code, writeChunk: async () => {}, finish: async () => ({ message: 'x' }), onStatus: (x) => { got = x; } });
    await until(() => reads >= 1, 'a read');
    sender.stop();
    await until(() => got.phase === 'error', 'receiver error');
    assert.match(got.error, /stopped before everything arrived|Lost the connection/);

    assert.throws(() => Send.startReceiver({ open, relay, code: '!!', writeChunk: async () => {}, finish: async () => ({}) }), /Enter the code/);
    assert.equal(Send.relayUrl('soundboard.example.com'), 'wss://soundboard.example.com/live');
  } finally {
    await relayServer.close();
  }
});
