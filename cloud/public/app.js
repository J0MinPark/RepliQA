import { catalog } from './qa-catalog.js';
import { reproductionMarkdown } from './reproduction.js';
import { exportPlan, readPlan, containsPlaceholder } from './plans.js';
let token = ''; let activeId = null; let busy = false; let lastRequest = null; let aiEnabled = false;
const $ = (id) => document.getElementById(id);
const labels = { ready: '준비', running: '실행 중', done: '완료', passed: '검사 범위 내 통과', failed: '지정 조건 불일치', review: '검토 후보', inconclusive: '확인 불가', interrupted: '중단', cancelled: '취소',not_run:'미실행',not_tested:'미검사',not_applicable:'해당 요소 없음',checked:'범위 내 확인',executed:'동작 실행' };
const message = (text) => { $('message').textContent = text; };
async function api(path, options = {}) {
  const result = await fetch(`/api/${path}`, { ...options, headers: { authorization: `Bearer ${token}`, ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers } });
  const value = await result.json(); if (!result.ok) throw new Error(value.error || '요청에 실패했습니다.'); return value;
}
function lines(value) { return value.split('\n').map((line) => line.trim()).filter(Boolean); }
function button(text, action) { const b = document.createElement('button'); b.textContent = text; b.className = 'secondary'; b.onclick = action; return b; }
function addStep(saved) {
  if ($('steps').children.length >= 12) return;
  const row = document.createElement('div'); row.className = 'step';
  const kind = document.createElement('select'); kind.setAttribute('aria-label', '동작 종류');
  for (const [value, text] of Object.entries({ click: '클릭', fill: '입력', select: '선택', check: '체크', uncheck:'체크 해제', expect: '문구 확인', scroll: '스크롤',back:'뒤로 가기',forward:'앞으로 가기',reload:'새로 고침',hover:'호버',press:'키보드',assertText:'영역 문구 검증',assertValue:'입력값 검증',assertChecked:'체크 상태 검증',assertEnabled:'활성 상태 검증',assertVisible:'보임 검증',assertHidden:'숨김 검증',assertCount:'개수 검증',assertUrl:'현재 경로 검증' })) kind.add(new Option(text, value));
  const target = document.createElement('input'); target.placeholder = '대상의 정확한 이름'; target.required = true; target.maxLength = 200; target.setAttribute('aria-label', '동작 대상');
  const value = document.createElement('input'); value.placeholder = '입력 값'; value.maxLength = 300; value.setAttribute('aria-label', '동작 값'); value.disabled = true;
  kind.onchange = () => { value.disabled = !['fill','select','scroll','press'].includes(kind.value); value.type = kind.value === 'fill' ? 'password' : 'text'; target.placeholder = kind.value === 'scroll' ? 'up / down / top / bottom' : ['back','forward','reload'].includes(kind.value)?'이동 후 기대 경로 (/...)':'대상의 정확한 이름'; value.placeholder=kind.value==='press'?'Tab / Shift+Tab / Escape':'입력 값'; if (kind.value === 'scroll') { target.value = 'down'; value.value = '600'; } else { target.value = ''; value.value = ''; } };
  const changeAction=kind.onchange;
  kind.onchange=()=>{changeAction();if(kind.value.startsWith('assert')){target.placeholder=kind.value==='assertUrl'?'기대 경로 (/...)':'CSS 선택자 (#result 등)';value.disabled=['assertVisible','assertHidden','assertUrl'].includes(kind.value);value.type=kind.value==='assertValue'?'password':'text';value.placeholder=['assertChecked','assertEnabled'].includes(kind.value)?'true / false':kind.value==='assertCount'?'기대 개수 (0 이상)':'정확한 기대 값';}};
  const remove = button('×', () => row.remove()); remove.type = 'button'; remove.setAttribute('aria-label', '동작 삭제');
  row.append(kind, target, value, remove); $('steps').append(row);
  if(saved?.action){kind.value=saved.action;kind.onchange();target.value=saved.target;value.value=saved.value??'';}
}
async function history() {
  const data = await api('runs'); $('runs').replaceChildren();
  for (const run of data.runs) {
    const card = document.createElement('article'); card.className = 'run'; const title = document.createElement('h3');
    title.textContent = run.report?.title || new Date(run.created_at).toLocaleString('ko-KR');
    const status = document.createElement('span'); status.className = 'badge'; status.textContent = labels[run.report?.status || run.status] || run.status;
    card.append(title, status);
    if (run.report) {
      if(run.report.scope){const scope=document.createElement('p');scope.className='note';scope.textContent=`${run.report.mode==='automatic-basic'?'자동 기본 점검':'지정 여정'} · 동작 ${run.report.scope.completedSteps}/${run.report.scope.plannedSteps}개 완료 · ${run.report.scope.note}`;card.append(scope);const table=document.createElement('table');const head=document.createElement('tr');for(const title of ['검사 항목','판정']){const th=document.createElement('th');th.textContent=title;head.append(th);}table.append(head);for(const check of run.report.checks){const row=document.createElement('tr');for(const text of [check.title,labels[check.status]||check.status]){const cell=document.createElement('td');cell.textContent=text;row.append(cell);}table.append(row);}card.append(table);const omitted=document.createElement('details');const sum=document.createElement('summary');sum.textContent='미검사 범위 보기';const list=document.createElement('ul');for(const item of run.report.scope.items.filter(i=>i.status==='not_tested')){const li=document.createElement('li');li.textContent=`${item.title}: ${item.detail}`;list.append(li);}omitted.append(sum,list);card.append(omitted);}
      const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = '동작·결과 근거 보기';
      const pre = document.createElement('pre'); pre.textContent = JSON.stringify(run.report, null, 2); details.append(summary, pre); card.append(details);
      card.append(button('화면 보기', async () => { try { const response = await fetch(`/api/runs/${run.id}/screenshot`, { headers: { authorization: `Bearer ${token}` } }); if (!response.ok) throw new Error('저장된 화면이 없습니다.'); const image = document.createElement('img'); image.alt = '민감정보를 마스킹한 최종 검사 화면'; const objectUrl = URL.createObjectURL(await response.blob()); image.src = objectUrl; image.onload = () => URL.revokeObjectURL(objectUrl); card.append(image); } catch (error) { message(error.message); } }));
      card.append(button('결과 저장', () => { const objectUrl = URL.createObjectURL(new Blob([JSON.stringify(run.report, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = objectUrl; link.download = `RepliQA-${run.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(objectUrl), 1000); }));
      card.append(button('재현 보고서 저장',()=>{const objectUrl=URL.createObjectURL(new Blob([reproductionMarkdown(run.report)],{type:'text/markdown;charset=utf-8'}));const link=document.createElement('a');link.href=objectUrl;link.download=`RepliQA-${run.id}-reproduction.md`;link.click();setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);}));
    }
    if (['ready','running'].includes(run.status)) card.append(button('취소', async () => { try { await api(`runs/${run.id}/cancel`, { method: 'POST' }); await history(); } catch (error) { message(error.message); } }));
    else card.append(button('결과 삭제', async () => { try { await api(`runs/${run.id}`, { method: 'DELETE' }); await history(); } catch (error) { message(error.message); } }));
    $('runs').append(card);
  }
  if (!data.runs.length) $('runs').textContent = '아직 검사 내역이 없습니다.';
}
$('login-form').onsubmit = async (event) => { event.preventDefault(); token = $('token').value.trim(); try {
  const me = await api('me'); $('origins').replaceChildren(...me.origins.map((origin) => new Option(origin, origin)));
  $('limits').textContent = `무료 파일럿: 서비스 전체 하루 ${me.limits.dailyGlobal}회, 고객별 ${me.limits.dailyTenant}회 · 브라우저 검사 최대 45초 · 동시 1건`;
  aiEnabled=me.aiEnabled; $('ai-consent').checked = false; updateMode();
  $('token').value = ''; $('login').hidden = true; $('workspace').hidden = false; $('history').hidden = false; message('접속했습니다.'); await history();
} catch (error) { token = ''; message(error.message); } };
$('add-step').onclick = () => addStep();
$('refresh').onclick = () => history().catch((error) => message(error.message));
$('logout').onclick = () => { if (busy) { message('실행을 마치거나 취소한 뒤 로그아웃하세요.'); return; } token = ''; lastRequest = null; $('job-form').reset(); $('steps').replaceChildren(); $('runs').replaceChildren(); $('workspace').hidden = true; $('history').hidden = true; $('login').hidden = false; updateMode();message('로그아웃했습니다.'); };
function currentJob() {
  const form = new FormData($('job-form')); const steps = [...$('steps').children].map((row) => { const [kind, target, value] = row.children; return { action: kind.value, target: target.value, ...(!value.disabled && (kind.value !== 'scroll' || value.value) ? { value: value.value } : {}) }; });
  const basic=form.get('inspectionMode')==='basic';
  const job = { inspectionMode:basic?'basic':'journey',url: new URL(form.get('path'), form.get('origin')).href, title: form.get('title'), requirement: basic?'현재 페이지의 공통 기본 항목을 확인합니다.':form.get('requirement'), ...(basic?{}:{expectedPath: form.get('expectedPath')}),expectedTexts:basic?[]:lines(form.get('expectedTexts')),steps:basic?[]:steps,maskSelectors:lines(form.get('maskSelectors')),redactValues:lines(form.get('redactValues')),cloudAiConsent:!basic&&form.has('cloudAiConsent'),reviewed:true,...(!basic&&form.get('resultSelector')?.trim()?{resultSelector:form.get('resultSelector').trim()}:{}),requireResultChange:!basic&&form.has('requireResultChange') };
  return job;
}
function loadJob(job){
  const url=new URL(job.url);if(![...$('origins').options].some(o=>o.value===url.origin))throw new Error('등록된 사이트의 계획만 불러올 수 있습니다.');
  $('job-form').reset();$('steps').replaceChildren();$('inspection-mode').value='journey';updateMode();
  const form=$('job-form').elements;
  for(const [name,value] of Object.entries({title:job.title,origin:url.origin,path:url.pathname+url.search+url.hash,expectedPath:job.expectedPath||'/',requirement:job.requirement,expectedTexts:job.expectedTexts.join('\n'),resultSelector:job.resultSelector||'',maskSelectors:job.maskSelectors.join('\n'),redactValues:job.redactValues.join('\n')}))form.namedItem(name).value=value;
  form.namedItem('requireResultChange').checked=job.requireResultChange;
  for(const step of job.steps)addStep(step);
  $('inspection-mode').value=job.inspectionMode;updateMode();form.namedItem('reviewed').checked=false;$('ai-consent').checked=false;lastRequest=null;
  message('계획을 불러왔습니다. 제외된 입력값과 추가 마스킹을 다시 입력하고, 전체 조건을 검토한 뒤 실행하세요.');
}
$('save-plan').onclick=async()=>{if(busy)return;try{
  const {job}=await api('validate-plan',{method:'POST',body:JSON.stringify(currentJob())});
  const objectUrl=URL.createObjectURL(new Blob([JSON.stringify(exportPlan(job),null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=objectUrl;link.download='RepliQA-plan.json';link.click();setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);
  message('계획 파일을 저장했습니다. 입력값은 제외했습니다. 공유 전에 URL·설명·기대 문구에 민감정보가 없는지 확인하세요.');
}catch(error){message(error.message);}};
$('load-plan').onchange=async()=>{if(busy){$('load-plan').value='';return;}try{
  const file=$('load-plan').files[0];if(!file)return;if(file.size>20000)throw new Error('검사 계획 파일은 20KB 이하여야 합니다.');
  const {job}=await api('validate-plan',{method:'POST',body:JSON.stringify(readPlan(await file.text()))});loadJob(job);
}catch(error){message(error.message);}finally{$('load-plan').value='';}};
$('job-form').onsubmit = async (event) => {
  event.preventDefault(); if (busy) return;
  let job;try{job=currentJob();if(containsPlaceholder(job))throw new Error('가려진 값 또는 REPLIQA_REENTER 표시를 실제 테스트 값으로 바꿔주세요.');}catch(error){message(error.message);return;}
  const body = JSON.stringify(job); if (lastRequest?.body !== body) lastRequest = { body, key: crypto.randomUUID() };
  busy = true; $('submit').disabled = true;
  try {
    message('무료 실행 한도를 확인하고 있습니다.');
    const reserved = await api('runs', { method: 'POST', body, headers: { 'idempotency-key': lastRequest.key } }); activeId = reserved.id;
    if (reserved.status !== 'ready') { message('같은 요청을 다시 실행하지 않았습니다. 검사 내역을 확인하세요.'); lastRequest = null; return; }
    $('cancel').hidden = false; message('브라우저 검사 중입니다. 이 화면을 열어두세요.');
    const result = await api(`runs/${activeId}/execute`, { method: 'POST', body }); message(labels[result.report.status] || result.report.status); lastRequest = null;
  } catch (error) { message(error.message); }
  finally { busy = false; activeId = null; $('submit').disabled = false; $('cancel').hidden = true; await history().catch(() => {}); }
};
$('cancel').onclick = async () => { if (!activeId) return; try { await api(`runs/${activeId}/cancel`, { method: 'POST' }); message('취소를 요청했습니다. 이미 사이트에 반영된 입력은 되돌리지 않습니다.'); } catch (error) { message(error.message); } };
function updateMode(){const basic=$('inspection-mode').value==='basic';for(const element of document.querySelectorAll('[data-journey]')){element.hidden=basic;for(const input of element.querySelectorAll('input,textarea,select,button')){if(basic){input.dataset.previousDisabled=String(input.disabled);input.disabled=true;}else if(input.dataset.previousDisabled!==undefined){input.disabled=input.dataset.previousDisabled==='true';delete input.dataset.previousDisabled;}}}$('ai-consent').disabled=basic||!aiEnabled;if(basic)$('ai-consent').checked=false;$('mode-note').textContent=basic?'여정 입력 없이 현재 페이지의 제목·언어·이미지·컨트롤 이름·링크 속성·두 화면 크기·스크롤을 점검합니다. 버튼 클릭, 다른 페이지 방문, 업무 결과는 포함하지 않습니다.':'여정의 동작과 최종 결과를 직접 지정합니다. 기본 점검과 별도로 실행하며 전체 사이트의 모든 기능을 검사하지 않습니다.';}
$('inspection-mode').onchange=updateMode;
for(const item of catalog){const p=document.createElement('p');const strong=document.createElement('strong');strong.textContent=`${item.title} · ${{basic:'자동 기본 점검',journey:'여정 지정',configured:'데이터·정답 설정',manual:'별도 검증'}[item.mode]}`;p.append(strong,document.createElement('br'),document.createTextNode(item.detail));$('catalog').append(p);}
updateMode();
