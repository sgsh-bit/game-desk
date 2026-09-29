# 게임 섹터 데스크

인터넷/게임 투자자용 대시보드 — Apple·Google Play·Steam 최고매출 순위, 관심 게임 워치리스트, 이벤트 캘린더.

- `index.html` — 사이트 (GitHub Pages)
- `data/charts.json` — 스토어 순위 (GitHub Actions가 매시 자동 갱신)
- `data/history/*.json` — 일별 순위 스냅샷 (전일 대비 변동 계산용, 45일 보관)
- `data/watchlist.json` — 워치리스트 (직접 편집: name / co / keys[앱 이름·패키지명·스팀 appid 부분일치])
- `data/events.json` — 이벤트 캘린더 (직접 편집: date / end / cat[launch·earnings·event·regulation·esports·other] / title / org / note / conf[확정·예상])
- `scripts/collect.mjs` — 수집 스크립트, `.github/workflows/collect.yml` — 스케줄

수동 실행: Actions 탭 → collect-charts → Run workflow
