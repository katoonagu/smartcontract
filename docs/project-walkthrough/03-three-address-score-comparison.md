# Сравнение score по 3 адресам: baseline vs current unified scoring

Дата проверки: 2026-06-05.

Источник данных: существующие jobs из PostgreSQL, таблица `forensic_check_jobs`.

Адреса:

- `TYs4UuvnUHr8D744bURoKWqfNA2TNJEXi7`
- `TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe`
- `TPvF4YmjYFVH8jBYUD63mEAxwPssZoL7Jb`

Важно: это не live-прогон новых blockchain-запросов. Мы взяли последние сохраненные `where_is_money_check` и `address_deep_check` jobs со статусом `completed` или `partial` и прогнали их через текущий `calculateUnifiedWalletRisk`.

## Что сравниваем

`До` в этой таблице означает baseline до новых floor-правил v1.1:

- слои складываются по весам;
- если есть `dampener`, он снижает контекстный score;
- новые `policyFloor`, `assetContinuationFloor`, `hardEvidenceFloor` и `patternFloor` не поднимают итог.

Это не отдельный запуск старой версии кода. Это реконструкция старой логики поверх тех же сохраненных отчетов.

`После` означает текущий итоговый `finalScore` из `calculateUnifiedWalletRisk`.

Факт из кода:

- веса слоев: Fast Check `10%`, Deep Research `60%`, Where Is Money `30%` (`src/risk/unifiedWalletRisk.ts:60-62`);
- если слой отсутствует, scorer нормализует веса только по доступным слоям (`src/risk/unifiedWalletRisk.ts:396-470`);
- `finalScore` берется как максимум между контекстным score и floor-правилами (`src/risk/unifiedWalletRisk.ts:602-617`);
- если нет hard evidence, итоговый score режется сверху до `84` (`src/risk/unifiedWalletRisk.ts:617`);
- `finalDecision` остается `DECLINE`, если `whereReport.userDecision` уже `DECLINE`, даже если число score ниже `60` (`src/risk/unifiedWalletRisk.ts:618-620`).

## Короткий итог

| Адрес | Jobs | Baseline до floors | Current final | Разница | Почему |
|---|---|---:|---:|---:|---|
| `TYs4UuvnUHr8D744bURoKWqfNA2TNJEXi7` | where `partial`, deep `partial` | `48 MEDIUM / DECLINE` | `70 HIGH / DECLINE` | `+22` | Where дал `source-policy decline` на `70`. Новая логика не дает этому сигналу раствориться в весе `30%`. |
| `TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe` | where `partial`, deep `partial` | `43 MEDIUM / DECLINE` | `43 MEDIUM / DECLINE` | `0` | Есть deep-контекст на `65`, но нет hard/policy/asset/pattern floor. Dampener `15` снизил baseline `58 -> 43`. |
| `TPvF4YmjYFVH8jBYUD63mEAxwPssZoL7Jb` | where `partial`, deep `partial` | `83 HIGH / DECLINE` | `83 HIGH / DECLINE` | `0` | Deep уже дает сильный raw score `90`, поэтому weighted baseline выше policy floor `70`. |

## Как читать score

Сейчас scorer хранит несколько чисел:

- `weightedLayerScore`: взвешенная сумма доступных слоев;
- `contextScore`: `weightedLayerScore` после `dampener` и correction по coverage;
- `policyFloor`: нижний порог по policy-сигналам Where Is Money;
- `assetContinuationFloor`: нижний порог по продолжению движения в verified TRC20 asset;
- `hardEvidenceFloor`: нижний порог по жестким доказательствам;
- `patternFloor`: нижний порог по сильным поведенческим паттернам;
- `finalScore`: итоговый score, который берет максимум из контекста и floors.

Простыми словами: раньше сильный сигнал мог стать слабее из-за веса слоя. Например Where score `70` при весе `30%` превращался примерно в `21` contribution. Теперь, если это policy decline, итоговый score не может упасть ниже policy floor.

## Кейс 1: `TYs4UuvnUHr8D744bURoKWqfNA2TNJEXi7`

Jobs:

- Where job: `fe93a7da-b0d8-4d0c-a6cd-4e868c0f12da`, status `partial`;
- Deep job: `b00083c9-4472-4bcb-ad2d-6a30c49d4b16`, status `partial`.

