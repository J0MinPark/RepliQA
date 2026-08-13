const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const env = require('../config/env');
const { generalLimiter } = require('./middleware/rateLimit');
const tenantsRouter = require('./routes/tenants');
const urlsRouter = require('./routes/urls');
const routesRouter = require('./routes/routes');
const testRunsRouter = require('./routes/testRuns');
const personasRouter = require('./routes/personas');
const usageRouter = require('./routes/usage');

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.frontendOrigin,
    credentials: true,
  })
);
// 대부분의 요청은 훨씬 작지만, test-session(로그인 세션 캡처)은 쿠키+로컬스토리지
// 전체를 통째로 보낸다 — Notion처럼 무거운 SPA는 로그인 후 로컬스토리지에 수백KB~수MB를
// 쌓아두는 게 흔해서(실제로 1.3MB짜리 요청이 거부되는 걸 확인함), 256kb는 이 용도엔
// 너무 작았다.
app.use(express.json({ limit: '5mb' }));
app.use(generalLimiter);

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/tenants', tenantsRouter);
app.use('/api/urls', urlsRouter);
app.use('/api/routes', routesRouter);
app.use('/api/test-runs', testRunsRouter);
app.use('/api/personas', personasRouter);
app.use('/api/usage', usageRouter);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
});

// Vercel은 이 파일을 함수로 import해서 직접 요청을 넘겨주므로 listen()을 호출하면 안 되고,
// 로컬(`node src/api/server.js`)로 직접 실행했을 때만 포트를 연다.
if (require.main === module) {
  app.listen(env.port, () => {
    console.log(`🚀 RepliQA API 서버가 http://localhost:${env.port} 에서 실행 중입니다.`);
    console.log(`   Firebase emulator mode: ${env.firebaseUseEmulator}`);
  });
}

module.exports = app;
