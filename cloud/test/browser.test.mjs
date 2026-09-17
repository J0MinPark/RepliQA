import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runBrowser } from '../src/runner.mjs';
const require = createRequire(new URL('../../desktop/package.json', import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH = fileURLToPath(new URL('../../desktop/vendor/browsers', import.meta.url));
const { chromium } = require('playwright');
const privacy = require('./src/privacy.cjs');
const { validateProfile, validateReview } = require('./src/profile.cjs');

test('real browser: login, create, edit, search, popup, scroll and seeded faulty outcomes', { timeout: 90000 }, async (t) => {
  const state = { name: '', authenticated: false, fault: false, writes: 0 };
  const server = http.createServer(async (req, res) => {
    res.setHeader('content-type','text/html; charset=utf-8');
    if (req.method === 'POST') {
      let data = ''; for await (const chunk of req) data += chunk;
      const body = new URLSearchParams(data);
      if (req.url === '/login') state.authenticated = body.get('password') === 'test-only-secret';
      else if (state.authenticated && req.headers.cookie?.includes('fixture-session=valid') && req.url === '/save') { state.writes++; if (!state.fault) state.name = body.get('name'); }
      if (req.url === '/login' && state.authenticated) res.setHeader('set-cookie', 'fixture-session=valid; HttpOnly; SameSite=Lax; Path=/');
      res.writeHead(303, { location: '/workspace' }); return res.end();
    }
    if (req.url === '/') return res.end('<html lang="en"><title>Sign in</title><form action="/login" method="post"><label>Password<input name="password" type="password"></label><button>Sign in</button></form></html>');
    if (req.url === '/workspace' && state.authenticated && req.headers.cookie?.includes('fixture-session=valid')) return res.end(`<html lang="en"><title>Workspace</title><form action="/save" method="post"><label>Project name<input name="name" value="${state.name}"></label><button>Save draft</button></form><form action="/search"><label>Search query<input name="q"></label><button>Search</button></form><a target="_blank" href="/details">Open details</a><p>${state.name}</p><p>test@example.com</p><p>test-only-secret</p></html>`);
    if (req.url.startsWith('/search')) return res.end(`<html lang="en"><title>Search</title><h1>Search results</h1><p>${state.name}</p></html>`);
    if (req.url === '/details') return res.end(`<html lang="en"><title>Details</title><h1>${state.fault ? 'Wrong project' : state.name}</h1><div style="height:1600px"></div><p>End of details</p></html>`);
    res.writeHead(403); res.end('Sign in required');
  });
  await new Promise((resolve) => server.listen(0,'127.0.0.1', resolve)); t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let external = 0;
  const options = { launch: () => chromium.launch({ headless: true }), guard: (context) => context.route('**/*', (route) => { if (new URL(route.request().url()).origin !== origin) { external++; return route.abort(); } return route.continue(); }) };
  const base = { url: origin, title:'Draft workflow', requirement:'The saved project should be searchable.', steps:[], expectedPath:'/workspace', expectedTexts:['Sample project'], maskSelectors:[], redactValues:['test-only-secret'], cloudAiConsent:false, reviewed:true };
  const login = [{ action:'fill',target:'Password',value:'test-only-secret' },{action:'click',target:'Sign in'}];
  const create = [...login,{action:'fill',target:'Project name',value:'Sample project'},{action:'click',target:'Save draft'}];
  const created = await runBrowser({...base,steps:create},options); assert.equal(created.report.status,'passed',JSON.stringify(created.report));
  assert.equal(created.report.steps.length,4); assert.equal(state.writes,1); assert.ok(created.screenshot.length > 100);
  assert.doesNotMatch(JSON.stringify(created.report), /test-only-secret|test@example.com/);
  const isolated = await runBrowser({...base,url:`${origin}/workspace`},options); assert.equal(isolated.report.status,'inconclusive','login cookies must not leak across jobs');
  const edited = await runBrowser({...base,steps:[...login,{action:'fill',target:'Project name',value:'Revised project'},{action:'click',target:'Save draft'},{action:'fill',target:'Search query',value:'Revised'},{action:'click',target:'Search'}],expectedPath:'/search?q=Revised',expectedTexts:['Revised project']},options);
  assert.equal(edited.report.status,'passed',JSON.stringify(edited.report));
  const popup = await runBrowser({...base,steps:[...login,{action:'click',target:'Open details'},{action:'scroll',target:'bottom'}],expectedPath:'/details',expectedTexts:['End of details','Revised project']},options);
  assert.equal(popup.report.status,'passed',JSON.stringify(popup.report)); assert.equal(popup.report.steps[2].popup,true); assert.ok(popup.report.scrolls[0].after.y > 0);
  state.fault = true;
  const badSave = await runBrowser({...base,steps:[...login,{action:'fill',target:'Project name',value:'Lost update'},{action:'click',target:'Save draft'}],expectedTexts:['Lost update']},options);
  assert.equal(badSave.report.status,'failed');
  const wrongPopup = await runBrowser({...base,steps:[...login,{action:'click',target:'Open details'}],expectedPath:'/details',expectedTexts:['Revised project']},options);
  assert.equal(wrongPopup.report.status,'failed');
  const wrongPath = await runBrowser({...base,steps:login,expectedPath:'/unexpected',expectedTexts:['Revised project']},options);
  assert.equal(wrongPath.report.status,'failed');
  state.authenticated = false;
  const expired = await runBrowser({...base,url:`${origin}/workspace`},options); assert.equal(expired.report.status,'inconclusive');
  const cancelled = new AbortController(); cancelled.abort();
  assert.equal((await runBrowser(base,{...options,signal:cancelled.signal})).report.status,'inconclusive');
  assert.equal(external,0);
});
test('required steps cannot be removed, reordered, excluded or have final outcomes weakened', () => {
  const requiredSteps = [{action:'scroll',target:'up',value:'600'},{action:'scroll',target:'bottom'}];
  const profile = validateProfile({name:'Required',baseUrl:'https://example.com',requirement:'Observe both views',pages:[{path:'/',title:'Home',steps:[],requiredSteps,expectedPath:'/',expectedTexts:['Footer']}],viewport:{width:1280,height:800}});
  const item = {id:'one',selected:true,path:'/',title:'Scroll',expectation:'Verify footer',steps:requiredSteps,expectedPath:'/',expectedTexts:['Footer']}; const plan = {cases:[item]};
  assert.equal(validateReview(plan,[item],profile).length,1);
  for (const change of [{steps:[requiredSteps[1]]},{steps:[...requiredSteps].reverse()},{expectedPath:'/other'},{expectedTexts:[]},{selected:false}]) assert.throws(() => validateReview(plan,[{...item,...change}],profile));
  assert.doesNotMatch(JSON.stringify(privacy.publicReport({profileSnapshot:{},reviewedCases:[],error:'token=secret test@example.com'})), /secret|test@example.com/);
});
