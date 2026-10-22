// Record a Sound's edit step on the phone screens: every voice effect renders
// (sensible length, not silent, no clipping), and a recording saved with an
// effect and a sound played along has the right length.
//   node web-test/recorder-edit.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const { startFakeNative } = require('./fake-native');

const android = path.resolve(__dirname, '..');
const assets = fs.mkdtempSync(path.join(os.tmpdir(), 'android-assets-'));
execFileSync('node', [path.join(android, 'scripts/assemble-web.js'), assets]);
let failures = 0;
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failures++; };

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const native = await startFakeNative({ webDir: path.join(assets, 'web'), ambienceDir: path.join(assets, 'ambience') });
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ['microphone'] })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(native.initScript);
  try {
    await page.goto(native.url);
    await page.waitForTimeout(800);
    await page.evaluate(() => window.soundboard.premium.testUnlock(true));
    native.pick([{ path: path.join(assets, 'ambience', 'thunderstorm.wav'), name: 'Thunder.wav' }]);
    await page.click('#add-menu-btn'); await page.click('#add-btn'); await page.waitForTimeout(800);
    if (await page.isVisible('dialog[open] button:has-text("Skip")')) await page.click('dialog[open] button:has-text("Skip")');

    // Every effect, on a second of tone.
    const stats = await page.evaluate(async () => {
      const sr = 44100;
      const voice = new Float32Array(sr);
      for (let i = 0; i < sr; i++) voice[i] = 0.5 * Math.sin(2 * Math.PI * 220 * i / sr);
      const res = {};
      for (const effect of [null, ...Fx.VOICE.map((v) => v.id)]) {
        const out = await VoiceEdit.render({ voice, sampleRate: sr, effect });
        let peak = 0; let sum = 0;
        for (const v of out) { peak = Math.max(peak, Math.abs(v)); sum += v * v; }
        res[effect || 'none'] = { seconds: out.length / sr, peak, rms: Math.sqrt(sum / out.length), nan: out.some(Number.isNaN) };
      }
      return res;
    });
    for (const [id, s] of Object.entries(stats)) {
      check(!s.nan && s.rms > 0.05 && s.peak <= 0.99 && s.seconds >= 1 && s.seconds <= 7, `${id}: ${s.seconds.toFixed(2)} s, rms ${s.rms.toFixed(3)}, peak ${s.peak.toFixed(2)}`);
    }
    check(Math.abs(stats.demon.seconds - (1 / 0.72 + 1.5)) < 0.05, 'Demon plays slower (so deeper)');
    check(Math.abs(stats.fairy.seconds - (1 / 1.35 + 3)) < 0.05, 'Fairy plays faster (so higher)');

    // Record, edit, listen, save.
    await page.click('#add-menu-btn'); await page.click('#record-btn'); await page.waitForTimeout(300);
    await page.click('#record-toggle'); await page.waitForTimeout(1600); await page.click('#record-toggle');
    await page.waitForSelector('#record-after:not(.hidden)', { timeout: 5000 });
    check((await page.$$eval('#record-fx button', (b) => b.map((x) => x.textContent))).join() === 'None,Radio,Static,Distorted,Robot,Ghost,Demon,Distant room,Empty echo,Underwater,Cave,Megaphone,Warble,Fairy', 'the effects to choose from');
    await page.click('#record-fx button:has-text("Robot")');
    check(await page.getAttribute('#record-fx button:has-text("Robot")', 'aria-checked') === 'true', 'Robot is chosen');
    await page.selectOption('#record-add-layer', { label: 'Thunder' });
    await page.waitForSelector('.record-layer');
    await page.fill('.record-layer input[type=number]', '0.5');
    await page.press('.record-layer input[type=number]', 'Tab');
    await page.click('#record-listen');
    await page.waitForFunction(() => document.getElementById('record-listen').textContent.includes('Stop'), null, { timeout: 15000 });
    check(true, 'Listen plays the edited recording');
    await page.click('#record-listen');
    await page.fill('#record-name', 'Robot Line');
    await page.click('#record-save');
    await page.waitForTimeout(1500);
    if (await page.isVisible('dialog[open] button:has-text("Skip")')) await page.click('dialog[open] button:has-text("Skip")');
    const saved = await page.evaluate(async () => (await window.soundboard.list()).find((s) => s.name === 'Robot Line'));
    check(saved && Math.abs(saved.duration - 60.5) < 0.2, `saved with the thunder playing along from 0.5 s (${saved && saved.duration} s)`);
    check(!errors.length, `no page errors ${errors.join(' | ')}`);
  } catch (err) {
    check(false, err.stack);
  } finally {
    await native.close();
    await browser.close();
  }
  console.log(failures ? `${failures} failed` : 'All passed');
  process.exit(failures ? 1 : 0);
})();
