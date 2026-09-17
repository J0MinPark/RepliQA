import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const hash=value=>createHash('sha256').update(value).digest('hex');
export async function verifyPack(directory,reviewFile){
  const pack=path.resolve(directory),manifest=JSON.parse(await fs.readFile(path.join(pack,'manifest.json'),'utf8'));
  for(const [file,expected] of Object.entries(manifest.artifacts))if(hash(await fs.readFile(path.join(pack,file)))!==expected)throw Error('Frozen artifact changed: '+file);
  for(const [file,expected] of Object.entries(manifest.sources))if(hash(await fs.readFile(path.join(root,file)))!==expected)throw Error('Frozen engine/source changed: '+file);
  const cases=JSON.parse(await fs.readFile(path.join(pack,'cases.json'),'utf8')),oracle=JSON.parse(await fs.readFile(path.join(pack,'proposed-oracle.json'),'utf8'));
  if(!reviewFile)return {manifest,cases,oracle};
  const review=JSON.parse(await fs.readFile(reviewFile,'utf8'));
  if(review.pack!==manifest.label||!review.reviewer?.name?.trim()||!review.reviewer.role?.trim()||!Number.isFinite(Date.parse(review.reviewer.reviewedAt))||review.reviewer.independentOfImplementation!==true)throw Error('A completed external reviewer attestation is required');
  if(review.cases?.length!==cases.length)throw Error('Every case needs review');
  for(const item of oracle){const rows=review.cases.filter(row=>row.id===item.id);if(rows.length!==1||rows[0].approved!==true||rows[0].expected!==item.expected||rows[0].evidence?.trim().length<20)throw Error('Review missing, disputed or unsupported: '+item.id);}
  return {manifest,cases,oracle,review,reviewHash:hash(await fs.readFile(reviewFile))};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await verifyPack(process.argv[2],process.argv[3]);console.log(JSON.stringify({integrity:true,cases:result.cases.length,externalReview:!!result.review,engineMeasured:false}));
}
