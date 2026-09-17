# Cloudflare 수정본·네트워크·복구 검증 — 2026-09-18

운영 파일럿에 **0.2.5를 배포했다**. 수정본의 실제 브라우저 검사는 동일 코드·설정의 분리된 Cloudflare 검증용 Worker/D1에서 수행했고, 운영 배포 후에는 버전과 고객 화면 흐름을 확인했다. 운영 DB의 일일 검사 기록을 지우거나 고객 제한을 올리지 않았다.

## 브라우저 실행

첫 시도에서는 자체 예제 URL이 검사 경로에서 HTTP 404를 반환했다. 기본 검사는 review, 여정은 inconclusive로 중단했다. 실패 기록을 `basic-before-config-fix.json`, `journey-before-config-fix.json`으로 보존했다.

Cloudflare의 같은 계정 Worker 간 요청이 공개 인터넷 경로를 사용하도록 `global_fetch_strictly_public` 설정을 추가했다. [Cloudflare의 fetch 설명](https://developers.cloudflare.com/workers/runtime-apis/fetch/)과 [설정 의미](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public)를 확인했다. 엔진 소스는 고정한 0.2.5와 같으며, 배포 설정 변경으로 구분한다.

수정 후 결과:

| 검사 | 결과 | 전체 요청 소요 시간 |
|---|---|---|
| 자동 기본 검사 | 12개 항목, passed | 9.147초 |
| 장바구니 여정 | 수량 선택·클릭·중간 검증 등 4단계, passed | 9.741초 |
| 운영 배포 확인 | health 0.2.5, 클라우드 AI 비활성 | 별도 기록 |
| 운영 고객 화면 흐름 | 인증, 계획 검증·저장·복원, 재검토, 모바일, 로그아웃 통과 | 브라우저 검사 예약 0건 |

검증용 DB에서 설정 수정 전후 총 4건을 실행했다. 추가 네트워크 진단은 별도의 제한된 운영 진단 세션이다. Cloudflare 계정 전체 브라우저 사용량은 시작 26.219초 → 종료 58.662초로, 이번 작업에서 약 32.443초 증가했다. 무료 일일 600초 안에서 수행했고 유료 플랜·AI를 활성화하지 않았다. 기업 사이트 리포트는 RTX 4060 서버의 로컬 Chromium에서 별도로 실행해 이 사용량에 포함되지 않는다.

검증 후 임시 Worker와 D1을 삭제했다. 운영 Worker와 운영 D1은 유지했다.

## 네트워크 계층 관측

앱의 `installGuard`를 설치하지 않은 별도 Cloudflare 브라우저 세션에서 플랫폼의 호스트 제한을 확인했다.

| 경로 | 관측 |
|---|---|
| 허용한 검증 사이트 | HTTP 200 |
| 허용하지 않은 example.com | HTTP 403, `cf-mitigated: guardrails`, `not-in-allowlist` |
| IPv4 루프백 127.0.0.1 | `ERR_BLOCKED_BY_ADMINISTRATOR` |
| IPv6 루프백 ::1 | `ERR_BLOCKED_BY_ADMINISTRATOR` |
| 사설 주소 10.255.255.254 | HTTP 403 |

`route.fetch`의 요청 경로도 고려해 **원격 Cloudflare Worker의 global fetch**를 따로 확인했다. 공개 example.com은 200, 위 세 사설·루프백 주소는 모두 403이었다. 응답의 사적 내용을 수집하지 않았다.

이는 테스트한 주소와 설정의 차단 관측이다. 모든 사설 IP 범위, 허용 호스트의 DNS rebinding/TOCTOU, WebRTC 등의 차단을 증명한 것은 아니다. 테스트용 DNS를 제어한 재바인딩 시험과 플랫폼의 전송 계층 보장 확인은 남아 있다. 임의 도메인·임의 HTML 입력을 불특정 고객에게 개방하지 않는다.

## 운영 백업을 사용한 원격 복구 훈련

1. 운영 D1을 SQL로 내보내 RTX 4060 서버의 비공개 경로에 보관했다.
2. Worker와 연결되지 않은 별도 원격 D1에 복원했다. 테넌트·실행 수와 보고서/이미지 크기 합계가 백업과 일치했다.
3. 시험용 표식을 기록하고 D1 Time Travel bookmark를 확보했다. 표식을 삭제해 0건을 확인한 뒤 bookmark로 복구해 원래 표식을 확인했다.
4. 복원본의 모든 초대 키를 비활성화하고 보고서·이미지를 제거했다. 활성 키, 노출 가능한 결과, 진행 중 실행이 모두 0임을 확인했다.
5. 시험 DB를 제거하고 운영 DB가 남아 있는 것을 확인했다.

이것은 **운영 백업 기반의 실제 원격 복원·시점 복구 훈련**이다. 운영 DB 자체를 과거로 되돌리거나 서비스 바인딩을 교체하지 않았으며, 실제 장애의 서비스 복구 시간(RTO)을 입증하지는 않는다. [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)의 제자리 복원은 원본을 덮어쓰므로 이번 훈련은 분리된 복원본에서 수행했다.

근거: [브라우저 기본](evidence/cloud-operations/basic.json), [여정](evidence/cloud-operations/journey.json), [브라우저 네트워크](evidence/cloud-operations/network-diagnostics.json), [Worker 네트워크](evidence/cloud-operations/worker-network.json), [복구](evidence/cloud-operations/recovery.json), [임시 자원 정리](evidence/cloud-operations/cleanup.json).
