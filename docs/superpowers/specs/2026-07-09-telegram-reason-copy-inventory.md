# Инвентарь Telegram-текстов причин и риск-сигналов

Дата: 2026-07-09

Цель: собрать все текущие пользовательские варианты текста, которые бот может показать в проверках адреса, происхождения средств и итогового скоринга, чтобы потом спокойно отредактировать русский текст без гадания по коду.

## Что входит

Основной фокус - сообщения Telegram для:

- FastCheck / старт проверки адреса.
- Where Is Money preliminary.
- DeepCheck compact/full support.
- Unified final address report.
- Invalid/no-final-decision отчет.
- Source-policy, HTX/Huobi, service boundary, approval-drain, blacklist, coverage и cross-chain сигналы.
- Incoming deposit overlay, потому что он использует ту же матрицу и может объяснять HTX/Huobi доли.

Не все строки являются фиксированным словарем. Часть текста приходит из `WhereIsMoneyReport.decisionReasons`, `assessment.reasons`, `assessment.warnings`, `hardBadEvidence.message`, `riskLayers.reasons`, `crossChainCorridor.paths[].reasons/warnings` и проходит в Telegram только через частичный нормализатор.

## Главные источники в коде

- `src/bot/createBot.ts` - сборка Telegram-сообщений.
- `src/alerts/notificationText.ts` - перевод и нормализация причин.
- `src/risk/unifiedWalletRisk.ts` - финальный score, floors, anchors, reasons.
- `src/risk/scoringSignalMatrix.ts` - решение матрицы.
- `src/risk/scoringSignalMatrixInputs.ts` - какие сигналы попадают в матрицу.
- `src/risk/unifiedIncomingDepositRisk.ts` - overlay для входящих депозитов.
- `src/risk/riskPolicyEngine.ts` - policy reasons старого уровня.
- `src/check/whereIsMoneyCheck.ts`, `src/forensics/*` - сырые причины Where/Deep.

## Старт проверки адреса

Если FastCheck не нашел hard evidence, бот не показывает risk-score сразу, а пишет старт проверки.

```text
Проверка адреса - запущена
Адрес: <address>

Что проверяем
- Происхождение текущего USDT-баланса.
- Поведение адреса как дополнительный контекст.

Итоговый риск появится после анализа происхождения средств.
```

Английский вариант:

```text
Address check - started
Address: <address>

What is running
- Origin of the current USDT balance.
- Address behavior as additional context.

Final risk appears after provenance analysis.
```

## FastCheck preliminary

Если FastCheck уже видит hard evidence или есть queued Where/Deep jobs, используется preliminary сообщение.

Заголовок:

- `Проверка адреса - предварительно`
- `Address check - preliminary`

Основные поля:

- `Адрес: <address>` / `Subject: <address>`
- `Риск адреса: <score>/100 (<уровень> / <LEVEL>, beta)`
- `Почему`
- `Дополнительный контекст` - только если есть saved approval-drain marker и поведенческий контекст.
- `Дальше` - queued Where/Deep job IDs.

### FastCheck: варианты "Почему"

Порядок выбора в `meaningLines` - сверху вниз. Показывается первый подходящий смысл.

| Условие | Текущий русский текст |
|---|---|
| USDT blacklist | `Официальный TRON USDT контракт показывает адрес как blacklisted. Это точное состояние контракта, не поведенческая догадка.` |
| Saved exact approval-drain marker | `По адресу есть сохранённое exact approval-drain доказательство: ранее система находила цепочку approve -> transferFrom -> получатель средств.` |
| Exact approval-drain из Deep | `Deep-анализ connected this address to an exact USDT approval-drain flow. This is route-linked provenance evidence, not legal attribution.` через частичный перевод |
| Extended local-index route | `Extended local-index search found a longer on-chain route candidate. Exact labels and boundaries stay separated from weak inference.` через частичный перевод |
| Inbound high-risk source | `Deep-анализ found exact upstream exposure to a labeled high-risk source. Найден дополнительный контекст, но точное плохое доказательство не подтверждено.` |
| High-risk counterparty | `Deep-анализ found direct exposure to a labeled high-risk counterparty. Найден дополнительный контекст, но точное плохое доказательство не подтверждено.` |
| Major direct counterparty high fast risk | `A major direct counterparty has high fast forensic risk. This raises review priority, but it is not exact blacklist/scam proof by itself.` |
| Saved darknet marker | `This address has a saved high-risk marker from exact on-chain exposure to a manually verified darknet exchange seed within 2 hops.` |
| Operational flow | `Deep-анализ found high terminal-liquidity flow through service/CEX/bridge/router boundaries. This is operational laundering-pattern context, not a blacklist/scam claim.` |
| Boundary + wallet role | `Funds touch service-boundary infrastructure where public-chain continuity becomes limited. This is context for manual review, not proof of wrongdoing.` |
| Boundary only | `Funds touch service-boundary infrastructure where public-chain continuity becomes limited. Найден дополнительный контекст, но точное плохое доказательство не подтверждено.` |
| Service + behavior | `This address quickly moved most received USDT into service/router infrastructure. Найден дополнительный контекст, но точное плохое доказательство не подтверждено.` |
| Service only | `Исходящие USDT доходят до service/router/CEX/bridge/contract инфраструктуры. Нужна ручная проверка.` |
| Behavior only | `Адрес похож на быстрый транзит USDT. Это также может быть нормальным поведением operational wallet.` |
| Любой score > 0 без более сильной причины | `Подключенные модули нашли сигналы для проверки. Нужна ручная проверка.` |
| Нет сильных сигналов, Deep queued | `Быстрая проверка пока не нашла сильных сигналов. Deep-анализ может добавить контекст.` |
| Нет сильных сигналов, Deep не queued | `Подключенные проверки не нашли сильных risk-сигналов.` |

