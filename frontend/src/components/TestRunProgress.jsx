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
  KeyRound,
  RefreshCw,
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
        className="w-full flex items-center justify-between p-6 sm:p-8 text-left focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-inset"
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
          <div className="space-y-6">
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
  running: <Loader2 size={16} className="text-brand-500 animate-spin" />,
  completed: <CheckCircle2 size={16} className="text-emerald-500" />,
  failed: <XCircle size={16} className="text-red-500" />,
};

function orderedCheckpoints(checkpointsMap) {
  return Object.entries(checkpointsMap || {})
    .map(([index, value]) => ({ index: Number(index), ...value }))
    .sort((a, b) => a.index - b.index);
}

// checkpoint.verify(결정론적 검증)가 설정된 경우에만 있는 값이다 — "AI가 목표를 달성했다"는
// 자기 판단과 실제 URL/텍스트/네트워크 상태가 일치했는지(both) 아니면 엔진이 결정론적 증거로
// 그 판단을 뒤집었는지(disagreement)를 보여준다. 후자가 특히 중요한 신호다 — AI가 틀렸다는
// 걸 우리가 직접 잡아냈다는 뜻이라서.
function VerifiedByBadge({ verifiedBy }) {
  if (verifiedBy === 'both') {
    return (
      <span className="flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700">
        <ShieldCheck size={11} /> 결정론적 검증 일치
      </span>
    );
  }
  if (verifiedBy === 'disagreement') {
    return (
      <span
        className="flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700"
        title="AI의 자체 판단과 실제 브라우저/네트워크 상태가 달랐습니다 — 결정론적 검증 결과를 우선 반영했습니다"
      >
        <ShieldCheck size={11} /> AI 판단 정정됨
      </span>
    );
  }
  if (verifiedBy === 'recovered') {
    return (
      <span
        className="flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-md bg-sky-50 text-sky-700"
        title="AI 판단과 일치했지만 페이지 반영에 시간이 걸려 재확인이 필요했습니다"
      >
        <RefreshCw size={11} /> 재확인 후 검증 통과
      </span>
    );
  }
  return null;
}

