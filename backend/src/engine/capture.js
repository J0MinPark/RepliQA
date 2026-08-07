// 스크린샷 + bounding box 기반 요소 목록을 함께 뽑는다. DOM 텍스트 매칭만으로
// 요소를 찾던 기존 방식(getByText)은 동일 텍스트 중복/숨김 요소에서 잘 깨졌는데,
// 좌표를 같이 넘기면 실행 단계에서 텍스트 매칭 없이 바로 클릭할 수 있다.
// 프레임워크(React/Vue/vanilla)에 상관없이 "화면에 보이는 대로" 판단하므로 일반성도 좋다.
async function captureState(page, { maxElements = 40 } = {}) {
  const elements = await page.evaluate((max) => {
    const selector =
      'button, a, input, textarea, select, [role="button"], [role="link"], [role="checkbox"], [role="tab"]';
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

      items.push({
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
      });
    }
    // 화면에 보이는(뷰포트 안) 요소를 모델에게 우선적으로 보여준다.
    items.sort((a, b) => Number(b.inViewport) - Number(a.inViewport));
    return items.slice(0, max);
  }, maxElements);

  const indexed = elements.map((el, index) => ({ index, ...el }));

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
