const os = require('os');
const { db, admin } = require('../db/firestore');

const WORKER_ID = `${os.hostname()}-${process.pid}`;

// 여러 워커 인스턴스가 같은 job을 동시에 집으려 하는 걸 막는 원자적 claim.
// 트랜잭션 안에서 status가 여전히 'queued'인지 재확인 후에만 'running'으로 바꾼다.
async function claimRun(ref) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data().status !== 'queued') return null;
    tx.update(ref, {
      status: 'running',
      workerId: WORKER_ID,
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { id: snap.id, ...snap.data() };
  });
}

module.exports = { claimRun, WORKER_ID };
