import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installGuard,sessionGuardrails} from '../src/target-guard.mjs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import http from 'node:http';
import {runBrowser} from '../src/runner.mjs';
import {jobSchema} from '../src/schema.mjs';

const tenant={origins:JSON.stringify(['https://example.com']),resource_hosts:JSON.stringify(['cdn.example.com'])};
async function harness(fetchImpl){
  let handler, websocket;
  await installGuard({route:async(_,fn)=>{handler=fn;},routeWebSocket:async(_,fn)=>{websocket=fn;}},tenant,fetchImpl);
  return {websocket, async request(url,navigation=false){let result;
    await handler({request:()=>({url:()=>url,isNavigationRequest:()=>navigation}),fetch:async options=>{assert.equal(options.maxRedirects,0);assert.equal(options.maxRetries,0);return {status:()=>200,dispose:async()=>{}};},fulfill:async()=>{result='allowed';},abort:async()=>{result='blocked';}});
    return result;
  }};
}
const dns=addresses=>async()=>Response.json({Status:0,Answer:addresses.map(data=>({type:data.includes(':')?28:1,data}))});
test('guard denies private/mixed/empty/error DNS and hostile URL variants',async()=>{
  for(const addresses of [['127.0.0.1'],['1.1.1.1','10.0.0.1'],['::ffff:127.0.0.1'],['169.254.169.254'],[]]){
    const h=await harness(dns(addresses));assert.equal(await h.request('https://example.com',true),'blocked');
  }
  const failure=await harness(async()=>{throw Error('DNS unavailable');});assert.equal(await failure.request('https://example.com'),'blocked');
  const h=await harness(dns(['1.1.1.1']));
  for(const url of ['http://example.com','https://example.com:444','https://user@example.com','https://example.com.evil.test','https://2130706433','https://0x7f000001','https://[::1]','https://cdn.example.com'])assert.equal(await h.request(url,true),'blocked',url);
  assert.equal(await h.request('https://cdn.example.com/image.png'),'allowed');
});
test('guard rechecks DNS after a previously public hostname changes',async()=>{
  let address='1.1.1.1';const h=await harness(async()=>dns([address])());
  assert.equal(await h.request('https://example.com/first'),'allowed');
  address='127.0.0.1';assert.equal(await h.request('https://example.com/second'),'blocked');
});
test('WebSockets cannot bypass the HTTP target guard',async()=>{
  const h=await harness(dns(['1.1.1.1']));assert.equal(typeof h.websocket,'function');
  let closed=false;await h.websocket({close:async()=>{closed=true;},connectToServer:()=>{throw Error('must not connect');}});assert.ok(closed);
});
test('session hostname policy is exact and rejects wildcards or invalid config',()=>{
  assert.deepEqual(sessionGuardrails(tenant),{allowedDomains:['example.com','cdn.example.com']});
  assert.throws(()=>sessionGuardrails({...tenant,resource_hosts:'["*.example.com"]'}));
  assert.throws(()=>sessionGuardrails({...tenant,resource_hosts:'["example.com/path"]'}));
});
test('real Chromium blocks redirected navigation, subrequests and WebSocket upstream',async t=>{
  const require=createRequire(new URL('../../desktop/package.json',import.meta.url));
  process.env.PLAYWRIGHT_BROWSERS_PATH=fileURLToPath(new URL('../../desktop/vendor/browsers',import.meta.url));
  const {chromium}=require('playwright');const browser=await chromium.launch();t.after(()=>browser.close());
  let upstream=0;const server=http.createServer((req,res)=>{
    if(req.url==='/redirect'){res.writeHead(302,{location:`http://${req.headers.host}/private`});return res.end();}
    if(req.url==='/private'){upstream++;return res.end('must not arrive');}
    res.setHeader('content-type','text/html');res.end('<title>Guard fixture</title><p>Ready</p>');
  });server.on('upgrade',(_,socket)=>{upstream++;socket.destroy();});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const local=`127.0.0.1:${server.address().port}`;
  const context=await browser.newContext({serviceWorkers:'block'});const blocked=[];
  // Only the approved synthetic origin is fulfilled locally. Everything else uses the production guard.
  const guarded={routeWebSocket:context.routeWebSocket.bind(context),route:(_,fn)=>context.route('**/*',route=>fn({
    request:()=>route.request(),abort:code=>{blocked.push(route.request().url());return route.abort(code);},
    // Map the synthetic HTTPS host onto this test's HTTP server only.
    fetch:options=>context.request.get(`http://${local}${new URL(route.request().url()).pathname}`,options),
    fulfill:options=>route.fulfill(options)
  }))};
  await installGuard(guarded,tenant,dns(['1.1.1.1']));const page=await context.newPage();await page.goto('https://example.com');
  await page.evaluate(async host=>{
    await fetch(`http://${host}/private`).catch(()=>{});
    await new Promise(resolve=>{const ws=new WebSocket(`ws://${host}/socket`);ws.onclose=resolve;ws.onerror=resolve;setTimeout(resolve,1000);});
  },local);
  await page.goto('https://example.com/redirect').catch(()=>{});
  assert.equal(upstream,0);assert.ok(blocked.some(url=>url.endsWith('/redirect')));await context.close();
});
test('blocked dependencies cannot produce a confirmed defect or execute subsequent writes',async t=>{
  const require=createRequire(new URL('../../desktop/package.json',import.meta.url));
  process.env.PLAYWRIGHT_BROWSERS_PATH=fileURLToPath(new URL('../../desktop/vendor/browsers',import.meta.url));
  const {chromium}=require('playwright');const browser=await chromium.launch();t.after(()=>browser.close());
  for(const steps of [[],[{action:'click',target:'Save draft'}]]){
    let context,writes=0;
    const job=jobSchema.parse({url:'https://example.com/',title:'Dependency isolation',requirement:'Save draft',steps,expectedPath:'/',expectedTexts:['Saved'],resultSelector:'#result',reviewed:true});
    const result=await runBrowser(job,{launch:async()=>({newContext:async options=>context=await browser.newContext(options),close:async()=>context?.close()}),guard:async ctx=>{
      await ctx.exposeFunction('writeFixture',()=>{writes++;});
      await ctx.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<title>Fixture</title><button onclick="writeFixture()">Save draft</button><p id="result">Waiting</p>'}));
      return {blockedRequests:1};
    }});
    assert.equal(result.report.status,'inconclusive');assert.equal(result.report.coverage.deterministic,false);assert.equal(writes,0);
    assert.ok(result.report.checks.every(c=>c.status!=='failed'));
  }
});
