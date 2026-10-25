// The real Mac app in Electron: the bash editor opens over the main window
// (no new window), each clip shows its own settings when you switch between
// them, Save closes it, and closing the window with unsaved changes asks first.
//   xvfb-run -a node e2e/bash-editor.js [shotsDir]   (on Linux; needs Playwright)
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron: electron } = require(process.env.PLAYWRIGHT || '/opt/node-tools/node_modules/playwright');
const app = path.resolve(__dirname, '..');
const out = process.argv[2] || fs.mkdtempSync(path.join(require('os').tmpdir(), 'dr-e2e-'));
const log = [];
const check = (ok, msg) => { log.push(`${ok ? 'PASS' : 'FAIL'} ${msg}`); console.log(log[log.length - 1]); };
(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-home-'));
  const eapp = await electron.launch({ executablePath: path.join(app, 'node_modules/electron/dist/electron'), args: [app, '--no-sandbox'], env: { ...process.env, HOME: home } });
  const win = await eapp.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await win.waitForTimeout(1500);
  // Two sounds.
  const wav = fs.readFileSync(path.join(app, '../soundboard-ipad/Soundboard.swiftpm/Resources/Ambience/rain.wav'));
  const wav2 = fs.readFileSync(path.join(app, '../soundboard-ipad/Soundboard.swiftpm/Resources/Ambience/campfire.wav'));
  await win.evaluate(async ([a, b]) => {
    await window.soundboard.add({ name: 'Rain', data: new Uint8Array(a), ext: 'wav', kind: 'clip' });
    await window.soundboard.add({ name: 'Fire', data: new Uint8Array(b), ext: 'wav', kind: 'clip' });
  }, [[...wav], [...wav2]]);
  await win.reload();
  await win.waitForTimeout(1500);
  const bash = await win.evaluate(async () => {
    const sounds = await window.soundboard.list();
    return window.soundboard.bashes.create({ name: 'Ambush', soundIds: sounds.map((s) => s.id) });
  });
  await win.waitForTimeout(500);
  const windowsBefore = eapp.windows().length;
  await win.evaluate((id) => window.soundboard.bashes.openEditor(id), bash.id);
  await win.waitForSelector('iframe.editor-layer', { timeout: 5000 });
  await win.waitForTimeout(2000);
  check(eapp.windows().length === windowsBefore, `the editor opens in the same window (${eapp.windows().length} window)`);
  const frame = win.frames().find((f) => f.url().includes('bash-editor.html'));
  check(!!frame && (await frame.$$('.clip')).length === 2, 'the editor shows the bash\'s two sounds');
  await win.screenshot({ path: path.join(out, '1-editor-in-window.png') });

  // Switch between clips: their own volume and speed show.
  await frame.click('.clip >> nth=0', { position: { x: 30, y: 20 } });
  await frame.$eval('#clip-volume', (el) => { el.focus(); el.value = '0.3'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  // Left focused on the slider, then another sound clicked.
  await frame.click('.clip >> nth=1', { position: { x: 30, y: 20 } });
  const secondVol = await frame.inputValue('#clip-volume');
  // A speed typed (no Enter) into the second, then the first clicked.
  await frame.fill('#clip-speed', '2');
  await frame.click('.clip >> nth=0', { position: { x: 30, y: 20 } });
  const first = { vol: await frame.inputValue('#clip-volume'), speed: await frame.inputValue('#clip-speed') };
  await frame.click('.clip >> nth=1', { position: { x: 30, y: 20 } });
  const second = { vol: await frame.inputValue('#clip-volume'), speed: await frame.inputValue('#clip-speed') };
  check(secondVol === '1' && first.vol === '0.3' && first.speed === '1' && second.vol === '1' && second.speed === '2',
    `switching sounds shows each one's own volume and speed (${JSON.stringify({ secondVol, first, second })})`);

  // Save: the board hears about it, and the layer closes.
  await frame.click('#save-btn');
  await win.waitForTimeout(800);
  check(!(await win.$('iframe.editor-layer')), 'Save closes the editor');
  const saved = await win.evaluate((id) => window.soundboard.bashes.get(id), bash.id);
  check(saved.clips[0].volume === 0.3 && !saved.clips[0].speed && saved.clips[1].speed === 2, 'the changes are saved');

  // ⌘W with unsaved changes asks first instead of closing the app.
  await win.evaluate((id) => window.soundboard.bashes.openEditor(id), bash.id);
  await win.waitForSelector('iframe.editor-layer');
  await win.waitForTimeout(1500);
  const f2 = win.frames().find((f) => f.url().includes('bash-editor.html'));
  await f2.fill('#bash-name', 'Ambush 2');
  await win.waitForTimeout(200);
  await eapp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await win.waitForTimeout(500);
  check(await f2.isVisible('#confirm-close'), 'closing the window with unsaved changes asks first');
  await f2.click('#confirm-close button[value=discard]');
  await win.waitForTimeout(500);
  check(!(await win.$('iframe.editor-layer')) && eapp.windows().length === 1, 'Don\'t Save closes the editor, and the app stays open');
  check(errors.length === 0, `no errors ${errors.slice(0, 4).join(' | ')}`);
  await eapp.close();
  process.exit(log.some((l) => l.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.log('FAIL', e.stack); process.exit(1); });
