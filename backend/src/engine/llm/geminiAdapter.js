const { GoogleGenerativeAI } = require('@google/generative-ai');
const env = require('../../config/env');
const { UIUX_CHECKLIST } = require('../uiuxChecklist');
const { buildReportPrompt } = require('./reportPrompt');
const { buildRecordingSummaryPrompt } = require('./recordingSummaryPrompt');

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
  "previousActionEffect": "직전 행동(action_history의 마지막 항목) 이후 화면이 실제로 어떻게 됐는지 판정. 이번이 첫 번째 행동이면 'none'. 그 항목의 thought에 적었던 기대와 지금 스크린샷을 비교해서: 예상대로 바뀌었으면 'success', execOk는 true인데(엔진이 클릭/입력 자체는 정상 실행했다고 확인) 화면이 직전과 똑같아 보이면 'no_change', 전혀 예상 못한 변화(에러 화면, 로그아웃 등)가 일어났으면 'unexpected'.",
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
  startUrl,
  currentUrl,
}) {
  const model = getModel();
  const goalBlock = checkpointGoal
    ? `\n너의 현재 목표(체크포인트): "${checkpointGoal}"\n목표와 무관한 행동은 하지 마라. finish로 멈출 때는 반드시 finishReason으로 성공/실패를 구분해라.\n`
    : '';
  // 사용자는 "주문 300번" 같은 ID나 정확한 버튼 이름을 안 알려주는 게 보통이다(비개발자
  // 대상 제품이라 애초에 그런 걸 모른다) — 그래서 "시작 지점과 같은 대상인지"를 사용자
  // 입력이 아니라 엔진이 이미 아는 시작/현재 URL만으로 매 스텝 스스로 점검하게 한다.
  // WebArena 538번(주문 주소 수정) 실측 재현에서, 그라운딩 실수로 엉뚱한 "재주문" 버튼을
  // 눌러 새 주문이 만들어졌는데도 원래 대상을 수정했다고 착각한 사례를 직접 확인했다.
  // "직전 스텝 URL"과 비교하는 버전도 시도했지만 재검증에서 오히려 더 안 좋았다(538
  // 3회 전부 실패 vs 이 버전 3회 중 1회 성공) — 실측 결과를 따라 이 버전으로 유지한다.
  const urlBlock = startUrl
    ? `\n<page_context>\n체크포인트 시작 시점 URL: ${startUrl}\n현재 URL: ${currentUrl}\n</page_context>\n`
    : '';
  const prompt = `${personaPrompt}
${goalBlock}${urlBlock}
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

result가 "success"인데도(엔진이 클릭/입력 자체는 정상 실행했다고 확인했는데도) 화면이 전혀
안 바뀌었다면, 이건 우리 쪽 실행 문제가 아니라 "정확히 눌렀는데 사이트가 반응하지 않는" 실제
문제일 수 있다 — 저장 버튼을 눌렀는데 로딩 상태에서 멈추는 경우 등이 실제로 있었다. 이런
경우 previousActionEffect를 "no_change"로 표시해라. 같은 요소에 같은 행동을 반복해도
바뀌지 않는다면(no_change가 연달아 나오면) 예산을 다 쓸 때까지 반복하지 말고, 몇 초 기다려도
안 바뀌는지 한 번만 wait로 확인한 뒤 finish(blocked)로 멈추고 thought에 "no_change가
반복됨"을 명확히 남겨라.

목표 지점(특정 게시판/카테고리/메뉴 등)으로 이동해야 할 때는, 검색 기능보다 사이트에 이미
있는 메뉴·사이드바·카테고리 링크를 먼저 찾아서 써라 — 검색은 결과 페이지에 그 위치 고유의
기능(정렬·필터 등)이 없는 경우가 많아 오히려 더 헤매게 된다. 직접 링크가 화면에 안 보일
때만 검색을 마지막 수단으로 써라.

finish로 "목표를 달성했다"고 판단하기 전에, 위 page_context의 현재 URL이 시작 시점 URL과
같은 대상을 가리키는지 다시 확인해라. 이미 특정 항목(주문/게시물/상품 등)을 보고 있다가
그걸 수정하는 게 목표였는데, 중간에 (의도치 않게) 새 항목이 만들어지거나 다른 항목으로
넘어가서 그걸 대신 손댔다면 — 목표가 명시적으로 "새로 만들어달라"는 게 아닌 이상 이건
실패다. URL의 ID나 경로 조각이 시작 시점과 달라져 있다면 특히 의심하고, 정말 같은
대상인지 화면 내용으로도 한 번 더 확인해라.

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
  const built = buildReportPrompt({ errors, steps, haltedInfo });
  if (built.shortcut) return built.shortcut;

  const model = getModel();
  const result = await model.generateContent(built.prompt);
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

// recordRoute.js가 기록한 사람의 행동(클릭/입력/제출, 입력값 자체는 없음)을 체크포인트
// 목표 한 줄로 요약한다 — routes.js의 parseCheckpoint가 그대로 소화할 수 있는 평문이다.
async function summarizeActionsToCheckpoint({ events, url }) {
  const { prompt } = buildRecordingSummaryPrompt({ events, url });
  const model = getModel();
  const result = await model.generateContent(prompt);
  return JSON.parse(result.response.text());
}

module.exports = {
  generateNextAction,
  generateReport,
  identifyLoginFields,
  identifyPaymentFields,
  evaluateUiUx,
  summarizeActionsToCheckpoint,
};
