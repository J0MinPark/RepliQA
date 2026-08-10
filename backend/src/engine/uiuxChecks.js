// LLM 없이 page.evaluate()만으로 계산 가능한 객관적·결정론적 UI/UX 체크.
// evaluateUiUx()의 LLM 판단은 주관적일 수밖에 없는데, 이 체크들은 같은 화면에 대해
// 항상 같은 결과가 나와야 하고("정확도 수치"로 팔 수 있는 부분) — 그래서 별도 모듈로 분리했다.
async function runObjectiveChecks(page) {
  return page.evaluate(() => {
    const findings = [];

    function parseRgb(colorStr) {
      const m = colorStr.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    }

    function relativeLuminance({ r, g, b }) {
      const channel = (c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    }

    function contrastRatio(rgb1, rgb2) {
      const l1 = relativeLuminance(rgb1);
      const l2 = relativeLuminance(rgb2);
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    }

    function effectiveBackground(el) {
      let node = el;
      while (node) {
        const bg = parseRgb(window.getComputedStyle(node).backgroundColor);
        if (bg && bg.a > 0) return bg;
        node = node.parentElement;
      }
      return { r: 255, g: 255, b: 255, a: 1 }; // 못 찾으면 흰 배경 가정
    }

    // 1) 명암비 (WCAG AA)
    const textSelector = 'p, span, a, button, h1, h2, h3, h4, h5, h6, label, li, td, th';
    const textEls = Array.from(document.querySelectorAll(textSelector)).slice(0, 80);
    for (const el of textEls) {
      const text = (el.textContent || '').trim();
      if (!text || text.length < 2) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      const style = window.getComputedStyle(el);
      const fg = parseRgb(style.color);
      if (!fg) continue;
      const bg = effectiveBackground(el);
      const ratio = contrastRatio(fg, bg);
      const fontSize = parseFloat(style.fontSize);
      const isLarge = fontSize >= 24 || (fontSize >= 18.66 && parseInt(style.fontWeight, 10) >= 700);
      const minRatio = isLarge ? 3 : 4.5;

      if (ratio < minRatio) {
        findings.push({
          category: 'accessibility',
          rule: 'contrast-ratio',
          severity: ratio < minRatio * 0.7 ? 'error' : 'warning',
          detail: `명암비 ${ratio.toFixed(2)}:1 (WCAG AA 기준 ${minRatio}:1 미달) — "${text.slice(0, 30)}"`,
        });
      }
    }

    // 2) 터치 타겟 크기
    const interactiveSelector = 'button, a, input, [role="button"], [role="link"]';
    const interactiveEls = Array.from(document.querySelectorAll(interactiveSelector)).slice(0, 80);
    for (const el of interactiveEls) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.width < 44 || rect.height < 44) {
        findings.push({
          category: 'accessibility',
          rule: 'tap-target-size',
          severity: 'warning',
          detail: `터치 타겟 ${Math.round(rect.width)}x${Math.round(rect.height)}px (권장 44x44px 미만) — "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}"`,
        });
      }
    }

    // 3) 가로 스크롤
    if (document.documentElement.scrollWidth > window.innerWidth + 1) {
      findings.push({
        category: 'layout',
        rule: 'horizontal-overflow',
        severity: 'warning',
        detail: `문서 너비(${document.documentElement.scrollWidth}px)가 뷰포트(${window.innerWidth}px)를 초과함`,
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
          detail: `alt 속성이 없는 이미지: ${img.src?.slice(0, 60) || '(src 없음)'}`,
        });
      }
    }

    // 5) 최소 폰트 크기
    for (const el of textEls) {
      const text = (el.textContent || '').trim();
      if (!text) continue;
      const fontSize = parseFloat(window.getComputedStyle(el).fontSize);
      if (fontSize < 12) {
        findings.push({
          category: 'typography',
          rule: 'min-font-size',
          severity: 'info',
          detail: `폰트 크기 ${fontSize}px (12px 미만) — "${text.slice(0, 30)}"`,
        });
      }
    }

    // 6) 포커스 스타일 제거 — 브라우저 기본 포커스 링은 :focus 상태에서만 나타나므로,
    // 실제로 focus()를 호출해서 그 순간의 computed style을 봐야 한다(안 그러면 모든
    // 버튼이 "포커스 스타일 없음"으로 오탐된다).
    for (const el of interactiveEls.slice(0, 30)) {
      try {
        el.focus({ preventScroll: true });
        const style = window.getComputedStyle(el);
        const noOutline = style.outlineStyle === 'none' || style.outlineWidth === '0px';
        const noBoxShadow = style.boxShadow === 'none';
        if (document.activeElement === el && noOutline && noBoxShadow) {
          findings.push({
            category: 'accessibility',
            rule: 'focus-style-removed',
            severity: 'info',
            detail: `키보드 포커스 시 시각적 표시가 없음 — "${(el.textContent || '').trim().slice(0, 30)}"`,
          });
        }
        el.blur();
      } catch {
        // 포커스 불가능한 요소는 건너뜀
      }
    }

    // 결과가 너무 많으면 노이즈가 되므로 카테고리별로 상한을 둔다.
    const capped = [];
    const perRuleCount = {};
    for (const f of findings) {
      perRuleCount[f.rule] = (perRuleCount[f.rule] || 0) + 1;
      if (perRuleCount[f.rule] <= 5) capped.push(f);
    }
    return capped;
  });
}

module.exports = { runObjectiveChecks };
