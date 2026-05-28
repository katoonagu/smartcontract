import { describe, expect, it, vi } from "vitest";
import { createTronscanScheduler } from "../../src/tron/tronscanScheduler";

describe("TronScan scheduler", () => {
  it("serializes requests and honors the configured minimum interval", async () => {
    const delays: number[] = [];
    let now = 1_000;
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 25,
      rateLimitCooldownMs: 100,
      now: () => now,
      delay: async (ms) => {
        delays.push(ms);
        now += ms;
      }
    });
    const events: string[] = [];

    await Promise.all([
      scheduler.schedule({ requestName: "a", path: "/a", priority: "interactive_fast" }, async () => {
        events.push("a");
        return "a";
      }),
      scheduler.schedule({ requestName: "b", path: "/b", priority: "metadata" }, async () => {
        events.push("b");
        return "b";
      })
    ]);

    expect(events).toEqual(["a", "b"]);
    expect(delays).toContain(25);
  });

  it("coalesces identical fulfilled transfer requests", async () => {
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      rateLimitCooldownMs: 100,
      now: () => 1_000,
      delay: async () => undefined
    });
    const work = vi.fn(async () => ["ok"]);

    const [first, second] = await Promise.all([
      scheduler.schedule({ requestName: "transfer", path: "/api/token_trc20/transfers", cacheKey: "addr:0:50" }, work),
      scheduler.schedule({ requestName: "transfer", path: "/api/token_trc20/transfers", cacheKey: "addr:0:50" }, work)
    ]);

    expect(first).toEqual(["ok"]);
    expect(second).toEqual(["ok"]);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("starts a slot cooldown after rate-limit failures when no alternate key is available", async () => {
    const delays: number[] = [];
    let now = 1_000;
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      rateLimitCooldownMs: 250,
      now: () => now,
      delay: async (ms) => {
        delays.push(ms);
        now += ms;
      }
    });
    const error = new Error("429");
    (error as Error & { status?: number }).status = 429;

    await expect(
      scheduler.schedule({ requestName: "a", path: "/a" }, async () => {
        throw error;
      })
    ).rejects.toThrow("429");
    await scheduler.schedule({ requestName: "b", path: "/b" }, async () => "ok");

    expect(delays).toContain(250);
  });

  it("distributes scheduled requests across API-key slots", async () => {
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 1000,
      rateLimitCooldownMs: 250,
      apiKeys: ["key-a", "key-b"],
      now: () => 1_000,
      delay: async () => undefined
    });
    const keys: Array<string | null> = [];

    await Promise.all([
      scheduler.schedule({ requestName: "a", path: "/a" }, async (context) => {
        keys.push(context.apiKey);
        return "a";
      }),
      scheduler.schedule({ requestName: "b", path: "/b" }, async (context) => {
        keys.push(context.apiKey);
        return "b";
      })
    ]);

    expect(keys).toEqual(["key-a", "key-b"]);
  });

  it("keeps using another API-key slot when one key is rate limited", async () => {
    const delays: number[] = [];
    let now = 1_000;
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      rateLimitCooldownMs: 250,
      apiKeys: ["key-a", "key-b"],
      now: () => now,
      delay: async (ms) => {
        delays.push(ms);
        now += ms;
      }
    });
    const error = new Error("429");
    (error as Error & { status?: number }).status = 429;
    const keys: Array<string | null> = [];

    await expect(
      scheduler.schedule({ requestName: "a", path: "/a" }, async (context) => {
        keys.push(context.apiKey);
        throw error;
      })
    ).rejects.toThrow("429");
    await scheduler.schedule({ requestName: "b", path: "/b" }, async (context) => {
      keys.push(context.apiKey);
      return "ok";
    });

    expect(keys).toEqual(["key-a", "key-b"]);
    expect(delays).toEqual([]);
  });

  it("priority queues interactive requests ahead of deep work that has not started", async () => {
    const delays: number[] = [];
    let now = 1_000;
    const releaseBlocker: Array<() => void> = [];
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      rateLimitCooldownMs: 250,
      now: () => now,
      delay: async (ms) => {
        delays.push(ms);
        now += ms;
      }
    });
    const blocker = scheduler.schedule({ requestName: "blocker", path: "/blocker", priority: "metadata" }, async () => {
      await new Promise<void>((resolve) => {
        releaseBlocker.push(resolve);
      });
      return "blocker";
    });
    await Promise.resolve();
    const events: string[] = [];
    const queued = Promise.all([
      scheduler.schedule({ requestName: "transfer", path: "/api/token_trc20/transfers", priority: "deep_transfer" }, async () => {
        events.push("deep");
        return "deep";
      }),
      scheduler.schedule({ requestName: "stablecoin_contract_state", path: "/wallet/triggerconstantcontract", priority: "interactive_fast" }, async () => {
        events.push("interactive");
        return "interactive";
      })
    ]);
    releaseBlocker[0]?.();
    await blocker;
    await queued;

    expect(events).toEqual(["interactive", "deep"]);
    expect(delays).toEqual([]);
  });

  it("reports API-key presence without exposing the key", () => {
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      rateLimitCooldownMs: 0,
      apiKeyConfigured: true
    });

    expect(scheduler.diagnostics()).toEqual(expect.objectContaining({ apiKeyConfigured: true }));
    expect(scheduler.diagnostics()).toEqual(expect.objectContaining({ apiKeyCount: 0 }));
    expect(JSON.stringify(scheduler.diagnostics())).not.toContain("TRON-PRO-API-KEY");
  });

  it("reports API-key count without exposing keys", () => {
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      rateLimitCooldownMs: 0,
      apiKeys: ["key-a", "key-b"]
    });

    expect(scheduler.diagnostics()).toEqual(expect.objectContaining({
      apiKeyConfigured: true,
      apiKeyCount: 2
    }));
    expect(JSON.stringify(scheduler.diagnostics())).not.toContain("key-a");
    expect(JSON.stringify(scheduler.diagnostics())).not.toContain("key-b");
  });
});