### FastCheck: key signals

Эти строки могут попасть в `Главные сигналы` или контекст Deep.

- `Official TRON USDT contract blacklist state is active for this address. Current blocked balance: <amount>.`
- `Funds are connected to an exact approval-drain flow as the first receiver.`
- `Funds are connected to an exact approval-drain flow within <N> hop(s).`
- `Approval-drain route preservation is <percent>.`
- `Extended <direction> search found a <N>-hop exact labeled path to <label>; manual review required.`
- `Extended <direction> search reached <category> boundary; public-chain continuity should not be assumed.`
- `<amount> inbound matched an exact <N>-hop on-chain path from a <label> source.`
- `<amount> <direction> volume is directly connected to <label> counterparty <address>.`
- `<percent> of <direction> volume is connected to counterparty <address> with fast risk <score>/100 (<level>).`
- `Terminal liquidity outgoing: <percent> of outgoing 30d USDT flow.`
- `HTX/Huobi outgoing exposure: <percent> of outgoing 30d flow.`
- `bridge/DEX/router outgoing exposure: <percent> of outgoing 30d flow.`
- `<percent> of outgoing USDT reaches <category> infrastructure via <identity/address>.`
- `Amount preservation on the strongest service route is <percent>.`
- `Unknown contract exposure requires manual review.`
- `<percent> of <outgoing/incoming> USDT touches <category> boundary via <identity/address> within <N> hop(s).`
- `Boundary route preservation is <percent>.`
- `Likely wallet role: <role> (<confidence> confidence, <evidenceStrength> evidence).`
- `<percent> of received USDT was redistributed within ~<duration>.`
- `Top outgoing counterparty <address> received <amount> across <N> transfers (<percent>).`
- Любые `result.report.reasons[].message` из Fast risk engine.

## Where Is Money preliminary

Заголовок:

- `Откуда деньги - предварительный результат`
- `Where Is Money - preliminary result`

Поля:

- `Адрес: <address>`
- `Предварительный риск: <score>/100`
- `Почему`
- `Что дальше`

### Where preliminary: варианты "Почему"

Если есть deterministic hard evidence, первая строка берется из `whereHardEvidenceReasonLines`, но префикс `Жёсткое доказательство:` убирается.

Возможные фиксированные добавки:

- `Проверка “Откуда деньги” нашла <N> hard-proof approval-drain цепочек.`
- `Проверяемый адрес - первый получатель после transferFrom drain.`
- `Проверяемый адрес связан с получателем после transferFrom drain через <N> hop.`

Fallback:

- `Where Is Money завершил предварительную проверку происхождения средств.`

Что дальше:

- `“Откуда деньги” завершено первым; DeepCheck ещё продолжает проверку связей и поведения адреса.`
- `Финальный итог придёт после завершения анализа.`

## Unified final report

Заголовок:

- `Проверка адреса - итог`
- `Address check - final`

Основные поля:

- `Адрес: <address>`
- `Решение: <DECLINE|REVIEW|ACCEPTABLE|NO_FINAL_DECISION> - <объяснение>`
- `Итоговый риск: <score>/100 (<уровень> / <LEVEL>, beta)`
- `Что делать`
- `Почему`
- `Что важно учесть`
- `Cross-chain corridor` - пока только по-английски.
- `Beta/internal` - только при `showBetaDiagnostics`.

### Финальное решение

| Decision | Русское объяснение |
|---|---|
| `DECLINE` | `Адрес нельзя принять автоматически.` |
| `REVIEW` | `Нужна ручная проверка.` |
| `ACCEPTABLE` | `Сильных риск-сигналов не найдено.` |
| `NO_FINAL_DECISION` | Сейчас fallback по-английски: `Final scoring is blocked by incomplete technical coverage.` |

### Что делать

