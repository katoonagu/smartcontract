# Where-Is-Money Consistency Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make manual `/check`, incoming deposit alerts, LLM service verdicts, and tests use the same current `where-is-money` logic so old paths do not produce misleading medium/high scores or fail on provider rate limits.

**Architecture:** Keep `where-is-money` as the shared provenance engine. Fix the two places that still bypass or weaken it: manual `wallet_profile` low-balance checks and incoming deposit prefetch. Then make positive LLM `legitimate_service` verdicts affect operational scoring, and remove or quarantine legacy incoming modules that production no longer calls.

**Tech Stack:** TypeScript, Node.js, Vitest, existing `runWhereIsMoneyCheck`, `buildIncomingDepositReport`, Telegram bot worker, DeepSeek/OpenAI-compatible LLM verdict layer.

---

## Spec

### Problem 1: Manual `/check` Still Loses Recent-Flow Logic

Manual `/check <address>` queues `mode: "wallet_profile"` in `src/bot/createBot.ts`.

Today that can still hit the old zero-balance path:

- `src/check/whereIsMoneyCheck.ts` returns a zero-balance wallet-profile report before recent-flow selection.
- recent-flow selection excludes `wallet_profile`.

This is wrong for the real user flow:

```text
sender sends money to our watched wallet
sender balance becomes near-zero
operator clicks "Check sender"
```

The answer should not be:

```text
Current USDT: 0
cannot prove source funds
```

It should analyze the sender's recent meaningful flow:

```text
latest outgoing transfer anchor
recent funding inputs before that transfer
origin path / service boundary / contract / LLM context
```

### Problem 2: Positive LLM Service Verdict Does Not Lower Risk

`topLegitimateServiceLlmVerdict` currently accepts only deterministic verdicts. Because of that, a DeepSeek verdict like:

```text
legitimate_service
confidence: 0.86
contractRiskScore: 20
decisionRecommendation: ACCEPTABLE
```

does not lower `unknown_contract_boundary` risk.

Correct behavior:

- LLM positive verdict can lower unknown-service risk only when confidence is high and no hard bad evidence exists.
- It must not override hard policy: HTX/Huobi, bridge/router/DEX hard boundary, exact approval-drain, blacklist/scam/stolen labels, or active unsafe EOA approval.

### Problem 3: Incoming Deposit Job Can Fail Before Shared Logic

`buildIncomingDepositReport` fetches sender edges before shared provenance logic. If indexed/live transfer reads throw `429`, abort, or TronGrid fallback errors, the whole job can fail instead of producing a partial report.

Correct behavior:

- incoming deposit report should degrade to partial coverage, not fail;
- indexed and live reads should fail independently;
- one successful source should be enough;
- if both fail, report should still return with low data quality and explicit warnings.

### Problem 4: Legacy Incoming Pipelines Create False Confidence In Tests

These modules are now imported only by tests:

- `src/forensics/incomingDepositProvenance.ts`
- `src/forensics/incomingDepositRisk.ts`
- `src/forensics/incomingDepositContractContext.ts`

That is dangerous because tests can pass against code production no longer uses.

Correct behavior:

- production-relevant coverage should live in `tests/forensics/incomingDepositJob.test.ts`;
- dead legacy modules should be deleted or explicitly quarantined so they cannot be mistaken for active Telegram alert logic.

---

## Implementation Plan

### Task 1: Enable Recent-Flow For Manual `wallet_profile` Checks

**Files:**

- Modify `src/check/whereIsMoneyCheck.ts`
- Modify `tests/check/whereIsMoneyCheck.test.ts`

**Behavior:**

- Manual `wallet_profile` checks should use recent-flow when:
  - no seed transaction is provided;
  - no requested amount is provided;
  - current USDT balance is known and below the low-balance threshold;
  - the wallet has meaningful recent USDT history.
- The old zero-balance wallet-profile report should only remain as a final fallback when there is no meaningful recent-flow data.
- Report wording must not call this `balance-forming coverage`; it is `recent-flow` or `recent funding history`.

**Implementation steps:**

- [ ] Add a failing test:

