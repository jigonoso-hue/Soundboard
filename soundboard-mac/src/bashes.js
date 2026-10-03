// Bashes: named groups of library sounds that play together. Each clip has a
// start offset (seconds from when the bash is triggered), a volume and a lane
// (its row in the timeline editor). Stored in bashes.json next to the sounds;
// cover images live in a covers/ folder.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ICONS = ['⚔️', '🐉', '🍺', '🔥', '🌲', '🏰', '💀', '🌊', '⚡', '🎲', '🧙', '🌙', '👑', '🕯️', '🗡️', '🛡️', '🐺', '👻', '⛈️', '🎻'];
const ICON_COLORS = ['#7c6cff', '#ff5d73', '#ffb347', '#6ee7b7', '#5ec8ff', '#d58bff', '#8a6a4f', '#3f4a5a'];
const COVER_TYPES = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
const MAX_OFFSET = 60 * 60;

class BashStore {
  constructor(dir) {
    this.dir = dir;
    this.coversDir = path.join(dir, 'covers');
    this.indexPath = path.join(dir, 'bashes.json');
    fs.mkdirSync(this.coversDir, { recursive: true });
    this.bashes = this._load();
  }

  _load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
      return Array.isArray(parsed) ? parsed.map(normalize).filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  _save() {
    const tmp = this.indexPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.bashes, null, 2));
    fs.renameSync(tmp, this.indexPath);
  }

  list() {
    return structuredClone(this.bashes);
  }

  get(id) {
    const bash = this.bashes.find((b) => b.id === id);
    return bash ? structuredClone(bash) : null;
  }

  create({ name, soundIds = [] } = {}) {
    const index = this.bashes.length;
    const bash = normalize({
      id: crypto.randomUUID(),
      name: name || `Bash ${index + 1}`,
      cover: { type: 'icon', icon: ICONS[index % ICONS.length], color: ICON_COLORS[index % ICON_COLORS.length] },
      // By default every sound starts at the same time, each on its own lane.
      clips: soundIds.map((soundId, lane) => ({ soundId, offset: 0, volume: 1, lane })),
      createdAt: new Date().toISOString(),
    });
    this.bashes.push(bash);
    this._save();
    return structuredClone(bash);
  }

  // Replaces a bash's editable fields (name, cover icon/color, clips).
  update(id, changes) {
    const index = this.bashes.findIndex((b) => b.id === id);
    if (index < 0) throw new Error('Bash not found');
    const current = this.bashes[index];
    const next = normalize({ ...current, ...pick(changes, ['name', 'clips', 'cover']), id: current.id, createdAt: current.createdAt });
    // An image cover can only be set through setCoverImage.
    if (next.cover.type === 'image' && next.cover.file !== current.cover.file) next.cover = current.cover;
    if (current.cover.type === 'image' && next.cover.type !== 'image') this._removeCoverFile(current.cover.file);
    this.bashes[index] = next;
    this._save();
    return structuredClone(next);
  }

  setCoverImage(id, data, ext) {
    const bash = this.bashes.find((b) => b.id === id);
    if (!bash) throw new Error('Bash not found');
    ext = String(ext).toLowerCase();
    if (!COVER_TYPES.includes(ext)) throw new Error(`Unsupported image type: .${ext}`);
    const file = `${id}-${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(this.coversDir, file), data);
    if (bash.cover.type === 'image') this._removeCoverFile(bash.cover.file);
    bash.cover = { type: 'image', file };
    this._save();
    return structuredClone(bash);
  }

  remove(id) {
    const bash = this.bashes.find((b) => b.id === id);
    if (!bash) return;
    this.bashes = this.bashes.filter((b) => b.id !== id);
    if (bash.cover.type === 'image') this._removeCoverFile(bash.cover.file);
    this._save();
  }

  duplicate(id) {
    const source = this.bashes.find((b) => b.id === id);
    if (!source) throw new Error('Bash not found');
    const copy = this.create({ name: `${source.name} copy` });
    const cover = source.cover.type === 'icon' ? source.cover : copy.cover;
    if (source.cover.type === 'image') {
      const data = fs.readFileSync(path.join(this.coversDir, source.cover.file));
      this.setCoverImage(copy.id, data, path.extname(source.cover.file).slice(1));
      return this.update(copy.id, { clips: source.clips });
    }
    return this.update(copy.id, { clips: source.clips, cover });
  }

  // Drops clips that point at a deleted sound. Returns true if anything changed.
  pruneSound(soundId) {
    let changed = false;
    for (const bash of this.bashes) {
      const before = bash.clips.length;
      bash.clips = bash.clips.filter((c) => c.soundId !== soundId);
      if (bash.clips.length !== before) changed = true;
    }
    if (changed) this._save();
    return changed;
  }

  coverPath(file) {
    const resolved = path.resolve(this.coversDir, file);
    return path.dirname(resolved) === path.resolve(this.coversDir) ? resolved : null;
  }

  _removeCoverFile(file) {
    const p = this.coverPath(file);
    if (p) fs.rmSync(p, { force: true });
  }
}

function normalize(bash) {
  if (!bash || typeof bash.id !== 'string') return null;
  const cover = bash.cover && bash.cover.type === 'image' && typeof bash.cover.file === 'string'
    ? { type: 'image', file: bash.cover.file }
    : {
      type: 'icon',
      icon: typeof bash.cover?.icon === 'string' && bash.cover.icon.length <= 8 ? bash.cover.icon : ICONS[0],
      color: /^#[0-9a-f]{6}$/i.test(bash.cover?.color || '') ? bash.cover.color : ICON_COLORS[0],
    };
  const clips = (Array.isArray(bash.clips) ? bash.clips : [])
    .filter((c) => c && typeof c.soundId === 'string')
    .map((c) => ({
      id: typeof c.id === 'string' ? c.id : crypto.randomUUID(),
      soundId: c.soundId,
      offset: clamp(Math.round((Number(c.offset) || 0) * 1000) / 1000, 0, MAX_OFFSET),
      volume: clamp(Number(c.volume ?? 1), 0, 1),
      lane: Math.max(0, Math.floor(Number(c.lane) || 0)),
      repeat: normalizeRepeat(c.repeat),
    }));
  return {
    id: bash.id,
    name: String(bash.name || 'Untitled bash').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80) || 'Untitled bash',
    cover,
    clips,
    createdAt: bash.createdAt || new Date().toISOString(),
  };
}

// null = play once. { gap, times }: replay `gap` seconds after each play ends
// (0 = immediately); `times` is the total number of plays, 0 = until stopped.
function normalizeRepeat(repeat) {
  if (!repeat || typeof repeat !== 'object') return null;
  const times = Math.floor(Number(repeat.times) || 0);
  return {
    gap: Math.round(clamp(Number(repeat.gap) || 0, 0, 3600) * 10) / 10,
    times: times >= 2 ? Math.min(999, times) : 0,
  };
}

function clamp(value, min, max) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

function pick(obj, keys) {
  const out = {};
  for (const key of keys) if (obj && key in obj) out[key] = obj[key];
  return out;
}

module.exports = { BashStore, ICONS, ICON_COLORS, COVER_TYPES };
