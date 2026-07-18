import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, linkSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalReleaseJsonV2,
  MANIFEST_LEASE_TAKEOVER_TEMPLATE_SHA256_V2,
  releaseFreezeIdentitySha256V2,
  releaseSha256V2,
  rootWriterOwnerProcessIdentitySha256V2,
  validateBootstrapRootWriterLeaseTakeoverReceiptV2,
  validateFrozenRootWriterLeaseTakeoverReceiptV2,
  validatePreparedBootstrapRootWriterLeaseTakeoverV2,
  validatePreparedFrozenRootWriterLeaseTakeoverV2,
  type BootstrapRootWriterLeaseV2,
  type FrozenRootWriterLeaseV2
} from "../../src/release/remediationReleaseManifestV2";
import {
  buildTask0BReleaseFreezeEvidence,
  RELEASE_V2_NOW,
  RELEASE_V2_FREEZE_IDENTITY,
  RELEASE_V2_FREEZE_SHA256
} from "../fixtures/release/remediationReleaseFixtures";

const roots: string[] = [];
const canonicalBytes = (value: unknown) => Buffer.from(`${canonicalReleaseJsonV2(value)}\n`, "utf8");

function frozenLease(overrides: Partial<FrozenRootWriterLeaseV2> = {}): FrozenRootWriterLeaseV2 {
  return {
    version: "frozen-root-writer-lease-v2",
    scope: "artifact_root",
    relativePath: "manifest-transition-root.lease.json",
    writerOperationKind: "manifest_transition",
    writerOperationKeySha256: "a".repeat(64),
    transitionKeySha256: "b".repeat(64),
    protectedRootFingerprintSha256: RELEASE_V2_FREEZE_IDENTITY.artifactRootFingerprintSha256,
    candidateSha: RELEASE_V2_FREEZE_IDENTITY.candidateSha,
    releaseGenerationId: RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId,
    releaseFreezeIdentitySha256: RELEASE_V2_FREEZE_SHA256,
    leaseEpoch: 2,
    ownerPid: process.pid,
    ownerProcessStartFingerprintSha256: "c".repeat(64),
    acquiredAt: "2026-07-18T10:02:00.000Z",
    heartbeatAt: "2026-07-18T10:02:00.000Z",
    expiresAt: "2026-07-18T10:03:00.000Z",
    ...overrides
  };
}

function frozenLeaseForRoot(
  root: string,
  overrides: Partial<FrozenRootWriterLeaseV2> = {}
): FrozenRootWriterLeaseV2 {
  const freeze = JSON.parse(readFileSync(join(root, "release-freeze-identity-v2.json"), "utf8"));
  return frozenLease({
    protectedRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
    candidateSha: freeze.candidateSha,
    releaseGenerationId: freeze.releaseGenerationId,
    releaseFreezeIdentitySha256: releaseFreezeIdentitySha256V2(freeze),
    ...overrides
  });
}

function preparedFrozen() {
  const lease = frozenLease();
  const bytes = canonicalBytes(lease);
  const oldOwnerPid = 2_147_483_647;
  const oldOwnerProcessStartFingerprintSha256 = "e".repeat(64);
  return {
    version: "prepared-frozen-root-writer-lease-takeover-v2" as const,
    commandId: "manifest_lease_takeover" as const,
    redactedTemplateSha256: MANIFEST_LEASE_TAKEOVER_TEMPLATE_SHA256_V2,
    candidateSha: lease.candidateSha,
    releaseGenerationId: lease.releaseGenerationId,
    releaseFreezeIdentitySha256: lease.releaseFreezeIdentitySha256,
    artifactRootFingerprintSha256: lease.protectedRootFingerprintSha256,
    writerOperationKind: lease.writerOperationKind,
    writerOperationKeySha256: lease.writerOperationKeySha256,
    transitionKeySha256: lease.transitionKeySha256,
    oldLeaseSha256: "d".repeat(64),
    oldLeaseEpoch: 1,
    oldOwnerProcessIdentitySha256: rootWriterOwnerProcessIdentitySha256V2(
      oldOwnerPid, oldOwnerProcessStartFingerprintSha256),
    canonicalNewLease: lease,
    canonicalNewLeaseUtf8Base64: bytes.toString("base64"),
    newLeaseSha256: releaseSha256V2(bytes),
    newLeaseEpoch: lease.leaseEpoch,
    preparedAt: lease.acquiredAt
  };
}

