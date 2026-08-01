import { describe, expect, it, vi } from "vitest";
import { createCrossChainProviderBudget } from "../../src/forensics/crossChainBudget";

describe("cross-chain provider budget", () => {
  it("counts unique provider calls and dedupes repeated keys", async () => {
    const budget = createCrossChainProviderBudget({ maxProviderCalls: 2 });
    const fetcher = vi.fn(async () => "first-result");

    await expect(budget.run("range", "ethereum:tx-1", fetcher)).resolves.toBe("first-result");
    await expect(budget.run("range", "ethereum:tx-1", fetcher)).resolves.toBe("first-result");

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(budget.providerCalls()).toBe(1);
  });

  it("throws on exhaustion and adds one coverage note", async () => {
    const budget = createCrossChainProviderBudget({ maxProviderCalls: 1 });

    await expect(budget.run("range", "ethereum:tx-1", async () => "first")).resolves.toBe("first");
    await expect(budget.run("range", "ethereum:tx-2", async () => "second")).rejects.toThrow(
      "Cross-chain provider budget exhausted"
    );
    await expect(budget.run("range", "ethereum:tx-3", async () => "third")).rejects.toThrow(
      "Cross-chain provider budget exhausted"
    );

    expect(budget.providerCalls()).toBe(1);
    expect(budget.coverageNotes()).toEqual([
      "Cross-chain provider budget exhausted after 1 calls."
    ]);
  });

  it("dedupes concurrent duplicate calls by provider and key", async () => {
    const budget = createCrossChainProviderBudget({ maxProviderCalls: 2 });
    const fetcher = vi.fn(async () => "shared-result");

    const first = budget.run("alchemy", "base:0xabc", fetcher);
    const second = budget.run("alchemy", "base:0xabc", fetcher);

    await expect(Promise.all([first, second])).resolves.toEqual([
      "shared-result",
      "shared-result"
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(budget.providerCalls()).toBe(1);
  });

  it("evicts failed provider calls so a retry can use remaining budget", async () => {
    const budget = createCrossChainProviderBudget({ maxProviderCalls: 2 });
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error("transient provider error"))
      .mockResolvedValueOnce("retry-result");

    await expect(budget.run("range", "ethereum:tx-retry", fetcher)).rejects.toThrow("transient provider error");
    await expect(budget.run("range", "ethereum:tx-retry", fetcher)).resolves.toBe("retry-result");

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(budget.providerCalls()).toBe(2);
    expect(budget.coverageNotes()).toEqual([]);
  });

  it("returns a copy of coverage notes", async () => {
    const budget = createCrossChainProviderBudget({ maxProviderCalls: 0 });

    await expect(budget.run("etherscan", "ethereum:tx-1", async () => "unused")).rejects.toThrow(
      "Cross-chain provider budget exhausted"
    );

    const notes = budget.coverageNotes();
    notes.push("mutated externally");

    expect(budget.coverageNotes()).toEqual([
      "Cross-chain provider budget exhausted after 0 calls."
    ]);
  });

  it("treats the same key on different providers as distinct budget entries", async () => {
    const budget = createCrossChainProviderBudget({ maxProviderCalls: 2 });
    const rangeFetcher = vi.fn(async () => "range-result");
    const localFetcher = vi.fn(async () => "local-result");

    await expect(budget.run("range", "shared-key", rangeFetcher)).resolves.toBe("range-result");
    await expect(budget.run("local", "shared-key", localFetcher)).resolves.toBe("local-result");

    expect(rangeFetcher).toHaveBeenCalledTimes(1);
    expect(localFetcher).toHaveBeenCalledTimes(1);
    expect(budget.providerCalls()).toBe(2);
  });
});
