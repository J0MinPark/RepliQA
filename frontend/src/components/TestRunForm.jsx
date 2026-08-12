import React, { useState } from 'react';
import { ArrowRight, AlertCircle } from 'lucide-react';
import { api } from '../lib/api';

export default function TestRunForm({ verifiedUrls, personas, routes, onCreated }) {
  const [registeredUrlId, setRegisteredUrlId] = useState('');
  const [personaId, setPersonaId] = useState('');
  const [routeId, setRouteId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const canSubmit = registeredUrlId && personaId && !submitting;
  const routesForUrl = routes.filter((r) => r.registeredUrlId === registeredUrlId);

  const handleUrlChange = (e) => {
    setRegisteredUrlId(e.target.value);
    setRouteId(''); // URL이 바뀌면 이전에 고른 여정은 더 이상 유효하지 않을 수 있음
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const { id } = await api.createTestRun(registeredUrlId, personaId, routeId || undefined);
      onCreated(id);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white p-6 sm:p-10 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-slate-900">새 QA 테스트 시작</h2>
        <p className="text-slate-500 mt-2">검증된 URL과 AI 페르소나를 선택하고 에이전트를 배포하세요.</p>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 p-4 rounded-xl flex items-start gap-3">
          <AlertCircle className="text-red-500 mt-0.5" size={20} />
          <p className="text-red-700 text-sm font-medium">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-bold text-slate-700 mb-2">타겟 URL (검증됨)</label>
          <select
            value={registeredUrlId}
            onChange={handleUrlChange}
            className="w-full border border-slate-200 rounded-xl p-4 bg-slate-50 outline-none focus:ring-2 focus:ring-blue-500 text-sm text-slate-900"
            required
          >
            <option value="">선택하세요</option>
            {verifiedUrls.map((u) => (
              <option key={u.id} value={u.id}>
                {u.url}
              </option>
            ))}
          </select>
          {verifiedUrls.length === 0 && (
            <p className="text-xs text-amber-700 mt-2">
              왼쪽에서 URL을 먼저 등록하고 검증해주세요.
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-bold text-slate-700 mb-2">시나리오 페르소나</label>
          <select
            value={personaId}
            onChange={(e) => setPersonaId(e.target.value)}
            className="w-full border border-slate-200 rounded-xl p-4 bg-slate-50 outline-none focus:ring-2 focus:ring-blue-500 text-sm text-slate-900"
            required
          >
            <option value="">선택하세요</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.description}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-bold text-slate-700 mb-2">테스트 여정 (선택)</label>
          <select
            value={routeId}
            onChange={(e) => setRouteId(e.target.value)}
            disabled={!registeredUrlId}
            className="w-full border border-slate-200 rounded-xl p-4 bg-slate-50 outline-none focus:ring-2 focus:ring-blue-500 text-sm text-slate-900 disabled:opacity-50"
          >
            <option value="">자유 탐색 (여정 없이)</option>
            {routesForUrl.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.checkpoints.length}단계)
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full bg-blue-600 text-white font-bold py-4 rounded-xl hover:bg-blue-700 hover:shadow-lg hover:shadow-blue-500/30 transition-all flex justify-center items-center gap-2 group disabled:opacity-50 disabled:pointer-events-none focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
        >
          {submitting ? '배포 중...' : 'AI 에이전트 배포하기'}
          <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
        </button>
      </form>
    </div>
  );
}
