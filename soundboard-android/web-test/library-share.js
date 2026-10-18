// Sharing a whole library on the Android app's web screens: Export Library
// on one phone, Import Library on another, a library from the Mac, and the
// free version's limits.
//   node web-test/library-share.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const { startFakeNative } = require('./fake-native');
const mac = path.resolve(__dirname, '../../soundboard-mac/src');
const { Library } = require(path.join(mac, 'library'));
const { BashStore } = require(path.join(mac, 'bashes'));
const { KitStore } = require(path.join(mac, 'kits'));
const Share = require(path.join(mac, 'library-share'));
const { openZip } = require(path.join(mac, 'zip'));

const android = path.resolve(__dirname, '..');
const assets = fs.mkdtempSync(path.join(os.tmpdir(), 'android-assets-'));
execFileSync('node', [path.join(android, 'scripts/assemble-web.js'), assets]);
const amb = (f) => path.join(assets, 'ambience', f);
let failures = 0;
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failures++; };

async function phone(browser) {
  const native = await startFakeNative({ webDir: path.join(assets, 'web'), ambienceDir: path.join(assets, 'ambience') });
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(native.initScript);
  await page.goto(native.url);
  await page.waitForTimeout(800);
  return { native, page, errors };
}
const openOptions = (page) => page.evaluate(() => document.getElementById('options-dialog').showModal());
const status = (page) => page.textContent('#share-status');
const waitStatus = async (page, re) => {
  for (let i = 0; i < 50; i++) { if (re.test(await status(page))) return status(page); await page.waitForTimeout(100); }
  return status(page);
};

