// WebArena 공식 태스크셋(config_files/test.raw.json, 812개)에서 이번 1차 벤치마크에 쓸
// 40개 서브셋을 뽑아 tasks.subset.json에 저장한다. 재현을 위해 선정 기준을 코드로 남겨둔다.
//
// 제외 기준:
// - sites가 2개 이상인 크로스사이트 태스크: shopping_admin/reddit만 로컬에 띄웠으므로 제외
//   (wikipedia는 ~180GB, map은 1TB 백엔드가 필요해 로컬 셋업 범위 밖 — README 참고)
// - eval_types에 string_match가 있는 태스크: WebArena는 에이전트가 마지막에 "stop" 액션으로
//   낸 자유 텍스트 답변을 채점하는데, RepliQA 체크포인트는 아직 "최종 답변을 명시적으로
//   말하기"라는 액션이 없다 — 억지로 끼워맞추기보다 이번 1차에서는 제외하고, RepliQA에
//   final_answer류 체크포인트 타입을 추가할지는 별도 결정 사항으로 남긴다.
// - program_html의 url/locator가 "func:" 헬퍼를 쓰는 태스크: WebArena 자체 헬퍼 함수
//   (예: 방금 만든 주문의 URL을 Magento REST API로 조회)가 있어야 채점 가능한데, 이번
//   1차 하네스는 그 헬퍼들을 포팅하지 않았다.
//
// 선정 방식: intent_template_id별로 라운드로빈으로 골라서 같은 템플릿의 변형만 잔뜩 뽑히는
// 걸 피하고, 실제 태스크 다양성을 확보한다.

const fs = require('fs');
const path = require('path');

const TEST_RAW_JSON_PATH = process.argv[2];
if (!TEST_RAW_JSON_PATH) {
  console.error('사용법: node selectTasks.js <WebArena test.raw.json 경로>');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(TEST_RAW_JSON_PATH, 'utf-8'));

function usesFuncHelper(t) {
  if ((t.eval.reference_url || '').includes('func:')) return true;
  for (const p of t.eval.program_html || []) {
    if ((p.url || '').startsWith('func')) return true;
    if ((p.locator || '').startsWith('func:')) return true;
  }
  return false;
}

function pickDiverse(tasks, n) {
  const byTemplate = {};
  for (const t of tasks) {
    (byTemplate[t.intent_template_id] = byTemplate[t.intent_template_id] || []).push(t);
  }
  const templateIds = Object.keys(byTemplate).sort((a, b) => a - b);
  const picked = [];
  let round = 0;
  while (picked.length < n) {
    let addedThisRound = false;
    for (const tid of templateIds) {
      if (picked.length >= n) break;
      if (byTemplate[tid][round]) {
        picked.push(byTemplate[tid][round]);
        addedThisRound = true;
      }
    }
    if (!addedThisRound) break;
    round++;
  }
  return picked;
}

const clean = data.filter(
  (t) => t.sites.length === 1 && (t.sites[0] === 'shopping_admin' || t.sites[0] === 'reddit')
    && !t.eval.eval_types.includes('string_match') && !usesFuncHelper(t)
);

const bySite = { shopping_admin: [], reddit: [] };
for (const t of clean) bySite[t.sites[0]].push(t);

const finalSubset = [...pickDiverse(bySite.shopping_admin, 25), ...pickDiverse(bySite.reddit, 15)];

fs.writeFileSync(path.join(__dirname, 'tasks.subset.json'), JSON.stringify(finalSubset, null, 2));
console.log(`선정 완료: shopping_admin ${finalSubset.filter((t) => t.sites[0] === 'shopping_admin').length}개, reddit ${finalSubset.filter((t) => t.sites[0] === 'reddit').length}개, 총 ${finalSubset.length}개 → tasks.subset.json`);
