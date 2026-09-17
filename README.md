# RepliQA — evidence-based web QA (alpha)

Development candidate 0.2.6 improves rendered-result resolution, delayed action targets, SPA history readiness and network failure accounting. [Real-site results and remaining cloud execution blocker](docs/LIVE-QA-ADAPTATION.md). The production pilot remains 0.2.5: deployed Free Worker tests still hit the subrequest limit on asset-heavy sites. This candidate is not a production-ready autonomous QA service.

The invite pilot now runs 0.2.5. See [live cloud, network and recovery validation](docs/CLOUD-OPERATIONS-VALIDATION.md), [usage](docs/REPLIQA-USAGE.md), and the [real company website execution report](docs/ENTERPRISE-QA-REPORT-20260918.html). Controlled DNS-rebinding validation and [external truth review](docs/EXTERNAL-REVIEW-PACK.md) remain pending. This is not a general-availability or accuracy certification.

Live Cloudflare 0.2.4 browser revalidation passed: [results and scope](docs/CLOUDFLARE-REVALIDATION.md). See also [free hosting options](docs/FREE-HOSTING-OPTIONS.md).

RepliQA runs explicit browser journeys and page checks using Playwright. Reports
separate passed conditions, mismatches, review candidates, and inconclusive work.
The cloud engine does not require an LLM or a running local GPU.

This public export contains the cloud engine, its shared source modules, synthetic
tests, and evaluation tooling. It is not a packaged desktop installer. Local Qwen
planning in the development desktop is a separate execution path; it is not
enabled in the cloud service. No external QA-skill service is called at runtime.

## Reproduce locally

Prerequisite: Node.js 24 and npm. From the export root:

```powershell
npm ci --prefix cloud --ignore-scripts
npm ci --prefix desktop --omit=dev --ignore-scripts
npm ci --prefix evaluation --ignore-scripts
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) 'desktop/vendor/browsers'
node desktop/node_modules/playwright/cli.js install chromium
npm test --prefix cloud
node evaluation/run.mjs --label my-first-measurement --repeats 2
node evaluation/gate.mjs evaluation/results/my-first-measurement/result.json
```

On other shells, set PLAYWRIGHT_BROWSERS_PATH to the absolute path of
desktop/vendor/browsers. Evaluation fixtures are served only on loopback; the
benchmark blocks outside browser requests. Package/browser installation requires
downloads. Tests do not call a paid AI provider or consume Cloudflare browser quota.

## Self-hosting

The exported wrangler.jsonc has no production account IDs or database IDs and
FREE_PLAN_CONFIRMED is false. Configure your own account, create D1, apply the
migration, and explicitly review your provider's current quotas. Keep cloud AI off.
Set REPLIQA_PUBLIC_ORIGIN to your own HTTPS deployment origin before deploying.
Set REPLIQA_EVALUATION_RECEIPT to your current local measurement result.json.
The deploy command requires a matching regression gate. Deployment and provider
authorization are separate from local testing. No hosted-service SLA is included.

For local UI development, use the synthetic local fixture in cloud/test and
Wrangler local mode. Never apply local-fixture.sql to a remote database.

## Scope and limitations

- Basic mode checks the current page, not every site function.
- Journey mode requires explicit actions and expected outcomes; it does not
  autonomously discover all business rules.
- Playwright Chromium is the tested browser. Cross-browser coverage is not claimed.
- Input values and screenshots can contain sensitive data despite masking.
- A pass applies only to the configured conditions. AI findings are not certified bugs.
- The original 55-case regression and a new 20-case fixture assessment are synthetic,
  authored evaluations, not independently audited real-customer accuracy.
- Production target isolation and operational readiness require further evaluation.

## License and support

Original source: Apache-2.0, copyright Jeongmin. Third-party code retains its own
licenses; see NOTICE and cloud/public/third-party-notices.txt. Model weights and
browser binaries are not included. Contact: jeneric873@gmail.com.
