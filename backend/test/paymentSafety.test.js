const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isPaymentSubmitElement } = require('../src/engine/paymentSafety');

test('isPaymentSubmitElement: 한글 결제/구매 확정 문구 탐지', () => {
  assert.equal(isPaymentSubmitElement('결제하기'), true);
  assert.equal(isPaymentSubmitElement('구매 확정'), true);
  assert.equal(isPaymentSubmitElement('  결제   완료  '), true); // 공백 정규화
});

test('isPaymentSubmitElement: 영문 결제 문구 탐지 (대소문자 무관)', () => {
  assert.equal(isPaymentSubmitElement('Pay Now'), true);
  assert.equal(isPaymentSubmitElement('CONFIRM PURCHASE'), true);
});

test('isPaymentSubmitElement: 단독 "Purchase"도 탐지 (demoblaze.com 실사례)', () => {
  // 세션 중 demoblaze.com에서 'Purchase' 단독 버튼이 안전핀을 통과했던 실제 버그의
  // 회귀 테스트.
  assert.equal(isPaymentSubmitElement('Purchase'), true);
});

test('isPaymentSubmitElement: 무관한 텍스트는 탐지되지 않음', () => {
  assert.equal(isPaymentSubmitElement('장바구니에 담기'), false);
  assert.equal(isPaymentSubmitElement('Add to cart'), false);
  assert.equal(isPaymentSubmitElement(''), false);
  assert.equal(isPaymentSubmitElement(null), false);
});
