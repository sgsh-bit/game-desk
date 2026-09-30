// KOSIS (통계청) 온라인쇼핑동향 → data/kosis.json. Needs env KOSIS_API_KEY (repo secret).
// Tries candidate tables and keeps whatever responds; logs table names so the ids can be pinned later.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'data', 'kosis.json');
const KEY = process.env.KOSIS_API_KEY;
if (!KEY) { console.log('KOSIS_API_KEY not set — skipping'); process.exit(0); }

// candidate tables (orgId 101 = 통계청). Names are checked at runtime; the first matching one wins.
const CANDIDATES = [
  { tblId: 'DT_1KE10081', want: /상품군별.*판매매체별|판매매체별.*상품군별/ },
  { tblId: 'DT_1KE10051', want: /상품군별|판매매체별/ },
  { tblId: 'DT_1KE10091', want: /상품군별|판매매체별/ },
  { tblId: 'DT_1KE10071', want: /상품군별|판매매체별/ },
];
async function fetchTable(tblId, months = 30) {
  const u = new URL('https://kosis.kr/openapi/Param/statisticsParameterData.do');
  Object.entries({ method: 'getList', apiKey: KEY, itmId: 'ALL', objL1: 'ALL', objL2: 'ALL', objL3: '', objL4: '', objL5: '', objL6: '', objL7: '', objL8: '', format: 'json', jsonVD: 'Y', prdSe: 'M', newEstPrdCnt: String(months), orgId: '101', tblId }).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u); const txt = await r.text();
  let j; try { j = JSON.parse(txt); } catch { throw new Error(`${tblId}: non-JSON ${txt.slice(0, 120)}`); }
  if (!Array.isArray(j)) throw new Error(`${tblId}: ${JSON.stringify(j).slice(0, 160)}`);
  return j;
}

let rows = null, used = null;
for (const c of CANDIDATES) {
  try {
    const j = await fetchTable(c.tblId);
    const name = j[0]?.TBL_NM || '';
    console.log(`${c.tblId}: ${j.length} rows — ${name}`);
    if (j.length && c.want.test(name)) { rows = j; used = { tblId: c.tblId, name }; break; }
    if (j.length && !rows) { rows = j; used = { tblId: c.tblId, name }; }
  } catch (e) { console.log(String(e.message)); }
}
if (!rows) { console.log('no KOSIS table responded'); process.exit(0); }

// Normalise: series keyed by "C1_NM|C2_NM|ITM_NM" → [[YYYY-MM, value]]
const series = {};
for (const r of rows) {
  const key = [r.C1_NM, r.C2_NM, r.ITM_NM].filter(Boolean).join('|');
  const prd = r.PRD_DE?.length === 6 ? `${r.PRD_DE.slice(0, 4)}-${r.PRD_DE.slice(4)}` : r.PRD_DE;
  const v = parseFloat(String(r.DT).replace(/,/g, ''));
  if (!Number.isFinite(v)) continue;
  (series[key] = series[key] || { unit: r.UNIT_NM || '', c1: r.C1_NM, c2: r.C2_NM, itm: r.ITM_NM, points: [] }).points.push([prd, v]);
}
for (const s of Object.values(series)) s.points.sort((a, b) => a[0].localeCompare(b[0]));
const out = { generatedAt: new Date().toISOString(), table: used, seriesCount: Object.keys(series).length, series };
fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
console.log(`kosis: ${used.tblId} ${used.name} — ${Object.keys(series).length} series`);
