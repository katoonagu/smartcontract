import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Client } from "pg";
import { describe, expect, it, vi } from "vitest";
import { canonicalReleaseJsonV2 } from "../../src/release/remediationReleaseManifestV2";
import {
  CANDIDATE_SHA,
  COMMAND_TEMPLATE_SHA256,
  PRE_RELEASE_GATE_IDS,
  TASK0B_EXPECTED_PRODUCTION_DATABASE_FINGERPRINT,
  buildExecutedReleaseGateV2Fixture,
  buildReleaseFreezeIdentityV2Fixture,
  buildReleaseManifest,
  buildReleaseManifestV2Fixture,
  buildTask0BReleaseFreezeEvidence,
  cloneFixture
} from "../fixtures/release/remediationReleaseFixtures";
import { PRE_RELEASE_GATE_EVIDENCE_POLICY_V2 } from "../../src/release/releaseGateEvidencePolicy";

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const evaluatedAt = "2026-07-18T09:05:00.000Z";
const execFileAsync = promisify(execFile);
const postgresIt = process.env.REQUIRE_PLAN5_POSTGRES === "1" ? it : it.skip;

async function makeProtectedTempDir(prefix: string): Promise<string> {
  const path = mkdtempSync(join(homedir(), prefix));
  if (process.platform === "win32") {
    const sid = (await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "[Security.Principal.WindowsIdentity]::GetCurrent().User.Value"])).stdout.trim();
    await execFileAsync("icacls.exe", [path, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`,
      "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"]);
  } else chmodSync(path, 0o700);
  return path;
}

async function loadProducer(): Promise<any> {
  const modulePath: string = "../../scripts/createProductionBackupEvidence";
  try {
    return await import(/* @vite-ignore */ modulePath);
  } catch (error) {
    throw new Error("Plan 5 feature missing: controlled G12 production backup producer", { cause: error });
  }
}

function fixture(root: string) {
  const task0b = buildTask0BReleaseFreezeEvidence({ candidateSha: CANDIDATE_SHA });
  const manifest = buildReleaseManifest("ready_for_release");
  const task0bBytes = Buffer.from(`${JSON.stringify(task0b)}\n`, "utf8");
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`, "utf8");
  const authority = {
    version: "production-backup-authority-v1",
    scope: "production_backup",
    source: "operator_protected_one_shot_production_go",
    generationId: "production-backup-generation-0001",
    commandId: "production_backup",
    commandTemplateSha256: COMMAND_TEMPLATE_SHA256.production_backup,
    issuedAt: "2026-07-18T09:04:00.000Z",
    expiresAt: "2026-07-18T09:10:00.000Z",
    candidateSha: CANDIDATE_SHA,
    databaseRole: "production",
    databaseIdentityFingerprintSha256: TASK0B_EXPECTED_PRODUCTION_DATABASE_FINGERPRINT,
    task0bEvidencePath: "task0b-release-freeze.json",
    task0bEvidenceSha256: sha256(task0bBytes),
    releaseManifestPath: "release-manifest.json",
    releaseManifestSha256: sha256(manifestBytes),
    releaseManifestOverall: "ready_for_release",
    artifactRootFingerprintSha256: task0b.artifactRoot.rootFingerprintSha256,
    explicitGo: true
  };
  return { root, task0b, manifest, task0bBytes, manifestBytes, authority };
}

function commandFixture(root: string, generationId = "production-backup-generation-0001") {
  const value = fixture(root);
  const rootKey = process.platform === "win32" ? resolve(root).toLowerCase() : resolve(root);
  value.task0b.artifactRoot.rootFingerprintSha256 = sha256(rootKey);
  value.task0bBytes = Buffer.from(`${JSON.stringify(value.task0b)}\n`, "utf8");
  value.authority = {
    ...value.authority,
    generationId,
    artifactRootFingerprintSha256: value.task0b.artifactRoot.rootFingerprintSha256,
    task0bEvidenceSha256: sha256(value.task0bBytes)
  };
  return value;
}

function verifiedV2AuthorityStub() {
  return {
    authority: {},
    attestationSha256: "a".repeat(64),
    issuerReceiptSha256: "b".repeat(64)
  };
}

function materializeInitialGateEvidence(root: string) {
  const task0bBytes = readFileSync(join(root, "task0b-release-freeze.json"));
  const task0b = JSON.parse(task0bBytes.toString("utf8"));
  const freeze = JSON.parse(readFileSync(join(root, "release-freeze-identity-v2.json"), "utf8"));
  const releaseFreezeIdentitySha256 = sha256(Buffer.from(`${canonicalReleaseJsonV2(freeze)}\n`, "utf8"));
  const trustPolicy = {
    version: "trusted-os-principal-policy-v2",
    policyId: process.platform === "win32" ? "windows-configured-canonical-set-v1" : "posix-owner-only-v1",
    platform: process.platform === "win32" ? "windows" : "posix",
    normalizedTrustedPrincipalSetSha256: "5".repeat(64),
    trustedPrincipalCount: 1,
    candidateSha: CANDIDATE_SHA,
    releaseGenerationId: freeze.releaseGenerationId,
    artifactRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
    releaseFreezeIdentitySha256,
    task0BPreflightEvidenceSha256: sha256(task0bBytes),
    ownerIdentityFingerprintSha256: task0b.artifactRoot.ownerIdentityFingerprintSha256,
    accessControlFingerprintSha256: task0b.artifactRoot.accessControlFingerprintSha256,
    authoritativePolicySource: "task0b_allowlisted_writer_principals_v2",
    observedAt: freeze.createdAt,
    source: "task0b_acl_policy_read_only",
    verified: true
  };
  const trustPolicyBytes = Buffer.from(`${canonicalReleaseJsonV2(trustPolicy)}\n`, "utf8");
  const trustBoundary = {
    version: "artifact-root-trust-boundary-evidence-v1",
    candidateSha: CANDIDATE_SHA,
    releaseGenerationId: freeze.releaseGenerationId,
    artifactRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
    releaseFreezeIdentitySha256,
    task0BPreflightEvidenceSha256: sha256(task0bBytes),
    artifactRootObservationSha256: freeze.artifactRootTrustBoundaryEvidenceSha256,
    trustedOsPrincipalPolicySha256: sha256(trustPolicyBytes),
    ownerIdentityFingerprintSha256: task0b.artifactRoot.ownerIdentityFingerprintSha256,
    accessControlFingerprintSha256: task0b.artifactRoot.accessControlFingerprintSha256,
    accessControlSource: task0b.artifactRoot.accessControlSource,
    outsideRepository: true,
    noSymlink: true,
    restrictiveAccessVerified: true,
    exclusiveWriteVerified: true,
    observedAt: freeze.createdAt,
    source: "task0b_protected_root_acl_read_only",
    verified: true
  };
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
        mkdirSync(resolve(path, ".."), { recursive: true });
        const value = relativePath === "trusted-os-principal-policy-v2.json" ? trustPolicy
          : relativePath === "artifact-root-trust-boundary-evidence-v1.json" ? trustBoundary
          : { version: "gate-evidence-v2", candidateSha: CANDIDATE_SHA,
            gateId: gate.id, kind: policy.requiredKinds[index] ?? policy.allowedKinds[0] };
        writeFileSync(path, `${canonicalReleaseJsonV2(value)}\n`);
      }
      const bytes = readFileSync(path);
      const parsed = JSON.parse(bytes.toString("utf8"));
      gate.evidence.push({ kind: policy.requiredKinds[index] ?? policy.allowedKinds[0], relativePath,
        sha256: sha256(bytes), schemaVersion: parsed.version, candidateSha: CANDIDATE_SHA } as never);
    }
  }
  expect(gates.map((gate) => gate.id)).toEqual(PRE_RELEASE_GATE_IDS.filter((id) => id !== "G05_TELEGRAM"));
  return gates;
}

async function materializeReadinessV2Root(root: string) {
  const store = await import("../../src/release/releaseManifestStoreV2");
  const rootKey = process.platform === "win32" ? resolve(root).toLowerCase() : resolve(root);
  const task0b = buildTask0BReleaseFreezeEvidence({
    observedAt: "2026-07-18T10:00:00.000Z",
    artifactRootFingerprintSha256: sha256(rootKey)
  });
  const freeze = buildReleaseFreezeIdentityV2Fixture(task0b);
  writeFileSync(join(root, "task0b-release-freeze.json"), `${canonicalReleaseJsonV2(task0b)}\n`, { flag: "wx" });
  await store.materializeReleaseFreezeV2({ artifactRoot: root, freezeIdentity: freeze,
    task0BPreflightEvidence: task0b, producerId: "release_freeze_materialize",
    evaluatedAt: "2026-07-18T10:00:00.000Z" });
  const initialized = await store.initializeReleaseManifestV2({ artifactRoot: root,
    evaluatedAt: "2026-07-18T10:00:00.000Z", verifiedGateOutputs: materializeInitialGateEvidence(root) });
  const manualBytes = Buffer.from(`${canonicalReleaseJsonV2({ version: "gate-evidence-v2",
    candidateSha: CANDIDATE_SHA, gateId: "G05_TELEGRAM", kind: "manual_telegram_acceptance" })}\n`);
  writeFileSync(join(root, "manual-telegram-acceptance.json"), manualBytes, { flag: "wx" });
  const manual = { ...buildExecutedReleaseGateV2Fixture("G05_TELEGRAM"), evidence: [{
    kind: "manual_telegram_acceptance", relativePath: "manual-telegram-acceptance.json",
    sha256: sha256(manualBytes), schemaVersion: "gate-evidence-v2", candidateSha: CANDIDATE_SHA
  }] };
  const readiness = await store.advanceReleaseManifestV2({ artifactRoot: root,
    sourceManifest: initialized.manifest, transition: { transitionId: "readiness" },
    verifiedGateOutputs: [manual], verifiedTransitionEvidence: { refs: [], actualRollbackOutcome: null },
    evaluatedAt: "2026-07-18T10:01:00.000Z" });
  const issued = await store.issueOperationalAttestationV2({ artifactRoot: root, action: "g12_backup_passed" });
  return { store, task0b, freeze, readiness, issued };
}

