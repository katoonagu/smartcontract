import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ForensicCheckJob } from "../../src/storage/repositories";
import type { IncomingDepositRiskReport, StablecoinRestrictionProfile } from "../../src/types";
import { CANONICAL_PENDING_DEEP_SECOND_LAYER_PROFILE } from "../fixtures/runtime/remediationRuntimeCases";

const START = "2026-07-15T12:00:00.000Z";
const DELIVERY_CONTRACTS_MODULE = "../../src/forensics/telegramDelivery";
const DELIVERY_WORKER_MODULE = "../../src/forensics/telegramDeliveryWorker";
const ORCHESTRATION_MODULE = "../../src/runtime/forensicRuntimeOrchestration";
const CLAIM_TOKEN_FIXTURES = [
  "opaque-claim-token-01",
  "opaque-claim-token-02",
  "opaque-claim-token-03",
  "opaque-claim-token-04",
  "opaque-claim-token-05",
  "opaque-claim-token-06",
  "opaque-claim-token-07",
  "opaque-claim-token-08"
] as const;

type JobKind = "where_is_money_check" | "address_deep_check" | "incoming_deposit_check";
const TELEGRAM_RETRYABLE_ERROR_CODES = [
  "telegram_timeout",
  "telegram_rate_limited",
  "telegram_server_error",
  "telegram_network_error",
  "telegram_unknown_retryable"
] as const;
const TELEGRAM_PERMANENT_ERROR_CODES = [
  "telegram_chat_forbidden",
  "telegram_bad_request",
  "telegram_attempts_exhausted"
] as const;
const STALE_INTENT_RETRYABLE_ERROR_CODES = [
  "stale_intent_context_unavailable",
  "stale_intent_payload_build_failed",
  "stale_intent_unknown_retryable"
] as const;
const STALE_INTENT_TERMINAL_ERROR_CODES = [
  "stale_intent_preparation_attempts_exhausted"
] as const;
const RECOVERED_INTENT_REASON_CODES = [
  "stale_running_retry_exhausted",
  "stale_running_incoming_retry_exhausted",
  "stale_running_delivery_sensitive_phase"
] as const;

type TelegramRetryableErrorCode = typeof TELEGRAM_RETRYABLE_ERROR_CODES[number];
type TelegramPermanentErrorCode = typeof TELEGRAM_PERMANENT_ERROR_CODES[number];
type DeliveryErrorCode = TelegramRetryableErrorCode | TelegramPermanentErrorCode;
type StaleIntentRetryableErrorCode = typeof STALE_INTENT_RETRYABLE_ERROR_CODES[number];
type StaleIntentTerminalErrorCode = typeof STALE_INTENT_TERMINAL_ERROR_CODES[number];
type PreparationErrorCode = StaleIntentRetryableErrorCode | StaleIntentTerminalErrorCode;
type RecoveredIntentReasonCode = typeof RECOVERED_INTENT_REASON_CODES[number];

type TelegramPayload = {
  version: "telegram-message-payload-v1";
  chatId: string;
  text: string;
  parseMode: "HTML" | null;
  replyMarkup: Record<string, unknown> | null;
};

type ForensicResult = {
  version: "forensic-result-v3";
  score: number;
  decision: "REVIEW";
  coverage: {
    version: "forensic-coverage-v2";
    scope: "transaction_seed";
    selectedTransferCount: number;
    tracedTransferCount: number;
  };
  evidence: Array<{ id: string; kind: string; txHash: string }>;
};

type DeliveryEffect = null | {
  kind: "incoming_user_alert";
  watchedWalletId: string;
  incomingTxHash: string;
};

type DeliveryClaimState = {
  token: string;
  attempt: number;
  claimedAt: string;
  leaseExpiresAt: string;
};

type DeliveryEnvelope = {
  version: "forensic-telegram-delivery-v1";
  payload: TelegramPayload;
  effect: DeliveryEffect;
  state: {
    status: "pending" | "retryable" | "sent" | "failed";
    attemptCount: number;
    lastAttemptAt: string | null;
    sentAt: string | null;
    lastError: DeliveryErrorCode | null;
    messageFingerprint: string;
  };
  claim: DeliveryClaimState | null;
};

type DeliveryClaim = {
  jobId: string;
  kind: JobKind;
  payload: TelegramPayload;
  effect: DeliveryEffect;
  messageFingerprint: string;
  claim: DeliveryClaimState;
};

type JobRow = {
  id: string;
  kind: JobKind;
  status: "running" | "completed" | "failed";
  completionVersion: number;
  resultJson: ForensicResult;
  telegramDelivery: DeliveryEnvelope | null;
};

type IncomingAlertRow = {
  watchedWalletId: string;
  incomingTxHash: string;
  status: "pending" | "sent";
  telegramMessageId: string | null;
};

type RecoveredForensicDeliveryIntentV1 = {
  version: "recovered-forensic-delivery-intent-v1";
  kind: "stale_failure";
  createdAt: string;
  reasonCode: RecoveredIntentReasonCode;
  preparationStatus: "pending" | "retryable" | "failed";
  preparationAttemptCount: number;
  lastPreparationAttemptAt: string | null;
  nextPreparationAttemptAt: string | null;
  lastPreparationError: PreparationErrorCode | null;
};

type RecoveredIntent = {
  jobId: string;
  intent: RecoveredForensicDeliveryIntentV1;
};

type RuntimeState = {
  jobs: Record<string, JobRow>;
  incomingAlerts: Record<string, IncomingAlertRow>;
  recoveredIntents: Record<string, RecoveredIntent>;
};

type DeliveryContracts = {
  fingerprintTelegramMessagePayload(payload: TelegramPayload): string;
  createPendingForensicTelegramDelivery(input: {
    jobId: string;
    kind: JobKind;
    payload: TelegramPayload;
    effect: DeliveryEffect;
  }): DeliveryEnvelope;
  classifyTelegramDeliveryError(error: unknown): {
    outcome: "retryable";
    errorCode: TelegramRetryableErrorCode;
  } | {
    outcome: "failed";
    errorCode: TelegramPermanentErrorCode;
  };
};

type DeliveryRepository = {
  listDueRecoveredForensicDeliveryIntents(
    db: unknown,
    input: { now: Date; limit: number }
  ): Promise<RecoveredIntent[]>;
  settleRecoveredForensicDeliveryIntentPreparation(
    db: unknown,
    input: {
      jobId: string;
      intentCreatedAt: string;
      expectedPreparationAttemptCount: number;
      attemptedAt: Date;
      errorCode: StaleIntentRetryableErrorCode;
    }
  ): Promise<boolean>;
  attachRecoveredForensicTelegramDelivery(
    db: unknown,
    input: {
      jobId: string;
      intentCreatedAt: string;
      expectedPreparationAttemptCount: number;
      delivery: DeliveryEnvelope;
    }
  ): Promise<boolean>;
  claimNextForensicTelegramDelivery(
    db: unknown,
    input: { now: Date }
  ): Promise<DeliveryClaim | null>;
  settleForensicTelegramDelivery(
    db: unknown,
    input: {
      jobId: string;
      messageFingerprint: string;
      attempt: number;
      claimToken: string;
      settledAt: Date;
      outcome: "sent" | "retryable" | "failed";
      errorCode?: DeliveryErrorCode | null;
      telegramMessageId?: string | null;
    }
  ): Promise<boolean>;
};

