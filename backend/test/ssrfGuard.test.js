const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  assertHttpUrl,
  resolveSafeIp,
  resolveIpUnchecked,
  SsrfViolationError,
} = require('../src/security/ssrfGuard');

test('assertHttpUrl: localhost는 언제나 거부', () => {
  assert.throws(() => assertHttpUrl('http://localhost:7770/'), SsrfViolationError);
});

test('resolveSafeIp: 루프백 IP는 거부(회귀 방지 — 벤치마크 이스케이프 해치가 이 정책을 건드리지 않는지 확인)', async () => {
  await assert.rejects(() => resolveSafeIp('127.0.0.1'), SsrfViolationError);
});

test('resolveIpUnchecked: 루프백 IP는 그대로 반환(신뢰된 로컬 벤치마크 하네스 전용 경로)', async () => {
  assert.equal(await resolveIpUnchecked('127.0.0.1'), '127.0.0.1');
});

test('resolveIpUnchecked: resolve 자체가 불가능한 호스트는 여전히 에러', async () => {
  await assert.rejects(
    () => resolveIpUnchecked('this-host-should-not-resolve.invalid'),
    SsrfViolationError
  );
});
