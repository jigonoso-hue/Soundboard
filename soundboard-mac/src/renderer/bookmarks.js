/* global api, $, prefs, toast, Kits, Music, Ambience, Live, Icons */
// Bookmarks: save the moment's sound and bring it back with one click (next
// session, or after a detour): the scene kit that was open, the playlists
// playing (which song, how far in), other songs playing, the ambience layers
// and their volumes, and the master and ambience volumes. Coming back is a
// scene change: what isn't in the bookmark fades out while what is fades in,
// for listeners too. Matches the iPad app's BookmarksView.swift.
const Bookmarks = (() => {
  const FADE = 3;
  let list = [];

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  async function load() {
    try { list = await api.bookmarks.list(); } catch { list = []; }
    render();
  }

  // What's playing now.
  function capture(name) {
    const kit = Kits.activeKit();
    return {
      name,
      at: Date.now(),
      kitId: kit ? kit.id : null,
      master: prefs.master,
      music: Music.capture(),
      ambience: Ambience.capture(),
    };
  }

  function defaultName() {
    const kit = Kits.activeKit();
    const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return `${kit ? kit.name : 'Library'} · ${time}`;
  }

  async function save() {
    const name = await Kits.askText('Bookmark this moment', defaultName());
    if (name === null) return;
    const saved = await api.bookmarks.save(capture(name.trim() || defaultName()));
    list = [saved, ...list.filter((b) => b.id !== saved.id)];
    render();
    toast(`Bookmarked “${saved.name}”.`);
  }

  // Brings a bookmark back.
  function restore(bookmark) {
    if (bookmark.kitId && Kits.get(bookmark.kitId)) Kits.open(bookmark.kitId, { scene: false });
    // Listeners fade their ambience over the same time.
    if (typeof Live !== 'undefined') Live.sceneChanged(FADE);
    Music.restore(bookmark.music, Kits.get, FADE);
    Ambience.applyScene(bookmark.ambience, FADE);
    const master = $('#master-volume');
    if (master && Number.isFinite(bookmark.master) && Math.abs(Number(master.value) - bookmark.master) > 0.001) {
      master.value = bookmark.master;
      master.dispatchEvent(new Event('input'));
    }
    toast(`Back to “${bookmark.name}”.`);
  }

  // Rename, update to what's playing now, or delete.
  function openMenu(bookmark, anchor) {
    const menu = $('#section-menu');
    menu.textContent = '';
    const add = (label, fn, cls = '') => {
      const b = el('button', cls, label);
      b.type = 'button';
      b.addEventListener('click', () => { menu.classList.add('hidden'); fn(); });
      menu.append(b);
    };
    add('Bring back', () => restore(bookmark));
    add('Update to what’s playing now', async () => {
      const saved = await api.bookmarks.save({ ...capture(bookmark.name), id: bookmark.id });
      list = list.map((b) => (b.id === saved.id ? saved : b));
      render();
      toast(`Updated “${saved.name}”.`);
    });
    add('Rename…', async () => {
      const name = await Kits.askText('Bookmark name', bookmark.name);
      if (!name) return;
      const saved = await api.bookmarks.rename(bookmark.id, name);
      if (saved) list = list.map((b) => (b.id === saved.id ? saved : b));
      render();
    });
    add('Delete', async () => {
      await api.bookmarks.remove(bookmark.id);
      list = list.filter((b) => b.id !== bookmark.id);
      render();
    }, 'danger');
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${Math.min(window.innerWidth - 240, rect.left + 20)}px`;
    menu.classList.remove('hidden');
    menu.style.top = `${Math.max(8, Math.min(window.innerHeight - menu.offsetHeight - 8, rect.bottom + 2))}px`;
  }

  // What a bookmark brings back, in a few words.
  function describe(bookmark) {
    const parts = [];
    const songs = bookmark.music.playlists.length + bookmark.music.songs.length;
    if (songs) parts.push(`${songs} song${songs === 1 ? '' : 's'}`);
    const layers = bookmark.ambience.layers.length;
    if (layers) parts.push(`${layers} layer${layers === 1 ? '' : 's'}`);
    return parts.join(' · ') || 'Silence';
  }

  function render() {
    const host = $('#bookmark-list');
    host.textContent = '';
    if (!list.length) {
      host.append(el('p', 'muted small kit-hint', 'Save the music and ambience playing now, to bring it all back with one click.'));
      return;
    }
    for (const bookmark of list) {
      const btn = el('button', 'view-btn bookmark-btn');
      btn.type = 'button';
      btn.title = `Bring back “${bookmark.name}” · right-click for options`;
      btn.append(Icons.el('bookmark', { size: 14, className: 'view-icon' }));
      const text = el('span', 'bookmark-text');
      text.append(el('span', 'kit-name', bookmark.name), el('span', 'bookmark-what', describe(bookmark)));
      btn.append(text);
      btn.addEventListener('click', () => restore(bookmark));
      btn.addEventListener('contextmenu', (e) => { e.preventDefault(); openMenu(bookmark, btn); });
      host.append(btn);
    }
  }

  $('#bookmark-save').addEventListener('click', save);
  load();

  return { load, save, restore, list: () => list };
})();
window.Bookmarks = Bookmarks;
