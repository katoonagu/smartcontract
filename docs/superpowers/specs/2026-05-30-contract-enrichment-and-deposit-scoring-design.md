# Contract Enrichment and Incoming Deposit Scoring Design

## Problem

Incoming Deposit Provenance Risk can currently over-score working liquidity flows. Two weak signals are too influential:

- `clean source not proven` within a shallow search window.
- `unknown_contract` when the local cache lacks live TronScan metadata.

This creates false `DECLINE` results for normal operational wallets. In the `TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM` examples, one large deposit needed about 11 upstream hops to reach a service/protocol label (`USDD: PSM GemJoin (USDT)`). Another path reached a contract that live TronScan identifies as `GasFree Account`, but the local cache did not contain that profile, so the system could treat it as unknown.

## Goals

1. Fetch live contract intelligence before classifying an unknown contract in incoming-deposit paths.
2. Expand deterministic service classification for known protocol/service patterns such as GasFree and USDD PSM/GemJoin.
3. Use DeepSeek only after deterministic enrichment still leaves a contract ambiguous.
4. Reduce false `DECLINE` decisions when the only issue is unresolved clean origin.
5. Trace deeper only when needed, especially for large deposits with strong cashflow continuity.
6. Keep final user decisions simple: `ACCEPTABLE` or `DECLINE`.

## Non-Goals

- Do not let the LLM browse the open internet directly.
- Do not classify every unknown contract as safe.
- Do not remove hard-decline policies for HTX/Huobi, bridge/router/DEX origin, blacklist/scam labels, exact approval-drain evidence, or high-confidence drainer verdicts.
- Do not build a full offline Tron index in this step.

## Design

### Contract Enrichment First

When incoming-deposit provenance reaches a contract boundary, the system must not rely only on stale local cache.

The flow is:

```text
candidate contract found
  -> read fresh/stale metadata cache
  -> if profile missing/stale, fetch live TronScan contract intelligence
  -> save profile to DB
  -> rerun deterministic service classifier
  -> if still unknown/ambiguous, build LLM case file
```

This makes tags such as `GasFree Account` visible before scoring. It also reduces unnecessary LLM calls because deterministic rules can classify many known service patterns.

### Deterministic Service Classifier Expansion

The classifier should recognize service/protocol boundary patterns:

- GasFree / `GasFree Account`
- `permitTransfer` as supporting evidence when a GasFree/service identity is also present
- smart account / account abstraction / fee account
- USDD
- PSM
- GemJoin
- JustLend
- SunSwap
- stablecoin protocol and liquidity module wording

These are not automatically clean CEX origins. They are service/protocol boundaries. Depending on policy, some can be acceptable service context, while bridge/router/DEX remains hard-decline if current policy says so.

For `USDD: PSM GemJoin (USDT)`, the classifier should return a service/protocol category instead of `none`.

Method names alone must not create trusted service classification. For example, a weak unverified contract with only `permitTransfer`, `ClaimRewards`, `Deposit`, or `Withdraw` in `methodMap` should remain `unknown_contract` unless metadata, provider tags, public tags, or known profile identity also indicate a real service/protocol.

### LLM Contract Verdict Layer

DeepSeek should classify ambiguous contracts only after deterministic enrichment.

The LLM receives facts, not guesses:

```json
{
  "contractAddress": "...",
  "metadata": {},
  "contractProfile": {},
  "methodMap": {},
  "transactionDetails": [],
  "cashflowPath": [],
  "approvalEvidence": [],
  "transferFromEvidence": [],
  "serviceRouteEvidence": [],
  "policyQuestion": "Classify this contract/source as legitimate_service, drainer_like, unknown_suspicious, or unknown_insufficient_data."
}
```

The LLM must not invent blockchain facts. The backend fetches TronScan/TronGrid data and stores raw evidence. The LLM only classifies the assembled case file.

### No Direct LLM Internet Browsing

DeepSeek should not browse the internet directly. Direct web access makes verdicts unstable and hard to audit. If web enrichment is needed later, it should be a separate backend step with allowlisted sources and saved raw evidence.

Allowed now:

- TronScan API
- TronGrid/full node API
- local DB/cache
- future allowlisted provider APIs if their raw responses are stored

### Adaptive Provenance Depth

Incoming-deposit tracing currently uses `maxDepth=4`, which is too shallow for operational liquidity chains.

Use adaptive depth:

```text
start: 4 hops
extend to 8 hops if unresolved and no hard bad evidence
extend to 12 hops for large deposits with strong or medium cashflow continuity
stop early on known clean/hard boundary, exact bad evidence, or low-value/noisy path
```

Depth extension should be budgeted. It should increase coverage for large deposits without making every small alert expensive.

### Scoring Policy

`Clean source not proven` is not hard bad evidence.

Recommended scoring:

```text
Unresolved EOA chain, no hard bad evidence:
  25-35, ACCEPTABLE / LOW-MEDIUM

Large unresolved chain with low data quality:
  35-40, ACCEPTABLE unless other risk exists

Unknown contract close to deposit:
  40-58 before LLM

LLM legitimate_service:
  lower to 20-35 if no hard bad evidence

LLM unknown_suspicious:
  45-65 depending on proximity, amount share, and sender role

LLM drainer_like high confidence:
  DECLINE / HIGH

Exact approval-drain provenance:
  DECLINE / CRITICAL
```

The fallback `max(45, highestPathRisk, fastSenderRisk)` should be removed for unresolved clean-origin cases. It over-penalizes normal liquidity flows.

### Telegram Output

Incoming alerts should explain the separation:

```text
Decision: ACCEPTABLE
Deposit risk: 32/100 LOW-MEDIUM

Fast sender risk: 0/100 LOW
Origin coverage: 64%
Data quality: medium
Sender role: operational/liquidity or unknown

AI contract verdict:
- legitimate_service 24/100 for TBUjhW...VSZ9 - GasFree Account / permitTransfer pattern.
```

If LLM was not used, the report should not imply it was.

## Acceptance Criteria

1. A GasFree-like contract with `providerTags: GasFree Account` is not reported as plain `unknown_contract`.
2. `USDD: PSM GemJoin (USDT)` is recognized as a service/protocol boundary.
3. An unresolved EOA-only path with no hard bad evidence does not default to `45 / DECLINE`.
4. Incoming-deposit tracing can extend beyond 4 hops for large linked flows.
5. DeepSeek runs only for ambiguous contract/service boundaries after live enrichment.
6. DeepSeek receives only backend-collected facts and does not browse the internet directly.
7. High-confidence `legitimate_service` LLM verdict lowers unknown-contract risk.
8. Exact approval-drain evidence remains hard `DECLINE`.
9. Telegram output clearly distinguishes sender risk, deposit risk, data quality, and AI contract verdict.
