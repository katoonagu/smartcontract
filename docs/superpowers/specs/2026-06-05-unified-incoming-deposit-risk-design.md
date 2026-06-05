# Unified Incoming Deposit Risk Design

Date: 2026-06-05.

## Summary

This spec defines Phase 2 for unified risk scoring.

Phase 1 updated wallet checks and `calculateUnifiedWalletRisk`. Phase 2 must make incoming deposit monitoring use the same final scoring logic instead of keeping a separate decision formula.

The selected approach is a shared forensic scoring engine with explicit scopes:

```text
scope = wallet | incoming_deposit
```

Incoming deposit checks may keep their deposit-specific provenance collection, alert formatting, funding coverage, and corridor summaries. They must not keep a separate final score and decision system.

## Current Facts From Code

### Wallet Check

Wallet-level scoring is currently implemented by `calculateUnifiedWalletRisk`.

Source:

```text
src/risk/unifiedWalletRisk.ts:67
src/risk/unifiedWalletRisk.ts:718
```

It combines:

- Fast Check;
- Deep Research;
- Where Is Money;
- hard evidence floors;
- source-policy floors;
- asset-continuation floors;
- pattern floors;
- dampeners;
- final score, level, decision, and score breakdown.

### Incoming Deposit

Incoming deposit monitoring already uses `runWhereIsMoneyCheck` for deposit provenance.

Source:

```text
src/forensics/incomingDepositJob.ts:1036
src/forensics/incomingDepositJob.ts:1083
```

It runs Where Is Money in transaction mode:

```text
mode: "transaction_check"
```

It also passes sender fast risk into Where:

```text
getFastWalletRisk: async () => fastSenderRisk
```

Source:

```text
src/forensics/incomingDepositJob.ts:1051
```

But the final incoming deposit score and decision are computed separately:

```text
depositRiskScore = max(whereReport.riskScore, topHardScore)
decision = topHardScore >= 85 ? DECLINE : whereReport.userDecision
```

Source:

```text
src/forensics/incomingDepositJob.ts:771
src/forensics/incomingDepositJob.ts:772
```

This is the duplication to remove.

## Product Goal

The product must have one risk logic.

For wallet checks:

```text
one wallet
one score
one level
one decision
one breakdown
```

For incoming deposits:

```text
one checked deposit event
one score
one level
one decision
one breakdown
```

The incoming deposit score must answer:

```text
How risky is this concrete incoming transfer into the watched wallet?
```

It must not silently answer a different question, such as:

```text
How risky is the sender address forever?
How risky is the receiver wallet overall?
How risky is every historical transaction related to this address?
```

## Subject Model

### Wallet Scope

For `wallet` scope, the subject is:

```text
subject.address
```

The scorer evaluates the checked wallet profile.

### Incoming Deposit Scope

For `incoming_deposit` scope, the subject is the deposit event:

```text
sender -> receiver
txHash
amountRaw
timestamp
```

The scorer evaluates the risk of that specific incoming deposit.

Required subject fields:

```ts
type IncomingDepositRiskSubject = {
  scope: "incoming_deposit";
  senderAddress: string;
  receiverAddress: string;
  txHash: string;
  amountRaw: string;
  timestamp: Date;
};
```

Semantics:

- `senderAddress` is the address that sent the checked deposit;
- `receiverAddress` is the watched wallet;
- `txHash` identifies the checked transfer;
- `amountRaw` is the denominator for incoming-deposit source-policy scoring;
- `timestamp` is the upper bound for provenance search.

## Architecture

Create a shared scorer module:

```text
src/risk/unifiedForensicRisk.ts
```

It owns final scoring policy for both wallet and incoming deposit scopes.

The current wallet scorer can be migrated into this module, or wrapped by it during the first implementation step. The target state is:

```text
calculateUnifiedWalletRisk -> calls shared forensic scorer with scope wallet
calculateUnifiedIncomingDepositRisk -> calls shared forensic scorer with scope incoming_deposit
```

