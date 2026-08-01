# Amount-Weighted Source Policy Scoring Design

## Goal

Make source-policy risk proportional to the amount actually connected to the source-policy evidence.

The motivating case is:

```text
checked incoming deposit: 46,000 USDT
bridge-connected branch: 4,060 USDT
bridge share: 8.8%
```

This must not score the whole wallet as `75/HIGH` only because a minority branch reaches a bridge. Bridge/router/DEX/unknown-contract evidence is policy context unless it covers a meaningful share of the selected amount or there is separate hard proof.

The target architecture is:

```text
hard proof stays hard
+ source-policy evidence is weighted by selected amount share
+ path context can adjust but not exceed share caps
+ every score explains amount, denominator, share, severity, and final contribution
```

## Current Diagnosis

The project already has the right building blocks:

- `src/forensics/provenanceScoring.ts` has `baseShareScore`, `scoreSourceExposures`, `SourcePolicyEvidence`, `RiskLayerScore`, and path context adjustments.
- `src/forensics/moneyOriginPolicy.ts` passes `balanceShare` into stop classification for some source types.
- `src/forensics/moneyOriginOperationalAssessment.ts` consumes source-policy evidence and separates hard proof from policy/context risk.
- `src/forensics/crossChainEvidence.ts` has selected-share input for cross-chain terminal boundaries.
- `src/forensics/incomingDepositJob.ts` reuses money-origin style provenance for concrete deposits.

The gaps are:

1. `moneyOriginPolicy.ts` still assigns fixed high score `78` to `bridge/router/DEX` boundaries, ignoring `balanceShare`.
2. `baseShareScore("bridge_router_dex", s)` is too aggressive: any positive share currently starts around `55`.
3. Some final branches still use max/floor behavior that can promote a small source-policy branch into a high whole-result score.
4. Cross-chain terminal scoring uses share, but the adjustment is too shallow and not consistent with money-origin source-policy scoring.
5. UI can show a high node/path score without showing the denominator and affected-share math.

## Scope

Use one shared amount-weighted source-policy scorer across:

| Module | Required use |
|---|---|
| `incoming_deposit_check` | Yes. Denominator is the checked incoming deposit amount. |
| `where_is_money_check` | Yes. Denominator is selected amount / selected drain episode / selected recent-flow target. |
| `address_deep_check` / deep research | Yes, when there is a selected flow, recent-flow scope, balance-forming target, or 30-day/recent-volume denominator. |
| fast/manual address check | No for generic source-policy weighting unless a concrete amount/tx context exists. It still uses hard labels, blacklist, approval risk, and fast behavioral signals. |

## Non-Goals

- Do not lower exact hard proof only because the share is small.
- Do not use full wallet historical volume as denominator when the user asked about a concrete deposit or selected outflow.
- Do not create a second parallel scoring model in each job.
- Do not let UI infer source-policy math from labels alone. The scorer must emit explicit numeric fields.

## Evidence Classes

The scoring model must keep the existing evidence-class separation.

| Evidence | Class | Share weighted? |
|---|---|---|
| USDT blacklist on subject | `hard_proof` | No |
| Exact scam/stolen/phishing/reported_scam label on subject or exact source path | `hard_proof` | No for existence; affected amount still shown |
| Exact approval-drain provenance | `hard_proof` | No for existence; affected amount still shown |
| Sanctioned service | `hard_proof` or non-dampenable source policy | Mostly no; small share remains severe |
| Mixer/no-name liquidity | non-dampenable `source_policy` | Partially share-aware, but high minimum remains |
| Bridge/router/DEX/cross-chain boundary | dampenable `source_policy` | Yes |
| Unknown contract | dampenable `source_policy` / `unknown_origin` | Yes |
| Unknown CEX | dampenable `source_policy` | Yes |
| HTX/Huobi/WhiteBIT | `source_policy` | Yes, with source-specific curve |
| Allowlisted CEX | `clean_source` | Not a risk score |

