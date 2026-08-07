# RepliQA Frontend

React + Vite + Tailwind. Firebase Auth로 로그인하고, `backend`가 노출하는 REST API로 테스트를 실행하며,
결과는 Firestore `onSnapshot`으로 실시간 구독한다.

## 준비

```bash
npm install
cp .env.example .env   # 기본값은 로컬 Firebase 에뮬레이터를 가리킴
```

백엔드(API 서버 + Worker)와 `firebase emulators:start`가 먼저 떠 있어야 한다. 자세한 순서는
`backend/README.md` 참고.

## 실행

```bash
npm run dev
```

## 구조

- `src/lib/firebase.js` — Firebase 클라이언트 초기화(+에뮬레이터 연결)
- `src/lib/api.js` — 백엔드 REST API 호출 래퍼 (Firebase ID 토큰을 Authorization 헤더로 부착)
- `src/context/AuthContext.jsx` — 로그인 상태 + 테넌트 부트스트랩
- `src/pages/LoginPage.jsx`, `src/pages/DashboardPage.jsx`
- `src/components/UrlRegistrationPanel.jsx` — URL 등록/소유권 검증/테스트 계정 등록
- `src/components/TestRunForm.jsx` — 검증된 URL + 페르소나 선택 후 테스트 실행
- `src/components/TestRunProgress.jsx` — Firestore 실시간 구독으로 진행상황·리포트 표시
- `src/components/UsagePanel.jsx` — 오늘 사용량/쿼터
