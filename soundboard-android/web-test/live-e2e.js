// Two Android phones in a Live Session, end to end: the web screens in
// Chromium, each with the app's real native side (core's NativeBridge, run by
// DevServer.kt), joined through the real relay.   node web-test/live-e2e.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync, spawn } = require('child_process');
const { chromium } = require('/opt/node-tools/node_modules/playwright');

const android = path.resolve(__dirname, '..');
const repo = path.resolve(android, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'android-live-e2e-'));
let failures = 0;
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failures++; };

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
  const gm = await startPhone('gm');
  const player = await startPhone('player');
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
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
  try {
    const gmPage = await phone('gm', gm.url);
    const playerPage = await phone('player', player.url);

    // The broadcaster adds a sound from the "system picker".
    await fetch(`${gm.url}/test/pick`, { method: 'POST', body: JSON.stringify([{ path: path.join(ambienceDir, 'campfire.wav'), name: 'Dragon Roar.wav' }]) });
    await gmPage.click('#add-btn');
    await until(() => gmPage.isVisible('dialog[open] button:has-text("Skip")'), 'the tags step');
    await gmPage.click('dialog[open] button:has-text("Skip")');
    await until(() => gmPage.isVisible('.tile:has-text("Dragon Roar")'), 'the added tile');
    check(true, 'a sound is added through the native picker');

    // Broadcasting online.
    await gmPage.click('#live-btn');
    await gmPage.click('.live-mode:has-text("Online")');
    await gmPage.click('button:has-text("Start Broadcasting")');
    const code = (await until(() => gmPage.textContent('.live-code').then((t) => t && t.trim()), 'the session code')).trim();
    check(/^[A-Z0-9]{4,8}$/.test(code), `broadcasting online with code ${code}`);
    check(await gmPage.evaluate(() => window.__native.some((e) => e.type === 'session' && e.active)), 'the app is told to keep running in the background');

    // The player tunes in with the code.
    await playerPage.click('#live-btn');
    await playerPage.click('.live-tabs >> text=Tune In');
    await playerPage.fill('input[placeholder="e.g. Sam"]', 'Pat');
    await playerPage.fill('.live-code-input', code);
    await playerPage.click('.live-code-row .tune-in');
    await until(() => playerPage.evaluate(() => window.__native.some((e) => e.channel === 'live:status' && JSON.parse(e.json).state === 'connected')), 'the player connected');
    check(true, 'the player tunes in with the code');
    await until(() => gmPage.evaluate(() => window.__native.some((e) => e.channel === 'live:status' && (JSON.parse(e.json).peers || []).some((p) => p.name === 'Pat'))), 'Pat in the broadcaster\'s list');
    check(true, 'the broadcaster sees the player');
    await gmPage.keyboard.press('Escape');

    // The broadcaster plays the sound; the player's phone plays it from its own sound server.
    await gmPage.click('.tile:has-text("Dragon Roar")');
    const heard = await until(() => playerPage.evaluate(() => window.__audio.find((u) => u.includes('/live/'))), 'the player playing the sound');
    check(heard.startsWith('http://127.0.0.1:'), `the player plays it from its own server (${heard.replace(/[0-9a-f]{32}/g, '…')})`);
    const bytes = await playerPage.evaluate(async (u) => (await (await fetch(u)).arrayBuffer()).byteLength, heard);
    check(bytes === fs.statSync(path.join(ambienceDir, 'campfire.wav')).size, 'the fetched copy is the whole sound');

    // A built-in ambience loop reaches the player too.
    await gmPage.evaluate(() => { const toggle = document.querySelector('#amb-collapse'); if (document.querySelector('#amb-layers').classList.contains('hidden')) toggle.click(); });
    await gmPage.click('.layer-name:text-is("Rain")');
    const layer = await until(() => playerPage.evaluate(() => window.__native.map((e) => e.channel === 'live:command' && JSON.parse(e.json))
      .filter((c) => c && c.t === 'ambience').flatMap((c) => c.layers).find((l) => l.builtin === 'rain.wav')), 'rain at the player');
    check(layer.url.includes('/builtin/rain.wav'), 'ambience plays from the player\'s built-in copy (rain.wav)');
    const rain = await playerPage.evaluate(async (u) => (await (await fetch(u)).arrayBuffer()).byteLength, layer.url);
    check(rain === fs.statSync(path.join(ambienceDir, 'rain.wav')).size, 'the built-in loop can be fetched to decode');

    // Leaving.
    await playerPage.evaluate(() => window.soundboard.live.leave());
    await until(() => gmPage.evaluate(() => window.__native.filter((e) => e.channel === 'live:status').map((e) => JSON.parse(e.json)).pop().peers.length === 0), 'the player gone');
    check(true, 'the player leaves and the broadcaster\'s list empties');

    const errs = errors.filter((e) => !/AudioContext|play\(\) request|NotSupportedError/.test(e));
    check(errs.length === 0, `no page errors ${errs.slice(0, 3).join(' | ')}`);
  } catch (e) {
    check(false, e.message.split('\n').slice(0, 6).join(' | '));
    for (const p of browser.contexts().flatMap((c) => c.pages())) {
      await p.screenshot({ path: path.join(os.tmpdir(), `live-e2e-fail-${browser.contexts().indexOf(p.context())}.png`) }).catch(() => {});
    }
  }
  await browser.close();
  gm.proc.kill();
  player.proc.kill();
  await relay.close?.();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failures ? `${failures} failed` : 'All passed');
  process.exit(failures ? 1 : 0);
})();
