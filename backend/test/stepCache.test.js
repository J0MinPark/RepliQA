const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const {
  isFastPathEligible,
  hashCacheKey,
  tryFastPathAction,
} = require('../src/engine/stepCache');

test('hashCacheKey: 같은 registeredUrlId+goal은 항상 같은 해시(결정적)', () => {
  assert.equal(hashCacheKey('url1', '로그인하기'), hashCacheKey('url1', '로그인하기'));
});

test('hashCacheKey: registeredUrlId나 goal이 다르면 다른 해시', () => {
  assert.notEqual(hashCacheKey('url1', '로그인하기'), hashCacheKey('url2', '로그인하기'));
  assert.notEqual(hashCacheKey('url1', '로그인하기'), hashCacheKey('url1', '장바구니 담기'));
});

test('isFastPathEligible: click/hover + resolvedSelector가 있어야 true', () => {
  assert.equal(isFastPathEligible({ type: 'click', resolvedSelector: { role: 'button', name: '제출' } }), true);
  assert.equal(isFastPathEligible({ type: 'hover', resolvedSelector: { role: 'link', name: '메뉴' } }), true);
});

test('isFastPathEligible: type/paste/select는 셀렉터가 있어도 false(입력값은 매번 다를 수 있음)', () => {
  assert.equal(isFastPathEligible({ type: 'type', resolvedSelector: { role: 'textbox', name: 'ID' }, text: 'abc' }), false);
  assert.equal(isFastPathEligible({ type: 'paste', resolvedSelector: { role: 'textbox', name: 'ID' } }), false);
  assert.equal(isFastPathEligible({ type: 'select', resolvedSelector: { role: 'combobox', name: '옵션' } }), false);
});

test('isFastPathEligible: resolvedSelector가 없으면(예: finish) false', () => {
  assert.equal(isFastPathEligible({ type: 'click' }), false);
  assert.equal(isFastPathEligible({ type: 'finish' }), false);
});

test('tryFastPathAction: 정확히 1개·보이는 요소면 실제로 클릭한다', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<button id="btn">장바구니 담기</button><script>window.__clicked=false;document.getElementById("btn").onclick=()=>{window.__clicked=true;};</script>');
    const result = await tryFastPathAction(page, {
      action: { type: 'click', resolvedSelector: { role: 'button', name: '장바구니 담기' } },
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(await page.evaluate(() => window.__clicked), true);
  } finally {
    await browser.close();
  }
});

test('tryFastPathAction: 같은 role+이름이 2개면 애매하니 null(폴백 신호)', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<button>저장</button><button>저장</button>');
    const result = await tryFastPathAction(page, {
      action: { type: 'click', resolvedSelector: { role: 'button', name: '저장' } },
    });
    assert.equal(result, null);
  } finally {
    await browser.close();
  }
});

test('tryFastPathAction: 요소가 아예 없으면(사이트가 바뀜) null(폴백 신호)', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<p>버튼이 없는 페이지</p>');
    const result = await tryFastPathAction(page, {
      action: { type: 'click', resolvedSelector: { role: 'button', name: '저장' } },
    });
    assert.equal(result, null);
  } finally {
    await browser.close();
  }
});

test('tryFastPathAction: type/paste 같은 캐시 대상 아닌 액션은 시도 자체를 안 하고 null', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<input aria-label="아이디" />');
    const result = await tryFastPathAction(page, {
      action: { type: 'type', resolvedSelector: { role: 'textbox', name: '아이디' }, text: 'someone' },
    });
    assert.equal(result, null);
  } finally {
    await browser.close();
  }
});

test('tryFastPathAction: 숨겨진(비표시) 요소면 null(폴백 신호)', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<button style="display:none">저장</button>');
    const result = await tryFastPathAction(page, {
      action: { type: 'click', resolvedSelector: { role: 'button', name: '저장' } },
    });
    assert.equal(result, null);
  } finally {
    await browser.close();
  }
});
