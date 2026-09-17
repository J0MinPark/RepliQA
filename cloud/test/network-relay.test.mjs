import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NetworkRelay,createNetworkRelay,RELAY_LIMITS} from '../src/network-relay.mjs';
import {installGuard} from '../src/target-guard.mjs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const policy={token:'a'.repeat(64),tenantId:'tenant-a',runId:'run-a',origins:'["https://fixture.test"]',resource_hosts:'["cdn.fixture.test"]'};
const state=()=>({storage:{setAlarm:async()=>{},deleteAlarm:async()=>{}}});
const dns=()=>Response.json({Status:0,Answer:[{type:1,data:'1.1.1.1'}]});
async function fixture(fetchTarget=async()=>new Response('Ready')){
  let address='1.1.1.1';const calls=[];
  const object=new NetworkRelay(state(),{relayFetch:async(url,options)=>{
    if(url.startsWith('https://cloudflare-dns.com/'))return Response.json({Status:0,Answer:[{type:1,data:address}]});
    calls.push({url,method:options.method,headers:Object.fromEntries(options.headers),body:options.body});return fetchTarget(url,options);
  }});
  const init=p=>object.fetch(new Request('https://relay.internal/init',{method:'POST',body:JSON.stringify(p)}));assert.equal((await init(policy)).status,200);
  const resource=(id,input={},token=policy.token)=>object.fetch(new Request('https://relay.internal/resource',{method:'POST',headers:{'x-repliqa-capability':token,'x-repliqa-request-id':String(id)},body:JSON.stringify({url:'https://fixture.test/resource',method:'GET',headers:[],...input})}));
  return {object,calls,resource,init,setAddress:value=>{address=value;},close:()=>object.fetch(new Request('https://relay.internal/close',{method:'POST',headers:{'x-repliqa-capability':policy.token}}))};
}

test('relay capability, one-time initialization and one-time request IDs isolate writes',async()=>{
  const f=await fixture();
  assert.equal((await f.resource(1,{},'b'.repeat(64))).status,403);assert.equal(f.calls.length,0);
  assert.equal((await f.init({...policy,tenantId:'other'})).status,403);
  assert.equal((await f.resource(1,{method:'POST',body:Buffer.from('draft=1').toString('base64')})).status,200);
  assert.equal((await f.resource(1,{method:'POST'})).status,409);assert.equal(f.calls.length,1);
  assert.equal(new TextDecoder().decode(f.calls[0].body),'draft=1');
  await f.close();assert.equal((await f.resource(2)).status,403);
});

test('relay rejects private DNS, redirects, cross-origin navigation and hostile URL forms',async()=>{
  const f=await fixture();let id=0;
  for(const url of ['http://fixture.test','https://fixture.test:444','https://user@fixture.test','https://127.0.0.1','https://fixture.test.evil.test'])assert.equal((await f.resource(++id,{url})).status,403);
  assert.equal((await f.resource(++id,{url:'https://cdn.fixture.test',navigation:true})).status,403);
  assert.equal((await f.resource(++id,{url:'https://cdn.fixture.test'})).status,200);
  f.setAddress('127.0.0.1');assert.equal((await f.resource(++id)).headers.get('x-repliqa-relay-error'),'private-address');assert.equal(f.calls.length,1);
  const redirect=await fixture(async()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1'}}));
  assert.equal((await redirect.resource(1)).headers.get('x-repliqa-relay-error'),'redirect');assert.equal(redirect.calls.length,1);
});

test('relay close aborts an in-flight request and expiration cannot be reopened',async()=>{
  let entered;const ready=new Promise(resolve=>entered=resolve);
  const f=await fixture(async(_,options)=>{entered();return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));});
  const pending=f.resource(1,{method:'POST'});await ready;await f.close();
  assert.equal((await pending).status,502);assert.equal(f.calls.length,1);assert.equal(f.object.active,0);
  assert.equal((await f.init(policy)).status,403);
  const expired=await fixture();expired.object.session.expires=Date.now()-1;assert.equal((await expired.resource(1)).status,403);assert.equal(expired.calls.length,0);
});

test('relay bounds resources and strips control headers without stripping site credentials',async()=>{
  const f=await fixture();
  await f.resource(1,{headers:[['authorization','site-secret'],['cookie','session=fixture'],['x-repliqa-capability','must-not-forward'],['host','evil.test'],['accept-encoding','gzip']]});
  assert.equal(f.calls[0].headers.authorization,'site-secret');assert.equal(f.calls[0].headers.cookie,'session=fixture');assert.equal(f.calls[0].headers['accept-encoding'],'identity');assert.equal(f.calls[0].headers['x-repliqa-capability'],undefined);assert.equal(f.calls[0].headers.host,undefined);
  f.object.session.requests=RELAY_LIMITS.requests;assert.equal((await f.resource(2)).status,429);assert.equal(f.calls.length,1);
  const large=await fixture(async()=>new Response(new Uint8Array(RELAY_LIMITS.responseBytes+1)));assert.equal((await large.resource(1)).status,502);
  const exhausted=await fixture();exhausted.object.session.bytes=RELAY_LIMITS.totalBytes;
  assert.equal((await exhausted.resource(1)).status,413);assert.equal(exhausted.calls.length,0);
});

