import { describe, expect, it } from "vitest";
import { sendServiceAdminAlert } from "../../src/alerts/adminDelivery";

describe("sendServiceAdminAlert", () => {
  it("continues delivering to remaining service admins when one admin send fails", async () => {
    const delivered: Array<{ telegramUserId: string; options?: { parse_mode?: "HTML" } }> = [];
    const loggedErrors: string[] = [];

    await sendServiceAdminAlert({
      adminIds: ["1", "2", "3"],
      message: "HIGH incoming event",
      options: { parse_mode: "HTML" },
      sendMessage: async (telegramUserId, _message, options) => {
        if (telegramUserId === "2") throw new Error("blocked by user");
        delivered.push({ telegramUserId, options });
      },
      logger: {
        info: () => {},
        warn: () => {},
        error: (event) => {
          loggedErrors.push(event);
        }
      }
    });

    expect(delivered).toEqual([
      { telegramUserId: "1", options: { parse_mode: "HTML" } },
      { telegramUserId: "3", options: { parse_mode: "HTML" } }
    ]);
    expect(loggedErrors).toEqual(["service_admin_alert_delivery_failed"]);
  });
});
