import { Client } from "pg";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSchema032ClientConfig } from "./verifySchema032";
import { buildSchema032DatabaseFingerprint } from "./verifySchema032";
import { readSafeArtifactFile, resolveExternalArtifactRoot } from "./verifyRemediationRelease";
import {
  deriveTerminalLegacyFreezeBinding,
  snapshotTerminalLegacyPopulation
} from "../src/release/terminalLegacyPopulation";

const SYSTEM_IDENTIFIER = /^\d{10,30}$/;
const SAFE_ENV = /^[A-Z][A-Z0-9_]*$/;

function fail(code: string): never {
  throw new Error(code);
}

function parseArgs(argv: string[]): {
  databaseUrlEnv: string;
  expectedEndpoint: string;
  expectedSystemIdentifier: string;
  artifactRoot: string;
  task0bEvidence: string;
  offline: boolean;
} {
  const values = new Map<string, string>();
  let offline = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--offline") {
      offline = true;
      continue;
    }
    const name = argv[index];
    const value = argv[++index];
    if (!name?.startsWith("--") || !value || values.has(name)) fail("terminal_legacy_args_invalid");
    values.set(name, value);
  }
  const databaseUrlEnv = values.get("--database-url-env") ?? "";
  const expectedEndpoint = values.get("--expected-endpoint") ?? "";
  const expectedSystemIdentifier = values.get("--expected-system-identifier") ?? "";
  const artifactRoot = values.get("--artifact-root") ?? "";
  const task0bEvidence = values.get("--task0b-evidence") ?? "";
  if (!SAFE_ENV.test(databaseUrlEnv) || !expectedEndpoint || !SYSTEM_IDENTIFIER.test(expectedSystemIdentifier)
      || !artifactRoot || !task0bEvidence) fail("terminal_legacy_args_invalid");
  return { databaseUrlEnv, expectedEndpoint, expectedSystemIdentifier, artifactRoot, task0bEvidence, offline };
}

async function main(): Promise<void> {
  const input = parseArgs(process.argv.slice(2));
  const artifactRoot = await resolveExternalArtifactRoot(input.artifactRoot);
  const task0bBytes = await readSafeArtifactFile(artifactRoot, input.task0bEvidence);
  const releaseSha = process.env.RELEASE_SHA ?? "";
  const freezeBinding = deriveTerminalLegacyFreezeBinding(task0bBytes, releaseSha, new Date().toISOString());
  const databaseUrl = process.env[input.databaseUrlEnv];
  if (!databaseUrl) fail("terminal_legacy_database_url_missing");
  const parsed = new URL(databaseUrl);
  const endpoint = `${parsed.hostname.toLowerCase()}:${parsed.port || "5432"}`;
  if (endpoint !== input.expectedEndpoint || decodeURIComponent(parsed.pathname.slice(1)) !== freezeBinding.databaseName) {
    fail("terminal_legacy_database_target_mismatch");
  }
  const client = new Client(buildSchema032ClientConfig(databaseUrl, input.offline));
  let transactionStarted = false;
  try {
    await client.connect();
    const identity = await client.query(`select current_database() as database_name,
      current_setting('server_version_num') as server_version_num,
      (select oid::text from pg_database where datname = current_database()) as database_oid,
      (pg_control_system()).system_identifier::text as system_identifier`);
    if (identity.rows.length !== 1 || identity.rows[0]?.database_name !== freezeBinding.databaseName
        || identity.rows[0]?.system_identifier !== input.expectedSystemIdentifier) fail("terminal_legacy_database_identity_mismatch");
    const fingerprint = buildSchema032DatabaseFingerprint({
      databaseEndpoint: input.expectedEndpoint,
      systemIdentifier: input.expectedSystemIdentifier,
      databaseName: freezeBinding.databaseName,
      databaseOid: String(identity.rows[0]?.database_oid),
      serverVersion: String(identity.rows[0]?.server_version_num)
    });
    if (fingerprint !== freezeBinding.databaseFingerprintSha256) fail("terminal_legacy_database_fingerprint_mismatch");
    await client.query("begin transaction read only");
    transactionStarted = true;
    const evidence = await snapshotTerminalLegacyPopulation(client, freezeBinding);
    await client.query("commit");
    transactionStarted = false;
    process.stdout.write(`${JSON.stringify(evidence)}\n`);
  } finally {
    if (transactionStarted) await client.query("rollback").catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath.toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  main().catch(() => {
    process.stderr.write("terminal_legacy_snapshot_failed\n");
    process.exitCode = 1;
  });
}
