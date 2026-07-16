# Unified Telegram UX Implementation Plan (Plan 4)

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `subagent-driven-development` to implement this plan task-by-task. Every task
> has a frozen RED gate, separate spec-review and code-quality-review, one
> bounded commit and a clean-worktree check.

> **Status:** утверждён 2026-07-16. Код Plan 4 не реализован.
>
> **Execution rule:** после утверждения выполнять через
> `subagent-driven-development` в отдельном worktree, строго по задачам ниже.
> Для каждой задачи обязательны отдельные spec-review и code-quality-review,
> затем один ограниченный commit и проверка clean worktree.

**Goal:** привести Where Is Money, DeepCheck, Incoming Deposit, Contract и
Approval к одному понятному детерминированному Telegram UX, не меняя данные,
скоринг, lifecycle, delivery или release-поведение Plans 1–3.

**Architecture:** typed результаты Plans 1–3 адаптируются в единый
`TelegramForensicResultV1`, затем один renderer строит Telegram HTML. Renderer
не вычисляет риск и не читает LLM/cache JSON: он показывает только проверенный
кошелёк, действующий typed score anchor или честный no-final, subject-bound
факты, маршруты и `ForensicCoverageV2`. Старые formatter-функции остаются
тонкими compatibility wrappers до Plan 5. Approval использует отдельный
`approval_safety` semantic branch без AML/Where/provenance; общими остаются
только visual grammar, безопасные ссылки и HTML renderer primitives.

**Tech stack:** TypeScript, Vitest, grammY `ParseMode.HTML`, существующие
`ScoreAnchorV2`, `NarrativeFactV2`, `ForensicCoverageV2`,
`ApprovalSafetyAssessmentV2`, `ContractDecisionV2`, `TelegramHtmlMessage`.
Новых зависимостей и миграций нет.

---

## 0. Approval checkpoint и неизменяемые границы

### 0.1 Baseline

- Текущий проверенный `master` после локального merge Plan 3:
  `bb6fe0fabb71ac8da04bde84083cd2b93703f5ab`.
- После утверждения и отдельного commit только этого plan document исполнитель
  динамически фиксирует:

  ```powershell
  $env:PLAN4_BASE_SHA = (git rev-parse HEAD).Trim()
  git show --stat --oneline $env:PLAN4_BASE_SHA
  ```

- `PLAN4_BASE_SHA` нельзя заранее подменять SHA из этого черновика. Он обязан
  указывать на фактический `master`, содержащий Plans 1–3 и утверждённый Plan 4.
- Production остаётся на предыдущем runtime до Plan 5. Ни одна задача Plan 4
  не применяет migration, не перезапускает bot/admin/workers и не меняет
  рабочую PostgreSQL.

### 0.2 Ownership Plan 4

Plan 4 владеет только:

- `REQ-06…REQ-14`;
- Telegram UX-частями `REQ-15`, `REQ-18`, `REQ-20`, `REQ-22`, `REQ-27`,
  `REQ-28`, `REQ-31…REQ-34`, `REQ-38`;
- primary acceptance: `AC-07`, `AC-08`, `AC-09`, `AC-12`, `AC-13`, `AC-20`,
  `AC-21`, `AC-24`, `AC-27`;
- только unified-renderer regression для `AC-39`.

Plan 4 интегрирует уже реализованные контракты, но не меняет их семантику.
Если renderer не может честно показать результат из-за неправильного producer,
score anchor, coverage, runtime или delivery state, задача возвращается
владельцу Plan 1–3. Presentation не «чинит» данные эвристикой.

### 0.3 Forbidden scope

Запрещено изменять:

- risk score, policy rows, thresholds, decisions и USDD modifiers;
- `ScoreAnchorV2`, `ForensicCoverageV2`, allowance/contract semantics;
- forensic reconciliation, immutable result, delivery claim/lease/settlement;
- migrations, schema receipt/verifier, PostgreSQL repositories;
- Admin UI/API;
- runtime startup, `/version`, polling/webhook и deployment;
- package dependencies;
- Plans 5 и Address Poisoning implementation/copy/tests.

Forbidden path audit после каждой задачи и в финале:

```powershell
git diff --name-only $env:PLAN4_BASE_SHA..HEAD -- `
  migrations .gitattributes package.json package-lock.json `
  scripts/migrate.ts src/storage src/runtime src/risk src/admin `
  src/forensics/telegramDeliveryState.ts `
  src/forensics/telegramDeliveryWorker.ts `
  src/monitor/addressPoisoning.ts `
  src/monitor/addressPoisoningWorker.ts `
  src/alerts/addressPoisoningAlert.ts `
  tests/monitor/addressPoisoning.test.ts `
  tests/monitor/addressPoisoningWorker.test.ts `
  tests/alerts/addressPoisoningAlert.test.ts
```

Ожидаемый результат: пусто. `src/approvals/approvalWorker.ts` разрешён только
для передачи уже рассчитанного `ApprovalSafetyAssessmentV2` в presentation;
его scoring/storage/provider logic менять нельзя. `src/bot/createBot.ts` и
`src/alerts/formatters.ts` разрешены только как wiring/compatibility surface.

---

## 1. Target presentation contract

### 1.1 Единая модель

Добавить presentation-only типы в `src/telegram/forensicPresentation.ts`:

```ts
type TelegramForensicResultKindV1 =
  | "where_preliminary"
  | "wallet_final"
  | "deep_context"
  | "incoming_deposit"
  | "contract_safety"
  | "approval_safety"
  | "technical_result";

type ApprovalAudienceContextV1 =
  | "watched_wallet"
  | "external_address_check";

type ApprovalPresentationInputV1 = {
  assessment: ApprovalSafetyAssessmentV2;
  audienceContext: ApprovalAudienceContextV1;
  exactDebitProfile: ApprovalDrainProvenanceProfile | null;
};

type ApprovalPresentationV1 = {
  owner: AddressRefV1;
  spender: AddressRefV1;
  tokenContract: AddressRefV1;
  audienceContext: ApprovalAudienceContextV1;
  allowanceState: "confirmed_active" | "confirmed_zero" | "failed" | "stale";
  confirmedAllowanceRaw: string | null;
  isUnlimited: boolean | null;
  balanceAtRiskRaw: string | null;
  debitState: "confirmed" | "not_found" | "unknown";
  debitAmountRaw: string | null;
  exactVerify20: boolean;
  campaignEvidenceIds: string[];
  serviceSession: KnownServiceSessionV1 | null;
};

type TelegramAssessmentPresentationV1 =
  | {
      kind: "aml_risk";
      score: number;
      level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
      decision: "ACCEPTABLE" | "REVIEW" | "DECLINE";
      indicator: "🟢" | "🟡" | "🟠" | "🔴";
      actionTextKey: string | null;
      anchorId: string;
      preferredFactId: string;
    }
  | {
      kind: "contract_risk";
      score: number;
      level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
      decision: "ACCEPTABLE" | "REVIEW" | "DECLINE";
      indicator: "🟢" | "🟡" | "🟠" | "🔴";
      actionTextKey: string;
      evidenceIds: string[];
    }
  | {
      kind: "wallet_safety";
      score: number | null;
      level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN";
      action: "NONE" | "REVOKE_IF_UNUSED" | "REVOKE_NOW" | "CONFIRM_ALLOWANCE";
      indicator: "🟢" | "🟡" | "🟠" | "🔴" | "⚪";
      amlScoreImpact: 0;
    };

type TelegramRoutePresentationV1 = {
  routeId: string;
  direction: "inbound" | "outbound";
  from: AddressRefV1;
  to: AddressRefV1;
  amountRaw: string;
  asset: "USDT" | "USDD" | "TRX" | "BTTOLD" | "other";
  share: number | null;
  transferCount: number | null;
  evidenceIds: string[];
};

type TelegramForensicResultV1 = {
  version: "telegram-forensic-result-v1";
  kind: TelegramForensicResultKindV1;
  locale: "ru" | "en";
  titleTextKey: string;
  checkedWallet: AddressRefV1;
  resultState: "final" | "preliminary" | "no_final" | "technical_limit";
  assessment: TelegramAssessmentPresentationV1 | null;
  primaryFact: NarrativeFactV2 | null;
  secondaryFacts: NarrativeFactV2[];
  routes: TelegramRoutePresentationV1[];
  coverage: ForensicCoverageV2 | null;
  legacyCoverage: { selectedCount: number | null; warningTextKey: string } | null;
  approval: ApprovalPresentationV1 | null;
  contractDecision: ContractDecisionV2 | null;
  technicalLimitTextKey: string | null;
};
```

`AddressRefV1` использует канонический URL:
`https://tronscan.org/#/address/<address>`. Valid TRON address сокращается,
например `TGyt…ZAZD`, но `href` содержит полный адрес. Первые четыре символа
display text обязаны точно совпадать с первыми четырьмя символами полного
адреса, а последние четыре — с последними четырьмя символами полного адреса:
нельзя переставлять или пропускать символы. Невалидный адрес выводится только
как escaped plain text, без ссылки.

Типы находятся в presentation namespace и не заменяют contracts Plans 1–3.
Адаптеры обязаны копировать source IDs и не создавать evidence, score или
coverage.

### 1.2 Инварианты адаптации

1. `assessment.kind="aml_risk"` строится только из valid saved
   `ScoreAnchorV2`, привязанного к checked wallet, mode, policy row, evidence и
   единственному `preferredFactId`.
2. Для AML `primaryFact.id === assessment.preferredFactId`. Этот факт всегда
   показывается первым в `🔎 Почему такая оценка`.
