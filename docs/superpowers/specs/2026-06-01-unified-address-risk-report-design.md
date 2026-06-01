# Unified Address Risk Report Design

## Summary

Telegram checks currently show several risk numbers for the same address:

- preliminary fast risk;
- where-is-money provenance risk;
- deep address behavior risk.

Each number is produced by a different subsystem and answers a different question. The analysis itself is useful, but the current bot output makes these numbers look like competing final decisions. This confuses operators, especially when a wallet has clean-ish provenance but risky operational behavior.

This spec defines a single user-facing final report for address checks. "Where money came from" becomes the primary exchange decision and final score. Preliminary and deep behavior checks add short warnings only, unless they find hard evidence.

## Approved Product Rule

Use one final user-facing assessment:

1. **Primary score source:** where-is-money result.
2. **Context sources:** preliminary fast check and deep behavior check.
3. **Override rule:** hard evidence from any source can override the final score and decision.
4. **Hidden details:** technical fields move to support/debug output instead of the normal user message.

Hard evidence includes exact self labels, exact approval-drain provenance, active USDT blacklist state, exact high-risk labeled path, or equivalent deterministic evidence. Behavior-only, service-boundary, operational-liquidity, and counterparty-fast-snapshot signals are not hard evidence by themselves.

## Problems To Fix

### Problem 1: Three Scores Look Like Three Decisions

Example:

- Preliminary: `60/100 HIGH`
- Where-is-money: `25/100 LOW`, decision `ACCEPTABLE`
- Behavior: `72/100 HIGH` or counterparty snapshot `80/100 HIGH`

This is technically explainable but bad UX. The operator should not have to know internal scoring categories.

### Problem 2: Preliminary Risk Sounds Too Final

Fast risk can be raised by operational patterns:

- service-boundary exposure;
- rapid redistribution;
- transit-like behavior;
- major counterparty context.

Those are review signals, not proof of dirty provenance. The preliminary message should not present this as the final address risk when async provenance jobs are still running.

### Problem 3: Where-Is-Money Output Is Too Technical

The current user report includes internal details:

- job id;
- evidence type;
- assessment internals;
- origin paths;
- sender interactions;
- coverage debug notes;
- previous fast risk;
- long transaction hashes;
- raw stopped reasons.

Most of this belongs in support/debug tooling, not in the main Telegram result.

### Problem 4: `partial` Reads Like Incomplete Work

Where-is-money may cover 95-100% of the target amount but still mark the job partial because some origin paths stop as `REVIEW`. In user copy this should be phrased as "готово, есть ограничения" or as confidence/limitations, not as if the analysis did not run.

## What The System Actually Does

### Balance-Forming Selection

For a normal address check without a requested amount, the where-is-money job uses the current USDT balance as target.

It selects inbound USDT transfers newest-first until they explain the current balance, with a default minimum coverage ratio of 95%.

For the observed `TTs9xC...w7FD` job:

- target: current balance, about `881,418 USDT`;
- selected inbound transfers: `32`;
- selected amount: about `840,313 USDT`;
- coverage ratio: `95.33%`;
- scope: current-balance provenance;
- origin paths: all selected paths were `REVIEW`, with `weak_amount_or_time_continuity` or `no_previous_transfer`.

### Weak Amount Or Time Continuity

`weak_amount_or_time_continuity` means the sender has previous incoming USDT transfers, but the tracer cannot confidently connect a previous incoming transfer to the outgoing transfer into the checked wallet.

The current threshold requires:

- at least 70% amount preservation between candidate transfer and expected amount;
- candidate transfer timestamp not later than the outgoing transfer;
- maximum time delta of 365 days;
- clean path must not cross an unresolved service boundary.

This is a conservative stop. It prevents the report from claiming clean provenance when the chain is only loosely related by address history.

### Behavior Risk

Deep behavior risk is contextual. In the observed job it was driven by:

- a major outbound counterparty with fast risk `80/100`;
- about 50% outbound volume connected to that counterparty;
- service exposure and transit-like behavior;
- limited coverage notes.

This is useful support context, but it should not compete with the final exchange decision unless it becomes hard evidence.

## User-Facing Report

The normal Telegram output should be one final message:

```text
Проверка адреса — итог

Решение: ACCEPTABLE
Итоговый риск: 🟢 25/100 (низкий)

Почему:
• Проверено 95% текущего баланса: 32 входящих USDT-перевода.
• Жёстких плохих доказательств не найдено.
• Часть путей не доказана до чистого источника, поэтому уверенность средняя.
• Есть поведенческий риск по крупному контрагенту, но это не доказательство грязного происхождения.

Ограничения:
• 13 путей остановлены из-за слабой связи суммы/времени.
• 19 путей остановлены без предыдущего входящего перевода.
```

