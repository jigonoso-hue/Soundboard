/* global window, document */
// In the bash editor's frame over the main window (editor-layer.js): the
// editor's window.soundboard, with every call passed to the main page.
// Does nothing where the editor already has an API (Android's layer).
(function () {
  if (window.soundboard || window.parent === window) return;
  const parent = window.parent;
  const pending = new Map();
  const listeners = { bashes: [], sounds: [], 'close-requested': [] };
  let next = 0;

  const call = (path) => (...args) => new Promise((resolve, reject) => {
    const id = ++next;
    pending.set(id, { resolve, reject });
    parent.postMessage({ dr: 'editor-call', id, path, args }, '*');
  });
  const on = (event) => (fn) => { listeners[event].push(fn); };

  window.addEventListener('message', (e) => {
    if (e.source !== parent) return;
    const msg = e.data || {};
    if (msg.dr === 'editor-result') {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.value); else p.reject(new Error(msg.error));
    } else if (msg.dr === 'editor-event') {
      if (msg.event === 'focus') { window.focus(); return; }
      for (const fn of listeners[msg.event] || []) fn(msg.payload);
    }
  });

  window.soundboard = {
    platform: 'mac',
    list: call('list'),
    readSound: call('readSound'),
    onSoundsChanged: on('sounds'),
    bashes: {
      get: call('bashes.get'),
      update: call('bashes.update'),
      remove: call('bashes.remove'),
      pickCover: call('bashes.pickCover'),
      setCoverData: call('bashes.setCoverData'),
      coverData: call('bashes.coverData'),
      onChanged: on('bashes'),
    },
    editor: {
      setDirty: (dirty) => { parent.postMessage({ dr: 'editor-dirty', dirty: !!dirty }, '*'); return Promise.resolve(); },
      onCloseRequested: on('close-requested'),
    },
  };
  // "Closing the window" closes the layer.
  window.close = () => parent.postMessage({ dr: 'editor-close' }, '*');
  document.documentElement.classList.add('in-layer');
})();
