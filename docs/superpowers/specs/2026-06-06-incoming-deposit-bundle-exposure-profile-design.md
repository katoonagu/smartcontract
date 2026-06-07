# Incoming Deposit Bundle Exposure Profile Design

Date: 2026-06-06.

## Summary

Incoming deposit scoring needs one final score, but it must separate two different facts:

```text
fresh balance-forming source for the checked deposit
historical exposure profile of the sender wallet
```

The fresh balance-forming source answers:

```text
What actually funded this outgoing transfer at the time it was sent?
```

The historical exposure profile answers:

```text
How often does this sender wallet use HTX/Huobi, bridges, routers, contracts, unknown sources, or clean CEX sources?
```

These signals must be combined into one incoming deposit score, but they must not be explained as the same evidence.

## Trigger Case

Checked incoming deposit job:

```text
job: 0fb0a855-63bb-45fa-80ff-ceb53f8a18fd
deposit tx: b4603c390d3b0f08f9a604b26dc31d08e64aeeacc5a1560410bb5bbf030aa39c
sender: TPiyHJDDiUWUuyaxGdz1uTDyh8mDke67z3
watched wallet: TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM
amount: 100,000 USDT
```

The old saved report scored this deposit as:

```text
85 CRITICAL / DECLINE
reason: Balance-forming path reaches HTX 4 exposure (100% of selected provenance target)
```

That was too strong as a provenance statement. The path used a stale transfer:

```text
TE2Abe... -> TKqq... 249,590 USDT
2026-05-14 12:33:42Z

then about 21 days later

TKqq... -> TNsp... 204,047 USDT
2026-06-04 11:41:30Z
```

During those 21 days, `TKqq...` had many USDT transfers. It also sent out 303,919 USDT shortly after receiving the 249,590 USDT transfer. Therefore the old 249,590 USDT inbound must not be treated as the proven 100% source of the later 204,047 USDT outbound.

After the balance-aware provenance fix, a bounded live rerun produced:

```text
18 LOW / ACCEPTABLE
clean CEX coverage: 19.09%
decision anchor: none
```

That result is more truthful about exact provenance, but it is too soft for product risk if HTX/Huobi remains a meaningful part of the wallet's recent or historical money corridor.

## Product Goal

Incoming deposit monitoring must produce:

- one final score;
- one final decision;
- one user-facing explanation;
- factual separation between exact source and contextual exposure;
- high risk when fresh HTX/Huobi or other hard-risk exposure materially funds the checked deposit;
- moderate additive risk when HTX/Huobi is historical wallet behavior but not proven as the source of the checked deposit.

The system must not say:

```text
This deposit came from HTX/Huobi
```

unless HTX/Huobi is actually part of the fresh balance-forming bundle for the checked amount.

The system may say:

```text
The sender wallet has historical HTX/Huobi exposure
```

when HTX/Huobi appears in the wallet exposure profile but is not proven as the source of the checked deposit.

## Current Facts From Code

Incoming deposit reports are built in `buildIncomingDepositReport`.

Source:

```text
src/forensics/incomingDepositJob.ts:896
```

The report already selects funding candidates for the sender before calling Where Is Money.

Source:

```text
src/forensics/incomingDepositJob.ts:1045
```

Where Is Money is run in transaction mode with the deposit as the checked event.

Source:

```text
src/forensics/incomingDepositJob.ts:1083
src/forensics/incomingDepositJob.ts:1097
```

Incoming deposit final score now goes through the unified scorer.

Source:

```text
src/risk/unifiedIncomingDepositRisk.ts:66
src/forensics/incomingDepositJob.ts:789
```

Selected path attribution is now share-based.

Source:

```text
src/forensics/moneyOriginAttribution.ts:3
src/forensics/provenanceScoring.ts:67
```

Runtime limits currently include:

```text
RUNTIME_TRANSFER_LIMIT = 200
RUNTIME_PROVENANCE_LARGE_DEPOSIT_DEPTH = 20
RUNTIME_PROVENANCE_STANDARD_DEPTH = 20
RUNTIME_RECENT_FALLBACK_TRANSFER_LIMIT = 60
ADAPTIVE_CORRIDOR_EXPANSION_MAX_ADDRESS_FETCHES = 80
ADAPTIVE_CORRIDOR_EXPANSION_MAX_EDGES_PER_ADDRESS = 60
```

Source:

```text
src/forensics/incomingDepositJob.ts:145
src/forensics/incomingDepositJob.ts:146
src/forensics/incomingDepositJob.ts:147
src/forensics/incomingDepositJob.ts:155
src/forensics/incomingDepositJob.ts:156
src/forensics/incomingDepositJob.ts:159
```

## Definitions

### Fresh Balance-Forming Bundle

A `fresh balance-forming bundle` is the set of inbound transfers that can actually cover a specific outbound transfer at the moment that outbound transfer happens.

For each outbound hop:

```text
target outgoing transfer
-> inspect inbound transfers before target time
-> subtract later outgoing spend before target time
-> keep only usable inbound amount
-> select the newest usable inbound transfers until the target amount is covered or limits are reached
```

