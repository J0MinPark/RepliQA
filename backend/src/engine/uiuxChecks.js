// LLM 없이 page.evaluate()만으로 계산 가능한 객관적·결정론적 UI/UX 체크.
// evaluateUiUx()의 LLM 판단은 주관적일 수밖에 없는데, 이 체크들은 같은 화면에 대해
// 항상 같은 결과가 나와야 하고("정확도 수치"로 팔 수 있는 부분) — 그래서 별도 모듈로 분리했다.
// { findings, viewportClippedLabels }를 반환한다 — findings는 사용자에게 보여줄 확정된
// 발견 목록, viewportClippedLabels는 evaluateUiUx가 오판하지 않도록 참고만 하는 메타 정보다.
async function runObjectiveChecks(page) {
  return page.evaluate(() => {
    const findings = [];

    // 스크린리더 전용 "본문 바로가기" 같은 스킵링크는 화면 밖(예: left:-9999px)으로
    // 치워두는 게 정상 패턴이다 — 눈에 보이라고 만든 요소가 아닌데 "글자가 작다/터치하기
    // 어렵다"고 지적하면 오탐이다. 성균관대 공지사항 페이지 실측에서 실제로 이 패턴이
    // "버튼이 너무 작다"는 오탐을 냈다.
    function isVisuallyHidden(rect, style) {
      if (rect.left < -500 || rect.top < -500) return true;
      if (style.clip === 'rect(0px, 0px, 0px, 0px)' || style.clipPath === 'inset(50%)') return true;
      if (style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return true;
      // saucedemo.com 실측: 아이콘 버튼(햄버거 메뉴, 소셜 아이콘)이 font-size:0으로 자기
      // 텍스트를 렌더링 크기 0으로 만들고 대신 아이콘(SVG/배경이미지)을 보여주는 패턴을
      // 쓴다 — 요소 자신의 rect(버튼 크기)는 정상이라 위 체크로는 안 잡히지만, 글자는
      // 렌더링 자체가 안 되므로 "너무 작아서 읽기 불편"이 아니라 애초에 안 보이는 글자다.
      if (parseFloat(style.fontSize) === 0) return true;
      // 스크린리더 전용 텍스트의 또 다른 흔한 패턴: width/height를 1px로 줄이고
      // overflow:hidden으로 가리는 sr-only 기법. rect.left/top은 정상 범위라 위 체크로는
      // 안 잡힌다.
      if (style.overflow === 'hidden' && rect.width <= 1 && rect.height <= 1) return true;
      // 아이콘 교체 기법: text-indent를 크게 음수로 줘서 실제 글자만 박스 밖으로 밀어내고
      // background-image로 아이콘을 보여주는 패턴(automationexercise.com 소셜 아이콘
      // "Twitter"/"Facebook"/"LinkedIn"에서 실측: rect 자체는 정상 크기·위치라 위 rect.left
      // 체크로는 안 걸렸고, "글자가 너무 작다" 오탐으로 이어졌다).
      if (style.overflow === 'hidden' && parseFloat(style.textIndent) <= -500) return true;
      return false;
    }

    // focus-style-removed/contrast-ratio/min-font-size 공통: 요소에 실제로 보이는 라벨이
    // 없으면(아이콘 전용 버튼 등) el.textContent가 빈 문자열이라 `— ""`처럼 의미 없는
    // 꼬리가 붙는다. aria-label을 우선 쓰고, 그마저 없으면 라벨 자체를 생략한다.
    function labelFor(el) {
      const aria = (el.getAttribute && el.getAttribute('aria-label')) || '';
      const text = (el.textContent || '').trim();
      if (aria || text) return (aria || text).trim();
      // 아이콘만 있고 접근성 이름도 텍스트도 없는 버튼/링크(예: 순수 SVG 햄버거 메뉴
      // 버튼)는 라벨이 완전히 비어서, 같은 규칙 위반이 여러 개면 전부 구분 불가능한
      // "빈 라벨"로만 잡혔다 — href나 title 등 남은 단서로라도 최소한의 구분자를 만든다.
      const title = (el.getAttribute && el.getAttribute('title')) || '';
      if (title) return title.trim();
      const href = el.tagName === 'A' ? el.getAttribute('href') : '';
      if (href && href !== '#') return `링크(${href.slice(0, 30)})`;
      return '';
    }

    // <li><a>ENG</a></li>처럼 컨테이너(li/td 등)가 실제 렌더링을 전부 자식 요소(a 등)에
    // 위임하는 마크업이 흔하다 — 이 경우 li.textContent는 "ENG"지만 실제로 화면에 그
    // 텍스트를 그리는 건 자식 a고, 둘의 color/fontSize가 다를 수 있다(예: a는 흰색인데
    // li 자신의 상속 색은 회색). li를 leaf 텍스트처럼 취급해 자기 color로 명암비를 재면
    // 실제로 아무도 안 보는 값을 잰 오탐이 나온다(실측: 성균관대 상단 "ENG" 링크에서
    // li=1.3:1 위반 오탐 + 실제 렌더링되는 a=9.7:1 정상, 둘 다 같은 텍스트로 잡혀 중복
    // 보고됨). 자기 자신의 직계 텍스트 노드가 있는 요소만 "실제로 이 요소가 그 글자를
    // 그린다"고 보고 검사 대상으로 삼는다.
    function hasOwnText(el) {
      return Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
    }

    // 사용자 피드백: "외 N곳"처럼 개수로 뭉뚱그리면 비개발자는 실제로 어디가 문제인지
    // 알 방법이 없다 — 리포트가 존재하는 이유 자체가 "뭘 고쳐야 하는지 알려주는 것"인데,
    // 개수만 남기고 위치를 숨기면 그 목적을 못 한다. 모든 finding에 "지금 이 화면의 URL"을
    // 붙여서, 프론트가 같은 종류의 문제를 묶어 보여줄 때도 페이지별·요소별로 전부 나열할
    // 수 있게 한다.
    const pageUrl = window.location.href;

    // 이미지에는 focus-style-removed처럼 화면에 보이는 텍스트 라벨이 없어서, 여러 개의
    // alt 누락 이미지가 있으면 전부 "이미지에 설명이 없어요"라는 동일한 문장으로만 잡혀
    // 서로 구분이 안 됐다 — 파일명을 라벨 삼아 최소한의 구분자로 쓴다.
    function imageLabel(img) {
      try {
        const src = img.currentSrc || img.src || '';
        const clean = decodeURIComponent(src.split('?')[0].split('/').pop() || '');
        return clean ? clean.slice(0, 40) : '이미지';
      } catch {
        return '이미지';
      }
    }

    // 명암비(contrast-ratio) 체크는 의도적으로 제거했다 — samsung.com 등 실제 대기업
    // 사이트를 포함해 거의 모든 실제 사이트에서 몇 건씩 걸리는 매우 보편적인 위반이라,
    // "이 사이트 QA에서만 발견된 특이 사항"으로서의 신호값이 없다는 사용자 피드백에 따른
    // 결정이다(오탐이 아니라 참인 경우가 많아도 마찬가지). min-font-size/focus-style-removed
    // 등 다른 규칙은 textEls를 계속 공유해서 쓴다.
    const textSelector = 'p, span, a, button, h1, h2, h3, h4, h5, h6, label, li, td, th';
    const textEls = Array.from(document.querySelectorAll(textSelector))
      .filter(hasOwnText)
      .slice(0, 80);

    // 2) 터치 타겟 크기 — WCAG 44x44px은 "손가락으로 터치"하는 모바일 기준인데, RepliQA는
    // 지금 항상 고정된 데스크톱 뷰포트(1280x800)로만 렌더링해서 테스트한다(마우스 조작
    // 전제). 성균관대 공지사항 페이지 실측에서 이 기준을 데스크톱 상단 유틸리티 링크
    // (ENG, 발전기금 등)와 접근성 스킵링크에까지 그대로 적용해 오탐만 냈다 — 나중에
    // 모바일 뷰포트 테스트 모드가 생기면 그때 다시 켠다.
    const interactiveSelector = 'button, a, input, [role="button"], [role="link"]';
    const interactiveEls = Array.from(document.querySelectorAll(interactiveSelector)).slice(0, 80);

    // 3) 가로 스크롤
    if (document.documentElement.scrollWidth > window.innerWidth + 1) {
      findings.push({
        category: 'layout',
        rule: 'horizontal-overflow',
        severity: 'warning',
        source: 'measured',
        url: pageUrl,
        detail: '화면 폭보다 콘텐츠가 넓어서 옆으로 스크롤이 생겨요',
        technicalDetail: `문서 너비(${document.documentElement.scrollWidth}px)가 뷰포트(${window.innerWidth}px)를 초과함`,
      });
    }

    // 4) alt 누락 이미지
    const images = Array.from(document.querySelectorAll('img')).slice(0, 40);
    for (const img of images) {
      if (!img.hasAttribute('alt')) {
        findings.push({
          category: 'accessibility',
          rule: 'missing-alt',
          severity: 'warning',
          source: 'measured',
          url: pageUrl,
          detail: `이미지에 설명이 없어서 화면을 못 보는 사용자는 무슨 이미지인지 알 수 없어요 — "${imageLabel(img)}"`,
          technicalDetail: `alt 속성이 없는 이미지: ${img.src?.slice(0, 60) || '(src 없음)'}`,
        });
      }
    }

    // 5) 최소 폰트 크기
    for (const el of textEls) {
      const text = (el.textContent || '').trim();
      if (!text) continue;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (isVisuallyHidden(rect, style)) continue; // 스킵링크 등은 원래 안 보이므로 제외
      const fontSize = parseFloat(style.fontSize);
      if (fontSize < 12) {
        findings.push({
          category: 'typography',
          rule: 'min-font-size',
          severity: 'info',
          source: 'measured',
          url: pageUrl,
          detail: `글자 크기가 너무 작아서 읽기 불편할 수 있어요 — "${text.slice(0, 30)}"`,
          technicalDetail: `폰트 크기 ${fontSize}px (12px 미만)`,
        });
      }
    }

    // 6) 포커스 스타일 제거 — 브라우저 기본 포커스 링은 :focus 상태에서만 나타나므로,
    // 실제로 focus()를 호출해서 그 순간의 computed style을 봐야 한다(안 그러면 모든
    // 버튼이 "포커스 스타일 없음"으로 오탐된다).
    // href="#"만 있고 텍스트도 없는 아이콘 버튼이 한 페이지에 여러 개(햄버거 메뉴, 검색
    // 아이콘 등)면 labelFor()가 전부 똑같이 빈 라벨이나 "링크(#)"를 돌려줘서, 서로 다른
    // 요소인데도 그룹핑 단계에서 하나로 뭉쳐 보였다 — 같은 라벨이 이미 나온 요소를
    // 만나면 몇 번째 등장인지를 덧붙여서라도 구분할 수 있게 한다.
    const seenFocusLabels = new Map();
    for (const el of interactiveEls.slice(0, 30)) {
      try {
        el.focus({ preventScroll: true });
        const style = window.getComputedStyle(el);
        const noOutline = style.outlineStyle === 'none' || style.outlineWidth === '0px';
        const noBoxShadow = style.boxShadow === 'none';
        if (document.activeElement === el && noOutline && noBoxShadow) {
          let label = labelFor(el).slice(0, 30);
          const seenCount = seenFocusLabels.get(label || '(empty)') || 0;
          seenFocusLabels.set(label || '(empty)', seenCount + 1);
          if (seenCount > 0) {
            label = label ? `${label} #${seenCount + 1}` : `${el.tagName.toLowerCase()} 버튼 #${seenCount + 1}`;
          }
          findings.push({
            category: 'accessibility',
            rule: 'focus-style-removed',
            severity: 'info',
            source: 'measured',
            url: pageUrl,
            detail: label
              ? `키보드로 이동했을 때 지금 어디에 있는지 표시가 안 보여요 — "${label}"`
              : '키보드로 이동했을 때 지금 어디에 있는지 표시가 안 보여요',
          });
        }
        el.blur();
      } catch {
        // 포커스 불가능한 요소는 건너뜀
      }
    }

    // 7) 뷰포트 경계 잘림 후보 — evaluateUiUx(LLM)에게 넘길 참고 정보일 뿐 findings에는
    // 안 넣는다(사용자에게 "문제"로 보여줄 게 아니라, LLM이 오판하지 않게 미리 알려주는
    // 메타 정보). 스크린샷은 항상 지금 스크롤 위치의 뷰포트만 찍는데, 화면 아래(혹은 위)
    // 경계에 걸쳐 있는 요소는 그 요소 자체의 CSS가 잘못돼서가 아니라 스크린샷 프레임 밖으로
    // 내용이 이어질 뿐이다(saucedemo.com 실측: 상품 카드 설명이 뷰포트 800px 경계에 걸려서
    // overflow:visible인데도 LLM이 "텍스트가 잘려서 안 보인다"고 오탐 — 실제로 스크롤하면
    // 전체가 다 보임). 매 스크롤 위치마다 사실이 다르므로 매번 새로 계산한다.
    // textEls(p/span/a/button 등)는 contrast/font-size 체크용으로 일부러 좁게 잡은 셀렉터라,
    // 상품 설명처럼 <div>에 바로 텍스트가 들어있는 흔한 카드 레이아웃을 놓친다(실측:
    // saucedemo.com의 .inventory_item_desc가 정확히 이 경우) — 여기서는 div까지 포함한
    // 별도 셀렉터로 다시 훑는다.
    const vh = window.innerHeight;
    const clipCandidates = Array.from(document.querySelectorAll('p, div, span, a, button, h1, h2, h3, h4, h5, h6, label, li, td, th'))
      .filter(hasOwnText)
      .slice(0, 200);
    const viewportClippedLabels = [];
    const seenClipped = new Set();
    for (const el of clipCandidates) {
      if (viewportClippedLabels.length >= 8) break;
      const rect = el.getBoundingClientRect();
      const straddlesBottom = rect.top < vh && rect.bottom > vh + 4;
      const straddlesTop = rect.bottom > 0 && rect.top < -4;
      if (straddlesBottom || straddlesTop) {
        const text = (el.textContent || '').trim().slice(0, 40);
        if (text && !seenClipped.has(text)) {
          seenClipped.add(text);
          viewportClippedLabels.push(text);
        }
      }
    }

    // 결과가 너무 많으면 노이즈가 되므로 카테고리별로 상한을 둔다.
    const capped = [];
    const perRuleCount = {};
    for (const f of findings) {
      perRuleCount[f.rule] = (perRuleCount[f.rule] || 0) + 1;
      if (perRuleCount[f.rule] <= 5) capped.push(f);
    }
    return { findings: capped, viewportClippedLabels };
  });
}

module.exports = { runObjectiveChecks };
