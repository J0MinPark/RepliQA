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
- `GET /api/personas` — 사용 가능한 페르소나 목록
- `POST /api/test-runs` — 테스트 실행 큐 등록 (검증된 URL만 가능, 쿼터 체크)
- `GET /api/test-runs/:id` — 실행 상태/결과 조회 (실시간 갱신은 프론트에서 Firestore `onSnapshot` 사용 권장)
- `GET /api/usage/today` — 오늘 사용량 + 쿼터

## 보안 메모

- 테스트 대상 URL은 소유권 검증(`.well-known`) 없이는 실행 불가.
- SSRF 가드가 사설/예약 IP 대역·클라우드 메타데이터 엔드포인트로의 요청을 차단하고, 실행 직전 resolve한 IP를 Playwright `--host-resolver-rules`로 고정해 DNS 리바인딩을 막는다.
- 테스트 계정 자격증명은 AES-256-GCM으로 암호화 저장되며, 로그인 시 LLM에는 비밀번호 값 자체를 절대 넘기지 않는다(필드 위치만 식별).
- Firestore/Storage 보안 규칙상 클라이언트는 자기 테넌트 데이터를 읽기만 할 수 있고 모든 쓰기는 backend(firebase-admin)를 통해서만 이뤄진다.
