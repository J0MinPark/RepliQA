const { isPaymentSubmitElement, isIrreversibleActionElement } = require('../engine/paymentSafety');

async function designLocator(page, step) {
  if (['fill', 'select', 'check'].includes(step.action)) return page.getByLabel(step.target, { exact: true });
  const roles = ['button', 'link', 'tab', 'menuitem'];
  const locator = roles.map((role) => page.getByRole(role, { name: step.target, exact: true })).reduce((all, next) => all.or(next));
  const count = await locator.count();
  if (count === 1) return locator;
  if (count > 1) {
    // Responsive sites may leave an off-canvas mobile menu in the accessibility tree.
    // A unique match in the current viewport takes precedence; multiple visible matches stay ambiguous.
    const inViewport = await locator.evaluateAll((elements) => elements.map((element, index) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight ? index : -1;
    }).filter((index) => index >= 0));
    if (inViewport.length === 1) return locator.nth(inViewport[0]);
    return locator;
  }
  return page.getByText(step.target, { exact: true });
}

async function performDesignStep(page, step) {
  const locator = await designLocator(page, step);
  if (step.action === 'expect') { await locator.waitFor({ state: 'visible', timeout: 5000 }); return; }
  if (await locator.count() !== 1) throw new Error(`“${step.target}” 대상을 하나로 특정하지 못했습니다. 화면의 실제 이름으로 수정하세요.`);
  const label = await locator.evaluate((element) => [element.textContent, element.getAttribute('aria-label'), element.getAttribute('value'), element.getAttribute('title')].filter(Boolean).join(' '));
  if (isPaymentSubmitElement(`${step.target} ${label}`) || isIrreversibleActionElement(`${step.target} ${label}`)) throw new Error('결제·영구 변경 동작은 자동 실행하지 않습니다.');
  if (step.action === 'fill') await locator.fill(step.value || '', { timeout: 5000 });
  else if (step.action === 'select') await locator.selectOption({ label: step.value || '' }, { timeout: 5000 });
  else if (step.action === 'check') await locator.check({ timeout: 5000 });
  else await locator.click({ timeout: 5000 });
}

async function captureDesignDom(page) {
  return page.evaluate(() => {
    const texts = [];
    const typography = [];
    const colors = new Set();
    const all = [...document.querySelectorAll('body *')];
    let truncated = all.length > 10000;
    for (const element of all.slice(0, 10000)) {
      if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(element.tagName)) continue;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0
        || element.closest('[hidden], [aria-hidden="true"]')) continue;
      // Check ancestors as well: an opacity-zero parent still gives children positive boxes.
      let hidden = false;
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const parentStyle = getComputedStyle(parent);
        if (Number(parentStyle.opacity) === 0 || parentStyle.visibility === 'hidden') { hidden = true; break; }
      }
      if (hidden) continue;
      const direct = [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join(' ').trim();
      if (direct && direct.length <= 2000 && texts.length < 3000) texts.push(direct);
      if (direct && typography.length < 1000) typography.push({ text: direct, fontSize: parseFloat(style.fontSize), fontFamily: style.fontFamily });
      for (const color of [style.color, style.backgroundColor, style.borderTopColor]) {
        const match = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
        if (match && (match[4] === undefined || Number(match[4]) === 1)) colors.add('#' + match.slice(1, 4).map((v) => Number(v).toString(16).padStart(2, '0')).join(''));
      }
    }
    truncated ||= texts.length >= 3000 || typography.length >= 1000;
    return { texts: [...new Set(texts)], typography, colors: [...colors], truncated };
  });
}


module.exports = { designLocator, performDesignStep, captureDesignDom };
