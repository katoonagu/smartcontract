# Final Scoring Architecture Design

## Goal

Apply the two ChatGPT Pro scoring architecture proposals to this project as a concrete, implementation-ready design for TRON USDT forensic scoring.

The target architecture is:

```text
Evidence-first decision layer
+ weighted source-policy scoring
+ hard proof isolation
+ operational/clean-source dampening only for non-hard evidence
+ LLM as classifier, not blockchain fact generator
```

The main correction is:

```text
HTX/Huobi must not enter hardBadEvidence only because a provenance path reached HTX/Huobi.
```

HTX/Huobi, WhiteBIT, bridge/router/DEX, cross-chain and unknown contract boundaries can still lead to `DECLINE`, but they must be represented as policy/context risk, not scam/drain proof.

## Current Diagnosis

The current project has the right building blocks but the decision boundaries are too mixed.

### Existing Pipeline

| Layer | Files | Responsibility |
|---|---|---|
| Telegram / UX | `src/bot/createBot.ts`, `src/bot/messages.ts` | Commands, reports, buttons, formatting |
| Fast/manual check | `src/check/manualCheck.ts`, `src/check/deepForensicCheck.ts`, `src/risk/riskEngine.ts`, `src/risk/riskPolicy.ts` | Fast labels, graph, behavior, provider signals |
| Where-is-money | `src/check/whereIsMoneyCheck.ts` | Current balance or recent-flow provenance report |
| Balance/recent-flow selection | `src/forensics/balanceFormingTransfers.ts`, `src/forensics/recentFlowProvenanceSelection.ts` | Select balance-forming or historical funding txs |
| Origin tracing | `src/forensics/moneyOriginTrace.ts` | Trace upstream transfers with amount/time continuity |
| Stop policy | `src/forensics/moneyOriginPolicy.ts` | Decide if a path reaches clean CEX, HTX, WhiteBIT, bridge, unknown contract |
| Operational assessment | `src/forensics/moneyOriginOperationalAssessment.ts` | Build final where-is-money assessment |
| Incoming deposit | `src/forensics/incomingDepositJob.ts` | Analyze one concrete incoming deposit using shared where logic |
| Approval drain provenance | `src/forensics/approvalDrainProvenance.ts` | Check approve -> transferFrom -> money path |
| LLM contract verdict | `src/forensics/contractLlmVerdict.ts` | Classify contract/scenario from case files |
| Legacy/general policy engine | `src/risk/riskPolicyEngine.ts` | Generic risk policy, must not keep fixed duplicate HTX rules |

### Problems To Fix

1. `moneyOriginPolicy.ts` currently treats HTX/Huobi as fixed high risk:

```ts
if (hasHighRiskIdentity(text)) {
  return {
    verdict: "DECLINE",
    rootSourceType: "decline_boundary",
    stoppedReason: "decline_boundary_reached",
    riskScoreContribution: 78,
    reasons: [...]
  };
}
```

This ignores:

- aggregate share;
- hop count;
- elapsed time;
- average time per hop;
- amount continuity;
- wallet role;
- wallet age;
- clean CEX coverage;
- repeated exposure;
- whether hard evidence exists.

2. `moneyOriginOperationalAssessment.ts` can turn HTX/Huobi into `hardBadEvidence`.

Conceptually wrong:

```text
HTX/Huobi = source-policy risk
HTX/Huobi != scam proof
HTX/Huobi != approval-drain proof
HTX/Huobi != hard bad evidence
```

3. Operational-wallet dampening becomes unreachable if minority HTX/Huobi was already converted into hard evidence.

4. `moneyOriginTrace.ts` can stop on any `DECLINE`. It should stop early only on deterministic hard proof, not on policy boundaries like HTX/Huobi, bridge, DEX, unknown contract.

5. `incomingDepositJob.ts` can collapse path-level `REVIEW` into user-facing `DECLINE`. Final UI should be only `ACCEPTABLE` / `DECLINE`, but internal `REVIEW`/unknown/policy context must not automatically become hard decline.

