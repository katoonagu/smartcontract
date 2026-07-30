import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { loadConfig } from "../src/config.js";
import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../src/forensics/canonicalJson.js";
import {
  buildTransactionProviderEvidenceV1,
  getTransactionProviderEvidence,
  saveTransactionProviderEvidence,
  type TronTransactionProviderEvidenceV1
} from "../src/storage/transactionEvidenceRepository.js";
import { TronscanClient } from "../src/tron/tronClient.js";
import { createTronscanScheduler } from "../src/tron/tronscanScheduler.js";
import { insertUnifiedArtifact, type UnifiedQueryable } from "../src/unifiedCheck/repository.js";
import {
  buildServiceRoleExactEvidenceCaptureManifestV1,
  evaluateServiceRoleExactEvidenceCaptureV1,
  validateServiceRoleExactEvidenceCaptureReceiptV1,
  type ServiceRoleExactEvidenceCaptureCoverageV1,
  type ServiceRoleExactEvidenceCaptureManifestV1
} from "../src/unifiedCheck/serviceRoleExactEvidenceCapture.js";
import {
  loadServiceRoleMaterializationSource,
  type ServiceRoleMaterializationQueryable,
  type ServiceRoleMaterializationSource
} from "./materializeServiceRoleEventMap.js";

const HASH = /^[0-9a-f]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CAPTURE_KINDS = [
  "service_role_exact_evidence_capture_manifest",
  "service_role_poisoning_disposition",
  "service_role_provider_risk_disposition",
  "service_role_exact_evidence_capture"
] as const;

type Bound<T> = { sha256: string; artifact: T };
type Evaluation = ReturnType<typeof evaluateServiceRoleExactEvidenceCaptureV1>;

export type ServiceRoleExactEvidenceCaptureCommand = {
  mode: "audit" | "capture";
  runId: string;
  manifestSha256: string;
  anchor: string;
};

export type ServiceRoleExactEvidenceCaptureDatabase = ServiceRoleMaterializationQueryable & {
  transaction<T>(
    mode: "read_only" | "read_write",
    work: (tx: ServiceRoleMaterializationQueryable) => Promise<T>
  ): Promise<T>;
};

export type ServiceRoleExactEvidenceCaptureDependencies = {
  getTransaction(txHash: string): Promise<unknown>;
  now(): Date;
};

export type ServiceRoleExactEvidenceCaptureRunResult = {
  classification: "complete" | "incomplete";
  coverage: ServiceRoleExactEvidenceCaptureCoverageV1;
  captureManifestSha256: string;
  completedReceiptSha256: string | null;
  providerLogicalRequests: number;
};

function fail(code: string): never {
  throw new Error(code);
}

function validateCommand(command: ServiceRoleExactEvidenceCaptureCommand): void {
  const milliseconds = Date.parse(command.anchor);
  if (!UUID.test(command.runId) || !HASH.test(command.manifestSha256) ||
    !Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== command.anchor || milliseconds % 1_000 !== 0 ||
    (command.mode !== "audit" && command.mode !== "capture")) {
    fail("service_role_exact_evidence_capture_args_invalid");
  }
}

export function parseServiceRoleExactEvidenceCaptureArgs(argv: readonly string[]): ServiceRoleExactEvidenceCaptureCommand {
  const mode = argv[0];
  if (mode !== "audit" && mode !== "capture") fail("service_role_exact_evidence_capture_args_invalid");
  const offset = mode === "capture" ? 1 : 0;
  if (argv.length !== 7 + offset || (mode === "capture" && argv[1] !== "--confirm") ||
    argv[1 + offset] !== "--run" || argv[3 + offset] !== "--manifest" || argv[5 + offset] !== "--anchor") {
    fail("service_role_exact_evidence_capture_args_invalid");
  }
  const command: ServiceRoleExactEvidenceCaptureCommand = {
    mode,
    runId: argv[2 + offset]!,
    manifestSha256: argv[4 + offset]!,
    anchor: argv[6 + offset]!
  };
  validateCommand(command);
  return command;
}

function manifestFor(source: ServiceRoleMaterializationSource, command: ServiceRoleExactEvidenceCaptureCommand) {
  return buildServiceRoleExactEvidenceCaptureManifestV1({
    runId: source.runId,
    snapshotHash: source.snapshotHash,
    subjectAddress: source.subjectAddress,
    states: source.states,
    anchor: command.anchor,
    acceptedHistory: source.acceptedHistory
  });
}

