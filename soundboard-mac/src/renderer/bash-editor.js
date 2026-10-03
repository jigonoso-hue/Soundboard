/* global AudioUtils, BashCommon */
// Bash editor window: arrange when each sound starts and layer them on a timeline.
const api = window.soundboard;
const $ = (sel) => document.querySelector(sel);
const bashId = new URLSearchParams(location.search).get('id');

const LANE_HEIGHT = 58;
const RULER_HEIGHT = 26;
const PEAKS_PER_SECOND = 100;

const player = new BashCommon.BashPlayer(api);
let bash = null;
let sounds = [];
let pps = 80; // pixels per second
let selectedId = null;
let cursor = 0; // playhead position when stopped (seconds)
let dragging = null;
const info = new Map(); // soundId -> { duration, peaks }

// ---------- Helpers ----------

const soundOf = (clip) => sounds.find((s) => s.id === clip.soundId);
const clipDuration = (clip) => info.get(clip.soundId)?.duration ?? 2;
// Bash time when the clip's last play ends (Infinity = repeats until stopped).
const clipEnd = (clip) => BashCommon.clipEnd(clip, clipDuration(clip));
const totalDuration = () => bash.clips.reduce((end, c) => Math.max(end, clipEnd(c)), 0);
// Length to lay out on the timeline: endless repeats show a few plays.
const layoutEnd = (clip) => {
  const end = clipEnd(clip);
  if (Number.isFinite(end)) return end;
  const period = clipDuration(clip) + clip.repeat.gap;
  return clip.offset + Math.max(period * 4, 20);
};
const layoutDuration = () => bash.clips.reduce((end, c) => Math.max(end, layoutEnd(c)), 0);
const laneCount = () => Math.max(3, bash.clips.reduce((max, c) => Math.max(max, c.lane + 1), 0) + 1);
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

let toastTimer;
function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}

let saveTimer;
function scheduleSave(extra = {}) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      // Don't adopt the response: the user may have kept editing meanwhile.
      await api.bashes.update(bashId, { name: bash.name, clips: bash.clips, ...extra });
    } catch (err) {
      toast(`Couldn't save: ${err.message}`, true);
    }
  }, extra.cover ? 0 : 250);
}

async function loadInfo(sound) {
  if (info.has(sound.id)) return;
  info.set(sound.id, { duration: 2, peaks: null, loading: true });
  try {
    const buffer = await player.buffer(sound);
    const columns = Math.max(1, Math.min(60000, Math.ceil(buffer.duration * PEAKS_PER_SECOND)));
    info.set(sound.id, { duration: buffer.duration, peaks: BashCommon.peaks(buffer, columns) });
  } catch {
    info.set(sound.id, { duration: 2, peaks: null, error: true });
  }
  render();
}

// ---------- Rendering ----------

function render() {
  if (!bash) return;
  renderTimeline();
  renderInspector();
  renderTime();
}

function rulerStep() {
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  return steps.find((s) => s * pps >= 70) || 600;
}

function renderTimeline() {
  const timeline = $('#timeline');
  const content = $('#content');
  const lanes = laneCount();
  const width = Math.max(timeline.clientWidth, (layoutDuration() + 10) * pps);
  content.style.width = `${width}px`;
  content.style.height = `${RULER_HEIGHT + lanes * LANE_HEIGHT}px`;

  // Ruler
  const ruler = $('#ruler');
  ruler.textContent = '';
  const step = rulerStep();
  for (let t = 0; t * pps < width; t += step) {
    const tick = document.createElement('div');
    tick.className = 'tick';
    tick.style.left = `${t * pps}px`;
    tick.textContent = step < 1 ? AudioUtils.formatTime(t) : AudioUtils.formatTime(t).replace(/\.0$/, '');
    ruler.appendChild(tick);
  }

  // Lanes and clips
  const host = $('#lanes');
  host.textContent = '';
  host.style.height = `${lanes * LANE_HEIGHT}px`;
  for (let i = 0; i < lanes; i++) {
    const lane = document.createElement('div');
    lane.className = 'lane';
    lane.style.top = `${i * LANE_HEIGHT}px`;
    lane.style.height = `${LANE_HEIGHT}px`;
    host.appendChild(lane);
  }

  for (const clip of bash.clips) {
    const sound = soundOf(clip);
    if (!sound) continue;
    const el = document.createElement('div');
    el.className = 'clip' + (clip.id === selectedId ? ' selected' : '');
    el.dataset.id = clip.id;
    el.style.setProperty('--clip-color', sound.color || '#7c6cff');
    positionClip(el, clip);

    const canvas = document.createElement('canvas');
    el.appendChild(canvas);
    const label = document.createElement('span');
    label.className = 'clip-label';
    label.textContent = sound.name;
    el.appendChild(label);
    if (clip.volume < 1) {
      const vol = document.createElement('span');
      vol.className = 'clip-vol';
      vol.textContent = `${Math.round(clip.volume * 100)}%`;
      el.appendChild(vol);
    }

    if (clip.repeat) {
      const rep = document.createElement('span');
      rep.className = 'clip-repeat';
      rep.textContent = clip.repeat.times ? `↻ ×${clip.repeat.times}` : '↻ ∞';
      el.appendChild(rep);
    }

    el.addEventListener('pointerdown', (e) => startDrag(e, clip, el));
    host.appendChild(el);
    drawWaveform(canvas, clip);
    drawRepeats(host, clip, sound, width);
  }
  positionPlayhead();
}

