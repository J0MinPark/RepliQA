// Portable plans are user-downloaded files, never browser storage or cloud DB rows.
const actions = new Set(['click','fill','select','check','uncheck','expect','scroll','back','forward','reload','hover','press','assertText','assertValue','assertChecked','assertEnabled','assertVisible','assertHidden','assertCount','assertUrl']);
export const placeholder = '[REPLIQA_REENTER]';
export function containsPlaceholder(value) { return JSON.stringify(value).includes(placeholder) || /\[(?:MASKED|EMAIL)\]/.test(JSON.stringify(value)); }
export function exportPlan(job) {
  const secrets=[...(job.redactValues||[]),...job.steps.filter(s=>['fill','assertValue'].includes(s.action)||s.sensitive).map(s=>s.value)].filter(Boolean).sort((a,b)=>b.length-a.length);
  const clean=value=>{
    if(typeof value==='string'){for(const secret of secrets)value=value.split(secret).join(placeholder);return value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,placeholder).replace(/((?:token|password|secret|api[_-]?key|authorization)\s*[=:]\s*)[^\s&"<>]+/gi,'$1'+placeholder);}
    if(Array.isArray(value))return value.map(clean);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,clean(item)]));
    return value;
  };
  const safe=clean(job);
  safe.inspectionMode=job.inspectionMode;safe.steps=job.steps.map((s,i)=>({...safe.steps[i],action:s.action,...(['fill','assertValue'].includes(s.action)||s.sensitive?{value:placeholder}:{})}));
  safe.redactValues=[];safe.cloudAiConsent=false;safe.reviewed=true;
  return {format:'repliqa-plan',version:1,privacyReviewRequired:true,job:safe};
}
export function readPlan(text) {
  if(new TextEncoder().encode(text).length>20000)throw new Error('검사 계획 파일은 20KB 이하여야 합니다.');
  const data=JSON.parse(text);
  if(data?.format!=='repliqa-plan'||data.version!==1||!data.job||!Array.isArray(data.job.steps)||data.job.steps.length>12||data.job.steps.some(s=>!actions.has(s.action)))throw new Error('지원하는 RepliQA 검사 계획 파일이 아닙니다.');
  return data.job;
}
