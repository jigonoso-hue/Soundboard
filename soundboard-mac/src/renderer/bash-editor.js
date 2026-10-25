/* global AudioUtils, BashCommon, Fx, IconPicker, Icons */
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
const soundLength = (clip) => info.get(clip.soundId)?.duration ?? 2;
// How long one play of the clip lasts: its trims, speed (and some effects, like Demon) change it.
const clipDuration = (clip) => BashCommon.clipLength(clip, soundLength(clip));
// The part of its sound the clip plays (seconds into the sound).
const spanOf = (clip) => BashCommon.clipSpan(clip, soundLength(clip));
// Bash time when the clip's last play ends (Infinity = repeats until stopped).
const clipEnd = (clip) => BashCommon.clipEnd(clip, soundLength(clip));
// Where the bash stops, if it has its own length (else Infinity).
const bashLimit = () => BashCommon.bashLimit(bash);
const round3 = (n) => Math.round(n * 1000) / 1000;
// What dragging a clip's edges does: 'trim' (both edges) or 'speed' (the right edge squashes or pulls).
let edgeMode = 'trim';
try { if (localStorage.getItem('bashEdgeMode') === 'speed') edgeMode = 'speed'; } catch { /* no storage */ }
const MIN_SPEED = 0.25;
const MAX_SPEED = 4;
const speedOf = (clip) => (Number(clip.speed) > 0 ? Number(clip.speed) : 1);
const speedText = (speed) => String(Math.round(speed * 100) / 100);
function setSpeed(clip, speed) {
  const value = Math.round(Math.max(MIN_SPEED, Math.min(MAX_SPEED, speed)) * 100) / 100;
  if (Math.abs(value - 1) < 0.001) delete clip.speed;
  else clip.speed = value;
}
const fxName = (id) => (Fx.VOICE.find((e) => e.id === id) || {}).name || id;
const totalDuration = () => Math.min(bashLimit(), bash.clips.reduce((end, c) => Math.max(end, clipEnd(c)), 0));
// Length to lay out on the timeline: endless repeats show a few plays.
const layoutEnd = (clip) => {
  const end = clipEnd(clip);
  if (Number.isFinite(end)) return end;
  const period = clipDuration(clip) + clip.repeat.gap;
  return clip.offset + Math.max(period * 4, 20);
};
const layoutDuration = () => bash.clips.reduce((end, c) => Math.max(end, layoutEnd(c)), Number.isFinite(bashLimit()) ? bashLimit() : 0);
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

// ---------- Draft, Save and Close ----------
// Edits stay in this window until Save; Close asks before throwing them away.

const isNewBash = new URLSearchParams(location.search).get('new') === '1';
let dirty = false;
let everSaved = false;
let pendingCover = null; // base64 PNG picked but not saved yet

function markDirty() {
  if (!dirty) {
    dirty = true;
    $('#dirty').classList.remove('hidden');
    api.editor.setDirty(true);
  }
}

async function save() {
  try {
    $('#save-btn').disabled = true;
    const changes = { name: bash.name, clips: bash.clips, length: bash.length ?? null };
    if (!pendingCover && bash.cover.type === 'icon') changes.cover = bash.cover;
    await api.bashes.update(bashId, changes);
    if (pendingCover) await api.bashes.setCoverData(bashId, pendingCover);
    dirty = false;
    everSaved = true;
    await api.editor.setDirty(false);
    return true;
  } catch (err) {
    toast(`Couldn't save: ${String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`, true);
    return false;
  } finally {
    $('#save-btn').disabled = false;
  }
}

async function closeWindow() {
  player.stop(false);
  await api.editor.setDirty(false);
  window.close();
}

async function discardAndClose() {
  // A brand-new bash that was never saved shouldn't leave an empty card behind.
  if (isNewBash && !everSaved) await api.bashes.remove(bashId);
  await closeWindow();
}

async function saveAndClose() {
  if (await save()) await closeWindow();
}

