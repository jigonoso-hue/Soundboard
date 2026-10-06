// Bookmarks: a saved moment of the game's sound, to bring back with one click
// (next session, or after a detour): the scene kit that was open, the
// playlists playing (which song, how far in), other songs playing, the
// ambience layers and their volumes, and the master and ambience volumes.
// Matches the iPad app's Model/Bookmarks.swift.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX = 50;
const EVERY = [[20, 60], [60, 180], [180, 480]];
const LAYER_KINDS = ['builtin', 'sound'];

const text = (value, max) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const id = (value) => (typeof value === 'string' && /^[\w.:-]{1,120}$/.test(value) ? value : null);
const level = (value, fallback = 1) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
};
const seconds = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 24 * 3600) : 0;
};
const cleanEvery = (every) => (Array.isArray(every) && EVERY.some(([lo, hi]) => every[0] === lo && every[1] === hi) ? [every[0], every[1]] : null);

function normalize(b) {
  if (!b || typeof b !== 'object') return null;
  const music = b.music && typeof b.music === 'object' ? b.music : {};
  const ambience = b.ambience && typeof b.ambience === 'object' ? b.ambience : {};
  return {
    id: id(b.id) || crypto.randomUUID(),
    name: text(b.name, 60) || 'Bookmark',
    at: Number(b.at) || Date.now(),
    kitId: id(b.kitId),
    master: level(b.master),
    music: {
      playlists: (Array.isArray(music.playlists) ? music.playlists : []).slice(0, 10)
        .map((p) => ({ kitId: id(p?.kitId), sectionId: id(p?.sectionId), songId: id(p?.songId), position: seconds(p?.position) }))
        .filter((p) => p.kitId && p.sectionId && p.songId),
      songs: (Array.isArray(music.songs) ? music.songs : []).slice(0, 10)
        .map((s) => ({ id: id(s?.id), position: seconds(s?.position), gain: level(s?.gain) }))
        .filter((s) => s.id),
    },
    ambience: {
      volume: level(ambience.volume, 0.8),
      layers: (Array.isArray(ambience.layers) ? ambience.layers : []).slice(0, 40)
        .map((l) => {
          const every = cleanEvery(l?.every);
          return {
            id: id(l?.id), strip: !!l?.strip, kind: LAYER_KINDS.includes(l?.kind) ? l.kind : null,
            ref: text(l?.ref, 200), volume: level(l?.volume, 0.7), ...(every ? { every } : {}),
          };
        })
        .filter((l) => l.id && l.kind && l.ref),
    },
  };
}

class BookmarkStore {
  constructor(dir) {
    this.file = path.join(dir, 'bookmarks.json');
    fs.mkdirSync(dir, { recursive: true });
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.items = Array.isArray(parsed) ? parsed.map(normalize).filter(Boolean) : [];
    } catch {
      this.items = [];
    }
  }

  _save() {
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.items, null, 2));
    fs.renameSync(this.file + '.tmp', this.file);
  }

  list() { return structuredClone(this.items); }

  // Adds a new bookmark (newest first), or replaces one with the same id.
  save(bookmark) {
    const clean = normalize(bookmark);
    if (!clean) throw new Error('Not a bookmark');
    const at = this.items.findIndex((b) => b.id === clean.id);
    if (at >= 0) this.items[at] = clean; else this.items.unshift(clean);
    this.items = this.items.slice(0, MAX);
    this._save();
    return structuredClone(clean);
  }

  rename(bookmarkId, name) {
    const item = this.items.find((b) => b.id === bookmarkId);
    if (!item) return null;
    item.name = text(name, 60) || item.name;
    this._save();
    return structuredClone(item);
  }

  remove(bookmarkId) {
    this.items = this.items.filter((b) => b.id !== bookmarkId);
    this._save();
  }

  // A scene kit was deleted: its bookmarks forget it (their sound still comes back).
  forgetKit(kitId) {
    let changed = false;
    for (const b of this.items) {
      if (b.kitId === kitId) { b.kitId = null; changed = true; }
      const before = b.music.playlists.length;
      b.music.playlists = b.music.playlists.filter((p) => p.kitId !== kitId);
      if (b.music.playlists.length !== before) changed = true;
    }
    if (changed) this._save();
  }
}

module.exports = { BookmarkStore, normalize, MAX };
