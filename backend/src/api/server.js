const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const env = require('../config/env');
const { generalLimiter } = require('./middleware/rateLimit');
const tenantsRouter = require('./routes/tenants');
const urlsRouter = require('./routes/urls');
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
app.use(express.json({ limit: '256kb' }));
app.use(generalLimiter);

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/tenants', tenantsRouter);
app.use('/api/urls', urlsRouter);
app.use('/api/test-runs', testRunsRouter);
app.use('/api/personas', personasRouter);
app.use('/api/usage', usageRouter);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
});

app.listen(env.port, () => {
  console.log(`🚀 RepliQA API 서버가 http://localhost:${env.port} 에서 실행 중입니다.`);
  console.log(`   Firebase emulator mode: ${env.firebaseUseEmulator}`);
});
