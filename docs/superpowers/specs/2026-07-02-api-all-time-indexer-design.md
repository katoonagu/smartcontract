# API All-Time Indexer для DeepCheck, Where Is Money и Incoming

Date: 2026-07-02
Status: Draft for user review

## Коротко

Строим автоматический API-индексатор истории TRON USDT по адресу. Он сам скачивает все доступные страницы через TronScan API, сохраняет историю в локальный индекс и показывает, какая часть проверки реально покрыта данными.

CSV, ручная выгрузка, браузерный экспорт, капча и прогрев cookies не входят в дизайн. Проект должен работать как бот: получил адрес, сам пошел в API, сам добрал историю, сам показал результат и границы покрытия.

Главная цель: перестать путать "мы дошли только до 1-2 шагов" с "дальше ничего нет". После апгрейда Admin должен показывать не только граф, но и статус данных: что скачано полностью, что скачано частично, что стоит в очереди, где API ограничил проверку.

## Почему это нужно

Сейчас DeepCheck работает как быстрый срез:

- берет ограниченное число страниц по адресу;
- расширяет не всех прямых участников, а только top inbound senders;
- часто показывает короткий путь, потому что дальше история не скачана;
- Where Is Money и Incoming могут останавливаться с `incoming_history_not_fetched`.

Это нормально для быстрого режима, но плохо для forensic-режима. Пользователю нужна другая гарантия: если мы говорим, что проверили кошелек, значит мы знаем, какую историю скачали и какие адреса остались за пределами бюджета.

## Словарь

**Subject** - кошелек, который пользователь проверяет.

**Прямые кошельки** - все уникальные адреса, которые когда-либо отправляли USDT на subject или получали USDT от subject.

**Первый слой** - subject плюс все его прямые кошельки.

**Второй слой** - кошельки, с которыми взаимодействовали прямые кошельки subject.

**All-time history** - вся доступная история USDT-переводов по адресу за все время, которую можно получить через API. Если provider скрывает часть истории, режет offset или временно не отдает старые данные, статус не должен становиться `complete`: такой адрес остается `partial` с явной причиной.

**Hard evidence check** - проверка, которая дает сильное доказательство, а не поведенческую догадку: USDT blacklist state, известная биржа/сервис, HTX/санкционный сервис из registry, approval-drain provenance, точная contract-state проверка.

## Что строим

### 1. Provider Budget Engine

Нужен новый асинхронный движок запросов к TronScan.

Сейчас scheduler уже знает про группы API-ключей и cooldown, но выполняет работу почти последовательно: следующий запрос ждет завершения предыдущего. Поэтому 10 ключей сами по себе не дадут 25 RPS.

Новый engine должен:

- принимать пул API-ключей;
- поддерживать группы аккаунтов;
- держать общий лимит, например 25 RPS;
- держать лимит на группу, например 2-2.5 RPS;
- держать лимит на endpoint;
- ограничивать число одновременных запросов;
- охлаждать только ту группу, которая получила 429;
- продолжать работу другими группами;
- возвращать диагностические счетчики: requests, 429, retries, cooldowns, queue length, effective RPS.

Цель: не "ловить 429 и переключаться", а заранее дозировать поток так, чтобы 429 были редким исключением.

### 2. Address All-Time Indexer

Индексатор получает адрес и скачивает всю доступную историю official TRON USDT.

Используем official USDT contract:

```text
TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t
```

Базовый endpoint:

```text
GET /api/token_trc20/transfers
relatedAddress={address}
contract_address=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t
confirm=0
limit=50
start={offset}
sort=-timestamp
```

Важный факт: для тестового адреса `TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM` API отдавал свежие страницы через `start`, но на дальних offset начал возвращать пусто, хотя `total=10000`. При этом старые переводы удалось добрать через `end_timestamp`.

Значит индексатор должен работать не как один длинный offset-цикл, а как временные срезы:

