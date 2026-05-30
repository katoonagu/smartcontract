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
        methodMap: {
          a1b2c3d4: "permitTransfer(address,address,uint256,uint256,bytes)"
        },
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
    expect(result.evidence.join(" ")).not.toContain("permitTransfer");
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

  it("classifies HTX/Huobi tags as CEX terminal liquidity boundaries", () => {
    const htx = classifyServiceAddress({
      address: "THTX11111111111111111111111111111111",
      metadata: {
        address: "THTX11111111111111111111111111111111",
        name: "HTX Hot Wallet",
        tag: "HTX",
        isContract: false,
        verified: true
      },
      contractProfile: null
    });

    const huobi = classifyServiceAddress({
      address: "THuobi11111111111111111111111111111",
      metadata: {
        address: "THuobi11111111111111111111111111111",
        name: "Huobi Deposit",
        tag: "Huobi",
        isContract: false,
        verified: true
      },
      contractProfile: null
    });

    expect(htx).toMatchObject({ category: "cex", identity: "HTX", isBoundary: true, confidence: "high" });
    expect(huobi).toMatchObject({ category: "cex", identity: "Huobi", isBoundary: true, confidence: "high" });
  });

  it("classifies named exchange tags as CEX boundaries even without a generic exchange word", () => {
    const bybit = classifyServiceAddress({
      address: "TBybit111111111111111111111111111111",
      metadata: {
        address: "TBybit111111111111111111111111111111",
        name: null,
        tag: "Bybit",
        isContract: false,
        verified: null
      },
      contractProfile: null
    });
    const whitebit = classifyServiceAddress({
      address: "TWhiteBIT11111111111111111111111111",
      metadata: {
        address: "TWhiteBIT11111111111111111111111111",
        name: null,
        tag: "WhiteBIT",
        isContract: false,
        verified: null
      },
      contractProfile: null
    });

    expect(bybit).toMatchObject({ category: "cex", identity: "Bybit", isBoundary: true });
    expect(whitebit).toMatchObject({ category: "cex", identity: "WhiteBIT", isBoundary: true });
  });

  it("classifies GasFree Account contracts as service boundaries", () => {
    const result = classifyServiceAddress({
      address: "TGasFree1111111111111111111111111111",
      metadata: {
        address: "TGasFree1111111111111111111111111111",
        name: "CreatedByContract",
        tag: null,
        isContract: true,
        verified: false
      },
      contractProfile: {
        providerTags: [{ kind: "greyTag", label: "GasFree Account", url: null }],
        verified: false,
        providerRisk: false,
        methodMap: {
          a1b2c3d4: "permitTransfer(address,address,uint256,uint256,bytes)"
        },
        topMethods: []
      }
    });

    expect(result.category).toBe("service");
    expect(result.identity).toContain("GasFree");
    expect(result.isBoundary).toBe(true);
  });

  it("prefers GasFree provider identity over generic proxy/router keywords", () => {
    const result = classifyServiceAddress({
      address: "TGasFreeEndpoint1111111111111111111111",
      metadata: {
        address: "TGasFreeEndpoint1111111111111111111111",
        name: "UpgradableProxy",
        tag: "GasFree Endpoint",
        isContract: true,
        verified: false
      },
      contractProfile: {
        providerTags: [
          { kind: "tag1", label: "GasFree Endpoint", url: null },
          { kind: "blueTag", label: "GasFree", url: "gasfree.io" }
        ],
        verified: false,
        providerRisk: false,
        methodMap: {
          "6f21b898": "permitTransfer(address,address,address,uint256,uint256,uint256,uint256,uint256,bytes)"
        },
        topMethods: []
      }
    });

    expect(result).toMatchObject({
      category: "service",
      identity: "GasFree Endpoint",
      isBoundary: true
    });
    expect(result.evidence).toContain("tag:gasfree_service");
  });

  it("does not classify method-only permitTransfer contracts as GasFree service boundaries", () => {
    const result = classifyServiceAddress({
      address: "TPermitOnly11111111111111111111111111",
      metadata: {
        address: "TPermitOnly11111111111111111111111111",
        name: "CreatedByContract",
        tag: null,
        isContract: true,
        verified: false
      },
      contractProfile: {
        serviceTag: null,
        publicTag: null,
        providerTags: [],
        publicTags: [],
        verified: false,
        providerRisk: false,
        hasTransferFromSelector: true,
        lowMetadata: true,
        activityLevel: "low",
        methodMap: {
          a1b2c3d4: "permitTransfer(address,address,uint256,uint256,bytes)"
        },
        topMethods: []
      }
    });

    expect(result).toMatchObject({
      category: "unknown_contract",
      confidence: "medium",
      isBoundary: true
    });
  });

  it("does not classify methodMap-only bridge pool methods as service boundaries", () => {
    const result = classifyServiceAddress({
      address: "TMethodMapOnly11111111111111111111111",
      metadata: {
        address: "TMethodMapOnly11111111111111111111111",
        name: null,
        tag: null,
        isContract: true,
        verified: false
      },
      contractProfile: {
        serviceTag: null,
        publicTag: null,
        providerTags: [],
        publicTags: [],
        verified: false,
        providerRisk: false,
        hasTransferFromSelector: true,
        lowMetadata: true,
        activityLevel: "low",
        methodMap: {
          a1b2c3d4: "ClaimRewards()",
          b2c3d4e5: "Deposit(uint256)",
          c3d4e5f6: "Withdraw(uint256)"
        },
        topMethods: []
      }
    });

    expect(result).toMatchObject({
      category: "unknown_contract",
      confidence: "medium",
      isBoundary: true
    });
  });

  it("classifies USDD PSM GemJoin contracts as protocol boundaries", () => {
    const result = classifyServiceAddress({
      address: "TUSDDPsm111111111111111111111111111",
      metadata: {
        address: "TUSDDPsm111111111111111111111111111",
        name: null,
        tag: "USDD: PSM GemJoin (USDT)",
        isContract: true,
        verified: true
      },
      contractProfile: null
    });

    expect(result).toMatchObject({
      category: "protocol",
      identity: "USDD: PSM GemJoin (USDT)",
      isBoundary: true
    });
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
