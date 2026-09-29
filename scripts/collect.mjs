// Collects store top-grossing charts and writes data/charts.json (+ data/history/*.json).
// Sources: Apple RSS (public JSON), Google Play (rendered with Playwright), Steam weekly top sellers.
// Run: node scripts/collect.mjs   (env: SKIP_GPLAY=1 to skip Google, SKIP_STEAM=1 to skip Steam)
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const DATA = path.join(ROOT, 'data');
const HIST = path.join(DATA, 'history');
fs.mkdirSync(HIST, { recursive: true });

const nowIso = new Date().toISOString();
const todayKST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function loadJSON(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function saveJSON(p, v) { fs.writeFileSync(p, JSON.stringify(v, null, 0) + '\n'); }

// ---------- Apple ----------
async function apple(cc) {
  const url = `https://itunes.apple.com/${cc}/rss/topgrossingapplications/limit=50/genre=6014/json`;
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (game-desk collector)' } });
  if (!r.ok) throw new Error(`apple ${cc} HTTP ${r.status}`);
  const j = await r.json();
  const items = (j.feed?.entry || []).map((e, i) => ({
    r: i + 1, n: e['im:name']?.label, p: e['im:artist']?.label,
    id: e.id?.attributes?.['im:id'], bid: e.id?.attributes?.['im:bundleId'],
  }));
  if (items.length < 20) throw new Error(`apple ${cc}: only ${items.length} items`);
  return { store: 'apple', cc: cc.toUpperCase(), fetchedAt: nowIso, source: url, items };
}

// ---------- Google Play (Playwright) ----------
const GP = { kr: ['ko', 'KR', '최고 매출'], jp: ['ja', 'JP', '売上トップ'], us: ['en', 'US', 'Top grossing'] };
async function gplayAll(browser) {
  const out = {};
  for (const [cc, [hl, gl, label]] of Object.entries(GP)) {
    const url = `https://play.google.com/store/games?device=phone&hl=${hl}&gl=${gl}`;
    let lastErr;
    for (let attempt = 1; attempt <= 3 && !out[cc]; attempt++) {
      const ctx = await browser.newContext({ locale: hl, viewport: { width: 1280, height: 900 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' });
      const page = await ctx.newPage();
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await sleep(2500);
        // Consent dialog (EU-style) — click accept if present
        for (const t of ['Accept all', 'Alle akzeptieren', '모두 수락', 'すべて同意']) {
          const b = page.getByRole('button', { name: t }).first();
          if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); await sleep(800); }
        }
        // find the "Top grossing" tab, scroll it into view, click it
        const tab = page.locator(`[role="button"], button`).filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).first();
        await tab.waitFor({ state: 'attached', timeout: 20000 });
        await tab.scrollIntoViewIfNeeded();
        await sleep(600);
        await tab.click({ timeout: 10000 });
        await sleep(3000);
        const rows = await page.evaluate((label) => {
          const lab = [...document.querySelectorAll('span,div')].find(e => e.children.length === 0 && e.textContent.trim() === label);
          let sec = lab; while (sec && sec.querySelectorAll('a[href*="details?id="]').length < 20) sec = sec.parentElement;
          if (!sec) return [];
          const links = [...sec.querySelectorAll('a[href*="details?id="]')];
          return links.map((a, i) => {
            const p = a.innerText.split('\n'); const off = /^\d+$/.test(p[0]) ? 1 : 0;
            let rank = off ? +p[0] : null;
            if (rank == null) { let el = a; for (let k = 0; k < 6 && el; k++) { const m = (el.innerText || '').match(/^(\d{1,3})\n/); if (m) { rank = +m[1]; break; } el = el.parentElement; } }
            return { r: rank ?? (i + 1), n: p[off], p: p[off + 1] || '', id: a.getAttribute('href').split('id=')[1].split('&')[0] };
          });
        }, label);
        // sanity: contiguous ranks, ≥20 rows, and the selected chip is the grossing one
        const pressed = await tab.getAttribute('aria-pressed').catch(() => null);
        const ok = rows.length >= 20 && rows.every((x, i) => x.r === i + 1) && (pressed === null || pressed === 'true');
        if (!ok) throw new Error(`gplay ${cc}: got ${rows.length} rows, pressed=${pressed}`);
        out[cc] = { store: 'gplay', cc: gl, fetchedAt: nowIso, source: url + ' (' + label + ')', items: rows.slice(0, 50) };
        log(`gplay ${cc}: ${rows.length} rows`);
      } catch (e) { lastErr = e; log(`gplay ${cc} attempt ${attempt} failed: ${e.message}`); await sleep(3000); }
      finally { await ctx.close(); }
    }
    if (!out[cc]) log(`gplay ${cc}: giving up (${lastErr?.message})`);
  }
  return out;
}

