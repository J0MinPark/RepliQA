const { captureState } = require('./capture');
const { executeAction, attachErrorCollectors, centerOf } = require('./executor');
const { runObjectiveChecks } = require('./uiuxChecks');
const { isPaymentSubmitElement } = require('./paymentSafety');
const { launchBrowser } = require('./browserEngines');
const geminiAdapter = require('./llm/geminiAdapter');
const uiTarsAdapter = require('./llm/uiTarsAdapter');
const screenshotStore = require('./screenshotStore');
const { assertHttpUrl, resolveSafeIp } = require('../security/ssrfGuard');
const env = require('../config/env');

// Gemini가 고른 elementIndex가 화면이 복잡할 때(요소가 많거나 비슷한 텍스트) 틀릴 수 있다
// (네이버 '스포츠' 탭 사례로 실제 확인함) — 이 액션들만 OpenRouter의 UI-TARS(GUI 그라운딩
// 전용 모델)로 좌표를 다시 확인한다. select/drag/upload_file은 Locator나 두 번째 좌표가
// 필요해서 대상 밖(executor.js의 needsElementTarget과 대응).
const GROUNDABLE_ACTION_TYPES = new Set(['click', 'type', 'clear', 'hover', 'paste', 'rapid_click', 'key']);

// UI-TARS 그라운딩이 켜져 있고 이 액션이 대상이면 좌표를 다시 확인해서 action.resolvedPoint에
// 채워 넣는다. 실패(미설정/API 에러/파싱 실패)하면 아무것도 안 하고 조용히 넘어간다 —
// executor.js가 elementIndex 기반 기존 방식으로 자연스럽게 폴백한다.
async function groundActionIfNeeded(page, action, screenshotBase64) {
  if (!env.openRouterApiKey) return;
  if (!action || !GROUNDABLE_ACTION_TYPES.has(action.type)) return;
  if (!action.targetDescription || action.elementIndex == null) return;

  const viewport = page.viewportSize();
  const point = await uiTarsAdapter
    .groundElement({
      screenshotBase64,
      instruction: action.targetDescription,
      viewportWidth: viewport?.width || 1280,
      viewportHeight: viewport?.height || 800,
    })
    .catch(() => null);
  if (point) action.resolvedPoint = point;
}

