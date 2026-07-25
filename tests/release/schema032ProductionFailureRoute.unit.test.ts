import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock(
  "../../src/release/unifiedReleaseGateReceipt",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import(
        "../../src/release/unifiedReleaseGateReceipt"
      )
    >();
    return {
      ...actual,
      // ponytail: historical G13 tests exercise recovery semantics;
      // pinned signature rejection is covered by the G06 policy tests.
      validateUnifiedAdaptiveRollingReleaseReceiptV1(
        value: unknown,
        context: {
          candidateSha: string;
          releaseGenerationId: string;
        }
      ) {
        const receipt = value as {
          candidateSha?: unknown;
          releaseGenerationId?: unknown;
        };
        if (
          receipt.candidateSha !== context.candidateSha ||
          receipt.releaseGenerationId !==
            context.releaseGenerationId
        ) {
          throw new Error(
            "unified_adaptive_release_identity_invalid"
          );
        }
        return value;
      }
    };
  }
);
import {
  releaseFreezeIdentitySha256V2,
  validateProductionFailureEvidenceV2,
  validateSchema032ProductionExecutionReceiptV3
} from "../../src/release/remediationReleaseManifestV2";
import { canonicalBytesV2 } from "../../src/release/releaseRootWriterStore";
import { PRE_RELEASE_GATE_EVIDENCE_POLICY_V2 } from "../../src/release/releaseGateEvidencePolicy";
import * as store from "../../src/release/releaseManifestStoreV2";
import {
  COMMAND_TEMPLATE_SHA256,
  PRE_RELEASE_GATE_IDS,
  buildExecutedReleaseGateV2Fixture,
  buildReleaseFreezeIdentityV2Fixture,
  buildReleaseManifestV2Fixture,
  buildTask0BReleaseFreezeEvidence,
  buildUnifiedReleaseGateEvidenceFixture
} from "../fixtures/release/remediationReleaseFixtures";
import {
  SCHEMA_032_PRODUCTION_BACKUP_TEMPLATE_SHA256,
  SCHEMA_032_PRODUCTION_MIGRATION_TEMPLATE_SHA256,
  persistSchema032ProductionFailureRouteV3,
  runSchema032ReleaseSequence
} from "../../scripts/runSchema032ReleaseSequence";
import { runTerminalizeExpiredUnclaimedAuthority } from "../../scripts/terminalizeExpiredUnclaimedAuthority";

const dbSessionStarted = vi.hoisted(() => vi.fn());
vi.mock("pg", () => ({
  Client: class {
    constructor() {
      dbSessionStarted();
      throw new Error("schema_032_test_db_session_created");
    }
  }
}));

const sha256 = (value: Buffer | string): string => createHash("sha256").update(value).digest("hex");
const candidateSha = "a".repeat(40);
const digest = (character: string): string => character.repeat(64);
const stages = ["first_migration", "first_verification", "second_migration", "final_verification"] as const;

function historicalSchema034MigrationFiles(): string[] {
  return readdirSync("migrations")
    .filter((name) =>
      name.endsWith(".sql") &&
      Number.parseInt(name.slice(0, 3), 10) <= 34
    )
    .sort();
}

function writeEvidence(root: string, kind: string, relativePath: string, value: Buffer | Record<string, unknown>,
  exactCandidateSha: string, reuseExisting = false) {
  let bytes = Buffer.isBuffer(value) ? value : canonicalBytesV2(value);
  const path = join(root, ...relativePath.split("/"));
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    const existing = readFileSync(path);
    if (reuseExisting) bytes = existing;
    else expect(existing).toEqual(bytes);
  }
  else writeFileSync(path, bytes, { flag: "wx" });
  return {
    ref: {
      kind,
      relativePath,
      sha256: sha256(bytes),
      schemaVersion: Buffer.isBuffer(value) ? "opaque-v1"
        : String((JSON.parse(bytes.toString("utf8")) as { version?: unknown }).version),
      candidateSha: exactCandidateSha
    },
    bytes
  };
}