function identity(txHash: string) {
  return {
    version: "tron-transaction-provider-evidence-v1" as const,
    chain: "tron" as const,
    txHash,
    provider: "tronscan" as const,
    endpoint: "transaction-info" as const,
    providerSchemaVersion: 1 as const
  };
}

async function loadEvidence(
  db: ServiceRoleMaterializationQueryable,
  manifest: Bound<ServiceRoleExactEvidenceCaptureManifestV1>
): Promise<Map<string, TronTransactionProviderEvidenceV1>> {
  const result = new Map<string, TronTransactionProviderEvidenceV1>();
  for (const txHash of [...new Set(manifest.artifact.events.map((event) => event.txHash))].sort()) {
    const item = await getTransactionProviderEvidence(db as any, identity(txHash));
    if (item) result.set(txHash, item);
  }
  return result;
}

function validateArtifactRow(row: any, input: {
  sha256: string;
  runId: string;
  kind: string;
  artifact: unknown;
}): void {
  if (!row || String(row.sha256) !== input.sha256 || String(row.created_by_run_id) !== input.runId ||
    String(row.kind) !== input.kind || String(row.schema_version) !== "1" ||
    fingerprintCanonicalArtifact(row.artifact_json) !== input.sha256 ||
    canonicalizeArtifactJson(row.artifact_json) !== canonicalizeArtifactJson(input.artifact)) {
    fail("service_role_exact_evidence_capture_artifact_conflict");
  }
}

async function captureRows(
  db: ServiceRoleMaterializationQueryable,
  command: ServiceRoleExactEvidenceCaptureCommand,
  manifest: Bound<ServiceRoleExactEvidenceCaptureManifestV1>
) {
  return (await db.query(
    `select sha256,created_by_run_id,kind,schema_version,artifact_json,created_at
       from unified_check_artifacts
      where kind=any($1::text[])
        and artifact_json->>'runId'=$2
        and ((kind='service_role_exact_evidence_capture_manifest'
              and artifact_json->'addressHistory'->>'manifestSha256'=$3
              and artifact_json->'sample'=$4::jsonb)
          or (kind='service_role_exact_evidence_capture'
              and artifact_json->>'captureManifestSha256'=$5)
          or (kind in ('service_role_poisoning_disposition','service_role_provider_risk_disposition')
              and artifact_json->>'addressHistoryManifestSha256'=$3
              and artifact_json->>'canonicalEventId'=any($6::text[])))
      order by kind,sha256`,
    [
      [...CAPTURE_KINDS],
      command.runId,
      command.manifestSha256,
      JSON.stringify(manifest.artifact.sample),
      manifest.sha256,
      manifest.artifact.events.map((event) => event.canonicalEventId)
    ]
  )).rows;
}

async function verifyManifestRows(
  db: ServiceRoleMaterializationQueryable,
  command: ServiceRoleExactEvidenceCaptureCommand,
  manifest: Bound<ServiceRoleExactEvidenceCaptureManifestV1>
): Promise<boolean> {
  const rows = (await captureRows(db, command, manifest)).filter((row) => row.kind === "service_role_exact_evidence_capture_manifest");
  if (rows.length > 1) fail("service_role_exact_evidence_capture_manifest_conflict");
  if (rows.length === 0) return false;
  validateArtifactRow(rows[0], {
    sha256: manifest.sha256,
    runId: command.runId,
    kind: "service_role_exact_evidence_capture_manifest",
    artifact: manifest.artifact
  });
  return true;
}

