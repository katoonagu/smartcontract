import type {
  ForensicTelegramDeliveryV1,
  RecoveredForensicDeliveryIntentPreparationErrorCode,
  RecoveredForensicDeliveryIntentV1,
  TelegramDeliveryEffectV1,
  TelegramDeliveryErrorCode,
  TelegramDeliveryPermanentErrorCode,
  TelegramDeliveryRetryableErrorCode,
  TelegramMessagePayloadV1
} from "../types";
import { canonicalizeJson, fingerprintCanonicalJson } from "./canonicalJson";

export { canonicalizeJson, fingerprintCanonicalJson } from "./canonicalJson";

export type ForensicTelegramDeliveryJobKind =
  | "address_deep_check"
  | "where_is_money_check"
  | "incoming_deposit_check";

const CLAIM_LEASE_MS = 40_000;
const MAX_DELIVERY_ATTEMPTS = 4;
const RETRY_BACKOFF_MS = [30_000, 120_000, 600_000] as const;
const MAX_IDENTIFIER_LENGTH = 512;
const MAX_CLAIM_TOKEN_LENGTH = 512;
const MIN_BASE64URL_CLAIM_TOKEN_LENGTH = 22;
const MAX_CHAT_ID_LENGTH = 256;
const MAX_TELEGRAM_TEXT_LENGTH = 4_096;
const MAX_JSON_STRING_LENGTH = 4_096;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_ARRAY_LENGTH = 10_000;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const BASE64URL_CLAIM_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

