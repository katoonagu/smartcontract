import { TronWeb } from "tronweb";
import {
  publishArtifactOnce,
  type PublishedArtifact
} from "./artifactStore";
import { canonicalJson, canonicalSha256 } from "./canonicalJson";

export type NeutralEvidenceBundleV2 = {
  version: "neutral-evidence-bundle-v2";
  caseId: string;
  subjectAddress: string;
  snapshot: {
    chain: "tron";
    confirmedBlockNumber: string;
    confirmedBlockHash: string;
    timestamp: string;
    labelDatasetSha256: string;
  };
  events: Array<{
    txHash: string;
    eventIndex: string;
    tokenContract: string;
    from: string;
    to: string;
    amountRaw: string;
    timestamp: string;
    blockNumber: string;
    factType: string;
  }>;
  stateFacts: Array<{
    factType: string;
    subject: string;
    object: string | null;
    role: string;
    effectiveAt: string;
    evidenceRefs: string[];
  }>;
  labels: Array<{
    address: string;
    label: string;
    category: string;
    authority: string;
    validFrom: string | null;
    validTo: string | null;
    evidenceRefs: string[];
  }>;
  approvals: Array<{
    owner: string;
    spender: string;
    tokenContract: string;
    amountRaw: string;
    txHash: string;
    eventIndex: string;
    timestamp: string;
  }>;
};

export type FrozenEvidenceSourceV2 = Omit<
  NeutralEvidenceBundleV2,
  "version"
> & {
  version: "frozen-evidence-source-v2";
};

export type NeutralExportReceiptV2 = {
  version: "neutral-export-validator-receipt-v2";
  caseId: string;
  forbiddenFieldMatches: [];
  forbiddenValueMatches: [];
  systemNarrativePresent: false;
  systemScorePresent: false;
  fieldInventory: string[];
  fieldInventorySha256: string;
};

export type NeutralExportManifestV2 = {
  version: "neutral-export-manifest-v2";
  caseId: string;
  sourceSnapshot: {
    chain: "tron";
    blockNumber: string;
    blockHash: string;
    timestamp: string;
  };
  exporterVersion: "golden-neutral-export-v2";
  runtimeVersion: string;
  schemaSha256: string;
  labelDatasetSha256: string;
  sourceCanonicalSha256: string;
  contentSha256: string;
  validatorReceiptSha256: string;
  rawEvidenceInventory: Array<{
    kind: "approvals" | "events" | "labels" | "stateFacts";
    count: number;
    sha256: string;
  }>;
};

export type NeutralExportResultV2 = {
  bundle: NeutralEvidenceBundleV2;
  manifest: NeutralExportManifestV2;
  receipt: NeutralExportReceiptV2;
};

const FORBIDDEN_NEUTRAL_KEYS = new Set([
  "score",
  "riskscore",
  "finalscore",
  "decision",
  "finaldecision",
  "risklevel",
  "riskband",
  "matrixrow",
  "narrative",
  "recommendation",
  "systemoutput",
  "telegramhtml",
  "scoreanchor"
]);

const FORBIDDEN_VALUE_MARKERS = [
  "scoring-signal-matrix-v",
  "score-anchor-v",
  "no_final_decision"
] as const;

const NEUTRAL_SCHEMA = {
  version: "neutral-evidence-bundle-v2",
  fields: [
    "caseId",
    "subjectAddress",
    "snapshot.chain",
    "snapshot.confirmedBlockNumber",
    "snapshot.confirmedBlockHash",
    "snapshot.timestamp",
    "snapshot.labelDatasetSha256",
    "events[].txHash",
    "events[].eventIndex",
    "events[].tokenContract",
    "events[].from",
    "events[].to",
    "events[].amountRaw",
    "events[].timestamp",
    "events[].blockNumber",
    "events[].factType",
    "stateFacts[].factType",
    "stateFacts[].subject",
    "stateFacts[].object",
    "stateFacts[].role",
    "stateFacts[].effectiveAt",
    "stateFacts[].evidenceRefs[]",
    "labels[].address",
    "labels[].label",
    "labels[].category",
    "labels[].authority",
    "labels[].validFrom",
    "labels[].validTo",
    "labels[].evidenceRefs[]",
    "approvals[].owner",
    "approvals[].spender",
    "approvals[].tokenContract",
    "approvals[].amountRaw",
    "approvals[].txHash",
    "approvals[].eventIndex",
    "approvals[].timestamp"
  ]
} as const;

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("golden_expected_object");
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError("golden_expected_array");
  }
  return value;
}

