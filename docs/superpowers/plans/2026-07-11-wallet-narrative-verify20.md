# Wallet Narrative and Verify20 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task.

**Goal:** Replace the verbose generic Telegram conclusion with a short deterministic wallet-specific explanation, and recognize the approved exact Verify20 drainer-pattern fingerprint without overstating theft evidence.

**Architecture:** Keep scoring and forensic facts as the source of truth. Add a pure Verify20 fingerprint matcher, feed its typed result into contract evaluation and the existing risk matrix, then add a pure narrative selector/formatter that converts structured evidence into a canonical decision header followed by at most three useful parts. The normal Telegram final uses the new formatter; detailed, support, and Admin diagnostics retain their current depth.

**Tech Stack:** TypeScript, Node.js, Vitest, existing contract intelligence, scoring matrix, DeepCheck reports, and Telegram bot formatter.

---

## Execution prerequisite and version contract

Execute this plan on the same branch after Tasks 1–8 of `2026-07-11-first-hop-blacklist-scoring.md`. The first-hop facts, independent-policy resolver, and persisted legacy guard are inputs to this formatter; do not substitute old snapshot reason strings. Both direct-blacklist and Verify20 changes belong to the same unreleased `scoring-signal-matrix-v2`. Do not deploy between the two plans. If v2 has already been released independently, bump Verify20 to the next policy version instead of changing v2 semantics in place.

## Copy and decision invariants

- The normal result is deterministic; no LLM writes or rewrites the final decision.
- Lead with the action and risk emoji. Keep the risk emoji in every scored result.
- Explain what actually happened, where this pattern occurs, and what the user should do.
- Prefer concrete address roles, amounts, directions, service names, and coverage. Never expose raw internal reason strings or method names without their meaning.
- Use plain Russian for a crypto user who may not know `transferFrom`, `boundary`, `drain episode`, or contract internals.
- A Verify20 exact fingerprint is a strong drainer-pattern signal and sets a `DECLINE` floor of `85`; it does not by itself prove that this wallet stole a specific transfer.
- Exact approval-drain evidence remains stronger and keeps score `95`.
- A single similar selector, a name match, or an untrusted AI label is not Verify20.
- Maximum normal output: canonical header plus three short parts; target body length is `200–500` characters. No duplicated caveats.

### Task 1: Implement the exact Verify20 fingerprint matcher

**Files:**
- Create: `src/forensics/verify20Fingerprint.ts`
- Test: `tests/forensics/verify20Fingerprint.test.ts`

- [ ] **Step 1: Write failing matcher tests**

Require the exact selector set `5082dd12`, `fc61dd23`, `ea4418d9`, and `f2fde38b` from normalized `methodMap`/`topMethods`. Assert order/case/prefix independence, no match when one selector is missing, and no match when a trusted service label is present.

```ts
expect(detectVerify20Fingerprint(profile)).toMatchObject({
  matched: true,
  selectors: ["5082dd12", "fc61dd23", "ea4418d9", "f2fde38b"],
});
expect(detectVerify20Fingerprint({ ...profile, serviceLabel: "Trusted Service" })).toMatchObject({
  matched: false,
  blockedByTrustedService: true,
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npm test -- tests/forensics/verify20Fingerprint.test.ts`

Expected: FAIL because the matcher does not exist.

- [ ] **Step 3: Implement the pure matcher**

Return a typed `Verify20FingerprintResult` with matched selectors and trusted-service guard. Do not classify from contract name, AI verdict text, one method, or approximate similarity.

- [ ] **Step 4: Run the focused test**

Run: `npm test -- tests/forensics/verify20Fingerprint.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/forensics/verify20Fingerprint.ts tests/forensics/verify20Fingerprint.test.ts
git commit -m "feat: detect exact Verify20 fingerprint"
```

### Task 2: Integrate Verify20 into contract evaluation and scoring

