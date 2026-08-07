const { chromium } = require('playwright');
const { captureState } = require('./capture');
const { executeAction, attachErrorCollectors, centerOf } = require('./executor');
const geminiAdapter = require('./llm/geminiAdapter');
const { bucket } = require('../db/firestore');
const { assertHttpUrl, resolveSafeIp } = require('../security/ssrfGuard');

async function uploadScreenshot(tenantId, runId, stepNumber, buffer) {
  const path = `tenants/${tenantId}/testRuns/${runId}/step-${stepNumber}.jpg`;
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

// capture → (Gemini Vision) planner → executor 루프를 persona.maxActions까지 돌리고,
// 완료 시 에러 로그를 바탕으로 vibe-coding 수정 프롬프트를 생성해 리턴한다.
// onStep(step)이 주어지면 매 스텝마다 호출되어 worker가 Firestore를 실시간 업데이트할 수 있다.
async function runTest({ tenantId, runId, targetUrl, persona, maxActions, credentials, onStep }) {
  assertHttpUrl(targetUrl);
  const hostname = new URL(targetUrl).hostname;
  const pinnedIp = await resolveSafeIp(hostname);

  // 검증 시점 이후 DNS가 바뀌어도(리바인딩) 실행 시점에 확인한 IP로만 붙게 고정한다.
  const browser = await chromium.launch({
    headless: true,
    args: [`--host-resolver-rules=MAP ${hostname} ${pinnedIp}`],
  });

  const collectedErrors = [];
  const steps = [];

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

    let done = false;
    let stepNumber = 0;
    let offline = false;

    while (!done && stepNumber < maxActions) {
      stepNumber += 1;

      if (persona.networkChaos) {
        offline = !offline;
        await context.setOffline(offline);
      }

      const state = await captureState(page);
      const plan = await geminiAdapter.generateNextAction({
        screenshotBase64: state.screenshotBase64,
        elements: state.elements.map(({ index, tag, role, text, box }) => ({ index, tag, role, text, box })),
        personaPrompt: persona.systemPromptTemplate,
        history: steps.map((s) => ({ thought: s.thought, action: s.action })),
        stepNumber,
        maxActions,
      });

      const execResult = await executeAction(page, plan.action, state.elements);
      const screenshotPath = await uploadScreenshot(
        tenantId,
        runId,
        stepNumber,
        state.screenshotBuffer
      ).catch((err) => {
        collectedErrors.push(`[Storage Error] 스크린샷 업로드 실패: ${err.message}`);
        return null;
      });

      const step = {
        stepNumber,
        thought: plan.thought || '',
        action: plan.action || null,
        execOk: execResult.ok,
        execError: execResult.error || null,
        screenshotPath,
        timestamp: new Date().toISOString(),
      };
      steps.push(step);
      if (onStep) await onStep(step);

      done = Boolean(plan.done) || plan.action?.type === 'finish';
      await page.waitForTimeout(300);
    }

    if (persona.networkChaos && offline) {
      await context.setOffline(false);
    }

    const report = await geminiAdapter.generateReport({ errors: collectedErrors, steps });

    return {
      steps,
      collectedErrors,
      summary: { totalErrors: collectedErrors.length, totalActions: steps.length },
      vibeCoderPrompt: report.vibe_coder_prompt,
      errorAnalysis: report.error_analysis,
    };
  } finally {
    await browser.close();
  }
}

module.exports = { runTest };
