import React, { useState } from 'react';
import { Terminal, Copy, Loader2, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '../lib/api';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

function mcpJsonSnippet(apiKey) {
  return `{
  "mcpServers": {
    "repliqa": {
      "command": "node",
      "args": ["mcp-server 폴더의 절대경로/src/index.js"],
      "env": {
        "REPLIQA_API_BASE_URL": "${API_BASE_URL}",
        "REPLIQA_API_KEY": "${apiKey || '여기에_발급받은_키'}"
      }
    }
  }
}`;
}

function guideMarkdown(apiKey) {
  return `## RepliQA를 Claude Code / Cursor에 연결하기

코드를 고친 뒤 코딩 에이전트에게 "RepliQA로 테스트해줘"라고 말하면, 에이전트가 직접 QA를
실행하고 발견된 에러·수정 방법을 그 자리에서 받아볼 수 있습니다.

### 1) mcp-server 폴더에서 설치
\`\`\`bash
cd mcp-server && npm install
\`\`\`

### 2) 설정 파일에 추가
Claude Code는 프로젝트 루트의 \`.mcp.json\`, Cursor는 \`.cursor/mcp.json\`:
\`\`\`json
${mcpJsonSnippet(apiKey)}
\`\`\`
(\`args\`의 경로는 mcp-server 폴더에서 실제 절대경로로 바꿔주세요)

### 3) 에이전트에게 이렇게 말하기
> "방금 수정한 로그인 페이지 RepliQA로 QA 돌리고 결과 알려줘. registeredUrlId는 \`xxxx\`야."

에이전트가 테스트를 실행하고 완료될 때까지 기다렸다가, 에러와 수정 지시문을 받아 그 자리에서
코드를 고칠 수 있습니다.
`;
}

export default function ApiKeyPanel() {
  const [issuedKey, setIssuedKey] = useState(null);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState('');
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedGuide, setCopiedGuide] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  const handleIssue = async () => {
    if (issuedKey) {
      const confirmed = window.confirm('재발급하면 이전 키는 즉시 무효화됩니다. 계속할까요?');
      if (!confirmed) return;
    }
    setError('');
    setIssuing(true);
    try {
      const result = await api.createApiKey();
      setIssuedKey(result.apiKey);
      setGuideOpen(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setIssuing(false);
    }
  };

  const copyKey = () => {
    navigator.clipboard.writeText(issuedKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const copyGuide = () => {
    navigator.clipboard.writeText(guideMarkdown(issuedKey));
    setCopiedGuide(true);
    setTimeout(() => setCopiedGuide(false), 2000);
  };

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6 sm:p-8">
      <h3 className="font-bold text-slate-900 mb-1 flex items-center gap-2 text-lg">
        <Terminal size={20} className="text-slate-400" /> Claude Code / Cursor 연동
      </h3>
      <p className="text-xs text-slate-500 mb-4 leading-relaxed">
        코드를 고친 뒤 코딩 에이전트에게 "RepliQA로 테스트해줘"라고 말하면, 에이전트가 직접 QA를
        실행하고 에러·수정 방법을 받아볼 수 있습니다. 아래에서 키를 발급받고 연결 방법 3단계만
        따라 하면 됩니다.
      </p>

      {issuedKey && (
        <div className="mb-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
          <p className="text-xs font-bold text-amber-800 mb-1">지금 복사하세요 — 다시 조회할 수 없습니다.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-white px-2 py-1.5 rounded border border-amber-100 break-all">
              {issuedKey}
            </code>
            <button
              onClick={copyKey}
              className="text-amber-700 hover:text-amber-900 flex-shrink-0 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-400"
              title="복사"
            >
              {copiedKey ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleIssue}
          disabled={issuing}
          className="text-xs bg-slate-900 text-white rounded-lg px-4 py-2.5 min-h-[44px] font-semibold disabled:opacity-60 flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
        >
          {issuing && <Loader2 size={12} className="animate-spin" />}
          {issuedKey ? 'API 키 재발급' : 'API 키 발급'}
        </button>
        <button
          onClick={() => setGuideOpen((v) => !v)}
          className="text-xs border border-slate-200 text-slate-700 rounded-lg px-4 py-2.5 min-h-[44px] font-semibold hover:bg-slate-50 flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
        >
          연결 방법 보기 {guideOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {guideOpen && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <div className="flex justify-between items-center mb-3">
            <p className="text-xs font-bold text-slate-700">연결 방법 (3단계)</p>
            <button
              onClick={copyGuide}
              className="text-xs text-slate-500 hover:text-brand-600 flex items-center gap-1 focus:outline-none focus:ring-2 focus:ring-brand-400 rounded px-1.5 py-1"
            >
              {copiedGuide ? <Check size={12} /> : <Copy size={12} />}
              {copiedGuide ? '복사됨' : '마크다운으로 복사'}
            </button>
          </div>
          <ol className="space-y-4 text-xs text-slate-600">
            <li>
              <p className="font-semibold text-slate-800 mb-1">1. mcp-server 폴더에서 설치</p>
              <pre className="bg-slate-900 text-slate-100 rounded-lg p-2.5 overflow-x-auto">cd mcp-server && npm install</pre>
            </li>
            <li>
              <p className="font-semibold text-slate-800 mb-1">
                2. Claude Code는 <code className="bg-slate-100 px-1 rounded">.mcp.json</code>, Cursor는{' '}
                <code className="bg-slate-100 px-1 rounded">.cursor/mcp.json</code>에 추가
              </p>
              <pre className="bg-slate-900 text-slate-100 rounded-lg p-2.5 overflow-x-auto text-[11px] leading-relaxed">
                {mcpJsonSnippet(issuedKey)}
              </pre>
              <p className="text-[11px] text-slate-400 mt-1">
                (args의 경로는 mcp-server 폴더의 실제 절대경로로 바꿔주세요)
              </p>
            </li>
            <li>
              <p className="font-semibold text-slate-800 mb-1">3. 에이전트에게 이렇게 말하기</p>
              <p className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 italic">
                "방금 수정한 로그인 페이지 RepliQA로 QA 돌리고 결과 알려줘."
              </p>
            </li>
          </ol>
        </div>
      )}
    </div>
  );
}