Слои:

```text
Fast raw: 0
Deep raw: 45
Where raw: 70

weightedLayerScore: 48
dampener: 0
contextScore: 48
policyFloor: 70
finalScore: 70
finalDecision: DECLINE
```

Почему baseline был `48`:

```text
Fast: 0 * 10% = 0
Deep: 45 * 60% = 27
Where: 70 * 30% = 21
Итого: 48
```

Почему current score стал `70`:

- Where Is Money сохранил `sourcePolicyEvidence`;
- top policy evidence: `kind = bridge_router_dex`, `score = 70`, `proofLevel = exchange_policy_decline`;
- scorer применил `where_source_policy_floor`;
- policy floor в коде ставит score минимум `70` и максимум `84` для такого класса evidence (`src/risk/unifiedWalletRisk.ts:246-274`).

Факт из сохраненного отчета: это не доказательство scam/drain. Это policy decline на service/source boundary. Поэтому `hardEvidenceFloor = 0`, но `policyFloor = 70`.

Продуктовый смысл: адрес не получает `70` потому что “точно скам”. Он получает `70`, потому что система дошла до сервисной границы, где чистое происхождение денег не доказано, а policy говорит decline.

## Кейс 2: `TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe`

Jobs:

- Where job: `66b17a37-3566-438f-8cc3-09954374ae35`, status `partial`;
- Deep job: `46eda9a9-a27f-4378-89c5-24a60600234b`, status `partial`.

Слои:

```text
Fast: not available in saved job
Deep raw: 65
Where raw: 45

weightedLayerScore: 58
dampener: 15
contextScore: 43
policyFloor: 0
assetContinuationFloor: 0
patternFloor: 0
hardEvidenceFloor: 0
finalScore: 43
finalDecision: DECLINE
```

Почему weighted score `58`, а не `65 * 60% + 45 * 30%`:

- Fast Check в этом saved job отсутствует;
- scorer нормализует веса по доступным слоям;
- доступны только Deep и Where;
- Deep фактически получает `60 / 90` веса, Where получает `30 / 90`.

Почему score снизился до `43`:

- `weightedLayerScore = 58`;
- `dampener = 15`;
- `contextScore = 58 - 15 = 43`.

Факт из кода: dampener берется из негативных fast-reasons, behavior dampener в Deep Research и wallet role в Where Is Money. Потом dampener режется: максимум `25`, и он не может опустить score ниже активного floor (`src/risk/unifiedWalletRisk.ts:538-568`).

Почему current score не вырос:

- в сохраненном deep job нет `assetContinuationProfiles`;
- нет `stablecoinRestrictionProfiles` с blacklist;
- нет policy evidence из Where;
- нет hard evidence;
- нет pattern floor.

Поэтому новая scoring architecture здесь ничего не поднимает. Она видит контекстный риск, но не видит floor-сигнал, который должен закрепить итог выше.

Это важный кейс для улучшения Deep Research: если по адресу реально был большой исторический вывод через bridge/swap/router/DEX или verified token continuation, это должно попадать в `operationalFlowProfiles` и/или `assetContinuationProfiles`, иначе общий score остается слишком мягким.

## Кейс 3: `TPvF4YmjYFVH8jBYUD63mEAxwPssZoL7Jb`

Jobs:

- Where job: `5b6299e6-e4e2-4a47-b0aa-eb48f7389b41`, status `partial`;
- Deep job: `537bc584-75eb-4360-9583-85000cdae51c`, status `partial`.

Слои:

```text
Fast: not available in saved job
Deep raw: 90
Where raw: 70

weightedLayerScore: 83
dampener: 0
contextScore: 83
policyFloor: 70
finalScore: 83
finalDecision: DECLINE
```

Почему baseline уже высокий:

- Fast отсутствует, поэтому веса нормализуются между Deep и Where;
- Deep raw `90` дает contribution `60`;
- Where raw `70` дает contribution `23`;
- итого `83`.

Почему policy floor не изменил score:

- policy floor равен `70`;
- weighted/context score уже `83`;
- `finalScore` берет максимум, поэтому остается `83`.

Факт из сохраненного отчета:

- top reason: `where_source_policy_floor`;
- top policy evidence: `kind = bridge_router_dex`, `score = 70`, `proofLevel = exchange_policy_decline`;
- Deep layer дал raw `90` по `address behavior profile` и `direct counterparty interaction profile`.

