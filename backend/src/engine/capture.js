// 브라우저 컨텍스트 안에서 실행되는 함수 — page.evaluate와 frame.evaluate 양쪽에
// 그대로 재사용한다(이니시스/토스페이먼츠 위젯처럼 결제 UI가 iframe으로 삽입되는
// 경우가 흔해서, 메인 문서만 보면 결제 폼 안의 입력창을 아예 못 찾는다).
//
// max는 여기서 "최종적으로 LLM에 보낼 개수"가 아니라 순수 안전장치용 상한이다 — DOM
// 순서대로 여기서 잘라버리면, 내비게이션/필터 UI가 먼저 나오는 페이지(github.com 검색
// 결과 등, 실제로 재현함)에서는 정작 핵심 콘텐츠(검색 결과 링크)가 아예 수집조차 안 되고
// 잘려나간다. 진짜 우선순위 판단(뷰포트 안에 있는지 등)은 captureState()가 훨씬 넉넉한
// 원본 집합을 받은 뒤에 한다.
function extractInteractiveElements(max) {
  const selector =
    'button, a, input, textarea, select, [role="button"], [role="link"], [role="checkbox"], [role="tab"], [draggable="true"]';

  // 섀도우 DOM(Web Components) 안에 있는 요소는 document.querySelectorAll이 보지 못한다 —
  // MDN 리뉴얼 프론트엔드(<mdn-search-button>, <mdn-homepage-search> 등)에서 실제 확인함:
  // 검색 관련 인터랙티브 요소가 전부 shadowRoot 안에 있어서 캡처에 아예 안 잡혔다. 라이트
  // DOM을 훑다가 shadowRoot를 가진 요소를 만나면 그 안까지 재귀적으로 훑어 합친다.
  function collectDeep(root, out) {
    out.push(...root.querySelectorAll(selector));
    const all = root.querySelectorAll('*');
    for (const el of all) {
      if (el.shadowRoot) collectDeep(el.shadowRoot, out);
    }
  }

  // 이 함수 전체가 page.evaluate로 문자열째 브라우저에 전송되므로(파일 상단 주석 참고),
  // 바깥 스코프의 다른 함수/상수를 참조할 수 없다 — collectDeep과 마찬가지로 안쪽에
  // 정의해야 한다. 태그/type만으로 암묵적 접근성 role을 추정한다(Playwright의 getByRole이
  // 실제 접근성 트리를 쓰는 것과 달리, 여긴 근사치만 낸다 — 완벽할 필요 없음, 나중에
  // "이 셀렉터로 다시 찾아보고 안 되면 비전으로 폴백"하는 캐시 후보일 뿐이라 틀려도
  // 최악의 경우 캐시 미스로 끝난다. 지금은 이 값을 어디서도 쓰지 않는다 — 저장만 하고
  // 아직 캐시/패스트패스에 활용하지 않는 "셀렉터 로깅" 단계).
  const IMPLICIT_ROLE_BY_TAG = { a: 'link', textarea: 'textbox', select: 'combobox' };
  const IMPLICIT_ROLE_BY_INPUT_TYPE = {
    submit: 'button',
    button: 'button',
    reset: 'button',
    checkbox: 'checkbox',
    radio: 'radio',
    text: 'textbox',
    email: 'textbox',
    password: 'textbox',
    search: 'textbox',
    tel: 'textbox',
    url: 'textbox',
    number: 'textbox',
  };
  function computeSelectorHint(el, tag, type, text) {
    const explicitRole = el.getAttribute('role');
    // <input>은 type 속성이 아예 없으면 HTML 스펙상 암묵적으로 text지만, getAttribute는
    // null/빈 문자열을 그대로 돌려준다 — 그 경우도 textbox로 취급한다.
    const inputType = tag === 'input' ? IMPLICIT_ROLE_BY_INPUT_TYPE[type] || (type ? null : 'textbox') : null;
    const role = explicitRole || IMPLICIT_ROLE_BY_TAG[tag] || inputType || (tag === 'button' ? 'button' : null);
    if (!role || !text) return null;
    return { role, name: text };
  }
  const nodes = [];
  collectDeep(document, nodes);

  // 시맨틱 태그(button/a/input 등)도 role 속성도 없이 CSS와 JS 이벤트 리스너만으로 클릭
  // 가능하게 만든 div/span/li 같은 "커스텀 클릭 요소"는 위 셀렉터에 전혀 안 걸린다 — 캡처
  // 대상 목록에 아예 없으니 모델이 그 요소를 가리킬 elementIndex 자체를 낼 수 없다(실측:
  // freemockinterview.com의 자동완성 추천 항목이 <div class="profile-result-item">라서,
  // 검색어를 입력하는 것까지는 됐지만 추천 항목을 선택할 방법이 아예 없었다 — "화면에
  // 보이는데 목록에 없다"는 이전과는 다른 새로운 종류의 실패). cursor:pointer는 "이건
  // 클릭하라고 만든 요소"라는 사실상 표준 신호라, 이미 잡힌 요소의 조상이나 자손이
  // 아닌 것만 추가로 주워 담는다 — 안 그러면 같은 클릭 대상이 여러 겹으로 중복돼 더
  // 헷갈린다.
  const capturedSet = new Set(nodes);
  function overlapsCaptured(el) {
    let p = el.parentElement;
    while (p) {
      if (capturedSet.has(p)) return true;
      p = p.parentElement;
    }
    return nodes.some((n) => el.contains(n));
  }
  const pointerCandidates = Array.from(document.querySelectorAll('div, span, li, td')).slice(0, 800);
  for (const el of pointerCandidates) {
    if (capturedSet.has(el) || nodes.length >= 300) break;
    if (el.children.length > 3) continue; // 자식이 많은 큰 컨테이너는 클릭 "요소"가 아니라 레이아웃일 가능성이 높음
    if (overlapsCaptured(el)) continue;
    if (window.getComputedStyle(el).cursor !== 'pointer') continue;
    nodes.push(el);
    capturedSet.add(el);
  }

  const items = [];
  for (const el of nodes) {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const visible =
      rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    if (!visible) continue;

    // title도 폴백 체인에 둔다 — 실제 ARIA 접근성 이름 계산의 폴백 순서(aria-label →
    // 텍스트 콘텐츠 → title)와 더 가깝게 맞춘 것. 텍스트도 aria-label도 없는 순수
    // 아이콘 버튼 중 title로 라벨링된 것들을 이걸로 추가 구제한다(무상 개선 — 셋 다
    // 없으면 여전히 null이라 캐시 대상에서 안전하게 빠진다).
    const text = (
      el.innerText ||
      el.value ||
      el.placeholder ||
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      ''
    )
      .trim()
      .slice(0, 80);

    const item = {
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || '',
      role: el.getAttribute('role') || '',
      text,
      box: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      inViewport: rect.top >= 0 && rect.top < window.innerHeight,
      selectorHint: computeSelectorHint(el, el.tagName.toLowerCase(), el.getAttribute('type') || '', text),
    };

    // 화면 대부분(뷰포트 절반 이상)을 덮는 요소는 진짜 콘텐츠보다는 모달 백드롭/로딩
    // 오버레이/스크림일 가능성이 높다 — yureka.co.kr 실측: aria-label이 "팝업 닫기"인
    // 뷰포트 전체 크기 배경 버튼과 모달 안의 작은 실제 "닫기" 버튼이 함께 캡처되자 비전
    // 모델이 "어느 쪽인지 모르겠다"며 포기한 사례가 있었다. 모델이 width/height 숫자를
    // 직접 비교해서 계산하게 두는 대신, 여기서 비율을 미리 계산해 명시적 플래그로 붙여준다
    // — 판단을 프롬프트 추론이 아니라 결정론적 계산으로 옮기는 것. 작은 요소가 대부분이라
    // 플래그가 안 붙는 게 정상 케이스라, 필드는 해당될 때만 붙여서 페이로드를 늘리지 않는다.
    const viewportArea = window.innerWidth * window.innerHeight;
    if (viewportArea > 0 && (rect.width * rect.height) / viewportArea >= 0.5) {
      item.coversMostOfScreen = true;
    }

    // 네이티브 <select>는 헤드리스 브라우저에서 옵션 목록이 스크린샷에 안 보이므로
    // 텍스트로 옵션을 같이 넘겨줘야 LLM이 뭘 고를 수 있는지 알 수 있다.
    if (el.tagName.toLowerCase() === 'select') {
      item.options = Array.from(el.options)
        .slice(0, 30)
        .map((o) => ({ value: o.value, label: o.text.trim() }));
    }

    items.push(item);
  }
  return items.slice(0, max);
}

