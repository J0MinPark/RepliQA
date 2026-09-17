import {publicHost,validateUrl,sessionGuardrails} from './target-guard.mjs';

export const RELAY_LIMITS={requests:512,requestBytes:262144,responseBytes:8*1024*1024,totalBytes:48*1024*1024,concurrency:6,lifetimeMs:80000,timeoutMs:10000};
const failure=(kind,status=403)=>Response.json({error:kind},{status,headers:{'x-repliqa-relay-error':kind}});
const forbidden=/^(?:host|connection|content-length|transfer-encoding|upgrade|proxy-.*|cf-.*|x-repliqa-.*|:.*)$/i;
export async function boundedBytes(stream,limit){
  if(!stream)return new Uint8Array();const reader=stream.getReader(),chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw Error('body-limit');}chunks.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
}

// One object per run, reachable only through the private namespace binding.
// No request bodies, credentials, cookies or policies are written to storage.
export class NetworkRelay {
  constructor(state,env){this.state=state;this.fetchImpl=env?.relayFetch||((...args)=>fetch(...args));this.session=null;this.closed=false;this.controllers=new Set();this.active=0;}
  async alarm(){this.closed=true;this.session=null;for(const controller of this.controllers)controller.abort();}
  async fetch(request){
    const url=new URL(request.url);
    if(url.pathname==='/init'&&request.method==='POST'){
      if(this.session||this.closed)return failure('already-initialized');
      const bytes=await boundedBytes(request.body,20000).catch(()=>null);if(!bytes)return failure('invalid-policy',400);
      let policy;try{policy=JSON.parse(new TextDecoder().decode(bytes));sessionGuardrails(policy);const origins=JSON.parse(policy.origins);for(const origin of origins){validateUrl(origin,origins);if(new URL(origin).origin!==origin)throw Error();}if(!/^[a-f0-9]{64}$/.test(policy.token)||!policy.tenantId||!policy.runId)throw Error();}catch{return failure('invalid-policy',400);}
      // Claim before awaiting so two initialization calls cannot both succeed.
      if(this.session||this.closed)return failure('already-initialized');
      this.session={...policy,expires:Date.now()+RELAY_LIMITS.lifetimeMs,seen:new Set(),requests:0,bytes:0};
      try{await this.state.storage.setAlarm(this.session.expires);}catch{await this.alarm();return failure('unavailable',503);}
      return Response.json({ready:true});
    }
    const session=this.session;
    if(this.closed||!session||Date.now()>=session.expires||request.headers.get('x-repliqa-capability')!==session.token)return failure('session-unavailable');
    if(url.pathname==='/close'&&request.method==='POST'){await this.alarm();await this.state.storage.deleteAlarm();return Response.json({closed:true});}
    if(url.pathname!=='/resource'||request.method!=='POST')return failure('unsupported',400);
    const id=request.headers.get('x-repliqa-request-id');
    if(!/^[0-9]{1,6}$/.test(id||'')||session.seen.has(id))return failure('duplicate-request',409);
    session.seen.add(id);if(++session.requests>RELAY_LIMITS.requests)return failure('request-budget',429);
    if(session.bytes>=RELAY_LIMITS.totalBytes)return failure('response-budget',413);
    if(this.active>=RELAY_LIMITS.concurrency)return failure('relay-busy',429);
    this.active++;
    const controller=new AbortController();this.controllers.add(controller);const timer=setTimeout(()=>controller.abort(),Math.min(RELAY_LIMITS.timeoutMs,session.expires-Date.now()));
    try{
      const envelope=await boundedBytes(request.body,RELAY_LIMITS.requestBytes*2);
      let input;try{input=JSON.parse(new TextDecoder().decode(envelope));}catch{return failure('invalid-request',400);}
      let target;try{
        target=new URL(input.url);const origins=JSON.parse(session.origins),hosts=new Set([...origins.map(o=>new URL(o).hostname),...JSON.parse(session.resource_hosts)]);
        if(target.protocol!=='https:'||target.username||target.password||(target.port&&target.port!=='443')||!hosts.has(target.hostname))throw Error();
        if(input.navigation)validateUrl(input.url,origins);
        if(!['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(input.method))throw Error();
      }catch{return failure('policy');}
      if(!await publicHost(target.hostname,this.fetchImpl))return failure('private-address');
      if(this.closed||controller.signal.aborted)return failure('closed',409);
      const headers=new Headers();for(const [name,value] of input.headers||[])if(!forbidden.test(name))headers.append(name,value);
      headers.set('accept-encoding','identity');
      const body=input.body?Uint8Array.from(atob(input.body),c=>c.charCodeAt(0)):undefined;
      if(body?.byteLength>RELAY_LIMITS.requestBytes)return failure('body-limit',413);
      const response=await this.fetchImpl(target.href,{method:input.method,headers,body,redirect:'manual',signal:controller.signal});
      if(response.status>=300&&response.status<400&&response.status!==304){await response.body?.cancel();return failure('redirect');}
      const data=await boundedBytes(response.body,RELAY_LIMITS.responseBytes);session.bytes+=data.byteLength;
      if(session.bytes>RELAY_LIMITS.totalBytes)return failure('response-budget',413);
      if(this.closed||controller.signal.aborted)return failure('closed',409);
      const output=new Headers(response.headers);for(const key of ['content-length','content-encoding','transfer-encoding','connection','x-repliqa-relay-error'])output.delete(key);
      const cookies=response.headers.getSetCookie?.()||[];output.delete('set-cookie');for(const cookie of cookies)output.append('set-cookie',cookie);
      // Fetch bodies are decoded before fulfilling them back to the browser.
      return new Response([204,205,304].includes(response.status)||input.method==='HEAD'?null:data,{status:response.status,headers:output});
    }catch{return failure(controller.signal.aborted?'timeout':'transport',502);}
    finally{clearTimeout(timer);this.controllers.delete(controller);this.active--;}
  }
}

export async function createNetworkRelay(namespace,tenant,runId){
  if(!namespace)throw Error('네트워크 중계 연결이 설정되지 않았습니다.');
  const token=[...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('');
  const stub=namespace.get(namespace.newUniqueId());
  const init=await stub.fetch('https://relay.internal/init',{method:'POST',body:JSON.stringify({token,tenantId:tenant.id,runId,origins:tenant.origins,resource_hosts:tenant.resource_hosts})});
  if(!init.ok)throw Error('네트워크 중계 초기화 실패');
  let sequence=0,closed=false,active=0;const queue=[];
  const acquire=()=>active<RELAY_LIMITS.concurrency?(active++,Promise.resolve()):new Promise((resolve,reject)=>queue.push({resolve,reject}));
  const release=()=>{const next=queue.shift();if(next)next.resolve();else active--;};
  return {
    async fetchRoute(route){
      if(closed)throw Error('Relay closed');
      const requestId=++sequence;
      if(requestId>RELAY_LIMITS.requests){const error=Error('Network relay: request-budget');error.relayKind='request-budget';throw error;}
      await acquire();
      try{
        if(closed)throw Error('Relay closed');
        const request=route.request(),data=request.postDataBuffer();
        if(data?.byteLength>RELAY_LIMITS.requestBytes)throw Error('Request body exceeds relay limit');
        const headers=await request.allHeaders();
        const response=await stub.fetch('https://relay.internal/resource',{method:'POST',headers:{'x-repliqa-capability':token,'x-repliqa-request-id':String(requestId)},body:JSON.stringify({url:request.url(),method:request.method(),navigation:request.isNavigationRequest(),headers:Object.entries(headers),body:data?.toString('base64')})});
        const error=response.headers.get('x-repliqa-relay-error');
        if(error){await response.body?.cancel();const failure=new Error('Network relay: '+error);failure.relayKind=error;throw failure;}
        const body=Buffer.from(await boundedBytes(response.body,RELAY_LIMITS.responseBytes));
        if(closed)throw Error('Relay closed');
        const resultHeaders=Object.fromEntries(response.headers);const cookies=response.headers.getSetCookie?.()||[];if(cookies.length)resultHeaders['set-cookie']=cookies.join('\n');
        await route.fulfill({status:response.status,headers:resultHeaders,body});
      }finally{release();}
    },
    async close(){if(closed)return;closed=true;for(const waiter of queue.splice(0))waiter.reject(Error('Relay closed'));const response=await stub.fetch('https://relay.internal/close',{method:'POST',headers:{'x-repliqa-capability':token}});await response.body?.cancel();}
  };
}
