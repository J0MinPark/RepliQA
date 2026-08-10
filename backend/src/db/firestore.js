const admin = require('firebase-admin');
const env = require('../config/env');

if (env.firebaseUseEmulator) {
  process.env.FIRESTORE_EMULATOR_HOST = env.firestoreEmulatorHost;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = env.authEmulatorHost;
  process.env.STORAGE_EMULATOR_HOST = `http://${env.storageEmulatorHost}`;
  process.env.FIREBASE_STORAGE_EMULATOR_HOST = env.storageEmulatorHost;
}

if (!admin.apps.length) {
  admin.initializeApp({
    projectId: env.firebaseProjectId,
    storageBucket: env.storageBucket,
  });
}

const db = admin.firestore();
const auth = admin.auth();
const bucket = admin.storage().bucket();

const collections = {
  tenants: () => db.collection('tenants'),
  registeredUrls: (tenantId) => db.collection('tenants').doc(tenantId).collection('registeredUrls'),
  routes: (tenantId) => db.collection('tenants').doc(tenantId).collection('routes'),
  testRuns: (tenantId) => db.collection('tenants').doc(tenantId).collection('testRuns'),
  usage: (tenantId) => db.collection('tenants').doc(tenantId).collection('usage'),
  personas: () => db.collection('personas'),
  // Worker needs to scan across all tenants for queued jobs — collectionGroup query.
  allTestRuns: () => db.collectionGroup('testRuns'),
};

module.exports = { admin, db, auth, bucket, collections };
