# TWIN PRO 소스 · 서버 SQL · 자동 테스트

저장소 루트의 `index.html`(시연 화면)은 이 폴더의 소스를 빌드한 결과물입니다. 이 폴더에는 화면 소스, Supabase(Postgres) 서버 SQL, 그리고 외부 서버 없이 돌아가는 자동 테스트가 들어 있습니다. 시연 화면 사용법과 서버 설치 순서는 [저장소 README](../README.md)에 있습니다.

| 항목 | 값 |
|---|---|
| 화면 | JavaScript(프레임워크 없음) 13개 모듈 + CSS, Three.js 0.160(3D) |
| 서버 | Supabase: Postgres 테이블 33 · 뷰 3 · 서버 함수 51, Row Level Security, Realtime, Edge Function 1개 |
| 테스트 | 화면 자동 테스트 182개(실제 브라우저 클릭 + 로컬 Postgres) · 연결 프로그램 테스트 4개(가상 PLC) |
| 자동 실행 | GitHub Actions: 소스가 바뀌면 빌드 → 테스트를 돌립니다(`.github/workflows/test.yml`) |

## 1. 폴더 구성

| 경로 | 내용 |
|---|---|
| `src/model.js` | 화면 계산: KPI, 공정 상태, 우선순위(온톨로지 관계), 설비 가동 시간. 서버 SQL과 같은 정의라 테스트가 두 결과를 비교합니다 |
| `src/api.js` | 서버 연결: 테이블 읽기, 서버 함수(RPC) 호출, 실시간 구독, 시연 코드 처리 |
| `src/ui.js` | 화면 그리기와 버튼 동작(관제 · 설비 · 생산 · 작업 관리 · 기준정보), 휴대폰 화면 제한 |
| `src/pics.js` · `src/io.js` · `src/live.js` | 관리 화면 [그림] 보기, 현장 데이터 수집 연결(Modbus · ETOS), 운영 추이(1분 = 1일 연출) |
| `src/aic.js` | AI 운영 센터: 회사별 모델 비교, 상대평가 종합 점수, 가상 예시 표시 |
| `src/t3d.js` · `src/t3x.js` · `src/sim3d.js` · `src/block3d.js` · `src/plate3d.js` | 3D 조선소, 3D 관제 연출, 공정 교육 재생, 블록 내부 3D |
| `src/motion.js` · `src/style.css` | 숫자 · 화면 전환 움직임, 전체 스타일 |
| `sql/01_schema.sql` ~ `sql/25_ai_bench_example.sql` | 서버 SQL. 번호 순서대로 실행합니다. 짝수 `_security` 파일은 권한(RLS · 실행 권한) 설정입니다 |
| `sql/make_seed.py` | 과제 엑셀(15개 시트)을 `03_seed.sql`로 바꾸는 스크립트. 원본 엑셀은 이 저장소에 없고, 변환 결과인 `03_seed.sql`만 있습니다 |
| `lib_local.js` | 테스트용 서버: PGlite(브라우저 · Node에서 도는 Postgres)에 위 SQL을 그대로 올려 Supabase 대신 씁니다 |
| `e2e.js` | 화면 자동 테스트 182개 |
| `build.py` | 소스 + 그림 자료 → `dist/twinpro.html`(시연용), `dist/twinpro_test.html`(테스트용) |
| `figures/` | 사건 설명도 3개(설비 고장 · 자재 대기 · 품질 보류) |
| `assets/` | 설비 그림, 예시 사진(AI 생성), 공정 썸네일(Blender 렌더), 아이콘 |
| `vendor/anatomy/` | 설명도 스타일 키트(MIT 라이선스) |
| `data.json` | 테스트가 화면 숫자와 비교하는 원본 데이터(엑셀을 JSON으로 바꾼 것) |
| `../tools/io_bridge/` | 현장 연결 프로그램(Python, 설치 불필요)과 테스트 `test_bridge.js` |

## 2. 처음 실행하는 방법

준비물: Node.js 20 이상, Python 3.10 이상, 인터넷 연결(처음 설치할 때만).

1. 이 폴더로 이동합니다.
   ```bash
   cd app
   ```
2. 라이브러리를 설치합니다. Postgres(PGlite), 브라우저 자동화(Playwright), Three.js가 설치됩니다.
   ```bash
   npm ci
   npx playwright install chromium
   ```
