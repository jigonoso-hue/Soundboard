// Every screen of the Android app's web layer at phone size, with checks for
// things running off the screen, text cut off, controls on top of each other
// and small touch targets.   node web-test/phone-tour.js [shotsDir] [width] [height]
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const { startFakeNative } = require('./fake-native');

const android = path.resolve(__dirname, '..');
const shots = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'android-tour-'));
const width = Number(process.argv[3]) || 390;
const height = Number(process.argv[4]) || 844;
fs.mkdirSync(shots, { recursive: true });
const assets = fs.mkdtempSync(path.join(os.tmpdir(), 'android-assets-'));
execFileSync('node', [path.join(android, 'scripts/assemble-web.js'), assets]);
const issues = [];

async function audit(page, label, scope = null) {
  const found = await page.evaluate((scope) => {
    const out = [];
    const root = scope ? document.querySelector(scope) : document.body;
    if (!root) return out;
    const visible = (n) => {
      const r = n.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      for (let e = n; e; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
      }
      return true;
    };
    const clipped = (n) => {
      for (let e = n.parentElement; e && e !== document.body; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (/(auto|scroll|hidden|clip)/.test(s.overflowX + s.overflowY + s.overflow)) return true;
      }
      return false;
    };
    const name = (n) => `${n.tagName.toLowerCase()}${n.id ? `#${n.id}` : ''}${typeof n.className === 'string' && n.className ? `.${n.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''} "${(n.textContent || n.value || n.getAttribute('aria-label') || '').trim().slice(0, 24)}"`;
    if (document.documentElement.scrollWidth > innerWidth + 1) out.push(`page scrolls sideways (${document.documentElement.scrollWidth})`);
    // The drawer is only on screen while it's open.
    const shut = (n) => !document.documentElement.classList.contains('drawer-open') && n.closest('#sidebar');
    const controls = [...root.querySelectorAll('button, select, input:not([type=hidden]):not([type=file]), .dice-pill')].filter((n) => visible(n) && !shut(n));
    for (const n of controls) {
      const r = n.getBoundingClientRect();
      if ((r.right > innerWidth + 1 || r.left < -1) && !clipped(n)) out.push(`off screen: ${name(n)} [${Math.round(r.left)}..${Math.round(r.right)}]`);
      // (A dice button's count badge sits over its corner on purpose.)
      if (n.tagName === 'BUTTON' && n.scrollWidth > n.clientWidth + 2 && getComputedStyle(n).textOverflow !== 'ellipsis' && !n.matches('.dice-type')) out.push(`text cut off: ${name(n)}`);
      if (n.tagName === 'BUTTON' && (r.height < 32 || r.width < 32) && !n.closest('.tag-chip, .chip')) out.push(`small target ${Math.round(r.width)}x${Math.round(r.height)}: ${name(n)}`);
    }
    const buttons = controls.filter((n) => n.tagName === 'BUTTON');
    for (let i = 0; i < buttons.length; i++) for (let j = i + 1; j < buttons.length; j++) {
      const a = buttons[i]; const b = buttons[j];
      if (a.contains(b) || b.contains(a)) continue;
      // The top bar and full-screen panels cover what scrolls under them.
      const layer = (n) => n.closest('.titlebar, #kit-drawer');
      if (layer(a) !== layer(b)) continue;
      const ra = a.getBoundingClientRect(); const rb = b.getBoundingClientRect();
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w > 3 && h > 3) {
        const hit = document.elementFromPoint(Math.max(ra.left, rb.left) + w / 2, Math.max(ra.top, rb.top) + h / 2);
        if (hit && (a.contains(hit) || b.contains(hit))) out.push(`overlap: ${name(a)} / ${name(b)}`);
      }
    }
    return out;
  }, scope);
  for (const f of found) issues.push(`${label}: ${f}`);
}

