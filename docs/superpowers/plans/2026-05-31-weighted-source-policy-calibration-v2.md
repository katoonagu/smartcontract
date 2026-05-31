# Weighted Source Policy Calibration v2 Implementation Plan

> This plan updates the older `2026-05-31-weighted-htx-huobi-policy.md` plan for the current codebase. It assumes the final scoring architecture is already implemented and focuses on calibration, report clarity, cross-mode consistency, and approval-episode separation.

## Goal

Make source-policy scoring consistent and explainable across:

- manual `where-is-money`;
- low-balance recent-flow;
- incoming deposit checks;
- contract LLM enrichment;
- approval safety checks;
- Telegram output.

The main objective is not to make risky sources "safe". The objective is to avoid false explanations:

```text
source-policy context != scam proof
bridge/cross-chain boundary != drainer proof
LLM suspicion != exact approval-drain proof
unknown origin != automatic HIGH for operational wallets
```

## Current Baseline

Live smoke after the latest code changes:

| Address | Current result | Important behavior |
|---|---|---|
| `THRSTA...Pet` | `ACCEPTABLE 28 LOW-MEDIUM` | low-balance recent-flow works |
| `TVzGY...ZMF` | `ACCEPTABLE 54 MEDIUM` | 15% HTX is weighted context, not hard decline |
| `TTs9x...7FD` | `ACCEPTABLE 25 LOW-MEDIUM` | operational wallet dampening works |
| `TEYPU...ZBM` | `ACCEPTABLE 25 LOW-MEDIUM` | operational wallet dampening works |
| `TPvF4...7Jb` | `DECLINE 75 HIGH` | LayerZero/OFT is no longer called drainer; declined by bridge policy |
| `TLhVzk...gXe` | `DECLINE 90 CRITICAL` | LLM drainer-like contract suspicion remains strong |

## Execution Order

```text
Task 1: Baseline regression tests for current live behavior
Task 2: Replace legacy LLM trigger dependency on combined path decision
Task 3: Add explicit source-policy evidence section to reports
Task 4: Calibrate HTX/Huobi score curve with real wallet fixtures
Task 5: Add bridge/cross-chain policy mode without changing default behavior
Task 6: Approval episode separation and report wording
Task 7: Legacy policy audit and cross-mode consistency
Task 8: Full smoke and final PR review
```

Use subagent-driven execution task by task if implementing this plan in multiple commits.

## Task 1: Baseline Regression Tests For Current Live Behavior

**Purpose:** Freeze the improved behavior before changing scoring again.

**Files:**

- `tests/check/whereIsMoneyCheck.test.ts`
- `tests/forensics/provenanceScoring.test.ts`
- `tests/fixtures/forensics/regressionCases.ts`

### Steps

- [ ] Add a TVz-like fixture:

```text
current balance target: 100k
HTX path: about 15%
wallet role: operational_liquidity_wallet
hard bad evidence: none
expected: ACCEPTABLE, score 45-55, proofLevel exchange_policy_context
```

- [ ] Add a TEYPU/TTs-like fixture:

```text
large operational wallet
unproven main path
small clean CEX path
hard bad evidence: none
expected: ACCEPTABLE, LOW-MEDIUM, no hard bad evidence
```

- [ ] Add a TPvF4-like fixture:

```text
low-balance recent-flow
LayerZero/OFT source classified legitimate_service
strict bridge policy active
expected: DECLINE by exchange_policy_decline, not llm_assisted_suspicion, not exact drain
```

- [ ] Add a TLh-like fixture:

```text
bridge contract legitimate_service
separate drainer_like contract suspicion
expected: report separates both verdicts; exact drain wording only if deterministic proof exists
```

### Verification

```bash
npm test -- tests/check/whereIsMoneyCheck.test.ts tests/forensics/provenanceScoring.test.ts
npm run typecheck
```

## Task 2: Replace Legacy LLM Trigger Dependency On Combined Path Decision

**Problem:** `runWhereIsMoneyCheck()` still decides whether LLM is needed partly from:

```ts
const combined = combineMoneyOriginDecision(originPaths);
const deterministicDecision = fastDecline || approvalDrainDecline ? "DECLINE" : combined.decision;
const needsContractLlmForDecision = deterministicDecision === "REVIEW" || approvalDrainReviewFindings.length > 0;
```

This keeps old path-level verdict semantics in the LLM trigger.

