// A stand-in for the Android app's native side, for testing the web layer in
// a desktop browser: the same DRNative calls (files, the sound server,
// built-in loops, pickers…), answered by a small Node server, with real files
// in a temporary folder. The page reaches it with synchronous requests, just
// as Android's WebView reaches the app through its JavaScript interface.
//
//   const native = await startFakeNative({ webDir, ambienceDir });
//   page.addInitScript(native.initScript);   page.goto(native.url)
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MIME = { html: 'text/html', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', png: 'image/png', wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', m4a: 'audio/mp4' };

function startFakeNative({ webDir, ambienceDir }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-android-'));
  const calls = [];
  // Files the "system picker" will hand over next: [{ path, name }].
  const picks = [];
  // Paths from the page are absolute from the app's private root; no escaping it.
  const resolve = (p) => {
    const full = path.resolve(root, `.${path.posix.normalize(`/${String(p)}`)}`);
    if (!full.startsWith(root)) throw new Error('Outside the app folder');
    return full;
  };
  const fsOps = {
    fsExists: ({ p }) => fs.existsSync(resolve(p)),
    fsMkdir: ({ p }) => { fs.mkdirSync(resolve(p), { recursive: true }); return true; },
    fsRead: ({ p }) => (fs.existsSync(resolve(p)) ? fs.readFileSync(resolve(p)).toString('base64') : null),
    fsReadText: ({ p }) => (fs.existsSync(resolve(p)) ? fs.readFileSync(resolve(p), 'utf8') : null),
    fsWrite: ({ p, data }) => { fs.mkdirSync(path.dirname(resolve(p)), { recursive: true }); fs.writeFileSync(resolve(p), Buffer.from(data, 'base64')); return true; },
    fsWriteText: ({ p, data }) => { fs.mkdirSync(path.dirname(resolve(p)), { recursive: true }); fs.writeFileSync(resolve(p), data); return true; },
    fsRename: ({ a, b }) => { try { fs.renameSync(resolve(a), resolve(b)); return true; } catch { return false; } },
    fsRm: ({ p }) => { fs.rmSync(resolve(p), { recursive: true, force: true }); return true; },
    fsCopy: ({ a, b }) => { try { fs.copyFileSync(resolve(a), resolve(b)); return true; } catch { return false; } },
    fsList: ({ p }) => { try { return JSON.stringify(fs.readdirSync(resolve(p))); } catch { return '[]'; } },
    fsStat: ({ p }) => { try { const s = fs.statSync(resolve(p)); return JSON.stringify({ size: s.size, mtime: s.mtimeMs, dir: s.isDirectory() }); } catch { return 'null'; } },
  };
  let base;
  const callOps = {
    serverBase: () => base,
    builtins: () => fs.readdirSync(ambienceDir).filter((f) => f.endsWith('.wav')),
    readBuiltin: ({ file }) => fs.readFileSync(path.join(ambienceDir, path.basename(file))).toString('base64'),
    liveStatus: () => ({ role: null, bonjour: true }),
    liveLeave: () => ({ role: null }),
    liveBrowse: () => null,
    liveHostEvent: () => null,
    notify: () => null,
    openExternal: () => null,
  };
  const asyncOps = {
    // The system file picker: copies the chosen files into the app's temporary folder.
    pickFiles: () => picks.splice(0).map(({ path: from, name }) => {
      const dest = `/import/${Date.now()}-${Math.random().toString(16).slice(2)}${path.extname(name)}`;
      fs.mkdirSync(path.dirname(resolve(dest)), { recursive: true });
      fs.copyFileSync(from, resolve(dest));
      return { file: dest, name };
    }),
    micAccess: () => true,
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/native') {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        const { op, args } = JSON.parse(body);
        calls.push(op);
        let answer;
        try {
          if (fsOps[op]) answer = { value: fsOps[op](args) };
          else if (op === 'call') answer = { value: JSON.stringify({ value: (callOps[args.name] || (() => { throw new Error(`No native call ${args.name}`); }))(JSON.parse(args.json)) }) };
          else if (op === 'async') answer = { value: JSON.stringify(asyncOps[args.name] ? asyncOps[args.name](JSON.parse(args.json)) : null) };
          else answer = { error: `Unknown ${op}` };
        } catch (err) { answer = { value: JSON.stringify({ error: err.message }) }; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(answer));
      });
      return;
    }
    // The sound server: library files, built-in loops and Live Session files, with ranges.
    const m = /^\/files\/(local|builtin|live)\/(.+)$/.exec(url.pathname);
    if (m) {
      const name = decodeURIComponent(m[2]);
      const file = m[1] === 'builtin' ? path.join(ambienceDir, path.basename(name)) : resolve(`/sounds/${path.basename(name)}`);
      return serveFile(req, res, file);
    }
    const file = path.join(webDir, path.normalize(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(webDir) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).slice(1)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });

  return new Promise((ready) => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    base = `http://127.0.0.1:${port}/files/`;
    // In the page: DRNative over synchronous requests (like Android's JavaScript interface).
    const initScript = `(() => {
      const ask = (op, args) => { const x = new XMLHttpRequest(); x.open('POST', '/native', false); x.send(JSON.stringify({ op, args })); const a = JSON.parse(x.responseText); if (a.error) throw new Error(a.error); return a.value; };
      window.DRNative = {
        fsExists: (p) => ask('fsExists', { p }), fsMkdir: (p) => ask('fsMkdir', { p }),
        fsRead: (p) => ask('fsRead', { p }), fsReadText: (p) => ask('fsReadText', { p }),
        fsWrite: (p, data) => ask('fsWrite', { p, data }), fsWriteText: (p, data) => ask('fsWriteText', { p, data }),
        fsRename: (a, b) => ask('fsRename', { a, b }), fsRm: (p) => ask('fsRm', { p }), fsCopy: (a, b) => ask('fsCopy', { a, b }),
        fsList: (p) => ask('fsList', { p }), fsStat: (p) => ask('fsStat', { p }),
        call: (name, json) => ask('call', { name, json }),
        callAsync: (name, json, id) => setTimeout(() => { try { window.DRBridge.resolve(id, ask('async', { name, json }), null); } catch (e) { window.DRBridge.resolve(id, null, e.message); } }, 10),
      };
    })();`;
    ready({
      url: `http://127.0.0.1:${port}/index.html`, root, calls, initScript,
      pick: (files) => picks.push(...files),
      close: () => new Promise((done) => server.close(done)),
    });
  }));
}

function serveFile(req, res, file) {
  let stat;
  try { stat = fs.statSync(file); } catch { res.writeHead(404); res.end(); return; }
  const headers = { 'Content-Type': MIME[path.extname(file).slice(1)] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (m && stat.size > 0) {
    const start = m[1] === '' ? stat.size - Number(m[2]) : Number(m[1]);
    const end = m[1] !== '' && m[2] !== '' ? Math.min(stat.size - 1, Number(m[2])) : stat.size - 1;
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  fs.createReadStream(file).pipe(res);
}

module.exports = { startFakeNative };
