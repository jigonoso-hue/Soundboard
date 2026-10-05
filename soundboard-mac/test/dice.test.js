const test = require('node:test');
const assert = require('node:assert');
const G = require('../src/renderer/dice-geometry');

const opposite = (die, i) => die.faces.findIndex((g) => g.normal.every((n, k) => Math.abs(n + die.faces[i].normal[k]) < 1e-6));

test('every die has the right faces, numbered like real dice', () => {
  const expect = { d4: [4, 3], d6: [6, 4], d8: [8, 3], d10: [10, 4], d10t: [10, 4], d12: [12, 5], d20: [20, 3] };
  for (const [kind, [faces, corners]] of Object.entries(expect)) {
    const die = G.build(kind);
    assert.equal(die.faces.length, faces, kind);
    assert.ok(die.faces.every((f) => f.corners.length === corners), `${kind} face shape`);
    assert.ok(die.faces.every((f) => f.normal.reduce((s, n, k) => s + n * f.center[k], 0) > 0), `${kind} faces point outwards`);
    if (kind === 'd4') continue;
    const values = die.faces.map((f) => f.value);
    assert.equal(new Set(values).size, faces, `${kind} numbers are all different`);
    const [low, high] = G.range(kind);
    die.faces.forEach((f, i) => assert.equal(f.value + die.faces[opposite(die, i)].value, low + high, `${kind} opposite faces`));
  }
});

test('reading a die, and renumbering it to land on a result', () => {
  // Turn a d20 so each face in turn points up: it reads that face.
  const die = G.build('d20');
  die.faces.forEach((face, i) => {
    // The rotation taking the face's normal to straight up.
    const n = face.normal;
    const axis = [-n[2], 0, n[0]]; // n × up
    const len = Math.hypot(...axis);
    const angle = Math.acos(Math.max(-1, Math.min(1, n[1])));
    const q = len < 1e-9 ? [0, 0, 0, 1] : [...axis.map((a) => (a / len) * Math.sin(angle / 2)), Math.cos(angle / 2)];
    const read = G.read('d20', q);
    assert.equal(read.index, i);
    assert.equal(read.value, face.value);
    assert.ok(read.flat);
    // Renumbered so this face shows 17: still 1–20 once each, opposites still add to 21.
    const values = G.relabel('d20', G.defaultValues('d20'), i, 17);
    assert.equal(values[i], 17);
    assert.equal(new Set(values).size, 20);
    die.faces.forEach((_, j) => assert.equal(values[j] + values[opposite(die, j)], 21));
  });
});

test('totals, advantage and disadvantage', () => {
  const normal = G.plan({ d20: 1, d6: 2, d100: 1 });
  assert.deepEqual(normal.kinds, ['d6', 'd6', 'd20', 'd10t', 'd10']);
  let s = G.summarize({ mode: 'normal', modifier: 3, groups: normal.groups }, [4, 2, 17, 0, 0]);
  assert.equal(s.total, 4 + 2 + 17 + 100 + 3);
  assert.equal(s.title, '2d6 + 1d20 + 1d100 + 3');
  s = G.summarize({ mode: 'normal', modifier: 0, groups: G.plan({ d10: 1, d100: 1 }).groups }, [0, 4, 7]);
  assert.deepEqual(s.scores, [10, 47]);
  const adv = G.plan({ d6: 3 }, 'adv');
  assert.deepEqual(adv.kinds, ['d20', 'd20']);
  s = G.summarize({ mode: 'adv', modifier: 2, groups: adv.groups }, [6, 15]);
  assert.equal(s.total, 17);
  assert.equal(s.detail, '15 (6 | 15) + 2 = 17');
  s = G.summarize({ mode: 'dis', modifier: -1, groups: adv.groups }, [6, 15]);
  assert.equal(s.total, 5);
  assert.equal(s.title, 'd20 with disadvantage − 1');
});
