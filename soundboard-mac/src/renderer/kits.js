/* global api, $, Icons, IconPicker, Ambience, Music, sounds, prefs, savePrefs, render, toast, isFull, editingId, AudioUtils, Tags, Bashes, makeTile, makeTrack, matchesFilters */
// Scene Kits: customizable boards of sections holding sounds and bashes
// from the whole library. Sections live on a 12-column grid and can be
// moved and resized in "Customize Layout" mode. Ambience sections hold
// looping layers that play through the Ambience engine.
const Kits = (() => {
  const ROW = 34; // px per grid row
  const GAP = 12; // px between grid cells
  const KINDS = { bashes: ['bolt', 'Bashes'], clips: ['scissors', 'Clips'], full: ['note', 'Full sounds'], mixed: ['grid', 'Anything'] };
  const isAmbience = (section) => section.kind === 'ambience';

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
  const allLayers = (kit) => kit.sections.flatMap((s) => s.layers || []);
  // A section's volume slider (1 when it has none).
  const gainOf = (section) => section.volume ?? 1;
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
    const layers = allLayers(kit).length;
    return { clips, full, bashes, layers, total: clips + full + bashes + layers };
  }

  function describe(c) {
    const parts = [];
    if (c.clips) parts.push(`${c.clips} clip${c.clips > 1 ? 's' : ''}`);
    if (c.full) parts.push(`${c.full} full sound${c.full > 1 ? 's' : ''}`);
    if (c.bashes) parts.push(`${c.bashes} bash${c.bashes > 1 ? 'es' : ''}`);
    if (c.layers) parts.push(`${c.layers} ambience layer${c.layers > 1 ? 's' : ''}`);
    return parts.join(' · ') || 'Empty — add sounds from your library';
  }

  function badge(kit, size = 'small') {
    const el = document.createElement('span');
    el.className = `kit-badge ${size}`;
    el.style.setProperty('--kit-color', kit.color);
    el.appendChild(Icons.el(kit.icon, { size: size === 'large' ? 44 : 15, color: kit.iconColor || '#ffffff' }));
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

  // options.scene: false opens it without its scene change (a bookmark brings
  // back its own music and ambience).
  function open(id, options = {}) {
    const changed = activeId() !== id;
    if (changed) { editing = false; closeDrawer(false); }
    prefs.view = `kit:${id}`;
    savePrefs();
    // A kit set to start its music and ambience: the scene changes.
    const kit = activeKit();
    if (changed && kit && kit.autoplay && options.scene !== false) Music.sceneOpened(kit, voiceId);
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
    if (editing) $('#kit-layout-btn').textContent = 'Done';
    else Icons.set($('#kit-layout-btn'), 'grid', 'Customize Layout');
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
    document.body.classList.toggle('kit-open', !!kit);
    syncDock();
    if (!kit) return;
    board.classList.toggle('editing', editing);
    board.textContent = '';
    board.style.height = `${boardHeight(kit)}px`;
    for (const section of kit.sections) board.appendChild(makeSection(kit, section));
    if (typeof Bashes !== 'undefined') Bashes.refreshPlaying();
    if (drawer.open) renderDrawer();
  }

  function syncDock() {
    if (typeof Ambience !== 'undefined') Ambience.syncDock();
  }

  function makeSection(kit, section) {
    const el = document.createElement('section');
    el.className = `kit-section size-${section.size}` + (isAmbience(section) ? ' ambience-section' : '') + (drawer.open && drawer.target === section.id ? ' targeted' : '');
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
    count.textContent = (isAmbience(section) ? section.layers.length : section.items.length) || '';
    const add = document.createElement('button');
    add.className = 'mini section-add';
    Icons.set(add, 'plus', 'Add', { size: 12 });
    add.title = isAmbience(section) ? 'Add looping layers to this section' : 'Add sounds and bashes to this section';
    add.addEventListener('click', (e) => { e.stopPropagation(); openDrawer(section.id); });
    // A shuffle button: a random item from the section.
    const shuffle = !isAmbience(section) && section.shuffle ? document.createElement('button') : null;
    if (shuffle) {
      shuffle.className = 'mini section-shuffle';
      Icons.set(shuffle, 'shuffle', '', { size: 13 });
      shuffle.title = 'Play a random item from this section';
      shuffle.setAttribute('aria-label', 'Play a random item');
      shuffle.disabled = !section.items.length;
      shuffle.addEventListener('click', (e) => { e.stopPropagation(); shufflePlay(section); });
    }
    const more = document.createElement('button');
    more.className = 'mini section-more';
    Icons.set(more, 'more', '', { size: 14 });
    more.title = 'Section options';
    more.addEventListener('click', (e) => { e.stopPropagation(); openSectionMenu(kit, section, more); });
    if (!isAmbience(section) && section.playlist) {
      title.prepend(Icons.el('note', { size: 14, className: 'section-kind-icon' }));
      const on = Music.isPlaying(section.id);
      const songs = Music.songsIn(section).length;
      const toggle = document.createElement('button');
      toggle.className = 'mini section-playlist' + (on ? ' on' : '');
      Icons.set(toggle, on ? 'stop' : 'play', on ? 'Stop' : 'Play', { size: 11 });
      toggle.title = on ? 'Fade out the playlist' : (section.playlistShuffle ? 'Play the songs in a random order, one after another' : 'Play the songs in order, one after another');
      toggle.disabled = !songs;
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        if (Music.isPlaying(section.id)) Music.stop(section.id, 2); else Music.start(kit, section);
      });
      head.append(title, count, toggle, ...(shuffle ? [shuffle] : []), add, more);
    } else if (isAmbience(section)) {
      title.prepend(Icons.el('layers', { size: 14, className: 'section-kind-icon' }));
      const stop = document.createElement('button');
      stop.className = 'mini section-stop';
      Icons.set(stop, 'stop', 'Stop', { size: 11 });
      stop.title = 'Fade out every layer in this section';
      stop.disabled = !section.layers.some((l) => Ambience.isPlaying(voiceId(section, l)));
      stop.addEventListener('click', (e) => {
        e.stopPropagation();
        for (const l of section.layers) { Ambience.stop(voiceId(section, l)); delete l.on; }
        saveSections(kit);
      });
      head.append(title, count, stop, add, more);
    } else {
      head.append(title, count, ...(shuffle ? [shuffle] : []), add, more);
    }
    head.addEventListener('pointerdown', (e) => {
      if (!editing || e.button !== 0 || e.target.closest('button')) return;
      startMove(e, kit, section, el);
    });

    const body = document.createElement('div');
    body.className = 'kit-section-body';
    if (isAmbience(section)) fillAmbience(kit, section, body); else fillSection(kit, section, body);

    el.append(head);
    if (section.volume !== undefined) el.append(volumeRow(kit, section));
    el.append(body);
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
      if (types.includes('application/x-kit-item') || (isAmbience(section) && types.includes('application/x-kit-layer'))) {
        e.preventDefault();
        el.classList.add('drop-hover');
      }
    });
    el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('drop-hover'); });
    el.addEventListener('drop', (e) => {
      el.classList.remove('drop-hover');
      if (isAmbience(section)) { dropOnAmbience(e, kit, section); return; }
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
      Icons.set(empty, 'plus', 'Add from your library', { size: 16 });
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
      for (const { item, bash } of bashItems) wrap.appendChild(decorate(Bashes.makeCard(bash, { gain: gainOf(section) }), kit, section, item));
      body.appendChild(wrap);
    }
    if (clipItems.length) {
      const grid = document.createElement('div');
      grid.className = 'section-clips';
      for (const { item, sound } of clipItems) grid.appendChild(decorate(makeTile(sound, { reorder: false, gain: gainOf(section) }), kit, section, item));
      body.appendChild(grid);
    }
    if (fullItems.length) {
      const rows = document.createElement('div');
      rows.className = 'section-full';
      for (const { item, sound } of fullItems) {
        // In a playlist, a song starts the playlist from it (or stops it, if it's the one playing).
        const onPlay = section.playlist ? () => {
          if (Music.current(section.id) === sound.id) Music.stop(section.id, 2);
          else Music.start(kit, section, sound.id);
        } : null;
        const row = makeTrack(sound, { reorder: false, onPlay, gain: gainOf(section) });
        if (section.playlist && Music.current(section.id) === sound.id) row.classList.add('playlist-current');
        rows.appendChild(decorate(row, kit, section, item));
      }
      body.appendChild(rows);
    }
  }

  // Adds the remove button and drag-between-sections to an item.
  function decorate(el, kit, section, item) {
    const remove = document.createElement('button');
    remove.className = 'kit-remove';
    Icons.set(remove, 'close', '', { size: 10 });
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

  // ---------- Ambience sections ----------

  // Voices are named per section, so one loop can play in two kits at once.
  const voiceId = (section, layer) => `kit-${section.id}-${layer.id}`;
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `l${Date.now()}${Math.random().toString(16).slice(2)}`);

  // A fitting icon for a built-in loop, from its file name.
  function layerIcon(layer) {
    if (layer.kind === 'sound') return 'note';
    const name = layer.ref;
    const match = [['thunder', 'storm'], ['storm', 'wave'], ['rain', 'rain'], ['wind', 'wind'], ['ocean', 'wave'], ['sea', 'wave'],
      ['campfire', 'campfire'], ['fire', 'flame'], ['cave', 'cave'], ['night', 'moon'], ['forest', 'pine'], ['drone', 'eye']];
    return (match.find(([word]) => name.includes(word)) || [null, 'layers'])[1];
  }

  function hasLayer(section, kind, ref) {
    return section.layers.some((l) => l.kind === kind && l.ref === ref);
  }

  function addLayer(kit, section, kind, ref) {
    if (hasLayer(section, kind, ref)) return;
    section.layers.push({ id: newId(), kind, ref, volume: 0.7 });
    saveSections(kit, true);
  }

  function removeLayer(kit, section, layer) {
    Ambience.stop(voiceId(section, layer));
    section.layers = section.layers.filter((l) => l !== layer);
    saveSections(kit, true);
  }

  function dropOnAmbience(e, kit, section) {
    const rawLayer = e.dataTransfer.getData('application/x-kit-layer');
    const rawItem = e.dataTransfer.getData('application/x-kit-item');
    if (rawLayer) {
      e.preventDefault();
      const { kind, ref } = JSON.parse(rawLayer);
      addLayer(kit, section, kind, ref);
    } else if (rawItem) {
      const { type, id } = JSON.parse(rawItem);
      if (type !== 'sound') { toast('Bashes can’t be ambience layers. Drop a sound or a built-in loop here.', true); return; }
      e.preventDefault();
      addLayer(kit, section, 'sound', id);
    }
    render();
  }

  function fillAmbience(kit, section, body) {
    const soundIds = new Set(sounds.map((s) => s.id));
    const layers = section.layers.filter((l) => l.kind === 'builtin' || soundIds.has(l.ref));
    if (!layers.length) {
      const empty = document.createElement('button');
      empty.className = 'section-empty';
      Icons.set(empty, 'layers', 'Add rain, wind, a campfire or your own loops', { size: 16 });
      empty.addEventListener('click', () => openDrawer(section.id));
      body.appendChild(empty);
      return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'section-layers';
    for (const layer of layers) {
      const id = voiceId(section, layer);
      const on = Ambience.isPlaying(id);
      const card = document.createElement('div');
      card.className = 'kit-layer' + (on ? ' on' : '');
      card.dataset.layer = layer.id;

      const toggle = document.createElement('button');
      toggle.className = 'kit-layer-toggle';
      toggle.title = on ? 'Click to fade out' : 'Click to fade in';
      toggle.append(Icons.el(layerIcon(layer), { size: 20, className: 'kit-layer-icon' }));
      const name = document.createElement('span');
      name.className = 'kit-layer-name';
      name.textContent = Ambience.layerName(layer);
      const status = document.createElement('span');
      status.className = 'kit-layer-status';
      status.textContent = on ? (layer.every ? 'Now and then' : 'Playing') : 'Off';
      if (layer.every) status.append(Ambience.everyBadge(layer.every));
      const text = document.createElement('span');
      text.className = 'kit-layer-text';
      text.append(name, status);
      toggle.append(text);
      toggle.addEventListener('click', () => {
        // Remembered, so the kit can bring back the same layers when it opens.
        if (Ambience.isPlaying(id)) { Ambience.stop(id); delete layer.on; } else { Ambience.start(id, { kind: layer.kind, ref: layer.ref, volume: layer.volume * gainOf(section), every: layer.every }); layer.on = true; }
        saveSections(kit);
      });
      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        Ambience.cueMenu(layer.every, e, (every) => {
          if (every) layer.every = every; else delete layer.every;
          saveSections(kit, true);
          if (Ambience.isPlaying(id)) { Ambience.stop(id); Ambience.start(id, { kind: layer.kind, ref: layer.ref, volume: layer.volume * gainOf(section), every: layer.every }); }
          render();
        });
      });
      toggle.title += '. Right-click: loop or now and then.';

      const volume = document.createElement('input');
      volume.type = 'range';
      volume.min = 0;
      volume.max = 1;
      volume.step = 0.01;
      volume.value = layer.volume;
      volume.title = 'Layer volume';
      volume.addEventListener('input', () => {
        layer.volume = Number(volume.value);
        Ambience.setVolume(id, layer.volume * gainOf(section));
        saveSections(kit);
      });

      const remove = document.createElement('button');
      remove.className = 'kit-remove';
      Icons.set(remove, 'close', '', { size: 10 });
      remove.title = `Remove from “${section.title}”`;
      remove.addEventListener('click', (e) => { e.stopPropagation(); removeLayer(kit, section, layer); render(); });

      card.append(toggle, volume, remove);
      wrap.appendChild(card);
    }
    body.appendChild(wrap);
  }

  // A playlist started, moved on or stopped: refresh its section.
  Music.onChange(() => {
    const kit = activeKit();
    if (!kit) return;
    for (const section of kit.sections.filter((s) => s.playlist)) {
      const node = $('#kit-board').querySelector(`.kit-section[data-id="${section.id}"]`);
      if (node) node.replaceWith(makeSection(kit, section));
    }
  });

  // Playing state changes (from here, the dock, or a failed load).
  if (typeof Ambience !== 'undefined') {
    Ambience.onChange(() => {
      const kit = activeKit();
      if (!kit || !kit.sections.some(isAmbience)) return;
      for (const section of kit.sections.filter(isAmbience)) {
        const node = $('#kit-board').querySelector(`.kit-section[data-id="${section.id}"]`);
        if (!node) continue;
        const fresh = makeSection(kit, section);
        node.replaceWith(fresh);
      }
    });
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

  // The section's own volume: scales everything played from it.
  function volumeRow(kit, section) {
    const row = document.createElement('div');
    row.className = 'kit-section-volume';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = 0;
    slider.max = 1;
    slider.step = 0.01;
    slider.value = gainOf(section);
    slider.title = `${section.title} volume`;
    slider.setAttribute('aria-label', `${section.title} volume`);
    slider.addEventListener('pointerdown', (e) => e.stopPropagation());
    slider.addEventListener('input', () => {
      section.volume = Number(slider.value);
      applyGain(section);
      saveSections(kit);
    });
    row.append(Icons.el('speaker', { size: 12 }), slider);
    return row;
  }

  // Brings what's playing from a section to its volume slider's level.
  function applyGain(section) {
    const gain = gainOf(section);
    if (isAmbience(section)) {
      for (const layer of section.layers) {
        const id = voiceId(section, layer);
        if (Ambience.isPlaying(id)) Ambience.setVolume(id, layer.volume * gain);
      }
      return;
    }
    setPlayingGain(section.items.filter((i) => i.type === 'sound').map((i) => i.id), gain);
    Music.setGain(section.id, gain);
    const state = Bashes.player.state();
    if (state && section.items.some((i) => i.type === 'bash' && i.id === state.bashId)) Bashes.player.setGain(gain);
  }

  // Plays a random sound or bash from the section (not the same one twice in a row).
  const lastShuffled = new Map();
  function shufflePlay(section) {
    const bashesById = new Map(bashList().map((b) => [b.id, b]));
    const candidates = section.items.filter((i) => (i.type === 'bash' ? bashesById.has(i.id) : sounds.some((s) => s.id === i.id)));
    const last = lastShuffled.get(section.id);
    const fresh = candidates.length > 1 ? candidates.filter((i) => !(i.type === last?.type && i.id === last?.id)) : candidates;
    const pick = fresh[Math.floor(Math.random() * fresh.length)];
    if (!pick) return;
    lastShuffled.set(section.id, pick);
    if (pick.type === 'bash') Bashes.player.play(bashesById.get(pick.id), sounds, 0, gainOf(section));
    else play(pick.id, { gain: gainOf(section) });
  }

  function openSectionMenu(kit, section, anchor) {
    const menu = $('#section-menu');
    menu.textContent = '';
    const add = (label, fn, cls = '', icon = null) => {
      const b = document.createElement('button');
      if (icon) Icons.set(b, icon, label, { size: 13 }); else b.textContent = label;
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
    add(isAmbience(section) ? 'Add layers…' : 'Add from library…', () => openDrawer(section.id));
    add('Rename…', () => renameSection(kit, section));
    add('Volume slider', () => {
      if (section.volume === undefined) section.volume = 1; else delete section.volume;
      applyGain(section);
      saveSections(kit, true);
      renderBoard();
    }, section.volume !== undefined ? 'checked' : '');
    if (!isAmbience(section)) {
      add('Shuffle button', () => {
        if (section.shuffle) delete section.shuffle; else section.shuffle = true;
        saveSections(kit, true);
        renderBoard();
      }, section.shuffle ? 'checked' : '');
      heading('Item size');
      for (const [size, label] of [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']]) {
        add(label, () => { section.size = size; saveSections(kit, true); renderBoard(); }, section.size === size ? 'checked' : '');
      }
      heading('Meant for');
      for (const kind of ['clips', 'full', 'bashes', 'mixed']) {
        add(KINDS[kind][1], () => { section.kind = kind; saveSections(kit, true); }, section.kind === kind ? 'checked' : '', KINDS[kind][0]);
      }
      heading('Playlist');
      add('Play songs one after another', () => {
        if (section.playlist) { delete section.playlist; delete section.playlistShuffle; Music.stop(section.id, 2); } else section.playlist = true;
        saveSections(kit, true);
        renderBoard();
      }, section.playlist ? 'checked' : '');
      if (section.playlist) {
        add('Shuffle', () => {
          if (section.playlistShuffle) delete section.playlistShuffle; else section.playlistShuffle = true;
          saveSections(kit, true);
          renderBoard();
        }, section.playlistShuffle ? 'checked' : '');
      }
    }
    add('Remove section', () => {
      const n = isAmbience(section) ? section.layers.length : section.items.length;
      const what = isAmbience(section) ? 'layer(s)' : 'item(s)';
      if (n && !confirm(`Remove the “${section.title}” section and its ${n} ${what} from this kit? Your library isn't changed.`)) return;
      if (isAmbience(section)) for (const l of section.layers) Ambience.stop(voiceId(section, l));
      Music.stop(section.id, 1);
      kit.sections = kit.sections.filter((s) => s !== section);
      compact(kit.sections, null);
      saveSections(kit, true);
      render();
    }, 'danger');
    showMenuAt(menu, anchor);
  }

  function showMenuAt(menu, anchor) {
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${Math.min(window.innerWidth - 220, rect.left)}px`;
    menu.classList.remove('hidden');
    // Kept on screen: it scrolls if it's taller than the window.
    const height = menu.offsetHeight;
    menu.style.top = `${Math.max(8, Math.min(window.innerHeight - height - 8, rect.bottom + 4))}px`;
  }

  // "+ Section": a sound section or an ambience section.
  function openAddSectionMenu(kit, anchor) {
    const menu = $('#section-menu');
    menu.textContent = '';
    const option = (icon, label, hint, kind) => {
      const b = document.createElement('button');
      b.className = 'menu-option';
      Icons.set(b, icon, label, { size: 16 });
      const small = document.createElement('span');
      small.className = 'muted small menu-hint';
      small.textContent = hint;
      b.appendChild(small);
      b.addEventListener('click', () => { menu.classList.add('hidden'); addSection(kit, kind); });
      menu.appendChild(b);
    };
    option('grid', 'Sound section', 'Clips, full sounds and bashes', 'mixed');
    option('layers', 'Ambience section', 'Looping background layers', 'ambience');
    showMenuAt(menu, anchor);
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

  function addSection(kit, kind = 'mixed') {
    const bottom = kit.sections.reduce((max, s) => Math.max(max, s.y + s.h), 0);
    const ambience = kind === 'ambience';
    const section = { id: newId(), title: ambience ? 'Ambience' : 'New Section', kind, x: 0, y: bottom, w: ambience ? 12 : 6, h: ambience ? 5 : 6, size: 'm', items: [], layers: [] };
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
    if (changedTarget) drawer.type = ['mixed', 'ambience'].includes(section.kind) ? 'all' : section.kind;
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
      opt.textContent = isAmbience(s) ? `${s.title} (ambience)` : s.title;
      select.appendChild(opt);
    }
    select.value = section.id;

    $('#drawer-types').classList.toggle('hidden', isAmbience(section));
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
    if (isAmbience(section)) { renderAmbienceDrawer(kit, section, search); return; }
    $('.drawer-hint').textContent = 'Click to add or remove. You can also drag items onto any section.';
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
      icon.appendChild(Icons.el(KINDS[row.kind][0], { size: 15 }));
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
      Icons.set(action, added ? 'close' : 'plus', '', { size: 14 });
      action.title = added ? 'Remove' : 'Add';
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

  // The drawer for an ambience section: built-in loops, then library sounds.
  function renderAmbienceDrawer(kit, section, search) {
    $('.drawer-hint').textContent = 'Click to add or remove a layer. You can also drag them onto any ambience section.';
    const matches = (name, tags = []) => (!search || name.toLowerCase().includes(search) || tags.some((t) => t.includes(search)))
      && (!drawer.tags.size || tags.some((t) => drawer.tags.has(t)));
    const groups = [
      ['Built-in loops', Ambience.builtins().filter((b) => !drawer.tags.size && matches(b.name))
        .map((b) => ({ kind: 'builtin', ref: b.file, name: b.name, tags: [], meta: 'loop' }))],
      // Longer sounds first: they make better beds than one-shot effects.
      ['Your sounds', [...sounds].sort((a, b) => Number(isFull(b)) - Number(isFull(a)))
        .filter((s) => matches(s.name, s.tags || []))
        .map((s) => ({ kind: 'sound', ref: s.id, name: s.name, tags: s.tags || [], meta: s.duration ? AudioUtils.formatTime(s.duration).replace(/\.\d$/, '') : '' }))],
    ];
    const host = $('#drawer-list');
    const scroll = host.scrollTop;
    host.textContent = '';
    for (const [label, rows] of groups) {
      if (!rows.length) continue;
      const heading = document.createElement('div');
      heading.className = 'drawer-group';
      heading.textContent = label;
      host.appendChild(heading);
      for (const row of rows) {
        const added = hasLayer(section, row.kind, row.ref);
        const el = document.createElement('div');
        el.className = 'drawer-row' + (added ? ' added' : '');
        el.draggable = true;
        el.title = added ? `In “${section.title}”. Click to remove.` : `Click to add to “${section.title}”.`;
        const icon = document.createElement('span');
        icon.className = 'kind-icon kind-ambience';
        icon.appendChild(Icons.el(layerIcon(row), { size: 15 }));
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
        Icons.set(action, added ? 'close' : 'plus', '', { size: 14 });
        el.append(icon, info, action);
        el.addEventListener('click', () => {
          const existing = section.layers.find((l) => l.kind === row.kind && l.ref === row.ref);
          if (existing) removeLayer(kit, section, existing); else addLayer(kit, section, row.kind, row.ref);
          render();
        });
        el.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('application/x-kit-layer', JSON.stringify({ kind: row.kind, ref: row.ref }));
          e.dataTransfer.effectAllowed = 'copy';
        });
        host.appendChild(el);
      }
    }
    if (!host.children.length) host.innerHTML = '<p class="muted small" style="padding:12px">Nothing matches. Try another search or clear the tag filters.</p>';
    host.scrollTop = scroll;
  }

  $('#drawer-close').addEventListener('click', () => closeDrawer());
  $('#drawer-target').addEventListener('change', (e) => {
    const kit = activeKit();
    const section = kit && kit.sections.find((s) => s.id === e.target.value);
    if (!section) return;
    drawer.target = section.id;
    drawer.type = ['mixed', 'ambience'].includes(section.kind) ? 'all' : section.kind;
    renderBoard();
  });
  $('#drawer-search').addEventListener('input', (e) => { drawer.search = e.target.value; renderDrawer(); });
  for (const b of document.querySelectorAll('#drawer-types button')) {
    b.addEventListener('click', () => { drawer.type = b.dataset.type; renderDrawer(); });
  }

  // ---------- Edit / new kit dialog ----------

  async function editKit(kit) {
    const dialog = $('#kit-dialog');
    let choice = kit
      ? { icon: kit.icon, color: kit.color, iconColor: kit.iconColor || '#ffffff' }
      : { icon: icons[list.length % icons.length], color: colors[list.length % colors.length], iconColor: '#ffffff' };
    $('#kit-dialog-title').textContent = kit ? 'Edit Scene Kit' : 'New Scene Kit';
    $('#kit-name').value = kit ? kit.name : '';
    $('#kit-name').placeholder = 'e.g. Tavern Brawl, Dragon’s Lair, Haunted Forest';
    $('#kit-autoplay').checked = !!(kit && kit.autoplay);
    const preview = () => $('#kit-preview').replaceChildren(badge(choice, 'large'));
    const picker = IconPicker.create(choice, { backgrounds: colors, onChange: (value) => { choice = value; preview(); } });
    $('#kit-icon-picker').replaceChildren(picker.element);
    preview();
    dialog.returnValue = '';
    dialog.showModal();
    $('#kit-name').focus();
    await new Promise((resolve) => dialog.addEventListener('close', resolve, { once: true }));
    if (dialog.returnValue !== 'save') return null;
    const name = $('#kit-name').value.trim() || (kit ? kit.name : undefined);
    const { icon, color, iconColor } = choice;
    const autoplay = $('#kit-autoplay').checked;
    const saved = kit
      ? await api.kits.update(kit.id, { name, icon, color, iconColor, autoplay })
      : await api.kits.update((await api.kits.create({ name })).id, { icon, color, iconColor, autoplay });
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
    if (action === 'section') openAddSectionMenu(kit, document.querySelector('[data-kit-action="section"]'));
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
    if (!e.target.closest('#section-menu, .section-more, [data-kit-action="section"]')) $('#section-menu').classList.add('hidden');
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
    open,
    get: (id) => list.find((k) => k.id === id) || null,
    askText,
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
