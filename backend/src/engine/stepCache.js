const crypto = require('crypto');
const { collections } = require('../db/firestore');

// executor.js는 건드리지 않는다 — elementIndex→좌표 변환이 이미 세 군데(메인 블록/
// rapid_click/key)에 중복돼 있는 좌표 기반 경로라, 여기 손대면 위험이 커진다. 대신 완전히
// 별도의 Locator 기반 경로를 이 파일에만 둔다.

// click/hover만 캐시 대상이다. type/paste/select 등은 입력값이 페르소나·맥락에 따라
// 매번 달라질 수 있어서, 캐시된 값을 그대로 재생하면 "실제로는 틀린 값을 넣고도 성공한
// 것처럼 보이는" 조용한 오류가 생길 수 있다. click/hover는 값이 필요 없어 이 위험이 없다.
const FAST_PATH_ELIGIBLE_TYPES = new Set(['click', 'hover']);

function isFastPathEligible(action) {
  return Boolean(action && FAST_PATH_ELIGIBLE_TYPES.has(action.type) && action.resolvedSelector);
}

function hashCacheKey(registeredUrlId, goal) {
  return crypto.createHash('sha256').update(`${registeredUrlId}::${goal || ''}`).digest('hex');
}

// activePage를 받는다(page 고정 아님) — 팝업으로 전환된 상태에서도 지금 보이는 페이지
// 기준으로 찾아야 한다. 정확히 1개·보이는 요소일 때만 실행하고, 그 외(0개/2개 이상/숨김)는
// null을 돌려줘서 호출부가 기존 비전+LLM 경로로 폴백하게 한다 — 애매하면 절대 추측하지 않음.
async function tryFastPathAction(activePage, cachedStep) {
  if (!isFastPathEligible(cachedStep.action)) return null;
  const { role, name } = cachedStep.action.resolvedSelector;
  if (!role || !name) return null;

  let locator;
  try {
    locator = activePage.getByRole(role, { name, exact: true });
    const count = await locator.count();
    if (count !== 1) return null;
    if (!(await locator.isVisible())) return null;
  } catch {
    return null;
  }

  try {
    if (cachedStep.action.type === 'click') {
      await locator.click({ timeout: 5000 });
    } else {
      await locator.hover({ timeout: 5000 });
    }
  } catch (err) {
    return { ok: false, error: `캐시된 셀렉터로 ${cachedStep.action.type} 실행 실패: ${err.message}` };
  }
  return { ok: true };
}

async function loadStepCache({ tenantId, registeredUrlId, goal }) {
  const id = hashCacheKey(registeredUrlId, goal);
  const snap = await collections.stepCache(tenantId).doc(id).get();
  if (!snap.exists) return null;
  return snap.data();
}

// 캐시 안 대상(type 등) 스텝도 stepNumber를 유지한 채로 같이 저장해야 한다 — 재생 시
// "이번 스텝은 원래도 값 입력이 필요했으니 여기서부터는 비전 경로로 가야 한다"를 판단하려면
// 순서 정보가 끊기면 안 된다. 항상 "가장 최근에 실제로 성공한 실행"으로 덮어써서, 사이트가
// 바뀌어도 다음 성공 실행이 자동으로 최신 셀렉터로 캐시를 갱신한다 — 별도 TTL/무효화
// 로직이 필요 없다.
async function saveStepCache({ tenantId, registeredUrlId, goal, steps }) {
  const id = hashCacheKey(registeredUrlId, goal);
  const cachedSteps = steps
    .filter((s) => s.action)
    .map((s) => ({
      stepNumber: s.stepNumber,
      action: {
        type: s.action.type,
        resolvedSelector: isFastPathEligible(s.action) ? s.action.resolvedSelector : null,
      },
    }));
  if (cachedSteps.length === 0) return;
  await collections.stepCache(tenantId).doc(id).set({
    registeredUrlId,
    goal,
    steps: cachedSteps,
    updatedAt: new Date().toISOString(),
  });
}

module.exports = {
  FAST_PATH_ELIGIBLE_TYPES,
  isFastPathEligible,
  hashCacheKey,
  tryFastPathAction,
  loadStepCache,
  saveStepCache,
};
