# Stage C Runtime, Blind Validation, And Stage D Exact Scoring Design

**Статус:** утверждённый design; production activation и числовые строки
matrix-v5 этим документом не разрешены

**Дата:** 2026-07-31

**Проверенная база:** master
4ec5cabbd63aba71fa9cc160692057d462476c83

**Связанные документы:**

- 2026-07-29-service-boundary-sampling-amendment-design.md;
- 2026-07-29-chronological-proportional-balance-provenance-design.md;
- 2026-07-30-forensic-model-completion-roadmap-and-exact-role-capture-design.md;
- 2026-07-30-subject-service-and-cashflow-query-amendment-design.md.

## Результат

Stage C завершается как полностью score-neutral цепочка наблюдения, physical
authority, adverse preservation и нового blind review. Stage D после этого
может изменить реальный score только через принятые exact adverse facts,
достижимые по hash из accepted traversal result и оценённые новой
versioned scoring policy.

Основная цепочка:

    Stage C accepted-history shadow
      -> physical-page authority
      -> EOAAtAnchor
      -> complete adverse receipt
      -> new blind 24 + 6
      -> cashflow authority bridge
      -> Stage C acceptance receipt
      -> snapshot-closure-v3
      -> accepted traversal + child evidence
      -> CanonicalFactV2 inventory
      -> canonical-fact-reconciliation-v1
      -> accepted EvidenceBundleV2
      -> stage-d-closure-receipt-v1
      -> scoring-signal-matrix-v5
      -> ScoreAnchorV4
      -> report-v2

Stage C никогда не создаёт AML-баллы. Статусы high_inferred_service,
non_service_profile, insufficient_data, role_conflict, coverage, unresolved и
само решение о boundary имеют нулевой score impact.

## Проверенная текущая truth

- Production finalizer принимает facts только из accepted Fast, Where и Deep
  branch outputs. Standalone Stage C и cashflow artifacts им игнорируются.
- Pure accepted-history builder существует в
  src/unifiedCheck/serviceRoleShadow.ts.
- Typed gate выполняет service 24/24 и adverse 6/6, но это regression и
  evidence-level accounting, а не blind accuracy.
- Одна реальная frozen history имеет exact role map 200/200. Общая доступность
  остаётся малой: одна role-bound history из 3 745 принятых histories и 200
  role-bound events из 311 990 sampled events.
- Accepted-history profile прямо маркирован boundaryPageAuthority:false.
  Он не может стать production boundary authority.
- Classifier в src/forensics/serviceBehaviorResearch.ts использует только
  C/B/G/H/R/X и возвращает high_inferred_service,
  non_service_profile, insufficient_data или role_conflict.
- Checked subject явно исключён через checked_subject_excluded.
- Cashflow ledger, canonical tape и shadow artifact существуют только в
  forensic/offline-контуре. Ledger corpus выполняется 7/7.
- Реальный PacGy остаётся unresolved /
  history_incomplete_before_anchor / authoritative:false.
- IndexedTronUsdtTransfer не несёт authoritative transactionIndex.
- Текущий snapshot не даёт independent pinned USDT balance witness.
- Текущее accountType является current observation и не доказывает
  EOAAtAnchor.
- provider-request-identity-v1 не различает service recent/historical window,
  timestamp bounds и page offset.
- Baseline master перед записью этого design прошёл npm run typecheck и полный
  npm test: 302 test files и 5 345 tests passed; 27 files и 175 tests были
  заранее skipped.

## Нормативные принципы

1. Exact fact, inferred role, incomplete coverage и technical state являются
   разными доменами.
2. Отсутствие evidence не превращается в not_found или clean.
3. high_inferred_service может экономить ordinary traversal только после всех
   Stage C gates и только в snapshot-closure-v3. Он не является risk fact.
4. Exact adverse terminal сохраняется независимо от service boundary,
   materiality и cashflow selection.
5. Exact-bound nonterminal lead продолжает только доказанный bound path.
6. Method-only, provider marker, incomplete binding и unresolved authority не
   создают risk fact.
7. Исторические v1/v2 runs сохраняют matrix-v4, ScoreAnchorV3 и старый report.
   Они не пересчитываются.
8. snapshot-closure-v3 и scoring-signal-matrix-v5 образуют одну policy pair.
   Нельзя активировать одну версию без другой.
9. Matrix-v5 без новых Stage D scored facts обязана сохранить числовой score,
   decision и semantic row matrix-v4.
10. Любой невосстановимый технический failure до accepted EvidenceBundleV2
    завершает новый run как technical no-score, а не как low risk.

## 1. Граница Stage C и Stage D

Stage C accepted-history и cashflow shadows хранятся только как standalone
evidence. Их flags и artifacts:

- не входят в AnalysisManifest;
- не меняют provider configuration hash;
- не входят в request, task или attempt identities;
- не меняют rollout admission;
- не достижимы из authoritative final hashes;
- не отображаются как production truth в report, Telegram или Admin;
- имеют productionEffect:false.

Offline physical capture имеет собственные provider-request identities и page
hashes, но они не входят в authoritative production run/task/attempt до
отдельного snapshot-closure-v3 integration. То есть Stage C не меняет
существующие production identities, а не запрещает identity внутри
validation-capture.

Stage D finalizer читает только EvidenceBundleV2, который ссылается на
accepted snapshot-closure-v3 attempt/result и на достижимый из result
stage-d-child-evidence-bundle-v1. Ряд в unified_check_artifacts без такой
ациклической reachability не обладает authority.

Новые версии не меняют старые parser contracts. Старые manifest, traversal,
fact, evidence и anchor artifacts продолжают валидироваться старым путём.
AnalysisManifestV2, traversal-v3, CanonicalFactV2, EvidenceBundleV2 и
ScoreAnchorV4 получают отдельные строгие parsers и dispatch по manifest
version.

## 2. Stage C accepted-history runtime shadow

### 2.1 Конфигурация

Добавляется UNIFIED_SERVICE_ROLE_SHADOW_POLICY.

Допустимы:

- отсутствие переменной: disabled;
- literal disabled;
- service-role-shadow-100-plus-100-v1.

Пустая строка, boolean-подобное значение или неизвестная версия являются
startup error. Значение не попадает в authoritative manifest или provider
configuration hash.

### 2.2 Точка врезки

productionTraversalCoordinator получает optional group observer.

Observer вызывается:

1. после загрузки и hash-проверки accepted address-history manifest и pages;
2. после успешного применения history к authoritative traversal state;
3. до обычного checkpoint return/commit;
4. один раз на существующую authoritative manifest/address+direction group,
   а не один timeout на каждый state.

Authoritative grouping coordinator не меняется. Внутри observer группа только
для shadow расчёта детерминированно разбивается по
anchorBinding+sampledEventIdsSha256. Это запрещает делить одну role map между
разными anchors, не меняя frontier/application order.

