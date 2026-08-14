const express = require('express');
const { z } = require('zod');
const { collections, admin } = require('../../db/firestore');
const { requireAuth, requireTenant } = require('../middleware/auth');
const { assertHttpUrl, SsrfViolationError } = require('../../security/ssrfGuard');
const {
  generateVerificationToken,
  verificationFileUrl,
  verifyUrlOwnership,
} = require('../../security/urlVerification');
const { encryptSecret } = require('../../security/crypto');
const { uploadEncryptedSession } = require('../../engine/sessionStore');
const env = require('../../config/env');

const router = express.Router();
router.use(requireAuth, requireTenant);

const registerSchema = z.object({ url: z.string().url() });
const credentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
// PG사마다 요구 필드가 달라서(카드번호/유효기간/CVC/생년월일 또는 사업자번호/예금주명 등)
// 고정 스키마 대신 전부 선택값으로 받는다. 실제 카드값은 LLM에 절대 노출되지 않는다
// (engine/llm/geminiAdapter.js의 identifyPaymentFields는 필드 "위치"만 묻는다).
const paymentMethodSchema = z
  .object({
    cardNumber: z.string().min(1).optional(),
    expiry: z.string().min(1).optional(),
    cvc: z.string().min(1).optional(),
    birthOrBusinessNo: z.string().min(1).optional(),
    cardHolderName: z.string().min(1).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: '결제 정보를 하나 이상 입력하세요.' });
// Playwright storageState 그대로(쿠키+로컬스토리지 스냅샷) — capture-session.js가 만들어서
// 보낸다. 정확한 내부 구조는 신경 쓰지 않고 통째로 암호화해서 저장했다가 그대로 복원한다.
const testSessionSchema = z.object({ storageState: z.record(z.string(), z.any()) });
// 이메일/문자 인증 코드를 읽어야 하는 여정용 — 지금은 Mailosaur 하나만 실제 지원
// (engine/testInbox.js). serverId/address는 Mailosaur 콘솔에서 발급받은 값.
const testInboxSchema = z.object({
  provider: z.enum(['mailosaur']),
  apiKey: z.string().min(1),
  serverId: z.string().min(1),
  address: z.string().email().optional(),
});

// verificationToken 자체는 절대 그대로 내보내지 않지만(값을 알아도 남이 쓸모는 없으나
// 굳이 노출할 이유가 없음), 아직 검증 안 된 URL은 그 토큰으로부터 유도되는 파일
// 경로/내용을 다시 보여줘야 한다 — 안 그러면 등록 직후 응답을 놓치거나 새로고침하면
// 그 URL을 검증할 방법을 다시 볼 수 없다(등록 직후 1회성 응답에만 있었음).
function stripSecrets(doc) {
  const { testCredentials, testPaymentMethod, testSessionPath, testInbox, verificationToken, ...rest } = doc;
  return {
    ...rest,
    hasTestCredentials: !!testCredentials,
    hasTestPaymentMethod: !!testPaymentMethod,
    hasTestSession: !!testSessionPath,
    hasTestInbox: !!testInbox,
    ...(!rest.verified && verificationToken
      ? {
          verificationFileUrl: verificationFileUrl(rest.url, verificationToken),
          verificationFileContent: verificationToken,
        }
      : {}),
  };
}

// 테스트 대상으로 쓸 URL을 등록한다. 이 시점엔 아직 verified=false이고,
// 소유권 검증(.well-known 파일)을 통과하기 전까지는 테스트 실행에 쓸 수 없다.
router.post('/', async (req, res) => {
  const parseResult = registerSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: '유효한 url이 필요합니다.' });
  }
  const { url } = parseResult.data;

  try {
    assertHttpUrl(url);
  } catch (err) {
    if (err instanceof SsrfViolationError) {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  }

  const token = generateVerificationToken();
  // skipOwnershipVerification이 켜져 있으면(지금 단계 기본값) 등록과 동시에 바로
  // verified=true로 만든다 — "검증하기"를 한 번 더 누르게 하는 것도 이 단계에선 불필요한
  // 마찰이라, 검증 자체를 아예 건너뛴다. verificationToken은 나중에 검증을 다시 켤 때를
  // 대비해 그대로 남겨둔다(재발급 없이 바로 정상 흐름으로 복귀 가능).
  const skip = env.skipOwnershipVerification;
  const docRef = await collections.registeredUrls(req.tenantId).add({
    url,
    verified: skip,
    verificationToken: token,
    ...(skip ? { verifiedAt: admin.firestore.FieldValue.serverTimestamp(), verificationSkipped: true } : {}),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  res.status(201).json({
    id: docRef.id,
    url,
    verified: skip,
    verificationSkipped: skip,
    verificationFileUrl: verificationFileUrl(url, token),
    verificationFileContent: token,
    instructions: skip
      ? '파일럿 모드: 소유권 검증을 건너뛰고 바로 등록됐습니다. 지금 바로 테스트를 실행할 수 있습니다.'
      : `${verificationFileUrl(url, token)} 경로에 "${token}" 내용을 담은 텍스트 파일을 올린 뒤 POST /api/urls/${docRef.id}/verify를 호출하세요.`,
  });
});

router.get('/', async (req, res) => {
  const snap = await collections.registeredUrls(req.tenantId).orderBy('createdAt', 'desc').get();
  res.json(snap.docs.map((d) => stripSecrets({ id: d.id, ...d.data() })));
});

// 실 사용자 계정을 받지 않는다 — 반드시 별도로 발급한 "테스트 계정"만 등록하도록 안내한다.
// 저장은 항상 암호화된 상태로만 하고, 응답 어디에도 평문/암호문을 되돌려주지 않는다.
router.put('/:id/test-credentials', async (req, res) => {
  const parseResult = credentialsSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'username, password가 필요합니다.' });
  }
  const ref = collections.registeredUrls(req.tenantId).doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: '등록된 URL을 찾을 수 없습니다.' });

  const encrypted = encryptSecret(JSON.stringify(parseResult.data));
  await ref.update({
    testCredentials: encrypted,
    testCredentialsUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  res.json({ id: snap.id, hasTestCredentials: true });
});

