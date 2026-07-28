import { describe, expect, it, vi } from "vitest";
import {
  runUnifiedLifecycleNotificationCycle,
  type UnifiedLifecycleNotificationClaimV1,
  type UnifiedLifecycleNotificationRepository,
  type UnifiedLifecycleNotificationSettlementV1
} from "../../src/unifiedCheck/lifecycleNotification";

const address = "TEFjfSWdhHxzchgveQqFteiz1XhUcHFn52";
const now = new Date("2026-07-28T10:06:00.000Z");

function claim(
  kind: UnifiedLifecycleNotificationClaimV1["kind"] =
    "FAILED_TECHNICAL_RUNTIME_HANDOFF"
): UnifiedLifecycleNotificationClaimV1 {
  return {
    notificationId: `request-1:${kind}`,
    leaseToken: "lease-1",
    attempt: 1,
    kind,
    copyVersion: "unified-lifecycle-copy-v1",
    request: {
      id: "request-1",
      chatId: "100",
      messageThreadId: "",
      locale: "ru",
      subjectAddress: address,
      runStatus: kind === "LONG_RUNNING" ? "RUNNING" : "FAILED_TECHNICAL",
      requestStatus: kind === "LONG_RUNNING" ? "ATTACHED" : "FAILED_TECHNICAL",
      statusReason: kind === "LONG_RUNNING" ? null : "runtime_handoff_unavailable"
    }
  };
}

function repository(input: {
  claim?: UnifiedLifecycleNotificationClaimV1 | null;
  sendable?: boolean;
  expired?: number;
} = {}): UnifiedLifecycleNotificationRepository & {
  settlements: UnifiedLifecycleNotificationSettlementV1[];
} {
  const settlements: UnifiedLifecycleNotificationSettlementV1[] = [];
  let next = input.claim === undefined ? claim() : input.claim;
  return {
    settlements,
    markExpiredLeasesUnknown: async () => input.expired ?? 0,
    claimNext: async () => {
      const result = next;
      next = null;
      return result;
    },
    isStillSendable: async () => input.sendable ?? true,
    settle: async (settlement) => {
      settlements.push(settlement);
      return true;
    }
  };
}

describe("Unified lifecycle notification worker", () => {
  it("sends the retry button and confirms delivery", async () => {
    const repo = repository();
    await expect(runUnifiedLifecycleNotificationCycle({
      repository: repo,
      now: () => now,
      leaseToken: () => "lease-1",
      leaseMs: 30_000,
      limit: 10,
      sendTelegram: async (message) => {
        expect(message.payload.replyMarkup?.inline_keyboard[0][0]).toEqual({
          text: "Повторить",
          callback_data: `check:addr:${address}`
        });
        expect(message.payload.text).not.toMatch(/\d+%|score|оценка\s*\d/iu);
        return { kind: "confirmed", telegramMessageId: "501" };
      }
    })).resolves.toEqual({
      claimed: 1,
      settled: 1,
      expiredLeasesMarkedUnknown: 0
    });
    expect(repo.settlements[0]).toMatchObject({
      status: "SENT_CONFIRMED",
      telegramMessageId: "501"
    });
  });

  it("settles retryable, permanent and ambiguous outcomes", async () => {
    const cases = [
      {
        result: {
          kind: "rejected_retryable" as const,
          code: "telegram_rate_limited",
          retryAt: "2026-07-28T10:07:00.000Z"
        },
        status: "RETRYABLE"
      },
      {
        result: {
          kind: "rejected_permanent" as const,
          code: "telegram_chat_missing"
        },
        status: "CANCELLED"
      },
      {
        result: {
          kind: "ambiguous" as const,
          code: "transport_timeout_after_handoff"
        },
        status: "DELIVERY_UNKNOWN"
      }
    ];
    for (const testCase of cases) {
      const repo = repository();
      await runUnifiedLifecycleNotificationCycle({
        repository: repo,
        now: () => now,
        leaseToken: () => "lease-1",
        leaseMs: 30_000,
        limit: 1,
        sendTelegram: async () => testCase.result
      });
      expect(repo.settlements[0].status).toBe(testCase.status);
    }
  });

  it("cancels stale progress before Telegram handoff", async () => {
    const repo = repository({ claim: claim("LONG_RUNNING"), sendable: false });
    const sendTelegram = vi.fn();
    await runUnifiedLifecycleNotificationCycle({
      repository: repo,
      now: () => now,
      leaseToken: () => "lease-1",
      leaseMs: 30_000,
      limit: 1,
      sendTelegram
    });
    expect(sendTelegram).not.toHaveBeenCalled();
    expect(repo.settlements[0]).toMatchObject({
      status: "CANCELLED",
      errorCode: "unified_lifecycle_no_longer_applicable"
    });
  });

  it("marks expired leases unknown and never auto-resends them", async () => {
    const repo = repository({ claim: null, expired: 2 });
    await expect(runUnifiedLifecycleNotificationCycle({
      repository: repo,
      now: () => now,
      leaseToken: () => "lease-1",
      leaseMs: 30_000,
      limit: 10,
      sendTelegram: vi.fn()
    })).resolves.toEqual({
      claimed: 0,
      settled: 0,
      expiredLeasesMarkedUnknown: 2
    });
  });
});