// Close button, ⌘W and the window's red button all come through here.
async function requestClose() {
  if (!dirty) {
    if (isNewBash && !everSaved && !bash.clips.length) await api.bashes.remove(bashId);
    await closeWindow();
    return;
  }
  const dialog = $('#confirm-close');
  $('#confirm-close-name').textContent = bash.name || 'this bash';
  dialog.returnValue = '';
  dialog.showModal();
  const choice = await new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true }));
  if (choice === 'save') await saveAndClose();
  else if (choice === 'discard') await discardAndClose();
}

$('#save-btn').addEventListener('click', saveAndClose);
$('#close-btn').addEventListener('click', requestClose);
let confirming = false;
api.editor.onCloseRequested(async () => {
  if (confirming) return;
  confirming = true;
  try { await requestClose(); } finally { confirming = false; }
});

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
  renderTimeAndControls();
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
    renderTags(el, clip);

    // The edges: the left one trims the start; the right one trims the end, or
    // (Speed) squashes the clip (faster) or pulls it out (slower).
    const left = document.createElement('div');
    left.className = 'clip-edge left';
    left.title = 'Drag to trim the start';
    left.addEventListener('pointerdown', (e) => startTrim(e, clip, el, 'left'));
    el.appendChild(left);
    const right = document.createElement('div');
    if (edgeMode === 'speed') {
      right.className = 'clip-stretch';
      right.title = 'Drag to squash (faster) or pull (slower)';
      right.addEventListener('pointerdown', (e) => startStretch(e, clip, el));
    } else {
      right.className = 'clip-edge right';
      right.title = 'Drag to trim the end';
      right.addEventListener('pointerdown', (e) => startTrim(e, clip, el, 'right'));
    }
    el.appendChild(right);

    el.addEventListener('pointerdown', (e) => startDrag(e, clip, el));
    host.appendChild(el);
    drawWaveform(canvas, clip);
    drawRepeats(host, clip, sound, width);
  }
  renderEndMarker();
  positionPlayhead();
}

// The bash's own end: a red line with a flag in the ruler to drag, and the time
// after it shaded.
function renderEndMarker() {
  const content = $('#content');
  for (const el of content.querySelectorAll('.bash-end, .bash-after')) el.remove();
  const limit = bashLimit();
  if (!Number.isFinite(limit)) return;
  const height = RULER_HEIGHT + laneCount() * LANE_HEIGHT;
  const after = document.createElement('div');
  after.className = 'bash-after';
  after.style.left = `${limit * pps}px`;
  after.style.height = `${height}px`;
  const end = document.createElement('div');
  end.className = 'bash-end';
  end.style.left = `${limit * pps}px`;
  end.style.height = `${height}px`;
  const flag = document.createElement('div');
  flag.className = 'bash-end-flag';
  flag.textContent = `End ${AudioUtils.formatTime(limit)}`;
  flag.title = 'The bash stops here. Drag to change its length.';
  flag.addEventListener('pointerdown', (e) => startEndDrag(e, flag));
  end.appendChild(flag);
  content.append(after, end);
}

function setLength(seconds) {
  if (seconds === null || !(seconds > 0)) delete bash.length;
  else bash.length = round3(Math.max(0.1, Math.min(3600, seconds)));
  markDirty();
}

function startEndDrag(e, flag) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  flag.setPointerCapture(e.pointerId);
  if (document.activeElement === $('#bash-length')) $('#bash-length').blur();
  const origin = { x: e.clientX, length: bashLimit() };
  const move = (ev) => {
    const t = snapTime(origin.length + (ev.clientX - origin.x) / pps, null, ev.altKey || !$('#snap').checked);
    setLength(t);
    const left = `${bashLimit() * pps}px`;
    $('.bash-end').style.left = left;
    $('.bash-after').style.left = left;
    flag.textContent = `End ${AudioUtils.formatTime(bashLimit())}`;
    renderLengthControls();
    renderTime();
  };
  flag.addEventListener('pointermove', move);
  flag.addEventListener('pointerup', () => { flag.removeEventListener('pointermove', move); render(); }, { once: true });
  flag.addEventListener('pointercancel', () => { flag.removeEventListener('pointermove', move); render(); }, { once: true });
}

