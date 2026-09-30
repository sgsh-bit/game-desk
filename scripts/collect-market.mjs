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

// ---------- KRX 정보데이터시스템: 투자자별 순매수 거래대금 (일별, 원) ----------
const KRX = 'https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd';
const KRX_HDR = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36', referer: 'https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201020203', 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'x-requested-with': 'XMLHttpRequest', accept: 'application/json, text/javascript, */*; q=0.01', origin: 'https://data.krx.co.kr' };
async function krxPost(params) {
  const r = await fetch(KRX, { method: 'POST', headers: KRX_HDR, body: new URLSearchParams(params).toString() });
  const txt = await r.text();
  try { return JSON.parse(txt); } catch { throw new Error(`krx non-JSON (${r.status}): ${txt.slice(0, 100)}`); }
}
const isinCache = {};
async function krxIsin(code) {
  if (isinCache[code]) return isinCache[code];
  const j = await krxPost({ bld: 'dbms/comm/finder/finder_stkisu', locale: 'ko_KR', mktsel: 'ALL', typeNo: '0', searchText: code });
  const hit = (j.block1 || []).find(x => x.short_code === code) || (j.block1 || [])[0];
  if (!hit?.full_code) throw new Error(`krx isin ${code}: ${JSON.stringify(j).slice(0, 120)}`);
  return (isinCache[code] = hit.full_code);
}
const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, '');
async function krxFlows(code) {
  const isin = await krxIsin(code);
  const end = new Date(), start = new Date(end.getTime() - 70 * 86400000);
  const j = await krxPost({ bld: 'dbms/MDC/STAT/standard/MDCSTAT02303', locale: 'ko_KR', inqTpCd: '2', trdVolVal: '2', askBid: '3', tboxisuCd_finder_stkisu0_0: code, isuCd: isin, isuCd2: '', codeNmisuCd_finder_stkisu0_0: '', param1isuCd_finder_stkisu0_0: 'ALL', strtDd: ymd(start), endDd: ymd(end), share: '1', money: '1', csvxls_isNo: 'false' });
  const out = j.output || j.OutBlock_1 || [];
  if (!out.length) { fs.mkdirSync(path.join(ROOT, 'data', 'debug'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'data', 'debug', `krx_${code}.json`), JSON.stringify(j).slice(0, 20000)); throw new Error(`krx ${code}: empty output`); }
  // TRDVAL1..7 = 금융투자·보험·투신·사모·은행·기타금융·연기금 (기관 합계), 8 기타법인, 9 개인, 10 외국인, 11 기타외국인 — 단위: 원
  const rows = out.map(x => { const v = k => num(x[k]); const inst = [1,2,3,4,5,6,7].reduce((s, i) => s + (v('TRDVAL' + i) || 0), 0);
    return { d: String(x.TRD_DD).replace(/\//g, '-'), inst: inst / 1e8, frgn: ((v('TRDVAL10') || 0) + (v('TRDVAL11') || 0)) / 1e8, indiv: (v('TRDVAL9') || 0) / 1e8, pension: (v('TRDVAL7') || 0) / 1e8, corp: (v('TRDVAL8') || 0) / 1e8 }; })
    .filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x.d)).sort((a, b) => b.d.localeCompare(a.d));
  if (rows.length < 5) throw new Error(`krx ${code}: ${rows.length} rows`);
  const sum = (k, n) => rows.slice(0, n).reduce((s, x) => s + (x[k] || 0), 0);
  return { flows: rows.slice(0, 40), unit: '억원', sums: { frgn1: sum('frgn', 1), frgn5: sum('frgn', 5), frgn20: sum('frgn', 20), inst1: sum('inst', 1), inst5: sum('inst', 5), inst20: sum('inst', 20), indiv5: sum('indiv', 5), pension5: sum('pension', 5) }, asOf: rows[0].d };
}


// ---------- Naver mobile stock API (fallback when KRX blocks overseas IPs) ----------
const NAVER_HDR = { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', accept: 'application/json', 'accept-language': 'ko-KR,ko;q=0.9', referer: 'https://m.stock.naver.com/' };
async function naverTrend(code, dump = false) {
  const cands = [
    `https://m.stock.naver.com/api/stock/${code}/trend?pageSize=40&page=1`,
    `https://api.stock.naver.com/stock/${code}/trend?pageSize=40&page=1`,
    `https://m.stock.naver.com/api/stock/${code}/integration`,
  ];
  let best = null, errs = [];
  for (const u of cands) {
    try {
      const r = await fetch(u, { headers: NAVER_HDR }); const txt = await r.text();
      if (dump) { fs.mkdirSync(path.join(ROOT, 'data', 'debug'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'data', 'debug', `naver_${code}_${cands.indexOf(u)}.txt`), `${r.status}\n${txt.slice(0, 6000)}`); }
      if (!r.ok) { errs.push(`${u} ${r.status}`); continue; }
      const j = JSON.parse(txt);
      // find an array of daily rows with foreigner/organ keys
      const arrs = []; (function walk(o, d) { if (d > 4 || !o) return; if (Array.isArray(o)) { if (o.length && typeof o[0] === 'object') arrs.push(o); o.slice(0, 3).forEach(x => walk(x, d + 1)); } else if (typeof o === 'object') Object.values(o).forEach(x => walk(x, d + 1)); })(j, 0);
      const arr = arrs.find(a => Object.keys(a[0]).some(k => /foreign/i.test(k)) && Object.keys(a[0]).some(k => /organ|institution/i.test(k)));
      if (arr) { best = arr; break; }
      errs.push(`${u}: no trend array (keys ${Object.keys(j).slice(0, 8).join(',')})`);
    } catch (e) { errs.push(`${u}: ${e.message}`); }
  }
  if (!best) throw new Error('naver trend: ' + errs.join(' | ').slice(0, 300));
  const k0 = Object.keys(best[0]);
  const key = re => k0.find(k => re.test(k));
  const kd = key(/bizdate|date|day/i), kc = key(/close/i), kf = key(/foreigner.*(pure|net).*(quant|buy)|foreign.*net/i), ko = key(/organ.*(pure|net).*(quant|buy)|institution.*net/i), ki = key(/individual.*(pure|net)/i), kr = key(/foreigner.*hold|hold.*ratio/i);
  const rows = best.map(x => ({ d: String(x[kd]).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3').replace(/\./g, '-').slice(0, 10), close: num(x[kc]), frgnQ: num(x[kf]), instQ: num(x[ko]), indivQ: ki ? num(x[ki]) : null, frgnRate: kr ? num(x[kr]) : null }))
    .filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x.d)).sort((a, b) => b.d.localeCompare(a.d));
  if (rows.length < 5) throw new Error(`naver trend ${code}: ${rows.length} rows (keys ${k0.join(',')})`);
  // 주수 × 종가 → 억원 (근사)
  rows.forEach(x => { x.frgn = x.frgnQ != null && x.close ? x.frgnQ * x.close / 1e8 : null; x.inst = x.instQ != null && x.close ? x.instQ * x.close / 1e8 : null; x.indiv = x.indivQ != null && x.close ? x.indivQ * x.close / 1e8 : null; });
  const sum = (k, n) => rows.slice(0, n).reduce((s, x) => s + (x[k] || 0), 0);
  return { flows: rows.slice(0, 40), unit: '억원(주수×종가 환산)', sums: { frgn1: sum('frgn', 1), frgn5: sum('frgn', 5), frgn20: sum('frgn', 20), inst1: sum('inst', 1), inst5: sum('inst', 5), inst20: sum('inst', 20), indiv5: sum('indiv', 5) }, frgnRate: rows[0].frgnRate, asOf: rows[0].d, src: 'naver' };
}


// Naver integration: PER/PBR/EPS/배당수익률 (국내 기준 지표)
async function naverIntegration(code, dump = false) {
  const r = await fetch(`https://m.stock.naver.com/api/stock/${code}/integration`, { headers: NAVER_HDR });
  const txt = await r.text();
  if (dump) { fs.mkdirSync(path.join(ROOT, 'data', 'debug'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'data', 'debug', `naver_${code}_integration.txt`), `${r.status}\n${txt.slice(0, 8000)}`); }
  if (!r.ok) throw new Error(`integration ${r.status}`);
  const j = JSON.parse(txt);
  const infos = j.totalInfos || j.stockInfos || [];
  const get = re => { const x = infos.find(i => re.test(String(i.code || i.key || ''))); return x ? num(String(x.value).replace(/배|원|%|주|,/g, '')) : null; };
  return { nPer: get(/^per$/i), nPbr: get(/^pbr$/i), nEps: get(/^eps$/i), nDiv: get(/^dividendYieldRatio$/i), nCnsPer: get(/^cnsPer$/i), nFrgn: get(/^foreignRate$/i) };
}

// ---------- Yahoo: 밸류에이션·컨센서스·수익률 ----------
async function yahoo(sym) {
  const q = await yahooFinance.quoteSummary(sym, { modules: ['price', 'summaryDetail', 'defaultKeyStatistics', 'financialData'] });
  const p = q.price || {}, s = q.summaryDetail || {}, k = q.defaultKeyStatistics || {}, f = q.financialData || {};
  const out = {
    price: p.regularMarketPrice ?? null, chgPct: p.regularMarketChangePercent != null ? p.regularMarketChangePercent * 100 : null,
    ccy: p.currency || null, mcap: p.marketCap ?? null,
    per: s.trailingPE ?? (k.trailingEps && p.regularMarketPrice ? p.regularMarketPrice / k.trailingEps : null), fwdPer: s.forwardPE ?? k.forwardPE ?? null, pbr: k.priceToBook ?? null, evEbitda: k.enterpriseToEbitda ?? null,
    divYield: s.dividendYield != null ? s.dividendYield * 100 : null, hi52: s.fiftyTwoWeekHigh ?? null, lo52: s.fiftyTwoWeekLow ?? null,
    target: f.targetMeanPrice ?? null, recMean: f.recommendationMean ?? null, recKey: f.recommendationKey ?? null, nAnalysts: f.numberOfAnalystOpinions ?? null,
    revGrowth: f.revenueGrowth != null ? f.revenueGrowth * 100 : null, opMargin: f.operatingMargins != null ? f.operatingMargins * 100 : null,
  };
  if (out.per == null || out.pbr == null || out.fwdPer == null) {
    try { const qq = await yahooFinance.quote(sym); out.per ??= qq.trailingPE ?? (qq.epsTrailingTwelveMonths ? (qq.regularMarketPrice / qq.epsTrailingTwelveMonths) : null); out.fwdPer ??= qq.forwardPE ?? (qq.epsForward ? qq.regularMarketPrice / qq.epsForward : null); out.pbr ??= qq.priceToBook ?? null; out.price ??= qq.regularMarketPrice ?? null; out.mcap ??= qq.marketCap ?? null; } catch (e) { log(`quote ${sym}: ${e.message}`); }
  }
  if (out.per != null && out.per < 0) out.per = -1; // 적자
  if (out.price && out.target) out.upside = (out.target / out.price - 1) * 100;
  // returns from 1y daily closes
  try {
    const end = new Date(); const start = new Date(end.getTime() - 1100 * 86400000);
    const ch = await yahooFinance.chart(sym, { period1: start, period2: end, interval: '1d' });
    const qs = (ch.quotes || []).filter(x => x.close != null);
    // weekly closes for band charts (last close of each ISO week), ~150 points
    const wk = new Map(); for (const x of qs) { const d = new Date(x.date); const k = `${d.getUTCFullYear()}-${String(Math.ceil(((d - new Date(Date.UTC(d.getUTCFullYear(), 0, 1))) / 86400000 + new Date(Date.UTC(d.getUTCFullYear(), 0, 1)).getUTCDay() + 1) / 7)).padStart(2, '0')}`; wk.set(k, [d.toISOString().slice(0, 10), Math.round(x.close * 100) / 100]); }
    out.weekly = [...wk.values()];
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
  try { Object.assign(row, await krxFlows(s.code)); row.src = 'krx'; }
  catch (e1) { log(`krx FAIL ${s.code}: ${e1.message.slice(0, 80)}`);
    try { Object.assign(row, await naverTrend(s.code, !!process.env.DEBUG && s === KR[0])); }
    catch (e2) { result.failures.push(`flows ${s.code}: krx=${e1.message.slice(0, 40)} naver=${e2.message.slice(0, 200)}`); log(`naver FAIL ${s.code}`); Object.assign(row, pick(old, ['flows','sums','unit','asOf','frgnRate','src'])); } }
  await sleep(700);
  try { const n = await naverIntegration(s.code, !!process.env.DEBUG && s === KR[0]); if (n.nPer != null) row.per = n.nPer; if (n.nPbr != null) row.pbr = n.nPbr; if (n.nDiv != null) row.divYield = n.nDiv; if (n.nCnsPer != null) row.cnsPer = n.nCnsPer; if (n.nFrgn != null) row.frgnRate = n.nFrgn; } catch (e) { log(`integration ${s.code}: ${e.message}`); }
  result.kr.push(row); await sleep(300);
}
for (const g of GLOBAL) {
  const row = { ...g };
  const old = (prev.global || []).find(x => x.sym === g.sym) || {};
  try { Object.assign(row, await yahoo(g.sym)); } catch (e) { result.failures.push(`yahoo ${g.sym}: ${e.message}`); log(`yahoo FAIL ${g.sym}: ${e.message}`); Object.assign(row, old); }
  result.global.push(row); await sleep(300);
}
function pick(o, keys) { const r = {}; for (const k of keys) if (o[k] !== undefined) r[k] = o[k]; return r; }

// 주간 종가 히스토리 (밴드차트용) → data/history/prices.json
{
  const PP = path.join(ROOT, 'data', 'history', 'prices.json');
  const prices = {};
  for (const r of [...result.kr, ...result.global]) { if (r.weekly?.length) prices[r.code || r.sym] = r.weekly; delete r.weekly; }
  if (Object.keys(prices).length) fs.writeFileSync(PP, JSON.stringify(prices) + '\n');
}
// 밸류에이션 일별 스냅샷 (주가·추정PER·PBR·목표가) → data/history/valuation.json (180일)
{
  const HP = path.join(ROOT, 'data', 'history', 'valuation.json');
  const hist = fs.existsSync(HP) ? JSON.parse(fs.readFileSync(HP, 'utf8')) : {};
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  for (const r of [...result.kr, ...result.global]) {
    const k = r.code || r.sym;
    (hist[k] = hist[k] || {})[today] = { p: r.price ?? null, fpe: r.cnsPer ?? r.fwdPer ?? null, pbr: r.pbr ?? null, tp: r.target ?? null, mc: r.mcap ?? null };
    for (const d of Object.keys(hist[k]).sort().slice(0, -180)) delete hist[k][d];
  }
  fs.writeFileSync(HP, JSON.stringify(hist) + '\n');
}
fs.writeFileSync(OUT, JSON.stringify(result) + '\n');
log('done. failures:', result.failures.length ? result.failures : 'none');
