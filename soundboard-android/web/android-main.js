/* global DRNode, DRNative */
// Dungeon Radio on Android: what Electron's main process and preload do on the
// Mac (soundboard-mac/src/main.js, preload.js), for the same web screens.
// It gives every screen the `window.soundboard` API they expect:
// - the sound library, tags, Bashes, Scene Kits and bookmarks: the Mac's own
//   store modules, run here over node-shim.js;
// - the Live Session: the native Kotlin engine (soundboard-android/core);
// - files, pickers, notifications, vibration and the microphone: native.
//
// Native calls: DRNative.call(name, json) answers at once; DRNative.callAsync
// (name, json, id) answers later through DRBridge.resolve(id, json, error).
// Native events (Live Session, …) arrive through DRBridge.emit(channel, json).
(() => {
  const { Library, AUDIO_EXTENSIONS } = DRNode.require('library');
  const { BashStore } = DRNode.require('bashes');
  const { KitStore, KIT_ICONS, KIT_COLORS, COLUMNS } = DRNode.require('kits');
  const { BookmarkStore } = DRNode.require('bookmarks');
  const { fs, path } = DRNode;

  const ROOT = '/sounds';
  const library = new Library(ROOT);
  const bashes = new BashStore(ROOT);
  const kits = new KitStore(ROOT);
  const bookmarks = new BookmarkStore(ROOT);
  kits.finishMigration(library.list());

  // ---- Talking to the native side ----

  const call = (name, args = {}) => {
    const answer = DRNative.call(name, JSON.stringify(args));
    const parsed = answer ? JSON.parse(answer) : null;
    if (parsed && parsed.error) throw new Error(parsed.error);
    return parsed ? parsed.value : null;
  };
  const pending = new Map();
  let nextCall = 1;
  const callAsync = (name, args = {}) => new Promise((resolve, reject) => {
    const id = String(nextCall++);
    pending.set(id, { resolve, reject });
    DRNative.callAsync(name, JSON.stringify(args), id);
  });

  // Listeners per screen (the main page, or the bash editor's frame).
  const listeners = []; // { channel, fn, owner }
  function on(owner, channel, fn) { listeners.push({ channel, fn, owner }); }
  // Calls every listener on `channel` with `args`, except the screen `except`
  // (the one that made the change, as on the Mac).
  function emit(channel, args = [], except = null) {
    for (const l of listeners) {
      if (l.channel !== channel || (except && l.owner === except)) continue;
      try { l.fn(...args); } catch (err) { console.error(err); }
    }
  }

  window.DRBridge = {
    resolve(id, json, error) {
      const p = pending.get(String(id));
      if (!p) return;
      pending.delete(String(id));
      if (error) p.reject(new Error(error)); else p.resolve(json ? JSON.parse(json) : null);
    },
    // A native event with one payload (a status, a command, a list…).
    emit(channel, json) { emit(channel, [json ? JSON.parse(json) : null]); },
  };

  const serverBase = call('serverBase');
  const soundUrl = (host, file) => `${serverBase}${host}/${encodeURIComponent(file)}`;

  function titleCase(text) { return text.replace(/\b\w/g, (c) => c.toUpperCase()); }

  // Everything a screen can ask for. `owner` is the screen's window.
  function createApi(owner) {
    const soundsChanged = () => emit('sounds:changed', [], owner);
    const bashesChanged = () => emit('bashes:changed', [bashes.list()], owner);
    const kitsChanged = () => emit('kits:changed', [kits.list()], owner);
    const wrap = (fn) => (...args) => { try { return Promise.resolve(fn(...args)); } catch (err) { return Promise.reject(err); } };

    return {
      platform: 'android',
      soundUrl,
      list: wrap(() => library.list()),
      // Files: the system picker copies them into a temporary folder first.
      importDialog: wrap(async () => {
        const picked = await callAsync('pickFiles', { kind: 'audio', multiple: true });
        const added = [];
        for (const { file, name } of picked || []) {
          try {
            if (!AUDIO_EXTENSIONS.includes(path.extname(name).slice(1).toLowerCase())) continue;
            added.push(library.addFromFile(file, { name: path.basename(name, path.extname(name)) }));
          } catch (err) { console.error(err); } finally { fs.rmSync(file); }
        }
        if (added.length) soundsChanged();
        return added;
      }),
      add: wrap((sound) => { const s = library.add(sound); soundsChanged(); return s; }),
      micAccess: () => callAsync('micAccess'),
      update: wrap((id, changes) => {
        const sound = library.update(id, changes);
        soundsChanged();
        // No global hotkeys on Android.
        return { sound, sounds: library.list(), failedHotkeys: [] };
      }),
      remove: wrap((id) => {
        library.remove(id);
        soundsChanged();
        if (bashes.pruneSound(id)) emit('bashes:changed', [bashes.list()]);
        if (kits.prune('sound', id)) emit('kits:changed', [kits.list()]);
      }),
      reorder: wrap((ids) => library.reorder(ids)),
      reveal: wrap(() => {}),
      openExternal: wrap((url) => { if (/^https:\/\//.test(url)) call('openExternal', { url }); }),
      onHotkey: () => {},
      readSound: wrap((id) => {
        const sound = library.get(id);
        if (!sound) throw new Error('Sound not found');
        return fs.readFileSync(path.join(ROOT, sound.file));
      }),
      kits: {
        list: wrap(() => ({ kits: kits.list(), icons: KIT_ICONS, colors: KIT_COLORS, columns: COLUMNS })),
        create: wrap((options) => { const kit = kits.create(options); kitsChanged(); return kit; }),
        update: wrap((id, changes) => { const kit = kits.update(id, changes); kitsChanged(); return kit; }),
        addItems: wrap((id, items, sectionId) => { const kit = kits.addItems(id, items, sectionId, library.list()); kitsChanged(); return kit; }),
        removeItem: wrap((id, item, sectionId) => { const kit = kits.removeItem(id, item, sectionId); kitsChanged(); return kit; }),
        duplicate: wrap((id) => { const kit = kits.duplicate(id); kitsChanged(); return kit; }),
        remove: wrap((id) => { kits.remove(id); bookmarks.forgetKit(id); kitsChanged(); }),
        onChanged: (fn) => on(owner, 'kits:changed', fn),
      },
      bookmarks: {
        list: wrap(() => bookmarks.list()),
        save: wrap((b) => bookmarks.save(b)),
        rename: wrap((id, name) => bookmarks.rename(String(id), name)),
        remove: wrap((id) => { bookmarks.remove(String(id)); }),
      },
      editor: {
        setDirty: wrap((dirty) => { BashEditor.dirty = !!dirty; }),
        onCloseRequested: (fn) => on(owner, 'bash-editor:close-requested', fn),
      },
      tags: {
        list: wrap(() => library.tags()),
        add: wrap((name) => { const tag = library.addTag(name); soundsChanged(); return tag; }),
        remove: wrap((name) => { library.removeTag(name); soundsChanged(); }),
      },
      onSoundsChanged: (fn) => on(owner, 'sounds:changed', fn),
      bashes: {
        list: wrap(() => bashes.list()),
        get: wrap((id) => bashes.get(id)),
        create: wrap((options) => { const bash = bashes.create(options); bashesChanged(); return bash; }),
        update: wrap((id, changes) => { const bash = bashes.update(id, changes); bashesChanged(); return bash; }),
        duplicate: wrap((id) => { const bash = bashes.duplicate(id); bashesChanged(); return bash; }),
        remove: wrap((id) => {
          bashes.remove(id);
          if (kits.prune('bash', id)) emit('kits:changed', [kits.list()]);
          bashesChanged();
        }),
        openEditor: wrap((id, options) => BashEditor.open(id, options)),
        // A cover picture: picked, cropped and shrunk to 512 px here, saved by the editor.
        pickCover: wrap(async () => {
          const picked = await callAsync('pickFiles', { kind: 'image', multiple: false });
          const file = picked && picked[0];
          if (!file) return null;
          try { return await shrinkImage(fs.readFileSync(file.file), 512); } finally { fs.rmSync(file.file); }
        }),
        setCoverData: wrap((id, base64) => {
          const bash = bashes.setCoverImage(id, Buffer.from(String(base64), 'base64'), 'png');
          bashesChanged();
          return bash;
        }),
        coverData: wrap((file) => {
          const p = bashes.coverPath(file);
          if (!p || !fs.existsSync(p)) return null;
          const ext = path.extname(p).slice(1).toLowerCase();
          return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${fs.readFileSync(p).toString('base64')}`;
        }),
        onChanged: (fn) => on(owner, 'bashes:changed', fn),
      },
      ambience: {
        builtins: wrap(() => call('builtins').map((file) => ({ file, name: titleCase(file.replace(/\.wav$/, '').replace(/-/g, ' ')) }))),
        readBuiltin: wrap((file) => Buffer.from(call('readBuiltin', { file }), 'base64')),
        load: wrap(() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'ambience.json'), 'utf8')); } catch { return null; } }),
        save: wrap((state) => {
          fs.writeFileSync(path.join(ROOT, 'ambience.json.tmp'), JSON.stringify(state, null, 2));
          fs.renameSync(path.join(ROOT, 'ambience.json.tmp'), path.join(ROOT, 'ambience.json'));
        }),
      },
      live: {
        status: wrap(() => call('liveStatus')),
        hostStart: (options) => callAsync('liveHostStart', options),
        hostEvent: (event) => { try { call('liveHostEvent', event); } catch (err) { console.error(err); } },
        listen: (options) => callAsync('liveListen', options),
        leave: wrap(() => call('liveLeave')),
        browse: wrap((onOff) => call('liveBrowse', { on: !!onOff })),
        onStatus: (fn) => on(owner, 'live:status', fn),
        onCommand: (fn) => on(owner, 'live:command', fn),
        onSessions: (fn) => on(owner, 'live:sessions', fn),
        onCue: (fn) => on(owner, 'live:cue', fn),
        onRules: (fn) => on(owner, 'live:rules', fn),
        onCatalog: (fn) => on(owner, 'live:catalog', fn),
        // A player's own sounds: the native side hashes the files and offers them.
        offer: wrap((ids) => call('liveOffer', {
          sounds: (ids || []).slice(0, 5).map((id) => library.get(id)).filter(Boolean)
            .map((s) => ({ file: path.join(ROOT, s.file), name: s.name })),
        })),
        cue: wrap(({ id, soundId }) => {
          const sound = soundId ? library.get(soundId) : null;
          call('liveCue', id ? { id } : { file: sound ? path.join(ROOT, sound.file) : null });
        }),
        notify: (note) => call('notify', note),
        roll: (message) => call('liveRoll', message),
        onRoll: (fn) => on(owner, 'live:roll', fn),
        handoutSend: (data, title, to) => callAsync('liveHandoutSend', { data: Buffer.from(data).toString('base64'), title, to }),
        setAvatar: wrap((data) => call('liveAvatar', { data })),
        onAvatars: (fn) => on(owner, 'live:avatars', fn),
        handoutShow: wrap((id) => call('liveHandoutShow', { id })),
        handoutSave: (id) => callAsync('liveHandoutSave', { id }),
        onHandout: (fn) => on(owner, 'live:handout', fn),
      },
      // YouTube clipping isn't on Android yet.
      downloadAudio: () => Promise.reject(new Error('Not available on Android yet.')),
      cancelDownload: () => Promise.resolve(),
      onDownloadProgress: () => {},
      // The phone's Back button.
      onBack: (fn) => on(owner, 'app:back', fn),
    };
  }

  // A picture made into a PNG of at most `side` pixels, as base64.
  async function shrinkImage(bytes, side) {
    const bitmap = await createImageBitmap(new Blob([bytes]));
    const ratio = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL('image/png').split(',')[1];
  }

  // ---- The bash editor: a full-screen layer instead of the Mac's own window ----
  const BashEditor = {
    dirty: false,
    frame: null,
    open(id, options = {}) {
      if (this.frame) return;
      const frame = document.createElement('iframe');
      frame.className = 'android-editor';
      frame.title = 'Edit Bash';
      frame.src = `bash-editor.html?id=${encodeURIComponent(id)}&new=${options.isNew ? '1' : '0'}`;
      frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;z-index:9000;background:#181822';
      document.body.append(frame);
      this.frame = frame;
    },
    close() {
      if (!this.frame) return;
      this.frame.remove();
      this.frame = null;
      this.dirty = false;
    },
    // Back: an editor with unsaved changes asks first.
    back() {
      if (!this.frame) return false;
      if (this.dirty) emit('bash-editor:close-requested');
      else this.close();
      return true;
    },
  };

  // The editor's frame gets its own API, and closing it closes the layer.
  window.DRApp = {
    createApi,
    editorClosed: () => BashEditor.close(),
    // The phone's Back button: closes the editor, then dialogs, then panels.
    back() {
      if (BashEditor.back()) return true;
      const dialog = [...document.querySelectorAll('dialog[open]')].pop();
      if (dialog) { dialog.close(); return true; }
      let handled = false;
      emit('app:back', [{ handled: () => { handled = true; } }]);
      return handled;
    },
  };
  window.soundboard = createApi(window);
})();
