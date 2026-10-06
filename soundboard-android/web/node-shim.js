// Just enough of Node for the Mac app's store modules (src/library.js,
// bashes.js, kits.js, bookmarks.js) to run unchanged inside Android's WebView:
// a synchronous `fs` over the app's native bridge (DRNative), `path`,
// `crypto.randomUUID`, `Buffer` and a small `require`. Files live under the
// app's private storage; paths here are absolute from its root ("/sounds/…").
(() => {
  const native = window.DRNative;
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  // ---- Buffer: a Uint8Array with toString('base64' | 'utf8') ----
  class Buffer extends Uint8Array {
    static from(value, encoding) {
      if (typeof value === 'string') {
        if (encoding === 'base64') {
          const bin = atob(value);
          const out = new Buffer(bin.length);
          for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
          return out;
        }
        const bytes = enc.encode(value);
        const out = new Buffer(bytes.length);
        out.set(bytes);
        return out;
      }
      if (value instanceof ArrayBuffer) return new Buffer(new Uint8Array(value));
      const bytes = value instanceof Uint8Array ? value : Uint8Array.from(value || []);
      const out = new Buffer(bytes.length);
      out.set(bytes);
      return out;
    }

    static isBuffer(value) { return value instanceof Buffer; }

    toString(encoding = 'utf8') {
      if (encoding === 'base64') return toBase64(this);
      return dec.decode(this);
    }
  }

  function toBase64(bytes) {
    let bin = '';
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
    return btoa(bin);
  }

  // ---- path (POSIX) ----
  function normalize(parts) {
    const out = [];
    for (const part of parts) {
      if (!part || part === '.') continue;
      if (part === '..') out.pop(); else out.push(part);
    }
    return out;
  }
  const path = {
    sep: '/',
    join: (...parts) => {
      const joined = parts.filter((p) => p !== '').join('/');
      const abs = joined.startsWith('/');
      return (abs ? '/' : '') + normalize(joined.split('/')).join('/');
    },
    resolve: (...parts) => {
      let joined = '';
      for (const p of parts) joined = p.startsWith('/') ? p : `${joined}/${p}`;
      return `/${normalize(joined.split('/')).join('/')}`;
    },
    dirname: (p) => {
      const parts = normalize(String(p).split('/'));
      parts.pop();
      return (String(p).startsWith('/') ? '/' : '') + parts.join('/') || '/';
    },
    basename: (p, ext) => {
      const base = String(p).split('/').filter(Boolean).pop() || '';
      return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
    },
    extname: (p) => {
      const base = path.basename(p);
      const dot = base.lastIndexOf('.');
      return dot > 0 ? base.slice(dot) : '';
    },
  };

  // ---- fs (synchronous, over the native bridge) ----
  const missing = (p) => Object.assign(new Error(`ENOENT: no such file or directory, '${p}'`), { code: 'ENOENT' });
  const fs = {
    existsSync: (p) => native.fsExists(String(p)),
    mkdirSync: (p) => { native.fsMkdir(String(p)); },
    readFileSync: (p, options) => {
      const encoding = typeof options === 'string' ? options : options && options.encoding;
      if (encoding === 'utf8' || encoding === 'utf-8') {
        const text = native.fsReadText(String(p));
        if (text === null || text === undefined) throw missing(p);
        return text;
      }
      const b64 = native.fsRead(String(p));
      if (b64 === null || b64 === undefined) throw missing(p);
      return Buffer.from(b64, 'base64');
    },
    writeFileSync: (p, data) => {
      if (typeof data === 'string') native.fsWriteText(String(p), data);
      else native.fsWrite(String(p), toBase64(data instanceof Uint8Array ? data : Buffer.from(data)));
    },
    renameSync: (a, b) => { if (!native.fsRename(String(a), String(b))) throw missing(a); },
    rmSync: (p) => { native.fsRm(String(p)); },
    copyFileSync: (a, b) => { if (!native.fsCopy(String(a), String(b))) throw missing(a); },
    readdirSync: (p) => JSON.parse(native.fsList(String(p)) || '[]'),
    statSync: (p) => {
      const info = JSON.parse(native.fsStat(String(p)) || 'null');
      if (!info) throw missing(p);
      return { size: info.size, mtimeMs: info.mtime, isFile: () => !info.dir, isDirectory: () => !!info.dir };
    },
  };

  const crypto = { randomUUID: () => window.crypto.randomUUID() };

  // ---- require ----
  const builtins = { fs, path, crypto };
  const factories = new Map();
  const cache = new Map();
  function resolveName(from, name) {
    if (!name.startsWith('.')) return name;
    return path.join(path.dirname(`/${from}`), name).replace(/^\//, '').replace(/\.js$/, '');
  }
  function load(name) {
    if (builtins[name]) return builtins[name];
    if (cache.has(name)) return cache.get(name).exports;
    const factory = factories.get(name);
    if (!factory) throw new Error(`Cannot find module '${name}'`);
    const module = { exports: {} };
    cache.set(name, module);
    factory(module, module.exports, (dep) => load(resolveName(name, dep)));
    return module.exports;
  }

  window.Buffer = Buffer;
  window.DRNode = {
    // Registers a CommonJS module by its path in soundboard-mac/src ("library", "renderer/icons").
    define: (name, factory) => factories.set(name, factory),
    require: load,
    path,
    fs,
  };
})();
