/* global api, $, sounds, prefs, savePrefs, render, toast, isFull, editingId, AudioUtils, Tags */
// Scene Kits: named collections of sounds and bashes from the whole library.
const Kits = (() => {
  let list = [];
  let icons = [];
  let colors = [];
  let bashes = [];
  let menuFor = null;

  const activeId = () => (String(prefs.view).startsWith('kit:') ? prefs.view.slice(4) : null);
  const activeKit = () => list.find((k) => k.id === activeId()) || null;
  const has = (kit, type, id) => !!kit && kit.items.some((i) => i.type === type && i.id === id);

  async function load() {
    const result = await api.kits.list();
    list = result.kits;
    icons = result.icons;
    colors = result.colors;
    bashes = await api.bashes.list();
    // Viewing a kit that no longer exists: fall back to the whole library.
    if (activeId() && !activeKit()) { prefs.view = 'all'; savePrefs(); }
  }

  function counts(kit) {
    const ids = new Set(sounds.map((s) => s.id));
    const bashIds = new Set(bashes.map((b) => b.id));
    let clips = 0;
    let full = 0;
    let bashCount = 0;
    for (const item of kit.items) {
      if (item.type === 'bash') { if (bashIds.has(item.id)) bashCount++; continue; }
      if (!ids.has(item.id)) continue;
      if (isFull(sounds.find((s) => s.id === item.id))) full++; else clips++;
    }
    return { clips, full, bashes: bashCount, total: clips + full + bashCount };
  }

  function describe(c) {
    const parts = [];
    if (c.clips) parts.push(`${c.clips} clip${c.clips > 1 ? 's' : ''}`);
    if (c.full) parts.push(`${c.full} full sound${c.full > 1 ? 's' : ''}`);
    if (c.bashes) parts.push(`${c.bashes} bash${c.bashes > 1 ? 'es' : ''}`);
    return parts.join(' · ') || 'Empty';
  }

  function badge(kit, size = 'small') {
    const el = document.createElement('span');
    el.className = `kit-badge ${size}`;
    el.style.setProperty('--kit-color', kit.color);
    el.textContent = kit.icon;
    return el;
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
      btn.addEventListener('contextmenu', (e) => { e.preventDefault(); openMenu(kit.id, btn); });
      host.appendChild(btn);
    }
  }

  function open(id) {
    prefs.view = `kit:${id}`;
    savePrefs();
    render();
    $('#content').scrollTop = 0;
  }

  // ---------- Kit page header ----------

  function renderHeader() {
    const kit = activeKit();
    const header = $('#kit-header');
    header.classList.toggle('hidden', !kit);
    if (!kit) return;
    header.style.setProperty('--kit-color', kit.color);
    $('#kit-header-badge').replaceChildren(badge(kit, 'large'));
    $('#kit-header-name').textContent = kit.name;
    const c = counts(kit);
    $('#kit-header-meta').textContent = describe(c);
    $('#kit-empty').classList.toggle('hidden', c.total > 0);
  }

  // ---------- Edit / new kit dialog ----------

  async function editKit(kit) {
    const dialog = $('#kit-dialog');
    let icon = kit ? kit.icon : icons[list.length % icons.length];
    let color = kit ? kit.color : colors[list.length % colors.length];
    $('#kit-dialog-title').textContent = kit ? 'Edit Scene Kit' : 'New Scene Kit';
    $('#kit-name').value = kit ? kit.name : '';
    $('#kit-name').placeholder = 'e.g. Tavern Brawl, Dragon’s Lair, Haunted Forest';
    const preview = () => $('#kit-preview').replaceChildren(badge({ icon, color }, 'large'));
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
      preview();
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

  // ---------- Add from library ----------

  async function addFromLibrary(kit) {
    bashes = await api.bashes.list();
    const dialog = $('#kit-add-dialog');
    const selected = new Set(kit.items.map((i) => `${i.type}:${i.id}`));
    let filter = 'all';
    $('#kit-add-title').textContent = `Add to “${kit.name}”`;
    $('#kit-add-search').value = '';

    const rows = () => {
      const search = $('#kit-add-search').value.trim().toLowerCase();
      const items = [
        ...bashes.map((b) => ({ key: `bash:${b.id}`, type: 'bash', name: b.name, kind: 'bash', tags: [], meta: `${b.clips.length} sound${b.clips.length === 1 ? '' : 's'}` })),
        ...sounds.map((s) => ({ key: `sound:${s.id}`, type: 'sound', name: s.name, kind: isFull(s) ? 'full' : 'clip', tags: s.tags || [], meta: s.duration ? AudioUtils.formatTime(s.duration) : '' })),
      ];
      return items.filter((i) => (filter === 'all' || i.kind === filter)
        && (!search || i.name.toLowerCase().includes(search) || i.tags.some((t) => t.includes(search))));
    };

    const draw = () => {
      const host = $('#kit-add-list');
      host.textContent = '';
      const visible = rows();
      for (const item of visible) {
        const label = document.createElement('label');
        label.className = 'kit-add-row' + (selected.has(item.key) ? ' checked' : '');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = selected.has(item.key);
        box.addEventListener('change', () => {
          if (box.checked) selected.add(item.key); else selected.delete(item.key);
          label.classList.toggle('checked', box.checked);
          updateCount();
        });
        const type = document.createElement('span');
        type.className = `kind-icon kind-${item.kind}`;
        type.textContent = item.kind === 'bash' ? '⚡' : item.kind === 'full' ? '♫' : '✂';
        type.title = item.kind === 'bash' ? 'Bash' : item.kind === 'full' ? 'Full sound' : 'Clip';
        const name = document.createElement('span');
        name.className = 'kit-add-name';
        name.textContent = item.name;
        const tags = document.createElement('span');
        tags.className = 'tag-line';
        for (const t of item.tags.slice(0, 3)) tags.appendChild(Tags.chip(t, { small: true }));
        const meta = document.createElement('span');
        meta.className = 'muted small mono';
        meta.textContent = item.meta;
        label.append(box, type, name, tags, meta);
        host.appendChild(label);
      }
      if (!visible.length) host.innerHTML = '<p class="muted small" style="padding:12px">Nothing matches.</p>';
      for (const b of document.querySelectorAll('#kit-add-filter button')) b.classList.toggle('active', b.dataset.filter === filter);
      updateCount();
    };
    const updateCount = () => { $('#kit-add-count').textContent = `${selected.size} selected`; };

    for (const b of document.querySelectorAll('#kit-add-filter button')) b.onclick = () => { filter = b.dataset.filter; draw(); };
    $('#kit-add-search').oninput = draw;
    draw();
    dialog.returnValue = '';
    dialog.showModal();
    $('#kit-add-search').focus();
    await new Promise((resolve) => dialog.addEventListener('close', resolve, { once: true }));
    if (dialog.returnValue !== 'save') return;
    // Keep the existing order, then append newly picked items.
    const kept = kit.items.filter((i) => selected.has(`${i.type}:${i.id}`));
    const keptKeys = new Set(kept.map((i) => `${i.type}:${i.id}`));
    const added = [...selected].filter((k) => !keptKeys.has(k)).map((k) => ({ type: k.slice(0, k.indexOf(':')), id: k.slice(k.indexOf(':') + 1) }));
    await api.kits.update(kit.id, { items: [...kept, ...added] });
    await refreshKits();
    if (added.length) toast(`Added ${added.length} item${added.length > 1 ? 's' : ''} to ${kit.name}.`);
  }

  // ---------- Pick a kit for one item (from a sound or bash) ----------

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
      const already = has(kit, item.type, item.id);
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

  // ---------- Kit menu (sidebar right-click and header) ----------

  function openMenu(id, anchor) {
    menuFor = id;
    const menu = $('#kit-menu');
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${Math.min(window.innerWidth - 180, rect.left + 20)}px`;
    menu.style.top = `${rect.bottom + 2}px`;
    menu.classList.remove('hidden');
  }
  function closeMenu() { $('#kit-menu').classList.add('hidden'); menuFor = null; }

  async function runAction(action, id) {
    const kit = list.find((k) => k.id === id);
    if (!kit) return;
    if (action === 'add') await addFromLibrary(kit);
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
    closeMenu();
    if (action && id) runAction(action, id);
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('#kit-menu')) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  $('#kit-new').addEventListener('click', async () => {
    const kit = await editKit(null);
    if (kit) { open(kit.id); await addFromLibrary(kit); }
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
  api.bashes.onChanged((next) => { bashes = next; });

  return {
    load,
    activeKit,
    has: (type, id) => has(activeKit(), type, id),
    renderSidebar,
    renderHeader,
    chooseKitFor,
    async removeFromActive(type, id) {
      const kit = activeKit();
      if (!kit) return;
      await api.kits.removeItem(kit.id, { type, id });
      await refreshKits();
    },
  };
})();
