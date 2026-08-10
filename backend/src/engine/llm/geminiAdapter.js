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
    "type": "click 또는 type 또는 wait 또는 go_back 또는 finish",
    "elementIndex": 0,
    "text": "type일 때만 입력할 문자열",
    "waitMs": 500
  },
  "done": false
}
요소는 반드시 제공된 interactiveElements 배열의 "index" 값으로만 지정해라. 자유 텍스트로 요소를 설명하지 마라.
더 이상 테스트할 행동이 없다고 판단되면 action.type을 "finish"로, done을 true로 설정해라.
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
    ? `\n너의 현재 목표(체크포인트): "${checkpointGoal}"\n이 목표를 달성했다고 판단되면 action.type을 "finish"로, done을 true로 설정해라. 목표와 무관한 행동은 하지 마라.\n`
    : '';
  const prompt = `${personaPrompt}
${goalBlock}
너는 지금 이 웹페이지에서 ${stepNumber}/${maxActions} 번째 행동을 결정해야 한다.
스크린샷과 아래 인터랙티브 요소 목록(좌표 포함)을 보고 판단해라.

<interactive_elements>
${JSON.stringify(elements)}
</interactive_elements>

<action_history>
${JSON.stringify(history)}
</action_history>

${ACTION_SCHEMA_HINT}`;

  const result = await model.generateContent([
    { text: prompt },
    { inlineData: { mimeType: 'image/jpeg', data: screenshotBase64 } },
  ]);
  return JSON.parse(result.response.text());
}

async function generateReport({ errors, steps }) {
  if (!errors || errors.length === 0) {
    return { error_analysis: '', vibe_coder_prompt: '발생한 에러가 없습니다. 서비스가 안정적입니다.' };
  }

  const model = getModel();
  const prompt = `너는 바이브코더를 위한 프롬프트 생성용 봇이야.
감정적인 표현은 빼고, 시니어 개발자처럼 건조하고 명확하게 해결 코드만 제안해줘.
아래는 AI 페르소나가 실제로 수행한 행동 타임라인과, 그 과정에서 수집된 에러 로그다.

{
  "error_analysis": "수집된 에러들에 대한 기술적 원인 분석",
  "vibe_coder_prompt": "바이브코더에게 전달할 구체적인 코드 수정 지시문"
}

<steps>
${JSON.stringify(steps)}
</steps>

<error_logs>
${JSON.stringify(errors)}
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

module.exports = { generateNextAction, generateReport, identifyLoginFields, evaluateUiUx };
