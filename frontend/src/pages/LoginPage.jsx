import React, { useState } from 'react';
import { AlertCircle, ArrowRight, Bot, Zap, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import LegalModal from '../components/LegalModal';
import Logo from '../components/Logo';

const FEATURES = [
  {
    icon: Bot,
    title: 'Vision 기반 다중 페르소나',
    desc: '스크린샷+좌표 기반으로 화면을 인지해, 프레임워크에 상관없이 엣지 케이스를 재현합니다.',
  },
  {
    icon: Zap,
    title: 'Zero-to-Fix 파이프라인',
    desc: '에러 발견 즉시 Cursor 등에서 사용 가능한 수정 프롬프트를 제공합니다.',
  },
  {
    icon: ShieldCheck,
    title: '검증된 URL만 실행',
    desc: '소유권 검증을 통과한 URL만 테스트 대상으로 등록·실행됩니다.',
  },
];

export default function LoginPage() {
  const { login, signup, resetPassword } = useAuth();
  const [mode, setMode] = useState('login'); // 'login' | 'signup' | 'reset'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [legalModal, setLegalModal] = useState(null); // null | 'terms' | 'privacy'

  const switchMode = (next) => {
    setMode(next);
    setError('');
    setResetSent(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else if (mode === 'signup') {
        await signup(email, password);
      } else {
        await resetPassword(email);
        setResetSent(true);
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
        <div className="max-w-5xl mx-auto">
          <Logo />
        </div>
      </header>

      <main className="max-w-xl mx-auto p-6 lg:p-8 mt-8 lg:mt-16 space-y-10">
        {/* 제품 소개 — 로그인 전에는 이게 "랜딩" 역할을 한다. 로그인 후 대시보드에는
            반복 노출하지 않는다(마케팅 카피와 실제 작업 화면을 분리). */}
        <div>
          <div>
            <h1 className="text-3xl sm:text-[42px] font-extrabold text-slate-900 leading-tight tracking-tight mb-4">
              코드 수정까지 <br />
              <span className="text-brand-600">단 한 번의 클릭</span>으로.
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              RepliQA는 화면을 직접 보는 AI 에이전트가 실제 유저처럼 돌발 행동을 하며 버그를 찾고, 발견 즉시
              코드에 바로 적용할 수 있는 수정 프롬프트를 만들어 드립니다.
            </p>
          </div>

          <div className="border-t border-slate-200 divide-y divide-slate-200 mt-8">
            {FEATURES.map((f) => (
              <div key={f.title} className="flex items-start gap-3.5 py-4">
                <f.icon size={18} className="text-brand-600 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">{f.title}</h3>
                  <p className="text-sm text-slate-500 mt-1">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 로그인/가입 폼 */}
        <div>
          <div className="bg-white p-8 sm:p-10 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100">
            <h2 className="text-xl font-bold text-slate-900 mb-1">
                {mode === 'login' ? '로그인' : mode === 'signup' ? '팀 계정 만들기' : '비밀번호 재설정'}
              </h2>
              <p className="text-slate-500 text-sm mb-6">
                {mode === 'login'
                  ? 'RepliQA 대시보드로 이동합니다.'
                  : mode === 'signup'
                    ? '이메일/비밀번호로 새 팀 계정을 생성합니다.'
                    : '가입하신 이메일로 재설정 링크를 보내드립니다.'}
              </p>

              {error && (
                <div className="mb-6 bg-red-50 border border-red-200 p-3 rounded-xl flex items-start gap-2">
                  <AlertCircle className="text-red-500 mt-0.5 flex-shrink-0" size={18} />
                  <p className="text-red-700 text-sm">{error}</p>
                </div>
              )}

              {mode === 'reset' && resetSent ? (
                <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl text-emerald-800 text-sm">
                  이메일을 확인해 주세요. <strong>{email}</strong>(으)로 재설정 링크를 보냈습니다.
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">이메일</label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl p-3 bg-slate-50 outline-none focus:ring-2 focus:ring-brand-500 focus:bg-white transition-all text-slate-900 placeholder:text-slate-500"
                      placeholder="you@company.com"
                    />
                  </div>
                  {mode !== 'reset' && (
                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-2">비밀번호</label>
                      <input
                        type="password"
                        required
                        minLength={6}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl p-3 bg-slate-50 outline-none focus:ring-2 focus:ring-brand-500 focus:bg-white transition-all text-slate-900 placeholder:text-slate-500"
                        placeholder="6자 이상"
                      />
                    </div>
                  )}
                  {mode === 'signup' && (
                    <label className="flex items-start gap-2 text-sm text-slate-600">
                      <input
                        type="checkbox"
                        checked={agreed}
                        onChange={(e) => setAgreed(e.target.checked)}
                        className="mt-0.5 w-4 h-4 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
                      />
                      <span>
                        <button
                          type="button"
                          onClick={() => setLegalModal('terms')}
                          className="text-brand-600 hover:underline font-medium"
                        >
                          이용약관
                        </button>{' '}
                        및{' '}
                        <button
                          type="button"
                          onClick={() => setLegalModal('privacy')}
                          className="text-brand-600 hover:underline font-medium"
                        >
                          개인정보처리방침
                        </button>
                        에 동의합니다.
                      </span>
                    </label>
                  )}
                  <button
                    type="submit"
                    disabled={submitting || (mode === 'signup' && !agreed)}
                    className="w-full bg-brand-600 text-white font-bold py-3 rounded-xl hover:bg-brand-700 transition-all flex justify-center items-center gap-2 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2"
                  >
                    {mode === 'login' ? '로그인' : mode === 'signup' ? '가입하기' : '재설정 링크 보내기'}
                    <ArrowRight size={18} />
                  </button>
                </form>
              )}

              {mode === 'login' && (
                <button
                  onClick={() => switchMode('reset')}
                  className="w-full text-center text-sm text-slate-500 hover:text-brand-600 mt-2 py-2 focus:outline-none focus:ring-2 focus:ring-brand-400 rounded-lg"
                >
                  비밀번호를 잊으셨나요?
                </button>
              )}

              <button
                onClick={() => switchMode(mode === 'signup' ? 'login' : mode === 'reset' ? 'login' : 'signup')}
                className="w-full text-center text-sm text-slate-500 hover:text-brand-600 mt-2 py-3 focus:outline-none focus:ring-2 focus:ring-brand-400 rounded-lg"
              >
                {mode === 'login' ? '계정이 없나요? 가입하기' : mode === 'signup' ? '이미 계정이 있나요? 로그인' : '로그인으로 돌아가기'}
              </button>
          </div>
        </div>
      </main>

      <footer className="max-w-xl mx-auto px-6 pb-10 flex justify-center gap-4 text-xs text-slate-400">
        <button onClick={() => setLegalModal('terms')} className="hover:text-slate-600">
          이용약관
        </button>
        <button onClick={() => setLegalModal('privacy')} className="hover:text-slate-600">
          개인정보처리방침
        </button>
      </footer>

      <LegalModal type={legalModal} onClose={() => setLegalModal(null)} />
    </div>
  );
}
