import React, { useState } from 'react';
import { Route, ListChecks, ChevronDown, CreditCard, Clock } from 'lucide-react';
import { api } from '../lib/api';
import Select from './Select';

const CHECKPOINT_TYPE_BADGE = {
  payment: { label: '결제', icon: CreditCard, className: 'bg-amber-50 text-amber-700' },
  long_running: { label: '장시간', icon: Clock, className: 'bg-sky-50 text-sky-700' },
};

export default function RouteBuilder({ verifiedUrls, routes, onRefresh }) {
  const [name, setName] = useState('');
  const [registeredUrlId, setRegisteredUrlId] = useState('');
  const [checkpointsText, setCheckpointsText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const checkpoints = checkpointsText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (checkpoints.length === 0) {
      setError('체크포인트를 한 줄에 하나씩 입력하세요.');
      return;
    }
    setSubmitting(true);
    try {
      await api.createRoute(name, registeredUrlId, checkpoints);
      setName('');
      setRegisteredUrlId('');
      setCheckpointsText('');
      onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6 sm:p-8">
      <h3 className="font-bold text-slate-900 mb-1 flex items-center gap-2 text-lg">
        <Route size={20} className="text-slate-400" /> 테스트 여정 (선택)
      </h3>
      <p className="text-xs text-slate-500 mb-4">
        확인하고 싶은 단계를 순서대로 한 줄씩 입력하세요. 비워두면 자유 탐색으로 실행됩니다.
      </p>

      {verifiedUrls.length === 0 ? (
        <p className="text-sm text-slate-500">먼저 URL을 등록하면 여정을 만들 수 있습니다.</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3 mb-6">
          <input
            type="text"
            required
            placeholder="여정 이름 (예: 회원가입 → 결제)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 outline-none focus:ring-2 focus:ring-brand-500 text-sm"
          />
          <Select required value={registeredUrlId} onChange={(e) => setRegisteredUrlId(e.target.value)}>
            <option value="">대상 URL 선택</option>
            {verifiedUrls.map((u) => (
              <option key={u.id} value={u.id}>
                {u.url}
              </option>
            ))}
          </Select>
          <textarea
            required
            rows={4}
            placeholder={
              '한 줄에 체크포인트 하나씩 입력하세요. 예:\n로그인 페이지에서 로그인 완료\n상품 목록에서 아무 상품이나 상세 페이지로 이동\n장바구니에 담고 수량을 변경'
            }
            value={checkpointsText}
            onChange={(e) => setCheckpointsText(e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 outline-none focus:ring-2 focus:ring-brand-500 text-sm font-mono"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-slate-900 text-white text-sm font-bold py-3 rounded-xl hover:bg-slate-800 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
          >
            {submitting ? '저장 중...' : '여정 저장'}
          </button>
        </form>
      )}

      {routes.length > 0 && (
        <div className="border-t border-slate-100 pt-4 space-y-1">
          {routes.map((r) => {
            const isOpen = expandedId === r.id;
            return (
              <div key={r.id}>
                <button
                  type="button"
                  onClick={() => setExpandedId(isOpen ? null : r.id)}
                  className="w-full flex items-center gap-2 text-sm text-slate-700 py-1.5 rounded-lg hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-400"
                >
                  <ListChecks size={14} className="text-slate-400 flex-shrink-0" />
                  <span className="font-semibold">{r.name}</span>
                  <span className="text-slate-400 text-xs">({r.checkpoints.length}단계)</span>
                  <ChevronDown
                    size={14}
                    className={`ml-auto text-slate-400 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {isOpen && (
                  <ol className="ml-6 mb-2 space-y-1.5 border-l border-slate-100 pl-4">
                    {r.checkpoints.map((c, idx) => {
                      const badge = CHECKPOINT_TYPE_BADGE[c.type];
                      return (
                        <li key={idx} className="text-sm text-slate-600 flex items-start gap-2">
                          <span className="text-slate-400 text-xs mt-0.5">{idx + 1}.</span>
                          <span className="flex-1">{c.goal}</span>
                          {badge && (
                            <span
                              className={`flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-md flex-shrink-0 ${badge.className}`}
                            >
                              <badge.icon size={11} />
                              {badge.label}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