1. Запросить свежую страницу.
2. Узнать верхнюю часть истории.
3. Качать страницы внутри текущего временного диапазона.
4. Когда offset становится пустым или диапазон исчерпан, взять самый старый timestamp из скачанных переводов.
5. Поставить `end_timestamp = oldest_timestamp - 1`.
6. Начать следующий срез.
7. Повторять, пока API не вернет пустой новый срез.

Это позволяет идти вглубь истории без CSV и без UI.

### 3. Локальный индекс и coverage state

Нужно хранить не только сами переводы, но и состояние покрытия.

Минимальный набор:

- address;
- token contract;
- status: `not_started`, `queued`, `running`, `complete`, `partial`, `failed`;
- provider: `tronscan`, `trongrid_fallback`;
- total reported by provider, если это значение есть и не выглядит как технический cap;
- fetched transfer count;
- unique counterparty count;
- newest timestamp;
- oldest timestamp;
- fetched page count;
- planned page count, если известно;
- current time-window boundary;
- retry count;
- last error;
- last successful page timestamp;
- completed at;
- updated at.

Для страниц:

- address;
- start offset;
- limit;
- min timestamp;
- end timestamp;
- status;
- transfer count;
- provider;
- attempt count;
- error.

Переводы сохраняем idempotent upsert по stable key:

```text
tx_hash + event_index + from_address + to_address + amount_raw
```

Если `event_index` недоступен в TronScan response, используем стабильный fallback на основе tx hash, from, to, amount, timestamp.

### 4. DeepCheck после апгрейда

Новый порядок DeepCheck:

1. Получили subject.
2. Проверили, есть ли all-time индекс subject.
3. Если нет - поставили subject в индексатор и дождались результата или вернули честный статус `indexing`.
4. Из полной истории subject построили список всех прямых кошельков.
5. Для каждого прямого кошелька сделали hard evidence check.
6. Обычные прямые кошельки поставили в очередь на all-time indexing.
7. Когда часть второго слоя готова, граф показывает второй слой с coverage.
8. Глубже второго слоя идем не по всем адресам, а по ranked money paths: суммы, время, сохранение суммы, риск-метки, сервисные границы.

До апгрейда:

- subject смотрится частично;
- прямые кошельки берутся выборочно;
- top inbound senders ограничены;
- Admin может выглядеть так, будто цепочка короткая.

После апгрейда:

- subject покрыт all-time;
- все прямые кошельки subject видны;
- каждый прямой кошелек получает hard evidence check;
- второй слой строится из локального индекса и очереди;
- Admin показывает, где данные полные, а где еще частичные.

### 5. Where Is Money

Главная правка: `incoming_history_not_fetched` не должен быть финальной тупиковой причиной, если историю можно добрать.

Новый порядок:

1. Где trace уперся в нехватку входящей истории, система проверяет coverage адреса.
2. Если история адреса не all-time complete, ставит адрес в индексатор.
3. После добора повторяет поиск предыдущего входящего USDT.
4. Если история complete и предыдущего входящего нет, только тогда ставит настоящую причину остановки: `no_previous_transfer`.

Это меняет смысл результата. Раньше "не нашли вход" часто означало "не скачали достаточно истории". После апгрейда это должно означать "скачали историю и действительно не нашли".

### 6. Incoming Deposit

Incoming сейчас может повторно читать live-данные в разных стадиях отчета. Это надо убрать.

Новый порядок:

1. Для sender или нужного hop сначала проверяем локальный индекс.
2. Если индекса не хватает, ставим адрес в all-time или targeted backfill до нужной даты.
3. `run_where_is_money` и `build_funding_bundles` читают один общий набор данных.
4. Funding bundles строятся из уже скачанной истории, а не из повторных live reads.

Цель: меньше API-запросов, меньше расхождений между стадиями одного отчета, лучше воспроизводимость.

### 7. Admin coverage

Admin должен показывать не только route graph, но и состояние данных.

Нужные поля:

