# Funding-First Source Provenance Design

Date: 2026-07-03

## Problem

Stage 1 made ordinary `where_is_money_check` technically safer:

- the job can enter `waiting_for_targeted_index`;
- targeted indexing can continue beyond the old 4-page inline seed;
- cached page audits are reused;
- false complete targeted states can be repaired;
- the parent Where job wakes after targeted coverage becomes complete or terminal.

The live Stage 1 gate for `THJcWw89zY5VAeqwtLAXj13aY7N2Y3FMD7` proved the
lifecycle, but not the product answer. The heavy hop address
`TWkvffFDMsqbmTLkMHMABmw452Hyq98cdn` ran to the 12,000-page ceiling, produced no
429/403/5xx errors, and still ended as `provider_cap_unresolved`.

That is an honest technical terminal result, but it is not enough for the
product. Users pay for an explanation of specific money flow, not for proof that
we tried to download a heavy address.

The next step is to stop using full address coverage as the first answer for
every hop. For a concrete transfer:

```text
sender -> receiver
time T
amount A
txHash H
```

the system should first ask:

```text
What usable incoming funds to sender existed before T and can explain amount A?
```

Only if that targeted funding question cannot be answered should the system
fall back to wider targeted indexing.

## Scope

This spec covers `Where is money` source provenance only.

In scope:

- funding-first source provenance for concrete Where hop transfers;
- proof classes for exact, probable, service-boundary, pre-existing-balance, and
  unresolved outcomes;
- amount-continuity guard;
- Admin read-model expectations;
- fallback policy from funding-first to exact-window repair to wider targeted
  history;
- live acceptance on the `THJc... / TWkvff...` case.

Out of scope for this spec:

- `Incoming deposit` implementation;
- Telegram user-facing progress;
- raising global page ceilings;
- 10-key or 100-key scheduler tuning;
- changing HTX/Huobi or hard-evidence policy;
- scoring probable capped-window evidence as hard proof.

Incoming should reuse the same primitives later, but it is not part of the first
implementation slice.

## Two Questions, Two Modes

The system must keep two modes separate.

### `source_provenance`

Answers:

```text
Where did the sender get the money before this transfer?
```

This spec implements `source_provenance`.

Input:

- target transfer `sender -> receiver`;
- target timestamp `T`;
- target amount `A`;
- target tx hash.

Output:

- funding candidates before `T`;
- usable funding after outgoing spend is accounted for;
- proof class;
- stop reason.

### `forward_flow`

Answers:

```text
Where did the money go after this transfer?
```

This is not implemented in this stage. Admin may show downstream path context
that already exists, but the funding-first proof must not mix forward-flow facts
into source-provenance scoring.

## Current Facts From The Read-Only Proof

The old completed Where report for `THJc...` selected 7 balance-forming
transfers. Six old origin paths started with:

```text
TWkvff... -> intermediate -> THJc...
```

The Stage 1.12 job later asked for targeted history on `TWkvff...` and ended
with `provider_cap_unresolved`.

A read-only proof against already cached local transfers showed:

- no direct `TWkvff... -> THJc...` transfer was needed for these paths;
- the unresolved hop was the first path edge from `TWkvff...` to an
  intermediate wallet;
- local cached transfers were enough to build funding bundles for the tested
  hop transfers;
- the bundles covered the small target amounts, but only as probable evidence
  because the cached coverage windows were provider-capped.

For small hop transfers such as `1.001`, `2.00001`, `1.01`, `10`, and
`0.765533` USDT, the read-only proof found a usable funding source:

```text
TSUYvQ5tdd3DijCD1uGunGLpftHuSZ12sQ -> TWkvff...
100,000 USDT
2026-06-24T16:34:57Z
metadata: USDD: PSM GemJoin (USDT), contract
```

For one `6.000001` USDT hop, the proof found:

```text
TJa775yzSEDCVA17rrGzVxecS66oa9UQXQ -> TWkvff...
7,500 USDT
2026-06-28T09:10:24Z
```

This does not prove the full source of the large downstream subject transfer.
It proves that the system can often answer a more precise hop-funding question
without full all-history coverage of a dense address.

## Product Goal

For a Where path, source provenance should answer:

```text
Which prior incoming funds can explain this specific hop amount?
```

It should not answer:

```text
Can we download the entire sender history up to a global ceiling?
```

A good result can be one of:

- exact source proof;
- service boundary with no hard bad evidence;
- probable source explanation clearly marked as probable;
- pre-existing balance outcome;
- unresolved technical terminal.

The system must not turn probable capped-window evidence into hard evidence.

## Core Algorithm

For each concrete hop transfer:

```text
target = sender -> receiver, amount A, timestamp T, txHash H
```

run funding-first source provenance before requiring full targeted coverage.

