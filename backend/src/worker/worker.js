const pLimit = require('p-limit');
const env = require('../config/env');
const { collections, admin } = require('../db/firestore');
const { claimRun } = require('./claim');
const { runTest } = require('../engine/runEngine');
const { decryptSecret } = require('../security/crypto');
const { recordActionUsage } = require('../db/quota');
const { SsrfViolationError } = require('../security/ssrfGuard');

// Kafka/SQS 없이, Firestore 문서 상태(queued→running→done|failed) + 트랜잭션 claim만으로
// 큐를 구현한다. 이 워커는 stateless라 인스턴스를 여러 개 띄우면 그대로 수평 확장된다.
const limit = pLimit(env.workerConcurrency);
const processingIds = new Set();

async function fetchQueuedCandidates(max) {
  const snap = await collections
    .allTestRuns()
    .where('status', '==', 'queued')
    .orderBy('createdAt', 'asc')
    .limit(max)
    .get();
  return snap.docs;
}

async function processRun(doc) {
  const tenantId = doc.ref.parent.parent.id;
  const runId = doc.id;
  const ref = doc.ref;

  const claimed = await claimRun(ref);
  if (!claimed) return; // 다른 워커가 이미 가져감

  try {
    const personaSnap = await collections.personas().doc(claimed.personaId).get();
    if (!personaSnap.exists) throw new Error(`페르소나를 찾을 수 없습니다: ${claimed.personaId}`);
    const persona = { id: personaSnap.id, ...personaSnap.data() };

    const urlSnap = await collections.registeredUrls(tenantId).doc(claimed.registeredUrlId).get();
    const urlData = urlSnap.exists ? urlSnap.data() : null;
    let credentials = null;
    if (urlData?.testCredentials) {
      credentials = JSON.parse(decryptSecret(urlData.testCredentials));
    }

    const result = await runTest({
      tenantId,
      runId,
      targetUrl: claimed.targetUrl,
      persona,
      maxActions: claimed.maxActions || persona.maxActions || 12,
      credentials,
      onStep: async (step) => {
        await ref.update({ steps: admin.firestore.FieldValue.arrayUnion(step) });
      },
    });

    await ref.update({
      status: 'done',
      summary: result.summary,
      vibeCoderPrompt: result.vibeCoderPrompt,
      errorAnalysis: result.errorAnalysis,
      collectedErrors: result.collectedErrors,
      finishedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await recordActionUsage(tenantId, result.steps.length);
  } catch (err) {
    console.error(`[worker] 실행 실패 (${tenantId}/${runId}):`, err);
    await ref.update({
      status: 'failed',
      error: err instanceof SsrfViolationError ? err.message : '테스트 실행 중 오류가 발생했습니다.',
      finishedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
}

async function tick() {
  const availableSlots = env.workerConcurrency - processingIds.size;
  if (availableSlots <= 0) return;

  const candidates = await fetchQueuedCandidates(availableSlots * 2);
  for (const doc of candidates) {
    if (processingIds.size >= env.workerConcurrency) break;
    if (processingIds.has(doc.id)) continue;
    processingIds.add(doc.id);
    limit(() => processRun(doc)).finally(() => processingIds.delete(doc.id));
  }
}

console.log(`🛠  RepliQA worker 시작 (concurrency=${env.workerConcurrency})`);
setInterval(() => {
  tick().catch((err) => console.error('[worker] tick 오류:', err));
}, env.workerPollIntervalMs);
tick().catch((err) => console.error('[worker] tick 오류:', err));
