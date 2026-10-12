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
  const BACKDROPS = [['#board', null], ['#sidebar', 'sidebar'], ['#browser', 'online'], ['#live-stage', 'stage'], ['#dice-layer', null]];
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

  // Contrast between two #rrggbb colours (WCAG).
  function contrast(a, b) {
    const lum = (h) => {
      const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const [x, y] = [lum(a), lum(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }

  // A filled button's colour and text, readable at 4.5:1: white text, on the
  // colour darkened a little if needed; or, on a bright colour (teal, gold…)
  // that would need a lot of darkening, dark text instead.
  function accentFill(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return { fill: hex, ink: '#fff' };
    const darker = (h, f) => `#${[1, 3, 5].map((i) => Math.round(parseInt(h.slice(i, i + 2), 16) * f).toString(16).padStart(2, '0')).join('')}`;
    for (let step = 0; step <= 3; step++) {
      const fill = darker(hex, 0.92 ** step);
      if (contrast(fill, '#ffffff') >= 4.5) return { fill, ink: '#fff' };
    }
    if (contrast(hex, '#141418') >= 4.5) return { fill: hex, ink: '#141418' };
    let fill = hex;
    for (let i = 0; i < 30 && contrast(fill, '#ffffff') < 4.5; i++) fill = darker(fill, 0.92);
    return { fill, ink: '#fff' };
  }

  function apply() {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.scheme = info().scheme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    root.dataset.font = info().font;
    root.classList.toggle('has-backdrop', !!info().backdrop);
    root.style.setProperty('--accent', accent());
    root.style.setProperty('--accent-hover', `color-mix(in srgb, ${accent()} 82%, #fff)`);
    // Buttons filled with the accent: text that stays readable (WCAG AA, 4.5:1) on any colour picked.
    const { fill, ink } = accentFill(accent());
    root.style.setProperty('--accent-fill', fill);
    root.style.setProperty('--accent-fill-hover', `color-mix(in srgb, ${fill} 88%, ${ink === '#fff' ? '#fff' : '#000'})`);
    root.style.setProperty('--on-accent', ink);
    if (theme === 'academia') root.style.setProperty('--wood', woodTexture());
    if (theme === 'tavern') root.style.setProperty('--tavern-wood', tavernWood());
    paintAll(true);
    listeners.forEach((fn) => fn(theme));
  }

  // Dark hardwood for Dark Academia's toolbar, full sounds and bashes (styles.css).
  let wood = null;
  function woodTexture() {
    if (!wood) {
      const canvas = document.createElement('canvas');
      canvas.width = 900; canvas.height = 152;
      ThemeArt.hardwood(canvas.getContext('2d'), 900, 152, 'trim');
      wood = `url(${canvas.toDataURL('image/jpeg', 0.88)})`;
    }
    return wood;
  }

  // Warm planks for Tavern's toolbar.
  let planks = null;
  function tavernWood() {
    if (!planks) {
      const canvas = document.createElement('canvas');
      canvas.width = 900; canvas.height = 148;
      ThemeArt.woodTable(canvas.getContext('2d'), 900, 148);
      planks = `url(${canvas.toDataURL('image/jpeg', 0.88)})`;
    }
    return planks;
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
    // (paintAll(true) has already dropped artKey, so check the picture too.)
    if (!el.dataset.artKey && !el.style.backgroundImage) return;
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
      else if (name === 'academia') {
        // The sidebar is a bookcase; the board, a night sky in a hardwood frame.
        if (page === 'sidebar') ThemeArt.libraryShelves(ctx, w, h);
        else {
          ThemeArt.arcaneBackdrop(ctx, w, h);
          if (page !== 'stage') ThemeArt.woodFrame(ctx, w, h, w >= 560 ? 12 : 7);
        }
      }
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

  // ---------- Tiles: book covers (Dark Academia), scrap paper (Tavern) and animated effects ----------

  const coverCache = new Map();
  const tileObserver = new ResizeObserver((entries) => entries.forEach((e) => decorateTile(e.target)));
  const tilesObserved = new WeakSet();

  function tileColor(el) {
    return el.style.getPropertyValue('--tile-color').trim() || accent();
  }

  function decorateTile(tile) {
    if (theme !== 'academia' && theme !== 'tavern') {
      if (tile.dataset.cover) { delete tile.dataset.cover; tile.style.backgroundImage = ''; }
      tile.style.removeProperty('--tilt');
      return;
    }
    if (!tilesObserved.has(tile)) { tilesObserved.add(tile); tileObserver.observe(tile); }
    const w = Math.round(tile.clientWidth);
    const h = Math.round(tile.clientHeight);
    if (w < 10 || h < 10) return;
    const color = tileColor(tile);
    const id = tile.dataset.soundId || tile.dataset.id || '';
    // Tavern's notes are pinned up a little crooked, each its own way.
    if (theme === 'tavern') tile.style.setProperty('--tilt', `${((ThemeArt.seedOf(id) % 1000) / 1000 * 2.4 - 1.2).toFixed(2)}deg`);
    else tile.style.removeProperty('--tilt');
    const emblem = h >= 110;
    const key = `${theme}|${id}|${color}|${w}x${h}|${emblem}`;
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
      if (theme === 'academia') ThemeArt.bookCover(ctx, w, h, id, color, emblem);
      else ThemeArt.scrapPaper(ctx, w, h, id, color);
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

  // How far the glitter flies out past a book in Dark Academia.
  const GLITTER_PAD = 26;

  /** The animated layer for a playing sound in the current theme: synth waves in
      Sci-Fi and the plain themes, a planet and moons in Space Age, glitter and
      stars in Dark Academia, embers in Tavern. */
  function fxKind(el) {
    const track = el.classList.contains('track');
    if (theme === 'spaceAge') return track ? 'orbit-soft' : 'orbit';
    if (theme === 'academia') return track ? null : 'glitter';
    if (theme === 'tavern') return 'embers';
    return track ? 'wave-soft' : 'wave';
  }

  /** Adds or removes the animated layer on playing sounds. */
  function syncFx() {
    const want = new Map();
    document.querySelectorAll('.tile.playing, .track.playing').forEach((el) => {
      const kind = fxKind(el);
      if (kind) want.set(el, kind);
    });
    for (const canvas of [...fxCanvases]) {
      if (want.get(canvas.parentElement) !== canvas.dataset.kind || !canvas.isConnected) { canvas.remove(); fxCanvases.delete(canvas); }
    }
    for (const [el, kind] of want) {
      if (el.querySelector(':scope > canvas.theme-fx')) continue;
      const canvas = document.createElement('canvas');
      canvas.className = 'theme-fx';
      canvas.dataset.kind = kind;
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
      const kind = canvas.dataset.kind;
      const pad = kind === 'glitter' ? GLITTER_PAD : 0;
      const w = host.clientWidth;
      const h = host.clientHeight;
      const scale = Math.min(2, window.devicePixelRatio || 1);
      const cw = Math.round((w + pad * 2) * scale);
      const ch = Math.round((h + pad * 2) * scale);
      if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.clearRect(0, 0, w + pad * 2, h + pad * 2);
      ctx.translate(pad, pad);
      const color = tileColor(host);
      if (kind === 'glitter') ThemeArt.glitter(ctx, w, h, time, color, pad);
      else if (kind === 'orbit' || kind === 'orbit-soft') ThemeArt.orbitPlanet(ctx, w, h, time, color, kind === 'orbit-soft');
      else if (kind === 'embers') ThemeArt.embers(ctx, w, h, time);
      else {
        const inset = kind === 'wave' ? 6 : 4;
        ctx.translate(0, inset);
        ThemeArt.synthWave(ctx, w, h - inset * 2, time, color);
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
    // The phone apps: the Privacy Policy, Terms and Licenses (served by the relay).
    const api = window.soundboard;
    if (api && api.premium) {
      const legal = document.createElement('p');
      legal.className = 'muted small premium-legal';
      for (const [label, page] of [['Privacy Policy', 'privacy'], ['Terms of Use', 'terms'], ['Licenses', 'licenses']]) {
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'plain premium-link';
        link.textContent = label;
        link.addEventListener('click', () => api.openExternal(`https://soundboard-r1zt.onrender.com/${page}`));
        legal.append(link);
      }
      const note = document.createElement('p');
      note.className = 'muted small';
      note.textContent = 'Everything you make stays on this device. Uninstalling the app deletes it all.';
      container.append(legal, note);
    }
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
