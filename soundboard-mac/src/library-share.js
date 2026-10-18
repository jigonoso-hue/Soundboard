// Sharing a whole library between the apps (Mac, iPhone/iPad, Android): one
// zip file holding dungeon-radio-library.json (the sounds, bashes, scene kits
// and custom tags) beside the sound files (sounds/<id>.<ext>) and bash cover
// pictures (covers/<id>.<ext>). Every app writes this same file and reads it
// back. See LIBRARY-FORMAT.md at the top of the repo; the iPhone/iPad app's copy of these rules is
// Model/LibraryShare.swift.
//
// Importing adds to the library; it never replaces anything. Something
// already there (the same id, or for a sound the very same audio) is kept
// and the import points at it, so importing a file twice adds nothing.
// This module is plain JavaScript over the store modules: the Mac runs it in
// its main process (zip.js reads and writes the zip), Android over
// node-shim.js (the native side reads and writes the zip).
const fs = require('fs');
const path = require('path');
const { AUDIO_EXTENSIONS } = require('./library');
const { COVER_TYPES } = require('./bashes');

const MANIFEST = 'dungeon-radio-library.json';
const FORMAT = 'dungeon-radio-library';
const VERSION = 1;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SOUND_FILE = new RegExp(`^sounds/[0-9a-f-]{36}\\.(${AUDIO_EXTENSIONS.join('|')})$`);
const COVER_FILE = new RegExp(`^covers/[0-9a-f-]{36}\\.(${COVER_TYPES.join('|')})$`);
const HEX = /^#[0-9a-f]{6}$/;
const MAX_ITEMS = 20000;

const id = (value) => (typeof value === 'string' && UUID.test(value.toLowerCase()) ? value.toLowerCase() : null);
const ext = (file) => path.extname(file).slice(1).toLowerCase();
const text = (value, max) => String(value ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);
const num = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

// ---------------------------------------------------------------------------
// Export

// What goes in the file: { manifest, files: [{ name, path }] }. The stores
// are the app's own (Library, BashStore, KitStore). Kits and bashes keep
// only what points at sounds and bashes that are in the file.
function exportPlan({ library, bashes, kits, app = 'Dungeon Radio' }) {
  const files = [];
  const sounds = [];
  for (const s of library.list()) {
    const sid = id(s.id);
    const source = library.resolveFile(s.file);
    const e = ext(s.file);
    if (!sid || !source || !fs.existsSync(source) || !AUDIO_EXTENSIONS.includes(e)) continue;
    const name = `sounds/${sid}.${e}`;
    files.push({ name, path: source });
    sounds.push({
      id: sid,
      name: s.name,
      file: name,
      color: HEX.test(String(s.color).toLowerCase()) ? String(s.color).toLowerCase() : null,
      volume: s.volume ?? 1,
      tags: s.tags || [],
      kind: s.kind || null,
      duration: s.duration || null,
      repeat: s.repeat ? { gap: s.repeat.gap || 0 } : null,
      ...(s.gmOnly ? { gmOnly: true } : {}),
      ...(s.buzz ? { buzz: true } : {}),
      source: s.source || null,
      createdAt: s.createdAt || null,
    });
  }
  const soundIds = new Set(sounds.map((s) => s.id));
  const bashList = [];
  for (const b of bashes.list()) {
    const bid = id(b.id);
    if (!bid) continue;
    let cover = b.cover;
    if (cover.type === 'image') {
      const source = bashes.coverPath(cover.file);
      const e = ext(cover.file);
      if (source && fs.existsSync(source) && COVER_TYPES.includes(e)) {
        const name = `covers/${bid}.${e}`;
        files.push({ name, path: source });
        cover = { type: 'image', file: name };
      } else {
        cover = { type: 'icon', icon: 'crossed-swords', color: '#7c6cff', iconColor: '#ffffff' };
      }
    }
    bashList.push({
      id: bid,
      name: b.name,
      cover,
      clips: b.clips.filter((c) => soundIds.has(id(c.soundId))).map((c) => ({ ...c, soundId: id(c.soundId) })),
      createdAt: b.createdAt || null,
    });
  }
  const bashIds = new Set(bashList.map((b) => b.id));
  const kitList = kits.list().filter((k) => id(k.id)).map((k) => ({
    ...k,
    id: id(k.id),
    sections: k.sections.map((s) => ({
      ...s,
      items: s.items.filter((i) => (i.type === 'sound' ? soundIds.has(id(i.id)) : bashIds.has(id(i.id))))
        .map((i) => ({ type: i.type, id: id(i.id) })),
      layers: s.layers.filter((l) => l.kind === 'builtin' || soundIds.has(id(l.ref)))
        .map((l) => (l.kind === 'sound' ? { ...l, ref: id(l.ref) } : l)),
    })),
  }));
  const manifest = {
    format: FORMAT,
    version: VERSION,
    app,
    exportedAt: new Date().toISOString(),
    tags: library.customTags ? [...library.customTags] : [],
    sounds,
    bashes: bashList,
    kits: kitList,
  };
  return { manifest, files };
}