Вход observer содержит:

- run ID и snapshot hash;
- checked subject;
- manifest key и именно accepted artifact SHA-256;
- accepted page hashes и revived events;
- стабильно отсортированную state group;
- exact route-anchor event/order и sampled-event-set hash каждого shadow
  subgroup.

У группы один deadline 1 000 ms. Это диагностический предел, а не production
SLO. Heartbeat выполняется до и после bounded observer. Timeout прекращает
старт новых per-state операций. Уже начавшийся late insert имеет attached
rejection handler и остаётся безопасным благодаря content-addressed
idempotence.

Observer является failure-contained: timeout, callback rejection или
observation/persistence error перехватываются до authoritative checkpoint
return и не меняют applied traversal state либо worker result.

Observer получает AbortSignal и регистрирует каждую начатую persistence
promise. После deadline новые операции запрещены, signal aborts cooperative
work, а все late settlements имеют attached handlers. Созданный до commit
profile является только precommit observation; сам по себе он не доказывает,
что authoritative checkpoint был сохранён.

### 2.3 Role-map lookup

Текущий ServiceRoleShadowEventRoleMapV1 не содержит route anchor или sampled
set и поэтому остаётся historical source. Runtime принимает только additive
service-role-shadow-event-role-map-v2 wrapper, который связывает:

- source V1 map SHA-256;
- run, snapshot и accepted history manifest;
- profiled address/direction;
- exact route-anchor event/timestamp/order;
- sorted recent/historical sampled canonical event IDs и их SHA-256;
- exact 200/200 coverage proof.

Существующий V1 artifact не мутируется. V2 wrapper materialize-ится до
runtime replay и не получает accepted-attempt reference.

До первой группы loader под run lock делает ровно один run-wide load V2 maps,
замораживает sorted hashes в service-role-shadow-input-set-v1 и после этого
использует только lookup по exact hashes/compound binding. Existing input-set
на restart переиспользуется; maps, созданные после fence, до нового run не
видны. Таким образом missing кешируется относительно явного input-set hash, а
не относительно изменяемого table contents. N глобальных JSONB scans
запрещены; новая migration/index для C1 не нужна.

Run-wide preload имеет отдельный bounded deadline. Timeout отключает shadow
observer до конца run и не расходует per-group deadline. Group lookup
возвращает union:

- missing;
- found;
- conflict.

Map-or-null запрещён, потому что не различает отсутствие и несколько
конфликтующих rows.

Found row проверяется по:

- created_by_run_id;
- kind service_role_event_role_map;
- V2 schema version и source V1 hash;
- row SHA-256 против canonical body;
- run, snapshot, address-history manifest, anchor и sample bindings;
- evidence bundle cardinality и exact sampled-event coverage.

Несколько rows для одного compound binding являются conflict. Map одного
anchor/sample нельзя автоматически использовать для другого anchor/sample.

### 2.4 Persistence

Существующий service-role-shadow-profile-v1 не переписывается. Его внутренний
traversalStateId рассматривается как shadowStateId.

До authoritative checkpoint commit сохраняется только
service-role-shadow-precommit-receipt-v1, который связывает:

- sourceTraversalStateId из authoritative traversalStateId();
- shadowStateId из builder;
- run, snapshot и accepted manifest;
- anchor/sample binding и frozen input-set hash;
- profile artifact SHA-256;
- policy version;
- candidate checkpoint/delta hash;
- commitStatus:unconfirmed;
- productionEffect:false.

Profile сохраняется как kind service_role_shadow_profile, schema 1, через
существующий insertUnifiedArtifact. Receipt также standalone и не получает
attempt reference.

Только после успешного repository checkpoint/attempt commit post-commit hook
может создать service-role-shadow-runtime-receipt-v1. Он связывает precommit
receipt, exact committed checkpoint/delta и accepted history hash, runtime Git
commit, observer policy/input-set и commitStatus:reconciled. Claim loss,
failed commit, timeout или late settlement никогда не получают reconciled
receipt.

Missing map, conflict, malformed source, timeout, persistence failure и
observer failure не создают DB-row на каждый skip. После terminal traversal
shadow reconciler строит один service-role-shadow-run-summary-v1 из frozen
input set, final accepted history inventory и reconciled receipts. Summary
фиксирует aggregate typed counts, orphan/precommit count, sorted successful
receipt hashes, runtime commit и complete/incomplete status. Restart повторно
вычисляет тот же summary; orphan/late profiles игнорируются.

Новая migration не нужна. Все новые artifacts standalone; authoritative
checkpoint bytes, task/attempt identity и finalizer input не меняются.

### 2.5 Non-interference gate

Один и тот же deterministic provider tape выполняется в двух изолированных
PostgreSQL schemas:

- disabled;
- enabled с заранее bound complete map.

Побайтно сравниваются:

- provider calls и cache decisions;
- frontier, visited states, terminals и superseded states;
- planner, tasks, attempts, accepted attempts и checkpoints;
- traversal delta и compaction heads;
- branch facts и canonical facts;
- score, decision, anchors и final hashes;
- report, presentation и Telegram payload;
- delivery rows, включая attempt_count, last_error и telegram_message_id;
- Admin DAG.

Отдельные контроли покрывают missing/duplicate/malformed map, timeout,
observer throw, persistence rejection, restart и late completion.

Runtime shadow принят только когда:

- старый regression gate остаётся 24/24 + 6/6;
- существует минимум одна admitted real fully-role-bound history;
- reconciled runtime receipt и complete run summary получены именно для этой
  history на текущем runtime Git commit в isolated replay, а не на synthetic
  fixture;
- provider calls не увеличились;
- authoritative bytes не изменились;
- profile/receipt hashes отсутствуют в attempts и final hashes;
- focused, PostgreSQL, typecheck и full tests проходят.

## 3. Physical service authority

### 3.1 Provider request identity v2

provider-request-identity-v2 добавляется аддитивно; V1 bytes не меняются.

Identity связывает:

- provider family, endpoint и API schema;
- address и token;
- snapshot block number/hash;
- block start/end;
- window kind recent или historical;
- inclusive timestamp bounds;
- direction/order;
- page offset и page size;
- confirmation requirement.

Разные window kind, endTimestamp и offset обязаны давать разные identities.
Route anchor event/order, sampling policy и behavior policy входят только в
service-boundary-probe identity. Они не входят в HTTP request identity:
байты одного фактически одинакового запроса обязаны переиспользоваться между
разными probes.
Raw payload, payload hash, request identity и normalized inventory сохраняются
immutable.

### 3.2 Physical windows

Baseline всегда:

- recent offsets 0 и 50, page size 50;
- historical offsets 0 и 50, page size 50;
- historical cutoff =
  min(anchor minus seven days, recentBaselineStart minus seven days).