```ts
it("uses recent-flow provenance for wallet_profile low-balance sender after outgoing transfer", async () => {
  // address balance is near zero
  // address had recent inbound funding
  // address then sent a large outgoing transfer
  // mode is wallet_profile
  // expected provenance scope is recent_flow, not zero-balance wallet profile
});
```

- [ ] In `src/check/whereIsMoneyCheck.ts`, move the zero-balance `wallet_profile` return after recent-flow eligibility.
- [ ] Remove `input.mode !== "wallet_profile"` from the recent-flow selector guard.
- [ ] Ensure `seedTransfers` and `requestedAmountRaw` still take priority over recent-flow.
- [ ] Preserve normal current-balance behavior for wallets with balance above threshold.
- [ ] Add report note:

```text
Current balance is low; analyzed recent meaningful wallet flow instead of current balance origin.
```

**Verification:**

```powershell
npm test -- tests/check/whereIsMoneyCheck.test.ts
```

**PR-review checkpoint:**

- Confirm `/check` no longer gives a misleading medium result only because sender already sent funds away.
- Confirm high-balance `wallet_profile` checks still use current-balance origin.

---

### Task 2: Let High-Confidence LLM `legitimate_service` Lower Unknown Boundary Risk

**Files:**

- Modify `src/forensics/moneyOriginOperationalAssessment.ts`
- Modify `tests/forensics/moneyOriginOperationalAssessment.test.ts`

**Behavior:**

LLM verdict may reduce risk only when all are true:

- verdict is `legitimate_service`;
- confidence is `>= 0.80`;
- contract risk is low enough, target `<= 35`;
- recommendation is `ACCEPTABLE`;
- source is live/cache/deterministic, not unavailable;
- no hard bad evidence exists.

It must not reduce risk for:

- exact approval-drain provenance;
- HTX/Huobi hard policy;
- bridge/router/DEX hard policy;
- blacklist/scam/stolen labels;
- active unlimited approval to EOA;
- high-confidence `drainer_like` or `unknown_suspicious` verdict.

**Implementation steps:**

- [ ] Add failing test: LLM `legitimate_service` with confidence `0.86` lowers unknown contract boundary to `ACCEPTABLE` / low-medium when no hard evidence exists.
- [ ] Add guard test: same LLM verdict does not override bridge/router/DEX hard boundary.
- [ ] Add guard test: low-confidence `legitimate_service` does not lower risk.
- [ ] Change `topLegitimateServiceLlmVerdict` so it accepts LLM/cache positive verdicts, not only `source === "deterministic"`.
- [ ] Keep the existing hard-evidence checks before the risk-lowering branch.
- [ ] Update reason text to be explicit:

```text
Unknown contract boundary was downgraded because AI classified the contract as a legitimate service and no hard bad evidence was found.
```

**Verification:**

```powershell
npm test -- tests/forensics/moneyOriginOperationalAssessment.test.ts
```

**PR-review checkpoint:**

- Confirm LLM can reduce false positives.
- Confirm LLM cannot wash hard-bad evidence.

---

### Task 3: Make Incoming Deposit Sender Fetch 429/Abort Safe

**Files:**

- Modify `src/forensics/incomingDepositJob.ts`
- Modify `tests/forensics/incomingDepositJob.test.ts`

**Behavior:**

`buildIncomingDepositReport` must return a report even if sender history fetches fail.

Source handling:

- indexed source fails, live source succeeds -> use live source;
- live source fails, indexed source succeeds -> use indexed source;
- both fail -> return partial report with low data quality and warnings;
- provider errors should not bypass shared `where-is-money` partial-report behavior.

**Implementation steps:**

- [ ] Add helper for independent transfer source reads:

```ts
async function readTransfersOrEmpty<T>(
  label: string,
  address: string,
  read: () => Promise<T[]>
): Promise<T[]> {
  try {
    return await read();
  } catch (error) {
    warnings.push(`${label} transfer fetch failed for ${address}: ${formatError(error)}`);
    return [];
  }
}
```

- [ ] Use this helper inside `fetchEdgesForAddress`.
- [ ] Use the same pattern inside latest-edge fallback helpers, if present.
- [ ] Deduplicate warning strings before returning the report.
- [ ] Merge source warnings into report `warnings`, `coverageNotes`, or equivalent existing field.
- [ ] Do not mark the job failed only because sender edge fetch failed.