**Files:**
- Modify: `src/types.ts`
- Modify: `src/check/smartContractCheck.ts`
- Modify: `src/risk/scoringSignalMatrixInputs.ts`
- Modify: `src/risk/scoringSignalMatrix.ts`
- Modify: `src/risk/unifiedWalletRisk.ts`
- Modify: `src/risk/finalDisposition.ts`
- Modify: `src/bot/createBot.ts`
- Modify: `src/admin/adminServer.ts`
- Test: `tests/check/smartContractCheck.test.ts`
- Test: `tests/risk/scoringSignalMatrixInputs.test.ts`
- Test: `tests/risk/scoringSignalMatrix.test.ts`
- Test: `tests/risk/unifiedWalletRisk.test.ts`
- Test: `tests/risk/finalDisposition.test.ts`
- Test: `tests/bot/createBot.test.ts`
- Test: `tests/admin/adminServer.test.ts`

- [ ] **Step 1: Write failing standalone contract tests**

Assert exact Verify20 plus no trusted service yields `DECLINE` and risk at least `85`. Assert the explanation means: “В контракте найден полный шаблон Verify20, который часто используют дрейнеры.” Assert it does not say a specific theft is proven.

- [ ] **Step 2: Write failing precedence tests**

Assert exact approval-drain evidence remains `95` and is not lowered/replaced by Verify20. Assert partial selector sets and trusted services keep their prior evaluation.

- [ ] **Step 3: Write failing matrix tests**

Map the typed fingerprint only when the checked subject is that contract, using a dedicated deterministic contract-pattern candidate with `{ kind: "pattern", decisionEligibility: "can_decline", coverageDependency: "none" }`. Interaction with a Verify20 contract does not automatically make a wallet a drainer. Do not map the fingerprint to `exact_hard`, because it proves the template, not a specific stolen transfer.

- [ ] **Step 4: Write failing unified and delayed-reader data-flow tests**

Assert `WalletMatrixCandidateInput` and `UnifiedWalletRiskInput` receive the completed typed report directly. Do not let the test pass through `mergeContractSafetyContext()`, which deliberately caps generic contract context at `59`, or through a fake fast exact-hard reason.

Assert the existing `job.progressJson.contractSafetyAnalysis` payload is extracted for every delayed reader: Deep-first completion, Where-first completion, `/check_status`, and Admin unified-risk reconstruction. Every surface must pass the same `SmartContractCheckReport` into unified scoring.

- [ ] **Step 5: Run tests and confirm failure**

Run: `npm test -- tests/check/smartContractCheck.test.ts tests/risk/scoringSignalMatrixInputs.test.ts tests/risk/scoringSignalMatrix.test.ts tests/risk/unifiedWalletRisk.test.ts tests/risk/finalDisposition.test.ts tests/bot/createBot.test.ts tests/admin/adminServer.test.ts`

Expected: FAIL on missing fingerprint fields, floor, and candidate.

- [ ] **Step 6: Wire the typed result once**

Persist the matcher result in `SmartContractCheckReport`; add `smartContractReport?: SmartContractCheckReport | null` to the wallet matrix/unified inputs; and extract the existing progress payload in Bot/Admin delayed readers. Reuse the typed result for standalone and unified scoring. Add the smallest dedicated matrix row/modifier needed; do not parse human-readable explanations back into scoring. Extend the independent-policy resolver narrowly for this exact direct-contract fingerprint and assert it remains `DECLINE` when unrelated coverage is invalid.

- [ ] **Step 7: Run the focused tests**

Run: `npm test -- tests/check/smartContractCheck.test.ts tests/risk/scoringSignalMatrixInputs.test.ts tests/risk/scoringSignalMatrix.test.ts tests/risk/unifiedWalletRisk.test.ts tests/risk/finalDisposition.test.ts tests/bot/createBot.test.ts tests/admin/adminServer.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/check/smartContractCheck.ts src/risk/scoringSignalMatrixInputs.ts src/risk/scoringSignalMatrix.ts src/risk/unifiedWalletRisk.ts src/risk/finalDisposition.ts src/bot/createBot.ts src/admin/adminServer.ts tests/check/smartContractCheck.test.ts tests/risk/scoringSignalMatrixInputs.test.ts tests/risk/scoringSignalMatrix.test.ts tests/risk/unifiedWalletRisk.test.ts tests/risk/finalDisposition.test.ts tests/bot/createBot.test.ts tests/admin/adminServer.test.ts
git commit -m "feat: score Verify20 contract patterns"
```

