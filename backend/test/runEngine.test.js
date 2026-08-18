const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isPlausibleGroundingPoint, runDeterministicVerify, describeVerify } = require('../src/engine/runEngine');

function fakePage({ url = '', bodyText = '' } = {}) {
  return {
    url: () => url,
    evaluate: async () => bodyText,
  };
}

const box = { x: 100, y: 100, width: 80, height: 40 }; // 100~180, 100~140

test('isPlausibleGroundingPoint: 대상 박스 안쪽 좌표는 항상 신뢰', () => {
  assert.equal(isPlausibleGroundingPoint({ x: 140, y: 120 }, box), true);
});

test('isPlausibleGroundingPoint: 박스에서 가까운(320px 이내) 좌표는 신뢰', () => {
  assert.equal(isPlausibleGroundingPoint({ x: 180 + 300, y: 120 }, box), true);
});

test('isPlausibleGroundingPoint: 박스에서 320px 넘게 떨어지면 폐기', () => {
  // 예스24 사례의 회귀 테스트: UI-TARS가 상단 이벤트 배너처럼 대상 요소 박스에서 한참
  // 떨어진 좌표를 짚었을 때 그대로 믿지 않고 폐기해야 한다.
  assert.equal(isPlausibleGroundingPoint({ x: 180 + 400, y: 120 }, box), false);
});

test('isPlausibleGroundingPoint: 대상 요소 박스가 없으면(옵셔널) 무조건 신뢰', () => {
  assert.equal(isPlausibleGroundingPoint({ x: 9999, y: 9999 }, null), true);
});

test('runDeterministicVerify: url_contains — 포함되면 true', async () => {
  const page = fakePage({ url: 'https://shop.example.com/cart/checkout' });
  const result = await runDeterministicVerify(page, { networkCalls: [] }, { type: 'url_contains', value: '/cart' });
  assert.equal(result, true);
});

test('runDeterministicVerify: url_contains — 안 포함되면 false', async () => {
  const page = fakePage({ url: 'https://shop.example.com/home' });
  const result = await runDeterministicVerify(page, { networkCalls: [] }, { type: 'url_contains', value: '/cart' });
  assert.equal(result, false);
});

test('runDeterministicVerify: text_visible — 페이지 텍스트에 포함되면 true', async () => {
  const page = fakePage({ bodyText: '주문이 완료되었습니다. 감사합니다.' });
  const result = await runDeterministicVerify(page, { networkCalls: [] }, {
    type: 'text_visible',
    value: '주문이 완료되었습니다',
  });
  assert.equal(result, true);
});

test('runDeterministicVerify: network_status — URL 패턴과 상태 코드가 둘 다 일치해야 true', async () => {
  const page = fakePage();
  const activity = {
    networkCalls: [
      { method: 'POST', url: 'https://api.example.com/api/orders', status: 200 },
      { method: 'GET', url: 'https://api.example.com/api/user', status: 200 },
    ],
  };
  assert.equal(
    await runDeterministicVerify(page, activity, { type: 'network_status', urlPattern: '/api/orders', status: 200 }),
    true
  );
  assert.equal(
    await runDeterministicVerify(page, activity, { type: 'network_status', urlPattern: '/api/orders', status: 500 }),
    false
  );
});

test('describeVerify: 사람이 읽을 수 있는 형태로 직렬화', () => {
  assert.equal(describeVerify({ type: 'url_contains', value: '/cart' }), 'url_contains("/cart")');
  assert.equal(
    describeVerify({ type: 'network_status', urlPattern: '/api/orders', status: 200 }),
    'network_status("/api/orders", 200)'
  );
});
