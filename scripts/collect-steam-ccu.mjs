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
data.generatedAt = new Date().toISOString();
fs.writeFileSync(OUT, JSON.stringify(data) + '\n');
console.log(`steam ccu: ${ok}/${STEAM_APPS.length} ok`);
