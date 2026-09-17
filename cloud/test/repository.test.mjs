import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { authenticate, hash, reserve, recover, ownedRun, finish } from '../src/repository.mjs';
import { publicAddress, validateUrl } from '../src/target-guard.mjs';
import { jobSchema, jobStatus } from '../src/schema.mjs';

async function database(t) {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close());
  sqlite.exec(await readFile(new URL('../migrations/0001_pilot.sql', import.meta.url), 'utf8'));
  for (const id of ['one','two','three']) sqlite.prepare('INSERT INTO tenants VALUES (?,?,?,?,?,0)').run(id, `test-${id}`, '["https://example.com"]', '[]', Date.UTC(2030,0,1));
  const db = { prepare(sql) { let args = []; return { bind(...values) { args = values; return this; }, async first() { return sqlite.prepare(sql).get(...args) || null; }, async all() { return { results: sqlite.prepare(sql).all(...args) }; }, async run() { return { meta: sqlite.prepare(sql).run(...args) }; } }; }, async batch(statements) { sqlite.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } } };
  return db;
}
test('actual SQL isolates tenants, enforces idempotency and reserves the global budget atomically', async (t) => {
  const db = await database(t); const now = Date.UTC(2026, 8, 12, 12); const token = 'a'.repeat(43);
  await db.prepare('UPDATE tenants SET token_hash = ?, expires_at = ? WHERE id = ?').bind(await hash(token), now + 86400000, 'one').run();
  assert.equal((await authenticate(db, `Bearer ${token}`, now)).id, 'one');
  assert.equal(await authenticate(db, `Bearer ${'b'.repeat(43)}`, now), null);
  const [a,b] = await Promise.all([reserve(db, 'one', 'req-1', 'body', now), reserve(db, 'two', 'req-2', 'body', now)]);
  assert.ok(a.created); assert.equal(b.status, 429);
  assert.equal((await reserve(db, 'one', 'req-1', 'body', now)).id, a.id);
  assert.equal((await reserve(db, 'one', 'req-1', 'changed', now)).status, 409);
  assert.equal(await ownedRun(db, 'two', a.id), null);
  await db.prepare("UPDATE runs SET status='running' WHERE id=?").bind(a.id).run();
  assert.equal((await finish(db, 'two', a.id, { secret: 'other' }, null)).meta.changes, 0);
  await finish(db, 'one', a.id, { status: 'passed' }, Buffer.from('masked'), 'done', now + 20000);
  const next = await reserve(db, 'one', 'req-3', 'body', now + 30000); assert.ok(next.created);
  await db.prepare("UPDATE runs SET status='deleted' WHERE id=?").bind(next.id).run();
  assert.equal((await reserve(db, 'one', 'req-4', 'body', now + 60000)).status, 429, 'deletion cannot replenish daily quota');
  const third = await reserve(db, 'two', 'req-5', 'body', now + 90000); assert.ok(third.created);
  await db.prepare("UPDATE runs SET status='done' WHERE id=?").bind(third.id).run();
  const fourth = await reserve(db, 'two', 'req-6', 'body', now + 120000); assert.ok(fourth.created);
  await db.prepare("UPDATE runs SET status='done' WHERE id=?").bind(fourth.id).run();
  assert.equal((await reserve(db, 'three', 'req-7', 'body', now + 150000)).status, 429);
});
test('cancelled jobs cannot resurrect reports; stale jobs never replay; retention removes screenshots', async (t) => {
  const db = await database(t); const now = Date.UTC(2026,8,12,12);
  const one = await reserve(db, 'one', 'k1', 'b', now);
  await db.prepare("UPDATE runs SET status='cancelled',cancel_requested=1 WHERE id=?").bind(one.id).run();
  assert.equal((await finish(db, 'one', one.id, { status: 'passed' }, Buffer.from('secret'))).meta.changes, 0);
  const two = await reserve(db, 'two', 'k2', 'b', now + 30000);
  await db.prepare("UPDATE runs SET status='running',report='private',screenshot=? WHERE id=?").bind(Buffer.from('private'), two.id).run();
  await recover(db, now + 180000);
  assert.equal((await ownedRun(db, 'two', two.id)).status, 'interrupted');
  await recover(db, now + 7 * 86400000 + 60000);
  const row = await db.prepare('SELECT * FROM runs WHERE id=?').bind(two.id).first();
  assert.equal(row.status, 'deleted'); assert.equal(row.report, null); assert.equal(row.screenshot, null);
});
test('target rules, review schema and outcome classification fail closed', () => {
  for (const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','::1','::ffff:127.0.0.1','fc00::1']) assert.equal(publicAddress(ip), false);
  assert.equal(publicAddress('1.1.1.1'), true);
  assert.throws(() => validateUrl('https://example.com@evil.test/', ['https://example.com']));
  assert.throws(() => validateUrl('http://example.com/', ['https://example.com']));
  assert.equal(jobSchema.safeParse({ url:'https://example.com', title:'t', requirement:'r', steps:[], expectedPath:'/', expectedTexts:[], reviewed:true }).success, false);
  assert.equal(jobStatus([{status:'failed'}], null, true), 'failed');
  assert.equal(jobStatus([{status:'passed'}], null, true), 'inconclusive');
  assert.equal(jobStatus([{status:'passed'}], null, false), 'passed');
});
