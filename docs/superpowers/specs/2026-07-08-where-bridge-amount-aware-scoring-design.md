# Where Bridge Amount-Aware Scoring Design

## Goal

Calibrate ordinary `Where is money` and unified scoring so non-hard
bridge/router/DEX source-policy exposure does not become a high policy decline
only because it covers 100% of a small selected amount.

The report remains one final result. We do not add a separate LR score or a
separate product mode.

## Trigger Case

Address: `TNQdfZSAvfTN6MhNYHLQBCgqE4rLVZdDAC`.

Fresh Where traced a correct short path:

```text
bridge -> intermediate wallet -> subject
amount: about 2,094.3 USDT
coverage: complete
amount preserved: yes
hard evidence: none
approval-drain evidence: none
wrapper/campaign evidence: none
```

Current scoring gives `78 / DECLINE` because bridge/router/DEX exposure covers
100% of the selected recent-flow amount. Short path context, continuity, and
data-quality adjustments raise the raw score, then the current bridge share cap
allows the result to land at 78.

This overstates the case. The fact is real and should stay visible, but a small
non-hard bridge source-policy path should be `REVIEW` context, not a high
decline.

## Scope

In scope:

- `bridge_router_dex` source-policy exposure.
- `cross_chain_boundary` source-policy exposure.
- Ordinary Where and unified scoring paths that consume the same source-policy
  evidence.
- Admin/Telegram/support reasons that explain the cap.
- Knowledge docs for scoring decisions.

Out of scope:

- TronScan fetching, indexing, candidate windows, and balance-forming trace
  logic.
- DeepCheck graph construction.
- New database fields or migrations.
- A second visible score/scope.
- Dampening hard-evidence or sanctions behavior.

## Product Rule

Amount is a cap for non-hard bridge/router/DEX source-policy exposure.

If there is no hard evidence, no sanctions, no mixer, no exact approval-drain
provenance, and no exact bad provenance:

- affected amount `< 5,000 USDT`: cap `58`, context/review;
- affected amount `5,000-25,000 USDT`: cap `59`, context/review;
- affected amount `25,000-100,000 USDT`: cap up to `68`;
- affected amount `> 100,000 USDT`: can reach `70+`;
- repeated material bridge/router/DEX exposure can reach `70+` only when the
  aggregate affected amount is material, not from one small transfer.

The `25,000-100,000 USDT` band is a cap, not a floor. A single 26k transfer does
not automatically become 68. Path strength, continuity, repeated exposure, data
quality, and wallet role still determine the raw score; the amount cap only
limits how high that non-hard policy context can go.

## Hard Evidence Rule

Do not apply this amount cap to:

- sanctioned service exposure;
- mixer exposure;
- no-name token liquidity hard policy;
- exact approval-drain evidence;
- saved `approval_drain_proximity`;
- exact bad provenance or other hard-evidence floors.

These signals keep their existing floors and decline behavior.

## Scoring Design

The smallest implementation is inside `src/forensics/provenanceScoring.ts`.

`scoreSourceExposures` already receives `targetAmountRaw` and computes
`shareDetail.affectedAmountRaw`. The scoring path should compute the affected
amount before choosing the final cap for bridge/router/DEX kinds:

```text
old cap = shareBandCap(kind, attributableShare)
amount cap = bridgeRouterDexAmountCap(affectedAmountRaw, repeated/aggregate context)
final cap = min(old cap, amount cap)
adjusted score = clamp(max(floor, min(final cap, rawScore)))
```

For bridge/router/DEX, the share floor must not force a score above the amount
cap. In small bands, the amount cap wins and the proof level remains
`exchange_policy_context`.

`baseShareScore` is a share-only helper used by older path-level logic. It
should keep backward-compatible behavior unless a caller can provide amount.
The amount-aware behavior should live in `scoreSourceExposures`, where target
and affected amounts are available.

## Reporting Design

Reasons should preserve the bridge fact and explain the cap:

```text
100% selected recent-flow amount came through bridge/router/DEX (~2.09K USDT).
This is source-policy review context, not direct scam/drain proof; amount-aware
cap kept it below decline threshold.
```

`shareDetail` should expose diagnostic fields for Admin/support:

- `affectedAmountRaw`;
- `amountCap`;
- `amountCapApplied`;
- `amountBand`.

Telegram should not surface raw scoring internals, but it should keep the
meaning: bridge/router/DEX connection, amount, context, no direct scam/drain
proof.

## Expected TNQdf Outcome

For `TNQdfZSAvfTN6MhNYHLQBCgqE4rLVZdDAC`:

- bridge/router/DEX affected amount: about `2,094.3 USDT`;
- share: `100%`;
- path context: strong;
- hard evidence: absent;
- expected Where result: about `55-58`;
- expected decision: `REVIEW`;
- must not be `78 / DECLINE`.

## Tests

Focused tests should cover:

- small `bridge_router_dex` selected amount under 5k caps below 60 and remains
  context/review;
- 5k-25k bridge/router/DEX also caps below 60;
- 25k-100k is capped up to 68 but does not jump to 68 automatically;
- large or repeated material bridge/router/DEX exposure can still reach 70+;
- `cross_chain_boundary` follows the same amount-aware cap;
- sanctions, mixer, no-name liquidity, and exact approval-drain hard floors are
  unchanged;
- Where operational assessment for the TNQdf-like path returns REVIEW around
  55-58 with clear source-policy context reason;
- Telegram/Admin-facing reason text explains bridge context without calling it
  direct scam/drain proof.

## Acceptance Criteria

- TNQdf-like ordinary Where case is no longer `78 / DECLINE`.
- Small non-hard bridge/router/DEX source-policy exposure remains visible as
  review context.
- Hard evidence and sanctions behavior is unchanged.
- Existing HTX/Huobi, WhiteBIT, mixer, sanctioned, no-name liquidity, and
  approval-drain tests remain green.
- Knowledge docs describe the amount-aware cap as current behavior.
