import React, { useState } from 'react';
import { Terminal, Copy, Loader2 } from 'lucide-react';
import { api } from '../lib/api';

export default function ApiKeyPanel() {
  const [issuedKey, setIssuedKey] = useState(null);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState('');

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
    } catch (err) {
      setError(err.message);
    } finally {
      setIssuing(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6 sm:p-8">
      <h3 className="font-bold text-slate-900 mb-1 flex items-center gap-2 text-sm">
        <Terminal size={16} className="text-slate-400" /> Claude Code / Cursor 연동
      </h3>
      <p className="text-xs text-slate-500 mb-3">
        MCP 서버용 API 키를 발급하면, 코딩 에이전트가 직접 RepliQA 테스트를 실행하고 결과를 받아볼 수 있습니다.
      </p>

      {issuedKey && (
        <div className="mb-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
          <p className="text-xs font-bold text-amber-800 mb-1">
            지금 복사하세요 — 다시 조회할 수 없습니다.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-white px-2 py-1.5 rounded border border-amber-100 break-all">
              {issuedKey}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(issuedKey)}
              className="text-amber-700 hover:text-amber-900 flex-shrink-0 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-400"
              title="복사"
            >
              <Copy size={14} />
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

      <button
        onClick={handleIssue}
        disabled={issuing}
        className="text-xs bg-slate-900 text-white rounded-lg px-4 py-2.5 min-h-[44px] font-semibold disabled:opacity-60 flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
      >
        {issuing && <Loader2 size={12} className="animate-spin" />}
        {issuedKey ? 'API 키 재발급' : 'API 키 발급'}
      </button>
    </div>
  );
}