Historical baseline замораживается до решения об expansion. Top-up запрещён.
После dedupe в каждом окне должно остаться ровно 100 canonical events.
Меньшее число блокирует boundary.

Baseline policy C0-C6 не делает automatic expansion. Контракт резервирует для
отдельной будущей версии только recent offsets 100, 150, ..., 450; historical
window при этом не расширяется. Такой 500 + 100 capture можно открыть только
после frozen ambiguous fixture и отдельного human approval. Если он будет
разрешён, он обязан использовать существующие scheduler, key groups, cooldown
и capacity; отдельный rate limiter или новый provider capacity class не
создаётся.

Future events исключаются. Order должен быть exact либо доказанным unique-block
order. Collision, mixed snapshot, non-progressing pagination и contradictory
pages дают unresolved.

Accepted-history reconstruction остаётся control с
boundaryPageAuthority:false. Physical authority получает отдельный
service-boundary evidence/profile contract; reconstructed profile не
повышается изменением одного boolean.

### 3.3 EOAAtAnchor

Current getAccountInfo или address_metadata.accountType не являются
исторической authority.

EOAAtAnchor доказан только одним из вариантов:

1. historical-account-state-witness-v1, закреплённый на точном block/hash и
   доказывающий отсутствие contract code;
2. account-role-timeline-witness-v1 с полной timeline до anchor,
   доказывающей отсутствие contract role перед anchor.

Если доступный provider не может выдать ни один вариант, результат
eoa_at_anchor_unresolved, boundary=false и continue_full. Контракт, unknown,
current-only observation и inference не дают EOA.

Availability historical EOA witness проверяется ранним authority-feasibility
probe. Его отсутствие является hard blocker для authoritative Stage C и
Stage D activation.

## 4. Complete adverse preservation

Для каждого boundary candidate строится frozen applicability matrix.

Проверки включают:

- event-time blacklist;
- event-time sanctions/restricted state;
- exact service/exchange identity;
- tracked drainer/collector;
- provider-risk corroboration;
- poisoning и GasFree economic roles;
- approval, transferFrom и proxy;
- Verify20 full fingerprint;
- selector, log, finality и movement binding;
- exact continuation address и bound event IDs.

Каждая ожидаемая строка имеет outcome:

- proven;
- not_found;
- not_applicable;
- unresolved.

Outcome сам по себе не задаёт risk action. Frozen adverse-policy-v1 registry
для каждого checkId фиксирует authorityClass и dispositionClass:

- exact_terminal_risk -> terminal_red;
- exact_bound_nonterminal -> continue_exact_path;
- exact_service_role_context -> role/context only;
- provider_corroboration_context -> context only;
- economic_role_context -> applicability/context only;
- cashflow_relevance_context -> standalone relevance only;
- negative_authority -> no adverse action после authoritative not_found.

Benign exact service/exchange identity относится к
exact_service_role_context, а не к exact_terminal_risk. Provider marker,
poisoning/GasFree role или method-only Verify20 никогда не повышаются до red
из-за одного outcome=proven. Restricted service, drainer/collector и Verify20
получают terminal/continuation disposition только через свой exact
event-bound authority parser. Неизвестная комбинация checkId/authorityClass/
dispositionClass отклоняет receipt.

Отсутствие row не равно not_found. not_found допускается только после полного
authoritative negative request. Timeout, overflow, missing binding,
unsupported authority и partial coverage дают unresolved.

Существующий selective-enrichment ceiling сохраняется без изменения. Subject
hard evidence не имеет numeric ceiling. Для intermediate-boundary analysis
после deterministic hard-first dedupe допускается максимум пять triggered
full-information requests. Шестой и каждый следующий trigger записываются как
explicit overflow/unresolved, оставляют adverse receipt incomplete, запрещают
inferred stop и требуют continue_full. Новый budget или unbounded fetch не
вводится.

Aggregate receipt считается complete только когда resolved count равен
expected count и все обязательные checks присутствуют. Отдельно
terminalAuthorityComplete означает, что exact terminal row имеет полную
event/finality/subject binding; он не маскирует incomplete aggregate.

Единый deterministic reducer применяет registry pairs в таком precedence:

1. Любой proven exact_terminal_risk с terminalAuthorityComplete -> сохранить
   terminal_red и не загружать endpoint history. Все unresolved/overflow и
   continuation rows остаются в receipt как limitations/context, но не могут
   снова открыть terminal endpoint.
2. Без terminal, если хотя бы одна обязательная row unresolved ->
   adverse_unresolved и continue_full. Все proven exact-bound continuation IDs
   при этом сохраняются и планируются дополнительно; ordinary traversal не
   подавляется.
3. Без terminal/unresolved, но с proven exact_bound_nonterminal ->
   continue_exact_path только по всем deduplicated bound continuations.
4. proven cashflow_relevance_context -> cashflow_relevance_only по уже
   известным intermediate event IDs; он не меняет traversal action.
5. Complete receipt без exact terminal/continuation ->
   adverse_clear_for_boundary; это completeness outcome, а не утверждение, что
   адрес safe или clean.

Reducer сортирует rows по frozen checkId и выдаёт одну endpoint action плюс
sorted unique continuation IDs. Обязательны отдельные fixtures
terminal+overflow, terminal+continuation и unresolved+continuation.

Service inference не может скрыть red fact или continuation.
cashflow_relevance_only в Stage C остаётся standalone observation и не
попадает в первую D2-v1 scoring chain.

## 5. Blind validation и legacy corpus

### 5.1 Существующая regression/admission выборка

Существующая исследовательская книга с 21 вручную описанным адресом вместе с
W8SRL, TQr и TXc образует текущий service corpus из 24 cases. Отдельно
сохраняются 6 adverse cases.

Corpus 24/24 + 6/6 остаётся обязательной регрессией и никогда не называется
новым blind corpus.

Ручные поля:

- Экспертная оценка;
- Рекомендация границы;
- A/S;
- Исследовательская группа;

сохраняются как historical calibration и explanation. Они получают canonical
immutable export с original workbook SHA-256 и runtimeInput:false. Они не
становятся production authority, scoring facts или boundary evidence.

Labels probable, service_like, professional_operator и human_like не входят в
ServiceBehaviorResultV2 и не получают production action.

Executable classifier использует только:

- predicates C/B/G/H/R/X;
- high_inferred_service;
- non_service_profile;
- insufficient_data;
- role_conflict.

non_service_profile означает только непрохождение high-service predicate. Он
не доказывает human control, safety или отсутствие service role.

Exact service identity обрабатывается отдельным event-time-valid authority
path.

### 5.2 Новый blind corpus

Новый набор содержит ровно 30 новых и взаимно непересекающихся cases:

- 24 physical service-role/safety cases;
- 6 adverse-preservation challenges.

Service 24 заранее разделены на обязательные strata:

- 15 intermediate non-subject EOA-at-anchor cases с complete physical/role
  authority;
