# Bot Runtime Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two trust-breaking Telegram bot issues in one track: TronScan `429` bursts despite multi-key support, and smart contract addresses being reported as normal low-risk wallets.

**Architecture:** First harden the shared TronScan runtime path with global and endpoint pacing, safe diagnostics, and staggered worker startup. Then add a standalone smart-contract check path before the normal wallet `/check`, using metadata, contract intelligence, watched-wallet approval relations, service classification, and optional LLM verdicts.

**Tech Stack:** TypeScript, Node.js timers, existing `TronscanScheduler`, existing `TronscanClient`, existing PostgreSQL repositories, existing `ContractIntelligenceProfile`, existing contract LLM verdict analyzer, Vitest.

---

## Spec

Primary spec: `docs/superpowers/specs/2026-06-01-bot-runtime-hardening-design.md`

## Task Order

1. Config for global/endpoint limits and startup delays.
2. Scheduler global + endpoint pacing.
3. Client bucket classification and safe logs.
4. Runtime wiring and staggered startup.
5. Repository query for smart-contract approval relations.
6. Smart contract check module.
7. Standalone contract LLM case file.
8. Bot routing and smart-contract message.
9. Runtime wiring for smart-contract checker.
10. Full verification.

---

### Task 1: Config for Limits and Startup Delays

**Files:**
- Modify: `src/config.ts`
- Modify: `.env.example`
- Modify: `tests/config/config.test.ts`

- [ ] **Step 1: Extend `AppConfig`**

Add fields:

```ts
tronscanGlobalRequestMinIntervalMs: number;
tronscanTransferRequestMinIntervalMs: number;
tronscanApprovalRequestMinIntervalMs: number;
tronscanContractRequestMinIntervalMs: number;
tronscanFullNodeRequestMinIntervalMs: number;
tronGridRequestMinIntervalMs: number;
pollStartDelayMs: number;
forensicWhereStartDelayMs: number;
forensicIncomingStartDelayMs: number;
forensicDeepStartDelayMs: number;
```

- [ ] **Step 2: Parse defaults**

In `loadConfig`, add:

```ts
tronscanGlobalRequestMinIntervalMs: parsePositiveInteger("TRONSCAN_GLOBAL_REQUEST_MIN_INTERVAL_MS", process.env.TRONSCAN_GLOBAL_REQUEST_MIN_INTERVAL_MS ?? "280", 0),
tronscanTransferRequestMinIntervalMs: parsePositiveInteger("TRONSCAN_TRANSFER_REQUEST_MIN_INTERVAL_MS", process.env.TRONSCAN_TRANSFER_REQUEST_MIN_INTERVAL_MS ?? "350", 0),
tronscanApprovalRequestMinIntervalMs: parsePositiveInteger("TRONSCAN_APPROVAL_REQUEST_MIN_INTERVAL_MS", process.env.TRONSCAN_APPROVAL_REQUEST_MIN_INTERVAL_MS ?? "300", 0),
tronscanContractRequestMinIntervalMs: parsePositiveInteger("TRONSCAN_CONTRACT_REQUEST_MIN_INTERVAL_MS", process.env.TRONSCAN_CONTRACT_REQUEST_MIN_INTERVAL_MS ?? "300", 0),
tronscanFullNodeRequestMinIntervalMs: parsePositiveInteger("TRONSCAN_FULLNODE_REQUEST_MIN_INTERVAL_MS", process.env.TRONSCAN_FULLNODE_REQUEST_MIN_INTERVAL_MS ?? "300", 0),
tronGridRequestMinIntervalMs: parsePositiveInteger("TRONGRID_REQUEST_MIN_INTERVAL_MS", process.env.TRONGRID_REQUEST_MIN_INTERVAL_MS ?? "250", 0),
pollStartDelayMs: parsePositiveInteger("POLL_START_DELAY_MS", process.env.POLL_START_DELAY_MS ?? "0", 0),
forensicWhereStartDelayMs: parsePositiveInteger("FORENSIC_WHERE_START_DELAY_MS", process.env.FORENSIC_WHERE_START_DELAY_MS ?? "3000", 0),
forensicIncomingStartDelayMs: parsePositiveInteger("FORENSIC_INCOMING_START_DELAY_MS", process.env.FORENSIC_INCOMING_START_DELAY_MS ?? "6000", 0),
forensicDeepStartDelayMs: parsePositiveInteger("FORENSIC_DEEP_START_DELAY_MS", process.env.FORENSIC_DEEP_START_DELAY_MS ?? "12000", 0),
```

