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
  };

  function cornerPoints(kind) {
    switch (kind) {
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
    if (faces.length !== (kind === 'd10t' ? 10 : info.sides)) throw new Error(`${kind} has ${faces.length} faces`);
    const die = { kind, sides: info.sides, points, faces };
    if (kind === 'd4') {
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
    if (kind === 'd10') return value === 0 ? 10 : value;
    if (kind === 'd10t') return value * 10;
    return value;
  }

  // The dice one choice puts on the table: d100 is a tens die and a d10.
  function diceFor(type) {
    return type === 'd100' ? ['d10t', 'd10'] : [type];
  }

  const TYPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'];
  const SIDES = { d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20, d100: 100 };

  // The dice a roll puts on the table, in order, and which of them make up
  // each choice. counts: { d20: 2, d6: 1 }. Advantage and disadvantage are 2d20.
  function plan(counts, mode = 'normal') {
    const groups = [];
    const kinds = [];
    const pool = mode === 'adv' || mode === 'dis' ? { d20: 2 } : counts;
    for (const type of TYPES) {
      for (let i = 0; i < (pool[type] || 0); i++) {
        const dice = diceFor(type).map((kind) => { kinds.push(kind); return kinds.length - 1; });
        groups.push({ type, dice });
      }
    }
    return { groups, kinds };
  }

  // A finished roll's numbers. roll: { mode, modifier, groups: [{ type, dice }] };
  // values: what each die shows, as printed (d10 0–9, d10t 0–9 for 00–90).
  // Returns { scores, kept, total, title, detail }.
  function summarize(roll, values) {
    const modifier = Math.trunc(Number(roll.modifier) || 0);
    const scores = roll.groups.map((g) => {
      if (g.type === 'd100') {
        const n = values[g.dice[0]] * 10 + values[g.dice[1]];
        return n === 0 ? 100 : n;
      }
      return score(g.type, values[g.dice[0]]);
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
    for (const g of roll.groups) counts[g.type] = (counts[g.type] || 0) + 1;
    const sum = scores.reduce((x, y) => x + y, 0);
    return { scores, kept: null, total: sum + modifier, title: describe(counts, modifier), detail: `${scores.join(' + ')}${mod} = ${sum + modifier}` };
  }

  // "2d20 + 1d6 + 3"
  function describe(counts, modifier = 0) {
    const parts = TYPES.filter((t) => counts[t] > 0).map((t) => `${counts[t]}${t}`);
    let text = parts.join(' + ') || 'nothing';
    if (modifier > 0) text += ` + ${modifier}`;
    if (modifier < 0) text += ` − ${-modifier}`;
    return text;
  }

  const api = {
    build, faceUVs, top, read, relabel, defaultValues, range, rotate, score, label,
    plan, summarize, describe, diceFor, hull, TYPES, SIDES, KINDS,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DiceGeometry = api;
})(typeof window !== 'undefined' ? window : globalThis);
