// WebArena 공식 auto_login.py(browser_env/auto_login.py)의 로그인 플로우를 그대로
// Playwright JS로 옮긴 것 — shopping_admin/reddit 두 사이트에 로그인해서 storage_state를
// .auth/에 저장한다. 계정은 WebArena가 자체 데모 샌드박스용으로 공개 문서(env_config.py)에
// 실어둔 테스트 계정이라 실제 사용자 정보가 아니다.
//
// 사용법: node scripts/webarena-bench/login.js
// 환경변수: SHOPPING_ADMIN_URL(기본 http://localhost:7780/admin), REDDIT_URL(기본 http://localhost:9999)

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const SHOPPING_ADMIN_URL = process.env.SHOPPING_ADMIN_URL || 'http://localhost:7780/admin';
const REDDIT_URL = process.env.REDDIT_URL || 'http://localhost:9999';

// 두 사이트 이미지를 다 받을 필요 없이 일부만(용량이 커서 shopping_admin만 받는 경우 등)
// 검증하고 싶을 때, 안 받은 사이트에 로그인 시도하다 통째로 실패하지 않게 필터링한다.
// 기본값(env 없음)은 기존과 동일하게 둘 다.
const SITES = (process.env.WEBARENA_SITES || 'shopping_admin,reddit').split(',').map((s) => s.trim());

const AUTH_DIR = path.join(__dirname, '.auth');

const ACCOUNTS = {
  reddit: { username: 'MarvelsGrantMan136', password: 'test1234' },
  shopping_admin: { username: 'admin', password: 'admin1234' },
};

async function loginShoppingAdmin(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(SHOPPING_ADMIN_URL);
  await page.getByPlaceholder('user name').fill(ACCOUNTS.shopping_admin.username);
  await page.getByPlaceholder('password').fill(ACCOUNTS.shopping_admin.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await context.storageState({ path: path.join(AUTH_DIR, 'shopping_admin_state.json') });
  await context.close();
}

async function loginReddit(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${REDDIT_URL}/login`);
  await page.getByLabel('Username').fill(ACCOUNTS.reddit.username);
  await page.getByLabel('Password').fill(ACCOUNTS.reddit.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await context.storageState({ path: path.join(AUTH_DIR, 'reddit_state.json') });
  await context.close();
}

async function main() {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    if (SITES.includes('shopping_admin')) {
      await loginShoppingAdmin(browser);
      console.log('shopping_admin 로그인 완료 →', path.join(AUTH_DIR, 'shopping_admin_state.json'));
    }
    if (SITES.includes('reddit')) {
      await loginReddit(browser);
      console.log('reddit 로그인 완료 →', path.join(AUTH_DIR, 'reddit_state.json'));
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('로그인 실패:', err);
  process.exit(1);
});
