import React, { useCallback, useEffect, useState } from 'react';
import { Activity, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import UrlRegistrationPanel from '../components/UrlRegistrationPanel';
import RouteBuilder from '../components/RouteBuilder';
import TestRunForm from '../components/TestRunForm';
import TestRunProgress from '../components/TestRunProgress';
import UsagePanel from '../components/UsagePanel';
import ApiKeyPanel from '../components/ApiKeyPanel';

export default function DashboardPage() {
  const { user, tenantId, logout } = useAuth();
  const [urls, setUrls] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [personas, setPersonas] = useState([]);
  const [usageInfo, setUsageInfo] = useState(null);
  const [activeRunId, setActiveRunId] = useState(null);

  const refreshUrls = useCallback(async () => {
    const data = await api.listUrls();
    setUrls(data);
  }, []);

  const refreshRoutes = useCallback(async () => {
    const data = await api.listRoutes();
    setRoutes(data);
  }, []);

  const refreshUsage = useCallback(async () => {
    const data = await api.getUsageToday();
    setUsageInfo(data);
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 로그인 직후 1회성 초기 데이터 로드
    refreshUrls();
    refreshRoutes();
    refreshUsage();
    api.listPersonas().then(setPersonas);
  }, [tenantId, refreshUrls, refreshRoutes, refreshUsage]);

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
              <span className="text-xs uppercase font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-full ml-1 align-middle">
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
              className="text-slate-500 hover:text-red-600 rounded-full hover:bg-red-50 transition min-w-[44px] min-h-[44px] flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-red-400"
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
            <div className="lg:col-span-5 space-y-6">
              {usageInfo && <UsagePanel usage={usageInfo.usage} quota={usageInfo.quota} />}
              <UrlRegistrationPanel urls={urls} onRefresh={refreshUrls} />
              <RouteBuilder verifiedUrls={verifiedUrls} routes={routes} onRefresh={refreshRoutes} />
              <ApiKeyPanel />
            </div>

            <div className="lg:col-span-7">
              <TestRunForm
                verifiedUrls={verifiedUrls}
                personas={personas}
                routes={routes}
                onCreated={setActiveRunId}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
