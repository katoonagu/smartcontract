import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAdvanceRemediationReleaseManifest } from "../../scripts/advanceRemediationReleaseManifest";
import { canonicalBytesV2 } from "../../src/release/releaseRootWriterStore";
import {
  releaseFreezeIdentitySha256V2,
  validateRemediationReleaseManifestV2
} from "../../src/release/remediationReleaseManifestV2";
import {
  COMMAND_TEMPLATE_SHA256,
  GATE_COMMAND_IDS,
  PLAN_BASE_SHA,
  PRE_RELEASE_GATE_IDS
} from "../fixtures/release/remediationReleaseFixtures";

const CREATED: string[] = [];
const EVALUATED_AT = "2026-07-18T10:00:00.000Z";

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
  git(repository, "init", "--quiet");
  writeFileSync(join(repository, "tracked.txt"), "candidate\n", "utf8");
  git(repository, "add", "tracked.txt");
  git(repository, "-c", "user.name=Plan 5 Test", "-c", "user.email=plan5@example.invalid", "commit", "--quiet", "-m", "candidate");
  const candidateSha = git(repository, "rev-parse", "HEAD").toLowerCase();
  const freeze = {
    version: "release-freeze-identity-v2",
    releaseGenerationId: "release-generation-cli-test",
    candidateSha,
    planBaseSha: PLAN_BASE_SHA,
    artifactRootFingerprintSha256: "1".repeat(64),
    artifactRootTrustBoundaryEvidenceSha256: "2".repeat(64),
    productionDatabaseIdentityFingerprintSha256: "3".repeat(64),
    postgresToolIdentitySha256: "4".repeat(64),
    previousRuntimeDiscoverySha256: "5".repeat(64),
    rollbackWorktreeIdentitySha256: "6".repeat(64),
    createdAt: EVALUATED_AT
  };
  writeFileSync(join(artifactRoot, "release-freeze-identity-v2.json"), canonicalBytesV2(freeze));
  return { repository, artifactRoot, candidateSha, freeze };
}

function initialGateOutputs(candidateSha: string) {
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
    evidence: [{
      kind: id === "G00_BASE" ? "task0_baseline" : "suite_evidence",
      relativePath: `gates/${id.toLowerCase()}.json`,
      sha256: "a".repeat(64),
      schemaVersion: "gate-evidence-v2",
      candidateSha
    }]
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
    verifiedGateOutputs: initialGateOutputs(candidateSha),
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
  it("rejects a caller-supplied fourth evidence path", async () => {
    const setup = makeRepositoryAndRoot();
    await expect(runAdvanceRemediationReleaseManifest([
      "pre_manual", "absent", setup.artifactRoot, join(setup.artifactRoot, "operator-evidence.json")
    ], { cwd: setup.repository })).rejects.toThrow(/usage/);
  });

  it("rejects a fixed prepared input bound to a different candidate before manifest mutation", async () => {
    const setup = makeRepositoryAndRoot();
    writeVerifiedInput(setup.artifactRoot, "pre_manual", initialVerifiedInput(setup, "f".repeat(40)));

    await expect(runAdvanceRemediationReleaseManifest(
      ["pre_manual", "absent", setup.artifactRoot],
      { cwd: setup.repository }
    )).rejects.toThrow("verified_manifest_input_candidate_binding_invalid");
    expect(() => readFileSync(join(setup.artifactRoot, "release-manifest.json"))).toThrow();
  });

  it("loads the exact allowlisted prepared input and initializes the real manifest store", async () => {
    const setup = makeRepositoryAndRoot();
    writeVerifiedInput(setup.artifactRoot, "pre_manual", initialVerifiedInput(setup));

    const result = await runAdvanceRemediationReleaseManifest(
      ["pre_manual", "absent", setup.artifactRoot],
      { cwd: setup.repository, now: () => "2030-01-01T00:00:00.000Z", stdout: () => undefined }
    );

    expect(result.manifest.revision).toBe(1);
    expect(result.manifest.updatedAt).toBe(EVALUATED_AT);
    expect(validateRemediationReleaseManifestV2(JSON.parse(
      readFileSync(join(setup.artifactRoot, "release-manifest.json"), "utf8")
    ))).toEqual(result.manifest);
  });
});
