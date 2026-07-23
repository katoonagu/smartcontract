import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAdvanceRemediationReleaseManifest } from "../../scripts/advanceRemediationReleaseManifest";
import * as releaseEvidenceProducer from "../../scripts/advanceRemediationReleaseManifest";
import {
  deriveReleaseFreezeIdentityV2,
  materializeReleaseFreezeV2
} from "../../src/release/releaseManifestStoreV2";
import { canonicalBytesV2 } from "../../src/release/releaseRootWriterStore";
import type { Task0BReleaseFreezeEvidenceV1 } from "../../src/release/remediationReleaseManifest";
import {
  releaseFreezeIdentitySha256V2,
  validateRemediationReleaseManifestV2
} from "../../src/release/remediationReleaseManifestV2";
import {
  COMMAND_TEMPLATE_SHA256,
  GATE_COMMAND_IDS,
  PRE_RELEASE_GATE_IDS,
  buildSchema032ReleaseEvidence,
  buildTask0BReleaseFreezeEvidence
} from "../fixtures/release/remediationReleaseFixtures";
import { PRE_RELEASE_GATE_EVIDENCE_POLICY_V2 } from "../../src/release/releaseGateEvidencePolicy";

const CREATED: string[] = [];
const EVALUATED_AT = "2026-07-18T10:00:00.000Z";
const PRODUCER_API = releaseEvidenceProducer as Record<string, any>;
const TASK8B_FILES = [
  "tests/release/releaseManifestLifecycle.acceptance.test.ts",
  "tests/release/releaseManifestStore.acceptance.test.ts",
  "tests/release/productionReleaseEvidence.acceptance.test.ts",
  "tests/release/productionReleaseEvidence.postgres.test.ts"
] as const;
const TASK8B_TEST_PATCH_BASE_SHA = "8bdc92350608c0c149d1b6f8e96c2f863fd531d5";
const TASK8B_FROZEN_TEST_SHA = "9f9f5310fbe894c2feb0e49305bccdc00f4d70a7";
const TASK8B_OWNER_COMMIT_SHA = "d289021d2280539fa994e00916f36326a408fa9b";

function task8bPatchBytes(): Buffer {
  return execFileSync("git", ["diff", "--binary", TASK8B_TEST_PATCH_BASE_SHA, TASK8B_FROZEN_TEST_SHA,
    "--", "tests/fixtures/release/remediationReleaseFixtures.ts", ...TASK8B_FILES], { encoding: "buffer" });
}

function task8bReport(status: "failed" | "passed"): Buffer {
  const requiredPg = "[REQ-38][TASK8B-PG-RED] runs the frozen PostgreSQL RED case on an exact disposable non-production database with required execution report hash and cleanup";
  const testResults = TASK8B_FILES.map((file, index) => {
    const fullName = index === 3 ? requiredPg : `[REQ-38][TASK8B-RED-${index + 1}] exact behavioral boundary`;
    return {
      assertionResults: [{ ancestorTitles: [], fullName, title: fullName, status,
        duration: 1, failureMessages: status === "failed"
          ? [`Error: Plan 5 feature missing: exact task8b boundary ${index + 1}`] : [] }],
      startTime: 1, endTime: 2, status, message: "", name: resolve(file)
    };
  });
  return Buffer.from(JSON.stringify({
    numTotalTestSuites: 4, numPassedTestSuites: status === "passed" ? 4 : 0,
    numFailedTestSuites: status === "failed" ? 4 : 0,
    numPendingTestSuites: 0, numRuntimeErrorTestSuites: 0,
    numTotalTests: 4, numPassedTests: status === "passed" ? 4 : 0,
    numFailedTests: status === "failed" ? 4 : 0, numPendingTests: 0, numTodoTests: 0,
    startTime: 1, success: status === "passed", testResults
  }), "utf8");
}

