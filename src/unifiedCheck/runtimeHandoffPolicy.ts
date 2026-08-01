import { code } from "../alerts/telegramHtml";

export const RUNTIME_HANDOFF_DRAIN_MS = 7_200_000;
export const RUNTIME_HEARTBEAT_INTERVAL_MS = 10_000;
export const RUNTIME_HEARTBEAT_STALE_MS = 60_000;
export const LONG_RUNNING_NOTIFICATION_DELAY_MS = 300_000;
export const UNIFIED_LIFECYCLE_COPY_VERSION =
  "unified-lifecycle-copy-v1" as const;

export type RuntimeOwnershipClassification =
  | "recoverable"
  | "runtime_handoff_unavailable"
  | "runtime_handoff_deadline_exceeded";

export type UnifiedLifecycleNotificationKind =
  | "LONG_RUNNING"
  | "FAILED_TECHNICAL_RUNTIME_HANDOFF";

const TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/u;

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new TypeError("runtime_handoff_policy_input_invalid");
  }
  return parsed;
}

export function classifyRuntimeOwnership(input: {
  now: Date;
  heartbeatStaleMs: number;
  compatibleRuntime: null | {
    state: "DRAINING";
    heartbeatAt: string;
    drainDeadlineAt: string;
  };
}): RuntimeOwnershipClassification {
  const nowMs = input.now.getTime();
  if (
    !Number.isFinite(nowMs) ||
    !Number.isSafeInteger(input.heartbeatStaleMs) ||
    input.heartbeatStaleMs < 1
  ) {
    throw new TypeError("runtime_handoff_policy_input_invalid");
  }
  if (input.compatibleRuntime === null) {
    return "runtime_handoff_unavailable";
  }
  const deadlineMs = timestamp(input.compatibleRuntime.drainDeadlineAt);
  const heartbeatMs = timestamp(input.compatibleRuntime.heartbeatAt);
  if (nowMs >= deadlineMs) {
    return "runtime_handoff_deadline_exceeded";
  }
  if (nowMs - heartbeatMs > input.heartbeatStaleMs) {
    return "runtime_handoff_unavailable";
  }
  return "recoverable";
}

export function renderUnifiedLifecycleMessage(input: {
  kind: UnifiedLifecycleNotificationKind;
  locale: "ru" | "en";
  address: string;
}): {
  text: string;
  parseMode: "HTML";
  buttonText: string | null;
  callbackData: string | null;
} {
  if (!TRON_ADDRESS.test(input.address)) {
    throw new TypeError("unified_lifecycle_address_invalid");
  }
  if (input.kind === "LONG_RUNNING") {
    return input.locale === "ru"
      ? {
          text: [
            "⏳ <b>Проверка ещё идёт</b>",
            "У кошелька большая история операций, поэтому анализ занимает больше времени.",
            "Результат придёт сюда, в этот чат.",
            code(input.address)
          ].join("\n\n"),
          parseMode: "HTML",
          buttonText: null,
          callbackData: null
        }
      : {
          text: [
            "⏳ <b>The check is still running</b>",
            "This wallet has a large transaction history, so analysis needs more time.",
            "The result will arrive here in this chat.",
            code(input.address)
          ].join("\n\n"),
          parseMode: "HTML",
          buttonText: null,
          callbackData: null
        };
  }

  return input.locale === "ru"
    ? {
        text: [
          "⚠️ <b>Проверка остановлена из-за обновления сервиса</b>",
          "Мы не успели завершить анализ, поэтому вывод о риске не сформирован.",
          "Нажмите «Повторить», чтобы заново проверить тот же кошелёк.",
          code(input.address)
        ].join("\n\n"),
        parseMode: "HTML",
        buttonText: "Повторить",
        callbackData: `check:addr:${input.address}`
      }
    : {
        text: [
          "⚠️ <b>The check stopped during a service update</b>",
          "The analysis did not finish, so no risk conclusion was produced.",
          "Tap Retry to check the same wallet again.",
          code(input.address)
        ].join("\n\n"),
        parseMode: "HTML",
        buttonText: "Retry",
        callbackData: `check:addr:${input.address}`
      };
}
