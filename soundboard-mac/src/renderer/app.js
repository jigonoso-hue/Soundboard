/* global AudioUtils, Tags, Kits */
const api = window.soundboard;
const $ = (sel) => document.querySelector(sel);

const COLORS = ['#ff5d73', '#ffb347', '#ffe156', '#6ee7b7', '#5ec8ff', '#8b8cff', '#d58bff', '#ff8fd1'];
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'webm', 'aiff', 'aif', 'caf', 'mp4'];
const MAX_CLIP_SECONDS = 300;
const YOUTUBE_HOME = 'https://www.youtube.com/';

const prefs = loadPrefs();
let sounds = [];
const playing = new Map(); // sound id -> Set<HTMLAudioElement>

// ---------- Preferences (per-machine conveniences) ----------

function loadPrefs() {
  const defaults = { master: 1, noOverlap: false, outputDevice: '', browserOpen: false, view: 'all', tagFilter: [], tagMode: 'any', sort: 'custom', tagsOpen: false };
  try { return { ...defaults, ...JSON.parse(localStorage.getItem('prefs') || '{}') }; } catch { return defaults; }
}
function savePrefs() {
  try { localStorage.setItem('prefs', JSON.stringify(prefs)); } catch { /* ignore */ }
}

// ---------- Toasts ----------

let toastTimer;
function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

// ---------- Playback ----------

function soundUrl(sound) {
  return `sound://local/${encodeURIComponent(sound.file)}`;
}

// Fades an audio element's volume to `to` over `seconds`, then calls `then`.
function rampVolume(audio, to, seconds, then) {
  clearInterval(audio.rampTimer);
  audio.rampTimer = null;
  if (!(seconds > 0)) { audio.volume = Math.max(0, Math.min(1, to)); if (then) then(); return; }
  const from = audio.volume;
  const started = performance.now();
  audio.rampTimer = setInterval(() => {
    const t = Math.min(1, (performance.now() - started) / (seconds * 1000));
    audio.volume = Math.max(0, Math.min(1, from + (to - from) * t));
    if (t >= 1) { clearInterval(audio.rampTimer); audio.rampTimer = null; if (then) then(); }
  }, 40);
}

// Plays a sound. options:
//   fresh: always start another copy (a playlist's next song), never toggle off
//   fadeIn: seconds to fade in over
//   group: what Live Session listeners stop it by (default "s:<id>")
//   nearEnd: { seconds, fn }: calls fn once when that much of it is left
//   onEnded: called when it finishes by itself
// Returns the audio element, or null.
function play(id, options = {}) {
  const sound = sounds.find((s) => s.id === id);
  if (!sound) return null;
  // Full sounds and repeating sounds toggle: pressing again stops them instead of stacking another copy.
  if (!options.fresh && (sound.repeat || isFull(sound)) && playing.has(id)) { stop(id); return null; }
  if (prefs.noOverlap && !options.fresh) stop(id);
  const audio = new Audio(soundUrl(sound));
  audio.group = options.group || `s:${id}`;
  const target = Math.min(1, sound.volume * prefs.master);
  audio.volume = options.fadeIn ? 0 : target;
  if (prefs.outputDevice && audio.setSinkId) audio.setSinkId(prefs.outputDevice).catch(() => {});
  if (sound.repeat && sound.repeat.gap === 0 && !options.fresh) audio.loop = true; // replay immediately
  let set = playing.get(id);
  if (!set) playing.set(id, (set = new Set()));
  set.add(audio);
  const done = () => {
    clearTimeout(audio.repeatTimer);
    clearInterval(audio.rampTimer);
    set.delete(audio);
    if (!set.size && playing.get(id) === set) playing.delete(id);
    updateTile(id);
  };
  audio.addEventListener('ended', () => {
    // Use the latest settings, in case the sound was edited while playing.
    const current = sounds.find((s) => s.id === id);
    if (options.fresh || !current || !current.repeat || !set.has(audio)) {
      const mine = set.has(audio);
      done();
      if (mine && options.onEnded) options.onEnded();
      return;
    }
    const tile = document.querySelector(`.tile[data-id="${id}"]`);
    if (tile) tile.classList.add('waiting');
    audio.repeatTimer = setTimeout(() => {
      if (!set.has(audio)) return;
      if (tile) tile.classList.remove('waiting');
      audio.currentTime = 0;
      audio.play().catch(done);
    }, current.repeat.gap * 1000);
  });
  audio.addEventListener('error', () => {
    if (audio.stopped) return; // clearing the source on stop also fires 'error'
    done();
    toast(`Couldn't play “${sound.name}”.`, true);
    if (options.onEnded) options.onEnded();
  });
  audio.addEventListener('timeupdate', () => {
    updateTile(id, audio);
    const near = options.nearEnd;
    if (near && !audio.nearFired && set.has(audio) && Number.isFinite(audio.duration) && audio.duration - audio.currentTime <= near.seconds) {
      audio.nearFired = true;
      near.fn();
    }
  });
  audio.play().then(() => { if (options.fadeIn) rampVolume(audio, target, options.fadeIn); }).catch(done);
  updateTile(id, audio);
  if (typeof Live !== 'undefined') Live.soundPlayed(sound, { group: audio.group, fadeIn: options.fadeIn || 0 });
  return audio;
}

