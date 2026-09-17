import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {checkStep} from '../src/assertions.mjs';
import {accessibilityChecks} from '../src/accessibility.mjs';
import {jobSchema} from '../src/schema.mjs';
import {runBrowser} from '../src/runner.mjs';
import {reproductionMarkdown} from '../public/reproduction.js';
const require=createRequire(new URL('../../desktop/package.json',import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH=fileURLToPath(new URL('../../desktop/vendor/browsers',import.meta.url));
const {chromium}=require('playwright');

test('state contracts reject wrong values, ambiguous targets, invalid types and transient success', {timeout:60000},async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();
  await page.setContent('<input id="value" value="Original"><input id="checked" type="checkbox" checked><button id="enabled" disabled>Continue</button><p id="visible">Ready</p><p id="hidden" hidden>Wait</p><i></i><i></i>');
  const steps=[['assertValue','#value','Original'],['assertChecked','#checked','true'],['assertEnabled','#enabled','false'],['assertVisible','#visible'],['assertHidden','#hidden'],['assertCount','i','2'],['assertText','#visible','Ready']];
  for(const [action,target,value] of steps)assert.equal((await checkStep(page,{action,target,value})).status,'passed',action);
  assert.equal((await checkStep(page,{action:'assertCount',target:'.absent',value:'0'})).status,'passed');
  for(const step of [{action:'assertValue',target:'#value',value:'Wrong'},{action:'assertChecked',target:'#checked',value:'false'},{action:'assertHidden',target:'#visible'}])assert.equal((await checkStep(page,step)).status,'failed');
  for(const step of [{action:'assertHidden',target:'.absent'},{action:'assertValue',target:'i',value:''},{action:'assertChecked',target:'#visible',value:'false'}])assert.equal((await checkStep(page,step)).status,'inconclusive');
  await page.evaluate(()=>{document.querySelector('#value').value='Brief';setTimeout(()=>document.querySelector('#value').value='Original',60);});
  assert.equal((await checkStep(page,{action:'assertValue',target:'#value',value:'Brief'})).status,'failed');
  const base={url:'https://example.com',title:'Contract',requirement:'Observe',expectedPath:'/',expectedTexts:['Ready'],reviewed:true};
  for(const step of [{action:'assertCount',target:'p',value:'-1'},{action:'assertChecked',target:'#checked',value:'yes'},{action:'assertUrl',target:'//other.test'},{action:'assertText',target:'p'}])assert.equal(jobSchema.safeParse({...base,steps:[step]}).success,false);
});

test('failed intermediate assertion stops writes and exports redacted reproduction evidence',async t=>{
  let writes=0;
  const server=http.createServer((req,res)=>{if(req.url==='/write'){writes++;return res.end('Saved');}res.setHeader('content-type','text/html');res.end('<label>Secret<input value="fixture-private-value" type="password"></label><p id="result">Wrong</p><button onclick="fetch(\'/write\')">Save draft</button>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const job=jobSchema.parse({url:origin,title:'Stop before saving',requirement:'Do not save with wrong precondition',steps:[{action:'assertText',target:'#result',value:'Ready'},{action:'click',target:'Save draft'}],expectedPath:'/',expectedTexts:['Saved'],reviewed:true});
  const result=await runBrowser(job,{launch:()=>chromium.launch({headless:true}),guard:context=>context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort())});
  assert.equal(result.report.status,'failed');assert.deepEqual(result.report.steps.map(s=>s.status),['failed','not_run']);assert.equal(writes,0);assert.ok(result.screenshot.length>100);
  const exported=reproductionMarkdown(result.report);assert.match(exported,/Ready/);assert.match(exported,/Wrong/);assert.match(exported,/not_run/);assert.doesNotMatch(exported,/fixture-private-value/);
});

test('axe engine observes seeded accessibility violations and does not certify incomplete runs',async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();let external=0;
  await page.route('**/*',route=>{external++;return route.abort();});
  await page.setContent('<!doctype html><html lang="en"><head><title>Accessible fixture</title></head><body><main><h1>Profile</h1><label for="name">Name</label><input id="name"><button>Save draft</button></main></body></html>');
  const normal=await accessibilityChecks(page);assert.equal(normal[0].status,'passed',JSON.stringify(normal));assert.equal(normal[0].evidence.engine.version,'4.13.0');
  await page.locator('label').evaluate(el=>el.remove());
  const fault=await accessibilityChecks(page);assert.equal(fault[0].status,'review',JSON.stringify(fault));assert.ok(fault[0].evidence.violations.some(v=>v.rule==='label'));assert.equal(external,0);
  const unavailable=await accessibilityChecks({locator:()=>({count:async()=>{throw new Error('Browser disconnected');}})});
  assert.equal(unavailable[0].status,'inconclusive');
});
