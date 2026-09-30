// OpenDART 단일회사 전체 재무제표(fnlttSinglAcntAll) → 분기 실적 백필 (연결 기준, 억원)
// 1Q=1분기보고서, 2Q=반기보고서 당기 3개월, 3Q=3분기보고서 당기 3개월, 4Q=사업보고서(연간) − 3Q누적
// → data/history/quarters.json (네이버 데이터와 병합), data/dart_fin.json (원본 요약)
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { KR } from './universe.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const QA = path.join(ROOT, 'data', 'history', 'quarters.json');
const OUT = path.join(ROOT, 'data', 'dart_fin.json');
const KEY = process.env.OPENDART_API_KEY;
if (!KEY) { console.log('OPENDART_API_KEY not set — skipping'); process.exit(0); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = s => { const v = parseFloat(String(s ?? '').replace(/,/g, '')); return Number.isFinite(v) ? v : null; };

// ---- corp_code map (cached in data/history/corpcodes.json)
const CC = path.join(ROOT, 'data', 'history', 'corpcodes.json');
let corp = fs.existsSync(CC) ? JSON.parse(fs.readFileSync(CC, 'utf8')) : {};
if (KR.some(k => !corp[k.code])) {
  const tmp = path.join(ROOT, 'data', 'debug'); fs.mkdirSync(tmp, { recursive: true });
  const zip = path.join(tmp, 'corpCode.zip');
  const r = await fetch(`https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${KEY}`);
  fs.writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
  execSync(`cd "${tmp}" && unzip -o -q corpCode.zip`);
  const xml = fs.readFileSync(path.join(tmp, 'CORPCODE.xml'), 'utf8');
  const want = new Set(KR.map(k => k.code));
  for (const m of xml.matchAll(/<list>\s*<corp_code>(\d+)<\/corp_code>\s*<corp_name>([^<]*)<\/corp_name>(?:\s*<corp_eng_name>[^<]*<\/corp_eng_name>)?\s*<stock_code>\s*(\d{6})?\s*<\/stock_code>/g)) {
    if (m[3] && want.has(m[3])) corp[m[3]] = m[1];
  }
  fs.writeFileSync(CC, JSON.stringify(corp) + '\n');
  fs.rmSync(zip, { force: true }); fs.rmSync(path.join(tmp, 'CORPCODE.xml'), { force: true });
  console.log('corp codes:', Object.keys(corp).length);
}

const RE = { rev: /^(매출액|영업수익|수익\(매출액\)|매출)$/, op: /^영업이익(\(손실\))?$/, np: /^당기순이익(\(손실\))?$|^분기순이익(\(손실\))?$|^반기순이익(\(손실\))?$/, npc: /지배기업(의)?\s*소유주(지분)?|지배주주/ };
async function fin(corpCode, year, reprt) {
  const u = `https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json?crtfc_key=${KEY}&corp_code=${corpCode}&bsns_year=${year}&reprt_code=${reprt}&fs_div=CFS`;
  const j = await (await fetch(u)).json();
  if (j.status !== '000') { if (process.env.DEBUG) { fs.mkdirSync(path.join(ROOT, 'data', 'debug'), { recursive: true }); fs.appendFileSync(path.join(ROOT, 'data', 'debug', 'dartfin.txt'), `${corpCode} ${year} ${reprt}: status ${j.status} ${j.message}\n`); } return null; }
  let rows = (j.list || []).filter(x => /^(IS|CIS)$/.test(x.sj_div));
  if (!rows.some(r => RE.rev.test(String(r.account_nm).replace(/\s/g, '')))) rows = (j.list || []).filter(x => /^(IS|CIS)$/.test(x.sj_div) || /매출|영업이익|순이익/.test(x.account_nm));
  if (process.env.DEBUG && !rows.some(r => RE.op.test(String(r.account_nm).replace(/\s/g, '')))) { fs.mkdirSync(path.join(ROOT, 'data', 'debug'), { recursive: true }); fs.appendFileSync(path.join(ROOT, 'data', 'debug', 'dartfin.txt'), `${corpCode} ${year} ${reprt}: ` + (j.list || []).slice(0, 80).map(x => `${x.sj_div}|${x.account_nm}|${x.account_id || ''}`).join(' ; ') + '\n'); }
  const IDS = { rev: /ifrs-full_Revenue$|ifrs_Revenue$/, op: /OperatingIncomeLoss$/, np: /ifrs-full_ProfitLoss$|ifrs_ProfitLoss$/, npc: /ProfitLossAttributableToOwnersOfParent$/ };
  const pick = (re, field, k) => { let x = rows.find(r => re.test(String(r.account_nm).replace(/\s/g, '')) && r[field] != null && r[field] !== ''); if (!x && k) x = (j.list || []).find(r => IDS[k].test(String(r.account_id || '')) && /^(IS|CIS)$/.test(r.sj_div) && r[field] != null && r[field] !== ''); return x ? num(x[field]) / 1e8 : null; };
  const cur = {}, cum = {};
  for (const [k, re] of Object.entries(RE)) { cur[k] = pick(re, 'thstrm_amount', k); cum[k] = pick(re, 'thstrm_add_amount', k); }
  if (cur.npc == null) { const x = rows.find(r => /지배기업|지배주주/.test(r.account_nm) && /순이익|순손익|이익/.test(r.account_nm)); if (x) { cur.npc = num(x.thstrm_amount) / 1e8; cum.npc = num(x.thstrm_add_amount) / 1e8; } }
  return { cur, cum };
}

const archive = fs.existsSync(QA) ? JSON.parse(fs.readFileSync(QA, 'utf8')) : {};
const summary = { generatedAt: new Date().toISOString(), companies: {}, failures: [] };
const thisYear = new Date().getFullYear();
for (const c of KR) {
  const cc = corp[c.code]; if (!cc) { summary.failures.push(`${c.code}: no corp_code`); continue; }
  const arch = (archive[c.code] = archive[c.code] || {});
  let got = 0;
  for (let y = thisYear - 2; y <= thisYear; y++) {
    const q1 = await fin(cc, y, '11013'); await sleep(120);
    const h1 = await fin(cc, y, '11012'); await sleep(120);
    const q3 = await fin(cc, y, '11014'); await sleep(120);
    const fy = await fin(cc, y, '11011'); await sleep(120);
    const put = (key, rec) => { if (rec.rev == null && rec.op == null) return; const o = arch[key] || {}; for (const k of ['rev', 'op', 'np', 'npc']) if (rec[k] != null) o[k] = Math.round(rec[k] * 10) / 10; if (o.rev && o.op != null) o.opm = Math.round(o.op / o.rev * 10000) / 100; o.src = 'dart'; arch[key] = o; got++; };
    if (q1) put(`${y}03`, q1.cur);
    if (h1) put(`${y}06`, h1.cur);
    if (q3) put(`${y}09`, q3.cur);
    if (fy && q3) { const d = {}; for (const k of ['rev', 'op', 'np', 'npc']) d[k] = fy.cur[k] != null && q3.cum[k] != null ? fy.cur[k] - q3.cum[k] : null; put(`${y}12`, d); }
  }
  summary.companies[c.code] = { name: c.name, quarters: Object.keys(arch).filter(k => arch[k].src === 'dart').sort() };
  console.log(`${c.name}: ${got} quarter records (${summary.companies[c.code].quarters.join(',')})`);
}
fs.writeFileSync(QA, JSON.stringify(archive) + '\n');
fs.writeFileSync(OUT, JSON.stringify(summary) + '\n');
console.log('dart fin done; failures', summary.failures);
