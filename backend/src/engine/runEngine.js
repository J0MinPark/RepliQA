const { captureState } = require('./capture');
const { executeAction, attachErrorCollectors, centerOf, EXPECTED_OFFLINE_TAG } = require('./executor');
const { runObjectiveChecks } = require('./uiuxChecks');
const { isPaymentSubmitElement } = require('./paymentSafety');
const { looksLoggedOut } = require('./sessionValidity');
const { launchBrowser } = require('./browserEngines');
const geminiAdapter = require('./llm/geminiAdapter');
const uiTarsAdapter = require('./llm/uiTarsAdapter');
const screenshotStore = require('./screenshotStore');
const { assertHttpUrl, resolveSafeIp, resolveIpUnchecked } = require('../security/ssrfGuard');
const env = require('../config/env');

// Gemini가 고른 elementIndex가 화면이 복잡할 때(요소가 많거나 비슷한 텍스트) 틀릴 수 있다
// (네이버 '스포츠' 탭 사례로 실제 확인함) — 이 액션들만 OpenRouter의 UI-TARS(GUI 그라운딩
// 전용 모델)로 좌표를 다시 확인한다. select/drag/upload_file은 Locator나 두 번째 좌표가
// 필요해서 대상 밖(executor.js의 needsElementTarget과 대응).
const GROUNDABLE_ACTION_TYPES = new Set(['click', 'type', 'clear', 'hover', 'paste', 'rapid_click', 'key']);

// UI-TARS가 완전히 엉뚱한 영역(상단 광고/이벤트 배너 등)을 짚는 사고를 실제로 확인했다 —
// 예스24에서 "해리 포터 도서 제목"을 찾으라고 했는데 상단의 회전 이벤트 배너("2026 어린이
// 독후감 대회")를 짚어서 검색 결과와 무관한 곳을 클릭한 사례(document.elementFromPoint로
// 직접 재현·확인함). Gemini가 고른 elementIndex의 박스에서 너무 멀리 떨어진 좌표는 신뢰하지
// 않고 폐기한다 — 폐기해도 executor.js가 elementIndex 기반 클릭으로 안전하게 폴백하므로
// 최악의 경우 그라운딩 도입 이전 수준일 뿐이다. 반대로 폐기하지 않고 엉뚱한 좌표를 그대로
// 믿으면 체크포인트 전체가 실패하는 걸 이번에 확인했으므로, 과감하게 버리는 쪽이 비용이 싸다.
const MAX_GROUNDING_DRIFT_PX = 320;

function isPlausibleGroundingPoint(point, box) {
  if (!box) return true;
  const nearestX = Math.max(box.x, Math.min(point.x, box.x + box.width));
  const nearestY = Math.max(box.y, Math.min(point.y, box.y + box.height));
  const dx = point.x - nearestX;
  const dy = point.y - nearestY;
  return Math.sqrt(dx * dx + dy * dy) <= MAX_GROUNDING_DRIFT_PX;
}

