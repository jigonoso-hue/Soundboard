// Premium on the phone apps' web screens: the free version's limits, the locked
// broadcaster features, the Premium screen, buying, and what happens after.
//   node web-test/premium.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const { startFakeNative } = require('./fake-native');

const android = path.resolve(__dirname, '..');
const assets = fs.mkdtempSync(path.join(os.tmpdir(), 'android-assets-'));
execFileSync('node', [path.join(android, 'scripts/assemble-web.js'), assets]);
const amb = (f) => path.join(assets, 'ambience', f);
let failures = 0;
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failures++; };

(async () => {
  const native = await startFakeNative({ webDir: path.join(assets, 'web'), ambienceDir: path.join(assets, 'ambience') });
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(native.initScript);
  const counts = () => page.evaluate(async () => {
    const list = await window.soundboard.list();
    return { clips: list.filter((s) => s.kind !== 'full').length, full: list.filter((s) => s.kind === 'full').length };
  });
  const paywall = () => page.isVisible('#premium-dialog[open]');
  const closePaywall = async () => { if (await paywall()) await page.click('#premium-dialog button:has-text("Not now")'); };
  const addFiles = async (files) => {
    native.pick(files);
    await page.click('#add-btn');
    await page.waitForTimeout(700);
    if (await page.isVisible('dialog[open] button:has-text("Skip")')) await page.click('dialog[open] button:has-text("Skip")');
  };

  try {
    await page.goto(native.url);
    await page.waitForTimeout(800);

    // The sidebar offers Premium.
    await page.click('#android-menu');
    check((await page.textContent('#premium-btn')).includes('Get Premium'), 'the sidebar offers Premium');
    await page.evaluate(() => window.DRBack());

    // 10 clips, then the 11th doesn't fit.
    await addFiles(Array.from({ length: 11 }, (_, i) => ({ path: amb(i % 2 ? 'rain.wav' : 'campfire.wav'), name: `Clip ${i + 1}.wav` })));
    let c = await counts();
    check(c.clips === 10 && c.full === 0, `free: 10 clips kept, the 11th refused (${c.clips} clips)`);
    check(await paywall(), 'the Premium screen opens');
    check((await page.textContent('.premium-reason')).includes('10 clips'), 'it says why: the 10-clip limit');
    check((await page.$$('.premium-product')).length === 3, 'it shows the yearly, monthly and lifetime prices');
    check((await page.textContent('.premium-product >> nth=0')).includes('$19.99 a year'), 'yearly first, with its price');
    await closePaywall();

    // Full sounds count separately: 5, then the 6th is refused.
    await addFiles(Array.from({ length: 6 }, (_, i) => ({ path: amb('thunderstorm.wav'), name: `Song ${i + 1}.wav` })));
    c = await counts();
    check(c.full === 5 && c.clips === 10, `free: 5 full sounds kept, the 6th refused (${c.full} full)`);
    await closePaywall();

    // With the library full, recording (or any add) is refused too.
    const recorded = await page.evaluate(async () => {
      try { await window.soundboard.add({ name: 'Rec', data: new Uint8Array(100), ext: 'wav' }); return 'added'; } catch (e) { return e.premiumLimit || e.message; }
    });
    check(recorded === 'clips', 'adding another sound is refused with the limit');
    await closePaywall();

    // A clip can't become a sixth full sound.
    const changed = await page.evaluate(async () => {
      const clip = (await window.soundboard.list()).find((s) => s.kind !== 'full');
      try { await window.soundboard.update(clip.id, { kind: 'full' }); return 'changed'; } catch (e) { return e.premiumLimit; }
    });
    check(changed === 'full', 'a clip can’t be switched to a sixth full sound');
    await closePaywall();

    // 5 bashes and 2 scene kits.
    const made = await page.evaluate(async () => {
      const out = { bashes: 0, kits: 0, bashLimit: null, kitLimit: null };
      for (let i = 0; i < 6; i++) {
        try { await window.soundboard.bashes.create({ name: `Bash ${i}` }); out.bashes++; } catch (e) { out.bashLimit = e.premiumLimit; }
      }
      for (let i = 0; i < 3; i++) {
        try { await window.soundboard.kits.create({ name: `Kit ${i}` }); out.kits++; } catch (e) { out.kitLimit = e.premiumLimit; }
      }
      try { await window.soundboard.kits.duplicate((await window.soundboard.kits.list()).kits[0].id); out.dup = 'made'; } catch (e) { out.dup = e.premiumLimit; }
      return out;
    });
    check(made.bashes === 5 && made.bashLimit === 'bashes', `free: 5 bashes, the 6th refused (${made.bashes})`);
    check(made.kits === 2 && made.kitLimit === 'kits' && made.dup === 'kits', `free: 2 scene kits, a 3rd (or a copy) refused (${made.kits})`);
    await closePaywall();

    // The broadcaster's Premium features.
    const locked = await page.evaluate(() => ['games', 'handouts', 'whispers', 'emphasis', 'table'].map((f) => Premium.require(f)));
    check(locked.every((v) => v === false), 'games, handouts, whispers, emphasis and roll requests are locked');
    check((await page.textContent('.premium-reason')).includes('part of Premium'), 'the Premium screen says what’s locked');
    await closePaywall();
    const lockCard = await page.evaluate(() => { const box = document.createElement('div'); Premium.gate('table', () => box.append('panel'))(box); return box.textContent; });
    check(lockCard.includes('Premium') && !lockCard.includes('panel'), 'the roll-request panels show a lock card');
    // Free: dice and broadcasting.
    await page.click('#dice-btn');
    await page.waitForTimeout(800);
    check(await page.isVisible('#dice-roll'), 'dice stay free');
    await page.evaluate(() => window.DRBack());

    // Buying.
    await page.evaluate(() => Premium.open());
    await page.waitForTimeout(300);
    await page.click('.premium-product >> nth=0');
    await page.waitForTimeout(500);
    check(await page.evaluate(() => Premium.on()), 'buying unlocks Premium');
    check((await page.textContent('#premium-dialog h2')).includes('Premium is on'), 'the Premium screen says it’s on');
    await page.click('#premium-dialog button:has-text("Done")');
    check((await page.textContent('#premium-btn')).trim() === '⭐ Premium', 'the sidebar shows Premium');
    await addFiles([{ path: amb('rain.wav'), name: 'Clip 11.wav' }, { path: amb('thunderstorm.wav'), name: 'Song 6.wav' }]);
    c = await counts();
    check(c.clips === 11 && c.full === 6, `Premium: no limits (${c.clips} clips, ${c.full} full)`);
    check(await page.evaluate(async () => { await window.soundboard.bashes.create({ name: 'Bash 6' }); await window.soundboard.kits.create({ name: 'Kit 3' }); return true; }).catch(() => false), 'Premium: a 6th bash and a 3rd kit');
    check(await page.evaluate(() => ['games', 'handouts', 'whispers', 'emphasis', 'table'].every((f) => Premium.require(f))), 'Premium: every broadcaster feature opens');
    check(!(await paywall()), 'no Premium screen once unlocked');

    // Premium ends (a lapsed subscription): nothing is taken away, only adding more is blocked.
    await page.evaluate(() => window.soundboard.premium.testUnlock(false));
    await page.reload();
    await page.waitForTimeout(800);
    c = await counts();
    check(c.clips === 11 && c.full === 6, 'after Premium ends, everything made stays');
    check((await page.evaluate(async () => (await window.soundboard.bashes.list()).length)) === 6, 'and every bash stays');
    const after = await page.evaluate(async () => { try { await window.soundboard.bashes.create({ name: 'x' }); return 'made'; } catch (e) { return e.premiumLimit; } });
    check(after === 'bashes', 'but adding more past the limits is blocked again');

    const errs = errors.filter((e) => !/AudioContext encountered an error/.test(e));
    check(errs.length === 0, `no page errors ${errs.slice(0, 3).join(' | ')}`);
  } catch (e) {
    check(false, e.message.split('\n').slice(0, 4).join(' | '));
  }
  await browser.close();
  await native.close();
  console.log(failures ? `${failures} failed` : 'All passed');
  process.exit(failures ? 1 : 0);
})();