**Target:** LLM trigger should be evidence-driven:

```text
unknown contract boundary
unknown contract source-policy evidence
approval-drain review finding
contract-only path
service boundary needing contract classification
LLM unavailable safe-default path
```

**Files:**

- `src/check/whereIsMoneyCheck.ts`
- `src/forensics/contractLlmVerdict.ts` if helper types are needed
- `tests/check/whereIsMoneyCheck.test.ts`

### Steps

- [ ] Add helper:

```ts
function needsContractLlmEvidence(input: {
  originPaths: MoneyOriginPath[];
  approvalDrainReviewFindings: ApprovalDrainReviewFinding[];
  fastDecline: boolean;
  approvalDrainDecline: boolean;
}): boolean
```

- [ ] Trigger LLM when paths include:

```text
sourceExposureKind === "unknown_contract"
stoppedReason === "unlabeled_service_boundary" and classification is contract/service
approvalDrainReviewFindings.length > 0
path reasons mention unknown contract / contract boundary
```

- [ ] Do not trigger LLM only because minority HTX/WhiteBIT path returned internal `REVIEW`.

- [ ] Keep LLM for bridge/cross-chain only when the contract classification is incomplete or the path has approval/contract uncertainty.

### Tests

- [ ] Minority HTX-only path does not create empty/unnecessary LLM case file.
- [ ] Unknown contract path triggers LLM even if path-level decision is not `REVIEW`.
- [ ] Approval review finding triggers LLM.
- [ ] Fast critical / exact approval-drain does not need LLM for final decision.

## Task 3: Add Explicit Source-Policy Evidence Section To Reports

**Problem:** Users see a final score, but not enough structured source-policy breakdown.

**Target Telegram/CLI block:**

```text
Source policy exposure
- HTX/Huobi: 15% raw / 14% effective, 54/100, context
- Cross-chain: 77% raw / 77% effective, 75/100, policy decline

This is not scam/blacklist proof.
```

**Files:**

- `src/bot/createBot.ts`
- `scripts/forensicWhereIsMoney.ts`
- `tests/bot/createBot.test.ts`
- `tests/check/whereIsMoneyCheck.test.ts`

### Steps

- [ ] Add formatter helper for `report.assessment.sourcePolicyEvidence`.
- [ ] Show `kind`, `aggregateShare`, `effectiveShare`, `score`, `proofLevel`.
- [ ] Keep output concise: max 3 source-policy lines, sorted by score.
- [ ] Add wording:

```text
Policy context, not scam/blacklist/drain proof.
```

- [ ] Ensure source-policy section is shown for:
  - HTX/Huobi context;
  - WhiteBIT context;
  - bridge/cross-chain policy decline;
  - unknown contract context.

### Tests

- [ ] TVz-like report contains `HTX/Huobi` and `15%`.
- [ ] TPvF4-like report contains `cross-chain` or `bridge` and does not say `drainer proof`.
- [ ] WhiteBIT report says medium/source-policy context.

## Task 4: Calibrate HTX/Huobi Score Curve With Real Wallet Fixtures

**Current code:** `src/forensics/provenanceScoring.ts` already has:

```ts
baseShareScore("htx_huobi", share)
scoreSourceExposures(...)
hopAdjustment(...)
timeAdjustment(...)
amountContinuityAdjustment(...)
walletRoleAdjustment(...)
```

**Target:** Keep current architecture, tune only if regression tests show mismatch.

### Desired score bands

| HTX/Huobi case | Expected |
|---|---|
| `<5%`, operational | `18-30`, ACCEPTABLE |
| `5-10%`, operational | `30-42`, ACCEPTABLE |
| `10-20%`, operational | `45-55`, ACCEPTABLE/MEDIUM |
| `10-20%`, direct fast fresh | `60-72`, DECLINE |
| `20-30%`, operational close/fast | `55-65`, contextual/possible decline |
| `30-50%` | `65-78`, usually DECLINE |
| `>=50%` | `78+`, DECLINE |

### Steps

- [ ] Add tests for each band in `tests/forensics/provenanceScoring.test.ts`.
- [ ] Add one test where high operational score and old wallet dampen minority exposure.
- [ ] Add one test where direct/fast/fresh 15% exposure still declines.
- [ ] Add one test where multiple small HTX paths aggregate into a higher context score.
- [ ] If needed, adjust only:
  - `baseShareScore`;
  - `capSourceScore`;
  - `walletRoleAdjustment`;
  - data-quality adjustment thresholds.

