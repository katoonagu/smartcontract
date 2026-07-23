import { describe, expect, it, vi } from "vitest";
import { fingerprintCanonicalArtifact } from "../../src/forensics/canonicalJson";
import {
  buildManualUnifiedResend,
  runUnifiedDeliveryCycle,
  type UnifiedDeliveryClaimV1,
  type UnifiedDeliveryRepository,
  type UnifiedTelegramSendResult
} from "../../src/unifiedCheck/delivery";
import {
  claimUnifiedDelivery,
  settleUnifiedDelivery
} from "../../src/unifiedCheck/repository";

function claim(): UnifiedDeliveryClaimV1 {
  const manifest = {
    version: "presentation-manifest-v1" as const,
    schemaVersion: 1 as const,
    reportHash: "a".repeat(64),
    rendererVersion: "unified-telegram-renderer-v1" as const,
    templateVersion: "unified-wallet-dossier-template-v1" as const,
    locale: "ru" as const
  };
  const html = "<b>Готово</b>";
  const artifact = {
    version: "presentation-artifact-v1" as const,
    schemaVersion: 1 as const,
    reportHash: manifest.reportHash,
    locale: manifest.locale,
    html,
    htmlHash: fingerprintCanonicalArtifact(html)
  };
  const receiptBody = {
    version: "presentation-completeness-receipt-v1" as const,
    schemaVersion: 1 as const,
    reportHash: manifest.reportHash,
    factInventoryHash: "b".repeat(64),
    omittedCanonicalFactIds: [] as const,
    canonicalFactCount: 0,
    canonicalFactIdsHash: fingerprintCanonicalArtifact([]),
    riskClasses: [] as const,
    sections: [] as const
  };
  const receiptBodyHash = fingerprintCanonicalArtifact(receiptBody);
  const presentationHash = fingerprintCanonicalArtifact({
    version: "unified-presentation-envelope-v1",
    manifest,
    artifact,
    receiptBodyHash
  });
  const payload = { text: html, parseMode: "HTML" as const };
  return {
    deliveryId: "delivery-1",
    leaseToken: "lease-1",
    attempt: 1,
    request: {
      id: "request-1",
      requestCorrelationId: "correlation-1",
      chatId: "chat-1",
      messageThreadId: "",
      locale: "ru",
      sideEffectPolicy: "authoritative"
    },
    intent: {
      version: "delivery-intent-v1",
      schemaVersion: 1,
      logicalRequestId: "request-1",
      presentationHash,
      payloadHash: fingerprintCanonicalArtifact(payload),
      sideEffectPolicy: "authoritative"
    },
    presentation: {
      manifest,
      artifact,
      receipt: {
        ...receiptBody,
        presentationHash,
      },
      receiptBodyHash,
      presentationHash,
      payload
    }
  };
}

function repository(
  deliveryClaim: UnifiedDeliveryClaimV1 | null = claim()
): UnifiedDeliveryRepository {
  let current = deliveryClaim;
  return {
    claimNext: vi.fn(async () => {
      const selected = current;
      current = null;
      return selected;
    }),
    settle: vi.fn(async () => true)
  };
}

