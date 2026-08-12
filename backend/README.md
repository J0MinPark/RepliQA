# RepliQA Backend

멀티테넌트 B2B SaaS 구조로 재구성된 백엔드. API 서버(요청/인증/큐 등록)와 Worker(Playwright + Vision LLM 실행)가 분리되어 있다.

## 아키텍처

```
frontend (Firebase Auth) → API 서버(src/api) → Firestore(testRuns status=queued)
                                                        ↓ 트랜잭션 claim
                                                  Worker(src/worker)
                                                        ↓
                              engine(capture→Gemini Vision planner→executor) → Storage(스크린샷)
```

## 로컬 개발 준비

```bash
npm install
npx playwright install chromium
npx camoufox-js fetch          # 결제 체크포인트용 스텔스 브라우저 바이너리 (~500MB)
npm install -g firebase-tools   # 아직 없다면

cp .env.example .env   # GEMINI_API_KEY, CREDENTIAL_ENCRYPTION_KEY 채우기
# CREDENTIAL_ENCRYPTION_KEY는 `openssl rand -base64 32`로 생성
```

## 실행 순서

```bash
# 1) Firebase 에뮬레이터 (프로젝트 루트에서)
firebase emulators:start

# 2) 페르소나 시드 (최초 1회, 에뮬레이터가 떠 있는 상태에서)
npm run seed:personas

# 3) API 서버
npm run start:api

# 4) Worker (별도 터미널)
npm run start:worker
```

## API 요약

- `POST /api/tenants/bootstrap` — 로그인 직후 1회 호출, 테넌트 생성 + tenantId 클레임 부여
- `POST /api/urls` — 테스트 대상 URL 등록 (아직 미검증 상태로 생성됨)
- `POST /api/urls/:id/verify` — `.well-known/repliqa-verify-<token>.txt` 파일로 소유권 검증
- `PUT /api/urls/:id/test-credentials` — 테스트 전용 계정 자격증명 등록(암호화 저장, 실 사용자 계정 금지)
- `PUT /api/urls/:id/test-payment-method` — 결제 체크포인트용 테스트 카드/계좌 정보 등록(암호화 저장). 반드시 PG 테스트/샌드박스 모드용 값만 등록
- `POST /api/routes` / `GET /api/routes?registeredUrlId=` — 여정(체크포인트 목록) 생성/조회. 체크포인트는 자연어 한 줄 = 한 단계, 줄 맨 앞에 `[결제]`를 붙이면 결제 전용 체크포인트로 처리됨
- `GET /api/personas` — 사용 가능한 페르소나 목록
- `POST /api/test-runs` — 테스트 실행 큐 등록 (검증된 URL만 가능, 쿼터 체크). `routeId`를 넘기면 그 여정을 순서대로 따라가며 각 체크포인트에서 기능 에러 + UI/UX 평가를 함께 수행하고, 생략하면 기존처럼 자유 탐색으로 실행
- `GET /api/test-runs/:id` — 실행 상태/결과 조회 (실시간 갱신은 프론트에서 Firestore `onSnapshot` 사용 권장)
- `GET /api/usage/today` — 오늘 사용량 + 쿼터

## 여정 & UI/UX 평가

- 체크포인트 목표 없이(자유 탐색) 실행하던 기존 방식은 여전히 지원됨 — `routeId`를 안 넘기면 자동으로 목표 없는 체크포인트 1개로 흘러감.
- 각 체크포인트 진입 시 1회, `backend/src/engine/uiuxChecks.js`(WCAG 명암비·터치 타겟 크기·가로 스크롤·alt 누락 등 결정론적 계산)와 `geminiAdapter.evaluateUiUx()`(Toss/Google Material/Kakao·Naver 공개 디자인 원칙 기반 체크리스트 — `backend/src/engine/uiuxChecklist.js`)를 함께 실행해 기능 에러와 별개로 UI/UX 이슈를 리포트에 남김.

## 결제 체크포인트

- 여정 체크포인트 줄 앞에 `[결제]`를 붙이면 그 단계는 `type: 'payment'`로 저장되고, 진입 시 등록된 테스트 카드 정보를 자동으로 입력함(`runEngine.js`의 `attemptPaymentFill` — 로그인과 동일하게 LLM에는 실제 카드값을 넘기지 않고 필드 위치만 물어봄).
- **안전핀**: "결제하기/구매확정" 류 최종 제출 버튼(`backend/src/engine/paymentSafety.js`의 키워드 목록)은 결제 체크포인트에서 절대 자동 클릭하지 않는다. 그 지점에 도달한 것 자체를 체크포인트 성공으로 기록하고 멈춘다 — 실제 결제·부정거래 탐지 위험을 원천 차단하기 위함.
- PG 위젯이 팝업이나 iframe으로 뜨는 경우를 지원함: `capture.js`가 iframe 내부 요소도 좌표를 페이지 좌표계로 변환해서 함께 수집하고, 결제 체크포인트 동안은 팝업이 열리면 이후 캡처/실행 대상이 자동으로 그 팝업으로 전환됨.
- 카드사/은행 선택 같은 `<select>` 드롭다운은 헤드리스 브라우저에서 OS 네이티브 팝업이 스크린샷에 안 잡혀서 좌표 클릭으로 옵션을 고를 수 없다 — `action.type: 'select'`를 지원해서 `Locator.selectOption()`으로 직접 값을 지정한다(`executor.js`). `capture.js`가 select의 `<option>` 목록을 텍스트로 함께 넘겨주므로, 화면엔 안 보이는 옵션도 LLM이 선택할 수 있다.
- **봇 탐지 우회(Camoufox)**: 결제 체크포인트가 하나라도 있는 여정은 Chromium 대신 [Camoufox](https://camoufox.com)(엔진 레벨 지문 패치가 들어간 스텔스 Firefox 포크, `browserEngines.js`)로 런 전체를 실행한다. 공개 봇 탐지 데모(bot.sannysoft.com)로 직접 비교한 결과, Chromium은 WebDriver/HEADCHR_* 계열 7개 항목에서 탐지됐지만 Camoufox는 전부 통과했다. 알려진 한계: Chromium의 `--host-resolver-rules` IP 고정과 동등한 기능이 Firefox 쪽엔 없어서, 스텔스 경로에서는 DNS 리바인딩 방지 하드닝이 아직 빠져 있다(사설 IP·메타데이터 차단 자체는 그대로 적용됨).

## 보안 메모

- 테스트 대상 URL은 소유권 검증(`.well-known`) 없이는 실행 불가. (`SKIP_OWNERSHIP_VERIFICATION=true`로 파일럿/고객 조사 단계에서만 우회 가능 — **프로덕션에서는 절대 켜면 안 됨**. 이 플래그를 켜도 SSRF 가드는 그대로 적용된다.)
- SSRF 가드가 사설/예약 IP 대역·클라우드 메타데이터 엔드포인트로의 요청을 차단하고, 실행 직전 resolve한 IP를 Playwright `--host-resolver-rules`로 고정해 DNS 리바인딩을 막는다.
- 테스트 계정 자격증명은 AES-256-GCM으로 암호화 저장되며, 로그인 시 LLM에는 비밀번호 값 자체를 절대 넘기지 않는다(필드 위치만 식별).
- Firestore/Storage 보안 규칙상 클라이언트는 자기 테넌트 데이터를 읽기만 할 수 있고 모든 쓰기는 backend(firebase-admin)를 통해서만 이뤄진다.
