import { describe, expect, it } from "vitest";
import { sendServiceAdminAlert } from "../../src/alerts/adminDelivery";

describe("sendServiceAdminAlert", () => {
  it("continues delivering to remaining service admins when one admin send fails", async () => {
    const delivered: string[] = [];
    const loggedErrors: string[] = [];

    await sendServiceAdminAlert({
      adminIds: ["1", "2", "3"],
      message: "HIGH incoming event",
      sendMessage: async (telegramUserId) => {
        if (telegramUserId === "2") throw new Error("blocked by user");
        delivered.push(telegramUserId);
      },
      logger: {
        info: () => {},
        warn: () => {},
        error: (event) => {
          loggedErrors.push(event);
        }
      }
    });

    expect(delivered).toEqual(["1", "3"]);
    expect(loggedErrors).toEqual(["service_admin_alert_delivery_failed"]);
  });
});
