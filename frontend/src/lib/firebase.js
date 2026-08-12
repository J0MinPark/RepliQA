import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';

// 로컬 개발 기본값은 Firebase Local Emulator Suite를 겨냥한다 — 실제 클라우드
// 프로젝트 키가 없어도 바로 돌아간다. 운영 배포 시 VITE_* 값을 실제 프로젝트로 교체하고
// VITE_USE_EMULATOR=false로 설정하면 된다.
// Storage는 여기서 안 씀 — 스크린샷은 백엔드가 소유권 확인 후 대신 URL을 발급해준다
// (screenshotStore.js, Firebase Storage는 2026-02부터 카드 없인 못 써서 Supabase로 대체함).
const useEmulator = import.meta.env.VITE_USE_EMULATOR !== 'false';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'demo-api-key',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'repliqa-dev.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'repliqa-dev',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

if (useEmulator) {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, 'localhost', 8080);
}
