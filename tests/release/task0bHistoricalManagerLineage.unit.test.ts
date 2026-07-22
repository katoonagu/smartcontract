import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import {
  CANDIDATE_SHA,
  PREVIOUS_RUNTIME_LABEL,
  PREVIOUS_RUNTIME_SHA,
  TASK0B_EXPECTED_PRODUCTION_DATABASE,
  TASK0B_EXPECTED_PRODUCTION_DATABASE_FINGERPRINT,
  buildTask0BReleaseFreezeEvidence
} from "../fixtures/release/remediationReleaseFixtures";
import {
  validateTask0BReleaseFreezeEvidence,
  type Task0BReleaseFreezeEvidenceV1
} from "../../src/release/remediationReleaseManifest";
import {
  canonicalReleaseJsonV2,
  canonicalReleaseFreezeIdentityUtf8V2,
  releaseSha256V2
} from "../../src/release/remediationReleaseManifestV2";
import { deriveReleaseFreezeIdentityV2 } from "../../src/release/releaseManifestStoreV2";

const SHA256 = (value: string) => value.repeat(64);

function historicalManagerEvidence() {
  const evidence = buildTask0BReleaseFreezeEvidence();
  const launcherSha256 = SHA256("1");
  evidence.previousRuntimeIdentity.managerExecutableSha256 = launcherSha256;
  (evidence.previousRuntimeIdentity as typeof evidence.previousRuntimeIdentity & {
    historicalLauncher: Record<string, unknown>;
  }).historicalLauncher = {
    ownerCandidateSha: "1".repeat(40),
    executorPath: "scripts/manageTask0BRuntime.ts",
    executorSha256: launcherSha256,
    sourceBlobSha256: SHA256("2"),
    originArtifactRootFingerprintSha256: SHA256("3"),
    originTask0BEvidenceSha256: SHA256("4"),
    originReleaseFreezeIdentitySha256: SHA256("5"),
    originPreparedFreezeMaterializationSha256: SHA256("6"),
    originFreezeMaterializationReceiptSha256: SHA256("7"),
    source: "protected_origin_freeze_and_git_blob_read_only",
    verified: true
  };
  return evidence;
}

