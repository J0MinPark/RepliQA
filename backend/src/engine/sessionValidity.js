// 캡처해둔 로그인 세션(storageState)을 불러와서 시작했는데도 로그인 화면이 나온다면,
// 세션이 만료됐거나(쿠키 유효기간 종료) 서버 쪽에서 무효화된 것이다(비밀번호 변경, 의심스러운
// 활동 탐지 등). 소셜 로그인은 매번 자동화로 다시 뚫을 방법이 없으므로(capture-session.js의
// 존재 이유 자체가 이거다), 이 상태를 "사이트에 실제로 있는 버그"와 구분해서 명확히 보고해야
// 한다 — 구분 없이 그냥 실패로 보고하면 바이브 코더가 애먼 코드를 고치려 든다.
const AUTH_URL_PATTERN = /\/(login|signin|sign-in|log-in|auth)(?:[/?#]|$)/i;
const OAUTH_HOST_PATTERN = /accounts\.google\.com|login\.microsoftonline\.com|github\.com\/login|appleid\.apple\.com/i;

function looksLoggedOut(pageUrl, elements) {
  const hasPasswordField = (elements || []).some((el) => el.tag === 'input' && el.type === 'password');
  const onAuthUrl = AUTH_URL_PATTERN.test(pageUrl || '') || OAUTH_HOST_PATTERN.test(pageUrl || '');
  return hasPasswordField || onAuthUrl;
}

module.exports = { looksLoggedOut };
