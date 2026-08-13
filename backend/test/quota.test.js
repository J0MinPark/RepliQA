const { test } = require('node:test');
const assert = require('node:assert/strict');
const { todayKey } = require('../src/db/quota');

test('todayKey: YYYY-MM-DD 형식(UTC)을 반환', () => {
  assert.match(todayKey(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(todayKey(), new Date().toISOString().slice(0, 10));
});