- [ ] **Step 3: Update `.env.example`**

Add:

```text
TRONSCAN_GLOBAL_REQUEST_MIN_INTERVAL_MS=280
TRONSCAN_TRANSFER_REQUEST_MIN_INTERVAL_MS=350
TRONSCAN_APPROVAL_REQUEST_MIN_INTERVAL_MS=300
TRONSCAN_CONTRACT_REQUEST_MIN_INTERVAL_MS=300
TRONSCAN_FULLNODE_REQUEST_MIN_INTERVAL_MS=300
TRONGRID_REQUEST_MIN_INTERVAL_MS=250
POLL_START_DELAY_MS=0
FORENSIC_WHERE_START_DELAY_MS=3000
FORENSIC_INCOMING_START_DELAY_MS=6000
FORENSIC_DEEP_START_DELAY_MS=12000
```

- [ ] **Step 4: Update config tests**

Add default assertions:

```ts
expect(config.tronscanGlobalRequestMinIntervalMs).toBe(280);
expect(config.tronscanTransferRequestMinIntervalMs).toBe(350);
expect(config.tronscanApprovalRequestMinIntervalMs).toBe(300);
expect(config.tronscanContractRequestMinIntervalMs).toBe(300);
expect(config.tronscanFullNodeRequestMinIntervalMs).toBe(300);
expect(config.tronGridRequestMinIntervalMs).toBe(250);
expect(config.pollStartDelayMs).toBe(0);
expect(config.forensicWhereStartDelayMs).toBe(3000);
expect(config.forensicIncomingStartDelayMs).toBe(6000);
expect(config.forensicDeepStartDelayMs).toBe(12000);
```

Add explicit env override assertions with values `400`, `500`, `450`, `425`, `475`, `350`, `1000`, `2000`, `3000`, `4000`.

- [ ] **Step 5: Verify**

Run:

```bash
npm test -- --run tests/config/config.test.ts
```

Expected: config tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/config.ts .env.example tests/config/config.test.ts
git commit -m "config: add bot runtime pacing settings"
```

---

### Task 2: Scheduler Global and Endpoint Pacing

**Files:**
- Modify: `src/tron/tronscanScheduler.ts`
- Modify: `tests/tron/tronscanScheduler.test.ts`

- [ ] **Step 1: Add endpoint bucket type**

```ts
export type TronscanEndpointBucket =
  | "transfer"
  | "approval"
  | "contract"
  | "fullnode"
  | "trongrid"
  | "default";
```

Extend `TronscanScheduleInput`:

```ts
endpointBucket?: TronscanEndpointBucket;
```

Extend options:

```ts
globalRequestMinIntervalMs?: number;
endpointMinIntervalMs?: Partial<Record<TronscanEndpointBucket, number>>;
```

- [ ] **Step 2: Add global and endpoint state**

```ts
type EndpointBucketState = {
  nextRequestAtMs: number;
  cooldownUntilMs: number;
};

