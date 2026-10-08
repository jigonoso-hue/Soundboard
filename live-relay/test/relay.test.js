const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');
const { createRelay } = require('../server');

// A socket that queues incoming JSON so tests can await the next message.
function connect(url) {
  const socket = new WebSocket(url);
  const queue = [];
  const waiters = [];
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString());
    const waiter = waiters.shift();
    if (waiter) waiter(message); else queue.push(message);
  });
  socket.next = () => (queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve) => waiters.push(resolve)));
  socket.sendJSON = (message) => socket.send(JSON.stringify(message));
  socket.opened = new Promise((resolve, reject) => { socket.on('open', resolve); socket.on('error', reject); });
  socket.closed = new Promise((resolve) => socket.on('close', resolve));
  return socket;
}

test('routes between a host and listeners', async () => {
  const relay = await createRelay({ port: 0, host: '127.0.0.1' });
  const base = `ws://127.0.0.1:${relay.port}/live`;
  try {
    const host = connect(`${base}?role=host`);
    const room = await host.next();
    assert.equal(room.t, 'room');
    assert.match(room.code, /^[A-Z2-9]{5}$/);

    const a = connect(`${base}?role=listen&code=${room.code.toLowerCase()}`);
    const join = await host.next();
    assert.deepEqual(join, { t: 'join', peer: 'p1' });
    const b = connect(`${base}?role=listen&code=${room.code}`);
    assert.deepEqual(await host.next(), { t: 'join', peer: 'p2' });
    await Promise.all([a.opened, b.opened]);

    a.sendJSON({ t: 'hello', name: 'Sam' });
    assert.deepEqual(await host.next(), { t: 'msg', peer: 'p1', msg: { t: 'hello', name: 'Sam' } });

    host.sendJSON({ t: 'send', msg: { t: 'stopAll' } });
    assert.deepEqual(await a.next(), { t: 'stopAll' });
    assert.deepEqual(await b.next(), { t: 'stopAll' });

    host.sendJSON({ t: 'send', to: 'p2', msg: { t: 'play', whisper: true } });
    assert.deepEqual(await b.next(), { t: 'play', whisper: true });

    a.close();
    assert.deepEqual(await host.next(), { t: 'leave', peer: 'p1' });
    host.close();
    b.close();
  } finally {
    await relay.close();
  }
});

test('unknown codes are refused and the host can resume', async () => {
  const relay = await createRelay({ port: 0, host: '127.0.0.1' });
  const base = `ws://127.0.0.1:${relay.port}/live`;
  try {
    const stray = connect(`${base}?role=listen&code=ZZZZZ`);
    assert.deepEqual(await stray.next(), { t: 'no-room' });
    await stray.closed;

    const host = connect(`${base}?role=host`);
    const { code, key } = await host.next();
    const listener = connect(`${base}?role=listen&code=${code}`);
    await host.next();
    host.close();
    await host.closed;

    const thief = connect(`${base}?role=host&code=${code}&key=wrong`);
    assert.deepEqual(await thief.next(), { t: 'no-room' });

    const back = connect(`${base}?role=host&code=${code}&key=${key}`);
    assert.equal((await back.next()).code, code);
    assert.deepEqual(await back.next(), { t: 'join', peer: 'p1' });
    back.sendJSON({ t: 'send', msg: { t: 'scene', name: 'Tavern' } });
    assert.deepEqual(await listener.next(), { t: 'scene', name: 'Tavern' });
    back.close();
    listener.close();
  } finally {
    await relay.close();
  }
});

test('the host can kick a listener', async () => {
  const relay = await createRelay({ port: 0, host: '127.0.0.1' });
  const base = `ws://127.0.0.1:${relay.port}/live`;
  try {
    const host = connect(`${base}?role=host`);
    const room = await host.next();
    const a = connect(`${base}?role=listen&code=${room.code}`);
    assert.deepEqual(await host.next(), { t: 'join', peer: 'p1' });
    await a.opened;
    host.sendJSON({ t: 'kick', peer: 'p1' });
    assert.deepEqual(await a.next(), { t: 'kicked' });
    await a.closed;
    assert.deepEqual(await host.next(), { t: 'leave', peer: 'p1' });
    host.close();
  } finally {
    await relay.close();
  }
});

test('serves the Privacy Policy, Terms of Use and Licenses', async () => {
  const relay = await createRelay({ port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${relay.port}`;
  try {
    for (const [route, heading] of [['/privacy', 'Privacy Policy'], ['/terms', 'Terms of Use'], ['/licenses/', 'Licenses']]) {
      const res = await fetch(base + route);
      assert.equal(res.status, 200, route);
      assert.match(res.headers.get('content-type'), /text\/html/);
      const html = await res.text();
      assert.match(html, new RegExp(`<h1>${heading}</h1>`));
      assert.doesNotMatch(html, /\{\{\w+\}\}/, `${route} has every detail filled in`);
    }
    assert.equal((await fetch(`${base}/privacy.html`)).status, 404);
    assert.equal((await fetch(`${base}/../server.js`)).status, 404);
  } finally {
    await relay.close();
  }
});