1. Load cached indexed transfers for `sender` before `T`.
2. Walk backward from `T`.
3. Treat outgoing transfers from `sender` before `T` as spend overhang.
4. Treat incoming transfers to `sender` as funding candidates.
5. For each incoming candidate:
   - subtract spend overhang;
   - compute usable amount;
   - if usable amount is positive, add it to the funding bundle;
   - stop when bundle coverage reaches the configured threshold.
6. Classify the funding source:
   - service boundary;
   - ordinary wallet;
   - hard bad evidence;
   - unknown.
7. Decide whether the proof is exact, probable, boundary, pre-existing balance,
   or unresolved.

The first implementation should reuse the existing
`buildFundingBundleForTraceHop` logic rather than inventing a second balance
engine.

## Proof Classes

### `exact`

Use for scoring when all of these are true:

- the window from funding candidate to target transfer is covered;
- all outgoing transfers from `sender` in that window are accounted for;
- usable funding covers the target amount threshold;
- no capped gap exists inside the window;
- amount continuity passes.

`exact` can feed the scoring matrix.

### `service_boundary`

Use when the funding source is a known service boundary:

- CEX;
- DEX;
- bridge;
- router;
- known service contract;
- known service wallet;
- stablecoin protocol service such as USDD PSM/GemJoin.

If hard bad evidence is absent, service boundary is neutral/context evidence. It
does not become risk by itself.

`service_boundary` can stop source provenance honestly, but the report must say
what service boundary was reached.

### `probable`

Use when cached data and amount math support the funding explanation, but exact
coverage is not proven. Common reasons:

- provider-capped window;
- missing coverage interval;
- incomplete split proof;
- enough local rows to explain the amount, but not enough coverage proof to
  guarantee no hidden outgoing spend.

`probable` is useful in Admin. It must not automatically publish a final score
or hard evidence.

### `pre_existing_balance_possible`

Use when no funding candidate is found in the configured lookback, but the
sender may have had balance before the lookback window.

This is not the same as `provider_cap_unresolved`.

Meaning:

```text
We did not find a funding candidate in the searched window. The sender may have
already had balance before the window.
```

This outcome needs either:

- larger lookback;
- an exact historical balance model;
- a product decision to stop with a technical non-final result.

### `unresolved`

Use when the system cannot explain the target transfer:

- funding bundle does not cover the amount;
- required coverage is unavailable;
- provider cap remains after fallback;
- local data is inconsistent;
- amount-continuity guard fails.

`unresolved` blocks final scoring for the affected required path.

## Amount-Continuity Guard

Funding-first must not make small hops look like proof for much larger
downstream transfers.

Rules:

- upstream usable funding must cover the target hop amount by the configured
  threshold;
- downstream path amounts must remain coherent with the amount being explained;
- if a downstream transfer is orders of magnitude larger than the upstream hop,
  the path cannot be shown as proof for the larger downstream transfer.

Initial configurable thresholds:

```text
minFundingCoverageRatio: 0.95
warningFundingCoverageRatio: 0.80
maxDownstreamToUpstreamRatioForProof: 10
hardBreakDownstreamToUpstreamRatio: 100
```

These values are product constants at first. The implementation should keep them
named and easy to move into config later.

For the `THJc... / TWkvff...` case, a `6 USDT` first hop must not explain a
`2,345,898.23 USDT` downstream transfer as a proven source. Admin can show it as
path context, but not as amount-continuity proof.

## Window Coverage Contract

For `exact`, coverage must be proven over the specific source window:

```text
funding candidate timestamp <= window <= target transfer timestamp
```

The contract:

- all indexed transfer rows in the window are deduplicated by canonical transfer
  key;
- all outgoing transfers from `sender` in the window are included in spend
  overhang;
- all incoming funding candidates used by the bundle are in the covered window;
- coverage intervals for the window are complete and not capped;
- provider inconsistencies are absent.

If this contract is not met, the proof class cannot be `exact`.

## Fallback Policy

The order is fixed:

1. Run funding-first from already cached local data.
2. If a candidate is promising but exact coverage is missing, queue targeted
   exact-window repair for the candidate-to-target window.
3. If the exact window still cannot be proven, run wider targeted history.
4. If wider targeted history reaches a real safety/provider terminal, finish
   with a technical terminal and `score_valid=false`.

Do not start by brute-forcing full sender history.

Do not publish a final score from unresolved required source provenance.

## Scoring Contract

Proof class controls how the result may be used.

| Proof class | Scoring use |
| --- | --- |
| `exact` | Can feed source scoring and policy scoring. |
| `service_boundary` | Neutral/context unless hard evidence exists. |
| `probable` | Admin explanation only by default; not hard evidence. |
| `pre_existing_balance_possible` | Non-final or low-confidence context only. |
| `unresolved` | Blocks final score for required path. |

Hard evidence remains hard evidence. This spec does not weaken blacklist,
sanctions, mixer, scam labels, or other exact bad evidence.

Probable evidence may later become scoring input only after a separate policy
decision. That is explicitly not part of this spec.

## Admin Output

Admin must not draw a probable source as a proven chain.

For each funding-first hop, Admin should show:

