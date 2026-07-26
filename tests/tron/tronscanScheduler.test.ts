import { describe, expect, it, vi } from "vitest";
import { createTronscanScheduler } from "../../src/tron/tronscanScheduler";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("TronScan scheduler", () => {
  it("accounts only actual tagged dispatches and isolates a failing sink", async () => {
    const observations: string[] = [];
    let dispatches = 0;
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      rateLimitCooldownMs: 0,
      onDispatchObservation() {
        dispatches += 1;
        throw new Error("metrics sink unavailable");
      },
      onDispatchOutcome(observation) {
        observations.push(observation.outcome);
        throw new Error("metrics sink unavailable");
      }
    });
    const work = vi.fn(async () => "cached");
    const input = {
      requestName: "transfer",
      path: "/transfer",
      cacheKey: "same-page",
      observationScope: "unified" as const
    };

    await expect(Promise.all([
      scheduler.schedule(input, work),
      scheduler.schedule(input, work)
    ])).resolves.toEqual(["cached", "cached"]);

    const rateLimited = Object.assign(new Error("429"), { status: 429 });
    await expect(scheduler.schedule({
      requestName: "transfer",
      path: "/retry-1",
      observationScope: "unified"
    }, async () => {
      throw rateLimited;
    })).rejects.toBe(rateLimited);
    await expect(scheduler.schedule({
      requestName: "transfer",
      path: "/retry-2",
      observationScope: "unified"
    }, async () => "success")).resolves.toBe("success");

    expect(work).toHaveBeenCalledOnce();
    expect(dispatches).toBe(3);
    expect(observations).toEqual([
      "success",
      "rate_limited_429",
      "success"
    ]);
  });

  it("reports provider pacing once per tagged queued request", async () => {
    let now = 1_000;
    const paced = vi.fn();
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 10,
      rateLimitCooldownMs: 0,
      now: () => now,
      delay: async (ms) => {
        now += ms;
      },
      onPacingObservation: paced
    });

    await scheduler.schedule({
      requestName: "first",
      path: "/first",
      observationScope: "unified"
    }, async () => "first");
    await scheduler.schedule({
      requestName: "second",
      path: "/second",
      observationScope: "unified",
      observationRunId: "run-second",
      observationSlotId: 4,
      observationSlotEpoch: 9
    }, async () => "second");

    expect(paced).toHaveBeenCalledOnce();
    expect(paced).toHaveBeenCalledWith({
      requestId: 1,
      scope: "unified",
      runId: "run-second",
      slotId: 4,
      epoch: 9
    });
  });

  it("attaches every coalesced Unified observer to one physical paced request", async () => {
    let now = 1_000;
    const gate = deferred<string>();
    const dispatches: number[] = [];
    const outcomes: number[] = [];
    const paced: string[] = [];
    const settled: string[] = [];
    const observerKey = (item: {
      runId: string;
      slotId: number;
      epoch: number;
    }) => `${item.runId}:${item.slotId}:${item.epoch}`;
    const work = vi.fn(() => gate.promise);
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 10,
      rateLimitCooldownMs: 0,
      now: () => now,
      delay: async (ms) => {
        now += ms;
      },
      onDispatchObservation: (item) => dispatches.push(item.requestId),
      onDispatchOutcome: (item) => outcomes.push(item.requestId),
      onPacingObservation: (item) => paced.push(observerKey(item)),
      onObserverSettled: (item) =>
        settled.push(observerKey(item))
    });

    await scheduler.schedule({
      requestName: "primer",
      path: "/primer"
    }, async () => "primer");
    const untagged = scheduler.schedule({
      requestName: "transfer",
      path: "/shared",
      cacheKey: "shared"
    }, work);
    const runA = scheduler.schedule({
      requestName: "transfer",
      path: "/shared",
      cacheKey: "shared",
      observationScope: "unified",
      observationRunId: "run-a",
      observationSlotId: 0,
      observationSlotEpoch: 1
    }, work);
    await flushMicrotasks();
    expect(paced).toEqual(["run-a:0:1"]);
    const runB = scheduler.schedule({
      requestName: "transfer",
      path: "/shared",
      cacheKey: "shared",
      observationScope: "unified",
      observationRunId: "run-b",
      observationSlotId: 1,
      observationSlotEpoch: 3
    }, work);
    expect(paced.sort()).toEqual(["run-a:0:1", "run-b:1:3"]);
    expect(work).toHaveBeenCalledOnce();
    gate.resolve("ok");
    await expect(Promise.all([untagged, runA, runB])).resolves
      .toEqual(["ok", "ok", "ok"]);
    expect(dispatches).toHaveLength(1);
    expect(outcomes).toHaveLength(1);
    expect(new Set(dispatches)).toEqual(new Set(outcomes));
    expect(settled.sort()).toEqual(["run-a:0:1", "run-b:1:3"]);
  });

  it("attributes dispatch, outcome, and provider group to each run observer without including unrelated traffic", async () => {
    const runDispatches: Array<{
      runId: string;
      groupId: string;
      requestId: number;
    }> = [];
    const runOutcomes: Array<{
      runId: string;
      groupId: string;
      requestId: number;
      outcome: string;
    }> = [];
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      rateLimitCooldownMs: 0,
      apiKeyGroups: [
        { groupId: "audited-a", apiKeys: ["key-a"] },
        { groupId: "unrelated-b", apiKeys: ["key-b"] }
      ],
      apiKeys: ["key-a", "key-b"],
      maxInFlight: 1,
      onRunDispatchObservation: (item) => runDispatches.push(item),
      onRunDispatchOutcome: (item) => runOutcomes.push(item)
    });

    await scheduler.schedule({
      requestName: "unrelated",
      path: "/unrelated",
      observationScope: "unified",
      observationRunId: "run-unrelated",
      observationSlotId: 0,
      observationSlotEpoch: 1
    }, async () => "unrelated");
    await scheduler.schedule({
      requestName: "controlled",
      path: "/controlled",
      observationScope: "unified",
      observationRunId: "run-controlled",
      observationSlotId: 1,
      observationSlotEpoch: 1
    }, async () => "controlled");

    expect(runDispatches.map((item) => item.runId)).toEqual([
      "run-unrelated",
      "run-controlled"
    ]);
    expect(runOutcomes.map((item) => item.runId)).toEqual([
      "run-unrelated",
      "run-controlled"
    ]);
    expect(runOutcomes.every((item) => item.outcome === "success"))
      .toBe(true);
    expect(runDispatches.every((item) => item.groupId.length > 0))
      .toBe(true);
  });

  it("applies one bounded synthetic group cooldown only to its controlled run and records fallback progress", async () => {
    let now = 1_000;
    const groups: Array<{ runId: string; groupId: string }> = [];
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      rateLimitCooldownMs: 0,
      apiKeyGroups: [
        { groupId: "audited-a", apiKeys: ["key-a"] },
        { groupId: "audited-b", apiKeys: ["key-b"] }
      ],
      apiKeys: ["key-a", "key-b"],
      maxInFlight: 1,
      now: () => now,
      delay: async () => undefined,
      onRunDispatchObservation: ({ runId, groupId }) => {
        groups.push({ runId, groupId });
      }
    });
    scheduler.installBenchmarkGroupCooldown({
      controlSha256: "a".repeat(64),
      runId: "controlled",
      groupId: "audited-a",
      startsAtMs: 1_000,
      endsAtMs: 1_100
    });

    await scheduler.schedule({
      requestName: "unrelated",
      path: "/unrelated",
      observationScope: "unified",
      observationRunId: "unrelated",
      observationSlotId: 0,
      observationSlotEpoch: 1
    }, async () => "ok");
    await scheduler.schedule({
      requestName: "controlled",
      path: "/controlled",
      observationScope: "unified",
      observationRunId: "controlled",
      observationSlotId: 1,
      observationSlotEpoch: 1
    }, async () => "ok");

    expect(groups).toEqual([
      { runId: "unrelated", groupId: "audited-a" },
      { runId: "controlled", groupId: "audited-b" }
    ]);
    expect(scheduler.benchmarkGroupCooldown("controlled")).toMatchObject({
      controlSha256: "a".repeat(64),
      groupId: "audited-a",
      startsAtMs: 1_000,
      endsAtMs: 1_100,
      fallbackDispatches: 1,
      activeObserved: true,
      synthetic: true
    });
    expect(scheduler.diagnostics().rateLimitedRequests).toBe(0);

    now = 1_101;
    await scheduler.schedule({
      requestName: "controlled-resumed",
      path: "/controlled-resumed",
      observationScope: "unified",
      observationRunId: "controlled",
      observationSlotId: 1,
      observationSlotEpoch: 2
    }, async () => "ok");
    expect(groups.at(-1)).toEqual({
      runId: "controlled",
      groupId: "audited-a"
    });
    expect(scheduler.benchmarkGroupCooldown("controlled"))
      .toMatchObject({ resumedDispatches: 1 });
  });

  it("delays physical dispatch only for the controlled run until the bounded gate ends", async () => {
    let now = 1_000;
    const dispatched: string[] = [];
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      rateLimitCooldownMs: 0,
      apiKeys: ["key-a"],
      now: () => now,
      delay: async (ms) => {
        now += ms;
      },
      onRunDispatchObservation: ({ runId }) => dispatched.push(runId)
    });
    scheduler.installBenchmarkRunDelay({
      controlSha256: "a".repeat(64),
      runId: "slow-head",
      taskId: "canonical-head-task",
      canonicalSequence: 7,
      startsAtMs: 1_000,
      endsAtMs: 1_100
    });
    now = 1_000;

    await scheduler.schedule({
      requestName: "unrelated",
      path: "/unrelated",
      observationScope: "unified",
      observationRunId: "unrelated",
      observationTaskId: "other-task",
      observationCanonicalSequence: 9,
      observationSlotId: 0,
      observationSlotEpoch: 1
    }, async () => "ok");
    await scheduler.schedule({
      requestName: "slow",
      path: "/slow",
      observationScope: "unified",
      observationRunId: "slow-head",
      observationTaskId: "canonical-head-task",
      observationCanonicalSequence: 7,
      observationSlotId: 0,
      observationSlotEpoch: 1
    }, async () => "ok");

    expect(dispatched).toEqual(["unrelated", "slow-head"]);
    expect(now).toBe(1_100);
    expect(scheduler.benchmarkRunDelay("slow-head")).toMatchObject({
      activeObserved: true,
      resumedDispatches: 1,
      resumedSuccessfulOutcomes: 1,
      taskId: "canonical-head-task",
      canonicalSequence: 7
    });
  });

  it("does not delay another task from the same run as the exact canonical head", async () => {
    let now = 1_000;
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      rateLimitCooldownMs: 0,
      apiKeys: ["key-a"],
      now: () => now,
      delay: async (ms) => {
        now += ms;
      }
    });
    scheduler.installBenchmarkRunDelay({
      controlSha256: "b".repeat(64),
      runId: "slow-head",
      taskId: "canonical-head-task",
      canonicalSequence: 1,
      startsAtMs: 1_000,
      endsAtMs: 1_100
    });
    now = 1_000;

    await scheduler.schedule({
      requestName: "tail",
      path: "/tail",
      observationScope: "unified",
      observationRunId: "slow-head",
      observationTaskId: "tail-task",
      observationCanonicalSequence: 2,
      observationSlotId: 0,
      observationSlotEpoch: 1
    }, async () => "ok");

    expect(now).toBe(1_000);
    expect(scheduler.benchmarkRunDelay("slow-head")).toMatchObject({
      activeObserved: false,
      resumedDispatches: 0,
      resumedSuccessfulOutcomes: 0
    });
  });

  it("coalesces one physical request while settling the delayed exact head after the unrelated observer", async () => {
    let now = 1_000;
    const work = vi.fn(async () => "ok");
    const gateWaiters: Array<() => void> = [];
    const dispatches: Array<{
      requestId: number;
      runId: string;
      attempt?: number;
    }> = [];
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      rateLimitCooldownMs: 0,
      apiKeys: ["key-a"],
      maxInFlight: 2,
      now: () => now,
      delay: () => new Promise<void>((resolve) => {
        gateWaiters.push(resolve);
      }),
      onRunDispatchObservation: (item) => dispatches.push(item)
    });
    scheduler.installBenchmarkRunDelay({
      controlSha256: "c".repeat(64),
      runId: "controlled",
      taskId: "head-task",
      canonicalSequence: 1,
      startsAtMs: 1_000,
      endsAtMs: 1_100
    });
    let controlledSettledAt: number | null = null;
    let unrelatedSettledAt: number | null = null;
    const controlled = scheduler.schedule({
        requestName: "shared",
        path: "/shared",
        cacheKey: "same-provider-page",
        observationScope: "unified",
        observationRunId: "controlled",
        observationTaskId: "head-task",
        observationCanonicalSequence: 1,
        observationAttempt: 4,
        observationSlotId: 0,
        observationSlotEpoch: 1
      }, work).then((value) => {
        controlledSettledAt = now;
        return value;
      });
    const unrelated = scheduler.schedule({
        requestName: "shared",
        path: "/shared",
        cacheKey: "same-provider-page",
        observationScope: "unified",
        observationRunId: "unrelated",
        observationTaskId: "other-task",
        observationCanonicalSequence: 2,
        observationAttempt: 1,
        observationSlotId: 1,
        observationSlotEpoch: 1
      }, work).then((value) => {
        unrelatedSettledAt = now;
        return value;
      });

    await expect(unrelated).resolves.toBe("ok");
    expect(work).toHaveBeenCalledTimes(1);
    expect(new Set(dispatches.map((item) => item.requestId)).size).toBe(1);
    expect(unrelatedSettledAt).toBe(1_000);
    expect(controlledSettledAt).toBeNull();
    now = 1_100;
    for (const release of gateWaiters) release();
    await expect(controlled).resolves.toBe("ok");
    expect(work).toHaveBeenCalledTimes(1);
    expect(controlledSettledAt).toBe(1_100);
    expect(dispatches.find((item) => item.runId === "controlled"))
      .toMatchObject({ attempt: 4 });
    expect(scheduler.benchmarkRunDelay("controlled"))
      .toMatchObject({ successfulAttemptNumbers: [4] });
  });

  it("tears down only exact benchmark fault state across repeated controls", () => {
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      rateLimitCooldownMs: 0,
      apiKeyGroups: [
        { groupId: "group-a", apiKeys: ["key-a"] }
      ],
      apiKeys: ["key-a"]
    });
    const unrelated = "f".repeat(64);
    scheduler.installBenchmarkGroupCooldown({
      controlSha256: unrelated,
      runId: "unrelated",
      groupId: "group-a",
      startsAtMs: 1,
      endsAtMs: 2
    });
    for (let index = 0; index < 100; index += 1) {
      const control = index.toString(16).padStart(64, "0");
      const runId = `run-${index}`;
      scheduler.installBenchmarkRunDelay({
        controlSha256: control,
        runId,
        taskId: `task-${index}`,
        canonicalSequence: index,
        startsAtMs: 1,
        endsAtMs: 2
      });
      scheduler.teardownBenchmarkControl(control);
      expect(scheduler.benchmarkRunDelay(runId)).toBeNull();
    }
    expect(scheduler.benchmarkGroupCooldown("unrelated")).not.toBeNull();
    scheduler.teardownBenchmarkControl(unrelated);
    scheduler.teardownBenchmarkControl(unrelated);
    expect(scheduler.benchmarkGroupCooldown("unrelated")).toBeNull();
  });
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

  it("coalesces only exact versioned transaction endpoint identities", async () => {
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      rateLimitCooldownMs: 0
    });
    const rawWork = vi.fn(async () => "raw");
    const fullWork = vi.fn(async () => "full");
    const otherRawWork = vi.fn(async () => "other-raw");
    const hash = "a".repeat(64);

    await expect(Promise.all([
      scheduler.schedule({
        requestName: "raw_transaction",
        path: "/wallet/gettransactionbyid",
        endpointBucket: "fullnode",
        cacheKey: `default:tron:raw_transaction:v1:${hash}`
      }, rawWork),
      scheduler.schedule({
        requestName: "raw_transaction",
        path: "/wallet/gettransactionbyid",
        endpointBucket: "fullnode",
        cacheKey: `default:tron:raw_transaction:v1:${hash}`
      }, rawWork),
      scheduler.schedule({
        requestName: "tronscan_transaction_info",
        path: "/api/transaction-info",
        endpointBucket: "contract",
        cacheKey: `default:tron:transaction_info:v1:${hash}`
      }, fullWork),
      scheduler.schedule({
        requestName: "raw_transaction",
        path: "/wallet/gettransactionbyid",
        endpointBucket: "fullnode",
        cacheKey: `default:tron:raw_transaction:v1:${"b".repeat(64)}`
      }, otherRawWork)
    ])).resolves.toEqual(["raw", "raw", "full", "other-raw"]);

    expect(rawWork).toHaveBeenCalledOnce();
    expect(fullWork).toHaveBeenCalledOnce();
    expect(otherRawWork).toHaveBeenCalledOnce();
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

  it("scales global pacing across independent account groups", async () => {
    const delays: number[] = [];
    let now = 1_000;
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      globalRequestMinIntervalMs: 100,
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

  it("dispatches independent account groups while earlier work is unresolved", async () => {
    const firstGate = deferred<string>();
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      globalRequestMinIntervalMs: 0,
      rateLimitCooldownMs: 250,
      maxInFlight: 2,
      maxInFlightPerGroup: 1,
      apiKeys: ["key-a", "key-b"],
      apiKeyGroups: [
        { groupId: "account-a", apiKeys: ["key-a"] },
        { groupId: "account-b", apiKeys: ["key-b"] }
      ],
      now: () => 1_000,
      delay: async () => undefined
    });
    const events: string[] = [];

    const first = scheduler.schedule({ requestName: "a", path: "/a" }, async (context) => {
      events.push(`a:${context.apiKey}`);
      return firstGate.promise;
    });
    await Promise.resolve();
    const second = scheduler.schedule({ requestName: "b", path: "/b" }, async (context) => {
      events.push(`b:${context.apiKey}`);
      return "b";
    });
    await Promise.resolve();

    let assertionError: unknown;
    try {
      expect(events).toEqual(["a:key-a", "b:key-b"]);
    } catch (error) {
      assertionError = error;
    }
    firstGate.resolve("a");
    await Promise.allSettled([first, second]);
    if (assertionError) throw assertionError;
  });

  it("uses maxInFlight for concurrent requests when account groups are not configured", async () => {
    const firstGate = deferred<string>();
    const secondGate = deferred<string>();
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      globalRequestMinIntervalMs: 0,
      rateLimitCooldownMs: 250,
      maxInFlight: 2,
      apiKeys: ["key-a", "key-b"],
      now: () => 1_000,
      delay: async () => undefined
    });
    const events: string[] = [];

    const first = scheduler.schedule({ requestName: "a", path: "/a" }, async (context) => {
      events.push(`a:${context.apiKey}`);
      return firstGate.promise;
    });
    await Promise.resolve();
    const second = scheduler.schedule({ requestName: "b", path: "/b" }, async (context) => {
      events.push(`b:${context.apiKey}`);
      return secondGate.promise;
    });
    await Promise.resolve();

    let assertionError: unknown;
    try {
      expect(events).toEqual(["a:key-a", "b:key-b"]);
      expect(scheduler.diagnostics()).toEqual(expect.objectContaining({
        inFlight: 2,
        maxInFlight: 2,
        queued: 0
      }));
    } catch (error) {
      assertionError = error;
    }
    firstGate.resolve("a");
    secondGate.resolve("b");
    await Promise.allSettled([first, second]);
    if (assertionError) throw assertionError;
  });

  it("honors the global max-in-flight cap", async () => {
    const firstGate = deferred<string>();
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      globalRequestMinIntervalMs: 0,
      rateLimitCooldownMs: 250,
      maxInFlight: 1,
      maxInFlightPerGroup: 1,
      apiKeys: ["key-a", "key-b"],
      apiKeyGroups: [
        { groupId: "account-a", apiKeys: ["key-a"] },
        { groupId: "account-b", apiKeys: ["key-b"] }
      ],
      now: () => 1_000,
      delay: async () => undefined
    });
    const events: string[] = [];

    const first = scheduler.schedule({ requestName: "a", path: "/a" }, async (context) => {
      events.push(`a:${context.apiKey}`);
      return firstGate.promise;
    });
    await Promise.resolve();
    const second = scheduler.schedule({ requestName: "b", path: "/b" }, async (context) => {
      events.push(`b:${context.apiKey}`);
      return "b";
    });
    await Promise.resolve();

    expect(events).toEqual(["a:key-a"]);
    expect(scheduler.diagnostics()).toEqual(expect.objectContaining({
      inFlight: 1,
      maxInFlight: 1,
      maxInFlightPerGroup: 1,
      queued: 1,
      dispatchedRequests: 1,
      completedRequests: 0,
      failedRequests: 0,
      rateLimitedRequests: 0
    }));

    firstGate.resolve("a");
    await expect(first).resolves.toBe("a");
    await expect(second).resolves.toBe("b");
    expect(events).toEqual(["a:key-a", "b:key-b"]);
  });

  it("honors the per-account-group max-in-flight cap", async () => {
    const firstGate = deferred<string>();
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      globalRequestMinIntervalMs: 0,
      rateLimitCooldownMs: 250,
      maxInFlight: 2,
      maxInFlightPerGroup: 1,
      apiKeys: ["key-a", "key-b"],
      apiKeyGroups: [{ groupId: "shared", apiKeys: ["key-a", "key-b"] }],
      now: () => 1_000,
      delay: async () => undefined
    });
    const events: string[] = [];

    const first = scheduler.schedule({ requestName: "a", path: "/a" }, async (context) => {
      events.push(`a:${context.apiKey}`);
      return firstGate.promise;
    });
    await Promise.resolve();
    const second = scheduler.schedule({ requestName: "b", path: "/b" }, async (context) => {
      events.push(`b:${context.apiKey}`);
      return "b";
    });
    await Promise.resolve();

    expect(events).toEqual(["a:key-a"]);
    expect(scheduler.diagnostics()).toEqual(expect.objectContaining({
      inFlight: 1,
      inFlightByAccountGroup: expect.objectContaining({ shared: 1 }),
      queued: 1
    }));

    firstGate.resolve("a");
    await expect(first).resolves.toBe("a");
    await expect(second).resolves.toBe("b");
    expect(events).toEqual(["a:key-a", "b:key-b"]);
  });

  it("skips a waiting account group and dispatches the next ready item", async () => {
    const blockerGate = deferred<string>();
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      globalRequestMinIntervalMs: 0,
      rateLimitCooldownMs: 250,
      maxInFlight: 2,
      maxInFlightPerGroup: 1,
      apiKeys: ["key-a", "key-b"],
      apiKeyGroups: [
        { groupId: "account-a", apiKeys: ["key-a"] },
        { groupId: "account-b", apiKeys: ["key-b"] }
      ],
      now: () => 1_000,
      delay: async () => undefined
    });
    const events: string[] = [];

    const blocker = scheduler.schedule({ requestName: "blocker", path: "/blocker", slotScope: "single" }, async (context) => {
      events.push(`blocker:${context.apiKey}`);
      return blockerGate.promise;
    });
    await Promise.resolve();
    const waiting = scheduler.schedule({ requestName: "waiting", path: "/waiting", priority: "interactive_fast", slotScope: "single" }, async (context) => {
      events.push(`waiting:${context.apiKey}`);
      return "waiting";
    });
    const ready = scheduler.schedule({ requestName: "ready", path: "/ready", priority: "metadata" }, async (context) => {
      events.push(`ready:${context.apiKey}`);
      return "ready";
    });
    await Promise.resolve();

    let assertionError: unknown;
    try {
      expect(events).toEqual(["blocker:key-a", "ready:key-b"]);
    } catch (error) {
      assertionError = error;
    }
    blockerGate.resolve("blocker");
    await Promise.allSettled([blocker, waiting, ready]);
    if (assertionError) throw assertionError;
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

  it("scales endpoint pacing across independent account groups", async () => {
    const delays: number[] = [];
    let now = 1_000;
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      globalRequestMinIntervalMs: 0,
      rateLimitCooldownMs: 250,
      endpointMinIntervalMs: { transfer: 75 },
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

  it("does not cool down independent account groups after one group is rate limited", async () => {
    const delays: number[] = [];
    let now = 1_000;
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      globalRequestMinIntervalMs: 0,
      accountGroupRequestMinIntervalMs: 0,
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
    const error = new Error("429");
    (error as Error & { status?: number }).status = 429;
    const events: string[] = [];
    const keys: Array<string | null> = [];

    await expect(
      scheduler.schedule({ requestName: "a", path: "/a", endpointBucket: "transfer" }, async (context) => {
        events.push(`a@${now}`);
        keys.push(context.apiKey);
        throw error;
      })
    ).rejects.toThrow("429");
    await expect(
      scheduler.schedule({ requestName: "b", path: "/b", endpointBucket: "transfer" }, async (context) => {
        events.push(`b@${now}`);
        keys.push(context.apiKey);
        return "b";
      })
    ).resolves.toBe("b");

    expect(keys).toEqual(["key-a", "key-b"]);
    expect(events).toEqual(["a@1000", "b@1000"]);
    expect(delays).toEqual([]);
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
      endpointCooldownUntilMs: expect.objectContaining({ transfer: 1250 }),
      inFlight: 0,
      maxInFlight: 1,
      maxInFlightPerGroup: 2,
      dispatchedRequests: 1,
      completedRequests: 0,
      failedRequests: 1,
      rateLimitedRequests: 1,
      inFlightByAccountGroup: expect.objectContaining({ default: 0 })
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
      accountGroupCooldownUntilMs: expect.objectContaining({ shared: 1250, backup: 0 }),
      dispatchedRequestsByAccountGroup: expect.objectContaining({
        shared: 1,
        backup: 0
      })
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
      maxInFlightPerGroup: 1,
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

  it("rearms the wake timer when a newly queued group is ready sooner", async () => {
    const pendingDelays: Array<{ ms: number; resolve: () => void }> = [];
    let now = 1_000;
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      globalRequestMinIntervalMs: 100,
      accountGroupRequestMinIntervalMs: 0,
      rateLimitCooldownMs: 1_000,
      apiKeys: ["key-a", "key-b"],
      apiKeyGroups: [
        { groupId: "account-a", apiKeys: ["key-a"] },
        { groupId: "account-b", apiKeys: ["key-b"] }
      ],
      now: () => now,
      delay: (ms) => new Promise<void>((resolve) => {
        pendingDelays.push({ ms, resolve });
      })
    });
    const error = new Error("429");
    (error as Error & { status?: number }).status = 429;
    const events: string[] = [];

    await expect(
      scheduler.schedule({ requestName: "cooldown", path: "/cooldown", slotScope: "single" }, async (context) => {
        events.push(`cooldown:${context.apiKey}@${now}`);
        throw error;
      })
    ).rejects.toThrow("429");

    const waiting = scheduler.schedule({ requestName: "waiting", path: "/waiting", slotScope: "single" }, async (context) => {
      events.push(`waiting:${context.apiKey}@${now}`);
      return "waiting";
    });
    await flushMicrotasks();
    expect(pendingDelays.map((delay) => delay.ms)).toEqual([1_000]);

    await expect(
      scheduler.schedule({ requestName: "primer", path: "/primer" }, async (context) => {
        events.push(`primer:${context.apiKey}@${now}`);
        return "primer";
      })
    ).resolves.toBe("primer");
    const readySoon = scheduler.schedule({ requestName: "ready-soon", path: "/ready-soon" }, async (context) => {
      events.push(`ready-soon:${context.apiKey}@${now}`);
      return "ready-soon";
    });
    await flushMicrotasks();

    expect(pendingDelays.map((delay) => delay.ms)).toEqual([1_000, 100]);

    now += 100;
    pendingDelays[1].resolve();
    await expect(readySoon).resolves.toBe("ready-soon");
    expect(events).toEqual(["cooldown:key-a@1000", "primer:key-b@1000", "ready-soon:key-b@1100"]);
    await flushMicrotasks();
    expect(pendingDelays.map((delay) => delay.ms)).toEqual([1_000, 100, 900]);

    now += 900;
    pendingDelays[2].resolve();
    await expect(waiting).resolves.toBe("waiting");
    expect(events).toEqual([
      "cooldown:key-a@1000",
      "primer:key-b@1000",
      "ready-soon:key-b@1100",
      "waiting:key-a@2000"
    ]);
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

  it("reports independent group capacity and cools down only the rate-limited group", async () => {
    let now = 1_000;
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      rateLimitCooldownMs: 250,
      maxInFlightPerGroup: 2,
      apiKeys: ["key-a-1", "key-a-2", "key-b"],
      apiKeyGroups: [
        { groupId: "opaque-a", apiKeys: ["key-a-1", "key-a-2"] },
        { groupId: "opaque-b", apiKeys: ["key-b"] }
      ],
      now: () => now,
      delay: async (ms) => {
        now += ms;
      }
    });
    const error = new Error("429");
    (error as Error & { status?: number }).status = 429;

    await expect(scheduler.schedule(
      { requestName: "limited", path: "/limited", slotScope: "single" },
      async () => {
        throw error;
      }
    )).rejects.toThrow("429");

    expect(scheduler.groupSnapshots()).toEqual([
      {
        groupId: "opaque-a",
        state: "cooldown",
        concurrencyLimit: 2,
        inFlight: 0,
        cooldownUntil: 1_250
      },
      {
        groupId: "opaque-b",
        state: "healthy",
        concurrencyLimit: 2,
        inFlight: 0,
        cooldownUntil: null
      }
    ]);
  });

  it("opens a group circuit after configured failures and restores it after a successful probe", async () => {
    let now = 1_000;
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      rateLimitCooldownMs: 0,
      providerFailureCircuitThreshold: 2,
      providerCircuitOpenMs: 500,
      apiKeys: ["key-a"],
      apiKeyGroups: [{ groupId: "opaque-a", apiKeys: ["key-a"] }],
      now: () => now,
      delay: async (ms) => {
        now += ms;
      }
    });
    const failed = () => scheduler.schedule(
      { requestName: "failed", path: "/failed" },
      async () => {
        throw new Error("provider unavailable");
      }
    );

    await expect(failed()).rejects.toThrow("provider unavailable");
    await expect(failed()).rejects.toThrow("provider unavailable");
    expect(scheduler.groupSnapshots()[0]).toEqual(expect.objectContaining({
      state: "circuit_open",
      cooldownUntil: 1_500
    }));

    now = 1_500;
    await expect(scheduler.schedule(
      { requestName: "half-open", path: "/half-open" },
      async () => "ok"
    )).resolves.toBe("ok");
    expect(scheduler.groupSnapshots()[0]).toEqual(expect.objectContaining({
      state: "healthy",
      cooldownUntil: null
    }));
  });

  it("reports configured group concurrency even when one group has one key", () => {
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      rateLimitCooldownMs: 0,
      maxInFlight: 5,
      maxInFlightPerGroup: 3,
      apiKeys: ["key-a"],
      apiKeyGroups: [{ groupId: "opaque-a", apiKeys: ["key-a"] }]
    });

    expect(scheduler.groupSnapshots()).toEqual([
      expect.objectContaining({
        groupId: "opaque-a",
        concurrencyLimit: 3
      })
    ]);
  });

  it("reopens a half-open circuit after 429 and permits exactly one later recovery probe", async () => {
    let now = 1_000;
    const scheduler = createTronscanScheduler({
      requestMinIntervalMs: 0,
      rateLimitCooldownMs: 250,
      providerFailureCircuitThreshold: 1,
      providerCircuitOpenMs: 500,
      apiKeys: ["key-a"],
      apiKeyGroups: [{ groupId: "opaque-a", apiKeys: ["key-a"] }],
      now: () => now,
      delay: async (ms) => {
        now += ms;
      }
    });
    await expect(scheduler.schedule(
      { requestName: "open", path: "/open" },
      async () => {
        throw new Error("provider unavailable");
      }
    )).rejects.toThrow("provider unavailable");
    now = 1_500;
    const limited = new Error("429");
    (limited as Error & { status?: number }).status = 429;
    await expect(scheduler.schedule(
      { requestName: "half-open-429", path: "/half-open-429" },
      async () => {
        throw limited;
      }
    )).rejects.toThrow("429");
    expect(scheduler.groupSnapshots()[0]).toEqual(expect.objectContaining({
      state: "circuit_open",
      cooldownUntil: 1_750
    }));

    now = 1_750;
    let probes = 0;
    await expect(scheduler.schedule(
      { requestName: "recovery", path: "/recovery" },
      async () => {
        probes += 1;
        return "ok";
      }
    )).resolves.toBe("ok");
    expect(probes).toBe(1);
    expect(scheduler.groupSnapshots()[0]).toEqual(expect.objectContaining({
      state: "healthy",
      cooldownUntil: null
    }));
  });
});
