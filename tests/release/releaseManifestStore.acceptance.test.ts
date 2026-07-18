import { existsSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { canonicalReleaseJsonV2 } from "../../src/release/remediationReleaseManifestV2";
import {
  RELEASE_V2_FREEZE_IDENTITY,
  RELEASE_V2_FREEZE_SHA256,
  COMMAND_TEMPLATE_SHA256,
  buildExecutedReleaseGateV2Fixture,
  buildOperationalAttestationV2Fixture,
  buildReleaseManifestV2Fixture,
  buildTask0BReleaseFreezeEvidence
} from "../fixtures/release/remediationReleaseFixtures";

const roots: string[] = [];
const ownerProcesses: ChildProcess[] = [];
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
    sourceManifest: buildReleaseManifestV2Fixture(),
    transition: { transitionId: "readiness" },
    verifiedGateOutputs: [buildExecutedReleaseGateV2Fixture("G05_TELEGRAM")],
    verifiedTransitionEvidence: { refs: [], actualRollbackOutcome: null },
    ...overrides
  };
}

async function initializeManifestRoot(api: any, artifactRoot: string) {
  await api.materializeReleaseFreezeV2(materializeInput(artifactRoot));
  await api.initializeReleaseManifestV2({
    artifactRoot,
    evaluatedAt: "2026-07-18T10:00:00.000Z",
    verifiedGateOutputs: buildReleaseManifestV2Fixture().gates.filter((gate) => gate.state === "passed")
  });
}

function authorityValue(issued: Record<string, unknown>) {
  const { attestationSha256: _attestationSha256, ...authority } = issued;
  return authority;
}

async function recursiveRelativeFiles(artifactRoot: string): Promise<string[]> {
  return (await readdir(artifactRoot, { recursive: true })).map((value) => String(value).replace(/\\/gu, "/"));
}
async function liveOwnerProcess(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1_000)"], {
    stdio: "ignore", windowsHide: true
  });
  ownerProcesses.push(child);
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  return child;
}

async function stopOwnerProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  if (process.platform === "win32" && child.pid !== undefined) {
    execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
  } else child.kill("SIGKILL");
  await exited;
}
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(ownerProcesses.splice(0).map(stopOwnerProcess));
  await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true })));
});

async function loadStoreApi(): Promise<any> {
  const modulePath: string = "../../src/release/releaseManifestStoreV2";
  try { return await import(/* @vite-ignore */ modulePath); }
  catch (error) { throw new Error("Plan 5 feature missing: manifest v2 store", { cause: error }); }
}

function materializeInput(rootPath: string) {
  const task0BPreflightEvidence = buildTask0BReleaseFreezeEvidence({
    observedAt: "2026-07-18T10:00:00.000Z"
  });
  task0BPreflightEvidence.artifactRoot.rootFingerprintSha256 =
    RELEASE_V2_FREEZE_IDENTITY.artifactRootFingerprintSha256;
  const task0BPath = join(rootPath, "task0b-release-freeze.json");
  if (!existsSync(task0BPath)) writeFileSync(task0BPath,
    `${canonicalReleaseJsonV2(task0BPreflightEvidence)}\n`, { flag: "wx" });
  return {
    artifactRoot: rootPath,
    freezeIdentity: RELEASE_V2_FREEZE_IDENTITY,
    task0BPreflightEvidence,
    producerId: "release_freeze_materialize" as const,
    evaluatedAt: "2026-07-18T10:00:00.000Z",
    owner: { pid: process.pid }
  };
}