// Faded copies after a repeating clip, one per extra play.
function drawRepeats(host, clip, sound, width) {
  for (const ghost of host.querySelectorAll(`.clip-ghost[data-for="${clip.id}"]`)) ghost.remove();
  if (!clip.repeat) return;
  const length = clipDuration(clip);
  const period = length + clip.repeat.gap;
  const plays = clip.repeat.times || Infinity;
  for (let i = 1; i < plays && i < 400; i++) {
    const start = clip.offset + i * period;
    if (start * pps > width) break;
    const ghost = document.createElement('div');
    ghost.className = 'clip-ghost';
    ghost.dataset.for = clip.id;
    ghost.style.setProperty('--clip-color', sound.color || '#7c6cff');
    ghost.style.left = `${start * pps}px`;
    ghost.style.top = `${clip.lane * LANE_HEIGHT + 5}px`;
    ghost.style.width = `${Math.max(6, length * pps)}px`;
    ghost.style.height = `${LANE_HEIGHT - 10}px`;
    ghost.textContent = '↻';
    host.appendChild(ghost);
  }
}

function positionClip(el, clip) {
  el.style.left = `${clip.offset * pps}px`;
  el.style.top = `${clip.lane * LANE_HEIGHT + 5}px`;
  el.style.width = `${Math.max(18, clipDuration(clip) * pps)}px`;
  el.style.height = `${LANE_HEIGHT - 10}px`;
}

function drawWaveform(canvas, clip) {
  const data = info.get(clip.soundId);
  const width = Math.min(4096, Math.max(18, Math.round(clipDuration(clip) * pps)));
  const height = LANE_HEIGHT - 10;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.width = `${Math.max(18, clipDuration(clip) * pps)}px`;
  canvas.style.height = `${height}px`;
  if (!data || !data.peaks) return;
  const g = canvas.getContext('2d');
  g.scale(ratio, ratio);
  g.fillStyle = 'rgba(255,255,255,0.55)';
  const columns = data.peaks.length / 2;
  const mid = height / 2;
  for (let x = 0; x < width; x++) {
    const c = Math.min(columns - 1, Math.floor((x / width) * columns));
    const min = data.peaks[c * 2] * clip.volume;
    const max = data.peaks[c * 2 + 1] * clip.volume;
    g.fillRect(x, mid - max * mid * 0.9, 1, Math.max(1, (max - min) * mid * 0.9));
  }
}

function renderInspector() {
  const clip = bash.clips.find((c) => c.id === selectedId);
  $('#inspector-empty').classList.toggle('hidden', !!clip);
  $('#inspector-clip').classList.toggle('hidden', !clip);
  if (!clip) return;
  const sound = soundOf(clip);
  $('#clip-color').style.background = sound?.color || '#7c6cff';
  $('#clip-name').textContent = sound?.name || 'Missing sound';
  if (document.activeElement !== $('#clip-offset')) $('#clip-offset').value = AudioUtils.formatTime(clip.offset);
  if (document.activeElement !== $('#clip-volume')) $('#clip-volume').value = clip.volume;
  $('#clip-repeat').checked = !!clip.repeat;
  $('#clip-repeat-fields').classList.toggle('disabled', !clip.repeat);
  for (const input of [$('#clip-repeat-gap'), $('#clip-repeat-times')]) input.disabled = !clip.repeat;
  if (document.activeElement !== $('#clip-repeat-gap')) $('#clip-repeat-gap').value = clip.repeat ? clip.repeat.gap : 0;
  if (document.activeElement !== $('#clip-repeat-times')) $('#clip-repeat-times').value = clip.repeat && clip.repeat.times ? clip.repeat.times : '';
}

