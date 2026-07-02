import { describe, expect, it } from "vitest";
import { buildDirectHardEvidenceSnapshots } from "../../src/forensics/directHardEvidence";
import type { StablecoinRestrictionProfile } from "../../src/types";

function restriction(address: string): StablecoinRestrictionProfile {
  return {
    subjectAddress: address,
    tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    tokenSymbol: "USDT",
    tokenStandard: "TRC20",
    decimals: 6,
    balanceRaw: "0",
    isBlacklisted: false,
    blacklistEventTxHash: null,
    blacklistEventTimestamp: null,
    blacklistEventBlock: null,
    checkedAt: "2026-07-02T00:00:00.000Z",
    evidenceStrength: "exact_contract_state",
    methods: {
      blacklist: "isBlackListed(address)",
      balance: "balanceOf(address)"
    }
  };
}

describe("direct hard evidence helper", () => {
  it("runs live checks with bounded concurrency and liveLimit", async () => {
    let active = 0;
    let maxActive = 0;
    const checked: string[] = [];

    const result = await buildDirectHardEvidenceSnapshots({
      addresses: Array.from({ length: 8 }, (_, index) => `TDirect${index}`),
      liveLimit: 5,
      concurrency: 2,
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => null,
      getUsdtRestrictionStatus: async (address) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        checked.push(address);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return restriction(address);
      }
    });

    expect(checked).toHaveLength(5);
    expect(result.liveCheckedCount).toBe(5);
    expect(result.checkedCount).toBe(8);
    expect(result.status).toBe("live_budget_exhausted");
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("does not report complete when a live blacklist lookup fails", async () => {
    const result = await buildDirectHardEvidenceSnapshots({
      addresses: ["TDirect0", "TDirect1"],
      liveLimit: 2,
      concurrency: 2,
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => null,
      getUsdtRestrictionStatus: async (address) => {
        if (address === "TDirect1") throw new Error("429");
        return restriction(address);
      }
    });

    expect(result.status).toBe("local_only_partial");
    expect(result.liveCheckedCount).toBe(1);
    expect(result.liveFailedCount).toBe(1);
    expect(result.missingChecks[0]).toContain("TDirect1");
  });
});
