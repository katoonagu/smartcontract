# Final Scoring Gap Closure Design

## Purpose

This spec closes the remaining gaps between the ChatGPT Pro final scoring design and the current codebase after the weighted provenance scoring work.

The goal is not to recalibrate the current HTX/Huobi score curve. The current, slightly softer table is intentionally kept:

| Aggregate HTX/Huobi share | Current base score |
|---:|---:|
| `<5%` | `18` |
| `5-10%` | `30` |
| `10-20%` | `45` |
| `20-30%` | `54` |
| `30-50%` | `68` |
| `50-80%` | `78` |
| `80%+` | `85` |

The remaining work is about correctness and consistency:

```text
source-policy risk != scam proof
LLM suspicion != deterministic hard proof
policy boundary in one trace branch must not hide cleaner alternative branches
legacy policy engines must not reintroduce fixed HTX/Huobi hard scoring
```

## Non-Goals

- Do not change the current HTX/Huobi base score table in `src/forensics/provenanceScoring.ts`.
- Do not add a new detailed source-policy breakdown section to Telegram reports in this task.
- Do not loosen exact hard proof: scam labels, blacklist, USDT blacklist, and exact approval-drain provenance still override everything.
- Do not make LLM a source of blockchain facts. LLM remains a classifier over gathered facts.

## Current Audit Against The Pro Implementation Plan

### Done

| Plan area | Current status |
|---|---|
| Weighted source-policy scoring | Implemented in `src/forensics/provenanceScoring.ts`. It scores source exposure by share, hops, elapsed time, amount continuity, repeated exposure, data quality, wallet role, and age. |
| Current softer HTX/Huobi curve | Implemented and tested in `tests/forensics/provenanceScoring.test.ts`. This is intentionally kept. |
| Path stop metadata | Implemented in `src/forensics/moneyOriginPolicy.ts`; HTX/Huobi, WhiteBIT, bridge/router/DEX, unknown contracts carry source-policy metadata. |
| HTX/Huobi out of hard evidence in operational assessment | Mostly implemented in `src/forensics/moneyOriginOperationalAssessment.ts`; tests cover minority and majority HTX/Huobi not being `htx_huobi_source` hard evidence. |
| WhiteBIT medium policy behavior | Implemented in weighted scoring and operational assessment tests. |
| Operational wallet dampening | Implemented in `moneyOriginOperationalAssessment.ts`; operational wallets can remain ACCEPTABLE without hard proof. |
| Positive LLM legitimate service dampening | Implemented through `topLegitimateServiceLlmVerdict()` and unknown-contract dampening when the positive verdict covers unresolved contract paths. |
| Zero-confidence unknown LLM verdict guard | Implemented; tests verify zero-confidence `unknown_suspicious` does not promote to hard risk. |
| Service-route guard for bridge-like/LayerZero-like context | Partially implemented; tests verify guarded route-linked profiles and LLM verdicts do not become exact approval-drain proof. |

### Not Done / Still Risky

| Gap | Evidence | Risk |
|---|---|---|
| Trace stops too early after any `DECLINE` terminal | `src/forensics/moneyOriginTrace.ts` still has `if (terminals.some((path) => path.verdict === "DECLINE")) break;` | A source-policy boundary on one beam branch can prevent exploration of an alternative branch that would reach Binance/Bybit/OKX. |
| Legacy `riskPolicyEngine` still has fixed HTX/Huobi minimum `78` | `src/risk/riskPolicyEngine.ts` returns `scoreAtLeast(input.moneyOriginScore, 78)` for `htx_huobi_source` | This file is not imported by production code today, but it is a dangerous stale entry point. Future code could reintroduce old behavior. |
| LLM `drainer_like` can still enter `hardBadEvidence` | `hardEvidenceFromLlm()` in `src/forensics/moneyOriginOperationalAssessment.ts` emits `kind: "llm_contract_suspicion"` as hard bad evidence | Contradicts the Pro rule: LLM suspicion without exact `approve -> transferFrom -> path` evidence is contextual suspicion, not deterministic hard proof. |
| LLM suspicion can exceed the intended contextual cap | `contractSuspicionLayers()` can keep a high LLM risk score such as `95` | Pro target is `65-80` for LLM `drainer_like` without exact transferFrom provenance. |
| Structured proof-level cleanup is partial | `proofLevelFromWhereDecision()` still falls back to reason-text inference in `src/check/whereIsMoneyCheck.ts` | Report wording can drift if text changes. Proof level should come from structured `RiskLayerScore` and hard evidence only. |
| Incoming deposit path-level mapping remains broad | `incomingPathFromWhere()` maps every non-ACCEPTABLE path to `DECLINE`, and `incomingSourcePolicy()` maps every `decline_boundary` to `hard_decline` | Final incoming decision already uses the shared where-report, but path-level display/classification can still overstate policy context. |

## Desired Behavior

