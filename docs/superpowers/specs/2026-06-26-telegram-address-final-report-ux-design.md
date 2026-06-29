# Telegram Address Final Report UX Design

## Status

Approved draft.

This spec defines how Telegram should explain the final address-check result after FastCheck, DeepCheck, and Where Is Money run together.

The goal is not to change the scoring math in this phase. The goal is to make the result readable and to stop sending two messages that both look like the final answer.

## Problem

An address check can currently produce two messages with the same headline:

```text
Проверка адреса — итог
```

This happens because internal modes finish at different times.

Example:

1. Where Is Money finishes first and finds hard evidence.
2. DeepCheck finishes later and adds behavior context.
3. Both messages are delivered as if they are final.

For the user this looks like two separate final decisions. In reality it is one check whose evidence was filled in over time.

The current message also exposes too much internal scoring detail. It is hard to understand why the final risk can be `95/100` while the weighted layer score is lower.

## Product Goal

The user should understand the result without knowing the internal architecture.

The main report must answer five questions:

1. What is the decision?
2. What is the final risk?
3. Why did the system decide this?
4. What did the system find?
5. How complete is the data?

Developer diagnostics can remain in a beta/internal section, but they should not be the main explanation.

## Chosen Approach

Use a small report lifecycle:

```text
start -> final
start -> preliminary -> final
start -> final with limitations
```

Do not allow this:

```text
start -> final -> final
```

Only one message per address request may use the headline:

```text
Проверка адреса — итог
```

If an early mode finds important evidence before the full check is complete, Telegram may send a preliminary result. That message must not pretend to be final.

## Out Of Scope

Do not change in this phase:

- scoring weights;
- risk thresholds;
- FastCheck, DeepCheck, or Where Is Money job internals;
- admin graph visualization;
- provider integrations;
- the final decision policy itself.

This is a reporting and message-lifecycle spec.

## Message Lifecycle

### Start

The start message explains what is being checked.

Example:

```text
Проверка адреса запущена

Адрес:
TPdrEz6N5pJoUbnnEcSz56e3wumV5mmGJE

Что проверяем:
• текущий риск адреса;
• происхождение средств;
• связи с рискованными источниками;
• поведение и крупных контрагентов.

Итоговый риск появится после анализа.
```

### Preliminary Result

Send a preliminary result only when there is already an important signal, but the full address check is still running.

Example:

```text
Проверка адреса — предварительный результат

Предварительный риск:
🔴 95/100

Почему:
адрес связан с approval-drain.

Что дальше:
DeepCheck ещё продолжает проверку связей и поведения адреса.
Финальный итог придёт после завершения анализа.
```

Preliminary should be rare. It is useful when waiting silently would hide an important risk signal.

### Final Result

The final result is sent once.

Example:

```text
Проверка адреса — итог

Адрес:
TPdrEz6N5pJoUbnnEcSz56e3wumV5mmGJE

Решение:
DECLINE
Адрес нельзя принять автоматически.

Итоговый риск:
🔴 95/100 — критический

Главная причина:
Проверяемый адрес напрямую связан с approval-drain.
Это жёсткое доказательство риска, поэтому итоговый риск закреплён на 95/100.

Что нашли:
• Where Is Money подтвердил связь с drain-эпизодом.
• DeepCheck нашёл поведенческий риск по крупному контрагенту.
• Часть происхождения средств осталась нераскрытой.

Почему риск 95:
Фоновая оценка режимов — 62/100.
Финальный риск выше, потому что сработало жёсткое доказательство риска.

Доверие к данным:
Среднее. Главный риск подтверждён, но покрытие происхождения неполное.

Ограничения:
Граф остановился на значимом неизвестном источнике.

Beta/internal:
coverage partial · confidence 70 · evidence hard · policy wallet-risk-v1
FastCheck 0 · DeepCheck 55 · Where Is Money 95
runtime master-02dbf17
```

### Final With Limitations

Use this when the check is done enough to report, but one or more parts failed, timed out, or returned partial data.

Example:

```text
Проверка адреса — итог с ограничениями

Решение:
REVIEW
Нужна ручная проверка.

Почему:
сильных доказательств риска не найдено, но часть происхождения средств не раскрыта.

Ограничения:
DeepCheck не завершился.
Часть связей могла остаться непроверенной.
```

## User-Facing Message Structure

The normal final message uses this order:

1. headline;
2. address;
3. decision;
4. final risk;
5. main reason;
6. findings;
7. why this score;
8. data confidence;
9. limitations;
10. beta/internal diagnostics.

The first half is for the user. The last section is for beta, support, and developers.

## Decision Copy

### DECLINE

Use when there is hard evidence or enough risk for an automatic refusal.

```text
Решение:
DECLINE
Адрес нельзя принять автоматически.
```

### REVIEW

Use when there are risk signals, but not enough proof for an automatic refusal.

```text
Решение:
REVIEW
Нужна ручная проверка.
```

### ACCEPT

Use only when strong risk signals were not found and coverage is good enough for the product policy.

```text
Решение:
ACCEPT
Сильных риск-сигналов не найдено.
```

Do not write that the wallet is guaranteed clean.

## Scoring Explanation

The user sees one final risk.

The report may also explain why the final risk differs from the weighted context score.

Example:

```text
Фоновая оценка режимов: 62/100.
Финальный риск: 95/100.
Причина: найдено жёсткое доказательство риска.
```

