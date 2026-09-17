const { z } = require('zod');
const crypto = require('node:crypto');

const safePath = z.string().trim().min(1).max(1000).refine((value) => value.startsWith('/') && !value.startsWith('//') && !/[\\\r\n]/.test(value), '경로는 /로 시작해야 합니다.');
const actionSchema = z.object({ action: z.enum(['click', 'fill', 'select', 'check', 'expect', 'scroll']), target: z.string().trim().min(1).max(200), value: z.string().max(500).optional(), sensitive: z.boolean().optional() })
  .refine((step) => !['fill', 'select'].includes(step.action) || step.value !== undefined, '입력·선택 동작에는 테스트 값을 지정하세요.')
  .refine((step) => step.action !== 'scroll' || ['up', 'down', 'top', 'bottom'].includes(step.target), '스크롤 방향은 위·아래·맨 위·맨 아래만 지원합니다.')
  .refine((step) => step.action !== 'scroll' || step.value === undefined || /^(?:[1-9]\d{0,2}|1\d{3}|2000)$/.test(step.value), '스크롤 이동량은 1~2,000px 정수여야 합니다.');
const controlExpectationSchema = z.object({
  role: z.enum(['button', 'link', 'textbox', 'checkbox', 'combobox', 'radio', 'switch']),
  name: z.string().trim().min(1).max(200), state: z.enum(['visible', 'enabled', 'disabled', 'checked', 'unchecked']),
}).refine((value) => !['checked', 'unchecked'].includes(value.state) || ['checkbox', 'radio', 'switch'].includes(value.role), '선택 여부는 체크박스·라디오·스위치에만 지정하세요.');
const referenceSchema = z.object({ name: z.string().min(1).max(300), data: z.string().max(4 * 1024 * 1024).regex(/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/), source: z.string().max(1000).optional() });
const profileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  environment: z.enum(['development', 'staging', 'production']).default('staging'),
  baseUrl: z.string().url().max(1500).refine((value) => { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password; }, 'HTTP(S) 사이트 주소를 입력하세요. 로그인 정보는 주소에 넣지 마세요.'),
  requirement: z.string().trim().min(1).max(12000),
  pages: z.array(z.object({ path: safePath, title: z.string().trim().min(1).max(120), expectedTexts: z.array(z.string().trim().min(1).max(500)).max(40), steps: z.array(actionSchema).max(12), requiredSteps: z.array(actionSchema).max(12).optional(), expectedPath: safePath.optional(), referenceImage: referenceSchema.optional() })).min(1).max(6).refine((pages) => new Set(pages.map((page) => page.path)).size === pages.length, '화면 경로가 중복되었습니다.'),
  privacy: z.object({ maskSelectors: z.array(z.string().min(1).max(300)).max(30).default([]), redactValues: z.array(z.string().min(1).max(500)).max(30).default([]) }).optional(),
  viewport: z.object({ width: z.number().int().min(320).max(1920), height: z.number().int().min(480).max(1440) }),
  provider: z.enum(['ollama', 'anthropic']).default('ollama'),
  allowPaidAi: z.boolean().default(false),
  model: z.string().trim().regex(/^[a-zA-Z0-9._:-]{1,100}$/).default('qwen3-vl:4b-instruct'),
  maxOutputTokens: z.number().int().min(1024).max(8192).default(4096),
  localResources: z.object({
    contextTokens: z.union([z.literal(4096), z.literal(8192), z.literal(16384)]),
    batchTokens: z.union([z.literal(64), z.literal(128), z.literal(512)]),
    keepAliveSeconds: z.union([z.literal(0), z.literal(10), z.literal(30), z.literal(300)]),
  }).strict().optional(),
  visualThreshold: z.number().min(0).max(100).default(1),
}).superRefine((value, ctx) => {
  if (value.provider === 'ollama' && !['qwen3-vl:2b-instruct', 'qwen3-vl:4b-instruct', 'qwen3-vl:8b-instruct'].includes(value.model)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '지원하는 로컬 화면 인식 모델을 선택하세요.' });
});
const caseSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9-]{1,80}$/), selected: z.boolean(), title: z.string().trim().min(1).max(150), path: safePath,
  expectedTexts: z.array(z.string().trim().min(1).max(500)).max(40), steps: z.array(actionSchema).max(12),
  expectation: z.string().trim().min(1).max(3000),
  expectedControls: z.array(controlExpectationSchema).max(30).optional(),
  expectedPath: safePath.optional(),
});