3. Subject/mode/evidence mismatch даёт `no_final`, а не fallback score.
4. Where preliminary может показать valid preliminary score и причины, но не
   decision/action и не состояние DeepCheck.
5. Approval создаёт отдельный `kind="approval_safety"`, только
   `assessment.kind="wallet_safety"` и `ApprovalPresentationV1` из
   `ApprovalSafetyAssessmentV2`. Он сохраняет `amlScoreImpact: 0`, не содержит
   AML `ScoreAnchorV2`, не попадает в Where/Deep/Incoming provenance и не
   превращается в решение обменника. Единый renderer означает общий visual
   language, escaping, links и section rhythm, но не объединение смыслов.
   Для `kind="approval_safety"` поля `primaryFact`, `secondaryFacts`, `routes`,
   `coverage`, `legacyCoverage` и `contractDecision` обязаны быть пустыми;
   `approval` обязателен. Для любого другого kind `approval` обязан быть null.
6. Contract создаёт только `assessment.kind="contract_risk"` из
   `ContractDecisionV2.finalSource="deterministic"` и `llm=null`; contract
   evidence не маскируется под AML anchor.
7. `NarrativeFactV2` рендерится через исчерпывающий deterministic copy catalog
   по `factTextKey` и typed parameters. Raw provider text, selectors, AI reason,
   verdict, confidence, recommendation и citations не имеют renderer path.
8. Unknown/unsupported `factTextKey` не выводится как raw string. Для active
   preferred fact это fail-closed `no_final`; для secondary context — omission
   с diagnostic в тестовом adapter result.
9. Один physical transfer/evidence ID не повторяется между mode sections.
10. Routes показывают до двух конкретных путей в стабильном порядке. Остальные
    агрегируются одной строкой с количеством и суммой; evidence не теряется.
11. `ApprovalPresentationV1.owner` обязан совпадать с
    `ApprovalAllowanceStateV2.ownerAddress` и checked wallet;
    `spender` — с `spenderAddress`, `tokenContract` — с official TRON USDT.
    Foreign owner/spender/token assessment отклоняется fail-closed.
12. Approval всегда показывает четыре разные сущности: проверяемый кошелёк как
    владелец USDT/approval; spender-контракт; текущее allowance state; exact
    debit state. `debitState="not_found"` означает только отсутствие найденного
    exact debit, не доказательство отсутствия других переводов.
    `debitAmountRaw` берётся только из `ApprovalDrainProvenanceProfile.amountRaw`
    при `evidenceStrength="exact_approval_and_transfer_from"` и полном совпадении
    victim/subject, spender и approval tx с allowance/assessment. При этом
    `assessment.exactDebit` и `debitFoundFromSubject` обязаны быть `true`.
    Exact-debit assessment без такого profile не рендерится как confirmed и
    блокируется fail-closed.
13. `confirmed_active` и unlimited/finite разрешено показывать только при
    `allowance.source="official_usdt_allowance"`, non-null current raw value и
    valid freshness. `failed/stale` всегда выводится как «текущее состояние
    подтвердить не удалось» и никогда как active/revoked.
14. `audienceContext="watched_wallet"` означает только, что адрес добавлен в
    monitoring. Это не доказывает владение приватным ключом. Любое on-chain
    действие формулируется условно: «Если это ваш кошелёк…».
15. Обычный пользовательский payload не содержит runtime label, Git branch или
    SHA. `Runtime: master-…` остаётся только в `/version`, Admin и diagnostics;
    эти поверхности не меняются в Plan 4.
16. `where_preliminary` требует `assessment.kind="aml_risk"`, но
    `actionTextKey=null`; final AML требует canonical action key. Renderer не
    скрывает существующий action — invalid state закрывается fail-closed.

### 1.3 Единый порядок и текстовая архитектура

Final result:

1. `🧾` title и linked checked wallet;
2. validated assessment indicator, score/level и одно действие;
3. `🔎 Почему такая оценка` с preferred score-driver первым;
4. до двух secondary facts, только если они меняют понимание результата;
5. `💸 Движение денег` с direction, linked parties, typed amount/share/count;
6. `<b>Покрытие</b>` без отдельного emoji, с available/selected/excluded и
   typed limitation.

Exact punctuation и строки зафиксированы независимыми golden payloads в §1.7.

Правила:

- рекомендуемый normal/final/approval формат — 10–15 непустых строк основного
  текста; no-final и true no-activity могут быть короче, если дополнительных
  фактов нет: renderer не добивает объём повторениями и техническим мусором;
- максимум четыре emoji headings; цветной risk indicator не создаёт
  дополнительную секцию;
- checked wallet обязателен в каждом типе результата;
- risk/action есть только при valid anchor/decision;
- `Почему` говорит, что найдено и почему это влияет на оценку;
- `Вывод` и действие встраиваются в risk/action строку либо в одну короткую
  concluding строку, без повторения одной рекомендации;
- inbound provenance и outgoing counterparty risk — разные факты/маршруты;
- в пользовательском Telegram-тексте bridge/router/DEX описывается понятными
  словами «мост или обменный сервис»; точная техническая service identity
  остаётся в evidence и Admin, но не мешает пониманию сообщения;
- HTX/collector/USDD PSM описываются по своей роли и AML-смыслу, без
  автоматического обвинения в краже;
- blacklist/frozen relation формулируется прямо и с хронологией, если она есть;
- transferFrom сам по себе не называется drainer proof;
- Verify20 exact pattern, active allowance, balance at risk, no debit found и
  campaign context остаются отдельными утверждениями;
- transaction expiration нигде не выводится.
- суммы, проценты и transfer count выводятся только из соответствующего typed
  fact; отсутствие поля означает отсутствие строки, а не `0`;
- никакого `Runtime: master-…`, raw code, selector, LLM verdict/confidence/
  reason, provider dump или внутреннего diagnostic code в user payload;
- пользовательский Telegram-текст не содержит технических слов `owner`,
  `spender`, `allowance`, `approval` и `Bridge/router/DEX`: вместо них
  используются «кошелёк, который выдал доступ», «контракт, получивший доступ»,
  «разрешение на управление USDT», «доступ к USDT» и «мост или обменный
  сервис». Внутренние typed contracts и code identifiers не переименовываются;
- максимум два конкретных маршрута; третий и последующие агрегируются;
- renderer не показывает кнопку или текст, создающий впечатление, что бот сам
  отзывает approval либо подписывает on-chain transaction. Допустимы только
  информационные ссылки вроде «Открыть в Tronscan»/«Как отозвать вручную».

Это target Plan 4, а не описание уже выпущенного поведения. После реализации
Task 10 заменит в knowledge текущие compact-body/runtime-marker правила на
проверенный medium format. До GREEN knowledge остаётся описанием current code и
не переписывается заранее.

Preliminary Where result использует тот же shell, но:

- title `Откуда деньги — предварительный результат`;
- checked wallet и preliminary risk/причины обязательны, если anchor valid;
- нет `не принимать`, compliance action, DeepCheck status и общего
  `Where Is Money завершил проверку`;
- если score anchor отсутствует, показывается конкретная coverage/technical
  причина без числового риска.

No-final/technical-limit:

- neutral `⚪` без `/100`, risk level и exchange action;
- checked wallet обязателен;
- конкретно указывается, что удалось проверить и какое ограничение остановило
  расчёт;
- `0 входящих / 0% / оставшиеся 100%` запрещено, если denominator неизвестен;
- `hard_safety_limit_exceeded` честно остаётся no-final. Plan 4 не расширяет
  runtime page limits.

### 1.4 Approval wallet-safety presentation

Approval — самостоятельный результат технической безопасности кошелька. В нём
нет секций `Движение денег` и `Покрытие`, если эти данные пришли из Where/Deep:
происхождение средств не подмешивается к approval. Допустим только exact debit
или exact service-session transfer, относящийся к owner/spender assessment.

Каждое сообщение о доступе к USDT в фиксированном порядке показывает:

1. `Проверяемый кошелёк` — кошелёк, который выдал доступ к USDT, linked
   AddressRef;
2. `Контракт, получивший доступ к USDT` — отдельный linked AddressRef;
3. `Разрешение на управление USDT сейчас` — active unlimited/finite, zero или
   unconfirmed;
4. `Фактическое списание` — confirmed/not found/unknown;
5. wallet-safety level и конкретный Verify20/Bridgers context;
6. ownership-aware action.

Action catalog:

| Состояние | `watched_wallet` | `external_address_check` |
|---|---|---|
| Verify20 `confirmed_active` | `На отслеживаемом кошельке найдено активное разрешение. Если это ваш кошелёк — отзовите разрешение на управление USDT и до этого не пополняйте его.` | `Если вы проверяете чужой кошелёк — не переводите на него деньги, пока владелец не объяснит и не отзовёт опасное разрешение.` |
| Verify20 exact debit | Та же условная owner-action; отдельно указать подтверждённое списание, но не писать «деньги украдены» без theft evidence | Та же external-address action; не приписывать владельцу участие в атаке |
| Bridgers `confirmed_zero` | `Разрешение больше не активно. Действий не требуется.` | `Разрешение больше не активно. Само это разрешение не требует действий.` |
| Bridgers `confirmed_active` | `Swap объяснён, риск низкий. Если это ваш кошелёк, неиспользуемое разрешение можно отозвать как цифровую гигиену.` | `Swap объяснён, риск низкий. Владелец может отозвать неиспользуемое разрешение как цифровую гигиену.` |
| Bridgers `failed/stale` | `Текущее состояние подтвердить не удалось. Если это ваш кошелёк — проверьте разрешение напрямую в официальном контракте USDT.` | `Нельзя утверждать, что разрешение активно или отозвано. Попросите владельца подтвердить текущее разрешение на управление USDT.` |

