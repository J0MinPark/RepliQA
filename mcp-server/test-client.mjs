// mcp-server/src/index.js를 실제 서브프로세스로 띄우고, 공식 SDK의 Client로
// Claude Code/Cursor가 하는 것과 동일하게 stdio를 통해 도구를 호출해본다.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const [, , apiKeyArg, registeredUrlIdArg, personaIdArg] = process.argv;

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}`);
  if (!cond) failures++;
}

async function main() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['src/index.js'],
    env: {
      REPLIQA_API_BASE_URL: 'http://localhost:3001',
      REPLIQA_API_KEY: apiKeyArg,
    },
  });

  const client = new Client({ name: 'repliqa-mcp-test-client', version: '1.0.0' });
  await client.connect(transport);

  console.log('1) 도구 목록 조회...');
  const { tools } = await client.listTools();
  console.log('   ', tools.map((t) => t.name).join(', '));
  const expected = [
    'list_registered_urls',
    'list_routes',
    'list_personas',
    'run_qa_test',
    'get_qa_test_result',
    'run_qa_test_and_wait',
  ];
  check('6개 도구 전부 등록됨', expected.every((name) => tools.some((t) => t.name === name)));

  console.log('\n2) list_personas 호출...');
  const personasResult = await client.callTool({ name: 'list_personas', arguments: {} });
  const personasText = personasResult.content[0].text;
  console.log('   ', personasText.replace(/\n/g, ' / '));
  check('standard 페르소나가 목록에 있음', personasText.includes('standard'));

  console.log('\n3) list_registered_urls 호출...');
  const urlsResult = await client.callTool({ name: 'list_registered_urls', arguments: {} });
  console.log('   ', urlsResult.content[0].text);
  check('등록된 URL이 검증됨 상태로 보임', urlsResult.content[0].text.includes('검증됨'));

  console.log('\n4) run_qa_test_and_wait 호출 (실제 Gemini/Playwright 실행, 최대 4분 대기)...');
  // MCP SDK의 클라이언트 요청 기본 타임아웃은 60초라 우리 도구의 내부 폴링(최대
  // timeoutSeconds)보다 먼저 끊긴다 — 도구 자체의 timeoutSeconds보다 넉넉하게 요청
  // 타임아웃을 따로 지정해야 한다.
  const runResult = await client.callTool(
    {
      name: 'run_qa_test_and_wait',
      arguments: {
        registeredUrlId: registeredUrlIdArg,
        personaId: personaIdArg,
        timeoutSeconds: 240,
      },
    },
    undefined,
    { timeout: 280000 }
  );
  const reportText = runResult.content[0].text;
  console.log('\n--- 에이전트가 받는 최종 리포트 텍스트 ---');
  console.log(reportText);
  console.log('--- 끝 ---\n');

  check('리포트에 "상태: 완료" 포함', reportText.includes('상태: 완료'));
  check('리포트에 "코드 수정 지시문" 섹션 포함', reportText.includes('코드 수정 지시문'));

  await client.close();
  console.log(`\n${failures === 0 ? '모두 통과' : failures + '건 실패'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
