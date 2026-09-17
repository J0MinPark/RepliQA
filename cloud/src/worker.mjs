import { jobSchema, LIMITS } from './schema.mjs';
import { authenticate, hash, reserve, recover, ownedRun, finish } from './repository.mjs';
import { installGuard, validateUrl, sessionGuardrails } from './target-guard.mjs';
import { runBrowser } from './runner.mjs';
import { reviewScreen } from './ai.mjs';
import {createNetworkRelay} from './network-relay.mjs';
export {NetworkRelay} from './network-relay.mjs';

const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" };
function json(value, status = 200) { return Response.json(value, { status, headers }); }
async function body(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('JSON 요청이 필요합니다.');
  const reader = request.body?.getReader(); if (!reader) throw new Error('요청 내용이 없습니다.');
  const chunks = []; let size = 0;
  for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 20000) { await reader.cancel(); throw new Error('요청은 20KB 이하여야 합니다.'); } chunks.push(Buffer.from(value)); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function handle(request, env, runtime = {}) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) {
    const result = await env.ASSETS.fetch(request); const secured = new Response(result.body, result);
    for (const [key, value] of Object.entries(headers)) secured.headers.set(key, value);
    return secured;
  }
  if (url.pathname === '/api/health') return json({ service: 'RepliQA Cloud Pilot', version:'0.2.7', ready: env.FREE_PLAN_CONFIRMED === 'true' && Boolean(env.NETWORK_RELAY), networkRelay: Boolean(env.NETWORK_RELAY), localGpuRequired: false, aiEnabled: env.CLOUD_AI_ENABLED === 'true',inspectionModes:['basic','journey'] });
  if (env.FREE_PLAN_CONFIRMED !== 'true') return json({ error: '무료 요금제 확인 후 서비스를 열 수 있습니다.' }, 503);
  if (request.headers.get('origin') && request.headers.get('origin') !== url.origin) return json({ error: '허용하지 않은 출처입니다.' }, 403);
  const tenant = await authenticate(env.DB, request.headers.get('authorization'));
  if (!tenant) return json({ error: '초대 키를 확인하세요.' }, 401);
  if (url.pathname === '/api/validate-plan' && request.method === 'POST') {
    const job = jobSchema.parse(await body(request)); validateUrl(job.url, JSON.parse(tenant.origins));
    return json({ job: { ...job, cloudAiConsent: false } });
  }
  const parts = url.pathname.split('/').filter(Boolean); const id = parts[2];
  if (id && !/^[a-f0-9-]{36}$/.test(id)) return json({ error: '잘못된 실행 ID입니다.' }, 400);
  if (parts[1] === 'me' && request.method === 'GET') return json({ origins: JSON.parse(tenant.origins), limits: LIMITS, aiEnabled: env.CLOUD_AI_ENABLED === 'true' });
  if (parts[1] !== 'runs') return json({ error: '찾을 수 없습니다.' }, 404);
  if (!id && request.method === 'GET') {
    const { results } = await env.DB.prepare("SELECT id,status,created_at,expires_at,report FROM runs WHERE tenant_id = ? AND status != 'deleted' AND expires_at > ? ORDER BY created_at DESC LIMIT 20").bind(tenant.id, Date.now()).all();
    return json({ runs: results.map((item) => ({ ...item, report: item.report ? JSON.parse(item.report) : null })) });
  }
  if (!id && request.method === 'POST') {
    const key = request.headers.get('idempotency-key');
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(key || '')) return json({ error: '요청 ID가 필요합니다.' }, 400);
    const job = jobSchema.parse(await body(request)); validateUrl(job.url, JSON.parse(tenant.origins));
    if (job.cloudAiConsent && env.CLOUD_AI_ENABLED !== 'true') return json({ error: '클라우드 AI가 아직 활성화되지 않았습니다.' }, 503);
    await recover(env.DB);
    const result = await reserve(env.DB, tenant.id, key, await hash(JSON.stringify(job)));
    return json(result, result.error ? result.status : result.created ? 201 : 200);
  }
  const run = id ? await ownedRun(env.DB, tenant.id, id) : null;
  if (!run || run.status === 'deleted' || run.expires_at < Date.now()) return json({ error: '검사 결과를 찾을 수 없습니다.' }, 404);
  if (parts[3] === 'screenshot' && request.method === 'GET') {
    const image = await env.DB.prepare('SELECT screenshot FROM runs WHERE tenant_id = ? AND id = ?').bind(tenant.id, id).first();
    // D1 reads BLOB values as number arrays; Response needs binary bytes.
    return image?.screenshot ? new Response(new Uint8Array(image.screenshot), { headers: { ...headers, 'content-type': 'image/jpeg' } }) : json({ error: '화면이 없습니다.' }, 404);
  }
  if (parts[3] === 'cancel' && request.method === 'POST') {
    await env.DB.prepare("UPDATE runs SET cancel_requested = 1, status = 'cancelled', finished_at = ? WHERE tenant_id = ? AND id = ? AND status IN ('ready','running')").bind(Date.now(), tenant.id, id).run();
    return json({ cancelled: true });
  }
  if (!parts[3] && request.method === 'DELETE') {
    if (['ready','running'].includes(run.status)) return json({ error: '검사를 먼저 취소하세요.' }, 409);
    await env.DB.prepare("UPDATE runs SET status = 'deleted', report = NULL, screenshot = NULL WHERE tenant_id = ? AND id = ? AND status NOT IN ('ready','running')").bind(tenant.id, id).run();
    return json({ deleted: true });
  }
  if (parts[3] === 'execute' && request.method === 'POST') {
    const job = jobSchema.parse(await body(request)); validateUrl(job.url, JSON.parse(tenant.origins));
    if (job.cloudAiConsent && env.CLOUD_AI_ENABLED !== 'true') return json({ error: '클라우드 AI가 비활성화되어 요청을 실행하지 않았습니다.' }, 503);
    if (await hash(JSON.stringify(job)) !== run.fingerprint) return json({ error: '검토한 검사 내용과 다릅니다.' }, 409);
    if (request.signal.aborted) return json({ id, error: '실행 전에 연결이 중단되었습니다.' }, 503);
    const now = Date.now();
    const claim = await env.DB.prepare("UPDATE runs SET status = 'running', started_at = ? WHERE tenant_id = ? AND id = ? AND status = 'ready' AND created_at > ? AND cancel_requested = 0").bind(now, tenant.id, id, now - 60000).run();
    if (claim.meta.changes !== 1) return json({ error: '이미 실행했거나 만료된 요청입니다. 중복 실행하지 않았습니다.' }, 409);
    const controller = new AbortController(); const deadline = setTimeout(() => controller.abort(), LIMITS.totalMs);
    const disconnected = () => controller.abort(); request.signal.addEventListener('abort', disconnected, { once: true });
    if (request.signal.aborted) controller.abort();
    let polling = false;
    const poll = setInterval(async () => {
      if (polling) return; polling = true;
      try { const state = await ownedRun(env.DB, tenant.id, id); const active = await authenticate(env.DB, request.headers.get('authorization')); if (!active || !state || state.cancel_requested || state.status !== 'running') controller.abort(); }
      catch { controller.abort(); } finally { polling = false; }
    }, 2000);
    let relay;
    try {
      controller.signal.throwIfAborted();
      relay=runtime.runBrowser?null:await createNetworkRelay(env.NETWORK_RELAY,tenant,id);
      controller.signal.throwIfAborted();
      const execution = (runtime.runBrowser || runBrowser)(job, { launch: async () => (await import('@cloudflare/playwright')).launch(env.BROWSER, { guardrails: sessionGuardrails(tenant) }), guard: (context) => installGuard(context, tenant,fetch,relay), signal: controller.signal,
        review: env.CLOUD_AI_ENABLED === 'true' ? (data, screenshot) => reviewScreen(env.AI, data, screenshot) : null });
      const aborted = new Promise((_, reject) => { const stop = () => reject(new Error('검사가 중단되었습니다.')); if (controller.signal.aborted) stop(); else controller.signal.addEventListener('abort', stop, { once: true }); });
      const { report, screenshot } = await Promise.race([execution, aborted]);
      const saved = await finish(env.DB, tenant.id, id, report, screenshot);
      return saved.meta.changes ? json({ id, report }) : json({ id, error: '검사가 취소되어 결과를 저장하지 않았습니다.' }, 409);
    } catch {
      // If persistence is down, leave the lease for recovery; never report a client 400.
      try { await finish(env.DB, tenant.id, id, { status: 'inconclusive', error: '실행이 중단되었습니다. 대상 상태를 확인하세요.' }, null, 'interrupted'); } catch {}
      return json({ id, error: '검사가 중단되었습니다. 실행 내역에서 상태를 확인하세요.' }, 503);
    } finally { clearTimeout(deadline); clearInterval(poll); request.signal.removeEventListener('abort', disconnected); await relay?.close().catch(()=>{}); }
  }
  if (!parts[3] && request.method === 'GET') return json({ ...run, report: run.report ? JSON.parse(run.report) : null });
  return json({ error: '지원하지 않는 요청입니다.' }, 405);
}
export default {
  async fetch(request, env) { try { return await handle(request, env); } catch (error) { return json({ error: error?.name === 'ZodError' ? '검사 입력을 확인하세요. 경로·최종 문구·동작이 필요합니다.' : '요청을 처리하지 못했습니다. 입력과 서비스 설정을 확인하세요.' }, 400); } },
  async scheduled(_event, env) { await recover(env.DB); },
};