function validateProfile(input) { return profileSchema.parse(input); }
function safeId(value) { if (!/^[a-zA-Z0-9-]{1,80}$/.test(value || '')) throw new Error('잘못된 문서 식별자입니다.'); return value; }
function targetUrl(profile, routePath) {
  const base = new URL(profile.baseUrl);
  const target = new URL(routePath, base);
  if (target.origin !== base.origin || !safePath.safeParse(routePath).success) throw new Error('등록된 서버 안의 경로만 검사할 수 있습니다.');
  return target.href;
}
function fingerprint(profile) { return crypto.createHash('sha256').update(JSON.stringify(profile)).digest('hex'); }
function serializeEnv(profile, id) {
  const values = { REPLIQA_PROFILE_ID: id, REPLIQA_NAME: profile.name, REPLIQA_ENVIRONMENT: profile.environment,
    REPLIQA_BASE_URL: profile.baseUrl, REPLIQA_AI_PROVIDER: profile.provider || 'anthropic', REPLIQA_AI_MODEL: profile.model,
    REPLIQA_ALLOW_PAID_AI: profile.allowPaidAi === true ? 'true' : 'false',
    REPLIQA_VIEWPORT_WIDTH: String(profile.viewport.width), REPLIQA_VIEWPORT_HEIGHT: String(profile.viewport.height),
    REPLIQA_PROFILE_FILE: 'profile.json' };
  return '# RepliQA가 자동 생성합니다. 키와 로그인 세션은 OS 암호화 저장소에 보관합니다.\n' + Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n';
}
function validateReview(plan, cases, profile) {
  const parsed = z.array(caseSchema).min(1).max(10).parse(cases);
  const allowed = new Set(plan.cases.map((item) => item.id));
  if (parsed.length !== allowed.size || new Set(parsed.map((item) => item.id)).size !== allowed.size || parsed.some((item) => !allowed.has(item.id))) throw new Error('원본 케이스 전체의 선택 여부가 필요합니다.');
  if (!parsed.some((item) => item.selected)) throw new Error('실행할 케이스를 선택하세요.');
  if (profile) {
    const { containsSteps } = require('./browser-flow.cjs');
    for (const item of parsed.filter((entry) => entry.selected)) {
      const page = profile.pages.find((entry) => entry.path === item.path);
      const entryMatches = page?.steps.every((step, index) => { const actual = item.steps[index]; return actual && actual.action === step.action && actual.target === step.target && actual.value === step.value; });
      if (!page || !entryMatches || !containsSteps(item.steps.slice(page.steps.length), page.requiredSteps)) throw new Error('등록된 경로 또는 필수 동작이 계획에서 빠졌습니다. 계획을 수정하세요.');
      if (page.expectedPath && item.expectedPath !== page.expectedPath) throw new Error('등록된 최종 도착 경로가 계획에서 빠졌습니다.');
      if (!page.expectedTexts.every((text) => item.expectedTexts.includes(text))) throw new Error('필수 결과 문구가 계획에서 빠졌습니다.');
    }
    for (const page of profile.pages.filter((entry) => entry.requiredSteps?.length)) if (!parsed.some((item) => item.selected && item.path === page.path)) throw new Error('필수 동작이 있는 화면을 검사에서 제외할 수 없습니다.');
  }
  return parsed;
}
module.exports = { profileSchema, caseSchema, actionSchema, validateProfile, validateReview, targetUrl, safeId, fingerprint, serializeEnv };
