import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { mkdtemp, open, rmdir, unlink } from "node:fs/promises";

import {
  buildServiceRoleShadowInputFenceV1,
  buildServiceRoleShadowInputSetV1,
  buildServiceRoleShadowPrecommitReceiptV1,
  buildServiceRoleShadowRuntimeReceiptV1,
  parseServiceRoleShadowC1AcceptanceV1,
  parseServiceRoleShadowRuntimeReplayIdentityV1,
  parseServiceRoleShadowRuntimeReplayInputV1,
  serializeServiceRoleShadowC1AcceptanceV1,
  serializeServiceRoleShadowRuntimeReplayIdentityV1,
  serializeServiceRoleShadowRuntimeReplayInputV1,
  validateServiceRoleShadowRuntimeReplayPairV1
} from "../../src/unifiedCheck/serviceRoleShadowRuntime.js";
import {
  canonicalizeArtifactJson,
  canonicalizeLargeArtifactJson,
  fingerprintCanonicalArtifact
} from "../../src/forensics/canonicalJson.js";
import { canonicalTronUsdtEventKey } from "../../src/forensics/tronAddressAllTimeIndex.js";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser.js";
import type { IndexedTronUsdtTransfer } from "../../src/types.js";
import {
  addressHistoryManifestKey,
  buildAddressHistoryManifest
} from "../../src/unifiedCheck/addressHistory.js";
import { buildFrozenLabelDataset } from "../../src/unifiedCheck/frozenLabels.js";
import {
  deriveServiceRoleShadowAcceptedHistoryBindingV1,
  maybeBuildServiceRoleShadowArtifactV1,
  serviceRoleShadowCompoundBindingKeyV1,
  type ServiceRoleShadowEventRoleMapV1,
  type ServiceRoleShadowEventRoleMapV2
} from "../../src/unifiedCheck/serviceRoleShadow.js";
import type { ServiceRoleEventEvidenceBundleV1 } from "../../src/unifiedCheck/serviceRoleMapMaterialization.js";
import {
  expandTraversalChunk,
  traversalExpansionKey,
  traversalStateId,
  type TraversalStateV1
} from "../../src/unifiedCheck/traversal.js";
import { appendTraversalDelta } from "../../src/unifiedCheck/traversalDelta.js";
import {
  buildServiceRoleShadowRuntimeAcceptancePrepareContractsV1,
  extractServiceRoleShadowRuntimeAcceptancePrepareV1,
  parseServiceRoleShadowRuntimeAcceptanceCommand,
  replayServiceRoleShadowRuntimeAcceptanceFromDatabase,
  runServiceRoleShadowRuntimeAcceptanceCli,
  runServiceRoleShadowRuntimeAcceptanceReplayV1,
  SERVICE_ROLE_SHADOW_RUNTIME_ACCEPTANCE_MAX_FILE_BYTES,
  verifyServiceRoleShadowRuntimeGitStateV1
} from "../../scripts/replayServiceRoleShadowRuntimeAcceptance.js";

const SOURCE_RUN_ID = "5417cbf6-7cef-4b91-8367-d266eaf3857e";
const REPLAY_RUN_ID = "11111111-1111-4111-8111-111111111111";
const SNAPSHOT_HASH = "a".repeat(64);
const TESTED_COMMIT = "b".repeat(40);
const SUBJECT = "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP";
const PROFILED = "TG2B2Jb7PXbyKzhJ61yGpyFxqbGBL2cZUH";

function event(index: number, timestampMs: number): IndexedTronUsdtTransfer {
  return {
    txHash: (index + 1).toString(16).padStart(64, "0"),
    blockNumber: 20_000 - index,
    blockTimestamp: new Date(timestampMs),
    eventIndex: 0,
    fromAddress: SUBJECT,
    toAddress: PROFILED,
    amountRaw: String(1_000_000 + index),
    method: "transfer",
    callerAddress: null,
    contractRet: "SUCCESS",
    confirmed: true
  };
}

