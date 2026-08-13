import React from 'react';
import { Gauge } from 'lucide-react';

export default function UsagePanel({ usage, quota }) {
  if (!usage || !quota) return null;

  const runsPct = Math.min(100, Math.round(((usage.runsCount || 0) / quota.maxRunsPerDay) * 100));

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6 sm:p-8">
      <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2 text-lg">
        <Gauge size={20} className="text-slate-400" /> 오늘 사용량
      </h3>
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-slate-500">
          <span>실행 횟수</span>
          <span>
            {usage.runsCount || 0} / {quota.maxRunsPerDay}
          </span>
        </div>
        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full bg-brand-600 rounded-full" style={{ width: `${runsPct}%` }} />
        </div>
      </div>
      <p className="text-xs text-slate-500 mt-3">동시 실행 한도: {quota.maxConcurrent}건 · 실행당 최대 행동: {quota.maxActionsPerRun}회</p>
    </div>
  );
}