Verify20 rules:

- active только после fresh direct call official USDT;
- обязательно `безлимитный` либо точный finite amount;
- balance-at-risk — только typed current USDT balance;
- `exactDebit/debitFoundFromSubject` показывается отдельно;
- Verify20 campaign call/source/recipient counts и BTTOLD sequence — context;
- no exact debit → «списание не найдено», не «кражи не было»;
- exact debit → «списание через этот контракт подтверждено», не «деньги
  украдены»,
  если отдельного theft evidence нет.

Bridgers rules:

- exact `KnownServiceSessionV1` объясняет swap/bridge и low wallet-safety;
- `confirmed_zero`: approval больше не активно, action `NONE`;
- `confirmed_active`: swap объяснён, отзыв только optional hygiene;
- `failed/stale`: current state unknown, score/action uses
  `UNKNOWN/CONFIRM_ALLOWANCE`; historical approval event не называется current;
- moved amount/delay/action выводятся только из exact service session.

### 1.5 Coverage wording

При `ForensicCoverageV2` renderer показывает:

- `availableTransferCount` — сколько входящих переводов было доступно;
- `selectedTransferCount` — сколько относится к выбранной сумме;
- `excludedTransferCount` — сколько проверено, но исключено;
- `tracedShare` и сумма — только при известном denominator;
- подтверждённые `exclusionReasons`/`limitations`, не догадки.

Пример `24 / 10 / 14`:

```text
Доступно 24 входящих перевода. К выбранной сумме относятся 10.
Ещё 14 проверены, но исключены: это технические GasFree-комиссии.
По выбранной сумме прослежено 83%; для оставшихся 17% источник не подтверждён.
```

Legacy coverage без denominator:

```text
К проверяемой сумме отобрано 10 входящих переводов.
Общее число доступных переводов в старом результате не сохранено.
```

Нельзя писать, что остальные «не проверили», если producer пометил их как
excluded; нельзя выдумывать `100% unknown`.

### 1.6 Deterministic domain copy

Copy catalog обязан иметь отдельные шаблоны минимум для:

- outgoing blacklist/frozen counterparty и later-frozen chronology;
- inbound bridge/router/DEX/service boundary;
- HTX current/historical policy source;
- collector-only и collector + independent signal;
- low-balance latest-five principal movement;
- true no-activity;
- exact Verify20 fingerprint, active allowance, exact debit/no debit,
  balance at risk и campaign/BTTOLD context;
- exact known-service/Bridgers session;
- official USDT и structural GasFree roles;
- USDD PSM inbound/outbound exposure, exact share and direction;
- provider timeout/malformed/revert/failure as unconfirmed current allowance;
- no-final coverage and technical limit.

USDD PSM wording is bounded: это децентрализованный сервис обмена USDT/USDD с
общей ликвидностью; после общего пула более ранний источник сложнее отделить.
Он может использоваться как для обычного обмена, так и для усложнения
трассировки. Renderer не пишет, что отмывание доказано, и не обещает, что
Tether обязательно заморозит или не заморозит средства.

### 1.7 Exact golden message fixtures

`tests/fixtures/telegram/remediationTelegramGoldenMessages.ts` экспортирует
ровно следующие HTML payloads. `<a href>` содержит полный canonical Tronscan
URL; visible address сокращён. Пробелы, порядок строк, punctuation и отсутствие
`Runtime:` входят в snapshot contract. Fixtures строятся только из typed cases,
но expected strings не генерируются renderer-ом, иначе golden test был бы
самоподтверждающимся.

#### `GOLDEN_FINAL_AML`

```html
🧾 <b>Проверка кошелька</b>
Кошелёк: <a href="https://tronscan.org/#/address/TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD">TGyt…ZAZD</a>

🔴 <b>90/100 — критический риск</b>
Операцию не проводить.

🔎 <b>Почему такая оценка</b>
Кошелёк отправил 1 176 317 USDT на <a href="https://tronscan.org/#/address/TWGCtirDx8LJYpUnBM13hPcUPAoQqyTdTm">TWGC…TdTm</a> — 100% исходящей суммы, 2 перевода.
Сейчас этот получатель находится в чёрном списке USDT; его заблокировали после этих переводов.

💸 <b>Движение денег</b>
<a href="https://tronscan.org/#/address/TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD">TGyt…ZAZD</a> → <a href="https://tronscan.org/#/address/TWGCtirDx8LJYpUnBM13hPcUPAoQqyTdTm">TWGC…TdTm</a>: 1 176 317 USDT (100%, 2 перевода).
83% проверяемой суммы поступило через мост или обменный сервис; до общего пула источник не разделяется по клиентам.

<b>Покрытие</b>
Доступно 24 входящих перевода. К выбранной сумме относятся 10.
Ещё 14 проверены, но исключены: это подтверждённые технические GasFree-комиссии.
```

#### `GOLDEN_WHERE_PRELIMINARY`

```html
🧾 <b>Откуда деньги — предварительный результат</b>
Кошелёк: <a href="https://tronscan.org/#/address/TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD">TGyt…ZAZD</a>

🟠 <b>Предварительный риск: 78/100</b>

🔎 <b>Почему такая оценка</b>
83% выбранной суммы пришло через кроссчейн-мост с общей ликвидностью.
После такого сервиса более ранний источник сложнее отделить от переводов других клиентов.

💸 <b>Движение денег</b>
<a href="https://tronscan.org/#/address/TBXSw8fM4jpQkGc6zZjsVABFpVN7UvXPdV">TBXS…XPdV</a> → <a href="https://tronscan.org/#/address/TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD">TGyt…ZAZD</a>: 976 891,047722 USDT (83%).

<b>Покрытие</b>
К выбранной сумме относятся 10 входящих переводов; прослежено 83% суммы.
Оставшиеся 17% не удалось связать с подтверждённым источником.
```

#### `GOLDEN_NO_FINAL_TECHNICAL`

```html
🧾 <b>Проверка кошелька</b>
Кошелёк: <a href="https://tronscan.org/#/address/TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD">TGyt…ZAZD</a>

⚪ <b>Итоговая оценка не рассчитана</b>

🔎 <b>Что произошло</b>
Источник данных не отдал старые переводы, необходимые для расчёта.

<b>Покрытие</b>
К проверяемой сумме отобрано 10 входящих переводов.
Общее число доступных переводов в этом результате не сохранено.
До повторной проверки не проводите операцию.
```

#### `GOLDEN_TRUE_NO_ACTIVITY`

```html
🧾 <b>Проверка кошелька</b>
Кошелёк: <a href="https://tronscan.org/#/address/TRivmRsLwVRZETXqPdv98raFPHMkwuMnxP">TRiv…MnxP</a>

⚪ <b>Оценка не рассчитана</b>

🔎 <b>Что нашли</b>
В проверенном периоде нет входящих переводов основной суммы, происхождение которых можно оценить.
Технические комиссии не считаются движением основной суммы.
```

#### `GOLDEN_VERIFY20_ACTIVE_NO_DEBIT`

```html
🛡 <b>Проверка доступа к USDT</b>
Проверяемый кошелёк — кошелёк, который выдал доступ к USDT: <a href="https://tronscan.org/#/address/TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD">TGyt…ZAZD</a>
Контракт, получивший доступ к USDT: <a href="https://tronscan.org/#/address/TFagrFLKwcuRvXobE9TmQxdAM7BEjvnXzK">TFag…nXzK</a>
Разрешение на управление USDT сейчас: активное, безлимитное; подтверждено напрямую в официальном контракте USDT.
Фактическое списание через этот контракт: не найдено.

🔴 <b>90/100 — критический риск для кошелька</b>

🔎 <b>Почему такая оценка</b>
Контракт имеет точный Verify20-шаблон массовых списаний с множества кошельков.
Контракту доступен текущий баланс: 4 084,665 USDT.
Связи кампании и BTTOLD-последовательность — контекст, а не доказательство кражи.

🧭 <b>Что делать</b>
Если вы проверяете чужой кошелёк — не переводите на него деньги, пока владелец не объяснит и не отзовёт опасное разрешение.
```

#### `GOLDEN_VERIFY20_EXACT_DEBIT`

```html
🛡 <b>Проверка доступа к USDT</b>
Проверяемый кошелёк — кошелёк, который выдал доступ к USDT: <a href="https://tronscan.org/#/address/TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD">TGyt…ZAZD</a>
Контракт, получивший доступ к USDT: <a href="https://tronscan.org/#/address/TFagrFLKwcuRvXobE9TmQxdAM7BEjvnXzK">TFag…nXzK</a>
Разрешение на управление USDT сейчас: активное, безлимитное; подтверждено напрямую в официальном контракте USDT.
Фактическое списание через этот контракт: подтверждено, 13 302 USDT.

🔴 <b>95/100 — критический риск для кошелька</b>

🔎 <b>Почему такая оценка</b>
Найдена точная Verify20-цепочка и списание USDT через этот контракт.
Контракту доступен текущий баланс: 4 084,665 USDT.
Это подтверждает движение средств, но само по себе не доказывает кражу и не показывает, кто управлял операцией.

🧭 <b>Что делать</b>
На отслеживаемом кошельке найдено активное разрешение. Если это ваш кошелёк — отзовите разрешение на управление USDT и до этого не пополняйте его.
```

#### `GOLDEN_BRIDGERS_ACTIVE`