function task8bHistoricalReceipt(redReportBytes: Buffer): Buffer {
  return Buffer.from(JSON.stringify({
    version: "task8b-red-evidence-v1",
    candidateSha: TASK8B_TEST_PATCH_BASE_SHA,
    databaseName: "tron_watch_plan5_task8b_red",
    databaseHost: "127.0.0.1",
    databasePort: 56002,
    toolProvider: "docker-exec",
    toolIdentitySha256: "a".repeat(64),
    requirePlan5Postgres: true,
    postgresAssertionsExecuted: 1,
    totalAssertionsExecuted: 4,
    skippedPostgresAssertions: 0,
    vitestReportSha256: createHash("sha256").update(redReportBytes).digest("hex"),
    cleanupDatabaseCount: 0
  }), "utf8");
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function makeRepositoryAndRoot() {
  const sandbox = mkdtempSync(join(tmpdir(), "release-manifest-cli-"));
  CREATED.push(sandbox);
  const repository = join(sandbox, "repository");
  const artifactRoot = join(sandbox, "artifacts");
  mkdirSync(repository, { mode: 0o700 });
  mkdirSync(artifactRoot, { mode: 0o700 });
  if (process.platform === "win32") {
    const sid = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "[Security.Principal.WindowsIdentity]::GetCurrent().User.Value"], { encoding: "utf8" }).trim();
    execFileSync("icacls.exe", [artifactRoot, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`,
      "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"]);
  }
  git(repository, "init", "--quiet");
  writeFileSync(join(repository, "tracked.txt"), "candidate\n", "utf8");
  git(repository, "add", "tracked.txt");
  git(repository, "-c", "user.name=Plan 5 Test", "-c", "user.email=plan5@example.invalid", "commit", "--quiet", "-m", "candidate");
  const candidateSha = git(repository, "rev-parse", "HEAD").toLowerCase();
  const absoluteRoot = resolve(artifactRoot);
  const rootKey = process.platform === "win32" ? absoluteRoot.toLowerCase() : absoluteRoot;
  const task0BPreflightEvidence = buildTask0BReleaseFreezeEvidence({
    candidateSha,
    observedAt: EVALUATED_AT,
    artifactRootFingerprintSha256: createHash("sha256").update(rootKey, "utf8").digest("hex")
  }) as Task0BReleaseFreezeEvidenceV1;
  const freeze = deriveReleaseFreezeIdentityV2(task0BPreflightEvidence);
  return { repository, artifactRoot, candidateSha, freeze, task0BPreflightEvidence };
}

async function materializeVerifiedFreeze(
  input: ReturnType<typeof makeRepositoryAndRoot>
): Promise<void> {
  writeFileSync(
    join(input.artifactRoot, "task0b-release-freeze.json"),
    canonicalBytesV2(input.task0BPreflightEvidence),
    { flag: "wx" }
  );
  await materializeReleaseFreezeV2({
    artifactRoot: input.artifactRoot,
    freezeIdentity: input.freeze,
    task0BPreflightEvidence: input.task0BPreflightEvidence,
    evaluatedAt: EVALUATED_AT,
    producerId: "release_freeze_materialize"
  });
}

function initialGateOutputs(candidateSha: string, artifactRoot: string) {
  const task0bBytes = readFileSync(join(artifactRoot, "task0b-release-freeze.json"));
  const task0b = JSON.parse(task0bBytes.toString("utf8")) as Task0BReleaseFreezeEvidenceV1;
  const freeze = JSON.parse(readFileSync(join(artifactRoot, "release-freeze-identity-v2.json"), "utf8"));
  const g00Policy = {
    version: "trusted-os-principal-policy-v2",
    policyId: task0b.artifactRoot.accessControlSource === "windows_acl_direct_read"
      ? "windows-configured-canonical-set-v1" : "posix-owner-only-v1",
    platform: task0b.artifactRoot.accessControlSource === "windows_acl_direct_read" ? "windows" : "posix",
    normalizedTrustedPrincipalSetSha256: "1".repeat(64), trustedPrincipalCount: 1,
    candidateSha, releaseGenerationId: freeze.releaseGenerationId,
    artifactRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
    releaseFreezeIdentitySha256: releaseFreezeIdentitySha256V2(freeze),
    task0BPreflightEvidenceSha256: createHash("sha256").update(task0bBytes).digest("hex"),
    ownerIdentityFingerprintSha256: task0b.artifactRoot.ownerIdentityFingerprintSha256,
    accessControlFingerprintSha256: task0b.artifactRoot.accessControlFingerprintSha256,
    authoritativePolicySource: "task0b_allowlisted_writer_principals_v2",
    observedAt: EVALUATED_AT, source: "task0b_acl_policy_read_only", verified: true
  } as const;
  const g00PolicyBytes = canonicalBytesV2(g00Policy);
  const g00Boundary = {
    version: "artifact-root-trust-boundary-evidence-v1", candidateSha,
    releaseGenerationId: freeze.releaseGenerationId,
    artifactRootFingerprintSha256: freeze.artifactRootFingerprintSha256,
    releaseFreezeIdentitySha256: releaseFreezeIdentitySha256V2(freeze),
    task0BPreflightEvidenceSha256: createHash("sha256").update(task0bBytes).digest("hex"),
    artifactRootObservationSha256: freeze.artifactRootTrustBoundaryEvidenceSha256,
    trustedOsPrincipalPolicySha256: createHash("sha256").update(g00PolicyBytes).digest("hex"),
    ownerIdentityFingerprintSha256: task0b.artifactRoot.ownerIdentityFingerprintSha256,
    accessControlFingerprintSha256: task0b.artifactRoot.accessControlFingerprintSha256,
    accessControlSource: task0b.artifactRoot.accessControlSource,
    outsideRepository: true, noSymlink: true, restrictiveAccessVerified: true, exclusiveWriteVerified: true,
    observedAt: EVALUATED_AT, source: "task0b_protected_root_acl_read_only", verified: true
  } as const;
  return PRE_RELEASE_GATE_IDS.filter((id) => id !== "G05_TELEGRAM").map((id) => ({
    id,
    candidateSha,
    state: "passed",
    commandId: GATE_COMMAND_IDS[id],
    redactedTemplateSha256: COMMAND_TEMPLATE_SHA256[GATE_COMMAND_IDS[id]],
    startedAt: "2026-07-18T09:58:00.000Z",
    finishedAt: "2026-07-18T09:59:00.000Z",
    exitCode: 0,
    outputSha256: "9".repeat(64),
    evidence: (() => {
      const policy = PRE_RELEASE_GATE_EVIDENCE_POLICY_V2[id];
      const refs: Array<{ kind: any; relativePath: string; sha256: string; schemaVersion: string; candidateSha: string }> = [];
      const paths = [...policy.primaryPaths];
      for (const [index, kind] of policy.requiredKinds.entries()) {
        if (index >= paths.length) paths.push(`gates/${id.toLowerCase()}/${kind}.json`);
      }
      for (const [index, relativePath] of paths.entries()) {
        const path = join(artifactRoot, ...relativePath.split("/"));
        if (!existsSync(path)) {
          mkdirSync(resolve(path, ".."), { recursive: true });
          const fixture = relativePath === "trusted-os-principal-policy-v2.json" ? g00Policy
            : relativePath === "artifact-root-trust-boundary-evidence-v1.json" ? g00Boundary
              : { version: "gate-evidence-v2", candidateSha,
                gateId: id, kind: policy.requiredKinds[index] ?? policy.allowedKinds[0] };
          writeFileSync(path, canonicalBytesV2(fixture));
        }
        const bytes = readFileSync(path);
        const parsed = JSON.parse(bytes.toString("utf8"));
        refs.push({ kind: policy.requiredKinds[index] ?? policy.allowedKinds[0], relativePath,
          sha256: createHash("sha256").update(bytes).digest("hex"), schemaVersion: parsed.version, candidateSha });
      }
      return refs;
    })()
  }));
}

function initialVerifiedInput(input: ReturnType<typeof makeRepositoryAndRoot>, candidateSha = input.candidateSha) {
  return {
    version: "verified-manifest-transition-input-v2",
    transitionId: "pre_manual",
    candidateSha,
    releaseGenerationId: input.freeze.releaseGenerationId,
    artifactRootFingerprintSha256: input.freeze.artifactRootFingerprintSha256,
    releaseFreezeIdentitySha256: releaseFreezeIdentitySha256V2(input.freeze),
    sourceManifestSha256: null,
    sourceManifestRevision: null,
    evaluatedAt: EVALUATED_AT,
    operationalAttestation: null,
    verifiedGateOutputs: initialGateOutputs(candidateSha, input.artifactRoot),
    verifiedTransitionEvidence: { refs: [], actualRollbackOutcome: null }
  };
}

function writeVerifiedInput(artifactRoot: string, transition: string, input: unknown): void {
  writeFileSync(
    join(artifactRoot, `verified-manifest-transition-input-${transition}.json`),
    canonicalBytesV2(input)
  );
}

afterEach(() => {
  for (const path of CREATED.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("release manifest advance CLI verified input", () => {
  it("exposes the single official producer entry point for the closed pre-release evidence graph", () => {
    expect(typeof PRODUCER_API.runPrepareRemediationReleaseEvidence)
      .toBe("function");
  });

  it("keeps every test-only producer/verifier dependency injection unreachable in production", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const artifactRoot = resolve(tmpdir(), "plan5-forbidden-test-injection");
    try {
      await expect(PRODUCER_API.publishG00TrustArtifacts({ artifactRoot }, {
        observeAuthoritativeTrust: async () => ({})
      })).rejects.toThrow(/test_dependency_injection_forbidden/i);
      await expect(PRODUCER_API.publishTask8BHistoricalRedEvidence({ artifactRoot }, {
        capture: async () => ({})
      })).rejects.toThrow(/test_dependency_injection_forbidden/i);
      await expect(PRODUCER_API.prepareVerifiedManifestTransitionInput({
        transitionId: "pre_manual", expectedSourceSha: "absent", artifactRoot
      }, { collectVerifiedGateOutputs: async () => [] }))
        .rejects.toThrow(/test_dependency_injection_forbidden/i);
      await expect(runAdvanceRemediationReleaseManifest(
        ["pre_manual", "absent", artifactRoot], { verifyConcrete: async () => undefined }
      )).rejects.toThrow(/test_verifier_injection_forbidden/i);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it("keeps every G00-G11 and pre-manual/readiness consumer input owned by exactly one producer", () => {
    expect(PRODUCER_API.validateReleaseEvidenceProducerGraphV2()).toEqual({
      gateCount: 12,
      transitionCount: 2,
      supportingInputCount: 11,
      externalProducerCount: 2
    });
    expect(PRODUCER_API.RELEASE_EVIDENCE_PRODUCER_GRAPH_V2.gates.G00_BASE
      .map((node: any) => node.producers[0])).toEqual([
      "release:trace:prepare", "release:evidence:g00", "release:evidence:g00",
      "release:freeze:materialize", "release:freeze:materialize"
    ]);
    expect(PRODUCER_API.RELEASE_EVIDENCE_PRODUCER_GRAPH_V2.gates.G01_TRACE
      .map((node: any) => node.producers[0])).toEqual([
      "release:trace:capture", "release:evidence:task8b-historical-red",
      "release:suite:plan4", "release:suite:plan4"
    ]);
    const graph = structuredClone(PRODUCER_API.RELEASE_EVIDENCE_PRODUCER_GRAPH_V2);
    delete graph.transitions.readiness;
    expect(() => PRODUCER_API.validateReleaseEvidenceProducerGraphV2(graph)).toThrow(/producer.*missing/i);
    const duplicate = structuredClone(PRODUCER_API.RELEASE_EVIDENCE_PRODUCER_GRAPH_V2);
    duplicate.gates.G07_SCHEMA_OFFLINE[0].producers.push("manual_copy");
    expect(() => PRODUCER_API.validateReleaseEvidenceProducerGraphV2(duplicate)).toThrow(/producer.*count/i);
    const substituted = structuredClone(PRODUCER_API.RELEASE_EVIDENCE_PRODUCER_GRAPH_V2);
    substituted.gates.G08_VERSION_SANITIZED[0].producers[0] = "manual_runtime_fixture";
    expect(() => PRODUCER_API.validateReleaseEvidenceProducerGraphV2(substituted))
      .toThrow(/producer.*identity|official.*producer/i);
    const missingSupport = structuredClone(PRODUCER_API.RELEASE_EVIDENCE_PRODUCER_GRAPH_V2);
    missingSupport.supporting.pop();
    expect(() => PRODUCER_API.validateReleaseEvidenceProducerGraphV2(missingSupport))
      .toThrow(/supporting.*producer.*missing/i);
    const reboundSupport = structuredClone(PRODUCER_API.RELEASE_EVIDENCE_PRODUCER_GRAPH_V2);
    reboundSupport.supporting[0].bindings.pop();
    expect(() => PRODUCER_API.validateReleaseEvidenceProducerGraphV2(reboundSupport))
      .toThrow(/supporting.*binding/i);
  });

  it("publishes exact G00 trust artifacts exclusively from the frozen Task0B observation", async () => {
    const setup = makeRepositoryAndRoot();
    await materializeVerifiedFreeze(setup);
    const observed = setup.task0BPreflightEvidence.artifactRoot;
    await PRODUCER_API.publishG00TrustArtifacts({
      artifactRoot: setup.artifactRoot,
      cwd: setup.repository,
      evaluatedAt: EVALUATED_AT
    }, {
      observeAuthoritativeTrust: async () => ({
        platform: process.platform === "win32" ? "windows" : "posix",
        principals: process.platform === "win32"
          ? ["S-1-5-21-1000", "S-1-5-18", "S-1-5-32-544"] : ["1000"],
        ownerIdentityFingerprintSha256: observed.ownerIdentityFingerprintSha256,
        accessControlFingerprintSha256: observed.accessControlFingerprintSha256
      })
    });
    const policyBytes = readFileSync(join(setup.artifactRoot, "trusted-os-principal-policy-v2.json"));
    const boundaryBytes = readFileSync(join(setup.artifactRoot, "artifact-root-trust-boundary-evidence-v1.json"));
    const policy = JSON.parse(policyBytes.toString("utf8"));
    const boundary = JSON.parse(boundaryBytes.toString("utf8"));
    expect(canonicalBytesV2(policy)).toEqual(policyBytes);
    expect(canonicalBytesV2(boundary)).toEqual(boundaryBytes);
    expect(policy).toMatchObject({
      version: "trusted-os-principal-policy-v2",
      candidateSha: setup.candidateSha,
      releaseGenerationId: setup.freeze.releaseGenerationId,
      artifactRootFingerprintSha256: setup.freeze.artifactRootFingerprintSha256,
      ownerIdentityFingerprintSha256: observed.ownerIdentityFingerprintSha256,
      accessControlFingerprintSha256: observed.accessControlFingerprintSha256,
      verified: true
    });
    expect(boundary).toMatchObject({
      version: "artifact-root-trust-boundary-evidence-v1",
      candidateSha: setup.candidateSha,
      trustedOsPrincipalPolicySha256: createHash("sha256").update(policyBytes).digest("hex"),
      verified: true
    });
    await expect(PRODUCER_API.verifyG00TrustArtifactsCurrent({ artifactRoot: setup.artifactRoot }, {
      observeAuthoritativeTrust: async () => ({
        platform: process.platform === "win32" ? "windows" : "posix",
        principals: process.platform === "win32"
          ? ["S-1-5-21-1000", "S-1-5-18", "S-1-5-32-544"] : ["1000"],
        ownerIdentityFingerprintSha256: observed.ownerIdentityFingerprintSha256,
        accessControlFingerprintSha256: observed.accessControlFingerprintSha256
      })
    })).resolves.toBeUndefined();
    await expect(PRODUCER_API.publishG00TrustArtifacts({
      artifactRoot: setup.artifactRoot, cwd: setup.repository, evaluatedAt: EVALUATED_AT
    })).rejects.toThrow(/already|exists|exclusive|conflict/i);
  }, 30_000);

  it("promotes validated G07 bytes to the only two canonical nested paths and rejects replay", async () => {
    const setup = makeRepositoryAndRoot();
    await materializeVerifiedFreeze(setup);
    const clean = { ...buildSchema032ReleaseEvidence(), candidateSha: setup.candidateSha,
      databaseRole: "clean", databaseFingerprintSha256: "1".repeat(64) };
    const clone = { ...buildSchema032ReleaseEvidence(), candidateSha: setup.candidateSha,
      databaseRole: "production_clone", databaseFingerprintSha256: "2".repeat(64) };
    const cleanBytes = canonicalBytesV2(clean);
    const cloneBytes = canonicalBytesV2(clone);
    const cleanSequenceRoot = `${setup.artifactRoot}-clean-sequence`;
    const productionCloneSequenceRoot = `${setup.artifactRoot}-clone-sequence`;
    mkdirSync(cleanSequenceRoot);
    mkdirSync(productionCloneSequenceRoot);
    if (process.platform === "win32") {
      const sid = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        "[Security.Principal.WindowsIdentity]::GetCurrent().User.Value"], { encoding: "utf8" }).trim();
      for (const sequenceRoot of [cleanSequenceRoot, productionCloneSequenceRoot]) {
        execFileSync("icacls.exe", [sequenceRoot, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`,
          "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"]);
      }
    }
    writeFileSync(join(cleanSequenceRoot, "schema032-release-evidence.json"), cleanBytes, { flag: "wx" });
    writeFileSync(join(productionCloneSequenceRoot, "schema032-release-evidence.json"), cloneBytes, { flag: "wx" });

    const result = await PRODUCER_API.promoteG07SchemaEvidence({
      artifactRoot: setup.artifactRoot, cleanSequenceRoot, productionCloneSequenceRoot, cwd: setup.repository
    });
    expect(result).toEqual({ cleanSha256: createHash("sha256").update(cleanBytes).digest("hex"),
      productionCloneSha256: createHash("sha256").update(cloneBytes).digest("hex") });
    expect(readFileSync(join(setup.artifactRoot, "schema-clean", "schema032-release-evidence.json")))
      .toEqual(cleanBytes);
    expect(readFileSync(join(setup.artifactRoot, "schema-production-clone", "schema032-release-evidence.json")))
      .toEqual(cloneBytes);
    await expect(PRODUCER_API.promoteG07SchemaEvidence({
      artifactRoot: setup.artifactRoot, cleanSequenceRoot, productionCloneSequenceRoot, cwd: setup.repository
    })).rejects.toThrow(/already|exists|exclusive|conflict/i);
  }, 30_000);

  it("publishes honest Task 8B historical RED V2 without claiming that the final candidate was RED", async () => {
    const setup = makeRepositoryAndRoot();
    await materializeVerifiedFreeze(setup);
    const redReportBytes = task8bReport("failed");
    const historicalReceiptBytes = task8bHistoricalReceipt(redReportBytes);
    const greenReportBytes = task8bReport("passed");
    const patchBytes = task8bPatchBytes();
    const frozenTestSha = TASK8B_FROZEN_TEST_SHA;
    const ownerCommitSha = TASK8B_OWNER_COMMIT_SHA;
    const published = await PRODUCER_API.publishTask8BHistoricalRedEvidence({
      artifactRoot: setup.artifactRoot, cwd: setup.repository
    }, {
      capture: async () => ({
        frozenTestSha, redExecutionSha: TASK8B_TEST_PATCH_BASE_SHA, ownerCommitSha,
        testPatchBaseSha: TASK8B_TEST_PATCH_BASE_SHA,
        testPatchBytes: patchBytes, redReportBytes, historicalReceiptBytes, greenReportBytes,
        redDatabaseName: "tron_watch_plan5_task8b_red", greenDatabaseName: "tron_watch_plan5_task8b_red",
        redDatabasePort: 56002, greenDatabasePort: 56003,
        redCleanupDatabaseCount: 0, greenCleanupDatabaseCount: 0
      }),
      isAncestor: async () => true,
      historicalContract: {
        redReportSha256: createHash("sha256").update(redReportBytes).digest("hex"),
        cleanupReceiptSha256: createHash("sha256").update(historicalReceiptBytes).digest("hex")
      }
    });
    const evidenceBytes = readFileSync(join(setup.artifactRoot, "task8b-historical-red-evidence-v2.json"));
    const evidence = JSON.parse(evidenceBytes.toString("utf8"));
    expect(published).toEqual(evidence);
    expect(evidence).toMatchObject({
      version: "task8b-historical-red-evidence-v2",
      candidateSha: setup.candidateSha,
      frozenTestSha,
      redExecutionSha: TASK8B_TEST_PATCH_BASE_SHA,
      ownerCommitSha,
      finalCandidateWasRed: false,
      lineage: { redExecutionToFrozenTest: true, frozenTestToOwner: true, ownerToCandidate: true },
      cleanup: { redDatabaseCount: 0, candidateGreenDatabaseCount: 0 }
    });
    expect(evidence.candidateSha).not.toBe(evidence.redExecutionSha);
    expect(evidence.redReport.sha256).toBe(createHash("sha256").update(redReportBytes).digest("hex"));
    expect(evidence.candidateGreenReport.sha256).toBe(createHash("sha256").update(greenReportBytes).digest("hex"));
    expect(() => PRODUCER_API.validateTask8BHistoricalRedEvidenceV2(
      evidence,
      { candidateSha: setup.candidateSha, redReportBytes, historicalReceiptBytes, greenReportBytes,
        testPatchBytes: patchBytes, historicalContract: {
          redReportSha256: createHash("sha256").update(redReportBytes).digest("hex"),
          cleanupReceiptSha256: createHash("sha256").update(historicalReceiptBytes).digest("hex")
        } }
    )).not.toThrow();
    expect(() => PRODUCER_API.validateTask8BHistoricalRedEvidenceV2(
      { ...evidence, ownerCommitSha: "f".repeat(40) },
      { candidateSha: setup.candidateSha, redReportBytes, historicalReceiptBytes, greenReportBytes,
        testPatchBytes: patchBytes, historicalContract: {
          redReportSha256: createHash("sha256").update(redReportBytes).digest("hex"),
          cleanupReceiptSha256: createHash("sha256").update(historicalReceiptBytes).digest("hex")
        } }
    )).toThrow(/owner|identity|lineage/i);
    const tampered = Buffer.concat([greenReportBytes, Buffer.from("\n")]);
    expect(() => PRODUCER_API.validateTask8BHistoricalRedEvidenceV2(
      evidence,
      { candidateSha: setup.candidateSha, redReportBytes, historicalReceiptBytes,
        greenReportBytes: tampered, testPatchBytes: patchBytes, historicalContract: {
          redReportSha256: createHash("sha256").update(redReportBytes).digest("hex"),
          cleanupReceiptSha256: createHash("sha256").update(historicalReceiptBytes).digest("hex")
        } }
    )).toThrow(/green.*hash|hash.*green/i);
    await expect(PRODUCER_API.publishTask8BHistoricalRedEvidence({
      artifactRoot: setup.artifactRoot, cwd: setup.repository
    })).rejects.toThrow(/already|exists|exclusive|conflict/i);
  }, 30_000);

  it("prepares separate exclusive pre-manual and readiness inputs with exact source lineage", async () => {
    const setup = makeRepositoryAndRoot();
    await materializeVerifiedFreeze(setup);
    expect(existsSync(join(setup.artifactRoot, "manual-telegram-acceptance.json"))).toBe(false);
    const automated = initialGateOutputs(setup.candidateSha, setup.artifactRoot);
    const preManual = await PRODUCER_API.prepareVerifiedManifestTransitionInput({
      transitionId: "pre_manual", expectedSourceSha: "absent", artifactRoot: setup.artifactRoot,
      cwd: setup.repository, evaluatedAt: EVALUATED_AT
    }, { collectVerifiedGateOutputs: async () => automated, verifyConcrete: async () => undefined });
    expect(preManual.verifiedGateOutputs.map((gate: any) => gate.id)).not.toContain("G05_TELEGRAM");
    expect(canonicalBytesV2(preManual)).toEqual(readFileSync(join(
      setup.artifactRoot, "verified-manifest-transition-input-pre_manual.json"
    )));
    const initialized = await runAdvanceRemediationReleaseManifest(
      ["pre_manual", "absent", setup.artifactRoot],
      { cwd: setup.repository, stdout: () => undefined, verifyConcrete: async () => undefined }
    );
    expect(initialized.manifest.revision).toBe(1);

    const manualBytes = canonicalBytesV2({ version: "manual-telegram-acceptance-v1",
      candidateSha: setup.candidateSha });
    writeFileSync(join(setup.artifactRoot, "manual-telegram-acceptance.json"), manualBytes, { flag: "wx" });
    const manualGate = {
      id: "G05_TELEGRAM", candidateSha: setup.candidateSha, state: "passed",
      commandId: GATE_COMMAND_IDS.G05_TELEGRAM,
      redactedTemplateSha256: COMMAND_TEMPLATE_SHA256.manual_telegram_acceptance,
      startedAt: EVALUATED_AT, finishedAt: EVALUATED_AT, exitCode: 0,
      outputSha256: createHash("sha256").update(manualBytes).digest("hex"),
      evidence: [{ kind: "manual_telegram_acceptance", relativePath: "manual-telegram-acceptance.json",
        sha256: createHash("sha256").update(manualBytes).digest("hex"),
        schemaVersion: "manual-telegram-acceptance-v1", candidateSha: setup.candidateSha }]
    };
    const manifestBytes = readFileSync(join(setup.artifactRoot, "release-manifest.json"));
    const sourceSha = createHash("sha256").update(manifestBytes).digest("hex");
    const readiness = await PRODUCER_API.prepareVerifiedManifestTransitionInput({
      transitionId: "readiness", expectedSourceSha: sourceSha, artifactRoot: setup.artifactRoot,
      cwd: setup.repository, evaluatedAt: "2026-07-18T10:01:00.000Z"
    }, { collectVerifiedGateOutputs: async () => [manualGate], verifyConcrete: async () => undefined });
    expect(readiness.sourceManifestSha256).toBe(sourceSha);
    expect(readiness.sourceManifestRevision).toBe(1);
    const advanced = await runAdvanceRemediationReleaseManifest(
      ["readiness", sourceSha, setup.artifactRoot],
      { cwd: setup.repository, stdout: () => undefined, verifyConcrete: async () => undefined }
    );
    expect(advanced.manifest).toMatchObject({ revision: 2, transitionId: "readiness",
      overall: "ready_for_release" });
    await expect(PRODUCER_API.prepareVerifiedManifestTransitionInput({
      transitionId: "readiness", expectedSourceSha: sourceSha, artifactRoot: setup.artifactRoot,
      cwd: setup.repository, evaluatedAt: "2026-07-18T10:01:00.000Z"
    })).rejects.toThrow(/already|exists|exclusive|conflict/i);
  }, 30_000);

  it("rejects a caller-supplied fourth evidence path", async () => {
    const setup = makeRepositoryAndRoot();
    await expect(runAdvanceRemediationReleaseManifest([
      "pre_manual", "absent", setup.artifactRoot, join(setup.artifactRoot, "operator-evidence.json")
    ], { cwd: setup.repository })).rejects.toThrow(/usage/);
  });

  it("rejects a fixed prepared input bound to a different candidate before manifest mutation", async () => {
    const setup = makeRepositoryAndRoot();
    await materializeVerifiedFreeze(setup);
    writeVerifiedInput(setup.artifactRoot, "pre_manual", initialVerifiedInput(setup, "f".repeat(40)));

    await expect(runAdvanceRemediationReleaseManifest(
      ["pre_manual", "absent", setup.artifactRoot],
      { cwd: setup.repository }
    )).rejects.toThrow("verified_manifest_input_candidate_binding_invalid");
    expect(() => readFileSync(join(setup.artifactRoot, "release-manifest.json"))).toThrow();
  });

  it("loads the exact allowlisted prepared input and initializes the real manifest store", async () => {
    const setup = makeRepositoryAndRoot();
    await materializeVerifiedFreeze(setup);
    writeVerifiedInput(setup.artifactRoot, "pre_manual", initialVerifiedInput(setup));

    const result = await runAdvanceRemediationReleaseManifest(
      ["pre_manual", "absent", setup.artifactRoot],
      { cwd: setup.repository, now: () => "2030-01-01T00:00:00.000Z", stdout: () => undefined,
        verifyConcrete: async () => undefined }
    );

    expect(result.manifest.revision).toBe(1);
    expect(result.manifest.updatedAt).toBe(EVALUATED_AT);
    expect(validateRemediationReleaseManifestV2(JSON.parse(
      readFileSync(join(setup.artifactRoot, "release-manifest.json"), "utf8")
    ))).toEqual(result.manifest);
  }, 30_000);
});
