const crypto = require('crypto');
const { auth, collections } = require('../../db/firestore');

function hashApiKey(plainKey) {
  return crypto.createHash('sha256').update(plainKey).digest('hex');
}

// MCP 서버처럼 사람이 브라우저로 로그인할 수 없는 클라이언트를 위한 별도 인증 경로.
// X-RepliQA-Api-Key 헤더가 있으면 그 경로를 먼저 시도하고, 없으면 기존 Firebase ID
// 토큰(Bearer) 검증으로 넘어간다. 두 경로 모두 최종적으로 req.tenantId만 채우면 되므로
// 아래 나머지 라우트들은 어떤 인증 수단인지 신경 쓸 필요가 없다.
async function requireAuth(req, res, next) {
  const apiKey = req.headers['x-repliqa-api-key'];
  if (apiKey) {
    try {
      const hash = hashApiKey(apiKey);
      const snap = await collections.tenants().where('apiKeyHash', '==', hash).limit(1).get();
      if (snap.empty) {
        return res.status(401).json({ error: '유효하지 않은 API 키입니다.' });
      }
      req.tenantId = snap.docs[0].id;
      req.uid = 'api-key'; // Firestore가 undefined 값을 거부하므로, createdBy 등에 쓸 고정 마커
      req.authMethod = 'apiKey';
      return next();
    } catch {
      return res.status(401).json({ error: 'API 키 검증 중 오류가 발생했습니다.' });
    }
  }

  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer (.+)$/);
  if (!match) {
    return res.status(401).json({ error: 'Authorization 헤더(Bearer 토큰) 또는 X-RepliQA-Api-Key가 필요합니다.' });
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

module.exports = { requireAuth, requireTenant, hashApiKey };
