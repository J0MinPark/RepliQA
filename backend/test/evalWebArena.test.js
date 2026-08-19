const { test } = require('node:test');
const assert = require('node:assert/strict');
const { urlMatchScore, decodeHtmlEntities } = require('../scripts/webarena-bench/evalWebArena');

test('urlMatchScore: 경로가 정확히 같으면 1점(WebArena 원본 예시: 고객 목록 페이지)', () => {
  assert.equal(
    urlMatchScore('http://localhost:7780/customer/index/', 'http://localhost:7780/customer/index/'),
    1
  );
});

test('urlMatchScore: 트레일링 슬래시 차이는 무시', () => {
  assert.equal(
    urlMatchScore('http://localhost:7780/customer/index', 'http://localhost:7780/customer/index/'),
    1
  );
});

test('urlMatchScore: 경로가 다르면 0점', () => {
  assert.equal(
    urlMatchScore('http://localhost:7780/dashboard', 'http://localhost:7780/customer/index/'),
    0
  );
});

test('urlMatchScore: 쿼리 파라미터가 pred에 포함되면 1점(GOLD in PRED)', () => {
  assert.equal(
    urlMatchScore('http://localhost:9999/search?q=shoes&sort=new', 'http://localhost:9999/search?q=shoes'),
    1
  );
});

test('urlMatchScore: 쿼리 파라미터 값이 다르면 0점', () => {
  assert.equal(
    urlMatchScore('http://localhost:9999/search?q=boots', 'http://localhost:9999/search?q=shoes'),
    0
  );
});

test('urlMatchScore: " |OR| "로 여러 정답 URL 중 하나만 맞아도 1점', () => {
  assert.equal(
    urlMatchScore('http://localhost:7780/y', 'http://localhost:7780/x |OR| http://localhost:7780/y'),
    1
  );
});

test('urlMatchScore: 예측 URL 경로 뒤에 세그먼트가 더 붙어도 참조 경로를 포함하면 1점(GOLD in PRED — 부분문자열 포함, 완전일치 아님)', () => {
  // WebArena 원본(evaluators.py)의 `ref_base_path in pred_base_paths`는 파이썬 문자열
  // 부분문자열 포함 검사다. 처음 이식할 때 반대 방향(예측이 참조 목록과 완전 일치해야
  // 함)으로 짰다가, Magento가 리포트 필터 상태를 쿼리스트링이 아니라 URL 경로 자체에
  // base64로 얹는 방식이라(예: .../report_sales/sales/filter/<base64>/) 실제로 통과해야
  // 할 WebArena 태스크(704)가 억울하게 실패하는 걸 발견해서 고쳤다 — 그 회귀 테스트.
  assert.equal(
    urlMatchScore(
      'http://localhost:7780/admin/reports/report_sales/sales/filter/cmVwb3J0X3R5cGU9Y3JlYXRlZF9hdF9vcmRlcg==/',
      'http://localhost:7780/admin/reports/report_sales/sales'
    ),
    1
  );
});

test('decodeHtmlEntities: 흔한 named entity와 numeric entity를 복원', () => {
  assert.equal(decodeHtmlEntities('Tom &amp; Jerry &#39;s'), "Tom & Jerry 's");
  assert.equal(decodeHtmlEntities('&lt;b&gt;bold&lt;/b&gt;'), '<b>bold</b>');
});
