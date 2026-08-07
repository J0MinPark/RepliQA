const express = require('express');
const { collections, auth, admin } = require('../../db/firestore');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const DEFAULT_QUOTA = { maxRunsPerDay: 20, maxConcurrent: 2, maxActionsPerRun: 15 };

// 신규 가입자가 로그인 직후 1회 호출: 테넌트 문서를 만들고 Firebase 커스텀 클레임에
// tenantId를 심는다. MVP에서는 1 계정 = 1 테넌트(uid를 그대로 tenantId로 사용).
router.post('/bootstrap', requireAuth, async (req, res) => {
  if (req.tenantId) {
    return res.json({ tenantId: req.tenantId, alreadyBootstrapped: true });
  }

  const tenantId = req.uid;
  const tenantRef = collections.tenants().doc(tenantId);
  const existing = await tenantRef.get();
  if (!existing.exists) {
    await tenantRef.set({
      ownerUid: req.uid,
      plan: 'free',
      quota: DEFAULT_QUOTA,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  await auth.setCustomUserClaims(req.uid, { tenantId });

  res.json({
    tenantId,
    note: '커스텀 클레임은 다음 ID 토큰 갱신부터 적용됩니다. 프론트에서 getIdToken(true)로 강제 갱신하세요.',
  });
});

router.get('/me', requireAuth, async (req, res) => {
  if (!req.tenantId) return res.status(404).json({ error: '테넌트가 없습니다.' });
  const snap = await collections.tenants().doc(req.tenantId).get();
  if (!snap.exists) return res.status(404).json({ error: '테넌트를 찾을 수 없습니다.' });
  res.json({ id: snap.id, ...snap.data() });
});

module.exports = router;