// 현재 페이지에 떠 있는 iframe들(같은 origin이든 다르든 Playwright가 접근 가능한 것)을
// 훑어서 요소를 뽑고, iframe 자체의 화면상 좌표만큼 offset을 더해 메인 페이지 좌표계로
// 맞춘다 — 그래야 스크린샷 좌표와 일치해서 executor.js가 그대로 클릭할 수 있다.
async function extractFromFrames(page, maxElements) {
  const collected = [];
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    try {
      const frameElementHandle = await frame.frameElement();
      const frameBox = await frameElementHandle.boundingBox();
      if (!frameBox) continue;
      const frameItems = await frame.evaluate(extractInteractiveElements, maxElements);
      for (const item of frameItems) {
        item.box.x += frameBox.x;
        item.box.y += frameBox.y;
        item.inFrame = true;
      }
      collected.push(...frameItems);
    } catch {
      // cross-origin이라 접근이 막혔거나, 이미 detach된 frame — 조용히 건너뜀
    }
  }
  return collected;
}

// 스크린샷 + bounding box 기반 요소 목록을 함께 뽑는다. DOM 텍스트 매칭만으로
// 요소를 찾던 기존 방식(getByText)은 동일 텍스트 중복/숨김 요소에서 잘 깨졌는데,
// 좌표를 같이 넘기면 실행 단계에서 텍스트 매칭 없이 바로 클릭할 수 있다.
// 프레임워크(React/Vue/vanilla)에 상관없이 "화면에 보이는 대로" 판단하므로 일반성도 좋다.
function isContextDestroyedError(err) {
  return /Execution context was destroyed|Target closed|Target page.*closed/i.test(err?.message || '');
}