Продуктовый смысл: здесь новая policy floor есть, но она не нужна для повышения числа. Адрес и так выходит в высокий риск из-за Deep Research.

## Что улучшилось

1. Where policy decline больше не размывается весом.

До: Where score `70` мог дать только `21` contribution.

После: если это source-policy decline, итоговый score не падает ниже `70`.

2. Decision и score стали честнее разделены.

Пример `TLh...`: score `43`, но decision `DECLINE`. Это не ошибка расчета. Так работает код: если Where Is Money уже вернул `userDecision = DECLINE`, unified scorer сохраняет это решение (`src/risk/unifiedWalletRisk.ts:618-620`).

3. Сильный Deep Research может сам поднять общий score.

Пример `TPv...`: Deep raw `90` поднимает общий weighted/context score до `83` даже без hard evidence.

## Что пока не улучшилось

1. Старые saved jobs не показывают весь эффект новой Deep Research assembly.

В этих трех job `assetContinuationProfiles = 0`. Поэтому новый `assetContinuationFloor` не сработал ни разу.

2. Для `TLh...` проблема остается.

По продуктовой логике мы ожидаем, что большой исторический прогон через bridge/swap/router/DEX должен сильнее влиять на итоговый риск. Но в сохраненном job нет такого floor-сигнала. В текущем расчете это остается просто deep-контекстом, который dampener может снизить.

3. `partial` coverage ограничивает уверенность.

Все три пары jobs имеют статус `partial`. Это значит, что отчет полезен для сравнения scorer logic, но не является финальной forensic truth по адресам.

## Вывод

Текущая v1.1 formula решила одну важную проблему: policy decline и сильные evidence-floors больше не теряются внутри весов.

Но для кейса `TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe` главный разрыв остается в Deep Research detector coverage. Если Deep не собрал `operationalFlowProfiles` или `assetContinuationProfiles`, итоговый unified score не сможет объективно закрепить высокий риск только по историческому выводу через bridge/swap/router/DEX.

Следующий практический шаг: прогнать эти же три адреса live после текущих изменений Deep detector assembly и сравнить уже не только scorer formula, а полную цепочку `data collection -> detectors -> unified score`.

## Phase 2 first step: live-source operational flow fallback

Дата изменения: 2026-06-05.

Что нашли после сравнения:

- для `TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe` saved job не содержит `operationalFlowProfiles`;
- local operational CLI по 60-дневному окну не нашел indexed TRON USDT transfers для этого адреса;
- значит текущая historical-flow логика могла не сработать, если local USDT index пустой, даже когда live TronScan source transfers уже были получены Deep Research.

Что изменили:

- Deep Research теперь передает live `sourceTransfers.edges` в сборку operational profiles;
- `operationalFlowProfiles` строится не только из local indexed USDT transfers, но и из уже полученных live source transfers;
- local index по-прежнему нужен для multi-hop boundary search, но direct historical flow больше не пропадает полностью из-за пустого index.

Факт из кода:

- fallback добавлен в `buildOperationalIndexedProfiles` через параметр `sourceEdges` (`src/check/deepForensicCheck.ts:360`);
- `runDeepAddressForensicCheck` передает туда `sourceTransfers.edges` (`src/check/deepForensicCheck.ts:1280`);
- тест фиксирует кейс “local index empty, live source transfers есть” (`tests/check/deepForensicCheck.test.ts:625`).

Что это меняет для будущих прогонов:

- если Deep Research видит live входящий USDT и live исходящий USDT в bridge/swap/router/DEX или unknown contract, он сможет создать `operationalFlowProfiles`;
- если профиль достаточно сильный, unified scorer уже умеет поднять `patternFloor` через `historicalTransitPatternFloor`;
- это не делает любой bridge/swap автоматически high-risk: scorer смотрит объем, pass-through и долю service/contract outflow.

Чего это еще не решает:

- saved jobs в БД не пересчитываются автоматически;
- all-token operational flow пока не смешивается в `operationalFlowProfiles`, чтобы не сравнивать raw amounts разных токенов как один и тот же объем;
- verified token continuation остается отдельным сигналом через `assetContinuationProfiles` и `assetContinuationFloor`.
