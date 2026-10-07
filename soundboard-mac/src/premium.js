// Dungeon Radio Premium: what the free version allows, on iPhone/iPad and
// Android. (The Mac app is always unlocked and doesn't use this.) The iPhone
// app mirrors it in Model/Premium.swift; keep the two the same.
//
// Free: 10 clips, 5 full sounds, 5 bashes and 2 scene kits; all of ambience,
// bookmarks and playlists; broadcasting with dice, custom dice and players'
// sounds. Premium: no limits, plus the broadcaster's games (buzzer, quiz),
// handouts, whispers, emphasis, and roll requests, initiative and contests.
// Listeners never need Premium: what the broadcaster runs, everyone joins.
//
// Nothing is taken away if Premium lapses: everything already made keeps
// working; only adding more past the limits is blocked.

const LIMITS = { clips: 10, full: 5, bashes: 5, kits: 2 };

// Features only the broadcaster with Premium can start.
const FEATURES = {
  games: 'Games: buzzer and quiz',
  handouts: 'Handouts: show pictures on listeners’ screens',
  whispers: 'Whispers: play a sound to chosen listeners',
  emphasis: 'Emphasis: make listeners’ phones vibrate',
  table: 'Roll requests, initiative and “Who wins?” contests',
};

// A sound's type: "full" or "clip" (a sound not measured yet counts as a clip).
const kindOf = (sound) => (sound && sound.kind === 'full' ? 'full' : 'clip');

function countSounds(sounds) {
  const out = { clips: 0, full: 0 };
  for (const s of sounds || []) out[kindOf(s) === 'full' ? 'full' : 'clips'] += 1;
  return out;
}

// The limit adding one more `kind` sound would break ("clips" or "full"), or null.
function soundLimit(sounds, kind) {
  const c = countSounds(sounds);
  if (kind === 'full') return c.full >= LIMITS.full ? 'full' : null;
  return c.clips >= LIMITS.clips ? 'clips' : null;
}

// The limit adding one more bash or kit would break, or null. type: "bashes" | "kits".
function itemLimit(type, count) {
  return count >= LIMITS[type] ? type : null;
}

function limitMessage(limit) {
  const what = { clips: `${LIMITS.clips} clips`, full: `${LIMITS.full} full sounds`, bashes: `${LIMITS.bashes} bashes`, kits: `${LIMITS.kits} scene kits` }[limit];
  return `The free version holds up to ${what}. Premium removes the limit.`;
}

// An error the screens recognise: it opens the Premium screen.
function limitError(limit) {
  return Object.assign(new Error(limitMessage(limit)), { premiumLimit: limit });
}

module.exports = { LIMITS, FEATURES, kindOf, countSounds, soundLimit, itemLimit, limitMessage, limitError };
