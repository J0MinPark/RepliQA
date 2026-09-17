import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {cases} from './cases.mjs';

const target=process.argv[2];if(!target)throw new Error('Supply a benchmark result.json');
const result=JSON.parse(await fs.readFile(target,'utf8'));
const issues=[];
for(const [source,expected] of Object.entries(result.sources)){
  const actual=createHash('sha256').update(await fs.readFile(new URL(`../${source}`,import.meta.url))).digest('hex');
  if(actual!==expected)issues.push(`Source changed since measurement: ${source}`);
}
if(result.repeats<2)issues.push('At least two repeats in alternating order are required');
if(result.rows.length!==cases.length*result.repeats*2)issues.push('Missing observations');
for(const item of cases)for(let repetition=0;repetition<result.repeats;repetition++)for(const engine of ['repliqa','playwright']){
  const rows=result.rows.filter(r=>r.id===item.id&&r.repetition===repetition&&r.engine===engine);
  if(rows.length!==1){issues.push(`Missing/duplicate ${engine} ${item.id} repeat ${repetition}`);continue;}
  const row=rows[0];
  if(row.truth!==item.truth||row.status!==({normal:'passed',defect:'failed',unresolved:'inconclusive'}[item.truth]))issues.push(`Wrong outcome: ${engine} ${item.id} ${row.status}`);
  if(row.writeCount>1)issues.push(`Repeated write: ${engine} ${item.id}`);
  if(item.family==='unresolved'&&item.variant!=='ai-unavailable'&&row.writeCount>0)issues.push(`Wrote after unresolved prerequisite: ${engine} ${item.id}`);
}
if(result.outsideRequests||result.externalAiCalls||result.cloudBrowserCalls)issues.push('Local benchmark scope violated');
const receipt={checkedAt:new Date().toISOString(),passed:issues.length===0,scope:'Release regression gate for this authored corpus only. Does not certify general accuracy or SaaS readiness.',issues};
await fs.writeFile(new URL('gate.json',pathToFileURL(target)),JSON.stringify(receipt,null,2));
console.log(JSON.stringify(receipt,null,2));
if(issues.length)process.exitCode=1;
