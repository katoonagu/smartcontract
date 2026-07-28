# Customer-Friendly Unified Wallet Telegram Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the final Unified wallet report shown in Telegram with the approved customer-friendly V2 copy while preserving scoring, evidence, forensic completeness, and immutable historical V1 presentations.

**Architecture:** Keep `UnifiedWalletDossierV1` and its canonical raw values unchanged. Add presentation-only formatters and customer mappings, bind new presentations to renderer/template V2 inside the existing manifest schema, and retain V1 as a readable historical artifact version. The renderer produces one deterministic HTML message plus the existing completeness receipt; compaction may shorten explanatory detail but never the decision, score, action, critical risk, or customer conclusion.

**Tech Stack:** TypeScript 5.7, Node.js standard library (`Intl`, `BigInt`), Vitest, grammY Telegram HTML, existing canonical hashing and presentation artifact contracts.

---

## Scope and safety boundaries

- Change only the final Unified wallet report. Do not redesign progress, cancellation, monitoring, Admin, or other bot messages.
- Do not change score calculation, decisions, traversal, evidence selection, storage schema, report schema, or APIs.
- Do not add a dependency. Amount and date formatting use `BigInt` and `Intl`.
- Do not mutate the locked V1 golden artifacts under `tests/fixtures/unified-golden/`.
- A manual resend must not rerender the stored presentation: its warning wrapper keeps the original HTML byte-for-byte and retains the original V1/V2 manifest version.
- A newly requested presentation, including one built from reusable completed analysis, uses V2.
- Treat every existing unrelated worktree change as user-owned; stage explicit paths only.

## File map

| File | Responsibility |
|---|---|
| `src/unifiedCheck/customerPresentationFormat.ts` | Exact raw-USDT, UTC date, count, and percentage display helpers |
| `src/unifiedCheck/presentation.ts` | V1/V2 manifest compatibility, customer copy mappings, V2 layout, deterministic compaction |
| `tests/unified-check/customerPresentationFormat.test.ts` | Boundary tests for money, dates, counts, and locale |
| `tests/unified-check/presentation.test.ts` | V2 message contract, mappings, errors, completeness, length, resend behavior |
| `tests/unified-check/presentation.golden.test.ts` | Preserve V1 archive bytes and exercise the same adjudicated dossiers through V2 semantic assertions |
| `tests/unified-check/delivery.test.ts` | Historical V1 delivery compatibility and current V2 creation |
| `docs/knowledge/08-admin-and-bot-ux.md` | Current final-message UX contract |
| `docs/knowledge/09-current-decisions.md` | Renderer/template V2 decision and historical compatibility |
| `docs/knowledge/13-agent-observations.md` | Short reusable lesson only if it can be updated without overwriting existing user edits |
| `docs/superpowers/specs/2026-07-28-unified-wallet-telegram-customer-copy-design.md` | Mark implementation verified only after all checks pass |

## Task 1: Add presentation-only customer formatters

**Files:**

- Create: `src/unifiedCheck/customerPresentationFormat.ts`
- Create: `tests/unified-check/customerPresentationFormat.test.ts`

- [ ] **Step 1: Write failing amount-format tests**

Cover canonical raw micro-USDT strings without converting them to `number`:

```ts
expect(formatCustomerUsdtRaw("0", "ru")).toBe("0 USDT");
expect(formatCustomerUsdtRaw("1", "ru")).toBe("меньше 0,01 USDT");
expect(formatCustomerUsdtRaw("9999", "ru")).toBe("меньше 0,01 USDT");
expect(formatCustomerUsdtRaw("10000", "ru")).toBe("0,01 USDT");
expect(formatCustomerUsdtRaw("10000000", "ru")).toBe("10 USDT");
expect(formatCustomerUsdtRaw("10000001", "ru")).toBe("10 USDT");
expect(formatCustomerUsdtRaw("123456789", "ru")).toBe("123,46 USDT");
expect(formatCustomerUsdtRaw("9007199254740993000000", "ru"))
  .toBe("9 007 199 254 740 993 USDT");
```

Also assert rejection of negative, decimal, empty, and non-numeric raw values. Add equivalent English threshold, decimal-separator, and percentage cases for both locales.

- [ ] **Step 2: Write failing UTC-date and Russian-plural tests**

