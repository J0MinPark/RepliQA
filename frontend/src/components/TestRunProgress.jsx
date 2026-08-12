import React, { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  AlertCircle,
  CheckCircle,
  Copy,
  Terminal,
  Activity,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Loader2,
  Bot,
  Eye,
  CircleDot,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  Network,
} from 'lucide-react';
import { db } from '../lib/firebase';
import { api } from '../lib/api';

// screenshotPath는 저장소 안 전체 경로(tenants/.../checkpoint-0-step-1.jpg)라, 백엔드가
// 소유권을 확인해줄 수 있게 파일명(label)만 뽑아서 넘긴다 — 실제 서명 URL 발급은 백엔드가 한다
// (저장소가 Firebase든 Supabase든 프론트는 몰라도 됨).
function labelFromPath(path) {
  return path?.split('/').pop()?.replace(/\.jpg$/, '');
}

function StepScreenshot({ runId, path }) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const label = labelFromPath(path);
    if (!label) return undefined;
    api
      .getScreenshotUrl(runId, label)
      .then(({ url: u }) => !cancelled && setUrl(u))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [runId, path]);

  if (!url) {
    return <div className="w-20 h-14 bg-slate-100 rounded-lg flex-shrink-0 animate-pulse" />;
  }
  return (
    <img src={url} alt="step screenshot" className="w-20 h-14 object-cover rounded-lg border border-slate-200 flex-shrink-0" />
  );
}

function StepTimeline({ runId, steps }) {
  if (!steps || steps.length === 0) {
    return <p className="text-sm text-slate-400">아직 기록된 행동이 없습니다.</p>;
  }
  return (
    <div className="space-y-3">
      {steps.map((s) =>
        s.action?.type === 'safety_stop' ? (
          <div
            key={s.stepNumber}
            className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3"
          >
            <ShieldCheck size={20} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-bold text-amber-800">#{s.stepNumber} 결제 최종 제출 생략 (안전핀)</p>
              <p className="text-xs text-amber-700 mt-1 leading-relaxed">{s.thought}</p>
            </div>
          </div>
        ) : (
          <div key={s.stepNumber} className="flex items-start gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3">
            <StepScreenshot runId={runId} path={s.screenshotPath} />
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-700">
                #{s.stepNumber} {s.action?.type} {!s.execOk && <span className="text-red-500">(실패)</span>}
              </p>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">{s.thought}</p>
              {s.execError && <p className="text-xs text-red-500 mt-1">{s.execError}</p>}
            </div>
          </div>
        )
      )}
    </div>
  );
}

const SEVERITY_STYLE = {
  warning: 'bg-amber-50 border-amber-200 text-amber-800',
  info: 'bg-slate-50 border-slate-200 text-slate-600',
};

function UiuxFindings({ findings }) {
  if (!findings || findings.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
        <Eye size={13} /> UI/UX 검토 필요 ({findings.length})
      </p>
      {findings.map((f, idx) => (
        <div
          key={idx}
          className={`text-xs border rounded-lg px-3 py-2 ${SEVERITY_STYLE[f.severity] || SEVERITY_STYLE.info}`}
        >
          <span className="font-semibold">[{f.category}]</span> {f.detail || f.description}
        </div>
      ))}
    </div>
  );
}