| Decision | Текущие строки |
|---|---|
| `DECLINE` | `Не принимать автоматически.`; `Передать кейс на ручную проверку/compliance.` |
| `REVIEW` | `Нужна ручная проверка.`; `Не принимать автоматически, если сумма существенная.` |
| `ACCEPTABLE` | `Можно принять автоматически в рамках текущей политики.` |
| `NO_FINAL_DECISION` | `Итоговый риск не опубликован: не хватает покрытия.`; `Дождаться индексации или перезапустить проверку после устранения лимита.` |

Дополнительные действия из карточек:

- Approval-drain exact: `Если это клиентский депозит, запросить объяснение происхождения средств.`
- USDT blacklist: `Не принимать автоматически.`
- Clean CEX not fully proven: `Запросить подтверждение источника средств.`
- Acceptable + partial coverage: `При крупной сумме всё равно проверьте ограничения покрытия.`

## Финальные карточки причин

Карточки строятся в `buildFinalReasonCards`, сортируются по priority, затем:

- `Почему` получает `decline` и `review` карточки, затем fallback из `context`, максимум 8 строк.
- `Что важно учесть` получает `context` и `coverage`, кроме `no_hard_evidence`, максимум 5 строк.
- Если часть карточек не показали, добавляется: `Ещё <N> технических сигналов доступны в Admin.`

| kind | Когда появляется | Секция | Текущий русский текст |
|---|---|---|---|
| `approval_drain_exact` | Where/Deep нашел exact approval-drain hard evidence | Почему | `Найдена точная approval-drain цепочка: после approve USDT были списаны через transferFrom, проверяемый адрес получил эти средства.` |
| `approval_drain_exact` с hop > 0 | Exact route, но проверяемый адрес не первый получатель | Почему | `Найдена точная approval-drain цепочка: после approve USDT были списаны через transferFrom, проверяемый адрес связан с получателем через <N> hop.` |
| `approval_drain_saved_marker` | Fast report содержит saved approval-drain marker | Почему или контекст | `Ранее система уже сохраняла этот адрес как связанный с exact approval-drain.` |
| `usdt_blacklist` | Fast/Deep/unified нашел TRC20 USDT blacklist | Почему | `Адрес находится в активном TRC20 USDT blacklist.` |
| `sanctioned_service` | Where hard evidence kind `sanctioned_service` | Почему | Через normalizer: `Маршрут происхождения дошёл до санкционного криптосервиса <service>: <authority>, дата включения <date>. Это санкционный policy-риск; это не доказательство scam/drain.` |
| `hard_bad_evidence` | Deterministic Where hard evidence: `scam_or_blacklist` и прочее | Почему | `normalizeNotificationReason(evidence.message)` или сырой `evidence.message`, если нет правила |
| `technical_signal` from non-deterministic Where evidence | Where `hardBadEvidence` не deterministic | Почему | `normalizeNotificationReason(evidence.message)` или сырой текст |
| `route_linked_approval_pattern` | Matrix/reasons содержит route-linked approval pattern | Почему | `Найден route-linked approval-drain контекст без точного hard-proof списания.` |
| `clean_cex_not_fully_proven` | decision/assessment reasons содержат clean CEX not fully proven | Почему | `Чистый CEX-источник не доказан полностью.` |
| `source_policy_review` materiality dense-hop | `dense_hop_unresolved_below_materiality` | Почему | `Небольшой dense-hop хвост источника остался неразрешённым (<amount> USDT). Он ниже materiality и не использован как доказательство чистоты или риска.` |
| `source_policy_review` residual | `residual_unresolved_below_materiality` | Почему | `Остаточные пробелы в происхождении ниже materiality (<amount> USDT). Это caveat, не финальный блок покрытия.` |
| `source_policy_review` HTX/Huobi selected source | `sourceBundleExposure.htxHuobiShare > 0` | Почему | `HTX/Huobi финансирует <percent> выбранной суммы.` |
| `source_policy_review` historical HTX/Huobi | `subjectExposureProfile.htxHuobiIncomingShare > 0` | Почему | `Историческая связь с HTX/Huobi - это контекст, а не доказательство источника выбранной суммы.` |
| `source_policy_review` unresolved boundary | `sourceBundleExposure.unresolvedBoundary` | Почему | `Граф остановился на материальной границе: <граница>.` |
| `service_boundary` | Deep нашел boundary exposure | Контекст | `Цепочка дошла до биржи или сервиса. Дальше публичная on-chain трассировка ограничена.` |
| `behavior_counterparty` | Deep нашел крупного прямого контрагента с высоким fast risk | Контекст | `Есть поведенческий риск по крупному контрагенту. Это контекст, не доказательство грязных средств.` |
| `behavior_operational_wallet` | Matrix winning row `behavior_only_prior` | Почему или контекст | `Адрес похож на транзитный или операционный кошелёк. Это контекст, не доказательство грязных средств.` |
| `coverage_partial` | Where partial или unified coverage не complete | Контекст | `Проверили <percent>% выбранной суммы: <N> входящих USDT-перевода; это не означает полную историю адреса.` |
| `no_hard_evidence` | `hardEvidenceFloor === 0` | fallback/context | `Жёстких плохих доказательств не найдено.` |
| `matrix_review` | Matrix decision `REVIEW` | Почему | `Итог требует ручной проверки: найден контекстный риск без жёсткого плохого доказательства.` |
| `technical_signal` where source-policy floor | unified reason `where_source_policy_floor` | Почему | `Источник средств достиг source-policy порога для отказа или ручной проверки.` |
| `technical_signal` asset continuation | source `asset_continuation` | Почему | `Найдена cross-chain/asset-continuation связь с рискованным направлением.` |
| `technical_signal` fallback | hard/policy/asset reason без отдельного текста | Почему | `<Источник>: <normalizeNotificationReason(reason.message)>` |

