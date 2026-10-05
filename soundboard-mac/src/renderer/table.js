/* global Live, DiceGeometry */
// The broadcaster's table, on top of the dice (dice.js): roll requests
// ("Everyone: Dexterity save, DC 14"), initiative with a shared turn order and
// a "your turn" nudge, and "who goes first / who pays" (everyone rolls, the
// highest wins). The broadcaster runs them from panels in the dice tray;
// listeners get a card to roll from, and everyone sees the results.
// Matches the iPad app's TableView.swift.
const G = DiceGeometry;
const Tray = window.DiceTray;

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (text, className, onClick, title) => {
  const b = el('button', className, text);
  b.type = 'button';
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
};
const signed = (n) => (n > 0 ? `+${n}` : String(n));
const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const hosting = () => Live.hosting();
const inSession = () => Live.hosting() || Live.listening();

// What a request rolls.
const DICE_CHOICES = [
  ['d20', { d20: 1 }], ['d12', { d12: 1 }], ['d10', { d10: 1 }], ['d8', { d8: 1 }], ['d6', { d6: 1 }],
  ['2d6', { d6: 2 }], ['d4', { d4: 1 }], ['d100', { d100: 1 }], ['Coin', { coin: 1 }],
];
const CHECKS = [
  'Strength save', 'Dexterity save', 'Constitution save', 'Intelligence save', 'Wisdom save', 'Charisma save',
  'Perception check', 'Stealth check', 'Insight check', 'Investigation check', 'Athletics check', 'Acrobatics check',
  'Persuasion check', 'Deception check', 'Arcana check', 'Survival check',
];
const CONTESTS = ['Who goes first?', 'Who pays?', 'Who takes watch?', 'Who opens the door?'];

// ---------------------------------------------------------------------
// Overlays: request cards, result cards, the turn strip.

const asksBox = el('div', 'table-asks');
const resultsBox = el('div', 'table-results');
const strip = el('div', 'table-turns hidden');
const column = el('div', 'table-column');
column.append(asksBox, resultsBox);
document.body.append(column, strip);

// ---------------------------------------------------------------------
// The broadcaster's side.

// A request in progress: { id, kind, label, counts, dc, showDC, lowest, to, results: Map(key -> result) }
// kind is 'check' (a save or check), 'initiative' or 'contest' (highest wins).
let check = null;
let contest = null;
let lastContest = null; // the finished one, for a tie's roll-off
const draft = { label: 'Dexterity save', dice: 'd20', dc: 14, showDC: true, to: 'all', picked: new Set() };
const contestDraft = { label: 'Who goes first?', lowest: false, includeMe: true };

// Initiative: the enemies the broadcaster rolls for, the results, the order.
const init = {
  enemies: [], // [{ name, modifier }]
  askId: null,
  entries: new Map(), // key -> { key, name, peer, total, modifier, enemy }
  phase: 'off', // off | rolling | running
  round: 1,
  current: 0,
  order: [],
};
try { init.enemies = JSON.parse(localStorage.getItem('table.enemies') || '[]').slice(0, 20); } catch { /* ignore */ }
const saveEnemies = () => { try { localStorage.setItem('table.enemies', JSON.stringify(init.enemies)); } catch { /* ignore */ } };

const peers = () => Live.peers();
const peerName = (id) => (id === 'host' ? Live.myName() : peers().find((p) => p.peer === id)?.name);

// Every finished roll passes through here; the ones answering a request count once per person.
Tray.onResult(({ start, summary }) => {
  if (!hosting() || !start.ask) return;
  const peer = start.peer && start.peer !== 'host' ? start.peer : null;
  const key = peer || `name:${start.by}`;
  const result = { key, name: start.by, peer, total: summary.total, detail: summary.detail, modifier: start.modifier || 0 };
  if (init.askId === start.ask && init.phase !== 'off') {
    // Only the first roll counts.
    if (init.entries.has(key)) return;
    init.entries.set(key, { ...result, enemy: !peer && start.by !== Live.myName() });
    buildOrder();
    sendTurns();
  } else {
    const ask = [check, contest].find((a) => a && a.id === start.ask);
    if (!ask || ask.results.has(key)) return;
    ask.results.set(key, result);
    if (ask === contest) maybeFinishContest();
  }
  Tray.refreshPanel();
});