## Denominator Rules

Every source-policy score must carry a denominator.

```ts
type SourcePolicyScope =
  | "incoming_deposit"
  | "where_selected_amount"
  | "where_drain_episode"
  | "balance_forming_target"
  | "deep_recent_flow"
  | "deep_30d_volume";
```

### incoming_deposit_check

```text
targetAmountRaw = checked incoming deposit amount
```

Funding bundle and path shares are allocated against that exact deposit amount.

Example:

```text
target = 46,000 USDT
bridge path = 4,060 USDT
share = 8.8%
```

### where_is_money_check

Use the concrete selected target:

```text
selected outgoing amount
or selected drain episode volume
or selected current/recent-flow target
```

Do not divide by total historical wallet turnover when the user selected one transaction or one drain episode.

### address_deep_check / deep research

Deep research can have several contexts:

| Context | Denominator |
|---|---|
| Deep was launched from selected incoming/outgoing flow | selected flow amount |
| Deep has recent-flow provenance target | selected recent-flow target amount |
| Deep has balance-forming current-balance target | balance-forming target amount |
| Generic address deep without selected flow | 30-day USDT volume, falling back to recent indexed USDT volume |

If no reliable denominator exists, the module may emit source-policy context but must not produce a high whole-wallet score from a tiny branch.

## Core Formula

For each source-policy path:

```text
allocatedShare = allocatedPathAmount / targetAmount
linkStrength = amount/time/hop continuity confidence
effectiveShare = allocatedShare * linkStrength
valueWeightedRaw = sourceSeverity * effectiveShare
contextAdjusted = valueWeightedRaw + pathContextAdjustment + repeatedExposureAdjustment + dataQualityAdjustment + walletRoleAdjustment
score = clamp(contextAdjusted, shareFloor, shareCap)
```

Rules:

- `allocatedShare` is capped to `[0, 1]`.
- `effectiveShare` is capped to `[0, 1]`.
- `shareFloor` is `0` by default.
- Same-kind paths are grouped before final scoring.
- Same transaction/amount must not be double-counted across duplicate paths.
- `pathContextAdjustment` may raise or lower the score, but never above the share cap.
- Majority exposure may apply a floor.
- Minority bridge/router/DEX exposure must not produce `HIGH` by itself.

Share floors:

- Bridge/router/DEX/cross-chain gets no floor below `50%` aggregate share.
- Bridge/router/DEX/cross-chain may use floor `60` only when aggregate share is `50%+` and the best path has reasonable amount continuity (`>= 0.7`) or another strict source-policy reason exists.
- HTX/Huobi and WhiteBIT may use source-specific floors only when strict policy requires it, but the score still stays under the share cap.
- Mixer, no-name liquidity, and sanctioned service use the explicit exception floors listed below.

## Source Severity

Initial severity constants:

| Kind | Severity |
|---|---:|
| `bridge_router_dex` | 65 |
| `cross_chain_boundary` | 65 |
| `unknown_contract` | 50 |
| `unknown_cex` | 45 |
| `whitebit` | 60 |
| `htx_huobi` | 80 |
| `mixer` | 92 |
| `no_name_token_liquidity` | 88 |
| `sanctioned_service` | 98 |

These are not direct final scores. They are multiplied by amount share and then capped by share bands.

## Share Caps

### Bridge / Router / DEX / Cross-Chain Boundary

| Aggregate share of selected amount | Max score | Default decision |
|---:|---:|---|
| `0%` | `0` | none |
| `>0%` and `<1%` | `10` | context only |
| `1%` to `<5%` | `20` | LOW |
| `5%` to `<10%` | `30` | LOW-MEDIUM |
| `10%` to `<20%` | `45` | MEDIUM / REVIEW |
| `20%` to `<50%` | `59` | REVIEW, below decline |
| `50%` to `<80%` | `70` | source-policy DECLINE allowed |
| `80%+` | `78` | stronger source-policy DECLINE |

For the motivating case:

