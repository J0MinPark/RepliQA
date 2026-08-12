const { captureState } = require('./capture');
const { executeAction, attachErrorCollectors, centerOf } = require('./executor');
const { runObjectiveChecks } = require('./uiuxChecks');
const { isPaymentSubmitElement } = require('./paymentSafety');
const { launchBrowser } = require('./browserEngines');
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

// 로그인과 같은 원칙: 실제 카드번호/CVC 값은 LLM에 절대 보여주지 않는다 — 필드 "위치"만
// 물어보고 실제 입력은 서버가 한다. 제출 버튼은 여기서 누르지 않는다(안전핀은 상위
// 루프에서 별도로 처리) — 입력까지만 하고 그다음 판단은 정상 페르소나 루프에 맡긴다.
async function attemptPaymentFill(page, paymentInfo) {
  const state = await captureState(page);
  const plan = await geminiAdapter.identifyPaymentFields({
    screenshotBase64: state.screenshotBase64,
    elements: state.elements.map(({ index, tag, role, text, box }) => ({ index, tag, role, text, box })),
  });

  const fieldMap = [
    ['cardNumberIndex', 'cardNumber'],
    ['expiryIndex', 'expiry'],
    ['cvcIndex', 'cvc'],
    ['birthOrBusinessIndex', 'birthOrBusinessNo'],
    ['cardHolderNameIndex', 'cardHolderName'],
  ];

  let filledAny = false;
  for (const [indexKey, valueKey] of fieldMap) {
    const idx = plan[indexKey];
    const value = paymentInfo[valueKey];
    if (idx == null || !value) continue;
    const el = state.elements[idx];
    if (!el) continue;
    const c = centerOf(el.box);
    await page.mouse.click(c.x, c.y);
    await page.keyboard.type(value, { delay: 20 });
    filledAny = true;
  }
  return { attempted: filledAny };
}

function toPromptElements(elements) {
  return elements.map(({ index, tag, role, text, box, options }) => ({
    index,
    tag,
    role,
    text,
    box,
    ...(options ? { options } : {}),
  }));
}

// 체크포인트(여정 단계) 하나를 처리한다: 진입 시 UI/UX 1회 평가 → (결제 단계면 테스트
// 결제정보 자동입력) → 목표 달성까지 capture→plan→execute 루프를 maxActionsPerCheckpoint까지
// 반복. routeId 없이 실행된 자유 탐색도 "goal: null인 체크포인트 1개"로 동일하게 흐른다.
async function runCheckpoint({
  page,
  context,
  tenantId,
  runId,
  checkpoint,
  persona,
  paymentInfo,
  maxActionsPerCheckpoint,
  collectedErrors,
  onStep,
  onUiuxFindings,
}) {
  const isPayment = checkpoint.type === 'payment';

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

  // 결제 위젯은 팝업(새 탭)이나 iframe으로 뜨는 경우가 흔하다. 팝업이 열리면 이후
  // capture/execute 대상을 그 팝업으로 전환한다(iframe은 capture.js가 알아서 훑는다).
  let activePage = page;
  let popupListener = null;
  if (isPayment) {
    popupListener = (newPage) => {
      activePage = newPage;
      attachErrorCollectors(newPage, collectedErrors);
      newPage.on('close', () => {
        if (activePage === newPage) activePage = page;
      });
    };
    context.on('page', popupListener);

    if (paymentInfo) {
      await attemptPaymentFill(activePage, paymentInfo).catch((err) => {
        collectedErrors.push(`[Payment Fill Error] ${err.message}`);
      });
    }
  }

  let done = false;
  let offline = false;
  let stepInCheckpoint = 0;
  const history = [];
  const steps = [];

  try {
    while (!done && stepInCheckpoint < maxActionsPerCheckpoint) {
      stepInCheckpoint += 1;

      if (persona.networkChaos) {
        offline = !offline;
        await context.setOffline(offline);
      }

      const state = stepInCheckpoint === 1 && activePage === page ? entryState : await captureState(activePage);
      const plan = await geminiAdapter.generateNextAction({
        screenshotBase64: state.screenshotBase64,
        elements: toPromptElements(state.elements),
        personaPrompt: persona.systemPromptTemplate,
        checkpointGoal: checkpoint.goal,
        history,
        stepNumber: stepInCheckpoint,
        maxActions: maxActionsPerCheckpoint,
      });

      // 안전핀: 결제 체크포인트에서 "결제하기/구매확정" 류 최종 제출 버튼은 절대 자동
      // 클릭하지 않는다. 그 지점까지 정상적으로 도달했다는 것 자체를 체크포인트 성공으로
      // 기록하고 멈춘다 — 실제 결제·부정거래 탐지 위험을 원천 차단하기 위한 하드 가드.
      const targetEl = plan.action?.type === 'click' ? state.elements[plan.action.elementIndex] : null;
      if (isPayment && targetEl && isPaymentSubmitElement(targetEl.text)) {
        const step = {
          stepNumber: stepInCheckpoint,
          thought: '결제 최종 제출 버튼으로 판단되어 안전상 자동 클릭을 생략함',
          action: { type: 'safety_stop', elementIndex: plan.action.elementIndex },
          execOk: true,
          execError: null,
          screenshotPath: stepInCheckpoint === 1 ? entryScreenshotPath : null,
          timestamp: new Date().toISOString(),
        };
        steps.push(step);
        if (onStep) await onStep(checkpoint.index, step);
        done = true;
        break;
      }

      const execResult = await executeAction(activePage, plan.action, state.elements);
      const screenshotPath =
        stepInCheckpoint === 1 && activePage === page
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
      await activePage.waitForTimeout(300);
    }
  } finally {
    if (popupListener) context.off('page', popupListener);
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
  paymentInfo,
  onCheckpointStatus,
  onStep,
  onUiuxFindings,
}) {
  assertHttpUrl(targetUrl);
  const hostname = new URL(targetUrl).hostname;
  const pinnedIp = await resolveSafeIp(hostname);

  // 결제 체크포인트가 하나라도 있는 여정은 런 전체를 스텔스 엔진(Camoufox)으로 띄운다 —
  // PG 위젯의 봇 탐지는 결제 단계 진입 전부터 세션/행동을 지켜볼 수 있어서, 결제
  // 체크포인트에서만 엔진을 바꾸는 것보다 런 시작부터 스텔스로 가는 게 안전하다.
  const needsStealth = checkpoints.some((c) => c.type === 'payment');
  const { browser, contextOptions } = await launchBrowser({ stealth: needsStealth, hostname, pinnedIp });

  const collectedErrors = [];
  const allSteps = [];
  let haltedAtCheckpoint = null;

  try {
    const context = await browser.newContext(contextOptions);
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
        paymentInfo,
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
