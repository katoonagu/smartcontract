import { describe, expect, it } from "vitest";
import {
  buildForensicJobRuntimeSummary,
  buildForensicRuntimeContractProjection,
  isDeepSecondLayerContextV1,
  isDeepSecondLayerRelationshipProfile,
  isIncomingDeliverySensitivePhase,
  mergeForensicJobProgress,
  parseForensicJobPhase
} from "../../src/forensics/forensicJobProgress";
import {
  canonicalizeJson,
  classifyTelegramDeliveryError,
  createPendingForensicTelegramDelivery,
  fingerprintCanonicalJson,
  fingerprintTelegramMessagePayload,
  isForensicTelegramDeliveryV1,
  isRecoveredForensicDeliveryIntentDue,
  isRecoveredForensicDeliveryIntentV1,
  isTelegramMessagePayloadV1,
  isTelegramDeliveryDue,
  settleRecoveredForensicDeliveryIntentPreparation,
  transitionTelegramDeliveryToClaimed,
  transitionTelegramDeliveryToSettled
} from "../../src/forensics/telegramDelivery";
import {
  decideWaitReconciliation,
  isWaitReconciliationResultV1
} from "../../src/forensics/waitReconciliation";
import { buildSecondLayerRelationshipProfiles } from "../../src/forensics/deepSecondLayerRelationship";
import {
  CANONICAL_DEEP_SECOND_LAYER_PROFILE,
  CANONICAL_PENDING_DEEP_SECOND_LAYER_PROFILE
} from "../fixtures/runtime/remediationRuntimeCases";
import type {
  DeepSecondLayerRelationshipProfile,
  ForensicTelegramDeliveryV1,
  RecoveredForensicDeliveryIntentV1,
  TelegramMessagePayloadV1,
  TronAddressUsdtIndexState
} from "../../src/types";

function exhaustedDeepProfile() {
  const profile = structuredClone(CANONICAL_PENDING_DEEP_SECOND_LAYER_PROFILE);
  profile.limits.maxExpandedDirectWallets = 1;
  profile.directWalletStatuses[0] = {
    ...profile.directWalletStatuses[0]!,
    status: "no_meaningful_second_hop",
    stopReason: "no_meaningful_second_hop",
    limitationCode: "deep_second_layer_no_meaningful_neighbor",
    queued: false,
    index: {
      address: profile.directWalletStatuses[0]!.address,
      coverageMode: "all_time",
      coverageKind: "provider_windowed",
      status: "complete",
      statusReason: "complete_provider_windowed",
      uniqueCounterpartyCount: 0
    }
  };
  profile.queueRequests = [];
  profile.counters = {
    ...profile.counters,
    directWalletsConsidered: 2,
    queued: 0,
    complete: 1
  };
  return profile;
}

function pendingDeepProfile(): DeepSecondLayerRelationshipProfile {
  const profile = structuredClone(CANONICAL_PENDING_DEEP_SECOND_LAYER_PROFILE);
  profile.queueRequests = [{
    address: profile.directWalletStatuses[0]!.address,
    coverageMode: "all_time",
    queuedReason: "deep_second_layer"
  }];
  return profile;
}

function highDegreeDeepProfile(): DeepSecondLayerRelationshipProfile {
  const profile = structuredClone(CANONICAL_DEEP_SECOND_LAYER_PROFILE);
  const address = "THighDegree111111111111111111111111";
  profile.directWalletStatuses = [{
    address,
    status: "stopped_high_degree",
    stopReason: "high_degree",
    limitationCode: "deep_second_layer_high_degree",
    queued: false,
    serviceCategory: null,
    identity: null,
    index: {
      address,
      coverageMode: "all_time",
      coverageKind: "provider_windowed",
      status: "complete",
      statusReason: "complete_provider_windowed",
      uniqueCounterpartyCount: profile.limits.highDegreeSuppressionThreshold
    },
    savedPathCount: 0,
    groupedNeighborCount: 0
  }];
  profile.counters = {
    ...profile.counters,
    directWalletsConsidered: 1,
    stopped: 1
  };
  return profile;
}

function fullIndexState(address: string, uniqueCounterpartyCount: number): TronAddressUsdtIndexState {
  return {
    address,
    tokenContract: "TRON-USDT",
    coverageMode: "all_time",
    coverageKind: "provider_windowed",
    status: "complete",
    statusReason: "complete_provider_windowed",
    provider: "tronscan",
    totalReported: uniqueCounterpartyCount,
    fetchedTransferCount: uniqueCounterpartyCount,
    uniqueCounterpartyCount,
    newestTransferAt: new Date("2026-07-15T12:00:00.000Z"),
    oldestTransferAt: new Date("2026-07-15T11:00:00.000Z"),
    coveredUntilTimestamp: null,
    targetTimestamp: null,
    fetchedPageCount: 1,
    plannedPageCount: 1,
    currentEndTimestamp: null,
    providerCapHit: false,
    budgetExhausted: false,
    providerInconsistent: false,
    priority: 100,
    nextRunAt: new Date("2026-07-15T12:00:00.000Z"),
    attemptCount: 1,
    maxAttempts: 5,
    retryCount: 0,
    lastError: null,
    lastErrorClass: null,
    lastSuccessfulPageAt: new Date("2026-07-15T12:00:00.000Z"),
    queuedReason: null,
    requestedByJobId: null,
    lockedAt: null,
    lockedUntil: null,
    heartbeatAt: null,
    lockOwner: null,
    budgetPages: null,
    budgetSeconds: null,
    completedAt: new Date("2026-07-15T12:00:00.000Z"),
    createdAt: new Date("2026-07-15T11:00:00.000Z"),
    updatedAt: new Date("2026-07-15T12:00:00.000Z")
  };
}

function linkedDeepProfile(): DeepSecondLayerRelationshipProfile {
  const profile = structuredClone(CANONICAL_DEEP_SECOND_LAYER_PROFILE);
  const directWalletAddress = "TWYSVbUy6eTu6ZrFWRUimgDy9SinkggVKL";
  const secondHopAddress = "TSecondHop111111111111111111111111111";
  const groupMembers = [
    "TGroupMember1111111111111111111111111",
    "TGroupMember2222222222222222222222222"
  ];
  profile.directWalletStatuses = [{
    address: directWalletAddress,
    status: "grouped",
    stopReason: null,
    limitationCode: null,
    queued: false,
    serviceCategory: null,
    identity: null,
    index: {
      address: directWalletAddress,
      coverageMode: "all_time",
      coverageKind: "provider_windowed",
      status: "complete",
      statusReason: "complete_provider_windowed",
      uniqueCounterpartyCount: 3
    },
    savedPathCount: 1,
    groupedNeighborCount: 2
  }];
  profile.paths = [{
    id: "path-1",
    source: "deepcheck_relationship_second_hop",
    depth: 2,
    subjectAddress: profile.subjectAddress,
    directWalletAddress,
    secondHopAddress,
    pathAddresses: [profile.subjectAddress, directWalletAddress, secondHopAddress],
    txHashes: ["tx-path-1"],
    txCount: 1,
    amountRaw: "100",
    firstSeen: "2026-07-15T12:00:00.000Z",
    lastSeen: "2026-07-15T12:00:00.000Z",
    tokenContract: null,
    assetSymbol: "USDT",
    evidence: [{
      txHash: "tx-path-1",
      fromAddress: directWalletAddress,
      toAddress: secondHopAddress,
      amountRaw: "100",
      timestamp: "2026-07-15T12:00:00.000Z"
    }],
    selectionReason: "top_amount_or_activity"
  }];
  profile.groups = [{
    id: "group-1",
    kind: "low_signal_neighbors",
    label: "Low-signal neighbors",
    subjectAddress: profile.subjectAddress,
    directWalletAddress,
    memberCount: groupMembers.length,
    members: groupMembers,
    txCount: 2,
    amountRaw: "50",
    firstSeen: "2026-07-15T12:00:00.000Z",
    lastSeen: "2026-07-15T12:00:00.000Z"
  }];
  profile.counters = {
    directWalletsConsidered: 1,
    expanded: 0,
    grouped: 1,
    stopped: 0,
    notIndexed: 0,
    queued: 0,
    complete: 1,
    paths: 1,
    groups: 1,
    maxSavedDepth: 2
  };
  return profile;
}

