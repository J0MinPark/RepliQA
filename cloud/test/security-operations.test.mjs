import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync,backup} from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {handle} from '../src/worker.mjs';
import {hash,finish,recover} from '../src/repository.mjs';
import {jobSchema} from '../src/schema.mjs';
import {quarantineRestoredDatabase} from '../src/restore-policy.mjs';

const tokens={a:'a'.repeat(43),b:'b'.repeat(43)};
const job=jobSchema.parse({inspectionMode:'basic',url:'https://example.com',title:'Security fixture',requirement:'Inspect',steps:[],reviewed:true});
async function fixture(t){
  const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());sql.exec(await fs.readFile(new URL('../migrations/0001_pilot.sql',import.meta.url),'utf8'));
  for(const id of ['a','b'])sql.prepare('INSERT INTO tenants VALUES (?,?,?,?,?,0)').run(id,await hash(tokens[id]),'["https://example.com"]','[]',Date.now()+86400000);
  let failWrites=false;
  const DB={prepare(query){let args=[];return {bind(...v){args=v;return this;},async first(){return sql.prepare(query).get(...args)||null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){if(failWrites&&query.startsWith('UPDATE runs SET status = ?'))throw Error('Injected storage outage');return {meta:sql.prepare(query).run(...args)};}};},async batch(statements){sql.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
  const env={DB,FREE_PLAN_CONFIRMED:'true',CLOUD_AI_ENABLED:'false'};
  const api=(path,{tenant='a',method='GET',body,signal,headers={},runtime}={})=>handle(new Request('https://pilot.test/api/'+path,{method,headers:{authorization:'Bearer '+tokens[tenant],'content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{}),signal}),env,runtime);
  async function seed(status='ready',tenant='a',created=Date.now()){
    const id=crypto.randomUUID();sql.prepare('INSERT INTO runs (id,tenant_id,request_key,fingerprint,status,created_at,expires_at,report,screenshot) VALUES (?,?,?,?,?,?,?,?,?)').run(id,tenant,id,await hash(JSON.stringify(job)),status,created,created+7*86400000,status==='done'?JSON.stringify({status:'passed',private:'fixture'}):null,status==='done'?Buffer.from('private-image'):null);return id;
  }
  return {sql,DB,api,seed,outage:()=>{failWrites=true;},restore:()=>{failWrites=false;}};
}
test('HTTP handlers isolate report/image/list/cancel/delete/execute across customers',async t=>{
  const {api,seed,sql}=await fixture(t);const id=await seed('done');
  for(const [suffix,method] of [['','GET'],['/screenshot','GET'],['/cancel','POST'],['','DELETE'],['/execute','POST']]){
    const response=await api('runs/'+id+suffix,{tenant:'b',method,body:method==='POST'?job:undefined});assert.equal(response.status,404);assert.doesNotMatch(await response.text(),/private/);
  }
  assert.deepEqual((await(await api('runs',{tenant:'b'})).json()).runs,[]);
  assert.equal((await api('runs/'+id)).status,200);assert.equal((await api('runs/'+id+'/screenshot')).status,200);
  assert.equal((await api('runs/'+id,{headers:{authorization:'Bearer invalid'}})).status,401);
  assert.equal((await api('runs/'+id,{headers:{origin:'https://attacker.test'}})).status,403);
  sql.prepare('UPDATE tenants SET disabled=1 WHERE id=?').run('a');assert.equal((await api('runs/'+id)).status,401);
  sql.prepare('UPDATE tenants SET disabled=0,expires_at=? WHERE id=?').run(Date.now()-1,'a');assert.equal((await api('runs/'+id)).status,401);
});
test('deletion removes report and image atomically; cancellation forbids replay and late writes',async t=>{
  const {api,seed,sql,DB}=await fixture(t);const id=await seed('done');
  assert.equal((await api('runs/'+id,{method:'DELETE'})).status,200);
  const row=sql.prepare('SELECT * FROM runs WHERE id=?').get(id);assert.equal(row.report,null);assert.equal(row.screenshot,null);
  for(const suffix of ['','/screenshot'])assert.equal((await api('runs/'+id+suffix)).status,404);
  const active=await seed('running');assert.equal((await api('runs/'+active,{method:'DELETE'})).status,409);
  assert.equal((await api('runs/'+active+'/cancel',{method:'POST'})).status,200);
  assert.equal((await finish(DB,'a',active,{status:'passed'},Buffer.from('late'))).meta.changes,0);
  assert.equal((await api('runs/'+active+'/execute',{method:'POST',body:job,runtime:{runBrowser:()=>{throw Error('must not launch');}}})).status,409);
});
test('disconnected requests and changed plans never launch a browser',async t=>{
  const {api,seed,sql}=await fixture(t);const id=await seed();let launches=0;
  const runtime={runBrowser:async()=>{launches++;throw Error('unexpected');}};
  assert.equal((await api('runs/'+id+'/execute',{method:'POST',body:{...job,title:'Changed'},runtime})).status,409);
  const controller=new AbortController();controller.abort();
  assert.equal((await api('runs/'+id+'/execute',{method:'POST',body:job,signal:controller.signal,runtime})).status,503);
  assert.equal(launches,0);assert.equal(sql.prepare('SELECT status FROM runs WHERE id=?').get(id).status,'ready');
});
test('storage failure is 503; recovery marks interrupted and never replays the action',async t=>{
  const {api,seed,sql,DB,outage,restore}=await fixture(t);const id=await seed();let launches=0;
  const response=await api('runs/'+id+'/execute',{method:'POST',body:job,runtime:{runBrowser:async()=>{launches++;outage();return {report:{status:'passed'},screenshot:null};}}});
  assert.equal(response.status,503);assert.equal(sql.prepare('SELECT status FROM runs WHERE id=?').get(id).status,'running');
  restore();await recover(DB,Date.now()+121000);
  const row=sql.prepare('SELECT * FROM runs WHERE id=?').get(id);assert.equal(row.status,'interrupted');assert.equal(JSON.parse(row.report).status,'inconclusive');assert.equal(launches,1);
  assert.equal((await api('runs/'+id+'/execute',{method:'POST',body:job})).status,409);
});
test('revoking a tenant during execution aborts work and cannot persist a late success',async t=>{
  const {api,seed,sql,DB}=await fixture(t);const id=await seed();let aborted=false;
  const response=await api('runs/'+id+'/execute',{method:'POST',body:job,runtime:{runBrowser:async(_,options)=>{
    sql.prepare('UPDATE tenants SET disabled=1 WHERE id=?').run('a');
    await new Promise(resolve=>options.signal.addEventListener('abort',()=>{aborted=true;resolve();},{once:true}));
    return {report:{status:'passed'},screenshot:Buffer.from('late')};
  }}});
  assert.equal(response.status,503);assert.ok(aborted);
  assert.equal((await finish(DB,'a',id,{status:'passed'},Buffer.from('late'))).meta.changes,0);
  assert.equal(sql.prepare('SELECT report FROM runs WHERE id=?').get(id).report,null);
  await recover(DB,Date.now()+121000);assert.equal(sql.prepare('SELECT status FROM runs WHERE id=?').get(id).status,'interrupted');
});
test('retention and transaction rollback preserve isolation and erase expired payloads',async t=>{
  const {seed,sql,DB}=await fixture(t);const now=Date.now();const expired=await seed('done','a',now-7*86400000-1000);const keep=await seed('done','b');
  await assert.rejects(DB.batch([DB.prepare('DELETE FROM runs WHERE id=?').bind(keep),DB.prepare('INSERT INTO missing_table VALUES (1)')]));
  assert.ok(sql.prepare('SELECT id FROM runs WHERE id=?').get(keep),'failed batch rolls back deletion');
  await recover(DB,now);const row=sql.prepare('SELECT * FROM runs WHERE id=?').get(expired);assert.equal(row.status,'deleted');assert.equal(row.report,null);assert.equal(row.screenshot,null);
  await recover(DB,now+86400000);assert.equal(sql.prepare('SELECT id FROM runs WHERE id=?').get(expired),undefined);assert.ok(sql.prepare('SELECT id FROM runs WHERE id=?').get(keep));
});
test('actual SQLite backup/restore quarantines revoked keys and deleted evidence before reopening',async t=>{
  const {seed,sql,api}=await fixture(t);const id=await seed('done');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'repliqa-restore-'));let restored;
  t.after(async()=>{restored?.close();await fs.rm(dir,{recursive:true,force:true});});
  const file=path.join(dir,'synthetic.sqlite');await backup(sql,file);
  await api('runs/'+id,{method:'DELETE'});sql.prepare('UPDATE tenants SET disabled=1').run();
  restored=new DatabaseSync(file);
  assert.ok(restored.prepare('SELECT report FROM runs WHERE id=?').get(id).report,'backup predates deletion');
  const db={prepare(query){return {run:async()=>({meta:restored.prepare(query).run()})};},async batch(items){restored.exec('BEGIN');try{for(const item of items)await item.run();restored.exec('COMMIT');}catch(error){restored.exec('ROLLBACK');throw error;}}};
  await quarantineRestoredDatabase(db);
  assert.equal(restored.prepare('SELECT COUNT(*) AS count FROM tenants WHERE disabled=0').get().count,0);
  assert.equal(restored.prepare("SELECT COUNT(*) AS count FROM runs WHERE report IS NOT NULL OR screenshot IS NOT NULL OR status IN ('ready','running')").get().count,0);
});
