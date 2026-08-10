const express = require('express');
const { z } = require('zod');
const { collections, admin } = require('../../db/firestore');
const { requireAuth, requireTenant } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireTenant);

// 체크포인트는 자연어 한 줄 = 한 단계. AI로 파싱하지 않고 그대로 순서를 부여해서
// 저장한다 — 고객이 정확히 뭘 등록했는지 투명하게 보이고, 비용도 안 든다.
const createSchema = z.object({
  name: z.string().min(1),
  registeredUrlId: z.string().min(1),
  checkpoints: z.array(z.string().min(1)).min(1).max(10),
});

router.post('/', async (req, res) => {
  const parseResult = createSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'name, registeredUrlId, checkpoints(1~10개)가 필요합니다.' });
  }
  const { name, registeredUrlId, checkpoints } = parseResult.data;

  const urlSnap = await collections.registeredUrls(req.tenantId).doc(registeredUrlId).get();
  if (!urlSnap.exists) return res.status(404).json({ error: '등록된 URL을 찾을 수 없습니다.' });

  const docRef = await collections.routes(req.tenantId).add({
    name,
    registeredUrlId,
    checkpoints: checkpoints.map((goal, order) => ({ order, goal })),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  res.status(201).json({ id: docRef.id, name, registeredUrlId, checkpoints });
});

router.get('/', async (req, res) => {
  let query = collections.routes(req.tenantId).orderBy('createdAt', 'desc');
  if (req.query.registeredUrlId) {
    query = query.where('registeredUrlId', '==', req.query.registeredUrlId);
  }
  const snap = await query.get();
  res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
});

router.get('/:id', async (req, res) => {
  const snap = await collections.routes(req.tenantId).doc(req.params.id).get();
  if (!snap.exists) return res.status(404).json({ error: '여정을 찾을 수 없습니다.' });
  res.json({ id: snap.id, ...snap.data() });
});

module.exports = router;
