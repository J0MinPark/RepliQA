// Runs in the page. Prefer the document; otherwise use a visible main scroll region.
function selectScrollRoot() {
  const root = document.scrollingElement;
  if (!root) throw new Error('스크롤할 문서가 없습니다.');
  if (root.scrollHeight > innerHeight + 1) return root;
  const candidates = [...document.querySelectorAll('body *')].filter((el) => {
    const box = el.getBoundingClientRect(); const style = getComputedStyle(el);
    const visibleWidth = Math.max(0, Math.min(innerWidth, box.right) - Math.max(0, box.left));
    const visibleHeight = Math.max(0, Math.min(innerHeight, box.bottom) - Math.max(0, box.top));
    return /^(auto|scroll)$/.test(style.overflowY) && style.visibility !== 'hidden' && Number(style.opacity) !== 0
      && el.scrollHeight > el.clientHeight + 1 && visibleWidth * visibleHeight >= innerWidth * innerHeight * 0.5;
  });
  candidates.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
  return candidates[0] || root;
}
function readPosition(root) {
  const isDocument = root === document.scrollingElement;
  return { x: root.scrollLeft, y: root.scrollTop, height: root.scrollHeight, viewportHeight: isDocument ? innerHeight : root.clientHeight,
    container: { kind: isDocument ? 'document' : 'element', tag: root.tagName.toLowerCase(), id: root.id || null } };
}
async function getScrollPosition(page) {
  const root = await page.evaluateHandle(selectScrollRoot);
  try { return await root.evaluate(readPosition); } finally { await root.dispose(); }
}
async function scrollPage(page, step) {
  if (!['up', 'down', 'top', 'bottom'].includes(step.target)) throw new Error('지원하지 않는 스크롤 방향입니다.');
  const amount = step.value === undefined ? 600 : Number(step.value);
  if (!Number.isInteger(amount) || amount < 1 || amount > 2000) throw new Error('스크롤 이동량은 1~2,000px 정수여야 합니다.');
  // A loading intro or modal may lock the body. Wait briefly; never remove the site's lock.
  await page.waitForFunction(() => document.body && !(getComputedStyle(document.body).position === 'fixed' && document.body.scrollHeight > innerHeight), undefined, { timeout: 8000 });
  const root = await page.evaluateHandle(selectScrollRoot);
  try {
    const before = await root.evaluate(readPosition);
    const maximum = Math.max(0, before.height - before.viewportHeight);
    before.requestedY = step.target === 'top' ? 0 : step.target === 'bottom' ? maximum : Math.max(0, Math.min(maximum, before.y + (step.target === 'up' ? -amount : amount)));
    await root.evaluate((el, y) => el.scrollTo({ top: y, behavior: 'instant' }), before.requestedY);
    // Bounded wait for scroll listeners/lazy rendering. Infinite feeds need further reviewed steps.
    await page.waitForTimeout(250);
    const after = await root.evaluate(readPosition);
    const moved = Math.abs(after.y - before.y) > 1;
    if (Math.abs(before.requestedY - before.y) > 1 && !moved) throw new Error('요청한 스크롤이 이동하지 않았습니다. 팝업이나 스크롤 잠금을 확인하세요.');
    return { direction: step.target, amount, before, after, moved,
      atTop: after.y <= 1, atBottom: after.y + after.viewportHeight >= after.height - 2 };
  } finally { await root.dispose(); }
}
module.exports = { scrollPage, getScrollPosition };
