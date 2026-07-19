import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import {
  CANDIDATE_SHA,
  PREVIOUS_RUNTIME_LABEL,
  PREVIOUS_RUNTIME_SHA,
  RELEASE_V2_FREEZE_IDENTITY,
  buildReleaseManifest,
  buildExecutedReleaseGateV2Fixture,
  buildReleaseManifestV2Fixture,
  buildTask0BReleaseFreezeEvidence
} from "../fixtures/release/remediationReleaseFixtures";
import { canonicalBytesV2 } from "../../src/release/releaseRootWriterStore";
import { releaseSha256V2 } from "../../src/release/remediationReleaseManifestV2";

const SHA = CANDIDATE_SHA;
const SHA256 = "b".repeat(64);
const GENERATION = "release-409515ac-generation-0001";
const START_TEMPLATE = createHash("sha256")
  .update("release:task0b:runtime-manager start <artifact-root> <production-go-authority-file>").digest("hex");
const STOP_TEMPLATE = createHash("sha256")
  .update("release:task0b:runtime-manager stop <artifact-root> <production-go-authority-file>").digest("hex");
const PREVIOUS_IDENTITY_TEMPLATE = createHash("sha256")
  .update("task0b_repo_runtime_manager_v1 start-attestation <pid> <process-started-at> <absolute-entrypoint> <worktree-fingerprint> <sha> <label>").digest("hex");

const ACTION_PHASES = {
  runtime_manager_stop_previous: "post_migration_rollout",
  runtime_manager_start_candidate: "post_migration_rollout",
  runtime_manager_stop_candidate: "rollback_candidate_stop",
  runtime_manager_rollback_previous: "rollback_previous_start"
} as const;

type RuntimeCommandId = keyof typeof ACTION_PHASES;

function manifestBytes(manifest: unknown): Buffer {
  return canonicalBytesV2(manifest);
}

function actionManifest(commandId: RuntimeCommandId) {
  if (commandId === "runtime_manager_stop_previous" || commandId === "runtime_manager_start_candidate") {
    return buildReleaseManifestV2Fixture({
      transitionId: "g13_migration_passed",
      overall: "not_ready",
      gates: buildReleaseManifestV2Fixture().gates.map((gate, index) => index < 14
        ? buildExecutedReleaseGateV2Fixture(gate.id, "passed") : gate)
    });
  }
  const sourceManifestSha256 = "f".repeat(64);
  const failureRef = {
    kind: "production_failure_evidence",
    relativePath: "production-failure-evidence-v2.json",
    sha256: "e".repeat(64),
    schemaVersion: "production-failure-evidence-v2",
    candidateSha: SHA,
    sourceManifestSha256
  };
  return buildReleaseManifestV2Fixture({
    transitionId: "production_failed",
    overall: "not_ready",
    transitionEvidence: [failureRef],
    actualRollback: null,
    previousManifestSha256: sourceManifestSha256,
    revision: 2,
    gates: buildReleaseManifestV2Fixture().gates.map((gate, index) => {
      if (index < 14) return buildExecutedReleaseGateV2Fixture(gate.id, "passed");
      if (gate.id === "G14_PRODUCTION_ROLLOUT") return buildExecutedReleaseGateV2Fixture(gate.id, "failed");
      return { id: gate.id, candidateSha: SHA, state: "blocked", blockedByGateId: "G14_PRODUCTION_ROLLOUT",
        productionFailureEvidence: failureRef };
    })
  });
}

function productionAuthority(overrides: Record<string, unknown> = {}) {
  const manifest = actionManifest("runtime_manager_start_candidate");
  const bytes = manifestBytes(manifest);
  return {
    version: "repo-issued-runtime-effect-authority-v2",
    scope: "production_go",
    source: "protected_production_orchestrator",
    operationKind: "rollout",
    operationId: `production-rollout-${"1".repeat(64)}`,
    operationClaimSha256: "2".repeat(64),
    authorityConsumptionSha256: "3".repeat(64),
    sequence: 7,
    stepId: "start_candidate",
    inputSha256: "4".repeat(64),
    intendedExternalEffectSha256: "5".repeat(64),
    intentRelativePath: `production-operation-step-intents/production-rollout-${"1".repeat(64)}/7-start_candidate-1-v2.json`,
    intentSha256: "6".repeat(64),
    operationLeaseSha256: "7".repeat(64),
    operationLeaseEpoch: 1,
    orchestratorPid: 123,
    orchestratorProcessStartFingerprintSha256: "9".repeat(64),
    operationDeadlineAt: "2026-07-18T09:20:00.000Z",
    releaseFreezeIdentitySha256: manifest.releaseFreezeIdentitySha256,
    sourceManifestSha256: createHash("sha256").update(bytes).digest("hex"),
    generationId: GENERATION,
    commandId: "runtime_manager_start_candidate",
    actionPhase: "post_migration_rollout",
    commandTemplateSha256: START_TEMPLATE,
    issuedAt: "2026-07-18T09:00:00.000Z",
    expiresAt: "2026-07-18T09:10:00.000Z",
    candidateSha: SHA,
    targetRuntimeSha: SHA,
    targetRuntimeLabel: `master-${SHA.slice(0, 8)}`,
    targetWorktreePath: "C:\\release\\candidate",
    targetWorktreeFingerprintSha256: SHA256,
    adminUrl: "http://127.0.0.1:28788/",
    adminUrlFingerprintSha256: createHash("sha256").update("http://127.0.0.1:28788/").digest("hex"),
    databaseRole: "production",
    databaseIdentityFingerprintSha256: "c".repeat(64),
    telegramTransport: "production",
    telegramBotIdentitySha256: createHash("sha256").update("test-only-token").digest("hex"),
    task0bEvidenceSha256: "d".repeat(64),
    releaseManifestPath: "release-manifest.json",
    releaseManifestSha256: createHash("sha256").update(bytes).digest("hex"),
    releaseManifestOverall: "not_ready",
    releaseManifestTransitionId: manifest.transitionId,
    explicitGo: true,
    forcePolicy: "graceful_only",
    startEvidencePath: null,
    startEvidenceSha256: null,
    ...overrides
  };
}

