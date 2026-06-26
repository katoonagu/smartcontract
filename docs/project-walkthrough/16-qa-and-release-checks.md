# QA И Проверка Качества

## Зачем Эта Глава

Проект состоит не из одной кнопки.

В нем есть:

- Telegram-бот;
- мониторинг кошельков;
- incoming alerts;
- approvals;
- FastCheck;
- DeepCheck;
- Where is money;
- incoming deposit check;
- risk engine;
- jobs и workers;
- админка;
- графы;
- storage;
- provider integrations.

Поэтому QA должен проверять не только "тесты зеленые".

QA должен отвечать:

```text
Пользователь получит правильный ответ?
Аналитик увидит правильную картину?
Риск не сломался?
Граф не стал врать?
Ошибки и partial показываются честно?
```

## Главная Идея QA

В этом продукте опасны два типа ошибок.

1. Техническая ошибка.

Например:

- бот не отвечает;
- worker падает;
- миграция не применяется;
- граф не открывается;
- кнопка не работает;
- provider timeout ломает весь job.

2. Ошибка смысла.

Например:

- `partial` выглядит как нормальный completed;
- `unknown` выглядит как low risk;
- bundle выглядит как один кошелек;
- DeepCheck показывает один шаг без explanation;
- blacklist растворился в среднем score;
- risk reason не соответствует графу;
- линия на графе выглядит как перевод, хотя это context edge.

Вторая ошибка часто опаснее первой.

Техническую ошибку видно быстро. Ошибка смысла может привести к неправильному решению.

## Базовые Команды

Перед обычным релизом минимум:

```bash
npm test
npm run typecheck
```

Если менялись миграции или база:

```bash
npm run db:migrate
```

Если менялись forensic scripts:

```bash
npm run forensic:where-is-money
npm run forensic:debug
```

Before changing scoring thresholds or score floors, run the calibration audit:

```bash
npm run forensic:scoring-audit -- --all --limit 100
```

Review these groups before changing production behavior:

- high score with partial coverage;
- acceptable result with limited coverage;
- decline without hard evidence;
- shadow scoring deltas.

Production Telegram output should still show one final score and one decision.

Эти команды не заменяют ручной QA, но дают быстрый технический baseline.

## Что Покрывают Автотесты

В проекте есть тесты по основным слоям.

### Bot tests

Проверяют:

- команды;
- меню;
- pending actions;
- сообщения;
- форматирование;
- ответы на адреса и tx;
- admin-only команды;
- ошибки Telegram flow.

Цель:

```text
Пользователь не должен застрять в боте.
```

### Admin tests

Проверяют:

- запуск admin server;
- auth;
- загрузку jobs;
- работу console;
- graph rendering data;
- regression cases для UI.

Цель:

```text
Аналитик должен открыть job и увидеть данные.
```

### Forensics tests

Проверяют:

- route search;
- money origin;
- incoming deposit;
- boundary exposure;
- service exposure;
- source bundles;
- cross-chain cases;
- bridge continuation;
- temporal gaps;
- provenance scoring;
- coverage debug.

Цель:

```text
Форензик-логика должна стабильно собирать и объяснять путь денег.
```

### Risk tests

Проверяют:

- risk engine;
- policy;
- proof levels;
- unified wallet risk;
- score и decision;
- hard evidence;
- low/medium/high/critical boundaries.

Цель:

```text
Сильные факты не должны теряться, а слабый контекст не должен превращаться в ложный CRITICAL.
```

### Storage tests

Проверяют:

- repositories;
- labels;
- forensic jobs;
- dashboard data;
- сохранение и чтение evidence.

Цель:

```text
То, что worker посчитал, должно корректно сохраниться и открыться позже.
```

### Runtime tests

Проверяют:

- startup;
- runtime options;
- schedules;
- admin startup.

Цель:

```text
Сервис должен стартовать предсказуемо.
```

## Что Нужно Проверять В Telegram-Боте

Минимальный smoke:

1. `/start` отвечает быстро.
2. Главное меню открывается.
3. `Add wallet` принимает валидный TRON-адрес.
4. Невалидный адрес отклоняется понятным сообщением.
5. `Check address` запускает разовую проверку и не добавляет адрес в мониторинг.
6. `Check tx` принимает tx hash и запускает нужный сценарий.
7. Wallet dashboard открывается.
8. Alert mode переключается.
9. Remove wallet требует подтверждение.
10. Help не обещает невозможного.

Отдельно проверять:

- бот не просит private key;
- бот не просит seed phrase;
- бот не говорит "кошелек чистый навсегда";
- ошибки provider показываются понятным текстом;
- long-running checks уходят в jobs, а не блокируют UI.