6. LLM verdicts can over-amplify risk. LLM can classify a contract/scenario; it must not create blockchain facts or exact drain proof.

7. Proof levels must be structural, not text-based. Do not infer proof from `reasonText.includes("htx")`; use typed evidence/layers.

## Core Architecture

### Evidence Classes

Add typed evidence classes. These are not just UI labels; they define what can be dampened, capped, or used as hard proof.

```ts
export type EvidenceClass =
  | "hard_proof"
  | "source_policy"
  | "contract_suspicion"
  | "unknown_origin"
  | "behavior_context"
  | "data_quality"
  | "dampener"
  | "clean_source";
```

Mapping:

| Signal | Evidence class |
|---|---|
| USDT blacklist | `hard_proof` |
| Scam/stolen/phishing label | `hard_proof` |
| Exact approval drain | `hard_proof` |
| HTX/Huobi | `source_policy` |
| WhiteBIT | `source_policy` |
| Bridge/router/DEX | `source_policy` |
| Cross-chain boundary | `source_policy` |
| Unknown contract without exact drain | `contract_suspicion` or `unknown_origin` |
| LLM `drainer_like` without exact transferFrom proof | `contract_suspicion` |
| Unknown/incomplete provenance | `unknown_origin` or `data_quality` |
| Operational wallet behavior | `dampener` / `behavior_context` |
| Allowlisted CEX | `clean_source` |

### Source Exposure Kinds

```ts
export type SourceExposureKind =
  | "htx_huobi"
  | "whitebit"
  | "bridge_router_dex"
  | "cross_chain_boundary"
  | "unknown_contract"
  | "unknown_cex"
  | "allowlisted_cex"
  | "risky_label";
```

### Risk Layer Score

Every significant scoring contribution should be explainable and reproducible.

```ts
export type RiskLayerScore = {
  evidenceClass: EvidenceClass;
  kind: string;
  sourceExposureKind?: SourceExposureKind;
  score: number;
  rawScore: number;
  adjustedScore: number;
  proofLevel: ProofLevel;
  canBeDampened: boolean;
  capApplied?: number;
  floorApplied?: number;
  reasons: string[];
  warnings: string[];
  evidenceIds: string[];
};
```

### Source Policy Evidence

```ts
export type SourcePolicyEvidence = {
  kind: SourceExposureKind;
  aggregateShare: number;
  effectiveShare: number;
  pathCount: number;
  score: number;
  riskBand: WhereIsMoneyRiskBand;
  proofLevel: ProofLevel;
  canBeDampened: boolean;
  reasons: string[];
  warnings: string[];
  evidenceIds: string[];
  topPath?: {
    hops: number;
    elapsedMs: number | null;
    avgTimePerHopMs: number | null;
    amountContinuity: number;
    linkStrength: number;
  };
};
```

### Money Origin Path Extensions

`MoneyOriginPath` should carry structured source-policy metadata so downstream code does not parse reason text.

```ts
sourceExposureKind?: SourceExposureKind | null;
effectiveExposureShare?: number | null;
linkStrength?: number | null;
scoreBreakdown?: RiskLayerScore[];
```

If existing field names already exist, prefer adapting rather than duplicating.

## Decision Priority

The final user-facing decision is always:

```text
ACCEPTABLE | DECLINE
```

Internal states can include `REVIEW`, `unknown`, `policy_context`, `insufficient_data`, but they must collapse to user decision only after scoring.

Priority:

```text
1. Hard deterministic proof
   blacklist, USDT blacklist, exact approve -> transferFrom -> checked wallet/deposit receiver
   => DECLINE, 90-100, cannot be dampened

2. High source-policy exposure
   HTX/Huobi, WhiteBIT, bridge/router/DEX, cross-chain
   => DECLINE only if weighted score >= 60 or strict policy requires it
   => wording must say policy risk, not scam proof

3. Contract suspicion
   unknown contract, LLM drainer_like, suspicious ABI/method context
   => weighted by proximity/time/amount/wallet role
   => LLM cannot invent facts

4. Unknown origin / coverage gap
   uncertainty score, not automatic HIGH
   => dampenable by operational wallet context

5. Operational and clean-source context
   can reduce source-policy, unknown-origin and weak contract risk
   cannot reduce hard proof
```

