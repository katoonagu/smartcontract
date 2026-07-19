import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdtemp, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  PRODUCTION_OPERATION_TAKEOVER_TEMPLATE_SHA256_V2,
  ProductionOperationStoreV2
} from "../../src/release/productionOperationStore";
import {
  canonicalReleaseJsonV2,
  releaseSha256V2,
  rootWriterOwnerProcessIdentitySha256V2,
  validateCommittedProductionOperationLeaseTakeoverV2,
  validatePreparedProductionOperationLeaseTakeoverV2,
  validateProductionOperationLeaseV2
} from "../../src/release/remediationReleaseManifestV2";
import {
  initializeReleaseManifestV2,
  issueOperationalAttestationV2,
  materializeReleaseFreezeV2,
  runWithRootWriterProcessRuntimeForTestsV2,
  selectOperationalAttestationFromStoreV2
} from "../../src/release/releaseManifestStoreV2";
import {
  buildReleaseManifestV2Fixture,
  buildTask0BReleaseFreezeEvidence
} from "../fixtures/release/remediationReleaseFixtures";

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

async function initializedAuthorityRoot(): Promise<string> {
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
  await initializeReleaseManifestV2({
    artifactRoot: root,
    evaluatedAt: T0,
    verifiedGateOutputs: buildReleaseManifestV2Fixture().gates.filter((gate) => gate.state === "passed")
  });
  await issueOperationalAttestationV2({ artifactRoot: root, action: "g14_rollout_passed" });
  return root;
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
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
}, 45_000);

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
