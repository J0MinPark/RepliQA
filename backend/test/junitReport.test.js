const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildJUnitXml, escapeXml } = require('../src/api/junitReport');

test('escapeXml: 특수문자를 이스케이프', () => {
  assert.equal(escapeXml(`<a> & "b" 'c'`), '&lt;a&gt; &amp; &quot;b&quot; &apos;c&apos;');
});

test('escapeXml: null/undefined은 빈 문자열로 취급', () => {
  assert.equal(escapeXml(null), '');
  assert.equal(escapeXml(undefined), '');
});

test('buildJUnitXml: 완료된 런 - 성공/실패 체크포인트가 각각 testcase로 매핑됨', () => {
  const run = {
    status: 'done',
    routeName: '로그인 여정',
    targetUrl: 'https://example.com',
    checkpoints: {
      0: { goal: '로그인 완료', status: 'completed' },
      1: { goal: '결제 완료', status: 'failed', failureReason: '저장 버튼 클릭 후 반응 없음' },
    },
  };
  const xml = buildJUnitXml(run);
  assert.match(xml, /<testsuites name="RepliQA" tests="2" failures="1">/);
  assert.match(xml, /<testsuite name="로그인 여정" tests="2" failures="1">/);
  assert.match(xml, /<testcase name="로그인 완료" classname="로그인 여정" \/>/);
  assert.match(xml, /<testcase name="결제 완료" classname="로그인 여정">/);
  assert.match(xml, /<failure message="저장 버튼 클릭 후 반응 없음">/);
});

test('buildJUnitXml: goal이 없으면(자유 탐색) 대체 이름을 씀', () => {
  const run = {
    status: 'done',
    targetUrl: 'https://example.com',
    checkpoints: { 0: { goal: null, status: 'completed' } },
  };
  const xml = buildJUnitXml(run);
  assert.match(xml, /체크포인트 1 \(자유 탐색\)/);
});

test('buildJUnitXml: 엔진 자체가 실패한 런(체크포인트 없음)은 testcase 1개로 표현', () => {
  const run = { status: 'failed', targetUrl: 'https://example.com', error: 'SSRF 차단됨' };
  const xml = buildJUnitXml(run);
  assert.match(xml, /tests="1" failures="1"/);
  assert.match(xml, /<failure message="SSRF 차단됨">/);
});

test('buildJUnitXml: 아직 진행 중인 런은 실패 0건으로 표현', () => {
  const run = { status: 'running', targetUrl: 'https://example.com' };
  const xml = buildJUnitXml(run);
  assert.match(xml, /tests="1" failures="0"/);
});

test('buildJUnitXml: vibeCoderPrompt가 있으면 system-out에 포함', () => {
  const run = {
    status: 'done',
    targetUrl: 'https://example.com',
    vibeCoderPrompt: '[코드 수정 필요] 재현 방법: ...',
    checkpoints: { 0: { goal: '로그인', status: 'completed' } },
  };
  const xml = buildJUnitXml(run);
  assert.match(xml, /<system-out>\[코드 수정 필요\] 재현 방법: \.\.\.<\/system-out>/);
});