const endpointBuckets: TronscanEndpointBucket[] = ["transfer", "approval", "contract", "fullnode", "trongrid", "default"];
const endpointState = new Map<TronscanEndpointBucket, EndpointBucketState>(
  endpointBuckets.map((bucket) => [bucket, { nextRequestAtMs: 0, cooldownUntilMs: 0 }])
);
let globalNextRequestAtMs = 0;
let globalCooldownUntilMs = 0;
```

- [ ] **Step 3: Include slot, global, and endpoint readiness**

Readiness should be:

```ts
Math.max(
  slot.nextRequestAtMs,
  honorsGlobalCooldown(item) ? slot.cooldownUntilMs : 0,
  globalNextRequestAtMs,
  honorsGlobalCooldown(item) ? globalCooldownUntilMs : 0,
  endpointState.get(bucket)?.nextRequestAtMs ?? 0,
  endpointState.get(bucket)?.cooldownUntilMs ?? 0
)
```

- [ ] **Step 4: Update pacing clocks on dispatch**

```ts
const dispatchNow = now();
const bucket = item.input.endpointBucket ?? "default";
slot.nextRequestAtMs = dispatchNow + requestMinIntervalMs;
globalNextRequestAtMs = dispatchNow + globalRequestMinIntervalMs;
const bucketState = endpointState.get(bucket);
if (bucketState) {
  bucketState.nextRequestAtMs = dispatchNow + Math.max(0, endpointMinIntervalMs[bucket] ?? endpointMinIntervalMs.default ?? 0);
}
```

- [ ] **Step 5: Apply 429 cooldown to all three scopes**

On rate-limit error:

```ts
slot.cooldownUntilMs = Math.max(slot.cooldownUntilMs, cooldownUntilMs);
globalCooldownUntilMs = Math.max(globalCooldownUntilMs, cooldownUntilMs);
const bucketState = endpointState.get(item.input.endpointBucket ?? "default");
if (bucketState) {
  bucketState.cooldownUntilMs = Math.max(bucketState.cooldownUntilMs, cooldownUntilMs);
}
```

- [ ] **Step 6: Expand diagnostics**

Diagnostics must include:

```ts
globalCooldownUntilMs: number;
endpointCooldownUntilMs: Partial<Record<TronscanEndpointBucket, number>>;
```

- [ ] **Step 7: Add tests**

Add tests for:

- two keys still distribute work;
- global pacing delays second request even with two keys;
- repeated transfer bucket requests respect endpoint interval;
- `429` sets slot/global/endpoint cooldown diagnostics;
- diagnostics do not include raw keys.

- [ ] **Step 8: Verify**

```bash
npm test -- --run tests/tron/tronscanScheduler.test.ts
```

- [ ] **Step 9: Commit**

```bash
git add src/tron/tronscanScheduler.ts tests/tron/tronscanScheduler.test.ts
git commit -m "fix: add global TronScan scheduler pacing"
```

---

### Task 3: Client Buckets and Safe Request Logs

**Files:**
- Modify: `src/tron/tronClient.ts`
- Modify: `tests/tron/tronClient.test.ts`

- [ ] **Step 1: Add request bucket classifier**

```ts
private endpointBucketForRequest(requestName: string): TronscanEndpointBucket {
  if (requestName === "transfer" || requestName === "transaction_history") return "transfer";
  if (requestName === "approval_list" || requestName === "approval_change") return "approval";
  if (requestName === "trongrid_transfer_history") return "trongrid";
  if (requestName === "transaction" || requestName === "raw_transaction" || requestName === "stablecoin_contract_state" || requestName === "stablecoin_blacklist_event") return "fullnode";
  if (requestName === "contract_list" || requestName === "contract_detail" || requestName === "contract_top_call" || requestName === "contract_search" || requestName === "contract_events" || requestName.startsWith("contract")) return "contract";
  return "default";
}
```

- [ ] **Step 2: Pass bucket to scheduler**

In `fetchJsonOnce`, compute `endpointBucket` and pass it to `this.scheduler.schedule`.

- [ ] **Step 3: Log safe diagnostics**

Add to `tronscan_request_attempt`:

```ts
api_key_index: context.apiKeyIndex,
endpoint_bucket: endpointBucket
```

Never log `context.apiKey`.

- [ ] **Step 4: Remove legacy client limiter state but keep 429 visibility**

Remove unused client-level limiter fields/methods after scheduler owns cooldown:

```ts
requestQueue
nextRequestAtMs
rateLimitCooldownUntilMs
waitForRequestSlot
startRateLimitCooldown
```

Keep a non-state logging helper so existing observability does not disappear:

```ts
private logRateLimitResponse(input: {
  url: URL;
  requestName: string;
  endpointBucket: TronscanEndpointBucket;
  apiKeyIndex: number | null;
}): void {
  this.logger.warn("tronscan_rate_limit_cooldown", {
    request_name: input.requestName,
    path: input.url.pathname,
    endpoint_bucket: input.endpointBucket,
    api_key_index: input.apiKeyIndex,
    cooldown_ms: this.rateLimitCooldownMs
  });
}
```

On response status `429`, call this helper. The helper logs only; it must not mutate cooldown state. Scheduler owns cooldown state.

- [ ] **Step 5: Add client tests**

Cover:

- request logs include `api_key_index`;
- request logs include `endpoint_bucket`;
- raw API keys are absent from log JSON;
- existing retry test still shows headers `["key-a", "key-b"]` after a 429;
- existing `tronscan_rate_limit_cooldown` observability still exists and includes `endpoint_bucket` / `api_key_index`.

- [ ] **Step 6: Verify**

```bash
npm test -- --run tests/tron/tronClient.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add src/tron/tronClient.ts tests/tron/tronClient.test.ts
git commit -m "chore: classify TronScan request buckets"
```

---

### Task 4: Runtime Wiring and Staggered Startup

**Files:**
- Create: `src/runtime/startupSchedule.ts`
- Create: `tests/runtime/startupSchedule.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Wire scheduler options in `src/index.ts`**

