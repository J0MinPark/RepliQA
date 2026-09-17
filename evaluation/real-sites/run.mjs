import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {runBrowser} from '../../cloud/src/runner.mjs';
import {jobSchema} from '../../cloud/src/schema.mjs';
import {installGuard} from '../../cloud/src/target-guard.mjs';
const label=process.argv[2];if(!/^[a-z0-9-]+$/.test(label||''))throw Error('Fresh label required');
const output=new URL(`../../docs/evidence/real-sites/${label}/`,import.meta.url);await fs.mkdir(new URL('../../docs/evidence/real-sites/',import.meta.url),{recursive:true});await fs.mkdir(output);
const sites=[
  {id:'github',company:'GitHub',url:'https://docs.github.com/en',heading:'GitHub Docs',link:'Migrations',destination:'/en/migrations',hosts:['docs.github.com','collector.githubapp.com']},
  {id:'cloudflare',company:'Cloudflare',url:'https://developers.cloudflare.com/',heading:'Cloudflare Developer Docs',link:'Create your first Worker',destination:'/workers/get-started/guide/',hosts:['developers.cloudflare.com','ot.www.cloudflare.com','static.cloudflareinsights.com','geolocation.onetrust.com']},
  {id:'vercel',company:'Vercel / Next.js',url:'https://nextjs.org/docs',heading:'Next.js Docs',link:'Installation',destination:'/docs/app/getting-started/installation',hosts:['nextjs.org','cdn.cr-relay.com','api.cr-relay.com']},
];
const cases=sites.flatMap(site=>['basic','journey'].map(mode=>{
  const home=new URL(site.url).pathname;
  const steps=mode==='basic'?[]:[{action:'assertText',target:'h1',value:site.heading},{action:'click',target:site.link},{action:'assertUrl',target:site.destination},{action:'scroll',target:'down',value:'600'},{action:'back',target:home},{action:'forward',target:site.destination},{action:'reload',target:site.destination},{action:'back',target:home},{action:'assertText',target:'h1',value:site.heading}];
  const job=jobSchema.parse({inspectionMode:mode,url:site.url,title:`${site.company} ${mode}`,requirement:mode==='basic'?'Inspect the current public document.':'Open the named documentation link, scroll, navigate back/forward, reload, return and confirm the homepage heading. No forms or account actions.',steps,reviewed:true,...(mode==='journey'?{expectedPath:home,expectedTexts:[site.heading],resultSelector:'h1'}:{})});
  return {site,mode,job};
}));
const sources={};for(const file of ['cloud/src/runner.mjs','cloud/src/target-guard.mjs','cloud/src/actions.mjs','cloud/src/basic-checks.mjs','cloud/src/schema.mjs','evaluation/real-sites/run.mjs'])sources[file]=createHash('sha256').update(await fs.readFile(new URL('../../'+file,import.meta.url))).digest('hex');
await fs.writeFile(new URL('manifest.json',output),JSON.stringify({frozenAt:new Date().toISOString(),sources,cases,environment:'RTX 4060 server / local Chromium / production network guard',repeats:1,groundTruth:'No independent site defect oracle. Requirements are read-only navigation contracts based on a prior public-page observation.'},null,2));
const require=createRequire(new URL('../../desktop/package.json',import.meta.url));process.env.PLAYWRIGHT_BROWSERS_PATH=fileURLToPath(new URL('../../desktop/vendor/browsers',import.meta.url));const {chromium}=require('playwright');const browser=await chromium.launch();const rows=[];
try{for(const item of cases){
  let context;const failedRequests=[];let requests=0;const started=Date.now();
  const result=await runBrowser(item.job,{signal:AbortSignal.timeout(55000),launch:async()=>({newContext:async options=>context=await browser.newContext(options),close:async()=>context?.close()}),guard:async ctx=>{
    ctx.on('request',()=>requests++);ctx.on('requestfailed',req=>{try{const url=new URL(req.url());failedRequests.push({origin:url.origin,path:url.pathname,error:req.failure()?.errorText});}catch{}});
    return installGuard(ctx,{origins:JSON.stringify([new URL(item.site.url).origin]),resource_hosts:JSON.stringify(item.site.hosts)});
  }});
  const row={id:item.site.id,company:item.site.company,url:item.site.url,mode:item.mode,wallMs:Date.now()-started,requests,failedRequests,report:result.report};
  await fs.writeFile(new URL(`${row.id}-${row.mode}.json`,output),JSON.stringify(row,null,2));if(result.screenshot)await fs.writeFile(new URL(`${row.id}-${row.mode}.jpg`,output),result.screenshot);rows.push(row);
  console.log(JSON.stringify({site:row.id,mode:row.mode,status:row.report.status,completedSteps:row.report.scope.completedSteps,wallMs:row.wallMs,requests,failedRequests:failedRequests.length}));
}}finally{await browser.close();}
const result={completedAt:new Date().toISOString(),engineVersion:'0.2.5',sites:sites.length,runs:rows.length,cloudBrowserCalls:0,externalAiCalls:0,limitation:'Live public-page execution, not proof of site-wide QA, fault-detection accuracy, load testing, or independent ground truth.',rows};
await fs.writeFile(new URL('result.json',output),JSON.stringify(result,null,2));
