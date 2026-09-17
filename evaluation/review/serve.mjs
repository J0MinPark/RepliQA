import http from 'node:http';
import {verifyPack} from './verify.mjs';
const {cases}=await verifyPack(process.argv[2]);
const escape=text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const server=http.createServer((request,response)=>{
  const path=new URL(request.url,'http://fixture').pathname;
  response.setHeader('content-type','text/html; charset=utf-8');response.setHeader('cache-control','no-store');
  if(path==='/'){response.end('<title>RepliQA reviewer fixtures</title><h1>Review cases</h1><p>No engine predictions have been generated.</p>'+cases.map(c=>`<p><a href="/case/${c.id}">${c.id} — ${escape(c.name)}</a>: ${escape(c.requirement)}</p>`).join(''));return;}
  const item=cases.find(c=>path==='/case/'+c.id);response.statusCode=item?200:404;response.end(item?.html||'Not found');
});
server.listen(0,'127.0.0.1',()=>console.log('Reviewer fixtures: http://127.0.0.1:'+server.address().port));