Final score:

```text
if hardProofScore >= 85:
  finalScore = hardProofScore
else:
  finalScore = max(
    sourcePolicyScoreAfterDampening,
    contractSuspicionScoreAfterGuards,
    unknownOriginScoreAfterCaps,
    behaviorRiskScore,
    fastWalletScore
  )
```

Do not sum all weak signals globally. Multiple weak contexts should strengthen risk modestly, not explode into CRITICAL.

For multiple source-policy scores:

```ts
function aggregateLayerScores(scores: number[]): number {
  const sorted = [...scores].sort((a, b) => b - a);
  const first = sorted[0] ?? 0;
  const second = sorted[1] ?? 0;
  const third = sorted[2] ?? 0;

  return clamp(
    first + Math.min(10, second * 0.15) + Math.min(5, third * 0.05),
    0,
    100
  );
}
```

## Risk Bands And Decision Thresholds

| Score | Band | User decision | Meaning |
|---:|---|---|---|
| `0-19` | LOW | ACCEPTABLE | Clean or very weak context |
| `20-39` | LOW-MEDIUM | ACCEPTABLE | Some uncertainty/context |
| `40-59` | MEDIUM | ACCEPTABLE with warning | Policy/unknown exposure exists but not enough for decline |
| `60-84` | HIGH | DECLINE | Strong source-policy, contract, mule, or unresolved high-risk context |
| `85-100` | CRITICAL | DECLINE | Hard proof or near-hard policy/behavioral evidence |

Special cap:

```text
If score 60-64 comes only from unknown/coverage and wallet is operational,
cap to 55 unless close/fresh/large/high-continuity evidence exists.
```

## Hard Proof Policy

Hard proof directly produces `DECLINE` and cannot be dampened.

| Signal | Score | Decision | Dampening |
|---|---:|---|---|
| USDT blacklist | `95-100` | DECLINE | No |
| Exact scam/stolen/phishing label | `90-100` | DECLINE | No |
| Confirmed stolen/scam cluster | `90-100` | DECLINE | No |
| Exact approve -> transferFrom -> checked wallet | `95-100` | DECLINE | No |
| Exact approve -> transferFrom -> deposit receiver | `95-100` | DECLINE | No |
| Approval drain route-linked 1 hop, strong amount/time, no service guard | `85-92` | DECLINE | No operational dampening, but wording must be route-linked |
| Approval drain route-linked 2 hops | `78-88` | DECLINE if strong continuity | No exact-drain wording unless exact criteria satisfied |

Exact approval-drain provenance means:

```text
approve -> transferFrom -> funds reach checked wallet / deposit receiver
```

Without this exact deterministic chain, the system must not say:

```text
drainer proven
exact approval-drain provenance
stolen funds confirmed
```

## Source Policy Scoring

### Source Severity Ranges

| Source kind | Interpretation | Default range |
|---|---|---:|
| Exact blacklist/scam/stolen/USDT blacklist | Hard proof | `90-100` |
| Exact approval-drain provenance | Hard proof | `95-100` |
| HTX/Huobi | High source-policy | `18-90` |
| WhiteBIT | Medium source-policy | `20-68` |
| Bridge/router/DEX/cross-chain | Source-policy boundary | `55-82` |
| Unknown contract | Unproven contract boundary | `25-75` |
| Unknown CEX/service | Non-clean service boundary | `35-55` |
| Unknown EOA origin | Provenance uncertainty | `25-45` |
| Allowlisted CEX | Clean source | `0-10` |

### HTX/Huobi

Aggregate share table:

| Aggregate HTX/Huobi share | Base score | Normal result | Notes |
|---:|---:|---|---|
| `<5%` | `18` | ACCEPTABLE | Weak context only |
| `5-10%` | `30` | ACCEPTABLE | Warning |
| `10-20%` | `44-45` | ACCEPTABLE / MEDIUM warning | Decline only if very close, fresh, fast, strong continuity |
| `20-30%` | `54-55` | ACCEPTABLE or DECLINE by context | Usually warning; decline if mule-like |
| `30-50%` | `68` | Usually DECLINE | Can be capped lower only with strong operational + clean coverage |
| `50-80%` | `78-80` | DECLINE | High source-policy decline |
| `>80%` | `85-88` | DECLINE | Critical source-policy exposure |

