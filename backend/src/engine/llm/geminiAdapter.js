const { GoogleGenerativeAI } = require('@google/generative-ai');
const env = require('../../config/env');
const { UIUX_CHECKLIST } = require('../uiuxChecklist');

// LLM 프로바이더를 여기 뒤로 숨겨둔다. 지금은 Gemini만 구현하지만, 나중에 다른
// 모델로 바꾸더라도 이 파일의 함수 시그니처(generateNextAction/generateReport/
// identifyLoginFields)만 유지하면 상위 엔진 코드는 건드릴 필요가 없다.
const genAI = new GoogleGenerativeAI(env.geminiApiKey);

function getModel() {
  return genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { responseMimeType: 'application/json' },
  });
}

const ACTION_SCHEMA_HINT = `
반드시 아래 JSON 스키마를 그대로 따라라. 다른 설명은 붙이지 마라:
{
  "thought": "현재 화면 상황과 왜 이 행동을 선택했는지 (1~2문장)",
  "action": {
    "type": "아래 action.type 설명 중 하나",
    "elementIndex": 0,
    "targetElementIndex": 0,
    "targetDescription": "click/type/hover/paste/clear/rapid_click/key(elementIndex 지정 시)에는 항상 채워라 — 그 요소를 화면에서 사람이 찾을 수 있게 설명하는 짧은 문구(예: '스포츠 탭 링크', '검색창'). elementIndex가 실제로는 틀렸을 경우의 보정용으로 별도 모델이 이 설명으로 좌표를 다시 확인한다",
    "text": "type/paste일 때 입력할 문자열",
    "clear": false,
    "optionLabel": "select일 때만, 그 요소의 options 목록에 있는 라벨 중 정확히 하나",
    "key": "key일 때만: Enter, Tab, Escape, Backspace, Delete 등",
    "times": 1,
    "direction": "scroll일 때만: up, down, top, bottom",
    "amount": 600,
    "preset": "resize_viewport일 때만: mobile, tablet, desktop",
    "orientation": "resize_viewport일 때만: portrait(기본) 또는 landscape",
    "fixtureType": "upload_file일 때만: valid_image, valid_document, disallowed_extension, oversized",
    "scope": "clear_storage일 때만: cookies, localStorage, sessionStorage, all",
    "offline": false,
    "scheme": "set_color_scheme일 때만: dark, light",
    "url": "navigate일 때만: 이동할 URL(등록된 대상과 같은 호스트만 허용)",
    "tabIndex": 0,
    "waitMs": 500
  },
  "done": false,
  "finishReason": "action.type이 finish일 때만: goal_achieved 또는 blocked"
}
요소는 반드시 제공된 interactiveElements 배열의 "index" 값으로만 지정해라. targetDescription은 그
index를 대체하는 게 아니라, 화면이 복잡해서(요소가 많거나 비슷한 텍스트가 여러 개일 때) elementIndex를
잘못 골랐을 가능성에 대비한 보정용 설명이다 — 항상 성실하게 채워라.

중요: elementIndex를 100% 확신할 수 없어도 괜찮다. 스크린샷에서 목표에 맞는 게 보이면,
목록에서 그나마 가장 가까운 elementIndex를 골라 일단 click/type 등을 시도해라 — 정확한 클릭
좌표는 targetDescription을 바탕으로 별도 검증 단계가 다시 확인해준다. "목록의 이 인덱스가
정확히 그 요소인지 확신이 안 선다"는 이유로 포기하거나(finish/blocked) 스크롤로 도망치지
마라 — 스크린샷에 눈으로 보이는데 목록과 매칭이 안 된다고 느껴질 때일수록, 그 실패를
피하려고 회피하는 게 아니라 가장 그럴듯한 index로 과감히 시도하는 쪽이 정답이다. 정말로
스크린샷 어디에도 안 보일 때만 스크롤하거나 포기해라.

각 action.type 설명:
- click: elementIndex 요소를 클릭
- type: elementIndex 요소를 클릭 후 text를 타이핑. clear:true면 기존 값을 지우고 입력(수정 시나리오)
- clear: elementIndex 요소의 내용을 지우기만 함(재입력 없음) — "입력값 전체 삭제" 테스트용
- select: 드롭다운(elementIndex)에서 optionLabel(또는 optionValue) 선택. options 필드에 나열된 항목 중 정확히 하나를 골라라 — 화면에 안 보일 수 있다(예: 국가/카드사 선택)
- hover: elementIndex 위에 마우스만 올림(클릭 안 함) — 툴팁/호버 메뉴 확인용
- drag: elementIndex 요소를 targetElementIndex 위치로 드래그 — 순서 변경/이동 UI용. draggable 속성이 있는 요소만 대상으로 시도해라
- paste: elementIndex에 text를 클립보드 붙여넣기로 입력(타이핑이 아니라 실제 paste 이벤트) — "붙여넣기 방지" 필드 우회 테스트용
- key: elementIndex(선택, 없으면 방금 입력한 필드 등 현재 포커스 유지)에서 key를 누름. times로 반복(예: Backspace 여러 번). 폼을 Enter로 제출할 때도 이걸 써라
- rapid_click: elementIndex를 times(기본 2)만큼 아주 빠르게 연속 클릭 — 중복 제출/중복 클릭 방지 테스트용
- scroll: 페이지 스크롤. direction이 top/bottom이면 맨 위/아래로, up/down이면 amount(px)만큼
- go_back / go_forward: 브라우저 뒤로가기/앞으로가기
- reload: 현재 페이지 새로고침
- resize_viewport: 브라우저 화면 크기를 preset(mobile/tablet/desktop)+orientation으로 변경 — 반응형 레이아웃/화면 회전 확인용
- set_color_scheme: 다크모드/라이트모드 전환(scheme) — 테마 전환 시 깨지는 텍스트/색상 확인용
- set_network: offline:true/false로 네트워크 연결을 끊거나 복구 — 오프라인 처리, 웹소켓 재연결 확인용
- clear_storage: scope에 지정한 저장소(쿠키/로컬스토리지/세션스토리지)를 강제로 비움 — 강제 로그아웃 시 크래시 없이 안전하게 초기 상태로 돌아가는지 확인용
- navigate: url로 직접 이동(등록된 대상과 같은 호스트만 허용) — 관리자 페이지 등 권한 없는 URL 강제 접근, IDOR(다른 사람 리소스 id로 파라미터 변조) 테스트용
- open_duplicate_tab: 같은 로그인 세션을 공유하는 새 탭을 현재 페이지와 같은 주소로 염 — 동시성/경합 조건(두 탭에서 같은 데이터 동시 수정) 테스트용
- switch_tab: tabIndex(0=원래 탭, 1=open_duplicate_tab으로 연 탭...)로 이후 액션의 대상 탭을 전환
- upload_file: elementIndex(파일 입력 요소)에 fixtureType에 맞는 테스트 파일을 업로드 — 실제 파일 내용은 신경 쓸 필요 없음(테스트 픽스처가 자동으로 쓰임)
- read_test_inbox: 이메일/문자 인증이 필요한 단계에서, 테스트 인박스에 온 최신 메일을 읽어 인증 코드를 elementIndex에 자동 입력하거나(코드인 경우) 재설정 링크로 자동 이동(링크인 경우). "인증 메일을 보냈습니다" 같은 화면을 만나면 이 액션을 써라 — 테스트 인박스가 설정 안 돼 있으면 실패로 보고된다
- wait: waitMs만큼 대기(장시간 세션 만료 테스트로 태그된 체크포인트가 아니면 최대 5초로 제한됨)
- finish: 더 이상 할 행동이 없을 때

목표를 실제로 달성했다면 action.type을 "finish", done을 true, finishReason을 "goal_achieved"로 설정해라.
반대로 더 이상 시도할 방법이 없어서(화면이 막혔거나, 필요한 요소가 안 보이거나, 봇 탐지 등으로 차단돼서)
목표를 달성하지 못한 채 멈춰야 한다면 action.type을 "finish", done을 true, finishReason을 "blocked"로 설정하고
thought에 왜 막혔는지 구체적으로 남겨라. "일단 끝냈다"고 뭉뚱그리지 말고, 성공과 실패를 반드시 구분해라 —
이 구분이 최종 리포트의 성공/실패 판정에 그대로 쓰인다.
`;

