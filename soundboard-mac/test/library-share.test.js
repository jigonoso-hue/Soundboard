const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { Library } = require('../src/library');
const { BashStore } = require('../src/bashes');
const { KitStore } = require('../src/kits');
const Share = require('../src/library-share');
const { writeZip, openZip } = require('../src/zip');

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
const stores = (dir) => ({ library: new Library(dir), bashes: new BashStore(dir), kits: new KitStore(dir) });
// A quiet WAV (compresses well) and some "mp3" bytes (they don't).
function wav(seconds = 1) {
  const data = Buffer.alloc(44100 * 2 * seconds);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(44100, 24);
  head.writeUInt32LE(88200, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}
const noise = (n) => Buffer.from(Array.from({ length: n }, () => Math.floor(Math.random() * 256)));

function makeLibrary() {
  const dir = tmp('lib-a');
  const s = stores(dir);
  const roar = s.library.add({ name: 'Dragon Roar', data: noise(5000), ext: 'mp3', kind: 'clip', duration: 3 });
  const song = s.library.add({ name: 'Tavern Song', data: wav(1), ext: 'wav', kind: 'full', duration: 90 });
  s.library.update(roar.id, { tags: ['creature', 'boss fight'], volume: 0.6, repeat: { gap: 2 }, buzz: true, color: '#5ec8ff' });
  const bash = s.bashes.create({ name: 'Ambush!', soundIds: [roar.id, song.id] });
  s.bashes.setCoverImage(bash.id, noise(300), 'png');
  const kit = s.kits.create({ name: 'Tavern Brawl' });
  s.kits.addItems(kit.id, [{ type: 'sound', id: roar.id }, { type: 'sound', id: song.id }, { type: 'bash', id: bash.id }], null, s.library.list());
  const sections = s.kits.get(kit.id).sections;
  sections[3].layers = [{ kind: 'builtin', ref: 'rain.wav', volume: 0.5 }, { kind: 'sound', ref: song.id, volume: 0.4, every: [60, 180] }];
  sections[2].playlist = true;
  s.kits.update(kit.id, { sections, autoplay: true });
  return { dir, s, roar, song, bash, kit };
}

test('zip: stores compressed files, deflates the rest, reads both back', () => {
  const dir = tmp('zip');
  const file = path.join(dir, 'x.zip');
  const big = wav(2);
  const mp3 = noise(4000);
  writeZip(file, [{ name: 'a.json', data: Buffer.from('{"hello":"world"}') }, { name: 'sounds/b.wav', data: big }, { name: 'sounds/c.mp3', data: mp3 }]);
  assert.ok(fs.statSync(file).size < big.length / 10, 'the quiet wav is deflated');
  const zip = openZip(file);
  assert.deepEqual(zip.names, ['a.json', 'sounds/b.wav', 'sounds/c.mp3']);
  assert.ok(zip.read('sounds/b.wav').equals(big));
  assert.ok(zip.read('sounds/c.mp3').equals(mp3));
  assert.equal(zip.read('missing'), null);
  zip.close();
  // Standard zips: what other tools (and Android's ZipOutputStream, with data descriptors) make reads too.
  const other = path.join(dir, 'y.zip');
  const body = zlib.deflateRawSync(Buffer.from('hi there hi there'));
  const name = Buffer.from('n.txt');
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 6); local.writeUInt16LE(8, 8); local.writeUInt16LE(name.length, 26);
  const crc = require('../src/zip').crc32(Buffer.from('hi there hi there'));
  const desc = Buffer.alloc(16); desc.writeUInt32LE(0x08074b50, 0); desc.writeUInt32LE(crc, 4); desc.writeUInt32LE(body.length, 8); desc.writeUInt32LE(17, 12);
  const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(8, 8); cen.writeUInt16LE(8, 10); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(body.length, 20); cen.writeUInt32LE(17, 24); cen.writeUInt16LE(name.length, 28);
  const dirStart = 30 + name.length + body.length + 16;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(dirStart, 16);
  fs.writeFileSync(other, Buffer.concat([local, name, body, desc, cen, name, end]));
  assert.equal(openZip(other).read('n.txt').toString(), 'hi there hi there');
  fs.writeFileSync(path.join(dir, 'bad.zip'), 'not a zip');
  assert.throws(() => openZip(path.join(dir, 'bad.zip')), /isn’t a zip/);
});

test('a whole library goes to one file and comes back the same in another library', () => {
  const a = makeLibrary();
  const file = path.join(tmp('share'), 'lib.zip');
  const counts = Share.exportToZip(file, a.s, 'Mac');
  assert.deepEqual(counts, { sounds: 2, bashes: 1, kits: 1 });

  const bDir = tmp('lib-b');
  const b = stores(bDir);
  const result = Share.importFromZip(file, b);
  assert.deepEqual(result, { sounds: 2, bashes: 1, kits: 1, skipped: 0 });
  assert.match(Share.describeImport(result), /^Added 2 sounds, 1 bash and 1 scene kit\.$/);

  const roar = b.library.get(a.roar.id);
  assert.equal(roar.name, 'Dragon Roar');
  assert.deepEqual(roar.tags, ['creature', 'boss fight']);
  assert.equal(roar.volume, 0.6);
  assert.deepEqual(roar.repeat, { gap: 2 });
  assert.equal(roar.buzz, true);
  assert.equal(roar.color, '#5ec8ff');
  assert.equal(roar.kind, 'clip');
  assert.ok(b.library.tags().all.includes('boss fight'), 'custom tags come along');
  assert.ok(fs.readFileSync(b.library.resolveFile(roar.file)).equals(fs.readFileSync(a.s.library.resolveFile(a.s.library.get(a.roar.id).file))));
  assert.equal(b.library.get(a.song.id).kind, 'full');

  const bash = b.bashes.get(a.bash.id);
  assert.equal(bash.name, 'Ambush!');
  assert.equal(bash.clips.length, 2);
  assert.equal(bash.cover.type, 'image');
  assert.ok(fs.existsSync(b.bashes.coverPath(bash.cover.file)));

  const kit = b.kits.get(a.kit.id);
  assert.equal(kit.name, 'Tavern Brawl');
  assert.equal(kit.autoplay, true);
  assert.deepEqual(kit.sections.map((s) => s.items.length), [1, 1, 1, 0]);
  assert.equal(kit.sections[2].playlist, true);
  assert.deepEqual(kit.sections[3].layers.map((l) => l.ref), ['rain.wav', a.song.id]);

  // Importing the same file again adds nothing.
  assert.deepEqual(Share.importFromZip(file, b), { sounds: 0, bashes: 0, kits: 0, skipped: 4 });
  assert.equal(b.library.list().length, 2);
});