function sendAsk(ask) {
  const { id, kind, label, counts, lowest } = ask;
  const message = { t: 'ask', id, kind, label, counts };
  if (kind === 'check' && ask.dc && ask.showDC) message.dc = ask.dc;
  if (kind === 'contest') message.lowest = !!lowest;
  if (ask.to) message.to = ask.to;
  Live.tableSend(message);
}

function closeAsk(ask) {
  if (!ask) return;
  Live.tableSend({ t: 'askClosed', id: ask.id });
}

// ---- Roll requests ----

function sendCheck() {
  closeCheck(false);
  const counts = DICE_CHOICES.find(([name]) => name === draft.dice)?.[1] || { d20: 1 };
  const to = draft.to === 'all' ? null : [...draft.picked].filter((p) => peers().some((x) => x.peer === p));
  if (to && !to.length) return;
  check = { id: newId('ask'), kind: 'check', label: draft.label.trim() || 'Roll', counts, dc: draft.dc || null, showDC: draft.showDC, to, results: new Map() };
  sendAsk(check);
  Tray.refreshPanel();
}

// Closing a request with a known DC shows everyone who passed (if the DC was shown).
function closeCheck(share = true) {
  if (!check) return;
  closeAsk(check);
  if (share && check.results.size) {
    const results = [...check.results.values()].map((r) => ({
      name: r.name, total: r.total, pass: check.dc && typeof r.total === 'number' ? r.total >= check.dc : null,
    }));
    const message = { t: 'askResult', id: check.id, kind: 'check', label: check.label, results };
    if (check.dc && check.showDC) message.dc = check.dc;
    if (check.showDC || !check.dc) Live.tableSend(message);
    // The broadcaster always sees pass and fail.
    showResult({ ...message, dc: check.dc });
  }
  check = null;
  Tray.refreshPanel();
}

function renderAskPanel(box) {
  box.append(el('div', 'dice-log-title', 'Ask for a roll'));
  if (check) {
    const head = el('div', 'table-ask-live');
    head.append(el('b', null, check.label), el('span', 'muted', `${describeCounts(check.counts)}${check.dc ? ` · DC ${check.dc}${check.showDC ? '' : ' (hidden)'}` : ''}`));
    box.append(head);
    const expected = check.to || peers().map((p) => p.peer);
    const list = el('div', 'table-result-list');
    for (const r of check.results.values()) list.append(resultRow(r.name, r.total, check.dc ? r.total >= check.dc : null, r.detail));
    for (const peer of expected) {
      if (check.results.has(peer)) continue;
      const name = peerName(peer);
      if (name) list.append(resultRow(name, null, null, 'rolling…'));
    }
    if (!list.childNodes.length) list.append(el('p', 'dice-log-empty', 'No one has tuned in yet.'));
    box.append(list);
    box.append(button(check.dc && check.showDC ? 'Close and show results' : 'Close request', 'primary table-wide', () => closeCheck(true)));
    return;
  }
  const form = el('div', 'table-form');
  const label = el('input');
  label.value = draft.label;
  label.maxLength = 40;
  label.placeholder = 'e.g. Dexterity save';
  label.setAttribute('list', 'table-checks');
  label.addEventListener('input', () => { draft.label = label.value; });
  const list = el('datalist');
  list.id = 'table-checks';
  for (const c of CHECKS) { const o = el('option'); o.value = c; list.append(o); }
  form.append(el('label', 'dice-field', 'What to roll'), label, list);

  const quick = el('div', 'table-chips');
  for (const c of ['Dexterity save', 'Wisdom save', 'Constitution save', 'Perception check', 'Stealth check']) {
    quick.append(button(c.replace(' save', '').replace(' check', ''), `dice-pill small${draft.label === c ? ' on' : ''}`, () => { draft.label = c; Tray.refreshPanel(); }, c));
  }
  form.append(quick);

  const row = el('div', 'table-row');
  const dice = el('select');
  for (const [name] of DICE_CHOICES) { const o = el('option', null, name); o.value = name; dice.append(o); }
  dice.value = draft.dice;
  dice.addEventListener('change', () => { draft.dice = dice.value; });
  const dc = el('input');
  dc.type = 'number';
  dc.min = '1';
  dc.max = '40';
  dc.placeholder = 'none';
  dc.value = draft.dc ? String(draft.dc) : '';
  dc.className = 'table-dc';
  dc.addEventListener('input', () => { const n = parseInt(dc.value, 10); draft.dc = n > 0 ? Math.min(40, n) : null; });
  const diceField = el('label', 'dice-field', 'Dice');
  diceField.append(dice);
  const dcField = el('label', 'dice-field', 'DC');
  dcField.append(dc);
  row.append(diceField, dcField);
  form.append(row);

  const show = el('label', 'table-check');
  const showBox = el('input');
  showBox.type = 'checkbox';
  showBox.checked = draft.showDC;
  showBox.addEventListener('change', () => { draft.showDC = showBox.checked; });
  show.append(showBox, el('span', null, 'Show the DC to listeners'));
  form.append(show);

  form.append(el('label', 'dice-field', 'Who rolls'));
  const who = el('div', 'table-chips');
  who.append(button('Everyone', `dice-pill small${draft.to === 'all' ? ' on' : ''}`, () => { draft.to = 'all'; Tray.refreshPanel(); }));
  for (const p of peers()) {
    const on = draft.to === 'some' && draft.picked.has(p.peer);
    who.append(button(p.name, `dice-pill small${on ? ' on' : ''}`, () => {
      if (draft.to === 'all') { draft.to = 'some'; draft.picked.clear(); }
      if (draft.picked.has(p.peer)) draft.picked.delete(p.peer); else draft.picked.add(p.peer);
      if (!draft.picked.size) draft.to = 'all';
      Tray.refreshPanel();
    }));
  }
  form.append(who);
  if (!peers().length) form.append(el('p', 'muted small', 'Listeners who tune in get a card to roll from.'));
  const send = button('Send request', 'primary table-wide', sendCheck);
  form.append(send);
  box.append(form);
}

