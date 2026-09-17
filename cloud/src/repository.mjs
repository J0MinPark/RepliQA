import { LIMITS } from './schema.mjs';
export async function hash(value) { return Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString('hex'); }
export async function authenticate(db, header, now = Date.now()) {
  if (!/^Bearer [A-Za-z0-9_-]{43,100}$/.test(header || '')) return null;
  return db.prepare('SELECT id, origins, resource_hosts FROM tenants WHERE token_hash = ? AND disabled = 0 AND expires_at > ?').bind(await hash(header.slice(7)), now).first();
}
export async function recover(db, now = Date.now()) {
  // Never replay a stale browser job: a form may already have reached the target.
  await db.batch([
    db.prepare("UPDATE runs SET status = 'interrupted', finished_at = ?, report = ? WHERE status IN ('ready','running') AND created_at < ?").bind(now, JSON.stringify({ status: 'inconclusive', error: '실행 연결이 끊겼거나 제한 시간을 초과했습니다. 대상 사이트 상태를 확인한 후 새 검사로 실행하세요.' }), now - 120000),
    db.prepare("UPDATE runs SET report = NULL, screenshot = NULL, status = 'deleted' WHERE expires_at < ? AND status NOT IN ('ready','running','deleted')").bind(now),
    // Keep tiny quota/idempotency tombstones for eight days, even after user deletion.
    db.prepare("DELETE FROM runs WHERE status = 'deleted' AND created_at < ?").bind(now - 8 * 86400000),
  ]);
}
export async function reserve(db, tenant, key, fingerprint, now = Date.now()) {
  const day = Math.floor(now / 86400000) * 86400000;
  const id = crypto.randomUUID();
  const result = await db.prepare(`INSERT INTO runs (id, tenant_id, request_key, fingerprint, status, created_at, expires_at)
    SELECT ?, ?, ?, ?, 'ready', ?, ? WHERE
    (SELECT COUNT(*) FROM runs WHERE created_at >= ?) < ? AND
    (SELECT COUNT(*) FROM runs WHERE tenant_id = ? AND created_at >= ?) < ? AND
    NOT EXISTS (SELECT 1 FROM runs WHERE status IN ('ready','running')) AND
    NOT EXISTS (SELECT 1 FROM runs WHERE created_at > ?)
    ON CONFLICT(tenant_id, request_key) DO NOTHING`).bind(id, tenant, key, fingerprint, now, now + LIMITS.retentionMs, day, LIMITS.dailyGlobal, tenant, day, LIMITS.dailyTenant, now - LIMITS.spacingMs).run();
  const existing = await db.prepare('SELECT id, fingerprint, status FROM runs WHERE tenant_id = ? AND request_key = ?').bind(tenant, key).first();
  if (existing && existing.fingerprint !== fingerprint) return { error: '같은 요청 ID에 다른 검사 내용을 사용할 수 없습니다.', status: 409 };
  if (existing) return { id: existing.id, status: existing.status, created: result.meta.changes === 1 };
  return { error: '무료 일일 한도 또는 동시 실행 제한입니다. 요청을 접수하지 않았습니다.', status: 429 };
}
export async function ownedRun(db, tenant, id) { return db.prepare('SELECT id, status, fingerprint, cancel_requested, report, created_at, expires_at FROM runs WHERE tenant_id = ? AND id = ?').bind(tenant, id).first(); }
export async function finish(db, tenant, id, report, screenshot, status = 'done', now = Date.now()) {
  return db.prepare("UPDATE runs SET status = ?, report = ?, screenshot = ?, finished_at = ? WHERE tenant_id = ? AND id = ? AND status = 'running' AND cancel_requested = 0")
    .bind(status, JSON.stringify(report), screenshot ? new Uint8Array(screenshot) : null, now, tenant, id).run();
}
