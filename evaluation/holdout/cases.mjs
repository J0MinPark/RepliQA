// New fixtures: no imports from the development corpus or production judges.
// Truth is fixed by the explicit user contract, not another agent's verdict.
export const cases = ['preferences', 'filter', 'pagination', 'accordion', 'dialog', 'tabs', 'empty-list', 'query-route', 'async-state', 'radio-choice'].flatMap(family => ['normal', 'defect'].map(truth => ({id:`${family}-${truth}`,family,truth})));
export function fixture(item) {
  const bad=item.truth==='defect';
  const fragments={
    preferences:['<input id="toggle" type="checkbox"><label for="toggle">Notifications</label><button id="go">Save preference</button>',`document.querySelector('#go').onclick=()=>{localStorage.setItem('enabled',${bad?'false':"document.querySelector('#toggle').checked"});location.reload()};document.querySelector('#toggle').checked=localStorage.getItem('enabled')==='true'`],
    filter:['<label>Filter<input id="query"></label><button id="go">Apply filter</button><ul id="items"><li>Alpha</li><li>Beta</li></ul>',`document.querySelector('#go').onclick=()=>{document.querySelector('#items').innerHTML=${JSON.stringify(bad?'<li>Alpha</li><li>Beta</li>':'<li>Beta</li>')}}`],
    pagination:['<button id="go">Next page</button><p id="page">Page 1</p>',`document.querySelector('#go').onclick=()=>{document.querySelector('#page').textContent='Page ${bad?1:2}'}`],
    accordion:['<button id="go">Details</button><div id="panel" hidden>Expanded content</div>',`document.querySelector('#go').onclick=()=>{document.querySelector('#panel').hidden=${bad}}`],
    dialog:['<button id="go">Close dialog</button><section id="dialog">Dialog content</section>',`document.querySelector('#go').onclick=()=>{document.querySelector('#dialog').hidden=${!bad}}`],
    tabs:['<button id="go">Settings tab</button><input id="setting" value="Initial" aria-label="Setting">',`document.querySelector('#go').onclick=()=>{document.querySelector('#setting').value='${bad?'Initial':'Configured'}'}`],
    'empty-list':['<button id="go">Clear filters</button><ul id="items"><li>Temporary filter</li></ul>',`document.querySelector('#go').onclick=()=>{${bad?'':"document.querySelector('#items').replaceChildren()"}}`],
    'query-route':['<button id="go">Open results</button>',`document.querySelector('#go').onclick=()=>history.pushState(null,'',location.pathname+'?view=${bad?'wrong':'results'}#list')`],
    'async-state':['<button id="go">Prepare preview</button><button id="ready" disabled>Continue preview</button>',`document.querySelector('#go').onclick=()=>setTimeout(()=>document.querySelector('#ready').disabled=${bad},350)`],
    'radio-choice':['<input id="one" name="choice" type="radio" checked><label for="one">First option</label><input id="two" name="choice" type="radio"><label for="two">Second option</label>',bad?"document.querySelector('#two').onclick=()=>{document.querySelector('#one').checked=true}":''],
  };
  const [html,script]=fragments[item.family];
  return `<!doctype html><html lang="en"><title>Holdout ${item.family}</title><body><main><h1>Contract fixture</h1>${html}<p id="stable">Fixture ready</p></main><script>${script}</script></body></html>`;
}
export function plan(item,origin) {
  const path='/holdout/'+item.id;
  const click=target=>({action:'click',target});
  const contracts={
    preferences:[{action:'check',target:'Notifications'},click('Save preference'),{action:'assertChecked',target:'#toggle',value:'true'}],
    filter:[{action:'fill',target:'Filter',value:'Beta'},click('Apply filter'),{action:'assertCount',target:'#items li',value:'1'},{action:'assertText',target:'#items',value:'Beta'}],
    pagination:[click('Next page'),{action:'assertText',target:'#page',value:'Page 2'}],
    accordion:[click('Details'),{action:'assertVisible',target:'#panel'}],
    dialog:[click('Close dialog'),{action:'assertHidden',target:'#dialog'}],
    tabs:[click('Settings tab'),{action:'assertValue',target:'#setting',value:'Configured'}],
    'empty-list':[click('Clear filters'),{action:'assertCount',target:'#items li',value:'0'}],
    'query-route':[click('Open results'),{action:'assertUrl',target:path+'?view=results#list'}],
    'async-state':[click('Prepare preview'),{action:'assertEnabled',target:'#ready',value:'true'}],
    'radio-choice':[{action:'check',target:'Second option'},{action:'assertChecked',target:'#two',value:'true'}],
  };
  return {inspectionMode:'journey',url:origin+path,title:item.id,requirement:'Perform the named workflow and verify every explicit condition.',steps:contracts[item.family],expectedPath:path+(item.family==='query-route'?'?view=results#list':''),expectedTexts:['Fixture ready'],resultSelector:'#stable',reviewed:true};
}
