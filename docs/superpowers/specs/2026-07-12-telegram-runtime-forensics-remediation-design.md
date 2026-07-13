# Canonical Telegram / Runtime / Forensics Remediation Design

Дата: 2026-07-12
Статус: утверждена пользователем; implementation не начат
Тип документа: target behavior и архитектурный контракт; код не реализован

## 1. Канонический статус

Эта спецификация является единственным target-behavior документом remediation-
трека, основанного на утверждённой матрице
`docs/audit/2026-07-12-telegram-runtime-forensics-conformance-audit.md`.

Она объединяет все `REQ-01…REQ-38`, `AC-01…AC-41` и решения
`CON-01…CON-17`. Для этого remediation-трека она имеет приоритет над
противоречащими формулировками в:

- `2026-07-10-forensic-and-scoring-correctness-design.md`;
- `2026-07-11-telegram-wallet-narrative-design.md`;
- `2026-07-11-where-preliminary-narrative-design.md`;
- `2026-07-12-telegram-forensic-results-and-runtime-reliability-design.md`.

Старые документы остаются источниками истории решений. Они не описывают
целевое состояние после remediation. Current knowledge продолжает описывать
фактически внедрённое поведение и обновляется только вместе с соответствующим
кодом.

Выбран подход `one canonical spec -> five isolated plans`. Пять отдельных
спецификаций отклонены, потому что снова разделят typed contracts и release
authority. Дописывание старой spec отклонено, потому что сохранит stale status
и противоречащие current/target формулировки.

## 2. Цель и границы

Цель — привести данные, скоринг, runtime и Telegram к одному проверяемому
контракту:

```text
on-chain / provider facts
  -> typed evidence and coverage
  -> deterministic score anchor and safety decisions
  -> durable runtime result and delivery state
  -> one Telegram presentation model
  -> automated + manual release acceptance
```

В scope:

- данные и покрытие Where/Incoming/Deep;
- collector, USDD PSM, blacklist и contract/approval semantics;
- direct current USDT allowance;
- deterministic contract authority; automatic contract/money-origin LLM disabled;
- waiting-job reconciliation и Telegram result delivery;
- cache-first Telegram navigation;
- единая preliminary/final/no-final/status/failure presentation;
- migration, runtime/version verification и release gates.

Не входит:

- новый Admin redesign;
- новый provider или concurrency dependency;
- общий Telegram outbox table;
- молчаливый пересчёт старых jobs;
- Address Poisoning implementation или four-character detector;
- изменение разделения Fast, Deep, Where и Incoming.

## 3. Архитектурные инварианты

1. Fact, interpretation, AML decision и wallet-safety decision — разные типы.
2. Numeric score не создаёт proof authority.
3. Coverage limitation не является risk evidence.
4. Первый пользовательский risk fact обязан ссылаться на active score anchor.
5. Fresh checks не вызывают LLM; legacy LLM не создаёт score, decision,
   service identity, evidence или factual copy.
6. Current allowance существует только после успешного official-USDT constant
   call.
7. Service name/tag не заменяет exact session evidence.
8. Старый зелёный тест не удовлетворяет новому AC без нового ID-linked test.
9. Forensic result и Telegram delivery имеют независимые lifecycle.
10. Legacy jobs читаются, но не пересчитываются и не получают выдуманные поля.

## 4. Общие typed contracts

Имена ниже нормативные. Детальные TypeScript-типы могут быть размещены в
минимальном числе существующих модулей, но их поля и семантика не меняются
между пятью планами.

### 4.1 `ForensicCoverageV2`

```ts
type ForensicCoverageV2 = {
  version: "forensic-coverage-v2";
  scope: "current_balance" | "requested_amount" | "transaction_seed" | "recent_flow" | "deep_history";
  availableInboundTxCount: number | null;
  selectedInboundTxCount: number;
  excludedInboundTxCount: number | null;
  selectedAmountRaw: string | null;
  tracedAmountRaw: string | null;
  tracedShare: number | null;
  unresolvedAmountRaw: string | null;
  unresolvedShare: number | null;
  exclusions: CoverageExclusionV1[];
  limitations: CoverageLimitationV1[];
  completeness: "complete" | "partial" | "unknown";
};
```

`CoverageExclusionV1.reason` допускает только:

- `after_checked_operation`;
- `consumed_by_earlier_spend`;
- `exact_gasfree_service_fee`;
- `different_selected_scope`;
- `provider_history_unavailable`;
- `local_materialization_failed`;
- `other_proven_not_selected`.

Каждая причина хранит count, сумму при наличии и evidence ids. Неизвестная
причина не угадывается. Для legacy result отсутствующие available/excluded
остаются `null`; renderer не создаёт denominator.

### 4.2 `ScoreAnchorV2`

```ts
type ScoreAnchorV2 = {
  version: "score-anchor-v2";
  policyVersion: string;
  subjectAddress: string;
  mode: "fast" | "deep" | "where" | "incoming" | "unified" | "contract";
  score: number;
  decision: "ACCEPTABLE" | "REVIEW" | "DECLINE";
  matrixRow: string;
  evidenceClass: string;
  proofLevel: "exact" | "strong" | "context";
  authority: "on_chain" | "registry" | "deterministic_pattern" | "behavior";
  evidenceIds: string[];
  primaryEvidenceIds: string[];
  preferredFactId: string;
  coverageDependency: "none" | "required";
};
```

Numeric final score без валидного subject-bound `ScoreAnchorV2` запрещён.

Строгие инварианты `ScoreAnchorV2`:

1. В одном result существует ровно один active anchor либо ни одного. Отсутствие
   anchor означает `NO_FINAL_DECISION`; numeric score и risk action тогда
   запрещены.