function asString(value: unknown, error: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(error);
  }
  return value;
}

function asNullableString(value: unknown, error: string): string | null {
  return value === null ? null : asString(value, error);
}

function asDecimal(value: unknown): string {
  const result = asString(value, "golden_invalid_decimal_string");
  if (!/^(?:0|[1-9][0-9]*)$/u.test(result)) {
    throw new TypeError("golden_invalid_decimal_string");
  }
  return result;
}

function asHash(value: unknown, error: string): string {
  const result = asString(value, error);
  if (!/^[0-9a-f]{64}$/u.test(result)) {
    throw new TypeError(error);
  }
  return result;
}

function asTimestamp(value: unknown): string {
  const result = asString(value, "golden_invalid_iso_utc_timestamp");
  const parsed = Date.parse(result);
  const normalizedInput =
    result.endsWith("Z") && !result.includes(".")
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

function asAddress(value: unknown): string {
  const result = asString(value, "golden_invalid_tron_address");
  if (!TronWeb.isAddress(result)) {
    throw new TypeError("golden_invalid_tron_address");
  }
  return result;
}

function asCaseId(value: unknown): string {
  const result = asString(value, "golden_invalid_case_id");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(result)) {
    throw new TypeError("golden_invalid_case_id");
  }
  return result;
}

function lexical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalOrder(left: unknown, right: unknown): number {
  return lexical(canonicalJson(left), canonicalJson(right));
}

function sortedUniqueStrings(value: unknown): string[] {
  const result = asArray(value).map((item) =>
    asString(item, "golden_invalid_evidence_ref")
  );
  const unique = new Set(result);
  if (unique.size !== result.length) {
    throw new TypeError("golden_duplicate_evidence_ref");
  }
  return [...unique].sort(lexical);
}

function normalizedKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/gu, "");
}

function scanSource(
  value: unknown,
  path: string,
  fields: Set<string>,
  seen: Set<object>
): void {
  if (typeof value === "string") {
    const normalizedValue = value.toLowerCase();
    for (const marker of FORBIDDEN_VALUE_MARKERS) {
      if (normalizedValue.includes(marker)) {
        throw new TypeError(`golden_forbidden_value:${marker}`);
      }
    }
    if (/🧾\s*\**проверка кошелька\**/iu.test(value)) {
      throw new TypeError("golden_forbidden_value:telegram_result_heading");
    }
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  if (seen.has(value)) {
    throw new TypeError("golden_cyclic_value");
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const itemPath = `${path}[]`;
      for (const item of value) {
        scanSource(item, itemPath, fields, seen);
      }
      return;
    }
    const source = value as Record<string, unknown>;
    for (const key of Object.keys(source).sort(lexical)) {
      if (FORBIDDEN_NEUTRAL_KEYS.has(normalizedKey(key))) {
        throw new TypeError(`golden_forbidden_field:${key}`);
      }
      const fieldPath = path.length === 0 ? key : `${path}.${key}`;
      fields.add(fieldPath);
      scanSource(source[key], fieldPath, fields, seen);
    }
  } finally {
    seen.delete(value);
  }
}

