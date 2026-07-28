import type { UnifiedTelegramSendResult } from "./delivery";
import type {
  UnifiedQueryable,
  UnifiedTransactionalQueryable
} from "./repository";
import {
  UNIFIED_LIFECYCLE_COPY_VERSION,
  renderUnifiedLifecycleMessage,
  type UnifiedLifecycleNotificationKind
} from "./runtimeHandoffPolicy";

export type UnifiedLifecycleNotificationClaimV1 = Readonly<{
  notificationId: string;
  leaseToken: string;
  attempt: number;
  kind: UnifiedLifecycleNotificationKind;
  copyVersion: typeof UNIFIED_LIFECYCLE_COPY_VERSION;
  request: {
    id: string;
    chatId: string;
    messageThreadId: string;
    locale: "ru" | "en";
    subjectAddress: string;
    runStatus: string;
    requestStatus: string;
    statusReason: string | null;
  };
}>;

export type UnifiedLifecycleNotificationSettlementV1 = Readonly<{
  notificationId: string;
  leaseToken: string;
  status:
    | "RETRYABLE"
    | "SENT_CONFIRMED"
    | "DELIVERY_UNKNOWN"
    | "CANCELLED";
  errorCode: string | null;
  retryAt: string | null;
  telegramMessageId: string | null;
}>;

export type UnifiedLifecycleNotificationRepository = {
  markExpiredLeasesUnknown(input: { now: Date }): Promise<number>;
  claimNext(input: {
    leaseToken: string;
    leaseMs: number;
    now: Date;
  }): Promise<UnifiedLifecycleNotificationClaimV1 | null>;
  isStillSendable(input: {
    notificationId: string;
    leaseToken: string;
  }): Promise<boolean>;
  settle(input: UnifiedLifecycleNotificationSettlementV1): Promise<boolean>;
};

export type UnifiedLifecycleTelegramPayloadV1 = Readonly<{
  text: string;
  parseMode: "HTML";
  replyMarkup?: {
    inline_keyboard: Array<Array<{
      text: string;
      callback_data: string;
    }>>;
  };
}>;

function nonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

async function settle(
  repository: UnifiedLifecycleNotificationRepository,
  claim: UnifiedLifecycleNotificationClaimV1,
  input: Omit<
    UnifiedLifecycleNotificationSettlementV1,
    "notificationId" | "leaseToken"
  >
): Promise<void> {
  const updated = await repository.settle({
    notificationId: claim.notificationId,
    leaseToken: claim.leaseToken,
    ...input
  });
  if (!updated) throw new Error("unified_lifecycle_settle_conflict");
}

function claimIsBound(
  claim: UnifiedLifecycleNotificationClaimV1,
  leaseToken: string
): boolean {
  return nonEmpty(claim.notificationId) &&
    claim.leaseToken === leaseToken &&
    Number.isSafeInteger(claim.attempt) && claim.attempt > 0 &&
    claim.copyVersion === UNIFIED_LIFECYCLE_COPY_VERSION &&
    nonEmpty(claim.request.id) && nonEmpty(claim.request.chatId) &&
    (claim.request.locale === "ru" || claim.request.locale === "en");
}