2. `score` — конечное целое число `0…100`. `decision`, `matrixRow`,
   `evidenceClass`, `proofLevel`, `authority` и `coverageDependency` обязаны
   совпадать с одной зарегистрированной строкой `policyVersion`; свободные
   provider/model strings в anchor запрещены.
3. `subjectAddress` — валидный TRON Base58 address и побайтно совпадает с
   checked subject result/job. `mode` совпадает с фактически завершённым mode.
4. `evidenceIds` и `primaryEvidenceIds` непустые, без дублей; каждый id
   разрешается ровно в один typed evidence object того же result и относится к
   `subjectAddress`. `primaryEvidenceIds` — подмножество `evidenceIds` и
   содержит evidence выбранного primary policy driver; остальные evidence
   могут питать только явно зарегистрированные contributing rows.
5. `preferredFactId` непустой и разрешается ровно в один `NarrativeFactV2` того
   же result. Этот fact имеет тот же `subjectAddress`,
   `section = score_reason`, `isScoreDriver = true`; нормализованный набор его
   `evidenceIds` в точности равен набору `ScoreAnchorV2.primaryEvidenceIds`.
6. Ни coverage/technical fact, ни secondary/context fact не может быть
   `preferredFactId`. В одном result только один fact может ссылаться на active
   anchor как preferred.
7. `coverageDependency = none` допустим только для policy-row, явно помеченной
   coverage-independent и опирающейся на exact on-chain/registry или
   deterministic-pattern evidence. Behavioral evidence требует
   `coverageDependency = required`.
8. `DECLINE` допустим только для decision-eligible policy-row. Context evidence,
   limitation или неполное покрытие сами по себе не создают `DECLINE`.
9. Missing, duplicate или mismatched `preferredFactId`, evidence, policy row или
   subject binding инвалидирует весь anchor. Runtime сохраняет diagnostic
   `score_anchor_fact_binding_failed` и выдаёт честный no-final result, а не
   выбирает другой fact эвристически.
10. Legacy result без этих полей остаётся legacy: renderer может показать его
    старое сохранённое представление, но не создаёт `ScoreAnchorV2` задним
    числом.

### 4.3 `NarrativeFactV2` и `MoneyRouteV2`

```ts
type NarrativeFactV2 = {
  id: string;
  subjectAddress: string;
  kind: string;
  role: string | null;
  section: "score_reason" | "money_origin" | "money_movement" | "coverage" | "technical";
  evidenceIds: string[];
  isScoreDriver: boolean;
  direction: "incoming" | "outgoing" | "self" | null;
  amountRaw: string | null;
  share: number | null;
  txCount: number | null;
  addresses: AddressRefV1[];
  txHashes: string[];
  factTextKey: string;
  meaningTextKey: string | null;
};

type MoneyRouteV2 = {
  from: AddressRefV1;
  to: AddressRefV1;
  direction: "incoming" | "outgoing";
  amountRaw: string;
  share: number | null;
  txCount: number;
  txHashes: string[];
  serviceIdentity: string | null;
  serviceBoundary: boolean;
  amountContinuity: "exact" | "broken" | "unknown";
};
```

`AddressRefV1` валидирует TRON Base58 address, хранит полный address, безопасный
short display и canonical URL `https://tronscan.org/#/address/<address>`.
Invalid address остаётся escaped plain text без ссылки.

### 4.4 `ApprovalAllowanceStateV2`

```ts
type ApprovalAllowanceStateV2 = {
  version: "approval-allowance-v2";
  ownerAddress: string;
  spenderAddress: string;
  tokenContract: string;
  confirmedAllowanceRaw: string | null;
  isUnlimited: boolean | null;
  state: "confirmed_active" | "confirmed_zero" | "failed" | "stale";
  confirmedAt: string | null;
  freshUntil: string | null;
  lastAttemptAt: string | null;
  failureCode: string | null;
  source: "official_usdt_allowance";
  observedApprovalTxHash: string | null;
};
```

Для `approval-allowance-v2` freshness window фиксирован: `15 минут` от времени
успешного ответа. `freshUntil = confirmedAt + 15 minutes`; timestamps хранятся
как UTC `timestamptz` и сериализуются RFC 3339.

Исторический Approval event сохраняется отдельно. Он не может выставить
`confirmed_active`. Старые строки после migration получают `stale`, а не
`active`.

Строгие allowance-инварианты:

- Во всех состояниях owner/spender/token — валидные TRON addresses, token равен
  каноническому official TRON USDT contract, а ответ constant-call связан с
  точной тройкой `(owner, spender, token)`.
- Decimal raw value является canonical unsigned uint256: только `0` или цифры
  без знака и ведущих нулей, значение не больше `2^256 - 1`.
- `confirmed_active`: direct call успешен; `confirmedAllowanceRaw > 0`;
  `confirmedAt = lastAttemptAt`; `freshUntil > confirmedAt` и время оценки не
  позже `freshUntil`; `failureCode = null`; `isUnlimited = true` только при
  точном значении `2^256 - 1`, иначе `false`.
- `confirmed_zero`: direct call успешен; `confirmedAllowanceRaw = "0"`;
  `confirmedAt = lastAttemptAt`; freshness соблюдена; `failureCode = null`;
  `isUnlimited = false`.
- `failed`: последняя direct-call попытка завершилась ошибкой;
  `lastAttemptAt != null`, `failureCode` принадлежит точному allowlist
  `provider_timeout | provider_unavailable | malformed_response |
  contract_call_reverted | network_mismatch | subject_binding_failed |
  unknown_provider_error` и
  `isUnlimited = null`. Предыдущие `confirmedAllowanceRaw/confirmedAt` могут
  сохраняться только как историческое наблюдение и не называются current.