3. 설정 파일을 만듭니다. 예시 파일을 복사하면 됩니다. 테스트용 시연 코드는 `local-test`이고, `sql/03_seed.sql`에 이 코드의 해시가 들어 있습니다.
   ```bash
   cp config.example.json config.json
   ```
4. 화면을 빌드합니다. `built 2142…`처럼 파일 크기가 나오면 성공입니다.
   ```bash
   python3 build.py
   ```
5. 자동 테스트를 돌립니다. 약 8~10분 걸리고, 마지막 줄에 `182/182 PASS`가 나오면 성공입니다. 실패가 하나라도 있으면 종료 코드 1로 끝납니다. 화면 캡처는 `shots/`, 결과는 `e2e_result.json`에 남습니다.
   ```bash
   node e2e.js
   ```
6. 연결 프로그램 테스트는 저장소 루트에서 돌립니다. `4/4 PASS`가 나오면 성공입니다.
   ```bash
   cd ..
   node tools/io_bridge/test_bridge.js
   ```

**실제 Supabase 서버에 붙여 보려면:** `config.json`의 `url` · `anon`에 Supabase 프로젝트 주소와 공개(anon) 키를 넣고 다시 빌드합니다. 서버에는 `sql/` 파일을 번호 순서대로 실행합니다(저장소 루트의 `supabase_setup.sql` + `supabase_1101_all.sql`과 같은 내용). `dist/twinpro.html`을 저장소 루트의 `twinpro_shipyard.glb`와 같은 폴더에 두고, 파일을 바로 열지 말고 `python3 -m http.server`처럼 웹 서버로 엽니다(3D 모델을 읽어야 해서).

## 3. 작동 원리

```
[브라우저: twinpro.html]                         [Supabase]
  처음 열 때 tp_ 테이블 읽기(SELECT)   ──────▶  Postgres (RLS: 화면은 읽기만)
  버튼 = 서버 함수 호출(RPC)           ──────▶  서버 함수가 규칙을 검사하고 저장
  다른 화면의 변경 받기                ◀──────  Realtime(테이블 변경 알림)
  AI 요약 · 모델 비교                  ──────▶  Edge Function → 회사별 AI API(키는 서버 비밀값)
```

- **판단은 서버, 표시는 화면**: 작업 저장, 설비 변경, 사건 처리 같은 쓰기는 모두 서버 함수가 규칙을 검사한 뒤 저장합니다. 화면이 테이블에 직접 쓰는 권한은 없습니다.
- **AI는 문장만**: 우선순위와 판단은 서버 SQL(`tp_priority()`)이 계산하고, AI는 그 결과를 문장으로 옮깁니다. AI 답은 자동 채점(필수 사실 · 지어낸 ID · 형식)으로 검사합니다.
- **화면과 서버가 같은 식**: 우선순위, 운영 추이 같은 계산은 화면(`src/model.js`, `src/live.js`)과 서버 SQL에 같은 정의로 있고, 테스트가 두 결과가 같은지 확인합니다. 서버 확장 SQL이 아직 없는 서버에서도 화면이 동작하는 이유입니다.
- **테스트에 외부 서버가 필요 없음**: `lib_local.js`가 PGlite에 실제와 같은 SQL을 올려 Supabase 역할을 하고, Playwright가 테스트용 화면을 실제 브라우저로 클릭합니다. 그래서 GitHub Actions에서도 그대로 돌아갑니다. AI 호출은 테스트에서 사실로 만든 고정 문장과 고정 지연으로 대신합니다.
- **시연 코드**: 서버에는 코드의 SHA-256 해시만 저장하고, 쓰기 함수마다 코드를 확인합니다. 이 저장소의 시드에는 테스트용 코드 `local-test`의 해시만 있습니다.

## 4. 데이터 모델

