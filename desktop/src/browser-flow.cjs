// Shared by the desktop runtime and the Cloudflare browser worker.
const { scrollPage } = require('./scroll.cjs');

function containsSteps(actual, required = []) {
  let next = 0;
  for (const step of actual) {
    const target = required[next];
    if (target && step.action === target.action && step.target === target.target && step.value === target.value) next++;
  }
  return next === required.length;
}

async function executeFlow(initialPage, steps, { performStep, origin, signal, onStep = () => {} }) {
  let page = initialPage;
  const evidence = []; const scrolls = [];
  for (const [index, step] of steps.entries()) {
    signal?.throwIfAborted();
    const beforeUrl = page.url(); const popups = [];
    const opened = (popup) => popups.push(popup);
    page.on('popup', opened);
    const started = Date.now();
    try {
      if (step.action === 'scroll') scrolls.push(await scrollPage(page, step));
      else await performStep(page, step);
      // Bounded settling also catches window.open scheduled just after a click.
      if (step.action === 'click') await page.waitForTimeout(350);
    } finally { page.off('popup', opened); }
    if (popups.length > 1) throw new Error('여러 새 창이 열려 다음 검사 화면을 특정할 수 없습니다.');
    if (popups.length === 1) {
      page = popups[0];
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
    }
    if (origin && new URL(page.url()).origin !== origin) throw new Error('등록된 사이트 밖으로 이동하여 검사를 중단했습니다.');
    const item = { index, action: step.action, target: step.target, beforeUrl, afterUrl: page.url(), popup: popups.length === 1, durationMs: Date.now() - started, status: 'passed' };
    evidence.push(item); await onStep(item);
  }
  return { page, evidence, scrolls };
}

async function checkFinalPath(page, expectedPath, origin) {
  if (!expectedPath) return null;
  const expected = new URL(expectedPath, origin);
  const same = (url) => url.origin === expected.origin && url.pathname.replace(/\/$/, '') === expected.pathname.replace(/\/$/, '') && url.search === expected.search && url.hash === expected.hash;
  await page.waitForURL(same, { timeout: 3000, waitUntil: 'domcontentloaded' }).catch(() => {});
  return { id: 'final-url', title: '최종 도착 경로', status: same(new URL(page.url())) ? 'passed' : 'failed', message: `기대: ${expectedPath}`, actualUrl: page.url() };
}
module.exports = { executeFlow, containsSteps, checkFinalPath };
