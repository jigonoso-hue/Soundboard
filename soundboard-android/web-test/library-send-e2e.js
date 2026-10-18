// Sending a library online with a code, end to end: two Android phones (the
// web screens in Chromium, each with the app's real native side, DevServer.kt)
// and the Mac's sending code (soundboard-mac/src/library-send.js in Node),
// all through the real relay.   node web-test/library-send-e2e.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync, spawn } = require('child_process');
const { chromium } = require('/opt/node-tools/node_modules/playwright');

const android = path.resolve(__dirname, '..');
const repo = path.resolve(android, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'android-send-e2e-'));
let failures = 0;
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failures++; };
const mac = path.join(repo, 'soundboard-mac/src');
const Share = require(path.join(mac, 'library-share'));
const Send = require(path.join(mac, 'library-send'));
const { Library } = require(path.join(mac, 'library'));
const { BashStore } = require(path.join(mac, 'bashes'));
const { KitStore } = require(path.join(mac, 'kits'));
const WebSocket = require(path.join(repo, 'soundboard-mac/node_modules/ws'));
const macStores = (dir) => ({ library: new Library(dir), bashes: new BashStore(dir), kits: new KitStore(dir) });

// The native side's classpath, and the web screens.
const gradle = fs.existsSync('/opt/gradle/bin/gradle') ? '/opt/gradle/bin/gradle' : 'gradle';
const cpOut = execFileSync(gradle, ['-q', ':core:printTestClasspath'], { cwd: android, encoding: 'utf8' });
const classpath = /CLASSPATH=(.*)/.exec(cpOut)[1].trim();
execFileSync('node', [path.join(android, 'scripts/assemble-web.js'), path.join(tmp, 'assets')]);
const webDir = path.join(tmp, 'assets/web');
const ambienceDir = path.join(tmp, 'assets/ambience');