function acceptanceFixture() {
  const anchor = "2026-06-04T09:20:33.000Z";
  const storedAt = "2026-06-04T09:20:33+00:00";
  const anchorMs = Date.parse(anchor);
  const frozenLabels = buildFrozenLabelDataset({
    frozenAt: anchor,
    snapshotHash: SNAPSHOT_HASH,
    labels: [],
    legacyRows: []
  });
  const events = [
    ...Array.from({ length: 100 }, (_, index) =>
      event(index, anchorMs - index * 60_000)),
    ...Array.from({ length: 100 }, (_, index) =>
      event(index + 100, anchorMs - 8 * 86_400_000 - index * 60_000))
  ];
  const sourcePage = {
    version: "unified-address-history-page-v1",
    schemaVersion: 1,
    runId: SOURCE_RUN_ID,
    manifestKey: "",
    providerPageHash: "c".repeat(64),
    rawRowCount: events.length,
    events: events.map((value) => ({
      ...value,
      blockTimestamp: value.blockTimestamp.toISOString()
    }))
  };
  const sourcePageSha256 = fingerprintCanonicalArtifact(sourcePage);
  const canonicalEventIds = events.map((value) => canonicalTronUsdtEventKey(value)).sort();
  const sourceManifest = buildAddressHistoryManifest({
    chain: "tron",
    snapshotHash: SNAPSHOT_HASH,
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    address: PROFILED,
    providerRequestVersion: "tronscan-related-trc20-v1",
    pageArtifactHashes: [sourcePageSha256],
    canonicalEventIds,
    rawRowCount: events.length,
    duplicateCount: 0,
    exhaustion: {
      kind: "account_creation_reached",
      evidenceSha256: "d".repeat(64)
    }
  });
  sourcePage.manifestKey = sourceManifest.key;
  const finalSourcePageSha256 = fingerprintCanonicalArtifact(sourcePage);
  const finalSourceManifest = {
    ...sourceManifest,
    pageArtifactHashes: [finalSourcePageSha256]
  };
  const sourceManifestSha256 = fingerprintCanonicalArtifact(finalSourceManifest);
  const sourceStates: TraversalStateV1[] = Array.from({ length: 7 }, (_, index) => ({
    address: PROFILED,
    direction: "backward",
    anchorTimestamp: anchor,
    fundingEpisodeId: `episode-${index}`,
    allocatedAmountRaw: String(index + 1),
    sourceEventIds: [canonicalTronUsdtEventKey(events[0]!)]
  }));
  const inheritedState: TraversalStateV1 = {
    address: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
    direction: "backward",
    anchorTimestamp: anchor,
    fundingEpisodeId: "inherited-unresolved-episode",
    allocatedAmountRaw: "1",
    sourceEventIds: [canonicalTronUsdtEventKey(events[0]!)]
  };
  const stateIds = sourceStates.map(traversalStateId).sort();
  const binding = deriveServiceRoleShadowAcceptedHistoryBindingV1({
    state: sourceStates[0]!,
    acceptedHistoryEvents: events
  });
  const sampledIds = [
    ...binding.sampledCanonicalEventIds.recent,
    ...binding.sampledCanonicalEventIds.historical
  ];
  const sourceBundle: ServiceRoleEventEvidenceBundleV1 = {
    schemaVersion: "service-role-event-evidence-bundle-v1",
    policyVersion: "existing-hash-bound-economic-role-v1",
    runId: SOURCE_RUN_ID,
    snapshotHash: SNAPSHOT_HASH,
    addressHistoryManifestSha256: sourceManifestSha256,
    entries: sampledIds.map((canonicalEventId, index) => ({
      canonicalEventId,
      transactionInfoEvidenceId: `evidence-${index}`,
      transactionInfoPayloadSha256: fingerprintCanonicalArtifact(["payload", index]),
      transactionInfoFinalityWitnessSha256: fingerprintCanonicalArtifact(["finality", index]),
      poisoningDispositionSha256: fingerprintCanonicalArtifact(["poisoning", index]),
      providerRiskDispositionSha256: fingerprintCanonicalArtifact(["risk", index]),
      role: "ordinary"
    }))
  };
  const sourceBundleSha256 = fingerprintCanonicalArtifact(sourceBundle);
  const sourceMap: ServiceRoleShadowEventRoleMapV1 = {
    schemaVersion: "service-role-shadow-event-role-map-v1",
    runId: SOURCE_RUN_ID,
    snapshotHash: SNAPSHOT_HASH,
    addressHistoryManifestSha256: sourceManifestSha256,
    entries: sampledIds.map((canonicalEventId) => ({
      canonicalEventId,
      role: "ordinary",
      authority: "existing_hash_bound_economic_role_v1",
      evidenceSha256: sourceBundleSha256
    }))
  };
  const sourceMapSha256 = fingerprintCanonicalArtifact(sourceMap);
  const sourceWrapper: ServiceRoleShadowEventRoleMapV2 = {
    schemaVersion: "service-role-shadow-event-role-map-v2",
    policyVersion: "service-role-shadow-100-plus-100-v1",
    runId: SOURCE_RUN_ID,
    snapshotHash: SNAPSHOT_HASH,
    addressHistoryManifestSha256: sourceManifestSha256,
    sourceEventRoleMapV1Sha256: sourceMapSha256,
    evidenceBundleSha256: sourceBundleSha256,
    binding,
    exactCoverage: { recent: 100, historical: 100, total: 200 },
    productionEffect: false
  };
  const sourceWrapperSha256 = fingerprintCanonicalArtifact(sourceWrapper);
  const sourceAnalysisManifest = {
    version: "analysis-manifest-v1",
    schemaVersion: 1,
    runId: SOURCE_RUN_ID,
    requestHash: fingerprintCanonicalArtifact(["request", SOURCE_RUN_ID]),
    snapshotHash: SNAPSHOT_HASH,
    chain: "tron",
    subjectAddress: SUBJECT,
    confirmedBlockNumber: "20000",
    confirmedBlockHash: "8".repeat(64),
    confirmedBlockTimestamp: anchor,
    labelDatasetSha256: frozenLabels.sha256,
    scoringPolicyVersion: "scoring-signal-matrix-v4",
    attributionPolicyVersion: "selected-attribution-policy-v1",
    traversalPolicyVersion: "snapshot-closure-v1",
    runtimeCommit: "source-runtime-commit",
    databaseSchemaVersion: 36,
    paginationCutoffBlockNumber: "20000",
    paginationCutoffBlockHash: "8".repeat(64),
    branchArtifactHashes: {
      fast: "5".repeat(64),
      deep: "6".repeat(64),
      where: "7".repeat(64)
    }
  } as const;
  const sourceAnalysisManifestSha256 = fingerprintCanonicalArtifact(
    sourceAnalysisManifest
  );
  const sourceCompaction = {
    version: "unified-traversal-compaction-v2",
    analysisManifestHash: sourceAnalysisManifestSha256,
    snapshotHash: SNAPSHOT_HASH,
    sourceCheckpointSha256: "f".repeat(64),
    frontier: [...sourceStates, inheritedState],
    visited: [],
    terminals: [],
    supersededStateIds: [],
    expandedStateIds: [],
    eligibleEventIds: [],
    expandedStateKeys: [],
    selectedBackwardRaw: "0",
    selectedForwardRaw: "0"
  };
  const sourceCompactionSha256 = fingerprintCanonicalArtifact(sourceCompaction);
  const derivedSourcePredecessorCheckpoint = {
    version: "unified-production-traversal-checkpoint-v2" as const,
    analysisManifestHash: sourceAnalysisManifestSha256,
    snapshotHash: SNAPSHOT_HASH,
    deltaHeadSha256: null,
    compactionSha256: sourceCompactionSha256,
    counters: { expanded: 0, terminal: 0, superseded: 0 },
    operational: {
      frontierCount: 8,
      frontierPeak: 8,
      uniqueAddresses: 2,
      fundingEpisodes: 8
    },
    recentDiagnostics: []
  };
  const expanded = expandTraversalChunk({
    frontier: sourceStates,
    events: events.map((value) => ({
      id: canonicalTronUsdtEventKey(value),
      fromAddress: value.fromAddress,
      toAddress: value.toAddress,
      amountRaw: value.amountRaw,
      timestamp: value.blockTimestamp.toISOString()
    })),
    expandedStateIds: new Set(),
    maxStatesThisChunk: sourceStates.length,
    terminalReason: () => null,
    accountCreationExhausted: () => true
  });
  if (expanded.terminals.length !== 0 || expanded.nextFrontier.length !== 7) {
    throw new Error("acceptance_fixture_continuation_missing");
  }
  const appendedSource = appendTraversalDelta(derivedSourcePredecessorCheckpoint, {
    addedFrontier: expanded.nextFrontier,
    removedFrontierStateIds: stateIds,
    addedVisited: sourceStates,
    addedTerminals: [],
    addedSupersededStateIds: [...expanded.supersededStateIds],
    addedExpandedStateIds: [...expanded.processedStateIds],
    addedEligibleEventIds: [...expanded.eligibleEventIds],
    addedExpandedStateKeys: sourceStates.map(traversalExpansionKey),
    counterDeltas: { expanded: 7, terminal: 0, superseded: 0 },
    operational: {
      frontierCount: 8,
      frontierPeak: 8,
      uniqueAddresses: 3,
      fundingEpisodes: 8
    },
    diagnostic: { at: anchor, code: "address-group:backward" }
  });
  const sourceDelta = appendedSource.artifact;
  const sourceDeltaSha256 = appendedSource.sha256;
  const observedTraversalCheckpoint = {
    ...appendedSource.checkpoint,
    queueDurationMs: 100,
    providerDurationMs: 0,
    timingSummary: {
      attemptCount: 1,
      queueDurationMs: 100,
      providerDurationMs: 0
    },
    performanceCounters: { taskClaims: 1, checkpoints: 1, logicalChunks: 1 },
    recentAttempts: []
  };
  const sourceArtifacts = [
    { kind: "analysis_manifest", schemaVersion: "1", sha256: sourceAnalysisManifestSha256, artifactJson: sourceAnalysisManifest },
    { kind: "address_history_manifest", schemaVersion: "1", sha256: sourceManifestSha256, artifactJson: finalSourceManifest },
    { kind: "address_history_page", schemaVersion: "1", sha256: finalSourcePageSha256, artifactJson: sourcePage },
    { kind: "service_role_event_evidence_bundle", schemaVersion: "1", sha256: sourceBundleSha256, artifactJson: sourceBundle },
    { kind: "service_role_event_role_map", schemaVersion: "1", sha256: sourceMapSha256, artifactJson: sourceMap },
    { kind: "service_role_event_role_map", schemaVersion: "2", sha256: sourceWrapperSha256, artifactJson: sourceWrapper },
    { kind: "traversal_compaction_v2", schemaVersion: "1", sha256: sourceCompactionSha256, artifactJson: sourceCompaction },
    { kind: "traversal_delta", schemaVersion: "1", sha256: sourceDeltaSha256, artifactJson: sourceDelta }
  ].sort((left, right) => `${left.kind}:${left.schemaVersion}:${left.sha256}`.localeCompare(
    `${right.kind}:${right.schemaVersion}:${right.sha256}`
  ));
  const replayInput = {
    schemaVersion: "service-role-shadow-runtime-replay-input-v1",
    testedSourceCommit: TESTED_COMMIT,
    sourceRunId: SOURCE_RUN_ID,
    sourceAnalysisManifestSha256,
    sourceAddressHistoryManifestSha256: sourceManifestSha256,
    sourceSnapshotHash: SNAPSHOT_HASH,
    sourceAnchor: anchor,
    sourceRunStatus: "FAILED_TECHNICAL",
    sourceTraversalTaskStatus: "CANCELLED",
    sourceRuntimeCommit: "source-runtime-commit",
    acceptedPlannerEntry: {
      canonicalSequence: 17,
      taskId: "source-history-task",
      acceptedAttemptId: "source-history-attempt",
      manifestKey: finalSourceManifest.key,
      artifactSha256: sourceManifestSha256
    },
    qualifyingTraversalStateIds: stateIds,
    sourceArtifacts,
    observedTraversalCheckpoint: {
      sha256: fingerprintCanonicalArtifact(observedTraversalCheckpoint),
      checkpointJson: observedTraversalCheckpoint
    },
    sourceFrozenLabelDataset: {
      sha256: frozenLabels.sha256,
      datasetJson: frozenLabels.dataset
    },
    productionEffect: false
  } as const;
  const replayInputSha256 = fingerprintCanonicalArtifact(replayInput);
  const analysisManifest = {
    ...sourceAnalysisManifest,
    runId: REPLAY_RUN_ID,
    runtimeCommit: TESTED_COMMIT,
    databaseSchemaVersion: 37
  };
  const analysisManifestSha256 = fingerprintCanonicalArtifact(analysisManifest);
  const replayCompaction = {
    ...sourceCompaction,
    analysisManifestHash: analysisManifestSha256
  };
  const replayCompactionSha256 = fingerprintCanonicalArtifact(replayCompaction);
  const replayPredecessorCheckpoint = {
    ...derivedSourcePredecessorCheckpoint,
    analysisManifestHash: analysisManifestSha256,
    compactionSha256: replayCompactionSha256
  };

  const replayPage = { ...sourcePage, runId: REPLAY_RUN_ID };
  const replayPageSha256 = fingerprintCanonicalArtifact(replayPage);
  const replayManifest = {
    ...finalSourceManifest,
    pageArtifactHashes: [replayPageSha256]
  };
  const replayManifestSha256 = fingerprintCanonicalArtifact(replayManifest);
  const replayBundle = {
    ...sourceBundle,
    runId: REPLAY_RUN_ID,
    addressHistoryManifestSha256: replayManifestSha256
  };
  const replayBundleSha256 = fingerprintCanonicalArtifact(replayBundle);
  const replayMap = {
    ...sourceMap,
    runId: REPLAY_RUN_ID,
    addressHistoryManifestSha256: replayManifestSha256,
    entries: sourceMap.entries.map((entry) => ({
      ...entry,
      evidenceSha256: replayBundleSha256
    }))
  };
  const replayMapSha256 = fingerprintCanonicalArtifact(replayMap);
  const replayWrapper = {
    ...sourceWrapper,
    runId: REPLAY_RUN_ID,
    addressHistoryManifestSha256: replayManifestSha256,
    sourceEventRoleMapV1Sha256: replayMapSha256,
    evidenceBundleSha256: replayBundleSha256
  };
  const replayWrapperSha256 = fingerprintCanonicalArtifact(replayWrapper);
  const replayIdentity = {
    schemaVersion: "service-role-shadow-runtime-replay-identity-v1",
    testedSourceCommit: TESTED_COMMIT,
    replayInputSha256,
    replay: {
      runId: REPLAY_RUN_ID,
      requestId: "22222222-2222-4222-8222-222222222222",
      analysisManifestSha256,
      directHistoryTaskId: "replay-direct-history-task",
      directHistoryAttemptId: "replay-direct-history-attempt",
      traversalTaskId: "replay-traversal-task",
      acceptedAttemptId: "replay-history-attempt",
      runtimeCommit: TESTED_COMMIT
    },
    plannerEntryMapping: {
      source: replayInput.acceptedPlannerEntry,
      replay: {
        canonicalSequence: 0,
        taskId: "replay-history-task",
        acceptedAttemptId: "replay-history-attempt",
        manifestKey: finalSourceManifest.key,
        artifactSha256: replayManifestSha256
      }
    },
    sourceTargetDeltaSha256: sourceDeltaSha256,
    derivedSourcePredecessorCheckpoint: {
      sha256: fingerprintCanonicalArtifact(derivedSourcePredecessorCheckpoint),
      checkpointJson: derivedSourcePredecessorCheckpoint
    },
    translatedTraversalAuthority: {
      analysisManifest: {
        kind: "analysis_manifest",
        schemaVersion: "1",
        sha256: analysisManifestSha256,
        artifactJson: analysisManifest
      },
      compaction: {
        kind: "traversal_compaction_v2",
        schemaVersion: "1",
        sha256: replayCompactionSha256,
        artifactJson: replayCompaction
      },
      predecessorCheckpoint: {
        sha256: fingerprintCanonicalArtifact(replayPredecessorCheckpoint),
        checkpointJson: replayPredecessorCheckpoint
      }
    },
    translatedAcceptedHistory: {
      pages: [{
        kind: "address_history_page",
        schemaVersion: "1",
        sha256: replayPageSha256,
        artifactJson: replayPage
      }],
      manifest: {
        kind: "address_history_manifest",
        schemaVersion: "1",
        sha256: replayManifestSha256,
        artifactJson: replayManifest
      }
    },
    translatedShadowInputs: {
      evidenceBundle: {
        kind: "service_role_event_evidence_bundle",
        schemaVersion: "1",
        sha256: replayBundleSha256,
        artifactJson: replayBundle
      },
      eventRoleMapV1: {
        kind: "service_role_event_role_map",
        schemaVersion: "1",
        sha256: replayMapSha256,
        artifactJson: replayMap
      },
      eventRoleMapV2: {
        kind: "service_role_event_role_map",
        schemaVersion: "2",
        sha256: replayWrapperSha256,
        artifactJson: replayWrapper
      }
    },
    productionEffect: false
  } as const;
  const replayIdentitySha256 = fingerprintCanonicalArtifact(replayIdentity);

  const inputSet = buildServiceRoleShadowInputSetV1({
    runId: REPLAY_RUN_ID,
    snapshotHash: SNAPSHOT_HASH,
    roleMapV2Sha256s: [replayWrapperSha256]
  });
  const fence = buildServiceRoleShadowInputFenceV1({
    runId: REPLAY_RUN_ID,
    snapshotHash: SNAPSHOT_HASH,
    runtimeCommit: TESTED_COMMIT,
    outcome: {
      kind: "ready",
      inputSetSha256: inputSet.sha256,
      roleMapV2Sha256s: [replayWrapperSha256]
    }
  });
  const profiles = sourceStates.map((state) => {
    const built = maybeBuildServiceRoleShadowArtifactV1({
      mode: "service-role-shadow-100-plus-100-v1",
      runId: REPLAY_RUN_ID,
      snapshotHash: SNAPSHOT_HASH,
      subjectAddress: SUBJECT,
      state,
      acceptedHistory: {
        manifestKey: replayManifest.key,
        manifestSha256: replayManifestSha256,
        pageArtifactHashes: [replayPageSha256],
        events
      },
      eventRoleMap: { sha256: replayMapSha256, artifact: replayMap }
    });
    if (!built || built.artifact.result.insufficientReason !== null) {
      throw new Error("acceptance_fixture_profile_missing");
    }
    return { ...built, traversalStateId: traversalStateId(state) };
  }).sort((left, right) => left.traversalStateId.localeCompare(
    right.traversalStateId
  ));
  const candidateDelta = sourceDelta;
  const candidateDeltaSha256 = sourceDeltaSha256;
  const committedCheckpoint = {
    ...appendedSource.checkpoint,
    analysisManifestHash: analysisManifestSha256,
    compactionSha256: replayCompactionSha256,
    deltaHeadSha256: candidateDeltaSha256,
  };
  const precommit = buildServiceRoleShadowPrecommitReceiptV1({
    runId: REPLAY_RUN_ID,
    snapshotHash: SNAPSHOT_HASH,
    inputFenceSha256: fence.sha256,
    inputSetSha256: inputSet.sha256,
    manifestKey: replayManifest.key,
    manifestSha256: replayManifestSha256,
    acceptedPageArtifactHashes: [replayPageSha256],
    candidateCheckpointSha256: fingerprintCanonicalArtifact(committedCheckpoint),
    candidateDeltaSha256,
    compoundBindingKey: serviceRoleShadowCompoundBindingKeyV1(replayWrapper),
    profiles: profiles.map((profile) => ({
      traversalStateId: profile.traversalStateId,
      shadowStateId: profile.artifact.traversalStateId,
      profileSha256: profile.sha256,
      wrapperSha256: replayWrapperSha256
    }))
  });
  const committedEntry = {
    canonicalSequence: replayIdentity.plannerEntryMapping.replay.canonicalSequence,
    taskId: replayIdentity.plannerEntryMapping.replay.taskId,
    acceptedAttemptId: replayIdentity.plannerEntryMapping.replay.acceptedAttemptId,
    artifactSha256: replayIdentity.plannerEntryMapping.replay.artifactSha256
  };
  const receipt = buildServiceRoleShadowRuntimeReceiptV1({
    runId: REPLAY_RUN_ID,
    snapshotHash: SNAPSHOT_HASH,
    runtimeCommit: TESTED_COMMIT,
    traversalTaskId: replayIdentity.replay.traversalTaskId,
    traversalAttempt: 1,
    inputFenceSha256: fence.sha256,
    inputSetSha256: inputSet.sha256,
    compoundBindingKey: precommit.artifact.compoundBindingKey,
    precommitSha256: precommit.sha256,
    manifestKey: replayManifest.key,
    manifestSha256: replayManifestSha256,
    acceptedPageArtifactHashes: [replayPageSha256],
    candidateCheckpointSha256: fingerprintCanonicalArtifact(committedCheckpoint),
    candidateDeltaSha256,
    committedCheckpointSha256: fingerprintCanonicalArtifact(committedCheckpoint),
    committedDeltaHeadSha256: candidateDeltaSha256,
    committedEntries: [committedEntry],
    profiles: precommit.artifact.profiles
  });
  const runtimeArtifacts = [
    { kind: "service_role_shadow_input_set", schemaVersion: "1", sha256: inputSet.sha256, artifactJson: inputSet.artifact },
    { kind: "service_role_shadow_input_fence", schemaVersion: "1", sha256: fence.sha256, artifactJson: fence.artifact },
    ...profiles.map((profile) => ({ kind: "service_role_shadow_profile", schemaVersion: "1", sha256: profile.sha256, artifactJson: profile.artifact })),
    { kind: "service_role_shadow_precommit_receipt", schemaVersion: "1", sha256: precommit.sha256, artifactJson: precommit.artifact },
    { kind: "service_role_shadow_runtime_receipt", schemaVersion: "1", sha256: receipt.sha256, artifactJson: receipt.artifact }
  ].sort((left, right) => `${left.kind}:${left.sha256}`.localeCompare(`${right.kind}:${right.sha256}`));
  const directHistory = {
    version: "unified-direct-history-v1",
    schemaVersion: 1,
    runId: REPLAY_RUN_ID,
    analysisManifestHash: analysisManifestSha256,
    snapshotHash: SNAPSHOT_HASH,
    pageArtifactHashes: [],
    eventIndexHash: fingerprintCanonicalArtifact([]),
    eventCount: 0,
    reachedAccountCreation: true
  };
  const directHistorySha256 = fingerprintCanonicalArtifact(directHistory);
  const storedTask = (input: {
    readonly id: string;
    readonly kind: string;
    readonly status: string;
    readonly attempt: number;
    readonly acceptedAttemptId: string | null;
    readonly logicalKey: string;
    readonly checkpointJson: unknown;
  }) => ({
    accepted_attempt_id: input.acceptedAttemptId,
    attempt: input.attempt,
    cancellation_requested_at: null,
    checkpoint_json: input.checkpointJson,
    created_at: storedAt,
    heartbeat_at: null,
    id: input.id,
    kind: input.kind,
    last_error: null,
    lease_expires_at: null,
    lease_owner: null,
    lease_token: null,
    logical_key: input.logicalKey,
    priority_lane: "interactive",
    ready_at: storedAt,
    run_id: REPLAY_RUN_ID,
    status: input.status,
    updated_at: storedAt
  });
  const continuationTaskId = "replay-continuation-task";
  const directTaskRow = storedTask({
    id: replayIdentity.replay.directHistoryTaskId,
    kind: "direct_history",
    status: "COMPLETED",
    attempt: 1,
    acceptedAttemptId: replayIdentity.replay.directHistoryAttemptId,
    logicalKey: "main",
    checkpointJson: {}
  });
  const historyTaskRow = storedTask({
    id: replayIdentity.plannerEntryMapping.replay.taskId,
    kind: "address_history",
    status: "COMPLETED",
    attempt: 1,
    acceptedAttemptId: committedEntry.acceptedAttemptId,
    logicalKey: replayIdentity.plannerEntryMapping.replay.manifestKey,
    checkpointJson: {}
  });
  const traversalTaskRow = storedTask({
    id: replayIdentity.replay.traversalTaskId,
    kind: "traversal",
    status: "QUEUED",
    attempt: 1,
    acceptedAttemptId: null,
    logicalKey: "main",
    checkpointJson: committedCheckpoint
  });
  const continuationCheckpoint = {
    version: "unified-address-history-checkpoint-v2",
    identity: {
      chain: "tron" as const,
      snapshotHash: SNAPSHOT_HASH,
      tokenContract: TRON_USDT_CONTRACT_ADDRESS,
      address: SUBJECT,
      providerRequestVersion: "tronscan-related-trc20-v1"
    },
    history: null,
    pageCount: 0,
    rawRowCount: 0,
    chunkCount: 0,
    chunkHeadSha256: null
  };
  const continuationTaskRow = storedTask({
    id: continuationTaskId,
    kind: "address_history",
    status: "QUEUED",
    attempt: 0,
    acceptedAttemptId: null,
    logicalKey: addressHistoryManifestKey(continuationCheckpoint.identity),
    checkpointJson: continuationCheckpoint
  });
  const inheritedContinuationTaskId = "replay-inherited-continuation-task";
  const inheritedContinuationCheckpoint = {
    ...continuationCheckpoint,
    identity: {
      ...continuationCheckpoint.identity,
      address: inheritedState.address
    }
  };
  const inheritedContinuationTaskRow = storedTask({
    id: inheritedContinuationTaskId,
    kind: "address_history",
    status: "QUEUED",
    attempt: 0,
    acceptedAttemptId: null,
    logicalKey: addressHistoryManifestKey(inheritedContinuationCheckpoint.identity),
    checkpointJson: inheritedContinuationCheckpoint
  });
  const projection = {
    provider: { callCount: 0, calls: [], cacheDecisions: [] },
    requests: [{
      accepted_at: storedAt,
      attempt_count: 0,
      chat_id: "stage-c1",
      created_at: storedAt,
      id: replayIdentity.replay.requestId,
      locale: "en",
      message_thread_id: "stage-c1",
      ready_at: storedAt,
      request_correlation_id: replayIdentity.replay.requestId,
      run_id: REPLAY_RUN_ID,
      run_purpose: "synthetic_test",
      side_effect_policy: "isolated",
      status: "ATTACHED",
      status_reason: null,
      subject_address: SUBJECT
    }],
    runs: [{
      admission_policy: "barrier",
      analysis_key_sha256: fingerprintCanonicalArtifact([
        "stage-c1-replay", REPLAY_RUN_ID
      ]),
      analysis_manifest_sha256: analysisManifestSha256,
      completed_at: null,
      created_at: storedAt,
      evidence_bundle_sha256: null,
      fairness_owner_id: REPLAY_RUN_ID,
      final_decision: null,
      final_score: null,
      id: REPLAY_RUN_ID,
      provider_capacity_ceiling: 1,
      report_sha256: null,
      rollout_bucket: null,
      rollout_stage: "global_barrier",
      run_purpose: "synthetic_test",
      scoring_bundle_sha256: null,
      side_effect_policy: "isolated",
      status: "RUNNING",
      status_reason: null,
      subject_address: SUBJECT,
      traversal_closure_sha256: null,
      updated_at: storedAt
    }],
    tasks: [historyTaskRow, inheritedContinuationTaskRow, continuationTaskRow, directTaskRow, traversalTaskRow],
    checkpoints: [{
      taskId: replayIdentity.replay.traversalTaskId,
      traversalAttempt: 1,
      checkpointJson: committedCheckpoint,
      taskRow: traversalTaskRow
    }],
    planner: [
      {
        admitted_at: storedAt,
        canonical_sequence: committedEntry.canonicalSequence,
        committed_at: storedAt,
        planned_at: storedAt,
        planner_state: "committed",
        ready_at: storedAt,
        reserved_bytes: null,
        result_bytes: Buffer.byteLength(
          canonicalizeArtifactJson(replayManifest),
          "utf8"
        ),
        run_id: REPLAY_RUN_ID,
        task_id: committedEntry.taskId
      },
      {
        admitted_at: storedAt,
        canonical_sequence: committedEntry.canonicalSequence + 1,
        committed_at: null,
        planned_at: storedAt,
        planner_state: "planned",
        ready_at: null,
        reserved_bytes: 1_048_576,
        result_bytes: null,
        run_id: REPLAY_RUN_ID,
        task_id: inheritedContinuationTaskId
      },
      {
        admitted_at: null,
        canonical_sequence: committedEntry.canonicalSequence + 2,
        committed_at: null,
        planned_at: storedAt,
        planner_state: "planned",
        ready_at: null,
        reserved_bytes: null,
        result_bytes: null,
        run_id: REPLAY_RUN_ID,
        task_id: continuationTaskId
      }
    ],
    attempts: [
      {
        artifact_sha256: directHistorySha256,
        attempt: 1,
        completed_at: storedAt,
        id: replayIdentity.replay.directHistoryAttemptId,
        task_id: replayIdentity.replay.directHistoryTaskId
      },
      {
        artifact_sha256: committedEntry.artifactSha256,
        attempt: 1,
        completed_at: storedAt,
        id: committedEntry.acceptedAttemptId,
        task_id: committedEntry.taskId
      }
    ],
    artifacts: [
      { sha256: analysisManifestSha256, kind: "analysis_manifest", schema_version: "1", artifact_json: analysisManifest },
      { sha256: directHistorySha256, kind: "direct_history", schema_version: "1", artifact_json: directHistory },
      { sha256: replayCompactionSha256, kind: "traversal_compaction_v2", schema_version: "1", artifact_json: replayCompaction },
      { sha256: replayManifestSha256, kind: "address_history_manifest", schema_version: "1", artifact_json: replayManifest },
      { sha256: replayPageSha256, kind: "address_history_page", schema_version: "1", artifact_json: replayPage },
      { sha256: replayBundleSha256, kind: "service_role_event_evidence_bundle", schema_version: "1", artifact_json: replayBundle },
      { sha256: replayMapSha256, kind: "service_role_event_role_map", schema_version: "1", artifact_json: replayMap },
      { sha256: replayWrapperSha256, kind: "service_role_event_role_map", schema_version: "2", artifact_json: replayWrapper },
      { sha256: candidateDeltaSha256, kind: "traversal_delta", schema_version: "1", artifact_json: candidateDelta }
    ].map((artifact) => ({
      ...artifact,
      created_by_run_id: REPLAY_RUN_ID,
      created_at: storedAt
    })).sort((left, right) => {
      const leftKey = `${left.kind}\0${left.schema_version}\0${left.sha256}`;
      const rightKey = `${right.kind}\0${right.schema_version}\0${right.sha256}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    }),
    reports: [], presentations: [], deliveries: [], providerPages: [],
    labelDatasets: [{
      sha256: frozenLabels.sha256,
      dataset_json: frozenLabels.dataset,
      created_at: storedAt
    }],
    generationFence: [], deliveryOwnership: [], runtimeInstances: [], notifications: []
  };
  const projectionSha256 = fingerprintCanonicalArtifact(projection);
  const acceptance = {
    schemaVersion: "service-role-shadow-c1-acceptance-v1",
    testedSourceCommit: TESTED_COMMIT,
    replayInput,
    replayInputSha256,
    replayIdentity,
    replayIdentitySha256,
    disabledAuthoritativeProjection: projection,
    disabledAuthoritativeProjectionSha256: projectionSha256,
    enabledAuthoritativeProjection: structuredClone(projection),
    enabledAuthoritativeProjectionSha256: projectionSha256,
    runtimeArtifacts,
    counters: {
      disabledProviderCalls: 0,
      enabledProviderCalls: 0,
      disabledShadowReferences: 0,
      enabledShadowReferences: 0
    },
    cardinalities: {
      inputSet: 1,
      inputFence: 1,
      profile: 7,
      precommit: 1,
      runtimeReceipt: 1,
      runSummary: 0
    },
    productionEffect: false
  } as const;
  return { replayInput, replayIdentity, acceptance };
}

describe("Stage C1 runtime acceptance contracts", () => {
  it("reserves the larger canonical node budget for the self-contained root", () => {
    const values = Array<null>(2_000_000).fill(null);
    expect(() => canonicalizeArtifactJson({ values })).toThrow(
      "Canonical JSON exceeds node limit"
    );
    const canonical = canonicalizeLargeArtifactJson({ values });
    expect(canonical.length).toBe(
      canonicalizeLargeArtifactJson({ values: [] }).length +
        values.length * 4 + values.length - 1
    );
  });

  it("exposes the owning acceptance parser and canonical serializer", () => {
    expect(parseServiceRoleShadowC1AcceptanceV1).toBeTypeOf("function");
    expect(serializeServiceRoleShadowC1AcceptanceV1).toBeTypeOf("function");
  });

  it("exposes the strict CLI parser and injected Git-state guard", () => {
    expect(parseServiceRoleShadowRuntimeAcceptanceCommand).toBeTypeOf("function");
    expect(runServiceRoleShadowRuntimeAcceptanceCli).toBeTypeOf("function");
    expect(verifyServiceRoleShadowRuntimeGitStateV1).toBeTypeOf("function");
  });

  it("reads inputs above the obsolete 32 MiB ceiling and budgets the self-contained root", async () => {
    expect(SERVICE_ROLE_SHADOW_RUNTIME_ACCEPTANCE_MAX_FILE_BYTES)
      .toBe(512 * 1024 * 1024);
    const directory = await mkdtemp(resolve(".stage-c1-read-limit-"));
    const path = resolve(directory, "oversized-for-old-limit.json");
    const handle = await open(path, "w");
    try {
      await handle.truncate(33 * 1024 * 1024);
    } finally {
      await handle.close();
    }
    let failure: unknown;
    try {
      await runServiceRoleShadowRuntimeAcceptanceCli([
        "verify-acceptance", "--acceptance", path
      ]);
    } catch (error) {
      failure = error;
    } finally {
      await unlink(path);
      await rmdir(directory);
    }
    expect(failure).toBeInstanceOf(SyntaxError);
    expect(String(failure)).not.toContain(
      "service_role_shadow_runtime_acceptance_file_invalid"
    );
  });

  it("rejects malformed UTF-8 before JSON parsing", async () => {
    const directory = await mkdtemp(resolve(".stage-c1-invalid-utf8-"));
    const path = resolve(directory, "acceptance.json");
    const handle = await open(path, "w");
    try {
      await handle.write(Uint8Array.from([0xc3, 0x28]));
    } finally {
      await handle.close();
    }
    let failure: unknown;
    try {
      await runServiceRoleShadowRuntimeAcceptanceCli([
        "verify-acceptance", "--acceptance", path
      ]);
    } catch (error) {
      failure = error;
    } finally {
      await unlink(path);
      await rmdir(directory);
    }
    expect(failure).toBeInstanceOf(TypeError);
    expect(String(failure)).toMatch(/not valid.*utf-8/iu);
  });

  it("verify-acceptance reads only its root, emits one canonical proof line, and skips Git and DB", async () => {
    const fixture = acceptanceFixture();
    const acceptanceBytes = serializeServiceRoleShadowC1AcceptanceV1(fixture.acceptance);
    const events: string[] = [];
    let output = "";
    await runServiceRoleShadowRuntimeAcceptanceCli([
      "verify-acceptance", "--acceptance", "acceptance.json"
    ], {
      repoRoot: "C:/repo",
      scriptPath: "C:/repo/scripts/replayServiceRoleShadowRuntimeAcceptance.ts",
      env: {},
      readArtifactFile: async (path) => {
        events.push(`read:${path}`);
        if (path !== "acceptance.json") throw new Error("neighbor_read");
        return acceptanceBytes;
      },
      verifyGitState: async () => { throw new Error("git_called"); },
      reserveOutputRoot: async () => { throw new Error("output_called"); },
      reserveOutputFile: async () => { throw new Error("output_called"); },
      prepareFromDatabase: async () => { throw new Error("db_called"); },
      replayFromDatabase: async () => { throw new Error("db_called"); },
      writeStdout: (bytes) => { output += bytes; }
    });
    expect(events).toEqual(["read:acceptance.json"]);
    expect(output).toBe(`${canonicalizeArtifactJson({
      schemaVersion: "service-role-shadow-c1-acceptance-proof-v1",
      testedSourceCommit: TESTED_COMMIT,
      replayInputSha256: fixture.acceptance.replayInputSha256,
      replayIdentitySha256: fixture.acceptance.replayIdentitySha256,
      acceptanceSha256: fingerprintCanonicalArtifact(fixture.acceptance)
    })}\n`);
  });

  it("verify-input reads exactly its two bodies, enforces Git, and emits one canonical proof line", async () => {
    const fixture = acceptanceFixture();
    const inputBytes = serializeServiceRoleShadowRuntimeReplayInputV1(fixture.replayInput);
    const identityBytes = serializeServiceRoleShadowRuntimeReplayIdentityV1(fixture.replayIdentity);
    const events: string[] = [];
    let output = "";
    await runServiceRoleShadowRuntimeAcceptanceCli([
      "verify-input", "--input", "input.json", "--identity", "identity.json"
    ], {
      repoRoot: "C:/repo",
      scriptPath: "C:/repo/scripts/replayServiceRoleShadowRuntimeAcceptance.ts",
      env: {},
      readArtifactFile: async (path) => {
        events.push(`read:${path}`);
        if (path === "input.json") return inputBytes;
        if (path === "identity.json") return identityBytes;
        throw new Error("neighbor_read");
      },
      verifyGitState: async (input) => {
        events.push(`git:${input.mode}:${input.allowedUntrackedFiles.length}`);
      },
      reserveOutputRoot: async () => { throw new Error("output_called"); },
      reserveOutputFile: async () => { throw new Error("output_called"); },
      prepareFromDatabase: async () => { throw new Error("db_called"); },
      replayFromDatabase: async () => { throw new Error("db_called"); },
      writeStdout: (bytes) => { output += bytes; }
    });
    expect(events).toEqual([
      "read:input.json",
      "read:identity.json",
      "git:verify-input:2"
    ]);
    expect(output).toBe(`${canonicalizeArtifactJson({
      schemaVersion: "service-role-shadow-runtime-replay-input-proof-v1",
      testedSourceCommit: TESTED_COMMIT,
      replayInputSha256: fixture.acceptance.replayInputSha256,
      replayIdentitySha256: fixture.acceptance.replayIdentitySha256
    })}\n`);
  });

  it("reserves prepare and replay outputs before either PostgreSQL domain runner", async () => {
    const fixture = acceptanceFixture();
    const inputBytes = serializeServiceRoleShadowRuntimeReplayInputV1(fixture.replayInput);
    const identityBytes = serializeServiceRoleShadowRuntimeReplayIdentityV1(fixture.replayIdentity);
    const events: string[] = [];
    const base = {
      repoRoot: "C:/repo",
      scriptPath: "C:/repo/scripts/replayServiceRoleShadowRuntimeAcceptance.ts",
      env: { DATABASE_URL: "postgres://acceptance" },
      readArtifactFile: async (path: string) => path === "input.json" ? inputBytes : identityBytes,
      verifyGitState: async (input: { readonly mode: string }) => { events.push(`git:${input.mode}`); },
      reserveOutputRoot: async () => {
        events.push("reserve:root");
        return {
          publish: async () => { events.push("publish:root"); },
          abort: async () => { events.push("abort:root"); }
        };
      },
      reserveOutputFile: async () => {
        events.push("reserve:file");
        return {
          publish: async () => { events.push("publish:file"); },
          abort: async () => { events.push("abort:file"); }
        };
      },
      prepareFromDatabase: async () => {
        events.push("db:prepare");
        return { replayInput: fixture.replayInput, replayIdentity: fixture.replayIdentity };
      },
      replayFromDatabase: async () => {
        events.push("db:replay");
        return fixture.acceptance;
      },
      writeStdout: () => undefined
    };
    await runServiceRoleShadowRuntimeAcceptanceCli([
      "prepare", "--run", SOURCE_RUN_ID, "--manifest",
      fixture.replayInput.sourceAddressHistoryManifestSha256,
      "--anchor", "2026-06-04T09:20:33.000Z", "--tested-source-commit", TESTED_COMMIT,
      "--output-root", "out", "--confirm"
    ], base);
    expect(events).toEqual(["git:prepare", "reserve:root", "db:prepare", "publish:root"]);
    events.length = 0;
    await runServiceRoleShadowRuntimeAcceptanceCli([
      "replay", "--input", "input.json", "--identity", "identity.json",
      "--output", "acceptance.json", "--confirm"
    ], base);
    expect(events).toEqual(["git:replay", "reserve:file", "db:replay", "publish:file"]);
  });

  it("extracts a deterministic read-only prepare pair in exactly two queries", async () => {
    const fixture = acceptanceFixture();
    const command = {
      kind: "prepare" as const,
      runId: SOURCE_RUN_ID,
      manifestSha256: fixture.replayInput.sourceAddressHistoryManifestSha256,
      anchor: fixture.replayInput.sourceAnchor,
      testedSourceCommit: TESTED_COMMIT,
      outputRoot: "out",
      confirm: true as const
    };
    const authorityRows = [{
      run_status: "FAILED_TECHNICAL",
      analysis_json: fixture.replayInput.sourceArtifacts.find((row) =>
        row.kind === "analysis_manifest"
      )!.artifactJson,
      label_dataset_json: fixture.replayInput.sourceFrozenLabelDataset.datasetJson,
      traversal_task_status: "CANCELLED",
      checkpoint_json: fixture.replayInput.observedTraversalCheckpoint.checkpointJson,
      history_task_id: fixture.replayInput.acceptedPlannerEntry.taskId,
      history_task_status: "COMPLETED",
      logical_key: fixture.replayInput.acceptedPlannerEntry.manifestKey,
      accepted_attempt_id: fixture.replayInput.acceptedPlannerEntry.acceptedAttemptId,
      history_artifact_sha256: fixture.replayInput.acceptedPlannerEntry.artifactSha256,
      canonical_sequence: fixture.replayInput.acceptedPlannerEntry.canonicalSequence,
      planner_state: "committed"
    }];
    const artifactRows = fixture.replayInput.sourceArtifacts.map((row) => ({
      sha256: row.sha256,
      kind: row.kind,
      schema_version: row.schemaVersion,
      artifact_json: row.artifactJson
    }));
    const queries: string[] = [];
    const result = await extractServiceRoleShadowRuntimeAcceptancePrepareV1({
      command,
      db: {
        query: async (sql) => {
          queries.push(sql);
          return { rows: queries.length === 1 ? authorityRows : artifactRows };
        }
      }
    });
    expect(queries).toHaveLength(2);
    expect(queries[0]).toContain("from unified_check_runs run");
    expect(queries[1]).toContain("from unified_check_artifacts artifact");
    expect(result.replayInput).toMatchObject({
      sourceRunId: SOURCE_RUN_ID,
      sourceRunStatus: "FAILED_TECHNICAL",
      sourceTraversalTaskStatus: "CANCELLED",
      qualifyingTraversalStateIds: fixture.replayInput.qualifyingTraversalStateIds
    });
    expect(result.replayIdentity.replay.runId).not.toBe(SOURCE_RUN_ID);
    expect(result.replayIdentity.replay.runtimeCommit).toBe(TESTED_COMMIT);
    const repeated = await extractServiceRoleShadowRuntimeAcceptancePrepareV1({
      command,
      db: { query: async (sql) => ({
        rows: sql.includes("from unified_check_runs run") ? authorityRows : artifactRows
      }) }
    });
    expect(result.replayIdentity).toEqual(repeated.replayIdentity);
  });

  it("fails prepare closed on absent authority, status mismatch, and broken source closure", () => {
    const fixture = acceptanceFixture();
    const command = {
      kind: "prepare" as const,
      runId: SOURCE_RUN_ID,
      manifestSha256: fixture.replayInput.sourceAddressHistoryManifestSha256,
      anchor: fixture.replayInput.sourceAnchor,
      testedSourceCommit: TESTED_COMMIT,
      outputRoot: "out",
      confirm: true as const
    };
    const authority = {
      run_status: "FAILED_TECHNICAL",
      analysis_json: fixture.replayInput.sourceArtifacts.find((row) =>
        row.kind === "analysis_manifest"
      )!.artifactJson,
      label_dataset_json: fixture.replayInput.sourceFrozenLabelDataset.datasetJson,
      traversal_task_status: "CANCELLED",
      checkpoint_json: fixture.replayInput.observedTraversalCheckpoint.checkpointJson,
      history_task_id: fixture.replayInput.acceptedPlannerEntry.taskId,
      history_task_status: "COMPLETED",
      logical_key: fixture.replayInput.acceptedPlannerEntry.manifestKey,
      accepted_attempt_id: fixture.replayInput.acceptedPlannerEntry.acceptedAttemptId,
      history_artifact_sha256: fixture.replayInput.acceptedPlannerEntry.artifactSha256,
      canonical_sequence: fixture.replayInput.acceptedPlannerEntry.canonicalSequence,
      planner_state: "committed"
    };
    const artifacts = fixture.replayInput.sourceArtifacts.map((row) => ({
      sha256: row.sha256,
      kind: row.kind,
      schema_version: row.schemaVersion,
      artifact_json: row.artifactJson
    }));
    const build = (authorityRows: readonly any[], artifactRows = artifacts) =>
      buildServiceRoleShadowRuntimeAcceptancePrepareContractsV1({
        command,
        authorityRows,
        artifactRows
      });
    expect(() => build([])).toThrow("service_role_shadow_runtime_prepare_source_absent");
    expect(() => build([{ ...authority, run_status: "RUNNING" }])).toThrow(
      "service_role_shadow_runtime_prepare_source_authority_invalid"
    );
    expect(() => build([authority], artifacts.filter((row) =>
      row.kind !== "service_role_event_evidence_bundle"
    ))).toThrow("service_role_shadow_runtime_prepare_role_invalid");
  });

  it("runs disabled and enabled in distinct disposable schemas and always drops both", async () => {
    const fixture = acceptanceFixture();
    const names = [
      `stage_c1_runtime_${"1".repeat(32)}`,
      `stage_c1_runtime_${"2".repeat(32)}`
    ];
    const events: string[] = [];
    const acceptance = await runServiceRoleShadowRuntimeAcceptanceReplayV1({
      databaseUrl: "postgres://acceptance",
      replayInput: fixture.replayInput,
      replayIdentity: fixture.replayIdentity,
      createSchemaName: () => names.shift()!,
      database: {
        schemaExists: async ({ schema }) => {
          events.push(`exists:${schema}`);
          return false;
        },
        createSchema: async ({ schema }) => { events.push(`create:${schema}`); },
        runVariant: async ({ schema, variant, replayIdentity }) => {
          events.push(`run:${variant}:${schema}:${replayIdentity.replay.runId}`);
          return {
            authoritativeProjection: fixture.acceptance.enabledAuthoritativeProjection,
            runtimeArtifacts: variant === "enabled"
              ? fixture.acceptance.runtimeArtifacts
              : [],
            providerCalls: 0,
            shadowReferences: 0
          };
        },
        dropSchema: async ({ schema }) => { events.push(`drop:${schema}`); }
      }
    });
    expect(parseServiceRoleShadowC1AcceptanceV1(acceptance)).toEqual(acceptance);
    expect(events).toEqual([
      `exists:stage_c1_runtime_${"1".repeat(32)}`,
      `exists:stage_c1_runtime_${"2".repeat(32)}`,
      `create:stage_c1_runtime_${"1".repeat(32)}`,
      `run:disabled:stage_c1_runtime_${"1".repeat(32)}:${REPLAY_RUN_ID}`,
      `create:stage_c1_runtime_${"2".repeat(32)}`,
      `run:enabled:stage_c1_runtime_${"2".repeat(32)}:${REPLAY_RUN_ID}`,
      `drop:stage_c1_runtime_${"2".repeat(32)}`,
      `drop:stage_c1_runtime_${"1".repeat(32)}`
    ]);
  });

  it("refuses an existing replay schema and cleans exact created schemas after variant failure", async () => {
    const fixture = acceptanceFixture();
    const schema1 = `stage_c1_runtime_${"3".repeat(32)}`;
    const schema2 = `stage_c1_runtime_${"4".repeat(32)}`;
    const existingEvents: string[] = [];
    let nameIndex = 0;
    await expect(runServiceRoleShadowRuntimeAcceptanceReplayV1({
      databaseUrl: "postgres://acceptance",
      replayInput: fixture.replayInput,
      replayIdentity: fixture.replayIdentity,
      createSchemaName: () => [schema1, schema2][nameIndex++]!,
      database: {
        schemaExists: async ({ schema }) => {
          existingEvents.push(`exists:${schema}`);
          return true;
        },
        createSchema: async () => { throw new Error("create_called"); },
        runVariant: async () => { throw new Error("run_called"); },
        dropSchema: async () => { throw new Error("drop_called"); }
      }
    })).rejects.toThrow("service_role_shadow_runtime_acceptance_schema_exists");
    expect(existingEvents).toEqual([`exists:${schema1}`]);

    const cleanupEvents: string[] = [];
    const names = [schema1, schema2];
    await expect(runServiceRoleShadowRuntimeAcceptanceReplayV1({
      databaseUrl: "postgres://acceptance",
      replayInput: fixture.replayInput,
      replayIdentity: fixture.replayIdentity,
      createSchemaName: () => names.shift()!,
      database: {
        schemaExists: async () => false,
        createSchema: async ({ schema }) => { cleanupEvents.push(`create:${schema}`); },
        runVariant: async ({ variant }) => {
          cleanupEvents.push(`run:${variant}`);
          if (variant === "enabled") throw new Error("enabled_failed");
          return {
            authoritativeProjection: fixture.acceptance.disabledAuthoritativeProjection,
            runtimeArtifacts: [],
            providerCalls: 0,
            shadowReferences: 0
          };
        },
        dropSchema: async ({ schema }) => { cleanupEvents.push(`drop:${schema}`); }
      }
    })).rejects.toThrow("enabled_failed");
    expect(cleanupEvents.slice(-2)).toEqual([`drop:${schema2}`, `drop:${schema1}`]);
  });

  it("rejects an existing replay output before the database runner", async () => {
    const fixture = acceptanceFixture();
    let databaseCalled = false;
    await expect(runServiceRoleShadowRuntimeAcceptanceCli([
      "replay", "--input", "input.json", "--identity", "identity.json",
      "--output", "existing.json", "--confirm"
    ], {
      repoRoot: "C:/repo",
      scriptPath: "C:/repo/scripts/replayServiceRoleShadowRuntimeAcceptance.ts",
      env: { DATABASE_URL: "postgres://acceptance" },
      readArtifactFile: async (path) => path === "input.json"
        ? serializeServiceRoleShadowRuntimeReplayInputV1(fixture.replayInput)
        : serializeServiceRoleShadowRuntimeReplayIdentityV1(fixture.replayIdentity),
      verifyGitState: async () => undefined,
      reserveOutputRoot: async () => { throw new Error("unexpected_root"); },
      reserveOutputFile: async () => { throw new Error("output_exists"); },
      prepareFromDatabase: async () => { throw new Error("unexpected_prepare"); },
      replayFromDatabase: async () => {
        databaseCalled = true;
        return fixture.acceptance;
      },
      writeStdout: () => undefined
    })).rejects.toThrow("output_exists");
    expect(databaseCalled).toBe(false);
  });

  it("runs the same contracts through real disposable PostgreSQL when configured", async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (!databaseUrl) {
      expect(replayServiceRoleShadowRuntimeAcceptanceFromDatabase).toBeTypeOf("function");
      return;
    }
    const fixture = acceptanceFixture();
    const acceptance = await replayServiceRoleShadowRuntimeAcceptanceFromDatabase({
      databaseUrl,
      replayInput: fixture.replayInput,
      replayIdentity: fixture.replayIdentity
    });
    expect(parseServiceRoleShadowC1AcceptanceV1(acceptance)).toEqual(acceptance);
    expect(acceptance.runtimeArtifacts).toHaveLength(11);
    expect(acceptance.counters).toEqual({
      disabledProviderCalls: 0,
      enabledProviderCalls: 0,
      disabledShadowReferences: 0,
      enabledShadowReferences: 0
    });
  });

  it("parses exactly four strict command forms", () => {
    expect(parseServiceRoleShadowRuntimeAcceptanceCommand([
      "prepare",
      "--run", SOURCE_RUN_ID,
      "--manifest", "a".repeat(64),
      "--anchor", "2026-06-04T09:20:33.000Z",
      "--tested-source-commit", TESTED_COMMIT,
      "--output-root", "docs/audit/2026-07-stage-c/c1",
      "--confirm"
    ])).toMatchObject({ kind: "prepare", runId: SOURCE_RUN_ID, confirm: true });
    expect(parseServiceRoleShadowRuntimeAcceptanceCommand([
      "verify-input", "--input", "input.json", "--identity", "identity.json"
    ])).toEqual({ kind: "verify-input", inputPath: "input.json", identityPath: "identity.json" });
    expect(parseServiceRoleShadowRuntimeAcceptanceCommand([
      "replay", "--input", "input.json", "--identity", "identity.json",
      "--output", "acceptance.json", "--confirm"
    ])).toMatchObject({ kind: "replay", confirm: true });
    expect(parseServiceRoleShadowRuntimeAcceptanceCommand([
      "verify-acceptance", "--acceptance", "acceptance.json"
    ])).toEqual({ kind: "verify-acceptance", acceptancePath: "acceptance.json" });
  });

  it("rejects unknown, duplicate, missing, colliding, and malformed CLI arguments", () => {
    const validPrepare = [
      "prepare", "--run", SOURCE_RUN_ID, "--manifest", "a".repeat(64),
      "--anchor", "2026-06-04T09:20:33.000Z",
      "--tested-source-commit", TESTED_COMMIT,
      "--output-root", "out", "--confirm"
    ];
    for (const argv of [
      [...validPrepare, "--extra", "x"],
      [...validPrepare, "--run", SOURCE_RUN_ID],
      validPrepare.filter((value) => value !== "--confirm"),
      validPrepare.map((value) => value === SOURCE_RUN_ID ? "not-a-uuid" : value),
      validPrepare.map((value) => value === "a".repeat(64) ? "not-a-hash" : value),
      ["verify-input", "--input", "same.json", "--identity", "same.json"],
      ["replay", "--input", "i", "--identity", "j", "--output", "o"]
    ]) {
      expect(() => parseServiceRoleShadowRuntimeAcceptanceCommand(argv)).toThrow(
        "service_role_shadow_runtime_acceptance_command_invalid"
      );
    }
  });

  it("enforces exact clean Git state and the two-file byte allowlist", async () => {
    const repoRoot = resolve("C:/repo");
    const required = [
      "scripts/replayServiceRoleShadowRuntimeAcceptance.ts",
      "src/unifiedCheck/serviceRoleShadowRuntime.ts",
      "src/unifiedCheck/productionTraversalCoordinator.ts",
      "src/unifiedCheck/productionRuntime.ts",
      "tests/scripts/replayServiceRoleShadowRuntimeAcceptance.test.ts",
      "tests/unified-check/serviceRoleShadowRuntime.test.ts",
      "tests/unified-check/serviceRoleShadowRuntime.postgres.test.ts"
    ];
    const tracked = required.map((path, index) =>
      `100644 blob ${String(index + 1).padStart(40, "0")}\t${path}\0`
    ).join("");
    const outputs = new Map<string, string>([
      ["rev-parse --show-toplevel", repoRoot],
      ["rev-parse HEAD", TESTED_COMMIT],
      [`ls-tree -rz --full-tree ${TESTED_COMMIT} -- ${required.join(" ")}`, tracked],
      ["status --porcelain=v1 -z --untracked-files=all", "?? docs/audit/input.json\0?? docs/audit/identity.json\0"]
    ]);
    const bytes = new Map([
      [resolve(repoRoot, "docs/audit/input.json"), "input-bytes"],
      [resolve(repoRoot, "docs/audit/identity.json"), "identity-bytes"]
    ]);
    await expect(verifyServiceRoleShadowRuntimeGitStateV1({
      mode: "verify-input",
      repoRoot,
      scriptPath: resolve(repoRoot, required[0]!),
      testedSourceCommit: TESTED_COMMIT,
      allowedUntrackedFiles: [
        { path: "docs/audit/input.json", expectedBytes: "input-bytes" },
        { path: "docs/audit/identity.json", expectedBytes: "identity-bytes" }
      ],
      runGit: async (args) => ({ stdout: outputs.get(args.join(" ")) ?? "" }),
      readFile: async (path) => bytes.get(resolve(path)) ?? "wrong"
    })).resolves.toBeUndefined();

    outputs.set("rev-parse HEAD", "c".repeat(40));
    await expect(verifyServiceRoleShadowRuntimeGitStateV1({
      mode: "prepare",
      repoRoot,
      scriptPath: resolve(repoRoot, required[0]!),
      testedSourceCommit: TESTED_COMMIT,
      allowedUntrackedFiles: [],
      runGit: async (args) => ({ stdout: outputs.get(args.join(" ")) ?? "" }),
      readFile: async () => ""
    })).rejects.toThrow("service_role_shadow_runtime_git_state_invalid");
  });

  it("rejects dirty/staged/unexpected/untracked byte and containment Git states", async () => {
    const repoRoot = resolve("C:/repo");
    const scriptPath = resolve(repoRoot, "scripts/replayServiceRoleShadowRuntimeAcceptance.ts");
    const required = [
      "scripts/replayServiceRoleShadowRuntimeAcceptance.ts",
      "src/unifiedCheck/serviceRoleShadowRuntime.ts",
      "src/unifiedCheck/productionTraversalCoordinator.ts",
      "src/unifiedCheck/productionRuntime.ts",
      "tests/scripts/replayServiceRoleShadowRuntimeAcceptance.test.ts",
      "tests/unified-check/serviceRoleShadowRuntime.test.ts",
      "tests/unified-check/serviceRoleShadowRuntime.postgres.test.ts"
    ];
    const tracked = required.map((path) => `100644 blob ${"d".repeat(40)}\t${path}\0`).join("");
    const guard = (status: string, inputRead = "input") => verifyServiceRoleShadowRuntimeGitStateV1({
      mode: "verify-input" as const,
      repoRoot,
      scriptPath,
      testedSourceCommit: TESTED_COMMIT,
      allowedUntrackedFiles: [
        { path: "input.json", expectedBytes: "input" },
        { path: "identity.json", expectedBytes: "identity" }
      ],
      runGit: async (args: readonly string[]) => ({ stdout:
        args[0] === "rev-parse" && args[1] === "--show-toplevel" ? repoRoot :
        args[0] === "rev-parse" ? TESTED_COMMIT :
        args[0] === "ls-tree" ? tracked : status
      }),
      readFile: async (path) => resolve(path) === resolve(repoRoot, "input.json")
        ? inputRead
        : "identity"
    });
    await expect(guard(
      "M  tracked.ts\0?? input.json\0?? identity.json\0"
    )).rejects.toThrow(
      "service_role_shadow_runtime_git_state_invalid"
    );
    await expect(guard(
      "?? input.json\0?? identity.json\0?? extra.json\0"
    )).rejects.toThrow(
      "service_role_shadow_runtime_git_state_invalid"
    );
    await expect(guard(
      "?? input.json\0?? identity.json\0", "different"
    )).rejects.toThrow(
      "service_role_shadow_runtime_git_state_invalid"
    );
    await expect(verifyServiceRoleShadowRuntimeGitStateV1({
      mode: "prepare",
      repoRoot,
      scriptPath: resolve(repoRoot, "../outside.ts"),
      testedSourceCommit: TESTED_COMMIT,
      allowedUntrackedFiles: [],
      runGit: async () => ({ stdout: "" }),
      readFile: async () => ""
    })).rejects.toThrow("service_role_shadow_runtime_git_state_invalid");
  });

  it("owns the complete replay input, identity, and one-root acceptance bytes", () => {
    const fixture = acceptanceFixture();
    expect(parseServiceRoleShadowRuntimeReplayInputV1(fixture.replayInput))
      .toEqual(fixture.replayInput);
    expect(parseServiceRoleShadowRuntimeReplayIdentityV1(fixture.replayIdentity))
      .toEqual(fixture.replayIdentity);
    expect(parseServiceRoleShadowC1AcceptanceV1(fixture.acceptance))
      .toEqual(fixture.acceptance);
    expect(serializeServiceRoleShadowRuntimeReplayInputV1(fixture.replayInput))
      .toBe(canonicalizeArtifactJson(fixture.replayInput));
    expect(serializeServiceRoleShadowRuntimeReplayIdentityV1(fixture.replayIdentity))
      .toBe(canonicalizeArtifactJson(fixture.replayIdentity));
    expect(serializeServiceRoleShadowC1AcceptanceV1(fixture.acceptance))
      .toBe(canonicalizeArtifactJson(fixture.acceptance));
    expect(serializeServiceRoleShadowC1AcceptanceV1(fixture.acceptance)).not.toContain("\n");
  });

  it("rejects source status, missing source closure, non-seven input, and accepted-history rewrite", () => {
    const fixture = acceptanceFixture();
    const invalid = [
      { ...fixture.replayInput, sourceRunStatus: "COMPLETED" },
      { ...fixture.replayInput, sourceArtifacts: fixture.replayInput.sourceArtifacts.slice(1) },
      { ...fixture.replayInput, qualifyingTraversalStateIds: fixture.replayInput.qualifyingTraversalStateIds.slice(1) }
    ];
    for (const value of invalid) {
      expect(() => parseServiceRoleShadowRuntimeReplayInputV1(value)).toThrow(
        "service_role_shadow_runtime_replay_input_v1_invalid"
      );
    }
    const changedPage = structuredClone(fixture.replayIdentity);
    const mutablePage = changedPage.translatedAcceptedHistory.pages[0]! as unknown as {
      sha256: string;
      artifactJson: { providerPageHash: string };
    };
    mutablePage.artifactJson.providerPageHash = "f".repeat(64);
    mutablePage.sha256 = fingerprintCanonicalArtifact(mutablePage.artifactJson);
    expect(() => parseServiceRoleShadowC1AcceptanceV1({
      ...fixture.acceptance,
      replayIdentity: changedPage,
      replayIdentitySha256: fingerprintCanonicalArtifact(changedPage)
    })).toThrow("service_role_shadow_c1_acceptance_v1_invalid");
  });

  it("rejects source role reuse, changed sampled roles, broken runtime closure, and projection drift", () => {
    const fixture = acceptanceFixture();
    const sourceReuse = structuredClone(fixture.replayIdentity);
    const mutableSourceMap = sourceReuse.translatedShadowInputs.eventRoleMapV1 as unknown as {
      sha256: string;
      artifactJson: { runId: string };
    };
    mutableSourceMap.artifactJson.runId = SOURCE_RUN_ID;
    mutableSourceMap.sha256 = fingerprintCanonicalArtifact(mutableSourceMap.artifactJson);
    const changedRole = structuredClone(fixture.replayIdentity);
    const mutableBundle = changedRole.translatedShadowInputs.evidenceBundle as unknown as {
      sha256: string;
      artifactJson: { entries: Array<{ role: string }> };
    };
    mutableBundle.artifactJson.entries[0]!.role = "provider_risk";
    mutableBundle.sha256 = fingerprintCanonicalArtifact(mutableBundle.artifactJson);
    for (const replayIdentity of [sourceReuse, changedRole]) {
      expect(() => parseServiceRoleShadowC1AcceptanceV1({
        ...fixture.acceptance,
        replayIdentity,
        replayIdentitySha256: fingerprintCanonicalArtifact(replayIdentity)
      })).toThrow("service_role_shadow_c1_acceptance_v1_invalid");
    }
    expect(() => parseServiceRoleShadowC1AcceptanceV1({
      ...fixture.acceptance,
      runtimeArtifacts: fixture.acceptance.runtimeArtifacts.slice(1)
    })).toThrow("service_role_shadow_c1_acceptance_v1_invalid");
    const changedProjection = { ...fixture.acceptance.enabledAuthoritativeProjection, extra: true };
    expect(() => parseServiceRoleShadowC1AcceptanceV1({
      ...fixture.acceptance,
      enabledAuthoritativeProjection: changedProjection,
      enabledAuthoritativeProjectionSha256: fingerprintCanonicalArtifact(changedProjection)
    })).toThrow("service_role_shadow_c1_acceptance_v1_invalid");
  });

  it("rejects ambiguous targets, replay-derived predecessor drift, and source state drift", () => {
    const fixture = acceptanceFixture();
    const target = fixture.replayInput.sourceArtifacts.find((row) =>
      row.sha256 === fixture.replayIdentity.sourceTargetDeltaSha256
    )!;
    const ambiguousBody = {
      ...(target.artifactJson as Record<string, unknown>),
      previousDeltaHash: target.sha256
    };
    const ambiguous = {
      kind: "traversal_delta",
      schemaVersion: "1",
      sha256: fingerprintCanonicalArtifact(ambiguousBody),
      artifactJson: ambiguousBody
    };
    const ambiguousInput = {
      ...fixture.replayInput,
      sourceArtifacts: [...fixture.replayInput.sourceArtifacts, ambiguous]
        .sort((left, right) => `${left.kind}\0${left.schemaVersion}\0${left.sha256}`
          .localeCompare(`${right.kind}\0${right.schemaVersion}\0${right.sha256}`))
    };
    expect(() => parseServiceRoleShadowRuntimeReplayInputV1(ambiguousInput)).toThrow(
      "service_role_shadow_runtime_replay_input_v1_invalid"
    );

    const driftedIdentity = structuredClone(fixture.replayIdentity);
    const driftedCheckpoint = driftedIdentity.derivedSourcePredecessorCheckpoint as
      unknown as { sha256: string; checkpointJson: { counters: { expanded: number } } };
    driftedCheckpoint.checkpointJson.counters.expanded += 1;
    driftedCheckpoint.sha256 = fingerprintCanonicalArtifact(
      driftedCheckpoint.checkpointJson
    );
    expect(() => parseServiceRoleShadowC1AcceptanceV1({
      ...fixture.acceptance,
      replayIdentity: driftedIdentity,
      replayIdentitySha256: fingerprintCanonicalArtifact(driftedIdentity)
    })).toThrow("service_role_shadow_c1_acceptance_v1_invalid");

    const stateDrift = structuredClone(fixture.replayInput);
    const compaction = stateDrift.sourceArtifacts.find((row) =>
      row.kind === "traversal_compaction_v2"
    )! as unknown as {
      sha256: string;
      artifactJson: { frontier: Array<{ allocatedAmountRaw: string }> };
    };
    compaction.artifactJson.frontier[0]!.allocatedAmountRaw = "999";
    compaction.sha256 = fingerprintCanonicalArtifact(compaction.artifactJson);
    const observed = stateDrift.observedTraversalCheckpoint as unknown as {
      sha256: string;
      checkpointJson: { compactionSha256: string };
    };
    observed.checkpointJson.compactionSha256 = compaction.sha256;
    observed.sha256 = fingerprintCanonicalArtifact(observed.checkpointJson);
    stateDrift.sourceArtifacts.sort((left, right) =>
      `${left.kind}\0${left.schemaVersion}\0${left.sha256}`.localeCompare(
        `${right.kind}\0${right.schemaVersion}\0${right.sha256}`
      )
    );
    expect(() => parseServiceRoleShadowRuntimeReplayInputV1(stateDrift)).toThrow(
      "service_role_shadow_runtime_replay_input_v1_invalid"
    );
  });

  it("rejects replay analysis rewrites outside run, commit, and schema", () => {
    const fixture = acceptanceFixture();
    const identity = structuredClone(fixture.replayIdentity);
    const analysis = identity.translatedTraversalAuthority.analysisManifest as unknown as {
      sha256: string;
      artifactJson: { scoringPolicyVersion: string };
    };
    analysis.artifactJson.scoringPolicyVersion = "rewritten-policy";
    analysis.sha256 = fingerprintCanonicalArtifact(analysis.artifactJson);
    (identity.replay as unknown as { analysisManifestSha256: string })
      .analysisManifestSha256 = analysis.sha256;
    const compaction = identity.translatedTraversalAuthority.compaction as unknown as {
      sha256: string;
      artifactJson: { analysisManifestHash: string };
    };
    compaction.artifactJson.analysisManifestHash = analysis.sha256;
    compaction.sha256 = fingerprintCanonicalArtifact(compaction.artifactJson);
    const predecessor = identity.translatedTraversalAuthority.predecessorCheckpoint as
      unknown as {
        sha256: string;
        checkpointJson: { analysisManifestHash: string; compactionSha256: string };
      };
    predecessor.checkpointJson.analysisManifestHash = analysis.sha256;
    predecessor.checkpointJson.compactionSha256 = compaction.sha256;
    predecessor.sha256 = fingerprintCanonicalArtifact(predecessor.checkpointJson);
    expect(() => parseServiceRoleShadowC1AcceptanceV1({
      ...fixture.acceptance,
      replayIdentity: identity,
      replayIdentitySha256: fingerprintCanonicalArtifact(identity)
    })).toThrow("service_role_shadow_c1_acceptance_v1_invalid");
  });

  it("requires replay analysis authority to use schema 037 exactly", () => {
    const fixture = acceptanceFixture();
    const identity = structuredClone(fixture.replayIdentity);
    const analysis = identity.translatedTraversalAuthority.analysisManifest as unknown as {
      sha256: string;
      artifactJson: { databaseSchemaVersion: number };
    };
    analysis.artifactJson.databaseSchemaVersion = 999;
    analysis.sha256 = fingerprintCanonicalArtifact(analysis.artifactJson);
    (identity.replay as unknown as { analysisManifestSha256: string })
      .analysisManifestSha256 = analysis.sha256;
    const compaction = identity.translatedTraversalAuthority.compaction as unknown as {
      sha256: string;
      artifactJson: { analysisManifestHash: string };
    };
    compaction.artifactJson.analysisManifestHash = analysis.sha256;
    compaction.sha256 = fingerprintCanonicalArtifact(compaction.artifactJson);
    const predecessor = identity.translatedTraversalAuthority.predecessorCheckpoint as
      unknown as {
        sha256: string;
        checkpointJson: { analysisManifestHash: string; compactionSha256: string };
      };
    predecessor.checkpointJson.analysisManifestHash = analysis.sha256;
    predecessor.checkpointJson.compactionSha256 = compaction.sha256;
    predecessor.sha256 = fingerprintCanonicalArtifact(predecessor.checkpointJson);
    expect(() => validateServiceRoleShadowRuntimeReplayPairV1({
      replayInput: fixture.replayInput,
      replayIdentity: identity
    })).toThrow("invalid_traversal_authority_translation");
  });

  it("rejects root extra keys and recursive shadow-hash leakage", () => {
    const fixture = acceptanceFixture();
    expect(() => parseServiceRoleShadowC1AcceptanceV1({
      ...fixture.acceptance,
      extra: true
    })).toThrow("service_role_shadow_c1_acceptance_v1_invalid");
    const leaked = structuredClone(fixture.acceptance.enabledAuthoritativeProjection);
    (leaked.requests[0] as Record<string, unknown>).shadow =
      fixture.acceptance.runtimeArtifacts[0]!.sha256;
    expect(() => parseServiceRoleShadowC1AcceptanceV1({
      ...fixture.acceptance,
      disabledAuthoritativeProjection: leaked,
      disabledAuthoritativeProjectionSha256: fingerprintCanonicalArtifact(leaked),
      enabledAuthoritativeProjection: structuredClone(leaked),
      enabledAuthoritativeProjectionSha256: fingerprintCanonicalArtifact(leaked)
    })).toThrow("service_role_shadow_c1_acceptance_v1_invalid");
  });

  it("requires zero cache decisions, checkpoint authority, accepted history, continuation, and exact delta bodies", () => {
    const fixture = acceptanceFixture();
    const rejectProjection = (mutate: (projection: any) => void) => {
      const disabled = structuredClone(fixture.acceptance.disabledAuthoritativeProjection);
      const enabled = structuredClone(fixture.acceptance.enabledAuthoritativeProjection);
      mutate(disabled);
      mutate(enabled);
      expect(() => parseServiceRoleShadowC1AcceptanceV1({
        ...fixture.acceptance,
        disabledAuthoritativeProjection: disabled,
        disabledAuthoritativeProjectionSha256: fingerprintCanonicalArtifact(disabled),
        enabledAuthoritativeProjection: enabled,
        enabledAuthoritativeProjectionSha256: fingerprintCanonicalArtifact(enabled)
      })).toThrow("service_role_shadow_c1_acceptance_v1_invalid");
    };
    rejectProjection((projection) => {
      projection.provider.cacheDecisions.push({ source: "cache" });
    });
    rejectProjection((projection) => {
      projection.checkpoints = [];
    });
    rejectProjection((projection) => {
      projection.attempts = projection.attempts.slice(0, 1);
    });
    rejectProjection((projection) => {
      const candidate = projection.artifacts.find((artifact: any) =>
        artifact.kind === "traversal_delta"
      );
      candidate.artifact_json.addedFrontier[0].allocatedAmountRaw = "999";
    });
    rejectProjection((projection) => {
      projection.tasks = projection.tasks.filter((task: any) =>
        task.id !== "replay-continuation-task"
      );
    });
    rejectProjection((projection) => {
      const continuation = projection.planner.find((entry: any) =>
        entry.task_id === "replay-continuation-task"
      );
      continuation.planner_state = "ready";
    });
    rejectProjection((projection) => {
      projection.planner[0].result_bytes = 1;
    });
    rejectProjection((projection) => {
      projection.tasks[0].unexpected = true;
    });
    rejectProjection((projection) => {
      const continuation = projection.tasks.find((task: any) =>
        task.id === "replay-continuation-task"
      );
      continuation.logical_key = "wrong-continuation-key";
    });
    rejectProjection((projection) => {
      projection.artifacts = projection.artifacts.filter((artifact: any) =>
        artifact.kind !== "address_history_manifest"
      );
    });
    rejectProjection((projection) => {
      projection.checkpoints[0].taskRow.status = "COMPLETED";
    });
    rejectProjection((projection) => {
      projection.requests[0].created_at = "2026-06-04T10:20:33+01:00";
    });
    rejectProjection((projection) => {
      projection.artifacts[0].created_at = "2026-06-04T10:20:33+01:00";
    });
    rejectProjection((projection) => {
      projection.labelDatasets[0].created_at = "2026-06-04T10:20:33+01:00";
    });
  });
});
