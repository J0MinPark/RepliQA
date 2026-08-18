import React, { useState } from 'react';
import { Route, ListChecks, ChevronDown, CreditCard, Clock, HelpCircle, ShieldCheck, Network, Play, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import Select from './Select';

const CHECKPOINT_TYPE_BADGE = {
  payment: { label: '결제', icon: CreditCard, className: 'bg-amber-50 text-amber-700' },
  long_running: { label: '장시간', icon: Clock, className: 'bg-sky-50 text-sky-700' },
};

// 개발자는 실제로 짧게만 쓴다 — "회원가입하기"면 충분히 동작하지만(값은 AI가 알아서
// 채움), 어떤 한 줄이 결과를 크게 바꾸는지는 코드를 안 보면 알기 어렵다. 그래서 특별한
// 문법이 필요한 것만 최소한으로 짚어준다.
function CheckpointGuide() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700"
      >
        <HelpCircle size={13} /> 여정 작성 가이드 {open ? '접기' : '보기'}
      </button>
      {open && (
        <div className="mt-2 bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2 text-xs text-slate-600 leading-relaxed">
          <p>
            <strong className="text-slate-800">짧게 써도 됩니다.</strong> "회원가입하기"처럼 한 단어에 가까워도
            AI가 화면을 보고 이메일·비밀번호 같은 값을 알아서 채워 넣습니다.
          </p>
          <p>
            <strong className="text-slate-800">단, 언제 끝났다고 볼지는 함께 적어주면 좋습니다.</strong> "회원가입
            완료 화면까지 확인"처럼 끝 상태를 적으면 AI가 성공/실패를 더 정확히 판단합니다.
          </p>
          <p>
            <strong className="text-slate-800">특정 오류·검증을 일부러 테스트하려면 조건을 직접 적어야 합니다.</strong>{' '}
            그냥 "회원가입하기"만 쓰면 AI는 기본적으로 성공하는 값만 넣습니다. "이미 가입된 이메일로 재가입
            시도" 또는 "비밀번호 규칙을 어긴 값을 입력해서 에러 메시지 확인"처럼 원하는 케이스를 명시하세요.
          </p>
          <p>
            <strong className="text-slate-800">특수 태그(줄 맨 앞에 붙이세요):</strong>
          </p>
          <ul className="list-disc list-inside space-y-1 ml-1">
            <li>
              <code className="bg-white px-1 py-0.5 rounded border border-slate-200">[결제]</code> — 결제
              전용 처리(테스트 카드 자동 입력 + 실제 최종 결제 버튼 클릭은 안전하게 생략)가 적용됩니다.
            </li>
            <li>
              <code className="bg-white px-1 py-0.5 rounded border border-slate-200">[장시간]</code> — 대기
              시간 제한이 5초에서 30분으로 늘어납니다. 세션 만료처럼 실제 시간이 걸려야 확인되는 시나리오
              전용입니다.
            </li>
          </ul>
          <p>
            <strong className="text-slate-800">결정론적 검증(줄 맨 끝에 붙이세요, 선택):</strong> "AI가 목표를
            달성했다"는 판단과 별개로, 실제 URL·화면 텍스트·네트워크 응답을 엔진이 직접 확인하게 할 수 있습니다.
            로그인/결제완료처럼 "정확히 이 상태가 돼야 성공"이 분명한 단계에 추천합니다.
          </p>
          <ul className="list-disc list-inside space-y-1 ml-1">
            <li>
              <code className="bg-white px-1 py-0.5 rounded border border-slate-200">[검증: url_contains(&quot;/cart&quot;)]</code>{' '}
              — 최종 URL에 이 문자열이 포함돼야 성공
            </li>
            <li>
              <code className="bg-white px-1 py-0.5 rounded border border-slate-200">
                [검증: text_visible(&quot;주문이 완료되었습니다&quot;)]
              </code>{' '}
              — 화면에 이 텍스트가 보여야 성공
            </li>
            <li>
              <code className="bg-white px-1 py-0.5 rounded border border-slate-200">
                [검증: network_status(&quot;/api/orders&quot;, 200)]
              </code>{' '}
              — 이 URL 패턴으로 이 상태 코드 응답이 있어야 성공
            </li>
          </ul>
          <p>
            <strong className="text-slate-800">네트워크 모킹(줄 맨 끝에 붙이세요, 선택):</strong> 이 체크포인트가
            실행되는 동안 해당 URL로 나가는 요청에 실제 서버 응답 대신 강제로 지정한 응답을 돌려줍니다. 에러
            화면·빈 목록처럼 서버 협조 없이 재현하기 어려운 엣지케이스를 테스트할 때 씁니다.
          </p>
          <ul className="list-disc list-inside space-y-1 ml-1">
            <li>
              <code className="bg-white px-1 py-0.5 rounded border border-slate-200">
                [모킹: force_status(&quot;/api/orders&quot;, 500)]
              </code>{' '}
              — 이 URL 패턴으로 나가는 요청에 500 응답을 강제
            </li>
            <li>
              <code className="bg-white px-1 py-0.5 rounded border border-slate-200">
                [모킹: force_response(&quot;/api/cart&quot;, 200, {'{'}&quot;items&quot;:[]{'}'})]
              </code>{' '}
              — 상태 코드와 응답 본문을 함께 강제
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

export default function RouteBuilder({ verifiedUrls, routes, onRefresh, personas, onRunCreated }) {
  const [name, setName] = useState('');
  const [registeredUrlId, setRegisteredUrlId] = useState('');
  const [checkpointsText, setCheckpointsText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  // "routeId:index" 문자열을 키로 써서 여러 체크포인트가 동시에 재실행 중이어도 서로
  // 안 헷갈리게 상태를 구분한다.
  const [runningKey, setRunningKey] = useState(null);
  const [runError, setRunError] = useState('');

  // Cypress Component Testing을 "체크포인트 단위 격리 재실행"으로 재해석한 기능 —
  // 여정 전체가 아니라 이 체크포인트 하나만 등록된 URL 루트부터 독립적으로 재실행한다.
  const handleRunCheckpoint = async (routeId, index) => {
    if (!personas || personas.length === 0) {
      setRunError('사용 가능한 페르소나가 없습니다.');
      return;
    }
    setRunError('');
    setRunningKey(`${routeId}:${index}`);
    try {
      const { id } = await api.runCheckpoint(routeId, index, personas[0].id);
      onRunCreated?.(id);
    } catch (err) {
      setRunError(err.message);
    } finally {
      setRunningKey(null);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const checkpoints = checkpointsText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (checkpoints.length === 0) {
      setError('체크포인트를 한 줄에 하나씩 입력하세요.');
      return;
    }
    setSubmitting(true);
    try {
      await api.createRoute(name, registeredUrlId, checkpoints);
      setName('');
      setRegisteredUrlId('');
      setCheckpointsText('');
      onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6 sm:p-8">
      <h3 className="font-bold text-slate-900 mb-1 flex items-center gap-2 text-lg">
        <Route size={20} className="text-slate-400" /> 테스트 여정 (선택)
      </h3>
      <p className="text-xs text-slate-500 mb-4">
        확인하고 싶은 단계를 순서대로 한 줄씩 입력하세요. 비워두면 자유 탐색으로 실행됩니다.
      </p>

      {verifiedUrls.length === 0 ? (
        <p className="text-sm text-slate-500">먼저 URL을 등록하면 여정을 만들 수 있습니다.</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3 mb-6">
          <input
            type="text"
            required
            placeholder="여정 이름 (예: 회원가입 → 결제)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 outline-none focus:ring-2 focus:ring-brand-500 text-sm"
          />
          <Select required value={registeredUrlId} onChange={(e) => setRegisteredUrlId(e.target.value)}>
            <option value="">대상 URL 선택</option>
            {verifiedUrls.map((u) => (
              <option key={u.id} value={u.id}>
                {u.url}
              </option>
            ))}
          </Select>
          <CheckpointGuide />
          <textarea
            required
            rows={4}
            placeholder={
              '한 줄에 체크포인트 하나씩 입력하세요. 예:\n로그인 페이지에서 로그인 완료\n상품 목록에서 아무 상품이나 상세 페이지로 이동\n[결제] 장바구니에서 결제 진행'
            }
            value={checkpointsText}
            onChange={(e) => setCheckpointsText(e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 bg-slate-50 outline-none focus:ring-2 focus:ring-brand-500 text-sm font-mono"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-slate-900 text-white text-sm font-bold py-3 rounded-xl hover:bg-slate-800 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
          >
            {submitting ? '저장 중...' : '여정 저장'}
          </button>
        </form>
      )}

      {routes.length > 0 && (
        <div className="border-t border-slate-100 pt-4 space-y-1">
          {routes.map((r) => {
            const isOpen = expandedId === r.id;
            return (
              <div key={r.id}>
                <button
                  type="button"
                  onClick={() => setExpandedId(isOpen ? null : r.id)}
                  className="w-full flex items-center gap-2 text-sm text-slate-700 py-1.5 rounded-lg hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-400"
                >
                  <ListChecks size={14} className="text-slate-400 flex-shrink-0" />
                  <span className="font-semibold">{r.name}</span>
                  <span className="text-slate-400 text-xs">({r.checkpoints.length}단계)</span>
                  <ChevronDown
                    size={14}
                    className={`ml-auto text-slate-400 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {isOpen && (
                  <ol className="ml-6 mb-2 space-y-1.5 border-l border-slate-100 pl-4">
                    {r.checkpoints.map((c, idx) => {
                      const badge = CHECKPOINT_TYPE_BADGE[c.type];
                      return (
                        <li key={idx} className="text-sm text-slate-600 flex items-start gap-2">
                          <span className="text-slate-400 text-xs mt-0.5">{idx + 1}.</span>
                          <span className="flex-1">{c.goal}</span>
                          {badge && (
                            <span
                              className={`flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-md flex-shrink-0 ${badge.className}`}
                            >
                              <badge.icon size={11} />
                              {badge.label}
                            </span>
                          )}
                          {c.verify && (
                            <span
                              className="flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-md flex-shrink-0 bg-emerald-50 text-emerald-700"
                              title="AI 판단과 별개로 실제 상태를 직접 확인하는 결정론적 검증이 설정돼 있습니다"
                            >
                              <ShieldCheck size={11} />
                              검증
                            </span>
                          )}
                          {c.mock && (
                            <span
                              className="flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-md flex-shrink-0 bg-violet-50 text-violet-700"
                              title="이 체크포인트 실행 중 지정한 URL 패턴의 네트워크 응답이 강제로 대체됩니다"
                            >
                              <Network size={11} />
                              모킹
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => handleRunCheckpoint(r.id, idx)}
                            disabled={runningKey === `${r.id}:${idx}`}
                            title="여정 전체가 아니라 이 체크포인트만 등록된 URL부터 독립적으로 재실행합니다"
                            className="flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-md flex-shrink-0 bg-brand-50 text-brand-700 hover:bg-brand-100 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-brand-400"
                          >
                            {runningKey === `${r.id}:${idx}` ? (
                              <Loader2 size={11} className="animate-spin" />
                            ) : (
                              <Play size={11} />
                            )}
                            재실행
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            );
          })}
        </div>
      )}
      {runError && <p className="text-xs text-red-600 mt-3">{runError}</p>}
    </div>
  );
}
