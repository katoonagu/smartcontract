# Incoming Deposit Risk Design

Date: 2026-05-29
Status: Draft for user review

## Summary

Incoming alerts must score the specific deposit, not only the sender address. The current incoming card can show `Low risk: 0/100` when the sender has no direct labels or fast risk signals. That is technically true for sender risk, but it is misleading for an exchange operator because it does not prove that the specific incoming USDT came from a clean source.

This design adds `Incoming Deposit Provenance Risk`: a transaction-centric provenance layer for every incoming USDT transfer. It returns a final user-facing decision:

```text
Decision: ACCEPTABLE | DECLINE
Deposit risk: 0-100
```

There is no user-facing `REVIEW` state. Uncertainty is represented through risk score, data quality, coverage, and short reasons.

## Problem

The current incoming alert mostly evaluates the `From` address:

```text
Incoming USDT
Low risk: 0/100
Reasons:
- no obvious risk signals found
```

That means the sender is not immediately known as risky. It does not answer the more important question:

```text
Can we accept this exact incoming deposit?
```

Example acceptance case:

```text
Tx: 48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b
TEaViA...RacfdKs -> TEYPUt...GUUZBM
Amount: 384,064 USDT
```

The sender may have been funded shortly before the deposit by smart-contract addresses:

```text
SC TFcRN...FLR5hvh -> TEaViA... +117,568
SC TFcRN...FLR5hvh -> TEaViA... +37,000
SC TFcRN...FLR5hvh -> TEaViA... +30,045
TEaViA... -> TEYPUt... +384,064
```

A fast sender score of `0/100` is not enough here. The system must inspect the funds that formed the specific deposit and escalate unknown smart-contract funding to contract intelligence and LLM verdict when needed.

## Existing Checks

### Fast Sender Check

Fast sender check evaluates the sender address using labels, blacklist/scam indicators, USDT blacklist state, and fast graph/behavior signals. It is still useful and should remain visible as a separate line:

```text
Fast sender risk: 0/100 LOW
```

It is not the final deposit score.

### Deep Sender Context

Deep forensic checks evaluate the sender as a wallet: role, flow behavior, counterparties, collector/transit/operational patterns, approval/contract context, and extended provenance. It answers:

```text
What kind of wallet is this sender?
```

This context is used as a dampener or amplifier for uncertain deposit provenance.

### Where Is Money

The current `where-is-money` mode is balance-centric. It asks:

```text
Which inbound transfers formed the current wallet balance?
```

That is good for a static case where a client shows a current wallet balance and wants to exchange it. It is not enough for active operational wallets where money moves in and out:

```text
incoming 384k -> outgoing 100k -> incoming 175k -> outgoing 150k
```

For incoming alerts, the system must seed provenance from the specific deposit transaction instead of the current balance.

### Sender Check Button Problem

The current `Check sender` button opens a balance-centric check for the sender address. That is wrong when the button is pressed from an incoming alert.

After a sender sends USDT to the watched wallet, the sender balance may naturally be `0 USDT`. A balance-centric `where-is-money` check then reports:

```text
Current USDT: 0
Balance-forming coverage: 0 txs, 0%
Risk: 45/100 MEDIUM
Reason: current balance is zero or unavailable
```

This is misleading. A zero current balance is expected after an outgoing transfer and is not a risk signal by itself. It only means the balance-origin mode is not applicable to this sender at this time.

For incoming-alert context, `Check sender` must not ask:

```text
What formed the sender's current balance?
```

It must ask:

```text
What is this sender's wallet profile, and where did it get the specific deposit it sent to us?
```

So the button must preserve transaction context:

```text
depositTxHash
watchedWallet
sender
amount
timestamp
```

and route to `IncomingDepositRisk` or a sender-profile view linked to that deposit, not to generic current-balance `where-is-money`.

Manual address checks without transaction context can still show a wallet profile, but should treat `current balance = 0` as "balance-origin not applicable", not as `MEDIUM` risk.

## New Module

Add a module named `incomingDepositRisk`.

Input:

```ts
type IncomingDepositRiskInput = {
  txHash: string;
  watchedWallet: string;
  sender: string;
  amountRaw: string;
  timestamp: Date;
};
```

Output:

