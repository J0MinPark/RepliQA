// Frozen before the first measurement. Synthetic contracts, not an independent customer holdout.
export const corpusVersion = '2026-09-17.v3';
const normalAndFault = (family, extra = {}) => ['normal', 'defect'].map(truth => ({
  id: `${family}-${truth}`, family, truth, variant: truth === 'defect' ? 'fault' : 'control', ...extra,
}));
export const cases = [
  ...normalAndFault('plain-result'),
  ...normalAndFault('nested-inline'),
  ...normalAndFault('display-contents'),
  ...normalAndFault('line-breaks'),
  ...normalAndFault('delayed-result'),
  ...normalAndFault('save-reload'),
  ...normalAndFault('select-calculation'),
  ...normalAndFault('form-validation'),
  ...normalAndFault('history-navigation'),
  ...normalAndFault('same-origin-popup'),
  { id: 'outside-decoy', family: 'evidence-scope', truth: 'defect', variant: 'decoy' },
  { id: 'hidden-result', family: 'evidence-scope', truth: 'defect', variant: 'hidden' },
  { id: 'transparent-result', family: 'evidence-scope', truth: 'defect', variant: 'transparent' },
  { id: 'stale-success-noop', family: 'state-change', truth: 'defect', variant: 'noop' },
  { id: 'brief-success', family: 'state-change', truth: 'defect', variant: 'transient' },
  { id: 'ambiguous-result', family: 'unresolved', truth: 'unresolved', variant: 'ambiguous-result' },
  { id: 'ambiguous-control', family: 'unresolved', truth: 'unresolved', variant: 'ambiguous-control' },
  { id: 'missing-control', family: 'unresolved', truth: 'unresolved', variant: 'missing-control' },
  { id: 'cancel-before-start', family: 'unresolved', truth: 'unresolved', variant: 'cancel' },
  { id: 'required-ai-unavailable', family: 'unresolved', truth: 'unresolved', variant: 'ai-unavailable' },
  ...['text','value','checked','enabled','visible','hidden','count','url'].flatMap(kind=>normalAndFault(`assert-${kind}`)),
  ...normalAndFault('assert-css-visibility'),
  ...normalAndFault('assert-css-hidden-attribute'),
  ...normalAndFault('assert-css-visible-text'),
  {id:'assert-missing-hidden',family:'unresolved',truth:'unresolved',variant:'assert-missing'},
  {id:'assert-ambiguous-value',family:'unresolved',truth:'unresolved',variant:'assert-ambiguous'},
  {id:'assert-unsupported-control',family:'unresolved',truth:'unresolved',variant:'assert-unsupported'},
];

export function planFor(item, origin) {
  const path = `/case/${item.id}`;
  const job = {
    inspectionMode: 'journey', url: origin + path, title: item.id,
    requirement: 'Perform the specified action exactly once and verify the explicit visible result. Never infer success from action completion alone.',
    steps: [{ action: 'click', target: 'Apply change' }], expectedPath: path,
    expectedTexts: ['Saved record'], resultSelector: '#result', requireResultChange: true,
    maskSelectors: [], redactValues: [], cloudAiConsent: item.variant === 'ai-unavailable', reviewed: true,
  };
  if (item.family === 'line-breaks') { delete job.resultSelector; job.expectedTexts = ['Saved record', 'Version two']; job.requireResultChange = false; }
  if (item.family === 'save-reload') job.steps.push({ action: 'reload', target: path });
  if (item.family === 'select-calculation') {
    job.steps.unshift({ action: 'select', target: 'Quantity', value: '3' }); job.expectedTexts = ['Total 36000'];
  }
  if (item.family === 'form-validation') {
    job.steps.unshift({ action: 'fill', target: 'Display name', value: '  ' }); job.expectedTexts = ['Name required'];
  }
  if (item.family === 'history-navigation') {
    job.steps = [{ action: 'click', target: 'Open panel' }, { action: 'back', target: path }, { action: 'forward', target: path + '#panel' }];
    job.expectedPath += '#panel'; job.requireResultChange = false; job.expectedTexts = ['Panel ready'];
  }
  if (item.family === 'same-origin-popup') {
    job.steps = [{ action: 'click', target: 'Open preview' }]; job.expectedPath += '/preview'; job.requireResultChange = false;
  }
  if(item.family.startsWith('assert-')){
    const kind=item.family.slice(7);
    const assertions={text:{action:'assertText',target:'#condition',value:'Ready'},value:{action:'assertValue',target:'#field',value:'Original'},checked:{action:'assertChecked',target:'#flag',value:'true'},enabled:{action:'assertEnabled',target:'#control',value:'false'},visible:{action:'assertVisible',target:'#show'},hidden:{action:'assertHidden',target:'#hide'},count:{action:'assertCount',target:'.entry',value:'2'},url:{action:'assertUrl',target:path+'#ready'}};
    job.steps.unshift(kind==='css-visible-text'?{action:'assertText',target:'#css-target',value:'Continue'}:kind.startsWith('css-')?{action:'assertVisible',target:'#css-target'}:assertions[kind]);
    if(kind==='url')job.expectedPath+='#ready';
  }
  const unresolved={ 'assert-missing':{action:'assertHidden',target:'#missing'},'assert-ambiguous':{action:'assertValue',target:'.duplicate-field',value:'Original'},'assert-unsupported':{action:'assertChecked',target:'#condition',value:'false'}};
  if(unresolved[item.variant])job.steps.unshift(unresolved[item.variant]);
  return job;
}

