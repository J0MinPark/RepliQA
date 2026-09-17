import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarize,interval95} from './metrics.mjs';
test('misses retain unresolved defects, while unresolved normal cases never become true negatives',()=>{
  const rows=[['defect','failed'],['defect','passed'],['defect','inconclusive'],['normal','passed'],['normal','failed'],['normal','inconclusive'],['unresolved','passed']].map(([truth,status],id)=>({id,truth,status,durationMs:id+1}));
  const m=summarize(rows);assert.deepEqual([m.tp,m.fp,m.fn,m.tn,m.falsePasses,m.normalUnresolved],[1,1,2,1,2,1]);
  assert.equal(m.recall,1/3);assert.equal(m.precision,1/2);assert.equal(m.p95Ms,7);
  const ci=interval95(10,10);assert.ok(ci[0]<.75&&ci[1]>.999,'A perfect small sample cannot imply certainty');
});