describe("forensic job progress helpers", () => {
  it("merges a phase update and refreshes heartbeat without removing existing fields", () => {
    const progress = mergeForensicJobProgress(
      { locale: "ru", mode: "wallet_profile" },
      {
        jobPhase: "cross_chain_stage2",
        crossChainStage2Progress: {
          enabled: true,
          manualDeepMode: true,
          status: "running",
          triggered: true,
          reason: "manual_deep_mode"
        }
      },
      new Date("2026-06-03T00:00:00.000Z")
    );

    expect(progress).toMatchObject({
      locale: "ru",
      mode: "wallet_profile",
      jobPhase: "cross_chain_stage2",
      jobHeartbeatAt: "2026-06-03T00:00:00.000Z",
      crossChainStage2Progress: {
        enabled: true,
        manualDeepMode: true,
        status: "running",
        triggered: true,
        reason: "manual_deep_mode",
        updatedAt: "2026-06-03T00:00:00.000Z"
      }
    });
  });

  it("backfills existing cross-chain progress updatedAt when patch omits cross-chain progress", () => {
    const progress = mergeForensicJobProgress(
      {
        crossChainStage2Progress: {
          enabled: true,
          manualDeepMode: false,
          status: "pending",
          reason: "queued"
        }
      },
      { jobPhase: "risk_recording" },
      new Date("2026-06-03T01:00:00.000Z")
    );

    expect(progress).toMatchObject({
      jobPhase: "risk_recording",
      jobHeartbeatAt: "2026-06-03T01:00:00.000Z",
      crossChainStage2Progress: {
        enabled: true,
        manualDeepMode: false,
        status: "pending",
        reason: "queued",
        updatedAt: "2026-06-03T01:00:00.000Z"
      }
    });
  });

  it("deep-merges strict benchmark nested progress", () => {
    const progress = mergeForensicJobProgress(
      {
        strictProvenance: {
          phase: "checking_hop_coverage",
          coveredHopCount: 1,
          totalHopCount: 2
        },
        strictBenchmarkMetrics: {
          total: { requestCount: 3 },
          stages: { apiMs: 10 }
        }
      },
      {
        strictProvenance: { phase: "waiting_for_targeted_index", waitingFor: null },
        strictBenchmarkMetrics: { stages: { traceMs: 20 } }
      },
      new Date("2026-07-02T10:00:00.000Z")
    );

    expect(progress).toMatchObject({
      strictProvenance: {
        phase: "waiting_for_targeted_index",
        coveredHopCount: 1,
        totalHopCount: 2,
        waitingFor: null
      },
      strictBenchmarkMetrics: {
        total: { requestCount: 3 },
        stages: { apiMs: 10, traceMs: 20 }
      }
    });
  });

  it("extracts a compact admin runtime summary from progress json", () => {
    const summary = buildForensicJobRuntimeSummary({
      jobPhase: "cross_chain_stage2",
      jobHeartbeatAt: "2026-06-03T00:00:00.000Z",
      retryCount: 1,
      crossChainStage2Progress: {
        enabled: true,
        manualDeepMode: true,
        status: "running",
        triggered: true,
        reason: "manual_deep_mode",
        updatedAt: "2026-06-03T00:00:00.000Z"
      }
    });

    expect(summary).toEqual({
      phase: "cross_chain_stage2",
      heartbeatAt: "2026-06-03T00:00:00.000Z",
      retryCount: 1,
      lastRecoveredAt: null,
      staleRecoveryReason: null,
      crossChain: {
        enabled: true,
        manualDeepMode: true,
        status: "running",
        triggered: true,
        reason: "manual_deep_mode",
        selectedAmountRaw: null,
        targetAmountRaw: null,
        providerCalls: null,
        updatedAt: "2026-06-03T00:00:00.000Z"
      }
    });
  });

  it("parses balance-forming slice as a first-class runtime phase", () => {
    expect(parseForensicJobPhase("checking_balance_forming_slice")).toBe("checking_balance_forming_slice");
    expect(buildForensicJobRuntimeSummary({
      jobPhase: "checking_balance_forming_slice"
    }).phase).toBe("checking_balance_forming_slice");
  });

  it("returns null for invalid cross-chain progress status", () => {
    const summary = buildForensicJobRuntimeSummary({
      crossChainStage2Progress: {
        enabled: true,
        manualDeepMode: true,
        status: "unexpected_status"
      }
    });

    expect(summary.crossChain?.status).toBe(null);
  });

  it("returns null for missing cross-chain progress status", () => {
    const summary = buildForensicJobRuntimeSummary({
      crossChainStage2Progress: {
        enabled: true,
        manualDeepMode: true
      }
    });

    expect(summary.crossChain?.status).toBe(null);
  });

  it("marks delivery-sensitive incoming phases", () => {
    expect(isIncomingDeliverySensitivePhase("notification_delivery")).toBe(true);
    expect(isIncomingDeliverySensitivePhase("completing")).toBe(true);
    expect(isIncomingDeliverySensitivePhase("incoming_deposit_trace")).toBe(false);
    expect(isIncomingDeliverySensitivePhase(null)).toBe(true);
  });

  it("accepts strict provenance benchmark phases", () => {
    expect(parseForensicJobPhase("selecting_flows")).toBe("selecting_flows");
    expect(parseForensicJobPhase("tracing_paths")).toBe("tracing_paths");
    expect(parseForensicJobPhase("checking_hop_coverage")).toBe("checking_hop_coverage");
    expect(parseForensicJobPhase("indexing_hop_history")).toBe("indexing_hop_history");
    expect(parseForensicJobPhase("waiting_for_targeted_index")).toBe("waiting_for_targeted_index");
    expect(parseForensicJobPhase("reading_local_index")).toBe("reading_local_index");
    expect(parseForensicJobPhase("scoring")).toBe("scoring");
    expect(parseForensicJobPhase("provider_limited")).toBe("provider_limited");
  });

  it("summarizes waiting strict benchmark phase", () => {
    expect(
      buildForensicJobRuntimeSummary({
        jobPhase: "waiting_for_targeted_index",
        jobHeartbeatAt: "2026-07-02T10:00:00.000Z"
      })
    ).toMatchObject({
      phase: "waiting_for_targeted_index",
      heartbeatAt: "2026-07-02T10:00:00.000Z"
    });
  });

  it("projects validated runtime contracts without synthesizing them for legacy progress", () => {
    const baseResult = {
      version: "forensic-result-v3",
      evidence: [{ id: "base-evidence-1" }]
    };
    const payload: TelegramMessagePayloadV1 = {
      version: "telegram-message-payload-v1",
      chatId: "chat-contract-projection",
      text: "<b>Completed</b>",
      parseMode: "HTML",
      replyMarkup: null
    };
    const telegramDelivery = createPendingForensicTelegramDelivery({
      jobId: "job-contract-projection",
      kind: "where_is_money_check",
      payload,
      effect: null
    });
    const waitReconciliation = decideWaitReconciliation({
      parentJobId: "job-contract-projection",
      readyCount: 2,
      terminalCount: 0,
      cancelledCount: 0,
      waitingCount: 0
    });
    const deepSecondLayerContext = {
      version: "deep-second-layer-context-v1" as const,
      baseResultFingerprint: fingerprintCanonicalJson(baseResult),
      refreshedAt: "2026-07-15T12:10:00.000Z",
      profile: CANONICAL_DEEP_SECOND_LAYER_PROFILE
    };

    const progress = mergeForensicJobProgress(
      { legacyField: { remains: true } },
      { telegramDelivery, waitReconciliation, deepSecondLayerContext },
      new Date("2026-07-15T12:11:00.000Z"),
      { baseResult, expectedSubjectAddress: deepSecondLayerContext.profile.subjectAddress }
    );

    expect(progress.legacyField).toEqual({ remains: true });
    expect(buildForensicRuntimeContractProjection(progress, {
      baseResult,
      expectedSubjectAddress: deepSecondLayerContext.profile.subjectAddress
    })).toEqual({
      telegramDelivery,
      telegramDeliveryIntent: null,
      deepSecondLayerContext,
      waitReconciliation
    });
    expect(buildForensicRuntimeContractProjection({ legacyField: true })).toEqual({
      telegramDelivery: null,
      telegramDeliveryIntent: null,
      deepSecondLayerContext: null,
      waitReconciliation: null
    });
  });

  it("exposes Deep context only when explicitly bound to the immutable base result", () => {
    const baseResult = {
      version: "forensic-result-v3",
      score: 61,
      evidence: [{ id: "evidence-1", details: { z: 1, a: 2 } }]
    };
    const context = {
      version: "deep-second-layer-context-v1" as const,
      baseResultFingerprint: fingerprintCanonicalJson(baseResult),
      refreshedAt: "2026-07-15T12:10:00.000Z",
      profile: CANONICAL_DEEP_SECOND_LAYER_PROFILE
    };
    const progress = { deepSecondLayerContext: context };

    const expectedSubjectAddress = context.profile.subjectAddress;
    expect(isDeepSecondLayerContextV1(context, { baseResult, expectedSubjectAddress })).toBe(true);
    expect(isDeepSecondLayerContextV1(context, {
      expectedBaseResultFingerprint: context.baseResultFingerprint,
      expectedSubjectAddress
    })).toBe(true);
    expect(isDeepSecondLayerContextV1(context, {
      baseResult: { ...baseResult, score: 62 },
      expectedSubjectAddress
    })).toBe(false);
    expect(isDeepSecondLayerContextV1(context, {
      baseResult,
      expectedSubjectAddress: "TForeignSubject11111111111111111111111"
    })).toBe(false);
    expect(isDeepSecondLayerContextV1(context, {
      baseResult,
      expectedSubjectAddress: null
    } as never)).toBe(false);
    expect(isDeepSecondLayerContextV1(context, {
      baseResult,
      expectedBaseResultFingerprint: context.baseResultFingerprint,
      expectedSubjectAddress
    } as never)).toBe(false);
    expect(isDeepSecondLayerContextV1(context)).toBe(false);
    expect(buildForensicRuntimeContractProjection(progress, { baseResult, expectedSubjectAddress })
      .deepSecondLayerContext)
      .toEqual(context);
    expect(buildForensicRuntimeContractProjection(progress, {
      baseResult: { ...baseResult, score: 62 },
      expectedSubjectAddress
    }).deepSecondLayerContext).toBe(null);
    expect(buildForensicRuntimeContractProjection(progress).deepSecondLayerContext).toBe(null);
  });

  it("accepts considered wallets omitted from statuses after the expansion budget", () => {
    expect(isDeepSecondLayerContextV1({
      version: "deep-second-layer-context-v1",
      baseResultFingerprint: fingerprintCanonicalJson({ version: "forensic-result-v3" }),
      refreshedAt: "2026-07-15T12:10:00.000Z",
      profile: exhaustedDeepProfile()
    }, {
      baseResult: { version: "forensic-result-v3" },
      expectedSubjectAddress: CANONICAL_DEEP_SECOND_LAYER_PROFILE.subjectAddress
    })).toBe(true);
  });

  it("rejects omitted statuses before the expansion budget is exhausted", () => {
    const profile = exhaustedDeepProfile();
    profile.limits.maxExpandedDirectWallets = 2;
    expect(isDeepSecondLayerContextV1({
      version: "deep-second-layer-context-v1",
      baseResultFingerprint: fingerprintCanonicalJson({ version: "forensic-result-v3" }),
      refreshedAt: "2026-07-15T12:10:00.000Z",
      profile
    }, {
      baseResult: { version: "forensic-result-v3" },
      expectedSubjectAddress: CANONICAL_DEEP_SECOND_LAYER_PROFILE.subjectAddress
    })).toBe(false);
  });

  it("rejects completed expansion counts above the configured budget", () => {
    const profile = exhaustedDeepProfile();
    profile.limits.maxExpandedDirectWallets = 0;
    expect(isDeepSecondLayerContextV1({
      version: "deep-second-layer-context-v1",
      baseResultFingerprint: fingerprintCanonicalJson({ version: "forensic-result-v3" }),
      refreshedAt: "2026-07-15T12:10:00.000Z",
      profile
    }, {
      baseResult: { version: "forensic-result-v3" },
      expectedSubjectAddress: CANONICAL_DEEP_SECOND_LAYER_PROFILE.subjectAddress
    })).toBe(false);
  });

  it("rejects Deep profiles whose counters do not reconcile with canonical status buckets", () => {
    expect(isDeepSecondLayerContextV1({
      version: "deep-second-layer-context-v1",
      baseResultFingerprint: fingerprintCanonicalJson({ version: "forensic-result-v3" }),
      refreshedAt: "2026-07-15T12:10:00.000Z",
      profile: pendingDeepProfile()
    }, {
      baseResult: { version: "forensic-result-v3" },
      expectedSubjectAddress: CANONICAL_DEEP_SECOND_LAYER_PROFILE.subjectAddress
    })).toBe(true);

    const mismatchedProfile = pendingDeepProfile();
    mismatchedProfile.counters.directWalletsConsidered = 999;
    expect(isDeepSecondLayerContextV1({
      version: "deep-second-layer-context-v1",
      baseResultFingerprint: fingerprintCanonicalJson({ version: "forensic-result-v3" }),
      refreshedAt: "2026-07-15T12:10:00.000Z",
      profile: mismatchedProfile
    }, {
      baseResult: { version: "forensic-result-v3" },
      expectedSubjectAddress: CANONICAL_DEEP_SECOND_LAYER_PROFILE.subjectAddress
    })).toBe(false);
  });

  it("binds Deep profiles to their job subject and internal path/group references", () => {
    const profile = linkedDeepProfile();
    expect(isDeepSecondLayerRelationshipProfile(profile, profile.subjectAddress)).toBe(true);

    const foreignSubject = structuredClone(profile);
    foreignSubject.paths[0]!.subjectAddress = "TForeignSubject11111111111111111111111";
    foreignSubject.paths[0]!.pathAddresses[0] = foreignSubject.paths[0]!.subjectAddress;
    expect(isDeepSecondLayerRelationshipProfile(foreignSubject, profile.subjectAddress)).toBe(false);

    const foreignGroupSubject = structuredClone(profile);
    foreignGroupSubject.groups[0]!.subjectAddress = "TForeignSubject22222222222222222222222";
    expect(isDeepSecondLayerRelationshipProfile(foreignGroupSubject, profile.subjectAddress)).toBe(false);

    const foreignPathDirect = structuredClone(profile);
    foreignPathDirect.paths[0]!.directWalletAddress = "TForeignDirect111111111111111111111111";
    foreignPathDirect.paths[0]!.pathAddresses[1] = foreignPathDirect.paths[0]!.directWalletAddress;
    expect(isDeepSecondLayerRelationshipProfile(foreignPathDirect, profile.subjectAddress)).toBe(false);

    const foreignGroupDirect = structuredClone(profile);
    foreignGroupDirect.groups[0]!.directWalletAddress = "TForeignDirect222222222222222222222222";
    expect(isDeepSecondLayerRelationshipProfile(foreignGroupDirect, profile.subjectAddress)).toBe(false);
  });

  it("reconciles Deep status counts, queue references, and configured limits", () => {
    const profile = linkedDeepProfile();
    for (const mutate of [
      (candidate: DeepSecondLayerRelationshipProfile) => { candidate.directWalletStatuses[0]!.savedPathCount = 0; },
      (candidate: DeepSecondLayerRelationshipProfile) => { candidate.directWalletStatuses[0]!.groupedNeighborCount = 1; },
      (candidate: DeepSecondLayerRelationshipProfile) => { candidate.groups[0]!.memberCount = 1; },
      (candidate: DeepSecondLayerRelationshipProfile) => { candidate.limits.maxDirectWalletsConsidered = 0; },
      (candidate: DeepSecondLayerRelationshipProfile) => {
        candidate.limits.maxSecondHopNeighborsPerDirectWallet = 0;
      },
      (candidate: DeepSecondLayerRelationshipProfile) => { candidate.limits.maxTotalSecondHopEdges = 0; }
    ]) {
      const candidate = structuredClone(profile);
      mutate(candidate);
      expect(isDeepSecondLayerRelationshipProfile(candidate, profile.subjectAddress)).toBe(false);
    }

    const queued = pendingDeepProfile();
    queued.queueRequests = [{
      address: "TForeignQueue1111111111111111111111111",
      coverageMode: "all_time",
      queuedReason: "deep_second_layer"
    }];
    expect(isDeepSecondLayerRelationshipProfile(queued, queued.subjectAddress)).toBe(false);

    const queueForGrouped = structuredClone(profile);
    queueForGrouped.queueRequests = [{
      address: queueForGrouped.directWalletStatuses[0]!.address,
      coverageMode: "all_time",
      queuedReason: "deep_second_layer"
    }];
    expect(isDeepSecondLayerRelationshipProfile(queueForGrouped, queueForGrouped.subjectAddress))
      .toBe(false);
  });

  it("rejects unknown own fields throughout nested Deep profile records", () => {
    const nestedMutations = [
      (candidate: DeepSecondLayerRelationshipProfile) => Object.assign(candidate.limits, {
        rawProviderError: "secret"
      }),
      (candidate: DeepSecondLayerRelationshipProfile) => Object.assign(candidate.counters, {
        secretToken: "must-not-persist"
      }),
      (candidate: DeepSecondLayerRelationshipProfile) => Object.assign(
        candidate.directWalletStatuses[0]!,
        { rawProviderError: "secret" }
      ),
      (candidate: DeepSecondLayerRelationshipProfile) => Object.assign(
        candidate.directWalletStatuses[0]!.index!,
        { secretToken: "must-not-persist" }
      ),
      (candidate: DeepSecondLayerRelationshipProfile) => Object.assign(candidate.paths[0]!, {
        rawProviderError: "secret"
      }),
      (candidate: DeepSecondLayerRelationshipProfile) => Object.assign(
        candidate.paths[0]!.evidence[0]!,
        { secretToken: "must-not-persist" }
      ),
      (candidate: DeepSecondLayerRelationshipProfile) => Object.assign(candidate.groups[0]!, {
        rawProviderError: "secret"
      })
    ];
    for (const mutate of nestedMutations) {
      const candidate = linkedDeepProfile();
      mutate(candidate);
      expect(isDeepSecondLayerRelationshipProfile(candidate, candidate.subjectAddress)).toBe(false);
    }

    const queueCandidate = pendingDeepProfile();
    Object.assign(queueCandidate.queueRequests[0]!, { secretToken: "must-not-persist" });
    expect(isDeepSecondLayerRelationshipProfile(queueCandidate, queueCandidate.subjectAddress))
      .toBe(false);
  });

  it("binds path evidence hashes and endpoints to the persisted path", () => {
    const foreignHash = linkedDeepProfile();
    foreignHash.paths[0]!.evidence[0]!.txHash = "tx-foreign";
    expect(isDeepSecondLayerRelationshipProfile(foreignHash, foreignHash.subjectAddress)).toBe(false);

    const foreignEndpoint = linkedDeepProfile();
    foreignEndpoint.paths[0]!.evidence[0]!.toAddress = "TForeignEvidence1111111111111111111111";
    expect(isDeepSecondLayerRelationshipProfile(foreignEndpoint, foreignEndpoint.subjectAddress))
      .toBe(false);
  });

  it("enforces status discriminants and accepts the full current index record", () => {
    const highDegree = highDegreeDeepProfile();
    const highDegreeStatus = highDegree.directWalletStatuses[0]!;
    highDegreeStatus.index = fullIndexState(
      highDegreeStatus.address,
      highDegree.limits.highDegreeSuppressionThreshold
    );
    expect(isDeepSecondLayerRelationshipProfile(highDegree, highDegree.subjectAddress)).toBe(true);

    const belowThreshold = structuredClone(highDegree);
    belowThreshold.directWalletStatuses[0]!.index!.uniqueCounterpartyCount -= 1;
    expect(isDeepSecondLayerRelationshipProfile(belowThreshold, belowThreshold.subjectAddress))
      .toBe(false);

    const queued = pendingDeepProfile();
    expect(isDeepSecondLayerRelationshipProfile(queued, queued.subjectAddress)).toBe(true);
    queued.directWalletStatuses[0]!.queued = false;
    expect(isDeepSecondLayerRelationshipProfile(queued, queued.subjectAddress)).toBe(false);

    const notIndexed = pendingDeepProfile();
    notIndexed.directWalletStatuses[0] = {
      ...notIndexed.directWalletStatuses[0]!,
      status: "not_indexed",
      stopReason: "index_not_complete",
      limitationCode: "deep_second_layer_not_indexed",
      queued: false
    };
    notIndexed.counters.queued = 0;
    notIndexed.counters.notIndexed = 1;
    expect(isDeepSecondLayerRelationshipProfile(notIndexed, notIndexed.subjectAddress)).toBe(true);

    const duplicateRequest = pendingDeepProfile();
    duplicateRequest.queueRequests.push({ ...duplicateRequest.queueRequests[0]! });
    expect(isDeepSecondLayerRelationshipProfile(duplicateRequest, duplicateRequest.subjectAddress))
      .toBe(false);
  });

  it("validates every present field on full Tron index records", () => {
    const profile = highDegreeDeepProfile();
    const status = profile.directWalletStatuses[0]!;
    const indexWithOptionals = {
      ...fullIndexState(status.address, profile.limits.highDegreeSuppressionThreshold),
      requestKind: "candidate_window",
      windowStartTimestamp: new Date("2026-07-15T10:00:00.000Z"),
      windowEndTimestamp: new Date("2026-07-15T12:00:00.000Z"),
      relatedHopTxHash: "related-hop-hash",
      candidateTxHash: "candidate-hash",
      claimPreviousStatus: "queued",
      lastError: "x".repeat(4_096),
      lastErrorClass: "provider_error"
    } satisfies TronAddressUsdtIndexState;
    status.index = indexWithOptionals;
    expect(isDeepSecondLayerRelationshipProfile(profile, profile.subjectAddress)).toBe(true);

    for (const mutate of [
      (index: Record<string, unknown>) => { index.providerCapHit = {}; },
      (index: Record<string, unknown>) => { index.lastError = "x".repeat(100_000); },
      (index: Record<string, unknown>) => { index.requestKind = "wrong_optional_kind"; }
    ]) {
      const candidate = structuredClone(profile);
      mutate(candidate.directWalletStatuses[0]!.index as unknown as Record<string, unknown>);
      expect(isDeepSecondLayerRelationshipProfile(candidate, candidate.subjectAddress)).toBe(false);
    }
  });

  it("reconciles path amounts and time bounds with ordered evidence", () => {
    const profile = linkedDeepProfile();
    const path = profile.paths[0]!;
    path.txHashes = ["tx-null-amount", ...path.txHashes];
    path.txCount = 2;
    path.evidence = [{
      txHash: "tx-null-amount",
      fromAddress: path.secondHopAddress,
      toAddress: path.directWalletAddress,
      amountRaw: null,
      timestamp: null
    }, ...path.evidence];
    expect(isDeepSecondLayerRelationshipProfile(profile, profile.subjectAddress)).toBe(true);

    const wrongAmount = structuredClone(profile);
    wrongAmount.paths[0]!.amountRaw = "101";
    expect(isDeepSecondLayerRelationshipProfile(wrongAmount, wrongAmount.subjectAddress)).toBe(false);

    const wrongFirstSeen = structuredClone(profile);
    wrongFirstSeen.paths[0]!.firstSeen = null;
    expect(isDeepSecondLayerRelationshipProfile(wrongFirstSeen, wrongFirstSeen.subjectAddress))
      .toBe(false);

    const wrongLastSeen = structuredClone(profile);
    wrongLastSeen.paths[0]!.lastSeen = "2026-07-15T12:00:01.000Z";
    expect(isDeepSecondLayerRelationshipProfile(wrongLastSeen, wrongLastSeen.subjectAddress))
      .toBe(false);
  });

  it("bounds Deep identifiers, human strings, and uint256 raw amounts", () => {
    const maxUint256 = ((1n << 256n) - 1n).toString();
    const maximum = linkedDeepProfile();
    maximum.paths[0]!.amountRaw = maxUint256;
    maximum.paths[0]!.evidence[0]!.amountRaw = maxUint256;
    expect(isDeepSecondLayerRelationshipProfile(maximum, maximum.subjectAddress)).toBe(true);

    const tooLargeUint256 = structuredClone(maximum);
    tooLargeUint256.paths[0]!.amountRaw = (1n << 256n).toString();
    tooLargeUint256.paths[0]!.evidence[0]!.amountRaw = (1n << 256n).toString();
    expect(isDeepSecondLayerRelationshipProfile(tooLargeUint256, tooLargeUint256.subjectAddress))
      .toBe(false);

    for (const mutate of [
      (candidate: DeepSecondLayerRelationshipProfile) => {
        candidate.paths[0]!.amountRaw = "9".repeat(100_000);
      },
      (candidate: DeepSecondLayerRelationshipProfile) => {
        candidate.paths[0]!.id = "i".repeat(513);
      },
      (candidate: DeepSecondLayerRelationshipProfile) => {
        candidate.groups[0]!.label = "l".repeat(4_097);
      },
      (candidate: DeepSecondLayerRelationshipProfile) => {
        candidate.directWalletStatuses[0]!.address = "a".repeat(513);
      }
    ]) {
      const candidate = linkedDeepProfile();
      mutate(candidate);
      expect(isDeepSecondLayerRelationshipProfile(candidate, candidate.subjectAddress)).toBe(false);
    }
  });

  it("accepts real builder path and group aggregates above one uint256", async () => {
    const maxUint256 = ((1n << 256n) - 1n).toString();
    const aggregate = (2n * ((1n << 256n) - 1n)).toString();
    const subjectAddress = "TAggregateSubject111111111111111111111";
    const directWalletAddress = "TAggregateDirect1111111111111111111111";
    const secondHopAddress = "TAggregateSecond1111111111111111111111";
    const build = (maxSecondHopNeighborsPerDirectWallet: number) =>
      buildSecondLayerRelationshipProfiles({
        subjectAddress,
        directBoundaryAddresses: [directWalletAddress],
        directCounterpartyProfiles: [],
        classifications: new Map(),
        generatedAt: "2026-07-16T00:00:00.000Z",
        limits: {
          maxDirectWalletsConsidered: 1,
          maxExpandedDirectWallets: 1,
          maxSecondHopNeighborsPerDirectWallet,
          maxTotalSecondHopEdges: 2,
          highDegreeSuppressionThreshold: 100
        },
        getIndexState: () => ({
          address: directWalletAddress,
          coverageMode: "all_time",
          coverageKind: "provider_windowed",
          status: "complete",
          statusReason: "complete_provider_windowed",
          uniqueCounterpartyCount: 1
        }),
        listIndexedEdges: () => [{
          txHash: "aggregate-tx-1",
          fromAddress: directWalletAddress,
          toAddress: secondHopAddress,
          amountRaw: maxUint256,
          timestamp: "2026-07-16T00:00:00.000Z"
        }, {
          txHash: "aggregate-tx-2",
          fromAddress: secondHopAddress,
          toAddress: directWalletAddress,
          amountRaw: maxUint256,
          timestamp: "2026-07-16T00:00:01.000Z"
        }]
      });

    const pathProfile = await build(1);
    expect(pathProfile.paths[0]!.amountRaw).toBe(aggregate);
    expect(isDeepSecondLayerRelationshipProfile(pathProfile, subjectAddress)).toBe(true);

    const groupedProfile = await build(0);
    expect(groupedProfile.groups[0]!.amountRaw).toBe(aggregate);
    expect(isDeepSecondLayerRelationshipProfile(groupedProfile, subjectAddress)).toBe(true);
  });

  it("accepts real builder groups above the profile array cap and rejects invalid counts", async () => {
    const subjectAddress = "TLargeGroupSubject111111111111111111111";
    const directWalletAddress = "TLargeGroupDirect1111111111111111111111";
    const secondHopAddress = "TLargeGroupSecond1111111111111111111111";
    const groupedProfile = await buildSecondLayerRelationshipProfiles({
      subjectAddress,
      directBoundaryAddresses: [directWalletAddress],
      directCounterpartyProfiles: [],
      classifications: new Map(),
      generatedAt: "2026-07-16T00:00:00.000Z",
      limits: {
        maxDirectWalletsConsidered: 1,
        maxExpandedDirectWallets: 1,
        maxSecondHopNeighborsPerDirectWallet: 0,
        maxTotalSecondHopEdges: 0,
        highDegreeSuppressionThreshold: 100
      },
      getIndexState: () => ({
        address: directWalletAddress,
        coverageMode: "all_time",
        coverageKind: "provider_windowed",
        status: "complete",
        statusReason: "complete_provider_windowed",
        uniqueCounterpartyCount: 1
      }),
      listIndexedEdges: () => Array.from({ length: 10_001 }, (_, index) => ({
        txHash: `large-group-tx-${index}`,
        fromAddress: directWalletAddress,
        toAddress: secondHopAddress,
        amountRaw: "1",
        timestamp: "2026-07-16T00:00:00.000Z"
      }))
    });

    expect(groupedProfile.groups[0]).toMatchObject({ txCount: 10_001, amountRaw: "10001" });
    expect(isDeepSecondLayerRelationshipProfile(groupedProfile, subjectAddress)).toBe(true);

    const unsafeCount = structuredClone(groupedProfile);
    unsafeCount.groups[0]!.txCount = Number.MAX_SAFE_INTEGER + 1;
    expect(isDeepSecondLayerRelationshipProfile(unsafeCount, subjectAddress)).toBe(false);

    const fractionalCount = structuredClone(groupedProfile);
    fractionalCount.groups[0]!.txCount = 10_001.5;
    expect(isDeepSecondLayerRelationshipProfile(fractionalCount, subjectAddress)).toBe(false);
  });

  it("rejects unknown fields at Deep context and profile persistence boundaries", () => {
    const baseResult = { version: "forensic-result-v3" };
    const profile = linkedDeepProfile();
    const binding = { baseResult, expectedSubjectAddress: profile.subjectAddress };
    const context = {
      version: "deep-second-layer-context-v1" as const,
      baseResultFingerprint: fingerprintCanonicalJson(baseResult),
      refreshedAt: "2026-07-15T12:10:00.000Z",
      profile
    };
    expect(isDeepSecondLayerContextV1({ ...context, rawProviderError: "secret" }, binding)).toBe(false);
    expect(isDeepSecondLayerContextV1({
      ...context,
      profile: { ...profile, rawProviderError: "secret" }
    }, binding)).toBe(false);
    expect(() => mergeForensicJobProgress({}, {
      deepSecondLayerContext: { ...context, secretToken: "must-not-persist" }
    } as never, new Date("2026-07-15T12:11:00.000Z"), binding)).toThrow(/deepSecondLayerContext/);
  });

  it("rejects malformed runtime contracts instead of merging or projecting partial shapes", () => {
    expect(() => mergeForensicJobProgress({}, {
      waitReconciliation: {
        parentJobId: "job-invalid",
        readyCount: 1.5,
        terminalCount: 0,
        cancelledCount: 0,
        waitingCount: 0,
        outcome: "resume_ready",
        diagnosticCode: null
      }
    } as never)).toThrow(/waitReconciliation/);
    expect(buildForensicRuntimeContractProjection({
      telegramDelivery: { version: "forensic-telegram-delivery-v1" },
      deepSecondLayerContext: {
        version: "deep-second-layer-context-v1",
        baseResultFingerprint: "A".repeat(64),
        refreshedAt: "not-a-timestamp",
        profile: CANONICAL_DEEP_SECOND_LAYER_PROFILE
      }
    })).toEqual({
      telegramDelivery: null,
      telegramDeliveryIntent: null,
      deepSecondLayerContext: null,
      waitReconciliation: null
    });
    expect(isDeepSecondLayerContextV1({
      version: "deep-second-layer-context-v1",
      baseResultFingerprint: "b".repeat(64),
      refreshedAt: "2026-07-15T12:04:59.999Z",
      profile: CANONICAL_DEEP_SECOND_LAYER_PROFILE
    }, {
      expectedBaseResultFingerprint: "b".repeat(64),
      expectedSubjectAddress: CANONICAL_DEEP_SECOND_LAYER_PROFILE.subjectAddress
    })).toBe(false);
  });
});

