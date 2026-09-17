import {axeSource,axeVersion} from './axe-source.mjs';

// Use the unmodified, pinned upstream engine. No CDN, account, or AI request.
export async function accessibilityChecks(page, signal) {
  const base = { id: 'accessibility-auto', catalogId: 'accessibility-auto', title: '접근성 자동 규칙 (axe-core)' };
  try {
    signal?.throwIfAborted();
    if (await page.locator('*').count() > 8000) throw new Error('DOM 수집 한도를 초과했습니다.');
    await page.evaluate(axeSource);
    const result = await page.evaluate(async () => {
      let timer;
      try {
        const result = await Promise.race([
          window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] }, iframes: false }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('접근성 검사 시간 제한')), 8000); }),
        ]);
        const [violations,incomplete]=[result.violations,result.incomplete].map(group=>group.map(item=>({ rule: item.id, impact: item.impact, help: item.help, helpUrl: item.helpUrl,
          affectedNodes: item.nodes.length, targets: item.nodes.slice(0, 5).map(node => node.target), targetsTruncated: item.nodes.length > 5 })));
        return { engine: result.testEngine, violations, incomplete,
          passedRules: result.passes.length, inapplicableRules: result.inapplicable.length, framesExcluded: document.querySelectorAll('iframe,frame').length };
      } finally { clearTimeout(timer); }
    });
    signal?.throwIfAborted();
    const evaluated = result.passedRules + result.violations.length + result.incomplete.length;
    return [{ ...base, status: !evaluated || result.incomplete.length ? 'inconclusive' : result.violations.length ? 'review' : 'passed', evidence: result,
      message: '현재 문서의 자동화 가능한 규칙만 검사했습니다. 위반은 규칙별 검토 후보이며, iframe·스크린리더·전체 WCAG 적합성은 별도 검증이 필요합니다.' }];
  } catch (error) {
    signal?.throwIfAborted();
    return [{ ...base, status: 'inconclusive', message: error.message, evidence: { engine: { name: 'axe-core', version: axeVersion } } }];
  }
}