### Do not change

- Exact taint and exact approval-drain priority.
- HTX/Huobi majority decline.
- WhiteBIT capped medium policy behavior.

## Task 5: Add Bridge/Cross-Chain Policy Mode

**Problem:** Known legitimate LayerZero/OFT can be legitimate service but still declined by policy. That is fine, but it should be configurable and explicit.

**Default:** keep current strict behavior.

**New config:**

```ts
sourcePolicy.bridge.mode:
  | "strict_decline"
  | "weighted_policy"
  | "allow_legitimate_service_warning"
```

Environment proposal:

```text
SOURCE_POLICY_BRIDGE_MODE=strict_decline
```

**Files:**

- `src/config.ts`
- `.env.example`
- `src/forensics/provenanceScoring.ts`
- `src/forensics/moneyOriginOperationalAssessment.ts`
- `tests/config.test.ts`
- `tests/forensics/provenanceScoring.test.ts`
- `tests/check/whereIsMoneyCheck.test.ts`

### Behavior

`strict_decline`:

```text
bridge/cross-chain close in selected provenance => DECLINE 65-82
```

`weighted_policy`:

```text
score by share/proximity/time/continuity
high-confidence legitimate_service can lower score but cannot prove clean origin
```

`allow_legitimate_service_warning`:

```text
if bridge contract is high-confidence legitimate_service
and no hard bad evidence exists
and exact drain is not proven
then ACCEPTABLE warning is allowed
```

### Tests

- [ ] TPvF4-like strict mode stays `DECLINE`, no drainer wording.
- [ ] TPvF4-like weighted mode lowers score but keeps source-policy warning.
- [ ] Drainer proof through a bridge-like contract still stays hard decline.

## Task 6: Approval Episode Separation And Report Wording

**Problem:** Current contract LLM verdicts exist, but approval context can still be hard for users to understand. Active approvals and unrelated later suspicious contracts must not collapse into one story.

**Target model:**

```ts
ApprovalEpisodeReport {
  ownerAddress: string;
  currentApproval: ApprovalFact;
  previousApprovalContext: ApprovalFact[];
  followingRouteContext: TxFact[];
  currentApprovalVerdict:
    | "known_service_approval"
    | "unknown_active_contract_approval"
    | "active_eoa_unlimited_approval"
    | "revoked_or_inactive"
    | "exact_drain_proven";
  episodeVerdict:
    | "legitimate_service_route"
    | "unknown_contract_inside_service_route"
    | "suspicious_standalone_approval"
    | "drainer_setup_like"
    | "insufficient_data";
  approvalSafetyRisk: number;
  drainProofRisk: number;
  falsePositiveGuards: string[];
  requiredAction?: "revoke_approval" | "monitor" | "none";
}
```

**Files:**

- `src/approvals/approvalEpisodeTypes.ts`
- `src/approvals/approvalEpisodeCaseFile.ts`
- `src/approvals/approvalEpisodeLlmClassifier.ts`
- `src/approvals/safetyRecheck.ts`
- `src/approvals/approvalWorker.ts`
- `tests/approvals/approvalEpisodeCaseFile.test.ts`
- `tests/approvals/approvalEpisodeLlmClassifier.test.ts`

### Rules

- [ ] Exact deterministic drain always wins:

```text
approve -> transferFrom -> checked wallet/deposit receiver
```

- [ ] LLM cannot output exact drain unless deterministic transferFrom evidence exists in the case file.
- [ ] Current approval is scored separately from previous approvals in the same session.
- [ ] Previous approvals are context only unless exact transferFrom evidence links them.
- [ ] Known bridge/router/GasFree approval gets service-route guard.
- [ ] Unknown active unlimited contract approval is hygiene risk, not scam proof by itself.

### TLh acceptance target

For `TLhVzk...`:

```text
TPwez...Et5s: legitimate service approval
TNKG...pxQ5: unknown active unlimited contract approval / medium hygiene risk unless drain facts exist
TJpMj...DvaQ: separate LLM drainer-like contract suspicion
```

The report must not imply that all three are the same event.

## Task 7: Legacy Policy Audit And Cross-Mode Consistency

**Purpose:** Find old code paths that still present source-policy context as hard proof.

