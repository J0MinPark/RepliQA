import React from 'react';
import { X } from 'lucide-react';

// CBT(비공개 베타) 단계 기준 초안 — 정식 유료 서비스 전환 전 변호사 검토가 필요하다.
// 실제로 수집·처리하는 데이터(등록 URL, 캡처 스크린샷, 암호화된 테스트 계정 자격증명,
// Gemini/OpenRouter로의 전송 등)를 코드베이스 기준으로 정확히 반영해 작성했다.
//
// 조항별로 구조화된 데이터로 관리한다 — 문단을 하나의 긴 pre-wrap 문자열로 두면 소스 코드
// 가독성을 위해 넣은 줄바꿈이 그대로 화면에 문단 구분으로 보여서 문장이 뚝뚝 끊긴 것처럼
// 읽힌다. <p>/<li>로 나눠서 렌더링하면 문장은 항상 자연스럽게 이어지고, 줄바꿈은 실제
// 문단이 바뀌는 지점에서만 생긴다.
const TERMS_SECTIONS = [
  {
    heading: '제1조 (목적)',
    paragraphs: [
      '본 약관은 RepliQA(이하 "회사")가 제공하는 비전 LLM 기반 웹 QA 자동화 서비스(이하 "서비스")의 이용 조건과 절차, 회사와 이용자의 권리·의무를 정합니다.',
      '서비스는 현재 비공개 베타(CBT) 단계로, 일부 기능이 사전 고지 없이 변경되거나 중단될 수 있습니다.',
    ],
  },
  {
    heading: '제2조 (이용자의 의무)',
    items: [
      '이용자는 본인이 소유했거나 테스트 권한을 정당하게 보유한 URL만 서비스에 등록해야 합니다.',
      '이용자는 서비스를 이용해 실제 금전 거래(결제 확정, 주문 확정 등)를 유발하는 행위를 시도해서는 안 됩니다. 서비스는 결제 관련 체크포인트에서 최종 제출 동작을 자동으로 회피하도록 설계되어 있으나, 이는 안전장치일 뿐 이용자의 책임을 대신하지 않습니다.',
      '이용자는 타인의 계정, API 키를 무단으로 사용하거나 서비스를 불법적인 목적으로 이용해서는 안 됩니다.',
    ],
  },
  {
    heading: '제3조 (서비스의 특성 및 면책)',
    items: [
      '서비스는 AI 에이전트가 화면을 인지하여 자동으로 행동하는 방식으로 동작하며, 그 결과(버그 탐지, 수정 제안 등)의 완전한 정확성을 보장하지 않습니다. 최종 판단과 코드 반영 여부는 이용자의 책임입니다.',
      '회사는 천재지변, 인프라 제공업체(Firebase, Vercel, Render, Supabase 등)의 장애 등 회사의 합리적 통제 범위를 벗어난 사유로 인한 서비스 중단에 대해 책임을 지지 않습니다.',
    ],
  },
  {
    heading: '제4조 (계정 해지)',
    items: [
      '이용자는 언제든지 대시보드 또는 고객 문의를 통해 탈퇴를 요청할 수 있으며, 요청 시 계정과 관련 데이터가 삭제됩니다.',
      '회사는 이용자가 본 약관을 위반한 경우 사전 통지 후 서비스 이용을 제한할 수 있습니다.',
    ],
  },
  {
    heading: '제5조 (지식재산권)',
    paragraphs: [
      '서비스 이용 중 생성되는 리포트·수정 제안 텍스트의 이용 권한은 해당 결과를 생성한 이용자에게 있습니다. 서비스 자체(엔진, UI, 상표 등)에 대한 권리는 회사에 있습니다.',
    ],
  },
  {
    heading: '제6조 (준거법)',
    paragraphs: ['본 약관은 대한민국 법령에 따라 해석됩니다.'],
  },
  {
    heading: '부칙',
    paragraphs: ['본 약관은 CBT 참여자 대상 초안이며, 정식 서비스 전환 시 개정될 수 있습니다.'],
    note: true,
  },
];

