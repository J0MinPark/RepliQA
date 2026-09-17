import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewScreen, MODEL } from '../src/ai.mjs';
test('cloud AI has one pinned free model, sends the masked image and rejects partial or invalid responses', async () => {
  const calls = [];
  const ai = { async run(model, input) { calls.push({model,input}); return { choices:[{finish_reason:'stop',message:{content:JSON.stringify({reviewed:true,summary:'Observed fixture',findings:[]})}}] }; } };
  const reviewed = await reviewScreen(ai,{texts:['[MASKED]']},Buffer.from('masked-image'));
  assert.equal(reviewed.reviewed,true); assert.equal(calls[0].model,MODEL); assert.equal(calls[0].input.store,false);
  assert.match(calls[0].input.messages[1].content[1].image_url.url,/^data:image\/jpeg;base64,/);
  await assert.rejects(reviewScreen({run:async()=>({choices:[{finish_reason:'length',message:{content:'{}'}}]})},{},Buffer.from('image')));
  await assert.rejects(reviewScreen({run:async()=>({choices:[{finish_reason:'stop',message:{content:'{"reviewed":true}'}}]})},{},Buffer.from('image')));
  let attempts = 0; await assert.rejects(reviewScreen({run:async()=>{attempts++;throw new Error('quota');}},{},Buffer.from('image'))); assert.equal(attempts,1);
});
