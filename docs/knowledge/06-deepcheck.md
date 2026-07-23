---
status: current
last_verified: 2026-07-23
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

## Implemented Release Candidate

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

The candidate contract is implemented and tested. Production remains on legacy
DeepCheck until the protected generation cutover.
