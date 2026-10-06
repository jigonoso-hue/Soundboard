const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { BookmarkStore, MAX } = require('../src/bookmarks');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bookmarks-'));

test('bookmarks are cleaned, saved newest first, and survive a restart', () => {
  const dir = tmp();
  const store = new BookmarkStore(dir);
  const saved = store.save({
    name: 'Tavern\nnight', kitId: 'kit-1', master: 3,
    music: {
      playlists: [{ kitId: 'kit-1', sectionId: 'music', songId: 'song-a', position: 42.5 }, { sectionId: 'x' }],
      songs: [{ id: 'song-b', position: -4, gain: 0.5 }],
    },
    ambience: {
      volume: 0.6,
      layers: [
        { id: 'strip-rain', strip: true, kind: 'builtin', ref: 'rain.wav', volume: 0.4 },
        { id: 'kit-amb-thunder', kind: 'builtin', ref: 'thunderstorm.wav', volume: 0.9, every: [60, 180] },
        { id: 'odd', kind: 'video', ref: 'x' },
        { id: 'odd2', kind: 'builtin', ref: 'wind.wav', every: [1, 2] },
      ],
    },
  });
  assert.equal(saved.name, 'Tavern night');
  assert.equal(saved.master, 1, 'volumes kept between 0 and 1');
  assert.deepEqual(saved.music.playlists, [{ kitId: 'kit-1', sectionId: 'music', songId: 'song-a', position: 42.5 }]);
  assert.deepEqual(saved.music.songs, [{ id: 'song-b', position: 0, gain: 0.5 }]);
  assert.equal(saved.ambience.layers.length, 3, 'unknown layer kinds are dropped');
  assert.equal(saved.ambience.layers[0].strip, true);
  assert.deepEqual(saved.ambience.layers[1].every, [60, 180]);
  assert.equal(saved.ambience.layers[2].every, undefined, 'only the offered now-and-then ranges are kept');

  const second = store.save({ name: 'Forest' });
  assert.deepEqual(new BookmarkStore(dir).list().map((b) => b.name), ['Forest', 'Tavern night']);
  // Updating keeps its place; renaming and deleting.
  store.save({ ...saved, name: 'Tavern, later' });
  assert.deepEqual(store.list().map((b) => b.name), ['Forest', 'Tavern, later']);
  store.rename(second.id, '  Deep Forest ');
  store.remove(saved.id);
  assert.deepEqual(new BookmarkStore(dir).list().map((b) => b.name), ['Deep Forest']);
});

test('a deleted kit is forgotten by its bookmarks, and there is a limit', () => {
  const store = new BookmarkStore(tmp());
  const b = store.save({ name: 'X', kitId: 'gone', music: { playlists: [{ kitId: 'gone', sectionId: 's', songId: 'a' }], songs: [{ id: 'free' }] } });
  store.forgetKit('gone');
  const after = store.list().find((x) => x.id === b.id);
  assert.equal(after.kitId, null);
  assert.equal(after.music.playlists.length, 0);
  assert.equal(after.music.songs.length, 1, 'songs playing on their own still come back');
  for (let i = 0; i < MAX + 5; i++) store.save({ name: `B${i}` });
  assert.equal(store.list().length, MAX);
});
