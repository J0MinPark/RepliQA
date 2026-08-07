const { db, collections, admin } = require('./firestore');

class QuotaExceededError extends Error {
  constructor(message) {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

const DEFAULT_QUOTA = { maxRunsPerDay: 20, maxConcurrent: 2, maxActionsPerRun: 15 };

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

async function getTenant(tenantId) {
  const snap = await collections.tenants().doc(tenantId).get();
  if (!snap.exists) throw new Error(`테넌트를 찾을 수 없습니다: ${tenantId}`);
  return { id: snap.id, ...snap.data() };
}

async function getQuota(tenantId) {
  const tenant = await getTenant(tenantId);
  return { ...DEFAULT_QUOTA, ...(tenant.quota || {}) };
}

// job 생성 전 호출: 동시 실행 개수 → 일일 실행 횟수 순으로 검사하고,
// 통과하면 오늘자 사용량 카운터를 트랜잭션으로 원자적으로 +1 예약한다.
// (동시 요청 경합 시 concurrent 체크는 best-effort이며, 일일 카운터만 강하게 보장된다.)
async function reserveRunQuota(tenantId) {
  const quota = await getQuota(tenantId);

  const runningSnap = await collections
    .testRuns(tenantId)
    .where('status', 'in', ['queued', 'running'])
    .get();
  if (runningSnap.size >= quota.maxConcurrent) {
    throw new QuotaExceededError(
      `동시 실행 한도(${quota.maxConcurrent}건)를 초과했습니다. 실행 중인 테스트가 끝난 뒤 다시 시도하세요.`
    );
  }

  const usageRef = collections.usage(tenantId).doc(todayKey());
  await db.runTransaction(async (tx) => {
    const usageSnap = await tx.get(usageRef);
    const runsCount = usageSnap.exists ? usageSnap.data().runsCount || 0 : 0;
    if (runsCount >= quota.maxRunsPerDay) {
      throw new QuotaExceededError(`일일 실행 한도(${quota.maxRunsPerDay}건)를 초과했습니다.`);
    }
    tx.set(
      usageRef,
      { runsCount: runsCount + 1, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
  });

  return quota;
}

async function recordActionUsage(tenantId, actionCount) {
  const usageRef = collections.usage(tenantId).doc(todayKey());
  await usageRef.set(
    {
      actionsCount: admin.firestore.FieldValue.increment(actionCount),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function getUsageToday(tenantId) {
  const snap = await collections.usage(tenantId).doc(todayKey()).get();
  return snap.exists ? snap.data() : { runsCount: 0, actionsCount: 0 };
}

module.exports = {
  QuotaExceededError,
  getTenant,
  getQuota,
  reserveRunQuota,
  recordActionUsage,
  getUsageToday,
  todayKey,
};