// 에러가 아닌 것도 포함한 전체 네트워크/콘솔 기록 — "200은 떨어졌는데 데이터가 이상한"
// 것처럼 겉으론 정상인 버그를 사람이 직접 훑어볼 수 있게 원본을 그대로 보여준다. 기본은
// 접어둔다(디버그용 원본이라 항상 볼 필요는 없음).
function NetworkAndConsolePanel({ networkCalls, consoleLogs, downloads }) {
  const [open, setOpen] = useState(false);
  const hasData = (networkCalls?.length || 0) > 0 || (consoleLogs?.length || 0) > 0 || (downloads?.length || 0) > 0;
  if (!hasData) return null;

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between p-6 sm:p-8 text-left focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-inset"
      >
        <h3 className="font-bold text-slate-900 flex items-center gap-2 text-lg">
          <Network size={20} className="text-slate-400" /> 네트워크 호출 · 콘솔 로그
          <span className="text-xs font-normal text-slate-400">
            ({networkCalls?.length || 0}건 / {consoleLogs?.length || 0}건{downloads?.length ? ` / 다운로드 ${downloads.length}건` : ''})
          </span>
        </h3>
        {open ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
      </button>
      {open && (
        <div className="px-6 sm:px-8 pb-6 sm:pb-8 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <p className="text-xs font-bold text-slate-500 mb-2">네트워크 호출(XHR/fetch)</p>
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {(networkCalls || []).map((c, idx) => (
                  <div
                    key={idx}
                    className={`text-xs font-mono p-2 rounded-lg border ${
                      c.status >= 400 ? 'bg-red-50 border-red-100 text-red-700' : 'bg-slate-50 border-slate-200 text-slate-600'
                    }`}
                  >
                    <span className="font-bold">{c.status}</span> {c.method} <span className="break-all">{c.url}</span>
                  </div>
                ))}
                {(!networkCalls || networkCalls.length === 0) && <p className="text-xs text-slate-400">기록 없음</p>}
              </div>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-500 mb-2">콘솔 로그</p>
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {(consoleLogs || []).map((c, idx) => (
                  <div
                    key={idx}
                    className={`text-xs font-mono p-2 rounded-lg border ${
                      c.type === 'error' ? 'bg-red-50 border-red-100 text-red-700' : 'bg-slate-50 border-slate-200 text-slate-600'
                    }`}
                  >
                    <span className="font-bold">[{c.type}]</span> <span className="break-all">{c.text}</span>
                  </div>
                ))}
                {(!consoleLogs || consoleLogs.length === 0) && <p className="text-xs text-slate-400">기록 없음</p>}
              </div>
            </div>
          </div>
          {downloads?.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-500 mb-2">
                다운로드 (내용 일치는 확인 못함 — 파일이 정상적으로 만들어졌는지만 확인)
              </p>
              <div className="space-y-1.5">
                {downloads.map((d, idx) => (
                  <div key={idx} className="text-xs font-mono p-2 rounded-lg border bg-slate-50 border-slate-200 text-slate-600">
                    {d.filename} — {(d.sizeBytes / 1024).toFixed(1)}KB — sha256:{d.sha256.slice(0, 12)}...
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const CHECKPOINT_STATUS_ICON = {
  pending: <CircleDot size={16} className="text-slate-300" />,
  running: <Loader2 size={16} className="text-blue-500 animate-spin" />,
  completed: <CheckCircle2 size={16} className="text-emerald-500" />,
  failed: <XCircle size={16} className="text-red-500" />,
};

function orderedCheckpoints(checkpointsMap) {
  return Object.entries(checkpointsMap || {})
    .map(([index, value]) => ({ index: Number(index), ...value }))
    .sort((a, b) => a.index - b.index);
}

function CheckpointSection({ runId, checkpoint }) {
  return (
    <div className="border border-slate-100 rounded-2xl p-5 bg-white">
      <div className={`flex items-center gap-2 ${checkpoint.status === 'failed' && checkpoint.failureReason ? 'mb-1' : 'mb-4'}`}>
        {CHECKPOINT_STATUS_ICON[checkpoint.status] || CHECKPOINT_STATUS_ICON.pending}
        <h4 className="font-bold text-slate-900 text-sm">
          {checkpoint.goal ? checkpoint.goal : '자유 탐색'}
        </h4>
      </div>
      {checkpoint.status === 'failed' && checkpoint.failureReason && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-4 ml-6">
          {checkpoint.failureReason}
        </p>
      )}
      {checkpoint.uiuxFindings?.length > 0 && (
        <div className="mb-4">
          <UiuxFindings findings={checkpoint.uiuxFindings} />
        </div>
      )}
      <StepTimeline runId={runId} steps={checkpoint.steps} />
    </div>
  );
}

const STATUS_LABEL = { queued: '대기 중', running: '실행 중', done: '완료', failed: '실패' };

export default function TestRunProgress({ tenantId, runId, onReset }) {
  const [run, setRun] = useState(null);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'tenants', tenantId, 'testRuns', runId), (snap) => {
      if (snap.exists()) setRun({ id: snap.id, ...snap.data() });
    });
    return unsub;
  }, [tenantId, runId]);

  const copyToClipboard = () => {
    if (run?.vibeCoderPrompt) {
      navigator.clipboard.writeText(run.vibeCoderPrompt);
      alert('프롬프트가 클립보드에 복사되었습니다!');
    }
  };

  if (!run) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="animate-spin text-blue-600" size={28} />
      </div>
    );
  }

  const inProgress = run.status === 'queued' || run.status === 'running';
  const checkpoints = orderedCheckpoints(run.checkpoints);
  const haltedCheckpoint =
    run.haltedAtCheckpoint != null ? checkpoints.find((c) => c.index === run.haltedAtCheckpoint) : null;

  return (
    <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <div className="min-w-0 flex-1 w-full">
          <div className="flex items-center gap-2 mb-2">
            <span className="bg-slate-100 text-slate-600 text-xs font-bold px-2 py-1 rounded">
              {STATUS_LABEL[run.status] || run.status}
            </span>
            <span className="text-slate-400 text-sm">{run.personaName}</span>
            {run.routeName && (
              <span className="bg-blue-50 text-blue-700 text-xs font-bold px-2 py-1 rounded">{run.routeName}</span>
            )}
          </div>
          <h2 className="text-2xl font-extrabold text-slate-900">시뮬레이션 결과 리포트</h2>
          <p className="text-slate-500 text-sm mt-2 truncate w-full" title={run.targetUrl}>
            <span className="font-semibold text-slate-700">Target:</span> {run.targetUrl}
          </p>
        </div>
        <button
          onClick={onReset}
          className="flex-shrink-0 w-full sm:w-auto bg-slate-900 text-white hover:bg-slate-800 transition px-6 py-3 rounded-xl font-bold text-sm shadow-md"
        >
          + 새로운 테스트 시작
        </button>
      </div>

      {inProgress && (
        <div className="flex flex-col items-center py-12 space-y-6 bg-white rounded-3xl border border-slate-100">
          <div className="relative flex justify-center items-center">
            <div className="absolute w-20 h-20 rounded-full border-4 border-blue-100 animate-ping opacity-75"></div>
            <div className="absolute w-14 h-14 rounded-full border-4 border-blue-200 animate-spin border-t-blue-600"></div>
            <Bot className="text-blue-600 relative z-10" size={28} />
          </div>
          <p className="text-slate-600 font-semibold">
            {run.status === 'queued' ? '대기열에서 순서를 기다리는 중입니다...' : '여정을 따라 테스트를 진행하고 있습니다...'}
          </p>
          <div className="w-full max-w-2xl px-6 space-y-4">
            {checkpoints.map((c) => (
              <CheckpointSection key={c.index} runId={runId} checkpoint={c} />
            ))}
          </div>
        </div>
      )}

      {run.status === 'failed' && (
        <div className="p-8 rounded-3xl border bg-red-50 border-red-100">
          <div className="flex items-start gap-4">
            <AlertCircle className="text-red-600" size={28} />
            <div>
              <h3 className="font-extrabold text-xl text-red-900 mb-1">테스트 실행에 실패했습니다</h3>
              <p className="text-red-700 text-sm">{run.error}</p>
            </div>
          </div>
        </div>
      )}

      {run.status === 'done' && (
        <>
          {haltedCheckpoint && (
            <div className="p-6 rounded-2xl border bg-orange-50 border-orange-200 flex items-start gap-4">
              <XCircle className="text-orange-600 flex-shrink-0" size={24} />
              <div>
                <h3 className="font-bold text-orange-900 mb-1">여정이 중간에 막혔습니다</h3>
                <p className="text-orange-700 text-sm">
                  "{haltedCheckpoint.goal}" 단계를 정해진 행동 수 안에 완료하지 못해 이후 단계는 실행되지 않았습니다.
                </p>
              </div>
            </div>
          )}

          <div
            className={`p-8 rounded-3xl border ${
              run.summary?.totalErrors > 0 ? 'bg-red-50 border-red-100' : 'bg-emerald-50 border-emerald-100'
            } shadow-sm relative overflow-hidden`}
          >
            <div className="flex items-start gap-5 relative z-10">
              <div
                className={`p-3 rounded-full ${
                  run.summary?.totalErrors > 0 ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600'
                }`}
              >
                {run.summary?.totalErrors > 0 ? <AlertCircle size={32} /> : <CheckCircle size={32} />}
              </div>
              <div>
                <h3
                  className={`font-extrabold text-2xl mb-2 ${
                    run.summary?.totalErrors > 0 ? 'text-red-900' : 'text-emerald-900'
                  }`}
                >
                  {run.summary?.totalErrors > 0 ? '크리티컬 이슈가 감지되었습니다' : '모든 테스트를 무사히 통과했습니다!'}
                </h3>
                <p className={`text-lg ${run.summary?.totalErrors > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                  총 {run.summary?.totalActions || 0}개 행동 중 <strong>{run.summary?.totalErrors || 0}개</strong>의 에러 로그가
                  수집되었습니다.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-white rounded-3xl shadow-sm border border-slate-100 flex flex-col overflow-hidden">
              <div className="bg-slate-900 p-4 border-b border-slate-800 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Terminal size={18} className="text-blue-400" />
                  <h3 className="font-bold text-white tracking-wide">Vibe-Coding 프롬프트</h3>
                </div>
                <button
                  onClick={copyToClipboard}
                  className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-2 rounded-lg flex items-center gap-1.5 font-semibold transition border border-slate-700"
                >
                  <Copy size={14} /> 바로 복사하기
                </button>
              </div>
              <div className="bg-[#0D1117] text-green-400 p-6 font-mono text-sm flex-grow overflow-auto leading-relaxed whitespace-pre-wrap">
                {run.vibeCoderPrompt || '수집된 에러가 없어 생성된 프롬프트가 없습니다.'}
              </div>
            </div>

            <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-slate-100 max-h-[500px] overflow-y-auto">
              <h3 className="font-bold text-slate-900 mb-6 flex items-center gap-2 text-lg">
                <Activity size={20} className="text-slate-400" /> 수집된 에러 로그 원본
              </h3>
              {run.collectedErrors && run.collectedErrors.length > 0 ? (
                <div className="space-y-3">
                  {run.collectedErrors.map((err, idx) => (
                    <div
                      key={idx}
                      className="bg-slate-50 p-3 rounded-xl text-xs font-mono text-slate-700 border border-slate-200 flex items-start gap-2"
                    >
                      <ChevronRight size={14} className="text-slate-400 flex-shrink-0 mt-0.5" />
                      <span className="break-all leading-relaxed">{err}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-slate-500 text-sm">수집된 로그가 없습니다.</p>
              )}
            </div>
          </div>

          <NetworkAndConsolePanel networkCalls={run.networkCalls} consoleLogs={run.consoleLogs} downloads={run.downloads} />

          <div>
            <h3 className="font-bold text-slate-900 mb-4 text-lg">여정 단계별 상세 리포트</h3>
            <div className="space-y-4">
              {checkpoints.map((c) => (
                <CheckpointSection key={c.index} runId={runId} checkpoint={c} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
