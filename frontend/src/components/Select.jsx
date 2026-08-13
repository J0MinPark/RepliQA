import React from 'react';
import { ChevronDown } from 'lucide-react';

// 브라우저 기본 select 화살표는 테두리에 바짝 붙어서 어색해 보인다 — appearance-none으로
// 지우고, 위치를 직접 지정한 화살표로 교체한다. 앱 전체에서 select를 이 컴포넌트로 통일해서
// 패딩·화살표 위치가 제각각이 되는 걸 막는다.
export default function Select({ className = '', ...props }) {
  return (
    <div className="relative">
      <select
        {...props}
        className={`w-full appearance-none border border-slate-200 rounded-xl pl-4 pr-10 py-3 bg-slate-50 outline-none focus:ring-2 focus:ring-brand-500 text-sm text-slate-900 disabled:opacity-50 ${className}`}
      />
      <ChevronDown
        size={16}
        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
      />
    </div>
  );
}