async function uploadScreenshot(tenantId, runId, label, buffer) {
  const path = `tenants/${tenantId}/testRuns/${runId}/${label}.jpg`;
  return screenshotStore.uploadScreenshot(path, buffer);
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
  activity,
  tabs,
  allowedHostname,
  testInboxConfig,
  runStartedAt,
  onStep,
  onUiuxFindings,
}) {
  const isPayment = checkpoint.type === 'payment';
  const isLongRunning = checkpoint.type === 'long_running';

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

  // 새 탭/팝업으로 이동하는 경우가 결제 위젯 말고도 흔하다(target="_blank" 링크 등) —
  // 모든 체크포인트에서 팝업이 열리면 이후 capture/execute 대상을 그 팝업으로 전환한다
  // (iframe은 capture.js가 알아서 훑는다).
  let activePage = page;
  const popupListener = (newPage) => {
    activePage = newPage;
    tabs.push(newPage);
    attachErrorCollectors(newPage, collectedErrors, activity);
    newPage.on('close', () => {
      if (activePage === newPage) activePage = page;
      const idx = tabs.indexOf(newPage);
      if (idx >= 0) tabs.splice(idx, 1);
    });
  };
  context.on('page', popupListener);

  if (isPayment && paymentInfo) {
    await attemptPaymentFill(activePage, paymentInfo).catch((err) => {
      collectedErrors.push(`[Payment Fill Error] ${err.message}`);
    });
  }

  let done = false;
  let success = false;
  let failureReason = null;
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

      await groundActionIfNeeded(activePage, plan.action, state.screenshotBase64);

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
        // 결제 최종 제출 직전까지 정상적으로 도달한 것 자체가 이 체크포인트의 성공
        // 조건이다(안전핀 때문에 그 이상은 의도적으로 진행하지 않음).
        success = true;
        break;
      }

      const execResult = await executeAction(activePage, plan.action, state.elements, {
        context,
        allowedHostname,
        testInboxConfig,
        tabs,
        allowLongWait: isLongRunning,
        runStartedAt,
      });
      if (execResult.switchTo) {
        activePage = execResult.switchTo;
      }
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

      // "finish"라고 해서 무조건 성공이 아니다 — 모델이 막혀서 포기한 것일 수도 있다.
      // finishReason으로 성공/실패를 구분해서, 리포트가 "완료(성공)"로 잘못 찍히지 않게 한다.
      // 스키마상 top-level(plan.finishReason)로 지정했지만, 실제 라이브 응답에서 모델이
      // action 안에(plan.action.finishReason) 넣는 경우를 실제로 확인했다 — "finish 액션의
      // 속성"이라는 관점에서는 오히려 더 자연스러운 위치라 모델이 그쪽을 선호하는 듯하다.
      // 둘 중 어디에 와도 놓치지 않게 양쪽 다 본다.
      const isFinish = plan.action?.type === 'finish';
      done = Boolean(plan.done) || isFinish;
      if (isFinish) {
        const finishReason = plan.action?.finishReason || plan.finishReason;
        success = finishReason !== 'blocked';
        if (!success) failureReason = step.thought || '모델이 목표 달성이 불가능하다고 판단해 중단함';
      }
      await activePage.waitForTimeout(300);
    }
  } finally {
    context.off('page', popupListener);
  }

  if (!done) {
    failureReason = `허용된 행동 횟수(${maxActionsPerCheckpoint}회) 안에 목표를 달성하지 못함`;
  }

  if (persona.networkChaos && offline) {
    await context.setOffline(false);
  }

  return { done, success, failureReason, steps };
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
  savedSessionState,
  testInboxConfig,
  onCheckpointStatus,
  onStep,
  onUiuxFindings,
}) {
  const runStartedAt = new Date();
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
  // 런 전체(체크포인트/팝업 포함) 동안의 네트워크 호출·콘솔 로그를 모은다. 에러가 아닌
  // 것도 포함해서, "200은 떨어졌는데 데이터가 이상한" 것처럼 겉으론 정상인 버그도 사람이나
  // 코딩 에이전트가 리포트에서 직접 훑어볼 수 있게 한다.
  const activity = { networkCalls: [], consoleLogs: [], downloads: [], websocketFrames: [] };
  let haltedAtCheckpoint = null;
  let haltedInfo = null;

  try {
    // savedSessionState: 캡처해둔 로그인 세션(쿠키+로컬스토리지)이 있으면 그대로 불러와서
    // "이미 로그인된 상태"로 시작한다 — 소셜 로그인(OAuth)처럼 매번 자동화로 뚫기 어려운
    // 로그인은 capture-session.js로 한 번만 사람이 수동 로그인해서 캡처해두는 방식으로 우회.
    const context = await browser.newContext({
      ...contextOptions,
      ...(savedSessionState ? { storageState: savedSessionState } : {}),
    });
    const page = await context.newPage();
    attachErrorCollectors(page, collectedErrors, activity);
    const tabs = [page];

    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

    if (credentials && !savedSessionState) {
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
        activity,
        tabs,
        allowedHostname: hostname,
        testInboxConfig,
        runStartedAt,
        onStep,
        onUiuxFindings,
      });

      allSteps.push(...result.steps.map((s) => ({ ...s, checkpointIndex: checkpoint.index })));

      if (!result.done || !result.success) {
        if (onCheckpointStatus) {
          await onCheckpointStatus(checkpoint.index, 'failed', { failureReason: result.failureReason });
        }
        haltedAtCheckpoint = checkpoint.index;
        haltedInfo = { checkpointGoal: checkpoint.goal, reason: result.failureReason };
        break;
      }
      if (onCheckpointStatus) await onCheckpointStatus(checkpoint.index, 'completed');
    }

    const report = await geminiAdapter.generateReport({ errors: collectedErrors, steps: allSteps, haltedInfo });

    return {
      collectedErrors,
      networkCalls: activity.networkCalls,
      consoleLogs: activity.consoleLogs,
      downloads: activity.downloads,
      websocketFrames: activity.websocketFrames,
      haltedAtCheckpoint,
      summary: {
        totalErrors: collectedErrors.length,
        totalActions: allSteps.length,
        networkCallsCount: activity.networkCalls.length,
        consoleLogsCount: activity.consoleLogs.length,
        downloadsCount: activity.downloads.length,
      },
      vibeCoderPrompt: report.vibe_coder_prompt,
      errorAnalysis: report.error_analysis,
    };
  } finally {
    await browser.close();
  }
}

module.exports = { runTest };
