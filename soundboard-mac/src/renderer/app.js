/* global AudioUtils, Tags, Kits, Fx */
const api = window.soundboard;
const $ = (sel) => document.querySelector(sel);

const COLORS = ['#ff5d73', '#ffb347', '#ffe156', '#6ee7b7', '#5ec8ff', '#8b8cff', '#d58bff', '#ff8fd1'];
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'webm', 'aiff', 'aif', 'caf', 'mp4'];
const MAX_CLIP_SECONDS = 300;
const YOUTUBE_HOME = 'https://www.youtube.com/';

const prefs = loadPrefs();
if (prefs.outputDevice) Fx.setOutputDevice(prefs.outputDevice);
let sounds = [];
const playing = new Map(); // sound id -> Set<HTMLAudioElement>

// ---------- Preferences (per-machine conveniences) ----------

function loadPrefs() {
  const defaults = { master: 1, noOverlap: false, outputDevice: '', browserOpen: false, view: 'all', tagFilter: [], tagMode: 'any', sort: 'custom', tagsOpen: false, sidebarHidden: false };
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
  return soundFileUrl('local', sound.file);
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
//   gain: extra level from where it was played (a scene kit section's volume slider)
//   seek: seconds in to start from (a bookmark brings a song back where it was)
//   fx: a sound effect to play it through (fx.js: 'distant', 'echo', …), or a
//       function giving one, asked only if the sound really starts (a kit's
//       armed effect is used up by the sound it goes on)
// Returns the audio element, or null.
function play(id, options = {}) {
  const sound = sounds.find((s) => s.id === id);
  if (!sound) return null;
  // Full sounds and repeating sounds toggle: pressing again stops them instead of stacking another copy.
  if (!options.fresh && (sound.repeat || isFull(sound)) && playing.has(id)) { stop(id); return null; }
  if (prefs.noOverlap && !options.fresh) stop(id);
  const audio = new Audio();
  const wanted = typeof options.fx === 'function' ? options.fx() : options.fx;
  const fx = typeof Fx !== 'undefined' && Fx.prepare(audio, wanted) ? wanted : null;
  audio.src = soundUrl(sound);
  if (fx) Fx.attach(audio, fx);
  audio.group = options.group || `s:${id}`;
  audio.gain = options.gain ?? 1;
  const target = Math.min(1, sound.volume * audio.gain * prefs.master);
  audio.volume = options.fadeIn ? 0 : target;
  if (prefs.outputDevice && audio.setSinkId) audio.setSinkId(prefs.outputDevice).catch(() => {});
  if (sound.repeat && sound.repeat.gap === 0 && !options.fresh) audio.loop = true; // replay immediately
  if (options.seek > 0) audio.currentTime = options.seek;
  let set = playing.get(id);
  if (!set) playing.set(id, (set = new Set()));
  set.add(audio);
  const done = () => {
    clearTimeout(audio.repeatTimer);
    clearInterval(audio.rampTimer);
    if (fx) Fx.release(audio);
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
  if (typeof Live !== 'undefined') Live.soundPlayed(sound, { group: audio.group, fadeIn: options.fadeIn || 0, gain: audio.gain, seek: options.seek || 0, fx });
  return audio;
}

// A playing sound's level changed: its own volume (the slider on a playing
// song) or a scene kit section's volume slider (gain, for these ids).
function setPlayingVolume(id, volume) {
  const sound = sounds.find((s) => s.id === id);
  if (!sound) return;
  sound.volume = Math.max(0, Math.min(1, volume));
  for (const audio of playing.get(id) || []) {
    if (audio.rampTimer) continue;
    audio.volume = Math.min(1, sound.volume * (audio.gain ?? 1) * prefs.master);
    if (typeof Live !== 'undefined') Live.groupVolume(audio.group, audio.volume);
  }
}

function setPlayingGain(ids, gain) {
  for (const id of ids) {
    const sound = sounds.find((s) => s.id === id);
    for (const audio of playing.get(id) || []) {
      audio.gain = gain;
      if (audio.rampTimer) continue;
      audio.volume = Math.min(1, (sound ? sound.volume : 1) * gain * prefs.master);
      if (typeof Live !== 'undefined') Live.groupVolume(audio.group, audio.volume);
    }
  }
}

// Stops one playing copy of a sound, fading it out over `fade` seconds.
function release(id, audio, fade = 0) {
  const set = playing.get(id);
  if (set) { set.delete(audio); if (!set.size) playing.delete(id); }
  audio.stopped = true;
  clearTimeout(audio.repeatTimer);
  const end = () => {
    audio.pause(); audio.removeAttribute('src'); audio.load();
    if (typeof Fx !== 'undefined') Fx.release(audio);
  };
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
  // The "Find a tag" box narrows the list (the active filters always stay in it).
  const query = $('#tag-search').value.trim().toLowerCase();
  const matches = (tag) => !query || tag.toLowerCase().includes(query) || prefs.tagFilter.includes(tag);
  for (const tag of all.filter(matches)) {
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
  if (matches('untagged') || prefs.tagFilter.includes(UNTAGGED)) host.appendChild(row);
  if (!host.children.length) {
    const none = document.createElement('p');
    none.className = 'muted small tag-none';
    none.textContent = `No tags match “${query}”.`;
    host.appendChild(none);
  }
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
$('#tag-search').addEventListener('input', renderTagFilters);
$('#tag-search').addEventListener('keydown', (e) => {
  // Enter turns on the first match.
  if (e.key !== 'Enter') return;
  e.preventDefault();
  $('#tag-filters .tag-filter:not(.active) .tag-filter-btn')?.click();
});
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

// Small tag chips shown on tiles and rows: as many as fit on one line, then
// "+N" for the rest (fitTagLine, re-run whenever the line changes size).
function tagLine(sound) {
  const line = document.createElement('div');
  line.className = 'tag-line';
  for (const tag of sound.tags || []) line.appendChild(Tags.chip(tag, { small: true }));
  const more = document.createElement('span');
  more.className = 'tag-more muted small';
  more.hidden = true;
  line.appendChild(more);
  fitObserver.observe(line);
  return line;
}

function fitTagLine(line) {
  const chips = [...line.querySelectorAll('.chip')];
  const more = line.querySelector('.tag-more');
  if (!chips.length || !more) return;
  for (const chip of chips) chip.hidden = false;
  more.hidden = true;
  const top = chips[0].offsetTop;
  if (!chips.some((chip) => chip.offsetTop > top)) return;
  // Hide the ones that wrapped, then make room for the "+N".
  let shown = chips.filter((chip) => chip.offsetTop === top);
  for (const chip of chips) chip.hidden = !shown.includes(chip);
  more.hidden = false;
  const label = () => { more.textContent = `+${chips.length - shown.length}`; };
  label();
  while (shown.length > 1 && more.offsetTop > top) {
    shown.pop().hidden = true;
    label();
  }
}

// A tile: if its name and tags don't both fit, the name drops to one line,
// and then the tags step aside, rather than overlapping.
function fitTile(tile) {
  const name = tile.querySelector(':scope > .tile-name');
  if (!name) return;
  const line = tile.querySelector(':scope > .tag-line');
  name.style.webkitLineClamp = '';
  if (line) { line.hidden = false; fitTagLine(line); }
  const room = tile.clientHeight - parseFloat(getComputedStyle(tile).paddingBottom || '0');
  const over = () => {
    let bottom = 0;
    for (const child of tile.children) {
      if (child.hidden || getComputedStyle(child).position === 'absolute') continue;
      bottom = Math.max(bottom, child.offsetTop + child.offsetHeight);
    }
    return bottom > room + 1;
  };
  if (over()) name.style.webkitLineClamp = '1';
  if (over() && line) line.hidden = true;
}

const fitObserver = new ResizeObserver((entries) => {
  for (const { target } of entries) {
    if (target.classList.contains('tile')) fitTile(target);
    else if (target.closest('.tile')) continue; // its tile fits it
    else fitTagLine(target);
  }
});

// Full sounds: a row with play button, name, tags, timer and progress.
// onPlay: what clicking it does instead of playing it (a playlist starts from it).
// gain: a scene kit section's volume slider.
// fx: a scene kit's armed sound effect (a function, see play()).
function makeTrack(sound, { reorder = true, onPlay = null, gain = 1, fx = null } = {}) {
  const go = () => (onPlay ? onPlay() : play(sound.id, { gain, fx }));
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
  info.append(name, tagLine(sound));

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

  // Its volume, like an ambience layer's, while it plays. The level is kept for next time.
  const volume = document.createElement('div');
  volume.className = 'track-volume';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = 0;
  slider.max = 1;
  slider.step = 0.01;
  slider.value = sound.volume ?? 1;
  slider.title = `${sound.name} volume`;
  slider.setAttribute('aria-label', `${sound.name} volume`);
  for (const type of ['click', 'pointerdown', 'keydown']) slider.addEventListener(type, (e) => e.stopPropagation());
  slider.addEventListener('input', () => setPlayingVolume(sound.id, Number(slider.value)));
  slider.addEventListener('change', () => api.update(sound.id, { volume: Number(slider.value) }).catch(() => {}));
  volume.append(Icons.el('speaker', { size: 12 }), slider);

  row.append(playBtn, info, meta, edit, volume, progress);
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

// gain: a scene kit section's volume slider.
function makeTile(sound, { reorder = true, gain = 1, fx = null } = {}) {
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
  if ((sound.tags || []).length) tile.appendChild(tagLine(sound));
  fitObserver.observe(tile);

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

  tile.addEventListener('click', (e) => (e.altKey ? stop(sound.id) : play(sound.id, { gain, fx })));
  tile.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(sound.id, { gain, fx }); } });
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

// ---- The Add menu: files, Record and YouTube under the + button ----
const addMenu = $('#add-menu');
const addMenuBtn = $('#add-menu-btn');
const addMenuItems = () => [...addMenu.querySelectorAll('button')].filter((b) => !b.classList.contains('hidden') && getComputedStyle(b).display !== 'none');
function closeAddMenu() {
  addMenu.classList.add('hidden');
  addMenuBtn.setAttribute('aria-expanded', 'false');
}
function openAddMenu(fromKeyboard) {
  addMenu.classList.remove('hidden');
  addMenuBtn.setAttribute('aria-expanded', 'true');
  const rect = addMenuBtn.getBoundingClientRect();
  const width = addMenu.offsetWidth;
  addMenu.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width))}px`;
  addMenu.style.top = `${rect.bottom + 4}px`;
  if (fromKeyboard) addMenuItems()[0]?.focus();
}
// While broadcasting, files and Record step aside; with nothing left, so does the button.
window.syncAddMenu = () => addMenuBtn.classList.toggle('hidden', !addMenuItems().length);
addMenuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  // detail is 0 for a click made with the keyboard (Enter or Space).
  if (addMenu.classList.contains('hidden')) openAddMenu(e.detail === 0); else closeAddMenu();
});
addMenu.addEventListener('click', closeAddMenu); // after the item's own action
document.addEventListener('click', (e) => { if (!addMenu.contains(e.target)) closeAddMenu(); });
addMenu.addEventListener('keydown', (e) => {
  const items = addMenuItems();
  const at = items.indexOf(document.activeElement);
  if (e.key === 'Escape') { e.stopPropagation(); closeAddMenu(); addMenuBtn.focus(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); items[(at + 1) % items.length]?.focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); items[(at - 1 + items.length) % items.length]?.focus(); }
});
window.addEventListener('resize', closeAddMenu);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !addMenu.classList.contains('hidden')) { e.stopImmediatePropagation(); closeAddMenu(); }
}, true);

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
    for (const audio of set) {
      if (audio.rampTimer) continue; // fading in or out: it ends where it was going
      const level = Math.min(1, (sound ? sound.volume : 1) * (audio.gain ?? 1) * prefs.master);
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
  Fx.setOutputDevice(prefs.outputDevice);
});
navigator.mediaDevices?.addEventListener?.('devicechange', loadOutputDevices);

document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName);
  if (e.key === 'Escape' && !typing && !$('#edit-dialog').open) stopAll();
  if ((e.metaKey || e.ctrlKey) && e.key === 'f') { e.preventDefault(); $('#filter').focus(); }
});

api.onHotkey(play);

// The top bar's buttons show only their icons when there isn't room for their
// names (a small window, or the extra buttons a Live Session adds). Each keeps
// its name as a tooltip.
(() => {
  const bar = $('.titlebar');
  for (const button of bar.querySelectorAll('button')) {
    if (!button.title) button.title = button.textContent.trim();
    const label = button.querySelector('span[id$="-label"]');
    if (label) { label.classList.add('bar-label'); continue; }
    for (const node of [...button.childNodes]) {
      if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
      const span = document.createElement('span');
      span.className = 'bar-label';
      span.textContent = node.textContent.trim();
      node.replaceWith(span);
    }
    button.setAttribute('aria-label', button.querySelector('.bar-label')?.textContent || button.title);
  }
  // Too many to fit on one row: icons only (and if even those don't fit, a second row).
  const wraps = () => {
    const shown = [...bar.children].filter((c) => c.offsetParent !== null);
    return shown.some((c) => c.offsetTop > shown[0].offsetTop + 4);
  };
  const fit = () => {
    bar.classList.remove('compact');
    if (wraps()) bar.classList.add('compact');
  };
  new ResizeObserver(fit).observe(bar);
  new MutationObserver((changes) => { if (changes.some((c) => c.target !== bar)) fit(); })
    .observe(bar, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
})();

// ---------- Hiding the sidebar (Mac) ----------
// The master volume slider moves to the top bar while the sidebar is hidden.
// (On Android the sidebar is a drawer, opened from the top bar's menu button.)

function applySidebar() {
  const hidden = !!prefs.sidebarHidden && !document.documentElement.classList.contains('android');
  $('#app').classList.toggle('sidebar-hidden', hidden);
  (hidden ? $('#top-volume') : $('#master-volume-home')).appendChild($('#master-volume'));
  $('#top-volume').classList.toggle('hidden', !hidden);
  const button = $('#sidebar-toggle');
  const label = hidden ? 'Show the sidebar' : 'Hide the sidebar';
  button.title = `${label} (⌘\\)`;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', String(hidden));
}
$('#sidebar-toggle').addEventListener('click', () => {
  prefs.sidebarHidden = !prefs.sidebarHidden;
  savePrefs();
  applySidebar();
});
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === '\\') { e.preventDefault(); $('#sidebar-toggle').click(); }
});
applySidebar();

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
  document.body.classList.toggle('browser-open', open);
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