// UI-TARS 그라운딩이 켜져 있고 이 액션이 대상이면 좌표를 다시 확인해서 action.resolvedPoint에
// 채워 넣는다. 실패(미설정/API 에러/파싱 실패/터무니없는 위치)하면 아무것도 안 하고 조용히
// 넘어간다 — executor.js가 elementIndex 기반 기존 방식으로 자연스럽게 폴백한다.
async function groundActionIfNeeded(page, action, screenshotBase64, elements) {
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
  if (!point) return;

  const referenceBox = elements?.[action.elementIndex]?.box;
  if (!isPlausibleGroundingPoint(point, referenceBox)) return;

  action.resolvedPoint = point;
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

  // checkpoint.mock(routes.js의 MOCK_TAG로 파싱됨)이 있으면 이 체크포인트가 실행되는 동안
  // 해당 URL 패턴으로 나가는 요청에 실제 서버 응답 대신 강제로 지정한 상태코드/본문을
  // 돌려준다(Playwright의 page.route()/Cypress의 cy.intercept()와 같은 원리) — 에러 응답·빈
  // 목록 같은 엣지케이스를 대상 서버 협조 없이 재현하기 위함. context 단위로 걸어서 팝업
  // 페이지로 전환돼도(popupListener) 그대로 적용된다.
  const mockUrlMatcher = checkpoint.mock ? buildMockRouteMatcher(checkpoint.mock) : null;
  const mockHandler = checkpoint.mock ? buildMockRouteHandler(checkpoint.mock) : null;
  if (mockUrlMatcher) await context.route(mockUrlMatcher, mockHandler);

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

      await groundActionIfNeeded(activePage, plan.action, state.screenshotBase64, state.elements);

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
        activity,
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
        execWarning: execResult.warning || null,
        // 직전 행동이 execOk:true인데도 화면이 실제로는 안 바뀌었는지를 모델이 스스로
        // 판정한 값('success'|'no_change'|'unexpected'|'none') — "정확히 눌렀는데 사이트가
        // 반응하지 않는" 실제 버그(예: 저장 버튼을 눌러도 로딩에서 멈추는 것)를, execWarning
        // 만으로는 못 잡는다(우리 클릭 자체는 정상이었으므로). generateReport가 이 신호를
        // execError/execWarning과 동급의 확정된 근거로 취급한다.
        previousActionEffect: plan.previousActionEffect || null,
        screenshotPath,
        timestamp: new Date().toISOString(),
      };
      // execOk/execError는 지금까지 리포트용으로만 쓰였고, 모델에게 다시 보여주는 history엔
      // thought/action만 들어가 있었다 — 즉 모델은 "지난 클릭이 진짜 성공했는지"를 순전히
      // 스크린샷 비교만으로 추측해야 했다. automationexercise.com에서 실제로 재현: 호버로만
      // 나타나는 "Add to cart" 버튼의 캡처 좌표가 실제 렌더링 위치와 어긋나 엉뚱한 제목
      // 텍스트를 클릭했는데도(장바구니가 계속 비어있었음) 모델은 매번 "성공했다"고 판단하고
      // 똑같은 행동을 예산이 다 떨어질 때까지 반복했다. 결과(성공/실패 사유)를 명시적으로
      // 같이 넘기면 모델이 스스로 판단할 필요 없이 바로 알 수 있다.
      let historyResult;
      if (!execResult.ok) {
        historyResult = `실패: ${execResult.error || '알 수 없는 오류'}`;
      } else if (execResult.warning) {
        historyResult = `성공(주의: ${execResult.warning})`;
      } else {
        historyResult = 'success';
      }
      history.push({ thought: step.thought, action: step.action, result: historyResult });
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
    if (mockUrlMatcher) await context.unroute(mockUrlMatcher, mockHandler);
  }

  if (!done) {
    failureReason = `허용된 행동 횟수(${maxActionsPerCheckpoint}회) 안에 목표를 달성하지 못함`;
  }

  // 결정론적 검증: checkpoint.verify가 있으면 "목표를 달성했다"는 LLM 자기 판단과
  // 무관하게 실제 브라우저/네트워크 상태를 엔진이 직접 확인한다(WebArena/Mind2Web류
  // 벤치마크가 에이전트 자기 보고를 안 믿고 환경 상태를 직접 채점하는 것과 같은 원리).
  // 결정론적 증거가 있으면 그쪽을 항상 우선한다 — LLM이 "됐다"고 착각했거나(자기 보고
  // 오탐), 반대로 finish를 안 부르고 예산을 다 썼지만 실제로는 이미 달성된 경우 둘 다 잡는다.
  // 한 번만 확인하지 않고 오토웨이트처럼 폴링하는 이유: 저장 API 응답→토스트→URL 변경 같은
  // 비동기 UI 반영이 액션 루프가 끝난 시점엔 아직 안 끝났을 수 있어서다.
  let verifiedBy = null;
  if (checkpoint.verify) {
    const verifyResult = await pollDeterministicVerify(activePage, activity, checkpoint.verify).catch((err) => {
      collectedErrors.push(`[Verify Error] ${err.message}`);
      return null;
    });
    if (verifyResult != null) {
      const verifyPassed = verifyResult.passed;
      if (verifyPassed === success) {
        // 재확인(폴링)까지 가서야 통과한 경우는 "AI 판단이 처음부터 맞았다"와는 다른
        // 신호라 별도로 구분한다 — UI가 "재확인 후 통과"라고 정직하게 표시할 수 있게.
        verifiedBy = verifyPassed === true && verifyResult.attempts > 1 ? 'recovered' : 'both';
      } else {
        verifiedBy = 'disagreement';
        if (verifyPassed) {
          success = true;
          done = true;
          failureReason = null;
        } else {
          success = false;
          failureReason = `AI는 목표를 달성했다고 판단했지만, 실제로는 검증 조건(${describeVerify(checkpoint.verify)})을 만족하지 않았습니다 — 결정론적 검증 결과를 우선합니다.`;
        }
      }
    }
  }

  if (persona.networkChaos && offline) {
    await context.setOffline(false);
  }

  return { done, success, failureReason, steps, verifiedBy, finalUrl: activePage.url() };
}