function renderTime() {
  const state = player.state();
  const position = state ? state.position : cursor;
  const total = totalDuration();
  $('#time').textContent = `${AudioUtils.formatTime(position)} / ${Number.isFinite(total) ? AudioUtils.formatTime(total) : '∞ (repeats until stopped)'}`;
  $('#play-btn').textContent = state ? '■ Stop' : '▶ Play';
}

function positionPlayhead() {
  const state = player.state();
  const position = state ? state.position : cursor;
  const head = $('#playhead');
  head.style.left = `${position * pps}px`;
  head.style.height = `${RULER_HEIGHT + laneCount() * LANE_HEIGHT}px`;
}

function renderLibrary() {
  const filter = $('#lib-filter').value.trim().toLowerCase();
  const host = $('#lib-list');
  host.textContent = '';
  const visible = sounds.filter((s) => !filter || s.name.toLowerCase().includes(filter));
  if (!sounds.length) {
    host.innerHTML = '<p class="muted small">Your library is empty. Add sounds in the main window first.</p>';
    return;
  }
  for (const sound of visible) {
    const row = document.createElement('div');
    row.className = 'lib-row';
    row.draggable = true;
    row.title = 'Drag onto the timeline, or click + to add at the start';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = sound.color;
    const name = document.createElement('span');
    name.className = 'lib-name';
    name.textContent = sound.name;
    const add = document.createElement('button');
    add.textContent = '+';
    add.title = 'Add to the bash, starting at 0:00';
    add.addEventListener('click', () => addClip(sound.id, 0, null));
    row.append(dot, name, add);
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-sound-id', sound.id);
      e.dataTransfer.effectAllowed = 'copy';
    });
    host.appendChild(row);
  }
}

// ---------- Editing ----------

function addClip(soundId, offset, lane) {
  const sound = sounds.find((s) => s.id === soundId);
  if (!sound) return;
  const clip = {
    id: newId(),
    soundId,
    offset: Math.max(0, Math.round(offset * 1000) / 1000),
    volume: 1,
    // By default a new sound gets its own layer below the others.
    lane: lane ?? bash.clips.reduce((max, c) => Math.max(max, c.lane + 1), 0),
  };
  bash.clips.push(clip);
  selectedId = clip.id;
  loadInfo(sound);
  scheduleSave();
  render();
}

function removeClip(id) {
  bash.clips = bash.clips.filter((c) => c.id !== id);
  if (selectedId === id) selectedId = null;
  scheduleSave();
  render();
}

function select(id) {
  selectedId = id;
  for (const el of document.querySelectorAll('.clip')) el.classList.toggle('selected', el.dataset.id === id);
  renderInspector();
}

// Snaps a start time to the 0.1s grid or to nearby clip edges.
function snapOffset(offset, clip, free) {
  if (free || !$('#snap').checked) return Math.max(0, offset);
  const threshold = 8 / pps;
  let best = Math.round(offset * 10) / 10;
  let bestDistance = Math.abs(best - offset);
  const length = clipDuration(clip);
  for (const other of bash.clips) {
    if (other.id === clip.id) continue;
    const edges = [other.offset, other.offset + clipDuration(other)];
    for (const edge of edges) {
      for (const candidate of [edge, edge - length]) {
        const d = Math.abs(candidate - offset);
        if (d < threshold && d <= bestDistance) { best = candidate; bestDistance = d; }
      }
    }
  }
  if (Math.abs(offset) < threshold) best = 0;
  return Math.max(0, Math.round(best * 1000) / 1000);
}

function startDrag(e, clip, el) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  select(clip.id);
  el.setPointerCapture(e.pointerId);
  dragging = { clip, el, x: e.clientX, y: e.clientY, offset: clip.offset, lane: clip.lane, moved: false };
  el.addEventListener('pointermove', onDragMove);
  el.addEventListener('pointerup', onDragEnd, { once: true });
  el.addEventListener('pointercancel', onDragEnd, { once: true });
}

