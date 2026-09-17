import ipaddr from 'ipaddr.js';
export function validateUrl(value, origins) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !origins.includes(url.origin)) throw new Error('운영자가 등록한 HTTPS 사이트만 검사할 수 있습니다.');
  return url;
}
export function publicAddress(value) { try { return ipaddr.process(value).range() === 'unicast'; } catch { return false; } }
async function publicHost(host, fetchImpl) {
  if (ipaddr.isValid(host)) return publicAddress(host);
  const records = await Promise.all(['A', 'AAAA'].map(async (type) => {
    const response = await fetchImpl(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error('DNS 확인 실패');
    const result = await response.json();
    if (result.Status !== 0) throw new Error('DNS 확인 실패');
    return (result.Answer || []).filter((item) => [1, 28].includes(item.type)).map((item) => item.data);
  }));
  const addresses = records.flat(); return addresses.length > 0 && addresses.every(publicAddress);
}
export async function installGuard(context, tenant, fetchImpl = fetch) {
  const origins = JSON.parse(tenant.origins); const hosts = new Set([...origins.map((origin) => new URL(origin).hostname), ...JSON.parse(tenant.resource_hosts)]);
  const checked = new Map();
  await context.route('**/*', async (route) => {
    try {
      const request = route.request(); const url = new URL(request.url());
      if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !hosts.has(url.hostname)) throw new Error('허용하지 않은 요청');
      if (request.isNavigationRequest()) validateUrl(url.href, origins);
      if (!checked.has(url.hostname)) checked.set(url.hostname, publicHost(url.hostname, fetchImpl));
      if (!await checked.get(url.hostname)) throw new Error('비공개 네트워크');
      await route.continue();
    } catch { await route.abort('blockedbyclient'); }
  });
}