```html
🛡 <b>Проверка доступа к USDT</b>
Проверяемый кошелёк — кошелёк, который выдал доступ к USDT: <a href="https://tronscan.org/#/address/TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD">TGyt…ZAZD</a>
Контракт, получивший доступ к USDT: <a href="https://tronscan.org/#/address/TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s">TPwe…Et5s</a>
Разрешение на управление USDT сейчас: активное, безлимитное; подтверждено напрямую в официальном контракте USDT.
Списание через этот контракт: 91,103009 USDT в подтверждённом swap.

🟢 <b>10/100 — низкий риск для кошелька</b>

🔎 <b>Почему такая оценка</b>
Кошелёк сам запустил успешный обмен через Bridgers через 66 секунд после выдачи доступа; сумма совпала.

🧭 <b>Что делать</b>
Swap объяснён. Если это ваш кошелёк, неиспользуемое разрешение можно отозвать как цифровую гигиену.
```

#### `GOLDEN_BRIDGERS_ZERO`

```html
🛡 <b>Проверка доступа к USDT</b>
Проверяемый кошелёк — кошелёк, который выдал доступ к USDT: <a href="https://tronscan.org/#/address/TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD">TGyt…ZAZD</a>
Контракт, получивший доступ к USDT: <a href="https://tronscan.org/#/address/TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s">TPwe…Et5s</a>
Разрешение на управление USDT сейчас: 0 USDT; подтверждено напрямую в официальном контракте USDT.
Списание через этот контракт: 91,103009 USDT в ранее подтверждённом обмене.

🟢 <b>0/100 — разрешение больше не активно</b>

🔎 <b>Вывод</b>
Обмен через Bridgers объяснён. Разрешение на управление USDT равно нулю, действий не требуется.
```

#### `GOLDEN_BRIDGERS_ALLOWANCE_UNKNOWN`

```html
🛡 <b>Проверка доступа к USDT</b>
Проверяемый кошелёк — кошелёк, который выдал доступ к USDT: <a href="https://tronscan.org/#/address/TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD">TGyt…ZAZD</a>
Контракт, получивший доступ к USDT: <a href="https://tronscan.org/#/address/TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s">TPwe…Et5s</a>
Разрешение на управление USDT сейчас: подтвердить не удалось; нельзя считать его активным или отозванным.
Ранее кошелёк выдавал этому контракту доступ к USDT. Текущее списание через него не подтверждено.

⚪ <b>Текущий риск для кошелька не рассчитан</b>

🔎 <b>Почему</b>
Прямой запрос разрешения к официальному контракту USDT завершился ошибкой.

🧭 <b>Что делать</b>
Если вы проверяете чужой кошелёк — попросите владельца подтвердить текущее разрешение на управление USDT.
```

#### `GOLDEN_USDD_PSM`

```html
🧾 <b>Проверка кошелька</b>
Кошелёк: <a href="https://tronscan.org/#/address/TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD">TGyt…ZAZD</a>

🟡 <b>45/100 — требуется проверка</b>

🔎 <b>Почему такая оценка</b>
83% проверяемой суммы пришло из USDD PSM — децентрализованного сервиса обмена USDT и USDD с общей ликвидностью.
После общего пула более ранний источник сложнее отделить от переводов других пользователей.

💸 <b>Движение денег</b>
<a href="https://tronscan.org/#/address/TSUYvQ5tdd3DijCD1uGunGLpftHuSZ12sQ">TSUY…12sQ</a> → <a href="https://tronscan.org/#/address/TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD">TGyt…ZAZD</a>: 976 891,047722 USDT (83%, 1 перевод).

<b>Покрытие</b>
К выбранной сумме относятся 10 входящих переводов; прослежено 83% суммы.
```

#### `GOLDEN_GASFREE_ACCOUNT`

```html
🧾 <b>Проверка контракта</b>
Кошелёк: <a href="https://tronscan.org/#/address/TRivmRsLwVRZETXqPdv98raFPHMkwuMnxP">TRiv…MnxP</a>

🟢 <b>10/100 — низкий риск контракта</b>

🔎 <b>Что нашли</b>
Это GasFree Account — сервисный контракт для переводов USDT с оплатой комиссии через провайдера.
Точных признаков Verify20, опасного разрешения на управление USDT или списания USDT не найдено.

🧭 <b>Вывод</b>
Сам GasFree-статус не повышает AML-риск. Переводы этого адреса продолжают оцениваться как обычные денежные потоки.
```

Golden acceptance дополнительно считает непустые строки: normal AML/Where/
approval/PSM fixtures держатся около 10–15; компактные no-final/no-activity/
GasFree не дополняются повторениями ради формального объёма. Все fixtures имеют
не более четырёх emoji headings и не более двух concrete routes.

---

## 2. File map

### New files

- `src/telegram/forensicPresentation.ts` — presentation-only typed model,
  validators and deterministic copy keys.
- `src/telegram/forensicPresentationAdapters.ts` — subject-bound adapters from
  Where/Deep/Incoming/Contract/Approval results.
- `src/telegram/forensicResultRenderer.ts` — one HTML renderer and section
  ordering.
- `tests/fixtures/telegram/remediationTelegramUxCases.ts` — sanitized typed
  fixtures for every required scenario.
- `tests/fixtures/telegram/remediationTelegramGoldenMessages.ts` — independent
  exact HTML expectations from §1.7; never generated by production renderer.
- `tests/telegram/unifiedForensicRenderer.acceptance.test.ts` — core AC/REQ
  renderer tests.
- `tests/bot/unifiedTelegramModeWiring.acceptance.test.ts` — Where, Deep and
  contract wiring.
- `tests/alerts/unifiedTelegramAlerts.acceptance.test.ts` — Incoming and
  Approval wiring.
- `tests/storage/unifiedTelegramCoverage.postgres.test.ts` — AC-13
  persist→reload→render integration against a disposable PostgreSQL schema;
  production repositories are consumed without modification.
- `tests/telegram/manualTelegramAcceptanceManifest.test.ts` — executable
  manifest completeness, artifact naming and no-production guard.
- `scripts/renderTelegramUxAcceptance.ts` — local candidate message generator;
  optional send only to an explicitly configured non-production test chat.
- `docs/superpowers/verification/plan4-telegram-ux/README.md` — generated
  artifact instructions and manual checklist template. Screenshots/results are
  local evidence and are not committed with secrets/chat IDs.

### Modified files

- `src/alerts/telegramHtml.ts` — safe canonical Tronscan anchor helper.
- `src/bot/walletNarrativeSummary.ts` — compatibility wrapper over the common
  renderer; legacy raw narrative is not a fallback.
- `src/bot/wherePreliminaryNarrative.ts` — typed preliminary adapter only.
- `src/bot/createBot.ts` — route all current Where/Deep/final/contract surfaces
  through the shared adapter/renderer.
- `src/alerts/formatters.ts` — route Incoming/Approval through the same
  renderer and remove expiration from presentation.
- `src/approvals/approvalWorker.ts` — presentation-only propagation of the
  already computed `ApprovalSafetyAssessmentV2`.
- Focused existing tests may receive import/snapshot compatibility updates only
  when a new ID-linked test first demonstrates the intended behavior.
- `docs/knowledge/05-where-is-money-and-incoming.md`
- `docs/knowledge/06-deepcheck.md`
- `docs/knowledge/08-admin-and-bot-ux.md`
- `docs/knowledge/09-current-decisions.md`
- `docs/knowledge/10-open-problems.md`
- `docs/knowledge/13-agent-observations.md`

No source file outside this list may be added without stopping for scope review.

---

## 3. Commit and review discipline

For every Task 0–10:

1. inspect `git status --short` and preserve the user's unrelated dirty files;
2. change only files listed by that task;
3. run the task's focused tests;
4. run a separate **spec-review** against the REQ/AC IDs owned by the task;
5. run a separate **code-quality-review** for escaping, subject binding,
   duplication, fail-closed behavior and minimal scope;
6. stage all and only task files;
7. commit once with the exact proposed message;
8. verify `git status --short` contains no task residue;
9. run the forbidden-scope command from §0.3.

If a frozen acceptance test needs behavior-changing edits after its RED commit,
stop for explicit approval. Mechanical fixture correction is a separate
test-only commit only with user authorization.

---

## 4. Sequential implementation tasks

### Task 0 — Preflight, baseline and scope manifest

**Files:** no product changes. Create worktree-local evidence under ignored
`.tmp/plan4/` only.

1. Create a clean isolated worktree/branch from approved master.
2. Set `PLAN4_BASE_SHA` dynamically and record:
   `git rev-parse HEAD`, `git status --short`, `git stash list`.
3. Prove Plans 1–3 contracts exist with `rg` for `ForensicCoverageV2`,
   `ScoreAnchorV2`, `ApprovalSafetyAssessmentV2`, `ContractDecisionV2` and
   durable delivery state.
4. Confirm no Plan 5 document is created and AP files match base.
5. Run baseline:

   ```powershell
   npm run typecheck
   npm test -- --run `
     tests/bot/createBot.test.ts `
     tests/bot/walletNarrativeSummary.test.ts `
     tests/bot/wherePreliminaryNarrative.test.ts `
     tests/alerts/formatters.test.ts
   ```

