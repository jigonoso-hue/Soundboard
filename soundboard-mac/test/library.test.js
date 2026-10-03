const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Library } = require('../src/library');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-'));

test('add, update, persist, remove', () => {
  const dir = tmp();
  const lib = new Library(dir);
  const a = lib.add({ name: ' Airhorn ', data: Buffer.from('abc'), ext: '.MP3' });
  assert.equal(a.name, 'Airhorn');
  assert.ok(fs.existsSync(path.join(dir, a.file)));
  assert.match(a.file, /\.mp3$/);

  const b = lib.add({ name: 'Bruh', data: new Uint8Array([1, 2]), ext: 'wav' });
  lib.update(a.id, { hotkey: 'Alt+1', volume: 3 });
  lib.update(b.id, { hotkey: 'Alt+1' }); // steals the hotkey
  const reloaded = new Library(dir);
  assert.equal(reloaded.get(a.id).hotkey, null);
  assert.equal(reloaded.get(b.id).hotkey, 'Alt+1');
  assert.equal(reloaded.get(a.id).volume, 1);

  reloaded.reorder([b.id, a.id]);
  assert.deepEqual(new Library(dir).list().map((s) => s.id), [b.id, a.id]);

  reloaded.remove(a.id);
  assert.ok(!fs.existsSync(path.join(dir, a.file)));
  assert.equal(new Library(dir).list().length, 1);
});

test('rejects non-audio and path traversal', () => {
  const lib = new Library(tmp());
  assert.throws(() => lib.add({ name: 'x', data: Buffer.from(''), ext: 'exe' }));
  assert.equal(lib.resolveFile('../secret'), null);
  assert.equal(lib.resolveFile('a/b.wav'), null);
  assert.ok(lib.resolveFile('ok.wav'));
});

test('drops entries whose files are missing', () => {
  const dir = tmp();
  const lib = new Library(dir);
  const s = lib.add({ name: 'x', data: Buffer.from('1'), ext: 'wav' });
  fs.rmSync(path.join(dir, s.file));
  assert.equal(new Library(dir).list().length, 0);
});

test('repeat setting is validated and persisted', () => {
  const dir = tmp();
  const lib = new Library(dir);
  const s = lib.add({ name: 'Heartbeat', data: Buffer.from('x'), ext: 'wav' });
  assert.equal(s.repeat, null);
  assert.deepEqual(lib.update(s.id, { repeat: { gap: 2.345 } }).repeat, { gap: 2.3 });
  assert.deepEqual(lib.update(s.id, { repeat: { gap: -4 } }).repeat, { gap: 0 });
  assert.deepEqual(lib.update(s.id, { repeat: { gap: 'abc' } }).repeat, { gap: 0 });
  assert.deepEqual(new Library(dir).get(s.id).repeat, { gap: 0 });
  assert.equal(lib.update(s.id, { repeat: null }).repeat, null);
});
