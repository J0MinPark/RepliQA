#!/usr/bin/env node
// RepliQA MCP 서버 — Claude Code/Cursor 같은 코딩 에이전트가 "코드 수정 → RepliQA로 QA →
// 결과를 바로 읽고 다시 수정"하는 원클릭 루프를 돌릴 수 있게, RepliQA REST API를 MCP
// 도구로 얇게 감싼다. 인증은 Firebase 로그인 대신 X-RepliQA-Api-Key 헤더를 쓴다(에이전트는
// 대화형 로그인을 할 수 없으므로) — 발급은 RepliQA 프론트/`POST /api/tenants/api-key`에서.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE_URL = process.env.REPLIQA_API_BASE_URL || 'http://localhost:3001';
const API_KEY = process.env.REPLIQA_API_KEY;

if (!API_KEY) {
  console.error('[repliqa-mcp] REPLIQA_API_KEY 환경변수가 필요합니다.');
  process.exit(1);
}

async function apiRequest(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-RepliQA-Api-Key': API_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `RepliQA API 요청 실패 (HTTP ${res.status})`);
  }
  return data;
}

function formatCheckpoints(checkpoints) {
  return Object.entries(checkpoints || {})
    .map(([i, c]) => [Number(i), c])
    .sort((a, b) => a[0] - b[0])
    .map(([i, c]) => {
      const findings = (c.uiuxFindings || [])
        .map((f) => `    - [${f.category}] ${f.detail || f.description}`)
        .join('\n');
      return `${i}. [${c.status}] ${c.goal || '(자유 탐색)'} — 행동 ${c.steps?.length || 0}회${
        findings ? `\n  UI/UX findings:\n${findings}` : ''
      }`;
    })
    .join('\n');
}

function formatRun(run) {
  if (run.status === 'queued' || run.status === 'running') {
    return `상태: ${run.status} (아직 진행 중)\n대상: ${run.targetUrl}\n페르소나: ${run.personaName}`;
  }
  if (run.status === 'failed') {
    return `상태: 실패\n대상: ${run.targetUrl}\n에러: ${run.error}`;
  }

  const lines = [
    `상태: 완료`,
    `대상: ${run.targetUrl}`,
    `페르소나: ${run.personaName}${run.routeName ? ` / 여정: ${run.routeName}` : ''}`,
    `요약: 총 ${run.summary?.totalActions ?? 0}개 행동 중 에러 ${run.summary?.totalErrors ?? 0}건`,
  ];
  if (run.haltedAtCheckpoint != null) {
    lines.push(`⚠ 체크포인트 ${run.haltedAtCheckpoint}에서 여정이 중단됨`);
  }
  lines.push('', '## 체크포인트별 상세', formatCheckpoints(run.checkpoints));
  if (run.collectedErrors?.length) {
    lines.push('', '## 수집된 에러 로그', run.collectedErrors.map((e) => `- ${e}`).join('\n'));
  }
  lines.push('', '## 코드 수정 지시문 (바로 코딩 에이전트에 전달 가능)', run.vibeCoderPrompt || '(없음)');
  return lines.join('\n');
}

const server = new McpServer({ name: 'repliqa-mcp-server', version: '1.0.0' });

server.registerTool(
  'list_registered_urls',
  {
    title: 'RepliQA에 등록된 URL 목록',
    description: 'RepliQA 테넌트에 등록·검증된 테스트 대상 URL 목록을 가져온다.',
    inputSchema: {},
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async () => {
    const urls = await apiRequest('/api/urls');
    const text = urls
      .map((u) => `- [${u.verified ? '검증됨' : '미검증'}] ${u.url} (id: ${u.id})`)
      .join('\n');
    return { content: [{ type: 'text', text: text || '등록된 URL이 없습니다.' }] };
  }
);

server.registerTool(
  'list_routes',
  {
    title: 'RepliQA 여정(체크포인트) 목록',
    description: '등록된 테스트 여정(체크포인트 목록) 목록을 가져온다. registeredUrlId로 필터링 가능.',
    inputSchema: { registeredUrlId: z.string().optional() },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ registeredUrlId }) => {
    const routes = await apiRequest(`/api/routes${registeredUrlId ? `?registeredUrlId=${registeredUrlId}` : ''}`);
    const text = routes
      .map((r) => `- ${r.name} (id: ${r.id}, ${r.checkpoints.length}단계, url: ${r.registeredUrlId})`)
      .join('\n');
    return { content: [{ type: 'text', text: text || '등록된 여정이 없습니다.' }] };
  }
);

server.registerTool(
  'list_personas',
  {
    title: 'RepliQA 페르소나 목록',
    description: '사용 가능한 AI 테스트 페르소나 목록을 가져온다.',
    inputSchema: {},
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async () => {
    const personas = await apiRequest('/api/personas');
    const text = personas.map((p) => `- ${p.name} (id: ${p.id}) — ${p.description}`).join('\n');
    return { content: [{ type: 'text', text }] };
  }
);

const runTestSchema = {
  registeredUrlId: z.string().describe('list_registered_urls로 조회한 검증된 URL의 id'),
  personaId: z.string().describe('list_personas로 조회한 페르소나 id'),
  routeId: z.string().optional().describe('여정 id (생략하면 자유 탐색)'),
};

server.registerTool(
  'run_qa_test',
  {
    title: 'RepliQA 테스트 실행 (비동기)',
    description: 'QA 테스트를 큐에 등록만 하고 즉시 반환한다. 결과는 get_qa_test_result로 별도 조회.',
    inputSchema: runTestSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  async (params) => {
    const result = await apiRequest('/api/test-runs', { method: 'POST', body: params });
    return { content: [{ type: 'text', text: `테스트 실행 등록됨. runId: ${result.id} (status: ${result.status})` }] };
  }
);

server.registerTool(
  'get_qa_test_result',
  {
    title: 'RepliQA 테스트 결과 조회',
    description: 'run_qa_test로 등록한 테스트의 현재 상태/결과를 조회한다.',
    inputSchema: { runId: z.string() },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ runId }) => {
    const run = await apiRequest(`/api/test-runs/${runId}`);
    return { content: [{ type: 'text', text: formatRun(run) }] };
  }
);

server.registerTool(
  'run_qa_test_and_wait',
  {
    title: 'RepliQA 테스트 실행 후 완료까지 대기 (원클릭)',
    description:
      '코드 수정 직후 QA를 돌리고 완료될 때까지 기다렸다가, 발견된 에러와 코드 수정 지시문(vibe coder prompt)까지 한 번에 받는다. 개발→QA→수정 루프의 핵심 도구.',
    inputSchema: { ...runTestSchema, timeoutSeconds: z.number().optional().describe('기본 300초') },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  async ({ timeoutSeconds = 300, ...params }) => {
    const created = await apiRequest('/api/test-runs', { method: 'POST', body: params });
    const deadline = Date.now() + timeoutSeconds * 1000;
    let run = created;
    while (Date.now() < deadline) {
      run = await apiRequest(`/api/test-runs/${created.id}`);
      if (run.status === 'done' || run.status === 'failed') break;
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
    return { content: [{ type: 'text', text: formatRun(run) }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[repliqa-mcp] running (base url: ${BASE_URL})`);
}

main().catch((err) => {
  console.error('[repliqa-mcp] fatal error:', err);
  process.exit(1);
});
