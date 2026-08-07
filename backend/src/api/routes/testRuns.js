const express = require('express');
const { z } = require('zod');
const { collections, admin } = require('../../db/firestore');
const { requireAuth, requireTenant } = require('../middleware/auth');
const { reserveRunQuota, QuotaExceededError } = require('../../db/quota');
const { testRunCreationLimiter } = require('../middleware/rateLimit');

const router = express.Router();
router.use(requireAuth, requireTenant);

const createSchema = z.object({
  registeredUrlId: z.string().min(1),
  personaId: z.string().min(1),
});

router.post('/', testRunCreationLimiter, async (req, res) => {
  const parseResult = createSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'registeredUrlId, personaId가 필요합니다.' });
  }
  const { registeredUrlId, personaId } = parseResult.data;

  const urlSnap = await collections.registeredUrls(req.tenantId).doc(registeredUrlId).get();
  if (!urlSnap.exists) return res.status(404).json({ error: '등록된 URL을 찾을 수 없습니다.' });
  const urlData = urlSnap.data();
  if (!urlData.verified) {
    return res.status(403).json({ error: '이 URL은 아직 소유권이 검증되지 않았습니다.' });
  }

  const personaSnap = await collections.personas().doc(personaId).get();
  if (!personaSnap.exists) return res.status(404).json({ error: '페르소나를 찾을 수 없습니다.' });
  const persona = personaSnap.data();

  let quota;
  try {
    quota = await reserveRunQuota(req.tenantId);
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      return res.status(429).json({ error: err.message });
    }
    throw err;
  }

  // 페르소나가 스스로 정한 행동 수 상한을 존중하되, 테넌트 쿼터를 넘지는 못하게 min을 취한다.
  // (quota.maxActionsPerRun을 무조건 쓰면 페르소나가 짧게 끝내도록 튜닝한 의도를 덮어써 버린다.)
  const maxActions = Math.min(persona.maxActions || quota.maxActionsPerRun, quota.maxActionsPerRun);

  const runRef = await collections.testRuns(req.tenantId).add({
    targetUrl: urlData.url,
    registeredUrlId,
    personaId,
    personaName: persona.name,
    status: 'queued',
    steps: [],
    maxActions,
    createdBy: req.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  res.status(202).json({ id: runRef.id, status: 'queued' });
});

router.get('/', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const snap = await collections
    .testRuns(req.tenantId)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();
  res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
});

router.get('/:id', async (req, res) => {
  const snap = await collections.testRuns(req.tenantId).doc(req.params.id).get();
  if (!snap.exists) return res.status(404).json({ error: '테스트 실행을 찾을 수 없습니다.' });
  res.json({ id: snap.id, ...snap.data() });
});

module.exports = router;
