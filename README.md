# RepliQA

다중 페르소나 기반 자율형 AI QA 솔루션. 비전(Vision) LLM을 탑재한 AI 에이전트가 실제 화면을 보고
클릭·타이핑 같은 행동을 스스로 결정하며 서비스를 테스트하고, 발견된 에러를 바탕으로 즉시 사용할 수 있는
코드 수정 프롬프트(Vibe-Coding Prompt)를 생성합니다.

## 아키텍처

```
frontend (React + Firebase Auth)
        │
        ▼
backend/src/api  (Express API 서버 — 인증, URL 등록/검증, 테스트 큐 등록, 쿼터)
        │  Firestore(testRuns: queued)
        ▼
backend/src/worker  (Firestore 트랜잭션으로 job claim, 여러 인스턴스로 수평 확장 가능)
        │
        ▼
backend/src/engine  (스크린샷+좌표 캡처 → Gemini Vision이 행동 결정 → Playwright 실행 → 반복)
        │
        ▼
Firebase Storage(스크린샷) + Firestore(타임라인/리포트) → 프론트가 실시간(onSnapshot)으로 진행상황 표시
```

- **API 서버 / Worker 분리**: 요청 즉시 큐에 등록하고 별도 프로세스가 실제 브라우저 자동화를 수행 (동시 다중 테넌트 처리 가능)
- **Vision 기반 엔진**: DOM 텍스트 매칭이 아니라 스크린샷 + bounding box 좌표로 요소를 인지 → 프레임워크(React/Vue/vanilla) 무관하게 동작
- **페르소나 3종**: 조급한 사용자(rage-click) / 네트워크 불안정 유저(flaky-network, 실제로 `context.setOffline` 토글) / 무지성 타이퍼(form-spammer) — Firestore `personas` 컬렉션에 데이터로 정의되어 있어 손쉽게 추가 가능
- **보안**: SSRF 가드(사설 IP·클라우드 메타데이터·localhost 차단 + DNS 리바인딩 방지 IP pinning), URL 소유권 검증(`.well-known` 파일), 테스트 계정 자격증명 AES-256-GCM 암호화, 테넌트별 Firestore/Storage 보안 규칙
- **쿼터/사용량**: 테넌트별 동시실행·일일횟수 한도 + 사용량 카운터 (과금 로직의 기반)

## 폴더 구조

```
backend/    Express API 서버 + Worker + 테스트 엔진 (Node.js)
frontend/   React + Vite + Tailwind 대시보드
firebase.json, firestore.rules, firestore.indexes.json, storage.rules
            Firebase 프로젝트/에뮬레이터 설정 (루트에 위치)
```

## 사전 준비

| 필요한 것 | 확인 방법 | 없으면 |
|---|---|---|
| Node.js 20+ | `node --version` | https://nodejs.org |
| Java 21+ (Firestore/Auth 에뮬레이터 구동용) | `java -version` | 아래 설치 명령 참고 |
| Firebase CLI | `firebase --version` | `npm install -g firebase-tools` |
| Gemini API 키 | — | https://aistudio.google.com/apikey 에서 발급 |

**Java 21 설치 (Windows, winget)**
```powershell
winget install --id Microsoft.OpenJDK.21 --source winget
```
설치 후 **새 터미널 창**을 열어야 PATH가 반영됩니다 (기존에 열려 있던 터미널은 인식 못 함).

## 최초 1회 설정

```bash
# 1) 의존성 설치
cd backend && npm install && npx playwright install chromium
cd ../frontend && npm install

# 2) 환경변수 파일 생성
cd ../backend
cp .env.example .env
# .env 열어서 GEMINI_API_KEY 채우기
# CREDENTIAL_ENCRYPTION_KEY는 아래 명령으로 생성해서 채우기
openssl rand -base64 32

cd ../frontend
cp .env.example .env   # 로컬 에뮬레이터 기준 기본값이라 수정 없이 바로 써도 됨
```

## 실행 (터미널 4개 필요)

각 터미널을 계속 켜둔 상태로 아래 순서대로 실행합니다.

**터미널 1 — Firebase 에뮬레이터 (Auth + Firestore + Storage)**
```powershell
cd RepliQA-Workspace
firebase emulators:start --project repliqa-dev
```
`✔ All emulators ready!` 가 뜨면 다음 단계로. (`http://127.0.0.1:4000` 에서 데이터 직접 확인 가능)

**터미널 2 — API 서버**
```powershell
cd RepliQA-Workspace/backend
npm run seed:personas   # 최초 1회만 (페르소나 3종을 Firestore에 심음)
npm run start:api
```

**터미널 3 — Worker (Playwright + Gemini 실행 담당)**
```powershell
cd RepliQA-Workspace/backend
npm run start:worker
```

**터미널 4 — 프론트엔드**
```powershell
cd RepliQA-Workspace/frontend
npm run dev
```
`http://localhost:5173` 접속.

## 사용해보기

1. 이메일/비밀번호로 가입 (에뮬레이터라 실제 이메일 인증 없이 아무 값이나 가능)
2. "테스트 대상 URL"에 **본인이 소유·관리하는** 사이트 URL 등록
3. 안내되는 경로(`https://그사이트/.well-known/repliqa-verify-<토큰>.txt`)에 내용이 토큰인 텍스트 파일을 실제로 업로드 → "검증하기"
   - 소유하지 않은 사이트는 의도적으로 검증할 수 없습니다 (SSRF/악용 방지)
4. 검증된 URL + 페르소나 선택 → "AI 에이전트 배포하기"
5. 실시간 스텝별 진행상황 → 완료 시 스크린샷 타임라인 + 에러 로그 + Vibe-Coding 프롬프트 확인

## 종료

각 터미널에서 `Ctrl + C`. 순서 무관.

## 더 자세한 내용

- API 엔드포인트 목록, 보안 설계 상세: [`backend/README.md`](backend/README.md)
- 프론트엔드 구조: [`frontend/README.md`](frontend/README.md)