### Task 3: Define a compact deterministic narrative contract

**Files:**
- Create: `src/bot/walletNarrativeSummary.ts`
- Test: `tests/bot/walletNarrativeSummary.test.ts`

- [ ] **Step 1: Write failing formatter contract tests**

Define `WalletNarrativeCase` with `locale: "ru" | "en"` and test exact shape for `ACCEPTABLE`, `REVIEW`, `DECLINE`, and `NO_FINAL_DECISION` in both supported locales. Scored headers must retain `🟢`, `🟡`, `🟠`, or `🔴`, `n/100`, the score band, and the canonical action; `NO_FINAL_DECISION` uses a neutral marker and no invented score. Score band never replaces the canonical decision.

```ts
expect(formatWalletNarrativeSummary(caseData)).toBe([
  "🔴 85/100 — критический риск. Операцию не проводить.",
  "",
  "Что нашли",
  "…",
  "",
  "Вывод",
  "…",
].join("\n"));
```

- [ ] **Step 2: Add strict length and duplication tests**

Assert at most three parts after the header, a `200–500` character target for the normal body, bounded fact count, no duplicate sentences, no empty headings, and absence of `Почему`, `Что это может значить`, `Что важно учесть`, `drain episode`, `anchor coverage`, and raw reason codes.

- [ ] **Step 3: Run the focused test and confirm failure**

Run: `npm test -- tests/bot/walletNarrativeSummary.test.ts`

Expected: FAIL because the narrative module does not exist.

- [ ] **Step 4: Implement pure selection and formatting functions**

Implement `buildWalletNarrativeCase`, `selectNarrativeFacts`, and `formatWalletNarrativeSummary`. Keep selection deterministic: active blacklist of the subject; material direct blacklisted counterparty; confirmed approval-drain role; sanctioned/bad source; exact Verify20 subject; material bridge/DEX/risky-service route; risky counterparty; clean CEX source; collector role; GasFree fee; then coverage limitation. Render only facts present in the case.

- [ ] **Step 5: Run the focused test**

Run: `npm test -- tests/bot/walletNarrativeSummary.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/bot/walletNarrativeSummary.ts tests/bot/walletNarrativeSummary.test.ts
git commit -m "feat: format compact wallet conclusions"
```

### Task 4: Translate every supported signal into plain-language facts

**Files:**
- Modify: `src/bot/walletNarrativeSummary.ts`
- Modify: `tests/bot/walletNarrativeSummary.test.ts`

- [ ] **Step 1: Add a table-driven test for the signal catalogue**

Cover at least in Russian and English: address in active USDT blacklist; USDT frozen/blocked; exact approval drain with victim/spender/first-receiver/route-linked direction; Verify20 subject, approval-only, and interaction-only roles; direct blacklisted counterparty inbound/outbound with all four temporal relations; sanctioned service source; one-off and repeated bridge routes; CEX/service boundary; collector/transit wallet; GasFree principal plus fee; dominant counterparty behavior; exact/partial/unavailable coverage; and no material risk facts.

- [ ] **Step 2: Encode approved meanings, not generic disclaimers**

Examples the tests must enforce:

```text
Адрес находится в чёрном списке USDT: переводы токена заблокированы.
Проверяемый адрес — жертва списания через вредоносное разрешение.
В контракте найден полный шаблон Verify20, который часто используют дрейнеры.
83% проверенной суммы пришло через мост. Это мог быть обычный обмен между сетями, но мосты также используют, чтобы скрыть происхождение денег.
Кошелёк собирает переводы и выводит их на Bybit. Это похоже на транзитный или ликвидный кошелёк.
```

