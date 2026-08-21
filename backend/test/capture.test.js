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

test('captureState: 뷰포트 절반 이상을 덮는 요소에만 coversMostOfScreen이 붙는다', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    // 15개 미만이면 captureState가 "아직 로딩 중"으로 보고 재시도 루프를 타므로,
    // backdrop+realClose(2개) + filler(13개) = 15개로 맞춰 그 루프를 건너뛴다.
    const filler = Array.from({ length: 13 }, (_, i) => `<button>filler ${i}</button>`).join('');
    await page.setContent(`
      <button id="backdrop" aria-label="팝업 닫기" style="position:fixed;inset:0;width:100%;height:100%;"></button>
      <button id="real-close">닫기</button>
      ${filler}
    `);

    const state = await captureState(page);
    const backdrop = state.elements.find((el) => el.selectorHint?.name === '팝업 닫기');
    const realClose = state.elements.find((el) => el.text === '닫기');

    assert.ok(backdrop, '백드롭 버튼이 캡처돼야 함');
    assert.equal(backdrop.coversMostOfScreen, true, '뷰포트 전체를 덮는 요소는 coversMostOfScreen: true여야 함');
    assert.ok(realClose, '작은 닫기 버튼이 캡처돼야 함');
    assert.equal(realClose.coversMostOfScreen, undefined, '작은 버튼엔 coversMostOfScreen이 아예 안 붙어야 함(페이로드 절약)');
  } finally {
    await browser.close();
  }
});

test('captureState: goalText를 주면 목표 문장과 겹치는 뷰포트 밖 요소가 잘림 순서에서 우선된다', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    // 뷰포트를 작게 잡아 "화면 안" 티어와 "화면 밖" 티어를 확실히 나눈다.
    const page = await browser.newPage({ viewport: { width: 800, height: 200 } });
    const aboveFold = Array.from({ length: 3 }, (_, i) => `<button>above ${i}</button>`).join('');
    // target을 18번째(뒤쪽)에 둬서, 순수 위치 정렬로는 maxElements 안에 못 들어오게 한다.
    const belowFold = Array.from({ length: 20 }, (_, i) =>
      i === 17
        ? `<div style="height:50px"><button>학습 관리 방식 확인용 버튼</button></div>`
        : `<div style="height:50px"><button>filler ${i}</button></div>`
    ).join('');
    await page.setContent(`${aboveFold}${belowFold}`);

    const withoutGoal = await captureState(page, { maxElements: 10 });
    assert.ok(
      !withoutGoal.elements.some((el) => el.text.includes('학습 관리')),
      'goalText 없이는(기존 동작) 뒤쪽 목표 요소가 잘려나가야 함'
    );

    const withGoal = await captureState(page, { maxElements: 10, goalText: '학습 관리 방식과 멘토 소개 확인' });
    assert.ok(
      withGoal.elements.some((el) => el.text.includes('학습 관리')),
      'goalText를 주면 목표와 겹치는 요소가 우선돼 잘림에서 살아남아야 함'
    );
  } finally {
    await browser.close();
  }
});