function resultRow(name, total, pass, detail) {
  const row = el('div', `table-result${pass === true ? ' pass' : pass === false ? ' fail' : ''}${total === null ? ' waiting' : ''}`);
  row.append(el('b', null, name), el('span', 'table-result-detail', detail || ''));
  row.append(el('span', 'table-result-total', total === null ? '…' : total === undefined ? '—' : String(total)));
  if (pass !== null) row.append(el('span', 'table-pass', pass ? '✓' : '✗'));
  return row;
}

function describeCounts(counts) {
  return G.describe(counts || { d20: 1 }, 0, []);
}

// ---- Initiative ----

function rollInitiative() {
  closeAsk(init.askId ? { id: init.askId } : null);
  init.askId = newId('init');
  init.entries.clear();
  init.phase = 'rolling';
  init.round = 1;
  init.current = 0;
  init.order = [];
  Live.tableSend({ t: 'ask', id: init.askId, kind: 'initiative', label: 'Initiative', counts: { d20: 1 } });
  sendTurns();
  // The broadcaster rolls for the enemies, one after another.
  init.enemies.forEach((enemy, i) => {
    setTimeout(() => {
      if (init.phase === 'off') return;
      Tray.roll('normal', 1, { counts: { d20: 1 }, modifier: enemy.modifier, ask: init.askId, by: enemy.name, owner: `enemy:${enemy.name}` });
    }, 350 * i);
  });
  Tray.refreshPanel();
}

function buildOrder() {
  init.order = G.initiativeOrder([...init.entries.values()].filter((e) => typeof e.total === 'number'))
    .map(({ name, peer, total, modifier, enemy }) => ({ name, peer, total, modifier, enemy: !!enemy }));
}

function startTurns() {
  if (!init.order.length) return;
  init.phase = 'running';
  init.round = 1;
  init.current = 0;
  // Late rolls don't join a fight that has started; the request goes away.
  closeAsk({ id: init.askId });
  sendTurns();
  Tray.refreshPanel();
}

