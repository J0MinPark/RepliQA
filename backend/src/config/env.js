require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`환경변수 ${name}가 설정되지 않았습니다. .env 파일을 확인하세요.`);
  }
  return value;
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3001', 10),
  geminiApiKey: required('GEMINI_API_KEY'),
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || 'repliqa-dev',
  firebaseUseEmulator: process.env.FIREBASE_USE_EMULATOR !== 'false',
  firestoreEmulatorHost: process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080',
  authEmulatorHost: process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099',
  storageEmulatorHost: process.env.FIREBASE_STORAGE_EMULATOR_HOST || 'localhost:9199',
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'repliqa-dev.appspot.com',
  // 운영(Vercel/Render) 배포용 — 서비스 계정 JSON 전체를 문자열로 넣어두는 방식.
  // 로컬 개발/에뮬레이터에서는 불필요.
  firebaseServiceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON || null,
  // 여러 origin을 콤마로 구분해 허용할 수 있게(예: Vercel 프리뷰 배포 + 프로덕션 도메인 동시 허용).
  frontendOrigin: process.env.FRONTEND_ORIGIN
    ? process.env.FRONTEND_ORIGIN.split(',').map((o) => o.trim())
    : 'http://localhost:5173',
  credentialEncryptionKey: process.env.CREDENTIAL_ENCRYPTION_KEY || null,
  // 2026-02부터 Firebase Storage는 Blaze(카드 등록) 없이는 못 쓴다. 둘 다 설정돼 있으면
  // 스크린샷 저장을 카드 없이 되는 Supabase Storage(무료)로 대신한다 — screenshotStore.js.
  // 로컬 개발은 미설정이 기본값이라 지금까지처럼 Firebase Storage 에뮬레이터를 그대로 쓴다.
  supabaseUrl: process.env.SUPABASE_URL || null,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || null,
  supabaseScreenshotBucket: process.env.SUPABASE_SCREENSHOT_BUCKET || 'screenshots',
  workerConcurrency: parseInt(process.env.WORKER_CONCURRENCY || '2', 10),
  workerPollIntervalMs: parseInt(process.env.WORKER_POLL_INTERVAL_MS || '3000', 10),
  // 파일럿/로컬 고객 조사 전용 우회 스위치. 기본값 false — 프로덕션에서는 절대 켜면 안 됨
  // (URL 소유권 검증이 곧 "이 도구로 남의 사이트를 못 때리게" 막는 유일한 장치임).
  skipOwnershipVerification: process.env.SKIP_OWNERSHIP_VERIFICATION === 'true',
};

module.exports = env;
