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

  // Back: the drawer, then whatever the screens close themselves.
  window.DRBack = () => {
    if (html.classList.contains('drawer-open')) { html.classList.remove('drawer-open'); return true; }
    return DRApp.back();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addMenuButton, { once: true });
  else addMenuButton();
})();