```ts
type IncomingDepositRiskReport = {
  decision: "ACCEPTABLE" | "DECLINE";
  depositRiskScore: number;
  riskBand: "LOW" | "LOW-MEDIUM" | "MEDIUM" | "HIGH" | "CRITICAL";
  fastSenderRisk: RiskReport | null;
  originPaths: IncomingDepositOriginPath[];
  originCoverage: number;
  provenanceConfidence: number;
  dataQuality: "low" | "medium" | "high";
  senderRole: string | null;
  hardBadEvidence: IncomingDepositHardBadEvidence[];
  contractVerdicts: ContractLlmVerdictSummary[];
  reasons: string[];
  warnings: string[];
};
```

## Transaction-Seeded Provenance

The seed is the actual incoming transaction:

```text
sender -> watchedWallet
amount X
time T
```

The system looks backward from `sender` before `T` and tries to explain `X`.

It should consider:

- incoming transfers to `sender` before the deposit;
- outgoing transfers from `sender` before the deposit;
- amount preservation and partial preservation;
- time proximity;
- whether a candidate input was likely spent before the deposit;
- whether the sender behaves like an operational liquidity wallet.

The core question is:

```text
Where did the sender get the funds used for this exact deposit?
```

This is different from balance-forming analysis.

When the sender has already forwarded the money and now has zero balance, the transaction seed remains valid. The system should inspect sender cashflow before the deposit timestamp instead of relying on the sender's current balance.

## Cashflow-Aware Tracing

The module should use an approximate inventory/cashflow model around the deposit time.

Example:

```text
sender receives 500k
sender sends 100k elsewhere
sender sends 384k to watched wallet
```

The 500k input can still be relevant, but the system must not treat current balance as the source. It should model the sender's incoming and outgoing flows before the deposit.

MVP model:

1. Build a time-ordered list of sender USDT edges before the deposit.
2. Walk backward from the deposit amount using candidate inbound edges.
3. Penalize candidate inputs that appear already consumed by earlier outgoing transfers.
4. Allow partial coverage when sender is a liquidity wallet.
5. Produce coverage and confidence rather than requiring exact accounting.

## Contract Discovery

If an upstream path contains a smart contract funding the sender:

```text
SC -> sender -> watched wallet
```

the system must:

1. fetch address metadata and labels for the contract;
2. classify known service boundaries;
3. fetch transaction details for relevant contract transactions;
4. build a contract case file;
5. run LLM contract verdict when the contract is unknown or suspicious.

Known service contracts are handled through service classification. Unknown contracts are not automatically hard decline unless supported by policy or verdict, but they must raise score and trigger deeper analysis.

## LLM Trigger

For incoming deposits, LLM contract analysis should run when the transaction-seeded path finds:

- unknown smart contract funding the sender;
- contract-only origin;
- approval or `transferFrom` evidence;
- suspicious method or ABI context;
- unknown contract boundary close to the deposit;
- repeated same contract funding multiple senders or deposits.

The LLM does not create blockchain facts. It receives a deterministic case file and returns a structured verdict:

```text
legitimate_service | drainer_like | unknown_suspicious | unknown_insufficient_data
```

The final decision remains policy-driven.

## Scoring

The user-facing score is `Deposit risk`, not `Sender risk`.

Inputs:

- hard bad evidence;
- source proximity;
- amount/time continuity;
- contract/LLM verdict;
- sender role;
- deposit size;
- origin coverage and data quality;
- fast sender risk.

Amount/time continuity is a confidence signal, not a risk signal by itself:

```text
strong continuity + clean source = lower risk
strong continuity + bad source = higher confidence decline
strong continuity + unknown source + operational sender = ACCEPTABLE LOW-MEDIUM
strong continuity + unknown source + fresh one-shot sender = DECLINE
weak continuity = lower confidence; sender role matters more
```

## Policy

Hard decline:

```text
HTX/Huobi close in deposit path
bridge/router/DEX origin boundary
scam/blacklist/stolen label
exact approval-drain provenance
USDT blacklist
LLM drainer_like high confidence
```

Medium policy:

```text
WhiteBIT
unknown contract
contract-only origin
LLM unknown_suspicious
```

WhiteBIT is not hard scam proof. It raises risk and can become `DECLINE` when it is close, large, high-share, or repeated.

Unknown origin rules:

```text
unknown origin + operational liquidity sender + no hard bad = ACCEPTABLE 25-40
unknown origin + fresh one-shot sender + large amount = DECLINE 45-65
clean CEX path = ACCEPTABLE 0-25
```

## Telegram UX

Replace the current sender-only card with a final one-message deposit-risk card.

Example bad case:

