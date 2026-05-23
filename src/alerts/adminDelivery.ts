import type { Logger } from "../logging/logger";

export async function sendServiceAdminAlert(input: {
  adminIds: Iterable<string>;
  message: string;
  sendMessage(telegramUserId: string, message: string): Promise<void>;
  logger: Logger;
}): Promise<void> {
  for (const adminId of input.adminIds) {
    try {
      await input.sendMessage(adminId, input.message);
    } catch (error) {
      input.logger.error("service_admin_alert_delivery_failed", {
        service_admin_telegram_id: adminId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
