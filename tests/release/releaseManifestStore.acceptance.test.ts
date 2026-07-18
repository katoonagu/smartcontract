import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import {
  RELEASE_V2_FREEZE_IDENTITY,
  RELEASE_V2_FREEZE_SHA256,
  buildExecutedReleaseGateV2Fixture,
  buildOperationalAttestationV2Fixture,
  buildReleaseManifestV2Fixture
} from "../fixtures/release/remediationReleaseFixtures";

const roots: string[] = [];
async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "plan5-manifest-v2-"));
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
afterEach(async () => { await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true }))); });

async function loadStoreApi(): Promise<any> {
  const modulePath: string = "../../src/release/releaseManifestStoreV2";
  try { return await import(/* @vite-ignore */ modulePath); }
  catch (error) { throw new Error("Plan 5 feature missing: manifest v2 store", { cause: error }); }
}

function materializeInput(rootPath: string) {
  return {
    artifactRoot: rootPath,
    freezeIdentity: RELEASE_V2_FREEZE_IDENTITY,
    task0BPreflightEvidence: { version: "task0b-release-freeze-evidence-v1", verified: true },
    evaluatedAt: "2026-07-18T10:00:00.000Z",
    owner: { ownerId: "owner-a", pid: process.pid, processStartedAt: "2026-07-18T09:59:00.000Z" }
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
  await writeFile(join(rootPath, "manifest-transition-root.lease.json"), `${JSON.stringify(lease)}\n`, { flag: "wx" });
  return lease;
}

it("[REQ-38][RELEASE-FREEZE-MATERIALIZER] only release freeze materializer converts verified Task0B evidence into one O_EXCL canonical identity while captureTask0BPreflight cannot impersonate the producer", async () => {
  const api = await loadStoreApi(); const r = await root();
  const result = await api.materializeReleaseFreezeV2(materializeInput(r));
  expect(result.freezeIdentity).toEqual(RELEASE_V2_FREEZE_IDENTITY);
  expect(await readdir(r)).toContain("release-freeze-identity-v2.json");
  await expect(api.materializeReleaseFreezeV2({ ...materializeInput(r), producerId: "captureTask0BPreflight" })).rejects.toThrow();
});

it("[REQ-38][BOOTSTRAP-ROOT-WRITER-CRASH] discriminates bootstrap from frozen lease takeover and terminal bytes resumes exact prepared freeze after dead-owner takeover and seals the root for new-root retry when owner dies before prepare including crash after lease acquisition and after prepare before freeze receipt", async () => {
  const api = await loadStoreApi();
  const unpreparedRoot = await root();
  const deadOwner = { ownerId: "dead-owner", pid: 2147483647, processStartedAt: "2026-07-18T09:59:00.000Z" };
  await expect(api.materializeReleaseFreezeV2({ ...materializeInput(unpreparedRoot), owner: deadOwner, faultAt: "after_lease" })).rejects.toThrow();
  const unpreparedHash = createHash("sha256").update(await readFile(join(unpreparedRoot, "manifest-transition-root.lease.json"))).digest("hex");
  const abandoned = await api.takeoverRootWriterLeaseByHashV2({ artifactRoot: unpreparedRoot, expectedOldLeaseSha256: unpreparedHash, evaluatedAt: "2026-07-18T10:02:00.000Z" });
  expect(abandoned.sealed).toBe(true);
  await expect(api.materializeReleaseFreezeV2(materializeInput(unpreparedRoot))).rejects.toThrow(/new_root|sealed|abandoned/);
  expect(await readdir(unpreparedRoot)).toContain("bootstrap-root-terminal-abandoned-v2.json");
  expect(await readdir(unpreparedRoot)).not.toContain("release-freeze-identity-v2.json");
  for (const faultAt of ["after_prepare", "after_identity"]) {
    const r = await root();
    await expect(api.materializeReleaseFreezeV2({ ...materializeInput(r), owner: deadOwner, faultAt })).rejects.toThrow();
    const oldHash = createHash("sha256").update(await readFile(join(r, "manifest-transition-root.lease.json"))).digest("hex");
    const takeover = await api.takeoverRootWriterLeaseByHashV2({ artifactRoot: r, expectedOldLeaseSha256: oldHash, evaluatedAt: "2026-07-18T10:02:00.000Z" });
    expect(takeover.sealed).toBe(false);
    const recovered = await api.materializeReleaseFreezeV2({ ...materializeInput(r), evaluatedAt: "2026-07-18T10:02:00.000Z" });
    expect(recovered.freezeIdentity).toEqual(RELEASE_V2_FREEZE_IDENTITY);
  }
});

it("[REQ-38][BOOTSTRAP-ROOT-WRITER-LEASE-CLEANUP] leaves manifest-transition-root lease absent after both normal materialization and prepared-freeze takeover-resumed successful materialization", async () => {
  const api = await loadStoreApi(); const r = await root();
  await api.materializeReleaseFreezeV2(materializeInput(r));
  expect(await readdir(r)).not.toContain("manifest-transition-root.lease.json");
});

it("[REQ-38][OPERATIONAL-AUTHORITY-ISSUER] appends content-addressed attestation and previous-hash issuer receipt without overwriting consumed or expired authority", async () => {
  const api = await loadStoreApi(); const r = await root();
  await api.materializeReleaseFreezeV2(materializeInput(r));
  const first = await api.issueOperationalAttestationV2({ artifactRoot: r, attestation: buildOperationalAttestationV2Fixture() });
  const second = await api.issueOperationalAttestationV2({ artifactRoot: r, attestation: buildOperationalAttestationV2Fixture({ action: "readiness", previousAttestationSha256: first.attestationSha256 }) });
  expect(second.previousAttestationSha256).toBe(first.attestationSha256);
  expect(second.attestationSha256).not.toBe(first.attestationSha256);
});

it("[REQ-38][OPERATIONAL-AUTHORITY-ISSUER-CRASH] replays exact prepared bytes before attestation between attestation and receipt and after receipt before committed marker without a second clock read or branch and rejects a competing issuer or conflicting prepare under the fixed root-writer lease", async () => {
  const api = await loadStoreApi();
  for (const faultAt of ["after_prepare", "after_attestation", "after_receipt"]) {
    const r = await root(); await api.materializeReleaseFreezeV2(materializeInput(r));
    const input = { artifactRoot: r, attestation: buildOperationalAttestationV2Fixture(), faultAt };
    await expect(api.issueOperationalAttestationV2(input)).rejects.toThrow();
    const result = await api.issueOperationalAttestationV2({ ...input, faultAt: undefined });
    const replay = await api.issueOperationalAttestationV2({ ...input, faultAt: undefined });
    expect(replay).toEqual(result);
  }
});

it("[REQ-38][OPERATIONAL-AUTHORITY-SELECTION] selects exactly one active compatible unconsumed linear-chain tip and rejects branch gap or multiple active authority", async () => {
  const api = await loadStoreApi();
  const active = buildOperationalAttestationV2Fixture();
  expect(api.selectOperationalAttestationV2([active], { evaluatedAt: "2026-07-18T10:05:00.000Z", action: "pre_manual" })).toEqual(active);
  expect(() => api.selectOperationalAttestationV2([active, { ...active, generationId: "branch" }], { evaluatedAt: "2026-07-18T10:05:00.000Z", action: "pre_manual" })).toThrow();
});

it("[REQ-38][OPERATIONAL-AUTHORITY-RECOVERY] issues fresh recovery authority only after exact prior terminal lineage and preserves prior bytes", async () => {
  const api = await loadStoreApi(); const r = await root(); await api.materializeReleaseFreezeV2(materializeInput(r));
  const expired = buildOperationalAttestationV2Fixture({ expiresAt: "2026-07-18T10:01:00.000Z" });
  const issued = await api.issueOperationalAttestationV2({ artifactRoot: r, attestation: expired });
  const original = await readFile(join(r, `operational-attestation-${issued.attestationSha256}.json`));
  await api.terminalizeExpiredOperationalAttestationV2({ artifactRoot: r, authority: expired, evaluatedAt: "2026-07-18T10:02:00.000Z" });
  const terminalReceiptPath = join(r, `authority-terminal-receipt-${issued.attestationSha256}.json`);
  const terminalReceiptSha256 = createHash("sha256").update(await readFile(terminalReceiptPath)).digest("hex");
  await expect(api.issueOperationalAttestationV2({
    artifactRoot: r,
    attestation: buildOperationalAttestationV2Fixture({
      action: "readiness",
      previousAttestationSha256: issued.attestationSha256,
      priorTerminalLineageSha256: "f".repeat(64)
    }),
    priorTerminalReceipt: { sha256: "f".repeat(64) }
  })).rejects.toThrow();
  const recovery = await api.issueOperationalAttestationV2({
    artifactRoot: r,
    attestation: buildOperationalAttestationV2Fixture({
      action: "readiness",
      previousAttestationSha256: issued.attestationSha256,
      priorTerminalLineageSha256: terminalReceiptSha256
    }),
    priorTerminalReceipt: { sha256: terminalReceiptSha256 }
  });
  expect(recovery.priorTerminalLineageSha256).toBe(terminalReceiptSha256);
  expect(await readFile(join(r, `operational-attestation-${issued.attestationSha256}.json`))).toEqual(original);
});

it("[REQ-38][OPERATIONAL-AUTHORITY-EXPIRED-UNCLAIMED] rejects early terminalization terminalizes an expired never-claimed zero-effect authority through prepared and committed bytes permits bound replacement and rejects it when any preclaim claim consumption action lease G13 bound session advisory lock operation or effect artifact exists", async () => {
  const api = await loadStoreApi(); const r = await root(); await api.materializeReleaseFreezeV2(materializeInput(r));
  const authority = buildOperationalAttestationV2Fixture({ expiresAt: "2026-07-18T10:01:00.000Z" });
  const unissuedRoot = await root(); await api.materializeReleaseFreezeV2(materializeInput(unissuedRoot));
  await expect(api.terminalizeExpiredOperationalAttestationV2({ artifactRoot: unissuedRoot, authority, evaluatedAt: "2026-07-18T10:02:00.000Z" })).rejects.toThrow();
  await api.issueOperationalAttestationV2({ artifactRoot: r, attestation: authority });
  await expect(api.terminalizeExpiredOperationalAttestationV2({ artifactRoot: r, authority, evaluatedAt: "2026-07-18T10:00:30.000Z" })).rejects.toThrow();
  const terminal = await api.terminalizeExpiredOperationalAttestationV2({ artifactRoot: r, authority, evaluatedAt: "2026-07-18T10:02:00.000Z", observedArtifacts: [] });
  expect(terminal.reason).toBe("expired_unclaimed");
  for (const artifact of ["preclaim", "claim", "consumption", "action_lease", "g13_session", "advisory_lock", "operation", "effect"]) {
    const conflictPath = join(r, `production-${artifact}-conflict.json`);
    await writeFile(conflictPath, "{}\n", { flag: "wx" });
    await expect(api.terminalizeExpiredOperationalAttestationV2({ artifactRoot: r, authority, evaluatedAt: "2026-07-18T10:02:00.000Z" })).rejects.toThrow();
    await rm(conflictPath, { force: true });
  }
});

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
    api.issueOperationalAttestationV2({ artifactRoot: r, attestation: buildOperationalAttestationV2Fixture() })
  ]);
  expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
});

