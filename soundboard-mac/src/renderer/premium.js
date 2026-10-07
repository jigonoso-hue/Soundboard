/* global api, toast */
// Premium on the phone apps (src/premium.js has the rules). The Mac app has no
// api.premium and is always unlocked, so none of this shows there.
//
// Premium.on()            whether everything is unlocked
// Premium.require(f)      true if unlocked; otherwise shows the Premium screen
//                         (f: "games", "handouts", "whispers", "emphasis", "table")
// Premium.gate(f, render) a dice-tray panel that shows a lock card instead when locked
// Premium.open(reason)    the Premium screen
const Premium = (() => {
  const store = typeof api !== 'undefined' && api.premium ? api.premium : null;
  const FEATURES = {
    games: 'Games: buzzer and quiz',
    handouts: 'Handouts: show pictures on listeners’ screens',
    whispers: 'Whispers: play a sound to chosen listeners',
    emphasis: 'Emphasis: make listeners’ phones vibrate',
    table: 'Roll requests, initiative and “Who wins?” contests',
  };
  const REASONS = {
    games: 'Games are part of Premium.',
    handouts: 'Handouts are part of Premium.',
    whispers: 'Whispers are part of Premium.',
    emphasis: 'Emphasis is part of Premium.',
    table: 'Roll requests, initiative and contests are part of Premium.',
  };
  let status = { premium: !store, products: [], debug: false };
  let busy = false;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  function on() { return !!status.premium; }

  function require(feature) {
    if (on()) return true;
    open(REASONS[feature] || '');
    return false;
  }

  // A tray panel's render function, with a lock card instead while locked.
  function gate(feature, render) {
    return (box) => {
      if (on()) { render(box); return; }
      const card = el('div', 'premium-lock');
      card.append(el('div', 'premium-lock-title', '⭐ Premium'), el('p', 'muted small', FEATURES[feature] || ''));
      const go = el('button', 'primary', 'See Premium');
      go.type = 'button';
      go.addEventListener('click', () => open());
      card.append(go);
      box.append(card);
    };
  }

  // ---- The Premium screen ----

  let dialog = null;
  let reasonText = '';

  function build() {
    dialog = el('dialog', 'premium-dialog');
    dialog.id = 'premium-dialog';
    dialog.addEventListener('close', () => { reasonText = ''; });
    document.body.append(dialog);
  }

  function priceLabel(p) {
    if (p.period === 'month') return `${p.price} a month`;
    if (p.period === 'year') return `${p.price} a year`;
    return `${p.price} once, yours to keep`;
  }

  function render() {
    if (!dialog) build();
    dialog.textContent = '';
    dialog.append(el('h2', null, on() ? '⭐ Premium is on' : '⭐ Dungeon Radio Premium'));
    if (reasonText && !on()) dialog.append(el('p', 'premium-reason', reasonText));
    const list = el('ul', 'premium-list');
    for (const text of ['Unlimited sounds, bashes and scene kits', ...Object.values(FEATURES)]) list.append(el('li', null, text));
    dialog.append(list);
    dialog.append(el('p', 'muted small', 'Your players never need Premium: when you broadcast, everyone in your session gets all of it.'));
    if (!on()) {
      const free = el('p', 'muted small premium-free');
      free.textContent = 'Free: 10 clips, 5 full sounds, 5 bashes and 2 scene kits, all of ambience, and broadcasting with dice, custom dice and players’ sounds.';
      dialog.append(free);
      const buy = el('div', 'premium-buy');
      // Yearly first, then monthly, then lifetime.
      const order = { year: 0, month: 1 };
      const products = [...(status.products || [])].sort((a, b) => (order[a.period] ?? 2) - (order[b.period] ?? 2));
      if (!products.length) buy.append(el('p', 'muted small', status.error || 'Prices aren’t available right now. Check your connection and try again.'));
      for (const p of products) {
        const b = el('button', p.period === 'year' ? 'primary premium-product' : 'premium-product');
        b.type = 'button';
        b.disabled = busy;
        b.append(el('b', null, p.title || (p.period ? (p.period === 'year' ? 'Yearly' : 'Monthly') : 'Lifetime')), el('span', null, priceLabel(p)));
        b.addEventListener('click', () => purchase(p.id));
        buy.append(b);
      }
      dialog.append(buy);
    }
    const actions = el('div', 'dialog-actions');
    if (!on()) {
      const restore = el('button', 'plain', 'Restore purchases');
      restore.type = 'button';
      restore.disabled = busy;
      restore.addEventListener('click', restorePurchases);
      actions.append(restore);
    } else if (status.manageUrl) {
      const manage = el('button', 'plain', 'Manage subscription');
      manage.type = 'button';
      manage.addEventListener('click', () => api.openExternal(status.manageUrl));
      actions.append(manage);
    }
    if (status.debug) {
      // Test builds only: purchases need the store, so this stands in for one.
      const test = el('button', 'plain premium-test', on() ? 'Lock again (test build)' : 'Unlock for testing (test build)');
      test.type = 'button';
      test.addEventListener('click', async () => { status = await store.testUnlock(!on()); render(); refreshUi(); });
      actions.append(test);
    }
    actions.append(el('span', 'spacer'));
    const close = el('button', null, on() ? 'Done' : 'Not now');
    close.type = 'button';
    close.addEventListener('click', () => dialog.close());
    actions.append(close);
    dialog.append(actions);
  }

  async function open(reason = '') {
    if (!store) return;
    reasonText = reason;
    render();
    if (!dialog.open) dialog.showModal();
    try { status = await store.status(); } catch { /* keep the last one */ }
    render();
  }

  async function purchase(id) {
    busy = true;
    render();
    try {
      const result = await store.purchase(id);
      if (result && result.status) status = result.status;
      if (on()) toast('Premium is on. Thank you!');
    } catch (err) {
      toast(err.message || 'The purchase didn’t go through.', true);
    }
    busy = false;
    render();
    refreshUi();
  }

  async function restorePurchases() {
    busy = true;
    render();
    try {
      status = await store.restore();
      toast(on() ? 'Premium restored.' : 'No Premium purchase found for this account.', !on());
    } catch (err) {
      toast(err.message || 'Couldn’t check your purchases.', true);
    }
    busy = false;
    render();
    refreshUi();
  }

  // ---- The sidebar button ----

  function refreshUi() {
    const btn = document.getElementById('premium-btn');
    if (btn) {
      btn.textContent = on() ? '⭐ Premium' : '⭐ Get Premium';
      btn.classList.toggle('is-premium', on());
    }
  }

  function addButton() {
    const options = document.getElementById('options-btn');
    if (!options || document.getElementById('premium-btn')) return;
    const btn = el('button', 'options-btn premium-btn');
    btn.id = 'premium-btn';
    btn.type = 'button';
    btn.title = 'Unlimited sounds, games, handouts, whispers and more';
    btn.addEventListener('click', () => open());
    options.before(btn);
    refreshUi();
  }

  if (store) {
    store.status().then((s) => { status = s; refreshUi(); }).catch(() => {});
    store.onChanged((s) => { status = s; refreshUi(); if (dialog && dialog.open) render(); });
    // A free-version limit was reached (adding a sound, a bash or a kit).
    store.onLimit((message) => open(message));
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addButton, { once: true });
    else addButton();
  }

  return { on, require, gate, open, FEATURES };
})();
