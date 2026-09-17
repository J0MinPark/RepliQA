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
  let stopping=false;
  // Coalesce only concurrent lookups. Do not retain resolved DNS answers:
  // a later request must observe rebinding instead of a stale positive cache.
  const dnsInFlight=new Map();
  const checkHost=host=>{
    if(!dnsInFlight.has(host))dnsInFlight.set(host,(async()=>{
      // A short collection window groups near-simultaneous browser asset
      // events even when the DNS provider responds faster than those events.
      await new Promise(resolve=>setTimeout(resolve,25));
      return publicHost(host,fetchImpl);
    })().finally(()=>dnsInFlight.delete(host)));
    return dnsInFlight.get(host);
  };
  const state = { blockedRequests: 0, failedRequests: 0, cancelledAtShutdown: 0, events: [], finish:()=>{stopping=true;} };
  const record=(kind,request)=>{
    if(state.events.length>=20)return;
    let origin;try{origin=new URL(request?.url()).origin;}catch{}
    state.events.push({kind,origin,resourceType:request?.resourceType?.()});
  };
  // WebSocket journeys are unsupported; never connect upstream.
  await context.routeWebSocket('**/*', socket => { if(!stopping){state.blockedRequests++;record('websocket');} return socket.close(); });
  await context.route('**/*', async (route) => {
    let stage='policy';const request=route.request();
    try {
      if(stopping){state.cancelledAtShutdown++;await route.abort('blockedbyclient').catch(()=>{});return;}
      const url = new URL(request.url());
      if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !hosts.has(url.hostname)) throw new Error('허용하지 않은 요청');
      if (request.isNavigationRequest()) validateUrl(url.href, origins);
      // Recheck each request. This is preflight, not transport-level IP pinning.
      stage='dns';
      const isPublic=await checkHost(url.hostname);
      if(stopping){state.cancelledAtShutdown++;await route.abort('blockedbyclient').catch(()=>{});return;}
      stage='policy';if (!isPublic) throw new Error('비공개 네트워크');
      // Chromium may follow HTTP redirects without another route callback.
      // Fail closed rather than allowing an unchecked redirect destination.
      stage='transport';const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 10000 });
      try {
        stage='redirect';
        if (response.status() >= 300 && response.status() < 400 && response.status() !== 304) throw new Error('HTTP 리디렉션은 현재 지원하지 않습니다. 최종 HTTPS 주소를 등록하세요.');
        stage='transport';
        await route.fulfill({ response });
      } finally { await response.dispose(); }
    } catch {
      if(stopping)state.cancelledAtShutdown++;
      else {if(['policy','redirect'].includes(stage))state.blockedRequests++;else state.failedRequests++;record(stage,request);}
      await route.abort('blockedbyclient').catch(()=>{});
    }
  });
  return state;
}
export function sessionGuardrails(tenant) {
  const allowedDomains = [...new Set([...JSON.parse(tenant.origins).map(origin => new URL(origin).hostname), ...JSON.parse(tenant.resource_hosts)])];
  if (!allowedDomains.length || allowedDomains.length > 50 || allowedDomains.some(host => !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(host))) throw new Error('검사 호스트 설정을 확인하세요.');
  return { allowedDomains };
}