// ---------- Steam ----------
async function steamApi(cc) {
  // Valve's weekly top sellers (by revenue). Undocumented but used by the store charts page.
  const url = `https://api.steampowered.com/ISteamChartsService/GetWeeklyTopSellers/v1/?country_code=${cc === 'global' ? '' : cc.toUpperCase()}`;
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (game-desk collector)' } });
  if (!r.ok) throw new Error(`steam api ${cc} HTTP ${r.status}`);
  const j = await r.json();
  const ranks = j?.response?.ranks || [];
  const items = ranks.map(x => ({ r: x.rank, n: x.item?.name || String(x.appid), p: '', id: String(x.appid), prev: x.last_week_rank }));
  if (items.length < 20 || !items[0].n) throw new Error(`steam api ${cc}: ${items.length} items / no names`);
  return { store: 'steam', cc: cc.toUpperCase(), fetchedAt: nowIso, source: url, items: items.slice(0, 50) };
}
async function steamPage(browser, cc) {
  const url = `https://store.steampowered.com/charts/topselling/${cc === 'global' ? 'global' : cc.toUpperCase()}`;
  const ctx = await browser.newContext({ locale: 'en-US' }); const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('a[href*="/app/"]', { timeout: 30000 }); await sleep(1500);
    const rows = await page.evaluate(() => {
      const trs = [...document.querySelectorAll('table tr')].filter(tr => tr.querySelector('a[href*="/app/"]'));
      return trs.map((tr, i) => { const a = tr.querySelector('a[href*="/app/"]'); const m = a.href.match(/\/app\/(\d+)/);
        const name = (tr.innerText.split('\n').map(s => s.trim()).filter(s => s && !/^\d+$/.test(s) && !/^[₩$€£¥\d,.\s%-]+$/.test(s))[0]) || '';
        return { r: i + 1, n: name, p: '', id: m ? m[1] : '' }; });
    });
    if (rows.length < 20) throw new Error(`steam page ${cc}: ${rows.length} rows`);
    return { store: 'steam', cc: cc.toUpperCase(), fetchedAt: nowIso, source: url, items: rows.slice(0, 50) };
  } finally { await ctx.close(); }
}

// ---------- history & deltas ----------
function applyHistory(doc) {
  const key = `${doc.store}_${doc.cc.toLowerCase()}`;
  const hp = path.join(HIST, key + '.json');
  const hist = loadJSON(hp, {});           // { 'YYYY-MM-DD': [[rank,id],...] }
  const dates = Object.keys(hist).filter(d => d < todayKST).sort();
  const prevDate = dates[dates.length - 1];
  if (prevDate) {
    const pm = new Map(hist[prevDate].map(([r, id]) => [String(id), r]));
    doc.prevDate = prevDate;
    doc.items.forEach(it => { it.d = pm.has(String(it.id)) ? pm.get(String(it.id)) - it.r : null; }); // +up / -down / null new
  }
  hist[todayKST] = doc.items.map(it => [it.r, it.id]);
  for (const d of Object.keys(hist).sort().slice(0, -45)) delete hist[d];   // keep 45 days
  saveJSON(hp, hist);
  return doc;
}

// ---------- main ----------
const charts = loadJSON(path.join(DATA, 'charts.json'), {});
const failures = [];
async function put(key, fn) {
  try { charts[key] = applyHistory(await fn()); log(`ok ${key} (${charts[key].items.length})`); }
  catch (e) { failures.push(`${key}: ${e.message}`); log(`FAIL ${key}: ${e.message}`); }
}
for (const cc of ['kr', 'jp', 'us', 'cn']) await put('apple_' + cc, () => apple(cc));

let browser = null;
if (!process.env.SKIP_GPLAY || !process.env.SKIP_STEAM) {
  const { chromium } = await import('playwright');
  browser = await chromium.launch({ args: ['--lang=ko-KR'] });
}
if (!process.env.SKIP_STEAM) {
  for (const cc of ['kr', 'global']) await put('steam_' + cc, async () => { try { return await steamApi(cc); } catch (e) { log('steam api fallback:', e.message); return steamPage(browser, cc); } });
}
if (!process.env.SKIP_GPLAY) {
  const g = await gplayAll(browser);
  for (const cc of ['kr', 'jp', 'us']) { if (g[cc]) charts['gplay_' + cc] = applyHistory(g[cc]); else failures.push(`gplay_${cc}: no data`); }
}
if (browser) await browser.close();

charts._meta = { generatedAt: nowIso, failures };
saveJSON(path.join(DATA, 'charts.json'), charts);
log('done. failures:', failures.length ? failures : 'none');
if (failures.length === 9) process.exit(1);