// checkpoint.verify(routes.js의 VERIFY_TAG로 파싱됨)를 실제 브라우저/네트워크 상태로
// 확인한다. Playwright locator 재검색 없이 지금 이 시점의 사실만 보는 3가지 얕은 체크다 —
// 더 정교한 조건(특정 요소의 정확한 텍스트 등)이 필요해지면 여기에 type을 추가하면 된다.
async function runDeterministicVerify(page, activity, verify) {
  if (verify.type === 'url_contains') {
    return page.url().includes(verify.value);
  }
  if (verify.type === 'text_visible') {
    const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
    return bodyText.includes(verify.value);
  }
  if (verify.type === 'network_status') {
    return (activity.networkCalls || []).some(
      (call) => call.url.includes(verify.urlPattern) && call.status === verify.status
    );
  }
  return null;
}

function describeVerify(verify) {
  if (verify.type === 'url_contains') return `url_contains("${verify.value}")`;
  if (verify.type === 'text_visible') return `text_visible("${verify.value}")`;
  if (verify.type === 'network_status') return `network_status("${verify.urlPattern}", ${verify.status})`;
  return verify.type;
}

const VERIFY_POLL_TIMEOUT_MS = 6000;
const VERIFY_POLL_INTERVAL_MS = 500;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// LLM 액션 루프가 끝난 시점에도 저장 API 응답→토스트→URL 변경 같은 비동기 UI 반영이 아직
// 안 끝났을 수 있다(Playwright의 expect(locator).toHaveText()나 Cypress의 .should()가
// 조건이 맞을 때까지 재시도하는 것과 같은 문제). runDeterministicVerify의 3개 분기 로직은
// 그대로 재사용하면서, 통과하거나 timeoutMs가 지날 때까지 intervalMs 간격으로 재확인한다.
// activity.networkCalls는 executor.js가 계속 push하는 같은 배열 레퍼런스라, 폴링 중
// 새로 들어오는 네트워크 콜도 별도 배관 없이 그대로 잡힌다.
async function pollDeterministicVerify(
  page,
  activity,
  verify,
  { timeoutMs = VERIFY_POLL_TIMEOUT_MS, intervalMs = VERIFY_POLL_INTERVAL_MS } = {}
) {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  let lastPassed = null;
  for (;;) {
    attempts += 1;
    lastPassed = await runDeterministicVerify(page, activity, verify);
    if (lastPassed === true) return { passed: true, attempts };
    if (Date.now() >= deadline) return { passed: lastPassed, attempts };
    await delay(intervalMs);
  }
}

