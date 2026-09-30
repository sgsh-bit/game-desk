// FnGuide 재무제표(분기 8개·연간 4~5개) → data/history/quarters.json 백필 + data/fnguide.json
// 네이버 API가 분기 5개만 주므로, 분기 YoY를 채우기 위한 보조 소스. 실패해도 기존 데이터는 그대로.
import fs from 'node:fs';
import path from 'node:path';
import { KR } from './universe.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const QA = path.join(ROOT, 'data', 'history', 'quarters.json');
const OUT = path.join(ROOT, 'data', 'fnguide.json');
const DBG = path.join(ROOT, 'data', 'debug');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HDR = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36', 'accept-language': 'ko-KR,ko;q=0.9', accept: 'text/html,application/xhtml+xml', referer: 'https://comp.fnguide.com/' };
const strip = s => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const num = s => { const t = strip(s).replace(/,/g, ''); if (t === '' || t === '-') return null; const v = parseFloat(t); return Number.isFinite(v) ? v : null; };
const ROWMAP = [[/^매출액$|^영업수익$|^순영업수익$/, 'rev'], [/^영업이익$/, 'op'], [/^당기순이익$/, 'np'], [/지배주주순이익|지배기업주주지분순이익/, 'npc']];

function parseTables(html) {
  // every table: header periods (YYYY/MM) + rows keyed by first cell
  const out = [];
  for (const tb of html.match(/<table[\s\S]*?<\/table>/g) || []) {
    const heads = [...tb.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(m => strip(m[1]));
    const periods = heads.filter(h => /^\d{4}\/\d{2}/.test(h));
    if (periods.length < 3) continue;
    const rows = {};
    for (const tr of tb.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || []) {
      const th = tr.match(/<th[^>]*>([\s\S]*?)<\/th>/); if (!th) continue;
      const label = strip(th[1]).replace(/\s|\(.*?\)/g, '');
      const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => num(m[1]));
      if (tds.length >= periods.length) rows[label] = tds.slice(0, periods.length);
    }
    out.push({ periods: periods.map(p => p.slice(0, 7)), rows, isQ: periods.some(p => /\/(03|06|09)/.test(p)) && periods.length >= 6, isEst: periods.some(p => /\(E\)|E$/.test(p)) });
  }
  return out;
}

const archive = fs.existsSync(QA) ? JSON.parse(fs.readFileSync(QA, 'utf8')) : {};
const result = { generatedAt: new Date().toISOString(), companies: {}, failures: [] };
for (const c of KR) {
  const url = `https://comp.fnguide.com/SVO2/ASP/SVD_Finance.asp?pGB=1&gicode=A${c.code}&cID=&MenuYn=Y&ReportGB=D&NewMenuID=103&stkGb=701`;
  try {
    const r = await fetch(url, { headers: HDR });
    const html = new TextDecoder('utf-8').decode(await r.arrayBuffer());
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const tables = parseTables(html);
    if (process.env.DEBUG && c === KR[0]) { fs.mkdirSync(DBG, { recursive: true }); fs.writeFileSync(path.join(DBG, 'fnguide.html'), html.slice(0, 300000)); fs.writeFileSync(path.join(DBG, 'fnguide_tables.json'), JSON.stringify(tables.map(t => ({ periods: t.periods, rows: Object.keys(t.rows).slice(0, 30), isQ: t.isQ })), null, 1)); }
    // quarterly income statement = quarterly table that has 매출액 & 영업이익
    const q = tables.find(t => t.isQ && Object.keys(t.rows).some(k => /^매출액$|^영업수익$/.test(k)) && Object.keys(t.rows).some(k => /^영업이익$/.test(k)));
    if (!q) throw new Error(`no quarterly IS table (tables: ${tables.length})`);
    const arch = (archive[c.code] = archive[c.code] || {});
    let added = 0;
    q.periods.forEach((p, i) => {
      if (/E/.test(p)) return;
      const key = p.replace('/', '');            // 2024/09 → 202409
      const rec = arch[key] || {};
      for (const [re, k] of ROWMAP) { const lab = Object.keys(q.rows).find(l => re.test(l)); if (lab && q.rows[lab][i] != null) rec[k] = q.rows[lab][i]; }
      if (rec.rev && rec.op != null) rec.opm = Math.round(rec.op / rec.rev * 10000) / 100;
      if (Object.keys(rec).length) { if (!arch[key]) added++; arch[key] = rec; }
    });
    result.companies[c.code] = { name: c.name, periods: q.periods, added };
    console.log(`${c.name}: ${q.periods.join(',')} (+${added})`);
  } catch (e) { result.failures.push(`${c.code}: ${e.message}`); console.log(`FAIL ${c.name}: ${e.message}`); }
  await sleep(700);
}
fs.writeFileSync(QA, JSON.stringify(archive) + '\n');
fs.writeFileSync(OUT, JSON.stringify(result) + '\n');
console.log('fnguide done; failures', result.failures.length);
