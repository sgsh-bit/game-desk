// 매크로 티커 (지수·환율·금리) → data/macro.json
import fs from 'node:fs';
import path from 'node:path';
import YahooFinance from 'yahoo-finance2';

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = path.join(ROOT, 'data', 'macro.json');
const LIST = [
  { sym: '^KS11', name: 'KOSPI' }, { sym: '^KQ11', name: 'KOSDAQ' },
  { sym: '^GSPC', name: 'S&P500' }, { sym: '^IXIC', name: 'NASDAQ' }, { sym: '^SOX', name: '필라델피아 반도체' },
  { sym: '^N225', name: '닛케이225' }, { sym: '^HSI', name: '항셍' },
  { sym: 'KRW=X', name: 'USD/KRW' }, { sym: 'JPYKRW=X', name: 'JPY/KRW (1엔)', scale: 100, label: 'JPY/KRW (100엔)' }, { sym: 'CNYKRW=X', name: 'CNY/KRW' },
  { sym: '^TNX', name: '미국 10년물', unit: '%' },
];
const out = { generatedAt: new Date().toISOString(), items: [] };
const end = new Date(), start = new Date(end.getTime() - 45 * 86400000);
for (const m of LIST) {
  try {
    const q = await yf.quote(m.sym);
    let spark = [];
    try { const ch = await yf.chart(m.sym, { period1: start, period2: end, interval: '1d' }); spark = (ch.quotes || []).filter(x => x.close != null).map(x => x.close * (m.scale || 1)); } catch {}
    out.items.push({ sym: m.sym, name: m.label || m.name, unit: m.unit || '', price: q.regularMarketPrice != null ? q.regularMarketPrice * (m.scale || 1) : null, chgPct: q.regularMarketChangePercent ?? null, time: q.regularMarketTime ? new Date(q.regularMarketTime).toISOString() : null, spark: spark.slice(-30).map(v => Math.round(v * 100) / 100) });
  } catch (e) { console.log(`macro ${m.sym}: ${e.message}`); }
}
fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
console.log(`macro: ${out.items.length}/${LIST.length}`);