- 3 checked-subject controls, для которых единственный допустимый action
  checked_subject_excluded/continue_full;
- 3 contract-at-anchor controls с contract witness и continue_full;
- 3 deliberately authority-incomplete controls: short pages, unknown EOA или
  order/role conflict, с typed unresolved и continue_full.

После adjudication внутри первых 15 должно оказаться минимум шесть истинных
boundary positives и минимум шесть ordinary non-boundary negatives. Если
quota не достигнута, blind run aborts; cases после unblind не заменяются.

Он не пересекается по address, case ID, snapshot и captured subject с:

- всеми 24 current service cases;
- всеми 6 current adverse cases;
- W8SRL, 98cdn, aEGqTr, TQr и TXc;
- CSV/calibration/model-development cases;
- existing Binance/HTX regression;
- synthetic fixtures;
- C/B/G/H/R/X design addresses.

До capture и model execution protocol lock фиксирует:

- source datasets и их hashes;
- population cutoff block/time;
- inclusion/exclusion predicates для каждой stratum;
- future finalized chain height, чей block hash станет unpredictable
  selectionSeed после protocol lock;
- canonical candidate ID и sort key
  sha256(selectionSeed, stratum, address, anchorEventId, snapshotHash);
- stratum quotas, allowed mechanical rejection reasons и stopping rule;
- total stratum claim order: intermediate, checked_subject, contract,
  authority_incomplete, event_time_blacklist, active_sanctions,
  drainer_collector, restricted_service, verify20_terminal,
  exact_bound_nonterminal.

После появления selectionSeed строится полный canonical population artifact.
В каждой stratum candidates идут только по sort key; rejected candidate
остаётся в immutable rejection log, а scanner берёт следующий до quota.
Остановка происходит сразу после заполнения quota. Изменить cutoff, seed,
порядок, причину rejection или вручную пропустить candidate нельзя.

Один global claimed-case set применяется в frozen total stratum order.
Case/address/snapshot/captured-subject collision получает typed
already_claimed_by:<stratum> в immutable collision log, после чего текущая
stratum берёт следующий sort key. Это first-claim правило единственно; adverse
case, подходящий нескольким classes, не может занять две квоты.

Для 15 intermediate cases eligibility определяется только complete physical
pages, exact order, role evidence, EOAAtAnchor и adverse applicability matrix;
candidate обязан быть non-subject без уже exact service boundary. Для subject,
contract и incomplete strata eligibility означает доказанную принадлежность
именно к control stratum, а не положительную boundary authority. Classifier
output, predicates, expected class/action и score до final case lock не
вычисляются и не доступны selection process. Если population исчерпана до
quota, blind run aborts.

Adverse population использует тот же protocol/seed/rejection discipline и
выбирает по одному case для каждого frozen class:

- event-time blacklist;
- active sanctions/restriction;
- tracked drainer/collector;
- exact restricted service;
- complete Verify20 terminal;
- exact-bound nonterminal lead.

Все 30 case IDs, selection/rejection log, population hash и exclusion proof
замораживаются до выдачи neutral reviewer bundle.

### 5.3 Review protocol

Используются только canonical JSON и immutable artifact-store primitives
Golden V2. Его attribution, score schemas и locked manifest не переиспользуются.

Reviewer A и Reviewer B получают один neutral bundle hash без:

- classifier output;
- thresholds и predicates;
- expected action;
- score;
- identifying metadata, не нужных для adjudication.

Каждый reviewer независимо фиксирует:

- role interpretation;
- authority completeness;
- expected three-way action;
- red event IDs;
- continuation IDs;
- reason.

Review artifacts immutable и имеют разные reviewer IDs. Adjudicator разрешает
все disagreement до раскрытия model output. После этого expectation manifest
замораживается и только затем запускается comparator.

Проваленный blind set не ретюнится. Он становится immutable regression, а новая
версия требует нового blind set.

### 5.4 Blind gates

Обязательны:

- 30/30 valid, adjudicated и evaluable cases;
- 6/6 adverse preservation;
- zero false stop на ordinary, unresolved, subject или contract cases;
- zero lost red facts;
- zero lost continuation IDs;
- zero stop при incomplete authority;
- zero future leakage;
- zero duplicate logical requests;
- минимум шесть adjudicated positive boundary-eligible cases;
- минимум шесть adjudicated ordinary non-boundary cases;
- минимум 80% correct stop среди positives;
- aggregate avoided histories больше нуля;
- aggregate avoided pages больше нуля;
- aggregate net provider cache misses saved больше нуля, где из baseline
  ordinary-history misses вычитаются все probe, EOA, adverse и sidecar misses;
- paired deterministic tape показывает положительную net provider-wait
  экономию; logical calls, physical HTTP calls, cache hits/misses и
  end-to-action median/p95 сохраняются раздельно.

Missed positive продолжает continue_full и становится regression; он не
нарушает safety gate, пока utility threshold сохраняется.

Gross avoided pages без стоимости probe не считается utility. Live p95 не
подменяется replay timing: для D3 отдельно замораживается latency budget и
проверяется isolated canary.

## 6. Cashflow authority bridge

### 6.1 Существующее ядро

Математика chronologicalProportionalLedgerV1 не меняется:

- canonical identity требует receipt tx hash и log index;
- same-block order требует transactionIndex/eventIndex;
- authoritative ledger требует genesis_complete и opening balance 0;
- future event, identity/order ambiguity и debit beyond inventory дают
  unresolved;
- current_balance требует matching pinned independent balance на exact
  subject/block/hash;
- allocation использует deterministic proportional largest remainder;
- deep selection покрывает 95% selected known amount и сохраняет каждый exact
  red contributor независимо от доли.

Новая opening-balance модель не вводится. Для non-zero authoritative opening
потребуется отдельная версия ledger.

### 6.2 Production-owned authority producer

CashflowAuthorityProducerV1 принимает только accepted snapshot, exact
movement/order evidence, history closure, economic roles и evidence refs.

Он возвращает существующий union:

- canonical_tape;
- unavailable с typed public reason.

Нельзя строить tape из report, Telegram, risk labels или inferred provider
order.

Пока transactionIndex и independent pinned balance отсутствуют, production
adapter обязан вернуть typed unavailable.

Для runtime добавляется cashflow-shadow-receipt-v1, связывающий:

- run и analysis manifest hash;
- subject и USDT contract;
- snapshot block/hash;
- accepted direct-history artifact hash;
- selector и ledger policy versions;
- capture binding;
- canonical authority envelope binding;
- output shadow hash;
- productionEffect:false.

Receipt не полагается на nullable поля существующего unavailable shadow.
Его canonical schema содержит:

- query identity: subject, purpose и typed target;
- capture = present с sha256 либо absent с typed reason;
- authorityEnvelopeSha256 = hash canonical JSON результата
  parseCashflowAuthorityEnvelopeV1;
