// DART 공시 (OpenDART list.json) → data/dart.json. Needs env OPENDART_API_KEY (repo secret).
import fs from 'node:fs';
import path from 'node:path';
import { KR } from './universe.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'data', 'dart.json');
const KEY = process.env.OPENDART_API_KEY;
if (!KEY) { console.log('OPENDART_API_KEY not set — skipping'); process.exit(0); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const codes = new Map(KR.map(k => [k.code, k.name]));
const ymd = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).replace(/-/g, '');
const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { items: [] };
const days = prev.items?.length ? 4 : 45; // backfill on first run
const bgn = ymd(new Date(Date.now() - days * 86400000)), end = ymd(new Date());

// importance tagging (for highlight + filter)
const TAGS = [
  [/영업\(잠정\)실적|잠정실적|연결재무제표기준영업/, '실적'],
  [/자기주식|자사주/, '자사주'],
  [/현금ㆍ현물배당|현금배당|배당/, '배당'],
  [/유상증자|무상증자|전환사채|신주인수권|교환사채|감자/, '자본'],
  [/합병|분할|영업양수|영업양도|타법인주식및출자증권(취득|처분)|주식교환/, 'M&A'],
  [/최대주주|주식등의대량보유|임원ㆍ주요주주/, '지분'],
  [/단일판매|공급계약/, '계약'],
  [/기업설명회|IR/, 'IR'],
  [/소송|제재|횡령|배임/, '리스크'],
  [/분기보고서|반기보고서|사업보고서/, '정기'],
];
const tag = nm => (TAGS.find(([re]) => re.test(nm)) || [null, '기타'])[1];

const found = [];
for (const cls of ['Y', 'K']) {
  for (let page = 1; page <= 60; page++) {
    const u = `https://opendart.fss.or.kr/api/list.json?crtfc_key=${KEY}&bgn_de=${bgn}&end_de=${end}&corp_cls=${cls}&page_no=${page}&page_count=100`;
    const r = await fetch(u); const j = await r.json().catch(() => ({}));
    if (j.status !== '000') { if (j.status !== '013') console.log(`dart ${cls} p${page}: ${j.status} ${j.message}`); break; }
    for (const x of j.list || []) if (codes.has(x.stock_code)) found.push({ code: x.stock_code, name: codes.get(x.stock_code), title: x.report_nm.replace(/\s+/g, ' ').trim(), filer: x.flr_nm, date: `${x.rcept_dt.slice(0, 4)}-${x.rcept_dt.slice(4, 6)}-${x.rcept_dt.slice(6)}`, rcp: x.rcept_no, rm: x.rm || '', tag: tag(x.report_nm) });
    if (page >= (j.total_page || 1)) break;
    await sleep(150);
  }
}
const merged = new Map((prev.items || []).map(x => [x.rcp, x]));
for (const x of found) merged.set(x.rcp, x);
const items = [...merged.values()].sort((a, b) => b.rcp.localeCompare(a.rcp)).slice(0, 400);
fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), items }) + '\n');
console.log(`dart: +${found.length} new window rows, total ${items.length}`);
