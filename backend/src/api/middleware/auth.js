const { auth } = require('../../db/firestore');

// Firebase ID 토큰을 검증하고 커스텀 클레임의 tenantId를 req에 붙인다.
// 클라이언트가 자기 tenantId를 주장하게 두지 않고 서버가 발급한 클레임만 신뢰한다.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer (.+)$/);
  if (!match) {
    return res.status(401).json({ error: 'Authorization 헤더(Bearer 토큰)가 필요합니다.' });
  }
  try {
    const decoded = await auth.verifyIdToken(match[1]);
    req.uid = decoded.uid;
    req.tenantId = decoded.tenantId || null;
    next();
  } catch {
    return res.status(401).json({ error: '유효하지 않거나 만료된 토큰입니다.' });
  }
}

// tenantId 클레임이 없는 사용자(아직 온보딩 전)는 tenants/bootstrap 외 라우트를 못 쓰게 막는다.
function requireTenant(req, res, next) {
  if (!req.tenantId) {
    return res
      .status(403)
      .json({ error: '테넌트가 아직 없습니다. POST /api/tenants/bootstrap을 먼저 호출하세요.' });
  }
  next();
}

module.exports = { requireAuth, requireTenant };