function materializeInitialGateEvidence(
  root: string,
  exactCandidateSha: string,
  releaseGenerationId: string
) {
  const gates = buildReleaseManifestV2Fixture().gates.filter((gate) => gate.state === "passed");
  const unified = buildUnifiedReleaseGateEvidenceFixture(exactCandidateSha, releaseGenerationId);
  for (const gate of gates) {
    gate.candidateSha = exactCandidateSha;
    const policy = PRE_RELEASE_GATE_EVIDENCE_POLICY_V2[
      gate.id as keyof typeof PRE_RELEASE_GATE_EVIDENCE_POLICY_V2
    ];
    const paths = [...policy.primaryPaths];
    for (const [index, kind] of policy.requiredKinds.entries()) {
      if (index >= paths.length) paths.push(`gates/${gate.id.toLowerCase()}/${kind}.json`);
    }
    gate.evidence = paths.map((relativePath, index) => writeEvidence(root,
      policy.requiredKinds[index] ?? policy.allowedKinds[0]!, relativePath,
      relativePath === "plan-a-gate-receipt-v1.json" ? unified.planA
        : relativePath === "adaptive-rolling-release-gate-receipt-v1.json" ? unified.adaptive
        : relativePath === "unified-wallet-release-gate-receipt-v1.json" ? unified.unified
          : relativePath === "trusted-os-principal-policy-v2.json"
              || relativePath === "artifact-root-trust-boundary-evidence-v1.json"
            ? JSON.parse(readFileSync(join(root, relativePath), "utf8")) as Record<string, unknown>
          : {
              version: "gate-evidence-v2", candidateSha: exactCandidateSha,
              gateId: gate.id, kind: policy.requiredKinds[index] ?? policy.allowedKinds[0]
            },
      exactCandidateSha, true).ref) as never;
  }
  expect(gates.map((gate) => gate.id)).toEqual(PRE_RELEASE_GATE_IDS.filter((id) => id !== "G05_TELEGRAM"));
  return gates;
}

function materializeG00TrustFixtures(
  root: string,
  task0b: ReturnType<typeof buildTask0BReleaseFreezeEvidence>,
  freeze: ReturnType<typeof buildReleaseFreezeIdentityV2Fixture>
): void {
  const platform = process.platform === "win32" ? "windows" : "posix";
  const principals = process.platform === "win32"
    ? [execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "[Security.Principal.WindowsIdentity]::GetCurrent().User.Value"],
    { encoding: "utf8" }).trim(), "S-1-5-18", "S-1-5-32-544"]
    : [String(process.getuid?.() ?? 0)];
  const task0bBytes = canonicalBytesV2(task0b);
  const observedAt = "2026-07-18T10:00:00.000Z";
  const policy = {
    ...store.normalizeTrustedPrincipalPolicyV2({ platform, principals }),
    candidateSha: freeze.candidateSha,
    releaseGenerationId: freeze.releaseGenerationId,
    artifactRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
    releaseFreezeIdentitySha256: releaseFreezeIdentitySha256V2(freeze),
    task0BPreflightEvidenceSha256: sha256(task0bBytes),
    ownerIdentityFingerprintSha256: task0b.artifactRoot.ownerIdentityFingerprintSha256,
    accessControlFingerprintSha256: task0b.artifactRoot.accessControlFingerprintSha256,
    authoritativePolicySource: "task0b_allowlisted_writer_principals_v2",
    observedAt,
    source: "task0b_acl_policy_read_only",
    verified: true
  } as const;
  const policyBytes = canonicalBytesV2(policy);
  const boundary = {
    version: "artifact-root-trust-boundary-evidence-v1",
    candidateSha: freeze.candidateSha,
    releaseGenerationId: freeze.releaseGenerationId,
    artifactRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
    releaseFreezeIdentitySha256: releaseFreezeIdentitySha256V2(freeze),
    task0BPreflightEvidenceSha256: sha256(task0bBytes),
    artifactRootObservationSha256: sha256(canonicalBytesV2(task0b.artifactRoot)),
    trustedOsPrincipalPolicySha256: sha256(policyBytes),
    ownerIdentityFingerprintSha256: task0b.artifactRoot.ownerIdentityFingerprintSha256,
    accessControlFingerprintSha256: task0b.artifactRoot.accessControlFingerprintSha256,
    accessControlSource: task0b.artifactRoot.accessControlSource,
    outsideRepository: task0b.artifactRoot.outsideRepository,
    noSymlink: task0b.artifactRoot.noSymlink,
    restrictiveAccessVerified: task0b.artifactRoot.restrictiveAccessVerified,
    exclusiveWriteVerified: task0b.artifactRoot.exclusiveWriteVerified,
    observedAt,
    source: "task0b_protected_root_acl_read_only",
    verified: true
  } as const;
  writeFileSync(join(root, "trusted-os-principal-policy-v2.json"), policyBytes, { flag: "wx" });
  writeFileSync(join(root, "artifact-root-trust-boundary-evidence-v1.json"), canonicalBytesV2(boundary), {
    flag: "wx"
  });
}

