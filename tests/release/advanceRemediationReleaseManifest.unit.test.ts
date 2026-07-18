import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAdvanceRemediationReleaseManifest } from "../../scripts/advanceRemediationReleaseManifest";
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
  buildTask0BReleaseFreezeEvidence
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
      { cwd: setup.repository, now: () => "2030-01-01T00:00:00.000Z", stdout: () => undefined }
    );

    expect(result.manifest.revision).toBe(1);
    expect(result.manifest.updatedAt).toBe(EVALUATED_AT);
    expect(validateRemediationReleaseManifestV2(JSON.parse(
      readFileSync(join(setup.artifactRoot, "release-manifest.json"), "utf8")
    ))).toEqual(result.manifest);
  }, 30_000);
});