// DOM에서 원본으로 긁어올 상한(안전장치) — 실제 전송 개수(maxElements)보다 훨씬 넉넉하게
// 잡아야, 내비게이션/필터 UI가 많은 페이지에서도 핵심 콘텐츠가 초반에 잘려나가지 않는다.
const RAW_ELEMENT_CAP = 200;

async function evaluateElements(page) {
  try {
    return await page.evaluate(extractInteractiveElements, RAW_ELEMENT_CAP);
  } catch (err) {
    // 클릭이 곧바로 네비게이션을 일으킨 직후라 문서가 막 교체되는 순간과 겹친 경우 —
    // 새 문서가 자리잡을 시간을 한 번 주고 다시 시도한다(구글 검색 결과 페이지 이동에서
    // 실제로 재현됨). 그래도 안 되면 원래 에러를 그대로 올려서 숨기지 않는다.
    if (!isContextDestroyedError(err)) throw err;
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
    return page.evaluate(extractInteractiveElements, RAW_ELEMENT_CAP);
  }
}

// 체크포인트 목표 문장에서 "의미 있어 보이는" 토큰만 뽑는다 — 형태소 분석기 없이
// 조사까지 정확히 떼낼 순 없지만(완벽한 한국어 NLP는 여기 목적에 비해 과하다), 부분
// 문자열 포함 매칭이라 "학습 관리 방식"의 "학습"이 "학습 데이터" 같은 요소 텍스트에도
// 걸린다 — 대기업 대형 페이지에서 순위를 조금이라도 목표 쪽으로 기울이는 용도로는
// 이 정도 근사치로 충분하다.
function extractGoalTokens(goalText) {
  if (!goalText) return [];
  return goalText
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2);
}

function goalRelevanceScore(text, goalTokens) {
  if (!text || goalTokens.length === 0) return 0;
  const lower = text.toLowerCase();
  let score = 0;
  for (const token of goalTokens) {
    if (lower.includes(token)) score += 1;
  }
  return score;
}

