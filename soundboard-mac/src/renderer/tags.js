/* global AudioUtils */
// Tags: colours, chips and the "Tag new sounds" dialog shown after adding sounds.
const Tags = (() => {
  const api = window.soundboard;
  const q = (sel) => document.querySelector(sel);

  const PRESET_COLORS = {
    surprise: '#ffb347', comedy: '#ffe156', horror: '#ff5d73', shock: '#d58bff', suspense: '#8b8cff',
    combat: '#ff8a5c', magic: '#5ec8ff', creature: '#6ee7b7', weather: '#7dd3fc', nature: '#86efac',
    tavern: '#f5a742', music: '#f472b6', victory: '#facc15', sad: '#94a3b8', mystery: '#a78bfa',
  };

  let list = { premade: [], all: [] };

  async function load() {
    list = await api.tags.list();
    return list;
  }

  function color(tag) {
    if (PRESET_COLORS[tag]) return PRESET_COLORS[tag];
    let hash = 0;
    for (const ch of tag) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
    return `hsl(${hash % 360} 70% 68%)`;
  }

  // A small coloured pill. `options.selected` styles it as active; `onClick` makes it a button.
  function chip(tag, options = {}) {
    const el = document.createElement(options.onClick ? 'button' : 'span');
    if (options.onClick) el.type = 'button';
    el.className = 'chip' + (options.selected ? ' selected' : '') + (options.small ? ' small' : '');
    el.style.setProperty('--chip-color', color(tag));
    el.textContent = options.label || tag;
    if (options.title) el.title = options.title;
    if (options.onClick) el.addEventListener('click', options.onClick);
    return el;
  }

  // Tag picker: chips for every known tag plus a box to make a new one.
  // Returns { element, selected() }.
  function picker(initial = [], { onChange } = {}) {
    const selected = new Set(initial);
    const wrap = document.createElement('div');
    wrap.className = 'tag-picker';
    const chips = document.createElement('div');
    chips.className = 'chip-row';
    const input = document.createElement('input');
    input.placeholder = '+ New tag (press Enter)';
    input.maxLength = 24;
    input.className = 'tag-input';

    function draw() {
      chips.textContent = '';
      const tags = [...list.all];
      for (const tag of selected) if (!tags.includes(tag)) tags.push(tag);
      for (const tag of tags) {
        chips.appendChild(chip(tag, {
          selected: selected.has(tag),
          onClick: () => {
            if (selected.has(tag)) selected.delete(tag); else selected.add(tag);
            draw();
            if (onChange) onChange([...selected]);
          },
        }));
      }
    }

    input.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      try {
        const tag = await api.tags.add(name);
        await load();
        selected.add(tag);
        input.value = '';
        draw();
        if (onChange) onChange([...selected]);
      } catch (err) {
        input.setCustomValidity(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
        input.reportValidity();
        setTimeout(() => input.setCustomValidity(''), 2000);
      }
    });

    draw();
    wrap.append(chips, input);
    return { element: wrap, selected: () => [...selected], redraw: draw };
  }

  // Measures a sound's length from its file metadata.
  function probeDuration(sound) {
    return new Promise((resolve) => {
      const audio = new Audio();
      audio.preload = 'metadata';
      const done = (value) => { audio.removeAttribute('src'); audio.load(); resolve(value); };
      audio.addEventListener('loadedmetadata', () => done(Number.isFinite(audio.duration) ? audio.duration : null), { once: true });
      audio.addEventListener('error', () => done(null), { once: true });
      setTimeout(() => done(null), 8000);
      audio.src = `sound://local/${encodeURIComponent(sound.file)}`;
    });
  }

  // "Tag new sounds" dialog. Resolves once the user saves or skips.
  async function askForNewSounds(newSounds) {
    if (!newSounds.length) return;
    await load();
    // Learn durations first so each sound starts with the right type.
    const measured = [];
    for (const sound of newSounds) {
      let updated = sound;
      if (!sound.duration) {
        const duration = await probeDuration(sound);
        if (duration) updated = (await api.update(sound.id, { duration })).sound;
      }
      measured.push(updated);
    }

    const dialog = q('#tag-dialog');
    q('#tag-dialog-title').textContent = measured.length === 1 ? 'Tag your new sound' : `Tag ${measured.length} new sounds`;
    const rows = q('#tag-dialog-sounds');
    rows.textContent = '';
    const fields = [];
    for (const sound of measured) {
      const row = document.createElement('div');
      row.className = 'new-sound-row';
      const name = document.createElement('input');
      name.value = sound.name;
      name.maxLength = 80;
      name.setAttribute('aria-label', 'Sound name');
      const kind = kindToggle(sound.kind || 'clip');
      const length = document.createElement('span');
      length.className = 'muted mono small';
      length.textContent = sound.duration ? AudioUtils.formatTime(sound.duration) : '';
      row.append(name, length, kind.element);
      rows.appendChild(row);
      fields.push({ sound, name, kind });
    }

    const tagPicker = picker([]);
    const host = q('#tag-dialog-picker');
    host.textContent = '';
    host.appendChild(tagPicker.element);
    q('#tag-dialog-hint').textContent = measured.length > 1 ? 'Tags apply to all of these sounds. You can change them later in each sound\'s editor.' : 'Pick as many as you like. You can change them later in the sound\'s editor.';

    dialog.returnValue = '';
    dialog.showModal();
    await new Promise((resolve) => dialog.addEventListener('close', resolve, { once: true }));
    if (dialog.returnValue !== 'save') return;
    const tags = tagPicker.selected();
    for (const { sound, name, kind } of fields) {
      await api.update(sound.id, { name: name.value, kind: kind.value(), tags: [...new Set([...(sound.tags || []), ...tags])] });
    }
  }

  // Two-button "Clip / Full sound" switch.
  function kindToggle(initial) {
    let value = initial;
    const el = document.createElement('div');
    el.className = 'segmented';
    const buttons = [['clip', 'scissors', 'Clip'], ['full', 'note', 'Full sound']].map(([v, icon, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      Icons.set(b, icon, label, { size: 13 });
      b.title = v === 'clip' ? 'A short effect: shown as a tile' : 'A song or long track: shown as a row with a timer';
      b.addEventListener('click', () => { value = v; sync(); });
      el.appendChild(b);
      return [v, b];
    });
    function sync() { for (const [v, b] of buttons) b.classList.toggle('active', v === value); }
    sync();
    return { element: el, value: () => value, set: (v) => { value = v; sync(); } };
  }

  return { load, list: () => list, color, chip, picker, kindToggle, probeDuration, askForNewSounds };
})();