```text
Incoming USDT

Decision: DECLINE
Deposit risk: 68/100 HIGH

Amount: 384,064 USDT
From: TEaViA...
Watched wallet: TEYPUt...

Reasons:
- Sender was funded shortly before this deposit by unknown smart contract.
- Amount/time continuity is strong.
- AI contract verdict: unknown_suspicious / drainer_like / insufficient clean service proof.

Fast sender risk: 0/100 LOW
Origin coverage: 76%
```

Example normal operational case:

```text
Incoming USDT

Decision: ACCEPTABLE
Deposit risk: 32/100 LOW-MEDIUM

Reasons:
- Sender has no direct bad labels.
- Clean CEX origin is not fully proven.
- Sender behaves like operational liquidity wallet.
- No hard bad evidence found.

Fast sender risk: 0/100 LOW
Origin coverage: 72%
```

The alert should be sent as one final message. Do not send a preliminary "checking started" alert.

The sender action should be contextual:

```text
Check deposit/source
```

or, if the button remains named `Check sender`, it must carry the deposit context internally. It should not call generic `check:addr:<sender>` in a way that loses the tx hash and falls back to current balance.

If a user manually checks a zero-balance sender outside incoming context, the message should say:

```text
Current balance: 0 USDT
Balance-origin mode: not applicable
Wallet profile: ...
```

It should not assign `MEDIUM` only because there is no current balance to trace.

## Queueing

Incoming deposit checks should run through a dedicated high-priority job path:

```text
incoming tx detected
claim observed transaction
run IncomingDepositRisk job
send one final Telegram alert
```

The job priority should be higher than generic deep research and close to `where-is-money`. The worker should respect TronScan rate limits and reuse local indexed transfers and metadata cache first.

Fallback policy:

- if hard bad is found, return `DECLINE`;
- if API/LLM fails on an unknown contract boundary, return conservative `DECLINE`;
- if no hard bad is found and sender is operational/liquidity, return `ACCEPTABLE LOW-MEDIUM`;
- if data is thin, sender is fresh/one-shot, and amount is large, return `DECLINE MEDIUM`.

## Acceptance Criteria

1. For tx `48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b`, the system starts from this transaction, not from current balance.
2. The system finds upstream funding for sender `TEaViA...`.
3. If upstream funding contains `SC` or a smart contract, the system builds a contract case file.
4. Unknown smart contract funding triggers LLM contract verdict.
5. Telegram alert shows `Deposit risk`, not only `Sender risk`.
6. Fast sender risk remains visible as a separate line.
7. Final user-facing decision is only `ACCEPTABLE` or `DECLINE`.
8. If sender is operational/liquidity and hard bad evidence is absent, unknown origin does not automatically become high risk.
9. If sender is fresh/one-shot, amount is large, and close origin is an unknown contract, score rises to `DECLINE`.
10. HTX/Huobi and bridge/router/DEX close origin remain hard decline policy.
11. WhiteBIT is medium policy risk and becomes decline only when close, large, high-share, or repeated.
12. Pressing `Check sender` from an incoming alert preserves deposit context and does not run a current-balance-only `where-is-money` check.
13. A sender with `0 USDT` current balance after sending the deposit is not scored `MEDIUM` solely because balance-origin tracing is impossible.
14. Generic address checks with zero balance show wallet profile and "balance-origin not applicable" instead of treating zero balance as risk evidence.

## Non-Goals

- Exact accounting-level coin selection. The system uses approximate cashflow and provenance confidence.
- Replacing fast sender check or deep forensic check. Incoming deposit risk aggregates them.
- Letting LLM decide blockchain facts. LLM only classifies deterministic contract case files.
- User-facing review state.

## Implementation Plan Anchors

1. Add types and repository support for incoming deposit jobs and reports.
2. Extract a reusable transaction-seeded provenance engine from existing where-is-money primitives.
3. Add cashflow-aware sender inventory selection.
4. Add contract discovery and LLM escalation for upstream smart-contract funding.
5. Add `IncomingDepositRisk` scoring and policy gates.
6. Split balance-origin mode from wallet-profile mode so `current balance = 0` is not risk evidence.
7. Update incoming alert callback data so sender/deposit actions preserve tx context.
8. Update monitor worker to wait for the final incoming deposit report before sending the alert.
9. Update Telegram formatter and keyboard copy to show deposit risk and fast sender risk separately.
10. Add regression tests for tx `48d33...`, operational-liquidity benign cases, zero-balance sender checks, HTX/bridge hard decline, WhiteBIT medium policy, and unknown-contract LLM escalation.
