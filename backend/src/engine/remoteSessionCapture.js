const { spawn } = require('child_process');
const net = require('net');
const crypto = require('crypto');
const { Camoufox } = require('camoufox-js');
const { VIEWPORT, IDENTIFYING_HEADERS } = require('./browserEngines');

// 비개발자가 터미널 없이 소셜 로그인 세션을 캡처할 수 있게, 서버가 대신 "화면이 있는"
// 브라우저를 띄워서 그 화면을 실시간으로 프론트에 보여준다. Camoufox는 Firefox 기반이라
// Chromium 전용 CDP 스크린캐스트가 없고, Playwright의 Firefox 지원(Juggler)도 화면
// 스트리밍 API를 안 준다 — 그래서 실제 가상 디스플레이(Xvfb) + VNC 서버(x11vnc) 조합이
// 최소 구성이다. VNC↔WebSocket 브리지(websockify 역할)는 별도 프로세스 없이
// remoteSessionProxy.js가 raw TCP 소켓을 그대로 WS 바이너리 프레임으로 중계해서 대신한다.
//
// Camoufox 자체에도 headless:'virtual' 내장 가상 디스플레이가 있지만(virtdisplay.js),
// 그건 화면 크기가 1x1로 고정된 "아무도 안 보는" 용도라 사람이 보고 로그인할 우리
// 용도엔 못 쓴다 — 그래서 Xvfb를 직접 관리하고, env.DISPLAY로 그 디스플레이를
// Camoufox에 지정해서 넘긴다(camoufox-js의 headless:'virtual' 내부 구현과 같은 메커니즘).
const SCREEN = '1280x800x24';
const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15분 이상 아무 조작 없으면 자동 정리
const STARTUP_TIMEOUT_MS = 15_000;

const captures = new Map(); // captureId -> handle
const captureIdByTenant = new Map(); // tenantId -> captureId (테넌트당 동시 캡처 1건 제한)
let nextDisplayNum = 90; // 워커 프로세스 하나당 순차 할당(같은 컨테이너에 다른 Xvfb가 없다고 가정)

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function waitForPort(port, host, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    (function attempt() {
      const sock = net.connect(port, host);
      sock.once('connect', () => {
        sock.destroy();
        resolve();
      });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() > deadline) return reject(new Error(`포트 ${port}가 응답하지 않습니다.`));
        setTimeout(attempt, 150);
      });
    })();
  });
}

// stderr를 모아뒀다가 실패 시 에러 메시지에 붙인다 — Xvfb/x11vnc는 디스플레이 충돌 같은
// 흔한 실패 원인을 종료 코드만으로는 알려주지 않고 stderr로만 알려준다.
function captureStderr(proc) {
  let buf = '';
  proc.stderr?.on('data', (chunk) => {
    buf += chunk;
  });
  return () => buf.trim();
}

// spawn 이벤트만 보고 성공으로 치면, "디스플레이 이미 사용 중" 같은 이유로 spawn 직후
// 바로 죽는 경우를 놓친다 — 유예 시간 뒤에도 실제로 살아있는지 다시 확인한다.
function waitForAlive(proc, ms) {
  const readStderr = captureStderr(proc);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('프로세스 시작 시간 초과')), ms);
    let spawned = false;
    proc.once('spawn', () => {
      spawned = true;
      clearTimeout(timer);
      // 소켓/디스플레이가 완전히 준비됐는지는 호출부가 각자 waitForPort 등으로 다시
      // 확인하니, 여기서는 "spawn 직후 즉시 죽지는 않았는지"만 짧게 지켜본다.
      setTimeout(() => {
        if (proc.exitCode !== null || proc.killed) {
          reject(new Error(`프로세스가 시작 직후 종료됨(code=${proc.exitCode}): ${readStderr() || '(stderr 없음)'}`));
        } else {
          resolve();
        }
      }, 300);
    });
    proc.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.once('exit', (code) => {
      if (!spawned) return; // spawn 이전 exit은 위 'error' 핸들러가 이미 처리
      clearTimeout(timer);
      if (code !== 0 && code !== null) reject(new Error(`프로세스가 종료됨(code=${code}): ${readStderr() || '(stderr 없음)'}`));
    });
  });
}

