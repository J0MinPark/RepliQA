const rateLimit = require('express-rate-limit');

// 전역 남용 방지용 기본 한도. 테넌트별 실제 쿼터(동시실행/일일횟수)는
// db/quota.js가 담당하고, 이건 그 앞단의 값싼 1차 방어선이다.
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

const testRunCreationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '테스트 생성 요청이 너무 잦습니다. 잠시 후 다시 시도하세요.' },
});

module.exports = { generalLimiter, testRunCreationLimiter };
