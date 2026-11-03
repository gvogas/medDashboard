// The browser suite: the whole app in a real browser against the local Worker with the fake AI
// (`npm run dev:fake-ai`), through the paths a person takes. `npm run e2e`.
//
// It applies the local migrations, makes a throwaway admin account (e2e-<time>), starts the dev
// server on its own port (or uses E2E_URL when one is already running), and runs each scenario in
// order on one page: Study Buddy (gameplay, a timed session, ranks, the shop, a custom buddy,
// naming), flashcards (a deck, cards, the Week chip, review by keyboard) and AI cards (Generate
// here and Use your own AI). Any page error fails the run. Screenshots go to e2e/out/.
//
// Needs Playwright with Chromium: `npm i -D playwright && npx playwright install chromium` on a
// machine without them (the cloud sessions have both).

import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = fileURLToPath(new URL('./out/', import.meta.url));
mkdirSync(out, { recursive: true });

let chromium;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch {
  console.error('Playwright is missing: npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}

const PORT = Number(process.env.E2E_PORT || 8790);
const BASE = process.env.E2E_URL || `http://127.0.0.1:${PORT}`;
const USER = 'e2e-' + Date.now().toString(36), PASSWORD = 'e2e-password-' + Math.random().toString(36).slice(2, 10);
const wrangler = (args) => spawnSync(process.execPath, [fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url)), ...args], { cwd: root, encoding: 'utf8' });

function setUp() {
  const m = wrangler(['d1', 'migrations', 'apply', 'DB', '--config', 'wrangler.jsonc', '--local']);
  if (m.status !== 0) throw new Error('migrations: ' + (m.stderr || m.stdout).slice(-500));
  for (const extra of [[], ['--admin']]) {
    const r = spawnSync(process.execPath, ['scripts/add-user.mjs', USER, ...extra], { cwd: root, input: `${PASSWORD}\n${PASSWORD}\n`, encoding: 'utf8' });
    if (r.status !== 0) throw new Error('user: ' + (r.stderr || r.stdout));
  }
}

async function startServer() {
  if (process.env.E2E_URL) return null;
  const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
  const server = spawn(process.execPath, [vite, '--mode', 'fake-ai', '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  server.stdout.on('data', (d) => { log += d; });
  server.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 90; i++) {
    try { if ((await fetch(BASE)).ok) return server; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  server.kill();
  throw new Error('the dev server did not start:\n' + log.slice(-2000));
}

/* known noise in dev only: the session check before sign-in, and React's dev warning about lib/lazy.ts */
const NOISE = [/401 \(Unauthorized\)/, /called use\(\) to suspend/];

const scenarios = [];
const scenario = (name, fn) => scenarios.push({ name, fn });
const expect = (ok, what) => { if (!ok) throw new Error(what); };

scenario('signs in', async (p) => {
  await p.goto(BASE + '/');
  await p.fill('#loginUser', USER); await p.fill('#loginPass', PASSWORD);
  await p.click('button:has-text("Sign in")');
  await p.getByRole('button', { name: 'Study', exact: true }).first().waitFor({ timeout: 20_000 });
  /* the setup appears after the first full sync, so wait for it a little rather than check once */
  const skip = p.getByRole('button', { name: 'Skip setup' });
  await skip.first().waitFor({ timeout: 10_000 }).catch(() => {});
  if (await skip.count()) await skip.first().click();
});

scenario('turns gameplay on in Settings, and the Buddy page opens on 6', async (p) => {
  await p.getByRole('button', { name: /Settings/ }).first().click();
  await p.getByRole('dialog').getByRole('button', { name: 'Study', exact: true }).click();
  /* the box shows the Worker's answer, so it ticks once the server says gameplay is on */
  const box = p.getByRole('checkbox', { name: 'Raise a study buddy' });
  await p.waitForFunction(() => !document.querySelector('input[type=checkbox]:disabled'), null, { timeout: 10_000 }).catch(() => {});
  await box.click();
  await p.getByText('Your buddy has hatched.').waitFor();
  expect(await box.isChecked(), 'gameplay is not on');
  await p.keyboard.press('Escape');
  await p.keyboard.press('6');
  await p.getByRole('region', { name: 'Your buddy' }).waitFor();
});

scenario('pays a timed session and grows with granted XP', async (p) => {
  const start = Date.now() - 3 * 3_600_000;
  /* gameplay counts from when it was turned on: this session is from before, so move the start back like the Worker tests do */
  wrangler(['d1', 'execute', 'DB', '--local', '--config', 'wrangler.jsonc', '--command',
    `UPDATE buddy_settings SET since = ${start - 60_000}, on_at = ${start - 60_000}, reconciled_at = ${start - 60_000} WHERE user_id = (SELECT id FROM users WHERE username = '${USER}')`]);
  const put = await p.evaluate(async (t) => (await fetch('/api/study_sessions/e2e1', { method: 'PUT', headers: { 'content-type': 'application/json', 'if-match': '"0"' }, body: JSON.stringify({ startedAt: t, studyMinutes: 60, manual: false }) })).status, start);
  expect(put === 200, 'session save ' + put);
  const me = await p.evaluate(async () => (await (await fetch('/api/me')).json()).id);
  const grant = await p.evaluate(async (id) => (await fetch('/api/admin/buddy/grant', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: id, xp: 400, coins: 600 }) })).status, me);
  expect(grant === 204, 'grant ' + grant);
  const b = await p.evaluate(async () => (await fetch('/api/buddy')).json());
  expect(b.xp === 460 && b.tier === 'r3', `xp ${b.xp} tier ${b.tier}`);
  expect(b.coins === 600 + 12 + 2, 'coins ' + b.coins);       /* the grant, 60 minutes, a streak day */
  await p.reload();
  await p.getByRole('button', { name: 'Claim 5 coins' }).click();
  await p.getByText('Claimed 5 coins').waitFor();
});

