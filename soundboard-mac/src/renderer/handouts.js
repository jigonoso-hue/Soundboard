/* global api, $, Live, Icons, toast */
// Handouts: pictures the broadcaster pushes to every listener's screen (a map,
// a wanted poster, a monster reveal). A new one locks the listener's window
// to it, fitted to the screen, until they close it; pinch or scroll to zoom,
// drag to look around, Save to keep a copy. Handouts are only kept for the
// session: the list of them goes away when the listener leaves.
// Matches the iPad app's HandoutsView.swift.
const Handouts = (() => {
  // Pictures are scaled down to this many pixels on their longest side.
  const MAX_SIDE = 2048;
  const MAX_ZOOM = 6;
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (text, className, onClick, title) => {
    const b = el('button', className, text);
    b.type = 'button';
    if (title) b.title = title;
    b.addEventListener('click', onClick);
    return b;
  };

  // ---- A listener's handouts (this session only) ----

  let log = []; // [{ id, title, src, at }], oldest first
  let viewing = null;

  const viewer = el('section', 'handout-view hidden');
  viewer.setAttribute('role', 'dialog');
  viewer.setAttribute('aria-modal', 'true');
  viewer.setAttribute('aria-label', 'Handout');
  const title = el('div', 'handout-title');
  const secretNote = el('div', 'handout-secret hidden', 'Only you can see this.');
  const stage = el('div', 'handout-stage');
  const img = el('img', 'handout-img');
  img.alt = '';
  img.draggable = false;
  stage.append(img);
  const bar = el('div', 'handout-bar');
  const save = button('Save', 'handout-save', async () => {
    if (!viewing) return;
    try { if (await api.live.handoutSave(viewing.id)) toast('Handout saved.'); } catch { toast('Couldn’t save the handout.', true); }
  }, 'Keep a copy of this picture');
  const close = button('Close', 'handout-close primary', () => closeViewer());
  bar.append(save, close);
  viewer.append(title, secretNote, stage, bar);
  document.body.append(viewer);

  // Zoom and pan: scale around a point, kept so the picture can't be lost off screen.
  let zoom = { scale: 1, x: 0, y: 0 };
  function applyZoom() {
    img.style.transform = `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`;
    viewer.classList.toggle('zoomed', zoom.scale > 1.01);
  }
  function clampPan() {
    const box = stage.getBoundingClientRect();
    const maxX = Math.max(0, (box.width * (zoom.scale - 1)) / 2);
    const maxY = Math.max(0, (box.height * (zoom.scale - 1)) / 2);
    zoom.x = Math.max(-maxX, Math.min(maxX, zoom.x));
    zoom.y = Math.max(-maxY, Math.min(maxY, zoom.y));
  }
  // Zooms to `scale`, keeping the point (cx, cy) on screen where it is.
  function zoomTo(scale, cx, cy) {
    const box = stage.getBoundingClientRect();
    const next = Math.max(1, Math.min(MAX_ZOOM, scale));
    const px = cx - (box.left + box.width / 2);
    const py = cy - (box.top + box.height / 2);
    zoom.x = px - ((px - zoom.x) * next) / zoom.scale;
    zoom.y = py - ((py - zoom.y) * next) / zoom.scale;
    zoom.scale = next;
    if (next === 1) { zoom.x = 0; zoom.y = 0; }
    clampPan();
    applyZoom();
  }

  // Pinch on a trackpad arrives as a wheel event with ctrlKey; a scroll wheel zooms too.
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomTo(zoom.scale * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), e.clientX, e.clientY);
  }, { passive: false });
  stage.addEventListener('dblclick', (e) => zoomTo(zoom.scale > 1.01 ? 1 : 2.5, e.clientX, e.clientY));
  // Touch screens: two fingers pinch, one drags.
  const pointers = new Map();
  let pinch = null;
  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: zoom.scale };
    }
  });
  stage.addEventListener('pointermove', (e) => {
    const last = pointers.get(e.pointerId);
    if (!last) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      zoomTo(pinch.scale * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance), (a.x + b.x) / 2, (a.y + b.y) / 2);
    } else if (pointers.size === 1 && zoom.scale > 1) {
      zoom.x += e.clientX - last.x;
      zoom.y += e.clientY - last.y;
      clampPan();
      applyZoom();
    }
  });
  const lift = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; };
  stage.addEventListener('pointerup', lift);
  stage.addEventListener('pointercancel', lift);

  document.addEventListener('keydown', (e) => {
    if (viewer.classList.contains('hidden')) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeViewer(); }
  }, true);

  function openViewer(item) {
    viewing = item;
    zoom = { scale: 1, x: 0, y: 0 };
    applyZoom();
    img.src = item.src;
    title.textContent = `${item.secret ? '🔒 ' : ''}${item.title || 'Handout'}`;
    title.title = item.secret ? 'Only you were sent this' : '';
    secretNote.classList.toggle('hidden', !item.secret);
    // Locked to it: whatever else was open closes, and nothing behind can be reached.
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    closeLog();
    viewer.classList.remove('hidden');
    document.body.classList.add('handout-open');
    close.focus();
  }

  function closeViewer() {
    viewing = null;
    viewer.classList.add('hidden');
    document.body.classList.remove('handout-open');
    img.removeAttribute('src');
  }

  // The session's handouts, from the stage's Handouts button.
  const logPanel = el('div', 'handout-log hidden');
  logPanel.setAttribute('role', 'dialog');
  logPanel.setAttribute('aria-label', 'Handouts');
  document.body.append(logPanel);
  function openLog() {
    logPanel.textContent = '';
    const head = el('div', 'handout-log-head');
    head.append(el('h2', null, 'Handouts'), button('Close', 'handout-log-close', closeLog));
    const grid = el('div', 'handout-log-grid');
    for (const item of [...log].reverse()) {
      const card = button('', 'handout-thumb', () => openViewer(item), `Open “${item.title || 'Handout'}”`);
      const pic = el('img');
      pic.src = item.src;
      pic.alt = '';
      card.append(pic, el('span', null, `${item.secret ? '🔒 ' : ''}${item.title || 'Handout'}`));
      grid.append(card);
    }
    logPanel.append(head, grid, el('p', 'muted small', 'Handouts are only kept until you leave the session. Open one and Save to keep a copy.'));
    logPanel.classList.remove('hidden');
  }
  function closeLog() { logPanel.classList.add('hidden'); }

  // A handout arrived: a new one (show) locks the window to it.
  function receive(handout) {
    if (!Live.listening()) return;
    const item = { id: handout.id, title: handout.title || '', src: handout.src, at: handout.at, secret: !!handout.secret };
    log = log.filter((h) => h.id !== item.id).concat(item);
    if (handout.show) {
      openViewer(item);
      api.live.notify(item.secret
        ? { title: '🔒 A secret handout', body: item.title || 'Only you can see this one.' }
        : { title: '🗺️ New handout', body: item.title || 'The broadcaster sent a picture.' });
    }
    if (!logPanel.classList.contains('hidden')) openLog();
    Live.refreshStage?.();
  }

  // ---- The broadcaster: send a picture ----

  let picked = null; // { data: Uint8Array, preview: data URL }
  const sent = []; // [{ id, title, thumb, to: [names] | null }] this session
  // Who it goes to: nobody picked is everyone; picking listeners makes it secret.
  const sendTo = new Set();

  const input = el('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.hidden = true;
  input.className = 'handout-input';
  document.body.append(input);

  // Scales a picture down and turns it into a JPEG.
  async function prepare(file) {
    const bitmap = await createImageBitmap(file);
    const ratio = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = el('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    const data = new Uint8Array(await blob.arrayBuffer());
    // A small copy for the dialog and the list of sent handouts.
    const thumbRatio = Math.min(1, 320 / Math.max(canvas.width, canvas.height));
    const thumb = el('canvas');
    thumb.width = Math.max(1, Math.round(canvas.width * thumbRatio));
    thumb.height = Math.max(1, Math.round(canvas.height * thumbRatio));
    thumb.getContext('2d').drawImage(canvas, 0, 0, thumb.width, thumb.height);
    return { data, preview: thumb.toDataURL('image/jpeg', 0.8) };
  }

  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    try {
      picked = await prepare(file);
      if (!$('#handout-title').value.trim()) $('#handout-title').value = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 60);
      renderDialog();
    } catch {
      toast('Couldn’t open that picture.', true);
    }
  });

  function renderDialog() {
    const preview = $('#handout-preview');
    preview.textContent = '';
    if (picked) {
      const pic = el('img');
      pic.src = picked.preview;
      pic.alt = 'The picture to send';
      preview.append(pic, button('Choose another…', 'handout-choose', () => input.click()));
    } else {
      const choose = button('', 'handout-drop', () => input.click(), 'Choose a picture');
      Icons.set(choose, 'map', 'Choose a picture…', { size: 22 });
      preview.append(choose);
    }
    $('#handout-send').disabled = !picked;
    renderTo();
    const list = $('#handout-sent');
    list.textContent = '';
    list.classList.toggle('hidden', !sent.length);
    if (sent.length) {
      list.append(el('div', 'menu-heading', 'Sent this session'));
      const row = el('div', 'handout-sent-row');
      for (const item of [...sent].reverse()) {
        const card = button('', 'handout-thumb', async () => {
          await api.live.handoutShow(item.id);
          toast(`Showing “${item.title || 'Handout'}” again.`);
        }, item.to ? `Show it again to ${item.to.join(', ')}` : 'Show it on everyone’s screen again');
        const pic = el('img');
        pic.src = item.thumb;
        pic.alt = '';
        card.append(pic, el('span', null, `${item.to ? '🔒 ' : ''}${item.title || 'Handout'}`));
        row.append(card);
      }
      list.append(row);
    }
  }

  // Everyone, or only the listeners picked (a secret handout).
  function renderTo() {
    const box = $('#handout-to');
    box.textContent = '';
    const peers = Live.peers();
    for (const peer of [...sendTo]) if (!peers.some((p) => p.peer === peer)) sendTo.delete(peer);
    box.append(el('div', 'handout-to-label', 'Send to'));
    const row = el('div', 'handout-to-row');
    const everyone = button('Everyone', `handout-to-chip${sendTo.size ? '' : ' on'}`, () => { sendTo.clear(); renderTo(); });
    everyone.setAttribute('aria-pressed', String(!sendTo.size));
    row.append(everyone);
    for (const peer of peers) {
      const on = sendTo.has(peer.peer);
      const chip = button('', `handout-to-chip${on ? ' on' : ''}`, () => {
        if (on) sendTo.delete(peer.peer); else sendTo.add(peer.peer);
        renderTo();
      }, `Only ${peer.name} (and anyone else you pick) sees it`);
      chip.setAttribute('aria-pressed', String(on));
      chip.append(Live.face(peer.peer, peer.name, 22), el('span', null, peer.name));
      row.append(chip);
    }
    box.append(row);
    if (sendTo.size) box.append(el('p', 'muted small', 'A secret handout: only they see it. No one else is told.'));
    const names = peers.filter((p) => sendTo.has(p.peer)).map((p) => p.name);
    $('#handout-send').textContent = names.length ? `Send to ${names.length === 1 ? names[0] : `${names.length} listeners`}` : 'Send to everyone';
  }

  function openDialog() {
    picked = null;
    sendTo.clear();
    $('#handout-title').value = '';
    renderDialog();
    $('#handout-dialog').showModal();
  }

  $('#handout-dialog').addEventListener('close', async () => {
    const dialog = $('#handout-dialog');
    if (dialog.returnValue !== 'send' || !picked) return;
    const name = $('#handout-title').value.trim().slice(0, 60);
    const to = [...sendTo];
    const names = Live.peers().filter((p) => sendTo.has(p.peer)).map((p) => p.name);
    try {
      const { id } = await api.live.handoutSend(picked.data, name, to.length ? to : null);
      sent.push({ id, title: name, thumb: picked.preview, to: to.length ? names : null });
      const n = (await api.live.status()).peers?.length || 0;
      toast(to.length ? `Sent “${name || 'Handout'}” secretly to ${names.join(', ')}.` : `Sent “${name || 'Handout'}” to ${n} listener${n === 1 ? '' : 's'}.`);
    } catch (err) {
      toast(err.message || 'Couldn’t send the handout.', true);
    }
    picked = null;
  });

  $('#handout-btn').addEventListener('click', openDialog);

  function statusChanged() {
    $('#handout-btn').classList.toggle('hidden', !Live.hosting());
    if (!Live.hosting()) sent.length = 0;
    if (!Live.listening()) {
      log = [];
      closeViewer();
      closeLog();
    }
  }

  api.live.onHandout(receive);

  return { statusChanged, count: () => log.length, openLog };
})();
window.Handouts = Handouts;
