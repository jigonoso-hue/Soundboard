const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { BashStore } = require('../src/bashes');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bash-'));

test('new bashes start every sound at the same time on separate lanes', () => {
  const store = new BashStore(tmp());
  const bash = store.create({ name: 'Ambush', soundIds: ['a', 'b', 'c'] });
  assert.equal(bash.name, 'Ambush');
  assert.deepEqual(bash.clips.map((c) => [c.soundId, c.offset, c.lane]), [['a', 0, 0], ['b', 0, 1], ['c', 0, 2]]);
  assert.equal(bash.cover.type, 'icon');
  assert.ok(bash.clips.every((c) => c.id));
});

test('update validates clips and persists', () => {
  const dir = tmp();
  const store = new BashStore(dir);
  const bash = store.create({ soundIds: ['a'] });
  store.update(bash.id, {
    name: '  Dragon Attack  ',
    clips: [{ id: 'x', soundId: 'a', offset: 2.34567, volume: 3, lane: 1.7 }, { soundId: 'b', offset: -5 }, { bogus: true }],
    cover: { type: 'icon', icon: 'dragon', color: '#ff0000', iconColor: '#00ff00' },
  });
  const reloaded = new BashStore(dir).get(bash.id);
  assert.equal(reloaded.name, 'Dragon Attack');
  assert.deepEqual(reloaded.clips.map((c) => [c.soundId, c.offset, c.volume, c.lane]), [['a', 2.346, 1, 1], ['b', 0, 1, 0]]);
  assert.deepEqual(reloaded.cover, { type: 'icon', icon: 'dragon', color: '#ff0000', iconColor: '#00ff00' });
});

test('image covers are stored, replaced and cleaned up', () => {
  const dir = tmp();
  const store = new BashStore(dir);
  const bash = store.create();
  const first = store.setCoverImage(bash.id, Buffer.from('png1'), 'PNG');
  assert.equal(first.cover.type, 'image');
  const firstPath = store.coverPath(first.cover.file);
  assert.ok(fs.existsSync(firstPath));
  // Editing other fields can't point the cover at an arbitrary file.
  store.update(bash.id, { cover: { type: 'image', file: '../../etc/passwd' } });
  assert.equal(store.get(bash.id).cover.file, first.cover.file);

  const second = store.setCoverImage(bash.id, Buffer.from('png2'), 'jpg');
  assert.ok(!fs.existsSync(firstPath));
  store.update(bash.id, { cover: { type: 'icon', icon: 'd20', color: '#123456' } });
  assert.ok(!fs.existsSync(store.coverPath(second.cover.file)));
  assert.throws(() => store.setCoverImage(bash.id, Buffer.from(''), 'exe'));
  assert.equal(store.coverPath('../x'), null);
});

test('pruning a deleted sound, duplicating and removing', () => {
  const dir = tmp();
  const store = new BashStore(dir);
  const bash = store.create({ name: 'Tavern', soundIds: ['a', 'b'] });
  assert.equal(store.pruneSound('a'), true);
  assert.equal(store.pruneSound('zzz'), false);
  assert.deepEqual(store.get(bash.id).clips.map((c) => c.soundId), ['b']);

  const copy = store.duplicate(bash.id);
  assert.equal(copy.name, 'Tavern copy');
  assert.deepEqual(copy.clips.map((c) => c.soundId), ['b']);

  store.remove(bash.id);
  assert.deepEqual(new BashStore(dir).list().map((b) => b.id), [copy.id]);
});

test('clips can repeat', () => {
  const dir = tmp();
  const store = new BashStore(dir);
  const bash = store.create({ soundIds: ['a', 'b', 'c'] });
  const [a, b, c] = bash.clips;
  store.update(bash.id, {
    clips: [
      { ...a, repeat: { gap: 0, times: 0 } },
      { ...b, repeat: { gap: 1.26, times: 4.7 } },
      { ...c, repeat: { gap: -3, times: 1 } },
    ],
  });
  const clips = new BashStore(dir).get(bash.id).clips;
  assert.deepEqual(clips.map((x) => x.repeat), [{ gap: 0, times: 0 }, { gap: 1.3, times: 4 }, { gap: 0, times: 0 }]);
  store.update(bash.id, { clips: [{ ...a, repeat: null }] });
  assert.equal(store.get(bash.id).clips[0].repeat, null);
});

test('emoji covers from older versions become icons', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-'));
  fs.writeFileSync(path.join(dir, 'bashes.json'), JSON.stringify([
    { id: 'a', name: 'Old', cover: { type: 'icon', icon: '🐉', color: '#ff0000' }, clips: [] },
    { id: 'b', name: 'Odd', cover: { type: 'icon', icon: '🦄', color: '#ff0000' }, clips: [] },
  ]));
  const store = new BashStore(dir);
  assert.deepEqual(store.get('a').cover, { type: 'icon', icon: 'dragon', color: '#ff0000', iconColor: '#ffffff' });
  assert.equal(store.get('b').cover.icon, 'crossed-swords');
});