```ts
const tronscanScheduler = createTronscanScheduler({
  requestMinIntervalMs: config.tronscanRequestMinIntervalMs,
  globalRequestMinIntervalMs: config.tronscanGlobalRequestMinIntervalMs,
  rateLimitCooldownMs: config.tronscanRateLimitCooldownMs,
  endpointMinIntervalMs: {
    transfer: config.tronscanTransferRequestMinIntervalMs,
    approval: config.tronscanApprovalRequestMinIntervalMs,
    contract: config.tronscanContractRequestMinIntervalMs,
    fullnode: config.tronscanFullNodeRequestMinIntervalMs,
    trongrid: config.tronGridRequestMinIntervalMs
  },
  apiKeys: config.tronscanApiKeys
});
```

- [ ] **Step 2: Add startup schedule helper**

Create `src/runtime/startupSchedule.ts`:

```ts
export type StartupWorkLabel = "poll" | "where_forensic" | "incoming_deposit" | "deep_forensic";

export type StartupDelayConfig = {
  pollStartDelayMs: number;
  forensicWhereStartDelayMs: number;
  forensicIncomingStartDelayMs: number;
  forensicDeepStartDelayMs: number;
};

export type StartupWorkScheduleItem = {
  label: StartupWorkLabel;
  delayMs: number;
};

export function buildStartupWorkSchedule(config: StartupDelayConfig): StartupWorkScheduleItem[] {
  return [
    { label: "poll", delayMs: config.pollStartDelayMs },
    { label: "where_forensic", delayMs: config.forensicWhereStartDelayMs },
    { label: "incoming_deposit", delayMs: config.forensicIncomingStartDelayMs },
    { label: "deep_forensic", delayMs: config.forensicDeepStartDelayMs }
  ];
}
```

- [ ] **Step 3: Replace immediate intervals with delayed repeating workers**

