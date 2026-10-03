// Scene Kits: named, customizable boards of sections, each holding sounds
// (clips, full sounds) and bashes from the library, e.g. "Tavern Brawl".
// Kits only reference items, so one sound can be in many kits.
//
// Layout: sections sit on a 12-column grid (x, w in columns; y, h in rows).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { cleanIcon, cleanColor } = require('./icon-ids');

const ICONS = ['mug', 'dragon', 'castle', 'pine', 'crossed-swords', 'skull', 'wave', 'flame', 'wizard-hat', 'crown', 'candle', 'storm', 'map', 'jolly-roger', 'mask', 'moon'];
const COLORS = ['#f5a742', '#ff5d73', '#7c6cff', '#6ee7b7', '#5ec8ff', '#d58bff', '#8a6a4f', '#3f4a5a'];
const ITEM_TYPES = ['sound', 'bash'];
// What a section is meant for. It decides which items "+ Add" shows first and
// where items added from elsewhere land; any sound section can hold any item.
// Ambience sections hold looping layers (built-in loops or library sounds)
// instead of items.
const SECTION_KINDS = ['bashes', 'clips', 'full', 'mixed', 'ambience'];
const LAYER_KINDS = ['builtin', 'sound'];
const SIZES = ['s', 'm', 'l'];
const COLUMNS = 12;

const DEFAULT_SECTIONS = [
  { title: 'Bashes', kind: 'bashes', x: 0, y: 0, w: 12, h: 4 },
  { title: 'Sound Effects', kind: 'clips', x: 0, y: 4, w: 7, h: 8 },
  { title: 'Music', kind: 'full', x: 7, y: 4, w: 5, h: 8 },
  { title: 'Ambience', kind: 'ambience', x: 0, y: 12, w: 12, h: 5 },
];

class KitStore {
  constructor(dir) {
    this.indexPath = path.join(dir, 'kits.json');
    fs.mkdirSync(dir, { recursive: true });
    this.kits = this._load();
  }

  // Older kits were converted with every sound under "Sound Effects"; move the
  // full sounds into "Music" now that we know which ones they are.
  finishMigration(sounds) {
    const full = new Set(sounds.filter((s) => s.kind === 'full').map((s) => s.id));
    let changed = false;
    for (const kit of this.kits) {
      if (!kit.migrated) continue;
      delete kit.migrated;
      changed = true;
      const clips = kit.sections.find((s) => s.kind === 'clips');
      const music = kit.sections.find((s) => s.kind === 'full');
      if (!clips || !music) continue;
      music.items.push(...clips.items.filter((i) => full.has(i.id)));
      clips.items = clips.items.filter((i) => !full.has(i.id));
    }
    if (changed) this._save();
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
    fs.writeFileSync(this.indexPath + '.tmp', JSON.stringify(this.kits, null, 2));
    fs.renameSync(this.indexPath + '.tmp', this.indexPath);
  }

  list() {
    return structuredClone(this.kits);
  }

  get(id) {
    const kit = this.kits.find((k) => k.id === id);
    return kit ? structuredClone(kit) : null;
  }

  create({ name } = {}) {
    const index = this.kits.length;
    const kit = normalize({
      id: crypto.randomUUID(),
      name: name || `Scene Kit ${index + 1}`,
      icon: ICONS[index % ICONS.length],
      color: COLORS[index % COLORS.length],
      sections: defaultSections(),
      createdAt: new Date().toISOString(),
    });
    this.kits.push(kit);
    this._save();
    return structuredClone(kit);
  }

  // Replaces name, icon, colour and/or the whole sections array (layout and items).
  update(id, changes) {
    const index = this.kits.findIndex((k) => k.id === id);
    if (index < 0) throw new Error('Scene kit not found');
    const current = this.kits[index];
    const next = normalize({ ...current, ...pick(changes, ['name', 'icon', 'color', 'iconColor', 'sections']), id: current.id, createdAt: current.createdAt });
    delete next.migrated;
    this.kits[index] = next;
    this._save();
    return structuredClone(next);
  }

  // Adds items to a section (or, without one, to the section best suited to each item).
  addItems(id, items, sectionId, sounds = []) {
    const kit = this.kits.find((k) => k.id === id);
    if (!kit) throw new Error('Scene kit not found');
    const sections = structuredClone(kit.sections);
    if (!sections.some((s) => s.kind !== 'ambience')) sections.push(...defaultSections().filter((s) => s.kind !== 'ambience'));
    for (const item of items) {
      const chosen = sections.find((s) => s.id === sectionId && s.kind !== 'ambience');
      const target = chosen || bestSection(sections, item, sounds);
      if (!target.items.some((i) => i.type === item.type && i.id === item.id)) target.items.push({ type: item.type, id: item.id });
    }
    return this.update(id, { sections });
  }

  // Removes an item from one section, or from the whole kit when no section is given.
  removeItem(id, item, sectionId) {
    const kit = this.kits.find((k) => k.id === id);
    if (!kit) throw new Error('Scene kit not found');
    const sections = structuredClone(kit.sections);
    for (const section of sections) {
      if (sectionId && section.id !== sectionId) continue;
      section.items = section.items.filter((i) => !(i.type === item.type && i.id === item.id));
    }
    return this.update(id, { sections });
  }

