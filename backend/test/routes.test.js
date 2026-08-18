const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseCheckpoint } = require('../src/api/routes/routes');

test('parseCheckpoint: 태그 없는 평범한 한 줄', () => {
  const result = parseCheckpoint('로그인 페이지에서 로그인 완료', 0);
  assert.deepEqual(result, { order: 0, goal: '로그인 페이지에서 로그인 완료', type: 'generic', verify: null });
});

test('parseCheckpoint: [결제] 태그', () => {
  const result = parseCheckpoint('[결제] 장바구니에서 결제 진행', 1);
  assert.equal(result.type, 'payment');
  assert.equal(result.goal, '장바구니에서 결제 진행');
  assert.equal(result.verify, null);
});

test('parseCheckpoint: [장시간] 태그', () => {
  const result = parseCheckpoint('[장시간] 세션 만료까지 대기', 2);
  assert.equal(result.type, 'long_running');
  assert.equal(result.goal, '세션 만료까지 대기');
});

test('parseCheckpoint: [검증: url_contains(...)] 태그를 파싱하고 goal에서 제거', () => {
  const result = parseCheckpoint('결제를 완료한다 [검증: url_contains("/order/complete")]', 0);
  assert.equal(result.goal, '결제를 완료한다');
  assert.deepEqual(result.verify, { type: 'url_contains', value: '/order/complete' });
});

test('parseCheckpoint: [검증: text_visible(...)] 태그', () => {
  const result = parseCheckpoint('주문을 완료한다 [검증: text_visible("주문이 완료되었습니다")]', 0);
  assert.deepEqual(result.verify, { type: 'text_visible', value: '주문이 완료되었습니다' });
});

test('parseCheckpoint: [검증: network_status(...)] 태그(URL 패턴 + 상태 코드)', () => {
  const result = parseCheckpoint('주문을 제출한다 [검증: network_status("/api/orders", 200)]', 0);
  assert.deepEqual(result.verify, { type: 'network_status', urlPattern: '/api/orders', status: 200 });
});

test('parseCheckpoint: [결제]와 [검증]을 동시에 쓸 수 있음', () => {
  const result = parseCheckpoint('[결제] 결제를 완료한다 [검증: url_contains("/receipt")]', 0);
  assert.equal(result.type, 'payment');
  assert.equal(result.goal, '결제를 완료한다');
  assert.deepEqual(result.verify, { type: 'url_contains', value: '/receipt' });
});

test('parseCheckpoint: 알 수 없는 검증 타입은 무시(정규식이 이미 화이트리스트라 매칭 자체가 안 됨)', () => {
  const result = parseCheckpoint('아무 목표 [검증: unknown_type("x")]', 0);
  assert.equal(result.verify, null);
  // 정규식에 안 걸린 텍스트라 goal에 그대로 남는다 — 잘못된 태그를 조용히 삼키지 않고
  // 눈에 보이게 남겨서, 사용자가 오타를 알아차릴 수 있게 한다.
  assert.equal(result.goal, '아무 목표 [검증: unknown_type("x")]');
});
