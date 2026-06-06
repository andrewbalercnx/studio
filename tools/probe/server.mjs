/**
 * Constrained usability-probe driver (POC).
 *
 * Exposes a deliberately NARROW surface so a "naive user" agent perceives the app the way a person
 * does — by visible/accessible affordances — and never via DOM source or test-ids:
 *   GET  /snapshot            -> { url, title, ax (accessibility outline), screenshot (png path) }
 *   POST /act { action, ... } -> performs an action, returns a fresh snapshot
 *       actions: goto(base only) | click{name,role?} | fill{name,text} | press{key}
 *
 * This guards the validity of the probe: missing/ambiguous accessible labels become real obstacles,
 * exactly as for a human. Run:  BASE_URL=https://storypic.rcnx.io node tools/probe/server.mjs
 */
import { chromium } from 'playwright';
import http from 'node:http';
import { mkdirSync } from 'node:fs';

const BASE_URL = process.env.BASE_URL || 'https://storypic.rcnx.io';
const PORT = Number(process.env.PROBE_PORT || 8787);
const SHOT_DIR = '/tmp/probe';
mkdirSync(SHOT_DIR, { recursive: true });

let shotN = 0;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});

async function snapshot() {
  await page.waitForTimeout(400); // let transitions settle
  // ariaSnapshot() yields a YAML accessibility outline (roles + accessible names) — what a user
  // perceives, not DOM source. This is the agent's only structural view of the page.
  let ax = '';
  try {
    ax = await page.locator('body').ariaSnapshot();
  } catch (e) {
    ax = `(no accessibility tree: ${e.message?.split('\n')[0]})`;
  }
  const screenshot = `${SHOT_DIR}/shot-${String(++shotN).padStart(3, '0')}.png`;
  await page.screenshot({ path: screenshot, fullPage: false }).catch(() => {});
  return {
    url: page.url(),
    title: await page.title().catch(() => ''),
    ax: ax.slice(0, 10000),
    screenshot,
  };
}

async function act(body) {
  const { action } = body;
  try {
    if (action === 'goto') {
      const url = String(body.url || BASE_URL);
      if (!url.startsWith(BASE_URL)) return { error: 'goto is only allowed to the app base URL; navigate by clicking instead' };
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    } else if (action === 'click') {
      const name = String(body.name || '');
      const role = body.role;
      let loc;
      if (role) loc = page.getByRole(role, { name, exact: false });
      else loc = page.getByRole('button', { name, exact: false }).or(page.getByRole('link', { name, exact: false }));
      if ((await loc.count()) === 0) loc = page.getByText(name, { exact: false });
      await loc.first().click({ timeout: 5000 });
    } else if (action === 'fill') {
      const name = String(body.name || '');
      let loc = page.getByLabel(name, { exact: false });
      if ((await loc.count()) === 0) loc = page.getByRole('textbox', { name, exact: false });
      if ((await loc.count()) === 0) loc = page.getByPlaceholder(name, { exact: false });
      await loc.first().fill(String(body.text ?? ''), { timeout: 5000 });
    } else if (action === 'press') {
      await page.keyboard.press(String(body.key || 'Enter'));
    } else {
      return { error: `unknown action "${action}"` };
    }
  } catch (e) {
    return { error: `action failed: ${(e.message || String(e)).split('\n')[0]}`, ...(await snapshot()) };
  }
  return await snapshot();
}

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true, base: BASE_URL });
  if (req.method === 'GET' && req.url === '/snapshot') return snapshot().then((s) => send(res, 200, s));
  if (req.method === 'POST' && req.url === '/act') {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => act(JSON.parse(data || '{}')).then((r) => send(res, 200, r)).catch((e) => send(res, 500, { error: String(e) })));
    return;
  }
  send(res, 404, { error: 'not found' });
}).listen(PORT, () => console.log(`[probe] driver on http://localhost:${PORT} -> ${BASE_URL}`));
