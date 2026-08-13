const express = require('express');
const crypto = require('crypto');
const { collections, auth, admin, db } = require('../../db/firestore');
const { requireAuth, requireTenant, hashApiKey } = require('../middleware/auth');
const { deleteTenantStorage } = require('../../engine/screenshotStore');

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

const DELETABLE_SUBCOLLECTIONS = ['registeredUrls', 'routes', 'testRuns', 'usage'];

// 탈퇴. Firestore 서브컬렉션은 상위 문서를 지운다고 자동으로 같이 지워지지 않으므로
// 직접 순회해서 지운 뒤에 테넌트 문서를 지운다. Storage(스크린샷·캡처된 로그인 세션)
// 삭제가 실패해도 계정 삭제 자체는 막지 않는다 — 이용자 입장에서 "탈퇴가 절반만 됐다"는
// 상태보다는, 드물게 스토리지 잔여물이 남더라도 계정/개인정보가 확실히 지워지는 쪽이 낫다.
router.delete('/me', requireAuth, requireTenant, async (req, res) => {
  const tenantId = req.tenantId;
  const tenantRef = collections.tenants().doc(tenantId);
  const tenantSnap = await tenantRef.get();
  const ownerUid = tenantSnap.exists ? tenantSnap.data().ownerUid : null;

  for (const name of DELETABLE_SUBCOLLECTIONS) {
    const snap = await tenantRef.collection(name).get();
    const batchSize = 400; // Firestore 배치 쓰기 한도(500) 아래로 여유 있게
    for (let i = 0; i < snap.docs.length; i += batchSize) {
      const batch = db.batch();
      snap.docs.slice(i, i + batchSize).forEach((doc) => batch.delete(doc.ref));
      // eslint-disable-next-line no-await-in-loop -- 배치 크기만큼 순차 커밋(동시 배치 경합 방지)
      await batch.commit();
    }
  }
  await tenantRef.delete();

  await deleteTenantStorage(tenantId).catch((err) => {
    console.error(`[tenants] 스토리지 삭제 실패 (tenantId=${tenantId}):`, err);
  });

  if (ownerUid) {
    await auth.deleteUser(ownerUid).catch((err) => {
      console.error(`[tenants] Auth 계정 삭제 실패 (uid=${ownerUid}):`, err);
    });
  }

  res.json({ deleted: true });
});

module.exports = router;