- `stale`: успешной свежей проверки нет либо `freshUntil` уже прошёл;
  `isUnlimited = null`, `failureCode = null`. Никогда не проверенная legacy
  строка имеет null в confirmed/fresh/attempt fields.
- State вычисляется с приоритетом `failed -> stale -> confirmed_zero/
  confirmed_active`: поздняя ошибка не маскируется старым success, а истёкший
  success не остаётся confirmed. Из `failed/stale` перейти в confirmed можно
  только новым успешным official-USDT call.
- Approval/revoke event лишь ставит запись на refresh. Ни event amount, ни
  provider label, ни transaction timestamp не создаёт current allowance и не
  задаёт expiration.
- Wallet-safety threat от allowance разрешён только для свежего
  `confirmed_active`; `confirmed_zero` даёт active-threat score `0`, а
  `failed/stale` — `UNKNOWN/CONFIRM_ALLOWANCE` без numeric threat score.

### 4.5 `ApprovalSafetyAssessmentV2` и `KnownServiceSessionV1`

```ts
type ApprovalSafetyAssessmentV2 = {
  version: "approval-safety-v2";
  subjectAddress: string;
  level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN";
  score: number | null;
  action: "NONE" | "REVOKE_IF_UNUSED" | "REVOKE_NOW" | "CONFIRM_ALLOWANCE";
  amlScoreImpact: 0;
  allowance: ApprovalAllowanceStateV2;
  balanceAtRiskRaw: string | null;
  exactVerify20: boolean;
  exactDebit: boolean;
  debitFoundFromSubject: boolean;
  campaignEvidenceIds: string[];
  serviceSession: KnownServiceSessionV1 | null;
};

type KnownServiceSessionV1 = {
  walletAddress: string;
  spenderAddress: string;
  approvalTxHash: string;
  actionTxHash: string;
  actionKind: "swap" | "bridge" | "router";
  walletInitiated: boolean;
  successful: boolean;
  delayMs: number;
  approvedAmountRaw: string | null;
  movedAmountRaw: string;
  amountContinuity: "exact" | "broken" | "unknown";
  authoritativeServiceId: string;
};
```

Verify20 outcomes: unlimited `90`, finite ≥100 USDT `75`, finite <100 USDT
`45`, confirmed zero `0`, exact debit `95`. Provider name/one selector остаётся
context ≤35. Canonical Bridgers exact session даёт `LOW 10`, AML impact `0`.
Known service без exact session даёт `REVIEW 45` wallet-safety.

### 4.6 `ContractDecisionV2`

```ts
type ContractDecisionV2 = {
  deterministic: {
    score: number;
    level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    decision: "ACCEPTABLE" | "REVIEW" | "DECLINE";
    authority: string;
    evidenceIds: string[];
  };
  llm: null;
  finalSource: "deterministic";
};
```

#### LLM-disabled amendment

Эта поправка является частью канонического target behavior и заменяет только
прежнюю automatic-ambiguity семантику `REQ-23…26`, `REQ-38` и `AC-34…40`:

- Flash и Pro автоматически не вызываются ни для одного fresh Contract, Where,
  Incoming или Deep пути; automatic money-origin LLM также отсутствует;
- каждый fresh `ContractDecisionV2` имеет `llm=null` и
  `finalSource="deterministic"`;
- unknown/ambiguous contract без exact bad/service proof, но с подтверждённым
  subject-bound `metadata_context`, получает `MEDIUM 35 REVIEW`; без такого
  context resolver не создаёт score/decision и не выдумывает evidence;
- legacy LLM/cache JSON остаётся доступен только через отдельный audit path:
  JSON payload не изменяется и не перезаписывается, но не читается в scoring,
  decision, evidence, facts или Telegram presentation;
- `AC-39` делится по ownership: узкое удаление двух legacy LLM-секций из
  существующих Bot/Alert formatter принадлежит Plan 2; единый Telegram UX и
  защита от повторного появления такой секции в общем renderer остаются Plan 4.

Все fresh contract cases являются deterministic no-call cases, включая official
TRON USDT (`LOW 0`), structural GasFree Account (`LOW 10`), exact known service,
exact Verify20/provider risk/debit и unknown/ambiguous (`REVIEW 35` при наличии
subject-bound metadata context).

### 4.7 `UsddPsmExposureV1`

```ts
type UsddPsmExposureV1 = {
  mode: "where" | "incoming" | "recent_flow" | "deep_history";
  direction: "inbound_from_psm" | "outbound_to_psm";
  amountRaw: string;
  selectedAmountRaw: string;
  share: number;
  hopCount: 1 | 2;
  serviceIdentityExact: boolean;
  amountContinuityExact: boolean;
  baseModifier: 3 | 7 | 12 | 18 | 25;
  modeAdjustedModifier: number;
  appliedModifier: number;
  roundingPolicy: "half_up_non_negative";
  evidenceIds: string[];
};
```

Modifier рассчитывается только по integer raw amounts. Пусть
`n = BigInt(amountRaw)`, `d = BigInt(selectedAmountRaw)`. Eligibility требует:

- exact authoritative USDD PSM identity;
- exact amount continuity;
- `hopCount` равен `1` или `2`;
- `d > 0` и `0 < n <= d`.

Хранимый `share` нужен для отображения; tier выбирается без floating point —
сравнением `n * 100` с `d * threshold`:

