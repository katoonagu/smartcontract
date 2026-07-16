import {
  classifyTelegramDeliveryError,
  createPendingForensicTelegramDelivery,
  type ForensicTelegramDeliveryJobKind
} from "./telegramDelivery";
import type {
  ForensicTelegramDeliveryV1,
  RecoveredForensicDeliveryIntentPreparationErrorCode,
  RecoveredForensicDeliveryIntentV1,
  TelegramDeliveryEffectV1,
  TelegramDeliveryErrorCode,
  TelegramMessagePayloadV1
} from "../types";

const DELIVERY_BATCH_LIMIT = 10;
const DELIVERY_SEND_TIMEOUT_MS = 25_000;

type RecoveredDeliveryIntent = {
  jobId: string;
  intent: RecoveredForensicDeliveryIntentV1;
};

type DeliveryClaim = {
  jobId: string;
  kind: ForensicTelegramDeliveryJobKind;
  payload: TelegramMessagePayloadV1;
  effect: TelegramDeliveryEffectV1;
  messageFingerprint: string;
  claim: NonNullable<ForensicTelegramDeliveryV1["claim"]>;
};

export type ForensicTelegramDeliveryRepository<TDb = unknown> = {
  listDueRecoveredForensicDeliveryIntents(
    db: TDb,
    input: { now: Date; limit: number }
  ): Promise<RecoveredDeliveryIntent[]>;
  settleRecoveredForensicDeliveryIntentPreparation(
    db: TDb,
    input: {
      jobId: string;
      intentCreatedAt: string;
      expectedPreparationAttemptCount: number;
      attemptedAt: Date;
      errorCode: Exclude<
        RecoveredForensicDeliveryIntentPreparationErrorCode,
        "stale_intent_preparation_attempts_exhausted"
      >;
    }
  ): Promise<boolean>;
  attachRecoveredForensicTelegramDelivery(
    db: TDb,
    input: {
      jobId: string;
      intentCreatedAt: string;
      expectedPreparationAttemptCount: number;
      delivery: ForensicTelegramDeliveryV1;
    }
  ): Promise<boolean>;
  claimNextForensicTelegramDelivery(
    db: TDb,
    input: { now: Date }
  ): Promise<DeliveryClaim | null>;
  settleForensicTelegramDelivery(
    db: TDb,
    input: {
      jobId: string;
      messageFingerprint: string;
      attempt: number;
      claimToken: string;
      settledAt: Date;
      outcome: "sent" | "retryable" | "failed";
      errorCode?: TelegramDeliveryErrorCode | null;
      telegramMessageId?: string | null;
    }
  ): Promise<boolean>;
};

type SafeLogger = {
  info?(event: string, fields: Record<string, unknown>): void;
  warn?(event: string, fields: Record<string, unknown>): void;
};

export type ForensicTelegramDeliveryCycleInput<TDb = unknown> = {
  db: TDb;
  now(): Date;
  repository: ForensicTelegramDeliveryRepository<TDb>;
  deliveryLimit?: number;
  recoveryLimit?: number;
  buildRecoveredTelegramDelivery?(intent: RecoveredDeliveryIntent): Promise<{
    kind?: ForensicTelegramDeliveryJobKind;
    payload: TelegramMessagePayloadV1;
    effect: TelegramDeliveryEffectV1;
  }>;
  sendTelegram(
    payload: TelegramMessagePayloadV1,
    signal: AbortSignal
  ): Promise<{ telegramMessageId: string } | void>;
  logger?: SafeLogger;
};

export type ForensicTelegramDeliveryCycleResult = {
  prepared: number;
  preparationFailed: number;
  claimed: number;
  sent: number;
  deliveryFailed: number;
};

function boundedLimit(value: number | undefined): number {
  if (value === undefined) return DELIVERY_BATCH_LIMIT;
  if (!Number.isFinite(value)) return DELIVERY_BATCH_LIMIT;
  return Math.min(Math.max(Math.floor(value), 0), DELIVERY_BATCH_LIMIT);
}

function recoveredPreparationErrorCode(
  error: unknown
): Exclude<
  RecoveredForensicDeliveryIntentPreparationErrorCode,
  "stale_intent_preparation_attempts_exhausted"
> {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (code === "stale_intent_context_unavailable"
      || code === "stale_intent_payload_build_failed"
      || code === "stale_intent_unknown_retryable") {
      return code;
    }
  }
  return "stale_intent_payload_build_failed";
}

