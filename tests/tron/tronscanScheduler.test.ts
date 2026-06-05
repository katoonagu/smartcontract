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

  it("does not dispatch another cooldown-aware request before a rate-limited request updates cooldown", async () => {
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
    const events: string[] = [];

    const first = scheduler.schedule({ requestName: "first", path: "/first", priority: "metadata" }, async () => {
      events.push(`first@${now}`);
      throw error;
    });
    const second = scheduler.schedule({ requestName: "second", path: "/second", priority: "metadata" }, async () => {
      events.push(`second@${now}`);
      return "ok";
    });

    await expect(first).rejects.toThrow("429");
    await expect(second).resolves.toBe("ok");

    expect(events).toEqual(["first@1000", "second@1250"]);
    expect(delays).toContain(250);
  });

  it("does not let interactive fast requests bypass same-scope rate-limit cooldown", async () => {
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
    const events: string[] = [];

    await expect(
      scheduler.schedule({ requestName: "background", path: "/background", priority: "metadata", endpointBucket: "transfer" }, async () => {
        events.push(`background@${now}`);
        throw error;
      })
    ).rejects.toThrow("429");
    await expect(
      scheduler.schedule({ requestName: "fast", path: "/fast", priority: "interactive_fast", endpointBucket: "contract" }, async () => {
        events.push(`fast@${now}`);
        return "ok";
      })
    ).resolves.toBe("ok");

    expect(events).toEqual(["background@1000", "fast@1250"]);
    expect(delays).toEqual([250]);
  });

  it("does not apply a TronScan 429 cooldown to a TronGrid fallback scope", async () => {
    const delays: number[] = [];
    let now = 1_000;
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      rateLimitCooldownMs: 250,
      apiKeys: ["key-a", "key-b"],
      apiKeyGroups: [
        { groupId: "tronscan-account", apiKeys: ["key-a"] },
        { groupId: "trongrid-account", apiKeys: ["key-b"] }
      ],
      now: () => now,
      delay: async (ms) => {
        delays.push(ms);
        now += ms;
      }
    });
    const error = new Error("429");
    (error as Error & { status?: number }).status = 429;
    const events: string[] = [];

    await expect(
      scheduler.schedule({ requestName: "transfer", path: "/api/token_trc20/transfers", priority: "metadata", endpointBucket: "transfer" }, async () => {
        events.push(`transfer@${now}`);
        throw error;
      })
    ).rejects.toThrow("429");
    await expect(
      scheduler.schedule({ requestName: "trongrid", path: "/v1/accounts/T/transactions/trc20", priority: "interactive_fast", endpointBucket: "trongrid" }, async () => {
        events.push(`trongrid@${now}`);
        return "ok";
      })
    ).resolves.toBe("ok");

    expect(events).toEqual(["transfer@1000", "trongrid@1000"]);
    expect(delays).toEqual([]);
  });

  it("backs off repeated rate-limit failures on the same slot", async () => {
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
    const events: string[] = [];

    const first = scheduler.schedule({ requestName: "first", path: "/first", priority: "deep_transfer" }, async () => {
      events.push(`first@${now}`);
      throw error;
    });
    const second = scheduler.schedule({ requestName: "second", path: "/second", priority: "deep_transfer" }, async () => {
      events.push(`second@${now}`);
      throw error;
    });
    const third = scheduler.schedule({ requestName: "third", path: "/third", priority: "deep_transfer" }, async () => {
      events.push(`third@${now}`);
      return "ok";
    });

    await expect(first).rejects.toThrow("429");
    await expect(second).rejects.toThrow("429");
    await expect(third).resolves.toBe("ok");

    expect(events).toEqual(["first@1000", "second@1250", "third@1750"]);
    expect(delays).toEqual([250, 500]);
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

  it("global pacing delays a second request even when another API-key slot is available", async () => {
    const delays: number[] = [];
    let now = 1_000;
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      globalRequestMinIntervalMs: 100,
      rateLimitCooldownMs: 250,
      apiKeys: ["key-a", "key-b"],
      now: () => now,
      delay: async (ms) => {
        delays.push(ms);
        now += ms;
      }
    });
    const events: string[] = [];
    const keys: Array<string | null> = [];

    await Promise.all([
      scheduler.schedule({ requestName: "a", path: "/a" }, async (context) => {
        events.push(`a@${now}`);
        keys.push(context.apiKey);
        return "a";
      }),
      scheduler.schedule({ requestName: "b", path: "/b" }, async (context) => {
        events.push(`b@${now}`);
        keys.push(context.apiKey);
        return "b";
      })
    ]);

    expect(keys).toEqual(["key-a", "key-b"]);
    expect(events).toEqual(["a@1000", "b@1100"]);
    expect(delays).toEqual([100]);
  });

  it("enforces account group pacing across keys in the same group", async () => {
    const delays: number[] = [];
    let now = 1_000;
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      globalRequestMinIntervalMs: 0,
      accountGroupRequestMinIntervalMs: 250,
      rateLimitCooldownMs: 250,
      apiKeys: ["key-a", "key-b"],
      apiKeyGroups: [{ groupId: "shared", apiKeys: ["key-a", "key-b"] }],
      now: () => now,
      delay: async (ms) => {
        delays.push(ms);
        now += ms;
      }
    });
    const events: string[] = [];
    const keys: Array<string | null> = [];

    await Promise.all([
      scheduler.schedule({ requestName: "a", path: "/a" }, async (context) => {
        events.push(`a@${now}`);
        keys.push(context.apiKey);
        return "a";
      }),
      scheduler.schedule({ requestName: "b", path: "/b" }, async (context) => {
        events.push(`b@${now}`);
        keys.push(context.apiKey);
        return "b";
      })
    ]);

    expect(keys).toEqual(["key-a", "key-b"]);
    expect(events).toEqual(["a@1000", "b@1250"]);
    expect(delays).toEqual([250]);
  });

  it("dispatches keys in different account groups without a group delay", async () => {
    const delays: number[] = [];
    let now = 1_000;
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      globalRequestMinIntervalMs: 0,
      accountGroupRequestMinIntervalMs: 250,
      rateLimitCooldownMs: 250,
      apiKeys: ["key-a", "key-b"],
      apiKeyGroups: [
        { groupId: "account-a", apiKeys: ["key-a"] },
        { groupId: "account-b", apiKeys: ["key-b"] }
      ],
      now: () => now,
      delay: async (ms) => {
        delays.push(ms);
        now += ms;
      }
    });
    const events: string[] = [];
    const keys: Array<string | null> = [];

    await Promise.all([
      scheduler.schedule({ requestName: "a", path: "/a" }, async (context) => {
        events.push(`a@${now}`);
        keys.push(context.apiKey);
        return "a";
      }),
      scheduler.schedule({ requestName: "b", path: "/b" }, async (context) => {
        events.push(`b@${now}`);
        keys.push(context.apiKey);
        return "b";
      })
    ]);

    expect(keys).toEqual(["key-a", "key-b"]);
    expect(events).toEqual(["a@1000", "b@1000"]);
    expect(delays).toEqual([]);
  });

  it("repeated transfer bucket requests respect the endpoint interval", async () => {
    const delays: number[] = [];
    let now = 1_000;
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      rateLimitCooldownMs: 250,
      endpointMinIntervalMs: { transfer: 75 },
      apiKeys: ["key-a", "key-b"],
      now: () => now,
      delay: async (ms) => {
        delays.push(ms);
        now += ms;
      }
    });
    const events: string[] = [];

    await Promise.all([
      scheduler.schedule({ requestName: "transfer-a", path: "/api/token_trc20/transfers", endpointBucket: "transfer" }, async () => {
        events.push(`a@${now}`);
        return "a";
      }),
      scheduler.schedule({ requestName: "transfer-b", path: "/api/token_trc20/transfers", endpointBucket: "transfer" }, async () => {
        events.push(`b@${now}`);
        return "b";
      })
    ]);

    expect(events).toEqual(["a@1000", "b@1075"]);
    expect(delays).toEqual([75]);
  });

  it("keeps fixed-key work on one slot even when multiple API-key slots exist", async () => {
    const delays: number[] = [];
    let now = 1_000;
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 250,
      rateLimitCooldownMs: 250,
      apiKeys: ["key-a", "key-b"],
      now: () => now,
      delay: async (ms) => {
        delays.push(ms);
        now += ms;
      }
    });
    const keys: Array<string | null> = [];
    const events: string[] = [];

    await Promise.all([
      scheduler.schedule({ requestName: "fullnode-a", path: "/wallet/triggerconstantcontract", slotScope: "single" }, async (context) => {
        keys.push(context.apiKey);
        events.push(`a@${now}`);
        return "a";
      }),
      scheduler.schedule({ requestName: "fullnode-b", path: "/wallet/triggerconstantcontract", slotScope: "single" }, async (context) => {
        keys.push(context.apiKey);
        events.push(`b@${now}`);
        return "b";
      })
    ]);

    expect(keys).toEqual(["key-a", "key-a"]);
    expect(events).toEqual(["a@1000", "b@1250"]);
    expect(delays).toContain(250);
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
    await scheduler.schedule({ requestName: "b", path: "/b", priority: "interactive_fast", endpointBucket: "contract" }, async (context) => {
      keys.push(context.apiKey);
      return "ok";
    });

    expect(keys).toEqual(["key-a", "key-b"]);
    expect(delays).toEqual([250]);
  });

  it("reports slot, global, and endpoint cooldowns after a rate-limit failure", async () => {
    let now = 1_000;
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      rateLimitCooldownMs: 250,
      endpointMinIntervalMs: { transfer: 25 },
      now: () => now,
      delay: async (ms) => {
        now += ms;
      }
    });
    const error = new Error("429");
    (error as Error & { status?: number }).status = 429;

    await expect(
      scheduler.schedule({ requestName: "transfer", path: "/api/token_trc20/transfers", endpointBucket: "transfer" }, async () => {
        throw error;
      })
    ).rejects.toThrow("429");

    expect(scheduler.diagnostics()).toEqual(expect.objectContaining({
      cooldownUntilMs: 1250,
      globalCooldownUntilMs: 1250,
      globalCooldownUntilMsByScope: expect.objectContaining({ tronscan: 1250 }),
      endpointCooldownUntilMs: expect.objectContaining({ transfer: 1250 })
    }));
  });

  it("reports account group count and cooldowns without exposing API keys", async () => {
    let now = 1_000;
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      rateLimitCooldownMs: 250,
      apiKeys: ["key-a", "key-b"],
      apiKeyGroups: [
        { groupId: "shared", apiKeys: ["key-a"] },
        { groupId: "backup", apiKeys: ["key-b"] }
      ],
      now: () => now,
      delay: async (ms) => {
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

    const diagnostics = scheduler.diagnostics();
    expect(diagnostics).toEqual(expect.objectContaining({
      apiKeyGroupCount: 2,
      accountGroupCooldownUntilMs: expect.objectContaining({ shared: 1250, backup: 0 })
    }));
    expect(JSON.stringify(diagnostics)).not.toContain("key-a");
    expect(JSON.stringify(diagnostics)).not.toContain("key-b");
  });

  it("cools down an account group after one key in that group is rate limited", async () => {
    const delays: number[] = [];
    let now = 1_000;
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      globalRequestMinIntervalMs: 0,
      accountGroupRequestMinIntervalMs: 0,
      rateLimitCooldownMs: 250,
      apiKeys: ["key-a", "key-b"],
      apiKeyGroups: [{ groupId: "shared", apiKeys: ["key-a", "key-b"] }],
      now: () => now,
      delay: async (ms) => {
        delays.push(ms);
        now += ms;
      }
    });
    const error = new Error("429");
    (error as Error & { status?: number }).status = 429;
    const events: string[] = [];
    const keys: Array<string | null> = [];

    const first = scheduler.schedule({ requestName: "a", path: "/a", endpointBucket: "transfer" }, async (context) => {
      events.push(`a@${now}`);
      keys.push(context.apiKey);
      throw error;
    });
    const second = scheduler.schedule({ requestName: "b", path: "/b", endpointBucket: "trongrid" }, async (context) => {
      events.push(`b@${now}`);
      keys.push(context.apiKey);
      return "b";
    });

    await expect(first).rejects.toThrow("429");
    await expect(second).resolves.toBe("b");

    expect(keys).toEqual(["key-a", "key-b"]);
    expect(events).toEqual(["a@1000", "b@1250"]);
    expect(delays).toEqual([250]);
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
