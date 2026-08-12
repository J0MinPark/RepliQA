# 배포 가이드 (Vercel + Render)

로컬 개발/에뮬레이터 기준으로 짜여 있던 걸 실제로 띄우기 위한 절차. 아래 4곳에 나눠 배포한다 —
**전부 카드 등록 없이 무료로 가능**하다.

| 구성요소 | 배포처 | 이유 |
|---|---|---|
| 프론트엔드 (React/Vite) | Vercel (무료) | 정적 SPA, Vercel이 가장 잘하는 영역 |
| API 서버 (Express, 가벼운 CRUD) | Vercel (무료, 서버리스 함수) | 브라우저 자동화 없이 Firestore 읽고 쓰는 게 전부라 10초 제한 안에 항상 끝남 |
| Worker (Playwright/Camoufox 실행) | Render (무료 Web Service) | 상시 폴링 루프 + 무거운 브라우저 바이너리라 Vercel 서버리스에 안 맞음(함수 크기·실행시간 한계) |
| 스크린샷 저장 | Supabase Storage (무료) | 2026-02부터 Firebase Storage는 Blaze(카드 등록) 없이는 못 씀 — 카드 없이 되는 곳으로 대체(`screenshotStore.js`) |

Firebase는 Auth + Firestore만 쓴다 — 둘 다 Spark(무료) 요금제로 카드 없이 충분하다.
Storage는 아예 활성화할 필요 없음.

## 1. Firebase 프로젝트 (실제 클라우드 — 에뮬레이터 아님)

1. https://console.firebase.google.com 에서 새 프로젝트 생성
2. Authentication → 이메일/비밀번호 로그인 방식 활성화
3. Firestore Database → 프로덕션 모드로 생성 (리전은 asia-northeast3 등 가까운 곳)
4. 프로젝트 설정 → 서비스 계정 → "새 비공개 키 생성" → JSON 파일 다운로드
   (이 파일 내용 전체가 아래 `FIREBASE_SERVICE_ACCOUNT_JSON` 값이 됨 — **절대 커밋 금지**)
5. 프로젝트 설정 → 일반 → "내 앱" → 웹 앱 추가 → `apiKey`/`authDomain`/`projectId` 값을
   받아둠 (프론트엔드 env에 씀)
6. 로컬에서 규칙 배포: `firebase login` → `firebase deploy --only firestore:rules`
   (`.firebaserc`의 프로젝트를 실제 프로젝트 ID로 바꾸거나 `--project <id>` 옵션 사용)
7. 페르소나 시드: 로컬에서 `FIREBASE_USE_EMULATOR=false` + 방금 만든 서비스 계정으로
   `node src/personas/seed.js` 1회 실행 (운영 Firestore에 페르소나 데이터가 있어야 테스트 실행이 됨)

## 2. Supabase — 스크린샷 저장소

1. https://supabase.com 가입 (GitHub 계정, 카드 불필요) → "New Project" 생성
2. Storage → "New bucket" → 이름 `screenshots` (Private로 생성 — Public 체크 해제.
   백엔드만 서명 URL로 접근하고 클라이언트는 직접 못 들어가게 하기 위함)
3. Project Settings → API → `Project URL`과 `service_role` 키(⚠️ `anon` 키 아님 — 반드시
   `service_role`) 복사해둠

## 3. Vercel — 프론트엔드

1. https://vercel.com 가입(GitHub 계정으로, 카드 불필요) → "Add New Project" → RepliQA 레포 import
2. Root Directory: `frontend` (Framework는 Vite로 자동 인식됨)
3. 환경변수 (Vercel 프로젝트 → Settings → Environment Variables):
   - `VITE_USE_EMULATOR=false`
   - `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID` — 1단계 5번에서 받은 값
   - `VITE_API_BASE_URL` — 4단계에서 만들 백엔드 프로젝트의 Vercel URL (먼저 4단계를 하고 와서 채워도 됨)
4. Deploy

## 4. Vercel — API 서버

1. 같은 GitHub 레포로 Vercel 프로젝트를 하나 더 생성 (같은 레포를 Root Directory만 다르게 두 번
   import하는 것 — Vercel에서 지원되는 정상적인 방식)
2. Root Directory: `backend` (`backend/vercel.json`이 이미 있어서 Express 앱을 그대로 서버리스
   함수로 인식함)
3. 환경변수:
   - `GEMINI_API_KEY`
   - `FIREBASE_USE_EMULATOR=false`
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_SERVICE_ACCOUNT_JSON` — 1단계 4번 JSON 파일 내용을 통째로 (한 줄로) 붙여넣기
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — 2단계에서 받은 값 (**둘 다 필수** — 없으면
     스크린샷 저장이 조용히 실패한다. 로컬 개발에서만 미설정 상태로 Firebase 에뮬레이터로 대체됨)
   - `CREDENTIAL_ENCRYPTION_KEY` — `openssl rand -base64 32`로 새로 생성(로컬 값과 달라도 됨,
     단 한 번 정하면 이후 절대 바꾸면 안 됨 — 바꾸면 기존에 저장된 테스트 계정/카드 정보 복호화 불가)
   - `FRONTEND_ORIGIN` — 3단계에서 나온 프론트엔드 Vercel URL (쉼표로 여러 개 가능,
     예: 프로덕션 도메인 + Vercel 프리뷰 도메인)
4. Deploy 후 나온 URL을 3단계의 `VITE_API_BASE_URL`에 채워넣고 프론트엔드 재배포

## 5. Render — Worker

1. https://render.com 가입 (GitHub 계정, 카드 불필요)
2. "New" → "Blueprint" → 레포 선택 → 루트의 `render.yaml`을 자동으로 읽어서 `repliqa-worker`
   서비스가 하나 만들어짐 (무료 Web Service, `sync: false`로 표시된 값은 배포 시 직접 입력하라는
   프롬프트가 뜸)
3. 입력할 값: `GEMINI_API_KEY`, `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_JSON`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CREDENTIAL_ENCRYPTION_KEY` (4단계와 **반드시
   동일한 값** — 암호화 키가 다르면 API가 암호화한 걸 워커가 복호화 못함)
4. Deploy — 최초 빌드는 `npx camoufox-js fetch`로 스텔스 브라우저까지 받기 때문에 몇 분 걸림

### Render 무료 등급 관련 주의

무료 Web Service는 15분간 요청이 없으면 잠들고, 다음 요청(=다음 테스트 실행)이 오면 깨어나는 데
~1분 걸린다. 워커는 헬스체크 엔드포인트(`/`)로만 깨어있는지 확인하는 구조라, 완전히 잠들면 큐에
쌓인 작업도 워커가 깨어날 때까지 대기한다. 필요하면 [cron-job.org](https://cron-job.org)
같은 무료 핑 서비스로 10분마다 `https://<render-url>/`를 호출해 깨어있게 유지할 수 있다(선택사항).

## 순서 요약

1. Firebase 프로젝트 생성 + 규칙 배포 + 페르소나 시드
2. Supabase 프로젝트 + `screenshots` 버킷 생성
3. Render에 Worker 배포 (env var 채우기)
4. Vercel에 API 배포 (env var 채우기, `FRONTEND_ORIGIN`은 5단계 URL 나온 뒤 업데이트)
5. Vercel에 프론트엔드 배포 (`VITE_API_BASE_URL`을 4단계 URL로)
6. 4단계로 돌아가 `FRONTEND_ORIGIN`을 5단계 URL로 업데이트 후 재배포