This matters because hard evidence can set a minimum risk. A lower weighted score should not make a blacklist or approval-drain signal look weaker.

## Hard Evidence

Hard evidence is a signal that can justify a high final risk by itself.

Examples:

- address is in blacklist;
- funds are frozen or restricted;
- direct approval-drain provenance;
- confirmed connection to a known bad source;
- exact match with a critical internal risk label.

User copy:

```text
Главная причина:
Найдено жёсткое доказательство риска: адрес связан с approval-drain.

Что это значит:
Такой сигнал имеет приоритет над обычной взвешенной оценкой.
Поэтому итоговый риск закреплён на 95/100.
```

## Behavior Risk

Behavior risk is not the same as proof.

Examples:

- fast transfers;
- large counterparty;
- transit-like behavior;
- many incoming or outgoing transfers;
- service, bridge, DEX, CEX, or contract exposure without proven dirty origin.

User copy:

```text
Дополнительный сигнал:
DeepCheck нашёл поведенческий риск по крупному контрагенту.
Это усиливает подозрение, но само по себе не доказывает грязное происхождение.
```

Behavior-only cases should usually lead to `REVIEW`, not `DECLINE`, unless the policy has other hard evidence.

## Coverage And Confidence

Coverage explains how much of the relevant money path was checked.

Confidence explains how much trust the system has in the result.

Do not show only:

```text
coverage partial · confidence 70
```

Show the human meaning first:

```text
Доверие к данным:
Среднее. Главный риск подтверждён, но покрытие происхождения неполное.
```

Then keep the raw fields in beta/internal.

### Coverage Copy

Good:

```text
Покрытие проверки:
Хорошее. Основные цепочки происхождения денег раскрыты.
```

Partial:

```text
Покрытие проверки:
Неполное. Мы нашли сильный риск, но не смогли раскрыть всю цепочку происхождения денег.
```

Limited:

```text
Покрытие проверки:
Ограниченное. Данных мало, поэтому результат требует ручной проверки.
```

## Beta/Internal Diagnostics

Keep the beta/internal block short.

Always useful:

- coverage;
- confidence;
- evidence class;
- policy;
- runtime;
- FastCheck score;
- DeepCheck score;
- Where Is Money score;
- final risk;
- reason why the final risk was pinned or raised.

Show only when applied:

- hard evidence floor;
- policy floor;
- pattern floor;
- asset-continuation floor;
- discount;
- fallback due to a failed mode;
- manual override.

Do not show zero values that did not affect the result.

Avoid this:

```text
Порог политики: 0
Снижение: 0
Порог по паттернам: 0
```

Prefer this:

```text
Beta/internal:
coverage partial · confidence 70 · evidence hard · policy wallet-risk-v1
FastCheck 0 · DeepCheck 55 · Where Is Money 95
weighted context 62 · hard evidence floor 95 · final risk 95
runtime master-02dbf17
```

## Scenario Rules

### Blacklist

```text
Главная причина:
Адрес найден в blacklist.

Что это значит:
Средства могут быть заморожены или связаны с запрещённой активностью. Это критический риск.
```

### Approval-Drain

```text
Главная причина:
Проверяемый адрес напрямую связан с approval-drain.

Что это значит:
Это жёсткое доказательство риска. Итоговый риск закреплён на 95/100.
```

### Strong Indirect Risk

```text
Главная причина:
Найдена рискованная цепочка происхождения средств.

Что это значит:
Это не прямое доказательство грязных денег, но поведение адресов похоже на быстрый перевод через промежуточные кошельки.
```

### Incomplete Coverage

```text
Ограничение:
Проверка неполная. Часть происхождения денег не удалось раскрыть.

Что это значит:
Адрес нельзя уверенно считать чистым. Перед финальным бизнес-решением нужна ручная проверка.
```

If hard evidence exists:

```text
Ограничение:
Покрытие неполное, но найдено жёсткое доказательство риска. Поэтому решение остаётся строгим.
```

### Low Risk

```text
Главная причина:
Сильных риск-сигналов не найдено.

Что это значит:
По доступным данным адрес выглядит допустимым. Это не гарантия полной чистоты, но явных оснований для отказа система не нашла.
```

If coverage is weak:

```text
Что это значит:
Явных рисков не найдено, но данных мало. Результат лучше считать предварительным или отправить на ручную проверку.
```

## Implementation Notes

The implementation plan should cover:

1. deduplicating final Telegram messages;
2. adding preliminary/final/final-with-limitations states;
3. rewriting `formatUnifiedAddressFinalReport` copy;
4. making beta/internal diagnostics compact;
5. translating hard-evidence, coverage, confidence, and limitation phrases into Russian;
6. adding tests for message lifecycle and representative scoring scenarios.

Minimum test scenarios:

- hard evidence sets final risk to `95/100`;
- weighted context score is lower than final risk, and the message explains why;
- Where Is Money finishes before DeepCheck and sends preliminary, not final;
- DeepCheck later adds context and final is sent once;
- behavior-only risk is explained as context, not proof;
- weak coverage prevents a confident `ACCEPT`;
- beta/internal hides unused zero thresholds.

## Acceptance Criteria

The feature is done when:

- one address request cannot send two messages titled `Проверка адреса — итог`;
- preliminary results are clearly marked;
- the final message explains the final risk in Russian;
- hard evidence is explained as the reason for a pinned high score;
- behavior risk is not described as proof;
- partial coverage is described as a limitation, not as a system failure;
- beta/internal remains available but compact.

