// Scene Kits: named collections of library sounds (clips and full sounds)
// and bashes, e.g. "Tavern Brawl" or "Dragon's Lair". Kits only reference
// items, so one sound can be in many kits. Stored in kits.json.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ICONS = ['🍺', '🐉', '🏰', '🌲', '⚔️', '💀', '🌊', '🔥', '🧙', '👑', '🕯️', '⛈️', '🗺️', '🏴‍☠️', '🎭', '🌙'];
const COLORS = ['#f5a742', '#ff5d73', '#7c6cff', '#6ee7b7', '#5ec8ff', '#d58bff', '#8a6a4f', '#3f4a5a'];
const ITEM_TYPES = ['sound', 'bash'];

class KitStore {
  constructor(dir) {
    this.indexPath = path.join(dir, 'kits.json');
    fs.mkdirSync(dir, { recursive: true });
    this.kits = this._load();
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

  create({ name, items = [] } = {}) {
    const index = this.kits.length;
    const kit = normalize({
      id: crypto.randomUUID(),
      name: name || `Scene Kit ${index + 1}`,
      icon: ICONS[index % ICONS.length],
      color: COLORS[index % COLORS.length],
      items,
      createdAt: new Date().toISOString(),
    });
    this.kits.push(kit);
    this._save();
    return structuredClone(kit);
  }

  update(id, changes) {
    const index = this.kits.findIndex((k) => k.id === id);
    if (index < 0) throw new Error('Scene kit not found');
    const current = this.kits[index];
    const next = normalize({ ...current, ...pick(changes, ['name', 'icon', 'color', 'items']), id: current.id, createdAt: current.createdAt });
    this.kits[index] = next;
    this._save();
    return structuredClone(next);
  }

  // Adds items that aren't already in the kit.
  addItems(id, items) {
    const kit = this.kits.find((k) => k.id === id);
    if (!kit) throw new Error('Scene kit not found');
    return this.update(id, { items: [...kit.items, ...items] });
  }

  removeItem(id, item) {
    const kit = this.kits.find((k) => k.id === id);
    if (!kit) throw new Error('Scene kit not found');
    return this.update(id, { items: kit.items.filter((i) => !(i.type === item.type && i.id === item.id)) });
  }

  duplicate(id) {
    const source = this.kits.find((k) => k.id === id);
    if (!source) throw new Error('Scene kit not found');
    const copy = this.create({ name: `${source.name} copy`, items: source.items });
    return this.update(copy.id, { icon: source.icon, color: source.color });
  }

  remove(id) {
    this.kits = this.kits.filter((k) => k.id !== id);
    this._save();
  }

  // Drops references to a deleted sound or bash. Returns true if anything changed.
  prune(type, itemId) {
    let changed = false;
    for (const kit of this.kits) {
      const before = kit.items.length;
      kit.items = kit.items.filter((i) => !(i.type === type && i.id === itemId));
      if (kit.items.length !== before) changed = true;
    }
    if (changed) this._save();
    return changed;
  }
}

function normalize(kit) {
  if (!kit || typeof kit.id !== 'string') return null;
  const seen = new Set();
  const items = [];
  for (const item of Array.isArray(kit.items) ? kit.items : []) {
    if (!item || !ITEM_TYPES.includes(item.type) || typeof item.id !== 'string') continue;
    const key = `${item.type}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ type: item.type, id: item.id });
  }
  return {
    id: kit.id,
    name: String(kit.name || 'Untitled kit').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60) || 'Untitled kit',
    icon: typeof kit.icon === 'string' && kit.icon.length <= 12 ? kit.icon : ICONS[0],
    color: /^#[0-9a-f]{6}$/i.test(kit.color || '') ? kit.color : COLORS[0],
    items,
    createdAt: kit.createdAt || new Date().toISOString(),
  };
}

function pick(obj, keys) {
  const out = {};
  for (const key of keys) if (obj && key in obj) out[key] = obj[key];
  return out;
}

module.exports = { KitStore, KIT_ICONS: ICONS, KIT_COLORS: COLORS };
