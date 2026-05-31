# Weighted Source Policy Calibration v2

## Context

This document replaces the old `2026-05-31-weighted-htx-huobi-policy.md` plan as an implementation target.

The old plan solved a real production problem:

```text
HTX/Huobi close in path => fixed 78/100 HIGH DECLINE
```

That was too rigid for operational/liquidity wallets. A path with roughly 15% HTX/Huobi exposure could dominate the whole wallet result even when:

- no blacklist/scam/approval-drain proof existed;
- most funds were ordinary EOA or clean CEX-like liquidity;
- the wallet had strong operational behavior;
- the risky source was source-policy context, not taint proof.

Since then the codebase changed substantially. The current system already has:

- typed `SourceExposureKind`;
- `RiskLayerScore` / `SourcePolicyEvidence`;
- `provenanceScoring.ts` with weighted source-policy scoring;
- low-balance recent-flow provenance;
- transaction-centric incoming-deposit provenance through shared `where-is-money`;
- LayerZero/OFT bridge classification and LLM legitimate-service verdicts;
- separation between `hardBadEvidence`, source-policy context, LLM suspicion, and operational context.

This v2 spec is not a "start from zero" implementation plan. It is a calibration and consistency plan for the current architecture.

## Current Code Map

| Area | Current owner | Current role |
|---|---|---|
| Path stop classification | `src/forensics/moneyOriginPolicy.ts` | Finds allowlisted CEX, HTX/Huobi, WhiteBIT, bridge/router/DEX, unknown contract |
| Weighted source scoring | `src/forensics/provenanceScoring.ts` | Scores source-policy exposure by share, hops, time, continuity, wallet role, coverage |
| Final wallet assessment | `src/forensics/moneyOriginOperationalAssessment.ts` | Combines hard proof, source policy, LLM verdicts, unknown origin, operational behavior |
| Report shaping | `src/check/whereIsMoneyCheck.ts` | Builds `WhereIsMoneyReport`, proof level, coverage notes |
| Incoming deposit | `src/forensics/incomingDepositJob.ts` | Seeds `where-is-money` from a concrete incoming tx |
| Contract LLM | `src/forensics/contractLlmVerdict.ts` | Classifies contract case files from gathered on-chain facts |
| Generic/legacy risk | `src/risk/*`, `src/check/deepForensicCheck.ts` | Still has older risk labels and direct-counterparty logic |

## Already Solved

### Fixed HTX/Huobi no longer dominates all cases

Current behavior observed on `TVzGYWyg89wUmwhvbcwfonHVLDYYQAiZMF`:

```text
HTX exposure: about 15%
Decision: ACCEPTABLE
Risk: 54/100 MEDIUM
Evidence type: exchange_policy_context
Hard bad evidence: none
```

This is the right direction. The system now says:

```text
HTX/Huobi exposure is source-policy risk.
It is not scam proof.
It is not blacklist proof.
It is not approval-drain proof.
```

### Operational wallets are dampened

Observed:

```text
TEYPU... -> ACCEPTABLE 25/100 LOW-MEDIUM
TTs9x... -> ACCEPTABLE 25/100 LOW-MEDIUM
THRSTA... -> ACCEPTABLE 28/100 LOW-MEDIUM
```

These are cases where clean origin is not fully proven, but no hard bad evidence exists and wallet behavior looks operational/liquidity-like.

### Low-balance mode is no longer broken

When current USDT balance is near zero, the system now uses recent-flow provenance instead of returning "balance is zero, cannot trace".

Observed:

```text
THRSTA... current balance 0.38 USDT -> recent-flow anchor 3,243 USDT
TPvF4... current balance 0.147 USDT -> recent-flow anchor 1,289,099 USDT
```

### LayerZero/OFT bridge false-drainer wording improved

Observed on `TPvF4YmjYFVH8jBYUD63mEAxwPssZoL7Jb`:

```text
TKSQr... = legitimate_service / LayerZero Executor
TFG4w... = legitimate_service / UsdtOFT bridge
Decision remains DECLINE by bridge/cross-chain source policy
No drainer proof wording
```

This is materially better than calling OFT bridge delivery `drainer_like`.

## Remaining Problems

### Problem 1: legacy path decision is still partly separate from final source-policy scoring