function stepTurn(by) {
  if (init.phase !== 'running' || !init.order.length) return;
  init.current += by;
  if (init.current >= init.order.length) { init.current = 0; init.round++; }
  if (init.current < 0) { if (init.round > 1) { init.current = init.order.length - 1; init.round--; } else init.current = 0; }
  sendTurns();
  Tray.refreshPanel();
}

function endTurns() {
  if (init.askId) closeAsk({ id: init.askId });
  init.phase = 'off';
  init.askId = null;
  init.entries.clear();
  init.order = [];
  sendTurns();
  Tray.refreshPanel();
}

function turnsMessage() {
  if (init.phase === 'off') return { t: 'turns', phase: 'off' };
  return { t: 'turns', phase: init.phase, round: init.round, current: init.current, order: init.order };
}

function sendTurns() {
  const message = turnsMessage();
  Live.tableSend(message);
  showTurns({ ...message, you: 'host' });
}

function renderInitiativePanel(box) {
  box.append(el('div', 'dice-log-title', 'Initiative'));
  if (init.phase === 'off') {
    box.append(el('p', 'muted small', 'Everyone gets a card to roll a d20 plus their initiative modifier. You roll for the enemies. Only each person\'s first roll counts.'));
    box.append(el('div', 'dice-custom-head', 'Enemies'));
    const list = el('div', 'table-enemies');
    init.enemies.forEach((enemy, i) => {
      const row = el('div', 'table-enemy');
      const name = el('input');
      name.value = enemy.name;
      name.maxLength = 30;
      name.addEventListener('input', () => { enemy.name = name.value.trim() || `Enemy ${i + 1}`; saveEnemies(); });
      const mod = stepper(enemy.modifier, (n) => { enemy.modifier = n; saveEnemies(); });
      row.append(name, mod, button('✕', 'dice-pill small', () => { init.enemies.splice(i, 1); saveEnemies(); Tray.refreshPanel(); }, 'Remove'));
      list.append(row);
    });
    box.append(list);
    box.append(button('＋ Add enemy', 'dice-pill', () => {
      const base = init.enemies.length ? init.enemies[init.enemies.length - 1].name.replace(/\s*\d+$/, '') : 'Goblin';
      init.enemies.push({ name: `${base} ${init.enemies.filter((e) => e.name.startsWith(base)).length + 1}`, modifier: init.enemies.at(-1)?.modifier || 0 });
      saveEnemies();
      Tray.refreshPanel();
    }));
    box.append(button('⚔️ Roll initiative', 'primary table-wide', rollInitiative));
    return;
  }
  const order = el('div', 'table-order');
  init.order.forEach((e, i) => {
    const row = el('div', `table-order-row${init.phase === 'running' && i === init.current ? ' current' : ''}${e.enemy ? ' enemy' : ''}`);
    row.append(el('span', 'table-order-n', String(i + 1)), el('b', null, e.name), el('span', 'muted small', signed(e.modifier)), el('span', 'table-result-total', String(e.total)));
    order.append(row);
  });
  if (init.phase === 'rolling') {
    const waiting = peers().filter((p) => !init.entries.has(p.peer));
    for (const p of waiting) { const row = el('div', 'table-order-row waiting'); row.append(el('span', 'table-order-n', '…'), el('b', null, p.name), el('span', 'muted small', 'rolling…')); order.append(row); }
  }
  if (init.phase === 'running') box.append(el('div', 'table-round', `Round ${init.round}`));
  box.append(order);
  if (init.phase === 'rolling') {
    const go = button('▶ Start', 'primary table-wide', startTurns, 'Start the fight in this order');
    go.disabled = !init.order.length;
    box.append(go);
  } else {
    const nav = el('div', 'table-row');
    nav.append(button('◀ Back', 'dice-pill', () => stepTurn(-1)), button('Next turn ▶', 'primary', () => stepTurn(1)));
    box.append(nav);
  }
  box.append(button('End initiative', 'dice-pill danger table-wide', endTurns));
}

function stepper(value, onChange) {
  const box = el('div', 'table-stepper');
  const show = el('span', 'table-stepper-value', signed(value));
  const set = (n) => { value = Math.max(-20, Math.min(30, n)); show.textContent = signed(value); onChange(value); };
  box.append(button('−', 'dice-pill small', () => set(value - 1)), show, button('+', 'dice-pill small', () => set(value + 1)));
  return box;
}

