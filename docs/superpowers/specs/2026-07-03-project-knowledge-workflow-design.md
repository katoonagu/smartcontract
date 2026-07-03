# Project knowledge workflow

Дата: 2026-07-03

## Проблема

В проекте уже есть много документации: `README.md`, `CONTEXT.md`,
`docs/project-walkthrough`, `docs/superpowers/specs`,
`docs/superpowers/plans`, `docs/research`.

Проблема не в отсутствии материалов. Проблема в том, что материалы
разделены по датам и историческим этапам. Новый агент или новый чат может
прочитать старый документ и принять старое правило за текущее.

Пример: старые документы нормально относятся к `partial` как к честному
пользовательскому результату. Текущее продуктовое решение другое:
`Where is money` и `Incoming deposit` не должны публиковать финальный
платный score, если основной путь денег не покрыт из-за нашей недозагрузки
истории.

Нужен короткий текущий источник правды, который агент читает перед
существенной работой и обновляет после изменения поведения.

## Цель

Сделать repo-native knowledge base, совместимую с Obsidian, но лежащую
в git рядом с кодом.

Она должна отвечать на вопросы:

- что за продукт мы строим;
- какие режимы проверки существуют;
- что каждый режим обязан доказать;
- какие текущие продуктовые решения уже приняты;
- какие проблемы открыты;
- какие документы исторические, а какие актуальные.

Важное правило: knowledge base должна управлять вектором работы, а не быть
архивом после факта.

## Не цель

Не делаем отдельную Obsidian-базу вне репозитория.

Не копируем чужой системный prompt целиком.

Не превращаем каждый мелкий commit в документационный ритуал. Документацию
обновляем, когда меняется продуктовая логика, scoring policy, lifecycle job,
forensic interpretation, data coverage или важное архитектурное решение.

## Почему внутри репозитория

Отдельная Obsidian-папка быстро разойдется с кодом. Repo-native markdown
лучше:

- агент видит файлы через `rg`, shell и codegraph;
- изменения версионируются вместе с кодом;
- документацию можно ревьюить в PR;
- другой чат получает тот же источник правды;
- Obsidian можно открыть поверх `docs/knowledge`, но git остается главным.

## Что берем из внешних материалов

Из `AllstarGER/one-skill-to-rule-them-all` берем принцип долговременной
памяти: повторяющиеся решения и пользовательские поправки надо фиксировать
в проектных правилах, а не заново вспоминать в каждом чате.

Не берем автоматическое переписывание навыков без явного контекста проекта.
Для нас важнее короткое правило в `AGENTS.md` и читаемая база знаний.

Из `CLAUDE-FABLE-5.md` берем только рабочие привычки:

- не полагаться на память для текущих фактов;
- читать файлы перед выводами;
- проверять актуальность локального состояния;
- не заявлять, что файл или поведение существует, если оно не проверено.

Не берем Claude/Anthropic-specific tool rules, safety blocks и большой
универсальный prompt. Они могут конфликтовать с Codex и проектными правилами.

Ссылки:

- https://github.com/AllstarGER/one-skill-to-rule-them-all
- https://github.com/elder-plinius/CL4R1T4S/blob/main/ANTHROPIC/CLAUDE-FABLE-5.md

## Новая структура

Создаем директорию:

```text
docs/knowledge/
  AGENT_BRIEF.md
  00-index.md
  01-product-principles.md
  02-check-modes.md
  03-job-lifecycle.md
  04-data-sources-tronscan-indexing.md
  05-where-is-money-and-incoming.md
  06-deepcheck.md
  07-risk-scoring-matrix.md
  08-admin-and-bot-ux.md
  09-current-decisions.md
  10-open-problems.md
```

### `AGENT_BRIEF.md`

Короткая памятка на 1-2 страницы. Это первый файл, который агент читает
перед существенной работой в проекте.

Содержит:

- что делает продукт;
- какие есть режимы проверки;
- что нельзя путать;
- какие решения сейчас обязательны;
- где искать детали.

### `00-index.md`

Оглавление knowledge base. Объясняет, какой файл читать для какого типа
задач.

### `01-product-principles.md`

Продуктовые принципы:

- проверка должна объяснять риск через факты;
- hard evidence сильнее слабого контекста;
- absence of data не равен clean;
- пользовательский финальный score нельзя строить на непокрытом основном
  пути денег;
- service boundary отличается от недокачанной истории.

### `02-check-modes.md`

Актуальное разделение режимов:

- `fast check`;
- `deep check`;
- `where is money`;
- `incoming deposit`;
- unified `/check`.

Фиксирует, что режимы не объединяются в один режим. Они разделены по роли,
но могут использовать общую инфраструктуру истории и индекса.

### `03-job-lifecycle.md`

Как job живет:

- created;
- queued;
- running;
- indexing history;
- waiting for index;
- scoring;
- completed;
- failed;
- technical stop.

Документ должен объяснять, что "фоновые" index tasks являются частью одной
пользовательской проверки, а не отдельным продуктовым режимом.

### `04-data-sources-tronscan-indexing.md`

