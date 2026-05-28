# Как работает fast check и deep research

## Коротко

У нас сейчас два слоя проверки адреса:

1. **Fast check** — быстрый предварительный ответ в Telegram.  
   Он должен ответить за несколько секунд: есть ли точное доказательство вроде USDT blacklist, есть ли явные labels, есть ли быстрые признаки транзита, вывода в bridge/router/CEX/service.

2. **Deep forensic research** — более тяжелая проверка в фоне.  
   Она добирает больше transfer edges, смотрит входящие источники, прямых контрагентов, service exposure, approval-drain provenance, darknet seed provenance, blacklist, boundary и extended 4-hop search.

Важно: fast check — это не финальный forensic result. Это первый слой, чтобы бот не молчал. Deep потом уточняет картину.

---

## Fast Check

Fast check запускается на `/check <TRON address>`.

Главная цель: быстро дать пользователю понятный риск и причины, не зависнуть на TronScan/API.

### Что fast check смотрит первым

Самое первое — **точное состояние official TRON USDT contract**:

- вызывает `getUsdtRestrictionStatus(address)`;
- проверяет `isBlackListed(address)`;
- смотрит USDT balance / blocked balance, если provider отдал данные.

Если адрес в USDT blacklist, это сразу exact evidence. Тогда адрес не должен выглядеть LOW только потому, что graph enrichment не успел.

То есть blacklist сильнее поведения.

### Потом fast check смотрит граф

Если blacklist не найден, fast check запускает bounded address exposure search:

- берет TRON USDT transfers;
- смотрит входящие и исходящие USDT;
- строит небольшой graph вокруг адреса;
- классифицирует service-like endpoints;
- считает service exposure;
- считает address behavior;
- смотрит direct counterparty exact labels;
- сохраняет missing checks, если provider не успел или часть данных недоступна.

### Базовые параметры fast check

Сейчас fast check использует такие defaults:

```text
window: последние 30 дней
maxDepth: 2
maxPagesPerAddress: 1
pageLimit: 50
limit: 5
contractProfileFetchLimit: 5
maxExpandedIntermediates: 10
metadataFetchLimit: 12
timeoutMs: 10 000 ms
transfer cache TTL: 5 минут
USDT restriction cache TTL: 5 минут
metadata TTL: 24 часа
recent fallback min transfer count: 10
recent fallback latest transfers: 60
```

Что это значит простыми словами:

- за основу берем последние 30 дней;
- не лезем глубоко по всем адресам;
- с каждого адреса берем ограниченное число страниц;
- heavy enrichment делаем только по ограниченному числу кандидатов;
- если адрес sparse, то есть за 30 дней мало USDT transfers, добираем последние исторические USDT transfers до лимита;
- все это должно уложиться примерно в 10 секунд.

### Что происходит при timeout

Если fast check не успевает за 10 секунд:

- он не падает;
- использует уже собранные transfer pages;
- делает fallback-анализ без новых live metadata/profile calls;
- снижает глубину до `maxDepth = 1`;
- не расширяет intermediates;
- добавляет note вроде: проверка service exposure неполная из-за timeout.

Это нужно, чтобы Telegram всегда отвечал.

---

## Deep Research

Deep research — это background job после `/check <address>`.

Fast check возвращает preliminary report и ставит deep job. Потом бот присылает follow-up.

### Что deep делает шире fast check

Deep job:

- берет больше страниц source transfers;
- добирает historical fallback для sparse wallets;
- расширяет inbound senders;
- смотрит top counterparties;
- проверяет exact labels;
- проверяет derived markers;
- проверяет USDT blacklist;
- строит service exposure;
- строит address behavior;
- ищет inbound provenance;
- ищет darknet exchange provenance;
- ищет approval-drain root cause;
- строит boundary exposure;
- строит wallet role profile;
- может запускать extended provenance search в auto mode.

### Параметры deep job

Сейчас deep job примерно такой:

```text
maxDepth: 2
maxPagesPerAddress: 2
maxExpandedIntermediates: 10
metadataFetchLimit: 12
contractProfileFetchLimit: 5
maxInboundSenders: 5
maxApprovalDrainCandidates: 5
approvalChangeLookupLimit: 5
recentFallbackMinTransferCount: 60
recentFallbackTransferLimit: 60
extendedSearchMode: auto
extendedSearchMaxDepth: 4
extendedSearchBeamWidth: 8
extendedSearchMaxAddressFetches: 60
```

Человечески:

- deep смотрит больше данных, чем fast;
- если за 30 дней мало активности, он добирает последние 60 исторических USDT transfers;
- inbound provenance смотрит ограниченное число входящих отправителей;
- approval-drain ищется только по top candidates, чтобы не взорвать API;
- extended search может пойти до 4 hops, но не как полный BFS, а ограниченно.

---