function authorityFor(commandId: RuntimeCommandId, manifest = actionManifest(commandId), overrides: Record<string, unknown> = {}) {
  const previousAction = commandId === "runtime_manager_stop_previous" || commandId === "runtime_manager_rollback_previous";
  const stopAction = commandId === "runtime_manager_stop_previous" || commandId === "runtime_manager_stop_candidate";
  const bytes = manifestBytes(manifest);
  const operationKind = commandId === "runtime_manager_stop_previous" || commandId === "runtime_manager_start_candidate"
    ? "rollout" : "rollback";
  const stepId = commandId === "runtime_manager_stop_previous" ? "stop_previous"
    : commandId === "runtime_manager_start_candidate" ? "start_candidate"
      : commandId === "runtime_manager_stop_candidate" ? "stop_candidate" : "start_previous";
  const operationId = `production-${operationKind}-${"1".repeat(64)}`;
  return productionAuthority({
    operationKind,
    operationId,
    sequence: commandId === "runtime_manager_stop_previous" ? 5 : commandId === "runtime_manager_start_candidate" ? 7 : 2,
    stepId,
    intentRelativePath: `production-operation-step-intents/${operationId}/${commandId === "runtime_manager_stop_previous" ? 5 : commandId === "runtime_manager_start_candidate" ? 7 : 2}-${stepId}-1-v2.json`,
    commandId,
    actionPhase: ACTION_PHASES[commandId],
    commandTemplateSha256: commandId.includes("stop") ? STOP_TEMPLATE : START_TEMPLATE,
    targetRuntimeSha: previousAction ? PREVIOUS_RUNTIME_SHA : SHA,
    targetRuntimeLabel: previousAction ? PREVIOUS_RUNTIME_LABEL : `master-${SHA.slice(0, 8)}`,
    targetWorktreeFingerprintSha256: previousAction ? "2".repeat(64) : SHA256,
    releaseManifestSha256: createHash("sha256").update(bytes).digest("hex"),
    releaseManifestOverall: manifest.overall,
    releaseManifestTransitionId: manifest.transitionId,
    sourceManifestSha256: createHash("sha256").update(bytes).digest("hex"),
    releaseFreezeIdentitySha256: manifest.releaseFreezeIdentitySha256,
    startEvidencePath: stopAction ? `runtime-start-evidence-${GENERATION}.json` : null,
    startEvidenceSha256: stopAction ? "1".repeat(64) : null,
    ...overrides
  });
}

function productionBindings(manifest: ReturnType<typeof actionManifest>) {
  return {
    task0b: {
      candidateSha: SHA,
      previousRuntimeSha: PREVIOUS_RUNTIME_SHA,
      previousRuntimeLabel: PREVIOUS_RUNTIME_LABEL,
      candidateWorktree: { worktreePathFingerprintSha256: SHA256 },
      previousRuntimeIdentity: { workingDirectoryFingerprintSha256: "2".repeat(64) },
      rollbackWorktree: { worktreePathFingerprintSha256: "2".repeat(64) },
      productionDatabase: { approvedIdentityFingerprintSha256: "c".repeat(64) },
      runtimeManager: {
        executorPath: "scripts/manageTask0BRuntime.ts",
        executorSha256: "9".repeat(64),
        candidateAdminUrl: "http://127.0.0.1:28788/"
      }
    },
    manifest,
    database: { approvedIdentityFingerprintSha256: "c".repeat(64) }
  };
}

it("[REQ-38][PLAN5-RUNTIME-PHASE-POSITIVE] authorizes each runtime action only at its exact production phase", async () => {
  const api = await import("../../scripts/manageTask0BRuntime");
  for (const commandId of Object.keys(ACTION_PHASES) as RuntimeCommandId[]) {
    const manifest = actionManifest(commandId);
    const authority = api.validateTask0BProductionRuntimeAuthority(
      authorityFor(commandId, manifest),
      "2026-07-18T09:01:00.000Z"
    );
    const bindings = productionBindings(manifest);
    expect(() => api.assertTask0BProductionGoBindings(
      authority, bindings.task0b, bindings.manifest, bindings.database, "9".repeat(64)
    )).not.toThrow();
  }
  expect(() => api.validateTask0BProductionRuntimeAuthority(
    authorityFor("runtime_manager_stop_candidate", actionManifest("runtime_manager_start_candidate")),
    "2026-07-18T09:01:00.000Z"
  )).toThrow(/authority|phase/i);
});

it("[REQ-38][PLAN5-RUNTIME-PHASE-NEGATIVE] rejects wrong overall gates phases and completed release before mutation or consumption", async () => {
  const api = await import("../../scripts/manageTask0BRuntime");
  const validManifest = actionManifest("runtime_manager_start_candidate");
  const invalidGateManifest = structuredClone(validManifest);
  invalidGateManifest.gates[13] = buildReleaseManifestV2Fixture().gates[13]!;
  const invalidBytes = manifestBytes(invalidGateManifest);
  const invalidAuthority = api.validateTask0BProductionRuntimeAuthority(authorityFor(
    "runtime_manager_start_candidate", invalidGateManifest, {
      releaseManifestSha256: createHash("sha256").update(invalidBytes).digest("hex"),
      sourceManifestSha256: createHash("sha256").update(invalidBytes).digest("hex")
    }
  ), "2026-07-18T09:01:00.000Z");
  expect(() => api.validateTask0BReleaseManifestBinding(invalidAuthority, invalidBytes))
    .toThrow(/manifest|gate|phase/i);

  const legacyBytes = manifestBytes(buildReleaseManifest("released"));
  const legacyAuthority = api.validateTask0BProductionRuntimeAuthority(authorityFor(
    "runtime_manager_start_candidate", validManifest, {
      releaseManifestSha256: createHash("sha256").update(legacyBytes).digest("hex"),
      sourceManifestSha256: createHash("sha256").update(legacyBytes).digest("hex")
    }
  ), "2026-07-18T09:01:00.000Z");
  expect(() => api.validateTask0BReleaseManifestBinding(legacyAuthority, legacyBytes))
    .toThrow(/manifest|version|release/i);

  expect(() => api.validateTask0BProductionRuntimeAuthority(authorityFor(
    "runtime_manager_start_candidate",
    actionManifest("runtime_manager_start_candidate"),
    { actionPhase: "rollback_previous_start" }
  ), "2026-07-18T09:01:00.000Z")).toThrow(/phase|authority/i);
});

