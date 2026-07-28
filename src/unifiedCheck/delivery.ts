import { fingerprintCanonicalArtifact } from "../forensics/canonicalJson";
import type {
  DeliveryIntentV1,
  ManualUnifiedResendV1,
  UnifiedDeliveryStatus
} from "./contracts";
import type { UnifiedPresentationResultV1 } from "./presentation";
import {
  claimUnifiedDelivery,
  markExpiredUnifiedDeliveryLeasesUnknown,
  settleUnifiedDelivery,
  type UnifiedQueryable
} from "./repository";

export type UnifiedTelegramSendResult =
  | { readonly kind: "confirmed"; readonly telegramMessageId: string }
  | {
      readonly kind: "rejected_retryable";
      readonly code: string;
      readonly retryAt: string;
    }
  | { readonly kind: "rejected_permanent"; readonly code: string }
  | { readonly kind: "ambiguous"; readonly code: string };

export type UnifiedDeliveryClaimV1 = {
  readonly deliveryId: string;
  readonly leaseToken: string;
  readonly attempt: number;
  readonly request: {
    readonly id: string;
    readonly requestCorrelationId: string;
    readonly chatId: string;
    readonly messageThreadId: string;
    readonly locale: "ru" | "en";
    readonly sideEffectPolicy: "authoritative" | "isolated";
  };
  readonly intent: DeliveryIntentV1;
  readonly presentation: UnifiedPresentationResultV1;
};

export type UnifiedDeliverySettlementV1 = {
  readonly deliveryId: string;
  readonly leaseToken: string;
  readonly status: Extract<
    UnifiedDeliveryStatus,
    | "RETRYABLE"
    | "SENT_CONFIRMED"
    | "DELIVERY_UNKNOWN"
    | "BLOCKED_ADMIN"
  >;
  readonly errorCode: string | null;
  readonly retryAt: string | null;
  readonly telegramMessageId: string | null;
};

export type UnifiedDeliveryRepository = {
  markExpiredLeasesUnknown(input: {
    readonly now: Date;
  }): Promise<number>;
  claimNext(input: {
    readonly leaseToken: string;
    readonly leaseMs: number;
    readonly now: Date;
  }): Promise<UnifiedDeliveryClaimV1 | null>;
  settle(input: UnifiedDeliverySettlementV1): Promise<boolean>;
};

const SHA256 = /^[a-f0-9]{64}$/u;

function nonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("unified_delivery_artifact_invalid");
  }
  return value as Record<string, unknown>;
}

function presentationEnvelopeHash(
  presentation: UnifiedPresentationResultV1
): string {
  return fingerprintCanonicalArtifact({
    version: "unified-presentation-envelope-v1",
    manifest: presentation.manifest,
    artifact: presentation.artifact,
    receiptBodyHash: presentation.receiptBodyHash
  });
}

function presentationReceiptBodyHash(
  presentation: UnifiedPresentationResultV1
): string {
  const {
    presentationHash: _presentationHash,
    ...body
  } = presentation.receipt;
  return fingerprintCanonicalArtifact(body);
}

function claimIsBound(claim: UnifiedDeliveryClaimV1): boolean {
  const { intent, presentation, request } = claim;
  return (
    nonEmpty(claim.deliveryId) &&
    nonEmpty(claim.leaseToken) &&
    Number.isSafeInteger(claim.attempt) &&
    claim.attempt > 0 &&
    request.sideEffectPolicy === "authoritative" &&
    intent.version === "delivery-intent-v1" &&
    intent.schemaVersion === 1 &&
    intent.logicalRequestId === request.id &&
    intent.sideEffectPolicy === request.sideEffectPolicy &&
    intent.presentationHash === presentation.presentationHash &&
    SHA256.test(intent.presentationHash) &&
    presentation.presentationHash === presentationEnvelopeHash(presentation) &&
    presentation.receiptBodyHash === presentationReceiptBodyHash(presentation) &&
    presentation.receipt.presentationHash === presentation.presentationHash &&
    presentation.receipt.reportHash === presentation.manifest.reportHash &&
    presentation.receipt.omittedCanonicalFactIds.length === 0 &&
    presentation.manifest.locale === request.locale &&
    presentation.artifact.locale === request.locale &&
    presentation.artifact.reportHash === presentation.manifest.reportHash &&
    presentation.artifact.htmlHash ===
      fingerprintCanonicalArtifact(presentation.artifact.html) &&
    presentation.payload.parseMode === "HTML" &&
    presentation.payload.text === presentation.artifact.html &&
    intent.payloadHash ===
      fingerprintCanonicalArtifact(presentation.payload)
  );
}

