import actions from '../../backend/src/design/actions.js';
import safety from '../../backend/src/engine/paymentSafety.js';
import flow from '../../desktop/src/browser-flow.cjs';

export async function performStep(page, step) {
  if (['back','forward','reload'].includes(step.action)) {
    const origin=new URL(page.url()).origin;
    const method={back:'goBack',forward:'goForward',reload:'reload'}[step.action];
    await page[method]({waitUntil:'domcontentloaded',timeout:10000});
    const check=await flow.checkFinalPath(page,step.target,origin);
    if (check.status !== 'passed') { const error=new Error('이동 후 경로가 지정 조건과 다릅니다.'); error.check=check;throw error; }
    return;
  }
  let locator;
  if (step.action==='select') locator=page.getByRole('combobox',{name:step.target,exact:true}).or(page.getByRole('listbox',{name:step.target,exact:true})).or(page.getByLabel(step.target,{exact:true}));
  else if (['check','uncheck','fill'].includes(step.action)) locator=page.getByLabel(step.target,{exact:true});
  else if (step.action==='press') locator=page.getByLabel(step.target,{exact:true}).or(page.getByRole('button',{name:step.target,exact:true}));
  else locator=await actions.designLocator(page,step);
  // Wait for hydration without selecting the first of several matches.
  const until=Date.now()+3000;
  while (!(await locator.count()) && Date.now()<until) await page.waitForTimeout(100);
  if (await locator.count()!==1) throw new Error('동작 대상을 하나로 특정하지 못했습니다. 대상 이름을 확인하세요.');
  if (step.action==='expect') {await locator.waitFor({state:'visible',timeout:3000});return;}
  const label=await locator.evaluate(el=>[el.textContent,el.getAttribute('aria-label'),el.getAttribute('value'),el.getAttribute('title')].filter(Boolean).join(' '));
  if (safety.isPaymentSubmitElement(`${step.target} ${label}`)||safety.isIrreversibleActionElement(`${step.target} ${label}`)) throw new Error('결제·영구 변경 동작은 자동 실행하지 않습니다.');
  const options={timeout:4000};
  if (step.action==='select') await locator.selectOption({label:step.value},options);
  else if (step.action==='fill') await locator.fill(step.value,options);
  else if (['check','uncheck'].includes(step.action)) {
    try { await locator[step.action](options); }
    catch (error) {
      // Playwright explicitly reports that the click completed but the requested
      // checked state did not change. Other failures (overlay, timeout, missing
      // control) remain unresolved; never click a second time to manufacture success.
      if (error.message.includes('Clicking the checkbox did not change its state')) {
        const expected = step.action === 'check'; const observations = [];
        for (let index=0; index<3; index++) {
          if (await locator.count() !== 1) throw error;
          const state = await locator.evaluate(el => el.matches('input[type=checkbox],input[type=radio]') ? {checked:el.checked,indeterminate:el.indeterminate,disabled:el.matches(':disabled')} : null);
          if (!state || state.indeterminate || state.disabled || state.checked === expected) throw error;
          observations.push(state.checked); if(index<2)await page.waitForTimeout(150);
        }
        error.check={id:'checked-action',catalogId:'assertions',title:'선택 동작 후 상태',status:'failed',message:'선택 동작 후 요소 상태가 지정 조건과 다릅니다.',evidence:{target:step.target,expected,observed:observations}};
        error.assertionStatus='failed';
      }
      throw error;
    }
  }
  else if (step.action==='hover') await locator.hover(options);
  else if (step.action==='press') await locator.press(step.value,options);
  else await locator.click(options);
}
