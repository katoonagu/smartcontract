import { describe, expect, it } from "vitest";
import { projectForensicJobGraph } from "../../src/admin/forensicsGraph";
import type { ForensicCheckJob } from "../../src/storage/repositories";

function job(overrides: Partial<ForensicCheckJob> = {}): ForensicCheckJob {
  return {
    id: "job-1",
    kind: "where_is_money_check",
    subjectAddress: "TSubject111111111111111111111111111111",
    status: "completed",
    windowStart: new Date("2026-06-01T00:00:00.000Z"),
    windowEnd: new Date("2026-06-01T01:00:00.000Z"),
    priority: 100,
    chatId: null,
    messageId: null,
    requestedBy: "123",
    progressJson: {},
    resultJson: {},
    rawEvidenceIds: ["raw-1"],
    observationIds: ["obs-1"],
    lastError: null,
    createdAt: new Date("2026-06-01T00:00:01.000Z"),
    updatedAt: new Date("2026-06-01T00:10:00.000Z"),
    startedAt: new Date("2026-06-01T00:00:02.000Z"),
    completedAt: new Date("2026-06-01T00:10:00.000Z"),
    ...overrides
  };
}

describe("projectForensicJobGraph", () => {
  it("projects a completed where-is-money job into graph JSON", () => {
    const result = projectForensicJobGraph(job({
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        riskScore: 35,
        decision: "ACCEPTABLE",
        coverage: {
          coverageRatio: 0.95,
          checkedScope: "drain_episode",
          anchorCoverageRatio: 0.75,
          episodeCoverageRatio: 0.45,
          drainEpisode: {
            anchorTxHash: "anchor-1",
            startTimestamp: "2026-06-01T00:02:00.000Z",
            endTimestamp: "2026-06-01T00:09:00.000Z",
            episodeOutgoingRaw: "2000000000",
            episodeSelectedRaw: "900000000",
            episodeCoverageRatio: 0.45,
            outgoingTxHashes: ["out-1", "anchor-1"],
            bridgeOutgoingRaw: "1500000000",
            bridgeOutgoingShare: 0.75
          },
          selectedAmountRaw: "950000000",
          targetAmountRaw: "1000000000",
          selectedInboundTxCount: 2
        },
        layerSummary: {
          fastCheck: {
            riskLevel: "LOW",
            score: 12,
            note: "Fast snapshot."
          },
          whereIsMoney: {
            checkedScope: "drain_episode",
            note: "Where is money checked a drain episode."
          },
          deepCheck: {
            serviceExposureRaw: null,
            dominantCategory: null,
            note: "Deep context unavailable."
          }
        },
        assessment: {
          decision: "ACCEPTABLE",
          riskScore: 35,
          provenanceConfidence: 67,
          reasons: ["95% of the requested amount was covered"]
        },
        originPaths: [
          {
            verdict: "REVIEW",
            stoppedReason: "weak_amount_or_time_continuity",
            riskScoreContribution: 20,
            amountRaw: "500000000",
            txHashes: ["tx-1"],
            addresses: [
              "TSource1111111111111111111111111111111",
              "TSubject111111111111111111111111111111"
            ]
          }
        ]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.job.id).toBe("job-1");
    expect(result.graph.subject.address).toBe("TSubject111111111111111111111111111111");
    expect(result.graph.summary.decision).toBe("ACCEPTABLE");
    expect(result.graph.summary.riskScore).toBe(35);
    expect(result.graph.summary.coverageRatio).toBe(0.95);
    expect(result.graph.summary.checkedScope).toBe("drain_episode");
    expect(result.graph.summary.anchorCoverageRatio).toBe(0.75);
    expect(result.graph.summary.episodeCoverageRatio).toBe(0.45);
    expect(result.graph.summary.drainEpisode).toMatchObject({
      episodeOutgoingRaw: "2000000000",
      bridgeOutgoingShare: 0.75
    });
    expect(result.graph.summary.layerSummary).toMatchObject({
      whereIsMoney: {
        checkedScope: "drain_episode"
      }
    });
    expect(result.graph.nodes.some((node) => node.kind === "subject")).toBe(true);
    expect(result.graph.nodes.some((node) => node.kind === "stop")).toBe(true);
    expect(result.graph.edges.some((edge) => edge.txHash === "tx-1")).toBe(true);
    expect(result.graph.paths[0]?.stopReason).toBe("weak_amount_or_time_continuity");
    expect(result.graph.weights[0]?.value).toBe(20);
    expect(result.graph.evidence.map((item) => item.id)).toContain("raw-1");
  });

  it("returns not_ready for queued and running jobs", () => {
    expect(projectForensicJobGraph(job({ status: "queued" }))).toMatchObject({
      ok: false,
      status: "not_ready"
    });
    expect(projectForensicJobGraph(job({ status: "running" }))).toMatchObject({
      ok: false,
      status: "not_ready"
    });
  });

  it("projects the persisted nested where-is-money report shape", () => {
    const result = projectForensicJobGraph(job({
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        whereIsMoneyReport: {
          subjectAddress: "TSubject111111111111111111111111111111",
          riskScore: 72,
          decision: "REVIEW",
          coverage: {
            coverageRatio: 0.42,
            selectedAmountRaw: "420000000",
            targetAmountRaw: "1000000000"
          },
          assessment: {
            decision: "REVIEW",
            riskScore: 72,
            provenanceConfidence: 38,
            reasons: ["Nested report reason"]
          },
          originPaths: [
            {
              verdict: "REVIEW",
              stoppedReason: "service_boundary",
              riskScoreContribution: 31,
              amountRaw: "420000000",
              txHashes: ["tx-nested"],
              addresses: [
                "TNestedSource1111111111111111111111111",
                "TSubject111111111111111111111111111111"
              ]
            }
          ]
        }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.summary.decision).toBe("REVIEW");
    expect(result.graph.summary.riskScore).toBe(72);
    expect(result.graph.summary.coverageRatio).toBe(0.42);
    expect(result.graph.paths[0]?.stopReason).toBe("service_boundary");
    expect(result.graph.edges.some((edge) => edge.txHash === "tx-nested")).toBe(true);
    expect(result.graph.weights[0]?.value).toBe(31);
  });

  it("projects amount usage and typed weights for selected provenance edges", () => {
    const result = projectForensicJobGraph(job({
      resultJson: {
        subjectAddress: "TSubject",
        riskScore: 45,
        decision: "REVIEW",
        coverage: {
          coverageRatio: 1,
          selectedAmountRaw: "135300000000",
          targetAmountRaw: "135300000000",
          checkedScope: "selected_anchor"
        },
        assessment: {
          decision: "REVIEW",
          riskScore: 45,
          provenanceConfidence: 54,
          reasons: []
        },
        originPaths: [
          {
            verdict: "REVIEW",
            stoppedReason: "unlabeled_service_boundary",
            riskScoreContribution: 45,
            balanceShare: 0.9993,
            txHashes: ["tx-main"],
            pathAddresses: ["TBoundary", "TSubject"],
            steps: [
              {
                txHash: "tx-main",
                fromAddress: "TBoundary",
                toAddress: "TSubject",
                amountRaw: "1885262475832",
                timestamp: "2026-05-05T13:31:30.000Z"
              }
            ],
            fundingBundles: [
              {
                hopTxHash: "tx-main",
                hopAddress: "TBoundary",
                expectedAmountRaw: "135300000000",
                coveredAmountRaw: "135300000000",
                coverageRatio: 1,
                members: []
              }
            ],
            reasons: ["Path risk contribution"]
          }
        ]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const edge = result.graph.edges.find((item) => item.txHash === "tx-main");
    expect(edge?.metadata).toMatchObject({
      originalAmountRaw: "1885262475832",
      usedAmountRaw: "135300000000",
      amountRole: "funding_candidate"
    });
    expect(result.graph.weights).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "origin_path", label: "Path risk contribution", value: 45 })
    ]));
    expect(result.graph.limitations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "multi_input_bundle_used", severity: "info" })
    ]));
  });

  it("marks legacy no_previous_transfer stops as rerun recommended", () => {
    const result = projectForensicJobGraph(job({
      resultJson: {
        subjectAddress: "TSubject",
        riskScore: 35,
        decision: "REVIEW",
        coverage: {
          coverageRatio: 1
        },
        assessment: {
          decision: "REVIEW",
          riskScore: 35,
          provenanceConfidence: 54,
          reasons: []
        },
        originPaths: [
          {
            verdict: "REVIEW",
            stoppedReason: "no_previous_transfer",
            riskScoreContribution: 35,
            pathAddresses: ["TSource", "TSubject"],
            txHashes: ["tx-legacy"],
            steps: [],
            reasons: []
          }
        ]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.limitations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "legacy_no_previous_transfer", severity: "review" })
    ]));
  });

  it("scopes evidence refs to paths that declare each evidence id", () => {
    const result = projectForensicJobGraph(job({
      rawEvidenceIds: ["raw-a", "raw-b"],
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        riskScore: 55,
        decision: "REVIEW",
        coverage: {
          coverageRatio: 0.9
        },
        assessment: {
          decision: "REVIEW",
          riskScore: 55,
          provenanceConfidence: 70,
          reasons: []
        },
        originPaths: [
          {
            verdict: "REVIEW",
            stoppedReason: "weak_amount_or_time_continuity",
            riskScoreContribution: 20,
            amountRaw: "500000000",
            evidenceIds: ["raw-a"],
            txHashes: ["tx-a"],
            addresses: [
              "TSourceA111111111111111111111111111111",
              "TSubject111111111111111111111111111111"
            ]
          },
          {
            verdict: "DECLINE",
            stoppedReason: "risky_source_wallet",
            riskScoreContribution: 45,
            amountRaw: "400000000",
            evidenceIds: ["raw-b"],
            txHashes: ["tx-b"],
            addresses: [
              "TSourceB111111111111111111111111111111",
              "TSubject111111111111111111111111111111"
            ]
          }
        ]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const rawA = result.graph.evidence.find((item) => item.id === "raw-a");
    const rawB = result.graph.evidence.find((item) => item.id === "raw-b");
    expect(rawA?.pathIds).toContain("path:0");
    expect(rawA?.pathIds).not.toContain("path:1");
    expect(rawB?.pathIds).toContain("path:1");
    expect(rawB?.pathIds).not.toContain("path:0");
  });

  it("keeps job raw evidence unscoped when paths do not declare evidence ids", () => {
    const result = projectForensicJobGraph(job({
      rawEvidenceIds: ["raw-a", "raw-b"],
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        riskScore: 55,
        decision: "REVIEW",
        coverage: {
          coverageRatio: 0.9
        },
        assessment: {
          decision: "REVIEW",
          riskScore: 55,
          provenanceConfidence: 70,
          reasons: []
        },
        originPaths: [
          {
            verdict: "REVIEW",
            stoppedReason: "weak_amount_or_time_continuity",
            riskScoreContribution: 20,
            amountRaw: "500000000",
            txHashes: ["tx-a"],
            addresses: [
              "TSourceA111111111111111111111111111111",
              "TSubject111111111111111111111111111111"
            ]
          },
          {
            verdict: "DECLINE",
            stoppedReason: "risky_source_wallet",
            riskScoreContribution: 45,
            amountRaw: "400000000",
            txHashes: ["tx-b"],
            addresses: [
              "TSourceB111111111111111111111111111111",
              "TSubject111111111111111111111111111111"
            ]
          }
        ]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.paths.every((path) => path.evidenceIds.length === 0)).toBe(true);
    expect(result.graph.edges.every((edge) => edge.evidenceIds.length === 0)).toBe(true);
    expect(result.graph.evidence.map((item) => item.id).sort()).toEqual(["raw-a", "raw-b"]);
    expect(result.graph.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "raw-a", pathIds: [], edgeIds: [], nodeIds: [] }),
      expect.objectContaining({ id: "raw-b", pathIds: [], edgeIds: [], nodeIds: [] })
    ]));
  });

  it("projects address-deep profile arrays into context nodes and weights", () => {
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        counterpartyRiskProfiles: [
          {
            counterpartyAddress: "TCounterparty1111111111111111111111111",
            label: "darknet_exchange_proximity",
            score: 70,
            direction: "inbound",
            amountRaw: "100000000"
          }
        ],
        serviceExposureProfiles: [
          {
            exposureScore: 15,
            topServiceCounterparties: [
              {
                address: "TServiceCounterparty11111111111111111111",
                category: "exchange",
                identity: "Known Exchange",
                volumeRaw: "50000000",
                txCount: 2
              }
            ],
            topMergedServiceFlows: [
              {
                intermediateAddress: "TIntermediate111111111111111111111111",
                serviceAddress: "TMergedService11111111111111111111111",
                category: "bridge_pool",
                identity: null,
                incomingRaw: "40000000",
                outgoingServiceRaw: "39000000",
                sourceTxCount: 1,
                serviceTxCount: 1,
                amountPreservationRatio: 0.975,
                firstSourceTransferAt: "2026-06-01T00:01:00.000Z",
                lastServiceTransferAt: "2026-06-01T00:02:00.000Z"
              }
            ]
          }
        ],
        coverage: {
          transferEdges: 4
        }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.nodes.some((node) => node.address === "TCounterparty1111111111111111111111111")).toBe(true);
    expect(result.graph.weights.some((weight) => weight.value === 70)).toBe(true);
    expect(result.graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "service", address: "TServiceCounterparty11111111111111111111" }),
      expect.objectContaining({ kind: "service", address: "TMergedService11111111111111111111111" })
    ]));
    expect(result.graph.weights.some((weight) => weight.value === 15)).toBe(true);
  });

  it("projects incoming-deposit jobs from progress and embedded result data", () => {
    const result = projectForensicJobGraph(job({
      kind: "incoming_deposit_check",
      subjectAddress: "TSender1111111111111111111111111111111",
      progressJson: {
        watchedWallet: "TReceiver111111111111111111111111111111",
        sender: "TSender1111111111111111111111111111111",
        depositTxHash: "deposit-tx",
        amountRaw: "250000000"
      },
      resultJson: {
        decision: "REVIEW",
        depositRiskScore: 48
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.subject.role).toBe("sender");
    expect(result.graph.summary.riskScore).toBe(48);
    expect(result.graph.edges[0]).toMatchObject({
      txHash: "deposit-tx",
      amountRaw: "250000000",
      type: "transfer",
      weight: 48
    });
    expect(result.graph.weights[0]?.value).toBe(48);
    expect(new Set(result.graph.nodes.map((node) => node.id)).size).toBe(result.graph.nodes.length);
  });

  it("rejects incoming-deposit jobs without a receiver wallet", () => {
    const result = projectForensicJobGraph(job({
      kind: "incoming_deposit_check",
      subjectAddress: "TSender1111111111111111111111111111111",
      progressJson: {
        sender: "TSender1111111111111111111111111111111",
        depositTxHash: "deposit-tx",
        amountRaw: "250000000"
      },
      resultJson: {
        decision: "REVIEW",
        depositRiskScore: 48
      }
    }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected malformed incoming deposit projection.");
    expect(result.status).toBe("malformed");
  });
});
