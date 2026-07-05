---
status: draft
audit_type: knowledge_deep_audit
scope: manual finding / candidate implementation spec
created: 2026-07-05
confidence: runtime-observed
---

# Where Dense Hop Materiality Finding

## What This Note Is

Это ручная finding/spec note по результату живого разбора `Where is money` для:

```text
THJcWw89zY5VAeqwtLAXj13aY7N2Y3FMD7
where job: 7a94ca49-88ca-4d2a-b51c-854b94a6d44b
```

Мы вручную выяснили, что `Where is money` может честно дойти до почти полного
маршрута, но затем заблокировать весь score из-за одного dense hop, если для
него не удалось доказать source-of-funds до конца.

Это не баг вида "система нашла риск". Это продуктово-техническая проблема:

```text
маленькая или второстепенная unresolved ветка может заблокировать весь Where
report, даже если основная покрытая часть уже дает полезный результат.
```

Нужное направление:

```text
Считать score по покрытой и доказанной части, а нематериальную непокрытую
ветку не использовать как decisive scoring input. При этом не скрывать ее:
показывать как caveat / manual review detail.
```

## Why This Matters

Пользователь не покупает техническую ошибку. Ему нужен финальный вывод:

- что удалось доказать;
- какие funds покрыты;
- где есть hard bad evidence;
- где есть clean/service boundary;
- что осталось неподтвержденным;
- влияет ли неподтвержденная часть на итоговый score.

Если система отвечает только:

```text
provider_cap_unresolved
score_valid=false
```

то аналитически это честно, но продуктово плохо, когда unresolved часть мала и
не содержит hard evidence.

Такие случаи особенно вероятны на TRON USDT, потому что это account-based
модель. У исходящего transfer нет встроенной ссылки на конкретный предыдущий
incoming transfer. Чтобы доказать provenance, система должна проверить не
только "последнее пополнение", но и то, что между пополнением и outgoing hop
не было расходов, которые могли съесть эти средства.

## Runtime Case Summary

В observed job `7a94ca49-88ca-4d2a-b51c-854b94a6d44b`:

- parent job: `where_is_money_check`;
- subject: `THJcWw89zY5VAeqwtLAXj13aY7N2Y3FMD7`;
- final job status: `failed`;
- final technical status: `provider_cap_unresolved`;
- final score validity: `score_valid=false`;
- targeted waits: 35 total;
- ready targeted waits: 34;
- terminal targeted waits: 1.

Blocking targeted wait:

```text
address: TYCBsKvJSrLoj6pudJCLFNFYdBcntNP1gU
request_kind: broad_targeted
target_timestamp: 2026-06-30T16:15:42Z
status: terminal
status_reason: partial_provider_cap
```

Observed targeted state:

```text
fetched_page_count: 26
fetched_transfer_count: 1297
unique_counterparty_count: 1191
newest_transfer_at: 2026-06-30T16:15:42Z
oldest_transfer_at: 2026-06-30T14:31:36Z
provider_cap_hit: true
budget_exhausted: false
provider_inconsistent: false
rate limits / 403 / 5xx: not observed in progress
attempt_count: 8
max_attempts: 8
```

Important interpretation:

```text
26 pages did not mean "we covered a lot of history".
For this dense address, 26 pages covered only about 1 hour 44 minutes of very
busy activity.
```

## The Concrete Branch

The blocking branch included this visible transfer:

```text
TYCBsKvJSrLoj6pudJCLFNFYdBcntNP1gU
  -> TSyV9QwXUtT3foQTNCGhZA7dDL6NDNtSxs
amount: 1,562 USDT
time: 2026-06-30T16:15:42Z
tx: 6e36c644cf...
```

The same downstream route also had larger visible hops, for example:

```text
TSyV9QwXUtT3foQTNCGhZA7dDL6NDNtSxs
  -> TPsSsdRHFjSLCMsv7Mt8pU2J1sg4VubAYT
amount: 863,841 USDT
time: 2026-07-01T15:54:24Z
tx: b7ea6aadb5...

TPsSsdRHFjSLCMsv7Mt8pU2J1sg4VubAYT
  -> TDyptbCfFHPvNSBSyB5AWxNC9ACUZCeCjV
amount: 746,565 USDT
time: 2026-07-01T16:03:15Z
tx: 9391f90d00...
```

