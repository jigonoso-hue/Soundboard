/* global api, $, Live */
// Games for everyone in a Live Session: a buzzer and a quiz. Only the
// broadcaster starts one (Games in the toolbar), and while it runs every
// listener's window is locked to it: no closing it, no other screens, until
// the broadcaster ends the game. The host decides everything (src/game.js);
// this draws it. Matches the iPad app's GamesView.swift.
const Games = (() => {
  const SHAPES = ['▲', '◆', '●', '■'];
  const TIMERS = [[0, 'No time limit'], [10, '10 seconds'], [20, '20 seconds'], [30, '30 seconds'], [60, '1 minute']];
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
  const seconds = (ms) => `${(ms / 1000).toFixed(2)}s`;
  const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;

  let game = null; // the latest game message ({ phase: 'off' } when none)
  let you = null;
  let deadline = 0; // when the question's time runs out, in this window's clock
  let tick = null;

  // ---- A listener's locked screen ----

  const screen = el('section', 'game-screen hidden');
  screen.setAttribute('role', 'dialog');
  screen.setAttribute('aria-modal', 'true');
  document.body.append(screen);

  // While a game runs, nothing else on a listener's window can be reached.
  document.addEventListener('keydown', (e) => {
    if (screen.classList.contains('hidden')) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); }
    // Space buzzes too, but only a fresh press (not one held down from before).
    if (e.key === ' ' && !e.repeat && game?.kind === 'buzzer') { e.preventDefault(); buzz(e.timeStamp); }
  }, true);

  function lock(on) {
    const was = !screen.classList.contains('hidden');
    screen.classList.toggle('hidden', !on);
    document.body.classList.toggle('game-locked', on);
    if (on && !was) {
      // Close whatever else was open: dialogs and the dice.
      document.querySelectorAll('dialog[open]').forEach((d) => d.close());
      window.DiceTray?.close();
    }
  }

  let armedSince = Infinity; // when this window showed the buzzer as live
  let armedRound = -1;
  let early = 0;

  function buzz(at) {
    if (!game || game.kind !== 'buzzer') return;
    if (game.phase !== 'armed') {
      // Too early: a shake, and nothing is sent.
      early = performance.now();
      renderScreen();
      return;
    }
    // Only a press that started after the buzzer went live counts.
    if (at < armedSince || game.buzzes.some((b) => b.peer === you) || sent.has(game.round)) return;
    sent.add(game.round);
    api.live.roll({ t: 'gameInput', id: game.id, buzz: true });
    renderScreen();
  }
  const sent = new Set(); // buzzer rounds this window has buzzed in
  const answered = new Map(); // question number -> the answer chosen here

  function renderScreen() {
    screen.textContent = '';
    if (!game || game.phase === 'off') return;
    screen.dataset.kind = game.kind;
    const head = el('header', 'game-head');
    head.append(el('div', 'game-title', game.kind === 'buzzer' ? '🔔 Buzzer' : '🧠 Quiz'), el('div', 'game-sub', 'The broadcaster is running a game'));
    screen.append(head);
    if (game.kind === 'buzzer') renderBuzzer();
    else renderQuiz();
  }

  function renderBuzzer() {
    const body = el('div', 'game-body buzzer');
    const mine = game.buzzes.findIndex((b) => b.peer === you);
    const armed = game.phase === 'armed';
    const pressed = mine >= 0 || sent.has(game.round);
    const big = el('button', `game-buzz${armed ? ' armed' : ''}${pressed ? ' pressed' : ''}${performance.now() - early < 500 ? ' early' : ''}`);
    big.type = 'button';
    big.append(el('span', 'game-buzz-text', pressed ? (mine >= 0 ? ordinal(mine + 1) : '…') : armed ? 'BUZZ!' : 'Wait…'));
    big.disabled = pressed;
    // pointerdown, not click: the press counts when it starts, and a finger
    // already down before the buzzer went live never fires one.
    big.addEventListener('pointerdown', (e) => { e.preventDefault(); buzz(e.timeStamp); });
    body.append(big);
    body.append(el('p', 'game-hint', pressed
      ? (mine >= 0 ? (mine === 0 ? 'You were first!' : `You were ${ordinal(mine + 1)}.`) : 'Buzzed!')
      : armed ? 'Press now (or Space)!' : 'Get ready: the buzzer goes live when the broadcaster says so. Pressing early does nothing.'));
    body.append(order(game.buzzes));
    screen.append(body);
  }

  function order(buzzes) {
    const list = el('ol', 'game-order');
    buzzes.forEach((b, i) => {
      const row = el('li', `${b.peer === you ? 'me' : ''}${i === 0 ? ' first' : ''}`);
      row.append(el('span', 'game-place', ordinal(i + 1)), who(b), el('span', 'game-ms', i === 0 ? seconds(b.ms) : `+${seconds(b.ms - buzzes[0].ms)}`));
      list.append(row);
    });
    return list;
  }

  function renderQuiz() {
    const body = el('div', 'game-body quiz');
    const q = game.question;
    if (game.phase === 'lobby' || !q) {
      body.append(el('p', 'game-wait', game.n ? 'Next question coming up…' : 'Get ready: the first question is coming up…'));
      if (game.leaderboard?.length) body.append(board(game.leaderboard, 5));
      screen.append(body);
      return;
    }
    if (game.phase === 'final') {
      body.append(el('div', 'game-final-title', '🏆 Final scores'));
      body.append(podium(game.leaderboard || []));
      body.append(board(game.leaderboard || [], 10));
      screen.append(body);
      return;
    }
    body.append(el('div', 'game-qnum', `Question ${game.n}${q.vote ? ' · a vote' : ''}`), el('div', 'game-question', q.text));
    const reveal = game.phase === 'reveal';
    if (!reveal && q.timer) {
      const bar = el('div', 'game-timer');
      const fill = el('div', 'game-timer-fill');
      bar.append(fill);
      body.append(bar);
      const left = Math.max(0, deadline - Date.now());
      fill.style.transform = `scaleX(${left / (q.timer * 1000)})`;
      bar.dataset.left = String(Math.ceil(left / 1000));
    }
    const chosen = answered.get(game.n);
    const grid = el('div', `game-answers n${q.answers.length}`);
    q.answers.forEach((text, i) => {
      const tile = el('button', `game-answer c${i}`);
      tile.type = 'button';
      tile.append(el('span', 'game-shape', SHAPES[i]), el('span', 'game-answer-text', text));
      if (reveal) {
        const count = game.counts?.[i] || 0;
        tile.append(el('span', 'game-count', String(count)));
        if (game.correct === i) tile.classList.add('right');
        else if (game.correct !== null) tile.classList.add('wrong');
      }
      if (chosen === i) tile.classList.add('chosen');
      // Before the reveal your choice stands out; after it, the right answer does.
      else if (chosen !== undefined && !(reveal && game.correct !== null)) tile.classList.add('dim');
      tile.disabled = reveal || chosen !== undefined;
      tile.addEventListener('click', () => {
        if (answered.has(game.n) || game.phase !== 'question') return;
        answered.set(game.n, i);
        api.live.roll({ t: 'gameInput', id: game.id, q: game.n, choice: i });
        renderScreen();
      });
      grid.append(tile);
    });
    body.append(grid);
    if (!reveal) {
      body.append(el('p', 'game-hint', chosen !== undefined ? `Answer locked in · ${game.answered} answered` : `${game.answered} answered`));
    } else {
      const mine = game.results?.find((r) => r.peer === you);
      let text = 'You didn\'t answer.';
      if (mine && q.vote) text = `You voted ${SHAPES[mine.choice]} ${q.answers[mine.choice]}.`;
      else if (mine && mine.points) text = `Correct! +${mine.points}`;
      else if (mine) text = 'Not this time.';
      body.append(el('p', `game-result${mine?.points ? ' good' : ''}`, text));
      if (game.leaderboard?.length && !q.vote) body.append(board(game.leaderboard, 5));
    }
    screen.append(body);
  }

  function board(list, max) {
    const box = el('ol', 'game-board');
    list.slice(0, max).forEach((p, i) => {
      const row = el('li', p.peer === you ? 'me' : '');
      row.append(el('span', 'game-place', String(i + 1)), who(p), el('span', 'game-score', String(p.score)));
      box.append(row);
    });
    if (you && !list.slice(0, max).some((p) => p.peer === you)) {
      const at = list.findIndex((p) => p.peer === you);
      if (at >= 0) {
        const row = el('li', 'me');
        row.append(el('span', 'game-place', String(at + 1)), who(list[at]), el('span', 'game-score', String(list[at].score)));
        box.append(row);
      }
    }
    return box;
  }

  // A name with the player's picture.
  function who(p) {
    const b = el('b', 'game-who');
    b.append(Live.face(p.peer, p.name, 24), el('span', null, p.name));
    return b;
  }

  function podium(list) {
    const box = el('div', 'game-podium');
    [1, 0, 2].forEach((i) => {
      const p = list[i];
      if (!p) return;
      const step = el('div', `game-step p${i + 1}${p.peer === you ? ' me' : ''}`);
      const name = el('div', 'game-step-name');
      name.append(Live.face(p.peer, p.name, 40), el('span', null, p.name));
      step.append(name, el('div', 'game-step-score', String(p.score)), el('div', 'game-step-block', String(i + 1)));
      box.append(step);
    });
    return box;
  }

  // ---- The broadcaster's panel ----

  const panel = el('section', 'game-host hidden');
  panel.setAttribute('aria-label', 'Games');
  const pill = button('', 'game-pill hidden', () => openPanel());
  document.body.append(panel, pill);
  const draft = { text: '', answers: ['', '', '', ''], correct: 0, timer: 20 };

  function openPanel() {
    panel.classList.remove('hidden');
    pill.classList.add('hidden');
    renderPanel();
  }
  function hidePanel() {
    panel.classList.add('hidden');
    renderPill();
  }
  function renderPill() {
    const running = game && game.phase !== 'off';
    pill.classList.toggle('hidden', !running || !panel.classList.contains('hidden') || !Live.hosting());
    if (running) pill.textContent = `${game.kind === 'buzzer' ? '🔔 Buzzer' : '🧠 Quiz'} running · Open`;
  }

  const control = (action, extra = {}) => api.live.hostEvent({ t: 'gameControl', action, ...extra });

  function renderPanel() {
    renderPill();
    if (panel.classList.contains('hidden')) return;
    panel.textContent = '';
    const card = el('div', 'game-host-card');
    const head = el('div', 'game-host-head');
    head.append(el('div', 'game-host-title', game && game.phase !== 'off' ? (game.kind === 'buzzer' ? '🔔 Buzzer' : '🧠 Quiz') : 'Games'));
    head.append(button('Hide', 'game-host-hide', hidePanel, 'Keep the game running and use the soundboard'));
    card.append(head);
    if (!game || game.phase === 'off') renderChooser(card);
    else if (game.kind === 'buzzer') renderBuzzerHost(card);
    else renderQuizHost(card);
    panel.append(card);
  }

  function renderChooser(card) {
    card.append(el('p', 'muted small', 'Starting a game locks every listener\'s screen to it until you end it.'));
    const choices = el('div', 'game-choices');
    const choice = (title, text, kind) => {
      const b = button('', 'game-choice', () => control('start', { kind }));
      b.append(el('b', null, title), el('span', null, text));
      return b;
    };
    choices.append(
      choice('🔔 Buzzer', 'Everyone gets a big button. Arm it and see who pressed first, in order. Pressing early or holding it down doesn\'t count.', 'buzzer'),
      choice('🧠 Quiz', 'Ask questions with up to four answers. Right answers score more for speed, with a live leaderboard. Or leave out the right answer for a vote.', 'quiz'),
    );
    card.append(choices);
    if (!Live.peers().length) card.append(el('p', 'muted small', 'No one has tuned in yet.'));
  }

  function renderBuzzerHost(card) {
    const armed = game.phase === 'armed';
    const live = el('div', `game-host-state${armed ? ' armed' : ''}`, armed ? `Live · round ${game.round}` : 'Waiting');
    card.append(live);
    const row = el('div', 'game-host-actions');
    row.append(button(armed ? 'Arm again' : 'Arm buzzer', 'primary game-big', () => control('arm'), 'Listeners can press from now'));
    if (armed) row.append(button('Reset', '', () => control('reset'), 'Back to waiting'));
    card.append(row);
    const total = Live.peers().length;
    card.append(el('p', 'muted small', armed ? `${game.buzzes.length} of ${total} buzzed` : 'Listeners see "Wait…" until you arm it.'));
    card.append(order(game.buzzes));
    card.append(endButton());
  }

  function renderQuizHost(card) {
    const q = game.question;
    if (game.phase === 'question') {
      const state = el('div', 'game-host-state armed', `Question ${game.n}`);
      if (q.timer) state.append(' · ', el('span', 'game-clock', `${Math.ceil(Math.max(0, deadline - Date.now()) / 1000)}s left`));
      card.append(state);
      card.append(el('div', 'game-host-q', q.text));
      const counts = q.answers.map((_, i) => (game.answers || []).filter((a) => a.choice === i).length);
      card.append(answerBars(q, counts, game.correct));
      card.append(el('p', 'muted small', `${game.answered} of ${Live.peers().length} answered: ${(game.answers || []).map((a) => a.name).join(', ') || 'no one yet'}`));
      const row = el('div', 'game-host-actions');
      row.append(button('Show answer', 'primary game-big', () => control('reveal')));
      card.append(row);
      card.append(endButton());
      return;
    }
    if (game.phase === 'reveal' && q) {
      card.append(el('div', 'game-host-state', `Question ${game.n} · answer shown`));
      card.append(el('div', 'game-host-q', q.text));
      card.append(answerBars(q, game.counts || [], game.correct));
    }
    if (game.phase === 'final') card.append(el('div', 'game-host-state', 'Final scores on every screen'));
    if (game.leaderboard?.length) card.append(board(game.leaderboard, 5));
    if (game.phase !== 'final') renderEditor(card);
    const row = el('div', 'game-host-actions');
    if (game.phase === 'reveal') row.append(button('Final scores', '', () => control('final')));
    if (game.phase === 'final') row.append(button('Keep playing', '', () => control('lobby')));
    card.append(row);
    card.append(endButton());
  }

  function answerBars(q, counts, correct) {
    const box = el('div', 'game-bars');
    const most = Math.max(1, ...counts);
    q.answers.forEach((text, i) => {
      const row = el('div', `game-bar c${i}${correct === i ? ' right' : ''}`);
      const fill = el('div', 'game-bar-fill');
      fill.style.width = `${(counts[i] / most) * 100}%`;
      row.append(fill, el('span', 'game-bar-label', `${SHAPES[i]} ${text}${correct === i ? ' ✓' : ''}`), el('b', null, String(counts[i] || 0)));
      box.append(row);
    });
    return box;
  }

  function renderEditor(card) {
    const form = el('div', 'game-editor');
    form.append(el('div', 'live-subhead', game.n ? 'Next question' : 'First question'));
    const text = el('input');
    text.placeholder = 'Question, e.g. Who was the innkeeper in session one?';
    text.maxLength = 200;
    text.value = draft.text;
    text.addEventListener('input', () => { draft.text = text.value; });
    form.append(text);
    const answers = el('div', 'game-editor-answers');
    draft.answers.forEach((value, i) => {
      const row = el('label', `game-editor-answer c${i}`);
      const right = el('input');
      right.type = 'radio';
      right.name = 'game-correct';
      right.checked = draft.correct === i;
      right.title = 'The right answer';
      right.addEventListener('change', () => { draft.correct = i; });
      const input = el('input');
      input.placeholder = i < 2 ? `Answer ${i + 1}` : `Answer ${i + 1} (optional)`;
      input.maxLength = 80;
      input.value = value;
      input.addEventListener('input', () => { draft.answers[i] = input.value; });
      row.append(el('span', 'game-shape', SHAPES[i]), input, right);
      answers.append(row);
    });
    form.append(answers);
    const options = el('div', 'game-editor-options');
    const vote = el('label', 'table-check');
    const voteBox = el('input');
    voteBox.type = 'checkbox';
    voteBox.checked = draft.correct === null;
    voteBox.addEventListener('change', () => { draft.correct = voteBox.checked ? null : 0; renderPanel(); });
    vote.append(voteBox, el('span', null, 'No right answer (a vote)'));
    const timer = el('select');
    for (const [s, label] of TIMERS) { const o = el('option', null, label); o.value = String(s); timer.append(o); }
    timer.value = String(draft.timer);
    timer.addEventListener('change', () => { draft.timer = Number(timer.value); });
    options.append(vote, timer);
    form.append(options);
    const quick = el('div', 'game-editor-quick');
    quick.append(el('span', 'muted small', 'Quick answers:'),
      button('Yes / No', 'dice-pill small', () => { draft.answers = ['Yes', 'No', '', '']; renderPanel(); }),
      button('True / False', 'dice-pill small', () => { draft.answers = ['True', 'False', '', '']; renderPanel(); }));
    form.append(quick);
    const filled = () => draft.answers.filter((a) => a.trim()).length;
    const ask = button('Ask everyone', 'primary game-big', () => {
      // Answers keep their places, so the right one stays right.
      const kept = draft.answers.map((a, i) => [a.trim(), i]).filter(([a]) => a);
      if (kept.length < 2) return;
      const correct = draft.correct === null ? null : kept.findIndex(([, i]) => i === draft.correct);
      control('ask', { text: draft.text, answers: kept.map(([a]) => a), correct: correct < 0 ? null : correct, timer: draft.timer });
      draft.text = '';
      draft.answers = ['', '', '', ''];
    }, 'Needs a question and at least two answers');
    form.append(ask);
    form.append(el('p', 'muted small', `${filled() < 2 ? 'Write at least two answers. ' : ''}Tick the right answer; right answers score up to 1000 points, more for answering fast.`));
    card.append(form);
  }

  function endButton() {
    return button('End game', 'danger game-end', () => {
      control('end');
      hidePanel();
    }, 'Unlocks everyone\'s screens');
  }

  // ---- Messages ----

  function receive(message) {
    if (message.you) you = message.you;
    if (Live.hosting()) you = 'host';
    game = message.phase === 'off' ? null : message;
    if (game?.question?.left) deadline = Date.now() + game.question.left;
    if (!game) { sent.clear(); answered.clear(); }
    clearInterval(tick);
    if (game?.phase === 'question' && game.question?.timer) {
      // Only the clock moves: redrawing the answers could swallow a tap.
      tick = setInterval(updateClock, 250);
    }
    if (Live.hosting()) {
      lock(false);
      renderPanel();
      return;
    }
    // A listener: locked to the game while it runs.
    // Each time the buzzer goes live, only presses from then on count.
    if (game?.kind === 'buzzer' && game.phase === 'armed' && armedRound !== game.round) {
      armedSince = performance.now();
      armedRound = game.round;
    }
    if (game?.kind !== 'buzzer' || game.phase !== 'armed') { armedSince = Infinity; armedRound = -1; }
    lock(!!game);
    renderScreen();
  }

  // The time left on the question, on the listener's bar and the broadcaster's panel.
  function updateClock() {
    const q = game?.question;
    if (!q?.timer) return;
    const left = Math.max(0, deadline - Date.now());
    const fill = screen.querySelector('.game-timer-fill');
    if (fill) {
      fill.style.transform = `scaleX(${left / (q.timer * 1000)})`;
      fill.parentElement.dataset.left = String(Math.ceil(left / 1000));
    }
    const clock = panel.querySelector('.game-clock');
    if (clock) clock.textContent = `${Math.ceil(left / 1000)}s left`;
  }

  function statusChanged() {
    const hosting = Live.hosting();
    $('#games-btn').classList.toggle('hidden', !hosting);
    if (!hosting && !Live.listening()) {
      game = null;
      clearInterval(tick);
      lock(false);
      panel.classList.add('hidden');
    }
    renderPill();
  }

  $('#games-btn').addEventListener('click', () => (panel.classList.contains('hidden') ? openPanel() : hidePanel()));

  // Pictures changed: redraw with them.
  function refresh() {
    if (!game) return;
    if (!screen.classList.contains('hidden')) renderScreen();
    if (!panel.classList.contains('hidden')) renderPanel();
  }

  return { receive, statusChanged, refresh };
})();
window.Games = Games;