(async () => {
  const native = await startFakeNative({ webDir: path.join(assets, 'web'), ambienceDir: path.join(assets, 'ambience') });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(native.initScript);
  const shot = async (name, scope) => { await page.screenshot({ path: path.join(shots, `${name}.png`) }); await audit(page, name, scope); };
  const step = async (name, fn) => { try { await fn(); } catch (e) { issues.push(`${name}: ERROR ${e.message.split('\n').slice(0, 12).join(' | ')}`); await page.keyboard.press('Escape').catch(() => {}); } };
  try {
    await page.goto(native.url);
    await page.waitForTimeout(1000);
    // A small library: two clips and a full sound.
    native.pick([
      { path: path.join(assets, 'ambience/rain.wav'), name: 'Sword Clash.wav' },
      { path: path.join(assets, 'ambience/campfire.wav'), name: 'Dragon Roar.wav' },
      { path: path.join(assets, 'ambience/thunderstorm.wav'), name: 'Tavern Song.wav' },
    ]);
    await page.click('#add-btn');
    await page.waitForTimeout(1000);
    await page.keyboard.press('Escape');
    await page.evaluate(async () => {
      const list = await window.soundboard.list();
      const song = list.find((s) => s.name === 'Tavern Song');
      await window.soundboard.update(song.id, { kind: 'full' });
      const bash = await window.soundboard.bashes.create({ name: 'Ambush!', soundIds: list.slice(0, 2).map((s) => s.id) });
      const kit = await window.soundboard.kits.create({ name: 'Tavern Brawl' });
      await window.soundboard.kits.addItems(kit.id, [...list.map((s) => ({ type: 'sound', id: s.id })), { type: 'bash', id: bash.id }]);
    });
    await page.reload();
    await page.waitForTimeout(1000);
    await step('library', () => shot('01-library'));
    await step('drawer', async () => { await page.click('#android-menu'); await page.waitForTimeout(300); await shot('02-drawer', '#sidebar'); await page.evaluate(() => window.DRBack()); });

    // A scene kit with its sections filled.
    await step('kit', async () => {
      await page.click('#android-menu');
      await page.click('.kit-btn:has(.kit-name:text-is("Tavern Brawl"))');
      await page.waitForTimeout(600);
      await shot('03-kit');
      await page.evaluate(() => document.querySelector('#content, .content')?.scrollTo(0, 99999));
      await page.waitForTimeout(300);
      await shot('04-kit-scrolled');
    });
    await step('section menu', async () => { await page.click('.kit-section .section-more >> nth=0'); await page.waitForTimeout(300); await shot('05-section-menu', '#section-menu'); await page.keyboard.press('Escape'); await page.mouse.click(5, 400); });
    await step('kit drawer', async () => { await page.click('.kit-section .section-add >> nth=0'); await page.waitForTimeout(400); await shot('06-kit-library'); await page.evaluate(() => window.DRBack()); await page.click('#drawer-close').catch(() => {}); });
    await step('edit sound', async () => {
      await page.evaluate(() => document.querySelector('.view-btn[data-view="all"]').click());
      await page.waitForTimeout(300);
      await page.click('.tile:visible >> nth=0', { button: 'right', timeout: 5000 });
      await page.waitForTimeout(400);
      await shot('07-edit-sound', '#edit-dialog');
      await page.keyboard.press('Escape');
    });
    await step('record', async () => { await page.click('#record-btn'); await page.waitForTimeout(400); await shot('08-record', '#record-dialog'); await page.keyboard.press('Escape'); });
    await step('options', async () => { await page.click('#android-menu'); await page.click('#options-btn'); await page.waitForTimeout(400); await shot('09-options', '#options-dialog'); await page.keyboard.press('Escape'); });
    await step('live', async () => {
      await page.click('#live-btn');
      await page.waitForTimeout(400);
      await shot('10-live-broadcast', '#live-dialog');
      await page.click('.live-tabs >> text=Tune In');
      await page.waitForTimeout(300);
      await shot('11-live-tune-in', '#live-dialog');
      await page.keyboard.press('Escape');
    });
    await step('bash editor', async () => {
      await page.evaluate(() => document.querySelector('.view-btn[data-view="all"]').click());
      await page.waitForTimeout(300);
      await page.dblclick('.bash-card:visible >> nth=0', { timeout: 5000 });
      await page.waitForSelector('iframe.android-editor');
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(shots, '12-bash-editor.png') });
      const frame = page.frames().find((f) => f.url().includes('bash-editor.html'));
      const found = await frame.evaluate(() => ({ wide: document.documentElement.scrollWidth, w: innerWidth }));
      if (found.wide > found.w + 1) issues.push(`12-bash-editor: page scrolls sideways (${found.wide})`);
      await page.evaluate(() => window.DRBack());
    });
    await step('ambience open', async () => {
      await page.evaluate(() => document.querySelector('#content, .content')?.scrollTo(0, 0));
      await shot('13-ambience');
    });
    await step('dice', async () => { await page.click('#dice-btn'); await page.waitForTimeout(1200); await shot('14-dice', '#dice-layer'); await page.click('.dice-pill:has-text("Close")'); });
  } catch (e) {
    issues.push(`ERROR ${e.message}`);
  }
  for (const e of errors) issues.push(`page error: ${e}`);
  await browser.close();
  await native.close();
  fs.writeFileSync(path.join(shots, 'issues.txt'), issues.join('\n'));
  console.log(issues.length ? issues.join('\n') : 'No issues');
})();
