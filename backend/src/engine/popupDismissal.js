// 체크포인트 루프(비전 LLM)가 시작되기 전에, 화면에 뜬 "닫기"류 팝업/모달을 결정론적으로
// 먼저 정리한다. 실사이트(yureka.co.kr) 실측 재현: 팝업 안에 정상 크기의 "닫기" 버튼과,
// 화면 전체를 덮는 배경 클릭-닫기 버튼(aria-label="팝업 닫기", 뷰포트 전체 크기)이 함께
// 캡처되면, 비전 모델이 "둘 다 화면에 보이는 것과 안 맞는다"고 잘못 판단해 finish(blocked)로
// 포기하는 사례가 반복 확인됐다 — capture.js/사이트 버그가 아니라 순수 비전 모델의 판단
// 실패였다. AI 판단에 맡기지 않고, 흔한 "닫기" 패턴은 여기서 기계적으로 먼저 처리한다.
function scanForPopupCloseCandidates() {
  const CLOSE_NAME_RE = /^(팝업\s*)?(닫기|닫음|close|dismiss)$/i;
  const CLOSE_LABEL_RE = /(닫기|close|dismiss)/i;

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      Number(style.opacity) !== 0
    );
  }

  const viewportArea = window.innerWidth * window.innerHeight;
  const candidates = [];
  const nodes = document.querySelectorAll('button, a, [role="button"], [role="link"]');
  for (const el of nodes) {
    if (!isVisible(el)) continue;
    const ariaLabel = (el.getAttribute('aria-label') || '').trim();
    const visibleText = (el.innerText || el.getAttribute('title') || '').trim();
    if (!CLOSE_NAME_RE.test(visibleText) && !CLOSE_LABEL_RE.test(ariaLabel)) continue;
    const rect = el.getBoundingClientRect();
    candidates.push({
      x: Math.round(rect.x + rect.width / 2),
      y: Math.round(rect.y + rect.height / 2),
      area: rect.width * rect.height,
      areaRatio: (rect.width * rect.height) / viewportArea,
      name: ariaLabel || visibleText,
    });
  }
  // 작은(=배경 전체가 아니라 모달 안의 실제 버튼일 가능성이 높은) 후보부터 시도한다.
  candidates.sort((a, b) => a.area - b.area);
  return candidates;
}

// 빈 스캔이 2회 연속이면 더 뜰 팝업이 없다고 보고 멈춘다. 최대 시도 횟수는 배너+뉴스레터
// 팝업처럼 순차로 여러 개 뜨는 사이트를 감안한 상한이지, 매 사이트마다 다 채우는 값이
// 아니다(팝업 없는 사이트는 2회 빈 스캔 후 곧바로 빠져나간다).
const MAX_ATTEMPTS = 4;
const MAX_EMPTY_STREAK = 2;

async function dismissObviousPopups(page, { log = () => {} } = {}) {
  let dismissedCount = 0;
  let emptyStreak = 0;

  for (let attempt = 0; attempt < MAX_ATTEMPTS && emptyStreak < MAX_EMPTY_STREAK; attempt += 1) {
    // 팝업 중엔 페이지 로드 직후가 아니라 짧은 지연(setTimeout) 뒤에 뜨는 것도 흔해서,
    // 첫 시도부터 1초는 기다려준다.
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(attempt === 0 ? 1000 : 1200);

    let candidates;
    try {
      // eslint-disable-next-line no-await-in-loop
      candidates = await page.evaluate(scanForPopupCloseCandidates);
    } catch {
      break; // 네비게이션과 겹쳐 컨텍스트가 막 교체된 순간 — 무리하지 않고 그냥 종료
    }

    if (candidates.length === 0) {
      emptyStreak += 1;
      continue;
    }
    emptyStreak = 0;

    const target = candidates[0];
    try {
      // eslint-disable-next-line no-await-in-loop
      await page.mouse.click(target.x, target.y);
    } catch {
      break;
    }
    dismissedCount += 1;
    log(
      `[popupDismissal] 팝업으로 추정되는 요소를 닫음 (라벨: "${target.name}", 화면 대비 면적: ${(target.areaRatio * 100).toFixed(1)}%)`
    );
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(500);
    // eslint-disable-next-line no-await-in-loop
    await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
  }

  return { dismissedCount };
}

module.exports = { dismissObviousPopups };
