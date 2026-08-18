const express = require('express');
const { z } = require('zod');
const { collections, admin } = require('../../db/firestore');
const { requireAuth, requireTenant } = require('../middleware/auth');
const { reserveRunQuota, QuotaExceededError } = require('../../db/quota');
const { testRunCreationLimiter } = require('../middleware/rateLimit');
const { getScreenshotUrl } = require('../../engine/screenshotStore');
const { buildJUnitXml } = require('../junitReport');

const router = express.Router();
router.use(requireAuth, requireTenant);

// 여정 전체를 실행할 때와 체크포인트 하나만 격리해서 재실행할 때(routes.js의
// POST /:id/checkpoints/:index/run) 로직이 동일하다(페르소나 조회, 쿼터 예약, 체크포인트
// 문서 구성) — 중복하지 않고 이 함수를 공유한다. registeredUrl 소유권 검증은 호출부마다
// 대상이 다를 수 있어(여정 생성 vs 격리 재실행) 이 함수 밖에서 각자 한다.
async function createTestRun({
  tenantId,
  uid,
  targetUrl,
  registeredUrlId,
  personaId,
  routeId,
  routeName,
  checkpointDefs,
  browserEngine,
}) {
  const personaSnap = await collections.personas().doc(personaId).get();
  if (!personaSnap.exists) {
    throw Object.assign(new Error('페르소나를 찾을 수 없습니다.'), { status: 404 });
  }
  const persona = personaSnap.data();

  let quota;
  try {
    quota = await reserveRunQuota(tenantId);
  } catch (err) {
    if (err instanceof QuotaExceededError) throw Object.assign(err, { status: 429 });
    throw err;
  }

  // 페르소나가 스스로 정한 행동 수 상한을 존중하되, 테넌트 쿼터를 넘지는 못하게 min을 취한다.
  const maxActions = Math.min(persona.maxActions || quota.maxActionsPerRun, quota.maxActionsPerRun);
  const maxActionsPerCheckpoint = Math.max(3, Math.floor(maxActions / checkpointDefs.length));

  const checkpoints = {};
  checkpointDefs.forEach(({ goal, type, verify, mock }, index) => {
    checkpoints[index] = {
      goal,
      type,
      verify: verify || null,
      mock: mock || null,
      status: 'pending',
      steps: [],
      uiuxFindings: [],
    };
  });

  const runRef = await collections.testRuns(tenantId).add({
    targetUrl,
    registeredUrlId,
    personaId,
    personaName: persona.name,
    routeId: routeId || null,
    routeName: routeName || null,
    status: 'queued',
    checkpoints,
    browserEngine: browserEngine || null,
    maxActionsPerCheckpoint,
    haltedAtCheckpoint: null,
    createdBy: uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { id: runRef.id, status: 'queued' };
}

const createSchema = z.object({
  registeredUrlId: z.string().min(1),
  personaId: z.string().min(1),
  routeId: z.string().min(1).optional(),
  // 기본값은 안 넘긴다(=엔진 기본값인 Camoufox 스텔스) — webkit/chromium은 크로스 브라우저
  // 검증처럼 명시적으로 다른 엔진이 필요할 때만 고르는 선택 사항이다. webkit은 Camoufox
  // 같은 봇 탐지 우회 패치가 없으니, 소유권 검증된 자기 사이트에서 Safari 전용 렌더링
  // 차이를 잡아내려는 목적으로만 권장한다.
  browserEngine: z.enum(['chromium', 'firefox', 'webkit']).optional(),
});

router.post('/', testRunCreationLimiter, async (req, res) => {
  const parseResult = createSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'registeredUrlId, personaId가 필요합니다.' });
  }
  const { registeredUrlId, personaId, routeId, browserEngine } = parseResult.data;

  const urlSnap = await collections.registeredUrls(req.tenantId).doc(registeredUrlId).get();
  if (!urlSnap.exists) return res.status(404).json({ error: '등록된 URL을 찾을 수 없습니다.' });
  const urlData = urlSnap.data();
  if (!urlData.verified) {
    return res.status(403).json({ error: '이 URL은 아직 소유권이 검증되지 않았습니다.' });
  }

  // routeId가 있으면 그 여정의 체크포인트를, 없으면 "목표 없는 체크포인트 1개"를 합성해서
  // 자유 탐색(기존 동작)을 동일한 체크포인트 파이프라인으로 흘려보낸다.
  let routeName = null;
  let checkpointDefs;
  if (routeId) {
    const routeSnap = await collections.routes(req.tenantId).doc(routeId).get();
    if (!routeSnap.exists) return res.status(404).json({ error: '여정을 찾을 수 없습니다.' });
    const routeData = routeSnap.data();
    if (routeData.registeredUrlId !== registeredUrlId) {
      return res.status(400).json({ error: '이 여정은 선택한 URL과 연결되어 있지 않습니다.' });
    }
    routeName = routeData.name;
    checkpointDefs = routeData.checkpoints.map((c) => ({
      goal: c.goal,
      type: c.type || 'generic',
      verify: c.verify || null,
      mock: c.mock || null,
    }));
  } else {
    checkpointDefs = [{ goal: null, type: 'generic', verify: null, mock: null }];
  }

  try {
    const result = await createTestRun({
      tenantId: req.tenantId,
      uid: req.uid,
      targetUrl: urlData.url,
      registeredUrlId,
      personaId,
      routeId,
      routeName,
      checkpointDefs,
      browserEngine,
    });
    res.status(202).json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
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

// GitHub Actions/GitLab CI/Jenkins가 표준으로 소비하는 JUnit XML — CI 파이프라인에
// RepliQA를 다른 테스트 러너처럼 꽂아 넣을 수 있게 한다. X-RepliQA-Api-Key 인증도
// requireAuth가 이미 지원하므로, CI에서는 API 키만으로 바로 curl 가능하다.
router.get('/:id/junit.xml', async (req, res) => {
  const snap = await collections.testRuns(req.tenantId).doc(req.params.id).get();
  if (!snap.exists) return res.status(404).json({ error: '테스트 실행을 찾을 수 없습니다.' });
  const xml = buildJUnitXml({ id: snap.id, ...snap.data() });
  res.type('application/xml').send(xml);
});

// 스크린샷 저장소(Supabase/Firebase)는 클라이언트가 직접 접근할 권한이 없다 — 이 런이
// 정말 요청자의 테넌트 소유인지 먼저 확인한 뒤, 백엔드가 대신 서명 URL/데이터를 발급한다.
router.get('/:id/screenshots/:label', async (req, res) => {
  if (!/^[a-zA-Z0-9-]+$/.test(req.params.label)) {
    return res.status(400).json({ error: '잘못된 스크린샷 식별자입니다.' });
  }
  const snap = await collections.testRuns(req.tenantId).doc(req.params.id).get();
  if (!snap.exists) return res.status(404).json({ error: '테스트 실행을 찾을 수 없습니다.' });

  const path = `tenants/${req.tenantId}/testRuns/${req.params.id}/${req.params.label}.jpg`;
  try {
    const url = await getScreenshotUrl(path);
    res.json({ url });
  } catch {
    res.status(404).json({ error: '스크린샷을 찾을 수 없습니다.' });
  }
});

module.exports = router;
module.exports.createTestRun = createTestRun;