// Stops one playing copy of a sound, fading it out over `fade` seconds.
function release(id, audio, fade = 0) {
  const set = playing.get(id);
  if (set) { set.delete(audio); if (!set.size) playing.delete(id); }
  audio.stopped = true;
  clearTimeout(audio.repeatTimer);
  const end = () => { audio.pause(); audio.removeAttribute('src'); audio.load(); };
  if (fade > 0) rampVolume(audio, 0, fade, end); else { clearInterval(audio.rampTimer); end(); }
  updateTile(id);
  if (typeof Live !== 'undefined') Live.groupStopped(audio.group, fade);
  // Lets a playlist know its song was stopped from elsewhere.
  if (audio.onRelease) { const fn = audio.onRelease; audio.onRelease = null; fn(); }
}

// Stops every copy of a sound, fading out over `fade` seconds (a scene change).
function stop(id, { fade = 0 } = {}) {
  const set = playing.get(id);
  if (!set) return;
  for (const audio of [...set]) release(id, audio, fade);
}

function stopAll() {
  for (const id of [...playing.keys()]) stop(id);
  if (typeof Live !== 'undefined') Live.stoppedAll();
}

function updateTile(id, audio) {
  const tile = document.querySelector(`[data-sound-id="${id}"]`);
  if (!tile) return;
  const isPlaying = playing.has(id);
  tile.classList.toggle('playing', isPlaying);
  if (!isPlaying) tile.classList.remove('waiting');
  const bar = tile.querySelector('.tile-progress');
  if (!isPlaying) bar.style.width = '0';
  else if (audio && audio.duration) bar.style.width = `${(audio.currentTime / audio.duration) * 100}%`;
  const time = tile.querySelector('.track-time');
  if (time) {
    const sound = sounds.find((s) => s.id === id);
    const total = (audio && Number.isFinite(audio.duration) && audio.duration) || sound?.duration || 0;
    time.textContent = isPlaying && audio
      ? `${AudioUtils.formatTime(audio.currentTime)} / ${AudioUtils.formatTime(total)}`
      : (total ? AudioUtils.formatTime(total) : '');
  }
  const button = tile.querySelector('.track-play');
  if (button) Icons.set(button, isPlaying ? 'stop' : 'play');
}

// ---------- Board rendering ----------

const isFull = (sound) => sound.kind === 'full';

