import React, { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import {
  AlertCircle,
  CheckCircle,
  Copy,
  Terminal,
  Activity,
  ChevronRight,
  Loader2,
  Bot,
  Layout,
} from 'lucide-react';
import { db, storage } from '../lib/firebase';

function StepScreenshot({ path }) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!path) return undefined;
    getDownloadURL(ref(storage, path))
      .then((u) => !cancelled && setUrl(u))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (!url) {
    return <div className="w-20 h-14 bg-slate-100 rounded-lg flex-shrink-0 animate-pulse" />;
  }
  return (
    <img src={url} alt="step screenshot" className="w-20 h-14 object-cover rounded-lg border border-slate-200 flex-shrink-0" />
  );
}

function StepTimeline({ steps }) {
  if (!steps || steps.length === 0) {
    return <p className="text-sm text-slate-400">아직 기록된 행동이 없습니다.</p>;
  }
  return (
    <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
      {steps.map((s) => (
        <div key={s.stepNumber} className="flex items-start gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3">
          <StepScreenshot path={s.screenshotPath} />
          <div className="min-w-0">
            <p className="text-xs font-bold text-slate-700">
              #{s.stepNumber} {s.action?.type} {!s.execOk && <span className="text-red-500">(실패)</span>}
            </p>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">{s.thought}</p>
            {s.execError && <p className="text-xs text-red-500 mt-1">{s.execError}</p>}
          </div>
        </div>
      ))}
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

  return (
    <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <div className="min-w-0 flex-1 w-full">
          <div className="flex items-center gap-2 mb-2">
            <span className="bg-slate-100 text-slate-600 text-xs font-bold px-2 py-1 rounded">
              {STATUS_LABEL[run.status] || run.status}
            </span>
            <span className="text-slate-400 text-sm">{run.personaName}</span>
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
        <div className="flex flex-col items-center justify-center py-16 space-y-6 bg-white rounded-3xl border border-slate-100">
          <div className="relative flex justify-center items-center">
            <div className="absolute w-20 h-20 rounded-full border-4 border-blue-100 animate-ping opacity-75"></div>
            <div className="absolute w-14 h-14 rounded-full border-4 border-blue-200 animate-spin border-t-blue-600"></div>
            <Bot className="text-blue-600 relative z-10" size={28} />
          </div>
          <p className="text-slate-600 font-semibold">
            {run.status === 'queued' ? '대기열에서 순서를 기다리는 중입니다...' : `${run.steps?.length || 0}번째 행동 실행 중...`}
          </p>
          <div className="w-full max-w-xl px-6">
            <StepTimeline steps={run.steps} />
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

            <div className="space-y-8">
              <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-slate-100">
                <h3 className="font-bold text-slate-900 mb-6 flex items-center gap-2 text-lg">
                  <Activity size={20} className="text-slate-400" /> 수집된 에러 로그 원본
                </h3>
                {run.collectedErrors && run.collectedErrors.length > 0 ? (
                  <div className="space-y-3 max-h-[250px] overflow-y-auto pr-2">
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

              <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-slate-100">
                <h3 className="font-bold text-slate-900 mb-6 flex items-center gap-2 text-lg">
                  <Layout size={20} className="text-slate-400" /> 행동 타임라인 (스크린샷)
                </h3>
                <StepTimeline steps={run.steps} />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
