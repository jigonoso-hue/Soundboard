// Bash editor: trimming a clip by its edges, cutting at the playhead, and the
// bash's own length; then what the player schedules (where each play starts in
// its sound and when it stops), as a Live Session host would send it.
//   node web-test/bash-trim.js [shotsDir]
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const { startFakeNative } = require('./fake-native');

const android = path.resolve(__dirname, '..');
const shots = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'bash-trim-'));
const assets = fs.mkdtempSync(path.join(os.tmpdir(), 'android-assets-'));
execFileSync('node', [path.join(android, 'scripts/assemble-web.js'), assets]);
const log = [];
const check = (ok, msg) => { log.push(`${ok ? 'PASS' : 'FAIL'} ${msg}`); console.log(log[log.length - 1]); };
const near = (a, b, e = 0.06) => Math.abs(a - b) <= e;

(async () => {
  const native = await startFakeNative({ webDir: path.join(assets, 'web'), ambienceDir: path.join(assets, 'ambience') });
  const browser = await chromium.launch();
  // Desktop size: the Mac's editor window.
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(native.initScript);
  const shot = (name) => page.screenshot({ path: path.join(shots, `${name}.png`) });
  try {
    await page.goto(native.url);
    await page.waitForTimeout(800);
    await page.evaluate(() => window.soundboard.premium.testUnlock(true));
    native.pick([{ path: path.join(assets, 'ambience/rain.wav'), name: 'Rain.wav' }, { path: path.join(assets, 'ambience/campfire.wav'), name: 'Fire.wav' }]);
    await page.click('#add-menu-btn'); await page.click('#add-btn'); await page.waitForTimeout(1000);
    if (await page.isVisible('dialog[open] button:has-text("Skip")')) await page.click('dialog[open] button:has-text("Skip")');
    await page.evaluate(() => { document.querySelector('.view-btn[data-view="bashes"]')?.click(); });
    await page.waitForTimeout(300);
    await page.click('#bash-new');
    await page.waitForSelector('iframe.android-editor');
    await page.waitForTimeout(1200);
    const frame = page.frames().find((f) => f.url().includes('bash-editor.html'));
    const box = await page.$eval('iframe.android-editor', (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y }; });
    await frame.click('.lib-row:nth-child(1) button');
    await frame.waitForTimeout(800);
    await frame.$eval('#zoom', (el) => { el.value = '40'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await frame.waitForTimeout(300);
    const clip = () => frame.evaluate(() => JSON.parse(JSON.stringify(window.__bash().clips)));
    await frame.evaluate(() => { window.__bash = () => bash; });
    const soundLen = await frame.evaluate(() => soundLength(bash.clips[0]));
    check(soundLen > 5, `a sound on the timeline (${soundLen.toFixed(2)} s)`);
    check(await frame.isVisible('.clip-edge.left') && await frame.isVisible('.clip-edge.right'), 'a clip has trim handles at both edges');

    async function drag(selector, index, dx) {
      const h = await frame.$$eval(selector, (els, i) => { const r = els[i].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, index);
      await page.mouse.move(box.x + h.x, box.y + h.y);
      await page.mouse.down();
      await page.mouse.move(box.x + h.x + dx / 2, box.y + h.y, { steps: 4 });
      await page.mouse.move(box.x + h.x + dx, box.y + h.y, { steps: 4 });
      await page.mouse.up();
      await frame.waitForTimeout(200);
    }
    // Right edge in by 4 s (40 px a second); left edge in by 2 s.
    await drag('.clip-edge.right', 0, -160);
    let c = (await clip())[0];
    check(near(c.trimEnd, soundLen - 4, 0.15) && !c.trimStart, `the right edge trims the end (to ${c.trimEnd} s)`);
    await drag('.clip-edge.left', 0, 80);
    c = (await clip())[0];
    check(near(c.trimStart, 2, 0.1) && near(c.offset, c.trimStart, 0.01), `the left edge trims the start and the rest stays put (from ${c.trimStart} s, at ${c.offset} s)`);
    check(await frame.inputValue('#clip-trim-start') !== '0:00.0', 'the inspector shows the trim');

    // Cut at 5 s.
    await frame.evaluate(() => { cursor = 5; positionPlayhead(); });
    await frame.click('#cut-btn');
    await frame.waitForTimeout(200);
    const halves = await clip();
    check(halves.length === 2 && near(halves[0].trimEnd, 5, 0.01) && near(halves[1].offset, 5, 0.01) && near(halves[1].trimStart, 5, 0.01)
      && near(halves[1].trimEnd, soundLen - 4, 0.15), `Cut splits it at the playhead (${JSON.stringify(halves.map((h) => [h.offset, h.trimStart, h.trimEnd]))})`);
    await shot('1-trimmed-and-cut');

    // The bash's length: typed, then by the end marker.
    await frame.fill('#bash-length', '7.5');
    await frame.press('#bash-length', 'Enter');
    await frame.waitForTimeout(200);
    check(await frame.evaluate(() => bash.length) === 7.5 && await frame.isVisible('.bash-end-flag'), 'Bash length sets where it ends, shown on the timeline');
    check((await frame.textContent('#time')).includes('/ 0:07.5'), `the time shows the length (${await frame.textContent('#time')})`);
    await drag('.bash-end-flag', 0, 40);
    check(near(await frame.evaluate(() => bash.length), 8.5, 0.11), `dragging the end marker changes it (${await frame.evaluate(() => bash.length)})`);
    await shot('2-length');

    // What plays: each half from its own part of the sound, stopping where it should.
    const plays = await frame.evaluate(async () => {
      const got = [];
      player.onSchedule = (p) => got.push({ from: p.from, dur: p.dur, stops: p.stopAt ? (p.stopAt - p.at) / 1000 : null });
      await player.play(bash, sounds, 0);
      const state = player.state();
      // Plays are scheduled a second ahead: wait until the second half's turn.
      await new Promise((resolve) => setTimeout(resolve, 4300));
      player.stop();
      player.onSchedule = null;
      return { got, duration: state.duration };
    });
    const [a, b] = plays.got;
    check(plays.got.length === 2 && near(a.from, 2, 0.11) && near(a.stops, 3, 0.11), `the first half plays 2 s → 5 s of the sound (${JSON.stringify(a)})`);
    check(near(b.from, 5, 0.01) && near(b.stops, 3.5, 0.11), `the second half starts at 5 s into the sound and is cut at the bash's end (${JSON.stringify(b)})`);
    check(near(plays.duration, 8.5, 0.11), `the bash lasts its length (${plays.duration})`);

    // Auto again, and save.
    await frame.click('#length-auto');
    check(await frame.evaluate(() => bash.length) === undefined && !(await frame.$('.bash-end-flag')), 'Auto takes the length off');
    await frame.fill('#bash-length', '0:09');
    await frame.press('#bash-length', 'Enter');
    await frame.click('#save-btn');
    await page.waitForTimeout(600);
    const saved = JSON.parse(fs.readFileSync(path.join(native.root, 'sounds/bashes.json'), 'utf8')).pop();
    check(saved.length === 9 && saved.clips.length === 2 && saved.clips[1].trimStart === 5, `saved with its trims and length (${JSON.stringify({ length: saved.length, clips: saved.clips.map((x) => [x.trimStart, x.trimEnd]) })})`);
    check(errors.length === 0, `no errors ${errors.slice(0, 3).join(' | ')}`);
  } catch (e) {
    check(false, e.stack.split('\n').slice(0, 3).join(' '));
    await shot('fail');
  }
  await browser.close();
  await native.close();
  process.exit(log.some((l) => l.startsWith('FAIL')) ? 1 : 0);
})();
