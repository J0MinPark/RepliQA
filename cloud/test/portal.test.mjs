import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {jobSchema} from '../src/schema.mjs';
const require=createRequire(new URL('../../desktop/package.json',import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH=fileURLToPath(new URL('../../desktop/vendor/browsers',import.meta.url));
const {chromium}=require('playwright');
test('portal distinguishes automatic inspection from journeys and submits scoped expectations',async t=>{
  const jobs=[];
  const server=http.createServer(async(req,res)=>{
    try{
      if(req.url.startsWith('/api/')){
        res.setHeader('content-type','application/json');
        if(req.url==='/api/me')return res.end(JSON.stringify({origins:['https://example.com'],limits:{dailyGlobal:4,dailyTenant:2},aiEnabled:false}));
        if(req.method==='GET')return res.end(JSON.stringify({runs:[]}));
        let body='';for await(const chunk of req)body+=chunk;
        if(req.url==='/api/validate-plan'){try{const job=jobSchema.parse(JSON.parse(body));if(new URL(job.url).origin!=='https://example.com')throw new Error();return res.end(JSON.stringify({job}));}catch{res.statusCode=400;return res.end(JSON.stringify({error:'Invalid plan'}));}}
        if(req.url==='/api/runs'){jobs.push(JSON.parse(body));res.statusCode=201;return res.end(JSON.stringify({id:'11111111-1111-1111-1111-111111111111',status:'ready'}));}
        return res.end(JSON.stringify({report:{status:'passed'}}));
      }
      const asset=req.url==='/'?'index.html':req.url.slice(1);
      if(!['index.html','style.css','app.js','qa-catalog.js','reproduction.js','plans.js','beta.html'].includes(asset)){res.statusCode=404;return res.end();}
      res.setHeader('content-type',asset.endsWith('.js')?'text/javascript':asset.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(await fs.readFile(new URL('../public/'+asset,import.meta.url)));
    }catch{res.statusCode=500;res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('#token').fill('fixture-only');await page.locator('#login-form button').click();await page.locator('#workspace').waitFor({state:'visible'});
  assert.equal(await page.locator('#catalog p').count(),30);
  await page.locator('#inspection-mode').selectOption('basic');await page.locator('[name=title]').fill('Automatic page check');await page.locator('[name=reviewed]').check();
  const first=page.waitForResponse(r=>r.url().endsWith('/execute'));await page.locator('#submit').click();await first;await page.waitForFunction(()=>!document.querySelector('#submit').disabled);
  assert.equal(jobs[0].inspectionMode,'basic');assert.deepEqual(jobs[0].steps,[]);assert.deepEqual(jobs[0].expectedTexts,[]);assert.equal('expectedPath' in jobs[0],false);
  await page.locator('#inspection-mode').selectOption('journey');assert.equal(await page.locator('[name=expectedPath]').isDisabled(),false);
  await page.locator('[name=requirement]').fill('Reload should preserve the expected result');await page.locator('[name=expectedTexts]').fill('Saved project');
  await page.locator('details[data-journey] summary').click();await page.locator('[name=resultSelector]').fill('#result');await page.locator('[name=requireResultChange]').check();
  await page.locator('#add-step').click();const step=page.locator('.step').first();await step.locator('select').selectOption('reload');await step.locator('input').first().fill('/');
  const second=page.waitForResponse(r=>r.url().endsWith('/execute'));await page.locator('#submit').click();await second;
  assert.equal(jobs[1].inspectionMode,'journey');assert.equal(jobs[1].resultSelector,'#result');assert.equal(jobs[1].requireResultChange,true);assert.equal(jobs[1].steps[0].action,'reload');assert.equal(jobs[1].steps[0].target,'/');assert.equal(await page.locator('#ai-consent').isDisabled(),true);assert.deepEqual(errors,[]);
  await page.waitForFunction(()=>!document.querySelector('#submit').disabled);
  await step.locator('select').selectOption('assertChecked');await step.locator('input').first().fill('#accepted');await step.locator('input').nth(1).fill('false');
  const third=page.waitForResponse(r=>r.url().endsWith('/execute'));await page.locator('#submit').click();await third;
  assert.deepEqual(jobs[2].steps,[{action:'assertChecked',target:'#accepted',value:'false'}]);assert.deepEqual(errors,[]);
  await page.waitForFunction(()=>!document.querySelector('#submit').disabled);
  await step.locator('select').selectOption('fill');await step.locator('input').first().fill('Password');await step.locator('input').nth(1).fill('fixture-private-value');
  const downloadPromise=page.waitForEvent('download');await page.locator('#save-plan').click();const download=await downloadPromise;const saved=await fs.readFile(await download.path(),'utf8');
  assert.ok(!saved.includes('fixture-private-value'));assert.ok(saved.includes('[REPLIQA_REENTER]'));assert.equal(jobs.length,3);
  await page.locator('[name=title]').fill('Changed');
  await page.locator('#load-plan').setInputFiles({name:'plan.json',mimeType:'application/json',buffer:Buffer.from(saved)});
  await page.waitForFunction(()=>document.querySelector('[name=title]').value==='Automatic page check');
  assert.equal(await page.locator('[name=reviewed]').isChecked(),false);assert.equal(jobs.length,3);
  await page.locator('[name=reviewed]').check();await page.locator('#submit').click();await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('REPLIQA_REENTER'));assert.equal(jobs.length,3);
  await page.locator('.step input').nth(1).fill('new-synthetic-value');
  const fourth=page.waitForResponse(r=>r.url().endsWith('/execute'));await page.locator('#submit').click();await fourth;assert.equal(jobs[3].steps[0].value,'new-synthetic-value');
  assert.deepEqual(errors,[]);
});
