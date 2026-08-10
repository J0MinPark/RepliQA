const { chromium } = require('playwright');
const { captureState } = require('./capture');
const { executeAction, attachErrorCollectors, centerOf } = require('./executor');
const { runObjectiveChecks } = require('./uiuxChecks');
const geminiAdapter = require('./llm/geminiAdapter');
const { bucket } = require('../db/firestore');
const { assertHttpUrl, resolveSafeIp } = require('../security/ssrfGuard');

async function uploadScreenshot(tenantId, runId, label, buffer) {
  const path = `tenants/${tenantId}/testRuns/${runId}/${label}.jpg`;
  await bucket.file(path).save(buffer, { contentType: 'image/jpeg' });
  return path;
}

// 실 사용자 비밀번호를 LLM에 절대 보여주지 않는다 — "어떤 요소가 로그인 필드인지"만
// 비전 모델에게 묻고, 실제 문자열 입력은 서버가 직접 수행한다.
async function attemptLogin(page, credentials) {
  const state = await captureState(page);
  const plan = await geminiAdapter.identifyLoginFields({
    screenshotBase64: state.screenshotBase64,
    elements: state.elements.map(({ index, tag, role, text, box }) => ({ index, tag, role, text, box })),
  });

  if (plan.usernameIndex == null || plan.passwordIndex == null) {
    return { attempted: false };
  }

  const usernameEl = state.elements[plan.usernameIndex];
  const passwordEl = state.elements[plan.passwordIndex];
  if (!usernameEl || !passwordEl) return { attempted: false };

  const u = centerOf(usernameEl.box);
  await page.mouse.click(u.x, u.y);
  await page.keyboard.type(credentials.username, { delay: 20 });

  const p = centerOf(passwordEl.box);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.type(credentials.password, { delay: 20 });

  const submitEl = plan.submitIndex != null ? state.elements[plan.submitIndex] : null;
  if (submitEl) {
    const s = centerOf(submitEl.box);
    await page.mouse.click(s.x, s.y);
    await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
  }
  return { attempted: true };
}

function toPromptElements(elements) {
  return elements.map(({ index, tag, role, text, box }) => ({ index, tag, role, text, box }));
}

// 체크포인트(여정 단계) 하나를 처리한다: 진입 시 UI/UX 1회 평가 → 목표 달성까지
// capture→plan→execute 루프를 maxActionsPerCheckpoint까지 반복.
// routeId 없이 실행된 자유 탐색도 "goal: null인 체크포인트 1개"로 동일하게 흐른다.
async function runCheckpoint({
  page,
  context,
  tenantId,
  runId,
  checkpoint,
  persona,
  maxActionsPerCheckpoint,
  collectedErrors,
  onStep,
  onUiuxFindings,
}) {
  const entryState = await captureState(page);
  const objectiveFindings = await runObjectiveChecks(page).catch((err) => {
    collectedErrors.push(`[UIUX Objective Check Error] ${err.message}`);
    return [];
  });
  const uiuxResult = await geminiAdapter
    .evaluateUiUx({
      screenshotBase64: entryState.screenshotBase64,
      elements: toPromptElements(entryState.elements),
      objectiveFindings,
      checkpointGoal: checkpoint.goal,
    })
    .catch((err) => {
      collectedErrors.push(`[UIUX Eval Error] ${err.message}`);
      return { findings: [] };
    });

  const entryScreenshotPath = await uploadScreenshot(
    tenantId,
    runId,
    `checkpoint-${checkpoint.index}-entry`,
    entryState.screenshotBuffer
  ).catch((err) => {
    collectedErrors.push(`[Storage Error] 스크린샷 업로드 실패: ${err.message}`);
    return null;
  });

  if (onUiuxFindings) {
    await onUiuxFindings(checkpoint.index, {
      findings: [...objectiveFindings, ...(uiuxResult.findings || [])],
      screenshotPath: entryScreenshotPath,
    });
  }

  let done = false;
  let offline = false;
  let stepInCheckpoint = 0;
  const history = [];
  const steps = [];

  while (!done && stepInCheckpoint < maxActionsPerCheckpoint) {
    stepInCheckpoint += 1;

    if (persona.networkChaos) {
      offline = !offline;
      await context.setOffline(offline);
    }

    const state = stepInCheckpoint === 1 ? entryState : await captureState(page);
    const plan = await geminiAdapter.generateNextAction({
      screenshotBase64: state.screenshotBase64,
      elements: toPromptElements(state.elements),
      personaPrompt: persona.systemPromptTemplate,
      checkpointGoal: checkpoint.goal,
      history,
      stepNumber: stepInCheckpoint,
      maxActions: maxActionsPerCheckpoint,
    });

    const execResult = await executeAction(page, plan.action, state.elements);
    const screenshotPath =
      stepInCheckpoint === 1
        ? entryScreenshotPath
        : await uploadScreenshot(
            tenantId,
            runId,
            `checkpoint-${checkpoint.index}-step-${stepInCheckpoint}`,
            state.screenshotBuffer
          ).catch((err) => {
            collectedErrors.push(`[Storage Error] 스크린샷 업로드 실패: ${err.message}`);
            return null;
          });

    const step = {
      stepNumber: stepInCheckpoint,
      thought: plan.thought || '',
      action: plan.action || null,
      execOk: execResult.ok,
      execError: execResult.error || null,
      screenshotPath,
      timestamp: new Date().toISOString(),
    };
    history.push({ thought: step.thought, action: step.action });
    steps.push(step);
    if (onStep) await onStep(checkpoint.index, step);

    done = Boolean(plan.done) || plan.action?.type === 'finish';
    await page.waitForTimeout(300);
  }

  if (persona.networkChaos && offline) {
    await context.setOffline(false);
  }

  return { done, steps };
}