function completeArchivedOriginBundle(
  current = historicalManagerEvidence(),
  options: { leaseHash?: string; materializedAt?: string } = {}
) {
  const launcher = (current.previousRuntimeIdentity as any).historicalLauncher!;
  const rootFingerprint = launcher.originArtifactRootFingerprintSha256 as string;
  const task0b: any = buildTask0BReleaseFreezeEvidence({
    candidateSha: launcher.ownerCandidateSha,
    previousRuntimeSha: current.previousRuntimeSha,
    previousRuntimeLabel: current.previousRuntimeLabel,
    artifactRootFingerprintSha256: rootFingerprint
  });
  delete task0b.previousRuntimeIdentity.kind;
  task0b.previousRuntimeIdentity.managerExecutableSha256 = launcher.executorSha256;
  task0b.previousRuntimeIdentity.startEvidenceSha256 = current.previousRuntimeIdentity.startEvidenceSha256;
  task0b.runtimeManager.executorSha256 = launcher.executorSha256;
  const task0bBytes = Buffer.from(`${canonicalReleaseJsonV2(task0b)}\n`);
  const freeze = deriveReleaseFreezeIdentityV2(task0b as Task0BReleaseFreezeEvidenceV1);
  const freezeBytes = canonicalReleaseFreezeIdentityUtf8V2(freeze);
  const freezeSha256 = releaseSha256V2(freezeBytes);
  const task0bSha256 = releaseSha256V2(task0bBytes);
  const runtimeIdentitySha256 = releaseSha256V2(
    Buffer.from(`${canonicalReleaseJsonV2(task0b.previousRuntimeIdentity)}\n`)
  );
  const redactedTemplateSha256 = releaseSha256V2("release:freeze:materialize <protected-artifact-root>");
  const materializedAt = options.materializedAt ?? task0b.freezeCutoff;
  const receipt = {
    version: "release-freeze-materialization-receipt-v2",
    commandId: "release_freeze_materialize",
    redactedTemplateSha256,
    task0BPreflightEvidenceSha256: task0bSha256,
    protectedRootFingerprintSha256: rootFingerprint,
    candidateSha: task0b.candidateSha,
    runtimeIdentitySha256,
    bootstrapLeaseSha256: options.leaseHash ?? SHA256("a"),
    bootstrapLeaseEpoch: 1,
    canonicalFreezeIdentity: freeze,
    canonicalFreezeIdentityUtf8Base64: freezeBytes.toString("base64"),
    canonicalFreezeIdentitySha256: freezeSha256,
    materializedAt
  };
  const receiptBytes = Buffer.from(`${canonicalReleaseJsonV2(receipt)}\n`);
  const prepared = {
    version: "prepared-release-freeze-materialization-v2",
    commandId: "release_freeze_materialize",
    redactedTemplateSha256,
    protectedRootFingerprintSha256: rootFingerprint,
    task0BPreflightEvidenceSha256: task0bSha256,
    candidateSha: task0b.candidateSha,
    runtimeIdentitySha256,
    bootstrapLeaseSha256: receipt.bootstrapLeaseSha256,
    bootstrapLeaseEpoch: 1,
    canonicalFreezeIdentity: freeze,
    canonicalFreezeIdentityUtf8Base64: freezeBytes.toString("base64"),
    canonicalFreezeIdentitySha256: freezeSha256,
    canonicalFreezeIdentityRelativePath: "release-freeze-identity-v2.json",
    canonicalMaterializationReceipt: receipt,
    canonicalMaterializationReceiptUtf8Base64: receiptBytes.toString("base64"),
    canonicalMaterializationReceiptSha256: releaseSha256V2(receiptBytes),
    canonicalMaterializationReceiptRelativePath: "release-freeze-materialization-receipt-v2.json",
    preparedAt: materializedAt
  };
  return {
    task0bBytes,
    freezeBytes,
    preparedBytes: Buffer.from(`${canonicalReleaseJsonV2(prepared)}\n`),
    receiptBytes,
    observedAt: task0b.observedAt,
    expiresAt: task0b.expiresAt
  };
}

it("[REQ-38][TASK0B-HISTORICAL-MANAGER] binds an exact historical launcher separately from the current guarded action manager", () => {
  const evidence = historicalManagerEvidence();

  expect(() => validateTask0BReleaseFreezeEvidence(
    evidence,
    CANDIDATE_SHA,
    evidence.observedAt
  )).not.toThrow();

  for (const mutate of [
    (value: any) => { delete value.previousRuntimeIdentity.historicalLauncher; },
    (value: any) => { value.previousRuntimeIdentity.historicalLauncher.executorSha256 = SHA256("9"); },
    (value: any) => { value.previousRuntimeIdentity.historicalLauncher.ownerCandidateSha = CANDIDATE_SHA; },
    (value: any) => { value.previousRuntimeIdentity.historicalLauncher.verified = false; }
  ]) {
    const forged = structuredClone(evidence);
    mutate(forged);
    expect(() => validateTask0BReleaseFreezeEvidence(
      forged,
      CANDIDATE_SHA,
      forged.observedAt
    )).toThrow(/manager|launcher|runtime|binding/i);
  }
});