export function htmlFor(item, preview = false) {
  if(item.family.startsWith('assert-')||item.variant.startsWith('assert-')){
    const faulty=item.variant==='fault',kind=item.family.slice(7);
    return `<!doctype html><html lang="en"><title>State contract fixture</title><body>
      <p id="condition">${kind==='text'&&faulty?'Wrong':'Ready'}</p>
      <input id="field" value="${kind==='value'&&faulty?'Wrong':'Original'}">
      <input id="flag" type="checkbox" ${kind==='checked'&&faulty?'':'checked'}>
      <button id="control" ${kind==='enabled'&&faulty?'':'disabled'}>Proceed</button>
      <p id="show" ${kind==='visible'&&faulty?'hidden':''}>Shown</p><p id="hide" ${kind==='hidden'&&faulty?'':'hidden'}>Hidden</p>
      <span class="entry"></span>${kind==='count'&&faulty?'':'<span class="entry"></span>'}
      ${kind==='css-visibility'?`<div style="visibility:hidden"><button id="css-target" style="visibility:${faulty?'hidden':'visible'}">Continue</button></div>`:''}
      ${kind==='css-hidden-attribute'?`<button id="css-target" hidden style="display:${faulty?'none':'block'}">Continue</button>`:''}
      ${kind==='css-visible-text'?`<div style="visibility:hidden"><p id="css-target" style="visibility:visible">${faulty?'Wrong':'Continue'}</p></div>`:''}
      <input class="duplicate-field" value="Original"><input class="duplicate-field" value="Original">
      <button id="apply">Apply change</button><p id="result">Waiting</p>
      <script>let writes=0;window.writeCount=()=>writes;document.querySelector('#apply').onclick=()=>{writes++;document.querySelector('#result').textContent='Saved record'};${kind==='url'?`history.replaceState(null,'',location.pathname+'#${faulty?'wrong':'ready'}');`:''}</script></body></html>`;
  }
  const fault = item.variant === 'fault';
  const expected = item.family === 'select-calculation' ? 'Total 36000' : item.family === 'form-validation' ? 'Name required' : 'Saved record';
  let output = fault ? 'Incorrect result' : expected;
  if (item.family === 'nested-inline') output = fault ? 'Incorrect <strong>result</strong>' : 'Saved <strong>record</strong>';
  if (item.family === 'display-contents') output = `<span style="display:contents">${output}</span>`;
  if (item.family === 'line-breaks') output += `<br>${fault ? 'Version wrong' : 'Version two'}`;
  if (item.variant === 'hidden') output = '<span hidden>Saved record</span>';
  if (item.variant === 'transparent') output = '<span style="opacity:0">Saved record</span>';
  let result = item.variant === 'noop' ? 'Saved record' : 'Waiting';
  if (preview) result = fault ? 'Incorrect result' : 'Saved record';
  const button = item.variant === 'missing-control' ? '' : '<button id="apply">Apply change</button>';
  const duplicate = item.variant === 'ambiguous-control' ? '<button>Apply change</button>' : item.variant === 'ambiguous-result' ? '<div id="result">Waiting</div>' : '';
  const extras = item.variant === 'decoy' ? '<p>Saved record</p>' : '';
  const script = `
    const result=document.querySelector('#result');
    let writes=0;window.writeCount=()=>writes;
    const family=${JSON.stringify(item.family)};const fault=${fault};
    if(family==='save-reload')result.textContent=sessionStorage.getItem('saved')||'Waiting';
    function apply(){
      writes++;
      if(${JSON.stringify(item.variant)}==='noop')return;
      let next=${JSON.stringify(item.variant === 'decoy' ? 'Incorrect result' : output)};
      if(family==='select-calculation')next='Total '+(Number(document.querySelector('select').value)*(fault?10000:12000));
      if(family==='form-validation')next=document.querySelector('input').value.trim()? 'Saved record':(fault?'Accepted invalid name':'Name required');
      const paint=()=>{result.innerHTML=next;
        if(family==='save-reload'&&!fault)sessionStorage.setItem('saved','Saved record');
        if(${JSON.stringify(item.variant)}==='transient')setTimeout(()=>result.textContent='Incorrect result',120);
      };
      if(family==='delayed-result')setTimeout(paint,1700);else paint();
    }
    document.querySelector('#apply')?.addEventListener('click',apply);
    function panel(){if(family==='history-navigation')result.textContent=location.hash?(fault?'Wrong panel':'Panel ready'):'Waiting';}
    addEventListener('hashchange',panel);panel();
  `;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Frozen contract fixture</title></head><body>
    <label for="quantity">Quantity</label><select id="quantity"><option>1</option><option>3</option></select>
    <label for="name">Display name</label><input id="name">
    ${button}<a href="#panel">Open panel</a><a href="/case/${item.id}/preview" target="_blank">Open preview</a>
    <div id="result">${result}</div>${duplicate}${extras}<script>${script}</script></body></html>`;
}