Источник правды по TronScan:

- какие endpoints используем;
- что значит page;
- что значит provider cap;
- как работает пул ключей;
- что делать с 429, 403, 5xx;
- что такое time-window splitting;
- что такое full coverage для hop до target timestamp;
- когда проблема наша, а когда провайдер реально не дал данные.

### `05-where-is-money-and-incoming.md`

Главный документ для provenance:

- `Where is money` объясняет происхождение денег на кошельке;
- `Incoming deposit` объясняет конкретный депозит;
- hop, path, source, boundary простым языком;
- где можно честно остановиться: CEX, DEX, bridge, contract boundary;
- где нельзя честно остановиться: "мы сами поставили маленький лимит";
- почему `History not fully fetched` не должен быть финальным платным
  результатом;
- как job продолжает работу после дозагрузки истории.

### `06-deepcheck.md`

Текущая роль DeepCheck:

- forensic-профиль кошелька;
- прямые и выбранные вторые связи;
- hard evidence checks;
- сервисы, контракты, дренеры, биржи;
- что значит coverage и missing checks;
- что надо улучшить: second layer, full direct boundary, hard evidence
  checks для участников.

### `07-risk-scoring-matrix.md`

Текущая scoring policy:

- hard evidence floor;
- policy floor;
- pattern floor;
- dampener;
- acceptable/review/decline;
- `score_valid`;
- когда score можно показывать;
- когда score заблокирован технически.

### `08-admin-and-bot-ux.md`

Как показываем:

- Telegram `/check`;
- Admin jobs;
- graph;
- progress;
- technical stop;
- final score;
- что показывать пользователю, а что только в admin/debug.

### `09-current-decisions.md`

Короткий список текущих решений. Это самый важный файл после
`AGENT_BRIEF.md`.

Стартовые решения:

- режимы проверки не объединяем;
- `/check` использует `fast check`, `deep check`, `where is money`;
- `Where is money` объясняет происхождение денег;
- `Incoming deposit` объясняет конкретный входящий депозит;
- финальный score нельзя публиковать, если основной путь денег не покрыт
  из-за недозагрузки истории;
- `History not fully fetched` не должен быть конечным пользовательским
  результатом для платной forensic-проверки;
- используем TronScan, без ручного CSV и без дополнительных провайдеров;
- длинная проверка может идти долго, если это нужно для полного ответа;
- пул TronScan API-ключей является нормальной частью архитектуры;
- старые specs/plans являются историческими деталями, но текущие решения
  живут в `docs/knowledge`.

### `10-open-problems.md`

Backlog архитектурных проблем:

- `partial_budget_exhausted` сейчас может стать финальным стопом;
- targeted history inline limit слишком мал;
- partial index state должен уметь продолжаться;
- нужен нормальный progress по индексатору;
- DeepCheck second layer не должен показывать пустые метрики;
- нужно разделить missing checks на provider errors, budget limits,
  service-boundary stops и diagnostic notes.

## Правило для `AGENTS.md`

Добавляем блок:

```md
## Project Knowledge Workflow

Before substantial code, architecture, scoring, admin, bot, or forensic changes:
1. Read `docs/knowledge/AGENT_BRIEF.md`.
2. Read the relevant `docs/knowledge/*` page for the area being changed.
3. If the work changes product behavior, scoring policy, job lifecycle,
   data coverage, or forensic interpretation, update
   `docs/knowledge/09-current-decisions.md` or the relevant knowledge page
   in the same PR/commit.
4. If the work exposes a recurring problem but does not fix it, add it to
   `docs/knowledge/10-open-problems.md`.
5. Old `docs/superpowers/*` and `docs/research/*` files are historical
   detail. Current behavior is defined by `docs/knowledge/*`.
```

Это правило не заменяет чтение кода. Оно задает стартовый контекст и
обязует обновлять текущую документацию, когда меняется поведение.

## Как агент должен работать после внедрения

Перед существенной задачей:

1. Открыть `AGENT_BRIEF.md`.
2. Открыть релевантный knowledge-файл.
3. Проверить код, а не только документацию.
4. Сформулировать план с учетом текущих решений.

После существенной задачи:

1. Обновить relevant knowledge page, если поведение изменилось.
2. Добавить нерешенную проблему в `10-open-problems.md`, если она выявлена.
3. В финальном ответе указать, обновлялась документация или нет.

## Критерии успеха

- Новый чат может за 2-3 минуты понять текущую архитектуру продукта.
- Агент больше не путает "один общий provenance режим" с разделением
  `fast/deep/where/incoming`.
- `History not fully fetched` фиксируется как проблема продукта, а не как
  нормальный финальный результат.
- Документация обновляется вместе с изменением поведения.
- Старые specs/plans остаются полезными, но не спорят с текущим источником
  правды.

## План внедрения после утверждения

1. Создать `docs/knowledge`.
2. Написать стартовые файлы knowledge base.
3. Обновить `AGENTS.md` правилом Project Knowledge Workflow.
4. Проверить, что в новых файлах нет противоречий с текущими решениями.
5. Закоммитить документацию отдельным commit.