Recommended behavior:

| Situation | Score | Decision |
|---|---:|---|
| `<5%`, old/operational, no hard evidence | `22-35` | ACCEPTABLE |
| `5-10%`, not close/fast | `34-45` | ACCEPTABLE |
| `10-20%`, 1-2 hops, operational | `45-55` | ACCEPTABLE warning |
| `10-20%`, direct/fast/fresh/strong continuity | `60-72` | DECLINE |
| `20-30%`, close/fast | `60-70` | DECLINE |
| `30-50%` | `68-78` | Usually DECLINE |
| `>50%` | `78-85` | DECLINE |
| `>80%`, direct/fast/fresh | `85-90` | DECLINE / CRITICAL edge |

Mandatory wording:

```text
HTX/Huobi source-policy exposure was detected.
This is exchange-policy risk, not scam/blacklist proof and not approval-drain proof.
```

### WhiteBIT

WhiteBIT is medium policy risk, not hard evidence.

| Aggregate WhiteBIT share | Base score | Decision |
|---:|---:|---|
| `<10%` | `20-30` | ACCEPTABLE warning |
| `10-30%` | `32-45` | ACCEPTABLE warning |
| `30-50%` | `48-58` | ACCEPTABLE / MEDIUM warning |
| `>50%` | `55-68` | DECLINE only if strict policy requires or close/fast/fresh |

If business policy requires categorical WhiteBIT decline, make it config-driven:

```ts
policyConfig.sourcePolicy.whitebit.mode = "strict_decline";
```

Forensic score still must not put WhiteBIT into `hardBadEvidence`.

Mandatory wording if declined:

```text
Declined by exchange source policy. This is not scam/blacklist proof.
```

### Bridge / Router / DEX / Cross-Chain

| Situation | Score | Decision | Wording |
|---|---:|---|---|
| Direct bridge/router/DEX, recent, strong continuity | `70-82` | DECLINE | source-policy boundary |
| 1-2 hops, fast, high continuity | `65-78` | DECLINE | source-policy boundary |
| 3-5 hops, old/historical | `50-65` | Contextual | not scam proof |
| OFT/LayerZero/cross-chain boundary, strict policy | `65-82` | Usually DECLINE | cross-chain/source-policy boundary |
| Known legitimate service, weak/no risky behavior | `35-50` | ACCEPTABLE warning if policy allows | service context |
| Old operational wallet, historical bridge context only | `35-55` | Depends on policy | historical policy context |

Mandatory wording:

```text
Cross-chain/source-policy boundary reached. This is not drainer proof.
```

LLM may classify a contract as a legitimate bridge/service, but it should not erase deterministic cross-chain boundary facts unless policy explicitly allows such flows.

### Unknown Contract / Unknown Origin

| Scenario | Score | Decision |
|---|---:|---|
| Unknown origin, old operational liquidity wallet | `25-40` | ACCEPTABLE warning |
| Unknown EOA origin, ordinary unknown wallet | `25-45` | ACCEPTABLE warning |
| Unknown CEX/service, no bad evidence | `35-50` | ACCEPTABLE or warning |
| Unknown contract, old operational wallet, weak continuity | `25-40` | ACCEPTABLE |
| Unknown contract, ordinary wallet, limited coverage | `40-55` | ACCEPTABLE warning or policy decline |
| Unknown contract, fresh one-shot, direct, large, fast, strong continuity | `60-75` | DECLINE |
| Unknown contract + LLM `legitimate_service`, high confidence, no hard evidence | `20-35` | ACCEPTABLE warning |
| Unknown contract + LLM `drainer_like`, no exact transferFrom provenance | `65-80` | DECLINE as suspicion, not exact proof |
| Unknown contract + exact transferFrom drain proof | `95-100` | DECLINE |

