import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { takeoverRootWriterLeaseByHashV2 } from "../src/release/releaseManifestStoreV2";

export async function runTakeoverManifestLease(args: string[], now = () => new Date().toISOString()) {
  if (args.length !== 2) throw new Error("usage: release:manifest:takeover <old-lease-sha> <artifact-root>");
  const [expectedOldLeaseSha256, rawRoot] = args;
  const result = await takeoverRootWriterLeaseByHashV2({
    artifactRoot: resolve(rawRoot), expectedOldLeaseSha256, evaluatedAt: now()
  });
  console.log(JSON.stringify({ status: "passed", newLeaseEpoch: result.newLease.epoch }));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runTakeoverManifestLease(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
