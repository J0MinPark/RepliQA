const express = require('express');
const crypto = require('crypto');
const { collections, auth, admin } = require('../../db/firestore');
const { requireAuth, requireTenant, hashApiKey } = require('../middleware/auth');

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

// MCP 서버처럼 대화형 로그인이 불가능한 서버-투-서버 클라이언트를 위한 API 키.
// 평문 키는 이 응답에서 딱 한 번만 내려주고, 저장은 해시만 한다(GitHub/Stripe식 관행) —
// 재발급하면 이전 키는 즉시 무효화된다.
router.post('/api-key', requireAuth, requireTenant, async (req, res) => {
  const plainKey = `rq_${crypto.randomBytes(24).toString('hex')}`;
  await collections.tenants().doc(req.tenantId).update({
    apiKeyHash: hashApiKey(plainKey),
    apiKeyPrefix: plainKey.slice(0, 10),
    apiKeyCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  res.json({
    apiKey: plainKey,
    warning: '이 키는 다시 조회할 수 없습니다. 지금 안전한 곳에 저장하세요. 재발급 시 이전 키는 즉시 무효화됩니다.',
  });
});

module.exports = router;
