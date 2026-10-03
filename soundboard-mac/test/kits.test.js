const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { KitStore } = require('../src/kits');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kit-'));
const titles = (kit) => kit.sections.map((s) => `${s.title}:${s.kind}:${s.x},${s.y},${s.w},${s.h}`);
const ids = (section) => section.items.map((i) => `${i.type}:${i.id}`);

test('new kits start with generic sections laid out on the grid', () => {
  const kit = new KitStore(tmp()).create({ name: '  Tavern Brawl ' });
  assert.equal(kit.name, 'Tavern Brawl');
  assert.deepEqual(titles(kit), ['Bashes:bashes:0,0,12,4', 'Sound Effects:clips:0,4,7,8', 'Music:full:7,4,5,8']);
  assert.ok(kit.sections.every((s) => s.id && s.size === 'm' && s.items.length === 0));
});

test('adding items: to a chosen section, or to the best-suited one', () => {
  const dir = tmp();
  const store = new KitStore(dir);
  const kit = store.create();
  const [bashes, clips, music] = kit.sections;
  const sounds = [{ id: 'song', kind: 'full' }, { id: 'boom', kind: 'clip' }];
  store.addItems(kit.id, [{ type: 'sound', id: 'song' }, { type: 'sound', id: 'boom' }, { type: 'bash', id: 'b1' }], null, sounds);
  store.addItems(kit.id, [{ type: 'sound', id: 'boom' }], music.id, sounds); // explicit section wins
  store.addItems(kit.id, [{ type: 'sound', id: 'boom' }], music.id, sounds); // no duplicates
  const saved = new KitStore(dir).get(kit.id);
  assert.deepEqual(ids(saved.sections[0]), ['bash:b1']);
  assert.deepEqual(ids(saved.sections[1]), ['sound:boom']);
  assert.deepEqual(ids(saved.sections[2]), ['sound:song', 'sound:boom']);
  assert.equal(saved.sections[0].id, bashes.id);
  assert.equal(saved.sections[1].id, clips.id);

  // Remove from one section, then from the whole kit.
  store.removeItem(kit.id, { type: 'sound', id: 'boom' }, music.id);
  assert.deepEqual(ids(store.get(kit.id).sections[1]), ['sound:boom']);
  store.removeItem(kit.id, { type: 'sound', id: 'boom' });
  assert.deepEqual(store.get(kit.id).sections.flatMap(ids), ['bash:b1', 'sound:song']);
});

test('layout and section edits are validated', () => {
  const store = new KitStore(tmp());
  const kit = store.create();
  const sections = kit.sections;
  sections[0] = { ...sections[0], title: '  Fights  ', x: 11, w: 4, h: 1, size: 'xl', kind: 'weird' };
  sections.push({ title: 'Extra', kind: 'mixed', x: 3, y: 20, w: 3, h: 3, items: [{ type: 'sound', id: 'a' }, { type: 'sound', id: 'a' }, { type: 'x', id: 'b' }] });
  const saved = store.update(kit.id, { sections });
  assert.deepEqual(saved.sections[0], { ...saved.sections[0], title: 'Fights', x: 8, w: 4, h: 2, size: 'm', kind: 'mixed' });
  assert.equal(saved.sections[3].title, 'Extra');
  assert.ok(saved.sections[3].id);
  assert.deepEqual(ids(saved.sections[3]), ['sound:a']);
});

test('prune, duplicate, delete', () => {
  const dir = tmp();
  const store = new KitStore(dir);
  const kit = store.create({ name: 'Dungeon' });
  store.addItems(kit.id, [{ type: 'sound', id: 'a' }, { type: 'bash', id: 'a' }]);
  assert.equal(store.prune('sound', 'a'), true);
  assert.deepEqual(store.get(kit.id).sections.flatMap(ids), ['bash:a']);
  assert.equal(store.prune('sound', 'zzz'), false);
  store.update(kit.id, { icon: '💀', color: '#123456' });
  const copy = store.duplicate(kit.id);
  assert.equal(copy.name, 'Dungeon copy');
  assert.equal(copy.icon, '💀');
  assert.deepEqual(copy.sections.flatMap(ids), ['bash:a']);
  assert.notEqual(copy.sections[0].id, store.get(kit.id).sections[0].id);
  store.remove(kit.id);
  assert.deepEqual(new KitStore(dir).list().map((k) => k.id), [copy.id]);
});

test('older flat kits are converted into sections', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'kits.json'), JSON.stringify([{
    id: 'old', name: 'Isles of Maro', icon: '🏴‍☠️', color: '#5ec8ff',
    items: [{ type: 'sound', id: 'clip1' }, { type: 'sound', id: 'song1' }, { type: 'bash', id: 'b1' }],
  }]));
  const store = new KitStore(dir);
  store.finishMigration([{ id: 'clip1', kind: 'clip' }, { id: 'song1', kind: 'full' }]);
  const kit = new KitStore(dir).get('old');
  assert.equal(kit.migrated, undefined);
  assert.deepEqual(kit.sections.map(ids), [['bash:b1'], ['sound:clip1'], ['sound:song1']]);
});