The local observed share of the unresolved `TYCBs...` funding transfer versus
the next visible large hop is roughly:

```text
1,562 / 863,841 ~= 0.18%
```

This is a manual comparison for this branch, not a complete product rule. A
real implementation should compute materiality against the checked/selected
amount and aggregate all unresolved branches.

## Why "Just Take The Last Top-Up" Is Not Enough

For account-based USDT, the chain does not preserve coin identity.

If address `A` sends `1,562 USDT`, we cannot directly read:

```text
these exact 1,562 came from incoming tx X
```

We can only prove a funding explanation by checking a window:

1. A funding candidate came before the outgoing hop.
2. The amount is enough.
3. The time relation makes sense.
4. No outgoing spends between candidate and target consumed the candidate.
5. The window is covered enough that we are not missing competing transfers.

That is why the system sometimes needs more than the latest visible incoming
transfer.

However, that does not mean the system should always fetch broad history for a
dense address until it either proves everything or fails the whole report.

## What Went Wrong Product-Wise

The current behavior is too strict at the final decision layer.

The trace did useful work:

- many targeted waits were completed;
- candidate windows were checked;
- most observed branches did not hit this terminal failure;
- no hard evidence was found in the unresolved `TYCBs...` branch during this
  manual review.

But one dense `broad_targeted` hop became:

```text
partial_provider_cap -> provider_cap_unresolved -> score_valid=false
```

That makes sense for a material mandatory main path. It is too harsh for a
small or non-decisive branch.

The better policy is:

```text
Do not let every unresolved branch become a job-level technical blocker.
First decide whether the unresolved branch is material to the checked amount
or contains hard evidence.
```

## Proposed Product Rule

Where should distinguish:

1. Covered exact provenance.
2. Legitimate service boundary.
3. Hard bad evidence.
4. Material unresolved provenance.
5. Residual unresolved provenance below materiality.
6. Dense-hop unresolved caveat.

Suggested rule:

```text
If unresolved provenance is below materiality thresholds, has no hard evidence,
and does not dominate the selected/checked amount, Where can publish a valid
score for the covered part.

The unresolved branch remains visible as a caveat and is not treated as clean
proof, bad proof, or decisive scoring input.
```

This means:

- covered clean/exact/service-boundary evidence can still support the score;
- hard bad evidence still wins even if coverage is partial;
- material unresolved source still blocks score or forces review/no-final;
- tiny unresolved dense-hop tails do not collapse the entire report into
  `provider_cap_unresolved`.

## Chosen Policy Direction: Tiered Materiality

Chosen direction for future implementation: option C, tiered policy.

Do not use only the old strict pair:

```text
unresolved <= 1% AND unresolved <= 100 USDT
```

That rule is useful for dust-like residuals, but it is too strict for large
flows. In the THJ example, the dense-hop tail was:

```text
1,562 USDT / 863,841 USDT ~= 0.18%
```

It is small relative to the route branch, but above 100 USDT. A pure
`1% + 100 USDT` rule would still block the report, which is exactly the
product problem we want to solve.

Use tiers instead:

```text
dust residual
small-relative dense-hop tail
material unresolved source
hard-evidence unresolved source
```

The point is not to declare the uncovered branch clean. The point is to decide
whether it is allowed to block the whole result.

### Tier 1: Dust Residual

Meaning:

```text
tiny absolute amount and tiny relative share
```

Example:

```text
50 USDT unresolved / 100,000 USDT checked = 0.05%
```

Expected outcome:

- score can remain valid if no hard evidence;
- unresolved branch is shown as residual caveat;
- unresolved amount is not used as clean evidence;
- unresolved amount is not used as bad evidence.

This is close to the current `residual_unresolved_below_materiality` behavior.

### Tier 2: Small-Relative Dense-Hop Tail

Meaning:

```text
not dust in absolute dollars, but small relative to a large checked flow
```

Example:

```text
1,562 USDT unresolved / 863,841 USDT local hop ~= 0.18%
8,000 USDT unresolved / 1,000,000 USDT checked = 0.8%
```

Expected outcome:

- score can remain valid if no hard evidence and aggregate unresolved share is
  still below threshold;
