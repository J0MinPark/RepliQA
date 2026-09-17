// Visible text only, including text split across nested inline elements.
export async function readResult(page, selector) {
  return page.evaluate((selector)=>{
    const elements=selector ? [...document.querySelectorAll(selector)] : [document.body];
    if(!elements.length)return {available:false,matchedCandidates:0,visibleCandidates:0,reason:'결과 영역을 찾지 못했습니다.'};
    if(elements.length>100)return {available:false,ambiguous:true,truncated:true,matchedCandidates:elements.length,reason:'결과 후보 수집 한도를 넘었습니다.'};
    // Visibility can be overridden by a child; display:none and opacity:0 cannot.
    // The hidden attribute is a CSS default, not proof that a rendered node is hidden.
    const traversable=el=>{for(let e=el;e;e=e.parentElement){const s=getComputedStyle(e);if(s.display==='none'||Number(s.opacity)===0||e.getAttribute('aria-hidden')==='true')return false;}return true;};
    const visible=el=>{const s=getComputedStyle(el);return traversable(el)&&!['hidden','collapse'].includes(s.visibility)&&(s.display==='contents'||el.getClientRects().length>0);};
    const observe=root=>{
    if(!traversable(root))return {available:false,reason:'결과 영역이 보이지 않습니다.'};
    // A bounded walk excludes hidden descendants, including opacity:0 text.
    let text='';let count=0;let truncated=false;
    const walk=node=>{if(++count>10000||text.length>80000){truncated=true;return;}if(node.nodeType===3){if(visible(node.parentElement))text+=node.textContent;return;}if(node.nodeType!==1||!traversable(node)||['SCRIPT','STYLE','NOSCRIPT','INPUT','TEXTAREA','SELECT'].includes(node.tagName))return;if(node.tagName==='BR'){if(visible(node))text+='\n';return;}const block=!['inline','contents'].includes(getComputedStyle(node).display);if(block)text+='\n';for(const child of node.childNodes){walk(child);if(truncated)break;}if(block)text+='\n';};
    walk(root);const normal=v=>v.normalize('NFKC').replace(/\s+/g,' ').trim();
    if(!visible(root)&&!normal(text)&&!truncated)return {available:false,reason:'결과 영역이 보이지 않습니다.'};
    return {available:true,text:normal(text),lines:text.split('\n').map(normal).filter(Boolean),truncated};
    };
    // SPA history and responsive layouts can retain hidden copies. Resolve from
    // the current rendered state, never from the expected assertion text.
    const observations=elements.map(observe);
    const candidates=observations.filter(item=>item.available);
    const evidence={matchedCandidates:elements.length,visibleCandidates:candidates.length};
    if(candidates.length>1)return {available:false,ambiguous:true,...evidence,reason:'보이는 결과 영역이 여러 개입니다.'};
    return {...(candidates[0]||observations[0]),...evidence};
  },selector||null);
}

export async function checkOutcomes(page,job,before,signal) {
  const normal=v=>v.normalize('NFKC').replace(/\s+/g,' ').trim();
  const expected=job.expectedTexts.map(normal);const until=Date.now()+4000;
  let sample;let stable=0;let previous;let matched=[];
  do {
    signal?.throwIfAborted();sample=await readResult(page,job.resultSelector);
    matched=expected.map(value=>sample.available&&(job.resultSelector?sample.text===value:sample.lines.includes(value)));
    const changed=!job.requireResultChange||(before&&!before.ambiguous&&sample.available&&(!before.available||before.text!==sample.text));
    stable=matched.every(Boolean)&&changed&&previous===sample.text?stable+1:0;previous=sample.text;
    if(stable>=2)break;
    await page.waitForTimeout(200);
  } while(Date.now()<until);
  const checks=job.expectedTexts.map((text,index)=>({id:`text-${index}`,catalogId:'outcome',title:text,status:sample.ambiguous||sample.truncated?'inconclusive':matched[index]&&stable>=2?'passed':matched[index]?'inconclusive':'failed',message:!sample.available?sample.reason:sample.truncated?'화면 수집 한도를 넘었습니다.':job.resultSelector?'지정 영역의 보이는 전체 문구와 비교':'화면의 보이는 한 줄과 비교. 결과 영역 지정 시 근거를 좁힐 수 있습니다.',evidence:{selector:job.resultSelector||null,expected:text,observed:sample.available?sample.text.slice(0,2000):null,observedTextTruncated:!!sample.truncated||!!(sample.text?.length>2000),match:!!matched[index],stableSamples:stable+1}}));
  if(job.requireResultChange)checks.push({id:'result-change',catalogId:'state-change',title:'동작 전후 결과 변경',status:!before||before.ambiguous||sample.ambiguous?'inconclusive':sample.available&&(!before.available||before.text!==sample.text)?'passed':'failed',message:'동작 전후 지정 영역의 표시 상태·문구 변경을 확인했습니다.'});
  return checks;
}