describe("wait reconciliation contracts", () => {
  it.each([
    [{ readyCount: 1, terminalCount: 1, cancelledCount: 0, waitingCount: 1 }, "unchanged", null],
    [{ readyCount: 0, terminalCount: 0, cancelledCount: 0, waitingCount: 0 }, "contradictory", "missing_wait_rows"],
    [{ readyCount: 1, terminalCount: 0, cancelledCount: 1, waitingCount: 0 }, "contradictory", "cancelled_wait_present"],
    [{ readyCount: 2, terminalCount: 1, cancelledCount: 0, waitingCount: 0 }, "resume_terminal", null],
    [{ readyCount: 3, terminalCount: 0, cancelledCount: 0, waitingCount: 0 }, "resume_ready", null]
  ] as const)("applies the complete wait decision table %#", (counts, outcome, diagnosticCode) => {
    const result = decideWaitReconciliation({ parentJobId: "parent-1", ...counts });
    expect(result).toEqual({ parentJobId: "parent-1", ...counts, outcome, diagnosticCode });
    expect(isWaitReconciliationResultV1(result)).toBe(true);
  });

  it("rejects negative and fractional wait counts", () => {
    expect(() => decideWaitReconciliation({
      parentJobId: "parent-1",
      readyCount: -1,
      terminalCount: 0,
      cancelledCount: 0,
      waitingCount: 0
    })).toThrow(/readyCount/);
    expect(isWaitReconciliationResultV1({
      parentJobId: "parent-1",
      readyCount: 1.5,
      terminalCount: 0,
      cancelledCount: 0,
      waitingCount: 0,
      outcome: "resume_ready",
      diagnosticCode: null
    })).toBe(false);
  });

  it("rejects unknown wait-result fields and does not copy them from decision inputs", () => {
    const result = decideWaitReconciliation({
      parentJobId: "parent-exact",
      readyCount: 1,
      terminalCount: 0,
      cancelledCount: 0,
      waitingCount: 0,
      rawProviderError: "secret"
    } as never);
    expect(result).not.toHaveProperty("rawProviderError");
    expect(isWaitReconciliationResultV1({ ...result, rawProviderError: "secret" })).toBe(false);
  });
});