### Unresolved boundary labels

| kind | Русский label |
|---|---|
| `htx_huobi` | `граница источника HTX/Huobi` |
| `bridge_router_dex` | `граница bridge/router/DEX` |
| `unknown_contract` | `граница неизвестного контракта` |
| `unknown` | `неизвестная граница источника` |
| `clean_cex` | `граница источника` |

## Покрытие и coverage строки

`whereCoverageSummaryLine` сейчас смешивает русский и английский.

Русский нормально работает только для дефолтного scope:

- `Проверено <percent>% суммы: <N> входящих USDT-перевода.`

Эти scopes всегда возвращают английский даже при `locale === "ru"`:

- `Checked <percent> of the selected drain episode; anchor coverage <percent>.`
- `Checked <percent> of the selected recent-flow anchor across <N> inbound USDT transfer(s).`
- `Checked recent-flow wallet context; no selected outgoing anchor was available.`

В финальном coverage card это превращается в смешанную строку:

- `Checked 100% of the selected recent-flow anchor across 1 inbound USDT transfer(s); это не означает полную историю адреса.`

Это прямой copy gap для исправления.

Дополнительные limitation строки:

- `<N> путей остановлены из-за слабой связи суммы/времени.`
- `<N> путей остановлены без предыдущего входящего USDT-перевода.`
- `Отчёт готов, но по происхождению остались ограничения.`

## Data trust / clarity строки

Эти строки сейчас чаще показываются в beta/internal или старых вариантах финального отчета.

- `Покрытия достаточно для автоматической проверки, но это не гарантия, что адрес чистый.`
- `Покрытие неполное: итог отражает доступные данные, а не гарантирует чистоту адреса.`
- `Покрытие ограничено: низкий риск означает только отсутствие сильных сигналов в доступных данных.`
- `Часть происхождения или провайдерского покрытия неполная.`
- `Данные частичные; перед итоговым решением проверьте покрытие.`
- `Данные ограничены; это не гарантия чистой истории.`
- `Высокий контекстный риск; жестких доказательств не найдено.`
- `В доступных данных существенный риск не найден; это не гарантия чистой истории.`
- `Покрытие ограничено; проверьте доказательства перед итоговым решением.`

## Почему риск / beta/internal

При `showBetaDiagnostics` бот может показать технические строки:

- `Взвешенная/фоновая оценка: <weighted>; итоговый риск: <final>.`
- `Строка матрицы: <winningRow>; решение матрицы: <matrixDecision>.`
- `Снижение опускает контекст для итогового риска до <score>.`
- `Коррекция из-за покрытия повышает контекст для итогового риска до <score>.`
- `Контекст после коррекции покрытия для итогового риска: <score>.`
- `Жёсткие доказательства поднимают или фиксируют итоговый риск на <score>.`
- `Жёсткого доказательства нет, поэтому контекстный риск ограничен <score>.`
- `Жёстких плохих доказательств не найдено.`
- `Поведенческие и source-policy сигналы - это контекст, не самостоятельное доказательство.`
- `Закреплено сигналом: <code> <score>.`
- `Покрытие: <полное|неполное|ограниченное>.`

Compact beta/internal сейчас остается в основном английским:

- `FastCheck: raw <score>, weight <weight>, normalized contribution <value>.`
- `DeepCheck: raw <score>, weight <weight>, normalized contribution <value>.`
- `Where Is Money: raw <score>, weight <weight>, normalized contribution <value>.`
- `Weighted layer score: <score>.`
- `Matrix row: <row>; matrix decision: <decision>.`
- `Context score after dampener: <score>.`
- `Coverage-adjusted context score: <score>.`
- `Hard evidence floor: <score>.`
- `Policy floor: <score>.`
- `Asset continuation floor: <score>.`
- `Pattern floor: <score>.`
- `Dampener: <score>.`
- `Evidence class: <source>/<code>.`
- `Policy: hard evidence can pin the final risk.`
- `Policy: context-only risk is capped below critical.`
- `Final risk diagnostic: <score>, decision <decision>.`
- `Run profile: <profile>.`
- `Provider budget: calls <N>, transfers <N>, contracts <N>, approvals <N>, elapsed <ms> ms, exhausted <yes/no>.`

