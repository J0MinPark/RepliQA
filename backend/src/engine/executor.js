function centerOf(box) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// planner가 고른 elementIndex를 capture.js가 뽑아둔 bounding box로 그대로 resolve해서
// 좌표 클릭한다. 텍스트 재검색(getByText)을 하지 않으므로 동일 텍스트 중복이나
// 요소가 사라진 경우에도 "어떤 요소를 시도했는지"가 명확하게 남는다.
async function executeAction(page, action, elements) {
  if (!action || action.type === 'finish') {
    return { ok: true };
  }
  if (action.type === 'wait') {
    await page.waitForTimeout(Math.min(action.waitMs || 500, 5000));
    return { ok: true };
  }
  if (action.type === 'go_back') {
    try {
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 5000 });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  const target = elements[action.elementIndex];
  if (!target) {
    return { ok: false, error: `elementIndex ${action.elementIndex}가 유효하지 않습니다.` };
  }
  const { x, y } = centerOf(target.box);

  try {
    if (action.type === 'click') {
      await page.mouse.click(x, y);
      await settleAfterAction(page);
    } else if (action.type === 'type') {
      await page.mouse.click(x, y);
      await page.keyboard.type(action.text || '', { delay: 20 });
      await settleAfterAction(page);
    } else if (action.type === 'select') {
      await selectOptionAt(page, target, x, y, action);
      await settleAfterAction(page);
    } else {
      return { ok: false, error: `알 수 없는 action.type: ${action.type}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// 검색창 엔터, 로그인 버튼처럼 클릭이 곧바로 페이지 전체 이동을 일으키는 경우, 다음
// 스텝의 captureState()가 새 문서로 교체되는 그 순간과 겹치면 "Execution context was
// destroyed" 에러로 죽는다(구글 검색으로 실제 확인함). 네비게이션이 없는 보통의 클릭이면
// 이미 만족된 상태라 거의 즉시 반환되므로, 매 액션마다 걸어도 체감 지연은 없다.
async function settleAfterAction(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
}

// 헤드리스 브라우저에서 네이티브 <select>가 열리는 OS 드롭다운은 스크린샷에 안 잡히고
// 좌표 클릭으로 옵션을 고를 수도 없다. 그래서 select 요소만 좌표로 다시 찾아
// Playwright의 selectOption()으로 값을 직접 지정한다 — 커스텀(비-select) 드롭다운은
// 그냥 한 번 클릭해서 열기만 한다(다음 스텝 캡처에서 드러난 옵션을 click으로 고르면 됨).
async function selectOptionAt(page, target, x, y, action) {
  if (target.tag !== 'select') {
    await page.mouse.click(x, y);
    return;
  }
  const marker = `data-repliqa-tmp-${Date.now()}`;
  await page.evaluate(
    ({ px, py, m }) => {
      const el = document.elementFromPoint(px, py);
      if (el) el.setAttribute(m, '1');
    },
    { px: x, py: y, m: marker }
  );
  try {
    const locator = page.locator(`[${marker}]`);
    if (action.optionValue) {
      await locator.selectOption({ value: action.optionValue });
    } else {
      await locator.selectOption({ label: action.optionLabel || '' });
    }
  } finally {
    await page
      .evaluate((m) => {
        const el = document.querySelector(`[${m}]`);
        if (el) el.removeAttribute(m);
      }, marker)
      .catch(() => {});
  }
}

// 기존 프로토타입은 console/response만 감시했다. pageerror(자바스크립트 크래시)는
// 기획서가 명시한 핵심 탐지 대상인데 누락돼 있었어서 여기서 추가한다.
function attachErrorCollectors(page, collectedErrors) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') collectedErrors.push(`[Console Error] ${msg.text()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      collectedErrors.push(`[Network Error] ${response.status()} ${response.url()}`);
    }
  });
  page.on('pageerror', (err) => {
    collectedErrors.push(`[JS Crash] ${err.message}`);
  });
}

module.exports = { executeAction, attachErrorCollectors, centerOf };