```ts
expect(formatCustomerUtcDate("2026-07-20T13:53:09.000Z", "ru"))
  .toBe("20 июля 2026, 13:53 UTC");
expect(formatCustomerTransferCount(1, "ru")).toBe("1 перевод");
expect(formatCustomerTransferCount(2, "ru")).toBe("2 перевода");
expect(formatCustomerTransferCount(5, "ru")).toBe("5 переводов");
expect(formatCustomerTransferCount(11, "ru")).toBe("11 переводов");
expect(formatCustomerTransferCount(21, "ru")).toBe("21 перевод");
expect(formatCustomerTransferCount(22, "ru")).toBe("22 перевода");
expect(formatCustomerUtcDate(null, "ru")).toBe("не удалось определить");
```

Use a fixed UTC formatter so tests do not depend on the host timezone. Run the same date assertion under two different `TZ` values. Reject invalid non-null timestamps and invalid counts at this trust boundary. Add English date and missing-value assertions.

- [ ] **Step 3: Run the new test and observe the expected failure**

Run:

```powershell
npx vitest run --configLoader bundle --no-file-parallelism tests/unified-check/customerPresentationFormat.test.ts
```

Expected: FAIL because the module and exports do not exist.

- [ ] **Step 4: Implement the minimum helpers**

Export:

```ts
export function formatCustomerUsdtRaw(raw: string, locale: "ru" | "en"): string;
export function formatCustomerUtcDate(iso: string | null, locale: "ru" | "en"): string;
export function formatCustomerTransferCount(count: number, locale: "ru" | "en"): string;
export function formatCustomerPercent(sharePpm: number, locale: "ru" | "en"): string;
```

Implementation constraints:

- validate `/^\d+$/`, then parse with `BigInt`;
- work in millionths and round display values to at most two decimals using integer arithmetic;
- show a non-zero value below `0.01 USDT` as the approved localized threshold;
- strip insignificant zeros, so `10.000001` displays as `10 USDT`;
- use `Intl.NumberFormat` only after splitting values into safe integer groups, or pass `BigInt` directly;
- use `Intl.DateTimeFormat` with `timeZone: "UTC"`, append `UTC` explicitly, and localize a permitted `null` value;
- keep canonical raw values outside this module untouched.

- [ ] **Step 5: Run focused tests and typecheck**

```powershell
npx vitest run --configLoader bundle --no-file-parallelism tests/unified-check/customerPresentationFormat.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the formatter slice**

```powershell
git add -- src/unifiedCheck/customerPresentationFormat.ts tests/unified-check/customerPresentationFormat.test.ts
git commit -m "feat(unified): add customer presentation formatters"
```

## Task 2: Version new presentations as V2 without breaking V1 artifacts

**Files:**

- Modify: `src/unifiedCheck/presentation.ts:15-30,930-975`
- Modify: `tests/unified-check/presentation.test.ts`
- Modify: `tests/unified-check/delivery.test.ts:1-30`

- [ ] **Step 1: Lock historical and current version behavior in failing tests**

Add assertions that:

1. `buildPresentationManifest(report, locale)` returns schema `presentation-manifest-v1` with renderer `unified-telegram-renderer-v2` and template `unified-wallet-dossier-template-v2`.
2. A stored V1 manifest in `delivery.test.ts` still parses/delivers and is not rewritten.
3. A manual resend retains the original manifest version and embeds the original HTML byte-for-byte inside the existing warning wrapper rather than rendering V2; its wrapper hash remains a distinct audited operation.
4. A new request that reuses a completed report builds a new V2 presentation.
5. A mixed renderer/template pair is rejected.

- [ ] **Step 2: Run the focused tests and confirm they fail on current V1 creation**

```powershell
npx vitest run --configLoader bundle --no-file-parallelism tests/unified-check/presentation.test.ts tests/unified-check/delivery.test.ts
```

Expected: new-version assertions FAIL; existing historical assertions remain green.

- [ ] **Step 3: Add narrow manifest unions and current constants**

Keep the manifest schema at V1 and widen only its two presentation version fields:

```ts
type UnifiedRendererVersion =
  | "unified-telegram-renderer-v1"
  | "unified-telegram-renderer-v2";
type UnifiedTemplateVersion =
  | "unified-wallet-dossier-template-v1"
  | "unified-wallet-dossier-template-v2";

const CURRENT_RENDERER_VERSION = "unified-telegram-renderer-v2" as const;
const CURRENT_TEMPLATE_VERSION = "unified-wallet-dossier-template-v2" as const;
```

`buildPresentationManifest` always binds the current pair. Persisted-result typing/validation accepts the exact V1 pair or exact V2 pair, never a cross-pair. `renderUnifiedWalletPresentation` creates only V2. `ensurePresentationForRequest` reuses only an exact current V2 presentation for the same report/locale; a historical V1 presentation is not treated as the expected presentation for a new request. Do not add a manifest V2 or database migration.

- [ ] **Step 4: Re-run focused tests and typecheck**

```powershell
npx vitest run --configLoader bundle --no-file-parallelism tests/unified-check/presentation.test.ts tests/unified-check/delivery.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the versioning slice**

