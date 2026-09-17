// Checklist knowledge, not model training or a claim of complete site coverage.
export const catalogVersion='2026-09-17.1';
export const catalog=[
  {id:'page-http',title:'페이지 응답',mode:'basic',detail:'현재 페이지의 HTTP 응답 상태'},
  {id:'page-content',title:'페이지 내용 표시',mode:'basic',detail:'빈 화면·로딩 표시 후보. 내용의 업무 적합성은 별도'},
  {id:'page-title',title:'페이지 제목',mode:'basic',detail:'제목의 존재 여부. 문구의 업무 적합성은 별도'},
  {id:'page-language',title:'문서 언어',mode:'basic',detail:'lang 속성 존재 여부'},
  {id:'image-load',title:'화면의 이미지 로딩',mode:'basic',detail:'보이는 이미지의 로딩 상태. 지연 로딩은 확인 불가로 구분'},
  {id:'control-label',title:'입력·버튼의 이름',mode:'basic',detail:'이름 없는 컨트롤 후보. 전체 접근성 적합성 검사는 아님'},
  {id:'link-markup',title:'링크 대상',mode:'basic',detail:'비어 있는 링크 후보. 링크 방문과 업무 결과는 여정으로 지정'},
  {id:'layout-desktop',title:'데스크톱 가로 넘침',mode:'basic',detail:'1280px 화면에서 넘침 후보 확인'},
  {id:'layout-mobile',title:'모바일 가로 넘침',mode:'basic',detail:'390px 화면 표본. 실제 모바일 기기 검사는 아님'},
  {id:'scroll',title:'위·아래 스크롤',mode:'basic',detail:'문서 또는 주 스크롤 영역을 한 번 이동. 무한 목록 전체는 미검사'},
  {id:'runtime',title:'브라우저 오류 신호',mode:'basic',detail:'발생한 JavaScript 오류는 기능 영향 검토 후보'},
  {id:'accessibility-auto',title:'접근성 자동 규칙',mode:'basic',detail:'axe-core의 WCAG A/AA 자동 규칙 표본. iframe·보조기기·전체 적합성은 별도'},
  {id:'assertions',title:'단계별 상태·부정 조건',mode:'journey',detail:'문구·입력값·체크·활성·보임·숨김·개수·경로 검증. CSS 대상과 정답 필요'},
  {id:'outcome',title:'최종 경로·문구',mode:'journey',detail:'고객이 정한 정상 결과와 비교'},
  {id:'state-change',title:'동작 전후 결과 변경',mode:'journey',detail:'결과 영역을 지정하고 변경 확인을 선택'},
  {id:'history',title:'뒤로·앞으로 이동',mode:'journey',detail:'각 이동의 도착 경로 지정. 데이터 복원은 별도 기대 문구 필요'},
  {id:'reload',title:'새로 고침',mode:'journey',detail:'새로 고침 후 경로와 최종 화면 확인'},
  {id:'controls',title:'클릭·입력·선택·체크',mode:'journey',detail:'지정한 대상만 실행. 클릭 성공만으로 업무 성공을 판정하지 않음'},
  {id:'keyboard',title:'키보드·호버',mode:'journey',detail:'Tab·Shift+Tab·Escape·호버 지원. 초점 순서 전체는 별도 검토'},
  {id:'validation',title:'필수값·경계값·잘못된 입력',mode:'configured',detail:'정상·비정상 데이터와 오류 문구를 각각 여정으로 지정'},
  {id:'search',title:'검색·필터·정렬·페이지 이동',mode:'configured',detail:'대상과 정답 데이터 필요. 검색 결과의 의미를 자동 추측하지 않음'},
  {id:'persistence',title:'생성·수정·저장 유지',mode:'configured',detail:'재조회 또는 새로 고침 후 저장된 값 확인. DB 검증은 별도 연동'},
  {id:'auth',title:'로그인·로그아웃·권한·세션 만료',mode:'configured',detail:'합성 테스트 계정과 권한별 정답 필요'},
  {id:'dialog',title:'모달·새 창·취소',mode:'configured',detail:'DOM 모달과 같은 사이트 새 창은 여정 지원. 여러 창·native dialog는 별도'},
  {id:'upload',title:'파일 업로드·다운로드',mode:'manual',detail:'현재 클라우드 실행 동작 미지원'},
  {id:'accessibility',title:'접근성 전체·보조기기',mode:'manual',detail:'키보드 전 과정·스크린리더·WCAG 전문 평가'},
  {id:'visual',title:'디자인 회귀·기준 이미지',mode:'manual',detail:'데스크톱 지원 범위. 현재 클라우드 기본 점검에 포함되지 않음'},
  {id:'security',title:'보안·서버 권한·개인정보',mode:'manual',detail:'별도 범위와 환경에서 전문 보안 검사'},
  {id:'performance',title:'부하·장애 복구·중복 처리',mode:'manual',detail:'별도 부하 환경·정답·시간 기준 필요'},
  {id:'browsers',title:'다중 브라우저·실기기',mode:'manual',detail:'현재 클라우드 Chromium 외 환경은 미검사'},
];
export function coverageFor(job,checks,steps){
  const measured=new Set(checks.map(c=>c.catalogId).filter(Boolean));
  const executed=steps.filter(s=>s.status==='passed');
  const actionGroups={history:['back','forward'],reload:['reload'],controls:['click','fill','select','check','uncheck'],keyboard:['press','hover']};
  const items=catalog.map(item=>{const found=checks.filter(c=>c.catalogId===item.id);const performed=executed.filter(s=>actionGroups[item.id]?.includes(s.action));return {...item,status:found.length?(found.some(c=>c.status==='failed')?'failed':found.some(c=>c.status==='inconclusive')?'inconclusive':found.some(c=>c.status==='review')?'review':found.every(c=>c.status==='not_applicable')?'not_applicable':'checked'):performed.length?'executed':'not_tested'};});
  return {catalogVersion,wholeSiteVerified:false,plannedSteps:job.steps.length,completedSteps:executed.length,checkedCategories:measured.size,items,note:'검사한 화면과 지정 조건에 한정합니다. 미검사 항목은 통과가 아니며, 동작 실행은 업무 결과 검증과 다릅니다.'};
}
