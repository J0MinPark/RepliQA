import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import LegalModal from './LegalModal';

const PLAN_LABEL = { free: 'Free (베타)' };

function SectionLabel({ children }) {
  return <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-3">{children}</h3>;
}

export default function SettingsModal({ onClose }) {
  const { user, logout } = useAuth();
  const [tenant, setTenant] = useState(null);
  const [legalModal, setLegalModal] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    api.me().then(setTenant).catch(() => {});
  }, []);

  const handleDeleteAccount = async () => {
    setDeleting(true);
    setDeleteError('');
    try {
      await api.deleteAccount();
      await logout();
    } catch (err) {
      setDeleteError(err.message || '계정 삭제에 실패했습니다.');
      setDeleting(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50"
        onClick={onClose}
        role="presentation"
      >
        <div
          className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[85vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="설정"
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 flex-shrink-0">
            <h2 className="font-bold text-slate-900">설정</h2>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-700 rounded-full min-w-[36px] min-h-[36px] flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-brand-400"
              aria-label="닫기"
            >
              <X size={18} />
            </button>
          </div>

          <div className="px-6 overflow-y-auto divide-y divide-slate-100">
            <section className="py-6">
              <SectionLabel>프로필</SectionLabel>
              <p className="text-sm text-slate-700 font-medium">{user?.email}</p>
              <p className="text-xs text-slate-400 mt-1">
                {user?.emailVerified ? '이메일 인증됨' : '이메일 인증이 필요합니다 (대시보드 상단 배너 참고)'}
              </p>
            </section>

            <section className="py-6">
              <SectionLabel>요금제</SectionLabel>
              <p className="text-sm text-slate-700 font-medium">
                현재 플랜: {tenant ? PLAN_LABEL[tenant.plan] || tenant.plan : '불러오는 중…'}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                일일 실행 한도 {tenant?.quota?.maxRunsPerDay ?? '-'}건 · 유료 플랜은 아직 준비 중입니다.
              </p>
            </section>

            <section className="py-6">
              <SectionLabel>개인정보</SectionLabel>
              <div className="flex flex-col items-start gap-2">
                <button onClick={() => setLegalModal('terms')} className="text-sm text-brand-600 hover:underline">
                  이용약관
                </button>
                <button onClick={() => setLegalModal('privacy')} className="text-sm text-brand-600 hover:underline">
                  개인정보처리방침
                </button>
              </div>
            </section>

            <section className="py-6">
              <SectionLabel>위험 구역</SectionLabel>
              <div className="border border-red-200 bg-red-50 rounded-xl p-4">
                <p className="text-sm font-bold text-red-800">계정 삭제</p>
                <p className="text-xs text-red-700 mt-1 leading-relaxed">
                  등록된 URL, 여정, 테스트 기록, 저장된 로그인/결제 테스트 정보가 모두 영구적으로 삭제되며
                  되돌릴 수 없습니다.
                </p>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="mt-3 text-sm font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg px-4 py-2"
                >
                  계정 삭제
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>

      <LegalModal type={legalModal} onClose={() => setLegalModal(null)} />

      {showDeleteConfirm && (
        <div
          className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50"
          onClick={() => !deleting && setShowDeleteConfirm(false)}
          role="presentation"
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6"
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-label="계정 삭제 확인"
          >
            <h2 className="font-bold text-slate-900 mb-2">정말 계정을 삭제할까요?</h2>
            <p className="text-sm text-slate-600 mb-4">
              등록된 URL, 여정, 테스트 기록, 저장된 로그인/결제 테스트 정보가 모두 영구적으로 삭제되며
              되돌릴 수 없습니다.
            </p>
            {deleteError && <p className="text-sm text-red-600 mb-4">{deleteError}</p>}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-60"
              >
                취소
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleting}
                className="px-4 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-60"
              >
                {deleting ? '삭제 중…' : '영구 삭제'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
