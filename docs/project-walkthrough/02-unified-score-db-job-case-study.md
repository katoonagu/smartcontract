# Unified Wallet Risk Score: проверка на существующих jobs из БД

Дата прогона: 2026-06-04.

Источник данных: локальная PostgreSQL БД, таблица `forensic_check_jobs`.

Что взяли:

- последние `where_is_money_check` jobs со статусом `completed` или `partial`;
- последние `address_deep_check` jobs со статусом `completed` или `partial`;
- `fastRiskSnapshot` из `progress_json`, если он был сохранен в job.

Важно: это прогон по уже существующим jobs из БД. Мы не создавали новые forensic jobs и не перезапрашивали провайдеров. Поэтому отчет показывает, как новая unified scoring formula работает поверх уже сохраненных результатов.

## Что сравниваем

### До unified score

Раньше главным пользовательским числом для режима "откуда деньги" был `whereIsMoneyReport.riskScore`.

Fast Check и Deep Research существовали рядом:

- Fast Check давал быстрый предварительный score;
- Deep Research давал отдельные профили и контекст;
- Where Is Money давал score и решение по происхождению денег.

Проблема: у кошелька не было одной общей объективной оценки, которая аккуратно собирает все три слоя.

### После unified score

Новая формула считает один итоговый wallet risk score:

```text
Fast Check: 10%
Deep Research: 60%
Where Is Money: 30%
```

Дальше применяются правила:

- `hardEvidenceFloor`: если найдено жесткое доказательство, итоговый score не может быть ниже этого уровня;
- `patternFloor`: если найден сильный поведенческий паттерн, score может быть поднят даже без жесткого доказательства;
- `dampener`: снижает score, если риск похож на контекст или нормальное операционное поведение;
- `finalDecision`: если `Where Is Money` уже дал `DECLINE`, unified score не затирает это решение.

## Короткий итог по 3 адресам

| Адрес | До: основной score | Fast | Deep raw | Where raw | Weighted | Dampener | После: final score | Final decision | Что изменилось |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| `TYs4UuvnUHr8D744bURoKWqfNA2TNJEXi7` | 70 | 0 | 45 | 70 | 48 | 0 | 48 | `DECLINE` | Score стал ниже, потому что Where дал policy decline по service boundary, но Deep не нашел жесткое доказательство. Решение `DECLINE` сохранено. |
| `TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe` | 45 | 0 | 65 | 45 | 53 | 15 | 38 | `DECLINE` | Deep видит сильный service exposure, но старый job не содержит новых operational-flow профилей. Dampener снижает контекстный риск. Решение `DECLINE` сохранено. |
| `TPvF4YmjYFVH8jBYUD63mEAxwPssZoL7Jb` | 70 | 25 | 90 | 70 | 78 | 0 | 78 | `DECLINE` | Score стал выше, потому что Deep Research нашел сильный direct counterparty interaction profile на 90, и теперь это влияет на общий score. |

## Кейс 1: `TYs4UuvnUHr8D744bURoKWqfNA2TNJEXi7`

### Jobs

- Where job: `fe93a7da-b0d8-4d0c-a6cd-4e868c0f12da`
- Deep job: `b00083c9-4472-4bcb-ad2d-6a30c49d4b16`
- Оба job имеют статус `partial`.
- Окно проверки: примерно с 2026-05-04 по 2026-06-03.

### Что было до

Основная оценка была:

```text
Where Is Money score: 70
Decision: DECLINE
```

Причина из Where Is Money:

```text
Service boundary reached; drainer proof is not proven, but this service-origin source is declined by policy.
```

То есть старая система говорила: "по режиму происхождения денег это decline на 70".

### Что дали три слоя

Fast Check:

```text
score: 0
level: LOW
```

Fast reasons в старом job не сохранены.

Deep Research:

```text
serviceExposureMax: 45
behaviorDepositDrainMax: 40
behaviorTransitMax: 0
approvalDrainMax: 0
inboundProvenanceMax: 0
counterpartyRiskMax: 0
```

Deep Research видит service exposure и поведенческий паттерн deposit-drain, но не видит жесткое доказательство.

Where Is Money:

```text
score: 70
decision: DECLINE
proofLevel: exchange_policy_decline
```

Where нашел service boundary и применил policy decline.

### Как посчитался unified score

```text
Fast contribution: 0 * 10% = 0
Deep contribution: 45 * 60% = 27
Where contribution: 70 * 30% = 21

Weighted score: 48
Hard evidence floor: 0
Pattern floor: 0
Dampener: 0

Final score: 48
Final level: MEDIUM
Final decision: DECLINE
```

Почему итоговый score ниже старого `70`:

- `70` в Where был policy decline по service boundary;
- это не жесткое доказательство скама или blacklist;
- Deep подтверждает контекст, но не поднимает его до hard evidence;
- unified score не дает policy-контексту автоматически стать критическим score.

