import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {sourceHash} from './revision.mjs';
const origin=process.env.REPLIQA_RELAY_ORIGIN;if(!origin||new URL(origin).protocol!=='https:')throw Error('Set REPLIQA_RELAY_ORIGIN');
const token=process.env.REPLIQA_RELAY_TOKEN;if(!token)throw Error('Set REPLIQA_RELAY_TOKEN without committing it');const headers={authorization:'Bearer '+token,'content-type':'application/json'};
const mode=process.argv[2],label=process.argv[3];if(!['fixture','github','vercel','github-basic','vercel-basic'].includes(mode)||!/^[a-z0-9-]+$/.test(label||''))throw Error('Mode and fresh label required');
const output=new URL(`../../docs/evidence/network-relay/${label}.json`,import.meta.url);try{await fs.access(output);throw Error('Evidence exists');}catch(e){if(e.code!=='ENOENT')throw e;}
let usage;for(let i=0;i<15;i++){const response=await fetch(origin+'/usage',{headers});if(response.ok){const current=await response.json();if(current.sourceHash===sourceHash){usage=current;break;}}await new Promise(r=>setTimeout(r,2000));}
if(!usage||usage.limits.usedBrowserTimeSeconds>=450||usage.sessions.length)throw Error('Free diagnostic preflight failed');
let job,tenant;
if(mode==='fixture'){
  tenant={id:'fixture',origins:JSON.stringify([origin]),resource_hosts:'[]'};
  job={inspectionMode:'journey',url:origin+'/fixture/start',title:'120 resources, cookies and compression',requirement:'All 120 binary resources load intact, compressed response decodes, two cookies survive, and one click changes the result.',steps:[{action:'assertText',target:'#assets',value:'Assets ready 120'},{action:'click',target:'Continue'},{action:'assertText',target:'#result',value:'Complete'}],expectedPath:'/fixture/start',expectedTexts:['Complete'],resultSelector:'#result',reviewed:true};
}else{
  const manifest=JSON.parse(await fs.readFile(new URL('../../docs/evidence/real-sites/enterprise-20260918-first/manifest.json',import.meta.url),'utf8'));const item=manifest.cases.find(c=>c.site.id===mode.replace('-basic','')&&c.mode===(mode.endsWith('-basic')?'basic':'journey'));job=item.job;tenant={id:mode,origins:JSON.stringify([new URL(item.site.url).origin]),resource_hosts:JSON.stringify(item.site.hosts)};
}
const sources={};for(const path of ['cloud/src/network-relay.mjs','cloud/src/target-guard.mjs','cloud/src/actions.mjs','cloud/src/runner.mjs'])sources[path]=createHash('sha256').update(await fs.readFile(new URL('../../'+path,import.meta.url))).digest('hex');
await new Promise(resolve=>setTimeout(resolve,Math.max(25000,usage.limits.timeUntilNextAllowedBrowserAcquisition||0)));
const started=Date.now();const response=await fetch(origin+'/run',{method:'POST',headers,body:JSON.stringify({job,tenant}),signal:AbortSignal.timeout(85000)});
if(!response.ok)throw Error('Probe HTTP '+response.status);
const result=await response.json();if(result.screenshotBase64){await fs.writeFile(new URL(`../../docs/evidence/network-relay/${label}.jpg`,import.meta.url),Buffer.from(result.screenshotBase64,'base64'));delete result.screenshotBase64;}
const receipt={measuredAt:new Date().toISOString(),mode,runtime:'Deployed Free Worker + SQLite Durable Object relay + Cloudflare Browser',sources,job,wallMs:Date.now()-started,usageBefore:usage,externalAiCalls:0,productionReservations:0,...result};await fs.writeFile(output,JSON.stringify(receipt,null,2));console.log(JSON.stringify({mode,label,status:result.report.status,steps:result.report.scope.completedSteps,network:result.report.network,error:result.report.error}));
if(!mode.endsWith('-basic')&&result.report.status!=='passed')process.exitCode=1;
