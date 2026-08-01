# Plan 4: ручная Telegram-приёмка

Этот harness проверяет Telegram UX только на санитизированных typed fixtures.
Он использует production-цепочку `adaptTelegramForensicResult` →
`renderTelegramForensicResult`, но не запускает bot, providers, PostgreSQL или
runtime. Production DB/runtime/Telegram не изменяются и release не выполняется.

## Dry-run

```powershell
node --import tsx scripts/renderTelegramUxAcceptance.ts --dry-run
```

Каждый запуск сохраняется в новом
`.tmp/plan4/manual/<candidate SHA>/<immutable run ID>/` без удаления или
перезаписи предыдущих артефактов:

- `manifest.json` — candidate SHA, fixture ID, REQ/AC, reviewer, result и
  screenshot filename;
- `messages/*.html` — ровно тот HTML, который вернул production renderer;
- `messages/*.json` — fixture ID, проверяемый кошелёк, REQ/AC и тот же HTML.

Секреты, test chat ID и Telegram API response в артефакты не записываются.
Candidate SHA хранится в manifest и имени каталога, но не добавляется в
пользовательское сообщение.

## Набор из 15 записей

1. `GOLDEN_FINAL_AML`
2. `GOLDEN_WHERE_PRELIMINARY`
3. `GOLDEN_NO_FINAL_TECHNICAL`
4. `GOLDEN_TRUE_NO_ACTIVITY`
5. `GOLDEN_VERIFY20_ACTIVE_NO_DEBIT`
6. `GOLDEN_VERIFY20_EXACT_DEBIT`
7. `GOLDEN_BRIDGERS_ACTIVE`
8. `GOLDEN_BRIDGERS_ZERO`
9. `GOLDEN_BRIDGERS_ALLOWANCE_UNKNOWN`
10. `GOLDEN_USDD_PSM`
11. `GOLDEN_GASFREE_ACCOUNT`
12. `THJ_COLLECTOR_VARIANTS`
13. `TKG_LOW_BALANCE_AND_COVERAGE`
14. `OFFICIAL_USDT_AND_PSM_OUTBOUND`
15. `INCOMING_FAIL_CLOSED`

Первые 11 записей обязаны byte-for-byte совпасть с утверждёнными golden
messages до записи артефактов или тестовой отправки. Всего harness создаёт 19
сообщений: четыре составные записи содержат по две fixture.

## Запись результата review

Для каждой записи reviewer вручную проверяет ссылки, риск, главную причину,
маршрут, покрытие и отсутствие runtime/LLM/технического мусора. В `manifest.json`
фиксируются candidate SHA, fixture ID, ожидаемые REQ/AC, reviewer, result и
screenshot filename. После проверки reviewer сохраняет screenshot с указанным
именем и меняет результат в своей копии evidence manifest. Пока screenshots и
ручной review не выполнены, статус остаётся `manual acceptance pending`.

## Опциональная отправка в отдельный test chat

Отправка запрещена по умолчанию. Она допустима только после отдельного
разрешения и при одновременном выполнении всех условий:

```powershell
$env:PLAN4_TELEGRAM_ALLOW_SEND='1'
$env:PLAN4_TELEGRAM_TEST_BOT_TOKEN='<dedicated test token>'
$env:PLAN4_TELEGRAM_TEST_CHAT_ID='<dedicated numeric test chat ID>'
$env:BOT_TOKEN='<production token used only as a comparison guard>'
$env:SERVICE_ADMIN_TG_IDS='<configured production admin IDs>'
node --import tsx scripts/renderTelegramUxAcceptance.ts --send
```

`BOT_TOKEN` и непустой `SERVICE_ADMIN_TG_IDS` обязательны как production
references: без них отправка fail-closed. Test token не должен совпадать с
`BOT_TOKEN`, а canonical numeric test chat — ни с одним canonical ID из
`SERVICE_ADMIN_TG_IDS`. Сообщения отправляются последовательно как HTML с
отключённым preview ссылок и bounded timeout. Harness не выводит и не сохраняет
token, chat ID, Telegram request URL или response. Ошибка сети возвращается
только как санитизированный `telegram_test_send_failed`.

Runtime/version, migration verification, delivery retries и `/version`
проверяются отдельными runtime/schema тестами. Этот synthetic harness их не подтверждает.
