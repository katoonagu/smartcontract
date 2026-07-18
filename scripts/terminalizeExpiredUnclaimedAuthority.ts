import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { terminalizeExpiredOperationalAttestationV2 } from "../src/release/releaseManifestStoreV2";

export async function runTerminalizeExpiredUnclaimedAuthority(args: string[], now = () => new Date().toISOString()) {
  if (args.length !== 2) throw new Error("usage: release:authority:terminalize <authority-json> <protected-artifact-root>");
  const [authorityPath, artifactRoot] = args;
  return terminalizeExpiredOperationalAttestationV2({ artifactRoot,
    authority: JSON.parse(readFileSync(authorityPath, "utf8")), evaluatedAt: now() });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runTerminalizeExpiredUnclaimedAuthority(process.argv.slice(2)).then((result) => console.log(JSON.stringify(result)))
    .catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