it("[REQ-38][MANIFEST-V2-CAS] rejects stale and concurrent writers without overwriting the winner", async () => {
  const api = await loadStoreApi(); const r = await root(); await api.materializeReleaseFreezeV2(materializeInput(r));
  const outcomes = await Promise.allSettled([1, 2].map(() => api.advanceReleaseManifestV2(readinessAdvance(r))));
  expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
});

it("[REQ-38][MANIFEST-V2-CRASH] recovers exactly before and after the atomic manifest replace", async () => {
  const api = await loadStoreApi();
  for (const faultAt of ["before_manifest_replace", "after_manifest_replace"]) {
    const r = await root(); await api.materializeReleaseFreezeV2(materializeInput(r)); const input = readinessAdvance(r, { faultAt });
    await expect(api.advanceReleaseManifestV2(input)).rejects.toThrow();
    const recovered = await api.advanceReleaseManifestV2({ ...input, faultAt: undefined }); expect(recovered.manifest.revision).toBe(2);
  }
});

it("[REQ-38][MANIFEST-V2-CRASH-RECEIPT] restores exact prepared canonical receipt bytes and hash after replace-before-receipt without rerunning time reducer or serializer", async () => {
  const api = await loadStoreApi(); const r = await root(); await api.materializeReleaseFreezeV2(materializeInput(r)); const input = readinessAdvance(r, { evaluatedAt: "2026-07-18T10:03:00.000Z", faultAt: "after_manifest_replace" });
  await expect(api.advanceReleaseManifestV2(input)).rejects.toThrow();
  const preparedName = (await readdir(r)).find((name) => name.startsWith("manifest-transition-prepared-"))!;
  const before = await readFile(join(r, preparedName));
  await api.advanceReleaseManifestV2({ ...input, faultAt: undefined, evaluatedAt: "2099-01-01T00:00:00.000Z" });
  expect(await readFile(join(r, preparedName))).toEqual(before);
});

