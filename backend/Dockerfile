# Render의 네이티브 Node 런타임(buildpack)은 apt 패키지 설치 권한(root)이 없어서, 원격
# 브라우저 세션 캡처(Xvfb+x11vnc)에 필요한 시스템 패키지를 못 넣는다 — 그래서 이 워커만
# Docker 런타임으로 배포한다(render.yaml). 베이스는 Playwright 공식 이미지를 써서 Camoufox
# (Firefox 기반)가 필요로 하는 브라우저 실행 라이브러리를 직접 나열하는 위험을 피한다.
FROM mcr.microsoft.com/playwright:v1.58.2-noble

WORKDIR /app

# xvfb: 헤드가 없는 컨테이너에서 "화면이 있는" 브라우저를 띄우기 위한 가상 디스플레이.
# x11vnc: 그 가상 디스플레이를 VNC(RFB)로 노출 — WS 브리지는 별도 프로세스 없이
# remoteSessionProxy.js가 raw TCP 바이트를 그대로 중계한다(websockify 불필요).
# build-essential: better-sqlite3가 npm ci 중 네이티브 모듈을 컴파일한다(node-gyp가 make를 씀).
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    x11vnc \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Camoufox 바이너리(스텔스 패치가 들어간 Firefox 포크) 다운로드 — 런타임에 매번 받으면
# 콜드스타트가 느려지므로 빌드 시점에 미리 받아둔다.
RUN npx camoufox-js fetch

ENV NODE_ENV=production

CMD ["node", "src/worker/worker.js"]