function renderLengthControls() {
  const limit = bashLimit();
  if (document.activeElement !== $('#bash-length')) $('#bash-length').value = Number.isFinite(limit) ? AudioUtils.formatTime(limit) : '';
  $('#length-auto').disabled = !Number.isFinite(limit);
  for (const button of document.querySelectorAll('.seg')) button.classList.toggle('active', button.dataset.mode === edgeMode);
}

// The little labels along a clip's bottom: repeats, speed and effect.
function renderTags(el, clip) {
  let tags = el.querySelector('.clip-tags');
  if (!tags) {
    tags = document.createElement('span');
    tags.className = 'clip-tags';
    el.appendChild(tags);
  }
  tags.textContent = '';
  if (clip.repeat) {
    const rep = document.createElement('span');
    rep.className = 'clip-repeat';
    Icons.set(rep, 'repeat', clip.repeat.times ? `×${clip.repeat.times}` : '∞', { size: 10 });
    tags.appendChild(rep);
  }
  if (clip.trimStart || clip.trimEnd) {
    const tag = document.createElement('span');
    tag.className = 'clip-tag';
    tag.textContent = '✂';
    tag.title = 'Trimmed';
    tags.appendChild(tag);
  }
  const speed = speedOf(clip);
  if (speed !== 1) {
    const tag = document.createElement('span');
    tag.className = 'clip-tag';
    tag.textContent = `${speed > 1 ? '⏩' : '⏪'} ×${speedText(speed)}`;
    tags.appendChild(tag);
  }
  if (clip.fx) {
    const tag = document.createElement('span');
    tag.className = 'clip-tag fx';
    const amount = clip.fxAmount ?? 1;
    tag.textContent = `✦ ${fxName(clip.fx)}${amount < 1 ? ` ${Math.round(amount * 100)}%` : ''}`;
    tags.appendChild(tag);
  }
}

// Redraws one clip in place after its length or labels changed (while dragging
// or moving a slider), without rebuilding the timeline under the pointer.
function refreshClip(clip) {
  const el = document.querySelector(`.clip[data-id="${clip.id}"]`);
  const sound = soundOf(clip);
  if (!el || !sound) { render(); return; }
  positionClip(el, clip);
  const canvas = el.querySelector('canvas');
  if (canvas) drawWaveform(canvas, clip);
  renderTags(el, clip);
  drawRepeats($('#lanes'), clip, sound, parseFloat($('#content').style.width) || 0);
  renderInspector();
  renderTime();
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
    Icons.set(ghost, 'repeat', '', { size: 12 });
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
  // Only the part the clip plays.
  const span = spanOf(clip);
  const length = soundLength(clip);
  const first = (span.start / length) * columns;
  const shown = ((span.end - span.start) / length) * columns;
  for (let x = 0; x < width; x++) {
    const c = Math.min(columns - 1, Math.floor(first + (x / width) * shown));
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
  const span = spanOf(clip);
  if (document.activeElement !== $('#clip-trim-start')) $('#clip-trim-start').value = AudioUtils.formatTime(span.start);
  if (document.activeElement !== $('#clip-trim-end')) $('#clip-trim-end').value = AudioUtils.formatTime(span.end);
  $('#clip-sound-length').textContent = `of ${AudioUtils.formatTime(soundLength(clip))}`;
  $('#clip-trim-reset').disabled = !clip.trimStart && !clip.trimEnd;
  const speed = speedOf(clip);
  if (document.activeElement !== $('#clip-speed-range')) $('#clip-speed-range').value = Math.log2(speed);
  if (document.activeElement !== $('#clip-speed')) $('#clip-speed').value = speedText(speed);
  $('#clip-speed-reset').disabled = speed === 1;
  $('#clip-fx').value = clip.fx || '';
  const amount = clip.fxAmount ?? 1;
  $('#clip-fx-amount').disabled = !clip.fx;
  $('#clip-fx-amount-label').classList.toggle('disabled', !clip.fx);
  if (document.activeElement !== $('#clip-fx-amount')) $('#clip-fx-amount').value = amount;
  $('#clip-fx-amount-value').textContent = clip.fx ? `${Math.round(amount * 100)}%` : '';
}

function renderTimeAndControls() {
  renderTime();
  renderLengthControls();
}

function renderTime() {
  const state = player.state();
  const position = state ? state.position : cursor;
  const total = totalDuration();
  $('#time').textContent = `${AudioUtils.formatTime(position)} / ${Number.isFinite(total) ? AudioUtils.formatTime(total) : '∞ (repeats until stopped)'}`;
  const button = $('#play-btn');
  if (button.dataset.state !== String(!!state)) {
    button.dataset.state = String(!!state);
    Icons.set(button, state ? 'stop' : 'play', state ? 'Stop' : 'Play');
  }
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
  markDirty();
  render();
}

function removeClip(id) {
  bash.clips = bash.clips.filter((c) => c.id !== id);
  if (selectedId === id) selectedId = null;
  markDirty();
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
    markDirty();
    render();
  }
}

