// 종목 뉴스 (Google News RSS) → data/news.json
import fs from 'node:fs';
import path from 'node:path';
import { KR } from './universe.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'data', 'news.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dec = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();

async function rss(q, n = 10) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ko&gl=KR&ceid=KR:ko`;
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (game-desk)' } });
  if (!r.ok) throw new Error(`rss ${q} HTTP ${r.status}`);
  const xml = await r.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
    const b = m[1]; const g = tag => { const x = b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)); return x ? dec(x[1]) : ''; };
    let title = g('title'); const src = g('source'); if (src && title.endsWith(' - ' + src)) title = title.slice(0, -(src.length + 3));
    return { title, link: g('link'), src, ts: new Date(g('pubDate')).toISOString() };
  }).filter(x => x.title && x.ts !== 'Invalid Date');
  return items.sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, n);
}

const out = { generatedAt: new Date().toISOString(), companies: {}, sector: [] };
const QUERY = { NAVER: '네이버 OR NAVER 실적 OR 네이버 주가', '카카오': '카카오 주가 OR 카카오 실적', 'LG CNS': 'LG CNS', '삼성에스디에스': '삼성SDS', 'NHN': 'NHN 주가 OR NHN 실적' };
for (const c of KR) {
  try { out.companies[c.code] = await rss(QUERY[c.name] || `"${c.name}"`, 8); } catch (e) { console.log(e.message); }
  await sleep(600);
}
for (const q of ['게임주', '인터넷 플랫폼 규제', '앱마켓 수수료', '게임 신작 출시']) {
  try { out.sector.push(...(await rss(q, 6)).map(x => ({ ...x, q }))); } catch (e) { console.log(e.message); }
  await sleep(600);
}
out.sector.sort((a, b) => b.ts.localeCompare(a.ts));
fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
console.log('news:', Object.values(out.companies).reduce((s, a) => s + a.length, 0), 'company items,', out.sector.length, 'sector items');
