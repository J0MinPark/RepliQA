// 개발자/사용자가 직접 실행하는 1회성 CLI 도구(capture-session.js와 같은 패턴). Playwright
// codegen처럼 "고정 스크립트"를 만드는 게 아니라, 사람이 한 번 수행한 동선을 RepliQA
// 체크포인트용 자연어 목표 문장으로 자동 요약한다 — 실행은 여전히 매번 LLM이 화면을 보고
// 판단하는 기존 방식 그대로라, 코드 없이 자연어로 아무 사이트나 다루는 RepliQA의 철학과
// 충돌하지 않는다. 결과물은 routes.js의 체크포인트 문자열 배열 포맷과 100% 호환되므로
// RouteBuilder.jsx의 텍스트에어리어에 그대로 붙여넣으면 된다.
//
// 클릭/제출/입력 이벤트만 기록하고, 입력 필드의 실제 값은 절대 기록하지 않는다
// (attemptLogin/attemptPaymentFill이 LLM에 실제 비밀번호/카드번호를 안 보여주는 것과 같은
// 원칙 — 어떤 필드를 채웠는지는 기록해도 무엇을 입력했는지는 기록하지 않는다).
//
// 사용법: node scripts/recordRoute.js <targetUrl>
// 사람이 체크포인트 하나를 끝낼 때마다 터미널에서 Enter. 다 끝나면 'q' + Enter.
const readline = require('readline');
const { launchBrowser } = require('../src/engine/browserEngines');
const geminiAdapter = require('../src/engine/llm/geminiAdapter');

const RECORDER_INIT_SCRIPT = `
(() => {
  function describeTarget(el) {
    const clickable = el.closest('button, a, [role="button"], [role="link"], input[type="submit"], input[type="button"], summary') || el;
    const text = (clickable.innerText || clickable.value || clickable.getAttribute('aria-label') || '').trim().slice(0, 80);
    return { tag: clickable.tagName, role: clickable.getAttribute('role') || null, text };
  }
  document.addEventListener('click', (e) => {
    const { tag, role, text } = describeTarget(e.target);
    window.__repliqaRecordEvent({ type: 'click', tag, role, text, url: location.href, timestamp: Date.now() });
  }, true);
  document.addEventListener('submit', () => {
    window.__repliqaRecordEvent({ type: 'submit', url: location.href, timestamp: Date.now() });
  }, true);
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA' && t.tagName !== 'SELECT') return;
    const labelEl = t.id && document.querySelector('label[for="' + t.id + '"]');
    const label = (labelEl && labelEl.innerText) || t.getAttribute('placeholder') || t.getAttribute('aria-label') || t.name || '';
    window.__repliqaRecordEvent({
      type: 'input',
      tag: t.tagName,
      fieldType: t.type || null,
      label: label.trim().slice(0, 60),
      url: location.href,
      timestamp: Date.now(),
    });
  }, true);
})();
`;

function waitForLine(rl) {
  return new Promise((resolve) => rl.once('line', resolve));
}

async function main() {
  const [, , targetUrl] = process.argv;
  if (!targetUrl) {
    console.error('사용법: node scripts/recordRoute.js <targetUrl>');
    process.exit(1);
  }

  const events = [];
  const segments = [];

  const { browser, contextOptions } = await launchBrowser({ stealth: true, headless: false });
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  await page.exposeFunction('__repliqaRecordEvent', (event) => events.push(event));
  await page.addInitScript(RECORDER_INIT_SCRIPT);
  await page.goto(targetUrl);

  console.log('브라우저 창에서 체크포인트로 만들고 싶은 동선을 직접 수행하세요.');
  console.log('체크포인트 하나가 끝날 때마다 이 터미널로 돌아와 Enter를 누르세요.');
  console.log("다 끝났으면 'q'를 입력하고 Enter를 누르세요.\n");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let lastIndex = 0;
  for (;;) {
    const line = await waitForLine(rl);
    if (line.trim().toLowerCase() === 'q') break;
    const segment = events.slice(lastIndex);
    lastIndex = events.length;
    if (segment.length === 0) {
      console.log('(이번 구간엔 기록된 행동이 없습니다 — 건너뜁니다)');
      continue;
    }
    segments.push(segment);
    console.log(`체크포인트 ${segments.length} 기록 완료(행동 ${segment.length}개).`);
  }
  rl.close();
  await browser.close();

  if (segments.length === 0) {
    console.log('기록된 체크포인트가 없습니다.');
    process.exit(0);
  }

  console.log('\n기록된 행동을 체크포인트 목표 문장으로 요약하는 중...\n');
  const goals = [];
  for (const [i, segment] of segments.entries()) {
    const { goal } = await geminiAdapter.summarizeActionsToCheckpoint({
      events: segment,
      url: segment[0].url,
    });
    goals.push(goal);
    console.log(`${i + 1}. ${goal}`);
  }

  console.log('\n--- 아래 내용을 RouteBuilder의 체크포인트 입력란에 그대로 붙여넣으세요 ---');
  console.log(goals.join('\n'));
  console.log('---');
  console.log('필요하면 각 줄 끝에 [검증: url_contains("...")] 같은 태그를 손으로 추가해도 됩니다.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { RECORDER_INIT_SCRIPT };
