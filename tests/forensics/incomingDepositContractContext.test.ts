import { describe, expect, it, vi } from "vitest";
import type { ContractAnalysisCaseFile, ContractLlmVerdictSummary, IncomingDepositOriginPath } from "../../src/types";
import { analyzeIncomingDepositContracts } from "../../src/forensics/incomingDepositContractContext";

const path: IncomingDepositOriginPath = {
  verdict: "DECLINE",
  score: 58,
  sourcePolicy: "medium_policy",
  stoppedReason: "unknown_contract_reached",
  pathAddresses: ["TFcRN111111111111111111111111FLR5hvh", "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs", "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM"],
  txHashes: ["contract-in-1", "48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b"],
  steps: [],
  amountCoverageRatio: 0.92,
  amountContinuity: "strong",
  proximityHops: 1,
  reasons: ["Deposit funding reaches an unknown smart-contract boundary."]
};

describe("analyzeIncomingDepositContracts", () => {
  it("calls LLM analyzer for close unknown contract boundaries", async () => {
    const verdict: ContractLlmVerdictSummary = {
      source: "llm",
      cacheMatch: null,
      reusedFromContractAddress: null,
      providerLabel: "deepseek",
      model: "deepseek-v4-pro",
      contractAddress: "TFcRN111111111111111111111111FLR5hvh",
      caseFileHash: "case-hash-1",
      cacheId: null,
      verdict: "unknown_suspicious",
      confidence: 0.8,
      contractRiskScore: 72,
      decisionRecommendation: "DECLINE",
      reasons: ["Unknown contract funded sender shortly before deposit."],
      citedEvidenceIds: ["contract-in-1"],
      falsePositiveNotes: []
    };

    const analyze = vi.fn(async (_caseFiles: ContractAnalysisCaseFile[]) => [verdict]);
    const result = await analyzeIncomingDepositContracts({
      subjectAddress: "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs",
      watchedWallet: "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM",
      depositTxHash: "48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b",
      originPaths: [path],
      getContractIntelligenceProfile: async () => null,
      getTransaction: async () => ({ hash: "contract-in-1" }),
      analyzeContractLlmCaseFiles: analyze
    });

    expect(analyze).toHaveBeenCalledTimes(1);
    const [caseFiles] = analyze.mock.calls[0] ?? [];
    expect(caseFiles).toHaveLength(1);
    const caseFile = caseFiles?.[0];
    expect(caseFile?.contractAddress).toBe("TFcRN111111111111111111111111FLR5hvh");
    expect(caseFile?.subjectAddress).toBe("TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs");
    expect(caseFile?.checkedWalletAddress).toBe("TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM");
    expect(caseFile?.evidenceIds).toEqual(
      expect.arrayContaining(["48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b", "contract-in-1"])
    );
    const incomingDepositContext = caseFile?.contractProfile?.incomingDepositContext as
      | {
          depositTxHash: string;
          watchedWallet: string;
          relatedPaths: Array<{
            pathAddresses: string[];
            txHashes: string[];
          }>;
          transactionDetails: Array<{
            txHash: string;
          }>;
        }
      | undefined;
    expect(incomingDepositContext).toMatchObject({
      depositTxHash: "48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b",
      watchedWallet: "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM",
      relatedPaths: [
        {
          pathAddresses: path.pathAddresses,
          txHashes: path.txHashes
        }
      ]
    });
    expect(incomingDepositContext?.transactionDetails[0]?.txHash).toBe("contract-in-1");
    expect(result.verdicts).toEqual([verdict]);
  });

  it("does not call LLM analyzer for known clean boundary paths", async () => {
    const analyze = vi.fn(async (_caseFiles: ContractAnalysisCaseFile[]) => []);
    const result = await analyzeIncomingDepositContracts({
      subjectAddress: "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs",
      watchedWallet: "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM",
      depositTxHash: "48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b",
      originPaths: [
        { ...path, stoppedReason: "clean_cex_reached" },
        { ...path, stoppedReason: "whitebit_reached" }
      ],
      getContractIntelligenceProfile: async () => null,
      getTransaction: async () => ({ hash: "contract-in-1" }),
      analyzeContractLlmCaseFiles: analyze
    });

    expect(analyze).not.toHaveBeenCalled();
    expect(result).toEqual({ verdicts: [], caseFileCount: 0 });
  });

  it("captures transaction detail failures and still calls LLM analyzer", async () => {
    const analyze = vi.fn(async (_caseFiles: ContractAnalysisCaseFile[]) => []);
    await analyzeIncomingDepositContracts({
      subjectAddress: "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs",
      watchedWallet: "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM",
      depositTxHash: "48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b",
      originPaths: [path],
      getContractIntelligenceProfile: async () => null,
      getTransaction: async (txHash) => {
        if (txHash === "contract-in-1") throw new Error("transaction lookup failed");
        return { hash: txHash };
      },
      analyzeContractLlmCaseFiles: analyze
    });

    expect(analyze).toHaveBeenCalledTimes(1);
    const [caseFiles] = analyze.mock.calls[0] ?? [];
    const incomingDepositContext = caseFiles?.[0]?.contractProfile?.incomingDepositContext as
      | {
          transactionDetails: Array<{
            txHash: string;
            raw: unknown;
          }>;
        }
      | undefined;
    expect(incomingDepositContext?.transactionDetails).toContainEqual({
      txHash: "contract-in-1",
      raw: { error: "transaction lookup failed" }
    });
  });

  it("returns a deterministic legitimate-service verdict when enrichment resolves a service contract", async () => {
    const enrich = vi.fn(async () => ({
      address: "TFcRN111111111111111111111111FLR5hvh",
      metadata: { address: "TFcRN111111111111111111111111FLR5hvh", name: "GasFree", tag: "GasFree", isContract: true, verified: true },
      contractProfile: null,
      classification: {
        category: "service" as const,
        identity: "GasFree",
        confidence: "high" as const,
        evidence: ["metadata:GasFree"],
        isBoundary: true
      },
      profileSource: "none" as const,
      liveFetchError: null
    }));
    const analyze = vi.fn(async (_caseFiles: ContractAnalysisCaseFile[]) => []);

    const result = await analyzeIncomingDepositContracts({
      subjectAddress: "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs",
      watchedWallet: "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM",
      depositTxHash: "48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b",
      originPaths: [path],
      enrichContractClassification: enrich,
      getContractIntelligenceProfile: vi.fn(async () => null),
      getTransaction: vi.fn(async () => ({ hash: "contract-in-1" })),
      analyzeContractLlmCaseFiles: analyze
    });

    expect(enrich).toHaveBeenCalledWith("TFcRN111111111111111111111111FLR5hvh");
    expect(analyze).not.toHaveBeenCalled();
    expect(result.caseFileCount).toBe(0);
    expect(result.resolvedOriginPaths).toBeUndefined();
    expect(result.verdicts).toEqual([
      expect.objectContaining({
        source: "deterministic",
        providerLabel: "deterministic-service-classifier",
        model: "service-classifier",
        contractAddress: "TFcRN111111111111111111111111FLR5hvh",
        verdict: "legitimate_service",
        decisionRecommendation: "ACCEPTABLE",
        contractRiskScore: expect.any(Number)
      })
    ]);
    expect(result.verdicts[0]?.contractRiskScore).toBeGreaterThanOrEqual(25);
    expect(result.verdicts[0]?.contractRiskScore).toBeLessThanOrEqual(35);
  });

  it.each([
    {
      category: "bridge" as const,
      identity: "Multichain",
      stoppedReason: "bridge_router_dex_reached" as const,
      sourcePolicy: "hard_decline" as const,
      minScore: 70
    },
    {
      category: "cex" as const,
      identity: "HTX",
      stoppedReason: "htx_huobi_reached" as const,
      sourcePolicy: "hard_decline" as const,
      minScore: 78
    },
    {
      category: "cex" as const,
      identity: "Coinbase",
      stoppedReason: "clean_cex_reached" as const,
      sourcePolicy: "clean" as const,
      minScore: 5
    }
  ])(
    "rewrites unknown paths when enrichment resolves $identity as $category",
    async ({ category, identity, stoppedReason, sourcePolicy, minScore }) => {
      const enrich = vi.fn(async () => ({
        address: "TFcRN111111111111111111111111FLR5hvh",
        metadata: { address: "TFcRN111111111111111111111111FLR5hvh", name: identity, tag: identity, isContract: true, verified: true },
        contractProfile: null,
        classification: {
          category,
          identity,
          confidence: "high" as const,
          evidence: [`metadata:${identity}`],
          isBoundary: true
        },
        profileSource: "none" as const,
        liveFetchError: null
      }));
      const analyze = vi.fn(async (_caseFiles: ContractAnalysisCaseFile[]) => []);

      const result = await analyzeIncomingDepositContracts({
        subjectAddress: "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs",
        watchedWallet: "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM",
        depositTxHash: "48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b",
        originPaths: [path],
        enrichContractClassification: enrich,
        getContractIntelligenceProfile: vi.fn(async () => null),
        getTransaction: vi.fn(async () => ({ hash: "contract-in-1" })),
        analyzeContractLlmCaseFiles: analyze
      });

      expect(analyze).not.toHaveBeenCalled();
      expect(result.verdicts).toEqual([]);
      expect(result.caseFileCount).toBe(0);
      expect(result.resolvedOriginPaths).toEqual([
        expect.objectContaining({
          stoppedReason,
          sourcePolicy,
          verdict: stoppedReason === "clean_cex_reached" ? "ACCEPTABLE" : "DECLINE",
          pathAddresses: path.pathAddresses,
          txHashes: path.txHashes
        })
      ]);
      expect(result.resolvedOriginPaths?.[0]?.score).toBeGreaterThanOrEqual(minScore);
      expect(result.resolvedOriginPaths?.[0]?.reasons.join(" ")).toContain(identity);
    }
  );

  it("sends policy-unmapped exchange classifications to LLM instead of silently skipping verdicts", async () => {
    const enrich = vi.fn(async () => ({
      address: "TFcRN111111111111111111111111FLR5hvh",
      metadata: { address: "TFcRN111111111111111111111111FLR5hvh", name: "Exchange", tag: "Exchange", isContract: true, verified: true },
      contractProfile: null,
      classification: {
        category: "cex" as const,
        identity: "Exchange",
        confidence: "high" as const,
        evidence: ["tag:exchange"],
        isBoundary: true
      },
      profileSource: "none" as const,
      liveFetchError: null
    }));
    const analyze = vi.fn(async (_caseFiles: ContractAnalysisCaseFile[]) => []);

    const result = await analyzeIncomingDepositContracts({
      subjectAddress: "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs",
      watchedWallet: "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM",
      depositTxHash: "48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b",
      originPaths: [path],
      enrichContractClassification: enrich,
      getContractIntelligenceProfile: vi.fn(async () => null),
      getTransaction: vi.fn(async () => ({ hash: "contract-in-1" })),
      analyzeContractLlmCaseFiles: analyze
    });

    expect(result.caseFileCount).toBe(1);
    expect(result.resolvedOriginPaths).toBeUndefined();
    expect(analyze).toHaveBeenCalledTimes(1);
    const [caseFiles] = analyze.mock.calls[0] ?? [];
    expect(caseFiles?.[0]?.serviceClassification).toMatchObject({
      category: "cex",
      identity: "Exchange"
    });
  });

  it.each(["unknown_contract", "none"] as const)(
    "sends %s enrichment to LLM with enrichment details in the case file",
    async (category) => {
      const enrich = vi.fn(async () => ({
        address: "TFcRN111111111111111111111111FLR5hvh",
        metadata: { address: "TFcRN111111111111111111111111FLR5hvh", name: null, tag: "unverified", isContract: true, verified: false },
        contractProfile: {
          contractAddress: "TFcRN111111111111111111111111FLR5hvh",
          providerTags: [],
          publicTags: [],
          isVerified: false,
          verifyStatus: null,
          sourceStatus: "missing",
          contractCreatedAt: null,
          contractAgeDays: null,
          txCount: null,
          recentCallCount: null,
          totalCallCount: null,
          totalCallerCount: null,
          topMethods: [],
          topCallers: [],
          methodMap: {},
          providerRisk: null,
          rawPayload: {},
          fetchedAt: new Date("2026-05-29T12:00:00.000Z"),
          expiresAt: new Date("2026-05-30T12:00:00.000Z"),
          address: "TFcRN111111111111111111111111FLR5hvh"
        },
        classification: {
          category,
          identity: null,
          confidence: "medium" as const,
          evidence: ["weak metadata"],
          isBoundary: category === "unknown_contract"
        },
        profileSource: "live" as const,
        liveFetchError: "rate limited"
      }));
      const getProfile = vi.fn(async () => ({ address: "fallback-profile" }));
      const analyze = vi.fn(async (_caseFiles: ContractAnalysisCaseFile[]) => []);

      await analyzeIncomingDepositContracts({
        subjectAddress: "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs",
        watchedWallet: "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM",
        depositTxHash: "48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b",
        originPaths: [path],
        enrichContractClassification: enrich,
        getContractIntelligenceProfile: getProfile,
        getTransaction: async () => ({ hash: "contract-in-1" }),
        analyzeContractLlmCaseFiles: analyze
      });

      expect(getProfile).not.toHaveBeenCalled();
      expect(analyze).toHaveBeenCalledTimes(1);
      const [caseFiles] = analyze.mock.calls[0] ?? [];
      expect(caseFiles?.[0]?.contractProfile).toMatchObject({
        intelligenceProfile: { contractAddress: "TFcRN111111111111111111111111FLR5hvh", sourceStatus: "missing" },
        incomingDepositContext: {
          enrichment: {
            profileSource: "live",
            liveFetchError: "rate limited",
            metadata: { tag: "unverified", verified: false },
            classification: { category, identity: null }
          }
        }
      });
    }
  );

  it("returns unavailable verdict when unknown contract analysis is disabled", async () => {
    const getProfile = vi.fn(async () => ({ address: "legacy-profile", sourceStatus: "cached" }));
    const getTransaction = vi.fn(async () => ({ hash: "contract-in-1" }));

    const result = await analyzeIncomingDepositContracts({
      subjectAddress: "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs",
      watchedWallet: "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM",
      depositTxHash: "48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b",
      originPaths: [path],
      getContractIntelligenceProfile: getProfile,
      getTransaction
    });

    expect(getProfile).not.toHaveBeenCalled();
    expect(getTransaction).not.toHaveBeenCalled();
    expect(result.caseFileCount).toBe(0);
    expect(result.verdicts).toEqual([
      expect.objectContaining({
        source: "unavailable",
        verdict: "unknown_insufficient_data",
        decisionRecommendation: "DECLINE",
        contractAddress: "TFcRN111111111111111111111111FLR5hvh"
      })
    ]);
  });

  it("uses the legacy contract profile lookup when enrichment is not provided", async () => {
    const getProfile = vi.fn(async () => ({ address: "legacy-profile", sourceStatus: "cached" }));
    const analyze = vi.fn(async (_caseFiles: ContractAnalysisCaseFile[]) => []);

    await analyzeIncomingDepositContracts({
      subjectAddress: "TEaViAxT9H9WkUSCV9mMnM3DTVWRacfdKs",
      watchedWallet: "TEYPUtFeEjbG7iuvWbJcsx3PiMNsGUUZBM",
      depositTxHash: "48d33ccf504fd97aa741dcbc2e4cccb7225e1bf7859b64d385a338df91ce0c3b",
      originPaths: [path],
      getContractIntelligenceProfile: getProfile,
      getTransaction: async () => ({ hash: "contract-in-1" }),
      analyzeContractLlmCaseFiles: analyze
    });

    expect(getProfile).toHaveBeenCalledWith("TFcRN111111111111111111111111FLR5hvh");
    const [caseFiles] = analyze.mock.calls[0] ?? [];
    expect(caseFiles?.[0]?.contractProfile).toMatchObject({
      intelligenceProfile: { address: "legacy-profile", sourceStatus: "cached" }
    });
  });
});
