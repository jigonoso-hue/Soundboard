// Games the broadcaster runs for everyone in a Live Session: a buzzer and a
// quiz. The host keeps the game and decides everything (who buzzed first, which
// answers are right, the scores), so listeners can't cheat by sending anything
// else. While a game runs, listeners' screens are locked to it.
// The iPad app's LiveGame.swift is a copy of this; keep the two the same.
//
// Buzzer: the broadcaster arms it; listeners press; the order is by when each
// press happened (in the host's clock), not when it arrived.
// Quiz: a question with 2–4 answers, an optional right answer (none: a vote)
// and an optional time limit. Right answers score up to 1000 points, more for
// answering fast; scores add up over the quiz.

const KINDS = ['buzzer', 'quiz'];
const TIMERS = [0, 10, 20, 30, 60];

const clean = (text, max) => String(text ?? '').trim().slice(0, max);
const newId = (now) => `game-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

function create(kind, now = Date.now()) {
  if (!KINDS.includes(kind)) return null;
  const game = { id: newId(now), kind, round: 0 };
  if (kind === 'buzzer') Object.assign(game, { phase: 'waiting', armedAt: 0, buzzes: [] });
  else Object.assign(game, { phase: 'lobby', n: 0, question: null, answers: new Map(), scores: new Map(), points: new Map() });
  return game;
}

// Points for a right answer: up to 1000, less the longer it took.
function points(ms, timer) {
  if (timer > 0) return Math.round(1000 * (1 - 0.5 * Math.min(1, ms / (timer * 1000))));
  return Math.max(500, Math.round(1000 - ms / 20));
}

// A command from the broadcaster. Returns true if the game changed.
function control(game, cmd, now = Date.now()) {
  if (!game || !cmd) return false;
  if (game.kind === 'buzzer') {
    if (cmd.action === 'arm') {
      Object.assign(game, { phase: 'armed', armedAt: now, buzzes: [], round: game.round + 1 });
      return true;
    }
    if (cmd.action === 'reset') {
      Object.assign(game, { phase: 'waiting', armedAt: 0, buzzes: [] });
      return true;
    }
    return false;
  }
  if (cmd.action === 'ask') {
    const answers = (Array.isArray(cmd.answers) ? cmd.answers : []).map((a) => clean(a, 80)).filter(Boolean).slice(0, 4);
    if (answers.length < 2) return false;
    const correct = Number.isInteger(cmd.correct) && cmd.correct >= 0 && cmd.correct < answers.length ? cmd.correct : null;
    const timer = TIMERS.includes(Number(cmd.timer)) ? Number(cmd.timer) : 0;
    game.n += 1;
    game.question = { text: clean(cmd.text, 200) || 'Question', answers, correct, timer, startedAt: now, endsAt: timer ? now + timer * 1000 : 0 };
    game.answers = new Map();
    game.points = new Map();
    game.phase = 'question';
    return true;
  }
  if (cmd.action === 'reveal') return reveal(game);
  if (cmd.action === 'final') {
    if (game.phase === 'question') reveal(game);
    game.phase = 'final';
    return true;
  }
  if (cmd.action === 'lobby') {
    game.phase = 'lobby';
    return true;
  }
  return false;
}

// Ends a question: right answers score.
function reveal(game) {
  if (game.kind !== 'quiz' || game.phase !== 'question') return false;
  const q = game.question;
  game.points = new Map();
  for (const [peer, a] of game.answers) {
    const right = q.correct !== null && a.choice === q.correct;
    const got = right ? points(a.ms, q.timer) : 0;
    game.points.set(peer, got);
    const s = game.scores.get(peer) || { name: a.name, score: 0, right: 0 };
    s.name = a.name;
    s.score += got;
    if (right) s.right += 1;
    game.scores.set(peer, s);
  }
  game.phase = 'reveal';
  return true;
}

// A listener's press or answer. `at` is when it happened in the host's clock
// (from the listener's clock sync); it's kept between the start and now.
// expected: how many listeners can answer (all answered → the question ends).
// Returns true if the game changed.
function input(game, peer, name, msg, now = Date.now(), expected = Infinity) {
  if (!game || !msg || msg.id !== game.id) return false;
  if (game.kind === 'buzzer') {
    if (game.phase !== 'armed' || msg.buzz !== true || game.buzzes.some((b) => b.peer === peer)) return false;
    const at = Number.isFinite(Number(msg.at)) ? Number(msg.at) : now;
    const ms = Math.round(Math.min(now - game.armedAt, Math.max(0, at - game.armedAt)));
    game.buzzes.push({ peer, name, ms });
    game.buzzes.sort((a, b) => a.ms - b.ms);
    return true;
  }
  const q = game.question;
  if (game.phase !== 'question' || msg.q !== game.n || game.answers.has(peer)) return false;
  if (!Number.isInteger(msg.choice) || msg.choice < 0 || msg.choice >= q.answers.length) return false;
  const at = Number.isFinite(Number(msg.at)) ? Number(msg.at) : now;
  const ms = Math.round(Math.min(now - q.startedAt, Math.max(0, at - q.startedAt)));
  if (q.timer && ms > q.timer * 1000 + 500) return false;
  game.answers.set(peer, { name, choice: msg.choice, ms });
  if (game.answers.size >= expected) reveal(game);
  return true;
}

function leaderboard(game) {
  return [...game.scores].map(([peer, s]) => ({ peer, name: s.name, score: s.score, right: s.right }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

// What everyone sees. Before the reveal nobody learns the right answer or who
// chose what. `now` turns the deadline into time left.
function publicView(game, now = Date.now()) {
  if (!game) return { t: 'game', phase: 'off' };
  const base = { t: 'game', id: game.id, kind: game.kind, phase: game.phase, round: game.round };
  if (game.kind === 'buzzer') return { ...base, buzzes: game.buzzes.map(({ peer, name, ms }) => ({ peer, name, ms })) };
  const view = { ...base, n: game.n, answered: game.answers.size };
  const q = game.question;
  if (q) {
    view.question = { text: q.text, answers: q.answers, timer: q.timer, left: q.endsAt ? Math.max(0, q.endsAt - now) : 0, vote: q.correct === null };
  }
  if (q && (game.phase === 'reveal' || game.phase === 'final')) {
    view.correct = q.correct;
    view.counts = q.answers.map((_, i) => [...game.answers.values()].filter((a) => a.choice === i).length);
    view.results = [...game.answers].map(([peer, a]) => ({ peer, choice: a.choice, points: game.points.get(peer) || 0 }));
  }
  if (game.phase !== 'question') view.leaderboard = leaderboard(game).slice(0, 10);
  return view;
}

// What the broadcaster sees: everything, including who has answered what so far.
function hostView(game, now = Date.now()) {
  const view = publicView(game, now);
  if (!game || game.kind !== 'quiz') return view;
  if (game.question) view.correct = game.question.correct;
  view.answers = [...game.answers].map(([peer, a]) => ({ peer, name: a.name, choice: a.choice, ms: a.ms }));
  view.leaderboard = leaderboard(game).slice(0, 10);
  return view;
}

module.exports = { KINDS, TIMERS, create, control, input, reveal, points, publicView, hostView, leaderboard };