it("[REQ-38][PLAN5-RUNTIME-ROLLBACK] rejects candidate stop without start evidence and previous rollback without failed context", async () => {
  const api = await import("../../scripts/manageTask0BRuntime");
  const rollbackWithoutFailure = actionManifest("runtime_manager_start_candidate");
  for (const [commandId, manifest, authorityOverrides] of [
    ["runtime_manager_stop_candidate", actionManifest("runtime_manager_stop_candidate"), {
      startEvidencePath: null,
      startEvidenceSha256: null
    }],
    ["runtime_manager_rollback_previous", rollbackWithoutFailure, {}]
  ] as const) {
    const calls: string[] = [];
    expect(() => {
      const authority = api.validateTask0BProductionRuntimeAuthority(
        authorityFor(commandId, manifest, authorityOverrides),
        "2026-07-18T09:01:00.000Z"
      );
      const bindings = productionBindings(manifest);
      api.assertTask0BProductionGoBindings(
        authority, bindings.task0b, bindings.manifest, bindings.database, "9".repeat(64)
      );
      calls.push("consume", commandId.includes("stop") ? "stop" : "spawn");
    }).toThrow(/rollback|failed|blocked|evidence|phase|authority/i);
    expect(calls).toEqual([]);
  }
});

it("[REQ-38][PLAN5-RUNTIME-MANIFEST-BYTES] validates the full exact manifest before mutation or one-shot consumption", async () => {
  const api = await import("../../scripts/manageTask0BRuntime");
  const manifest = actionManifest("runtime_manager_stop_previous");
  const authority = api.validateTask0BProductionRuntimeAuthority(
    authorityFor("runtime_manager_stop_previous", manifest),
    "2026-07-18T09:01:00.000Z"
  );
  expect(api.validateTask0BReleaseManifestBinding(authority, manifestBytes(manifest))).toEqual(
    expect.objectContaining({ candidateSha: SHA, overall: "not_ready" })
  );
  const incomplete = { ...manifest, requiredAcceptanceIds: manifest.requiredAcceptanceIds.slice(1) };
  const incompleteAuthority = api.validateTask0BProductionRuntimeAuthority(
    authorityFor("runtime_manager_stop_previous", incomplete as typeof manifest),
    "2026-07-18T09:01:00.000Z"
  );
  for (const changed of [
    [incompleteAuthority, manifestBytes(incomplete)],
    [authority, Buffer.from(`${JSON.stringify(manifest)} `, "utf8")]
  ] as const) {
    const calls: string[] = [];
    expect(() => {
      api.validateTask0BReleaseManifestBinding(changed[0], changed[1]);
      calls.push("consume", "stop");
    }).toThrow(/manifest|hash|acceptance|binding/i);
    expect(calls).toEqual([]);
  }
});

it("[REQ-38][PLAN5-RUNTIME-AUTHORITY-BYTES] rejects noncanonical authority bytes before consumption", async () => {
  const api = await import("../../scripts/manageTask0BRuntime");
  const authority = productionAuthority();
  const canonical = api.canonicalRuntimeManagerArtifactBytes(authority);
  expect(api.validateCanonicalTask0BProductionRuntimeAuthorityBytesV2(
    canonical, "2026-07-18T09:01:00.000Z"
  )).toEqual(authority);
  expect(() => api.validateCanonicalTask0BProductionRuntimeAuthorityBytesV2(
    Buffer.from(`${JSON.stringify(authority)} `, "utf8"), "2026-07-18T09:01:00.000Z"
  )).toThrow(/noncanonical/i);
});

