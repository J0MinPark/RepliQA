// Read-only diagnostic for the frozen Next.js journey; never changes the oracle.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {runBrowser} from '../../cloud/src/runner.mjs';
import {installGuard} from '../../cloud/src/target-guard.mjs';
const label=process.argv[2];if(!/^[a-z0-9-]+$/.test(label||''))throw Error('Fresh label required');
const output=new URL(`../../docs/evidence/real-sites/${label}/`,import.meta.url);await fs.mkdir(output);
const manifest=JSON.parse(await fs.readFile(new URL('../../docs/evidence/real-sites/enterprise-20260918-first/manifest.json',import.meta.url)));
const require=createRequire(new URL('../../desktop/package.json',import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH=fileURLToPath(new URL('../../desktop/vendor/browsers',import.meta.url));
const browser=await require('playwright').chromium.launch();const rows=[];
try{for(const item of manifest.cases.filter(c=>['github','vercel'].includes(c.site.id))){
  let context,state;const events=[];let closing=false;
  const result=await runBrowser(item.job,{signal:AbortSignal.timeout(55000),launch:async()=>({
    newContext:async options=>context=await browser.newContext(options),
    close:async()=>{
      if(closing)return;closing=true;
      for(const page of context?.pages()||[])try{
        const headings=await page.locator('h1').evaluateAll(els=>els.map(el=>({text:el.textContent?.slice(0,150),ancestors:[el,...function*(e){while(e=e.parentElement)yield e;}(el)].map(e=>({tag:e.tagName,display:getComputedStyle(e).display,visibility:getComputedStyle(e).visibility,opacity:getComputedStyle(e).opacity,ariaHidden:e.getAttribute('aria-hidden')})),rects:el.getClientRects().length})));
        events.push({phase:'before-close',blockedRequests:state?.blockedRequests,headings});
      }catch{}
      await context?.close();events.push({phase:'after-close',blockedRequests:state?.blockedRequests});
    }
  }),guard:async ctx=>{
    ctx.on('requestfailed',r=>events.push({phase:closing?'closing':'running',event:'requestfailed',origin:new URL(r.url()).origin,error:r.failure()?.errorText}));
    const wrapped={routeWebSocket:ctx.routeWebSocket.bind(ctx),route:(_,handler)=>ctx.route('**/*',route=>handler({
      request:()=>route.request(),abort:code=>route.abort(code),
      fetch:async options=>{try{return await route.fetch(options);}catch(error){events.push({phase:closing?'closing':'running',event:'route-fetch-error',origin:new URL(route.request().url()).origin,error:error.message.split('\n')[0]});throw error;}},
      fulfill:async options=>{try{return await route.fulfill(options);}catch(error){events.push({phase:closing?'closing':'running',event:'route-fulfill-error',origin:new URL(route.request().url()).origin,error:error.message.split('\n')[0]});throw error;}}
    }))};
    state=await installGuard(wrapped,{origins:JSON.stringify([new URL(item.site.url).origin]),resource_hosts:JSON.stringify(item.site.hosts)});return state;
  }});
  rows.push({site:item.site.id,mode:item.mode,report:result.report,events});
  console.log(JSON.stringify({site:item.site.id,mode:item.mode,status:result.report.status,events}));
}}
finally{await browser.close();}
const sources={};for(const file of ['cloud/src/outcomes.mjs','cloud/src/target-guard.mjs','cloud/src/runner.mjs'])sources[file]=createHash('sha256').update(await fs.readFile(new URL('../../'+file,import.meta.url))).digest('hex');
await fs.writeFile(new URL('result.json',output),JSON.stringify({sources,rows,externalAiCalls:0,cloudBrowserCalls:0},null,2));
