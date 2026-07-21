import { createHash } from "node:crypto";
import {
  validateTask0BReleaseFreezeEvidence,
  validateTask0BReleaseRevalidationEvidence
} from "./remediationReleaseManifest";

export type TerminalLegacyPopulationV1 = {
  candidateSha: string;
  cutoff: string;
  cutoffSource: "task0b_release_freeze";
  task0bEvidenceSha256: string;
  databaseRole: "runtime_sanitized";
  databaseName: "tron_watch_plan5_runtime_sanitized";
  databaseFingerprintSha256: string;
  terminalStatuses: ["completed", "failed", "cancelled"];
  populationCount: number;
  sortedJobIdSetSha256: string;
  aggregateImmutableResultSha256: string;
  sentFingerprintSetSha256: string;
  queryTemplateSha256: string;
};

export type TerminalLegacyPopulationRow = {
  id: string;
  kind: string;
  status: "completed" | "failed" | "cancelled";
  completedAt: string | null;
  resultJsonText: string;
  sentFingerprint: string | null;
};

export type TerminalLegacyQueryable = {
  query(text: string, values: unknown[]): Promise<{ rows: unknown[] }>;
};

export type TerminalLegacyFreezeBinding = {
  candidateSha: string;
  cutoff: string;
  cutoffSource: "task0b_release_freeze";
  task0bEvidenceSha256: string;
  databaseRole: "runtime_sanitized";
  databaseName: "tron_watch_plan5_runtime_sanitized";
  databaseFingerprintSha256: string;
};

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const TERMINAL_STATUSES = ["completed", "failed", "cancelled"] as const;
const CURRENT_POLICY_VERSION = "scoring-signal-matrix-v3";