## Invalid/no-final-decision отчет

Если `whereScoreValid(report) === false`, финальный отчет сейчас почти полностью английский даже для русского locale:

```text
Address check - no final decision
Address: <address>
Decision: NO_FINAL_DECISION
Blocked reason: <reason>
Technical status: <status>

Why
- <normalized reasons>

Coverage
- <coverage line>
- <limitation lines>
```

Fallback в Why:

- `Final scoring is blocked until the missing provenance history is covered.`

Это отдельный copy gap.

## Normalizer причин

`normalizeNotificationReason` переводит только часть raw strings/codes.

| Raw/code | Русский текст |
|---|---|
| `edd_sof`, `edd_source_of_funds`, `enhanced_due_diligence_source_of_funds` | `Нужна расширенная проверка источника средств (EDD/SOF): запросить подтверждение происхождения денег перед решением.` |
| `manual_review`, `manual_review_required` | `Найден дополнительный контекст, но точное плохое доказательство не подтверждено.` |
| `do_not_accept`, `block`, `decline` | `Не принимать без дополнительного решения: найден высокий policy-риск.` |
| `hold`, `freeze_or_hold`, `hold_or_freeze_if_applicable` | `Нужна пауза/hold: не двигать средства до проверки источника и policy-риска.` |
| `provider_cap_unresolved` | `Проверка уперлась в лимит данных провайдера; финальный риск нельзя считать полностью доказанным.` |
| `incoming_history_not_fetched`, `history_not_fully_fetched` | `Не загружена нужная входящая история по одному из адресов; это техническое ограничение покрытия, не доказательство риска.` |
| `service_boundary`, `service_boundary_reached`, `unlabeled_service_boundary` | `Маршрут дошёл до сервисной границы. Через биржу/сервис нельзя надёжно продолжать on-chain трассировку.` |
| `clean_source_not_fully_proven` или clean source not proven text | `Чистый источник денег доказан не полностью, поэтому риск не нулевой.` |
| `clean cex origin is not fully proven` | `Чистый CEX-источник не доказан полностью. Кошелёк похож на операционный или ликвидный, жёстких плохих доказательств нет.` |
| `material unknown source boundary` | `Граф остановился на существенной неизвестной границе источника.` |
| `<percent>% ... HTX/Huobi ...` | `<percent>% проверенной суммы пришло от HTX.` |
| `manual review required` внутри фразы | В русском заменяет всю строку на manual-review текст, может терять конкретику |
| `no obvious risk signals`, `no critical risk` | `Критичных риск-сигналов не найдено.` |

### Approval-drain normalizer

| Raw | Русский текст |
|---|---|
| `Exact approval-drain provenance reaches checked wallet via 0 hop(s).` | `Найдена точная approval-drain цепочка: после approve USDT были списаны через transferFrom, а проверяемый адрес стал первым получателем средств.` |
| `Exact approval-drain provenance reaches checked wallet via <N> hop(s).` | `Найдена точная approval-drain цепочка: после approve USDT были списаны через transferFrom, а проверяемый адрес связан с получателем через <N> hop.` |
| `saved exact approval-drain evidence exists for this address` | `По адресу есть сохранённое exact approval-drain доказательство: ранее система находила цепочку approve -> transferFrom -> получатель средств.` |
| `exact upstream approval-drain provenance linked to this address` | То же |
| `exact approval-drain proximity label` | То же |
| `exact approval-drain provenance was found` | То же |

### Sanctioned service normalizer

Поддерживает два шаблона:

- Русский raw: `Найдена связь с санкционной биржей/криптосервисом <service>: доля <share> проверяемого происхождения; орган: <authority>; дата включения: <date>`
- English raw: `reaches sanctioned crypto service <service> (...); designated by <authority> on <date>`

Русский вывод:

- `Найдена связь с санкционной биржей/криптосервисом <service>: доля <share>, <authority>, дата включения <date>. Это санкционный policy-риск; это не доказательство scam/drain.`
- `Маршрут происхождения дошёл до санкционного криптосервиса <service>: <authority>, дата включения <date>. Это санкционный policy-риск; это не доказательство scam/drain.`

## DeepCheck compact report

Заголовок:

- `Поведение адреса - контекст`
- `Address behavior - context`

Секции:

- `Что это значит`
- `Главный сигнал`
- `Сигналы`
- `Точное состояние USDT контракта`
- `Покрытие`
- `Для поддержки`

### Deep finding translations