it("[REQ-38][PLAN5-RUNTIME-REPO-AUTHORITY] binds the repo-issued effect authority to the live lease claim and durable intent", async () => {
  const api = await import("../../scripts/manageTask0BRuntime");
  const operationId = `production-rollout-${"1".repeat(64)}`;
  const sourceManifestSha256 = "f".repeat(64);
  const lease = {
    version: "production-operation-lease-v2", scope: "artifact_root_production_operation",
    relativePath: "production-operation-root.lease.json", operationKind: "rollout", operationId,
    candidateSha: SHA, releaseGenerationId: RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId,
    sourceManifestSha256, artifactRootFingerprintSha256: RELEASE_V2_FREEZE_IDENTITY.artifactRootFingerprintSha256,
    operationalAttestationSha256: "8".repeat(64), recoveryFromAbandonedOperationSha256: null,
    capability: "effect_capable", leaseEpoch: 1, ownerPid: 123,
    ownerProcessStartFingerprintSha256: "9".repeat(64), acquiredAt: "2026-07-18T09:00:00.000Z",
    heartbeatAt: "2026-07-18T09:00:00.000Z", expiresAt: "2026-07-18T09:05:00.000Z",
    operationDeadlineAt: "2026-07-18T09:20:00.000Z"
  } as const;
  const leaseSha256 = releaseSha256V2(canonicalBytesV2(lease));
  const consumption = {
    version: "operational-attestation-consumption-v2", operationKind: "rollout", operationId,
    candidateSha: SHA, releaseGenerationId: lease.releaseGenerationId, sourceManifestSha256,
    artifactRootFingerprintSha256: lease.artifactRootFingerprintSha256,
    operationalAttestationSha256: lease.operationalAttestationSha256,
    operationalAttestationIssuerReceiptSha256: "a".repeat(64), recoveryFromAbandonedOperationSha256: null,
    preclaimValidationSha256: "b".repeat(64),
    preclaimLeaseLineageRelativePath: `production-preclaim-lease-lineages/${operationId}/${leaseSha256}.json`,
    preclaimLeaseLineageSha256: "c".repeat(64), preclaimLeaseLineageCurrentTipSha256: leaseSha256,
    commandId: "production_rollout", redactedTemplateSha256: "d".repeat(64),
    leaseSha256AtConsumption: leaseSha256, leaseEpochAtConsumption: 1,
    consumedAt: "2026-07-18T09:00:00.000Z", expiresAt: "2026-07-18T09:10:00.000Z",
    operationDeadlineAt: lease.operationDeadlineAt
  } as const;
  const authorityConsumptionSha256 = releaseSha256V2(canonicalBytesV2(consumption));
  const claim = {
    version: "production-operation-claim-v2", operationKind: "rollout", operationId,
    candidateSha: SHA, releaseGenerationId: lease.releaseGenerationId, sourceManifestSha256,
    artifactRootFingerprintSha256: lease.artifactRootFingerprintSha256,
    operationalAttestationSha256: lease.operationalAttestationSha256,
    operationalAttestationIssuerReceiptSha256: consumption.operationalAttestationIssuerReceiptSha256,
    recoveryFromAbandonedOperationSha256: null, authorityConsumption: consumption,
    authorityConsumptionSha256, preclaimLeaseLineageRelativePath: consumption.preclaimLeaseLineageRelativePath,
    preclaimLeaseLineageSha256: consumption.preclaimLeaseLineageSha256,
    preclaimLeaseLineageCurrentTipSha256: leaseSha256, capability: "effect_capable",
    leaseEpochAtConsumption: 1, operationDeadlineAt: lease.operationDeadlineAt,
    claimedAt: "2026-07-18T09:00:00.000Z", claimantPid: 123,
    claimantProcessStartFingerprintSha256: lease.ownerProcessStartFingerprintSha256
  } as const;
  const claimSha256 = releaseSha256V2(canonicalBytesV2(claim));
  const intendedExternalEffectSha256 = "5".repeat(64);
  const intent = {
    version: "production-orchestration-step-intent-v2", capability: "effect_capable",
    orchestration: "rollout", operationId, operationClaimSha256: claimSha256,
    authorityConsumptionSha256, sequence: 5, stepId: "stop_previous", attempt: 1,
    relativePath: `production-operation-step-intents/${operationId}/5-stop_previous-1-v2.json`,
    currentOperationLeaseSha256: leaseSha256, currentOperationLeaseEpoch: 1,
    commandId: "production_rollout", redactedTemplateSha256: "d".repeat(64),
    inputSha256: "4".repeat(64), intendedExternalEffectSha256,
    preparedAt: "2026-07-18T09:00:00.000Z"
  } as const;
  const intentSha256 = releaseSha256V2(canonicalBytesV2(intent));
  const authority = api.validateTask0BProductionRuntimeAuthority(authorityFor(
    "runtime_manager_stop_previous", actionManifest("runtime_manager_stop_previous"), {
      operationId, operationClaimSha256: claimSha256, authorityConsumptionSha256,
      sequence: 5, stepId: "stop_previous", inputSha256: intent.inputSha256,
      intendedExternalEffectSha256, intentRelativePath: intent.relativePath, intentSha256,
      operationLeaseSha256: leaseSha256, operationLeaseEpoch: 1,
      operationDeadlineAt: lease.operationDeadlineAt,
      releaseFreezeIdentitySha256: releaseSha256V2(canonicalBytesV2(RELEASE_V2_FREEZE_IDENTITY)),
      sourceManifestSha256, generationId: lease.releaseGenerationId,
      releaseManifestSha256: sourceManifestSha256,
      issuedAt: "2026-07-18T09:00:00.000Z", expiresAt: "2026-07-18T09:04:00.000Z"
    }
  ), "2026-07-18T09:01:00.000Z");
  const protection = { freezeValue: RELEASE_V2_FREEZE_IDENTITY, leaseValue: lease, leaseSha256,
    claimValue: claim, claimSha256, intentValue: intent, intentSha256,
    takeoverChainSha256: releaseSha256V2(canonicalBytesV2([])),
    lineageLeaseTips: [{ sha256: leaseSha256, epoch: 1 }],
    managerParentIdentity: { pid: lease.ownerPid,
      processStartFingerprintSha256: lease.ownerProcessStartFingerprintSha256 },
    evaluatedAt: "2026-07-18T09:01:00.000Z" };
  expect(api.validateRepoIssuedRuntimeAuthorityProtectionV2(authority, protection).intent)
    .toEqual(intent);
  for (const foreign of [
    { ...protection, claimSha256: "0".repeat(64) },
    { ...protection, intentSha256: "0".repeat(64) },
    { ...protection, leaseSha256: "0".repeat(64) },
    { ...protection, takeoverChainSha256: "invalid" },
    { ...protection, lineageLeaseTips: [{ sha256: "0".repeat(64), epoch: 2 }] },
    { ...protection, managerParentIdentity: { ...protection.managerParentIdentity, pid: 124 } },
    { ...protection, evaluatedAt: "2026-07-18T09:05:00.000Z" }
  ]) expect(() => api.validateRepoIssuedRuntimeAuthorityProtectionV2(authority, foreign))
    .toThrow(/binding|authority|time/i);
  expect(() => api.validateTask0BProductionRuntimeAuthority({ ...authority,
    version: "task0b-runtime-authority-v1", source: "operator_protected_one_shot_production_go" },
  "2026-07-18T09:01:00.000Z")).toThrow(/authority/i);
});