function compareEvents(
  left: NeutralEvidenceBundleV2["events"][number],
  right: NeutralEvidenceBundleV2["events"][number]
): number {
  const block = BigInt(left.blockNumber) - BigInt(right.blockNumber);
  if (block !== 0n) {
    return block < 0n ? -1 : 1;
  }
  return (
    lexical(left.txHash, right.txHash) ||
    (BigInt(left.eventIndex) < BigInt(right.eventIndex)
      ? -1
      : BigInt(left.eventIndex) > BigInt(right.eventIndex)
        ? 1
        : 0) ||
    lexical(left.factType, right.factType)
  );
}

function assertAtOrBeforeSnapshot(
  timestamp: string,
  snapshotTimestamp: string
): void {
  if (Date.parse(timestamp) > Date.parse(snapshotTimestamp)) {
    throw new TypeError("golden_evidence_after_snapshot");
  }
}

function projectSource(value: unknown): NeutralEvidenceBundleV2 {
  const source = asRecord(value);
  if (source.version !== "frozen-evidence-source-v2") {
    throw new TypeError("golden_invalid_frozen_source_version");
  }
  const snapshotSource = asRecord(source.snapshot);
  if (snapshotSource.chain !== "tron") {
    throw new TypeError("golden_invalid_chain");
  }
  const snapshot = {
    chain: "tron" as const,
    confirmedBlockNumber: asDecimal(snapshotSource.confirmedBlockNumber),
    confirmedBlockHash: asHash(
      snapshotSource.confirmedBlockHash,
      "golden_invalid_block_hash"
    ),
    timestamp: asTimestamp(snapshotSource.timestamp),
    labelDatasetSha256: asHash(
      snapshotSource.labelDatasetSha256,
      "golden_invalid_label_dataset_hash"
    )
  };

  const events = asArray(source.events).map((value) => {
    const event = asRecord(value);
    const result = {
      txHash: asHash(event.txHash, "golden_invalid_lowercase_tx_hash"),
      eventIndex: asDecimal(event.eventIndex),
      tokenContract: asAddress(event.tokenContract),
      from: asAddress(event.from),
      to: asAddress(event.to),
      amountRaw: asDecimal(event.amountRaw),
      timestamp: asTimestamp(event.timestamp),
      blockNumber: asDecimal(event.blockNumber),
      factType: asString(event.factType, "golden_invalid_fact_type")
    };
    assertAtOrBeforeSnapshot(result.timestamp, snapshot.timestamp);
    if (BigInt(result.blockNumber) > BigInt(snapshot.confirmedBlockNumber)) {
      throw new TypeError("golden_evidence_after_snapshot");
    }
    return result;
  });
  const eventIdentities = new Set<string>();
  for (const event of events) {
    const identity = [event.txHash, event.eventIndex, event.factType].join(":");
    if (eventIdentities.has(identity)) {
      throw new TypeError("golden_duplicate_event_identity");
    }
    eventIdentities.add(identity);
  }
  events.sort(compareEvents);

  const stateFacts = asArray(source.stateFacts)
    .map((value) => {
      const fact = asRecord(value);
      const result = {
        factType: asString(fact.factType, "golden_invalid_fact_type"),
        subject: asAddress(fact.subject),
        object: asNullableString(fact.object, "golden_invalid_fact_object"),
        role: asString(fact.role, "golden_invalid_fact_role"),
        effectiveAt: asTimestamp(fact.effectiveAt),
        evidenceRefs: sortedUniqueStrings(fact.evidenceRefs)
      };
      assertAtOrBeforeSnapshot(result.effectiveAt, snapshot.timestamp);
      return result;
    })
    .sort(canonicalOrder);

  const labels = asArray(source.labels)
    .map((value) => {
      const label = asRecord(value);
      const validFrom = asNullableString(
        label.validFrom,
        "golden_invalid_iso_utc_timestamp"
      );
      const validTo = asNullableString(
        label.validTo,
        "golden_invalid_iso_utc_timestamp"
      );
      const result = {
        address: asAddress(label.address),
        label: asString(label.label, "golden_invalid_label"),
        category: asString(label.category, "golden_invalid_label_category"),
        authority: asString(label.authority, "golden_invalid_label_authority"),
        validFrom: validFrom === null ? null : asTimestamp(validFrom),
        validTo: validTo === null ? null : asTimestamp(validTo),
        evidenceRefs: sortedUniqueStrings(label.evidenceRefs)
      };
      if (result.validFrom !== null) {
        assertAtOrBeforeSnapshot(result.validFrom, snapshot.timestamp);
      }
      if (
        result.validFrom !== null &&
        result.validTo !== null &&
        Date.parse(result.validFrom) > Date.parse(result.validTo)
      ) {
        throw new TypeError("golden_invalid_label_validity");
      }
      return result;
    })
    .sort(canonicalOrder);

  const approvals = asArray(source.approvals)
    .map((value) => {
      const approval = asRecord(value);
      const result = {
        owner: asAddress(approval.owner),
        spender: asAddress(approval.spender),
        tokenContract: asAddress(approval.tokenContract),
        amountRaw: asDecimal(approval.amountRaw),
        txHash: asHash(
          approval.txHash,
          "golden_invalid_lowercase_tx_hash"
        ),
        eventIndex: asDecimal(approval.eventIndex),
        timestamp: asTimestamp(approval.timestamp)
      };
      assertAtOrBeforeSnapshot(result.timestamp, snapshot.timestamp);
      return result;
    })
    .sort(canonicalOrder);

  return {
    version: "neutral-evidence-bundle-v2",
    caseId: asCaseId(source.caseId),
    subjectAddress: asAddress(source.subjectAddress),
    snapshot,
    events,
    stateFacts,
    labels,
    approvals
  };
}

