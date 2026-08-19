// 이메일/문자 본인인증, 비밀번호 재설정 링크처럼 "외부 받은편지함을 읽어야" 검증 가능한
// 여정을 위한 플러그인 인터페이스. 프로바이더마다 API가 다르므로 fetchLatestMessage 하나만
// 구현하면 되는 얇은 어댑터 구조로 둔다. QA 자동화 용도로 널리 쓰이는 Mailosaur(유료,
// 서버 사전 설정 필요)와, 가입 없이 그 자리에서 메일함을 만들 수 있는 mail.tm(무료) 두
// 프로바이더가 있다 — 기본값은 mail.tm이고, Mailosaur는 이미 그 인프라를 갖춘 팀을 위한
// 선택지로 남겨둔다.
//
// 코드/링크는 이 사이트 자신이 이번 테스트를 위해 생성한 일회성 값이라 실사용자 비밀번호와
// 성격이 다르지만, 그래도 원칙은 동일하게 지킨다 — LLM에는 이메일 본문을 통째로 보여주지
// 않고, 엔진이 직접 추출해서 입력/이동까지 수행한다(attemptLogin/attemptPaymentFill과 동일 패턴).

const crypto = require('crypto');

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

// mail.tm — 가입/결제/API 키 발급 없이 그 자리에서 메일함을 만들 수 있는 무료 서비스라,
// Mailosaur(유료, 서버 사전 설정 필요)를 구할 수 없는 사용자를 위한 기본값으로 쓴다.
// 메일함 자체가 "계정=주소+비밀번호"라서, apiKey/serverId 대신 그 둘만 있으면 된다.
async function mailtmFetchLatestMessage({ address, password, sentAfter }) {
  const tokenRes = await fetch('https://api.mail.tm/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, password }),
  });
  if (!tokenRes.ok) throw new Error(`mail.tm 로그인 실패: HTTP ${tokenRes.status}`);
  const { token } = await tokenRes.json();
  const authHeaders = { Authorization: `Bearer ${token}` };

  const listRes = await fetch('https://api.mail.tm/messages', { headers: authHeaders });
  if (!listRes.ok) throw new Error(`mail.tm API 오류: HTTP ${listRes.status}`);
  const listData = await listRes.json();
  const candidates = (listData['hydra:member'] || [])
    .filter((m) => !sentAfter || new Date(m.createdAt) > sentAfter)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (candidates.length === 0) return null;

  const detailRes = await fetch(`https://api.mail.tm/messages/${candidates[0].id}`, { headers: authHeaders });
  if (!detailRes.ok) throw new Error(`mail.tm API 오류: HTTP ${detailRes.status}`);
  const detail = await detailRes.json();
  const text = detail.text || (detail.html || []).join('\n') || '';
  return { subject: detail.subject || '', body: text, receivedAt: candidates[0].createdAt };
}

// 새 mail.tm 메일함을 즉석에서 만든다 — 프론트의 "무료 테스트 메일함 자동 생성" 버튼이
// 호출하는 백엔드 라우트(urls.js)에서 쓴다. 랜덤 주소/비밀번호라 충돌 걱정 없이 매번 새로
// 만들면 된다.
async function provisionMailtmInbox() {
  const domainsRes = await fetch('https://api.mail.tm/domains');
  if (!domainsRes.ok) throw new Error(`mail.tm API 오류: HTTP ${domainsRes.status}`);
  const domainsData = await domainsRes.json();
  const domain = domainsData['hydra:member']?.[0]?.domain;
  if (!domain) throw new Error('mail.tm에서 사용 가능한 도메인을 찾지 못했습니다.');

  const address = `repliqa-${crypto.randomBytes(6).toString('hex')}@${domain}`;
  const password = crypto.randomBytes(12).toString('hex');

  const createRes = await fetch('https://api.mail.tm/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, password }),
  });
  if (!createRes.ok) throw new Error(`mail.tm 메일함 생성 실패: HTTP ${createRes.status}`);

  return { address, password };
}

const PROVIDERS = {
  mailosaur: mailosaurFetchLatestMessage,
  mailtm: mailtmFetchLatestMessage,
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

module.exports = { fetchLatestMessage, extractCodeOrLink, provisionMailtmInbox };
