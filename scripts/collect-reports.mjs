// 현대차증권 인터넷/게임 리포트 — 네이버증권 리서치 목록에서 수집 + data/reports_manual.json 병합 → data/reports.json
import fs from 'node:fs';
import path from 'node:path';
import { KR } from './universe.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'data', 'reports.json');
const MANUAL = path.join(ROOT, 'data', 'reports_manual.json');
const DBG = path.join(ROOT, 'data', 'debug');
const BROKER = process.env.REPORT_BROKER || '현대차증권';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HDR = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36', 'accept-language': 'ko-KR,ko;q=0.9', accept: 'text/html,application/xhtml+xml', referer: 'https://finance.naver.com/research/' };
const strip = s => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const names = KR.map(k => k.name);
const KEYS = /게임|인터넷|플랫폼|소프트웨어|미디어|엔터|IT서비스|콘텐츠|광고|커머스|AI|클라우드/;

async function page(kind, p) {
  const url = `https://finance.naver.com/research/${kind}_list.naver?page=${p}`;
  const r = await fetch(url, { headers: HDR });
  if (!r.ok) throw new Error(`${kind} p${p} HTTP ${r.status}`);
  const html = new TextDecoder('euc-kr').decode(await r.arrayBuffer());
  const rows = [];
  for (const tr of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || []) {
    const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1]);
    if (tds.length < 4) continue;
    const links = [...tr.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
    const pdf = links.find(l => /\.pdf/i.test(l)) || null;
    const view = links.find(l => /_read\.naver|read\.naver/.test(l)) || null;
    const cells = tds.map(strip);
    const date = cells.find(c => /^\d{2}\.\d{2}\.\d{2}$/.test(c));
    if (!date) continue;
    let subject = '', title = '', broker = '';
    if (kind === 'company') { [subject, title, broker] = cells; } else { [subject, title, broker] = cells; }
    rows.push({ kind, subject, title, broker, date: '20' + date.replace(/\./g, '-'), pdf, view: view ? (view.startsWith('http') ? view : 'https://finance.naver.com/research/' + view.replace(/^\/?research\//, '')) : null });
  }
  if (!rows.length) { fs.mkdirSync(DBG, { recursive: true }); fs.writeFileSync(path.join(DBG, `research_${kind}_${p}.html`), html.slice(0, 60000)); }
  return rows;
}

const found = [];
for (const kind of ['company', 'industry', 'invest']) {
  for (let p = 1; p <= 6; p++) {
    try { const rows = await page(kind, p); found.push(...rows); if (!rows.length) break; } catch (e) { console.log(e.message); break; }
    await sleep(500);
  }
}
const mine = found.filter(r => r.broker.includes(BROKER) && (r.kind !== 'company' ? KEYS.test(r.subject + ' ' + r.title) : names.some(n => r.subject.includes(n) || r.title.includes(n)) || KEYS.test(r.title)));
console.log(`research rows: ${found.length}, ${BROKER} relevant: ${mine.length}`);
const manual = fs.existsSync(MANUAL) ? JSON.parse(fs.readFileSync(MANUAL, 'utf8')) : [];
const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')).items || [] : [];
const key = r => `${r.date}|${r.title}`;
const merged = new Map();
for (const r of [...prev, ...mine, ...manual.map(m => ({ ...m, manual: true }))]) merged.set(key(r), { ...(merged.get(key(r)) || {}), ...r });
const items = [...merged.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 200);
fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), broker: BROKER, items }) + '\n');
console.log('reports total:', items.length);
