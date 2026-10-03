/* global api, $, sounds, prefs, savePrefs, render, toast, isFull, editingId, AudioUtils, Tags, Bashes, makeTile, makeTrack, matchesFilters */
// Scene Kits: customizable boards of sections holding sounds and bashes
// from the whole library. Sections live on a 12-column grid and can be
// moved and resized in "Customize Layout" mode.
const Kits = (() => {
  const ROW = 34; // px per grid row
  const GAP = 12; // px between grid cells
  const KIND_LABEL = { bashes: '⚡ Bashes', clips: '✂ Clips', full: '♫ Full sounds', mixed: '◎ Anything' };

  let list = [];
  let icons = [];
  let colors = [];
  let columns = 12;
  let editing = false; // Customize Layout mode
  const drawer = { open: false, target: null, search: '', type: 'all', tags: new Set() };

  const activeId = () => (String(prefs.view).startsWith('kit:') ? prefs.view.slice(4) : null);
  const activeKit = () => list.find((k) => k.id === activeId()) || null;
  const bashList = () => (typeof Bashes !== 'undefined' ? Bashes.all() : []);
  const allItems = (kit) => kit.sections.flatMap((s) => s.items);
  const inSection = (section, type, id) => section.items.some((i) => i.type === type && i.id === id);

  async function load() {
    const result = await api.kits.list();
    list = result.kits;
    icons = result.icons;
    colors = result.colors;
    columns = result.columns || 12;
    if (activeId() && !activeKit()) { prefs.view = 'all'; savePrefs(); }
  }

  function counts(kit) {
    const soundIds = new Set(sounds.map((s) => s.id));
    const bashIds = new Set(bashList().map((b) => b.id));
    const seen = new Set();
    let clips = 0;
    let full = 0;
    let bashes = 0;
    for (const item of allItems(kit)) {
      const key = `${item.type}:${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (item.type === 'bash') { if (bashIds.has(item.id)) bashes++; continue; }
      if (!soundIds.has(item.id)) continue;
      if (isFull(sounds.find((s) => s.id === item.id))) full++; else clips++;
    }
    return { clips, full, bashes, total: clips + full + bashes };
  }

  function describe(c) {
    const parts = [];
    if (c.clips) parts.push(`${c.clips} clip${c.clips > 1 ? 's' : ''}`);
    if (c.full) parts.push(`${c.full} full sound${c.full > 1 ? 's' : ''}`);
    if (c.bashes) parts.push(`${c.bashes} bash${c.bashes > 1 ? 'es' : ''}`);
    return parts.join(' · ') || 'Empty — add sounds from your library';
  }

  function badge(kit, size = 'small') {
    const el = document.createElement('span');
    el.className = `kit-badge ${size}`;
    el.style.setProperty('--kit-color', kit.color);
    el.textContent = kit.icon;
    return el;
  }

  // ---------- Saving ----------

  let saveTimer;
  function saveSections(kit, now = false) {
    clearTimeout(saveTimer);
    const run = () => api.kits.update(kit.id, { sections: kit.sections }).catch((err) => toast(`Couldn't save the kit: ${err.message}`, true));
    if (now) return run();
    saveTimer = setTimeout(run, 250);
    return null;
  }

  // ---------- Sidebar ----------

  function renderSidebar() {
    const host = $('#kit-list');
    host.textContent = '';
    if (!list.length) {
      const hint = document.createElement('p');
      hint.className = 'muted small kit-hint';
      hint.textContent = 'Group sounds, songs and bashes for a scene, like “Tavern Brawl”.';
      host.appendChild(hint);
    }
    for (const kit of list) {
      const btn = document.createElement('button');
      btn.className = 'view-btn kit-btn' + (activeId() === kit.id ? ' active' : '');
      btn.title = 'Open this scene kit · right-click for options';
      btn.appendChild(badge(kit));
      const name = document.createElement('span');
      name.className = 'kit-name';
      name.textContent = kit.name;
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = counts(kit).total || '';
      btn.append(name, count);
      btn.addEventListener('click', () => open(kit.id));
      btn.addEventListener('contextmenu', (e) => { e.preventDefault(); openKitMenu(kit.id, btn); });
      host.appendChild(btn);
    }
  }

  function open(id) {
    if (activeId() !== id) { editing = false; closeDrawer(false); }
    prefs.view = `kit:${id}`;
    savePrefs();
    render();
    $('#content').scrollTop = 0;
  }

  // ---------- Header ----------

  function renderHeader() {
    const kit = activeKit();
    $('#kit-header').classList.toggle('hidden', !kit);
    if (!kit) { closeDrawer(false); return; }
    $('#kit-header').style.setProperty('--kit-color', kit.color);
    $('#kit-header-badge').replaceChildren(badge(kit, 'large'));
    $('#kit-header-name').textContent = kit.name;
    $('#kit-header-meta').textContent = describe(counts(kit));
    $('#kit-layout-btn').textContent = editing ? '✓ Done' : '✥ Customize Layout';
    $('#kit-layout-btn').classList.toggle('primary', editing);
    $('#kit-layout-hint').classList.toggle('hidden', !editing);
  }

  // ---------- Board ----------

  function cellSize() {
    const width = $('#kit-board').clientWidth || 800;
    return { col: (width - GAP * (columns - 1)) / columns, width };
  }

  function place(el, section) {
    const { col } = cellSize();
    el.style.left = `${section.x * (col + GAP)}px`;
    el.style.top = `${section.y * (ROW + GAP)}px`;
    el.style.width = `${section.w * col + (section.w - 1) * GAP}px`;
    el.style.height = `${section.h * ROW + (section.h - 1) * GAP}px`;
  }

  function boardHeight(kit) {
    const rows = kit.sections.reduce((max, s) => Math.max(max, s.y + s.h), 0);
    return rows * (ROW + GAP) + (editing ? 3 * (ROW + GAP) : 0);
  }

  function renderBoard() {
    const kit = activeKit();
    const board = $('#kit-board');
    board.classList.toggle('hidden', !kit);
    if (!kit) return;
    board.classList.toggle('editing', editing);
    board.textContent = '';
    board.style.height = `${boardHeight(kit)}px`;
    for (const section of kit.sections) board.appendChild(makeSection(kit, section));
    if (typeof Bashes !== 'undefined') Bashes.refreshPlaying();
    if (drawer.open) renderDrawer();
  }

  function makeSection(kit, section) {
    const el = document.createElement('section');
    el.className = `kit-section size-${section.size}` + (drawer.open && drawer.target === section.id ? ' targeted' : '');
    el.dataset.id = section.id;
    place(el, section);

    const head = document.createElement('header');
    head.className = 'kit-section-head';
    const title = document.createElement('span');
    title.className = 'kit-section-title';
    title.textContent = section.title;
    title.title = editing ? 'Drag to move this section' : 'Double-click to rename';
    title.addEventListener('dblclick', () => renameSection(kit, section));
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = section.items.length || '';
    const add = document.createElement('button');
    add.className = 'mini section-add';
    add.textContent = '＋ Add';
    add.title = 'Add sounds and bashes to this section';
    add.addEventListener('click', (e) => { e.stopPropagation(); openDrawer(section.id); });
    const more = document.createElement('button');
    more.className = 'mini section-more';
    more.textContent = '⋯';
    more.title = 'Section options';
    more.addEventListener('click', (e) => { e.stopPropagation(); openSectionMenu(kit, section, more); });
    head.append(title, count, add, more);
    head.addEventListener('pointerdown', (e) => {
      if (!editing || e.button !== 0 || e.target.closest('button')) return;
      startMove(e, kit, section, el);
    });

    const body = document.createElement('div');
    body.className = 'kit-section-body';
    fillSection(kit, section, body);

    el.append(head, body);
    if (editing) {
      const handle = document.createElement('div');
      handle.className = 'resize-handle';
      handle.title = 'Drag to resize';
      handle.addEventListener('pointerdown', (e) => startResize(e, kit, section, el));
      el.appendChild(handle);
    }

    // Drops from the library drawer or from another section.
    el.addEventListener('dragover', (e) => {
      const types = e.dataTransfer.types;
      if (types.includes('application/x-kit-item')) {
        e.preventDefault();
        el.classList.add('drop-hover');
      }
    });
    el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('drop-hover'); });
    el.addEventListener('drop', (e) => {
      el.classList.remove('drop-hover');
      const raw = e.dataTransfer.getData('application/x-kit-item');
      if (!raw) return;
      e.preventDefault();
      const { type, id, from } = JSON.parse(raw);
      if (from === section.id) return;
      if (from) {
        const source = kit.sections.find((s) => s.id === from);
        if (source) source.items = source.items.filter((i) => !(i.type === type && i.id === id));
      }
      if (!inSection(section, type, id)) section.items.push({ type, id });
      saveSections(kit, true);
      render();
    });
    return el;
  }

  function fillSection(kit, section, body) {
    const filtering = !!($('#filter').value.trim() || prefs.tagFilter.length);
    const bashesById = new Map(bashList().map((b) => [b.id, b]));
    const bashItems = [];
    const clipItems = [];
    const fullItems = [];
    for (const item of section.items) {
      if (item.type === 'bash') {
        const bash = bashesById.get(item.id);
        if (bash && (!filtering || bash.name.toLowerCase().includes($('#filter').value.trim().toLowerCase()))) bashItems.push({ item, bash });
      } else {
        const sound = sounds.find((s) => s.id === item.id);
        if (!sound || (filtering && !matchesFilters(sound))) continue;
        (isFull(sound) ? fullItems : clipItems).push({ item, sound });
      }
    }

    if (!section.items.length) {
      const empty = document.createElement('button');
      empty.className = 'section-empty';
      empty.innerHTML = '<span>＋</span> Add from your library';
      empty.addEventListener('click', () => openDrawer(section.id));
      body.appendChild(empty);
      return;
    }
    if (!bashItems.length && !clipItems.length && !fullItems.length) {
      const none = document.createElement('p');
      none.className = 'muted small';
      none.textContent = 'Nothing here matches your filters.';
      body.appendChild(none);
      return;
    }

    // Bashes as cards, clips as tiles, full sounds as rows.
    if (bashItems.length) {
      const wrap = document.createElement('div');
      wrap.className = 'section-bashes';
      for (const { item, bash } of bashItems) wrap.appendChild(decorate(Bashes.makeCard(bash), kit, section, item));
      body.appendChild(wrap);
    }
    if (clipItems.length) {
      const grid = document.createElement('div');
      grid.className = 'section-clips';
      for (const { item, sound } of clipItems) grid.appendChild(decorate(makeTile(sound, { reorder: false }), kit, section, item));
      body.appendChild(grid);
    }
    if (fullItems.length) {
      const rows = document.createElement('div');
      rows.className = 'section-full';
      for (const { item, sound } of fullItems) rows.appendChild(decorate(makeTrack(sound, { reorder: false }), kit, section, item));
      body.appendChild(rows);
    }
  }

  // Adds the remove button and drag-between-sections to an item.
  function decorate(el, kit, section, item) {
    const remove = document.createElement('button');
    remove.className = 'kit-remove';
    remove.textContent = '−';
    remove.title = `Remove from “${section.title}” (stays in your library)`;
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      section.items = section.items.filter((i) => !(i.type === item.type && i.id === item.id));
      saveSections(kit, true);
      render();
    });
    el.appendChild(remove);
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-kit-item', JSON.stringify({ ...item, from: section.id }));
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    return el;
  }

  // ---------- Moving and resizing (Customize Layout) ----------

  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  // Sections float up to fill gaps; `fixed` keeps its spot and others flow around it.
  function compact(sections, fixed) {
    const placed = fixed ? [fixed] : [];
    const others = sections.filter((s) => s !== fixed).sort((a, b) => a.y - b.y || a.x - b.x);
    for (const s of others) {
      s.y = 0;
      while (placed.some((p) => overlaps(s, p))) s.y++;
      placed.push(s);
    }
    if (fixed) {
      const rest = placed.filter((p) => p !== fixed);
      while (fixed.y > 0 && !rest.some((p) => overlaps({ ...fixed, y: fixed.y - 1 }, p))) fixed.y--;
    }
  }

  function track(e, onMove, onEnd) {
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const move = (ev) => onMove(ev);
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      onEnd();
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }

  function preview(kit, section) {
    compact(kit.sections, section);
    for (const s of kit.sections) {
      const node = $('#kit-board').querySelector(`.kit-section[data-id="${s.id}"]`);
      if (node) place(node, s);
    }
    $('#kit-board').style.height = `${boardHeight(kit)}px`;
  }

  function startMove(e, kit, section, el) {
    const { col } = cellSize();
    const start = { x: e.clientX, y: e.clientY, sx: section.x, sy: section.y };
    el.classList.add('moving');
    track(e, (ev) => {
      const x = Math.round(start.sx + (ev.clientX - start.x) / (col + GAP));
      const y = Math.round(start.sy + (ev.clientY - start.y) / (ROW + GAP));
      const nx = Math.max(0, Math.min(columns - section.w, x));
      const ny = Math.max(0, y);
      if (nx === section.x && ny === section.y) return;
      section.x = nx;
      section.y = ny;
      preview(kit, section);
    }, () => {
      el.classList.remove('moving');
      compact(kit.sections, null);
      saveSections(kit, true);
      renderBoard();
    });
  }

  function startResize(e, kit, section, el) {
    e.stopPropagation();
    const { col } = cellSize();
    const start = { x: e.clientX, y: e.clientY, w: section.w, h: section.h };
    el.classList.add('moving');
    track(e, (ev) => {
      const w = Math.max(2, Math.min(columns - section.x, Math.round(start.w + (ev.clientX - start.x) / (col + GAP))));
      const h = Math.max(2, Math.min(40, Math.round(start.h + (ev.clientY - start.y) / (ROW + GAP))));
      if (w === section.w && h === section.h) return;
      section.w = w;
      section.h = h;
      preview(kit, section);
    }, () => {
      el.classList.remove('moving');
      compact(kit.sections, null);
      saveSections(kit, true);
      renderBoard();
    });
  }

  window.addEventListener('resize', () => { if (activeKit()) renderBoard(); });

  // ---------- Section menu ----------

  function openSectionMenu(kit, section, anchor) {
    const menu = $('#section-menu');
    menu.textContent = '';
    const add = (label, fn, cls = '') => {
      const b = document.createElement('button');
      b.textContent = label;
      if (cls) b.className = cls;
      b.addEventListener('click', () => { menu.classList.add('hidden'); fn(); });
      menu.appendChild(b);
    };
    const heading = (text) => {
      const h = document.createElement('div');
      h.className = 'menu-heading';
      h.textContent = text;
      menu.appendChild(h);
    };
    add('＋ Add from library…', () => openDrawer(section.id));
    add('Rename…', () => renameSection(kit, section));
    heading('Item size');
    for (const [size, label] of [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']]) {
      add(`${section.size === size ? '✓ ' : '   '}${label}`, () => { section.size = size; saveSections(kit, true); renderBoard(); });
    }
    heading('Meant for');
    for (const kind of ['clips', 'full', 'bashes', 'mixed']) {
      add(`${section.kind === kind ? '✓ ' : '   '}${KIND_LABEL[kind]}`, () => { section.kind = kind; saveSections(kit, true); });
    }
    add('Remove section', () => {
      const n = section.items.length;
      if (n && !confirm(`Remove the “${section.title}” section and its ${n} item(s) from this kit? They stay in your library.`)) return;
      kit.sections = kit.sections.filter((s) => s !== section);
      compact(kit.sections, null);
      saveSections(kit, true);
      render();
    }, 'danger');
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${Math.min(window.innerWidth - 200, rect.left)}px`;
    menu.style.top = `${Math.min(window.innerHeight - 360, rect.bottom + 4)}px`;
    menu.classList.remove('hidden');
  }

  // Electron has no window.prompt(), so use a small dialog.
  async function askText(title, value) {
    const dialog = $('#text-dialog');
    $('#text-dialog-title').textContent = title;
    $('#text-dialog-input').value = value;
    dialog.returnValue = '';
    dialog.showModal();
    $('#text-dialog-input').select();
    await new Promise((resolve) => dialog.addEventListener('close', resolve, { once: true }));
    return dialog.returnValue === 'save' ? $('#text-dialog-input').value.trim() : null;
  }

  async function renameSection(kit, section) {
    const name = await askText('Section name', section.title);
    if (!name) return;
    section.title = name.slice(0, 40);
    saveSections(kit, true);
    renderBoard();
  }

  function addSection(kit) {
    const bottom = kit.sections.reduce((max, s) => Math.max(max, s.y + s.h), 0);
    const id = crypto.randomUUID ? crypto.randomUUID() : `s${Date.now()}${Math.random().toString(16).slice(2)}`;
    const section = { id, title: 'New Section', kind: 'mixed', x: 0, y: bottom, w: 6, h: 6, size: 'm', items: [] };
    kit.sections.push(section);
    editing = true;
    saveSections(kit, true);
    render();
    const node = $('#kit-board').querySelector(`.kit-section[data-id="${section.id}"]`);
    if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    renameSection(kit, section);
  }

  // ---------- Library drawer ----------

  function openDrawer(sectionId) {
    const kit = activeKit();
    if (!kit) return;
    const section = kit.sections.find((s) => s.id === sectionId) || kit.sections[0];
    if (!section) { addSection(kit); return; }
    const changedTarget = drawer.target !== section.id;
    drawer.open = true;
    drawer.target = section.id;
    if (changedTarget) drawer.type = section.kind === 'mixed' ? 'all' : section.kind;
    $('#kit-drawer').classList.remove('hidden');
    renderBoard();
    $('#drawer-search').focus();
  }

  function closeDrawer(rerender = true) {
    drawer.open = false;
    $('#kit-drawer').classList.add('hidden');
    if (rerender) renderBoard();
  }

  function renderDrawer() {
    const kit = activeKit();
    if (!kit) return;
    const section = kit.sections.find((s) => s.id === drawer.target) || kit.sections[0];
    if (!section) { closeDrawer(); return; }
    drawer.target = section.id;

    const select = $('#drawer-target');
    select.textContent = '';
    for (const s of kit.sections) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.title;
      select.appendChild(opt);
    }
    select.value = section.id;

    for (const b of document.querySelectorAll('#drawer-types button')) b.classList.toggle('active', b.dataset.type === drawer.type);

    const tagHost = $('#drawer-tags');
    tagHost.textContent = '';
    for (const tag of Tags.list().all) {
      if (!sounds.some((s) => (s.tags || []).includes(tag))) continue;
      tagHost.appendChild(Tags.chip(tag, {
        small: true,
        selected: drawer.tags.has(tag),
        onClick: () => { if (drawer.tags.has(tag)) drawer.tags.delete(tag); else drawer.tags.add(tag); renderDrawer(); },
      }));
    }

    const search = drawer.search.trim().toLowerCase();
    const rows = [
      ...bashList().map((b) => ({ type: 'bash', id: b.id, kind: 'bashes', name: b.name, tags: [], meta: `${b.clips.length} sound${b.clips.length === 1 ? '' : 's'}` })),
      ...sounds.map((s) => ({ type: 'sound', id: s.id, kind: isFull(s) ? 'full' : 'clips', name: s.name, tags: s.tags || [], meta: s.duration ? AudioUtils.formatTime(s.duration).replace(/\.\d$/, '') : '' })),
    ].filter((r) => (drawer.type === 'all' || r.kind === drawer.type)
      && (!search || r.name.toLowerCase().includes(search) || r.tags.some((t) => t.includes(search)))
      && (!drawer.tags.size || r.tags.some((t) => drawer.tags.has(t))));

    const host = $('#drawer-list');
    const scroll = host.scrollTop;
    host.textContent = '';
    for (const row of rows) {
      const added = inSection(section, row.type, row.id);
      const el = document.createElement('div');
      el.className = 'drawer-row' + (added ? ' added' : '');
      el.draggable = true;
      el.title = added ? `In “${section.title}”. Click to remove.` : `Click to add to “${section.title}”, or drag onto any section.`;
      const icon = document.createElement('span');
      icon.className = `kind-icon kind-${row.kind}`;
      icon.textContent = row.kind === 'bashes' ? '⚡' : row.kind === 'full' ? '♫' : '✂';
      const info = document.createElement('div');
      info.className = 'drawer-info';
      const name = document.createElement('div');
      name.className = 'drawer-name';
      name.textContent = row.name;
      const sub = document.createElement('div');
      sub.className = 'tag-line';
      for (const t of row.tags.slice(0, 3)) sub.appendChild(Tags.chip(t, { small: true }));
      const meta = document.createElement('span');
      meta.className = 'muted small mono';
      meta.textContent = row.meta;
      sub.appendChild(meta);
      info.append(name, sub);
      const action = document.createElement('span');
      action.className = 'drawer-action';
      action.textContent = added ? '✓' : '＋';
      el.append(icon, info, action);
      el.addEventListener('click', () => {
        if (inSection(section, row.type, row.id)) section.items = section.items.filter((i) => !(i.type === row.type && i.id === row.id));
        else section.items.push({ type: row.type, id: row.id });
        saveSections(kit);
        render();
      });
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-kit-item', JSON.stringify({ type: row.type, id: row.id }));
        e.dataTransfer.effectAllowed = 'copy';
      });
      host.appendChild(el);
    }
    if (!rows.length) host.innerHTML = '<p class="muted small" style="padding:12px">Nothing matches. Try another type or clear the tag filters.</p>';
    host.scrollTop = scroll;
  }

  $('#drawer-close').addEventListener('click', () => closeDrawer());
  $('#drawer-target').addEventListener('change', (e) => {
    const kit = activeKit();
    const section = kit && kit.sections.find((s) => s.id === e.target.value);
    if (!section) return;
    drawer.target = section.id;
    drawer.type = section.kind === 'mixed' ? 'all' : section.kind;
    renderBoard();
  });
  $('#drawer-search').addEventListener('input', (e) => { drawer.search = e.target.value; renderDrawer(); });
  for (const b of document.querySelectorAll('#drawer-types button')) {
    b.addEventListener('click', () => { drawer.type = b.dataset.type; renderDrawer(); });
  }

  // ---------- Edit / new kit dialog ----------

  async function editKit(kit) {
    const dialog = $('#kit-dialog');
    let icon = kit ? kit.icon : icons[list.length % icons.length];
    let color = kit ? kit.color : colors[list.length % colors.length];
    $('#kit-dialog-title').textContent = kit ? 'Edit Scene Kit' : 'New Scene Kit';
    $('#kit-name').value = kit ? kit.name : '';
    $('#kit-name').placeholder = 'e.g. Tavern Brawl, Dragon’s Lair, Haunted Forest';
    const iconGrid = $('#kit-icons');
    const colorGrid = $('#kit-colors');
    const draw = () => {
      iconGrid.textContent = '';
      for (const i of icons) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'icon-choice' + (i === icon ? ' selected' : '');
        b.textContent = i;
        b.addEventListener('click', () => { icon = i; draw(); });
        iconGrid.appendChild(b);
      }
      colorGrid.textContent = '';
      for (const c of colors) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'swatch' + (c === color ? ' selected' : '');
        b.style.background = c;
        b.addEventListener('click', () => { color = c; draw(); });
        colorGrid.appendChild(b);
      }
      $('#kit-preview').replaceChildren(badge({ icon, color }, 'large'));
    };
    draw();
    dialog.returnValue = '';
    dialog.showModal();
    $('#kit-name').focus();
    await new Promise((resolve) => dialog.addEventListener('close', resolve, { once: true }));
    if (dialog.returnValue !== 'save') return null;
    const name = $('#kit-name').value.trim() || (kit ? kit.name : undefined);
    const saved = kit
      ? await api.kits.update(kit.id, { name, icon, color })
      : await api.kits.update((await api.kits.create({ name })).id, { icon, color });
    await refreshKits();
    return saved;
  }

  // ---------- Add one item (from a sound's editor or a bash's menu) ----------

  async function chooseKitFor(item, label) {
    const dialog = $('#kit-choose-dialog');
    $('#kit-choose-title').textContent = `Add “${label}” to a Scene Kit`;
    const host = $('#kit-choose-list');
    host.textContent = '';
    let chosen = null;
    for (const kit of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'kit-choice';
      const already = allItems(kit).some((i) => i.type === item.type && i.id === item.id);
      b.disabled = already;
      b.appendChild(badge(kit));
      const name = document.createElement('span');
      name.textContent = kit.name;
      b.appendChild(name);
      if (already) {
        const note = document.createElement('span');
        note.className = 'muted small';
        note.textContent = 'already added';
        b.appendChild(note);
      }
      b.addEventListener('click', () => { chosen = kit; dialog.close('pick'); });
      host.appendChild(b);
    }
    const create = document.createElement('button');
    create.type = 'button';
    create.className = 'kit-choice new';
    create.textContent = '+ New Scene Kit…';
    create.addEventListener('click', () => { chosen = 'new'; dialog.close('pick'); });
    host.appendChild(create);
    dialog.returnValue = '';
    dialog.showModal();
    await new Promise((resolve) => dialog.addEventListener('close', resolve, { once: true }));
    if (!chosen) return;
    const kit = chosen === 'new' ? await editKit(null) : chosen;
    if (!kit) return;
    await api.kits.addItems(kit.id, [item]);
    await refreshKits();
    toast(`Added “${label}” to ${kit.name}.`);
  }

  // ---------- Kit menu and header actions ----------

  let menuFor = null;
  function openKitMenu(id, anchor) {
    menuFor = id;
    const menu = $('#kit-menu');
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${Math.min(window.innerWidth - 180, rect.left + 20)}px`;
    menu.style.top = `${rect.bottom + 2}px`;
    menu.classList.remove('hidden');
  }

  async function runAction(action, id) {
    const kit = list.find((k) => k.id === id);
    if (!kit) return;
    if (action === 'add' || action === 'library') {
      if (activeId() !== id) open(id);
      if (drawer.open && action === 'library') closeDrawer(); else openDrawer(drawer.target);
    }
    if (action === 'layout') { editing = !editing; render(); }
    if (action === 'section') addSection(kit);
    if (action === 'edit') await editKit(kit);
    if (action === 'duplicate') { const copy = await api.kits.duplicate(id); await refreshKits(); open(copy.id); }
    if (action === 'delete' && confirm(`Delete the scene kit “${kit.name}”? The sounds and bashes in it stay in your library.`)) {
      await api.kits.remove(id);
      if (activeId() === id) { prefs.view = 'all'; savePrefs(); }
      await refreshKits();
    }
  }

  $('#kit-menu').addEventListener('click', (e) => {
    const action = e.target.dataset.action;
    const id = menuFor;
    $('#kit-menu').classList.add('hidden');
    if (action && id) runAction(action, id);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#kit-menu')) $('#kit-menu').classList.add('hidden');
    if (!e.target.closest('#section-menu, .section-more')) $('#section-menu').classList.add('hidden');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    $('#kit-menu').classList.add('hidden');
    $('#section-menu').classList.add('hidden');
  });

  $('#kit-new').addEventListener('click', async () => {
    const kit = await editKit(null);
    if (kit) open(kit.id);
  });
  for (const btn of document.querySelectorAll('[data-kit-action]')) {
    btn.addEventListener('click', () => { const kit = activeKit(); if (kit) runAction(btn.dataset.kitAction, kit.id); });
  }

  // "Add to Scene Kit…" in the sound editor.
  $('#edit-kit').addEventListener('click', () => {
    const sound = sounds.find((s) => s.id === editingId);
    if (sound) chooseKitFor({ type: 'sound', id: sound.id }, sound.name);
  });

  async function refreshKits() {
    await load();
    render();
  }

  api.kits.onChanged((next) => { list = next; render(); });

  return {
    load,
    activeKit,
    renderSidebar,
    renderHeader,
    renderBoard,
    chooseKitFor,
    // From a bash card's menu while viewing a kit: take it out of every section.
    async removeFromActive(type, id) {
      const kit = activeKit();
      if (!kit) return;
      await api.kits.removeItem(kit.id, { type, id });
      await refreshKits();
    },
  };
})();
