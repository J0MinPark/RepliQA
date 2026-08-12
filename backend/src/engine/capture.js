// 브라우저 컨텍스트 안에서 실행되는 함수 — page.evaluate와 frame.evaluate 양쪽에
// 그대로 재사용한다(이니시스/토스페이먼츠 위젯처럼 결제 UI가 iframe으로 삽입되는
// 경우가 흔해서, 메인 문서만 보면 결제 폼 안의 입력창을 아예 못 찾는다).
function extractInteractiveElements(max) {
  const selector =
    'button, a, input, textarea, select, [role="button"], [role="link"], [role="checkbox"], [role="tab"], [draggable="true"]';
  const nodes = Array.from(document.querySelectorAll(selector));
  const items = [];
  for (const el of nodes) {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const visible =
      rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    if (!visible) continue;

    const text = (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || '')
      .trim()
      .slice(0, 80);

    const item = {
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || '',
      role: el.getAttribute('role') || '',
      text,
      box: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      inViewport: rect.top >= 0 && rect.top < window.innerHeight,
    };

    // 네이티브 <select>는 헤드리스 브라우저에서 옵션 목록이 스크린샷에 안 보이므로
    // 텍스트로 옵션을 같이 넘겨줘야 LLM이 뭘 고를 수 있는지 알 수 있다.
    if (el.tagName.toLowerCase() === 'select') {
      item.options = Array.from(el.options)
        .slice(0, 30)
        .map((o) => ({ value: o.value, label: o.text.trim() }));
    }

    items.push(item);
  }
  return items.slice(0, max);
}

// 현재 페이지에 떠 있는 iframe들(같은 origin이든 다르든 Playwright가 접근 가능한 것)을
// 훑어서 요소를 뽑고, iframe 자체의 화면상 좌표만큼 offset을 더해 메인 페이지 좌표계로
// 맞춘다 — 그래야 스크린샷 좌표와 일치해서 executor.js가 그대로 클릭할 수 있다.
async function extractFromFrames(page, maxElements) {
  const collected = [];
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    try {
      const frameElementHandle = await frame.frameElement();
      const frameBox = await frameElementHandle.boundingBox();
      if (!frameBox) continue;
      const frameItems = await frame.evaluate(extractInteractiveElements, maxElements);
      for (const item of frameItems) {
        item.box.x += frameBox.x;
        item.box.y += frameBox.y;
        item.inFrame = true;
      }
      collected.push(...frameItems);
    } catch {
      // cross-origin이라 접근이 막혔거나, 이미 detach된 frame — 조용히 건너뜀
    }
  }
  return collected;
}

// 스크린샷 + bounding box 기반 요소 목록을 함께 뽑는다. DOM 텍스트 매칭만으로
// 요소를 찾던 기존 방식(getByText)은 동일 텍스트 중복/숨김 요소에서 잘 깨졌는데,
// 좌표를 같이 넘기면 실행 단계에서 텍스트 매칭 없이 바로 클릭할 수 있다.
// 프레임워크(React/Vue/vanilla)에 상관없이 "화면에 보이는 대로" 판단하므로 일반성도 좋다.
function isContextDestroyedError(err) {
  return /Execution context was destroyed|Target closed|Target page.*closed/i.test(err?.message || '');
}

async function captureState(page, { maxElements = 40 } = {}) {
  let pageElements;
  try {
    pageElements = await page.evaluate(extractInteractiveElements, maxElements);
  } catch (err) {
    // 클릭이 곧바로 네비게이션을 일으킨 직후라 문서가 막 교체되는 순간과 겹친 경우 —
    // 새 문서가 자리잡을 시간을 한 번 주고 다시 시도한다(구글 검색 결과 페이지 이동에서
    // 실제로 재현됨). 그래도 안 되면 원래 에러를 그대로 올려서 숨기지 않는다.
    if (!isContextDestroyedError(err)) throw err;
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
    pageElements = await page.evaluate(extractInteractiveElements, maxElements);
  }
  const frameElements = await extractFromFrames(page, maxElements);

  const merged = [...pageElements, ...frameElements].sort(
    (a, b) => Number(b.inViewport) - Number(a.inViewport)
  );
  const indexed = merged.slice(0, maxElements).map((el, index) => ({ index, ...el }));

  // jpeg 저품질 압축 — 비전 모델 토큰 비용을 낮추는 가장 값싼 지렛대.
  const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 55 });

  return {
    screenshotBase64: screenshotBuffer.toString('base64'),
    screenshotBuffer,
    elements: indexed,
    url: page.url(),
    title: await page.title(),
  };
}

module.exports = { captureState };
