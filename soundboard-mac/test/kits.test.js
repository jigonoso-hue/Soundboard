const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { KitStore } = require('../src/kits');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kit-'));

test('create, add items without duplicates, persist', () => {
  const dir = tmp();
  const store = new KitStore(dir);
  const kit = store.create({ name: '  Tavern Brawl ' });
  assert.equal(kit.name, 'Tavern Brawl');
  assert.deepEqual(kit.items, []);
  store.addItems(kit.id, [{ type: 'sound', id: 'a' }, { type: 'bash', id: 'b' }, { type: 'sound', id: 'a' }, { type: 'nope', id: 'x' }]);
  store.addItems(kit.id, [{ type: 'bash', id: 'b' }, { type: 'sound', id: 'c' }]);
  assert.deepEqual(new KitStore(dir).get(kit.id).items, [
    { type: 'sound', id: 'a' }, { type: 'bash', id: 'b' }, { type: 'sound', id: 'c' },
  ]);
});

test('remove items, prune deleted sounds and bashes', () => {
  const store = new KitStore(tmp());
  const one = store.create({ items: [{ type: 'sound', id: 'a' }, { type: 'bash', id: 'a' }] });
  const two = store.create({ items: [{ type: 'sound', id: 'a' }] });
  // Same id but a different type is a different item.
  assert.equal(store.prune('sound', 'a'), true);
  assert.deepEqual(store.get(one.id).items, [{ type: 'bash', id: 'a' }]);
  assert.deepEqual(store.get(two.id).items, []);
  assert.equal(store.prune('sound', 'zzz'), false);
  assert.deepEqual(store.removeItem(one.id, { type: 'bash', id: 'a' }).items, []);
});

test('rename, restyle, duplicate and delete', () => {
  const dir = tmp();
  const store = new KitStore(dir);
  const kit = store.create({ name: 'Dungeon', items: [{ type: 'sound', id: 'a' }] });
  store.update(kit.id, { name: 'Deep Dungeon', icon: '💀', color: '#123456', id: 'hijack' });
  const updated = store.get(kit.id);
  assert.deepEqual([updated.name, updated.icon, updated.color], ['Deep Dungeon', '💀', '#123456']);
  store.update(kit.id, { color: 'red' });
  assert.notEqual(store.get(kit.id).color, 'red');
  const copy = store.duplicate(kit.id);
  assert.equal(copy.name, 'Deep Dungeon copy');
  assert.equal(copy.icon, '💀');
  assert.deepEqual(copy.items, [{ type: 'sound', id: 'a' }]);
  store.remove(kit.id);
  assert.deepEqual(new KitStore(dir).list().map((k) => k.id), [copy.id]);
});