// 40은 원래 "비전 모델 토큰 비용을 아끼자"는 취지로 고른 값이었는데, 실제 포털형 사이트에서
// 상단 메뉴/로그인/쇼핑 바로가기/광고 배너 같은 chrome 요소만으로 40개가 꽉 차서 정작 목표
// 콘텐츠(뉴스 헤드라인·검색 결과 도서 링크)가 통째로 잘려나가는 걸 실제로 확인했다(다음
// 메인페이지: 목표 헤드라인이 정렬 후 48번째, 예스24 검색결과: 도서 링크가 81번째). Gemini
// Flash 기준 요소 60~80개 추가는 토큰 비용이 미미해서, 누락 비용(체크포인트 전체 실패) 대비
// 이 상한을 넉넉히 올리는 쪽이 명백히 이득이다.
//
// 하지만 대기업 페이지처럼 그 상한마저 넘는 경우가 있다 — 그땐 여전히 "화면 위치"만으로
// 잘라내서, 목표와 관련된 콘텐츠가 화면 아래쪽/뷰포트 밖에 있으면 통째로 잘려나갈 수 있다.
// goalText를 넘기면(체크포인트 목표 문장) 뷰포트 우선순위는 그대로 유지한 채, 같은
// 우선순위 안에서 목표 문장과 겹치는 단어가 있는 요소를 앞으로 당겨서 잘림 순서 자체를
// 목표 인식형으로 만든다. goalText가 없으면(로그인/결제 필드 탐지 등) 기존과 완전히 동일하게
// 동작한다 — 순수 추가 기능이라 기존 호출부는 전혀 영향받지 않는다.
async function captureState(page, { maxElements = 100, goalText = null } = {}) {
  let pageElements = await evaluateElements(page);
  if (pageElements.length === 0) {
    // evaluate 자체는 에러 없이 성공했는데 요소가 0개인 경우 — 옛 문서가 헐리고 새 문서가
    // 아직 파싱 중인 그 찰나의 순간에 evaluate가 실행된 것일 가능성이 높다(예스24 검색결과
    // 전체 페이지 네비게이션에서 실제 재현). 일단 짧게 한 번 더 확인한다.
    await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500);
    pageElements = await evaluateElements(page);
  }

  // 요소가 여전히 적은(<15) 상태면 — 0개든 6개든 — 아직 로딩/리다이렉트 중일 가능성이
  // 높다. Notion처럼 login→홈 셸→실제 워크스페이스로 이어지는 다단계 리다이렉트를 거치며
  // 콘텐츠가 초 단위로 서서히 채워지는 무거운 SPA에서 실제로 확인함: 요소 수가
  // 0→6→36→61개로 6초 넘게 걸쳐 늘어났고, "0개일 때만 1회 재시도"로는 0개가 아닌 6개
  // 같은 애매한 중간 단계도, 0개 상태가 재시도 후에도 계속되는 긴 리다이렉트 체인도 못
  // 잡아서 모델이 "화면이 비었다"고 오판해 체크포인트를 통째로 실패시켰다. "늘지 않으면
  // 즉시 중단" 조건은 넣지 않는다 — 리다이렉트 중간 홉에서 잠깐 정체됐다가 다시 채워지는
  // 경우(0→0→6→36→61 같은)를 성급하게 포기하지 않기 위해서다. 이미 충분한(>=15) 정상
  // 페이지는 이 루프를 아예 안 타서 비용이 없다.
  for (let retries = 0; pageElements.length < 15 && retries < 8; retries += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(800);
    // eslint-disable-next-line no-await-in-loop
    pageElements = await evaluateElements(page);
  }

  const frameElements = await extractFromFrames(page, RAW_ELEMENT_CAP);

  // 뷰포트 안에 있는 요소를 우선하고, 그 다음은(있다면) 목표 문장과 겹치는 요소를 우선하고,
  // 마지막으로 위→아래, 왼→오른쪽 순서로 정렬한다. 순수 DOM 순서에만 의존하면(이전 버전)
  // 내비게이션/필터가 본문보다 먼저 나오는 페이지에서 핵심 콘텐츠가 뒤로 밀려
  // 잘려나갔다(github.com 검색 결과에서 실제 확인함).
  const goalTokens = extractGoalTokens(goalText);
  const merged = [...pageElements, ...frameElements].sort((a, b) => {
    const viewportDiff = Number(b.inViewport) - Number(a.inViewport);
    if (viewportDiff !== 0) return viewportDiff;
    if (goalTokens.length > 0) {
      const goalDiff = goalRelevanceScore(b.text, goalTokens) - goalRelevanceScore(a.text, goalTokens);
      if (goalDiff !== 0) return goalDiff;
    }
    return a.box.y - b.box.y || a.box.x - b.box.x;
  });
  const indexed = merged.slice(0, maxElements).map((el, index) => ({ index, ...el }));

  // jpeg 저품질 압축 — 비전 모델 토큰 비용을 낮추는 가장 값싼 지렛대.
  const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 55 });

  return {
    screenshotBase64: screenshotBuffer.toString('base64'),
    screenshotBuffer,
    elements: indexed,
    url: page.url(),
    // page.title()은 document.title을 evaluate해서 가져오므로 네비게이션과 겹치면
    // "Execution context was destroyed"로 예외를 던진다 — Habitica 회원가입 제출 직후
    // 실제 재현: 이 한 줄에서 던진 예외가 어디서도 안 잡혀서 체크포인트가 아니라 테스트
    // 런 전체가 죽었다(체크포인트는 영원히 running 상태로 멈춤). title은 리포트 표시용
    // 부가정보일 뿐이라 실패해도 빈 문자열로 넘어가는 게 훨씬 안전하다.
    title: await page.title().catch(() => ''),
  };
}

module.exports = { captureState };
