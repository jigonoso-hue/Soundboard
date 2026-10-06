/* global DRApp */
// Android-only behaviour for the Mac screens on a phone: the sidebar becomes a
// drawer behind a menu button, and the phone's Back button closes what's open.
(() => {
  const html = document.documentElement;
  const phone = () => window.matchMedia('(max-width: 700px)').matches;

  // The menu button that opens the sidebar (scene kits, bookmarks, library, options).
  function addMenuButton() {
    const bar = document.querySelector('.titlebar');
    if (!bar || document.getElementById('android-menu')) return;
    const button = document.createElement('button');
    button.id = 'android-menu';
    button.type = 'button';
    button.setAttribute('aria-label', 'Menu');
    button.title = 'Scene kits, bookmarks, library and options';
    button.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
    button.addEventListener('click', () => html.classList.toggle('drawer-open'));
    bar.prepend(button);
    const scrim = document.createElement('div');
    scrim.id = 'android-scrim';
    scrim.addEventListener('click', () => html.classList.remove('drawer-open'));
    document.body.append(scrim);
    // Choosing a view or a kit closes the drawer.
    document.getElementById('sidebar')?.addEventListener('click', (e) => {
      if (phone() && e.target.closest('.view-btn, .kit-btn, .bookmark-btn, #kit-new, #bookmark-save, #options-btn')) html.classList.remove('drawer-open');
    });
  }

  const shown = (selector) => [...document.querySelectorAll(selector)].find((n) => n.getClientRects().length > 0);

  // Back: the drawer, the bash editor and dialogs, then menus and panels, one
  // at a time. Nothing left to close: Android puts the app in the background
  // (sounds and a Live Session keep going).
  window.DRBack = () => {
    if (html.classList.contains('drawer-open')) { html.classList.remove('drawer-open'); return true; }
    if (DRApp.back()) return true;
    // Menus close on a click anywhere else.
    if (shown('.popup-menu:not(.hidden)')) { document.body.click(); return true; }
    const handoutClose = shown('.handout-view:not(.hidden) .handout-close');
    if (handoutClose) { handoutClose.click(); return true; }
    if (window.DiceTray && window.DiceTray.isOpen()) { window.DiceTray.close(); return true; }
    const kitDrawerClose = shown('#kit-drawer:not(.hidden) #drawer-close');
    if (kitDrawerClose) { kitDrawerClose.click(); return true; }
    return false;
  };

  // Stacked scene kit sections (android.css) read top to bottom, left to right,
  // in the order of the bigger screens' grid.
  function orderSections(board) {
    for (const section of board.querySelectorAll(':scope > .kit-section')) {
      section.style.order = String(Math.round(parseFloat(section.style.top || '0')) * 10000 + Math.round(parseFloat(section.style.left || '0')));
    }
  }

  // The ambience strip starts folded on a phone, as on iPhone, unless it's playing.
  function foldAmbience() {
    const toggle = document.getElementById('amb-collapse');
    const layers = document.getElementById('amb-layers');
    if (phone() && toggle && layers && !layers.classList.contains('hidden') && !toggle.classList.contains('active')) toggle.click();
  }

  function start() {
    addMenuButton();
    const filter = document.getElementById('filter');
    if (filter && phone()) filter.placeholder = 'Search';
    const board = document.getElementById('kit-board');
    if (board) {
      new MutationObserver(() => orderSections(board)).observe(board, { childList: true });
      orderSections(board);
    }
    // After the screens have loaded their saved state.
    setTimeout(foldAmbience, 600);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
