import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root=new URL('../../',import.meta.url);
const read=async path=>JSON.parse(await fs.readFile(new URL(path,root),'utf8'));
const baseline=await read('docs/evidence/real-sites/enterprise-20260918-first/result.json');
const contract=await read('docs/evidence/real-sites/enterprise-20260918-first/manifest.json');
const repeats=[];
for(let i=1;i<=3;i++){
  const label=`enterprise-adaptation-verified-20260918-r${i}`,prefix=`docs/evidence/real-sites/${label}/`;
  const manifest=await read(prefix+'manifest.json'),result=await read(prefix+'result.json');
  assert.deepEqual(manifest.cases,contract.cases,'Benchmark targets/contracts must not change');
  for(const [name,expected] of Object.entries(manifest.sources))assert.equal(createHash('sha256').update(await fs.readFile(new URL(name,root))).digest('hex'),expected,'Measured source changed: '+name);
  repeats.push({label,result});
}
const rows=baseline.rows.map(before=>{
  const after=repeats.map(({result})=>result.rows.find(r=>r.id===before.id&&r.mode===before.mode));
  return {site:before.company,mode:before.mode,before:{status:before.report.status,completedSteps:before.report.scope.completedSteps},after:after.map(r=>({status:r.report.status,completedSteps:r.report.scope.completedSteps,wallMs:r.wallMs,network:r.report.network})),reason:before.id==='cloudflare'&&before.mode==='journey'?'등록되지 않은 privacyportal.onetrust.com 요청 차단. 미해결.':before.mode==='basic'?'접근성 검토 후보·미완료 항목이 남아 확인 불가. 정상 사이트 인증이 아님.':before.id==='vercel'?'숨은 이전 페이지 제목을 제외하고 현재 화면의 유일한 제목 검증.':'같은 9단계 계약을 반복 완료.'};
});
const summary={engineVersion:'0.2.6',baselineEngine:'0.2.5',repeats:3,contractsUnchanged:true,rows,externalAiCalls:0,localRuns:18,scope:'Same read-only contracts on live public sites; no independent defect oracle. Not a competitor accuracy benchmark. Baseline is a prior observation, not a simultaneous controlled trial.'};
await fs.writeFile(new URL('docs/evidence/live-adaptation/real-sites.json',root),JSON.stringify(summary,null,2));
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let table='<table><thead><tr><th>사이트 / 모드</th><th>기존 관측</th><th>수정 후 3회</th><th>해석</th></tr></thead><tbody>';
for(const row of rows)table+=`<tr><td>${esc(row.site)} / ${esc(row.mode)}</td><td>${esc(row.before.status)}${row.mode==='journey'?` (${row.before.completedSteps}/9)`:''}</td><td>${row.after.map(r=>esc(r.status)+(row.mode==='journey'?` (${r.completedSteps}/9)`:'')).join('<br>')}</td><td>${esc(row.reason)}</td></tr>`;
table+='</tbody></table>';
let evidence='';
for(const {label,result} of repeats)for(const row of result.rows){
  const screenshot=await fs.readFile(new URL(`docs/evidence/real-sites/${label}/${row.id}-${row.mode}.jpg`,root)).catch(()=>null);
  evidence+=`<details><summary>${esc(label)} · ${esc(row.company)} ${esc(row.mode)} · ${esc(row.report.status)}</summary><p>관측 시간 ${row.wallMs} ms — 브라우저 초기 실행 제외. 부하 시험 결과가 아닙니다.</p><pre>${esc(JSON.stringify({steps:row.report.steps,checks:row.report.checks,network:row.report.network},null,2))}</pre>${screenshot?`<img alt="검사 종료 화면" src="data:image/jpeg;base64,${screenshot.toString('base64')}">`:''}</details>`;
}
await fs.writeFile(new URL('docs/LIVE-QA-ADAPTATION-REPORT.html',root),`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>RepliQA 0.2.6 실사이트 재검증</title><style>body{font:16px/1.6 system-ui;margin:24px auto;padding:0 16px;max-width:1100px;color:#152436}h1{font-size:1.7rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ced8e2;padding:10px;text-align:left}th{background:#eef3f8}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}img{max-width:100%;height:auto}details{border-top:1px solid #ced8e2;padding:12px 0}.scroll{overflow:auto}</style><h1>RepliQA 0.2.6 실사이트 재검증</h1><p>동일 기업 사이트 3개 × 기본·여정 2종 × 3회 = 18회. RTX 4060 서버의 로컬 Chromium에서 실행. 외부 AI 호출 0회.</p><p><strong>GitHub·Next.js의 9단계 여정은 각각 3회 통과했습니다. Cloudflare 여정의 호스트 차단과 기본 검사의 접근성 검토 항목은 남아 있습니다.</strong></p><p>이 결과는 실제 사이트 전체의 무결함 인증이나 결함 검출 정확도 측정이 아닙니다. 이전 버전 결과는 과거 관측이며 사이트와 네트워크가 바뀔 수 있습니다. 기업별 계약과 기대 결과는 변경하지 않았고 정상·결함 쌍은 별도 로컬 시험으로 확인했습니다. 운영 배포 여부는 별도 변경 기록을 확인하세요.</p><div class="scroll">${table}</div><h2>각 실행의 단계·판정 근거·종료 화면</h2>${evidence}</html>`);
console.log(JSON.stringify({contractsUnchanged:true,rows:rows.length,runs:18,report:'docs/LIVE-QA-ADAPTATION-REPORT.html'}));
const reportUrl=new URL('docs/LIVE-QA-ADAPTATION-REPORT.html',root);
const html=await fs.readFile(reportUrl,'utf8');
await fs.writeFile(reportUrl,html.replace('<h1>','<p><strong>운영은 0.2.5 유지. 실제 Cloudflare 무료 Worker는 하위 요청 한도로 여정을 완료하지 못했습니다. 아래 표는 로컬 Chromium 결과입니다.</strong> <a href="LIVE-QA-ADAPTATION.md">클라우드 실패 근거와 남은 작업</a></p><h1>'));
