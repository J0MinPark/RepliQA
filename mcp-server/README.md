# RepliQA MCP Server

Claude Code, Cursor 같은 코딩 에이전트가 RepliQA를 직접 호출할 수 있게 해주는 MCP 서버.
"코드 수정 → RepliQA로 QA 실행 → 에러/수정 지시문을 바로 받아서 다시 수정"하는 루프를
에이전트가 도구 호출만으로 돌릴 수 있다.

## 준비

1. RepliQA API 서버가 떠 있어야 함 (`backend/README.md` 참고).
2. RepliQA에 로그인한 뒤 `POST /api/tenants/api-key` 호출(또는 프론트에 추가된 버튼)로 API
   키를 발급받는다 — **응답에서 한 번만 보여주므로 바로 복사해서 저장**.
3. `cd mcp-server && npm install`

## 도구 목록

- `list_registered_urls` — 등록된 테스트 대상 URL 목록
- `list_routes` — 등록된 여정(체크포인트) 목록
- `list_personas` — 사용 가능한 페르소나 목록
- `run_qa_test` — 테스트를 큐에 등록만 하고 즉시 반환 (비동기)
- `get_qa_test_result` — `run_qa_test`로 등록한 실행의 상태/결과 조회
- `run_qa_test_and_wait` — 등록 후 완료까지 기다렸다가 에러·수정 지시문까지 한 번에 반환
  (원클릭 루프의 핵심 도구). 실제 Gemini/Playwright(또는 결제 체크포인트가 있으면 Camoufox)
  실행이 끝날 때까지 기다리므로 수십 초~수 분이 걸릴 수 있다. 인자로 받는
  `timeoutSeconds`(기본값 있음)는 이 도구 내부의 폴링 한도일 뿐이고, **MCP 클라이언트 자체의
  요청 타임아웃**(예: `@modelcontextprotocol/sdk`의 `Client.callTool()` 기본값 60초)이 그보다
  짧으면 도구가 끝나기 전에 클라이언트 쪽에서 먼저 타임아웃 에러가 난다. Claude Code/Cursor
  에서 응답이 오래 걸리는 것처럼 보여도 정상이니, 클라이언트가 요청 타임아웃을 설정할 수 있는
  경우 `timeoutSeconds`보다 넉넉하게 잡아둘 것.

## Claude Code에 연결

프로젝트 루트(또는 사용자 설정)에 `.mcp.json`:

```json
{
  "mcpServers": {
    "repliqa": {
      "command": "node",
      "args": ["절대경로/RepliQA-Workspace/mcp-server/src/index.js"],
      "env": {
        "REPLIQA_API_BASE_URL": "http://localhost:3001",
        "REPLIQA_API_KEY": "여기에_발급받은_키"
      }
    }
  }
}
```

또는 CLI로: `claude mcp add repliqa -- node 절대경로/mcp-server/src/index.js`
(환경변수는 `claude mcp add`의 `--env` 옵션이나 `.mcp.json` 편집으로 설정)

## Cursor에 연결

Cursor 설정의 MCP 섹션(`~/.cursor/mcp.json` 또는 프로젝트 `.cursor/mcp.json`)에 동일한
구조로 추가:

```json
{
  "mcpServers": {
    "repliqa": {
      "command": "node",
      "args": ["절대경로/RepliQA-Workspace/mcp-server/src/index.js"],
      "env": {
        "REPLIQA_API_BASE_URL": "http://localhost:3001",
        "REPLIQA_API_KEY": "여기에_발급받은_키"
      }
    }
  }
}
```

## 사용 예시 (에이전트에게 이렇게 시키면 됨)

> "방금 수정한 로그인 페이지, RepliQA로 QA 돌리고 결과 알려줘. registeredUrlId는
> `xxxx`, personaId는 `rage-click`이야."

에이전트가 `run_qa_test_and_wait`를 호출하면 완료될 때까지 기다렸다가, 발견된 에러와 바로
적용 가능한 수정 지시문을 받아서 그 자리에서 코드를 고칠 수 있다.
