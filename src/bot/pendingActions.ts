import type { TelegramUserPendingAction, TelegramUserSession } from "../storage/repositories";

export function shouldHandlePendingText(session: TelegramUserSession | null, text: string): session is TelegramUserSession & {
  pendingAction: TelegramUserPendingAction;
} {
  return session?.pendingAction !== null && session?.pendingAction !== undefined && !text.trim().startsWith("/");
}