// Applies search, tag filters and sort; returns { clips, full }.
function filteredSounds() {
  const kit = typeof Kits !== 'undefined' ? Kits.activeKit() : null;
  let list = sounds.filter((s) => {
    if (kit) return false; // kits draw their own board
    return matchesFilters(s);
  });
  if (prefs.sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
  if (prefs.sort === 'newest') list = [...list].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  if (prefs.sort === 'longest') list = [...list].sort((a, b) => (b.duration || 0) - (a.duration || 0));
  return { clips: list.filter((s) => !isFull(s)), full: list.filter(isFull) };
}

const UNTAGGED = '__untagged__';

// Search box + tag filters, shared by the library and scene kit boards.
function matchesFilters(s) {
  const search = $('#filter').value.trim().toLowerCase();
  const tags = prefs.tagFilter;
  if (search && !s.name.toLowerCase().includes(search) && !(s.tags || []).some((t) => t.includes(search))) return false;
  if (!tags.length) return true;
  const own = s.tags || [];
  const matches = (tag) => (tag === UNTAGGED ? own.length === 0 : own.includes(tag));
  return prefs.tagMode === 'all' ? tags.every(matches) : tags.some(matches);
}

function render() {
  const view = prefs.view;
  const { clips, full } = filteredSounds();
  const filtering = !!($('#filter').value.trim() || prefs.tagFilter.length);

  // Clips grid
  const grid = $('#grid');
  grid.textContent = '';
  for (const sound of clips) grid.appendChild(makeTile(sound));
  // Full sounds list
  const fullList = $('#full-list');
  fullList.textContent = '';
  for (const sound of full) fullList.appendChild(makeTrack(sound));

  const totalClips = sounds.filter((s) => !isFull(s)).length;
  const totalFull = sounds.length - totalClips;
  const inKit = typeof Kits !== 'undefined' && !!Kits.activeKit();
  // Inside a kit, count only the kit's own sounds.
  $('#clips-count').textContent = inKit ? `${clips.length}` : filtering ? `${clips.length} of ${totalClips}` : `${totalClips}`;
  $('#full-count').textContent = inKit ? `${full.length}` : filtering ? `${full.length} of ${totalFull}` : `${totalFull}`;
  const emptyText = (n, total, what) => (n ? '' : total ? `No ${what} match your filters.` : what === 'clips'
    ? 'No clips yet. Short sound effects you add show up here as tiles.'
    : 'No full sounds yet. Songs and long tracks (a minute or more, or saved with “Save Full Audio”) show up here.');
  $('#clips-empty').textContent = emptyText(clips.length, totalClips, 'clips');
  $('#clips-empty').classList.toggle('hidden', !!clips.length);
  $('#full-empty').textContent = emptyText(full.length, totalFull, 'full sounds');
  $('#full-empty').classList.toggle('hidden', !!full.length);

  // Which blocks the current view shows. A scene kit shows all three, limited to its items.
  const kit = typeof Kits !== 'undefined' ? Kits.activeKit() : null;
  if (kit) {
    for (const id of ['#bashes', '#clips-block', '#full-block', '#empty']) $(id).classList.add('hidden');
  } else {
    $('#bashes').classList.toggle('hidden', !(view === 'all' || view === 'bashes'));
    $('#clips-block').classList.toggle('hidden', !(view === 'all' || view === 'clips') || !sounds.length);
    $('#full-block').classList.toggle('hidden', !(view === 'all' || view === 'full') || !sounds.length);
    $('#empty').classList.toggle('hidden', sounds.length > 0 || view === 'bashes');
  }
  $('#bash-new').classList.toggle('hidden', !!kit);
  if (typeof Kits !== 'undefined') { Kits.renderSidebar(); Kits.renderHeader(); Kits.renderBoard(); }

  for (const btn of document.querySelectorAll('.side-nav .view-btn')) btn.classList.toggle('active', btn.dataset.view === view);
  document.querySelector('[data-count="all"]').textContent = sounds.length;
  document.querySelector('[data-count="clips"]').textContent = totalClips;
  document.querySelector('[data-count="full"]').textContent = totalFull;

  renderTagFilters();
  renderActiveFilters();
  if (typeof Ambience !== 'undefined') Ambience.syncSounds();
  if (typeof Bashes !== 'undefined') Bashes.render();
}

function renderTagFilters() {
  const host = $('#tag-filters');
  host.textContent = '';
  const counts = new Map();
  let untagged = 0;
  for (const s of sounds) {
    if (!(s.tags || []).length) untagged++;
    for (const t of s.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  }
  const all = Tags.list().all;
  const custom = new Set(all.filter((t) => !Tags.list().premade.includes(t)));
  for (const tag of all) {
    const row = document.createElement('div');
    row.className = 'tag-filter' + (prefs.tagFilter.includes(tag) ? ' active' : '') + (counts.get(tag) ? '' : ' unused');
    row.style.setProperty('--chip-color', Tags.color(tag));
    const btn = document.createElement('button');
    btn.className = 'tag-filter-btn';
    btn.innerHTML = '<span class="tag-dot"></span>';
    btn.append(document.createTextNode(tag));
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = counts.get(tag) || '';
    btn.appendChild(count);
    btn.addEventListener('click', () => toggleTagFilter(tag));
    row.appendChild(btn);
    if (custom.has(tag)) {
      const del = document.createElement('button');
      del.className = 'tag-delete';
      Icons.set(del, 'close', '', { size: 11 });
      del.title = `Delete the “${tag}” tag`;
      del.addEventListener('click', async () => {
        if (!confirm(`Delete the tag “${tag}”? It will be removed from ${counts.get(tag) || 0} sound(s). The sounds themselves stay.`)) return;
        await api.tags.remove(tag);
        prefs.tagFilter = prefs.tagFilter.filter((t) => t !== tag);
        savePrefs();
        await refresh();
      });
      row.appendChild(del);
    }
    host.appendChild(row);
  }
  const row = document.createElement('div');
  row.className = 'tag-filter untagged' + (prefs.tagFilter.includes(UNTAGGED) ? ' active' : '');
  const btn = document.createElement('button');
  btn.className = 'tag-filter-btn';
  btn.innerHTML = '<span class="tag-dot"></span>';
  btn.append(document.createTextNode('untagged'));
  const count = document.createElement('span');
  count.className = 'count';
  count.textContent = untagged || '';
  btn.appendChild(count);
  btn.addEventListener('click', () => toggleTagFilter(UNTAGGED));
  row.appendChild(btn);
  host.appendChild(row);
  $('#tag-mode').textContent = prefs.tagMode === 'all' ? 'Match all' : 'Match any';
  // Collapsible: hidden until opened, but always say when filters are on.
  const open = !!prefs.tagsOpen;
  $('#tags-section').classList.toggle('collapsed', !open);
  $('#tags-toggle').setAttribute('aria-expanded', String(open));
  $('#tags-toggle .caret').textContent = open ? '▾' : '▸';
  const active = prefs.tagFilter.length;
  $('#tags-active').textContent = active ? `· ${active} active` : '';
}

function renderActiveFilters() {
  const host = $('#active-filters');
  host.textContent = '';
  const tags = prefs.tagFilter;
  host.classList.toggle('hidden', !tags.length);
  if (!tags.length) return;
  const label = document.createElement('span');
  label.className = 'muted small';
  label.textContent = tags.length > 1 ? `Showing sounds tagged ${prefs.tagMode === 'all' ? 'with all of' : 'with any of'}:` : 'Showing sounds tagged:';
  host.appendChild(label);
  for (const tag of tags) {
    host.appendChild(Tags.chip(tag === UNTAGGED ? 'untagged' : tag, { selected: true, label: `${tag === UNTAGGED ? 'untagged' : tag} ×`, onClick: () => toggleTagFilter(tag), title: 'Remove this filter' }));
  }
  const clear = document.createElement('button');
  clear.className = 'mini';
  clear.textContent = 'Clear';
  clear.addEventListener('click', () => { prefs.tagFilter = []; savePrefs(); render(); });
  host.appendChild(clear);
}

function toggleTagFilter(tag) {
  prefs.tagFilter = prefs.tagFilter.includes(tag) ? prefs.tagFilter.filter((t) => t !== tag) : [...prefs.tagFilter, tag];
  savePrefs();
  render();
}

for (const btn of document.querySelectorAll('.side-nav .view-btn')) {
  btn.addEventListener('click', () => { prefs.view = btn.dataset.view; savePrefs(); render(); });
}
$('#tags-toggle').addEventListener('click', () => { prefs.tagsOpen = !prefs.tagsOpen; savePrefs(); render(); });
$('#tag-mode').addEventListener('click', () => { prefs.tagMode = prefs.tagMode === 'all' ? 'any' : 'all'; savePrefs(); render(); });
$('#sort').value = prefs.sort;
$('#sort').addEventListener('change', (e) => { prefs.sort = e.target.value; savePrefs(); render(); });
$('#new-tag-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#new-tag').value.trim();
  if (!name) return;
  try {
    await api.tags.add(name);
    $('#new-tag').value = '';
    await refresh();
  } catch (err) {
    toast(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true);
  }
});