**Tests:**

- [ ] `continues with partial report when sender transfer fetch is rate-limited`
- [ ] `uses live transfers when indexed cache fails`
- [ ] `uses indexed transfers when live provider fails`

**Verification:**

```powershell
npm test -- tests/forensics/incomingDepositJob.test.ts
```

**PR-review checkpoint:**

- Confirm `429` no longer converts normal incoming alert into failed job.
- Confirm the report visibly says data quality is lower when both sources fail.

---

### Task 4: Delete Or Quarantine Dead Incoming Pipelines

**Files:**

- Review/delete `src/forensics/incomingDepositProvenance.ts`
- Review/delete `src/forensics/incomingDepositRisk.ts`
- Review/delete `src/forensics/incomingDepositContractContext.ts`
- Review/delete old tests that only cover those modules
- Port useful cases into `tests/forensics/incomingDepositJob.test.ts`

**Behavior:**

There should be one active incoming deposit production path:

```text
Telegram incoming alert -> incoming_deposit_check job -> buildIncomingDepositReport -> shared where-is-money/provenance/LLM logic
```

Old modules must not remain as fake green coverage.

**Implementation steps:**

- [ ] Run:

```powershell
rg -n "incomingDepositProvenance|incomingDepositRisk|incomingDepositContractContext" src tests
```

- [ ] For every useful legacy test scenario, port it to `tests/forensics/incomingDepositJob.test.ts`.
- [ ] Required scenarios after porting:
  - unknown smart contract funding triggers contract/LLM context;
  - high-confidence legitimate service can lower risk when no hard evidence exists;
  - bridge/router/DEX boundary remains decline policy;
  - WhiteBIT remains medium policy, not scam proof by itself;
  - exact approval-drain still declines.
- [ ] Delete legacy modules if production imports are truly zero.
- [ ] If deletion is too risky, add `legacy` naming and a file header:

```ts
// Legacy test fixture only. Production incoming alerts use incomingDepositJob.ts.
```

Prefer deletion unless a real production import remains.

**Verification:**

```powershell
rg -n "incomingDepositProvenance|incomingDepositRisk|incomingDepositContractContext" src tests
npm run typecheck
npm test
```

Expected `rg` result after deletion: no matches, except docs/plans if searched outside `src tests`.

**PR-review checkpoint:**

- Confirm tests exercise the Telegram production path, not dead helper modules.
- Confirm no functionality was removed from the actual incoming job.

---

## End-To-End Smoke Checks

After all tasks:

- [ ] Run full validation:

```powershell
npm run typecheck
npm test
```

- [ ] Manual `/check` smoke with low-balance sender-like wallet:

```text
Expected: recent-flow provenance, not zero-balance current-balance failure.
```

- [ ] Incoming deposit smoke:

```text
Expected: Deposit risk separate from Fast sender risk.
Expected: partial report on provider fetch failure, not failed job.
```

- [ ] LLM positive verdict smoke:

```text
Expected: legitimate_service can lower unknown contract boundary only when hard evidence is absent.
```

---

## Risk Controls

- Do not lower hard-policy risk with LLM.
- Do not call LLM on empty case files.
- Do not call `unknown_contract_boundary` hard bad evidence by itself.
- Do not show `REVIEW` as final user decision in Telegram.
- Do not describe recent-flow as current balance provenance.
- Do not let stale legacy tests define production correctness.

---

## Recommended Execution Order

Use subagent-driven development, one task at a time:

1. Task 1 in a fresh subagent, then PR-style review.
2. Task 2 in a fresh subagent, then PR-style review.
3. Task 3 in a fresh subagent, then PR-style review.
4. Task 4 in a fresh subagent, then full review and smoke.

This order is deliberate:

- Task 1 fixes the user-visible wrong manual `/check` behavior first.
- Task 2 fixes score inflation from positive LLM being ignored.
- Task 3 hardens incoming alerts against provider rate limits.
- Task 4 removes stale test coverage only after the production path has better tests.

