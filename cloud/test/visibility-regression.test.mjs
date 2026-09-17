import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {checkStep} from '../src/assertions.mjs';
import {readResult} from '../src/outcomes.mjs';
const require=createRequire(new URL('../../desktop/package.json',import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH=fileURLToPath(new URL('../../desktop/vendor/browsers',import.meta.url));
const {chromium}=require('playwright');

test('rendered visibility respects child CSS overrides and overridden hidden attributes',async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();
  await page.setContent('<div style="visibility:hidden"><button id="child" style="visibility:visible">Continue</button></div><button id="attribute" hidden style="display:block">Visible override</button>');
  for(const target of ['#child','#attribute']){
    assert.equal(await page.locator(target).isVisible(),true);
    assert.equal((await checkStep(page,{action:'assertVisible',target})).status,'passed',target);
  }
  assert.equal((await readResult(page,'#child')).text,'Continue');
  assert.equal((await readResult(page,'#attribute')).text,'Visible override');
  assert.equal((await readResult(page,'body')).text,'Continue Visible override');
  await page.locator('#child').evaluate(el=>el.style.visibility='hidden');
  assert.equal((await checkStep(page,{action:'assertVisible',target:'#child'})).status,'failed');
});