- decision should usually be at least `REVIEW` or a valid score with a visible
  caveat, not visually clean `ACCEPTABLE / 0`;
- unresolved branch is excluded from decisive clean/bad evidence;
- Admin shows the dense-hop facts and materiality calculation;
- Telegram says there is a small unresolved source tail.

This is the new policy gap identified by the THJ manual review.

### Tier 3: Material Unresolved Source

Meaning:

```text
the missing branch is large enough to affect the answer
```

Examples:

```text
1,562 USDT unresolved / 2,000 USDT checked = 78.1%
300,000 USDT unresolved / 1,000,000 USDT checked = 30%
20 branches x 0.5% each = 10% aggregate unresolved
```

Expected outcome:

- score should be blocked or forced into manual/no-final result;
- report should not imply the covered part represents the whole source;
- broad targeted indexing may still be justified if the product wants to keep
  working for a final answer.

### Tier 4: Hard-Evidence Unresolved Source

Meaning:

```text
unresolved branch has hard bad evidence or strong policy evidence
```

Examples:

- approval-drain evidence;
- active restriction;
- exact risky label;
- source-policy decline boundary;
- known theft/scam relation.

Expected outcome:

- hard evidence remains decision-relevant even if amount is small;
- no materiality bypass by default;
- product can later define a separate de minimis hard-evidence policy, but
  this finding does not recommend one.

## Materiality Denominator By Where Scope

Materiality must use the denominator that matches the product question.

For `current_balance`:

```text
unresolved share = unresolved amount / current balance or selected
balance-forming amount
```

For `selected_anchor`:

```text
unresolved share = unresolved amount / selected anchor amount
```

For `recent_flow`:

```text
unresolved share = unresolved amount / recent meaningful flow amount
```

For `requested_amount`:

```text
unresolved share = unresolved amount / requested amount
```

For `transaction_seed`:

```text
unresolved share = unresolved amount / seeded transaction amount or selected
funding bundle for that transaction
```

The same unresolved transfer can be immaterial in one scope and material in
another. The implementation must not use one global denominator blindly.

## Outcome Matrix

| Situation | Score use | User/Admin meaning |
| --- | --- | --- |
| Exact covered source | Can score | Proven evidence |
| Service boundary | Can score according to boundary policy | Honest stop, not missing data |
| Dust residual, no hard evidence | Can score with caveat | Tiny unresolved residue |
| Small-relative dense-hop tail, no hard evidence | Can score with stronger caveat / likely REVIEW | Uncovered branch excluded from decisive evidence |
| Aggregate unresolved above threshold | Block score or manual/no-final | Covered part is not enough |
| Material main source unresolved | Block score or manual/no-final | Missing branch affects answer |
| Any unresolved branch with hard evidence | Hard evidence remains decisive | Do not hide risk behind coverage gap |
| Provider cap on old cached job | Do not reinterpret silently | Needs fresh run or explicit re-evaluation |

## Amount Scenario Matrix

These scenarios should become tests or product examples before implementation.

| Scenario | Example | Expected result |
| --- | --- | --- |
| Dust residual | `50 / 100,000 = 0.05%` | valid score, caveat |
| THJ-like dense tail | `1,562 / 863,841 = 0.18%` | valid score if no hard evidence, caveat, likely REVIEW |
| Large-flow small-relative | `8,000 / 1,000,000 = 0.8%` | product-configured tier; likely valid with stronger caveat if aggregate stays low |
| Small checked amount | `1,562 / 2,000 = 78.1%` | material unresolved, block/no-final |
| Aggregate small branches | `20 x 0.5% = 10%` | material aggregate, block/no-final |
| Tiny hard-evidence branch | `10 / 1,000,000 = 0.001%` plus exact scam label | hard evidence remains visible and decision-relevant |

## Proposed Implementation Shape

### 1. Prefer Candidate-Window Proof Before Broad Fallback

For a concrete outgoing hop:

```text
TYCBs... -> TSyV... : 1,562 USDT
```

the system should first try to prove a narrow candidate-to-target window:

```text
candidate incoming timestamp -> target outgoing timestamp
```

This is already the right architectural direction with `candidate_window`.

The product rule should be:

```text
Use broad_targeted only when the branch is material enough to justify it, or
when candidate-window proof cannot answer a mandatory main-path question.
```

