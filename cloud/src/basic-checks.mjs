import scroll from '../../desktop/src/scroll.cjs';
import { accessibilityChecks } from './accessibility.mjs';

async function inspect(page) {
  return page.evaluate(()=>{
    const all=[...document.querySelectorAll('body *')];
    const visible=el=>{const r=el.getBoundingClientRect();if(!r.width||!r.height)return false;for(let e=el;e;e=e.parentElement){const s=getComputedStyle(e);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0||e.hidden)return false;}return true;};
    const nodes=all.slice(0,8000).filter(visible);
    const inView=el=>{const r=el.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;};
    const name=el=>[el.getAttribute('aria-label'),...(el.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>document.getElementById(id)?.textContent),...Array.from(el.labels||[]).map(l=>l.textContent),...(!el.matches('input,select,textarea')?[el.textContent]:[]),el.getAttribute('title'),...el.matches('input[type=button],input[type=submit]')?[el.value]:[]].filter(Boolean).join(' ').trim();
    const controls=nodes.filter(el=>el.matches('button,input:not([type=hidden]),select,textarea,[role=button]'));
    const images=nodes.filter(el=>el.tagName==='IMG'&&inView(el));
    return {title:document.title.trim(),language:document.documentElement.lang.trim(),hasContent:!!document.body.innerText.trim()||controls.length>0||images.length>0,busy:nodes.some(el=>el.getAttribute('aria-busy')==='true'||el.getAttribute('role')==='progressbar'),truncated:all.length>8000,controls:controls.length,unnamed:controls.filter(el=>!name(el)).length,links:nodes.filter(el=>el.matches('a')).length,emptyLinks:nodes.filter(el=>el.matches('a')&&(!el.getAttribute('href')||['#','javascript:void(0)'].includes(el.getAttribute('href')))).length,images:images.length,brokenImages:images.filter(el=>el.complete&&!el.naturalWidth).length,pendingImages:images.filter(el=>!el.complete).length,overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),width:innerWidth};
  });
}
export async function basicChecks(page,response,signal) {
  const checks=[];const push=(id,title,status,evidence,message)=>checks.push({id,catalogId:id,title,status,evidence,message});
  const status=response?.status();
  push('page-http','페이지 응답',status>=400?'review':status?'passed':'inconclusive',{httpStatus:status??null},'응답 상태의 관측값입니다. 접근 차단·로그인 요구·서비스 장애의 원인은 별도 확인합니다.');
  await page.waitForFunction(()=>document.body?.innerText.trim()||document.querySelector('button,input,img'),undefined,{timeout:2500}).catch(()=>{});
  await page.waitForTimeout(500);signal?.throwIfAborted();
  const first=await inspect(page);
  push('page-content','페이지 내용 표시',first.busy?'inconclusive':first.hasContent?'passed':'review',{hasContent:first.hasContent,busy:first.busy},'내용 존재와 로딩 표시만 확인합니다. 올바른 업무 화면인지는 기대 결과가 필요합니다.');
  push('page-title','페이지 제목',first.title?'passed':'review',{present:!!first.title},'제목 존재 여부만 확인했습니다.');
  push('page-language','문서 언어',first.language?'passed':'review',{present:!!first.language},'lang 존재 여부만 확인했습니다.');
  push('image-load','화면의 이미지 로딩',first.truncated?'inconclusive':first.brokenImages?'review':first.pendingImages?'inconclusive':first.images?'passed':'not_applicable',{visibleImages:first.images,broken:first.brokenImages,pending:first.pendingImages},'현재 화면에 보이는 이미지 표본입니다. 지연 로딩·차단은 결함으로 확정하지 않습니다.');
  push('control-label','입력·버튼 이름',first.truncated?'inconclusive':first.unnamed?'review':first.controls?'passed':'not_applicable',{controls:first.controls,unnamed:first.unnamed},'이름 유무의 후보 검사이며 클릭 동작·전체 접근성 검증은 아닙니다.');
  push('link-markup','링크 대상',first.truncated?'inconclusive':first.emptyLinks?'review':first.links?'passed':'not_applicable',{links:first.links,emptyTargets:first.emptyLinks},'현재 DOM의 대상 속성을 확인했습니다. 링크를 방문하거나 정상 목적지를 검증하지 않았습니다.');
  push('layout-desktop','1280px 가로 넘침',first.overflow>2?'review':'passed',{width:first.width,overflowPixels:first.overflow},'가로 넘침은 의도된 UI일 수 있어 검토 후보로 분류합니다.');
  const viewport=page.viewportSize();
  try {
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);signal?.throwIfAborted();
    const mobile=await inspect(page);
    push('layout-mobile','390px 가로 넘침',mobile.overflow>2?'review':'passed',{width:mobile.width,overflowPixels:mobile.overflow},'한 화면 크기의 표본이며 실제 모바일 기기 검사가 아닙니다.');
  } finally {await page.setViewportSize(viewport);}
  try {
    const down=await scroll.scrollPage(page,{action:'scroll',target:'bottom'});signal?.throwIfAborted();
    const up=await scroll.scrollPage(page,{action:'scroll',target:'top'});
    push('scroll','아래·위 스크롤',!down.moved&&down.before.height<=down.before.viewportHeight?'not_applicable':down.atBottom&&up.atTop?'passed':'inconclusive',{down,up},'한 번의 왕복입니다. 무한 스크롤·추가 로딩 전체를 검사하지 않았습니다.');
  } catch {push('scroll','아래·위 스크롤','inconclusive',null,'스크롤 잠금 또는 추가 로딩으로 왕복을 확인하지 못했습니다.');}
  checks.push(...await accessibilityChecks(page,signal));
  return checks;
}