async function generateNextAction({
  screenshotBase64,
  elements,
  personaPrompt,
  checkpointGoal,
  history,
  stepNumber,
  maxActions,
}) {
  const model = getModel();
  const goalBlock = checkpointGoal
    ? `\n너의 현재 목표(체크포인트): "${checkpointGoal}"\n목표와 무관한 행동은 하지 마라. finish로 멈출 때는 반드시 finishReason으로 성공/실패를 구분해라.\n`
    : '';
  const prompt = `${personaPrompt}
${goalBlock}
너는 지금 이 웹페이지에서 ${stepNumber}/${maxActions} 번째 행동을 결정해야 한다.
스크린샷과 아래 인터랙티브 요소 목록(좌표 포함)을 보고 판단해라.

<interactive_elements>
${JSON.stringify(elements)}
</interactive_elements>

<action_history>
각 항목의 result는 그 행동이 실제로 정상 실행됐는지를 엔진이 직접 확인한 결과다(스크린샷으로
네가 추측하는 게 아니라 확정된 사실이다). "실패: ..."로 나온 행동은 실제로 실행되지 않았거나
엉뚱한 곳을 건드린 것이니, 같은 행동을 그대로 반복하지 말고 다른 접근을 시도해라.
${JSON.stringify(history)}
</action_history>

${ACTION_SCHEMA_HINT}`;

  const result = await model.generateContent([
    { text: prompt },
    { inlineData: { mimeType: 'image/jpeg', data: screenshotBase64 } },
  ]);
  return JSON.parse(result.response.text());
}