- subject history: complete / partial / running / failed;
- subject transfers fetched;
- subject unique direct wallets;
- direct wallets checked;
- direct wallets with hard evidence;
- direct wallets queued for all-time indexing;
- second-layer wallets complete;
- second-layer wallets partial;
- stopped reasons after indexing;
- stopped reasons before indexing;
- effective API RPS during job;
- provider errors and cooldowns.

Для пользователя это должно читаться просто:

```text
Subject history: complete, 4 612 transfers fetched
Direct wallets: 138 found, 138 checked
Hard evidence: 3 CEX, 1 HTX exposure, 0 USDT blacklist
Second layer: 42 complete, 96 queued
Trace stop: complete history, no previous inbound found
```

## Что не строим

Не строим ручной CSV импорт.

Не строим browser automation для кнопки Export на TronScan.

Не строим captcha solving.

Не строим глобальный индекс всего TRON USDT по всей сети в первом этапе.

Не раскрываем бесконечно все слои графа для всех адресов. Это может стать бесконечной задачей. Полное покрытие даем для subject и прямого круга, второй слой строим через очередь и бюджет, глубже идем по ranked money paths.

## Подходы

### Подход A: API Address All-Time Indexer

Это рекомендуемый подход.

Плюсы:

- соответствует продукту: бот сам ищет данные;
- не зависит от UI TronScan;
- не зависит от капчи;
- можно масштабировать через API-ключи;
- можно хранить coverage и повторять проверку воспроизводимо.

Минусы:

- надо переделать scheduler;
- надо аккуратно обойти offset-потолки через временные срезы;
- второй слой нужно ограничивать очередью и бюджетом.

### Подход B: Contract Event Indexer

В проекте уже есть заготовка индексатора USDT contract events. Это более тяжелый путь: индексировать события Transfer/Approval по контракту, а потом искать адреса локально.

Плюсы:

- потенциально самый полный вариант;
- меньше зависимости от address endpoint;
- удобно для Approval и Transfer evidence.

Минусы:

- это почти отдельная инфраструктура;
- данных сильно больше;
- сложнее запустить быстро;
- не нужен как первый шаг, если задача сейчас - улучшить DeepCheck/Where/Incoming по конкретным адресам.

### Подход C: UI/CSV/CAPTCHA

Исключаем.

Плюсы:

- можно иногда получить готовый файл руками.

Минусы:

- это не бот;
- не автоматизируется надежно;
- зависит от UI;
- ломается на капче;
- не дает нормального resume, coverage и очереди.

## Рекомендация

Идем по подходу A.

Подход B оставляем как будущий upgrade path, если address endpoint TronScan станет слишком нестабильным или появится задача строить глобальный индекс USDT. Подход C не используем.

## Оценка времени API

Формула:

```text
pages = ceil(transfer_count / 50)
theoretical_seconds = pages / effective_rps
```

При 10 ключах целевой effective RPS: около 25.

Примеры:

- 4 600 переводов: 92 страницы, минимум 3.7 секунды;
- 10 000 переводов: 200 страниц, минимум 8 секунд;
- 30 прямых кошельков по 1 000 переводов: 600 страниц, минимум 24 секунды;
- 30 прямых кошельков по 4 000 переводов: 2 400 страниц, минимум 96 секунд.

Это теоретический минимум. Реально добавятся:

- network latency;
- запись в базу;
- retries;
- cooldown;
- деление на временные срезы;
- fallback на TronGrid;
- hard evidence checks.

Практичная цель:

- тяжелый subject на несколько тысяч переводов: 20-60 секунд;
- subject плюс десятки прямых кошельков: несколько минут;
- очень плотный второй слой: очередь, а не блокировка всего бота.

## Конфигурация

Ожидаемая env-схема:

```text
TRONSCAN_API_KEY=key1,key2,key3,key4,key5,key6,key7,key8,key9,key10
TRONSCAN_API_KEY_GROUPS=account_1:key1;account_2:key2;account_3:key3;...
TRONSCAN_PAGE_LIMIT=50
TRONSCAN_GLOBAL_RPS=25
TRONSCAN_GROUP_RPS=2.5
TRONSCAN_MAX_IN_FLIGHT=50
TRON_ADDRESS_INDEX_SECOND_LAYER_MAX_ACTIVE_WALLETS_PER_JOB=500
TRON_ADDRESS_INDEX_SECOND_LAYER_MODE=queued
```

