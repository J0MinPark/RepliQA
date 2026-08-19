# WebArena 벤치마크 하네스

RepliQA의 액션 실행 루프(LLM이 스크린샷을 보고 다음 행동을 정하는 부분)가 실제로 얼마나
신뢰할 수 있는지를, 우리가 직접 만든 잣대가 아니라 [WebArena](https://webarena.dev/)
(ICLR 2024)의 공식 태스크·채점 기준으로 측정한다.

## 왜 이렇게 설계했나

- **결정론적 검증 계층(`checkpoint.verify`)이 아니라 액션 실행 자체를 측정한다.** RepliQA의
  다른 부분(검증 태그, JUnit 리포터 등)은 이미 결정론적이거나 기존 QA 툴을 모방한 인프라다.
  아직 확률적인 부분은 "다음에 뭘 클릭할지 LLM이 매 스텝 정하는" 액션 루프 자체이고, 이게
  바로 WebArena가 측정하도록 설계된 것이다.
- **채점은 RepliQA를 신뢰하지 않는다.** `runBenchmark.js`는 RepliQA 엔진(`runTest`)이 자체
  판단한 성공/실패나 `generateReport`의 severity를 전혀 쓰지 않는다. 매 태스크가 끝나면
  완전히 새로운 브라우저 세션을 열어서 WebArena 공식 채점 알고리즘
  (`evaluation_harness/evaluators.py`의 URLEvaluator/HTMLContentEvaluator를 그대로 이식한
  `evalWebArena.js`)으로 독립적으로 다시 확인한다.
- **`allowPrivateTargets`**: WebArena 사이트는 로컬 Docker(`localhost`)에 뜨는데, RepliQA의
  프로덕션 SSRF 가드(`src/security/ssrfGuard.js`)는 사설 IP/localhost를 항상 차단한다(SaaS가
  사용자 URL을 직접 열람하는 구조라 내부망 공격을 막기 위함 — 이 정책은 건드리지 않았다).
  `runTest()`에 `allowPrivateTargets: true`를 넘기면 이 벤치마크 스크립트에서만 그 정책을
  우회한다. 공개 API(`POST /api/test-runs`)나 워커 경로에서는 이 옵션이 절대 노출되지 않는다
  — `testRuns.js`/`worker.js` 어디에도 이 필드를 넘기는 코드가 없다.

## 범위(1차 서브셋)

WebArena 전체는 812개 태스크·6개 사이트(shopping/shopping_admin/reddit/gitlab/wikipedia/map)
로 구성되지만, 이번 1차는 **shopping_admin(Magento 어드민) + reddit(Postmill 포럼) 두
사이트, 40개 태스크**로 시작한다.

- **wikipedia(~180GB)/map(1TB 백엔드 필요)는 로컬 Docker 셋업 범위 밖이라 제외했다.**
- **`string_match` 평가 태스크(99개)는 이번 서브셋에서 제외했다.** WebArena는 에이전트가
  마지막에 "stop" 액션으로 낸 자유 텍스트 답변을 채점하는데, RepliQA 체크포인트는 아직
  "최종 답변을 명시적으로 말하기"라는 액션이 없다 — 억지로 끼워맞추기보다 제외하고, 필요하면
  나중에 `final_answer` 체크포인트 타입을 추가할지 별도로 결정한다.
- **`program_html`의 url/locator가 WebArena 자체 헬퍼 함수(`func:` 접두사 — 예: 방금 만든
  주문 URL을 Magento REST API로 조회)를 쓰는 태스크도 제외했다.** 이 헬퍼들은 포팅하지 않았다.
- 선정 기준과 재현 방법은 `selectTasks.js`에 코드로 남아 있다.

이 범위 조정은 `tasks.subset.json`을 만든 시점의 판단이고, 사이트를 더 추가하거나
`string_match`용 `final_answer` 체크포인트를 만들면 서브셋을 넓힐 수 있다.

## 1. Docker로 사이트 띄우기 (최초 1회)

이미지 다운로드는 각 사이트 README(`environment_docker/README.md`)의 3개 미러(Google
Drive/Archive.org/CMU 직접 서버) 중 하나를 쓴다 — CMU 서버가 연결이 자주 끊기고 대용량
전송 중 조용히 멈추는(stall) 경우가 있어서, 재시도(`--retry-all-errors`)와 정체 감지
(`--speed-limit`/`--speed-time`)를 반드시 같이 켜야 한다:

```bash
curl -o shopping_admin_final_0719.tar -C - -L \
  --retry 30 --retry-delay 3 --retry-all-errors --connect-timeout 15 \
  --speed-limit 2000 --speed-time 20 \
  "http://metis.lti.cs.cmu.edu/webarena-images/shopping_admin_final_0719.tar"
curl -o postmill-populated-exposed-withimg.tar -C - -L \
  --retry 30 --retry-delay 3 --retry-all-errors --connect-timeout 15 \
  --speed-limit 2000 --speed-time 20 \
  "http://metis.lti.cs.cmu.edu/webarena-images/postmill-populated-exposed-withimg.tar"
```

`docker load`/`docker run`/Magento base URL 재설정(빌드 시점 URL이 DB에 박혀 있어 실제 띄운
위치로 다시 맞춰야 함)은 `setupDocker.js`가 대신 해준다:

```bash
node scripts/webarena-bench/setupDocker.js <두 .tar 파일이 있는 디렉터리>
```

forum(reddit)은 추가 설정 없이 `http://localhost:9999/`에서, shopping_admin은
`http://localhost:7780/admin`에서 바로 접근 가능하다.

## 2. 로그인 세션 캡처

```bash
npm run webarena:login
```

`.auth/shopping_admin_state.json`, `.auth/reddit_state.json`을 생성한다(WebArena 공식
`browser_env/auto_login.py`와 동일한 계정·플로우 — `env_config.py`에 공개된 데모 샌드박스
전용 테스트 계정이고 실제 사용자 정보가 아니다).

## 3. 벤치마크 실행

```bash
npm run webarena:bench
```

`GEMINI_API_KEY`가 설정된 `.env`가 필요하다(RepliQA 엔진이 액션을 정할 때 그대로 씀 —
기존 프로덕션 경로와 동일한 모델). 결과는 `results/run-<timestamp>.json`에 태스크별 상세
기록(최종 URL, 점수, RepliQA 자체 판단과의 비교용 severity)과 함께 저장되고, 콘솔에
사이트별 Success Rate가 출력된다.

## 알려진 한계

- Docker 이미지 크기 때문에 gitlab/shopping(고객용)은 이번 라운드에 포함하지 않았다.
- `program_html`의 `func:` 헬퍼(사이트별 REST API 조회)는 포팅하지 않아 해당 태스크는
  서브셋에서 아예 제외됐다 — WebArena 전체 대비 커버리지가 100%가 아니라는 뜻이다.
- 매 실행마다 사이트 DB 상태가 누적된다(WebArena 태스크 중 일부는 `require_reset: false`라
  누적 상태에 영향받지 않지만, 여러 번 돌리기 전에 컨테이너를 재시작해 초기 상태로 되돌리는
  걸 권장 — `docker stop/rm` 후 `docker run`으로 재생성).
