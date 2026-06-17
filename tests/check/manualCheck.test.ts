import { describe, expect, it } from "vitest";
import { checkAddress, checkTransactionHash } from "../../src/check/manualCheck";

describe("manual checks", () => {
  it("checks an address using stored labels", async () => {
    const recorded: unknown[] = [];
    const result = await checkAddress("TSubject111111111111111111111111111111", {
      getLabelsForAddress: async () => [
        {
          address: "TSubject111111111111111111111111111111",
          label: "scam",
          source: "service_admin",
          createdByTelegramId: "1",
          createdAt: new Date()
        }
      ],
      recordRiskEvaluation: async (evaluation) => {
        recorded.push(evaluation);
      }
    });

    expect(result.report.level).toBe("CRITICAL");
    expect(result.subjectAddress).toBe("TSubject111111111111111111111111111111");
    expect(result.observations[0]).toMatchObject({ code: "internal_label_scam", signalGroup: "internal_label" });
    expect(result.rawEvidence[0]).toMatchObject({ sourceType: "internal_label" });
    expect(recorded).toHaveLength(1);
  });

  it("checks an address using optional risk signal providers", async () => {
    const result = await checkAddress("TSubject111111111111111111111111111111", {
      getLabelsForAddress: async () => [],
      getRiskSignalsForAddress: async () => ({
        graphSignals: [{ code: "risky_1_hop", message: "1-hop exposure to risky address", scoreImpact: 35 }],
        behaviorSignals: [{ code: "fast_transit", message: "Fast transit pattern detected", scoreImpact: 30 }],
        amlSignals: []
      })
    });

    expect(result.report.level).toBe("HIGH");
    expect(result.report.reasons.map((reason) => reason.code)).toEqual(["risky_1_hop", "fast_transit"]);
    expect(result.observations.map((observation) => observation.code)).toEqual(["risky_1_hop", "fast_transit"]);
  });

  it("persists supplemental exposure evidence with the address risk evaluation", async () => {
    const recorded: Array<{ observations: unknown[]; rawEvidence: unknown[] }> = [];
    const result = await checkAddress("TSubject111111111111111111111111111111", {
      getLabelsForAddress: async () => [],
      getRiskSignalsForAddress: async () => ({
        graphSignals: [
          {
            code: "forensic_service_exposure",
            message: "Service exposure candidate; manual review required.",
            scoreImpact: 50,
            source: "forensic_route_search",
            confidence: "high",
            severity: "high",
            evidenceRef: "raw_exposure_1"
          }
        ],
        behaviorSignals: [],
        amlSignals: [],
        rawEvidence: [
          {
            id: "raw_exposure_1",
            source: "forensic_route_search",
            sourceType: "detector_output",
            chain: "tron",
            address: "TSubject111111111111111111111111111111",
            txHash: null,
            observedTransactionHash: null,
            evidenceJson: { exposureScore: 100 }
          }
        ],
        observations: [
          {
            id: "detector_observation_1",
            subjectChain: "tron",
            subjectAddress: "TSubject111111111111111111111111111111",
            subjectTxHash: null,
            observedTransactionHash: null,
            signalGroup: "graph",
            code: "forensic_service_exposure",
            message: "Service exposure profile requires manual review.",
            scoreImpact: 100,
            confidence: "high",
            severity: "critical",
            source: "forensic_route_search",
            policyVersion: "test-policy",
            rawEvidenceId: "raw_exposure_1"
          }
        ],
        serviceExposureProfiles: [
          {
            subjectAddress: "TSubject111111111111111111111111111111",
            totalOutgoingRaw: "100000000",
            totalOutgoingCount: 1,
            directServiceVolumeRatio: 1,
            directServiceTxRatio: 1,
            indirectServiceVolumeRatio: 0,
            indirectServiceTxRatio: 0,
            mergedServiceVolumeRatio: 0,
            mergedServiceGroupCount: 0,
            combinedServiceVolumeRatio: 1,
            combinedServiceTxRatio: 1,
            dominantCategory: "bridge_pool",
            categoryBreakdown: [],
            topServiceCounterparties: [],
            topMergedServiceFlows: [],
            fastestServiceExitMs: null,
            bestAmountPreservationRatio: null,
            exposureScore: 100,
            features: []
          }
        ],
        boundaryExposureProfiles: [
          {
            subjectAddress: "TSubject111111111111111111111111111111",
            incomingBoundaryVolumeRaw: "0",
            outgoingBoundaryVolumeRaw: "100000000",
            incomingBoundaryVolumeRatio: 0,
            outgoingBoundaryVolumeRatio: 1,
            directBoundaryTxCount: 1,
            twoHopBoundaryTxCount: 0,
            topBoundaryEntities: [],
            categoryBreakdown: [],
            flows: [],
            contextScore: 15,
            features: []
          }
        ],
        walletRoleProfiles: [
          {
            subjectAddress: "TSubject111111111111111111111111111111",
            primaryRole: "cashout_service",
            roles: [
              {
                role: "cashout_service",
                confidence: "medium",
                score: 40,
                reasons: []
              }
            ],
            evidenceStrength: "context",
            features: []
          }
        ],
        missingChecks: ["Contract intelligence unavailable for TService"]
      }),
      recordRiskEvaluation: async (evaluation) => {
        recorded.push(evaluation);
      }
    });

    expect(result.report.reasons[0]).toMatchObject({
      code: "forensic_service_exposure",
      scoreImpact: 15,
      evidenceRef: "raw_exposure_1"
    });
    expect(result.rawEvidence).toEqual([
      expect.objectContaining({ id: "raw_exposure_1", sourceType: "detector_output" })
    ]);
    expect(result.observations).toEqual([
      expect.objectContaining({ code: "forensic_service_exposure", rawEvidenceId: "raw_exposure_1" })
    ]);
    expect(result.serviceExposureProfiles).toHaveLength(1);
    expect(result.boundaryExposureProfiles).toHaveLength(1);
    expect(result.walletRoleProfiles).toHaveLength(1);
    expect(result.missingChecks).toEqual(["Contract intelligence unavailable for TService"]);
    expect(recorded[0].rawEvidence).toHaveLength(1);
    expect(recorded[0].observations).toHaveLength(1);
  });

  it("records an empty evaluation for low-risk checks without fake reasons", async () => {
    const recorded: Array<{ observations: unknown[]; rawEvidence: unknown[] }> = [];

    const result = await checkAddress("TSubject111111111111111111111111111111", {
      getLabelsForAddress: async () => [],
      recordRiskEvaluation: async (evaluation) => {
        recorded.push(evaluation);
      }
    });

    expect(result.report.score).toBe(0);
    expect(result.observations).toEqual([]);
    expect(result.rawEvidence).toEqual([]);
    expect(recorded).toEqual([{ rawEvidence: [], observations: [] }]);
  });

  it("checks a transaction hash by extracting the TRC20 sender", async () => {
    const result = await checkTransactionHash("abc123", {
      tronClient: {
        async listIncomingTrc20Transfers() {
          return [];
        },
        async getTransaction() {
          return {
            trc20TransferInfo: [
              {
                from_address: "TSender111111111111111111111111111111",
                contract_address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
              }
            ]
          };
        }
      },
      getLabelsForAddress: async () => []
    });

    expect(result.subjectAddress).toBe("TSender111111111111111111111111111111");
    expect(result.report.level).toBe("LOW");
    expect(result.observations).toEqual([]);
  });

  it("prefers official USDT transfer sender when transaction info has several token transfers", async () => {
    const result = await checkTransactionHash("abc123", {
      tronClient: {
        async listIncomingTrc20Transfers() {
          return [];
        },
        async getTransaction() {
          return {
            trc20TransferInfo: [
              {
                from_address: "TNoise1111111111111111111111111111111",
                contract_address: "TNotUsdt1111111111111111111111111111"
              },
              {
                from_address: "TUsdtSender11111111111111111111111111",
                contract_address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
              }
            ]
          };
        }
      },
      getLabelsForAddress: async () => []
    });

    expect(result.subjectAddress).toBe("TUsdtSender11111111111111111111111111");
  });

  it("throws when a transaction sender cannot be extracted", async () => {
    await expect(
      checkTransactionHash("abc123", {
        tronClient: {
          async listIncomingTrc20Transfers() {
            return [];
          },
          async getTransaction() {
            return { trc20TransferInfo: [] };
          }
        },
        getLabelsForAddress: async () => []
      })
    ).rejects.toThrow("Could not extract sender from transaction: abc123");
  });

  it("does not trust token abbreviation without the official USDT contract", async () => {
    await expect(
      checkTransactionHash("abc123", {
        tronClient: {
          async listIncomingTrc20Transfers() {
            return [];
          },
          async getTransaction() {
            return {
              trc20TransferInfo: [
                {
                  from_address: "TSpoofed11111111111111111111111111111",
                  contract_address: "TNotUsdt1111111111111111111111111111",
                  tokenInfo: { tokenAbbr: "USDT" }
                }
              ]
            };
          }
        },
        getLabelsForAddress: async () => []
      })
    ).rejects.toThrow("Could not extract sender from transaction: abc123");
  });

  it("does not fall back to transaction owner when TRC20 sender is unavailable", async () => {
    await expect(
      checkTransactionHash("abc123", {
        tronClient: {
          async listIncomingTrc20Transfers() {
            return [];
          },
          async getTransaction() {
            return {
              contractData: { owner_address: "TOwner1111111111111111111111111111111" },
              ownerAddress: "TOwner2222222222222222222222222222222"
            };
          }
        },
        getLabelsForAddress: async () => []
      })
    ).rejects.toThrow("Could not extract sender from transaction: abc123");
  });
});
