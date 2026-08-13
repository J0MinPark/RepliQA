const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isPlausibleGroundingPoint } = require('../src/engine/runEngine');

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