// ---------------------------------------------------------------------------
// Reading a file someone else made: checked field by field.

function readManifest(raw) {
  let m;
  try { m = JSON.parse(typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8')); } catch { m = null; }
  if (!m || m.format !== FORMAT) throw new Error('That file isn’t a Dungeon Radio library.');
  if (!(Number(m.version) >= 1)) throw new Error('That library file is damaged.');
  if (m.version > VERSION) throw new Error('That library was made by a newer Dungeon Radio. Update the app to open it.');
  const list = (value) => (Array.isArray(value) ? value.slice(0, MAX_ITEMS) : []);
  const sounds = [];
  const seen = new Set();
  for (const s of list(m.sounds)) {
    const sid = s && id(s.id);
    if (!sid || seen.has(sid) || !SOUND_FILE.test(String(s.file))) continue;
    seen.add(sid);
    const gap = s.repeat && typeof s.repeat === 'object' ? num(s.repeat.gap, 0, 3600, 0) : null;
    sounds.push({
      id: sid,
      name: text(s.name, 80) || 'Untitled',
      file: s.file,
      color: HEX.test(String(s.color).toLowerCase()) ? String(s.color).toLowerCase() : null,
      volume: num(s.volume, 0, 1, 1),
      tags: list(s.tags).map((t) => text(t, 24).toLowerCase()).filter(Boolean).slice(0, 20),
      kind: ['clip', 'full'].includes(s.kind) ? s.kind : null,
      duration: num(s.duration, 0, 24 * 3600, 0) || null,
      repeat: gap === null ? null : { gap },
      gmOnly: !!s.gmOnly,
      buzz: !!s.buzz,
      source: cleanSource(s.source),
      createdAt: typeof s.createdAt === 'string' && !Number.isNaN(Date.parse(s.createdAt)) ? s.createdAt : null,
    });
  }
  const bashes = [];
  for (const b of list(m.bashes)) {
    const bid = b && id(b.id);
    if (!bid || bashes.some((x) => x.id === bid)) continue;
    const cover = b.cover && b.cover.type === 'image' && COVER_FILE.test(String(b.cover.file))
      ? { type: 'image', file: b.cover.file }
      : { type: 'icon', icon: text(b.cover?.icon, 60), color: b.cover?.color, iconColor: b.cover?.iconColor };
    bashes.push({
      id: bid,
      name: text(b.name, 80) || 'Untitled bash',
      cover,
      clips: list(b.clips).filter((c) => c && id(c.soundId)).map((c) => ({
        soundId: id(c.soundId),
        offset: num(c.offset, 0, 3600, 0),
        volume: num(c.volume, 0, 1, 1),
        lane: Math.floor(num(c.lane, 0, 999, 0)),
        repeat: c.repeat && typeof c.repeat === 'object' ? { gap: num(c.repeat.gap, 0, 3600, 0), times: Math.floor(num(c.repeat.times, 0, 999, 0)) } : null,
      })),
      createdAt: typeof b.createdAt === 'string' ? b.createdAt : null,
    });
  }
  const kits = [];
  for (const k of list(m.kits)) {
    const kid = k && id(k.id);
    if (!kid || kits.some((x) => x.id === kid) || !Array.isArray(k.sections)) continue;
    kits.push({
      ...k,
      id: kid,
      sections: k.sections.slice(0, 200).filter((s) => s && typeof s === 'object').map((s) => ({
        ...s,
        id: id(s.id) || undefined,
        items: list(s.items).filter((i) => i && ['sound', 'bash'].includes(i.type) && id(i.id)).map((i) => ({ type: i.type, id: id(i.id) })),
        layers: list(s.layers).filter((l) => l && (l.kind === 'builtin' || (l.kind === 'sound' && id(l.ref))))
          .map((l) => ({ ...l, ref: l.kind === 'sound' ? id(l.ref) : String(l.ref) })),
      })),
    });
  }
  const tags = list(m.tags).map((t) => text(t, 24).toLowerCase()).filter(Boolean).slice(0, 500);
  return { app: text(m.app, 40), sounds, bashes, kits, tags };
}

function cleanSource(source) {
  if (!source || typeof source !== 'object') return null;
  const url = text(source.url, 500);
  if (url && !/^https:\/\//.test(url)) return null;
  return {
    title: text(source.title, 200),
    url,
    start: num(source.start, 0, 1e6, 0),
    end: num(source.end, 0, 1e6, 0),
    ...(source.full ? { full: true } : {}),
  };
}

// ---------------------------------------------------------------------------
// Import

// Plans an import: which sounds, bashes and kits are new, and where the rest
// already are. file: { size(name), read(name) → bytes } for the zip's files.
function planImport(manifest, { library, bashes, kits }, file) {
  const existing = library.list();
  const soundMap = new Map(); // id in the file → id in this library
  const newSounds = [];
  // The same audio already here (another id: added separately on each device).
  const bySize = new Map();
  const sizeOf = (s) => {
    try { return fs.statSync(library.resolveFile(s.file)).size; } catch { return -1; }
  };
  for (const s of existing) {
    const size = sizeOf(s);
    if (!bySize.has(size)) bySize.set(size, []);
    bySize.get(size).push(s);
  }
  for (const s of manifest.sounds) {
    if (library.get(s.id)) { soundMap.set(s.id, s.id); continue; }
    const size = file.size(s.file);
    if (size === null) continue; // not in the zip
    const same = (bySize.get(size) || []).find((e) => {
      try { return Buffer.from(fs.readFileSync(library.resolveFile(e.file))).equals(Buffer.from(file.read(s.file))); } catch { return false; }
    });
    if (same) { soundMap.set(s.id, same.id); continue; }
    soundMap.set(s.id, s.id);
    newSounds.push(s);
  }
  const haveBash = new Set(bashes.list().map((b) => b.id));
  const newBashes = manifest.bashes.filter((b) => !haveBash.has(b.id));
  const bashIds = new Set([...haveBash, ...manifest.bashes.map((b) => b.id)]);
  const haveKit = new Set(kits.list().map((k) => k.id));
  const newKits = manifest.kits.filter((k) => !haveKit.has(k.id));
  const counts = { clips: 0, full: 0, bashes: newBashes.length, kits: newKits.length };
  for (const s of newSounds) counts[s.kind === 'full' ? 'full' : 'clips'] += 1;
  return { soundMap, bashIds, newSounds, newBashes, newKits, counts };
}

// Applies a plan. Returns { sounds, bashes, kits, skipped } (how many were added,
// and how many were already in the library).
function applyImport(manifest, plan, { library, bashes, kits }, file) {
  for (const tag of manifest.tags) { try { library.addTag(tag); } catch { /* not a tag */ } }
  let added = 0;
  for (const s of plan.newSounds) {
    try {
      library.importSound(s, file.path ? file.path(s.file) : null, file.path ? null : file.read(s.file));
      added += 1;
    } catch (err) {
      plan.soundMap.delete(s.id);
      console.warn(`Couldn't import ${s.name}: ${err.message}`);
    }
  }
  const soundId = (sid) => plan.soundMap.get(sid) || (library.get(sid) ? sid : null);
  let bashCount = 0;
  for (const b of plan.newBashes) {
    const clips = b.clips.map((c) => ({ ...c, soundId: soundId(c.soundId) })).filter((c) => c.soundId);
    let cover = b.cover;
    let image = null;
    if (cover.type === 'image') {
      try { image = { data: file.read(cover.file), ext: ext(cover.file) }; } catch { image = null; }
      cover = { type: 'icon' };
    }
    bashes.importBash({ ...b, clips, cover }, image);
    bashCount += 1;
  }
  const haveBash = new Set(bashes.list().map((b) => b.id));
  let kitCount = 0;
  for (const k of plan.newKits) {
    kits.importKit({
      ...k,
      sections: k.sections.map((s) => ({
        ...s,
        items: s.items.map((i) => (i.type === 'sound' ? { ...i, id: soundId(i.id) } : i))
          .filter((i) => i.id && (i.type === 'sound' || haveBash.has(i.id))),
        layers: s.layers.map((l) => (l.kind === 'sound' ? { ...l, ref: soundId(l.ref) } : l)).filter((l) => l.ref),
      })),
    });
    kitCount += 1;
  }
  const skipped = manifest.sounds.length - plan.newSounds.length + manifest.bashes.length - plan.newBashes.length + manifest.kits.length - plan.newKits.length;
  return { sounds: added, bashes: bashCount, kits: kitCount, skipped };
}

// "Added 12 sounds, 3 bashes and 2 scene kits." for the screens.
function describeImport(result) {
  const parts = [];
  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  if (result.sounds) parts.push(n(result.sounds, 'sound', 'sounds'));
  if (result.bashes) parts.push(n(result.bashes, 'bash', 'bashes'));
  if (result.kits) parts.push(n(result.kits, 'scene kit', 'scene kits'));
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  const already = result.skipped ? ` ${n(result.skipped, 'thing was', 'things were')} already in your library.` : '';
  return list ? `Added ${list}.${already}` : `Everything in that file is already in your library.`;
}

// ---------------------------------------------------------------------------
// The Mac: straight to and from a zip file (zip.js). Android does the zip
// part natively and calls the functions above.

function exportToZip(outPath, stores, app) {
  const { writeZip } = require('./zip');
  const { manifest, files } = exportPlan({ ...stores, app });
  writeZip(outPath, [{ name: MANIFEST, data: Buffer.from(JSON.stringify(manifest)) }, ...files]);
  return { sounds: manifest.sounds.length, bashes: manifest.bashes.length, kits: manifest.kits.length };
}

// checkLimits(counts): throws if the new things don't fit (the free version's limits).
function importFromZip(zipPath, stores, { checkLimits } = {}) {
  const { openZip } = require('./zip');
  const zip = openZip(zipPath);
  try {
    const raw = zip.read(MANIFEST);
    if (!raw) throw new Error('That file isn’t a Dungeon Radio library.');
    const manifest = readManifest(raw);
    const file = { size: (name) => zip.size(name), read: (name) => zip.read(name) };
    const plan = planImport(manifest, stores, file);
    if (checkLimits) checkLimits(plan.counts);
    return applyImport(manifest, plan, stores, file);
  } finally {
    zip.close();
  }
}

module.exports = { exportToZip, importFromZip, MANIFEST, FORMAT, VERSION, exportPlan, readManifest, planImport, applyImport, describeImport };