// Snaps a bash time (a clip's edge, the bash's end) to the 0.1s grid, the playhead,
// 0:00 and other clips' edges. `clip` (if any) is left out.
function snapTime(t, clip, free) {
  if (free) return Math.max(0, t);
  const threshold = 8 / pps;
  let best = Math.round(t * 10) / 10;
  let bestDistance = Math.abs(best - t);
  const candidates = [0, cursor];
  for (const other of bash.clips) {
    if (clip && other.id === clip.id) continue;
    candidates.push(other.offset, other.offset + clipDuration(other));
  }
  for (const edge of candidates) {
    const d = Math.abs(edge - t);
    if (d < threshold && d <= bestDistance) { best = edge; bestDistance = d; }
  }
  return Math.max(0, round3(best));
}

// Dragging a clip's edge trims it: the right edge cuts off its end, the left edge
// its start (the rest of the sound stays where it was in time).
function startTrim(e, clip, el, side) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  select(clip.id);
  const handle = e.currentTarget;
  handle.setPointerCapture(e.pointerId);
  dragging = {
    clip, el, handle, side, x: e.clientX, moved: false,
    offset: clip.offset, span: spanOf(clip), rate: BashCommon.clipRate(clip), sound: soundLength(clip),
  };
  handle.addEventListener('pointermove', onTrimMove);
  handle.addEventListener('pointerup', onTrimEnd, { once: true });
  handle.addEventListener('pointercancel', onTrimEnd, { once: true });
}

function onTrimMove(e) {
  const d = dragging;
  if (!d) return;
  const dx = e.clientX - d.x;
  if (!d.moved && Math.abs(dx) < 3) return;
  d.moved = true;
  d.el.classList.add('trimming');
  const free = e.altKey || !$('#snap').checked;
  const { clip, span, rate } = d;
  if (d.side === 'right') {
    const end = snapTime(d.offset + (span.end - span.start) / rate + dx / pps, clip, free);
    const trimEnd = Math.max(span.start + BashCommon.MIN_TRIM, Math.min(d.sound, span.start + (end - d.offset) * rate));
    if (trimEnd >= d.sound - 0.0005) delete clip.trimEnd;
    else clip.trimEnd = round3(trimEnd);
  } else {
    const start = snapTime(d.offset + dx / pps, clip, free);
    let trimStart = Math.max(0, Math.min(span.end - BashCommon.MIN_TRIM, span.start + (start - d.offset) * rate));
    // Not before 0:00 on the timeline.
    trimStart = Math.max(trimStart, span.start - d.offset * rate);
    clip.offset = Math.max(0, round3(d.offset + (trimStart - span.start) / rate));
    if (trimStart <= 0.0005) delete clip.trimStart;
    else clip.trimStart = round3(trimStart);
    // The end stays where it was in the sound.
    if (span.end < d.sound - 0.0005) clip.trimEnd = round3(span.end);
  }
  refreshClip(clip);
}