it("[REQ-38][TASK0B-HISTORICAL-MANAGER-LINEAGE] rejects truncated synthetic origin artifacts", async () => {
  const api: any = await import("../../scripts/captureTask0BPreflight");
  const current = historicalManagerEvidence();
  const launcher = (current.previousRuntimeIdentity as any).historicalLauncher!;
  const originPreviousRuntimeIdentity: any = structuredClone(current.previousRuntimeIdentity);
  delete originPreviousRuntimeIdentity.kind;
  delete originPreviousRuntimeIdentity.historicalLauncher;
  const originArtifactRootFingerprintSha256 = SHA256("3");
  const originTask0B = {
    version: "task0b-release-freeze-evidence-v1",
    candidateSha: launcher.ownerCandidateSha,
    previousRuntimeSha: current.previousRuntimeSha,
    previousRuntimeLabel: current.previousRuntimeLabel,
    previousRuntimeIdentity: originPreviousRuntimeIdentity,
    runtimeManager: {
      executorPath: launcher.executorPath,
      executorSha256: launcher.executorSha256,
      producerId: "task0b_repo_runtime_manager_v1",
      verified: true
    },
    artifactRoot: {
      rootFingerprintSha256: originArtifactRootFingerprintSha256,
      restrictiveAccessVerified: true,
      noSymlink: true,
      verified: true
    },
    freezeCutoff: "2026-07-18T09:00:00.000Z"
  };
  const originTask0BBytes = Buffer.from(`${canonicalReleaseJsonV2(originTask0B)}\n`);
  const originReleaseFreezeIdentity = {
    version: "release-freeze-identity-v2",
    candidateSha: launcher.ownerCandidateSha,
    artifactRootFingerprintSha256: originArtifactRootFingerprintSha256,
    previousRuntimeDiscoverySha256: createHash("sha256")
      .update(Buffer.from(`${canonicalReleaseJsonV2(originPreviousRuntimeIdentity)}\n`)).digest("hex"),
    createdAt: originTask0B.freezeCutoff
  };
  const originReleaseFreezeIdentityBytes = Buffer.from(`${canonicalReleaseJsonV2(originReleaseFreezeIdentity)}\n`);
  const ownerManagerSourceBytes = Buffer.from("exact historical manager source bytes\n");
  const binding = {
    ownerCandidateSha: launcher.ownerCandidateSha,
    executorPath: launcher.executorPath,
    executorSha256: launcher.executorSha256,
    sourceBlobSha256: createHash("sha256").update(ownerManagerSourceBytes).digest("hex"),
    originArtifactRoot: "C:\\protected\\origin",
    originArtifactRootFingerprintSha256,
    originTask0BEvidenceSha256: createHash("sha256").update(originTask0BBytes).digest("hex"),
    originReleaseFreezeIdentitySha256: createHash("sha256")
      .update(originReleaseFreezeIdentityBytes).digest("hex")
  };
  const input = {
    candidateSha: CANDIDATE_SHA,
    previousRuntimeSha: current.previousRuntimeSha,
    previousRuntimeLabel: current.previousRuntimeLabel,
    managerExecutableSha256: launcher.executorSha256,
    startEvidenceSha256: current.previousRuntimeIdentity.startEvidenceSha256,
    binding,
    observedOriginArtifactRootFingerprintSha256: originArtifactRootFingerprintSha256,
    originTask0BEvidenceBytes: originTask0BBytes,
    originReleaseFreezeIdentityBytes,
    ownerManagerSourceBytes,
    ownerIsAncestor: true
  };

  expect(() => api.validateTask0BHistoricalManagerLineage(input))
    .toThrow(/historical|origin|lineage|manager/i);
  for (const forged of [
    { ...input, ownerIsAncestor: false },
    { ...input, ownerManagerSourceBytes: Buffer.from("foreign source\n") },
    { ...input, observedOriginArtifactRootFingerprintSha256: SHA256("9") },
    { ...input, originReleaseFreezeIdentityBytes: Buffer.from("{}\n") }
  ]) expect(() => api.validateTask0BHistoricalManagerLineage(forged)).toThrow(/historical|origin|lineage|manager/i);
});

