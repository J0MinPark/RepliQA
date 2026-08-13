// 결제 체크포인트([결제] 태그)에서 "최종 제출"로 보이는 버튼은 절대 자동 클릭하지 않는다.
// 오탐(false positive)으로 조금 일찍 멈추는 건 안전하지만, 놓쳐서 실제 결제가 나가는 건
// 절대 안 되므로 키워드는 넓게 잡는다 — 과할 정도로 막는 쪽으로 설계한다.
const PAYMENT_SUBMIT_KEYWORDS = [
  '결제하기',
  '결제하다',
  '결제 진행',
  '결제진행',
  '결제 완료',
  '결제완료',
  '결제 확정',
  '결제확정',
  '결제할게요',
  '구매하기',
  '구매 확정',
  '구매확정',
  '구매하다',
  '주문하기',
  '주문 확정',
  '주문확정',
  '결제 승인',
  '결제승인',
  'pay now',
  'complete payment',
  'confirm payment',
  'confirm purchase',
  'purchase',
  'place order',
  'submit payment',
  'buy now',
  'checkout now',
];

function normalize(text) {
  return (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function isPaymentSubmitElement(text) {
  const normalized = normalize(text);
  if (!normalized) return false;
  return PAYMENT_SUBMIT_KEYWORDS.some((kw) => normalized.includes(kw.toLowerCase()));
}

module.exports = { isPaymentSubmitElement, PAYMENT_SUBMIT_KEYWORDS };