function protectedRoot(): string {
  const root = mkdtempSync(join(homedir(), "plan5-g13-terminal-replay-"));
  if (process.platform === "win32") {
    const sid = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "[Security.Principal.WindowsIdentity]::GetCurrent().User.Value"], { encoding: "utf8" }).trim();
    execFileSync("icacls.exe", [root, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`,
      "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"]);
  } else chmodSync(root, 0o700);
  return root;
}

async function materializeG12Source(root: string, exactCandidateSha: string) {
  const rootKey = process.platform === "win32" ? resolve(root).toLowerCase() : resolve(root);
  const task0b = buildTask0BReleaseFreezeEvidence({
    candidateSha: exactCandidateSha,
    observedAt: "2026-07-18T10:00:00.000Z",
    artifactRootFingerprintSha256: sha256(rootKey)
  });
  const freeze = buildReleaseFreezeIdentityV2Fixture(task0b);
  writeFileSync(join(root, "task0b-release-freeze.json"), canonicalBytesV2(task0b), { flag: "wx" });
  await store.materializeReleaseFreezeV2({ artifactRoot: root, freezeIdentity: freeze,
    task0BPreflightEvidence: task0b, producerId: "release_freeze_materialize",
    evaluatedAt: "2026-07-18T10:00:00.000Z" });
  materializeG00TrustFixtures(root, task0b, freeze);
  const initialized = await store.initializeReleaseManifestV2({ artifactRoot: root,
    evaluatedAt: "2026-07-18T10:00:00.000Z",
    verifiedGateOutputs: materializeInitialGateEvidence(root, exactCandidateSha, freeze.releaseGenerationId) });
  const manual = writeEvidence(root, "manual_telegram_acceptance", "manual-telegram-acceptance.json", {
    version: "gate-evidence-v2", candidateSha: exactCandidateSha,
    gateId: "G05_TELEGRAM", kind: "manual_telegram_acceptance"
  }, exactCandidateSha);
  const manualGate = { ...buildExecutedReleaseGateV2Fixture("G05_TELEGRAM"), candidateSha: exactCandidateSha,
    evidence: [manual.ref] };
  const readiness = await store.advanceReleaseManifestV2({ artifactRoot: root,
    sourceManifest: initialized.manifest, transition: { transitionId: "readiness" },
    verifiedGateOutputs: [manualGate], verifiedTransitionEvidence: { refs: [], actualRollbackOutcome: null },
    evaluatedAt: "2026-07-18T10:01:00.000Z" });

  vi.setSystemTime(new Date("2026-07-18T10:02:00.000Z"));
  await store.issueOperationalAttestationV2({ artifactRoot: root, action: "g12_backup_passed" });
  const readinessBytes = readFileSync(join(root, "release-manifest.json"));
  const readinessSha256 = sha256(readinessBytes);
  const selected = store.selectOperationalAttestationFromStoreV2({ artifactRoot: root,
    action: "g12_backup_passed", expectedSourceManifestSha256: readinessSha256,
    evaluatedAt: "2026-07-18T10:02:00.000Z", minimumRemainingValidityMs: 8 * 60_000 });
  const attestationPath = `operational-attestations/g12_backup_passed/${freeze.releaseGenerationId}/${selected.attestationSha256}.json`;
  const attestation = writeEvidence(root, "operational_attestation", attestationPath,
    selected.authority as unknown as Record<string, unknown>, exactCandidateSha);
  const task0bBytes = readFileSync(join(root, "task0b-release-freeze.json"));
  const backupAuthority = writeEvidence(root, "production_backup_authority",
    `production-backup-authority-${freeze.releaseGenerationId}.json`, {
      version: "production-backup-authority-v1", scope: "production_backup",
      source: "operator_protected_one_shot_production_go", generationId: freeze.releaseGenerationId,
      commandId: "production_backup", commandTemplateSha256: COMMAND_TEMPLATE_SHA256.production_backup,
      issuedAt: "2026-07-18T10:02:00.000Z", expiresAt: "2026-07-18T10:10:00.000Z",
      candidateSha: exactCandidateSha, databaseRole: "production",
      databaseIdentityFingerprintSha256: freeze.productionDatabaseIdentityFingerprintSha256,
      task0bEvidencePath: "task0b-release-freeze.json", task0bEvidenceSha256: sha256(task0bBytes),
      releaseManifestPath: "release-manifest.json", releaseManifestSha256: readinessSha256,
      releaseManifestOverall: "ready_for_release",
      artifactRootFingerprintSha256: freeze.artifactRootFingerprintSha256, explicitGo: true
    }, exactCandidateSha);
  const common = {
    generationId: freeze.releaseGenerationId, authoritySha256: backupAuthority.ref.sha256,
    operationalAttestationSha256: selected.attestationSha256,
    operationalAttestationIssuerReceiptSha256: selected.issuerReceiptSha256,
    candidateSha: exactCandidateSha,
    databaseIdentityFingerprintSha256: freeze.productionDatabaseIdentityFingerprintSha256,
    artifactRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
    expiresAt: "2026-07-18T10:10:00.000Z"
  };
  const consumption = writeEvidence(root, "production_backup_consumption",
    `production-backup-authority-consumed-${freeze.releaseGenerationId}.json`, {
      version: "production-backup-authority-consumption-v1", ...common,
      claimedAt: "2026-07-18T10:02:10.000Z"
    }, exactCandidateSha);
  const dump = writeEvidence(root, "production_backup_dump", "production-backup.dump",
    Buffer.from("PGDMPpayload"), exactCandidateSha);
  const dumpProgress = writeEvidence(root, "production_backup_dump_progress",
    `production-backup-dump-progress-${freeze.releaseGenerationId}.json`, {
      version: "production-backup-dump-progress-v1", ...common, claimSha256: consumption.ref.sha256,
      operationId: "backup-operation-1", recordedAt: "2026-07-18T10:02:20.000Z",
      backupFilename: "production-backup.dump", backupBytes: dump.bytes.length,
      backupSha256: dump.ref.sha256, backupPathFingerprintSha256: digest("3")
    }, exactCandidateSha);
  const list = writeEvidence(root, "production_backup_restore_list", "production-backup-restore-list.txt",
    Buffer.from("TABLE public.wallets\n"), exactCandidateSha);
  const listProgress = writeEvidence(root, "production_backup_list_progress",
    `production-backup-list-progress-${freeze.releaseGenerationId}.json`, {
      version: "production-backup-list-progress-v1", ...common, claimSha256: consumption.ref.sha256,
      operationId: "backup-operation-1", recordedAt: "2026-07-18T10:02:30.000Z",
      dumpProgressSha256: dumpProgress.ref.sha256,
      restoreListFilename: "production-backup-restore-list.txt", restoreListBytes: list.bytes.length,
      restoreListSha256: list.ref.sha256, restoreListEntryCount: 1
    }, exactCandidateSha);
  const backup = writeEvidence(root, "production_backup_evidence", "production-backup-evidence.json", {
    version: "production-backup-evidence-v1", candidateSha: exactCandidateSha,
    gateId: "G12_PRODUCTION_BACKUP", commandId: "production_backup",
    redactedTemplateSha256: SCHEMA_032_PRODUCTION_BACKUP_TEMPLATE_SHA256,
    operationalAttestationSha256: selected.attestationSha256,
    operationalAttestationIssuerReceiptSha256: selected.issuerReceiptSha256,
    databaseIdentityFingerprintSha256: freeze.productionDatabaseIdentityFingerprintSha256,
    backupFilename: "production-backup.dump", backupBytes: dump.bytes.length, backupSha256: dump.ref.sha256,
    backupPathFingerprintSha256: digest("3"), restoreListFilename: "production-backup-restore-list.txt",
    restoreListBytes: list.bytes.length, restoreListSha256: list.ref.sha256, restoreListEntryCount: 1,
    state: "passed"
  }, exactCandidateSha);
  const g12Items = [attestation, backupAuthority, consumption, dumpProgress, listProgress, dump, list, backup];
  const g12Gate = {
    id: "G12_PRODUCTION_BACKUP", candidateSha: exactCandidateSha, state: "passed",
    commandId: "production_backup", redactedTemplateSha256: SCHEMA_032_PRODUCTION_BACKUP_TEMPLATE_SHA256,
    startedAt: "2026-07-18T10:02:00.000Z", finishedAt: "2026-07-18T10:03:00.000Z",
    exitCode: 0, outputSha256: backup.ref.sha256, evidence: g12Items.map((item) => item.ref)
  };
  const g12 = await store.advanceReleaseManifestV2({ artifactRoot: root,
    sourceManifest: readiness.manifest,
    transition: { transitionId: "g12_backup_passed", operationalAttestation: selected.authority },
    verifiedGateOutputs: [g12Gate], verifiedTransitionEvidence: { refs: [], actualRollbackOutcome: null },
    evaluatedAt: "2026-07-18T10:04:00.000Z" });
  vi.setSystemTime(new Date("2026-07-18T10:05:00.000Z"));
  await store.issueOperationalAttestationV2({ artifactRoot: root, action: "g13_migration_passed" });
  const g12Bytes = readFileSync(join(root, "release-manifest.json"));
  const selectedG13 = store.selectOperationalAttestationFromStoreV2({ artifactRoot: root,
    action: "g13_migration_passed", expectedSourceManifestSha256: sha256(g12Bytes),
    evaluatedAt: "2026-07-18T10:05:00.000Z", minimumRemainingValidityMs: 9 * 60_000 });
  return { freeze, task0bBytes, g12, g12Bytes, selectedG13, backup };
}

describe("schema 032 production failure route", () => {
  it("rejects changed migration 033 bytes before opening a database session", async () => {
    dbSessionStarted.mockClear();
    const root = mkdtempSync(join(tmpdir(), "schema033-preflight-"));
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    try {
      const exactCandidateSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      const migrationFiles = historicalSchema034MigrationFiles();
      await expect(runSchema032ReleaseSequence({
        databaseUrlEnvName: "PLAN5_SCHEMA_CLEAN_DATABASE_URL",
        databaseUrl: "postgresql://test:test@127.0.0.1:55998/tron_watch_plan5_clean",
        expectedEndpoint: "127.0.0.1:55998",
        expectedSystemIdentifier: "12345678901234567890",
        artifactRoot: root,
        offline: true,
        candidateSha: exactCandidateSha
      }, {
        observeCandidateRepositoryState: async () => ({
          headSha: exactCandidateSha, status: "", migrationFiles
        }),
        readMigrationBytes: async (filename) => filename.startsWith("033_")
          ? Buffer.from("changed migration 033")
          : readFileSync(join("migrations", filename))
      })).rejects.toThrow("schema_033_sequence_migration_checksum_mismatch");
      expect(dbSessionStarted).not.toHaveBeenCalled();
      expect(readdirSync(root)).toEqual([]);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("terminalizes the exact expired G13 chain tip by transition while holding a database absence guard", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const root = protectedRoot();
    const release = vi.fn(async () => undefined);
    try {
      const exactCandidateSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      const context = await materializeG12Source(root, exactCandidateSha);
      const evaluatedAt = new Date(Date.parse(context.selectedG13.authority.expiresAt)).toISOString();
      const acquireG13AbsenceGuard = vi.fn(async () => ({ release }));
      await expect(runTerminalizeExpiredUnclaimedAuthority([
        `operational-attestations/g13_migration_passed/${context.selectedG13.attestationSha256}.json`, root
      ], { now: () => evaluatedAt, acquireG13AbsenceGuard })).rejects.toThrow(
        "usage: release:authority:terminalize <transition> <protected-artifact-root>"
      );
      expect(acquireG13AbsenceGuard).not.toHaveBeenCalled();
      await expect(runTerminalizeExpiredUnclaimedAuthority([
        "g13_migration_passed", root
      ], { now: () => evaluatedAt, acquireG13AbsenceGuard })).resolves.toMatchObject({
        action: "g13_migration_passed",
        reason: "expired_unclaimed",
        attestationSha256: context.selectedG13.attestationSha256
      });
      expect(acquireG13AbsenceGuard).toHaveBeenCalledTimes(1);
      expect(release).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("rejects a G13 tip that cannot cover the bounded migration plus settlement margin before DB session", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    dbSessionStarted.mockClear();
    const root = protectedRoot();
    try {
      const exactCandidateSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      const context = await materializeG12Source(root, exactCandidateSha);
      vi.setSystemTime(new Date(Date.parse(context.selectedG13.authority.expiresAt) - 25 * 60_000 + 1));
      await expect(runSchema032ReleaseSequence({
        databaseUrlEnvName: "TASK0B_PRODUCTION_DATABASE_URL",
        databaseUrl: "postgresql://test:test@127.0.0.1:55998/tron_watch",
        expectedEndpoint: "127.0.0.1:55998",
        expectedSystemIdentifier: "12345678901234567890",
        artifactRoot: root,
        offline: false,
        candidateSha: exactCandidateSha
      }, {
        observeCandidateRepositoryState: async () => ({
          headSha: exactCandidateSha, status: "",
          migrationFiles: historicalSchema034MigrationFiles()
        }),
        readCurrentTask0BReleaseRevalidation: async () => ({
          frozenBytes: context.task0bBytes, freeze: context.freeze
        } as any)
      })).rejects.toThrow("operational_authority_tip_ambiguous");
      expect(dbSessionStarted).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("rejects a root-only orphan compatibility authority before creating a production DB session", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-18T10:00:00.000Z"));
    dbSessionStarted.mockClear();
    const root = protectedRoot();
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      const exactCandidateSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      const context = await materializeG12Source(root, exactCandidateSha);
      writeFileSync(join(root, `schema032-production-authority-${context.freeze.releaseGenerationId}.json`),
        "{}\n", { flag: "wx" });
      process.env.NODE_ENV = "test";
      await expect(runSchema032ReleaseSequence({
        databaseUrlEnvName: "TASK0B_PRODUCTION_DATABASE_URL",
        databaseUrl: "postgresql://test:test@127.0.0.1:55998/tron_watch",
        expectedEndpoint: "127.0.0.1:55998",
        expectedSystemIdentifier: "12345678901234567890",
        artifactRoot: root,
        offline: false,
        candidateSha: exactCandidateSha
      }, {
        observeCandidateRepositoryState: async () => ({
          headSha: exactCandidateSha, status: "",
          migrationFiles: historicalSchema034MigrationFiles()
        }),
        readCurrentTask0BReleaseRevalidation: async () => ({
          frozenBytes: context.task0bBytes, freeze: context.freeze
        } as any)
      })).rejects.toThrow("schema_032_sequence_production_orphan_authority_alias");
      expect(dbSessionStarted).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      vi.useRealTimers();
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("requires a fresh Task0B revalidation receipt at G13 action entry before a DB session", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-18T10:00:00.000Z"));
    dbSessionStarted.mockClear();
    const root = protectedRoot();
    try {
      const exactCandidateSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      await materializeG12Source(root, exactCandidateSha);
      const seen: string[] = [];
      await expect(runSchema032ReleaseSequence({
        databaseUrlEnvName: "TASK0B_PRODUCTION_DATABASE_URL",
        databaseUrl: "postgresql://test:test@127.0.0.1:55998/tron_watch",
        expectedEndpoint: "127.0.0.1:55998",
        expectedSystemIdentifier: "12345678901234567890",
        artifactRoot: root,
        offline: false,
        candidateSha: exactCandidateSha
      }, {
        observeCandidateRepositoryState: async () => ({
          headSha: exactCandidateSha, status: "",
          migrationFiles: historicalSchema034MigrationFiles()
        }),
        readCurrentTask0BReleaseRevalidation: async (_root, evaluatedAt) => {
          seen.push(String(evaluatedAt));
          throw new Error("task0b_revalidation_stale");
        }
      })).rejects.toThrow("task0b_revalidation_stale");
      expect(seen).toHaveLength(1);
      expect(dbSessionStarted).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  it.each(stages)("persists %s as exact typed G13 failure evidence bound to immutable bytes", async (failedStep) => {
    const root = mkdtempSync(join(tmpdir(), "plan5-g13-failure-route-"));
    try {
      const completedStages = stages.slice(0, stages.indexOf(failedStep))
        .map((step, index) => ({ step, receiptSha256: digest(String(index + 1)) }));
      const input = {
        executionReceipt: {
          version: "schema-032-production-execution-receipt-v3",
          candidateSha,
          releaseFreezeIdentitySha256: digest("b"),
          operationalAttestationSha256: digest("c"),
          authorityConsumptionSha256: digest("d"),
          sourceManifestSha256: digest("e"),
          g12TransitionReceiptSha256: digest("f"),
          productionBackupEvidenceSha256: digest("1"),
          executionAttemptRelativePath: `schema032-production-attempt-schema-migration-generation-0001-${digest("8")}.json`,
          executionAttemptSha256: digest("8"),
          advisoryLockKey: 320032500,
          databaseSessionIdentitySha256: digest("2"),
          lockAcquiredAt: "2026-07-19T10:00:00.000Z",
          lockReleasedAt: "2026-07-19T10:00:01.000Z",
          preparedSettlementRelativePath: `schema032-production-settlement-prepared-${digest("9")}.json`,
          preparedSettlementSha256: digest("9"),
          migrationBytesChecksumSha256: "41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d",
          migration033BytesChecksumSha256: "d04f2aff20370a78862604c92ccbcb6bf7c8b1024f95e03b4af2c8f018e701f7",
          migration034BytesChecksumSha256: "492820d6caade9ee879d73aff6365f911be823258112b39a0f5fbca1d56ec4cb",
          result: "failed_after_attempt",
          failedStep,
          completedStages
        },
        failureCode: "schema_032_migration_command_failed"
      } as const;
      await expect(persistSchema032ProductionFailureRouteV3(root, {
        ...input, faultAt: "after_execution_receipt"
      })).rejects.toThrow("schema_032_test_fault_after_execution_receipt");
      expect(existsSync(join(root, "schema032-production-execution-receipt-v3.json"))).toBe(true);
      expect(existsSync(join(root, "production-failure-evidence-v2.json"))).toBe(false);
      const result = await persistSchema032ProductionFailureRouteV3(root, input);

      const stageFailureBytes = readFileSync(join(root, result.executionReceipt.failureArtifact.relativePath));
      const executionReceiptBytes = readFileSync(join(root, "schema032-production-execution-receipt-v3.json"));
      const failureEvidenceBytes = readFileSync(join(root, "production-failure-evidence-v2.json"));

      expect(result.executionReceipt.failureArtifact.evidenceSha256).toBe(sha256(stageFailureBytes));
      expect(result.failureEvidence.failedExecutionEvidenceSha256).toBe(sha256(executionReceiptBytes));
      expect(JSON.parse(failureEvidenceBytes.toString("utf8"))).toEqual(result.failureEvidence);
      expect(validateSchema032ProductionExecutionReceiptV3(result.executionReceipt)).toEqual(result.executionReceipt);
      expect(validateProductionFailureEvidenceV2(result.failureEvidence)).toMatchObject({
        candidateSha,
        releaseFreezeIdentitySha256: digest("b"),
        sourceManifestSha256: digest("e"),
        failedGateId: "G13_PRODUCTION_MIGRATION",
        evidenceKind: "schema032_execution_receipt",
        attemptedExternalEffect: true,
        failureCode: `${failedStep}_failed`
      });
      expect(stageFailureBytes.toString("utf8")).not.toContain(result.executionReceipt.failureArtifact.evidenceSha256);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resumes the production entrypoint after receipt publication without a new DB session or attempt", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-18T10:00:00.000Z"));
    dbSessionStarted.mockClear();
    const root = protectedRoot();
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      const exactCandidateSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      const context = await materializeG12Source(root, exactCandidateSha);
      const sourceManifestSha256 = sha256(context.g12Bytes);
      const authorityName = `schema032-production-authority-${context.freeze.releaseGenerationId}.json`;
      const authority = {
        version: "schema-032-production-authority-v1", scope: "schema_032_production_migration",
        source: "operator_protected_one_shot_production_go", generationId: context.freeze.releaseGenerationId,
        commandId: "production_migration",
        commandTemplateSha256: SCHEMA_032_PRODUCTION_MIGRATION_TEMPLATE_SHA256,
        issuedAt: context.selectedG13.authority.issuedAt,
        expiresAt: context.selectedG13.authority.expiresAt,
        candidateSha: exactCandidateSha, databaseRole: "production",
        databaseIdentityFingerprintSha256: context.freeze.productionDatabaseIdentityFingerprintSha256,
        task0bEvidenceSha256: sha256(context.task0bBytes), releaseManifestPath: "release-manifest.json",
        releaseManifestSha256: sourceManifestSha256, releaseManifestOverall: "not_ready",
        backupEvidencePath: "production-backup-evidence.json", backupEvidenceSha256: context.backup.ref.sha256,
        explicitGo: true
      };
      const authorityArtifact = writeEvidence(root, "production_migration_authority", authorityName,
        authority, exactCandidateSha);
      const consumptionName = `schema032-production-authority-consumed-${context.freeze.releaseGenerationId}.json`;
      const consumption = writeEvidence(root, "production_migration_consumption", consumptionName, {
        version: "schema-032-production-authority-consumption-v2",
        generationId: context.freeze.releaseGenerationId, authoritySha256: authorityArtifact.ref.sha256,
        operationalAttestationSha256: context.selectedG13.attestationSha256,
        operationalAttestationIssuerReceiptSha256: context.selectedG13.issuerReceiptSha256,
        candidateSha: exactCandidateSha,
        databaseIdentityFingerprintSha256: context.freeze.productionDatabaseIdentityFingerprintSha256,
        claimedAt: "2026-07-18T10:05:30.000Z", resumeExpiresAt: authority.expiresAt
      }, exactCandidateSha);
      const attemptValue = {
        version: "schema-032-production-execution-attempt-v2",
        generationId: context.freeze.releaseGenerationId, candidateSha: exactCandidateSha,
        authorityConsumptionSha256: consumption.ref.sha256, attemptOrdinal: 1, previousAttemptSha256: null,
        advisoryLockKey: 320032500, databaseSessionIdentitySha256: digest("2"),
        lockAcquiredAt: "2026-07-18T10:06:00.000Z"
      };
      const attemptSha256 = sha256(canonicalBytesV2(attemptValue));
      const attemptPath = `schema032-production-attempt-${context.freeze.releaseGenerationId}-${attemptSha256}.json`;
      writeEvidence(root, "production_migration_attempt", attemptPath, attemptValue, exactCandidateSha);
      const lockReleasedAt = "2026-07-18T10:06:01.000Z";
      const stageFailure = {
        version: "schema032-stage-failure-v2", candidateSha: exactCandidateSha,
        failedStep: "first_migration", failureCode: "schema_032_migration_command_failed",
        observedAt: lockReleasedAt
      };
      const failureArtifact = {
        kind: "schema032_stage_failure" as const, failedStep: "first_migration" as const,
        relativePath: "schema032-failures/first-migration-failure-v2.json" as const,
        evidenceSha256: sha256(canonicalBytesV2(stageFailure))
      };
      const receiptCore = {
        version: "schema-032-production-execution-receipt-v3" as const, candidateSha: exactCandidateSha,
        releaseFreezeIdentitySha256: releaseFreezeIdentitySha256V2(context.freeze),
        operationalAttestationSha256: context.selectedG13.attestationSha256,
        operationalAttestationIssuerReceiptSha256: context.selectedG13.issuerReceiptSha256,
        authorityConsumptionSha256: consumption.ref.sha256, sourceManifestSha256,
        g12TransitionReceiptSha256: context.g12.manifest.latestCommittedReceiptSha256,
        productionBackupEvidenceSha256: context.backup.ref.sha256,
        executionAttemptRelativePath: attemptPath, executionAttemptSha256: attemptSha256,
        advisoryLockKey: 320032500 as const, databaseSessionIdentitySha256: digest("2"),
        lockAcquiredAt: attemptValue.lockAcquiredAt,
        migrationBytesChecksumSha256: "41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d",
        migration033BytesChecksumSha256: "d04f2aff20370a78862604c92ccbcb6bf7c8b1024f95e03b4af2c8f018e701f7",
        migration034BytesChecksumSha256: "492820d6caade9ee879d73aff6365f911be823258112b39a0f5fbca1d56ec4cb",
        result: "failed_after_attempt" as const, failedStep: "first_migration" as const,
        completedStages: [] as [], failureArtifact
      };
      const preparedValue = {
        version: "prepared-schema-032-production-settlement-v3",
        preparedAt: "2026-07-18T10:06:00.500Z", executionReceiptCore: receiptCore
      };
      const preparedSha256 = sha256(canonicalBytesV2(preparedValue));
      const preparedPath = `schema032-production-settlement-prepared-${preparedSha256}.json`;
      writeEvidence(root, "production_migration_prepared_settlement", preparedPath,
        preparedValue, exactCandidateSha);
      const { failureArtifact: _preparedFailureArtifact, ...failureInputCore } = receiptCore;
      await expect(persistSchema032ProductionFailureRouteV3(root, {
        executionReceipt: {
          ...failureInputCore, lockReleasedAt,
          preparedSettlementRelativePath: preparedPath, preparedSettlementSha256: preparedSha256
        },
        failureCode: stageFailure.failureCode,
        faultAt: "after_execution_receipt"
      })).rejects.toThrow("schema_032_test_fault_after_execution_receipt");
      expect(existsSync(join(root, "production-failure-evidence-v2.json"))).toBe(false);
      const receiptPath = join(root, "schema032-production-execution-receipt-v3.json");
      const originalReceiptBytes = readFileSync(receiptPath);
      const attemptCount = readdirSync(root).filter((name) => name.startsWith("schema032-production-attempt-")).length;
      process.env.NODE_ENV = "test";
      const options = {
        databaseUrlEnvName: "TASK0B_PRODUCTION_DATABASE_URL",
        databaseUrl: "postgresql://test:test@127.0.0.1:55998/tron_watch",
        expectedEndpoint: "127.0.0.1:55998",
        expectedSystemIdentifier: "12345678901234567890",
        artifactRoot: root,
        offline: false,
        candidateSha: exactCandidateSha
      };
      const testDependencies = {
        observeCandidateRepositoryState: async () => ({
          headSha: exactCandidateSha, status: "",
          migrationFiles: historicalSchema034MigrationFiles()
        }),
        readCurrentTask0BReleaseRevalidation: async () => ({
          frozenBytes: context.task0bBytes, freeze: context.freeze
        } as any)
      };
      await expect(runSchema032ReleaseSequence(options, testDependencies))
        .rejects.toThrow(stageFailure.failureCode);
      expect(dbSessionStarted).not.toHaveBeenCalled();
      expect(readFileSync(receiptPath)).toEqual(originalReceiptBytes);
      expect(readdirSync(root).filter((name) => name.startsWith("schema032-production-attempt-")).length)
        .toBe(attemptCount);
      const failurePath = join(root, "production-failure-evidence-v2.json");
      const exactFailure = validateProductionFailureEvidenceV2(JSON.parse(readFileSync(failurePath, "utf8")));
      writeFileSync(failurePath, canonicalBytesV2({ ...exactFailure, failureCode: "first_migration_conflict" }));
      await expect(runSchema032ReleaseSequence(options, testDependencies))
        .rejects.toThrow("schema_032_sequence_production_failure_replay_conflict");
      expect(dbSessionStarted).not.toHaveBeenCalled();
      expect(readFileSync(receiptPath)).toEqual(originalReceiptBytes);
      expect(readdirSync(root).filter((name) => name.startsWith("schema032-production-attempt-")).length)
        .toBe(attemptCount);
      rmSync(failurePath, { force: true });
      const staleStageFailure = { ...stageFailure, observedAt: "2026-07-18T10:05:59.999Z" };
      writeFileSync(join(root, failureArtifact.relativePath), canonicalBytesV2(staleStageFailure));
      const staleFailureArtifact = {
        ...failureArtifact,
        evidenceSha256: sha256(canonicalBytesV2(staleStageFailure))
      };
      const staleReceiptCore = { ...receiptCore, failureArtifact: staleFailureArtifact };
      const stalePrepared = {
        ...preparedValue,
        executionReceiptCore: staleReceiptCore
      };
      const stalePreparedSha256 = sha256(canonicalBytesV2(stalePrepared));
      const stalePreparedPath = `schema032-production-settlement-prepared-${stalePreparedSha256}.json`;
      writeEvidence(root, "production_migration_prepared_settlement", stalePreparedPath,
        stalePrepared, exactCandidateSha);
      writeFileSync(receiptPath, canonicalBytesV2({
        ...staleReceiptCore,
        lockReleasedAt,
        preparedSettlementRelativePath: stalePreparedPath,
        preparedSettlementSha256: stalePreparedSha256
      }));
      await expect(runSchema032ReleaseSequence(options, testDependencies))
        .rejects.toThrow("schema_032_sequence_stage_failure_invalid");
      expect(dbSessionStarted).not.toHaveBeenCalled();
      expect(readdirSync(root).filter((name) => name.startsWith("schema032-production-attempt-")).length)
        .toBe(attemptCount);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      vi.useRealTimers();
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});
