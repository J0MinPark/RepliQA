import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {chromium,expect} from '@playwright/test';
import {runBrowser} from '../cloud/src/runner.mjs';
import {jobSchema} from '../cloud/src/schema.mjs';
import privacy from '../desktop/src/privacy.cjs';
import {cases,corpusVersion,planFor,htmlFor} from './cases.mjs';
import {summarize} from './metrics.mjs';

process.env.PLAYWRIGHT_BROWSERS_PATH=fileURLToPath(new URL('../desktop/vendor/browsers',import.meta.url));
const args=process.argv.slice(2);
const option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const label=option('--label','measurement');
if(!/^[a-z0-9-]+$/.test(label))throw new Error('Use a simple measurement label');
const repeats=Number(option('--repeats','1'));
if(!Number.isInteger(repeats)||repeats<1||repeats>10)throw new Error('repeats must be 1..10');
const output=new URL(`results/${label}/`,import.meta.url);
await fs.mkdir(output,{recursive:true});
try{await fs.access(new URL('manifest.json',output));throw new Error('Measurement already exists, including partial runs; choose a new label');}catch(error){if(error.code!=='ENOENT')throw error;}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourcePaths=['evaluation/cases.mjs','evaluation/run.mjs','evaluation/gate.mjs','evaluation/metrics.mjs','evaluation/package-lock.json','cloud/src/runner.mjs','cloud/src/outcomes.mjs','cloud/src/schema.mjs','cloud/src/actions.mjs','cloud/src/report.mjs','cloud/src/basic-checks.mjs','cloud/src/target-guard.mjs','cloud/src/worker.mjs','cloud/public/qa-catalog.js','desktop/src/browser-flow.cjs','desktop/src/privacy.cjs','desktop/src/scroll.cjs','backend/src/design/actions.js','backend/src/engine/paymentSafety.js'];
const sources={};
sourcePaths.push('cloud/test/live-site-adaptation.test.mjs');
sourcePaths.push('cloud/src/repository.mjs','cloud/src/restore-policy.mjs','cloud/test/security-operations.test.mjs','cloud/test/target-guard.test.mjs');
sourcePaths.push('cloud/src/assertions.mjs','cloud/src/accessibility.mjs','cloud/src/axe-source.mjs','cloud/scripts/sync-axe-source.mjs','cloud/package-lock.json','cloud/public/reproduction.js','cloud/public/app.js','cloud/public/index.html');
sourcePaths.push('cloud/public/plans.js','cloud/public/beta.html','cloud/test/portal.test.mjs','cloud/test/plans.test.mjs','cloud/test/checked-action.test.mjs','cloud/scripts/deploy.mjs','cloud/scripts/check-deployment.mjs');
for(const source of sourcePaths){const bytes=await fs.readFile(new URL(`../${source}`,import.meta.url));sources[source]=hash(bytes);await fs.mkdir(new URL(`sources/${path.dirname(source)}/`,output),{recursive:true});await fs.writeFile(new URL(`sources/${source}`,output),bytes);}
const manifest={version:corpusVersion,cases,sources,repeats,label,frozenAt:new Date().toISOString(),scope:'Authored synthetic functional contracts. Not independent customer or AI discovery evaluation.'};
await fs.writeFile(new URL('manifest.json',output),JSON.stringify(manifest,null,2));

