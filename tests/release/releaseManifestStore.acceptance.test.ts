import { existsSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { canonicalReleaseJsonV2 } from "../../src/release/remediationReleaseManifestV2";
import {
  RELEASE_V2_FREEZE_IDENTITY,
  COMMAND_TEMPLATE_SHA256,
  buildExecutedReleaseGateV2Fixture,
  buildOperationalAttestationV2Fixture,
  buildReleaseFreezeIdentityV2Fixture,
  buildReleaseManifestV2Fixture,
  buildTask0BReleaseFreezeEvidence
} from "../fixtures/release/remediationReleaseFixtures";

const roots: string[] = [];
const freezeByRoot = new Map<string, ReturnType<typeof buildReleaseFreezeIdentityV2Fixture>>();
const manifestByRoot = new Map<string, Record<string, unknown>>();

function artifactRootFingerprint(rootPath: string): string {
  const absolute = resolve(rootPath);
  const key = process.platform === "win32" ? absolute.toLowerCase() : absolute;
  return createHash("sha256").update(key, "utf8").digest("hex");
}

function freezeFor(rootPath: string) {
  const freeze = freezeByRoot.get(rootPath);
  if (!freeze) throw new Error("test_freeze_missing");
  return freeze;
}

function freezeShaFor(rootPath: string): string {
  return createHash("sha256").update(`${canonicalReleaseJsonV2(freezeFor(rootPath))}\n`, "utf8").digest("hex");
}
async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "plan5-manifest-v2-"));
  if (process.platform === "win32") {
    const sid = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "[Security.Principal.WindowsIdentity]::GetCurrent().User.Value"], { encoding: "utf8" }).trim();
    execFileSync("icacls.exe", [value, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`,
      "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"]);
  }
  roots.push(value);
  return value;
}

function readinessAdvance(artifactRoot: string, overrides: Record<string, unknown> = {}) {
  return {
    artifactRoot,
    sourceManifest: manifestByRoot.get(artifactRoot) ?? buildReleaseManifestV2Fixture(),
    transition: { transitionId: "readiness" },
    verifiedGateOutputs: [buildExecutedReleaseGateV2Fixture("G05_TELEGRAM")],
    verifiedTransitionEvidence: { refs: [], actualRollbackOutcome: null },
    ...overrides
  };
}

async function initializeManifestRoot(api: any, artifactRoot: string) {
  await api.materializeReleaseFreezeV2(materializeInput(artifactRoot));
  const initialized = await api.initializeReleaseManifestV2({
    artifactRoot,
    evaluatedAt: "2026-07-18T10:00:00.000Z",
    verifiedGateOutputs: buildReleaseManifestV2Fixture().gates.filter((gate) => gate.state === "passed")
  });
  manifestByRoot.set(artifactRoot, initialized.manifest);
}

function authorityValue(issued: Record<string, unknown>) {
  const { attestationSha256: _attestationSha256, ...authority } = issued;
  return authority;
}

async function recursiveRelativeFiles(artifactRoot: string): Promise<string[]> {
  return (await readdir(artifactRoot, { recursive: true })).map((value) => String(value).replace(/\\/gu, "/"));
}
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true })));
  freezeByRoot.clear();
  manifestByRoot.clear();
});

async function loadStoreApi(): Promise<any> {
  const modulePath: string = "../../src/release/releaseManifestStoreV2";
  try { return await import(/* @vite-ignore */ modulePath); }
  catch (error) { throw new Error("Plan 5 feature missing: manifest v2 store", { cause: error }); }
}

function materializeInput(rootPath: string) {
  const task0BPreflightEvidence = buildTask0BReleaseFreezeEvidence({
    observedAt: "2026-07-18T10:00:00.000Z",
    artifactRootFingerprintSha256: artifactRootFingerprint(rootPath)
  });
  const freezeIdentity = buildReleaseFreezeIdentityV2Fixture(task0BPreflightEvidence);
  freezeByRoot.set(rootPath, freezeIdentity);
  const task0BPath = join(rootPath, "task0b-release-freeze.json");
  if (!existsSync(task0BPath)) writeFileSync(task0BPath,
    `${canonicalReleaseJsonV2(task0BPreflightEvidence)}\n`, { flag: "wx" });
  return {
    artifactRoot: rootPath,
    freezeIdentity,
    task0BPreflightEvidence,
    producerId: "release_freeze_materialize" as const,
    evaluatedAt: "2026-07-18T10:00:00.000Z"
  };
}

const DEAD_TEST_OWNER = {
  pid: 2_147_483_647,
  processStartFingerprintSha256: "f".repeat(64)
};

function asDeadTestOwner<T>(api: any, action: () => T): T {
  return api.runWithRootWriterProcessRuntimeForTestsV2({
    currentOwnerIdentity: () => DEAD_TEST_OWNER,
    isOwnerAlive: () => false
  }, action);
}

async function writeExpiredRootWriterLease(rootPath: string) {
  const freeze = freezeFor(rootPath);
  const lease = {
    version: "frozen-root-writer-lease-v2",
    scope: "artifact_root",
    relativePath: "manifest-transition-root.lease.json",
    writerOperationKind: "manifest_transition",
    writerOperationKeySha256: "a".repeat(64),
    transitionKeySha256: "b".repeat(64),
    protectedRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
    candidateSha: freeze.candidateSha,
    releaseGenerationId: freeze.releaseGenerationId,
    releaseFreezeIdentitySha256: freezeShaFor(rootPath),
    leaseEpoch: 1,
    ownerPid: 2147483647,
    ownerProcessStartFingerprintSha256: "c".repeat(64),
    acquiredAt: "2026-07-18T09:58:00.000Z",
    heartbeatAt: "2026-07-18T09:59:00.000Z",
    expiresAt: "2026-07-18T10:00:00.000Z"
  };
  await writeFile(join(rootPath, "manifest-transition-root.lease.json"),
    `${canonicalReleaseJsonV2(lease)}\n`, { flag: "wx" });
  return lease;
}

it("[REQ-38][RELEASE-FREEZE-MATERIALIZER] only release freeze materializer converts verified Task0B evidence into one O_EXCL canonical identity while captureTask0BPreflight cannot impersonate the producer", async () => {
  const api = await loadStoreApi(); const r = await root();
  const input = materializeInput(r);
  const result = await api.materializeReleaseFreezeV2({ ...input, freezeIdentity: undefined });
  expect(result.freezeIdentity).toEqual(freezeFor(r));
  expect(await readdir(r)).toContain("release-freeze-identity-v2.json");
  await expect(api.materializeReleaseFreezeV2({ ...materializeInput(r), producerId: "captureTask0BPreflight" })).rejects.toThrow();
  await expect(api.materializeReleaseFreezeV2({
    ...materializeInput(r),
    freezeIdentity: { ...freezeFor(r), postgresToolIdentitySha256: "f".repeat(64) }
  })).rejects.toThrow(/freeze_identity_mismatch/);
});

it("[REQ-38][RELEASE-FREEZE-CONSUMER-BUNDLE] rejects frozen lifecycle initialization when the prepared materialization or receipt is missing", async () => {
  const api = await loadStoreApi();
  for (const missing of [
    "release-freeze-materialization-prepared-v2.json",
    "release-freeze-materialization-receipt-v2.json"
  ]) {
    const r = await root();
    await api.materializeReleaseFreezeV2(materializeInput(r));
    await rm(join(r, missing));
    await expect(api.initializeReleaseManifestV2({
      artifactRoot: r,
      evaluatedAt: "2026-07-18T10:00:00.000Z",
      verifiedGateOutputs: buildReleaseManifestV2Fixture().gates.filter((gate) => gate.state === "passed")
    })).rejects.toThrow(/freeze.*(bundle|prepared|receipt|materialization)/i);
  }
}, 30_000);

it("[REQ-38][RELEASE-FREEZE-CONSUMER-BINDING] rejects forged prepared receipt or freeze bytes before frozen lifecycle authority", async () => {
  const api = await loadStoreApi();
  const corruptions = [
    async (r: string) => {
      const path = join(r, "release-freeze-materialization-prepared-v2.json");
      const value = JSON.parse((await readFile(path)).toString("utf8"));
      value.canonicalMaterializationReceiptSha256 = "f".repeat(64);
      await writeFile(path, `${canonicalReleaseJsonV2(value)}\n`);
    },
    async (r: string) => {
      const path = join(r, "release-freeze-materialization-receipt-v2.json");
      const value = JSON.parse((await readFile(path)).toString("utf8"));
      value.canonicalFreezeIdentitySha256 = "f".repeat(64);
      await writeFile(path, `${canonicalReleaseJsonV2(value)}\n`);
    },
    async (r: string) => {
      const path = join(r, "release-freeze-identity-v2.json");
      const value = JSON.parse((await readFile(path)).toString("utf8"));
      value.postgresToolIdentitySha256 = "f".repeat(64);
      await writeFile(path, `${canonicalReleaseJsonV2(value)}\n`);
    }
  ];
  for (const corrupt of corruptions) {
    const r = await root();
    await api.materializeReleaseFreezeV2(materializeInput(r));
    await corrupt(r);
    await expect(api.initializeReleaseManifestV2({
      artifactRoot: r,
      evaluatedAt: "2026-07-18T10:00:00.000Z",
      verifiedGateOutputs: buildReleaseManifestV2Fixture().gates.filter((gate) => gate.state === "passed")
    })).rejects.toThrow(/freeze.*(bundle|binding|bytes|hash|prepared|receipt|materialization)/i);
  }
}, 30_000);

it("[REQ-38][RELEASE-FREEZE-ROOT-FINGERPRINT] rejects a byte-exact freeze bundle copied into another trusted artifact root", async () => {
  const api = await loadStoreApi();
  const sourceRoot = await root();
  await api.materializeReleaseFreezeV2(materializeInput(sourceRoot));
  const copiedRoot = await root();
  for (const filename of [
    "task0b-release-freeze.json",
    "release-freeze-materialization-prepared-v2.json",
    "release-freeze-materialization-receipt-v2.json",
    "release-freeze-identity-v2.json"
  ]) {
    await writeFile(join(copiedRoot, filename), await readFile(join(sourceRoot, filename)), { flag: "wx" });
  }
  await expect(api.verifyReleaseManifestStoreV2(copiedRoot))
    .rejects.toThrow(/artifact.*root.*fingerprint|root.*fingerprint.*mismatch/i);
}, 30_000);

it("[REQ-38][RELEASE-FREEZE-CONSUMER-CRASH-REPLAY] accepts the exact verified freeze bundle after prepared-publication takeover recovery", async () => {
  const api = await loadStoreApi();
  const r = await root();
  await expect(asDeadTestOwner(api, () => api.materializeReleaseFreezeV2({
    ...materializeInput(r), faultAt: "after_identity"
  }))).rejects.toThrow();
  const oldHash = createHash("sha256")
    .update(await readFile(join(r, "manifest-transition-root.lease.json"))).digest("hex");
  await api.takeoverRootWriterLeaseByHashV2({
    artifactRoot: r, expectedOldLeaseSha256: oldHash, evaluatedAt: "2026-07-18T10:20:00.000Z"
  });
  await api.materializeReleaseFreezeV2({
    ...materializeInput(r), evaluatedAt: "2026-07-18T10:20:00.000Z"
  });
  await expect(api.initializeReleaseManifestV2({
    artifactRoot: r,
    evaluatedAt: "2026-07-18T10:20:00.000Z",
    verifiedGateOutputs: buildReleaseManifestV2Fixture().gates.filter((gate) => gate.state === "passed")
  })).resolves.toMatchObject({ manifest: { revision: 1 } });
});

it("[REQ-38][BOOTSTRAP-ROOT-WRITER-CRASH] discriminates bootstrap from frozen lease takeover and terminal bytes resumes exact prepared freeze after dead-owner takeover and seals the root for new-root retry when owner dies before prepare including crash after lease acquisition and after prepare before freeze receipt", async () => {
  const api = await loadStoreApi();
  const unpreparedRoot = await root();
  await expect(asDeadTestOwner(api, () => api.materializeReleaseFreezeV2({
    ...materializeInput(unpreparedRoot), faultAt: "after_lease"
  }))).rejects.toThrow();
  const unpreparedHash = createHash("sha256").update(await readFile(join(unpreparedRoot, "manifest-transition-root.lease.json"))).digest("hex");
  const abandoned = await api.takeoverRootWriterLeaseByHashV2({ artifactRoot: unpreparedRoot, expectedOldLeaseSha256: unpreparedHash, evaluatedAt: "2026-07-18T10:20:00.000Z" });
  expect(abandoned.sealed).toBe(true);
  await expect(api.materializeReleaseFreezeV2(materializeInput(unpreparedRoot))).rejects.toThrow(/new_root|sealed|abandoned/);
  expect(await readdir(unpreparedRoot)).toContain("bootstrap-root-terminal-abandoned-v2.json");
  expect(await readdir(unpreparedRoot)).not.toContain("release-freeze-identity-v2.json");
  for (const faultAt of ["after_prepare", "after_identity"]) {
    const r = await root();
    await expect(asDeadTestOwner(api, () => api.materializeReleaseFreezeV2({
      ...materializeInput(r), faultAt
    }))).rejects.toThrow();
    const oldHash = createHash("sha256").update(await readFile(join(r, "manifest-transition-root.lease.json"))).digest("hex");
    const takeover = await api.takeoverRootWriterLeaseByHashV2({ artifactRoot: r, expectedOldLeaseSha256: oldHash, evaluatedAt: "2026-07-18T10:20:00.000Z" });
    expect(takeover.sealed).toBe(false);
    const recovered = await api.materializeReleaseFreezeV2({ ...materializeInput(r), evaluatedAt: "2026-07-18T10:20:00.000Z" });
    expect(recovered.freezeIdentity).toEqual(freezeFor(r));
  }
}, 30_000);

it("[REQ-38][BOOTSTRAP-ROOT-WRITER-LEASE-CLEANUP] leaves manifest-transition-root lease absent after both normal materialization and prepared-freeze takeover-resumed successful materialization", async () => {
  const api = await loadStoreApi(); const r = await root();
  await api.materializeReleaseFreezeV2(materializeInput(r));
  expect(await readdir(r)).not.toContain("manifest-transition-root.lease.json");
});

it("[REQ-38][OPERATIONAL-AUTHORITY-ISSUER] appends content-addressed attestation and previous-hash issuer receipt without overwriting consumed or expired authority", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-18T10:00:00.000Z"));
  const api = await loadStoreApi(); const r = await root();
  await initializeManifestRoot(api, r);
  const first = await api.issueOperationalAttestationV2({ artifactRoot: r, action: "g12_backup_passed" });
  await api.terminalizeExpiredOperationalAttestationV2({
    artifactRoot: r, authority: authorityValue(first), evaluatedAt: "2026-07-18T11:11:00.000Z"
  });
  const terminalRelativePath = (await recursiveRelativeFiles(r)).find((name) =>
    name.startsWith(`authority-terminal-receipts/g12_backup_passed/${freezeFor(r).releaseGenerationId}/`))!;
  const terminalSha256 = createHash("sha256").update(await readFile(join(r, terminalRelativePath))).digest("hex");
  vi.setSystemTime(new Date("2026-07-18T11:12:00.000Z"));
  const second = await api.issueOperationalAttestationV2({ artifactRoot: r, action: "g12_backup_passed" });
  expect(second.previousAttestationSha256).toBe(first.attestationSha256);
  expect(second.attestationSha256).not.toBe(first.attestationSha256);
}, 30_000);

it("[REQ-38][OPERATIONAL-AUTHORITY-SOLE-ISSUER] derives source policy time expiry and lineage and rejects operator-forged authority fields", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-18T10:00:00.000Z"));
  const api = await loadStoreApi(); const r = await root(); await initializeManifestRoot(api, r);
  for (const forged of [
    { issuedAt: "2099-01-01T00:00:00.000Z" },
    { expiresAt: "2099-01-01T01:00:00.000Z" },
    { sourceManifestSha256: "f".repeat(64) },
    { commandId: "production_canary" }
  ]) {
    await expect(api.issueOperationalAttestationV2({
      artifactRoot: r, action: "g12_backup_passed", ...forged
    })).rejects.toThrow(/input|field|operator/i);
  }
  const authority = await api.issueOperationalAttestationV2({
    artifactRoot: r, action: "g12_backup_passed"
  });
  const manifestBytes = await readFile(join(r, "release-manifest.json"));
  expect(authority).toMatchObject({
    action: "g12_backup_passed",
    sourceManifestSha256: createHash("sha256").update(manifestBytes).digest("hex"),
    commandId: "production_backup",
    redactedTemplateSha256: COMMAND_TEMPLATE_SHA256.production_backup,
    issuedAt: "2026-07-18T10:00:00.000Z",
    expiresAt: "2026-07-18T11:10:00.000Z",
    previousAttestationSha256: null,
    priorTerminalLineageSha256: null
  });
});

it("[REQ-38][OPERATIONAL-AUTHORITY-PREPARED-RESUME] resumes one unresolved prepared issuance from stored bytes without reading a new time", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-18T10:00:00.000Z"));
  const api = await loadStoreApi(); const r = await root(); await initializeManifestRoot(api, r);
  await expect(api.issueOperationalAttestationV2({
    artifactRoot: r, action: "g12_backup_passed", faultAt: "after_prepare"
  })).rejects.toThrow();
  vi.setSystemTime(new Date("2026-07-18T10:30:00.000Z"));
  const resumed = await api.issueOperationalAttestationV2({ artifactRoot: r, action: "g12_backup_passed" });
  expect(resumed.issuedAt).toBe("2026-07-18T10:00:00.000Z");
  expect(resumed.expiresAt).toBe("2026-07-18T11:10:00.000Z");
  expect(await api.issueOperationalAttestationV2({ artifactRoot: r, action: "g12_backup_passed" }))
    .toEqual(resumed);
}, 30_000);

it("[REQ-38][OPERATIONAL-AUTHORITY-TAKEOVER-LINEAGE] rejects direct prepared resume until the epoch takeover receipt is committed and then resumes", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-18T10:00:00.000Z"));
  const api = await loadStoreApi(); const r = await root(); await initializeManifestRoot(api, r);
  await expect(api.issueOperationalAttestationV2({
    artifactRoot: r, action: "g12_backup_passed", faultAt: "after_prepare"
  })).rejects.toThrow();
  const leasePath = join(r, "manifest-transition-root.lease.json");
  const lease = JSON.parse((await readFile(leasePath, "utf8"))) as Record<string, unknown>;
  const deadLease = {
    ...lease,
    ownerPid: 2147483647,
    ownerProcessStartFingerprintSha256: "d".repeat(64),
    acquiredAt: "2026-07-18T09:58:00.000Z",
    heartbeatAt: "2026-07-18T09:59:00.000Z",
    expiresAt: "2026-07-18T10:00:00.000Z"
  };
  const deadLeaseBytes = Buffer.from(`${canonicalReleaseJsonV2(deadLease)}\n`, "utf8");
  await writeFile(leasePath, deadLeaseBytes);
  const oldLeaseSha256 = createHash("sha256").update(deadLeaseBytes).digest("hex");
  await expect(api.takeoverRootWriterLeaseByHashV2({
    artifactRoot: r,
    expectedOldLeaseSha256: oldLeaseSha256,
    evaluatedAt: "2026-07-18T10:02:00.000Z",
    faultAt: "after_new_lease"
  })).rejects.toThrow("injected_fault_after_new_lease");
  await expect(api.issueOperationalAttestationV2({ artifactRoot: r, action: "g12_backup_passed" }))
    .rejects.toThrow(/takeover.*receipt|lineage/i);
  await api.takeoverRootWriterLeaseByHashV2({
    artifactRoot: r,
    expectedOldLeaseSha256: oldLeaseSha256,
    evaluatedAt: "2026-07-18T10:02:00.000Z"
  });
  await expect(api.issueOperationalAttestationV2({ artifactRoot: r, action: "g12_backup_passed" }))
    .resolves.toMatchObject({ action: "g12_backup_passed", issuedAt: "2026-07-18T10:00:00.000Z" });
}, 30_000);

it("[REQ-38][OPERATIONAL-AUTHORITY-COMPLETED-TAKEOVER-LINEAGE] rejects completed replay until the epoch takeover receipt is committed and then releases the lease", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-18T10:00:00.000Z"));
  const api = await loadStoreApi(); const r = await root(); await initializeManifestRoot(api, r);
  const issued = await api.issueOperationalAttestationV2({ artifactRoot: r, action: "g12_backup_passed" });
  const operationKey = createHash("sha256").update(canonicalReleaseJsonV2([
    "operational_authority_issue", issued.action, issued.generationId, issued.attestationSha256
  ])).digest("hex");
  const deadLease = {
    version: "frozen-root-writer-lease-v2",
    scope: "artifact_root",
    relativePath: "manifest-transition-root.lease.json",
    writerOperationKind: "operational_authority_issue",
    writerOperationKeySha256: operationKey,
    transitionKeySha256: null,
    protectedRootFingerprintSha256: freezeFor(r).artifactRootFingerprintSha256,
    candidateSha: freezeFor(r).candidateSha,
    releaseGenerationId: freezeFor(r).releaseGenerationId,
    releaseFreezeIdentitySha256: freezeShaFor(r),
    leaseEpoch: 1,
    ownerPid: 2147483647,
    ownerProcessStartFingerprintSha256: "e".repeat(64),
    acquiredAt: "2026-07-18T09:58:00.000Z",
    heartbeatAt: "2026-07-18T09:59:00.000Z",
    expiresAt: "2026-07-18T10:00:00.000Z"
  };
  const deadLeaseBytes = Buffer.from(`${canonicalReleaseJsonV2(deadLease)}\n`, "utf8");
  await writeFile(join(r, "manifest-transition-root.lease.json"), deadLeaseBytes, { flag: "wx" });
  const oldLeaseSha256 = createHash("sha256").update(deadLeaseBytes).digest("hex");
  await expect(api.takeoverRootWriterLeaseByHashV2({
    artifactRoot: r,
    expectedOldLeaseSha256: oldLeaseSha256,
    evaluatedAt: "2026-07-18T10:02:00.000Z",
    faultAt: "after_new_lease"
  })).rejects.toThrow("injected_fault_after_new_lease");
  await expect(api.issueOperationalAttestationV2({ artifactRoot: r, action: "g12_backup_passed" }))
    .rejects.toThrow(/takeover.*receipt|lineage/i);
  await api.takeoverRootWriterLeaseByHashV2({
    artifactRoot: r,
    expectedOldLeaseSha256: oldLeaseSha256,
    evaluatedAt: "2026-07-18T10:02:00.000Z"
  });
  await expect(api.issueOperationalAttestationV2({ artifactRoot: r, action: "g12_backup_passed" }))
    .resolves.toEqual(issued);
  expect(existsSync(join(r, "manifest-transition-root.lease.json"))).toBe(false);
}, 30_000);

it("[REQ-38][OPERATIONAL-AUTHORITY-BARE-CONSUMPTION] refuses recovery from a bare consumption record without exact terminal settlement and cleanup lineage", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-18T10:00:00.000Z"));
  const api = await loadStoreApi(); const r = await root(); await initializeManifestRoot(api, r);
  const issued = await api.issueOperationalAttestationV2({ artifactRoot: r, action: "g12_backup_passed" });
  await writeFile(join(r, `operational-attestation-consumption-${issued.attestationSha256}.json`),
    `${canonicalReleaseJsonV2({
      version: "operational-attestation-consumption-v2",
      attestationSha256: issued.attestationSha256,
      generationId: issued.generationId,
      candidateSha: issued.candidateSha
    })}\n`, { flag: "wx" });
  await expect(api.issueOperationalAttestationV2({ artifactRoot: r, action: "g12_backup_passed" }))
    .rejects.toThrow("previous_authority_terminal_settlement_required");
}, 30_000);

it("[REQ-38][OPERATIONAL-AUTHORITY-ISSUER-CRASH] replays exact prepared bytes before attestation between attestation and receipt and after receipt before committed marker without a second clock read or branch and rejects a competing issuer or conflicting prepare under the fixed root-writer lease", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-18T10:00:00.000Z"));
  const api = await loadStoreApi();
  for (const faultAt of ["after_prepare", "after_attestation", "after_receipt"]) {
    const r = await root(); await initializeManifestRoot(api, r);
    const input = { artifactRoot: r, action: "g12_backup_passed", faultAt };
    await expect(api.issueOperationalAttestationV2(input)).rejects.toThrow();
    const result = await api.issueOperationalAttestationV2({ ...input, faultAt: undefined });
    const replay = await api.issueOperationalAttestationV2({ ...input, faultAt: undefined });
    expect(replay).toEqual(result);
  }
}, 60_000);

it("[REQ-38][OPERATIONAL-AUTHORITY-SELECTION] selects exactly one active compatible unconsumed linear-chain tip and rejects branch gap or multiple active authority", async () => {
  const api = await loadStoreApi();
  const active = buildOperationalAttestationV2Fixture();
  expect(api.selectOperationalAttestationV2([active], { evaluatedAt: "2026-07-18T10:05:00.000Z", action: "pre_manual" })).toEqual(active);
  expect(() => api.selectOperationalAttestationV2([active, { ...active, generationId: "branch" }], { evaluatedAt: "2026-07-18T10:05:00.000Z", action: "pre_manual" })).toThrow();
});

it("[REQ-38][OPERATIONAL-AUTHORITY-RECOVERY] issues fresh recovery authority only after exact prior terminal lineage and preserves prior bytes", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-18T10:00:00.000Z"));
  const api = await loadStoreApi(); const r = await root(); await initializeManifestRoot(api, r);
  const issued = await api.issueOperationalAttestationV2({ artifactRoot: r, action: "g12_backup_passed" });
  const authorityRelativePath = (await recursiveRelativeFiles(r)).find((name) =>
    name === `operational-attestations/g12_backup_passed/${freezeFor(r).releaseGenerationId}/${issued.attestationSha256}.json`)!;
  const original = await readFile(join(r, authorityRelativePath));
  await api.terminalizeExpiredOperationalAttestationV2({
    artifactRoot: r, authority: authorityValue(issued), evaluatedAt: "2026-07-18T11:11:00.000Z"
  });
  const terminalReceiptRelativePath = (await recursiveRelativeFiles(r)).find((name) =>
    name.startsWith(`authority-terminal-receipts/g12_backup_passed/${freezeFor(r).releaseGenerationId}/`))!;
  const terminalReceiptPath = join(r, terminalReceiptRelativePath);
  const terminalReceiptSha256 = createHash("sha256").update(await readFile(terminalReceiptPath)).digest("hex");
  vi.setSystemTime(new Date("2026-07-18T11:12:00.000Z"));
  const recovery = await api.issueOperationalAttestationV2({ artifactRoot: r, action: "g12_backup_passed" });
  expect(recovery.priorTerminalLineageSha256).toBe(terminalReceiptSha256);
  expect(await readFile(join(r, authorityRelativePath))).toEqual(original);
}, 30_000);

it("[REQ-38][OPERATIONAL-AUTHORITY-EXPIRED-UNCLAIMED] rejects early terminalization terminalizes an expired never-claimed zero-effect authority through prepared and committed bytes permits bound replacement and rejects it when any preclaim claim consumption action lease G13 bound session advisory lock operation or effect artifact exists", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-18T10:00:00.000Z"));
  const api = await loadStoreApi(); const r = await root(); await initializeManifestRoot(api, r);
  const issued = await api.issueOperationalAttestationV2({ artifactRoot: r, action: "g12_backup_passed" });
  const authority = authorityValue(issued);
  const unissuedRoot = await root(); await initializeManifestRoot(api, unissuedRoot);
  await expect(api.terminalizeExpiredOperationalAttestationV2({
    artifactRoot: unissuedRoot, authority, evaluatedAt: "2026-07-18T11:11:00.000Z"
  })).rejects.toThrow();
  await expect(api.terminalizeExpiredOperationalAttestationV2({ artifactRoot: r, authority, evaluatedAt: "2026-07-18T10:00:30.000Z" })).rejects.toThrow();
  const terminal = await api.terminalizeExpiredOperationalAttestationV2({
    artifactRoot: r, authority, evaluatedAt: "2026-07-18T11:11:00.000Z", observedArtifacts: []
  });
  expect(terminal.reason).toBe("expired_unclaimed");
  for (const artifact of ["preclaim", "claim", "consumption", "action_lease", "g13_session", "advisory_lock", "operation", "effect"]) {
    const conflictRoot = await root(); await initializeManifestRoot(api, conflictRoot);
    const conflictIssued = await api.issueOperationalAttestationV2({
      artifactRoot: conflictRoot, action: "g12_backup_passed"
    });
    const conflictAuthority = authorityValue(conflictIssued);
    const conflictPath = join(conflictRoot, artifact === "consumption"
      ? `operational-attestation-consumption-${conflictIssued.attestationSha256}.json`
      : `production-${artifact}-conflict.json`);
    await writeFile(conflictPath, `${canonicalReleaseJsonV2({
      version: `production-${artifact}-test-v2`,
      operationalAttestationSha256: conflictIssued.attestationSha256,
      releaseGenerationId: freezeFor(conflictRoot).releaseGenerationId,
      candidateSha: freezeFor(conflictRoot).candidateSha
    })}\n`, { flag: "wx" });
    await expect(api.terminalizeExpiredOperationalAttestationV2({
      artifactRoot: conflictRoot, authority: conflictAuthority, evaluatedAt: "2026-07-18T11:11:00.000Z"
    })).rejects.toThrow();
    await rm(conflictPath, { force: true });
  }
}, 120_000);

it("[REQ-38][OPERATIONAL-AUTHORITY-SWAPPED] rejects swapped freeze root generation candidate source command previous attestation or terminal lineage", async () => {
  const api = await loadStoreApi(); const valid = buildOperationalAttestationV2Fixture();
  for (const [field, value] of [["releaseFreezeIdentitySha256", "f".repeat(64)], ["generationId", "foreign"], ["candidateSha", "f".repeat(40)], ["sourceManifestSha256", "f".repeat(64)], ["commandId", "production_canary"], ["previousAttestationSha256", "f".repeat(64)], ["priorTerminalLineageSha256", "f".repeat(64)]]) {
    expect(() => api.assertOperationalAttestationBindingV2({ ...valid, [field]: value }, valid)).toThrow();
  }
});

it("[REQ-38][ROOT-WRITER-SERIALIZATION] one fixed root-writer lease and CAS serializes freeze materialization manifest transition authority issue and authority terminalization and rejects every competing writer kind", async () => {
  const api = await loadStoreApi(); const r = await root();
  const outcomes = await Promise.allSettled([
    api.materializeReleaseFreezeV2(materializeInput(r)),
    api.advanceReleaseManifestV2(readinessAdvance(r)),
    api.issueOperationalAttestationV2({ artifactRoot: r, action: "g12_backup_passed" })
  ]);
  expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
});

it("[REQ-38][MANIFEST-V2-CAS] rejects stale and concurrent writers without overwriting the winner", async () => {
  const api = await loadStoreApi(); const r = await root(); await initializeManifestRoot(api, r);
  const outcomes = await Promise.allSettled([1, 2].map(() => api.advanceReleaseManifestV2(readinessAdvance(r))));
  expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
});

it("[REQ-38][MANIFEST-V2-INITIAL-CRASH] resumes revision-one prepare manifest-replace and receipt boundaries byte-exactly", async () => {
  const api = await loadStoreApi();
  for (const faultAt of ["after_prepare", "after_manifest_replace", "after_receipt"]) {
    const r = await root(); await api.materializeReleaseFreezeV2(materializeInput(r));
    const input = {
      artifactRoot: r,
      evaluatedAt: "2026-07-18T10:00:00.000Z",
      verifiedGateOutputs: buildReleaseManifestV2Fixture().gates.filter((gate) => gate.state === "passed"),
      faultAt
    };
    await expect(api.initializeReleaseManifestV2(input)).rejects.toThrow();
    const recovered = await api.initializeReleaseManifestV2({ ...input, faultAt: undefined });
    expect(recovered.manifest.revision).toBe(1);
    expect(await readdir(r)).not.toContain("manifest-transition-root.lease.json");
  }
}, 30_000);

it("[REQ-38][MANIFEST-V2-INITIAL-TARGET-PATH] rejects revision-one replay when prepared target path is not its exact revision and bytes hash", async () => {
  const api = await loadStoreApi(); const r = await root(); await api.materializeReleaseFreezeV2(materializeInput(r));
  const input = {
    artifactRoot: r,
    evaluatedAt: "2026-07-18T10:00:00.000Z",
    verifiedGateOutputs: buildReleaseManifestV2Fixture().gates.filter((gate) => gate.state === "passed"),
    faultAt: "after_prepare"
  };
  await expect(api.initializeReleaseManifestV2(input)).rejects.toThrow();
  const preparedName = (await readdir(r)).find((name) => name.startsWith("manifest-transition-prepared-"))!;
  const preparedPath = join(r, preparedName);
  const prepared = JSON.parse(String(await readFile(preparedPath)));
  const forgedRelativePath = "manifest-snapshots/release-manifest-r1-forged.json";
  await writeFile(join(r, forgedRelativePath),
    await readFile(join(r, String(prepared.targetSnapshotRelativePath))), { flag: "wx" });
  prepared.targetSnapshotRelativePath = forgedRelativePath;
  await writeFile(preparedPath, `${canonicalReleaseJsonV2(prepared)}\n`);
  await expect(api.initializeReleaseManifestV2({ ...input, faultAt: undefined }))
    .rejects.toThrow(/initial.*target.*snapshot.*path|snapshot.*path.*invalid/i);
}, 30_000);

it("[REQ-38][MANIFEST-V2-CRASH] recovers exactly before and after the atomic manifest replace", async () => {
  const api = await loadStoreApi();
  for (const faultAt of ["before_manifest_replace", "after_manifest_replace"]) {
    const r = await root(); await initializeManifestRoot(api, r); const input = readinessAdvance(r, { faultAt });
    await expect(api.advanceReleaseManifestV2(input)).rejects.toThrow();
    const recovered = await api.advanceReleaseManifestV2({ ...input, faultAt: undefined }); expect(recovered.manifest.revision).toBe(2);
  }
}, 30_000);

it("[REQ-38][MANIFEST-V2-CRASH-RECEIPT] restores exact prepared canonical receipt bytes and hash after replace-before-receipt without rerunning time reducer or serializer", async () => {
  const api = await loadStoreApi(); const r = await root(); await initializeManifestRoot(api, r); const input = readinessAdvance(r, { evaluatedAt: "2026-07-18T10:03:00.000Z", faultAt: "after_manifest_replace" });
  await expect(api.advanceReleaseManifestV2(input)).rejects.toThrow();
  const preparedNames = (await readdir(r)).filter((name) => name.startsWith("manifest-transition-prepared-"));
  const preparedName = (await Promise.all(preparedNames.map(async (name) => ({
    name,
    transitionId: JSON.parse(String(await readFile(join(r, name)))).transitionId
  })))).find((value) => value.transitionId === "readiness")!.name;
  const before = await readFile(join(r, preparedName));
  await api.advanceReleaseManifestV2({ ...input, faultAt: undefined, evaluatedAt: "2099-01-01T00:00:00.000Z" });
  expect(await readFile(join(r, preparedName))).toEqual(before);
}, 30_000);

it("[REQ-38][MANIFEST-V2-PREPARED-TARGET-HEAD] rejects a prepared transition whose target snapshot path is not the exact revision and bytes hash of the current head", async () => {
  const api = await loadStoreApi(); const r = await root(); await initializeManifestRoot(api, r);
  const input = readinessAdvance(r, {
    evaluatedAt: "2026-07-18T10:03:00.000Z",
    faultAt: "after_manifest_replace"
  });
  await expect(api.advanceReleaseManifestV2(input)).rejects.toThrow();
  const preparedName = (await Promise.all((await readdir(r))
    .filter((name) => name.startsWith("manifest-transition-prepared-"))
    .map(async (name) => ({
      name,
      transitionId: JSON.parse(String(await readFile(join(r, name)))).transitionId
    })))).find((value) => value.transitionId === "readiness")!.name;
  const preparedPath = join(r, preparedName);
  const prepared = JSON.parse(String(await readFile(preparedPath)));
  const originalSnapshot = join(r, String(prepared.targetSnapshotRelativePath));
  const forgedRelativePath = `manifest-snapshots/release-manifest-r${prepared.targetRevision}-forged.json`;
  await writeFile(join(r, forgedRelativePath), await readFile(originalSnapshot), { flag: "wx" });
  prepared.targetSnapshotRelativePath = forgedRelativePath;
  await writeFile(preparedPath, `${canonicalReleaseJsonV2(prepared)}\n`);
  await expect(api.advanceReleaseManifestV2({ ...input, faultAt: undefined }))
    .rejects.toThrow(/target.*snapshot.*path|prepared.*snapshot.*path/i);
}, 30_000);

it("[REQ-38][MANIFEST-V2-HISTORICAL-TARGET-BINDING] rejects historical prepared target path hash or revision drift before issuing later authority", async () => {
  const api = await loadStoreApi(); const r = await root(); await initializeManifestRoot(api, r);
  await api.advanceReleaseManifestV2(readinessAdvance(r));
  const preparedNames = (await readdir(r)).filter((name) => name.startsWith("manifest-transition-prepared-"));
  const initialPreparedName = (await Promise.all(preparedNames.map(async (name) => ({
    name,
    value: JSON.parse(String(await readFile(join(r, name))))
  })))).find((entry) => entry.value.transitionId === "pre_manual")!;
  const preparedPath = join(r, initialPreparedName.name);
  const forgedRelativePath = "manifest-snapshots/release-manifest-r1-historical-forged.json";
  await writeFile(join(r, forgedRelativePath),
    await readFile(join(r, String(initialPreparedName.value.targetSnapshotRelativePath))), { flag: "wx" });
  initialPreparedName.value.targetSnapshotRelativePath = forgedRelativePath;
  await writeFile(preparedPath, `${canonicalReleaseJsonV2(initialPreparedName.value)}\n`);
  await expect(api.issueOperationalAttestationV2({ artifactRoot: r, action: "g12_backup_passed" }))
    .rejects.toThrow(/prepared.*(target|receipt)|snapshot.*path|manifest.*chain/i);
}, 30_000);

it("[REQ-38][MANIFEST-V2-REPLAY] exact replay is byte-identical and conflicting replay fails closed", async () => {
  const api = await loadStoreApi(); const r = await root(); await initializeManifestRoot(api, r); const input = readinessAdvance(r);
  const first = await api.advanceReleaseManifestV2(input); const second = await api.advanceReleaseManifestV2(input); expect(second).toEqual(first);
  await expect(api.advanceReleaseManifestV2({ ...input, transition: { transitionId: "g12_backup_passed" }, verifiedGateOutputs: [buildExecutedReleaseGateV2Fixture("G12_PRODUCTION_BACKUP")] })).rejects.toThrow();
}, 30_000);

it("[REQ-38][MANIFEST-V2-ROOT-LEASE] one fixed root-wide lease serializes competing different transition keys before the loser creates a claim", async () => {
  const api = await loadStoreApi(); const r = await root(); await initializeManifestRoot(api, r);
  const claimCountBefore = (await readdir(r)).filter((name) => name.includes("claim")).length;
  const outcomes = await Promise.allSettled([
    readinessAdvance(r),
    readinessAdvance(r, { transition: { transitionId: "g12_backup_passed" }, verifiedGateOutputs: [buildExecutedReleaseGateV2Fixture("G12_PRODUCTION_BACKUP")] })
  ].map((input) => api.advanceReleaseManifestV2(input)));
  expect(outcomes.filter((item) => item.status === "fulfilled").length).toBeLessThanOrEqual(1);
  expect((await readdir(r)).filter((name) => name.includes("claim"))).toHaveLength(claimCountBefore + 1);
});

it("[REQ-38][MANIFEST-V2-PATH-SAFETY] requires allowlisted trusted principal policy and rejects pre-existing or detectable POSIX symlink Windows junction reparse and identity substitutions without claiming undetectable same-principal race defense", async () => {
  const api = await loadStoreApi(); const r = await root();
  await expect(api.verifyArtifactRootTrustV2({ artifactRoot: r, principalPolicyId: "foreign" })).rejects.toThrow();
  await expect(api.verifyArtifactRootTrustV2({
    artifactRoot: r,
    principalPolicyId: process.platform === "win32" ? "windows-configured-canonical-set-v1" : "posix-owner-only-v1"
  })).resolves.toBeDefined();
});

it("[REQ-38][ARTIFACT-ROOT-TRUSTED-PRINCIPALS] accepts normalized writable service account LocalSystem and BUILTIN Administrators or exact configured canonical set without persisting raw ACL or principal values", async () => {
  const api = await loadStoreApi(); const result = api.normalizeTrustedPrincipalPolicyV2({ platform: "windows", principals: ["service-account", "LocalSystem", "BUILTIN\\Administrators"] });
  expect(result.normalizedTrustedPrincipalSetSha256).toMatch(/^[0-9a-f]{64}$/); expect(JSON.stringify(result)).not.toContain("service-account");
});

it("[REQ-38][ARTIFACT-ROOT-UNTRUSTED-WRITE] rejects writable Everyone Users foreign ACE and unsupported filesystem or ACL identity", async () => {
  const api = await loadStoreApi();
  for (const principal of ["Everyone", "BUILTIN\\Users", "foreign-ace"]) expect(() => api.normalizeTrustedPrincipalPolicyV2({ platform: "windows", principals: [principal] })).toThrow();
  expect(() => api.normalizeTrustedPrincipalPolicyV2({ platform: "unsupported", principals: [] })).toThrow();
});

it("[REQ-38][MANIFEST-V2-RECOVERY] validates claim root-lease prepared canonical-receipt committed filenames TTL liveness exact-generation resume and receipt chain", async () => {
  const api = await loadStoreApi(); const r = await root(); await api.materializeReleaseFreezeV2(materializeInput(r));
  const state = await api.recoverReleaseManifestStoreV2({ artifactRoot: r, expectedGenerationId: freezeFor(r).releaseGenerationId, evaluatedAt: "2026-07-18T10:05:00.000Z" }); expect(state.generationId).toBe(freezeFor(r).releaseGenerationId);
  await expect(api.recoverReleaseManifestStoreV2({ artifactRoot: r, expectedGenerationId: "foreign", evaluatedAt: "2026-07-18T10:05:00.000Z" })).rejects.toThrow();
});

it("[REQ-38][MANIFEST-V2-LEASE-TAKEOVER] takes over only one exact expired dead-owner lease in the same generation through prepared tombstone new lease and receipt", async () => {
  const api = await loadStoreApi(); const r = await root(); await api.materializeReleaseFreezeV2(materializeInput(r)); await writeExpiredRootWriterLease(r);
  const expectedOldLeaseSha256 = createHash("sha256").update(await readFile(join(r, "manifest-transition-root.lease.json"))).digest("hex");
  const result = await api.takeoverRootWriterLeaseByHashV2({ artifactRoot: r, expectedOldLeaseSha256, evaluatedAt: "2026-07-18T10:01:00.000Z" });
  expect(result.newLease.leaseEpoch).toBe(2);
});

it("[REQ-38][MANIFEST-V2-LEASE-TAKEOVER-CRASH] replays exactly before and after tombstone new-lease and receipt boundaries without deleting or duplicating authority", async () => {
  const api = await loadStoreApi();
  for (const faultAt of ["after_prepare", "after_tombstone", "after_new_lease", "after_receipt"]) {
    const r = await root(); await api.materializeReleaseFreezeV2(materializeInput(r)); await writeExpiredRootWriterLease(r);
    const expectedOldLeaseSha256 = createHash("sha256").update(await readFile(join(r, "manifest-transition-root.lease.json"))).digest("hex");
    const input = { artifactRoot: r, expectedOldLeaseSha256, evaluatedAt: "2026-07-18T10:01:00.000Z", faultAt };
    await expect(api.takeoverRootWriterLeaseByHashV2(input)).rejects.toThrow();
    const result = await api.takeoverRootWriterLeaseByHashV2({ ...input, faultAt: undefined });
    expect(result.newLease.leaseEpoch).toBe(2);
  }
}, 30_000);

it("[REQ-38][MANIFEST-V2-LEASE-FENCE] prevents the old owner from any effect or manifest replace after lease hash or epoch changes", async () => {
  const api = await loadStoreApi(); expect(() => api.assertRootWriterLeaseFenceV2({ ownerId: "old", epoch: 1, leaseSha256: "a".repeat(64) }, { ownerId: "new", epoch: 2, leaseSha256: "b".repeat(64) })).toThrow();
});

it("[REQ-38][MANIFEST-V2-AUTHORITY-SELECTION] accepts only the freeze generation rejects a second generation and seals incompatible or terminal roots", async () => {
  const api = await loadStoreApi(); const authority = buildOperationalAttestationV2Fixture(); expect(api.selectOperationalAttestationV2([authority], { generationId: RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId, evaluatedAt: "2026-07-18T10:05:00.000Z" })).toEqual(authority); expect(() => api.selectOperationalAttestationV2([{ ...authority, generationId: "second" }], { generationId: RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId, evaluatedAt: "2026-07-18T10:05:00.000Z" })).toThrow();
});

it("[REQ-38][MANIFEST-V2-SEALED-ROOT] rejects every transition on terminal-abandoned root and never auto-copies state to a new root", async () => {
  const api = await loadStoreApi(); const r = await root(); await expect(api.advanceReleaseManifestV2(readinessAdvance(r, { rootState: "terminal_abandoned" }))).rejects.toThrow(); expect(await readdir(r)).toEqual([]);
});

it("[REQ-38][RELEASE-FREEZE-OWNER-IDENTITY] rejects a caller-forged owner PID and process-start identity before creating a lease", async () => {
  const api = await loadStoreApi(); const r = await root();
  await expect(api.materializeReleaseFreezeV2({
    ...materializeInput(r),
    owner: { ownerId: "forged", pid: 2_147_483_647, processStartedAt: "2026-07-18T09:59:00.000Z" }
  })).rejects.toThrow(/process_identity|owner/i);
  expect(await readdir(r)).not.toContain("manifest-transition-root.lease.json");
});

it("[REQ-38][RELEASE-FREEZE-COMPLETED-REPLAY-LEASE] refuses success while a foreign or stale fixed root-writer lease remains", async () => {
  const api = await loadStoreApi(); const r = await root();
  const input = materializeInput(r);
  await api.materializeReleaseFreezeV2(input);
  await writeExpiredRootWriterLease(r);
  await expect(api.materializeReleaseFreezeV2(input)).rejects.toThrow(/lease|replay|foreign|stale/i);

  const staleRoot = await root();
  const staleInput = materializeInput(staleRoot);
  await expect(api.materializeReleaseFreezeV2({ ...staleInput, faultAt: "after_identity" })).rejects.toThrow();
  const prepared = JSON.parse((await readFile(join(staleRoot,
    "release-freeze-materialization-prepared-v2.json"))).toString("utf8"));
  await writeFile(join(staleRoot, "release-freeze-materialization-receipt-v2.json"),
    Buffer.from(prepared.canonicalMaterializationReceiptUtf8Base64, "base64"), { flag: "wx" });
  await expect(api.materializeReleaseFreezeV2({
    ...staleInput,
    evaluatedAt: "2026-07-18T10:02:00.000Z"
  })).rejects.toThrow(/stale.*lease|lease.*stale/i);
});

it("[REQ-38][AUTHORITY-USE-ARTIFACT-FAIL-CLOSED] rejects malformed production artifact bytes instead of treating them as absence", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-18T10:00:00.000Z"));
  const api = await loadStoreApi(); const r = await root(); await initializeManifestRoot(api, r);
  const issued = await api.issueOperationalAttestationV2({ artifactRoot: r, action: "g12_backup_passed" });
  await writeFile(join(r, "production-malformed.json"), "{not-json\n", { flag: "wx" });
  await expect(api.terminalizeExpiredOperationalAttestationV2({
    artifactRoot: r,
    authority: authorityValue(issued),
    evaluatedAt: "2026-07-18T11:11:00.000Z"
  })).rejects.toThrow(/artifact|schema|json|unverifiable/i);
}, 30_000);

it("[REQ-38][MANIFEST-CANONICAL-HEAD] issuer and advance reject a noncanonical current manifest even when its parsed values are unchanged", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-18T10:00:00.000Z"));
  const api = await loadStoreApi(); const r = await root(); await initializeManifestRoot(api, r);
  const manifestPath = join(r, "release-manifest.json");
  const manifest = JSON.parse((await readFile(manifestPath)).toString("utf8"));
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await expect(api.issueOperationalAttestationV2({ artifactRoot: r, action: "g12_backup_passed" }))
    .rejects.toThrow(/manifest.*canonical|canonical.*manifest/i);
  await expect(api.advanceReleaseManifestV2(readinessAdvance(r, { sourceManifest: manifest })))
    .rejects.toThrow(/manifest.*canonical|canonical.*manifest/i);
});

it("[REQ-38][ROOT-WRITER-TAKEOVER-CANONICAL-OLD-LEASE] rejects a hash-matching but noncanonical bootstrap or frozen old lease", async () => {
  const api = await loadStoreApi();
  for (const kind of ["bootstrap", "frozen"] as const) {
    const r = await root();
    let lease: Record<string, unknown>;
    if (kind === "bootstrap") {
      const input = materializeInput(r);
      await expect(api.materializeReleaseFreezeV2({ ...input, faultAt: "after_lease" })).rejects.toThrow();
      lease = JSON.parse((await readFile(join(r, "manifest-transition-root.lease.json"))).toString("utf8"));
    } else {
      await api.materializeReleaseFreezeV2(materializeInput(r));
      lease = await writeExpiredRootWriterLease(r);
    }
    const leasePath = join(r, "manifest-transition-root.lease.json");
    const noncanonical = Buffer.from(`${JSON.stringify(lease, null, 2)}\n`, "utf8");
    await writeFile(leasePath, noncanonical);
    const hash = createHash("sha256").update(noncanonical).digest("hex");
    await expect(api.takeoverRootWriterLeaseByHashV2({
      artifactRoot: r,
      expectedOldLeaseSha256: hash,
      evaluatedAt: "2026-07-18T10:02:00.000Z"
    })).rejects.toThrow(/noncanonical|canonical/i);
  }
});

it("[REQ-38][PRODUCTION-RECOVERY-CANONICAL-BINDINGS][SETTLEMENT-REPLAY-SOURCE] binds every recovery evidence hash to its canonical artifact", async () => {
  const api = await loadStoreApi(); const r = await root();
  await api.materializeReleaseFreezeV2(materializeInput(r));
  const freeze = freezeFor(r); const sourceManifestSha256 = "a".repeat(64);
  const attestationSha256 = "b".repeat(64); const issuerSha256 = "c".repeat(64);
  const recoveryLeaseSha256 = "d".repeat(64); const finalRecoveryLeaseSha256 = "e".repeat(64);
  const priorOperationId = "rollout-operation-1";
  const operationId = "recovery-operation-1"; const t0 = "2026-07-18T10:00:00.000Z";
  const t1 = "2026-07-18T10:10:00.000Z";
  const canonicalBytes = (value: unknown) => Buffer.from(`${canonicalReleaseJsonV2(value)}\n`, "utf8");
  const sha = (value: unknown) => createHash("sha256").update(canonicalBytes(value)).digest("hex");
  const save = async (relativePath: string, value: unknown) => {
    const path = join(r, ...relativePath.split("/"));
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, canonicalBytes(value), { flag: "wx" });
    return sha(value);
  };

  const abandoned = {
    version: "production-operation-terminal-abandoned-v2" as const,
    operationKind: "rollout" as const, operationId: priorOperationId,
    candidateSha: freeze.candidateSha, releaseGenerationId: freeze.releaseGenerationId,
    sourceManifestSha256, claimSha256: null, authorityConsumptionSha256: null,
    capability: "cleanup_only" as const, cleanupOnlyTakeoverSha256: "1".repeat(64),
    finalLeaseSha256: "2".repeat(64), finalLeaseEpoch: 2,
    completedStepReceiptSetSha256: sha([]), attemptedExternalEffect: false,
    reason: "authority_expired_after_claim" as const, abandonedAt: t0
  };
  const abandonedSha256 = await save(
    `production-operation-terminal-abandoned-${priorOperationId}.json`, abandoned);
  const cleanup = {
    version: "production-operation-terminal-cleanup-v2" as const,
    operationKind: "rollout" as const, operationId: priorOperationId,
    terminalStateSha256: abandonedSha256, capability: "cleanup_only" as const,
    preparedRemovalSha256: "3".repeat(64), leaseRemovalReceiptSha256: "4".repeat(64),
    removedLeaseSha256: abandoned.finalLeaseSha256, cleanedAt: t0
  };
  const cleanupSha256 = await save(
    `production-operation-terminal-cleanup-${priorOperationId}.json`, cleanup);

  const preclaim = {
    version: "production-authority-preclaim-validation-v2" as const,
    operationKind: "recovery" as const, operationId, candidateSha: freeze.candidateSha,
    releaseGenerationId: freeze.releaseGenerationId, sourceManifestSha256,
    artifactRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
    operationalAttestationSha256: attestationSha256,
    operationalAttestationIssuerReceiptSha256: issuerSha256,
    recoveryFromAbandonedOperationSha256: abandonedSha256,
    commandId: "production_recovery" as const, redactedTemplateSha256: "5".repeat(64),
    originalLeaseSha256: recoveryLeaseSha256, originalLeaseEpoch: 1,
    originalLeaseOwnerProcessIdentitySha256: "6".repeat(64), checkedAt: t0, expiresAt: t1,
    operationDeadlineAt: t1, minimumRequiredValidityMs: 1,
    status: "fresh_compatible_unconsumed" as const
  };
  const preclaimSha256 = await save(`production-authority-preclaim-${operationId}.json`, preclaim);
  const consumption = {
    version: "operational-attestation-consumption-v2" as const,
    operationKind: "recovery" as const, operationId, candidateSha: freeze.candidateSha,
    releaseGenerationId: freeze.releaseGenerationId, sourceManifestSha256,
    artifactRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
    operationalAttestationSha256: attestationSha256,
    operationalAttestationIssuerReceiptSha256: issuerSha256,
    recoveryFromAbandonedOperationSha256: abandonedSha256,
    preclaimValidationSha256: preclaimSha256,
    preclaimLeaseLineageRelativePath: `production-preclaim-lease-lineages/${operationId}/${recoveryLeaseSha256}.json`,
    preclaimLeaseLineageSha256: "7".repeat(64),
    preclaimLeaseLineageCurrentTipSha256: recoveryLeaseSha256,
    commandId: "production_recovery" as const, redactedTemplateSha256: preclaim.redactedTemplateSha256,
    leaseSha256AtConsumption: recoveryLeaseSha256, leaseEpochAtConsumption: 1,
    consumedAt: t0, expiresAt: t1, operationDeadlineAt: t1
  };
  const consumptionBytes = canonicalBytes(consumption); const consumptionSha256 = sha(consumption);
  const claim = {
    version: "production-operation-claim-v2" as const,
    operationKind: "recovery" as const, operationId, candidateSha: freeze.candidateSha,
    releaseGenerationId: freeze.releaseGenerationId, sourceManifestSha256,
    artifactRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
    operationalAttestationSha256: attestationSha256,
    operationalAttestationIssuerReceiptSha256: issuerSha256,
    recoveryFromAbandonedOperationSha256: abandonedSha256,
    authorityConsumption: consumption, authorityConsumptionSha256: consumptionSha256,
    preclaimLeaseLineageRelativePath: consumption.preclaimLeaseLineageRelativePath,
    preclaimLeaseLineageSha256: consumption.preclaimLeaseLineageSha256,
    preclaimLeaseLineageCurrentTipSha256: recoveryLeaseSha256,
    capability: "recovery_only" as const, leaseEpochAtConsumption: 1,
    operationDeadlineAt: t1, claimedAt: t0, claimantPid: 123,
    claimantProcessStartFingerprintSha256: "8".repeat(64)
  };
  const claimBytes = canonicalBytes(claim); const claimSha256 = sha(claim);
  const completedStepReceiptPrefix: never[] = [];
  const prefixSha256 = sha(completedStepReceiptPrefix);
  const recoveryInput = {
    version: "production-recovery-input-v2" as const,
    priorOperationKind: "rollout" as const, priorOperationId,
    priorTerminalAbandonedSha256: abandonedSha256, priorTerminalCleanupSha256: cleanupSha256,
    completedStepReceiptPrefix, completedStepReceiptPrefixSha256: prefixSha256,
    uncertainStepMarker: null, uncertainStepMarkerSha256: null,
    recoveryOperationalAttestationSha256: attestationSha256,
    recoveryProductionLeaseSha256: recoveryLeaseSha256,
    recoveryAuthorityPreclaimSha256: preclaimSha256, recoveryOperationClaimSha256: claimSha256,
    recoveryAuthorityConsumptionSha256: consumptionSha256, verifiedAt: t0
  };
  const recoveryInputSha256 = await save("production-recovery-input-v2.json", recoveryInput);
  const recoverySteps = ["verify_abandoned_cleanup", "verify_completed_prefix",
    "verify_uncertain_step_intent", "validate_failure_derivation_inputs"] as const;
  const completedStepReceipts = [];
  for (const [index, stepId] of recoverySteps.entries()) {
    const sequence = index + 1;
    const receipt = {
      version: "production-orchestration-step-receipt-v2" as const, operationId,
      operationClaimSha256: claimSha256, authorityConsumptionSha256: consumptionSha256,
      operationLeaseSha256: recoveryLeaseSha256, operationLeaseEpoch: 1,
      operationDeadlineAt: t1, inputSha256: "9".repeat(64), outputSha256: "a".repeat(64),
      observedStateSha256: "b".repeat(64), sequence, startedAt: t0, finishedAt: t0,
      recoveredAfterCrash: false as const, verifiedChecks: null, result: "completed" as const,
      capability: "recovery_only" as const, commandId: "production_recovery" as const,
      redactedTemplateSha256: preclaim.redactedTemplateSha256,
      executionKind: "local_validation" as const, stepIntentRelativePath: null,
      stepIntentSha256: null, orchestration: "recovery" as const, stepId
    };
    const relativePath = `production-operation-steps/${operationId}/${sequence}-${stepId}-v2.json`;
    const receiptSha256 = await save(relativePath, receipt);
    completedStepReceipts.push({ relativePath, sha256: receiptSha256, receipt });
  }
  const orchestration = {
    version: "production-orchestration-receipt-v2" as const,
    candidateSha: freeze.candidateSha, releaseGenerationId: freeze.releaseGenerationId,
    sourceManifestSha256, operationId, operationClaimSha256: claimSha256,
    finalOperationLeaseSha256: finalRecoveryLeaseSha256, finalOperationLeaseEpoch: 2,
    operationDeadlineAt: t1, operationLeaseTakeoverChainSha256: "c".repeat(64),
    operationalAttestationConsumptionSha256: consumptionSha256,
    redactedTemplateSha256: preclaim.redactedTemplateSha256, result: "completed" as const,
    orchestration: "recovery" as const, capability: "recovery_only" as const,
    commandId: "production_recovery" as const, recoveryInputSha256,
    recoveryAttemptedExternalEffect: false as const, priorAttemptedExternalEffect: false,
    priorCompletedStepReceiptPrefixSha256: prefixSha256, priorUncertainStepMarkerSha256: null,
    completedStepReceipts
  };
  const orchestrationSha256 = await save("production-recovery-orchestration-receipt-v2.json", orchestration);
  const evidence = {
    version: "production-failure-evidence-v2" as const, candidateSha: freeze.candidateSha,
    releaseFreezeIdentitySha256: freezeShaFor(r), sourceManifestSha256,
    failedExecutionEvidenceSha256: orchestrationSha256, observedAt: t0,
    failedGateId: "G14_PRODUCTION_ROLLOUT" as const,
    evidenceKind: "abandoned_operation_recovery" as const, priorAttemptedExternalEffect: false,
    recoveryAttemptedExternalEffect: false as const, recoveryInputSha256,
    recoveryOrchestrationReceiptSha256: orchestrationSha256,
    priorTerminalAbandonedSha256: abandonedSha256, priorTerminalCleanupSha256: cleanupSha256,
    completedStepReceiptPrefixSha256: prefixSha256, uncertainStepMarkerSha256: null,
    recoveryOperationalAttestationSha256: attestationSha256,
    recoveryProductionLeaseSha256: recoveryLeaseSha256, recoveryAuthorityPreclaimSha256: preclaimSha256,
    recoveryOperationClaimSha256: claimSha256,
    recoveryAuthorityConsumptionSha256: consumptionSha256,
    failureCode: "authority_expired_after_claim" as const
  };
  await save(`production-operation-settlement-${operationId}.json`, {
    version: "production-operation-settlement-v2" as const,
    operationKind: "recovery" as const, operationId,
    candidateSha: freeze.candidateSha, releaseGenerationId: freeze.releaseGenerationId,
    sourceManifestSha256, claimSha256, authorityConsumptionSha256: consumptionSha256,
    finalLeaseSha256: finalRecoveryLeaseSha256, finalLeaseEpoch: 2,
    operationDeadlineAt: t1, terminalEvidenceSha256: sha(evidence),
    authorityRevalidatedAt: t0, deadlineRevalidatedAt: t0, settledAt: t0,
    capability: "recovery_only" as const, result: "failed" as const,
    orchestrationReceiptSha256: orchestrationSha256,
    recoveryAttemptedExternalEffect: false as const, priorAttemptedExternalEffect: false
  });
  const bindingInput = { root: r, freeze, sourceManifestSha256, evidence,
    consumption, consumptionBytes, claim, claimBytes };
  expect(() => api.assertRecoveryFailureArtifactBindingsV2(bindingInput)).not.toThrow();
  expect(() => api.assertRecoveryFailureArtifactBindingsV2({
    ...bindingInput, evidence: { ...evidence, recoveryInputSha256: "f".repeat(64) }
  })).toThrow(/recovery.*binding|canonical/i);
  const recoveryInputPath = join(r, "production-recovery-input-v2.json");
  const recoveryInputBytes = await readFile(recoveryInputPath);
  await writeFile(recoveryInputPath, canonicalBytes({
    ...recoveryInput, priorTerminalCleanupSha256: "f".repeat(64)
  }));
  expect(() => api.assertRecoveryFailureArtifactBindingsV2(bindingInput))
    .toThrow(/recovery.*input|canonical|hash/i);
  await writeFile(recoveryInputPath, recoveryInputBytes);
  const settlementPath = join(r, `production-operation-settlement-${operationId}.json`);
  const settlementBytes = await readFile(settlementPath);
  const settlement = JSON.parse(settlementBytes.toString("utf8"));
  await writeFile(settlementPath, canonicalBytes({ ...settlement, finalLeaseEpoch: 3 }));
  expect(() => api.assertRecoveryFailureArtifactBindingsV2(bindingInput))
    .toThrow(/recovery.*settlement|orchestration.*binding/i);
  await writeFile(settlementPath, settlementBytes);
}, 30_000);