### 2. Add Materiality Before Job-Level Failure

Before converting a terminal dense-hop provider cap into job-level
`score_valid=false`, compute:

- unresolved amount for this branch;
- unresolved share of selected/checked amount;
- unresolved share of local route hop, where useful;
- aggregate unresolved amount across all unresolved branches;
- whether unresolved branch has any hard evidence;
- whether branch is on the dominant source route or a small funding tail.

If below materiality and no hard evidence:

```text
scoreValid=true
technicalStatus=completed
decision=REVIEW or other policy result from covered evidence
caveat=residual_unresolved_dense_hop_below_materiality
```

If material or hard evidence possible:

```text
scoreValid=false
technicalStatus=provider_cap_unresolved
or REVIEW/DECLINE according to hard evidence policy
```

### 3. Do Not Hide The Uncovered Part

"Не учитывать" should mean:

```text
do not use it as decisive scoring input
```

It should not mean:

```text
delete it from the report
```

Admin should still show:

- unresolved address;
- transfer amount;
- target timestamp;
- reason: dense provider-capped history;
- pages/transfers fetched;
- observed oldest/newest range;
- materiality share;
- whether hard evidence was found;
- whether the unresolved branch was excluded from decisive score.

Telegram can use simpler wording:

```text
Small unresolved source tail remains because one dense address could not be
fully covered. It was below the materiality threshold and was not used as clean
or bad evidence.
```

### 4. Aggregate Small Gaps

One small unresolved branch may be harmless. Ten small unresolved branches may
not be.

Implementation should aggregate:

```text
total unresolved amount
total unresolved share
largest unresolved branch
count of unresolved dense-hop branches
```

A report should not pass materiality just because each branch is individually
small if the aggregate unresolved amount is material.

### 5. Keep Hard Evidence Override

If the unresolved branch has signs of:

- approval drain;
- active restriction;
- exact risky label;
- source-policy decline;
- known theft/scam relation;

then it should not be excluded just because the amount is small, unless product
explicitly defines a separate de minimis hard-evidence threshold.

Default policy should be conservative:

```text
hard evidence in an unresolved branch keeps the branch decision-relevant.
```

### 6. Separate Provider Failure From Product Materiality

Provider cap is a technical fact:

```text
we did not fully cover this dense address window
```

Materiality is a product/scoring fact:

```text
does this missing branch materially affect the answer?
```

The current failure mode couples them too tightly.

Better:

```text
provider_cap_unresolved at branch level
may become caveat at report level
if branch is immaterial and clean of hard evidence.
```

### 7. Add A Dense-Hop Preflight

Before spending broad targeted budget on a dense hop, the trace should be able
to ask:

- how large is this branch relative to the current Where scope;
- is it on the dominant route or a small funding tail;
- did direct hard-evidence checks already find anything decisive;
- is the address likely a service/high-degree wallet;
- can a candidate-window proof answer the product question without broad
  history;
- would unresolved status be allowed to become a caveat if broad coverage
  fails.

This preflight should not skip mandatory material branches. It should prevent
small dense tails from consuming work and then collapsing the whole report.

### 8. Add A Coverage Ledger To The Report

The final report should expose a compact provenance coverage ledger:

```text
exactCoveredAmount
serviceBoundaryAmount
unresolvedExcludedAmount
unresolvedMaterialAmount
largestUnresolvedBranchAmount
aggregateUnresolvedShare
hardEvidenceInUnresolved
materialityTier
```

This gives Admin and Telegram a concrete way to explain why score is valid,
blocked, or review-only.

## Edge Cases To Handle

### Material Main Source

If a provider-capped dense hop represents a large share of the checked amount,
it should still block the score or force no-final/manual review.

Example:

```text
unresolved branch = 40% of selected amount
```

This is not a harmless tail.

### Unresolved Hard Evidence

If the unresolved branch has hard bad evidence, it should remain decisive.

Partial coverage must not become a way to hide risk.

### Many Small Unresolved Branches

Aggregate materiality must catch:

```text
20 branches x 0.5% each = 10% unresolved
```

### Service Boundary

Service boundary is not the same as unresolved.

If the trace reaches an exchange/bridge/router/service boundary, that should be
represented as boundary evidence, not as dense-hop provider failure.

