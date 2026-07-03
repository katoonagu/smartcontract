# Безопасный результат для Where / Incoming

Дата: 2026-07-03

## Проблема

Последний live-прогон показал две разные проблемы.

Первая: `Where is money` может показать финальный `DECLINE`, хотя hard evidence нет. В нашем кейсе был approval-drain review, но он был guarded: маршрут уперся в сервисный контекст, контракт LLM распознал как legitimate service, contract risk был низкий. Пути остановились из-за недокрытой истории hop-адресов, но пользовательский итог все равно стал отказом.

Вторая: `Incoming deposit` может долго висеть внутри targeted-загрузки истории hop-адресов. Если inline-бюджет страниц кончился, job не должен выглядеть как обычный forensic-score. Это техническая неполнота покрытия.

Главное правило первого этапа:

> Если hard evidence нет, а покрытие истории не доказано, система не публикует финальный пользовательский отказ.

Просто заменить внутренний `DECLINE` на `REVIEW` недостаточно. У нас `REVIEW` может дальше отобразиться пользователю как отказ. Фикс должен менять именно финальный outcome для админки и бота.

## Scope

Этот этап закрывает только две вещи:

1. `Where is money`: guarded approval-drain review без hard evidence не становится финальным пользовательским `DECLINE`.
2. `Incoming deposit`: если targeted history уперлась в бюджет, job завершается техническим статусом и `score_valid=false`.

Не делаем в этом этапе:

- full background `waiting_for_targeted_index` для Incoming;
- глобальное поднятие лимита страниц;
- DeepCheck second-layer expansion;
- переделку всех `missingChecks`.

## Что мы знаем по последнему адресу

- Четыре TronScan-ключа не были главным стопором. Практический потолок уже около текущих scheduler-настроек.
- `Where is money` завершился примерно за минуту.
- Все 7 путей получили unresolved/`incoming_history_not_fetched`: история hop-адресов не дошла до нужного времени.
- Approval-drain сигнал был guarded. LLM сказал legitimate service / acceptable, низкий contract risk.
- `Incoming deposit` дошел до большого числа targeted hop-адресов. Часть complete, часть `partial_budget_exhausted`.
- Это не выглядит как проблема `429`. Это наши правила покрытия и budget stop.

## Желаемое поведение

### Where is money

Если одновременно верно:

- есть approval-drain review finding;
- finding guarded через service-route guard или contract guard;
- контракт распознан как legitimate service или другой non-actionable verdict;
- exact approval-drain proof нет;
- risky label, sanctioned service, HTX/Huobi policy, blacklist и другое hard bad evidence отсутствуют;

то пользовательский итог не может быть финальным `DECLINE`.

Допустимые итоги:

- `ACCEPTABLE` с warning, если clean/operational context достаточно сильный и покрытия хватает;
- `score_valid=false` + `score_blocked_reason=insufficient_coverage`, если история не добрана и честно скорить нельзя;
- внутренний/Admin diagnostic `REVIEW`, только если бот и админка не показывают это как финальный отказ.

Запрещенный итог:

- пользовательский `DECLINE` только из-за guarded approval-drain review и недокрытой истории.

### Incoming deposit

Если targeted history возвращает неполное покрытие, например `partial_budget_exhausted`, job не публикует score как forensic decision.

Минимальный result:

```json
{
  "score_valid": false,
  "score_blocked_reason": "partial_budget_exhausted",
  "technical_status": "provider_cap_unresolved"
}
```

Если остановка произошла по hard runtime / safety limit:

```json
{
  "score_valid": false,
  "score_blocked_reason": "hard_safety_limit_exceeded",
  "technical_status": "hard_safety_limit_exceeded"
}
```

Админка и бот должны понимать: `score_valid=false` означает, что forensic verdict не опубликован.

## Как делаем

### 1. Where outcome safety

Добавляем guard рядом с финальным assessment в `Where is money`. Он должен сработать до fallback-веток, которые сейчас говорят: clean source не доказан или approval-drain review существует, значит decline.

Guard проверяет:

- approval-drain review findings есть;
- finding guarded или false-positive guards активны;
- contract LLM verdict legitimate/non-actionable;
- hard bad evidence пустой;
- strict source-policy decline отсутствует.

Дальше:

- если покрытие неполное из-за недобранной истории, результат становится non-final: `score_valid=false / insufficient_coverage`;
- если clean/operational context сильный, можно вернуть `ACCEPTABLE` с warning;
- evidence и warnings остаются видны аналитику.

Ключевой критерий: Admin и Telegram не показывают этот кейс как финальный `DECLINE`.

### 2. Incoming technical stop

Пока оставляем текущую inline-модель targeted fetch. Не делаем background queue в этом этапе.

Добавляем stop вокруг targeted history ensure:

- собираем ensure-результаты по hop-адресам;
- если обязательный hop вернул incomplete из-за бюджета или provider cap, scoring останавливается;
- job завершается техническим статусом;
- `score_valid=false`;
- в `result_json` или `progress_json` сохраняется причина и базовая статистика покрытия.

Worker не должен висеть бесконечно над покрытием, которое текущий бюджет не может добрать.

### 3. Минимальная диагностика Incoming

В этом этапе достаточно сохранить:

- selected deposit tx;
- sender;
- hop count;
- complete hop count;
- partial hop count;
- pages fetched;
- transfers fetched;
- first blocking reason.

Полный live progress UI идет следующим этапом вместе с background-моделью.

## Следующие этапы

### Incoming background model

После проверки technical stop переводим Incoming на strict-модель:

- job входит в `waiting_for_targeted_index`;
- worker освобождается;
- targeted index task работает отдельно;
- job продолжается после обновления index state.

### Budget config

Добавляем явные лимиты:

- `maxPagesPerHop`;
- `maxPagesPerJob`;
- `maxHopCount`;
- `maxRuntimeMs`.

Нельзя просто глобально поднять текущие 4 страницы без job-level лимитов.

### Категории missingChecks

Разделяем `missingChecks`:

- provider errors;
- наши budget limits;
- нормальные service-boundary stops;
- diagnostic notes.

Так нормальная остановка не будет выглядеть как ошибка.

### DeepCheck second layer

Отдельно исправляем метрики второго слоя. Сейчас может быть `budget=25`, но `secondLayerQueued=0` и `secondLayerComplete=0`, поэтому админка показывает неполную картину.

## Тесты

Минимум:

- `Where is money`: guarded approval-drain review + legitimate-service LLM + no hard evidence + incomplete hop coverage не дает пользовательский `DECLINE`.
- Тот же кейс с сильным clean/operational context может дать `ACCEPTABLE` с warning.
- Тот же кейс с реальным hard bad evidence все еще дает `DECLINE`.
- `Incoming deposit`: targeted history `partial_budget_exhausted` завершает job с `score_valid=false`.
- `Incoming deposit`: hard runtime stop завершает job с `score_valid=false`.
- Admin graph/projection рендерит technical Incoming result и non-final Where result.

## Критерии успеха

- Последний адрес больше не получает финальный `Where is money` отказ только из-за guarded approval-drain review.
- Incoming job не остается running после исчерпания targeted-history бюджета.
- UI различает forensic decision и техническую неполноту данных.
- Изменение достаточно маленькое, чтобы проверить его до full background targeted indexing.