function onDragMove(e) {
  if (!dragging) return;
  const { clip, el } = dragging;
  const dx = e.clientX - dragging.x;
  const dy = e.clientY - dragging.y;
  if (!dragging.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
  dragging.moved = true;
  el.classList.add('dragging');
  clip.offset = snapOffset(dragging.offset + dx / pps, clip, e.altKey);
  clip.lane = Math.max(0, Math.min(laneCount(), dragging.lane + Math.round(dy / LANE_HEIGHT)));
  positionClip(el, clip);
  const sound = soundOf(clip);
  if (sound) drawRepeats($('#lanes'), clip, sound, parseFloat($('#content').style.width) || 0);
  renderInspector();
  renderTime();
}

function onDragEnd() {
  if (!dragging) return;
  const { el, moved } = dragging;
  el.removeEventListener('pointermove', onDragMove);
  el.classList.remove('dragging');
  dragging = null;
  if (moved) {
    scheduleSave();
    render();
  }
}

// Click on the ruler or an empty lane: move the playhead and deselect.
$('#content').addEventListener('pointerdown', (e) => {
  if (e.target.closest('.clip')) return;
  const rect = $('#content').getBoundingClientRect();
  cursor = Math.max(0, (e.clientX - rect.left) / pps);
  select(null);
  if (player.state()) player.play(bash, sounds, cursor);
  positionPlayhead();
  renderTime();
});

// Drop sounds from the library onto the timeline.
const lanesEl = $('#lanes');
lanesEl.addEventListener('dragover', (e) => {
  if (e.dataTransfer.types.includes('application/x-sound-id')) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }
});
lanesEl.addEventListener('drop', (e) => {
  const soundId = e.dataTransfer.getData('application/x-sound-id');
  if (!soundId) return;
  e.preventDefault();
  const rect = lanesEl.getBoundingClientRect();
  const offset = (e.clientX - rect.left) / pps;
  const lane = Math.max(0, Math.floor((e.clientY - rect.top) / LANE_HEIGHT));
  const snapped = $('#snap').checked && !e.altKey ? Math.round(offset * 10) / 10 : offset;
  addClip(soundId, snapped < 8 / pps ? 0 : snapped, lane);
});

// ---------- Inspector ----------

function selectedClip() {
  return bash.clips.find((c) => c.id === selectedId);
}

$('#clip-offset').addEventListener('change', (e) => {
  const clip = selectedClip();
  const value = AudioUtils.parseTime(e.target.value);
  if (!clip) return;
  if (!Number.isFinite(value)) { toast('Type a time like 1.5 or 0:01.5', true); renderInspector(); return; }
  clip.offset = Math.max(0, Math.round(value * 1000) / 1000);
  scheduleSave();
  render();
});

$('#clip-volume').addEventListener('input', (e) => {
  const clip = selectedClip();
  if (!clip) return;
  clip.volume = Number(e.target.value);
  scheduleSave();
  const el = document.querySelector(`.clip[data-id="${clip.id}"] canvas`);
  if (el) drawWaveform(el, clip);
});
$('#clip-volume').addEventListener('change', render);

$('#clip-zero').addEventListener('click', () => {
  const clip = selectedClip();
  if (!clip) return;
  clip.offset = 0;
  scheduleSave();
  render();
});

$('#clip-dup').addEventListener('click', () => {
  const clip = selectedClip();
  if (!clip) return;
  const copy = { ...clip, id: newId(), lane: bash.clips.reduce((max, c) => Math.max(max, c.lane + 1), 0) };
  bash.clips.push(copy);
  selectedId = copy.id;
  scheduleSave();
  render();
});

function updateRepeat() {
  const clip = selectedClip();
  if (!clip) return;
  if (!$('#clip-repeat').checked) {
    clip.repeat = null;
  } else {
    const gap = Math.max(0, Math.min(3600, Number($('#clip-repeat-gap').value) || 0));
    const times = Math.floor(Number($('#clip-repeat-times').value) || 0);
    clip.repeat = { gap: Math.round(gap * 10) / 10, times: times >= 2 ? Math.min(999, times) : 0 };
  }
  scheduleSave();
  render();
}
$('#clip-repeat').addEventListener('change', updateRepeat);
$('#clip-repeat-gap').addEventListener('change', updateRepeat);
$('#clip-repeat-times').addEventListener('change', updateRepeat);

$('#clip-remove').addEventListener('click', () => { if (selectedId) removeClip(selectedId); });

// ---------- Header ----------

$('#bash-name').addEventListener('input', (e) => {
  bash.name = e.target.value;
  document.title = `Bash — ${bash.name || 'Untitled'}`;
  scheduleSave();
});

$('#zoom').addEventListener('input', (e) => {
  const timeline = $('#timeline');
  // Keep the playhead area in view while zooming.
  const anchor = (timeline.scrollLeft + timeline.clientWidth / 2) / pps;
  pps = Number(e.target.value);
  render();
  timeline.scrollLeft = anchor * pps - timeline.clientWidth / 2;
});

$('#play-btn').addEventListener('click', togglePlay);

async function togglePlay() {
  if (player.state()) {
    player.stop();
    return;
  }
  if (!bash.clips.length) { toast('Add some sounds first.'); return; }
  if (cursor >= totalDuration()) cursor = 0;
  await player.play(bash, sounds, cursor);
}

