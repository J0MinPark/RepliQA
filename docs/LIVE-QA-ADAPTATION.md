# RepliQA 0.2.6 실행 개선과 실사이트 검증

후속 0.2.7 중계 개선과 실제 클라우드 검증은 [새 보고서](NETWORK-RELAY.md)를 참조한다. 아래는 0.2.6 당시 기록이다.

2026-09-18. **개발 후보 0.2.6이며 운영은 0.2.5를 유지한다.** 실제 기업 사이트의 로컬 여정은 개선했지만, Cloudflare 무료 Worker에서 자원이 많은 사이트를 검사하는 문제는 해결하지 못했다. 이를 배포 성공이나 범용 QA 정확도 입증으로 표시하지 않는다.

## 구현에 반영한 내용

| 참고 방식 / 실측 문제 | 수정 파일 | 검증 |
|---|---|---|
| Playwright MCP의 관측된 요소 참조와 재관측 방식. Next.js 뒤로 이동 후 숨겨진 이전 페이지 h1이 남음 | `cloud/src/outcomes.mjs`, `assertions.mjs` | 현재 렌더링된 유일한 결과 영역을 선택. 기대 문구를 보고 후보를 고르지 않음. 보이는 두 후보는 inconclusive, 숨은 기대값과 보이는 오답은 failed |
| browser-use 기반 에이전트의 반복 관측 원리. 렌더링 전 텍스트 fallback이 늦게 생긴 역할·이름을 찾지 못함 | `cloud/src/actions.mjs` | 후보가 없거나 복수이면 의미 기반 탐색을 다시 수행. 실제 클릭은 한 번만 수행. 지연된 aria-label 버튼과 복수 버튼의 정상·거부 시험 |
| 실제 Cloudflare Browser에서 URL은 바뀌었지만 과거 DOMContentLoaded 이벤트를 기다리다 시간 초과 | `cloud/src/actions.mjs` | history commit 이후 현재 document.readyState와 도착 경로를 확인. SPA back/forward를 실제 브라우저에서 검증. 이동 자체를 다시 실행하지 않음 |
| 브라우저 종료가 정책 차단과 같은 카운터에 집계될 수 있음 | `cloud/src/target-guard.mjs`, `runner.mjs` | 정책 차단·실행 중 네트워크 실패·종료 취소 분리. 기존 차단은 종료로 지우지 않음. 오류가 남으면 다음 쓰기 중단 유지 |
| 실제 배포 Worker의 하위 요청 제한 | `cloud/src/target-guard.mjs` | 25ms 동안 모인 동시 DNS 조회만 공유. 완료된 DNS 응답은 캐시하지 않음. 40개 동시 자원에서 A/AAAA 조회 2회, 이후 사설 IP로 변경하면 재조회·차단. **이 최적화만으로 무료 Worker의 실사이트 제한은 해결되지 않음** |

