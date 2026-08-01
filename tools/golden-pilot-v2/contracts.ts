import { posix, win32 } from "node:path";
import { TronWeb } from "tronweb";

export type GoldenCaseGroup =
  | "blind_review"
  | "regression"
  | "synthetic_property_performance";

export type AttributionPolicy = "fifo" | "lifo" | "proportional";
export type GoldenDecision = "ACCEPTABLE" | "REVIEW" | "DECLINE";

export type GoldenCaseDescriptor = {
  caseId: string;
  group: GoldenCaseGroup;
  subjectAddress: string;
  sourceArtifact: string;
  requiredProperties: string[];
};

export type GoldenProtocolV2 = {
  version: "golden-pilot-protocol-v2";
  reviewersRequired: 2;
  attributionCandidates: ["fifo", "lifo", "proportional"];
  exactScoresAllowedBeforeAdjudication: false;
  allowedDecisions: ["ACCEPTABLE", "REVIEW", "DECLINE"];
  canonicalFactKeyVersion: "canonical-fact-key-v1";
  comparatorContractVersion: "unified-wallet-comparator-v1";
};

export type GoldenCaseCatalogV2 = {
  version: "golden-case-catalog-v2";
  groups: Array<{
    kind: GoldenCaseGroup;
    caseIds: string[];
  }>;
  cases: GoldenCaseDescriptor[];
};

export type SyntheticCaseSeedV2 = {
  caseId: string;
  subjectAddress: string;
  amountRaw: string;
  timestamp: string;
  txHash: string;
};

export type SyntheticCasesV2 = {
  version: "golden-synthetic-cases-v2";
  cases: SyntheticCaseSeedV2[];
};

const CASE_GROUPS: readonly GoldenCaseGroup[] = [
  "blind_review",
  "regression",
  "synthetic_property_performance"
];

const REQUIRED_PROPERTIES = new Set([
  "scope_wallet",
  "scope_selected_amount",
  "scope_incoming_deposit",
  "scope_route",
  "scope_history",
  "empty_wallet",
  "new_wallet_no_usdt",
  "one_legitimate_transfer",
  "unknown_sources_without_pattern",
  "direct_blacklist_exposure_1pct",
  "bybit_99pct_plus_hard_evidence",
  "dangerous_approval_without_debit",
  "confirmed_victim_debit",
  "old_active_operational_wallet",
  "dust_spam",
  "dense_fan_in_fan_out",
  "direct_history_500_pages",
  "duplicate_evidence_idempotent",
  "reordered_evidence_idempotent",
  "restart_deterministic",
  "provider_key_exhaustion",
  "ambiguous_delivery"
]);

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("golden_expected_object");
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[]
): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new TypeError(`golden_unknown_key:${key}`);
    }
  }
  for (const key of keys) {
    if (!(key in value)) {
      throw new TypeError(`golden_missing_key:${key}`);
    }
  }
}

function string(value: unknown, error: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(error);
  }
  return value;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError("golden_expected_array");
  }
  return value;
}

function literal<T extends string | number | boolean>(
  value: unknown,
  expected: T,
  error: string
): T {
  if (value !== expected) {
    throw new TypeError(error);
  }
  return expected;
}

function literalArray<T extends string>(
  value: unknown,
  expected: readonly T[],
  error: string
): T[] {
  const values = array(value);
  if (
    values.length !== expected.length ||
    values.some((item, index) => item !== expected[index])
  ) {
    throw new TypeError(error);
  }
  return [...expected];
}

function caseId(value: unknown): string {
  const result = string(value, "golden_invalid_case_id");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(result)) {
    throw new TypeError("golden_invalid_case_id");
  }
  return result;
}

function tronAddress(value: unknown): string {
  const result = string(value, "golden_invalid_tron_address");
  if (!TronWeb.isAddress(result)) {
    throw new TypeError("golden_invalid_tron_address");
  }
  return result;
}

function relativeArtifactPath(value: unknown): string {
  const result = string(value, "golden_invalid_artifact_path");
  if (
    result.includes("\\") ||
    posix.isAbsolute(result) ||
    win32.isAbsolute(result) ||
    posix.normalize(result) !== result ||
    result.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new TypeError("golden_invalid_artifact_path");
  }
  return result;
}

function decimalString(value: unknown): string {
  const result = string(value, "golden_invalid_decimal_string");
  if (!/^(?:0|[1-9][0-9]*)$/u.test(result)) {
    throw new TypeError("golden_invalid_decimal_string");
  }
  return result;
}

function isoUtcTimestamp(value: unknown): string {
  const result = string(value, "golden_invalid_iso_utc_timestamp");
  const parsed = Date.parse(result);
  const normalizedInput = result.endsWith("Z") && !result.includes(".")
    ? result.replace(/Z$/u, ".000Z")
    : result;
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(result) ||
    Number.isNaN(parsed) ||
    new Date(parsed).toISOString() !== normalizedInput
  ) {
    throw new TypeError("golden_invalid_iso_utc_timestamp");
  }
  return result;
}

function lowercaseTxHash(value: unknown): string {
  const result = string(value, "golden_invalid_lowercase_tx_hash");
  if (!/^[0-9a-f]{64}$/u.test(result)) {
    throw new TypeError("golden_invalid_lowercase_tx_hash");
  }
  return result;
}

