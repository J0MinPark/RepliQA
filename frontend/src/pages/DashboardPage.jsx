import React, { useCallback, useEffect, useState } from 'react';
import { LogOut, MailWarning, Settings } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import UrlRegistrationPanel from '../components/UrlRegistrationPanel';
import RouteBuilder from '../components/RouteBuilder';
import TestRunForm from '../components/TestRunForm';
import TestRunProgress from '../components/TestRunProgress';
import RunHistoryPanel from '../components/RunHistoryPanel';
import UsagePanel from '../components/UsagePanel';
import ApiKeyPanel from '../components/ApiKeyPanel';
import SettingsModal from '../components/SettingsModal';
import Logo from '../components/Logo';

export default function DashboardPage() {
  const { user, tenantId, logout, resendVerification, refreshUser } = useAuth();
  const [urls, setUrls] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [personas, setPersonas] = useState([]);
  const [usageInfo, setUsageInfo] = useState(null);
  const [activeRunId, setActiveRunId] = useState(null);
  const [verifyCooldown, setVerifyCooldown] = useState(0);
  const [verifyChecking, setVerifyChecking] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

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

  useEffect(() => {
    if (verifyCooldown <= 0) return;
    const timer = setInterval(() => setVerifyCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [verifyCooldown]);

  const handleResendVerification = async () => {
    try {
      await resendVerification();
      setVerifyCooldown(60);
    } catch {
      // 스팸 방지용 재전송 실패는 조용히 무시 — 쿨다운을 다시 걸지 않아 바로 재시도 가능하게 둔다.
    }
  };

  const handleCheckVerification = async () => {
    setVerifyChecking(true);
    await refreshUser().catch(() => {});
    setVerifyChecking(false);
  };

  const handleReset = () => {
    setActiveRunId(null);
    refreshUsage();
  };

  const verifiedUrls = urls.filter((u) => u.verified);

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-800 font-sans selection:bg-brand-100 selection:text-brand-900 break-keep">
      <header className="bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto flex justify-between items-center gap-3">
          <button
            onClick={handleReset}
            className="flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-brand-400 rounded-lg"
          >
            <Logo />
          </button>
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="flex items-center gap-2 text-sm text-slate-600 bg-slate-100 px-3 sm:px-4 py-2 rounded-full font-medium min-w-0">
              <div className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0"></div>
              <span className="truncate max-w-[120px] sm:max-w-none">{user?.email}</span>
            </div>
            <button
              onClick={() => setShowSettings(true)}
              className="text-slate-500 hover:text-slate-900 rounded-full hover:bg-slate-100 transition min-w-[44px] min-h-[44px] flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-brand-400"
              title="설정"
            >
              <Settings size={18} />
            </button>
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

      <main className="max-w-2xl mx-auto p-4 sm:p-6 lg:p-8 mt-4 sm:mt-8">
        {user && !user.emailVerified && (
          <div className="mb-6 bg-amber-50 border border-amber-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
            <div className="flex items-start gap-3">
              <MailWarning className="text-amber-600 flex-shrink-0 mt-0.5" size={20} />
              <p className="text-sm text-amber-800">
                이메일 인증이 아직 완료되지 않았습니다. 비밀번호를 잊었을 때 계정을 복구하려면 인증이 필요합니다.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={handleCheckVerification}
                disabled={verifyChecking}
                className="text-sm font-bold text-amber-700 hover:text-amber-900 bg-white border border-amber-300 rounded-lg px-3 py-2 disabled:opacity-60"
              >
                {verifyChecking ? '확인 중…' : '인증 확인'}
              </button>
              <button
                onClick={handleResendVerification}
                disabled={verifyCooldown > 0}
                className="text-sm font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg px-3 py-2 disabled:opacity-60"
              >
                {verifyCooldown > 0 ? `재전송 (${verifyCooldown}s)` : '인증 메일 재전송'}
              </button>
            </div>
          </div>
        )}
        {activeRunId ? (
          <TestRunProgress tenantId={tenantId} runId={activeRunId} onReset={handleReset} />
        ) : (
          <div className="space-y-6 animate-in fade-in duration-500">
            {usageInfo && <UsagePanel usage={usageInfo.usage} quota={usageInfo.quota} />}
            <RunHistoryPanel tenantId={tenantId} onSelect={setActiveRunId} />
            <UrlRegistrationPanel urls={urls} onRefresh={refreshUrls} />
            <RouteBuilder verifiedUrls={verifiedUrls} routes={routes} onRefresh={refreshRoutes} />
            <ApiKeyPanel />
            <TestRunForm
              verifiedUrls={verifiedUrls}
              personas={personas}
              routes={routes}
              onCreated={setActiveRunId}
            />
          </div>
        )}
      </main>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}