function startPhone(name) {
  const data = path.join(tmp, name);
  fs.mkdirSync(data, { recursive: true });
  const proc = spawn('java', ['-cp', classpath, 'com.dungeonradio.bridge.DevServerKt', webDir, ambienceDir, data], { stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stderr.on('data', (d) => { if (process.env.VERBOSE) process.stderr.write(`[${name}] ${d}`); });
  return new Promise((resolve, reject) => {
    let buf = '';
    proc.stdout.on('data', (d) => {
      buf += d;
      const m = /READY (\d+)/.exec(buf);
      if (m) resolve({ proc, url: `http://127.0.0.1:${m[1]}` });
    });
    proc.on('exit', (code) => reject(new Error(`${name} exited ${code}`)));
  });
}

// In the page: DRNative over synchronous requests (as Android's JavaScript
// interface is synchronous), and the app's pushes polled from /events.
const initScript = (relay) => `(() => {
  try { localStorage.setItem('liveTestRelay', ${JSON.stringify(relay)}); } catch {}
  const ask = (op, args) => { const x = new XMLHttpRequest(); x.open('POST', '/native', false); x.send(JSON.stringify({ op, args })); const a = JSON.parse(x.responseText); if (a.error) throw new Error(a.error); return a.value; };
  window.__native = [];
  window.__audio = [];
  const RealAudio = window.Audio;
  window.Audio = function (src) { const a = new RealAudio(src); if (src) window.__audio.push(String(src)); return a; };
  window.Audio.prototype = RealAudio.prototype;
  // Sounds made first and given their address after (so a sound effect can
  // set crossOrigin) are recorded too.
  const srcProp = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
  Object.defineProperty(HTMLMediaElement.prototype, 'src', {
    ...srcProp,
    set(value) {
      if (value) { window.__audio.push(String(value)); (window.__fxAudio = window.__fxAudio || []).push(this); }
      srcProp.set.call(this, value);
    },
  });
  window.DRNative = {
    fsExists: (p) => ask('fsExists', { p }), fsMkdir: (p) => ask('fsMkdir', { p }),
    fsRead: (p) => ask('fsRead', { p }), fsReadText: (p) => ask('fsReadText', { p }),
    fsWrite: (p, data) => ask('fsWrite', { p, data }), fsWriteText: (p, data) => ask('fsWriteText', { p, data }),
    fsRename: (a, b) => ask('fsRename', { a, b }), fsRm: (p) => ask('fsRm', { p }), fsCopy: (a, b) => ask('fsCopy', { a, b }),
    fsList: (p) => ask('fsList', { p }), fsStat: (p) => ask('fsStat', { p }),
    call: (name, json) => ask('call', { name, json }),
    callAsync: (name, json, id) => { ask('async', { name, json, id }); },
  };
  setInterval(async () => {
    if (!window.DRBridge) return;
    const list = await (await fetch('/events')).json();
    for (const e of list) {
      window.__native.push(e);
      if (e.type === 'emit') window.DRBridge.emit(e.channel, e.json);
      else if (e.type === 'resolve') window.DRBridge.resolve(e.id, e.json, e.error);
    }
  }, 40);
})();`;

async function until(fn, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out: ${label}`);
}

(async () => {
  const { createRelay } = require(path.join(repo, 'live-relay/server.js'));
  const relay = await createRelay({ port: 0, host: '127.0.0.1' });
  const relayUrl = `ws://127.0.0.1:${relay.port}`;
  const a = await startPhone('a');
  const b = await startPhone('b');
  const browser = await chromium.launch();
  const errors = [];
  const phone = async (name, url) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    await page.addInitScript(initScript(relayUrl));
    await page.goto(`${url}/index.html`);
    await page.waitForTimeout(800);
    return page;
  };
  const options = (page) => page.evaluate(() => document.getElementById('options-dialog').showModal());
  try {
    const pageA = await phone('a', a.url);
    const pageB = await phone('b', b.url);

    // Phone A has two sounds.
    await fetch(`${a.url}/test/pick`, { method: 'POST', body: JSON.stringify([{ path: path.join(ambienceDir, 'campfire.wav'), name: 'Campfire.wav' }, { path: path.join(ambienceDir, 'rain.wav'), name: 'Rain.wav' }]) });
    await pageA.click('#add-menu-btn'); await pageA.click('#add-btn');
    await until(() => pageA.isVisible('dialog[open] button:has-text("Skip")'), 'the tags step');
    await pageA.click('dialog[open] button:has-text("Skip")');
    await until(() => pageA.evaluate(async () => (await window.soundboard.list()).length === 2), 'two sounds');

    // A sends with a code.
    await options(pageA);
    await pageA.click('#share-send');
    const code = (await until(() => pageA.textContent('#share-code').then((t) => (/^[A-Z2-9]{5}$/.test(t.trim()) ? t.trim() : null)), 'a code'));
    check(true, `phone A sends with code ${code}`);
    check(/Give this code/.test(await pageA.textContent('#share-send-hint')), 'it says what to do with the code');

    // B receives it.
    await options(pageB);
    await pageB.fill('#share-receive-code', code.toLowerCase());
    await pageB.click('#share-receive');
    const got = await until(() => pageB.textContent('#share-receive-text').then((t) => (/^Added|error|isn|Lost|stopped|Nothing/.test(t) ? t : null)), 'B finished', 30000);
    check(got === 'Added 2 sounds.', `phone B received it (${got})`);
    check(await pageB.evaluate(async () => (await window.soundboard.list()).map((s) => s.name).sort().join()) === 'Campfire,Rain', 'B has both sounds');
    const seen = await until(() => pageA.textContent('#share-receivers').then((t) => (/has it/.test(t) ? t : null)), 'A sees it arrived');
    check(/Test Phone has it\. Added 2 sounds\./.test(seen), `A sees who got it (${seen})`);

    // The Mac receives from the same code too.
    const macDir = fs.mkdtempSync(path.join(tmp, 'mac-'));
    const macLib = macStores(macDir);
    const zip = path.join(macDir, 'in.zip');
    let macStatus = {};
    Send.startReceiver({
      open: Send.nodeSocket(WebSocket), relay: relayUrl, code, name: 'Jon’s Mac',
      writeChunk: async (_i, data) => fs.appendFileSync(zip, Buffer.from(data, 'base64')),
      finish: async () => { const r = Share.importFromZip(zip, macLib); return { ...r, message: Share.describeImport(r) }; },
      onStatus: (s) => { macStatus = s; },
    });
    await until(() => macStatus.phase === 'done' || macStatus.phase === 'error', 'the Mac finished', 30000);
    check(macStatus.message === 'Added 2 sounds.', `the Mac received the phone's library (${macStatus.message || macStatus.error})`);

    // A stops; the panel closes.
    await pageA.click('#share-send-stop');
    check(!(await pageA.isVisible('#share-send-panel')), 'Stop Sending closes it');

    // The Mac sends to phone B.
    const sendDir = fs.mkdtempSync(path.join(tmp, 'mac-send-'));
    const sendLib = macStores(sendDir);
    sendLib.library.add({ name: 'Thunder', data: fs.readFileSync(path.join(ambienceDir, 'thunderstorm.wav')), ext: 'wav', kind: 'clip', duration: 3 });
    const sendZip = path.join(sendDir, 'out.zip');
    const summary = Share.exportToZip(sendZip, sendLib, 'Mac');
    let macSent = {};
    const size = fs.statSync(sendZip).size;
    const sender = Send.startSender({
      open: Send.nodeSocket(WebSocket), relay: relayUrl, size, summary, name: 'Jon’s Mac',
      readChunk: async (i) => fs.readFileSync(sendZip).subarray(i * Send.CHUNK, (i + 1) * Send.CHUNK).toString('base64'),
      onStatus: (s) => { macSent = s; },
    });
    const macCode = await until(() => macSent.code, 'the Mac\'s code');
    await pageB.click('#share-receive-cancel');
    await pageB.fill('#share-receive-code', macCode);
    await pageB.click('#share-receive');
    const got2 = await until(() => pageB.textContent('#share-receive-text').then((t) => (/^Added|isn|Lost|stopped|Nothing/.test(t) ? t : null)), 'B finished again', 30000);
    check(got2 === 'Added 1 sound.', `phone B received the Mac's library (${got2})`);
    sender.stop();

    // A wrong code.
    await pageB.click('#share-receive-cancel');
    await pageB.fill('#share-receive-code', 'ZZZZZ');
    await pageB.press('#share-receive-code', 'Enter');
    check(await pageB.isVisible('#options-dialog[open]'), 'Enter in the code box doesn\'t close Options');
    const wrong = await until(() => pageB.textContent('#share-receive-text').then((t) => (/Nothing is being sent/.test(t) ? t : null)), 'wrong code message');
    check(!!wrong, 'a wrong code says so');

    await pageB.screenshot({ path: path.join(tmp, 'receive.png') });
    check(!errors.length, `no page errors ${errors.join(' | ')}`);
  } catch (err) {
    check(false, err.stack || err.message);
  }
  await browser.close();
  a.proc.kill();
  b.proc.kill();
  await relay.close?.();
  console.log(failures ? `${failures} failed` : 'All passed');
  process.exit(failures ? 1 : 0);
})();