it("[REQ-38][TASK0B-MANAGER-AUTHORITY] keeps exact target manager DB Telegram and one-shot bindings", async () => {
  const api = await import("../../scripts/manageTask0BRuntime");
  const manifest = actionManifest("runtime_manager_start_candidate");
  const authority = api.validateTask0BProductionRuntimeAuthority(
    authorityFor("runtime_manager_start_candidate", manifest),
    "2026-07-18T09:01:00.000Z"
  );
  const bindings = productionBindings(manifest);
  for (const invalid of [
    { ...bindings, database: { approvedIdentityFingerprintSha256: "8".repeat(64) } },
    { ...bindings, task0b: { ...bindings.task0b, runtimeManager: { ...bindings.task0b.runtimeManager, executorSha256: "8".repeat(64) } } }
  ]) expect(() => api.assertTask0BProductionGoBindings(
    authority, invalid.task0b, invalid.manifest, invalid.database, "9".repeat(64)
  )).toThrow(/binding|production|manifest|manager/i);
  const rollbackManifest = actionManifest("runtime_manager_rollback_previous");
  const rollbackBindings = productionBindings(rollbackManifest);
  for (const previousMismatch of [
    { targetRuntimeSha: "3".repeat(40), targetRuntimeLabel: `previous-${"3".repeat(8)}` },
    { targetRuntimeSha: PREVIOUS_RUNTIME_SHA, targetRuntimeLabel: `foreign-${PREVIOUS_RUNTIME_SHA.slice(0, 8)}` },
    {
      targetRuntimeSha: PREVIOUS_RUNTIME_SHA,
      targetRuntimeLabel: PREVIOUS_RUNTIME_LABEL,
      targetWorktreeFingerprintSha256: "3".repeat(64)
    }
  ]) {
    const invalidPrevious = api.validateTask0BProductionRuntimeAuthority(authorityFor(
      "runtime_manager_rollback_previous",
      rollbackManifest,
      previousMismatch
    ), "2026-07-18T09:01:00.000Z");
    expect(() => api.assertTask0BProductionGoBindings(
      invalidPrevious,
      rollbackBindings.task0b,
      rollbackBindings.manifest,
      rollbackBindings.database,
      "9".repeat(64)
    )).toThrow(/binding|previous|rollback|worktree/i);
  }
  const candidateAuthoritySha = "a".repeat(64);
  const rollbackAuthoritySha = "b".repeat(64);
  expect(api.runtimeAuthorityFilename(GENERATION, "runtime_manager_start_candidate")).toBe(
    `runtime-authority-${GENERATION}-runtime_manager_start_candidate.json`
  );
  expect(api.runtimeAuthorityFilename(GENERATION, "runtime_manager_rollback_previous")).not.toBe(
    api.runtimeAuthorityFilename(GENERATION, "runtime_manager_start_candidate")
  );
  expect(api.runtimeGenerationEvidencePath("start", GENERATION,
    "runtime_manager_start_candidate", candidateAuthoritySha)).toBe(
    `runtime-start-evidence-${GENERATION}-runtime_manager_start_candidate-${candidateAuthoritySha}.json`
  );
  expect(api.runtimeGenerationEvidencePath("stop", GENERATION,
    "runtime_manager_stop_candidate", rollbackAuthoritySha)).toBe(
    `runtime-stop-evidence-${GENERATION}-runtime_manager_stop_candidate-${rollbackAuthoritySha}.json`
  );
  expect(api.runtimeGenerationEvidencePath("start", GENERATION,
    "runtime_manager_rollback_previous", rollbackAuthoritySha)).not.toBe(
    api.runtimeGenerationEvidencePath("start", GENERATION,
      "runtime_manager_start_candidate", candidateAuthoritySha)
  );
  expect(api.runtimeGenerationConsumptionPath(GENERATION,
    "runtime_manager_stop_previous", candidateAuthoritySha)).toBe(
    `runtime-authority-consumed-${GENERATION}-runtime_manager_stop_previous-${candidateAuthoritySha}.json`
  );
  expect(api.runtimeGenerationConsumptionPath(GENERATION,
    "runtime_manager_stop_previous", candidateAuthoritySha)).not.toBe(
    api.runtimeGenerationConsumptionPath(GENERATION,
      "runtime_manager_start_candidate", rollbackAuthoritySha)
  );

  for (const invalid of [
    productionAuthority({ explicitGo: false }),
    productionAuthority({ releaseManifestOverall: "ready_for_release" }),
    productionAuthority({ releaseManifestOverall: "rolled_back" }),
    productionAuthority({ readyManifestPath: "release-manifest.json" }),
    productionAuthority({ commandTemplateSha256: "0".repeat(64) }),
    productionAuthority({ databaseRole: "runtime_sanitized" }),
    productionAuthority({ telegramTransport: "recording_disabled" }),
    productionAuthority({ generationId: "../escape" }),
    productionAuthority({ commandId: "runtime_sanitized_rehearsal" }),
    authorityFor("runtime_manager_stop_previous", actionManifest("runtime_manager_stop_previous"), { startEvidencePath: null })
  ]) expect(() => api.validateTask0BProductionRuntimeAuthority(
    invalid,
    "2026-07-18T09:01:00.000Z"
  )).toThrow(/authority|production|generation|command/i);

  expect(api.validateTask0BSanitizedRehearsalAuthority({
    task0bVerified: true,
    databaseRole: "runtime_sanitized",
    databaseName: "tron_watch_plan5_runtime_sanitized",
    telegramTransport: "recording_disabled",
    executorPath: "scripts/rehearseRemediationRuntime.ts"
  })).toEqual(expect.objectContaining({ telegramTransport: "recording_disabled" }));
  expect(() => api.validateTask0BSanitizedRehearsalAuthority({
    task0bVerified: true,
    databaseRole: "production",
    databaseName: "tron_watch",
    telegramTransport: "production",
    executorPath: "scripts/manageTask0BRuntime.ts"
  })).toThrow(/sanitized|rehearsal|transport/i);
});