The shared scorer returns:

```ts
type UnifiedForensicRiskResult = {
  finalScore: number;
  finalLevel: RiskLevel;
  finalDecision: UserExchangeDecision;
  weightedLayerScore: number;
  contextScore: number;
  hardEvidenceFloor: number;
  policyFloor: number;
  assetContinuationFloor: number;
  patternFloor: number;
  dampener: number;
  coverageLevel: "complete" | "partial" | "limited";
  layerBreakdown: Record<string, LayerScoreBreakdown>;
  reasons: UnifiedForensicRiskReason[];
  scoreBreakdown: UnifiedForensicRiskScoreBreakdown;
};
```

The existing `UnifiedWalletRiskResult` can remain as a compatibility type if needed, but it should be an alias or a scope-specific projection of the shared result.

## Input Model

The shared scorer accepts normalized evidence, not job-specific UI reports.

Target input:

```ts
type UnifiedForensicRiskInput = {
  subject: UnifiedForensicRiskSubject;
  fastReport?: RiskReport | null;
  deepReport?: DeepAddressForensicReport | null;
  whereReport: WhereIsMoneyReport;
};
```

`UnifiedForensicRiskSubject`:

```ts
type UnifiedForensicRiskSubject =
  | { scope: "wallet"; address: string }
  | IncomingDepositRiskSubject;
```

Why this shape:

- wallet checks already have Fast, Deep, and Where reports;
- incoming deposits already have Fast sender risk and Where transaction provenance;
- Deep can be absent for incoming deposits without breaking the scorer;
- layer weights must normalize across available layers, as wallet scoring already does.

## Scoring Rules

The same final rules apply in both scopes.

### Hard Evidence

Hard evidence is not diluted by layer weights.

Hard evidence includes:

- active USDT blacklist;
- sanctioned service;
- exact approval-drain provenance;
- deterministic scam / stolen / phishing / reported scam evidence;
- exact high-risk provenance from Where or Deep.

If hard evidence floor is at least `85`, the final decision is `DECLINE`.

### Source-Policy Floor

Source-policy evidence can raise the final score through `policyFloor`.

For incoming deposits, source-policy scoring must use the checked deposit amount as denominator:

```text
allocated path amount / checked deposit amount
```

This preserves the previous amount-weighted policy goal:

- a small bridge branch should not make the whole deposit high risk;
- a large no-name liquidity, mixer, sanctioned, or bridge branch can raise the deposit score;
- exact hard proof stays hard even if the affected amount is small.

### Pattern Floor

Pattern floor can raise score when there is strong operational or transit evidence.

For wallet scope, existing examples are:

- `historical_transit_pattern`;
- `where_drain_episode_transit_pattern`;
- `route_linked_approval_pattern`.

For incoming deposit scope, pattern floor may use:

- large transaction-seeded bridge/router/DEX corridor;
- exact deposit funding bundle that immediately exits through service infrastructure;
- repeated deposit-then-drain pattern when evidence is available from the same reports.

The implementation must reuse existing evidence from Where and incoming deposit provenance. It must not create a new address-specific rule.

### Dampener

Dampeners remain allowed, but only for non-hard, non-anchored context.

Dampener must not reduce:

- hard evidence floor;
- source-policy floor;
- asset-continuation floor;
- strong pattern floor.

For incoming deposits, clean-source context can dampen behavior-only risk. It cannot override hard evidence or high-share source-policy evidence.

### Insufficient Coverage

`insufficient_coverage` can affect coverage level and can add limited-coverage floor.

It must not by itself force `DECLINE` when final score is low.

This keeps incoming deposits aligned with the Phase 1 wallet decision rule.

## Incoming Deposit Report Mapping

`IncomingDepositRiskReport` remains the product-facing alert/report shape.

But these fields must come from the shared scorer:

