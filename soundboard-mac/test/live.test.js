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

test('scene music: crossfades, built-in cues and scene-change fades', async () => {
  const library = makeLibrary();
  const transport = new LanHostTransport({ name: 'Scenes' });
  await transport.start();
  const host = new LiveHost({ name: 'Scenes', transport, resolveSound: library.resolveSound });
  const sam = new LiveListener({ cacheDir: tempDir('sam'), name: 'Sam' });
  const cmds = watch(sam);
  try {
    sam.connect(`ws://127.0.0.1:${transport.port}`);
    await waitFor(host, 'peers', (list) => list.length === 1);
    // A playlist's next song fades in; the one before fades out.
    await host.play({ pid: 'p1', group: 'pl:music:2', soundId: 'song', name: 'Song', at: Date.now(), volume: 0.7, cat: 'music', fadeIn: 4 });
    const song = await cmds.next('play', 5000);
    assert.equal(song.fadeIn, 4);
    await host.stop('pl:music:1', 4);
    assert.deepEqual(await cmds.next('stop'), { t: 'stop', group: 'pl:music:1', fade: 4 });
    // A now-and-then layer on a built-in loop: played with nothing to fetch.
    await host.play({ pid: 'p2', group: 'a:thunder', builtin: 'thunderstorm.wav', name: 'Thunderstorm', at: Date.now(), volume: 0.5, cat: 'ambience' });
    const cue = await cmds.next('play');
    assert.equal(cue.builtin, 'thunderstorm.wav');
    assert.equal(cue.file, undefined);
    assert.equal(cue.cat, 'ambience');
    // A built-in name that isn't one is dropped.
    await host.play({ pid: 'p3', group: 'a:x', builtin: '../secret.wav', name: 'X', at: Date.now(), volume: 0.5, cat: 'ambience' });
    // A scene change fades the ambience over its own time; fades are capped at 10 s.
    await host.setAmbience([{ key: 'kit:rain', kind: 'builtin', ref: 'rain.wav', name: 'Rain', volume: 0.5 }], 3);
    let amb = await cmds.next('ambience');
    for (let i = 0; i < 4 && !amb.layers.length; i++) amb = await cmds.next('ambience'); // the empty one from joining
    assert.equal(amb.fade, 3);
    assert.equal(amb.layers[0].builtin, 'rain.wav');
    await host.stop('pl:music:2', 99);
    assert.equal((await cmds.next('stop')).fade, 10);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(cmds.seen.filter((c) => c.t === 'play').length, 0, 'the bad built-in name never played');
  } finally {
    sam.leave();
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

test("players' sounds: rules, the GM's catalog, limits and own sounds", async () => {
  const library = makeLibrary();
  const transport = new LanHostTransport({ name: 'Pads' });
  await transport.start();
  const host = new LiveHost({ name: 'Pads', transport, resolveSound: library.resolveSound, cacheDir: tempDir('host-cache') });
  host.setCatalog([{ id: 'roar', name: 'Roar', color: 2 }, { id: 'door', name: 'Door', color: 0 }]);
  host.setPlayerSounds('gm');
  const cues = [];
  host.on('cue', (peer, name, cue) => cues.push({ peer, name, cue }));

  const sam = new LiveListener({ cacheDir: tempDir('pads-sam'), name: 'Sam' });
  const rules = waitFor(sam, 'rules', (mode) => mode === 'gm');
  const catalog = waitFor(sam, 'catalog', (items) => items.length === 2);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    sam.connect(`ws://127.0.0.1:${transport.port}`);
    await rules;
    assert.deepEqual((await catalog).map((i) => i.id), ['roar', 'door']);

    // A pick from the GM's board.
    sam.cue('roar');
    await wait(150);
    assert.deepEqual(cues.map((c) => [c.name, c.cue.kind, c.cue.soundId]), [['Sam', 'library', 'roar']]);
    // Too fast: ignored.
    sam.cue('door');
    await wait(100);
    assert.equal(cues.length, 1);
    // Not in the catalog (a GM-only sound): ignored.
    await wait(300);
    sam.cue('song');
    await wait(150);
    assert.equal(cues.length, 1);

    // Their own sounds: the host fetches the file from the player, then plays it.
    const ownDir = tempDir('own');
    const own = path.join(ownDir, 'cry.wav');
    const bytes = crypto.randomBytes(300 * 1024);
    fs.writeFileSync(own, bytes);
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    const ownRules = waitFor(sam, 'rules', (mode) => mode === 'own');
    host.setPlayerSounds('own');
    await ownRules;
    sam.offer([{ file: own, hash, ext: 'wav', name: 'Battle Cry' }]);
    await wait(400);
    sam.cueHash(hash);
    for (let i = 0; i < 30 && cues.length < 2; i++) await wait(100);
    const cue = cues[1];
    assert.equal(cue.cue.kind, 'file');
    assert.equal(cue.cue.name, 'Battle Cry');
    assert.deepEqual(fs.readFileSync(cue.cue.file), bytes);

    // The play goes out with the player's name.
    const cmds = watch(sam);
    await host.play({ pid: 'p1', group: 'p:x', file: { hash, ext: 'wav', file: cue.cue.file }, name: 'Battle Cry', at: Date.now(), volume: 1, cat: 'sfx', by: 'Sam' });
    const play = await cmds.next('play');
    assert.equal(play.by, 'Sam');
    assert.equal(play.name, 'Battle Cry');

    // Off: requests are ignored.
    host.setPlayerSounds('off');
    await wait(400);
    sam.cueHash(hash);
    await wait(200);
    assert.equal(cues.length, 2);
  } finally {
    sam.leave();
    transport.close();
  }
});

test('the host can remove a listener', async () => {
  const library = makeLibrary();
  const transport = new LanHostTransport({ name: 'Kick' });
  await transport.start();
  const host = new LiveHost({ name: 'Kick', transport, resolveSound: library.resolveSound });
  const sam = new LiveListener({ cacheDir: tempDir('kick'), name: 'Sam' });
  try {
    sam.connect(`ws://127.0.0.1:${transport.port}`);
    const [peer] = await waitFor(host, 'peers', (list) => list.length === 1);
    const ended = waitFor(sam, 'status', (st) => st.state === 'ended');
    host.kick(peer.peer);
    assert.equal((await ended).error, 'The broadcaster removed you from the session.');
    assert.equal(host.peerList().length, 0);
  } finally {
    sam.leave();
    transport.close();
  }
});

test('dice rolls go to everyone, named by the host, and late joiners get the log', async () => {
  const transport = new LanHostTransport({ name: 'Dice' });
  await transport.start();
  const host = new LiveHost({ name: 'Dice', transport, resolveSound: () => null });
  const url = `ws://127.0.0.1:${transport.port}`;
  const sam = new LiveListener({ cacheDir: tempDir('dice-sam'), name: 'Sam' });
  const ana = new LiveListener({ cacheDir: tempDir('dice-ana'), name: 'Ana' });
  const hostRolls = [];
  host.on('roll', (m) => hostRolls.push(m));
  const anaRolls = [];
  ana.on('roll', (m) => { if (m.t === 'roll' || m.t === 'rollResult') anaRolls.push(m); });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const throwOf = { p: [0, 0.5], h: 3, v: [0, -1], w: [1, 2, 3], q: [0, 0, 0, 1] };
  try {
    sam.connect(url);
    ana.connect(url);
    await waitFor(host, 'peers', (list) => list.length === 2);
    // No colour yet: the roll is refused.
    sam.sendRoll({ t: 'roll', id: 'r0', kinds: ['d6'], dice: [throwOf], groups: [{ type: 'd6', dice: [0] }] });
    await wait(100);
    assert.equal(anaRolls.length, 0);
    // Colours: Sam takes ruby; Ana can't have it too.
    const anaColors = [];
    ana.on('roll', (m) => { if (m.t === 'diceColors') anaColors.push(m); });
    sam.sendRoll({ t: 'diceColor', color: '#B3261E' });
    await wait(100);
    ana.sendRoll({ t: 'diceColor', color: '#b3261e' });
    await wait(100);
    ana.sendRoll({ t: 'diceColor', color: '#1f8a5b' });
    await wait(150);
    const last = anaColors[anaColors.length - 1];
    assert.deepEqual(last.colors.map((c) => [c.name, c.color]).sort(), [['Ana', '#1f8a5b'], ['Sam', '#b3261e']]);
    assert.ok(last.you, 'listeners learn which entry is theirs');
    anaRolls.length = 0;
    // Sam pretends to be someone else: the host names the roller itself.
    sam.sendRoll({ t: 'roll', id: 'r1', by: 'The Broadcaster', kinds: ['d20', 'd20'], dice: [throwOf, throwOf], groups: [{ type: 'd20', dice: [0] }, { type: 'd20', dice: [1] }], mode: 'adv', modifier: 2, color: '#b3261e' });
    await wait(150);
    // A number a d20 can't show is refused.
    sam.sendRoll({ t: 'rollResult', id: 'r1', values: [25, 3] });
    await wait(100);
    sam.sendRoll({ t: 'rollResult', id: 'r1', values: [18, 3] });
    await wait(150);
    assert.deepEqual(anaRolls.map((m) => m.t), ['roll', 'rollResult']);
    assert.equal(anaRolls[0].by, 'Sam');
    assert.equal(anaRolls[0].color, '#b3261e', 'rolls use the roller\'s own colour');
    assert.equal(anaRolls[0].mode, 'adv');
    assert.deepEqual(anaRolls[1].values, [18, 3]);
    assert.deepEqual(hostRolls.map((m) => m.t), ['roll', 'rollResult']);
    // Ana can't finish Sam's roll.
    ana.sendRoll({ t: 'rollResult', id: 'r1', values: [1, 1] });
    // The host's own roll, in a colour no one else has.
    host.setHostColor('#b3261e', 'Jo');
    host.setHostColor('#2a5bd7', 'Jo');
    host.roll({ id: 'h1', kinds: ['d6'], dice: [throwOf], groups: [{ type: 'd6', dice: [0] }], mode: 'normal', modifier: 0 }, 'Jo');
    host.rollResult({ id: 'h1', values: [4] });
    await wait(150);
    assert.equal(anaRolls.filter((m) => m.t === 'rollResult').length, 2);
    assert.equal(anaRolls[2].by, 'Jo');
    assert.equal(anaRolls[2].color, '#2a5bd7');

    const late = new LiveListener({ cacheDir: tempDir('dice-late'), name: 'Late' });
    const history = waitFor(late, 'roll', (m) => m.t === 'rolls');
    late.connect(url);
    const { list } = await history;
    assert.deepEqual(list.map((r) => [r.by, r.values]), [['Sam', [18, 3]], ['Jo', [4]]]);
    late.leave();
  } finally {
    sam.leave();
    ana.leave();
    transport.close();
  }
});

test('hidden rolls, custom dice, roll requests and the turn order', async () => {
  const transport = new LanHostTransport({ name: 'Table' });
  await transport.start();
  const host = new LiveHost({ name: 'Table', transport, resolveSound: () => null });
  const url = `ws://127.0.0.1:${transport.port}`;
  const sam = new LiveListener({ cacheDir: tempDir('table-sam'), name: 'Sam' });
  const ana = new LiveListener({ cacheDir: tempDir('table-ana'), name: 'Ana' });
  const samGot = [];
  const anaGot = [];
  sam.on('roll', (m) => samGot.push(m));
  ana.on('roll', (m) => anaGot.push(m));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const throwOf = { p: [0, 0.5], h: 3, v: [0, -1], w: [1, 2, 3], q: [0, 0, 0, 1] };
  try {
    sam.connect(url);
    ana.connect(url);
    await waitFor(host, 'peers', (list) => list.length === 2);
    const [samPeer, anaPeer] = ['Sam', 'Ana'].map((n) => [...host.peers].find(([, p]) => p.name === n)[0]);
    host.setHostColor('#2a5bd7', 'Jo');
    sam.sendRoll({ t: 'diceColor', color: '#b3261e' });
    await wait(100);

    // A hidden roll: listeners see the dice start, never the result, and it isn't logged.
    host.roll({ id: 'h1', kinds: ['d20'], dice: [throwOf], groups: [{ type: 'd20', dice: [0] }], hidden: true }, 'Jo');
    host.rollResult({ id: 'h1', values: [17] });
    await wait(150);
    const hidden = samGot.filter((m) => m.id === 'h1');
    assert.deepEqual(hidden.map((m) => [m.t, m.hidden]), [['roll', true]]);
    assert.equal(hidden[0].peer, 'host', 'starts say who rolled');
    assert.equal(host.rollLog.length, 0);
    // Only the broadcaster can hide a roll.
    sam.sendRoll({ t: 'roll', id: 's1', hidden: true, ask: 'ask-1', kinds: ['d20'], dice: [throwOf], groups: [{ type: 'd20', dice: [0] }] });
    await wait(150);
    const samStart = anaGot.find((m) => m.id === 's1');
    assert.equal(samStart.hidden, undefined);
    assert.equal(samStart.ask, 'ask-1', 'a roll answering a request says which');
    assert.equal(samStart.peer, samPeer);

    // Custom dice: cleaned, and rolled by their faces.
    const loot = { id: 'loot', name: 'Loot', sides: 6, faces: ['Gold', 'Gem', 'Potion', 'Scroll', 'Nothing', 'Mimic!'] };
    host.table({ t: 'customDice', list: [loot, { id: 'bad', sides: 7, faces: [] }] });
    await wait(100);
    assert.deepEqual(anaGot.filter((m) => m.t === 'customDice').pop().list.map((d) => d.id), ['loot']);
    host.roll({ id: 'h2', kinds: ['d6', 'coin'], dice: [throwOf, throwOf], groups: [{ type: 'custom', die: 'loot', dice: [0] }, { type: 'coin', dice: [1] }], custom: [loot] }, 'Jo');
    host.rollResult({ id: 'h2', values: [6, 2] });
    await wait(150);
    assert.deepEqual(anaGot.find((m) => m.t === 'roll' && m.id === 'h2').custom, [loot]);
    assert.deepEqual(anaGot.find((m) => m.t === 'rollResult' && m.id === 'h2').values, [6, 2]);

    // A request to Ana only; an open one to everyone; the turn order.
    host.table({ t: 'ask', id: 'ask-ana', kind: 'check', label: 'Wisdom save', counts: { d20: 1 }, dc: 12, to: [anaPeer, 'nobody'] });
    host.table({ t: 'ask', id: 'ask-all', kind: 'initiative', label: 'Initiative', counts: { d20: 1 } });
    host.table({ t: 'turns', phase: 'running', round: 1, current: 0, order: [{ name: 'Sam', peer: samPeer, total: 18 }, { name: 'Goblin', peer: null, total: 9 }] });
    await wait(150);
    assert.deepEqual(samGot.filter((m) => m.t === 'ask').map((m) => m.id), ['ask-all']);
    assert.deepEqual(anaGot.filter((m) => m.t === 'ask').map((m) => m.id), ['ask-ana', 'ask-all']);
    assert.deepEqual(anaGot.find((m) => m.id === 'ask-ana').to, [anaPeer]);
    const turns = samGot.filter((m) => m.t === 'turns').pop();
    assert.equal(turns.you, samPeer, 'the turn order says which entry is you');

    // A late joiner gets the custom dice, open requests to everyone and the turn order.
    const late = new LiveListener({ cacheDir: tempDir('table-late'), name: 'Late' });
    const lateGot = [];
    late.on('roll', (m) => lateGot.push(m));
    late.connect(url);
    await waitFor(late, 'roll', (m) => m.t === 'turns');
    await wait(100);
    assert.ok(lateGot.some((m) => m.t === 'customDice'));
    assert.deepEqual(lateGot.filter((m) => m.t === 'ask').map((m) => m.id), ['ask-all']);
    host.table({ t: 'askClosed', id: 'ask-all' });
    host.table({ t: 'askResult', id: 'ask-ana', kind: 'check', label: 'Wisdom save', results: [{ name: 'Ana', total: 14, pass: true }] });
    host.table({ t: 'turns', phase: 'off' });
    await wait(150);
    assert.ok(lateGot.some((m) => m.t === 'askClosed' && m.id === 'ask-all'));
    assert.ok(samGot.some((m) => m.t === 'askResult'));
    assert.equal(host.tableState.turns, null);
    assert.equal(host.tableState.asks.has('ask-all'), false);
    late.leave();
  } finally {
    sam.leave();
    ana.leave();
    transport.close();
  }
});

test('games: the broadcaster starts a buzzer, listeners buzz, late joiners are locked in too', async () => {
  const transport = new LanHostTransport({ name: 'Games' });
  await transport.start();
  const host = new LiveHost({ name: 'Games', transport, resolveSound: () => null });
  const url = `ws://127.0.0.1:${transport.port}`;
  const sam = new LiveListener({ cacheDir: tempDir('game-sam'), name: 'Sam' });
  const samGames = [];
  const hostGames = [];
  sam.on('roll', (m) => { if (m.t === 'game') samGames.push(m); });
  host.on('game', (m) => hostGames.push(m));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    sam.connect(url);
    await waitFor(host, 'peers', (list) => list.length === 1);
    host.gameControl({ action: 'start', kind: 'buzzer' });
    host.gameControl({ action: 'arm' });
    await wait(150);
    const armed = samGames.at(-1);
    assert.equal(armed.phase, 'armed');
    assert.ok(armed.you, 'listeners know which entry is theirs');
    sam.sendRoll({ t: 'gameInput', id: armed.id, buzz: true });
    await wait(150);
    assert.deepEqual(samGames.at(-1).buzzes.map((b) => b.name), ['Sam']);
    assert.equal(hostGames.at(-1).host, true);
    const late = new LiveListener({ cacheDir: tempDir('game-late'), name: 'Late' });
    const lateGame = waitFor(late, 'roll', (m) => m.t === 'game');
    late.connect(url);
    assert.equal((await lateGame).kind, 'buzzer');
    host.gameControl({ action: 'end' });
    await wait(150);
    assert.equal(samGames.at(-1).phase, 'off');
    late.leave();
  } finally {
    sam.leave();
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