describe("Unified request-scoped Telegram delivery", () => {
  it.each<{
    result: UnifiedTelegramSendResult;
    status: string;
  }>([
    {
      result: { kind: "confirmed", telegramMessageId: "telegram-1" },
      status: "SENT_CONFIRMED"
    },
    {
      result: {
        kind: "rejected_retryable",
        code: "rate_limited",
        retryAt: "2026-07-23T18:00:00.000Z"
      },
      status: "RETRYABLE"
    },
    {
      result: { kind: "rejected_permanent", code: "chat_not_found" },
      status: "BLOCKED_ADMIN"
    },
    {
      result: { kind: "ambiguous", code: "transport_reset_after_handoff" },
      status: "DELIVERY_UNKNOWN"
    }
  ])("settles $result.kind without guessing transport state", async ({
    result,
    status
  }) => {
    const store = repository();
    const send = vi.fn(async () => result);
    const summary = await runUnifiedDeliveryCycle({
      repository: store,
      now: () => new Date("2026-07-23T17:00:00.000Z"),
      leaseToken: () => "lease-1",
      leaseMs: 30_000,
      limit: 1,
      sendTelegram: send
    });
    expect(summary).toMatchObject({ claimed: 1, settled: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(store.settle).toHaveBeenCalledWith(
      expect.objectContaining({ status })
    );
  });

  it("treats an unexpected sender throw as ambiguous and never retries it in-cycle", async () => {
    const store = repository();
    const send = vi.fn(async () => {
      throw new Error("socket_reset");
    });
    await runUnifiedDeliveryCycle({
      repository: store,
      now: () => new Date("2026-07-23T17:00:00.000Z"),
      leaseToken: () => "lease-1",
      leaseMs: 30_000,
      limit: 5,
      sendTelegram: send
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(store.settle).toHaveBeenCalledWith(expect.objectContaining({
      status: "DELIVERY_UNKNOWN",
      errorCode: "unclassified_transport_exception"
    }));
  });

  it("blocks a forged presentation or isolated side effect before transport", async () => {
    const forged = claim();
    const store = repository({
      ...forged,
      presentation: {
        ...forged.presentation,
        payload: { ...forged.presentation.payload, text: "tampered" }
      }
    });
    const send = vi.fn();
    await runUnifiedDeliveryCycle({
      repository: store,
      now: () => new Date("2026-07-23T17:00:00.000Z"),
      leaseToken: () => "lease-1",
      leaseMs: 30_000,
      limit: 1,
      sendTelegram: send
    });
    expect(send).not.toHaveBeenCalled();
    expect(store.settle).toHaveBeenCalledWith(expect.objectContaining({
      status: "BLOCKED_ADMIN",
      errorCode: "unified_delivery_binding_invalid"
    }));
  });

  it("creates manual resend as a distinct audited operation with warning", () => {
    const original = claim();
    const warningPresentationHash = "c".repeat(64);
    const operation = buildManualUnifiedResend({
      operationId: "manual-1",
      actorId: "admin-1",
      requestedAt: "2026-07-23T17:30:00.000Z",
      originalDeliveryId: original.deliveryId,
      originalStatus: "DELIVERY_UNKNOWN",
      originalPresentationHash: original.presentation.presentationHash,
      warningPresentationHash
    });
    expect(operation).toMatchObject({
      operationId: "manual-1",
      warningCode: "manual_resend_after_delivery_unknown",
      warningPresentationHash
    });
    expect(operation.originalPresentationHash)
      .not.toBe(operation.warningPresentationHash);
    expect(() => buildManualUnifiedResend({
      ...operation,
      originalStatus: "DELIVERY_UNKNOWN",
      warningPresentationHash: operation.originalPresentationHash
    })).toThrow("unified_manual_resend_requires_warning_presentation");
  });

  it("claims only due retryable rows and requires an explicit retry timestamp", async () => {
    const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
    const db = {
      async query(sql: string, values: readonly unknown[] = []) {
        calls.push({ sql, values });
        return { rows: [] };
      }
    };
    const now = new Date("2026-07-23T17:00:00.000Z");
    await expect(claimUnifiedDelivery(db, {
      leaseToken: "lease-1",
      leaseMs: 30_000,
      now
    })).resolves.toBeNull();
    expect(calls[0]?.sql).toContain("next_attempt_at <= $3::timestamptz");
    expect(calls[0]?.values[2]).toBe(now.toISOString());
    await expect(settleUnifiedDelivery(db, {
      deliveryId: "delivery-1",
      leaseToken: "lease-1",
      status: "RETRYABLE"
    })).rejects.toThrow("unified_delivery_retry_time_invalid");
  });
});