function CheckpointSection({ runId, checkpoint }) {
  return (
    <div className="border border-slate-100 rounded-2xl p-5 bg-white">
      <div className={`flex items-center gap-2 ${checkpoint.status === 'failed' && checkpoint.failureReason ? 'mb-1' : 'mb-4'}`}>
        {CHECKPOINT_STATUS_ICON[checkpoint.status] || CHECKPOINT_STATUS_ICON.pending}
        <h4 className="font-bold text-slate-900 text-sm flex-1">
          {checkpoint.goal ? checkpoint.goal : '자유 탐색'}
        </h4>
        <VerifiedByBadge verifiedBy={checkpoint.verifiedBy} />
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

// executor.js가 오프라인 시뮬레이션 중 발생한 에러 앞에 붙이는 태그와 동일한 문자열이다 —
// 백엔드 상수를 그대로 import할 수 없는 별도 프로젝트라 값만 맞춰서 복제해뒀다.
const EXPECTED_OFFLINE_TAG = '[예상됨: 오프라인 시뮬레이션] ';

// "에러가 1건이라도 있으면 무조건 빨간 배너"는 실제로 과장 표시로 이어졌다(외부 분석
// 스크립트 401, 오프라인 시뮬레이션 중 발생한 예상된 네트워크 에러 등도 전부 "크리티컬"로
// 뜸). generateReport가 문맥까지 판단해서 내리는 severity를 우선 쓰고, 값이 없는 과거
// 실행에 한해서만 개수 기반으로 폴백한다.
const RUN_SEVERITY_STYLE = {
  critical: {
    box: 'bg-red-50 border-red-100',
    iconBox: 'bg-red-100 text-red-600',
    title: 'text-red-900',
    body: 'text-red-700',
    Icon: AlertCircle,
    label: '크리티컬 이슈가 감지되었습니다',
  },
  warning: {
    box: 'bg-amber-50 border-amber-100',
    iconBox: 'bg-amber-100 text-amber-600',
    title: 'text-amber-900',
    body: 'text-amber-700',
    Icon: AlertCircle,
    label: '참고할 이슈가 있습니다',
  },
  pass: {
    box: 'bg-emerald-50 border-emerald-100',
    iconBox: 'bg-emerald-100 text-emerald-600',
    title: 'text-emerald-900',
    body: 'text-emerald-700',
    Icon: CheckCircle,
    label: '모든 테스트를 무사히 통과했습니다!',
  },
};

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
        <Loader2 className="animate-spin text-brand-600" size={28} />
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
              <span className="bg-brand-50 text-brand-700 text-xs font-bold px-2 py-1 rounded">{run.routeName}</span>
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
            <div className="absolute w-20 h-20 rounded-full border-4 border-brand-100 animate-ping opacity-75"></div>
            <div className="absolute w-14 h-14 rounded-full border-4 border-brand-200 animate-spin border-t-brand-600"></div>
            <Bot className="text-brand-600 relative z-10" size={28} />
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
          {run.sessionExpired && (
            <div className="p-6 rounded-2xl border bg-amber-50 border-amber-200 flex items-start gap-4">
              <KeyRound className="text-amber-600 flex-shrink-0" size={24} />
              <div>
                <h3 className="font-bold text-amber-900 mb-1">캡처된 로그인 세션이 만료된 것으로 보입니다</h3>
                <p className="text-amber-800 text-sm">
                  사이트 코드 문제가 아닙니다. 소셜 로그인(OAuth)은 자동화로 매번 다시 뚫을 수 없어서
                  캡처해둔 세션으로 시작하는데, 지금 세션이 만료·무효화된 것으로 확인됐습니다.{' '}
                  <code className="bg-white px-1.5 py-0.5 rounded border border-amber-200 text-xs">
                    scripts/capture-session.js
                  </code>
                  로 세션을 다시 캡처한 뒤 재실행해주세요.
                </p>
              </div>
            </div>
          )}

          {haltedCheckpoint && !run.sessionExpired && (
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

          {!run.sessionExpired && (() => {
            const severity = run.severity || (run.summary?.totalErrors > 0 ? 'critical' : 'pass');
            const style = RUN_SEVERITY_STYLE[severity] || RUN_SEVERITY_STYLE.pass;
            const expectedErrors = run.summary?.expectedErrors || 0;
            return (
              <div className={`p-8 rounded-3xl border ${style.box} shadow-sm relative overflow-hidden`}>
                <div className="flex items-start gap-5 relative z-10">
                  <div className={`p-3 rounded-full ${style.iconBox}`}>
                    <style.Icon size={32} />
                  </div>
                  <div>
                    <h3 className={`font-extrabold text-2xl mb-2 ${style.title}`}>{style.label}</h3>
                    {/* plainSummary는 "콘솔 에러", "네트워크 요청" 같은 기술 용어 없이 비개발자도
                        읽을 수 있게 LLM이 따로 생성한 문장이다 — 이걸 주 문구로 쓰고, 개발자용
                        수치는 아래 작은 글씨로 보조 정보로만 남긴다. 필드가 없는 과거 실행은
                        기존 개수 기반 문구로 폴백한다. */}
                    <p className={`text-lg ${style.body}`}>
                      {run.plainSummary || `총 ${run.summary?.totalActions || 0}개 행동 중 ${run.summary?.totalErrors || 0}개의 에러 로그가 수집되었습니다.`}
                    </p>
                    <p className={`text-xs mt-2 opacity-70 ${style.body}`}>
                      기술 세부: 총 {run.summary?.totalActions || 0}개 행동 중 에러 {run.summary?.totalErrors || 0}건
                      {expectedErrors > 0 && ` (별도로 예상된 시뮬레이션 에러 ${expectedErrors}건은 제외)`}
                    </p>
                  </div>
                </div>
              </div>
            );
          })()}

          <div className="space-y-8">
            {run.errorAnalysis && (
              <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6 sm:p-8">
                <h3 className="font-bold text-slate-900 mb-1 flex items-center gap-2 text-lg">
                  <Activity size={20} className="text-slate-400" /> 기술 분석
                  <span className="text-xs font-normal text-slate-400">(개발자용)</span>
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap mt-3">{run.errorAnalysis}</p>
              </div>
            )}

            <div className="bg-white rounded-3xl shadow-sm border border-slate-100 flex flex-col overflow-hidden">
              <div className="bg-slate-900 p-4 border-b border-slate-800 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Terminal size={18} className="text-brand-400" />
                  <h3 className="font-bold text-white tracking-wide">Vibe-Coding 프롬프트</h3>
                  <span className="text-[11px] font-normal text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full">개발자용 · 코딩 에이전트에 붙여넣기</span>
                </div>
                <button
                  onClick={copyToClipboard}
                  className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-2 rounded-lg flex items-center gap-1.5 font-semibold transition border border-slate-700"
                >
                  <Copy size={14} /> 바로 복사하기
                </button>
              </div>
              <div className="bg-[#0D1117] text-green-400 p-6 font-mono text-sm max-h-96 overflow-auto leading-relaxed whitespace-pre-wrap">
                {run.vibeCoderPrompt || '수집된 에러가 없어 생성된 프롬프트가 없습니다.'}
              </div>
            </div>

            <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-slate-100 max-h-[500px] overflow-y-auto">
              <h3 className="font-bold text-slate-900 mb-6 flex items-center gap-2 text-lg">
                <Activity size={20} className="text-slate-400" /> 수집된 에러 로그 원본
              </h3>
              {run.collectedErrors && run.collectedErrors.length > 0 ? (
                <div className="space-y-3">
                  {run.collectedErrors.map((err, idx) => {
                    const isExpected = err.startsWith(EXPECTED_OFFLINE_TAG);
                    const text = isExpected ? err.slice(EXPECTED_OFFLINE_TAG.length) : err;
                    return (
                      <div
                        key={idx}
                        className={`p-3 rounded-xl text-xs font-mono border flex items-start gap-2 ${
                          isExpected ? 'bg-slate-50 border-slate-200 text-slate-400' : 'bg-slate-50 border-slate-200 text-slate-700'
                        }`}
                      >
                        <ChevronRight size={14} className="text-slate-400 flex-shrink-0 mt-0.5" />
                        <span className="break-all leading-relaxed">
                          {isExpected && (
                            <span className="inline-block mr-1.5 px-1.5 py-0.5 rounded bg-slate-200 text-slate-500 text-[10px] font-bold align-middle not-italic">
                              예상됨
                            </span>
                          )}
                          {text}
                        </span>
                      </div>
                    );
                  })}
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
