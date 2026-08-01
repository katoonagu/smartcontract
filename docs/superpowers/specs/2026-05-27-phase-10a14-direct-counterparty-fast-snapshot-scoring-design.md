# Phase 10A.14: Direct Counterparty Fast Snapshot Scoring

## Summary

Phase 10A.13 made deep coverage visible. It showed an important gap: a sparse wallet can receive most or all of its funds from a counterparty that looks risky by behavior, but the checked wallet remains low risk because the counterparty has no exact internal label, derived marker, blacklist, or approval-drain provenance.

This phase adds a bounded interaction-risk layer for direct counterparties. The system will evaluate direct counterparties with a fast risk snapshot, weight that risk by the size and direction of the interaction, and expose the result in deep/debug reports.

This is not a taint proof layer. It is an explainable interaction-context score.

## Motivating Case

Checked subject:

```text
TNNkKmEj5ax48ZuJfWpRpkxzzwXWTNH45J
```

Observed direct counterparty:

```text
TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe
```

Current coverage debug showed:

```text
TLhVzk... -> TNNk...
3,000,000 USDT
100% of inbound volume
4 transfers
expanded: yes
label: none
cachedRisk: none
scoreContribution: 0
```

The relationship is visible, but the scoring layer only trusts exact labels/derived markers/provenance. It does not yet ask: "what does the direct counterparty look like under the same fast check we already run for normal addresses?"

## Goals

- Evaluate every direct counterparty for sparse wallets, and top/risky direct counterparties for active wallets.
- Reuse the existing fast address risk logic instead of creating a separate risk model.
- Weight counterparty risk by interaction share, absolute volume, tx count, direction, and recency.
- Allow HIGH `60+` when a high-risk counterparty dominates the interaction share, especially above `70%`.
- Keep exact evidence, derived labels, behavior-context, and service-boundary context separate.
- Improve coverage table reasons so `metadata_cap` is a global limit, not the default reason for every unscored row.

## Non-Goals

- Do not create derived high-risk labels from behavior-only counterparty risk in this phase.
- Do not treat a behavior-risk counterparty as exact taint proof.
- Do not run recursive deep jobs for every counterparty.
- Do not continue proof through CEX/router/bridge boundaries.
- Do not add ML/GNN or opaque ranking.

## Evidence Classes

Counterparty rows should use clear evidence classes:

```text
exact_labeled_counterparty
derived_labeled_counterparty
counterparty_fast_risk_snapshot
counterparty_behavior_context
service_boundary_context
no_exact_label_or_cached_taint
provider_partial
not_selected_for_fast_snapshot
```

Important distinction:

- `exact_labeled_counterparty`: label/blacklist/approval-drain/darknet seed/proximity marker.
- `counterparty_fast_risk_snapshot`: live bounded fast check found high service exposure, behavior, blacklist, or labels.
- `counterparty_behavior_context`: fast check found behavior/service context, but no exact taint label.
- `service_boundary_context`: direct counterparty is CEX/router/bridge/pool/service infrastructure.
- `no_exact_label_or_cached_taint`: row was seen and analyzed, but no exact risk source exists.

## Data Model

Add a profile separate from existing `CounterpartyRiskProfile` exact-label scoring:

```ts
type CounterpartyRiskSnapshot = {
  address: string;
  riskScore: number; // 0..100
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  source:
    | "exact_label"
    | "derived_label"
    | "stablecoin_blacklist"
    | "prior_risk_evaluation"
    | "fast_address_check"
    | "service_boundary"
    | "none";
  evidenceClass:
    | "exact_labeled_counterparty"
    | "derived_labeled_counterparty"
    | "counterparty_fast_risk_snapshot"
    | "counterparty_behavior_context"
    | "service_boundary_context"
    | "no_exact_label_or_cached_taint"
    | "provider_partial";
  reasons: string[];
  partialNotes: string[];
};
```

Add an interaction profile:

```ts
type DirectCounterpartyInteractionProfile = {
  subjectAddress: string;
  counterpartyAddress: string;
  direction: "inbound" | "outbound";
  volumeRaw: string;
  volumeRatio: number;
  txCount: number;
  firstSeen: string;
  lastSeen: string;
  snapshot: CounterpartyRiskSnapshot;
  interactionWeight: number;
  scoreContribution: number; // 0..100, capped by evidence class
  evidenceClass: CounterpartyRiskSnapshot["evidenceClass"];
  skippedReason: string | null;
};
```

## Candidate Selection

All direct edges should be represented in the coverage table.

Fast snapshot selection is bounded:

### Sparse Wallet

When the checked wallet has fewer than `60` official TRON USDT transfers in the 30d window:

- fetch latest `60` historical transfers;
- group all direct counterparties;
- run fast snapshots for all direct counterparties up to a safety cap, default `30`;
- if direct counterparties exceed the cap, select by:
  - known risky labels/derived markers first;
  - top volume;
  - top tx count;
  - service/router/CEX/bridge candidates.

### Active Wallet

For high-activity wallets:

- include all direct edges in the table;
- run fast snapshots only for selected candidates:
  - known risky labels/derived markers;
  - top `10` by volume;
  - top `10` by tx count;
  - top service-boundary candidates;
  - any counterparty receiving or sending at least `70%` of directional volume.

