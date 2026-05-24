import { describe, expect, it } from "vitest";
import { classifyServiceAddress } from "../../src/forensics/serviceClassifier";

describe("forensic service classifier", () => {
  it("classifies Allbridge LP style contracts as bridge pools from contract intelligence", () => {
    const result = classifyServiceAddress({
      address: "TAC21biCBL9agjuUyzd4gZr356zRgJq61b",
      metadata: {
        address: "TAC21biCBL9agjuUyzd4gZr356zRgJq61b",
        name: "Allbridge : Allbridge LP (LP-USDT)",
        tag: "Pool",
        isContract: true,
        verified: true
      },
      contractProfile: {
        name: "Allbridge : Allbridge LP (LP-USDT)",
        serviceTag: "Allbridge LP",
        publicTag: "Pool",
        verified: true,
        providerRisk: false,
        activityLevel: "high",
        topMethods: [
          { methodId: "claim", signature: "ClaimRewards()", count: 38, ratio: 0.475 },
          { methodId: "deposit", signature: "Deposit(uint256)", count: 21, ratio: 0.2625 },
          { methodId: "withdraw", signature: "Withdraw(uint256)", count: 20, ratio: 0.25 }
        ],
        lowMetadata: false
      }
    });

    expect(result).toMatchObject({
      category: "bridge_pool",
      identity: "Allbridge LP",
      confidence: "high",
      isBoundary: true
    });
    expect(result.evidence.join(" ")).toContain("ClaimRewards");
  });

  it("classifies tagged bridge contracts as bridges", () => {
    const result = classifyServiceAddress({
      address: "TAuErcuAtU6BPt6YwL51JZ4RpDCPQASCU2",
      metadata: {
        address: "TAuErcuAtU6BPt6YwL51JZ4RpDCPQASCU2",
        name: "Allbridge : Bridge",
        tag: "Allbridge:Cross-chain Bridge",
        isContract: true,
        verified: true
      },
      contractProfile: null
    });

    expect(result.category).toBe("bridge");
    expect(result.confidence).toBe("high");
  });

  it("classifies weak unverified contracts without service tags as unknown contracts", () => {
    const result = classifyServiceAddress({
      address: "TUnknownContract111111111111111111111",
      metadata: {
        address: "TUnknownContract111111111111111111111",
        name: null,
        tag: null,
        isContract: true,
        verified: false
      },
      contractProfile: {
        serviceTag: null,
        publicTag: null,
        verified: false,
        providerRisk: false,
        hasTransferFromSelector: true,
        lowMetadata: true,
        activityLevel: "low",
        topMethods: []
      }
    });

    expect(result).toMatchObject({
      category: "unknown_contract",
      confidence: "medium",
      isBoundary: true
    });
  });
});
