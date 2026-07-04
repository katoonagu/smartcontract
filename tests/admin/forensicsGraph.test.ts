import { describe, expect, it } from "vitest";
import { projectForensicJobGraph } from "../../src/admin/forensicsGraph";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
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
  it("projects a waiting Where targeted index job as progress, not final failure", () => {
    const waitingAddress = "TWaitingHop111111111111111111111111111";
    const result = projectForensicJobGraph(job({
      status: "queued",
      progressJson: {
        jobPhase: "waiting_for_targeted_index",
        targetedIndex: {
          phase: "waiting_for_targeted_index",
          scoreValid: false,
          waitingFor: {
            address: waitingAddress,
            targetTimestamp: "2026-07-01T12:59:30.000Z",
            queuedReason: "where_is_money_hop",
            requiredFor: "where_hop"
          },
          lastIndexedAddress: waitingAddress,
          lastIndexedTargetTimestamp: "2026-07-01T12:59:30.000Z",
          lastIndexStatus: "running",
          statusReason: "partial_provider_cap",
          pagesFetched: 400,
          transfersFetched: 8051,
          oldestFetchedTransferAt: "2026-06-22T21:29:42.000Z",
          newestFetchedTransferAt: "2026-07-01T12:59:30.000Z",
          targetTimestamp: "2026-07-01T12:59:30.000Z",
          budgetPages: 800,
          attemptCount: 11,
          maxAttempts: 12,
          retryCount: 11,
          providerCapHit: true,
          budgetExhausted: true,
          requestCount: 400,
          rateLimitedCount: 0,
          forbiddenCount: 0,
          serverErrorCount: 0
        },
        targetedHistory: {
          totalTargetedStates: 3,
          queuedCount: 2,
          runningCount: 1,
          completeCount: 0,
          partialCount: 0,
          failedCount: 0,
          uniqueCanonicalHashCount: 795,
          repeatRatio: 0.3375,
          requestCount: 1200,
          rateLimitedCount: 0,
          forbiddenCount: 0,
          serverErrorCount: 0,
          providerCapHit: true,
          budgetExhausted: true,
          providerInconsistent: false,
          states: [
            {
              address: waitingAddress,
              targetTimestamp: "2026-07-01T12:59:30.000Z",
              status: "running",
              statusReason: "partial_provider_cap",
              budgetPages: 800,
              fetchedPageCount: 400,
              fetchedTransferCount: 8051,
              uniqueCanonicalHashCount: 350,
              repeatRatio: 0.125,
              lockedUntil: "2026-07-03T11:48:15.053Z",
              lockOwner: "pid-35824"
            }
          ]
        }
      },
      resultJson: {}
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.job.status).toBe("queued");
    expect(result.graph.summary.decision).toBe("UNKNOWN");
    expect(result.graph.summary.riskScore).toBeNull();
    expect(result.graph.summary.layerSummary?.targetedIndex).toMatchObject({
      phase: "waiting_for_targeted_index",
      waitingForAddress: waitingAddress,
      pagesFetched: 400,
      transfersFetched: 8051,
      providerCapHit: true,
      budgetExhausted: true
    });
    expect(result.graph.summary.layerSummary?.targetedHistory).toMatchObject({
      totalTargetedStates: 3,
      queuedCount: 2,
      runningCount: 1,
      completeCount: 0,
      uniqueCanonicalHashCount: 795,
      repeatRatio: 0.3375,
      requestCount: 1200,
      providerCapHit: true,
      budgetExhausted: true
    });
    const targetedHistory = result.graph.summary.layerSummary?.targetedHistory as { states?: unknown[] } | undefined;
    expect(targetedHistory?.states?.[0]).toMatchObject({
      uniqueCanonicalHashCount: 350,
      repeatRatio: 0.125
    });
    expect(result.graph.limitations).toContainEqual(expect.objectContaining({
      code: "waiting_for_targeted_index",
      severity: "info",
      explanation: expect.stringContaining("not stuck")
    }));
  });

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

  it("projects strict provenance benchmark progress into where-is-money summary", () => {
    const blockedReason = "provider rate limit blocked scoring";
    const result = projectForensicJobGraph(job({
      status: "failed",
      progressJson: {
        strictProvenanceBenchmark: true,
        strictProvenance: {
          phase: "provider_limited",
          scoreValid: false,
          scoreBlockedReason: blockedReason,
          coveredHopCount: 14,
          totalHopCount: 17
        },
        strictBenchmarkMetrics: {
          total: {
            elapsedMs: 12345,
            requestCount: 42,
            rateLimitedCount: 3,
            forbiddenCount: 1,
            serverErrorCount: 2,
            effectiveRps: 3.4,
            keyCount: 5,
            accountGroupCount: 6
          },
          stages: {
            apiMs: 4500,
            dbWriteMs: 700,
            dbReadMs: 250,
            traceMs: 6200,
            scoringMs: 900
          }
        }
      },
      resultJson: {
        score_valid: false,
        score_blocked_reason: blockedReason,
        technical_status: "provider_limited",
        whereIsMoneyReport: {
          subjectAddress: "TSubject111111111111111111111111111111",
          riskScore: 0,
          decision: "UNKNOWN",
          coverage: {},
          assessment: {},
          originPaths: []
        }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.summary.layerSummary?.strictProvenance).toMatchObject({
      benchmark: true,
      phase: "provider_limited",
      scoreValid: false,
      scoreBlockedReason: blockedReason,
      technicalStatus: "provider_limited",
      coveredHopCount: 14,
      totalHopCount: 17
    });
    expect(result.graph.summary.layerSummary?.strictBenchmarkMetrics).toMatchObject({
      effectiveRps: 3.4,
      requestCount: 42,
      apiMs: 4500,
      traceMs: 6200
    });
  });

  it("keeps strict score validity pending when final score validity is not published", () => {
    const result = projectForensicJobGraph(job({
      progressJson: {
        strictProvenanceBenchmark: true,
        strictProvenance: {
          phase: "indexing_hop_history",
          scoreValid: false
        }
      },
      resultJson: {
        whereIsMoneyReport: {
          subjectAddress: "TSubject111111111111111111111111111111",
          riskScore: 0,
          decision: "UNKNOWN",
          coverage: {},
          assessment: {},
          originPaths: []
        }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.summary.layerSummary?.strictProvenance).toMatchObject({
      benchmark: true,
      phase: "indexing_hop_history",
      scoreValid: null
    });
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
          approvalTxHash: "approval-tx-1",
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

  it("does not duplicate targeted terminal coverage with generic missing origin path", () => {
    const subject = "TProviderCap1111111111111111111111111";
    const hop = "THeavyHop1111111111111111111111111111";
    const result = projectForensicJobGraph(job({
      kind: "where_is_money_check",
      subjectAddress: subject,
      status: "failed",
      progressJson: {
        jobPhase: "provider_limited",
        targetedIndex: {
          phase: "provider_limited",
          scoreValid: false,
          scoreBlockedReason: "provider_cap_unresolved",
          technicalStatus: "provider_cap_unresolved",
          lastIndexedAddress: hop,
          lastIndexedTargetTimestamp: "2026-07-01T14:10:36.000Z",
          lastIndexStatus: "partial",
          statusReason: "partial_provider_cap",
          pagesFetched: 12000,
          transfersFetched: 339204,
          targetTimestamp: "2026-07-01T14:10:36.000Z",
          budgetPages: 12000,
          providerCapHit: true,
          requestCount: 12000,
          rateLimitedCount: 0,
          forbiddenCount: 0,
          serverErrorCount: 0
        },
        targetedHistory: {
          totalTargetedStates: 5,
          terminalCount: 5,
          providerCapHit: true,
          requestCount: 12000,
          rateLimitedCount: 0,
          forbiddenCount: 0,
          serverErrorCount: 0,
          states: [{
            address: hop,
            targetTimestamp: "2026-07-01T14:10:36.000Z",
            waitStatus: "terminal",
            status: "partial",
            statusReason: "partial_provider_cap",
            budgetPages: 12000,
            providerCapHit: true
          }]
        }
      },
      resultJson: {
        score_valid: false,
        score_blocked_reason: "provider_cap_unresolved",
        technical_status: "provider_cap_unresolved",
        whereIsMoneyReport: {
          subjectAddress: subject,
          riskScore: 0,
          decision: "UNKNOWN",
          coverage: {},
          assessment: {},
          originPaths: []
        }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.graph.summary.layerSummary?.targetedIndex).toMatchObject({
      phase: "provider_limited",
      scoreValid: false,
      scoreBlockedReason: "provider_cap_unresolved",
      technicalStatus: "provider_cap_unresolved",
      statusReason: "partial_provider_cap",
      providerCapHit: true
    });
    expect(result.graph.limitations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "where_origin_paths_missing" })
    ]));
    expect(result.graph.weights).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "where_origin_paths_missing" })
    ]));
    expect(result.graph.paths).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ stopReason: "no_graphable_origin_path" })
    ]));
  });

  it("does not promote a plain wallet with a weak DEX hint into a DEX service node", () => {
    const subject = "TS3gaJPExMNr63p4pxfY9CZPbJPHjfPjgf";
    const plainWallet = "TB44QiUnyECTGfmqgZmN5jV7SzjnDexzHP";

    const result = projectForensicJobGraph(job({
      kind: "where_is_money_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        riskScore: 20,
        decision: "REVIEW",
        coverage: {
          selectedAmountRaw: "8750000000",
          targetAmountRaw: "8750000000",
          coverageRatio: 1
        },
        assessment: {},
        originPaths: [{
          riskScoreContribution: 0,
          verdict: "REVIEW",
          steps: [{
            fromAddress: plainWallet,
            toAddress: subject,
            amountRaw: "8750000000",
            timestamp: "2026-06-25T09:49:03.000Z",
            txHash: "tx-weak-dex-hint"
          }]
        }],
        subjectExposureProfile: {
          subjectAddress: subject,
          topIncoming: [{
            address: plainWallet,
            amountRaw: "8750000000",
            txCount: 1,
            serviceCategory: "dex",
            serviceIdentitySource: "weak_keyword"
          }]
        }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const node = result.graph.nodes.find((item) => item.address === plainWallet);
    expect(node?.kind).toBe("wallet");
    expect(node?.displayKind).not.toBe("dex_contract");
    expect(node?.metadata.boundaryIdentity).toBeUndefined();
    expect(node?.metadata.weakServiceHint).toMatchObject({
      category: "dex",
      reason: "weak service label not promoted to service node"
    });
  });

  it("projects repeated where sender interactions as grouped reciprocal context", () => {
    const subject = "TSubject111111111111111111111111111111";
    const sender = "TSender1111111111111111111111111111111";
    const singleCounterparty = "TSingle111111111111111111111111111111";
    const result = projectForensicJobGraph(job({
      kind: "where_is_money_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        riskScore: 40,
        decision: "REVIEW",
        coverage: {},
        assessment: {},
        originPaths: [{
          riskScoreContribution: 12,
          verdict: "REVIEW",
          steps: [{
            fromAddress: sender,
            toAddress: subject,
            amountRaw: "11250000000",
            timestamp: "2026-06-25T09:49:03.000Z",
            txHash: "tx-selected"
          }]
        }],
        senderInteractionProfiles: [{
          senderAddress: sender,
          balanceTransferTxHash: "tx-selected",
          topIncomingCounterparties: [{
            address: subject,
            txCount: 7,
            volumeRaw: "48793340000",
            firstSeen: "2026-06-13T09:07:03.000Z",
            lastSeen: "2026-06-25T09:50:45.000Z",
            txHashes: ["tx-in-1", "tx-in-2"]
          }, {
            address: singleCounterparty,
            txCount: 1,
            volumeRaw: "1000000",
            txHashes: ["tx-single"]
          }],
          topOutgoingCounterparties: [{
            address: subject,
            txCount: 16,
            volumeRaw: "55086090000",
            firstSeen: "2026-06-11T11:45:51.000Z",
            lastSeen: "2026-06-25T09:49:03.000Z",
            txHashes: ["tx-out-1", "tx-out-2"]
          }]
        }]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const senderEdges = result.graph.edges.filter((edge) => edge.metadata.source === "senderInteractionProfile");
    expect(senderEdges).toHaveLength(2);
    expect(senderEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fromNodeId: `addr:${subject}`,
        toNodeId: `addr:${sender}`,
        displayRole: "profile_context",
        amountRaw: "48793340000",
        txHash: null,
        metadata: expect.objectContaining({
          evidenceType: "grouped_transfers",
          aggregateTransferCount: 7,
          aggregateAmountRaw: "48793340000",
          reciprocalFlow: true,
          balanceTransferTxHash: "tx-selected"
        })
      }),
      expect.objectContaining({
        fromNodeId: `addr:${sender}`,
        toNodeId: `addr:${subject}`,
        displayRole: "profile_context",
        amountRaw: "55086090000",
        txHash: null,
        metadata: expect.objectContaining({
          evidenceType: "grouped_transfers",
          aggregateTransferCount: 16,
          aggregateAmountRaw: "55086090000",
          reciprocalFlow: true
        })
      })
    ]));
    expect(result.graph.nodes.some((node) => node.address === singleCounterparty)).toBe(false);
  });

  it("deduplicates repeated where sender interaction context edges across balance seeds", () => {
    const subject = "TSubject111111111111111111111111111111";
    const sender = "TSender1111111111111111111111111111111";
    const counterparty = "TCounterparty111111111111111111111111";
    const summary = {
      address: counterparty,
      txCount: 5,
      volumeRaw: "5489544",
      firstSeen: "2026-06-30T09:26:18.000Z",
      lastSeen: "2026-07-01T13:26:06.000Z",
      txHashes: ["tx-1", "tx-2", "tx-3", "tx-4", "tx-5"]
    };

    const result = projectForensicJobGraph(job({
      kind: "where_is_money_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        riskScore: 40,
        decision: "REVIEW",
        coverage: {},
        assessment: {},
        originPaths: [],
        senderInteractionProfiles: [
          {
            senderAddress: sender,
            balanceTransferTxHash: "tx-balance-a",
            topIncomingCounterparties: [summary],
            topOutgoingCounterparties: []
          },
          {
            senderAddress: sender,
            balanceTransferTxHash: "tx-balance-b",
            topIncomingCounterparties: [summary],
            topOutgoingCounterparties: []
          }
        ]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const senderEdges = result.graph.edges.filter((edge) => edge.metadata.source === "senderInteractionProfile");
    expect(senderEdges).toHaveLength(1);
    expect(senderEdges[0]).toMatchObject({
      fromNodeId: `addr:${counterparty}`,
      toNodeId: `addr:${sender}`,
      amountRaw: "5489544",
      metadata: expect.objectContaining({
        txHashes: ["tx-1", "tx-2", "tx-3", "tx-4", "tx-5"],
        balanceTransferTxHashes: ["tx-balance-a", "tx-balance-b"]
      })
    });
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
    expect(result.graph.limitations.find((item) => item.code === "multi_input_bundle_used")).toBeUndefined();
    expect(result.graph.nodes.find((node) => node.kind === "bundle")).toBeUndefined();
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

  it("keeps a single-funder where-is-money funding bundle as normal transfers", () => {
    const subject = "TSubject111111111111111111111111111111";
    const hop = "THop111111111111111111111111111111111";
    const funder = "TFunderSingle111111111111111111111111";

    const result = projectForensicJobGraph(job({
      kind: "where_is_money_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        riskScore: 40,
        decision: "REVIEW",
        coverage: {
          coverageRatio: 1,
          targetAmountRaw: "40000000000",
          selectedAmountRaw: "40000000000"
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
            pathAddresses: [funder, hop, subject],
            txHashes: ["tx-single", "tx-hop"],
            steps: [
              {
                txHash: "tx-single",
                fromAddress: funder,
                toAddress: hop,
                amountRaw: "40000000000",
                timestamp: "2026-06-30T07:23:00.000Z"
              },
              {
                txHash: "tx-hop",
                fromAddress: hop,
                toAddress: subject,
                amountRaw: "40000000000",
                timestamp: "2026-06-30T07:25:00.000Z"
              }
            ],
            fundingBundles: [
              {
                hopTxHash: "tx-hop",
                hopAddress: hop,
                expectedAmountRaw: "40000000000",
                coveredAmountRaw: "40000000000",
                coverageRatio: 1,
                members: [
                  {
                    txHash: "tx-single",
                    fromAddress: funder,
                    toAddress: hop,
                    originalAmountRaw: "40000000000",
                    usedAmountRaw: "40000000000",
                    timestamp: "2026-06-30T07:23:00.000Z"
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

    expect(result.graph.nodes.find((node) => node.kind === "bundle")).toBeUndefined();
    expect(result.graph.edges.find((edge) => edge.metadata.bundleRole)).toBeUndefined();
    expect(result.graph.limitations.find((item) => item.code === "multi_input_bundle_used")).toBeUndefined();
    expect(result.graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fromNodeId: `addr:${funder}`,
        toNodeId: `addr:${hop}`,
        txHash: "tx-single"
      }),
      expect.objectContaining({
        fromNodeId: `addr:${hop}`,
        toNodeId: `addr:${subject}`,
        txHash: "tx-hop"
      })
    ]));
  });

  it("shows probable funding-first source provenance without treating it as proven funding bundle", () => {
    const subject = "TSubject111111111111111111111111111111";
    const hop = "THopProbable1111111111111111111111111";
    const funder = "TFunderProbable111111111111111111111";

    const result = projectForensicJobGraph(job({
      kind: "where_is_money_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        riskScore: null,
        decision: "REVIEW",
        coverage: {
          coverageRatio: 1,
          targetAmountRaw: "40000000000",
          selectedAmountRaw: "40000000000"
        },
        assessment: {
          decision: "REVIEW",
          riskScore: 45,
          provenanceConfidence: 40,
          reasons: []
        },
        originPaths: [
          {
            verdict: "REVIEW",
            stoppedReason: "incoming_history_not_fetched",
            riskScoreContribution: 45,
            balanceShare: 1,
            pathAddresses: [hop, subject],
            txHashes: ["tx-hop"],
            steps: [
              {
                txHash: "tx-hop",
                fromAddress: hop,
                toAddress: subject,
                amountRaw: "40000000000",
                timestamp: "2026-06-30T07:25:00.000Z"
              }
            ],
            sourceProvenance: [{
              mode: "source_provenance",
              targetTxHash: "tx-hop",
              targetFromAddress: hop,
              targetToAddress: subject,
              targetTimestamp: "2026-06-30T07:25:00.000Z",
              targetAmountRaw: "40000000000",
              proofClass: "probable",
              coveredAmountRaw: "40000000000",
              coverageRatio: 1,
              amountContinuity: "strong",
              stopReason: "incoming_history_not_fetched",
              fundingBundle: {
                hopTxHash: "tx-hop",
                hopAddress: hop,
                expectedAmountRaw: "40000000000",
                coveredAmountRaw: "40000000000",
                coverageRatio: 1,
                members: [{
                  txHash: "tx-probable-funding",
                  fromAddress: funder,
                  toAddress: hop,
                  originalAmountRaw: "40000000000",
                  usedAmountRaw: "40000000000",
                  spentBeforeHopRaw: "0",
                  timestamp: "2026-06-30T07:23:00.000Z",
                  coverageShare: 1
                }]
              },
              coverageWindow: {
                startTimestamp: "2026-06-30T07:23:00.000Z",
                endTimestamp: "2026-06-30T07:25:00.000Z",
                complete: false,
                capped: true,
                providerInconsistent: false
              },
              reasons: ["funding_bundle_amount_covered", "coverage_window_not_exact"]
            }],
            reasons: ["Probable funding from capped history."]
          }
        ]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    expect(result.graph.limitations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "funding_first_probable_source",
        severity: "review",
        pathId: "path:0"
      })
    ]));
    expect(result.graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fromNodeId: `addr:${funder}`,
        toNodeId: `addr:${hop}`,
        type: "inferred_provenance",
        metadata: expect.objectContaining({
          moneyDirection: "inbound_to_subject",
          sourceProvenance: expect.objectContaining({
            mode: "source_provenance",
            proofClass: "probable",
            amountContinuity: "strong",
            stopReason: "incoming_history_not_fetched"
          })
        })
      })
    ]));
    expect(result.graph.nodes.find((node) => node.kind === "bundle")).toBeUndefined();
  });

  it("renders exact where funding candidates as hop-attached transfer edges with visibility counters", () => {
    const subject = "TSubject111111111111111111111111111111";
    const hop = "THopExact11111111111111111111111111111";
    const funder = "TFunderExact111111111111111111111111";

    const result = projectForensicJobGraph(job({
      kind: "where_is_money_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        riskScore: 30,
        decision: "REVIEW",
        coverage: {
          selectedAmountRaw: "9000000000",
          targetAmountRaw: "9000000000"
        },
        assessment: {
          decision: "REVIEW",
          riskScore: 30,
          provenanceConfidence: 70,
          reasons: []
        },
        originPaths: [{
          verdict: "REVIEW",
          riskScoreContribution: 30,
          balanceShare: 0.25,
          pathAddresses: [hop, subject],
          steps: [{
            txHash: "tx-hop",
            fromAddress: hop,
            toAddress: subject,
            amountRaw: "1000000000",
            timestamp: "2026-07-04T12:00:00.000Z"
          }],
          sourceProvenance: [{
            mode: "source_provenance",
            targetTxHash: "tx-hop",
            targetFromAddress: hop,
            targetToAddress: subject,
            targetTimestamp: "2026-07-04T12:00:00.000Z",
            targetAmountRaw: "1000000000",
            proofClass: "exact",
            coverageRatio: 1,
            amountContinuity: "strong",
            stopReason: null,
            fundingBundle: {
              hopTxHash: "tx-hop",
              hopAddress: hop,
              expectedAmountRaw: "1000000000",
              coveredAmountRaw: "1000000000",
              coverageRatio: 1,
              members: [{
                txHash: "tx-funding",
                fromAddress: funder,
                toAddress: hop,
                originalAmountRaw: "1000000000",
                usedAmountRaw: "1000000000",
                timestamp: "2026-07-04T11:58:00.000Z",
                coverageShare: 1
              }]
            }
          }]
        }]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    expect(result.graph.summary.layerSummary?.whereFundingCandidateVisibility).toMatchObject({
      exactTotalCount: 1,
      exactShownCount: 1,
      probableTotalCount: 0,
      groupedHiddenCount: 0,
      maxProvenRouteDepth: 1
    });
    expect(result.graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fromNodeId: `addr:${funder}`,
        toNodeId: `addr:${hop}`,
        type: "transfer",
        displayRole: "real_transfer",
        txHash: "tx-funding",
        timestamp: "2026-07-04T11:58:00.000Z",
        metadata: expect.objectContaining({
          source: "where_funding_candidate_visibility",
          whereFundingRole: "exact_funding_candidate",
          proofClass: "exact",
          targetTxHash: "tx-hop",
          targetHopEdgeId: "edge:0:0",
          targetFromAddress: hop,
          targetToAddress: subject,
          visibilityReason: "selected_exact_funding_candidate"
        })
      })
    ]));
  });

  it("groups over-limit where funding candidates instead of silently hiding them", () => {
    const subject = "TSubject111111111111111111111111111111";
    const hop = "THopGroup11111111111111111111111111111";

    const result = projectForensicJobGraph(job({
      kind: "where_is_money_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        riskScore: 30,
        decision: "REVIEW",
        coverage: {
          selectedAmountRaw: "9000000000",
          targetAmountRaw: "9000000000"
        },
        assessment: {},
        originPaths: [{
          verdict: "REVIEW",
          riskScoreContribution: 30,
          balanceShare: 0.1,
          pathAddresses: [hop, subject],
          steps: [{
            txHash: "tx-hop",
            fromAddress: hop,
            toAddress: subject,
            amountRaw: "1000000000",
            timestamp: "2026-07-04T12:00:00.000Z"
          }],
          sourceProvenance: [{
            mode: "source_provenance",
            targetTxHash: "tx-hop",
            targetFromAddress: hop,
            targetToAddress: subject,
            targetTimestamp: "2026-07-04T12:00:00.000Z",
            targetAmountRaw: "1000000000",
            proofClass: "exact",
            coverageRatio: 1,
            amountContinuity: "strong",
            fundingBundle: {
              hopTxHash: "tx-hop",
              hopAddress: hop,
              expectedAmountRaw: "1000000000",
              coveredAmountRaw: "1000000000",
              coverageRatio: 1,
              members: Array.from({ length: 6 }, (_, index) => ({
                txHash: `tx-funding-${index}`,
                fromAddress: `TFunderGroup${index}111111111111111111`,
                toAddress: hop,
                originalAmountRaw: String((index + 1) * 1000000),
                usedAmountRaw: String((index + 1) * 1000000),
                timestamp: "2026-07-04T11:58:00.000Z",
                coverageShare: 0.2
              }))
            }
          }]
        }]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    expect(result.graph.summary.layerSummary?.whereFundingCandidateVisibility).toMatchObject({
      exactTotalCount: 6,
      exactShownCount: 5,
      groupedHiddenCount: 1
    });
    expect(result.graph.edges.filter((edge) =>
      edge.metadata.whereFundingRole === "exact_funding_candidate" &&
      edge.metadata.source === "where_funding_candidate_visibility"
    )).toHaveLength(5);
    expect(result.graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "bundle",
        displayKind: "funding_bundle",
        metadata: expect.objectContaining({
          whereFundingRole: "grouped_candidate_tail",
          hiddenCount: 1,
          targetTxHash: "tx-hop"
        })
      })
    ]));
    expect(result.graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metadata: expect.objectContaining({
          whereFundingRole: "grouped_candidate_tail",
          hiddenCount: 1
        })
      })
    ]));
  });

  it("renders where source-provenance caveats as visible stop facts", () => {
    const subject = "TSubject111111111111111111111111111111";
    const hop = "THopCaveat111111111111111111111111111";

    const result = projectForensicJobGraph(job({
      kind: "where_is_money_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        riskScore: 30,
        decision: "REVIEW",
        coverage: {},
        assessment: {},
        originPaths: [{
          verdict: "REVIEW",
          riskScoreContribution: 30,
          balanceShare: 0.1,
          pathAddresses: [hop, subject],
          steps: [{
            txHash: "tx-hop",
            fromAddress: hop,
            toAddress: subject,
            amountRaw: "1000000000",
            timestamp: "2026-07-04T12:00:00.000Z"
          }],
          sourceProvenance: [
            {
              mode: "source_provenance",
              targetTxHash: "tx-hop",
              targetFromAddress: hop,
              targetToAddress: subject,
              targetTimestamp: "2026-07-04T12:00:00.000Z",
              targetAmountRaw: "1000000000",
              proofClass: "unresolved",
              amountContinuity: "strong",
              stopReason: "funding_first_unresolved"
            },
            {
              mode: "source_provenance",
              targetTxHash: "tx-hop",
              targetFromAddress: hop,
              targetToAddress: subject,
              targetTimestamp: "2026-07-04T12:00:00.000Z",
              targetAmountRaw: "1000000000",
              proofClass: "pre_existing_balance_possible",
              amountContinuity: "strong",
              stopReason: "pre_existing_balance_possible"
            },
            {
              mode: "source_provenance",
              targetTxHash: "tx-hop",
              targetFromAddress: hop,
              targetToAddress: subject,
              targetTimestamp: "2026-07-04T12:00:00.000Z",
              targetAmountRaw: "1000000000",
              proofClass: "service_boundary",
              amountContinuity: "strong",
              stopReason: "service_boundary"
            }
          ]
        }]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    expect(result.graph.summary.layerSummary?.whereFundingCandidateVisibility).toMatchObject({
      unresolvedCaveatCount: 1,
      preExistingBalanceCaveatCount: 1,
      serviceBoundaryCount: 1
    });
    expect(result.graph.nodes.filter((node) => node.metadata.source === "where_funding_candidate_visibility")).toHaveLength(3);
    expect(result.graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "stop",
        metadata: expect.objectContaining({ whereFundingRole: "unresolved_source_caveat" })
      }),
      expect.objectContaining({
        type: "stop",
        metadata: expect.objectContaining({ whereFundingRole: "pre_existing_balance_caveat" })
      }),
      expect.objectContaining({
        type: "service_boundary",
        metadata: expect.objectContaining({ whereFundingRole: "service_boundary" })
      })
    ]));
  });

  it("shows residual unresolved source provenance as a caveat when materiality is below threshold", () => {
    const subject = "TSubject111111111111111111111111111111";
    const hop = "THopResidual1111111111111111111111111";

    const result = projectForensicJobGraph(job({
      kind: "where_is_money_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        riskScore: 45,
        decision: "REVIEW",
        scoreValid: true,
        scoreBlockedReason: null,
        technicalStatus: "completed",
        coverage: {
          coverageRatio: 1,
          currentBalanceRaw: "11175801645",
          targetAmountRaw: "11175801645",
          selectedAmountRaw: "11175801645"
        },
        assessment: {
          decision: "REVIEW",
          riskScore: 45,
          provenanceConfidence: 40,
          reasons: ["Residual unresolved source is below materiality."],
          sourceProvenanceMateriality: {
            outcome: "residual_unresolved_below_materiality",
            unresolvedAmountRaw: "14776543",
            unresolvedAmountUsdt: 14.776543,
            unresolvedShareOfCheckedBalance: 0.001322,
            unresolvedShareOfSelectedAmount: 0.001322,
            unresolvedPathCount: 5,
            hardEvidenceInUnresolved: false,
            unresolvedReasonCounts: {
              provider_cap_hit: 5,
              funding_source_unresolved: 5
            },
            thresholds: {
              maxResidualUnresolvedShare: 0.01,
              maxResidualUnresolvedAmountUsdt: 100,
              maxResidualUnresolvedAmountRaw: "100000000"
            }
          }
        },
        originPaths: [{
          verdict: "REVIEW",
          stoppedReason: "incoming_history_not_fetched",
          riskScoreContribution: 45,
          balanceShare: 0.001322,
          pathAddresses: [hop, subject],
          txHashes: ["tx-residual"],
          steps: [{
            txHash: "tx-residual",
            fromAddress: hop,
            toAddress: subject,
            amountRaw: "14776543",
            timestamp: "2026-07-01T12:39:03.000Z"
          }],
          sourceProvenance: [{
            mode: "source_provenance",
            targetTxHash: "tx-residual",
            targetFromAddress: hop,
            targetToAddress: subject,
            targetTimestamp: "2026-07-01T12:39:03.000Z",
            targetAmountRaw: "14776543",
            proofClass: "unresolved",
            coveredAmountRaw: "0",
            coverageRatio: 0,
            amountContinuity: "strong",
            stopReason: "incoming_history_not_fetched",
            fundingBundle: null,
            coverageWindow: {
              startTimestamp: null,
              endTimestamp: "2026-07-01T12:39:03.000Z",
              complete: false,
              capped: true,
              providerInconsistent: false
            },
            reasons: ["provider_cap_hit", "funding_source_unresolved"]
          }],
          reasons: ["Residual source unresolved."]
        }]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    expect(result.graph.summary.layerSummary?.sourceProvenanceMateriality).toMatchObject({
      outcome: "residual_unresolved_below_materiality",
      unresolvedAmountRaw: "14776543",
      unresolvedAmountUsdt: 14.776543,
      unresolvedShareOfCheckedBalance: 0.001322,
      unresolvedPathCount: 5,
      hardEvidenceInUnresolved: false
    });
    expect(result.graph.limitations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "residual_unresolved_source",
        severity: "info",
        explanation: expect.stringContaining("14.776543 USDT")
      })
    ]));
    expect(result.graph.limitations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: "History not fully fetched"
      })
    ]));
    expect(result.graph.limitations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "incoming_history_not_fetched",
        label: "Residual source caveat",
        severity: "review"
      })
    ]));
    expect(result.graph.paths[0]).toMatchObject({
      stopReason: "incoming_history_not_fetched",
      stopReasonLabel: "Residual source caveat"
    });
    expect(result.graph.summary.layerSummary?.sourceProvenanceMateriality).toMatchObject({
      unresolvedReasonCounts: expect.objectContaining({ funding_source_unresolved: 5 })
    });
  });

  it("hides where-is-money bundle-covered member edges and profile context duplicates", () => {
    const subject = "TSubject111111111111111111111111111111";
    const hop = "THop111111111111111111111111111111111";
    const funderA = "TFunderA11111111111111111111111111111";
    const funderB = "TFunderB11111111111111111111111111111";

    const result = projectForensicJobGraph(job({
      kind: "where_is_money_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        riskScore: 40,
        decision: "REVIEW",
        coverage: {
          coverageRatio: 1,
          targetAmountRaw: "40000000000",
          selectedAmountRaw: "40000000000"
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
            pathAddresses: [funderA, hop, subject],
            txHashes: ["tx-a", "tx-hop"],
            steps: [
              {
                txHash: "tx-a",
                fromAddress: funderA,
                toAddress: hop,
                amountRaw: "1700000000",
                timestamp: "2026-06-30T07:23:00.000Z"
              },
              {
                txHash: "tx-hop",
                fromAddress: hop,
                toAddress: subject,
                amountRaw: "40000000000",
                timestamp: "2026-06-30T07:25:00.000Z"
              }
            ],
            fundingBundles: [
              {
                hopTxHash: "tx-hop",
                hopAddress: hop,
                expectedAmountRaw: "40000000000",
                coveredAmountRaw: "40000000000",
                coverageRatio: 1,
                members: [
                  {
                    txHash: "tx-a",
                    fromAddress: funderA,
                    toAddress: hop,
                    originalAmountRaw: "1700000000",
                    usedAmountRaw: "1700000000",
                    timestamp: "2026-06-30T07:23:00.000Z"
                  },
                  {
                    txHash: "tx-b",
                    fromAddress: funderB,
                    toAddress: hop,
                    originalAmountRaw: "38300000000",
                    usedAmountRaw: "38300000000",
                    timestamp: "2026-06-30T07:24:00.000Z"
                  }
                ]
              }
            ],
            reasons: ["Path risk contribution"]
          }
        ],
        senderInteractionProfiles: [
          {
            senderAddress: hop,
            balanceTransferTxHash: "tx-hop",
            topIncomingCounterparties: [
              {
                address: funderA,
                volumeRaw: "1800000000",
                txHashes: ["tx-a", "tx-other-context"],
                txCount: 2,
                firstSeen: "2026-06-30T07:23:00.000Z",
                lastSeen: "2026-06-30T08:00:00.000Z"
              }
            ],
            topOutgoingCounterparties: []
          }
        ]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const bundleNode = result.graph.nodes.find((node) => node.kind === "bundle");
    expect(bundleNode).toBeDefined();
    expect(bundleNode?.metadata).toMatchObject({
      bundleKind: "money_origin_funding_bundle",
      hopAddress: hop,
      memberCount: 2
    });

    const bundleEdges = result.graph.edges.filter((edge) => edge.metadata.bundleNodeId === bundleNode?.id);
    expect(bundleEdges.map((edge) => edge.metadata.bundleRole).sort()).toEqual([
      "bundle_to_hop",
      "top_funder",
      "top_funder"
    ]);
    expect(bundleEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fromNodeId: expect.stringContaining("bundle:"),
        toNodeId: `addr:${hop}`,
        metadata: expect.objectContaining({ bundleRole: "bundle_to_hop" })
      }),
      expect.objectContaining({
        fromNodeId: `addr:${funderA}`,
        metadata: expect.objectContaining({ bundleRole: "top_funder" })
      }),
      expect.objectContaining({
        fromNodeId: `addr:${funderB}`,
        metadata: expect.objectContaining({ bundleRole: "top_funder" })
      })
    ]));
    expect(result.graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fromNodeId: `addr:${hop}`,
        toNodeId: `addr:${subject}`,
        txHash: "tx-hop"
      })
    ]));
    expect(result.graph.edges.find((edge) =>
      edge.fromNodeId === `addr:${funderA}` &&
      edge.toNodeId === `addr:${hop}` &&
      edge.txHash === "tx-a"
    )).toBeUndefined();
    expect(result.graph.edges.find((edge) =>
      edge.metadata.source === "senderInteractionProfile" &&
      edge.fromNodeId === `addr:${funderA}` &&
      edge.toNodeId === `addr:${hop}`
    )).toBeUndefined();
  });

  it("labels funding bundle wallet count by unique funders, not transfer rows", () => {
    const subject = "TSubject111111111111111111111111111111";
    const hop = "THop111111111111111111111111111111111";
    const funderA = "TFunderA111111111111111111111111111";
    const funderB = "TFunderB111111111111111111111111111";

    const result = projectForensicJobGraph(job({
      kind: "where_is_money_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        riskScore: 12,
        decision: "REVIEW",
        coverage: {},
        assessment: {},
        originPaths: [
          {
            verdict: "REVIEW",
            riskScoreContribution: 12,
            balanceShare: 1,
            pathAddresses: [hop, subject],
            steps: [{
              txHash: "tx-hop",
              fromAddress: hop,
              toAddress: subject,
              amountRaw: "2000000000000",
              timestamp: "2026-07-01T12:00:00.000Z"
            }],
            fundingBundles: [{
              hopTxHash: "tx-hop",
              hopAddress: hop,
              expectedAmountRaw: "2000000000000",
              coveredAmountRaw: "2000000000000",
              coverageRatio: 1,
              members: [
                {
                  txHash: "tx-a-1",
                  fromAddress: funderA,
                  toAddress: hop,
                  originalAmountRaw: "1000000000000",
                  usedAmountRaw: "1000000000000",
                  timestamp: "2026-07-01T11:50:00.000Z"
                },
                {
                  txHash: "tx-a-2",
                  fromAddress: funderA,
                  toAddress: hop,
                  originalAmountRaw: "999993999999",
                  usedAmountRaw: "999993999999",
                  timestamp: "2026-07-01T11:51:00.000Z"
                },
                {
                  txHash: "tx-b",
                  fromAddress: funderB,
                  toAddress: hop,
                  originalAmountRaw: "6000001",
                  usedAmountRaw: "6000001",
                  timestamp: "2026-07-01T11:52:00.000Z"
                }
              ]
            }]
          }
        ]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const bundleNode = result.graph.nodes.find((node) => node.kind === "bundle");
    expect(bundleNode?.metadata).toMatchObject({
      memberCount: 2,
      txCount: 3,
      funderCount: 2
    });
    expect(bundleNode?.metadata.topFunders).toHaveLength(2);
  });

  it("marks structured allowlisted CEX root-source addresses as CEX nodes", () => {
    const subject = "TSubject111111111111111111111111111111";
    const cex = "TKuCoin4111111111111111111111111111111";

    const result = projectForensicJobGraph(job({
      kind: "where_is_money_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        riskScore: 12,
        decision: "ACCEPTABLE",
        coverage: {
          coverageRatio: 1,
          targetAmountRaw: "1000000000",
          selectedAmountRaw: "1000000000"
        },
        assessment: {
          decision: "ACCEPTABLE",
          riskScore: 12,
          provenanceConfidence: 80,
          reasons: []
        },
        originPaths: [
          {
            verdict: "ACCEPTABLE",
            stoppedReason: "allowlist_cex_reached",
            rootSourceAddress: cex,
            rootSourceType: "allowlist_cex",
            sourceExposureKind: "allowlisted_cex",
            exposureSourceLabel: "KuCoin 4",
            riskScoreContribution: 0,
            balanceShare: 1,
            pathAddresses: [cex, subject],
            txHashes: ["tx-cex"],
            steps: [
              {
                txHash: "tx-cex",
                fromAddress: cex,
                toAddress: subject,
                amountRaw: "1000000000",
                timestamp: "2026-06-30T07:23:00.000Z"
              }
            ],
            reasons: ["Allowlisted CEX source reached."]
          }
        ]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const node = result.graph.nodes.find((item) => item.address === cex);
    expect(node).toMatchObject({
      kind: "service",
      displayKind: "cex",
      label: "KuCoin 4",
      displayLabel: "KuCoin 4",
      metadata: expect.objectContaining({
        category: "cex",
        serviceCategory: "cex",
        rootSourceType: "allowlist_cex",
        sourceExposureKind: "allowlisted_cex",
        identity: "KuCoin 4"
      })
    });
    expect(node?.metadata.boundaryIdentity).toMatchObject({
      category: "cex",
      displayName: "KuCoin 4",
      source: "known_cex_rule"
    });
  });

  it("infers allowlisted CEX identity from root-source reason text", () => {
    const subject = "TSubject111111111111111111111111111111";
    const cex = "TUpHuDkiCCmwaTZBHZvQdwWzGNm5t8J2b9";

    const result = projectForensicJobGraph(job({
      kind: "where_is_money_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        riskScore: 12,
        decision: "ACCEPTABLE",
        coverage: {},
        assessment: {},
        originPaths: [
          {
            verdict: "ACCEPTABLE",
            stoppedReason: "allowlist_cex_reached",
            rootSourceAddress: cex,
            rootSourceType: "allowlist_cex",
            riskScoreContribution: 5,
            balanceShare: 1,
            pathAddresses: [cex, subject],
            txHashes: ["tx-cex"],
            steps: [
              {
                txHash: "tx-cex",
                fromAddress: cex,
                toAddress: subject,
                amountRaw: "1700000000",
                timestamp: "2026-06-30T07:23:00.000Z"
              }
            ],
            reasons: ["Balance-forming path reaches allowlisted CEX KuCoin through clean on-chain hops."]
          }
        ]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const node = result.graph.nodes.find((item) => item.address === cex);
    expect(node).toMatchObject({
      kind: "service",
      displayKind: "cex",
      label: "KuCoin",
      displayLabel: "KuCoin",
      metadata: expect.objectContaining({
        category: "cex",
        identity: "KuCoin"
      })
    });
    expect(node?.metadata.boundaryIdentity).toMatchObject({
      displayName: "KuCoin",
      confidence: "high",
      source: "known_cex_rule"
    });
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
    const bundleNode = result.graph.nodes.find((node) => node.kind === "bundle");
    const memberTransfers = (bundleNode?.metadata.memberTransfers ?? []) as Array<Record<string, unknown>>;
    expect(result.graph.edges.find((item) => item.txHash === "tx-member")).toBeUndefined();
    expect(result.graph.edges.find((item) => item.txHash === "tx-usage")).toBeUndefined();
    expect(memberTransfers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        txHash: "tx-member",
        fromAddress: "TSource",
        toAddress: "TBoundary",
        amountRaw: "400",
        originalAmountRaw: "1000",
        usedAmountRaw: "400"
      }),
      expect.objectContaining({
        txHash: "tx-usage",
        fromAddress: "TOtherSource",
        toAddress: "TBoundary",
        amountRaw: "500",
        originalAmountRaw: "1200",
        usedAmountRaw: "500"
      })
    ]));
    const topFunderEdge = result.graph.edges.find((item) =>
      item.metadata.bundleRole === "top_funder" &&
      item.fromNodeId === "addr:TSource"
    );
    expect(topFunderEdge?.metadata).toMatchObject({
      txHashes: ["tx-member"],
      originalAmountRaw: "400",
      usedAmountRaw: "400",
      amountRole: "bundle_top_funder"
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
                  },
                  {
                    txHash: "tx-other",
                    fromAddress: "TOtherSource",
                    toAddress: "TBoundary",
                    originalAmountRaw: "1",
                    usedAmountRaw: "1",
                    timestamp: "2026-06-01T00:02:00.000Z"
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
    const bundleNode = result.graph.nodes.find((node) => node.kind === "bundle");
    const memberTransfers = (bundleNode?.metadata.memberTransfers ?? []) as Array<Record<string, unknown>>;
    const sharedEdges = result.graph.edges.filter((item) => item.txHash === "tx-shared");
    expect(sharedEdges).toHaveLength(0);
    expect(memberTransfers.filter((item) => item.txHash === "tx-shared")).toHaveLength(2);
    expect(memberTransfers[0]).toMatchObject({
      txHash: "tx-shared",
      originalAmountRaw: "1000",
      usedAmountRaw: "200",
      amountRaw: "200"
    });
    expect(memberTransfers[1]).toMatchObject({
      txHash: "tx-shared",
      originalAmountRaw: "1200",
      usedAmountRaw: "300",
      amountRaw: "300"
    });
  });

  it("merges where path allocations that reference the same physical transfer", () => {
    const subject = "TSubjectDuplicateAlloc1111111111111111";
    const source = "TSourceDuplicateAlloc11111111111111111";
    const hop = "THopDuplicateAlloc1111111111111111111";
    const txHash = "where-shared-transfer-tx";

    const result = projectForensicJobGraph(job({
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        riskScore: 45,
        decision: "REVIEW",
        coverage: {
          coverageRatio: 1,
          targetAmountRaw: "2500000000000"
        },
        assessment: {
          decision: "REVIEW",
          riskScore: 45,
          provenanceConfidence: 80,
          reasons: []
        },
        originPaths: [
          {
            verdict: "REVIEW",
            riskScoreContribution: 5,
            balanceShare: 0.25,
            pathAddresses: [source, hop, subject],
            steps: [
              {
                txHash,
                fromAddress: source,
                toAddress: hop,
                amountRaw: "700000000",
                timestamp: "2026-07-01T12:29:51.000Z",
                amountUsage: {
                  originalAmountRaw: "3500000000000",
                  usedAmountRaw: "700000000",
                  anchorAmountRaw: "700000000",
                  role: "funding_candidate"
                }
              },
              {
                txHash: "subject-hop-a",
                fromAddress: hop,
                toAddress: subject,
                amountRaw: "700000000",
                timestamp: "2026-07-01T12:31:00.000Z"
              }
            ],
            reasons: []
          },
          {
            verdict: "REVIEW",
            riskScoreContribution: 5,
            balanceShare: 0.75,
            pathAddresses: [source, hop, subject],
            steps: [
              {
                txHash,
                fromAddress: source,
                toAddress: hop,
                amountRaw: "2000000000000",
                timestamp: "2026-07-01T12:29:51.000Z",
                amountUsage: {
                  originalAmountRaw: "3500000000000",
                  usedAmountRaw: "2000000000000",
                  anchorAmountRaw: "2000000000000",
                  role: "funding_candidate"
                }
              },
              {
                txHash: "subject-hop-b",
                fromAddress: hop,
                toAddress: subject,
                amountRaw: "2000000000000",
                timestamp: "2026-07-01T12:32:00.000Z"
              }
            ],
            reasons: []
          }
        ]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const sharedEdges = result.graph.edges.filter((edge) => edge.txHash === txHash);
    expect(sharedEdges).toHaveLength(1);
    expect(sharedEdges[0]).toMatchObject({
      fromNodeId: `addr:${source}`,
      toNodeId: `addr:${hop}`,
      amountRaw: "3500000000000",
      metadata: {
        originalAmountRaw: "3500000000000",
        usedAmountRaw: "2000700000000",
        mergedAllocationEdgeIds: expect.arrayContaining(["edge:0:0", "edge:1:0"]),
        allocationDetails: expect.arrayContaining([
          expect.objectContaining({
            edgeId: "edge:0:0",
            pathId: "path:0",
            usedAmountRaw: "700000000"
          }),
          expect.objectContaining({
            edgeId: "edge:1:0",
            pathId: "path:1",
            usedAmountRaw: "2000000000000"
          })
        ])
      }
    });
    expect(result.graph.paths.find((path) => path.id === "path:0")?.edgeIds).toContain(sharedEdges[0].id);
    expect(result.graph.paths.find((path) => path.id === "path:1")?.edgeIds).toContain(sharedEdges[0].id);
  });

  it("drops no-tx inferred origin edges when a real same transfer is already projected", () => {
    const subject = "TSubject111111111111111111111111111111";
    const source = "TSource1111111111111111111111111111111";

    const result = projectForensicJobGraph(job({
      kind: "where_is_money_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        riskScore: 35,
        decision: "REVIEW",
        coverage: {
          targetAmountRaw: "5000000"
        },
        assessment: {
          decision: "REVIEW",
          riskScore: 35,
          provenanceConfidence: 60,
          reasons: []
        },
        originPaths: [
          {
            verdict: "REVIEW",
            riskScoreContribution: 35,
            amountRaw: "5000000",
            pathAddresses: [source, subject],
            steps: [
              {
                txHash: "real-five-usdt",
                fromAddress: source,
                toAddress: subject,
                amountRaw: "5000000",
                timestamp: "2026-03-07T10:14:00.000Z"
              }
            ],
            reasons: []
          },
          {
            verdict: "REVIEW",
            riskScoreContribution: 30,
            amountRaw: "5000000",
            pathAddresses: [source, subject],
            txHashes: [],
            steps: [],
            reasons: []
          }
        ]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const projected = result.graph.edges.filter((edge) =>
      edge.fromNodeId === `addr:${source}` &&
      edge.toNodeId === `addr:${subject}` &&
      edge.amountRaw === "5000000"
    );

    expect(projected).toHaveLength(1);
    expect(projected[0]).toMatchObject({
      txHash: "real-five-usdt",
      timestamp: "2026-03-07T10:14:00.000Z",
      type: "transfer"
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

  it("keeps history completeness separate from hop sufficiency", () => {
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: "TSubject666666666666666666666666666666",
      resultJson: {
        subject: "TSubject666666666666666666666666666666",
        stopReasons: [
          {
            address: "TStop6666666666666666666666666666666",
            reason: "incoming_history_not_fetched",
            historyFullyFetched: false,
            enoughHistoryForHop: true
          }
        ]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const stopNode = result.graph.nodes.find((node) => node.metadata?.reason === "incoming_history_not_fetched");

    expect(stopNode?.metadata?.historyFullyFetched).toBe(false);
    expect(stopNode?.metadata?.enoughHistoryForHop).toBe(true);
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
    const counterpartyNode = result.graph.nodes.find((node) => node.address === "TCounterparty1111111111111111111111111");
    expect(counterpartyNode?.displayLabel).toBe("TCount...111111");
    expect(counterpartyNode?.metadata.localRiskProfile).toMatchObject({
      localRisk: 70,
      source: "DeepCheck",
      sourceMode: "counterpartyRiskProfiles",
      scope: "observed graph",
      relationshipType: "inbound",
      reason: "darknet_exchange_proximity"
    });
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
    expect(result.graph.nodes.find((node) => node.address === "TCounterparty1111111111111111111111111")?.metadata.localRiskProfile).toMatchObject({
      localRisk: null,
      source: "DeepCheck",
      sourceMode: "counterpartyRiskProfiles",
      reason: "unscored_counterparty_context"
    });
    const unscoredCounterparty = result.graph.nodes.find((node) => node.address === "TCounterparty1111111111111111111111111");
    expect(unscoredCounterparty?.weight).toBeNull();
    expect(unscoredCounterparty?.riskLevel).toBeNull();
    const unscoredDirect = result.graph.nodes.find((node) => node.address === "TDirect111111111111111111111111111111");
    expect(unscoredDirect?.metadata.localRiskProfile).toMatchObject({
      localRisk: null,
      source: "DeepCheck",
      sourceMode: "directCounterpartyInteractionProfiles",
      txCount: 1
    });
    expect(unscoredDirect?.weight).toBeNull();
    expect(unscoredDirect?.riskLevel).toBeNull();
  });

  it("projects stored direct counterparty transfer details as one grouped evidence edge", () => {
    const subject = "TSubject111111111111111111111111111111";
    const counterparty = "TCounterparty1111111111111111111111111";
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [
          {
            counterpartyAddress: counterparty,
            direction: "inbound",
            volumeRaw: "2000000000",
            volumeRatio: 1,
            txCount: 2,
            firstSeen: "2026-05-20T10:00:00.000Z",
            lastSeen: "2026-05-20T10:02:00.000Z",
            txHashes: ["tx-900", "tx-1100"],
            evidenceClass: "counterparty_behavior_context",
            scoreContribution: 17,
            transfers: [
              {
                txHash: "tx-900",
                fromAddress: counterparty,
                toAddress: subject,
                amountRaw: "900000000",
                timestamp: "2026-05-20T10:00:00.000Z",
                method: "transfer",
                edgeType: "normal_transfer"
              },
              {
                txHash: "tx-1100",
                fromAddress: counterparty,
                toAddress: subject,
                amountRaw: "1100000000",
                timestamp: "2026-05-20T10:02:00.000Z",
                method: "transfer",
                edgeType: "normal_transfer"
              }
            ]
          }
        ],
        inboundProvenanceProfiles: [],
        boundaryExposureProfiles: [],
        serviceExposureProfiles: [],
        coverage: { transferEdges: 2 }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    expect(result.graph.edges.filter((edge) => edge.metadata.source === "directCounterpartyTransfer")).toHaveLength(0);
    const groupedEdge = result.graph.edges.find((edge) => edge.id === "edge:direct_counterparty:0");
    expect(groupedEdge).toMatchObject({
      type: "inferred_provenance",
      displayRole: "profile_context",
      amountRaw: "2000000000",
      txHash: null,
      timestamp: "2026-05-20T10:02:00.000Z",
      metadata: expect.objectContaining({
        source: "directCounterpartyInteractionProfile",
        evidenceType: "grouped_transfers",
        aggregateTransferCount: 2,
        aggregateAmountRaw: "2000000000",
        txHashes: ["tx-900", "tx-1100"]
      })
    });
    expect(groupedEdge?.metadata.underlyingTransfers).toEqual([
      expect.objectContaining({
        txHash: "tx-900",
        amountRaw: "900000000",
        timestamp: "2026-05-20T10:00:00.000Z"
      }),
      expect.objectContaining({
        txHash: "tx-1100",
        amountRaw: "1100000000",
        timestamp: "2026-05-20T10:02:00.000Z"
      })
    ]);
    expect(result.graph.paths.find((path) => path.id === "path:direct_counterparty:0")?.edgeIds).toEqual([
      "edge:direct_counterparty:0"
    ]);
  });

  it("drops no-tx deep counterparty context when the same real counterparty transfer is projected", () => {
    const subject = "TSubject111111111111111111111111111111";
    const counterparty = "TCounterparty1111111111111111111111111";
    const txHash = "real-direct-counterparty-tx";

    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        counterpartyRiskProfiles: [
          {
            counterpartyAddress: counterparty,
            label: "counterparty aggregate context",
            score: 12,
            direction: "outbound",
            amountRaw: "30902000000"
          }
        ],
        directCounterpartyInteractionProfiles: [
          {
            counterpartyAddress: counterparty,
            direction: "outbound",
            volumeRaw: "30902000000",
            volumeRatio: 1,
            txCount: 1,
            firstSeen: "2026-07-01T09:17:15.000Z",
            lastSeen: "2026-07-01T09:17:15.000Z",
            txHashes: [txHash],
            evidenceClass: "counterparty_behavior_context",
            scoreContribution: 0,
            transfers: [
              {
                txHash,
                fromAddress: subject,
                toAddress: counterparty,
                amountRaw: "30902000000",
                timestamp: "2026-07-01T09:17:15.000Z",
                method: "transfer",
                edgeType: "normal_transfer"
              }
            ]
          }
        ],
        inboundProvenanceProfiles: [],
        boundaryExposureProfiles: [],
        serviceExposureProfiles: [],
        coverage: { transferEdges: 1 }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const projected = result.graph.edges.filter((edge) =>
      edge.fromNodeId === `addr:${subject}` &&
      edge.toNodeId === `addr:${counterparty}` &&
      edge.amountRaw === "30902000000"
    );
    expect(projected).toHaveLength(1);
    expect(projected[0]).toMatchObject({
      txHash,
      timestamp: "2026-07-01T09:17:15.000Z",
      displayRole: "profile_context"
    });
  });

  it("never groups one direct counterparty transfer as grouped evidence", () => {
    const subject = "TNAraW3cWKETcRz9p6obg7SzeiMzH2Z9i1";
    const counterparty = "TPdrEz6N5pJoUbnnEcSz56e3wumV5mmGJE";
    const txHash = "318cb95612abe99b24a96d95e578a11d0170f3bd83fa458c8bd60ee4dc7fe654";
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [
          {
            counterpartyAddress: counterparty,
            direction: "inbound",
            volumeRaw: "900000000",
            volumeRatio: 1,
            txCount: 1,
            firstSeen: "2026-06-25T09:49:03.000Z",
            lastSeen: "2026-06-25T09:49:03.000Z",
            txHashes: [txHash],
            evidenceClass: "counterparty_behavior_context",
            scoreContribution: 0,
            transfers: [
              {
                txHash,
                fromAddress: counterparty,
                toAddress: subject,
                amountRaw: "900000000",
                timestamp: "2026-06-25T09:49:03.000Z",
                method: "transfer",
                edgeType: "normal_transfer"
              }
            ]
          }
        ],
        inboundProvenanceProfiles: [],
        boundaryExposureProfiles: [],
        serviceExposureProfiles: [],
        coverage: { transferEdges: 1 }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const edge = result.graph.edges.find((item) => item.txHash === txHash);
    expect(edge).toMatchObject({
      type: "inferred_provenance",
      displayRole: "profile_context",
      amountRaw: "900000000",
      txHash,
      timestamp: "2026-06-25T09:49:03.000Z",
      metadata: expect.objectContaining({
        source: "directCounterpartyInteractionProfile",
        txCount: 1,
        txHashes: [txHash],
        evidenceType: "direct_counterparty_transfer"
      })
    });
    expect(edge?.metadata.evidenceType).not.toBe("grouped_transfers");
    expect(edge?.metadata.aggregateTransferCount).toBeUndefined();
    expect(edge?.metadata.aggregateAmountRaw).toBeUndefined();
    expect(edge?.metadata.underlyingTransfers).toEqual([
      expect.objectContaining({
        txHash,
        amountRaw: "900000000",
        timestamp: "2026-06-25T09:49:03.000Z"
      })
    ]);
    expect(edge?.metadata.underlyingTransfers).toHaveLength(1);
  });

  it("keeps grouped opposite direct counterparty transfer directions separate", () => {
    const subject = "TSubject111111111111111111111111111111";
    const counterparty = "TCounterparty1111111111111111111111111";
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [
          {
            counterpartyAddress: counterparty,
            direction: "inbound",
            volumeRaw: "1700000000",
            volumeRatio: 0.5,
            txCount: 2,
            firstSeen: "2026-05-20T10:00:00.000Z",
            lastSeen: "2026-05-20T10:02:00.000Z",
            txHashes: ["tx-in-700", "tx-in-1000"],
            evidenceClass: "counterparty_behavior_context",
            scoreContribution: 0,
            transfers: [
              {
                txHash: "tx-in-700",
                fromAddress: counterparty,
                toAddress: subject,
                amountRaw: "700000000",
                timestamp: "2026-05-20T10:00:00.000Z",
                method: "transfer",
                edgeType: "normal_transfer"
              },
              {
                txHash: "tx-in-1000",
                fromAddress: counterparty,
                toAddress: subject,
                amountRaw: "1000000000",
                timestamp: "2026-05-20T10:02:00.000Z",
                method: "transfer",
                edgeType: "normal_transfer"
              }
            ]
          },
          {
            counterpartyAddress: counterparty,
            direction: "outbound",
            volumeRaw: "600000000",
            volumeRatio: 0.5,
            txCount: 2,
            firstSeen: "2026-05-20T10:10:00.000Z",
            lastSeen: "2026-05-20T10:12:00.000Z",
            txHashes: ["tx-out-250", "tx-out-350"],
            evidenceClass: "counterparty_behavior_context",
            scoreContribution: 0,
            transfers: [
              {
                txHash: "tx-out-250",
                fromAddress: subject,
                toAddress: counterparty,
                amountRaw: "250000000",
                timestamp: "2026-05-20T10:10:00.000Z",
                method: "transfer",
                edgeType: "normal_transfer"
              },
              {
                txHash: "tx-out-350",
                fromAddress: subject,
                toAddress: counterparty,
                amountRaw: "350000000",
                timestamp: "2026-05-20T10:12:00.000Z",
                method: "transfer",
                edgeType: "normal_transfer"
              }
            ]
          }
        ],
        inboundProvenanceProfiles: [],
        boundaryExposureProfiles: [],
        serviceExposureProfiles: [],
        coverage: { transferEdges: 4 }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const directEdges = result.graph.edges.filter((edge) => edge.metadata.source === "directCounterpartyInteractionProfile");
    expect(directEdges).toHaveLength(2);
    expect(directEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fromNodeId: `addr:${counterparty}`,
        toNodeId: `addr:${subject}`,
        txHash: null,
        amountRaw: "1700000000",
        metadata: expect.objectContaining({
          direction: "inbound",
          evidenceType: "grouped_transfers",
          aggregateTransferCount: 2,
          aggregateAmountRaw: "1700000000",
          txHashes: ["tx-in-700", "tx-in-1000"]
        })
      }),
      expect.objectContaining({
        fromNodeId: `addr:${subject}`,
        toNodeId: `addr:${counterparty}`,
        txHash: null,
        amountRaw: "600000000",
        metadata: expect.objectContaining({
          direction: "outbound",
          evidenceType: "grouped_transfers",
          aggregateTransferCount: 2,
          aggregateAmountRaw: "600000000",
          txHashes: ["tx-out-250", "tx-out-350"]
        })
      })
    ]));
  });

  it("does not group opposite direct counterparty transfer directions together", () => {
    const subject = "TNAraW3cWKETcRz9p6obg7SzeiMzH2Z9i1";
    const counterparty = "TPdrEz6N5pJoUbnnEcSz56e3wumV5mmGJE";
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [
          {
            counterpartyAddress: counterparty,
            direction: "inbound",
            volumeRaw: "700000000",
            volumeRatio: 0.5,
            txCount: 1,
            firstSeen: "2026-05-20T10:00:00.000Z",
            lastSeen: "2026-05-20T10:00:00.000Z",
            txHashes: ["tx-in"],
            evidenceClass: "counterparty_behavior_context",
            scoreContribution: 0,
            transfers: [
              {
                txHash: "tx-in",
                fromAddress: counterparty,
                toAddress: subject,
                amountRaw: "700000000",
                timestamp: "2026-05-20T10:00:00.000Z",
                method: "transfer",
                edgeType: "normal_transfer"
              }
            ]
          },
          {
            counterpartyAddress: counterparty,
            direction: "outbound",
            volumeRaw: "250000000",
            volumeRatio: 0.5,
            txCount: 1,
            firstSeen: "2026-05-20T10:10:00.000Z",
            lastSeen: "2026-05-20T10:10:00.000Z",
            txHashes: ["tx-out"],
            evidenceClass: "counterparty_behavior_context",
            scoreContribution: 0,
            transfers: [
              {
                txHash: "tx-out",
                fromAddress: subject,
                toAddress: counterparty,
                amountRaw: "250000000",
                timestamp: "2026-05-20T10:10:00.000Z",
                method: "transfer",
                edgeType: "normal_transfer"
              }
            ]
          }
        ],
        inboundProvenanceProfiles: [],
        boundaryExposureProfiles: [],
        serviceExposureProfiles: [],
        coverage: { transferEdges: 2 }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const directEdges = result.graph.edges.filter((edge) =>
      edge.metadata.evidenceType === "direct_counterparty_transfer" ||
      edge.metadata.evidenceType === "grouped_transfers"
    );
    expect(directEdges).toHaveLength(2);
    expect(directEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "edge:direct_counterparty:0",
        fromNodeId: `addr:${counterparty}`,
        toNodeId: `addr:${subject}`,
        txHash: "tx-in",
        metadata: expect.objectContaining({
          evidenceType: "direct_counterparty_transfer"
        })
      }),
      expect.objectContaining({
        id: "edge:direct_counterparty:1",
        fromNodeId: `addr:${subject}`,
        toNodeId: `addr:${counterparty}`,
        txHash: "tx-out",
        metadata: expect.objectContaining({
          evidenceType: "direct_counterparty_transfer"
        })
      })
    ]));

    const reciprocalEdgeIds = directEdges.map((edge) => edge.id).sort();
    const reciprocalPairKey = [`addr:${counterparty}`, `addr:${subject}`].sort().join("|");
    directEdges.forEach((edge) => {
      expect(edge.metadata.reciprocalFlow).toBe(true);
      expect(edge.metadata.reciprocalPairKey).toBe(reciprocalPairKey);
      expect(edge.metadata.reciprocalEdgeIds).toEqual(reciprocalEdgeIds);
    });
  });

  it("splits repeated direct counterparty transfers into separate episodes after 30 days", () => {
    const subject = "TSubject111111111111111111111111111111";
    const counterparty = "TCounterparty1111111111111111111111111";
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [
          {
            counterpartyAddress: counterparty,
            direction: "inbound",
            volumeRaw: "2300000000",
            volumeRatio: 1,
            txCount: 3,
            firstSeen: "2026-05-01T00:00:00.000Z",
            lastSeen: "2026-06-05T00:00:00.000Z",
            txHashes: ["tx-may-1", "tx-may-2", "tx-june-1"],
            evidenceClass: "counterparty_behavior_context",
            scoreContribution: 12,
            transfers: [
              {
                txHash: "tx-may-1",
                fromAddress: counterparty,
                toAddress: subject,
                amountRaw: "500000000",
                timestamp: "2026-05-01T00:00:00.000Z",
                method: "transfer",
                edgeType: "normal_transfer"
              },
              {
                txHash: "tx-may-2",
                fromAddress: counterparty,
                toAddress: subject,
                amountRaw: "700000000",
                timestamp: "2026-05-02T00:00:00.000Z",
                method: "transfer",
                edgeType: "normal_transfer"
              },
              {
                txHash: "tx-june-1",
                fromAddress: counterparty,
                toAddress: subject,
                amountRaw: "1100000000",
                timestamp: "2026-06-05T00:00:00.000Z",
                method: "transfer",
                edgeType: "normal_transfer"
              }
            ]
          }
        ],
        inboundProvenanceProfiles: [],
        boundaryExposureProfiles: [],
        serviceExposureProfiles: [],
        coverage: { transferEdges: 3 }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const directEdges = result.graph.edges.filter((edge) => edge.metadata.source === "directCounterpartyInteractionProfile");
    expect(directEdges).toHaveLength(2);
    expect(directEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        txHash: null,
        amountRaw: "1200000000",
        metadata: expect.objectContaining({
          evidenceType: "grouped_transfers",
          aggregateTransferCount: 2,
          aggregateAmountRaw: "1200000000",
          txHashes: ["tx-may-1", "tx-may-2"]
        })
      }),
      expect.objectContaining({
        txHash: "tx-june-1",
        amountRaw: "1100000000",
        metadata: expect.objectContaining({
          source: "directCounterpartyInteractionProfile",
          txHashes: ["tx-june-1"],
          txCount: 1
        })
      })
    ]));
    const singleEpisodeEdge = directEdges.find((edge) => edge.txHash === "tx-june-1");
    expect(singleEpisodeEdge?.metadata.evidenceType).toBe("direct_counterparty_transfer");
    expect(singleEpisodeEdge?.metadata.aggregateTransferCount).toBeUndefined();
    expect(singleEpisodeEdge?.metadata.aggregateAmountRaw).toBeUndefined();
    expect(result.graph.weights).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "weight:direct_counterparty:0",
        value: 12,
        pathId: "path:direct_counterparty:0",
        edgeId: "edge:direct_counterparty:0"
      }),
      expect.objectContaining({
        id: "weight:direct_counterparty:0:episode:1",
        value: 12,
        pathId: "path:direct_counterparty:0:episode:1",
        edgeId: "edge:direct_counterparty:0:episode:1"
      })
    ]));
    expect(result.graph.weights.filter((weight) => weight.source === "direct_counterparty_interaction")).toHaveLength(2);
  });

  it("preserves a legacy fallback direct counterparty tx hash when txCount is missing", () => {
    const subject = "TSubject111111111111111111111111111111";
    const counterparty = "TLegacyCounterparty111111111111111111";
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [
          {
            counterpartyAddress: counterparty,
            direction: "outbound",
            volumeRaw: "420000000",
            volumeRatio: 1,
            firstSeen: "2026-05-20T10:00:00.000Z",
            lastSeen: "2026-05-20T10:00:00.000Z",
            txHashes: ["tx-legacy-fallback"],
            evidenceClass: "counterparty_behavior_context",
            scoreContribution: 0
          }
        ],
        inboundProvenanceProfiles: [],
        boundaryExposureProfiles: [],
        serviceExposureProfiles: [],
        coverage: { transferEdges: 1 }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const edge = result.graph.edges.find((item) => item.id === "edge:direct_counterparty:0");
    expect(edge).toMatchObject({
      fromNodeId: `addr:${subject}`,
      toNodeId: `addr:${counterparty}`,
      amountRaw: "420000000",
      txHash: "tx-legacy-fallback",
      metadata: expect.objectContaining({
        source: "directCounterpartyInteractionProfile",
        txHashes: ["tx-legacy-fallback"]
      })
    });
    expect(edge?.metadata.evidenceType).toBeUndefined();
    expect(edge?.metadata.aggregateTransferCount).toBeUndefined();
    expect(edge?.metadata.aggregateAmountRaw).toBeUndefined();
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
      expect.objectContaining({ address: via, kind: "wallet" })
    ]));
    expect(result.graph.nodes.some((node) => node.address === dex)).toBe(false);
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
      })
    ]));
    expect(result.graph.edges.some((edge) => edge.metadata.source === "deepExpansionBoundaryStop")).toBe(false);
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

  it("promotes service exposure overlap wallets to service boundary nodes", () => {
    const subject = "TSubjectServiceOverlap1111111111111";
    const service = "TGasFreeServiceOverlap1111111111111";

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
            volumeRatio: 0.25,
            txCount: 4,
            evidenceClass: "direct_counterparty"
          }
        ],
        inboundProvenanceProfiles: [],
        serviceExposureProfiles: [
          {
            exposureScore: 12,
            topServiceCounterparties: [
              {
                address: service,
                category: "service",
                identity: "GasFree Account",
                volumeRaw: "50000000000",
                txCount: 4
              }
            ]
          }
        ],
        missingChecks: [],
        coverage: { transferEdges: 4 }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const node = result.graph.nodes.find((item) => item.address === service);
    expect(node?.kind).toBe("service");
    expect(node?.displayKind).toBe("service_boundary");
    expect(node?.displayLabel).toBe("GasFree Account");
    expect(node?.metadata.identity).toBe("GasFree Account");
    expect(node?.metadata.boundaryIdentity).toMatchObject({
      displayName: "GasFree Account",
      category: "service"
    });
  });

  it("promotes protocol service exposure overlap wallets to service boundary nodes", () => {
    const subject = "TSubjectProtocolOverlap111111111111";
    const protocol = "TStablecoinProtocolOverlap1111111111";

    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        boundaryExposureProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [
          {
            counterpartyAddress: protocol,
            direction: "outbound",
            volumeRaw: "75000000000",
            volumeRatio: 0.35,
            txCount: 5,
            evidenceClass: "direct_counterparty"
          }
        ],
        inboundProvenanceProfiles: [],
        serviceExposureProfiles: [
          {
            address: protocol,
            category: "protocol",
            identity: "Stablecoin protocol",
            exposureScore: 18,
            txCount: 5,
            volumeRaw: "75000000000",
            direction: "outbound"
          }
        ],
        missingChecks: [],
        coverage: { transferEdges: 5 }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const node = result.graph.nodes.find((item) => item.address === protocol);
    expect(node?.kind).toBe("service");
    expect(node?.displayKind).toBe("service_boundary");
    expect(node?.displayLabel).toBe("Stablecoin protocol");
    expect(node?.metadata.boundaryIdentity).toMatchObject({
      displayName: "Stablecoin protocol",
      category: "protocol",
      categoryLabel: "Protocol"
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

    const edge = result.graph.edges.find((item) => item.id === "edge:direct_counterparty:0");
    expect(edge).toMatchObject({
      txHash: null,
      metadata: expect.objectContaining({
        txHashes: ["service-edge-tx"]
      })
    });
    expect(edge?.metadata.evidenceType).toBeUndefined();
    expect(edge?.metadata.aggregateTransferCount).toBeUndefined();
    expect(edge?.metadata.aggregateAmountRaw).toBeUndefined();
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

    expect(result.graph.nodes.some((item) => item.address === contract)).toBe(false);
    expect(result.graph.edges.some((item) => item.toNodeId === `addr:${contract}`)).toBe(false);
    expect(result.graph.limitations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "deep_expansion_service_boundary",
        explanation: `Expansion stopped at service boundary ${contract} (unknown_contract)`,
        pathId: null
      })
    ]));
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

    expect(result.graph.nodes.some((item) => item.address === boundary)).toBe(false);
    expect(result.graph.edges.some((item) => item.toNodeId === `addr:${boundary}`)).toBe(false);
    expect(result.graph.limitations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "deep_expansion_service_boundary",
        explanation: `Expansion stopped at service boundary ${boundary}`,
        pathId: null
      })
    ]));
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

  it("keeps context-only deep-check boundary flows out of money-flow evidence", () => {
    const subject = "TSubjectContextOnly1111111111111111111";
    const cex = "TCexContextOnly111111111111111111111";

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
                direction: "outbound",
                depth: 1,
                boundaryAddress: cex,
                boundaryCategory: "cex",
                boundaryIdentity: "Exchange"
              }
            ]
          }
        ],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        inboundProvenanceProfiles: [],
        serviceExposureProfiles: [],
        missingChecks: [],
        coverage: { transferEdges: 0 }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const boundaryEdge = result.graph.edges.find((edge) => edge.type === "service_boundary");
    expect(boundaryEdge).toMatchObject({
      amountRaw: null,
      txHash: null,
      timestamp: null,
      displayRole: "profile_context",
      metadata: {
        evidenceType: "boundary_context_only",
        aggregateTransferCount: undefined,
        aggregateAmountRaw: undefined,
        underlyingTransfers: [],
        meaning: "Investigation stop, not a stored money transfer",
        deepCheckWalletCluster: {
          edgeType: "context_boundary",
          relationship: "shared_service_or_boundary"
        }
      }
    });
    expect(boundaryEdge?.metadata.boundaryContextOnly).toBe(true);
  });

  it("does not treat amount-only deep-check boundary flows as stored money evidence", () => {
    const subject = "TSubjectAmountOnly11111111111111111111";
    const cex = "TCexAmountOnly1111111111111111111111";

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
                direction: "outbound",
                depth: 1,
                boundaryAddress: cex,
                boundaryCategory: "cex",
                boundaryIdentity: "Exchange",
                amountRaw: "25000000000"
              }
            ]
          }
        ],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        inboundProvenanceProfiles: [],
        serviceExposureProfiles: [],
        missingChecks: [],
        coverage: { transferEdges: 0 }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const boundaryEdge = result.graph.edges.find((edge) => edge.type === "service_boundary");
    expect(boundaryEdge).toMatchObject({
      amountRaw: "25000000000",
      txHash: null,
      timestamp: null,
      metadata: {
        evidenceType: "boundary_context_only",
        aggregateTransferCount: undefined,
        aggregateAmountRaw: undefined,
        meaning: "Investigation stop, not a stored money transfer",
        underlyingTransfers: [],
        boundaryContextOnly: true
      }
    });
  });

  it("keeps context-only boundary stops out of transfer evidence", () => {
    const subject = "TS3gaJPExMNr63p4pxfY9CZPbJPHjfPjgf";

    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: subject,
      resultJson: {
        address: subject,
        boundaryStops: [{
          reason: "history_not_fully_fetched",
          label: "History incomplete",
          boundaryContextOnly: true
        }]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const boundaryEdge = result.graph.edges.find((edge) => edge.metadata.boundaryContextOnly === true);
    expect(boundaryEdge?.metadata).toMatchObject({
      evidenceType: "boundary_context_only",
      boundaryContextOnly: true,
      underlyingTransfers: [],
      meaning: "Investigation stop, not a stored money transfer"
    });
  });

  it("merges duplicated direct counterparty and boundary-hop edges for the same tx", () => {
    const subject = "TSubject111111111111111111111111111111";
    const via = "TViaDuplicate1111111111111111111111111";
    const cex = "TCexDuplicate111111111111111111111111";
    const subjectTx = "subject-hop-duplicate-tx";
    const boundaryTx = "boundary-hop-duplicate-tx";

    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        directCounterpartyInteractionProfiles: [
          {
            counterpartyAddress: via,
            direction: "inbound",
            volumeRaw: "10001000000",
            volumeRatio: 0.0279,
            txCount: 1,
            firstSeen: "2026-06-23T13:17:45.000Z",
            lastSeen: "2026-06-23T13:17:45.000Z",
            txHashes: [subjectTx],
            serviceCategory: null,
            identity: null,
            scoreContribution: 0,
            evidenceClass: "counterparty_behavior_context",
            skippedReason: "counterparty_behavior_context",
            transfers: [
              {
                txHash: subjectTx,
                fromAddress: via,
                toAddress: subject,
                amountRaw: "10001000000",
                timestamp: "2026-06-23T13:17:45.000Z",
                method: "transfer",
                edgeType: "normal_transfer"
              }
            ]
          }
        ],
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
                boundaryIdentity: "Bitget 9",
                amountRaw: "10001000000",
                boundaryAmountRaw: "99000000",
                amountPreservationRatio: 0.0098,
                subjectTxHash: subjectTx,
                boundaryTxHash: boundaryTx,
                firstTransferAt: "2024-10-04T14:24:06.000Z",
                lastTransferAt: "2026-06-23T13:17:45.000Z"
              }
            ]
          }
        ],
        counterpartyRiskProfiles: [],
        inboundProvenanceProfiles: [],
        serviceExposureProfiles: [],
        missingChecks: [],
        coverage: { transferEdges: 2 }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const subjectHopEdges = result.graph.edges.filter((edge) => edge.txHash === subjectTx);
    expect(subjectHopEdges).toHaveLength(1);
    expect(subjectHopEdges[0]).toMatchObject({
      fromNodeId: `addr:${via}`,
      toNodeId: `addr:${subject}`,
      metadata: {
        source: "directCounterpartyInteractionProfile",
        mergedBoundaryContexts: [
          expect.objectContaining({
            boundaryEntityName: "Bitget 9",
            subjectTxHash: subjectTx,
            boundaryTxHash: boundaryTx
          })
        ]
      }
    });
    expect(result.graph.paths.find((path) => path.id === "path:boundary_exposure:0:0")?.edgeIds)
      .toContain(subjectHopEdges[0].id);
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
      kind: "service",
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
      amountRaw: "1285313840000",
      txHash: null,
      metadata: expect.objectContaining({
        source: "directCounterpartyInteractionProfile",
        direction: "outbound",
        txCount: 8,
        txHashes: [],
        deepCheckWalletCluster: expect.objectContaining({
          edgeType: "context_boundary",
          relationship: "shared_service_or_boundary"
        })
      })
    });
    expect(result.graph.edges[0]?.metadata.evidenceType).toBeUndefined();
    expect(result.graph.edges[0]?.metadata.aggregateTransferCount).toBeUndefined();
    expect(result.graph.edges[0]?.metadata.aggregateAmountRaw).toBeUndefined();
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
          extendedIndexedEdges: 24,
          allTime: {
            mode: "strict",
            subjectIndexStatus: "complete",
            subjectCoverageMode: "all_time",
            subjectAllTimeComplete: true,
            subjectTransfersFetched: 4321,
            subjectUniqueDirectWallets: 87,
            directWalletsHardEvidenceChecked: 87,
            directWalletsHardEvidenceLiveChecked: 25,
            directHardEvidenceStatus: "live_budget_exhausted",
            directWalletsQueuedForIndexing: 0,
            secondLayerActiveBudget: 0,
            secondLayerQueued: 0,
            secondLayerComplete: 0,
            providerCapHit: false,
            providerInconsistent: true
          }
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
        metadataEnrichmentLimited: true,
        allTimeCoverage: {
          mode: "strict",
          subjectIndexStatus: "complete",
          subjectCoverageMode: "all_time",
          subjectAllTimeComplete: true,
          subjectTransfersFetched: 4321,
          subjectUniqueDirectWallets: 87,
          directWalletsHardEvidenceChecked: 87,
          directWalletsHardEvidenceLiveChecked: 25,
          directHardEvidenceStatus: "live_budget_exhausted",
          directWalletsQueuedForIndexing: 0,
          secondLayerActiveBudget: 0,
          secondLayerQueued: 0,
          secondLayerComplete: 0,
          providerCapHit: false,
          providerInconsistent: true
        }
      }
    });
    expect(result.graph.edges.some((edge) => edge.metadata.source === "deepExpansionBoundaryStop")).toBe(false);
    expect(result.graph.nodes.some((node) => node.metadata.source === "deepExpansionBoundaryStop")).toBe(false);
    expect(result.graph.limitations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "deep_expansion_service_boundary",
        pathId: null
      })
    ]));
  });

  it("projects all-time deep-check coverage from progress when result omits it", () => {
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: "TSubject111111111111111111111111111111",
      progressJson: {
        allTimeCoverage: {
          mode: "partial",
          subjectIndexStatus: "queued",
          subjectCoverageMode: "targeted",
          subjectAllTimeComplete: false,
          subjectTransfersFetched: 120,
          subjectUniqueDirectWallets: 31,
          directWalletsHardEvidenceChecked: 0,
          directWalletsHardEvidenceLiveChecked: 0,
          directHardEvidenceStatus: "local_only_partial",
          directWalletsQueuedForIndexing: 0,
          secondLayerActiveBudget: 0,
          secondLayerQueued: 0,
          secondLayerComplete: 0,
          providerCapHit: false,
          providerInconsistent: false
        }
      },
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        boundaryExposureProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        inboundProvenanceProfiles: [],
        serviceExposureProfiles: [],
        missingChecks: [],
        coverage: {
          transferEdges: 12
        },
        coverageDebug: {
          summary: {
            analyzedCounterpartyCount: 0,
            expandedCounterpartyCount: 0
          }
        }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    expect(result.graph.summary.layerSummary).toMatchObject({
      deepCheckCoverage: {
        allTimeCoverage: {
          mode: "partial",
          subjectIndexStatus: "queued",
          subjectCoverageMode: "targeted",
          subjectAllTimeComplete: false,
          subjectTransfersFetched: 120,
          subjectUniqueDirectWallets: 31,
          directWalletsQueuedForIndexing: 0,
          providerCapHit: false,
          providerInconsistent: false
        }
      }
    });
  });

  it("projects saved deep-check extended paths including non-subject cross-wallet edges", () => {
    const subject = "TSubject111111111111111111111111111111";
    const walletA = "TWalletA111111111111111111111111111111";
    const walletB = "TWalletB111111111111111111111111111111";
    const walletC = "TWalletC111111111111111111111111111111";
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: subject,
      progressJson: {
        allTimeCoverage: {
          secondLayerQueued: 0,
          secondLayerComplete: 0
        }
      },
      resultJson: {
        subjectAddress: subject,
        boundaryExposureProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        inboundProvenanceProfiles: [],
        serviceExposureProfiles: [],
        missingChecks: ["Expansion stopped at service boundary TBoundary11111111111111111111111111 (cex)"],
        coverage: {
          transferEdges: 4
        },
        coverageDebug: {
          missingChecks: []
        },
        extendedProvenanceProfiles: [
          {
            direction: "outbound",
            score: 42,
            paths: [
              {
                pathAddresses: [subject, walletA, walletB],
                txHashes: ["tx-subject-a", "tx-a-b"],
                amountRaw: "120000000",
                depth: 2,
                candidateScore: 42,
                evidenceStrength: "service_boundary_context",
                label: "service_boundary",
                firstTransferAt: "2026-06-01T00:00:00.000Z",
                lastTransferAt: "2026-06-01T00:05:00.000Z",
                stoppedReason: "service_boundary"
              },
              {
                pathAddresses: [walletA, walletB, walletC],
                txHashes: ["tx-a-b-2", "tx-b-c"],
                amountRaw: "80000000",
                depth: 2,
                candidateScore: 36,
                evidenceStrength: "weak_candidate",
                label: "cross_wallet_continuation",
                firstTransferAt: "2026-06-01T00:10:00.000Z",
                lastTransferAt: "2026-06-01T00:20:00.000Z",
                stopReason: "max_depth"
              }
            ],
            coverage: {
              fetchedAddressCount: 3
            }
          }
        ]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    expect(result.graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fromNodeId: `addr:${walletA}`,
        toNodeId: `addr:${walletB}`,
        txHash: "tx-a-b",
        metadata: expect.objectContaining({
          source: "deepcheck_extended_path",
          relationship: "cross_wallet_edge",
          depth: 2,
          pathIndex: 0,
          edgeIndex: 1,
          direction: "outbound",
          evidenceStrength: "service_boundary_context",
          stopReason: "service_boundary",
          limitationCode: "deepcheck_extended_path_stopped"
        })
      }),
      expect.objectContaining({
        fromNodeId: `addr:${walletB}`,
        toNodeId: `addr:${walletC}`,
        txHash: "tx-b-c",
        metadata: expect.objectContaining({
          source: "deepcheck_extended_path",
          relationship: "cross_wallet_edge",
          stopReason: "max_depth"
        })
      })
    ]));
    expect(result.graph.nodes.find((node) => node.address === walletC)?.metadata).toMatchObject({
      source: "deepcheck_extended_path",
      stopReason: "max_depth"
    });
    expect(result.graph.summary.layerSummary).toMatchObject({
      deepCheckCoverage: {
        extendedPathsCount: 2,
        renderedExtendedEdges: 4,
        maxSavedDepth: 2,
        stopReasonsCount: 2,
        secondLayerQueued: 0,
        secondLayerComplete: 0
      }
    });
    expect(result.graph.summary.layerSummary?.projectedProfiles).toMatchObject({
      extendedProvenanceProfiles: 1,
      extendedProvenancePaths: 2
    });
  });

  it("projects relationship second-layer paths, statuses, groups, and coverage", () => {
    const subject = "TSubject111111111111111111111111111111";
    const walletA = "TWalletA111111111111111111111111111111";
    const walletB = "TWalletB111111111111111111111111111111";
    const queuedWallet = "TQueuedWallet111111111111111111111111";
    const tailAddress = "TTailWallet11111111111111111111111111";
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: subject,
      progressJson: {
        allTimeCoverage: {
          secondLayerQueued: 4,
          secondLayerComplete: 8
        }
      },
      resultJson: {
        subjectAddress: subject,
        boundaryExposureProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        inboundProvenanceProfiles: [],
        serviceExposureProfiles: [],
        missingChecks: [],
        coverage: {
          transferEdges: 2
        },
        coverageDebug: {
          missingChecks: []
        },
        secondLayerRelationshipProfiles: {
          directWalletStatuses: [
            {
              address: walletA,
              status: "grouped",
              reason: "low_signal_neighbors",
              savedPathCount: 1,
              groupedNeighborCount: 1,
              serviceCategory: "wallet",
              identity: "Wallet A"
            },
            {
              address: queuedWallet,
              status: "queued",
              stopReason: "queued_for_indexing",
              limitationCode: "second_layer_queued",
              queued: true,
              index: {
                status: "queued"
              }
            }
          ],
          paths: [
            {
              id: "second-hop-1",
              source: "deepcheck_relationship_second_hop",
              depth: 2,
              subjectAddress: subject,
              directWalletAddress: walletA,
              secondHopAddress: walletB,
              pathAddresses: [subject, walletA, walletB],
              txHashes: ["tx-subject-a", "tx-a-b"],
              amountRaw: "120000000",
              txCount: 2,
              firstSeen: "2026-06-01T00:00:00.000Z",
              lastSeen: "2026-06-01T00:05:00.000Z",
              selectionReason: "largest_flow"
            }
          ],
          groups: [
            {
              id: "group-1",
              kind: "low_signal_neighbors",
              label: "Low signal neighbors",
              subjectAddress: subject,
              directWalletAddress: walletA,
              memberCount: 1,
              members: [tailAddress],
              txCount: 7,
              amountRaw: "70000000",
              firstSeen: "2026-06-01T00:10:00.000Z",
              lastSeen: "2026-06-01T00:20:00.000Z"
            }
          ],
          counters: {
            directWalletsConsidered: 2,
            expanded: 1,
            grouped: 1,
            stopped: 0,
            notIndexed: 0,
            queued: 1,
            complete: 1,
            paths: 1,
            groups: 1,
            maxSavedDepth: 2
          }
        }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    expect(result.graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fromNodeId: `addr:${walletA}`,
        toNodeId: `addr:${walletB}`,
        txHash: "tx-a-b",
        metadata: expect.objectContaining({
          source: "deepcheck_relationship_second_hop",
          evidenceType: "deepcheck_relationship_second_hop",
          relationship: "second_hop_edge",
          pathId: "path:second_layer_relationship:0",
          pathSourceId: "second-hop-1",
          edgeIndex: 1,
          depth: 2,
          txCount: 2,
          selectionReason: "largest_flow"
        })
      })
    ]));

    expect(result.graph.paths).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "path:second_layer_relationship:0",
        nodeIds: [`addr:${subject}`, `addr:${walletA}`, `addr:${walletB}`],
        verdict: "UNKNOWN",
        riskContribution: 0
      })
    ]));

    expect(result.graph.nodes.find((node) => node.address === queuedWallet)?.metadata).toMatchObject({
      source: "deepcheck_relationship_second_layer",
      secondLayerStatus: "queued",
      stopReason: "queued_for_indexing",
      limitationCode: "second_layer_queued",
      queued: true,
      index: {
        status: "queued"
      }
    });

    const groupNode = result.graph.nodes.find((node) =>
      node.metadata.realGroupKind === "deep_second_layer_group" &&
      node.metadata.groupId === "group-1"
    );
    expect(groupNode).toMatchObject({
      kind: "bundle",
      displayKind: "funding_bundle",
      metadata: expect.objectContaining({
        source: "deepcheck_relationship_second_layer",
        groupReason: "deep_second_layer_low_signal_neighbors",
        collapsedCount: 1,
        memberCount: 1,
        members: [tailAddress]
      })
    });
    expect(result.graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fromNodeId: `addr:${walletA}`,
        toNodeId: groupNode?.id,
        metadata: expect.objectContaining({
          source: "deepcheck_relationship_second_hop",
          evidenceType: "deepcheck_second_layer_group",
          relationship: "grouped_tail",
          groupId: "group-1",
          groupKind: "low_signal_neighbors",
          aggregateTransferCount: 7
        })
      })
    ]));

    expect(result.graph.summary.layerSummary).toMatchObject({
      deepCheckCoverage: {
        secondLayerRelationshipPaths: 1,
        secondLayerRelationshipGroups: 1,
        secondLayerQueued: 1,
        secondLayerComplete: 1,
        maxSavedDepth: 2
      }
    });
    expect(result.graph.summary.layerSummary?.projectedProfiles).toMatchObject({
      secondLayerRelationshipPaths: 1,
      secondLayerRelationshipGroups: 1
    });
  });

  it("keeps relationship second-hop tx evidence off subject context edges", () => {
    const subject = "TSubject111111111111111111111111111111";
    const walletA = "TWalletA111111111111111111111111111111";
    const walletB = "TWalletB111111111111111111111111111111";
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
        missingChecks: [],
        coverage: {
          transferEdges: 2
        },
        coverageDebug: {
          missingChecks: []
        },
        secondLayerRelationshipProfiles: {
          paths: [
            {
              id: "second-hop-evidence",
              depth: 2,
              subjectAddress: subject,
              directWalletAddress: walletA,
              secondHopAddress: walletB,
              pathAddresses: [subject, walletA, walletB],
              txHashes: ["tx-a-b-1", "tx-a-b-2"],
              amountRaw: "300",
              txCount: 2,
              firstSeen: "2026-06-01T00:00:00.000Z",
              lastSeen: "2026-06-01T00:05:00.000Z",
              selectionReason: "largest_flow"
            }
          ]
        }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const subjectContextEdge = result.graph.edges.find((edge) =>
      edge.fromNodeId === `addr:${subject}` &&
      edge.toNodeId === `addr:${walletA}` &&
      edge.metadata.evidenceType === "deepcheck_relationship_second_hop"
    );
    const secondHopEdge = result.graph.edges.find((edge) =>
      edge.fromNodeId === `addr:${walletA}` &&
      edge.toNodeId === `addr:${walletB}` &&
      edge.metadata.evidenceType === "deepcheck_relationship_second_hop"
    );

    expect(subjectContextEdge).toMatchObject({
      txHash: null,
      amountRaw: null,
      metadata: expect.objectContaining({
        relationship: "direct_subject_edge",
        deepCheckWalletCluster: expect.objectContaining({
          edgeType: "profile_context",
          relationship: "subject_neighborhood"
        })
      })
    });
    expect(subjectContextEdge?.metadata).not.toHaveProperty("txHashes");
    expect(secondHopEdge).toMatchObject({
      amountRaw: "300",
      metadata: expect.objectContaining({
        relationship: "second_hop_edge",
        deepCheckWalletCluster: expect.objectContaining({
          edgeType: "proven_transaction",
          relationship: "wallet_to_wallet"
        }),
        txHashes: ["tx-a-b-1", "tx-a-b-2"],
        txCount: 2,
        firstSeen: "2026-06-01T00:00:00.000Z",
        lastSeen: "2026-06-01T00:05:00.000Z"
      })
    });
  });

  it("preserves duplicate relationship second-hop path facts", () => {
    const subject = "TSubject111111111111111111111111111111";
    const walletA = "TWalletA111111111111111111111111111111";
    const walletB = "TWalletB111111111111111111111111111111";
    const txHash = "tx-a-b-duplicate-path";
    const amountRaw = "300";
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
        missingChecks: [],
        coverage: {
          transferEdges: 2
        },
        coverageDebug: {
          missingChecks: []
        },
        secondLayerRelationshipProfiles: {
          paths: [
            {
              id: "second-hop-1",
              depth: 2,
              subjectAddress: subject,
              directWalletAddress: walletA,
              secondHopAddress: walletB,
              pathAddresses: [subject, walletA, walletB],
              txHashes: [txHash],
              amountRaw,
              txCount: 1,
              firstSeen: "2026-06-01T00:00:00.000Z",
              lastSeen: "2026-06-01T00:00:00.000Z",
              selectionReason: "largest_flow"
            },
            {
              id: "second-hop-2",
              depth: 2,
              subjectAddress: subject,
              directWalletAddress: walletA,
              secondHopAddress: walletB,
              pathAddresses: [subject, walletA, walletB],
              txHashes: [txHash],
              amountRaw,
              txCount: 1,
              firstSeen: "2026-06-01T00:00:00.000Z",
              lastSeen: "2026-06-01T00:00:00.000Z",
              selectionReason: "highest_velocity"
            }
          ]
        }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const secondHopEdges = result.graph.edges.filter((edge) =>
      edge.fromNodeId === `addr:${walletA}` &&
      edge.toNodeId === `addr:${walletB}` &&
      edge.txHash === txHash &&
      edge.amountRaw === amountRaw &&
      edge.metadata.evidenceType === "deepcheck_relationship_second_hop"
    );

    expect(secondHopEdges).toHaveLength(2);
    expect(secondHopEdges.map((edge) => edge.metadata.pathSourceId).sort()).toEqual(["second-hop-1", "second-hop-2"]);
    expect(secondHopEdges.map((edge) => edge.metadata.selectionReason).sort()).toEqual(["highest_velocity", "largest_flow"]);
    expect(secondHopEdges.map((edge) => edge.id).sort()).toEqual([
      "edge:second_layer_relationship:0:1",
      "edge:second_layer_relationship:1:1"
    ]);
  });

  it("keeps relationship second-hop edges separate from duplicate extended transfer edges", () => {
    const subject = "TSubject111111111111111111111111111111";
    const walletA = "TWalletA111111111111111111111111111111";
    const walletB = "TWalletB111111111111111111111111111111";
    const txHash = "tx-a-b-duplicate";
    const amountRaw = "120000000";
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
        missingChecks: [],
        coverage: {
          transferEdges: 2
        },
        coverageDebug: {
          missingChecks: []
        },
        extendedProvenanceProfiles: [
          {
            direction: "outbound",
            score: 12,
            paths: [
              {
                pathAddresses: [subject, walletA, walletB],
                txHashes: ["tx-subject-a", txHash],
                amountRaw,
                depth: 2,
                candidateScore: 12,
                evidenceStrength: "weak_candidate",
                firstTransferAt: "2026-06-01T00:00:00.000Z",
                lastTransferAt: "2026-06-01T00:05:00.000Z"
              }
            ]
          }
        ],
        secondLayerRelationshipProfiles: {
          paths: [
            {
              id: "second-hop-duplicate",
              depth: 2,
              subjectAddress: subject,
              directWalletAddress: walletA,
              secondHopAddress: walletB,
              pathAddresses: [subject, walletA, walletB],
              txHashes: ["tx-subject-a", txHash],
              amountRaw,
              txCount: 2,
              firstSeen: "2026-06-01T00:00:00.000Z",
              lastSeen: "2026-06-01T00:05:00.000Z",
              selectionReason: "largest_flow"
            }
          ]
        }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    expect(result.graph.edges.find((edge) =>
      edge.fromNodeId === `addr:${walletA}` &&
      edge.toNodeId === `addr:${walletB}` &&
      edge.txHash === txHash &&
      edge.amountRaw === amountRaw &&
      edge.metadata.evidenceType === "deepcheck_relationship_second_hop"
    )).toMatchObject({
      metadata: expect.objectContaining({
        source: "deepcheck_relationship_second_hop",
        relationship: "second_hop_edge",
        pathSourceId: "second-hop-duplicate",
        selectionReason: "largest_flow"
      })
    });
    expect(result.graph.edges.find((edge) =>
      edge.fromNodeId === `addr:${walletA}` &&
      edge.toNodeId === `addr:${walletB}` &&
      edge.txHash === txHash &&
      edge.amountRaw === amountRaw &&
      edge.metadata.evidenceType === "deepcheck_extended_path"
    )).toBeDefined();
  });

  it("does not project explicit relationship second-layer paths with only subject and direct wallet", () => {
    const subject = "TSubject111111111111111111111111111111";
    const walletA = "TWalletA111111111111111111111111111111";
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
        missingChecks: [],
        coverage: {
          transferEdges: 0
        },
        coverageDebug: {
          missingChecks: []
        },
        secondLayerRelationshipProfiles: {
          paths: [
            {
              id: "partial-explicit-path",
              subjectAddress: subject,
              directWalletAddress: walletA,
              pathAddresses: [subject, walletA],
              txHashes: ["tx-subject-a"],
              amountRaw: "120000000"
            }
          ]
        }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    expect(result.graph.edges.filter((edge) =>
      edge.metadata.source === "deepcheck_relationship_second_hop"
    )).toEqual([]);
    expect(result.graph.paths.some((path) => path.id.startsWith("path:second_layer_relationship:"))).toBe(false);
  });

  it("does not count malformed relationship second-layer paths or groups as projected coverage", () => {
    const subject = "TSubject111111111111111111111111111111";
    const walletA = "TWalletA111111111111111111111111111111";
    const walletB = "TWalletB111111111111111111111111111111";
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
        missingChecks: [],
        coverage: {
          transferEdges: 0
        },
        coverageDebug: {
          missingChecks: []
        },
        secondLayerRelationshipProfiles: {
          paths: [
            {
              id: "full-length-no-facts",
              pathAddresses: [subject, walletA, walletB]
            },
            {
              id: "partial-explicit-path",
              depth: 4,
              pathAddresses: [subject, walletA],
              txHashes: ["tx-subject-a"]
            },
            {
              id: "missing-direct-wallet",
              depth: 3,
              subjectAddress: subject,
              secondHopAddress: walletB,
              txHashes: ["tx-subject-b"]
            }
          ],
          groups: [
            {
              id: "empty-anchored-group",
              kind: "low_signal_neighbors",
              directWalletAddress: walletA
            },
            {
              id: "missing-group-anchor",
              kind: "low_signal_neighbors",
              members: [walletB],
              memberCount: 1
            }
          ],
          counters: {
            paths: 2,
            groups: 1,
            queued: 3,
            complete: 5,
            maxSavedDepth: 4
          }
        }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    expect(result.graph.summary.layerSummary).toMatchObject({
      deepCheckCoverage: {
        secondLayerRelationshipPaths: 0,
        secondLayerRelationshipGroups: 0,
        secondLayerQueued: 3,
        secondLayerComplete: 5,
        maxSavedDepth: 0
      },
      projectedProfiles: {
        secondLayerRelationshipPaths: 0,
        secondLayerRelationshipGroups: 0
      }
    });
    expect(result.graph.edges.filter((edge) =>
      edge.metadata.source === "deepcheck_relationship_second_hop"
    )).toEqual([]);
    expect(result.graph.paths.some((path) => path.id.startsWith("path:second_layer_relationship:"))).toBe(false);
    expect(result.graph.nodes.some((node) =>
      node.metadata.realGroupKind === "deep_second_layer_group"
    )).toBe(false);
  });

  it("projects relationship second-layer legacy anchor aliases", () => {
    const subject = "TSubject111111111111111111111111111111";
    const walletA = "TWalletA111111111111111111111111111111";
    const walletB = "TWalletB111111111111111111111111111111";
    const tailAddress = "TTailWallet11111111111111111111111111";
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
        missingChecks: [],
        coverage: {
          transferEdges: 1
        },
        coverageDebug: {
          missingChecks: []
        },
        secondLayerRelationshipProfiles: {
          paths: [
            {
              id: "legacy-path",
              depth: 2,
              subjectAddress: subject,
              anchorAddress: walletA,
              neighborAddress: walletB,
              txHashes: ["tx-a-b"],
              firstTransferAt: "2026-06-01T00:00:00.000Z",
              lastTransferAt: "2026-06-01T00:05:00.000Z"
            }
          ],
          groups: [
            {
              id: "legacy-group",
              kind: "low_signal_neighbors",
              subjectAddress: subject,
              anchorAddress: walletA,
              memberCount: 1,
              members: [{ address: tailAddress }],
              totalAmountRaw: "50000000",
              txCount: 3
            }
          ]
        }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    expect(result.graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fromNodeId: `addr:${walletA}`,
        toNodeId: `addr:${walletB}`,
        txHash: "tx-a-b",
        timestamp: "2026-06-01T00:05:00.000Z",
        metadata: expect.objectContaining({
          source: "deepcheck_relationship_second_hop",
          pathSourceId: "legacy-path"
        })
      }),
      expect.objectContaining({
        fromNodeId: `addr:${walletA}`,
        metadata: expect.objectContaining({
          relationship: "grouped_tail",
          groupId: "legacy-group",
          aggregateAmountRaw: "50000000"
        })
      })
    ]));
  });

  it("ignores malformed relationship second-layer fallback paths without fabricating edges", () => {
    const subject = "TSubject111111111111111111111111111111";
    const walletA = "TWalletA111111111111111111111111111111";
    const walletB = "TWalletB111111111111111111111111111111";
    const queuedWallet = "TQueuedWallet111111111111111111111111";
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
        missingChecks: [],
        coverage: {
          transferEdges: 0
        },
        coverageDebug: {
          missingChecks: []
        },
        secondLayerRelationshipProfiles: {
          directWalletStatuses: [
            {
              address: queuedWallet,
              status: "queued",
              queued: true,
              stopReason: "queued_for_indexing"
            }
          ],
          paths: [
            {
              id: "missing-second-hop",
              subjectAddress: subject,
              directWalletAddress: walletA,
              txHashes: ["tx-subject-a"]
            },
            {
              id: "missing-direct-wallet",
              subjectAddress: subject,
              secondHopAddress: walletB,
              txHashes: ["tx-subject-b"]
            },
            {
              id: "legacy-missing-neighbor",
              subjectAddress: subject,
              anchorAddress: walletA,
              txHashes: ["tx-subject-a-legacy"]
            },
            {
              id: "legacy-missing-anchor",
              subjectAddress: subject,
              neighborAddress: walletB,
              txHashes: ["tx-subject-b-legacy"]
            }
          ]
        }
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    expect(result.graph.edges.filter((edge) =>
      edge.metadata.source === "deepcheck_relationship_second_hop"
    )).toEqual([]);
    expect(result.graph.nodes.find((node) => node.address === queuedWallet)?.metadata).toMatchObject({
      source: "deepcheck_relationship_second_layer",
      secondLayerStatus: "queued",
      queued: true,
      stopReason: "queued_for_indexing"
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

  it("projects incoming contract-driven deposits through the spender contract without direct duplicates", () => {
    const sourceAddress = "TVictimSource111111111111111111111111";
    const senderAddress = "TReceiverSubject111111111111111111111";
    const watchedWallet = "TWatchedWallet111111111111111111111";
    const contractAddress = "TSpenderContract1111111111111111111";
    const txHash = "incoming-contract-driven-tx";
    const amountRaw = "123000000";

    const result = projectForensicJobGraph(job({
      kind: "incoming_deposit_check",
      subjectAddress: senderAddress,
      progressJson: {
        watchedWallet,
        sender: senderAddress,
        depositTxHash: "deposit-tx",
        amountRaw,
        timestamp: "2026-06-23T13:17:45.000Z"
      },
      resultJson: {
        decision: "DECLINE",
        depositRiskScore: 95,
        contractDrivenSubjectAddress: senderAddress,
        contractDrivenReceiverProfile: {
          totalIncomingTxCount: 1,
          totalIncomingAmountRaw: amountRaw,
          contractDrivenIncomingTxCount: 1,
          contractDrivenIncomingAmountRaw: amountRaw,
          uniqueSourceCount: 1,
          dominantMethod: "Verify20",
          contractNames: ["VerifyAccount"],
          knownServiceIdentity: null,
          exactApprovalDrainCount: 1
        },
        contractDrivenTransferProfiles: [{
          txHash,
          timestamp: "2026-06-23T13:17:45.000Z",
          amountRaw,
          amount: "123",
          method: "Verify20",
          callerAddress: "TOperator1111111111111111111111111",
          operatorAddress: "TOperator1111111111111111111111111",
          contractAddress,
          spenderAddress: contractAddress,
          contractName: "VerifyAccount",
          sourceAddress,
          victimAddress: sourceAddress,
          receiverAddress: senderAddress
        }],
        originPaths: [{
          pathAddresses: [sourceAddress, senderAddress],
          txHashes: [txHash],
          steps: [{
            fromAddress: sourceAddress,
            toAddress: senderAddress,
            amountRaw,
            txHash,
            timestamp: "2026-06-23T13:17:45.000Z"
          }],
          score: 95,
          verdict: "DECLINE",
          evidenceIds: ["incoming-contract-evidence"]
        }]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    expect(result.graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fromNodeId: `addr:${sourceAddress}`,
        toNodeId: `addr:${contractAddress}`,
        txHash,
        amountRaw,
        metadata: expect.objectContaining({
          evidenceType: "contract_trigger_context",
          method: "Verify20"
        })
      }),
      expect.objectContaining({
        fromNodeId: `addr:${contractAddress}`,
        toNodeId: `addr:${senderAddress}`,
        amountRaw,
        metadata: expect.objectContaining({
          evidenceType: "contract_driven_transfer",
          aggregateTransferCount: 1,
          underlyingTransfers: expect.arrayContaining([
            expect.objectContaining({ txHash, amountRaw, fromAddress: sourceAddress, toAddress: senderAddress })
          ])
        })
      })
    ]));
    expect(result.graph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        fromNodeId: `addr:${sourceAddress}`,
        toNodeId: `addr:${senderAddress}`,
        metadata: expect.objectContaining({ source: "incomingDepositOriginPath" })
      })
    ]));
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

  it("keeps a single-funder incoming-deposit funding bundle as normal transfers", () => {
    const sender = "TSender1111111111111111111111111111111";
    const receiver = "TReceiver111111111111111111111111111111";
    const funder = "TFunderIncoming111111111111111111111111";

    const result = projectForensicJobGraph(job({
      kind: "incoming_deposit_check",
      subjectAddress: sender,
      progressJson: {
        watchedWallet: receiver,
        sender,
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
            pathAddresses: [funder, sender, receiver],
            txHashes: ["funding-tx", "deposit-tx"],
            steps: [
              {
                txHash: "funding-tx",
                fromAddress: funder,
                toAddress: sender,
                amountRaw: "850000000000",
                timestamp: "2026-06-01T09:46:39.000Z"
              },
              {
                txHash: "deposit-tx",
                fromAddress: sender,
                toAddress: receiver,
                amountRaw: "850000000000",
                timestamp: "2026-06-02T09:46:39.000Z"
              }
            ],
            fundingBundles: [
              {
                targetTxHash: "deposit-tx",
                targetFromAddress: sender,
                targetToAddress: receiver,
                targetAmountRaw: "850000000000",
                bundleAmountRaw: "850000000000",
                bundleCoverageRatio: 1,
                windowStart: "2026-06-01T09:46:39.000Z",
                windowEnd: "2026-06-02T09:46:39.000Z",
                fundingTxHashes: ["funding-tx"],
                fundingAddresses: [funder],
                fundingFunders: [
                  { address: funder, amountRaw: "850000000000", txHashes: ["funding-tx"] }
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

    expect(result.graph.nodes.find((node) => node.kind === "bundle")).toBeUndefined();
    expect(result.graph.edges.find((edge) => edge.metadata.bundleRole)).toBeUndefined();
    expect(result.graph.limitations.find((item) => item.code === "incoming_funding_bundle")).toBeUndefined();
    expect(result.graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fromNodeId: `addr:${funder}`,
        toNodeId: `addr:${sender}`,
        txHash: "funding-tx"
      }),
      expect.objectContaining({
        fromNodeId: `addr:${sender}`,
        toNodeId: `addr:${receiver}`,
        txHash: "deposit-tx"
      })
    ]));
  });

  it("hides incoming-deposit bundle-covered member-to-target duplicates", () => {
    const sender = "TSender1111111111111111111111111111111";
    const receiver = "TReceiver111111111111111111111111111111";
    const funder = "TFunderIncoming111111111111111111111111";
    const funderB = "TFunderIncoming222222222222222222222222";

    const result = projectForensicJobGraph(job({
      kind: "incoming_deposit_check",
      subjectAddress: sender,
      progressJson: {
        watchedWallet: receiver,
        sender,
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
            pathAddresses: [funder, sender, receiver],
            txHashes: ["funding-tx", "deposit-tx"],
            steps: [
              {
                txHash: "funding-tx",
                fromAddress: funder,
                toAddress: sender,
                amountRaw: "850000000000",
                timestamp: "2026-06-01T09:46:39.000Z"
              },
              {
                txHash: "deposit-tx",
                fromAddress: sender,
                toAddress: receiver,
                amountRaw: "850000000000",
                timestamp: "2026-06-02T09:46:39.000Z"
              }
            ],
            fundingBundles: [
              {
                targetTxHash: "deposit-tx",
                targetFromAddress: sender,
                targetToAddress: receiver,
                targetAmountRaw: "850000000000",
                bundleAmountRaw: "850000000000",
                bundleCoverageRatio: 1,
                windowStart: "2026-06-01T09:46:39.000Z",
                windowEnd: "2026-06-02T09:46:39.000Z",
                fundingTxHashes: ["funding-tx", "funding-tx-b"],
                fundingAddresses: [funder, funderB],
                fundingFunders: [
                  { address: funder, amountRaw: "850000000000", txHashes: ["funding-tx"] },
                  { address: funderB, amountRaw: "1000000", txHashes: ["funding-tx-b"] }
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
      targetFromAddress: sender
    });
    const bundleEdges = result.graph.edges.filter((edge) => edge.metadata.bundleNodeId === bundleNode?.id);
    expect(bundleEdges.map((edge) => edge.metadata.bundleRole).sort()).toEqual([
      "bundle_to_target",
      "top_funder",
      "top_funder"
    ]);
    expect(result.graph.edges.find((edge) =>
      edge.fromNodeId === `addr:${funder}` &&
      edge.toNodeId === `addr:${sender}` &&
      edge.txHash === "funding-tx"
    )).toBeUndefined();
    expect(result.graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fromNodeId: `addr:${sender}`,
        toNodeId: `addr:${receiver}`,
        txHash: "deposit-tx"
      })
    ]));
  });

  it("merges identical incoming-deposit origin transfer edges across paths", () => {
    const sender = "TSender1111111111111111111111111111111";
    const receiver = "TReceiver111111111111111111111111111111";
    const funderA = "TFunderA11111111111111111111111111111";
    const funderB = "TFunderB11111111111111111111111111111";
    const txHash = "shared-deposit-tx";

    const result = projectForensicJobGraph(job({
      kind: "incoming_deposit_check",
      subjectAddress: sender,
      progressJson: {
        watchedWallet: receiver,
        sender,
        depositTxHash: txHash,
        amountRaw: "40000000000",
        timestamp: "2026-06-30T08:25:27.000Z"
      },
      resultJson: {
        decision: "REVIEW",
        depositRiskScore: 45,
        originPaths: [
          {
            verdict: "REVIEW",
            score: 35,
            sourcePolicy: "unknown",
            pathAddresses: [funderA, sender, receiver],
            txHashes: ["funding-a", txHash],
            steps: [
              {
                txHash: "funding-a",
                fromAddress: funderA,
                toAddress: sender,
                amountRaw: "40000000000",
                timestamp: "2026-06-29T08:25:27.000Z"
              },
              {
                txHash,
                fromAddress: sender,
                toAddress: receiver,
                amountRaw: "40000000000",
                timestamp: "2026-06-30T08:25:27.000Z"
              }
            ],
            amountCoverageRatio: 0.5,
            amountContinuity: "strong",
            reasons: ["Path A"]
          },
          {
            verdict: "REVIEW",
            score: 30,
            sourcePolicy: "unknown",
            pathAddresses: [funderB, sender, receiver],
            txHashes: ["funding-b", txHash],
            steps: [
              {
                txHash: "funding-b",
                fromAddress: funderB,
                toAddress: sender,
                amountRaw: "40000000000",
                timestamp: "2026-06-29T09:25:27.000Z"
              },
              {
                txHash,
                fromAddress: sender,
                toAddress: receiver,
                amountRaw: "40000000000",
                timestamp: "2026-06-30T08:25:27.000Z"
              }
            ],
            amountCoverageRatio: 0.5,
            amountContinuity: "strong",
            reasons: ["Path B"]
          }
        ]
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const duplicateDepositEdges = result.graph.edges.filter((edge) =>
      edge.fromNodeId === `addr:${sender}` &&
      edge.toNodeId === `addr:${receiver}` &&
      edge.txHash === txHash &&
      edge.amountRaw === "40000000000"
    );
    expect(duplicateDepositEdges).toHaveLength(1);
    expect(result.graph.paths.map((path) => path.edgeIds.filter((edgeId) =>
      duplicateDepositEdges[0] && edgeId === duplicateDepositEdges[0].id
    ).length)).toEqual([1, 1]);
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

  it("projects exact approval-drain deep check as a contract-driven event cluster", () => {
    const receiver = "TPdrEz6N5pJoUbnnEcSz56e3wumV5mmGJE";
    const victim = "TNDx4wwNUvXSd9ykP9pv9S4aJdZwG9ip4u";
    const spenderContract = "TURRtRavZxXeoQF6tWbeNQ5gfzWEH7sEHh";
    const operator = "TQvjkKKHukfpa4tNsENAESZwrDExLbgPTL";
    const drainTxHash = "990193ce0a6cbb3651010ce89e06006185f6179a3a4b2df3ce58e310f22d6879";
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: receiver,
      resultJson: {
        subjectAddress: receiver,
        riskScore: 95,
        coverage: { transferEdges: 1 },
        coverageDebug: { missingChecks: [] },
        approvalDrainProvenanceProfiles: [{
          score: 95,
          subjectAddress: receiver,
          firstReceiverAddress: receiver,
          victimAddress: victim,
          spenderAddress: spenderContract,
          operatorAddress: operator,
          spenderResolution: "wrapper_contract",
          evidenceStrength: "exact_approval_and_transfer_from",
          approvalTxHash: "approval-tx",
          drainTxHash,
          hopDepth: 0,
          amountRaw: "10001000000",
          amountPreservationRatio: 1,
          approvalAt: "2026-06-23T13:00:00.000Z",
          drainAt: "2026-06-23T13:17:45.000Z",
          pathTxHashes: [drainTxHash],
          pathAddresses: [victim, receiver],
          subjectTokenState: null,
          victimTokenState: null,
          features: []
        }],
        walletRoleProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        serviceExposureProfiles: [],
        boundaryExposureProfiles: [],
        inboundProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.nodes.find((node) => node.address === victim)?.metadata.nodeIntelligence).toMatchObject({
      role: "victim",
      source: "approval_drain_provenance"
    });
    expect(result.graph.nodes.find((node) => node.address === spenderContract)).toMatchObject({
      kind: "contract"
    });
    expect(result.graph.nodes.find((node) => node.address === spenderContract)?.metadata.nodeIntelligence).toMatchObject({
      role: "drainer",
      source: "approval_drain_provenance"
    });
    expect(result.graph.nodes.find((node) => node.address === operator)?.metadata).toMatchObject({
      role: "operator"
    });
    expect(result.graph.nodes.find((node) => node.address === operator)?.metadata.nodeIntelligence).toBeUndefined();

    const transferEdge = result.graph.edges.find((edge) => edge.txHash === drainTxHash && edge.fromNodeId.endsWith(spenderContract));
    expect(transferEdge).toMatchObject({
      type: "transfer",
      amountRaw: "10001000000",
      metadata: {
        evidenceType: "approval_drain_transfer",
        spenderAddress: spenderContract,
        operatorAddress: operator,
        victimAddress: victim,
        underlyingTransfers: [expect.objectContaining({
          fromAddress: victim,
          toAddress: receiver
        })]
      }
    });

    const callEdge = result.graph.edges.find((edge) =>
      edge.txHash === drainTxHash &&
      edge.metadata.evidenceType === "approval_drain_contract_call"
    );
    expect(callEdge).toMatchObject({
      type: "approval",
      metadata: {
        method: "contract-driven token transfer",
        spenderResolution: "wrapper_contract"
      }
    });
  });

  it("projects repeated Verify20 contract-driven inflows as a drainer-like receiver campaign", () => {
    const subject = "TS3gaJPExMNr63p4pxfY9CZPbJPHjfPjgf";
    const operator = "TQvjkKKHukfpa4tNsENAESZwrDExLbgPTL";
    const contract = "TPiTYVC9NHggG3ttw7PxoYfQ5jYjqoqEki";
    const victim = "TB44QiUnyECTGfmqgZmN5jV7SzjnDexzHP";
    const txHash = "7850ccc3bb69e";
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      status: "completed",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        coverage: { transferEdges: 1 },
        coverageDebug: { missingChecks: [] },
        contractDrivenReceiverProfile: {
          totalIncomingTxCount: 175,
          totalIncomingAmountRaw: "968500000000",
          contractDrivenIncomingTxCount: 168,
          contractDrivenIncomingAmountRaw: "959200000000",
          uniqueSourceCount: 168,
          dominantMethod: "Verify20",
          contractNames: ["VerifyAccount"],
          knownServiceIdentity: null,
          exactApprovalDrainCount: 1
        },
        contractDrivenTransferProfiles: [{
          txHash,
          timestamp: "2026-06-28T00:01:00.000Z",
          amountRaw: "9370000000",
          amount: "9.37K USDT",
          method: "Verify20",
          showCallerContext: true,
          callerAddress: operator,
          operatorAddress: operator,
          contractAddress: contract,
          spenderAddress: contract,
          sourceAddress: victim,
          victimAddress: victim,
          receiverAddress: subject,
          sourcePostDebitActivity: {
            checked: true,
            debitAmountRaw: "9370000000",
            laterIncomingAmountRaw: "0",
            laterOutgoingAmountRaw: "0",
            laterTxCount: 0,
            repeatedContractDrivenDebitToSameReceiver: false
          }
        }],
        approvalDrainProvenanceProfiles: [],
        walletRoleProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        serviceExposureProfiles: [],
        boundaryExposureProfiles: [],
        inboundProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.nodes.find((node) => node.address === subject)?.metadata.nodeIntelligence).toMatchObject({
      role: "drainer",
      label: "Drainer",
      evidenceStrength: "hard"
    });
    expect(result.graph.nodes.find((node) => node.address === victim)?.metadata.nodeIntelligence).toMatchObject({
      role: "victim",
      label: "Victim"
    });
    expect(result.graph.nodes.find((node) => node.address === contract)?.metadata.nodeIntelligence).toMatchObject({
      label: "Drainer contract"
    });

    expect(result.graph.edges.some((edge) =>
      edge.fromNodeId === `addr:${victim}` &&
      edge.toNodeId === `addr:${subject}` &&
      edge.metadata.evidenceType === "contract_driven_transfer"
    )).toBe(false);

    const transferEdge = result.graph.edges.find((edge) =>
      edge.fromNodeId === `addr:${contract}` &&
      edge.toNodeId === `addr:${subject}` &&
      edge.metadata.evidenceType === "contract_driven_transfer"
    );
    expect(transferEdge).toMatchObject({
      type: "transfer",
      txHash,
      amountRaw: "9370000000",
      metadata: {
        evidenceType: "contract_driven_transfer",
        txHash,
        method: "Verify20",
        callerAddress: operator,
        contractAddress: contract,
        sourceAddress: victim,
        receiverAddress: subject,
        underlyingTransfers: [expect.objectContaining({
          txHash,
          amountRaw: "9370000000",
          timestamp: "2026-06-28T00:01:00.000Z",
          method: "Verify20",
          callerAddress: operator,
          contractAddress: contract,
          sourceAddress: victim,
          receiverAddress: subject
        })]
      }
    });

    const triggerEdge = result.graph.edges.find((edge) =>
      edge.fromNodeId === `addr:${victim}` &&
      edge.toNodeId === `addr:${contract}` &&
      edge.metadata.evidenceType === "contract_trigger_context"
    );
    expect(triggerEdge).toMatchObject({
      amountRaw: "9370000000",
      txHash,
      metadata: {
        evidenceType: "contract_trigger_context",
        relatedDebitTxHash: txHash,
        relatedDebitAmountRaw: "9370000000",
        underlyingTransfers: [expect.objectContaining({
          txHash,
          amountRaw: "9370000000",
          timestamp: "2026-06-28T00:01:00.000Z",
          method: "Verify20",
          sourceAddress: victim,
          contractAddress: contract,
          receiverAddress: subject
        })]
      }
    });

    const callEdge = result.graph.edges.find((edge) =>
      edge.fromNodeId === `addr:${operator}` &&
      edge.toNodeId === `addr:${contract}` &&
      edge.metadata.evidenceType === "contract_call_context"
    );
    expect(callEdge).toMatchObject({
      displayRole: "profile_context",
      metadata: {
        evidenceType: "contract_call_context",
        boundaryContextOnly: true,
        underlyingTransfers: []
      }
    });
  });

  it("projects contract-driven debits as source-to-contract trigger context", () => {
    const subject = "TCollectorContractDriven111111111111";
    const victim = "TVictimSourceWallet1111111111111111";
    const contract = "TVerifyAccountContract111111111111";
    const operator = "TOperatorCaller111111111111111111";
    const txHash = "b424fdec203c31c043933f64e3c5d3bf85c9bc70721fd84101b6a3cd39f250e7";

    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      status: "completed",
      subjectAddress: subject,
      resultJson: {
        contractDrivenReceiverProfile: {
          totalIncomingTxCount: 175,
          totalIncomingAmountRaw: "968500000000",
          contractDrivenIncomingTxCount: 168,
          contractDrivenIncomingAmountRaw: "959200000000",
          uniqueSourceCount: 168,
          dominantMethod: "Verify20",
          contractNames: ["VerifyAccount"],
          knownServiceIdentity: null,
          exactApprovalDrainCount: 1
        },
        contractDrivenTransferProfiles: [{
          txHash,
          timestamp: "2026-06-28T00:01:00.000Z",
          amountRaw: "9370000000",
          amount: "9.37K USDT",
          method: "Verify20",
          callerAddress: operator,
          operatorAddress: operator,
          contractAddress: contract,
          spenderAddress: contract,
          contractName: "VerifyAccount",
          sourceAddress: victim,
          victimAddress: victim,
          receiverAddress: subject
        }],
        approvalDrainProvenanceProfiles: [],
        walletRoleProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        serviceExposureProfiles: [],
        boundaryExposureProfiles: [],
        inboundProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    expect(result.graph.nodes.find((node) => node.address === victim)).toMatchObject({
      kind: "wallet",
      displayKind: "wallet"
    });
    expect(result.graph.nodes.find((node) => node.address === contract)).toMatchObject({
      kind: "contract",
      displayKind: "smart_contract"
    });

    const triggerEdge = result.graph.edges.find((edge) =>
      edge.fromNodeId === `addr:${victim}` &&
      edge.toNodeId === `addr:${contract}` &&
      edge.metadata.evidenceType === "contract_trigger_context"
    );

    expect(triggerEdge).toMatchObject({
      type: "transfer",
      amountRaw: "9370000000",
      txHash,
      metadata: {
        source: "contractDrivenTransferProfile",
        evidenceType: "contract_trigger_context",
        method: "Verify20",
        callerAddress: operator,
        contractAddress: contract,
        sourceAddress: victim,
        receiverAddress: subject,
        relatedDebitTxHash: txHash,
        underlyingTransfers: [expect.objectContaining({
          txHash,
          amountRaw: "9370000000",
          method: "Verify20",
          sourceAddress: victim,
          contractAddress: contract,
          receiverAddress: subject
        })]
      }
    });
    expect(result.graph.nodes.find((node) => node.address === operator)).toBeUndefined();
  });

  it("deduplicates exact duplicate contract-driven transfer profiles", () => {
    const subject = "TCollectorExactDedupe111111111111";
    const victim = "TVictimExactDedupe11111111111111";
    const contract = "TContractExactDedupe111111111111";
    const txHash = "exact-contract-profile-dupe-tx";
    const profile = {
      txHash,
      timestamp: "2026-06-28T00:01:00.000Z",
      amountRaw: "10000000000",
      method: "Verify20",
      callerAddress: "TCallerExactDedupe111111111111",
      contractAddress: contract,
      sourceAddress: victim,
      receiverAddress: subject
    };

    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      status: "completed",
      subjectAddress: subject,
      resultJson: {
        contractDrivenReceiverProfile: {
          totalIncomingTxCount: 2,
          totalIncomingAmountRaw: "20000000000",
          contractDrivenIncomingTxCount: 2,
          contractDrivenIncomingAmountRaw: "20000000000",
          uniqueSourceCount: 1,
          dominantMethod: "Verify20",
          contractNames: ["VerifyAccount"],
          knownServiceIdentity: null,
          exactApprovalDrainCount: 1
        },
        contractDrivenTransferProfiles: [profile, { ...profile }],
        approvalDrainProvenanceProfiles: [],
        walletRoleProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        serviceExposureProfiles: [],
        boundaryExposureProfiles: [],
        inboundProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    expect(result.graph.edges.filter((edge) =>
      edge.txHash === txHash &&
      edge.metadata.evidenceType === "contract_driven_transfer"
    )).toHaveLength(1);
  });

  it("does not draw collector-to-contract duplicates for incoming contract-driven debits", () => {
    const subject = "TCollectorNoDuplicate111111111111";
    const victim = "TVictimNoDuplicate111111111111111";
    const contract = "TContractNoDuplicate111111111111";

    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      status: "completed",
      subjectAddress: subject,
      resultJson: {
        contractDrivenReceiverProfile: {
          totalIncomingTxCount: 10,
          totalIncomingAmountRaw: "100000000000",
          contractDrivenIncomingTxCount: 9,
          contractDrivenIncomingAmountRaw: "90000000000",
          uniqueSourceCount: 9,
          dominantMethod: "Verify20",
          contractNames: ["VerifyAccount"],
          knownServiceIdentity: null,
          exactApprovalDrainCount: 1
        },
        contractDrivenTransferProfiles: [{
          txHash: "duplicate-guard-tx",
          timestamp: "2026-06-28T00:01:00.000Z",
          amountRaw: "10000000000",
          method: "Verify20",
          callerAddress: "TOperatorNoDuplicate111111111111",
          contractAddress: contract,
          sourceAddress: victim,
          receiverAddress: subject
        }],
        approvalDrainProvenanceProfiles: [],
        walletRoleProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        serviceExposureProfiles: [],
        boundaryExposureProfiles: [],
        inboundProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    expect(result.graph.edges.some((edge) =>
      edge.fromNodeId === `addr:${subject}` &&
      edge.toNodeId === `addr:${contract}` &&
      edge.metadata.source === "contractDrivenTransferProfile"
    )).toBe(false);
  });

  it("marks Verify20 debited sources as victims when receiver campaign is drainer-like", () => {
    const subject = "TDrainerLikeReceiver111111111111";
    const victim = "TVerify20VictimSource111111111111";
    const contract = "TVerify20Contract11111111111111";

    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      status: "completed",
      subjectAddress: subject,
      resultJson: {
        contractDrivenReceiverProfile: {
          totalIncomingTxCount: 112,
          totalIncomingAmountRaw: "437600000000",
          contractDrivenIncomingTxCount: 97,
          contractDrivenIncomingAmountRaw: "322100000000",
          uniqueSourceCount: 97,
          dominantMethod: "Verify20",
          contractNames: ["VerifyAccount"],
          knownServiceIdentity: null,
          exactApprovalDrainCount: 0
        },
        contractDrivenTransferProfiles: [{
          txHash: "verify20-victim-role-tx",
          timestamp: "2026-06-28T00:01:00.000Z",
          amountRaw: "816000000",
          method: "Verify20",
          callerAddress: "TCallerVerify201111111111111111",
          contractAddress: contract,
          sourceAddress: victim,
          receiverAddress: subject
        }],
        approvalDrainProvenanceProfiles: [],
        walletRoleProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        serviceExposureProfiles: [],
        boundaryExposureProfiles: [],
        inboundProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    expect(result.graph.nodes.find((node) => node.address === victim)?.metadata.nodeIntelligence).toMatchObject({
      role: "victim",
      label: "Victim",
      source: "contract_driven_evidence"
    });
  });

  it("does not mark same-address Verify20 receiver profiles as source victims", () => {
    const subject = "TSelfTransferReceiver11111111111111";
    const contract = "TSelfTransferContract111111111111";

    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      status: "completed",
      subjectAddress: subject,
      resultJson: {
        contractDrivenReceiverProfile: {
          totalIncomingTxCount: 112,
          totalIncomingAmountRaw: "437600000000",
          contractDrivenIncomingTxCount: 97,
          contractDrivenIncomingAmountRaw: "322100000000",
          uniqueSourceCount: 97,
          dominantMethod: "Verify20",
          contractNames: ["VerifyAccount"],
          knownServiceIdentity: null,
          exactApprovalDrainCount: 0
        },
        contractDrivenTransferProfiles: [{
          txHash: "verify20-self-transfer-tx",
          timestamp: "2026-06-28T00:01:00.000Z",
          amountRaw: "816000000",
          method: "Verify20",
          callerAddress: "TCallerSelfTransfer111111111111",
          contractAddress: contract,
          sourceAddress: subject,
          receiverAddress: subject,
          sourcePostDebitActivity: {
            checked: true,
            debitAmountRaw: "816000000",
            laterIncomingAmountRaw: "0",
            laterOutgoingAmountRaw: "0",
            laterTxCount: 0,
            repeatedContractDrivenDebitToSameReceiver: false
          }
        }],
        approvalDrainProvenanceProfiles: [],
        walletRoleProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        serviceExposureProfiles: [],
        boundaryExposureProfiles: [],
        inboundProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    expect(result.graph.nodes.find((node) => node.address === subject)?.metadata.nodeIntelligence).toMatchObject({
      role: "drainer",
      label: "Drainer",
      source: "contract_driven_evidence"
    });
  });

  it("deduplicates repeated contract-driven profiles by spender contract address", () => {
    const subject = "TCollectorContractDedupe111111111";
    const contract = "TSharedVerifyContract111111111111";

    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      status: "completed",
      subjectAddress: subject,
      resultJson: {
        contractDrivenReceiverProfile: {
          totalIncomingTxCount: 3,
          totalIncomingAmountRaw: "3000000000",
          contractDrivenIncomingTxCount: 2,
          contractDrivenIncomingAmountRaw: "2000000000",
          uniqueSourceCount: 2,
          dominantMethod: "Verify20",
          contractNames: ["VerifyAccount"],
          knownServiceIdentity: null,
          exactApprovalDrainCount: 1
        },
        contractDrivenTransferProfiles: [
          {
            txHash: "contract-dedupe-a",
            timestamp: "2026-06-28T00:01:00.000Z",
            amountRaw: "1000000000",
            method: "Verify20",
            callerAddress: "TCallerDedupeA111111111111111",
            contractAddress: contract,
            sourceAddress: "TVictimDedupeA111111111111111",
            receiverAddress: subject
          },
          {
            txHash: "contract-dedupe-b",
            timestamp: "2026-06-28T00:02:00.000Z",
            amountRaw: "1000000000",
            method: "Verify20",
            callerAddress: "TCallerDedupeB111111111111111",
            contractAddress: contract,
            sourceAddress: "TVictimDedupeB111111111111111",
            receiverAddress: subject
          }
        ],
        approvalDrainProvenanceProfiles: [],
        walletRoleProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        serviceExposureProfiles: [],
        boundaryExposureProfiles: [],
        inboundProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    expect(result.graph.nodes.filter((node) => node.address === contract)).toHaveLength(1);
    const transferEdges = result.graph.edges.filter((edge) =>
      edge.fromNodeId === `addr:${contract}` &&
      edge.toNodeId === `addr:${subject}` &&
      edge.metadata.evidenceType === "contract_driven_transfer"
    );
    expect(transferEdges).toHaveLength(1);
    expect(transferEdges[0].amountRaw).toBe("2000000000");
    expect(transferEdges[0].metadata.aggregateTransferCount).toBe(2);
    expect(transferEdges[0].metadata.underlyingTransfers).toHaveLength(2);
    expect(result.graph.edges.filter((edge) =>
      edge.toNodeId === `addr:${contract}` &&
      edge.metadata.evidenceType === "contract_trigger_context"
    )).toHaveLength(2);
  });

  it("keeps distinct source wallets routed through the shared spender contract", () => {
    const subject = "TCollectorBreadth1111111111111111";
    const contract = "TSharedBreadthContract1111111111";
    const sources = [
      "TVictimBreadthA11111111111111111",
      "TVictimBreadthB11111111111111111",
      "TVictimBreadthC11111111111111111"
    ];

    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      status: "completed",
      subjectAddress: subject,
      resultJson: {
        contractDrivenReceiverProfile: {
          totalIncomingTxCount: 3,
          totalIncomingAmountRaw: "3000000000",
          contractDrivenIncomingTxCount: 3,
          contractDrivenIncomingAmountRaw: "3000000000",
          uniqueSourceCount: 3,
          dominantMethod: "Verify20",
          contractNames: ["VerifyAccount"],
          knownServiceIdentity: null,
          exactApprovalDrainCount: 1
        },
        contractDrivenTransferProfiles: sources.map((sourceAddress, index) => ({
          txHash: `breadth-contract-tx-${index}`,
          timestamp: `2026-06-28T00:0${index + 1}:00.000Z`,
          amountRaw: "1000000000",
          method: "Verify20",
          callerAddress: `TCallerBreadth${index}111111111111111`,
          contractAddress: contract,
          sourceAddress,
          receiverAddress: subject
        })),
        approvalDrainProvenanceProfiles: [],
        walletRoleProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        serviceExposureProfiles: [],
        boundaryExposureProfiles: [],
        inboundProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    expect(result.graph.edges.filter((edge) =>
      edge.toNodeId === `addr:${contract}` &&
      edge.metadata.evidenceType === "contract_trigger_context"
    )).toHaveLength(3);
    expect(result.graph.edges.filter((edge) =>
      edge.toNodeId === `addr:${contract}` &&
      edge.metadata.evidenceType === "contract_trigger_context"
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fromNodeId: `addr:${sources[0]}`,
        amountRaw: "1000000000",
        txHash: "breadth-contract-tx-0",
        timestamp: "2026-06-28T00:01:00.000Z"
      })
    ]));
    const transferEdges = result.graph.edges.filter((edge) =>
      edge.fromNodeId === `addr:${contract}` &&
      edge.toNodeId === `addr:${subject}` &&
      edge.metadata.evidenceType === "contract_driven_transfer"
    );
    expect(transferEdges).toHaveLength(1);
    expect(transferEdges[0].amountRaw).toBe("3000000000");
    expect(transferEdges[0].metadata.aggregateTransferCount).toBe(3);
    expect(transferEdges[0].metadata.underlyingTransfers).toHaveLength(3);
  });

  it("preserves same-tx contract-driven transfers from different source wallets", () => {
    const subject = "TCollectorSameTxSources111111111";
    const contract = "TSharedSameTxContract11111111111";
    const txHash = "same-tx-shared-contract-drain";
    const amountRaw = "1000000000";
    const sources = [
      "TVictimSameTxSourceA111111111111",
      "TVictimSameTxSourceB111111111111"
    ];

    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      status: "completed",
      subjectAddress: subject,
      resultJson: {
        contractDrivenReceiverProfile: {
          totalIncomingTxCount: 2,
          totalIncomingAmountRaw: "2000000000",
          contractDrivenIncomingTxCount: 2,
          contractDrivenIncomingAmountRaw: "2000000000",
          uniqueSourceCount: 2,
          dominantMethod: "Verify20",
          contractNames: ["VerifyAccount"],
          knownServiceIdentity: null,
          exactApprovalDrainCount: 1
        },
        contractDrivenTransferProfiles: sources.map((sourceAddress) => ({
          txHash,
          timestamp: "2026-06-28T00:01:00.000Z",
          amountRaw,
          method: "Verify20",
          callerAddress: "TCallerSameTxSources11111111111",
          contractAddress: contract,
          sourceAddress,
          receiverAddress: subject
        })),
        approvalDrainProvenanceProfiles: [],
        walletRoleProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        serviceExposureProfiles: [],
        boundaryExposureProfiles: [],
        inboundProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const transferEdges = result.graph.edges.filter((edge) =>
      edge.fromNodeId === `addr:${contract}` &&
      edge.toNodeId === `addr:${subject}` &&
      edge.metadata.evidenceType === "contract_driven_transfer"
    );
    expect(transferEdges).toHaveLength(1);
    expect(transferEdges[0].metadata.aggregateTransferCount).toBe(2);
    const underlyingTransfers = transferEdges[0].metadata.underlyingTransfers;
    expect(Array.isArray(underlyingTransfers)).toBe(true);
    expect(
      (Array.isArray(underlyingTransfers) ? underlyingTransfers : [])
        .map((transfer) => typeof transfer === "object" && transfer !== null ? transfer.sourceAddress : null)
        .sort()
    ).toEqual([...sources].sort());

    expect(result.graph.edges.filter((edge) =>
      edge.toNodeId === `addr:${contract}` &&
      edge.metadata.evidenceType === "contract_trigger_context"
    )).toHaveLength(2);
  });

  it("does not downgrade hard contract-driven receiver intelligence with wallet role context", () => {
    const subject = "THardContractReceiver111111111111111";
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      status: "completed",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        coverage: { transferEdges: 1 },
        coverageDebug: { missingChecks: [] },
        contractDrivenReceiverProfile: {
          totalIncomingTxCount: 25,
          totalIncomingAmountRaw: "100000000000",
          contractDrivenIncomingTxCount: 25,
          contractDrivenIncomingAmountRaw: "100000000000",
          uniqueSourceCount: 10,
          dominantMethod: "Verify20",
          contractNames: ["VerifyAccount"],
          knownServiceIdentity: null,
          exactApprovalDrainCount: 1
        },
        walletRoleProfiles: [{
          subjectAddress: subject,
          primaryRole: "collector",
          evidenceStrength: "context",
          roles: [{
            role: "collector",
            score: 40,
            reasons: [{ code: "address_behavior_collector_like_wallet", label: "Collector-like wallet context." }]
          }],
          features: [{ code: "address_behavior_collector_like_wallet", label: "Collector-like wallet context." }]
        }],
        contractDrivenTransferProfiles: [],
        approvalDrainProvenanceProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        serviceExposureProfiles: [],
        boundaryExposureProfiles: [],
        inboundProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.nodes.find((node) => node.address === subject)?.metadata.nodeIntelligence).toMatchObject({
      role: "drainer",
      label: "Drainer",
      evidenceStrength: "hard",
      source: "contract_driven_evidence"
    });
  });

  it("suppresses direct wallet transfer projection for the same contract-driven transfer", () => {
    const subject = "TContractDirectSubject111111111111111";
    const operator = "TContractDirectOperator11111111111111";
    const contract = "TContractDirectContract11111111111111";
    const source = "TContractDirectSource1111111111111111";
    const txHash = "same-direct-contract-tx";
    const amountRaw = "9370000000";
    const timestamp = "2026-06-28T00:01:00.000Z";
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      status: "completed",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        coverage: { transferEdges: 2 },
        coverageDebug: { missingChecks: [] },
        contractDrivenReceiverProfile: {
          totalIncomingTxCount: 1,
          totalIncomingAmountRaw: amountRaw,
          contractDrivenIncomingTxCount: 1,
          contractDrivenIncomingAmountRaw: amountRaw,
          uniqueSourceCount: 1,
          dominantMethod: "Verify20",
          contractNames: ["VerifyAccount"],
          knownServiceIdentity: null,
          exactApprovalDrainCount: 0
        },
        contractDrivenTransferProfiles: [{
          txHash,
          timestamp,
          amountRaw,
          method: "Verify20",
          callerAddress: operator,
          contractAddress: contract,
          sourceAddress: source,
          receiverAddress: subject
        }],
        approvalDrainProvenanceProfiles: [],
        walletRoleProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [{
          counterpartyAddress: source,
          direction: "inbound",
          volumeRaw: amountRaw,
          volumeRatio: 1,
          txCount: 1,
          firstSeen: timestamp,
          lastSeen: timestamp,
          txHashes: [txHash],
          evidenceClass: "counterparty_behavior_context",
          scoreContribution: 0,
          transfers: [{
            txHash,
            fromAddress: source,
            toAddress: subject,
            amountRaw,
            timestamp,
            method: "transfer",
            edgeType: "normal_transfer"
          }]
        }],
        serviceExposureProfiles: [],
        boundaryExposureProfiles: [],
        inboundProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const sourceToSubjectEdges = result.graph.edges.filter((edge) =>
      edge.txHash === txHash &&
      edge.fromNodeId === `addr:${source}` &&
      edge.toNodeId === `addr:${subject}` &&
      edge.amountRaw === amountRaw
    );
    expect(sourceToSubjectEdges).toHaveLength(0);
    expect(result.graph.edges.find((edge) =>
      edge.txHash === txHash &&
      edge.fromNodeId === `addr:${contract}` &&
      edge.toNodeId === `addr:${subject}` &&
      edge.amountRaw === amountRaw &&
      edge.metadata.evidenceType === "contract_driven_transfer"
    )).toBeDefined();
  });

  it("suppresses counterparty and boundary direct edges when contract-driven route explains them", () => {
    const subject = "TSubjectContractRoute1111111111111";
    const contract = "TContractRoute11111111111111111111";
    const source = "TGasFreeContractRoute111111111111";
    const txHash = "6a17195101fee0790aedc7b5889a5b54e00051e1cde385afaaab82fa6d3abd9b";
    const amountRaw = "50000000000";
    const timestamp = "2026-06-18T15:26:00.000Z";

    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      status: "completed",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        coverage: { transferEdges: 3 },
        coverageDebug: { missingChecks: [] },
        contractDrivenReceiverProfile: {
          totalIncomingTxCount: 1,
          totalIncomingAmountRaw: amountRaw,
          contractDrivenIncomingTxCount: 1,
          contractDrivenIncomingAmountRaw: amountRaw,
          uniqueSourceCount: 1,
          dominantMethod: "transfer",
          contractNames: ["Contract"],
          knownServiceIdentity: "GasFree Account",
          exactApprovalDrainCount: 0
        },
        contractDrivenTransferProfiles: [{
          txHash,
          timestamp,
          amountRaw,
          method: "transfer(address,uint256)",
          contractAddress: contract,
          contractName: "Contract",
          sourceAddress: source,
          receiverAddress: subject
        }],
        counterpartyRiskProfiles: [{
          counterpartyAddress: source,
          direction: "inbound",
          amountRaw,
          label: "GasFree Account",
          score: 0
        }],
        boundaryExposureProfiles: [{
          score: 0,
          flows: [{
            boundaryAddress: source,
            boundaryCategory: "service",
            boundaryIdentity: "GasFree Account",
            direction: "inbound",
            amountRaw,
            boundaryAmountRaw: amountRaw,
            subjectTxHash: txHash,
            firstTransferAt: timestamp,
            lastTransferAt: timestamp,
            depth: 1
          }]
        }],
        approvalDrainProvenanceProfiles: [],
        walletRoleProfiles: [],
        directCounterpartyInteractionProfiles: [],
        serviceExposureProfiles: [],
        inboundProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    expect(result.graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        txHash,
        fromNodeId: `addr:${source}`,
        toNodeId: `addr:${contract}`,
        amountRaw,
        metadata: expect.objectContaining({ evidenceType: "contract_trigger_context" })
      }),
      expect.objectContaining({
        txHash,
        fromNodeId: `addr:${contract}`,
        toNodeId: `addr:${subject}`,
        amountRaw,
        metadata: expect.objectContaining({ evidenceType: "contract_driven_transfer" })
      })
    ]));
    expect(result.graph.edges.filter((edge) =>
      edge.fromNodeId === `addr:${source}` &&
      edge.toNodeId === `addr:${subject}` &&
      edge.amountRaw === amountRaw
    )).toHaveLength(0);
  });

  it("suppresses aggregate counterparty edge when contract-driven transfers cover the same pair total", () => {
    const subject = "TAggregateContractRouteSubject111111";
    const contract = "TAggregateContractRouteContract11111";
    const source = "TAggregateGasFreeRouteSource1111111";
    const timestamp = "2026-06-23T14:03:33.000Z";
    const totalAmountRaw = "214642000000";

    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      status: "completed",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        coverage: { transferEdges: 4 },
        coverageDebug: { missingChecks: [] },
        contractDrivenReceiverProfile: {
          totalIncomingTxCount: 3,
          totalIncomingAmountRaw: totalAmountRaw,
          contractDrivenIncomingTxCount: 3,
          contractDrivenIncomingAmountRaw: totalAmountRaw,
          uniqueSourceCount: 1,
          dominantMethod: "permitTransfer",
          contractNames: ["GasFreeContract"],
          knownServiceIdentity: "GasFree Account",
          exactApprovalDrainCount: 0
        },
        contractDrivenTransferProfiles: [
          {
            txHash: "aggregate-contract-driven-1",
            timestamp,
            amountRaw: "213900000000",
            method: "permitTransfer",
            contractAddress: contract,
            contractName: "GasFreeContract",
            sourceAddress: source,
            receiverAddress: subject
          },
          {
            txHash: "aggregate-contract-driven-2",
            timestamp: "2026-06-23T14:06:57.000Z",
            amountRaw: "642000000",
            method: "permitTransfer",
            contractAddress: contract,
            contractName: "GasFreeContract",
            sourceAddress: source,
            receiverAddress: subject
          },
          {
            txHash: "aggregate-contract-driven-3",
            timestamp: "2026-06-23T13:32:51.000Z",
            amountRaw: "100000000",
            method: "permitTransfer",
            contractAddress: contract,
            contractName: "GasFreeContract",
            sourceAddress: source,
            receiverAddress: subject
          }
        ],
        counterpartyRiskProfiles: [{
          counterpartyAddress: source,
          direction: "inbound",
          amountRaw: totalAmountRaw,
          label: "GasFree Account",
          score: 0
        }],
        approvalDrainProvenanceProfiles: [],
        walletRoleProfiles: [],
        directCounterpartyInteractionProfiles: [],
        serviceExposureProfiles: [],
        boundaryExposureProfiles: [],
        inboundProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    expect(result.graph.edges.filter((edge) =>
      edge.fromNodeId === `addr:${source}` &&
      edge.toNodeId === `addr:${subject}` &&
      edge.amountRaw === totalAmountRaw
    )).toHaveLength(0);
    expect(result.graph.edges.filter((edge) =>
      edge.fromNodeId === `addr:${source}` &&
      edge.toNodeId === `addr:${contract}` &&
      edge.metadata.evidenceType === "contract_trigger_context"
    )).toHaveLength(3);
  });

  it("does not project legacy plain USDT transfer profiles as contract-driven edges", () => {
    const subject = "TPlainUsdtSubject11111111111111111";
    const source = "TPlainUsdtSource111111111111111111";
    const txHash = "plain-usdt-transfer-with-named-params";
    const amountRaw = "107934590000";
    const timestamp = "2026-06-25T09:50:45.000Z";

    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      status: "completed",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        contractDrivenReceiverProfile: {
          totalIncomingTxCount: 1,
          totalIncomingAmountRaw: amountRaw,
          contractDrivenIncomingTxCount: 1,
          contractDrivenIncomingAmountRaw: amountRaw,
          uniqueSourceCount: 1,
          dominantMethod: "transfer(address _to,uint256 _value)",
          contractNames: [],
          knownServiceIdentity: null,
          exactApprovalDrainCount: 0
        },
        contractDrivenTransferProfiles: [{
          txHash,
          timestamp,
          amountRaw,
          method: "transfer(address _to,uint256 _value)",
          callerAddress: source,
          sourceAddress: source,
          receiverAddress: subject,
          contractAddress: TRON_USDT_CONTRACT_ADDRESS,
          spenderAddress: TRON_USDT_CONTRACT_ADDRESS
        }],
        directCounterpartyInteractionProfiles: [{
          counterpartyAddress: source,
          direction: "inbound",
          volumeRaw: amountRaw,
          volumeRatio: 1,
          txCount: 1,
          firstSeen: timestamp,
          lastSeen: timestamp,
          txHashes: [txHash],
          evidenceClass: "counterparty_behavior_context",
          scoreContribution: 0,
          transfers: [{
            txHash,
            fromAddress: source,
            toAddress: subject,
            amountRaw,
            timestamp,
            method: "transfer(address _to,uint256 _value)",
            edgeType: "normal_transfer"
          }]
        }],
        approvalDrainProvenanceProfiles: [],
        walletRoleProfiles: [],
        counterpartyRiskProfiles: [],
        serviceExposureProfiles: [],
        boundaryExposureProfiles: [],
        inboundProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    expect(result.graph.edges.filter((edge) =>
      edge.metadata.evidenceType === "contract_driven_transfer" ||
      edge.metadata.evidenceType === "contract_trigger_context"
    )).toHaveLength(0);
    expect(result.graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        txHash,
        fromNodeId: `addr:${source}`,
        toNodeId: `addr:${subject}`,
        amountRaw,
        metadata: expect.objectContaining({ evidenceType: "direct_counterparty_transfer" })
      })
    ]));
  });

  it("does not draw contract-driven transfers as direct wallet flow when spender contract address is unavailable", () => {
    const subject = "TContractMissingSubject111111111111";
    const source = "TContractMissingSource1111111111111";
    const txHash = "contract-missing-spender-tx";
    const amountRaw = "9370000000";
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      status: "completed",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        contractDrivenReceiverProfile: {
          totalIncomingTxCount: 1,
          totalIncomingAmountRaw: amountRaw,
          contractDrivenIncomingTxCount: 1,
          contractDrivenIncomingAmountRaw: amountRaw,
          uniqueSourceCount: 1,
          dominantMethod: "Verify20",
          contractNames: [],
          knownServiceIdentity: null,
          exactApprovalDrainCount: 0
        },
        contractDrivenTransferProfiles: [{
          txHash,
          timestamp: "2026-06-28T00:01:00.000Z",
          amountRaw,
          method: "Verify20",
          sourceAddress: source,
          receiverAddress: subject
        }],
        approvalDrainProvenanceProfiles: [],
        walletRoleProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        serviceExposureProfiles: [],
        boundaryExposureProfiles: [],
        inboundProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    expect(result.graph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        txHash,
        fromNodeId: `addr:${source}`,
        toNodeId: `addr:${subject}`,
      })
    ]));
    expect(result.graph.edges.find((edge) => edge.metadata.evidenceType === "contract_driven_transfer")).toBeUndefined();
  });

  it("projects generic smart-contract methods through spender contract without direct wallet duplicate", () => {
    const subject = "TGenericSmartSubject111111111111";
    const source = "TGenericSmartSource1111111111111";
    const contract = "TGenericSmartContract111111111111";
    const txHash = "generic-smart-contract-tx";
    const amountRaw = "4200000000";
    const timestamp = "2026-06-29T10:00:00.000Z";

    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      status: "completed",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        contractDrivenReceiverProfile: {
          totalIncomingTxCount: 1,
          totalIncomingAmountRaw: amountRaw,
          contractDrivenIncomingTxCount: 1,
          contractDrivenIncomingAmountRaw: amountRaw,
          uniqueSourceCount: 1,
          dominantMethod: "withdraw",
          contractNames: ["GenericSmartContract"],
          knownServiceIdentity: null,
          exactApprovalDrainCount: 0
        },
        contractDrivenTransferProfiles: [{
          txHash,
          timestamp,
          amountRaw,
          method: "withdraw",
          contractAddress: contract,
          sourceAddress: source,
          receiverAddress: subject
        }],
        directCounterpartyInteractionProfiles: [{
          counterpartyAddress: source,
          direction: "inbound",
          volumeRaw: amountRaw,
          volumeRatio: 1,
          txCount: 1,
          firstSeen: timestamp,
          lastSeen: timestamp,
          txHashes: [txHash],
          evidenceClass: "counterparty_behavior_context",
          scoreContribution: 0,
          transfers: [{
            txHash,
            fromAddress: source,
            toAddress: subject,
            amountRaw,
            timestamp,
            method: "withdraw",
            edgeType: "normal_transfer"
          }]
        }],
        approvalDrainProvenanceProfiles: [],
        walletRoleProfiles: [],
        counterpartyRiskProfiles: [],
        serviceExposureProfiles: [],
        boundaryExposureProfiles: [],
        inboundProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    expect(result.graph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        txHash,
        fromNodeId: `addr:${source}`,
        toNodeId: `addr:${subject}`
      })
    ]));
    expect(result.graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        txHash,
        fromNodeId: `addr:${source}`,
        toNodeId: `addr:${contract}`,
        amountRaw,
        metadata: expect.objectContaining({ evidenceType: "contract_trigger_context" })
      }),
      expect.objectContaining({
        txHash,
        fromNodeId: `addr:${contract}`,
        toNodeId: `addr:${subject}`,
        amountRaw,
        metadata: expect.objectContaining({ evidenceType: "contract_driven_transfer" })
      })
    ]));
  });

  it("keeps known-service permitTransfer receivers as service context when transfer profiles are present", () => {
    const subject = "TServicePermitReceiver111111111111111";
    const operator = "TServicePermitOperator111111111111111";
    const contract = "TServicePermitContract111111111111111";
    const source = "TServicePermitSource11111111111111111";
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      status: "completed",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        coverage: { transferEdges: 1 },
        coverageDebug: { missingChecks: [] },
        contractDrivenReceiverProfile: {
          totalIncomingTxCount: 5,
          totalIncomingAmountRaw: "12000000000",
          contractDrivenIncomingTxCount: 1,
          contractDrivenIncomingAmountRaw: "1000000000",
          uniqueSourceCount: 1,
          dominantMethod: "permitTransfer",
          contractNames: ["KnownRouter"],
          knownServiceIdentity: "Known Service",
          exactApprovalDrainCount: 0
        },
        contractDrivenTransferProfiles: [{
          txHash: "permit-service-tx",
          timestamp: "2026-06-28T00:02:00.000Z",
          amountRaw: "1000000000",
          method: "permitTransfer",
          callerAddress: operator,
          contractAddress: contract,
          sourceAddress: source,
          receiverAddress: subject
        }],
        approvalDrainProvenanceProfiles: [],
        walletRoleProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        serviceExposureProfiles: [],
        boundaryExposureProfiles: [],
        inboundProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const subjectNode = result.graph.nodes.find((node) => node.address === subject);
    expect(subjectNode?.metadata.role).toBe("service_context");
    expect(subjectNode?.metadata.nodeIntelligence).toBeUndefined();
  });

  it("does not mark a single Verify20 method-only receiver as a drainer", () => {
    const subject = "TSingleVerify20Receiver111111111111111";
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      status: "completed",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        coverage: { transferEdges: 1 },
        coverageDebug: { missingChecks: [] },
        contractDrivenReceiverProfile: {
          totalIncomingTxCount: 5,
          totalIncomingAmountRaw: "12000000000",
          contractDrivenIncomingTxCount: 1,
          contractDrivenIncomingAmountRaw: "1000000000",
          uniqueSourceCount: 1,
          dominantMethod: "Verify20",
          contractNames: ["VerifyAccount"],
          exactApprovalDrainCount: 0
        },
        contractDrivenTransferProfiles: [],
        approvalDrainProvenanceProfiles: [],
        walletRoleProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        serviceExposureProfiles: [],
        boundaryExposureProfiles: [],
        inboundProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const intelligence = result.graph.nodes.find((node) => node.address === subject)?.metadata.nodeIntelligence as
      | { role?: unknown }
      | undefined;
    expect(intelligence?.role).not.toBe("drainer");
  });

  it("keeps drainer-like Verify20 receiver mark over generic collector context", () => {
    const subject = "TVerify20DrainerLikeReceiver111111111";
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      status: "completed",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        coverage: { transferEdges: 1 },
        coverageDebug: { missingChecks: [] },
        contractDrivenReceiverProfile: {
          totalIncomingTxCount: 75,
          totalIncomingAmountRaw: "365260340000",
          contractDrivenIncomingTxCount: 46,
          contractDrivenIncomingAmountRaw: "71316000000",
          uniqueSourceCount: 45,
          dominantMethod: "Verify20",
          contractNames: ["VerifyAccount"],
          knownServiceIdentity: null,
          exactApprovalDrainCount: 0
        },
        walletRoleProfiles: [{
          subjectAddress: subject,
          primaryRole: "collector",
          evidenceStrength: "strong_behavior",
          roles: [{
            role: "collector",
            score: 55,
            reasons: [{ code: "address_behavior_collector_like_wallet", label: "Collector-like wallet context." }]
          }],
          features: [{ code: "address_behavior_collector_like_wallet", label: "Collector-like wallet context." }]
        }],
        contractDrivenTransferProfiles: [],
        approvalDrainProvenanceProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        serviceExposureProfiles: [],
        boundaryExposureProfiles: [],
        inboundProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.nodes.find((node) => node.address === subject)?.metadata.nodeIntelligence).toMatchObject({
      role: "drainer",
      label: "Drainer",
      evidenceStrength: "behavior",
      source: "contract_driven_evidence"
    });
  });

  it("projects route-linked approval-drain provenance without marking the linked subject as exact drainer", () => {
    const subject = "TRouteLinkedSubject11111111111111111";
    const receiver = "TRouteLinkedReceiver111111111111111";
    const victim = "TRouteLinkedVictim111111111111111111";
    const spenderContract = "TRouteLinkedSpender1111111111111111";
    const operator = "TRouteLinkedOperator111111111111111";
    const drainTxHash = "route-linked-drain-tx";
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: subject,
      resultJson: {
        subjectAddress: subject,
        riskScore: 95,
        coverage: { transferEdges: 1 },
        coverageDebug: { missingChecks: [] },
        approvalDrainProvenanceProfiles: [{
          score: 95,
          subjectAddress: subject,
          firstReceiverAddress: receiver,
          victimAddress: victim,
          spenderAddress: spenderContract,
          operatorAddress: operator,
          spenderResolution: "wrapper_contract",
          evidenceStrength: "route_linked",
          approvalTxHash: "approval-tx",
          drainTxHash,
          hopDepth: 1,
          amountRaw: "10001000000",
          amountPreservationRatio: 1,
          approvalAt: "2026-06-23T13:00:00.000Z",
          drainAt: "2026-06-23T13:17:45.000Z",
          pathTxHashes: [drainTxHash],
          pathAddresses: [victim, receiver, subject],
          subjectTokenState: null,
          victimTokenState: null,
          features: [{
            code: "approval_drain_exact_transfer_from",
            label: "Exact transferFrom drain was observed upstream."
          }]
        }],
        walletRoleProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        serviceExposureProfiles: [],
        boundaryExposureProfiles: [],
        inboundProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.graph.nodes.find((node) => node.address === victim)?.metadata.nodeIntelligence).toMatchObject({
      role: "victim",
      source: "approval_drain_provenance"
    });
    expect(result.graph.nodes.find((node) => node.address === receiver)?.metadata.nodeIntelligence).toMatchObject({
      role: "drainer",
      source: "approval_drain_provenance"
    });
    expect(result.graph.nodes.find((node) => node.address === spenderContract)).toMatchObject({
      kind: "contract"
    });
    expect(result.graph.nodes.find((node) => node.address === spenderContract)?.metadata.nodeIntelligence).toMatchObject({
      role: "drainer",
      source: "approval_drain_provenance"
    });
    expect(result.graph.nodes.find((node) => node.address === subject)?.metadata.nodeIntelligence).toBeUndefined();

    expect(result.graph.edges.find((edge) =>
      edge.txHash === drainTxHash &&
      edge.metadata.evidenceType === "approval_drain_transfer"
    )).toMatchObject({
      fromNodeId: `addr:${spenderContract}`,
      toNodeId: `addr:${receiver}`,
      metadata: {
        evidenceKind: "route_linked_exact_root",
        spenderAddress: spenderContract,
        operatorAddress: operator,
        underlyingTransfers: [expect.objectContaining({
          fromAddress: victim,
          toAddress: receiver
        })]
      }
    });
    expect(result.graph.edges.find((edge) =>
      edge.txHash === drainTxHash &&
      edge.metadata.evidenceType === "approval_drain_contract_call"
    )).toMatchObject({
      fromNodeId: `addr:${operator}`,
      toNodeId: `addr:${spenderContract}`,
      metadata: {
        evidenceKind: "route_linked_exact_root"
      }
    });
  });

  it("summarizes repeated exact approval-drain profiles as drainer campaign metadata", () => {
    const receiver = "TCampaignReceiver111111111111111111";
    const spenderContract = "TCampaignSpender111111111111111111";
    const operator = "TCampaignOperator11111111111111111";
    const profile = (index: number, victimAddress: string, amountRaw: string, drainAt: string) => ({
      score: 95,
      subjectAddress: receiver,
      firstReceiverAddress: receiver,
      victimAddress,
      spenderAddress: spenderContract,
      operatorAddress: operator,
      spenderResolution: "wrapper_contract",
      evidenceStrength: "exact_approval_and_transfer_from",
      approvalTxHash: `approval-tx-${index}`,
      drainTxHash: `drain-tx-${index}`,
      hopDepth: 0,
      amountRaw,
      amountPreservationRatio: 1,
      approvalAt: "2026-06-23T13:00:00.000Z",
      drainAt,
      pathTxHashes: [`drain-tx-${index}`],
      pathAddresses: [victimAddress, receiver],
      subjectTokenState: null,
      victimTokenState: null,
      features: []
    });
    const result = projectForensicJobGraph(job({
      kind: "address_deep_check",
      subjectAddress: receiver,
      resultJson: {
        subjectAddress: receiver,
        riskScore: 95,
        coverage: { transferEdges: 2 },
        coverageDebug: { missingChecks: [] },
        approvalDrainProvenanceProfiles: [
          profile(1, "TCampaignVictim1111111111111111111", "10000000000", "2026-06-23T13:17:45.000Z"),
          profile(2, "TCampaignVictim2222222222222222222", "2500000000", "2026-06-23T14:01:00.000Z")
        ],
        walletRoleProfiles: [],
        counterpartyRiskProfiles: [],
        directCounterpartyInteractionProfiles: [],
        serviceExposureProfiles: [],
        boundaryExposureProfiles: [],
        inboundProvenanceProfiles: []
      }
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const receiverCampaign = result.graph.nodes.find((node) => node.address === receiver)?.metadata.drainerCampaign;
    expect(receiverCampaign).toMatchObject({
      evidenceType: "drainer_campaign",
      txCount: 2,
      victimCount: 2,
      spenderContractCount: 1,
      operatorCount: 1,
      totalAmountRaw: "12500000000",
      firstSeen: "2026-06-23T13:17:45.000Z",
      lastSeen: "2026-06-23T14:01:00.000Z",
      drainTxHashes: ["drain-tx-1", "drain-tx-2"]
    });
    expect(result.graph.nodes.find((node) => node.address === spenderContract)?.metadata.drainerCampaign).toMatchObject({
      txCount: 2,
      victimCount: 2
    });
    expect(result.graph.nodes.find((node) => node.address === operator)?.metadata.drainerCampaign).toMatchObject({
      txCount: 2,
      victimCount: 2
    });
    expect(result.graph.edges.filter((edge) => edge.metadata.evidenceType === "approval_drain_transfer")).toHaveLength(2);
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
