// Sending a whole library online with a code, through the Live Session relay
// (live-relay/). The sender opens a room like a broadcaster and gets a
// 5-character code; whoever types the code joins the room and pulls the
// library file (the same zip as Share your library, LIBRARY-FORMAT.md) in
// 256 KB pieces, then imports it. Nothing is stored on the relay, so both
// apps must be open at the same time. Any number of people can receive
// while the sender keeps it open.
//
// Plain JavaScript over a small socket interface, run by the Mac's main
// process (a Node WebSocket) and by Android's web screens (a native socket).
// The iPhone/iPad app speaks the same messages in Model/LibrarySend.swift.
//
//   socket = open(url): { send(text), close(), onOpen(), onMessage(text), onClose(reason) }
//
// Receiver → sender: { t: 'lib-hello', v, name }, { t: 'lib-need', i },
//                    { t: 'lib-done', message }, { t: 'lib-fail', error }
// Sender → receiver: { t: 'lib-offer', v, name, bytes, n, chunk, sounds, bashes, kits },
//                    { t: 'lib-chunk', i, data (base64) }, { t: 'lib-error', error },
//                    { t: 'lib-stopped' } (then the room closes)

const CHUNK = 256 * 1024;
const VERSION = 1;
const MAX_BYTES = 0xffffffff;
// Pieces asked for at once: enough to keep the line busy, few enough for the relay.
const WINDOW = 4;
const OFFER_TIMEOUT = 20000;

const clean = (value, max = 40) => String(value ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);

// What the user typed ("relay.example.com", "https://…") as the relay's WebSocket URL.
function relayUrl(input) {
  let text = String(input || '').trim().replace(/\/+$/, '');
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) text = text.replace(/^http/i, 'ws');
  else if (!/^wss?:\/\//i.test(text)) text = `wss://${text}`;
  if (!/\/live$/.test(text)) text += '/live';
  return text;
}

const cleanCode = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

// Sends one library file to everyone who comes with the code, until stop().
// readChunk(i) → base64 of piece i. onStatus({ code, receivers, error }):
// receivers [{ peer, name, got, n, done, message, failed, left }].
function startSender({ open, relay, size, readChunk, summary = {}, name = 'Someone', onStatus = () => {} }) {
  const base = relayUrl(relay);
  if (!base) throw new Error('Set a relay server address first.');
  if (!(size > 0) || size > MAX_BYTES) throw new Error('The library is too big to send (over 4 GB).');
  const n = Math.ceil(size / CHUNK);
  const receivers = new Map();
  let code = null;
  let stopped = false;
  const status = (extra = {}) => onStatus({ code, receivers: [...receivers.values()].map((r) => ({ ...r })), ...extra });
  const sendTo = (peer, msg) => socket.send(JSON.stringify({ t: 'send', to: peer, msg }));

  const socket = open(`${base}?role=host`);
  socket.onMessage = async (text) => {
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (!m || stopped) return;
    if (m.t === 'room') { code = m.code; status(); return; }
    if (m.t === 'busy') { status({ error: 'The relay is busy right now. Try again in a minute.' }); return; }
    if (m.t === 'leave') {
      const r = receivers.get(m.peer);
      if (r && !r.done) { r.left = true; status(); }
      return;
    }
    if (m.t !== 'msg' || !m.msg || typeof m.peer !== 'string') return;
    const { peer, msg } = m;
    const r = receivers.get(peer);
    switch (msg.t) {
      case 'lib-hello':
        receivers.set(peer, { peer, name: clean(msg.name) || 'Someone', got: 0, n, done: false });
        sendTo(peer, {
          t: 'lib-offer', v: VERSION, name: clean(name), bytes: size, n, chunk: CHUNK,
          sounds: summary.sounds || 0, bashes: summary.bashes || 0, kits: summary.kits || 0,
        });
        status();
        break;
      case 'lib-need': {
        const i = Number(msg.i);
        if (!r || !Number.isInteger(i) || i < 0 || i >= n) return;
        try {
          const data = await readChunk(i);
          if (stopped) return;
          sendTo(peer, { t: 'lib-chunk', i, data });
          r.got = Math.max(r.got, i + 1);
          status();
        } catch {
          sendTo(peer, { t: 'lib-error', error: 'The sender couldn’t read the library file.' });
        }
        break;
      }
      case 'lib-done':
        if (r) { r.done = true; r.got = n; r.message = clean(msg.message, 200); status(); }
        break;
      case 'lib-fail':
        if (r) { r.failed = clean(msg.error, 200) || 'It didn’t work.'; status(); }
        break;
      default:
        break; // a Live Session listener with the wrong code, or something newer
    }
  };
  socket.onClose = () => { if (!stopped) status({ error: 'Lost the connection to the relay. Send again to get a new code.' }); };
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      // Tell anyone mid-way, then close the room (relays too old for "end"
      // hold it a minute; a receiver then times out asking for an offer).
      socket.send(JSON.stringify({ t: 'send', msg: { t: 'lib-stopped' } }));
      socket.send(JSON.stringify({ t: 'end' }));
      setTimeout(() => socket.close(), 300);
    },
  };
}

