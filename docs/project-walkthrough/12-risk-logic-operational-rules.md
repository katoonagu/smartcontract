# Риск-Логика: Как Мы Принимаем Решение

## Зачем Эта Глава

Глава про итоговый риск уже объясняет общую идею:

```text
FastCheck, DeepCheck и Where is money дают разные сигналы.
Система собирает их в один итоговый риск.
```

Эта глава глубже объясняет практические правила.

Она отвечает на вопросы:

- почему риск не считается простым средним;
- какие факты сильнее других;
- что делать с `n/a` и `unknown`;
- почему `partial` не равен плохому кошельку;
- когда нужен review;
- как объяснять решение в продукте и админке.

Главная мысль:

```text
Риск - это не просто число.
Риск - это вывод по силе доказательств и полноте данных.
```

## Простая Модель Решения

Система должна ответить на четыре вопроса:

1. Что мы точно знаем?
2. Что мы только предполагаем по паттерну?
3. Чего мы не смогли проверить?
4. Какое решение можно честно принять?

Пример:

```text
Адрес в blacklist.
Это сильный факт.
Даже если остальные данные неполные, риск высокий.
```

Другой пример:

```text
Адрес много переводит через DEX и bridge.
Это тревожный паттерн.
Но без точного scam, blacklist или грязного source это не то же самое, что жесткое доказательство.
```

## Три Уровня Уверенности

Риск-логика должна различать три уровня.

### Уровень 1. Жесткий Факт

Это то, что нельзя растворить в среднем score.

Примеры:

- активный blacklist на самом адресе;
- точная scam-метка;
- точная stolen funds метка;
- санкционный источник;
- подтвержденная связь с drain-эпизодом;
- проверяемая сумма пришла из источника, который по правилам нельзя принимать.

Как читать:

```text
Если есть жесткий факт, итоговый риск должен быть высоким даже при спокойных остальных слоях.
```

### Уровень 2. Сильный Паттерн

Это не один жесткий факт, но поведение выглядит опасно.

Примеры:

- деньги быстро проходят через кошелек без нормальной паузы;
- много входов и выходов почти сразу;
- крупные суммы идут через bridge, DEX или router;
- несколько соседних кошельков повторяют один и тот же маршрут;
- деньги дробятся и собираются обратно;
- source path постоянно уходит в unknown contracts.

Как читать:

```text
Сильный паттерн может поднять риск до HIGH.
Но без жесткого факта он не должен автоматически становиться CRITICAL.
```

### Уровень 3. Слабый Контекст

Это фоновые признаки.

Примеры:

- кошелек однажды взаимодействовал с DEX;
- есть дальний контакт с сервисом;
- рядом есть неизвестные адреса;
- часть истории выглядит активной, но без явного плохого источника;
- service exposure есть, но не видно, что именно проверяемые деньги пришли оттуда.

Как читать:

```text
Слабый контекст помогает аналитику, но не должен один ломать решение.
```

## Почему Нельзя Складывать Все Одинаково

Если сложить все сигналы одинаково, система будет ошибаться.

Плохой вариант:

```text
Blacklist: +90
Обычная биржа: -30
Много обычных переводов: -20
Итог стал средним.
```

Так делать нельзя.

Почему:

```text
Blacklist не становится менее важным только потому, что у кошелька есть обычные переводы.
```

Правильная логика:

```text
Сначала ищем сильные факты.
Потом смотрим сильные паттерны.
Потом учитываем слабый контекст.
Потом проверяем coverage.
```

## Что Такое Score

Score - это число от 0 до 100.

Упрощенная шкала:

```text
0-29   LOW
30-59  MEDIUM
60-84  HIGH
85-100 CRITICAL
```

## Numeric Rules We Can Safely Say

This section lists only rules confirmed by code or tests.