// 결제 체크포인트([결제] 태그)에서 자동 입력에 쓸 테스트 카드/계좌 정보. 반드시 PG
// 테스트/샌드박스 모드용 값만 등록하도록 안내 문구를 프론트에서 함께 보여준다.
router.put('/:id/test-payment-method', async (req, res) => {
  const parseResult = paymentMethodSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: '유효한 결제 정보가 필요합니다 (카드번호/유효기간/CVC 등 중 1개 이상).' });
  }
  const ref = collections.registeredUrls(req.tenantId).doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: '등록된 URL을 찾을 수 없습니다.' });

  const encrypted = encryptSecret(JSON.stringify(parseResult.data));
  await ref.update({
    testPaymentMethod: encrypted,
    testPaymentMethodUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  res.json({ id: snap.id, hasTestPaymentMethod: true });
});

// OAuth 소셜 로그인처럼 매번 자동화로 뚫기 어려운 로그인을 위한 우회 — 사람이 한 번
// 수동으로 로그인한 뒤 그 세션(쿠키+로컬스토리지)을 캡처해서 저장해두면, 이후 테스트는
// 이 세션을 불러와 "이미 로그인된 상태"로 시작한다(runEngine.js). backend/scripts/
// capture-session.js가 이 엔드포인트를 호출한다.
router.put('/:id/test-session', async (req, res) => {
  const parseResult = testSessionSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'storageState가 필요합니다 (capture-session.js로 캡처하세요).' });
  }
  const ref = collections.registeredUrls(req.tenantId).doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: '등록된 URL을 찾을 수 없습니다.' });

  const encrypted = encryptSecret(JSON.stringify(parseResult.data.storageState));
  const path = `tenants/${req.tenantId}/testSessions/${req.params.id}.json`;
  await uploadEncryptedSession(path, JSON.stringify(encrypted));
  await ref.update({
    testSessionPath: path,
    testSessionUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  res.json({ id: snap.id, hasTestSession: true });
});

// 이메일/문자 인증 코드, 비밀번호 재설정 링크를 읽어야 하는 여정용 테스트 인박스 설정.
router.put('/:id/test-inbox', async (req, res) => {
  const parseResult = testInboxSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'provider, apiKey, serverId가 필요합니다.' });
  }
  const ref = collections.registeredUrls(req.tenantId).doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: '등록된 URL을 찾을 수 없습니다.' });

  const encrypted = encryptSecret(JSON.stringify(parseResult.data));
  await ref.update({
    testInbox: encrypted,
    testInboxUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  res.json({ id: snap.id, hasTestInbox: true });
});

router.post('/:id/verify', async (req, res) => {
  const ref = collections.registeredUrls(req.tenantId).doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: '등록된 URL을 찾을 수 없습니다.' });

  const data = snap.data();
  if (data.verified) return res.json({ id: snap.id, verified: true });

  // 파일럿/로컬 고객 조사 전용 우회. 지인 소유 사이트 대상 검증처럼, 소유권 확인을
  // 굳이 자동화할 필요가 없는 상황에서만 .env로 명시적으로 켠다 — 프로덕션 배포에서는
  // 반드시 false여야 한다(안 그러면 아무 사이트나 등록해서 봇 트래픽을 보낼 수 있음).
  if (env.skipOwnershipVerification) {
    await ref.update({
      verified: true,
      verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      verificationSkipped: true,
    });
    return res.json({ id: snap.id, verified: true, verificationSkipped: true });
  }

  let result;
  try {
    result = await verifyUrlOwnership(data.url, data.verificationToken);
  } catch (err) {
    if (err instanceof SsrfViolationError) {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  }

  if (!result.verified) {
    return res.status(422).json({ verified: false, reason: result.reason });
  }

  await ref.update({ verified: true, verifiedAt: admin.firestore.FieldValue.serverTimestamp() });
  res.json({ id: snap.id, verified: true });
});

module.exports = router;
