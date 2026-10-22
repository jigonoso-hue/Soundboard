// Boots the Android app's web layer in Chromium at phone size on the fake
// native side, and checks the main flows work without Electron.
//   node web-test/smoke.js [shotsDir]
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const { startFakeNative } = require('./fake-native');

const android = path.resolve(__dirname, '..');
const shots = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'android-shots-'));
const assets = fs.mkdtempSync(path.join(os.tmpdir(), 'android-assets-'));
execFileSync('node', [path.join(android, 'scripts/assemble-web.js'), assets]);
const log = [];
const check = (ok, msg) => { log.push(`${ok ? 'PASS' : 'FAIL'} ${msg}`); console.log(log[log.length - 1]); };

(async () => {
  const native = await startFakeNative({ webDir: path.join(assets, 'web'), ambienceDir: path.join(assets, 'ambience') });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(native.initScript);
  const shot = (name) => page.screenshot({ path: path.join(shots, `${name}.png`) });
  try {
    await page.goto(native.url);
    await page.waitForTimeout(1200);
    await shot('1-first-launch');
    check(await page.evaluate(() => window.soundboard.platform === 'android'), 'the Android layer is in place');
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    check(wide <= 390, `nothing scrolls sideways (${wide}px)`);

    // Add sounds through the "system picker".
    native.pick([{ path: path.join(assets, 'ambience/rain.wav'), name: 'Rain Hit.wav' }, { path: path.join(assets, 'ambience/campfire.wav'), name: 'Campfire Crackle.wav' }]);
    await page.click('#add-menu-btn'); await page.click('#add-btn');
    await page.waitForSelector('.tile, .track', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(800);
    const names = await page.$$eval('.tile-name, .track-name', (n) => n.map((x) => x.textContent));
    check(names.includes('Rain Hit') && names.includes('Campfire Crackle'), `sounds added from the picker (${names.join(', ')})`);
    const stored = JSON.parse(fs.readFileSync(path.join(native.root, 'sounds/library.json'), 'utf8'));
    check(stored.length === 2 && fs.existsSync(path.join(native.root, 'sounds', stored[0].file)), 'saved as files with a library index (the Mac\'s format)');
    check(!fs.readdirSync(path.join(native.root, 'import')).length, 'the picker\'s temporary copies are cleaned up');
    await page.keyboard.press('Escape');
    await shot('2-library');

    // Play one: the audio comes from the app's sound server.
    const first = await page.$('.tile, .track');
    await first.click();
    await page.waitForTimeout(700);
    const playing = await page.evaluate(() => [...playing.values()].flatMap((s) => [...s]).map((a) => ({ src: a.src, paused: a.paused, time: a.currentTime })));
    check(playing.length > 0 && playing[0].src.includes('/files/local/') && !playing[0].paused, `a sound plays from the app's file server (${JSON.stringify(playing[0] || {})})`);
    await page.evaluate(() => stopAll());

    // The drawer: scene kits, bookmarks, the library.
    check(!(await page.isVisible('#sidebar .kit-list')) || (await page.evaluate(() => getComputedStyle(document.getElementById('sidebar')).transform !== 'none')), 'the sidebar starts closed on a phone');
    await page.click('#android-menu');
    await page.waitForTimeout(400);
    await shot('3-drawer');
    check(await page.evaluate(() => document.documentElement.classList.contains('drawer-open')), 'the menu button opens the drawer');
    await page.evaluate(() => window.DRBack());
    check(await page.evaluate(() => !document.documentElement.classList.contains('drawer-open')), 'Back closes the drawer');

    // A scene kit.
    await page.click('#android-menu');
    await page.click('#kit-new');
    await page.fill('#kit-name', 'Tavern');
    await page.click('#kit-dialog button[value=save]');
    await page.waitForTimeout(600);
    await shot('4-kit');
    const kits = JSON.parse(fs.readFileSync(path.join(native.root, 'sounds/kits.json'), 'utf8'));
    check(kits.length === 1 && kits[0].name === 'Tavern', 'a scene kit is saved');

    // A bookmark.
    await page.evaluate(() => Kits.askText && 0);
    await page.click('#android-menu');
    await page.click('#bookmark-save');
    await page.fill('#text-dialog-input', 'Start');
    await page.click('#text-dialog button[value=save]');
    await page.waitForTimeout(400);
    const marks = JSON.parse(fs.readFileSync(path.join(native.root, 'sounds/bookmarks.json'), 'utf8'));
    check(marks.length === 1 && marks[0].name === 'Start', 'a bookmark is saved');
    await page.evaluate(() => window.DRBack());

    // A bash, edited in the full-screen editor layer.
    await page.evaluate(() => { document.querySelector('.view-btn[data-view="bashes"]')?.click(); });
    await page.waitForTimeout(300);
    await page.click('#bash-new');
    await page.waitForSelector('iframe.android-editor', { timeout: 5000 });
    await page.waitForTimeout(1200);
    await shot('5-bash-editor');
    let frame = page.frames().find((f) => f.url().includes('bash-editor.html'));
    check(!!frame && (await frame.evaluate(() => typeof window.soundboard.bashes.get === 'function')), 'the bash editor opens as a layer with its own API');
    // A clip squashed by its right edge (faster), with an effect at half intensity.
    await frame.click('.lib-row button');
    await frame.waitForTimeout(800);
    await frame.$eval('#zoom', (el) => { el.value = '15'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    const before = await frame.$eval('.clip', (el) => el.getBoundingClientRect().width);
    const handle = await frame.$eval('.clip-stretch', (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    const box = await page.$eval('iframe.android-editor', (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y }; });
    await page.mouse.move(box.x + handle.x, box.y + handle.y);
    await page.mouse.down();
    await page.mouse.move(box.x + handle.x - before / 4, box.y + handle.y, { steps: 6 });
    await page.mouse.up();
    await frame.waitForTimeout(200);
    const speed = Number(await frame.inputValue('#clip-speed'));
    check(speed > 1.2 && speed < 1.45, `dragging the right edge in makes the clip faster (×${speed})`);
    check(await frame.isVisible('.clip-tag'), 'the clip shows its speed');
    await frame.selectOption('#clip-fx', 'fairy');
    await frame.$eval('#clip-fx-amount', (el) => { el.value = '0.5'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
    await shot('5b-bash-clip-fx');
    await frame.click('#save-btn');
    await page.waitForTimeout(600);
    const savedBash = JSON.parse(fs.readFileSync(path.join(native.root, 'sounds/bashes.json'), 'utf8')).pop();
    const savedClip = savedBash && savedBash.clips[0];
    check(savedClip && savedClip.speed === speed && savedClip.fx === 'fairy' && savedClip.fxAmount === 0.5, `the clip's speed and effect are saved (${JSON.stringify(savedClip)})`);
    await page.click('#bash-new');
    await page.waitForSelector('iframe.android-editor', { timeout: 5000 });
    await page.waitForTimeout(800);
    await page.evaluate(() => window.DRBack());
    await page.waitForTimeout(400);
    check(!(await page.$('iframe.android-editor')), 'Back closes the editor');

    // Dice.
    await page.click('#dice-btn');
    await page.waitForTimeout(1500);
    await shot('6-dice');
    check(await page.isVisible('#dice-roll, .dice-type'), 'the dice tray opens');
    check(await page.evaluate(() => window.DRBack()) && !(await page.evaluate(() => window.DiceTray.isOpen())), 'Back closes the dice tray');
    check(await page.evaluate(() => window.DRBack()) === false, 'Back with nothing open leaves it to Android');

    // A headless browser has no sound card.
    const errs = errors.filter((e) => !/favicon|AudioContext encountered an error/i.test(e));
    check(errs.length === 0, `no errors ${errs.slice(0, 5).join(' | ')}`);
  } catch (e) {
    check(false, e.stack.split('\n').slice(0, 3).join(' '));
    await shot('fail');
  }
  await browser.close();
  await native.close();
  fs.writeFileSync(path.join(shots, 'log.txt'), log.join('\n'));
  process.exit(log.some((l) => l.startsWith('FAIL')) ? 1 : 0);
})();
