import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runBrowser } from '../src/runner.mjs';
import { jobSchema, jobStatus } from '../src/schema.mjs';
import { redactReport } from '../src/report.mjs';
const require=createRequire(new URL('../../desktop/package.json',import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH=fileURLToPath(new URL('../../desktop/vendor/browsers',import.meta.url));
const {chromium}=require('playwright');

test('adversarial browser outcomes separate real mismatches, correct pages and unresolved evidence', {timeout:120000},async t=>{
  const server=http.createServer((req,res)=>{
    res.setHeader('content-type','text/html; charset=utf-8');
    const mode=new URL(req.url,'http://fixture').searchParams.get('mode')||'normal';
    if(mode==='blank')return res.end('<html lang="en"><title>Blank fixture</title><body></body></html>');
    if(mode==='loading')return res.end('<html lang="en"><title>Loading fixture</title><body><p aria-busy="true">Loading</p></body></html>');
    const result=mode==='noop'?'Saved project':'Waiting';
    let body=`<label>Quantity<select><option>1</option><option>2</option></select></label><label>Accept<input type="checkbox" checked></label><button id="save">Save draft</button><div id="result">${result}</div>`;
    if(mode==='decoy')body+='<p>Saved project</p>';
    if(mode==='ambiguous')body+='<div id="result">Waiting</div>';
    body+='<a href="#next">Open section</a><div style="height:1200px"></div><h2 id="next">Next section</h2>';
    const script=`document.querySelector('#save').onclick=()=>{${mode==='noop'?'':mode==='wrong'||mode==='decoy'?"document.querySelector('#result').textContent='Wrong project';":mode==='hidden'?"document.querySelector('#result').innerHTML='<span hidden>Saved project</span>';":mode==='transient'?"document.querySelector('#result').textContent='Saved project';setTimeout(()=>document.querySelector('#result').textContent='Wrong project',150);":`setTimeout(()=>document.querySelector('#result').innerHTML='Saved <strong>project</strong>',${mode==='late'?1800:0});`}};${mode==='js'?'setTimeout(()=>{throw new Error("optional widget crashed")},500);':''}`;
    res.end(`<html lang="en"><head><title>Independent workflow fixture</title></head><body>${body}<script>${script}</script></body></html>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const options={launch:async()=>({newContext:async opts=>{const c=await browser.newContext(opts);contexts.push(c);return c;},close:async()=>{await contexts.at(-1)?.close();}}),guard:c=>c.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort())};
  const contexts=[];const rows=[];
  const cases=[
    {mode:'normal',truth:'normal',expected:'passed'},
    {mode:'late',truth:'normal',expected:'passed'},
    {mode:'wrong',truth:'defect',expected:'failed'},
    {mode:'decoy',truth:'defect',expected:'failed'},
    {mode:'hidden',truth:'defect',expected:'failed'},
    {mode:'noop',truth:'defect',expected:'failed'},
    {mode:'transient',truth:'defect',expected:'failed'},
    {mode:'ambiguous',truth:'unresolved',expected:'inconclusive'},
    {mode:'js',truth:'review-signal',expected:'review'},
  ];
  for(const item of cases){
    const job=jobSchema.parse({url:`${origin}/?mode=${item.mode}`,title:item.mode,requirement:'Saving must change the visible result to Saved project.',steps:[{action:'select',target:'Quantity',value:'2'},{action:'uncheck',target:'Accept'},{action:'click',target:'Save draft'}],expectedPath:`/?mode=${item.mode}`,expectedTexts:['Saved project'],resultSelector:'#result',requireResultChange:true,reviewed:true});
    const result=await runBrowser(job,options);rows.push({case:item.mode,truth:item.truth,prediction:result.report.status,expected:item.expected,durationMs:result.report.durationMs,checks:result.report.checks,scope:result.report.scope});
    assert.equal(result.report.status,item.expected,JSON.stringify(result.report));
    assert.equal(result.report.scope.wholeSiteVerified,false);
    if(item.mode==='ambiguous')assert.ok(result.report.steps.every(s=>['inconclusive','not_run'].includes(s.status)),'Ambiguous result binding must stop before writes');
    else assert.equal(result.report.scope.completedSteps,3);
  }
  const historyJob=jobSchema.parse({url:origin,title:'History and reload',requirement:'The reviewed navigation sequence should finish at the next section.',steps:[{action:'click',target:'Open section'},{action:'back',target:'/'},{action:'forward',target:'/#next'},{action:'reload',target:'/#next'}],expectedPath:'/#next',expectedTexts:['Next section'],resultSelector:'#next',reviewed:true});
  const navigation=await runBrowser(historyJob,options);assert.equal(navigation.report.status,'passed',JSON.stringify(navigation.report));assert.equal(navigation.report.scope.completedSteps,4);
  const interrupted=await runBrowser({...historyJob,steps:[{action:'click',target:'No such control'},{action:'click',target:'Save draft'}]},options);assert.equal(interrupted.report.status,'inconclusive');assert.equal(interrupted.report.steps[1].status,'not_run');
  const basic=await runBrowser(jobSchema.parse({inspectionMode:'basic',url:origin,title:'Automatic common page checks',requirement:'Inspect this page',steps:[],reviewed:true}),options);
  assert.equal(basic.report.status,'passed',JSON.stringify(basic.report));assert.equal(basic.report.mode,'automatic-basic');assert.equal(basic.report.checks.length,12);assert.equal(basic.report.scope.plannedSteps,0);assert.equal(basic.report.scope.items.find(i=>i.id==='controls').status,'not_tested');
  for(const [mode,status] of [['blank','review'],['loading','inconclusive']]){const result=await runBrowser(jobSchema.parse({inspectionMode:'basic',url:`${origin}/?mode=${mode}`,title:mode,requirement:'Inspect',steps:[],reviewed:true}),options);assert.equal(result.report.status,status,JSON.stringify(result.report));}
  const scored=rows.filter(r=>['normal','defect'].includes(r.truth));
  const tp=scored.filter(r=>r.truth==='defect'&&r.prediction==='failed').length;
  const fp=scored.filter(r=>r.truth==='normal'&&r.prediction==='failed').length;
  const fn=scored.filter(r=>r.truth==='defect'&&r.prediction!=='failed').length;
  const tn=scored.filter(r=>r.truth==='normal'&&r.prediction==='passed').length;
  const dir=new URL('../../artifacts/cloud-reliability/',import.meta.url);await fs.mkdir(dir,{recursive:true});
  const receipt={at:new Date().toISOString(),environment:'RTX 4060 server / local Chromium fixtures',externalAiCalls:0,cloudBrowserCalls:0,scoredCases:scored.length,tp,fp,fn,tn,unresolvedCases:rows.filter(r=>r.truth==='unresolved').length,reviewSignals:rows.filter(r=>r.truth==='review-signal').length,limitation:'Small authored regression set; not an independent holdout, customer accuracy estimate or guarantee.',rows,history:navigation.report,interrupted:interrupted.report,basic:basic.report};
  await fs.writeFile(new URL('verification.json',dir),JSON.stringify(receipt,null,2));
});

test('basic mode cannot silently discard a journey and evidence-free checks cannot pass',()=>{
  const base={inspectionMode:'basic',url:'https://example.com',title:'Basic',requirement:'Inspect',steps:[],reviewed:true};
  assert.ok(jobSchema.safeParse(base).success);
  for(const extra of [{steps:[{action:'click',target:'Save'}]},{expectedTexts:['Saved']},{cloudAiConsent:true},{requireResultChange:true}])assert.equal(jobSchema.safeParse({...base,...extra}).success,false);
  assert.equal(jobStatus([],null,false),'inconclusive');assert.equal(jobStatus([{status:'review'}],null,false),'review');assert.equal(jobStatus([{status:'not_run'}],null,false),'inconclusive');
  const redacted=redactReport({status:'passed',mode:'browser-contracts',engineVersion:'0.2.0',checks:[{id:'result-change',catalogId:'state-change',status:'passed',title:'password=passed'}],steps:[{action:'select',status:'passed',target:'secret-value'}],scope:{catalogVersion:'v1',items:[{id:'controls',status:'not_tested'}]}},['on','passed','select','secret-value']);
  assert.equal(redacted.status,'passed');assert.equal(redacted.steps[0].action,'select');assert.equal(redacted.steps[0].target,'[MASKED]');assert.equal(redacted.scope.items[0].id,'controls');assert.doesNotMatch(redacted.checks[0].title,/password=passed/);
  const journey={...base,inspectionMode:'journey',expectedPath:'/',expectedTexts:['Saved']};
  assert.equal(jobSchema.safeParse({...journey,steps:[{action:'back',target:'https://other.test'}]}).success,false);
  assert.equal(jobSchema.safeParse({...journey,steps:[{action:'press',target:'Submit',value:'Enter'}]}).success,false);
});
