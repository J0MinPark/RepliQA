import React, { useEffect, useState } from 'react';
import { Sparkles, Copy, Check, Loader2, FolderOpen, CheckCircle2, AlertCircle, Download } from 'lucide-react';
import { api } from '../lib/api';
import { buildMcpConfig } from '../lib/mcpConfig';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
const SERVER_RELATIVE_PATH = './.repliqa/mcp-server.mjs';

// Chrome/Edge 계열만 지원한다(Safari/Firefox는 아직 없음) — 있으면 "폴더 선택 한 번"으로 끝나고,
// 없으면 아래 대체 경로(파일 다운로드 + 명령어 복사)로 조용히 폴백한다.
const supportsFolderConnect = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

// 바이브코더에게는 "터미널에 명령어를 입력한다"는 행위 자체가 진입장벽이다 — 그래서
// 브라우저의 File System Access API(showDirectoryPicker)로, 사용자가 프로젝트 폴더를
// "선택"만 하면 그 자리에 .mcp.json과 MCP 서버 실행 파일을 웹사이트가 직접 써준다.
// mcp-server는 사전에 esbuild로 의존성까지 전부 포함해 파일 하나로 번들링해둔 것을
// (mcp-server/package.json의 build 스크립트가 frontend/public/repliqa-mcp.bundle.mjs로
// 복사해둠) 그대로 가져다 쓴다 — 그래서 사용자 쪽에서 npm install조차 필요 없다.
async function connectViaFolderPicker(apiKey) {
  const dirHandle = await window.showDirectoryPicker();

  const bundleRes = await fetch('/repliqa-mcp.bundle.mjs');
  if (!bundleRes.ok) throw new Error('MCP 서버 파일을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  const bundleText = await bundleRes.text();

  const repliqaDir = await dirHandle.getDirectoryHandle('.repliqa', { create: true });
  const bundleHandle = await repliqaDir.getFileHandle('mcp-server.mjs', { create: true });
  const bundleWritable = await bundleHandle.createWritable();
  await bundleWritable.write(bundleText);
  await bundleWritable.close();

  let existingConfigText = '';
  try {
    const existingHandle = await dirHandle.getFileHandle('.mcp.json');
    existingConfigText = await (await existingHandle.getFile()).text();
  } catch {
    // 기존 파일이 없으면 새로 만든다 — 정상 케이스.
  }
  const newConfigText = buildMcpConfig(existingConfigText, {
    apiKey,
    apiBaseUrl: API_BASE_URL,
    serverRelativePath: SERVER_RELATIVE_PATH,
  });
  const configHandle = await dirHandle.getFileHandle('.mcp.json', { create: true });
  const configWritable = await configHandle.createWritable();
  await configWritable.write(newConfigText);
  await configWritable.close();
}

function downloadBlob(filename, content, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ConnectStep({ onReset }) {
  const [apiKey, setApiKey] = useState(null);
  const [issuing, setIssuing] = useState(true);
  const [issueError, setIssueError] = useState('');
  const [copied, setCopied] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectStatus, setConnectStatus] = useState(null); // null | 'success' | 'error'
  const [connectError, setConnectError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .createApiKey()
      .then((result) => {
        if (!cancelled) setApiKey(result.apiKey);
      })
      .catch((err) => {
        if (!cancelled) setIssueError(err.message);
      })
      .finally(() => {
        if (!cancelled) setIssuing(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fallbackCommand = `cd mcp-server && npm install && node connect.js --key=${apiKey || '발급 중...'}`;

  const copyFallbackCommand = () => {
    navigator.clipboard.writeText(fallbackCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleFolderConnect = async () => {
    setConnecting(true);
    setConnectStatus(null);
    setConnectError('');
    try {
      await connectViaFolderPicker(apiKey);
      setConnectStatus('success');
    } catch (err) {
      if (err?.name !== 'AbortError') {
        // 사용자가 폴더 선택 창을 그냥 닫은 경우(AbortError)는 실패로 취급하지 않는다.
        setConnectStatus('error');
        setConnectError(err.message || '연결에 실패했습니다.');
      }
    } finally {
      setConnecting(false);
    }
  };

  const handleDownloadFallback = async () => {
    const bundleRes = await fetch('/repliqa-mcp.bundle.mjs');
    const bundleText = await bundleRes.text();
    downloadBlob('mcp-server.mjs', bundleText, 'text/javascript');
    const configText = buildMcpConfig('', { apiKey, apiBaseUrl: API_BASE_URL, serverRelativePath: SERVER_RELATIVE_PATH });
    downloadBlob('.mcp.json', configText, 'application/json');
  };

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
      <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6 sm:p-10 text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-brand-50 text-brand-600 mb-4">
          <Sparkles size={28} />
        </div>
        <h2 className="text-2xl font-extrabold text-slate-900 mb-2">Claude Code와 연결하기</h2>
        <p className="text-slate-500 text-sm max-w-md mx-auto leading-relaxed">
          연결하면 코드를 고칠 때마다 Claude Code에게 "RepliQA로 테스트해줘"라고 말하는 것만으로,
          직접 QA를 실행하고 결과를 그 자리에서 알려줍니다.
        </p>

        {issueError && <p className="text-xs text-red-600 mt-4">{issueError}</p>}

        {supportsFolderConnect ? (
          <div className="mt-8 max-w-md mx-auto">
            {connectStatus === 'success' ? (
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 flex items-start gap-3 text-left">
                <CheckCircle2 className="text-emerald-600 flex-shrink-0 mt-0.5" size={22} />
                <div>
                  <p className="font-bold text-emerald-900 text-sm">연결 완료!</p>
                  <p className="text-emerald-700 text-xs mt-1">
                    Claude Code를 재시작(또는 새 세션 시작)하면 바로 "RepliQA로 테스트해줘"라고 말할 수 있습니다.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <button
                  onClick={handleFolderConnect}
                  disabled={issuing || connecting}
                  className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2 transition"
                >
                  {issuing || connecting ? <Loader2 size={18} className="animate-spin" /> : <FolderOpen size={18} />}
                  {issuing ? '연결 준비 중...' : connecting ? '연결하는 중...' : '프로젝트 폴더 선택하고 연결하기'}
                </button>
                <p className="text-xs text-slate-400 mt-3">
                  버튼을 누르면 폴더 선택 창이 뜹니다 — Claude Code로 코딩하는 프로젝트 폴더를
                  골라주세요. 명령어를 입력하거나 파일을 직접 편집할 필요는 없습니다.
                </p>
                {connectStatus === 'error' && (
                  <p className="text-xs text-red-600 mt-3 flex items-center justify-center gap-1">
                    <AlertCircle size={13} /> {connectError}
                  </p>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="mt-8 text-left max-w-xl mx-auto">
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4">
              지금 쓰시는 브라우저는 폴더 자동 연결을 지원하지 않습니다(Chrome/Edge에서 가능). 아래
              방법 중 하나로 진행해주세요.
            </p>
            <div className="bg-white border border-slate-200 rounded-2xl p-4 mb-4">
              <p className="text-sm font-bold text-slate-800 mb-2">방법 1 — 파일 두 개 받아서 옮기기(명령어 없음)</p>
              <button
                onClick={handleDownloadFallback}
                disabled={issuing}
                className="text-xs bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white rounded-lg px-4 py-2.5 flex items-center gap-1.5 font-semibold"
              >
                <Download size={14} /> 연결 파일 2개 다운로드
              </button>
              <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                다운로드된 <code className="bg-slate-100 px-1 rounded">.mcp.json</code>은 프로젝트
                폴더 최상위에, <code className="bg-slate-100 px-1 rounded">mcp-server.mjs</code>는 그
                폴더 안에 <code className="bg-slate-100 px-1 rounded">.repliqa</code>라는 새 폴더를
                만들어 그 안에 넣어주세요.
              </p>
              <p className="text-xs text-amber-600 mt-2 leading-relaxed">
                ⚠ 브라우저에 따라 파일 이름 앞의 점(.)이 지워진 채{' '}
                <code className="bg-amber-50 px-1 rounded">mcp.json</code>으로 저장되기도 합니다 —
                그런 경우 파일 이름을 <code className="bg-amber-50 px-1 rounded">.mcp.json</code>으로
                바꿔주세요.
              </p>
            </div>
            <div className="bg-slate-900 rounded-2xl p-4 flex items-center gap-3">
              <p className="text-xs text-slate-400 flex-shrink-0">방법 2 — 터미널에 익숙하다면</p>
              <code className="flex-1 text-emerald-400 text-xs font-mono break-all">{fallbackCommand}</code>
              <button
                onClick={copyFallbackCommand}
                disabled={!apiKey}
                className="flex-shrink-0 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg px-3 py-2 flex items-center gap-1.5 text-xs font-semibold disabled:opacity-50"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          </div>
        )}
      </div>

      <button
        onClick={onReset}
        className="w-full bg-white border border-slate-200 hover:bg-slate-50 transition text-slate-700 font-bold py-3 rounded-xl text-sm"
      >
        + 새로운 테스트 시작
      </button>
    </div>
  );
}