Important:

```text
Unknown origin itself is not HIGH by default.
Unknown origin + operational liquidity wallet + no hard bad evidence = warning, not automatic decline.
```

## Path Context Modifiers

### Hop / Proximity

| Hops from source boundary to checked wallet/deposit | Adjustment |
|---:|---:|
| Direct / 0 | `+14` |
| 1 | `+10` to `+12` |
| 2 | `+6` to `+8` |
| 3-5 | `0` to `+2` |
| 6-12 | `-6` to `-8` |
| 13-20 | `-12` to `-15` |
| `>20` | Context only, normally no source proof |

Fast-chain exception:

```text
7 hops in 20 minutes = strong link.
7 hops in 3 months = weak historical context.

If avgTimePerHop <= 1h and amountContinuity >= 0.80:
  suppress negative hop decay or apply only 25%.

If totalElapsed <= 1h and amountContinuity >= 0.80:
  long hop count should not strongly reduce risk.

If avgTimePerHop <= 24h and amountContinuity >= 0.70:
  apply only 50% of negative hop decay.

If avgTimePerHop > 7d:
  apply full or stronger historical-context penalty.
```

### Time

| Source -> checked wallet elapsed time | Adjustment |
|---|---:|
| `<=10 minutes` | `+10` to `+12` |
| `<=1 hour` | `+8` to `+10` |
| `<=6 hours` | `+5` to `+7` |
| `<=24 hours` | `+3` to `+4` |
| `<=7 days` | `0` |
| `<=30 days` | `-5` |
| `>30 days` | `-12` |

For old operational wallets, `>30d` should normally be historical context unless there is repeated current exposure.

### Amount Continuity

Amount continuity estimates whether the same economic amount moved through the path.

Example:

```text
wallet receives 100,500 USDT
10 minutes later sends 100,000 USDT
=> strong continuity
```

| Amount preservation | Adjustment |
|---:|---:|
| `>=0.95` | `+8` |
| `0.90-0.95` | `+6` |
| `0.70-0.90` | `+3` |
| `0.40-0.70` | `-5` to `-6` |
| `<0.40` | `-12` and apply cap |

Critical cap:

```text
If amountContinuity < 0.40:
  HTX/Huobi score cannot exceed 55 unless:
    - aggregate HTX/Huobi share >= 50%, or
    - direct path + elapsed <= 1h + fresh one-shot wallet, or
    - repeated independent HTX/Huobi paths exist.
```

Weak continuity can be useful for search recall, especially in incoming deposit mode, but must not create hard-like scoring.

### Wallet Role

| Wallet role | Adjustment |
|---|---:|
| Fresh one-shot wallet | `+8` to `+12` |
| Mule/transit wallet | `+10` to `+15` |
| Collector | `+4` to `+8` |
| Unknown wallet | `0` |
| Operational liquidity wallet, confidence `65-80` | `-8` to `-10` |
| Operational liquidity wallet, confidence `80+` | `-12` to `-15` |
| Old operational + clean coverage `>70%` | `-12` |
| Old operational + clean coverage `>90%` | `-15` |
| Exchange-like/service wallet | `-10` to `-15` if no hard proof, or stop propagation |
| Long-lived regular activity | `-5` to `-10` |

Dampening eligibility:

| Evidence | Operational dampening? |
|---|---|
| Exact scam/blacklist/USDT blacklist | No |
| Exact approval-drain provenance | No |
| HTX/Huobi `<30%` | Yes |
| HTX/Huobi `30-50%` | Limited |
| HTX/Huobi `>=50%` | No, or floor at `78` |
| WhiteBIT | Yes |
| Unknown contract | Yes, unless fresh-fast-strong-continuity |
| Bridge/router/DEX | Limited; depends on exchange policy |
| Unknown origin | Yes |

### Repeated Exposure

| Pattern | Adjustment |
|---|---:|
| 1 path | `0` |
| 2-3 independent same-source policy paths | `+4` to `+5` |
| 4+ independent same-source policy paths | `+8` |
| Repeated across multiple days | `+0` to `+5` depending recency |
| Repeated + close/fast/high continuity | `+8` to `+12` |

