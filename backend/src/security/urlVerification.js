const crypto = require('crypto');
const { assertSafeUrl, SsrfViolationError } = require('./ssrfGuard');

function generateVerificationToken() {
  return crypto.randomBytes(16).toString('hex');
}

function verificationFileUrl(targetUrl, token) {
  const parsed = new URL(targetUrl);
  return `${parsed.protocol}//${parsed.host}/.well-known/repliqa-verify-${token}.txt`;
}

// 등록하려는 도메인의 실제 소유자만 접근 가능한 파일을 두게 해서 URL 소유권을 증명한다.
// 리다이렉트는 따라가지 않는다 — 검증 통과 후 다른(사설) 호스트로 리다이렉트시켜
// 우회하는 걸 막기 위함. 파일 다운로드 자체가 SSRF 표면이므로 fetch 전에도 가드를 태운다.
async function verifyUrlOwnership(targetUrl, token) {
  await assertSafeUrl(targetUrl); // SsrfViolationError를 던지면 그대로 전파됨
  const checkUrl = verificationFileUrl(targetUrl, token);

  let response;
  try {
    response = await fetch(checkUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    return { verified: false, reason: `검증 파일에 접근할 수 없습니다: ${err.message}` };
  }

  if (response.status !== 200) {
    return { verified: false, reason: `검증 파일을 찾을 수 없습니다 (HTTP ${response.status}).` };
  }

  const body = (await response.text()).trim();
  if (body !== token) {
    return { verified: false, reason: '검증 파일의 내용이 토큰과 일치하지 않습니다.' };
  }

  return { verified: true };
}

module.exports = { generateVerificationToken, verificationFileUrl, verifyUrlOwnership, SsrfViolationError };
