# Deployed relay diagnostics

This isolated Worker has no production D1 binding and consumes the account's
real browser allowance. It is not an alternate customer entry point. Run only
on a confirmed Free account, one invocation at a time; inspect remaining usage
at authenticated `/usage`. A local Wrangler proxy does not reproduce deployed
Worker request limits.

1. Install the root `cloud` dependencies. Choose an unused Worker name in this
   directory's `wrangler.jsonc`; use your own authenticated Cloudflare account.
2. Set `REPLIQA_FREE_PLAN_CONFIRMED=true` and run
   `node evaluation/network-relay/publish.mjs`. This hashes the engine and
   deploys the SQLite relay and Browser binding. It does not change production.
3. Set the Worker secret `PROBE_TOKEN` using `wrangler secret put PROBE_TOKEN
   --config evaluation/network-relay/wrangler.jsonc`. Use a random secret and
   provide it through the CLI prompt. Set the same secret locally as
   `REPLIQA_RELAY_TOKEN` and the deployed origin as `REPLIQA_RELAY_ORIGIN`.
   Never commit either credentials or shell transcripts containing them.
4. Run `node evaluation/network-relay/run.mjs fixture my-fixture-first`.
   `github`, `vercel`, `github-basic`, and `vercel-basic` use the original
   frozen public documentation contracts. Use a fresh label for every attempt.
   The script checks code identity and available browser usage, waits at least
   25 seconds between starts, and retains inconclusive attempts. Provider 429
   remains possible. Basic-mode output must be reviewed; exit 0 is not a pass.
5. Authenticated `POST /security` checks private-address/redirect/host policy,
   run capabilities, duplicate requests and closure using the real namespace.
   Send `Authorization: Bearer <the private token>`; save the returned JSON.
   These checks do not prove controlled DNS-rebinding resistance.
6. Remove the diagnostic Worker and its Durable Object namespace after use.
   First verify `/usage` has no active browser sessions. Use a migration with
   `deleted_classes: ["NetworkRelay"]` and remove its binding/export before
   deleting the diagnostic Worker. Never apply this cleanup to production.

The fixture checks 120 binary responses, a gzip-encoded response, both
Set-Cookie headers and a button's observable result. Requests use the product
relay; the helper does not use customer run reservations or paid AI. It cannot
establish an independent site's ground truth or overall QA accuracy.