| 묶음 | 테이블 |
|---|---|
| 기준정보(엑셀 원본) | `tp_vessels` 선박 · `tp_zones` 작업구역 · `tp_processes` 공정 6단계 · `tp_equipment` 설비 · `tp_blocks` 블록 12개 · `tp_status_codes` 상태 코드 · `tp_equipment_snapshot` |
| 작업 · 실적 | `tp_work_orders` 작업지시 · `tp_production_plan` 계획 · `tp_production_actual` 실적 · `tp_equipment_intervals` 설비 상태 구간 · `tp_work_history` · `tp_inspections` 검사 · `tp_rework` 재작업 |
| 사건 처리 | `tp_incidents` 사건 · `tp_incident_actions` 조치 기록 · `tp_incident_steps` 처리 단계 · `tp_equipment_fit` 대체 적합성 |
| 시연 운영 | `tp_sim_clock` 가상 시각 · `tp_sim_lock` 재생 잠금 · `tp_event_log` 기록 · `tp_config` · `tp_seed`(초기화용 원본) |
| 현장 연결 · 추이 | `tp_signal_log` 설비 신호 · `tp_io_point` 수집 포인트 · `tp_daily` 일 집계 · `tp_live_signal` 당일 데이터 |
| AI | `tp_ai_summary` · `tp_ai_priority` 요약 · `tp_ai_usage` 사용 횟수 · `tp_ai_model` 비교 모델 · `tp_ai_bench` · `tp_ai_bench_run` 비교 기록 |

뷰: `tp_v_kpi`(지표), `tp_v_occupancy`(설비 점유), `tp_v_ontology`(테이블을 (주어, 관계, 목적어)로 펼친 관계 그래프. 우선순위 계산의 입력).

서버 함수 51개 중 화면이 부르는 쓰기 함수는 작업 저장(`tp_save_work_order`), 사건 처리 단계(`tp_incident_step`), 설비 신호 입구(`tp_ingest_signal`), 설비 추가 · 사용 중지 · 삭제, 가상 시각 진행, 초기화 등입니다. 규칙별 설명은 [저장소 README 4장](../README.md#4-작동-원리)에 있습니다.

## 5. 자동 테스트가 확인하는 것

| 영역 | 예 |
|---|---|
| 관제 | 첫 화면 KPI(진행률 74% · 멈춘 작업 3 · 미해결 사건 3 · 설비 가동 2/8)가 원본 데이터와 같음, 사이드바 · 휴대폰 화면 |
| 서버 규칙 | 고장 설비 가동 신호 거부, 고장 신호 → 사건 생성 + 작업 보류, 조치 기록 없으면 해소 불가, 점검 설비 배정 불가(한 트랜잭션 취소), 계획수량 초과 거부, 같은 요청 동시 2건 중 1건만 성공, 시연 코드 없거나 틀리면 거부 |
| 사건 처리 | 처리 단계가 순서대로만 진행, 처리 후 지표 변화(미해결 3 → 2, 설비 가동 2 → 3), 체험 모드는 서버에 저장 안 됨 |
| 우선순위 | 화면 순서 = 서버 `tp_priority()` 순서, 1순위 근거 관계 |
| 실적 가져오기 | CSV 정상 · 오류 · 알 수 없는 작업 처리, 전체 취소 |
| 3D | 3D 조선소 · 블록 내부(부재 72 · 세트 8) · 공정 교육 재생 표시 |
| AI | 하루 10회 제한, 모델 비교 자동 채점 · 비용 · 하루 3회차 제한 |
| 설비 붙이기 / 없애기 | 추가 → 화면 5곳 반영, 주소 중복 거부, 가동 중 사용 중지 거부, 초기화 후 원본 8대 |
| 공통 | 콘솔 오류 0건, 폭 400px에서 가로 스크롤 없음 |

## 6. 공개 범위

- 시연 서버의 실제 시연 코드, 원본 엑셀 파일, AI API 키는 이 저장소에 없습니다. 키는 Supabase 비밀값에만 있습니다.
- `sql/03_seed.sql`의 시연 코드 해시는 테스트용 코드 `local-test`의 해시로 바꿔 올렸습니다.
- 설비 IP(192.168.x.x)와 수집 포인트는 시연용 가상 기준정보입니다.

## 7. 개발 방식

2026 울산 청년 AX 리더십 프로젝트 팀 TWIN PRO 과제입니다. 요구사항 분석 · 화면 설계 · 서버 규칙 설계 · 검증 기준은 김도엽이 정했고, 구현은 AI(Claude)와 함께 진행했습니다. 모든 변경은 위 자동 테스트를 통과한 뒤 반영했습니다.