`moneyOriginPolicy.ts` still returns path-level verdicts like:

```text
HTX/Huobi path share >= 50% => DECLINE
WhiteBIT path share >= 50% => DECLINE
Bridge/router/DEX => fixed DECLINE 78
```

The final result is now produced by `moneyOriginOperationalAssessment.ts`, so this usually works. But the intermediate `combineMoneyOriginDecision()` still influences whether contract LLM is triggered:

```ts
const deterministicDecision = fastDecline || approvalDrainDecline ? "DECLINE" : combined.decision;
const needsContractLlmForDecision = deterministicDecision === "REVIEW" || approvalDrainReviewFindings.length > 0;
```

This can make LLM triggering depend on old path-level `REVIEW/DECLINE` semantics instead of the typed risk layer summary.

Desired behavior:

```text
LLM trigger should be based on typed evidence needs:
unknown_contract boundary
approval review finding
contract-only path
source-policy boundary needing classification
not on legacy combined path verdict alone
```

### Problem 2: source-policy exposure is not visible enough in user reports

The CLI prints some source-policy information through reasons, but the bot report should explicitly show:

```text
Source policy exposure
- HTX/Huobi: 15% raw / 14% effective, 54/100, context
- WhiteBIT: ...
- Cross-chain: ...
```

This matters because users need to understand why a wallet is `54 MEDIUM` while still `ACCEPTABLE`.

### Problem 3: HTX/Huobi score curve needs calibration against real wallets

The current curve works better than fixed 78, but live smoke shows:

```text
TVzGY... 15% HTX -> 54 MEDIUM ACCEPTABLE
```

That is acceptable, but the target should be explicit:

| Case | Target |
|---|---|
| 10-20% HTX, operational wallet, no hard evidence | `45-55`, ACCEPTABLE |
| 10-20% HTX, direct/fast/fresh one-shot sender | `60-72`, DECLINE |
| 20-30% HTX, operational but close/fast | `55-65`, depends on context |
| 30-50% HTX | `65-78`, usually DECLINE |
| >=50% HTX | `78+`, DECLINE |

The code has tests for several tiers, but the live targets should become explicit regression cases.

### Problem 4: bridge/cross-chain policy needs a mode switch

Current behavior:

```text
Known legitimate LayerZero/OFT bridge => no drainer proof
But still DECLINE 75/100 by cross-chain/bridge policy
```

This may be correct for strict exchange policy. But the scoring engine should distinguish:

```text
bridge/cross-chain policy decline
legitimate bridge service warning
drainer proof
```

Recommended config:

```ts
sourcePolicy.bridge.mode =
  | "strict_decline"
  | "weighted_policy"
  | "allow_legitimate_service_warning";
```

Default can remain `strict_decline` for now.

### Problem 5: LLM contract verdict still needs an approval-episode layer

The old plan included `Approval Episode LLM Classifier`. Current code has contract LLM verdicts and service-route guards, but not a fully separate episode model that reports:

```text
current approval verdict
episode verdict
drain proof risk
approval safety risk
service route guard
```

Observed risk:

```text
TLhVzk... remains DECLINE 90 CRITICAL due to LLM drainer_like for TJpMj...DvaQ.
TPwez bridge is correctly legitimate_service.
But active approvals and later suspicious contracts are still easy to mix in explanation.
```

The system should be able to say:

```text
TPwez approval: legitimate bridge route
TNKG approval: unknown active unlimited contract, medium hygiene risk unless drain facts exist
TJpMj contract: separate LLM drainer-like contract suspicion
Exact drain: only if approve -> transferFrom -> checked wallet/receiver is proven
```

### Problem 6: legacy modules may still use older policy semantics

`where-is-money` and incoming deposit now mostly share the new logic. But older areas still need audit:

- `src/risk/riskPolicyEngine.ts`
- `src/risk/evaluation.ts`
- `src/check/deepForensicCheck.ts`
- direct counterparty exposure logic
- approval worker/recheck report text
- Telegram formatter sections

The target is not to delete all older checks. The target is to prevent source-policy context from being displayed as exact scam/blacklist/taint proof.

## Updated Decision Contract

Final decisions must use these layers in this priority order:

1. Deterministic hard proof
   - blacklist;
   - USDT blacklist;
   - exact approval-drain provenance;
   - confirmed scam/stolen label.