For a sanctioned source, state the policy consequence directly; do not discuss theft. Apply the HTX/Huobi designation only to transfers on or after `2026-05-26` and only preserve `DECLINE` for inbound transfers linked to selected Where/Incoming provenance; historical or outbound context follows its existing policy. Read internal labels only from typed `FirstHopLabelFact.labelCode`. Assert a GasFree fee-only provider never triggers direct policy, while a GasFree account/contract transferring principal is evaluated normally. For a normal collector, describe the role without presuming dirty funds. For missing coverage, say exactly what was not traced and why when the structured data contains the reason.

- [ ] **Step 3: Add direction and subject-role safeguards**

Assert the narrative distinguishes victim, recipient, sender to a risky counterparty, and receiver from a risky counterparty. Remove redundant phrases such as “а не получатель списанных денег.” Never use a counterparty’s blacklist state as if the subject itself were blacklisted.

- [ ] **Step 4: Run the catalogue test and confirm failure**

Run: `npm test -- tests/bot/walletNarrativeSummary.test.ts`

Expected: FAIL until all mappings and safeguards are implemented.

- [ ] **Step 5: Implement the minimal fact renderers**

Use `FirstHopBlacklistFact` as the sole source of direction, principal amount/share/count, evidence authority, active status, temporal relation, and coverage. Join its `transferTxHashes` to `directCounterpartyInteractionProfiles[].transfers` only for per-transfer amount/time detail; never replace the typed fact with gross profile totals. Read GasFree fee totals only from `economicRole: "service_fee"` plus `economicProtocol: "tron_gasfree"`.

- [ ] **Step 6: Run the focused test**

Run: `npm test -- tests/bot/walletNarrativeSummary.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/bot/walletNarrativeSummary.ts tests/bot/walletNarrativeSummary.test.ts
git commit -m "feat: explain wallet evidence in plain Russian"
```

### Task 5: Wire the compact narrative into normal Telegram finals

**Files:**
- Modify: `src/bot/createBot.ts`
- Test: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Write failing bot output tests**

Exercise `formatUnifiedAddressFinalReport()` through the public bot flow. Assert it uses the compact formatter for normal final and `NO_FINAL`; keeps the risk emoji; does not emit the old four generic sections; and gives the concrete dominant reason.

- [ ] **Step 2: Protect diagnostic modes**

Add regression assertions that detailed output still uses the existing full diagnostics, while support/Admin payloads remain unchanged. The user-facing compaction must not remove evidence needed for investigation.

- [ ] **Step 3: Protect legacy stored reports**

Reuse the exact `SCORING_SIGNAL_MATRIX_POLICY_VERSION` guard implemented by sibling Plan Task 8. Assert reports without that persisted marker are formatted from their stored decision and score rather than rescored. Their narrative may summarize stored facts but must not invent new v2 policy conclusions.

- [ ] **Step 4: Run the bot test and confirm failure**

Run: `npm test -- tests/bot/createBot.test.ts`

Expected: FAIL because normal output still uses the generic formatter.

- [ ] **Step 5: Replace only the normal final formatter**

Build one `WalletNarrativeCase` from the structured bundle `{ unifiedRisk, whereReport, fastReport, deepReport, smartContractReport }` and pass it to the compact formatter. `UnifiedWalletRiskResult` alone is insufficient because it does not contain first-hop facts, transfer timestamps, GasFree fee rows, detailed coverage, or role profiles. Leave `buildRiskExplanationSummary` available for detailed/support modes. Remove ambiguous normal-output phrases such as “USDT blacklist не найден” when only the subject was checked or coverage is incomplete.

- [ ] **Step 6: Run bot tests**

Run: `npm test -- tests/bot/createBot.test.ts tests/bot/walletNarrativeSummary.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/bot/createBot.ts tests/bot/createBot.test.ts
git commit -m "feat: use compact Telegram wallet narrative"
```

### Task 6: Add the TGyt end-to-end narrative regression

**Files:**
- Create: `tests/fixtures/forensics/directBlacklistCases.ts`
- Modify: `tests/bot/walletNarrativeSummary.test.ts`
- Modify: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Create the exact fixture**

