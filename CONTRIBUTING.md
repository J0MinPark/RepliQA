# Contributing to RepliQA

Report the expected outcome, actual outcome, minimal synthetic reproduction,
browser/version, and whether the result is failed, review, or inconclusive.
Never attach credentials, invite keys, real customer screenshots, or production data.

Use deterministic browser assertions for functional verdicts. A successful click
or an AI observation is not proof that the user outcome succeeded. Preserve
unresolved results and unexecuted steps. Do not weaken an oracle to make tests pass.

Run the cloud tests and functional regression suite. For a judge change, freeze
new normal and faulty cases before measurement; retain the first failing result.
Once used to tune the implementation, those cases are regression cases, not holdout.
New benchmark claims must identify unique cases, repeats, false positives,
missed defects (including inconclusive defects), scope, and timing exclusions.

Contributions must be yours to contribute and are submitted under Apache-2.0.
Keep third-party code and license provenance identifiable. No CLA is currently required.
