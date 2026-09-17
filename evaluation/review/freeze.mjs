import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {proposedCases} from './cases.mjs';
import {jobSchema} from '../../cloud/src/schema.mjs';
const label=process.argv[2];if(!/^[a-z0-9-]+$/.test(label||''))throw Error('Supply a fresh pack label');
const root=new URL('../../',import.meta.url),out=new URL(`../review-packs/${label}/`,import.meta.url);
await fs.mkdir(new URL('../review-packs/',import.meta.url),{recursive:true});await fs.mkdir(out);
const hash=value=>createHash('sha256').update(value).digest('hex');
const cases=proposedCases().map((item,index)=>{
  const id=hash(label+':'+index).slice(0,16),path='/case/'+id;
  const job=jobSchema.parse({inspectionMode:'journey',url:'http://fixture.invalid'+path,title:item.name,requirement:item.requirement,steps:item.steps,expectedPath:path,expectedTexts:['Fixture ready'],resultSelector:'#stable',reviewed:true});
  for(const match of item.html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
  return {...item,id,job};
}).sort((a,b)=>a.id.localeCompare(b.id));
const artifacts={};
async function write(name,value){const bytes=JSON.stringify(value,null,2)+'\n';await fs.writeFile(new URL(name,out),bytes);artifacts[name]=hash(bytes);}
await write('cases.json',cases.map(({id,name,requirement,html,job})=>({id,name,requirement,html,job})));
await write('proposed-oracle.json',cases.map(({id,truth,expected,proof})=>({id,truth,expected,proof})));
await write('review-template.json',{pack:label,reviewer:{name:'',role:'',reviewedAt:'',independentOfImplementation:false},cases:cases.map(({id})=>({id,approved:false,expected:'',evidence:'',notes:''}))});
const sources={};
async function track(relative){const location=new URL(relative,root);if((await fs.stat(location)).isDirectory()){for(const file of await fs.readdir(location))await track(relative+'/'+file);}else sources[relative]=hash(await fs.readFile(location));}
for(const source of ['cloud/src','cloud/public/qa-catalog.js','desktop/src/browser-flow.cjs','desktop/src/privacy.cjs','desktop/src/scroll.cjs','backend/src/design/actions.js','backend/src/engine/paymentSafety.js','evaluation/review'])await track(source);
await fs.writeFile(new URL('manifest.json',out),JSON.stringify({label,frozenAt:new Date().toISOString(),engineVersion:'0.2.5',uniqueCases:cases.length,counts:{normal:12,defect:12,unresolved:4},artifacts,sources,reviewStatus:'pending',engineMeasured:false,independence:'Author-generated proposals, no external reviewer yet. External truth review is required; this is not a blind independent corpus.'},null,2));
console.log(JSON.stringify({label,cases:cases.length,reviewStatus:'pending',engineMeasured:false}));
