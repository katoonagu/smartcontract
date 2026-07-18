import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { materializeReleaseFreezeV2 } from "../src/release/releaseManifestStoreV2";
import { safeArtifactPath } from "../src/release/releaseRootWriterStore";

export async function runMaterializeReleaseFreeze(args: string[], now = () => new Date().toISOString()) {
  if (args.length !== 1) throw new Error("usage: release:freeze:materialize <protected-artifact-root>");
  const [artifactRoot] = args;
  const task0BPreflightEvidence = JSON.parse(readFileSync(
    safeArtifactPath(artifactRoot, "task0b-release-freeze.json"), "utf8"));
  return materializeReleaseFreezeV2({ artifactRoot, task0BPreflightEvidence,
    evaluatedAt: now(), producerId: "release_freeze_materialize" });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runMaterializeReleaseFreeze(process.argv.slice(2)).then((result) => console.log(JSON.stringify(result)))
    .catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
