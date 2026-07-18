import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ProductionOperationStoreV2 } from "../../src/release/productionOperationStore";
import {
  canonicalReleaseJsonV2,
  releaseSha256V2
} from "../../src/release/remediationReleaseManifestV2";
import {
  initializeReleaseManifestV2,
  issueOperationalAttestationV2,
  materializeReleaseFreezeV2,
  runWithRootWriterProcessRuntimeForTestsV2
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

  const takeoverAt = "2026-07-18T10:01:00.000Z";
  const stillOwned = await runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => OWNER,
    isOwnerAlive: () => true
  }, () => store.assertOwnedAndWithinBounds(begun.lease.operationId, takeoverAt));
  expect(stillOwned.leaseSha256).toBe(begun.leaseSha256);
  await expect(runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => TAKEOVER_OWNER,
    isOwnerAlive: () => true
  }, () => store.takeoverEffectCapable({
    expectedOldLeaseSha256: begun.leaseSha256,
    evaluatedAt: takeoverAt
  }))).rejects.toThrow("production_operation_owner_still_alive");
  await expect(runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => TAKEOVER_OWNER,
    isOwnerAlive: () => false
  }, () => store.takeoverEffectCapable({
    expectedOldLeaseSha256: begun.leaseSha256,
    evaluatedAt: takeoverAt,
    faultAt: "after_prepare"
  }))).rejects.toThrow("injected_fault_after_prepare");
  const takeover = await runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => TAKEOVER_OWNER,
    isOwnerAlive: () => false
  }, () => store.takeoverEffectCapable({
    expectedOldLeaseSha256: begun.leaseSha256,
    evaluatedAt: "2026-07-18T10:10:00.000Z"
  }));
  const takeoverLease = JSON.parse(readFileSync(join(root,
    "production-operation-root.lease.json"), "utf8"));
  expect(takeover).toMatchObject({
    oldLeaseSha256: begun.leaseSha256,
    newLeaseEpoch: 2,
    newLeaseSha256: releaseSha256V2(canonicalBytes(takeoverLease))
  });
  expect(takeoverLease).toMatchObject({ leaseEpoch: 2, ownerPid: TAKEOVER_OWNER.pid });

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
    newLeaseEpoch: 3
  });
  expect(terminal.abandoned).toMatchObject({
    reason: "operation_deadline_reached",
    capability: "cleanup_only",
    finalLeaseEpoch: 3,
    claimSha256: begun.claimSha256
  });
  expect(terminal.cleanup).toMatchObject({
    operationId: begun.lease.operationId,
    capability: "cleanup_only"
  });
  expect(existsSync(join(root, "production-operation-root.lease.json"))).toBe(false);
}, 45_000);
