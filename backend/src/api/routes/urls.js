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

const router = express.Router();
router.use(requireAuth, requireTenant);

const registerSchema = z.object({ url: z.string().url() });
const credentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

function stripSecrets(doc) {
  const { testCredentials, verificationToken, ...rest } = doc;
  return { ...rest, hasTestCredentials: !!testCredentials };
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
  const docRef = await collections.registeredUrls(req.tenantId).add({
    url,
    verified: false,
    verificationToken: token,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  res.status(201).json({
    id: docRef.id,
    url,
    verified: false,
    verificationFileUrl: verificationFileUrl(url, token),
    verificationFileContent: token,
    instructions: `${verificationFileUrl(url, token)} 경로에 "${token}" 내용을 담은 텍스트 파일을 올린 뒤 POST /api/urls/${docRef.id}/verify를 호출하세요.`,
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

router.post('/:id/verify', async (req, res) => {
  const ref = collections.registeredUrls(req.tenantId).doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: '등록된 URL을 찾을 수 없습니다.' });

  const data = snap.data();
  if (data.verified) return res.json({ id: snap.id, verified: true });

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
