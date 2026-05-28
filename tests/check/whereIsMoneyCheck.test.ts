import { describe, expect, it } from "vitest";
import { runWhereIsMoneyCheck } from "../../src/check/whereIsMoneyCheck";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import type { AddressLabel, ContractLlmVerdictSummary, ForensicRouteEdge, RiskReport, ServiceClassification } from "../../src/types";
import type { TronscanApprovalChange } from "../../src/tron/tronClient";

const subject = "TSubject111111111111111111111111111111";
const oldSender = "TOldSender11111111111111111111111111";
const cleanSender = "TCleanSender11111111111111111111111";
const bridge = "TBridge1111111111111111111111111111";
const binance = "TBinance111111111111111111111111111";
const victim = "TVictim1111111111111111111111111111";
const spender = "TSpender111111111111111111111111111";
const operator = "TOperator111111111111111111111111111";
const wrapperContract = "TWrapper11111111111111111111111111";

function edge(
  id: string,
  fromAddress: string,
  toAddress: string,
  amountRaw: string,
  timestamp: string,
  edgeType: ForensicRouteEdge["edgeType"] = "normal_transfer"
): ForensicRouteEdge {
  return {
    id,
    txHash: id,
    fromAddress,
    toAddress,
    amountRaw,
    timestamp: new Date(timestamp),
    method: edgeType === "transfer_from" ? "transferFrom" : "transfer",
    edgeType
  };
}

function service(category: ServiceClassification["category"], identity: string | null): ServiceClassification {
  return {
    category,
    identity,
    confidence: "high",
    evidence: identity ? [`tag:${identity}`] : [],
    isBoundary: category !== "none"
  };
}

const lowFastRisk: RiskReport = {
  subjectAddress: subject,
  level: "LOW",
  score: 0,
  reasons: []
};

function approval(overrides: Partial<TronscanApprovalChange> = {}): TronscanApprovalChange {
  return {
    txHash: "tx-approval",
    ownerAddress: victim,
    spenderAddress: spender,
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    amountRaw: "999999999999",
    isUnlimited: true,
    timestamp: new Date("2026-05-22T09:55:00.000Z"),
    confirmed: true,
    contractRet: "SUCCESS",
    ...overrides
  };
}