// Small tag chips shown on tiles and rows.
function tagLine(sound, max) {
  const line = document.createElement('div');
  line.className = 'tag-line';
  const tags = sound.tags || [];
  for (const tag of tags.slice(0, max)) line.appendChild(Tags.chip(tag, { small: true }));
  if (tags.length > max) {
    const more = document.createElement('span');
    more.className = 'muted small';
    more.textContent = `+${tags.length - max}`;
    line.appendChild(more);
  }
  return line;
}

// Full sounds: a row with play button, name, tags, timer and progress.
// onPlay: what clicking it does instead of playing it (a playlist starts from it).
function makeTrack(sound, { reorder = true, onPlay = null } = {}) {
  const go = () => (onPlay ? onPlay() : play(sound.id));
  const row = document.createElement('div');
  row.className = 'track';
  row.dataset.soundId = sound.id;
  row.style.setProperty('--tile-color', sound.color);
  row.tabIndex = 0;

  const playBtn = document.createElement('button');
  playBtn.className = 'track-play';
  Icons.set(playBtn, 'play');
  playBtn.title = 'Play / stop';
  playBtn.addEventListener('click', (e) => { e.stopPropagation(); go(); });

  const info = document.createElement('div');
  info.className = 'track-info';
  const name = document.createElement('div');
  name.className = 'track-name';
  name.textContent = sound.name;
  info.append(name, tagLine(sound, 5));

  const meta = document.createElement('div');
  meta.className = 'track-meta';
  if (sound.gmOnly) meta.appendChild(gmBadge());
  if (sound.repeat) {
    const rep = document.createElement('span');
    rep.className = 'tile-hotkey';
    Icons.set(rep, 'repeat', sound.repeat.gap ? `${sound.repeat.gap}s` : '', { size: 11 });
    meta.appendChild(rep);
  }
  if (sound.hotkey) {
    const key = document.createElement('span');
    key.className = 'tile-hotkey';
    key.textContent = prettyAccelerator(sound.hotkey);
    meta.appendChild(key);
  }
  const time = document.createElement('span');
  time.className = 'track-time mono';
  time.textContent = sound.duration ? AudioUtils.formatTime(sound.duration) : '';
  meta.appendChild(time);

  const edit = document.createElement('button');
  edit.className = 'track-edit';
  Icons.set(edit, 'more');
  edit.title = 'Edit';
  edit.addEventListener('click', (e) => { e.stopPropagation(); openEditor(sound.id); });

  const progress = document.createElement('div');
  progress.className = 'tile-progress';

  row.append(playBtn, info, meta, edit, progress);
  row.addEventListener('click', go);
  row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  row.addEventListener('contextmenu', (e) => { e.preventDefault(); openEditor(sound.id); });
  if (reorder) addReorder(row, sound);
  if (playing.has(sound.id)) {
    row.classList.add('playing');
    Icons.set(playBtn, 'stop');
  }
  return row;
}

// Marks sounds that never play for Live Session listeners.
function gmBadge() {
  const badge = document.createElement('span');
  badge.className = 'tile-hotkey gm-badge';
  badge.textContent = 'Only me';
  badge.title = 'Broadcaster only: not played for Live Session listeners';
  return badge;
}

// Drag a tile or row onto another of the same kind to reorder.
function addReorder(el, sound) {
  el.draggable = true;
  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('application/x-sound-id', sound.id);
    e.dataTransfer.effectAllowed = 'move';
    el.classList.add('dragging');
  });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));
  el.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('application/x-sound-id')) { e.preventDefault(); el.classList.add('drop-target'); }
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
  el.addEventListener('drop', (e) => {
    const draggedId = e.dataTransfer.getData('application/x-sound-id');
    el.classList.remove('drop-target');
    if (!draggedId || draggedId === sound.id) return;
    e.preventDefault();
    e.stopPropagation();
    const ids = sounds.map((s) => s.id).filter((id) => id !== draggedId);
    ids.splice(ids.indexOf(sound.id), 0, draggedId);
    sounds = ids.map((id) => sounds.find((s) => s.id === id));
    api.reorder(ids);
    if (prefs.sort !== 'custom') { prefs.sort = 'custom'; $('#sort').value = 'custom'; savePrefs(); }
    render();
  });
}

