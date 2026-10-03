/* global Icons */
// Icon picker for bash covers and scene kits: search and browse the icon
// set by category, then pick a background colour and an icon colour
// (presets or any custom colour).
const IconPicker = (() => {
  const BACKGROUNDS = ['#7c6cff', '#ff5d73', '#f5a742', '#6ee7b7', '#5ec8ff', '#d58bff', '#8a6a4f', '#3f4a5a', '#1f6f4a', '#7a1f2b'];
  const ICON_COLORS = ['#ffffff', '#1b1b22', '#ffd166', '#ff5d73', '#6ee7b7', '#5ec8ff', '#d58bff', '#f5a742', '#c0c6d4', '#8a6a4f'];

  function swatchRow(label, presets, get, set) {
    const row = document.createElement('div');
    row.className = 'ip-row';
    const title = document.createElement('span');
    title.className = 'ip-label';
    title.textContent = label;
    const swatches = document.createElement('div');
    swatches.className = 'ip-swatches';
    const buttons = presets.map((color) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ip-swatch';
      b.style.background = color;
      b.title = color;
      b.addEventListener('click', () => set(color));
      swatches.appendChild(b);
      return [color, b];
    });
    // Any other colour, through the system colour picker.
    const custom = document.createElement('label');
    custom.className = 'ip-swatch ip-custom';
    custom.title = 'Custom colour';
    const input = document.createElement('input');
    input.type = 'color';
    input.addEventListener('input', () => set(input.value));
    custom.appendChild(input);
    swatches.appendChild(custom);
    row.append(title, swatches);
    const sync = () => {
      const current = get().toLowerCase();
      let matched = false;
      for (const [color, b] of buttons) {
        const on = color === current;
        matched = matched || on;
        b.classList.toggle('selected', on);
      }
      custom.classList.toggle('selected', !matched);
      custom.style.setProperty('--custom', matched ? 'transparent' : current);
      input.value = current;
    };
    return { row, sync };
  }

  // value: { icon, color (background), iconColor }. onChange gets the new value.
  function create(value, { onChange = () => {}, backgrounds = BACKGROUNDS } = {}) {
    const state = { icon: Icons.resolve(value.icon), color: value.color || backgrounds[0], iconColor: value.iconColor || '#ffffff' };
    let category = 'All';
    let search = '';

    const root = document.createElement('div');
    root.className = 'icon-picker';

    const changed = () => { syncColors(); renderGrid(); onChange({ ...state }); };
    const bg = swatchRow('Background', backgrounds, () => state.color, (c) => { state.color = c; changed(); });
    const fg = swatchRow('Icon colour', ICON_COLORS, () => state.iconColor, (c) => { state.iconColor = c; changed(); });
    const syncColors = () => { bg.sync(); fg.sync(); };

    const tools = document.createElement('div');
    tools.className = 'ip-tools';
    const searchBox = document.createElement('input');
    searchBox.type = 'search';
    searchBox.placeholder = 'Search icons… (dragon, tavern, storm)';
    searchBox.addEventListener('input', () => { search = searchBox.value.trim().toLowerCase(); renderGrid(); });
    searchBox.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
    const tabs = document.createElement('div');
    tabs.className = 'ip-tabs';
    for (const name of ['All', ...Icons.categories]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = name;
      b.dataset.category = name;
      b.addEventListener('click', () => { category = name; renderGrid(); });
      tabs.appendChild(b);
    }
    tools.append(searchBox, tabs);

    const grid = document.createElement('div');
    grid.className = 'ip-grid';

    function renderGrid() {
      for (const b of tabs.children) b.classList.toggle('active', b.dataset.category === category);
      grid.textContent = '';
      const matches = Icons.list.filter((i) => (category === 'All' || i.category === category)
        && (!search || i.name.toLowerCase().includes(search) || i.id.includes(search) || i.category.toLowerCase().includes(search)));
      for (const icon of matches) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ip-icon' + (icon.id === state.icon ? ' selected' : '');
        b.title = icon.name;
        b.dataset.icon = icon.id;
        if (icon.id === state.icon) {
          b.style.background = state.color;
          b.style.color = state.iconColor;
        }
        b.appendChild(Icons.el(icon.id, { size: 22 }));
        b.addEventListener('click', () => { state.icon = icon.id; changed(); });
        grid.appendChild(b);
      }
      if (!matches.length) {
        const none = document.createElement('p');
        none.className = 'ip-none';
        none.textContent = 'No icons match.';
        grid.appendChild(none);
      }
    }

    root.append(bg.row, fg.row, tools, grid);
    syncColors();
    renderGrid();
    return { element: root, value: () => ({ ...state }) };
  }

  return { create, BACKGROUNDS, ICON_COLORS };
})();