it("[REQ-38][TASK0B-HISTORICAL-MANAGER-MATERIALIZATION] accepts only the complete archived origin bundle", async () => {
  const api: any = await import("../../scripts/captureTask0BPreflight");
  const current = historicalManagerEvidence();
  const launcher = (current.previousRuntimeIdentity as any).historicalLauncher!;
  const bundle = completeArchivedOriginBundle(current);
  const ownerManagerSourceBytes = Buffer.from("exact historical manager source bytes\n");
  const binding = {
    ownerCandidateSha: launcher.ownerCandidateSha,
    executorPath: launcher.executorPath,
    executorSha256: launcher.executorSha256,
    sourceBlobSha256: releaseSha256V2(ownerManagerSourceBytes),
    originArtifactRoot: "C:\\protected\\origin",
    originArtifactRootFingerprintSha256: launcher.originArtifactRootFingerprintSha256,
    originTask0BEvidenceSha256: releaseSha256V2(bundle.task0bBytes),
    originReleaseFreezeIdentitySha256: releaseSha256V2(bundle.freezeBytes),
    originPreparedFreezeMaterializationSha256: releaseSha256V2(bundle.preparedBytes),
    originFreezeMaterializationReceiptSha256: releaseSha256V2(bundle.receiptBytes)
  };
  const input = {
    candidateSha: CANDIDATE_SHA,
    previousRuntimeSha: current.previousRuntimeSha,
    previousRuntimeLabel: current.previousRuntimeLabel,
    managerExecutableSha256: launcher.executorSha256,
    startEvidenceSha256: current.previousRuntimeIdentity.startEvidenceSha256,
    binding,
    observedOriginArtifactRootFingerprintSha256: launcher.originArtifactRootFingerprintSha256,
    originTask0BEvidenceBytes: bundle.task0bBytes,
    originReleaseFreezeIdentityBytes: bundle.freezeBytes,
    originPreparedFreezeMaterializationBytes: bundle.preparedBytes,
    originFreezeMaterializationReceiptBytes: bundle.receiptBytes,
    ownerManagerSourceBytes,
    ownerIsAncestor: true
  };

  expect(api.validateTask0BHistoricalManagerLineage(input)).toEqual({
    ...launcher,
    sourceBlobSha256: binding.sourceBlobSha256,
    originTask0BEvidenceSha256: binding.originTask0BEvidenceSha256,
    originReleaseFreezeIdentitySha256: binding.originReleaseFreezeIdentitySha256,
    originPreparedFreezeMaterializationSha256: binding.originPreparedFreezeMaterializationSha256,
    originFreezeMaterializationReceiptSha256: binding.originFreezeMaterializationReceiptSha256
  });
  const forgedPrepared = JSON.parse(bundle.preparedBytes.toString("utf8"));
  forgedPrepared.bootstrapLeaseSha256 = SHA256("f");
  expect(() => api.validateTask0BHistoricalManagerLineage({
    ...input,
    originPreparedFreezeMaterializationBytes: Buffer.from(`${canonicalReleaseJsonV2(forgedPrepared)}\n`)
  })).toThrow(/historical|origin|materialization|bundle|binding/i);
  const replacement = completeArchivedOriginBundle(current, { leaseHash: SHA256("e") });
  expect(() => api.validateTask0BHistoricalManagerLineage({
    ...input,
    originPreparedFreezeMaterializationBytes: replacement.preparedBytes,
    originFreezeMaterializationReceiptBytes: replacement.receiptBytes
  })).toThrow(/historical|origin|materialization|hash|binding/i);
  const late = completeArchivedOriginBundle(current, { materializedAt: "2026-07-18T09:15:00.001Z" });
  expect(() => api.validateTask0BHistoricalManagerLineage({
    ...input,
    binding: {
      ...binding,
      originPreparedFreezeMaterializationSha256: releaseSha256V2(late.preparedBytes),
      originFreezeMaterializationReceiptSha256: releaseSha256V2(late.receiptBytes)
    },
    originPreparedFreezeMaterializationBytes: late.preparedBytes,
    originFreezeMaterializationReceiptBytes: late.receiptBytes
  })).toThrow(/historical|origin|materialization|window|time|binding/i);
});