test('the same audio already in the library is reused, and kits point at it', () => {
  const a = makeLibrary();
  const file = path.join(tmp('share'), 'lib.zip');
  Share.exportToZip(file, a.s);
  const c = stores(tmp('lib-c'));
  const mine = c.library.addFromFile(a.s.library.resolveFile(a.s.library.get(a.roar.id).file), { name: 'My roar' });
  const result = Share.importFromZip(file, c);
  assert.equal(result.sounds, 1, 'only the song is new');
  assert.equal(c.library.list().length, 2);
  const kit = c.kits.get(a.kit.id);
  assert.ok(kit.sections.some((s) => s.items.some((i) => i.id === mine.id)), 'the kit uses my copy');
  assert.ok(c.bashes.get(a.bash.id).clips.some((cl) => cl.soundId === mine.id));
});

test('limits are checked before anything is added', () => {
  const a = makeLibrary();
  const file = path.join(tmp('share'), 'lib.zip');
  Share.exportToZip(file, a.s);
  const d = stores(tmp('lib-d'));
  let seen = null;
  assert.throws(() => Share.importFromZip(file, d, { checkLimits: (counts) => { seen = counts; throw new Error('limit'); } }), /limit/);
  assert.deepEqual(seen, { clips: 1, full: 1, bashes: 1, kits: 1 });
  assert.equal(d.library.list().length + d.bashes.list().length + d.kits.list().length, 0);
});

test('files that aren\'t libraries, or are damaged, are refused safely', () => {
  const dir = tmp('bad');
  const notLib = path.join(dir, 'other.zip');
  writeZip(notLib, [{ name: 'readme.txt', data: Buffer.from('hi') }]);
  assert.throws(() => Share.importFromZip(notLib, stores(tmp('e'))), /isn’t a Dungeon Radio library/);
  const newer = path.join(dir, 'newer.zip');
  writeZip(newer, [{ name: Share.MANIFEST, data: Buffer.from(JSON.stringify({ format: Share.FORMAT, version: 99 })) }]);
  assert.throws(() => Share.importFromZip(newer, stores(tmp('f'))), /newer Dungeon Radio/);
  // Paths that try to leave the folder, odd ids and missing files are dropped.
  const m = Share.readManifest(JSON.stringify({
    format: Share.FORMAT, version: 1,
    sounds: [
      { id: '../../etc', name: 'x', file: 'sounds/x.mp3' },
      { id: '11111111-1111-4111-8111-111111111111', name: 'Escape', file: '../../evil.mp3' },
      { id: '22222222-2222-4222-8222-222222222222', name: 'Fine\u0007', file: 'sounds/22222222-2222-4222-8222-222222222222.mp3', source: { url: 'javascript:alert(1)' } },
    ],
  }));
  assert.equal(m.sounds.length, 1);
  assert.equal(m.sounds[0].name, 'Fine');
  assert.equal(m.sounds[0].source, null);
});

test('libraries from the iPhone/iPad app (upper-case ids) import too', () => {
  const dir = tmp('ios');
  const zipPath = path.join(dir, 'ios.zip');
  const ID = 'A1B2C3D4-0000-4000-8000-00000000000A';
  const manifest = {
    format: Share.FORMAT, version: 1, app: 'iPhone', tags: ['spooky'],
    sounds: [{ id: ID, name: 'Owl', file: `sounds/${ID.toLowerCase()}.m4a`, color: '#ff5d73', volume: 1, tags: ['spooky'], kind: 'clip', duration: 2, repeat: null }],
    bashes: [], kits: [{ id: 'B1B2C3D4-0000-4000-8000-00000000000B', name: 'Night', icon: 'moon', color: '#3f4a5a', iconColor: '#ffffff', createdAt: '2026-01-01T00:00:00Z',
      sections: [{ id: 'C1B2C3D4-0000-4000-8000-00000000000C', title: 'Sounds', kind: 'clips', x: 0, y: 0, w: 12, h: 6, size: 'm', items: [{ type: 'sound', id: ID }], layers: [] }] }],
  };
  writeZip(zipPath, [{ name: Share.MANIFEST, data: Buffer.from(JSON.stringify(manifest)) }, { name: `sounds/${ID.toLowerCase()}.m4a`, data: noise(100) }]);
  const g = stores(tmp('g'));
  assert.deepEqual(Share.importFromZip(zipPath, g), { sounds: 1, bashes: 0, kits: 1, skipped: 0 });
  assert.equal(g.kits.list()[0].sections[0].items[0].id, ID.toLowerCase());
  assert.ok(g.library.get(ID.toLowerCase()));
});
