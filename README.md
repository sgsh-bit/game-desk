# 게임 섹터 데스크

인터넷/게임 투자자용 대시보드 — Apple·Google Play·Steam 최고매출 순위, 관심 게임 워치리스트, 이벤트 캘린더.

- `index.html` — 사이트 (GitHub Pages)
- `data/charts.json` — 스토어 순위 (GitHub Actions가 매시 자동 갱신)
- `data/history/*.json` — 일별 순위 스냅샷 (전일 대비 변동 계산용, 45일 보관)
- `data/watchlist.json` — 워치리스트 (직접 편집: name / co / keys[앱 이름·패키지명·스팀 appid 부분일치])
- `data/events.json` — 이벤트 캘린더 (직접 편집: date / end / cat[launch·earnings·event·regulation·esports·other] / title / org / note / conf[확정·예상])
- `scripts/collect.mjs` — 수집 스크립트, `.github/workflows/collect.yml` — 스케줄

수동 실행: Actions 탭 → collect-charts → Run workflow

## 추가 탭 (2026-09-30)
- 수급 `data/market.json` ← `scripts/collect-market.mjs` (네이버증권 투자자별 매매동향 + 야후 밸류에이션), 평일 18:10 / 07:10 KST
- 밸류에이션·컨센서스: 국내 17종목 + 글로벌 피어 14 (`scripts/universe.mjs`에서 종목 편집)
- 산업데이터 `data/kosis.json` ← `scripts/collect-kosis.mjs` (KOSIS OpenAPI, Secret `KOSIS_API_KEY`), 매주 월 10:30 KST
- 스팀 동접·리뷰 `data/steam_ccu.json` ← `scripts/collect-steam-ccu.mjs`, 매시
- 뉴스 `data/news.json` ← Google News RSS, 3시간마다
- 리포트 `data/reports.json` ← 네이버 리서치(현대차증권 필터, `REPORT_BROKER` env로 변경 가능) + `data/reports_manual.json` 수동 등록
  - 수동 등록 형식: `[{"date":"2026-10-01","kind":"company","subject":"엔씨소프트","title":"...","url":"https://..."}]`