### 1. Trace Search Must Not Stop On Source-Policy Decline

`traceMoneyOriginPath()` should continue exploring the current beam until the configured depth/address/beam budget is exhausted.

The trace should stop one individual branch when it reaches a terminal source, but it must not stop all sibling branches just because one branch reached HTX/Huobi, WhiteBIT, bridge/router/DEX, cross-chain, or unknown contract boundary.

Hard proof is different:

- exact risky label/scam/blacklist terminal may remain top-ranked;
- source-policy terminal is not exact proof and should not hide clean alternative terminals.

For the current single-path return API, terminal ranking should become policy-aware:

| Terminal type | Priority |
|---|---|
| exact hard proof / risky label | highest |
| dominant source-policy boundary, share `>=50%` | high |
| allowlisted clean CEX | high-clean |
| minority source-policy boundary, share `<50%` | contextual |
| incomplete / weak continuity | fallback |

This keeps strict policy for dominant risky source exposure while allowing a plausible clean CEX route to win over a minority/ambiguous policy branch.

### 2. Legacy Risk Policy Engine Must Align With Weighted Scoring

`src/risk/riskPolicyEngine.ts` should not contain a fixed HTX/Huobi `78` floor.

Even if the file is currently unused outside its tests, it should follow the same principle:

```text
HTX/Huobi decision = based on weighted moneyOriginScore
HTX/Huobi proofLevel = exchange_policy_context or exchange_policy_decline
HTX/Huobi != exact scam/taint proof
```

Expected behavior:

| Input | Expected |
|---|---|
| `htx_huobi_source`, `moneyOriginScore=45` | not forced to `78`; user result can be ACCEPTABLE or warning depending engine semantics |
| `htx_huobi_source`, `moneyOriginScore=65` | DECLINE as exchange-policy decline |
| `htx_huobi_source`, `moneyOriginScore=78` | DECLINE 78, but because weighted score supports it |
| `whitebit_source`, `moneyOriginScore=38` | no hard proof; policy/context result |

### 3. LLM Suspicion Must Not Be Hard Proof

LLM verdicts should produce a `contract_suspicion` layer, not `hardBadEvidence`, unless deterministic exact proof already exists elsewhere.

Exact hard proof still comes from deterministic modules:

```text
approve observed
spender resolved
transferFrom observed
USDT path reaches checked wallet/deposit receiver
no service boundary breaks exact provenance
```

LLM can still recommend `DECLINE`, but the proof level must be honest:

```text
llm_assisted_suspicion
not exact_approval_drain_provenance
not exact_scam_or_taint_proof
```

Score target without exact proof:

| LLM verdict | Conditions | Score target |
|---|---|---:|
| `drainer_like` | confidence `>=0.75` or high model score, no exact transferFrom proof | `75-80` |
| `unknown_suspicious` | confidence `>=0.70`, score `>=65`, no exact proof | `65-75` |
| `legitimate_service` | confidence `>=0.80`, covers unresolved contract paths, no hard proof | cap unknown-contract risk around `20-35` |
| unavailable/invalid LLM | unknown contract path remains conservative, but not labelled drainer proof | source/coverage uncertainty |

### 4. TLhVzk/TJpMj LLM Overconfidence Regression

The most important regression case is `TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe`.

Current observed behavior:

```text
TLhVzk... -> CRITICAL / 90-95
main reason: LLM drainer_like for TJpMjCCA...DvaQ
```

This is too strong based on the current evidence. `TLhVzk...` can remain a high-risk wallet because of large fast transit, bridge/source-policy behavior, and suspicious contract context. But `TJpMj...DvaQ` must not become exact approval-drain proof unless deterministic evidence proves it.

The likely LLM failure mode is prompt/case-file ambiguity:

- `approvalDrainReviewFindings.reason = "approval_not_found"` means exact approval proof was not found.
- The LLM can misread that as "a hidden or malicious approval-drain happened".
- `misleading_wrapper_method`, `unverified proxy`, `single selector`, `nearby non-USDT token`, and low final USDT balance are supporting fingerprints only.
- `TUrnbcEpndZVdgavhy4FyvfdMhyuETMFkt` has previous research context as `UniV3Adapter` / bridge-like or unknown-service receiver; this is counter-evidence against treating the receiver as a plain collector by default.
- A near-zero post-flow USDT balance proves funds moved; it does not prove they were stolen.

Desired behavior for this case:

```text
TLhVzk...
Decision: DECLINE
Risk: 75-80 HIGH unless stronger deterministic evidence is found
Proof level: llm_assisted_suspicion / source-policy / behavior context
Not: exact_approval_drain_provenance
Not: CRITICAL solely from LLM
```

If deterministic proof later exists:

```text
approve observed
spender resolved
transferFrom confirmed
USDT path reaches checked wallet/deposit receiver
no service boundary breaks the path
```

then exact approval-drain can still score `95-100`.