async function verifyFinalRows(
  db: ServiceRoleMaterializationQueryable,
  command: ServiceRoleExactEvidenceCaptureCommand,
  manifest: Bound<ServiceRoleExactEvidenceCaptureManifestV1>,
  source: ServiceRoleMaterializationSource,
  transactionEvidence: ReadonlyMap<string, TronTransactionProviderEvidenceV1>,
  evaluation: Evaluation
): Promise<string | null> {
  const rows = (await captureRows(db, command, manifest)).filter((row) => row.kind !== "service_role_exact_evidence_capture_manifest");
  if (rows.length === 0) return null;
  if (!evaluation.receipt || rows.length !== 401) fail("service_role_exact_evidence_capture_artifact_conflict");
  const expected = [
    ...evaluation.poisoning.map((item) => ({ ...item, kind: "service_role_poisoning_disposition" })),
    ...evaluation.providerRisk.map((item) => ({ ...item, kind: "service_role_provider_risk_disposition" })),
    { ...evaluation.receipt, kind: "service_role_exact_evidence_capture" }
  ];
  const expectedByHash = new Map(expected.map((item) => [item.sha256, item]));
  for (const row of rows) {
    const item = expectedByHash.get(String(row.sha256));
    if (!item) fail("service_role_exact_evidence_capture_artifact_conflict");
    validateArtifactRow(row, { sha256: item.sha256, runId: command.runId, kind: item.kind, artifact: item.artifact });
  }
  if (new Set(rows.map((row) => String(row.sha256))).size !== expectedByHash.size) {
    fail("service_role_exact_evidence_capture_artifact_conflict");
  }
  const referenced = await db.query(
    "select count(*)::int count from unified_check_attempts where artifact_sha256=any($1::text[])",
    [[manifest.sha256, ...rows.map((row) => String(row.sha256))]]
  );
  if (Number(referenced.rows[0]?.count) !== 0) fail("service_role_exact_evidence_capture_artifact_referenced");
  validateServiceRoleExactEvidenceCaptureReceiptV1({
    manifest,
    receipt: evaluation.receipt,
    acceptedEvents: source.acceptedHistory.events,
    transactionEvidence,
    poisoning: new Map(evaluation.poisoning.map((item) => [item.artifact.canonicalEventId, item])),
    providerRisk: new Map(evaluation.providerRisk.map((item) => [item.artifact.canonicalEventId, item]))
  });
  return evaluation.receipt.sha256;
}

async function loadState(
  db: ServiceRoleMaterializationQueryable,
  command: ServiceRoleExactEvidenceCaptureCommand,
  lock: boolean
) {
  const source = await loadServiceRoleMaterializationSource(db, command, lock);
  const manifest = manifestFor(source, command);
  const transactionEvidence = await loadEvidence(db, manifest);
  const evaluation = evaluateServiceRoleExactEvidenceCaptureV1({
    manifest,
    acceptedEvents: source.acceptedHistory.events,
    transactionEvidence
  });
  await verifyManifestRows(db, command, manifest);
  const receiptSha256 = await verifyFinalRows(db, command, manifest, source, transactionEvidence, evaluation);
  return { source, manifest, transactionEvidence, evaluation, receiptSha256 };
}

function result(
  state: Awaited<ReturnType<typeof loadState>>,
  providerLogicalRequests: number,
  completedReceiptSha256: string | null
): ServiceRoleExactEvidenceCaptureRunResult {
  return {
    classification: completedReceiptSha256 === null ? "incomplete" : "complete",
    coverage: {
      ...state.evaluation.coverage,
      completedReceiptSha256
    },
    captureManifestSha256: state.manifest.sha256,
    completedReceiptSha256,
    providerLogicalRequests
  };
}

async function persistManifest(
  db: ServiceRoleExactEvidenceCaptureDatabase,
  command: ServiceRoleExactEvidenceCaptureCommand,
  manifest: Bound<ServiceRoleExactEvidenceCaptureManifestV1>
): Promise<void> {
  await db.transaction("read_write", async (tx) => {
    const exists = await verifyManifestRows(tx, command, manifest);
    if (!exists) {
      const row = await insertUnifiedArtifact(tx as UnifiedQueryable, {
        sha256: manifest.sha256,
        createdByRunId: command.runId,
        kind: "service_role_exact_evidence_capture_manifest",
        schemaVersion: "1",
        artifact: manifest.artifact
      });
      validateArtifactRow(row, {
        sha256: manifest.sha256,
        runId: command.runId,
        kind: "service_role_exact_evidence_capture_manifest",
        artifact: manifest.artifact
      });
    }
  });
}

function requireProviderPayload(payload: unknown): Record<string, unknown> {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload) ||
    typeof (payload as Record<string, unknown>).riskTransaction !== "boolean") {
    fail("service_role_exact_evidence_capture_provider_schema_invalid");
  }
  return payload as Record<string, unknown>;
}

