// .mcp.json 내용을 만드는 순수 함수 — mcp-server/connect.js(Node 버전)와 같은 병합 로직을
// 브라우저(File System Access API 경로)에서도 그대로 쓸 수 있게 뺐다. 기존에 다른 MCP
// 서버가 등록돼 있어도 그건 보존하고 repliqa 항목만 갱신한다.
export function buildMcpConfig(existingConfigText, { apiKey, apiBaseUrl, serverRelativePath }) {
  let config = {};
  if (existingConfigText) {
    try {
      config = JSON.parse(existingConfigText);
    } catch {
      config = {};
    }
  }
  config.mcpServers = config.mcpServers || {};
  config.mcpServers.repliqa = {
    command: 'node',
    args: [serverRelativePath],
    env: {
      REPLIQA_API_BASE_URL: apiBaseUrl,
      REPLIQA_API_KEY: apiKey,
    },
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}
