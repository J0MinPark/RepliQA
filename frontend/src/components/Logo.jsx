import React from 'react';

// 자체 제작 마크 — 렌즈(비전 LLM이 화면을 "본다") 안에 조준선 형태의 동공을 넣어 "정밀하게
// 관찰해서 검증한다"는 제품 정체성을 담았다. 그라디언트나 기성 아이콘 라이브러리를 쓰지 않고
// 단색 도형만으로 구성.
function Mark({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2 12C2 12 7 4.5 12 4.5C17 4.5 22 12 22 12C22 12 17 19.5 12 19.5C7 19.5 2 12 2 12Z"
        stroke="white"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3.1" stroke="white" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="0.9" fill="white" />
    </svg>
  );
}

export default function Logo({ showBeta = true, className = '' }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="bg-brand-600 p-1.5 rounded-lg flex items-center justify-center">
        <Mark size={20} />
      </div>
      <span className="text-xl font-extrabold tracking-tight text-slate-900">
        RepliQA
        {showBeta && (
          <span className="text-xs uppercase font-bold text-brand-700 bg-brand-50 px-2 py-1 rounded-full ml-1.5 align-middle">
            Beta
          </span>
        )}
      </span>
    </div>
  );
}