Точные имена новых env можно выбрать на этапе implementation plan. Важно зафиксировать смысл: общий RPS, RPS на группу, max in-flight и активный бюджет второго слоя. Прямой круг subject не режем top-лимитом: он должен строиться полностью из all-time истории subject.

## Ошибки и остановки

### 429

Если группа получила 429:

- ставим cooldown только на эту группу;
- уменьшаем ее временный RPS;
- продолжаем запросы через другие группы;
- пишем событие в diagnostics.

### Пустая страница при большом offset

Если offset вернул пусто, но более старую историю еще можно добрать:

- не считаем адрес complete;
- берем oldest timestamp из уже скачанных страниц;
- продолжаем через `end_timestamp`.

### Fallback provider

Если TronScan address endpoint падает:

- пробуем TronGrid fallback;
- помечаем provider в coverage;
- если fallback fingerprint требует последовательного прохода, не обещаем 25 RPS для этого адреса.

### Partial result

Если job не успел скачать все:

- результат можно показать только как partial;
- Admin обязан показать, какие данные не покрыты;
- scoring не должен выдавать сильный вывод там, где не хватает истории.

## Success criteria

Считаем апгрейд успешным, если:

1. Для адреса с несколькими тысячами USDT transfer system скачивает all-time историю без CSV.
2. Indexer продолжает историю через `end_timestamp`, когда дальний offset пустой.
3. 10 ключей дают реальную параллельность, а не последовательную очередь.
4. DeepCheck строит полный список прямых кошельков subject из all-time истории.
5. Все прямые кошельки получают hard evidence check.
6. `incoming_history_not_fetched` превращается в индексируемую задачу, а не в финальную остановку.
7. Admin показывает coverage: complete, partial, queued, failed.
8. Повторный запуск не скачивает заново уже сохраненные страницы.
9. В тестах есть проверка resume после ошибки.
10. В отчете можно сравнить "до" и "после": сколько шагов, адресов, transfer edges, stopped reasons.

## Implementation phases

### Phase 1: Scheduler

Переделать TronScan scheduler в bounded async provider engine.

Минимальный результат:

- несколько групп API-ключей работают параллельно;
- есть max in-flight;
- cooldown не блокирует все ключи;
- diagnostics показывает effective RPS.

### Phase 2: Address Indexer

Сделать all-time индексатор по одному адресу.

Минимальный результат:

- скачивает страницы `limit=50`;
- сохраняет transfer rows idempotent;
- проходит через `end_timestamp`;
- хранит coverage state;
- умеет resume.

### Phase 3: DeepCheck integration

Перевести DeepCheck на новый источник данных.

Минимальный результат:

- subject индексируется all-time;
- прямой круг берется полностью;
- top-15 остается только для legacy/fast mode, не для all-time mode;
- hard evidence check запускается по каждому прямому адресу.

### Phase 4: Where Is Money and Incoming

Убрать остановку на недокачанной истории.

Минимальный результат:

- `incoming_history_not_fetched` вызывает targeted index/backfill;
- funding bundles читают общий индекс;
- live reads не дублируются между стадиями одного отчета.

### Phase 5: Admin coverage

Показать пользователю, что реально покрыто.

Минимальный результат:

- coverage summary в job detail;
- counters по прямому кругу и второму слою;
- stopped reasons разделены на "данных не хватило" и "история проверена, факта нет".

## MVP behavior

Для первого MVP фиксируем два поведения:

```text
Admin forensic run: DeepCheck ждет complete all-time subject и только потом отдает финальный отчет.
Bot user run: DeepCheck быстро отдает partial report, а потом обновляет отчет после complete indexing.
```

Так мы не блокируем обычного пользователя молчанием на несколько минут, но в Admin получаем строгий forensic-режим без ложного ощущения полного покрытия.