```text
4,060 / 46,000 = 8.8%
cap = 30
final source-policy score must be <= 30
decision contribution = REVIEW context, not whole-wallet HIGH
```

### Unknown Contract

| Aggregate share | Max score |
|---:|---:|
| `>0%` and `<5%` | `15` |
| `5%` to `<10%` | `25` |
| `10%` to `<20%` | `35` |
| `20%` to `<50%` | `45` |
| `50%+` | `55` |

### Unknown CEX

| Aggregate share | Max score |
|---:|---:|
| `<20%` | `35` |
| `20%` to `<50%` | `45` |
| `50%+` | `50` |

### WhiteBIT

Keep WhiteBIT as medium source-policy risk:

| Aggregate share | Max score |
|---:|---:|
| `<5%` | `30` |
| `5%` to `<10%` | `38` |
| `10%` to `<30%` | `50` |
| `30%` to `<50%` | `55` |
| `50%+` | `60` |

### HTX / Huobi

HTX/Huobi remains stricter than generic bridges, but still share-aware:

| Aggregate share | Max score |
|---:|---:|
| `<5%` | `30` |
| `5%` to `<10%` | `45` |
| `10%` to `<20%` | `55` |
| `20%` to `<30%` | `68` |
| `30%` to `<50%` | `75` |
| `50%` to `<80%` | `82` |
| `80%+` | `85` |

### Mixer / No-Name Liquidity / Sanctions

These are exceptions:

- sanctioned service: floor `95` for any exact exposure;
- mixer: floor `78` for any exact exposure;
- no-name token liquidity: floor `70` for any exact exposure.

They still report affected amount and share, but they are not dampened like bridge/router/DEX.

## Aggregation

### Same Kind

Group source-policy paths by `SourceExposureKind`:

```text
aggregateShare = sum(unique allocatedShare for kind)
effectiveShare = sum(unique effectiveShare for kind)
pathCount = unique path count
```

Then score once per kind.

### Across Kinds

Do not use a raw max for dampenable source-policy exposure. Use bounded additive aggregation:

```text
aggregateScore = maxKindScore
  + min(10, secondKindScore * 0.15)
  + min(5, thirdKindScore * 0.05)
```

This matches the existing `aggregateLayerScores` shape and prevents many tiny branches from inflating the result.

Hard proof is handled separately and can dominate the result.

## Decision Rules

### Source-Policy Evidence

```text
score < 45  -> ACCEPTABLE or LOW/LOW-MEDIUM context, depending on other layers
45-59       -> REVIEW / MEDIUM context
60+         -> DECLINE only when source-policy exposure is meaningful for the selected amount
```

For bridge/router/DEX/cross-chain:

```text
DECLINE requires aggregateShare >= 50% or another independent hard/strict source-policy reason.
```

For HTX/Huobi:

```text
DECLINE can start below 50% only if strict policy says so, but score remains capped by share.
```

For hard proof:

```text
DECLINE can happen regardless of share, but report must show affected amount/share separately.
```

## Module Integration

### Shared Scorer

Create or consolidate a single source-policy scoring API, likely in `src/forensics/provenanceScoring.ts`:

```ts
type AmountWeightedSourcePolicyInput = {
  scope: SourcePolicyScope;
  targetAmountRaw: string;
  paths: MoneyOriginPath[];
  extraEvidence?: SourcePolicyEvidence[];
  coverageCompleteness: number;
  provenanceConfidence: number;
  walletRole: WhereIsMoneyWalletRole;
  operationalLiquidityScore: number;
  cleanCexCoverage: number;
  ageSignals: WhereIsMoneyAgeSignals | null;
};
```

Output:

```ts
type AmountWeightedSourcePolicyResult = {
  scope: SourcePolicyScope;
  targetAmountRaw: string;
  sourcePolicyEvidence: SourcePolicyEvidence[];
  riskLayers: RiskLayerScore[];
  aggregateScore: number;
  decisionContribution: ExchangeDecision;
  warnings: string[];
};
```

