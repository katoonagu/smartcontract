import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  PRODUCTION_OPERATION_TAKEOVER_TEMPLATE_SHA256_V2,
  ProductionOperationStoreV2
} from "../../src/release/productionOperationStore";
import * as operationStoreApi from "../../src/release/productionOperationStore";
import {
  canonicalReleaseJsonV2,
  releaseSha256V2,
  rootWriterOwnerProcessIdentitySha256V2,
  validateCommittedProductionOperationLeaseTakeoverV2,
  validatePreparedProductionOperationLeaseTakeoverV2,
  validateProductionOperationLeaseV2
} from "../../src/release/remediationReleaseManifestV2";
import {
  advanceReleaseManifestV2,
  initializeReleaseManifestV2,
  issueOperationalAttestationV2,
  materializeReleaseFreezeV2,
  runWithRootWriterProcessRuntimeForTestsV2,
  selectOperationalAttestationFromStoreV2,
  terminalizeExpiredOperationalAttestationV2
} from "../../src/release/releaseManifestStoreV2";
import { executeProtectedProductionOperationV2 } from "../../src/release/productionReleaseOrchestratorV2";
import {
  buildReleaseManifestV2Fixture,
  buildTask0BReleaseFreezeEvidence
} from "../fixtures/release/remediationReleaseFixtures";
import { PRE_RELEASE_GATE_EVIDENCE_POLICY_V2 } from "../../src/release/releaseGateEvidencePolicy";

const roots: string[] = [];
const T0 = "2026-07-18T10:00:00.000Z";
const OWNER = { pid: 424_242, processStartFingerprintSha256: "1".repeat(64) };
const TAKEOVER_OWNER = { pid: 424_243, processStartFingerprintSha256: "2".repeat(64) };
const CLEANUP_OWNER = { pid: 424_244, processStartFingerprintSha256: "3".repeat(64) };
const CLEANUP_REPLAY_OWNER = { pid: 424_245, processStartFingerprintSha256: "4".repeat(64) };

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(`${canonicalReleaseJsonV2(value)}\n`, "utf8");
}

function rootFingerprint(root: string): string {
  const absolute = resolve(root);
  return createHash("sha256")
    .update(process.platform === "win32" ? absolute.toLowerCase() : absolute, "utf8")
    .digest("hex");
}