| Rule | What it means | Evidence |
| --- | --- | --- |
| Unified wallet risk bands are `0-29 LOW`, `30-59 MEDIUM`, `60-84 HIGH`, `85-100 CRITICAL`. | The score band changes at `30`, `60`, and `85`. | `src/risk/unifiedWalletRisk.ts`; `tests/risk/unifiedWalletRisk.test.ts` |
| Unified wallet user decision declines at `finalScore >= 60`. | Scores below `60` are `ACCEPTABLE`; scores `60` and above are `DECLINE`, except hard evidence floor `>= 85` also forces `DECLINE`. | `src/risk/unifiedWalletRisk.ts`; `tests/risk/unifiedWalletRisk.test.ts` |
| FastCheck, DeepCheck, and Where is money weights are `10%`, `60%`, and `30%` when all are available. | Missing layers are excluded before weights are normalized. | `src/risk/unifiedWalletRisk.ts`; `tests/risk/unifiedWalletRisk.test.ts` |
| No-hard-evidence wallet risk is capped at `84`. | Context and non-hard floors can reach `HIGH`, but not `CRITICAL`, without hard evidence. | `src/risk/unifiedWalletRisk.ts`; `tests/risk/unifiedWalletRisk.test.ts` |
| Limited coverage creates a `30` minimum. | Very limited data should not look confidently clean. | `src/risk/unifiedWalletRisk.ts`; `tests/risk/unifiedWalletRisk.test.ts` |
| Source-policy decline creates a floor from `70` to `84`. | A policy reason should not disappear inside the layer average. | `src/risk/unifiedWalletRisk.ts`; `tests/risk/unifiedWalletRisk.test.ts` |
| Verified/known asset continuation creates a floor only when score is `>= 65`, capped at `84`. | Unknown token quality is not enough for this floor. | `src/risk/unifiedWalletRisk.ts`; `tests/risk/unifiedWalletRisk.test.ts` |
| Strong pattern floors require score `>= 60`. | Historical transit, drain-episode transit, and route-linked approval context can lift risk to `HIGH` without becoming hard evidence. | `src/risk/unifiedWalletRisk.ts`; `tests/risk/unifiedWalletRisk.test.ts` |
| Applied dampener is capped at `25`. | Dampening can reduce context above the strongest floor, but cannot erase the floor. | `src/risk/unifiedWalletRisk.ts`; `tests/risk/unifiedWalletRisk.test.ts` |
| Exact taint is at least `90`; exact approval-drain policy decision is at least `95`. | Exact bad evidence produces `DECLINE` for both internal and user decisions. | `src/risk/riskPolicyEngine.ts`; `tests/risk/riskPolicyEngine.test.ts` |
| HTX/Huobi source-policy risk declines at score `>= 60`. | Below `60`, internal decision is `REVIEW` and user decision is `ACCEPTABLE`; at or above `60`, both decline. | `src/risk/riskPolicyEngine.ts`; `tests/risk/riskPolicyEngine.test.ts` |
| WhiteBIT source-policy context has score floor `35` and user `DECLINE`. | It is source-policy context, not scam or drain proof. | `src/risk/riskPolicyEngine.ts`; `tests/risk/riskPolicyEngine.test.ts` |
| Source bundle unresolved boundary needs affected share `>= 10%` after budget exhaustion. | Smaller unresolved material shares do not create the unresolved boundary record. | `src/forensics/sourceBundleExposure.ts`; `tests/forensics/sourceBundleExposure.test.ts` |
| Source bundle unresolved floors are risky-label `70`, HTX/Huobi `60`, bridge/router/DEX `55`, unknown-contract `45`, unknown `35`. | These are score floors for coverage-limited unresolved source boundaries. | `src/forensics/sourceBundleExposure.ts`; `tests/forensics/sourceBundleExposure.test.ts` |

Score нужен, чтобы быстро сравнивать проверки.

Но score без объяснения опасен.

Правильный вывод должен выглядеть так:

```text
Score: 72 / HIGH
Decision: DECLINE
Причина: source path связан с high-risk address.
Coverage: достаточно для решения.
```

А не так:

```text
Score: 72
```

## Что Такое Decision

Decision - это практическое решение.

Внутренне можно думать так:

```text
ACCEPTABLE - по доступным данным можно принимать.
REVIEW - нужен ручной разбор.
DECLINE - принимать нельзя или крайне нежелательно.
UNKNOWN - данных не хватает для честного решения.
```

Важно:

```text
Decision не должен прятать причину.
```

Если система пишет `DECLINE`, аналитик должен видеть почему:

- blacklist;
- source risk;
- policy rule;
- strong pattern;
- недостаточное coverage для критичного пути;
- ручной review требуется из-за missing checks.

## Что Такое `n/a`

`n/a` значит:

```text
К этому месту нет применимого значения.
```

Пример:

```text
У job нет выбранной суммы.
Тогда amount-specific source risk может быть n/a.
```

