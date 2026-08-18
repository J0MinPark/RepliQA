// GitHub Actions/GitLab CI/Jenkins가 표준으로 읽는 JUnit XML로 테스트 실행 결과를 내보낸다 —
// Playwright/Cypress/Selenium은 전부 이 포맷(또는 호환 포맷)을 기본 제공하는데 RepliQA엔
// 없었다. 체크포인트 하나 = <testcase> 하나로 매핑한다.
function escapeXml(str) {
  return String(str ?? '').replace(/[<>&'"]/g, (c) => {
    if (c === '<') return '&lt;';
    if (c === '>') return '&gt;';
    if (c === '&') return '&amp;';
    if (c === "'") return '&apos;';
    return '&quot;';
  });
}

function orderedCheckpoints(checkpointsMap) {
  return Object.entries(checkpointsMap || {})
    .map(([index, value]) => ({ index: Number(index), ...value }))
    .sort((a, b) => a.index - b.index);
}

function buildJUnitXml(run) {
  const suiteName = run.routeName || run.targetUrl || 'RepliQA';

  // 엔진 자체가 못 뜬 경우(SSRF 차단, 브라우저 launch 실패 등) — 체크포인트가 아예 없으니
  // 런 전체를 테스트케이스 하나로 표현한다.
  if (run.status === 'failed' && !run.checkpoints) {
    return renderXml(suiteName, 1, 1, [
      testcaseXml('RepliQA 실행', suiteName, run.error || '알 수 없는 오류로 실행이 실패했습니다.'),
    ]);
  }

  if (run.status === 'queued' || run.status === 'running') {
    return renderXml(suiteName, 1, 0, [`    <testcase name="실행 중 (아직 완료되지 않음)" classname="${escapeXml(suiteName)}" />`]);
  }

  const checkpoints = orderedCheckpoints(run.checkpoints);
  const failures = checkpoints.filter((cp) => cp.status === 'failed').length;
  const testcases = checkpoints.map((cp) => {
    const name = cp.goal || `체크포인트 ${cp.index + 1} (자유 탐색)`;
    if (cp.status === 'failed') {
      return testcaseXml(name, suiteName, cp.failureReason || '알 수 없는 이유로 실패했습니다.');
    }
    return `    <testcase name="${escapeXml(name)}" classname="${escapeXml(suiteName)}" />`;
  });

  return renderXml(suiteName, checkpoints.length, failures, testcases, run);
}

function testcaseXml(name, classname, failureMessage) {
  return `    <testcase name="${escapeXml(name)}" classname="${escapeXml(classname)}">
      <failure message="${escapeXml(failureMessage)}">${escapeXml(failureMessage)}</failure>
    </testcase>`;
}

function renderXml(suiteName, tests, failures, testcaseLines, run) {
  // vibe_coder_prompt/plain_summary는 JUnit 표준 필드가 아니지만, <system-out>은 대부분의
  // 파서가 무시하지 않고 그대로 보여준다 — CI 로그에서 바로 수정 프롬프트를 볼 수 있게.
  const systemOut = run?.vibeCoderPrompt
    ? `\n    <system-out>${escapeXml(run.vibeCoderPrompt)}</system-out>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="RepliQA" tests="${tests}" failures="${failures}">
  <testsuite name="${escapeXml(suiteName)}" tests="${tests}" failures="${failures}">
${testcaseLines.join('\n')}${systemOut}
  </testsuite>
</testsuites>
`;
}

module.exports = { buildJUnitXml, escapeXml };
