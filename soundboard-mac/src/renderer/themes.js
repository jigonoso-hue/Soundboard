/* global ThemeArt */
/* The app's look: light/dark, backdrop, accent colour and lettering. The same
   themes as the iPad app (Theme.swift): System, Dark, Light, Tavern, Space Age,
   Sci-Fi and Dark Academia. Backdrops and panels are drawn by theme-art.js and
   set as background images, so the page's own layout is unchanged. */
// eslint-disable-next-line no-unused-vars
const Themes = (() => {
  const THEMES = {
    system: { name: 'System', blurb: 'Follows your device', scheme: null, accent: '#b04cff', font: 'default' },
    dark: { name: 'Dark', blurb: 'Dark and quiet', scheme: 'dark', accent: '#b04cff', font: 'default' },
    light: { name: 'Light', blurb: 'Bright and clean', scheme: 'light', accent: '#b04cff', font: 'default' },
    tavern: { name: 'Tavern', blurb: 'Old parchment on a tavern table', scheme: 'light', accent: '#9c3d12', font: 'serif', backdrop: true },
    spaceAge: { name: 'Space Age', blurb: 'Deep space through a starship window', scheme: 'dark', accent: '#2ad4c0', font: 'rounded', backdrop: true },
    scifi: { name: 'Sci-Fi', blurb: 'A glowing starship HUD', scheme: 'dark', accent: '#3fd2ff', font: 'mono', backdrop: true },
    academia: { name: 'Dark Academia', blurb: 'Gilded frames and arcane sigils', scheme: 'dark', accent: '#d4a94a', font: 'serif', backdrop: true },
  };
  const ORDER = ['system', 'dark', 'light', 'tavern', 'spaceAge', 'scifi', 'academia'];
  const ACCENTS = [['Amethyst', '#b04cff'], ['Crimson', '#d7263d'], ['Ember', '#ff7a1a'], ['Gold', '#e0a040'],
    ['Moss', '#4caf50'], ['Sea', '#1fa2d6'], ['Rose', '#ff5d9e'], ['Rust', '#9c3d12']];

  // Where the art goes: the window's backdrop, pages and panels.
  const BACKDROPS = [['#board', null], ['#sidebar', 'sidebar'], ['#browser', 'online'], ['#live-stage', 'stage']];
  const PANELS = ['#ambience', '.kit-header', '.kit-section', '.stage-pads', '#options-dialog .options-panel'];

  function read(key) { try { return localStorage.getItem(key); } catch { return null; } }
  function write(key, value) {
    try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* ignore */ }
  }

  const saved = read('theme');
  let theme = saved === 'parchment' ? 'tavern' : (THEMES[saved] ? saved : 'dark');
  let accentHex = read('accent');
  const listeners = new Set();

  const info = () => THEMES[theme];
  const accent = () => accentHex || info().accent;

  function apply() {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.scheme = info().scheme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    root.dataset.font = info().font;
    root.classList.toggle('has-backdrop', !!info().backdrop);
    root.style.setProperty('--accent', accent());
    root.style.setProperty('--accent-hover', `color-mix(in srgb, ${accent()} 82%, #fff)`);
    paintAll(true);
    listeners.forEach((fn) => fn(theme));
  }

  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (theme === 'system') apply(); });

  function set(name) {
    if (!THEMES[name] || name === theme) return;
    theme = name;
    write('theme', name);
    apply();
  }
  function setAccent(hex) {
    accentHex = hex || null;
    write('accent', accentHex);
    apply();
  }

  // ---------- Painting backdrops and panels ----------

  /** Draws `draw(ctx, w, h)` at the element's size and sets it as its background. */
  function paint(el, key, draw, opaque = false) {
    const w = Math.round(el.clientWidth);
    const h = Math.round(el.clientHeight);
    if (w < 2 || h < 2) return;
    const full = `${theme}|${key}|${w}x${h}`;
    if (el.dataset.artKey === full) return;
    el.dataset.artKey = full;
    const scale = Math.min(2, window.devicePixelRatio || 1);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    draw(ctx, w, h);
    el.style.backgroundImage = `url(${opaque ? canvas.toDataURL('image/jpeg', 0.9) : canvas.toDataURL('image/png')})`;
    el.style.backgroundSize = '100% 100%';
    el.style.backgroundRepeat = 'no-repeat';
  }

  function clearArt(el) {
    if (!el.dataset.artKey) return;
    delete el.dataset.artKey;
    el.style.backgroundImage = '';
    el.style.backgroundSize = '';
    el.style.backgroundRepeat = '';
  }

  /** The window behind everything, with an optional page (a parchment sheet in Tavern). */
  function drawBackdrop(name, page) {
    return (ctx, w, h) => {
      if (name === 'tavern') {
        ThemeArt.woodTable(ctx, w, h);
        if (page) { ctx.save(); ctx.translate(8, 8); ThemeArt.parchment(ctx, w - 16, h - 16, page); ctx.restore(); }
      } else if (name === 'spaceAge') ThemeArt.spaceScene(ctx, w, h, page || 'board');
      else if (name === 'scifi') ThemeArt.hudBackdrop(ctx, w, h);
      else if (name === 'academia') ThemeArt.arcaneBackdrop(ctx, w, h);
    };
  }

  function drawPanel(name, seed) {
    return (ctx, w, h) => {
      if (name === 'tavern') ThemeArt.parchment(ctx, w, h, seed);
      else if (name === 'spaceAge') ThemeArt.atomicPanel(ctx, w, h, seed);
      else if (name === 'scifi') ThemeArt.hudPanel(ctx, w, h, seed);
      else if (name === 'academia') ThemeArt.gildedPanel(ctx, w, h, seed);
    };
  }

  const seedFor = (el) => el.dataset.artSeed || el.dataset.id || el.id || 'panel';

  const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) paintOne(entry.target);
  });
  const observed = new WeakSet();

  function paintOne(el) {
    if (!info().backdrop) { clearArt(el); return; }
    const role = el.dataset.artRole;
    if (role === 'backdrop') {
      // Board: in Tavern, the library sits on its own parchment page; a scene kit's sections are their own sheets.
      let page = el.dataset.artPage || null;
      if (el.id === 'board') page = document.body.classList.contains('kit-open') ? null : 'library';
      paint(el, `b:${page}`, drawBackdrop(theme, page), true);
    } else if (role === 'panel') {
      const seed = seedFor(el);
      paint(el, `p:${seed}`, drawPanel(theme, seed));
    }
  }

  function register(el, role, page) {
    el.dataset.artRole = role;
    if (page) el.dataset.artPage = page;
    if (!observed.has(el)) { observed.add(el); resizeObserver.observe(el); }
  }

  function scan(root = document) {
    for (const [sel, page] of BACKDROPS) {
      if (root.matches?.(sel)) register(root, 'backdrop', page);
      root.querySelectorAll?.(sel).forEach((el) => register(el, 'backdrop', page));
    }
    for (const sel of PANELS) {
      if (root.matches?.(sel)) register(root, 'panel');
      root.querySelectorAll?.(sel).forEach((el) => register(el, 'panel'));
    }
  }

  function paintAll(force) {
    document.querySelectorAll('[data-art-role]').forEach((el) => {
      if (force) delete el.dataset.artKey;
      paintOne(el);
    });
    document.querySelectorAll('.tile').forEach(decorateTile);
    syncFx();
  }

  // ---------- Tiles: book covers (Dark Academia) and animated effects ----------

  const coverCache = new Map();
  const tileObserver = new ResizeObserver((entries) => entries.forEach((e) => decorateTile(e.target)));
  const tilesObserved = new WeakSet();

  function tileColor(el) {
    return el.style.getPropertyValue('--tile-color').trim() || accent();
  }

  function decorateTile(tile) {
    if (theme !== 'academia') {
      if (tile.dataset.cover) { delete tile.dataset.cover; tile.style.backgroundImage = ''; }
      return;
    }
    if (!tilesObserved.has(tile)) { tilesObserved.add(tile); tileObserver.observe(tile); }
    const w = Math.round(tile.clientWidth);
    const h = Math.round(tile.clientHeight);
    if (w < 10 || h < 10) return;
    const color = tileColor(tile);
    const id = tile.dataset.soundId || tile.dataset.id || '';
    const emblem = h >= 110;
    const key = `${id}|${color}|${w}x${h}|${emblem}`;
    if (tile.dataset.cover === key) return;
    tile.dataset.cover = key;
    let url = coverCache.get(key);
    if (!url) {
      const scale = Math.min(2, window.devicePixelRatio || 1);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      ThemeArt.bookCover(ctx, w, h, id, color, emblem);
      url = canvas.toDataURL('image/png');
      if (coverCache.size > 400) coverCache.clear();
      coverCache.set(key, url);
    }
    tile.style.backgroundImage = `url(${url})`;
    tile.style.backgroundSize = '100% 100%';
  }

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const fxCanvases = new Set();
  let fxFrame = 0;

  /** Adds or removes the animated layer on playing sounds: synth waves in
      Sci-Fi, magic in Dark Academia. */
  function syncFx() {
    const want = new Set();
    if (theme === 'scifi') document.querySelectorAll('.tile.playing, .track.playing').forEach((el) => want.add(el));
    if (theme === 'academia') document.querySelectorAll('.tile.playing').forEach((el) => want.add(el));
    for (const canvas of [...fxCanvases]) {
      if (!want.has(canvas.parentElement) || !canvas.isConnected) { canvas.remove(); fxCanvases.delete(canvas); }
    }
    for (const el of want) {
      if (el.querySelector(':scope > canvas.theme-fx')) continue;
      const canvas = document.createElement('canvas');
      canvas.className = 'theme-fx';
      canvas.dataset.kind = theme === 'academia' ? 'magic' : (el.classList.contains('track') ? 'wave-soft' : 'wave');
      el.insertBefore(canvas, el.firstChild);
      fxCanvases.add(canvas);
    }
    if (fxCanvases.size && !fxFrame) fxFrame = requestAnimationFrame(drawFx);
  }

  function drawFx(now) {
    fxFrame = 0;
    if (!fxCanvases.size) return;
    const time = reduceMotion.matches ? 0 : now / 1000;
    for (const canvas of fxCanvases) {
      const host = canvas.parentElement;
      if (!host) continue;
      const w = host.clientWidth;
      const h = host.clientHeight;
      const scale = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(w * scale) || canvas.height !== Math.round(h * scale)) {
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
      }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const color = tileColor(host);
      if (canvas.dataset.kind === 'magic') ThemeArt.magicGlow(ctx, w, h, time, color);
      else {
        ctx.save();
        ctx.translate(0, canvas.dataset.kind === 'wave' ? 6 : 4);
        ThemeArt.synthWave(ctx, w, h - (canvas.dataset.kind === 'wave' ? 12 : 8), time, color);
        ctx.restore();
      }
    }
    if (!reduceMotion.matches) fxFrame = requestAnimationFrame(drawFx);
  }

  // Watch the page for new tiles, panels and sounds starting or stopping.
  const mutationObserver = new MutationObserver((mutations) => {
    let fx = false;
    for (const m of mutations) {
      if (m.type === 'attributes') {
        if (m.target.classList?.contains('tile') || m.target.classList?.contains('track')) fx = true;
        continue;
      }
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        scan(node);
        if (node.classList.contains('tile')) decorateTile(node);
        node.querySelectorAll?.('.tile').forEach(decorateTile);
        node.querySelectorAll?.('[data-art-role]').forEach((el) => paintOne(el));
        if (node.dataset.artRole) paintOne(node);
        fx = true;
      }
    }
    if (fx) syncFx();
  });

  // ---------- Options: the theme cards and highlight colours ----------

  function drawPreview(name, ctx, w, h) {
    const t = THEMES[name];
    if (name === 'system') {
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w / 2, h);
      ctx.fillStyle = '#000'; ctx.fillRect(w / 2, 0, w / 2, h);
    } else if (name === 'dark') { ctx.fillStyle = '#111114'; ctx.fillRect(0, 0, w, h); }
    else if (name === 'light') { ctx.fillStyle = '#F5F5F7'; ctx.fillRect(0, 0, w, h); }
    else if (name === 'tavern') {
      ThemeArt.woodTable(ctx, w, h);
      ctx.save(); ctx.translate(6, 6); ThemeArt.parchment(ctx, w - 12, h - 12, 'preview'); ctx.restore();
    } else if (name === 'spaceAge') ThemeArt.spaceScene(ctx, w, h, 'preview');
    else if (name === 'scifi') {
      ThemeArt.hudBackdrop(ctx, w, h);
      ctx.save(); ctx.translate(2, 2); ThemeArt.hudPanel(ctx, w - 4, h - 4, 'preview'); ctx.restore();
    } else if (name === 'academia') {
      ThemeArt.arcaneBackdrop(ctx, w, h);
      ThemeArt.gildedPanel(ctx, w, h, 'preview');
    }
    const text = { light: '#2B1D0E', tavern: '#2B1D0E', spaceAge: '#F6EFDD', scifi: '#DDF6FF', academia: '#F1E6C8' }[name] || '#fff';
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = text;
    ctx.beginPath(); ctx.roundRect(12, h - 44, 46, 6, 3); ctx.fill();
    ctx.globalAlpha = 1;
    for (let i = 0; i < 3; i++) {
      const x = 12 + i * 31;
      ctx.beginPath(); ctx.roundRect(x, h - 32, 26, 20, 4);
      ctx.fillStyle = ThemeArt.rgba(t.accent, 0.35); ctx.fill();
      ctx.strokeStyle = ThemeArt.rgba(t.accent, 0.7); ctx.lineWidth = 1; ctx.stroke();
    }
  }

  function renderOptions(container) {
    container.textContent = '';
    const cards = document.createElement('div');
    cards.className = 'theme-cards';
    for (const name of ORDER) {
      const t = THEMES[name];
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'theme-card';
      card.classList.toggle('selected', name === theme);
      card.setAttribute('aria-pressed', String(name === theme));
      card.title = `${t.name} theme`;
      card.style.setProperty('--card-accent', t.accent);
      const canvas = document.createElement('canvas');
      canvas.width = 240; canvas.height = 156;
      const ctx = canvas.getContext('2d');
      ctx.scale(2, 2);
      drawPreview(name, ctx, 120, 78);
      const label = document.createElement('div');
      label.className = `theme-card-name font-${t.font}`;
      label.textContent = t.name;
      const blurb = document.createElement('div');
      blurb.className = 'muted small';
      blurb.textContent = t.blurb;
      card.append(canvas, label, blurb);
      card.addEventListener('click', () => { set(name); renderOptions(container); });
      cards.appendChild(card);
    }

    const accentRow = document.createElement('div');
    accentRow.className = 'accent-row';
    const heading = document.createElement('div');
    heading.className = 'options-subhead';
    heading.textContent = 'Highlight colour';
    const swatches = document.createElement('div');
    swatches.className = 'swatches';
    for (const [label, hex] of ACCENTS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.classList.toggle('selected', accentHex === hex);
      b.style.background = hex;
      b.title = label;
      b.setAttribute('aria-label', label);
      b.addEventListener('click', () => { setAccent(hex); renderOptions(container); });
      swatches.appendChild(b);
    }
    const custom = document.createElement('input');
    custom.type = 'color';
    custom.className = 'accent-custom';
    custom.title = 'Custom colour';
    custom.value = accent();
    custom.addEventListener('change', () => { setAccent(custom.value); renderOptions(container); });
    swatches.appendChild(custom);
    accentRow.append(heading, swatches);
    if (accentHex) {
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'link-btn';
      reset.textContent = "Use the theme's own colour";
      reset.addEventListener('click', () => { setAccent(null); renderOptions(container); });
      accentRow.appendChild(reset);
    }
    const footer = document.createElement('p');
    footer.className = 'muted small';
    footer.textContent = 'Tavern puts every page on worn parchment on a wooden table. Space Age looks out of a starship window onto deep space, with 50s atomic panels. Sci-Fi is a glowing holographic starship HUD. Dark Academia puts deep indigo pages in gilded frames under a starry night.';
    container.append(cards, accentRow, footer);
  }

  function init() {
    scan(document);
    mutationObserver.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    apply();
    // The board's page changes when a scene kit opens or closes.
    new MutationObserver(() => { const b = document.getElementById('board'); if (b) paintOne(b); })
      .observe(document.body, { attributes: true, attributeFilter: ['class'] });
    const button = document.getElementById('options-btn');
    const dialog = document.getElementById('options-dialog');
    if (button && dialog) {
      button.addEventListener('click', () => {
        renderOptions(document.getElementById('options-appearance'));
        dialog.showModal();
      });
    }
  }

  return {
    THEMES, ORDER,
    get theme() { return theme; },
    get info() { return info(); },
    get accent() { return accent(); },
    set, setAccent, init, renderOptions, paintAll,
    onChange: (fn) => listeners.add(fn),
  };
})();

Themes.init();