describe("[REQ-38][G12-PRODUCTION-BACKUP]", () => {
  it("rejects a production manifest authority whose committed transition receipt bytes changed", async () => {
    const api = await loadProducer();
    const root = await makeProtectedTempDir("plan5-g12-v2-manifest-authority-");
    try {
      const { task0b, freeze, readiness, issued } = await materializeReadinessV2Root(root);
      const manifestBytes = readFileSync(join(root, "release-manifest.json"));
      const authority = {
        ...fixture(root).authority,
        generationId: freeze.releaseGenerationId,
        issuedAt: issued.issuedAt,
        expiresAt: new Date(Date.parse(issued.issuedAt) + 5 * 60_000).toISOString(),
        candidateSha: freeze.candidateSha,
        databaseIdentityFingerprintSha256: freeze.productionDatabaseIdentityFingerprintSha256,
        task0bEvidenceSha256: sha256(Buffer.from(`${canonicalReleaseJsonV2(task0b)}\n`)),
        releaseManifestSha256: sha256(manifestBytes),
        artifactRootFingerprintSha256: freeze.artifactRootFingerprintSha256
      };
      expect(api.verifyProductionBackupManifestAuthorityV2({
        artifactRoot: root,
        authority,
        evaluatedAt: issued.issuedAt
      })).toMatchObject({ attestationSha256: issued.attestationSha256 });
      const receiptPath = join(root, `manifest-transition-receipt-${readiness.manifest.latestCommittedReceiptSha256}.json`);
      writeFileSync(receiptPath, Buffer.concat([readFileSync(receiptPath), Buffer.from(" ")]));
      expect(() => api.verifyProductionBackupManifestAuthorityV2({
        artifactRoot: root,
        authority,
        evaluatedAt: issued.issuedAt,
        expectedAttestationSha256: issued.attestationSha256
      })).toThrow(/manifest|receipt|canonical|hash/i);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 120_000);

  it("runs command preflight against a materialized semantic V2 readiness root without a V1 manifest fallback", async () => {
    const api = await loadProducer();
    const root = await makeProtectedTempDir("plan5-g12-v2-command-");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-18T10:01:01.000Z"));
    try {
      const { task0b, freeze, issued } = await materializeReadinessV2Root(root);
      const sideEffects: string[] = [];
      await expect(api.runProductionBackupCommand([root], {}, {
        now: () => issued.issuedAt,
        readCurrentTask0BReleaseRevalidation: async () => ({
          frozenBytes: Buffer.from(`${canonicalReleaseJsonV2(task0b)}\n`), freeze
        }),
        currentCandidate: async () => ({ sha: freeze.candidateSha, clean: true }),
        observeProductionDatabase: async () => { sideEffects.push("database"); throw new Error("unexpected_database"); },
        attestProductionPostgresTools: async () => { sideEffects.push("docker"); },
        stdout: () => { sideEffects.push("stdout"); }
      })).rejects.toThrow("production_backup_database_url_missing");
      expect(sideEffects).toEqual([]);
      writeFileSync(join(root, `production-backup-authority-${freeze.releaseGenerationId}.json`), "{}\n", { flag: "wx" });
      await expect(api.runProductionBackupCommand([root], {
        TASK0B_PRODUCTION_DATABASE_URL: "postgresql://release:not-used@127.0.0.1:55999/tron_watch"
      }, {
        now: () => issued.issuedAt,
        readCurrentTask0BReleaseRevalidation: async () => ({
          frozenBytes: Buffer.from(`${canonicalReleaseJsonV2(task0b)}\n`), freeze
        }),
        currentCandidate: async () => ({ sha: freeze.candidateSha, clean: true }),
        observeProductionDatabase: async () => { sideEffects.push("database"); throw new Error("unexpected_database"); }
      })).rejects.toThrow("production_backup_orphan_authority_alias");
      expect(sideEffects).toEqual([]);
      await expect(api.runProductionBackupCommand([
        root, `production-backup-authority-${freeze.releaseGenerationId}.json`
      ], {}, {})).rejects.toThrow("production_backup_arguments_invalid");
    } finally { vi.useRealTimers(); rmSync(root, { recursive: true, force: true }); }
  }, 45_000);

  it("rejects a G12 tip that cannot cover the bounded backup plus settlement margin", async () => {
    const api = await loadProducer();
    const root = await makeProtectedTempDir("plan5-g12-v2-short-authority-");
    try {
      const { task0b, freeze, issued } = await materializeReadinessV2Root(root);
      await expect(api.runProductionBackupCommand([root], {}, {
        now: () => new Date(Date.parse(issued.issuedAt) + 5 * 60_000 + 1).toISOString(),
        readCurrentTask0BReleaseRevalidation: async () => ({
          frozenBytes: Buffer.from(`${canonicalReleaseJsonV2(task0b)}\n`), freeze
        }),
        currentCandidate: async () => ({ sha: freeze.candidateSha, clean: true })
      })).rejects.toThrow("operational_authority_tip_ambiguous");
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 45_000);

  it("requires a fresh Task0B revalidation receipt at G12 action entry", async () => {
    const api = await loadProducer();
    const root = await makeProtectedTempDir("plan5-g12-current-task0b-");
    try {
      const { freeze, issued } = await materializeReadinessV2Root(root);
      const seen: string[] = [];
      await expect(api.runProductionBackupCommand([root], {}, {
        now: () => issued.issuedAt,
        readCurrentTask0BReleaseRevalidation: async (_root: string, evaluated: string) => {
          seen.push(evaluated);
          throw new Error("task0b_revalidation_stale");
        },
        currentCandidate: async () => ({ sha: freeze.candidateSha, clean: true })
      })).rejects.toThrow("task0b_revalidation_stale");
      expect(seen).toEqual([issued.issuedAt]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 45_000);

  it("requires a fresh exact one-shot GO bound to Task0B ready manifest database and protected root", async () => {
    const api = await loadProducer();
    const root = mkdtempSync(join(tmpdir(), "plan5-g12-authority-"));
    try {
      const valid = fixture(root);
      expect(() => api.validateProductionBackupAuthorization({
        ...valid,
        candidateSha: CANDIDATE_SHA,
        observedDatabaseIdentityFingerprintSha256: TASK0B_EXPECTED_PRODUCTION_DATABASE_FINGERPRINT,
        observedArtifactRootFingerprintSha256: valid.task0b.artifactRoot.rootFingerprintSha256,
        evaluatedAt
      })).not.toThrow();

      const invalid: Array<(value: ReturnType<typeof fixture>) => void> = [
        (value) => { value.authority.explicitGo = false as true; },
        (value) => { value.authority.scope = "production_migration"; },
        (value) => { value.authority.source = "operator_guess"; },
        (value) => { value.authority.commandId = "production_migration"; },
        (value) => { value.authority.commandTemplateSha256 = "f".repeat(64); },
        (value) => { value.authority.databaseRole = "staging"; },
        (value) => { value.authority.issuedAt = "2026-07-18T09:06:00.000Z"; },
        (value) => { value.authority.expiresAt = "2026-07-18T10:14:00.001Z"; },
        (value) => { value.authority.expiresAt = "2026-07-18T09:04:59.000Z"; },
        (value) => { value.authority.candidateSha = "f".repeat(40); },
        (value) => { value.authority.task0bEvidenceSha256 = "f".repeat(64); },
        (value) => { value.authority.releaseManifestSha256 = "f".repeat(64); },
        (value) => { value.authority.databaseIdentityFingerprintSha256 = "f".repeat(64); },
        (value) => { value.authority.artifactRootFingerprintSha256 = "f".repeat(64); },
        (value) => { value.manifest.gates.find((gate) => gate.id === "G12_PRODUCTION_BACKUP")!.state = "passed"; value.manifest.overall = "not_ready"; value.manifestBytes = Buffer.from(`${JSON.stringify(value.manifest)}\n`); value.authority.releaseManifestSha256 = sha256(value.manifestBytes); },
        (value) => { value.manifest.gates.find((gate) => gate.id === "G00_BASE")!.state = "failed"; value.manifest.gates.find((gate) => gate.id === "G00_BASE")!.exitCode = 1; value.manifest.overall = "not_ready"; value.manifestBytes = Buffer.from(`${JSON.stringify(value.manifest)}\n`); value.authority.releaseManifestSha256 = sha256(value.manifestBytes); }
      ];
      for (const mutate of invalid) {
        const value = fixture(root);
        mutate(value);
        expect(() => api.validateProductionBackupAuthorization({
          ...value,
          candidateSha: CANDIDATE_SHA,
          observedDatabaseIdentityFingerprintSha256: TASK0B_EXPECTED_PRODUCTION_DATABASE_FINGERPRINT,
          observedArtifactRootFingerprintSha256: value.task0b.artifactRoot.rootFingerprintSha256,
          evaluatedAt
        })).toThrow(/backup|authority|binding|release|Task0B/i);
      }
      const secretAuthority = fixture(root).authority as any;
      secretAuthority.operator = { DATABASE_URL: "postgresql://release:secret@127.0.0.1/tron_watch" };
      expect(() => api.validateProductionBackupAuthority(secretAuthority, evaluatedAt)).toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("builds only the pinned Docker Desktop pg_dump invocation and keeps the password and URL off argv and env", async () => {
    const api = await loadProducer();
    expect(JSON.parse(readFileSync("package.json", "utf8")).scripts["release:production:backup"])
      .toBe("node --import tsx scripts/createProductionBackupEvidence.ts");
    const secret = "not-for-argv-$()-'-%";
    const url = `postgresql://release:${encodeURIComponent(secret)}@127.0.0.1:55998/tron_watch`;
    const invocation = api.buildProductionPgDumpInvocation({
      imageId: `sha256:${"9".repeat(64)}`,
      containerName: "plan5-g12-production-backup-generation-0001",
      databaseUrl: url,
      snapshotId: "00000003-0000001B-1"
    }, { PATH: "safe", BOT_TOKEN: "must-be-stripped", DATABASE_URL: url });
    const serialized = JSON.stringify({ executable: invocation.executable, args: invocation.args, env: invocation.env });
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(url);
    expect(invocation.executable.replace(/\\/g, "/")).toMatch(/Docker\/resources\/bin\/docker\.exe$|\/docker$/);
    expect(invocation.args).toContain("host.docker.internal:host-gateway");
    expect(invocation.args).toContain("--interactive");
    expect(invocation.args).toContain("host.docker.internal");
    expect(invocation.args).toContain("--pull");
    expect(invocation.args).toContain("never");
    expect(invocation.args).not.toContain("host");
    expect(invocation.args).not.toContain("pg_dump");
    expect(invocation.args).toContain("/usr/local/bin/pg_dump");
    expect(invocation.env.BOT_TOKEN).toBeUndefined();
    expect(invocation.env.DATABASE_URL).toBeUndefined();
    expect(invocation.stdin).toEqual(Buffer.from(`${secret}\n`, "utf8"));
    expect(() => api.buildProductionPgDumpInvocation({
      imageId: `sha256:${"9".repeat(64)}`,
      containerName: "plan5-g12-production-backup-generation-0001",
      databaseUrl: "postgresql://release:bad%0Avalue@127.0.0.1:55998/tron_watch",
      snapshotId: "00000003-0000001B-1"
    })).toThrow(/database_url_invalid/);

    const restore = api.buildProductionPgRestoreListInvocation("C:/protected/artifacts", {
      provider: { immutableImageId: `sha256:${"9".repeat(64)}` }
    });
    expect(restore.args).toEqual(expect.arrayContaining(["--network", "none", "--pull", "never"]));
    expect(restore.args.join(" ")).toContain("type=bind,source=C:/protected/artifacts,target=/artifacts,readonly");
    expect(restore.args).not.toContain("bridge");
  });

  it("claims with an exact authority binding, rejects replay/tamper/symlinks, and serializes concurrent claimers", async () => {
    const api = await loadProducer();
    const root = await makeProtectedTempDir("plan5-g12-claim-");
    const authority = fixture(root).authority;
    const authorityBytes = Buffer.from(`${JSON.stringify(authority)}\n`);
    const expected = {
      generationId: authority.generationId,
      authoritySha256: sha256(authorityBytes),
      candidateSha: authority.candidateSha,
      databaseIdentityFingerprintSha256: authority.databaseIdentityFingerprintSha256,
      artifactRootFingerprintSha256: authority.artifactRootFingerprintSha256,
      operationalAttestationSha256: "a".repeat(64),
      operationalAttestationIssuerReceiptSha256: "b".repeat(64),
      expiresAt: authority.expiresAt
    };
    try {
      const results = await Promise.allSettled([
        api.claimProductionBackupAuthority(root, expected, authority.issuedAt),
        api.claimProductionBackupAuthority(root, expected, authority.issuedAt)
      ]);
      expect(results.filter((result: PromiseSettledResult<string>) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result: PromiseSettledResult<string>) => result.status === "rejected")).toHaveLength(1);
      await expect(api.claimProductionBackupAuthority(root, expected, evaluatedAt)).resolves.toBe("resumed");
      const claimName = `production-backup-authority-consumed-${authority.generationId}.json`;
      const claim = JSON.parse(readFileSync(join(root, claimName), "utf8"));
      expect(claim).toMatchObject({
        operationalAttestationSha256: expected.operationalAttestationSha256,
        operationalAttestationIssuerReceiptSha256: expected.operationalAttestationIssuerReceiptSha256
      });
      expect(() => api.validateProductionBackupConsumptionState(claim, expected, evaluatedAt)).not.toThrow();
      expect(() => api.validateProductionBackupConsumptionState(
        claim, { ...expected, authoritySha256: "f".repeat(64) }, evaluatedAt
      )).toThrow(/mismatch/);
      expect(() => api.validateProductionBackupConsumptionState(claim, expected, "2026-07-18T09:10:00.001Z"))
        .toThrow(/expired/);
      expect(() => api.validateProductionBackupConsumptionState(claim, expected, "2026-07-18T09:10:00.001Z", false))
        .toThrow(/expired/);
      const partialDump = Buffer.from("PGDMP-owned-partial");
      const sideEffects: string[] = [];
      await expect(api.executeProductionBackupStateMachine(authority, {
        now: () => "2026-07-18T09:10:00.001Z",
        readCompletedEvidence: async () => null,
        hasClaim: async () => {
          api.validateProductionBackupConsumptionState(claim, expected, "2026-07-18T09:10:00.001Z");
          return true;
        },
        claim: async () => { sideEffects.push("claim"); },
        inspectPartial: async () => ({ dump: true, list: false }),
        dump: async () => { sideEffects.push("dump"); },
        list: async () => { sideEffects.push("list"); },
        attest: async () => { sideEffects.push("attest"); },
        validateOperation: async () => undefined,
        buildEvidence: async () => Buffer.from("evidence"),
        writeEvidence: async () => { sideEffects.push("evidence"); }
      })).rejects.toThrow(/expired/);
      expect(sideEffects).toEqual([]);
      expect(partialDump).toEqual(Buffer.from("PGDMP-owned-partial"));

      rmSync(join(root, claimName));
      const outside = join(tmpdir(), `plan5-g12-claim-outside-${Date.now()}.json`);
      writeFileSync(outside, "{}\n", { flag: "wx" });
      try {
        symlinkSync(outside, join(root, claimName), "file");
        await expect(api.claimProductionBackupAuthority(root, expected, authority.issuedAt)).rejects.toThrow();
      } finally { rmSync(outside, { force: true }); }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("claims before dumping resumes owned partial state and never performs a second dump after valid completion", async () => {
    const api = await loadProducer();
    const root = mkdtempSync(join(tmpdir(), "plan5-g12-state-"));
    const value = fixture(root);
    const calls: string[] = [];
    const files = new Map<string, Buffer>();
    let now = evaluatedAt;
    const dependencies = {
      now: () => now,
      readCompletedEvidence: async () => files.get("production-backup-evidence.json") ?? null,
      claim: async () => { calls.push("claim"); files.set("claim", Buffer.from("claimed")); },
      hasClaim: async () => files.has("claim"),
      acquireOperation: async () => ({ operationId: "d".repeat(32), release: async () => undefined }),
      inspectPartial: async () => ({ dump: files.has("production-backup.dump"), list: files.has("production-backup-restore-list.txt") }),
      validatePartialProgress: async () => undefined,
      dump: async () => { calls.push("dump"); files.set("production-backup.dump", Buffer.from("PGDMP fixture")); },
      recordDumpProgress: async () => undefined,
      list: async () => { calls.push("list"); files.set("production-backup-restore-list.txt", Buffer.from("; archive\n1; TABLE public x\n")); },
      recordListProgress: async () => undefined,
      attest: async () => { calls.push("attest"); },
      validateOperation: async () => undefined,
      buildEvidence: async () => Buffer.from(`${JSON.stringify({ version: "production-backup-evidence-v1", state: "passed" })}\n`),
      writeEvidence: async (bytes: Buffer) => { calls.push("evidence"); files.set("production-backup-evidence.json", bytes); }
    };
    try {
      const first = await api.executeProductionBackupStateMachine(value.authority, dependencies);
      now = "2026-07-18T09:10:00.001Z";
      const second = await api.executeProductionBackupStateMachine(value.authority, dependencies);
      expect(first).toEqual(second);
      expect(calls).toEqual(["claim", "dump", "list", "attest", "evidence", "attest"]);
      expect(calls.filter((call) => call === "dump")).toHaveLength(1);

      files.delete("production-backup-evidence.json");
      files.delete("production-backup-restore-list.txt");
      now = evaluatedAt;
      calls.length = 0;
      await api.executeProductionBackupStateMachine(value.authority, dependencies);
      expect(calls).toEqual(["list", "attest", "evidence"]);

      files.clear();
      files.set("production-backup.dump", Buffer.from("foreign"));
      calls.length = 0;
      await expect(api.executeProductionBackupStateMachine(value.authority, dependencies)).rejects.toThrow(/unconsumed/);
      expect(calls).toEqual([]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("rejects every remaining backup operation when consumed authority reaches expiry", { timeout: 15_000 }, async () => {
    const api = await loadProducer();
    const root = await makeProtectedTempDir("plan5-g12-cross-expiry-");
    const value = fixture(root);
    const authorityBytes = Buffer.from(`${JSON.stringify(value.authority)}\n`);
    const expected = {
      generationId: value.authority.generationId,
      authoritySha256: sha256(authorityBytes),
      candidateSha: value.authority.candidateSha,
      databaseIdentityFingerprintSha256: value.authority.databaseIdentityFingerprintSha256,
      artifactRootFingerprintSha256: value.authority.artifactRootFingerprintSha256,
      expiresAt: value.authority.expiresAt
    };
    let now = "2026-07-18T09:09:59.000Z";
    const calls: string[] = [];
    try {
      await api.claimProductionBackupAuthority(root, expected, now);
      const claim = readFileSync(join(root, `production-backup-authority-consumed-${expected.generationId}.json`));
      const binding = { ...expected, claimSha256: sha256(claim) };
      await expect(api.executeProductionBackupStateMachine(value.authority, {
        now: () => now,
        readCompletedEvidence: async () => null,
        hasClaim: async () => true,
        claim: async () => { calls.push("claim"); },
        acquireOperation: async () => api.acquireProductionBackupOperationLease(root, binding, now, {
          removeContainer: async () => undefined
        }),
        inspectPartial: () => api.inspectProductionBackupPartialState(root),
        validatePartialProgress: () => api.validateProductionBackupProgress(root, binding, now),
        dump: async () => {
          calls.push("dump");
          writeFileSync(join(root, "production-backup.dump"), Buffer.from("PGDMP slow-cross-expiry"), { flag: "wx" });
          now = "2026-07-18T09:10:01.000Z";
        },
        recordDumpProgress: (operationId: string) => api.recordProductionBackupDumpProgress(root, binding, operationId, now),
        list: async () => {
          calls.push("list");
          writeFileSync(join(root, "production-backup-restore-list.txt"), Buffer.from("1; TABLE public slow_probe\n"), { flag: "wx" });
        },
        recordListProgress: (operationId: string) => api.recordProductionBackupListProgress(root, binding, operationId, now),
        attest: async () => { await api.validateProductionBackupProgress(root, binding, now); },
        validateOperation: async () => {
          api.validateProductionBackupConsumptionState(
            JSON.parse(claim.toString("utf8")), expected, now
          );
        },
        buildEvidence: async () => Buffer.from("evidence"),
        writeEvidence: async () => { calls.push("evidence"); }
      })).rejects.toThrow(/expired/);
      expect(calls).toEqual(["dump"]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("rejects an expired exact dump receipt without invoking another backup operation", async () => {
    const api = await loadProducer();
    const root = await makeProtectedTempDir("plan5-g12-expired-resume-");
    const value = fixture(root);
    const authorityBytes = Buffer.from(`${JSON.stringify(value.authority)}\n`);
    const expected = {
      generationId: value.authority.generationId,
      authoritySha256: sha256(authorityBytes),
      candidateSha: value.authority.candidateSha,
      databaseIdentityFingerprintSha256: value.authority.databaseIdentityFingerprintSha256,
      artifactRootFingerprintSha256: value.authority.artifactRootFingerprintSha256,
      expiresAt: value.authority.expiresAt
    };
    const freshAt = "2026-07-18T09:05:00.000Z";
    const expiredAt = "2026-07-18T09:10:01.000Z";
    let dumpCalls = 0;
    try {
      await api.claimProductionBackupAuthority(root, expected, freshAt);
      const claim = readFileSync(join(root, `production-backup-authority-consumed-${expected.generationId}.json`));
      const binding = { ...expected, claimSha256: sha256(claim) };
      const original = await api.acquireProductionBackupOperationLease(root, binding, freshAt, {
        removeContainer: async () => undefined
      });
      writeFileSync(join(root, "production-backup.dump"), Buffer.from("PGDMP owned-before-expiry"), { flag: "wx" });
      await api.recordProductionBackupDumpProgress(root, binding, original.operationId, freshAt);
      await original.release();

      await expect(api.executeProductionBackupStateMachine(value.authority, {
        now: () => expiredAt,
        readCompletedEvidence: async () => null,
        hasClaim: async () => true,
        claim: async () => undefined,
        acquireOperation: async () => api.acquireProductionBackupOperationLease(root, binding, expiredAt, {
          removeContainer: async () => undefined
        }),
        inspectPartial: () => api.inspectProductionBackupPartialState(root),
        validatePartialProgress: () => api.validateProductionBackupProgress(root, binding, expiredAt),
        dump: async () => { dumpCalls += 1; },
        recordDumpProgress: async () => undefined,
        list: async () => {
          writeFileSync(join(root, "production-backup-restore-list.txt"), Buffer.from("1; TABLE public resumed_probe\n"), { flag: "wx" });
        },
        recordListProgress: (operationId: string) => api.recordProductionBackupListProgress(root, binding, operationId, expiredAt),
        attest: async () => { await api.validateProductionBackupProgress(root, binding, expiredAt); },
        validateOperation: async () => undefined,
        buildEvidence: async () => Buffer.from("evidence"),
        writeEvidence: async () => undefined
      })).rejects.toThrow(/expired/);
      expect(dumpCalls).toBe(0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 30_000);

  it("rejects a valid claim followed by foreign custom dump and restore-list bytes without generation progress receipts", async () => {
    const api = await loadProducer();
    const root = await makeProtectedTempDir("plan5-g12-foreign-progress-");
    const value = fixture(root);
    const authorityBytes = Buffer.from(`${JSON.stringify(value.authority)}\n`);
    const expected = {
      generationId: value.authority.generationId,
      authoritySha256: sha256(authorityBytes),
      candidateSha: value.authority.candidateSha,
      databaseIdentityFingerprintSha256: value.authority.databaseIdentityFingerprintSha256,
      artifactRootFingerprintSha256: value.authority.artifactRootFingerprintSha256,
      expiresAt: value.authority.expiresAt
    };
    try {
      await api.claimProductionBackupAuthority(root, expected, value.authority.issuedAt);
      const claimName = `production-backup-authority-consumed-${expected.generationId}.json`;
      const binding = { ...expected, claimSha256: sha256(readFileSync(join(root, claimName))) };
      writeFileSync(join(root, "production-backup.dump"), Buffer.from("PGDMP foreign-but-valid-header"), { flag: "wx" });
      writeFileSync(join(root, "production-backup-restore-list.txt"), Buffer.from("; dbname: tron_watch\n1; TABLE public foreign_probe\n"), { flag: "wx" });
      const before = new Map(readdirSync(root).map((name) => [name, readFileSync(join(root, name))]));
      const calls: string[] = [];
      await expect(api.executeProductionBackupStateMachine(value.authority, {
        now: () => evaluatedAt,
        readCompletedEvidence: async () => null,
        hasClaim: async () => true,
        claim: async () => { calls.push("claim"); },
        acquireOperation: async () => ({ operationId: "a".repeat(32), release: async () => { calls.push("release"); } }),
        inspectPartial: async () => ({ dump: true, list: true }),
        validatePartialProgress: () => api.validateProductionBackupProgress(root, binding, evaluatedAt),
        dump: async () => { calls.push("dump"); },
        recordDumpProgress: async () => { calls.push("dump-progress"); },
        list: async () => { calls.push("list"); },
        recordListProgress: async () => { calls.push("list-progress"); },
        attest: async () => { calls.push("attest"); },
        validateOperation: async () => undefined,
        buildEvidence: async () => Buffer.from("evidence"),
        writeEvidence: async () => { calls.push("evidence"); }
      })).rejects.toThrow(/progress|ownership|receipt/i);
      expect(calls).toEqual([]);
      expect(existsSync(join(root, "production-backup-evidence.json"))).toBe(false);
      for (const [name, bytes] of before) expect(readFileSync(join(root, name))).toEqual(bytes);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("serializes two state machines sharing a consumed claim so exactly one can invoke pg_dump", async () => {
    const api = await loadProducer();
    const value = fixture("C:/protected/plan5-g12-concurrency");
    let held = false;
    let dumpCalls = 0;
    let enterDump!: () => void;
    let finishDump!: () => void;
    const entered = new Promise<void>((resolveEntered) => { enterDump = resolveEntered; });
    const finish = new Promise<void>((resolveFinish) => { finishDump = resolveFinish; });
    const dependencies = () => ({
      now: () => evaluatedAt,
      readCompletedEvidence: async () => null,
      hasClaim: async () => true,
      claim: async () => undefined,
      acquireOperation: async () => {
        if (held) throw new Error("production_backup_operation_concurrent");
        held = true;
        return { operationId: "b".repeat(32), release: async () => { held = false; } };
      },
      inspectPartial: async () => ({ dump: false, list: false }),
      validatePartialProgress: async () => undefined,
      dump: async () => { dumpCalls += 1; enterDump(); await finish; },
      recordDumpProgress: async () => undefined,
      list: async () => undefined,
      recordListProgress: async () => undefined,
      attest: async () => undefined,
      validateOperation: async () => undefined,
      buildEvidence: async () => Buffer.from("evidence"),
      writeEvidence: async () => undefined
    });
    const first = api.executeProductionBackupStateMachine(value.authority, dependencies());
    await entered;
    const second = api.executeProductionBackupStateMachine(value.authority, dependencies());
    const resultsPromise = Promise.allSettled([first, second]);
    await new Promise((resolveNext) => setImmediate(resolveNext));
    finishDump();
    const results = await resultsPromise;
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(dumpCalls).toBe(1);
  });

  it("blocks injected pre/post database identity drift before evidence publication", async () => {
    const api = await loadProducer();
    const value = fixture("C:/protected/plan5-g12-identity-drift");
    const calls: string[] = [];
    await expect(api.executeProductionBackupStateMachine(value.authority, {
      now: () => evaluatedAt,
      readCompletedEvidence: async () => null,
      hasClaim: async () => true,
      claim: async () => undefined,
      acquireOperation: async () => ({ operationId: "c".repeat(32), release: async () => { calls.push("release"); } }),
      inspectPartial: async () => ({ dump: true, list: true }),
      validatePartialProgress: async () => undefined,
      dump: async () => { calls.push("dump"); },
      recordDumpProgress: async () => undefined,
      list: async () => { calls.push("list"); },
      recordListProgress: async () => undefined,
      attest: async () => { calls.push("identity-recheck"); throw new Error("production_backup_database_identity_changed"); },
      validateOperation: async () => undefined,
      buildEvidence: async () => { calls.push("build-evidence"); return Buffer.from("evidence"); },
      writeEvidence: async () => { calls.push("write-evidence"); }
    })).rejects.toThrow(/database_identity_changed/);
    expect(calls).toEqual(["identity-recheck", "release"]);
  });

  it("revalidates the exact operation after attestation and again immediately before evidence publication", async () => {
    const api = await loadProducer();
    const value = fixture("C:/protected/plan5-g12-final-operation-check");
    for (const failure of ["deadline", "replacement"] as const) {
      const calls: string[] = [];
      let operationValid = true;
      let validationCount = 0;
      await expect(api.executeProductionBackupStateMachine(value.authority, {
        now: () => evaluatedAt,
        readCompletedEvidence: async () => null,
        hasClaim: async () => true,
        claim: async () => undefined,
        acquireOperation: async () => ({ operationId: "7".repeat(32), release: async () => { calls.push("release"); } }),
        inspectPartial: async () => ({ dump: true, list: true }),
        validatePartialProgress: async () => undefined,
        dump: async () => undefined,
        recordDumpProgress: async () => undefined,
        list: async () => undefined,
        recordListProgress: async () => undefined,
        attest: async () => {
          calls.push("attest");
          if (failure === "deadline") operationValid = false;
        },
        validateOperation: async () => {
          validationCount += 1;
          calls.push(`validate-${validationCount}`);
          if (!operationValid) throw new Error(`production_backup_operation_${failure}`);
        },
        buildEvidence: async () => {
          calls.push("build");
          if (failure === "replacement") operationValid = false;
          return Buffer.from("evidence");
        },
        writeEvidence: async () => { calls.push("write"); }
      })).rejects.toThrow(new RegExp(`operation_${failure}`));
      expect(calls).toEqual(failure === "deadline"
        ? ["validate-1", "validate-2", "validate-3", "validate-4", "validate-5", "attest", "validate-6", "release"]
        : ["validate-1", "validate-2", "validate-3", "validate-4", "validate-5", "attest", "validate-6", "build", "validate-7", "release"]);
      expect(calls).not.toContain("write");
    }
  });

  it("revalidates exact authority inputs immediately before claim and before the first dump", async () => {
    const api = await loadProducer();
    const value = fixture("C:/protected/plan5-g12-revalidation");
    const beforeClaim: string[] = [];
    await expect(api.executeProductionBackupStateMachine(value.authority, {
      now: () => evaluatedAt,
      readCompletedEvidence: async () => null,
      hasClaim: async () => false,
      inspectPartial: async () => ({ dump: false, list: false }),
      revalidateBeforeClaim: async () => { beforeClaim.push("revalidate"); throw new Error("production_backup_binding_changed"); },
      claim: async () => { beforeClaim.push("claim"); },
      acquireOperation: async () => ({ operationId: "e".repeat(32), release: async () => { beforeClaim.push("release"); } }),
      validatePartialProgress: async () => undefined,
      revalidateBeforeDump: async () => { beforeClaim.push("revalidate-dump"); },
      dump: async () => { beforeClaim.push("dump"); },
      recordDumpProgress: async () => undefined,
      list: async () => undefined,
      recordListProgress: async () => undefined,
      attest: async () => undefined,
      validateOperation: async () => undefined,
      buildEvidence: async () => Buffer.from("evidence"),
      writeEvidence: async () => undefined
    })).rejects.toThrow(/binding_changed/);
    expect(beforeClaim).toEqual(["revalidate"]);

    const beforeDump: string[] = [];
    await expect(api.executeProductionBackupStateMachine(value.authority, {
      now: () => evaluatedAt,
      readCompletedEvidence: async () => null,
      hasClaim: async () => true,
      inspectPartial: async () => ({ dump: false, list: false }),
      revalidateBeforeClaim: async () => { beforeDump.push("revalidate-claim"); },
      claim: async () => { beforeDump.push("claim"); },
      acquireOperation: async () => ({ operationId: "f".repeat(32), release: async () => { beforeDump.push("release"); } }),
      validatePartialProgress: async () => undefined,
      revalidateBeforeDump: async () => { beforeDump.push("revalidate-dump"); throw new Error("production_backup_binding_changed"); },
      dump: async () => { beforeDump.push("dump"); },
      recordDumpProgress: async () => undefined,
      list: async () => undefined,
      recordListProgress: async () => undefined,
      attest: async () => undefined,
      validateOperation: async () => undefined,
      buildEvidence: async () => Buffer.from("evidence"),
      writeEvidence: async () => undefined
    })).rejects.toThrow(/binding_changed/);
    expect(beforeDump).toEqual(["revalidate-dump", "release"]);
  });

  it("validates exact evidence bytes and rejects restore-list encoding, size, and artifact tamper", async () => {
    const api = await loadProducer();
    const root = mkdtempSync(join(tmpdir(), "plan5-g12-evidence-"));
    const value = fixture(root);
    const evidence = {
      version: "production-backup-evidence-v1",
      candidateSha: value.authority.candidateSha,
      gateId: "G12_PRODUCTION_BACKUP",
      commandId: "production_backup",
      redactedTemplateSha256: COMMAND_TEMPLATE_SHA256.production_backup,
      databaseIdentityFingerprintSha256: value.authority.databaseIdentityFingerprintSha256,
      backupFilename: "production-backup.dump",
      backupBytes: 7,
      backupSha256: sha256("PGDMPxx"),
      backupPathFingerprintSha256: "d".repeat(64),
      restoreListFilename: "production-backup-restore-list.txt",
      restoreListBytes: 27,
      restoreListSha256: "e".repeat(64),
      restoreListEntryCount: 1,
      state: "passed"
    };
    try {
      expect(api.validateProductionBackupEvidence(evidence, value.authority)).toEqual(evidence);
      for (const mutation of [
        { backupBytes: 0 }, { backupSha256: "not-a-sha" }, { backupPathFingerprintSha256: "not-a-sha" },
        { restoreListBytes: 0 }, { restoreListSha256: "not-a-sha" }, { restoreListEntryCount: 0 },
        { databaseIdentityFingerprintSha256: "f".repeat(64) }
      ]) expect(() => api.validateProductionBackupEvidence({ ...evidence, ...mutation }, value.authority)).toThrow();
      expect(() => api.normalizeProductionRestoreList(Buffer.from([0xff, 0xfe]))).toThrow(/restore_list_invalid/);
      expect(() => api.normalizeProductionRestoreList(Buffer.alloc(100 * 1024 * 1024 + 1, 0x61))).toThrow(/restore_list_invalid/);
      expect(() => api.validateProductionBackupEvidence({ ...evidence, DATABASE_URL: "secret" }, value.authority)).toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("cleans an exclusive temporary dump after timeout and never publishes a partial archive", async () => {
    const api = await loadProducer();
    const root = mkdtempSync(join(tmpdir(), "plan5-g12-timeout-"));
    try {
      await expect(api.writeProductionDump(root, {
        executable: process.execPath,
        args: ["-e", "process.stdout.write('PGDMP');setInterval(()=>{},1000)"],
        env: { ...process.env },
        stdin: Buffer.alloc(0)
      }, "plan5-g12-production-backup-timeout", 250)).rejects.toThrow(/pg_dump_failed/);
      expect(readdirSync(root)).toEqual([]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 20_000);

  it("terminates pg_dump immediately when the archive write chain rejects", async () => {
    const api = await loadProducer();
    const root = mkdtempSync(join(tmpdir(), "plan5-g12-write-failure-"));
    const startedAt = Date.now();
    try {
      await expect(api.writeProductionDump(root, {
        executable: process.execPath,
        args: ["-e", "process.stdout.write('PGDMP');setInterval(()=>{},1000)"],
        env: { ...process.env },
        stdin: Buffer.alloc(0)
      }, "", 2_000, undefined, {
        writeChunk: async () => { throw new Error("injected archive write failure"); }
      })).rejects.toThrow(/pg_dump_failed/);
      expect(Date.now() - startedAt).toBeLessThan(1_500);
      expect(readdirSync(root)).toEqual([]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 10_000);

  it("does not link evidence when the lease changes after the temp file is durable", async () => {
    const api = await loadProducer();
    const root = mkdtempSync(join(tmpdir(), "plan5-g12-before-link-"));
    const temporaryName = ".production-backup-evidence.before-link.tmp";
    const leasePath = join(root, "production-backup-operation-generation.json");
    const expectedLease = Buffer.from("exact-lease\n");
    try {
      writeFileSync(leasePath, expectedLease, { flag: "wx" });
      await expect(api.writeExclusive(
        root,
        "production-backup-evidence.json",
        Buffer.from("evidence\n"),
        temporaryName,
        async () => {
          expect(existsSync(join(root, temporaryName))).toBe(true);
          writeFileSync(leasePath, Buffer.from("replacement-lease\n"));
          if (!readFileSync(leasePath).equals(expectedLease)) throw new Error("production_backup_operation_lease_changed");
        }
      )).rejects.toThrow(/operation_lease_changed/);
      expect(existsSync(join(root, "production-backup-evidence.json"))).toBe(false);
      expect(existsSync(join(root, temporaryName))).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("command preflight leaves an expired or foreign generation and the release manifest byte-identical with zero side effects", async () => {
    const api = await loadProducer();
    const root = await makeProtectedTempDir("plan5-g12-command-fail-closed-");
    const old = commandFixture(root);
    const oldAuthorityName = `production-backup-authority-${old.authority.generationId}.json`;
    const expected = {
      generationId: old.authority.generationId,
      authoritySha256: sha256(Buffer.from(`${JSON.stringify(old.authority)}\n`)),
      candidateSha: old.authority.candidateSha,
      databaseIdentityFingerprintSha256: old.authority.databaseIdentityFingerprintSha256,
      artifactRootFingerprintSha256: old.authority.artifactRootFingerprintSha256,
      expiresAt: old.authority.expiresAt
    };
    const sideEffects: string[] = [];
    let now = "2026-07-18T09:10:00.001Z";
    const dependencies = {
      now: () => now,
      currentCandidate: async () => ({ sha: CANDIDATE_SHA, clean: true }),
      observeProductionDatabase: async () => { sideEffects.push("database"); throw new Error("must not observe database"); },
      attestProductionPostgresTools: async () => { sideEffects.push("docker"); },
      verifyProductionManifestAuthorityV2: verifiedV2AuthorityStub,
      stdout: (_value: string) => { sideEffects.push("stdout"); }
    };
    try {
      writeFileSync(join(root, "task0b-release-freeze.json"), old.task0bBytes, { flag: "wx" });
      writeFileSync(join(root, "release-manifest.json"), old.manifestBytes, { flag: "wx" });
      writeFileSync(join(root, oldAuthorityName), Buffer.from(`${JSON.stringify(old.authority)}\n`), { flag: "wx" });
      await api.claimProductionBackupAuthority(root, expected, old.authority.issuedAt);
      writeFileSync(join(root, "production-backup.dump"), Buffer.from("PGDMP incomplete-expired-generation"), { flag: "wx" });
      const beforeExpired = new Map(readdirSync(root).map((name) => [name, readFileSync(join(root, name))]));
      await expect(api.runProductionBackupCommand([root, oldAuthorityName], {
        TASK0B_PRODUCTION_DATABASE_URL: "postgresql://release:not-used@127.0.0.1:55998/tron_watch"
      }, dependencies)).rejects.toThrow(/authority_expired/);
      expect(sideEffects).toEqual([]);
      expect(readFileSync(join(root, "release-manifest.json"))).toEqual(old.manifestBytes);
      expect(readdirSync(root).sort()).toEqual([...beforeExpired.keys()].sort());
      for (const [name, bytes] of beforeExpired) expect(readFileSync(join(root, name))).toEqual(bytes);

      const next = commandFixture(root, "production-backup-generation-0002");
      next.authority.issuedAt = "2026-07-18T09:11:00.000Z";
      next.authority.expiresAt = "2026-07-18T09:15:00.000Z";
      const nextAuthorityName = `production-backup-authority-${next.authority.generationId}.json`;
      writeFileSync(join(root, nextAuthorityName), Buffer.from(`${JSON.stringify(next.authority)}\n`), { flag: "wx" });
      const beforeNextGo = new Map(readdirSync(root).map((name) => [name, readFileSync(join(root, name))]));
      now = "2026-07-18T09:12:00.000Z";
      await expect(api.runProductionBackupCommand([root, nextAuthorityName], {
        TASK0B_PRODUCTION_DATABASE_URL: "postgresql://release:not-used@127.0.0.1:55998/tron_watch"
      }, dependencies)).rejects.toThrow(/foreign_generation|recovery_required/);
      expect(sideEffects).toEqual([]);
      expect(readFileSync(join(root, "release-manifest.json"))).toEqual(old.manifestBytes);
      expect(readdirSync(root).sort()).toEqual([...beforeNextGo.keys()].sort());
      for (const [name, bytes] of beforeNextGo) expect(readFileSync(join(root, name))).toEqual(bytes);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("command rereads exact bindings immediately before exclusive claim and first dump", async () => {
    const api = await loadProducer();
    for (const stage of ["claim", "dump"] as const) {
      const root = await makeProtectedTempDir(`plan5-g12-${stage}-revalidation-`);
      const value = commandFixture(root);
      const authorityName = `production-backup-authority-${value.authority.generationId}.json`;
      const authorityBytes = Buffer.from(`${JSON.stringify(value.authority)}\n`);
      const expected = {
        generationId: value.authority.generationId,
        authoritySha256: sha256(authorityBytes),
        operationalAttestationSha256: "a".repeat(64),
        operationalAttestationIssuerReceiptSha256: "b".repeat(64),
        candidateSha: value.authority.candidateSha,
        databaseIdentityFingerprintSha256: value.authority.databaseIdentityFingerprintSha256,
        artifactRootFingerprintSha256: value.authority.artifactRootFingerprintSha256,
        expiresAt: value.authority.expiresAt
      };
      let mutated = false;
      try {
        writeFileSync(join(root, "task0b-release-freeze.json"), value.task0bBytes, { flag: "wx" });
        writeFileSync(join(root, "release-manifest.json"), value.manifestBytes, { flag: "wx" });
        writeFileSync(join(root, authorityName), authorityBytes, { flag: "wx" });
        if (stage === "dump") await api.claimProductionBackupAuthority(root, expected, evaluatedAt);
        const observation = () => ({
          identityFingerprintSha256: value.authority.databaseIdentityFingerprintSha256,
          snapshotId: "00000003-0000001B-1",
          client: { query: async () => undefined, end: async () => undefined }
        });
        await expect(api.runProductionBackupCommand([root, authorityName], {
          TASK0B_PRODUCTION_DATABASE_URL: "postgresql://release:not-used@127.0.0.1:55998/tron_watch"
        }, {
          now: () => evaluatedAt,
          currentCandidate: async () => ({ sha: CANDIDATE_SHA, clean: true }),
          verifyProductionManifestAuthorityV2: verifiedV2AuthorityStub,
          observeProductionDatabase: async () => observation() as any,
          attestProductionPostgresTools: async () => {
            if (mutated) return;
            mutated = true;
            const name = stage === "claim" ? authorityName : "release-manifest.json";
            writeFileSync(join(root, name), Buffer.concat([readFileSync(join(root, name)), Buffer.from(" ")]));
          },
          stdout: () => undefined
        })).rejects.toThrow(/binding_changed/);
        expect(existsSync(join(root, "production-backup.dump"))).toBe(false);
        expect(existsSync(join(root, `production-backup-operation-${value.authority.generationId}.json`))).toBe(false);
        expect(existsSync(join(root, `production-backup-authority-consumed-${value.authority.generationId}.json`)))
          .toBe(true);
      } finally { rmSync(root, { recursive: true, force: true }); }
    }
  });

  it("acquires the exact backup claim and lease before database queries or Docker tool probes", async () => {
    const api = await loadProducer();
    const root = await makeProtectedTempDir("plan5-g12-owned-query-order-");
    const value = commandFixture(root);
    const authorityName = `production-backup-authority-${value.authority.generationId}.json`;
    const claimPath = join(root, `production-backup-authority-consumed-${value.authority.generationId}.json`);
    const leasePath = join(root, `production-backup-operation-${value.authority.generationId}.json`);
    let toolsAttested = false;
    try {
      writeFileSync(join(root, "task0b-release-freeze.json"), value.task0bBytes, { flag: "wx" });
      writeFileSync(join(root, "release-manifest.json"), value.manifestBytes, { flag: "wx" });
      writeFileSync(join(root, authorityName), Buffer.from(`${JSON.stringify(value.authority)}\n`), { flag: "wx" });
      await expect(api.runProductionBackupCommand([root, authorityName], {
        TASK0B_PRODUCTION_DATABASE_URL: "postgresql://release:not-used@127.0.0.1:55998/tron_watch"
      }, {
        now: () => evaluatedAt,
        currentCandidate: async () => ({ sha: CANDIDATE_SHA, clean: true }),
        verifyProductionManifestAuthorityV2: verifiedV2AuthorityStub,
        attestProductionPostgresTools: async () => {
          if (!existsSync(claimPath) || !existsSync(leasePath)) throw new Error("docker_before_backup_ownership");
          toolsAttested = true;
        },
        observeProductionDatabase: async () => {
          if (!existsSync(claimPath) || !existsSync(leasePath)) throw new Error("query_before_backup_ownership");
          if (toolsAttested) throw new Error("stop_after_owned_query");
          return { identityFingerprintSha256: value.authority.databaseIdentityFingerprintSha256,
            client: { query: async () => undefined, end: async () => undefined } } as any;
        },
        stdout: () => undefined
      })).rejects.toThrow("stop_after_owned_query");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("blocks a live completed-evidence lease and settles an exact dead crash lease without deleting receipted finals", async () => {
    const api = await loadProducer();
    const root = await makeProtectedTempDir("plan5-g12-completed-lease-");
    const value = fixture(root);
    const authorityBytes = Buffer.from(`${JSON.stringify(value.authority)}\n`);
    const expected = {
      generationId: value.authority.generationId,
      authoritySha256: sha256(authorityBytes),
      candidateSha: value.authority.candidateSha,
      databaseIdentityFingerprintSha256: value.authority.databaseIdentityFingerprintSha256,
      artifactRootFingerprintSha256: value.authority.artifactRootFingerprintSha256,
      expiresAt: value.authority.expiresAt
    };
    try {
      await api.claimProductionBackupAuthority(root, expected, evaluatedAt);
      const claim = readFileSync(join(root, `production-backup-authority-consumed-${expected.generationId}.json`));
      const binding = { ...expected, claimSha256: sha256(claim) };
      const abandoned = await api.acquireProductionBackupOperationLease(root, binding, evaluatedAt, {
        ownerProcessId: 2_000_000_003,
        removeContainer: async () => undefined
      });
      writeFileSync(join(root, "production-backup.dump"), Buffer.from("PGDMP completed-before-crash"), { flag: "wx" });
      await api.recordProductionBackupDumpProgress(root, binding, abandoned.operationId, evaluatedAt);
      writeFileSync(join(root, "production-backup-restore-list.txt"), Buffer.from("1; TABLE public completed_probe\n"), { flag: "wx" });
      await api.recordProductionBackupListProgress(root, binding, abandoned.operationId, evaluatedAt);
      writeFileSync(join(root, "production-backup-evidence.json"), Buffer.from("completed-evidence\n"), { flag: "wx" });
      const evidenceTemp = `.production-backup-${abandoned.operationId}.evidence.tmp`;
      writeFileSync(join(root, evidenceTemp), Buffer.from("orphan-evidence-temp"), { flag: "wx" });
      const preserved = new Map([
        "production-backup.dump",
        "production-backup-restore-list.txt",
        `production-backup-dump-progress-${expected.generationId}.json`,
        `production-backup-list-progress-${expected.generationId}.json`,
        "production-backup-evidence.json"
      ].map((name) => [name, readFileSync(join(root, name))]));
      const removedContainers: string[] = [];

      await expect(api.settleCompletedProductionBackupOperation(root, binding, evaluatedAt, {
        isProcessAlive: async () => true,
        removeContainer: async (name: string) => { removedContainers.push(name); }
      })).rejects.toThrow(/operation_concurrent/);
      expect(removedContainers).toEqual([]);
      await api.settleCompletedProductionBackupOperation(root, binding, evaluatedAt, {
        isProcessAlive: async () => false,
        removeContainer: async (name: string) => { removedContainers.push(name); }
      });
      expect(removedContainers.sort()).toEqual([
        abandoned.lease.dumpContainerName, abandoned.lease.restoreContainerName
      ].sort());
      expect(existsSync(join(root, `production-backup-operation-${expected.generationId}.json`))).toBe(false);
      expect(existsSync(join(root, evidenceTemp))).toBe(false);
      for (const [name, bytes] of preserved) expect(readFileSync(join(root, name))).toEqual(bytes);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  postgresIt("removes the exact named Docker container immediately on stderr overflow", async () => {
    const api = await loadProducer();
    const containerName = `plan5-g12-stderr-${process.pid}-${Date.now()}`.toLowerCase();
    try {
      await expect(api.runProductionDockerBuffer([
        "run", "--name", containerName, "--rm", "--network", "none", "--pull", "never",
        "--entrypoint", "/bin/sh", "postgres:16-alpine", "-c", "head -c 1100000 /dev/zero >&2; sleep 60"
      ], 64, 60_000, containerName)).rejects.toThrow(/docker_command_failed/);
      const remaining = (await execFileAsync("docker", ["ps", "-a", "--format", "{{.Names}}",
        "--filter", `name=^/${containerName}$`])).stdout.trim();
      expect(remaining).toBe("");
    } finally { await execFileAsync("docker", ["rm", "--force", containerName]).catch(() => undefined); }
  }, 30_000);

  postgresIt("runs the production command end to end and retries completed evidence without a second dump", async () => {
    const api = await loadProducer();
    const root = await makeProtectedTempDir("plan5-g12-real-");
    const suffix = `${process.pid}-${Date.now()}`;
    const serverName = `plan5-g12-source-${suffix}`;
    const password = "plan5-test-$()-'%";
    let client: Client | undefined;
    try {
      await execFileAsync("docker", ["run", "--detach", "--rm", "--name", serverName,
        "-e", `POSTGRES_PASSWORD=${password}`, "-e", "POSTGRES_DB=tron_watch",
        "-p", "127.0.0.1::5432", "postgres:16-alpine"]);
      const portOutput = await execFileAsync("docker", ["port", serverName, "5432/tcp"]);
      const port = Number(portOutput.stdout.trim().split(":").at(-1));
      expect(port).not.toBe(55999);
      const url = `postgresql://postgres:${encodeURIComponent(password)}@127.0.0.1:${port}/tron_watch`;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        client = new Client({ connectionString: url, connectionTimeoutMillis: 500 });
        try { await client.connect(); break; } catch { await client.end().catch(() => undefined); client = undefined; await new Promise((resolve) => setTimeout(resolve, 250)); }
      }
      if (!client) throw new Error("disposable postgres did not start");
      await client.query("create table plan5_backup_probe(id integer primary key, value text not null)");
      await client.query("insert into plan5_backup_probe values (1, 'restorable')");
      await client.end(); client = undefined;

      const image = (await execFileAsync("docker", ["image", "inspect", "postgres:16-alpine", "--format", "{{.Id}}"])).stdout.trim();
      const tool = async (name: "pg_dump" | "pg_restore") => ({
        executableIdentitySha256: (await execFileAsync("docker", ["run", "--rm", "--network", "none", "--pull", "never",
          "--entrypoint", "/usr/bin/sha256sum", image, `/usr/local/bin/${name}`])).stdout.trim().split(/\s+/)[0],
        version: (await execFileAsync("docker", ["run", "--rm", "--network", "none", "--pull", "never",
          "--entrypoint", `/usr/local/bin/${name}`, image, "--version"])).stdout.trim()
      });
      const task0b = fixture(root).task0b;
      const tools = cloneFixture(task0b.postgresTools) as any;
      tools.provider.immutableImageId = image;
      tools.provider.immutableImageIdSha256 = sha256(image);
      Object.assign(tools.pgDump, await tool("pg_dump"));
      Object.assign(tools.pgRestore, await tool("pg_restore"));
      await api.attestProductionPostgresTools(tools);
      await expect(api.attestProductionPostgresTools({
        ...tools, pgRestore: { ...tools.pgRestore, version: `${tools.pgRestore.version}-tampered` }
      })).rejects.toThrow(/tool_changed/);

      const observed = await api.observeProductionDatabase(url);
      const identityFingerprintSha256 = observed.identityFingerprintSha256;
      await observed.client.query("rollback"); await observed.client.end();
      const value = commandFixture(root);
      value.task0b.productionDatabase.approvedIdentityFingerprintSha256 = identityFingerprintSha256;
      value.task0b.postgresTools = tools;
      value.task0bBytes = Buffer.from(`${JSON.stringify(value.task0b)}\n`, "utf8");
      value.authority = {
        ...value.authority,
        databaseIdentityFingerprintSha256: identityFingerprintSha256,
        task0bEvidenceSha256: sha256(value.task0bBytes)
      };
      const authorityName = `production-backup-authority-${value.authority.generationId}.json`;
      writeFileSync(join(root, "task0b-release-freeze.json"), value.task0bBytes, { flag: "wx" });
      writeFileSync(join(root, "release-manifest.json"), value.manifestBytes, { flag: "wx" });
      writeFileSync(join(root, authorityName), Buffer.from(`${JSON.stringify(value.authority)}\n`), { flag: "wx" });
      const output: string[] = [];
      const commandDependencies = {
        now: () => evaluatedAt,
        currentCandidate: async () => ({ sha: CANDIDATE_SHA, clean: true }),
        verifyProductionManifestAuthorityV2: verifiedV2AuthorityStub,
        stdout: (line: string) => { output.push(line); }
      };
      await api.runProductionBackupCommand([root, authorityName], {
        TASK0B_PRODUCTION_DATABASE_URL: url
      }, commandDependencies);
      expect(readFileSync(join(root, "production-backup.dump")).subarray(0, 5).toString("ascii")).toBe("PGDMP");
      expect(readFileSync(join(root, "production-backup-restore-list.txt"), "utf8")).toContain("plan5_backup_probe");
      const evidence = JSON.parse(readFileSync(join(root, "production-backup-evidence.json"), "utf8"));
      expect(evidence.backupBytes).toBe(readFileSync(join(root, "production-backup.dump")).length);
      expect(evidence.restoreListBytes).toBe(readFileSync(join(root, "production-backup-restore-list.txt")).length);
      await api.attestProductionBackupFiles(root, evidence, tools);
      const dumpBeforeRetry = readFileSync(join(root, "production-backup.dump"));
      const authorityBytes = readFileSync(join(root, authorityName));
      const claimName = `production-backup-authority-consumed-${value.authority.generationId}.json`;
      const operationalAuthority = verifiedV2AuthorityStub();
      const binding = {
        generationId: value.authority.generationId,
        authoritySha256: sha256(authorityBytes),
        candidateSha: value.authority.candidateSha,
        databaseIdentityFingerprintSha256: value.authority.databaseIdentityFingerprintSha256,
        artifactRootFingerprintSha256: value.authority.artifactRootFingerprintSha256,
        expiresAt: value.authority.expiresAt,
        operationalAttestationSha256: operationalAuthority.attestationSha256,
        operationalAttestationIssuerReceiptSha256: operationalAuthority.issuerReceiptSha256,
        claimSha256: sha256(readFileSync(join(root, claimName)))
      };
      const abandoned = await api.acquireProductionBackupOperationLease(root, binding, evaluatedAt, {
        ownerProcessId: 2_000_000_004
      });
      const evidenceTemp = `.production-backup-${abandoned.operationId}.evidence.tmp`;
      writeFileSync(join(root, evidenceTemp), Buffer.from("crash-after-evidence"), { flag: "wx" });
      await api.runProductionBackupCommand([root, authorityName], {
        TASK0B_PRODUCTION_DATABASE_URL: url
      }, commandDependencies);
      expect(readFileSync(join(root, "production-backup.dump"))).toEqual(dumpBeforeRetry);
      expect(output.map((line) => JSON.parse(line).status)).toEqual(["passed", "already_completed"]);
      expect(existsSync(join(root, `production-backup-authority-consumed-${value.authority.generationId}.json`))).toBe(true);
      expect(existsSync(join(root, `production-backup-dump-progress-${value.authority.generationId}.json`))).toBe(true);
      expect(existsSync(join(root, `production-backup-list-progress-${value.authority.generationId}.json`))).toBe(true);
      expect(existsSync(join(root, `production-backup-operation-${value.authority.generationId}.json`))).toBe(false);
      expect(existsSync(join(root, evidenceTemp))).toBe(false);
      const listBytes = readFileSync(join(root, "production-backup-restore-list.txt"));
      writeFileSync(join(root, "production-backup-restore-list.txt"), Buffer.concat([listBytes, Buffer.from("; tampered\n")]));
      await expect(api.attestProductionBackupFiles(root, evidence, tools)).rejects.toThrow(/backup_file_unverified/);
      writeFileSync(join(root, "production-backup-restore-list.txt"), listBytes);
      const dumpBytes = readFileSync(join(root, "production-backup.dump"));
      const tamperedDump = Buffer.from(dumpBytes); tamperedDump[tamperedDump.length - 1] ^= 0xff;
      writeFileSync(join(root, "production-backup.dump"), tamperedDump);
      await expect(api.attestProductionBackupFiles(root, evidence, tools)).rejects.toThrow(/backup_file_unverified/);
      writeFileSync(join(root, "production-backup.dump"), dumpBytes);
      expect(readdirSync(root).some((name) => name.endsWith(".tmp"))).toBe(false);
    } finally {
      if (client) await client.end().catch(() => undefined);
      await execFileAsync("docker", ["rm", "--force", serverName]).catch(() => undefined);
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  postgresIt("classifies and cleans only an exact dead same-generation lease, orphan temp, partial files, and Docker container", async () => {
    const api = await loadProducer();
    const root = await makeProtectedTempDir("plan5-g12-orphan-");
    const value = fixture(root);
    const authorityBytes = Buffer.from(`${JSON.stringify(value.authority)}\n`);
    const expected = {
      generationId: value.authority.generationId,
      authoritySha256: sha256(authorityBytes),
      candidateSha: value.authority.candidateSha,
      databaseIdentityFingerprintSha256: value.authority.databaseIdentityFingerprintSha256,
      artifactRootFingerprintSha256: value.authority.artifactRootFingerprintSha256,
      expiresAt: value.authority.expiresAt
    };
    let orphanContainer: string | undefined;
    try {
      await api.claimProductionBackupAuthority(root, expected, value.authority.issuedAt);
      const claimName = `production-backup-authority-consumed-${expected.generationId}.json`;
      const binding = { ...expected, claimSha256: sha256(readFileSync(join(root, claimName))) };
      const abandoned = await api.acquireProductionBackupOperationLease(root, binding, evaluatedAt, {
        ownerProcessId: 2_000_000_001,
        isProcessAlive: async () => true
      });
      const containerName = abandoned.lease.dumpContainerName as string;
      orphanContainer = containerName;
      writeFileSync(join(root, `.production-backup-${abandoned.lease.operationId}.dump.tmp`), Buffer.from("orphan-temp"), { flag: "wx" });
      writeFileSync(join(root, "production-backup.dump"), Buffer.from("PGDMP orphan-unreceipted"), { flag: "wx" });
      writeFileSync(join(root, "production-backup-restore-list.txt"), Buffer.from("1; TABLE public orphan\n"), { flag: "wx" });
      await execFileAsync("docker", ["run", "--detach", "--rm", "--name", containerName,
        "--entrypoint", "/bin/sleep", "postgres:16-alpine", "60"]);

      const recovered = await api.acquireProductionBackupOperationLease(root, binding, evaluatedAt, {
        ownerProcessId: process.pid,
        isProcessAlive: async (processId: number) => processId !== abandoned.lease.ownerProcessId
      });
      expect(existsSync(join(root, `.production-backup-${abandoned.lease.operationId}.dump.tmp`))).toBe(false);
      expect(existsSync(join(root, "production-backup.dump"))).toBe(false);
      expect(existsSync(join(root, "production-backup-restore-list.txt"))).toBe(false);
      const remaining = (await execFileAsync("docker", ["ps", "-a", "--format", "{{.Names}}",
        "--filter", `name=^/${containerName}$`])).stdout.trim();
      expect(remaining).toBe("");
      await recovered.release();
    } finally {
      if (orphanContainer) await execFileAsync("docker", ["rm", "--force", orphanContainer]).catch(() => undefined);
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
