// The dice: their shapes, which number is on which face, where the numbers go
// on each face, and how to read a die once it stops. Shared by the dice tray
// (dice.js) and the tests; the iPad app's DiceGeometry.swift is a copy of it.
//
// Every die is built the same way: a set of corner points, the convex hull
// around them (its faces), and numbers given to faces so opposite faces add up
// as on real dice (7 on a d6, 21 on a d20, 9 on a d10). A d4 has its numbers on
// its corners instead: the one pointing up is the roll.
(function (root) {
  const PHI = (1 + Math.sqrt(5)) / 2;

  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const length = (a) => Math.sqrt(dot(a, a));
  const unit = (a) => scale(a, 1 / (length(a) || 1));

  // The kinds of die. `d10t` is the tens die of a d100 (00, 10 … 90).
  const KINDS = {
    d4: { sides: 4, radius: 1.05 },
    d6: { sides: 6, radius: 0.9 },
    d8: { sides: 8, radius: 0.95 },
    d10: { sides: 10, radius: 0.92 },
    d10t: { sides: 10, radius: 0.92 },
    d12: { sides: 12, radius: 0.98 },
    d20: { sides: 20, radius: 1.02 },
    // A coin: heads (1) on top, tails (2) underneath, and a ridged edge.
    coin: { sides: 2, radius: 1.05 },
  };
  const COIN_EDGES = 20;

  function cornerPoints(kind) {
    switch (kind) {
      case 'coin': {
        const p = [];
        for (const y of [0.1, -0.1]) {
          for (let i = 0; i < COIN_EDGES; i++) {
            const a = (i * Math.PI * 2) / COIN_EDGES;
            p.push([Math.cos(a), y, Math.sin(a)]);
          }
        }
        return p;
      }
      case 'd4': return [[1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1]];
      case 'd6': {
        const p = [];
        for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) p.push([x, y, z]);
        return p;
      }
      case 'd8': return [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
      case 'd10':
      case 'd10t': {
        // A pentagonal trapezohedron: two apexes and a zig-zag ring of ten
        // corners. The apex height keeps each kite face flat.
        const z = 0.12;
        const c = Math.cos(Math.PI / 5);
        const apex = (z * (1 + c)) / (1 - c);
        const p = [[0, apex, 0], [0, -apex, 0]];
        for (let i = 0; i < 10; i++) {
          const a = (i * Math.PI) / 5;
          p.push([Math.cos(a), i % 2 ? -z : z, Math.sin(a)]);
        }
        return p;
      }
      case 'd12': {
        const p = [];
        for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) p.push([x, y, z]);
        for (const a of [-1, 1]) {
          for (const b of [-1, 1]) {
            p.push([0, a / PHI, b * PHI]);
            p.push([a / PHI, b * PHI, 0]);
            p.push([a * PHI, 0, b / PHI]);
          }
        }
        return p;
      }
      case 'd20': {
        const p = [];
        for (const a of [-1, 1]) {
          for (const b of [-1, 1]) {
            p.push([0, a, b * PHI]);
            p.push([a, b * PHI, 0]);
            p.push([a * PHI, 0, b]);
          }
        }
        return p;
      }
      default: throw new Error(`Unknown die ${kind}`);
    }
  }

  // The faces of the convex hull around `points`: each face's corners in
  // order, counter-clockwise seen from outside, and its outward normal.
  function hull(points) {
    const faces = [];
    const seen = [];
    const n = points.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        for (let k = j + 1; k < n; k++) {
          let normal = cross(sub(points[j], points[i]), sub(points[k], points[i]));
          if (length(normal) < 1e-9) continue;
          normal = unit(normal);
          let d = dot(normal, points[i]);
          let above = 0;
          let below = 0;
          for (const p of points) {
            const side = dot(normal, p) - d;
            if (side > 1e-6) above++;
            else if (side < -1e-6) below++;
          }
          if (above && below) continue;
          if (above) { normal = scale(normal, -1); d = -d; }
          if (seen.some((s) => dot(s, normal) > 1 - 1e-6)) continue;
          seen.push(normal);
          const on = [];
          points.forEach((p, index) => { if (Math.abs(dot(normal, p) - d) < 1e-6) on.push(index); });
          // Order the corners around the face's centre.
          const center = scale(on.reduce((acc, index) => add(acc, points[index]), [0, 0, 0]), 1 / on.length);
          const axisU = unit(sub(points[on[0]], center));
          const axisV = cross(normal, axisU);
          on.sort((a, b) => {
            const pa = sub(points[a], center);
            const pb = sub(points[b], center);
            return Math.atan2(dot(pa, axisV), dot(pa, axisU)) - Math.atan2(dot(pb, axisV), dot(pb, axisU));
          });
          faces.push({ corners: on, normal, center });
        }
      }
    }
    return faces;
  }

  // Numbers for faces (or corners, on a d4) so opposite ones add up as on real dice.
  function number(faces, kind) {
    const sides = faces.length;
    // A stable order: from the top down, then around.
    const order = faces.map((f, i) => i).sort((a, b) => {
      const na = faces[a].normal;
      const nb = faces[b].normal;
      return (nb[1] - na[1]) || (Math.atan2(na[2], na[0]) - Math.atan2(nb[2], nb[0]));
    });
    const values = new Array(sides).fill(null);
    let next = 0;
    // d10s count 0 to 9 (opposites add to 9); the rest 1 to n (opposites add to n + 1).
    const low = kind === 'd10' || kind === 'd10t' ? 0 : 1;
    const high = kind === 'd10' || kind === 'd10t' ? 9 : sides;
    // Spread the numbers around so neighbours differ a lot, as on real dice.
    const firsts = [];
    for (let v = low; v <= high; v++) if (v <= low + high - v) firsts.push(v);
    const pattern = firsts.filter((_, i) => i % 2 === 0).concat(firsts.filter((_, i) => i % 2 === 1));
    for (const index of order) {
      if (values[index] !== null) continue;
      let opposite = -1;
      let best = 0;
      faces.forEach((f, j) => {
        if (j === index || values[j] !== null) return;
        const d = dot(f.normal, faces[index].normal);
        if (d < best) { best = d; opposite = j; }
      });
      const v = pattern[next++];
      values[index] = v;
      if (opposite >= 0) values[opposite] = low + high - v;
    }
    return values;
  }

  function label(kind, value) {
    if (kind === 'd10t') return value === 0 ? '00' : String(value * 10);
    if (kind === 'coin') return value === 1 ? 'Heads' : value === 2 ? 'Tails' : '';
    return String(value);
  }

  const cache = new Map();

  // Everything about one kind of die, scaled to its size:
  // { kind, sides, points, faces: [{ corners, normal, center, value, label, up }], corners? }
  // `up` is the direction the face's number reads upwards. On a d4, `cornerValues`
  // gives each corner's number.
  function build(kind) {
    if (cache.has(kind)) return cache.get(kind);
    const info = KINDS[kind];
    if (!info) throw new Error(`Unknown die ${kind}`);
    const raw = cornerPoints(kind);
    const r = Math.max(...raw.map(length));
    const points = raw.map((p) => scale(p, info.radius / r));
    const faces = hull(points);
    const expected = kind === 'coin' ? COIN_EDGES + 2 : (kind === 'd10t' ? 10 : info.sides);
    if (faces.length !== expected) throw new Error(`${kind} has ${faces.length} faces`);
    const die = { kind, sides: info.sides, points, faces };
    if (kind === 'coin') {
      // The flat faces are heads (up) and tails (down); the edge has no number.
      for (const face of faces) {
        face.value = face.normal[1] > 0.99 ? 1 : face.normal[1] < -0.99 ? 2 : 0;
        face.label = label(kind, face.value);
      }
    } else if (kind === 'd4') {
      // Corner i is opposite face i's… just number the corners 1 to 4.
      die.cornerValues = points.map((_, i) => i + 1);
      for (const face of faces) {
        face.value = null;
        face.label = '';
      }
    } else {
      const values = number(faces, kind);
      faces.forEach((face, i) => {
        face.value = values[i];
        face.label = label(kind, values[i]);
      });
    }
    for (const face of faces) {
      // Text reads towards a corner on triangles and kites (the far corner),
      // towards an edge on squares and pentagons.
      const corners = face.corners.map((index) => points[index]);
      let target;
      if (face.corners.length === 4 && kind === 'd6') target = scale(add(corners[0], corners[1]), 0.5);
      else if (face.corners.length === 5) target = scale(add(corners[0], corners[1]), 0.5);
      else {
        target = corners.reduce((far, p) => (length(sub(p, face.center)) > length(sub(far, face.center)) + 1e-6 ? p : far), corners[0]);
      }
      face.up = unit(sub(target, face.center));
      face.right = cross(face.up, face.normal);
    }
    cache.set(kind, die);
    return die;
  }

  // Where each corner of a face sits on its square texture (0…1, v up), and
  // the radius used, so the number fits.
  function faceUVs(die, face) {
    const corners = face.corners.map((index) => die.points[index]);
    const rel = corners.map((p) => sub(p, face.center));
    const radius = Math.max(...rel.map(length)) * 1.04;
    return rel.map((p) => [0.5 + dot(p, face.right) / (2 * radius), 0.5 + dot(p, face.up) / (2 * radius)]);
  }

  // Rotates vector v by quaternion q = [x, y, z, w].
  function rotate(q, v) {
    const [x, y, z, w] = q;
    const u = [x, y, z];
    const t = scale(cross(u, v), 2);
    return add(add(v, scale(t, w)), cross(u, t));
  }

  // Which face (or, on a d4, which corner) of a die with rotation q points up:
  // { index, flat } where `flat` is false if it's cocked (leaning on something).
  function top(kind, q) {
    const die = build(kind);
    if (kind === 'coin') {
      // Heads or tails: whichever flat face is up. On its edge, it's cocked.
      const heads = die.faces.findIndex((f) => f.value === 1);
      const tails = die.faces.findIndex((f) => f.value === 2);
      const y = rotate(q, die.faces[heads].normal)[1];
      return { index: y >= 0 ? heads : tails, flat: Math.abs(y) > 0.9 };
    }
    if (kind === 'd4') {
      const ys = die.points.map((p) => rotate(q, p)[1]);
      let index = 0;
      ys.forEach((y, i) => { if (y > ys[index]) index = i; });
      const sorted = [...ys].sort((a, b) => b - a);
      // Resting flat, the top corner is well above the others.
      return { index, flat: sorted[0] - sorted[1] > 0.5 };
    }
    let index = 0;
    let best = -Infinity;
    die.faces.forEach((face, i) => {
      const y = rotate(q, face.normal)[1];
      if (y > best) { best = y; index = i; }
    });
    return { index, flat: best > 0.9 };
  }

  // The numbers printed on a die as made: one per face, or per corner on a d4.
  function defaultValues(kind) {
    const die = build(kind);
    return kind === 'd4' ? [...die.cornerValues] : die.faces.map((f) => f.value);
  }

  // Reads a die with rotation q and numbers `values` (default: as made).
  function read(kind, q, values = defaultValues(kind)) {
    const { index, flat } = top(kind, q);
    const value = values[index];
    return { value, label: label(kind, value), flat, index };
  }

  // The lowest and highest number on a die (a d10t's 0–9 mean 00–90).
  function range(kind) {
    if (kind === 'd10' || kind === 'd10t') return [0, 9];
    if (kind === 'coin') return [1, 2];
    return [1, build(kind).sides];
  }

  // Renumbers a die so face (or corner) `index` shows `wanted`, keeping
  // opposite faces adding up as before. Returns the new numbers.
  function relabel(kind, values, index, wanted) {
    const current = values[index];
    if (current === wanted) return values;
    const [low, high] = range(kind);
    const swap = new Map([[current, wanted], [wanted, current]]);
    if (kind !== 'd4' && wanted !== low + high - current) {
      swap.set(low + high - current, low + high - wanted);
      swap.set(low + high - wanted, low + high - current);
    }
    return values.map((v) => (swap.has(v) ? swap.get(v) : v));
  }

  // A roll's score: d10 shows 0 as 10; a d100 adds its tens and ones (00 + 0 = 100).
  function score(kind, value) {
    if (kind === 'coin') return label(kind, value);
    if (kind === 'd10') return value === 0 ? 10 : value;
    if (kind === 'd10t') return value * 10;
    return value;
  }

  // The dice one choice puts on the table: d100 is a tens die and a d10.
  function diceFor(type) {
    return type === 'd100' ? ['d10t', 'd10'] : [type];
  }

  const TYPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100', 'coin'];
  const SIDES = { d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20, d100: 100, coin: 2 };
  // The shapes a custom die can have.
  const CUSTOM_SIDES = [4, 6, 8, 10, 12, 20];

  // ---- Custom dice: your own words on a die's faces ----

  // def: { id, name, sides, faces: [text…] }. Its shape is the dN with that many
  // sides; the face printed with number k shows faces[k − 1] (on a d10, faces[k]).
  function customLabel(def, value) {
    const index = def.sides === 10 ? value : value - 1;
    return String(def.faces?.[index] ?? '');
  }

  // A face's number, if it reads as one: "+" is 1, "−" is −1, blank is 0, "3" is 3.
  function faceNumber(text) {
    const t = String(text).trim();
    if (t === '' || t === '0' || t === 'blank') return 0;
    if (t === '+') return 1;
    if (t === '−' || t === '-') return -1;
    const n = Number(t.replace('−', '-'));
    return Number.isFinite(n) ? n : null;
  }

  // Popular dice ready to use (shapes and words only).
  const PRESETS = [
    { id: 'preset-fate', name: 'Fate', sides: 6, faces: ['+', '+', '−', '−', '', ''] },
    { id: 'preset-oracle', name: 'Oracle', sides: 6, faces: ['Yes', 'Yes, and…', 'Yes, but…', 'No, but…', 'No, and…', 'No'] },
    { id: 'preset-direction', name: 'Direction', sides: 8, faces: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] },
    { id: 'preset-weather', name: 'Weather', sides: 6, faces: ['Clear', 'Cloudy', 'Rain', 'Storm', 'Fog', 'Snow'] },
    { id: 'preset-hit', name: 'Hit location', sides: 6, faces: ['Head', 'Chest', 'L arm', 'R arm', 'L leg', 'R leg'] },
    { id: 'preset-boost', name: 'Boost', sides: 6, faces: ['', '', 'Success', 'Success + Adv', 'Adv + Adv', 'Advantage'] },
    { id: 'preset-setback', name: 'Setback', sides: 6, faces: ['', '', 'Failure', 'Failure', 'Threat', 'Threat'] },
    { id: 'preset-ability', name: 'Ability', sides: 8, faces: ['', 'Success', 'Success', 'Success ×2', 'Advantage', 'Advantage', 'Success + Adv', 'Advantage ×2'] },
    { id: 'preset-difficulty', name: 'Difficulty', sides: 8, faces: ['', 'Failure', 'Failure ×2', 'Threat', 'Threat', 'Threat', 'Threat ×2', 'Failure + Threat'] },
    { id: 'preset-proficiency', name: 'Proficiency', sides: 12, faces: ['', 'Success', 'Success', 'Success ×2', 'Success ×2', 'Advantage', 'Success + Adv', 'Success + Adv', 'Success + Adv', 'Advantage ×2', 'Advantage ×2', 'Triumph'] },
    { id: 'preset-challenge', name: 'Challenge', sides: 12, faces: ['', 'Failure', 'Failure', 'Failure ×2', 'Failure ×2', 'Threat', 'Threat', 'Failure + Threat', 'Failure + Threat', 'Threat ×2', 'Threat ×2', 'Despair'] },
    { id: 'preset-food', name: 'Dinner', sides: 6, faces: ['Pizza', 'Tacos', 'Sushi', 'Burgers', 'Pasta', 'Chef\'s choice'] },
  ];

  // A custom die, checked: a name, a shape and one short text per face.
  function cleanCustom(def) {
    if (!def || typeof def !== 'object') return null;
    const id = String(def.id || '');
    if (!/^[\w-]{1,60}$/.test(id)) return null;
    const sides = Number(def.sides);
    if (!CUSTOM_SIDES.includes(sides) || !Array.isArray(def.faces)) return null;
    const faces = [];
    for (let i = 0; i < sides; i++) faces.push(String(def.faces[i] ?? '').slice(0, 24));
    return { id, name: String(def.name || 'Custom').slice(0, 30), sides, faces };
  }

  // The dice one choice puts on the table: d100 is a tens die and a d10; a
  // custom die is the dN with its number of sides.
  function diceFor(type, def) {
    if (type === 'custom') return [`d${def.sides}`];
    return type === 'd100' ? ['d10t', 'd10'] : [type];
  }

  // The dice a roll puts on the table, in order, and which of them make up
  // each choice. counts: { d20: 2, d6: 1, 'custom:<id>': 1 }; customs: the
  // custom dice it may use. Advantage and disadvantage are 2d20.
  function plan(counts, mode = 'normal', customs = []) {
    const groups = [];
    const kinds = [];
    const pool = mode === 'adv' || mode === 'dis' ? { d20: 2 } : counts;
    const used = [];
    const addGroup = (type, def) => {
      const dice = diceFor(type, def).map((kind) => { kinds.push(kind); return kinds.length - 1; });
      groups.push(def ? { type, die: def.id, dice } : { type, dice });
    };
    for (const type of TYPES) for (let i = 0; i < (pool[type] || 0); i++) addGroup(type);
    if (mode === 'normal') {
      for (const def of customs) {
        const n = pool[`custom:${def.id}`] || 0;
        if (n > 0) used.push(def);
        for (let i = 0; i < n; i++) addGroup('custom', def);
      }
    }
    return { groups, kinds, custom: used };
  }

  // A finished roll's numbers. roll: { mode, modifier, groups: [{ type, dice, die? }], custom? };
  // values: what each die shows, as printed (d10 0–9, d10t 0–9 for 00–90).
  // Returns { scores, kept, total, title, detail }. `total` is null when the
  // dice show words rather than numbers.
  function summarize(roll, values) {
    const modifier = Math.trunc(Number(roll.modifier) || 0);
    const customs = new Map((roll.custom || []).map((d) => [d.id, d]));
    let numeric = true;
    const labels = []; // what each group shows, for a roll of words
    const scores = roll.groups.map((g, i) => {
      if (g.type === 'd100') {
        const n = values[g.dice[0]] * 10 + values[g.dice[1]];
        return n === 0 ? 100 : n;
      }
      if (g.type === 'custom') {
        const def = customs.get(g.die);
        const text = def ? customLabel(def, values[g.dice[0]]) : '?';
        labels[i] = text || '—';
        // A die of numbers (like Fate's + − and blank) adds up; a die of words doesn't.
        if (def && def.faces.every((f) => faceNumber(f) !== null)) return faceNumber(text);
        numeric = false;
        return text || '—';
      }
      const s = score(g.type, values[g.dice[0]]);
      if (typeof s === 'string') numeric = false;
      return s;
    });
    const mod = modifier > 0 ? ` + ${modifier}` : modifier < 0 ? ` − ${-modifier}` : '';
    if (roll.mode === 'adv' || roll.mode === 'dis') {
      const kept = roll.mode === 'adv' ? Math.max(...scores) : Math.min(...scores);
      return {
        scores,
        kept,
        total: kept + modifier,
        title: `d20 with ${roll.mode === 'adv' ? 'advantage' : 'disadvantage'}${mod}`,
        detail: `${kept} (${scores.join(' | ')})${mod} = ${kept + modifier}`,
      };
    }
    const counts = {};
    for (const g of roll.groups) {
      const key = g.type === 'custom' ? `custom:${g.die}` : g.type;
      counts[key] = (counts[key] || 0) + 1;
    }
    const title = describe(counts, numeric ? modifier : 0, [...customs.values()]);
    if (!numeric) {
      // Words: list them; any numbers are shown as they are.
      return { scores, kept: null, total: null, title, detail: scores.map((x, i) => labels[i] ?? String(x)).join(', ') };
    }
    const sum = scores.reduce((x, y) => x + y, 0);
    const shown = scores.map((x) => (x < 0 ? `(−${-x})` : String(x)));
    return { scores, kept: null, total: sum + modifier, title, detail: `${shown.join(' + ')}${mod} = ${sum + modifier}` };
  }

  // "2d20 + 1d6 + 3", "Coin", "2 Oracle"
  function describe(counts, modifier = 0, customs = []) {
    const parts = TYPES.filter((t) => counts[t] > 0).map((t) => (t === 'coin' ? (counts[t] > 1 ? `${counts[t]} coins` : 'coin') : `${counts[t]}${t}`));
    for (const def of customs) {
      const n = counts[`custom:${def.id}`];
      if (n > 0) parts.push(n > 1 ? `${n} ${def.name}` : def.name);
    }
    let text = parts.join(' + ') || 'nothing';
    if (modifier > 0) text += ` + ${modifier}`;
    if (modifier < 0) text += ` − ${-modifier}`;
    return text;
  }

  // ---- The table: who rolled best, statistics ----

  // Every d20 a roll showed (both with advantage or disadvantage).
  function d20s(roll, values) {
    return roll.groups.filter((g) => g.type === 'd20').map((g) => values[g.dice[0]]);
  }

  // The d20s that count: all of them, or the kept one with advantage / disadvantage.
  function countedD20s(roll, values) {
    const faces = d20s(roll, values);
    if (roll.mode === 'adv') return faces.length ? [Math.max(...faces)] : [];
    if (roll.mode === 'dis') return faces.length ? [Math.min(...faces)] : [];
    return faces;
  }

  // Per person: rolls, d20s rolled and their average, natural 20s and 1s, and
  // the luckiest and unluckiest (highest and lowest d20 average, three d20s or more).
  // entries: [{ by, d20s: [n…], nat20, nat1 }]
  function stats(entries) {
    const people = new Map();
    for (const e of entries) {
      const p = people.get(e.by) || { name: e.by, rolls: 0, d20: 0, sum: 0, nat20: 0, nat1: 0 };
      p.rolls++;
      for (const v of e.d20s || []) { p.d20++; p.sum += v; }
      p.nat20 += e.nat20 || 0;
      p.nat1 += e.nat1 || 0;
      people.set(e.by, p);
    }
    const list = [...people.values()].map((p) => ({ ...p, average: p.d20 ? Math.round((p.sum / p.d20) * 10) / 10 : null }));
    list.sort((a, b) => b.rolls - a.rolls || a.name.localeCompare(b.name));
    const ranked = list.filter((p) => p.d20 >= 3).sort((a, b) => b.average - a.average);
    return {
      people: list,
      luckiest: ranked.length > 1 ? ranked[0].name : null,
      unluckiest: ranked.length > 1 ? ranked[ranked.length - 1].name : null,
    };
  }

  // Who won a "highest (or lowest) roll wins": results [{ name, total }] →
  // { ranking (best first), winners (more than one on a tie) }.
  function rank(results, lowest = false) {
    const ranking = [...results].filter((r) => typeof r.total === 'number')
      .sort((a, b) => (lowest ? a.total - b.total : b.total - a.total) || a.name.localeCompare(b.name));
    const best = ranking[0]?.total;
    return { ranking, winners: ranking.filter((r) => r.total === best).map((r) => r.name) };
  }

  // Initiative order: highest total first; ties go to the higher modifier, then by name.
  function initiativeOrder(entries) {
    return [...entries].sort((a, b) => b.total - a.total || (b.modifier || 0) - (a.modifier || 0) || a.name.localeCompare(b.name));
  }

  // Where the top face (on a d4, the top corner) points, in the world. A die
  // leaning on something is tipped until this points straight up.
  function upward(kind, q) {
    const die = build(kind);
    const { index } = top(kind, q);
    const local = kind === 'd4' ? die.points[index] : die.faces[index].normal;
    const v = rotate(q, local);
    const len = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / len, v[1] / len, v[2] / len];
  }

  const api = {
    build, faceUVs, top, upward, read, relabel, defaultValues, range, rotate, score, label,
    plan, summarize, describe, diceFor, hull, TYPES, SIDES, KINDS,
    customLabel, faceNumber, cleanCustom, PRESETS, CUSTOM_SIDES,
    d20s, countedD20s, stats, rank, initiativeOrder,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DiceGeometry = api;
})(typeof window !== 'undefined' ? window : globalThis);
