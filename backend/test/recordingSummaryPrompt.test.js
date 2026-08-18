const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildRecordingSummaryPrompt } = require('../src/engine/llm/recordingSummaryPrompt');

test('buildRecordingSummaryPrompt: 시작 URL과 기록된 행동을 프롬프트에 그대로 포함', () => {
  const events = [
    { type: 'click', tag: 'A', role: null, text: '장바구니', url: 'https://shop.example.com/', timestamp: 1 },
    { type: 'submit', url: 'https://shop.example.com/cart', timestamp: 2 },
  ];
  const { prompt } = buildRecordingSummaryPrompt({ events, url: 'https://shop.example.com/' });
  assert.match(prompt, /https:\/\/shop\.example\.com\//);
  assert.match(prompt, /"type":"click"/);
  assert.match(prompt, /"type":"submit"/);
});

test('buildRecordingSummaryPrompt: 응답을 {"goal": "..."} 스키마로 요청', () => {
  const { prompt } = buildRecordingSummaryPrompt({ events: [], url: 'https://x.com' });
  assert.match(prompt, /\{"goal": "체크포인트 목표 한 줄"\}/);
});

test('buildRecordingSummaryPrompt: 입력값(실제 타이핑한 값) 자체는 프롬프트 구성 규칙에 없음 — input 이벤트에 value 필드가 없어야 함을 문서화', () => {
  const events = [
    { type: 'input', tag: 'INPUT', fieldType: 'password', label: '비밀번호', url: 'https://x.com', timestamp: 1 },
  ];
  const { prompt } = buildRecordingSummaryPrompt({ events, url: 'https://x.com' });
  assert.doesNotMatch(prompt, /"value"/);
  assert.match(prompt, /"label":"비밀번호"/);
});
