/* global window, document */
// The bash editor, opened over the main window instead of in a window of its
// own. It runs in a frame (bash-editor.html) without the app's preload, so it
// reaches the app through this page: editor-frame.js in the frame sends each
// call here, and only the calls the editor needs are answered.
// (Android has its own layer in android-main.js; this one stays idle there.)
(function () {
  const api = window.soundboard;
  if (!api || !api.bashes || !api.bashes.onOpenEditor) return;

  // What the editor may call, by name.
  const CALLS = {
    list: () => api.list(),
    readSound: (id) => api.readSound(id),
    'bashes.get': (id) => api.bashes.get(id),
    'bashes.update': (id, changes) => api.bashes.update(id, changes),
    'bashes.remove': (id) => api.bashes.remove(id),
    'bashes.pickCover': () => api.bashes.pickCover(),
    'bashes.setCoverData': (id, data) => api.bashes.setCoverData(id, data),
    'bashes.coverData': (file) => api.bashes.coverData(file),
  };

  let frame = null;
  let dirty = false;
  const send = (msg) => { if (frame && frame.contentWindow) frame.contentWindow.postMessage(msg, '*'); };
  const report = () => api.editor.setLayer({ open: !!frame, dirty });

  function open(id, { isNew = false } = {}) {
    if (frame) {
      // Already editing: a different bash waits until this one is closed.
      send({ dr: 'editor-event', event: 'focus' });
      return;
    }
    frame = document.createElement('iframe');
    frame.className = 'editor-layer';
    frame.title = 'Edit Bash';
    frame.src = `bash-editor.html?id=${encodeURIComponent(id)}&new=${isNew ? '1' : '0'}`;
    document.body.append(frame);
    document.body.classList.add('editing-bash');
    dirty = false;
    report();
    frame.addEventListener('load', () => frame && frame.focus());
  }

  function close() {
    if (!frame) return;
    frame.remove();
    frame = null;
    dirty = false;
    document.body.classList.remove('editing-bash');
    report();
  }

  window.addEventListener('message', async (e) => {
    if (!frame || e.source !== frame.contentWindow) return;
    const msg = e.data || {};
    if (msg.dr === 'editor-call') {
      const fn = Object.prototype.hasOwnProperty.call(CALLS, msg.path) ? CALLS[msg.path] : null;
      try {
        if (!fn) throw new Error(`Not available: ${msg.path}`);
        send({ dr: 'editor-result', id: msg.id, ok: true, value: await fn(...(Array.isArray(msg.args) ? msg.args : [])) });
      } catch (err) {
        send({ dr: 'editor-result', id: msg.id, ok: false, error: String((err && err.message) || err) });
      }
    } else if (msg.dr === 'editor-dirty') {
      dirty = !!msg.dirty;
      report();
    } else if (msg.dr === 'editor-close') {
      close();
    }
  });

  // Changes the editor should hear about, and ⌘W / the red button while it's open.
  api.bashes.onChanged((list) => send({ dr: 'editor-event', event: 'bashes', payload: list }));
  api.onSoundsChanged(() => send({ dr: 'editor-event', event: 'sounds' }));
  api.editor.onCloseRequested(() => send({ dr: 'editor-event', event: 'close-requested' }));
  api.bashes.onOpenEditor((id, options) => open(id, options || {}));

  window.EditorLayer = { open, close, isOpen: () => !!frame };
})();