// ---- Who goes first / who pays ----

function startContest(label, lowest, to, includeMe) {
  if (contest) closeAsk(contest);
  contest = { id: newId('who'), kind: 'contest', label, counts: { d20: 1 }, lowest, to, includeMe, results: new Map() };
  sendAsk(contest);
  // The broadcaster rolls too.
  if (includeMe) setTimeout(() => Tray.roll('normal', 1, { counts: { d20: 1 }, modifier: 0, ask: contest.id }), 200);
  Tray.refreshPanel();
}

function contestExpected() {
  const list = contest.to || peers().map((p) => p.peer);
  return list.filter((p) => peers().some((x) => x.peer === p)).length + (contest.includeMe ? 1 : 0);
}

function maybeFinishContest() {
  if (contest && contest.results.size >= contestExpected()) setTimeout(finishContest, 900);
}

function finishContest() {
  if (!contest) return;
  const { ranking, winners } = G.rank([...contest.results.values()], contest.lowest);
  closeAsk(contest);
  const message = { t: 'askResult', id: contest.id, kind: 'contest', label: contest.label, lowest: contest.lowest, ranking: ranking.map(({ name, total }) => ({ name, total })), winners };
  Live.tableSend(message);
  showResult(message);
  lastContest = { ...contest, winners, ranking };
  contest = null;
  Tray.refreshPanel();
}

// A tie: just the tied people roll again.
function rollOff() {
  if (!lastContest || lastContest.winners.length < 2) return;
  const tied = lastContest.ranking.filter((r) => lastContest.winners.includes(r.name));
  const to = tied.map((r) => r.peer).filter(Boolean);
  const includeMe = tied.some((r) => !r.peer);
  lastContest = null;
  startContest(`${contestDraft.label.replace(/\?$/, '')} — roll-off`, contestDraft.lowest, to, includeMe);
}

function renderContestPanel(box) {
  box.append(el('div', 'dice-log-title', 'Who wins?'));
  if (contest) {
    box.append(el('div', 'table-ask-live', contest.label));
    const list = el('div', 'table-result-list');
    for (const r of contest.results.values()) list.append(resultRow(r.name, r.total, null, r.detail));
    for (const p of contest.to || peers().map((x) => x.peer)) {
      if (!contest.results.has(p) && peerName(p)) list.append(resultRow(peerName(p), null, null, 'rolling…'));
    }
    box.append(list);
    box.append(button('Finish now', 'primary table-wide', finishContest, 'Pick the winner from the rolls so far'));
    return;
  }
  if (lastContest && lastContest.winners.length > 1) {
    box.append(el('p', 'table-tie', `Tie: ${lastContest.winners.join(' and ')}`));
    box.append(button('🎲 Roll-off', 'primary table-wide', rollOff, 'Only the tied people roll again'));
  }
  const form = el('div', 'table-form');
  const quick = el('div', 'table-chips');
  for (const c of CONTESTS) quick.append(button(c, `dice-pill small${contestDraft.label === c ? ' on' : ''}`, () => { contestDraft.label = c; contestDraft.lowest = c === 'Who pays?' ? contestDraft.lowest : false; Tray.refreshPanel(); }));
  form.append(quick);
  const label = el('input');
  label.value = contestDraft.label;
  label.maxLength = 40;
  label.addEventListener('input', () => { contestDraft.label = label.value; });
  form.append(el('label', 'dice-field', 'Question'), label);
  const winner = el('div', 'segmented table-seg');
  for (const [lowest, text] of [[false, 'Highest wins'], [true, 'Lowest wins']]) {
    winner.append(button(text, contestDraft.lowest === lowest ? 'active' : '', () => { contestDraft.lowest = lowest; Tray.refreshPanel(); }));
  }
  form.append(winner);
  const me = el('label', 'table-check');
  const meBox = el('input');
  meBox.type = 'checkbox';
  meBox.checked = contestDraft.includeMe;
  meBox.addEventListener('change', () => { contestDraft.includeMe = meBox.checked; });
  me.append(meBox, el('span', null, 'I roll too'));
  form.append(me);
  form.append(button('🎲 Everyone roll', 'primary table-wide', () => startContest(contestDraft.label.trim() || 'Who wins?', contestDraft.lowest, null, contestDraft.includeMe)));
  box.append(form);
}

