---
status: current
last_verified: 2026-07-25
owner_area: forensics
code_refs:
  - src/index.ts
  - src/bot/createBot.ts
  - src/check/smartContractCheck.ts
  - src/check/deepForensicCheck.ts
  - src/unifiedCheck/requestService.ts
  - src/unifiedCheck/productionRuntime.ts
  - src/unifiedCheck/rolloutFence.ts
  - src/monitor/addressPoisoningWorker.ts
---

# Check Modes

## Production Truth

The deployed bot still uses the legacy runtime. Fast Check, Deep Check, Where
Is Money, and Incoming Deposit are separate jobs with separate lifecycle and
delivery ownership. Fast answers the direct wallet/contract question; Deep
collects broader relationship and behavioral context; Where follows outgoing
movement; Incoming follows the provenance of a selected deposit.

This separation remains important: a missing Deep/Where result cannot be
silently replaced by Fast, and contract analysis does not replace transfer
analysis. Legacy score validity and partial-result behavior remain in force
until the protected Unified cutover.

Address-poisoning protection is a separate wallet-safety monitor. It never
becomes AML evidence or a substitute for any of the four checks.

## Implemented Release Candidate

Unified Wallet Check keeps the same three analytical questions—Fast, Where,
and Deep—but runs them as evidence-only children of one parent request. The
children cannot send Telegram output or publish competing scores.

The parent publishes exactly one immutable report only after `COMPLETED`.
Every completed run has one matrix-v4 score and decision. Coverage is evidence
metadata; it neither blocks the score nor adds risk. `FAILED_TECHNICAL` is not
a risk decision and creates no report or delivery.

One request owns at most one automatic send. A confirmed send becomes
`DELIVERED`; an ambiguous external result becomes `DELIVERY_UNKNOWN` and is
never retried automatically. The generation fence makes legacy and Unified
delivery authority mutually exclusive.

The candidate code and production request boundary are implemented and tested.
They are not deployed: production remains on the legacy path until schema 034
and the Unified generation are activated by the protected release flow.