Important distinction:

```text
Repeated historical exposure across years in an operational wallet != repeated mule-like exposure in one short window.
```

### Coverage / Data Quality

Low coverage creates uncertainty, not automatic HIGH.

| Coverage / data quality | Uncertainty score |
|---|---:|
| `>=90%` | `0-3` |
| `70-90%` | `3-6` |
| `50-70%` | `6-10` |
| `30-50%` | `10-15` |
| `<30%` | `15-25` |

Caps:

```text
Unknown origin + old operational wallet:
  cap final unknown-origin risk at 40.

Unknown origin + ordinary unknown wallet:
  cap at 55 unless fresh one-shot / mule / large / fast facts exist.

No balance-forming transfers:
  usually insufficient_coverage 45-55,
  not automatic HIGH 65+.

LLM unavailable:
  warning only, not automatic hard decline.
```

## Link Strength And Effective Exposure

Use link strength for aggregation and scoring, not as final score by itself.

```ts
export type PathMetrics = {
  rawShare: number;
  hops: number;
  totalTimeMs: number | null;
  avgTimePerHopMs: number | null;
  amountPreservation: number;
};
```

Suggested factors:

```ts
function hopFactor(hops: number): number {
  if (hops <= 0) return 1.15;
  if (hops === 1) return 1.10;
  if (hops === 2) return 1.00;
  if (hops <= 5) return 0.85;
  if (hops <= 12) return 0.65;
  return 0.45;
}

function timeFactor(totalTimeMs: number | null): number {
  if (totalTimeMs == null) return 0.90;
  const h = totalTimeMs / 3_600_000;
  if (h <= 1) return 1.15;
  if (h <= 24) return 1.05;
  if (h <= 24 * 7) return 0.90;
  if (h <= 24 * 30) return 0.75;
  return 0.55;
}

function amountFactor(ratio: number): number {
  if (ratio >= 0.95) return 1.10;
  if (ratio >= 0.90) return 1.05;
  if (ratio >= 0.70) return 1.00;
  if (ratio >= 0.40) return 0.70;
  return 0.45;
}
```

```text
linkStrength =
  hopFactor(hops)
  * timeFactor(totalTimeMs)
  * amountFactor(amountPreservation)

linkStrength = clamp(linkStrength, 0.25, 1.25)
```

Exposure:

```text
rawExposureShare = sum(path.rawShare for sourceKind)
effectiveExposureShare = sum(path.rawShare * path.linkStrength for sourceKind)

curveShare =
  sourceKind === "htx_huobi" && rawExposureShare >= 0.5
    ? rawExposureShare
    : max(rawExposureShare * 0.75, effectiveExposureShare)
```

Why:

```text
raw share prevents undercounting majority HTX;
effective share rewards close/fast/high-continuity paths;
historical weak paths get discounted.
```

## Source Policy Formula

```text
sourcePolicyScore =
  baseShareScore(sourceKind, curveShare)
  + bestPathContextAdjustment
  + repetitionAdjustment
  + dataQualityAdjustment
  + walletRoleAdjustment
  + cleanCoverageAdjustment

sourcePolicyScore = clamp(sourcePolicyScore, floorBySource, capBySourceAndShare)
```

For cross-source aggregation:

```text
sourcePolicyScore =
  top source score
  + up to 10 points from second source
  + up to 5 points from third source
```

## LLM Policy

LLM can classify:

```text
legitimate_service
drainer_like
unknown_suspicious
unknown_insufficient_data
```

LLM cannot create:

```text
blackchain transfer facts
exact approval-drain proof
USDT blacklist proof
scam/stolen proof
```

Rules:

```text
LLM legitimate_service:
  can lower unknown-contract risk to cap 20-35 or 35-45 depending source-policy boundary.

LLM drainer_like:
  can raise contextual contract_suspicion risk.
  cap 65-80 unless deterministic transferFrom/drain facts exist.
  cannot become exact_approval_drain_provenance by itself.

LLM unavailable:
  warning only.
  not automatic hard decline.
  for fresh/large/close/strong-continuity unknown contract, deterministic facts can still decline.
```

