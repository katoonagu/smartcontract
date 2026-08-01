# Golden Pilot V2

Этот пакет — автономная офлайн-эталонная выборка. Код Golden Pilot не импортирует production-модули, не обращается к базе данных, провайдерам или сети и не вычисляет production score либо пользовательский текст.

## Каталоги

- `protocol.json`, `case-catalog.json`, `comparator-contract.json` — опубликованные управляющие контракты;
- `locked/` — неизменяемый пакет после adjudication;
- `locked/cases/` — нейтральные bundles, provenance, две независимые review и итоговая adjudication;
- исходные capture, neutral, reviewer и adjudication workspaces остаются вне Git в `artifacts/golden-v2-2026-07/`.

Для каждого кейса обязательны два разных reviewer. Точный score нельзя фиксировать до adjudication. TBL7 и TQr проверяются только по замороженным evidence bundles. Live-проверки адресов относятся к post-deploy canary Plan B и никогда не становятся Golden expected.

Production comparator реализован в Plan B. Golden-пакет публикует только его входной контракт, выбранную после blind review proportional attribution policy и locked expected artifacts.

## Проверка без изменения lock

```powershell
npm test -- tests/golden-v2
npm run typecheck
node --import tsx scripts/tronUsdtGoldenPilotV2.ts verify --input docs/audit/2026-07-system-audit/golden-v2/locked
```

Последняя команда только читает lock и выводит его SHA-256. После фиксации
final candidate SHA её результат вместе с тестами и typecheck записывается во
внешний write-once `plan-a-gate-receipt-v1.json`; tracked lock ради receipt не
переоткрывается. Утверждённый manifest:
`4d1f2568d3676cf1ee2e4411bc70e056d1f6fc80997b2919e3da4705811cb407`.
Любое изменение уже записанного receipt или locked artifact считается новым пакетом и требует нового явного adjudication, а не перезаписи существующего lock.