### Old Cached Jobs

Old `provider_cap_unresolved` jobs may have been produced before the new
policy. Admin should not silently reinterpret old jobs as valid without a fresh
run or explicit migration/re-evaluation step.

### Current Balance Vs Recent Flow

Materiality denominator must match the Where scope:

- current balance;
- selected anchor;
- recent meaningful flow;
- requested amount;
- transaction seed.

A branch can be tiny relative to one denominator and material relative to
another.

### Exact Candidate Window With Broad Failure

If candidate-window proof is exact for the needed transfer, broad failure
should not automatically invalidate that exact local proof.

But broad history may still matter if the product question requires broader
address provenance beyond the candidate-to-target window.

## Suggested Status Names

Possible report caveats:

```text
residual_unresolved_dense_hop_below_materiality
dense_hop_provider_cap_below_materiality
small_relative_dense_hop_tail
unresolved_branch_excluded_from_decisive_score
material_dense_hop_provider_cap
aggregate_unresolved_above_materiality
hard_evidence_in_unresolved_branch
```

Suggested Admin label:

```text
Dense hop caveat
```

Suggested Telegram language:

```text
Small unresolved source tail remains. It was below the materiality threshold
and was not used as clean or bad evidence.
```

## Candidate Acceptance Criteria

A future implementation plan should include tests where:

1. One tiny dense-hop `partial_provider_cap` branch does not make the whole
   Where report `scoreValid=false`.
2. The same branch remains visible in Admin caveats.
3. The unresolved amount is excluded from decisive clean/bad evidence.
4. Aggregate tiny unresolved branches can still become material.
5. Material unresolved branch still blocks score.
6. Hard evidence in an unresolved branch still affects the outcome.
7. Telegram does not say the uncovered branch is clean.
8. Old job technical status is not silently reinterpreted as a fresh valid
   result.
9. A THJ-like branch above 100 USDT but below the relative dense-hop threshold
   can stay score-valid with a caveat when no hard evidence is present.
10. The same absolute unresolved amount blocks score when the checked/selected
    amount is small.
11. Different Where scopes use different denominators.
12. The report exposes covered, service-boundary, excluded-unresolved and
    material-unresolved amounts separately.

## Suggested Priority

Priority: high.

Reason:

This directly affects whether paid `Where is money` checks produce useful final
answers. The current strict no-score behavior is correct for material mandatory
coverage gaps, but too brittle for small dense-hop tails.

This should be one of the first implementation candidates after the current
audit/review pass.

## Open Product Decision

The key decision:

```text
When unresolved source provenance is below materiality and has no hard evidence,
should Where publish a valid score for the covered part?
```

Recommended answer:

```text
Yes. Publish the score for the covered part, keep the unresolved part as a
visible caveat, and do not treat that unresolved part as clean or bad evidence.
```

Policy direction is selected as tiered materiality, not the old strict-only
threshold pair. Existing residual materiality policy uses local thresholds
around:

```text
1% of checked/selected amount
100 USDT
```

Those thresholds should remain useful for dust residuals, but dense-hop tails
need a separate relative/aggregate tier. Concrete threshold values still need a
future implementation plan and calibration, but the chosen shape is:

```text
dust residual -> small-relative dense-hop tail -> material unresolved source
-> hard-evidence unresolved source
```

## Evidence Appendix

Knowledge docs read:

- `docs/knowledge/AGENT_BRIEF.md`
- `docs/knowledge/03-job-lifecycle.md`
- `docs/knowledge/04-data-sources-tronscan-indexing.md`
- `docs/knowledge/05-where-is-money-and-incoming.md`
- `docs/knowledge/10-open-problems.md`

Runtime data inspected:

- `forensic_check_jobs`
- `forensic_job_waits`
- `tron_address_usdt_index_states`
- `tron_address_usdt_index_pages`
- `tron_usdt_transfers`

Code behavior verified during manual analysis:

- `partial_provider_cap` maps to `provider_cap_unresolved`;
- terminal targeted provider cap can make parent Where save
  `score_valid=false`;
- retry/escalation only continues when state is retryable under current
  budget/attempt rules;
- in the observed case, the blocking state had `budget_exhausted=false` and
  `attempt_count=8/max_attempts=8`.