function makeTile(sound, { reorder = true } = {}) {
  const tile = document.createElement('div');
  tile.className = 'tile';
  tile.dataset.id = sound.id;
  tile.dataset.soundId = sound.id;
  tile.style.setProperty('--tile-color', sound.color);
  tile.tabIndex = 0;
  tile.title = 'Click to play · right-click to edit';

  const name = document.createElement('div');
  name.className = 'tile-name';
  name.textContent = sound.name;
  tile.appendChild(name);
  if ((sound.tags || []).length) tile.appendChild(tagLine(sound, 2));

  if (sound.hotkey || sound.repeat || sound.gmOnly) {
    const badges = document.createElement('div');
    badges.className = 'tile-badges';
    if (sound.gmOnly) badges.appendChild(gmBadge());
    if (sound.repeat) {
      const rep = document.createElement('span');
      rep.className = 'tile-hotkey';
      Icons.set(rep, 'repeat', sound.repeat.gap ? `${sound.repeat.gap}s` : '', { size: 11 });
      rep.title = sound.repeat.gap ? `Repeats ${sound.repeat.gap}s after it ends` : 'Repeats until stopped';
      badges.appendChild(rep);
    }
    if (sound.hotkey) {
      const key = document.createElement('span');
      key.className = 'tile-hotkey';
      key.textContent = prettyAccelerator(sound.hotkey);
      badges.appendChild(key);
    }
    tile.appendChild(badges);
  }
  if (sound.repeat) tile.title = 'Click to start repeating · click again to stop · right-click to edit';

  const edit = document.createElement('button');
  edit.className = 'tile-edit';
  Icons.set(edit, 'more');
  edit.title = 'Edit';
  edit.addEventListener('click', (e) => { e.stopPropagation(); openEditor(sound.id); });
  tile.appendChild(edit);

  // Visible only while this sound is playing (or waiting to repeat).
  const stopBtn = document.createElement('button');
  stopBtn.className = 'tile-stop';
  Icons.set(stopBtn, 'stop', 'Stop', { size: 12 });
  stopBtn.title = 'Stop this sound';
  stopBtn.addEventListener('click', (e) => { e.stopPropagation(); stop(sound.id); });
  tile.appendChild(stopBtn);

  const progress = document.createElement('div');
  progress.className = 'tile-progress';
  tile.appendChild(progress);

  tile.addEventListener('click', (e) => (e.altKey ? stop(sound.id) : play(sound.id)));
  tile.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(sound.id); } });
  tile.addEventListener('contextmenu', (e) => { e.preventDefault(); openEditor(sound.id); });

  if (reorder) addReorder(tile, sound);

  if (playing.has(sound.id)) tile.classList.add('playing');
  return tile;
}

let soundsLoaded = false;

async function refresh() {
  [sounds] = await Promise.all([api.list(), Tags.load()]);
  if (typeof Kits !== 'undefined') await Kits.load();
  soundsLoaded = true;
  render();
  measureMissingDurations();
}

// Older sounds (and ones added elsewhere) may not know their length yet.
let measuring = false;
async function measureMissingDurations() {
  if (measuring) return;
  measuring = true;
  try {
    let changed = false;
    for (const sound of sounds.filter((s) => !s.duration)) {
      const duration = await Tags.probeDuration(sound);
      if (!duration) continue;
      const result = await api.update(sound.id, { duration });
      sounds = result.sounds;
      changed = true;
    }
    if (changed) render();
  } finally {
    measuring = false;
  }
}

// After adding sounds: ask for tags and the type, then show them.
async function afterAdding(added) {
  if (!added.length) return;
  await refresh();
  await Tags.askForNewSounds(added);
  await refresh();
  toast(`Added ${added.length} sound${added.length > 1 ? 's' : ''}.`);
}

// ---------- Adding sounds ----------

$('#add-btn').addEventListener('click', async () => {
  const added = await api.importDialog();
  await afterAdding(added);
});

let dragDepth = 0;
const board = $('#board');
board.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer.types.includes('Files')) return;
  dragDepth++;
  $('#drop-overlay').classList.remove('hidden');
});
board.addEventListener('dragleave', (e) => {
  if (!e.dataTransfer.types.includes('Files')) return;
  if (--dragDepth <= 0) { dragDepth = 0; $('#drop-overlay').classList.add('hidden'); }
});
board.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
board.addEventListener('drop', async (e) => {
  if (!e.dataTransfer.files.length) return;
  e.preventDefault();
  dragDepth = 0;
  $('#drop-overlay').classList.add('hidden');
  const added = [];
  for (const file of e.dataTransfer.files) {
    const dot = file.name.lastIndexOf('.');
    const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : '';
    if (!AUDIO_EXTENSIONS.includes(ext)) { toast(`Skipped ${file.name} (not an audio file).`, true); continue; }
    added.push(await api.add({ name: file.name.slice(0, dot), data: await file.arrayBuffer(), ext }));
  }
  await afterAdding(added);
});

// ---------- Controls ----------

$('#filter').addEventListener('input', render);
$('#stop-all').addEventListener('click', stopAll);