function onTrimEnd() {
  if (!dragging) return;
  const { el, handle, moved } = dragging;
  handle.removeEventListener('pointermove', onTrimMove);
  el.classList.remove('trimming');
  dragging = null;
  if (moved) {
    markDirty();
    render();
  }
}

// Cuts sounds in two at the playhead: the selected one, or every one under it.
// Each half is the same sound, trimmed, so either can be moved, trimmed or removed.
function cutAtPlayhead() {
  const t = player.state() ? player.state().position : cursor;
  const picked = selectedClip();
  const candidates = picked ? [picked] : bash.clips.slice();
  let cut = 0;
  let repeating = 0;
  for (const clip of candidates) {
    const length = clipDuration(clip);
    if (!(t > clip.offset + 0.01 && t < clip.offset + length - 0.01)) continue;
    if (clip.repeat) { repeating++; continue; }
    const span = spanOf(clip);
    const at = round3(span.start + (t - clip.offset) * BashCommon.clipRate(clip));
    const second = { ...clip, id: newId(), offset: round3(t), trimStart: at };
    if (span.end < soundLength(clip) - 0.0005) second.trimEnd = round3(span.end);
    clip.trimEnd = at;
    bash.clips.push(second);
    cut++;
  }
  if (!cut) {
    toast(repeating ? 'Turn off Repeat to cut a repeating sound.' : (picked ? 'Move the playhead over this sound to cut it there.' : 'Move the playhead over a sound to cut it there.'), true);
    return;
  }
  markDirty();
  render();
  toast(cut === 1 ? 'Cut in two.' : `Cut ${cut} sounds in two.`);
}

// Dragging a clip's right edge: a shorter clip plays faster (and higher),
// a longer one slower (and deeper), like a tape.
function startStretch(e, clip, el) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  select(clip.id);
  const handle = e.currentTarget;
  handle.setPointerCapture(e.pointerId);
  // The clip's length at normal speed (its effect may still change it).
  const natural = clipDuration({ ...clip, speed: 1 });
  dragging = { clip, el, handle, x: e.clientX, length: clipDuration(clip), natural, moved: false };
  handle.addEventListener('pointermove', onStretchMove);
  handle.addEventListener('pointerup', onStretchEnd, { once: true });
  handle.addEventListener('pointercancel', onStretchEnd, { once: true });
}

function onStretchMove(e) {
  if (!dragging) return;
  const dx = e.clientX - dragging.x;
  if (!dragging.moved && Math.abs(dx) < 3) return;
  dragging.moved = true;
  dragging.el.classList.add('stretching');
  const length = Math.max(0.01, dragging.length + dx / pps);
  let speed = dragging.natural / length;
  // Snap to steps of 0.05 (hold ⌥ for any speed), and catch normal speed.
  if ($('#snap').checked && !e.altKey) speed = Math.round(speed * 20) / 20;
  else if (Math.abs(speed - 1) < 0.02) speed = 1;
  setSpeed(dragging.clip, speed);
  refreshClip(dragging.clip);
}

function onStretchEnd() {
  if (!dragging) return;
  const { el, handle, moved } = dragging;
  handle.removeEventListener('pointermove', onStretchMove);
  el.classList.remove('stretching');
  dragging = null;
  if (moved) {
    markDirty();
    render();
  }
}

// Click on the ruler or an empty lane: move the playhead and deselect.
$('#content').addEventListener('pointerdown', (e) => {
  if (e.target.closest('.clip, .bash-end-flag')) return;
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
  markDirty();
  render();
});

$('#clip-volume').addEventListener('input', (e) => {
  const clip = selectedClip();
  if (!clip) return;
  clip.volume = Number(e.target.value);
  markDirty();
  const el = document.querySelector(`.clip[data-id="${clip.id}"] canvas`);
  if (el) drawWaveform(el, clip);
});
$('#clip-volume').addEventListener('change', render);

$('#clip-zero').addEventListener('click', () => {
  const clip = selectedClip();
  if (!clip) return;
  clip.offset = 0;
  markDirty();
  render();
});