```text
depositRiskScore <- finalScore
riskBand <- finalLevel mapped to incoming risk band
decision <- finalDecision
reasons <- shared scorer reasons plus incoming-specific path notes
```

Incoming-specific fields remain owned by `incomingDepositJob`:

- `originPaths`;
- `originCoverage`;
- `fundingCoverage`;
- `corridorSummary`;
- `provenanceConfidence`;
- `dataQuality`;
- `senderRole`;
- `contractVerdicts`;
- `warnings`.

The report should also include the shared score breakdown so Telegram/admin/debug output can explain why the score happened:

```ts
unifiedRisk?: UnifiedForensicRiskResult;
```

If the full result is too large for storage or UI, store a compact projection:

```ts
unifiedRiskSummary?: {
  finalScore: number;
  finalLevel: RiskLevel;
  finalDecision: UserExchangeDecision;
  hardEvidenceFloor: number;
  policyFloor: number;
  patternFloor: number;
  dampener: number;
  activeAnchor: UnifiedForensicRiskActiveAnchor | null;
};
```

## Non-Goals

This phase does not require incoming deposits to run a full Deep Research check for every deposit.

This phase does not require changing Telegram copy unless field names or visible decision text would become inconsistent.

This phase does not require removing incoming deposit provenance, funding bundle, corridor, or alert formatting logic.

This phase does not create another source-policy scorer.

## Required Test Scenarios

### Shared Scorer

Add scorer tests that prove:

1. Hard evidence produces a high final floor and `DECLINE`.
2. Source-policy floor is not diluted by missing Deep layer.
3. Low `insufficient_coverage` does not force `DECLINE`.
4. Dampener does not reduce hard evidence, policy floor, or pattern floor.
5. Available layer weights normalize when Deep is absent.

### Incoming Deposit

Update incoming deposit tests that prove:

1. USDT-blacklisted sender gives `CRITICAL / DECLINE`.
2. Exact approval-drain provenance gives `CRITICAL / DECLINE`.
3. Clean CEX-funded deposit gives low or acceptable result.
4. Minority bridge/router/DEX branch stays below high risk when amount share is small.
5. High-share no-name liquidity or bridge/router/DEX source-policy evidence raises score through shared policy floor.
6. Unknown or insufficient coverage can raise score to caution range but does not auto-decline by itself.
7. `depositRiskScore`, `riskBand`, and `decision` match the shared scorer output.

## Migration Plan

Step 1: Create the shared scorer types and wrapper.

Keep `calculateUnifiedWalletRisk` public and compatible.

Step 2: Add `calculateUnifiedIncomingDepositRisk`.

It should accept:

```ts
{
  senderAddress;
  receiverAddress;
  txHash;
  amountRaw;
  timestamp;
  fastSenderRisk;
  whereReport;
  deepReport?;
}
```

Step 3: Change `incomingReportFromWhere`.

Replace:

```text
depositRiskScore = max(whereReport.riskScore, topHardScore)
decision = topHardScore >= 85 ? DECLINE : whereReport.userDecision
```

with shared scorer output.

Step 4: Keep old incoming report shape stable.

Existing alert and admin code should continue reading `depositRiskScore`, `riskBand`, and `decision`.

Step 5: Add score breakdown to result JSON.

This makes incoming deposits explainable in the same way as wallet checks.

## Acceptance Criteria

The phase is complete when:

1. Wallet checks still pass existing unified wallet risk tests.
2. Incoming deposits no longer compute final score/decision using the separate max formula.
3. Incoming deposits call a shared scorer function for final score/level/decision.
4. Hard evidence, policy floor, pattern floor, dampener, and coverage behavior are tested for incoming deposit scope.
5. Telegram/admin-facing incoming report fields remain compatible.
6. `npm run typecheck` passes.
7. Relevant unit tests pass.
8. Full `npm test` passes before landing.
