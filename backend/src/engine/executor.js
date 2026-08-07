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
    } else if (action.type === 'type') {
      await page.mouse.click(x, y);
      await page.keyboard.type(action.text || '', { delay: 20 });
    } else {
      return { ok: false, error: `알 수 없는 action.type: ${action.type}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
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