const server=http.createServer((req,res)=>{
  const match=new URL(req.url,'http://fixture').pathname.match(/^\/case\/([^/]+)(\/preview)?$/);
  const item=cases.find(c=>c.id===match?.[1]);
  if(!item){res.writeHead(404);return res.end();}
  res.setHeader('content-type','text/html; charset=utf-8');res.setHeader('cache-control','no-store');res.end(htmlFor(item,!!match[2]));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
let outsideRequests=0;
const guard=context=>context.route('**/*',route=>{
  if(new URL(route.request().url()).origin!==origin){outsideRequests++;return route.abort();}
  return route.continue();
});

// Independently authored Playwright assertions. No RepliQA locators, flow or outcome judge.
async function reference(job,signal){
  const started=Date.now();let context,page,status='passed',error;let completedSteps=0;let screenshot;
  try{
    signal?.throwIfAborted();
    context=await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block',acceptDownloads:false});
    await guard(context);page=await context.newPage();page.setDefaultTimeout(4000);
    await page.goto(job.url,{waitUntil:'domcontentloaded'});
    const before=job.resultSelector?await page.locator(job.resultSelector).allInnerTexts():null;
    if(before?.length>1)throw new Error('Ambiguous result');
    for(const step of job.steps){
      if(step.action.startsWith('assert')){
        const target=page.locator(step.action==='assertUrl'?'body':step.target);
        if(!['assertCount','assertUrl'].includes(step.action)&&await target.count()!==1)throw new Error('Unresolved assertion target');
        if(step.action==='assertChecked'&&!await target.evaluate(el=>el.matches('input[type=checkbox],input[type=radio]')))throw new Error('Unsupported check control');
        for(let observation=0;observation<3;observation++){
          const options={timeout:3000};
          if(step.action==='assertText')await expect(target).toHaveText(step.value,{useInnerText:true,...options});
          if(step.action==='assertValue')await expect(target).toHaveValue(step.value,options);
          if(step.action==='assertChecked')await expect(target).toBeChecked({checked:step.value==='true',...options});
          if(step.action==='assertEnabled')await expect(target).toBeEnabled({enabled:step.value==='true',...options});
          if(step.action==='assertVisible')await expect(target).toBeVisible(options);
          if(step.action==='assertHidden')await expect(target).toBeHidden(options);
          if(step.action==='assertCount')await expect(target).toHaveCount(Number(step.value),options);
          if(step.action==='assertUrl')await expect(page).toHaveURL(origin+step.target,options);
          if(observation<2)await page.waitForTimeout(150);
        }
      }else if(['back','forward','reload'].includes(step.action)){
        await page[{back:'goBack',forward:'goForward',reload:'reload'}[step.action]]({waitUntil:'domcontentloaded'});
        await expect(page).toHaveURL(origin+step.target,{timeout:3000});
      }else{
        const locator=['fill','select'].includes(step.action)?page.getByLabel(step.target,{exact:true}):page.getByRole('button',{name:step.target,exact:true}).or(page.getByRole('link',{name:step.target,exact:true}));
        await locator.waitFor({state:'visible',timeout:3000});
        if(await locator.count()!==1)throw new Error('Ambiguous control');
        if(step.action==='fill')await locator.fill(step.value);
        else if(step.action==='select')await locator.selectOption({label:step.value});
        else{
          const target=await locator.getAttribute('target');
          if(target==='_blank'){
            const [popup]=await Promise.all([page.waitForEvent('popup'),locator.click()]);page=popup;await page.waitForLoadState('domcontentloaded');
          }else await locator.click();
        }
      }
      completedSteps++;
    }
    await expect(page).toHaveURL(origin+job.expectedPath,{timeout:3000});
    for(let observation=0;observation<3;observation++){
      for(const text of job.expectedTexts){
        if(job.resultSelector){
          const target=page.locator(job.resultSelector);
          await expect(target).toBeVisible({timeout:4000});
          await expect(target).toHaveText(text,{useInnerText:true,timeout:4000});
          // Native visibility permits opacity:0. Our specified visible-result contract also excludes it.
          // Inspect transparency independently of RepliQA's text walker.
          await expect.poll(()=>target.evaluate(el=>[el,...el.querySelectorAll('*')].some(node=>node.textContent.trim()&&Number(getComputedStyle(node).opacity)===0)),{timeout:4000}).toBe(false);
        }else{
          await expect.poll(async()=> (await page.locator('body').innerText()).split('\n').map(s=>s.trim()).filter(Boolean),{timeout:4000}).toContain(text);
        }
      }
      if(job.requireResultChange)await expect.poll(()=>page.locator(job.resultSelector).innerText(),{timeout:4000}).not.toBe(before?.[0]);
      if(observation<2)await page.waitForTimeout(200);
    }
    if(job.cloudAiConsent)throw new Error('Requested AI review unavailable in this no-cost evaluation');
    screenshot=await privacy.screenshotMasked(page,{selectors:['iframe'],secrets:job.steps.filter(s=>s.action==='fill').map(s=>s.value),type:'jpeg'});
  }catch(caught){error=caught.message;status=caught.matcherResult||/^expect\(/.test(error)?'failed':'inconclusive';}
  const writeCount=await page?.evaluate(()=>window.writeCount?.()).catch(()=>null);
  await context?.close();
  return {status,error,completedSteps,writeCount,durationMs:Date.now()-started,screenshot};
}

const rows=[];
try{
  for(let repetition=0;repetition<repeats;repetition++)for(const [index,item] of cases.entries()){
    const engines=(index+repetition)%2?['playwright','repliqa']:['repliqa','playwright'];
    for(const engine of engines){
      const job=jobSchema.parse(planFor(item,origin));
      const controller=new AbortController();if(item.variant==='cancel')controller.abort();
      let result;
      if(engine==='repliqa'){
        let context;let writes;const started=Date.now();
        const captured=await runBrowser(job,{signal:controller.signal,guard,launch:async()=>({
          newContext:async options=>context=await browser.newContext(options),
          close:async()=>{const page=context?.pages().at(-1);writes=await page?.evaluate(()=>window.writeCount?.()).catch(()=>null);await context?.close();},
        })});
        result={status:captured.report.status,error:captured.report.error,completedSteps:captured.report.scope.completedSteps,writeCount:writes,durationMs:Date.now()-started,screenshot:captured.screenshot,report:captured.report};
      }else result=await reference(job,controller.signal);
      const row={id:item.id,family:item.family,truth:item.truth,engine,repetition,...result};
      delete row.screenshot;rows.push(row);
      if(result.screenshot)await fs.writeFile(new URL(`${engine}-${item.id}-${repetition}.jpg`,output),result.screenshot);
      await fs.appendFile(new URL('observations.jsonl',output),JSON.stringify(row)+'\n');
      console.log(JSON.stringify({engine,id:item.id,status:row.status,ms:row.durationMs}));
    }
  }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
const summaries={};
for(const engine of ['repliqa','playwright']){
  const selected=rows.filter(r=>r.engine===engine);
  summaries[engine]={allRuns:summarize(selected),firstObservations:summarize(selected.filter(r=>r.repetition===0)),byFamily:Object.fromEntries([...new Set(cases.map(c=>c.family))].map(f=>[f,summarize(selected.filter(r=>r.family===f))]))};
}
const mismatches=rows.filter(r=>r.status!==({normal:'passed',defect:'failed',unresolved:'inconclusive'}[r.truth])).map(({id,engine,status,truth,repetition})=>({id,engine,status,truth,repetition}));
const disagreements=rows.filter(r=>r.engine==='repliqa'&&r.status!==rows.find(p=>p.engine==='playwright'&&p.id===r.id&&p.repetition===r.repetition)?.status).map(r=>({id:r.id,repetition:r.repetition,repliqa:r.status,playwright:rows.find(p=>p.engine==='playwright'&&p.id===r.id&&p.repetition===r.repetition)?.status}));
const receipt={completedAt:new Date().toISOString(),manifestHash:hash(JSON.stringify(manifest)),...manifest,
  environment:{node:process.version,platform:process.platform,browser:browser.version(),playwright:'1.58.2',hardware:'RTX 4060 server',context:'One shared local browser process; fresh context per observation'},
  externalAiCalls:0,cloudBrowserCalls:0,outsideRequests,
  timingScope:'Context creation through close; includes actions, assertions and masked screenshot on successful paths. Browser process cold launch, AI planning, cloud transport/storage excluded. Engines perform different reporting work; this is overhead observation, not equivalent full-product throughput.',
  statistics:'Repeated executions are correlated. Use firstObservations for case counts and Wilson intervals; even distinct authored cases are not a random population sample.',
  summaries,mismatches,disagreements,rows};
await fs.writeFile(new URL('result.json',output),JSON.stringify(receipt,null,2));
console.log(JSON.stringify({output:fileURLToPath(output),summaries:Object.fromEntries(Object.entries(summaries).map(([e,m])=>[e,m.allRuns])),mismatches,disagreements,outsideRequests}));