## Proof Level Rules

Proof level must come from structured layers:

```ts
const topLayer = assessment.riskLayers.sort(byScore)[0];
return topLayer?.proofLevel ?? "insufficient_coverage";
```

Do not infer proof level by parsing reason text:

```ts
reasonText.includes("htx")
reasonText.includes("bridge")
reasonText.includes("drain")
```

Suggested proof semantics:

| Evidence | Proof level |
|---|---|
| Exact approval drain | `exact_approval_drain_provenance` |
| Scam/blacklist/stolen label | exact hard proof level already used by project |
| High source-policy decline | `exchange_policy_decline` |
| Medium source-policy context | `exchange_policy_context` or existing nearest equivalent |
| Operational wallet with uncertainty | `operational_liquidity_context` |
| Unknown/coverage only | `insufficient_coverage` |
| LLM suspicion without exact drain | `llm_assisted_suspicion` or nearest existing equivalent |

If the project currently lacks some proof-level enum values, add them deliberately or map to existing closest values with explicit comments.

## Trace Policy

`moneyOriginTrace.ts` must not stop on any `DECLINE`.

Hard early stop only:

```text
risky_label
exact scam/stolen/blacklist
exact approval drain, if visible at this layer
```

Do not early-stop for:

```text
HTX/Huobi
WhiteBIT
bridge/router/DEX
cross-chain
unknown contract
unknown CEX/service
```

Reason:

```text
If first terminal is HTX/bridge/DEX policy boundary, search may miss alternative clean CEX or lower-risk branches.
```

## Incoming Deposit Policy

Incoming deposit mode must reuse weighted scoring. It must not map every path-level `REVIEW` to hard `DECLINE`.

Correct internal classification:

```ts
if (path.rootSourceType === "risky_label") return "hard_decline";
if (path.sourceExposureKind === "htx_huobi") return "high_policy";
if (path.sourceExposureKind === "bridge_router_dex") return "high_policy";
if (path.sourceExposureKind === "cross_chain_boundary") return "high_policy";
if (path.sourceExposureKind === "whitebit") return "medium_policy";
if (path.stoppedReason === "unlabeled_service_boundary") return "unknown";
```

Report should show:

```text
raw share
effective share
hops
elapsed time
average time per hop
amount continuity
source policy kind
proof level
fast sender risk separately
```

## Expected Cases

### Case A: 15% HTX/Huobi, 1-2 hops, operational wallet, no hard evidence

```text
base: 44-45
1-2 hops: +6 to +12
ordinary/unknown time: 0
strong continuity: +3 to +6
operational dampening: -10 to -12

final: 43-55
decision: ACCEPTABLE
band: LOW-MEDIUM / MEDIUM
proof: source-policy context / operational liquidity context
```

Wording:

```text
HTX/Huobi exposure is about 15% of selected provenance. This is exchange source-policy context, not scam/blacklist/drainer proof. Wallet behavior looks operational/liquidity-like and no hard bad evidence was found.
```

### Case B: 15% HTX/Huobi, direct, <=1h, strong continuity, fresh one-shot

```text
base: 44-45
direct / 1 hop: +10 to +14
<=1h: +8 to +10
strong continuity: +6
fresh one-shot: +8 to +12
reasonable cap: 65-75

decision: DECLINE
reason: fast close HTX/Huobi-funded flow
```

### Case C: >50% HTX/Huobi close path

```text
base: 78-80
close path: +8 to +12
recent/fast: +3 to +8
strong continuity: +3 to +8
floor: 78
cap: 85-90

decision: DECLINE
proof: exchange_policy_decline
wording: high-share HTX/Huobi source-policy decline, not scam proof
```

### Case D: Unknown origin, old operational liquidity wallet, no hard evidence

```text
unknown origin base: 35-45
coverage penalty: +3 to +8
operational dampening: -10 to -15
old regular activity: -5

final: 25-40
decision: ACCEPTABLE
proof: operational_liquidity_context / insufficient clean-source proof
```

