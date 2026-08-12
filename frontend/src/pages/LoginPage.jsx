import React, { useState } from 'react';
import { Activity, AlertCircle, ArrowRight, Bot, Zap, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await signup(email, password);
      }
    } catch (err) {
      setError(err.message || '인증에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] break-keep">
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-2">
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
      </header>

      <main className="max-w-5xl mx-auto p-6 lg:p-8 mt-8 lg:mt-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-center">
          {/* 제품 소개 — 로그인 전에는 이게 "랜딩" 역할을 한다. 로그인 후 대시보드에는
              반복 노출하지 않는다(마케팅 카피와 실제 작업 화면을 분리). */}
          <div className="lg:col-span-7 space-y-8">
            <div>
              <h1 className="text-3xl sm:text-[42px] font-extrabold text-slate-900 leading-tight tracking-tight mb-4">
                코드 수정까지 <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">
                  단 한 번의 클릭
                </span>
                으로.
              </h1>
              <p className="text-sm text-slate-600 leading-relaxed max-w-md">
                RepliQA는 화면을 직접 보는 AI 에이전트가 실제 유저처럼 돌발 행동을 하며 버그를 찾고, 발견 즉시
                코드에 바로 적용할 수 있는 수정 프롬프트를 만들어 드립니다.
              </p>
            </div>

            <div className="space-y-3 max-w-md">
              <div className="flex items-start gap-4 p-4 rounded-2xl bg-white border border-slate-100 shadow-sm">
                <div className="bg-blue-50 p-2 rounded-lg flex-shrink-0">
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
                <div className="bg-amber-50 p-2 rounded-lg flex-shrink-0">
                  <Zap className="text-amber-500" size={24} />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900">Zero-to-Fix 파이프라인</h3>
                  <p className="text-sm text-slate-500 mt-1">
                    에러 발견 즉시 Cursor 등에서 사용 가능한 수정 프롬프트를 제공합니다.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-4 p-4 rounded-2xl bg-white border border-slate-100 shadow-sm">
                <div className="bg-emerald-50 p-2 rounded-lg flex-shrink-0">
                  <ShieldCheck className="text-emerald-500" size={24} />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900">검증된 URL만 실행</h3>
                  <p className="text-sm text-slate-500 mt-1">
                    소유권 검증을 통과한 URL만 테스트 대상으로 등록·실행됩니다.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* 로그인/가입 폼 */}
          <div className="lg:col-span-5">
            <div className="bg-white p-8 sm:p-10 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100">
              <h2 className="text-xl font-bold text-slate-900 mb-1">
                {mode === 'login' ? '로그인' : '팀 계정 만들기'}
              </h2>
              <p className="text-slate-500 text-sm mb-6">
                {mode === 'login' ? 'RepliQA 대시보드로 이동합니다.' : '이메일/비밀번호로 새 팀 계정을 생성합니다.'}
              </p>

              {error && (
                <div className="mb-6 bg-red-50 border border-red-200 p-3 rounded-xl flex items-start gap-2">
                  <AlertCircle className="text-red-500 mt-0.5 flex-shrink-0" size={18} />
                  <p className="text-red-700 text-sm">{error}</p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">이메일</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl p-3 bg-slate-50 outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-slate-900 placeholder:text-slate-500"
                    placeholder="you@company.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">비밀번호</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl p-3 bg-slate-50 outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-slate-900 placeholder:text-slate-500"
                    placeholder="6자 이상"
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl hover:bg-blue-700 transition-all flex justify-center items-center gap-2 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
                >
                  {mode === 'login' ? '로그인' : '가입하기'}
                  <ArrowRight size={18} />
                </button>
              </form>

              <button
                onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
                className="w-full text-center text-sm text-slate-500 hover:text-blue-600 mt-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-400 rounded-lg"
              >
                {mode === 'login' ? '계정이 없나요? 가입하기' : '이미 계정이 있나요? 로그인'}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
