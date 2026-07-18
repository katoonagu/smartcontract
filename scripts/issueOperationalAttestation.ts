import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { issueOperationalAttestationV2 } from "../src/release/releaseManifestStoreV2";
import { MANIFEST_TRANSITIONS_V2, type ManifestTransitionIdV2 } from "../src/release/remediationReleaseManifestV2";

export async function runIssueOperationalAttestation(args: string[]) {
  if (args.length !== 2 || !MANIFEST_TRANSITIONS_V2.includes(args[0] as ManifestTransitionIdV2)) {
    throw new Error("usage: release:authority:issue <allowlisted-transition> <protected-artifact-root>");
  }
  return issueOperationalAttestationV2({ action: args[0] as ManifestTransitionIdV2, artifactRoot: args[1] });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runIssueOperationalAttestation(process.argv.slice(2)).then((result) => console.log(JSON.stringify(result)))
    .catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