test('separate run objects reject another run capability and keep credentials isolated',async()=>{
  const a=await fixture(),b=new NetworkRelay(state(),{relayFetch:async()=>{throw Error('Foreign request reached network');}});
  await b.fetch(new Request('https://relay.internal/init',{method:'POST',body:JSON.stringify({...policy,token:'b'.repeat(64),tenantId:'tenant-b',runId:'run-b'})}));
  const foreign=await b.fetch(new Request('https://relay.internal/resource',{method:'POST',headers:{'x-repliqa-capability':policy.token,'x-repliqa-request-id':'1'},body:'{}'}));
  assert.equal(foreign.status,403);assert.equal(b.session.seen.size,0);
  assert.equal((await a.resource(1,{headers:[['cookie','tenant=a']]})).status,200);
  await b.alarm();assert.equal((await a.resource(2)).status,200);assert.equal(a.calls[0].headers.cookie,'tenant=a');
});

test('client bounds its queue and close rejects queued work without replaying requests',async()=>{
  const pending=[];let sent=0;
  const namespace={newUniqueId:()=>1,get:()=>({fetch:async(url)=>{
    if(url.endsWith('/init'))return Response.json({ready:true});
    if(url.endsWith('/close')){for(const resolve of pending)resolve(new Response('done'));return Response.json({closed:true});}
    sent++;return new Promise(resolve=>pending.push(resolve));
  }})};
  const relay=await createNetworkRelay(namespace,{id:'a',origins:policy.origins,resource_hosts:policy.resource_hosts},'queued');
  const route={request:()=>({postDataBuffer:()=>null,allHeaders:async()=>({}),url:()=>'https://fixture.test',method:()=>'POST',isNavigationRequest:()=>false}),fulfill:async()=>{throw Error('Closed run must not fulfill');}};
  const work=Array.from({length:RELAY_LIMITS.requests+1},()=>relay.fetchRoute(route).then(()=>null,error=>error));
  await new Promise(resolve=>setImmediate(resolve));assert.equal(sent,RELAY_LIMITS.concurrency);
  assert.equal((await work.at(-1)).relayKind,'request-budget');
  await relay.close();const results=await Promise.all(work);assert.ok(results.every(result=>result instanceof Error));assert.equal(sent,RELAY_LIMITS.concurrency);
});

test('real browser relay preserves multiple cookies and binary assets across over 50 requests',async t=>{
  const require=createRequire(new URL('../../desktop/package.json',import.meta.url));process.env.PLAYWRIGHT_BROWSERS_PATH=fileURLToPath(new URL('../../desktop/vendor/browsers',import.meta.url));const browser=await require('playwright').chromium.launch();t.after(()=>browser.close());
  const objects=new Map();let upstream=0;
  const namespace={newUniqueId:()=>crypto.randomUUID(),get(id){if(!objects.has(id))objects.set(id,new NetworkRelay(state(),{relayFetch:async(url)=>{
    if(url.startsWith('https://cloudflare-dns.com'))return dns();upstream++;
    if(new URL(url).pathname==='/'){
      const headers=new Headers({'content-type':'text/html'});headers.append('set-cookie','first=one; Path=/; Secure; SameSite=Lax');headers.append('set-cookie','second=two; Path=/; Secure; SameSite=Lax');
      return new Response('<h1>Ready</h1>',{headers});
    }return new Response(new Uint8Array([0,128,255]),{headers:{'content-type':'application/octet-stream'}});
  }}));return {fetch:(url,options)=>objects.get(id).fetch(new Request(url,options))};}};
  const tenant={id:'a',origins:policy.origins,resource_hosts:policy.resource_hosts};const relay=await createNetworkRelay(namespace,tenant,'r1');t.after(()=>relay.close());
  const context=await browser.newContext();const guard=await installGuard(context,tenant,()=>{throw Error('Controller must not make DNS requests');},relay);const page=await context.newPage();await page.goto('https://fixture.test/');
  const values=await page.evaluate(async()=>Promise.all(Array.from({length:65},async(_,i)=>[...new Uint8Array(await(await fetch('/asset-'+i)).arrayBuffer())])));
  assert.equal(values.length,65);assert.ok(values.every(v=>JSON.stringify(v)==='[0,128,255]'));assert.equal(upstream,66);
  assert.deepEqual((await context.cookies()).map(c=>[c.name,c.value]).sort(),[['first','one'],['second','two']]);
  assert.equal(guard.blockedRequests,0);assert.equal(guard.failedRequests,0);guard.finish();await context.close();
});
