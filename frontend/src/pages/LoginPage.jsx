import React, { useState } from 'react';
import { Activity, AlertCircle, ArrowRight } from 'lucide-react';
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
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white p-8 sm:p-10 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100">
        <div className="flex items-center gap-2 mb-8">
          <div className="bg-blue-600 p-1.5 rounded-lg">
            <Activity className="text-white" size={20} />
          </div>
          <span className="text-xl font-extrabold tracking-tight text-slate-900">RepliQA</span>
        </div>

        <h1 className="text-2xl font-bold text-slate-900 mb-1">
          {mode === 'login' ? '로그인' : '팀 계정 만들기'}
        </h1>
        <p className="text-slate-500 text-sm mb-6">
          {mode === 'login' ? '테스트 대시보드로 이동합니다.' : '이메일/비밀번호로 새 테넌트를 생성합니다.'}
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
              className="w-full border border-slate-200 rounded-xl p-3 bg-slate-50 outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-slate-900"
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
              className="w-full border border-slate-200 rounded-xl p-3 bg-slate-50 outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-slate-900"
              placeholder="6자 이상"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl hover:bg-blue-700 transition-all flex justify-center items-center gap-2 disabled:opacity-60"
          >
            {mode === 'login' ? '로그인' : '가입하기'}
            <ArrowRight size={18} />
          </button>
        </form>

        <button
          onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
          className="w-full text-center text-sm text-slate-500 hover:text-blue-600 mt-6"
        >
          {mode === 'login' ? '계정이 없나요? 가입하기' : '이미 계정이 있나요? 로그인'}
        </button>
      </div>
    </div>
  );
}
