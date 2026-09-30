// data/events.json → data/events.ics (구독 가능한 캘린더 피드)
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const ev = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'events.json'), 'utf8'));
const CAT = { launch: '신작', earnings: '실적', event: '행사', regulation: '규제', esports: 'e스포츠', other: '기타' };
const esc = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const ymd = s => s.replace(/-/g, '');
const addDay = s => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//game-desk//KR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:게임 섹터 데스크 이벤트', 'X-WR-TIMEZONE:Asia/Seoul', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H'];
for (const e of ev) {
  if (!e.date || !e.title) continue;
  const end = addDay(e.end && e.end >= e.date ? e.end : e.date);
  lines.push('BEGIN:VEVENT', `UID:${e.id || ymd(e.date) + '-' + Buffer.from(e.title).toString('base64').slice(0, 12)}@game-desk`, `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${ymd(e.date)}`, `DTEND;VALUE=DATE:${ymd(end)}`,
    `SUMMARY:${esc(`[${CAT[e.cat] || e.cat}] ${e.title}${e.conf === '예상' ? ' (예상)' : ''}`)}`,
    `DESCRIPTION:${esc([e.org, e.note, e.conf ? '확정여부: ' + e.conf : ''].filter(Boolean).join('\n'))}`,
    `CATEGORIES:${esc(CAT[e.cat] || e.cat)}`, 'END:VEVENT');
}
lines.push('END:VCALENDAR');
fs.writeFileSync(path.join(ROOT, 'data', 'events.ics'), lines.join('\r\n') + '\r\n');
console.log('ics:', ev.length, 'events');