### Case E: Unknown contract close to fresh one-shot sender, large deposit, strong amount/time continuity

```text
unknown contract base: 45-55
direct / 1 hop: +12
<=1h: +8
strong continuity: +6
fresh one-shot: +8
large deposit: +5
cap without exact proof: 75

final: 68-75
decision: DECLINE
proof: contract/source-boundary suspicion, not exact scam proof
```

### Case F: Exact approval drain

```text
approve found: yes
transferFrom confirmed: yes
funds reach checked wallet/deposit receiver: yes
amount/time path proven: yes

final: 95-100
decision: DECLINE
proof: exact_approval_drain_provenance
```

No dampening applies.

### Case G: LayerZero / OFT / bridge path

```text
bridge / OFT / cross-chain boundary: 65-82 depending share/proximity/time
decision: usually DECLINE if strict exchange policy
proof: exchange_policy_decline / source_policy_boundary
wording: cross-chain/source-policy boundary, not drainer proven
```

If LLM or contract classification says `legitimate_service`, it may reduce unknown-contract suspicion but should not erase bridge/cross-chain source-policy facts unless policy explicitly allows such flows.

## Report Wording Requirements

### HTX minority

```text
ACCEPTABLE - 48/100 MEDIUM

HTX/Huobi exposure is 15% of selected provenance target.
This is exchange source-policy risk, not scam/blacklist proof and not approval-drain proof.
The wallet looks operational/liquidity-like. No hard bad evidence was found.
```

### HTX majority

```text
DECLINE - 84/100 HIGH

HTX/Huobi exposure is 62% of selected provenance target through close, high-continuity paths.
This is a high source-policy decline. It is not by itself scam/drain proof.
```

### Unknown contract fresh one-shot

```text
DECLINE - 72/100 HIGH

Clean origin is not proven. Funds reached the checked deposit through a close unknown-contract boundary with strong amount/time continuity and fresh one-shot sender behavior.
This is contract/source uncertainty risk, not exact scam proof.
```

### Exact approval drain

```text
DECLINE - 98/100 CRITICAL

Exact approval-drain provenance was confirmed:
approve -> transferFrom -> funds reached the checked wallet/deposit receiver.
```

## Acceptance Criteria

1. HTX/Huobi, WhiteBIT, bridge/router/DEX, cross-chain, unknown contract and LLM suspicion no longer enter `hardBadEvidence`.
2. `hardBadEvidence` contains only deterministic hard proof.
3. HTX/Huobi fixed `78` is replaced by weighted source exposure.
4. HTX/Huobi aggregate share is calculated across paths.
5. Path context includes hops, elapsed time, average time per hop, amount continuity, repetition and wallet role.
6. Weak amount continuity caps source-policy risk unless majority share or fresh-fast-direct conditions exist.
7. Operational wallet context can dampen low-share policy/unknown risk.
8. Operational wallet context cannot dampen hard proof.
9. LLM `legitimate_service` can lower unknown contract risk.
10. LLM `drainer_like` cannot create exact drain proof without deterministic transferFrom facts.
11. `moneyOriginTrace.ts` does not early-break on policy `DECLINE`.
12. Incoming deposit mode uses the same weighted scoring semantics as where-is-money.
13. Proof levels are derived from structured evidence/layers, not reason text.
14. User-facing final decision remains only `ACCEPTABLE` or `DECLINE`.
15. Reports explicitly separate hard proof, source-policy risk, contract suspicion, unknown origin, data quality and operational dampening.
16. The TVz-like 15% HTX operational wallet case becomes `ACCEPTABLE`, about `45-55`, not fixed `78 HIGH`.
17. High-share HTX/Huobi remains `DECLINE`, about `78-88`.
18. Exact approval drain remains `DECLINE`, `95-100`.

## Source Documents

This spec adapts and consolidates:

- `C:/Users/User/Downloads/final_scoring_architecture_solution.md`
- `C:/Users/User/Downloads/final_scoring_solution.md`

The source files contain mojibake Russian text in the local copy, but the technical content was recoverable through the code snippets, tables, English terms, and repeated structure.