| Raw finding | Русский текст |
|---|---|
| `official TRON USDT blacklist state is active` | `USDT-контракт показывает активный blacklist для адреса.` |
| `exact approval-drain provenance found` | `Найдена точная цепочка approval-drain.` |
| `extended local-index provenance candidate found` | `Локальный индекс нашёл длинную цепочку происхождения средств.` |
| `confirmed 2-hop exposure to known darknet exchange seed` | `Найдена связь с размеченным высокорисковым источником в пределах 2 шагов.` |
| `direct exposure to a high-risk counterparty` | `Есть прямой контрагент с высоким риском.` |
| `major direct counterparty has high fast forensic risk` | `Крупный прямой контрагент сам выглядит рискованно.` |
| `operational laundering-pattern context found` | `Похоже на рабочий транзитный поток через сервисы и ликвидность.` |
| `service-boundary exposure and wallet-role context found` | `Найдена сервисная граница и определена роль кошелька.` |
| `service-boundary exposure context found` | `Деньги проходят через сервисную границу.` |
| `service exposure context confirmed` | `Подтверждён контакт с сервисной инфраструктурой.` |
| `address behavior context confirmed` | `Подтверждён поведенческий контекст адреса.` |
| `inbound provenance candidate` | `Есть входящая цепочка от размеченного источника.` |

### Deep what changed raw variants

Эти строки сначала частично проходят через `userFacingLine`, потом через `deepSignalText`.

- `Deep analysis confirmed active TRON USDT blacklist state directly from the token contract. Current blocked balance: <amount>.`
- `Deep analysis found an exact approval-drain root: approval <tx> was followed by transferFrom drain <tx>, then funds linked to this address within <N> hop(s).`
- `Extended local-index search found a <N>-hop <direction> candidate with <percent> amount preservation.`
- `Deep analysis found that <amount> of inbound volume has exact on-chain upstream exposure to a manually verified darknet exchange seed.`
- `Deep analysis found that <amount> of inbound volume has upstream exposure to a labeled source.`
- `Deep analysis found that <amount> of <direction> volume is directly connected to a high-risk counterparty label.`
- `<percent> of <direction> volume is connected to counterparty <address>, whose fast forensic snapshot is <score>/100 (<level>). This is interaction context, not exact taint proof.`
- `Deep analysis found <percent> of outgoing 30d USDT flow reaching terminal liquidity/service boundaries. This is not a blacklist/scam claim.`
- `Deep analysis found service-boundary exposure and classified the likely wallet role as <role>.`
- `Deep analysis found service-boundary exposure where public-chain continuity becomes limited.`
- `Deep analysis confirmed the preliminary service/behavior signals.`
- `Deep analysis did not find additional risk signals in the collected evidence.`
- `Deep analysis completed with limited coverage.`

### Deep coverage

- `Проверено переводов: <N>.`
- `Проверено входящих отправителей: <N>.`
- `Покрытие ограничено.`

Support/debug дополнительно может показать:

- `Главное evidence`
- `Дополнительный контекст`
- `Покрытие и ограничения`
- технические evidence lines: path, amount, tx hashes, spender, receiver, token contract, blacklist method, etc.

## Cross-chain corridor

Секция финального отчета сейчас называется `Cross-chain corridor` и строки только английские.

Возможные строки:

- `Deep cross-chain analysis was not auto-run below threshold`
- `Deep cross-chain analysis was not auto-run`
- `Skipped reason: <reason>`
- `Stage 2 was triggered, but provider data is partial`
- `Stage 2 was triggered, but no cross-chain corridor path was returned.`
- `Top path: <route>; selected <amount>; tx <tx>`
- `Terminal boundary: <boundary>`
- `Proof level: <proofLevel>; hard proof`
- `Proof level: <proofLevel>; source-policy risk, not direct scam proof`
- `Proof level: <proofLevel>; provider coverage is incomplete`
- `Bridge continuation: <terminal>; candidate <chain:address>; <evidenceClass>; score <score>`
- `Continuation reasoning: <message>`
- `<topPath.reasons[0]>`
- `<topPath.warnings[0]>`

Terminal boundary labels:

- `Tornado/mixer`
- `sanctioned service`
- `no-name token liquidity`
- `bridge boundary`
- `DEX/router boundary`
- `unknown contract`
- `data exhausted`
- `candidate-only continuation`
- `none`

Cross-chain source-policy raw reasons from `crossChainEvidence`:

- `Cross-chain trace terminates at no-name token liquidity.`
- `No-name token liquidity is high source-policy risk, not direct scam/theft proof by itself.`
- `Cross-chain trace terminates at a mixer-like service.`
- `Mixer evidence is source-policy unless exact sanctioned evidence exists.`
- `Cross-chain trace terminates at a sanctioned service.`
- `Cross-chain trace terminates at a bridge boundary.`
- `Bridge boundary evidence is source-policy context, not direct theft proof.`
- `Cross-chain trace terminates at a DEX or router boundary.`
- `DEX/router boundary evidence is source-policy context, not direct theft proof.`
- `Cross-chain trace terminates at an unknown contract.`
- `Unknown contract evidence is contextual until stronger provenance is found.`
- `Cross-chain trace stopped because provider or search coverage was exhausted.`
- `Cross-chain coverage is incomplete; do not treat this as source-policy proof.`
- `Cross-chain continuation found candidate-only support without terminal proof.`
- `candidate-only continuation is not source-policy proof and must be manually reviewed.`
- `No cross-chain terminal boundary was detected.`