6. Reserve a disposable Plan 4 database URL only for acceptance:

   ```powershell
   $env:PLAN4_TEST_DATABASE_URL = 'postgresql://tron:tron@127.0.0.1:55432/tron_watch_plan4'
   $env:TEST_DATABASE_URL = $env:PLAN4_TEST_DATABASE_URL
   $env:REQUIRE_PLAN4_POSTGRES = '1'
   ```

   Provision it from the local PostgreSQL admin connection if absent:

   ```powershell
   node --input-type=module -e "import pg from 'pg'; const c=new pg.Client({connectionString:'postgresql://tron:tron@127.0.0.1:55432/postgres'}); await c.connect(); const r=await c.query(\"select 1 from pg_database where datname='tron_watch_plan4'\"); if(!r.rowCount) await c.query('create database tron_watch_plan4'); await c.end();"
   node --input-type=module -e "import pg from 'pg'; const c=new pg.Client({connectionString:process.env.TEST_DATABASE_URL}); await c.connect(); const r=await c.query('select current_database() as name'); if(r.rows[0]?.name!=='tron_watch_plan4') throw new Error('plan4_wrong_database'); await c.end();"
   $env:DATABASE_URL = $env:PLAN4_TEST_DATABASE_URL
   npm run migrate
   ```

   A URL resolving to any other database is a hard failure.
   Production/staging URLs are forbidden. Migration here applies only to the
   newly isolated disposable database and is not a production release.

**Expected:** baseline GREEN. A baseline failure blocks Plan 4; it is not fixed
inside UX work.

**Commit:** none.

**Reviews:** spec-review checks dependency versions and ownership;
code-quality-review checks only evidence was produced.

### Task 1 — Frozen ID-linked RED acceptance batch

**New files:**

- `tests/fixtures/telegram/remediationTelegramUxCases.ts`
- `tests/fixtures/telegram/remediationTelegramGoldenMessages.ts`
- `tests/telegram/unifiedForensicRenderer.acceptance.test.ts`
- `tests/bot/unifiedTelegramModeWiring.acceptance.test.ts`
- `tests/alerts/unifiedTelegramAlerts.acceptance.test.ts`
- `tests/storage/unifiedTelegramCoverage.postgres.test.ts`
- `tests/telegram/manualTelegramAcceptanceManifest.test.ts`

Add all new tests before product code. Required exact test names:

```text
[AC-07] renders the active non-Fast score anchor first
[AC-08] links the checked wallet in every Telegram result type
[AC-09] safely shortens and links every valid TRON address
[AC-09][ADDRESS-SUFFIX] preserves the exact last four TRON address characters without reordering or omission
[AC-12] distinguishes true no-activity from small principal flow
[AC-13] persists and renders available selected and excluded counts
[AC-20] shows confirmed balance at risk and no debit found
[AC-21] keeps campaign counts and BTTOLD sequence as context only
[AC-24] reports failed allowance check as unconfirmed current state
[AC-27] omits transaction expiration from approval Telegram copy
[AC-39][UNIFIED-RENDERER] excludes every legacy LLM field and heading
```

`[AC-13] persists and renders available selected and excluded counts` lives in
the PostgreSQL file. It must save a completed forensic result through the real
repository, reload it, pass it to the real adapter/renderer and assert the
24/10/14 values and exclusion reason. The test creates a unique `plan4_%`
schema and drops it in `afterAll`.

Additional REQ-linked tests:

```text
[REQ-06][REQ-15] renders only the subject-bound deterministic score fact
[REQ-07][REQ-38] renders no-final without numeric score or risk action
[REQ-08] keeps victim spender receiver and route roles distinct
[REQ-09][REQ-28] explains bridge HTX collector and PSM without a theft claim
[REQ-11] deduplicates one physical transfer across mode facts
[REQ-12][REQ-13][REQ-14] keeps preliminary score-fact-only and action-free
[REQ-18] keeps approval wallet safety separate from an AML decision
[REQ-18][APPROVAL-ISOLATION] keeps approval out of AML Where and provenance sections
[REQ-22] ignores transaction envelope expiration on every approval surface
[REQ-27] renders deterministic contract decisions without model output
[REQ-31][REQ-34] keeps coverage and true no-activity wording honest
[REQ-32] enforces final section order and restrained emoji budget
[REQ-33] renders two linked routes and aggregates the remainder
[REQ-38] fails closed for invalid addresses facts and legacy denominators
[REQ-18][APPROVAL-ROLES] renders checked owner spender current allowance and exact debit as separate roles
[REQ-18][AC-20][APPROVAL-AUDIENCE] chooses conditional actions for watched and externally checked wallets
[REQ-20][AC-20][VERIFY20-ACTIVE] requires official USDT confirmation and renders unlimited finite balance and no debit
[REQ-20][VERIFY20-DEBIT] renders exact debit without claiming theft
[REQ-20][VERIFY20-DEBIT-BINDING] rejects a foreign exact debit profile and amount
[REQ-18][BRIDGERS-ACTIVE] renders explained active session as low risk with optional hygiene
[REQ-18][BRIDGERS-ZERO] renders confirmed zero as inactive with no action
[REQ-18][AC-24][BRIDGERS-UNKNOWN] never calls failed or stale allowance active or revoked
[REQ-22][AC-27][APPROVAL-NO-EXECUTION] omits expiration and never implies the bot revokes on chain
[REQ-32][GOLDEN-MESSAGES] matches every exact approved Telegram fixture
[REQ-32][GOLDEN-TERMINOLOGY] keeps technical English role and route terms out of user-visible Telegram copy
[REQ-32][RUNTIME-HIDDEN] omits runtime branch and SHA from ordinary Telegram results
```

Typed fixture set must include TGyt/TWGC, THJ collector variants, TKg, true
no-activity, 24/10/14 coverage, TNAra Verify20 active/no-debit and exact debit,
Bridgers active/zero/failed/stale, official USDT, GasFree, PSM 2% outbound/83%
inbound, no-final/technical-limit and a legacy LLM payload containing all
forbidden fields. Golden set must contain exactly the eleven payloads from
§1.7.

**RED command:**

```powershell
npx vitest run `
  tests/telegram/unifiedForensicRenderer.acceptance.test.ts `
  tests/bot/unifiedTelegramModeWiring.acceptance.test.ts `
  tests/alerts/unifiedTelegramAlerts.acceptance.test.ts `
  tests/telegram/manualTelegramAcceptanceManifest.test.ts

$env:TEST_DATABASE_URL = $env:PLAN4_TEST_DATABASE_URL
$env:REQUIRE_PLAN4_POSTGRES = '1'
npx vitest run tests/storage/unifiedTelegramCoverage.postgres.test.ts
```

**Expected RED:** new shared adapter/renderer and manifest do not exist; legacy
formatters fail wallet link, section order, coverage, approval and LLM-negative
assertions. Approval tests also fail owner/spender roles, audience-aware action,
Verify20 debit binding, all three Bridgers allowance branches, no-execution
copy and exact golden outputs. Runtime metadata is still visible in legacy
ordinary messages. Old GREEN tests are not evidence.

Save exact failing test names/output to `.tmp/plan4/task1-red.txt`.

После commit все пять acceptance test files и оба fixture files считаются
frozen.
Tasks 2–9 только запускают их. Любое содержательное изменение требует остановки
и явного разрешения пользователя; одобренная механическая fixture-поправка
оформляется отдельным test-only commit.

**Commit:** `test: define unified telegram ux acceptance`

**Reviews:** spec-review maps every test to §8; code-quality-review validates
fixtures are typed, sanitized, deterministic and contain no production secret.

### Task 2 — Presentation contract, safe links and copy catalog

**Files:**

- create `src/telegram/forensicPresentation.ts`
- modify `src/alerts/telegramHtml.ts`
- `tests/telegram/unifiedForensicRenderer.acceptance.test.ts` — read-only run

Implement the model and trust-boundary validators from §1. Add one canonical
TRON link helper. Do not add generic markdown/raw HTML escape bypasses.

Copy catalog must be exhaustive over fact keys emitted by current policy.
Unknown preferred fact is fail-closed; secondary unknown facts are omitted.

**RED before implementation:** run only AC-09, AC-39, REQ-38 cases; expect
missing type/helper and legacy-field failure.

```powershell
npx vitest run tests/telegram/unifiedForensicRenderer.acceptance.test.ts `
  -t "AC-09|AC-39|REQ-38"
```

**GREEN after implementation:** same command passes. Also:

```powershell
npm run typecheck
```

**Commit:** `feat: define deterministic telegram presentation contract`

**Reviews:** spec-review checks no score computation and canonical URLs;
code-quality-review checks HTML escaping, invalid address behavior, exhaustive
copy keys, no raw provider/LLM fallback.

### Task 3 — One common renderer: structure, risk, routes and coverage

**Files:**

- create `src/telegram/forensicResultRenderer.ts`
- create `src/telegram/forensicPresentationAdapters.ts`
- focused core renderer tests — read-only run
- `tests/storage/unifiedTelegramCoverage.postgres.test.ts` — read-only run

Implement:

- subject/mode/evidence binding;
- active anchor and preferred fact first;
- section order and emoji budget;
- deterministic Russian/English copy;
- top-two routes + aggregation;
- explicit inbound/outbound direction;
- CoverageV2 and legacy fallback;
- no-final/technical-limit rendering.
- medium-format line budget, no more than four emoji headings and exact golden
  structure without runtime/version text.

Risk/action mapping is a display lookup of an already validated decision. It
must not derive score from fact text or thresholds.

**RED:**

```powershell
npx vitest run tests/telegram/unifiedForensicRenderer.acceptance.test.ts `
  -t "AC-07|AC-08|AC-12|AC-13|REQ-06|REQ-07|REQ-08|REQ-09|REQ-11|REQ-31|REQ-32|REQ-33|REQ-34"
```

Expected: legacy output lacks unified subject, route, coverage and no-final
invariants.

**GREEN:** same command, then `npm run typecheck`.

Mandatory AC-13 PostgreSQL GREEN:

