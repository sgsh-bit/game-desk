// Steam concurrent players (official ISteamUserStats endpoint, no key) → data/steam_ccu.json
import fs from 'node:fs';
import path from 'node:path';
import { STEAM_APPS } from './universe.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'data', 'steam_ccu.json');
const KEEP_HOURS = 24 * 30;
const data = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { series: {} };
data.apps = STEAM_APPS;
data.series = data.series || {};
const t = Math.floor(Date.now() / 60000); // epoch minutes
let ok = 0;
for (const a of STEAM_APPS) {
  try {
    const r = await fetch(`https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${a.appid}`);
    const j = await r.json();
    const n = j?.response?.player_count;
    if (typeof n !== 'number') throw new Error('no player_count (result ' + j?.response?.result + ')');
    const s = data.series[a.appid] = data.series[a.appid] || [];
    s.push([t, n]);
    while (s.length > KEEP_HOURS) s.shift();
    ok++;
  } catch (e) { console.log(`ccu ${a.appid} ${a.name}: ${e.message}`); }
  await new Promise(r => setTimeout(r, 250));
}
// reviews (all-time + last 30 days) — refresh at most every 6h
data.reviews = data.reviews || {};
const stale = !data.reviewsAt || (Date.now() - new Date(data.reviewsAt).getTime()) > 6 * 3600e3;
if (stale) {
  for (const a of STEAM_APPS) {
    try {
      const q = async (extra) => { const r = await fetch(`https://store.steampowered.com/appreviews/${a.appid}?json=1&language=all&purchase_type=all&num_per_page=0${extra}`); const j = await r.json(); return j.query_summary || {}; };
      const all = await q(''); const m30 = await q('&filter=all&day_range=30');
      data.reviews[a.appid] = { total: all.total_reviews ?? null, pos: all.total_positive ?? null, pct: all.total_reviews ? Math.round(all.total_positive / all.total_reviews * 1000) / 10 : null, desc: all.review_score_desc || '',
        total30: m30.total_reviews ?? null, pct30: m30.total_reviews ? Math.round(m30.total_positive / m30.total_reviews * 1000) / 10 : null };
    } catch (e) { console.log(`reviews ${a.appid}: ${e.message}`); }
    await new Promise(r => setTimeout(r, 300));
  }
  data.reviewsAt = new Date().toISOString();
}
data.generatedAt = new Date().toISOString();
fs.writeFileSync(OUT, JSON.stringify(data) + '\n');
console.log(`steam ccu: ${ok}/${STEAM_APPS.length} ok`);
