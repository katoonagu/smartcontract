---
status: current
last_verified: 2026-07-27
owner_area: forensics
code_refs:
  - src/check/deepForensicCheck.ts
  - src/forensics/directHardEvidence.ts
  - src/forensics/counterpartyRisk.ts
  - src/forensics/deepSecondLayerRelationship.ts
  - src/unifiedCheck/productionBranches.ts
  - src/unifiedCheck/canonicalFacts.ts
---

# DeepCheck

## Production Truth

The deployed DeepCheck remains a legacy forensic job with its current direct
and selected second-layer relationship logic, coverage metadata, and delivery
ownership. It must distinguish direct from indirect exposure, transaction-time
restriction state from later restriction, and victim from drainer/recipient
role.

## Unified DeepCheck

Deep is a separate evidence producer inside one Unified parent, not a second
user-facing check. It emits canonical relationship, boundary, approval,
restriction-timeline, label, contract, and behavior facts. It cannot send its
own message or select the final score.

Normalization preserves distance, subject/counterparty role, and evidence
timing. Victim evidence is not scored as drainer evidence; later-frozen is not
frozen-at-transfer; indirect evidence does not receive direct weight; a service
boundary is context rather than provider failure. Cross-branch canonical keys
prevent the same event from contributing again through Fast or Where.

The parent may complete only after Deep is terminal and shared traversal/hash
contracts hold. A technical Deep failure produces no partial user report.

The Unified contract is implemented and tested. Delivery ownership does not
gate isolated Deep execution.

Stage B legacy Deep reuses the process-wide selective resolver for indexed
transaction hashes chosen by its existing economic-role and approval logic.
Its parsers still receive finalized full payloads, while raw preflight,
immutable reuse, tx-hash deduplication, scheduler pacing, and persisted
enrichment evidence IDs are shared with Where and Incoming.

An explicitly hard Deep transaction remains a resolver candidate even when no
indexed movement row exists. It is then raw/full-resolved or reported unknown;
Deep does not bypass the resolver with a direct transaction-info request.
Economic and approval numeric limits bound optional exploration only. Exact
transferFrom, Verify20, permit, non-plain, and other hard parser candidates are
kept outside those optional limits, and Deep owns no private full-payload
promise cache.

While shared raw/full promises are pending, the claimed Deep runner uses one
job-scoped coordinator for all concurrent transaction resolutions and performs
a non-overlapping heartbeat CAS at most once per 30 seconds. A final candidate
queues one latest final write behind an in-flight periodic CAS. A false CAS
aborts every Deep caller for that job immediately; it does not cancel shared
provider promises, but stale callers cannot start full/next work or attach
evidence/results.
