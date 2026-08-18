const express = require('express');
const { z } = require('zod');
const { collections, admin } = require('../../db/firestore');
const { requireAuth, requireTenant } = require('../middleware/auth');
const { testRunCreationLimiter } = require('../middleware/rateLimit');
// createTestRun은 testRuns.js가 export하는 헬퍼다 — "여정 전체 실행"과 "체크포인트 하나만
// 격리 재실행"이 페르소나 조회/쿼터 예약/체크포인트 문서 구성 로직을 그대로 공유한다.
const { createTestRun } = require('./testRuns');

const router = express.Router();
router.use(requireAuth, requireTenant);

// 체크포인트는 자연어 한 줄 = 한 단계. AI로 파싱하지 않고 그대로 순서를 부여해서
// 저장한다 — 고객이 정확히 뭘 등록했는지 투명하게 보이고, 비용도 안 든다.
// 줄 맨 앞에 "[결제]"를 붙이면 그 단계는 결제 전용 처리(테스트 카드 자동입력 +
// 최종 제출 버튼 자동 클릭 금지)를 타는 체크포인트로 표시된다.
// "[장시간]"을 붙이면 wait 액션의 상한이 5초에서 30분으로 늘어난다 — 세션 만료처럼
// 실제 시간이 흘러야만 검증되는 시나리오 전용. 일반 체크포인트에는 절대 적용 안 됨
// (매 실행마다 30분씩 걸리면 안 되니까) — 명시적으로 태그를 붙인 단계만 해당.
const PAYMENT_TAG = /^\[결제\]\s*/;
const LONG_RUNNING_TAG = /^\[장시간\]\s*/;

// 줄 끝에 "[검증: type(인자)]"를 붙이면, "목표를 달성했다"는 LLM 자기 판단과는 별개로
// 엔진이 실제 브라우저/네트워크 상태를 직접 확인한다(runEngine.js의
// runDeterministicVerify) — Playwright의 expect()처럼 에이전트와 독립적인 판정을 만들어서,
// 자유 탐색이 아닌 "정확히 이 상태가 돼야 성공"이 명확한 핵심 플로우(로그인/결제완료 등)에
// 결정론적 근거를 더하는 용도다. 지원하는 3가지:
//   url_contains("/cart")                — 최종 URL에 이 문자열이 포함되는가
//   text_visible("주문이 완료되었습니다")   — 페이지 텍스트에 이 문자열이 보이는가
//   network_status("/api/orders", 200)   — 이 URL 패턴으로 이 상태 코드 응답이 있었는가
// 선택 사항이라 안 붙이면 지금까지처럼 자유 탐색/LLM 판단 그대로 동작한다.
const VERIFY_TAG = /\s*\[검증:\s*(url_contains|text_visible|network_status)\(([^)]*)\)\]\s*$/;

function parseVerifyArgs(type, argsRaw) {
  const args = argsRaw.split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''));
  if (type === 'url_contains' || type === 'text_visible') {
    if (!args[0]) return null;
    return { type, value: args[0] };
  }
  if (type === 'network_status') {
    const status = Number(args[1]);
    if (!args[0] || Number.isNaN(status)) return null;
    return { type, urlPattern: args[0], status };
  }
  return null;
}

// 줄 끝에 "[모킹: force_status(urlPattern, status)]" 또는
// "[모킹: force_response(urlPattern, status, body)]"를 붙이면, 그 체크포인트가 실행되는
// 동안 해당 URL 패턴으로 나가는 네트워크 요청에 실제 서버 응답 대신 강제로 지정한
// 상태코드/본문을 돌려준다(Playwright의 page.route()/Cypress의 cy.intercept()와 같은
// 원리). 에러 응답·빈 목록 같은 엣지케이스를 대상 서버 협조 없이 재현하려는 용도다.
// [검증]과 마찬가지로 선택 사항이고, 순서 상관없이 [검증]과 같이 쓸 수 있다.
const MOCK_TAG = /\s*\[모킹:\s*(force_status|force_response)\(([^)]*)\)\]\s*$/;

