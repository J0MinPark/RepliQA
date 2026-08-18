const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  isPlausibleGroundingPoint,
  runDeterministicVerify,
  pollDeterministicVerify,
  describeVerify,
} = require('../src/engine/runEngine');

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

test('pollDeterministicVerify: 즉시 통과하면 1번만 확인', async () => {
  const page = fakePage({ url: 'https://shop.example.com/cart' });
  const result = await pollDeterministicVerify(
    page,
    { networkCalls: [] },
    { type: 'url_contains', value: '/cart' },
    { timeoutMs: 200, intervalMs: 20 }
  );
  assert.deepEqual(result, { passed: true, attempts: 1 });
});

test('pollDeterministicVerify: 처음엔 실패해도 페이지가 나중에 반영되면 재확인 후 통과(오토웨이트)', async () => {
  let calls = 0;
  const page = {
    url: () => {
      calls += 1;
      return calls < 3 ? 'https://shop.example.com/home' : 'https://shop.example.com/cart';
    },
  };
  const result = await pollDeterministicVerify(
    page,
    { networkCalls: [] },
    { type: 'url_contains', value: '/cart' },
    { timeoutMs: 500, intervalMs: 20 }
  );
  assert.equal(result.passed, true);
  assert.ok(result.attempts >= 3, `실제로 재호출됐어야 함(attempts=${result.attempts})`);
});

test('pollDeterministicVerify: 끝까지 안 맞으면 timeout까지만 기다리고 false로 종료(행 안 걸림)', async () => {
  const page = fakePage({ url: 'https://shop.example.com/home' });
  const start = Date.now();
  const result = await pollDeterministicVerify(
    page,
    { networkCalls: [] },
    { type: 'url_contains', value: '/cart' },
    { timeoutMs: 60, intervalMs: 20 }
  );
  assert.equal(result.passed, false);
  assert.ok(Date.now() - start < 1000, 'timeoutMs를 훨씬 넘겨서 걸리면 안 됨');
});

test('pollDeterministicVerify: 폴링 도중 activity.networkCalls에 새 항목이 늦게 들어와도 잡힘', async () => {
  const page = fakePage();
  const activity = { networkCalls: [] };
  setTimeout(() => {
    activity.networkCalls.push({ method: 'POST', url: 'https://api.example.com/api/orders', status: 200 });
  }, 30);
  const result = await pollDeterministicVerify(
    page,
    activity,
    { type: 'network_status', urlPattern: '/api/orders', status: 200 },
    { timeoutMs: 500, intervalMs: 20 }
  );
  assert.equal(result.passed, true);
});

test('pollDeterministicVerify: 확인 자체가 에러나면 그대로 reject(호출부의 .catch 계약 유지)', async () => {
  const page = {
    url: () => {
      throw new Error('페이지가 이미 닫힘');
    },
  };
  await assert.rejects(
    () =>
      pollDeterministicVerify(
        page,
        { networkCalls: [] },
        { type: 'url_contains', value: '/cart' },
        { timeoutMs: 40, intervalMs: 10 }
      ),
    /페이지가 이미 닫힘/
  );
});