## Scoring matrix rows

Rows in priority order:

1. `hard_proof`
2. `source_policy`
3. `incoming_deposit_source_policy`
4. `route_linked_approval_pattern`
5. `asset_continuation`
6. `service_linked_pattern`
7. `typology_subgraph_pattern`
8. `contract_suspicion`
9. `counterparty_context`
10. `behavior_only_prior`
11. `clean_or_operational`
12. `coverage_uncertainty`

Decision logic:

- `can_decline` + score >= 60 -> `DECLINE`.
- score >= 30 -> `REVIEW`.
- `insufficient_only` -> `INSUFFICIENT_EVIDENCE`.
- `acceptable_only` -> `ACCEPTABLE`.
- Otherwise -> `ACCEPTABLE`.

Caps:

- `coverage_uncertainty` -> score 0, cap `coverage_uncertainty_no_badness`.
- `behavior_only_prior` >= 60 -> cap 59.
- `contract_suspicion` >= 60 -> cap 59.
- `typology_subgraph_pattern` without hard/source/service anchor >= 60 -> cap 59.

Matrix anchor reason currently raw:

- `Scoring Signal Matrix winning row is <winningRow>.`

Если этот текст попадет пользователю, его надо заменить на нормальный русский смысл.

## Основные score reasons из unified wallet risk

| code | source | score | Raw message |
|---|---|---:|---|
| `usdt_blacklist` | `hard_evidence` | 95 | `Active TRC20 USDT blacklist evidence found.` |
| `exact_approval_drain` | `hard_evidence` | 95 | `Exact approval-drain provenance found.` |
| `deep_high_risk_inbound_provenance` | `hard_evidence` | max(85, profile.score) | `Deep Research found deterministic high-risk inbound provenance.` |
| `deep_high_risk_extended_provenance` | `hard_evidence` | max(85, profile/path score) | `Deep Research found exact high-risk extended provenance.` |
| `where_hard_bad_evidence` | `hard_evidence` | approval-drain 95, otherwise >= 85 | `Where Is Money found deterministic hard bad evidence.` |
| `where_source_policy_floor` | `policy_floor` | 70-84 | `Where Is Money found source-policy decline evidence that should not be diluted by layer weights.` |
| `asset_continuation_floor` | `asset_continuation` | <= 84 | first asset continuation reason or `Verified TRC20 asset continuation found after USDT movement.` |
| `historical_transit_pattern` | `pattern_floor` | <= 84 | `Large historical pass-through flow with bridge/swap/router/DEX or unknown-contract exposure.` |
| `where_drain_episode_transit_pattern` | `pattern_floor` | <= 84 | `Where Is Money found a high-volume pass-through drain episode to bridge/swap/router/DEX infrastructure.` |
| `route_linked_approval_pattern` | `pattern_floor` | <= 80 | `Route-linked approval-drain context found without exact approval-drain proof.` |
| `limited_coverage_floor` | `coverage` | 30 | `Coverage is too limited to treat the wallet as confidently clean.` |
| `unified_dampener` | `dampener` | <= 25 applied | `Trusted, clean-role, or behavior dampener applied to non-hard evidence.` |
| `matrix:<winningRow>` | row-dependent | matrix score | `Scoring Signal Matrix winning row is <winningRow>.` |

## Incoming deposit source-policy thresholds

Эти строки важны для твоего вопроса про HTX/Huobi долю. Они относятся к входящему депозиту и fresh balance-forming bundle.

| Условие | Score | Decision eligibility | Raw message |
|---|---:|---|---|
| `htxHuobiShare >= 0.7` | 85 | can_decline | `HTX/Huobi materially funds the fresh balance-forming bundle for this incoming deposit.` |
| `htxHuobiShare >= 0.3` | 70 | can_decline | `HTX/Huobi funds a material share of the fresh balance-forming bundle for this incoming deposit.` |
| `htxHuobiShare >= 0.1` | 55 | review_only | `HTX/Huobi funds a minority share of the fresh balance-forming bundle for this incoming deposit.` |
| `0 < htxHuobiShare < 0.1` | 40 | review_only | `HTX/Huobi appears in the fresh corridor, but exact high-share deposit-source attribution was not proven.` |
| `riskyLabelShare >= 0.1` | 85 | can_decline | `A hard-risk source materially funds the fresh balance-forming bundle for this incoming deposit.` |
| `bridgeRouterDexShare >= 0.5` | 60/70 | can_decline | `Bridge/router/dex exposure dominates the fresh balance-forming bundle for this incoming deposit.` |
| `unknownContractShare >= 0.5` | 45 | review_only | `Unknown contract exposure dominates the fresh balance-forming bundle for this incoming deposit.` |
| `bridgeRouterDexShare > 0 || unknownContractShare > 0` without hard source proof | 35 | review_only | `Service or unknown-contract corridor exposure is present without hard source proof.` |
| wallet historical exposure background | <= 20 | review_only | `Sender wallet historical exposure profile adds background risk and does not prove the checked deposit source.` |