$('#clip-dup').addEventListener('click', () => {
  const clip = selectedClip();
  if (!clip) return;
  const copy = { ...clip, id: newId(), lane: bash.clips.reduce((max, c) => Math.max(max, c.lane + 1), 0) };
  bash.clips.push(copy);
  selectedId = copy.id;
  markDirty();
  render();
});

// Trim: the part of the sound the clip plays, typed exactly.
function setTrim(which, value) {
  const clip = selectedClip();
  if (!clip) return;
  const seconds = AudioUtils.parseTime(value);
  if (!Number.isFinite(seconds)) { toast('Type a time like 1.5 or 0:01.5', true); renderInspector(); return; }
  const length = soundLength(clip);
  const span = spanOf(clip);
  if (which === 'start') {
    const start = Math.max(0, Math.min(span.end - BashCommon.MIN_TRIM, seconds));
    if (start <= 0.0005) delete clip.trimStart; else clip.trimStart = round3(start);
    if (span.end < length - 0.0005) clip.trimEnd = round3(span.end);
  } else {
    const end = Math.max(span.start + BashCommon.MIN_TRIM, Math.min(length, seconds));
    if (end >= length - 0.0005) delete clip.trimEnd; else clip.trimEnd = round3(end);
  }
  markDirty();
  render();
}
$('#clip-trim-start').addEventListener('change', (e) => setTrim('start', e.target.value));
$('#clip-trim-end').addEventListener('change', (e) => setTrim('end', e.target.value));
$('#clip-trim-reset').addEventListener('click', () => {
  const clip = selectedClip();
  if (!clip) return;
  delete clip.trimStart;
  delete clip.trimEnd;
  markDirty();
  render();
});

// Tools: cut, what the edges do, and the bash's length.
$('#cut-btn').addEventListener('click', cutAtPlayhead);
for (const button of document.querySelectorAll('.seg')) {
  button.addEventListener('click', () => {
    edgeMode = button.dataset.mode;
    try { localStorage.setItem('bashEdgeMode', edgeMode); } catch { /* no storage */ }
    render();
  });
}
$('#bash-length').addEventListener('change', (e) => {
  const text = e.target.value.trim();
  if (!text || /^auto$/i.test(text)) { setLength(null); render(); return; }
  const seconds = AudioUtils.parseTime(text);
  if (!(seconds > 0)) { toast('Type a length like 12 or 0:12.5, or leave it empty for Auto.', true); renderLengthControls(); return; }
  setLength(seconds);
  e.target.value = AudioUtils.formatTime(bash.length);
  render();
});
$('#length-here').addEventListener('click', () => {
  const t = player.state() ? player.state().position : cursor;
  if (!(t > 0)) { toast('Move the playhead to where the bash should end (click the ruler).', true); return; }
  setLength(t);
  render();
});
$('#length-auto').addEventListener('click', () => { setLength(null); render(); });

// Speed: the slider works in doublings (¼× … 4×) so slower and faster get the same room.
$('#clip-speed-range').addEventListener('input', (e) => {
  const clip = selectedClip();
  if (!clip) return;
  const value = Number(e.target.value);
  setSpeed(clip, Math.abs(value) < 0.03 ? 1 : 2 ** value);
  markDirty();
  refreshClip(clip);
});
$('#clip-speed-range').addEventListener('change', render);
$('#clip-speed').addEventListener('change', (e) => {
  const clip = selectedClip();
  if (!clip) return;
  const value = Number(e.target.value);
  if (!(value > 0)) { toast('Type a speed from 0.25 to 4', true); renderInspector(); return; }
  setSpeed(clip, value);
  markDirty();
  render();
});
$('#clip-speed-reset').addEventListener('click', () => {
  const clip = selectedClip();
  if (!clip) return;
  setSpeed(clip, 1);
  markDirty();
  render();
});