const PRIVACY_SECTIONS = [
  {
    paragraphs: ['RepliQA는 서비스 제공을 위해 아래와 같이 최소한의 정보를 수집·처리합니다.'],
  },
  {
    heading: '1. 수집하는 정보',
    items: [
      '계정 정보: 이메일, 비밀번호(Firebase Authentication을 통해 해시로만 저장되며 회사는 평문 비밀번호에 접근할 수 없습니다)',
      'API 키: MCP(코딩 에이전트 연동) 사용 시 발급되는 키로, 해시로만 저장됩니다.',
      '테스트 대상 정보: 이용자가 등록한 URL, 여정(체크포인트) 설정',
      '테스트 실행 데이터: 실행 중 캡처되는 화면 스크린샷, 클릭·입력 등의 행동 로그, 발생한 에러 로그',
      '(선택) 로그인 테스트용 계정 자격증명: 이용자가 직접 입력한 경우에만 수집되며, 저장 전 암호화되어 회사 직원도 평문으로 열람할 수 없습니다.',
    ],
  },
  {
    heading: '2. 이용 목적',
    items: [
      'QA 자동화 실행 및 결과 리포트 생성',
      '계정 관리, 남용 방지(일일 실행 한도 등 사용량 관리)',
      '서비스 품질 개선(집계된 형태로만 사용, 개별 스크린샷을 마케팅 등 다른 목적으로 사용하지 않음)',
    ],
  },
  {
    heading: '3. 제3자 제공 및 처리 위탁',
    items: [
      'Google Gemini API: 캡처된 화면 스크린샷을 비전 분석(요소 인식, 버그 판단)을 위해 전송합니다.',
      'OpenRouter(UI-TARS): 클릭 좌표 정밀도를 높이기 위해 선택적으로 스크린샷 일부를 전송합니다.',
      '인프라 제공업체: Firebase(인증·데이터베이스), Supabase(스크린샷 저장), Render/Vercel(서버 호스팅)',
    ],
    paragraphs: ['위 각 업체는 서비스 제공을 위한 처리 위탁 목적으로만 데이터를 받으며, 별도 마케팅 목적으로 사용하지 않습니다.'],
  },
  {
    heading: '4. 보관 및 삭제',
    items: [
      '계정 탈퇴 시 대시보드에서 요청하면 계정 정보, 등록 URL, 테스트 기록, 저장된 자격증명이 삭제됩니다.',
      '암호화된 테스트 계정 자격증명은 서비스 제공 목적 외에는 열람되지 않습니다.',
    ],
  },
  {
    heading: '5. 이용자의 권리',
    paragraphs: ['이용자는 언제든 본인 정보의 열람, 정정, 삭제를 요청할 수 있습니다. 대시보드의 탈퇴 기능을 이용하거나 고객 문의 채널로 요청해 주세요.'],
  },
  {
    heading: '6. 문의',
    paragraphs: ['개인정보 관련 문의는 서비스 내 고객 문의 채널을 이용해 주세요.'],
  },
  {
    paragraphs: ['본 방침은 CBT 참여자 대상 초안이며, 정식 서비스 전환 시 개정될 수 있습니다.'],
    note: true,
  },
];

function LegalBody({ sections }) {
  return (
    <div className="space-y-5">
      {sections.map((s, idx) => (
        <section key={idx}>
          {s.heading && <h3 className="font-bold text-slate-800 text-sm mb-2">{s.heading}</h3>}
          <div className={`space-y-2 ${s.note ? 'text-xs text-slate-400' : 'text-sm text-slate-600'} leading-relaxed`}>
            {s.items && (
              <ol className="list-decimal list-outside pl-5 space-y-2 marker:text-slate-400">
                {s.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ol>
            )}
            {s.paragraphs?.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export default function LegalModal({ type, onClose }) {
  if (!type) return null;
  const title = type === 'terms' ? '이용약관' : '개인정보처리방침';
  const sections = type === 'terms' ? TERMS_SECTIONS : PRIVACY_SECTIONS;

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 flex-shrink-0">
          <h2 className="font-bold text-slate-900">{title}</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 rounded-full min-w-[36px] min-h-[36px] flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-brand-400"
            aria-label="닫기"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-6 overflow-y-auto">
          <LegalBody sections={sections} />
        </div>
      </div>
    </div>
  );
}
