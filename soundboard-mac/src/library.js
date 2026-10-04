// Sound library storage: audio files plus a library.json index, kept in a
// single folder (by default ~/Library/Application Support/Soundboard/sounds).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'webm', 'aiff', 'aif', 'caf', 'mp4'];

const COLORS = ['#ff5d73', '#ffb347', '#ffe156', '#6ee7b7', '#5ec8ff', '#8b8cff', '#d58bff', '#ff8fd1'];

// Tags every library starts with. Users can add their own on top.
const PREMADE_TAGS = ['surprise', 'comedy', 'horror', 'shock', 'suspense', 'combat', 'magic', 'creature',
  'weather', 'nature', 'tavern', 'music', 'victory', 'sad', 'mystery'];
const KINDS = ['clip', 'full'];
// Sounds at least this long count as full sounds unless the user says otherwise.
const FULL_SOUND_SECONDS = 60;

class Library {
  constructor(dir) {
    this.dir = dir;
    this.indexPath = path.join(dir, 'library.json');
    this.tagsPath = path.join(dir, 'tags.json');
    fs.mkdirSync(dir, { recursive: true });
    this.sounds = this._load();
    this.customTags = this._loadTags();
  }

  _load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
      if (!Array.isArray(parsed)) return [];
      // Drop entries whose audio file has gone missing.
      return parsed.filter((s) => s && s.file && fs.existsSync(path.join(this.dir, s.file)));
    } catch {
      return [];
    }
  }

  _loadTags() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.tagsPath, 'utf8'));
      return Array.isArray(parsed.custom) ? parsed.custom.map(cleanTag).filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  _saveTags() {
    fs.writeFileSync(this.tagsPath + '.tmp', JSON.stringify({ custom: this.customTags }, null, 2));
    fs.renameSync(this.tagsPath + '.tmp', this.tagsPath);
  }

  // Premade tags, then custom ones, then any tag found on a sound but not registered.
  tags() {
    const all = [...PREMADE_TAGS, ...this.customTags];
    for (const sound of this.sounds) for (const tag of sound.tags || []) if (!all.includes(tag)) all.push(tag);
    return { premade: [...PREMADE_TAGS], all };
  }

  addTag(name) {
    const tag = cleanTag(name);
    if (!tag) throw new Error('Tag names need at least one letter or number.');
    if (!PREMADE_TAGS.includes(tag) && !this.customTags.includes(tag)) {
      this.customTags.push(tag);
      this._saveTags();
    }
    return tag;
  }

  // Deletes a custom tag and removes it from every sound.
  removeTag(name) {
    const tag = cleanTag(name);
    this.customTags = this.customTags.filter((t) => t !== tag);
    this._saveTags();
    let changed = false;
    for (const sound of this.sounds) {
      if (sound.tags && sound.tags.includes(tag)) {
        sound.tags = sound.tags.filter((t) => t !== tag);
        changed = true;
      }
    }
    if (changed) this._save();
  }

  _save() {
    const tmp = this.indexPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.sounds, null, 2));
    fs.renameSync(tmp, this.indexPath);
  }

  list() {
    return this.sounds.map((s) => ({ ...s }));
  }

  get(id) {
    return this.sounds.find((s) => s.id === id);
  }

  // Adds a sound from raw bytes. `ext` is the audio file extension.
  add({ name, data, ext, source, kind, duration }) {
    ext = String(ext || '').toLowerCase().replace(/^\./, '');
    if (!AUDIO_EXTENSIONS.includes(ext)) throw new Error(`Unsupported audio type: .${ext}`);
    const id = crypto.randomUUID();
    const file = `${id}.${ext}`;
    fs.writeFileSync(path.join(this.dir, file), Buffer.from(data));
    const sound = {
      id,
      name: cleanName(name) || 'Untitled',
      file,
      color: COLORS[this.sounds.length % COLORS.length],
      volume: 1,
      hotkey: null,
      repeat: null,
      tags: [],
      // null until the UI has measured it; full-audio downloads are full sounds by definition.
      kind: KINDS.includes(kind) ? kind : (source && source.full ? 'full' : null),
      duration: Number.isFinite(duration) && duration > 0 ? duration : null,
      source: source || null,
      createdAt: new Date().toISOString(),
    };
    this.sounds.push(sound);
    this._save();
    return { ...sound };
  }

  addFromFile(filePath, { name, source, kind } = {}) {
    const ext = path.extname(filePath).slice(1);
    return this.add({
      name: name || path.basename(filePath, path.extname(filePath)),
      data: fs.readFileSync(filePath),
      ext,
      source,
      kind,
    });
  }

  update(id, changes) {
    const sound = this.get(id);
    if (!sound) throw new Error('Sound not found');
    if ('name' in changes) sound.name = cleanName(changes.name) || sound.name;
    if ('color' in changes && /^#[0-9a-f]{6}$/i.test(changes.color)) sound.color = changes.color;
    if ('volume' in changes) sound.volume = Math.min(1, Math.max(0, Number(changes.volume) || 0));
    if ('tags' in changes) {
      const tags = (Array.isArray(changes.tags) ? changes.tags : []).map(cleanTag).filter(Boolean);
      sound.tags = [...new Set(tags)].slice(0, 20);
      // Using a brand-new tag on a sound registers it.
      let added = false;
      for (const tag of sound.tags) {
        if (!PREMADE_TAGS.includes(tag) && !this.customTags.includes(tag)) { this.customTags.push(tag); added = true; }
      }
      if (added) this._saveTags();
    }
    if ('kind' in changes && KINDS.includes(changes.kind)) sound.kind = changes.kind;
    if ('duration' in changes) {
      const d = Number(changes.duration);
      sound.duration = Number.isFinite(d) && d > 0 ? Math.round(d * 1000) / 1000 : null;
      // First time we learn the length: pick a type if none was chosen yet.
      if (!sound.kind && sound.duration) sound.kind = sound.duration >= FULL_SOUND_SECONDS ? 'full' : 'clip';
    }
    if ('repeat' in changes) {
      // null = play once; { gap } = replay `gap` seconds after it ends (0 = immediately).
      const gap = Number(changes.repeat?.gap);
      sound.repeat = changes.repeat ? { gap: Number.isFinite(gap) ? Math.min(3600, Math.max(0, Math.round(gap * 10) / 10)) : 0 } : null;
    }
    // Live Session: never sent to listeners / vibrates listeners' phones.
    if ('gmOnly' in changes) sound.gmOnly = !!changes.gmOnly;
    if ('buzz' in changes) sound.buzz = !!changes.buzz;
    if ('hotkey' in changes) {
      // Only one sound may own a given hotkey.
      if (changes.hotkey) for (const s of this.sounds) if (s.hotkey === changes.hotkey) s.hotkey = null;
      sound.hotkey = changes.hotkey || null;
    }
    this._save();
    return { ...sound };
  }

  remove(id) {
    const sound = this.get(id);
    if (!sound) return;
    this.sounds = this.sounds.filter((s) => s.id !== id);
    this._save();
    fs.rmSync(path.join(this.dir, sound.file), { force: true });
  }

  reorder(ids) {
    const byId = new Map(this.sounds.map((s) => [s.id, s]));
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
    const rest = this.sounds.filter((s) => !ids.includes(s.id));
    this.sounds = [...ordered, ...rest];
    this._save();
  }

  // Resolves a library file name to a path, refusing anything outside the folder.
  resolveFile(file) {
    const resolved = path.resolve(this.dir, file);
    if (path.dirname(resolved) !== path.resolve(this.dir)) return null;
    return resolved;
  }
}

function cleanTag(name) {
  return String(name || '').toLowerCase().replace(/[^\p{L}\p{N} &'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 24);
}

function cleanName(name) {
  return String(name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80);
}

module.exports = { Library, AUDIO_EXTENSIONS, PREMADE_TAGS, FULL_SOUND_SECONDS };
