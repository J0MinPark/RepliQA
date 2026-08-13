const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { hashApiKey } = require('../src/api/middleware/auth');

test('hashApiKey: 같은 입력은 항상 같은 해시를 반환 (결정적)', () => {
  assert.equal(hashApiKey('rq_abc123'), hashApiKey('rq_abc123'));
});

test('hashApiKey: 다른 입력은 다른 해시를 반환', () => {
  assert.notEqual(hashApiKey('rq_abc123'), hashApiKey('rq_abc124'));
});

test('hashApiKey: sha256 hex 다이제스트와 일치 (평문이 저장되지 않는지 확인)', () => {
  const expected = crypto.createHash('sha256').update('rq_test-key').digest('hex');
  assert.equal(hashApiKey('rq_test-key'), expected);
  assert.notEqual(hashApiKey('rq_test-key'), 'rq_test-key');
});
