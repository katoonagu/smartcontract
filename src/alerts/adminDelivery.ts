import type { Logger } from "../logging/logger";

export type TelegramSendOptions = {
  parse_mode?: "HTML";
};

export async function sendServiceAdminAlert(input: {
  adminIds: Iterable<string>;
  message: string;
  options?: TelegramSendOptions;
  sendMessage(telegramUserId: string, message: string, options?: TelegramSendOptions): Promise<void>;
  logger: Logger;
}): Promise<void> {
  for (const adminId of input.adminIds) {
    try {
      await input.sendMessage(adminId, input.message, input.options);
    } catch (error) {
      input.logger.error("service_admin_alert_delivery_failed", {
        service_admin_telegram_id: adminId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