function isExhaustedProviderFailure(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (error instanceof TypeError) return true;
  if (error === null || typeof error !== "object") return false;
  const failure = error as { code?: unknown; status?: unknown };
  if (failure.code === "PROVIDER_UNAVAILABLE") return true;
  return typeof failure.status === "number" && (
    failure.status === 408 || failure.status === 429 || (failure.status >= 500 && failure.status <= 599)
  );
}

async function finalize(
  db: ServiceRoleExactEvidenceCaptureDatabase,
  command: ServiceRoleExactEvidenceCaptureCommand,
  expected: Awaited<ReturnType<typeof loadState>>
): Promise<string> {
  return db.transaction("read_write", async (tx) => {
    const current = await loadState(tx, command, true);
    if (current.manifest.sha256 !== expected.manifest.sha256 ||
      fingerprintCanonicalArtifact(current.evaluation.coverage) !== fingerprintCanonicalArtifact(expected.evaluation.coverage) ||
      !current.evaluation.receipt || current.evaluation.receipt.sha256 !== expected.evaluation.receipt?.sha256) {
      fail("service_role_exact_evidence_capture_recheck_conflict");
    }
    for (const item of current.evaluation.poisoning) {
      const row = await insertUnifiedArtifact(tx as UnifiedQueryable, {
        sha256: item.sha256,
        createdByRunId: command.runId,
        kind: "service_role_poisoning_disposition",
        schemaVersion: "1",
        artifact: item.artifact
      });
      validateArtifactRow(row, { sha256: item.sha256, runId: command.runId, kind: "service_role_poisoning_disposition", artifact: item.artifact });
    }
    for (const item of current.evaluation.providerRisk) {
      const row = await insertUnifiedArtifact(tx as UnifiedQueryable, {
        sha256: item.sha256,
        createdByRunId: command.runId,
        kind: "service_role_provider_risk_disposition",
        schemaVersion: "1",
        artifact: item.artifact
      });
      validateArtifactRow(row, { sha256: item.sha256, runId: command.runId, kind: "service_role_provider_risk_disposition", artifact: item.artifact });
    }
    const receipt = current.evaluation.receipt;
    const receiptRow = await insertUnifiedArtifact(tx as UnifiedQueryable, {
      sha256: receipt.sha256,
      createdByRunId: command.runId,
      kind: "service_role_exact_evidence_capture",
      schemaVersion: "1",
      artifact: receipt.artifact
    });
    validateArtifactRow(receiptRow, { sha256: receipt.sha256, runId: command.runId, kind: "service_role_exact_evidence_capture", artifact: receipt.artifact });
    const hashes = [
      current.manifest.sha256,
      ...current.evaluation.poisoning.map((item) => item.sha256),
      ...current.evaluation.providerRisk.map((item) => item.sha256),
      receipt.sha256
    ];
    const referenced = await tx.query(
      "select count(*)::int count from unified_check_attempts where artifact_sha256=any($1::text[])",
      [hashes]
    );
    if (Number(referenced.rows[0]?.count) !== 0) fail("service_role_exact_evidence_capture_artifact_referenced");
    await verifyFinalRows(tx, command, current.manifest, current.source, current.transactionEvidence, current.evaluation);
    return receipt.sha256;
  });
}