**Files to audit:**

- `src/risk/riskPolicyEngine.ts`
- `src/risk/evaluation.ts`
- `src/check/deepForensicCheck.ts`
- `src/forensics/inboundProvenance.ts`
- `src/forensics/counterpartyRisk.ts`
- `src/monitor/monitorWorker.ts`
- `src/approvals/approvalWorker.ts`
- `src/bot/createBot.ts`

### Audit checklist

- [ ] WhiteBIT source exposure is not called scam proof.
- [ ] HTX/Huobi source exposure is not hard bad evidence unless it is a configured policy decline.
- [ ] Bridge/router/DEX/cross-chain wording says source-policy boundary.
- [ ] Unknown contract wording says unproven/contract context unless LLM or exact drain evidence exists.
- [ ] Incoming deposit cards show `Deposit risk`, source-policy exposure, and fast sender risk separately.
- [ ] Deep forensic reports do not contradict `where-is-money` proof levels.

### Tests

- [ ] Add or update formatter tests for each wording class.
- [ ] Add integration tests that incoming deposit and where-is-money produce the same source-policy explanation for the same seeded path.

## Task 8: Full Verification And Live Smoke

Run static checks:

```bash
npm run typecheck
npm test
```

Run live smoke:

```bash
npm run forensic:where-is-money -- -- --source TVzGYWyg89wUmwhvbcwfonHVLDYYQAiZMF --depth 20 --max-addresses 60 --max-edges 60 --approval-mode triggered --approval-candidates 12 --contract-tx-info 12 --contract-tx-info-delay-ms 8000
npm run forensic:where-is-money -- -- --source TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM --depth 20 --max-addresses 60 --max-edges 60 --approval-mode triggered --approval-candidates 12 --contract-tx-info 12 --contract-tx-info-delay-ms 8000
npm run forensic:where-is-money -- -- --source TTs9xCEZ43niXvfKTu7LcF7Kcud3Bbw7FD --depth 20 --max-addresses 60 --max-edges 60 --approval-mode triggered --approval-candidates 12 --contract-tx-info 12 --contract-tx-info-delay-ms 8000
npm run forensic:where-is-money -- -- --source TPvF4YmjYFVH8jBYUD63mEAxwPssZoL7Jb --depth 20 --max-addresses 60 --max-edges 60 --approval-mode triggered --approval-candidates 12 --contract-tx-info 12 --contract-tx-info-delay-ms 8000
npm run forensic:where-is-money -- -- --source TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe --depth 20 --max-addresses 60 --max-edges 60 --approval-mode triggered --approval-candidates 12 --contract-tx-info 12 --contract-tx-info-delay-ms 8000
```

Expected:

- `TVzGY...`: minority HTX stays weighted context, no hard bad evidence.
- `TEYPU...`: operational wallet stays acceptable unless new hard evidence appears.
- `TTs9x...`: operational wallet stays acceptable unless new hard evidence appears.
- `TPvF4...`: LayerZero/OFT is legitimate bridge/cross-chain policy, not drainer proof.
- `TLhVzk...`: bridge approval and drainer-like contract suspicion are separated.

## Risks

- Lowering minority HTX/Huobi too much can let risky funds pass.
  - Mitigation: direct/fast/fresh and aggregate exposure tests.

- Bridge mode could accidentally weaken strict exchange policy.
  - Mitigation: default remains `strict_decline`.

- LLM positive service verdict could over-dampen unrelated unknown contracts.
  - Mitigation: keep existing coverage check: positive verdict must cover every unresolved contract path it dampens.

- Approval episode grouping could mix unrelated approvals.
  - Mitigation: current approval is always primary; previous approvals are context only.

- Legacy modules can keep stale wording.
  - Mitigation: Task 7 audit and formatter tests.

## Done Definition

- [ ] Old fixed 78 HTX/Huobi behavior is not reintroduced.
- [ ] Source-policy evidence is visible in Telegram/CLI reports.
- [ ] HTX/Huobi share thresholds are covered by tests.
- [ ] Bridge/cross-chain policy mode exists with strict default.
- [ ] Approval episode report separates current approval, context approvals, and separate suspicious contracts.
- [ ] Incoming deposit and where-is-money use consistent source-policy explanations.
- [ ] `npm test` and `npm run typecheck` pass.
- [ ] Live smoke results match the expected behavior above.