// Receives a library with a code. writeChunk(i, base64) is called for each
// piece in order; finish() imports the file and resolves to { message }.
// onStatus({ phase: 'connecting'|'receiving'|'importing'|'done'|'error', offer, progress, message, error }).
function startReceiver({ open, relay, code, name = 'Someone', writeChunk, finish, onStatus = () => {} }) {
  const base = relayUrl(relay);
  if (!base) throw new Error('Set a relay server address first.');
  const clean5 = cleanCode(code);
  if (clean5.length < 4) throw new Error('Enter the code from whoever is sending.');
  let offer = null;
  let next = 0;
  let written = 0;
  let inFlight = 0;
  let over = false;
  let writing = Promise.resolve();
  const waiting = new Map();
  const socket = open(`${base}?role=listen&code=${clean5}`);
  const send = (msg) => socket.send(JSON.stringify(msg));
  const fail = (error) => {
    if (over) return;
    over = true;
    clearTimeout(timer);
    onStatus({ phase: 'error', offer, error });
    socket.close();
  };
  const timer = setTimeout(() => fail('Nothing is being sent with that code. Check it and try again.'), OFFER_TIMEOUT);
  const pump = () => {
    while (!over && offer && inFlight < WINDOW && next < offer.n) {
      send({ t: 'lib-need', i: next });
      next += 1;
      inFlight += 1;
    }
  };
  onStatus({ phase: 'connecting' });

  socket.onOpen = () => send({ t: 'lib-hello', v: VERSION, name: clean(name) });
  socket.onMessage = (text) => {
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (!m || over) return;
    switch (m.t) {
      case 'no-room': fail('Nothing is being sent with that code. Check it and try again.'); break;
      case 'full': fail('Too many people are receiving this right now. Try again in a minute.'); break;
      case 'ended': fail('The sender stopped before everything arrived.'); break;
      case 'lib-error': fail(clean(m.error, 200) || 'The sender couldn’t send the library.'); break;
      case 'lib-stopped': fail('The sender stopped before everything arrived.'); break;
      case 'lib-offer': {
        const bytes = Number(m.bytes);
        const chunk = Number(m.chunk) || CHUNK;
        if (offer || !(bytes > 0) || bytes > MAX_BYTES || chunk !== CHUNK || Number(m.n) !== Math.ceil(bytes / CHUNK)) {
          if (!offer) fail('That code isn’t a library from a version of Dungeon Radio this one can read.');
          return;
        }
        clearTimeout(timer);
        offer = {
          name: clean(m.name) || 'Someone', bytes, n: Number(m.n),
          sounds: Number(m.sounds) || 0, bashes: Number(m.bashes) || 0, kits: Number(m.kits) || 0,
        };
        onStatus({ phase: 'receiving', offer, progress: 0 });
        pump();
        break;
      }
      case 'lib-chunk': {
        const i = Number(m.i);
        if (!offer || !Number.isInteger(i) || i < 0 || i >= offer.n || typeof m.data !== 'string' || waiting.has(i) || i < written) return;
        // A piece is at most 256 KB (base64 is 4/3 of that).
        if (m.data.length > Math.ceil(CHUNK / 3) * 4) { fail('The library arrived damaged.'); return; }
        inFlight -= 1;
        waiting.set(i, m.data);
        // Written strictly in order, one at a time.
        writing = writing.then(async () => {
          while (!over && waiting.has(written)) {
            const data = waiting.get(written);
            waiting.delete(written);
            await writeChunk(written, data);
            written += 1;
            onStatus({ phase: 'receiving', offer, progress: written / offer.n });
          }
          if (over) return;
          if (written === offer.n) {
            onStatus({ phase: 'importing', offer, progress: 1 });
            try {
              const result = await finish(offer);
              over = true;
              send({ t: 'lib-done', message: result.message });
              onStatus({ phase: 'done', offer, progress: 1, message: result.message });
            } catch (err) {
              send({ t: 'lib-fail', error: err.message });
              fail(err.message);
              return;
            }
            setTimeout(() => socket.close(), 500);
          } else {
            pump();
          }
        }).catch((err) => fail(err.message || 'Couldn’t save the library.'));
        break;
      }
      default:
        break;
    }
  };
  socket.onClose = () => { if (!over) fail('Lost the connection to the relay.'); };
  return {
    cancel() {
      if (over) return;
      over = true;
      clearTimeout(timer);
      socket.close();
    },
  };
}

// The socket interface over a Node WebSocket class (the 'ws' package), for the Mac.
function nodeSocket(WebSocket) {
  return (url) => {
    const ws = new WebSocket(url, { maxPayload: 2 * 1024 * 1024 });
    let closed = false;
    const socket = {
      send: (text) => { if (ws.readyState === WebSocket.OPEN) ws.send(text); },
      close: () => { closed = true; try { ws.close(); } catch { /* gone */ } },
    };
    const ended = (reason) => {
      if (closed) return;
      closed = true;
      if (socket.onClose) socket.onClose(reason);
    };
    ws.on('open', () => { if (socket.onOpen) socket.onOpen(); });
    ws.on('message', (data, isBinary) => { if (!isBinary && socket.onMessage) socket.onMessage(data.toString()); });
    ws.on('close', () => ended());
    ws.on('error', (err) => ended(err.message));
    return socket;
  };
}

module.exports = { CHUNK, VERSION, relayUrl, cleanCode, startSender, startReceiver, nodeSocket };
