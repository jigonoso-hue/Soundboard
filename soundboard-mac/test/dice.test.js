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

test('coins, custom dice and ready-made ones', () => {
  const coin = G.build('coin');
  assert.deepEqual([...new Set(coin.faces.map((f) => f.value))].sort(), [0, 1, 2]);
  assert.equal(G.label('coin', 1), 'Heads');
  assert.equal(G.summarize({ groups: [{ type: 'coin', dice: [0] }] }, [2]).detail, 'Tails');
  assert.equal(G.describe({ coin: 3 }), '3 coins');

  const fate = G.PRESETS.find((d) => d.name === 'Fate');
  const plan = G.plan({ 'custom:preset-fate': 4 }, 'normal', G.PRESETS);
  assert.deepEqual(plan.custom.map((d) => d.id), ['preset-fate']);
  // Fate dice add up: + + − blank.
  const fateRoll = G.summarize({ ...plan, modifier: 1 }, [1, 2, 3, 5]);
  assert.equal(fateRoll.total, 1 + 1 - 1 + 0 + 1);
  assert.ok(fate.faces.every((f) => G.faceNumber(f) !== null));
  // Words don't: the faces are listed.
  const loot = G.cleanCustom({ id: 'loot', name: 'Loot', sides: 6, faces: ['Gold', 'Gem', 'Potion', 'Scroll', 'Nothing', 'Mimic!'] });
  const mixed = G.plan({ 'custom:loot': 1, 'custom:preset-fate': 1 }, 'normal', [loot, fate]);
  const words = G.summarize({ ...mixed, modifier: 0 }, mixed.groups[0].die === 'loot' ? [6, 3] : [3, 6]);
  assert.equal(words.total, null);
  assert.ok(words.detail.includes('Mimic!') && words.detail.includes('−'));
  // Bad dice are refused.
  assert.equal(G.cleanCustom({ id: 'x', name: 'X', sides: 7, faces: [] }), null);
  assert.equal(G.cleanCustom({ id: 'bad id!', name: 'X', sides: 6, faces: ['1', '2', '3', '4', '5', '6'] }), null);
});

test('statistics, who wins and initiative order', () => {
  const entry = (by, d20s) => ({ by, d20s, nat20: d20s.filter((v) => v === 20).length, nat1: d20s.filter((v) => v === 1).length });
  const { people, luckiest, unluckiest } = G.stats([
    entry('Sam', [20, 15, 18]), entry('Ana', [1, 4, 7]), entry('Jo', [10]),
  ]);
  assert.equal(people.find((p) => p.name === 'Sam').average, 17.7);
  assert.equal(people.find((p) => p.name === 'Ana').nat1, 1);
  assert.equal(luckiest, 'Sam');
  assert.equal(unluckiest, 'Ana');
  // Advantage counts only the kept d20.
  const adv = { mode: 'adv', groups: [{ type: 'd20', dice: [0] }, { type: 'd20', dice: [1] }] };
  assert.deepEqual(G.countedD20s(adv, [20, 3]), [20]);

  assert.deepEqual(G.rank([{ name: 'A', total: 9 }, { name: 'B', total: 15 }]).winners, ['B']);
  assert.deepEqual(G.rank([{ name: 'A', total: 9 }, { name: 'B', total: 15 }], true).winners, ['A']);
  assert.deepEqual(G.rank([{ name: 'A', total: 15 }, { name: 'B', total: 15 }]).winners, ['A', 'B']);

  const order = G.initiativeOrder([
    { name: 'Goblin', total: 14, modifier: 2 }, { name: 'Sam', total: 14, modifier: 3 }, { name: 'Ana', total: 19, modifier: 0 },
  ]);
  assert.deepEqual(order.map((e) => e.name), ['Ana', 'Sam', 'Goblin']);
});

test('upward: tipping a leaning die about n × up lays it flat on the same face', () => {
  const mul = (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
  for (const kind of ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'coin']) {
    for (let i = 0; i < 100; i++) {
      let q = [Math.sin(i * 1.7), Math.cos(i * 2.3), Math.sin(i * 0.9 + 1), Math.cos(i * 1.1 + 2)];
      const l = Math.hypot(...q);
      q = q.map((x) => x / l);
      const n = G.upward(kind, q);
      const angle = Math.acos(Math.max(-1, Math.min(1, n[1])));
      const len = Math.hypot(n[2], n[0]);
      if (len < 1e-6) continue;
      const s = Math.sin(angle / 2) / len;
      const tipped = mul([-n[2] * s, 0, n[0] * s, Math.cos(angle / 2)], q);
      assert.equal(G.top(kind, tipped).index, G.top(kind, q).index, kind);
      assert.ok(G.top(kind, tipped).flat, kind);
    }
  }
});
