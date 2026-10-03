// Sound library storage: audio files plus a library.json index, kept in a
// single folder (by default ~/Library/Application Support/Soundboard/sounds).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'webm', 'aiff', 'aif', 'caf', 'mp4'];

const COLORS = ['#ff5d73', '#ffb347', '#ffe156', '#6ee7b7', '#5ec8ff', '#8b8cff', '#d58bff', '#ff8fd1'];

class Library {
  constructor(dir) {
    this.dir = dir;
    this.indexPath = path.join(dir, 'library.json');
    fs.mkdirSync(dir, { recursive: true });
    this.sounds = this._load();
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
  add({ name, data, ext, source }) {
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
      source: source || null,
      createdAt: new Date().toISOString(),
    };
    this.sounds.push(sound);
    this._save();
    return { ...sound };
  }

  addFromFile(filePath, { name, source } = {}) {
    const ext = path.extname(filePath).slice(1);
    return this.add({
      name: name || path.basename(filePath, path.extname(filePath)),
      data: fs.readFileSync(filePath),
      ext,
      source,
    });
  }

  update(id, changes) {
    const sound = this.get(id);
    if (!sound) throw new Error('Sound not found');
    if ('name' in changes) sound.name = cleanName(changes.name) || sound.name;
    if ('color' in changes && /^#[0-9a-f]{6}$/i.test(changes.color)) sound.color = changes.color;
    if ('volume' in changes) sound.volume = Math.min(1, Math.max(0, Number(changes.volume) || 0));
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

function cleanName(name) {
  return String(name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80);
}

module.exports = { Library, AUDIO_EXTENSIONS };