```text
0% < share < 5%    -> baseModifier = 3
5% <= share < 20% -> baseModifier = 7
20% <= share < 50% -> baseModifier = 12
50% <= share < 80% -> baseModifier = 18
80% <= share <= 100% -> baseModifier = 25
```

Единственное правило округления — `roundHalfUp(x) = floor(x + 0.5)` для
неотрицательного `x`. Формула применяется строго в таком порядке:

```text
modeAdjustedModifier =
  mode == deep_history
    ? min(12, roundHalfUp(baseModifier / 2))
    : baseModifier

appliedModifier =
  direction == outbound_to_psm
    ? roundHalfUp(modeAdjustedModifier / 2)
    : modeAdjustedModifier
```

Следовательно: `2% outbound where = 3 -> 2`; `83% inbound where = 25`;
`83% inbound deep = 25 -> 12`; `83% outbound deep = 25 -> 12 -> 6`.
Границы `5/20/50/80%` входят в следующий tier. Никакого промежуточного
округления share нет. Неeligible/inexact route остаётся unscored context и не
создаёт `UsddPsmExposureV1`. USDD PSM alone не может дать выше `45 REVIEW` и
сам по себе не создаёт `DECLINE`.

### 4.8 `TelegramDeliveryStateV1` и reconciliation result

```ts
type TelegramDeliveryStateV1 = {
  status: "pending" | "sent" | "retryable" | "failed";
  attemptCount: number;
  lastAttemptAt: string | null;
  sentAt: string | null;
  lastError: string | null;
  messageFingerprint: string;
};

type WaitReconciliationResultV1 = {
  parentJobId: string;
  readyCount: number;
  terminalCount: number;
  cancelledCount: number;
  waitingCount: number;
  outcome: "resume_ready" | "resume_terminal" | "unchanged" | "contradictory";
  diagnosticCode: string | null;
};
```

Delivery state хранится в существующем forensic job progress. Новый outbox
table не создаётся. Forensic completion CAS происходит до delivery claim;
неуспешный completion CAS запрещает этому worker отправлять результат.

## 5. Целевой data flow

1. Producer сохраняет typed facts, routes, coverage и exact evidence ids.
2. Mode scorer создаёт `ScoreAnchorV2` или честный no-final result.
3. Approval/contract pipeline сначала завершает deterministic authority.
4. Fresh pipelines не вызывают LLM; unresolved contract обрабатывается по
   deterministic fallback из раздела 4.6.
5. Job completion сохраняет immutable forensic result и pending delivery.
6. Delivery worker claims pending/retryable state по fingerprint и attempts.
7. Telegram renderer получает только typed presentation model.
8. Runtime label, schema versions и policy versions сохраняются в result и
   видны через существующую `/version` и diagnostics.

## 6. Порядок пяти независимых планов

Независимость означает отдельный plan document, RED/GREEN gate, commit boundary
и rollback surface. Это не означает отсутствие зависимостей. Выполнение идёт в
строгом порядке.

| № | Будущий plan | Primary ownership | Вход | Выход / gate |
|---:|---|---|---|---|
| 1 | `remediation-data-and-coverage` | REQ-01…03, 10, 19(data), 28(data), 30, 31, 34, 38(data); AC-10…13 и data foundations AC-03…06, 19…24 | Утверждённая spec | Typed contracts, migration 032, legacy adapters, RED→GREEN data tests |
| 2 | `remediation-scoring-and-contract-semantics` | REQ-04…05, 08, 15…29, 38(scoring); AC-01…06, 19…40, включая узкое удаление legacy LLM Bot/Alert sections по AC-39 | Plan 1 contracts | Deterministic scoring/safety, LLM-disabled policy, no Telegram redesign |
| 3 | `remediation-runtime-and-delivery` | REQ-35…37 runtime portion; AC-14…18 | Stable result contracts | Reconciler, delivery state, callback/cache lifecycle, runtime tests |
| 4 | `remediation-unified-telegram-ux` | REQ-06…14, 15 UX, 18 UX, 20 UX, 22 UX, 27 UX, 28 UX, 31…34, 38 UX; AC-07…09, 12…13, 20…21, 27; AC-39 unified-renderer regression only | Plans 1–3 | One renderer, links, headings, manual Telegram candidate build |
| 5 | `remediation-end-to-end-acceptance-and-release` | AC-41 и повторная проверка AC-01…40 | Plans 1–4 green | Full regression, migration/runtime/version/manual acceptance, release or rollback |

Plan 4 не меняет scoring. Plan 5 не исправляет bugs: найденная ошибка возвращает
работу владельцу Plan 1–4 и повторяет release gate с начала.

Первый commit каждого плана содержит только RED tests и минимальные fixtures:

| Plan | Обязательный первый RED batch |
|---:|---|
| 1 | `[REQ-19] enforces exhaustive allowance state invariants`; `[REQ-31] persists coverage denominators and reasons`; `[REQ-38] verifies schema 032 receipt checksum and postconditions`; AC-10, AC-11 |
| 2 | `[REQ-05] rejects invalid ScoreAnchorV2 or preferredFactId binding`; `[REQ-28] uses exact integer USDD PSM tiers and half-up adjustments`; AC-01…AC-06, AC-19, AC-22, AC-25, AC-26, AC-29, AC-30, AC-34…AC-40, включая узкий Bot/Alert AC-39 regression |
| 3 | AC-14…AC-18 |
| 4 | AC-07…AC-09, AC-12, AC-13, AC-20, AC-21, AC-24, AC-27; AC-39 unified-renderer regression без повторной реализации legacy formatter deletion |
| 5 | AC-41 manifest test плюс executable release checklist, который сначала падает на незаполненных gate artifacts |

