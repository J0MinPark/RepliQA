import actions from '../../backend/src/design/actions.js';
import flow from '../../desktop/src/browser-flow.cjs';
import privacy from '../../desktop/src/privacy.cjs';
import { LIMITS, jobStatus } from './schema.mjs';
import { performStep } from './actions.mjs';
import { basicChecks } from './basic-checks.mjs';
import { checkOutcomes, readResult } from './outcomes.mjs';
import { coverageFor } from '../public/qa-catalog.js';
import { redactReport } from './report.mjs';
import { assertionActions, checkStep } from './assertions.mjs';

export async function runBrowser(job, { launch, guard, signal, onStep = async () => {}, review }) {
  const started = Date.now(); let browser; let timer; let page; let networkGuard;
  const secrets = [...job.redactValues, ...job.steps.filter((step) => ['fill','assertValue'].includes(step.action) || step.sensitive).map((step) => step.value).filter(Boolean)];
  const report = { title: job.title, status: 'inconclusive', checks: [], steps: [], ai: null, coverage: { browser: false, deterministic: false, ai: false }, mode: job.inspectionMode==='basic'?'automatic-basic':job.cloudAiConsent ? 'cloud-ai' : 'browser-contracts',engineVersion:'0.2.6' };
  report.contract = { url: job.url, requirement: job.requirement, expectedPath: job.expectedPath, expectedTexts: job.expectedTexts, resultSelector: job.resultSelector, requireResultChange: job.requireResultChange, steps: job.steps.map(step => ({...step})) };
  let screenshot;
  const stop = () => { networkGuard?.finish?.(); void browser?.close().catch(() => {}); };
  signal?.addEventListener('abort', stop, { once: true });
  try {
    signal?.throwIfAborted();
    // A launch resolving after cancellation must also be closed.
    browser = await launch(); signal?.throwIfAborted();
    timer = setTimeout(stop, LIMITS.browserMs - (Date.now() - started));
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block', acceptDownloads: false });
    networkGuard = await guard(context);
    page = await context.newPage(); page.setDefaultTimeout(5000); page.setDefaultNavigationTimeout(15000);
    const errors = [];
    const watch = (p) => p.on('pageerror', (error) => errors.push(error.message.slice(0, 400)));
    watch(page); context.on('page', watch);
    const response = await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    if (response?.status() >= 400 && job.inspectionMode!=='basic') throw new Error(`HTTP ${response.status()}`);
    const before=job.requireResultChange?await readResult(page,job.resultSelector):null;
    if (before?.ambiguous)throw new Error('동작 전에 결과 영역을 하나로 특정하지 못했습니다.');
    secrets.push(...await privacy.selectorValues(page, job.maskSelectors));
    const executeStep = async (current, step) => {
      page = current;
      if (networkGuard?.blockedRequests||networkGuard?.failedRequests) throw new Error('네트워크 제한 또는 요청 실패로 다음 동작을 중단했습니다.');
      if (!assertionActions.includes(step.action)) return performStep(current,step);
      const check = await checkStep(current,step,signal); check.id = `assertion-${report.steps.length}`;
      report.checks.push(check);
      if (check.status !== 'passed') { const error = new Error(check.message); error.assertionStatus = check.status; throw error; }
    };
    const observed = await flow.executeFlow(page, job.steps, { performStep: executeStep, origin: new URL(job.url).origin, signal,
      onStep: async (step) => { report.steps.push(step); await onStep(privacy.redact(step,secrets)); } });
    page = observed.page; report.scrolls = observed.scrolls;
    if(job.inspectionMode==='basic')report.checks.push(...await basicChecks(page,response,signal));
    else {
      report.checks.push({...await flow.checkFinalPath(page,job.expectedPath,job.url),catalogId:'outcome'});
      report.checks.push(...await checkOutcomes(page,job,before,signal));
    }
    const dom = job.cloudAiConsent ? await actions.captureDesignDom(page) : null;
    secrets.push(...await privacy.selectorValues(page, job.maskSelectors));
    report.checks.push({id:'runtime',catalogId:'runtime',title:'브라우저 오류 신호',status:errors.length?'review':'passed',evidence:{count:errors.length},message:errors.length?'오류 신호가 있습니다. 업무 기능에 미친 영향은 별도 확인합니다.':'관측 시간 동안 JavaScript 오류 이벤트가 없었습니다.'});
    for (const [index, message] of errors.entries()) report.checks.push({ id: `js-${index}`,catalogId:'runtime',title:'브라우저 오류 검토 후보',message,status:'review' });
    report.finalUrl = page.url(); report.coverage.browser = true; report.coverage.deterministic = !report.checks.some((item) => item.status === 'inconclusive');
    screenshot = await privacy.screenshotMasked(page, { selectors: [...job.maskSelectors, 'iframe'], secrets, type: 'jpeg' });
    if (screenshot.byteLength > 700000) { screenshot = null; throw new Error('마스킹된 화면이 저장 용량 제한을 초과했습니다.'); }
    networkGuard?.finish?.();await browser.close(); browser = null; clearTimeout(timer);
    if (job.cloudAiConsent) {
      signal?.throwIfAborted();
      if (!review) throw new Error('클라우드 AI 연결이 활성화되지 않았습니다.');
      report.ai = await review(privacy.redact({ requirement: job.requirement, expectedPath: job.expectedPath, expectedTexts: job.expectedTexts, texts: dom.texts.slice(0, 100), checks: report.checks }, secrets), screenshot);
      report.coverage.ai = report.ai.reviewed === true;
    }
    report.status = jobStatus(report.checks, report.ai, job.cloudAiConsent);
  } catch (error) {
    if(error.check)report.checks.push({...error.check,catalogId:error.check.catalogId||'history'});
    report.error = signal?.aborted ? '검사가 취소되었거나 제한 시간을 초과했습니다.' : error.message;
    report.status = report.checks.some((item) => item.status === 'failed') ? 'failed' : 'inconclusive';
    if (error.assertionStatus) report.steps.push({index:report.steps.length,action:job.steps[report.steps.length].action,target:job.steps[report.steps.length].target,status:error.assertionStatus,message:error.message});
    if (page && browser && !signal?.aborted) {
      try {
        secrets.push(...await privacy.selectorValues(page,job.maskSelectors));
        report.finalUrl=page.url();
        screenshot=await privacy.screenshotMasked(page,{selectors:[...job.maskSelectors,'iframe'],secrets,type:'jpeg'});
        if(screenshot.byteLength>700000)screenshot=null;
      } catch { report.evidenceUnavailable=true; }
    }
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', stop); networkGuard?.finish?.();await browser?.close().catch(() => {});
  }
  if(networkGuard)report.network={blockedRequests:networkGuard.blockedRequests||0,failedRequests:networkGuard.failedRequests||0,cancelledAtShutdown:networkGuard.cancelledAtShutdown||0};
  if (networkGuard?.blockedRequests||networkGuard?.failedRequests) {
    // A restricted dependency can cause a false functional mismatch.
    // Preserve the observations, but never label that run as a verified defect or pass.
    for (const item of [...report.checks, ...report.steps]) if (item.status === 'failed') { item.observedStatus = 'failed'; item.status = 'inconclusive'; }
    report.checks.push({id:'network-policy',catalogId:'runtime',title:'네트워크 제한 또는 요청 실패',status:'inconclusive',evidence:{blockedRequests:networkGuard.blockedRequests||0,failedRequests:networkGuard.failedRequests||0,events:networkGuard.events||[]},message:'정책 차단 또는 실행 중 네트워크 요청 실패가 있어 기능 결함이나 정상 동작으로 확정하지 않습니다.'});
    report.status = 'inconclusive'; report.coverage.deterministic = false;
  }
  const completed=report.steps.length;
  const stoppedAtAssertion=report.steps.some(step=>step.status!=='passed');
  for(let index=completed;index<job.steps.length;index++)report.steps.push({index,action:job.steps[index].action,target:job.steps[index].target,status:index===completed&&!stoppedAtAssertion?'inconclusive':'not_run',message:index===completed&&!stoppedAtAssertion?'이 동작의 완료 근거를 확보하지 못했습니다.':'앞 단계 중단으로 실행하지 않았습니다.'});
  report.scope=coverageFor(job,report.checks,report.steps);
  report.durationMs = Date.now() - started;
  return { report: redactReport(report, secrets), screenshot };
}