it("[REQ-38][TASK0B-HISTORICAL-MANAGER-CAPTURE] keeps the historical launcher and current action manager as separate revalidated identities", async () => {
  const api: any = await import("../../scripts/captureTask0BPreflight");
  const expected = historicalManagerEvidence();
  const sanitized = Object.fromEntries([
    "databaseRole", "databaseName", "databaseFingerprintSha256", "operationalConfigPath", "operationalConfigSha256",
    "candidateStartCommandId", "candidateStartTemplateSha256", "candidateStopCommandId", "candidateStopTemplateSha256",
    "previousStartCommandId", "previousStartTemplateSha256", "previousStopCommandId", "previousStopTemplateSha256"
  ].map((key) => [key, (expected as any)[key]]));
  const previous = {
    sha: expected.previousRuntimeSha,
    label: expected.previousRuntimeLabel,
    source: "runtime_manager_attestation_and_process_direct_read",
    verified: true,
    identity: expected.previousRuntimeIdentity
  };
  const dependencies = {
    now: () => new Date(expected.observedAt),
    readOperatorConfigBinding: async () => expected.operatorConfig,
    readCandidateState: async () => ({
      sha: expected.candidateSha,
      clean: true,
      worktreePathFingerprintSha256: expected.candidateWorktree.worktreePathFingerprintSha256,
      source: "git_direct_read"
    }),
    readPreviousRuntime: async () => previous,
    readSanitizedRehearsalBinding: async () => sanitized,
    readRuntimeManager: async () => expected.runtimeManager,
    readProductionDatabase: async () => expected.productionDatabase,
    readRollbackWorktree: async () => expected.rollbackWorktree,
    readPostgresTools: async () => expected.postgresTools,
    inspectArtifactRoot: async () => expected.artifactRoot,
    probeCandidatePort: async () => expected.candidatePort
  };

  await expect(api.captureTask0BReleaseFreezeEvidence(dependencies)).resolves.toMatchObject({
    previousRuntimeIdentity: {
      managerExecutableSha256: SHA256("1"),
      historicalLauncher: { verified: true }
    },
    runtimeManager: { executorSha256: SHA256("6") }
  });
});

it("[REQ-38][TASK0B-HISTORICAL-MANAGER-CONFIG] accepts only an exact protected historical-launcher binding", async () => {
  const api: any = await import("../../scripts/captureTask0BPreflight");
  const evidence = buildTask0BReleaseFreezeEvidence();
  const issuedAt = "2026-07-18T09:00:00.000Z";
  const config: any = {
    version: "task0b-preflight-config-v1",
    source: "operator_approved_external_preflight_config",
    issuedAt,
    expiresAt: "2026-07-18T09:15:00.000Z",
    candidateSha: CANDIDATE_SHA,
    previousRuntimeSha: PREVIOUS_RUNTIME_SHA,
    previousRuntimeLabel: PREVIOUS_RUNTIME_LABEL,
    previousRuntimeIdentity: {
      kind: "manager_owned_previous_runtime",
      evidencePath: "runtime-start-evidence-previous-runtime-generation-0001.json",
      evidenceSha256: evidence.previousRuntimeIdentity.startEvidenceSha256,
      historicalLauncher: {
        ownerCandidateSha: "1".repeat(40),
        executorPath: "scripts/manageTask0BRuntime.ts",
        executorSha256: SHA256("1"),
        sourceBlobSha256: SHA256("2"),
        originArtifactRoot: "C:\\protected\\origin",
        originArtifactRootFingerprintSha256: SHA256("3"),
        originTask0BEvidenceSha256: SHA256("4"),
        originReleaseFreezeIdentitySha256: SHA256("5"),
        originPreparedFreezeMaterializationSha256: SHA256("6"),
        originFreezeMaterializationReceiptSha256: SHA256("7")
      }
    },
    databaseConnectionEnvName: "TASK0B_PRODUCTION_DATABASE_URL",
    productionDatabaseExpected: {
      ...TASK0B_EXPECTED_PRODUCTION_DATABASE,
      identityFingerprintSha256: TASK0B_EXPECTED_PRODUCTION_DATABASE_FINGERPRINT
    },
    rollbackWorktreePath: "C:\\protected\\rollback",
    artifactRoot: "C:\\protected\\candidate",
    candidatePort: { host: "127.0.0.1", port: 18787 },
    postgresToolProvider: {
      kind: "docker_pinned_image",
      immutableImageId: evidence.postgresTools.provider.immutableImageId,
      networkMode: "none",
      pullAllowed: false
    },
    runtimeManager: evidence.runtimeManager,
    sanitizedRehearsal: Object.fromEntries([
      "databaseRole", "databaseName", "databaseFingerprintSha256", "operationalConfigPath", "operationalConfigSha256",
      "candidateStartCommandId", "candidateStartTemplateSha256", "candidateStopCommandId", "candidateStopTemplateSha256",
      "previousStartCommandId", "previousStartTemplateSha256", "previousStopCommandId", "previousStopTemplateSha256"
    ].map((key) => [key, (evidence as any)[key]]))
  };

  expect(() => api.validateTask0BPreflightConfig(config, issuedAt)).not.toThrow();
  for (const mutate of [
    (value: any) => { value.previousRuntimeIdentity.historicalLauncher.ownerCandidateSha = CANDIDATE_SHA; },
    (value: any) => { value.previousRuntimeIdentity.historicalLauncher.originArtifactRoot = "relative"; },
    (value: any) => { value.previousRuntimeIdentity.historicalLauncher.sourceBlobSha256 = "unpinned"; }
  ]) {
    const forged = structuredClone(config);
    mutate(forged);
    expect(() => api.validateTask0BPreflightConfig(forged, issuedAt)).toThrow(/historical|manager|unverified/i);
  }
});