let raf = null;
function animate() {
  positionPlayhead();
  renderTime();
  const state = player.state();
  if (state) {
    // Follow the playhead when it leaves the visible area.
    const timeline = $('#timeline');
    const x = state.position * pps;
    if (x > timeline.scrollLeft + timeline.clientWidth - 40) timeline.scrollLeft = x - 80;
    raf = requestAnimationFrame(animate);
  }
}
player.onChange(() => { cancelAnimationFrame(raf); animate(); });

document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName) && document.activeElement.type !== 'range' && document.activeElement.type !== 'checkbox';
  if (typing) return;
  if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) { e.preventDefault(); removeClip(selectedId); }
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && selectedId) {
    e.preventDefault();
    const clip = selectedClip();
    const delta = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 0.1);
    clip.offset = Math.max(0, Math.round((clip.offset + delta) * 1000) / 1000);
    scheduleSave();
    render();
  }
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && selectedId) {
    e.preventDefault();
    const clip = selectedClip();
    clip.lane = Math.max(0, clip.lane + (e.key === 'ArrowUp' ? -1 : 1));
    scheduleSave();
    render();
  }
  if (e.key === 'Escape') { select(null); hideCoverPopover(); }
});

// ---------- Cover ----------

function renderCoverButton() {
  BashCommon.renderCover($('#cover-btn'), bash, api);
}

function showCoverPopover() {
  const pop = $('#cover-popover');
  const icons = $('#icon-grid');
  const colors = $('#color-grid');
  icons.textContent = '';
  colors.textContent = '';
  const current = bash.cover.type === 'icon' ? bash.cover : { icon: null, color: BashCommon.ICON_COLORS[0] };
  for (const icon of BashCommon.ICONS) {
    const b = document.createElement('button');
    b.textContent = icon;
    b.className = 'icon-choice' + (icon === current.icon ? ' selected' : '');
    b.addEventListener('click', () => setIconCover(icon, current.color));
    icons.appendChild(b);
  }
  for (const color of BashCommon.ICON_COLORS) {
    const b = document.createElement('button');
    b.className = 'swatch' + (color === current.color ? ' selected' : '');
    b.style.background = color;
    b.title = color;
    b.addEventListener('click', () => setIconCover(current.icon || BashCommon.ICONS[0], color));
    colors.appendChild(b);
  }
  pop.classList.remove('hidden');
}

function hideCoverPopover() {
  $('#cover-popover').classList.add('hidden');
}

function setIconCover(icon, color) {
  bash.cover = { type: 'icon', icon, color };
  renderCoverButton();
  showCoverPopover();
  scheduleSave({ cover: bash.cover });
}

$('#cover-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  if ($('#cover-popover').classList.contains('hidden')) showCoverPopover(); else hideCoverPopover();
});
$('#upload-cover').addEventListener('click', async () => {
  try {
    const updated = await api.bashes.chooseCover(bashId);
    if (updated) {
      bash.cover = updated.cover;
      renderCoverButton();
      hideCoverPopover();
    }
  } catch (err) {
    toast(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true);
  }
});
document.addEventListener('click', (e) => {
  // composedPath() still knows the popover when the clicked button was just re-rendered away.
  const inside = e.composedPath().some((el) => el.id === 'cover-popover' || el.id === 'cover-btn');
  if (!inside) hideCoverPopover();
});

// ---------- Startup ----------

$('#lib-filter').addEventListener('input', renderLibrary);
window.addEventListener('resize', render);

async function reloadSounds() {
  sounds = await api.list();
  for (const clip of bash.clips) {
    const sound = soundOf(clip);
    if (sound) loadInfo(sound);
  }
  renderLibrary();
  render();
}

api.onSoundsChanged(reloadSounds);
api.bashes.onChanged((list) => {
  const updated = list.find((b) => b.id === bashId);
  if (!updated || dragging) return;
  // Another window changed this bash (e.g. a sound was deleted).
  bash = updated;
  if (selectedId && !bash.clips.some((c) => c.id === selectedId)) selectedId = null;
  renderCoverButton();
  render();
});

(async function init() {
  bash = await api.bashes.get(bashId);
  if (!bash) {
    document.body.innerHTML = '<p class="muted" style="padding:40px">This bash no longer exists.</p>';
    return;
  }
  document.title = `Bash — ${bash.name}`;
  $('#bash-name').value = bash.name;
  pps = Number($('#zoom').value);
  renderCoverButton();
  await reloadSounds();
  if (!bash.clips.length) $('#lib-filter').focus();
})();
