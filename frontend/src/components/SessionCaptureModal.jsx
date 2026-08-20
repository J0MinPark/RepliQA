import React, { useEffect, useRef, useState } from 'react';
import RFB from '@novnc/novnc';
import { X, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { api, WORKER_BASE_URL } from '../lib/api';

// 소셜 로그인(OAuth)은 자동화가 매번 뚫을 수 없어서, 사람이 딱 한 번 로그인하면 그 세션을
// 저장해뒀다가 재사용한다. 예전엔 이걸 터미널에서 스크립트를 실행해야 했는데(비개발자에게는
// 그 자체가 진입장벽), 여기서는 서버가 대신 띄운 브라우저 화면을 noVNC로 이 모달 안에
// 그대로 보여줘서 마우스/키보드로 직접 로그인할 수 있게 한다 — 설치도 명령어도 없다.
function wsUrlFor(captureId) {
  const url = new URL(WORKER_BASE_URL);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `/session-capture/${captureId}/vnc`;
  return url.toString();
}

const STAGE = {
  connecting: { icon: Loader2, spin: true, text: '원격 브라우저를 준비하고 있습니다...' },
  ready: { icon: null, spin: false, text: null },
  saving: { icon: Loader2, spin: true, text: '로그인 세션을 저장하고 있습니다...' },
  error: { icon: AlertCircle, spin: false, text: null },
};

export default function SessionCaptureModal({ urlId, onClose, onSaved }) {
  const [stage, setStage] = useState('connecting');
  const [error, setError] = useState('');
  const screenRef = useRef(null);
  const rfbRef = useRef(null);
  const captureIdRef = useRef(null);
  // finishSessionCapture는 서버 쪽 원격 브라우저를 이미 정리해버리므로, 그 뒤 saveTestSession이
  // 실패했을 때 재시도 버튼을 눌러도 finish를 다시 호출하지 않고 이 값으로만 재시도한다 —
  // 안 그러면 이미 받아온 storageState를 버리고 "캡처를 찾을 수 없습니다" 에러만 반복된다.
  const storageStateRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { captureId } = await api.startSessionCapture(urlId);
        if (cancelled) return;
        captureIdRef.current = captureId;

        const rfb = new RFB(screenRef.current, wsUrlFor(captureId));
        rfb.scaleViewport = true;
        rfb.addEventListener('connect', () => !cancelled && setStage('ready'));
        rfb.addEventListener('disconnect', () => {
          if (!cancelled) {
            setError('원격 브라우저 연결이 끊어졌습니다. 다시 시도해주세요.');
            setStage('error');
          }
        });
        rfbRef.current = rfb;
      } catch (err) {
        if (!cancelled) {
          setError(err.message || '원격 브라우저를 시작하지 못했습니다.');
          setStage('error');
        }
      }
    })();

    return () => {
      cancelled = true;
      rfbRef.current?.disconnect();
      // 저장(finish)이나 명시적 취소로 이미 정리된 캡처는 서버에 없으니 실패해도 무시한다.
      if (captureIdRef.current) api.cancelSessionCapture(captureIdRef.current).catch(() => {});
    };
  }, [urlId]);

  const handleSave = async () => {
    if (!captureIdRef.current && !storageStateRef.current) return;
    setStage('saving');
    setError('');
    try {
      if (!storageStateRef.current) {
        const { storageState } = await api.finishSessionCapture(captureIdRef.current);
        storageStateRef.current = storageState;
        captureIdRef.current = null; // 이미 서버에서 정리됨 — 언마운트 시 cancel 재호출 방지
      }
      await api.saveTestSession(urlId, storageStateRef.current);
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message || '세션 저장에 실패했습니다.');
      setStage('ready');
    }
  };

  const info = STAGE[stage];

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-white rounded-2xl shadow-xl max-w-3xl w-full flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="소셜 로그인 세션 캡처"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 flex-shrink-0">
          <div>
            <h2 className="font-bold text-slate-900">소셜 로그인으로 세션 저장하기</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              아래 화면에서 직접 로그인한 뒤, "로그인 완료" 버튼을 눌러주세요.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 rounded-full min-w-[36px] min-h-[36px] flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-brand-400"
            aria-label="닫기"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-4">
          <div className="relative bg-slate-950 rounded-xl overflow-hidden aspect-[16/10] flex items-center justify-center">
            <div ref={screenRef} className="w-full h-full [&_canvas]:w-full [&_canvas]:h-full" />
            {stage !== 'ready' && stage !== 'saving' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950 text-slate-300">
                {info.icon && <info.icon size={28} className={info.spin ? 'animate-spin' : ''} />}
                <p className="text-sm">{stage === 'error' ? error : info.text}</p>
              </div>
            )}
          </div>

          {error && stage !== 'error' && <p className="text-xs text-red-600 mt-3">{error}</p>}

          <div className="flex items-center justify-between mt-4">
            <p className="text-xs text-slate-400">
              이 창은 여러분만 볼 수 있는 임시 원격 브라우저입니다. 15분 동안 사용하지 않으면 자동으로 닫힙니다.
            </p>
            <button
              onClick={handleSave}
              disabled={stage !== 'ready'}
              className="flex-shrink-0 flex items-center gap-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold px-5 py-2.5 rounded-xl"
            >
              {stage === 'saving' ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
              로그인 완료했어요, 저장하기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
