import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { OPERATIONAL_ATTESTATION_POLICY_V2 } from "../src/release/remediationReleaseManifestV2";
import { terminalizeExpiredOperationalAttestationTipV2 } from "../src/release/releaseManifestStoreV2";
import { observeProductionDatabase } from "./createProductionBackupEvidence";
import { SCHEMA_032_PRODUCER_ADVISORY_LOCK } from "./runSchema032ReleaseSequence";

type G13AbsenceGuardFactory = NonNullable<Parameters<
  typeof terminalizeExpiredOperationalAttestationTipV2
>[0]["acquireG13AbsenceGuard"]>;

async function acquireProductionG13AbsenceGuard(
  databaseUrl: string | undefined,
  expectedDatabaseIdentityFingerprintSha256: string
) {
  if (!databaseUrl) throw new Error("g13_terminalization_database_url_missing");
  const observed = await observeProductionDatabase(databaseUrl);
  try {
    if (observed.identityFingerprintSha256 !== expectedDatabaseIdentityFingerprintSha256) {
      throw new Error("g13_terminalization_database_identity_unverified");
    }
    const acquired = await observed.client.query("select pg_try_advisory_lock($1) as acquired",
      [SCHEMA_032_PRODUCER_ADVISORY_LOCK]);
    if (acquired.rows[0]?.acquired !== true) {
      throw new Error("g13_terminalization_database_session_or_lock_present");
    }
    let released = false;
    return {
      release: async () => {
        if (released) return;
        released = true;
        try {
          const result = await observed.client.query("select pg_advisory_unlock($1) as released",
            [SCHEMA_032_PRODUCER_ADVISORY_LOCK]);
          if (result.rows[0]?.released !== true) throw new Error("g13_terminalization_database_guard_release_failed");
        } finally {
          await observed.client.query("rollback").catch(() => undefined);
          await observed.client.end().catch(() => undefined);
        }
      }
    };
  } catch (error) {
    await observed.client.query("rollback").catch(() => undefined);
    await observed.client.end().catch(() => undefined);
    throw error;
  }
}

export async function runTerminalizeExpiredUnclaimedAuthority(args: string[], dependencies: {
  now?: () => string;
  environment?: NodeJS.ProcessEnv;
  acquireG13AbsenceGuard?: G13AbsenceGuardFactory;
} = {}) {
  const [action, artifactRoot] = args;
  if (args.length !== 2 || action === undefined || artifactRoot === undefined
      || !(action in OPERATIONAL_ATTESTATION_POLICY_V2)) {
    throw new Error("usage: release:authority:terminalize <transition> <protected-artifact-root>");
  }
  const environment = dependencies.environment ?? process.env;
  const acquireG13AbsenceGuard = dependencies.acquireG13AbsenceGuard ?? (async (input) =>
    acquireProductionG13AbsenceGuard(
      environment.TASK0B_PRODUCTION_DATABASE_URL,
      input.databaseIdentityFingerprintSha256
    ));
  return terminalizeExpiredOperationalAttestationTipV2({
    artifactRoot,
    action: action as keyof typeof OPERATIONAL_ATTESTATION_POLICY_V2,
    evaluatedAt: (dependencies.now ?? (() => new Date().toISOString()))(),
    ...(action === "g13_migration_passed" ? { acquireG13AbsenceGuard } : {})
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runTerminalizeExpiredUnclaimedAuthority(process.argv.slice(2)).then((result) => console.log(JSON.stringify(result)))
    .catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