  duplicate(id) {
    const source = this.kits.find((k) => k.id === id);
    if (!source) throw new Error('Scene kit not found');
    const copy = this.create({ name: `${source.name} copy` });
    const sections = source.sections.map((s) => ({ ...structuredClone(s), id: crypto.randomUUID() }));
    return this.update(copy.id, { icon: source.icon, color: source.color, iconColor: source.iconColor, sections });
  }

  remove(id) {
    this.kits = this.kits.filter((k) => k.id !== id);
    this._save();
  }

  // Drops references to a deleted sound or bash. Returns true if anything changed.
  prune(type, itemId) {
    let changed = false;
    for (const kit of this.kits) {
      for (const section of kit.sections) {
        const before = section.items.length + section.layers.length;
        section.items = section.items.filter((i) => !(i.type === type && i.id === itemId));
        if (type === 'sound') section.layers = section.layers.filter((l) => !(l.kind === 'sound' && l.ref === itemId));
        if (section.items.length + section.layers.length !== before) changed = true;
      }
    }
    if (changed) this._save();
    return changed;
  }
}

function defaultSections() {
  return DEFAULT_SECTIONS.map((s) => ({ ...s, id: crypto.randomUUID(), size: 'm', items: [], layers: [] }));
}

// Where an item goes when added without picking a section.
function bestSection(sections, item, sounds) {
  let kind = 'bashes';
  if (item.type === 'sound') {
    const sound = sounds.find((s) => s.id === item.id);
    kind = sound && sound.kind === 'full' ? 'full' : 'clips';
  }
  return sections.find((s) => s.kind === kind) || sections.find((s) => s.kind === 'mixed')
    || sections.find((s) => s.kind !== 'ambience');
}

function cleanItems(list) {
  const seen = new Set();
  const items = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || !ITEM_TYPES.includes(item.type) || typeof item.id !== 'string') continue;
    const key = `${item.type}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ type: item.type, id: item.id });
  }
  return items;
}

function cleanLayers(list) {
  const seen = new Set();
  const layers = [];
  for (const layer of Array.isArray(list) ? list : []) {
    if (!layer || !LAYER_KINDS.includes(layer.kind) || typeof layer.ref !== 'string') continue;
    if (layer.kind === 'builtin' && !/^[a-z0-9-]+\.wav$/.test(layer.ref)) continue;
    const key = `${layer.kind}:${layer.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const volume = Number(layer.volume);
    layers.push({
      id: typeof layer.id === 'string' && /^[\w-]{1,64}$/.test(layer.id) ? layer.id : crypto.randomUUID(),
      kind: layer.kind,
      ref: layer.ref,
      volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0.7,
    });
  }
  return layers;
}

const int = (value, min, max, fallback) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

function normalizeSection(section, index) {
  if (!section || typeof section !== 'object') return null;
  const w = int(section.w, 2, COLUMNS, 6);
  return {
    id: typeof section.id === 'string' && section.id ? section.id : crypto.randomUUID(),
    title: String(section.title || 'Section').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40) || 'Section',
    kind: SECTION_KINDS.includes(section.kind) ? section.kind : 'mixed',
    x: int(section.x, 0, COLUMNS - w, 0),
    y: int(section.y, 0, 500, index * 6),
    w,
    h: int(section.h, 2, 40, 6),
    size: SIZES.includes(section.size) ? section.size : 'm',
    items: section.kind === 'ambience' ? [] : cleanItems(section.items),
    layers: section.kind === 'ambience' ? cleanLayers(section.layers) : [],
  };
}

function normalize(kit) {
  if (!kit || typeof kit.id !== 'string') return null;
  let sections;
  if (Array.isArray(kit.sections)) {
    sections = kit.sections.map(normalizeSection).filter(Boolean);
  } else {
    // Older kits kept a flat item list: sort it into the default sections.
    sections = defaultSections();
    for (const item of cleanItems(kit.items)) {
      const target = item.type === 'bash' ? sections[0] : sections[1];
      target.items.push(item);
    }
  }
  const ids = new Set();
  for (const s of sections) {
    if (ids.has(s.id)) s.id = crypto.randomUUID();
    ids.add(s.id);
  }
  const migrated = !Array.isArray(kit.sections);
  return {
    ...(migrated ? { migrated: true } : {}),
    id: kit.id,
    name: String(kit.name || 'Untitled kit').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60) || 'Untitled kit',
    icon: cleanIcon(kit.icon, ICONS[0]),
    color: cleanColor(kit.color, COLORS[0]),
    iconColor: cleanColor(kit.iconColor, '#ffffff'),
    sections,
    createdAt: kit.createdAt || new Date().toISOString(),
  };
}

function pick(obj, keys) {
  const out = {};
  for (const key of keys) if (obj && key in obj) out[key] = obj[key];
  return out;
}

module.exports = { KitStore, KIT_ICONS: ICONS, KIT_COLORS: COLORS, COLUMNS };