async function trustedRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "plan5-production-operation-"));
  if (process.platform === "win32") {
    const sid = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "[Security.Principal.WindowsIdentity]::GetCurrent().User.Value"], { encoding: "utf8" }).trim();
    execFileSync("icacls.exe", [root, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`,
      "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"]);
  }
  roots.push(root);
  return root;
}

async function initializedAuthorityRoot(
  previousRuntimeKind: "manager_owned_previous_runtime" | "legacy_unmanaged_previous_runtime"
    = "manager_owned_previous_runtime"
): Promise<string> {
  const root = await trustedRoot();
  const managedTask0B = buildTask0BReleaseFreezeEvidence({
    observedAt: T0,
    artifactRootFingerprintSha256: rootFingerprint(root)
  });
  const task0BPreflightEvidence = previousRuntimeKind === "legacy_unmanaged_previous_runtime"
    ? legacyTask0BEvidence(managedTask0B)
    : managedTask0B;
  await writeFile(join(root, "task0b-release-freeze.json"), canonicalBytes(task0BPreflightEvidence));
  await materializeReleaseFreezeV2({
    artifactRoot: root,
    task0BPreflightEvidence,
    evaluatedAt: T0,
    producerId: "release_freeze_materialize"
  });
  await initializeReleaseManifestV2({
    artifactRoot: root,
    evaluatedAt: T0,
    verifiedGateOutputs: await materializeInitialGateEvidence(root, task0BPreflightEvidence.candidateSha)
  });
  if (previousRuntimeKind === "manager_owned_previous_runtime") {
    await issueOperationalAttestationV2({ artifactRoot: root, action: "g14_rollout_passed" });
  }
  return root;
}

function legacyTask0BEvidence(managed: any): any {
  const task0b = structuredClone(managed);
  task0b.previousRuntimeSource = "legacy_unmanaged_process_admin_database_telegram_read_only";
  task0b.previousRuntimeIdentity = {
    kind: "legacy_unmanaged_previous_runtime",
    runtimeSha: task0b.previousRuntimeSha,
    runtimeLabel: task0b.previousRuntimeLabel,
    processId: 11088,
    processStartedAt: "2026-07-17T19:39:12.000Z",
    commandLineSha256: "a".repeat(64),
    executablePathSha256: "b".repeat(64),
    workingDirectoryFingerprintSha256: "3".repeat(64),
    entrypointPathFingerprintSha256: "c".repeat(64),
    adminObservation: {
      endpointFingerprintSha256: "4".repeat(64), httpStatus: 200,
      runtimeVersionSha256: "5".repeat(64), observedRuntimeSha: task0b.previousRuntimeSha,
      observedRuntimeLabel: task0b.previousRuntimeLabel,
      source: "loopback_admin_runtime_proof_read_only", verified: true
    },
    productionDatabaseObservation: {
      approvedIdentityFingerprintSha256: task0b.productionDatabase.approvedIdentityFingerprintSha256,
      schemaState: task0b.productionDatabase.schemaState,
      schemaReceiptSetSha256: task0b.productionDatabase.schemaReceiptSet.aggregateSha256,
      source: "task0b_production_database_read_only_binding", verified: true
    },
    telegramObservation: {
      mode: "long_polling", botIdentitySha256: "8".repeat(64),
      webhookUrlSha256: createHash("sha256").update("").digest("hex"),
      source: "telegram_getme_and_getwebhookinfo_read_only", verified: true
    },
    actionPolicy: {
      managerOwned: false, stopStartRollbackAuthorized: false,
      requiresPassedPreReleaseGates: true, requiresMergedCandidate: true,
      requiresExplicitProductionGo: true, requiresActionSpecificAuthority: true
    },
    source: "legacy_unmanaged_process_admin_database_telegram_read_only", verified: true
  };
  return task0b;
}

function artifactTreeSnapshot(root: string, relative = ""): string[] {
  return readdirSync(join(root, relative), { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      return entry.isDirectory()
        ? [`${child}/`, ...artifactTreeSnapshot(root, child)]
        : [`${child}:${releaseSha256V2(readFileSync(join(root, child)))}`];
    });
}

async function materializeInitialGateEvidence(root: string, candidateSha: string) {
  const task0bBytes = readFileSync(join(root, "task0b-release-freeze.json"));
  const task0b = JSON.parse(task0bBytes.toString("utf8"));
  const freezeBytes = readFileSync(join(root, "release-freeze-identity-v2.json"));
  const freeze = JSON.parse(freezeBytes.toString("utf8"));
  const platform = task0b.artifactRoot.accessControlSource ===
      "windows_acl_direct_read"
    ? "windows"
    : "posix";
  const trustedPolicy = {
    version: "trusted-os-principal-policy-v2",
    policyId: platform === "windows"
      ? "windows-configured-canonical-set-v1"
      : "posix-owner-only-v1",
    platform,
    normalizedTrustedPrincipalSetSha256: releaseSha256V2(
      canonicalReleaseJsonV2(["test-principal"])
    ),
    trustedPrincipalCount: 1,
    candidateSha,
    releaseGenerationId: freeze.releaseGenerationId,
    artifactRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
    releaseFreezeIdentitySha256: releaseSha256V2(freezeBytes),
    task0BPreflightEvidenceSha256: releaseSha256V2(task0bBytes),
    ownerIdentityFingerprintSha256:
      task0b.artifactRoot.ownerIdentityFingerprintSha256,
    accessControlFingerprintSha256:
      task0b.artifactRoot.accessControlFingerprintSha256,
    authoritativePolicySource: "task0b_allowlisted_writer_principals_v2",
    observedAt: T0,
    source: "task0b_acl_policy_read_only",
    verified: true
  };
  const trustedPolicyBytes = canonicalBytes(trustedPolicy);
  const trustBoundary = {
    version: "artifact-root-trust-boundary-evidence-v1",
    candidateSha,
    releaseGenerationId: freeze.releaseGenerationId,
    artifactRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
    releaseFreezeIdentitySha256: releaseSha256V2(freezeBytes),
    task0BPreflightEvidenceSha256: releaseSha256V2(task0bBytes),
    artifactRootObservationSha256:
      freeze.artifactRootTrustBoundaryEvidenceSha256,
    trustedOsPrincipalPolicySha256: releaseSha256V2(trustedPolicyBytes),
    ownerIdentityFingerprintSha256:
      task0b.artifactRoot.ownerIdentityFingerprintSha256,
    accessControlFingerprintSha256:
      task0b.artifactRoot.accessControlFingerprintSha256,
    accessControlSource: task0b.artifactRoot.accessControlSource,
    outsideRepository: true,
    noSymlink: true,
    restrictiveAccessVerified: true,
    exclusiveWriteVerified: true,
    observedAt: T0,
    source: "task0b_protected_root_acl_read_only",
    verified: true
  };
  await writeFile(
    join(root, "trusted-os-principal-policy-v2.json"),
    trustedPolicyBytes
  );
  await writeFile(
    join(root, "artifact-root-trust-boundary-evidence-v1.json"),
    canonicalBytes(trustBoundary)
  );
  const gates = buildReleaseManifestV2Fixture().gates.filter((gate) => gate.state === "passed");
  for (const gate of gates) {
    const policy = PRE_RELEASE_GATE_EVIDENCE_POLICY_V2[gate.id as keyof typeof PRE_RELEASE_GATE_EVIDENCE_POLICY_V2];
    const paths = [...policy.primaryPaths];
    for (const [index, kind] of policy.requiredKinds.entries()) {
      if (index >= paths.length) paths.push(`gates/${gate.id.toLowerCase()}/${kind}.json`);
    }
    gate.evidence = [];
    for (const [index, relativePath] of paths.entries()) {
      const path = join(root, ...relativePath.split("/"));
      if (!existsSync(path)) {
        await mkdir(resolve(path, ".."), { recursive: true });
        await writeFile(path, canonicalBytes({ version: "gate-evidence-v2", candidateSha,
          gateId: gate.id, kind: policy.requiredKinds[index] ?? policy.allowedKinds[0] }));
      }
      const bytes = readFileSync(path);
      const parsed = JSON.parse(bytes.toString("utf8"));
      const g00Kind = relativePath === "trusted-os-principal-policy-v2.json"
        ? "trusted_os_principal_policy"
        : relativePath === "task0-baseline.json"
          ? "task0_baseline"
          : "release_freeze_materialization";
      gate.evidence.push({
        kind: gate.id === "G00_BASE"
          ? g00Kind
          : policy.requiredKinds[index] ?? policy.allowedKinds[0],
        relativePath,
        sha256: releaseSha256V2(bytes),
        schemaVersion: parsed.version,
        candidateSha
      } as never);
    }
  }
  return gates;
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("treats canary observation receipts as an attempted production effect", () => {
  const attempted = (operationStoreApi as any).productionOperationAttemptedExternalEffectV2;
  expect(typeof attempted).toBe("function");
  expect(attempted("canary", false, ["local_validation"])).toBe(true);
  expect(attempted("rollout", false, ["local_validation"])).toBe(false);
});

it("durably acquires lease then persists immutable preclaim lineage and atomic consumption claim", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(T0));
  const root = await initializedAuthorityRoot();
  const store = new ProductionOperationStoreV2(root);
  const begun = await runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => OWNER,
    isOwnerAlive: () => false
  }, () => (store as any).beginOperation({ operationKind: "rollout", evaluatedAt: T0 }));

  expect(begun.selectedAuthority.action).toBe("g14_rollout_passed");
  expect(begun.lease).toMatchObject({ leaseEpoch: 1, capability: "effect_capable", ownerPid: OWNER.pid });
  expect(begun.preclaim).toMatchObject({
    originalLeaseSha256: begun.leaseSha256,
    originalLeaseEpoch: 1,
    operationId: begun.lease.operationId
  });
  expect(begun.lineage).toMatchObject({
    previousLineageSha256: null,
    currentTipLeaseSha256: begun.leaseSha256,
    committedTakeoverReceiptSuffixSha256s: []
  });
  expect(begun.claim.authorityConsumption).toMatchObject({
    leaseSha256AtConsumption: begun.leaseSha256,
    preclaimLeaseLineageSha256: begun.lineageSha256
  });
  expect(begun.claim.authorityConsumptionSha256)
    .toBe(releaseSha256V2(canonicalBytes(begun.claim.authorityConsumption)));
  expect(existsSync(join(root, "production-operation-root.lease.json"))).toBe(true);
  expect(readdirSync(root).filter((name) => name.startsWith("production-operation-claim-")))
    .toHaveLength(1);
  expect(existsSync(join(root,
    `operational-attestation-consumption-${begun.selectedAuthoritySha256}.json`))).toBe(false);
  expect(() => selectOperationalAttestationFromStoreV2({
    artifactRoot: root,
    action: "g14_rollout_passed",
    expectedSourceManifestSha256: begun.lease.sourceManifestSha256,
    evaluatedAt: "2026-07-18T10:00:01.000Z",
    minimumRemainingValidityMs: 0
  })).toThrow("operational_authority_tip_ambiguous");
  const heartbeat = await runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => OWNER,
    isOwnerAlive: () => true
  }, () => store.heartbeat(begun.lease.operationId, "2026-07-18T10:00:05.000Z"));
  expect(heartbeat.lease).toMatchObject({
    leaseEpoch: 2,
    heartbeatAt: "2026-07-18T10:00:05.000Z",
    expiresAt: "2026-07-18T10:01:05.000Z"
  });
  const preclaimBefore = readFileSync(join(root,
    `production-authority-preclaim-${begun.lease.operationId}.json`));

  const replay = await runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => OWNER,
    isOwnerAlive: () => true
  }, () => store.beginOperation({
    operationKind: "rollout", evaluatedAt: "2026-07-18T10:00:30.000Z"
  }));
  expect(replay.claimSha256).toBe(begun.claimSha256);
  expect(replay.lease.operationDeadlineAt).toBe(begun.lease.operationDeadlineAt);
  expect(readFileSync(join(root,
    `production-authority-preclaim-${begun.lease.operationId}.json`))).toEqual(preclaimBefore);

  const takeoverAt = "2026-07-18T10:01:05.000Z";
  const stillOwned = await runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => OWNER,
    isOwnerAlive: () => true
  }, () => store.assertOwnedAndWithinBounds(begun.lease.operationId,
    "2026-07-18T10:01:04.999Z"));
  expect(stillOwned.leaseSha256).toBe(heartbeat.leaseSha256);
  await expect(runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => TAKEOVER_OWNER,
    isOwnerAlive: () => true
  }, () => store.takeoverEffectCapable({
    expectedOldLeaseSha256: heartbeat.leaseSha256,
    evaluatedAt: takeoverAt
  }))).rejects.toThrow("production_operation_owner_still_alive");
  await expect(runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => TAKEOVER_OWNER,
    isOwnerAlive: () => false
  }, () => store.takeoverEffectCapable({
    expectedOldLeaseSha256: heartbeat.leaseSha256,
    evaluatedAt: takeoverAt,
    faultAt: "after_prepare"
  }))).rejects.toThrow("injected_fault_after_prepare");
  await expect(runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => TAKEOVER_OWNER,
    isOwnerAlive: () => false
  }, () => store.takeoverEffectCapable({
    expectedOldLeaseSha256: heartbeat.leaseSha256,
    evaluatedAt: "2026-07-18T10:10:00.000Z"
  }))).rejects.toThrow("production_operation_deadline_reached");
  const takeover = await runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => TAKEOVER_OWNER,
    isOwnerAlive: () => false
  }, () => store.takeoverEffectCapable({
    expectedOldLeaseSha256: heartbeat.leaseSha256,
    evaluatedAt: "2026-07-18T10:01:06.000Z"
  }));
  const takeoverLease = JSON.parse(readFileSync(join(root,
    "production-operation-root.lease.json"), "utf8"));
  expect(takeover).toMatchObject({
    oldLeaseSha256: heartbeat.leaseSha256,
    newLeaseEpoch: 3,
    newLeaseSha256: releaseSha256V2(canonicalBytes(takeoverLease))
  });
  expect(takeoverLease).toMatchObject({ leaseEpoch: 3, ownerPid: TAKEOVER_OWNER.pid });
  const verifiedTakeover = store.verifyImmutableAuthorityLineage(
    begun.lease.operationId, "2026-07-18T10:01:06.001Z"
  );
  expect(verifiedTakeover).toMatchObject({
    leaseSha256: takeover.newLeaseSha256,
    claimSha256: begun.claimSha256
  });
  expect(verifiedTakeover.takeoverChainSha256).toMatch(/^[0-9a-f]{64}$/u);
  expect(verifiedTakeover.lineageLeaseTips).toEqual([
    { sha256: begun.leaseSha256, epoch: 1 },
    { sha256: heartbeat.leaseSha256, epoch: 2 },
    { sha256: takeover.newLeaseSha256, epoch: 3 }
  ]);
  await expect(store.takeoverEffectCapable({ expectedOldLeaseSha256: heartbeat.leaseSha256,
    evaluatedAt: "2026-07-18T10:01:06.002Z" })).resolves.toEqual(takeover);
  const committedName = `production-operation-root.lease-takeover-committed-${releaseSha256V2(canonicalBytes(takeover))}.json`;
  const committedPath = join(root, committedName);
  const hiddenPath = join(root, `${committedName}.hidden`);
  await rename(committedPath, hiddenPath);
  expect(() => store.verifyImmutableAuthorityLineage(
    begun.lease.operationId, "2026-07-18T10:01:06.002Z"
  )).toThrow(/takeover.*chain/i);
  await rename(hiddenPath, committedPath);
  const branch = { ...takeover, committedAt: "2026-07-18T10:01:06.003Z" };
  const branchBytes = canonicalBytes(branch);
  const branchPath = join(root,
    `production-operation-root.lease-takeover-committed-${releaseSha256V2(branchBytes)}.json`);
  await writeFile(branchPath, branchBytes);
  await expect(store.takeoverEffectCapable({ expectedOldLeaseSha256: heartbeat.leaseSha256,
    evaluatedAt: "2026-07-18T10:01:06.004Z" })).rejects.toThrow(/takeover.*(?:chain|ancestor|invalid|ambiguous)/i);
  expect(() => store.verifyImmutableAuthorityLineage(
    begun.lease.operationId, "2026-07-18T10:01:06.004Z"
  )).toThrow(/takeover.*chain|committed/i);
  await unlink(branchPath);
  expect(() => store.verifyImmutableAuthorityLineage(
    `production-rollout-${"f".repeat(64)}`, "2026-07-18T10:01:06.005Z"
  )).toThrow(/lineage.*operation/i);

  const cleanupAt = "2026-07-18T10:10:00.000Z";
  await expect(runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => CLEANUP_OWNER,
    isOwnerAlive: () => false
  }, () => store.takeoverCleanupOnly({
    expectedOldLeaseSha256: takeover.newLeaseSha256,
    evaluatedAt: cleanupAt,
    faultAt: "after_committed"
  }))).rejects.toThrow("injected_fault_after_committed");
  const terminal = await runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => CLEANUP_REPLAY_OWNER,
    isOwnerAlive: () => false
  }, () => store.takeoverCleanupOnly({
    expectedOldLeaseSha256: takeover.newLeaseSha256,
    evaluatedAt: "2026-07-18T10:11:00.000Z"
  }));
  expect(terminal.takeover).toMatchObject({
    terminalReason: "operation_deadline_reached",
    newLeaseEpoch: 4
  });
  expect(terminal.abandoned).toMatchObject({
    reason: "operation_deadline_reached",
    capability: "cleanup_only",
    finalLeaseEpoch: 4,
    claimSha256: begun.claimSha256
  });
  expect(terminal.cleanup).toMatchObject({
    operationId: begun.lease.operationId,
    capability: "cleanup_only"
  });
  expect(existsSync(join(root, "production-operation-root.lease.json"))).toBe(false);
}, 120_000);

it("revalidates current manifest receipt lineage before every owned production operation", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(T0));
  const root = await initializedAuthorityRoot();
  const store = new ProductionOperationStoreV2(root);
  const begun = await runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => OWNER,
    isOwnerAlive: () => false
  }, () => store.beginOperation({ operationKind: "rollout", evaluatedAt: T0 }));
  const manifest = JSON.parse(readFileSync(join(root, "release-manifest.json"), "utf8"));
  const receiptPath = join(root, `manifest-transition-receipt-${manifest.latestCommittedReceiptSha256}.json`);
  await writeFile(receiptPath, Buffer.concat([readFileSync(receiptPath), Buffer.from(" ")]));
  expect(() => runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => OWNER,
    isOwnerAlive: () => true
  }, () => store.assertOwnedAndWithinBounds(begun.lease.operationId, "2026-07-18T10:00:01.000Z")))
    .toThrow(/manifest|receipt|canonical|hash/i);
}, 45_000);

it("rejects changed executed gate evidence before creating a production lease, claim, or manifest transition", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(T0));
  const root = await trustedRoot();
  const task0BPreflightEvidence = buildTask0BReleaseFreezeEvidence({
    observedAt: T0,
    artifactRootFingerprintSha256: rootFingerprint(root)
  });
  await writeFile(join(root, "task0b-release-freeze.json"), canonicalBytes(task0BPreflightEvidence));
  await materializeReleaseFreezeV2({
    artifactRoot: root,
    task0BPreflightEvidence,
    evaluatedAt: T0,
    producerId: "release_freeze_materialize"
  });
  const gates = await materializeInitialGateEvidence(root, task0BPreflightEvidence.candidateSha);
  await initializeReleaseManifestV2({ artifactRoot: root, evaluatedAt: T0, verifiedGateOutputs: gates });
  await issueOperationalAttestationV2({ artifactRoot: root, action: "g14_rollout_passed" });
  const evidencePath = "suite-plan1.evidence.json";
  await writeFile(join(root, evidencePath), Buffer.concat([readFileSync(join(root, evidencePath)), Buffer.from(" ")]));

  const store = new ProductionOperationStoreV2(root);
  await expect(runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => OWNER,
    isOwnerAlive: () => false
  }, () => store.beginOperation({ operationKind: "rollout", evaluatedAt: T0 })))
    .rejects.toThrow(/gate_evidence|evidence.*bytes|canonical/i);
  expect(existsSync(join(root, "production-operation-root.lease.json"))).toBe(false);
  expect(readdirSync(root).filter((name) => name.startsWith("production-operation-claim-"))).toEqual([]);
  const transitionArtifactsBefore = readdirSync(root).filter((name) =>
    name.startsWith("manifest-transition-claim-") || name.startsWith("manifest-transition-prepared-"));
  await expect(advanceReleaseManifestV2({
    artifactRoot: root,
    sourceManifest: JSON.parse(readFileSync(join(root, "release-manifest.json"), "utf8")),
    transition: { transitionId: "g12_backup_passed" },
    verifiedGateOutputs: [],
    verifiedTransitionEvidence: {}
  } as never)).rejects.toThrow(/gate_evidence|evidence.*bytes|canonical/i);
  expect(readdirSync(root).filter((name) =>
    name.startsWith("manifest-transition-claim-") || name.startsWith("manifest-transition-prepared-")))
    .toEqual(transitionArtifactsBefore);
}, 45_000);

it("rejects a replacement tip when an expired terminal authority later gains a use artifact", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(T0));
  const root = await initializedAuthorityRoot();
  const first = selectOperationalAttestationFromStoreV2({
    artifactRoot: root,
    action: "g14_rollout_passed",
    expectedSourceManifestSha256: releaseSha256V2(readFileSync(join(root, "release-manifest.json"))),
    evaluatedAt: T0,
    minimumRemainingValidityMs: 0
  });
  await terminalizeExpiredOperationalAttestationV2({
    artifactRoot: root,
    authority: first.authority,
    evaluatedAt: "2026-07-18T10:16:00.000Z"
  });
  vi.setSystemTime(new Date("2026-07-18T10:16:01.000Z"));
  const replacement = await issueOperationalAttestationV2({ artifactRoot: root, action: "g14_rollout_passed" });
  await writeFile(join(root, "production-backup.dump"), Buffer.from("PGDMP normal binary artifact"));
  await writeFile(join(root, "production-backup-restore-list.txt"), Buffer.from("1; TABLE public normal\n"));
  expect(selectOperationalAttestationFromStoreV2({
    artifactRoot: root,
    action: "g14_rollout_passed",
    expectedSourceManifestSha256: replacement.sourceManifestSha256,
    evaluatedAt: "2026-07-18T10:16:01.001Z",
    minimumRemainingValidityMs: 0
  }).attestationSha256).toBe(replacement.attestationSha256);
  await writeFile(join(root, `production-claim-conflict-${first.attestationSha256}.json`), canonicalBytes({
    version: "production-claim-conflict-v2",
    operationalAttestationSha256: first.attestationSha256,
    releaseGenerationId: first.authority.generationId,
    candidateSha: first.authority.candidateSha
  }));

  expect(() => selectOperationalAttestationFromStoreV2({
    artifactRoot: root,
    action: "g14_rollout_passed",
    expectedSourceManifestSha256: replacement.sourceManifestSha256,
    evaluatedAt: "2026-07-18T10:16:01.002Z",
    minimumRemainingValidityMs: 0
  })).toThrow("authority_terminal_use_artifact_conflict");
}, 45_000);

it("persists one recovered effect receipt after a same-claim committed heartbeat and rejects a foreign intent lease", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(T0));
  const root = await initializedAuthorityRoot();
  const store = new ProductionOperationStoreV2(root);
  const begun = await runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => OWNER,
    isOwnerAlive: () => false
  }, () => store.beginOperation({ operationKind: "rollout", evaluatedAt: T0 }));
  const intent = {
    version: "production-orchestration-step-intent-v2" as const,
    capability: "effect_capable" as const,
    orchestration: "rollout" as const,
    operationId: begun.lease.operationId,
    operationClaimSha256: begun.claimSha256,
    authorityConsumptionSha256: begun.claim.authorityConsumptionSha256,
    sequence: 5,
    stepId: "stop_previous" as const,
    attempt: 1 as const,
    relativePath: `production-operation-step-intents/${begun.lease.operationId}/5-stop_previous-1-v2.json`,
    currentOperationLeaseSha256: begun.leaseSha256,
    currentOperationLeaseEpoch: begun.lease.leaseEpoch,
    commandId: "production_rollout" as const,
    redactedTemplateSha256: begun.selectedAuthority.redactedTemplateSha256,
    inputSha256: "5".repeat(64),
    intendedExternalEffectSha256: "6".repeat(64),
    preparedAt: T0
  };
  const intentRecord = await runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => OWNER,
    isOwnerAlive: () => true
  }, () => store.persistStepIntent(intent));
  const heartbeat = await runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => OWNER,
    isOwnerAlive: () => true
  }, () => store.heartbeat(begun.lease.operationId, "2026-07-18T10:00:05.000Z"));
  expect(runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => OWNER,
    isOwnerAlive: () => true
  }, () => store.loadStepIntent(begun.lease.operationId, 5, "stop_previous",
    "2026-07-18T10:00:05.001Z"))).toMatchObject({ sha256: intentRecord.sha256, intent });
  const receipt = {
    version: "production-orchestration-step-receipt-v2" as const,
    operationId: begun.lease.operationId,
    operationClaimSha256: begun.claimSha256,
    authorityConsumptionSha256: begun.claim.authorityConsumptionSha256,
    operationLeaseSha256: heartbeat.leaseSha256,
    operationLeaseEpoch: heartbeat.lease.leaseEpoch,
    operationDeadlineAt: begun.lease.operationDeadlineAt,
    inputSha256: intent.inputSha256,
    outputSha256: "7".repeat(64),
    observedStateSha256: "8".repeat(64),
    sequence: 5,
    startedAt: T0,
    finishedAt: "2026-07-18T10:00:05.001Z",
    recoveredAfterCrash: true,
    verifiedChecks: null,
    result: "completed" as const,
    capability: "effect_capable" as const,
    commandId: "production_rollout" as const,
    redactedTemplateSha256: begun.selectedAuthority.redactedTemplateSha256,
    executionKind: "external_effect" as const,
    stepIntentRelativePath: intent.relativePath,
    stepIntentSha256: intentRecord.sha256,
    orchestration: "rollout" as const,
    stepId: "stop_previous" as const
  };
  expect(runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => OWNER,
    isOwnerAlive: () => true
  }, () => store.persistStepReceipt(receipt))).toMatchObject({ created: true });
  expect(runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => OWNER,
    isOwnerAlive: () => true
  }, () => store.persistStepReceipt(receipt))).toMatchObject({ created: false });

  const foreignIntent = { ...intent, currentOperationLeaseSha256: "9".repeat(64),
    sequence: 7, stepId: "start_candidate" as const,
    relativePath: `production-operation-step-intents/${begun.lease.operationId}/7-start_candidate-1-v2.json` };
  await writeFile(join(root, foreignIntent.relativePath), canonicalBytes(foreignIntent));
  const foreignReceipt = { ...receipt, stepIntentSha256: releaseSha256V2(canonicalBytes(foreignIntent)),
    sequence: 7, stepId: "start_candidate" as const,
    stepIntentRelativePath: foreignIntent.relativePath };
  expect(() => runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => OWNER,
    isOwnerAlive: () => true
  }, () => store.persistStepReceipt(foreignReceipt))).toThrow(/intent.*binding/i);
}, 45_000);

it("resumes a real operation after an external receipt was durably written and skips every completed effect and query", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(T0));
  const root = await initializedAuthorityRoot();
  const store = new ProductionOperationStoreV2(root);
  const effects: string[] = [];
  const validations: string[] = [];
  const adapters = {
    now: () => T0,
    async loadReleaseContext() { return { releaseFreezeIdentitySha256:
      releaseSha256V2(readFileSync(join(root, "release-freeze-identity-v2.json"))),
      previousRuntimeKind: "manager_owned_previous_runtime" as const }; },
    async validateStep(input: any) {
      validations.push(input.stepId);
      return { inputSha256: input.inputSha256, outputSha256: "1".repeat(64),
        observedStateSha256: "2".repeat(64),
        ...(input.stepId === "immediate_runtime_checks" ? { verifiedChecks: [
          "schema", "version", "admin", "singleton", "workers", "logs", "delivery", "legacy"
        ] } : {}) };
    },
    async prepareEffect(input: any) { return createHash("sha256").update(input.stepId).digest("hex"); },
    async executeEffect(input: any) {
      effects.push(input.stepId);
      return { inputSha256: input.inputSha256, outputSha256: "3".repeat(64),
        observedStateSha256: "4".repeat(64) };
    },
    async reconcileEffect() { throw new Error("completed_effect_must_not_reconcile"); }
  } as any;
  const persistReceipt = store.persistStepReceipt.bind(store);
  let injected = false;
  (store as any).persistStepReceipt = (value: any) => {
    const record = persistReceipt(value);
    if (!injected && value.stepId === "stop_previous") {
      injected = true;
      throw new Error("crash_after_external_receipt_fsync");
    }
    return record;
  };
  await expect(runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => OWNER,
    isOwnerAlive: () => true
  }, () => executeProtectedProductionOperationV2({ artifactRoot: root, operationKind: "rollout" },
    { store: store as any, adapters }))).rejects.toThrow("crash_after_external_receipt_fsync");
  (store as any).persistStepReceipt = persistReceipt;
  await expect(runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => OWNER,
    isOwnerAlive: () => true
  }, () => executeProtectedProductionOperationV2({ artifactRoot: root, operationKind: "rollout" },
    { store: store as any, adapters }))).resolves.toMatchObject({
      completedSteps: ["verify_g13", "verify_schema", "verify_previous_runtime_identity",
        "verify_singleton_precondition", "stop_previous", "prove_previous_stopped", "start_candidate",
        "prove_candidate_started", "immediate_runtime_checks"]
    });
  expect(effects).toEqual(["stop_previous", "start_candidate"]);
  expect(validations.filter((step) => ["verify_g13", "verify_schema", "verify_previous_runtime_identity",
    "verify_singleton_precondition"].includes(step))).toHaveLength(4);
  expect(existsSync(join(root, "production-operation-root.lease.json"))).toBe(false);
}, 150_000);

it.each([
  "after_step_receipt:immediate_runtime_checks",
  "after_orchestration_receipt",
  "after_query_captures",
  "after_auxiliary_captures",
  "after_terminal_evidence",
  "after_terminal_index",
  "after_settlement",
  "after_terminal_publication",
  "after_removal_prepare",
  "after_lease_removal",
  "after_removal_receipt",
  "after_terminal_cleanup"
])("resumes byte-exactly at %s and publishes canonical evidence only after settlement", async (faultAt) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(T0));
    const root = await initializedAuthorityRoot();
    const store = new ProductionOperationStoreV2(root);
    const effects: string[] = [];
    const validations: string[] = [];
    const adapters = {
      now: () => T0,
      async loadReleaseContext() { return { releaseFreezeIdentitySha256:
        releaseSha256V2(readFileSync(join(root, "release-freeze-identity-v2.json"))),
        previousRuntimeKind: "manager_owned_previous_runtime" as const }; },
      async validateStep(input: any) {
        validations.push(input.stepId);
        return { inputSha256: input.inputSha256, outputSha256: "1".repeat(64),
          observedStateSha256: "2".repeat(64),
          ...(input.stepId === "immediate_runtime_checks" ? { verifiedChecks: [
            "schema", "version", "admin", "singleton", "workers", "logs", "delivery", "legacy"
          ] } : {}) };
      },
      async prepareEffect(input: any) { return createHash("sha256").update(input.stepId).digest("hex"); },
      async executeEffect(input: any) {
        effects.push(input.stepId);
        return { inputSha256: input.inputSha256, outputSha256: "3".repeat(64),
          observedStateSha256: "4".repeat(64) };
      },
      async reconcileEffect() { throw new Error("completed_effect_must_not_reconcile"); }
    } as any;
    await expect(runWithRootWriterProcessRuntimeForTestsV2({
      currentOwnerIdentity: () => OWNER, isOwnerAlive: () => true
    }, () => executeProtectedProductionOperationV2({
      artifactRoot: root, operationKind: "rollout", faultAt
    }, { store: store as any, adapters }))).rejects.toThrow(/injected_(?:operation_)?fault/);

    const operationDirectory = join(root, "production-operation-terminal-artifacts");
    const before = existsSync(operationDirectory)
      ? Object.fromEntries(readdirSync(operationDirectory, { recursive: true })
        .filter((name) => String(name).endsWith(".json"))
        .map((name) => [String(name), readFileSync(join(operationDirectory, String(name)))])) : {};
    if (["after_step_receipt:immediate_runtime_checks", "after_orchestration_receipt",
      "after_query_captures", "after_auxiliary_captures", "after_terminal_evidence", "after_terminal_index",
      "after_settlement"].includes(faultAt)) {
      expect(existsSync(join(root, "production-rollout-evidence-v2.json"))).toBe(false);
    }
    if (faultAt === "after_settlement") {
      const leaseBytes = readFileSync(join(root, "production-operation-root.lease.json"));
      await expect(runWithRootWriterProcessRuntimeForTestsV2({
        currentOwnerIdentity: () => CLEANUP_OWNER, isOwnerAlive: () => false
      }, () => store.takeoverCleanupOnly({ expectedOldLeaseSha256: releaseSha256V2(leaseBytes),
        evaluatedAt: "2026-07-18T10:11:00.000Z" })))
        .rejects.toThrow("production_operation_settlement_resume_required");
      expect(existsSync(join(root, "production-rollout-evidence-v2.json"))).toBe(false);
      const operationId = readdirSync(root).find((name) =>
        name.startsWith("production-operation-settlement-production-rollout-"))!
        .replace(/^production-operation-settlement-/u, "").replace(/\.json$/u, "");
      const capturesPath = join(root, "production-operation-terminal-artifacts", operationId,
        "production-rollout-query-captures-v2.json");
      const indexPath = join(root, `production-terminal-artifact-index-${operationId}.json`);
      const capturesBytes = readFileSync(capturesPath);
      const indexBytes = readFileSync(indexPath);
      const captures = JSON.parse(capturesBytes.toString("utf8"));
      captures.captures[0].outputSha256 = "a".repeat(64);
      const tamperedCapturesBytes = canonicalBytes(captures);
      const index = JSON.parse(indexBytes.toString("utf8"));
      index.artifacts.find((artifact: any) => artifact.kind === "rollout_captures").sha256 =
        releaseSha256V2(tamperedCapturesBytes);
      await writeFile(capturesPath, tamperedCapturesBytes);
      await writeFile(indexPath, canonicalBytes(index));
      await expect(runWithRootWriterProcessRuntimeForTestsV2({
        currentOwnerIdentity: () => CLEANUP_OWNER, isOwnerAlive: () => false
      }, async () => store.resumeCompletedSettlementBeforeBegin("rollout", T0)))
        .rejects.toThrow(/terminal_bundle|capture.*binding/i);
      await writeFile(capturesPath, capturesBytes);
      await writeFile(indexPath, indexBytes);
    }
    if (faultAt === "after_lease_removal") {
      const operationId = readdirSync(root).find((name) =>
        name.startsWith("production-operation-settlement-production-rollout-"))!
        .replace(/^production-operation-settlement-/u, "").replace(/\.json$/u, "");
      const preparedPath = join(root, `production-operation-lease-removal-prepared-${operationId}.json`);
      const preparedBytes = readFileSync(preparedPath);
      await unlink(preparedPath);
      expect(() => store.resumeCompletedSettlementBeforeBegin("rollout", T0))
        .toThrow(/parent_missing|ENOENT|prepared/i);
      await writeFile(preparedPath, preparedBytes);
      const settlementPath = join(root, `production-operation-settlement-${operationId}.json`);
      const settlementBytes = readFileSync(settlementPath);
      const settlement = JSON.parse(settlementBytes.toString("utf8"));
      await writeFile(settlementPath, canonicalBytes({ ...settlement,
        sourceManifestSha256: "f".repeat(64) }));
      expect(store.resumeCompletedSettlementBeforeBegin("rollout", T0)).toBeNull();
      await writeFile(settlementPath, settlementBytes);
      const claimName = readdirSync(root).find((name) => name.startsWith("production-operation-claim-"))!;
      const claim = JSON.parse(readFileSync(join(root, claimName), "utf8"));
      const lineagePath = join(root, ...String(claim.preclaimLeaseLineageRelativePath).split("/"));
      const lineageBytes = readFileSync(lineagePath);
      await unlink(lineagePath);
      expect(() => store.resumeCompletedSettlementBeforeBegin("rollout", T0))
        .toThrow(/parent_missing|ENOENT|lineage/i);
      await writeFile(lineagePath, lineageBytes);
      const lineage = JSON.parse(lineageBytes.toString("utf8"));
      await writeFile(lineagePath, canonicalBytes({ ...lineage,
        operationId: `production-rollout-${"f".repeat(64)}` }));
      expect(() => store.resumeCompletedSettlementBeforeBegin("rollout", T0))
        .toThrow(/lineage|binding/i);
      await writeFile(lineagePath, lineageBytes);
      const attestationPath = join(root, "operational-attestations", "g14_rollout_passed",
        claim.releaseGenerationId, `${claim.operationalAttestationSha256}.json`);
      const attestationBytes = readFileSync(attestationPath);
      await unlink(attestationPath);
      expect(() => store.resumeCompletedSettlementBeforeBegin("rollout", T0))
        .toThrow(/parent_missing|ENOENT|authority|attestation/i);
      await writeFile(attestationPath, attestationBytes);
      const committedAuthorityPath = join(root, "operational-attestation-issuance-committed",
        "g14_rollout_passed", claim.releaseGenerationId,
        `${claim.operationalAttestationIssuerReceiptSha256}.json`);
      const committedAuthorityBytes = readFileSync(committedAuthorityPath);
      await unlink(committedAuthorityPath);
      expect(() => store.resumeCompletedSettlementBeforeBegin("rollout", T0))
        .toThrow(/committed|issuance|parent_missing|ENOENT/i);
      await writeFile(committedAuthorityPath, committedAuthorityBytes);
      const task0bPath = join(root, "task0b-release-freeze.json");
      const task0bBytes = readFileSync(task0bPath);
      const task0b = JSON.parse(task0bBytes.toString("utf8"));
      const candidateAdminUrl = "http://127.0.0.1:18788/";
      task0b.runtimeManager.candidateAdminUrl = candidateAdminUrl;
      task0b.runtimeManager.candidateAdminUrlFingerprintSha256 = releaseSha256V2(candidateAdminUrl);
      task0b.candidatePort.port = 18788;
      task0b.candidatePort.adminUrlFingerprintSha256 = releaseSha256V2(candidateAdminUrl);
      await writeFile(task0bPath, canonicalBytes(task0b));
      expect(() => store.resumeCompletedSettlementBeforeBegin("rollout", T0))
        .toThrow(/task0b.*freeze.*binding/i);
      await writeFile(task0bPath, task0bBytes);
    }
    const resumesDeadSettledOwner = faultAt === "after_settlement" || faultAt === "after_removal_prepare";
    await expect(runWithRootWriterProcessRuntimeForTestsV2({
      currentOwnerIdentity: () => resumesDeadSettledOwner ? CLEANUP_OWNER : OWNER,
      isOwnerAlive: () => !resumesDeadSettledOwner
    }, () => executeProtectedProductionOperationV2({ artifactRoot: root, operationKind: "rollout" },
      { store: store as any, adapters }))).resolves.toMatchObject({
        completedSteps: ["verify_g13", "verify_schema", "verify_previous_runtime_identity",
          "verify_singleton_precondition", "stop_previous", "prove_previous_stopped", "start_candidate",
          "prove_candidate_started", "immediate_runtime_checks"]
      });
    for (const [name, bytes] of Object.entries(before)) {
      expect(readFileSync(join(operationDirectory, name))).toEqual(bytes);
    }
    expect(effects).toEqual(["stop_previous", "start_candidate"]);
    expect(validations).toHaveLength(7);
    expect(existsSync(join(root, "production-rollout-evidence-v2.json"))).toBe(true);
    expect(existsSync(join(root, "production-operation-root.lease.json"))).toBe(false);
}, 180_000);

it("replays a dead-owner recovery settlement from operation-qualified receipts before publication", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(T0));
  const root = await initializedAuthorityRoot();
  const store = new ProductionOperationStoreV2(root);
  const rollout = await runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => OWNER, isOwnerAlive: () => false
  }, () => store.beginOperation({ operationKind: "rollout", evaluatedAt: T0 }));
  const prior = await runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => CLEANUP_OWNER, isOwnerAlive: () => false
  }, () => store.takeoverCleanupOnly({ expectedOldLeaseSha256: rollout.leaseSha256,
    evaluatedAt: "2026-07-18T10:10:00.000Z" }));
  const priorAbandonedSha256 = releaseSha256V2(canonicalBytes(prior.abandoned));
  const priorCleanupSha256 = releaseSha256V2(canonicalBytes(prior.cleanup));
  const recoveryAt = "2026-07-18T10:11:00.000Z";
  vi.setSystemTime(new Date(recoveryAt));
  await issueOperationalAttestationV2({ artifactRoot: root, action: "production_failed" });
  const recoveryContext = {
    priorOperationKind: "rollout" as const,
    priorOperationId: prior.abandoned.operationId,
    priorTerminalAbandonedSha256: priorAbandonedSha256,
    priorTerminalCleanupSha256: priorCleanupSha256,
    completedStepReceiptPrefix: [],
    completedStepReceiptPrefixSha256: prior.abandoned.completedStepReceiptSetSha256,
    uncertainStepMarker: null,
    uncertainStepMarkerSha256: null,
    failedGateId: "G14_PRODUCTION_ROLLOUT" as const,
    failureCode: prior.abandoned.reason,
    priorAttemptedExternalEffect: prior.abandoned.attemptedExternalEffect
  };
  const adapters = {
    now: () => recoveryAt,
    async loadReleaseContext() { return { releaseFreezeIdentitySha256:
      releaseSha256V2(readFileSync(join(root, "release-freeze-identity-v2.json"))),
      previousRuntimeKind: "manager_owned_previous_runtime" as const }; },
    async loadRecoveryContext() { return recoveryContext; },
    async validateStep(input: any) {
      return { inputSha256: input.inputSha256, outputSha256: "1".repeat(64),
        observedStateSha256: "2".repeat(64) };
    },
    async prepareEffect() { throw new Error("recovery_effect_forbidden"); },
    async executeEffect() { throw new Error("recovery_effect_forbidden"); },
    async reconcileEffect() { throw new Error("recovery_effect_forbidden"); }
  } as any;

  await expect(runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => OWNER, isOwnerAlive: () => false
  }, () => executeProtectedProductionOperationV2({ artifactRoot: root, operationKind: "recovery",
    faultAt: "after_settlement" }, { store: store as any, adapters })))
    .rejects.toThrow("injected_operation_fault:after_settlement");
  const settlementName = readdirSync(root).find((name) =>
    name.startsWith("production-operation-settlement-production-recovery-"))!;
  const operationId = settlementName
    .replace(/^production-operation-settlement-/u, "").replace(/\.json$/u, "");
  const canonicalReceiptPath = join(root, "production-recovery-orchestration-receipt-v2.json");
  const canonicalEvidencePath = join(root, "production-failure-evidence-v2.json");
  expect(existsSync(canonicalReceiptPath)).toBe(false);
  expect(existsSync(canonicalEvidencePath)).toBe(false);

  const operationReceiptPath = join(root, "production-operation-terminal-artifacts", operationId,
    "production-recovery-orchestration-receipt-v2.json");
  const operationReceiptBytes = readFileSync(operationReceiptPath);
  const operationReceipt = JSON.parse(operationReceiptBytes.toString("utf8"));
  await writeFile(operationReceiptPath, canonicalBytes({ ...operationReceipt,
    priorAttemptedExternalEffect: !operationReceipt.priorAttemptedExternalEffect }));
  await expect(runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => CLEANUP_REPLAY_OWNER, isOwnerAlive: () => false
  }, () => executeProtectedProductionOperationV2({ artifactRoot: root, operationKind: "recovery" },
    { store: store as any, adapters }))).rejects.toThrow(/terminal_bundle.*(?:artifact|hash)|binding/i);
  expect(existsSync(join(root, "production-operation-root.lease.json"))).toBe(true);
  expect(existsSync(canonicalReceiptPath)).toBe(false);
  await writeFile(operationReceiptPath, operationReceiptBytes);

  const recoveryInputPath = join(root, "production-recovery-input-v2.json");
  const recoveryInputBytes = readFileSync(recoveryInputPath);
  const recoveryInput = JSON.parse(recoveryInputBytes.toString("utf8"));
  await writeFile(recoveryInputPath, canonicalBytes({ ...recoveryInput,
    priorTerminalCleanupSha256: "f".repeat(64) }));
  await expect(runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => CLEANUP_REPLAY_OWNER, isOwnerAlive: () => false
  }, () => executeProtectedProductionOperationV2({ artifactRoot: root, operationKind: "recovery" },
    { store: store as any, adapters }))).rejects.toThrow(/recovery.*input|canonical|hash/i);
  expect(existsSync(join(root, "production-operation-root.lease.json"))).toBe(true);
  expect(existsSync(canonicalReceiptPath)).toBe(false);
  expect(existsSync(canonicalEvidencePath)).toBe(false);
  await writeFile(recoveryInputPath, recoveryInputBytes);

  await expect(runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => CLEANUP_REPLAY_OWNER, isOwnerAlive: () => false
  }, () => executeProtectedProductionOperationV2({ artifactRoot: root, operationKind: "recovery" },
    { store: store as any, adapters }))).resolves.toMatchObject({ operationId });
  expect(existsSync(canonicalReceiptPath)).toBe(true);
  expect(existsSync(canonicalEvidencePath)).toBe(true);
  expect(existsSync(join(root, "production-operation-root.lease.json"))).toBe(false);
}, 120_000);

it("publishes later same-kind terminal artifacts through a durable per-kind pointer", async () => {
  const root = await trustedRoot();
  await writeFile(join(root, "task0b-release-freeze.json"), canonicalBytes(buildTask0BReleaseFreezeEvidence({
    observedAt: T0,
    artifactRootFingerprintSha256: rootFingerprint(root)
  })));
  const store = new ProductionOperationStoreV2(root);
  const operation = async (digit: string) => {
    const operationId = `production-rollout-${digit.repeat(64)}`;
    const directory = join(root, "production-operation-terminal-artifacts", operationId);
    await mkdir(directory, { recursive: true });
    const captureRelativePath = `production-operation-terminal-artifacts/${operationId}/failure-capture.json`;
    const evidenceRelativePath = `production-operation-terminal-artifacts/${operationId}/failure-evidence.json`;
    const capture = canonicalBytes({ operationId, marker: `${digit}-capture` });
    const evidence = canonicalBytes({ operationId, marker: `${digit}-evidence` });
    await writeFile(join(root, ...captureRelativePath.split("/")), capture);
    await writeFile(join(root, ...evidenceRelativePath.split("/")), evidence);
    const settlement = {
      version: "production-operation-settlement-v2", operationKind: "rollout", operationId,
      candidateSha: digit.repeat(40), releaseGenerationId: `generation-${digit.repeat(8)}`,
      sourceManifestSha256: "a".repeat(64), claimSha256: "b".repeat(64),
      authorityConsumptionSha256: "c".repeat(64), finalLeaseSha256: "d".repeat(64),
      finalLeaseEpoch: 1, operationDeadlineAt: "2026-07-18T10:10:00.000Z",
      terminalEvidenceSha256: releaseSha256V2(evidence), authorityRevalidatedAt: T0,
      deadlineRevalidatedAt: T0, settledAt: T0, capability: "effect_capable", result: "failed",
      orchestrationReceiptSha256: null, attemptedExternalEffect: false
    };
    const settlementBytes = canonicalBytes(settlement);
    await writeFile(join(root, `production-operation-settlement-${operationId}.json`), settlementBytes);
    const index = {
      version: "production-terminal-artifact-index-v2", operationKind: "rollout", operationId,
      operationClaimSha256: settlement.claimSha256,
      authorityConsumptionSha256: settlement.authorityConsumptionSha256,
      terminalEvidenceSha256: settlement.terminalEvidenceSha256, orchestrationReceiptSha256: null,
      artifacts: [
        { kind: "failure_capture", operationQualifiedRelativePath: captureRelativePath,
          canonicalRelativePath: `production-operation-failure-capture-${operationId}.json`,
          sha256: releaseSha256V2(capture) },
        { kind: "failure_evidence", operationQualifiedRelativePath: evidenceRelativePath,
          canonicalRelativePath: "production-failure-evidence-v2.json",
          sha256: releaseSha256V2(evidence) }
      ]
    };
    const indexBytes = canonicalBytes(index);
    await writeFile(join(root, `production-terminal-artifact-index-${operationId}.json`), indexBytes);
    const cleanup = {
      version: "production-operation-terminal-cleanup-v2", operationKind: "rollout", operationId,
      terminalStateSha256: releaseSha256V2(settlementBytes), capability: "effect_capable",
      preparedRemovalSha256: "e".repeat(64), leaseRemovalReceiptSha256: "f".repeat(64),
      removedLeaseSha256: settlement.finalLeaseSha256, cleanedAt: T0
    };
    await writeFile(join(root, `production-operation-terminal-cleanup-${operationId}.json`),
      canonicalBytes(cleanup));
    return { operationId, capture, evidence };
  };
  const first = await operation("1");
  const second = await operation("2");
  store.publishTerminalArtifacts(first.operationId);
  expect(readFileSync(join(root, "production-failure-evidence-v2.json"))).toEqual(first.evidence);
  // Simulate a crash after one second-operation alias changed but before the pointer commit.
  await writeFile(join(root, `production-operation-failure-capture-${second.operationId}.json`),
    second.capture);
  store.publishTerminalArtifacts(second.operationId);
  expect(readFileSync(join(root, "production-failure-evidence-v2.json"))).toEqual(second.evidence);
  expect(JSON.parse(readFileSync(join(root,
    "production-terminal-artifact-pointer-rollout-v2.json"), "utf8"))
    .operationId).toBe(second.operationId);
  expect(() => store.publishTerminalArtifacts(second.operationId)).not.toThrow();
  const pointerPath = join(root, "production-terminal-artifact-pointer-rollout-v2.json");
  const pointerBytes = readFileSync(pointerPath);
  const pointer = JSON.parse(pointerBytes.toString("utf8"));
  await writeFile(pointerPath, canonicalBytes({ ...pointer, settlementSha256: "0".repeat(64) }));
  expect(() => store.publishTerminalArtifacts(second.operationId)).toThrow(/pointer.*binding/i);
  await writeFile(pointerPath, pointerBytes);
  const canonicalEvidencePath = join(root, "production-failure-evidence-v2.json");
  await writeFile(canonicalEvidencePath, canonicalBytes({ unauthorized: true }));
  expect(() => store.publishTerminalArtifacts(second.operationId)).toThrow(/publication_conflict/i);
  await writeFile(canonicalEvidencePath, second.evidence);
}, 45_000);

it.each([
  "after_failure_draft",
  "after_failure_capture",
  "after_failure_evidence",
  "after_failure_terminal_index",
  "after_failure_settlement",
  "after_failure_terminal_publication",
  "after_removal_prepare",
  "after_lease_removal",
  "after_removal_receipt",
  "after_terminal_cleanup"
])("resumes a failed terminal byte-exactly at %s without repeating its validation", async (faultAt) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(T0));
  const root = await initializedAuthorityRoot();
  const store = new ProductionOperationStoreV2(root);
  const validations: string[] = [];
  const effects: string[] = [];
  const adapters = {
    now: () => T0,
    async loadReleaseContext() { return { releaseFreezeIdentitySha256:
      releaseSha256V2(readFileSync(join(root, "release-freeze-identity-v2.json"))),
      previousRuntimeKind: "manager_owned_previous_runtime" as const }; },
    async validateStep(input: any) {
      validations.push(input.stepId);
      if (input.stepId === "verify_schema") throw new Error("schema verification failed");
      return { inputSha256: input.inputSha256, outputSha256: "1".repeat(64),
        observedStateSha256: "2".repeat(64) };
    },
    async prepareEffect(input: any) { return createHash("sha256").update(input.stepId).digest("hex"); },
    async executeEffect(input: any) {
      effects.push(input.stepId);
      return { inputSha256: input.inputSha256, outputSha256: "3".repeat(64),
        observedStateSha256: "4".repeat(64) };
    },
    async reconcileEffect() { throw new Error("failed_terminal_must_not_reconcile"); }
  } as any;
  await expect(runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => OWNER, isOwnerAlive: () => true
  }, () => executeProtectedProductionOperationV2({ artifactRoot: root, operationKind: "rollout", faultAt },
    { store: store as any, adapters }))).rejects.toThrow(/injected_(?:operation_)?fault|failure_settlement_failed/);
  const operationId = JSON.parse(readFileSync(join(root,
    readdirSync(root).find((name) => name.startsWith("production-operation-failure-draft-"))!), "utf8"))
    .operationId as string;
  const qualifiedRoot = join(root, "production-operation-terminal-artifacts", operationId);
  const before = existsSync(qualifiedRoot)
    ? Object.fromEntries(readdirSync(qualifiedRoot).filter((name) => name.endsWith(".json"))
      .map((name) => [name, readFileSync(join(qualifiedRoot, name))])) : {};
  if (faultAt === "after_terminal_cleanup") {
    const settlement = JSON.parse(readFileSync(join(root,
      `production-operation-settlement-${operationId}.json`), "utf8"));
    expect(store.verifyFailedSettledRolloutForRecovery(operationId, settlement.claimSha256)
      .completedStepReceipts).toHaveLength(1);
    const firstReceiptPath = join(root, "production-operation-steps", operationId,
      "1-verify_g13-v2.json");
    const firstReceiptBytes = readFileSync(firstReceiptPath);
    await unlink(firstReceiptPath);
    expect(() => store.verifyFailedSettledRolloutForRecovery(operationId, settlement.claimSha256))
      .toThrow(/terminal_bundle|failure.*(?:prefix|draft|capture)/i);
    await writeFile(firstReceiptPath, firstReceiptBytes);
    const preparedPath = join(root, `production-operation-lease-removal-prepared-${operationId}.json`);
    const removalPath = join(root, `production-operation-lease-removal-${operationId}.json`);
    const cleanupPath = join(root, `production-operation-terminal-cleanup-${operationId}.json`);
    const preparedBytes = readFileSync(preparedPath);
    const removalBytes = readFileSync(removalPath);
    const cleanupBytes = readFileSync(cleanupPath);
    const prepared = JSON.parse(preparedBytes.toString("utf8"));
    const removal = { ...JSON.parse(removalBytes.toString("utf8")), capability: "cleanup_only" };
    const rewrittenRemovalBytes = canonicalBytes(removal);
    const rewrittenRemovalSha256 = releaseSha256V2(rewrittenRemovalBytes);
    const rewrittenPrepared = { ...prepared, capability: "cleanup_only", canonicalRemovalReceipt: removal,
      canonicalRemovalReceiptUtf8Base64: rewrittenRemovalBytes.toString("base64"),
      canonicalRemovalReceiptSha256: rewrittenRemovalSha256 };
    const rewrittenPreparedBytes = canonicalBytes(rewrittenPrepared);
    const cleanup = JSON.parse(cleanupBytes.toString("utf8"));
    await writeFile(preparedPath, rewrittenPreparedBytes);
    await writeFile(removalPath, rewrittenRemovalBytes);
    await writeFile(cleanupPath, canonicalBytes({ ...cleanup, capability: "cleanup_only",
      preparedRemovalSha256: releaseSha256V2(rewrittenPreparedBytes),
      leaseRemovalReceiptSha256: rewrittenRemovalSha256, cleanedAt: "2026-07-18T10:00:01.000Z" }));
    expect(() => store.verifyFailedSettledRolloutForRecovery(operationId, settlement.claimSha256))
      .toThrow(/cleanup.*binding/i);
    await writeFile(preparedPath, preparedBytes);
    await writeFile(removalPath, removalBytes);
    await writeFile(cleanupPath, cleanupBytes);
  }
  await expect(runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => OWNER, isOwnerAlive: () => true
  }, () => executeProtectedProductionOperationV2({ artifactRoot: root, operationKind: "rollout" },
    { store: store as any, adapters }))).rejects.toThrow(/previous_failure_settled/);
  expect(validations).toEqual(["verify_g13", "verify_schema"]);
  expect(effects).toEqual([]);
  for (const [name, bytes] of Object.entries(before)) {
    expect(readFileSync(join(qualifiedRoot, name))).toEqual(bytes);
  }
  expect(existsSync(join(root, "production-failure-evidence-v2.json"))).toBe(true);
  expect(existsSync(join(root, "production-operation-root.lease.json"))).toBe(false);
}, 90_000);

it("rejects an extra foreign committed receipt sharing the exact old lease hash", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(T0));
  const root = await initializedAuthorityRoot();
  const store = new ProductionOperationStoreV2(root);
  const begun = await runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => OWNER,
    isOwnerAlive: () => false
  }, () => store.beginOperation({ operationKind: "rollout", evaluatedAt: T0 }));
  await runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => OWNER,
    isOwnerAlive: () => true
  }, () => store.heartbeat(begun.lease.operationId, "2026-07-18T10:00:05.000Z"));
  const receiptName = readdirSync(root).find((name) =>
    name.startsWith("production-operation-root.lease-takeover-committed-"))!;
  const receipt = JSON.parse(readFileSync(join(root, receiptName), "utf8"));
  const foreign = { ...receipt, operationId: `production-rollout-${"9".repeat(64)}`,
    committedAt: "2026-07-18T10:00:05.001Z" };
  const foreignBytes = canonicalBytes(foreign);
  await writeFile(join(root,
    `production-operation-root.lease-takeover-committed-${releaseSha256V2(foreignBytes)}.json`), foreignBytes);

  expect(() => store.verifyImmutableAuthorityLineage(
    begun.lease.operationId, "2026-07-18T10:00:05.002Z"
  )).toThrow(/takeover.*(?:ambiguous|chain|binding)/i);
}, 45_000);

it.each(["after_prepare", "after_tombstone", "after_new_lease", "after_committed"])(
"resumes normal and cleanup-only takeover at %s boundary", async (faultAt) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(T0));
    const normalRoot = await initializedAuthorityRoot();
    const normalStore = new ProductionOperationStoreV2(normalRoot);
    const normalBegun = await runWithRootWriterProcessRuntimeForTestsV2({
      currentOwnerIdentity: () => OWNER, isOwnerAlive: () => false
    }, () => normalStore.beginOperation({ operationKind: "rollout", evaluatedAt: T0 }));
    await expect(runWithRootWriterProcessRuntimeForTestsV2({
      currentOwnerIdentity: () => TAKEOVER_OWNER, isOwnerAlive: () => false
    }, () => normalStore.takeoverEffectCapable({ expectedOldLeaseSha256: normalBegun.leaseSha256,
      evaluatedAt: "2026-07-18T10:01:00.000Z", faultAt })))
      .rejects.toThrow(`injected_fault_${faultAt}`);
    const normalTakeover = await runWithRootWriterProcessRuntimeForTestsV2({
      currentOwnerIdentity: () => TAKEOVER_OWNER, isOwnerAlive: () => false
    }, () => normalStore.takeoverEffectCapable({ expectedOldLeaseSha256: normalBegun.leaseSha256,
      evaluatedAt: "2026-07-18T10:01:01.000Z" }));
    const normalLive = JSON.parse(readFileSync(join(normalRoot, "production-operation-root.lease.json"), "utf8"));
    expect(releaseSha256V2(canonicalBytes(normalLive))).toBe(normalTakeover.newLeaseSha256);
    expect(runWithRootWriterProcessRuntimeForTestsV2({
      currentOwnerIdentity: () => TAKEOVER_OWNER, isOwnerAlive: () => true
    }, () => normalStore.verifyImmutableAuthorityLineage(normalBegun.lease.operationId,
      "2026-07-18T10:01:01.001Z")).leaseSha256).toBe(normalTakeover.newLeaseSha256);

    const cleanupRoot = await initializedAuthorityRoot();
    const cleanupStore = new ProductionOperationStoreV2(cleanupRoot);
    const cleanupBegun = await runWithRootWriterProcessRuntimeForTestsV2({
      currentOwnerIdentity: () => OWNER, isOwnerAlive: () => false
    }, () => cleanupStore.beginOperation({ operationKind: "rollout", evaluatedAt: T0 }));
    await expect(runWithRootWriterProcessRuntimeForTestsV2({
      currentOwnerIdentity: () => CLEANUP_OWNER, isOwnerAlive: () => false
    }, () => cleanupStore.takeoverCleanupOnly({ expectedOldLeaseSha256: cleanupBegun.leaseSha256,
      evaluatedAt: "2026-07-18T10:10:00.000Z", faultAt })))
      .rejects.toThrow(`injected_fault_${faultAt}`);
    const cleanupTerminal = await runWithRootWriterProcessRuntimeForTestsV2({
      currentOwnerIdentity: () => CLEANUP_REPLAY_OWNER, isOwnerAlive: () => false
    }, () => cleanupStore.takeoverCleanupOnly({ expectedOldLeaseSha256: cleanupBegun.leaseSha256,
      evaluatedAt: "2026-07-18T10:11:00.000Z" }));
    expect(cleanupTerminal.abandoned).not.toBeNull();
    expect(cleanupTerminal.abandoned!.operationId).toBe(cleanupBegun.lease.operationId);
    expect(cleanupTerminal.cleanup.removedLeaseSha256).toBe(cleanupTerminal.abandoned!.finalLeaseSha256);
    expect(existsSync(join(cleanupRoot, "production-operation-root.lease.json"))).toBe(false);
}, 90_000);

it("rejects normal and cleanup-only takeover before any write for a legacy unmanaged previous runtime", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(T0));
  const root = await initializedAuthorityRoot("legacy_unmanaged_previous_runtime");
  const store = new ProductionOperationStoreV2(root);
  const before = artifactTreeSnapshot(root);

  for (const action of ["g14_rollout_passed", "g15_canary_released", "production_failed",
    "rollback_rolled_back"] as const) {
    await expect(issueOperationalAttestationV2({ artifactRoot: root, action }))
      .rejects.toThrow("legacy_unmanaged_previous_runtime_action_forbidden");
    expect(artifactTreeSnapshot(root)).toEqual(before);
  }
  const operationId = `production-rollout-${"e".repeat(64)}`;
  for (const mutate of [
    () => store.persistExclusive("legacy_test", "legacy-write.json", { forbidden: true }),
    () => store.loadOrPersistFailureDraft({} as any, T0),
    () => store.persistTerminalArtifactIndex({}, T0),
    () => store.publishTerminalArtifacts(operationId),
    () => store.acquireLease({}),
    () => store.releaseLease("2".repeat(64)),
    () => store.heartbeat(operationId, T0),
    () => store.persistStepIntent({}),
    () => store.persistStepReceipt({}),
    () => store.persistSettlement({}),
    () => store.completeTerminal({ operationId, terminalStateKind: "settlement",
      terminalStateSha256: "2".repeat(64), evaluatedAt: T0 })
  ]) {
    expect(mutate).toThrow("legacy_unmanaged_previous_runtime_action_forbidden");
    expect(artifactTreeSnapshot(root)).toEqual(before);
  }
  await expect(runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => OWNER, isOwnerAlive: () => false
  }, () => store.beginOperation({ operationKind: "rollout", evaluatedAt: T0 })))
    .rejects.toThrow("legacy_unmanaged_previous_runtime_action_forbidden");
  expect(artifactTreeSnapshot(root)).toEqual(before);
  expect(() => store.resumeCompletedSettlementBeforeBegin("rollout", T0))
    .toThrow("legacy_unmanaged_previous_runtime_action_forbidden");
  expect(artifactTreeSnapshot(root)).toEqual(before);
  expect(() => store.resumeCompletedSettlement(operationId, T0))
    .toThrow("legacy_unmanaged_previous_runtime_action_forbidden");
  expect(artifactTreeSnapshot(root)).toEqual(before);

  await expect(runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => TAKEOVER_OWNER, isOwnerAlive: () => false
  }, () => store.takeoverEffectCapable({ expectedOldLeaseSha256: "2".repeat(64),
    evaluatedAt: "2026-07-18T10:01:00.000Z" })))
    .rejects.toThrow("legacy_unmanaged_previous_runtime_action_forbidden");
  expect(artifactTreeSnapshot(root)).toEqual(before);

  await expect(runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => CLEANUP_OWNER, isOwnerAlive: () => false
  }, () => store.takeoverCleanupOnly({ expectedOldLeaseSha256: "2".repeat(64),
    evaluatedAt: "2026-07-18T10:11:00.000Z" })))
    .rejects.toThrow("legacy_unmanaged_previous_runtime_action_forbidden");
  expect(artifactTreeSnapshot(root)).toEqual(before);
}, 75_000);

it("rejects a multi-hop takeover identity switch even when the final lease switches back", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(T0));
  const root = await initializedAuthorityRoot();
  const store = new ProductionOperationStoreV2(root);
  const begun = await runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => OWNER,
    isOwnerAlive: () => false
  }, () => store.beginOperation({ operationKind: "rollout", evaluatedAt: T0 }));
  const livePath = join(root, "production-operation-root.lease.json");

  const installForgedHop = async (oldLease: any, newLease: any, candidateSha: string, at: string) => {
    const oldBytes = canonicalBytes(oldLease);
    const oldSha = releaseSha256V2(oldBytes);
    const newBytes = canonicalBytes(newLease);
    const prepared = validatePreparedProductionOperationLeaseTakeoverV2({
      version: "prepared-production-operation-lease-takeover-v2",
      commandId: "production_operation_lease_takeover",
      redactedTemplateSha256: PRODUCTION_OPERATION_TAKEOVER_TEMPLATE_SHA256_V2,
      capability: "effect_capable",
      operationKind: "rollout",
      operationId: begun.lease.operationId,
      candidateSha,
      releaseGenerationId: begun.lease.releaseGenerationId,
      sourceManifestSha256: begun.lease.sourceManifestSha256,
      artifactRootFingerprintSha256: begun.lease.artifactRootFingerprintSha256,
      authorityConsumptionSha256: begun.claim.authorityConsumptionSha256,
      oldLeaseSha256: oldSha,
      oldLeaseEpoch: oldLease.leaseEpoch,
      oldOwnerProcessIdentitySha256: rootWriterOwnerProcessIdentitySha256V2(
        oldLease.ownerPid, oldLease.ownerProcessStartFingerprintSha256),
      canonicalNewLease: newLease,
      canonicalNewLeaseUtf8Base64: newBytes.toString("base64"),
      newLeaseSha256: releaseSha256V2(newBytes),
      newLeaseEpoch: newLease.leaseEpoch,
      operationDeadlineAt: begun.lease.operationDeadlineAt,
      preparedAt: at
    });
    const preparedBytes = canonicalBytes(prepared);
    await writeFile(join(root, `production-operation-root.lease-takeover-prepared-${oldSha}.json`), preparedBytes);
    await rename(livePath, join(root, `production-operation-root.lease-tombstone-${oldSha}.json`));
    await writeFile(livePath, newBytes);
    const committed = validateCommittedProductionOperationLeaseTakeoverV2({
      version: "committed-production-operation-lease-takeover-v2",
      commandId: "production_operation_lease_takeover",
      redactedTemplateSha256: PRODUCTION_OPERATION_TAKEOVER_TEMPLATE_SHA256_V2,
      capability: "effect_capable",
      operationKind: "rollout",
      operationId: begun.lease.operationId,
      candidateSha,
      releaseGenerationId: begun.lease.releaseGenerationId,
      sourceManifestSha256: begun.lease.sourceManifestSha256,
      artifactRootFingerprintSha256: begun.lease.artifactRootFingerprintSha256,
      authorityConsumptionSha256: begun.claim.authorityConsumptionSha256,
      preparedTakeoverSha256: releaseSha256V2(preparedBytes),
      oldLeaseSha256: oldSha,
      tombstoneRelativePath: `production-operation-root.lease-tombstone-${oldSha}.json`,
      newLeaseSha256: releaseSha256V2(newBytes),
      newLeaseEpoch: newLease.leaseEpoch,
      operationDeadlineAt: begun.lease.operationDeadlineAt,
      committedAt: at
    }, prepared);
    const committedBytes = canonicalBytes(committed);
    await writeFile(join(root,
      `production-operation-root.lease-takeover-committed-${releaseSha256V2(committedBytes)}.json`), committedBytes);
  };

  const foreignCandidate = "9".repeat(40);
  const foreignLease = validateProductionOperationLeaseV2({ ...begun.lease,
    candidateSha: foreignCandidate, leaseEpoch: 2,
    acquiredAt: "2026-07-18T10:00:01.000Z", heartbeatAt: "2026-07-18T10:00:01.000Z",
    expiresAt: "2026-07-18T10:01:01.000Z" });
  const restoredLease = validateProductionOperationLeaseV2({ ...foreignLease,
    candidateSha: begun.lease.candidateSha, leaseEpoch: 3,
    acquiredAt: "2026-07-18T10:00:02.000Z", heartbeatAt: "2026-07-18T10:00:02.000Z",
    expiresAt: "2026-07-18T10:01:02.000Z" });
  await installForgedHop(begun.lease, foreignLease, foreignCandidate, "2026-07-18T10:00:01.000Z");
  await installForgedHop(foreignLease, restoredLease, begun.lease.candidateSha,
    "2026-07-18T10:00:02.000Z");

  expect(() => store.verifyImmutableAuthorityLineage(
    begun.lease.operationId, "2026-07-18T10:00:02.001Z"
  )).toThrow(/takeover.*(?:identity|binding|chain)/i);
}, 45_000);