#### Adaptive LLM Prompt Requirements

The prompt should not be narrowly hard-coded to TLh/TJp. It should teach the model how to reason over any contract episode:

1. Treat `approvalDrainProvenanceProfiles` as confirmed deterministic proof candidates.
2. Treat `approvalDrainReviewFindings` as unresolved candidates, not confirmed drains.
3. Explicitly define `approval_not_found` as: exact approval proof was not found; this weakens exact-drain proof.
4. Require the model to separate:
   - exact drain proof;
   - LLM-assisted suspicion;
   - service-route / bridge / router / DEX context;
   - approval hygiene risk;
   - insufficient data.
5. Require the model to cite which deterministic fields prove `transferFrom`, spender match, allowance match, and path-to-checked-wallet. If those fields are missing, it must not call the case exact drain.
6. Treat service classifications, receiver classifications, route adapters, bridge/router labels, economic output, and normal route context as false-positive guards.
7. Treat dust/non-USDT marker tokens, strange method names, single-method proxies, unverified contracts, and low post-flow balance as supporting context only.
8. Allow high suspicion when several weak signals combine, but cap it below exact-drain unless deterministic proof exists.
9. Ask for `falsePositiveNotes` whenever the verdict is `drainer_like` or `unknown_suspicious`.

The case file should also carry unambiguous proof fields for every review finding, for example:

```ts
exactApprovalProofStatus: "found" | "not_found" | "not_checked"
transferFromProofStatus: "confirmed" | "suspected_wrapper" | "not_confirmed"
spenderMatchStatus: "matched" | "not_matched" | "unknown"
pathToCheckedWalletStatus: "proven" | "not_proven" | "blocked_by_service_boundary"
reviewFindingInterpretation: "candidate_only_not_exact_proof"
```

These fields can be added as derived LLM-only case-file fields without changing the raw internal evidence model first.

Because prompt semantics and case-file interpretation change, `CONTRACT_LLM_VERDICT_POLICY_VERSION` must be bumped. Old cached verdicts for `TJpMj...DvaQ` must not be reused under the new interpretation.

### 5. Proof Level Must Come From Structured Evidence

`proofLevelFromWhereDecision()` should prefer:

1. exact hard evidence layer;
2. dominant risk layer proof level;
3. fallback `insufficient_coverage`.

It should not infer proof level from reason text such as `"LLM contract verdict"` or `"HTX"`.

### 6. Incoming Deposit Path Display Must Not Overstate Policy Context

Incoming deposit final decision already delegates to the shared where-is-money report. The remaining cleanup is path-level classification:

- `path.verdict === "REVIEW"` should not be displayed internally as path `DECLINE`;
- `sourcePolicy: "hard_decline"` should be reserved for weighted decline-level policy, not every `decline_boundary`;
- HTX/Huobi/WhiteBIT/bridge/unknown-contract path explanations should keep the same proof-level wording as where-is-money.

This is a consistency fix, not a new scoring model.

## Acceptance Criteria

1. Trace no longer globally stops when the first source-policy `DECLINE` terminal is found.
2. A trace branch that reaches minority HTX/Huobi or a bridge boundary does not prevent an alternative clean CEX branch from being explored.
3. `riskPolicyEngine` no longer forces `htx_huobi_source` to `78` when `moneyOriginScore` is lower.
4. LLM `drainer_like` without deterministic transferFrom provenance does not appear in `assessment.hardBadEvidence`.
5. LLM `drainer_like` without deterministic proof is capped to `75-80` and reported as `llm_assisted_suspicion`.
6. Exact approval-drain provenance still produces `95-100` hard proof.
7. `approval_not_found` is not presented to the LLM as proof of hidden drain; it is explained as missing exact approval proof.
8. TLhVzk/TJpMj-style LLM-only `drainer_like` remains `DECLINE/HIGH` at `75-80`, not `CRITICAL`, unless exact deterministic proof exists.
9. LLM case files include service-route and receiver-classification counter-evidence when available.
10. `CONTRACT_LLM_VERDICT_POLICY_VERSION` is bumped so old verdict cache entries are not reused after prompt/case-file semantics change.
11. Proof level uses structured risk layers and does not rely on reason text for HTX/bridge/drain classification.
12. Incoming deposit path-level output stops converting every non-ACCEPTABLE path into `DECLINE`.
13. Current HTX/Huobi base table stays unchanged.

## Verification Targets

- `npm test -- tests/forensics/moneyOriginTrace.test.ts`
- `npm test -- tests/risk/riskPolicyEngine.test.ts`
- `npm test -- tests/forensics/moneyOriginOperationalAssessment.test.ts`
- `npm test -- tests/forensics/contractLlmVerdict.test.ts`
- `npm test -- tests/check/whereIsMoneyCheck.test.ts`
- `npm test -- tests/forensics/incomingDepositJob.test.ts`
- `npm run typecheck`
