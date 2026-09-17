# 무료 브라우저 QA 호스팅 검토

2026-09-18 공식 문서 확인. 이 문서는 비교·설계이며 다른 제공사에 계정을 만들거나 서비스를 배포한 기록이 아니다. 개발·테스트 명령은 RTX 4060 서버에서 수행한다.

## 현재 병목

Cloudflare 무료 브라우저 600초/일 중 재검증 후 26.219초만 사용했다. 현재 하루 4회는 제공사 횟수 제한이 아니라 RepliQA의 보수적인 자체 예산이다. 정식 개선은 제공사 사용량 확인, 실행 중 최악 사용량 예약, 종료 확인을 결합한 시간 예산 방식이다. 단순 평균 시간으로 600초를 나눠 고객 처리량을 약속하지 않는다.

## 후보

| 후보 | 확인한 무료 조건 | RepliQA 관점 |
|---|---|---|
| Cloudflare Browser Run | 계정 전체 10분/일 | 관리형 브라우저와 현재 배포 유지 가능. 트래픽 증가 시 총 브라우저 시간 제한 |
| Render Free | 월 750 인스턴스 시간, 0.1 CPU·512MB, 15분 유휴 후 절전, 기동 약 1분 | 컨테이너에서 Playwright 실행 후보. 메모리·대상별 안정성 측정 필요. 항상 즉시 검사는 충족하지 못함 |
| Oracle Always Free A1 | 현재 문서상 1,500 OCPU 시간·9,000GB 시간/월, 2 OCPU·12GB에 해당 | 브라우저 실행용 VM 후보. ARM 브라우저 지원, 계정/용량 확보, OS 보안 운영 필요. 유휴 자원 회수 가능. 대부분 가입자에게 카드 확인 필요 |
| Koyeb Free | 0.1 vCPU·512MB, 1시간 유휴 후 절전 | 문서가 production 사용을 권하지 않으며 브라우저 QA에는 작은 자원. 우선순위 낮음 |
| Hugging Face Spaces | CPU Basic 시간당 가격은 0이나 신규 Docker/Gradio compute Space 생성에는 유료 플랜 요구 | 새 무료 Docker 서버 대안으로 추천하지 않음. 무료 ZeroGPU Gradio 예외는 범용 브라우저 서버 대안과 다름 |

Render 무료 파일시스템은 재시작·절전 시 사라지며 무료 Postgres는 30일 후 만료한다. 브라우저 결과 영구 저장소로 사용하지 않는다. 무료 서비스의 과도한 외부 발신 트래픽은 중단 대상이 될 수 있으므로 사이트 방문량도 고려해야 한다. 결제 수단이 있는 계정은 초과 대역폭·빌드 비용 조건을 별도 확인해야 한다.

## 이전 시 구조

화면·인증·결과 저장은 기존 Cloudflare에 유지하고, 별도 CPU 서버가 인증된 작업만 받아 Playwright Chromium을 실행하는 구조를 제안한다. 요청 서명, 만료, 단일 실행 claim, 고객별 격리, 네트워크 접근 제어, 제한 시간, 취소, 증거 업로드를 먼저 구현·시험해야 한다. 기존 Worker는 BROWSER·D1 binding에 의존하므로 다른 서버에 소스를 그대로 올리는 것으로 이전이 끝나지 않는다.

일반 브라우저 QA에는 GPU가 필수는 아니다. 무료 CPU 서버에서 로컬 Qwen3-VL 계획 생성까지 같은 속도로 제공할 수 있다고 가정하지 않는다.

추천 순서: 현재 자체 예산 관리 개선 → 별도 브라우저 실행부의 컨테이너화와 자원 측정 → 무료 인스턴스 실제 확보 확인 → 같은 정상/결함 세트로 비교 → 고객 범위에서 이전 판단. 자동 이전·유료 계정 전환은 하지 않는다.

## 공식 근거

- https://developers.cloudflare.com/browser-run/limits/
- https://render.com/docs/free
- https://render.com/docs/compute-plans
- https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- https://docs.oracle.com/iaas/Content/FreeTier/freetier.htm
- https://www.koyeb.com/docs/reference/instances
- https://huggingface.co/docs/hub/spaces-overview
