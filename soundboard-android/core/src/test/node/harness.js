// Interop harness for the Android core's tests: runs the Mac app's real Live
// engine (soundboard-mac/src/live.js) and the real relay, driven by JSON lines
// on stdin, reporting what happens as JSON lines on stdout.
//
//   node harness.js relay                → { ev: 'relay', port }
//   node harness.js host-lan <soundFile> → { ev: 'hosting', port }
//   node harness.js host-relay <relayUrl> <soundFile> → { ev: 'hosting', code }
//   node harness.js listen <url> <name>  → events as the listener sees them
//
// Commands (stdin): { do: 'play' }, { do: 'handout', file, to? }, { do: 'avatar', data },
// { do: 'color', color }, { do: 'roll' }, { do: 'game', action, kind? }, { do: 'buzz', id },
// { do: 'end' }, { do: 'leave' }
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const readline = require('readline');

const repo = path.resolve(__dirname, '../../../../..');
const Live = require(path.join(repo, 'soundboard-mac/src/live.js'));

const out = (ev) => process.stdout.write(`${JSON.stringify(ev)}\n`);
const tmp = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `interop-${label}-`));
const [mode, ...args] = process.argv.slice(2);

async function main() {
  if (mode === 'relay') {
    const { createRelay } = require(path.join(repo, 'live-relay/server.js'));
    const relay = await createRelay({ port: 0, host: '127.0.0.1' });
    out({ ev: 'relay', port: relay.port });
    return;
  }
  if (mode === 'host-lan' || mode === 'host-relay') {
    const soundFile = mode === 'host-lan' ? args[0] : args[1];
    const transport = mode === 'host-lan' ? new Live.LanHostTransport({ name: 'Mac Table' }) : new Live.RelayHostTransport({ url: args[0] });
    await transport.start();
    const host = new Live.LiveHost({
      name: 'Mac Table', transport, cacheDir: tmp('hostcache'),
      resolveSound: (id) => (id === 'drum' ? { file: soundFile, ext: path.extname(soundFile).slice(1) } : null),
    });
    host.on('peers', (list) => out({ ev: 'peers', list }));
    host.on('roll', (m) => out({ ev: 'roll', m }));
    host.on('game', (m) => out({ ev: 'game', m }));
    host.on('cue', (peer, name, cue) => out({ ev: 'cue', peer, name, cue }));
    await host.setHostColor('#2a5bd7', 'Mac GM');
    out({ ev: 'hosting', port: transport.port || null, code: transport.code || null });
    commands(async (c) => {
      if (c.do === 'play') await host.play({ pid: 'p1', group: 's:drum', soundId: 'drum', name: 'Drum', at: Date.now(), volume: 0.7, cat: 'sfx', dur: 2 });
      if (c.do === 'handout') {
        const bytes = fs.readFileSync(c.file);
        const hash = crypto.createHash('sha256').update(bytes).digest('hex');
        await host.handout({ id: c.id || 'h1', file: c.file, hash, ext: 'jpg', title: c.title || 'Map', to: c.to || null });
      }
      if (c.do === 'game') await host.gameControl({ action: c.action, kind: c.kind });
      if (c.do === 'players') await host.setPlayerSounds(c.mode);
      if (c.do === 'end') { host.end(); setTimeout(() => process.exit(0), 400); }
      out({ ev: 'done', do: c.do });
    });
    return;
  }
  if (mode === 'listen') {
    const [url, name] = args;
    const listener = new Live.LiveListener({ cacheDir: tmp('listen'), name, device: 'Mac' });
    listener.on('status', (s) => out({ ev: 'status', ...s }));
    listener.on('command', (cmd) => {
      const c = { ...cmd };
      if (c.file) c.sha = crypto.createHash('sha256').update(fs.readFileSync(c.file)).digest('hex');
      out({ ev: 'command', cmd: c });
    });
    listener.on('roll', (m) => out({ ev: 'roll', m }));
    listener.on('rules', (m) => out({ ev: 'rules', mode: m }));
    listener.on('avatars', (list) => out({ ev: 'avatars', list }));
    listener.on('handout', (h) => out({ ev: 'handout', id: h.id, title: h.title, show: h.show, secret: !!h.secret, sha: crypto.createHash('sha256').update(fs.readFileSync(h.file)).digest('hex') }));
    listener.connect(url);
    commands(async (c) => {
      if (c.do === 'avatar') listener.setAvatar(c.data);
      if (c.do === 'color') listener.sendRoll({ t: 'diceColor', color: c.color });
      if (c.do === 'roll') {
        listener.sendRoll({ t: 'roll', id: c.id || 'r1', kinds: ['d20'], dice: [{ p: [0, 0], h: 2, v: [1, -1], w: [1, 2, 3], q: [0, 0, 0, 1] }], groups: [{ type: 'd20', dice: [0] }], mode: 'normal', modifier: 2, color: '#000000', by: 'whoever' });
        setTimeout(() => listener.sendRoll({ t: 'rollResult', id: c.id || 'r1', values: [17] }), 100);
      }
      if (c.do === 'buzz') listener.sendRoll({ t: 'gameInput', id: c.id, buzz: true });
      if (c.do === 'leave') { listener.leave(); setTimeout(() => process.exit(0), 200); }
      out({ ev: 'done', do: c.do });
    });
  }
}

function commands(fn) {
  const rl = readline.createInterface({ input: process.stdin });
  let chain = Promise.resolve();
  rl.on('line', (line) => {
    let c;
    try { c = JSON.parse(line); } catch { return; }
    chain = chain.then(() => fn(c)).catch((e) => out({ ev: 'error', message: String(e) }));
  });
  rl.on('close', () => process.exit(0));
}

main().catch((e) => { out({ ev: 'error', message: String(e.stack || e) }); process.exit(1); });
