import React, { useEffect, useState } from 'react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { History, Loader2, CheckCircle2, AlertCircle, XCircle, Clock } from 'lucide-react';
import { db } from '../lib/firebase';

const STATUS_LABEL = { queued: '대기 중', running: '실행 중', done: '완료', failed: '실패' };

// TestRunProgress.jsx의 RUN_SEVERITY_STYLE과 같은 값을 쓰지만, 여기서는 배지 하나 그릴
// 정도만 필요해서 별도 프로젝트 파일 간 공유 없이 색상만 다시 정의한다.
const SEVERITY_DOT = {
  critical: 'bg-red-500',
  warning: 'bg-amber-500',
  pass: 'bg-emerald-500',
};

function progressOf(checkpointsMap) {
  const values = Object.values(checkpointsMap || {});
  if (values.length === 0) return null;
  const resolved = values.filter((c) => c.status === 'completed' || c.status === 'failed').length;
  return { resolved, total: values.length };
}

function RunStatusIcon({ run }) {
  if (run.status === 'queued') return <Clock size={16} className="text-slate-400" />;
  if (run.status === 'running') return <Loader2 size={16} className="text-brand-500 animate-spin" />;
  if (run.status === 'failed') return <XCircle size={16} className="text-red-500" />;
  // status === 'done'
  const severity = run.severity || (run.summary?.totalErrors > 0 ? 'critical' : 'pass');
  if (severity === 'critical' || severity === 'warning') {
    return <AlertCircle size={16} className={severity === 'critical' ? 'text-red-500' : 'text-amber-500'} />;
  }
  return <CheckCircle2 size={16} className="text-emerald-500" />;
}

// 한 번에 여러 QA를 동시에 돌릴 수 있는데, 지금까지는 activeRunId 하나만 화면에 보여줘서
// 다른 실행 중인/끝난 런을 다시 찾아볼 방법이 없었다 — 최근 실행 내역을 실시간으로
// 나열해서 언제든 원하는 런의 진행 상황으로 들어갈 수 있게 한다.
export default function RunHistoryPanel({ tenantId, onSelect }) {
  const [runs, setRuns] = useState(null);

  useEffect(() => {
    if (!tenantId) return undefined;
    const q = query(
      collection(db, 'tenants', tenantId, 'testRuns'),
      orderBy('createdAt', 'desc'),
      limit(10)
    );
    const unsub = onSnapshot(q, (snap) => {
      setRuns(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [tenantId]);

  if (!runs || runs.length === 0) return null;

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6 sm:p-8">
      <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2 text-lg">
        <History size={20} className="text-slate-400" /> 최근 실행 내역
      </h3>
      <div className="space-y-1.5">
        {runs.map((run) => {
          const progress = run.status === 'running' ? progressOf(run.checkpoints) : null;
          return (
            <button
              key={run.id}
              type="button"
              onClick={() => onSelect(run.id)}
              className="w-full flex items-center gap-3 text-left px-3 py-2.5 rounded-xl hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-400"
            >
              <RunStatusIcon run={run} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-800 truncate">
                    {run.routeName || run.personaName || '자유 탐색'}
                  </span>
                  <span className="text-xs text-slate-400 flex-shrink-0">{STATUS_LABEL[run.status] || run.status}</span>
                </div>
                <p className="text-xs text-slate-400 truncate" title={run.targetUrl}>
                  {run.targetUrl}
                </p>
              </div>
              {progress && (
                <span className="text-xs font-semibold text-slate-500 flex-shrink-0 tabular-nums">
                  {progress.resolved}/{progress.total}단계
                </span>
              )}
              {run.status === 'done' && (
                <span
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    SEVERITY_DOT[run.severity || (run.summary?.totalErrors > 0 ? 'critical' : 'pass')]
                  }`}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
