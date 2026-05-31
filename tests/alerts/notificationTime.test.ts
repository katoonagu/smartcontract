import { describe, expect, it } from "vitest";
import { formatNotificationMskTime } from "../../src/alerts/notificationTime";

describe("formatNotificationMskTime", () => {
  it("formats Russian MSK notification time", () => {
    expect(formatNotificationMskTime(new Date("2026-05-31T11:02:00.000Z"), "ru")).toBe("31.05.2026 14:02 MSK");
  });

  it("formats English MSK notification time", () => {
    expect(formatNotificationMskTime(new Date("2026-05-31T11:02:00.000Z"), "en")).toBe("May 31, 2026 14:02 MSK");
  });

  it("returns null when event time is unavailable", () => {
    expect(formatNotificationMskTime(null, "ru")).toBeNull();
  });
});
