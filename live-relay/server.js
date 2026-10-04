// Relay server for Dungeon Radio Live Sessions over the internet.
//
// One host and any number of listeners share a room, found by a short code.
// The relay only routes messages: listener messages go to the host (wrapped
// with the listener's id), and host messages go to every listener or to one.
// See PROTOCOL.md.

const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I
const MAX_MESSAGE = 1024 * 1024;
const MAX_LISTENERS = 32;
const MAX_ROOMS = 500;
const RESUME_GRACE_MS = 60 * 1000;
const HEARTBEAT_MS = 30 * 1000;
// A listener whose connection has this much unsent data is dropped rather than
// letting the relay's memory grow without limit.
const MAX_BUFFERED = 16 * 1024 * 1024;

function makeCode(rooms) {
  for (;;) {
    let code = '';
    for (const byte of crypto.randomBytes(5)) code += CODE_LETTERS[byte % CODE_LETTERS.length];
    if (!rooms.has(code)) return code;
  }
}

function sameSecret(a, b) {
  const hash = (text) => crypto.createHash('sha256').update(String(text)).digest();
  return crypto.timingSafeEqual(hash(a), hash(b));
}

function send(socket, message) {
  if (socket && socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

function createRelay({ port = 8787, host = '0.0.0.0', log = () => {} } = {}) {
  const rooms = new Map(); // code -> { key, host, listeners: Map<peer, socket>, nextPeer, endTimer }

  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`ok ${rooms.size} rooms\n`);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server, path: '/live', maxPayload: MAX_MESSAGE });

  function endRoom(code) {
    const room = rooms.get(code);
    if (!room) return;
    clearTimeout(room.endTimer);
    rooms.delete(code);
    for (const socket of room.listeners.values()) {
      send(socket, { t: 'ended' });
      socket.close(1000, 'ended');
    }
    log(`room ${code} ended`);
  }

  function attachHost(socket, room, code) {
    room.host = socket;
    clearTimeout(room.endTimer);
    send(socket, { t: 'room', code, key: room.key });
    // A resumed host learns who is still connected.
    for (const peer of room.listeners.keys()) send(socket, { t: 'join', peer });

    socket.on('message', (data, isBinary) => {
      if (isBinary) return;
      let message;
      try { message = JSON.parse(data.toString()); } catch { return; }
      if (!message || message.t !== 'send' || typeof message.msg !== 'object') return;
      const text = JSON.stringify(message.msg);
      const targets = message.to ? [room.listeners.get(message.to)] : [...room.listeners.values()];
      for (const target of targets) {
        if (!target || target.readyState !== target.OPEN) continue;
        if (target.bufferedAmount > MAX_BUFFERED) { target.close(1013, 'too slow'); continue; }
        target.send(text);
      }
    });
    socket.on('close', () => {
      if (room.host !== socket) return;
      room.host = null;
      if (!rooms.has(code)) return;
      // Give the host a minute to come back (a Wi-Fi blip, a phone waking up).
      room.endTimer = setTimeout(() => endRoom(code), RESUME_GRACE_MS);
    });
  }

  wss.on('connection', (socket, req) => {
    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; });
    socket.on('error', () => {});

    const url = new URL(req.url, 'http://relay');
    const role = url.searchParams.get('role');
    const code = (url.searchParams.get('code') || '').toUpperCase();

    if (role === 'host') {
      if (code) {
        const room = rooms.get(code);
        const key = url.searchParams.get('key') || '';
        if (!room || room.host || !sameSecret(room.key, key)) {
          send(socket, { t: 'no-room' });
          socket.close(1008, 'no room');
          return;
        }
        attachHost(socket, room, code);
        log(`room ${code} resumed`);
        return;
      }
      if (rooms.size >= MAX_ROOMS) {
        send(socket, { t: 'busy' });
        socket.close(1013, 'busy');
        return;
      }
      const newCode = makeCode(rooms);
      const room = { key: crypto.randomBytes(24).toString('hex'), host: null, listeners: new Map(), nextPeer: 1, endTimer: null };
      rooms.set(newCode, room);
      attachHost(socket, room, newCode);
      log(`room ${newCode} opened`);
      return;
    }

    if (role === 'listen') {
      const room = rooms.get(code);
      if (!room) {
        send(socket, { t: 'no-room' });
        socket.close(1008, 'no room');
        return;
      }
      if (room.listeners.size >= MAX_LISTENERS) {
        send(socket, { t: 'full' });
        socket.close(1013, 'full');
        return;
      }
      const peer = `p${room.nextPeer++}`;
      room.listeners.set(peer, socket);
      send(room.host, { t: 'join', peer });
      socket.on('message', (data, isBinary) => {
        if (isBinary) return;
        let message;
        try { message = JSON.parse(data.toString()); } catch { return; }
        send(room.host, { t: 'msg', peer, msg: message });
      });
      socket.on('close', () => {
        if (room.listeners.get(peer) !== socket) return;
        room.listeners.delete(peer);
        send(room.host, { t: 'leave', peer });
      });
      return;
    }

    socket.close(1008, 'bad role');
  });

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.isAlive) { socket.terminate(); continue; }
      socket.isAlive = false;
      socket.ping();
    }
  }, HEARTBEAT_MS);

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      resolve({
        port: server.address().port,
        rooms,
        close: () => new Promise((done) => {
          clearInterval(heartbeat);
          for (const code of [...rooms.keys()]) endRoom(code);
          for (const socket of wss.clients) socket.terminate();
          wss.close();
          server.close(() => done());
        }),
      });
    });
  });
}

module.exports = { createRelay };

if (require.main === module) {
  const port = Number(process.env.PORT) || 8787;
  createRelay({ port, log: (line) => console.log(new Date().toISOString(), line) })
    .then(({ port: actual }) => console.log(`Dungeon Radio relay listening on :${actual} (ws path /live)`));
}
