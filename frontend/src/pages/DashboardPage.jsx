import React, { useCallback, useEffect, useState } from 'react';
import { Activity, Bot, Zap, ShieldCheck, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import UrlRegistrationPanel from '../components/UrlRegistrationPanel';
import TestRunForm from '../components/TestRunForm';
import TestRunProgress from '../components/TestRunProgress';
import UsagePanel from '../components/UsagePanel';

export default function DashboardPage() {
  const { user, tenantId, logout } = useAuth();
  const [urls, setUrls] = useState([]);
  const [personas, setPersonas] = useState([]);
  const [usageInfo, setUsageInfo] = useState(null);
  const [activeRunId, setActiveRunId] = useState(null);

  const refreshUrls = useCallback(async () => {
    const data = await api.listUrls();
    setUrls(data);
  }, []);

  const refreshUsage = useCallback(async () => {
    const data = await api.getUsageToday();
    setUsageInfo(data);
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 로그인 직후 1회성 초기 데이터 로드
    refreshUrls();
    refreshUsage();
    api.listPersonas().then(setPersonas);
  }, [tenantId, refreshUrls, refreshUsage]);

  const handleReset = () => {
    setActiveRunId(null);
    refreshUsage();
  };

  const verifiedUrls = urls.filter((u) => u.verified);

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-800 font-sans selection:bg-blue-100 selection:text-blue-900 break-keep">
      <header className="bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2 cursor-pointer" onClick={handleReset}>
            <div className="bg-blue-600 p-1.5 rounded-lg">
              <Activity className="text-white" size={20} />
            </div>
            <span className="text-xl font-extrabold tracking-tight text-slate-900">
              RepliQA{' '}
              <span className="text-[10px] uppercase font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-full ml-1 align-middle">
                Beta
              </span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm text-slate-600 bg-slate-100 px-4 py-2 rounded-full font-medium">
              <div className="w-2 h-2 rounded-full bg-green-500"></div>
              {user?.email}
            </div>
            <button
              onClick={logout}
              className="text-slate-500 hover:text-red-600 p-2 rounded-full hover:bg-red-50 transition"
              title="로그아웃"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8 mt-4 sm:mt-8">
        {activeRunId ? (
          <TestRunProgress tenantId={tenantId} runId={activeRunId} onReset={handleReset} />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 animate-in fade-in duration-500">
            <div className="lg:col-span-5 flex flex-col justify-center space-y-6">
              <div>
                <h1 className="text-3xl sm:text-[40px] font-extrabold text-slate-900 leading-tight tracking-tight mb-4">
                  코드 수정까지 <br />
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">
                    단 한 번의 클릭
                  </span>
                  으로.
                </h1>
                <p className="text-sm text-slate-600 leading-relaxed">
                  RepliQA는 비전 AI 페르소나를 활용해 실제 유저의 돌발 행동을 시뮬레이션하고, 발견된 버그를 즉시 해결할
                  수 있는 Vibe-Coding 프롬프트를 생성합니다.
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-start gap-4 p-4 rounded-2xl bg-white border border-slate-100 shadow-sm">
                  <div className="bg-blue-50 p-2 rounded-lg">
                    <Bot className="text-blue-600" size={24} />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900">Vision 기반 다중 페르소나</h3>
                    <p className="text-sm text-slate-500 mt-1">
                      스크린샷+좌표 기반으로 화면을 인지해, 프레임워크에 상관없이 엣지 케이스를 재현합니다.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-4 p-4 rounded-2xl bg-white border border-slate-100 shadow-sm">
                  <div className="bg-amber-50 p-2 rounded-lg">
                    <Zap className="text-amber-500" size={24} />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900">Zero-to-Fix 파이프라인</h3>
                    <p className="text-sm text-slate-500 mt-1">에러 발견 즉시 Cursor 등에서 사용 가능한 수정 프롬프트를 제공합니다.</p>
                  </div>
                </div>
                <div className="flex items-start gap-4 p-4 rounded-2xl bg-white border border-slate-100 shadow-sm">
                  <div className="bg-emerald-50 p-2 rounded-lg">
                    <ShieldCheck className="text-emerald-500" size={24} />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900">검증된 URL만 실행</h3>
                    <p className="text-sm text-slate-500 mt-1">소유권 검증을 통과한 URL만 테스트 대상으로 등록·실행됩니다.</p>
                  </div>
                </div>
              </div>

              {usageInfo && <UsagePanel usage={usageInfo.usage} quota={usageInfo.quota} />}
              <UrlRegistrationPanel urls={urls} onRefresh={refreshUrls} />
            </div>

            <div className="lg:col-span-7">
              <TestRunForm verifiedUrls={verifiedUrls} personas={personas} onCreated={setActiveRunId} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