function parseMockArgs(type, argsRaw) {
  // body(force_response)에 쉼표가 포함될 수 있어서(JSON 등) 처음 등장하는 쉼표 1~2개만
  // 구분자로 쓰고 나머지는 그대로 body로 취급한다 — verify처럼 전부 split(',')하면 안 됨.
  const firstComma = argsRaw.indexOf(',');
  if (firstComma === -1) return null;
  const urlPattern = argsRaw.slice(0, firstComma).trim().replace(/^["']|["']$/g, '');
  const rest = argsRaw.slice(firstComma + 1);
  if (!urlPattern) return null;

  if (type === 'force_status') {
    const status = Number(rest.trim());
    if (Number.isNaN(status)) return null;
    return { type, urlPattern, status, body: null };
  }
  if (type === 'force_response') {
    const secondComma = rest.indexOf(',');
    if (secondComma === -1) return null;
    const status = Number(rest.slice(0, secondComma).trim());
    const body = rest.slice(secondComma + 1).trim().replace(/^["']|["']$/g, '');
    if (Number.isNaN(status) || !body) return null;
    return { type, urlPattern, status, body };
  }
  return null;
}

const createSchema = z.object({
  name: z.string().min(1),
  registeredUrlId: z.string().min(1),
  checkpoints: z.array(z.string().min(1)).min(1).max(10),
});

function parseCheckpoint(raw, order) {
  // [검증]/[모킹] 둘 다 줄 끝에 붙는 접미 태그라 순서 상관없이 같이 쓸 수 있어야 한다 —
  // 뒤에서부터 반복해서 하나씩 벗겨낸다.
  let remaining = raw;
  let verify = null;
  let mock = null;
  for (;;) {
    if (!verify) {
      const verifyMatch = remaining.match(VERIFY_TAG);
      if (verifyMatch) {
        verify = parseVerifyArgs(verifyMatch[1], verifyMatch[2]);
        remaining = remaining.slice(0, verifyMatch.index);
        continue;
      }
    }
    if (!mock) {
      const mockMatch = remaining.match(MOCK_TAG);
      if (mockMatch) {
        mock = parseMockArgs(mockMatch[1], mockMatch[2]);
        remaining = remaining.slice(0, mockMatch.index);
        continue;
      }
    }
    break;
  }

  const isPayment = PAYMENT_TAG.test(remaining);
  const isLongRunning = LONG_RUNNING_TAG.test(remaining);
  const goal = remaining.replace(PAYMENT_TAG, '').replace(LONG_RUNNING_TAG, '').trim();
  const type = isPayment ? 'payment' : isLongRunning ? 'long_running' : 'generic';
  return { order, goal, type, verify, mock };
}

router.post('/', async (req, res) => {
  const parseResult = createSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'name, registeredUrlId, checkpoints(1~10개)가 필요합니다.' });
  }
  const { name, registeredUrlId, checkpoints } = parseResult.data;

  const urlSnap = await collections.registeredUrls(req.tenantId).doc(registeredUrlId).get();
  if (!urlSnap.exists) return res.status(404).json({ error: '등록된 URL을 찾을 수 없습니다.' });

  const parsedCheckpoints = checkpoints.map(parseCheckpoint);

  const docRef = await collections.routes(req.tenantId).add({
    name,
    registeredUrlId,
    checkpoints: parsedCheckpoints,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  res.status(201).json({ id: docRef.id, name, registeredUrlId, checkpoints: parsedCheckpoints });
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

const runCheckpointSchema = z.object({
  personaId: z.string().min(1),
  browserEngine: z.enum(['chromium', 'firefox', 'webkit']).optional(),
});

// Cypress Component Testing(소스코드 레벨 컴포넌트 마운트)은 RepliQA의 블랙박스 구조와
// 근본적으로 안 맞아서 그대로 옮길 수 없다 — 대신 "체크포인트 단위 격리 재실행"으로
// 재해석한다. 여정 전체가 아니라 특정 체크포인트 하나만 빠르게 반복 검증할 수 있게 한다.
// 알려진 한계: 항상 등록된 URL 루트부터 시작한다 — 여정 안에서 index번째 체크포인트가
// 원래 실행되던 "직전 체크포인트가 만들어둔 중간 상태"까지 재현하지는 않는다. goal이
// 자기완결적인 체크포인트(예: "장바구니 페이지로 이동해서 결제하기")는 잘 맞지만, 직전
// 맥락에 의존하는 goal(예: "완료 버튼을 눌러라")은 그 맥락까지 AI가 스스로 도달해야 한다.
router.post('/:id/checkpoints/:index/run', testRunCreationLimiter, async (req, res) => {
  const parseResult = runCheckpointSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'personaId가 필요합니다.' });
  }
  const { personaId, browserEngine } = parseResult.data;

  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0) {
    return res.status(400).json({ error: '유효하지 않은 체크포인트 인덱스입니다.' });
  }

  const routeSnap = await collections.routes(req.tenantId).doc(req.params.id).get();
  if (!routeSnap.exists) return res.status(404).json({ error: '여정을 찾을 수 없습니다.' });
  const routeData = routeSnap.data();
  const checkpoint = routeData.checkpoints?.[index];
  if (!checkpoint) return res.status(404).json({ error: '해당 인덱스의 체크포인트를 찾을 수 없습니다.' });

  const urlSnap = await collections.registeredUrls(req.tenantId).doc(routeData.registeredUrlId).get();
  if (!urlSnap.exists) return res.status(404).json({ error: '등록된 URL을 찾을 수 없습니다.' });
  const urlData = urlSnap.data();
  if (!urlData.verified) {
    return res.status(403).json({ error: '이 URL은 아직 소유권이 검증되지 않았습니다.' });
  }

  try {
    const result = await createTestRun({
      tenantId: req.tenantId,
      uid: req.uid,
      targetUrl: urlData.url,
      registeredUrlId: routeData.registeredUrlId,
      personaId,
      routeId: routeSnap.id,
      routeName: `${routeData.name} — 체크포인트 ${index + 1}만 격리 재실행`,
      checkpointDefs: [
        {
          goal: checkpoint.goal,
          type: checkpoint.type || 'generic',
          verify: checkpoint.verify || null,
          mock: checkpoint.mock || null,
        },
      ],
      browserEngine,
    });
    res.status(202).json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

module.exports = router;
module.exports.parseCheckpoint = parseCheckpoint;
