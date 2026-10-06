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
  assert.deepEqual(titles(kit), ['Bashes:bashes:0,0,12,4', 'Sound Effects:clips:0,4,7,8', 'Music:full:7,4,5,8', 'Ambience:ambience:0,12,12,5']);
  assert.ok(kit.sections.every((s) => s.id && s.size === 'm' && s.items.length === 0 && s.layers.length === 0));
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
  assert.equal(saved.sections[4].title, 'Extra');
  assert.ok(saved.sections[4].id);
  assert.deepEqual(ids(saved.sections[4]), ['sound:a']);
});

test('prune, duplicate, delete', () => {
  const dir = tmp();
  const store = new KitStore(dir);
  const kit = store.create({ name: 'Dungeon' });
  store.addItems(kit.id, [{ type: 'sound', id: 'a' }, { type: 'bash', id: 'a' }]);
  assert.equal(store.prune('sound', 'a'), true);
  assert.deepEqual(store.get(kit.id).sections.flatMap(ids), ['bash:a']);
  assert.equal(store.prune('sound', 'zzz'), false);
  store.update(kit.id, { icon: 'skull', color: '#123456', iconColor: '#FF0000' });
  const copy = store.duplicate(kit.id);
  assert.equal(copy.name, 'Dungeon copy');
  assert.equal(copy.icon, 'skull');
  assert.equal(copy.iconColor, '#ff0000');
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
  assert.deepEqual(kit.sections.map(ids), [['bash:b1'], ['sound:clip1'], ['sound:song1'], []]);
  assert.equal(kit.icon, 'jolly-roger'); // emoji icons become icons from the app's set
  assert.equal(kit.iconColor, '#ffffff');
});

test('icons must come from the icon set', () => {
  const store = new KitStore(tmp());
  const kit = store.create();
  assert.equal(store.update(kit.id, { icon: 'dragon', iconColor: 'red' }).iconColor, '#ffffff');
  assert.equal(store.get(kit.id).icon, 'dragon');
  assert.equal(store.update(kit.id, { icon: '<svg onload=x>' }).icon, 'mug');
});

test('ambience sections hold layers, not items', () => {
  const store = new KitStore(tmp());
  const kit = store.create();
  const amb = kit.sections.find((s) => s.kind === 'ambience');
  amb.layers = [
    { kind: 'builtin', ref: 'rain.wav', volume: 2 },
    { kind: 'builtin', ref: 'rain.wav', volume: 0.5 },
    { kind: 'builtin', ref: '../secret.wav' },
    { kind: 'sound', ref: 'song', volume: 0.4 },
  ];
  amb.items = [{ type: 'sound', id: 'x' }];
  let saved = store.update(kit.id, { sections: kit.sections }).sections.find((s) => s.kind === 'ambience');
  assert.deepEqual(saved.layers.map((l) => `${l.kind}:${l.ref}:${l.volume}`), ['builtin:rain.wav:1', 'sound:song:0.4']);
  assert.ok(saved.layers.every((l) => l.id));
  assert.deepEqual(saved.items, []);

  // Items never land in an ambience section, even when it's asked for.
  store.addItems(kit.id, [{ type: 'sound', id: 'boom' }], amb.id, [{ id: 'boom', kind: 'clip' }]);
  assert.deepEqual(store.get(kit.id).sections.map(ids), [[], ['sound:boom'], [], []]);

  // Deleting a sound removes its layers too.
  assert.equal(store.prune('sound', 'song'), true);
  saved = store.get(kit.id).sections.find((s) => s.kind === 'ambience');
  assert.deepEqual(saved.layers.map((l) => l.ref), ['rain.wav']);
});

test('scene music: autoplay kits, playlist sections, now-and-then layers', () => {
  const dir = tmp();
  const store = new KitStore(dir);
  const kit = store.create({ name: 'Tavern' });
  const [, , music, ambience] = kit.sections;
  store.update(kit.id, {
    autoplay: true,
    sections: kit.sections.map((s) => {
      if (s.id === music.id) return { ...s, playlist: true, playlistShuffle: true };
      if (s.id === ambience.id) {
        return { ...s, playlist: true, layers: [
          { id: 'rain', kind: 'builtin', ref: 'rain.wav', volume: 0.6, on: true },
          { id: 'thunder', kind: 'builtin', ref: 'thunderstorm.wav', volume: 0.8, every: [60, 180] },
          { id: 'odd', kind: 'builtin', ref: 'wind.wav', volume: 0.5, every: [1, 2] },
        ] };
      }
      return s;
    }),
  });
  const saved = new KitStore(dir).get(kit.id);
  assert.equal(saved.autoplay, true);
  const savedMusic = saved.sections.find((s) => s.id === music.id);
  assert.equal(savedMusic.playlist, true);
  assert.equal(savedMusic.playlistShuffle, true);
  const savedAmbience = saved.sections.find((s) => s.id === ambience.id);
  assert.equal(savedAmbience.playlist, undefined, 'ambience sections are never playlists');
  const [rain, thunder, odd] = savedAmbience.layers;
  assert.equal(rain.on, true);
  assert.equal(rain.every, undefined);
  assert.deepEqual(thunder.every, [60, 180]);
  assert.equal(thunder.on, undefined);
  assert.equal(odd.every, undefined, 'only the offered ranges are kept');
  // Duplicates keep the setting; turning it off removes it.
  assert.equal(store.get(store.duplicate(kit.id).id).autoplay, true);
  assert.equal(store.update(kit.id, { autoplay: false }).autoplay, undefined);
});