it("[REQ-38][TASK0B-HISTORICAL-GIT] strips Git overrides and disables replacement objects", async () => {
  const api: any = await import("../../scripts/captureTask0BPreflight");
  const env = api.task0BSanitizedGitEnvironment({
    PATH: "safe",
    SystemRoot: "C:\\Windows",
    GIT_DIR: "C:\\forged",
    git_object_directory: "C:\\objects",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.replaceRefs",
    GIT_CONFIG_VALUE_0: "true"
  });
  expect(env.PATH).toBe("safe");
  expect(env.SystemRoot).toBe("C:\\Windows");
  expect(env.GIT_DIR).toBeUndefined();
  expect(env.git_object_directory).toBeUndefined();
  expect(env.GIT_CONFIG_COUNT).toBeUndefined();
  expect(env.GIT_NO_REPLACE_OBJECTS).toBe("1");
  expect(env.GIT_CONFIG_NOSYSTEM).toBe("1");
  expect(env.GIT_TERMINAL_PROMPT).toBe("0");
});

it("[REQ-38][TASK0B-HISTORICAL-STOP-PREVIOUS] uses frozen launcher proof but keeps current manager as action authority", async () => {
  const api: any = await import("../../scripts/manageTask0BRuntime");
  const task0b = historicalManagerEvidence();
  const currentManagerSha256 = task0b.runtimeManager.executorSha256;
  expect(api.resolveStopRuntimeIdentityManagerSha256({
    commandId: "runtime_manager_stop_previous",
    currentManagerSha256,
    authorityStartEvidenceSha256: task0b.previousRuntimeIdentity.startEvidenceSha256,
    frozenPreviousRuntimeIdentity: task0b.previousRuntimeIdentity
  })).toBe(task0b.previousRuntimeIdentity.managerExecutableSha256);
  expect(api.resolveStopRuntimeIdentityManagerSha256({
    commandId: "runtime_manager_stop_candidate",
    currentManagerSha256,
    authorityStartEvidenceSha256: SHA256("8"),
    frozenPreviousRuntimeIdentity: task0b.previousRuntimeIdentity
  })).toBe(currentManagerSha256);
  expect(() => api.resolveStopRuntimeIdentityManagerSha256({
    commandId: "runtime_manager_stop_previous",
    currentManagerSha256,
    authorityStartEvidenceSha256: SHA256("9"),
    frozenPreviousRuntimeIdentity: task0b.previousRuntimeIdentity
  })).toThrow(/historical|previous|start|binding/i);
});

it("[REQ-38][TASK0B-HISTORICAL-MANAGER-REOPEN] reattaches only the frozen verified launcher lineage to reopened start evidence", async () => {
  const api: any = await import("../../src/release/productionOperationAdaptersV2");
  const frozen = historicalManagerEvidence().previousRuntimeIdentity as any;
  const reopened = structuredClone(frozen);
  delete reopened.historicalLauncher;

  expect(api.bindTask0BHistoricalManagerIdentity(reopened, frozen)).toEqual(frozen);
  for (const mutate of [
    (value: any) => { value.historicalLauncher.executorSha256 = SHA256("9"); },
    (value: any) => { value.historicalLauncher.verified = false; },
    (value: any) => { value.kind = "legacy_unmanaged_previous_runtime"; }
  ]) {
    const forged = structuredClone(frozen);
    mutate(forged);
    expect(() => api.bindTask0BHistoricalManagerIdentity(reopened, forged))
      .toThrow(/historical|manager|runtime|binding/i);
  }
});