This prevents a stale old transfer from being counted when it was probably already spent.

### Time-Anchored Bundle Selection

Bundle selection is anchored to the exact outbound time, not to a fixed calendar bucket.

For a transfer like:

```text
TKqq... -> TNsp...
204,047 USDT
2026-06-04 11:41:30Z
```

the system should inspect funding before `2026-06-04 11:41:30Z`, then account for spends that happened before that outbound. The system should prefer the newest usable inbound transfers that still have balance capacity at that time.

This means:

- a transfer from 21 days earlier can be considered only if it still has usable balance after later outgoing spend;
- fresh same-day inbounds should usually dominate old inbounds when they cover the outgoing amount;
- every selected inbound should carry a `timeGapMs` or equivalent display field so the admin graph can show how far apart the related transactions are;
- if coverage is incomplete, the report must say coverage is incomplete instead of treating an old large transfer as proof.

Fresh bundle search should stop when the target amount is covered or when configured edge/address limits are reached. It should not fall back to a 365-day single candidate as direct source proof without balance-spend accounting.

### Fresh Bundle Risk

`freshBundleRisk` is the risk from sources that materially funded the checked deposit.

Example:

```text
HTX/Huobi covers 80% of the fresh bundle
=> strong source-policy risk
=> may floor the final incoming score to HIGH or CRITICAL
```

### Corridor Risk

`corridorRisk` is risk from the live path around the deposit, even when the exact selected amount is split or partially unresolved.

Example:

```text
fresh path goes through an unknown contract boundary
or bridge/router/dex service
or HTX/Huobi appears in nearby funding branches but below exact-source threshold
```

This can raise score, but the explanation must say "corridor exposure", not "source proven".

### Wallet Exposure Profile

`walletExposureProfile` is background behavior of the sender wallet over a bounded window.

It tracks:

- HTX/Huobi inbound count and inbound volume share;
- clean CEX inbound count and volume share;
- bridge/router/dex inbound and outbound exposure;
- smart-contract inbound and outbound exposure;
- unknown contract exposure;
- unknown-source share;
- fresh operational velocity, such as short time between inbound and outbound movement;
- whether the wallet looks like a one-shot transit wallet, collector, or operational liquidity wallet.

This profile can add context score, but it must not by itself pretend to prove the source of the checked deposit.

The profile window should be configurable. The first implementation can use the existing incoming deposit job window and fetched transfer limits, then report:

```text
profileWindowStart
profileWindowEnd
transferEventsScanned
coverageWarnings
```

If later production limits increase, the profile can expand without changing the scoring model.

## Scoring Design

The incoming deposit score should be composed from four layers:

```text
finalIncomingScore =
  max(hardEvidenceFloor, freshBundleFloor, corridorFloor, patternFloor)
  + additiveBackgroundScore
  - dampeners
```

The final result is still one score and one decision.

### 1. Hard Evidence Floor

Hard evidence remains highest priority:

- USDT blacklist on sender;
- exact approval-drain provenance;
- sanctioned service;
- other hard bad evidence from Where Is Money.

This layer can set `CRITICAL` regardless of background profile.

### 2. Fresh Bundle Floor

Fresh bundle floor uses only attributable source share from the current deposit's balance-forming bundle.

Recommended initial rules:

```text
HTX/Huobi fresh bundle share >= 70%
=> floor 85 CRITICAL

HTX/Huobi fresh bundle share >= 30%
=> floor 70 HIGH

HTX/Huobi fresh bundle share >= 10%
=> floor 55 MEDIUM/HIGH boundary

sanctioned/mixer/no-name liquidity fresh share >= 10%
=> floor 85 CRITICAL

bridge/router/dex fresh share >= 50%
=> floor 60 HIGH

unknown contract fresh share >= 50%
=> floor 45 MEDIUM
```

These thresholds are calibration defaults, not proof rules. The report must include the share and source category so the score is explainable.

### 3. Corridor Floor

Corridor floor applies when risky service exposure is present in the active route but not strong enough to be treated as the direct source of the checked amount.

Recommended initial rules:

```text
HTX/Huobi appears in active recent corridor but fresh bundle share < 10%
=> floor 40 to 55 depending on recency and route proximity

bridge/router/dex appears in active recent corridor
=> floor 35 to 50 depending on share and continuity

unknown contract boundary blocks source proof
=> floor 35 to 45 depending on amount continuity
```

The explanation must say:

```text
HTX/Huobi corridor exposure was found, but exact deposit-source attribution was not proven.
```

### 4. Wallet Exposure Profile Background Score

Background score is additive and capped.

Recommended initial cap:

```text
walletExposureProfile contribution max = 20 points
```

Suggested scoring:

```text
historical HTX/Huobi volume share >= 50%
=> +15 to +20

historical HTX/Huobi volume share >= 20%
=> +8 to +14

historical HTX/Huobi volume share >= 5%
=> +3 to +7

frequent bridge/router/dex usage
=> +3 to +10

high unknown-source share
=> +3 to +10

short in-out velocity across many transfers
=> +3 to +8
```

