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
  it("projects an address fast check job into admin graph", () => {
    const subject = "TFastSubject11111111111111111111111111";
    const incomingWallet = "TFastIncomingWallet111111111111111111111";
    const bridgePool = "TFastBridgePool11111111111111111111111";
    const cex = "TFastCex111111111111111111111111111";
    const hotWallet = "TFastHotWallet1111111111111111111111";
    const unknownContract = "TFastUnknownContract11111111111111111";
    const bridge = "TFastBridge111111111111111111111111";
    const dex = "TFastDex111111111111111111111111111";
    const router = "TFastRouter111111111111111111111111";
    const swapAdapter = "TFastSwapAdapter11111111111111111111";

    const result = projectForensicJobGraph(job({
      kind: "address_fast_check",
      subjectAddress: subject,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-31T00:00:00.000Z"),
      resultJson: {
        subjectAddress: subject,
        windowStart: "2026-05-01T00:00:00.000Z",
        windowEnd: "2026-05-31T00:00:00.000Z",
        fastRiskReport: {
          decision: "REVIEW",
          score: 60,
          level: "HIGH",
          confidence: "medium",
          reasons: [
            {
              code: "fast_counterparty_tops_review",
              message: "Fast counterparty tops need review.",
              scoreImpact: 44
            }
          ]
        },
        fastCounterpartyTopsProfile: {
          subjectAddress: subject,
          windowStart: "2026-05-01T00:00:00.000Z",
          windowEnd: "2026-05-31T00:00:00.000Z",
          incomingVolumeRaw: "1000000000",
          outgoingVolumeRaw: "800000000",
          incomingTxCount: 4,
          outgoingTxCount: 5,
          topIncomingCounterparties: [
            {
              address: incomingWallet,
              direction: "incoming",
              volumeRaw: "700000000",
              txCount: 2,
              volumeRatio: 0.7,
              firstSeen: "2026-05-02T00:00:00.000Z",
              lastSeen: "2026-05-03T00:00:00.000Z",
              sampleTxHashes: ["fast-in-1"],
              category: null,
              identity: null,
              selectedAsDeepPriorityHint: true
            },
            {
              address: bridgePool,
              direction: "incoming",
              volumeRaw: "300000000",
              txCount: 1,
              volumeRatio: 0.3,
              firstSeen: null,
              lastSeen: null,
              sampleTxHashes: ["fast-in-bridge-pool"],
              category: "bridge_pool",
              identity: "Bridge pool",
              selectedAsDeepPriorityHint: false
            }
          ],
          topOutgoingCounterparties: [
            {
              address: cex,
              direction: "outgoing",
              volumeRaw: "500000000",
              txCount: 2,
              volumeRatio: 0.625,
              firstSeen: null,
              lastSeen: "2026-05-04T00:00:00.000Z",
              sampleTxHashes: ["fast-out-cex"],
              category: "cex",
              identity: "HTX",
              selectedAsDeepPriorityHint: false
            },
            {
              address: hotWallet,
              direction: "outgoing",
              volumeRaw: "200000000",
              txCount: 1,
              volumeRatio: 0.25,
              firstSeen: null,
              lastSeen: null,
              sampleTxHashes: ["fast-out-hot"],
              category: "hot_wallet",
              identity: "Exchange hot wallet",
              selectedAsDeepPriorityHint: false
            },
            {
              address: unknownContract,
              direction: "outgoing",
              volumeRaw: "100000000",
              txCount: 1,
              volumeRatio: 0.125,
              firstSeen: null,
              lastSeen: null,
              sampleTxHashes: ["fast-out-unknown-contract"],
              category: "unknown_contract",
              identity: null,
              selectedAsDeepPriorityHint: false
            },
            {
              address: bridge,
              direction: "outgoing",
              volumeRaw: "90000000",
              txCount: 1,
              volumeRatio: 0.1125,
              firstSeen: null,
              lastSeen: null,
              sampleTxHashes: ["fast-out-bridge"],
              category: "bridge",
              identity: "Bridge",
              selectedAsDeepPriorityHint: true
            }
          ],
          topServiceCounterparties: [
            {
              address: bridge,
              direction: "service",
              volumeRaw: "90000000",
              txCount: 1,
              volumeRatio: 0.1125,
              firstSeen: null,
              lastSeen: null,
              sampleTxHashes: ["fast-out-bridge"],
              category: "bridge",
              identity: "Bridge",
              selectedAsDeepPriorityHint: true
            },
            {
              address: dex,
              direction: "service",
              volumeRaw: "70000000",
              txCount: 1,
              volumeRatio: 0.0875,
              firstSeen: null,
              lastSeen: null,
              sampleTxHashes: ["fast-service-dex"],
              category: "dex",
              identity: "DEX",
              selectedAsDeepPriorityHint: false
            },
            {
              address: router,
              direction: "service",
              volumeRaw: "60000000",
              txCount: 1,
              volumeRatio: 0.075,
              firstSeen: null,
              lastSeen: null,
              sampleTxHashes: ["fast-service-router"],
              category: "router",
              identity: "Router",
              selectedAsDeepPriorityHint: false
            },
            {
              address: swapAdapter,
              direction: "service",
              volumeRaw: "50000000",
              txCount: 1,
              volumeRatio: 0.0625,
              firstSeen: null,
              lastSeen: null,
              sampleTxHashes: ["fast-service-swap"],
              category: "swap_adapter",
              identity: "Swap adapter",
              selectedAsDeepPriorityHint: false
            }
          ],
          categoryBreakdown: []
        },
        missingChecks: ["where_is_money", "address_deep_check"],
        followUpJobs: {
          whereIsMoneyJobId: "where-job-fast-1",
          addressDeepCheckJobId: "deep-job-fast-1"
        }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.job.kind).toBe("address_fast_check");
    expect(result.graph.summary.checkedScope).toBe("fast_check");
    expect(result.graph.summary.riskScore).toBe(60);
    expect(result.graph.summary.riskLevel).toBe("HIGH");
    expect(result.graph.summary.topReasons).toEqual(["Fast counterparty tops need review."]);
    expect(result.graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `addr:${subject}`, kind: "subject", displayKind: "subject_wallet" }),
      expect.objectContaining({ address: incomingWallet, displayKind: "wallet" }),
      expect.objectContaining({ address: bridgePool, displayKind: "bridge" }),
      expect.objectContaining({ address: cex, displayKind: "cex" }),
      expect.objectContaining({ address: hotWallet, displayKind: "cex" }),
      expect.objectContaining({ address: unknownContract, displayKind: "smart_contract" }),
      expect.objectContaining({ address: bridge, displayKind: "bridge" }),
      expect.objectContaining({ address: dex, displayKind: "dex_contract" }),
      expect.objectContaining({ address: router, displayKind: "dex_contract" }),
      expect.objectContaining({ address: swapAdapter, displayKind: "dex_contract" })
    ]));
    expect(result.graph.nodes.find((node) => node.address === cex)?.metadata.boundaryIdentity).toMatchObject({
      displayName: expect.any(String),
      isBoundary: true
    });
    expect(result.graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fromNodeId: `addr:${incomingWallet}`,
        toNodeId: `addr:${subject}`,
        displayRole: "profile_context",
        amountRaw: "700000000"
      }),
      expect.objectContaining({
        fromNodeId: `addr:${subject}`,
        toNodeId: `addr:${cex}`,
        displayRole: "profile_context",
        amountRaw: "500000000"
      }),
      expect.objectContaining({
        fromNodeId: `addr:${subject}`,
        toNodeId: `addr:${bridge}`,
        displayRole: "profile_context",
        amountRaw: "90000000"
      })
    ]));
    expect(result.graph.edges.filter((edge) => edge.toNodeId === `addr:${bridge}`)).toHaveLength(1);
    expect(result.graph.summary.layerSummary).toMatchObject({
      fastCheckTops: {
        incoming: expect.arrayContaining([expect.objectContaining({ address: incomingWallet })]),
        outgoing: expect.arrayContaining([expect.objectContaining({ address: cex })]),
        services: expect.arrayContaining([expect.objectContaining({ address: bridge })])
      },
      followUpJobs: {
        whereIsMoneyJobId: "where-job-fast-1",
        addressDeepCheckJobId: "deep-job-fast-1"
      }
    });
    expect(result.graph.limitations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "where_is_money", severity: "review" }),
      expect.objectContaining({ code: "address_deep_check", severity: "review" })
    ]));
  });

  it("uses score-derived fast-check risk level over stale persisted levels", () => {
    const subject = "TFastSubject11111111111111111111111111";
    const result = projectForensicJobGraph(job({
      kind: "address_fast_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        fastRiskReport: {
          score: 60,
          level: "MEDIUM",
          riskLevel: "MEDIUM",
          decision: "DECLINE",
          reasons: []
        },
        fastCounterpartyTopsProfile: {
          subjectAddress: subject,
          topIncomingCounterparties: [],
          topOutgoingCounterparties: [],
          topServiceCounterparties: []
        }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.summary.riskLevel).toBe("HIGH");
    expect(result.graph.summary.riskClarity.riskLevel).toBe("HIGH");
  });

  it("rejects address fast check jobs with unusable top profile shape", () => {
    const result = projectForensicJobGraph(job({
      kind: "address_fast_check",
      resultJson: {
        fastRiskReport: {
          decision: "REVIEW",
          riskScore: 44
        },
        fastCounterpartyTopsProfile: {}
      }
    }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected malformed fast check projection.");
    expect(result.status).toBe("malformed");
  });

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

  it("marks exact approval-drain where provenance as node intelligence", () => {
    const subject = "TSubject111111111111111111111111111111";
    const result = projectForensicJobGraph(job({
      kind: "where_is_money_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        riskScore: 95,
        decision: "DECLINE",
        coverage: {},
        assessment: {
          reasons: ["Exact approval-drain provenance reaches checked wallet via 0 hop(s)."]
        },
        originPaths: [],
        approvalDrainProvenanceProfiles: [{
          score: 95,
          subjectAddress: subject,
          firstReceiverAddress: subject,
          victimAddress: "TVictim111111111111111111111111111111",
          spenderAddress: "TSpender11111111111111111111111111111",
          evidenceStrength: "exact_approval_and_transfer_from",
          drainTxHash: "drain-tx-1"
        }]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.nodes.find((node) => node.address === subject)?.metadata.nodeIntelligence).toMatchObject({
      role: "drainer",
      label: "Drainer",
      evidenceStrength: "hard",
      source: "approval_drain_provenance",
      confidence: 95,
      signals: ["approval_drain_exact_provenance", "drain_tx:drain-tx-1"]
    });
  });

  it("shows a stop node when where risk exists but no origin path was graphable", () => {
    const subject = "TNoOrigin11111111111111111111111111111";
    const result = projectForensicJobGraph(job({
      kind: "where_is_money_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        riskScore: 65,
        decision: "DECLINE",
        coverage: {
          coverageRatio: 0,
          anchorCoverageRatio: 0,
          episodeCoverageRatio: 0,
          selectedAmountRaw: "0",
          targetAmountRaw: "1300000000",
          checkedScope: "drain_episode"
        },
        assessment: {
          reasons: ["Clean source could not be proven; exchange policy declines this wallet by safe default."],
          warnings: ["No balance-forming transfers were available."]
        },
        originPaths: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "subject", address: subject }),
      expect.objectContaining({
        kind: "stop",
        displayKind: "trace_stop",
        metadata: expect.objectContaining({
          reason: "no_graphable_origin_path",
          lastStopReason: "No balance-forming transfers"
        })
      })
    ]));
    expect(result.graph.edges).toEqual([expect.objectContaining({
      type: "stop",
      displayRole: "stop",
      fromNodeId: `addr:${subject}`,
      verdict: "risk"
    })]);
    expect(result.graph.paths).toEqual([expect.objectContaining({
      stopReason: "no_graphable_origin_path",
      stoppedAtNodeId: "stop:where:no_graphable_origin_path"
    })]);
    expect(result.graph.limitations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "where_origin_paths_missing", severity: "review" })
    ]));
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

  it("keeps address-deep decision unknown for profile context without final risk", () => {
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
        directCounterpartyInteractionProfiles: [],
        inboundProvenanceProfiles: [],
        boundaryExposureProfiles: [],
        serviceExposureProfiles: [],
        coverage: {
          transferEdges: 4
        }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.summary).toMatchObject({
      decision: "UNKNOWN",
      riskScore: 70,
      riskLevel: "HIGH",
      checkedScope: "profile_context"
    });
    expect(result.graph.summary.riskClarity).toMatchObject({
      finalRiskScore: null,
      decisionStatus: "manual_required"
    });
    expect(result.graph.summary.layerSummary).toMatchObject({
      riskDisplayMode: "profile_context"
    });
  });

  it("does not summarize missing address-deep profile scores as zero risk", () => {
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        counterpartyRiskProfiles: [
          {
            counterpartyAddress: "TCounterparty1111111111111111111111111",
            label: "unscored_counterparty_context",
            direction: "inbound",
            amountRaw: "100000000"
          }
        ],
        directCounterpartyInteractionProfiles: [
          {
            counterpartyAddress: "TDirect111111111111111111111111111111",
            direction: "outbound",
            volumeRaw: "50000000",
            txCount: 1
          }
        ],
        inboundProvenanceProfiles: [],
        boundaryExposureProfiles: [],
        serviceExposureProfiles: [
          {
            topServiceCounterparties: [
              {
                address: "TService111111111111111111111111111111",
                category: "exchange",
                volumeRaw: "25000000"
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
    expect(result.graph.summary).toMatchObject({
      decision: "UNKNOWN",
      riskScore: null,
      riskLevel: null,
      confidence: null,
      checkedScope: "missing"
    });
    expect(result.graph.summary.layerSummary).toMatchObject({
      riskDisplayMode: "missing"
    });
  });

  it("surfaces address-deep risk and decision from result data", () => {
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        decision: "REVIEW",
        riskScore: 48,
        assessment: {
          reasons: ["Direct counterparty context requires review."]
        },
        coverage: {
          coverageRatio: 0.72,
          checkedScope: "deep_profile_context"
        },
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        inboundProvenanceProfiles: [],
        boundaryExposureProfiles: [],
        serviceExposureProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.summary).toMatchObject({
      decision: "REVIEW",
      riskScore: 48,
      riskLevel: "MEDIUM",
      coverageRatio: 0.72,
      checkedScope: "deep_profile_context",
      topReasons: ["Direct counterparty context requires review."]
    });
    expect(result.graph.summary.layerSummary).toMatchObject({
      riskDisplayMode: "final_result"
    });
  });

  it("uses address-deep assessment risk and decision when result fields are missing", () => {
    const cases = [
      {
        assessment: {
          decision: "DECLINE",
          riskScore: 48,
          reasons: ["Assessment riskScore requires review."]
        },
        expectedDecision: "DECLINE",
        expectedRiskScore: 48,
        expectedRiskLevel: "MEDIUM",
        expectedReasons: ["Assessment riskScore requires review."]
      },
      {
        assessment: {
          decision: "ACCEPTABLE",
          score: 66,
          reasons: ["Assessment score is explicit."]
        },
        expectedDecision: "ACCEPTABLE",
        expectedRiskScore: 66,
        expectedRiskLevel: "HIGH",
        expectedReasons: ["Assessment score is explicit."]
      }
    ] as const;

    cases.forEach((testCase) => {
      const result = projectForensicJobGraph(job({
        kind: "address_deep_check",
        resultJson: {
          subjectAddress: "TSubject111111111111111111111111111111",
          assessment: testCase.assessment,
          coverage: {
            coverageRatio: 0.72
          },
          counterpartyRiskProfiles: [],
          directCounterpartyInteractionProfiles: [],
          inboundProvenanceProfiles: [],
          boundaryExposureProfiles: [],
          serviceExposureProfiles: []
        }
      }));

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.message);
      expect(result.graph.summary).toMatchObject({
        decision: testCase.expectedDecision,
        riskScore: testCase.expectedRiskScore,
        riskLevel: testCase.expectedRiskLevel,
        coverageRatio: 0.72,
        checkedScope: "final_result",
        topReasons: testCase.expectedReasons
      });
      expect(result.graph.summary.layerSummary).toMatchObject({
        riskDisplayMode: "final_result"
      });
    });
  });

  it("projects address-deep boundary exposure flows as multi-hop service paths", () => {
    const subject = "TSubject111111111111111111111111111111";
    const via = "TVia111111111111111111111111111111111";
    const cex = "TCexBoundary1111111111111111111111111";
    const dex = "TVjuTE3V5bMVdpfNhid8kD2v35T2k1u1Br";

    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        boundaryExposureProfiles: [
          {
            contextScore: 15,
            directBoundaryTxCount: 0,
            twoHopBoundaryTxCount: 1,
            flows: [
              {
                direction: "inbound",
                depth: 2,
                viaAddress: via,
                boundaryAddress: cex,
                boundaryCategory: "cex",
                boundaryIdentity: "Binance-Hot 6",
                amountRaw: "100400000000",
                boundaryAmountRaw: "16039056111",
                amountPreservationRatio: 0.1597,
                subjectTxHash: "subject-hop-tx",
                boundaryTxHash: "boundary-hop-tx",
                firstTransferAt: "2026-06-02T10:11:42.000Z",
                lastTransferAt: "2026-06-11T10:19:03.000Z"
              }
            ]
          }
        ],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        inboundProvenanceProfiles: [],
        serviceExposureProfiles: [],
        missingChecks: [
          `Expansion stopped at service boundary ${dex} (dex)`
        ],
        coverage: { transferEdges: 222 }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        address: cex,
        kind: "service",
        displayKind: "cex",
        displayLabel: "Binance-Hot 6"
      }),
      expect.objectContaining({ address: via, kind: "wallet" }),
      expect.objectContaining({
        address: dex,
        kind: "contract",
        displayKind: "dex_contract"
      })
    ]));
    expect(result.graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fromNodeId: `addr:${cex}`,
        toNodeId: `addr:${via}`,
        type: "service_boundary",
        displayRole: "profile_context",
        txHash: "boundary-hop-tx"
      }),
      expect.objectContaining({
        fromNodeId: `addr:${via}`,
        toNodeId: `addr:${subject}`,
        type: "service_boundary",
        displayRole: "profile_context",
        txHash: "subject-hop-tx"
      }),
      expect.objectContaining({
        fromNodeId: `addr:${subject}`,
        toNodeId: `addr:${dex}`,
        type: "service_boundary",
        displayRole: "profile_context",
        txHash: null
      })
    ]));
    expect(result.graph.paths).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nodeIds: [`addr:${cex}`, `addr:${via}`, `addr:${subject}`],
        stopReason: "service_boundary",
        amountShare: 0.1597
      })
    ]));
    expect(result.graph.summary.layerSummary).toMatchObject({
      projectedProfiles: {
        boundaryExposureProfiles: 1,
        boundaryExposureFlows: 1,
        expansionBoundaryStops: 1
      }
    });
    expect(result.graph.weights).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "boundary_exposure_profile",
        value: 15
      })
    ]));
  });

  it("normalizes known CEX boundary identity metadata for deep-check boundary flows", () => {
    const subject = "TSubjectBoundaryIdentity111111111111111";
    const via = "TViaBoundaryIdentity111111111111111111";
    const cex = "TBybitBoundaryIdentity111111111111111";

    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        boundaryExposureProfiles: [
          {
            contextScore: 15,
            directBoundaryTxCount: 0,
            twoHopBoundaryTxCount: 1,
            flows: [
              {
                direction: "inbound",
                depth: 2,
                viaAddress: via,
                boundaryAddress: cex,
                boundaryCategory: "cex",
                boundaryIdentity: "Bybit",
                amountRaw: "332800000000",
                boundaryAmountRaw: "25000000000",
                amountPreservationRatio: 0.075,
                subjectTxHash: "subject-hop-tx",
                boundaryTxHash: "boundary-hop-tx",
                firstTransferAt: "2026-06-23T12:44:00.000Z",
                lastTransferAt: "2026-06-23T13:02:00.000Z"
              }
            ]
          }
        ],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        inboundProvenanceProfiles: [],
        serviceExposureProfiles: [],
        missingChecks: [],
        coverage: { transferEdges: 2 }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const boundaryNode = result.graph.nodes.find((node) => node.address === cex);
    expect(boundaryNode).toMatchObject({
      address: cex,
      displayKind: "cex",
      displayLabel: "Bybit"
    });
    expect(boundaryNode?.metadata.boundaryIdentity).toMatchObject({
      displayName: "Bybit",
      category: "cex",
      categoryLabel: "CEX",
      confidence: "high",
      source: "known_cex_rule",
      evidence: ["identity:Bybit"],
      isBoundary: true
    });

    const boundaryEdge = result.graph.edges.find((edge) => edge.txHash === "boundary-hop-tx");
    expect(boundaryEdge?.metadata.boundaryIdentity).toMatchObject({
      displayName: "Bybit",
      category: "cex",
      categoryLabel: "CEX"
    });
  });

  it("normalizes service exposure identity metadata", () => {
    const subject = "TSubjectServiceIdentity11111111111111";
    const service = "TGasFreeServiceIdentity111111111111";

    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        boundaryExposureProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        inboundProvenanceProfiles: [],
        serviceExposureProfiles: [
          {
            address: service,
            category: "service",
            identity: "GasFree Account",
            score: 12,
            txCount: 4,
            volumeRaw: "50000000000",
            direction: "outbound"
          }
        ],
        missingChecks: [],
        coverage: { transferEdges: 4 }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const node = result.graph.nodes.find((item) => item.address === service);
    expect(node?.metadata.boundaryIdentity).toMatchObject({
      displayName: "GasFree Account",
      category: "service",
      categoryLabel: "Service",
      confidence: "medium",
      source: "metadata",
      isBoundary: true
    });
  });

  it("uses service exposure fallback identity metadata for address-only profiles", () => {
    const subject = "TSubjectServiceFallback111111111111";
    const service = "TServiceFallbackIdentity11111111111";

    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        boundaryExposureProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        inboundProvenanceProfiles: [],
        serviceExposureProfiles: [
          {
            address: service
          }
        ],
        missingChecks: [],
        coverage: { transferEdges: 1 }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const node = result.graph.nodes.find((item) => item.address === service);
    expect(node?.metadata.boundaryIdentity).toMatchObject({
      displayName: "Service",
      category: "service",
      categoryLabel: "Service",
      confidence: "low",
      source: "metadata",
      evidence: ["category:service"],
      isBoundary: true
    });
  });

  it("copies service exposure identity metadata to matching profile-context edges", () => {
    const subject = "TSubjectServiceEdgeIdentity111111111";
    const service = "TGasFreeServiceEdgeIdentity111111111";

    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        boundaryExposureProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [
          {
            counterpartyAddress: service,
            direction: "outbound",
            volumeRaw: "50000000000",
            volumeRatio: 0.2,
            txCount: 4,
            txHashes: ["service-edge-tx"],
            scoreContribution: 12
          }
        ],
        inboundProvenanceProfiles: [],
        serviceExposureProfiles: [
          {
            address: service,
            category: "service",
            identity: "GasFree Account",
            score: 12,
            txCount: 4,
            volumeRaw: "50000000000",
            direction: "outbound"
          }
        ],
        missingChecks: [],
        coverage: { transferEdges: 4 }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const edge = result.graph.edges.find((item) => item.txHash === "service-edge-tx");
    expect(edge?.metadata.boundaryIdentity).toMatchObject({
      displayName: "GasFree Account",
      category: "service",
      categoryLabel: "Service"
    });
    expect(edge?.metadata.boundaryEntityName).toBe("GasFree Account");
    expect(edge?.metadata.boundaryCategoryLabel).toBe("Service");
  });

  it("normalizes unknown contract boundary stops with a readable identity", () => {
    const subject = "TSubjectUnknownBoundary111111111111";
    const contract = "TUnknownContractBoundary111111111111";

    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        boundaryExposureProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        inboundProvenanceProfiles: [],
        serviceExposureProfiles: [],
        missingChecks: [
          `Expansion stopped at service boundary ${contract} (unknown_contract)`
        ],
        coverage: { transferEdges: 0 }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const node = result.graph.nodes.find((item) => item.address === contract);
    expect(node?.metadata.boundaryIdentity).toMatchObject({
      displayName: "Unknown contract",
      category: "unknown_contract",
      categoryLabel: "Contract boundary",
      confidence: "medium",
      source: "weak_contract_metadata",
      evidence: ["category:unknown_contract"],
      isBoundary: true
    });

    const edge = result.graph.edges.find((item) => item.toNodeId === `addr:${contract}`);
    expect(edge?.metadata.boundaryIdentity).toMatchObject({
      displayName: "Unknown contract",
      category: "unknown_contract",
      categoryLabel: "Contract boundary"
    });
    expect(edge?.metadata.boundaryEntityName).toBe("Unknown contract");
    expect(edge?.metadata.boundaryCategoryLabel).toBe("Contract boundary");
  });

  it("preserves categoryless boundary stop fallback identity metadata", () => {
    const subject = "TSubjectCategorylessStop111111111111";
    const boundary = "TLegacyBoundaryStop111111111111111";

    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        boundaryExposureProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        inboundProvenanceProfiles: [],
        serviceExposureProfiles: [],
        missingChecks: [
          `Expansion stopped at service boundary ${boundary}`
        ],
        coverage: { transferEdges: 0 }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const node = result.graph.nodes.find((item) => item.address === boundary);
    expect(node).toMatchObject({
      displayLabel: "TLegac...111111",
      label: "TLegac...111111"
    });
    expect(node?.metadata.boundaryIdentity).toMatchObject({
      displayName: "TLegac...111111",
      category: "unknown",
      categoryLabel: "Boundary",
      confidence: "low",
      source: "unknown",
      evidence: ["category:unknown"],
      isBoundary: true
    });
  });

  it("preserves short-address fallback for categoryless boundary flows", () => {
    const subject = "TSubjectCategorylessBoundary111111111";
    const via = "TViaCategorylessBoundary111111111111";
    const boundary = "TCategorylessBoundary111111111111111";

    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        boundaryExposureProfiles: [
          {
            contextScore: 3,
            flows: [
              {
                direction: "inbound",
                depth: 2,
                viaAddress: via,
                boundaryAddress: boundary,
                amountRaw: "1000000",
                boundaryAmountRaw: "1000000",
                subjectTxHash: "categoryless-subject-hop",
                boundaryTxHash: "categoryless-boundary-hop",
                firstTransferAt: "2026-06-23T12:44:00.000Z",
                lastTransferAt: "2026-06-23T13:02:00.000Z"
              }
            ]
          }
        ],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        inboundProvenanceProfiles: [],
        serviceExposureProfiles: [],
        missingChecks: [],
        coverage: { transferEdges: 2 }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const shortBoundary = "TCateg...111111";
    const boundaryNode = result.graph.nodes.find((node) => node.address === boundary);
    expect(boundaryNode).toMatchObject({
      address: boundary,
      displayLabel: shortBoundary
    });
    expect(boundaryNode?.metadata.boundaryIdentity).toMatchObject({
      displayName: shortBoundary,
      category: "unknown",
      categoryLabel: "Boundary",
      confidence: "low",
      source: "unknown",
      evidence: ["category:unknown"],
      isBoundary: true
    });
  });

  it("projects deep-check boundary flows with selectable evidence details", () => {
    const subject = "TSubject111111111111111111111111111111";
    const via = "TViaEvidence111111111111111111111111";
    const cex = "TCexEvidence11111111111111111111111";

    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        boundaryExposureProfiles: [
          {
            contextScore: 15,
            directBoundaryTxCount: 0,
            twoHopBoundaryTxCount: 1,
            incomingBoundaryVolumeRaw: "100400000000",
            outgoingBoundaryVolumeRaw: "0",
            topBoundaryEntities: [
              {
                address: cex,
                category: "cex",
                identity: "Binance-Hot 6",
                direction: "inbound",
                txCount: 1,
                volumeRaw: "100400000000",
                maxDepth: 2
              }
            ],
            flows: [
              {
                direction: "inbound",
                depth: 2,
                viaAddress: via,
                boundaryAddress: cex,
                boundaryCategory: "cex",
                boundaryIdentity: "Binance-Hot 6",
                amountRaw: "100400000000",
                boundaryAmountRaw: "16039056111",
                amountPreservationRatio: 0.1597,
                subjectTxHash: "subject-hop-tx",
                boundaryTxHash: "boundary-hop-tx",
                firstTransferAt: "2026-06-02T10:11:42.000Z",
                lastTransferAt: "2026-06-11T10:19:03.000Z"
              }
            ]
          }
        ],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        inboundProvenanceProfiles: [],
        serviceExposureProfiles: [],
        missingChecks: [],
        coverage: { transferEdges: 222 }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const boundaryNode = result.graph.nodes.find((node) => node.address === cex);
    expect(boundaryNode?.metadata.boundaryEvidenceSummary).toMatchObject({
      evidenceType: "boundary_context",
      category: "cex",
      identity: "Binance-Hot 6",
      transferCount: 1,
      totalAmountRaw: "100400000000",
      direction: "inbound"
    });

    const boundaryEdge = result.graph.edges.find((edge) => edge.txHash === "boundary-hop-tx");
    expect(boundaryEdge?.metadata).toMatchObject({
      evidenceType: "boundary_context",
      evidenceTypeLabel: "Boundary context",
      aggregateAmountRaw: "16039056111",
      aggregateTransferCount: 1,
      boundaryAddress: cex,
      category: "cex",
      identity: "Binance-Hot 6"
    });
    expect(boundaryEdge?.metadata.underlyingTransfers).toEqual([
      expect.objectContaining({
        txHash: "boundary-hop-tx",
        amountRaw: "16039056111",
        timestamp: "2026-06-02T10:11:42.000Z",
        role: "boundary_hop"
      })
    ]);
  });

  it("projects deep-check wallet cluster metadata for ordinary wallets and boundaries", () => {
    const subject = "TSubjectCluster111111111111111111111";
    const source = "TSourceCluster1111111111111111111111";
    const via = "TViaCluster111111111111111111111111";
    const cex = "TCexCluster111111111111111111111111";

    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        coverage: { transferEdges: 3 },
        coverageDebug: { missingChecks: [] },
        counterpartyRiskProfiles: [
          {
            counterpartyAddress: source,
            direction: "inbound",
            score: 12,
            volumeRaw: "25000000000",
            txCount: 1,
            evidenceIds: ["source-subject"]
          }
        ],
        inboundProvenanceProfiles: [
          {
            senderAddress: source,
            paths: [
              {
                pathId: "path-source-via-subject",
                sourceAddress: via,
                viaAddresses: [source],
                amountRaw: "25000000000",
                txHashes: ["via-source-tx", "source-subject-tx"],
                firstTransferAt: "2026-06-23T12:31:00.000Z",
                lastTransferAt: "2026-06-23T12:36:00.000Z"
              }
            ]
          }
        ],
        boundaryExposureProfiles: [
          {
            flows: [
              {
                direction: "inbound",
                depth: 2,
                viaAddress: source,
                boundaryAddress: cex,
                boundaryCategory: "cex",
                boundaryIdentity: "Exchange",
                amountRaw: "25000000000",
                boundaryAmountRaw: "25000000000",
                boundaryTxHash: "cex-source-tx",
                firstTransferAt: "2026-06-23T12:00:00.000Z"
              }
            ]
          }
        ],
        directCounterpartyInteractionProfiles: [],
        serviceExposureProfiles: [],
        walletRoleProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const subjectNode = result.graph.nodes.find((node) => node.address === subject);
    const sourceNode = result.graph.nodes.find((node) => node.address === source);
    const cexNode = result.graph.nodes.find((node) => node.address === cex);

    expect(subjectNode?.metadata.deepCheckWalletCluster).toMatchObject({
      nodeType: "subject_wallet",
      hopDepth: 0,
      expandedStatus: "checked_subject"
    });
    expect(sourceNode?.metadata.deepCheckWalletCluster).toMatchObject({
      nodeType: "ordinary_wallet",
      hopDepth: 1,
      expandedStatus: "expanded_or_observed"
    });
    expect(cexNode?.metadata.deepCheckWalletCluster).toMatchObject({
      nodeType: "boundary",
      boundaryType: "cex",
      expandedStatus: "boundary_context"
    });

    const transferEdge = result.graph.edges.find((edge) => edge.txHash === "source-subject-tx");
    const boundaryEdge = result.graph.edges.find((edge) => edge.txHash === "cex-source-tx");

    expect(transferEdge?.metadata.deepCheckWalletCluster).toMatchObject({
      edgeType: "proven_transaction",
      relationship: "wallet_to_wallet"
    });
    expect(boundaryEdge?.metadata.deepCheckWalletCluster).toMatchObject({
      edgeType: "context_boundary",
      relationship: "shared_service_or_boundary"
    });
  });

  it("ignores invalid boundary summary amounts while preserving valid decimal totals", () => {
    const subject = "TSubject111111111111111111111111111111";
    const cex = "TCexInvalidAmount111111111111111111111";

    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        boundaryExposureProfiles: [
          {
            contextScore: 15,
            flows: [
              {
                direction: "inbound",
                depth: 1,
                boundaryAddress: cex,
                boundaryCategory: "cex",
                boundaryIdentity: "Exchange",
                amountRaw: "bad",
                boundaryTxHash: "bad-boundary-tx",
                firstTransferAt: "2026-06-02T10:11:42.000Z"
              },
              {
                direction: "inbound",
                depth: 1,
                boundaryAddress: cex,
                boundaryCategory: "cex",
                boundaryIdentity: "Exchange",
                amountRaw: "100",
                boundaryTxHash: "valid-boundary-tx",
                firstTransferAt: "2026-06-02T10:12:42.000Z"
              }
            ]
          }
        ],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        inboundProvenanceProfiles: [],
        serviceExposureProfiles: [],
        missingChecks: [],
        coverage: { transferEdges: 2 }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const boundaryNode = result.graph.nodes.find((node) => node.address === cex);
    expect(boundaryNode?.metadata.boundaryEvidenceSummary).toMatchObject({
      transferCount: 2,
      totalAmountRaw: "100"
    });
  });

  it("aggregates boundary evidence summary metadata for multiple flows to the same boundary", () => {
    const subject = "TSubject111111111111111111111111111111";
    const boundary = "TSharedBoundary111111111111111111111";

    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        boundaryExposureProfiles: [
          {
            contextScore: 15,
            flows: [
              {
                direction: "inbound",
                depth: 1,
                boundaryAddress: boundary,
                boundaryCategory: "cex",
                boundaryIdentity: "Exchange",
                amountRaw: "100",
                boundaryAmountRaw: "90",
                amountPreservationRatio: 0.9,
                boundaryTxHash: "inbound-boundary-tx",
                firstTransferAt: "2026-06-02T10:11:42.000Z"
              },
              {
                direction: "outbound",
                depth: 2,
                boundaryAddress: boundary,
                boundaryCategory: "bridge",
                boundaryIdentity: "Bridge",
                amountRaw: "250",
                boundaryAmountRaw: "250",
                amountPreservationRatio: 1,
                boundaryTxHash: "outbound-boundary-tx",
                firstTransferAt: "2026-06-02T10:12:42.000Z"
              }
            ]
          }
        ],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        inboundProvenanceProfiles: [],
        serviceExposureProfiles: [],
        missingChecks: [],
        coverage: { transferEdges: 2 }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const boundaryNode = result.graph.nodes.find((node) => node.address === boundary);
    const summary = boundaryNode?.metadata.boundaryEvidenceSummary as Record<string, unknown> | undefined;

    expect(summary).toMatchObject({
      transferCount: 2,
      totalAmountRaw: "350",
      directions: ["inbound", "outbound"],
      categories: ["cex", "bridge"],
      identities: ["Exchange", "Bridge"],
      depths: [1, 2],
      boundaryAmountRaws: ["90", "250"],
      amountPreservationRatios: [0.9, 1]
    });
    expect(summary?.underlyingTransfers).toEqual([
      expect.objectContaining({ txHash: "inbound-boundary-tx", amountRaw: "100" }),
      expect.objectContaining({ txHash: "outbound-boundary-tx", amountRaw: "250" })
    ]);
    expect(summary?.direction).toBeUndefined();
    expect(summary?.category).toBeUndefined();
    expect(summary?.identity).toBeUndefined();
    expect(summary?.depth).toBeUndefined();
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

  it("marks address-deep outbound direct-counterparty service boundary edges as profile context", () => {
    const counterparty = "TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s";
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      resultJson: {
        subjectAddress: "TLhVzkRYUuoVuSCgVAwB8nDJPdMy7gAgXe",
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [
          {
            counterpartyAddress: counterparty,
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
        direction: "outbound",
        deepCheckWalletCluster: {
          edgeType: "context_boundary",
          relationship: "shared_service_or_boundary"
        }
      }
    });
    expect(result.graph.nodes.find((node) => node.address === counterparty)?.metadata.deepCheckWalletCluster).toMatchObject({
      nodeType: "boundary",
      boundaryType: "bridge",
      expandedStatus: "boundary_context"
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

  it("projects deep-check coverage summary for right-rail explanation", () => {
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: "TSubject111111111111111111111111111111",
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        boundaryExposureProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [{ counterparty: "A" }, { counterparty: "B" }],
        inboundProvenanceProfiles: [],
        serviceExposureProfiles: [],
        missingChecks: [
          "Expansion stopped at service boundary TBoundary11111111111111111111111111 (cex)",
          "Metadata enrichment limited to 30 of 917 candidate exposure addresses."
        ],
        coverage: {
          transferEdges: 2646,
          sourceTransferPages: 4,
          inboundSendersExpanded: 15,
          extendedFetchedAddresses: 24,
          extendedIndexedEdges: 24
        },
        coverageDebug: {
          summary: {
            directCounterpartyCount: 100,
            analyzedCounterpartyCount: 100,
            expandedCounterpartyCount: 18,
            skippedCounterpartyCount: 71,
            metadataEnrichedCounterpartyCount: 3
          }
        }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    expect(result.graph.summary.layerSummary).toMatchObject({
      deepCheckCoverage: {
        directCounterpartiesAnalyzed: 100,
        directCounterpartiesExpanded: 18,
        transferEdgesCollected: 2646,
        extendedAddressesFetched: 24,
        boundaryStopCount: 1,
        metadataEnrichmentLimited: true
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

  it("surfaces partial coverage separately from completed deep execution", () => {
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      status: "completed",
      subjectAddress: "TDeepSubject11111111111111111111111111",
      resultJson: {
        subjectAddress: "TDeepSubject11111111111111111111111111",
        riskScore: 72,
        decision: "DECLINE",
        missingChecks: ["provider timeout"],
        coverage: { transferEdges: 8 },
        coverageDebug: { missingChecks: ["provider timeout"] },
        serviceExposureProfiles: [],
        addressBehaviorProfiles: [],
        inboundProvenanceProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        approvalDrainProvenanceProfiles: [],
        assetContinuationProfiles: [],
        boundaryExposureProfiles: [],
        operationalFlowProfiles: [],
        walletRoleProfiles: [],
        stablecoinRestrictionProfiles: [],
        extendedProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.job.status).toBe("completed");
    expect(result.graph.summary.riskClarity.coverageStatus).toBe("partial");
    expect(result.graph.summary.riskClarity.decisionStatus).toBe("decline");
    expect(result.graph.summary.riskClarity.displayNotes).toContain("High contextual risk; no hard evidence observed.");
  });

  it("treats completed legacy deep jobs without coverage debug as limited coverage", () => {
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      status: "completed",
      subjectAddress: "TDeepSubject11111111111111111111111111",
      resultJson: {
        subjectAddress: "TDeepSubject11111111111111111111111111",
        riskScore: 72,
        decision: "DECLINE",
        missingChecks: [],
        coverage: { transferEdges: 20, fetchedAddressCount: 8 },
        serviceExposureProfiles: [],
        addressBehaviorProfiles: [],
        inboundProvenanceProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        approvalDrainProvenanceProfiles: [],
        assetContinuationProfiles: [],
        boundaryExposureProfiles: [],
        operationalFlowProfiles: [],
        walletRoleProfiles: [],
        stablecoinRestrictionProfiles: [],
        extendedProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.summary.riskClarity.coverageStatus).toBe("limited");
    expect(result.graph.summary.riskClarity.limitations).toContain("Legacy job has no coverage debug object");
    expect(result.graph.summary.riskClarity.displayNotes.join(" ")).toContain("Coverage is limited");
  });

  it("uses unified wallet thresholds for graph summary risk levels", () => {
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      status: "completed",
      subjectAddress: "TDeepSubject11111111111111111111111111",
      resultJson: {
        subjectAddress: "TDeepSubject11111111111111111111111111",
        riskScore: 60,
        decision: "DECLINE",
        missingChecks: [],
        coverage: { transferEdges: 20 },
        coverageDebug: { missingChecks: [] },
        serviceExposureProfiles: [],
        addressBehaviorProfiles: [],
        inboundProvenanceProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        approvalDrainProvenanceProfiles: [],
        assetContinuationProfiles: [],
        boundaryExposureProfiles: [],
        operationalFlowProfiles: [],
        walletRoleProfiles: [],
        stablecoinRestrictionProfiles: [],
        extendedProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.summary.riskLevel).toBe("HIGH");
    expect(result.graph.summary.riskClarity.riskLevel).toBe("HIGH");
  });

  it("projects exact drainer wallet role into subject node intelligence", () => {
    const address = "TDrainer11111111111111111111111111111";
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: address,
      resultJson: {
        subjectAddress: address,
        coverage: { transferEdges: 1 },
        coverageDebug: { missingChecks: [] },
        walletRoleProfiles: [{
          subjectAddress: address,
          primaryRole: "drainer_spender",
          evidenceStrength: "exact",
          roles: [{
            role: "drainer_spender",
            score: 95,
            reasons: [{
              code: "wallet_role_approval_drain_spender",
              label: "Subject is the spender in an approval-drain transferFrom flow."
            }]
          }],
          features: [{
            code: "wallet_role_approval_drain_spender",
            label: "Subject is the spender in an approval-drain transferFrom flow."
          }]
        }],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        serviceExposureProfiles: [],
        inboundProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.nodes.find((node) => node.address === address)?.metadata.nodeIntelligence).toEqual({
      role: "drainer",
      label: "Drainer",
      evidenceStrength: "hard",
      source: "wallet_role_classifier",
      confidence: 95,
      explanation: "Subject is the spender in an approval-drain transferFrom flow.",
      signals: ["wallet_role_approval_drain_spender"]
    });
  });

  it("projects exact victim wallet role into subject node intelligence", () => {
    const address = "TVictim111111111111111111111111111111";
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: address,
      resultJson: {
        subjectAddress: address,
        coverage: { transferEdges: 1 },
        coverageDebug: { missingChecks: [] },
        walletRoleProfiles: [{
          subjectAddress: address,
          primaryRole: "victim",
          evidenceStrength: "exact",
          roles: [{
            role: "victim",
            score: 100,
            reasons: [{
              code: "wallet_role_approval_drain_victim",
              label: "Subject is the approval-drain victim address."
            }]
          }],
          features: [{
            code: "wallet_role_approval_drain_victim",
            label: "Subject is the approval-drain victim address."
          }]
        }],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        serviceExposureProfiles: [],
        inboundProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.nodes.find((node) => node.address === address)?.metadata.nodeIntelligence).toMatchObject({
      role: "victim",
      label: "Victim",
      evidenceStrength: "hard",
      source: "wallet_role_classifier",
      confidence: 100,
      signals: ["wallet_role_approval_drain_victim"]
    });
  });

  it("projects collector and mule wallet roles as behavior node intelligence", () => {
    const collector = "TCollector1111111111111111111111111111";
    const mule = "TMule111111111111111111111111111111111";
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: collector,
      resultJson: {
        subjectAddress: collector,
        coverage: { transferEdges: 2 },
        coverageDebug: { missingChecks: [] },
        counterpartyRiskProfiles: [{
          counterpartyAddress: mule,
          direction: "outbound",
          score: 12,
          evidenceIds: []
        }],
        walletRoleProfiles: [
          {
            subjectAddress: collector,
            primaryRole: "collector",
            evidenceStrength: "strong_behavior",
            roles: [{
              role: "collector",
              score: 55,
              reasons: [{ code: "address_behavior_collector_like_wallet", label: "Collector-like wallet." }]
            }],
            features: [{ code: "address_behavior_collector_like_wallet", label: "Collector-like wallet." }]
          },
          {
            subjectAddress: mule,
            primaryRole: "mule",
            evidenceStrength: "strong_behavior",
            roles: [{
              role: "mule",
              score: 45,
              reasons: [{ code: "wallet_role_mule_transit_pattern", label: "Transit-like wallet." }]
            }],
            features: [{ code: "wallet_role_mule_transit_pattern", label: "Transit-like wallet." }]
          }
        ],
        directCounterpartyInteractionProfiles: [],
        serviceExposureProfiles: [],
        inboundProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.nodes.find((node) => node.address === collector)?.metadata.nodeIntelligence).toMatchObject({
      role: "collector",
      evidenceStrength: "behavior",
      confidence: 55,
      signals: ["address_behavior_collector_like_wallet"]
    });
    expect(result.graph.nodes.find((node) => node.address === mule)?.metadata.nodeIntelligence).toMatchObject({
      role: "mule_transit",
      evidenceStrength: "behavior",
      confidence: 45,
      signals: ["wallet_role_mule_transit_pattern"]
    });
  });

  it("does not attach wallet role intelligence to service nodes", () => {
    const service = "TService11111111111111111111111111111";
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: "TSubject111111111111111111111111111111",
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        coverage: { transferEdges: 1 },
        coverageDebug: { missingChecks: [] },
        walletRoleProfiles: [{
          subjectAddress: service,
          primaryRole: "collector",
          evidenceStrength: "strong_behavior",
          roles: [{
            role: "collector",
            score: 55,
            reasons: [{ code: "address_behavior_collector_like_wallet", label: "Collector-like wallet." }]
          }],
          features: []
        }],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        serviceExposureProfiles: [{
          exposureScore: 10,
          topServiceCounterparties: [{
            address: service,
            category: "exchange",
            identity: "Known Exchange",
            volumeRaw: "1000000",
            txCount: 1
          }]
        }],
        inboundProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const serviceNode = result.graph.nodes.find((node) => node.address === service);
    expect(serviceNode?.kind).toBe("service");
    expect(serviceNode?.metadata.nodeIntelligence).toBeUndefined();
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
