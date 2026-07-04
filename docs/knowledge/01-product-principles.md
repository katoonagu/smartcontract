---
status: current
last_verified: 2026-07-03
owner_area: docs
code_refs:
  - src/risk/unifiedWalletRisk.ts
  - src/forensics/moneyOriginOperationalAssessment.ts
supersedes:
  - docs/project-walkthrough/00-purpose-and-clients.md
  - docs/project-walkthrough/15-limitations-and-honest-promises.md
---

# Product Principles

## Evidence First

The product explains risk through evidence. It should show what was found,
where it was found, and why it matters.

Hard evidence has priority over weak context. Weak context should not become a
critical verdict by accumulation alone.

## Facts Are Not Interpretation

A transfer is a fact. A label is supporting context. A risk score is an
interpretation.

The system must not hide this distinction. When a decision is based on
incomplete coverage, the output must say so.

## Missing Data Is Not Clean

Absence of evidence is not evidence of safety. If we did not fetch enough
history, we cannot claim that the source is clean.

For paid forensic checks, a local data coverage gap on the main money path
should trigger more indexing, not a final "unknown" result.

## Boundary Stops Are Legitimate

A path may honestly stop at a service boundary:

- CEX;
- DEX;
- bridge;
- router;
- known contract or service wallet.

That is different from a local stop caused by a small page budget, timeout, or
partial index state. Service boundary means the public chain may not expose the
internal source. Budget stop means we did not collect enough public data.

## Long Checks Are Allowed

The user can wait for a full forensic answer. The system should show progress
instead of pretending the result is complete.

Long runtime is acceptable when the check is doing useful indexing and trace
work.

## Documentation And Code

Knowledge docs define product intent. Code proves current implementation. If
they disagree, report the disagreement and verify the code before changing
behavior.
