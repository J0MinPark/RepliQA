const dns = require('dns').promises;
const net = require('net');

// RepliQA는 사용자가 준 URL을 서버가 직접 fetch/navigate 하는 구조라
// 내부망·클라우드 메타데이터 엔드포인트로 요청을 흘려보내는 SSRF가 핵심 위협이다.
// 등록 시점 검증만으로는 DNS 리바인딩(TOCTOU)에 뚫릴 수 있어서, 실행 직전에도
// 다시 검증하고 resolveSafeIp가 돌려준 IP를 Playwright 브라우저의
// --host-resolver-rules로 고정시켜(=IP pinning) 검증 이후 재조회가 다른 IP를
// 가리키는 경우를 막는다.

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

function ipv4ToLong(ip) {
  return ip.split('.').reduce((acc, part) => (acc << 8) + parseInt(part, 10), 0) >>> 0;
}

function isPrivateOrReservedIPv4(ip) {
  const long = ipv4ToLong(ip);
  const ranges = [
    ['0.0.0.0', '0.255.255.255'],
    ['10.0.0.0', '10.255.255.255'],
    ['100.64.0.0', '100.127.255.255'], // carrier-grade NAT
    ['127.0.0.0', '127.255.255.255'], // loopback
    ['169.254.0.0', '169.254.255.255'], // link-local, includes cloud metadata (169.254.169.254)
    ['172.16.0.0', '172.31.255.255'],
    ['192.0.0.0', '192.0.0.255'],
    ['192.168.0.0', '192.168.255.255'],
    ['198.18.0.0', '198.19.255.255'],
    ['224.0.0.0', '255.255.255.255'], // multicast/reserved
  ];
  return ranges.some(([start, end]) => long >= ipv4ToLong(start) && long <= ipv4ToLong(end));
}

function isPrivateOrReservedIPv6(ip) {
  const normalized = ip.toLowerCase();
  if (normalized === '::1') return true; // loopback
  if (normalized === '::') return true;
  if (normalized.startsWith('fe80:')) return true; // link-local
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // unique local (fc00::/7)
  if (normalized.startsWith('::ffff:')) {
    // IPv4-mapped IPv6 — unwrap and check the IPv4 rules too
    const mapped = normalized.replace('::ffff:', '');
    if (net.isIPv4(mapped)) return isPrivateOrReservedIPv4(mapped);
  }
  return false;
}

function isDisallowedIp(ip) {
  if (net.isIPv4(ip)) return isPrivateOrReservedIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateOrReservedIPv6(ip);
  return true; // 알 수 없는 형식은 거부
}

class SsrfViolationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SsrfViolationError';
  }
}

function assertHttpUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new SsrfViolationError('유효하지 않은 URL입니다.');
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new SsrfViolationError(`허용되지 않는 프로토콜입니다: ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) {
    throw new SsrfViolationError('URL에 자격증명을 포함할 수 없습니다.');
  }
  if (parsed.hostname === 'localhost' || parsed.hostname.endsWith('.local')) {
    throw new SsrfViolationError('localhost/.local 호스트는 허용되지 않습니다.');
  }
  if (net.isIP(parsed.hostname) && isDisallowedIp(parsed.hostname)) {
    throw new SsrfViolationError('사설/예약된 IP 대역은 허용되지 않습니다.');
  }
  return parsed;
}

// hostname을 실제로 resolve해서 사설 IP가 아님을 확인하고, pin에 사용할 IP를 돌려준다.
async function resolveSafeIp(hostname) {
  if (net.isIP(hostname)) {
    if (isDisallowedIp(hostname)) {
      throw new SsrfViolationError('사설/예약된 IP 대역은 허용되지 않습니다.');
    }
    return hostname;
  }

  let records;
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new SsrfViolationError(`호스트를 resolve할 수 없습니다: ${hostname}`);
  }
  if (records.length === 0) {
    throw new SsrfViolationError(`호스트를 resolve할 수 없습니다: ${hostname}`);
  }
  for (const record of records) {
    if (isDisallowedIp(record.address)) {
      throw new SsrfViolationError(
        `${hostname}이(가) 허용되지 않는 사설/예약 IP(${record.address})로 resolve됩니다.`
      );
    }
  }
  // 첫 번째 안전한 IP를 pin 대상으로 사용 (host-resolver-rules는 단일 매핑만 지원)
  return records[0].address;
}

// 등록/실행 양쪽에서 재사용하는 종합 검증. 실행 직전 호출 시 반환된 pinnedIp를
// Playwright 브라우저 launch args의 host-resolver-rules에 그대로 넣는다.
async function assertSafeUrl(urlString) {
  const parsed = assertHttpUrl(urlString);
  const pinnedIp = await resolveSafeIp(parsed.hostname);
  return { parsed, pinnedIp };
}

// 벤치마크 하네스(예: WebArena 로컬 Docker 샌드박스) 같은 신뢰된 로컬 스크립트가
// 의도적으로 사설 대상을 실행할 때만 쓰는 이스케이프 해치다 — 공개 API/워커 경로
// (routes.js/worker.js)에서는 절대 호출되지 않으며, resolveSafeIp의 차단 정책은
// 그대로 두고 hostname resolve 로직만 재사용한다.
async function resolveIpUnchecked(hostname) {
  if (net.isIP(hostname)) return hostname;
  let records;
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new SsrfViolationError(`호스트를 resolve할 수 없습니다: ${hostname}`);
  }
  if (records.length === 0) {
    throw new SsrfViolationError(`호스트를 resolve할 수 없습니다: ${hostname}`);
  }
  return records[0].address;
}

module.exports = {
  SsrfViolationError,
  assertHttpUrl,
  resolveSafeIp,
  resolveIpUnchecked,
  assertSafeUrl,
  isDisallowedIp,
};
