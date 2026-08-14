const { test } = require('node:test');
const assert = require('node:assert/strict');
const { looksLoggedOut } = require('../src/engine/sessionValidity');

test('looksLoggedOut: 비밀번호 입력란이 있으면 로그아웃 상태로 판단', () => {
  const elements = [{ tag: 'input', type: 'password' }];
  assert.equal(looksLoggedOut('https://example.com/dashboard', elements), true);
});

test('looksLoggedOut: URL이 로그인 경로면 로그아웃 상태로 판단', () => {
  assert.equal(looksLoggedOut('https://example.com/login', []), true);
  assert.equal(looksLoggedOut('https://example.com/auth/signin', []), true);
});

test('looksLoggedOut: Google OAuth 도메인으로 리다이렉트되면 로그아웃 상태로 판단', () => {
  assert.equal(looksLoggedOut('https://accounts.google.com/signin/oauth', []), true);
});

test('looksLoggedOut: 비밀번호 입력란도 없고 로그인 URL도 아니면 로그인된 상태로 판단', () => {
  const elements = [
    { tag: 'button', type: '' },
    { tag: 'input', type: 'email' },
  ];
  assert.equal(looksLoggedOut('https://example.com/dashboard', elements), false);
});

test('looksLoggedOut: URL에 "login"이 부분 문자열로만 포함돼도 오탐하지 않음', () => {
  // "/login-history" 같은 실제 로그인 화면이 아닌 "로그인 기록" 페이지 오탐 방지
  assert.equal(looksLoggedOut('https://example.com/login-history', []), false);
});
