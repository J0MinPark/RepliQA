const http = require('http');
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
    let paymentInfo = null;
    if (urlData?.testPaymentMethod) {
      paymentInfo = JSON.parse(decryptSecret(urlData.testPaymentMethod));
    }

    // checkpoints는 Firestore에 맵({"0": {...}, "1": {...}})으로 저장돼 있어서, 엔진에
    // 넘기기 전에 숫자 키 순서대로 정렬한 배열로 복원한다.
    const checkpoints = Object.keys(claimed.checkpoints || {})
      .map(Number)
      .sort((a, b) => a - b)
      .map((index) => ({
        index,
        goal: claimed.checkpoints[index].goal,
        type: claimed.checkpoints[index].type || 'generic',
      }));

    const result = await runTest({
      tenantId,
      runId,
      targetUrl: claimed.targetUrl,
      persona,
      checkpoints,
      maxActionsPerCheckpoint: claimed.maxActionsPerCheckpoint || 5,
      credentials,
      paymentInfo,
      onCheckpointStatus: async (checkpointIndex, status, extra = {}) => {
        const update = { [`checkpoints.${checkpointIndex}.status`]: status };
        // Firestore는 undefined 값을 거부하므로(성공 시 failureReason이 undefined임)
        // 실제로 값이 있는 필드만 골라서 병합한다.
        for (const [key, value] of Object.entries(extra)) {
          if (value !== undefined) update[`checkpoints.${checkpointIndex}.${key}`] = value;
        }
        await ref.update(update);
      },
      onStep: async (checkpointIndex, step) => {
        await ref.update({
          [`checkpoints.${checkpointIndex}.steps`]: admin.firestore.FieldValue.arrayUnion(step),
        });
      },
      onUiuxFindings: async (checkpointIndex, { findings, screenshotPath }) => {
        await ref.update({
          [`checkpoints.${checkpointIndex}.uiuxFindings`]: findings,
          [`checkpoints.${checkpointIndex}.entryScreenshotPath`]: screenshotPath,
        });
      },
    });

    await ref.update({
      status: 'done',
      summary: result.summary,
      vibeCoderPrompt: result.vibeCoderPrompt,
      errorAnalysis: result.errorAnalysis,
      collectedErrors: result.collectedErrors,
      networkCalls: result.networkCalls,
      consoleLogs: result.consoleLogs,
      haltedAtCheckpoint: result.haltedAtCheckpoint,
      finishedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await recordActionUsage(tenantId, result.summary.totalActions);
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

// Render 같은 PaaS의 무료 등급은 "Background Worker" 서비스 타입은 유료라, HTTP에 응답하는
// "Web Service" 타입으로 띄워야 무료로 상시 실행할 수 있다. 실제 작업은 여전히 아래
// setInterval 폴링 루프가 하고, 이 서버는 헬스체크·"깨어있는지" 확인용일 뿐이다.
if (process.env.PORT) {
  http
    .createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, processing: processingIds.size }));
    })
    .listen(process.env.PORT, () => {
      console.log(`   헬스체크 서버가 :${process.env.PORT} 에서 응답합니다.`);
    });
}

console.log(`🛠  RepliQA worker 시작 (concurrency=${env.workerConcurrency})`);
setInterval(() => {
  tick().catch((err) => console.error('[worker] tick 오류:', err));
}, env.workerPollIntervalMs);
tick().catch((err) => console.error('[worker] tick 오류:', err));
