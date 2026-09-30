// Collects 수급 (foreign/institution net buying from Naver Finance) and 밸류에이션·컨센서스
// (Yahoo Finance via yahoo-finance2) for the Korean universe + global peers → data/market.json
import fs from 'node:fs';
import path from 'node:path';
import YahooFinance from 'yahoo-finance2';
import { KR, GLOBAL } from './universe.mjs';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'data', 'market.json');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = s => { if (s == null) return null; const t = String(s).replace(/[,+%\s]/g, '').replace(/^[▲△]/, '').replace(/^[▼▽]/, '-'); const v = parseFloat(t); return Number.isFinite(v) ? v : null; };
const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};

// ---------- Naver Finance: 외국인·기관 순매매 (일별) ----------
async function naverFlows(code, pages = 2) {
  const rows = [];
  for (let p = 1; p <= pages; p++) {
    const url = `https://finance.naver.com/item/frgn.naver?code=${code}&page=${p}`;
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36', 'accept-language': 'ko-KR,ko;q=0.9', referer: 'https://finance.naver.com/' } });
    if (!r.ok) throw new Error(`naver ${code} HTTP ${r.status}`);
    const html = new TextDecoder('euc-kr').decode(await r.arrayBuffer());
    for (const tr of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || []) {
      const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;|\s+/g, ' ').trim());
      if (tds.length < 9 || !/^\d{4}\.\d{2}\.\d{2}$/.test(tds[0])) continue;
      const down = /하락/.test(tr), up = /상승/.test(tr);
      const chg = num(tds[2]); const pct = num(tds[3]);
      rows.push({ d: tds[0].replace(/\./g, '-'), close: num(tds[1]), chg: chg == null ? null : (down ? -Math.abs(chg) : up ? Math.abs(chg) : 0), pct: pct == null ? null : (down ? -Math.abs(pct) : up ? Math.abs(pct) : 0),
        vol: num(tds[4]), inst: num(tds[5]), frgn: num(tds[6]), frgnShares: num(tds[7]), frgnRate: num(tds[8]) });
    }
    await sleep(400);
  }
  const seen = new Set(); const uniq = rows.filter(x => !seen.has(x.d) && seen.add(x.d)).sort((a, b) => b.d.localeCompare(a.d));
  if (uniq.length < 5) throw new Error(`naver ${code}: parsed ${uniq.length} rows`);
  const sum = (k, n) => uniq.slice(0, n).reduce((s, x) => s + (x[k] || 0), 0);
  return { flows: uniq.slice(0, 40), sums: { frgn1: sum('frgn', 1), frgn5: sum('frgn', 5), frgn20: sum('frgn', 20), inst1: sum('inst', 1), inst5: sum('inst', 5), inst20: sum('inst', 20) }, frgnRate: uniq[0].frgnRate, asOf: uniq[0].d };
}

// ---------- Yahoo: 밸류에이션·컨센서스·수익률 ----------
async function yahoo(sym) {
  const q = await yahooFinance.quoteSummary(sym, { modules: ['price', 'summaryDetail', 'defaultKeyStatistics', 'financialData'] });
  const p = q.price || {}, s = q.summaryDetail || {}, k = q.defaultKeyStatistics || {}, f = q.financialData || {};
  const out = {
    price: p.regularMarketPrice ?? null, chgPct: p.regularMarketChangePercent != null ? p.regularMarketChangePercent * 100 : null,
    ccy: p.currency || null, mcap: p.marketCap ?? null,
    per: s.trailingPE ?? null, fwdPer: s.forwardPE ?? k.forwardPE ?? null, pbr: k.priceToBook ?? null, evEbitda: k.enterpriseToEbitda ?? null,
    divYield: s.dividendYield != null ? s.dividendYield * 100 : null, hi52: s.fiftyTwoWeekHigh ?? null, lo52: s.fiftyTwoWeekLow ?? null,
    target: f.targetMeanPrice ?? null, recMean: f.recommendationMean ?? null, recKey: f.recommendationKey ?? null, nAnalysts: f.numberOfAnalystOpinions ?? null,
    revGrowth: f.revenueGrowth != null ? f.revenueGrowth * 100 : null, opMargin: f.operatingMargins != null ? f.operatingMargins * 100 : null,
  };
  if (out.price && out.target) out.upside = (out.target / out.price - 1) * 100;
  // returns from 1y daily closes
  try {
    const end = new Date(); const start = new Date(end.getTime() - 400 * 86400000);
    const ch = await yahooFinance.chart(sym, { period1: start, period2: end, interval: '1d' });
    const qs = (ch.quotes || []).filter(x => x.close != null);
    const last = qs[qs.length - 1]?.close;
    const at = (days) => { const t = end.getTime() - days * 86400000; let best = null; for (const x of qs) { if (new Date(x.date).getTime() <= t) best = x; } return best?.close; };
    const ytdBase = (() => { const y = end.getFullYear(); let best = null; for (const x of qs) { if (new Date(x.date).getFullYear() < y) best = x; } return best?.close; })();
    const ret = b => (last && b) ? (last / b - 1) * 100 : null;
    out.ret = { w1: ret(at(7)), m1: ret(at(30)), m3: ret(at(91)), ytd: ret(ytdBase), y1: ret(at(365)) };
    out.spark = qs.slice(-60).map(x => Math.round(x.close * 100) / 100);
  } catch (e) { log(`chart ${sym}: ${e.message}`); }
  return out;
}

const result = { generatedAt: new Date().toISOString(), kr: [], global: [], failures: [] };
for (const s of KR) {
  const sym = `${s.code}.${s.mkt}`;
  const row = { ...s, sym };
  const old = (prev.kr || []).find(x => x.code === s.code) || {};
  try { Object.assign(row, await yahoo(sym)); } catch (e) { result.failures.push(`yahoo ${sym}: ${e.message}`); log(`yahoo FAIL ${sym}: ${e.message}`); Object.assign(row, pick(old, ['price','chgPct','ccy','mcap','per','fwdPer','pbr','evEbitda','divYield','hi52','lo52','target','recMean','recKey','nAnalysts','upside','ret','spark','revGrowth','opMargin'])); }
  try { Object.assign(row, await naverFlows(s.code)); } catch (e) { result.failures.push(`naver ${s.code}: ${e.message}`); log(`naver FAIL ${s.code}: ${e.message}`); Object.assign(row, pick(old, ['flows','sums','frgnRate','asOf'])); }
  result.kr.push(row); await sleep(300);
}
for (const g of GLOBAL) {
  const row = { ...g };
  const old = (prev.global || []).find(x => x.sym === g.sym) || {};
  try { Object.assign(row, await yahoo(g.sym)); } catch (e) { result.failures.push(`yahoo ${g.sym}: ${e.message}`); log(`yahoo FAIL ${g.sym}: ${e.message}`); Object.assign(row, old); }
  result.global.push(row); await sleep(300);
}
function pick(o, keys) { const r = {}; for (const k of keys) if (o[k] !== undefined) r[k] = o[k]; return r; }

fs.writeFileSync(OUT, JSON.stringify(result) + '\n');
log('done. failures:', result.failures.length ? result.failures : 'none');