// haltedInfo: 체크포인트가 기술적 에러 없이도 "목표를 못 이루고 막혔을" 수 있다(예: 구글
// 봇 탐지, 필요한 요소가 아예 안 보임). errors가 비어 있다고 무조건 "안정적"이라고 하면
// 이런 케이스를 놓치므로, haltedInfo가 있으면 errors가 비어 있어도 실제 리포트를 만든다.
async function generateReport({ errors, steps, haltedInfo }) {
  if ((!errors || errors.length === 0) && !haltedInfo) {
    return { error_analysis: '', vibe_coder_prompt: '발생한 에러가 없습니다. 서비스가 안정적입니다.' };
  }

  const model = getModel();
  const haltedBlock = haltedInfo
    ? `\n<halted_checkpoint>\n목표: ${haltedInfo.checkpointGoal || '(자유 탐색)'}\n막힌 이유: ${haltedInfo.reason}\n이 체크포인트는 기술적 에러(콘솔/네트워크 에러)가 없어도 목표를 달성하지 못해 실패로 처리됐다. 이 이유도 원인 분석에 반드시 포함해라.\n</halted_checkpoint>\n`
    : '';
  const prompt = `너는 바이브코더를 위한 프롬프트 생성용 봇이야.
감정적인 표현은 빼고, 시니어 개발자처럼 건조하고 명확하게 해결 코드만 제안해줘.
아래는 AI 페르소나가 실제로 수행한 행동 타임라인과, 그 과정에서 수집된 에러 로그다.

원인을 판단할 때 반드시 지켜야 할 규칙(실사이트 QA에서 이 규칙을 안 지켜서 실제로 존재하지
않는 버그를 고치라고 잘못 지시한 사례가 있었다):
- 각 스텝의 execOk/execError/execWarning은 엔진이 직접 확인한 사실이다. 반면 thought는
  AI 페르소나의 그 순간의 주관적 판단(추측)일 뿐이니, 이 둘이 어긋나면 사실(execOk/
  execError/execWarning) 쪽을 신뢰해라.
- execWarning이 있는 스텝은 "그 클릭 좌표가 실제로는 의도한 요소를 가리키지 않았다"는
  뜻이다. 같은 체크포인트 안에서 이후에 실패가 있었다면 이 스텝을 최우선 원인 후보로
  검토해라.
- 반대로 모든 스텝이 execOk:true이고 execWarning/execError도 없는데 목표를 달성하지
  못했다면, 이건 "우리 자동화 코드에 확실한 버그가 있다"는 뜻이 아니다. 이런 경우 특정
  로직을 "고쳐라"는 식의 확정적 지시를 내리지 마라 — 대신 가능한 원인을 "~일 가능성이
  있다"고 조심스럽게 제시하고, "실제 개발자가 브라우저로 직접 재현해서 확인이 필요하다"는
  말을 반드시 포함해라. 근거 없이 존재하지 않는 버그를 고치라고 확정 지시하는 건 개발자의
  시간을 낭비시키는 심각한 실수다.
${haltedBlock}
{
  "error_analysis": "수집된 에러들(및 막힌 체크포인트가 있다면 그 이유)에 대한 기술적 원인 분석. 어디까지가 확인된 사실이고 어디부터가 추정인지 구분해서 써라.",
  "vibe_coder_prompt": "바이브코더에게 전달할 구체적인 코드 수정 지시문. 근거가 확실할 때만 구체적인 코드 수정을 지시하고, 불확실하면 재현 확인부터 요청해라. 막힌 원인이 우리 앱의 버그가 아니라 외부 요인(예: 대상 사이트의 봇 탐지, 광고 오버레이)이라면 그 사실을 명시해라."
}

<steps>
${JSON.stringify(steps)}
</steps>

<error_logs>
${JSON.stringify(errors || [])}
</error_logs>`;

  const result = await model.generateContent(prompt);
  return JSON.parse(result.response.text());
}

