export function interval95(successes, total) {
  if (!total) return null;
  const z = 1.959963984540054, p = successes / total, d = 1 + z*z/total;
  const center = (p + z*z/(2*total))/d;
  const half = z*Math.sqrt(p*(1-p)/total + z*z/(4*total*total))/d;
  return [Math.max(0,center-half),Math.min(1,center+half)];
}
export function summarize(rows) {
  const normal=rows.filter(r=>r.truth==='normal'), defect=rows.filter(r=>r.truth==='defect');
  const tp=defect.filter(r=>r.status==='failed').length, fp=normal.filter(r=>r.status==='failed').length;
  const fn=defect.length-tp, tn=normal.filter(r=>r.status==='passed').length;
  const unresolved=rows.filter(r=>r.status==='inconclusive').length;
  const timed=rows.map(r=>r.durationMs).sort((a,b)=>a-b);
  const q=p=>timed.length?timed[Math.max(0,Math.ceil(timed.length*p)-1)]:null;
  return { runs:rows.length, uniqueCases:new Set(rows.map(r=>r.id)).size, normal:normal.length, defects:defect.length,
    tp,fp,fn,tn, unresolved, review:rows.filter(r=>r.status==='review').length,
    falsePasses:rows.filter(r=>r.truth!=='normal'&&r.status==='passed').length,
    normalUnresolved:normal.filter(r=>r.status==='inconclusive').length,
    precision:tp+fp?tp/(tp+fp):null, recall:defect.length?tp/defect.length:null,
    recallWilson95:interval95(tp,defect.length), p50Ms:q(.5),p95Ms:q(.95),
  };
}