export async function runServiceRoleExactEvidenceCapture(
  db: ServiceRoleExactEvidenceCaptureDatabase,
  command: ServiceRoleExactEvidenceCaptureCommand,
  deps: ServiceRoleExactEvidenceCaptureDependencies
): Promise<ServiceRoleExactEvidenceCaptureRunResult> {
  validateCommand(command);
  const initial = await db.transaction("read_only", (tx) => loadState(tx, command, false));
  if (command.mode === "audit") return result(initial, 0, initial.receiptSha256);

  await persistManifest(db, command, initial.manifest);
  let current = await loadState(db, command, false);
  const existingInvalid = current.evaluation.coverage.missingTransactionHashes
    .filter((txHash) => current.transactionEvidence.has(txHash));
  if (existingInvalid.length !== 0) fail("service_role_exact_evidence_capture_existing_evidence_invalid");
  let providerLogicalRequests = 0;
  // ponytail: V1 trades parallel speed for bounded resumability; scheduler-owned concurrency is the upgrade path if measured operator time requires it.
  for (const txHash of [...new Set(current.evaluation.coverage.missingTransactionHashes)].sort()) {
    providerLogicalRequests += 1;
    let payload: unknown;
    try {
      payload = await deps.getTransaction(txHash);
    } catch (error) {
      if (!isExhaustedProviderFailure(error)) throw error;
      continue;
    }
    const permanent = buildTransactionProviderEvidenceV1({
      identity: identity(txHash),
      payload: requireProviderPayload(payload),
      fetchedAt: deps.now().toISOString(),
      movement: null
    });
    await saveTransactionProviderEvidence(db as any, permanent);
  }
  current = await loadState(db, command, false);
  if (!current.evaluation.receipt) return result(current, providerLogicalRequests, null);
  const completedReceiptSha256 = await finalize(db, command, current);
  return result(current, providerLogicalRequests, completedReceiptSha256);
}

function pgDatabase(pool: pg.Pool): ServiceRoleExactEvidenceCaptureDatabase {
  return {
    query: (sql, values) => pool.query(sql, values as unknown[] | undefined),
    async transaction<T>(mode: "read_only" | "read_write", work: (tx: ServiceRoleMaterializationQueryable) => Promise<T>) {
      const client = await pool.connect();
      const query = (sql: string, values?: readonly unknown[]) => client.query(sql, values as unknown[] | undefined);
      try {
        await client.query(mode === "read_only"
          ? "begin isolation level repeatable read read only"
          : "begin isolation level serializable read write");
        const value = await work({ query });
        await client.query("commit");
        return value;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

async function main(): Promise<void> {
  const command = parseServiceRoleExactEvidenceCaptureArgs(process.argv.slice(2));
  const config = loadConfig();
  const scheduler = createTronscanScheduler({
    requestMinIntervalMs: config.tronscanRequestMinIntervalMs,
    globalRequestMinIntervalMs: config.tronscanGlobalRequestMinIntervalMs,
    rateLimitCooldownMs: config.tronscanRateLimitCooldownMs,
    endpointMinIntervalMs: {
      transfer: config.tronscanTransferRequestMinIntervalMs,
      approval: config.tronscanApprovalRequestMinIntervalMs,
      contract: config.tronscanContractRequestMinIntervalMs,
      fullnode: config.tronscanFullNodeRequestMinIntervalMs,
      trongrid: config.tronGridRequestMinIntervalMs
    },
    apiKeys: config.tronscanApiKeys,
    apiKeyGroups: config.tronscanApiKeyGroups,
    accountGroupRequestMinIntervalMs: config.tronscanAccountGroupRequestMinIntervalMs,
    maxInFlight: config.tronscanMaxInFlight,
    maxInFlightPerGroup: config.tronscanGroupMaxInFlight,
    providerFailureCircuitThreshold: 3,
    providerCircuitOpenMs: config.tronscanRateLimitCooldownMs
  });
  const tronClient = new TronscanClient({
    baseUrl: config.tronscanBaseUrl,
    fullNodeBaseUrl: config.tronFullNodeBaseUrl,
    apiKey: config.tronscanApiKeys,
    fullNodeApiKey: config.tronFullNodeApiKey,
    timeoutMs: config.tronscanTimeoutMs,
    retryAttempts: config.tronscanRetryAttempts,
    retryBaseDelayMs: config.tronscanRetryBaseDelayMs,
    requestMinIntervalMs: config.tronscanRequestMinIntervalMs,
    rateLimitCooldownMs: config.tronscanRateLimitCooldownMs,
    scheduler,
    schedulerDedupeNamespace: "service_role_exact_evidence_capture"
  });
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 2 });
  try {
    const captured = await runServiceRoleExactEvidenceCapture(pgDatabase(pool), command, {
      getTransaction: tronClient.getTransaction.bind(tronClient),
      now: () => new Date()
    });
    process.stdout.write(`${canonicalizeArtifactJson(captured.coverage)}\n`);
    process.exitCode = captured.classification === "complete" ? 0 : 2;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "service_role_exact_evidence_capture_failed"}\n`);
    process.exitCode = 1;
  });
}