async function teardown(handle) {
  clearTimeout(handle.idleTimer);
  captures.delete(handle.captureId);
  if (captureIdByTenant.get(handle.tenantId) === handle.captureId) {
    captureIdByTenant.delete(handle.tenantId);
  }
  await handle.browser?.close().catch(() => {});
  handle.x11vncProc?.kill();
  handle.xvfbProc?.kill();
}

function touchCapture(captureId) {
  const handle = captures.get(captureId);
  if (!handle) return;
  clearTimeout(handle.idleTimer);
  handle.idleTimer = setTimeout(() => {
    teardown(handle).catch(() => {});
  }, IDLE_TIMEOUT_MS);
}

// targetUrl은 이미 registeredUrls에 등록·검증된 URL만 호출부(routes)에서 넘겨준다.
async function startCapture({ tenantId, targetUrl }) {
  const existingId = captureIdByTenant.get(tenantId);
  if (existingId && captures.has(existingId)) {
    throw new Error('이미 진행 중인 세션 캡처가 있습니다. 먼저 종료하거나 취소해주세요.');
  }

  const captureId = crypto.randomBytes(24).toString('hex');
  const displayNum = nextDisplayNum++;

  const xvfbProc = spawn('Xvfb', [`:${displayNum}`, '-screen', '0', SCREEN, '-nolisten', 'tcp'], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  try {
    await waitForAlive(xvfbProc, STARTUP_TIMEOUT_MS);
  } catch (err) {
    xvfbProc.kill();
    throw new Error(`가상 디스플레이를 시작하지 못했습니다: ${err.message}`);
  }

  let rfbPort;
  let x11vncProc;
  try {
    rfbPort = await getFreePort();
    x11vncProc = spawn(
      'x11vnc',
      ['-display', `:${displayNum}`, '-rfbport', String(rfbPort), '-localhost', '-nopw', '-shared', '-forever', '-noxdamage', '-quiet'],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );
    await waitForAlive(x11vncProc, STARTUP_TIMEOUT_MS);
    await waitForPort(rfbPort, '127.0.0.1', STARTUP_TIMEOUT_MS);
  } catch (err) {
    xvfbProc.kill();
    x11vncProc?.kill();
    throw new Error(`VNC 서버를 시작하지 못했습니다: ${err.message}`);
  }

  let browser;
  let context;
  let page;
  try {
    browser = await Camoufox({
      headless: false,
      window: [VIEWPORT.width, VIEWPORT.height],
      block_webrtc: true,
      humanize: true,
      // env를 넘기지 않으면 camoufox-js가 process.env를 그대로 참조해버려서(공유 참조),
      // 동시에 여러 캡처가 뜨면 서로 DISPLAY를 덮어쓴다 — 반드시 이 캡처 전용 사본을 넘긴다.
      env: { ...process.env, DISPLAY: `:${displayNum}` },
    });
    context = await browser.newContext({
      viewport: null,
      acceptDownloads: true,
      extraHTTPHeaders: IDENTIFYING_HEADERS,
    });
    page = await context.newPage();
    // 첫 이동이 느리거나 실패해도 원격 화면 자체는 이미 살아있으니 캡처를 계속 진행한다
    // — 사용자가 화면 안에서 직접 새로고침하거나 주소를 다시 입력할 수 있다.
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
  } catch (err) {
    await browser?.close().catch(() => {});
    xvfbProc.kill();
    x11vncProc.kill();
    throw new Error(`브라우저를 시작하지 못했습니다: ${err.message}`);
  }

  const handle = {
    captureId,
    tenantId,
    targetUrl,
    displayNum,
    rfbPort,
    xvfbProc,
    x11vncProc,
    browser,
    context,
    page,
    createdAt: Date.now(),
  };
  captures.set(captureId, handle);
  captureIdByTenant.set(tenantId, captureId);
  touchCapture(captureId);
  return { captureId };
}

async function finishCapture(captureId) {
  const handle = captures.get(captureId);
  if (!handle) throw new Error('세션 캡처를 찾을 수 없습니다(만료되었거나 이미 종료됐을 수 있습니다).');
  const storageState = await handle.context.storageState();
  await teardown(handle);
  return storageState;
}

async function cancelCapture(captureId) {
  const handle = captures.get(captureId);
  if (!handle) return;
  await teardown(handle);
}

function getCapture(captureId) {
  return captures.get(captureId);
}

module.exports = { startCapture, finishCapture, cancelCapture, getCapture, touchCapture };