export async function runUnifiedLifecycleNotificationCycle(input: {
  repository: UnifiedLifecycleNotificationRepository;
  now(): Date;
  leaseToken(): string;
  leaseMs: number;
  sendTimeoutMs?: number;
  limit: number;
  sendTelegram(message: {
    chatId: string;
    messageThreadId: string;
    payload: UnifiedLifecycleTelegramPayloadV1;
  }, signal: AbortSignal): Promise<UnifiedTelegramSendResult>;
}): Promise<{
  claimed: number;
  settled: number;
  expiredLeasesMarkedUnknown: number;
}> {
  const sendTimeoutMs = input.sendTimeoutMs ?? input.leaseMs;
  if (
    !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100 ||
    !Number.isSafeInteger(input.leaseMs) || input.leaseMs < 1 ||
    !Number.isSafeInteger(sendTimeoutMs) || sendTimeoutMs < 1 ||
    sendTimeoutMs > input.leaseMs
  ) throw new TypeError("unified_lifecycle_cycle_input_invalid");

  let claimed = 0;
  let settled = 0;
  const expiredLeasesMarkedUnknown =
    await input.repository.markExpiredLeasesUnknown({ now: input.now() });
  for (let index = 0; index < input.limit; index += 1) {
    const now = input.now();
    const leaseToken = input.leaseToken();
    if (!Number.isFinite(now.getTime()) || !nonEmpty(leaseToken)) {
      throw new TypeError("unified_lifecycle_cycle_input_invalid");
    }
    const claim = await input.repository.claimNext({
      leaseToken,
      leaseMs: input.leaseMs,
      now
    });
    if (claim === null) break;
    claimed += 1;
    if (!claimIsBound(claim, leaseToken)) {
      await settle(input.repository, claim, {
        status: "CANCELLED",
        errorCode: "unified_lifecycle_binding_invalid",
        retryAt: null,
        telegramMessageId: null
      });
      settled += 1;
      continue;
    }
    if (!await input.repository.isStillSendable({
      notificationId: claim.notificationId,
      leaseToken: claim.leaseToken
    })) {
      await settle(input.repository, claim, {
        status: "CANCELLED",
        errorCode: "unified_lifecycle_no_longer_applicable",
        retryAt: null,
        telegramMessageId: null
      });
      settled += 1;
      continue;
    }

    const rendered = renderUnifiedLifecycleMessage({
      kind: claim.kind,
      locale: claim.request.locale,
      address: claim.request.subjectAddress
    });
    const payload: UnifiedLifecycleTelegramPayloadV1 = {
      text: rendered.text,
      parseMode: rendered.parseMode,
      ...(rendered.callbackData === null ? {} : {
        replyMarkup: {
          inline_keyboard: [[{
            text: rendered.buttonText!,
            callback_data: rendered.callbackData
          }]]
        }
      })
    };

    let sendResult: UnifiedTelegramSendResult;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), sendTimeoutMs);
    try {
      sendResult = await input.sendTelegram({
        chatId: claim.request.chatId,
        messageThreadId: claim.request.messageThreadId,
        payload
      }, controller.signal);
    } catch {
      sendResult = {
        kind: "ambiguous",
        code: controller.signal.aborted
          ? "transport_timeout_after_handoff"
          : "unclassified_transport_exception"
      };
    } finally {
      clearTimeout(timeout);
    }

    if (sendResult.kind === "confirmed") {
      await settle(input.repository, claim, {
        status: "SENT_CONFIRMED",
        errorCode: null,
        retryAt: null,
        telegramMessageId: sendResult.telegramMessageId
      });
    } else if (sendResult.kind === "rejected_retryable") {
      const retryAt = new Date(sendResult.retryAt);
      if (!nonEmpty(sendResult.code) || !Number.isFinite(retryAt.getTime()) ||
        retryAt.getTime() <= now.getTime()) {
        await settle(input.repository, claim, {
          status: "CANCELLED",
          errorCode: "unified_lifecycle_retry_contract_invalid",
          retryAt: null,
          telegramMessageId: null
        });
      } else {
        await settle(input.repository, claim, {
          status: "RETRYABLE",
          errorCode: sendResult.code,
          retryAt: retryAt.toISOString(),
          telegramMessageId: null
        });
      }
    } else if (sendResult.kind === "rejected_permanent") {
      await settle(input.repository, claim, {
        status: "CANCELLED",
        errorCode: sendResult.code,
        retryAt: null,
        telegramMessageId: null
      });
    } else {
      await settle(input.repository, claim, {
        status: "DELIVERY_UNKNOWN",
        errorCode: sendResult.code,
        retryAt: null,
        telegramMessageId: null
      });
    }
    settled += 1;
  }
  return { claimed, settled, expiredLeasesMarkedUnknown };
}

function dateIso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) {
    throw new Error("unified_lifecycle_row_invalid");
  }
  return date.toISOString();
}