export const TERMINAL_LEGACY_POPULATION_QUERY = `select
    id,
    kind,
    status,
    completed_at as "completedAt",
    result_json::text as "resultJsonText",
    case
      when progress_json#>>'{telegramDelivery,state,status}' = 'sent'
      then progress_json#>>'{telegramDelivery,state,messageFingerprint}'
      else null
    end as "sentFingerprint"
  from forensic_check_jobs
  where status = any(array['completed', 'failed', 'cancelled']::text[])
    and created_at <= $1::timestamptz
    and coalesce(result_json->>'scoringPolicyVersion', '') <> $2
  order by id asc`;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalJson(value: unknown, active = new WeakSet<object>()): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("terminal legacy JSON contains a non-finite number");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") throw new Error("terminal legacy JSON contains an unsupported value");
  if (active.has(value)) throw new Error("terminal legacy JSON contains a cycle");
  active.add(value);
  try {
    if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item, active)).join(",")}]`;
    if (!isPlainRecord(value)) throw new Error("terminal legacy JSON must contain plain objects");
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], active)}`).join(",")}}`;
  } finally {
    active.delete(value);
  }
}

function exactIso(value: unknown, label: string): string {
  const normalized = value instanceof Date ? value.toISOString() : value;
  if (typeof normalized !== "string" || new Date(normalized).toISOString() !== normalized) throw new Error(`${label} is invalid`);
  return normalized;
}

function parseRow(value: unknown, index: number): TerminalLegacyPopulationRow {
  if (!isPlainRecord(value)) throw new Error(`terminal legacy row ${index} is invalid`);
  const { id, kind, status, completedAt, resultJsonText, sentFingerprint } = value;
  if (typeof id !== "string" || id.length === 0 || id.length > 512) throw new Error(`terminal legacy row ${index} id is invalid`);
  if (typeof kind !== "string" || kind.length === 0 || kind.length > 128) throw new Error(`terminal legacy row ${index} kind is invalid`);
  if (!(TERMINAL_STATUSES as readonly unknown[]).includes(status)) throw new Error(`terminal legacy row ${index} status is invalid`);
  const normalizedCompletedAt = completedAt === null ? null : exactIso(completedAt, `terminal legacy row ${index} completedAt`);
  if (typeof resultJsonText !== "string" || resultJsonText.length === 0) throw new Error(`terminal legacy row ${index} result JSON text is invalid`);
  if (sentFingerprint !== null && (typeof sentFingerprint !== "string" || !SHA256.test(sentFingerprint))) {
    throw new Error(`terminal legacy row ${index} sent fingerprint is invalid`);
  }
  return { id, kind, status: status as TerminalLegacyPopulationRow["status"], completedAt: normalizedCompletedAt, resultJsonText, sentFingerprint: sentFingerprint as string | null };
}

function parseSnapshot(value: unknown, label: string): TerminalLegacyPopulationV1 {
  if (!isPlainRecord(value)) throw new Error(`${label} is invalid`);
  const expectedKeys = [
    "candidateSha", "cutoff", "cutoffSource", "task0bEvidenceSha256", "databaseRole", "databaseName",
    "databaseFingerprintSha256", "terminalStatuses", "populationCount", "sortedJobIdSetSha256",
    "aggregateImmutableResultSha256", "sentFingerprintSetSha256", "queryTemplateSha256"
  ].sort();
  if (Object.keys(value).sort().join("|") !== expectedKeys.join("|")) throw new Error(`${label} fields are invalid`);
  if (typeof value.candidateSha !== "string" || !SHA40.test(value.candidateSha)) throw new Error(`${label} candidate SHA is invalid`);
  const cutoff = exactIso(value.cutoff, `${label} cutoff`);
  if (value.cutoffSource !== "task0b_release_freeze" || value.databaseRole !== "runtime_sanitized"
      || value.databaseName !== "tron_watch_plan5_runtime_sanitized") throw new Error(`${label} freeze binding is invalid`);
  for (const field of ["task0bEvidenceSha256", "databaseFingerprintSha256"] as const) {
    if (typeof value[field] !== "string" || !SHA256.test(value[field] as string)) throw new Error(`${label} ${field} is invalid`);
  }
  if (!Array.isArray(value.terminalStatuses) || canonicalJson(value.terminalStatuses) !== canonicalJson(TERMINAL_STATUSES)) {
    throw new Error(`${label} terminal statuses are invalid`);
  }
  if (!Number.isSafeInteger(value.populationCount) || (value.populationCount as number) < 0) throw new Error(`${label} population count is invalid`);
  for (const field of ["sortedJobIdSetSha256", "aggregateImmutableResultSha256", "sentFingerprintSetSha256", "queryTemplateSha256"] as const) {
    if (typeof value[field] !== "string" || !SHA256.test(value[field] as string)) throw new Error(`${label} ${field} is invalid`);
  }
  if (value.queryTemplateSha256 !== sha256(TERMINAL_LEGACY_POPULATION_QUERY)) {
    throw new Error(`${label} query template is not current`);
  }
  return {
    candidateSha: value.candidateSha,
    cutoff,
    cutoffSource: "task0b_release_freeze",
    task0bEvidenceSha256: value.task0bEvidenceSha256 as string,
    databaseRole: "runtime_sanitized",
    databaseName: "tron_watch_plan5_runtime_sanitized",
    databaseFingerprintSha256: value.databaseFingerprintSha256 as string,
    terminalStatuses: [...TERMINAL_STATUSES],
    populationCount: value.populationCount as number,
    sortedJobIdSetSha256: value.sortedJobIdSetSha256 as string,
    aggregateImmutableResultSha256: value.aggregateImmutableResultSha256 as string,
    sentFingerprintSetSha256: value.sentFingerprintSetSha256 as string,
    queryTemplateSha256: value.queryTemplateSha256 as string
  };
}

export function validateTerminalLegacyPopulation(value: unknown): TerminalLegacyPopulationV1 {
  return parseSnapshot(value, "terminal legacy population");
}

export function createTerminalLegacyPopulationSnapshot(
  sourceRows: readonly unknown[],
  options: TerminalLegacyFreezeBinding
): TerminalLegacyPopulationV1 {
  if (!SHA40.test(options.candidateSha)) throw new Error("terminal legacy candidate SHA is invalid");
  const cutoff = exactIso(options.cutoff, "terminal legacy cutoff");
  if (options.cutoffSource !== "task0b_release_freeze" || options.databaseRole !== "runtime_sanitized"
      || options.databaseName !== "tron_watch_plan5_runtime_sanitized"
      || !SHA256.test(options.task0bEvidenceSha256) || !SHA256.test(options.databaseFingerprintSha256)) {
    throw new Error("terminal legacy freeze binding is invalid");
  }
  const rows = sourceRows.map(parseRow).sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error("terminal legacy population contains duplicate job ids");
  const sentFingerprints = [...new Set(rows.flatMap((row) => row.sentFingerprint === null ? [] : [row.sentFingerprint]))].sort();
  return {
    candidateSha: options.candidateSha,
    cutoff,
    cutoffSource: options.cutoffSource,
    task0bEvidenceSha256: options.task0bEvidenceSha256,
    databaseRole: options.databaseRole,
    databaseName: options.databaseName,
    databaseFingerprintSha256: options.databaseFingerprintSha256,
    terminalStatuses: [...TERMINAL_STATUSES],
    populationCount: rows.length,
    sortedJobIdSetSha256: sha256(canonicalJson(rows.map((row) => row.id))),
    aggregateImmutableResultSha256: sha256(canonicalJson(rows.map(({ id, kind, status, completedAt, resultJsonText }) => ({
      id, kind, status, completedAt, resultJsonText
    })))),
    sentFingerprintSetSha256: sha256(canonicalJson(sentFingerprints)),
    queryTemplateSha256: sha256(TERMINAL_LEGACY_POPULATION_QUERY)
  };
}

export async function snapshotTerminalLegacyPopulation(
  db: TerminalLegacyQueryable,
  options: TerminalLegacyFreezeBinding
): Promise<TerminalLegacyPopulationV1> {
  const result = await db.query(TERMINAL_LEGACY_POPULATION_QUERY, [options.cutoff, CURRENT_POLICY_VERSION]);
  return createTerminalLegacyPopulationSnapshot(result.rows, options);
}

export function deriveTerminalLegacyFreezeBinding(
  task0bEvidenceBytes: Buffer,
  expectedCandidateSha: string,
  evaluatedAt: string
): TerminalLegacyFreezeBinding {
  const parsed = JSON.parse(task0bEvidenceBytes.toString("utf8")) as unknown;
  const evidence = validateTask0BReleaseFreezeEvidence(parsed, expectedCandidateSha, evaluatedAt);
  return {
    candidateSha: evidence.candidateSha,
    cutoff: evidence.freezeCutoff,
    cutoffSource: "task0b_release_freeze",
    task0bEvidenceSha256: createHash("sha256").update(task0bEvidenceBytes).digest("hex"),
    databaseRole: evidence.databaseRole,
    databaseName: evidence.databaseName,
    databaseFingerprintSha256: evidence.databaseFingerprintSha256
  };
}

export function deriveTerminalLegacyFreezeBindingFromCurrentRevalidation(
  task0bEvidenceBytes: Buffer,
  expectedCandidateSha: string,
  revalidationEvidence: unknown,
  releaseFreezeIdentity: unknown,
  evaluatedAt: string
): TerminalLegacyFreezeBinding {
  const parsed = JSON.parse(task0bEvidenceBytes.toString("utf8")) as unknown;
  const evidence = validateTask0BReleaseFreezeEvidence(parsed, expectedCandidateSha);
  validateTask0BReleaseRevalidationEvidence(
    revalidationEvidence,
    evidence,
    releaseFreezeIdentity,
    evaluatedAt
  );
  return {
    candidateSha: evidence.candidateSha,
    cutoff: evidence.freezeCutoff,
    cutoffSource: "task0b_release_freeze",
    task0bEvidenceSha256: createHash("sha256").update(task0bEvidenceBytes).digest("hex"),
    databaseRole: evidence.databaseRole,
    databaseName: evidence.databaseName,
    databaseFingerprintSha256: evidence.databaseFingerprintSha256
  };
}

export function assertTerminalLegacyPopulationUnchanged(beforeValue: unknown, afterValue: unknown): void {
  const before = parseSnapshot(beforeValue, "before terminal legacy population");
  const after = parseSnapshot(afterValue, "after terminal legacy population");
  for (const field of [
    "candidateSha", "cutoff", "cutoffSource", "task0bEvidenceSha256", "databaseRole", "databaseName",
    "databaseFingerprintSha256", "terminalStatuses", "populationCount", "sortedJobIdSetSha256",
    "aggregateImmutableResultSha256", "sentFingerprintSetSha256", "queryTemplateSha256"
  ] as const) {
    if (canonicalJson(before[field]) !== canonicalJson(after[field])) throw new Error(`terminal legacy population changed: ${field}`);
  }
}