## Что Нужно Проверять В Alerts

Для incoming USDT alert:

- watched wallet правильный;
- sender правильный;
- amount правильный;
- tx hash правильный;
- risk level правильный;
- причины риска есть;
- кнопки открывают нужные ссылки;
- LOW не спамит в `risk_only`;
- HIGH и CRITICAL уходят service admins;
- paused wallet не шлет owner alerts;
- alert delivery failure сохраняется и не ломает job без причины.

Для Approval Guard:

- spender правильный;
- token правильный;
- allowance понятный;
- риск объяснен;
- есть read-only revoke guidance;
- бот не пытается подписать revoke.

## Что Нужно Проверять В Jobs

Для каждого forensic job важно:

- правильный kind;
- правильный subject address;
- правильный requestedBy;
- статус отражает реальное выполнение;
- `completed` не используется для failed результата;
- `partial` сохраняет полезные данные;
- `failed` не выглядит как risk decision;
- error message не теряет причину;
- progressJson не ломает админку;
- resultJson открывается в UI;
- old jobs продолжают читаться после изменения формата.

Особенно важно:

```text
Job status и risk decision - разные вещи.
```

QA должен ловить случаи, где `PARTIAL` визуально воспринимается как risk.

## Что Нужно Проверять В FastCheck

FastCheck должен:

- быстро отвечать;
- смотреть subject wallet;
- показывать прямые входящие;
- показывать прямые исходящие;
- показывать top incoming;
- показывать top outgoing;
- показывать services, если они найдены;
- проверять blacklist и labels, если данные доступны;
- не притворяться DeepCheck;
- не добавлять адрес в мониторинг при разовой проверке.

QA-вопросы:

```text
Есть ли очевидный риск?
Видны ли важные соседи?
Понятно ли, что это быстрый профиль, а не полная проверка?
```

## Что Нужно Проверять В Where is money

Where is money должен:

- стартовать от конкретной суммы или tx context;
- находить входящие, которые покрывают сумму;
- строить route назад;
- показывать amount;
- показывать time/gap;
- показывать boundary;
- показывать missing checks;
- различать clean boundary и risk boundary;
- не превращать "не доказали чистоту" в "доказали грязь".

QA-вопросы:

```text
Понятно ли, откуда пришли деньги?
Понятно ли, где trace остановился?
Понятно ли, какие данные не были получены?
```

## Что Нужно Проверять В DeepCheck

DeepCheck должен:

- строить профиль кошелька;
- показывать важные входящие и исходящие;
- показывать services;
- показывать соседей;
- показывать deeper/context связи, если они сохранены;
- показывать limitations, если graph отображает только direct edges;
- не выглядеть как полный route конкретной суммы;
- не скрывать `n/a / unknown` без объяснения.

QA-вопросы:

```text
Это реально профиль кошелька?
Видны ли важные направления?
Если deeper hops не видны, есть ли explanation?
```

## Что Нужно Проверять В Incoming Deposit

Incoming deposit должен:

- стартовать от sender -> watched wallet;
- показывать сумму депозита;
- показывать историю sender;
- показывать funding groups;
- показывать gap;
- показывать boundary;
- показывать clean CEX или history incomplete;
- не путать старые входы с текущим депозитом;
- корректно учитывать spent inventory.

QA-вопросы:

```text
Можно ли понять, как сформировался депозит?
Не смешались ли старые и текущие деньги?
Видно ли, почему депозит acceptable, review или decline?
```

## Что Нужно Проверять В Risk Logic

Risk QA должен ловить смысловые регрессии.

Проверять:

- blacklist не занижается спокойными сигналами;
- hard evidence дает высокий floor;
- weak context не становится CRITICAL без причины;
- coverage не придумывает риск;
- unknown не становится LOW;
- n/a не выглядит как нормальный score;
- policy floor не теряется;
- dampener не снижает hard evidence;
- finalDecision соответствует finalScore и причинам.

Главный вопрос:

```text
Если аналитик увидит этот вывод, он поймет почему система решила именно так?
```

## Что Нужно Проверять В Графах

Графовый QA проверяет не только наличие nodes/edges.

Проверять:

- subject wallet виден;
- direction читается;
- вход и выход не совпадают одной линией без разведения;
- amount labels не закрывают узлы;
- time/gap labels рядом со своей линией;
- цвет подписи соответствует линии;
- bundle выглядит как group, а не как кошелек;
- boundary не теряется на краю;
- services on/off реально меняет слой;
- peer links можно включить и выключить;
- selected edge подсвечивается;
- Analytics справа показывает from/to/amount/time/meaning;
- graph не ломается на старых jobs.

Особенно важно:

```text
Граф должен помогать читать расследование, а не просто показывать все связи сразу.
```

## Что Нужно Проверять В Админке

Админка должна отвечать на вопросы аналитика.

Проверять:

- авторизация работает;
- Jobs загружаются;
- фильтры работают;
- старые jobs видны;
- разные kinds различаются;
- selected job открывает правильный graph;
- Analytics показывает risk, coverage, limitations;
- raw details не ломают экран;
- selected node не перекрывает Jobs;
- selected flow не перекрывает важные панели;
- right rail читабелен;
- search находит node/tx/label;
- refresh не сбрасывает важный контекст без причины.

## Что Нужно Проверять В Provider Failures

Провайдеры могут падать.

QA должен покрывать:

- timeout;
- rate limit;
- пустой ответ;
- malformed response;
- incomplete history;
- slow response;
- network error;
- missing labels;
- missing tx timestamp.

Правильное поведение:

```text
Система сохраняет partial или failed с причиной.
Бот дает понятное сообщение.
Админка показывает limitation.
Risk не выдумывает недостающий факт.
```

## Что Нужно Проверять В Миграциях

Миграции опасны, потому что могут сломать существующую БД.

Проверять:

- новая БД мигрируется с нуля;
- существующая БД мигрируется без падения;
- старые данные читаются;
- constraints не ломают старые rows;
- indexes создаются;
- nullable/non-nullable поля согласованы;
- rollback plan понятен, если миграция рискованная.

Если миграция падает на старых данных, это не "локальная мелочь". Это release blocker или отдельный migration-fix.

## Что Нужно Проверять В Security QA

Минимум:

- `BOT_TOKEN` не логируется;
- `.env` не логируется;
- API keys не попадают в ошибки;
- Telegram ID не показывается чужим пользователям без причины;
- admin-only команды закрыты;
- user не может читать чужие wallets;
- bot не просит private key;
- bot не подписывает транзакции;
- external links безопасны и понятны.

## Что Нужно Проверять В Performance QA

Критичные точки:

- `/start` быстрый;
- меню отвечает быстро;
- long checks уходят в background;
- worker не блокирует bot event loop;
- admin graph открывается на плотных jobs;
- graph pan/zoom не тормозит;
- provider timeout не держит job бесконечно;
- Auto refresh не перегружает backend.

Практический критерий:

```text
Легкие действия должны ощущаться мгновенными.
Тяжелые действия должны давать статус, а не зависать.
```

## Manual Release Checklist

Перед важным релизом:

1. `git status` чистый.
2. `npm run typecheck` проходит.
3. `npm test` проходит.
4. Если есть миграции - `npm run db:migrate` проходит на test DB.
5. `/start` отвечает.
6. Add wallet работает.
7. Check address работает без добавления в мониторинг.
8. Check tx работает.
9. Admin console открывается.
10. Последние jobs видны.
11. Один FastCheck job читается.
12. Один DeepCheck job читается.
13. Один Where is money job читается.
14. Один incoming deposit job читается.
15. Graph не перекрывает панели.
16. Bundle и boundary объясняются.
17. Risk/decision не `unknown` без причины.
18. Provider failure дает partial/failed с причиной.
19. Logs не содержат секретов.
20. README/docs обновлены, если изменилось поведение.

## Что Считать Блокером

Блокеры:

- бот не стартует;
- `/start` не отвечает;
- миграция падает;
- risk score очевидно неверный;
- blacklist не поднимает риск;
- failed job выглядит как completed;
- partial скрывает missing checks;
- admin не открывает jobs;
- graph показывает неправильное направление денег;
- пользователь может увидеть чужие данные;
- секреты попали в logs;
- тесты падают в затронутой области.

Не блокер, но нужно записать:

- мелкая визуальная шероховатость;
- неидеальная формулировка;
- нехватка аккуратной подписи;
- старый job без новых полей, если это объяснено.

## Как Документировать QA-Результат

После QA полезно записывать:

- дата;
- commit;
- какие проверки запускались;
- какие jobs открывали;
- какие адреса или fixtures использовали;
- что прошло;
- что упало;
- какие known limitations остались.

Короткий формат:

```text
Commit:
Checks:
Manual:
Findings:
Known limitations:
Decision:
```

Так мы не теряем контекст между итерациями.

## Короткая Формулировка Для Команды

QA в этом проекте проверяет не только код.

Он проверяет смысл:

```text
Бот отвечает.
Jobs выполняются.
Risk честный.
Граф читаемый.
Partial виден.
Unknown объяснен.
Пользователь не получает ложных обещаний.
Аналитик видит доказательства.
```

Если тест зеленый, но аналитик по экрану делает неправильный вывод, QA не закончен.
