// Export the already-redacted report only; never read the form or invitation key.
export function reproductionMarkdown(report) {
  const literal=value=>JSON.stringify(value??null).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/`/g,'\\u0060');
  const steps=report.contract?.steps || report.steps || [];
  const findings=(report.checks||[]).filter(check=>check.status!=='passed'&&check.status!=='not_applicable');
  return ['# RepliQA 재현 보고서','',`판정: ${literal(report.status)}`,`실행기: ${literal(report.engineVersion)}`,`검사 방식: ${literal(report.mode)}`,
    `시작 주소: ${literal(report.contract?.url)}`,`관측 주소: ${literal(report.finalUrl)}`,'',
    '## 지정한 조건',literal(report.contract?.requirement),`최종 경로: ${literal(report.contract?.expectedPath)}`,`최종 문구: ${literal(report.contract?.expectedTexts)}`,'',
    '## 재현 순서',...steps.map((step,index)=>`${index+1}. ${literal(step.action)} / ${literal(step.target)}${step.value!==undefined?' / '+literal(step.value):''} — ${literal(report.steps?.[index]?.status||'not_run')}`),'',
    '## 관측 근거',...findings.map(check=>`- ${literal(check.title)}: ${literal(check.status)}\n  ${literal(check.message)}\n  ${literal(check.evidence)}`),'',
    '## 확인 범위','단일 실행의 관측입니다. 반복 재현 여부·원인·심각도는 확정하지 않았습니다. 마스킹된 입력값은 합성 테스트 데이터로 다시 준비해야 합니다.',
    report.error?`실행 중단: ${literal(report.error)}`:'',
    ...((report.scope?.items||[]).filter(item=>item.status==='not_tested').map(item=>`- 미검사: ${literal(item.title)}`)),
    '','전체 사이트 검사 완료 또는 전체 접근성 적합성을 의미하지 않습니다.',''].join('\n');
}
