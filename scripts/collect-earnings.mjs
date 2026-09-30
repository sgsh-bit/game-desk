// 실적 컨센서스 (네이버증권 분기/연간 재무 — 확정치 + FnGuide 컨센서스 추정치 E) → data/earnings.json
import fs from 'node:fs';
import path from 'node:path';
import { KR } from './universe.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'data', 'earnings.json');
const DBG = path.join(ROOT, 'data', 'debug');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HDR = { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1', accept: 'application/json', 'accept-language': 'ko-KR,ko;q=0.9', referer: 'https://m.stock.naver.com/' };
const num = s => { if (s == null) return null; const v = parseFloat(String(s).replace(/[,\s]/g, '')); return Number.isFinite(v) ? v : null; };
const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { companies: {} };

async function get(url, dumpName) {
  const r = await fetch(url, { headers: HDR }); const txt = await r.text();
  if (dumpName && process.env.DEBUG) { fs.mkdirSync(DBG, { recursive: true }); fs.writeFileSync(path.join(DBG, dumpName), `${r.status} ${url}\n${txt.slice(0, 12000)}`); }
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return JSON.parse(txt);
}

// Parse Naver finance JSON: { trTitleList:[{isConsensus:'Y'|'N', title:'2026.09.', key:'202609'}], rowList:[{title:'매출액', columns:{'202609':{value:'1,234'}}}] }
function parse(j) {
  const fi = j.financeInfo || j;
  const titles = fi.trTitleList || fi.titleList || [];
  const rows = fi.rowList || [];
  const periods = titles.map(t => ({ key: t.key, label: String(t.title || t.key).replace(/\.$/, ''), est: t.isConsensus === 'Y' }));
  const pick = re => rows.find(r => re.test(String(r.title || '').replace(/\s/g, '')));
  const series = row => row ? periods.map(p => num(row.columns?.[p.key]?.value)) : periods.map(() => null);
  return {
    periods,
    rev: series(pick(/^매출액$|^영업수익$|^순영업수익$/)),
    op: series(pick(/^영업이익$/)),
    np: series(pick(/^당기순이익$/)),
    npc: series(pick(/지배주주순이익/)),
    opm: series(pick(/^영업이익률$/)),
    npm: series(pick(/^순이익률$/)),
    eps: series(pick(/^EPS/)),
    roe: series(pick(/^ROE/)),
    debt: series(pick(/^부채비율/)),
    per: series(pick(/^PER/)),
    pbr: series(pick(/^PBR/)),
    dps: series(pick(/^주당배당금|^DPS/)),
  };
}

const KEYS = ['rev', 'op', 'np', 'npc', 'opm', 'npm', 'eps', 'roe', 'debt', 'per', 'pbr', 'dps'];
const QA = path.join(ROOT, 'data', 'history', 'quarters.json');
const quarterArchive = fs.existsSync(QA) ? JSON.parse(fs.readFileSync(QA, 'utf8')) : {};
const out = { generatedAt: new Date().toISOString(), unit: '억원', companies: {}, failures: [] };
for (const c of KR) {
  try {
    let q = await get(`https://m.stock.naver.com/api/stock/${c.code}/finance/quarter`, c === KR[0] ? 'fin_quarter.txt' : null);
    // try to widen the window (more quarters → YoY for every column)
    for (const extra of ['?count=10', '?size=10', '?periodCount=10']) {
      try { const q2 = await get(`https://m.stock.naver.com/api/stock/${c.code}/finance/quarter${extra}`); if ((q2.financeInfo?.trTitleList || []).length > (q.financeInfo?.trTitleList || []).length) { q = q2; if (c === KR[0]) console.log('wider quarter window via', extra); break; } } catch {}
    }
    const a = await get(`https://m.stock.naver.com/api/stock/${c.code}/finance/annual`, c === KR[0] ? 'fin_annual.txt' : null);
    const Q = parse(q), A = parse(a);
    if (!Q.periods.length) throw new Error('no periods');
    // merge with archived actual quarters (data/history/quarters.json) so the window grows over time
    const arch = (quarterArchive[c.code] = quarterArchive[c.code] || {});
    Q.periods.forEach((p, i) => { if (!p.est && arch[p.key]?.src !== 'fn') { arch[p.key] = {}; for (const k of KEYS) if (Q[k]?.[i] != null) arch[p.key][k] = Q[k][i]; } });
    const keys = [...new Set([...Object.keys(arch), ...Q.periods.map(p => p.key)])].sort().slice(-12);
    const merged = { periods: keys.map(k => Q.periods.find(p => p.key === k) || { key: k, label: `${k.slice(0, 4)}.${k.slice(4)}`, est: false }) };
    for (const m of KEYS) merged[m] = keys.map(k => { const i = Q.periods.findIndex(p => p.key === k); const fnv = arch[k]?.src === 'fn' ? arch[k]?.[m] : undefined; return fnv != null ? fnv : (i >= 0 ? Q[m]?.[i] ?? null : arch[k]?.[m] ?? null); });
    merged.src = keys.map(k => arch[k]?.src || (Q.periods.some(p => p.key === k) ? 'naver' : null));
    out.companies[c.code] = { name: c.name, sector: c.sector, quarter: merged, annual: A };
  } catch (e) {
    out.failures.push(`${c.code}: ${e.message.slice(0, 120)}`);
    if (prev.companies?.[c.code]) out.companies[c.code] = prev.companies[c.code];
  }
  await sleep(400);
}
// 컨센서스 일별 스냅샷 (다음 분기 OP E, 연간 OP E) → data/history/consensus.json (90일)
const HP = path.join(ROOT, 'data', 'history', 'consensus.json');
const hist = fs.existsSync(HP) ? JSON.parse(fs.readFileSync(HP, 'utf8')) : {};
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
for (const [code, c] of Object.entries(out.companies)) {
  const Q = c.quarter, A = c.annual;
  const nextE = Q.periods.findIndex(p => p.est);
  const yr = String(new Date().getFullYear());
  const ai = A.periods.findIndex(p => p.label.startsWith(yr));
  (hist[code] = hist[code] || {})[today] = { qLab: nextE >= 0 ? Q.periods[nextE].label : null, qRev: nextE >= 0 ? Q.rev[nextE] : null, qOp: nextE >= 0 ? Q.op[nextE] : null, yOp: ai >= 0 ? A.op[ai] : null, yRev: ai >= 0 ? A.rev[ai] : null };
  for (const d of Object.keys(hist[code]).sort().slice(0, -90)) delete hist[code][d];
}
fs.writeFileSync(HP, JSON.stringify(hist) + '\n');
fs.writeFileSync(QA, JSON.stringify(quarterArchive) + '\n');
fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
console.log(`earnings: ${Object.keys(out.companies).length} companies, failures ${out.failures.length}`, out.failures.slice(0, 3));