Do not keep the existing `setInterval` calls active from process start. `FORENSIC_WHERE_POLL_INTERVAL_MS` is `2000`, so an immediate interval would fire before `FORENSIC_WHERE_START_DELAY_MS=3000` and defeat startup staggering.

Replace the current immediate `setInterval(...)` declarations and immediate startup calls with delayed repeating workers:

```ts
const startupWork: Record<StartupWorkLabel, () => Promise<void>> = {
  poll: pollOnce,
  where_forensic: whereForensicOnce,
  incoming_deposit: incomingDepositOnce,
  deep_forensic: deepForensicOnce
};

const startupIntervals: NodeJS.Timeout[] = [];

const intervalByLabel: Record<StartupWorkLabel, number> = {
  poll: config.pollIntervalMs,
  where_forensic: config.forensicWherePollIntervalMs,
  incoming_deposit: config.forensicWherePollIntervalMs,
  deep_forensic: config.forensicDeepPollIntervalMs
};

const startupTimers = buildStartupWorkSchedule(config).map((item) => setTimeout(() => {
  const run = () => {
    startupWork[item.label]().catch((error) => {
      logger.error(`${item.label}_cycle_failed`, { error: error instanceof Error ? error.message : String(error) });
    });
  };
  run();
  startupIntervals.push(setInterval(run, intervalByLabel[item.label]));
}, item.delayMs));
```

During shutdown, clear both:

```ts
for (const timer of startupTimers) clearTimeout(timer);
for (const interval of startupIntervals) clearInterval(interval);
```

- [ ] **Step 4: Add startup schedule test**

Test that default config produces `0`, `3000`, `6000`, `12000` delays in order. Also add an index-level or helper-level test that where/incoming do not run before their configured start delays.

- [ ] **Step 5: Verify**

```bash
npm test -- --run tests/runtime/startupSchedule.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/index.ts src/runtime/startupSchedule.ts tests/runtime/startupSchedule.test.ts
git commit -m "fix: stagger bot worker startup"
```

---

### Task 5: Approval-Spender Repository Query

**Files:**
- Modify: `src/storage/repositories.ts`
- Modify: `tests/storage/repositories.test.ts`

- [ ] **Step 1: Add relation type**

```ts
export type WalletApprovalSpenderRelation = WalletApproval & {
  watchedWalletAddress: string;
  watchedWalletTelegramUserId: string;
};
```

- [ ] **Step 2: Add query**

Create:

```ts
export async function listWalletApprovalsBySpenderForTelegramUser(
  db: Db,
  input: { telegramUserId: string; spenderAddress: string }
): Promise<WalletApprovalSpenderRelation[]>
```

The SQL should join `wallet_approvals wa` with `watched_wallets w`, filter:

```sql
where w.telegram_user_id = $1 and wa.spender_address = $2
```

and reuse `mapWalletApprovalRow(row)` for the base fields.

- [ ] **Step 3: Add repository test**

Assert:

```ts
expect(queries[0].sql).toContain("join watched_wallets w");
expect(queries[0].sql).toContain("wa.spender_address = $2");
expect(relations[0]).toMatchObject({
  watchedWalletAddress: "TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe",
  spenderAddress: "TNKG4Mji5CjwaEZ8QXk5B4PaDDtax5pxQ5",
  isUnlimited: true,
  status: "active"
});
```

- [ ] **Step 4: Verify**

```bash
npm test -- --run tests/storage/repositories.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/storage/repositories.ts tests/storage/repositories.test.ts
git commit -m "data: list approval spenders for contract checks"
```

---

### Task 6: Smart Contract Check Module

**Files:**
- Create: `src/check/smartContractCheck.ts`
- Create: `tests/check/smartContractCheck.test.ts`

- [ ] **Step 1: Define report type**

Create `SmartContractCheckReport` with:

