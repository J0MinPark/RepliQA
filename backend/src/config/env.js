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
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  credentialEncryptionKey: process.env.CREDENTIAL_ENCRYPTION_KEY || null,
  workerConcurrency: parseInt(process.env.WORKER_CONCURRENCY || '2', 10),
  workerPollIntervalMs: parseInt(process.env.WORKER_POLL_INTERVAL_MS || '3000', 10),
};

module.exports = env;