async function settle(
  repository: UnifiedDeliveryRepository,
  claim: UnifiedDeliveryClaimV1,
  settlement: Omit<
    UnifiedDeliverySettlementV1,
    "deliveryId" | "leaseToken"
  >
): Promise<void> {
  const updated = await repository.settle({
    deliveryId: claim.deliveryId,
    leaseToken: claim.leaseToken,
    ...settlement
  });
  if (!updated) throw new Error("unified_delivery_settle_conflict");
}

export async function runUnifiedDeliveryCycle(input: {
  readonly repository: UnifiedDeliveryRepository;
  readonly now: () => Date;
  readonly leaseToken: () => string;
  readonly leaseMs: number;
  readonly sendTimeoutMs?: number;
  readonly limit: number;
  readonly sendTelegram: (input: {
    readonly chatId: string;
    readonly messageThreadId: string;
    readonly payload: UnifiedPresentationResultV1["payload"];
  }, signal: AbortSignal) => Promise<UnifiedTelegramSendResult>;
}): Promise<{
  claimed: number;
  settled: number;
  expiredLeasesMarkedUnknown: number;
}> {
  const sendTimeoutMs = input.sendTimeoutMs ?? input.leaseMs;
  if (
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 100 ||
    !Number.isSafeInteger(input.leaseMs) ||
    input.leaseMs < 1 ||
    !Number.isSafeInteger(sendTimeoutMs) ||
    sendTimeoutMs < 1 ||
    sendTimeoutMs > input.leaseMs
  ) {
    throw new TypeError("unified_delivery_cycle_input_invalid");
  }
  let claimed = 0;
  let settled = 0;
  const expiredLeasesMarkedUnknown =
    await input.repository.markExpiredLeasesUnknown({ now: input.now() });
  for (let index = 0; index < input.limit; index += 1) {
    const now = input.now();
    const leaseToken = input.leaseToken();
    if (!nonEmpty(leaseToken) || Number.isNaN(now.getTime())) {
      throw new TypeError("unified_delivery_cycle_input_invalid");
    }
    const claim = await input.repository.claimNext({
      leaseToken,
      leaseMs: input.leaseMs,
      now
    });
    if (claim === null) break;
    claimed += 1;
    if (!claimIsBound(claim) || claim.leaseToken !== leaseToken) {
      await settle(input.repository, claim, {
        status: "BLOCKED_ADMIN",
        errorCode: "unified_delivery_binding_invalid",
        retryAt: null,
        telegramMessageId: null
      });
      settled += 1;
      continue;
    }

    let result: UnifiedTelegramSendResult;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), sendTimeoutMs);
    try {
      result = await input.sendTelegram({
        chatId: claim.request.chatId,
        messageThreadId: claim.request.messageThreadId,
        payload: claim.presentation.payload
      }, controller.signal);
    } catch {
      result = {
        kind: "ambiguous",
        code: controller.signal.aborted
          ? "transport_timeout_after_handoff"
          : "unclassified_transport_exception"
      };
    } finally {
      clearTimeout(timeout);
    }

    if (result.kind === "confirmed") {
      await settle(input.repository, claim, {
        status: "SENT_CONFIRMED",
        errorCode: null,
        retryAt: null,
        telegramMessageId: result.telegramMessageId
      });
    } else if (result.kind === "rejected_retryable") {
      const retryAt = new Date(result.retryAt);
      if (
        !nonEmpty(result.code) ||
        Number.isNaN(retryAt.getTime()) ||
        retryAt.getTime() <= now.getTime()
      ) {
        await settle(input.repository, claim, {
          status: "BLOCKED_ADMIN",
          errorCode: "unified_delivery_retry_contract_invalid",
          retryAt: null,
          telegramMessageId: null
        });
      } else {
        await settle(input.repository, claim, {
          status: "RETRYABLE",
          errorCode: result.code,
          retryAt: retryAt.toISOString(),
          telegramMessageId: null
        });
      }
    } else if (result.kind === "rejected_permanent") {
      await settle(input.repository, claim, {
        status: "BLOCKED_ADMIN",
        errorCode: result.code,
        retryAt: null,
        telegramMessageId: null
      });
    } else {
      await settle(input.repository, claim, {
        status: "DELIVERY_UNKNOWN",
        errorCode: result.code,
        retryAt: null,
        telegramMessageId: null
      });
    }
    settled += 1;
  }
  return { claimed, settled, expiredLeasesMarkedUnknown };
}