- authority kind, typed reason и hash отсортированных unique evidence refs
  для unavailable;
- tape artifact sha256 для canonical_tape;
- shadow artifact sha256.

Для unavailable capture/tape не подставляются пустой строкой или fake hash.
Одинаковый unavailable envelope может иметь общий content hash, но receipts
разных subject/purpose различаются за счёт query identity. Parser запрещает
unknown keys, cross-variant fields, unsorted duplicates и hash mismatch.

### 6.3 Query Selector V1

Первая shared policy выбирает только:

    /check + snapshot subject -> current_balance

Она не использует balance threshold, risk score или label.

- amount_only не выбирается;
- exact_episode остаётся отдельным Incoming contract;
- triggered relevance не входит в selector V1;
- zero balance даёт not_applicable;
- missing authority даёт unresolved, а не clean.

### 6.4 Runtime shadow

UNIFIED_CASHFLOW_SHADOW_POLICY:

- unset или disabled -> disabled;
- cashflow-current-balance-shadow-v1 -> enabled;
- empty, boolean-like и unknown -> startup error.

Shadow observer читает только уже materialized local authority envelope, не
делает provider calls и не создаёт required task. Artifact и receipt
standalone, immutable, idempotent и не входят в EvidenceBundleV1.

Acceptance:

- offline ledger corpus остаётся 7/7;
- существует минимум один real authoritative current_balance complete-control;
- PacGy остаётся real unresolved-control;
- zero balance, incomplete role, identity collision, missing order и balance
  mismatch имеют отдельные controls;
- replay и row permutation сохраняют artifact hash;
- enabled/disabled authoritative bytes совпадают;
- accepted-attempt references равны нулю.

### 6.5 Cashflow и score

Cashflow не создаёт отдельный AML candidate.

Он отвечает только, относится ли уже доказанный exact adverse path к текущему
балансу или выбранной сумме.

Если будущая отдельная policy разрешит authoritative transport,
cashflow_relevance_only сможет дополнить существующий fact:

- amount;
- contributor IDs;
- known intermediate event IDs;
- relevance evidence refs.

Даже тогда он не создаёт второй fact и не удваивает score.

Exact path fact может оцениваться без current-balance authority только если
семантика строки matrix-v5 не утверждает current exposure. Строка, заявляющая
current-balance exposure, требует complete cashflow binding.

В первой atomic policy pair D2-v1 cashflow shadow остаётся standalone и не
имеет accepted hash-path в EvidenceBundleV2. Поэтому cashflow_relevance_only
не создаёт и не усиливает scored fact, а строки current-balance exposure в
matrix-v5 отсутствуют. Их добавление требует отдельного accepted
cashflow-relevance artifact/task, включения его authority envelope и tape в
stage-d-child-evidence-bundle, blind scoring adjudication и новой совместной
policy version. Stage C cashflow bridge лишь доказывает готовность authority,
но не обходит эту границу.

Unresolved cashflow не уменьшает score, не добавляет risk и запрещает
утверждение о current-funds relevance.

## 7. Checked-subject role policy

Intermediate service boundary и роль checked subject являются разными
продуктовыми вопросами.

Текущий Stage C продолжает классифицировать только intermediate addresses.
checked_subject_excluded сохраняется.

Этот раздел фиксирует первую допустимую policy boundary, но C0-C6 не создаёт
subject classifier или authoritative subject-role transport. Без отдельно
accepted report-context artifact поле subject role остаётся absent.

Первая policy для роли checked subject является report-only:

| Evidence | Report | Boundary | Score/candidate suppression |
|---|---|---|---|
| Manual subject role | historical context | none | none |
| Inferred subject role | inferred context | none | none |
| Inferred intermediate service | context | only accepted v3 boundary | zero direct points |
| Exact event-time service identity | exact role | separate authority path | zero direct points; no suppression before adjudication |
| Exact adverse evidence | exact risk | preserved terminal/path | eligible only through matrix-v5 |

Нельзя:

- переименовывать high_inferred_service в OTC, treasury или professional
  operator;
- отображать non_service_profile как human_like;
- уменьшать score из-за manual/inferred subject role;
- удалять или ослаблять exact adverse evidence;
- заменять существующий behavioral candidate inferred role;
- разрешать exact service identity подавлять candidates без отдельной scoring
  adjudication.

Будущий suppression требует отдельной checked-subject-role policy, нового
непересекающегося blind corpus, двух reviews, adjudication и новой scoring
policy version. Он не расширяет текущий intermediate classifier.

## 8. Stage D traversal и evidence transport

### 8.1 Policy pair

Единственный authoritative новый bundle:

    snapshot-closure-v3 + scoring-signal-matrix-v5

Normal default остаётся v1/v2 до отдельной activation decision. V3 можно
создавать только в isolated replay/canary.

AnalysisManifestV2 фиксирует:

- traversal policy v3;
- scoring policy v5;
- sampling/behavior/adverse policy versions;
- provider request identity v2;
- EOA policy;
- Stage D evidence schema;
- legacy-v4-parity projection и risk-occurrence reconciliation registry
  versions.

### 8.2 Task flow

До загрузки полной ordinary intermediate history:

1. проверить существующую exact disposition;
2. если disposition является exact terminal red, сохранить terminal_red и
   завершить endpoint без service_boundary_probe и без endpoint history;
3. иначе создать ordered task service_boundary_probe;
4. получить complete physical profile, EOA и adverse receipt;
5. выбрать action.

Actions:

- continue_full -> планировать обычную address_history; если receipt уже
  содержит exact continuation IDs, их sidecars также планируются и не
  заменяют ordinary path;
- stop_ordinary -> не планировать обычную history;
- stop_ordinary_expand_adverse -> создавать только exact-bound investigation
  tasks.

service_boundary_probe identity связывает run, snapshot, state, anchor,
address, policy versions, provider request v2 и EOA policy.

Task использует существующий provider pool, fairness, bucket ownership,
bounded checkpoint chunks, content cache и restart rules. Новая capacity
система не создаётся.

### 8.3 Sidecars и closure

service_risk_investigation sidecars допустимы только для exact-bound
nonterminal continuation.

Они:

- не получают fake allocatedAmount;
- не входят в cashflow denominator;
- не открывают history exact terminal endpoint;
- не создают duplicate ordinary branch.

Closure разделена:

- provenanceClosed;
- riskContextClosed;
- reportReady = provenanceClosed && riskContextClosed.

Эти значения не становятся новой параллельной job state machine. Их
единственный owner — существующий parent finalizer. Полный persisted
UnifiedRunStatus остаётся неизменным: RUNNING, WAITING_FOR_PROVIDER,
BLOCKED_ADMIN, FINALIZING, COMPLETED и FAILED_TECHNICAL. Четыре состояния без
BLOCKED_ADMIN/FINALIZING являются лишь существующей public projection, а не
полным storage contract.