async function writeExpiredRootWriterLease(rootPath: string) {
  const lease = {
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
  expect(result.freezeIdentity).toEqual(RELEASE_V2_FREEZE_IDENTITY);
  expect(await readdir(r)).toContain("release-freeze-identity-v2.json");
  await expect(api.materializeReleaseFreezeV2({ ...materializeInput(r), producerId: "captureTask0BPreflight" })).rejects.toThrow();
  await expect(api.materializeReleaseFreezeV2({
    ...materializeInput(r),
    freezeIdentity: { ...RELEASE_V2_FREEZE_IDENTITY, postgresToolIdentitySha256: "f".repeat(64) }
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
});

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
});

it("[REQ-38][RELEASE-FREEZE-CONSUMER-CRASH-REPLAY] accepts the exact verified freeze bundle after prepared-publication takeover recovery", async () => {
  const api = await loadStoreApi();
  const r = await root();
  const owner = await liveOwnerProcess();
  await expect(api.materializeReleaseFreezeV2({
    ...materializeInput(r), owner: { pid: owner.pid! }, faultAt: "after_identity"
  })).rejects.toThrow();
  await stopOwnerProcess(owner);
  const oldHash = createHash("sha256")
    .update(await readFile(join(r, "manifest-transition-root.lease.json"))).digest("hex");
  await api.takeoverRootWriterLeaseByHashV2({
    artifactRoot: r, expectedOldLeaseSha256: oldHash, evaluatedAt: "2026-07-18T10:20:00.000Z"
  });
  await api.materializeReleaseFreezeV2({
    ...materializeInput(r), owner: undefined, evaluatedAt: "2026-07-18T10:20:00.000Z"
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
  const unpreparedOwner = await liveOwnerProcess();
  await expect(api.materializeReleaseFreezeV2({
    ...materializeInput(unpreparedRoot), owner: { pid: unpreparedOwner.pid! }, faultAt: "after_lease"
  })).rejects.toThrow();
  await stopOwnerProcess(unpreparedOwner);
  const unpreparedHash = createHash("sha256").update(await readFile(join(unpreparedRoot, "manifest-transition-root.lease.json"))).digest("hex");
  const abandoned = await api.takeoverRootWriterLeaseByHashV2({ artifactRoot: unpreparedRoot, expectedOldLeaseSha256: unpreparedHash, evaluatedAt: "2026-07-18T10:20:00.000Z" });
  expect(abandoned.sealed).toBe(true);
  await expect(api.materializeReleaseFreezeV2(materializeInput(unpreparedRoot))).rejects.toThrow(/new_root|sealed|abandoned/);
  expect(await readdir(unpreparedRoot)).toContain("bootstrap-root-terminal-abandoned-v2.json");
  expect(await readdir(unpreparedRoot)).not.toContain("release-freeze-identity-v2.json");
  for (const faultAt of ["after_prepare", "after_identity"]) {
    const r = await root();
    const owner = await liveOwnerProcess();
    await expect(api.materializeReleaseFreezeV2({
      ...materializeInput(r), owner: { pid: owner.pid! }, faultAt
    })).rejects.toThrow();
    await stopOwnerProcess(owner);
    const oldHash = createHash("sha256").update(await readFile(join(r, "manifest-transition-root.lease.json"))).digest("hex");
    const takeover = await api.takeoverRootWriterLeaseByHashV2({ artifactRoot: r, expectedOldLeaseSha256: oldHash, evaluatedAt: "2026-07-18T10:20:00.000Z" });
    expect(takeover.sealed).toBe(false);
    const recovered = await api.materializeReleaseFreezeV2({ ...materializeInput(r), owner: undefined, evaluatedAt: "2026-07-18T10:20:00.000Z" });
    expect(recovered.freezeIdentity).toEqual(RELEASE_V2_FREEZE_IDENTITY);
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
    artifactRoot: r, authority: authorityValue(first), evaluatedAt: "2026-07-18T11:01:00.000Z"
  });
  const terminalRelativePath = (await recursiveRelativeFiles(r)).find((name) =>
    name.startsWith(`authority-terminal-receipts/g12_backup_passed/${RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId}/`))!;
  const terminalSha256 = createHash("sha256").update(await readFile(join(r, terminalRelativePath))).digest("hex");
  vi.setSystemTime(new Date("2026-07-18T11:02:00.000Z"));
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
    expiresAt: "2026-07-18T11:00:00.000Z",
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
  expect(resumed.expiresAt).toBe("2026-07-18T11:00:00.000Z");
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
    protectedRootFingerprintSha256: RELEASE_V2_FREEZE_IDENTITY.artifactRootFingerprintSha256,
    candidateSha: RELEASE_V2_FREEZE_IDENTITY.candidateSha,
    releaseGenerationId: RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId,
    releaseFreezeIdentitySha256: RELEASE_V2_FREEZE_SHA256,
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
}, 30_000);

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
    name === `operational-attestations/g12_backup_passed/${RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId}/${issued.attestationSha256}.json`)!;
  const original = await readFile(join(r, authorityRelativePath));
  await api.terminalizeExpiredOperationalAttestationV2({
    artifactRoot: r, authority: authorityValue(issued), evaluatedAt: "2026-07-18T11:01:00.000Z"
  });
  const terminalReceiptRelativePath = (await recursiveRelativeFiles(r)).find((name) =>
    name.startsWith(`authority-terminal-receipts/g12_backup_passed/${RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId}/`))!;
  const terminalReceiptPath = join(r, terminalReceiptRelativePath);
  const terminalReceiptSha256 = createHash("sha256").update(await readFile(terminalReceiptPath)).digest("hex");
  vi.setSystemTime(new Date("2026-07-18T11:02:00.000Z"));
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
    artifactRoot: unissuedRoot, authority, evaluatedAt: "2026-07-18T11:01:00.000Z"
  })).rejects.toThrow();
  await expect(api.terminalizeExpiredOperationalAttestationV2({ artifactRoot: r, authority, evaluatedAt: "2026-07-18T10:00:30.000Z" })).rejects.toThrow();
  const terminal = await api.terminalizeExpiredOperationalAttestationV2({
    artifactRoot: r, authority, evaluatedAt: "2026-07-18T11:01:00.000Z", observedArtifacts: []
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
      releaseGenerationId: RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId,
      candidateSha: RELEASE_V2_FREEZE_IDENTITY.candidateSha
    })}\n`, { flag: "wx" });
    await expect(api.terminalizeExpiredOperationalAttestationV2({
      artifactRoot: conflictRoot, authority: conflictAuthority, evaluatedAt: "2026-07-18T11:01:00.000Z"
    })).rejects.toThrow();
    await rm(conflictPath, { force: true });
  }
}, 60_000);

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
});

it("[REQ-38][MANIFEST-V2-REPLAY] exact replay is byte-identical and conflicting replay fails closed", async () => {
  const api = await loadStoreApi(); const r = await root(); await initializeManifestRoot(api, r); const input = readinessAdvance(r);
  const first = await api.advanceReleaseManifestV2(input); const second = await api.advanceReleaseManifestV2(input); expect(second).toEqual(first);
  await expect(api.advanceReleaseManifestV2({ ...input, transition: { transitionId: "g12_backup_passed" }, verifiedGateOutputs: [buildExecutedReleaseGateV2Fixture("G12_PRODUCTION_BACKUP")] })).rejects.toThrow();
});

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
  const state = await api.recoverReleaseManifestStoreV2({ artifactRoot: r, expectedGenerationId: RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId, evaluatedAt: "2026-07-18T10:05:00.000Z" }); expect(state.generationId).toBe(RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId);
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
    evaluatedAt: "2026-07-18T11:01:00.000Z"
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
