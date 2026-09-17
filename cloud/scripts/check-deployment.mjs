import fs from 'node:fs/promises';
const version=JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url),'utf8')).version;
const origin=process.env.REPLIQA_PUBLIC_ORIGIN;
if(!origin||new URL(origin).protocol!=='https:')throw new Error('Set REPLIQA_PUBLIC_ORIGIN to the HTTPS origin being deployed.');
const url=new URL('/api/health',origin).href;
const response=await fetch(`${url}?release=${encodeURIComponent(version)}&check=${Date.now()}`,{cache:'no-store',signal:AbortSignal.timeout(15000)});
const actual=await response.json();
const receipt={checkedAt:new Date().toISOString(),url,expectedVersion:version,actualVersion:actual.version,httpStatus:response.status,aiEnabled:actual.aiEnabled,passed:response.ok&&actual.version===version&&actual.aiEnabled===false};
const dir=new URL('../../docs/evidence/qa-evaluation/',import.meta.url);await fs.mkdir(dir,{recursive:true});
await fs.writeFile(new URL('public-version.json',dir),JSON.stringify(receipt,null,2));
console.log(JSON.stringify(receipt));
if(!receipt.passed){console.error('Public deployment verification failed. Upload completion is not proof that this version is serving requests.');process.exitCode=1;}