function bootstrapLease(overrides: Partial<BootstrapRootWriterLeaseV2> = {}): BootstrapRootWriterLeaseV2 {
  return {
    version: "bootstrap-root-writer-lease-v2",
    scope: "artifact_root",
    relativePath: "manifest-transition-root.lease.json",
    writerOperationKind: "release_freeze_materialization",
    writerOperationKeySha256: "1".repeat(64),
    protectedRootFingerprintSha256: "2".repeat(64),
    task0BPreflightEvidenceSha256: "3".repeat(64),
    candidateSha: RELEASE_V2_FREEZE_IDENTITY.candidateSha,
    runtimeIdentitySha256: "4".repeat(64),
    releaseGenerationId: null,
    releaseFreezeIdentitySha256: null,
    leaseEpoch: 2,
    ownerPid: process.pid,
    ownerProcessStartFingerprintSha256: "5".repeat(64),
    acquiredAt: "2026-07-18T10:02:00.000Z",
    heartbeatAt: "2026-07-18T10:02:00.000Z",
    expiresAt: "2026-07-18T10:03:00.000Z",
    ...overrides
  };
}

function preparedBootstrap() {
  const lease = bootstrapLease();
  const bytes = canonicalBytes(lease);
  const oldOwnerPid = 2_147_483_647;
  const oldOwnerProcessStartFingerprintSha256 = "7".repeat(64);
  return {
    version: "prepared-bootstrap-root-writer-lease-takeover-v2" as const,
    commandId: "manifest_lease_takeover" as const,
    redactedTemplateSha256: MANIFEST_LEASE_TAKEOVER_TEMPLATE_SHA256_V2,
    protectedRootFingerprintSha256: lease.protectedRootFingerprintSha256,
    task0BPreflightEvidenceSha256: lease.task0BPreflightEvidenceSha256,
    candidateSha: lease.candidateSha,
    runtimeIdentitySha256: lease.runtimeIdentitySha256,
    preparedFreezeMaterializationSha256: "8".repeat(64),
    oldLeaseSha256: "6".repeat(64),
    oldLeaseEpoch: 1,
    oldOwnerProcessIdentitySha256: rootWriterOwnerProcessIdentitySha256V2(
      oldOwnerPid, oldOwnerProcessStartFingerprintSha256),
    canonicalNewLease: lease,
    canonicalNewLeaseUtf8Base64: bytes.toString("base64"),
    newLeaseSha256: releaseSha256V2(bytes),
    newLeaseEpoch: lease.leaseEpoch,
    preparedAt: lease.acquiredAt
  };
}