```powershell
$env:TEST_DATABASE_URL = $env:PLAN4_TEST_DATABASE_URL
$env:REQUIRE_PLAN4_POSTGRES = '1'
npx vitest run tests/storage/unifiedTelegramCoverage.postgres.test.ts
```

Expected: one real persisted/reloaded coverage object renders 24 available, 10
selected and 14 excluded with the saved reason; the test schema is removed.

**Commit:** `feat: render unified forensic telegram results`

**Reviews:** spec-review inspects every section against canonical examples;
code-quality-review checks stable ordering, no double counting, bounded output,
money precision and no domain inference in the renderer.

### Task 4 — Where Is Money preliminary wiring

**Files:**

- `src/bot/wherePreliminaryNarrative.ts`
- `src/bot/createBot.ts` only Where preliminary/delivery call sites
- `tests/bot/unifiedTelegramModeWiring.acceptance.test.ts` — read-only run
- compatibility updates in `tests/bot/wherePreliminaryNarrative.test.ts` and
  `tests/bot/createBot.test.ts` only when contradicted by new AC

Replace generic preliminary copy with the unified adapter. Ensure:

- checked wallet is linked;
- preliminary score uses its saved anchor and specific reasons;
- no final decision/action;
- no DeepCheck progress sentence;
- no generic `Where Is Money завершил` reason;
- no-score displays real coverage/technical reason.

**RED:**

```powershell
npx vitest run tests/bot/unifiedTelegramModeWiring.acceptance.test.ts `
  -t "AC-07|AC-08|REQ-12|REQ-13|REQ-14"
```

Expected: current preliminary output is generic/unlinked and action/state
architecture differs.

**GREEN:** same command plus focused legacy tests and typecheck.

**Commit:** `feat: unify where preliminary telegram results`

**Reviews:** spec-review checks preliminary is not final; code-quality-review
checks `createBot.ts` only wires typed inputs and does not duplicate copy.

### Task 5 — Wallet final, DeepCheck and Contract wiring

**Files:**

- `src/bot/walletNarrativeSummary.ts`
- `src/bot/createBot.ts` final/deep/contract presentation call sites
- `tests/bot/unifiedTelegramModeWiring.acceptance.test.ts` — read-only run
- narrowly affected existing bot tests

Wire final Where+Deep, Deep context and standalone Contract results through the
shared renderer. Compatibility exports may remain, but their body delegates to
one adapter/renderer.

Contract adapter accepts only `ContractDecisionV2` with `llm=null` and
`finalSource=deterministic`. Official USDT, GasFree, Bridgers, Verify20/provider
risk/debit and unknown metadata-context cases receive deterministic copy.

**RED:**

```powershell
npx vitest run tests/bot/unifiedTelegramModeWiring.acceptance.test.ts `
  -t "AC-07|AC-08|AC-39|REQ-09|REQ-15|REQ-27|REQ-28|REQ-32|REQ-33|REQ-38"
```

Expected: current final/deep/contract paths do not share the exact structure
and legacy presentation surfaces can expose inconsistent sections.

**GREEN:** same command, affected bot tests, typecheck.

**Commit:** `feat: unify wallet deep and contract telegram results`

**Reviews:** spec-review verifies the first fact is the score driver and no
contract LLM path exists; code-quality-review checks wrapper-only legacy code,
no new scoring and no duplicated renderer.

### Task 6 — Incoming Deposit wiring

**Files:**

- `src/alerts/formatters.ts` Incoming portions
- `tests/alerts/unifiedTelegramAlerts.acceptance.test.ts` — read-only run
- focused existing Incoming formatter/job tests only for expected output

Use the same renderer for durable and immediate Incoming presentation. Preserve
Plan 3 message fingerprint/delivery envelope inputs: only HTML payload changes.
Show checked wallet, anchor reason, inbound provenance, separate outgoing risk,
coverage and technical limit.

If an independent Address Poisoning warning is already attached to Incoming,
preserve it as one separate warning line. Do not change its detector, score,
copy, state or files.

**RED:**

```powershell
npx vitest run tests/alerts/unifiedTelegramAlerts.acceptance.test.ts `
  -t "Incoming|AC-07|AC-08|AC-13|REQ-08|REQ-09|REQ-11|REQ-15|REQ-31|REQ-33|REQ-38"
```

Expected: current Incoming output lacks shared checked-wallet/route/coverage
format and can repeat legacy reason blocks.

**GREEN:** same command plus affected Incoming job/formatter tests and
`npm run typecheck`.

**Commit:** `feat: unify incoming forensic telegram results`

**Reviews:** spec-review confirms no delivery lifecycle changes;
code-quality-review compares immediate and durable payloads, checks no AP diff
and no duplicate physical transfer.

### Task 7 — Approval wallet-safety UX and expiration removal

**Files:**

- `src/alerts/formatters.ts` Approval portions
- `src/approvals/approvalWorker.ts` presentation plumbing only
- `src/bot/createBot.ts` only manual-address approval presentation call site
- `tests/alerts/unifiedTelegramAlerts.acceptance.test.ts` — read-only run
- narrowly affected existing Approval formatter/worker tests

Pass the already computed `ApprovalSafetyAssessmentV2` and optional
subject-bound exact `ApprovalDrainProvenanceProfile` through
`ApprovalPresentationInputV1`. The call site supplies `audienceContext`
explicitly:

- monitored-address alert → `watched_wallet`;
- user-entered/manual address check → `external_address_check`.

Never infer ownership from Telegram user ID, watched-wallet membership, chat or
private-key availability. Show:

- checked wallet as owner of USDT/approval and spender as separate linked role;
- confirmed current allowance state and unlimited/finite level;
- Verify20 exact finding only with exact evidence;
- current balance at risk;
- exact debit as confirmed/not found/unknown;
- campaign counts/BTTOLD sequence as context, not proof;
- ownership-aware plain-language action from §1.4;
- exact Bridgers branches for `confirmed_active`, `confirmed_zero` and
  `failed/stale`;
- provider timeout/malformed/revert/failure as unknown current allowance;
- no claim that theft occurred without exact theft evidence.

Remove `expirationAt` and context deadline from presentation. Do not remove
historical fields from storage/types and do not change scoring. Renderer must
not emit an on-chain revoke callback/button; the bot only explains what the
owner can do manually.

**RED:**

```powershell
npx vitest run tests/alerts/unifiedTelegramAlerts.acceptance.test.ts `
  -t "AC-20|AC-21|AC-24|AC-27|REQ-18|REQ-20|REQ-22|APPROVAL-ROLES|APPROVAL-AUDIENCE|VERIFY20|BRIDGERS|APPROVAL-NO-EXECUTION"
```

Expected: current formatter displays expiration, does not distinguish all
owner/spender/current-allowance/debit roles, has no ownership-aware action and
does not render three Bridgers allowance branches.

**GREEN:** same command, affected Approval tests, typecheck.

**Commit:** `feat: present approval wallet safety without expiry`

**Reviews:** spec-review checks AML and wallet-safety are separate;
code-quality-review proves `approvalWorker.ts` provider/scoring/storage diffs are
zero, `createBot.ts` does not infer ownership, failed allowance is never shown
as active/revoked and no button claims to perform an on-chain revoke.

### Task 8 — Fail-closed compatibility and LLM isolation regression

**Files:**

- compatibility branches in `src/bot/walletNarrativeSummary.ts`,
  `src/bot/wherePreliminaryNarrative.ts`, `src/bot/createBot.ts`,
  `src/alerts/formatters.ts`
- all three new automated acceptance files — read-only runs

Remove duplicate legacy Bot/Alert presentation branches only where the common
renderer now owns the surface. Keep legacy JSON available to audit code, but
never read it into current presentation.

Add/finish negative cases:

- invalid/missing anchor or preferred fact;
- mismatched subject/mode/evidence;
- invalid address;
- missing legacy denominator;
- unsupported fact key;
- all legacy LLM fields in live-like and cached payloads;
- no-final/hard safety limit/provider failure.
- runtime branch/SHA present in legacy payload input;
- approval expiration and any legacy revoke-like callback markup.

**RED:**

```powershell
npx vitest run `
  tests/telegram/unifiedForensicRenderer.acceptance.test.ts `
  tests/bot/unifiedTelegramModeWiring.acceptance.test.ts `
  tests/alerts/unifiedTelegramAlerts.acceptance.test.ts `
  -t "AC-39|REQ-06|REQ-07|REQ-13|REQ-14|REQ-22|REQ-27|REQ-32|REQ-34|REQ-38|GOLDEN-MESSAGES|RUNTIME-HIDDEN|APPROVAL-NO-EXECUTION"
```

Expected: any remaining legacy/raw fallback is caught.

**GREEN:** run all three files without `-t`, then typecheck.

**Commit:** `refactor: isolate legacy telegram presentation paths`

**Reviews:** spec-review confirms AC-39 is regression only, not Plan 2
reimplementation; code-quality-review uses `rg` to prove LLM fields are absent
from renderer/adapters and checks no data payload is mutated.

### Task 9 — Manual Telegram acceptance harness and candidate evidence

**Files:**

- create `scripts/renderTelegramUxAcceptance.ts`
- create `docs/superpowers/verification/plan4-telegram-ux/README.md`
- `tests/telegram/manualTelegramAcceptanceManifest.test.ts` — read-only run

The script renders the sanitized typed fixtures through the exact production
renderer. Default is local dry-run and writes redacted HTML/JSON to
`.tmp/plan4/manual/`. Optional Telegram send requires all of:

- explicit `--send`;
- `PLAN4_TELEGRAM_TEST_BOT_TOKEN`;
- `PLAN4_TELEGRAM_TEST_CHAT_ID`;
- `PLAN4_TELEGRAM_ALLOW_SEND=1`;
- a guard proving the chat ID differs from configured production chats.

