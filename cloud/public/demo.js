document.getElementById('add-cart').addEventListener('click', () => {
  const quantity = Number(document.getElementById('quantity').value);
  document.getElementById('cart-result').textContent = `장바구니 ${quantity}개 · 합계 ${(12000 * quantity).toLocaleString('ko-KR')}원`;
});
