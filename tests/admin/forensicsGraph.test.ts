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

  it("projects where-is-money source-policy amount shares into graph weights", () => {
    const result = projectForensicJobGraph(job({
      resultJson: {
        subjectAddress: "TSubject",
        riskScore: 24,
        decision: "ACCEPTABLE",
        coverage: {
          coverageRatio: 1,
          selectedAmountRaw: "46000000000",
          targetAmountRaw: "46000000000"
        },
        assessment: {
          decision: "ACCEPTABLE",
          riskScore: 24,
          provenanceConfidence: 80,
          reasons: [],
          sourcePolicyEvidence: [
            {
              kind: "bridge_router_dex",
              aggregateShare: 0.08826086956521739,
              effectiveShare: 0.08826086956521739,
              pathCount: 1,
              score: 24,
              riskBand: "LOW-MEDIUM",
              proofLevel: "exchange_policy_context",
              reasons: ["Bridge exposure is 8.8% raw / 8.8% effective."],
              shareDetail: {
                scope: "where_is_money",
                targetAmountRaw: "46000000000",
                affectedAmountRaw: "4060000000",
                rawShare: 0.08826086956521739,
                effectiveShare: 0.08826086956521739,
                sourceSeverity: 75,
                shareCap: 30,
                finalContribution: 24
              }
            }
          ]
        },
        originPaths: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.weights).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "weight:source_policy:0",
        source: "source_policy",
        value: 24,
        nodeId: "addr:TSubject",
        metadata: expect.objectContaining({
          scope: "where_is_money",
          affectedAmountRaw: "4060000000",
          targetAmountRaw: "46000000000",
          aggregateShare: 0.08826086956521739,
          effectiveShare: 0.08826086956521739,
          finalContribution: 24
        })
      })
    ]));
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
    expect(result.graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "bundle",
        label: "Funding bundle",
        metadata: expect.objectContaining({
          pathId: "path:0",
          bundleKind: "money_origin_funding_bundle",
          coveredAmountRaw: "135300000000",
          expectedAmountRaw: "135300000000"
        })
      })
    ]));
  });

  it("projects multi-input funding bundles as graph groups with top funders and a tail", () => {
    const result = projectForensicJobGraph(job({
      resultJson: {
        subjectAddress: "TSubject",
        riskScore: 40,
        decision: "REVIEW",
        coverage: {
          coverageRatio: 1,
          targetAmountRaw: "850000000000"
        },
        assessment: {
          decision: "REVIEW",
          riskScore: 40,
          provenanceConfidence: 60,
          reasons: []
        },
        originPaths: [
          {
            verdict: "REVIEW",
            stoppedReason: "unlabeled_service_boundary",
            riskScoreContribution: 40,
            balanceShare: 1,
            pathAddresses: ["TBoundary", "TSubject"],
            steps: [
              { txHash: "tx-hop", fromAddress: "TBoundary", toAddress: "TSubject", amountRaw: "850000000000" }
            ],
            fundingBundles: [
              {
                hopTxHash: "tx-hop",
                hopAddress: "TBoundary",
                expectedAmountRaw: "850000000000",
                coveredAmountRaw: "850000000000",
                coverageRatio: 1,
                members: [
                  { txHash: "tx-600", fromAddress: "TFunder600", toAddress: "TBoundary", originalAmountRaw: "600000000000", usedAmountRaw: "600000000000" },
                  { txHash: "tx-200", fromAddress: "TFunder200", toAddress: "TBoundary", originalAmountRaw: "200000000000", usedAmountRaw: "200000000000" },
                  { txHash: "tx-10", fromAddress: "TFunder10", toAddress: "TBoundary", originalAmountRaw: "10000000000", usedAmountRaw: "10000000000" },
                  { txHash: "tx-40", fromAddress: "TFunder40", toAddress: "TBoundary", originalAmountRaw: "40000000000", usedAmountRaw: "40000000000" }
                ]
              }
            ],
            reasons: ["Path risk contribution"]
          }
        ]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const bundleNode = result.graph.nodes.find((node) => node.kind === "bundle");
    expect(bundleNode?.metadata).toMatchObject({
      pathId: "path:0",
      memberCount: 4,
      funderCount: 4,
      smallTailAmountRaw: "10000000000",
      smallTailCount: 1,
      topFunders: [
        expect.objectContaining({ address: "TFunder600", amountRaw: "600000000000" }),
        expect.objectContaining({ address: "TFunder200", amountRaw: "200000000000" }),
        expect.objectContaining({ address: "TFunder40", amountRaw: "40000000000" })
      ]
    });
    expect(result.graph.paths[0]?.nodeIds).toContain(bundleNode?.id);
    expect(result.graph.edges.filter((edge) => edge.metadata.bundleNodeId === bundleNode?.id)).toHaveLength(4);
  });

  it("allocates selected recent-flow amount by path share when explicit bundle usage is absent", () => {
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
      usedAmountRaw: "135205290000",
      anchorAmountRaw: "135300000000",
      amountRole: "funding_candidate"
    });
  });

  it("preserves bundle member original amounts for clipped transfer steps", () => {
    const result = projectForensicJobGraph(job({
      resultJson: {
        subjectAddress: "TSubject",
        riskScore: 40,
        decision: "REVIEW",
        coverage: {
          coverageRatio: 1,
          targetAmountRaw: "400"
        },
        assessment: {
          decision: "REVIEW",
          riskScore: 40,
          provenanceConfidence: 60,
          reasons: []
        },
        originPaths: [
          {
            verdict: "REVIEW",
            stoppedReason: "unlabeled_service_boundary",
            riskScoreContribution: 40,
            balanceShare: 0.4,
            pathAddresses: ["TSource", "TBoundary", "TSubject"],
            steps: [
              {
                txHash: "tx-member",
                fromAddress: "TSource",
                toAddress: "TBoundary",
                amountRaw: "400"
              },
              {
                txHash: "tx-usage",
                fromAddress: "TOtherSource",
                toAddress: "TBoundary",
                amountRaw: "500",
                amountUsage: {
                  originalAmountRaw: "900",
                  usedAmountRaw: "300",
                  anchorAmountRaw: "300",
                  role: "explicit_usage"
                }
              }
            ],
            fundingBundles: [
              {
                hopTxHash: "tx-hop",
                hopAddress: "TBoundary",
                expectedAmountRaw: "400",
                coveredAmountRaw: "400",
                coverageRatio: 1,
                members: [
                  {
                    txHash: "tx-member",
                    fromAddress: "TSource",
                    toAddress: "TBoundary",
                    originalAmountRaw: "1000",
                    usedAmountRaw: "400"
                  },
                  {
                    txHash: "tx-usage",
                    fromAddress: "TOtherSource",
                    toAddress: "TBoundary",
                    originalAmountRaw: "1200",
                    usedAmountRaw: "500"
                  }
                ]
              }
            ],
            reasons: ["Path risk contribution"]
          }
        ]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const memberEdge = result.graph.edges.find((item) => item.txHash === "tx-member");
    expect(memberEdge?.metadata).toMatchObject({
      originalAmountRaw: "1000",
      usedAmountRaw: "400",
      amountRole: "funding_candidate"
    });
    const explicitEdge = result.graph.edges.find((item) => item.txHash === "tx-usage");
    expect(explicitEdge?.metadata).toMatchObject({
      originalAmountRaw: "900",
      usedAmountRaw: "300",
      anchorAmountRaw: "300",
      amountRole: "explicit_usage"
    });
  });

  it("matches same-transfer bundle members by used step amount instead of overwriting metadata", () => {
    const result = projectForensicJobGraph(job({
      resultJson: {
        subjectAddress: "TSubject",
        riskScore: 40,
        decision: "REVIEW",
        coverage: {
          coverageRatio: 1,
          targetAmountRaw: "500"
        },
        assessment: {
          decision: "REVIEW",
          riskScore: 40,
          provenanceConfidence: 60,
          reasons: []
        },
        originPaths: [
          {
            verdict: "REVIEW",
            stoppedReason: "unlabeled_service_boundary",
            riskScoreContribution: 40,
            balanceShare: 0.5,
            pathAddresses: ["TSource", "TBoundary", "TSubject"],
            steps: [
              {
                txHash: "tx-shared",
                fromAddress: "TSource",
                toAddress: "TBoundary",
                amountRaw: "200",
                timestamp: "2026-06-01T00:01:00.000Z"
              },
              {
                txHash: "tx-shared",
                fromAddress: "TSource",
                toAddress: "TBoundary",
                amountRaw: "300",
                timestamp: "2026-06-01T00:01:00.000Z"
              }
            ],
            fundingBundles: [
              {
                hopTxHash: "tx-hop",
                hopAddress: "TBoundary",
                expectedAmountRaw: "500",
                coveredAmountRaw: "500",
                coverageRatio: 1,
                members: [
                  {
                    txHash: "tx-shared",
                    fromAddress: "TSource",
                    toAddress: "TBoundary",
                    originalAmountRaw: "1000",
                    usedAmountRaw: "200",
                    timestamp: "2026-06-01T00:01:00.000Z"
                  },
                  {
                    txHash: "tx-shared",
                    fromAddress: "TSource",
                    toAddress: "TBoundary",
                    originalAmountRaw: "1200",
                    usedAmountRaw: "300",
                    timestamp: "2026-06-01T00:01:00.000Z"
                  }
                ]
              }
            ],
            reasons: ["Path risk contribution"]
          }
        ]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const sharedEdges = result.graph.edges.filter((item) => item.txHash === "tx-shared");
    expect(sharedEdges).toHaveLength(2);
    expect(sharedEdges[0]?.metadata).toMatchObject({
      originalAmountRaw: "1000",
      usedAmountRaw: "200"
    });
    expect(sharedEdges[1]?.metadata).toMatchObject({
      originalAmountRaw: "1200",
      usedAmountRaw: "300"
    });
  });

  it("marks partial coverage transfer edges as allocated transfers", () => {
    const result = projectForensicJobGraph(job({
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        riskScore: 45,
        decision: "REVIEW",
        coverage: {
          targetAmountRaw: "135300000000"
        },
        assessment: {
          decision: "REVIEW",
          riskScore: 45,
          provenanceConfidence: 60,
          reasons: []
        },
        originPaths: [
          {
            verdict: "REVIEW",
            riskScoreContribution: 45,
            balanceShare: 0.0006,
            pathAddresses: [
              "TRogXTCqB9Y4gvoc5AtDsbBtEP5B4Tvba8",
              "TGw88ZRK3tNjUbbk2yxs1i7rJyz7cMv2Ck",
              "TSubject111111111111111111111111111111"
            ],
            steps: [
              {
                txHash: "13d262658f27b57d5a724c77e4c5b23d487b109d65416e40755117e97d8bdd8e",
                fromAddress: "TRogXTCqB9Y4gvoc5AtDsbBtEP5B4Tvba8",
                toAddress: "TGw88ZRK3tNjUbbk2yxs1i7rJyz7cMv2Ck",
                amountRaw: "828617000000",
                amountUsage: {
                  originalAmountRaw: "828617000000",
                  usedAmountRaw: "81180000",
                  anchorAmountRaw: "135300000000",
                  role: "funding_candidate"
                }
              }
            ],
            reasons: []
          }
        ]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const edge = result.graph.edges.find((item) =>
      item.txHash === "13d262658f27b57d5a724c77e4c5b23d487b109d65416e40755117e97d8bdd8e"
    );

    expect(edge).toMatchObject({
      displayRole: "allocated_transfer",
      metadata: {
        originalAmountRaw: "828617000000",
        usedAmountRaw: "81180000",
        anchorAmountRaw: "135300000000"
      }
    });
  });

  it("marks legacy no_previous_transfer stops as rerun recommended", () => {
    const result = projectForensicJobGraph(job({
      resultJson: {
        subjectAddress: "TSubject",
        riskScore: 35,
        decision: "REVIEW",
        coverage: {
          coverageRatio: 1,
          targetAmountRaw: "1000000000"
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
            amountRaw: "900000000",
            originalAmountRaw: "1200000000",
            selectedAmountRaw: "850000000",
            anchorAmountRaw: "1000000000",
            amountRole: "legacy_path",
            pathAddresses: ["TSource", "TSubject"],
            txHashes: ["tx-legacy"],
            steps: [],
            historyCoverage: [
              {
                address: "TSource",
                targetTimestamp: "2026-05-22T10:15:00.000Z",
                fetchedTransferCount: 20,
                fetchedPageCount: 2,
                oldestFetchedTransferAt: "2026-05-01T10:15:00.000Z",
                reachedTargetHop: true,
                source: "live"
              }
            ],
            rejectedCandidates: [
              {
                txHash: "tx-rejected",
                fromAddress: "TWeakSource",
                toAddress: "TSource",
                amountRaw: "100000000",
                timestamp: "2026-05-22T10:10:00.000Z",
                coverageRatio: 0.1,
                timeDeltaMs: 300000,
                reasons: ["amount_continuity_below_threshold"]
              }
            ],
            reasons: []
          }
        ]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.limitations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "legacy_no_previous_transfer", severity: "review" }),
      expect.objectContaining({ code: "previous_transfers_found_but_not_matching", severity: "review" }),
      expect.objectContaining({
        code: "no_previous_transfer",
        explanation: expect.stringContaining("fetched 20 prior transfer")
      })
    ]));
    const stopNode = result.graph.nodes.find((item) => item.kind === "stop");
    expect(stopNode?.metadata.stopDetails).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stopReason: "no_previous_transfer",
        totalFetchedTransferCount: 20,
        hadIncomingTransfers: true,
        reachedTargetHop: true,
        pagesChecked: 2,
        historySource: "live",
        rejectedCandidates: expect.arrayContaining([
          expect.objectContaining({ txHash: "tx-rejected", reasons: ["amount_continuity_below_threshold"] })
        ])
      })
    ]));
    const edge = result.graph.edges.find((item) => item.txHash === "tx-legacy");
    expect(edge?.metadata).toMatchObject({
      pathId: "path:0",
      originalAmountRaw: "1200000000",
      usedAmountRaw: "850000000",
      anchorAmountRaw: "1000000000",
      amountRole: "legacy_path"
    });
  });

  it("maps incoming continuity stops to previous-transfers-found diagnostics", () => {
    const result = projectForensicJobGraph(job({
      resultJson: {
        subjectAddress: "TSubject",
        riskScore: 35,
        decision: "REVIEW",
        coverage: {
          coverageRatio: 1,
          targetAmountRaw: "1000000000"
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
            stoppedReason: "incoming_seen_but_below_continuity",
            riskScoreContribution: 35,
            pathAddresses: ["TSource", "TSubject"],
            txHashes: ["tx-weak"],
            steps: [
              {
                txHash: "tx-weak",
                fromAddress: "TSource",
                toAddress: "TSubject",
                amountRaw: "900000000",
                timestamp: "2026-05-22T10:15:00.000Z"
              }
            ],
            historyCoverage: [
              {
                address: "TSource",
                targetTimestamp: "2026-05-22T10:15:00.000Z",
                fetchedTransferCount: 5,
                fetchedPageCount: 1,
                oldestFetchedTransferAt: "2026-05-22T09:00:00.000Z",
                reachedTargetHop: true,
                source: "live"
              }
            ],
            rejectedCandidates: [
              {
                txHash: "tx-rejected",
                fromAddress: "TWeakSource",
                toAddress: "TSource",
                amountRaw: "100000000",
                timestamp: "2026-05-22T10:10:00.000Z",
                coverageRatio: 0.1,
                timeDeltaMs: 300000,
                reasons: ["amount_continuity_below_threshold"]
              }
            ],
            reasons: []
          }
        ]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.limitations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "previous_transfers_found_but_not_matching",
        pathId: "path:0",
        explanation: expect.stringContaining("Prior incoming transfers were found (5)")
      })
    ]));
    const stopNode = result.graph.nodes.find((item) => item.kind === "stop");
    expect(stopNode?.metadata.stopDetails).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stopReason: "incoming_seen_but_below_continuity",
        totalFetchedTransferCount: 5,
        pagesChecked: 1,
        rejectedCandidates: expect.arrayContaining([
          expect.objectContaining({ txHash: "tx-rejected" })
        ])
      })
    ]));
  });

  it("adds diagnostic display metadata for incoming history stops", () => {
    const result = projectForensicJobGraph(job({
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        riskScore: 45,
        decision: "REVIEW",
        coverage: {
          coverageRatio: 1,
          targetAmountRaw: "135300000000"
        },
        assessment: {
          decision: "REVIEW",
          riskScore: 45,
          provenanceConfidence: 45,
          reasons: []
        },
        originPaths: [
          {
            verdict: "REVIEW",
            stoppedReason: "incoming_history_not_fetched",
            riskScoreContribution: 45,
            balanceShare: 0.9993,
            pathAddresses: [
              "TGKDVrSource111111111111111111111111",
              "TPxymRMiddle11111111111111111111111",
              "TSubject111111111111111111111111111111"
            ],
            txHashes: ["tx-source-middle", "tx-middle-subject"],
            steps: [
              {
                txHash: "tx-source-middle",
                fromAddress: "TGKDVrSource111111111111111111111111",
                toAddress: "TPxymRMiddle11111111111111111111111",
                amountRaw: "1610000000000",
                timestamp: "2026-04-21T14:58:36.000Z"
              },
              {
                txHash: "tx-middle-subject",
                fromAddress: "TPxymRMiddle11111111111111111111111",
                toAddress: "TSubject111111111111111111111111111111",
                amountRaw: "135210000000",
                timestamp: "2026-04-27T14:33:36.000Z"
              }
            ],
            historyCoverage: [
              {
                address: "TGKDVrSource111111111111111111111111",
                targetTimestamp: "2026-04-21T14:58:36.000Z",
                fetchedTransferCount: 0,
                fetchedPageCount: 2,
                oldestFetchedTransferAt: null,
                reachedTargetHop: false,
                source: "live"
              }
            ],
            rejectedCandidates: [
              {
                txHash: "candidate-after-target",
                fromAddress: "TAfterTarget111111111111111111111",
                toAddress: "TGKDVrSource111111111111111111111111",
                amountRaw: "826610000000",
                timestamp: "2026-04-22T00:00:00.000Z",
                reasons: ["after_target_timestamp"]
              }
            ],
            reasons: [
              "Fetched incoming transfer history did not reach the current hop timestamp; source remains unproven."
            ]
          }
        ]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const stopNode = result.graph.nodes.find((item) => item.kind === "stop");
    expect(stopNode).toMatchObject({
      displayKind: "trace_stop",
      displayLabel: "History incomplete",
      metadata: {
        stopCategory: "data_quality",
        stopTitle: "History not fully fetched",
        stopMeaning: "Fetched incoming history did not reach the required hop time, so source provenance remains unproven.",
        scoreLabel: "Path uncertainty penalty",
        scoreMeaning: "This is not wallet risk. It is a conservative path contribution because source provenance was not proven.",
        stopAmountLabel: "not a transfer",
        lastRealEdgeId: "edge:0:1",
        lastRealHopAmountRaw: "135210000000",
        lastRealHopTimestamp: "2026-04-27T14:33:36.000Z",
        lastRealHopTxHash: "tx-middle-subject"
      }
    });
    expect(stopNode?.metadata.stopDetails).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stopReason: "incoming_history_not_fetched",
        reachedTargetHop: false,
        pagesChecked: 2,
        rejectedCandidates: expect.arrayContaining([
          expect.objectContaining({ txHash: "candidate-after-target", reasons: ["after_target_timestamp"] })
        ])
      })
    ]));

    const stopEdge = result.graph.edges.find((item) => item.type === "stop");
    expect(stopEdge).toMatchObject({
      displayRole: "stop",
      amountRaw: null,
      txHash: null,
      timestamp: null,
      metadata: {
        stopTitle: "History not fully fetched",
        stopCategory: "data_quality",
        stopAmountLabel: "not a transfer",
        lastRealEdgeId: "edge:0:1"
      }
    });

    expect(result.graph.paths[0]).toMatchObject({
      stopReason: "incoming_history_not_fetched",
      stoppedAtNodeId: stopNode?.id,
      stopReasonLabel: "History not fully fetched",
      stopCategory: "data_quality",
      lastRealEdgeId: "edge:0:1"
    });
    expect(result.graph.limitations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "incoming_history_not_fetched",
        label: "History not fully fetched"
      })
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
    expect(result.graph.nodes.find((node) => node.address === "TCounterparty1111111111111111111111111")?.displayLabel).toBe("TCount...111111");
    expect(result.graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "service", address: "TServiceCounterparty11111111111111111111" }),
      expect.objectContaining({ kind: "service", address: "TMergedService11111111111111111111111" })
    ]));
    expect(result.graph.weights.some((weight) => weight.value === 15)).toBe(true);
  });

  it("upgrades service counterparties with bridge metadata to bridge display semantics", () => {
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      resultJson: {
        subjectAddress: "TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe",
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [
          {
            counterpartyAddress: "TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s",
            direction: "outbound",
            volumeRaw: "1285313840000",
            volumeRatio: 0.1704,
            txCount: 8,
            evidenceClass: "service_boundary_context",
            skippedReason: "service_boundary_context",
            serviceCategory: "bridge",
            identity: "Bridgers:Cross-chain Bridge",
            scoreContribution: 0,
            txHashes: []
          }
        ],
        serviceExposureProfiles: [
          {
            exposureScore: 65,
            serviceType: "bridge",
            identity: "Bridgers:Cross-chain Bridge",
            topServiceCounterparties: [
              {
                address: "TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s",
                category: "bridge",
                identity: "Bridgers:Cross-chain Bridge",
                volumeRaw: "1285313840000",
                txCount: 8
              }
            ],
            topMergedServiceFlows: []
          }
        ],
        inboundProvenancePaths: [],
        coverage: { transferEdges: 8 }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const node = result.graph.nodes.find((item) => item.address === "TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s");

    expect(node).toMatchObject({
      kind: "wallet",
      displayKind: "bridge",
      displayLabel: "Bridgers:Cross-chain Bridge",
      weight: 65,
      riskLevel: "HIGH"
    });
  });

  it("marks address-deep outbound direct-counterparty edges as profile context", () => {
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      resultJson: {
        subjectAddress: "TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe",
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [
          {
            counterpartyAddress: "TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s",
            direction: "outbound",
            volumeRaw: "1285313840000",
            volumeRatio: 0.1704,
            txCount: 8,
            evidenceClass: "service_boundary_context",
            skippedReason: "service_boundary_context",
            serviceCategory: "bridge",
            identity: "Bridgers:Cross-chain Bridge",
            scoreContribution: 0,
            txHashes: []
          }
        ],
        serviceExposureProfiles: [],
        inboundProvenancePaths: [],
        coverage: { transferEdges: 8 }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.edges[0]).toMatchObject({
      displayRole: "profile_context",
      metadata: {
        source: "directCounterpartyInteractionProfile",
        direction: "outbound"
      }
    });
  });

  it("projects address-deep direct counterparty profiles when no risk profiles exist", () => {
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        counterpartyRiskProfiles: [],
        serviceExposureProfiles: [
          {
            exposureScore: 0,
            topServiceCounterparties: [],
            topMergedServiceFlows: []
          }
        ],
        directCounterpartyInteractionProfiles: [
          {
            counterpartyAddress: "TDirectOut1111111111111111111111111111",
            direction: "outbound",
            volumeRaw: "70264000000",
            volumeRatio: 0.22,
            txCount: 1,
            firstSeen: "2026-06-01T00:00:00.000Z",
            lastSeen: "2026-06-01T00:00:00.000Z",
            txHashes: ["tx-direct-out"],
            serviceCategory: null,
            identity: null,
            scoreContribution: 9,
            evidenceClass: "counterparty_behavior_context",
            skippedReason: null
          },
          {
            counterpartyAddress: "TDirectIn11111111111111111111111111111",
            direction: "inbound",
            volumeRaw: "50109000000",
            volumeRatio: 0.16,
            txCount: 1,
            firstSeen: "2026-06-01T00:10:00.000Z",
            lastSeen: "2026-06-01T00:10:00.000Z",
            txHashes: ["tx-direct-in"],
            serviceCategory: null,
            identity: null,
            scoreContribution: 7,
            evidenceClass: "counterparty_behavior_context",
            skippedReason: null
          }
        ],
        coverage: {
          transferEdges: 222
        }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        txHash: "tx-direct-out",
        fromNodeId: "addr:TSubject111111111111111111111111111111",
        toNodeId: "addr:TDirectOut1111111111111111111111111111",
        amountRaw: "70264000000"
      }),
      expect.objectContaining({
        txHash: "tx-direct-in",
        fromNodeId: "addr:TDirectIn11111111111111111111111111111",
        toNodeId: "addr:TSubject111111111111111111111111111111",
        amountRaw: "50109000000"
      })
    ]));
    expect(result.graph.weights).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "direct_counterparty_interaction",
        value: 9
      })
    ]));
    expect(result.graph.summary.layerSummary).toMatchObject({
      deepCoverage: {
        transferEdges: 222
      }
    });
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

  it("projects incoming-deposit exposure profile weights", () => {
    const result = projectForensicJobGraph(job({
      kind: "incoming_deposit_check",
      subjectAddress: "TSender1111111111111111111111111111111",
      progressJson: {
        watchedWallet: "TReceiver111111111111111111111111111111",
        sender: "TSender1111111111111111111111111111111",
        depositTxHash: "deposit-tx",
        amountRaw: "100000000000",
        timestamp: "2026-06-04T12:58:54.000Z"
      },
      resultJson: {
        decision: "DECLINE",
        depositRiskScore: 85,
        freshBundleExposure: {
          targetAmountRaw: "100000000000",
          htxHuobiShare: 0.8,
          cleanCexShare: 0.1,
          bridgeRouterDexShare: 0.05,
          unknownContractShare: 0.03,
          riskyLabelShare: 0.02,
          unknownShare: 0.1,
          dominantFreshSource: "htx_huobi",
          reasons: ["Dominant fresh balance-forming source: htx_huobi."]
        },
        walletExposureProfile: {
          windowStart: "2026-06-01T00:00:00.000Z",
          windowEnd: "2026-06-04T12:58:54.000Z",
          transferEventsScanned: 50,
          incomingVolumeRaw: "500000000000",
          outgoingVolumeRaw: "450000000000",
          htxHuobiIncomingShare: 0.6,
          cleanCexIncomingShare: 0.2,
          bridgeRouterDexVolumeShare: 0.04,
          unknownContractVolumeShare: 0.06,
          unknownSourceShare: 0.2,
          inOutVelocityScore: 4,
          scoreContribution: 18,
          reasons: ["Historical HTX/Huobi exposure is high."],
          warnings: []
        },
        originPaths: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const exposureWeights = result.graph.weights
      .map((weight) => ({
        code: (weight as { code?: unknown }).code,
        value: weight.value
      }))
      .filter((weight): weight is { code: string; value: number } => typeof weight.code === "string");
    expect(exposureWeights).toEqual([
      { code: "incoming_fresh_htx_huobi_share", value: 0.8 },
      { code: "incoming_fresh_clean_cex_share", value: 0.1 },
      { code: "incoming_fresh_bridge_router_dex_share", value: 0.05 },
      { code: "incoming_fresh_unknown_contract_share", value: 0.03 },
      { code: "incoming_fresh_risky_label_share", value: 0.02 },
      { code: "incoming_fresh_unknown_share", value: 0.1 },
      { code: "incoming_wallet_htx_huobi_incoming_share", value: 0.6 },
      { code: "incoming_wallet_bridge_router_dex_volume_share", value: 0.04 },
      { code: "incoming_wallet_unknown_contract_volume_share", value: 0.06 },
      { code: "incoming_wallet_unknown_source_share", value: 0.2 },
      { code: "incoming_wallet_in_out_velocity_score", value: 4 },
      { code: "incoming_wallet_background_score", value: 18 }
    ]);
    expect(result.graph.limitations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "incoming_exposure_context_not_source_proof",
        severity: "info"
      })
    ]));
  });

  it("projects shared incoming-deposit source exposure while preserving compatibility weights", () => {
    const result = projectForensicJobGraph(job({
      kind: "incoming_deposit_check",
      subjectAddress: "TSender1111111111111111111111111111111",
      progressJson: {
        watchedWallet: "TReceiver111111111111111111111111111111",
        sender: "TSender1111111111111111111111111111111",
        depositTxHash: "deposit-tx",
        amountRaw: "100000000000",
        timestamp: "2026-06-04T12:58:54.000Z"
      },
      resultJson: {
        decision: "DECLINE",
        depositRiskScore: 85,
        freshBundleExposure: {
          targetAmountRaw: "100000000000",
          htxHuobiShare: 0.8,
          cleanCexShare: 0.1,
          bridgeRouterDexShare: 0.05,
          unknownContractShare: 0.03,
          riskyLabelShare: 0.02,
          unknownShare: 0.1,
          dominantFreshSource: "htx_huobi",
          reasons: []
        },
        walletExposureProfile: {
          windowStart: "2026-06-01T00:00:00.000Z",
          windowEnd: "2026-06-04T12:58:54.000Z",
          transferEventsScanned: 50,
          incomingVolumeRaw: "500000000000",
          outgoingVolumeRaw: "450000000000",
          htxHuobiIncomingShare: 0.6,
          cleanCexIncomingShare: 0.2,
          bridgeRouterDexVolumeShare: 0.04,
          unknownContractVolumeShare: 0.06,
          unknownSourceShare: 0.2,
          inOutVelocityScore: 4,
          scoreContribution: 18,
          reasons: [],
          warnings: []
        },
        sourceBundleExposure: {
          scope: "incoming_deposit",
          targetAmountRaw: "100000000000",
          coveredAmountRaw: "90000000000",
          coverageRatio: 0.9,
          htxHuobiShare: 0.7,
          cleanCexShare: 0.1,
          bridgeRouterDexShare: 0.1,
          unknownContractShare: 0.05,
          riskyLabelShare: 0.05,
          unknownShare: 0,
          dominantSource: "htx_huobi",
          evidenceTxHashes: ["shared-fresh-tx"],
          reasons: ["HTX/Huobi funds 70% of the selected amount."],
          warnings: [],
          budget: {
            maxDepth: 7,
            fetchedAddressCount: 4,
            maxAddressFetches: 12,
            liveTransferReadCount: 8,
            skippedAddressCount: 0,
            exhausted: false,
            exhaustedPhase: null
          },
          unresolvedBoundary: null
        },
        subjectExposureProfile: {
          subjectAddress: "TSender1111111111111111111111111111111",
          windowStart: "2026-06-01T00:00:00.000Z",
          windowEnd: "2026-06-04T12:58:54.000Z",
          transferEventsScanned: 50,
          incomingVolumeRaw: "500000000000",
          outgoingVolumeRaw: "450000000000",
          htxHuobiIncomingShare: 0.6,
          cleanCexIncomingShare: 0.2,
          bridgeRouterDexVolumeShare: 0.04,
          unknownContractVolumeShare: 0.06,
          unknownSourceShare: 0.2,
          inOutVelocityScore: 4,
          scoreContribution: 18,
          reasons: [],
          warnings: []
        },
        originPaths: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.weights).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "incoming_fresh_htx_huobi_share", value: 0.8 }),
      expect.objectContaining({ code: "incoming_wallet_background_score", value: 18 }),
      expect.objectContaining({
        code: "source_bundle_htx_huobi_share",
        source: "source_bundle_exposure",
        value: 0.7,
        nodeId: "addr:TSender1111111111111111111111111111111",
        metadata: expect.objectContaining({
          scope: "incoming_deposit",
          affectedAmountRaw: "90000000000",
          coveredAmountRaw: "90000000000",
          targetAmountRaw: "100000000000",
          evidenceTxHashes: ["shared-fresh-tx"]
        })
      }),
      expect.objectContaining({
        code: "subject_exposure_score_contribution",
        source: "subject_exposure_profile",
        value: 18,
        direction: "context"
      })
    ]));
    const senderNode = result.graph.nodes.find((node) => node.id === "addr:TSender1111111111111111111111111111111");
    expect(senderNode?.metadata).toEqual(expect.objectContaining({
      relatedLimitations: expect.arrayContaining([
        "subject_exposure_context_not_source_proof"
      ])
    }));
  });

  it("projects shared where-is-money source exposure and historical subject context", () => {
    const result = projectForensicJobGraph(job({
      resultJson: {
        subjectAddress: "TSubject",
        riskScore: 70,
        decision: "REVIEW",
        coverage: {
          coverageRatio: 0.7,
          selectedAmountRaw: "700000000",
          targetAmountRaw: "1000000000"
        },
        assessment: {
          decision: "REVIEW",
          riskScore: 70,
          provenanceConfidence: 45,
          reasons: []
        },
        sourceBundleExposure: {
          scope: "where_requested_amount",
          targetAmountRaw: "1000000000",
          coveredAmountRaw: "700000000",
          coverageRatio: 0.7,
          htxHuobiShare: 0.7,
          cleanCexShare: 0,
          bridgeRouterDexShare: 0.25,
          unknownContractShare: 0.05,
          riskyLabelShare: 0,
          unknownShare: 0,
          dominantSource: "htx_huobi",
          evidenceTxHashes: ["fresh-source-tx"],
          reasons: ["HTX/Huobi funds 70% of the selected amount."],
          warnings: ["Source bundle coverage-limited."],
          budget: {
            maxDepth: 7,
            fetchedAddressCount: 12,
            maxAddressFetches: 12,
            liveTransferReadCount: 20,
            skippedAddressCount: 3,
            exhausted: true,
            exhaustedPhase: "trace"
          },
          unresolvedBoundary: {
            kind: "bridge_router_dex",
            affectedShare: 0.25,
            scoreFloor: 55,
            evidenceTxHashes: ["boundary-tx"],
            reason: "Source bundle coverage-limited: unresolved bridge/router/DEX boundary remains after the graph budget stopped."
          }
        },
        subjectExposureProfile: {
          subjectAddress: "TSubject",
          windowStart: "2026-06-01T00:00:00.000Z",
          windowEnd: "2026-06-04T00:00:00.000Z",
          transferEventsScanned: 40,
          incomingVolumeRaw: "2000000000",
          outgoingVolumeRaw: "1800000000",
          htxHuobiIncomingShare: 0.4,
          cleanCexIncomingShare: 0,
          bridgeRouterDexVolumeShare: 0.2,
          unknownContractVolumeShare: 0.1,
          unknownSourceShare: 0.3,
          inOutVelocityScore: 5,
          scoreContribution: 12,
          reasons: ["Historical HTX/Huobi exposure is background context."],
          warnings: []
        },
        originPaths: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.weights).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "source_bundle_htx_huobi_share",
        source: "source_bundle_exposure",
        value: 0.7,
        metadata: expect.objectContaining({
          scope: "where_requested_amount",
          affectedAmountRaw: "700000000",
          targetAmountRaw: "1000000000",
          coveredAmountRaw: "700000000",
          coverageRatio: 0.7,
          dominantSource: "htx_huobi",
          evidenceTxHashes: ["fresh-source-tx"],
          budget: expect.objectContaining({
            exhausted: true,
            exhaustedPhase: "trace"
          })
        })
      }),
      expect.objectContaining({
        code: "source_bundle_unresolved_boundary",
        value: 55,
        direction: "raises_risk",
        metadata: expect.objectContaining({
          kind: "bridge_router_dex",
          affectedShare: 0.25,
          scoreFloor: 55,
          evidenceTxHashes: ["boundary-tx"]
        })
      }),
      expect.objectContaining({
        code: "subject_exposure_score_contribution",
        source: "subject_exposure_profile",
        value: 12,
        direction: "context",
        explanation: expect.stringContaining("Historical")
      }),
      expect.objectContaining({
        code: "subject_exposure_htx_huobi_incoming_share",
        source: "subject_exposure_profile",
        value: 0.4,
        direction: "context",
        label: expect.stringContaining("Historical")
      })
    ]));
    expect(result.graph.limitations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "source_bundle_budget_exhausted",
        explanation: expect.stringContaining("trace")
      }),
      expect.objectContaining({
        code: "source_bundle_unresolved_boundary",
        severity: "review"
      }),
      expect.objectContaining({
        code: "subject_exposure_context_not_source_proof",
        severity: "info"
      })
    ]));
    const subjectNode = result.graph.nodes.find((node) => node.id === "addr:TSubject");
    expect(subjectNode?.metadata).toEqual(expect.objectContaining({
      relatedLimitations: expect.arrayContaining([
        "source_bundle_budget_exhausted",
        "source_bundle_unresolved_boundary",
        "subject_exposure_context_not_source_proof"
      ])
    }));
  });

  it("projects incoming-deposit origin paths instead of only the final deposit edge", () => {
    const result = projectForensicJobGraph(job({
      kind: "incoming_deposit_check",
      subjectAddress: "TSender1111111111111111111111111111111",
      progressJson: {
        watchedWallet: "TReceiver111111111111111111111111111111",
        sender: "TSender1111111111111111111111111111111",
        depositTxHash: "deposit-tx",
        amountRaw: "299970000000",
        timestamp: "2026-06-02T09:46:39.000Z"
      },
      resultJson: {
        decision: "ACCEPTABLE",
        depositRiskScore: 40,
        originCoverage: 0.66,
        provenanceConfidence: 52,
        fundingCoverage: {
          depositFundingCoverageRatio: 1,
          cleanSourceCoverageRatio: 0,
          exactContinuityCoverageRatio: 0.6604
        },
        originPaths: [
          {
            verdict: "ACCEPTABLE",
            score: 35,
            sourcePolicy: "unknown",
            stoppedReason: "no_previous_transfer",
            pathAddresses: [
              "TRoot11111111111111111111111111111111",
              "TMiddle111111111111111111111111111111",
              "TSender1111111111111111111111111111111",
              "TReceiver111111111111111111111111111111"
            ],
            txHashes: ["root-tx", "middle-tx", "deposit-tx"],
            steps: [
              {
                txHash: "root-tx",
                fromAddress: "TRoot11111111111111111111111111111111",
                toAddress: "TMiddle111111111111111111111111111111",
                amountRaw: "454209000000",
                timestamp: "2026-05-28T12:49:27.000Z"
              },
              {
                txHash: "middle-tx",
                fromAddress: "TMiddle111111111111111111111111111111",
                toAddress: "TSender1111111111111111111111111111111",
                amountRaw: "299970000000",
                timestamp: "2026-06-01T18:03:36.000Z"
              },
              {
                txHash: "deposit-tx",
                fromAddress: "TSender1111111111111111111111111111111",
                toAddress: "TReceiver111111111111111111111111111111",
                amountRaw: "299970000000",
                timestamp: "2026-06-02T09:46:39.000Z"
              }
            ],
            amountCoverageRatio: 0.66,
            amountContinuity: "weak",
            proximityHops: 2,
            reasons: ["No previous inbound USDT transfer found."]
          }
        ],
        reasons: ["Sender looks operational."],
        warnings: ["Coverage is partial."]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
      "addr:TRoot11111111111111111111111111111111",
      "addr:TMiddle111111111111111111111111111111",
      "addr:TSender1111111111111111111111111111111",
      "addr:TReceiver111111111111111111111111111111"
    ]));
    expect(result.graph.edges.map((edge) => edge.txHash)).toEqual(expect.arrayContaining([
      "root-tx",
      "middle-tx",
      "deposit-tx"
    ]));
    expect(result.graph.paths).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "path:origin:0",
        stopReason: "no_previous_transfer",
        riskContribution: 35,
        timeSpanMs: expect.any(Number)
      })
    ]));
    const middleEdge = result.graph.edges.find((edge) => edge.txHash === "middle-tx");
    const depositEdge = result.graph.edges.find((edge) => edge.txHash === "deposit-tx");
    expect(middleEdge?.metadata.txGapMs).toBe(364449000);
    expect(depositEdge?.metadata.txGapMs).toBe(56583000);
    expect(result.graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "addr:TMiddle111111111111111111111111111111",
        riskLevel: "MEDIUM",
        weight: 35,
        metadata: expect.objectContaining({
          incomingAmountRaw: "454209000000",
          outgoingAmountRaw: "299970000000",
          relatedPathIds: expect.arrayContaining(["path:origin:0"])
        })
      }),
      expect.objectContaining({
        id: "addr:TReceiver111111111111111111111111111111",
        riskLevel: "MEDIUM",
        weight: 35
      })
    ]));
    expect(result.graph.limitations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "no_previous_transfer", pathId: "path:origin:0" })
    ]));
    expect(result.graph.summary.coverageRatio).toBe(0.66);
    expect(result.graph.summary.layerSummary).toMatchObject({
      fundingCoverage: {
        exactContinuityCoverageRatio: 0.6604
      }
    });
  });

  it("projects incoming-deposit source-policy amount shares into graph weights", () => {
    const sourcePolicyShareDetail = {
      scope: "incoming_deposit",
      targetAmountRaw: "46000000000",
      affectedAmountRaw: "4060000000",
      rawShare: 0.08826086956521739,
      effectiveShare: 0.08826086956521739,
      sourceSeverity: 75,
      valueWeightedRaw: 6.619565217391305,
      shareCap: 30,
      finalContribution: 24
    };

    const result = projectForensicJobGraph(job({
      kind: "incoming_deposit_check",
      subjectAddress: "TSender1111111111111111111111111111111",
      progressJson: {
        watchedWallet: "TReceiver111111111111111111111111111111",
        sender: "TSender1111111111111111111111111111111",
        depositTxHash: "deposit-tx",
        amountRaw: "46000000000",
        timestamp: "2026-06-02T09:46:39.000Z"
      },
      resultJson: {
        decision: "ACCEPTABLE",
        depositRiskScore: 24,
        originCoverage: 1,
        originPaths: [
          {
            verdict: "ACCEPTABLE",
            score: 24,
            sourcePolicy: "bridge_router_dex",
            balanceShare: 0.08826086956521739,
            pathAddresses: [
              "TBridge111111111111111111111111111111",
              "TSender1111111111111111111111111111111",
              "TReceiver111111111111111111111111111111"
            ],
            txHashes: ["bridge-tx", "deposit-tx"],
            steps: [
              {
                txHash: "bridge-tx",
                fromAddress: "TBridge111111111111111111111111111111",
                toAddress: "TSender1111111111111111111111111111111",
                amountRaw: "4060000000",
                timestamp: "2026-06-02T09:40:00.000Z"
              },
              {
                txHash: "deposit-tx",
                fromAddress: "TSender1111111111111111111111111111111",
                toAddress: "TReceiver111111111111111111111111111111",
                amountRaw: "46000000000",
                timestamp: "2026-06-02T09:46:39.000Z"
              }
            ],
            amountCoverageRatio: 1,
            sourcePolicyShareDetail,
            reasons: ["Bridge exposure is a minority of this deposit."]
          }
        ],
        sourcePolicyEvidence: [
          {
            kind: "bridge_router_dex",
            aggregateShare: 0.08826086956521739,
            effectiveShare: 0.08826086956521739,
            pathCount: 1,
            score: 24,
            riskBand: "LOW-MEDIUM",
            proofLevel: "exchange_policy_context",
            reasons: ["Bridge exposure is 8.8% raw / 8.8% effective."],
            shareDetail: sourcePolicyShareDetail
          }
        ]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const bridgeEdge = result.graph.edges.find((edge) => edge.txHash === "bridge-tx");
    expect(result.graph.paths[0]?.amountShare).toBe(1);
    expect(bridgeEdge?.amountShare).toBe(1);
    expect(bridgeEdge?.metadata).toMatchObject({
      amountCoverageRatio: 1,
      balanceShare: 0.08826086956521739,
      attributedShare: 0.08826086956521739,
      attributedShareLabel: "8.83%",
      affectedAmountRaw: "4060000000",
      targetAmountRaw: "46000000000",
      rawShare: 0.08826086956521739,
      effectiveShare: 0.08826086956521739,
      finalContribution: 24
    });
    expect(result.graph.weights).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "weight:incoming_origin:0",
        metadata: expect.objectContaining({
          affectedAmountRaw: "4060000000",
          targetAmountRaw: "46000000000",
          balanceShare: 0.08826086956521739,
          attributedShare: 0.08826086956521739,
          attributedShareLabel: "8.83%",
          effectiveShare: 0.08826086956521739,
          shareCap: 30,
          finalContribution: 24
        })
      }),
      expect.objectContaining({
        id: "weight:incoming_source_policy:0",
        source: "source_policy",
        value: 24,
        metadata: expect.objectContaining({
          kind: "bridge_router_dex",
          riskBand: "LOW-MEDIUM",
          proofLevel: "exchange_policy_context",
          affectedAmountRaw: "4060000000",
          targetAmountRaw: "46000000000",
          aggregateShare: 0.08826086956521739,
          effectiveShare: 0.08826086956521739
        })
      })
    ]));
  });

  it("projects incoming-deposit funding bundles as graph groups", () => {
    const result = projectForensicJobGraph(job({
      kind: "incoming_deposit_check",
      subjectAddress: "TSender1111111111111111111111111111111",
      progressJson: {
        watchedWallet: "TReceiver111111111111111111111111111111",
        sender: "TSender1111111111111111111111111111111",
        depositTxHash: "deposit-tx",
        amountRaw: "850000000000",
        timestamp: "2026-06-02T09:46:39.000Z"
      },
      resultJson: {
        decision: "REVIEW",
        depositRiskScore: 45,
        originPaths: [
          {
            verdict: "REVIEW",
            score: 35,
            sourcePolicy: "unknown",
            stoppedReason: "bridge_router_dex_reached",
            pathAddresses: [
              "TSender1111111111111111111111111111111",
              "TReceiver111111111111111111111111111111"
            ],
            txHashes: ["deposit-tx"],
            steps: [
              {
                txHash: "deposit-tx",
                fromAddress: "TSender1111111111111111111111111111111",
                toAddress: "TReceiver111111111111111111111111111111",
                amountRaw: "850000000000",
                timestamp: "2026-06-02T09:46:39.000Z"
              }
            ],
            fundingBundles: [
              {
                targetTxHash: "deposit-tx",
                targetFromAddress: "TSender1111111111111111111111111111111",
                targetToAddress: "TReceiver111111111111111111111111111111",
                targetAmountRaw: "850000000000",
                bundleAmountRaw: "850000000000",
                bundleCoverageRatio: 1,
                windowStart: "2026-06-01T09:46:39.000Z",
                windowEnd: "2026-06-02T09:46:39.000Z",
                fundingTxHashes: ["tx-600", "tx-200", "tx-40", "tx-10"],
                fundingAddresses: ["TFunder600", "TFunder200", "TFunder40", "TFunder10"],
                fundingFunders: [
                  { address: "TFunder600", amountRaw: "600000000000", txHashes: ["tx-600"] },
                  { address: "TFunder200", amountRaw: "200000000000", txHashes: ["tx-200"] },
                  { address: "TFunder40", amountRaw: "40000000000", txHashes: ["tx-40"] },
                  { address: "TFunder10", amountRaw: "10000000000", txHashes: ["tx-10"] }
                ]
              }
            ],
            amountCoverageRatio: 1,
            amountContinuity: "strong",
            proximityHops: 1,
            reasons: ["Funding bundle covered the deposit."]
          }
        ]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const bundleNode = result.graph.nodes.find((node) => node.kind === "bundle");
    expect(bundleNode?.metadata).toMatchObject({
      bundleKind: "incoming_deposit_funding_bundle",
      targetTxHash: "deposit-tx",
      bundleAmountRaw: "850000000000",
      funderCount: 4,
      smallTailAmountRaw: "10000000000",
      topFunders: [
        expect.objectContaining({ address: "TFunder600", amountRaw: "600000000000" }),
        expect.objectContaining({ address: "TFunder200", amountRaw: "200000000000" }),
        expect.objectContaining({ address: "TFunder40", amountRaw: "40000000000" })
      ]
    });
    expect(result.graph.edges.filter((edge) => edge.metadata.bundleNodeId === bundleNode?.id)).toHaveLength(4);
    expect(result.graph.limitations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "incoming_funding_bundle", pathId: "path:origin:0" })
    ]));
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