It never starts polling, touches PostgreSQL, runs a forensic provider, signs a
transaction or sends on-chain funds. Tokens/chat IDs are never printed or
written to artifacts.

Manifest cases and required screenshot/artifact IDs:

1. exact `GOLDEN_FINAL_AML`;
2. exact `GOLDEN_WHERE_PRELIMINARY`;
3. exact `GOLDEN_NO_FINAL_TECHNICAL`;
4. exact `GOLDEN_TRUE_NO_ACTIVITY`;
5. exact `GOLDEN_VERIFY20_ACTIVE_NO_DEBIT`;
6. exact `GOLDEN_VERIFY20_EXACT_DEBIT`;
7. exact `GOLDEN_BRIDGERS_ACTIVE`;
8. exact `GOLDEN_BRIDGERS_ZERO`;
9. exact `GOLDEN_BRIDGERS_ALLOWANCE_UNKNOWN`;
10. exact `GOLDEN_USDD_PSM`;
11. exact `GOLDEN_GASFREE_ACCOUNT`;
12. THJ collector-only and collector + independent signal;
13. TKg low-balance latest-five and 24/10/14 coverage;
14. official USDT and PSM 2% outbound variant;
15. Incoming retry-visible, invalid-address and legacy-coverage fail-closed
    fixtures, without exercising Plan 3 worker.

Each manual record contains fixture ID, checked wallet, expected REQ/AC IDs,
candidate Git SHA, locale, reviewer, result and screenshot filename. Candidate
SHA stays in the evidence manifest and must not appear inside the user message.
Runtime label, migration verification, delivery retry and `/version` release
checks remain Plan 5; Plan 4 does not claim them from synthetic messages.

**RED:**

```powershell
npx vitest run tests/telegram/manualTelegramAcceptanceManifest.test.ts
```

Expected: harness/manifest/guards absent.

**GREEN:**

```powershell
npx vitest run tests/telegram/manualTelegramAcceptanceManifest.test.ts
node --import tsx scripts/renderTelegramUxAcceptance.ts --dry-run
```

Then, only with explicit user authorization and a non-production test bot/chat:

```powershell
$env:PLAN4_TELEGRAM_ALLOW_SEND='1'
node --import tsx scripts/renderTelegramUxAcceptance.ts --send
```

Manual Telegram screenshots are mandatory before Plan 4 is called fully
accepted. Without authorized test-chat access, automated work may be GREEN but
Plan 4 status remains `manual acceptance pending`; production is still untouched.

**Commit:** `test: add manual telegram ux acceptance harness`

**Reviews:** spec-review checks every canonical manual scenario is represented;
code-quality-review checks no production send path, no secret logging and exact
production renderer reuse.

### Task 10 — Knowledge, full verification and final scope audit

**Files:**

- `docs/knowledge/05-where-is-money-and-incoming.md`
- `docs/knowledge/06-deepcheck.md`
- `docs/knowledge/08-admin-and-bot-ux.md`
- `docs/knowledge/09-current-decisions.md`
- `docs/knowledge/10-open-problems.md`
- `docs/knowledge/13-agent-observations.md`

Update knowledge to actual implemented behavior only:

- common renderer and section order;
- checked-wallet/address-link invariant;
- preliminary vs final/no-final behavior;
- coverage and legacy fallback;
- deterministic facts/no LLM;
- approval wallet-safety isolation, owner/spender roles, audience-aware actions,
  Verify20 debit semantics, three Bridgers states and no expiration;
- exact golden message set, medium-format budget and hidden runtime metadata;
- manual acceptance status;
- unresolved issue added to 10, repeated agent mistake to 13 only if actually
  observed during implementation.

**Focused Plan 4 acceptance:**

```powershell
npx vitest run `
  tests/telegram/unifiedForensicRenderer.acceptance.test.ts `
  tests/bot/unifiedTelegramModeWiring.acceptance.test.ts `
  tests/alerts/unifiedTelegramAlerts.acceptance.test.ts `
  tests/telegram/manualTelegramAcceptanceManifest.test.ts

$env:TEST_DATABASE_URL = $env:PLAN4_TEST_DATABASE_URL
$env:REQUIRE_PLAN4_POSTGRES = '1'
npx vitest run tests/storage/unifiedTelegramCoverage.postgres.test.ts
```

Expected: all new `[AC-*]` and `[REQ-*]` tests GREEN.

**Existing presentation regressions:**

```powershell
npm test -- --run `
  tests/bot/createBot.test.ts `
  tests/bot/walletNarrativeSummary.test.ts `
  tests/bot/wherePreliminaryNarrative.test.ts `
  tests/alerts/formatters.test.ts
```

**Typecheck and full suite:**

```powershell
npm run typecheck
npm test
```

Plan 4 does not change schema, repository, lifecycle or delivery state, but the
new AC-13 PostgreSQL integration test is mandatory because it proves the
Plan 1 coverage contract survives real persistence before rendering. Full suite
also runs the project's configured PostgreSQL tests; Plan 5 repeats
production-like PostgreSQL gates.

**Address Poisoning regression (read-only):**

```powershell
npx vitest run `
  tests/monitor/addressPoisoning.test.ts `
  tests/monitor/addressPoisoningWorker.test.ts `
  tests/alerts/addressPoisoningAlert.test.ts