Tray.addPanel('ask', { label: 'Ask a roll', title: 'Ask listeners for a save or check', visible: hosting, render: renderAskPanel });
Tray.addPanel('initiative', { label: 'Initiative', title: 'Roll initiative and run the turn order', visible: hosting, render: renderInitiativePanel });
Tray.addPanel('contest', { label: 'Who wins?', title: 'Everyone rolls, the highest (or lowest) wins', visible: hosting, render: renderContestPanel });

// ---------------------------------------------------------------------
// Everyone: request cards, result cards, the turn strip.

const cards = new Map(); // ask id -> card

function showAsk(ask) {
  if (!ask || !ask.id || cards.has(ask.id)) return;
  const card = el('div', `table-ask ${ask.kind}`);
  const kicker = ask.kind === 'initiative' ? '⚔️ Roll initiative' : ask.kind === 'contest' ? `🏆 ${ask.lowest ? 'Lowest' : 'Highest'} roll wins` : '🎲 Roll request';
  card.append(el('div', 'table-ask-kicker', kicker));
  if (ask.kind !== 'initiative') card.append(el('div', 'table-ask-label', ask.label || 'Roll'));
  const sub = [describeCounts(ask.counts)];
  if (ask.dc) sub.push(`DC ${ask.dc}`);
  card.append(el('div', 'table-ask-sub', sub.join(' · ')));
  // Your modifier: initiative remembers yours; checks start at 0.
  let modifier = ask.kind === 'initiative' ? Tray.initiativeModifier() : 0;
  if (ask.kind !== 'contest') {
    const row = el('div', 'table-ask-mod');
    row.append(el('span', null, ask.kind === 'initiative' ? 'Your initiative modifier' : 'Your modifier'), stepper(modifier, (n) => {
      modifier = n;
      if (ask.kind === 'initiative') Tray.setInitiativeModifier(n);
    }));
    card.append(row);
  }
  const actions = el('div', 'table-ask-actions');
  const go = (rollMode) => {
    const id = Tray.roll(rollMode, 1.4, { counts: ask.counts || { d20: 1 }, modifier, ask: ask.id, overlay: true });
    if (id) removeCard(ask.id);
  };
  const d20 = (ask.counts?.d20 || 0) === 1 && Object.keys(ask.counts).length === 1;
  if (ask.kind === 'check' && d20) {
    actions.append(button('A', 'dice-adv', () => go('adv'), 'Advantage: roll two, keep the higher'), button('DA', 'dice-dis', () => go('dis'), 'Disadvantage: roll two, keep the lower'));
  }
  actions.append(button('Roll', 'primary table-ask-roll', () => go('normal')));
  card.append(actions);
  card.append(button('✕', 'table-x', () => removeCard(ask.id), 'Not now'));
  cards.set(ask.id, card);
  asksBox.append(card);
  Live.nudge(kicker, ask.label || 'Roll');
}

function removeCard(id) {
  const card = cards.get(id);
  if (!card) return;
  cards.delete(id);
  card.classList.add('leaving');
  setTimeout(() => card.remove(), 250);
}

function showResult(result) {
  const card = el('div', `table-result-card ${result.kind}`);
  if (result.kind === 'contest') {
    const one = result.winners.length === 1;
    const verb = /who pays/i.test(result.label) ? 'pays' : /who goes first/i.test(result.label) ? 'goes first' : 'wins';
    card.append(el('div', 'table-ask-kicker', `🏆 ${result.label}`));
    card.append(el('div', 'table-winner', one ? `${result.winners[0]} ${verb}!` : `Tie: ${result.winners.join(' & ')}`));
    const list = el('div', 'table-result-list');
    result.ranking.forEach((r, i) => {
      const row = resultRow(`${i + 1}. ${r.name}`, r.total, null, '');
      if (result.winners.includes(r.name)) row.classList.add('winner');
      list.append(row);
    });
    card.append(list);
  } else {
    card.append(el('div', 'table-ask-kicker', `🎲 ${result.label}${result.dc ? ` · DC ${result.dc}` : ''}`));
    const list = el('div', 'table-result-list');
    for (const r of result.results) list.append(resultRow(r.name, r.total, result.dc ? r.pass : null, ''));
    card.append(list);
  }
  card.append(button('✕', 'table-x', () => card.remove(), 'Dismiss'));
  resultsBox.append(card);
  setTimeout(() => { card.classList.add('leaving'); setTimeout(() => card.remove(), 300); }, 20000);
}