function parseCaseGroup(value: unknown): GoldenCaseGroup {
  if (
    typeof value !== "string" ||
    !CASE_GROUPS.includes(value as GoldenCaseGroup)
  ) {
    throw new TypeError("golden_invalid_case_group");
  }
  return value as GoldenCaseGroup;
}

function uniqueCaseIds(values: string[]): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new TypeError(`golden_duplicate_case_id:${value}`);
    }
    seen.add(value);
  }
}

function parseCaseDescriptor(value: unknown): GoldenCaseDescriptor {
  const source = record(value);
  exactKeys(source, [
    "caseId",
    "group",
    "subjectAddress",
    "sourceArtifact",
    "requiredProperties"
  ]);
  const requiredProperties = array(source.requiredProperties).map((item) =>
    string(item, "golden_invalid_required_property")
  );
  const seenProperties = new Set<string>();
  for (const property of requiredProperties) {
    if (!REQUIRED_PROPERTIES.has(property)) {
      throw new TypeError(`golden_unknown_required_property:${property}`);
    }
    if (seenProperties.has(property)) {
      throw new TypeError(`golden_duplicate_required_property:${property}`);
    }
    seenProperties.add(property);
  }
  return {
    caseId: caseId(source.caseId),
    group: parseCaseGroup(source.group),
    subjectAddress: tronAddress(source.subjectAddress),
    sourceArtifact: relativeArtifactPath(source.sourceArtifact),
    requiredProperties
  };
}

export function parseGoldenProtocolV2(value: unknown): GoldenProtocolV2 {
  const source = record(value);
  exactKeys(source, [
    "version",
    "reviewersRequired",
    "attributionCandidates",
    "exactScoresAllowedBeforeAdjudication",
    "allowedDecisions",
    "canonicalFactKeyVersion",
    "comparatorContractVersion"
  ]);
  return {
    version: literal(
      source.version,
      "golden-pilot-protocol-v2",
      "golden_invalid_protocol_version"
    ),
    reviewersRequired: literal(
      source.reviewersRequired,
      2,
      "golden_invalid_reviewer_count"
    ),
    attributionCandidates: literalArray(
      source.attributionCandidates,
      ["fifo", "lifo", "proportional"] as const,
      "golden_invalid_attribution_candidates"
    ) as ["fifo", "lifo", "proportional"],
    exactScoresAllowedBeforeAdjudication: literal(
      source.exactScoresAllowedBeforeAdjudication,
      false,
      "golden_exact_scores_forbidden_before_adjudication"
    ),
    allowedDecisions: literalArray(
      source.allowedDecisions,
      ["ACCEPTABLE", "REVIEW", "DECLINE"] as const,
      "golden_invalid_allowed_decisions"
    ) as ["ACCEPTABLE", "REVIEW", "DECLINE"],
    canonicalFactKeyVersion: literal(
      source.canonicalFactKeyVersion,
      "canonical-fact-key-v1",
      "golden_invalid_fact_key_version"
    ),
    comparatorContractVersion: literal(
      source.comparatorContractVersion,
      "unified-wallet-comparator-v1",
      "golden_invalid_comparator_contract_version"
    )
  };
}

export function parseGoldenCaseCatalogV2(
  value: unknown
): GoldenCaseCatalogV2 {
  const source = record(value);
  exactKeys(source, ["version", "groups", "cases"]);
  const groups = array(source.groups).map((item) => {
    const group = record(item);
    exactKeys(group, ["kind", "caseIds"]);
    return {
      kind: parseCaseGroup(group.kind),
      caseIds: array(group.caseIds).map(caseId)
    };
  });
  if (
    groups.length !== CASE_GROUPS.length ||
    groups.some((group, index) => group.kind !== CASE_GROUPS[index])
  ) {
    throw new TypeError("golden_invalid_case_group_order");
  }

  const groupedIds = groups.flatMap((group) => group.caseIds);
  uniqueCaseIds(groupedIds);
  const cases = array(source.cases).map(parseCaseDescriptor);
  uniqueCaseIds(cases.map((item) => item.caseId));
  const byId = new Map(cases.map((item) => [item.caseId, item]));
  if (groupedIds.length !== cases.length) {
    throw new TypeError("golden_case_catalog_membership_mismatch");
  }
  for (const group of groups) {
    for (const id of group.caseIds) {
      if (byId.get(id)?.group !== group.kind) {
        throw new TypeError(`golden_case_catalog_membership_mismatch:${id}`);
      }
    }
  }

  return {
    version: literal(
      source.version,
      "golden-case-catalog-v2",
      "golden_invalid_case_catalog_version"
    ),
    groups,
    cases
  };
}

export function parseSyntheticCasesV2(value: unknown): SyntheticCasesV2 {
  const source = record(value);
  exactKeys(source, ["version", "cases"]);
  const cases = array(source.cases).map((item) => {
    const seed = record(item);
    exactKeys(seed, [
      "caseId",
      "subjectAddress",
      "amountRaw",
      "timestamp",
      "txHash"
    ]);
    return {
      caseId: caseId(seed.caseId),
      subjectAddress: tronAddress(seed.subjectAddress),
      amountRaw: decimalString(seed.amountRaw),
      timestamp: isoUtcTimestamp(seed.timestamp),
      txHash: lowercaseTxHash(seed.txHash)
    };
  });
  uniqueCaseIds(cases.map((item) => item.caseId));
  return {
    version: literal(
      source.version,
      "golden-synthetic-cases-v2",
      "golden_invalid_synthetic_cases_version"
    ),
    cases
  };
}
