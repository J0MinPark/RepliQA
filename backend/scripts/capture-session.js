// 개발자/사용자가 직접 실행하는 1회성 도구. 소셜 로그인(OAuth)처럼 매번 자동화로
// 뚫기 어려운 로그인을 위해, 헤드리스가 아닌 실제 브라우저 창을 띄워서 사람이 손으로
// 로그인하면 그 세션(쿠키+로컬스토리지)을 캡처해서 RepliQA 서버에 암호화 저장한다.
// 이후 테스트 실행은 이 세션을 그대로 불러와 "이미 로그인된 상태"로 시작하므로, 매번
// 제3자 로그인 화면(구글 등)을 자동화로 통과하려 하지 않는다.
//
// 그런데 "사람이 직접 타이핑"해도 소용없는 경우가 실사용에서 확인됐다 — 구글은 로그인
// 화면 자체가 Playwright로 띄워진 브라우저라는 걸(자동화 시그니처) 감지해서 "이 브라우저
// 또는 앱이 안전하지 않을 수 있습니다"로 원천 차단한다. 누가 타이핑하는지와 무관하게
// 브라우저 자체의 지문을 본다는 뜻이라, 결제 체크포인트에 이미 쓰고 있는 스텔스 엔진
// (Camoufox, browserEngines.js)을 headed 모드로 띄워서 우회한다.
//
// 사용법: node scripts/capture-session.js <targetUrl> <registeredUrlId> <apiKey> [apiBaseUrl]
const { launchBrowser } = require('../src/engine/browserEngines');

async function main() {
  const [, , targetUrl, registeredUrlId, apiKey, apiBaseUrl] = process.argv;
  if (!targetUrl || !registeredUrlId || !apiKey) {
    console.error('사용법: node scripts/capture-session.js <targetUrl> <registeredUrlId> <apiKey> [apiBaseUrl]');
    process.exit(1);
  }
  const baseUrl = apiBaseUrl || process.env.REPLIQA_API_BASE_URL || 'http://localhost:3001';

  const { browser, contextOptions } = await launchBrowser({ stealth: true, headless: false });
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  await page.goto(targetUrl);

  console.log('브라우저 창에서 직접 로그인(소셜 로그인 포함)을 완료하세요.');
  console.log('로그인 완료 후 이 터미널로 돌아와서 Enter를 누르세요.');
  await new Promise((resolve) => {
    process.stdin.once('data', resolve);
  });

  const storageState = await context.storageState();
  const res = await fetch(`${baseUrl}/api/urls/${registeredUrlId}/test-session`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-RepliQA-Api-Key': apiKey },
    body: JSON.stringify({ storageState }),
  });
  if (!res.ok) {
    console.error('저장 실패:', await res.text());
    process.exit(1);
  }
  console.log('세션이 저장됐습니다. 이후 이 URL로 실행하는 테스트는 로그인된 상태로 시작합니다.');
  await browser.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