const retryableErrorCodes = new Set<TelegramDeliveryRetryableErrorCode>([
  "telegram_timeout",
  "telegram_rate_limited",
  "telegram_server_error",
  "telegram_network_error",
  "telegram_unknown_retryable"
]);
const permanentErrorCodes = new Set<TelegramDeliveryPermanentErrorCode>([
  "telegram_chat_forbidden",
  "telegram_bad_request",
  "telegram_attempts_exhausted"
]);
const staleIntentRetryableErrorCodes = new Set<RecoveredForensicDeliveryIntentPreparationErrorCode>([
  "stale_intent_context_unavailable",
  "stale_intent_payload_build_failed",
  "stale_intent_unknown_retryable"
]);
const recoveredIntentReasonCodes = new Set([
  "stale_running_retry_exhausted",
  "stale_running_incoming_retry_exhausted",
  "stale_running_delivery_sensitive_phase"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactOwnKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length
    && keys.every((key) => typeof key === "string" && expected.includes(key));
}

function isBoundedNonEmptyString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function isClaimToken(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= MIN_BASE64URL_CLAIM_TOKEN_LENGTH
    && value.length <= MAX_CLAIM_TOKEN_LENGTH
    && BASE64URL_CLAIM_TOKEN_PATTERN.test(value);
}

function isAttempt(value: unknown, minimum = 1): value is number {
  return Number.isInteger(value)
    && (value as number) >= minimum
    && (value as number) <= MAX_DELIVERY_ATTEMPTS;
}

function isoTimestampMilliseconds(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  return new Date(milliseconds).toISOString() === value ? milliseconds : null;
}

function dateMilliseconds(value: Date, field: string): number {
  const milliseconds = value.getTime();
  if (!Number.isFinite(milliseconds)) throw new RangeError(`${field} must be a valid Date`);
  return milliseconds;
}

function isJsonValue(value: unknown, depth = 0): boolean {
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "string") return value.length <= MAX_JSON_STRING_LENGTH;
  if (typeof value === "number") return Number.isFinite(value);
  if (depth >= MAX_JSON_DEPTH) return false;
  if (Array.isArray(value)) {
    return value.length <= MAX_JSON_ARRAY_LENGTH
      && value.every((item) => isJsonValue(item, depth + 1));
  }
  if (!isPlainRecord(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= MAX_JSON_ARRAY_LENGTH && entries.every(([key, item]) =>
    key.length <= MAX_IDENTIFIER_LENGTH && isJsonValue(item, depth + 1));
}

export function isTelegramMessagePayloadV1(value: unknown): value is TelegramMessagePayloadV1 {
  if (!isRecord(value)
    || !hasExactOwnKeys(value, ["version", "chatId", "text", "parseMode", "replyMarkup"])
    || value.version !== "telegram-message-payload-v1"
    || !isBoundedNonEmptyString(value.chatId, MAX_CHAT_ID_LENGTH)
    || !isBoundedNonEmptyString(value.text, MAX_TELEGRAM_TEXT_LENGTH)
    || (value.parseMode !== "HTML" && value.parseMode !== null)) {
    return false;
  }
  if (value.replyMarkup === null) return true;
  if (!isPlainRecord(value.replyMarkup)) return false;
  try {
    canonicalizeJson(value.replyMarkup);
  } catch {
    return false;
  }
  return isJsonValue(value.replyMarkup);
}

function isTelegramDeliveryEffectV1(value: unknown): value is TelegramDeliveryEffectV1 {
  return value === null || (
    isRecord(value)
    && hasExactOwnKeys(value, ["kind", "watchedWalletId", "incomingTxHash"])
    && value.kind === "incoming_user_alert"
    && isBoundedNonEmptyString(value.watchedWalletId, MAX_IDENTIFIER_LENGTH)
    && isBoundedNonEmptyString(value.incomingTxHash, MAX_IDENTIFIER_LENGTH)
  );
}

export function fingerprintTelegramMessagePayload(payload: TelegramMessagePayloadV1): string {
  if (!isTelegramMessagePayloadV1(payload)) throw new TypeError("Invalid Telegram message payload");
  return fingerprintCanonicalJson({
    chatId: payload.chatId,
    text: payload.text,
    parseMode: payload.parseMode,
    replyMarkup: payload.replyMarkup
  });
}

function isDeliveryClaim(value: unknown, attemptCount: number, lastAttemptAt: string): boolean {
  if (!isRecord(value)
    || !hasExactOwnKeys(value, ["token", "attempt", "claimedAt", "leaseExpiresAt"])
    || !isClaimToken(value.token)
    || value.attempt !== attemptCount
    || value.claimedAt !== lastAttemptAt) {
    return false;
  }
  const claimedAt = isoTimestampMilliseconds(value.claimedAt);
  const leaseExpiresAt = isoTimestampMilliseconds(value.leaseExpiresAt);
  return claimedAt !== null
    && leaseExpiresAt !== null
    && leaseExpiresAt - claimedAt === CLAIM_LEASE_MS;
}

function isRetryableErrorCode(value: unknown): value is TelegramDeliveryRetryableErrorCode {
  return typeof value === "string"
    && retryableErrorCodes.has(value as TelegramDeliveryRetryableErrorCode);
}

function isPermanentErrorCode(value: unknown): value is TelegramDeliveryPermanentErrorCode {
  return typeof value === "string"
    && permanentErrorCodes.has(value as TelegramDeliveryPermanentErrorCode);
}

export function isForensicTelegramDeliveryV1(
  value: unknown,
  jobKind?: ForensicTelegramDeliveryJobKind
): value is ForensicTelegramDeliveryV1 {
  if (!isRecord(value)
    || !hasExactOwnKeys(value, ["version", "payload", "effect", "state", "claim"])
    || value.version !== "forensic-telegram-delivery-v1"
    || !isTelegramMessagePayloadV1(value.payload)
    || !isTelegramDeliveryEffectV1(value.effect)
    || !isRecord(value.state)
    || !hasExactOwnKeys(value.state, [
      "status",
      "attemptCount",
      "lastAttemptAt",
      "sentAt",
      "lastError",
      "messageFingerprint"
    ])) {
    return false;
  }
  if (value.effect !== null && jobKind !== "incoming_deposit_check") {
    return false;
  }

  const state = value.state;
  if (!SHA256_PATTERN.test(typeof state.messageFingerprint === "string" ? state.messageFingerprint : "")
    || state.messageFingerprint !== fingerprintTelegramMessagePayload(value.payload)) {
    return false;
  }

  if (state.status === "pending") {
    return state.attemptCount === 0
      && state.lastAttemptAt === null
      && state.sentAt === null
      && state.lastError === null
      && value.claim === null;
  }
  if (!isAttempt(state.attemptCount) || isoTimestampMilliseconds(state.lastAttemptAt) === null) {
    return false;
  }
  const lastAttemptAt = state.lastAttemptAt as string;

  if (state.status === "retryable" && value.claim !== null) {
    return state.sentAt === null
      && state.lastError === null
      && isDeliveryClaim(value.claim, state.attemptCount, lastAttemptAt);
  }
  if (value.claim !== null) return false;

  if (state.status === "retryable") {
    return state.attemptCount < MAX_DELIVERY_ATTEMPTS
      && state.sentAt === null
      && isRetryableErrorCode(state.lastError);
  }
  if (state.status === "sent") {
    const sentAt = isoTimestampMilliseconds(state.sentAt);
    return sentAt !== null
      && sentAt >= (isoTimestampMilliseconds(lastAttemptAt) as number)
      && state.lastError === null;
  }
  if (state.status === "failed") {
    return state.sentAt === null
      && isPermanentErrorCode(state.lastError)
      && (state.lastError !== "telegram_attempts_exhausted"
        ? state.attemptCount < MAX_DELIVERY_ATTEMPTS
        : state.attemptCount === MAX_DELIVERY_ATTEMPTS);
  }
  return false;
}

export function createPendingForensicTelegramDelivery(input: {
  jobId: string;
  kind: ForensicTelegramDeliveryJobKind;
  payload: TelegramMessagePayloadV1;
  effect: TelegramDeliveryEffectV1;
}): ForensicTelegramDeliveryV1 {
  if (!isBoundedNonEmptyString(input.jobId, MAX_IDENTIFIER_LENGTH)) {
    throw new RangeError("jobId must be a non-empty bounded string");
  }
  if (!isTelegramMessagePayloadV1(input.payload)) throw new TypeError("Invalid Telegram message payload");
  if (!isTelegramDeliveryEffectV1(input.effect)) throw new TypeError("Invalid Telegram delivery effect");
  if (input.effect !== null && input.kind !== "incoming_deposit_check") {
    throw new TypeError("Incoming Telegram delivery effect requires an incoming_deposit_check job");
  }
  return {
    version: "forensic-telegram-delivery-v1",
    payload: {
      version: "telegram-message-payload-v1",
      chatId: input.payload.chatId,
      text: input.payload.text,
      parseMode: input.payload.parseMode,
      replyMarkup: input.payload.replyMarkup
    },
    effect: input.effect === null ? null : {
      kind: "incoming_user_alert",
      watchedWalletId: input.effect.watchedWalletId,
      incomingTxHash: input.effect.incomingTxHash
    },
    state: {
      status: "pending",
      attemptCount: 0,
      lastAttemptAt: null,
      sentAt: null,
      lastError: null,
      messageFingerprint: fingerprintTelegramMessagePayload(input.payload)
    },
    claim: null
  };
}

function reconstructDelivery(
  delivery: ForensicTelegramDeliveryV1,
  state: ForensicTelegramDeliveryV1["state"],
  claim: ForensicTelegramDeliveryV1["claim"]
): ForensicTelegramDeliveryV1 {
  return {
    version: "forensic-telegram-delivery-v1",
    payload: {
      version: "telegram-message-payload-v1",
      chatId: delivery.payload.chatId,
      text: delivery.payload.text,
      parseMode: delivery.payload.parseMode,
      replyMarkup: delivery.payload.replyMarkup
    },
    effect: delivery.effect === null ? null : {
      kind: "incoming_user_alert",
      watchedWalletId: delivery.effect.watchedWalletId,
      incomingTxHash: delivery.effect.incomingTxHash
    },
    state: {
      status: state.status,
      attemptCount: state.attemptCount,
      lastAttemptAt: state.lastAttemptAt,
      sentAt: state.sentAt,
      lastError: state.lastError,
      messageFingerprint: state.messageFingerprint
    },
    claim: claim === null ? null : {
      token: claim.token,
      attempt: claim.attempt,
      claimedAt: claim.claimedAt,
      leaseExpiresAt: claim.leaseExpiresAt
    }
  };
}

function retryAtMilliseconds(delivery: ForensicTelegramDeliveryV1): number | null {
  if (delivery.state.status !== "retryable" || delivery.claim !== null) return null;
  const delay = RETRY_BACKOFF_MS[delivery.state.attemptCount - 1];
  const lastAttemptAt = isoTimestampMilliseconds(delivery.state.lastAttemptAt);
  return delay === undefined || lastAttemptAt === null ? null : lastAttemptAt + delay;
}

export function isTelegramDeliveryDue(
  delivery: ForensicTelegramDeliveryV1,
  now: Date,
  jobKind?: ForensicTelegramDeliveryJobKind
): boolean {
  if (!isForensicTelegramDeliveryV1(delivery, jobKind)) return false;
  const nowMilliseconds = dateMilliseconds(now, "now");
  if (delivery.state.status === "pending") return true;
  if (delivery.state.status !== "retryable") return false;
  if (delivery.claim !== null) {
    return nowMilliseconds >= (isoTimestampMilliseconds(delivery.claim.leaseExpiresAt) as number);
  }
  const retryAt = retryAtMilliseconds(delivery);
  return retryAt !== null && nowMilliseconds >= retryAt;
}

export function transitionTelegramDeliveryToClaimed(
  delivery: ForensicTelegramDeliveryV1,
  input: { token: string; claimedAt: Date },
  jobKind?: ForensicTelegramDeliveryJobKind
): ForensicTelegramDeliveryV1 {
  if (!isForensicTelegramDeliveryV1(delivery, jobKind)) {
    throw new TypeError("Invalid forensic Telegram delivery");
  }
  if (!isClaimToken(input.token)) {
    throw new RangeError("claim token must provide at least 128 bits of bounded base64url encoding space");
  }
  const claimedAtMilliseconds = dateMilliseconds(input.claimedAt, "claimedAt");
  if (!isTelegramDeliveryDue(delivery, input.claimedAt, jobKind)) {
    throw new RangeError("Telegram delivery is not due");
  }
  if (delivery.state.attemptCount >= MAX_DELIVERY_ATTEMPTS) {
    return reconstructDelivery(delivery, {
      status: "failed",
      attemptCount: delivery.state.attemptCount,
      lastAttemptAt: delivery.state.lastAttemptAt,
      sentAt: delivery.state.sentAt,
      lastError: "telegram_attempts_exhausted",
      messageFingerprint: delivery.state.messageFingerprint
    }, null);
  }

  const attempt = delivery.state.attemptCount + 1;
  const claimedAt = new Date(claimedAtMilliseconds).toISOString();
  return reconstructDelivery(delivery, {
    status: "retryable",
    attemptCount: attempt,
    lastAttemptAt: claimedAt,
    sentAt: null,
    lastError: null,
    messageFingerprint: delivery.state.messageFingerprint
  }, {
    token: input.token,
    attempt,
    claimedAt,
    leaseExpiresAt: new Date(claimedAtMilliseconds + CLAIM_LEASE_MS).toISOString()
  });
}

export function transitionTelegramDeliveryToSettled(
  delivery: ForensicTelegramDeliveryV1,
  input: {
    token: string;
    attempt: number;
    settledAt: Date;
    outcome: "sent" | "retryable" | "failed";
    errorCode?: TelegramDeliveryErrorCode | null;
  },
  jobKind?: ForensicTelegramDeliveryJobKind
): ForensicTelegramDeliveryV1 {
  if (!isForensicTelegramDeliveryV1(delivery, jobKind)
    || delivery.state.status !== "retryable"
    || delivery.claim === null) {
    throw new TypeError("Telegram delivery has no active claim");
  }
  if (delivery.claim.token !== input.token || delivery.claim.attempt !== input.attempt) {
    throw new RangeError("Telegram delivery claim does not match");
  }
  const settledAtMilliseconds = dateMilliseconds(input.settledAt, "settledAt");
  const lastAttemptAt = isoTimestampMilliseconds(delivery.state.lastAttemptAt) as number;
  if (settledAtMilliseconds < lastAttemptAt) throw new RangeError("settledAt precedes lastAttemptAt");
  if (input.outcome !== "sent" && input.outcome !== "retryable" && input.outcome !== "failed") {
    throw new TypeError("Invalid Telegram delivery settlement outcome");
  }

  const terminalExhausted = (): ForensicTelegramDeliveryV1 => reconstructDelivery(delivery, {
    status: "failed",
    attemptCount: delivery.state.attemptCount,
    lastAttemptAt: delivery.state.lastAttemptAt,
    sentAt: null,
    lastError: "telegram_attempts_exhausted",
    messageFingerprint: delivery.state.messageFingerprint
  }, null);

  switch (input.outcome) {
    case "sent":
      return reconstructDelivery(delivery, {
        status: "sent",
        attemptCount: delivery.state.attemptCount,
        lastAttemptAt: delivery.state.lastAttemptAt,
        sentAt: new Date(settledAtMilliseconds).toISOString(),
        lastError: null,
        messageFingerprint: delivery.state.messageFingerprint
      }, null);
    case "retryable":
      if (input.attempt >= MAX_DELIVERY_ATTEMPTS) return terminalExhausted();
      if (!isRetryableErrorCode(input.errorCode)) {
        throw new TypeError("Invalid retryable Telegram error code");
      }
      return reconstructDelivery(delivery, {
        status: "retryable",
        attemptCount: delivery.state.attemptCount,
        lastAttemptAt: delivery.state.lastAttemptAt,
        sentAt: null,
        lastError: input.errorCode,
        messageFingerprint: delivery.state.messageFingerprint
      }, null);
    case "failed":
      if (input.attempt >= MAX_DELIVERY_ATTEMPTS) return terminalExhausted();
      if (!isPermanentErrorCode(input.errorCode)
        || input.errorCode === "telegram_attempts_exhausted") {
        throw new TypeError("Invalid permanent Telegram error code");
      }
      return reconstructDelivery(delivery, {
        status: "failed",
        attemptCount: delivery.state.attemptCount,
        lastAttemptAt: delivery.state.lastAttemptAt,
        sentAt: null,
        lastError: input.errorCode,
        messageFingerprint: delivery.state.messageFingerprint
      }, null);
    default:
      return assertNever(input.outcome);
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Invalid Telegram delivery settlement outcome: ${String(value)}`);
}

function numericErrorField(error: unknown, key: string): number | null {
  if (!isRecord(error)) return null;
  const value = error[key];
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

export function classifyTelegramDeliveryError(error: unknown):
  | { outcome: "retryable"; errorCode: TelegramDeliveryRetryableErrorCode }
  | { outcome: "failed"; errorCode: TelegramDeliveryPermanentErrorCode } {
  const name = isRecord(error) && typeof error.name === "string" ? error.name : null;
  const code = isRecord(error) && typeof error.code === "string" ? error.code.toUpperCase() : null;
  const status = numericErrorField(error, "error_code")
    ?? numericErrorField(error, "status")
    ?? numericErrorField(error, "statusCode");

  if (name === "AbortError" || code === "ABORT_ERR") {
    return { outcome: "retryable", errorCode: "telegram_timeout" };
  }
  if (status === 429) return { outcome: "retryable", errorCode: "telegram_rate_limited" };
  if (status !== null && status >= 500) {
    return { outcome: "retryable", errorCode: "telegram_server_error" };
  }
  if (status === 403) return { outcome: "failed", errorCode: "telegram_chat_forbidden" };
  if (status !== null && status >= 400 && status < 500) {
    return { outcome: "failed", errorCode: "telegram_bad_request" };
  }
  if (code !== null && /^(EAI_AGAIN|ECONN|ENET|EHOST|ETIMEDOUT|UND_ERR)/.test(code)) {
    return { outcome: "retryable", errorCode: "telegram_network_error" };
  }
  return { outcome: "retryable", errorCode: "telegram_unknown_retryable" };
}

export function isRecoveredForensicDeliveryIntentV1(
  value: unknown
): value is RecoveredForensicDeliveryIntentV1 {
  if (!isRecord(value)
    || !hasExactOwnKeys(value, [
      "version",
      "kind",
      "createdAt",
      "reasonCode",
      "preparationStatus",
      "preparationAttemptCount",
      "lastPreparationAttemptAt",
      "nextPreparationAttemptAt",
      "lastPreparationError"
    ])
    || value.version !== "recovered-forensic-delivery-intent-v1"
    || value.kind !== "stale_failure"
    || isoTimestampMilliseconds(value.createdAt) === null
    || typeof value.reasonCode !== "string"
    || !recoveredIntentReasonCodes.has(value.reasonCode)
    || !Number.isInteger(value.preparationAttemptCount)
    || (value.preparationAttemptCount as number) < 0
    || (value.preparationAttemptCount as number) > MAX_DELIVERY_ATTEMPTS) {
    return false;
  }
  const attemptCount = value.preparationAttemptCount as number;
  if (value.preparationStatus === "pending") {
    return attemptCount === 0
      && value.lastPreparationAttemptAt === null
      && value.nextPreparationAttemptAt === null
      && value.lastPreparationError === null;
  }
  const createdAt = isoTimestampMilliseconds(value.createdAt) as number;
  const lastAttemptAt = isoTimestampMilliseconds(value.lastPreparationAttemptAt);
  if (lastAttemptAt === null || lastAttemptAt < createdAt) return false;
  if (value.preparationStatus === "failed") {
    return attemptCount === MAX_DELIVERY_ATTEMPTS
      && value.nextPreparationAttemptAt === null
      && value.lastPreparationError === "stale_intent_preparation_attempts_exhausted";
  }
  if (value.preparationStatus !== "retryable"
    || attemptCount < 1
    || attemptCount >= MAX_DELIVERY_ATTEMPTS
    || typeof value.lastPreparationError !== "string"
    || !staleIntentRetryableErrorCodes.has(
      value.lastPreparationError as RecoveredForensicDeliveryIntentPreparationErrorCode
    )) {
    return false;
  }
  const nextAttemptAt = isoTimestampMilliseconds(value.nextPreparationAttemptAt);
  const delay = RETRY_BACKOFF_MS[attemptCount - 1];
  return nextAttemptAt !== null && delay !== undefined && nextAttemptAt - lastAttemptAt === delay;
}

export function isRecoveredForensicDeliveryIntentDue(
  intent: RecoveredForensicDeliveryIntentV1,
  now: Date
): boolean {
  if (!isRecoveredForensicDeliveryIntentV1(intent)) return false;
  const nowMilliseconds = dateMilliseconds(now, "now");
  if (intent.preparationStatus === "pending") {
    return nowMilliseconds >= (isoTimestampMilliseconds(intent.createdAt) as number);
  }
  if (intent.preparationStatus !== "retryable") return false;
  return nowMilliseconds >= (isoTimestampMilliseconds(intent.nextPreparationAttemptAt) as number);
}

export function settleRecoveredForensicDeliveryIntentPreparation(
  intent: RecoveredForensicDeliveryIntentV1,
  input: {
    attemptedAt: Date;
    errorCode: Exclude<
      RecoveredForensicDeliveryIntentPreparationErrorCode,
      "stale_intent_preparation_attempts_exhausted"
    >;
  }
): RecoveredForensicDeliveryIntentV1 {
  if (!isRecoveredForensicDeliveryIntentV1(intent)) throw new TypeError("Invalid recovered delivery intent");
  if (!staleIntentRetryableErrorCodes.has(input.errorCode)) {
    throw new TypeError("Invalid recovered delivery preparation error code");
  }
  if (!isRecoveredForensicDeliveryIntentDue(intent, input.attemptedAt)) {
    throw new RangeError("Recovered delivery intent is not due");
  }
  const attemptedAtMilliseconds = dateMilliseconds(input.attemptedAt, "attemptedAt");
  const attemptCount = intent.preparationAttemptCount + 1;
  const lastPreparationAttemptAt = new Date(attemptedAtMilliseconds).toISOString();
  if (attemptCount >= MAX_DELIVERY_ATTEMPTS) {
    return {
      version: "recovered-forensic-delivery-intent-v1",
      kind: "stale_failure",
      createdAt: intent.createdAt,
      reasonCode: intent.reasonCode,
      preparationStatus: "failed",
      preparationAttemptCount: MAX_DELIVERY_ATTEMPTS,
      lastPreparationAttemptAt,
      nextPreparationAttemptAt: null,
      lastPreparationError: "stale_intent_preparation_attempts_exhausted"
    };
  }
  return {
    version: "recovered-forensic-delivery-intent-v1",
    kind: "stale_failure",
    createdAt: intent.createdAt,
    reasonCode: intent.reasonCode,
    preparationStatus: "retryable",
    preparationAttemptCount: attemptCount,
    lastPreparationAttemptAt,
    nextPreparationAttemptAt: new Date(
      attemptedAtMilliseconds + RETRY_BACKOFF_MS[attemptCount - 1]
    ).toISOString(),
    lastPreparationError: input.errorCode
  };
}
