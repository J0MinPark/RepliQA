const { chromium } = require('playwright');
const { Camoufox } = require('camoufox-js');

const VIEWPORT = { width: 1280, height: 800 };

// 대상 사이트의 WAF/CDN이 저희 트래픽을 정당한 QA로 식별해서 예외 처리할 수 있게, 모든
// 요청에 이 헤더를 붙인다 — 실제 사용자 트래픽에는 절대 없는 값이라 오탐 없이 필터링할
// 수 있다. 소유권 검증을 마친 고객이 자기 보안팀에 "이 헤더가 붙은 요청은 저희가 요청한
// QA입니다"라고 전달하는 용도. README의 WAF 허용 목록 안내와 짝을 이룬다.
const IDENTIFYING_HEADERS = { 'X-RepliQA-Test': 'true' };

// 모든 런을 Camoufox(엔진 레벨 지문 패치가 들어간 스텔스 Firefox 포크)로 띄운다.
// 원래는 PG 결제 위젯의 봇 탐지가 특히 정교해서 결제 체크포인트에만 썼는데, 일반 탐색
// 단계도 첫 페이지 로드부터 WAF에 막히는 사례가 실제로 있었다(navigator.webdriver 등
// Chromium 헤드리스 신호가 그대로 노출됐기 때문) — 소유권 검증을 통과한 대상에게만
// 도달하는 코드 경로이므로, 오탐을 줄이는 쪽을 기본값으로 삼는다.
// camoufox-js가 반환하는 건 표준 Playwright Browser라, 호출부(capture.js/executor.js)는
// 어느 엔진인지 몰라도 그대로 동작한다. chromium 경로는 비교/폴백용으로 남겨둔다.
//
// 알려진 한계: Chromium의 --host-resolver-rules 같은 per-host IP 고정 옵션이 Firefox
// 쪽엔 깔끔하게 없다. resolveSafeIp()로 사설 IP·클라우드 메타데이터 여부는 그대로
// 검증하지만, DNS 리바인딩(검증 시점 이후 IP가 바뀌는) 방지 하드닝은 스텔스 경로에서는
// 아직 없다 — 후속 과제로 남겨둔다.
async function launchBrowser({ stealth, hostname, pinnedIp, headless = true }) {
  if (stealth) {
    const browser = await Camoufox({
      headless,
      window: [VIEWPORT.width, VIEWPORT.height],
      block_webrtc: true, // 실제 IP가 WebRTC로 새는 것도 같이 막음
      humanize: true, // 마우스 이동에 사람처럼 지연/궤적을 줌
    });
    // Camoufox 공식 권장: newContext에 고정 viewport를 주면 window 크기 고정과 충돌해
    // 두 번째 newPage()가 행(hang)할 수 있다(daijro/camoufox#666) — viewport: null로
    // 두고 launch 시점의 window 크기에 맡긴다.
    return {
      browser,
      contextOptions: { viewport: null, acceptDownloads: true, extraHTTPHeaders: IDENTIFYING_HEADERS },
    };
  }

  const browser = await chromium.launch({
    headless: true,
    args: [`--host-resolver-rules=MAP ${hostname} ${pinnedIp}`],
  });
  return {
    browser,
    contextOptions: { viewport: VIEWPORT, acceptDownloads: true, extraHTTPHeaders: IDENTIFYING_HEADERS },
  };
}

module.exports = { launchBrowser, VIEWPORT, IDENTIFYING_HEADERS };
