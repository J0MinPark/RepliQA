import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';

// 로컬 개발 기본값은 Firebase Local Emulator Suite를 겨냥한다 — 실제 클라우드
// 프로젝트 키가 없어도 바로 돌아간다. 운영 배포 시 VITE_* 값을 실제 프로젝트로 교체하고
// VITE_USE_EMULATOR=false로 설정하면 된다.
const useEmulator = import.meta.env.VITE_USE_EMULATOR !== 'false';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'demo-api-key',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'repliqa-dev.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'repliqa-dev',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'repliqa-dev.appspot.com',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

if (useEmulator) {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, 'localhost', 8080);
  connectStorageEmulator(storage, 'localhost', 9199);
}