(async () => {
  const browser = await chromium.launch();
  const a = await phone(browser);
  const b = await phone(browser);
  try {
    // Phone A: a small library with a bash and a kit.
    a.native.setPremium(true);
    a.native.pick([{ path: amb('campfire.wav'), name: 'Campfire.wav' }, { path: amb('rain.wav'), name: 'Rain.wav' }]);
    await a.page.click('#add-menu-btn'); await a.page.click('#add-btn');
    await a.page.waitForTimeout(800);
    if (await a.page.isVisible('dialog[open] button:has-text("Skip")')) await a.page.click('dialog[open] button:has-text("Skip")');
    await a.page.evaluate(async () => {
      const list = await window.soundboard.list();
      await window.soundboard.update(list[0].id, { tags: ['cozy'], volume: 0.5 });
      const bash = await window.soundboard.bashes.create({ name: 'Storm Night', soundIds: list.map((s) => s.id) });
      const kit = await window.soundboard.kits.create({ name: 'The Inn' });
      await window.soundboard.kits.addItems(kit.id, [...list.map((s) => ({ type: 'sound', id: s.id })), { type: 'bash', id: bash.id }]);
    });
    await openOptions(a.page);
    await a.page.click('#share-export');
    const exported = await waitStatus(a.page, /^Saved/);
    check(/^Saved Dungeon Radio Library\.zip \(.+\): 2 sounds, 1 bash and 1 scene kit\.$/.test(exported), `export says what it saved (${exported})`);
    check(a.native.saved.length === 1, 'the zip went to "Save as…"');
    const zip = openZip(a.native.saved[0].path);
    check(zip.names[0] === Share.MANIFEST && zip.names.filter((n) => n.startsWith('sounds/')).length === 2, 'the zip holds the list and both sounds');
    zip.close();

    // Phone B (free): imports it.
    b.native.pick([{ path: a.native.saved[0].path, name: 'Dungeon Radio Library.zip' }]);
    await openOptions(b.page);
    await b.page.click('#share-import');
    const imported = await waitStatus(b.page, /^Added|already/);
    check(imported === 'Added 2 sounds, 1 bash and 1 scene kit.', `import says what it added (${imported})`);
    const got = await b.page.evaluate(async () => ({
      sounds: (await window.soundboard.list()).map((s) => `${s.name}:${s.tags.join(',')}:${s.volume}`).sort(),
      bashes: (await window.soundboard.bashes.list()).map((x) => `${x.name}:${x.clips.length}`),
      kits: (await window.soundboard.kits.list()).kits.map((k) => `${k.name}:${k.sections.reduce((n, s) => n + s.items.length, 0)}`),
    }));
    check(JSON.stringify(got.sounds) === JSON.stringify(['Campfire:cozy:0.5', 'Rain::1']), `sounds came with their settings (${got.sounds})`);
    check(got.bashes[0] === 'Storm Night:2' && got.kits[0] === 'The Inn:3', `the bash and kit point at the new sounds (${got.bashes}, ${got.kits})`);
    check(await b.page.isVisible('.kit-btn:has-text("The Inn")'), 'the kit shows in the sidebar straight away');

    // The same file again: nothing new.
    b.native.pick([{ path: a.native.saved[0].path, name: 'again.zip' }]);
    await b.page.click('#share-import');
    const again = await waitStatus(b.page, /already/);
    check(/^Everything in that file is already in your library\.$/.test(again), `importing twice adds nothing (${again})`);

    // A library made on the Mac.
    const macDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-lib-'));
    const macStores = { library: new Library(macDir), bashes: new BashStore(macDir), kits: new KitStore(macDir) };
    macStores.library.add({ name: 'Thunder', data: fs.readFileSync(amb('thunderstorm.wav')), ext: 'wav', kind: 'clip', duration: 3 });
    const macZip = path.join(macDir, 'mac.zip');
    Share.exportToZip(macZip, macStores, 'Mac');
    b.native.pick([{ path: macZip, name: 'mac.zip' }]);
    await b.page.click('#share-import');
    check(await waitStatus(b.page, /^Added 1 sound\.$/) === 'Added 1 sound.', 'a library from the Mac imports');

    // Free version: a library with more clips than it allows opens Premium and adds nothing.
    for (let i = 0; i < 10; i++) macStores.library.add({ name: `Clip ${i}`, data: Buffer.from(`RIFF${i}`.repeat(20 + i)), ext: 'wav', kind: 'clip', duration: 1 });
    Share.exportToZip(macZip, macStores, 'Mac');
    const before = await b.page.evaluate(async () => (await window.soundboard.list()).length);
    b.native.pick([{ path: macZip, name: 'mac.zip' }]);
    await b.page.click('#share-import');
    await b.page.waitForTimeout(800);
    check(await b.page.isVisible('#premium-dialog[open]'), 'too many for the free version: the Premium screen opens');
    check(await b.page.evaluate(async () => (await window.soundboard.list()).length) === before, 'and nothing was added');
    check(/free version holds up to 10 clips/.test(await status(b.page)), 'the status says why');

    // Not a library.
    const notLib = path.join(macDir, 'photo.zip');
    require(path.join(mac, 'zip')).writeZip(notLib, [{ name: 'a.txt', data: Buffer.from('hi') }]);
    if (await b.page.isVisible('#premium-dialog[open]')) await b.page.click('#premium-dialog button:has-text("Not now")');
    b.native.pick([{ path: notLib, name: 'photo.zip' }]);
    await openOptions(b.page);
    await b.page.click('#share-import');
    const refused = await waitStatus(b.page, /isn’t|Added|Couldn/);
    check(/isn’t a Dungeon Radio library/.test(refused), 'a zip that isn\'t a library is refused');

    await b.page.screenshot({ path: path.join(os.tmpdir(), 'share-options.png') });
    check(!a.errors.length && !b.errors.length, `no page errors ${[...a.errors, ...b.errors].join(' | ')}`);
  } catch (err) {
    check(false, err.stack);
  } finally {
    await browser.close();
    await a.native.close(); await b.native.close();
  }
  console.log(failures ? `${failures} failed` : 'All passed');
  process.exit(failures ? 1 : 0);
})();
