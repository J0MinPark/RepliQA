import React, { useState } from 'react';
import { AlertCircle, ArrowRight, Bot, Zap, ShieldCheck, Check, X as XIcon } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import LegalModal from '../components/LegalModal';
import Logo from '../components/Logo';

// Firebase가 던지는 에러 코드는 그대로 보여주면("Firebase: Error (auth/...)." 형태) 실사용자
// 입장에서 뭘 어떻게 고쳐야 할지 알 수 없다 — 실제로 자주 겪는 코드만 한국어로 바꿔준다.
const AUTH_ERROR_MESSAGES = {
  'auth/email-already-in-use': '이미 가입된 이메일입니다. 로그인을 시도하거나 비밀번호를 재설정해 주세요.',
  'auth/invalid-email': '올바른 이메일 형식이 아닙니다.',
  'auth/weak-password': '비밀번호가 너무 약합니다.',
  'auth/user-not-found': '가입되지 않은 이메일입니다.',
  'auth/wrong-password': '이메일 또는 비밀번호가 올바르지 않습니다.',
  'auth/invalid-credential': '이메일 또는 비밀번호가 올바르지 않습니다.',
  'auth/too-many-requests': '시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  'auth/popup-closed-by-user': '로그인 창이 닫혔습니다. 다시 시도해 주세요.',
  'auth/popup-blocked': '팝업이 차단됐습니다. 브라우저의 팝업 차단을 해제한 뒤 다시 시도해 주세요.',
};
function friendlyAuthError(err) {
  return AUTH_ERROR_MESSAGES[err?.code] || err?.message || '인증에 실패했습니다.';
}

// 대문자/소문자/숫자를 각각 하나 이상 포함한 8자 이상 — 화면에도 이 규칙을 그대로 문구로
// 보여준다(placeholder에 "8자 이상"이라고만 적혀 있으면 실제 요구사항을 알 방법이 없었다).
const PASSWORD_RULE_TEXT = '영문 대소문자와 숫자를 포함해 8자 이상';
function isPasswordValid(pw) {
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(pw);
}

// lucide-react는 브랜드 로고를 포함하지 않으므로 구글 4색 "G" 마크만 인라인 SVG로 둔다.
function GoogleIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 15.9 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.5 0 10.5-2.1 14.3-5.6l-6.6-5.6C29.6 34.7 27 35.5 24 35.5c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.6 39.6 16.3 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6.6 5.6C41.5 36 44 30.5 44 24c0-1.3-.1-2.7-.4-3.5z"
      />
    </svg>
  );
}

const FEATURES = [
  {
    icon: Bot,
    title: 'Vision 기반 자동 탐색',
    desc: '스크린샷+좌표 기반으로 화면을 인지해, 지시한 시나리오를 프레임워크에 상관없이 그대로 재현합니다.',
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
  const { login, signup, loginWithGoogle, resetPassword } = useAuth();
  const [mode, setMode] = useState('login'); // 'login' | 'signup' | 'reset'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [legalModal, setLegalModal] = useState(null); // null | 'terms' | 'privacy'

  // 로그인 폼에서 실패한 뒤 "가입하기"로 넘어가면, 방금 입력한(어쩌면 남의 계정이거나
  // 오타난) ID/비밀번호가 그대로 회원가입 폼에 남아있던 문제 — 모드가 바뀌면 완전히
  // 새 폼처럼 비운다.
  const switchMode = (next) => {
    setMode(next);
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setError('');
    setResetSent(false);
  };

  const passwordValid = isPasswordValid(password);
  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;
  const canSubmitSignup = agreed && passwordValid && passwordsMatch;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (mode === 'signup' && !passwordValid) {
      setError(`비밀번호 규칙을 확인해 주세요 (${PASSWORD_RULE_TEXT}).`);
      return;
    }
    if (mode === 'signup' && !passwordsMatch) {
      setError('비밀번호가 일치하지 않습니다.');
      return;
    }
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
      setError(friendlyAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setError('');
    setGoogleSubmitting(true);
    try {
      await loginWithGoogle();
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setGoogleSubmitting(false);
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
                        minLength={8}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl p-3 bg-slate-50 outline-none focus:ring-2 focus:ring-brand-500 focus:bg-white transition-all text-slate-900 placeholder:text-slate-500"
                        placeholder={mode === 'signup' ? PASSWORD_RULE_TEXT : '비밀번호'}
                      />
                      {mode === 'signup' && password.length > 0 && (
                        <p
                          className={`mt-1.5 text-xs flex items-center gap-1 ${
                            passwordValid ? 'text-emerald-600' : 'text-slate-500'
                          }`}
                        >
                          {passwordValid ? <Check size={13} /> : <XIcon size={13} />}
                          {PASSWORD_RULE_TEXT}
                        </p>
                      )}
                    </div>
                  )}
                  {mode === 'signup' && (
                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-2">비밀번호 확인</label>
                      <input
                        type="password"
                        required
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl p-3 bg-slate-50 outline-none focus:ring-2 focus:ring-brand-500 focus:bg-white transition-all text-slate-900 placeholder:text-slate-500"
                        placeholder="비밀번호를 한 번 더 입력해 주세요"
                      />
                      {confirmPassword.length > 0 && (
                        <p
                          className={`mt-1.5 text-xs flex items-center gap-1 ${
                            passwordsMatch ? 'text-emerald-600' : 'text-red-500'
                          }`}
                        >
                          {passwordsMatch ? <Check size={13} /> : <XIcon size={13} />}
                          {passwordsMatch ? '비밀번호가 일치합니다.' : '비밀번호가 일치하지 않습니다.'}
                        </p>
                      )}
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
                    disabled={submitting || (mode === 'signup' && !canSubmitSignup)}
                    className="w-full bg-brand-600 text-white font-bold py-3 rounded-xl hover:bg-brand-700 transition-all flex justify-center items-center gap-2 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2"
                  >
                    {mode === 'login' ? '로그인' : mode === 'signup' ? '가입하기' : '재설정 링크 보내기'}
                    <ArrowRight size={18} />
                  </button>
                </form>
              )}

              {mode !== 'reset' && (
                <div className="mt-4">
                  <div className="flex items-center gap-3 text-xs text-slate-400">
                    <span className="flex-1 h-px bg-slate-200" />
                    또는
                    <span className="flex-1 h-px bg-slate-200" />
                  </div>
                  <button
                    type="button"
                    onClick={handleGoogle}
                    disabled={googleSubmitting}
                    className="w-full mt-4 border border-slate-200 text-slate-700 font-semibold py-3 rounded-xl hover:bg-slate-50 transition-all flex justify-center items-center gap-2 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2"
                  >
                    <GoogleIcon size={18} />
                    Google로 계속하기
                  </button>
                </div>
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