### incoming_deposit_check

- Pass the checked deposit amount as `targetAmountRaw`.
- Use funding bundle allocations and origin path allocations.
- If only `4K/46K` is bridge-linked, the bridge layer must stay capped at `30`.
- UI must show `affected / target / share`.

### where_is_money_check

- Pass selected amount / drain episode volume / selected recent-flow amount.
- Replace fixed path max behavior for dampenable source-policy boundaries.
- Keep hard proof and exact approval-drain logic outside dampening.

### address_deep_check

- If launched from a selected flow, pass that selected amount.
- For generic deep, compute denominator from 30-day/recent-flow USDT volume.
- If denominator is weak or unknown, cap dampenable source-policy exposure below `45` and emit a data-quality warning.

### cross-chain

- `scoreCrossChainTerminalBoundary` must delegate share curves to the shared scorer or use the same share caps.
- `bridge_boundary` and `dex_router_boundary` must not use shallow `base - 10` logic for tiny shares.
- Cross-chain extra evidence must preserve `aggregateShare`, `effectiveShare`, and `targetAmountRaw`.

### fast/manual check

- Do not apply amount-weighted source-policy scoring without a concrete target amount.
- Continue using labels, blacklist, approval safety, and fast behavioral heuristics.
- If fast check sees a tiny bridge interaction without selected amount, show context only, not high whole-wallet risk.

## UI and Audit Requirements

Every source-policy risk layer must display:

```text
source kind
affected amount
target amount
raw share
effective share
severity
share cap
path context adjustment
final contribution
proof level
decision contribution
```

Example:

```text
Bridge/router/DEX exposure
Affected: 4.06K USDT / Target: 46K USDT
Share: 8.8% raw / 8.1% effective
Severity: 65
Share cap: 30
Final contribution: 24
Proof: source-policy context, not scam/drain proof
```

The admin graph should not show only `risk 75` on a tiny branch. Node and path details must show the share math.

## Test Cases

### incoming_deposit_check

1. `4.06K / 46K` bridge branch:
   - bridge source-policy score `<= 30`;
   - final decision is not `DECLINE` from bridge alone;
   - UI summary includes `8.8%`.

2. `40 / 46K` bridge branch:
   - source-policy score `<= 10`;
   - no high wallet risk.

3. `30K / 46K` bridge branch:
   - bridge score may reach `60+`;
   - source-policy decline is allowed.

### where_is_money_check

4. Selected drain episode `135K`, bridge path `5K`:
   - score capped by `3.7%` share.

5. Selected drain episode `135K`, bridge path `100K`:
   - source-policy decline allowed.

### deep research

6. Generic 30-day volume `2M`, bridge exposure `4K`:
   - tiny share context only.

7. Deep launched from selected `46K` deposit and bridge exposure `4K`:
   - denominator remains selected `46K`, not 30-day volume.

### hard proof

8. Exact scam/stolen label on the connected source:
   - hard proof can dominate;
   - report still shows affected amount/share.

9. Sanctioned service exposure:
   - high score regardless of small share;
   - report shows affected amount/share and why this is an exception.

### double counting

10. Same tx appears in two projected paths:
    - amount is counted once per source kind.

11. Multiple bridge paths from separate amounts:
    - shares sum up to the target cap.

## Acceptance Criteria

- Bridge/router/DEX/cross-chain source-policy risk is amount-weighted in `incoming_deposit_check`, `where_is_money_check`, and deep research contexts.
- `4.06K / 46K` bridge exposure cannot produce `75/HIGH` by itself.
- Fixed `riskScoreContribution: 78` for generic bridge/router/DEX stop classification is removed.
- Cross-chain terminal boundary scoring uses the same share caps.
- Hard proof remains isolated and can still dominate.
- UI and graph details show affected amount, target amount, share, cap, and final contribution.
- Tests cover incoming deposit, where-is-money, deep research, hard-proof exceptions, and duplicate-path allocation.
