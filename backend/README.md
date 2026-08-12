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

## 행동(action) 종류

에이전트가 한 스텝에서 고를 수 있는 `action.type` 전체 목록(`geminiAdapter.js`의 `ACTION_SCHEMA_HINT`,
실행은 `executor.js`):

- `click`, `type`(`clear:true`로 지우고 재입력), `clear`(지우기만), `select`
- `hover`(클릭 없이 마우스만 올림 — 툴팁 확인), `drag`(elementIndex→targetElementIndex)
- `paste`(타이핑이 아니라 실제 clipboard 붙여넣기 — 붙여넣기 방지 필드 우회 테스트용)
- `key`(Enter/Tab/Escape/Backspace 등, `times`로 반복), `rapid_click`(같은 요소를 빠르게
  연속 클릭 — 중복 제출 방지 테스트용), `scroll`, `go_back`/`go_forward`, `reload`
- `resize_viewport`(mobile/tablet/desktop 프리셋 + `orientation: portrait|landscape` — 반응형·화면 회전 확인)
- `set_color_scheme`(dark/light 강제 전환), `set_network`(offline 강제 on/off)
- `clear_storage`(cookies/localStorage/sessionStorage 강제 초기화 — 강제 로그아웃 시나리오)
- `navigate`(등록된 대상과 같은 호스트로만 직접 URL 이동 — 관리자 페이지 강제 접근, IDOR용
  파라미터 변조 등 인가 테스트용. 다른 호스트로는 SSRF 가드와 별개로 이 자체에서도 막힘)
- `open_duplicate_tab`/`switch_tab`(같은 로그인 세션을 공유하는 두 번째 탭을 열고 전환 —
  동시성/경합 조건 테스트용)
- `read_test_inbox`(설정된 테스트 인박스에서 최신 메일을 읽어 인증 코드 자동 입력 또는
  재설정 링크로 자동 이동 — 아래 "외부 시스템 연동" 참고)
- `upload_file`(`fixtureType`: valid_image/valid_document/disallowed_extension/oversized —
  실제 파일은 `testFixtures.js`가 그때그때 만들어서 재사용. 사이트별 실제 파일은 못 씀)
- `wait`(`[장시간]` 태그 체크포인트가 아니면 최대 5초로 제한), `finish`(`finishReason:
  goal_achieved | blocked`로 성공/실패를 반드시 구분 — 목표를 못 이루고 포기한 경우까지
  "완료"로 잘못 찍히는 걸 막기 위한 장치)

**알려진 한계**:
- `drag`는 마우스 이벤트 시퀀스 + 진짜 `DragEvent` 디스패치를 둘 다 시도한다. 순수 마우스
  시퀀스만으로는 일부 사이트의 네이티브 HTML5 드래그앤드롭(브라우저 내부 DnD 상태 머신)이
  안 걸리는 경우를 실제로 확인했음(the-internet.herokuapp.com/drag_and_drop) — `DragEvent`
  디스패치를 추가해서 해결.
- `alert`/`confirm`/`prompt` 같은 네이티브 다이얼로그는 자동으로 승인(accept)된다 — "취소"
  분기까지 테스트하려면 아직 지원하지 않는다. 어떤 다이얼로그가 떴었는지는 콘솔 로그에 남는다.
- 다운로드는 파일명/크기/sha256 해시만 기록한다 — 내용이 "올바른지"는 비교 기준이 없어
  판단할 수 없고, 사람이 리포트에서 직접 확인해야 한다.

## 네트워크·콘솔·웹소켓 로그 캡처

에러가 아닌 것도 포함해서 런 전체의 XHR/fetch 호출(method/url/status), 콘솔 로그,
WebSocket 이벤트(연결/프레임 송수신/종료 — 실시간 채팅·대시보드의 재연결 확인용)를 전부
기록한다(`executor.js`의 `attachErrorCollectors`, 최대 80건씩). "200은 떨어졌는데 데이터가
잘못된" 것처럼 겉보기엔 정상인 버그도 사람이나 코딩 에이전트가 원본을 직접 훑어볼 수 있게
하기 위함이다. 요청/응답 바디, 웹소켓 프레임 내용은 로그인 폼 등에서 비밀번호 같은
민감정보가 그대로 들어갈 수 있어 의도적으로 캡처하지 않는다(이벤트 종류·시각만 남김).

## 외부 시스템 연동이 필요한 여정

- **이메일/문자 인증, 비밀번호 재설정 링크**: `PUT /api/urls/:id/test-inbox`로 테스트
  인박스(현재는 Mailosaur만 지원, `engine/testInbox.js`)를 등록해두면, 여정 중
  `read_test_inbox` 액션으로 최신 메일을 읽어 코드를 자동 입력하거나 링크로 자동 이동한다.
  이메일 본문 전체를 LLM에 보여주지 않고 서버가 직접 코드/링크만 추출해서 쓴다(로그인
  자격증명과 동일한 원칙). ⚠️ Mailosaur 어댑터는 공개 API 스펙대로 구현했지만, 실제 계정
  없이 라이브로 검증하지는 못했다 — 실사용 전 직접 확인 필요.
- **소셜 로그인(OAuth)**: 매번 자동화로 로그인을 시도하지 않는다(구글 검색 테스트에서
  직접 확인했듯, 대부분 봇 탐지로 막힘). 대신 `scripts/capture-session.js`로 사람이 한 번
  수동으로 로그인해서 세션(쿠키+로컬스토리지)을 캡처해두면, 이후 테스트는 그 세션을 불러와
  "이미 로그인된 상태"로 시작한다(`PUT /api/urls/:id/test-session`, `runEngine.js`가
  `browser.newContext({ storageState })`로 복원). storageState 왕복 자체는 직접
  검증했다(쿠키가 정확히 복원되는 것 확인).
- **세션 만료 대기**: 여정 체크포인트 줄 앞에 `[장시간]`을 붙이면 그 단계에서만 `wait`
  액션의 상한이 5초 → 30분으로 늘어난다. 실제 시간이 그만큼 걸리고 워커 슬롯을 그 시간
  내내 점유하므로, 일반 체크포인트에는 이 태그를 절대 붙이지 말 것.

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
- Firestore 보안 규칙상 클라이언트는 자기 테넌트 데이터를 읽기만 할 수 있고 모든 쓰기는 backend(firebase-admin)를 통해서만 이뤄진다. 스크린샷은 클라이언트가 저장소에 직접 접근하지 않고, `GET /api/test-runs/:id/screenshots/:label`로 소유권 확인 후 백엔드가 대신 URL을 발급한다(`screenshotStore.js` — 운영은 Supabase Storage, 로컬은 Firebase Storage 에뮬레이터).