Что улучшилось:

- раньше пользователь видел `70` как будто это почти самостоятельная итоговая оценка;
- теперь видно, что риск средний по score, но решение `DECLINE` сохранено из-за policy;
- это честнее: система не обвиняет кошелек как hard bad evidence, но не пропускает его по exchange policy.

## Кейс 2: `TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe`

### Jobs

- Where job: `66b17a37-3566-438f-8cc3-09954374ae35`
- Deep job: `46eda9a9-a27f-4378-89c5-24a60600234b`
- Оба job имеют статус `partial`.
- Окно проверки: примерно с 2026-05-04 по 2026-06-03.

### Что было до

Основная оценка была:

```text
Where Is Money score: 45
Decision: DECLINE
Proof level: insufficient_coverage
```

Причина:

```text
Approval-drain review findings exist but exact benign or drain provenance was not proven.
```

То есть старая система видела проблему, но не давала высокий score, потому что точное происхождение денег и cross-chain corridor не были доказаны.

### Что дали три слоя

Fast Check:

```text
score: 0
level: LOW
```

Fast reasons в старом job не сохранены.

Deep Research:

```text
serviceExposureMax: 65
behaviorDepositDrainMax: 25
behaviorTransitMax: 30
behaviorDampenerMax: 15
directCounterpartyMax: 13
approvalDrainMax: 0
inboundProvenanceMax: 0
counterpartyRiskMax: 0
```

Deep Research видит сильный service exposure и транзитное поведение. Но в этом конкретном сохраненном job нет новых `operationalFlowProfiles`, поэтому исторический bridge/swap outflow не попал в unified score как отдельный pattern floor.

Where Is Money:

```text
score: 45
decision: DECLINE
proofLevel: insufficient_coverage
```

В Where coverage есть важный контекст:

```text
bridgeOutgoingRaw: 1,885,347.47 USDT
bridgeOutgoingShare: 100%
episodeCoverageRatio: 7.1763%
```

Это значит: в найденном drain episode деньги действительно уходили в bridge-like направление, но покрытие выбранной части эпизода было низким. Поэтому Where не поднял это до жесткого доказательства.

### Как посчитался unified score

```text
Fast contribution: 0 * 10% = 0
Deep contribution: 65 * 60% = 39
Where contribution: 45 * 30% = 14

Weighted score: 53
Hard evidence floor: 0
Pattern floor: 0
Dampener: 15

Final score: 38
Final level: MEDIUM
Final decision: DECLINE
```

Почему сработал dampener:

- Deep score высокий из-за service exposure;
- но это не blacklist, не точный scam label и не exact approval drain;
- поведение похоже на операционный/транзитный контекст;
- поэтому система снижает score на 15.

Что улучшилось:

- старая система давала только `45` и не показывала общий вклад Deep Research;
- новая система видит, что Deep layer сильнее Where layer: `65` против `45`;
- решение `DECLINE` не теряется даже после dampener.

Что пока не улучшилось на старом job:

- этот job был создан до новых operational-flow профилей;
- поэтому 1.885M USDT bridge-outflow виден в Where coverage, но не превращается в отдельный unified pattern floor;
- чтобы текущая улучшенная логика полностью сработала на этом адресе, Deep Research нужно перезапустить свежим кодом или добавить fallback, который берет `drainEpisode.bridgeOutgoingRaw` и `bridgeOutgoingShare` из Where report.

## Кейс 3: `TPvF4YmjYFVH8jBYUD63mEAxwPssZoL7Jb`

### Jobs

- Where job: `5b6299e6-e4e2-4a47-b0aa-eb48f7389b41`
- Deep job: `537bc584-75eb-4360-9583-85000cdae51c`
- Оба job имеют статус `partial`.
- Окно проверки: примерно с 2026-05-03 по 2026-06-03.

### Что было до

Основная оценка была:

```text
Where Is Money score: 70
Decision: DECLINE
Proof level: exchange_policy_decline
```

Причина:

```text
Service boundary reached; drainer proof is not proven, but this service-origin source is declined by policy.
```

### Что дали три слоя

Fast Check:

```text
score: 25
level: LOW
```

Fast reasons в старом job не сохранены.

Deep Research:

```text
serviceExposureMax: 0
behaviorDepositDrainMax: 22
behaviorTransitMax: 20
directCounterpartyMax: 90
approvalDrainMax: 0
inboundProvenanceMax: 0
counterpartyRiskMax: 0
```

Главный сигнал здесь не fast и не Where, а Deep Research: direct counterparty interaction profile на `90`.

Where Is Money:

```text
score: 70
decision: DECLINE
proofLevel: exchange_policy_decline
```

Where видит service boundary и policy decline.

### Как посчитался unified score