Use subject `TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD`, counterparty `TWGCtirDx8LJYpUnBM13hPcUPAoQqyTdTm`, principal transfers `15 USDT` at `09:44:33Z` and `1,176,302 USDT` at `09:56:18Z`, digit-only total raw `"1176317000000"`, exact share `100%`, blacklist activation at `12:49:03Z`, event tx `2413649b2f5b898b156b533e60f0066e727a0a4b96d7384d7ba37cdb1c005a5c`, relation `became_active_after`, subject not blacklisted, and `3 USDT` GasFree fee.

- [ ] **Step 2: Write the expected user-facing conclusion**

The exact copy may be tuned for grammar, but tests must require: `🔴 90/100`, canonical `DECLINE`, `1,176,317 USDT` principal with the named counterparty, counterparty currently USDT-blacklisted, exact `2 h 52 m 45 s` interval tied specifically to the `1,176,302 USDT` transfer, separate `3 USDT` technical GasFree fee, and an explicit statement that the checked subject itself is not blacklisted.

- [ ] **Step 3: Run the regression and confirm failure**

Run: `npm test -- tests/bot/walletNarrativeSummary.test.ts tests/bot/createBot.test.ts`

Expected: FAIL until the complete structured case renders correctly.

- [ ] **Step 4: Make the smallest formatter adjustments**

Keep the normal result within three parts after the header. Prefer one compact sentence combining amount, counterparty status, and chronology; include the fee only when it helps explain the GasFree structure.

- [ ] **Step 5: Run the regression**

Run: `npm test -- tests/bot/walletNarrativeSummary.test.ts tests/bot/createBot.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures/forensics/directBlacklistCases.ts tests/bot/walletNarrativeSummary.test.ts tests/bot/createBot.test.ts src/bot/walletNarrativeSummary.ts
git commit -m "test: lock TGyt blacklist narrative"
```

### Task 7: Update product truth and verify all affected paths

**Files:**
- Modify: `docs/knowledge/07-risk-scoring-matrix.md`
- Modify: `docs/knowledge/08-admin-and-bot-ux.md`
- Modify: `docs/knowledge/09-current-decisions.md`
- Modify: `docs/knowledge/13-agent-observations.md`

- [ ] **Step 1: Document the shipped narrative contract**

Record the three-block limit, deterministic authorship, emoji preservation, plain-language signal meanings, role/direction rules, Verify20 fingerprint/floor, exact-drain precedence, and the separation between compact user output and detailed/Admin evidence.

- [ ] **Step 2: Record recurring copy corrections**

Add concise observations: do not discuss theft for sanctions; do not label collector behavior as dirty; do not expose method names without meaning; do not say the subject is blacklisted when only a counterparty is; explain what coverage covers and why the remainder was not traced.

- [ ] **Step 3: Run focused suites**

Run:

```bash
npm test -- tests/forensics/verify20Fingerprint.test.ts tests/check/smartContractCheck.test.ts tests/risk/scoringSignalMatrixInputs.test.ts tests/risk/scoringSignalMatrix.test.ts tests/bot/walletNarrativeSummary.test.ts tests/bot/createBot.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run complete checks**

Run: `npm test`

Expected: all suites pass with zero failures.

Run: `npm run typecheck`

Expected: exit code `0`.

- [ ] **Step 5: Check the diff**

Run: `git diff --check`

Expected: no output.

- [ ] **Step 6: Commit docs**

```bash
git add docs/knowledge/07-risk-scoring-matrix.md docs/knowledge/08-admin-and-bot-ux.md docs/knowledge/09-current-decisions.md docs/knowledge/13-agent-observations.md
git commit -m "docs: record wallet narrative and Verify20 policy"
```

## Completion criteria

- Normal Telegram output is short, individualized, deterministic, and keeps the risk emoji.
- Each supported signal says what happened, what it usually means, and the appropriate action without generic filler.
- Verify20 requires the exact four-selector fingerprint and no trusted service label.
- Verify20 yields `DECLINE` with floor `85`, while exact approval-drain evidence remains `95`.
- TGyt output separates `1,176,317 USDT` principal from the `3 USDT` GasFree fee and gets subject/counterparty chronology right.
- Detailed/support/Admin evidence remains available and full tests/typecheck pass.
