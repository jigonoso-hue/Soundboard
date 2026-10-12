/* Drawings for the themes, on a 2D canvas: the same pictures as the iPad app's
   Theme.swift, SpaceTheme.swift, SciFiTheme.swift and AcademiaTheme.swift.
   Tavern: a wooden table with worn parchment pages. Space Age: a starship window
   onto deep space with 50s atomic panels. Sci-Fi: a glowing HUD. Dark Academia:
   a starry night with gilded frames, book-cover tiles and magic. */
// eslint-disable-next-line no-unused-vars
const ThemeArt = (() => {
  const TAU = Math.PI * 2;

  // ---------- Helpers ----------

  /** A stable number for a string (FNV-1a), so each sheet keeps its look. */
  function seedOf(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }

  /** Seeded randomness: the same seed always draws the same wear. */
  function rng(seed) {
    let s = (seed >>> 0) || 1;
    const next = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return { next, range: (a, b) => a + (b - a) * next() };
  }

  function rgba(hex, a = 1) {
    const n = typeof hex === 'number' ? hex : parseInt(String(hex).replace('#', ''), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function ellipse(cx, cy, rx, ry, rotation = 0) {
    const p = new Path2D();
    p.ellipse(cx, cy, Math.max(0.01, rx), Math.max(0.01, ry), rotation, 0, TAU);
    return p;
  }
  const circle = (cx, cy, r) => ellipse(cx, cy, r, r);

  function roundRect(x, y, w, h, r) {
    const p = new Path2D();
    p.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
    return p;
  }

  function linear(ctx, x0, y0, x1, y1, stops) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    stops.forEach(([at, color]) => g.addColorStop(at, color));
    return g;
  }

  /** Runs `draw` with its own state: alpha, blur, clip and transforms are undone after. */
  function layer(ctx, opts, draw) {
    ctx.save();
    if (opts.alpha != null) ctx.globalAlpha *= opts.alpha;
    if (opts.blur) ctx.filter = `blur(${opts.blur}px)`;
    if (opts.clip) ctx.clip(opts.clip);
    draw();
    ctx.restore();
  }

  // ---------- Tavern ----------

  /** The outline of a worn sheet: uneven, torn edges with the odd nick. */
  function tornEdge(w, h, seed, scale = 1) {
    const random = rng(seed);
    const pts = [];
    const step = 11 * scale;
    function edge(ax, ay, bx, by, ix, iy) {
      const length = Math.max(1, Math.hypot(bx - ax, by - ay));
      const dx = (bx - ax) / length;
      const dy = (by - ay) / length;
      const count = Math.max(2, Math.round(length / step));
      const phase = random.range(0, 6.28);
      const wave = random.range(1, 3.5);
      for (let i = 0; i < count; i++) {
        const t = i / count;
        const px = ax + (bx - ax) * t;
        const py = ay + (by - ay) * t;
        const depth = (random.range(0, 2.2) + wave * (1 + Math.sin(t * length / 90 + phase)) / 2) * scale;
        pts.push([px + ix * depth, py + iy * depth]);
        if (random.next() < 0.045) {
          const cut = random.range(4, 10) * scale;
          pts.push([px + dx * 3 * scale + ix * cut, py + dy * 3 * scale + iy * cut]);
          pts.push([px + dx * 6 * scale + ix * depth, py + dy * 6 * scale + iy * depth]);
        }
      }
    }
    edge(0, 0, w, 0, 0, 1);
    edge(w, 0, w, h, -1, 0);
    edge(w, h, 0, h, 0, -1);
    edge(0, h, 0, 0, 1, 0);
    const p = new Path2D();
    pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
    p.closePath();
    return p;
  }

  const PARCHMENT_INK = 'rgba(107,64,20,';
  const ink = (a) => `${PARCHMENT_INK}${a})`;

  /** A sheet of old parchment: creased, stained and darkened at the edges. */
  function parchment(ctx, w, h, seedText) {
    const seed = seedOf(seedText);
    const outline = tornEdge(w, h, seed);
    const random = rng(Math.imul(seed, 7) + 3);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = linear(ctx, 0, 0, w, h, [[0, '#EFDCAF'], [0.5, '#E6CF9C'], [1, '#D9BD84']]);
    ctx.fill(outline);
    ctx.restore();
    ctx.save();
    ctx.clip(outline);

    layer(ctx, { blur: 22 }, () => {
      for (let i = 0; i < 16; i++) {
        const rx = random.range(30, 140);
        const ry = random.range(20, 110);
        ctx.fillStyle = ink(random.range(0.05, 0.12));
        ctx.fill(ellipse(random.range(0, w), random.range(0, h), rx, ry));
      }
      for (let i = 0; i < 6; i++) {
        const rx = random.range(30, 100);
        const ry = random.range(20, 80);
        ctx.fillStyle = 'rgba(255,247,224,0.25)';
        ctx.fill(ellipse(random.range(0, w), random.range(0, h), rx, ry));
      }
    });

    // Stains: mug rings and spilled drops.
    const rings = Math.floor(random.range(0, 2.6));
    for (let i = 0; i < rings && w > 120 && h > 120; i++) {
      const cx = random.range(40, w - 40);
      const cy = random.range(40, h - 40);
      const r = random.range(20, 42);
      const start = random.range(0, 1);
      const end = random.range(4.5, 6.4);
      const lw = random.range(2, 4);
      layer(ctx, { blur: 1 }, () => {
        ctx.beginPath();
        ctx.arc(cx, cy, r, start, end);
        ctx.strokeStyle = ink(0.3);
        ctx.lineWidth = lw;
        ctx.stroke();
      });
      layer(ctx, { blur: 6 }, () => { ctx.fillStyle = ink(0.06); ctx.fill(circle(cx + 0, cy + 0, r - 3)); });
    }
    layer(ctx, { blur: 8 }, () => {
      for (let i = 0; i < 2; i++) {
        const rx = random.range(16, 46);
        const ry = random.range(10, 32);
        ctx.fillStyle = ink(0.15);
        ctx.fill(ellipse(random.range(0, w), random.range(0, h), rx, ry));
      }
    });

    // Crinkles: a dark crease with a light ridge beside it.
    const creases = Math.max(3, Math.floor(w * h / 14000));
    ctx.lineWidth = 0.9;
    for (let i = 0; i < creases; i++) {
      let x = random.range(0, w);
      let y = random.range(0, h);
      let angle = random.range(0, 6.28);
      const crease = new Path2D();
      const ridge = new Path2D();
      crease.moveTo(x, y);
      ridge.moveTo(x + 1.2, y + 1.2);
      const segs = Math.floor(random.range(2, 5));
      for (let k = 0; k < segs; k++) {
        angle += random.range(-0.6, 0.6);
        const length = random.range(10, 40);
        x += Math.cos(angle) * length;
        y += Math.sin(angle) * length;
        crease.lineTo(x, y);
        ridge.lineTo(x + 1.2, y + 1.2);
      }
      ctx.strokeStyle = ink(0.2);
      ctx.stroke(crease);
      ctx.strokeStyle = 'rgba(255,250,230,0.45)';
      ctx.stroke(ridge);
    }

    // Speckles of age.
    const specks = Math.floor(w * h / 900);
    for (let i = 0; i < specks; i++) {
      const r = random.range(0.3, 1.1);
      ctx.fillStyle = ink(random.range(0.05, 0.25));
      ctx.fill(circle(random.range(0, w), random.range(0, h), r));
    }

    // Worn, darkened edges.
    layer(ctx, { blur: 10 }, () => { ctx.strokeStyle = 'rgba(94,51,15,0.55)'; ctx.lineWidth = 26; ctx.stroke(outline); });
    layer(ctx, { blur: 2 }, () => { ctx.strokeStyle = 'rgba(69,36,10,0.5)'; ctx.lineWidth = 4; ctx.stroke(outline); });
    ctx.restore();
  }

  /** Wooden planks: varied shades, grain, knots and seams. */
  function woodTable(ctx, w, h) {
    const shades = [0x5B3A22, 0x4F321D, 0x64412A, 0x573722, 0x4A2E1A];
    const random = rng(42);
    const plank = 74;
    let y = 0;
    let row = 0;
    while (y < h) {
      ctx.fillStyle = rgba(shades[Math.floor(random.next() * shades.length) % shades.length]);
      ctx.fillRect(0, y, w, plank);
      for (let k = 0; k < 16; k++) {
        const gy = y + random.range(4, plank - 4);
        const amplitude = random.range(1, 5);
        const wavelength = random.range(60, 160);
        ctx.beginPath();
        ctx.moveTo(0, gy);
        for (let x = 40; x <= w + 40; x += 40) ctx.lineTo(x, gy + Math.sin(x / wavelength + k) * amplitude);
        ctx.strokeStyle = random.next() < 0.5 ? 'rgba(31,15,5,0.28)' : 'rgba(140,94,56,0.18)';
        ctx.lineWidth = random.range(0.5, 1.6);
        ctx.stroke();
      }
      if (random.next() < 0.6) {
        const cx = random.range(40, Math.max(41, w - 40));
        const cy = y + plank / 2;
        ctx.lineWidth = 1.2;
        for (let ring = 1; ring <= 4; ring++) {
          ctx.strokeStyle = `rgba(26,13,5,${0.45 - ring * 0.08})`;
          ctx.stroke(ellipse(cx, cy, ring * 5, ring * 2.4));
        }
      }
      let x = row % 2 === 0 ? random.range(250, 400) : random.range(80, 200);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      while (x < w) { ctx.fillRect(x, y, 2, plank); x += random.range(300, 480); }
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, y + plank - 2, w, 2);
      ctx.fillStyle = 'rgba(255,219,171,0.07)';
      ctx.fillRect(0, y, w, 1);
      y += plank;
      row++;
    }
  }

  // ---------- Space Age ----------

  const ATOMIC = { teal: '#12B5A5', orange: '#F0643C', lime: '#C3D23A', mustard: '#F5A623', pink: '#F497A5', ink: '#232323', cream: '#F6EFDD', navy: '#0C142C' };
  const PALETTE = [ATOMIC.teal, ATOMIC.orange, ATOMIC.lime, ATOMIC.mustard, ATOMIC.pink];

  /** A four-pointed sparkle star. */
  function sparkle(x, y, s, p = new Path2D()) {
    p.moveTo(x, y - s);
    p.quadraticCurveTo(x, y, x + s * 0.45, y);
    p.quadraticCurveTo(x, y, x, y + s);
    p.quadraticCurveTo(x, y, x - s * 0.45, y);
    p.quadraticCurveTo(x, y, x, y - s);
    p.closePath();
    return p;
  }

  /** The classic mid-century boomerang. */
  function boomerang(ctx, x, y, s, angle, fill, stroke) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    const p = new Path2D();
    p.moveTo(-s, s * 0.35);
    p.quadraticCurveTo(-s * 0.5, -s * 0.5, 0, -s * 0.35);
    p.quadraticCurveTo(s * 0.5, -s * 0.5, s, s * 0.35);
    p.quadraticCurveTo(s * 0.45, -s * 0.1, 0, -s * 0.02);
    p.quadraticCurveTo(-s * 0.45, -s * 0.1, -s, s * 0.35);
    p.closePath();
    ctx.fillStyle = fill;
    ctx.fill(p);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke(p);
    ctx.restore();
  }

  function atom(ctx, x, y, s, line = ATOMIC.ink) {
    ctx.strokeStyle = line;
    ctx.lineWidth = 2;
    for (let k = 0; k < 3; k++) ctx.stroke(ellipse(x, y, s, s * 0.38, k * Math.PI / 3));
    const nucleus = circle(x, y, s * 0.2);
    ctx.fillStyle = ATOMIC.mustard;
    ctx.fill(nucleus);
    ctx.stroke(nucleus);
    [[ATOMIC.teal, 0], [ATOMIC.orange, 2.1], [ATOMIC.lime, 4.2]].forEach(([color, a]) => {
      ctx.fillStyle = color;
      ctx.fill(circle(x + Math.cos(a) * s, y + Math.sin(a) * s * 0.38, 4));
    });
  }

  function starburst(ctx, x, y, s, line = ATOMIC.ink) {
    const colors = [ATOMIC.teal, ATOMIC.orange, ATOMIC.lime];
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = line;
    for (let k = 0; k < 12; k++) {
      const angle = k * Math.PI / 6;
      const length = k % 2 === 0 ? s * 0.7 : s;
      const ex = x + Math.cos(angle) * length;
      const ey = y + Math.sin(angle) * length;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.fillStyle = colors[k % 3];
      ctx.fill(circle(ex, ey, 3));
    }
    ctx.fillStyle = line;
    ctx.fill(circle(x, y, 4));
  }

  /** Riveted starship hull plating. */
  function hullPlating(ctx, w, h) {
    const shades = [0x6B7A8C, 0x637284, 0x71808F, 0x5C6B7D, 0x687789];
    const random = rng(2049);
    ctx.fillStyle = '#2C3440';
    ctx.fillRect(0, 0, w, h);
    const panels = [];
    (function split(x, y, pw, ph, depth) {
      const limit = random.range(90, 170);
      if ((pw < limit && ph < limit) || depth > 7) { panels.push([x, y, pw, ph]); return; }
      const f = random.range(0.3, 0.7);
      if (pw >= ph) { split(x, y, pw * f, ph, depth + 1); split(x + pw * f, y, pw * (1 - f), ph, depth + 1); }
      else { split(x, y, pw, ph * f, depth + 1); split(x, y + ph * f, pw, ph * (1 - f), depth + 1); }
    })(0, 0, w, h, 0);

    for (const [cx, cy, cw, ch] of panels) {
      const x0 = cx + 1.5; const y0 = cy + 1.5; const x1 = cx + cw - 1.5; const y1 = cy + ch - 1.5;
      const pw = x1 - x0; const ph = y1 - y0;
      if (pw <= 4 || ph <= 4) continue;
      const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      const cut = random.next() < 0.35 ? random.range(10, Math.max(10.5, Math.min(24, pw / 3, ph / 3))) : 0;
      const cutCorner = Math.floor(random.next() * 4) % 4;
      const plate = new Path2D();
      corners.forEach(([px, py], i) => {
        if (cut > 0 && i === cutCorner) {
          const toward = ([ox, oy]) => [px + Math.sign(ox - px) * cut, py + Math.sign(oy - py) * cut];
          const a = toward(corners[(i + 3) % 4]);
          const b = toward(corners[(i + 1) % 4]);
          if (i === 0) plate.moveTo(...a); else plate.lineTo(...a);
          plate.lineTo(...b);
        } else if (i === 0) plate.moveTo(px, py);
        else plate.lineTo(px, py);
      });
      plate.closePath();
      ctx.fillStyle = rgba(shades[Math.floor(random.next() * shades.length) % shades.length]);
      ctx.fill(plate);
      ctx.save();
      ctx.clip(plate);
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.beginPath(); ctx.moveTo(x0, y1); ctx.lineTo(x0, y0); ctx.lineTo(x1, y0); ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.moveTo(x1, y0); ctx.lineTo(x1, y1); ctx.lineTo(x0, y1); ctx.stroke();
      if (random.next() < 0.3 && pw > 60 && ph > 60) {
        ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.strokeRect(x0 + 10, y0 + 10, pw - 20, ph - 20);
        ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.strokeRect(x0 + 11, y0 + 11, pw - 20, ph - 20);
      }
      if (random.next() < 0.45 && pw > 50 && ph > 40) {
        const count = 2 + Math.floor(random.next() * 2);
        const vertical = random.next() < 0.5;
        const ox = x0 + random.range(14, pw - 40);
        const oy = y0 + random.range(14, ph - 30);
        ctx.fillStyle = '#323B47';
        for (let k = 0; k < count; k++) {
          ctx.fill(vertical ? roundRect(ox + k * 7, oy, 3, 16, 1.5) : roundRect(ox, oy + k * 6, 22, 3, 1.5));
        }
      }
      if (pw >= 40 && ph >= 40) {
        for (const [rx, ry] of [[x0 + 7, y0 + 7], [x1 - 7, y0 + 7], [x0 + 7, y1 - 7], [x1 - 7, y1 - 7]]) {
          ctx.fillStyle = '#3A4350'; ctx.fill(circle(rx, ry, 2.2));
          ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fill(circle(rx - 0.6, ry - 0.6, 0.9));
        }
      }
      ctx.restore();
    }
  }

  function planet(ctx, x, y, r, tilt) {
    const ring = (front) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(tilt);
      ctx.beginPath();
      ctx.rect(-r * 3, front ? 0 : -r * 3, r * 6, r * 3);
      ctx.clip();
      const band = ellipse(0, 0, r * 1.9, r * 0.45);
      ctx.strokeStyle = ATOMIC.cream; ctx.lineWidth = Math.max(2, r * 0.07); ctx.stroke(band);
      ctx.strokeStyle = ATOMIC.teal; ctx.lineWidth = Math.max(1, r * 0.025); ctx.stroke(band);
      ctx.restore();
    };
    ring(false);
    const body = circle(x, y, r);
    ctx.fillStyle = linear(ctx, x - r, y - r, x + r, y + r, [[0, '#FFB35C'], [1, '#E0532E']]);
    ctx.fill(body);
    layer(ctx, { clip: body }, () => { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fill(circle(x + r * 0.35, y + r * 0.35, r)); });
    ring(true);
  }

  function saucer(ctx, x, y, s) {
    ctx.save();
    ctx.beginPath(); ctx.rect(x - s * 0.5, y - s * 0.7, s, s * 0.45); ctx.clip();
    ctx.fillStyle = 'rgba(246,239,221,0.9)';
    ctx.fill(ellipse(x, y - s * 0.25, s * 0.45, s * 0.4));
    ctx.restore();
    const hull = ellipse(x, y, s, s * 0.28);
    ctx.fillStyle = ATOMIC.teal; ctx.fill(hull);
    ctx.strokeStyle = ATOMIC.cream; ctx.lineWidth = 2; ctx.stroke(hull);
    ctx.fillStyle = ATOMIC.mustard;
    for (const d of [-0.6, 0, 0.6]) ctx.fill(circle(x + d * s, y + s * 0.05, 3));
  }

  /** A window onto deep space framed by hull plating. */
  function spaceScene(ctx, w, h, seedText) {
    hullPlating(ctx, w, h);
    const inset = Math.min(14, w * 0.05);
    const vw = w - inset * 2; const vh = h - inset * 2;
    if (vw <= 10 || vh <= 10) return;
    const radius = Math.min(28, vw * 0.2);
    const windowPath = roundRect(inset, inset, vw, vh, radius);
    ctx.save();
    ctx.clip(windowPath);
    ctx.fillStyle = linear(ctx, 0, 0, w, h, [[0, '#050816'], [0.5, '#0D1838'], [1, '#1C1242']]);
    ctx.fill(windowPath);
    const random = rng(Math.imul(seedOf(seedText), 31) + 77);
    const scale = Math.max(w, h) / 1100;
    layer(ctx, { blur: Math.min(60, Math.max(w, h) * 0.08) }, () => {
      [[ATOMIC.teal, 0.28], [ATOMIC.orange, 0.2], [ATOMIC.pink, 0.18], [ATOMIC.teal, 0.18], ['#6A4CFF', 0.25]].forEach(([color, alpha]) => {
        const rw = random.range(120, 260) * scale;
        const rh = random.range(80, 180) * scale;
        const rot = random.range(0, 3);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.fill(ellipse(random.range(0, w), random.range(0, h), rw, rh, rot));
      });
    });
    const stars = Math.floor(w * h / 1500);
    for (let i = 0; i < stars; i++) {
      const r = random.range(0.3, 1.4);
      const x = random.range(0, w); const y = random.range(0, h);
      const tint = random.next() < 0.12 ? 0xBBFFFF : 0xFFFFFF;
      ctx.fillStyle = rgba(tint, random.range(0.25, 0.95));
      ctx.fill(circle(x, y, r));
    }
    for (let i = 0; i < 18; i++) {
      const x = random.range(0, w); const y = random.range(0, h);
      const size = random.range(4, 9);
      ctx.fillStyle = random.next() < 0.5 ? '#fff' : [ATOMIC.teal, ATOMIC.mustard, ATOMIC.pink][Math.floor(random.next() * 3) % 3];
      ctx.fill(sparkle(x, y, size));
    }
    // The big pieces stay out of the header row (y ≥ 170) and off narrow
    // pictures (the sidebar, a phone), where buttons fill the width.
    if (w >= 560) {
      layer(ctx, { alpha: 0.7 }, () => planet(ctx, w * 0.9, Math.max(170, h * 0.66), Math.max(14, Math.min(w, h) * 0.07), -0.35));
      layer(ctx, { alpha: 0.7 }, () => saucer(ctx, w * 0.12, Math.max(260, h * 0.8), Math.min(30, w * 0.1)));
      layer(ctx, { alpha: 0.45 }, () => atom(ctx, w * 0.55, h * 0.88, 30, ATOMIC.cream));
    }
    ctx.restore();
    ctx.strokeStyle = '#2C3440'; ctx.lineWidth = 5; ctx.stroke(windowPath);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1.5;
    ctx.stroke(roundRect(inset - 3, inset - 3, vw + 6, vh + 6, radius + 2));
  }

  /** A 50s atomic panel: dark navy with a cream outline, an offset colour shadow,
      a faint starfield, and decorations kept to the edges. */
  function atomicPanel(ctx, W, H, seedText) {
    const seed = seedOf(seedText);
    const off = 6;
    const w = W - off; const h = H - off;
    if (w < 20 || h < 20) return;
    const shadow = [ATOMIC.teal, ATOMIC.orange, ATOMIC.lime, ATOMIC.mustard][seed % 4];
    const panel = roundRect(0, 0, w, h, 18);
    ctx.save();
    ctx.translate(off, off);
    ctx.fillStyle = shadow;
    ctx.fill(panel);
    ctx.restore();
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fill(panel);
    ctx.restore();
    ctx.fillStyle = 'rgba(12,20,44,0.9)';
    ctx.fill(panel);
    ctx.save();
    ctx.clip(panel);
    const random = rng(seed);
    for (let i = 0; i < Math.floor(w * h / 1800); i++) {
      const r = random.range(0.3, 1.1);
      const x = random.range(0, w); const y = random.range(0, h);
      ctx.fillStyle = `rgba(255,255,255,${random.range(0.15, 0.55)})`;
      ctx.fill(circle(x, y, r));
    }
    const count = Math.max(3, Math.floor((w + h) / 110));
    layer(ctx, { alpha: 0.8 }, () => {
      for (let i = 0; i < count; i++) {
        const edge = Math.floor(random.next() * 4) % 4;
        let x; let y;
        if (edge === 0) { x = random.range(20, Math.max(21, w * 0.45)); y = random.range(6, 12); }
        else if (edge === 1) { x = random.range(Math.max(12, w - 40), Math.max(13, w - 12)); y = random.range(20, Math.max(21, h - 20)); }
        else if (edge === 2) { x = random.range(20, Math.max(21, w - 20)); y = random.range(Math.max(10, h - 34), Math.max(11, h - 10)); }
        else { x = random.range(10, 34); y = random.range(40, Math.max(41, h - 20)); }
        ctx.fillStyle = PALETTE[Math.floor(random.next() * PALETTE.length) % PALETTE.length];
        ctx.fill(sparkle(x, y, random.range(8, 18)));
      }
    });
    // Bigger ornaments sit low in tall panels, never in the header row where the buttons are.
    if (w > 220 && h > 260) {
      const angle = random.range(-0.5, 0.3);
      const color = PALETTE[Math.floor(random.next() * 3) % 3];
      layer(ctx, { alpha: 0.35 }, () => boomerang(ctx, w - 75, h - 45, 50, angle, color, ATOMIC.cream));
    }
    if (h > 320) layer(ctx, { alpha: 0.35 }, () => starburst(ctx, 40, h - 46, 26, ATOMIC.cream));
    ctx.restore();
    ctx.strokeStyle = ATOMIC.cream;
    ctx.lineWidth = 2.5;
    ctx.stroke(roundRect(1.25, 1.25, w - 2.5, h - 2.5, 17));
  }

  // ---------- Sci-Fi ----------

  const HUD = { cyan: 0x3FD2FF, bright: '#BFF1FF', red: '#FF4A5A' };
  const cyan = (a) => rgba(HUD.cyan, a);

  /** A rectangle with its top-left and bottom-right corners cut off. */
  function chamfer(x, y, w, h, k) {
    const p = new Path2D();
    p.moveTo(x + k, y);
    p.lineTo(x + w, y);
    p.lineTo(x + w, y + h - k);
    p.lineTo(x + w - k, y + h);
    p.lineTo(x, y + h);
    p.lineTo(x, y + k);
    p.closePath();
    return p;
  }
  const hudCut = (w, h) => Math.max(4, Math.min(18, w * 0.12, h * 0.25));

  /** The HUD behind everything: grid, glow, radar rings, ruler, brackets and chevrons. */
  function hudBackdrop(ctx, w, h) {
    ctx.fillStyle = linear(ctx, 0, 0, 0, h, [[0, '#03101F'], [1, '#071F38']]);
    ctx.fillRect(0, 0, w, h);
    ctx.beginPath();
    for (let x = 0; x < w; x += 32) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); }
    for (let y = 0; y < h; y += 32) { ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); }
    ctx.strokeStyle = cyan(0.07); ctx.lineWidth = 1; ctx.stroke();

    const gr = Math.min(140, Math.max(w, h) * 0.14);
    layer(ctx, { blur: Math.min(70, Math.max(w, h) * 0.07) }, () => {
      [[w * 0.3, h * 0.15, 0.35], [w * 0.8, h * 0.7, 0.25]].forEach(([x, y, a]) => { ctx.fillStyle = cyan(a); ctx.fill(circle(x, y, gr)); });
    });

    const cx = w * 0.62; const cy = h * 0.52; const radius = Math.min(w, h) * 0.36;
    ctx.strokeStyle = cyan(0.16);
    ctx.lineWidth = 1.5; ctx.stroke(circle(cx, cy, radius));
    ctx.save(); ctx.lineWidth = 6; ctx.setLineDash([2, 6]); ctx.stroke(circle(cx, cy, radius * 0.86)); ctx.restore();
    ctx.save(); ctx.strokeStyle = cyan(0.16); ctx.lineWidth = 1; ctx.setLineDash([18, 8]); ctx.stroke(circle(cx, cy, radius * 0.7)); ctx.restore();
    ctx.lineWidth = 1; ctx.stroke(circle(cx, cy, radius * 0.55));
    ctx.beginPath();
    for (let i = 0; i < 90; i++) {
      const a = i / 90 * TAU;
      const length = i % 5 === 0 ? 14 : 6;
      const inner = radius * 1.04;
      ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.lineTo(cx + Math.cos(a) * (inner + length), cy + Math.sin(a) * (inner + length));
    }
    ctx.stroke();
    ctx.strokeStyle = cyan(0.22); ctx.lineWidth = 5;
    for (const [s, e] of [[-0.6, 0.4], [2.4, 3.1]]) { ctx.beginPath(); ctx.arc(cx, cy, radius * 0.93, s, e); ctx.stroke(); }

    ctx.beginPath();
    for (let mark = 40; mark < h - 40; mark += 8) { ctx.moveTo(6, mark); ctx.lineTo(mark % 40 === 0 ? 18 : 12, mark); }
    ctx.strokeStyle = cyan(0.35); ctx.lineWidth = 1; ctx.stroke();

    ctx.beginPath();
    for (const [bx, by, sx, sy] of [[8, 8, 1, 1], [w - 8, 8, -1, 1], [8, h - 8, 1, -1], [w - 8, h - 8, -1, -1]]) {
      ctx.moveTo(bx, by + sy * 30); ctx.lineTo(bx, by); ctx.lineTo(bx + sx * 30, by);
    }
    ctx.strokeStyle = cyan(0.6); ctx.lineWidth = 2; ctx.stroke();

    for (let i = 0; i < 4; i++) {
      const x = w - 130 + i * 22; const y = h - 26;
      ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x + 10, y); ctx.lineTo(x, y + 7); ctx.lineTo(x + 5, y); ctx.closePath();
      ctx.fillStyle = cyan(0.3 * (0.3 + i * 0.2)); ctx.fill();
    }
  }

  /** A HUD panel: cut corners, a cyan glow and outline, an inner line, a header
      tab, hatching, status dots, bright corner accents and side ticks. */
  function hudPanel(ctx, W, H, seedText) {
    const seed = seedOf(seedText);
    const pad = 6; // room for the glow
    const x = pad; const y = pad; const w = W - pad * 2; const h = H - pad * 2;
    if (w <= 20 || h <= 20) return;
    const k = hudCut(w, h);
    const shape = chamfer(x, y, w, h, k);
    ctx.fillStyle = linear(ctx, 0, y, 0, y + h, [[0, 'rgba(10,40,70,0.88)'], [1, 'rgba(5,22,42,0.9)']]);
    ctx.fill(shape);
    layer(ctx, { blur: 6 }, () => { ctx.strokeStyle = cyan(0.7); ctx.lineWidth = 3; ctx.stroke(shape); });
    const rx = x + 1.5; const ry = y + 1.5; const rw = w - 3; const rh = h - 3;
    ctx.strokeStyle = rgba(HUD.cyan); ctx.lineWidth = 1.5; ctx.stroke(chamfer(rx, ry, rw, rh, k));
    ctx.strokeStyle = cyan(0.3); ctx.lineWidth = 1; ctx.stroke(chamfer(rx + 5, ry + 5, rw - 10, rh - 10, Math.max(2, k - 3)));
    if (rw > 180) {
      const tw = Math.min(rw * 0.4, 220);
      const left = rx + (rw - tw) / 2;
      ctx.beginPath(); ctx.moveTo(left, ry); ctx.lineTo(left + tw, ry); ctx.lineTo(left + tw - 10, ry + 9); ctx.lineTo(left + 10, ry + 9); ctx.closePath();
      ctx.fillStyle = cyan(0.18); ctx.fill(); ctx.strokeStyle = rgba(HUD.cyan); ctx.lineWidth = 1; ctx.stroke();
    }
    if (rw > 120 && rh > 40) {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const hx = rx + rw - 30 - i * 7; ctx.moveTo(hx, ry + rh - 6); ctx.lineTo(hx + 5, ry + rh - 13); }
      ctx.strokeStyle = cyan(0.55); ctx.lineWidth = 2; ctx.stroke();
    }
    if (rw > 80 && rh > 40) {
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i === 0 && seed % 2 === 1 ? HUD.red : rgba(HUD.cyan);
        ctx.fill(circle(rx + k + 10 + i * 9, ry + rh - 10, 2.3));
      }
    }
    const accent = Math.min(24, rw * 0.2, rh * 0.3);
    ctx.beginPath();
    ctx.moveTo(rx + rw - accent, ry); ctx.lineTo(rx + rw, ry); ctx.lineTo(rx + rw, ry + accent);
    ctx.moveTo(rx, ry + rh - accent); ctx.lineTo(rx, ry + rh); ctx.lineTo(rx + accent, ry + rh);
    ctx.strokeStyle = HUD.bright; ctx.lineWidth = 3; ctx.stroke();
    if (rh > 200) {
      ctx.beginPath();
      for (let i = 0; i < 8; i++) { const ty = ry + rh * 0.35 + i * 6; ctx.moveTo(rx + rw - 3, ty); ctx.lineTo(rx + rw - 9, ty); }
      ctx.strokeStyle = cyan(0.5); ctx.lineWidth = 1; ctx.stroke();
    }
  }

  // ---------- Dark Academia ----------

  function gold(ctx, x, y, w, h) {
    return linear(ctx, x, y, x + w, y + h, [[0, '#F6DC8F'], [0.45, '#B8862B'], [0.7, '#F0CF75'], [1, '#9C6F22']]);
  }

  /** A rectangle whose corners curve inward. */
  function frame(x, y, w, h, k) {
    const p = new Path2D();
    const r = x + w; const b = y + h;
    p.moveTo(x + k, y);
    p.lineTo(r - k, y);
    p.quadraticCurveTo(r - k, y + k, r, y + k);
    p.lineTo(r, b - k);
    p.quadraticCurveTo(r - k, b - k, r - k, b);
    p.lineTo(x + k, b);
    p.quadraticCurveTo(x + k, b - k, x, b - k);
    p.lineTo(x, y + k);
    p.quadraticCurveTo(x + k, y + k, x + k, y);
    p.closePath();
    return p;
  }

  /** A four-pointed star with a smaller cross-star behind it. */
  function star(x, y, s, p = new Path2D()) {
    sparkle(x, y, s, p);
    // The second star turned a quarter: its long points left and right.
    const t = s * 0.6;
    p.moveTo(x - t, y);
    p.quadraticCurveTo(x, y, x, y - t * 0.45);
    p.quadraticCurveTo(x, y, x + t, y);
    p.quadraticCurveTo(x, y, x, y + t * 0.45);
    p.quadraticCurveTo(x, y, x - t, y);
    p.closePath();
    return p;
  }

  function diamond(x, y, s, p = new Path2D()) {
    p.moveTo(x, y - s); p.lineTo(x + s * 0.7, y); p.lineTo(x, y + s); p.lineTo(x - s * 0.7, y); p.closePath();
    return p;
  }

  function thorn(x, y, dx, dy, length, p = new Path2D()) {
    p.moveTo(x - dy * 2.2, y + dx * 2.2); p.lineTo(x + dx * length, y + dy * length); p.lineTo(x + dy * 2.2, y - dx * 2.2); p.closePath();
    return p;
  }

  function polygon(cx, cy, r, n, rotation, p = new Path2D()) {
    for (let i = 0; i <= n; i++) {
      const a = rotation + i / n * TAU;
      const px = cx + Math.cos(a) * r; const py = cy + Math.sin(a) * r;
      if (i === 0) p.moveTo(px, py); else p.lineTo(px, py);
    }
    return p;
  }

  function addCircle(p, cx, cy, r) { p.moveTo(cx + r, cy); p.arc(cx, cy, r, 0, TAU); }

  /** An arcane sigil: rings, two squares, a hexagram and rays. */
  function sigil(cx, cy, r) {
    const p = new Path2D();
    addCircle(p, cx, cy, r);
    addCircle(p, cx, cy, r * 0.93);
    polygon(cx, cy, r * 0.93, 4, 0, p);
    polygon(cx, cy, r * 0.93, 4, Math.PI / 4, p);
    polygon(cx, cy, r * 0.93, 3, -Math.PI / 2, p);
    polygon(cx, cy, r * 0.93, 3, Math.PI / 2, p);
    addCircle(p, cx, cy, r * 0.46);
    addCircle(p, cx, cy, r * 0.3);
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU;
      p.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      p.lineTo(cx + Math.cos(a) * r * 1.12, cy + Math.sin(a) * r * 1.12);
    }
    return p;
  }

  function astrolabe(ctx, cx, cy, r) {
    const lines = new Path2D();
    addCircle(lines, cx, cy, r);
    const outer = r * 1.08;
    addCircle(lines, cx, cy, outer);
    for (let i = 0; i < 72; i++) {
      const a = i / 72 * TAU;
      const length = i % 6 === 0 ? r * 0.08 : r * 0.035;
      lines.moveTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
      lines.lineTo(cx + Math.cos(a) * (outer - length), cy + Math.sin(a) * (outer - length));
    }
    ctx.strokeStyle = 'rgba(212,169,74,0.22)'; ctx.lineWidth = 1; ctx.stroke(lines);
    const marks = new Path2D();
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * TAU + 0.26;
      diamond(cx + Math.cos(a) * r * 1.15, cy + Math.sin(a) * r * 1.15, 4, marks);
    }
    ctx.fillStyle = 'rgba(212,169,74,0.35)'; ctx.fill(marks);
  }

  function crescent(ctx, x, y, r, fill) {
    // The full moon with a bite taken out of it.
    const c = document.createElement('canvas');
    const size = Math.ceil(r * 2 + 4);
    c.width = size; c.height = size;
    const m = c.getContext('2d');
    m.fillStyle = fill;
    m.fill(circle(size / 2, size / 2, r));
    m.globalCompositeOperation = 'destination-out';
    m.fill(circle(size / 2 - r * 0.4 + r * 0.85, size / 2 - r * 1.05 + r * 0.85, r * 0.85));
    ctx.drawImage(c, x - size / 2, y - size / 2);
  }

  function hourglass(x, y, s) {
    const p = new Path2D();
    p.rect(x - s * 0.6, y - s, s * 1.2, s * 0.12);
    p.rect(x - s * 0.6, y + s * 0.88, s * 1.2, s * 0.12);
    p.moveTo(x - s * 0.45, y - s * 0.88);
    p.quadraticCurveTo(x - s * 0.45, y - s * 0.2, x, y);
    p.quadraticCurveTo(x - s * 0.45, y + s * 0.2, x - s * 0.45, y + s * 0.88);
    p.lineTo(x + s * 0.45, y + s * 0.88);
    p.quadraticCurveTo(x + s * 0.45, y + s * 0.2, x, y);
    p.quadraticCurveTo(x + s * 0.45, y - s * 0.2, x + s * 0.45, y - s * 0.88);
    p.closePath();
    return p;
  }

  function key(ctx, x, y, s, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    const p = new Path2D();
    p.ellipse(-s * 0.7, 0, s * 0.3, s * 0.3, 0, 0, TAU);
    p.moveTo(-s * 0.4, 0); p.lineTo(s, 0);
    p.moveTo(s * 0.7, 0); p.lineTo(s * 0.7, s * 0.25);
    p.moveTo(s * 0.9, 0); p.lineTo(s * 0.9, s * 0.3);
    ctx.stroke(p);
    ctx.restore();
  }

  /** A filigree curl: a short line ending in a small spiral. */
  function curl(x, y, dx, dy, l, p = new Path2D()) {
    const ex = x + dx * l; const ey = y + dy * l;
    const nx = -dy; const ny = dx;
    p.moveTo(x, y);
    p.quadraticCurveTo(x + dx * l * 0.5 + nx * 4, y + dy * l * 0.5 + ny * 4, ex, ey);
    p.quadraticCurveTo(ex + dx * 6 + nx * 4, ey + dy * 6 + ny * 4, ex + nx * 7 - dx * 3, ey + ny * 7 - dy * 3);
    p.quadraticCurveTo(ex - dx * 4 + nx * 7, ey - dy * 4 + ny * 7, ex - dx * 2 + nx * 3, ey - dy * 2 + ny * 3);
    return p;
  }

  /** The night behind everything: blue glows, stars, gold sparkles, a sigil in an
      astrolabe ring, a crescent moon, constellations, an hourglass and a key. */
  function arcaneBackdrop(ctx, w, h) {
    ctx.fillStyle = linear(ctx, 0, 0, 0, h, [[0, '#05060F'], [1, '#0B0F2A']]);
    ctx.fillRect(0, 0, w, h);
    const scale = Math.max(w, h) / 1100;
    layer(ctx, { blur: Math.min(80, Math.max(w, h) * 0.08) }, () => {
      [[0, h * 0.55, 0.5], [w, h * 0.2, 0.35], [w * 0.55, 0, 0.2]].forEach(([x, y, a]) => {
        ctx.fillStyle = rgba(0x1D54D6, a);
        ctx.fill(ellipse(x, y, 180 * scale, 260 * scale));
      });
    });
    const random = rng(9);
    for (let i = 0; i < Math.floor(w * h / 2600); i++) {
      const r = random.range(0.3, 1.1);
      const x = random.range(0, w); const y = random.range(0, h);
      ctx.fillStyle = `rgba(255,255,255,${random.range(0.2, 0.8)})`;
      ctx.fill(circle(x, y, r));
    }
    ctx.strokeStyle = 'rgba(143,166,255,0.13)'; ctx.lineWidth = 1.2;
    ctx.stroke(sigil(w * 0.6, h * 0.5, Math.min(w, h) * 0.34));
    const short = Math.min(w, h);
    astrolabe(ctx, w * 0.6, h * 0.5, short * 0.42);

    const g = gold(ctx, 0, 0, w, h);
    // On narrow pictures (the sidebar, a phone) buttons fill the width: stars and the sigil only.
    const wide = w >= 560;
    if (wide) {
      const mr = Math.max(12, short * 0.045);
      const my = Math.max(190, h * 0.66);
      layer(ctx, { blur: 14 }, () => crescent(ctx, w * 0.95, my, mr, 'rgba(246,220,143,0.5)'));
      layer(ctx, { alpha: 0.75 }, () => crescent(ctx, w * 0.95, my, mr, '#E8C46A'));
    }

    if (wide) [[[[0, 0], [1, 0.4], [2, 0.2], [2.8, 1], [3.6, 0.7]], w * 0.62, h * 0.62],
      [[[0, 0], [0.6, 1], [1.5, 1.2], [2.1, 0.4], [0, 0]], w * 0.8, h * 0.8]].forEach(([points, ox, oy]) => {
      const line = new Path2D();
      const stars = new Path2D();
      points.forEach(([px, py], i) => {
        const x = ox + px * 28; const y = oy + py * 28;
        if (i === 0) line.moveTo(x, y); else line.lineTo(x, y);
        addCircle(stars, x, y, 1.8);
      });
      ctx.save(); ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(246,220,143,0.35)'; ctx.lineWidth = 0.8; ctx.stroke(line); ctx.restore();
      ctx.fillStyle = '#F6DC8F'; ctx.fill(stars);
    });

    if (wide) {
      layer(ctx, { alpha: 0.35 }, () => {
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.4; ctx.stroke(hourglass(w * 0.985, h * 0.7, 14));
        ctx.lineWidth = 1.6; key(ctx, w * 0.3, h * 0.97, 20, -0.4);
      });
    }
    layer(ctx, { alpha: 0.8 }, () => {
      const p = new Path2D();
      for (let i = 0; i < 14; i++) star(random.range(0, w), random.range(0, h), random.range(4, 9), p);
      ctx.fillStyle = g; ctx.fill(p);
    });
  }

  /** A Dark Academia page: deep indigo in a gilded frame with thorned corner stars,
      filigree curls, moon phases, crest ornaments and a faint sigil. */
  function gildedPanel(ctx, W, H, seedText) {
    const bleed = 14;
    const x = bleed; const y = bleed; const w = W - bleed * 2; const h = H - bleed * 2;
    if (w <= 30 || h <= 30) return;
    const random = rng(seedOf(seedText));
    const k = 12;
    const shape = frame(x, y, w, h, k);
    const bg = ctx.createRadialGradient(x + w / 2, y + h * 0.45, 10, x + w / 2, y + h * 0.45, 600);
    bg.addColorStop(0, 'rgba(36,38,120,0.95)');
    bg.addColorStop(1, 'rgba(12,13,48,0.95)');
    ctx.fillStyle = bg;
    ctx.fill(shape);
    if (h > 140) {
      layer(ctx, { clip: shape }, () => {
        ctx.strokeStyle = 'rgba(201,182,255,0.08)'; ctx.lineWidth = 1;
        ctx.stroke(sigil(x + w / 2, y + h - Math.min(w, h) * 0.32, Math.min(w, h) * 0.28));
      });
    }
    const g = gold(ctx, x, y, w, h);
    ctx.strokeStyle = g; ctx.fillStyle = g;
    ctx.lineWidth = 1.8; ctx.stroke(shape);
    layer(ctx, { alpha: 0.7 }, () => { ctx.lineWidth = 0.8; ctx.stroke(frame(x + 6, y + 6, w - 12, h - 12, k - 2)); });

    const r = x + w; const b = y + h;
    const fills = new Path2D();
    const curls = new Path2D();
    for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [r, y, -1, 1], [x, b, 1, -1], [r, b, -1, -1]]) {
      const sx0 = cx + sx * k * 0.72; const sy0 = cy + sy * k * 0.72;
      star(sx0, sy0, 9, fills);
      thorn(sx0, sy0, -sx * 0.7071, -sy * 0.7071, 15, fills);
      if (w > 120 && h > 80) {
        curl(cx + sx * (k + 4), cy + sy * 3, sx, 0, 22, curls);
        curl(cx + sx * 3, cy + sy * (k + 4), 0, sy, 22, curls);
      }
    }
    ctx.fill(fills);
    ctx.lineWidth = 1; ctx.stroke(curls);

    if (w > 260 && h > 120) {
      layer(ctx, { alpha: 0.85 }, () => {
        const cx = x + w / 2; const cy = b;
        // A small dark plate breaks the frame line behind them.
        ctx.save(); ctx.fillStyle = 'rgba(12,13,48,1)'; ctx.fillRect(cx - 34, cy - 5, 68, 10); ctx.restore();
        for (let i = 0; i < 5; i++) {
          const px = cx + (i - 2) * 12;
          ctx.lineWidth = 0.7;
          ctx.stroke(circle(px, cy, 3.2));
          ctx.save();
          ctx.beginPath();
          if (i === 1) ctx.rect(px, cy - 3.2, 3.2, 6.4);
          else if (i === 3) ctx.rect(px - 3.2, cy - 3.2, 3.2, 6.4);
          else if (i === 2) ctx.rect(px - 3.2, cy - 3.2, 6.4, 6.4);
          else ctx.rect(0, 0, 0, 0);
          ctx.clip();
          ctx.fill(circle(px, cy, 3.2));
          ctx.restore();
        }
      });
    }
    if (w > 140) {
      const tx = x + w / 2;
      const crest = new Path2D();
      diamond(tx, y, 6, crest);
      thorn(tx, y, 0, -1, 12, crest);
      if (!(w > 260 && h > 120)) diamond(tx, b, 5, crest);
      ctx.fill(crest);
      ctx.beginPath();
      ctx.moveTo(tx - 38, y + 1); ctx.quadraticCurveTo(tx - 16, y - 9, tx - 7, y);
      ctx.moveTo(tx + 38, y + 1); ctx.quadraticCurveTo(tx + 16, y - 9, tx + 7, y);
      if (!(w > 260 && h > 120)) {
        ctx.moveTo(tx - 26, b - 1); ctx.quadraticCurveTo(tx - 12, b + 8, tx - 6, b);
        ctx.moveTo(tx + 26, b - 1); ctx.quadraticCurveTo(tx + 12, b + 8, tx + 6, b);
      }
      ctx.lineWidth = 1.4; ctx.stroke();
    }
    if (h > 200) {
      const sides = new Path2D();
      diamond(x, y + h / 2, 5, sides);
      diamond(r, y + h / 2, 5, sides);
      ctx.fill(sides);
    }
    layer(ctx, { alpha: 0.7 }, () => {
      const p = new Path2D();
      const count = Math.max(2, Math.floor((w + h) / 240));
      for (let i = 0; i < count; i++) {
        const sx = random.range(x + 20, Math.max(x + 21, r - 20));
        const top = random.next() < 0.5;
        const sy = top ? y + random.range(14, 26) : b - random.range(14, 26);
        star(sx, sy, random.range(3, 6), p);
      }
      ctx.fill(p);
    });
  }

  /** A leather-bound book cover for a sound, in the sound's colour. */
  function bookCover(ctx, w, h, seedText, color, emblem) {
    ctx.fillStyle = '#1A1028'; ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 0.55; ctx.fillStyle = color; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1;
    ctx.fillStyle = linear(ctx, 0, 0, w, h, [[0, 'rgba(255,255,255,0.1)'], [1, 'rgba(0,0,0,0.45)']]);
    ctx.fillRect(0, 0, w, h);
    const random = rng(seedOf(seedText));
    for (let i = 0; i < Math.floor(w * h / 30); i++) {
      ctx.fillStyle = random.next() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.12)';
      ctx.fillRect(random.range(0, w), random.range(0, h), 1.2, 1.2);
    }
    const g = gold(ctx, 0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, 10, h);
    ctx.fillStyle = g;
    for (const f of [0.12, 0.16, 0.84, 0.88]) ctx.fillRect(0, h * f, 10, 1.5);
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(10, 0, 1, h);
    ctx.fillStyle = '#E8DCC0'; ctx.fillRect(w - 3, 3, 3, h - 6);
    const bx = 16; const by = 6; const bw = w - 25; const bh = h - 12;
    if (bw <= 10 || bh <= 10) return;
    ctx.strokeStyle = g; ctx.fillStyle = g;
    ctx.lineWidth = 1.2; ctx.strokeRect(bx, by, bw, bh);
    ctx.lineWidth = 0.6; ctx.strokeRect(bx + 3, by + 3, bw - 6, bh - 6);
    const corners = new Path2D();
    for (const [cx, cy] of [[bx, by], [bx + bw, by], [bx, by + bh], [bx + bw, by + bh]]) diamond(cx, cy, 3.5, corners);
    ctx.fill(corners);
    if (emblem) {
      const cx = bx + bw / 2; const cy = h * 0.72;
      layer(ctx, { alpha: 0.85 }, () => {
        const lines = new Path2D();
        addCircle(lines, cx, cy, 11);
        polygon(cx, cy, 11, 3, -Math.PI / 2, lines);
        polygon(cx, cy, 11, 3, Math.PI / 2, lines);
        ctx.lineWidth = 0.9; ctx.stroke(lines);
        ctx.fill(star(cx, cy, 4));
      });
    }
  }

  // ---------- Card art: scrap paper (Tavern), hardwood and shelves (Dark Academia) ----------

  const DIRT = (a) => `rgba(74,48,20,${a})`;

  /** A sound's card in Tavern: a scrap of old paper pinned up with a brass
      tack, with torn edges, light wear, a mug ring, a fold, a dog-eared corner
      and a daub of the sound's colour down the left side. */
  function scrapPaper(ctx, W, H, seedText, color) {
    const m = 3;
    const w = W - m * 2; const h = H - m * 2;
    if (w <= 10 || h <= 10) return;
    const seed = seedOf(seedText);
    const random = rng(Math.imul(seed, 13) + 5);
    ctx.save();
    ctx.translate(m, m);
    const outline = tornEdge(w, h, seed, 0.45);
    ctx.save();
    ctx.shadowColor = 'rgba(60,35,12,0.35)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 3;
    ctx.fillStyle = linear(ctx, 0, 0, w, h, [[0, '#F8F0DC'], [0.6, '#EFE1C2'], [1, '#E3CFA6']]);
    ctx.fill(outline);
    ctx.restore();
    ctx.save();
    ctx.clip(outline);
    ctx.globalAlpha = 0.1; ctx.fillStyle = color; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1;

    // Wear: soft smudges, heavier towards the bottom, and a thumbprint.
    layer(ctx, { blur: 10 }, () => {
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = DIRT(random.range(0.05, 0.11));
        ctx.fill(ellipse(random.range(0, w), random.range(h * 0.35, h * 1.1), random.range(14, 40), random.range(8, 22)));
      }
    });
    const tx = random.range(w * 0.55, w * 0.9); const ty = random.range(h * 0.55, h * 0.85);
    layer(ctx, { alpha: 0.12 }, () => {
      ctx.strokeStyle = DIRT(1); ctx.lineWidth = 0.8;
      for (let r = 2; r < 9; r += 1.6) ctx.stroke(ellipse(tx, ty, r * 0.75, r, 0.5));
    });
    // A mug ring, partly off the edge.
    if (h > 60 && random.next() < 0.7) {
      const cx = random.range(w * 0.6, w * 1.05); const cy = random.range(-h * 0.1, h * 0.5);
      const r = Math.min(h * 0.42, 30);
      layer(ctx, { blur: 0.8 }, () => {
        ctx.beginPath(); ctx.arc(cx, cy, r, random.range(0, 2), random.range(4.4, 6.2));
        ctx.strokeStyle = 'rgba(110,60,20,0.28)'; ctx.lineWidth = 2.2; ctx.stroke();
      });
      layer(ctx, { blur: 5 }, () => { ctx.fillStyle = 'rgba(110,60,20,0.06)'; ctx.fill(circle(cx, cy, r - 2)); });
    }
    // A fold across the scrap: a dark crease and a light ridge.
    const fy = random.range(h * 0.3, h * 0.75);
    const lean = random.range(-8, 8);
    ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(0, fy - lean); ctx.lineTo(w, fy + lean);
    ctx.strokeStyle = DIRT(0.14); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, fy - lean + 1.2); ctx.lineTo(w, fy + lean + 1.2);
    ctx.strokeStyle = 'rgba(255,248,226,0.5)'; ctx.stroke();
    // Specks of dirt.
    for (let i = 0; i < Math.floor(w * h / 220); i++) {
      ctx.fillStyle = DIRT(random.range(0.06, 0.25));
      ctx.fill(circle(random.range(0, w), random.range(0, h), random.range(0.3, 0.9)));
    }
    // The sound's colour: a rough brush daub down the left side.
    const daub = new Path2D();
    daub.moveTo(2, 0);
    for (let y = 0; y <= h; y += 6) daub.lineTo(random.range(7, 10), y);
    daub.lineTo(random.range(7, 10), h);
    daub.lineTo(0, h); daub.lineTo(0, 0); daub.closePath();
    ctx.globalAlpha = 0.85; ctx.fillStyle = color; ctx.fill(daub);
    ctx.globalAlpha = 0.35; ctx.fillStyle = '#3d2712'; ctx.fill(daub);
    ctx.globalAlpha = 1;
    // Gently aged edges.
    layer(ctx, { blur: 5 }, () => { ctx.strokeStyle = 'rgba(150,100,45,0.35)'; ctx.lineWidth = 10; ctx.stroke(outline); });
    ctx.strokeStyle = 'rgba(110,72,30,0.35)'; ctx.lineWidth = 1; ctx.stroke(outline);
    ctx.restore();
    // A dog-eared corner, top right.
    if (w > 70 && h > 40) {
      const k = Math.min(14, h * 0.18);
      const ear = new Path2D();
      ear.moveTo(w - k, 0); ear.lineTo(w - k * 0.9, k * 0.95); ear.lineTo(w, k); ear.closePath();
      ctx.fillStyle = 'rgba(40,22,8,0.25)';
      ctx.fill(ellipse(w - k * 0.5, k * 0.55, k * 0.6, k * 0.5));
      ctx.fillStyle = linear(ctx, w - k, 0, w, k, [[0, '#C9B07A'], [1, '#E6D5AC']]);
      ctx.fill(ear);
      ctx.strokeStyle = 'rgba(110,72,30,0.45)'; ctx.lineWidth = 0.8; ctx.stroke(ear);
    }
    // A brass tack pinning it up.
    if (w > 60) {
      const px = w / 2; const py = 6;
      ctx.fillStyle = 'rgba(60,35,12,0.3)'; ctx.fill(ellipse(px + 1.5, py + 2, 4.5, 3.5));
      const brass = ctx.createRadialGradient(px - 1.3, py - 1.3, 0.5, px, py, 4.5);
      brass.addColorStop(0, '#FBE7A6'); brass.addColorStop(0.5, '#D9A441'); brass.addColorStop(1, '#8A5A1A');
      ctx.fillStyle = brass; ctx.fill(circle(px, py, 4));
      ctx.strokeStyle = 'rgba(90,55,15,0.6)'; ctx.lineWidth = 0.6; ctx.stroke(circle(px, py, 4));
    }
    ctx.restore();
  }

  const WOOD = [0x2B190E, 0x24150B, 0x311D11, 0x211208, 0x2E1A0F];

  /** Dark hardwood: planks of walnut with grain, seams and the odd knot.
      `vertical` runs the planks top to bottom (a back panel). */
  function hardwood(ctx, w, h, seedText = 'wood', vertical = false) {
    const random = rng(seedOf(seedText) + 11);
    ctx.save();
    if (vertical) { ctx.translate(w, 0); ctx.rotate(Math.PI / 2); [w, h] = [h, w]; }
    ctx.fillStyle = '#22140A'; ctx.fillRect(0, 0, w, h);
    const plank = 38;
    for (let y = 0, row = 0; y < h; y += plank, row++) {
      // Planks are staggered: each row is cut at different places.
      let x = -random.range(0, 300);
      while (x < w) {
        const length = random.range(220, 520);
        ctx.fillStyle = rgba(WOOD[Math.floor(random.next() * WOOD.length) % WOOD.length]);
        ctx.fillRect(x, y, length, plank);
        // Grain: long wavy lines along the plank.
        for (let g = 0; g < 9; g++) {
          const gy = y + random.range(2, plank - 2);
          const amp = random.range(0.5, 2.4); const freq = random.range(0.01, 0.03); const ph = random.range(0, 6);
          ctx.beginPath();
          for (let gx = x; gx <= x + length; gx += 8) {
            const yy = gy + Math.sin(gx * freq + ph) * amp;
            if (gx === x) ctx.moveTo(gx, yy); else ctx.lineTo(gx, yy);
          }
          ctx.strokeStyle = random.next() < 0.6 ? 'rgba(0,0,0,0.28)' : 'rgba(255,196,140,0.06)';
          ctx.lineWidth = random.range(0.5, 1.3);
          ctx.stroke();
        }
        if (random.next() < 0.25) {
          const kx = x + random.range(30, length - 30); const ky = y + random.range(10, plank - 10);
          ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 0.8;
          for (let r = 2; r < 9; r += 2.2) ctx.stroke(ellipse(kx, ky, r * 1.8, r * 0.7));
        }
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x + length - 1, y, 1.2, plank);
        x += length;
      }
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, y, w, 1.2);
      ctx.fillStyle = 'rgba(255,200,150,0.05)'; ctx.fillRect(0, y + 1.2, w, 1);
    }
    // A low sheen of polish across the top.
    ctx.fillStyle = linear(ctx, 0, 0, 0, h, [[0, 'rgba(255,220,170,0.06)'], [0.5, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.25)']]);
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  const BINDINGS = [0x5A1A1E, 0x1F3A2A, 0x1A2346, 0x4A2C14, 0x6B4A1A, 0x3A1838, 0x2C2C30, 0x6E2A12];

  /** Bookshelves in dark hardwood with gold-edged shelves, dimmed so the
      sidebar's text stays easy to read, inside a gold trim. */
  function libraryShelves(ctx, w, h) {
    hardwood(ctx, w, h, 'shelves', true);
    const random = rng(23);
    const bay = 128;
    const board = 12;
    for (let top = 6; top < h; top += bay) {
      const floor = top + bay - board;
      // Books standing on the shelf, with the odd gap and a leaning one.
      let x = 8;
      while (x < w - 10) {
        if (random.next() < 0.07) { x += random.range(10, 24); continue; }
        const bw = random.range(9, 19);
        const bh = (bay - board - 14) * random.range(0.62, 0.96);
        const lean = random.next() < 0.06 && x + bw + 10 < w - 10;
        const c = BINDINGS[Math.floor(random.next() * BINDINGS.length) % BINDINGS.length];
        ctx.save();
        ctx.translate(x, floor);
        if (lean) ctx.rotate(0.16);
        ctx.fillStyle = rgba(c);
        ctx.fillRect(0, -bh, bw, bh);
        ctx.fillStyle = linear(ctx, 0, 0, bw, 0, [[0, 'rgba(0,0,0,0.45)'], [0.35, 'rgba(255,255,255,0.08)'], [1, 'rgba(0,0,0,0.5)']]);
        ctx.fillRect(0, -bh, bw, bh);
        if (random.next() < 0.7) {
          ctx.fillStyle = gold(ctx, 0, -bh, bw, bh);
          for (const f of [0.1, 0.14, 0.86, 0.9]) ctx.fillRect(1, -bh + bh * f, bw - 2, 1);
          if (random.next() < 0.5) ctx.fillRect(bw * 0.3, -bh * 0.62, bw * 0.4, bh * 0.16);
        }
        ctx.restore();
        x += bw + (lean ? 10 : random.range(0.5, 1.5));
      }
      // The shelf: a hardwood board with a gold edge and a shadow below.
      ctx.fillStyle = '#3A2414'; ctx.fillRect(0, floor, w, board);
      ctx.fillStyle = linear(ctx, 0, floor, 0, floor + board, [[0, 'rgba(255,210,160,0.12)'], [1, 'rgba(0,0,0,0.45)']]);
      ctx.fillRect(0, floor, w, board);
      ctx.fillStyle = gold(ctx, 0, floor, w, 2); ctx.fillRect(0, floor, w, 1.5);
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, floor + board, w, 4);
    }
    // Dim it all so text on top stays readable.
    ctx.fillStyle = 'rgba(8,6,12,0.62)'; ctx.fillRect(0, 0, w, h);
    const g = gold(ctx, 0, 0, w, h);
    layer(ctx, { alpha: 0.75 }, () => {
      ctx.strokeStyle = g; ctx.lineWidth = 1.5; ctx.strokeRect(4.5, 4.5, w - 9, h - 9);
      ctx.lineWidth = 0.6; ctx.strokeRect(8.5, 8.5, w - 17, h - 17);
      const corners = new Path2D();
      for (const [cx, cy] of [[4.5, 4.5], [w - 4.5, 4.5], [4.5, h - 4.5], [w - 4.5, h - 4.5]]) diamond(cx, cy, 4, corners);
      ctx.fillStyle = g; ctx.fill(corners);
    });
  }

  /** A hardwood frame with gold trim around a picture (the board's night sky). */
  function woodFrame(ctx, w, h, t) {
    ctx.save();
    const ring = new Path2D();
    ring.rect(0, 0, w, h);
    ring.rect(t, t, w - t * 2, h - t * 2);
    ctx.clip(ring, 'evenodd');
    hardwood(ctx, w, h, 'frame');
    ctx.restore();
    const g = gold(ctx, 0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(t, t, w - t * 2, 3);
    ctx.strokeStyle = g; ctx.lineWidth = 1.5; ctx.strokeRect(t - 0.75, t - 0.75, w - t * 2 + 1.5, h - t * 2 + 1.5);
    layer(ctx, { alpha: 0.6 }, () => { ctx.lineWidth = 0.7; ctx.strokeRect(2.5, 2.5, w - 5, h - 5); });
    const corners = new Path2D();
    for (const [cx, cy] of [[t, t], [w - t, t], [t, h - t], [w - t, h - t]]) diamond(cx, cy, Math.max(3, t * 0.45), corners);
    ctx.fillStyle = g; ctx.fill(corners);
  }

  // ---------- Animated effects on playing sounds ----------

  /** Glowing synth waves rippling across a playing sound: Sci-Fi and the plain themes. */
  function synthWave(ctx, w, h, time, color) {
    if (w <= 4 || h <= 4) return;
    const waves = [[0.3, 2.2, 3.2, 0.95], [0.2, 3.4, -2.3, 0.6], [0.13, 5.1, 4.1, 0.4]];
    waves.forEach(([height, across, speed, alpha], index) => {
      const p = new Path2D();
      const steps = Math.max(24, Math.floor(w / 3));
      for (let step = 0; step <= steps; step++) {
        const f = step / steps;
        const envelope = Math.sin(f * Math.PI);
        const phase = time * speed + index * 1.7;
        const y = h / 2 + Math.sin(f * across * TAU + phase) * height * h * envelope;
        if (step === 0) p.moveTo(f * w, y); else p.lineTo(f * w, y);
      }
      ctx.strokeStyle = color;
      layer(ctx, { blur: 4, alpha: alpha * 0.8 }, () => { ctx.lineWidth = 4; ctx.stroke(p); });
      ctx.globalAlpha = alpha; ctx.lineWidth = 1.5; ctx.stroke(p); ctx.globalAlpha = 1;
    });
  }

  /** Space Age: a planet in the sound's colour with moons circling it. `soft`
      is the smaller one for a full sound's row. */
  function orbitPlanet(ctx, w, h, time, color, soft) {
    if (w <= 30 || h <= 20) return;
    // Clear of the name (top left) and the Stop button (bottom right).
    const r = Math.max(5, Math.min(h * 0.2, w * 0.11));
    const cx = w * (soft ? 0.62 : 0.68);
    const cy = h * (soft ? 0.47 : 0.4);
    const tilt = -0.28;
    // (orbit size, speed, moon size, colour)
    const moons = [[1.9, 1.1, 0.26, ATOMIC.cream], [2.7, -0.7, 0.2, ATOMIC.teal], [3.5, 0.5, 0.17, ATOMIC.mustard]];
    const spots = moons.map(([k, speed, size, c], i) => {
      const a = time * speed + i * 2.1;
      const rx = r * k; const ry = rx * 0.32;
      const lx = Math.cos(a) * rx; const ly = Math.sin(a) * ry;
      return { x: cx + lx * Math.cos(tilt) - ly * Math.sin(tilt), y: cy + lx * Math.sin(tilt) + ly * Math.cos(tilt), behind: Math.sin(a) < 0, s: Math.max(1.8, r * size), c, rx, ry };
    });
    ctx.save();
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = 'rgba(246,239,221,0.35)'; ctx.lineWidth = 0.8;
    for (const m of spots) ctx.stroke(ellipse(cx, cy, m.rx, m.ry, tilt));
    ctx.restore();
    const moon = (m) => { ctx.fillStyle = m.c; ctx.fill(circle(m.x, m.y, m.s)); };
    spots.filter((m) => m.behind).forEach(moon);
    layer(ctx, { blur: 8, alpha: 0.6 }, () => { ctx.fillStyle = color; ctx.fill(circle(cx, cy, r * 1.3)); });
    const body = circle(cx, cy, r);
    ctx.fillStyle = color; ctx.fill(body);
    layer(ctx, { clip: body }, () => {
      // Bands, a highlight and the night side, turning slowly.
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      for (const b of [-0.45, 0.1, 0.55]) ctx.fillRect(cx - r, cy + r * b + Math.sin(time * 0.8 + b * 4) * r * 0.05, r * 2, r * 0.16);
      const lit = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.45, 0, cx - r * 0.4, cy - r * 0.45, r * 1.2);
      lit.addColorStop(0, 'rgba(255,255,255,0.45)'); lit.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = lit; ctx.fill(body);
      ctx.fillStyle = 'rgba(0,0,0,0.32)'; ctx.fill(circle(cx + r * 0.4, cy + r * 0.4, r));
    });
    spots.filter((m) => !m.behind).forEach(moon);
    // A few twinkling sparkles around it.
    const random = rng(31);
    for (let i = 0; i < 5; i++) {
      const x = random.range(w * 0.1, w * 0.95); const y = random.range(h * 0.15, h * 0.9);
      const tw = Math.max(0, Math.sin(time * random.range(1.5, 3) + i * 2));
      ctx.globalAlpha = tw * 0.9;
      ctx.fillStyle = i % 2 ? '#fff' : ATOMIC.mustard;
      ctx.fill(sparkle(x, y, random.range(3, 5)));
    }
    ctx.globalAlpha = 1;
  }

  /** Dark Academia: a pulsing gold glow around a playing book, glitter twinkling
      on the cover, and stars and glitter flying out from its edges. The canvas
      reaches `pad` beyond the card on every side; (0, 0) is the card's corner. */
  function glitter(ctx, w, h, time, color, pad) {
    if (w <= 30 || h <= 20) return;
    const pulse = 0.65 + 0.35 * Math.sin(time * 3);
    layer(ctx, { blur: 5 }, () => {
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = '#FFD27A'; ctx.lineWidth = 4; ctx.strokeRect(16, 6, w - 25, h - 12);
      ctx.globalAlpha = pulse * 0.5;
      ctx.strokeStyle = color; ctx.lineWidth = 8; ctx.strokeRect(16, 6, w - 25, h - 12);
    });
    const random = rng(7);
    // Glitter on the cover.
    for (let i = 0; i < 16; i++) {
      const x = random.range(18, w - 8); const y = random.range(8, h - 8);
      const tw = Math.max(0, Math.sin(time * random.range(2, 4.5) + random.range(0, 6)));
      ctx.globalAlpha = tw ** 3;
      ctx.fillStyle = i % 3 ? '#FFF4D2' : '#FFD27A';
      ctx.fill(star(x, y, random.range(2, 4)));
    }
    // Stars and glitter flying out from the edges.
    const perimeter = 2 * (w + h);
    for (let i = 0; i < 40; i++) {
      let along = random.range(0, perimeter);
      let x; let y; let nx; let ny;
      if (along < w) { x = along; y = 0; nx = 0; ny = -1; }
      else if ((along -= w) < h) { x = w; y = along; nx = 1; ny = 0; }
      else if ((along -= h) < w) { x = w - along; y = h; nx = 0; ny = 1; }
      else { along -= w; x = 0; y = h - along; nx = -1; ny = 0; }
      const spread = random.range(-0.7, 0.7);
      const dx = nx + (ny ? spread : 0); const dy = ny + (nx ? spread : 0);
      const period = random.range(1.1, 2.2);
      const offset = random.next();
      const reach = pad * random.range(0.55, 0.95);
      const size = random.range(2.6, 6);
      const kind = random.next();
      const travel = (time / period + offset) % 1;
      const px = x + dx * travel * reach;
      const py = y + dy * travel * reach + travel * travel * 4;
      const a = (1 - travel * travel) * (0.7 + 0.3 * Math.sin(time * 9 + i * 1.7));
      if (kind < 0.55) {
        const s = size * (1 - travel * 0.4);
        ctx.globalAlpha = a * 0.45;
        ctx.fillStyle = '#FFD27A'; ctx.fill(circle(px, py, s * 0.55));
        ctx.globalAlpha = a;
        ctx.fillStyle = kind < 0.3 ? '#FFE7A3' : '#FFFFFF';
        ctx.fill(star(px, py, s));
      } else {
        ctx.globalAlpha = a;
        ctx.fillStyle = kind < 0.8 ? '#F6DC8F' : color;
        ctx.fill(circle(px, py, size * 0.28));
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Tavern: candlelight flickering up the card and embers rising off it. */
  function embers(ctx, w, h, time) {
    if (w <= 20 || h <= 16) return;
    const flicker = 0.75 + 0.15 * Math.sin(time * 7.3) + 0.1 * Math.sin(time * 13.1 + 1);
    const glow = ctx.createRadialGradient(w / 2, h + 8, 0, w / 2, h + 8, Math.max(w, h) * 0.9);
    glow.addColorStop(0, `rgba(255,140,30,${0.45 * flicker})`);
    glow.addColorStop(0.6, `rgba(230,100,20,${0.14 * flicker})`);
    glow.addColorStop(1, 'rgba(230,110,20,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
    const random = rng(5);
    const count = Math.max(8, Math.min(22, Math.floor(w / 9)));
    for (let i = 0; i < count; i++) {
      const x0 = random.range(6, w - 6);
      const period = random.range(1.4, 2.8);
      const offset = random.next();
      const size = random.range(1.3, 2.6);
      const sway = random.range(4, 9);
      const travel = (time / period + offset) % 1;
      const x = x0 + Math.sin(time * 1.9 + i) * sway * travel;
      const y = h - 2 - travel * (h + 4);
      const a = (1 - travel) * (0.6 + 0.4 * Math.sin(time * 11 + i * 2.3));
      ctx.fillStyle = `rgba(210,70,10,${a * 0.35})`;
      ctx.fill(circle(x, y, size * 2.6));
      ctx.fillStyle = `rgba(${Math.round(255 - 40 * travel)},${Math.round(110 + 90 * (1 - travel))},30,${a})`;
      ctx.fill(circle(x, y, size));
    }
  }

  // ---------- The listener's stage ----------

  /** The animated layer of the stage: a glow and rings rippling out from the
      emblem, plus a touch for each theme (sparks, candlelight, an orbiting
      atom, a radar sweep, a turning sigil). */
  function stage(ctx, w, h, time, active, style) {
    if (w <= 1 || h <= 1) return;
    const cx = w / 2; const cy = h * 0.36;
    const reach = Math.max(w, h) * 0.75;
    // Glow.
    const pulse = 0.5 + 0.5 * Math.sin(time * (active ? 2.4 : 0.8));
    layer(ctx, { blur: 60, alpha: active ? 0.25 + 0.15 * pulse : 0.12 }, () => { ctx.fillStyle = style.ringA; ctx.fill(circle(cx, cy, 180)); });
    if (style.overlay === 'sparks') {
      const random = rng(11);
      for (let i = 0; i < 40; i++) {
        const x = random.range(0, w);
        const rise = random.range(8, 26);
        const start = random.range(0, h);
        const r = random.range(0.8, 2.2);
        const rate = random.range(0.5, 2);
        let y = (start - time * rise) % h;
        if (y < 0) y += h;
        ctx.fillStyle = rgba(0xFFD9A0, 0.5 * (0.4 + 0.6 * Math.abs(Math.sin(time * rate + x))));
        ctx.fill(circle(x, y, r));
      }
    } else if (style.overlay === 'candle') {
      const flicker = 0.75 + 0.15 * Math.sin(time * 7.3) + 0.1 * Math.sin(time * 13.1);
      const size = Math.min(w, h) * 0.5;
      layer(ctx, { blur: 70 }, () => {
        ctx.fillStyle = rgba(0xFFB347, 0.35 * flicker);
        ctx.fill(circle(0, h, size / 2));
        ctx.fill(circle(w, h, size / 2));
      });
    } else if (style.overlay === 'orbit') {
      const radius = 130;
      const angle = time * 0.6;
      ctx.strokeStyle = rgba(0xF6EFDD, 0.25); ctx.lineWidth = 1;
      ctx.stroke(ellipse(cx, cy, radius, radius * 0.4));
      ctx.fillStyle = '#F5A623';
      ctx.fill(circle(cx + radius * Math.cos(angle), cy + radius * 0.4 * Math.sin(angle), 6));
      ctx.fillStyle = '#12B5A5';
      ctx.fill(circle(cx + radius * Math.cos(angle + Math.PI), cy + radius * 0.4 * Math.sin(angle + Math.PI), 4));
    } else if (style.overlay === 'radar') {
      const angle = time * 1.2;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, reach * 0.7, angle - 0.5, angle); ctx.closePath();
      ctx.fillStyle = cyan(0.1); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + reach * 0.7 * Math.cos(angle), cy + reach * 0.7 * Math.sin(angle));
      ctx.strokeStyle = cyan(0.45); ctx.lineWidth = 1.5; ctx.stroke();
    } else if (style.overlay === 'sigil') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(time * 0.08);
      ctx.strokeStyle = rgba(0xD4A94A, active ? 0.35 : 0.2); ctx.lineWidth = 1.2;
      ctx.stroke(sigil(0, 0, 150));
      ctx.restore();
    }
    // Rings travelling outwards; faster while sounds play. Dashed in Sci-Fi.
    const rings = 6;
    const speed = active ? 0.22 : 0.07;
    const maxAlpha = active ? 0.55 : 0.3;
    ctx.save();
    ctx.lineWidth = active ? 2.5 : 1.5;
    if (style.overlay === 'radar') ctx.setLineDash([10, 6]);
    for (let i = 0; i < rings; i++) {
      const progress = (time * speed + i / rings) % 1;
      ctx.globalAlpha = (1 - progress) * maxAlpha;
      ctx.strokeStyle = i % 2 === 0 ? style.ringA : style.ringB;
      ctx.stroke(circle(cx, cy, 40 + progress * reach));
    }
    ctx.restore();
  }

  return {
    seedOf, rgba,
    parchment, woodTable, spaceScene, hullPlating, atomicPanel,
    hudBackdrop, hudPanel, arcaneBackdrop, gildedPanel, bookCover,
    scrapPaper, hardwood, libraryShelves, woodFrame,
    synthWave, orbitPlanet, glitter, embers, stage,
  };
})();