describe("Telegram delivery contracts", () => {
  const payload: TelegramMessagePayloadV1 = {
    version: "telegram-message-payload-v1",
    chatId: "chat-1",
    text: "<b>Forensic result</b>",
    parseMode: "HTML",
    replyMarkup: {
      resize_keyboard: true,
      inline_keyboard: [[{ callback_data: "job:1", text: "Open" }]]
    }
  };

  it("fingerprints recursively canonical payload JSON and creates a bound pending delivery", () => {
    const reordered: TelegramMessagePayloadV1 = {
      ...payload,
      replyMarkup: {
        inline_keyboard: [[{ text: "Open", callback_data: "job:1" }]],
        resize_keyboard: true
      }
    };
    expect(fingerprintTelegramMessagePayload(reordered)).toBe(fingerprintTelegramMessagePayload(payload));

    const delivery = createPendingForensicTelegramDelivery({
      jobId: "job-1",
      kind: "incoming_deposit_check",
      payload,
      effect: {
        kind: "incoming_user_alert",
        watchedWalletId: "wallet-1",
        incomingTxHash: "tx-1"
      }
    });
    expect(delivery).toMatchObject({
      version: "forensic-telegram-delivery-v1",
      state: {
        status: "pending",
        attemptCount: 0,
        lastAttemptAt: null,
        sentAt: null,
        lastError: null,
        messageFingerprint: fingerprintTelegramMessagePayload(payload)
      },
      claim: null
    });
    expect(isForensicTelegramDeliveryV1(delivery, "incoming_deposit_check")).toBe(true);
    expect(() => createPendingForensicTelegramDelivery({
      jobId: "job-1",
      kind: "where_is_money_check",
      payload,
      effect: {
        kind: "incoming_user_alert",
        watchedWalletId: "wallet-1",
        incomingTxHash: "tx-1"
      }
    })).toThrow(/effect/);
  });

  it("orders distinct Unicode keys by deterministic JavaScript code units", () => {
    const composedFirst: TelegramMessagePayloadV1 = {
      ...payload,
      replyMarkup: { "é": "composed", "e\u0301": "decomposed" }
    };
    const decomposedFirst: TelegramMessagePayloadV1 = {
      ...payload,
      replyMarkup: { "e\u0301": "decomposed", "é": "composed" }
    };
    expect(fingerprintTelegramMessagePayload(composedFirst))
      .toBe(fingerprintTelegramMessagePayload(decomposedFirst));
  });

  it("canonicalizes only persistence-stable JSON with bounded traversal", () => {
    const value = {
      nested: [{ z: true, a: null }, "value"],
      "é": "composed",
      "e\u0301": "decomposed"
    };
    const canonical = canonicalizeJson(value);
    expect(JSON.stringify(JSON.parse(canonical))).toBe(canonical);
    expect(canonicalizeJson(JSON.parse(canonical))).toBe(canonical);
    expect(fingerprintCanonicalJson(value)).toBe(fingerprintCanonicalJson({
      "e\u0301": "decomposed",
      "é": "composed",
      nested: [{ a: null, z: true }, "value"]
    }));
    expect(canonicalizeJson("x".repeat(4_096))).toBe(JSON.stringify("x".repeat(4_096)));
    expect(canonicalizeJson({ ["k".repeat(512)]: true }))
      .toBe(`{${JSON.stringify("k".repeat(512))}:true}`);

    const sparse = new Array(1);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    let deep: unknown = null;
    for (let depth = 0; depth < 70; depth += 1) deep = { child: deep };
    const withAccessor = {};
    Object.defineProperty(withAccessor, "secret", { enumerable: true, get: () => "do-not-read" });
    for (const invalid of [
      sparse,
      undefined,
      () => undefined,
      Symbol("secret"),
      BigInt(1),
      Number.NaN,
      Number.POSITIVE_INFINITY,
      new Date("2026-07-15T12:00:00.000Z"),
      withAccessor,
      cyclic,
      deep,
      Array.from({ length: 10_001 }, () => null),
      "x".repeat(4_097),
      { ["k".repeat(513)]: true }
    ]) {
      expect(() => canonicalizeJson(invalid)).toThrow(/Canonical JSON/);
    }
  });

  it("requires explicit incoming job kind for delivery effects through validation and projection", () => {
    const incomingDelivery = createPendingForensicTelegramDelivery({
      jobId: "job-kind-boundary",
      kind: "incoming_deposit_check",
      payload,
      effect: {
        kind: "incoming_user_alert",
        watchedWalletId: "wallet-kind-boundary",
        incomingTxHash: "tx-kind-boundary"
      }
    });
    expect(isForensicTelegramDeliveryV1(incomingDelivery, "incoming_deposit_check")).toBe(true);
    expect(isForensicTelegramDeliveryV1(incomingDelivery)).toBe(false);
    expect(isForensicTelegramDeliveryV1(incomingDelivery, "where_is_money_check")).toBe(false);
    expect(isForensicTelegramDeliveryV1(incomingDelivery, "address_deep_check")).toBe(false);

    expect(buildForensicRuntimeContractProjection({ telegramDelivery: incomingDelivery })
      .telegramDelivery).toBe(null);
    expect(buildForensicRuntimeContractProjection(
      { telegramDelivery: incomingDelivery },
      { jobKind: "where_is_money_check" }
    ).telegramDelivery).toBe(null);
    expect(buildForensicRuntimeContractProjection(
      { telegramDelivery: incomingDelivery },
      { jobKind: "incoming_deposit_check" }
    ).telegramDelivery).toEqual(incomingDelivery);
    expect(() => mergeForensicJobProgress({}, { telegramDelivery: incomingDelivery }))
      .toThrow(/telegramDelivery/);
    expect(mergeForensicJobProgress(
      {},
      { telegramDelivery: incomingDelivery },
      new Date("2026-07-15T12:00:00.000Z"),
      { jobKind: "incoming_deposit_check" }
    ).telegramDelivery).toEqual(incomingDelivery);

    const ordinaryDelivery = createPendingForensicTelegramDelivery({
      jobId: "job-kind-ordinary",
      kind: "where_is_money_check",
      payload,
      effect: null
    });
    expect(isForensicTelegramDeliveryV1(ordinaryDelivery)).toBe(true);
  });

  it("rejects unknown fields at every delivery persistence boundary", () => {
    expect(isTelegramMessagePayloadV1({ ...payload, rawProviderError: "secret" })).toBe(false);
    expect(() => fingerprintTelegramMessagePayload({
      ...payload,
      secretToken: "must-not-persist"
    } as never)).toThrow(/payload/);

    const delivery = createPendingForensicTelegramDelivery({
      jobId: "job-exact-keys",
      kind: "incoming_deposit_check",
      payload,
      effect: {
        kind: "incoming_user_alert",
        watchedWalletId: "wallet-exact",
        incomingTxHash: "tx-exact"
      }
    });
    expect(isForensicTelegramDeliveryV1({ ...delivery, rawProviderError: "secret" },
      "incoming_deposit_check")).toBe(false);
    expect(isForensicTelegramDeliveryV1({
      ...delivery,
      effect: { ...delivery.effect, secretToken: "must-not-persist" }
    }, "incoming_deposit_check")).toBe(false);
    expect(isForensicTelegramDeliveryV1({
      ...delivery,
      state: { ...delivery.state, rawProviderError: "secret" }
    }, "incoming_deposit_check")).toBe(false);
    expect(() => mergeForensicJobProgress({}, {
      telegramDelivery: { ...delivery, rawProviderError: "secret" }
    } as never, new Date("2026-07-15T12:00:00.000Z"), {
      jobKind: "incoming_deposit_check"
    })).toThrow(/telegramDelivery/);

    const claimed = transitionTelegramDeliveryToClaimed(delivery, {
      token: "exact-boundary-token-01",
      claimedAt: new Date("2026-07-15T12:00:00.000Z")
    }, "incoming_deposit_check");
    expect(isForensicTelegramDeliveryV1({
      ...claimed,
      claim: { ...claimed.claim!, secretToken: "must-not-persist" }
    }, "incoming_deposit_check")).toBe(false);
    expect(() => transitionTelegramDeliveryToClaimed({
      ...delivery,
      rawProviderError: "secret"
    } as never, {
      token: "exact-boundary-token-02",
      claimedAt: new Date("2026-07-15T12:00:00.000Z")
    }, "incoming_deposit_check")).toThrow(/Invalid forensic Telegram delivery/);

    const intent: RecoveredForensicDeliveryIntentV1 = {
      version: "recovered-forensic-delivery-intent-v1",
      kind: "stale_failure",
      createdAt: "2026-07-15T12:00:00.000Z",
      reasonCode: "stale_running_retry_exhausted",
      preparationStatus: "pending",
      preparationAttemptCount: 0,
      lastPreparationAttemptAt: null,
      nextPreparationAttemptAt: null,
      lastPreparationError: null
    };
    expect(isRecoveredForensicDeliveryIntentV1({ ...intent, rawProviderError: "secret" }))
      .toBe(false);
  });

  it("requires claim tokens with at least 128 bits of base64url encoding space", () => {
    const delivery = createPendingForensicTelegramDelivery({
      jobId: "job-token-entropy",
      kind: "where_is_money_check",
      payload,
      effect: null
    });
    expect(() => transitionTelegramDeliveryToClaimed(delivery, {
      token: "x",
      claimedAt: new Date("2026-07-15T12:00:00.000Z")
    })).toThrow(/128 bits/);
    expect(transitionTelegramDeliveryToClaimed(delivery, {
      token: "AbCdEfGhIjKlMnOpQrStUv",
      claimedAt: new Date("2026-07-15T12:00:00.000Z")
    }).claim?.token).toBe("AbCdEfGhIjKlMnOpQrStUv");
  });

  it("claims for exactly 40 seconds, retries at 30/120/600 seconds, and never creates attempt five", () => {
    let delivery = createPendingForensicTelegramDelivery({
      jobId: "job-lease",
      kind: "where_is_money_check",
      payload,
      effect: null
    });
    delivery = transitionTelegramDeliveryToClaimed(delivery, {
      token: "opaque-token-encoded-1",
      claimedAt: new Date("2026-07-15T12:00:00.000Z")
    });
    expect(delivery.claim).toMatchObject({
      attempt: 1,
      claimedAt: "2026-07-15T12:00:00.000Z",
      leaseExpiresAt: "2026-07-15T12:00:40.000Z"
    });
    delivery = transitionTelegramDeliveryToSettled(delivery, {
      token: "opaque-token-encoded-1",
      attempt: 1,
      settledAt: new Date("2026-07-15T12:00:01.000Z"),
      outcome: "retryable",
      errorCode: "telegram_network_error"
    });
    expect(isTelegramDeliveryDue(delivery, new Date("2026-07-15T12:00:29.999Z"))).toBe(false);
    expect(isTelegramDeliveryDue(delivery, new Date("2026-07-15T12:00:30.000Z"))).toBe(true);

    for (const [attempt, claimedAt, nextDue] of [
      [2, "2026-07-15T12:00:31.000Z", "2026-07-15T12:02:31.000Z"],
      [3, "2026-07-15T12:02:31.000Z", "2026-07-15T12:12:31.000Z"]
    ] as const) {
      const token = `opaque-token-encoded-${attempt}`;
      delivery = transitionTelegramDeliveryToClaimed(delivery, { token, claimedAt: new Date(claimedAt) });
      delivery = transitionTelegramDeliveryToSettled(delivery, {
        token,
        attempt,
        settledAt: new Date(claimedAt),
        outcome: "retryable",
        errorCode: "telegram_server_error"
      });
      expect(isTelegramDeliveryDue(delivery, new Date(nextDue))).toBe(true);
    }

    delivery = transitionTelegramDeliveryToClaimed(delivery, {
      token: "opaque-token-encoded-4",
      claimedAt: new Date("2026-07-15T12:12:31.000Z")
    });
    const exhausted = transitionTelegramDeliveryToClaimed(delivery, {
      token: "opaque-token-must-not-be-used-5",
      claimedAt: new Date("2026-07-15T12:13:11.000Z")
    });
    expect(exhausted).toMatchObject({
      state: { status: "failed", attemptCount: 4, lastError: "telegram_attempts_exhausted" },
      claim: null
    });
  });

  it("classifies bounded error codes without returning raw errors", () => {
    expect(classifyTelegramDeliveryError(
      Object.assign(new Error("secret must not escape"), { code: "ETIMEDOUT" })
    )).toEqual({ outcome: "retryable", errorCode: "telegram_network_error" });
    expect(classifyTelegramDeliveryError({ error_code: 403 })).toEqual({
      outcome: "failed",
      errorCode: "telegram_chat_forbidden"
    });
    expect(JSON.stringify(classifyTelegramDeliveryError(new Error("secret must not escape"))))
      .not.toContain("secret");
  });

  it("terminalizes every unsuccessful fourth delivery attempt as exhausted", () => {
    let delivery = createPendingForensicTelegramDelivery({
      jobId: "job-fourth-permanent",
      kind: "where_is_money_check",
      payload,
      effect: null
    });
    for (const [attempt, claimedAt] of [
      [1, "2026-07-15T12:00:00.000Z"],
      [2, "2026-07-15T12:00:30.000Z"],
      [3, "2026-07-15T12:02:30.000Z"]
    ] as const) {
      const token = `opaque-fourth-token-${String(attempt).padStart(2, "0")}`;
      delivery = transitionTelegramDeliveryToClaimed(delivery, { token, claimedAt: new Date(claimedAt) });
      delivery = transitionTelegramDeliveryToSettled(delivery, {
        token,
        attempt,
        settledAt: new Date(claimedAt),
        outcome: "retryable",
        errorCode: "telegram_network_error"
      });
    }
    delivery = transitionTelegramDeliveryToClaimed(delivery, {
      token: "opaque-fourth-token-04",
      claimedAt: new Date("2026-07-15T12:12:30.000Z")
    });
    delivery = transitionTelegramDeliveryToSettled(delivery, {
      token: "opaque-fourth-token-04",
      attempt: 4,
      settledAt: new Date("2026-07-15T12:12:31.000Z"),
      outcome: "failed",
      errorCode: "telegram_bad_request"
    });
    expect(delivery).toMatchObject({
      state: { status: "failed", attemptCount: 4, lastError: "telegram_attempts_exhausted" },
      claim: null
    });
    expect(isForensicTelegramDeliveryV1(delivery)).toBe(true);
  });

  it("rejects unknown settlement outcomes on the first and fourth attempts", () => {
    const pending = createPendingForensicTelegramDelivery({
      jobId: "job-unknown-outcome",
      kind: "where_is_money_check",
      payload,
      effect: null
    });
    const first = transitionTelegramDeliveryToClaimed(pending, {
      token: "unknown-outcome-token-01",
      claimedAt: new Date("2026-07-15T12:00:00.000Z")
    });
    expect(() => transitionTelegramDeliveryToSettled(first, {
      token: "unknown-outcome-token-01",
      attempt: 1,
      settledAt: new Date("2026-07-15T12:00:01.000Z"),
      outcome: "unknown"
    } as never)).toThrow(/outcome/);

    let fourth: ForensicTelegramDeliveryV1 = pending;
    for (const [attempt, claimedAt] of [
      [1, "2026-07-15T12:00:00.000Z"],
      [2, "2026-07-15T12:00:30.000Z"],
      [3, "2026-07-15T12:02:30.000Z"]
    ] as const) {
      const token = `unknown-fourth-token-${String(attempt).padStart(2, "0")}`;
      fourth = transitionTelegramDeliveryToClaimed(fourth, { token, claimedAt: new Date(claimedAt) });
      fourth = transitionTelegramDeliveryToSettled(fourth, {
        token,
        attempt,
        settledAt: new Date(claimedAt),
        outcome: "retryable",
        errorCode: "telegram_network_error"
      });
    }
    fourth = transitionTelegramDeliveryToClaimed(fourth, {
      token: "unknown-fourth-token-04",
      claimedAt: new Date("2026-07-15T12:12:30.000Z")
    });
    expect(() => transitionTelegramDeliveryToSettled(fourth, {
      token: "unknown-fourth-token-04",
      attempt: 4,
      settledAt: new Date("2026-07-15T12:12:31.000Z"),
      outcome: "unknown"
    } as never)).toThrow(/outcome/);
  });

  it("rejects non-JSON or unbounded reply-markup values", () => {
    expect(() => fingerprintTelegramMessagePayload({
      ...payload,
      replyMarkup: new Date("2026-07-15T12:00:00.000Z") as unknown as Record<string, unknown>
    })).toThrow(/payload/);
    expect(() => fingerprintTelegramMessagePayload({
      ...payload,
      replyMarkup: { callback_data: "x".repeat(4_097) }
    })).toThrow(/payload/);
  });

  it("validates stale delivery intents and applies exact preparation backoff/exhaustion", () => {
    let intent: RecoveredForensicDeliveryIntentV1 = {
      version: "recovered-forensic-delivery-intent-v1",
      kind: "stale_failure",
      createdAt: "2026-07-15T12:00:00.000Z",
      reasonCode: "stale_running_retry_exhausted",
      preparationStatus: "pending",
      preparationAttemptCount: 0,
      lastPreparationAttemptAt: null,
      nextPreparationAttemptAt: null,
      lastPreparationError: null
    };
    expect(isRecoveredForensicDeliveryIntentV1(intent)).toBe(true);
    for (const [attemptedAt, expectedNext] of [
      ["2026-07-15T12:00:00.000Z", "2026-07-15T12:00:30.000Z"],
      ["2026-07-15T12:00:30.000Z", "2026-07-15T12:02:30.000Z"],
      ["2026-07-15T12:02:30.000Z", "2026-07-15T12:12:30.000Z"]
    ] as const) {
      intent = settleRecoveredForensicDeliveryIntentPreparation(intent, {
        attemptedAt: new Date(attemptedAt),
        errorCode: "stale_intent_payload_build_failed"
      });
      expect(intent.nextPreparationAttemptAt).toBe(expectedNext);
      expect(isRecoveredForensicDeliveryIntentDue(intent, new Date(expectedNext))).toBe(true);
    }
    intent = settleRecoveredForensicDeliveryIntentPreparation(intent, {
      attemptedAt: new Date("2026-07-15T12:12:30.000Z"),
      errorCode: "stale_intent_unknown_retryable"
    });
    expect(intent).toMatchObject({
      preparationStatus: "failed",
      preparationAttemptCount: 4,
      nextPreparationAttemptAt: null,
      lastPreparationError: "stale_intent_preparation_attempts_exhausted"
    });
    expect(isRecoveredForensicDeliveryIntentV1(intent)).toBe(true);
  });
});
