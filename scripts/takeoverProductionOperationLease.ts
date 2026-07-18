import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { takeoverProductionOperationLeaseV2 } from "../src/release/productionOperationStore";
import { createProtectedProductionOperationAdaptersV2 } from "../src/release/productionOperationAdaptersV2";
import { executeProtectedProductionOperationV2 } from "../src/release/productionReleaseOrchestratorV2";
import { validateReleaseFreezeIdentityV2 } from "../src/release/remediationReleaseManifestV2";
import {
  assertArtifactRootOutsideRepository,
  assertTrustedArtifactRootPathV2,
  safeArtifactPath
} from "../src/release/releaseRootWriterStore";

export async function resumeTakenOverProductionOperationV2(
  artifactRoot: string,
  takeover: Awaited<ReturnType<typeof takeoverProductionOperationLeaseV2>>,
  execute = executeProtectedProductionOperationV2,
  createAdapters = createProtectedProductionOperationAdaptersV2
) {
  return execute({ artifactRoot, operationKind: takeover.operationKind }, {
    adapters: createAdapters(artifactRoot)
  });
}

export async function runTakeoverProductionOperationLease(
  args: string[],
  now = () => new Date().toISOString()
) {
  if (args.length !== 2 || !/^[0-9a-f]{64}$/u.test(args[0]!)) {
    throw new Error("usage: release:production:lease:takeover <old-lease-sha> <protected-artifact-root>");
  }
  const [expectedOldLeaseSha256, rawRoot] = args as [string, string];
  if (!isAbsolute(rawRoot)) throw new Error("artifact_root_must_be_absolute");
  const repositoryRoot = process.cwd();
  if (execFileSync("git", ["status", "--porcelain=v1"], {
    cwd: repositoryRoot, encoding: "utf8"
  }).trim()) throw new Error("candidate_worktree_dirty");
  const candidateSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot, encoding: "utf8"
  }).trim().toLowerCase();
  const root = assertTrustedArtifactRootPathV2(rawRoot);
  assertArtifactRootOutsideRepository(root, repositoryRoot);
  const freeze = validateReleaseFreezeIdentityV2(JSON.parse(readFileSync(
    safeArtifactPath(root, "release-freeze-identity-v2.json"), "utf8")));
  if (freeze.candidateSha !== candidateSha) throw new Error("candidate_head_binding_invalid");
  const result = await takeoverProductionOperationLeaseV2({
    artifactRoot: root,
    expectedOldLeaseSha256,
    evaluatedAt: now()
  });
  const resumed = await resumeTakenOverProductionOperationV2(root, result);
  console.log(JSON.stringify({ status: "passed", operationId: result.operationId,
    newLeaseEpoch: result.newLeaseEpoch, newLeaseSha256: result.newLeaseSha256,
    resumedReceiptSha256: resumed.receiptSha256 }));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runTakeoverProductionOperationLease(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