async function prepareRecoveredIntents<TDb>(
  input: ForensicTelegramDeliveryCycleInput<TDb>,
  limit: number,
  result: ForensicTelegramDeliveryCycleResult
): Promise<void> {
  if (limit === 0) return;
  const now = input.now();
  const intents = await input.repository.listDueRecoveredForensicDeliveryIntents(
    input.db,
    { now, limit }
  );

  for (const recovered of intents.slice(0, limit)) {
    let delivery: ForensicTelegramDeliveryV1;
    try {
      if (!input.buildRecoveredTelegramDelivery) {
        throw Object.assign(new Error("Recovered delivery context is unavailable"), {
          code: "stale_intent_context_unavailable"
        });
      }
      const built = await input.buildRecoveredTelegramDelivery(recovered);
      delivery = createPendingForensicTelegramDelivery({
        jobId: recovered.jobId,
        kind: built.kind ?? (built.effect === null ? "where_is_money_check" : "incoming_deposit_check"),
        payload: built.payload,
        effect: built.effect
      });
    } catch (error) {
      const errorCode = recoveredPreparationErrorCode(error);
      const settled = await input.repository.settleRecoveredForensicDeliveryIntentPreparation(
        input.db,
        {
          jobId: recovered.jobId,
          intentCreatedAt: recovered.intent.createdAt,
          expectedPreparationAttemptCount: recovered.intent.preparationAttemptCount,
          attemptedAt: now,
          errorCode
        }
      );
      if (settled) result.preparationFailed += 1;
      input.logger?.warn?.("forensic_telegram_delivery_preparation_failed", {
        jobId: recovered.jobId,
        preparationAttempt: recovered.intent.preparationAttemptCount + 1,
        errorCode
      });
      continue;
    }
    const attached = await input.repository.attachRecoveredForensicTelegramDelivery(
      input.db,
      {
        jobId: recovered.jobId,
        intentCreatedAt: recovered.intent.createdAt,
        expectedPreparationAttemptCount: recovered.intent.preparationAttemptCount,
        delivery
      }
    );
    if (attached) result.prepared += 1;
  }
}

async function sendClaim<TDb>(
  input: ForensicTelegramDeliveryCycleInput<TDb>,
  claim: DeliveryClaim,
  result: ForensicTelegramDeliveryCycleResult
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DELIVERY_SEND_TIMEOUT_MS);
  let response: { telegramMessageId: string } | void;
  try {
    response = await input.sendTelegram(claim.payload, controller.signal);
  } catch (error) {
    const classified = controller.signal.aborted
      ? { outcome: "retryable" as const, errorCode: "telegram_timeout" as const }
      : classifyTelegramDeliveryError(error);
    const settled = await input.repository.settleForensicTelegramDelivery(input.db, {
      jobId: claim.jobId,
      messageFingerprint: claim.messageFingerprint,
      attempt: claim.claim.attempt,
      claimToken: claim.claim.token,
      settledAt: input.now(),
      outcome: classified.outcome,
      errorCode: classified.errorCode,
      telegramMessageId: null
    });
    if (settled) result.deliveryFailed += 1;
    input.logger?.warn?.("forensic_telegram_delivery_settled", {
      jobId: claim.jobId,
      kind: claim.kind,
      attempt: claim.claim.attempt,
      outcome: settled ? classified.outcome : "stale_claim",
      errorCode: classified.errorCode
    });
    return;
  } finally {
    clearTimeout(timeout);
  }

  const telegramMessageId = response && typeof response.telegramMessageId === "string"
    ? response.telegramMessageId
    : null;
  const settled = await input.repository.settleForensicTelegramDelivery(input.db, {
    jobId: claim.jobId,
    messageFingerprint: claim.messageFingerprint,
    attempt: claim.claim.attempt,
    claimToken: claim.claim.token,
    settledAt: input.now(),
    outcome: "sent",
    errorCode: null,
    telegramMessageId
  });
  if (settled) result.sent += 1;
  input.logger?.info?.("forensic_telegram_delivery_settled", {
    jobId: claim.jobId,
    kind: claim.kind,
    attempt: claim.claim.attempt,
    outcome: settled ? "sent" : "stale_claim"
  });
}

export async function runSingleForensicTelegramDeliveryCycle<TDb = unknown>(
  input: ForensicTelegramDeliveryCycleInput<TDb>
): Promise<ForensicTelegramDeliveryCycleResult> {
  const result: ForensicTelegramDeliveryCycleResult = {
    prepared: 0,
    preparationFailed: 0,
    claimed: 0,
    sent: 0,
    deliveryFailed: 0
  };
  const recoveryLimit = boundedLimit(input.recoveryLimit);
  const deliveryLimit = boundedLimit(input.deliveryLimit);

  // ponytail: callers without the formatter leave recovery intents pending;
  // provide the builder to enable preparation (the production runtime does).
  if (input.buildRecoveredTelegramDelivery) {
    await prepareRecoveredIntents(input, recoveryLimit, result);
  }

  // ponytail: claim null can mean either an empty queue or an expired fourth
  // attempt was terminalized; bounded probing is capped at the batch limit.
  for (let index = 0; index < deliveryLimit; index += 1) {
    const claim = await input.repository.claimNextForensicTelegramDelivery(
      input.db,
      { now: input.now() }
    );
    if (!claim) continue;
    result.claimed += 1;
    await sendClaim(input, claim, result);
  }

  return result;
}