2. LLM-assisted contract suspicion
   - only when case file is complete enough;
   - never called exact drain without deterministic transferFrom facts;
   - high-confidence `drainer_like` can decline as suspicion.

3. Strict source-policy boundary
   - HTX/Huobi majority;
   - bridge/router/DEX/cross-chain if configured strict;
   - other exchange policy sources.

4. Weighted source-policy context
   - HTX/Huobi minority;
   - WhiteBIT;
   - unknown CEX/service;
   - unknown contract without drainer proof.

5. Unknown origin / coverage quality
   - clean source not fully proven;
   - no previous transfer;
   - weak amount/time continuity.

6. Operational dampening
   - wallet age;
   - liquidity behavior;
   - repeated relationships;
   - high turnover without hard bad evidence.

## Score Targets

### HTX/Huobi

| Exposure | Normal operational wallet | Fresh/direct/fast path |
|---:|---:|---:|
| `<5%` | `18-30`, ACCEPTABLE | `30-45`, ACCEPTABLE/WARNING |
| `5-10%` | `30-42`, ACCEPTABLE | `45-58`, context |
| `10-20%` | `45-55`, ACCEPTABLE/MEDIUM | `60-72`, DECLINE |
| `20-30%` | `54-62`, depends | `65-75`, DECLINE |
| `30-50%` | `65-78`, usually DECLINE | `72-82`, DECLINE |
| `>=50%` | `78+`, DECLINE | `82+`, DECLINE |

### WhiteBIT

| Exposure | Target |
|---:|---|
| `<10%` | `20-30`, ACCEPTABLE warning |
| `10-30%` | `32-45`, ACCEPTABLE warning |
| `30-50%` | `48-58`, MEDIUM context |
| `>=50%` | `60-68`, DECLINE only by strict/close/high-share policy |

### Bridge / Router / DEX / Cross-chain

| Mode | Behavior |
|---|---|
| `strict_decline` | `65-82`, DECLINE, wording says source-policy boundary |
| `weighted_policy` | score by share/proximity/continuity; legitimate service can reduce but not erase boundary |
| `allow_legitimate_service_warning` | high-confidence legitimate service + no hard evidence can become ACCEPTABLE warning |

Default remains `strict_decline`.

### Unknown Contract

| Case | Target |
|---|---|
| Unknown contract only, old operational wallet | `25-40`, ACCEPTABLE warning |
| Unknown contract direct/fresh/large/fast | `60-75`, DECLINE |
| LLM legitimate_service high confidence | `20-35`, ACCEPTABLE warning |
| LLM drainer_like high confidence, no exact drain | `65-85`, DECLINE as suspicion |
| Exact transferFrom drain proof | `95-100`, DECLINE exact proof |

## Report Language Rules

Never say:

```text
Hard bad evidence: HTX
Hard bad evidence: WhiteBIT
Hard bad evidence: bridge
Hard bad evidence: unknown contract
Drainer proven by LLM only
```

Do say:

```text
Source-policy exposure: HTX/Huobi 15% of selected provenance target.
This is exchange-policy risk, not scam/blacklist proof.
Cross-chain boundary reached. This is not drainer proof.
LLM classified contract as legitimate_service/drainer_like based on the gathered case file.
Exact approval-drain proof was/was not found.
```

## Acceptance Criteria

1. `TVzGY...` stays `ACCEPTABLE` for roughly 15% HTX unless new hard evidence appears.
2. `TVzGY...` report explicitly shows HTX/Huobi share and says it is source-policy context.
3. `TEYPU...`, `TTs9x...`, and similar operational wallets stay LOW-MEDIUM/ACCEPTABLE when no hard evidence exists.
4. `TPvF4...` says LayerZero/OFT/cross-chain policy boundary, not drainer proof.
5. `TLhVzk...` report separates legitimate bridge approval/context from separate drainer-like contract suspicion.
6. LLM high-confidence `legitimate_service` can lower unknown-contract risk only for covered unresolved paths.
7. LLM `drainer_like` cannot be reported as exact approval-drain unless deterministic transferFrom provenance exists.
8. Incoming deposit reports and manual where-is-money reports use the same source-policy evidence summary.
9. Full test suite and live smoke pass after implementation.
