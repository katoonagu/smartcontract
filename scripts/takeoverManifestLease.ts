import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { takeoverRootWriterLeaseByHashV2 } from "../src/release/releaseManifestStoreV2";
import {
  validateReleaseFreezeIdentityV2,
  validateReleaseRootWriterLeaseV2
} from "../src/release/remediationReleaseManifestV2";
import {
  ROOT_WRITER_LEASE_FILE,
  assertArtifactRootOutsideRepository,
  assertSafeArtifactRootPath,
  safeArtifactPath
} from "../src/release/releaseRootWriterStore";

export async function runTakeoverManifestLease(args: string[], now = () => new Date().toISOString()) {
  if (args.length !== 2) throw new Error("usage: release:manifest:takeover <old-lease-sha> <artifact-root>");
  const [expectedOldLeaseSha256, rawRoot] = args;
  if (!isAbsolute(rawRoot)) throw new Error("artifact_root_must_be_absolute");
  const repositoryRoot = process.cwd();
  if (execFileSync("git", ["status", "--porcelain=v1"], { cwd: repositoryRoot, encoding: "utf8" }).trim()) {
    throw new Error("candidate_worktree_dirty");
  }
  const candidateSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot, encoding: "utf8"
  }).trim().toLowerCase();
  const root = assertSafeArtifactRootPath(rawRoot);
  assertArtifactRootOutsideRepository(root, repositoryRoot);
  const freezePath = safeArtifactPath(root, "release-freeze-identity-v2.json");
  const leasePath = safeArtifactPath(root, ROOT_WRITER_LEASE_FILE);
  const tombstonePath = safeArtifactPath(root,
    `manifest-transition-root.lease-tombstone-${expectedOldLeaseSha256}.json`);
  const rootCandidateSha = existsSync(freezePath)
    ? validateReleaseFreezeIdentityV2(JSON.parse(readFileSync(freezePath, "utf8"))).candidateSha
    : validateReleaseRootWriterLeaseV2(JSON.parse(readFileSync(
      existsSync(leasePath) ? leasePath : tombstonePath, "utf8"))).candidateSha;
  if (rootCandidateSha !== candidateSha) throw new Error("candidate_head_binding_invalid");
  const result = await takeoverRootWriterLeaseByHashV2({
    artifactRoot: root, expectedOldLeaseSha256, evaluatedAt: now()
  });
  console.log(JSON.stringify({ status: "passed", newLeaseEpoch: result.newLease.leaseEpoch,
    sealed: "sealed" in result ? result.sealed : false }));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runTakeoverManifestLease(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
