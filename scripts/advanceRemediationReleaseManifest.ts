import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  MANIFEST_TRANSITIONS_V2,
  releaseSha256V2,
  validateRemediationReleaseManifestV2,
  type ManifestTransitionIdV2
} from "../src/release/remediationReleaseManifestV2";
import {
  advanceReleaseManifestV2,
  initializeReleaseManifestV2
} from "../src/release/releaseManifestStoreV2";

const execFileAsync = promisify(execFile);

export async function runAdvanceRemediationReleaseManifest(
  args: string[],
  dependencies: { cwd?: string; now?: () => string; stdout?: (line: string) => void } = {}
) {
  if (args.length !== 3) throw new Error("usage: release:manifest:advance <transition> <source-sha|absent> <artifact-root>");
  const [transitionToken, expectedSourceSha, rawRoot] = args;
  if (!MANIFEST_TRANSITIONS_V2.includes(transitionToken as ManifestTransitionIdV2)
      || !(/^[0-9a-f]{64}$/.test(expectedSourceSha) || expectedSourceSha === "absent")) {
    throw new Error("manifest_advance_arguments_invalid");
  }
  const cwd = dependencies.cwd ?? process.cwd();
  const status = await execFileAsync("git", ["status", "--porcelain=v1"], { cwd });
  if (status.stdout.trim().length !== 0) throw new Error("candidate_worktree_dirty");
  const root = resolve(rawRoot);
  const manifestPath = resolve(root, "release-manifest.json");
  const actualBytes = existsSync(manifestPath) ? readFileSync(manifestPath) : null;
  if (expectedSourceSha === "absent" ? actualBytes !== null : actualBytes === null
      || (actualBytes && releaseSha256V2(actualBytes) !== expectedSourceSha)) {
    throw new Error("manifest_source_cas_conflict");
  }
  const evaluatedAt = (dependencies.now ?? (() => new Date().toISOString()))();
  const result = transitionToken === "pre_manual"
    ? await initializeReleaseManifestV2({ artifactRoot: root, evaluatedAt })
    : await advanceReleaseManifestV2({ artifactRoot: root,
      sourceManifest: validateRemediationReleaseManifestV2(JSON.parse(actualBytes!.toString("utf8"))),
      transition: { transitionId: transitionToken as ManifestTransitionIdV2, evaluatedAt }, evaluatedAt });
  (dependencies.stdout ?? console.log)(JSON.stringify({ status: "passed", transitionId: transitionToken,
    revision: result.manifest.revision }));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runAdvanceRemediationReleaseManifest(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