## Какие Evidence Layers Есть

### 1. Exact Token-Contract Evidence

Самый сильный слой.

Примеры:

- official USDT blacklist;
- balance / blocked balance;
- exact `transferFrom`;
- exact approval перед drain;
- exact tx hash, timestamp, amount.

Это не поведенческая догадка.

### 2. Internal Labels / Manual Assertions

Например:

- `darknet_exchange`;
- `darknet_exchange_proximity`;
- `approval_drain_proximity`.

Если label вручную подтвержден или создан как derived marker на exact path, это сильнее обычного поведения.

### 3. Provenance

Система пытается понять, откуда пришли деньги.

Примеры:

```text
darknet seed -> intermediate -> checked address
```

или:

```text
victim approval -> transferFrom drain -> first receiver -> checked address
```

Здесь важны:

- hop depth;
- temporal order;
- amount preservation;
- tx hashes;
- stop на CEX/router/bridge boundary.

### 4. Service Exposure

Смотрим, какая доля исходящего USDT ушла в:

- bridge;
- bridge_pool;
- router;
- dex;
- cex;
- hot_wallet;
- swap_adapter;
- unknown_contract.

Это не proof. Это service exposure context.

Пример формулировки: адрес быстро вывел большую долю USDT в router или bridge boundary.

### 5. Address Behavior

Смотрим поведение самого адреса:

- получил крупный inflow;
- быстро вывел дальше;
- сохранилась почти вся сумма;
- есть collector-like или transit-like behavior;
- один top outgoing counterparty забрал большую долю средств.

Это тоже не proof. Это operational pattern.

### 6. Direct Counterparty Risk

Сейчас direct counterparty scoring консервативный.

Он повышает риск, если direct counterparty имеет exact/internal label, например:

- `darknet_exchange`;
- `darknet_exchange_proximity`.

Но если counterparty просто сам выглядел HIGH из-за behavior/service exposure, мы пока не переносим этот риск автоматически. Это сделано специально, чтобы не плодить ложную точность.

---

## Почему Fast и Deep Могут Отличаться

Есть несколько причин.

### Fast видел мало данных

Fast ограничен временем и лимитами. Он может увидеть только часть edges.

### Deep добрал historical transfers

Если за 30 дней мало активности, deep может добавить последние 60 исторических USDT transfers.

### Deep нашел provenance

Fast может сказать LOW/MEDIUM, а deep потом найти:

- direct risky source;
- 2-hop darknet exchange provenance;
- approval-drain root;
- blacklist;
- derived marker.

Тогда риск вырастает.

### Deep может не повысить риск

Если deep увидел только поведение, но не увидел exact taint/provenance/label, риск может остаться LOW/MEDIUM.

Это нормально: behavior сам по себе не должен превращаться в обвинение.

---

## Почему TNNk... Получил Низкий Риск, Хотя Связан с TLh...

В текущей логике это объясняется так.

Система увидела связь:

```text
TLhVzk... -> TNNk...
```

Но у `TLhVzk...` не было exact label в локальной базе на момент проверки.

То есть для системы это был не:

```text
confirmed risky label -> subject
```

а:

```text
counterparty with risky-looking behavior -> subject
```

А behavior-risk counterparty пока не переносится как taint score.

Поэтому TNNk получил в основном behavior/context score:

- collector-like;
- быстрый вывод;
- top outgoing concentration;
- limited coverage.

Но не получил HIGH как exact provenance.

Это консервативное правило. Оно снижает false positives, но может недооценивать такие случаи.

---

## Что Сейчас Не Делается

Важно понимать ограничения.

Система сейчас не делает полный анализ всех адресов на 4-7 hops при каждом `/check`.

Она не раскручивает каждую транзакцию за 30 дней бесконечно.

Она не говорит: “адрес мошеннический”, если есть только похожее поведение.

Она не продолжает proof через:

- CEX;
- HTX;
- Bybit;
- router;
- bridge;
- DEX pool.

Через такие точки система пишет boundary/context, а не точную цепочку.

---

## Что Нужно Улучшать Дальше

Самое важное улучшение сейчас:

**counterparty fast-risk snapshot для всех direct counterparties.**

То есть для каждого прямого counterparty надо показывать:

- видели ли мы его раньше;
- какой у него previous risk;
- почему он был HIGH;
- это exact taint или behavior-only context;
- какая доля взаимодействия с subject;
- можно ли это учитывать в score.

Но правило должно быть аккуратным:

- exact label / blacklist / approval-drain можно переносить сильнее;
- behavior-only counterparty можно показывать как context;
- HIGH можно давать только если counterparty fast risk высокий, доля взаимодействия большая, например больше 70%, и есть понятное evidence class.

Это как раз следующий слой между “вообще не учитывать TLh” и “автоматически заражать всех вокруг”.