const master = $('#master-volume');
master.value = prefs.master;
master.addEventListener('input', () => {
  prefs.master = Number(master.value);
  savePrefs();
  for (const [id, set] of playing) {
    const sound = sounds.find((s) => s.id === id);
    const level = Math.min(1, (sound ? sound.volume : 1) * prefs.master);
    for (const audio of set) {
      if (audio.rampTimer) continue; // fading in or out: it ends where it was going
      audio.volume = level;
      if (typeof Live !== 'undefined') Live.groupVolume(audio.group, level);
    }
  }
});

const noOverlap = $('#no-overlap');
noOverlap.checked = prefs.noOverlap;
noOverlap.addEventListener('change', () => { prefs.noOverlap = noOverlap.checked; savePrefs(); });

async function loadOutputDevices() {
  const select = $('#output-device');
  let devices = [];
  try { devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput'); } catch { /* ignore */ }
  select.length = 1;
  devices.filter((d) => d.deviceId !== 'default').forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = d.label || `Output ${i + 1}`;
    select.appendChild(opt);
  });
  select.value = [...select.options].some((o) => o.value === prefs.outputDevice) ? prefs.outputDevice : '';
}
$('#output-device').addEventListener('change', (e) => {
  prefs.outputDevice = e.target.value;
  savePrefs();
  Ambience.setOutputDevice(prefs.outputDevice);
});
navigator.mediaDevices?.addEventListener?.('devicechange', loadOutputDevices);

document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName);
  if (e.key === 'Escape' && !typing && !$('#edit-dialog').open) stopAll();
  if ((e.metaKey || e.ctrlKey) && e.key === 'f') { e.preventDefault(); $('#filter').focus(); }
});

api.onHotkey(play);

// ---------- Edit dialog ----------

const dialog = $('#edit-dialog');
let editingId = null;
let editColor = null;
let editHotkey = null;
let editKind = null;
let editTags = null;

function openEditor(id) {
  const sound = sounds.find((s) => s.id === id);
  if (!sound) return;
  editingId = id;
  editColor = sound.color;
  editHotkey = sound.hotkey;
  $('#edit-name').value = sound.name;
  $('#edit-volume').value = sound.volume;
  $('#edit-hotkey').value = editHotkey ? prettyAccelerator(editHotkey) : '';
  editKind = Tags.kindToggle(sound.kind || (sound.duration >= 60 ? 'full' : 'clip'));
  $('#edit-kind').replaceChildren(editKind.element);
  editTags = Tags.picker(sound.tags || []);
  $('#edit-tags').replaceChildren(editTags.element);
  $('#edit-repeat').checked = !!sound.repeat;
  $('#edit-repeat-gap').value = sound.repeat ? sound.repeat.gap : 0;
  $('#edit-repeat-gap').disabled = !sound.repeat;
  $('#edit-gm-only').checked = !!sound.gmOnly;
  $('#edit-buzz').checked = !!sound.buzz;
  const swatches = $('#edit-colors');
  swatches.textContent = '';
  for (const color of COLORS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch' + (color === editColor ? ' selected' : '');
    b.style.background = color;
    b.addEventListener('click', () => {
      editColor = color;
      swatches.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('selected', s === b));
    });
    swatches.appendChild(b);
  }
  const src = sound.source;
  $('#edit-source').textContent = !src || !src.title ? ''
    : src.full ? `Full audio of “${src.title}”`
    : `Clipped from “${src.title}” (${AudioUtils.formatTime(src.start)}–${AudioUtils.formatTime(src.end)})`;
  dialog.showModal();
}

dialog.addEventListener('close', async () => {
  if (dialog.returnValue !== 'save' || !editingId) return;
  const result = await api.update(editingId, {
    name: $('#edit-name').value,
    color: editColor,
    volume: Number($('#edit-volume').value),
    hotkey: editHotkey,
    repeat: $('#edit-repeat').checked ? { gap: Math.max(0, Number($('#edit-repeat-gap').value) || 0) } : null,
    kind: editKind.value(),
    tags: editTags.selected(),
    gmOnly: $('#edit-gm-only').checked,
    buzz: $('#edit-buzz').checked,
  });
  await Tags.load();
  sounds = result.sounds;
  render();
  if (result.failedHotkeys.length) toast(`Hotkey ${result.failedHotkeys.map(prettyAccelerator).join(', ')} is already used by another app.`, true);
});

$('#edit-delete').addEventListener('click', async () => {
  const sound = sounds.find((s) => s.id === editingId);
  if (!sound || !confirm(`Delete “${sound.name}”? This can't be undone.`)) return;
  stop(editingId);
  await api.remove(editingId);
  dialog.close('deleted');
  await refresh();
});

$('#edit-reveal').addEventListener('click', () => api.reveal(editingId));
$('#edit-ambience').addEventListener('click', () => {
  Ambience.addSoundLayer(editingId);
  dialog.close('ambience');
});
$('#edit-repeat').addEventListener('change', (e) => { $('#edit-repeat-gap').disabled = !e.target.checked; });
$('#clear-hotkey').addEventListener('click', () => { editHotkey = null; $('#edit-hotkey').value = ''; });

