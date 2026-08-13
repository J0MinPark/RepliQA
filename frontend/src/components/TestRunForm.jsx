import React, { useEffect, useState } from 'react';
import { ArrowRight, AlertCircle } from 'lucide-react';
import { api } from '../lib/api';
import Select from './Select';

export default function TestRunForm({ verifiedUrls, personas, routes, onCreated }) {
  const [registeredUrlId, setRegisteredUrlId] = useState('');
  const [personaId, setPersonaId] = useState('');
  const [routeId, setRouteId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // 지금은 카오스 페르소나를 숨기고 표준 실행 하나만 노출 중이라, 목록이 1개면 굳이 고르게
  // 하지 않고 바로 선택해둔다 — 여러 개로 늘어나면(personas.length !== 1) 자동으로 다시 빈
  // 선택 상태로 돌아간다.
  useEffect(() => {
    if (personas.length === 1) setPersonaId(personas[0].id);
  }, [personas]);

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
          <Select value={registeredUrlId} onChange={handleUrlChange} required>
            <option value="">선택하세요</option>
            {verifiedUrls.map((u) => (
              <option key={u.id} value={u.id}>
                {u.url}
              </option>
            ))}
          </Select>
          {verifiedUrls.length === 0 && (
            <p className="text-xs text-amber-700 mt-2">위에서 URL을 먼저 등록해주세요.</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-bold text-slate-700 mb-2">시나리오 페르소나</label>
          <Select value={personaId} onChange={(e) => setPersonaId(e.target.value)} required>
            <option value="">선택하세요</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.description}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label className="block text-sm font-bold text-slate-700 mb-2">테스트 여정 (선택)</label>
          <Select value={routeId} onChange={(e) => setRouteId(e.target.value)} disabled={!registeredUrlId}>
            <option value="">자유 탐색 (여정 없이)</option>
            {routesForUrl.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.checkpoints.length}단계)
              </option>
            ))}
          </Select>
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full bg-brand-600 text-white font-bold py-4 rounded-xl hover:bg-brand-700 hover:shadow-lg hover:shadow-brand-500/30 transition-all flex justify-center items-center gap-2 group disabled:opacity-50 disabled:pointer-events-none focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2"
        >
          {submitting ? '배포 중...' : 'AI 에이전트 배포하기'}
          <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
        </button>
      </form>
    </div>
  );
}