export function createPostgresUnifiedDeliveryRepository(
  db: UnifiedQueryable,
  options: { readonly runtimeCommit: string }
): UnifiedDeliveryRepository {
  return {
    markExpiredLeasesUnknown: (input) =>
      markExpiredUnifiedDeliveryLeasesUnknown(db, input),
    async claimNext(input) {
      const row = await claimUnifiedDelivery(db, {
        ...input,
        runtimeCommit: options.runtimeCommit
      });
      if (row === null) return null;
      try {
        const request = record((await db.query(
          "select * from unified_check_requests where id = $1",
          [row.request_id]
        )).rows[0]);
        const envelopeRow = record((await db.query(
          `select artifact_json from unified_check_artifacts
            where sha256 = $1 and kind = 'presentation_envelope'`,
          [row.presentation_sha256]
        )).rows[0]);
        const envelope = record(envelopeRow.artifact_json);
        if (envelope.version !== "unified-presentation-envelope-v1") {
          throw new Error("unified_delivery_presentation_invalid");
        }
        const receiptRows = (await db.query(
          `select artifact_json from unified_check_artifacts
            where kind = 'presentation_completeness_receipt'
              and artifact_json->>'presentationHash' = $1`,
          [row.presentation_sha256]
        )).rows;
        const intentRows = (await db.query(
          `select artifact_json from unified_check_artifacts
            where kind = 'delivery_intent'
              and artifact_json->>'logicalRequestId' = $1
              and artifact_json->>'presentationHash' = $2`,
          [row.request_id, row.presentation_sha256]
        )).rows;
        if (receiptRows.length !== 1 || intentRows.length !== 1) {
          throw new Error("unified_delivery_linked_artifact_missing");
        }
        const manifest = envelope.manifest as
          UnifiedPresentationResultV1["manifest"];
        const artifact = envelope.artifact as
          UnifiedPresentationResultV1["artifact"];
        const receipt = receiptRows[0]!.artifact_json as
          UnifiedPresentationResultV1["receipt"];
        const intent = intentRows[0]!.artifact_json as DeliveryIntentV1;
        const presentationHash = String(row.presentation_sha256);
        return {
          deliveryId: String(row.id),
          leaseToken: String(row.lease_token),
          attempt: Number(row.attempt_count),
          request: {
            id: String(request.id),
            requestCorrelationId: String(request.request_correlation_id),
            chatId: String(request.chat_id),
            messageThreadId: String(request.message_thread_id),
            locale: request.locale as "ru" | "en",
            sideEffectPolicy: request.side_effect_policy as
              "authoritative" | "isolated"
          },
          intent,
          presentation: {
            manifest,
            artifact,
            receipt,
            receiptBodyHash: String(envelope.receiptBodyHash),
            presentationHash,
            payload: { text: artifact.html, parseMode: "HTML" }
          }
        };
      } catch {
        await settleUnifiedDelivery(db, {
          deliveryId: String(row.id),
          leaseToken: String(row.lease_token),
          status: "BLOCKED_ADMIN",
          lastError: "unified_delivery_linked_artifact_invalid"
        });
        return null;
      }
    },
    async settle(input) {
      return (await settleUnifiedDelivery(db, {
        deliveryId: input.deliveryId,
        leaseToken: input.leaseToken,
        status: input.status,
        lastError: input.errorCode,
        telegramMessageId: input.telegramMessageId,
        retryAt: input.retryAt
      })) !== null;
    }
  };
}

export function buildManualUnifiedResend(input: {
  readonly operationId: string;
  readonly actorId: string;
  readonly requestedAt: string;
  readonly originalDeliveryId: string;
  readonly originalStatus: UnifiedDeliveryStatus;
  readonly originalPresentationHash: string;
  readonly warningPresentationHash: string;
}): ManualUnifiedResendV1 {
  if (
    input.originalStatus !== "DELIVERY_UNKNOWN" ||
    !nonEmpty(input.operationId) ||
    !nonEmpty(input.actorId) ||
    !nonEmpty(input.originalDeliveryId) ||
    Number.isNaN(Date.parse(input.requestedAt)) ||
    !SHA256.test(input.originalPresentationHash) ||
    !SHA256.test(input.warningPresentationHash) ||
    input.originalPresentationHash === input.warningPresentationHash
  ) {
    throw new Error("unified_manual_resend_requires_warning_presentation");
  }
  return {
    version: "manual-unified-resend-v1",
    schemaVersion: 1,
    operationId: input.operationId,
    actorId: input.actorId,
    requestedAt: new Date(input.requestedAt).toISOString(),
    originalDeliveryId: input.originalDeliveryId,
    originalPresentationHash: input.originalPresentationHash,
    warningPresentationHash: input.warningPresentationHash,
    warningCode: "manual_resend_after_delivery_unknown"
  };
}