No recursive deep crawl is launched for counterparties.

## Fast Snapshot Runtime

Reuse bounded fast logic from `/check address`, but run it as an internal snapshot:

```text
days: 30
maxDepth: 1
maxPagesPerAddress: 1
recentFallbackMinTransferCount: 60
recentFallbackTransferLimit: 60
metadata/profile caps: lower than subject deep job
timeout per counterparty: 3-5 seconds
global snapshot budget per subject: configurable, default 15-20 seconds
```

The snapshot can use:

- exact internal labels;
- derived labels;
- prior risk evaluation cache;
- USDT blacklist state;
- fast service exposure;
- fast address behavior;
- service category / boundary metadata.

Provider failures create partial notes only. Failed snapshots do not raise risk.

## Scoring Policy

The final risk remains `/100`. Do not sum every module blindly.

### Interaction Weight

```text
base = max(volumeRatio, txCountRatio * 0.5)
absoluteBoost = volume >= 100k USDT ? +0.10 : 0
directionWeight:
  inbound = 1.00
  outbound = 0.85
recencyBoost:
  last interaction <= 24h = +0.10
  <= 7d = +0.05

interactionWeight = clamp(base + absoluteBoost + recencyBoost, 0, 1) * directionWeight
```

### Contribution

```text
scoreContribution = min(capByEvidenceClass, snapshot.riskScore * interactionWeight)
```

Caps:

```text
exact_labeled_counterparty: 90
derived_labeled_counterparty: 80
stablecoin_blacklist: 90
counterparty_fast_risk_snapshot: 70
counterparty_behavior_context: 65
service_boundary_context: 25
no_exact_label_or_cached_taint: 0
provider_partial: 0
```

### HIGH Rule

Allow HIGH `60+` from counterparty behavior only when all are true:

- counterparty fast risk is HIGH or CRITICAL, `>= 70/100`;
- interaction share is dominant, `volumeRatio >= 0.70`;
- absolute volume is meaningful, default `>= 10,000 USDT`;
- snapshot is not provider-partial only;
- no service/CEX/router/bridge boundary is being crossed as proof.

This means the report can say:

```text
Major inbound funds came from a high-risk counterparty by fast forensic snapshot.
This is interaction-context risk, not exact blacklist/scam proof.
```

It must not say:

```text
fraud proven
confirmed scam wallet
exact taint proven from behavior-only counterparty
```

## Result Composition

Add a distinct risk layer:

```text
Taint evidence:
  exact labels, blacklist, darknet seed, approval-drain, derived markers

Counterparty interaction context:
  direct counterparties evaluated by fast snapshots and weighted by interaction share

Operational laundering pattern:
  service exposure, deposit-then-drain, collector/transit, boundary flows
```

The deep result should show whether risk increased because of:

- exact taint;
- counterparty interaction context;
- operational pattern only.

## Coverage Table Updates

Extend rows with:

```text
counterpartyRiskScore
counterpartyRiskLevel
riskSource
interactionWeight
scoreContribution
evidenceClass
snapshotStatus
snapshotPartialNotes
```

Fix skipped reasons:

- `metadata_cap` should move to `missingChecks` / coverage limits.
- A row with no exact source should say `no_exact_label_or_cached_taint`.
- A row selected but failed by timeout should say `provider_partial`.
- A row not selected for snapshot should say `not_selected_for_fast_snapshot`.
- A behavior-only row should say `counterparty_behavior_context`.

## Expected TNNk Outcome

If `TLhVzk...` fast snapshot is HIGH and remains `100%` of inbound volume:

```text
TNNk risk may become HIGH 60+
Reason: 100% of inbound USDT came from a high-risk direct counterparty by fast forensic snapshot.
Evidence class: counterparty_behavior_context
Limit: not exact taint; no direct blacklist/scam/approval-drain proof found for TNNk.
```

If `TLhVzk...` fast snapshot is only MEDIUM:

```text
TNNk becomes MEDIUM context risk, not HIGH.
```

If `TLhVzk...` has exact label/derived marker later:

```text
TNNk can be scored via exact/derived counterparty exposure, with a stronger evidence class.
```

## Testing

Unit tests:

- sparse wallet with `<60` 30d transfers runs fast snapshots for all direct counterparties under cap;
- active wallet selects top volume/top tx/risky candidates only;
- high-risk counterparty with `>=70%` share can produce `60+` HIGH;
- high-risk counterparty with low share does not produce HIGH;
- behavior-risk counterparty does not create derived label;
- service boundary counterparty stays capped as context;
- provider timeout creates `provider_partial` and score `0`;
- `metadata_cap` appears only as coverage limit, not as default row skipped reason.

Integration tests:

- `TNNk <- TLhVzk` fixture: TLhVzk fast HIGH + 100% inbound produces HIGH interaction context;
- no exact taint wording appears;
- coverage table shows snapshot score/source/class;
- Telegram/deep report uses `/100` only.

## Rollout

1. Implement pure snapshot/interaction scoring module.
2. Wire it into deep check only, not fast `/check` summary yet.
3. Show it in coverage debug table and deep admin context.
4. After false-positive review, surface compactly in Telegram user report.