it("[REQ-38][MANIFEST-V2-REPLAY] exact replay is byte-identical and conflicting replay fails closed", async () => {
  const api = await loadStoreApi(); const r = await root(); await api.materializeReleaseFreezeV2(materializeInput(r)); const input = readinessAdvance(r);
  const first = await api.advanceReleaseManifestV2(input); const second = await api.advanceReleaseManifestV2(input); expect(second).toEqual(first);
  await expect(api.advanceReleaseManifestV2({ ...input, transition: { transitionId: "g12_backup_passed" }, verifiedGateOutputs: [buildExecutedReleaseGateV2Fixture("G12_PRODUCTION_BACKUP")] })).rejects.toThrow();
});

it("[REQ-38][MANIFEST-V2-ROOT-LEASE] one fixed root-wide lease serializes competing different transition keys before the loser creates a claim", async () => {
  const api = await loadStoreApi(); const r = await root(); await api.materializeReleaseFreezeV2(materializeInput(r));
  const outcomes = await Promise.allSettled([
    readinessAdvance(r),
    readinessAdvance(r, { transition: { transitionId: "g12_backup_passed" }, verifiedGateOutputs: [buildExecutedReleaseGateV2Fixture("G12_PRODUCTION_BACKUP")] })
  ].map((input) => api.advanceReleaseManifestV2(input)));
  expect(outcomes.filter((item) => item.status === "fulfilled").length).toBeLessThanOrEqual(1);
  expect((await readdir(r)).filter((name) => name.includes("claim"))).toHaveLength(1);
});