// checkpoints를 순서대로 처리한다. 하나가 예산 안에 끝나지 못하면(done=false) 그 지점에서
// 런을 중단한다 — 로그인이 안 되는데 결제 체크포인트를 계속 시도해봐야 의미 있는 신호가
// 아니고, "어디서 막혔는지" 자체가 리포트의 핵심 가치이기 때문.
async function runTest({
  tenantId,
  runId,
  targetUrl,
  persona,
  checkpoints,
  maxActionsPerCheckpoint,
  credentials,
  onCheckpointStatus,
  onStep,
  onUiuxFindings,
}) {
  assertHttpUrl(targetUrl);
  const hostname = new URL(targetUrl).hostname;
  const pinnedIp = await resolveSafeIp(hostname);

  // 검증 시점 이후 DNS가 바뀌어도(리바인딩) 실행 시점에 확인한 IP로만 붙게 고정한다.
  const browser = await chromium.launch({
    headless: true,
    args: [`--host-resolver-rules=MAP ${hostname} ${pinnedIp}`],
  });

  const collectedErrors = [];
  const allSteps = [];
  let haltedAtCheckpoint = null;

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    attachErrorCollectors(page, collectedErrors);

    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

    if (credentials) {
      await attemptLogin(page, credentials).catch((err) => {
        collectedErrors.push(`[Login Error] ${err.message}`);
      });
    }

    for (const checkpoint of checkpoints) {
      if (onCheckpointStatus) await onCheckpointStatus(checkpoint.index, 'running');

      const result = await runCheckpoint({
        page,
        context,
        tenantId,
        runId,
        checkpoint,
        persona,
        maxActionsPerCheckpoint,
        collectedErrors,
        onStep,
        onUiuxFindings,
      });

      allSteps.push(...result.steps.map((s) => ({ ...s, checkpointIndex: checkpoint.index })));

      if (!result.done) {
        if (onCheckpointStatus) await onCheckpointStatus(checkpoint.index, 'failed');
        haltedAtCheckpoint = checkpoint.index;
        break;
      }
      if (onCheckpointStatus) await onCheckpointStatus(checkpoint.index, 'completed');
    }

    const report = await geminiAdapter.generateReport({ errors: collectedErrors, steps: allSteps });

    return {
      collectedErrors,
      haltedAtCheckpoint,
      summary: { totalErrors: collectedErrors.length, totalActions: allSteps.length },
      vibeCoderPrompt: report.vibe_coder_prompt,
      errorAnalysis: report.error_analysis,
    };
  } finally {
    await browser.close();
  }
}

module.exports = { runTest };
