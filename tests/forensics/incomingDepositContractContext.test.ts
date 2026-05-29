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
});
