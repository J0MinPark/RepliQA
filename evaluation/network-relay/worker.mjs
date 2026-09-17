import {launch,limits,sessions} from '../../cloud/node_modules/@cloudflare/playwright/lib/index.js';
import {runBrowser} from '../../cloud/src/runner.mjs';
import {createNetworkRelay} from '../../cloud/src/network-relay.mjs';
import {installGuard,sessionGuardrails} from '../../cloud/src/target-guard.mjs';
import {jobSchema} from '../../cloud/src/schema.mjs';
import {sourceHash} from './revision.mjs';
export {NetworkRelay} from '../../cloud/src/network-relay.mjs';
export default {async fetch(request,env){
  const path=new URL(request.url).pathname;
  if(path==='/echo')return new Response('relay-probe-ok');
  if(path==='/fixture/redirect')return Response.redirect('https://127.0.0.1/',302);
  if(path==='/fixture/asset')return new Response(new Uint8Array([0,128,255]),{headers:{'content-type':'application/octet-stream'}});
  if(path==='/fixture/compressed')return new Response(new Response('compressed-ok').body.pipeThrough(new CompressionStream('gzip')),{headers:{'content-type':'text/plain','content-encoding':'gzip'},encodeBody:'manual'});
  if(path==='/fixture/start'){
    const headers=new Headers({'content-type':'text/html'});headers.append('set-cookie','first=one; Secure; SameSite=Lax; Path=/');headers.append('set-cookie','second=two; Secure; SameSite=Lax; Path=/');
    return new Response(`<html lang="en"><title>Relay fixture</title><h1>Relay fixture</h1><p id="assets">Loading</p><button onclick="document.querySelector('#result').textContent='Complete'">Continue</button><p id="result">Waiting</p><script>(async()=>{const all=await Promise.all(Array.from({length:120},async(_,i)=>[...new Uint8Array(await(await fetch('/fixture/asset?i='+i)).arrayBuffer())]));const compressed=await(await fetch('/fixture/compressed')).text();document.querySelector('#assets').textContent=all.every(v=>JSON.stringify(v)==='[0,128,255]')&&compressed==='compressed-ok'&&document.cookie.includes('first=one')&&document.cookie.includes('second=two')?'Assets ready 120':'Assets invalid';})()</script></html>`,{headers});
  }
  if(!env.PROBE_TOKEN||request.headers.get('authorization')!=='Bearer '+env.PROBE_TOKEN)return new Response('Unauthorized',{status:401});
  if(path==='/usage')return Response.json({limits:await limits(env.BROWSER),sessions:await sessions(env.BROWSER),sourceHash});
  if(path==='/security'&&request.method==='POST'){
    const origin=new URL(request.url).origin,checks=[];
    const token=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('');
    const a={stub:env.NETWORK_RELAY.get(env.NETWORK_RELAY.newUniqueId()),token:token()},b={stub:env.NETWORK_RELAY.get(env.NETWORK_RELAY.newUniqueId()),token:token()};
    const send=(object,id,input,capability=object.token)=>object.stub.fetch('https://relay.internal/resource',{method:'POST',headers:{'x-repliqa-capability':capability,'x-repliqa-request-id':String(id)},body:JSON.stringify({url:origin+'/echo',method:'GET',headers:[],...input})});
    const check=async(name,response,status,reason)=>{const body=await response.text();checks.push({name,status:response.status,reason:response.headers.get('x-repliqa-relay-error'),passed:response.status===status&&(!reason||response.headers.get('x-repliqa-relay-error')===reason),...(name==='public-response'?{body}: {})});};
    try{
      for(const [i,object] of [a,b].entries()){const response=await object.stub.fetch('https://relay.internal/init',{method:'POST',body:JSON.stringify({token:object.token,tenantId:'tenant-'+i,runId:crypto.randomUUID(),origins:JSON.stringify([origin]),resource_hosts:'["127.0.0.1"]'})});if(!response.ok)throw Error('Init failed');}
      await check('foreign-run-capability',await send(b,1,{},a.token),403,'session-unavailable');
      await check('public-response',await send(a,1),200);
      await check('duplicate-request',await send(a,1),409,'duplicate-request');
      await check('private-literal',await send(a,2,{url:'https://127.0.0.1/'}),403,'private-address');
      await check('redirect-to-private',await send(a,3,{url:origin+'/fixture/redirect'}),403,'redirect');
      await check('unregistered-host',await send(a,4,{url:'https://example.com/'}),403,'policy');
      const closed=await a.stub.fetch('https://relay.internal/close',{method:'POST',headers:{'x-repliqa-capability':a.token}});await closed.body?.cancel();
      await check('closed-run',await send(a,5),403,'session-unavailable');
      await check('other-run-still-open',await send(b,1),200);
      return Response.json({sourceHash,checks,passed:checks.every(c=>c.passed),scope:'Actual deployed namespace isolation, public fetch and policy rejection. Not controlled DNS-rebinding proof.'});
    }finally{for(const object of [a,b]){const response=await object.stub.fetch('https://relay.internal/close',{method:'POST',headers:{'x-repliqa-capability':object.token}});await response.body?.cancel();}}
  }
  if(path==='/run'&&request.method==='POST'){
    const usage=await limits(env.BROWSER);if(usage.usedBrowserTimeSeconds>=450||(await sessions(env.BROWSER)).length)return new Response('Diagnostic free budget unavailable',{status:409});
    const {job,tenant}=await request.json();const relay=await createNetworkRelay(env.NETWORK_RELAY,tenant,crypto.randomUUID());
    try{const {report,screenshot}=await runBrowser(jobSchema.parse(job),{launch:()=>launch(env.BROWSER,{guardrails:sessionGuardrails(tenant)}),guard:context=>installGuard(context,tenant,fetch,relay),signal:AbortSignal.timeout(65000)});return Response.json({report,screenshotBase64:screenshot?Buffer.from(screenshot).toString('base64'):null});}finally{await relay.close();}
  }
  return new Response('Not found',{status:404});
}};