```text
Fast contribution: 25 * 10% = 3
Deep contribution: 90 * 60% = 54
Where contribution: 70 * 30% = 21

Weighted score: 78
Hard evidence floor: 0
Pattern floor: 0
Dampener: 0

Final score: 78
Final level: HIGH
Final decision: DECLINE
```

Почему итоговый score стал выше старого `70`:

- старая основная оценка смотрела на Where result;
- Deep Research нашел более сильный риск на уровне counterparty interaction;
- новая формула дала Deep Research больший вес, поэтому общий score вырос до `78`.

Что улучшилось:

- теперь сильный Deep-сигнал не теряется за отдельным отчетом;
- кошелек получает более высокий общий score, потому что один из трех слоев показывает риск `90`;
- это ближе к цели: одна итоговая оценка должна учитывать не только происхождение денег, но и профиль кошелька и его контрагентов.

## Общие выводы

### Что стало лучше

1. Появилась одна общая оценка кошелька.

Раньше было несколько отдельных чисел: fast score, where score, deep profiles. Теперь есть один `finalScore`.

2. Deep Research начал реально влиять на итог.

Это хорошо видно на `TPvF4...`: Where давал `70`, но Deep нашел сигнал `90`, и итог вырос до `78`.

3. Policy context не становится hard evidence.

Это видно на `TYs4...`: Where дал `70` по policy decline, но unified score стал `48`, потому что жесткого доказательства нет.

4. Решение `DECLINE` больше не затирается.

Даже если итоговый score ниже `60`, если `Where Is Money` уже дал `DECLINE`, финальное решение остается `DECLINE`.

Это важно для кейсов `TYs4...` и `TLh...`.

5. Нашли и исправили совместимость со старыми jobs.

Существующие `address_deep_check` jobs из БД могли не содержать новых массивов:

```text
boundaryExposureProfiles
walletRoleProfiles
operationalFlowProfiles
directCounterpartyInteractionProfiles
```

До исправления unified scorer падал на таких jobs. Теперь он читает отсутствующие массивы как пустые и может считать старые записи.

### Что пока остается проблемой

1. Старые fast snapshots неполные.

В этих jobs `fastRiskSnapshot` содержит только:

```text
score
level
```

Но не содержит `reasons`.

Из-за этого старые jobs не позволяют восстановить fast hard evidence. Новые jobs уже должны сохранять `reasons`, но исторические записи останутся ограниченными.

2. Старые Deep jobs не содержат новые operational-flow профили.

Это особенно важно для `TLhVzk...`.

Where report показывает:

```text
bridgeOutgoingRaw: 1,885,347.47 USDT
bridgeOutgoingShare: 100%
```

Но unified scorer не поднял pattern floor, потому что сохраненный Deep job не содержит `operationalFlowProfiles`.

3. Cross-chain Stage 2 часто был partial.

В `TLhVzk...` и `TPvF4...` есть notes с `Range API 429`. Это значит, что cross-chain corridor не был полностью подтвержден провайдером.

4. Для старых jobs результат "после" не равен полноценному fresh-run текущей системы.

Это не новая проверка блокчейна, а пересчет новой формулы поверх старых сохраненных результатов. Для полноценной проверки нужно заново прогнать Deep Research и Where Is Money текущим кодом.

## Что стоит улучшить дальше

### 1. Добавить fallback pattern floor из Where drain episode

Для кейса `TLhVzk...` полезно, чтобы unified scorer смотрел не только на `deepReport.operationalFlowProfiles`, но и на `whereReport.coverage.drainEpisode`.

Например:

```text
if drainEpisode.bridgeOutgoingShare is high
and drainEpisode.bridgeOutgoingRaw is large
and selected/episode coverage is enough
then add pattern floor
```

Но это нужно делать аккуратно:

- не считать любой bridge как scam;
- учитывать coverage;
- учитывать объем;
- учитывать долю bridge-outflow;
- не поднимать до `CRITICAL` без hard evidence.

### 2. Перезапустить Deep Research для важных исторических jobs

Старые jobs не содержат новые поля. Для важных адресов нужно сделать fresh rerun:

```text
address_deep_check
where_is_money_check
fast_check snapshot with reasons
```

После этого unified score будет честнее.

### 3. Сохранять полный scoring breakdown в result_json

Нужно сохранять:

```text
fast raw score
deep raw score
where raw score
weighted score
hard evidence floor
pattern floor
dampener
final score
final decision
```

Тогда админка и документация смогут показывать не только итог, но и объяснение.

### 4. Для partial coverage явно показывать "score may be understated"

Если Range API, Tronscan или enrichment не завершились, отчет должен прямо говорить:

```text
Coverage partial: score may be understated.
```

Это особенно важно для `TLhVzk...`, где cross-chain Stage 2 не завершился из-за provider errors.