// 로그인 폼 필드를 찾을 때는 실제 비밀번호 값을 LLM에게 보여주지 않는다 —
// "어떤 요소가 아이디/비밀번호/제출 버튼인지"만 물어보고, 실제 입력은 서버가 한다.
async function identifyLoginFields({ screenshotBase64, elements }) {
  const model = getModel();
  const prompt = `아래는 로그인 페이지(혹은 로그인 폼이 포함된 페이지)의 인터랙티브 요소 목록이다.
아이디/이메일 입력창, 비밀번호 입력창, 로그인 제출 버튼에 해당하는 요소의 index를 찾아라.
해당 요소가 화면에 없으면 null로 응답해라.

{
  "usernameIndex": 0,
  "passwordIndex": 1,
  "submitIndex": 2
}

<interactive_elements>
${JSON.stringify(elements)}
</interactive_elements>`;

  const result = await model.generateContent([
    { text: prompt },
    { inlineData: { mimeType: 'image/jpeg', data: screenshotBase64 } },
  ]);
  return JSON.parse(result.response.text());
}

// 체크포인트에 처음 진입했을 때 1회 호출. 매 마이크로스텝마다 부르면 같은 화면에 대해
// 중복된 지적이 반복돼서 노이즈가 되므로, "이 화면에 도착한 시점"에만 평가한다.
// objectiveFindings(uiuxChecks.js의 결정론적 결과)를 함께 보여줘서 LLM이 중복 탐지를
// 반복하지 않고, 객관적으로 못 잡는 부분(위계·카피톤·일관성 등)에 집중하게 한다.
async function evaluateUiUx({ screenshotBase64, elements, objectiveFindings, checkpointGoal }) {
  const model = getModel();
  const prompt = `너는 시니어 프론트엔드 개발자 겸 프로덕트 디자이너로서 아래 화면을 평가한다.
${checkpointGoal ? `사용자는 지금 "${checkpointGoal}" 단계에 있다.\n` : ''}
${UIUX_CHECKLIST}

아래는 이미 결정론적으로 계산된 객관적 이슈들이다(참고만 하고 중복 보고하지 마라):
<objective_findings>
${JSON.stringify(objectiveFindings || [])}
</objective_findings>

<interactive_elements>
${JSON.stringify(elements)}
</interactive_elements>

명백한 문제만 findings로 반환해라. 문제가 없으면 빈 배열을 반환해라.
{
  "findings": [
    { "category": "consistency|layout|feedback|typography|hierarchy", "severity": "info" | "warning", "description": "구체적인 문제와 위치" }
  ]
}`;

  const result = await model.generateContent([
    { text: prompt },
    { inlineData: { mimeType: 'image/jpeg', data: screenshotBase64 } },
  ]);
  return JSON.parse(result.response.text());
}

// 로그인 필드 탐지와 동일한 원칙: 실제 카드번호/CVC 값은 LLM에게 절대 보여주지 않는다.
// "어떤 요소가 카드번호/유효기간/CVC/생년월일-사업자번호/예금주명 칸인지"만 물어보고,
// 실제 문자열 입력은 서버가 직접 한다.
async function identifyPaymentFields({ screenshotBase64, elements }) {
  const model = getModel();
  const prompt = `아래는 결제 정보 입력 화면(카드/계좌 정보 입력 폼)의 인터랙티브 요소 목록이다.
카드번호, 유효기간(MM/YY), CVC, 생년월일 또는 사업자번호, 예금주/카드소유자명 입력창에
해당하는 요소의 index를 찾아라. 해당 요소가 화면에 없으면 null로 응답해라.

{
  "cardNumberIndex": 0,
  "expiryIndex": 1,
  "cvcIndex": 2,
  "birthOrBusinessIndex": 3,
  "cardHolderNameIndex": 4
}

<interactive_elements>
${JSON.stringify(elements)}
</interactive_elements>`;

  const result = await model.generateContent([
    { text: prompt },
    { inlineData: { mimeType: 'image/jpeg', data: screenshotBase64 } },
  ]);
  return JSON.parse(result.response.text());
}

module.exports = {
  generateNextAction,
  generateReport,
  identifyLoginFields,
  identifyPaymentFields,
  evaluateUiUx,
};