export function buildNeutralExport(source: unknown): NeutralExportResultV2 {
  const fields = new Set<string>();
  scanSource(source, "", fields, new Set());
  const bundle = projectSource(source);
  const sourceCanonicalSha256 = canonicalSha256({
    ...asRecord(source),
    events: bundle.events,
    stateFacts: bundle.stateFacts,
    labels: bundle.labels,
    approvals: bundle.approvals
  });
  const fieldInventory = [...fields].sort(lexical);
  const receipt: NeutralExportReceiptV2 = {
    version: "neutral-export-validator-receipt-v2",
    caseId: bundle.caseId,
    forbiddenFieldMatches: [],
    forbiddenValueMatches: [],
    systemNarrativePresent: false,
    systemScorePresent: false,
    fieldInventory,
    fieldInventorySha256: canonicalSha256(fieldInventory)
  };
  const rawEvidenceInventory =
    (["approvals", "events", "labels", "stateFacts"] as const).map((kind) => ({
      kind,
      count: bundle[kind].length,
      sha256: canonicalSha256(bundle[kind])
    }));
  const manifest: NeutralExportManifestV2 = {
    version: "neutral-export-manifest-v2",
    caseId: bundle.caseId,
    sourceSnapshot: {
      chain: bundle.snapshot.chain,
      blockNumber: bundle.snapshot.confirmedBlockNumber,
      blockHash: bundle.snapshot.confirmedBlockHash,
      timestamp: bundle.snapshot.timestamp
    },
    exporterVersion: "golden-neutral-export-v2",
    runtimeVersion: process.version,
    schemaSha256: canonicalSha256(NEUTRAL_SCHEMA),
    labelDatasetSha256: bundle.snapshot.labelDatasetSha256,
    sourceCanonicalSha256,
    contentSha256: canonicalSha256(bundle),
    validatorReceiptSha256: canonicalSha256(receipt),
    rawEvidenceInventory
  };
  return { bundle, manifest, receipt };
}

export async function publishNeutralExport(
  root: string,
  relativePath: string,
  source: unknown
): Promise<NeutralExportResultV2 & { artifact: PublishedArtifact }> {
  const result = buildNeutralExport(source);
  const artifact = await publishArtifactOnce(root, relativePath, result);
  return { ...result, artifact };
}
