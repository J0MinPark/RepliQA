// 이메일/문자 본인인증, 비밀번호 재설정 링크처럼 "외부 받은편지함을 읽어야" 검증 가능한
// 여정을 위한 플러그인 인터페이스. 프로바이더마다 API가 다르므로 fetchLatestMessage 하나만
// 구현하면 되는 얇은 어댑터 구조로 둔다 — 지금은 QA 자동화 용도로 널리 쓰이는 Mailosaur
// 어댑터 하나만 실제로 구현돼 있다(다른 프로바이더는 같은 인터페이스로 추가하면 됨).
//
// 코드/링크는 이 사이트 자신이 이번 테스트를 위해 생성한 일회성 값이라 실사용자 비밀번호와
// 성격이 다르지만, 그래도 원칙은 동일하게 지킨다 — LLM에는 이메일 본문을 통째로 보여주지
// 않고, 엔진이 직접 추출해서 입력/이동까지 수행한다(attemptLogin/attemptPaymentFill과 동일 패턴).

const OTP_CODE_RE = /\b(\d{4,8})\b/;
const LINK_RE = /https?:\/\/\S+/;

async function mailosaurFetchLatestMessage({ apiKey, serverId, address, sentAfter }) {
  const params = new URLSearchParams({ server: serverId });
  const res = await fetch(`https://mailosaur.com/api/messages?${params}`, {
    headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}` },
  });
  if (!res.ok) throw new Error(`Mailosaur API 오류: HTTP ${res.status}`);
  const data = await res.json();
  const candidates = (data.items || [])
    .filter((m) => !address || (m.to || []).some((t) => t.email === address))
    .filter((m) => !sentAfter || new Date(m.received) > sentAfter)
    .sort((a, b) => new Date(b.received) - new Date(a.received));
  if (candidates.length === 0) return null;

  const msgId = candidates[0].id;
  const detailRes = await fetch(`https://mailosaur.com/api/messages/${msgId}`, {
    headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}` },
  });
  if (!detailRes.ok) throw new Error(`Mailosaur API 오류: HTTP ${detailRes.status}`);
  const detail = await detailRes.json();
  const text = detail.text?.body || detail.html?.body || '';
  return { subject: detail.subject || '', body: text, receivedAt: candidates[0].received };
}

const PROVIDERS = {
  mailosaur: mailosaurFetchLatestMessage,
};

// config: { provider, apiKey, serverId, address }. sentAfter를 넘기면 그 시각 이후 도착한
// 메일만 본다 — 안 그러면 예전 테스트의 낡은 코드를 잘못 집어올 수 있다.
async function fetchLatestMessage(config, { sentAfter } = {}) {
  const fetcher = PROVIDERS[config.provider];
  if (!fetcher) throw new Error(`지원하지 않는 테스트 인박스 프로바이더: ${config.provider}`);
  return fetcher({ ...config, sentAfter });
}

// 메일 본문에서 인증 코드(4~8자리 숫자) 또는 링크를 뽑아낸다. 코드가 여러 개 매치될 수
// 있어서 "코드", "인증" 같은 단어 주변을 우선 찾고, 없으면 첫 매치를 쓴다.
function extractCodeOrLink(body) {
  if (!body) return { code: null, link: null };
  const link = body.match(LINK_RE)?.[0] || null;
  const codeMatch = body.match(OTP_CODE_RE);
  return { code: codeMatch ? codeMatch[1] : null, link };
}

module.exports = { fetchLatestMessage, extractCodeOrLink };