Матрица для входящего депозита:

- HTX/Huobi >= 70% -> `incoming_deposit_source_policy`, score 85, `DECLINE`.
- HTX/Huobi >= 30% -> `incoming_deposit_source_policy`, score 70, `DECLINE`.
- HTX/Huobi >= 10% -> `incoming_deposit_source_policy`, score 55, `REVIEW`.
- HTX/Huobi < 10%, но > 0 -> `counterparty_context`, score 40, `REVIEW`.

## Risk policy engine raw reasons

Эти причины могут попадать в policy/report слои.

- `Exact scam/taint evidence was found.`
- `Exact approval-drain provenance was found.`
- `HTX/Huobi exposure is source-policy risk, not scam or drain proof.`
- `WhiteBIT exposure is source-policy context, not scam or drain proof.`
- `Clean source is not proven after a service/contract boundary.`
- `Clean source is not proven due to limited coverage.`
- `AI contract verdict indicates suspicious contract context.`
- `Balance-forming path reaches allowlisted CEX through clean on-chain hops.`
- fallback: `Clean source is not proven.`

## Source bundle exposure raw reasons

Эти строки объясняют состав выбранной суммы или входящего депозита.

- `HTX/Huobi accounts for <percent> of selected source share.`
- `HTX/Huobi accounts for <percent> of checked-deposit source share.`
- `Clean CEX accounts for <percent> of selected source share.`
- `Bridge/router/DEX accounts for <percent> of selected source share.`
- `Unknown contract accounts for <percent> of selected source share.`
- `Risky label accounts for <percent> of selected source share.`
- `Uncovered selected source share is assigned to unknown.`
- `Source bundle coverage-limited: unresolved <kind> boundary remains after the graph budget stopped.`
- `Source bundle coverage-limited unknown boundary remains after the graph budget stopped.`
- `Historical HTX/Huobi sender inflow accounts for <percent> of incoming volume.`
- `Historical bridge/router/DEX activity accounts for <percent> of sender volume.`

## Known copy gaps

1. Coverage строка для `selected_anchor`, `recent_flow`, `drain_episode` не локализована и дает смешанный русский/английский текст.
2. `NO_FINAL_DECISION` отчет почти весь английский.
3. `Cross-chain corridor` секция вся английская.
4. `source-policy`, `hard-proof`, `policy-floor`, `materiality`, `caveat`, `operational wallet`, `service boundary`, `Admin`, `DeepCheck`, `Where Is Money` смешаны в русском тексте без единого словаря.
5. `manual review required` в normalizer для русского может заменить всю строку на общий текст и потерять конкретику.
6. `Scoring Signal Matrix winning row is <row>` не должен попадать в пользовательский текст как главная причина.
7. `review` используется как техническое решение матрицы и как действие compliance. Для пользователя лучше писать конечный статус отдельно: `Решение`, `Что делать`, `Почему`.
8. Возможны дубли: одна и та же service boundary строка может попасть и в `Почему`, и в `Что важно учесть`.
9. `EDD/SOF` уже расшифрован, но все еще содержит англоязычную аббревиатуру. Нужен единый пользовательский вариант, например “запросить документы о происхождении средств”.
10. Сырые `assessment.reasons`, `riskLayers.reasons`, `crossChain warnings` могут пройти без перевода, потому что нормализатор покрывает только часть шаблонов.

## Предлагаемый следующий слой редактуры

1. Сделать единый русский словарь терминов:
   - `source-policy` -> `санкционный/биржевой policy-риск` или `политика источника средств`.
   - `hard evidence` -> `точное доказательство`.
   - `service boundary` -> `граница биржи или сервиса`.
   - `coverage` -> `покрытие данных`.
   - `review` -> `ручная проверка`, но не использовать как итог вместо `DECLINE/ACCEPTABLE`.
2. В финальном отчете показывать:
   - `Решение`
   - `Что делать`
   - `Почему риск такой`
   - `Что проверили`
   - `Ограничения данных`
3. Для каждой карточки причины хранить:
   - человекочитаемый заголовок;
   - доказательство или контекст;
   - долю/сумму/hops/date, если есть;
   - что делать пользователю.
4. Убрать технические строки матрицы из пользовательского режима. Оставить их в admin/beta.
5. Для HTX/Huobi писать не “HTX финансирует”, а точнее:
   - `В выбранной сумме найден источник HTX/Huobi: <percent>.`
   - `Это policy-риск по источнику средств. Это не означает scam/drain само по себе.`
   - `Порог: <>=30% дает отказ/ручную проверку по текущей политике; >=70% - сильный отказ для входящего депозита.`

