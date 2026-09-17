import privacy from '../../desktop/src/privacy.cjs';

// Redact page/user text without corrupting machine-readable protocol fields when
// a test value happens to be "on", "passed", "select", etc.
export function redactReport(report,secrets){
  const safe=privacy.redact(report,secrets);
  safe.status=report.status;safe.mode=report.mode;safe.engineVersion=report.engineVersion;
  safe.checks=report.checks.map((check,index)=>({...safe.checks[index],id:check.id,...(check.catalogId?{catalogId:check.catalogId}:{}),status:check.status}));
  safe.steps=report.steps.map((step,index)=>({...safe.steps[index],action:step.action,status:step.status}));
  if(report.contract)safe.contract.steps=report.contract.steps.map((step,index)=>({...safe.contract.steps[index],action:step.action}));
  // These entries contain only the versioned catalog, never page-derived text.
  safe.scope={...safe.scope,catalogVersion:report.scope.catalogVersion,items:report.scope.items};
  return safe;
}