Остальные tests плана также добавляются до production-кода соответствующего
поведения. RED evidence сохраняет command, failing test name и ожидаемую причину.

## 7. REQ ownership map

Каждый REQ имеет ровно одного primary owner. Secondary plan проверяет
integration, но не меняет семантику без возврата к primary owner.

| REQ | Primary plan | Secondary integration |
|---|---:|---|
| REQ-01 | 1 | 2, 5 |
| REQ-02 | 1 | 2, 5 |
| REQ-03 | 1 | 3, 5 |
| REQ-04 | 2 | 4, 5 |
| REQ-05 | 2 | 3, 4, 5 |
| REQ-06 | 4 | 2, 5 |
| REQ-07 | 4 | 5 |
| REQ-08 | 2 | 4, 5 |
| REQ-09 | 4 | 2, 5 |
| REQ-10 | 1 | 4, 5 |
| REQ-11 | 4 | 2, 5 |
| REQ-12 | 4 | 5 |
| REQ-13 | 4 | 2, 5 |
| REQ-14 | 4 | 2, 5 |
| REQ-15 | 2 | 4, 5 |
| REQ-16 | 2 | 4, 5 |
| REQ-17 | 2 | 4, 5 |
| REQ-18 | 2 | 4, 5 |
| REQ-19 | 1 | 2, 3, 4, 5 |
| REQ-20 | 2 | 4, 5 |
| REQ-21 | 2 | 4, 5 |
| REQ-22 | 2 | 4, 5 |
| REQ-23 | 2 | 4, 5 |
| REQ-24 | 2 | 4, 5 |
| REQ-25 | 2 | 4, 5 |
| REQ-26 | 2 | 4, 5 |
| REQ-27 | 4 | 2, 5 |
| REQ-28 | 2 | 1, 4, 5 |
| REQ-29 | 2 | 1, 4, 5 |
| REQ-30 | 1 | 2, 4, 5 |
| REQ-31 | 1 | 4, 5 |
| REQ-32 | 4 | 5 |
| REQ-33 | 4 | 1, 5 |
| REQ-34 | 1 | 4, 5 |
| REQ-35 | 3 | 5 |
| REQ-36 | 3 | 4, 5 |
| REQ-37 | 3 | 4, 5 |
| REQ-38 | 1 | 2, 3, 4, 5 |

## 8. Обязательная AC → новый test traceability

Каждый тест ниже новый. Его имя начинается с `[AC-XX]`. До implementation тест
обязан упасть по ожидаемой причине. Старый тест можно удалить или переписать,
если он противоречит AC, но его прежний GREEN не засчитывается.

| AC | Primary plan | Новый обязательный тест |
|---|---:|---|
| AC-01 | 2 | `[AC-01] caps collector-only evidence at REVIEW 35` |
| AC-02 | 2 | `[AC-02] allows collector 55 only with an independent eligible AML signal` |
| AC-03 | 2 | `[AC-03] scores 2 percent outbound USDD PSM with direction adjustment` |
| AC-04 | 2 | `[AC-04] scores 83 percent direct inbound USDD PSM at top tier` |
| AC-05 | 2 | `[AC-05] halves historical Deep USDD PSM and caps modifier at 12` |
| AC-06 | 2 | `[AC-06] keeps label-only or discontinuous USDD PSM unscored` |
| AC-07 | 4 | `[AC-07] renders the active non-Fast score anchor first` |
| AC-08 | 4 | `[AC-08] links the checked wallet in every Telegram result type` |
| AC-09 | 4 | `[AC-09] safely shortens and links every valid TRON address` |
| AC-10 | 1 | `[AC-10] selects the TKg five-transfer low-balance fixture` |
| AC-11 | 1 | `[AC-11] excludes exact GasFree fees before the five-transfer slice` |
| AC-12 | 4 | `[AC-12] distinguishes true no-activity from small principal flow` |
| AC-13 | 4 | `[AC-13] persists and renders available selected and excluded counts` |
| AC-14 | 3 | `[AC-14] reconciles and claims an all-ready parent exactly once` |
| AC-15 | 3 | `[AC-15] resumes mixed ready-terminal waits through technical path` |
| AC-16 | 3 | `[AC-16] retries Telegram delivery without duplicating sent fingerprint` |
| AC-17 | 3 | `[AC-17] keeps normal navigation cache-only and refresh explicit` |
| AC-18 | 3 | `[AC-18] returns check callbacks before slow work completes` |
| AC-19 | 2 | `[AC-19] scores confirmed unlimited Verify20 approval at CRITICAL 90` |
| AC-20 | 4 | `[AC-20] shows confirmed balance at risk and no debit found` |
| AC-21 | 4 | `[AC-21] keeps campaign counts and BTTOLD sequence as context only` |
| AC-22 | 2 | `[AC-22] caps one selector or provider name at review context` |
| AC-23 | 2 | `[AC-23] removes active threat after confirmed zero allowance` |
| AC-24 | 4 | `[AC-24] reports failed allowance check as unconfirmed current state` |
| AC-25 | 2 | `[AC-25] recognizes exact Bridgers 66-second 91.103009 session as LOW 10` |
| AC-26 | 2 | `[AC-26] refuses service-session dampener for tag-only evidence` |
| AC-27 | 4 | `[AC-27] omits transaction expiration from approval Telegram copy` |
| AC-28 | 2 | `[AC-28] removes transaction expiration from approval risk` |
| AC-29 | 2 | `[AC-29] resolves official TRON USDT at LOW 0 without LLM` |
| AC-30 | 2 | `[AC-30] resolves GasFree Account at LOW 10 without LLM and keeps flows eligible` |
| AC-31 | 2 | `[AC-31] keeps exact Bridgers approval session LOW instead of decline` |
| AC-32 | 2 | `[AC-32] keeps known-service unlimited approval without session at REVIEW 45` |
| AC-33 | 2 | `[AC-33] prevents service or LLM dampening of provider risk Verify20 or debit proof` |
| AC-34 | 2 | `[AC-34] keeps fresh llm null and ignores every model score payload without a provider call` |
| AC-35 | 2 | `[AC-35] keeps model verdict and recommendation out of every fresh decision` |
| AC-36 | 2 | `[AC-36] keeps legacy citations audit-only and outside current evidence and facts` |
| AC-37 | 2 | `[AC-37] keeps risky or uncited legacy model payload out of fresh decisions` |
| AC-38 | 2 | `[AC-38] makes zero provider calls for timeout JSON and schema scenarios and preserves deterministic result` |
| AC-39 | 2 primary; 4 regression | `[AC-39] removes legacy model output from existing Bot and Alert formatting`; Plan 4 proves the unified renderer does not reintroduce it |
| AC-40 | 2 | `[AC-40] bypasses Flash and Pro for every fresh contract case including unknown and ambiguous` |
| AC-41 | 5 | `[AC-41] validates the release regression manifest and required suite set` |