$('#edit-hotkey').addEventListener('keydown', (e) => {
  if (e.key === 'Tab') return;
  e.preventDefault();
  if (e.key === 'Escape') { e.stopPropagation(); $('#edit-hotkey').blur(); return; }
  if (e.key === 'Backspace' || e.key === 'Delete') { editHotkey = null; e.target.value = ''; return; }
  const accel = acceleratorFromEvent(e);
  if (accel === undefined) return; // just a modifier so far
  if (accel === null) { toast('Hotkeys need at least one of ⌘ ⌥ ⌃ (or use an F-key).', true); return; }
  editHotkey = accel;
  e.target.value = prettyAccelerator(accel);
});

// Builds an Electron accelerator string. Returns undefined for a lone
// modifier, null when the combo would hijack normal typing.
function acceleratorFromEvent(e) {
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return undefined;
  let key = null;
  const code = e.code;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit\d$/.test(code)) key = code.slice(5);
  else if (/^Numpad\d$/.test(code)) key = 'num' + code.slice(6);
  else if (/^F\d{1,2}$/.test(code)) key = code;
  else {
    key = {
      Space: 'Space', Enter: 'Enter', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
      Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'",
      Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Backquote: '`', Home: 'Home', End: 'End',
      PageUp: 'PageUp', PageDown: 'PageDown',
    }[code] || null;
  }
  if (!key) return undefined;
  const mods = [];
  if (e.metaKey) mods.push('Command');
  if (e.ctrlKey) mods.push('Control');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  const isFKey = /^F\d{1,2}$/.test(key);
  if (!isFKey && !mods.some((m) => m !== 'Shift')) return null;
  return [...mods, key].join('+');
}

function prettyAccelerator(accel) {
  const symbols = { Command: '⌘', Control: '⌃', Alt: '⌥', Shift: '⇧', Up: '↑', Down: '↓', Left: '←', Right: '→', Space: '␣', Enter: '↩' };
  return accel.split('+').map((p) => symbols[p] || p.replace(/^num/, 'Num')).join('');
}

// ---------- YouTube browser & clipper ----------

let webview = null;

let ytReady = false;
let ytState = { hasVideo: false };
let capturing = false;
let stateTimer = null;

function setBrowserOpen(open) {
  prefs.browserOpen = open;
  savePrefs();
  $('#browser').classList.toggle('hidden', !open);
  $('#toggle-yt').classList.toggle('active', open);
  if (open && !webview) createWebview();
  clearInterval(stateTimer);
  if (open) stateTimer = setInterval(pollState, 200);
}

function createWebview() {
  webview = document.createElement('webview');
  webview.setAttribute('partition', 'persist:youtube');
  webview.setAttribute('src', YOUTUBE_HOME);
  webview.setAttribute('allowpopups', '');
  $('#webview-host').appendChild(webview);
  webview.addEventListener('dom-ready', () => { ytReady = true; });
  webview.addEventListener('did-start-navigation', (e) => { if (e.isMainFrame) ytReady = false; });
  webview.addEventListener('did-navigate-in-page', () => { ytReady = true; });
  webview.addEventListener('ipc-message', onWebviewMessage);
}

function pollState() {
  if (webview && ytReady && !capturing) {
    try { webview.send('yt:state', 0); } catch { /* not attached yet */ }
  }
}

function onWebviewMessage(e) {
  const [first, second] = e.args;
  switch (e.channel) {
    case 'yt:state':
      ytState = second;
      $('#clip-now').textContent = ytState.hasVideo ? AudioUtils.formatTime(ytState.currentTime) : '–:––';
      break;
    case 'yt:progress': {
      const pct = ((first.current - first.start) / (first.end - first.start)) * 100;
      $('#clip-progress').style.width = `${Math.max(0, Math.min(100, pct))}%`;
      $('#clip-now').textContent = AudioUtils.formatTime(first.current);
      break;
    }
    case 'yt:captured':
      finishCapture(first).catch((err) => captureFailed(err.message || String(err)));
      break;
    case 'yt:error':
      captureFailed(first);
      break;
  }
}

$('#toggle-yt').addEventListener('click', () => setBrowserOpen($('#browser').classList.contains('hidden')));
$('#yt-back').addEventListener('click', () => webview?.canGoBack() && webview.goBack());
$('#yt-forward').addEventListener('click', () => webview?.canGoForward() && webview.goForward());
$('#yt-home').addEventListener('click', () => webview?.loadURL(YOUTUBE_HOME));