export function createPostgresUnifiedLifecycleNotificationRepository(
  db: UnifiedTransactionalQueryable
): UnifiedLifecycleNotificationRepository {
  return {
    async markExpiredLeasesUnknown(input) {
      const result = await db.query(
        `update unified_check_notifications
            set status='DELIVERY_UNKNOWN', lease_token=null, lease_expires_at=null,
                next_attempt_at=null, last_error='lease_expired_after_handoff',
                updated_at=$1
          where status='LEASED' and lease_expires_at <= $1`,
        [input.now]
      );
      return Number(result.rowCount ?? 0);
    },
    claimNext(input) {
      return db.transaction(async (client) => {
        const row = (await client.query(
          `with candidate as (
             select id
               from unified_check_notifications
              where status in ('PENDING','RETRYABLE')
                and ready_at <= $3
                and (status <> 'RETRYABLE' or next_attempt_at <= $3)
              order by coalesce(next_attempt_at,ready_at),created_at,id
              for update skip locked
              limit 1
           ), leased as (
             update unified_check_notifications notification
                set status='LEASED', lease_token=$1,
                    lease_expires_at=$3 + ($2::bigint * interval '1 millisecond'),
                    attempt_count=attempt_count+1, next_attempt_at=null,
                    updated_at=$3
               from candidate
              where notification.id=candidate.id
              returning notification.*
           )
           select leased.*, request.chat_id, request.message_thread_id,
                  request.subject_address, request.status as request_status,
                  request.status_reason, run.status as run_status
             from leased
             join unified_check_requests request on request.id=leased.request_id
             join unified_check_runs run on run.id=request.run_id`,
          [input.leaseToken, input.leaseMs, input.now]
        )).rows[0];
        if (!row) return null;
        const locale = String(row.locale);
        const kind = String(row.kind);
        if (
          (locale !== "ru" && locale !== "en") ||
          (kind !== "LONG_RUNNING" &&
            kind !== "FAILED_TECHNICAL_RUNTIME_HANDOFF") ||
          row.copy_version !== UNIFIED_LIFECYCLE_COPY_VERSION
        ) throw new Error("unified_lifecycle_row_invalid");
        return {
          notificationId: String(row.id),
          leaseToken: String(row.lease_token),
          attempt: Number(row.attempt_count),
          kind,
          copyVersion: UNIFIED_LIFECYCLE_COPY_VERSION,
          request: {
            id: String(row.request_id),
            chatId: String(row.chat_id),
            messageThreadId: String(row.message_thread_id),
            locale,
            subjectAddress: String(row.subject_address),
            runStatus: String(row.run_status),
            requestStatus: String(row.request_status),
            statusReason: row.status_reason === null ? null : String(row.status_reason)
          }
        };
      });
    },
    async isStillSendable(input) {
      const result = await db.query(
        `select 1
           from unified_check_notifications notification
           join unified_check_requests request on request.id=notification.request_id
           join unified_check_runs run on run.id=request.run_id
          where notification.id=$1 and notification.status='LEASED'
            and notification.lease_token=$2
            and (
              (notification.kind='LONG_RUNNING'
                and request.status='ATTACHED'
                and run.status not in ('COMPLETED','FAILED_TECHNICAL'))
              or
              (notification.kind='FAILED_TECHNICAL_RUNTIME_HANDOFF'
                and request.status='FAILED_TECHNICAL'
                and request.status_reason in (
                  'runtime_handoff_unavailable',
                  'runtime_handoff_deadline_exceeded'
                ))
            )`,
        [input.notificationId, input.leaseToken]
      );
      return result.rows.length === 1;
    },
    async settle(input) {
      const result = await db.query(
        `update unified_check_notifications
            set status=$3, lease_token=null, lease_expires_at=null,
                next_attempt_at=$4, last_error=$5,
                telegram_message_id=$6, updated_at=now()
          where id=$1 and status='LEASED' and lease_token=$2`,
        [
          input.notificationId,
          input.leaseToken,
          input.status,
          input.retryAt === null ? null : new Date(dateIso(input.retryAt)),
          input.errorCode,
          input.telegramMessageId
        ]
      );
      return Number(result.rowCount ?? 0) === 1;
    }
  };
}