```powershell
git add -- src/unifiedCheck/presentation.ts tests/unified-check/presentation.test.ts tests/unified-check/delivery.test.ts
git commit -m "feat(unified): version customer telegram presentation"
```

## Task 3: Render the approved customer message from the existing dossier

**Files:**

- Modify: `src/unifiedCheck/presentation.ts:250-745`
- Modify: `tests/unified-check/presentation.test.ts`

- [ ] **Step 1: Add a representative TPCP dossier fixture**

Build it from the existing `report()` helper rather than adding a production fixture. It must contain:

- subject `TPCP7B17wCeybFDvsnU4AWqQotT46J5nZV`;
- source `TWkvffFDMsqbmTLkMHMABmw452Hyq98cdn`;
- destination `TJZxcWCDxf5zgYMA1snogPWxyR9MeXDwoq`;
- score `35`, decision `REVIEW`;
- balance raw `1`, inbound raw `10000001`, outgoing raw `10000000`;
- created/first activity `2026-07-20T13:53:09.000Z` and last activity `2026-07-20T13:53:12.000Z`;
- `history_exhausted_to_account_creation`, `unknown_source`, `direct_activity_observed`, and `rapid_forwarding` facts;
- complete backward and forward coverage with unknown boundaries;
- no labeled services and no contract risks.

- [ ] **Step 2: Add failing customer-contract assertions**

Assert the message contains:

```text
🧾 Проверка кошелька
🟡 35/100 — нужна проверка
Что это значит для сделки
Если вы отправляете деньги
Если вы принимаете деньги
меньше 0,01 USDT
20 июля 2026, 13:53 UTC
Почти вся полученная сумма была переведена дальше
Размеченных сервисных связей не найдено
Значимых контрактных рисков и опасных разрешений не найдено
```

Assert it does not contain internal vocabulary or raw formatting:

```text
current_balance_attribution
latest_five_principal_inbound_events
all_direct_outgoing_to_snapshot
collapsed facts
evidence facts
risk/context classes
history_exhausted_to_account_creation
unknown_source
direct_activity_observed
rapid_forwarding
recipient
sender
subject
transit_sender
selection
trace
identified
untraced
2026-07-20T13:53:09.000Z
0.000001 / 0.000001
```

Also deny unintended English prose in the Russian rendering while allowing `USDT`, `TRON`, and `UTC`.

Compare the normalized complete RU body against the approved hierarchy in the design spec, not only isolated fragments. Render the same dossier in English and assert the corresponding semantic blocks, English amount/date formats, and absence of Russian fragments.

- [ ] **Step 3: Add explicit customer mapping tables**

Keep mappings close to the renderer and exhaustive for all currently decisive report codes. Required behavior mappings:

- `history_exhausted_to_account_creation` → history was checked back to wallet creation;
- `unknown_source` → original source of funds could not be determined;
- `rapid_forwarding` → funds were forwarded soon after receipt;
- `direct_activity_observed` → omit as a tautology.

Map roles into natural sentences rather than labels. Existing score-driver and conclusion codes need RU and EN customer text. A new non-decisive behavior code uses one neutral localized fallback. An unknown decisive score driver or conclusion must throw a stable presentation-contract error such as `unified_customer_copy_decisive_code_unmapped`.

- [ ] **Step 4: Add decision-specific two-direction guidance**

For each `ACCEPTABLE`, `REVIEW`, and `DECLINE` decision, produce concise guidance for:

- sending funds: whether to proceed, use a test transfer, or stop;
- receiving funds: what to verify about counterparty/source before treating the transfer as safe.

Facts may make the wording more specific, but must not change the canonical score or decision. Do not state that the wallet is certainly safe, fraudulent, or service-owned unless a canonical decisive fact says so.

- [ ] **Step 5: Replace the renderer body with the approved hierarchy**

Render one HTML message in this order:

1. title and the full checked wallet address, copyable and safely escaped;
2. primary score and decision;
3. plain-language reason;
4. `Что это значит для сделки` with sending and receiving guidance;
5. balance formation and latest meaningful inbound transfers;
6. outgoing movement;
7. labeled services/boundaries;
8. contracts and permissions;
9. grouped behavior conclusions;
10. wallet profile;
11. human coverage statement;
12. conclusion and snapshot block.