describe("runWhereIsMoneyCheck", () => {
  it("traces only balance-forming inbound transfers and ignores older unrelated inflows", async () => {
    const calls: string[] = [];
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        subject,
        [
          edge("tx-old", oldSender, subject, "20000000000", "2026-05-20T10:00:00.000Z"),
          edge("tx-bridge-subject", bridge, subject, "3000000000", "2026-05-22T10:10:00.000Z"),
          edge("tx-clean-subject", cleanSender, subject, "2000000000", "2026-05-22T10:15:00.000Z")
        ]
      ],
      [cleanSender, [edge("tx-binance-clean", binance, cleanSender, "2000000000", "2026-05-22T10:00:00.000Z")]],
      [oldSender, [edge("tx-binance-old", binance, oldSender, "20000000000", "2026-05-20T09:00:00.000Z")]]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "5000000000",
      fetchEdgesForAddress: async (address) => {
        calls.push(address);
        return byAddress.get(address) ?? [];
      },
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === binance) return service("cex", "Binance");
        if (address === bridge) return service("bridge", "Allbridge");
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      maxDepth: 7,
      beamWidth: 8,
      maxAddressFetches: 60,
      maxEdgesPerAddress: 40
    });

    expect(report.currentUsdtBalanceRaw).toBe("5000000000");
    expect(report.balanceFormingTransfers.map((transfer) => transfer.txHash)).toEqual(["tx-clean-subject", "tx-bridge-subject"]);
    expect(calls).not.toContain(oldSender);
    expect(report.originPaths).toEqual(expect.arrayContaining([
      expect.objectContaining({ balanceTransferTxHash: "tx-clean-subject", verdict: "ACCEPTABLE" }),
      expect.objectContaining({ balanceTransferTxHash: "tx-bridge-subject", verdict: "DECLINE" })
    ]));
    expect(report.originPaths.find((path) => path.balanceTransferTxHash === "tx-clean-subject")?.steps).toEqual([
      expect.objectContaining({ txHash: "tx-binance-clean", amountRaw: "2000000000" }),
      expect.objectContaining({ txHash: "tx-clean-subject", amountRaw: "2000000000" })
    ]);
    expect(report.senderInteractionProfiles).toEqual(expect.arrayContaining([
      expect.objectContaining({
        balanceTransferTxHash: "tx-clean-subject",
        senderAddress: cleanSender,
        incomingTxCount: 1,
        outgoingTxCount: 0,
        fundingCandidates: [
          expect.objectContaining({ txHash: "tx-binance-clean", amountPreservationRatio: 1 })
        ]
      }),
      expect.objectContaining({
        balanceTransferTxHash: "tx-bridge-subject",
        senderAddress: bridge,
        incomingTxCount: 0,
        outgoingTxCount: 0,
        fundingCandidates: []
      })
    ]));
    expect(report.decision).toBe("DECLINE");
    expect(report.riskScore).toBe(78);
    expect(report.coverage).toMatchObject({
      selectedInboundTxCount: 2,
      selectedInboundVolumeRaw: "5000000000",
      currentBalanceCoverageRatio: 1,
      partial: false
    });
  });

  it("declines when balance-forming funds are exact approval-drain transferFrom proceeds", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        subject,
        [
          edge("tx-transferfrom-drain", victim, subject, "2576000000", "2026-05-22T10:00:00.000Z", "transfer_from")
        ]
      ],
      [victim, []]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "2576000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk,
      getTransaction: async () => ({ ownerAddress: spender }),
      listTrc20ApprovalChanges: async () => [approval()],
      getUsdtRestrictionStatus: async (address) => ({
        subjectAddress: address,
        tokenContract: TRON_USDT_CONTRACT_ADDRESS,
        tokenSymbol: "USDT",
        tokenStandard: "TRC20",
        decimals: 6,
        isBlacklisted: false,
        balanceRaw: "0",
        checkedAt: "2026-05-22T10:00:00.000Z",
        evidenceStrength: "exact_contract_state",
        blacklistEventTxHash: null,
        blacklistEventTimestamp: null,
        blacklistEventBlock: null,
        methods: {
          blacklist: "isBlackListed(address)",
          balance: "balanceOf(address)"
        }
      })
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      maxDepth: 7,
      beamWidth: 8,
      maxAddressFetches: 60,
      maxEdgesPerAddress: 40
    });

    expect(report.decision).toBe("DECLINE");
    expect(report.riskScore).toBe(90);
    expect(report.decisionReasons[0]).toContain("exact approval-drain transferFrom");
    expect(report.approvalDrainProvenanceProfiles).toEqual([
      expect.objectContaining({
        victimAddress: victim,
        spenderAddress: spender,
        drainTxHash: "tx-transferfrom-drain",
        hopDepth: 0,
        score: 90,
        evidenceStrength: "exact_approval_and_transfer_from"
      })
    ]);
  });

  it("declines TFagr-style wrapper drains even when the visible method is not transferFrom", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [
        subject,
        [
          {
            ...edge("tx-wrapper-drain", victim, subject, "2576000000", "2026-05-22T10:00:00.000Z"),
            method: "Verify20"
          }
        ]
      ],
      [victim, []]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "2576000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk,
      getTransaction: async (txHash) => txHash === "tx-wrapper-drain"
        ? {
            ownerAddress: operator,
            contractData: { contract_address: wrapperContract, function_selector: "Verify20(address,address,uint256)" },
            trigger_info: { methodName: "Verify20" }
          }
        : {
            ownerAddress: cleanSender,
            contractData: { contract_address: TRON_USDT_CONTRACT_ADDRESS, function_selector: "transfer(address,uint256)" },
            trigger_info: { methodName: "transfer" }
          },
      listTrc20ApprovalChanges: async (input) => [
        approval({
          ownerAddress: input.ownerAddress,
          spenderAddress: input.spenderAddress,
          amountRaw: "999999999999"
        })
      ],
      getUsdtRestrictionStatus: async (address) => ({
        subjectAddress: address,
        tokenContract: TRON_USDT_CONTRACT_ADDRESS,
        tokenSymbol: "USDT",
        tokenStandard: "TRC20",
        decimals: 6,
        isBlacklisted: false,
        balanceRaw: "0",
        checkedAt: "2026-05-22T10:00:00.000Z",
        evidenceStrength: "exact_contract_state",
        blacklistEventTxHash: null,
        blacklistEventTimestamp: null,
        blacklistEventBlock: null,
        methods: {
          blacklist: "isBlackListed(address)",
          balance: "balanceOf(address)"
        }
      })
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.decision).toBe("DECLINE");
    expect(report.riskScore).toBe(90);
    expect(report.approvalDrainProvenanceProfiles[0]).toMatchObject({
      spenderAddress: wrapperContract,
      operatorAddress: operator,
      spenderResolution: "wrapper_contract",
      score: 90
    });
  });

  it("records a service-boundary guard without adding approval-drain auto-decline", async () => {
    const router = "TRouter11111111111111111111111111111";
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-router-subject", router, subject, "1000000000", "2026-05-22T10:05:00.000Z")]],
      [
        router,
        [
          edge("tx-drain-to-router", victim, router, "1000000000", "2026-05-22T10:00:00.000Z", "transfer_from"),
          edge("tx-router-subject", router, subject, "1000000000", "2026-05-22T10:05:00.000Z")
        ]
      ]
    ]);

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "1000000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === router) return service("router", "Known router");
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk,
      getTransaction: async () => ({ ownerAddress: spender, trigger_info: { methodName: "transferFrom" } }),
      listTrc20ApprovalChanges: async (input) => [
        approval({
          ownerAddress: input.ownerAddress,
          spenderAddress: input.spenderAddress,
          amountRaw: "1000000000"
        })
      ]
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.approvalDrainProvenanceProfiles).toEqual([]);
    expect(report.decisionReasons).not.toEqual(expect.arrayContaining([
      expect.stringContaining("exact approval-drain transferFrom")
    ]));
    expect(report.approvalDrainReviewFindings).toEqual([
      expect.objectContaining({
        drainTxHash: "tx-drain-to-router",
        falsePositiveGuards: [
          expect.objectContaining({ code: "receiver_service_boundary" })
        ]
      })
    ]);
  });

  it("uses an LLM contract verdict to decline an uncertain wrapper approval-drain case", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-clean-subject", cleanSender, subject, "1100000000", "2026-05-22T10:05:00.000Z")]],
      [
        cleanSender,
        [
          edge("tx-wrapper-drain", victim, cleanSender, "1100000000", "2026-05-22T10:00:00.000Z")
        ]
      ],
      [victim, []]
    ]);
    const llmVerdict: ContractLlmVerdictSummary = {
      source: "llm",
      providerLabel: "deepseek",
      model: "deepseek-v4-flash",
      contractAddress: wrapperContract,
      caseFileHash: "case-hash",
      cacheId: null,
      verdict: "drainer_like",
      confidence: 0.82,
      contractRiskScore: 88,
      decisionRecommendation: "DECLINE",
      reasons: ["Wrapper method hides token movement."],
      citedEvidenceIds: ["tx-wrapper-drain"],
      falsePositiveNotes: []
    };
    let capturedCaseFiles: unknown[] = [];

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "1100000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === wrapperContract) return service("unknown_contract", null);
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk,
      getTransaction: async (txHash) => txHash === "tx-wrapper-drain"
        ? {
            ownerAddress: operator,
            contractData: { contract_address: wrapperContract, function_selector: "Verify20(address,address,uint256)" },
            trigger_info: { methodName: "Verify20" }
          }
        : {
            ownerAddress: cleanSender,
            contractData: { contract_address: TRON_USDT_CONTRACT_ADDRESS, function_selector: "transfer(address,uint256)" },
            trigger_info: { methodName: "transfer" }
          },
      listTrc20ApprovalChanges: async () => [],
      getContractIntelligenceProfile: async (address) => address === wrapperContract
        ? {
            contractAddress: wrapperContract,
            methodMap: { deadbeef: "Verify20(address,address,uint256)" },
            topMethods: [{ methodId: "deadbeef", signature: "Verify20(address,address,uint256)", count: 1, ratio: 1 }],
            providerTags: [],
            publicTags: [],
            rawPayload: { source_status: "available" },
            isVerified: false,
            providerRisk: null,
            hasTransferFromSelector: false,
            hasOwnerOnlyPattern: false,
            lowMetadata: true,
            activityLevel: "low"
          }
        : null,
      analyzeContractLlmCaseFiles: async (caseFiles) => {
        capturedCaseFiles = caseFiles;
        return [llmVerdict];
      }
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.decision).toBe("DECLINE");
    expect(report.riskScore).toBe(88);
    expect(report.contractLlmVerdicts).toEqual([llmVerdict]);
    expect(capturedCaseFiles).toHaveLength(1);
    expect(capturedCaseFiles[0]).toMatchObject({
      contractAddress: wrapperContract,
      approvalDrainReviewFindings: [
        expect.objectContaining({
          drainTxHash: "tx-wrapper-drain",
          reason: "approval_not_found"
        })
      ]
    });
    expect(report.decisionReasons).toEqual(expect.arrayContaining([
      "AI contract verdict: drainer_like 82% confidence; Wrapper method hides token movement."
    ]));
  });

  it("runs LLM contract reporting for deterministic unknown-contract boundary declines", async () => {
    const byAddress = new Map<string, ForensicRouteEdge[]>([
      [subject, [edge("tx-clean-subject", cleanSender, subject, "1100000000", "2026-05-22T10:05:00.000Z")]],
      [cleanSender, [edge("tx-contract-clean", wrapperContract, cleanSender, "1100000000", "2026-05-22T10:00:00.000Z")]],
      [wrapperContract, []]
    ]);
    const llmVerdict: ContractLlmVerdictSummary = {
      source: "llm",
      providerLabel: "deepseek",
      model: "deepseek-v4-flash",
      contractAddress: wrapperContract,
      caseFileHash: "case-hash",
      cacheId: null,
      verdict: "unknown_suspicious",
      confidence: 0.7,
      contractRiskScore: 83,
      decisionRecommendation: "DECLINE",
      reasons: ["Unknown contract boundary has no clean service identity."],
      citedEvidenceIds: ["tx-contract-clean"],
      falsePositiveNotes: ["Could be a legitimate private router, but no service evidence was available."]
    };
    let capturedCaseFiles: unknown[] = [];

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "1100000000",
      fetchEdgesForAddress: async (address) => byAddress.get(address) ?? [],
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === wrapperContract) return service("unknown_contract", null);
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk,
      getContractIntelligenceProfile: async (address) => address === wrapperContract
        ? {
            contractAddress: wrapperContract,
            providerTags: [],
            publicTags: [],
            methodMap: {},
            rawPayload: {},
            lowMetadata: true,
            activityLevel: "low"
          }
        : null,
      analyzeContractLlmCaseFiles: async (caseFiles) => {
        capturedCaseFiles = caseFiles;
        return [llmVerdict];
      }
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.decision).toBe("DECLINE");
    expect(report.riskScore).toBe(78);
    expect(report.contractLlmVerdicts).toEqual([llmVerdict]);
    expect(capturedCaseFiles).toHaveLength(1);
    expect(capturedCaseFiles[0]).toMatchObject({
      contractAddress: wrapperContract,
      approvalDrainReviewFindings: [],
      originPaths: [
        expect.objectContaining({
          rootSourceAddress: wrapperContract,
          stoppedReason: "decline_boundary_reached"
        })
      ],
      serviceClassification: {
        category: "unknown_contract"
      }
    });
  });

  it("uses the latest 60 transfers for sparse windows so older exchange origins are still traced", async () => {
    const calls: Array<{ address: string; mode: "window" | "latest"; limit?: number }> = [];
    const sender = "TSender11111111111111111111111111111";
    const sourceWindowEdges = [
      edge("tx-sender-subject", sender, subject, "1123000000", "2026-05-22T10:00:00.000Z")
    ];
    const senderLatestEdges = [
      edge("tx-whitebit-sender", binance, sender, "1123000000", "2025-11-01T10:00:00.000Z")
    ];

    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => "1123000000",
      fetchEdgesForAddress: async (address) => {
        calls.push({ address, mode: "window" });
        return address === subject ? sourceWindowEdges : [];
      },
      fetchLatestEdgesForAddress: async (address, limit) => {
        calls.push({ address, mode: "latest", limit });
        if (address === subject) return sourceWindowEdges;
        if (address === sender) return senderLatestEdges;
        return [];
      },
      getLabelsForAddress: async (): Promise<AddressLabel[]> => [],
      getClassificationForAddress: async (address) => {
        if (address === binance) return service("cex", "WhiteBIT");
        return service("none", null);
      },
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z"),
      maxDepth: 7,
      beamWidth: 8,
      maxAddressFetches: 60,
      maxEdgesPerAddress: 40
    });

    expect(calls).toEqual(expect.arrayContaining([
      { address: subject, mode: "latest", limit: 60 },
      { address: sender, mode: "latest", limit: 60 }
    ]));
    expect(report.originPaths[0]).toMatchObject({
      balanceTransferTxHash: "tx-sender-subject",
      pathAddresses: [binance, sender, subject],
      txHashes: ["tx-whitebit-sender", "tx-sender-subject"],
      verdict: "DECLINE",
      riskScoreContribution: 55
    });
    expect(report.decisionReasons[0]).toContain("WhiteBIT exposure (100% of current balance)");
    expect(report.decisionReasons.join(" ")).toContain("WhiteBIT");
    expect(report.decisionReasons.join(" ")).not.toMatch(/direct scam proof|exact scam|approval-drain|blacklist/i);
    expect(report.decision).toBe("DECLINE");
    expect(report.userDecision).toBe("DECLINE");
    expect(report.internalDecision).toBe("DECLINE");
    expect(report.proofLevel).toBe("exchange_policy_decline");
    expect(report.riskScore).toBe(55);
  });

  it("returns review incomplete when balance lookup fails", async () => {
    const report = await runWhereIsMoneyCheck({
      getTrc20Balance: async () => null,
      fetchEdgesForAddress: async () => [],
      getLabelsForAddress: async () => [],
      getClassificationForAddress: async () => service("none", null),
      getFastWalletRisk: async () => lowFastRisk
    }, {
      sourceAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-24T00:00:00.000Z")
    });

    expect(report.decision).toBe("DECLINE");
    expect(report.riskScore).toBe(65);
    expect(report.coverage.partial).toBe(true);
    expect(report.decisionReasons).toEqual(["Clean source could not be proven; exchange policy declines this wallet by safe default. Current USDT balance is zero or unavailable; balance-origin trace cannot prove source funds."]);
  });
});