async function trustedRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "release-takeover-v2-"));
  if (process.platform === "win32") {
    const sid = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "[Security.Principal.WindowsIdentity]::GetCurrent().User.Value"], { encoding: "utf8" }).trim();
    execFileSync("icacls.exe", [root, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`,
      "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"]);
  }
  roots.push(root);
  return root;
}

async function materializeFreezeBundle(root: string) {
  const absoluteRoot = resolve(root);
  const rootKey = process.platform === "win32" ? absoluteRoot.toLowerCase() : absoluteRoot;
  const task0BPreflightEvidence = buildTask0BReleaseFreezeEvidence({
    observedAt: RELEASE_V2_NOW,
    artifactRootFingerprintSha256: createHash("sha256").update(rootKey, "utf8").digest("hex")
  });
  await writeFile(join(root, "task0b-release-freeze.json"), canonicalBytes(task0BPreflightEvidence));
  const api = await import("../../src/release/releaseManifestStoreV2");
  await api.materializeReleaseFreezeV2({
    artifactRoot: root,
    task0BPreflightEvidence,
    evaluatedAt: RELEASE_V2_NOW,
    producerId: "release_freeze_materialize"
  });
  return api;
}

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("root writer takeover v2 bindings", () => {
  it("validates exact frozen and bootstrap takeover prepare and receipt projections", () => {
    const frozen = preparedFrozen();
    expect(validatePreparedFrozenRootWriterLeaseTakeoverV2(frozen)).toEqual(frozen);
    expect(() => validatePreparedFrozenRootWriterLeaseTakeoverV2({ ...frozen, extra: true }))
      .toThrow("prepared_frozen_root_writer_lease_takeover_keys_invalid");
    expect(() => validatePreparedFrozenRootWriterLeaseTakeoverV2({
      ...frozen,
      canonicalNewLease: { ...frozen.canonicalNewLease, candidateSha: "f".repeat(40) }
    })).toThrow();
    const frozenReceipt = {
      version: "frozen-root-writer-lease-takeover-receipt-v2" as const,
      ...Object.fromEntries([
        "commandId", "redactedTemplateSha256",
        "writerOperationKind", "writerOperationKeySha256", "transitionKeySha256",
        "artifactRootFingerprintSha256", "candidateSha", "releaseGenerationId",
        "releaseFreezeIdentitySha256", "oldLeaseSha256", "newLeaseSha256", "newLeaseEpoch"
      ].map((key) => [key, frozen[key as keyof typeof frozen]])),
      preparedTakeoverSha256: releaseSha256V2(canonicalBytes(frozen)),
      tombstoneRelativePath: `manifest-transition-root.lease-tombstone-${frozen.oldLeaseSha256}.json`,
      committedAt: frozen.preparedAt
    };
    expect(validateFrozenRootWriterLeaseTakeoverReceiptV2(frozenReceipt, frozen)).toEqual(frozenReceipt);
    expect(() => validateFrozenRootWriterLeaseTakeoverReceiptV2({
      ...frozenReceipt, preparedTakeoverSha256: "0".repeat(64)
    }, frozen)).toThrow("frozen_root_writer_lease_takeover_receipt_prepared_binding_invalid");

    const bootstrap = preparedBootstrap();
    expect(validatePreparedBootstrapRootWriterLeaseTakeoverV2(bootstrap)).toEqual(bootstrap);
    expect(() => validatePreparedBootstrapRootWriterLeaseTakeoverV2({
      ...bootstrap, runtimeIdentitySha256: "9".repeat(64)
    })).toThrow("prepared_bootstrap_root_writer_lease_takeover_binding_invalid");
    const bootstrapReceipt = {
      version: "bootstrap-root-writer-lease-takeover-receipt-v2" as const,
      ...Object.fromEntries([
        "commandId", "redactedTemplateSha256", "protectedRootFingerprintSha256",
        "task0BPreflightEvidenceSha256", "candidateSha", "runtimeIdentitySha256",
        "preparedFreezeMaterializationSha256", "oldLeaseSha256", "newLeaseSha256", "newLeaseEpoch"
      ].map((key) => [key, bootstrap[key as keyof typeof bootstrap]])),
      preparedTakeoverSha256: releaseSha256V2(canonicalBytes(bootstrap)),
      tombstoneRelativePath: `manifest-transition-root.lease-tombstone-${bootstrap.oldLeaseSha256}.json`,
      committedAt: bootstrap.preparedAt
    };
    expect(validateBootstrapRootWriterLeaseTakeoverReceiptV2(bootstrapReceipt, bootstrap))
      .toEqual(bootstrapReceipt);
    expect(() => validatePreparedFrozenRootWriterLeaseTakeoverV2({
      ...frozen,
      redactedTemplateSha256: "0".repeat(64)
    })).toThrow(/template|takeover/i);
    expect(() => validatePreparedBootstrapRootWriterLeaseTakeoverV2({
      ...bootstrap,
      commandId: "production_operation_lease_takeover"
    })).toThrow(/command|takeover/i);
  });

  it("rejects a forged prepared replay before it can install a foreign lease", async () => {
    const root = await trustedRoot();
    const api = await materializeFreezeBundle(root);
    const oldLease = frozenLeaseForRoot(root, {
      leaseEpoch: 1,
      ownerPid: 2_147_483_647,
      acquiredAt: "2026-07-18T09:58:00.000Z",
      heartbeatAt: "2026-07-18T09:59:00.000Z",
      expiresAt: "2026-07-18T10:00:00.000Z"
    });
    const oldBytes = canonicalBytes(oldLease);
    const oldHash = createHash("sha256").update(oldBytes).digest("hex");
    await writeFile(join(root, "manifest-transition-root.lease.json"), oldBytes);
    await expect(api.takeoverRootWriterLeaseByHashV2({
      artifactRoot: root,
      expectedOldLeaseSha256: oldHash,
      evaluatedAt: "2026-07-18T10:02:00.000Z",
      faultAt: "after_prepare"
    })).rejects.toThrow("injected_fault_after_prepare");
    const preparedPath = join(root, `manifest-transition-root.frozen-takeover-prepared-${oldHash}.json`);
    const prepared = JSON.parse((await readFile(preparedPath)).toString("utf8"));
    prepared.canonicalNewLease.candidateSha = "f".repeat(40);
    writeFileSync(preparedPath, canonicalBytes(prepared));
    await expect(api.takeoverRootWriterLeaseByHashV2({
      artifactRoot: root,
      expectedOldLeaseSha256: oldHash,
      evaluatedAt: "2026-07-18T10:02:00.000Z"
    })).rejects.toThrow();
    expect(await readFile(join(root, "manifest-transition-root.lease.json"))).toEqual(oldBytes);
  }, 30_000);

  it("distinguishes PID reuse by process-start fingerprint and refuses the current owner", async () => {
    const reusedPidRoot = await trustedRoot();
    const api = await materializeFreezeBundle(reusedPidRoot);
    const reusedPidLease = frozenLeaseForRoot(reusedPidRoot, {
      leaseEpoch: 1,
      ownerPid: process.pid,
      ownerProcessStartFingerprintSha256: "0".repeat(64),
      acquiredAt: "2026-07-18T09:58:00.000Z",
      heartbeatAt: "2026-07-18T09:59:00.000Z",
      expiresAt: "2026-07-18T10:00:00.000Z"
    });
    const reusedBytes = canonicalBytes(reusedPidLease);
    await writeFile(join(reusedPidRoot, "manifest-transition-root.lease.json"), reusedBytes);
    const takeover = await api.takeoverRootWriterLeaseByHashV2({
      artifactRoot: reusedPidRoot,
      expectedOldLeaseSha256: releaseSha256V2(reusedBytes),
      evaluatedAt: "2026-07-18T10:02:00.000Z"
    });
    expect(takeover.newLease.ownerPid).toBe(process.pid);
    expect(takeover.newLease.ownerProcessStartFingerprintSha256).not.toBe("0".repeat(64));

    const liveRoot = await trustedRoot();
    await materializeFreezeBundle(liveRoot);
    const liveLease = frozenLeaseForRoot(liveRoot, {
      leaseEpoch: 1,
      ownerPid: process.pid,
      ownerProcessStartFingerprintSha256: takeover.newLease.ownerProcessStartFingerprintSha256,
      acquiredAt: "2026-07-18T09:58:00.000Z",
      heartbeatAt: "2026-07-18T09:59:00.000Z",
      expiresAt: "2026-07-18T10:00:00.000Z"
    });
    const liveBytes = canonicalBytes(liveLease);
    await writeFile(join(liveRoot, "manifest-transition-root.lease.json"), liveBytes);
    await expect(api.takeoverRootWriterLeaseByHashV2({
      artifactRoot: liveRoot,
      expectedOldLeaseSha256: releaseSha256V2(liveBytes),
      evaluatedAt: "2026-07-18T10:02:00.000Z"
    })).rejects.toThrow("root_writer_owner_still_alive");
    expect(releaseFreezeIdentitySha256V2(RELEASE_V2_FREEZE_IDENTITY)).toBe(RELEASE_V2_FREEZE_SHA256);
  }, 30_000);

  it("rejects caller-supplied owner PID and derives acquire identity only from the test runtime seam", async () => {
    const forgedRoot = await trustedRoot();
    const forgedPreflight = buildTask0BReleaseFreezeEvidence({
      observedAt: RELEASE_V2_NOW,
      artifactRootFingerprintSha256: createHash("sha256")
        .update(process.platform === "win32" ? resolve(forgedRoot).toLowerCase() : resolve(forgedRoot), "utf8")
        .digest("hex")
    });
    await writeFile(join(forgedRoot, "task0b-release-freeze.json"), canonicalBytes(forgedPreflight));
    const api = await import("../../src/release/releaseManifestStoreV2");
    await expect(api.materializeReleaseFreezeV2({
      artifactRoot: forgedRoot,
      task0BPreflightEvidence: forgedPreflight,
      evaluatedAt: RELEASE_V2_NOW,
      producerId: "release_freeze_materialize",
      owner: { pid: process.pid }
    } as Parameters<typeof api.materializeReleaseFreezeV2>[0])).rejects.toThrow(/caller|owner|identity/i);

    const seamRoot = await trustedRoot();
    const seamPreflight = buildTask0BReleaseFreezeEvidence({
      observedAt: RELEASE_V2_NOW,
      artifactRootFingerprintSha256: createHash("sha256")
        .update(process.platform === "win32" ? resolve(seamRoot).toLowerCase() : resolve(seamRoot), "utf8")
        .digest("hex")
    });
    await writeFile(join(seamRoot, "task0b-release-freeze.json"), canonicalBytes(seamPreflight));
    const seamIdentity = { pid: 424_242, processStartFingerprintSha256: "9".repeat(64) };
    await expect(api.runWithRootWriterProcessRuntimeForTestsV2({
      currentOwnerIdentity: () => seamIdentity,
      isOwnerAlive: () => true
    }, () => api.materializeReleaseFreezeV2({
      artifactRoot: seamRoot,
      task0BPreflightEvidence: seamPreflight,
      evaluatedAt: RELEASE_V2_NOW,
      producerId: "release_freeze_materialize",
      faultAt: "after_lease"
    }))).rejects.toThrow("injected_fault_after_lease");
    const lease = JSON.parse((await readFile(join(seamRoot, "manifest-transition-root.lease.json"), "utf8")));
    expect(lease).toMatchObject({
      ownerPid: seamIdentity.pid,
      ownerProcessStartFingerprintSha256: seamIdentity.processStartFingerprintSha256
    });
  });

  it("uses the injectable liveness seam for takeover and binds the new lease to the current seam identity", async () => {
    const root = await trustedRoot();
    const api = await materializeFreezeBundle(root);
    const oldLease = frozenLeaseForRoot(root, {
      leaseEpoch: 1,
      ownerPid: 515_151,
      ownerProcessStartFingerprintSha256: "a".repeat(64),
      acquiredAt: "2026-07-18T09:58:00.000Z",
      heartbeatAt: "2026-07-18T09:59:00.000Z",
      expiresAt: "2026-07-18T10:00:00.000Z"
    });
    const oldBytes = canonicalBytes(oldLease);
    const oldHash = releaseSha256V2(oldBytes);
    await writeFile(join(root, "manifest-transition-root.lease.json"), oldBytes);
    const currentIdentity = { pid: 616_161, processStartFingerprintSha256: "b".repeat(64) };

    await expect(api.runWithRootWriterProcessRuntimeForTestsV2({
      currentOwnerIdentity: () => currentIdentity,
      isOwnerAlive: () => true
    }, () => api.takeoverRootWriterLeaseByHashV2({
      artifactRoot: root,
      expectedOldLeaseSha256: oldHash,
      evaluatedAt: "2026-07-18T10:02:00.000Z"
    }))).rejects.toThrow("root_writer_owner_still_alive");

    const result = await api.runWithRootWriterProcessRuntimeForTestsV2({
      currentOwnerIdentity: () => currentIdentity,
      isOwnerAlive: () => false
    }, () => api.takeoverRootWriterLeaseByHashV2({
      artifactRoot: root,
      expectedOldLeaseSha256: oldHash,
      evaluatedAt: "2026-07-18T10:02:00.000Z"
    }));
    expect(result.newLease).toMatchObject({
      ownerPid: currentIdentity.pid,
      ownerProcessStartFingerprintSha256: currentIdentity.processStartFingerprintSha256
    });
  });

  it("rejects frozen leases beyond the 60 second rolling or 5 minute absolute bounds", async () => {
    const api = await import("../../src/release/releaseManifestStoreV2");
    for (const invalidTimes of [{
      acquiredAt: "2026-07-18T10:00:00.000Z",
      heartbeatAt: "2026-07-18T10:00:00.000Z",
      expiresAt: "2026-07-18T10:01:00.001Z"
    }, {
      acquiredAt: "2026-07-18T09:55:00.000Z",
      heartbeatAt: "2026-07-18T09:59:30.000Z",
      expiresAt: "2026-07-18T10:00:30.000Z"
    }]) {
      const root = await trustedRoot();
      await materializeFreezeBundle(root);
      await writeFile(join(root, "manifest-transition-root.lease.json"), canonicalBytes(frozenLeaseForRoot(root, {
        leaseEpoch: 1,
        ownerPid: 717_171,
        ownerProcessStartFingerprintSha256: "c".repeat(64),
        ...invalidTimes
      })));
      await expect(api.verifyReleaseManifestStoreV2(root)).rejects.toThrow(/rolling|absolute|ttl|lease/i);
    }
  });

  it("resumes and seals deterministically when a hardlink crash leaves both old lease and tombstone", async () => {
    const root = await trustedRoot();
    const api = await materializeFreezeBundle(root);
    const oldLease = frozenLeaseForRoot(root, {
      leaseEpoch: 1,
      ownerPid: 2_147_483_647,
      ownerProcessStartFingerprintSha256: "d".repeat(64),
      acquiredAt: "2026-07-18T09:58:00.000Z",
      heartbeatAt: "2026-07-18T09:59:00.000Z",
      expiresAt: "2026-07-18T10:00:00.000Z"
    });
    const oldBytes = canonicalBytes(oldLease);
    const oldHash = releaseSha256V2(oldBytes);
    const leasePath = join(root, "manifest-transition-root.lease.json");
    const tombstonePath = join(root, `manifest-transition-root.lease-tombstone-${oldHash}.json`);
    await writeFile(leasePath, oldBytes);
    await expect(api.takeoverRootWriterLeaseByHashV2({
      artifactRoot: root,
      expectedOldLeaseSha256: oldHash,
      evaluatedAt: "2026-07-18T10:02:00.000Z",
      faultAt: "after_prepare"
    })).rejects.toThrow("injected_fault_after_prepare");

    linkSync(leasePath, tombstonePath);
    const result = await api.takeoverRootWriterLeaseByHashV2({
      artifactRoot: root,
      expectedOldLeaseSha256: oldHash,
      evaluatedAt: "2026-07-18T10:02:00.000Z"
    });
    expect(result.sealed).toBe(true);
    expect(existsSync(tombstonePath)).toBe(true);
    expect(existsSync(leasePath)).toBe(false);
    expect(existsSync(join(root, "release-root-terminal-abandoned.json"))).toBe(true);
  });
});