AC-41 также требует реального полного test command; meta-test не заменяет
полный прогон.

## 9. Решения CON-01…CON-17

| CON | Каноническое решение |
|---|---|
| CON-01 | Весь approval amendment считается approved. Эта spec заменяет stale header status. |
| CON-02 | Используется один заголовок `🔎 Почему такая оценка`; запрещена старая повторяющаяся простыня, а не score-driver heading. |
| CON-03 | Knowledge описывает current code до каждого внедрения; эта spec описывает target. |
| CON-04 | Старые unlinked snapshots заменяются новыми AC-08/09 tests. |
| CON-05 | `ForensicCoverageV2` разделяет available/selected/excluded; legacy denominator не выдумывается. |
| CON-06 | Latest-five principal fallback имеет приоритет над старым ≥1000 empty behavior. |
| CON-07 | Один `TelegramDeliveryStateV1`; delivery failure не меняет forensic result. |
| CON-08 | Navigation использует stale cache; live call только explicit refresh или first-load background. |
| CON-09 | Approval UI показывает wallet-safety level/action и не показывает transaction expiry. |
| CON-10 | Только direct official-USDT allowance call создаёт current state. |
| CON-11 | Tag — context; dampener требует exact `KnownServiceSessionV1`. |
| CON-12 | Automatic Flash/Pro отсутствует; fresh `llm=null`; legacy LLM JSON audit-only и не влияет на active result. |
| CON-13 | Unknown contract с subject-bound metadata context получает deterministic `35 REVIEW`; normal contract Telegram не содержит model output. |
| CON-14 | USDD PSM получает отдельный typed exposure и calibrated modifier. |
| CON-15 | Later-blacklisted material counterparty сохраняет high current-relationship risk; chronology wording остаётся честным. |
| CON-16 | AC-41 blocked до новых AC tests, полного regression и runtime/manual gates. |
| CON-17 | Address poisoning исключён и закрывается отдельным closeout после runtime verification. |

## 10. Migration и compatibility

### 10.1 Граница version tracking

Текущий `scripts/migrate.ts` не хранит применённые версии: он сортирует и при
каждом запуске повторно выполняет все `.sql`. Поэтому факт наличия файла или
успешный exit code не называется `schema 032 verified`.

Plan 1 резервирует точное имя
`032_telegram_runtime_forensics_data_contracts.sql`. Перед созданием он обязан
проверить, что номер `032` свободен; если занят, работа блокируется и spec
пересматривается — автоматический выбор другого номера запрещён.

`001…031` объявляются `legacy/untracked`: remediation не выдумывает для них
исторические receipts. Начиная ровно с `032`, migrator использует таблицу:

```sql
schema_migration_receipts (
  version integer primary key,
  filename text not null unique,
  checksum_sha256 text not null,
  applied_at timestamptz not null default now(),
  check (checksum_sha256 ~ '^[0-9a-f]{64}$')
)
```

Сама таблица создаётся idempotent DDL внутри migration 032. Для каждого файла
с numeric prefix `>= 032` migrator:

1. читает exact file bytes и считает lowercase SHA-256 до подключения к apply;
2. начинает transaction и берёт exact lock
   `select pg_advisory_xact_lock(20260712032)`;
3. через `to_regclass('public.schema_migration_receipts')` определяет, существует
   ли receipt table; отсутствие table для первого 032 означает `no receipt`;
4. если receipt существует, требует точного совпадения version, filename и
   checksum, SQL повторно не выполняет, но выполняет schema postconditions;
5. если receipt отсутствует, выполняет idempotent SQL, затем schema
   postconditions и только после них вставляет receipt в той же transaction;
6. commit выполняется только после успешных postconditions; ошибка откатывает
   и schema changes, и receipt;
7. существующий receipt с другим filename/checksum является hard failure, а не
   warning или перезаписью.

До `032` migrator сохраняет legacy execution path для `001…031`, но не выводит
для них `verified`. Если schema частично существует без receipt после crash,
idempotent 032 повторяется, проверяется и лишь затем получает receipt.

### 10.2 Schema 032 postconditions

Migration минимум добавляет к `wallet_approvals` поля, необходимые строгому
`ApprovalAllowanceStateV2`:

- `allowance_confirmed_raw text null` — единственный persisted raw value,
  который новый runtime может считать результатом successful direct call;
- `allowance_check_status text not null default 'stale'` со значениями
  `confirmed_active | confirmed_zero | failed | stale`;
