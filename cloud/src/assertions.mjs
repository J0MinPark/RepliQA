import { readResult } from './outcomes.mjs';

export const assertionActions = ['assertText', 'assertValue', 'assertChecked', 'assertEnabled', 'assertVisible', 'assertHidden', 'assertCount', 'assertUrl'];
const normal = value => value.normalize('NFKC').replace(/\s+/g, ' ').trim();

async function sample(page, step) {
  if (step.action === 'assertUrl') {
    const url = new URL(page.url());
    return { available: true, value: url.pathname + url.search + url.hash };
  }
  if (step.action === 'assertText') {
    const result = await readResult(page, step.target);
    return { available: result.available && !result.truncated, value: result.text, reason: result.reason || '텍스트 수집이 불완전합니다.' };
  }
  if (['assertVisible','assertHidden'].includes(step.action)) {
    // Playwright handles computed visibility, child overrides and the hidden
    // attribute's CSS semantics. Do not reimplement those browser rules.
    const locator=page.locator(step.target);
    if(await locator.count()!==1)return {available:false,reason:'검증 대상을 하나로 특정하지 못했습니다.'};
    const style=await locator.evaluate(el=>({boxless:getComputedStyle(el).display==='contents',transparent:(()=>{for(let node=el;node;node=node.parentElement)if(Number(getComputedStyle(node).opacity)===0)return true;return false;})()}));
    if(style.boxless)return {available:false,reason:'박스가 없는 요소는 자식 선택자 또는 문구 검증으로 확인하세요.'};
    return {available:true,value:await locator.isVisible()&&!style.transparent};
  }
  return page.evaluate(({ action, target }) => {
    const elements = document.querySelectorAll(target);
    if (action === 'assertCount') return { available: true, value: elements.length };
    if (elements.length !== 1) return { available: false, reason: '검증 대상을 하나로 특정하지 못했습니다.', count: elements.length };
    const el = elements[0];
    if (action === 'assertValue') return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
      ? { available: true, value: el.value } : { available: false, reason: '입력 컨트롤이 아닙니다.' };
    if (action === 'assertChecked') {
      if (el.matches('input[type=checkbox],input[type=radio]')) return { available: !el.indeterminate, value: el.checked, reason: '체크 상태가 혼합되어 있습니다.' };
      if (['checkbox', 'radio', 'switch'].includes(el.getAttribute('role')) && ['true', 'false'].includes(el.getAttribute('aria-checked'))) return { available: true, value: el.getAttribute('aria-checked') === 'true' };
      return { available: false, reason: '검증 가능한 체크 컨트롤이 아닙니다.' };
    }
    if (action === 'assertEnabled') {
      if (!el.matches('input,button,select,textarea,fieldset,option,optgroup,[role=button],[role=checkbox],[role=radio],[role=switch],[role=combobox]')) return { available: false, reason: '활성 상태를 검증할 컨트롤이 아닙니다.' };
      return { available: true, value: !el.matches(':disabled') && !el.closest('[aria-disabled=true]') };
    }
    return {available:false,reason:'지원하지 않는 검증입니다.'};
  }, step);
}

// Retry observations, never the action or its side effects. Missing/ambiguous
// selectors and unsupported controls are inconclusive, not application defects.
export async function checkStep(page, step, signal) {
  const expected = step.action === 'assertUrl' ? step.target : step.action === 'assertVisible' ? true
    : step.action === 'assertHidden' ? false : ['assertChecked', 'assertEnabled'].includes(step.action) ? step.value === 'true'
      : step.action === 'assertCount' ? Number(step.value) : step.action === 'assertText' ? normal(step.value) : step.value;
  const deadline = Date.now() + 3000;
  let observed, stable = 0, previous;
  do {
    signal?.throwIfAborted();
    observed = await sample(page, step);
    const match = observed.available && observed.value === expected;
    stable = match ? (previous === observed.value ? stable + 1 : 1) : 0;
    previous = observed.value;
    if (stable >= 3) break;
    await page.waitForTimeout(150);
  } while (Date.now() < deadline);
  const status = !observed.available ? 'inconclusive' : stable >= 3 ? 'passed' : observed.value === expected ? 'inconclusive' : 'failed';
  return { id: 'step-assertion', catalogId: 'assertions', title: `${step.action}: ${step.target}`, status,
    message: !observed.available ? observed.reason : '명시한 조건을 연속 3회 관측합니다. 요소 부재·중복은 확인 불가이며, 개수 검증은 지정한 CSS 범위의 개수만 의미합니다.',
    evidence: { assertion: step.action, target: step.target, expected, observed: observed.value ?? null, stableSamples: stable } };
}