The exact copy can be shorter when there are fewer signals. The message should stay under roughly 8-10 user-facing lines, excluding the address and runtime marker.

## Preliminary Message

The preliminary response should become a status message, not a competing score:

```text
Проверка адреса — запущена

Адрес: ...

Что делаем:
• Проверяем происхождение текущего USDT-баланса.
• Проверяем поведение адреса как дополнительный контекст.

Итоговый риск появится после анализа происхождения средств.
```

If hard evidence is found during the fast check, the preliminary message may show it immediately. Otherwise it should avoid "Риск адреса: 60/100".

## Deep Behavior Output

Deep behavior should not send a separate "Риск поведения: N/100" user message by default.

Instead:

- if where-is-money is still pending, store the deep result and wait for aggregation when feasible;
- if final where-is-money already exists, update/send a unified final report with a context warning;
- if deep finds hard evidence, send/update final report immediately with override decision.

Support/debug commands may still show standalone deep behavior details.

## Support And Debug Output

Move these fields out of the normal report:

- job id;
- raw evidence type;
- internal assessment scores;
- origin path list;
- sender interaction list;
- AI contract verdict details;
- coverage debug notes;
- transaction hashes;
- previous fast risk;
- raw counterparty snapshots.

Keep them available for admins/support through existing job status/debug flows or a new compact support formatter.

## Final Scoring Rules

### Base Final Score

Use `whereIsMoneyReport.riskScore` and `whereIsMoneyReport.decision` when where-is-money exists.

### Hard Evidence Override

Override the base score when any source contains deterministic hard evidence with a higher severity:

- active USDT blacklist state;
- exact approval-drain provenance;
- exact internal critical label on the subject;
- exact high-risk labeled path;
- other hard evidence explicitly classified by risk policy.

The override should explain the hard evidence in one short bullet.

### Context Warnings

Do not override the where-is-money score for:

- service-boundary context;
- operational/liquidity wallet role;
- behavior-only score;
- counterparty fast-risk snapshot;
- weak amount/time continuity;
- provider/data coverage limitation.

These become warnings or limitations.

## Data Flow

1. `/check <address>` starts fast check and async jobs.
2. Fast check sends a neutral "analysis started" message unless hard evidence exists.
3. Where-is-money result becomes the primary final report.
4. Deep result is merged into the final report as context.
5. If jobs finish in either order, the bot should avoid showing multiple competing risk messages.
6. Support/debug detail remains available outside the user-facing final message.

## Living Issue Log

Use this section for follow-up issues discovered during review before implementation.

### 2026-06-01: Initial UX Consolidation

Decision: use where-is-money as the primary final score. Preliminary and deep behavior add warnings only, except for hard-evidence overrides.

Open questions for future additions:

- Should final reports be edited in place when Telegram message ids are available, or sent as a new final message?
- Should support/debug details be admin-only or available to all operators by command?
- Should the preliminary message be suppressed entirely for fast where-is-money jobs?

### 2026-06-01: Incoming Deposit Origin Coverage Copy

Observed output:

```text
Проверено происхождение: 15% суммы
```

This is misleading for operators. The system did not simply "check only 15% of the deposit". For incoming deposits, this value is `originCoverage`: the share of the deposit amount that could be connected to upstream funding with sufficient amount/time continuity and without unresolved provenance stops.

In the observed `300000 USDT` deposit case, the job checked the deposit and sender history, but the sender behaved like a pooled operational/liquidity wallet. The trace found only weak or budget-limited upstream continuity:

- one long path reached `maxAddressFetches=60` before a clean or declined source was found;
- another path had previous incoming transfers but weak cashflow continuity;
- no hard bad evidence was found.

The user-facing report should not show this as "Проверено происхождение: 15% суммы". Prefer one of these:

- hide the percentage and show `Уверенность по происхождению: низкая/средняя`;
- rename it to `Доказанная связка происхождения: 15%`;
- include a short limitation: `Для остальной суммы источник не доказан из-за смешанной ликвидности отправителя`.

This should be folded into the same unified-report work so incoming deposit alerts do not expose a confusing standalone percentage.

## Testing Strategy

Add focused tests for:

- preliminary report hides non-hard fast score;
- where-is-money final report shows one score and no technical sections;
- deep behavior merges as warning without changing final score;
- hard evidence from deep overrides where-is-money;
- `partial` coverage wording becomes limitations/confidence wording;
- support/debug output still exposes job ids and technical details.

## Success Criteria

- A normal address check produces one final user-facing score.
- Operators can understand why the decision was made without reading internal provenance structures.
- Behavior context is visible but clearly not proof of dirty funds.
- Technical detail remains accessible for support.
- Existing forensic scoring internals are preserved unless the implementation plan explicitly changes formatting or aggregation.
