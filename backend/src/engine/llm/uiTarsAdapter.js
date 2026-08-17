// UI-TARS(ByteDance의 GUI 그라운딩 전용 오픈소스 VLM)를 OpenRouter의 pay-per-token API로
// 호출한다. Gemini는 범용 추론(뭘 해야 하는지, 목표를 달성했는지)엔 강하지만, "스크린샷 속
// 이 텍스트가 정확히 어느 좌표에 있는지"를 40개짜리 요소 목록과 매칭하는 건 다른 종류의
// 능력이라 실수가 난다(네이버 '스포츠' 탭 사례로 실제 확인함) — 이 작업만 특화 모델에
// 넘기는 하이브리드 구조. GPU를 직접 운영하지 않아도 되는, 검증된 pay-per-token 경로로
// OpenRouter를 골랐다(https://openrouter.ai/bytedance/ui-tars-1.5-7b).
//
// ⚠️ 실제 API 키로 라이브 검증은 못 했다 — OpenRouter/UI-TARS의 공개 문서 기준으로 구현.
// 특히 좌표가 보낸 이미지 기준 실제 픽셀인지, 0-1000 정규화 값인지는 문서만으론 100%
// 확신할 수 없었다. "정규화면 뷰포트보다 큰 값일 것"이라는 식으로 자동 판별하는 방법도
// 시도해봤지만, 뷰포트 폭(보통 1280)이 이미 1000보다 커서 그 판별 자체가 신뢰할 수 없다는
// 걸 검증 스크립트로 직접 확인했다 — 그래서 자동 판별 없이 "받은 숫자를 그대로 픽셀
// 좌표로 쓴다"로 단순화했다. 실사용 중 클릭이 엉뚱한 곳을 찍으면, 좌표에 일정한 배율
// 오차가 있는지 확인해서 여기 스케일링을 한 줄 추가하면 된다.
const env = require('../../config/env');

// 테스트에서 로컬 목(mock) 서버를 가리키게 할 수 있도록 env로 오버라이드 가능하게 둔다
// (실제 운영에서는 항상 기본값 그대로 OpenRouter를 씀).
const OPENROUTER_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1/chat/completions';
// 2026-08 업그레이드 검토 기록: 더 큰 bytedance-research/ui-tars-72b:free로 교체를
// 시도했으나, 실제 호출 시 OpenRouter가 "No endpoints found"(HTTP 404)를 반환함을 직접
// 확인했다 — 모델 카드/가격 페이지엔 존재해도 그 시점에 이 모델을 서빙하는 프로바이더가
// 실제로는 없었다(무료 티어 커뮤니티 모델 특성상 흔한 일). 그래서 검증된 7B로 원복한다.
// UI-TARS-2(2026년 발표, 벤치마크상 1.5보다 크게 앞섬)는 이 시점 기준 OpenRouter에 아직
// 없다 — 나중에 올라오면 실제 호출로 먼저 확인한 뒤 교체할 것.
const MODEL = process.env.UI_TARS_MODEL || 'bytedance/ui-tars-1.5-7b';

function buildPrompt(instruction) {
  return `You are a GUI grounding model. Given a screenshot and an instruction describing an element, respond with the click point for that element.
Instruction: ${instruction}
Ignore advertisement banners, rotating promotional ribbons, or unrelated announcement text (e.g. near the top header) unless the instruction explicitly refers to one of those — pick the element that most specifically and literally matches the instruction's content.
Respond with the action in this exact format and nothing else:
click(point='<point>x,y</point>')`;
}

// UI-TARS 계열 모델은 보통 "<point>x,y</point>" 형식이나 "(x,y)" 형식으로 좌표를 낸다.
// 정확한 포맷이 버전마다 조금씩 달라질 수 있어서, 응답 텍스트에서 숫자 쌍을 정규식으로
// 관대하게 뽑아낸다 — 특정 포맷 문자열에 너무 엄격하게 의존하지 않기 위함. 정규화(0-1000)
// 여부를 자동 판별하려던 시도는 신뢰할 수 없어서 뺐다(위 주석 참고) — 받은 숫자를 그대로
// 픽셀 좌표로 쓴다. viewportWidth/Height는 현재 이 판별에 안 쓰이지만, 나중에 실사용
// 검증 후 스케일링이 필요해지면 바로 쓸 수 있게 시그니처는 유지해둔다.
// eslint-disable-next-line no-unused-vars
function parseCoordinates(text, viewportWidth, viewportHeight) {
  const match = text.match(/(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/);
  if (!match) return null;
  return { x: parseFloat(match[1]), y: parseFloat(match[2]) };
}

// instruction: "스포츠 탭 링크"처럼 화면에서 찾아야 할 대상을 설명하는 짧은 자연어.
// 실패하면(설정 안 됨/API 에러/파싱 실패) null을 반환 — 호출부가 기존 elementIndex
// 방식으로 자연스럽게 폴백하게 만든다(하이브리드가 실패해도 전체 실행이 죽지 않음).
async function groundElement({ screenshotBase64, instruction, viewportWidth, viewportHeight }) {
  if (!env.openRouterApiKey) return null;

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.openRouterApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: buildPrompt(instruction) },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${screenshotBase64}` } },
            ],
          },
        ],
        max_tokens: 100,
        temperature: 0,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) return null;
    return parseCoordinates(text, viewportWidth, viewportHeight);
  } catch {
    return null;
  }
}

module.exports = { groundElement, parseCoordinates };
