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

test('decodeHtmlEntities: 흔한 named entity와 numeric entity를 복원', () => {
  assert.equal(decodeHtmlEntities('Tom &amp; Jerry &#39;s'), "Tom & Jerry 's");
  assert.equal(decodeHtmlEntities('&lt;b&gt;bold&lt;/b&gt;'), '<b>bold</b>');
});
