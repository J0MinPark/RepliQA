import React, { useState } from 'react';
import { Globe, CheckCircle2, Circle, KeyRound, CreditCard, Loader2, Mail, LogIn, Copy, Check } from 'lucide-react';
import { api } from '../lib/api';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

function CredentialsForm({ urlId, onSaved }) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-slate-500 hover:text-brand-600 flex items-center gap-1 mt-2"
      >
        <KeyRound size={12} /> 테스트 계정 등록 (선택)
      </button>
    );
  }

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.setTestCredentials(urlId, username, password);
      setOpen(false);
      onSaved?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="mt-2 flex flex-wrap gap-2 items-center">
      <input
        placeholder="테스트 계정 아이디"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white"
      />
      <input
        placeholder="비밀번호"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white"
      />
      <button
        type="submit"
        disabled={saving}
        className="text-xs bg-slate-900 text-white rounded-lg px-3 py-1.5 font-semibold disabled:opacity-60"
      >
        {saving ? '저장 중...' : '저장'}
      </button>
      <p className="text-xs text-slate-500 w-full">
        실 사용자 계정이 아닌, 별도 발급한 테스트 전용 계정만 입력하세요.
      </p>
    </form>
  );
}

function PaymentMethodForm({ urlId, onSaved }) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState({ cardNumber: '', expiry: '', cvc: '', cardHolderName: '' });
  const [saving, setSaving] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-slate-500 hover:text-brand-600 flex items-center gap-1 mt-2"
      >
        <CreditCard size={12} /> 테스트 결제 수단 등록 (선택)
      </button>
    );
  }

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = Object.fromEntries(Object.entries(fields).filter(([, v]) => v.trim()));
      await api.setTestPaymentMethod(urlId, payload);
      setOpen(false);
      onSaved?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="mt-2 flex flex-wrap gap-2 items-center">
      <input
        placeholder="테스트 카드번호"
        value={fields.cardNumber}
        onChange={(e) => setFields({ ...fields, cardNumber: e.target.value })}
        className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white w-32"
      />
      <input
        placeholder="MM/YY"
        value={fields.expiry}
        onChange={(e) => setFields({ ...fields, expiry: e.target.value })}
        className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white w-20"
      />
      <input
        placeholder="CVC"
        value={fields.cvc}
        onChange={(e) => setFields({ ...fields, cvc: e.target.value })}
        className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white w-16"
      />
      <input
        placeholder="카드소유자명"
        value={fields.cardHolderName}
        onChange={(e) => setFields({ ...fields, cardHolderName: e.target.value })}
        className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white w-28"
      />
      <button
        type="submit"
        disabled={saving}
        className="text-xs bg-slate-900 text-white rounded-lg px-3 py-1.5 font-semibold disabled:opacity-60"
      >
        {saving ? '저장 중...' : '저장'}
      </button>
      <p className="text-xs text-amber-700 w-full">
        반드시 PG사 테스트/샌드박스 모드용 카드 정보만 입력하세요. 최종 결제 제출 버튼은 항상 자동 클릭을
        생략합니다.
      </p>
    </form>
  );
}

function InboxConfigForm({ urlId, onSaved }) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState({ provider: 'mailosaur', apiKey: '', serverId: '', address: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-slate-500 hover:text-brand-600 flex items-center gap-1 mt-2"
      >
        <Mail size={12} /> 테스트 인박스 등록 (선택 — 이메일 인증코드 자동 입력용)
      </button>
    );
  }

  const save = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api.setTestInbox(urlId, fields);
      setOpen(false);
      onSaved?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="mt-2 flex flex-wrap gap-2 items-center">
      <input
        placeholder="API 키"
        value={fields.apiKey}
        onChange={(e) => setFields({ ...fields, apiKey: e.target.value })}
        className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white w-32"
      />
      <input
        placeholder="서버 ID"
        value={fields.serverId}
        onChange={(e) => setFields({ ...fields, serverId: e.target.value })}
        className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white w-28"
      />
      <input
        placeholder="테스트 이메일 주소 (선택)"
        value={fields.address}
        onChange={(e) => setFields({ ...fields, address: e.target.value })}
        className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white w-44"
      />
      <button
        type="submit"
        disabled={saving}
        className="text-xs bg-slate-900 text-white rounded-lg px-3 py-1.5 font-semibold disabled:opacity-60"
      >
        {saving ? '저장 중...' : '저장'}
      </button>
      {error && <p className="text-xs text-red-600 w-full">{error}</p>}
      <p className="text-xs text-slate-500 w-full">
        Mailosaur 등 테스트 인박스 서비스의 정보입니다. 회원가입 인증메일, 비밀번호 재설정 링크를
        여정 중 자동으로 읽어 입력하는 데 씁니다.
      </p>
    </form>
  );
}

