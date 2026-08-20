const { WebSocketServer } = require('ws');
const net = require('net');
const { getCapture, touchCapture } = require('./remoteSessionCapture');

// noVNC(RFB 클라이언트)는 브라우저 WebSocket 위에 raw VNC(RFB) 바이트를 그대로 실어 보낸다
// — websockify가 하는 일이 정확히 "WS 바이너리 프레임 ↔ raw TCP 바이트"의 무변형 중계라서,
// 별도 websockify 프로세스 없이 여기서 직접 구현한다. 세션 캡처 경로(/session-capture/:id/vnc)로
// 들어온 업그레이드 요청만 가로채고, 나머지는 그대로 통과시켜야 다른 업그레이드 핸들러와
// 충돌하지 않는다.
const CAPTURE_PATH = /^\/session-capture\/([a-f0-9]{48})\/vnc(?:\?.*)?$/;

function attachVncProxy(httpServer) {
  const wss = new WebSocketServer({ noServer: true, handleProtocols: () => 'binary' });

  httpServer.on('upgrade', (req, socket, head) => {
    const match = req.url.match(CAPTURE_PATH);
    if (!match) return; // 이 프록시 대상이 아님 — 다른 upgrade 리스너가 있다면 그쪽에서 처리

    const captureId = match[1];
    const handle = getCapture(captureId);
    if (!handle) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => relay(ws, handle));
  });
}

function relay(ws, handle) {
  touchCapture(handle.captureId);
  const tcp = net.connect(handle.rfbPort, '127.0.0.1');

  const cleanup = () => {
    tcp.destroy();
    if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close();
  };

  tcp.on('connect', () => {
    ws.on('message', (data) => {
      touchCapture(handle.captureId);
      tcp.write(data);
    });
    tcp.on('data', (chunk) => {
      if (ws.readyState === ws.OPEN) ws.send(chunk);
    });
  });

  tcp.on('error', cleanup);
  tcp.on('close', cleanup);
  ws.on('close', cleanup);
  ws.on('error', cleanup);
}

module.exports = { attachVncProxy };
