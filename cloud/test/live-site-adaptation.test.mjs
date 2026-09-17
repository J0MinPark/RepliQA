import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {readResult} from '../src/outcomes.mjs';
import {checkStep} from '../src/assertions.mjs';
import {performStep} from '../src/actions.mjs';
const require=createRequire(new URL('../../desktop/package.json',import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH=fileURLToPath(new URL('../../desktop/vendor/browsers',import.meta.url));
const {chromium}=require('playwright');

test('SPA cached headings are resolved by rendered state, never expected text',async t=>{
  const browser=await chromium.launch();t.after(()=>browser.close());const page=await browser.newPage();
  await page.setContent('<article><h1>Home</h1></article><article style="display:none"><h1>Installation</h1></article>');
  const result=await readResult(page,'h1');
  assert.equal(result.text,'Home');assert.equal(result.matchedCandidates,2);assert.equal(result.visibleCandidates,1);
  assert.equal((await checkStep(page,{action:'assertText',target:'h1',value:'Home'})).status,'passed');
  // Hidden expected text cannot hide an actual visible mismatch.
  await page.setContent('<h1>Wrong page</h1><section hidden><h1>Home</h1></section>');
  assert.equal((await checkStep(page,{action:'assertText',target:'h1',value:'Home'})).status,'failed');
  await page.setContent('<h1>Home</h1><h1>Wrong page</h1>');
  assert.equal((await checkStep(page,{action:'assertText',target:'h1',value:'Home'})).status,'inconclusive');
  // Count assertions intentionally still count the whole selector scope.
  assert.equal((await checkStep(page,{action:'assertCount',target:'h1',value:'2'})).status,'passed');
});

test('candidate observation honors inherited hiding and child visibility overrides',async t=>{
  const browser=await chromium.launch();t.after(()=>browser.close());const page=await browser.newPage();
  for(const style of ['display:none','opacity:0','visibility:hidden']){
    await page.setContent(`<h1>Current</h1><section style="${style}"><h1>Cached</h1></section>`);
    assert.equal((await readResult(page,'h1')).text,'Current',style);
  }
  await page.setContent('<h1>Current</h1><section style="visibility:hidden"><h1 style="visibility:visible">Also visible</h1></section>');
  assert.equal((await readResult(page,'h1')).ambiguous,true);
  await page.setContent('<h1 hidden>Current</h1><h1 hidden>Cached</h1>');
  assert.equal((await readResult(page,'h1')).available,false);
});

test('action re-observes a late semantic role and executes only once',async t=>{
  const browser=await chromium.launch();t.after(()=>browser.close());const page=await browser.newPage();
  await page.setContent('<div id="mount"></div><script>window.writes=0;setTimeout(()=>{document.querySelector("#mount").innerHTML=\'<button aria-label="Continue" onclick="window.writes++"><span aria-hidden="true">→</span></button>\';},500)</script>');
  await performStep(page,{action:'click',target:'Continue'});
  assert.equal(await page.evaluate(()=>window.writes),1);
});

test('ambiguous action targets never choose a convenient first match',async t=>{
  const browser=await chromium.launch();t.after(()=>browser.close());const page=await browser.newPage();
  await page.setContent('<script>window.writes=0</script><button onclick="writes++">Continue</button><button onclick="writes++">Continue</button>');
  await assert.rejects(performStep(page,{action:'click',target:'Continue'}),/하나로 특정/);
  assert.equal(await page.evaluate(()=>window.writes),0);
});

test('SPA history restores content without a new DOMContentLoaded event or duplicate write',async t=>{
  const browser=await chromium.launch();t.after(()=>browser.close());const page=await browser.newPage();
  await page.route('https://fixture.test/**',route=>route.fulfill({contentType:'text/html',body:`<h1>Home</h1><button onclick="writes++;history.pushState({},'', '/next');render()">Continue</button><script>window.writes=0;window.loads=0;document.addEventListener('DOMContentLoaded',()=>loads++);function render(){document.querySelector('h1').textContent=location.pathname==='/next'?'Next':'Home'}window.addEventListener('popstate',render);render();</script>`}));
  await page.goto('https://fixture.test/home');
  await performStep(page,{action:'click',target:'Continue'});
  await performStep(page,{action:'back',target:'/home'});
  assert.equal((await checkStep(page,{action:'assertText',target:'h1',value:'Home'})).status,'passed');
  await performStep(page,{action:'forward',target:'/next'});
  assert.equal((await checkStep(page,{action:'assertText',target:'h1',value:'Next'})).status,'passed');
  assert.deepEqual(await page.evaluate(()=>({writes,loads})),{writes:1,loads:1});
});
