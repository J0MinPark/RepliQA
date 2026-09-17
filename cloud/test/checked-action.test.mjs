import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {performStep} from '../src/actions.mjs';
const require=createRequire(new URL('../../desktop/package.json',import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH=fileURLToPath(new URL('../../desktop/vendor/browsers',import.meta.url));
const {chromium}=require('playwright');
test('checked state reverting after a real click is failed; a blocked click remains inconclusive without retries',async()=>{
  const browser=await chromium.launch();try{const page=await browser.newPage();
    await page.setContent('<label>Choice<input type="checkbox" onclick="window.writes=(window.writes||0)+1;this.checked=false"></label>');
    await assert.rejects(performStep(page,{action:'check',target:'Choice'}),e=>e.check?.status==='failed'&&e.check.evidence.observed.every(v=>v===false));
    assert.equal(await page.evaluate(()=>window.writes),1);
    await page.setContent('<label>Choice<input type="checkbox" disabled onclick="window.writes=(window.writes||0)+1"></label>');
    await assert.rejects(performStep(page,{action:'check',target:'Choice'}),e=>!e.check);assert.equal(await page.locator('input').isChecked(),false);
  }finally{await browser.close();}
});