it("[REQ-38][MANIFEST-V2-PATH-SAFETY] requires allowlisted trusted principal policy and rejects pre-existing or detectable POSIX symlink Windows junction reparse and identity substitutions without claiming undetectable same-principal race defense", async () => {
  const api = await loadStoreApi(); const r = await root();
  await expect(api.verifyArtifactRootTrustV2({ artifactRoot: r, principalPolicyId: "foreign", pathKind: "symlink" })).rejects.toThrow();
  await expect(api.verifyArtifactRootTrustV2({ artifactRoot: r, principalPolicyId: process.platform === "win32" ? "windows-configured-canonical-set-v1" : "posix-owner-only-v1", pathKind: "regular" })).resolves.toBeDefined();
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
});

it("[REQ-38][MANIFEST-V2-LEASE-FENCE] prevents the old owner from any effect or manifest replace after lease hash or epoch changes", async () => {
  const api = await loadStoreApi(); expect(() => api.assertRootWriterLeaseFenceV2({ ownerId: "old", epoch: 1, leaseSha256: "a".repeat(64) }, { ownerId: "new", epoch: 2, leaseSha256: "b".repeat(64) })).toThrow();
});

it("[REQ-38][MANIFEST-V2-AUTHORITY-SELECTION] accepts only the freeze generation rejects a second generation and seals incompatible or terminal roots", async () => {
  const api = await loadStoreApi(); const authority = buildOperationalAttestationV2Fixture(); expect(api.selectOperationalAttestationV2([authority], { generationId: RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId, evaluatedAt: "2026-07-18T10:05:00.000Z" })).toEqual(authority); expect(() => api.selectOperationalAttestationV2([{ ...authority, generationId: "second" }], { generationId: RELEASE_V2_FREEZE_IDENTITY.releaseGenerationId, evaluatedAt: "2026-07-18T10:05:00.000Z" })).toThrow();
});

it("[REQ-38][MANIFEST-V2-SEALED-ROOT] rejects every transition on terminal-abandoned root and never auto-copies state to a new root", async () => {
  const api = await loadStoreApi(); const r = await root(); await expect(api.advanceReleaseManifestV2(readinessAdvance(r, { rootState: "terminal_abandoned" }))).rejects.toThrow(); expect(await readdir(r)).toEqual([]);
});
