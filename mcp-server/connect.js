#!/usr/bin/env node
// 원클릭에 가까운 Claude Code/Cursor 연동. 웹 대시보드는 브라우저 샌드박스 때문에 사용자
// 로컬 파일(.mcp.json)을 직접 못 쓴다 — 그래서 이 스크립트를 사용자가 자기 프로젝트
// 루트에서 한 번 실행하면, 손으로 JSON을 조립/경로를 바꿀 필요 없이 .mcp.json을 대신
// 써준다. "npm install && node connect.js --key=..." 한 줄이 지금 도달 가능한 최선의
// '딸깍'이다.
//
// 사용법: node connect.js --key=<대시보드에서 발급받은 API 키> [--api-url=http://localhost:3001]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

const apiKey = parseArg('key') || process.env.REPLIQA_API_KEY;
const apiBaseUrl = parseArg('api-url') || process.env.REPLIQA_API_BASE_URL || 'http://localhost:3001';

if (!apiKey) {
  console.error('사용법: node connect.js --key=<RepliQA 대시보드에서 발급받은 API 키> [--api-url=...]');
  process.exit(1);
}

const targetPath = path.join(process.cwd(), '.mcp.json');

let config = {};
if (fs.existsSync(targetPath)) {
  try {
    config = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
  } catch {
    console.error(`⚠️  ${targetPath}가 이미 있는데 올바른 JSON이 아니라 새로 만듭니다.`);
    config = {};
  }
}

config.mcpServers = config.mcpServers || {};
// 이미 다른 MCP 서버가 등록돼 있어도 그건 그대로 두고 repliqa 항목만 갱신한다(병합).
config.mcpServers.repliqa = {
  command: 'node',
  args: [path.join(__dirname, 'src', 'index.js')],
  env: {
    REPLIQA_API_BASE_URL: apiBaseUrl,
    REPLIQA_API_KEY: apiKey,
  },
};

fs.writeFileSync(targetPath, `${JSON.stringify(config, null, 2)}\n`);

console.log(`✅ ${targetPath} 에 RepliQA를 연결했습니다.`);
console.log('   Claude Code를 재시작(또는 새 세션 시작)하면 "RepliQA로 테스트해줘"라고 바로 말할 수 있습니다.');