// Effect and how much of it you hear.
for (const effect of Fx.VOICE) {
  const option = document.createElement('option');
  option.value = effect.id;
  option.textContent = effect.name;
  option.title = effect.hint;
  $('#clip-fx').appendChild(option);
}
$('#clip-fx').addEventListener('change', (e) => {
  const clip = selectedClip();
  if (!clip) return;
  if (e.target.value) {
    clip.fx = e.target.value;
    clip.fxAmount = clip.fxAmount ?? 1;
  } else {
    delete clip.fx;
    delete clip.fxAmount;
  }
  markDirty();
  render();
});
$('#clip-fx-amount').addEventListener('input', (e) => {
  const clip = selectedClip();
  if (!clip || !clip.fx) return;
  clip.fxAmount = Math.round(Number(e.target.value) * 100) / 100;
  markDirty();
  refreshClip(clip);
});
$('#clip-fx-amount').addEventListener('change', render);

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
  markDirty();
  render();
}
$('#clip-repeat').addEventListener('change', updateRepeat);
$('#clip-repeat-gap').addEventListener('change', updateRepeat);
$('#clip-repeat-times').addEventListener('change', updateRepeat);

$('#clip-remove').addEventListener('click', () => { if (selectedId) removeClip(selectedId); });

// ---------- Header ----------

$('#bash-name').addEventListener('input', (e) => {
  bash.name = e.target.value;
  document.title = `Edit Bash — ${bash.name || 'Untitled'}`;
  markDirty();
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
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveAndClose(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w') { e.preventDefault(); requestClose(); return; }
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName) && document.activeElement.type !== 'range' && document.activeElement.type !== 'checkbox';
  if (typing) return;
  if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  if ((e.key === 'c' || e.key === 'C') && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); cutAtPlayhead(); }
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) { e.preventDefault(); removeClip(selectedId); }
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && selectedId) {
    e.preventDefault();
    const clip = selectedClip();
    const delta = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 0.1);
    clip.offset = Math.max(0, Math.round((clip.offset + delta) * 1000) / 1000);
    markDirty();
    render();
  }
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && selectedId) {
    e.preventDefault();
    const clip = selectedClip();
    clip.lane = Math.max(0, clip.lane + (e.key === 'ArrowUp' ? -1 : 1));
    markDirty();
    render();
  }
  if (e.key === 'Escape') { select(null); hideCoverPopover(); }
});

// ---------- Cover ----------

function renderCoverButton() {
  const el = $('#cover-btn');
  if (pendingCover) {
    el.textContent = '';
    el.style.background = `center / cover no-repeat url("data:image/png;base64,${pendingCover}")`;
    return;
  }
  BashCommon.renderCover(el, bash, api);
}

function showCoverPopover() {
  const current = bash.cover.type === 'icon' ? bash.cover : { icon: BashCommon.ICONS[0], color: BashCommon.ICON_COLORS[0] };
  const picker = IconPicker.create(current, { onChange: setIconCover });
  $('#cover-picker').replaceChildren(picker.element);
  $('#cover-popover').classList.remove('hidden');
}

function hideCoverPopover() {
  $('#cover-popover').classList.add('hidden');
}

function setIconCover({ icon, color, iconColor }) {
  pendingCover = null;
  bash.cover = { type: 'icon', icon, color, iconColor };
  renderCoverButton();
  markDirty();
}

$('#cover-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  if ($('#cover-popover').classList.contains('hidden')) showCoverPopover(); else hideCoverPopover();
});
$('#upload-cover').addEventListener('click', async () => {
  try {
    const picked = await api.bashes.pickCover();
    if (picked) {
      pendingCover = picked;
      markDirty();
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
  if (!updated) {
    // Deleted from the main window.
    api.editor.setDirty(false).then(() => window.close());
    return;
  }
  // Another window changed this bash (e.g. a sound was deleted). Don't
  // overwrite unsaved edits; Save will write the current draft.
  if (dragging || dirty) return;
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
  document.title = `Edit Bash — ${bash.name}`;
  $('#bash-name').value = bash.name;
  pps = Number($('#zoom').value);
  renderCoverButton();
  await reloadSounds();
  if (!bash.clips.length) $('#lib-filter').focus();
})();
