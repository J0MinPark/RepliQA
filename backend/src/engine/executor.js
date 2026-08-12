const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { getFixturePath } = require('./testFixtures');
const { fetchLatestMessage, extractCodeOrLink } = require('./testInbox');

function centerOf(box) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const VIEWPORT_PRESETS = {
  mobile: { width: 375, height: 667 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 800 },
};

// planner가 고른 elementIndex를 capture.js가 뽑아둔 bounding box로 그대로 resolve해서
// 좌표 클릭한다. 텍스트 재검색(getByText)을 하지 않으므로 동일 텍스트 중복이나
// 요소가 사라진 경우에도 "어떤 요소를 시도했는지"가 명확하게 남는다.
//
// ctx는 액션 실행에 필요한 부가 정보를 모아둔 객체다:
//   context: Playwright BrowserContext (clipboard 권한/새 탭/스토리지 초기화용)
//   allowedHostname: navigate/read_test_inbox가 벗어날 수 없는 호스트(등록된 대상 사이트) —
//     타인 사이트로 유도되는 걸 막는 안전장치
//   testInboxConfig: read_test_inbox용 프로바이더 설정(암호 해제된 상태로 worker가 넘김)
//   tabs: open_duplicate_tab으로 열린 탭들의 목록(switch_tab이 이 배열의 인덱스를 씀)
//   allowLongWait: [장시간] 체크포인트에서만 true — wait의 상한을 크게 늘림
//   runStartedAt: read_test_inbox가 "이번 실행 이후 도착한 메일"만 보게 하는 기준 시각
async function executeAction(page, action, elements, ctx = {}) {
  if (!action || action.type === 'finish') {
    return { ok: true };
  }
  if (action.type === 'wait') {
    const cap = ctx.allowLongWait ? 30 * 60 * 1000 : 5000;
    await page.waitForTimeout(Math.min(action.waitMs || 500, cap));
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
  if (action.type === 'go_forward') {
    try {
      await page.goForward({ waitUntil: 'domcontentloaded', timeout: 5000 });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
  if (action.type === 'reload') {
    try {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
  if (action.type === 'scroll') {
    try {
      await scrollPage(page, action);
      await settleAfterAction(page);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
  if (action.type === 'resize_viewport') {
    try {
      const base = VIEWPORT_PRESETS[action.preset] || VIEWPORT_PRESETS.desktop;
      const size = action.orientation === 'landscape' ? { width: base.height, height: base.width } : base;
      await page.setViewportSize(size);
      await settleAfterAction(page);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
  if (action.type === 'set_network') {
    try {
      await ctx.context.setOffline(Boolean(action.offline));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
  if (action.type === 'clear_storage') {
    try {
      const scope = action.scope || 'all';
      if (scope === 'cookies' || scope === 'all') await ctx.context.clearCookies();
      if (scope === 'localStorage' || scope === 'all') await page.evaluate(() => localStorage.clear()).catch(() => {});
      if (scope === 'sessionStorage' || scope === 'all') await page.evaluate(() => sessionStorage.clear()).catch(() => {});
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
  if (action.type === 'set_color_scheme') {
    try {
      await page.emulateMedia({ colorScheme: action.scheme === 'light' ? 'light' : 'dark' });
      await settleAfterAction(page);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
  if (action.type === 'navigate') {
    try {
      const url = new URL(action.url, page.url());
      if (ctx.allowedHostname && url.hostname !== ctx.allowedHostname) {
        return { ok: false, error: `등록된 대상(${ctx.allowedHostname}) 밖의 호스트로는 이동할 수 없습니다: ${url.hostname}` };
      }
      await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 15000 });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
  if (action.type === 'open_duplicate_tab') {
    // 여기서 새 페이지를 만들기만 하면, 이미 등록된 context의 'page' 리스너(runEngine.js)가
    // 자동으로 tabs 목록에 추가하고 활성 탭으로 전환한다 — 결제 팝업 추적과 동일한 메커니즘을
    // 재사용해서, 동시성/경합 조건 테스트용으로 "같은 세션의 두 번째 탭"을 여는 것.
    try {
      const newPage = await ctx.context.newPage();
      await newPage.goto(page.url(), { waitUntil: 'domcontentloaded', timeout: 15000 });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
  if (action.type === 'switch_tab') {
    const idx = action.tabIndex ?? 0;
    const targetPage = ctx.tabs && ctx.tabs[idx];
    if (!targetPage) return { ok: false, error: `tabIndex ${idx}에 해당하는 탭이 없습니다.` };
    return { ok: true, switchTo: targetPage };
  }
  if (action.type === 'rapid_click') {
    const target = elements[action.elementIndex];
    if (!target) return { ok: false, error: `elementIndex ${action.elementIndex}가 유효하지 않습니다.` };
    const { x, y } = centerOf(target.box);
    const times = Math.min(Math.max(action.times || 2, 2), 10);
    try {
      for (let i = 0; i < times; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await page.mouse.click(x, y);
      }
      await settleAfterAction(page);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
  if (action.type === 'read_test_inbox') {
    if (!ctx.testInboxConfig) return { ok: false, error: '테스트 인박스가 설정되어 있지 않습니다.' };
    try {
      const msg = await fetchLatestMessage(ctx.testInboxConfig, { sentAfter: ctx.runStartedAt });
      if (!msg) return { ok: false, error: '받은 메일이 아직 도착하지 않았습니다.' };
      const { code, link } = extractCodeOrLink(msg.body);
      if (action.elementIndex != null && code) {
        const target = elements[action.elementIndex];
        if (!target) return { ok: false, error: `elementIndex ${action.elementIndex}가 유효하지 않습니다.` };
        const { x, y } = centerOf(target.box);
        await page.mouse.click(x, y);
        await page.keyboard.type(code, { delay: 20 });
        await settleAfterAction(page);
        return { ok: true };
      }
      if (link) {
        const linkUrl = new URL(link);
        if (ctx.allowedHostname && linkUrl.hostname !== ctx.allowedHostname) {
          return { ok: false, error: '메일 속 링크가 등록된 대상 호스트 밖이라 자동 이동을 생략했습니다.' };
        }
        await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 15000 });
        return { ok: true };
      }
      return { ok: false, error: '메일 본문에서 인증 코드나 링크를 찾지 못했습니다.' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
  if (action.type === 'key') {
    // elementIndex가 없으면 직전 액션이 남긴 포커스 상태에서 그대로 키만 누른다
    // (예: 방금 입력한 검색창에서 이어서 Enter).
    try {
      if (action.elementIndex != null) {
        const target = elements[action.elementIndex];
        if (!target) return { ok: false, error: `elementIndex ${action.elementIndex}가 유효하지 않습니다.` };
        const { x, y } = centerOf(target.box);
        await page.mouse.click(x, y);
      }
      const times = Math.min(Math.max(action.times || 1, 1), 20);
      for (let i = 0; i < times; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await page.keyboard.press(action.key || 'Enter');
      }
      await settleAfterAction(page);
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
      if (action.clear) await clearFocusedField(page);
      await page.keyboard.type(action.text || '', { delay: 20 });
    } else if (action.type === 'clear') {
      await page.mouse.click(x, y);
      await clearFocusedField(page);
    } else if (action.type === 'hover') {
      await page.mouse.move(x, y);
    } else if (action.type === 'select') {
      await selectOptionAt(page, target, x, y, action);
    } else if (action.type === 'drag') {
      const targetEl = elements[action.targetElementIndex];
      if (!targetEl) {
        return { ok: false, error: `targetElementIndex ${action.targetElementIndex}가 유효하지 않습니다.` };
      }
      await dragBetween(page, target, targetEl);
    } else if (action.type === 'paste') {
      await pasteAt(page, ctx.context, x, y, action.text || '');
    } else if (action.type === 'upload_file') {
      await uploadFileAt(page, x, y, action.fixtureType);
    } else {
      return { ok: false, error: `알 수 없는 action.type: ${action.type}` };
    }
    await settleAfterAction(page);
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

async function clearFocusedField(page) {
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${modifier}+A`);
  await page.keyboard.press('Delete');
}

async function scrollPage(page, action) {
  if (action.direction === 'bottom') {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  } else if (action.direction === 'top') {
    await page.evaluate(() => window.scrollTo(0, 0));
  } else {
    const delta = action.amount || 600;
    await page.mouse.wheel(0, action.direction === 'up' ? -delta : delta);
  }
}

// 시작/끝 좌표만 찍는 게 아니라 중간 지점을 여러 번 거쳐 mousemove 이벤트를 여러 번
// 발생시킨다 — react-beautiful-dnd/dnd-kit 같은 라이브러리는 순간이동이 아니라 실제
// 마우스 이동 이벤트 시퀀스를 봐야 드래그로 인식한다.
async function dragBetween(page, source, targetEl) {
  const s = centerOf(source.box);
  const t = centerOf(targetEl.box);
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  const steps = 10;
  for (let i = 1; i <= steps; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.mouse.move(s.x + ((t.x - s.x) * i) / steps, s.y + ((t.y - s.y) * i) / steps);
  }
  await page.mouse.up();

  // 순수 마우스 이벤트만으로는 네이티브 HTML5 드래그앤드롭(draggable="true" + 브라우저의
  // 내부 DnD 상태 머신)이 안정적으로 안 걸리는 경우가 실제로 있다(the-internet.herokuapp.com
  // /drag_and_drop에서 직접 확인함 — 잘 알려진 자동화 도구들의 공통 난제). react-dnd 같은
  // 라이브러리는 위 마우스 시퀀스만으로 이미 잘 동작하니, 여기서는 dataTransfer를 채운
  // 진짜 DragEvent를 한 번 더 보내서 네이티브 HTML5 DnD도 함께 커버한다. 실패해도 위
  // 마우스 시도가 이미 성공했을 수 있으니 조용히 무시한다.
  await page
    .evaluate(
      ({ sx, sy, tx, ty }) => {
        const source = document.elementFromPoint(sx, sy);
        const target = document.elementFromPoint(tx, ty);
        if (!source || !target) return;
        const dataTransfer = new DataTransfer();
        const fire = (type, el, x, y) => {
          el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer, clientX: x, clientY: y }));
        };
        fire('dragstart', source, sx, sy);
        fire('dragenter', target, tx, ty);
        fire('dragover', target, tx, ty);
        fire('drop', target, tx, ty);
        fire('dragend', source, tx, ty);
      },
      { sx: s.x, sy: s.y, tx: t.x, ty: t.y }
    )
    .catch(() => {});
}

// 실제 clipboard paste 이벤트를 발생시킨다(타이핑 시뮬레이션이 아님) — onKeyDown만 막고
// paste 이벤트는 안 막는 허술한 "붙여넣기 방지" 구현을 정확히 잡아내려면 진짜 붙여넣기여야
// 한다. Camoufox(Firefox)는 clipboard 권한 모델이 달라 실패할 수 있는데, 그 경우도 execOk:
// false로 정직하게 보고된다(아래 executeAction의 catch가 처리).
async function pasteAt(page, context, x, y, text) {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
  await page.mouse.click(x, y);
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${modifier}+V`);
}

// select/upload_file처럼 raw 좌표 클릭이 아니라 Playwright Locator API가 필요한 액션들을
// 위한 공용 헬퍼. 임시 마커 속성을 elementFromPoint로 찾은 요소에 붙였다가, 그걸로
// Locator를 만들어 쓰고 바로 지운다 — 텍스트/좌표 재검색 없이 "그 요소"를 정확히 특정한다.
async function withMarkedLocator(page, x, y, callback) {
  const marker = `data-repliqa-tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await page.evaluate(
    ({ px, py, m }) => {
      const el = document.elementFromPoint(px, py);
      if (el) el.setAttribute(m, '1');
    },
    { px: x, py: y, m: marker }
  );
  try {
    await callback(page.locator(`[${marker}]`));
  } finally {
    await page
      .evaluate((m) => {
        const el = document.querySelector(`[${m}]`);
        if (el) el.removeAttribute(m);
      }, marker)
      .catch(() => {});
  }
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
  await withMarkedLocator(page, x, y, async (locator) => {
    if (action.optionValue) {
      await locator.selectOption({ value: action.optionValue });
    } else {
      await locator.selectOption({ label: action.optionLabel || '' });
    }
  });
}

async function uploadFileAt(page, x, y, fixtureType) {
  const filePath = getFixturePath(fixtureType);
  await withMarkedLocator(page, x, y, async (locator) => {
    await locator.setInputFiles(filePath);
  });
}

const MAX_ACTIVITY_ENTRIES = 80;

// 기존 프로토타입은 console/response만 감시했다. pageerror(자바스크립트 크래시)는
// 기획서가 명시한 핵심 탐지 대상인데 누락돼 있었어서 여기서 추가한다.
//
// activity(networkCalls/consoleLogs/downloads)는 에러가 아닌 것도 포함한 전체 기록이다 —
// 200을 반환해도 응답 바디가 잘못된 경우처럼, "에러는 아니지만 수상한" 호출을 나중에
// 사람이나 코딩 에이전트가 직접 훑어볼 수 있게 남겨둔다. 요청/응답 바디는 로그인 폼 등에서
// 비밀번호 같은 민감정보가 그대로 들어갈 수 있어 일부러 캡처하지 않는다 — method/url/status만.
function attachErrorCollectors(page, collectedErrors, activity = {}) {
  const { networkCalls, consoleLogs, downloads, websocketFrames } = activity;

  // 채팅/실시간 대시보드처럼 WebSocket을 쓰는 화면에서 "끊겼다 재연결됐을 때 누락 데이터가
  // 다시 채워지는지"를 판단하려면 프레임 자체가 보여야 한다 — 연결 종료/재개 시점과 그
  // 전후로 오간 프레임을 기록해둔다(내용은 요약만, 페이로드 전체는 민감정보 위험으로 생략).
  page.on('websocket', (ws) => {
    const push = (event) => {
      if (websocketFrames && websocketFrames.length < MAX_ACTIVITY_ENTRIES) {
        websocketFrames.push({ url: ws.url().slice(0, 200), event, timestamp: new Date().toISOString() });
      }
    };
    push('open');
    ws.on('framesent', () => push('frame_sent'));
    ws.on('framereceived', () => push('frame_received'));
    ws.on('close', () => push('closed'));
    ws.on('socketerror', () => push('error'));
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') collectedErrors.push(`[Console Error] ${msg.text()}`);
    if (consoleLogs && consoleLogs.length < MAX_ACTIVITY_ENTRIES) {
      consoleLogs.push({
        type: msg.type(),
        text: msg.text().slice(0, 300),
        timestamp: new Date().toISOString(),
      });
    }
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      collectedErrors.push(`[Network Error] ${response.status()} ${response.url()}`);
    }
    const resourceType = response.request().resourceType();
    if (networkCalls && networkCalls.length < MAX_ACTIVITY_ENTRIES && (resourceType === 'xhr' || resourceType === 'fetch')) {
      networkCalls.push({
        method: response.request().method(),
        url: response.url().slice(0, 300),
        status: response.status(),
        timestamp: new Date().toISOString(),
      });
    }
  });
  page.on('pageerror', (err) => {
    collectedErrors.push(`[JS Crash] ${err.message}`);
  });
  // 핸들러 없이 alert/confirm/prompt가 뜨면 페이지 실행이 멈춘 채로 멈춰버릴 수 있다 —
  // 자동으로 승인해서 진행시키되, 어떤 다이얼로그가 떴었는지는 로그로 남긴다("취소"
  // 분기까지 테스트하려면 이 자동 승인 자체가 한계라는 걸 리포트에서 알 수 있게).
  page.on('dialog', async (dialog) => {
    if (consoleLogs && consoleLogs.length < MAX_ACTIVITY_ENTRIES) {
      consoleLogs.push({
        type: 'dialog',
        text: `[${dialog.type()}] ${dialog.message()}`.slice(0, 300),
        timestamp: new Date().toISOString(),
      });
    }
    await dialog.accept().catch(() => {});
  });
  // 다운로드가 실제로 완료됐는지, 파일이 비어있지 않은지를 sha256/크기로 남긴다. 대상
  // 파일이 "내용까지 올바른지"는 비교할 기준이 없어 확인할 수 없다 — 그건 리포트에서
  // 사람이 직접 판단해야 하는 부분이라고 명시적으로 한계를 둔다.
  page.on('download', async (download) => {
    try {
      const savePath = path.join(os.tmpdir(), `repliqa-dl-${Date.now()}-${download.suggestedFilename()}`);
      await download.saveAs(savePath);
      const buf = fs.readFileSync(savePath);
      if (downloads && downloads.length < MAX_ACTIVITY_ENTRIES) {
        downloads.push({
          filename: download.suggestedFilename(),
          sizeBytes: buf.length,
          sha256: crypto.createHash('sha256').update(buf).digest('hex'),
          timestamp: new Date().toISOString(),
        });
      }
      fs.unlink(savePath, () => {});
    } catch {
      // 저장 실패는 조용히 무시 — 다운로드 자체를 막을 정도의 문제는 아님
    }
  });
}

module.exports = { executeAction, attachErrorCollectors, centerOf };