- `allowance_checked_at timestamptz null`;
- `allowance_fresh_until timestamptz null`;
- `allowance_last_attempt_at timestamptz null`;
- `allowance_failure_code text null` с allowlist из раздела 4.4;
- index `idx_wallet_approvals_allowance_refresh` на
  `(allowance_check_status, allowance_fresh_until)`.

Существующие non-null `current_allowance_raw`, `is_unlimited` и старый `status`
не становятся authority и не меняют nullability: это rollback-compatible
legacy mirror. Новый writer обновляет их атомарно с authoritative полями:

- confirmed active/zero зеркалит подтверждённый raw/unlimited и совместимый
  active/revoked status;
- failed/stale зеркалит `current_allowance_raw = '0'`,
  `is_unlimited = false`, `status = 'unknown'`.

Новый reader никогда не строит `ApprovalAllowanceStateV2` из legacy mirror.
Старый runtime после rollback видит консервативное `unknown`, а не ложное
active state.

Static PostgreSQL checks обеспечивают допустимые null/value combinations,
canonical uint256, соответствие zero/active/unlimited, порядок timestamps и
failure-code allowlist. Temporal check `now <= freshUntil` выполняет typed
runtime validator: PostgreSQL `CHECK` с текущим временем запрещён. Historical
event amount остаётся отдельным и не переиспользуется как current allowance.
Backfill очищает authoritative fields, ставит `stale` и переводит legacy mirror
в `0/false/unknown`, не `active`.

Migration создаёт constraints с точными именами:

- `schema_migration_receipts_checksum_check`;
- `wallet_approvals_allowance_status_v2_check`;
- `wallet_approvals_allowance_uint256_v2_check`;
- `wallet_approvals_allowance_shape_v2_check`;
- `wallet_approvals_allowance_failure_v2_check`;
- `wallet_approvals_allowance_timestamps_v2_check`.

`schema 032 verified` истинно только когда одновременно:

- в `schema_migration_receipts` ровно одна строка `version = 32`;
- filename равен
  `032_telegram_runtime_forensics_data_contracts.sql`;
- receipt SHA-256 равен checksum exact UTF-8 bytes файла candidate runtime;
- `pg_catalog`/`information_schema` подтверждают точные имена и определения из
  этого раздела: columns/types/nullability/defaults, receipt primary/unique/
  checksum check, все шесть named constraints и
  `idx_wallet_approvals_allowance_refresh` с правильным порядком колонок;
- runtime validator подтверждает temporal allowance-инварианты раздела 4.4;
- legacy backfill не содержит ложных confirmed states;
- transaction migration была committed.

В storage mapping `confirmedAllowanceRaw` читается только из
`allowance_confirmed_raw`; `isUnlimited` вычисляется из него по uint256 rule и
никогда не читается из legacy `is_unlimited`.

Candidate runtime содержит ожидаемые version/filename/checksum и проверяет эти
условия до запуска Telegram, forensic, reconciler и delivery workers. Missing
receipt, checksum mismatch или schema-postcondition failure завершает startup
с hard error; приложение не работает в partially compatible режиме.

Обязательные новые migration tests Plan 1:

- первый apply создаёт schema и receipt атомарно;
- второй apply с тем же checksum не выполняет SQL повторно и повторяет
  postconditions;
- изменённые bytes при том же version дают hard checksum failure;
- правильный receipt при повреждённой schema даёт hard postcondition failure;
- частичная idempotent schema без receipt восстанавливается и получает receipt
  только после проверки;
- ошибка внутри transaction не оставляет receipt;
- legacy rows после backfill остаются `stale`.

Coverage, score anchor, narrative facts и delivery state сохраняют version
inside result/progress JSON, если relational query не требуется. Новая таблица
не создаётся без доказанной необходимости.

Compatibility rules:

- старые jobs не переписываются и не пересчитываются;
- legacy result может использовать старый renderer, но получает fresh-check
  warning;
- новый renderer не выдумывает missing denominator, allowance freshness или
  score anchor;
- policy/result/narrative versions сохраняются в новом result;
- rollback к старому runtime не должен читать новый result как clean/active.

Migration gate:

1. применить на чистой тестовой БД;
2. применить на копии текущей schema;
3. повторный запуск no-op;
4. проверить constraints и stale backfill;
5. запустить PostgreSQL suites;
6. проверить все schema 032 postconditions и receipt SHA-256;
7. до restart получить машинный статус `schema 032 verified` тем же verifier,
   который использует candidate startup.

## 11. Runtime и version gates

Каждый candidate build хранит и показывает:

- Git commit SHA;
- runtime instance label;
- scoring policy version;
- result schema version;
- narrative version;
- migration version и короткий SHA-256 schema receipt.

После deploy обязательны:

1. `/version` показывает candidate SHA/label и `schema 032 verified` с коротким
   checksum; сведения берутся из startup verifier, а не из имени файла;
2. Admin health отвечает `200`;
3. Telegram polling/webhook worker запущен один раз;
4. Where, Incoming, targeted-index, reconciler и delivery cycles живы;
5. all-ready stranded fixture resumes exactly once;
6. retryable delivery меняет attempts, sent fingerprint не отправляется снова;
7. normal tab не вызывает TronScan, explicit refresh вызывает;
8. allowance stale row не называется active до direct confirmation;
9. в логах нет raw wallet/chat/token/API key;
10. rollback command и предыдущая runtime label записаны до canary.

## 12. Ручная Telegram-приёмка

Manual acceptance выполняется на candidate runtime после automated GREEN и до
release. Для каждого сообщения сохраняются screenshot, checked wallet, job id,
runtime label и ожидаемые `REQ/AC` ids.

