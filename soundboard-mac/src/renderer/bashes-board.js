/* global api, $, sounds, toast, editingId, BashCommon, Kits */
// The Bashes row on the main board: cards with covers that play a whole bash.
const Bashes = (() => {
  const player = new BashCommon.BashPlayer(api);
  let list = [];
  let menuFor = null;
  let collapsed = false;
  try { collapsed = localStorage.getItem('bashesCollapsed') === '1'; } catch { /* ignore */ }

  function soundCount(bash) {
    const ids = new Set(sounds.map((s) => s.id));
    return bash.clips.filter((c) => ids.has(c.soundId)).length;
  }

  function render() {
    const host = $('#bash-list');
    host.textContent = '';
    host.classList.toggle('hidden', collapsed);
    $('#bash-collapse').textContent = `${collapsed ? '▸' : '▾'} Bashes`;

    // Inside a scene kit the board draws its own bash cards; this row is hidden.
    const kit = typeof Kits !== 'undefined' ? Kits.activeKit() : null;
    const shown = kit ? [] : list;
    if (!shown.length && !kit) {
      const empty = document.createElement('p');
      empty.className = 'muted small bash-empty';
      empty.textContent = 'No bashes yet. A bash layers several sounds and plays them with one click — try “Ambush!” with a war horn, shouting and clashing swords.';
      host.appendChild(empty);
    }

    for (const bash of shown) host.appendChild(makeCard(bash));
    updatePlaying();
    renderEditDialogSelect();
  }

  // One bash card; used on the board and inside scene kit sections.
  function makeCard(bash) {
    const card = document.createElement('div');
    card.className = 'bash-card';
    card.dataset.id = bash.id;
    card.tabIndex = 0;
    card.title = 'Click to play · double-click to edit';

    const cover = document.createElement('div');
    cover.className = 'bash-cover';
    BashCommon.renderCover(cover, bash, api);
    const play = document.createElement('div');
    play.className = 'bash-play';
    play.textContent = '▶';
    cover.appendChild(play);

    const info = document.createElement('div');
    info.className = 'bash-info';
    const name = document.createElement('div');
    name.className = 'bash-name';
    name.textContent = bash.name;
    const meta = document.createElement('div');
    meta.className = 'muted small';
    const count = soundCount(bash);
    meta.textContent = count ? `${count} sound${count > 1 ? 's' : ''}` : 'Empty — click ⋯ to edit';
    info.append(name, meta);

    const more = document.createElement('button');
    more.className = 'bash-more';
    more.textContent = '⋯';
    more.title = 'Edit, duplicate or delete';
    more.addEventListener('click', (e) => { e.stopPropagation(); openMenu(bash.id, more); });

    const progress = document.createElement('div');
    progress.className = 'bash-progress';

    card.append(cover, info, more, progress);
    card.addEventListener('click', () => toggle(bash.id));
    card.addEventListener('dblclick', (e) => { e.preventDefault(); player.stop(); api.bashes.openEditor(bash.id); });
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(bash.id); } });
    card.addEventListener('contextmenu', (e) => { e.preventDefault(); openMenu(bash.id, card); });
    const state = player.state();
    if (state && state.bashId === bash.id) card.classList.add('playing');
    return card;
  }

  async function toggle(id) {
    const state = player.state();
    if (state && state.bashId === id) { player.stop(); return; }
    const bash = list.find((b) => b.id === id);
    if (!bash) return;
    if (!soundCount(bash)) {
      api.bashes.openEditor(id);
      return;
    }
    await player.play(bash, sounds);
  }

  // Progress bar and ▶/■ on the playing card.
  let raf = null;
  function updatePlaying() {
    const state = player.state();
    for (const card of document.querySelectorAll('.bash-card')) {
      const playing = state && state.bashId === card.dataset.id;
      card.classList.toggle('playing', !!playing);
      card.querySelector('.bash-play').textContent = playing ? '■' : '▶';
      const endless = playing && !Number.isFinite(state.duration);
      card.classList.toggle('endless', !!endless);
      card.querySelector('.bash-progress').style.width = !playing ? '0'
        : endless ? '100%'
        : state.duration ? `${Math.min(100, (state.position / state.duration) * 100)}%` : '0';
    }
    cancelAnimationFrame(raf);
    if (state) raf = requestAnimationFrame(updatePlaying);
  }
  player.onChange(updatePlaying);

  // ---------- Menu ----------

  function openMenu(id, anchor) {
    menuFor = id;
    const menu = $('#bash-menu');
    menu.querySelector('[data-action="unkit"]').classList.toggle('hidden', !(typeof Kits !== 'undefined' && Kits.activeKit()));
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${Math.min(window.innerWidth - 170, rect.left)}px`;
    menu.style.top = `${rect.bottom + 4}px`;
    menu.classList.remove('hidden');
    menu.querySelector('button').focus();
  }

  function closeMenu() {
    $('#bash-menu').classList.add('hidden');
    menuFor = null;
  }

  $('#bash-menu').addEventListener('click', async (e) => {
    const action = e.target.dataset.action;
    const id = menuFor;
    closeMenu();
    if (!action || !id) return;
    const bash = list.find((b) => b.id === id);
    if (action === 'edit') api.bashes.openEditor(id);
    if (action === 'kit' && bash) Kits.chooseKitFor({ type: 'bash', id }, bash.name);
    if (action === 'unkit') Kits.removeFromActive('bash', id);
    if (action === 'duplicate') { await api.bashes.duplicate(id); await reload(); }
    if (action === 'delete' && bash && confirm(`Delete the bash “${bash.name}”? Its sounds stay in your library.`)) {
      if (player.state()?.bashId === id) player.stop();
      await api.bashes.remove(id);
      await reload();
    }
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('#bash-menu, .bash-more')) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  // ---------- Header ----------

  $('#bash-new').addEventListener('click', async () => {
    const bash = await api.bashes.create({});
    await reload();
    api.bashes.openEditor(bash.id, { isNew: true });
  });

  $('#bash-collapse').addEventListener('click', () => {
    collapsed = !collapsed;
    try { localStorage.setItem('bashesCollapsed', collapsed ? '1' : '0'); } catch { /* ignore */ }
    render();
  });

  // Stop All and Esc stop bashes too, since they're sound effects.
  $('#stop-all').addEventListener('click', () => player.stop());
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName);
    if (e.key === 'Escape' && !typing && !$('#edit-dialog').open) player.stop();
  });
  $('#master-volume').addEventListener('input', () => setTimeout(() => player.applyPrefs(), 0));
  $('#output-device').addEventListener('change', () => setTimeout(() => player.applyPrefs(), 0));

  // ---------- "Add to Bash…" in the sound editor ----------

  function renderEditDialogSelect() {
    const select = $('#edit-bash');
    select.length = 1;
    for (const bash of list) {
      const opt = document.createElement('option');
      opt.value = bash.id;
      opt.textContent = bash.name;
      select.appendChild(opt);
    }
    const opt = document.createElement('option');
    opt.value = 'new';
    opt.textContent = '+ New bash';
    select.appendChild(opt);
  }

  $('#edit-bash').addEventListener('change', async (e) => {
    const target = e.target.value;
    e.target.value = '';
    const soundId = editingId;
    if (!target || !soundId) return;
    const sound = sounds.find((s) => s.id === soundId);
    let bash;
    if (target === 'new') {
      bash = await api.bashes.create({ name: sound ? sound.name : undefined, soundIds: [soundId] });
    } else {
      const current = list.find((b) => b.id === target);
      if (!current) return;
      const lane = current.clips.reduce((max, c) => Math.max(max, c.lane + 1), 0);
      bash = await api.bashes.update(target, { clips: [...current.clips, { soundId, offset: 0, volume: 1, lane }] });
    }
    await reload();
    toast(`Added “${sound ? sound.name : 'sound'}” to ${bash.name}.`);
  });

  async function reload() {
    list = await api.bashes.list();
    render();
  }

  api.bashes.onChanged((next) => { list = next; render(); if (typeof Kits !== 'undefined') Kits.renderBoard(); });
  api.onSoundsChanged(() => { if (typeof refresh === 'function') refresh(); });
  reload();

  return { render: () => render(), player, makeCard, all: () => list, refreshPlaying: () => updatePlaying() };
})();