type RunSingleForensicTelegramDeliveryCycle = (input: {
  db: unknown;
  now(): Date;
  repository: DeliveryRepository;
  deliveryLimit?: number;
  recoveryLimit?: number;
  buildRecoveredTelegramDelivery?(intent: RecoveredIntent): Promise<{
    payload: TelegramPayload;
    effect: DeliveryEffect;
  }>;
  sendTelegram(
    payload: TelegramPayload,
    signal: AbortSignal
  ): Promise<{ telegramMessageId: string }>;
}) => Promise<unknown>;

type ForensicRuntimeOrchestration = {
  runForensicCycle(): Promise<void>;
  runDeliveryCycle(): Promise<void>;
};

type CreateForensicRuntimeOrchestration = (input: {
  runWhereCycle(): Promise<void>;
  runForensicTelegramDeliveryCycle(): Promise<void>;
}) => ForensicRuntimeOrchestration;

function requireFunction<T>(module: Record<string, unknown>, name: string): T {
  if (typeof module[name] !== "function") throw new Error(`Plan 3 feature missing: ${name}`);
  return module[name] as T;
}

async function loadDeliveryContracts(): Promise<DeliveryContracts> {
  const modulePath: string = DELIVERY_CONTRACTS_MODULE;
  let module: Record<string, unknown>;
  try {
    module = await import(/* @vite-ignore */ modulePath) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Plan 3 feature missing: ${DELIVERY_CONTRACTS_MODULE}`, { cause: error });
  }
  return {
    fingerprintTelegramMessagePayload: requireFunction(module, "fingerprintTelegramMessagePayload"),
    createPendingForensicTelegramDelivery: requireFunction(module, "createPendingForensicTelegramDelivery"),
    classifyTelegramDeliveryError: requireFunction(module, "classifyTelegramDeliveryError")
  };
}

async function loadDeliveryWorker(): Promise<RunSingleForensicTelegramDeliveryCycle> {
  const modulePath: string = DELIVERY_WORKER_MODULE;
  let module: Record<string, unknown>;
  try {
    module = await import(/* @vite-ignore */ modulePath) as Record<string, unknown>;
  } catch (error) {
    throw new Error("Plan 3 feature missing: runSingleForensicTelegramDeliveryCycle", { cause: error });
  }
  return requireFunction(module, "runSingleForensicTelegramDeliveryCycle");
}

function clock(start = START) {
  let current = new Date(start).getTime();
  return {
    now: () => new Date(current),
    advance: (milliseconds: number) => { current += milliseconds; }
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushTurns(count = 3): Promise<void> {
  for (let index = 0; index < count; index += 1) await Promise.resolve();
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function resultFingerprint(result: unknown): string {
  return createHash("sha256").update(canonicalJson(result)).digest("hex");
}

function resultFixture(id: string): ForensicResult {
  return {
    version: "forensic-result-v3",
    score: 61,
    decision: "REVIEW",
    coverage: {
      version: "forensic-coverage-v2",
      scope: "transaction_seed",
      selectedTransferCount: 1,
      tracedTransferCount: 1
    },
    evidence: [{ id: `evidence-${id}`, kind: "exact_transfer", txHash: `tx-${id}` }]
  };
}

function producerJob(input: {
  id: string;
  kind: JobKind;
  subjectAddress: string;
  chatId: string;
  progressJson: Record<string, unknown>;
}): ForensicCheckJob {
  return {
    id: input.id,
    kind: input.kind,
    subjectAddress: input.subjectAddress,
    status: "running",
    windowStart: new Date("2026-07-14T12:00:00.000Z"),
    windowEnd: new Date(START),
    priority: 100,
    chatId: input.chatId,
    messageId: null,
    requestedBy: input.chatId,
    progressJson: input.progressJson,
    resultJson: {},
    rawEvidenceIds: [],
    observationIds: [],
    lastError: null,
    createdAt: new Date("2026-07-14T12:00:00.000Z"),
    updatedAt: new Date("2026-07-14T12:00:00.000Z"),
    startedAt: new Date("2026-07-14T12:00:01.000Z"),
    completedAt: null
  };
}

function restrictionProfile(subjectAddress: string, balanceRaw: string | null): StablecoinRestrictionProfile {
  return {
    subjectAddress,
    tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    tokenSymbol: "USDT",
    tokenStandard: "TRC20",
    decimals: 6,
    isBlacklisted: false,
    balanceRaw,
    checkedAt: START,
    evidenceStrength: "exact_contract_state",
    blacklistEventTxHash: null,
    blacklistEventTimestamp: null,
    blacklistEventBlock: null,
    methods: { blacklist: "isBlackListed(address)", balance: "balanceOf(address)" }
  };
}

function incomingProducerReport(): IncomingDepositRiskReport {
  return {
    decision: "ACCEPTABLE",
    scoreValid: true,
    scoreBlockedReason: null,
    technicalStatus: "completed",
    depositRiskScore: 32,
    observedContextScore: 32,
    riskBand: "LOW-MEDIUM",
    fastSenderRisk: null,
    originPaths: [],
    originCoverage: 0.72,
    fundingCoverage: {
      depositFundingCoverageRatio: 0.72,
      cleanSourceCoverageRatio: 0,
      exactContinuityCoverageRatio: 0.72
    },
    corridorSummary: null,
    provenanceConfidence: 58,
    dataQuality: "medium",
    senderRole: "operational_liquidity_wallet",
    hardBadEvidence: [],
    contractVerdicts: [],
    reasons: ["sanitized producer fixture"],
    warnings: []
  };
}

function payloadFixture(jobId: string, kind: JobKind): TelegramPayload {
  return {
    version: "telegram-message-payload-v1",
    chatId: `chat-${jobId}`,
    text: `<b>${kind}</b> ${jobId}`,
    parseMode: "HTML",
    replyMarkup: null
  };
}

function jobFixture(
  contracts: DeliveryContracts,
  id: string,
  kind: JobKind = "where_is_money_check",
  status: JobRow["status"] = "completed"
): JobRow {
  const resultJson = resultFixture(id);
  return {
    id,
    kind,
    status,
    completionVersion: status === "running" ? 0 : 1,
    resultJson,
    telegramDelivery: status === "completed"
      ? contracts.createPendingForensicTelegramDelivery({
          jobId: id,
          kind,
          payload: payloadFixture(id, kind),
          effect: null
        })
      : null,
  };
}

function recoveredIntent(jobId: string): RecoveredIntent {
  return {
    jobId,
    intent: {
      version: "recovered-forensic-delivery-intent-v1",
      kind: "stale_failure",
      createdAt: START,
      reasonCode: "stale_running_retry_exhausted",
      preparationStatus: "pending",
      preparationAttemptCount: 0,
      lastPreparationAttemptAt: null,
      nextPreparationAttemptAt: null,
      lastPreparationError: null
    }
  };
}

function alertKey(watchedWalletId: string, incomingTxHash: string): string {
  return `${watchedWalletId}:${incomingTxHash}`;
}

function backoffForAttempt(attempt: number): number {
  return [30_000, 120_000, 600_000][attempt - 1] ?? 0;
}

function createRepositoryHarness(
  jobs: JobRow[],
  options: { failIncomingAlertUpdate?: boolean } = {}
) {
  let state: RuntimeState = {
    jobs: Object.fromEntries(jobs.map((job) => [job.id, structuredClone(job)])),
    incomingAlerts: {},
    recoveredIntents: {}
  };
  const events: string[] = [];
  const successfulPreparationSnapshots: Array<{
    jobId: string;
    intentPresent: boolean;
    delivery: DeliveryEnvelope | null;
  }> = [];
  let tokenCounter = 0;
  let tail = Promise.resolve();

  async function locked<T>(work: () => Promise<T> | T): Promise<T> {
    let release!: () => void;
    const previous = tail;
    tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }

  const repository: DeliveryRepository = {
    listDueRecoveredForensicDeliveryIntents: async (_db, input) => locked(() => Object.values(state.recoveredIntents)
      .filter(({ intent }) => (
        intent.preparationStatus === "pending"
        || intent.preparationStatus === "retryable"
      ) && (
        intent.nextPreparationAttemptAt === null
        || Date.parse(intent.nextPreparationAttemptAt) <= input.now.getTime()
      ))
      .slice(0, input.limit)
      .map((intent) => structuredClone(intent))),

    settleRecoveredForensicDeliveryIntentPreparation: async (_db, input) => locked(() => {
      const row = state.recoveredIntents[input.jobId];
      if (!row
        || row.intent.createdAt !== input.intentCreatedAt
        || row.intent.preparationAttemptCount !== input.expectedPreparationAttemptCount
        || !["pending", "retryable"].includes(row.intent.preparationStatus)) return false;
      const nextCount = row.intent.preparationAttemptCount + 1;
      row.intent.preparationAttemptCount = nextCount;
      row.intent.lastPreparationAttemptAt = input.attemptedAt.toISOString();
      if (nextCount >= 4) {
        row.intent.preparationStatus = "failed";
        row.intent.nextPreparationAttemptAt = null;
        row.intent.lastPreparationError = "stale_intent_preparation_attempts_exhausted";
      } else {
        row.intent.preparationStatus = "retryable";
        row.intent.nextPreparationAttemptAt = new Date(
          input.attemptedAt.getTime() + backoffForAttempt(nextCount)
        ).toISOString();
        row.intent.lastPreparationError = input.errorCode;
      }
      events.push(`prepare-failed:${input.jobId}:${nextCount}`);
      return true;
    }),

    attachRecoveredForensicTelegramDelivery: async (_db, input) => locked(() => {
      const row = state.recoveredIntents[input.jobId];
      const job = state.jobs[input.jobId];
      if (!row || !job
        || row.intent.createdAt !== input.intentCreatedAt
        || row.intent.preparationAttemptCount !== input.expectedPreparationAttemptCount
        || !["pending", "retryable"].includes(row.intent.preparationStatus)
        || job.telegramDelivery !== null) return false;
      job.telegramDelivery = structuredClone(input.delivery);
      delete state.recoveredIntents[input.jobId];
      successfulPreparationSnapshots.push({
        jobId: input.jobId,
        intentPresent: Object.hasOwn(state.recoveredIntents, input.jobId),
        delivery: structuredClone(job.telegramDelivery)
      });
      events.push(`attach:${input.jobId}`);
      return true;
    }),

    claimNextForensicTelegramDelivery: async (_db, input) => locked(() => {
      for (const job of Object.values(state.jobs)) {
        const delivery = job.telegramDelivery;
        if (!delivery || delivery.state.status === "sent" || delivery.state.status === "failed") continue;
        if (delivery.claim && Date.parse(delivery.claim.leaseExpiresAt) > input.now.getTime()) continue;
        if (!delivery.claim && delivery.state.status === "retryable") {
          const lastAttemptAt = delivery.state.lastAttemptAt === null
            ? Number.NEGATIVE_INFINITY
            : Date.parse(delivery.state.lastAttemptAt);
          if (lastAttemptAt + backoffForAttempt(delivery.state.attemptCount) > input.now.getTime()) continue;
        }
        if (delivery.claim && delivery.state.attemptCount >= 4) {
          delivery.state.status = "failed";
          delivery.state.lastError = "telegram_attempts_exhausted";
          delivery.claim = null;
          continue;
        }
        const attempt = delivery.state.attemptCount + 1;
        const token = CLAIM_TOKEN_FIXTURES[tokenCounter];
        if (!token) throw new Error("Plan 3 test fixture exhausted fixed 16-byte claim tokens");
        tokenCounter += 1;
        const claim: DeliveryClaimState = {
          token,
          attempt,
          claimedAt: input.now.toISOString(),
          leaseExpiresAt: new Date(input.now.getTime() + 40_000).toISOString()
        };
        delivery.state.status = "retryable";
        delivery.state.attemptCount = attempt;
        delivery.state.lastAttemptAt = input.now.toISOString();
        delivery.state.lastError = null;
        delivery.claim = claim;
        events.push(`claim:${job.id}:${attempt}`);
        return {
          jobId: job.id,
          kind: job.kind,
          payload: structuredClone(delivery.payload),
          effect: structuredClone(delivery.effect),
          messageFingerprint: delivery.state.messageFingerprint,
          claim: structuredClone(claim)
        };
      }
      return null;
    }),

    settleForensicTelegramDelivery: async (_db, input) => locked(() => {
      const current = state.jobs[input.jobId]?.telegramDelivery;
      if (!current
        || current.state.messageFingerprint !== input.messageFingerprint
        || current.claim?.attempt !== input.attempt
        || current.claim.token !== input.claimToken) return false;
      const draft = structuredClone(state);
      const delivery = draft.jobs[input.jobId]!.telegramDelivery!;
      if (input.outcome === "sent") {
        if (delivery.effect) {
          const key = alertKey(delivery.effect.watchedWalletId, delivery.effect.incomingTxHash);
          const alert = draft.incomingAlerts[key];
          if (options.failIncomingAlertUpdate) throw new Error("synthetic incoming alert update failure");
          if (!alert) throw new Error(`Missing Incoming alert effect row: ${key}`);
          alert.status = "sent";
          alert.telegramMessageId = input.telegramMessageId ?? null;
        }
        delivery.state.status = "sent";
        delivery.state.sentAt = input.settledAt.toISOString();
        delivery.state.lastError = null;
      } else if (input.outcome === "retryable" && input.attempt < 4) {
        delivery.state.status = "retryable";
        delivery.state.lastError = input.errorCode ?? "telegram_network_error";
      } else {
        delivery.state.status = "failed";
        delivery.state.lastError = input.attempt >= 4
          ? "telegram_attempts_exhausted"
          : input.errorCode ?? "telegram_chat_forbidden";
      }
      delivery.claim = null;
      state = draft;
      events.push(`settle:${input.jobId}:${delivery.state.status}`);
      return true;
    })
  };

  return {
    repository,
    events,
    successfulPreparationSnapshots,
    snapshot: () => structuredClone(state),
    addAlert: (alert: IncomingAlertRow) => {
      state.incomingAlerts[alertKey(alert.watchedWalletId, alert.incomingTxHash)] = structuredClone(alert);
    },
    addRecoveredIntent: (intent: RecoveredIntent) => {
      state.recoveredIntents[intent.jobId] = structuredClone(intent);
    }
  };
}

function completeJobAfterCas(
  contracts: DeliveryContracts,
  job: JobRow,
  input: {
    expectedCompletionVersion: number;
    resultJson: ForensicResult;
    payload: TelegramPayload;
    effect: DeliveryEffect;
  }
): boolean {
  if (job.status !== "running" || job.completionVersion !== input.expectedCompletionVersion) return false;
  job.status = "completed";
  job.completionVersion += 1;
  job.resultJson = structuredClone(input.resultJson);
  job.telegramDelivery = contracts.createPendingForensicTelegramDelivery({
    jobId: job.id,
    kind: job.kind,
    payload: input.payload,
    effect: input.effect
  });
  return true;
}

async function runWorker(
  runCycle: RunSingleForensicTelegramDeliveryCycle,
  harness: ReturnType<typeof createRepositoryHarness>,
  input: {
    now: () => Date;
    sendTelegram: (payload: TelegramPayload, signal: AbortSignal) => Promise<{ telegramMessageId: string }>;
    deliveryLimit?: number;
    recoveryLimit?: number;
    buildRecoveredTelegramDelivery?: (intent: RecoveredIntent) => Promise<{
      payload: TelegramPayload;
      effect: DeliveryEffect;
    }>;
  }
): Promise<unknown> {
  return runCycle({
    db: {},
    repository: harness.repository,
    now: input.now,
    sendTelegram: input.sendTelegram,
    deliveryLimit: input.deliveryLimit,
    recoveryLimit: input.recoveryLimit,
    buildRecoveredTelegramDelivery: input.buildRecoveredTelegramDelivery
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Plan 3 Telegram delivery runtime acceptance", () => {
  it("[AC-16] retries Telegram delivery without duplicating sent fingerprint", async () => {
    const contracts = await loadDeliveryContracts();
    const runCycle = await loadDeliveryWorker();
    const job = jobFixture(contracts, "retry-once");
    const harness = createRepositoryHarness([job]);
    const time = clock();
    const sends: string[] = [];
    let fail = true;

    await runWorker(runCycle, harness, {
      now: time.now,
      sendTelegram: async (payload) => {
        sends.push(contracts.fingerprintTelegramMessagePayload(payload));
        if (fail) {
          fail = false;
          throw Object.assign(new Error("raw Telegram outage token=must-not-store"), { code: "ETIMEDOUT" });
        }
        return { telegramMessageId: "telegram-message-retry-once" };
      }
    });
    expect(harness.snapshot().jobs[job.id].telegramDelivery).toMatchObject({
      state: {
        status: "retryable",
        attemptCount: 1,
        lastAttemptAt: START,
        lastError: "telegram_network_error",
      },
      claim: null
    });
    expect(JSON.stringify(harness.snapshot())).not.toContain("must-not-store");

    time.advance(29_999);
    await runWorker(runCycle, harness, {
      now: time.now,
      sendTelegram: async () => { throw new Error("retry backoff must derive from lastAttemptAt"); }
    });
    expect(sends).toHaveLength(1);
    time.advance(1);
    await runWorker(runCycle, harness, {
      now: time.now,
      sendTelegram: async (payload) => {
        sends.push(contracts.fingerprintTelegramMessagePayload(payload));
        return { telegramMessageId: "telegram-message-retry-once" };
      }
    });
    await runWorker(runCycle, harness, {
      now: time.now,
      sendTelegram: async () => { throw new Error("sent delivery must not be claimed"); }
    });

    const expectedFingerprint = contracts.fingerprintTelegramMessagePayload(payloadFixture(job.id, job.kind));
    expect(sends).toEqual([expectedFingerprint, expectedFingerprint]);
    expect(harness.snapshot().jobs[job.id].telegramDelivery).toMatchObject({
      state: {
        status: "sent",
        attemptCount: 2,
        messageFingerprint: expectedFingerprint
      },
      claim: null
    });
  });

  it("[REQ-36][DELIVERY-CAS] does not enqueue or send after a lost completion CAS", async () => {
    const contracts = await loadDeliveryContracts();
    const runCycle = await loadDeliveryWorker();
    const job = jobFixture(contracts, "lost-completion-cas", "where_is_money_check", "running");
    job.completionVersion = 2;
    expect(completeJobAfterCas(contracts, job, {
      expectedCompletionVersion: 1,
      resultJson: resultFixture("replacement"),
      payload: payloadFixture(job.id, job.kind),
      effect: null
    })).toBe(false);
    const harness = createRepositoryHarness([job]);
    const sends: TelegramPayload[] = [];

    await runWorker(runCycle, harness, {
      now: clock().now,
      sendTelegram: async (payload) => {
        sends.push(payload);
        return { telegramMessageId: "must-not-send" };
      }
    });
    expect(harness.snapshot().jobs[job.id].telegramDelivery).toBeNull();
    expect(sends).toEqual([]);
  });

  it("[REQ-36][DELIVERY-CLAIM] allows only one concurrent claimant per attempt", async () => {
    const contracts = await loadDeliveryContracts();
    const runCycle = await loadDeliveryWorker();
    const job = jobFixture(contracts, "concurrent-claim");
    const harness = createRepositoryHarness([job]);
    const telegram = deferred<{ telegramMessageId: string }>();
    let sends = 0;
    const sendTelegram = async () => {
      sends += 1;
      return telegram.promise;
    };

    const cycles = [
      runWorker(runCycle, harness, { now: clock().now, sendTelegram }),
      runWorker(runCycle, harness, { now: clock().now, sendTelegram })
    ];
    try {
      await flushTurns();
      const active = harness.snapshot().jobs[job.id].telegramDelivery!;
      expect(sends).toBe(1);
      expect(active).toMatchObject({
        state: { status: "retryable", attemptCount: 1 },
        claim: { attempt: 1, leaseExpiresAt: "2026-07-15T12:00:40.000Z" }
      });
      expect(active.claim!.token.length).toBeGreaterThan(0);
      telegram.resolve({ telegramMessageId: "telegram-concurrent" });
      await Promise.all(cycles);
    } finally {
      telegram.resolve({ telegramMessageId: "telegram-concurrent-cleanup" });
      await Promise.allSettled(cycles);
    }
  });

  it("[REQ-36][DELIVERY-LEASE] blocks a second claim before the active lease expires", async () => {
    const contracts = await loadDeliveryContracts();
    const runCycle = await loadDeliveryWorker();
    const job = jobFixture(contracts, "active-lease");
    const harness = createRepositoryHarness([job]);
    const time = clock();
    const telegram = deferred<{ telegramMessageId: string }>();
    let sends = 0;
    const first = runWorker(runCycle, harness, {
      now: time.now,
      sendTelegram: async () => {
        sends += 1;
        return telegram.promise;
      }
    });
    try {
      await flushTurns();
      time.advance(39_999);
      await runWorker(runCycle, harness, {
        now: time.now,
        sendTelegram: async () => {
          sends += 1;
          return { telegramMessageId: "must-not-send" };
        }
      });
      expect(sends).toBe(1);
      expect(harness.snapshot().jobs[job.id].telegramDelivery).toMatchObject({
        state: { status: "retryable", attemptCount: 1 },
        claim: { attempt: 1 }
      });
      telegram.resolve({ telegramMessageId: "telegram-active-lease" });
      await first;
    } finally {
      telegram.resolve({ telegramMessageId: "telegram-active-lease-cleanup" });
      await Promise.allSettled([first]);
    }
  });

  it("[REQ-36][DELIVERY-LEASE] reclaims crashed attempts one through three after lease expiry", async () => {
    const contracts = await loadDeliveryContracts();
    const runCycle = await loadDeliveryWorker();

    for (let expiredAttempt = 1; expiredAttempt <= 3; expiredAttempt += 1) {
      const job = jobFixture(contracts, `crashed-${expiredAttempt}`);
      const oldToken = CLAIM_TOKEN_FIXTURES[expiredAttempt + 3];
      job.telegramDelivery!.state.status = "retryable";
      job.telegramDelivery!.state.attemptCount = expiredAttempt;
      job.telegramDelivery!.claim = {
        token: oldToken,
        attempt: expiredAttempt,
        claimedAt: START,
        leaseExpiresAt: "2026-07-15T12:00:40.000Z"
      };
      const harness = createRepositoryHarness([job]);
      await runWorker(runCycle, harness, {
        now: clock("2026-07-15T12:00:40.000Z").now,
        sendTelegram: async () => ({ telegramMessageId: `telegram-reclaimed-${expiredAttempt}` })
      });
      const delivery = harness.snapshot().jobs[job.id].telegramDelivery!;
      expect(delivery.state).toMatchObject({ status: "sent", attemptCount: expiredAttempt + 1 });
      expect(delivery.state.messageFingerprint)
        .toBe(contracts.fingerprintTelegramMessagePayload(payloadFixture(job.id, job.kind)));
    }
  });

  it("[REQ-36][DELIVERY-LEASE] fails an expired fourth claim without a fifth send", async () => {
    const contracts = await loadDeliveryContracts();
    const runCycle = await loadDeliveryWorker();
    const job = jobFixture(contracts, "expired-fourth");
    job.telegramDelivery!.state.status = "retryable";
    job.telegramDelivery!.state.attemptCount = 4;
    job.telegramDelivery!.claim = {
      token: "opaque-expired-fourth-claim",
      attempt: 4,
      claimedAt: START,
      leaseExpiresAt: "2026-07-15T12:00:40.000Z"
    };
    const harness = createRepositoryHarness([job]);
    let sends = 0;
    await runWorker(runCycle, harness, {
      now: clock("2026-07-15T12:00:40.000Z").now,
      sendTelegram: async () => {
        sends += 1;
        return { telegramMessageId: "must-not-send" };
      }
    });
    expect(sends).toBe(0);
    expect(harness.snapshot().jobs[job.id].telegramDelivery).toMatchObject({
      state: {
        status: "failed",
        attemptCount: 4,
        lastError: "telegram_attempts_exhausted"
      },
      claim: null
    });
  });

  it("[REQ-36][DELIVERY-LEASE] ignores settlement from a superseded claim token", async () => {
    const contracts = await loadDeliveryContracts();
    const runCycle = await loadDeliveryWorker();
    const job = jobFixture(contracts, "stale-token");
    const harness = createRepositoryHarness([job]);
    const time = clock();
    const firstTelegram = deferred<{ telegramMessageId: string }>();
    const first = runWorker(runCycle, harness, {
      now: time.now,
      sendTelegram: async () => firstTelegram.promise
    });
    try {
      await flushTurns();
      const firstToken = harness.snapshot().jobs[job.id].telegramDelivery!.claim!.token;

      time.advance(40_000);
      await runWorker(runCycle, harness, {
        now: time.now,
        sendTelegram: async () => ({ telegramMessageId: "telegram-new-owner" })
      });
      firstTelegram.resolve({ telegramMessageId: "telegram-stale-owner" });
      await first;
      const delivery = harness.snapshot().jobs[job.id].telegramDelivery!;
      expect(delivery).toMatchObject({
        state: { status: "sent", attemptCount: 2 },
        claim: null
      });
      expect(harness.events.filter((event) => event === `settle:${job.id}:sent`)).toHaveLength(1);
      expect(delivery.claim?.token).not.toBe(firstToken);
    } finally {
      firstTelegram.resolve({ telegramMessageId: "telegram-stale-owner-cleanup" });
      await Promise.allSettled([first]);
    }
  });

  it("[REQ-36][DELIVERY-FAILURE] fails delivery without changing the forensic result", async () => {
    const contracts = await loadDeliveryContracts();
    const runCycle = await loadDeliveryWorker();
    const rawError = Object.assign(new Error("provider-secret-payload-must-not-leak"), { code: "ETIMEDOUT" });
    expect(contracts.classifyTelegramDeliveryError(rawError)).toEqual({
      outcome: "retryable",
      errorCode: "telegram_network_error"
    });
    const job = jobFixture(contracts, "failure-result");
    const originalResult = structuredClone(job.resultJson);
    const harness = createRepositoryHarness([job]);
    await runWorker(runCycle, harness, {
      now: clock().now,
      sendTelegram: async () => { throw rawError; }
    });
    const after = harness.snapshot();
    expect(after.jobs[job.id].resultJson).toEqual(originalResult);
    expect(after.jobs[job.id].telegramDelivery).toMatchObject({
      state: { status: "retryable", lastError: "telegram_network_error" },
      claim: null
    });
    expect(JSON.stringify(after)).not.toContain("provider-secret-payload-must-not-leak");
  });

  it("[REQ-03][REQ-36][DELIVERY-IMMUTABLE] retries without mutating score coverage or evidence", async () => {
    const contracts = await loadDeliveryContracts();
    const runCycle = await loadDeliveryWorker();
    const job = jobFixture(contracts, "immutable-retry", "incoming_deposit_check");
    const originalResult = structuredClone(job.resultJson);
    const originalFingerprint = job.telegramDelivery!.state.messageFingerprint;
    const harness = createRepositoryHarness([job]);
    const time = clock();
    await runWorker(runCycle, harness, {
      now: time.now,
      sendTelegram: async () => {
        throw Object.assign(new Error("raw first attempt"), { code: "ETIMEDOUT" });
      }
    });
    time.advance(30_000);
    await runWorker(runCycle, harness, {
      now: time.now,
      sendTelegram: async () => ({ telegramMessageId: "telegram-immutable-retry" })
    });
    const after = harness.snapshot().jobs[job.id];
    expect(after.resultJson).toEqual(originalResult);
    expect(after.resultJson.coverage).toEqual(originalResult.coverage);
    expect(after.resultJson.evidence).toEqual(originalResult.evidence);
    expect(after.telegramDelivery).toMatchObject({
      state: {
        status: "sent",
        messageFingerprint: originalFingerprint
      }
    });
  });

  it("[REQ-03][REQ-36][RESULT-IMMUTABLE] stores completed Deep second-layer enrichment as versioned context without changing result or delivery fingerprint", async () => {
    const { refreshDeepCheckSecondLayerFromIndex } = await import("../../src/forensics/deepSecondLayerRefresh");
    const jobId = "deep-context-real-refresh";
    const baseResult = {
      version: "forensic-result-v3",
      score: 61,
      coverage: { version: "forensic-coverage-v2", tracedTransferCount: 1 },
      evidence: [{ id: "deep-context-evidence" }],
      directCounterpartyInteractionProfiles: [],
      secondLayerRelationshipProfiles: structuredClone(CANONICAL_PENDING_DEEP_SECOND_LAYER_PROFILE)
    };
    const messageFingerprint = "a".repeat(64);
    const sourceJob: ForensicCheckJob = {
      ...producerJob({
        id: jobId,
        kind: "address_deep_check",
        subjectAddress: CANONICAL_PENDING_DEEP_SECOND_LAYER_PROFILE.subjectAddress,
        chatId: "deep-context-chat",
        progressJson: {
          telegramDelivery: {
            version: "forensic-telegram-delivery-v1",
            payload: {
              version: "telegram-message-payload-v1",
              chatId: "deep-context-chat",
              text: "immutable base delivery",
              parseMode: "HTML",
              replyMarkup: null
            },
            effect: null,
            state: {
              status: "pending",
              attemptCount: 0,
              lastAttemptAt: null,
              sentAt: null,
              lastError: null,
              messageFingerprint
            },
            claim: null
          }
        }
      }),
      status: "completed",
      resultJson: structuredClone(baseResult),
      completedAt: new Date(START)
    };
    type PersistenceWrite = {
      id: string;
      resultJson?: Record<string, unknown>;
      progressJson?: Record<string, unknown>;
      context?: {
        version: "deep-second-layer-context-v1";
        baseResultFingerprint: string;
        refreshedAt: string;
        profile: unknown;
      };
    };
    const writes: PersistenceWrite[] = [];
    const persisted = structuredClone(sourceJob);
    const capturePersistence = async (input: PersistenceWrite): Promise<boolean> => {
      writes.push(structuredClone(input));
      if (input.resultJson) persisted.resultJson = structuredClone(input.resultJson);
      if (input.progressJson) persisted.progressJson = { ...persisted.progressJson, ...structuredClone(input.progressJson) };
      if (input.context) {
        persisted.progressJson = {
          ...persisted.progressJson,
          deepSecondLayerContext: structuredClone(input.context)
        };
      }
      return true;
    };

    const refreshResult = await refreshDeepCheckSecondLayerFromIndex({
      jobId,
      getJob: async () => structuredClone(sourceJob),
      patchCompletedJob: capturePersistence,
      saveCompletedDeepSecondLayerContext: capturePersistence,
      getClassificationForAddress: async () => null,
      getIndexState: async () => null,
      listIndexedEdges: async () => []
    } as unknown as Parameters<typeof refreshDeepCheckSecondLayerFromIndex>[0]);

    expect(refreshResult.status).toBe("refreshed");
    expect(writes).toHaveLength(1);
    const write = writes[0]!;
    expect(write).not.toHaveProperty("resultJson");
    expect(write).not.toHaveProperty("progressJson");
    expect(write.context).toMatchObject({
      version: "deep-second-layer-context-v1",
      baseResultFingerprint: resultFingerprint(baseResult),
      refreshedAt: expect.any(String),
      profile: {
        version: 1,
        source: "deepcheck_relationship_expansion_v1"
      }
    });
    expect(persisted.resultJson).toEqual(baseResult);
    expect((persisted.progressJson.telegramDelivery as DeliveryEnvelope).state.messageFingerprint)
      .toBe(messageFingerprint);
    expect(persisted.progressJson.deepSecondLayerContext).toEqual(write.context);
  });

  it("[REQ-05][REQ-36][DELIVERY-MODE] keeps Where Deep and Incoming payloads bound to their jobs", async () => {
    const [{ runSingleDeepForensicJobCycle }, { runSingleIncomingDepositJobCycle }] = await Promise.all([
      import("../../src/forensics/deepForensicJob"),
      import("../../src/forensics/incomingDepositJob")
    ]);
    const whereJob = producerJob({
      id: "where-producer",
      kind: "where_is_money_check",
      subjectAddress: "TGytcHDm9k4r6QPvine8c6A3WWaqTBZAZD",
      chatId: "where-chat",
      progressJson: { fastRiskSnapshot: { score: 0, level: "LOW" }, locale: "en", mode: "wallet_profile" }
    });
    const deepJob = producerJob({
      id: "deep-producer",
      kind: "address_deep_check",
      subjectAddress: "TYFkLfEzv5eYgAxANwdGd26KyQwRZYiqtV",
      chatId: "deep-chat",
      progressJson: { fastRiskSnapshot: { score: 0, level: "LOW" }, locale: "en" }
    });
    const incomingJob = producerJob({
      id: "incoming-producer",
      kind: "incoming_deposit_check",
      subjectAddress: "TWYSVbUy6eTu6ZrFWRUimgDy9SinkggVKL",
      chatId: "incoming-chat",
      progressJson: {
        depositTxHash: "b".repeat(64),
        watchedWallet: "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM",
        watchedWalletId: "incoming-wallet",
        sender: "TWYSVbUy6eTu6ZrFWRUimgDy9SinkggVKL",
        amountRaw: "1000000",
        amount: "1",
        timestamp: "2026-07-15T11:59:00.000Z",
        telegramUserId: "incoming-chat",
        alertMode: "realtime",
        locale: "en"
      }
    });
    type ProducerCompletion = {
      id: string;
      progressJson: Record<string, unknown>;
      resultJson: Record<string, unknown>;
    };
    const completions = new Map<string, ProducerCompletion>();
    const captureCompletion = async (input: ProducerCompletion): Promise<boolean> => {
      completions.set(input.id, structuredClone(input));
      return true;
    };
    const legacyWhereSend = vi.fn(async () => undefined);
    const legacyDeepSend = vi.fn(async () => undefined);
    const legacyIncomingSend = vi.fn(async () => undefined);
    const legacyIncomingMarkSent = vi.fn(async () => true);
    const wherePayload = (job: ForensicCheckJob): TelegramPayload => ({
      version: "telegram-message-payload-v1",
      chatId: job.chatId!,
      text: `[WHERE] ${job.id} ${job.subjectAddress}`,
      parseMode: "HTML",
      replyMarkup: null
    });
    const deepPayload = (job: ForensicCheckJob): TelegramPayload => ({
      version: "telegram-message-payload-v1",
      chatId: job.chatId!,
      text: `[DEEP] ${job.id} ${job.subjectAddress}`,
      parseMode: "HTML",
      replyMarkup: null
    });

    await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => whereJob,
      completeForensicCheckJob: captureCompletion,
      recordRiskEvaluation: async () => undefined,
      tronClient: { listRelatedTrc20Transfers: async () => [] },
      getLabelsForAddress: async () => [],
      getUsdtRestrictionStatus: async (address: string) => restrictionProfile(address, "0"),
      sendWhereIsMoneyJobResult: legacyWhereSend,
      buildWhereIsMoneyJobResultPayload: (job: ForensicCheckJob) => wherePayload(job)
    } as unknown as Parameters<typeof runSingleDeepForensicJobCycle>[0], {
      recentFallbackMinTransferCount: 60,
      maxEdgesPerAddress: 60,
      recentFallbackTransferLimit: 60
    });
    await runSingleDeepForensicJobCycle({
      claimNextForensicCheckJob: async () => deepJob,
      completeForensicCheckJob: captureCompletion,
      recordRiskEvaluation: async () => undefined,
      tronClient: { listRelatedTrc20Transfers: async () => [] },
      getLabelsForAddress: async () => [],
      getUsdtRestrictionStatus: async (address: string) => restrictionProfile(address, null),
      sendJobResult: legacyDeepSend,
      buildJobResultPayload: (job: ForensicCheckJob) => deepPayload(job)
    } as unknown as Parameters<typeof runSingleDeepForensicJobCycle>[0]);
    await runSingleIncomingDepositJobCycle({
      claimNextForensicCheckJob: async () => incomingJob,
      completeForensicCheckJob: captureCompletion,
      updateForensicCheckJobProgress: async () => true,
      markUserAlertSent: legacyIncomingMarkSent,
      markUserAlertFailed: async () => true,
      recordObservedTransactionRisk: async () => true,
      hasUndismissedAddressPoisoningCandidateForIncoming: async () => false,
      sendUserAlert: legacyIncomingSend,
      formatIncomingDepositRiskAlert: (input) => ({
        text: `[INCOMING] ${input.jobId} ${input.sender}`,
        parseMode: "HTML",
        replyMarkup: undefined
      }),
      buildReport: async () => incomingProducerReport()
    });

    const expected = [
      { job: whereJob, text: `[WHERE] ${whereJob.id} ${whereJob.subjectAddress}`, effect: null },
      { job: deepJob, text: `[DEEP] ${deepJob.id} ${deepJob.subjectAddress}`, effect: null },
      {
        job: incomingJob,
        text: `[INCOMING] ${incomingJob.id} ${incomingJob.subjectAddress}`,
        effect: {
          kind: "incoming_user_alert",
          watchedWalletId: "incoming-wallet",
          incomingTxHash: "b".repeat(64)
        }
      }
    ];
    for (const binding of expected) {
      const completion = completions.get(binding.job.id);
      expect(completion?.id).toBe(binding.job.id);
      const delivery = completion?.progressJson.telegramDelivery as DeliveryEnvelope | undefined;
      expect(delivery).toMatchObject({
        payload: {
          version: "telegram-message-payload-v1",
          chatId: binding.job.chatId,
          text: binding.text
        },
        effect: binding.effect,
        state: { status: "pending", attemptCount: 0 },
        claim: null
      });
    }
    expect(legacyWhereSend).not.toHaveBeenCalled();
    expect(legacyDeepSend).not.toHaveBeenCalled();
    expect(legacyIncomingSend).not.toHaveBeenCalled();
    expect(legacyIncomingMarkSent).not.toHaveBeenCalled();
  });

  it("[REQ-36][DELIVERY-EFFECT] marks Incoming alert sent only after Telegram success", async () => {
    const contracts = await loadDeliveryContracts();
    const runCycle = await loadDeliveryWorker();
    const job = jobFixture(contracts, "incoming-effect", "incoming_deposit_check");
    job.telegramDelivery!.effect = {
      kind: "incoming_user_alert",
      watchedWalletId: "wallet-incoming-effect",
      incomingTxHash: "tx-incoming-effect"
    };
    const harness = createRepositoryHarness([job]);
    harness.addAlert({
      watchedWalletId: "wallet-incoming-effect",
      incomingTxHash: "tx-incoming-effect",
      status: "pending",
      telegramMessageId: null
    });
    const telegram = deferred<{ telegramMessageId: string }>();
    const cycle = runWorker(runCycle, harness, {
      now: clock().now,
      sendTelegram: async () => telegram.promise
    });
    try {
      await flushTurns();
      expect(harness.snapshot().incomingAlerts["wallet-incoming-effect:tx-incoming-effect"])
        .toMatchObject({ status: "pending", telegramMessageId: null });
      telegram.resolve({ telegramMessageId: "telegram-incoming-effect" });
      await cycle;
      expect(harness.snapshot().incomingAlerts["wallet-incoming-effect:tx-incoming-effect"])
        .toMatchObject({ status: "sent", telegramMessageId: "telegram-incoming-effect" });
    } finally {
      telegram.resolve({ telegramMessageId: "telegram-incoming-effect-cleanup" });
      await Promise.allSettled([cycle]);
    }
  });

  it("[REQ-36][DELIVERY-EFFECT][POSTGRES] rolls back delivery settlement when Incoming alert update fails", async () => {
    const contracts = await loadDeliveryContracts();
    const runCycle = await loadDeliveryWorker();
    const job = jobFixture(contracts, "atomic-incoming", "incoming_deposit_check");
    job.telegramDelivery!.effect = {
      kind: "incoming_user_alert",
      watchedWalletId: "wallet-atomic",
      incomingTxHash: "tx-atomic"
    };
    const harness = createRepositoryHarness([job], { failIncomingAlertUpdate: true });
    harness.addAlert({
      watchedWalletId: "wallet-atomic",
      incomingTxHash: "tx-atomic",
      status: "pending",
      telegramMessageId: null
    });
    await expect(runWorker(runCycle, harness, {
      now: clock().now,
      sendTelegram: async () => ({ telegramMessageId: "telegram-atomic" })
    })).rejects.toThrow("synthetic incoming alert update failure");
    const after = harness.snapshot();
    expect(after.jobs[job.id].telegramDelivery).toMatchObject({
      state: { status: "retryable", sentAt: null },
      claim: { attempt: 1 }
    });
    expect(after.incomingAlerts["wallet-atomic:tx-atomic"])
      .toMatchObject({ status: "pending", telegramMessageId: null });
  });

  it("[REQ-36][DELIVERY-RECOVERY] turns stale recovery into durable delivery without direct send", async () => {
    const contracts = await loadDeliveryContracts();
    const runCycle = await loadDeliveryWorker();
    const job = jobFixture(contracts, "stale-recovery", "where_is_money_check", "failed");
    const harness = createRepositoryHarness([job]);
    harness.addRecoveredIntent(recoveredIntent(job.id));
    const sends: string[] = [];
    await runWorker(runCycle, harness, {
      now: clock().now,
      recoveryLimit: 10,
      deliveryLimit: 10,
      buildRecoveredTelegramDelivery: async () => ({
        payload: payloadFixture(job.id, job.kind),
        effect: null
      }),
      sendTelegram: async (payload) => {
        sends.push(payload.chatId);
        return { telegramMessageId: "telegram-stale-recovery" };
      }
    });
    const after = harness.snapshot();
    expect(after.recoveredIntents).not.toHaveProperty(job.id);
    expect(harness.successfulPreparationSnapshots).toEqual([{
      jobId: job.id,
      intentPresent: false,
      delivery: expect.objectContaining({
        state: expect.objectContaining({ status: "pending", attemptCount: 0 }),
        claim: null
      })
    }]);
    expect(after.jobs[job.id].telegramDelivery).toMatchObject({
      state: { status: "sent", attemptCount: 1 },
      claim: null
    });
    expect(sends).toEqual([`chat-${job.id}`]);
    expect(harness.events).toEqual([
      `attach:${job.id}`,
      `claim:${job.id}:1`,
      `settle:${job.id}:sent`
    ]);
  });

  it("[REQ-36][DELIVERY-RECOVERY] bounds stale intent preparation failures and terminalizes the fourth attempt", async () => {
    const contracts = await loadDeliveryContracts();
    const runCycle = await loadDeliveryWorker();
    const batchJobs = Array.from({ length: 11 }, (_, index) =>
      jobFixture(contracts, `recovery-batch-${index + 1}`, "where_is_money_check", "failed")
    );
    const batchHarness = createRepositoryHarness(batchJobs);
    for (const job of batchJobs) batchHarness.addRecoveredIntent(recoveredIntent(job.id));
    await runWorker(runCycle, batchHarness, {
      now: clock().now,
      recoveryLimit: 10,
      deliveryLimit: 1,
      buildRecoveredTelegramDelivery: async (intent) => ({
        payload: payloadFixture(intent.jobId, "where_is_money_check"),
        effect: null
      }),
      sendTelegram: async () => ({ telegramMessageId: "telegram-bounded-recovery" })
    });
    const batch = batchHarness.snapshot();
    expect(batchHarness.successfulPreparationSnapshots).toHaveLength(10);
    expect(Object.values(batch.recoveredIntents)).toHaveLength(1);
    expect(Object.values(batch.recoveredIntents)[0]!.intent).toMatchObject({
      preparationStatus: "pending",
      preparationAttemptCount: 0
    });

    const failedJob = jobFixture(contracts, "bounded-failure", "incoming_deposit_check", "failed");
    const failedHarness = createRepositoryHarness([failedJob]);
    failedHarness.addRecoveredIntent(recoveredIntent(failedJob.id));
    const time = clock();
    for (const advance of [0, 30_000, 120_000, 600_000]) {
      time.advance(advance);
      await runWorker(runCycle, failedHarness, {
        now: time.now,
        recoveryLimit: 10,
        deliveryLimit: 1,
        buildRecoveredTelegramDelivery: async () => {
          throw new Error("raw formatter secret must not persist");
        },
        sendTelegram: async () => ({ telegramMessageId: "must-not-send" })
      });
    }
    const failed = failedHarness.snapshot();
    expect(failed.recoveredIntents[failedJob.id].intent).toMatchObject({
      preparationStatus: "failed",
      preparationAttemptCount: 4,
      nextPreparationAttemptAt: null,
      lastPreparationError: "stale_intent_preparation_attempts_exhausted"
    });
    expect(failed.jobs[failedJob.id].telegramDelivery).toBeNull();
    expect(JSON.stringify(failed)).not.toContain("raw formatter secret must not persist");
  });

  it("[REQ-36][DELIVERY-TIMEOUT] aborts Telegram send after 25 seconds", async () => {
    const contracts = await loadDeliveryContracts();
    const runCycle = await loadDeliveryWorker();
    vi.useFakeTimers();
    const job = jobFixture(contracts, "send-timeout");
    const harness = createRepositoryHarness([job]);
    const sendResult = deferred<{ telegramMessageId: string }>();
    let observedSignal: AbortSignal | undefined;
    let cycle: Promise<unknown> | undefined;
    try {
      cycle = runWorker(runCycle, harness, {
        now: clock().now,
        sendTelegram: async (_payload, signal) => {
          observedSignal = signal;
          signal.addEventListener(
            "abort",
            () => sendResult.reject(new DOMException("raw timeout", "AbortError")),
            { once: true }
          );
          return sendResult.promise;
        }
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(observedSignal).toBeDefined();
      expect(observedSignal!.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(24_999);
      expect(observedSignal!.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(observedSignal!.aborted).toBe(true);
      await cycle;
      expect(harness.snapshot().jobs[job.id].telegramDelivery).toMatchObject({
        state: {
          status: "retryable",
          attemptCount: 1,
          lastAttemptAt: START,
          lastError: "telegram_timeout"
        },
        claim: null
      });
    } finally {
      sendResult.resolve({ telegramMessageId: "telegram-timeout-cleanup" });
      if (cycle) await Promise.allSettled([cycle]);
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("[REQ-36][DELIVERY-CADENCE] runs delivery while the Where promise remains unresolved", async () => {
    const modulePath: string = ORCHESTRATION_MODULE;
    let orchestrationModule: Record<string, unknown>;
    try {
      orchestrationModule = await import(/* @vite-ignore */ modulePath) as Record<string, unknown>;
    } catch (error) {
      throw new Error("Plan 3 feature missing: createForensicRuntimeOrchestration", { cause: error });
    }
    const createForensicRuntimeOrchestration = requireFunction<CreateForensicRuntimeOrchestration>(
      orchestrationModule,
      "createForensicRuntimeOrchestration"
    );
    const where = deferred<void>();
    let deliveryStarted = 0;
    const runtime = createForensicRuntimeOrchestration({
      runWhereCycle: () => where.promise,
      runForensicTelegramDeliveryCycle: async () => { deliveryStarted += 1; }
    });

    let whereCycle: Promise<void> | undefined;
    let deliveryCycle: Promise<void> | undefined;
    try {
      whereCycle = runtime.runForensicCycle();
      deliveryCycle = runtime.runDeliveryCycle();
      await Promise.resolve();
      await Promise.resolve();
      expect(deliveryStarted).toBe(1);
      await expect(deliveryCycle).resolves.toBeUndefined();
      let whereSettled = false;
      void whereCycle.then(
        () => { whereSettled = true; },
        () => { whereSettled = true; }
      );
      await Promise.resolve();
      expect(whereSettled).toBe(false);
      where.resolve();
      await expect(whereCycle).resolves.toBeUndefined();
    } finally {
      where.resolve();
      await Promise.allSettled([whereCycle, deliveryCycle].filter((cycle): cycle is Promise<void> => cycle !== undefined));
    }
  });
});
