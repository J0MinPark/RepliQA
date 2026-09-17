function redactText(value, secrets = []) {
  let text = String(value);
  for (const secret of [...new Set(secrets)].filter((s) => typeof s === 'string' && s.length > 0).sort((a, b) => b.length - a.length)) text = text.split(secret).join('[MASKED]');
  return text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
    .replace(/((?:token|password|secret|api[_-]?key|authorization)\s*[=:]\s*)[^\s&"<>]+/gi, '$1[MASKED]')
    .replace(/\bBearer\s+[a-zA-Z0-9._~+\/-]+/g, 'Bearer [MASKED]');
}
function redact(value, secrets = []) {
  if (typeof value === 'string') return redactText(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redact(item, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /^(password|token|apiKey|authorization|storageState|session)$/i.test(key) ? '[MASKED]' : redact(item, secrets)]));
  return value;
}
function privateValues(profile, cases = []) {
  return [...(profile.privacy?.redactValues || []), ...cases.flatMap((item) => [...(item.steps || []), ...(item.requiredSteps || [])].filter((step) => step.action === 'fill').map((step) => step.value))];
}
async function selectorValues(page, selectors = []) {
  return page.evaluate((selectors) => {
    const values = new Set();
    for (const selector of ['input', 'textarea', '[data-repliqa-private]', ...selectors]) {
      for (const element of document.querySelectorAll(selector)) {
        if (element.value) values.add(element.value);
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT); let node;
        while ((node = walker.nextNode()) && values.size < 2000) { const text = node.textContent.trim(); if (text) values.add(text); }
      }
    }
    return [...values];
  }, selectors);
}
async function screenshotMasked(page, { selectors = [], secrets = [], type = 'png' } = {}) {
  // Temporary visual overlays preserve underlying DOM contracts and input state.
  const marker = `repliqa-mask-${globalThis.crypto.randomUUID()}`;
  await page.evaluate(({ selectors, secrets, marker }) => {
    const boxes = []; const add = (rect) => { if (rect.width > 0 && rect.height > 0) boxes.push(rect); };
    for (const selector of ['input', 'textarea', 'iframe', '[contenteditable="true"]', '[data-repliqa-private]', ...selectors]) {
      for (const element of document.querySelectorAll(selector)) add(element.getBoundingClientRect());
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node; let count = 0;
    while ((node = walker.nextNode()) && count++ < 20000) {
      if (!node.parentElement || node.parentElement.closest('script,style,noscript')) continue;
      if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(node.textContent) || secrets.some((s) => s && node.textContent.includes(s))) {
        const range = document.createRange(); range.selectNodeContents(node); for (const rect of range.getClientRects()) add(rect);
      }
    }
    const host = document.createElement('div'); host.id = marker;
    for (const rect of boxes) {
      const mask = document.createElement('div');
      mask.style.cssText = `position:fixed!important;left:${rect.x}px!important;top:${rect.y}px!important;width:${rect.width}px!important;height:${rect.height}px!important;background:#20242f!important;z-index:2147483647!important;pointer-events:none!important;`;
      host.appendChild(mask);
    }
    document.documentElement.appendChild(host);
  }, { selectors, secrets, marker });
  try { return await page.screenshot({ type, ...(type === 'jpeg' ? { quality: 65 } : {}), animations: 'disabled' }); }
  finally { await page.evaluate((id) => document.getElementById(id)?.remove(), marker).catch(() => {}); }
}
function publicReport(run) {
  const result = redact(run, privateValues(run.profileSnapshot || {}, run.reviewedCases || []));
  // Execution inputs and reference images are private; exports contain outcomes only.
  delete result.profileSnapshot; delete result.reviewedCases;
  return result;
}
module.exports = { redact, redactText, privateValues, selectorValues, screenshotMasked, publicReport };