Приёмка read-only: она не подписывает approvals, не отправляет on-chain funds и
не повторяет вредоносные действия. Наблюдавшиеся адреса используются только
для чтения; недостающие branches проверяются синтетическими fixtures. Ошибки
Telegram delivery и provider failure инъецируются только в test/candidate
environment.

| Кейс | Что проверить |
|---|---|
| TGyt / TWGC | Linked checked wallet; outgoing blacklist route отдельно от incoming bridge; chronology later-frozen; 90/DECLINE; coverage отдельно. |
| THJ collector-only | 35/REVIEW; фактические counts/forwarded share; USDD/service context не становится primary без independent signal. |
| THJ collector + independent signal | 55/REVIEW и два раздельных факта. |
| TKg low balance | Пять principal transfers, 305 inbound/outbound, no false zero/no-activity. |
| True no-activity | Neutral no-score copy без `0%/100% unknown`. |
| 24/10/14 coverage | `Проверили 24`, `к сумме относятся 10`, `14 проверены, но исключены`, доказанная причина остатка. |
| TYD stranded wait | Parent resumes once after reconciler; финальный Telegram result приходит. |
| TNAra Verify20 | Confirmed allowance, 90 wallet-safety, balance at risk, no debit found, counts/BTTOLD only context, revoke action, no AML theft claim. |
| TNAra Bridgers | Exact 66 sec / 91.103009 USDT session, LOW 10, no AML increase, hygiene revoke action. |
| Official USDT | LOW 0 deterministic; no LLM latency or AI copy. |
| GasFree Accounts TGyt/TRivm | LOW 10 contract safety; principal remains traceable/scoreable; no smart-contract penalty. |
| USDD PSM 2% outbound | Exact tier `3`, direction-adjusted modifier `+2`, secondary context, decentralized/freeze wording bounded. |
| USDD PSM 83% inbound | Exact tier/modifier `+25`, top-tier REVIEW context, exact share/direction, no laundering claim. |
| No-final coverage | No numeric score; linked wallet; concrete technical limitation. |
| Delivery retry | Simulated retryable Telegram error; one final visible message; attempts/fingerprint correct. |
| Navigation | Tabs react immediately from cache; refresh shows loading immediately; later callback is not blocked. |
| `/version` | Candidate SHA/label, policy/result/narrative versions и `schema 032 verified` с checksum совпадают с startup verifier и receipt. |

Общий message checklist:

- `🧾 Проверка кошелька` и linked checked wallet;
- risk emoji/score/action только при valid score;
- `🔎 Почему такая оценка` первым содержит score driver;
- money route со стрелкой, amount/share/tx count и clickable addresses;
- incoming provenance не смешан с outgoing risk;
- `📊 Покрытие` содержит честный denominator или legacy fallback без выдумки;
- максимум четыре restrained emoji headings;
- нет raw codes, selectors, LLM verdict/confidence/reason, `Истекает` approval;
- каждая ссылка открывает правильный TronScan address/transaction;
- runtime label соответствует candidate build.

## 13. Automated release gates

Plan 5 допускает release только при одновременном выполнении:

1. Все 41 новые `[AC-XX]` tests сначала имели зафиксированный RED и теперь GREEN.
2. REQ traceability checker подтверждает покрытие REQ-01…REQ-38.
3. Focused suites каждого Plan GREEN.
4. Полный `npm test` GREEN, включая PostgreSQL.
5. `npm run typecheck` GREEN.
6. `git diff --check` без ошибок.
7. Migration gate из раздела 10 GREEN.
8. Runtime/version gates из раздела 11 GREEN.
9. Manual Telegram acceptance из раздела 12 подписана по каждому кейсу.
10. Knowledge 03, 05, 06, 07, 08, 09, 10 и 13 обновлены по фактическому коду.
11. Нет silently rescored legacy jobs.
12. Address poisoning regression suites GREEN, хотя сам track не изменялся.

Любой P0 failure блокирует release. P1 visual/copy failure также блокирует
release, если нарушает AC-07…09, AC-12…13, AC-20…21, AC-27 или AC-39.

## 14. Rollback

- Rollback переключает runtime на предыдущий verified commit без отката
  additive migration 032.
- Новый код читает только authoritative allowance fields; legacy mirror
  поддерживается атомарно специально для безопасного rollback старого runtime.
- Delivery rows со `sent` не возвращаются в pending.
- Jobs, завершённые новой policy, не пересчитываются старым runtime.
- После rollback повторяются health, worker singleton и `/version` checks.

## 15. Address Poisoning closeout boundary

Address poisoning не получает remediation plan в этом треке. После проверки
текущего runtime создаётся отдельный closeout/follow-up документ с:

- deployed commit/runtime label;
- migration 031 state;
- monitor/check/delivery worker health;
- queue and retry state;
- Telegram alert/callback verification;
- статусом отдельной four-character ветки;
- оставшимися ограничениями и решением закрыть/продолжить track.

Ни один из пяти remediation plans не меняет poisoning detector, schema,
scoring isolation или alert copy, кроме обязательного regression preservation
в AC-41.

## 16. Переход к планированию

До утверждения этого документа implementation plans и код не создаются. После
утверждения последовательно создаются пять plan documents из раздела 6. Каждый
plan обязан:

- перечислить свои REQ/AC ids;
- начать с конкретных RED tests из раздела 8;
- назвать exact files и команды;
- иметь отдельный review и verification gate;
- обновить knowledge только по реально внедрённому поведению;
- завершиться отдельным commit без захвата чужих dirty files.
