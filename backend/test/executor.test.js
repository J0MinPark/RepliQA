const { test } = require('node:test');
const assert = require('node:assert/strict');
const { textLooksUnrelated, centerOf } = require('../src/engine/executor');

test('textLooksUnrelated: expected 텍스트가 없으면 항상 불일치 아님', () => {
  assert.equal(textLooksUnrelated('', 'anything'), false);
  assert.equal(textLooksUnrelated(null, 'anything'), false);
});

test('textLooksUnrelated: actual이 null이면(그 좌표에 요소 없음) 항상 불일치', () => {
  // Habitica에서 화면 밖 좌표를 클릭했을 때 이 케이스가 false를 반환해 사고로 이어졌던 버그의
  // 회귀 테스트 — actual==null은 "확인 불가"가 아니라 명백한 불일치로 취급해야 한다.
  assert.equal(textLooksUnrelated('Get Started', null), true);
});

test('textLooksUnrelated: 기대 텍스트와 실제 텍스트가 겹치면 일치로 판단', () => {
  assert.equal(textLooksUnrelated('장바구니에 담기', '장바구니에 담기 버튼입니다'), false);
  assert.equal(textLooksUnrelated('Add to cart', 'Add to cart | Product page'), false);
});

test('textLooksUnrelated: 완전히 다른 요소를 가리키면 불일치로 판단', () => {
  // automationexercise.com에서 실제로 재현된 사례: "장바구니 담기" 클릭이 무관한 제목 요소에
  // 떨어진 케이스.
  assert.equal(textLooksUnrelated('장바구니에 담기', '인기 상품 목록'), true);
});

test('centerOf: 박스의 정중앙 좌표를 반환', () => {
  assert.deepEqual(centerOf({ x: 10, y: 20, width: 100, height: 50 }), { x: 60, y: 45 });
});
