// 장중 주가 스냅샷 (경량, 10분 주기) → data/quotes.json
// KR: 네이버 모바일 basic API (현재가·등락률·체결시각·장 상태) / 글로벌: Yahoo quote
// market.json(하루 2회, 밸류·수급)과 분리해 가격만 자주 갱신한다.
import fs from 'node:fs';
import path from 'node:path';
import YahooFinance from 'yahoo-finance2';
import { KR, GLOBAL } from './universe.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'data', 'quotes.json');
const HDR = { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1', accept: 'application/json', 'accept-language': 'ko-KR,ko;q=0.9', referer: 'https://m.stock.naver.com/' };
const num = s => { if (s == null) return null; const v = parseFloat(String(s).replace(/[,\s%]/g, '')); return Number.isFinite(v) ? v : null; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { kr: {}, global: {} };
const out = { generatedAt: new Date().toISOString(), kr: { ...prev.kr }, global: { ...prev.global }, failures: [] };

for (const c of KR) {
  try {
    const r = await fetch(`https://m.stock.naver.com/api/stock/${c.code}/basic`, { headers: HDR, signal: AbortSignal.timeout(15000) });
    const txt = await r.text(); if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = JSON.parse(txt);
    if (process.env.DEBUG && c === KR[0]) { fs.mkdirSync(path.join(ROOT, 'data', 'debug'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'data', 'debug', 'quote_basic.txt'), txt.slice(0, 6000)); }
    const price = num(j.closePrice ?? j.currentPrice ?? j.price);
    if (price == null) throw new Error('no price: ' + Object.keys(j).slice(0, 12).join(','));
    let chg = num(j.compareToPreviousClosePrice); const pct = num(j.fluctuationsRatio);
    const dir = String(j.compareToPreviousPrice?.code || j.compareToPreviousPrice?.name || '');
    if (chg != null && /^(4|5)$|하락|FALLING/i.test(dir) && chg > 0) chg = -chg; // 네이버는 등락폭을 절대값으로 주고 방향 코드를 따로 준다
    const chgPct = pct != null ? (chg != null && chg < 0 && pct > 0 ? -pct : pct) : null;
    out.kr[c.code] = { price, chg, chgPct, at: j.localTradedAt || null, status: j.marketStatus || j.stockEndType || null };
  } catch (e) { out.failures.push(`${c.code}: ${e.message.slice(0, 80)}`); }
  await sleep(120);
}

try {
  const yf = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
  const q = await yf.quote(GLOBAL.map(g => g.sym));
  for (const x of q || []) out.global[x.symbol] = { price: x.regularMarketPrice ?? null, chgPct: x.regularMarketChangePercent ?? null, at: x.regularMarketTime ? new Date(x.regularMarketTime).toISOString() : null, state: x.marketState || null };
} catch (e) { out.failures.push('yahoo: ' + e.message.slice(0, 80)); }

// 변화가 없으면(휴장·장 마감 후) 파일을 건드리지 않아 커밋/배포가 생기지 않는다
const same = JSON.stringify({ kr: out.kr, global: out.global }) === JSON.stringify({ kr: prev.kr || {}, global: prev.global || {} });
if (same && prev.generatedAt) { console.log('quotes: unchanged, skip write'); process.exit(0); }
fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
console.log(`quotes: kr ${Object.keys(out.kr).length}, global ${Object.keys(out.global).length}, failures ${out.failures.length}`, out.failures.slice(0, 3));
