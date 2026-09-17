// A new composition corpus, separate from both previous development corpora.
// Proposed truth must be checked by a human before engine measurement.
const click=target=>({action:'click',target});
const fill=(target,value)=>({action:'fill',target,value});
const text=(target,value)=>({action:'assertText',target,value});
const value=(target,value)=>({action:'assertValue',target,value});
const definitions=[
  {name:'Trim a draft title',requirement:'Saving trims leading and trailing spaces from the draft title.',
    html:'<label>Draft title<input id="input"></label><button id="go">Save draft</button><p id="out">Waiting</p>',
    script:bad=>`go.onclick=()=>out.textContent=${bad?'input.value+" extra"':'input.value.trim()'}`,
    steps:[fill('Draft title','  Alpha  '),click('Save draft'),text('#out','Alpha')],proof:'Enter two spaces, Alpha, two spaces. Save draft. Visible output must be exactly Alpha; extra suffix is a defect.'},
  {name:'Reset two independent fields',requirement:'Reset restores title Original and turns off the Optional setting.',
    html:'<label>Title<input id="input" value="Original"></label><label>Optional<input id="option" type="checkbox"></label><button id="go">Reset form</button>',
    script:bad=>`go.onclick=()=>{input.value='Original';${bad?'':'option.checked=false;'}}`,
    steps:[fill('Title','Changed'),{action:'check',target:'Optional'},click('Reset form'),value('#input','Original'),{action:'assertChecked',target:'#option',value:'false'}],proof:'Edit both fields before Reset. Both must return to defaults, not just the title.'},
  {name:'Bounded counter',requirement:'The displayed counter must stay at the maximum of 5 after two increments from 4.',
    html:'<p id="out">4</p><button id="go">Increase count</button>',script:bad=>`go.onclick=()=>out.textContent=${bad?'+out.textContent+1':'Math.min(5,+out.textContent+1)'}`,
    steps:[click('Increase count'),click('Increase count'),text('#out','5')],proof:'Read 4, click twice. 5 is correct; 6 violates the stated maximum.'},
  {name:'Decimal preview calculation',requirement:'Preview must calculate 2.5 times 4 as 10.00.',
    html:'<label>Rate<input id="input"></label><label>Units<input id="units"></label><button id="go">Calculate preview</button><p id="out">Waiting</p>',
    script:bad=>`go.onclick=()=>out.textContent=(${bad?'parseInt(input.value,10)':'Number(input.value)'}*Number(units.value)).toFixed(2)`,
    steps:[fill('Rate','2.5'),fill('Units','4'),click('Calculate preview'),text('#out','10.00')],proof:'This is arithmetic preview only. Decimal truncation produces 8.00 and is a defect.'},
  {name:'Dependent location options',requirement:'Selecting West and Refresh choices must offer exactly two cities, named Cedar and Delta.',
    html:'<label>Region<select id="region"><option>East</option><option>West</option></select></label><button id="go">Refresh choices</button><select id="cities" aria-label="City"><option>Birch</option></select>',
    script:bad=>`go.onclick=()=>cities.innerHTML=${JSON.stringify(bad?'<option>Cedar</option>':'<option>Cedar</option><option>Delta</option>')}`,
    steps:[{action:'select',target:'Region',value:'West'},click('Refresh choices'),{action:'assertCount',target:'#cities option',value:'2'},text('#cities option:first-child','Cedar'),text('#cities option:last-child','Delta')],proof:'Inspect the options after selecting West and refreshing. A single option is incomplete.'},
  {name:'Literal markup preview',requirement:'Preview must display the literal text <b>draft</b> without interpreting it as HTML.',
    html:'<label>Preview source<input id="input"></label><button id="go">Show preview</button><p id="out">Waiting</p>',
    script:bad=>`go.onclick=()=>out.${bad?'innerHTML':'textContent'}=input.value`,
    steps:[fill('Preview source','<b>draft</b>'),click('Show preview'),text('#out','<b>draft</b>')],proof:'Visible angle brackets must remain. Rendering bold draft loses the literal input.'},
  {name:'Undo a local draft change',requirement:'After Change preview then Undo preview, both text and input value must return to Original.',
    html:'<input id="input" aria-label="Draft" value="Original"><p id="out">Original</p><button id="go">Change preview</button><button id="undo">Undo preview</button>',
    script:bad=>`go.onclick=()=>{input.value='Changed';out.textContent='Changed'};undo.onclick=()=>{out.textContent='Original';${bad?'':'input.value="Original";'}}`,
    steps:[click('Change preview'),click('Undo preview'),text('#out','Original'),value('#input','Original')],proof:'Inspect both visible summary and editable field. Undo of the summary alone is insufficient.'},
  {name:'Stable alphabetical ordering',requirement:'Sort ascending must display Amber, Birch, Cedar in that exact order.',
    html:'<button id="go">Sort ascending</button><ol id="items"><li>Cedar</li><li>Amber</li><li>Birch</li></ol>',
    script:bad=>`go.onclick=()=>items.innerHTML=${JSON.stringify((bad?['Amber','Cedar','Birch']:['Amber','Birch','Cedar']).map(x=>'<li>'+x+'</li>').join(''))}`,
    steps:[click('Sort ascending'),text('#items li:nth-child(1)','Amber'),text('#items li:nth-child(2)','Birch'),text('#items li:nth-child(3)','Cedar')],proof:'All three positions matter; correct first item alone is not success.'},
  {name:'Empty input validation',requirement:'Validating an empty display name must show Name required and preserve the empty input.',
    html:'<label>Display name<input id="input"></label><button id="go">Validate preview</button><p id="out">Waiting</p>',
    script:bad=>`go.onclick=()=>out.textContent='${bad?'Accepted':'Name required'}'`,
    steps:[click('Validate preview'),text('#out','Name required'),value('#input','')],proof:'Do not type a name. Accepted on an empty required field violates the contract.'},
  {name:'Combined selection summary',requirement:'Checking both Email notices and SMS notices must produce Selected: 2.',
    html:'<label>Email notices<input id="first" type="checkbox"></label><label>SMS notices<input id="second" type="checkbox"></label><button id="go">Preview selection</button><p id="out">Waiting</p>',
    script:bad=>`go.onclick=()=>out.textContent='Selected: '+(${bad?'Number(first.checked)':'Number(first.checked)+Number(second.checked)'})`,
    steps:[{action:'check',target:'Email notices'},{action:'check',target:'SMS notices'},click('Preview selection'),text('#out','Selected: 2')],proof:'Both inputs are checked before preview. Counting only one is a defect.'},
  {name:'Units round trip',requirement:'Converting 100 centimeters to meters and back must restore 100 centimeters.',
    html:'<label>Length<input id="input" value="100"></label><button id="go">To meters</button><button id="back">To centimeters</button>',
    script:bad=>`go.onclick=()=>input.value=Number(input.value)/100;back.onclick=()=>input.value=Number(input.value)*${bad?'10':'100'}`,
    steps:[click('To meters'),value('#input','1'),click('To centimeters'),value('#input','100')],proof:'Check intermediate 1 and final 100. Final 10 indicates a scale error.'},
  {name:'Zero value preservation',requirement:'Saving the numeric value 0 must retain 0 rather than substitute the default 10.',
    html:'<label>Limit<input id="input"></label><button id="go">Save limit</button><p id="out">Waiting</p>',
    script:bad=>`go.onclick=()=>out.textContent=String(${bad?'Number(input.value)||10':'Number(input.value)'})`,
    steps:[fill('Limit','0'),click('Save limit'),text('#out','0')],proof:'Zero is explicitly allowed. A truthiness fallback to 10 violates this contract.'},
];
export function proposedCases(){
  const result=definitions.flatMap(def=>[false,true].map(bad=>({name:def.name,requirement:def.requirement,truth:bad?'defect':'normal',expected:bad?'failed':'passed',proof:def.proof,steps:def.steps,html:`<!doctype html><html lang="en"><meta charset="utf-8"><title>Review fixture</title><main><h1>${def.name}</h1>${def.html}<p id="stable">Fixture ready</p></main><script>${[...def.html.matchAll(/id="([a-z]+)"/g)].map(([,id])=>`const ${id}=document.getElementById('${id}');`).join('')}${def.script(bad)}</script></html>`})));
  for(const [name,html,steps,proof] of [
    ['Duplicate action labels','<button>Open preview</button><button>Open preview</button>',[click('Open preview')],'Two equally named buttons make the requested action ambiguous. No write may be guessed.'],
    ['Missing action target','<p>No preview control</p>',[click('Open preview')],'The named control is absent. The contract cannot be executed; this alone does not prove a site defect.'],
    ['Disabled action target','<button disabled>Open preview</button>',[click('Open preview')],'The control is disabled; the test has no contract saying it must be enabled. Report inconclusive.'],
    ['Nonunique result binding','<p id="stable">Fixture ready</p>',[],'Two result elements share the selector. Do not pick the first and report success.'],
  ])result.push({name,requirement:proof,truth:'unresolved',expected:'inconclusive',proof,steps,html:`<!doctype html><html lang="en"><meta charset="utf-8"><title>Review fixture</title><main><h1>${name}</h1>${html}<p id="stable">Fixture ready</p></main></html>`});
  return result;
}