scenario('buys a background and puts it on', async (p) => {
  await p.getByRole('button', { name: 'Buy Meadow for 30 coins' }).click();
  await p.getByRole('button', { name: 'Use', exact: true }).first().click();
  await p.getByRole('button', { name: 'Take off', exact: true }).first().waitFor();
  const b = await p.evaluate(async () => (await fetch('/api/buddy')).json());
  expect(b.look.bg === 'bg-meadow', 'bg ' + b.look.bg);
});

scenario('makes a custom buddy from a picture (only the pixels go up) and names it', async (p) => {
  const png = await p.evaluate(() => {
    const c = document.createElement('canvas'); c.width = c.height = 120; const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 120, 120); g.fillStyle = '#E8913F'; g.beginPath(); g.arc(60, 66, 40, 0, Math.PI * 2); g.fill();
    return c.toDataURL('image/png').split(',')[1];
  });
  const sent = [];
  const watch = (r) => { if (r.method() === 'PUT' && r.url().includes('/api/buddy/custom')) sent.push((r.postData() || '').length); };
  p.on('request', watch);
  await p.setInputFiles('#buddy-file', { name: 'pet.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await p.getByRole('button', { name: 'Save as my buddy' }).click();
  await p.getByRole('radio', { name: 'Your own' }).waitFor();
  p.off('request', watch);
  expect(sent.length === 1 && sent[0] < 1024, 'custom upload ' + sent);
  await p.fill('#buddy-name', 'Orange');
  await p.getByRole('button', { name: 'Save', exact: true }).click();
  await p.getByRole('button', { name: /^Orange: / }).waitFor();
  await p.screenshot({ path: out + 'buddy.png', fullPage: true });
});

scenario('makes a deck and cards, shows them due on the Week view', async (p) => {
  await p.getByRole('button', { name: 'Study', exact: true }).first().click();
  await p.getByRole('tab', { name: /^Cards/ }).click();
  await p.getByLabel('Title').fill('E2E deck');
  await p.getByRole('button', { name: 'Add deck' }).click();
  await p.getByRole('button', { name: 'Edit' }).first().click();
  for (const [f, b] of [['One?', '1'], ['Two?', '2'], ['Three?', '3']]) {
    await p.locator('#front-new').fill(f); await p.locator('#back-new').fill(b);
    await p.getByRole('button', { name: 'Add card' }).click();
    await p.getByText(f).waitFor();
  }
  await p.getByRole('button', { name: 'Done' }).click();
  await p.getByRole('button', { name: 'Week', exact: true }).first().click();
  await p.getByRole('button', { name: '3 cards due' }).click();       /* the chip opens the review */
  await p.getByRole('group', { name: 'Card, press Space to flip, then 1, 2 or 3' }).waitFor();
});

scenario('reviews by keyboard: 1/2/3 never switch pages, Again comes back once', async (p) => {
  const box = p.getByRole('group', { name: 'Card, press Space to flip, then 1, 2 or 3' });
  await box.press('2');                                                   /* before the answer: nothing, and still on Study */
  expect(await box.count() === 1, 'the review left the page on 2');
  const grades = ['1', '2', '3', '2'];                                   /* Again first: 3 cards + 1 again */
  for (const g of grades) { await box.press(' '); await box.press(g); await p.waitForTimeout(150); }
  await p.getByText('All done for today').waitFor();
  await p.waitForTimeout(3500);                                           /* the sync after the reviews */
  const reviews = await p.evaluate(async () => (await (await fetch('/api/sync?v=4&cursors=')).json()).changes.filter((c) => c.kind === 'card_reviews').length);
  expect(reviews === grades.length, 'reviews saved: ' + reviews);
});

scenario('makes cards with Generate here and with your own AI', async (p) => {
  await p.getByRole('button', { name: 'Back to decks' }).click();
  await p.getByRole('button', { name: 'Make cards with AI' }).first().click();
  await p.getByLabel('Topic').fill('Beta blockers');
  await p.getByRole('button', { name: 'Generate' }).click();
  await p.getByRole('button', { name: /^Save 15 cards$/ }).click({ timeout: 20_000 });
  await p.getByRole('button', { name: 'Make cards with AI' }).first().click();
  await p.getByLabel('Topic').fill('ACE inhibitors');
  await p.getByRole('tab', { name: 'Use your own AI' }).click();
  await p.getByLabel("The chat's answer").fill('```json\n{"cards":[{"front":"Suffix?","back":"-pril"},{"front":"Side effect?","back":"Dry cough"},{"front":"","back":"x"}]}\n```');
  await p.getByRole('button', { name: 'Read the answer' }).click();
  await p.getByText('2 of 3 cards could be read.').waitFor();
  await p.getByRole('button', { name: 'Save 2 cards' }).click();
  await p.waitForTimeout(3500);
  const bySource = await p.evaluate(async () => (await (await fetch('/api/sync?v=4&cursors=')).json()).changes.filter((c) => c.kind === 'cards')
    .reduce((m, c) => ({ ...m, [c.row.source]: (m[c.row.source] || 0) + 1 }), {}));
  expect(bySource.hand === 3 && bySource.ai === 15 && bySource.paste === 2, 'cards saved ' + JSON.stringify(bySource));
  await p.screenshot({ path: out + 'cards.png', fullPage: true });
});

scenario('fits a phone: no sideways scroll on Buddy and Cards', async (p) => {
  await p.setViewportSize({ width: 390, height: 844 });
  for (const go of [() => p.keyboard.press('6'), () => p.keyboard.press('4')]) {   /* the sidebar is folded away on a phone */
    await go(); await p.waitForTimeout(600);
    const wide = await p.evaluate(() => document.documentElement.scrollWidth);
    expect(wide <= 390, 'scroll width ' + wide);
  }
});

async function main() {
  setUp();
  const server = await startServer();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !NOISE.some((n) => n.test(m.text()))) errors.push('console: ' + m.text().slice(0, 300)); });
  let failed = 0;
  try {
    for (const s of scenarios) {
      const before = errors.length, t = Date.now();
      try {
        await s.fn(page);
        if (errors.length > before) throw new Error('page errors: ' + errors.slice(before).join(' | '));
        console.log(`ok   ${s.name} (${Date.now() - t} ms)`);
      } catch (e) {
        failed++;
        console.log(`FAIL ${s.name}: ${String(e.message || e).split('\n')[0]}`);
        await page.screenshot({ path: out + 'fail-' + scenarios.indexOf(s) + '.png', fullPage: true }).catch(() => {});
        break;   /* later scenarios build on earlier ones */
      }
    }
  } finally {
    await browser.close();
    server?.kill();
    spawnSync(process.execPath, ['scripts/add-user.mjs', USER, '--delete'], { cwd: root, input: USER + '\n', encoding: 'utf8' });
  }
  console.log(failed ? `\n${failed} failed (screenshots in e2e/out/)` : `\nall ${scenarios.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
