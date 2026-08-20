const express = require('express');
const { collections } = require('../db/firestore');
const { requireAuth, requireTenant } = require('../api/middleware/auth');
const { startCapture, finishCapture, cancelCapture, getCapture } = require('../engine/remoteSessionCapture');

// 소셜 로그인(OAuth) 세션을 비개발자도 캡처할 수 있게, 서버가 대신 띄운 브라우저 화면을
// 실시간으로 프론트에 보여주는 라우트. Vercel 서버리스 API는 요청 사이에 상태(브라우저
// 프로세스)를 못 들고 있어서, 이 라우트들은 Render에서 영속 프로세스로 도는 워커 자체에
// 붙인다(worker.js) — API 서버(src/api/server.js)와는 별개의 Express 앱이다.
//
// finish는 storageState를 서버가 직접 암호화·저장하지 않고 응답으로만 돌려준다 — 기존
// PUT /api/urls/:id/test-session(암호화·저장 로직 이미 있음)을 프론트가 그대로 재호출해서
// 중복 구현을 피한다.
const router = express.Router();
router.use(requireAuth, requireTenant);

router.post('/session-capture/start', async (req, res) => {
  const registeredUrlId = req.body?.registeredUrlId;
  if (!registeredUrlId) return res.status(400).json({ error: 'registeredUrlId가 필요합니다.' });

  const snap = await collections.registeredUrls(req.tenantId).doc(registeredUrlId).get();
  if (!snap.exists) return res.status(404).json({ error: '등록된 URL을 찾을 수 없습니다.' });

  try {
    const { captureId } = await startCapture({ tenantId: req.tenantId, targetUrl: snap.data().url });
    res.json({ captureId });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

function requireOwnedCapture(req, res, next) {
  const handle = getCapture(req.params.captureId);
  if (!handle || handle.tenantId !== req.tenantId) {
    return res.status(404).json({ error: '세션 캡처를 찾을 수 없습니다(만료되었을 수 있습니다).' });
  }
  next();
}

router.post('/session-capture/:captureId/finish', requireOwnedCapture, async (req, res) => {
  try {
    const storageState = await finishCapture(req.params.captureId);
    res.json({ storageState });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/session-capture/:captureId/cancel', requireOwnedCapture, async (req, res) => {
  await cancelCapture(req.params.captureId);
  res.json({ cancelled: true });
});

module.exports = router;