- RUNNING/WAITING_FOR_PROVIDER сохраняется, пока required probe/sidecar имеет
  разрешённый retry или provider wait;
- BLOCKED_ADMIN сохраняет существующую ручную блокировку и не считается
  closure;
- FINALIZING остаётся единственной фазой, где parent finalizer собирает и
  валидирует V2 inventory/bundle/closure receipt;
- riskContextClosed=true только когда у каждого required state есть accepted
  terminal receipt: complete, terminal_complete, not_applicable,
  unresolved_terminal или budget_exhausted_terminal;
- terminal_complete требует terminalAuthorityComplete и сохраняет aggregate
  unresolved counts как limitations; он не означает aggregateComplete;
- unresolved_terminal и budget_exhausted_terminal являются typed limitations,
  а не risk facts и не not_found; они разрешают v4-parity finalization только
  когда action был continue_full и ordinary provenance действительно closed;
- unresolved/budget_exhausted required exact-bound sidecar не закрывает
  riskContext: после retries D2-v1 переводит run в FAILED_TECHNICAL; fallback
  action в этой policy отсутствует;
- reportReady является вычисляемым условием parent finalizer, а не mutable
  boolean: обе closures true и EvidenceBundleV2 прошёл полную валидацию;
- при reportReady finalizer создаёт immutable stage-d-closure-receipt-v1 с
  accepted EvidenceBundleV2 hash и counts всех terminal outcomes;
- missing artifact до окончания retry остаётся pending; исчерпавший retries
  missing artifact, malformed/hash mismatch, dangling ref, cycle или conflict
  атомарно переводит run в существующий FAILED_TECHNICAL.

FAILED_TECHNICAL является тем самым technical no-score: ScoreAnchorV4,
report-v2, analytical presentation и delivery intent не создаются. Valid
typed unresolved внутри принятого bundle не равен invalid/missing bundle и не
вызывает вечное ожидание.

### 8.4 Ациклический Stage D evidence DAG

До закрытия traversal строится stage-d-child-evidence-bundle-v1. Он связывает:

- manifest/run/snapshot и policy versions;
- provider requests и pages;
- EOA witnesses;
- per-state decisions;
- adverse checks;
- sidecars;
- completeness counts;
- action receipts.

Для exact terminal red short-circuit child bundle связывает исходную exact
disposition и terminal action receipt; provider pages, EOA и boundary probe
для этого state имеют явный not_applicable count. Так terminal fact остаётся
transportable, не открывая endpoint history.

Accepted traversal-v3 result обязан содержать
stageDChildEvidenceBundleSha256. Затем accepted traversal attempt ссылается на
этот result. Только после acceptance строится EvidenceBundleV2, который
связывает все branch attempts/outputs, accepted traversal attempt/result и
достижимый из result stage-d-child-evidence-bundle-v1. Он также связывает
CanonicalFactV2 inventory, V1->V2 mapping receipt и
canonical-fact-reconciliation-v1.

Таким образом hash-DAG имеет единственное направление:

    probe/page/EOA/adverse/sidecar artifacts
      -> stage-d-child-evidence-bundle-v1
      -> traversal-v3 result
      -> accepted traversal attempt
    accepted branch attempts/outputs + accepted traversal chain
      -> CanonicalFactV2 inventory
      -> V1 mapping / occurrence reconciliation receipts
    CanonicalFactV2 inventory + reconciliation + accepted traversal chain
      -> EvidenceBundleV2
      -> stage-d-closure-receipt-v1
      -> ScoreAnchorV4

Child bundle не ссылается назад на traversal result, accepted attempt,
EvidenceBundleV2, fact или anchor. Missing, wrong, dangling, unreferenced,
cycle или conflicting binding блокирует analytical finalization; retry и
terminal FAILED_TECHNICAL определяются §8.3. EvidenceBundleV1 не ослабляется.

## 9. CanonicalFactV2 и exact-risk adapter

CanonicalFactV1 semantic ID не включает полный payload/evidence и может
схлопнуть разные proofs. Stage D использует CanonicalFactV2.

### 9.1 Canonical schema и semantic ID

CanonicalFactV2 имеет origin legacy_v1_projection или stage_d_exact и хранит:

- semanticId и profile event/state/path;
- factType, subject, subject/object roles;
- lane, strength, directness и timing;
- authorityDomain из закрытого registry matrix-v5;
- profileIdentity;
- riskOccurrenceId;
- relationBinding и relationBindingSha256;
- canonicalPayload и payloadSha256;
- sorted unique evidenceRefs и sourceDomains;
- variant-specific legacyBinding либо stageDBinding.

legacyBinding содержит original canonical-fact-inventory-v1 hash, V1 fact
hash и accepted output hashes его sourceBranches. stageDBinding содержит
accepted traversal attempt/result hashes, stage-d-child-evidence-bundle hash,
adverse-check hash и terminal action-receipt hash. Каждый evidenceRef является
content SHA-256; sourceDomains ограничены fast, where, deep, traversal и
sidecar.

Policy adapter, а не provider payload, назначает factType, lane, strength,
directness, timing и authorityDomain. Для каждого factType matrix-v5 registry
задаёт строгий parser canonicalPayload: allowed keys, types, typed absence и
порядок semantic arrays. Unknown keys, undefined, non-finite number,
неcanonical address/hash/timestamp и hash mismatch отклоняются.

profileIdentity является строгим discriminated union:

- legacy_v1_projection: canonicalFactV1 id; hash полных V1 bytes хранится в
  legacyBinding и не меняет semantics из-за другого набора sourceBranches;
- event: chain, token typed absence, tx hash, receipt log index и exact event
  ID;
- state: chain, object typed absence, effectiveAt и snapshot block/hash;
- path: chain и ordered exact event IDs.

relationBinding различает direct subject event и exact_bound_path с ordered
event IDs, continuation addresses и action receipt hash. Cashflow binding в
первой D2-v1 отсутствует.

semanticId вычисляется только так:

    fingerprintCanonicalArtifact([
      "canonical-fact-key-v2",
      origin,
      profile,
      profileIdentity,
      riskOccurrenceId,
      factType,
      subject,
      counterpartyOrObject,
      subjectRole,
      objectRole,
      lane,
      strength,
      directness,
      timing,
      authorityDomain,
      relationBindingSha256,
      payloadSha256
    ])

canonicalPayload обязан дать payloadSha256 до вычисления ID. Evidence refs и
source domains не входят в semanticId: они входят в полный artifact hash и
могут дополнять одно и то же доказанное утверждение.

### 9.2 Merge и conflict

Proofs compatible только если canonical bytes всего semantic envelope из
формулы выше и canonicalPayload byte-identical. Тогда evidenceRefs и
sourceDomains объединяются как sorted unique sets.