// checkpoint.mock(routes.js의 MOCK_TAG로 파싱됨)을 실제 context.route() 매처/핸들러로
// 변환한다. 두 개로 분리해둔 이유: url_contains/network_status와 같은 원칙으로 "포함되면"
// 매칭이라는 게 순수 함수라 유닛 테스트하기 쉽고, runCheckpoint 안에 인라인으로 두면
// 검증하기 어렵기 때문이다.
function buildMockRouteMatcher(mock) {
  return (url) => url.href.includes(mock.urlPattern);
}

function buildMockRouteHandler(mock) {
  return (route) =>
    route.fulfill({
      status: mock.status,
      body: mock.body || '',
      contentType: 'application/json',
    });
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
  browserEngine,
  allowPrivateTargets,
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
  // allowPrivateTargets는 공개 API/워커 경로(testRuns.js→worker.js)에서는 절대 넘어오지
  // 않는다 — WebArena 같은 로컬 Docker 샌드박스를 대상으로 runTest()를 라이브러리로 직접
  // 호출하는 벤치마크 스크립트 전용 옵션이다.
  if (!allowPrivateTargets) assertHttpUrl(targetUrl);
  const hostname = new URL(targetUrl).hostname;
  const pinnedIp = allowPrivateTargets
    ? await resolveIpUnchecked(hostname)
    : await resolveSafeIp(hostname);

  // 기본값은 스텔스 엔진(Camoufox) — 결제 위젯뿐 아니라 일반 탐색 체크포인트도 첫 페이지
  // 로드부터 WAF에 막히는 사례가 있었다(browserEngines.js 참고). browserEngine을 명시하면
  // (예: 'webkit') Safari 전용 렌더링/동작 차이를 잡아내는 크로스 브라우저 검증에 쓸 수
  // 있다 — 봇 탐지 우회 패치는 없으니 소유권 검증된 자기 사이트에만 권장.
  const { browser, contextOptions } = await launchBrowser({
    engine: browserEngine || 'firefox',
    hostname,
    pinnedIp,
  });

  const collectedErrors = [];
  const allSteps = [];
  // 런 전체(체크포인트/팝업 포함) 동안의 네트워크 호출·콘솔 로그를 모은다. 에러가 아닌
  // 것도 포함해서, "200은 떨어졌는데 데이터가 이상한" 것처럼 겉으론 정상인 버그도 사람이나
  // 코딩 에이전트가 리포트에서 직접 훑어볼 수 있게 한다.
  // isOffline: set_network 액션이 갱신하는 플래그. 오프라인 시뮬레이션 중 발생하는 네트워크/
  // 콘솔 에러는 "우리가 일부러 만든 상황의 예상된 결과"라 실제 버그와 같은 무게로 다루면
  // 안 된다 — attachErrorCollectors가 이 플래그를 보고 에러 메시지에 태그를 붙인다.
  const activity = { networkCalls: [], consoleLogs: [], downloads: [], websocketFrames: [], isOffline: false };
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

    // 캡처된 세션으로 시작했는데도 로그인 화면이면, 세션이 만료/무효화된 것이다. 이후
    // 체크포인트를 그대로 진행해도 전부 로그인 화면에 막혀 실패할 뿐이고, 그 실패들을 모아
    // Gemini에게 리포트를 만들게 하면 "사이트에 버그가 있다"는 식으로 잘못 분석될 위험이
    // 크다 — 여기서 바로 감지해서 원인을 명확히 하고 조기 종료한다.
    if (savedSessionState) {
      const probe = await captureState(page).catch(() => null);
      if (probe && looksLoggedOut(probe.url, probe.elements)) {
        const reason =
          '캡처된 로그인 세션이 만료되었거나 무효화된 것으로 보입니다. scripts/capture-session.js로 세션을 다시 캡처한 뒤 재실행해주세요.';
        if (onCheckpointStatus && checkpoints.length > 0) {
          await onCheckpointStatus(checkpoints[0].index, 'failed', { failureReason: reason });
        }
        return {
          collectedErrors,
          networkCalls: activity.networkCalls,
          consoleLogs: activity.consoleLogs,
          downloads: activity.downloads,
          websocketFrames: activity.websocketFrames,
          haltedAtCheckpoint: checkpoints[0]?.index ?? 0,
          summary: {
            totalErrors: 0,
            expectedErrors: 0,
            totalActions: 0,
            networkCallsCount: activity.networkCalls.length,
            consoleLogsCount: activity.consoleLogs.length,
            downloadsCount: activity.downloads.length,
          },
          plainSummary: '로그인이 필요한 화면에서 캡처해둔 로그인 정보가 만료돼 더 진행하지 못했습니다. 사이트 자체의 문제는 아닙니다.',
          vibeCoderPrompt:
            '[코드 수정 불필요 — 외부 요인] 이 실행은 코드 버그가 아니라 캡처된 로그인 세션 만료로 중단되었습니다. 이 내용은 코딩 에이전트에 붙여넣지 않아도 됩니다 — scripts/capture-session.js로 세션을 다시 캡처한 뒤 재실행해주세요.',
          errorAnalysis: reason,
          sessionExpired: true,
          severity: 'warning',
        };
      }
    }

    if (credentials && !savedSessionState) {
      await attemptLogin(page, credentials).catch((err) => {
        collectedErrors.push(`[Login Error] ${err.message}`);
      });
    }

    let lastFinalUrl = null;
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
      lastFinalUrl = result.finalUrl;

      if (!result.done || !result.success) {
        if (onCheckpointStatus) {
          await onCheckpointStatus(checkpoint.index, 'failed', {
            failureReason: result.failureReason,
            verifiedBy: result.verifiedBy,
          });
        }
        haltedAtCheckpoint = checkpoint.index;
        haltedInfo = { checkpointGoal: checkpoint.goal, reason: result.failureReason, verifiedBy: result.verifiedBy };
        break;
      }
      if (onCheckpointStatus) {
        await onCheckpointStatus(checkpoint.index, 'completed', { verifiedBy: result.verifiedBy });
      }
    }

    const report = await geminiAdapter.generateReport({ errors: collectedErrors, steps: allSteps, haltedInfo });

    // 오프라인 시뮬레이션 중 발생한(태그가 붙은) 에러는 "예상된 결과"라 실제 버그 집계에서
    // 뺀다 — totalErrors는 항상 "설명이 필요한" 에러 개수를 뜻하게 유지한다.
    const unexpectedErrors = collectedErrors.filter((e) => !e.startsWith(EXPECTED_OFFLINE_TAG));

    return {
      collectedErrors,
      networkCalls: activity.networkCalls,
      consoleLogs: activity.consoleLogs,
      downloads: activity.downloads,
      websocketFrames: activity.websocketFrames,
      haltedAtCheckpoint,
      finalUrl: lastFinalUrl,
      summary: {
        totalErrors: unexpectedErrors.length,
        expectedErrors: collectedErrors.length - unexpectedErrors.length,
        totalActions: allSteps.length,
        networkCallsCount: activity.networkCalls.length,
        consoleLogsCount: activity.consoleLogs.length,
        downloadsCount: activity.downloads.length,
      },
      plainSummary: report.plain_summary,
      vibeCoderPrompt: report.vibe_coder_prompt,
      errorAnalysis: report.error_analysis,
      // generateReport가 문맥(예상된 에러인지, 외부 요인인지)까지 판단해서 내리는 심각도다 —
      // "에러 개수가 1개 이상이면 무조건 크리티컬"보다 훨씬 객관적인 신호라 프론트 배너가
      // 이걸 우선 쓰고, 필드가 없을 때만 개수 기반으로 폴백한다.
      severity: report.severity || (unexpectedErrors.length > 0 ? 'critical' : 'pass'),
    };
  } finally {
    await browser.close();
  }
}

module.exports = {
  runTest,
  isPlausibleGroundingPoint,
  runDeterministicVerify,
  pollDeterministicVerify,
  describeVerify,
  buildMockRouteMatcher,
  buildMockRouteHandler,
};