Historical exposure cannot create `CRITICAL` by itself unless it is paired with fresh bundle risk, hard evidence, or strong corridor evidence.

### 5. Dampeners

Dampeners should reduce context risk, not hard evidence.

Recommended rules:

- do not dampen USDT blacklist;
- do not dampen exact approval-drain proof;
- do not materially dampen high fresh HTX/Huobi bundle share;
- allow dampening for operational liquidity behavior when the risk is only background/context;
- allow clean CEX coverage to reduce unknown-source uncertainty, but not to erase risky fresh-source share.

## Explanation Model

The report should separate statements:

```text
Fresh deposit funding:
- HTX/Huobi: 0%
- clean CEX: 19%
- unknown: 81%

Wallet exposure profile:
- historical HTX/Huobi exposure: present
- bridge/router/dex use: present/not present
- unknown contract exposure: present/not present

Final score:
- fresh bundle score
- corridor floor
- background profile score
- dampeners
- final score and decision
```

For the trigger case, the desired explanation shape is:

```text
The old 249,590 USDT HTX/Huobi-linked transfer is not proven as the source of the checked 100,000 USDT deposit because the intermediate wallet had later spending and fresher funding before the 204,047 USDT outbound.

However, HTX/Huobi exposure is still relevant as wallet/corridor context if the sender's recent or historical money corridor shows material HTX/Huobi use.
```

## Data Flow

Implementation should follow this flow:

```text
incoming deposit job
-> build sender transfer history window
-> select fresh funding bundle for sender -> watched wallet deposit
-> run Where Is Money with balance-aware path attribution
-> derive freshBundleExposure from origin paths
-> derive walletExposureProfile from sender edges and classified counterparties
-> calculate unified incoming deposit risk
-> attach scoring breakdown to result_json
-> show same breakdown in admin graph/report
```

## Test Cases

### Trigger Case: `b4603...`

Expected behavior:

- do not state that HTX/Huobi is 100% source of the checked deposit unless fresh bundle attribution proves it;
- keep HTX/Huobi visible as corridor/background exposure if found;
- final score should not collapse to low if material risky exposure remains;
- explanation must say whether HTX/Huobi is fresh source or historical/context exposure.

### Control Case: `53b742...`

Expected behavior:

- keep `ACCEPTABLE` unless fresh risky source is found;
- clean CEX share should reduce uncertainty;
- background profile can add limited score, but should not create decline alone.

### Control Case: `e3a049...`

Expected behavior:

- keep approval-review context separate from exact approval-drain proof;
- if approval enrichment is disabled in a bounded rerun, the report should not pretend approval risk was checked;
- score should be driven by fresh source attribution and coverage.

### Additional File Cases

Run at least two more incoming deposit jobs from `C:\Users\User\OneDrive\Desktop\оценки.txt`:

- one low/acceptable case;
- one decline/high or bridge/contract-boundary case.

For each case, compare:

```text
saved score
new score
fresh bundle shares
wallet exposure profile contribution
decision reason
```

## Non-Goals

This design does not:

- change wallet check scoring directly;
- add manual review as a product outcome;
- create multiple user-facing scores;
- claim HTX/Huobi source when it is only historical exposure;
- rely on a single stale inbound transfer as proof of source.

## Implementation Notes

Likely implementation units:

```text
src/forensics/incomingDepositExposureProfile.ts
src/forensics/incomingDepositJob.ts
src/forensics/provenanceScoring.ts
src/risk/unifiedIncomingDepositRisk.ts
src/admin/forensicsGraph.ts
tests/forensics/incomingDepositJob.test.ts
tests/risk/unifiedWalletRisk.test.ts
```

The design should prefer small structured objects over reason-string parsing.

Suggested new data shapes:

```ts
type IncomingFreshBundleExposure = {
  htxHuobiShare: number;
  cleanCexShare: number;
  bridgeRouterDexShare: number;
  unknownContractShare: number;
  riskyLabelShare: number;
  unknownShare: number;
};

type IncomingWalletExposureProfile = {
  windowStart: string;
  windowEnd: string;
  incomingVolumeRaw: string;
  outgoingVolumeRaw: string;
  htxHuobiIncomingShare: number;
  cleanCexIncomingShare: number;
  bridgeRouterDexVolumeShare: number;
  unknownContractVolumeShare: number;
  unknownSourceShare: number;
  inOutVelocityScore: number;
  scoreContribution: number;
  reasons: string[];
};
```

The exact type names can change during implementation, but the separation between fresh source and historical exposure must remain.

## Spec Self-Review

- No open blanks remain.
- The design keeps one final score and decision.
- Fresh source proof and historical exposure are explicitly separated.
- HTX/Huobi can still create high risk, but the explanation must distinguish source proof from background/corridor context.
- Scope is limited to incoming deposit scoring and reporting; wallet checks are not changed directly.