```ts
subjectAddress: string;
decision: ExchangeDecision;
decisionScope: "contract_safety" | "approval_safety";
riskScore: number;
riskLevel: RiskLevel;
metadata: AddressMetadata;
contractProfile: ContractIntelligenceProfile | null;
relatedApprovals: WalletApprovalSpenderRelation[];
llmVerdict: ContractLlmVerdictSummary | null;
exactDrainProven: boolean;
serviceLabel: string | null;
activityLabel: "none" | "low" | "normal" | "high" | "unknown";
reasons: string[];
limitations: string[];
```

- [ ] **Step 2: Implement deterministic scoring**

Rules:

- known verified service: `ACCEPTABLE`, `10`;
- unknown weak metadata: at least `35`;
- active unlimited approval relation: `DECLINE`, at least `45`, `decisionScope="approval_safety"`;
- transferFrom surface plus active unlimited approval: at least `65`;
- LLM `legitimate_service >= 0.8` with service evidence can reduce risk;
- LLM `unknown_suspicious >= 0.75` can raise to `45-55`;
- LLM `drainer_like >= 0.85` can raise to `65-75`, but still not exact drain;
- always include `exact_drain_not_proven_in_standalone_check` unless exact deterministic evidence is added later.

- [ ] **Step 3: Add tests**

Cover:

- `TNKG`-style unverified active unlimited approval spender -> `DECLINE`, `45`, no exact drain;
- known verified bridge/service contract with no risky approval relation -> `ACCEPTABLE`, `10`;
- LLM `drainer_like` without exact transferFrom proof -> high suspicion, not exact drain.

- [ ] **Step 4: Verify**

```bash
npm test -- --run tests/check/smartContractCheck.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/check/smartContractCheck.ts tests/check/smartContractCheck.test.ts
git commit -m "feat: add standalone smart contract check"
```

---

### Task 7: Standalone Contract LLM Case File

**Files:**
- Modify: `src/types.ts`
- Modify: `src/forensics/contractLlmVerdict.ts`
- Modify: `src/check/smartContractCheck.ts`
- Modify: `tests/forensics/contractLlmVerdict.test.ts`
- Modify: `tests/check/smartContractCheck.test.ts`

- [ ] **Step 1: Add standalone context types**

In `src/types.ts`, add:

```ts
export type StandaloneContractApprovalContext = {
  ownerAddress: string;
  watchedWalletAddress: string;
  tokenContract: string;
  status: "active" | "revoked" | "unknown";
  isUnlimited: boolean;
  riskScore: number;
  lastApprovalTxHash: string | null;
  lastApprovalAt: string | null;
};

export type StandaloneContractContext = {
  mode: "standalone_contract_check";
  metadata: Record<string, unknown>;
  relatedApprovals: StandaloneContractApprovalContext[];
  knownLimitations: string[];
};
```

Add optional field to `ContractAnalysisCaseFile`:

```ts
standaloneContractContext?: StandaloneContractContext;
```

- [ ] **Step 2: Build standalone case file**

In `src/check/smartContractCheck.ts`, add `buildStandaloneContractAnalysisCaseFile(input)` returning a `ContractAnalysisCaseFile` with:

```ts
policyVersion: "2026-06-01-standalone-contract-check-v1";
balanceFormingTransfers: [];
originPaths: [];
senderInteractionProfiles: [];
approvalDrainProvenanceProfiles: [];
approvalDrainReviewFindings: [];
approvalDrainReviewInterpretations: [];
policyQuestion: "Classify this standalone smart contract for approval safety. Do not claim exact drain unless provided facts prove approve -> transferFrom -> funds movement.";
standaloneContractContext: { mode: "standalone_contract_check", metadata, relatedApprovals, knownLimitations };
```

- [ ] **Step 3: Include standalone context in hashes**

Update `hashContractFlowContextForLlm` so changing `standaloneContractContext.relatedApprovals` changes the flow hash.

- [ ] **Step 4: Add tests**

Add a test where the same contract case with and without active approval produces different `hashContractFlowContextForLlm` values.