it("[REQ-38][TASK0B-MANAGER-ENV] strips inherited environment and binds production DB and Telegram transport", async () => {
  const api = await import("../../scripts/manageTask0BRuntime");
  const currentAuthority = productionAuthority({
    issuedAt: new Date(Date.now() - 1_000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    operationDeadlineAt: new Date(Date.now() + 120_000).toISOString()
  });
  const env = api.buildTask0BProductionRuntimeEnvironment({
    SystemRoot: "C:\\Windows",
    TEMP: "C:\\Temp",
    BOT_TOKEN: "test-only-token",
    TASK0B_PRODUCTION_DATABASE_URL: "postgresql://test@127.0.0.1:55432/tron_watch",
    TRONSCAN_API_KEY: "test-provider-key",
    UNRELATED_SECRET: "must-not-leak",
    PLAN5_RUNTIME_REHEARSAL_PRELOAD: "1"
  }, currentAuthority, "C:\\protected\\plan5-no-dotenv");
  expect(env).toMatchObject({
    BOT_TOKEN: "test-only-token",
    DATABASE_URL: "postgresql://test@127.0.0.1:55432/tron_watch",
    RUNTIME_GIT_SHA: SHA,
    RUNTIME_INSTANCE_LABEL: `master-${SHA.slice(0, 8)}`,
    ADMIN_DASHBOARD_HOST: "127.0.0.1",
    ADMIN_DASHBOARD_PORT: "28788",
    DOTENV_CONFIG_PATH: "C:\\protected\\plan5-no-dotenv"
  });
  expect(env.UNRELATED_SECRET).toBeUndefined();
  expect(env.PLAN5_RUNTIME_REHEARSAL_PRELOAD).toBeUndefined();
  expect(env.TASK0B_PRODUCTION_DATABASE_URL).toBeUndefined();
  expect(() => api.buildTask0BProductionRuntimeEnvironment({
    BOT_TOKEN: "foreign-token",
    TASK0B_PRODUCTION_DATABASE_URL: "postgresql://test@127.0.0.1:55432/tron_watch"
  }, currentAuthority, "C:\\protected\\plan5-no-dotenv")).toThrow(/environment|telegram|missing/i);
});

it("[REQ-38][TASK0B-MANAGER-FRESHNESS] rejects a fresh GO over expired Task0B or changed operator config", async () => {
  const api = await import("../../scripts/manageTask0BRuntime");
  const task0b = buildTask0BReleaseFreezeEvidence({ observedAt: "2026-07-18T09:00:00.000Z" });
  const authority = productionAuthority({
    candidateSha: CANDIDATE_SHA,
    targetRuntimeSha: CANDIDATE_SHA,
    targetRuntimeLabel: `plan5-${CANDIDATE_SHA.slice(0, 8)}`,
    issuedAt: "2026-07-18T09:00:00.000Z",
    expiresAt: "2026-07-18T09:10:00.000Z"
  });
  expect(() => api.validateTask0BProductionGoEvidence(
    authority, task0b, task0b.operatorConfig, "2026-07-18T09:05:00.000Z"
  )).not.toThrow();
  const freshGo = {
    ...authority,
    issuedAt: "2026-07-18T09:15:30.000Z",
    expiresAt: "2026-07-18T09:20:00.000Z",
    operationDeadlineAt: "2026-07-18T09:21:00.000Z"
  };
  expect(() => api.validateTask0BProductionGoEvidence(
    freshGo, task0b, task0b.operatorConfig, "2026-07-18T09:16:00.000Z"
  )).toThrow(/stale|expired|freeze/i);
  expect(() => api.validateTask0BProductionGoEvidence(
    authority,
    task0b,
    { ...task0b.operatorConfig, contentSha256: "f".repeat(64) },
    "2026-07-18T09:05:00.000Z"
  )).toThrow(/operator|config|binding/i);
});

it("[REQ-38][PLAN5-RUNTIME-FINAL-FRESHNESS] revalidates authority Task0B and config after preflight before consumption", async () => {
  const api = await import("../../scripts/manageTask0BRuntime");
  const task0b = buildTask0BReleaseFreezeEvidence({ observedAt: "2026-07-18T09:00:00.000Z" });
  const authority = productionAuthority({
    issuedAt: "2026-07-18T09:00:00.000Z",
    expiresAt: "2026-07-18T09:10:00.000Z"
  });
  const calls: string[] = [];
  await expect(api.executeTask0BAuthorizedAction({
    async prepare() { calls.push("preflight"); return {}; },
    revalidateBeforeConsumption() {
      calls.push("fresh-revalidate");
      api.validateTask0BProductionGoEvidence(
        authority,
        task0b,
        task0b.operatorConfig,
        "2026-07-18T09:10:00.000Z"
      );
    },
    async consumeAuthority() { calls.push("consume"); },
    async recheckLive() { calls.push("live-recheck"); },
    revalidateImmediatelyBeforeMutation() { calls.push("mutation-revalidate"); },
    async mutateRuntime() { calls.push("spawn"); return {}; }
  })).rejects.toThrow(/expired|authority|fresh|time/i);
  expect(calls).toEqual(["preflight", "fresh-revalidate"]);
});

it("[REQ-38][PLAN5-RUNTIME-PREFLIGHT] preserves authority when target or Telegram identity preflight fails", async () => {
  const api = await import("../../scripts/manageTask0BRuntime");
  const authority = api.validateTask0BProductionRuntimeAuthority(productionAuthority(), "2026-07-18T09:01:00.000Z");
  expect(() => api.assertTask0BProductionTelegramBinding(authority, "test-only-token")).not.toThrow();
  for (const scenario of [
    { botToken: "foreign-token", failure: null },
    { botToken: "test-only-token", failure: "task0b_runtime_manager_worktree_unverified" },
    { botToken: "test-only-token", failure: "task0b_runtime_stop_evidence_hash_mismatch" }
  ]) {
    const calls: string[] = [];
    await expect(api.executeTask0BAuthorizedAction({
      async prepare() {
        calls.push("preflight");
        api.assertTask0BProductionTelegramBinding(authority, scenario.botToken);
        if (scenario.failure) throw new Error(scenario.failure);
        return {};
      },
      revalidateBeforeConsumption() { calls.push("fresh-revalidate"); },
      async consumeAuthority() { calls.push("consume"); },
      async recheckLive() { calls.push("live-recheck"); },
      revalidateImmediatelyBeforeMutation() { calls.push("mutation-revalidate"); },
      async mutateRuntime() { calls.push("stop"); return {}; }
    })).rejects.toThrow(/telegram|identity|binding|worktree|evidence/i);
    expect(calls).toEqual(["preflight"]);
  }
});

it("[REQ-38][PLAN5-RUNTIME-LIVE-RECHECK] consumes once then rechecks volatile identity before mutation", async () => {
  const api = await import("../../scripts/manageTask0BRuntime");
  const calls: string[] = [];
  await expect(api.executeTask0BAuthorizedAction({
    async prepare() { calls.push("preflight"); return { processId: 77 }; },
    revalidateBeforeConsumption() { calls.push("fresh-revalidate"); },
    async consumeAuthority() { calls.push("consume"); },
    async recheckLive() { calls.push("live-recheck"); throw new Error("runtime identity changed"); },
    revalidateImmediatelyBeforeMutation() { calls.push("mutation-revalidate"); },
    async mutateRuntime() { calls.push("stop"); return {}; }
  })).rejects.toThrow(/identity|changed/i);
  expect(calls).toEqual(["preflight", "fresh-revalidate", "consume", "live-recheck"]);
});

it("[REQ-38][PLAN5-RUNTIME-FINAL-FENCE] revalidates lease authority and time after volatile recheck", async () => {
  const api = await import("../../scripts/manageTask0BRuntime");
  for (const failure of ["operation lease replaced", "authority expired during recheck"]) {
    const calls: string[] = [];
    await expect(api.executeTask0BAuthorizedAction({
      async prepare() { calls.push("preflight"); return {}; },
      revalidateBeforeConsumption() { calls.push("fresh-revalidate"); },
      async consumeAuthority() { calls.push("consume"); },
      async recheckLive() { calls.push("live-recheck"); },
      revalidateImmediatelyBeforeMutation() { calls.push("mutation-revalidate"); throw new Error(failure); },
      async mutateRuntime() { calls.push("mutate"); return {}; }
    })).rejects.toThrow(/lease|authority|expired/i);
    expect(calls).toEqual(["preflight", "fresh-revalidate", "consume", "live-recheck", "mutation-revalidate"]);
  }
});

it("[REQ-38][TASK0B-MANAGER-START] writes append-only generation evidence before success and cleans a failed child", async () => {
  const api = await import("../../scripts/manageTask0BRuntime");
  const calls: string[] = [];
  await expect(api.completeTask0BManagedRuntimeStart({
    generationId: GENERATION,
    commandId: "runtime_manager_start_candidate",
    authoritySha256: "a".repeat(64),
    processId: 77,
    evidence: { processId: 77 },
    async writeEvidence(path: string) { calls.push(`write:${path}`); throw new Error("evidence collision"); },
    async terminateAndVerify(processId: number) { calls.push(`cleanup:${processId}`); }
  })).rejects.toThrow(/collision/);
  expect(calls).toEqual([
    `write:runtime-start-evidence-${GENERATION}-runtime_manager_start_candidate-${"a".repeat(64)}.json`,
    "cleanup:77"
  ]);
});

it("[REQ-38][TASK0B-MANAGER-LOGS] assigns fixed generation-bound stdout stderr and binding paths", async () => {
  const api = await import("../../scripts/manageTask0BRuntime");
  const candidateAuthority = "a".repeat(64);
  const rollbackAuthority = "b".repeat(64);
  expect(api.runtimeGenerationDiagnosticPaths(GENERATION, "runtime_manager_start_candidate", candidateAuthority)).toEqual({
    stdout: `runtime-stdout-${GENERATION}-runtime_manager_start_candidate-${candidateAuthority}.jsonl`,
    stderr: `runtime-stderr-${GENERATION}-runtime_manager_start_candidate-${candidateAuthority}.jsonl`,
    binding: `runtime-log-binding-${GENERATION}-runtime_manager_start_candidate-${candidateAuthority}.json`
  });
  expect(api.runtimeGenerationDiagnosticPaths(GENERATION,
    "runtime_manager_rollback_previous", rollbackAuthority)).not.toEqual(
    api.runtimeGenerationDiagnosticPaths(GENERATION, "runtime_manager_start_candidate", candidateAuthority));
  expect(() => api.runtimeGenerationDiagnosticPaths("../escape",
    "runtime_manager_start_candidate", candidateAuthority)).toThrow(/generation/i);
});

it("[REQ-38][TASK0B-MANAGER-EFFECT-IDENTITY] isolates rollout and rollback authority consumption and rejects replay", async () => {
  const api = await import("../../scripts/manageTask0BRuntime");
  const consumed = new Set<string>();
  const effects: string[] = [];
  const run = async (commandId: "runtime_manager_stop_previous" | "runtime_manager_start_candidate"
    | "runtime_manager_stop_candidate" | "runtime_manager_rollback_previous", authoritySha256: string) => {
    await api.executeTask0BAuthorizedAction({
      async prepare() { return {}; },
      revalidateBeforeConsumption() {},
      async consumeAuthority() {
        const path = api.runtimeGenerationConsumptionPath(GENERATION, commandId, authoritySha256);
        if (consumed.has(path)) throw new Error("authority consumption collision");
        consumed.add(path);
      },
      async recheckLive() {},
      revalidateImmediatelyBeforeMutation() {},
      async mutateRuntime() { effects.push(commandId); }
    });
  };
  const identities = [
    ["runtime_manager_stop_previous", "a".repeat(64)],
    ["runtime_manager_start_candidate", "b".repeat(64)],
    ["runtime_manager_stop_candidate", "c".repeat(64)],
    ["runtime_manager_rollback_previous", "d".repeat(64)]
  ] as const;
  for (const [commandId, authoritySha256] of identities) await run(commandId, authoritySha256);
  expect(effects).toEqual(identities.map(([commandId]) => commandId));
  await expect(run("runtime_manager_start_candidate", "b".repeat(64))).rejects.toThrow(/consumption|collision/i);
  expect(effects).toHaveLength(4);
});

it("[REQ-38][TASK0B-MANAGER-TYPED-EVIDENCE] validates canonical consumption start and stop evidence against the exact authority", async () => {
  const api = await import("../../scripts/manageTask0BRuntime");
  const authoritySha256 = "a".repeat(64);
  const consumption = {
    version: "runtime-manager-authority-consumption-v1",
    generationId: GENERATION,
    authoritySha256,
    commandId: "runtime_manager_start_candidate",
    consumedAt: "2026-07-18T09:01:00.000Z"
  };
  expect(api.validateRuntimeManagerAuthorityConsumptionV1(consumption, {
    generationId: GENERATION,
    commandId: "runtime_manager_start_candidate",
    authoritySha256,
    issuedAt: "2026-07-18T09:00:00.000Z",
    expiresAt: "2026-07-18T09:10:00.000Z"
  })).toEqual(consumption);

  const runtimeEvidence = {
    version: "runtime-manager-start-evidence-v1",
    generationId: GENERATION,
    runtimeSha: SHA,
    runtimeLabel: `master-${SHA.slice(0, 8)}`,
    processId: 77,
    processStartedAt: "2026-07-18T09:00:30.000Z",
    commandLineSha256: "1".repeat(64),
    executablePathSha256: "2".repeat(64),
    workingDirectoryFingerprintSha256: "3".repeat(64),
    entrypointPathFingerprintSha256: "4".repeat(64),
    managerExecutableSha256: "5".repeat(64),
    attestedAt: "2026-07-18T09:00:31.000Z",
    producerId: "task0b_repo_runtime_manager_v1",
    commandId: "runtime_manager_previous_identity",
    templateSha256: PREVIOUS_IDENTITY_TEMPLATE,
    exitCode: 0
  };
  const startEvidence = {
    version: "runtime-manager-start-effect-evidence-v2",
    generationId: GENERATION,
    commandId: "runtime_manager_start_candidate",
    authoritySha256,
    targetRuntimeSha: SHA,
    targetRuntimeLabel: `master-${SHA.slice(0, 8)}`,
    runtimeEvidence
  };
  expect(api.validateRuntimeManagerStartEffectEvidenceV2(startEvidence, {
    generationId: GENERATION,
    commandId: "runtime_manager_start_candidate",
    authoritySha256,
    targetRuntimeSha: SHA,
    targetRuntimeLabel: `master-${SHA.slice(0, 8)}`
  })).toEqual(startEvidence);

  const stopEvidence = {
    version: "runtime-manager-stop-effect-evidence-v2",
    generationId: GENERATION,
    commandId: "runtime_manager_stop_previous",
    authoritySha256,
    targetRuntimeSha: PREVIOUS_RUNTIME_SHA,
    targetRuntimeLabel: PREVIOUS_RUNTIME_LABEL,
    startEvidencePath: `runtime-start-evidence-${GENERATION}.json`,
    startEvidenceSha256: "6".repeat(64),
    stoppedProcessId: 77,
    stoppedProcessStartedAt: "2026-07-18T09:00:30.000Z",
    stoppedAt: "2026-07-18T09:01:00.000Z",
    forcePolicy: "graceful_only",
    runtimeCandidatesAfter: 0,
    verified: true
  };
  expect(api.validateRuntimeManagerStopEffectEvidenceV2(stopEvidence, {
    generationId: GENERATION,
    commandId: "runtime_manager_stop_previous",
    authoritySha256,
    targetRuntimeSha: PREVIOUS_RUNTIME_SHA,
    targetRuntimeLabel: PREVIOUS_RUNTIME_LABEL
  })).toEqual(stopEvidence);

  for (const forged of [
    { ...consumption, commandId: "runtime_manager_stop_previous" },
    { ...consumption, authoritySha256: "f".repeat(64) }
  ]) expect(() => api.validateRuntimeManagerAuthorityConsumptionV1(forged, {
    generationId: GENERATION,
    commandId: "runtime_manager_start_candidate",
    authoritySha256,
    issuedAt: "2026-07-18T09:00:00.000Z",
    expiresAt: "2026-07-18T09:10:00.000Z"
  })).toThrow(/consumption|binding/i);
  expect(() => api.validateRuntimeManagerStartEffectEvidenceV2({ ...startEvidence,
    authoritySha256: "f".repeat(64) }, {
    generationId: GENERATION,
    commandId: "runtime_manager_start_candidate",
    authoritySha256,
    targetRuntimeSha: SHA,
    targetRuntimeLabel: `master-${SHA.slice(0, 8)}`
  })).toThrow(/start|binding/i);
  expect(() => api.validateRuntimeManagerStopEffectEvidenceV2({ ...stopEvidence,
    commandId: "runtime_manager_stop_candidate" }, {
    generationId: GENERATION,
    commandId: "runtime_manager_stop_previous",
    authoritySha256,
    targetRuntimeSha: PREVIOUS_RUNTIME_SHA,
    targetRuntimeLabel: PREVIOUS_RUNTIME_LABEL
  })).toThrow(/stop|binding/i);
});

it("[REQ-38][TASK0B-MANAGER-UNMARKED] blocks before authority consumption spawn or evidence", async () => {
  const api = await import("../../scripts/manageTask0BRuntime");
  const calls: string[] = [];
  await expect(api.executeTask0BAuthorizedStart({
    async countRuntimeCandidates() { return 1; },
    async consumeAuthority() { calls.push("consume"); },
    async startRuntime() { calls.push("spawn"); return { status: "started" }; }
  })).rejects.toThrow(/overlap|runtime|running/i);
  expect(calls).toEqual([]);
});

it("[REQ-38][TASK0B-MANAGER-STOP] verifies exact identity graceful exit zero overlap and explicit force policy", async () => {
  const api = await import("../../scripts/manageTask0BRuntime");
  const expected = { processId: 77, processStartedAt: "2026-07-18T09:00:00.000Z", runtimeProcessCount: 1 };
  const calls: string[] = [];
  const observations: Array<typeof expected | null> = [expected, null];
  await api.stopTask0BManagedRuntime(expected, "graceful_only", {
    async observeExact() { return observations.shift() ?? null; },
    async countRuntimeCandidates() { return 0; },
    signal(_pid: number, signal: string) { calls.push(signal); },
    async wait() {}
  }, { timeoutMs: 10, pollMs: 1 });
  expect(calls).toEqual(["SIGTERM"]);

  await expect(api.stopTask0BManagedRuntime(expected, "graceful_only", {
    async observeExact() { return expected; },
    async countRuntimeCandidates() { return 1; },
    signal() {},
    async wait() {}
  }, { timeoutMs: 2, pollMs: 1 })).rejects.toThrow(/graceful|timeout|running/i);

  const forced: string[] = [];
  let forceSent = false;
  await api.stopTask0BManagedRuntime(expected, "graceful_then_force", {
    async observeExact() { return forceSent ? null : expected; },
    async countRuntimeCandidates() { return 0; },
    signal(_pid: number, signal: string) { forced.push(signal); if (signal === "SIGKILL") forceSent = true; },
    async wait() { await new Promise((resolve) => setTimeout(resolve, 2)); }
  }, { timeoutMs: 1, pollMs: 1 });
  expect(forced).toEqual(["SIGTERM", "SIGKILL"]);
});