`n/a` не должен выглядеть как нормальный низкий риск.

Плохое отображение:

```text
Risk: n/a / unknown
Decision: unknown
```

и больше ничего.

Хорошее отображение:

```text
Risk: n/a
Почему: этот режим не считает итоговый wallet risk.
Что смотреть: graph, top services, missing checks.
```

## Что Такое `unknown`

`unknown` значит:

```text
Система не может честно назвать итог.
```

Причины:

- не хватило данных;
- главный provider не ответил;
- source path не загрузился;
- blacklist не проверился;
- режим строит только графовый контекст;
- проверка завершилась partial до risk stage;
- result старого формата не содержит финального score.

`unknown` - это не LOW.

Правильная трактовка:

```text
Unknown значит "решение не доказано".
```

Если unknown появляется часто, это продуктовая проблема. Нужно показывать причину и следующий шаг.

## Чем Отличаются Status И Risk

Status job говорит, как выполнилась работа.

Risk говорит, насколько опасен кошелек или деньги.

Примеры:

```text
completed + LOW
Проверка завершилась, риск низкий.
```

```text
completed + HIGH
Проверка завершилась, риск высокий.
```

```text
partial + MEDIUM
Проверка частично завершилась, но нашла средний риск.
```

```text
partial + unknown
Проверка собрала часть данных, но итоговый риск честно не посчитан.
```

```text
failed + n/a
Проверка не дала usable результат. Ее нельзя использовать как risk decision.
```

Это важно для админки.

Нельзя делать так, чтобы `PARTIAL` визуально выглядел как risk level. Это разные вещи.

## Как Coverage Влияет На Риск

Coverage не должно придумывать риск.

Но coverage влияет на уверенность.

Пример 1:

```text
Путь денег подтвержден.
Сумма пришла из high-risk source.
Coverage хорошее.
Decision: DECLINE.
```

Пример 2:

```text
Путь денег оборвался на втором шаге.
Сильного риска не найдено.
Но главный source не проверен.
Decision: REVIEW или UNKNOWN, а не уверенный ACCEPTABLE.
```

Пример 3:

```text
FastCheck чистый.
DeepCheck не запустился.
Where is money partial.
Итог нельзя подавать как полноценный чистый вывод.
```

Правило:

```text
Неполные данные не делают кошелек грязным.
Но они снижают уверенность в чистом решении.
```

## Когда Нужен Review

Review нужен, если система не может честно принять или отклонить автоматически.

Типичные случаи:

- есть крупная сумма, но source path оборвался;
- есть подозрительный паттерн, но нет жесткого доказательства;
- найден service exposure, но непонятно, относится ли он к проверяемым деньгам;
- provider не отдал ключевую часть истории;
- bundle слишком крупный и не раскрыт;
- есть conflicting signals;
- старый job не содержит новых полей risk;
- в админке виден `unknown`, но проверка важная.

Review - это не провал.

Это нормальная честная остановка:

```text
Автоматика дошла до границы уверенности.
Дальше нужен человек или повторная проверка.
```

## Когда Можно Принимать

Автоматически принимать можно только когда:

- проверка завершилась достаточно полно;
- нет blacklist;
- нет точной scam или stolen funds метки;
- нет high-risk source;
- нет сильного риск-паттерна;
- source path не оборвался в критичном месте;
- missing checks не затрагивают главный вывод;
- итоговый risk ниже порога отклонения.

Формулировка должна быть осторожной:

```text
По доступным данным сильный риск не найден.
```

Не надо писать:

```text
Кошелек чистый навсегда.
```

Проверка - это снимок на момент запуска.

## Когда Надо Отклонять

Отклонять надо, если есть сильная причина.

Примеры:

- сам адрес в blacklist;
- проверяемые деньги пришли из плохого источника;
- есть точная risk label по адресу или source;
- есть policy floor;
- есть доказанный drain или scam path;
- поведение настолько сильное, что риск выше допустимого порога.

В хорошем интерфейсе решение `DECLINE` должно сразу отвечать:

```text
Что нашли?
Где нашли?
Это относится к самому адресу или к конкретным деньгам?
Насколько полные данные?
```

## Почему Where is money Не Заменяет DeepCheck

Where is money отвечает на вопрос:

```text
Откуда пришла конкретная сумма?
```

DeepCheck отвечает на другой вопрос:

```text
Что это за кошелек и какое у него окружение?
```

