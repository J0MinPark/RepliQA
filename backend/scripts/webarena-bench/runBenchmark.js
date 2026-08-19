// WebArena 태스크 서브셋(tasks.subset.json)을 RepliQA 엔진(runTest)으로 직접 실행하고,
// WebArena 공식 채점 알고리즘(evalWebArena.js)으로 독립적으로 채점해서 Success Rate를 낸다.
//
// "독립적으로"가 중요하다 — RepliQA 자신의 checkpoint 성공/실패 판단이나 generateReport의
// severity를 신뢰하지 않고, 매 태스크가 끝난 뒤 별도의 새 브라우저 세션으로 WebArena
// evaluators.py와 동일한 알고리즘을 다시 돌려서 채점한다(자기 성적표를 자기가 매기지 않게).
//
// 사용법(backend/ 디렉터리에서 실행):
//   node scripts/webarena-bench/runBenchmark.js
// 사전 준비: README.md의 Docker 셋업 + login.js 실행 필요.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { runTest } = require('../../src/engine/runEngine');
const { PERSONAS } = require('../../src/personas/definitions');
const { gradeTask } = require('./evalWebArena');

const SHOPPING_ADMIN_URL = process.env.SHOPPING_ADMIN_URL || 'http://localhost:7780/admin';
const REDDIT_URL = process.env.REDDIT_URL || 'http://localhost:9999';
const MAX_ACTIONS_PER_TASK = parseInt(process.env.WEBARENA_MAX_ACTIONS || '15', 10);

const AUTH_DIR = path.join(__dirname, '.auth');
const RESULTS_DIR = path.join(__dirname, 'results');

const SITE_CONFIG = {
  shopping_admin: { baseUrl: SHOPPING_ADMIN_URL, authFile: 'shopping_admin_state.json' },
  reddit: { baseUrl: REDDIT_URL, authFile: 'reddit_state.json' },
};

// login.js와 같은 필터 — 사이트 이미지를 일부만(용량 문제로) 받은 경우, 안 받은 사이트의
// 태스크는 어차피 접속조차 안 되므로 처음부터 건너뛴다. 기본값(env 없음)은 전체.
const SITES = (process.env.WEBARENA_SITES || 'shopping_admin,reddit').split(',').map((s) => s.trim());

function resolvePlaceholders(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/__SHOPPING_ADMIN__/g, SHOPPING_ADMIN_URL).replace(/__REDDIT__/g, REDDIT_URL);
}

function resolveTaskUrls(task) {
  return {
    ...task,
    start_url: resolvePlaceholders(task.start_url),
    eval: {
      ...task.eval,
      reference_url: resolvePlaceholders(task.eval.reference_url),
      program_html: (task.eval.program_html || []).map((p) => ({ ...p, url: resolvePlaceholders(p.url) })),
    },
  };
}

async function runOneTask(rawTask, standardPersona) {
  const task = resolveTaskUrls(rawTask);
  const site = task.sites[0];
  const { baseUrl, authFile } = SITE_CONFIG[site];
  const savedSessionState = JSON.parse(fs.readFileSync(path.join(AUTH_DIR, authFile), 'utf-8'));

  const record = { task_id: task.task_id, site, intent: task.intent, start_url: task.start_url };

  let engineResult;
  try {
    engineResult = await runTest({
      tenantId: 'webarena-bench',
      runId: `webarena-task-${task.task_id}`,
      targetUrl: task.start_url,
      persona: standardPersona,
      checkpoints: [{ index: 0, goal: task.intent, type: 'generic', verify: null }],
      allowPrivateTargets: true,
      browserEngine: 'chromium',
      maxActionsPerCheckpoint: MAX_ACTIONS_PER_TASK,
      savedSessionState,
    });
  } catch (err) {
    record.engineError = err.message;
    record.score = 0;
    return record;
  }

  record.finalUrl = engineResult.finalUrl;
  record.haltedAtCheckpoint = engineResult.haltedAtCheckpoint;
  record.repliqaSeverity = engineResult.severity;
  record.totalActions = engineResult.summary?.totalActions;

  // 채점은 runTest()가 쓴 브라우저와 무관한 새 세션으로 — WebArena 원본 평가 방식(트레일러
  // 종료 후 독립적으로 재확인)과 동일하게 맞춘다.
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ storageState: savedSessionState });
    const page = await context.newPage();
    try {
      record.score = await gradeTask(task, { page, finalUrl: engineResult.finalUrl });
    } catch (err) {
      record.gradeError = err.message;
      record.score = 0;
    }
  } finally {
    await browser.close();
  }

  return record;
}

async function main() {
  const allTasks = JSON.parse(fs.readFileSync(path.join(__dirname, 'tasks.subset.json'), 'utf-8'));
  const tasks = allTasks.filter((t) => SITES.includes(t.sites[0]));
  const standardPersona = PERSONAS.find((p) => p.id === 'standard');
  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  const results = [];
  for (const [i, task] of tasks.entries()) {
    process.stdout.write(`[${i + 1}/${tasks.length}] task_id=${task.task_id} (${task.sites[0]}) "${task.intent}" ... `);
    const record = await runOneTask(task, standardPersona);
    results.push(record);
    console.log(record.score === 1 ? 'PASS' : `FAIL${record.engineError ? ` (엔진 오류: ${record.engineError})` : ''}`);
  }

  const passed = results.filter((r) => r.score === 1).length;
  const successRate = passed / results.length;

  const summary = {
    ranAt: new Date().toISOString(),
    totalTasks: results.length,
    passed,
    successRate,
    bySite: {},
  };
  for (const site of Object.keys(SITE_CONFIG)) {
    const siteResults = results.filter((r) => r.site === site);
    const sitePassed = siteResults.filter((r) => r.score === 1).length;
    summary.bySite[site] = { total: siteResults.length, passed: sitePassed, successRate: siteResults.length ? sitePassed / siteResults.length : null };
  }

  const outPath = path.join(RESULTS_DIR, `run-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ summary, results }, null, 2));

  console.log('\n=== WebArena 서브셋 벤치마크 결과 ===');
  console.log(`Success Rate: ${passed}/${results.length} = ${(successRate * 100).toFixed(1)}%`);
  for (const [site, s] of Object.entries(summary.bySite)) {
    console.log(`  ${site}: ${s.passed}/${s.total} = ${s.successRate == null ? 'N/A' : (s.successRate * 100).toFixed(1) + '%'}`);
  }
  console.log(`상세 결과: ${outPath}`);
}

main().catch((err) => {
  console.error('벤치마크 실행 실패:', err);
  process.exit(1);
});
