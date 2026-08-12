const express = require('express');
const { collections } = require('../../db/firestore');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// 페르소나는 테넌트 간 공용 데이터라 requireTenant는 없음 — 로그인만 되어 있으면 조회 가능.
// hidden: true인 페르소나(카오스 계열)는 목록에서 제외한다 — 지금은 "지시된 여정을 정확히
// 수행하는지"부터 검증하는 단계라 잠시 숨겨둔 것. 웹 UI와 MCP list_personas 둘 다 이
// 엔드포인트 하나를 쓰므로, 여기서만 필터링하면 양쪽에 동일하게 적용된다.
router.get('/', requireAuth, async (req, res) => {
  const snap = await collections.personas().get();
  const personas = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((p) => !p.hidden);
  res.json(personas);
});

module.exports = router;
