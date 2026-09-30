// data/fnguide/*.xlsx|*.csv (템플릿 형식) → data/fn.json + data/history/quarters.json 병합
import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const DIR = path.join(ROOT, 'data', 'fnguide');
const OUT = path.join(ROOT, 'data', 'fn.json');
const QA = path.join(ROOT, 'data', 'history', 'quarters.json');
const num = v => { if (v == null || v === '') return null; const n = parseFloat(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
const str = v => v == null ? '' : String(v).trim();
const code6 = v => str(v).replace(/^A/i, '').padStart(6, '0');
const dateS = v => { if (v instanceof Date) return v.toISOString().slice(0, 10); const s = str(v).replace(/\./g, '-').replace(/\//g, '-'); const m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : s; };
const period = v => { const s = str(v); const m = s.match(/^(\d{4})[.\-/]?(\d{2})?/); if (!m) return s; return m[2] ? `${m[1]}.${m[2]}` : m[1]; };

const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter(f => /\.(xlsx|xlsm|csv)$/i.test(f) && !f.startsWith('~$')) : [];
if (!files.length) { console.log('no fnguide files'); process.exit(0); }
const fn = { generatedAt: new Date().toISOString(), files, consensus: {}, quarterly: {}, target: {}, peers: {} };
for (const f of files) {
  const wb = XLSX.readFile(path.join(DIR, f), { cellDates: true });
  const rows = name => { const ws = wb.Sheets[name] || wb.Sheets[Object.keys(wb.Sheets).find(n => n.toLowerCase().startsWith(name)) || '']; return ws ? XLSX.utils.sheet_to_json(ws, { defval: null }) : []; };
  for (const r of rows('consensus')) { const c = code6(r.code), p = period(r.period), m = str(r.metric).toLowerCase(), d = dateS(r.as_of); if (!c || !p || !m || !d) continue; ((fn.consensus[c] = fn.consensus[c] || {})[p] = fn.consensus[c][p] || {})[m] = { ...(fn.consensus[c][p][m] || {}), [d]: num(r.value) }; if (r.n_est != null) fn.consensus[c][p].n = num(r.n_est); }
  for (const r of rows('quarterly')) { const c = code6(r.code), p = period(r.period); if (!c || !p) continue; (fn.quarterly[c] = fn.quarterly[c] || {})[p] = { rev: num(r.rev), op: num(r.op), np: num(r.np), npc: num(r.npc), opm: num(r.opm) }; }
  for (const r of rows('target')) { const c = code6(r.code), d = dateS(r.as_of); if (!c || !d) continue; (fn.target[c] = fn.target[c] || {})[d] = { target: num(r.target), rating: num(r.rating), n: num(r.n_analysts), eps1: num(r.eps_fy1), eps2: num(r.eps_fy2) }; }
  for (const r of rows('peers')) { const s = str(r.symbol), d = dateS(r.as_of); if (!s || !d) continue; (fn.peers[s] = fn.peers[s] || {})[d] = { fpe: num(r.fwd_pe), evEbitda: num(r.ev_ebitda), target: num(r.target), rating: num(r.rating), ccy: str(r.ccy), name: str(r.name) }; }
}
// quarterly → archive (FnGuide 값 우선: src='fn')
const archive = fs.existsSync(QA) ? JSON.parse(fs.readFileSync(QA, 'utf8')) : {};
let qn = 0;
for (const [c, per] of Object.entries(fn.quarterly)) for (const [p, v] of Object.entries(per)) {
  const key = p.replace('.', ''); if (!/^\d{6}$/.test(key)) continue;
  const o = archive[c] = archive[c] || {}; o[key] = { ...(o[key] || {}), ...Object.fromEntries(Object.entries(v).filter(([, x]) => x != null)), src: 'fn' };
  if (o[key].rev && o[key].op != null && o[key].opm == null) o[key].opm = Math.round(o[key].op / o[key].rev * 10000) / 100; qn++;
}
fs.writeFileSync(QA, JSON.stringify(archive) + '\n');
fs.writeFileSync(OUT, JSON.stringify(fn) + '\n');
console.log(`fnguide ingest: files=${files.length} consensus=${Object.keys(fn.consensus).length} quarterly=${qn} target=${Object.keys(fn.target).length} peers=${Object.keys(fn.peers).length}`);