Если объявленный semanticId не пересчитывается, один semanticId имеет разные
semantic bytes/payload, либо один occurrence binding даёт две неразрешённые
registry projections, finalization падает. Никакого winner-by-priority нет.
Byte-identical Deep/traversal/sidecar proofs объединяются и не создают второй
candidate.

### 9.3 Детерминированный V1 -> V2 parity adapter

Каждый существующий CanonicalFactV1 сначала проходит неизменённые
canonicalizeEvidenceFacts и matrix-v4 validation. Adapter создаёт
origin=legacy_v1_projection со следующими bindings:

- legacyCanonicalFactId и hash полных canonical V1 bytes;
- V1 profile, factType, subject, role, lane, strength, directness, timing и
  canonical payload без reinterpretation;
- counterpartyOrObject = typed_absent(not_retained_by_v1),
  objectRole = typed_absent(not_retained_by_v1),
  authorityDomain = legacy_v4_projection;
- relationBinding = legacy_v1_relation с canonicalFactV1 id, directness и
  timing;
- accepted branch output hashes, соответствующие V1 sourceBranches;
- analysis manifest и исходный canonical-fact-inventory-v1 hash.

Эти значения задаёт locked legacy-v4-parity-projection-v1 registry для каждого
score-significant v4 tuple; implementation не выбирает их по payload. Legacy
projection не получает stage_d_exact authorityDomain. Missing accepted branch
binding является technical failure. Mapping receipt фиксирует registry hash,
равные input/output counts, ordered пары V1 id -> V2 semanticId и отсутствие
unmapped/duplicate entries.

Для occurrence reconciliation adapter пытается восстановить profile-specific
CanonicalFactInput только из hash-bound accepted branch output/raw evidence и
обязан пересчитать тот же canonicalFactV1 id. Единственный exact reconstruction
даёт exact riskOccurrenceId; отсутствие или несколько reconstructions дают
typed legacy_opaque occurrence. До D2 registry обязан доказать exact
reconstruction для каждого v4 direct/event fact type, который может
пересечься с новым Stage D exact domain. Runtime overlap exact fact с
legacy_opaque того же subject/risk kind является technical conflict, а не
двумя candidates.

Generator matrix-v5 обязан иметь явную parity projection для каждого
score-significant v4 tuple. На Golden, текущем 24 + 6 corpus и canary без новых
Stage D facts выбранная v5 row обязана ссылаться на тот же legacyV4RowId и
иметь тот же semantic tuple, numeric score и decision, что v4. Исторические
runs не конвертируются и не пересчитываются.

### 9.4 Cross-origin occurrence reconciliation

riskOccurrenceId вычисляется закрытым risk-kind registry из subject,
semantic risk kind и exact event/state/path identity; origin и evidence refs в
него не входят. После V1 projection и Stage D adaptation создаётся
canonical-fact-reconciliation-v1:

- один fact в occurrence group становится primary;
- byte-compatible facts одного origin уже объединены по §9.2;
- legacy_v1_projection + stage_d_exact могут быть одной group только когда
  registry подтверждает одинаковые factType/roles/directness/timing и exact
  occurrence binding;
- в такой group Stage D exact становится primary, legacy projection остаётся
  supporting provenance и не является вторым scoring candidate;
- неподтверждённый overlap, два incompatible exact facts или две primary
  projections дают technical conflict.

Receipt связывает ordered primary semantic IDs, supporting/superseded mapping,
riskOccurrenceIds, V1 mapping registry и Stage D registry hashes. Matrix-v5
читает только primary IDs; max-row semantics остаётся дополнительной защитой,
а не заменой dedupe. EvidenceBundleV2 и ScoreAnchorV4 обязаны связать этот
receipt.

### 9.5 Exact-risk adapter

Stage D exact-risk adapter создаёт candidate fact только при:

- accepted traversal attempt/result reachability до его
  stage-d-child-evidence-bundle-v1;
- exact adverse authority с frozen terminal disposition: прямой terminal
  endpoint либо завершённый exact-bound sidecar;
- event-time validity;
- successful finality;
- selector/log/movement binding;
- exact subject relation через direct или exact-bound traversal path с known
  intermediate event IDs.

Candidate становится score-authoritative только если reconciliation пометил
его primary и его inventory hash вместе со всей accepted traversal chain
включён в прошедший валидацию EvidenceBundleV2.

Не создают fact:

- service classifier status или boundary action;
- coverage/incomplete/unresolved;
- later/current-only label без event-time validity;
- method-only Verify20;
- provider marker без event binding;
- unfinished lead;
- standalone или repeat cashflow relevance без accepted Stage D authority;
- unrelated red event из широкой service sample.

## 10. Matrix-v5, ScoreAnchorV4 и report-v2

Matrix-v5 сохраняет max-row semantics. Facts не складываются.

Новый exact fact может повысить выбранный row, но не может снизить score через
dilution. Duplicates не compound.

Числовые rows не определяются реализацией:

1. v4 копируется неизменно;
2. direct Stage D fact наследует score только при полном semantic tuple match;
3. новые indirect/path rows получают два blind review и adjudication;
4. generator выпускает locked v5 manifest;
5. Golden v4 остается неизменным.

Текущий direct active blacklist score может быть сохранён только при полном
совпадении semantic tuple. Текущие числа нельзя автоматически переносить на
indirect sanctions, drainer, Verify20 или новые path semantics.

ScoreAnchorV4 связывает:

- matrix-v5 locked manifest;
- CanonicalFactV2 inventory;
- V1->V2 mapping и canonical-fact-reconciliation-v1 receipts;
- accepted EvidenceBundleV2;
- accepted stage-d-closure-receipt-v1;
- primary facts;
- score/decision;
- policy pair.

report-v2 отдельно показывает:

- intermediate boundary role и, только при отдельном accepted report-context
  binding, checked-subject role;
- exact adverse fact;
- score effect;
- policy limitation, что cashflow/current-exposure relevance в D2-v1 не
  оценивалась; standalone Stage C shadow в production report не читается;
- limitations и unresolved coverage.

RU/EN presentation tests обязаны не смешивать inferred service role и AML
risk.

## 11. Delivery roadmap

Работа выполняется последовательными зелёными commits в master из чистого
worktree. Dirty historical checkout не используется.

Это umbrella design, а не один монолитный delivery. C0-C6 и D0-D3 являются
отдельными gated slices. C0-C6 становятся executable только через отдельный
утверждённый implementation plan. D0-D3 в этом документе являются
non-executable future outline: Stage C acceptance, отдельное human approval и
собственный implementation plan обязательны до начала D0; numeric matrix-v5
rows дополнительно требуют отдельного approval после blind adjudication.

Dependencies являются DAG, а не глобальным stop-the-world:

    C1 -----------------------------+
    C0a -> C2 -> C3 -> C4 ----------+-> C6
    C0b -> C5 -----------------------+
    C6 + human Stage D approval -> D0 -> D1 -> D2 -> D3

