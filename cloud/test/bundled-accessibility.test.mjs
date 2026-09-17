import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {axeSource} from '../src/axe-source.mjs';
const require=createRequire(new URL('../../desktop/package.json',import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH=fileURLToPath(new URL('../../desktop/vendor/browsers',import.meta.url));
const {chromium}=require('playwright');

test('bundled accessibility runner preserves upstream bytes and executes without bundler globals',async t=>{
  assert.equal(axeSource,await fs.readFile(new URL('../node_modules/axe-core/axe.min.js',import.meta.url),'utf8'));
  const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/accessibility.mjs',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',keepNames:true,minify:false});
  const {accessibilityChecks}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();
  await page.setContent('<!doctype html><html lang="en"><head><title>Bundled fixture</title></head><body><main><h1>Profile</h1><label for="name">Name</label><input id="name"><button>Save</button></main></body></html>');
  assert.equal(await page.evaluate(()=>typeof globalThis.__name),'undefined');
  const normal=await accessibilityChecks(page);assert.equal(normal[0].status,'passed',JSON.stringify(normal));
  await page.locator('label').evaluate(el=>el.remove());const fault=await accessibilityChecks(page);
  assert.equal(fault[0].status,'review',JSON.stringify(fault));assert.ok(fault[0].evidence.violations.some(rule=>rule.rule==='label'));
});