Use the new formatters. Counterparty addresses use the existing shortened clickable `telegramAddressRef`/`renderTelegramAddressRef`; the checked wallet stays full near the title. Preserve HTML escaping and TronScan link safety. Hide empty technical sections behind approved one-line customer statements.

- [ ] **Step 6: Keep receipt construction canonical**

Do not derive the completeness receipt from visible customer prose. It must still include every canonical fact ID, exact raw denominator/total, section aggregate count, risk class, and report hash. Assert the receipt and hashes remain deterministic across two renders of identical input.

Add a determinism case that permutes equivalent input row/fact order and runs with different host `TZ` values. The presentation text, receipt body hash, and presentation hash must stay identical.

- [ ] **Step 7: Run focused tests**

```powershell
npx vitest run --configLoader bundle --no-file-parallelism tests/unified-check/customerPresentationFormat.test.ts tests/unified-check/presentation.test.ts
npm run typecheck
```

Expected: PASS and rendered text remains within Telegram HTML rules.

- [ ] **Step 8: Commit the renderer slice**

```powershell
git add -- src/unifiedCheck/presentation.ts tests/unified-check/presentation.test.ts
git commit -m "feat(unified): render customer friendly wallet report"
```

## Task 4: Lock mappings, coverage wording, compaction, and golden compatibility

**Files:**

- Modify: `tests/unified-check/presentation.test.ts`
- Modify: `tests/unified-check/presentation.golden.test.ts`
- Modify only if a small production correction is needed: `src/unifiedCheck/presentation.ts`

- [ ] **Step 1: Add table-driven mapping tests**

Enumerate every currently supported score driver, conclusion, behavior code, decision, and locale. Verify:

- every decisive code has explicit RU and EN copy;
- `direct_activity_observed` is omitted;
- unknown non-decisive behavior gets neutral localized wording;
- unknown decisive code fails closed with the stable contract error;
- a Russian message has no accidental English internal term.

- [ ] **Step 2: Add semantic coverage tests**

Build separate dossiers for:

1. complete trace and identified endpoints;
2. complete trace with unknown source/destination boundary;
3. incomplete/untraced history;
4. mixed forward/backward coverage.

Assert natural customer conclusions, not raw percentages or `selection`, `trace`, `identified`, `unknown`, and `untraced` keys. Percentages may appear only when they materially explain the conclusion.

- [ ] **Step 3: Add deterministic Telegram compaction tests**

Construct an over-limit report with many counterparties and repeated behavior facts. Assert:

- final HTML is at most `TELEGRAM_MESSAGE_LIMIT`;
- HTML tags remain balanced and addresses remain escaped/clickable;
- compaction order is deterministic;
- score, decision, sending advice, receiving advice, decisive reason, material hard evidence, material coverage limitation, conclusion, and snapshot survive;
- repeated addresses/details collapse before essential blocks;
- every removed display detail remains represented in the completeness receipt.

If even the essential message cannot fit, fail with the existing stable presentation-length error; do not silently drop the decision contract.

- [ ] **Step 4: Preserve locked V1 goldens and add V2 semantic use of the same cases**

Keep the current assertion that archived `exactHtml` equals the stored V1 artifact. Add a second path that renders the same adjudicated report with a current V2 manifest and checks the semantic customer contract (decision, critical facts, both locales, locale purity, no internal codes, Telegram length). Never rewrite the locked fixture JSON merely because the copy changed.

- [ ] **Step 5: Run all Unified presentation/delivery tests**

