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
- 실적 `data/earnings.json` ← 네이버증권 분기/연간 재무(FnGuide 컨센서스 E 포함), 평일 18:10
- 공시 `data/dart.json` ← OpenDART (Secret `OPENDART_API_KEY`), 매시
- 매크로 `data/macro.json` ← 지수·환율·금리 (야후), 매시
- 브리핑 탭: 수급·순위 변동·일정·실적 임박·공시·리포트·동접을 한 화면 + 텔레그램 복사 (클라이언트 계산, 별도 수집 없음)
- 캘린더 구독: `data/events.ics` (Outlook/Google "URL로 구독")
- 히스토리: `data/history/valuation.json`(목표가·추정PER 일별), `data/history/consensus.json`(분기 OP 컨센 일별) → 1M 변화 컬럼
- 워치리스트 "내 게임 추가": 보는 사람 브라우저(localStorage)에만 저장
- 종목 카드 탭: 주가·수급·밸류·실적·뉴스·공시·리포트·관련 게임 순위를 종목별 한 화면 (수급/밸류/실적 표의 종목명 클릭)
- 실적 탭: 요약(발표 임박순) + 종목별 분기/연간 재무 상세(매출·OP·OPM·순이익·EPS·ROE·DPS) + 차트; `data/history/quarters.json`에 확정 분기 누적(분기 YoY용)
- 분기 백필: `scripts/collect-dart-fin.mjs` — OpenDART 재무제표 API(연결, 1Q/반기/3Q/사업보고서에서 분기 분해) → `data/history/quarters.json`. 네이버(FnGuide)와 겹치는 분기는 네이버 값 우선
- 당사 추정치: `data/estimates.json` (code → "YYYY.MM" 분기 / "YYYY" 연간 → {rev, op, np} 억원). 사이트 실적 탭 "당사 추정치 입력" → "JSON 복사" 결과를 이 파일에 붙여넣고 커밋하면 전체 공개
- FnGuide/QuantiWise 반입: `template/fnguide_template.xlsx` 형식으로 채운 파일을 `data/fnguide/`에 올리면 `ingest-fnguide` 워크플로가 `data/fn.json`·분기 아카이브에 병합 → 실적 탭/종목 카드에 컨센서스 변화·목표주가 추이 표시. `data/config.json`의 `licensedPublic:false`면 숨김
