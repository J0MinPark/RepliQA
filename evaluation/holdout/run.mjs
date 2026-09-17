import fs from 'node:fs/promises';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {runBrowser} from '../../cloud/src/runner.mjs';
import {jobSchema} from '../../cloud/src/schema.mjs';
import {cases,fixture,plan} from './cases.mjs';
import {summarize} from '../metrics.mjs';
const label=process.argv[2];if(!/^[a-z0-9-]+$/.test(label||''))throw new Error('Supply a fresh measurement label');
const output=new URL(`../results/${label}/`,import.meta.url);await fs.mkdir(output,{recursive:false});
const hash=b=>createHash('sha256').update(b).digest('hex');
const sources={};
for(const file of ['evaluation/holdout/cases.mjs','evaluation/holdout/run.mjs','cloud/src/runner.mjs','cloud/src/assertions.mjs','cloud/src/outcomes.mjs','cloud/src/actions.mjs','cloud/src/schema.mjs','desktop/src/browser-flow.cjs','backend/src/design/actions.js']) sources[file]=hash(await fs.readFile(new URL('../../'+file,import.meta.url)));
const frozen={frozenAt:new Date().toISOString(),sources,cases,contracts:cases.map(c=>plan(c,'http://fixture.test')),fixtures:cases.map(c=>({id:c.id,html:fixture(c)})),repeats:2,independence:'Separate new workflows; same author as implementation, NOT third-party independent evaluation. No engine tuning permitted within this measurement.'};
await fs.writeFile(new URL('manifest.json',output),JSON.stringify(frozen,null,2));
const server=http.createServer((req,res)=>{const id=new URL(req.url,'http://fixture').pathname.split('/').at(-1);const item=cases.find(c=>c.id===id);res.writeHead(item?200:404,{'content-type':'text/html; charset=utf-8'});res.end(item?fixture(item):'Missing fixture');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
process.env.PLAYWRIGHT_BROWSERS_PATH=fileURLToPath(new URL('../../desktop/vendor/browsers',import.meta.url));
const browser=await chromium.launch();const rows=[];let outsideRequests=0;
try{for(let repetition=0;repetition<2;repetition++)for(const item of repetition?[...cases].reverse():cases){
  let context;const start=Date.now();
  const result=await runBrowser(jobSchema.parse(plan(item,origin)),{signal:new AbortController().signal,
    guard:ctx=>ctx.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){outsideRequests++;return route.abort();}return route.continue();}),
    launch:async()=>({newContext:async options=>context=await browser.newContext(options),close:async()=>context?.close()})});
  const row={...item,repetition,status:result.report.status,durationMs:Date.now()-start,report:result.report};rows.push(row);
  await fs.appendFile(new URL('observations.jsonl',output),JSON.stringify(row)+'\n');console.log(JSON.stringify({id:item.id,repetition,status:row.status}));
}}finally{await browser.close();await new Promise(r=>server.close(r));}
const changed=[];for(const [file,expected] of Object.entries(sources))if(hash(await fs.readFile(new URL('../../'+file,import.meta.url)))!==expected)changed.push(file);
const mismatches=rows.filter(r=>r.status!==(r.truth==='normal'?'passed':'failed')).map(({id,repetition,truth,status})=>({id,repetition,truth,status}));
const result={...frozen,completedAt:new Date().toISOString(),hardware:'RTX 4060 server',uniqueCases:cases.length,observations:rows.length,firstObservations:summarize(rows.filter(r=>r.repetition===0)),mismatches,sourceChanges:changed,outsideRequests,externalAiCalls:0,cloudBrowserCalls:0,passed:!mismatches.length&&!changed.length&&!outsideRequests,rows};
await fs.writeFile(new URL('result.json',output),JSON.stringify(result,null,2));console.log(JSON.stringify({passed:result.passed,uniqueCases:cases.length,mismatches,sourceChanges:changed}));if(!result.passed)process.exitCode=1;