Пример:

```text
Конкретный депозит пришел из нормального источника.
Но сам кошелек исторически много ходит через risky bridge.
```

Where is money может быть спокойным, а DeepCheck тревожным.

Обратный пример:

```text
Кошелек обычно выглядит нормальным.
Но конкретный депозит пришел из плохого source path.
```

DeepCheck может быть спокойным, а Where is money тревожным.

Именно поэтому итоговый риск должен сохранять объяснение по слоям.

## Почему FastCheck Не Должен Решать Все Один

FastCheck нужен первым.

Он быстро отвечает:

```text
Есть ли очевидный красный флаг?
```

Но FastCheck ограничен:

- он не строит полный source path;
- он не обязан смотреть всю историю;
- он может не увидеть дальний риск;
- он может не отличить слабый контекст от происхождения конкретных денег.

Поэтому FastCheck хорошо подходит для:

- первого фильтра;
- подсветки важных соседей;
- быстрого blacklist и labels;
- стартовой картины.

Но финальное решение по крупной сумме должно учитывать Where is money и DeepCheck.

## Как Это Должно Выглядеть В Админке

Админка должна показывать не только число.

Минимальный набор:

- job status;
- mode;
- score;
- level;
- decision;
- главный risk reason;
- coverage;
- missing checks;
- какие слои участвовали;
- какие слои отсутствуют;
- hard evidence, если есть;
- boundary, если путь оборвался;
- где смотреть доказательство на графе.

Если risk `unknown`, админка должна показывать причину:

```text
Unknown because: source path incomplete.
Next step: rerun Where is money or open boundary group.
```

Если risk `n/a`, админка должна показывать:

```text
N/a because: this job is graph/context only.
Use it for investigation, not final decision.
```

## Как Объяснять Инвестору Или Партнеру

Не надо объяснять через внутренние поля.

Хорошая формулировка:

```text
Мы не просто проверяем адрес по blacklist.
Мы разделяем точные доказательства, поведенческие паттерны и неполные данные.
Сильные факты не растворяются в среднем score.
Если данных не хватает, система не выдумывает чистоту, а показывает coverage и отправляет на review.
```

Это важная продуктовая защита.

Она снижает две ошибки:

- принять рискованные деньги, потому что слабые спокойные сигналы разбавили сильный факт;
- отклонить нормальный кошелек, потому что слабый контекст был раздут до критического риска.

## Практические Примеры

### Пример 1. Blacklist На Самом Адресе

```text
FastCheck нашел blacklist.
DeepCheck partial.
Where is money не запущен.
```

Вывод:

```text
Риск высокий или критический.
Нельзя ждать, что partial DeepCheck "размоет" blacklist.
```

### Пример 2. Чистый FastCheck, Но Плохой Source

```text
Сам адрес без blacklist.
Прямые соседи выглядят нормально.
Where is money нашел плохой источник проверяемой суммы.
```

Вывод:

```text
Риск по конкретным деньгам высокий.
Даже если профиль кошелька выглядит спокойнее, сумма проблемная.
```

### Пример 3. Много Service Exposure

```text
Кошелек ходил через DEX, bridge и router.
Но проверяемая сумма не доказано пришла оттуда.
```

Вывод:

```text
Это контекст для DeepCheck.
Он может поднять риск, но не равен доказанному грязному source.
```

### Пример 4. Partial На Главном Пути

```text
Where is money начал trace.
Provider не отдал историю ключевого sender.
Сильного риска не найдено.
```

Вывод:

```text
Нельзя уверенно принимать.
Нужен review или повторная проверка.
```

### Пример 5. Старый Job С `n/a`

```text
В админке старый job показывает risk n/a / unknown.
Граф есть, но финальный score не сохранен.
```

Вывод:

```text
Это не значит, что риск низкий.
Это значит, что старый job не содержит полноценного итогового risk.
Для решения нужен новый прогон или ручное чтение графа.
```

## Короткая Формулировка Для Команды

Риск-логика должна быть честной:

```text
Сильные факты сильнее среднего score.
Паттерны важны, но не равны доказательству.
Coverage влияет на уверенность.
Partial не делает кошелек плохим.
Unknown не делает кошелек чистым.
n/a должно объяснять, почему risk не применим.
```

Если система не может доказать решение, она должна показать причину и отправить на review, а не скрывать неопределенность за аккуратным числом.
