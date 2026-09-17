import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {readResult} from '../src/outcomes.mjs';
import {redactReport} from '../src/report.mjs';
const require=createRequire(new URL('../../desktop/package.json',import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH=fileURLToPath(new URL('../../desktop/vendor/browsers',import.meta.url));
const {chromium}=require('playwright');

test('rendered text handles boxless wrappers and explicit line breaks while excluding hidden evidence',async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();
  await page.setContent('<div id="result">Saved <span style="display:contents"><b>record</b></span><br>Version two<span hidden>Wrong hidden</span><span style="opacity:0">Wrong transparent</span></div>');
  const result=await readResult(page,'#result');
  assert.equal(result.text,'Saved record Version two');assert.deepEqual(result.lines,['Saved record','Version two']);
  await page.locator('#result').evaluate(el=>el.style.display='contents');
  assert.deepEqual((await readResult(page,'#result')).lines,['Saved record','Version two']);
  await page.locator('#result').evaluate(el=>el.style.display='none');
  assert.equal((await readResult(page,'#result')).available,false);
});

test('expected and observed failure evidence is redacted before being returned to customers',()=>{
  const report={status:'failed',mode:'browser-contracts',engineVersion:'0.2.1',checks:[{id:'text-0',status:'failed',evidence:{expected:'test-only-secret',observed:'person@example.com test-only-secret'}}],steps:[],scope:{catalogVersion:'v1',items:[]}};
  const safe=redactReport(report,['test-only-secret']);
  assert.doesNotMatch(JSON.stringify(safe),/test-only-secret|person@example.com/);assert.equal(safe.status,'failed');assert.equal(safe.checks[0].id,'text-0');
});
