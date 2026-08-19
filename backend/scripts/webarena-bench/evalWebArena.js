// WebArena 공식 채점기(evaluation_harness/evaluators.py)의 URLEvaluator/HTMLContentEvaluator를
// 그대로 JS로 이식한 것 — 자체 근사치를 만들지 않고 원본과 동일한 알고리즘을 쓴 이유는,
// Success Rate 숫자가 "RepliQA 자체 판단"이 아니라 WebArena가 다른 에이전트들을 채점할 때와
// 동일한 기준으로 나와야 논문/벤치마크 비교에 의미가 있기 때문이다. string_match(에이전트가
// 마지막에 말로 낸 답변 채점)는 이식하지 않았다 — selectTasks.js가 애초에 해당 태스크를
// 서브셋에서 제외한다.

function cleanUrl(u) {
  return String(u).replace(/\/+$/, '');
}

function parseUrl(u) {
  const parsed = new URL(u);
  const basePath = parsed.host + parsed.pathname;
  const query = {};
  for (const [k, v] of parsed.searchParams.entries()) {
    (query[k] = query[k] || []).push(v);
  }
  return { basePath, query };
}

function parseUrls(urls) {
  const basePaths = [];
  const queries = {};
  for (const u of urls) {
    const { basePath, query } = parseUrl(u);
    basePaths.push(basePath);
    for (const [k, vs] of Object.entries(query)) {
      queries[k] = queries[k] || new Set();
      vs.forEach((v) => queries[k].add(v));
    }
  }
  return { basePaths, queries };
}

// score는 0 또는 1(base_score/query_score가 각각 0/1이라 곱해도 0 또는 1) — WebArena
// 원본은 float 0.0~1.0 범위의 "부분 점수"도 이론상 가능하지만, url_match/program_html
// 둘 다 실제로는 각 항이 0/1이라 항상 0 또는 1로 떨어진다.
function urlMatchScore(predUrl, referenceUrl, urlNote) {
  const pred = cleanUrl(predUrl);
  const refUrls = referenceUrl.split(' |OR| ').map(cleanUrl);
  const matchingRule = urlNote || 'GOLD in PRED';
  if (matchingRule !== 'GOLD in PRED') {
    throw new Error(`지원하지 않는 매칭 규칙: ${matchingRule}`);
  }
  const { basePaths: refBasePaths, queries: refQueries } = parseUrls(refUrls);
  const { basePath: predBasePath, query: predQuery } = parseUrl(pred);

  // 원본(evaluators.py)의 `ref_base_path in pred_base_paths`는 파이썬 문자열의 부분
  // 문자열 포함 검사다 — "참조 경로가 예측 URL 안에 부분 문자열로 들어있는지"를 본다.
  // 처음 이식할 때 방향을 반대로(예측 경로가 참조 목록과 완전 일치해야 함) 짰었는데,
  // Magento가 필터 상태를 쿼리스트링이 아니라 URL 경로 자체에 base64로 박아넣는 방식이라
  // (예: .../sales/filter/<base64>/) 실제로는 정확히 통과해야 할 태스크(704: 매출 리포트
  // 생성, 날짜 값은 정확히 일치했음)가 억울하게 실패 처리됐다 — 실제 Show Report 버튼을
  // 직접 눌러 재현해서 확인함.
  const baseScore = refBasePaths.some((refBasePath) => predBasePath.includes(refBasePath)) ? 1 : 0;
  let queryScore = 1;
  for (const [k, possibleValues] of Object.entries(refQueries)) {
    const predValues = predQuery[k] || [];
    const anyMatch = [...possibleValues].some((v) => predValues.includes(v));
    queryScore *= anyMatch ? 1 : 0;
  }
  return baseScore * queryScore;
}

const HTML_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'",
};
function decodeHtmlEntities(str) {
  return String(str)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (_, name) => HTML_ENTITIES[name]);
}

function cleanAnswer(s) {
  let a = String(s).trim();
  if ((a.startsWith("'") && a.endsWith("'")) || (a.startsWith('"') && a.endsWith('"'))) {
    a = a.slice(1, -1);
  }
  return a.toLowerCase();
}
function exactMatch(ref, pred) {
  return cleanAnswer(pred) === cleanAnswer(ref) ? 1 : 0;
}
function mustInclude(ref, pred) {
  return cleanAnswer(pred).includes(cleanAnswer(ref)) ? 1 : 0;
}

// page는 호출자가 이미 로그인 세션(storage_state)을 실어 만든 새 Playwright 페이지 — 이
// 함수는 그 페이지로 target.url들을 순서대로 navigate하며 채점만 한다. target.url이 "last"면
// lastUrl(runTest()가 돌려준 finalUrl)로 이동한다.
async function evalProgramHtml(page, targets, lastUrl) {
  let score = 1;
  for (const target of targets) {
    const destUrl = target.url === 'last' ? lastUrl : target.url;
    if (!destUrl) throw new Error('program_html target에 이동할 URL이 없습니다(lastUrl 누락).');
    await page.goto(destUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000); // WebArena 원본도 렌더링 안정화를 위해 동일하게 대기

    const locator = (target.locator || '').trim();
    let selectedElement;
    if (!locator) {
      selectedElement = await page.content();
    } else if (locator.startsWith('document.') || locator.startsWith('[...document.')) {
      if (target.prep_actions) {
        for (const prep of target.prep_actions) {
          await page.evaluate(prep).catch(() => {});
        }
      }
      try {
        const result = await page.evaluate(locator);
        selectedElement = result == null ? '' : String(result);
      } catch {
        selectedElement = '';
      }
    } else {
      throw new Error(`지원하지 않는 locator 형식(func: 헬퍼는 이식 안 함): ${locator}`);
    }
    selectedElement = decodeHtmlEntities(selectedElement);

    if (target.required_contents.exact_match != null) {
      score *= exactMatch(target.required_contents.exact_match, selectedElement);
    } else if (target.required_contents.must_include) {
      for (const content of target.required_contents.must_include) {
        const contentOr = content.split(' |OR| ');
        const anyMatch = contentOr.some((c) => mustInclude(c, selectedElement));
        score *= anyMatch ? 1 : 0;
      }
    } else {
      throw new Error(`알 수 없는 required_contents: ${JSON.stringify(target.required_contents)}`);
    }
  }
  return score;
}

// 태스크 하나의 최종 점수(0 또는 1) — eval_types를 전부 곱한다(WebArena EvaluatorComb와 동일:
// AND 의미, 하나라도 0점이면 전체 0점).
async function gradeTask(task, { page, finalUrl }) {
  let score = 1;
  for (const evalType of task.eval.eval_types) {
    if (evalType === 'url_match') {
      score *= urlMatchScore(finalUrl || '', task.eval.reference_url, task.eval.url_note);
    } else if (evalType === 'program_html') {
      score *= await evalProgramHtml(page, task.eval.program_html, finalUrl);
    } else {
      throw new Error(`이 하네스는 eval_type "${evalType}"을 지원하지 않습니다(string_match는 selectTasks.js에서 제외됨).`);
    }
    if (score === 0) break;
  }
  return score;
}

module.exports = { urlMatchScore, evalProgramHtml, gradeTask, cleanUrl, decodeHtmlEntities };