// 자동화가 Google 등 소셜 로그인 화면을 매번 뚫을 수는 없다 — 이건 우회가 아니라
// RepliQA의 핵심 가치(자동화)를 위해 반드시 필요한 절차라, "설정 안 깊숙이" 대신
// URL 등록 화면에서 바로 명령어까지 복사할 수 있게 노출해둔다.
function SessionCaptureGuide({ url }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const command = `node scripts/capture-session.js "${url.url}" ${url.id} <발급받은_API_키> ${API_BASE_URL}`;

  const copy = () => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-slate-500 hover:text-brand-600 flex items-center gap-1 mt-2"
      >
        <LogIn size={12} /> 소셜 로그인(OAuth) 세션 캡처 방법 보기 (선택)
      </button>
    );
  }

  return (
    <div className="mt-2 bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-600 space-y-2">
      <p>
        Google 로그인처럼 자동화가 매번 뚫을 수 없는 로그인은, 사람이 딱 한 번 로그인하면 그
        세션을 저장해뒀다가 재사용하는 방식으로 자동화합니다.
      </p>
      <ol className="list-decimal list-outside pl-4 space-y-1">
        <li>API 키가 없다면 "Claude Code / Cursor 연동" 카드에서 먼저 발급받으세요.</li>
        <li>backend 폴더에서 아래 명령을 실행하면 실제 브라우저 창이 뜹니다.</li>
        <li>그 창에서 직접 로그인한 뒤, 터미널로 돌아와 Enter를 누르면 세션이 저장됩니다.</li>
      </ol>
      <div className="flex items-center gap-2">
        <pre className="flex-1 bg-slate-900 text-slate-100 rounded-lg p-2.5 overflow-x-auto text-[11px]">
          {command}
        </pre>
        <button
          onClick={copy}
          className="text-slate-500 hover:text-brand-600 flex-shrink-0 min-w-[32px] min-h-[32px] flex items-center justify-center rounded-lg hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-400"
          title="복사"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
      <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600">
        접기
      </button>
    </div>
  );
}

export default function UrlRegistrationPanel({ urls, onRefresh }) {
  const [newUrl, setNewUrl] = useState('');
  const [registering, setRegistering] = useState(false);
  const [pendingInstructions, setPendingInstructions] = useState(null);
  const [verifyingId, setVerifyingId] = useState(null);
  const [verifyError, setVerifyError] = useState('');

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!newUrl) return;
    setRegistering(true);
    try {
      const result = await api.registerUrl(newUrl);
      setPendingInstructions(result);
      setNewUrl('');
      onRefresh();
    } finally {
      setRegistering(false);
    }
  };

  const handleVerify = async (id) => {
    setVerifyingId(id);
    setVerifyError('');
    try {
      await api.verifyUrl(id);
      setPendingInstructions(null);
      onRefresh();
    } catch (err) {
      setVerifyError(err.message);
    } finally {
      setVerifyingId(null);
    }
  };

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6 sm:p-8">
      <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2 text-lg">
        <Globe size={20} className="text-slate-400" /> 테스트 대상 URL
      </h3>

      <form onSubmit={handleRegister} className="flex gap-2 mb-4">
        <input
          type="url"
          required
          placeholder="https://your-startup.com"
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          className="flex-1 border border-slate-200 rounded-xl px-3 py-3 bg-slate-50 outline-none focus:ring-2 focus:ring-brand-500 text-sm"
        />
        <button
          type="submit"
          disabled={registering}
          className="bg-brand-600 text-white text-sm font-bold px-5 py-3 rounded-xl hover:bg-brand-700 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2"
        >
          등록
        </button>
      </form>

      {pendingInstructions && pendingInstructions.verificationSkipped && (
        <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-xs text-emerald-800">
          <p className="font-bold">등록 완료 — 바로 테스트를 실행할 수 있습니다.</p>
          <p className="mt-1">파일럿 단계라 소유권 검증을 생략했습니다.</p>
        </div>
      )}
      {pendingInstructions && !pendingInstructions.verificationSkipped && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-800 space-y-1">
          <p className="font-bold">소유권 검증이 필요합니다.</p>
          <p>
            아래 경로에 내용이 <code className="bg-white px-1 rounded">{pendingInstructions.verificationFileContent}</code>
            인 텍스트 파일을 올리세요:
          </p>
          <p className="break-all font-mono bg-white px-2 py-1 rounded border border-amber-100">
            {pendingInstructions.verificationFileUrl}
          </p>
        </div>
      )}

      {verifyError && <p className="text-xs text-red-600 mb-3">{verifyError}</p>}

      <ul className="space-y-3">
        {urls.length === 0 && <li className="text-sm text-slate-500">등록된 URL이 없습니다.</li>}
        {urls.map((u) => (
          <li key={u.id} className="border border-slate-100 rounded-xl p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {u.verified ? (
                  <CheckCircle2 size={16} className="text-emerald-500 flex-shrink-0" />
                ) : (
                  <Circle size={16} className="text-slate-300 flex-shrink-0" />
                )}
                <span className="text-sm text-slate-700 truncate" title={u.url}>
                  {u.url}
                </span>
              </div>
              {!u.verified && (
                <button
                  onClick={() => handleVerify(u.id)}
                  disabled={verifyingId === u.id}
                  className="text-xs bg-slate-900 text-white rounded-lg px-3 py-2.5 font-semibold flex items-center gap-1 disabled:opacity-60 flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
                >
                  {verifyingId === u.id && <Loader2 size={12} className="animate-spin" />}
                  검증하기
                </button>
              )}
            </div>
            {!u.hasTestCredentials && <CredentialsForm urlId={u.id} onSaved={onRefresh} />}
            {u.hasTestCredentials && (
              <p className="text-xs text-emerald-600 mt-2">테스트 계정이 등록되어 있습니다.</p>
            )}
            {!u.hasTestPaymentMethod && <PaymentMethodForm urlId={u.id} onSaved={onRefresh} />}
            {u.hasTestPaymentMethod && (
              <p className="text-xs text-emerald-600 mt-2">테스트 결제 수단이 등록되어 있습니다.</p>
            )}
            {!u.hasTestInbox && <InboxConfigForm urlId={u.id} onSaved={onRefresh} />}
            {u.hasTestInbox && <p className="text-xs text-emerald-600 mt-2">테스트 인박스가 등록되어 있습니다.</p>}
            {u.hasTestSession ? (
              <p className="text-xs text-emerald-600 mt-2">
                소셜 로그인 세션이 저장되어 있어 로그인된 상태로 시작합니다.
              </p>
            ) : (
              <SessionCaptureGuide url={u} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
