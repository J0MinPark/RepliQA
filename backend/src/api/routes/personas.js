const express = require('express');
const { collections } = require('../../db/firestore');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// 페르소나는 테넌트 간 공용 데이터라 requireTenant는 없음 — 로그인만 되어 있으면 조회 가능.
router.get('/', requireAuth, async (req, res) => {
  const snap = await collections.personas().get();
  res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
});

module.exports = router;