// The turn order on every screen; "your turn" when it reaches you.
let lastTurnKey = null;
let turnTimer = null;
function showTurns(msg) {
  strip.textContent = '';
  if (!msg || msg.phase === 'off' || !Array.isArray(msg.order)) {
    strip.classList.add('hidden');
    lastTurnKey = null;
    return;
  }
  strip.classList.remove('hidden');
  const me = msg.you || Live.you();
  const order = msg.order;
  if (msg.phase === 'rolling') {
    strip.className = 'table-turns rolling';
    strip.append(el('span', 'table-turns-title', '⚔️ Initiative'));
    if (!order.length) strip.append(el('span', 'muted', 'Rolling…'));
    for (const e of order) {
      const chip = el('span', `table-turn-chip${e.peer && e.peer === me ? ' me' : ''}`);
      chip.append(el('b', null, e.name), el('span', null, String(e.total)));
      strip.append(chip);
    }
  } else {
    const current = order[msg.current] || order[0];
    const next = order.length > 1 ? order[(msg.current + 1) % order.length] : null;
    const mine = !!current.peer && current.peer === me;
    strip.className = `table-turns running${mine ? ' mine' : ''}`;
    strip.append(el('span', 'table-turns-title', `Round ${msg.round}`));
    strip.append(el('span', 'table-turns-now', mine ? 'Your turn!' : `${current.name}'s turn`));
    if (next) strip.append(el('span', 'table-turns-next', next.peer && next.peer === me ? 'You\'re next' : `Next: ${next.name}`));
    const list = el('span', 'table-turns-order');
    order.forEach((e, i) => list.append(el('span', `table-turn-dot${i === msg.current ? ' current' : ''}${e.peer && e.peer === me ? ' me' : ''}`, e.name)));
    strip.append(list);
    if (hosting()) strip.append(button('Next ▶', 'dice-pill small', () => stepTurn(1), 'Next turn'));
    // A nudge and a big card when it becomes your turn.
    const key = `${msg.round}:${msg.current}`;
    if (mine && key !== lastTurnKey) yourTurn(next && next.name);
    lastTurnKey = key;
  }
}

function yourTurn() {
  document.querySelectorAll('.table-your-turn').forEach((n) => n.remove());
  const card = el('div', 'table-your-turn');
  card.append(el('div', 'table-your-turn-big', 'Your turn!'), el('div', 'table-your-turn-sub', '⚔️ Initiative'));
  document.body.append(card);
  clearTimeout(turnTimer);
  turnTimer = setTimeout(() => card.remove(), 2600);
  Live.nudge('⚔️ Your turn!', 'It\'s your turn in the initiative order.');
}

// Messages from the broadcaster (listeners only; the broadcaster's own are shown directly).
function receive(message) {
  if (hosting()) return;
  if (message.t === 'ask') showAsk(message);
  else if (message.t === 'askClosed') removeCard(message.id);
  else if (message.t === 'askResult') showResult(message);
  else if (message.t === 'turns') showTurns(message);
}

function reset() {
  for (const id of [...cards.keys()]) removeCard(id);
  showTurns(null);
  check = null;
  contest = null;
  lastContest = null;
  init.phase = 'off';
  init.askId = null;
  init.entries.clear();
  init.order = [];
}

function statusChanged() {
  if (!inSession()) { reset(); return; }
  Tray.refreshPanel();
  // Someone in the request left: the contest may be complete now.
  if (contest) maybeFinishContest();
}

window.Table = { receive, reset, statusChanged };
