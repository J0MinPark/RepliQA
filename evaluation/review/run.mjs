import fs from 'node:fs/promises';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {runBrowser} from '../../cloud/src/runner.mjs';
import {verifyPack} from './verify.mjs';
const [pack,reviewFile,label]=process.argv.slice(2);
if(!reviewFile||!/^[a-z0-9-]+$/.test(label||''))throw Error('Usage: node evaluation/review/run.mjs PACK REVIEW_FILE FRESH_RESULT_LABEL');
// Deliberately verify human review before creating a server or launching Chromium.
const frozen=await verifyPack(pack,reviewFile);
const out=new URL(`../results/${label}/`,import.meta.url);await fs.mkdir(out,{recursive:false});
await fs.writeFile(new URL('manifest.json',out),JSON.stringify({...frozen.manifest,reviewHash:frozen.reviewHash,reviewer:frozen.review.reviewer,startedAt:new Date().toISOString()},null,2));
const server=http.createServer((req,res)=>{const item=frozen.cases.find(c=>new URL(req.url,'http://fixture').pathname==='/case/'+c.id);res.writeHead(item?200:404,{'content-type':'text/html; charset=utf-8'});res.end(item?.html||'Not found');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
process.env.PLAYWRIGHT_BROWSERS_PATH=fileURLToPath(new URL('../../desktop/vendor/browsers',import.meta.url));
let browser,outsideRequests=0;const rows=[];
try{
  browser=await chromium.launch();
  for(let repeat=0;repeat<2;repeat++)for(const item of repeat?[...frozen.cases].reverse():frozen.cases){
    let context;const job={...item.job,url:origin+new URL(item.job.url).pathname};
    const {report}=await runBrowser(job,{launch:async()=>({newContext:async options=>context=await browser.newContext(options),close:async()=>context?.close()}),guard:ctx=>ctx.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){outsideRequests++;return route.abort();}return route.continue();})});
    const truth=frozen.oracle.find(c=>c.id===item.id);const row={id:item.id,repeat,truth:truth.truth,expected:truth.expected,status:report.status,report};rows.push(row);await fs.appendFile(new URL('observations.jsonl',out),JSON.stringify(row)+'\n');
  }
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
await verifyPack(pack,reviewFile);
const first=rows.filter(r=>r.repeat===0),normal=first.filter(r=>r.truth==='normal'),defects=first.filter(r=>r.truth==='defect');
const result={completedAt:new Date().toISOString(),uniqueCases:frozen.cases.length,observations:rows.length,firstObservations:{normal:normal.length,defects:defects.length,falsePositives:normal.filter(r=>r.status==='failed').length,missedDefectsIncludingInconclusive:defects.filter(r=>r.status!=='failed').length,falsePasses:defects.filter(r=>r.status==='passed').length,completed:first.filter(r=>['passed','failed'].includes(r.status)).length},outsideRequests,cloudBrowserCalls:0,externalAiCalls:0,mismatches:rows.filter(r=>r.status!==r.expected).map(({id,repeat,status,expected})=>({id,repeat,status,expected})),limitation:'Externally reviewed author-generated synthetic contracts, not a blind customer benchmark or accuracy guarantee.',rows};
await fs.writeFile(new URL('result.json',out),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,rows:undefined}));if(outsideRequests||result.mismatches.length)process.exitCode=1;
