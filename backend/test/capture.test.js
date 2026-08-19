const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { captureState } = require('../src/engine/capture');

test('captureState: 텍스트·aria-label 없이 title만 있는 아이콘 버튼도 selectorHint.name에 title이 들어간다', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    // 15개 미만이면 captureState가 "아직 로딩 중"으로 보고 최대 8번(각 800ms) 재시도
    // 하므로, 더미 버튼을 채워 그 재시도 루프를 건너뛰고 테스트를 빠르게 유지한다.
    const filler = Array.from({ length: 14 }, (_, i) => `<button>filler ${i}</button>`).join('');
    await page.setContent(`<button id="icon-btn" title="검색"><i class="icon"></i></button>${filler}`);

    const state = await captureState(page);
    // 텍스트/aria-label이 없어 title로 폴백된 경우, text 필드 자체가 title 값으로
    // 채워진다(computeSelectorHint는 이 text를 그대로 selectorHint.name에 쓴다).
    const iconBtn = state.elements.find((el) => el.tag === 'button' && el.text === '검색');
    assert.ok(iconBtn, '아이콘 버튼이 title 값을 text로 캡처된 채 요소 목록에 있어야 함');
    assert.deepEqual(iconBtn.selectorHint, { role: 'button', name: '검색' });
  } finally {
    await browser.close();
  }
});
