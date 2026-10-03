// Validation for icon choices stored in bashes.json and kits.json. Icons are
// ids from the app's icon set (renderer/icons.js); older data used emoji,
// which are mapped to the matching icon.
const Icons = require('./renderer/icons');

const HEX = /^#[0-9a-f]{6}$/i;

function cleanIcon(value, fallback) {
  if (typeof value !== 'string') return fallback;
  if (Icons.FROM_EMOJI[value]) return Icons.FROM_EMOJI[value];
  return Icons.get(value) && Icons.get(value).id === value ? value : fallback;
}

const cleanColor = (value, fallback) => (HEX.test(value || '') ? value.toLowerCase() : fallback);

module.exports = { cleanIcon, cleanColor, ICON_IDS: Icons.list.map((i) => i.id) };