```powershell
npx vitest run --configLoader bundle --no-file-parallelism tests/unified-check/customerPresentationFormat.test.ts tests/unified-check/presentation.test.ts tests/unified-check/presentation.golden.test.ts tests/unified-check/delivery.test.ts tests/unified-check/comparator.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit contract coverage**

```powershell
git add -- src/unifiedCheck/presentation.ts tests/unified-check/presentation.test.ts tests/unified-check/presentation.golden.test.ts
git commit -m "test(unified): lock customer telegram presentation"
```

## Task 5: Update current product knowledge after behavior is verified

**Files:**

- Modify: `docs/knowledge/08-admin-and-bot-ux.md`
- Modify: `docs/knowledge/09-current-decisions.md`
- Modify conditionally: `docs/knowledge/13-agent-observations.md`
- Modify: `docs/superpowers/specs/2026-07-28-unified-wallet-telegram-customer-copy-design.md`

- [ ] **Step 1: Document the final-message UX contract**

In `08-admin-and-bot-ux.md`, record the V2 block order, sending/receiving guidance, localized formatting, hidden internal vocabulary, and essential-content compaction guarantee. Keep Admin/audit receipts explicitly separate from customer prose.

- [ ] **Step 2: Record the versioning decision**

In `09-current-decisions.md`, record:

- manifest schema remains V1;
- current renderer/template are V2;
- new presentations use V2;
- stored V1 artifacts remain immutable and deliverable;
- manual resend preserves the stored artifact/version;
- scoring and evidence semantics did not change.

- [ ] **Step 3: Record the reusable correction carefully**

If `13-agent-observations.md` has no overlapping user edits, add one short note: customer Telegram copy must never expose canonical scope/code/role names; exact detail belongs in the receipt. If the file is already modified by the user, do not stage or overwrite it; mention the deferred note in the final handoff.

- [ ] **Step 4: Mark the design implemented only after tests pass**

Update the design status/implementation note only after Tasks 1-4 are green. Then run:

```powershell
git diff --check -- docs/knowledge/08-admin-and-bot-ux.md docs/knowledge/09-current-decisions.md docs/superpowers/specs/2026-07-28-unified-wallet-telegram-customer-copy-design.md
git status --short
```

- [ ] **Step 5: Commit only non-conflicting documentation**

```powershell
git add -- docs/knowledge/08-admin-and-bot-ux.md docs/knowledge/09-current-decisions.md docs/superpowers/specs/2026-07-28-unified-wallet-telegram-customer-copy-design.md
git commit -m "docs(bot): record unified customer report v2"
```

If the observations file was safely updated, stage it explicitly in the same commit; otherwise leave it untouched.

## Task 6: Full verification and controlled bot rollout

**Files:**

- No planned source changes; fix only failures caused by this implementation.

- [ ] **Step 1: Run repository verification**

```powershell
npm run typecheck
npm test
npm run schema:verify
git diff --check
```

Expected: all commands PASS. `schema:verify` confirms no schema migration was introduced.

- [ ] **Step 2: Audit scope and repository state**

```powershell
git status --short
git log --oneline -8
git diff HEAD~5..HEAD -- src/unifiedCheck/presentation.ts src/unifiedCheck/customerPresentationFormat.ts tests/unified-check docs/knowledge/08-admin-and-bot-ux.md docs/knowledge/09-current-decisions.md
```

Confirm no scoring, traversal, database, API, unrelated output, or user-owned dirty file entered the commits.

- [ ] **Step 3: Restart the existing bot with the verified HEAD**

Use the repository's current documented Windows bot restart procedure; do not invent another service wrapper. Before stopping anything, identify the exact bot process and working directory. Start it hidden, with the current required environment (including `FORENSIC_WHERE_WORKER_CONCURRENCY=1` where the existing deployment requires it), and capture stdout/stderr in the existing log location.

Record the deployed commit dynamically:

```powershell
git rev-parse HEAD
```

Do not hard-code a SHA in the runtime procedure.

- [ ] **Step 4: Perform live Telegram acceptance**

Request a new Unified check for the representative wallet and verify:

- an immediate progress acknowledgement still appears;
- the final message uses V2 according to the persisted presentation metadata;
- the approved score/reason/advice hierarchy is visible;
- amounts and dates are readable;
- internal English codes/roles/scopes are absent;
- Telegram HTML renders correctly and the address link opens TronScan;
- a historical/manual resend retains its original manifest and embeds its original HTML unchanged instead of rerendering it;
- bot logs contain no render, delivery, or unhandled errors.

- [ ] **Step 5: Final evidence capture**

Report the deployed SHA, test commands/results, live wallet checked, renderer/template versions, and any unrelated dirty files left untouched. If live Telegram access is unavailable, state that rollout acceptance remains pending; do not claim deployment complete from unit tests alone.

## Final self-review checklist

- [ ] Every approved design requirement has a corresponding implementation or test step.
- [ ] V1 historical artifacts are accepted but never regenerated as V1 for new requests.
- [ ] V2 visible copy contains no raw scope, role, code, fact-count, ISO timestamp, or unexplained coverage key.
- [ ] Exact raw amounts and canonical fact IDs remain in receipts and hashes.
- [ ] Unknown decisive copy fails closed; unknown non-decisive copy is neutral and localized.
- [ ] Score and decision remain canonical and primary.
- [ ] Both sending and receiving guidance are always present.
- [ ] Compaction cannot remove essential customer decisions.
- [ ] No dependency, schema migration, scoring change, or unrelated cleanup was added.
- [ ] Tests, knowledge docs, commit history, and live rollout evidence agree.