- target transfer:
  - tx hash;
  - sender;
  - receiver;
  - timestamp;
  - amount;
- funding candidates:
  - funder address;
  - candidate tx hash;
  - candidate timestamp;
  - original incoming amount;
  - consumed by later outgoing spend;
  - usable amount;
  - used amount;
- proof class;
- stop reason;
- coverage window status;
- service boundary label, if present;
- amount-continuity status.

Visual semantics:

- exact edge: normal proven provenance edge;
- probable edge: dashed or explicitly labeled probable;
- service boundary: boundary node/stop;
- unresolved/gap: technical gap, not wallet-risk verdict.

The right rail should explain:

```text
This is probable funding from cached/capped history, not exact source proof.
```

when proof class is `probable`.

## Data Shape

Add or extend trace metadata with a funding-first result. Target shape:

```ts
type FundingFirstSourceProvenance = {
  mode: "source_provenance";
  targetTxHash: string;
  targetFromAddress: string;
  targetToAddress: string;
  targetTimestamp: string;
  targetAmountRaw: string;
  proofClass:
    | "exact"
    | "service_boundary"
    | "probable"
    | "pre_existing_balance_possible"
    | "unresolved";
  coveredAmountRaw: string;
  coverageRatio: number;
  amountContinuity:
    | "strong"
    | "weak"
    | "broken";
  stopReason: string | null;
  fundingBundle: TraceFundingBundle | null;
  coverageWindow: {
    startTimestamp: string | null;
    endTimestamp: string;
    complete: boolean;
    capped: boolean;
    providerInconsistent: boolean;
  };
};
```

The implementation should keep this as close as possible to existing
`TraceFundingBundle` and `MoneyOriginPath` shapes. Do not add a parallel graph
engine.

## Implementation Boundary

Preferred ownership:

- `buildFundingBundleForTraceHop`: usable funding math;
- `traceMoneyOriginPath`: branch selection and source-provenance flow;
- targeted history/index modules: exact-window repair and wider history fallback;
- scoring modules: proof-class-aware scoring policy;
- Admin projection: display only, no forensic reinterpretation.

This keeps the change small and testable.

## Live Acceptance

Use the known case:

```text
subject: THJcWw89zY5VAeqwtLAXj13aY7N2Y3FMD7
heavy hop: TWkvffFDMsqbmTLkMHMABmw452Hyq98cdn
Where job family: a8db3956-bac6-4c95-b538-5d1324e2432b
```

Acceptance is not:

```text
The final user decision becomes ACCEPT or DECLINE.
```

Acceptance is:

- funding candidates are found from local cache;
- each candidate gets a truthful proof class;
- `TSUY...` service boundary is shown as service/context, not risk;
- probable capped-window proof is not shown as exact;
- small hop amounts do not prove the large downstream amount;
- generic `provider_cap_unresolved` is replaced where possible by a more precise
  funding outcome;
- unresolved paths still block final score.

## Tests

### Unit tests

Add tests around `buildFundingBundleForTraceHop` or a small wrapper:

- later outgoing spend consumes nearer incoming transfers;
- older large incoming becomes usable only after spend overhang is exhausted;
- coverage ratio is calculated from used amount, not original incoming amount;
- service-boundary candidate remains neutral without hard evidence.

### Trace tests

Add tests for `traceMoneyOriginPath`:

- funding-first runs before full targeted terminal;
- exact proof continues trace through selected funders;
- probable proof records explanation but does not become hard source evidence;
- pre-existing-balance outcome is distinct from provider cap;
- amount-continuity guard breaks a path where downstream amount is far larger
  than upstream hop amount.

### Admin tests

Add projection/rendering tests:

- exact funding-first edge renders as proven;
- probable funding-first edge renders as probable;
- service boundary renders as boundary;
- unresolved/gap renders as technical gap;
- Admin does not duplicate generic `provider_cap_unresolved` when a precise
  funding outcome exists.

### Live validation

Run one fresh Where check on `THJc...` after implementation.

Expected:

- funding-first block appears for `TWkvff...` hops;
- no final score is published from probable-only evidence;
- Admin explains why the job is still unresolved or what boundary was reached;
- no regression in targeted index waiting/resume lifecycle.

## Non-Goals

- Do not implement Incoming in this spec.
- Do not increase page ceilings just to make this case pass.
- Do not treat probable evidence as hard evidence.
- Do not create a new graph engine.
- Do not remove the current targeted indexing lifecycle.
- Do not hide technical terminals when no funding explanation exists.

## Rollout

1. Stage 1.13b: pure funding-first helper and unit tests.
2. Stage 1.13c: use funding-first in Where before terminal
   `provider_cap_unresolved`.
3. Stage 1.13d: Admin projection and visual distinction for exact/probable
   funding outcomes.
4. Stage 1.13e: live validation on `THJc... / TWkvff...`.
5. Stage 2: adapt the same primitive to Incoming deposit.

Each stage should be independently testable and commit-sized.