- [ ] **Step 5: Add async checker**

Add:

```ts
export async function checkSmartContractAddress(input: {
  address: string;
  metadata: AddressMetadata;
  contractProfile: ContractIntelligenceProfile | null;
  serviceClassification: ContractAnalysisCaseFile["serviceClassification"];
  relatedApprovals: WalletApprovalSpenderRelation[];
  analyzeContractLlmCaseFiles?: (caseFiles: ContractAnalysisCaseFile[]) => Promise<ContractLlmVerdictSummary[]>;
}): Promise<SmartContractCheckReport>
```

Call LLM when contract is unknown, unverified, weak metadata, or has active unlimited approval relation.

- [ ] **Step 6: Verify**

```bash
npm test -- --run tests/forensics/contractLlmVerdict.test.ts tests/check/smartContractCheck.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/forensics/contractLlmVerdict.ts src/check/smartContractCheck.ts tests/forensics/contractLlmVerdict.test.ts tests/check/smartContractCheck.test.ts
git commit -m "feat: add standalone contract LLM case files"
```

---

### Task 8: Bot Smart-Contract Routing and Copy

**Files:**
- Modify: `src/bot/createBot.ts`
- Modify: `tests/bot/createBot.test.ts`

- [ ] **Step 1: Add `CreateBotOptions.checkSmartContractAddress`**

```ts
checkSmartContractAddress?: (input: {
  address: string;
  telegramUserId: string | null;
  locale: BotLocale;
}) => Promise<SmartContractCheckReport | null>;
```

- [ ] **Step 2: Add formatter**

Add `formatSmartContractCheckReport(report, options)` with title:

- EN: `Smart contract check`
- RU: `Проверка смарт-контракта`

Include:

- `Decision`;
- `Contract risk`;
- contract address;
- name;
- verified source;
- service label;
- activity;
- meaning;
- seen in approvals;
- AI contract verdict.

Use explicit reason mapping:

```ts
address_is_smart_contract -> "Это смарт-контракт, не обычный кошелёк."
exact_drain_not_proven_in_standalone_check -> "Точная кража в этой отдельной проверке не доказана."
active_unlimited_usdt_approval_spender -> "В ваших кошельках есть активный unlimited USDT approval на этот контракт."
```

- [ ] **Step 3: Route before normal wallet check**

Inside `replyWithCheck`, before `checkAddress`:

```ts
const contractReport = await options.checkSmartContractAddress?.({
  address: classified.value,
  telegramUserId: options.telegramUserId ?? null,
  locale
}).catch(() => null);

if (contractReport) {
  await sendMessage(ctx, formatSmartContractCheckReport(contractReport, {
    runtimeLabel: options.runtimeLabel,
    locale
  }));
  return;
}
```

- [ ] **Step 4: Add bot tests**

Cover:

- contract address route sends `Smart contract check`;
- where/deep queues are not called for contract address;
- normal EOA still queues where/deep;
- Russian formatter contains `Проверка смарт-контракта`.

- [ ] **Step 5: Verify**

```bash
npm test -- --run tests/bot/createBot.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/bot/createBot.ts tests/bot/createBot.test.ts
git commit -m "feat: route smart contract address checks"
```

---

### Task 9: Runtime Wiring for Smart Contract Checker

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Import dependencies**

```ts
import { checkSmartContractAddress as runSmartContractAddressCheck } from "./check/smartContractCheck";
import { classifyServiceAddress } from "./forensics/serviceClassifier";
import { listWalletApprovalsBySpenderForTelegramUser } from "./storage/repositories";
```

- [ ] **Step 2: Move LLM analyzer construction before bot construction**

`src/index.ts` currently constructs `bot` before `contractLlmVerdictAnalyzer`. The smart-contract checker needs the analyzer, so reorder initialization:

```ts
const contractLlmVerdictAnalyzer = config.llmContractAnalysisEnabled && config.llmApiKey
  ? createContractLlmVerdictAnalyzer({ /* existing analyzer config */ })
  : undefined;

const bot = createBot(config, db, tronClient, {
  checkSmartContractAddress: async ({ address, telegramUserId }) => {
    /* Step 3 */
  }
});
```

Keep all existing analyzer options unchanged. Only move the declaration above `createBot`.

- [ ] **Step 3: Pass checker to `createBot`**

Wire:

```ts
checkSmartContractAddress: async ({ address, telegramUserId }) => {
  const metadata = await getCachedOrLiveAddressMetadata(address);
  if (metadata?.isContract !== true) return null;
  const contractProfile = await getCachedOrLiveContractIntelligenceProfile(address).catch(() => null);
  const relatedApprovals = telegramUserId
    ? await listWalletApprovalsBySpenderForTelegramUser(db, { telegramUserId, spenderAddress: address })
    : [];
  const serviceClassification = classifyServiceAddress({ address, metadata, contractProfile });
  return runSmartContractAddressCheck({
    address,
    metadata,
    contractProfile,
    serviceClassification,
    relatedApprovals,
    analyzeContractLlmCaseFiles: contractLlmVerdictAnalyzer
  });
}
```

- [ ] **Step 4: Verify**

```bash
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "wire smart contract checker"
```

---

### Task 10: Final Verification

**Files:**
- No source files unless verification finds a bug.

- [ ] **Step 1: Focused tests**

```bash
npm test -- --run tests/config/config.test.ts tests/tron/tronscanScheduler.test.ts tests/tron/tronClient.test.ts tests/runtime/startupSchedule.test.ts tests/storage/repositories.test.ts tests/check/smartContractCheck.test.ts tests/forensics/contractLlmVerdict.test.ts tests/bot/createBot.test.ts
```

- [ ] **Step 2: Full tests**

```bash
npm test
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Restart bot and inspect logs**

```powershell
$targets = Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object { $_.CommandLine -like '*smartcontract*' -or $_.CommandLine -like '*npm-cli.js*run dev*' }
foreach ($p in $targets) { Stop-Process -Id $p.ProcessId -Force }
$logDir = Join-Path (Get-Location) 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$out = Join-Path $logDir 'bot.out.log'
$err = Join-Path $logDir 'bot.err.log'
Start-Process -FilePath 'npm.cmd' -ArgumentList @('run','dev') -WorkingDirectory (Get-Location) -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err
Start-Sleep -Seconds 20
```

Check:

```powershell
Get-Content logs\bot.out.log -Tail 200 | Select-String "tronscan_scheduler_configured|tronscan_request_attempt|bot_started"
Get-Content logs\bot.err.log -Tail 300 | Select-String "429|tronscan_rate_limit_cooldown|trongrid_transfer_history_fallback"
```

Expected:

- request attempts include `api_key_index` and `endpoint_bucket`;
- no repeated idle-monitoring `429` bursts;
- fallback still exists but is not the normal path.

- [ ] **Step 5: Telegram smoke**

Run:

```text
/check TNKG4Mji5CjwaEZ8QXk5B4PaDDtax5pxQ5
/check TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s
/check TS3gaJPExMNr63p4pxfY9CZPbJPHjfPjgf
```

Expected:

- `TNKG...` shows smart contract check, not wallet `LOW 0/100`;
- `TPwez...` can be classified as known service if metadata supports it;
- normal EOA still queues where-is-money and deep behavior context.

---

## Self-Review

- Rate-limit work and smart-contract work are separate task groups but one implementation plan.
- No duplicate spec/plan files should remain after this consolidation.
- Multi-key remains useful, but global/endpoint limiters prevent process-level bursts.
- Smart-contract `/check` no longer pretends contracts are regular wallets.
- LLM is used only after deterministic facts are collected and cannot create exact-drain proof by itself.
