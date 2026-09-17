import {test} from 'node:test';
import assert from 'node:assert/strict';
import {exportPlan,readPlan,containsPlaceholder} from '../public/plans.js';
test('portable plan strips private values, preserves action identifiers, and requires replacement',()=>{
  const job={inspectionMode:'journey',url:'https://example.com/?token=abc123',title:'Plan',requirement:'select',steps:[{action:'fill',target:'Name',value:'select'},{action:'select',target:'Choice',value:'2'},{action:'assertValue',target:'#field',value:'other-secret'}],redactValues:['hidden-name'],expectedTexts:['hidden-name','member@example.com'],cloudAiConsent:true,reviewed:true};
  const saved=exportPlan(job);const text=JSON.stringify(saved);assert.ok(!text.includes('other-secret'));assert.ok(!text.includes('hidden-name'));assert.ok(!text.includes('member@example.com'));assert.ok(!text.includes('abc123'));assert.equal(saved.job.steps[1].action,'select');assert.equal(saved.job.cloudAiConsent,false);assert.deepEqual(saved.job.redactValues,[]);assert.ok(containsPlaceholder(saved.job));assert.equal(readPlan(text).steps.length,3);
  assert.throws(()=>readPlan('{"format":"repliqa-plan","version":2,"job":{}}'));assert.throws(()=>readPlan('x'.repeat(20001)));
});
