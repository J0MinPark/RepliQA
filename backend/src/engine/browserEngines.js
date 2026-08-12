const { chromium } = require('playwright');
const { Camoufox } = require('camoufox-js');

const VIEWPORT = { width: 1280, height: 800 };

// stealth=false: 기존 Chromium 경로(SSRF IP 고정 포함) — 대부분의 여정에 씀.
// stealth=true: Camoufox(엔진 레벨 지문 패치가 들어간 스텔스 Firefox 포크) — PG 결제
// 위젯처럼 정교한 봇 탐지(Cloudflare/DataDome류)를 우회해야 하는 결제 체크포인트 전용.
// camoufox-js가 반환하는 건 표준 Playwright Browser라, 호출부(capture.js/executor.js)는
// 어느 엔진인지 몰라도 그대로 동작한다.
//
// 알려진 한계: Chromium의 --host-resolver-rules 같은 per-host IP 고정 옵션이 Firefox
// 쪽엔 깔끔하게 없다. resolveSafeIp()로 사설 IP·클라우드 메타데이터 여부는 그대로
// 검증하지만, DNS 리바인딩(검증 시점 이후 IP가 바뀌는) 방지 하드닝은 스텔스 경로에서는
// 아직 없다 — 후속 과제로 남겨둔다.
async function launchBrowser({ stealth, hostname, pinnedIp }) {
  if (stealth) {
    const browser = await Camoufox({
      headless: true,
      window: [VIEWPORT.width, VIEWPORT.height],
      block_webrtc: true, // 실제 IP가 WebRTC로 새는 것도 같이 막음
      humanize: true, // 마우스 이동에 사람처럼 지연/궤적을 줌
    });
    // Camoufox 공식 권장: newContext에 고정 viewport를 주면 window 크기 고정과 충돌해
    // 두 번째 newPage()가 행(hang)할 수 있다(daijro/camoufox#666) — viewport: null로
    // 두고 launch 시점의 window 크기에 맡긴다.
    return { browser, contextOptions: { viewport: null } };
  }

  const browser = await chromium.launch({
    headless: true,
    args: [`--host-resolver-rules=MAP ${hostname} ${pinnedIp}`],
  });
  return { browser, contextOptions: { viewport: VIEWPORT } };
}

module.exports = { launchBrowser, VIEWPORT };
