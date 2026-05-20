import { describe, expect, it } from "vitest";
import { createLogger } from "../../src/logging/logger";

describe("createLogger", () => {
  it("writes structured log records with level, event, timestamp, and fields", () => {
    const records: unknown[] = [];
    const logger = createLogger({
      now: () => new Date("2026-05-20T00:00:00.000Z"),
      sink: (record) => records.push(record)
    });

    logger.info("poll_cycle_started", { cycle_id: "cycle-1", wallet_id: "wallet-1" });

    expect(records).toEqual([
      {
        level: "info",
        event: "poll_cycle_started",
        timestamp: "2026-05-20T00:00:00.000Z",
        cycle_id: "cycle-1",
        wallet_id: "wallet-1"
      }
    ]);
  });
});
