import React, { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  AlertCircle,
  CheckCircle,
  Loader2,
  Bot,
  Eye,
  CircleDot,
  CheckCircle2,
  XCircle,
  ShieldCheck,
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

export default function TestRunProgress({ tenantId, runId, onReset, onGoToConnect }) {
  const [run, setRun] = useState(null);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'tenants', tenantId, 'testRuns', runId), (snap) => {
      if (snap.exists()) setRun({ id: snap.id, ...snap.data() });
    });
    return unsub;
  }, [tenantId, runId]);

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

          {(run.severity || (run.summary?.totalErrors > 0 ? 'critical' : 'pass')) !== 'pass' && (
            <div className="bg-slate-900 rounded-3xl p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h3 className="font-bold text-white text-lg mb-1">발견된 문제, 바로 고쳐볼까요?</h3>
                <p className="text-slate-400 text-sm">
                  Claude Code와 연결하면 방금 찾은 문제를 코드에서 바로 수정할 수 있습니다.
                </p>
              </div>
              <button
                onClick={onGoToConnect}
                className="flex-shrink-0 w-full sm:w-auto bg-brand-600 hover:bg-brand-700 text-white font-bold px-6 py-3 rounded-xl transition"
              >
                Claude Code로 고치기
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