$('#yt-search').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#yt-query').value.trim();
  if (!q || !webview) return;
  const isLink = /^(https?:\/\/)?((www|m|music)\.)?(youtube\.com|youtu\.be)\//i.test(q);
  const url = isLink
    ? (q.startsWith('http') ? q : `https://${q}`)
    : `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
  webview.loadURL(url);
});

function readRange() {
  const start = AudioUtils.parseTime($('#clip-start').value);
  const end = AudioUtils.parseTime($('#clip-end').value);
  return { start, end };
}

function updateClipLength() {
  const { start, end } = readRange();
  const valid = Number.isFinite(start) && Number.isFinite(end) && end > start;
  $('#clip-len').textContent = valid ? `${(end - start).toFixed(1)}s` : 'invalid range';
  $('#clip-len').classList.toggle('error-text', !valid);
}

function setMark(which) {
  if (!ytState.hasVideo) { toast('Open and play a YouTube video first.', true); return; }
  const input = $(which === 'start' ? '#clip-start' : '#clip-end');
  input.value = AudioUtils.formatTime(ytState.currentTime);
  if (which === 'start') {
    const { start, end } = readRange();
    if (!(end > start)) $('#clip-end').value = AudioUtils.formatTime(start + 3);
  }
  updateClipLength();
}

$('#set-start').addEventListener('click', () => setMark('start'));
$('#set-end').addEventListener('click', () => setMark('end'));
$('#clip-start').addEventListener('input', updateClipLength);
$('#clip-end').addEventListener('input', updateClipLength);

$('#preview-clip').addEventListener('click', () => {
  const { start, end } = readRange();
  if (!webview || !ytState.hasVideo || !(end > start)) return;
  webview.send('yt:preview', { start, end });
});

$('#capture-clip').addEventListener('click', () => {
  const { start, end } = readRange();
  if (!webview || !ytState.hasVideo) { toast('Open a YouTube video first.', true); return; }
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) { toast('Set a valid start and end time.', true); return; }
  if (end - start > MAX_CLIP_SECONDS) { toast(`Clips can be at most ${MAX_CLIP_SECONDS / 60} minutes long.`, true); return; }
  if (ytState.duration && start >= ytState.duration) { toast('The start time is past the end of the video.', true); return; }
  capturing = true;
  setCaptureUi(true, `Recording ${AudioUtils.formatTime(start)} → ${AudioUtils.formatTime(end)}… (plays in real time)`);
  webview.send('yt:capture', { start, end });
});

$('#cancel-capture').addEventListener('click', () => webview?.send('yt:cancel'));

function setCaptureUi(active, status) {
  $('#capture-clip').disabled = active;
  $('#preview-clip').disabled = active;
  $('#set-start').disabled = active;
  $('#set-end').disabled = active;
  $('#save-full').disabled = active;
  $('#cancel-capture').classList.toggle('hidden', !active);
  $('#clip-status').textContent = status;
  $('#clip-status').classList.remove('error-text');
  if (!active) $('#clip-progress').style.width = '0';
}

function captureFailed(message) {
  capturing = false;
  setCaptureUi(false, message);
  $('#clip-status').classList.add('error-text');
}

async function finishCapture({ data, trimStart, trimEnd, title, url }) {
  $('#clip-status').textContent = 'Processing…';
  const ctx = new AudioContext();
  let decoded;
  try {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    decoded = await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  } finally {
    ctx.close();
  }
  const channels = [];
  for (let c = 0; c < decoded.numberOfChannels; c++) channels.push(decoded.getChannelData(c));
  const trimmed = AudioUtils.trimChannels(channels, decoded.sampleRate, trimStart, trimEnd);
  if (!trimmed[0].length) throw new Error('The captured clip was empty.');
  const wav = AudioUtils.encodeWav(trimmed, decoded.sampleRate);

  const { start, end } = readRange();
  const name = $('#clip-name').value.trim() || title || 'YouTube clip';
  const seconds = trimmed[0].length / decoded.sampleRate;
  const sound = await api.add({ name, data: wav, ext: 'wav', source: { title, url, start, end }, kind: 'clip', duration: seconds });
  capturing = false;
  setCaptureUi(false, `Saved “${sound.name}” (${seconds.toFixed(1)}s).`);
  $('#clip-name').value = '';
  await afterAdding([sound]);
  const tile = document.querySelector(`[data-sound-id="${sound.id}"]`);
  if (tile) { tile.scrollIntoView({ block: 'nearest' }); tile.classList.add('new'); }
}

// ---------- Full audio download ----------

let downloadJob = null;

$('#save-full').addEventListener('click', async () => {
  if (downloadJob) {
    api.cancelDownload(downloadJob);
    return;
  }
  if (!ytState.hasVideo || !ytState.url) { toast('Open a YouTube video first.', true); return; }
  const jobId = `dl-${Date.now()}`;
  downloadJob = jobId;
  setDownloadUi(true, 'Starting download…');
  try {
    const sound = await api.downloadAudio(jobId, ytState.url);
    setDownloadUi(false, `Saved full audio “${sound.name}”.`);
    downloadJob = null;
    await afterAdding([sound]);
  } catch (err) {
    setDownloadUi(false, String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true);
  } finally {
    downloadJob = null;
  }
});

api.onDownloadProgress((jobId, progress) => {
  if (jobId !== downloadJob) return;
  const pct = Number.isFinite(progress.percent) ? ` ${progress.percent.toFixed(0)}%` : '';
  $('#clip-status').textContent = `${progress.message}${pct}`;
  if (Number.isFinite(progress.percent)) $('#clip-progress').style.width = `${progress.percent}%`;
});

function setDownloadUi(active, status, isError = false) {
  if (active) $('#save-full').textContent = 'Cancel Download';
  else Icons.set($('#save-full'), 'download', 'Save Full Audio');
  $('#capture-clip').disabled = active;
  $('#clip-status').textContent = status;
  $('#clip-status').classList.toggle('error-text', isError);
  if (!active) $('#clip-progress').style.width = '0';
}

// ---------- Startup ----------

updateClipLength();
setBrowserOpen(prefs.browserOpen);
loadOutputDevices();
// Wait for every script (tags, kits, bashes…) to load before the first render.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh, { once: true });
else refresh();