참고 원본은 [Playwright MCP 클릭 테스트](https://github.com/microsoft/playwright-mcp/blob/ea43eee0d95196ab31f7619b26f78d7b9c664286/tests/click.spec.ts), [jimmytoan 실행기](https://github.com/jimmytoan/qa-agent/blob/5be0169a6bbebd334c59fda068bf8025cd2c18bc/backend/app/services/runner.py)와 사용자가 제공한 Webnori 플러그인 설계다. 위 수정은 RepliQA에서 독립 구현했다. AGPL 코드를 Apache 제품에 복사하지 않았으며, 외부 QA 사이트를 런타임에 연결하지 않았다. 전체 자율 계획·시각 회귀·API 검증 기능을 이번에 구현한 것은 아니다.

## 동일 기업 사이트 계약 재실행

[실행별 단계·판정·스크린샷 HTML](LIVE-QA-ADAPTATION-REPORT.html), [원본 비교 JSON](evidence/live-adaptation/real-sites.json).

RTX 4060 서버의 로컬 Chromium에서 동일 URL·허용 호스트·기대 결과를 유지하고 3회씩 반복했다. 비교 도구가 기존 계약과 새 계약의 완전 일치 및 현재 소스 해시를 확인한다.

| 여정 | 0.2.5 최초 관측 | 0.2.6 최종 3회 |
|---|---|---|
| GitHub Docs | 9/9 passed | 매회 9/9 passed |
| Next.js Docs | 8/9 inconclusive — 숨은 h1 중복 | 매회 9/9 passed |
| Cloudflare Docs | 2/9 inconclusive — 미등록 외부 호스트 | 매회 2/9 inconclusive — 미해결 |

기본 검사는 세 사이트 모두 접근성 후보·미완료 항목이 있어 inconclusive다. 이를 통과로 바꾸지 않았다. 전체 18회 실행 중 6회 passed, 12회 inconclusive이며 이 비율을 정확도로 해석하지 않는다. 이전 결과는 과거 관측이므로 동시 통제 실험도 아니다. 사이트 전체 결함의 독립 정답이나 경쟁 제품의 동일 조건 측정은 없다.

## 실제 클라우드에서 새로 확인한 병목

로컬 workerd + 원격 Browser 경로에서는 GitHub 여정이 통과했지만 Next.js는 이동·초기 로드 시간 초과가 발생했다. 이 경로의 중계 연결 오류와 남은 브라우저 세션도 확인해 정리했다. 이 결과는 실제 배포 Worker의 통과를 뜻하지 않는다.

별도로 인증을 요구하는 임시 Worker를 실제 배포하고 같은 엔진·계약을 실행했다. GitHub에서 `Too many subrequests by single Worker invocation`을 재현했다. DNS 중복 조회를 줄인 뒤에도 반복됐으며 마지막 관측은 1단계 완료 후 inconclusive였다. Next.js의 초기 원격 시도에는 Browser 획득 429도 있었으므로 실제 배포 Worker에서 Next.js 여정 통과를 주장하지 않는다.

[공식 Workers 제한](https://developers.cloudflare.com/workers/platform/limits/#subrequests)은 Free의 invocation당 subrequest 한도를 50으로 명시한다. 현재 보호 경로는 DNS 검사와 자원 중계를 한 Worker 호출에서 수행하므로 작은 합성 화면에서의 성공을 자원이 많은 실사이트로 일반화할 수 없다. 단순 제한 시간 증가나 DOM 선택자 수정으로 해결되는 문제가 아니다.

근거: [최초 원격 실행](evidence/live-adaptation/cloud-worker-first.json), [하위 요청 한도 오류](evidence/live-adaptation/cloud-worker-subrequest-limit.json), [최종 원격 GitHub 결과](evidence/live-adaptation/cloud-worker-final-github.json), [정리 확인](evidence/live-adaptation/cleanup.json). 테스트용 Worker 삭제를 API 404로 확인했고 활성 브라우저 세션은 0이다. 계정 브라우저 누적 사용은 225.042초였다. 유료 플랜·외부 AI·운영 고객 예약은 사용하지 않았다.

## 검증 상태와 남은 작업

- `npm test --prefix cloud`: 최종 소스에서 39개 통과. 내부망·혼합 DNS·변경 DNS·리디렉션·WebSocket 차단, 격리·취소·삭제 검사를 포함한다.
- `npm run build --prefix cloud`: 성공. [55개 사례 × 2엔진 × 2회 = 220회](evidence/live-adaptation/regression.json)가 제안 정답과 일치했고 [소스 일치 gate](evidence/live-adaptation/gate.json)를 통과했다. 이 작성자 기반 회귀 세트의 오탐·미탐 0건을 실제 서비스 정확도 100%로 일반화하지 않는다.
- 새 소스에 맞춰 같은 28개 외부 검토 제안을 `evaluation/review-packs/20260918-v4`에 다시 고정했다. v1~v3는 이전 소스의 이력이며 새 독립 평가를 추가 완료한 것이 아니다. 검토자는 여전히 모집 전이다.
- 실사이트 최초 관측, 실패한 클라우드 시도, 변경 전후 소스 해시를 보존한다. 중간에 소스 변경 때문에 중단한 회귀 실행은 ABORTED이며 완료된 검증으로 세지 않는다.

다음 구현은 **브라우저 실행과 안전한 네트워크 중계의 배치 구조**다. 자원이 많은 한 페이지와 여러 페이지 여정을 무료 실행 한도 안에서 처리하면서, 재시도 시 클릭 중복·테넌트 혼합·내부망 접근을 막는 구조를 먼저 검증해야 한다. 그 다음에 탐색·계획 자동화를 확대한다. 현재 수정본을 운영에 올려 이 구조 문제가 해결됐다고 안내하지 않는다.
