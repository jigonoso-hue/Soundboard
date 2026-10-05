const test = require('node:test');
const assert = require('node:assert');
const Game = require('../src/game');

test('buzzer: order by when each press happened, one press each, only while armed', () => {
  const g = Game.create('buzzer', 1000);
  assert.equal(Game.input(g, 'p1', 'Sam', { id: g.id, buzz: true, at: 1100 }, 1100), false, 'not armed yet');
  Game.control(g, { action: 'arm' }, 2000);
  // Ana pressed first but her press arrived later.
  assert.ok(Game.input(g, 'p1', 'Sam', { id: g.id, buzz: true, at: 2300 }, 2350));
  assert.ok(Game.input(g, 'p2', 'Ana', { id: g.id, buzz: true, at: 2200 }, 2400));
  assert.equal(Game.input(g, 'p1', 'Sam', { id: g.id, buzz: true, at: 2250 }, 2450), false, 'one press each');
  assert.deepEqual(g.buzzes.map((b) => [b.name, b.ms]), [['Ana', 200], ['Sam', 300]]);
  // A claimed time before arming or after arrival is kept in range.
  assert.ok(Game.input(g, 'p3', 'Jo', { id: g.id, buzz: true, at: 9999 }, 2500));
  assert.equal(g.buzzes.at(-1).ms, 500);
  assert.equal(Game.input(g, 'p4', 'Bo', { id: 'other', buzz: true }, 2600), false, 'another game');
  Game.control(g, { action: 'arm' }, 3000);
  assert.equal(g.buzzes.length, 0);
  assert.equal(g.round, 2);
});

test('quiz: answers, points for speed, votes, the leaderboard and what listeners see', () => {
  const g = Game.create('quiz', 0);
  assert.equal(Game.control(g, { action: 'ask', text: 'Q', answers: ['only one'] }, 0), false, 'needs two answers');
  Game.control(g, { action: 'ask', text: 'Capital of France?', answers: ['Paris', 'Rome', '', 'Oslo'], correct: 0, timer: 20 }, 1000);
  assert.deepEqual(g.question.answers, ['Paris', 'Rome', 'Oslo']);
  const view = Game.publicView(g, 1000);
  assert.equal(view.correct, undefined, 'the right answer stays secret');
  assert.equal(view.question.left, 20000);
  assert.ok(Game.input(g, 'p1', 'Sam', { id: g.id, q: 1, choice: 0, at: 1000 }, 1100, 3));
  assert.ok(Game.input(g, 'p2', 'Ana', { id: g.id, q: 1, choice: 0, at: 11000 }, 11000, 3));
  assert.equal(Game.input(g, 'p2', 'Ana', { id: g.id, q: 1, choice: 1 }, 11000, 3), false, 'one answer each');
  assert.equal(Game.input(g, 'p3', 'Jo', { id: g.id, q: 1, choice: 7 }, 12000, 3), false, 'no such answer');
  assert.equal(Game.publicView(g).answers, undefined, 'listeners never see who chose what before the reveal');
  assert.equal(Game.hostView(g).answers.length, 2);
  // The last listener answering ends the question.
  assert.ok(Game.input(g, 'p3', 'Jo', { id: g.id, q: 1, choice: 1 }, 12000, 3));
  assert.equal(g.phase, 'reveal');
  const shown = Game.publicView(g);
  assert.equal(shown.correct, 0);
  assert.deepEqual(shown.counts, [2, 1, 0]);
  assert.deepEqual(shown.leaderboard.map((p) => [p.name, p.score]), [['Sam', 1000], ['Ana', 750], ['Jo', 0]]);
  // A vote: no points.
  Game.control(g, { action: 'ask', text: 'Pizza or tacos?', answers: ['Pizza', 'Tacos'], correct: null }, 20000);
  Game.input(g, 'p1', 'Sam', { id: g.id, q: 2, choice: 1 }, 20500, 3);
  assert.equal(Game.input(g, 'p1', 'Sam', { id: g.id, q: 1, choice: 0 }, 20600, 3), false, 'an old question');
  Game.control(g, { action: 'reveal' });
  assert.equal(g.scores.get('p1').score, 1000);
  assert.equal(Game.publicView(g).correct, null);
  // Too late on a timed question.
  Game.control(g, { action: 'ask', text: 'Fast', answers: ['a', 'b'], correct: 0, timer: 10 }, 30000);
  assert.equal(Game.input(g, 'p1', 'Sam', { id: g.id, q: 3, choice: 0 }, 41000, 3), false);
  Game.control(g, { action: 'final' });
  assert.equal(g.phase, 'final');
  assert.equal(Game.publicView(null).phase, 'off');
});