Blocker останавливает зависимые slices, но не запрещает независимый C1.

### C0. Authority feasibility

Минимально добавить provider request identity v2 и два bounded feasibility
receipts без classifier output:

- C0a physical-population: доказать source authority, необходимую каждой
  blind stratum, как минимум в количестве её quota: complete
  physical/order/role/EOA для intermediate, exact subject/contract witnesses
  для controls, доказуемый typed gap для incomplete controls и каждый класс
  adverse authority; это проверка universe, а не предварительный выбор blind
  cases;
- C0b cashflow: доказать authoritative transactionIndex/order и matching
  pinned independent balance хотя бы для одного real current_balance control.

Недоступный C0a блокирует C2-C4 и Stage D. Недоступный C0b блокирует C5/C6 и
будущую current-exposure policy, но не C1-C4. Каждый blocker сохраняется typed;
authority нельзя заменять inference.

### C1. Runtime accepted-history shadow

Добавить strict config, anchor/sample-bound role-map V2 wrapper, frozen
run-wide input set, coordinator group observer, precommit/post-commit
reconciliation, one run summary и byte non-interference tests. Не менять
finalizer/Admin production code и не создавать migration.

### C2. Physical pages и EOA

Добавить serviceBoundaryEvidence, capture tooling, physical profile и
EOAAtAnchor parser/validator. Пройти baseline/cache/order/short-window gates.

### C3. Adverse completeness

Добавить serviceBoundaryAdverseProbe и aggregate receipt поверх существующих
exact authority modules. Доказать fail-closed outcomes и preservation.

### C4. Blind 24 + 6 и legacy preservation

Добавить tools/stage-c-blind workflow, canonical legacy workbook export,
neutral packs, two reviews, adjudication, comparator и acceptance receipt.

### C5. Cashflow authority и shadow

Добавить production-owned tape-or-unavailable adapter, current_balance
selector, runtime receipt и real complete/unresolved controls.

### C6. Stage C closure

Собрать единый receipt: runtime shadow, physical/EOA, adverse, blind,
cashflow, non-interference, tests и human acceptance. C0-C6 не добавляет
checked-subject classifier; любая отдельно доказанная subject role остаётся
только report context и не влияет на boundary, candidates или score.

### D0. Evidence transport

После отдельного Stage D approval добавить contracts/replays, которые normal
production policy ещё не может выбрать: probe/task/sidecar/child bundle,
parity/reconciliation и lifecycle. Никакого production scoring до frozen v5.

### D1. Scoring adjudication

После отдельного approval провести blind scoring review и предложить locked
matrix-v5 manifest. Этот design не утверждает его numeric rows.

### D2. Atomic policy bundle

Одновременно подключить AnalysisManifestV2, snapshot-closure-v3,
stage-d-child-evidence-bundle-v1, CanonicalFactV2 с V1 parity adapter,
canonical-fact-reconciliation-v1, EvidenceBundleV2,
stage-d-closure-receipt-v1, matrix-v5, ScoreAnchorV4 и report-v2.

### D3. Canary и activation

Сначала isolated canary без delivery. Проверить exact positive,
unrelated-red, missing binding, unresolved, tampered evidence, restart,
historical v4 parity, score monotonicity и pre-frozen p95 latency budget.
Production activation является отдельным human decision.

## 12. Обязательные verification receipts

До Stage C acceptance:

- config parser tests;
- provider request v1 byte compatibility и v2 collision tests;
- provider v2 cache reuse между разными route-anchor probes с identical HTTP
  request bytes;
- V1 role-map runtime rejection, V2 anchor/sample collision и exact coverage;
- ровно один frozen run-wide map load на run/restart, без per-state scan;
- coordinator group/order/restart/timeout tests;
- precommit orphan, failed checkpoint, claim loss и post-commit reconciliation;
- runtime PostgreSQL enabled/disabled comparison;
- отдельный disposable-PostgreSQL test receipt с exact command, schema
  version, executed file/test counts > 0 и skipped count = 0; общий npm test с
  заранее skipped PostgreSQL files этот gate не закрывает;
- storage and finalizer unreferenced-artifact isolation;
- Admin DAG regression;
- physical window/page/cache tests;
- EOAAtAnchor positive/current-only/contract/unresolved controls;
- adverse applicability matrix tests;
- authorityClass/disposition registry, five-trigger overflow и aggregate
  precedence combination tests;
- legacy 24/24 + 6/6 gate;
- new blind sampling-frame/seed/strata/global-collision, safety и net-utility
  gates;
- cashflow 7/7 plus real complete/unresolved controls;
- typecheck, full suite и diff-check.

До Stage D activation:

- v1/v2 historical byte parity;
- planner restart и barrier rolling-hash tests;
- Stage D reachability/tamper/conflict tests;
- exact terminal no-history-open test;
- exact-bound-only continuation test;
- no duplicate ordinary path;
- lifecycle pending/retry/typed-unresolved/FAILED_TECHNICAL tests;
- CanonicalFactV2 merge/conflict/dedupe tests;
- complete V1 -> V2 mapping receipt и selected-row parity;
- cross-origin occurrence reconciliation и opaque-overlap conflict;
- matrix-v5 no-Stage-D parity;
- one primary scoring candidate per riskOccurrenceId;
- score non-decrease;
- cashflow shadow не входит в bundle, score или production report D2-v1;
- ScoreAnchorV4 recomputation;
- RU/EN report and Telegram separation;
- isolated canary with zero delivery.

## 13. Documentation

Каждая behavior-changing delivery обновляет relevant knowledge page в том же
commit:

- 02-check-modes;
- 03-job-lifecycle;
- 04-data-sources-tronscan-indexing;
- 05-where-is-money-and-incoming;
- 06-deepcheck;
- 07-risk-scoring-matrix;
- 08-admin-and-bot-ux;
- 09-current-decisions;
- 10-open-problems;
- 14-current-roadmap.

Design artifacts, blind locks и receipts хранятся в docs/audit. Raw secrets,
API keys и reviewer-identifying private metadata не коммитятся.

## 14. Completion definition

Stage C завершён только после C0-C6, полного receipt и human acceptance.

Stage D считается реализованным только после atomic v3/v5 chain, immutable
score anchor, report-v2 и isolated canary receipt. Реализация ещё не означает
production activation.

До этих gates current production остаётся:

- Stage C disabled/offline;
- cashflow offline;
- snapshot-closure-v1/v2;
- scoring-signal-matrix-v4;
- ScoreAnchorV3;
- старый report/delivery contract.

Этот документ не разрешает Stage C или Stage D rollout, historical
recalculation, subject-role suppression, 500 + 100 expansion, новый
opening-balance algorithm или изменение legacy check modes.