```

Expected: GREEN with zero AP diff.

**PostgreSQL cleanup:**

Using the installed `pg` package, query `information_schema.schemata` on
`tron_watch_plan4` for names matching `plan4_%`:

```powershell
node --input-type=module -e "import pg from 'pg'; const c=new pg.Client({connectionString:process.env.PLAN4_TEST_DATABASE_URL}); await c.connect(); const db=await c.query('select current_database() as name'); if(db.rows[0]?.name!=='tron_watch_plan4') throw new Error('plan4_wrong_database'); const r=await c.query(\"select schema_name from information_schema.schemata where schema_name like 'plan4\\_%' escape '\\\\' order by 1\"); if(r.rowCount) { console.error(r.rows); process.exitCode=1; } await c.end();"
```

Expected result is empty. If a failed test leaves such a schema, drop only the
exact returned `plan4_%` schema after resolving and rechecking the database
name. Never enumerate names from another database and never drop the database
during a test task.

**Scope and cleanliness:**

```powershell
git diff --check $env:PLAN4_BASE_SHA..HEAD
git diff --name-status $env:PLAN4_BASE_SHA..HEAD
git status --short
```

Run §0.3 forbidden audit. Confirm no Plan 5 document, migration, DB/runtime,
Telegram production update or unapproved dependency.

**Commit:** `docs: record unified telegram ux behavior`

**Reviews:** whole-plan spec-review maps every requirement/test/result;
whole-plan code-quality-review inspects the complete diff, full output,
manual artifacts and rollback readiness.

---

## 5. REQ/AC → task → new test matrix

Every test below is new in Plan 4. Existing GREEN tests are regressions only.

| Requirement / AC | Plan 4 responsibility | Task | New ID-linked test |
|---|---|---:|---|
| REQ-06 | Typed deterministic facts only; no raw/LLM fallback | 2, 3, 8 | `[REQ-06][REQ-15] renders only the subject-bound deterministic score fact` |
| REQ-07 | Valid final risk/action or honest no-final | 3, 8 | `[REQ-07][REQ-38] renders no-final without numeric score or risk action` |
| REQ-08 UX | Victim/spender/receiver/route roles remain distinct | 3, 6, 7 | `[REQ-08] keeps victim spender receiver and route roles distinct` |
| REQ-09 | Bridge/DEX/HTX/collector meaning without theft presumption | 3, 5, 6 | `[REQ-09][REQ-28] explains bridge HTX collector and PSM without a theft claim` |
| REQ-10 UX | Coverage separate from score and routes | 3 | `[AC-13] persists and renders available selected and excluded counts` |
| REQ-11 | One physical transfer shown once | 3, 6 | `[REQ-11] deduplicates one physical transfer across mode facts` |
| REQ-12 | Preliminary fixed, concise, no decision/Deep state | 4 | `[REQ-12][REQ-13][REQ-14] keeps preliminary score-fact-only and action-free` |
| REQ-13 | Preliminary score mirrors valid anchor and fact | 4, 8 | `[REQ-12][REQ-13][REQ-14] keeps preliminary score-fact-only and action-free` |
| REQ-14 | Preliminary excludes Deep-only/raw/LLM data | 4, 8 | `[REQ-12][REQ-13][REQ-14] keeps preliminary score-fact-only and action-free` |
| REQ-15 UX | Preferred score-driver fact first | 3, 5, 6 | `[REQ-06][REQ-15] renders only the subject-bound deterministic score fact` |
| REQ-18 UX | Wallet safety is separate from AML/Where/provenance; explicit owner/spender/current allowance/debit roles; watched vs external actions; three Bridgers branches | 7 | `[REQ-18] keeps approval wallet safety separate from an AML decision`; `[REQ-18][APPROVAL-ISOLATION] keeps approval out of AML Where and provenance sections`; `[REQ-18][APPROVAL-ROLES] renders checked owner spender current allowance and exact debit as separate roles`; `[REQ-18][AC-20][APPROVAL-AUDIENCE] chooses conditional actions for watched and externally checked wallets`; `[REQ-18][BRIDGERS-ACTIVE] renders explained active session as low risk with optional hygiene`; `[REQ-18][BRIDGERS-ZERO] renders confirmed zero as inactive with no action`; `[REQ-18][AC-24][BRIDGERS-UNKNOWN] never calls failed or stale allowance active or revoked` |
| REQ-20 UX | Verify20 official-USDT allowance, unlimited/finite, balance, debit/no-debit, strict profile binding, action and campaign context | 7 | `[AC-20] shows confirmed balance at risk and no debit found`; `[AC-21] keeps campaign counts and BTTOLD sequence as context only`; `[REQ-20][AC-20][VERIFY20-ACTIVE] requires official USDT confirmation and renders unlimited finite balance and no debit`; `[REQ-20][VERIFY20-DEBIT] renders exact debit without claiming theft`; `[REQ-20][VERIFY20-DEBIT-BINDING] rejects a foreign exact debit profile and amount` |
| REQ-22 UX | No transaction expiry and no implied on-chain revoke execution | 7, 8 | `[REQ-22] ignores transaction envelope expiration on every approval surface`; `[REQ-22][AC-27][APPROVAL-NO-EXECUTION] omits expiration and never implies the bot revokes on chain` |
| REQ-27 UX | Contract output deterministic/no model | 5, 8 | `[REQ-27] renders deterministic contract decisions without model output` |
| REQ-28 UX | Exact PSM role/share/direction, bounded meaning | 3, 5, 6 | `[REQ-09][REQ-28] explains bridge HTX collector and PSM without a theft claim` |
| REQ-31 UX | Available/selected/excluded and honest reasons | 3 | `[REQ-31][REQ-34] keeps coverage and true no-activity wording honest` |
| REQ-32 | Unified title/wallet/order, medium line budget, exact golden copy, Russian user terminology, emoji budget and hidden runtime metadata | 3, 8 | `[REQ-32] enforces final section order and restrained emoji budget`; `[REQ-32][GOLDEN-MESSAGES] matches every exact approved Telegram fixture`; `[REQ-32][GOLDEN-TERMINOLOGY] keeps technical English role and route terms out of user-visible Telegram copy`; `[REQ-32][RUNTIME-HIDDEN] omits runtime branch and SHA from ordinary Telegram results` |
| REQ-33 | Linked directional routes, top two + aggregation | 3 | `[REQ-33] renders two linked routes and aggregates the remainder` |
| REQ-34 UX | True no-activity only when no principal | 3 | `[REQ-31][REQ-34] keeps coverage and true no-activity wording honest` |
| REQ-38 UX | Fail closed for missing/legacy/invalid inputs | 2, 3, 8 | `[REQ-38] fails closed for invalid addresses facts and legacy denominators` |
| AC-07 | Active non-Fast anchor first | 1, 3–6 | `[AC-07] renders the active non-Fast score anchor first` |
| AC-08 | Checked wallet in every result | 1, 3–7 | `[AC-08] links the checked wallet in every Telegram result type` |
| AC-09 | Valid addresses shortened + linked safely; displayed suffix is the exact final four characters | 1, 2 | `[AC-09] safely shortens and links every valid TRON address`; `[AC-09][ADDRESS-SUFFIX] preserves the exact last four TRON address characters without reordering or omission` |
| AC-12 | True no-activity vs small principal | 1, 3 | `[AC-12] distinguishes true no-activity from small principal flow` |
| AC-13 | Available/selected/excluded persist and render | 1, 3 | `tests/storage/unifiedTelegramCoverage.postgres.test.ts` — `[AC-13] persists and renders available selected and excluded counts` |
| AC-20 | Confirmed balance at risk/no debit plus ownership-aware Verify20 action | 1, 7 | `[AC-20] shows confirmed balance at risk and no debit found`; `[REQ-18][AC-20][APPROVAL-AUDIENCE] chooses conditional actions for watched and externally checked wallets`; `[REQ-20][AC-20][VERIFY20-ACTIVE] requires official USDT confirmation and renders unlimited finite balance and no debit` |
| AC-21 | Campaign/BTTOLD remains context | 1, 7 | `[AC-21] keeps campaign counts and BTTOLD sequence as context only` |
| AC-24 | Failed/stale allowance and Bridgers unknown are never active/revoked | 1, 7 | `[AC-24] reports failed allowance check as unconfirmed current state`; `[REQ-18][AC-24][BRIDGERS-UNKNOWN] never calls failed or stale allowance active or revoked` |
| AC-27 | Approval has no transaction expiration or implied revoke execution | 1, 7, 8 | `[AC-27] omits transaction expiration from approval Telegram copy`; `[REQ-22][AC-27][APPROVAL-NO-EXECUTION] omits expiration and never implies the bot revokes on chain` |
| AC-39 Plan 4 regression | Unified renderer cannot reintroduce LLM text | 1, 2, 5, 8 | `[AC-39][UNIFIED-RENDERER] excludes every legacy LLM field and heading` |

Traceability gate:

```powershell
$ids = 'AC-07','AC-08','AC-09','AC-12','AC-13','AC-20','AC-21','AC-24','AC-27','AC-39'
foreach ($id in $ids) {
  if (-not (rg -l "\[$id\]" tests/telegram tests/bot tests/alerts)) {
    throw "Plan 4 has no new test for $id"
  }
}
```

---

## 6. Manual acceptance checklist

For every case in Task 9, reviewer records:

- candidate SHA and fixture ID;
- linked checked wallet opens the exact Tronscan address;
- every shortened counterparty link opens the full correct address;
- risk indicator, score, level and action agree with saved typed decision;
- primary reason is concrete and matches `preferredFactId`;
- route direction, amount, percentage and transfer count are understandable;
- coverage denominator is real or explicit legacy fallback;
- no-final has no fake numeric risk;
- approval has no expiration and no false current allowance;
- approval names checked owner and spender separately, states whether current
  allowance is active/zero/unconfirmed and states exact debit status;
- approval action matches watched/external context and never implies private-key
  ownership or an on-chain action by the bot;
- Bridgers active/zero/unknown each match their own golden branch;
- no LLM/raw selector/provider wording;
- no `Runtime:`, branch or SHA inside ordinary user message;
- no more than four restrained emoji headings;
- exact output matches the corresponding independent golden fixture;
- screenshot filename and REQ/AC IDs are saved.

Manual acceptance does not prove Plan 3 delivery retries or Plan 5 runtime
version/migration gates. Those are deliberately separate.

---

## 7. Rollback

Plan 4 rollback is code-only and does not touch production DB:

1. stop candidate test runtime if one was explicitly started;
2. revert Plan 4 commits in reverse order;
3. restore compatibility formatter entry points from pre-Plan4 code;
4. rerun typecheck, focused legacy presentation tests, full suite and AP
   regression;
5. confirm production remains on its pre-Plan5 verified runtime.

Because Plan 4 introduces no migration, delivery state or scoring change, no
data rollback exists. Do not delete immutable forensic results or delivery
fingerprints.

---

## 8. Self-review before approval

- [x] Ownership matches canonical Plan 4 row and does not absorb Plans 1–3/5.
- [x] Every owned AC has a new exact ID-linked test.
- [x] First implementation commit is frozen RED tests/fixtures only.
- [x] Existing GREEN tests are not accepted as proof.
- [x] One typed presentation model and one renderer cover Where, Deep,
      Incoming, Contract and Approval.
- [x] Approval shares only renderer style: it remains a separate wallet-safety
      result and cannot absorb AML, Where or provenance sections.
- [x] Approval model binds owner, spender, official-USDT allowance and optional
      exact-debit profile; foreign binding fails closed.
- [x] Watched/external actions are conditional and never assert private-key
      ownership or bot-executed revoke.
- [x] Verify20 and Bridgers active/zero/unknown semantics have independent
      ID-linked tests and exact golden messages.
- [x] Checked wallet, safe Tronscan links, restrained risk indicator, concrete
      reasons, action, money routes and coverage are explicit invariants.
- [x] Preliminary, final, partial/no-final and technical-limit states differ
      without fabricated score/coverage.
- [x] LLM/cache text has no fresh presentation path; AC-39 is regression only.
- [x] Tasks are small, sequential and each has RED/GREEN commands, one commit,
      spec-review and code-quality-review.
- [x] Manual Telegram acceptance uses sanitized fixtures and a guarded
      non-production test chat only.
- [x] Eleven exact independent golden payloads cover every requested scenario;
      normal messages stay near 10–15 non-empty lines without padding simple
      no-final/no-activity cases.
- [x] Every linked short address preserves the exact first and last four
      characters; canonical display for the checked fixture is `TGyt…ZAZD`.
- [x] User-visible golden copy contains no `owner`, `spender`, `allowance`,
      `approval` or `Bridge/router/DEX`; internal typed identifiers keep their
      existing names.
- [x] Runtime branch/SHA is absent from ordinary payload and remains available
      only through `/version`, Admin and diagnostics.
- [x] Production PostgreSQL/runtime/version/release remain Plan 5; Plan 4 writes
      only isolated acceptance rows in `tron_watch_plan4` and cleans them up.
- [x] AC-13 alone has a disposable PostgreSQL persist→reload→render acceptance;
      it does not change repository/schema and includes cleanup.
- [x] Address Poisoning is excluded and protected by path/regression audit.
- [x] Rollback, knowledge updates, full suite, diff check and scope audit are
      specified.

## 9. Утверждённый execution checkpoint

Plan 4 утверждён 2026-07-16. Перед реализацией commit включает только этот plan
document. Затем создаётся отдельный worktree: Task 0 и Task 1 выполняются
первыми, Tasks 2–10 — строго по порядку. Plan 5 не создаётся, production
DB/runtime/Telegram не меняются, Address Poisoning closeout не запускается.

Любое расширение scope, изменение frozen acceptance или необходимость
затронуть producer/scoring/delivery требует остановки и нового решения
пользователя.
