import {
  canonicalJson,
  canonicalSha256
} from "../golden-pilot-v2/canonicalJson";
import {
  publishArtifactOnce,
  verifyPublishedArtifact
} from "../golden-pilot-v2/artifactStore";
import {
  buildNeutralExport,
  type FrozenEvidenceSourceV2
} from "../golden-pilot-v2/neutralExport";

type CatalogCase = {
  caseId: string;
  group: "blind_review" | "regression" | "synthetic_property_performance";
  subjectAddress: string;
  sourceArtifact: string;
  requiredProperties: string[];
};

type Catalog = {
  version: "golden-case-catalog-v2";
  groups: Array<{ kind: CatalogCase["group"]; caseIds: string[] }>;
  cases: CatalogCase[];
};

type SyntheticCase = {
  caseId: string;
  subjectAddress: string;
  amountRaw: string;
  timestamp: string;
  txHash: string;
};

type FrozenEvidence = Pick<
  FrozenEvidenceSourceV2,
  "events" | "stateFacts" | "labels" | "approvals"
>;

type CapturedSource = FrozenEvidenceSourceV2 & {
  captureProvenance: {
    providerResponseSha256: string;
    selectionCutoff: string;
  };
};

export type GoldenCaptureInput = {
  catalog: Catalog;
  syntheticCases: {
    version: "golden-synthetic-cases-v2";
    cases: SyntheticCase[];
  };
  selectionRows: Array<Record<string, unknown>>;
  selectionCutoff: string;
  snapshot: {
    confirmedBlockNumber: string;
    confirmedBlockHash: string;
    timestamp: string;
  };
  providerResponseSha256: string;
  labelDatasetSha256: string;
  evidenceBySubject?: Record<string, FrozenEvidence>;
};

const TBL7 = "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy";
const TQR = "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP";
const USDT = "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj";
const PEER = "T9yD14Nj9j7xAB4dbGeiX9h8unkKv2TRTS";
const BLACKLIST = "T9yD14Nj9j7xAB4dbGeiX9h8unkL2ynyg7";
const PEERS = [
  "T9yD14Nj9j7xAB4dbGeiX9h8unkKLxmGkn",
  "T9yD14Nj9j7xAB4dbGeiX9h8unkKT76qbH",
  "T9yD14Nj9j7xAB4dbGeiX9h8unkKawPyGg",
  "T9yD14Nj9j7xAB4dbGeiX9h8unkKi6mJHp",
  "T9yD14Nj9j7xAB4dbGeiX9h8unkKsN8FyA",
  PEER,
  BLACKLIST
] as const;

function lexical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function selectBlindSubjects(
  rows: GoldenCaptureInput["selectionRows"],
  cutoff: string
): string[] {
  const eligible = rows
    .map((row) => ({
      address: requiredString(row.subjectAddress),
      createdAt: requiredString(row.createdAt),
      userOriginated:
        row.chatId != null ||
        /^(?:user|[0-9]+)$/u.test(requiredString(row.requestedBy) ?? "")
    }))
    .filter(
      (
        row
      ): row is {
        address: string;
        createdAt: string;
        userOriginated: true;
      } =>
        row.address !== null &&
        row.createdAt !== null &&
        row.userOriginated &&
        row.address !== TBL7 &&
        row.address !== TQR &&
        Date.parse(row.createdAt) <= Date.parse(cutoff)
    )
    .sort(
      (left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
        lexical(left.address, right.address)
    );
  const selected: string[] = [];
  for (const row of eligible) {
    if (!selected.includes(row.address)) selected.push(row.address);
    if (selected.length === 5) break;
  }
  if (selected.length !== 5) {
    throw new Error(
      "FAILED_TECHNICAL:golden_capture_requires_five_blind_subjects"
    );
  }
  return selected;
}

function emptySource(
  caseId: string,
  subjectAddress: string,
  input: GoldenCaptureInput
): CapturedSource {
  const evidence = input.evidenceBySubject?.[subjectAddress];
  return {
    version: "frozen-evidence-source-v2",
    caseId,
    subjectAddress,
    snapshot: {
      chain: "tron",
      ...input.snapshot,
      labelDatasetSha256: input.labelDatasetSha256
    },
    events: evidence?.events.map((item) => ({ ...item })) ?? [],
    stateFacts:
      evidence?.stateFacts.map((item) => ({
        ...item,
        evidenceRefs: [...item.evidenceRefs]
      })) ?? [],
    labels:
      evidence?.labels.map((item) => ({
        ...item,
        evidenceRefs: [...item.evidenceRefs]
      })) ?? [],
    approvals: evidence?.approvals.map((item) => ({ ...item })) ?? [],
    captureProvenance: {
      providerResponseSha256: input.providerResponseSha256,
      selectionCutoff: input.selectionCutoff
    }
  };
}

function event(
  item: SyntheticCase,
  from: string,
  to: string,
  amountRaw = item.amountRaw,
  eventIndex = "0"
): FrozenEvidenceSourceV2["events"][number] {
  return {
    txHash: item.txHash,
    eventIndex,
    tokenContract: USDT,
    from,
    to,
    amountRaw,
    timestamp: item.timestamp,
    blockNumber: String(100 + Number.parseInt(eventIndex, 10)),
    factType: "trc20_transfer"
  };
}

function syntheticSource(
  item: SyntheticCase,
  input: GoldenCaptureInput
): CapturedSource {
  const source = emptySource(item.caseId, item.subjectAddress, input);
  const ref = `${item.txHash}:0:trc20_transfer`;
  const fact = (factType: string, role: string, object: string | null = null) => ({
    factType,
    subject: item.subjectAddress,
    object,
    role,
    effectiveAt: item.timestamp,
    evidenceRefs: [ref]
  });

  switch (item.caseId) {
    case "synthetic-empty-wallet":
      return source;
    case "synthetic-new-no-usdt":
      source.stateFacts.push(fact("wallet_created", "subject", item.timestamp));
      return source;
    case "synthetic-one-legitimate-transfer":
      source.events.push(event(item, PEER, item.subjectAddress));
      source.labels.push({
        address: PEER,
        label: "Bybit",
        category: "cex",
        authority: "golden-synthetic-v2",
        validFrom: null,
        validTo: null,
        evidenceRefs: [ref]
      });
      return source;
    case "synthetic-unknown-no-pattern":
      source.events.push(event(item, PEER, item.subjectAddress));
      return source;
    case "synthetic-direct-blacklist-1pct":
      source.events.push(
        event(item, PEER, item.subjectAddress, "990000", "0"),
        event(item, BLACKLIST, item.subjectAddress, "10000", "1")
      );
      source.labels.push({
        address: BLACKLIST,
        label: "Frozen at event",
        category: "blacklist",
        authority: "golden-synthetic-v2",
        validFrom: item.timestamp,
        validTo: null,
        evidenceRefs: [`${item.txHash}:1:trc20_transfer`]
      });
      return source;
    case "synthetic-bybit-plus-hard-evidence":
      source.events.push(event(item, PEER, item.subjectAddress, item.amountRaw, "0"));
      source.events.push(event(item, BLACKLIST, item.subjectAddress, "1000000", "1"));
      source.labels.push(
        {
          address: PEER,
          label: "Bybit",
          category: "cex",
          authority: "golden-synthetic-v2",
          validFrom: null,
          validTo: null,
          evidenceRefs: [ref]
        },
        {
          address: BLACKLIST,
          label: "Frozen at event",
          category: "blacklist",
          authority: "golden-synthetic-v2",
          validFrom: item.timestamp,
          validTo: null,
          evidenceRefs: [`${item.txHash}:1:trc20_transfer`]
        }
      );
      return source;
    case "synthetic-dangerous-approval-no-debit":
      source.approvals.push({
        owner: item.subjectAddress,
        spender: BLACKLIST,
        tokenContract: USDT,
        amountRaw: item.amountRaw,
        txHash: item.txHash,
        eventIndex: "0",
        timestamp: item.timestamp
      });
      source.stateFacts.push(
        fact("dangerous_unlimited_approval", "approval_owner", BLACKLIST)
      );
      return source;
    case "synthetic-victim-debit":
      source.events.push(event(item, item.subjectAddress, BLACKLIST));
      source.stateFacts.push(fact("confirmed_victim_debit", "victim", BLACKLIST));
      return source;
    case "synthetic-operational-wallet":
      source.events.push(event(item, PEER, item.subjectAddress));
      source.stateFacts.push(fact("old_active_operational_wallet", "subject"));
      return source;
    case "synthetic-dust-spam":
      source.events.push(event(item, PEER, item.subjectAddress));
      source.stateFacts.push(fact("dust_spam", "recipient"));
      return source;
    case "synthetic-dense-wallet":
      for (let index = 0; index < 64; index += 1) {
        const peer = PEERS[index % PEERS.length];
        const incoming = index % 2 === 0;
        source.events.push({
          txHash: canonicalSha256([item.caseId, index]),
          eventIndex: "0",
          tokenContract: USDT,
          from: incoming ? peer : item.subjectAddress,
          to: incoming ? item.subjectAddress : peer,
          amountRaw: String(1_000_000 + index),
          timestamp: item.timestamp,
          blockNumber: String(200 + index),
          factType: "trc20_transfer"
        });
      }
      source.stateFacts.push(fact("dense_fan_in_fan_out", "subject", "64"));
      return source;
    case "synthetic-500-pages":
      for (let page = 1; page <= 500; page += 1) {
        source.stateFacts.push(
          fact("direct_history_page", "subject", String(page))
        );
      }
      return source;
    case "synthetic-duplicates":
      source.events.push(event(item, PEER, item.subjectAddress));
      source.stateFacts.push(
        fact("duplicate_evidence", "fast_branch"),
        fact("duplicate_evidence", "deep_branch")
      );
      return source;
    case "synthetic-reorder":
      source.events.push(
        event(item, PEER, item.subjectAddress, item.amountRaw, "2"),
        event(item, item.subjectAddress, PEER, item.amountRaw, "1"),
        event(item, PEER, item.subjectAddress, item.amountRaw, "0")
      );
      return source;
    case "synthetic-restart":
      source.events.push(event(item, PEER, item.subjectAddress));
      source.stateFacts.push(
        fact("immutable_attempt", "attempt", "attempt-1"),
        fact("immutable_attempt", "attempt", "attempt-2")
      );
      return source;
    case "synthetic-key-exhaustion":
      for (let key = 1; key <= 4; key += 1) {
        source.stateFacts.push(
          fact("provider_key_exhausted", "provider", `key-${key}`)
        );
      }
      return source;
    case "synthetic-ambiguous-delivery":
      source.stateFacts.push(
        fact("delivery_unknown", "delivery"),
        fact("automatic_retry_forbidden", "delivery")
      );
      return source;
    default:
      throw new TypeError(`golden_unknown_synthetic_case:${item.caseId}`);
  }
}

function assertHash(value: string): void {
  if (!/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(
      "FAILED_TECHNICAL:golden_capture_invalid_provenance_hash"
    );
  }
}

export function buildPureGoldenCapture(input: GoldenCaptureInput) {
  assertHash(input.providerResponseSha256);
  assertHash(input.labelDatasetSha256);
  const selectedSubjects = selectBlindSubjects(
    input.selectionRows,
    input.selectionCutoff
  );
  let blindIndex = 0;
  const catalog: Catalog = {
    ...input.catalog,
    groups: input.catalog.groups.map((group) => ({
      ...group,
      caseIds: [...group.caseIds]
    })),
    cases: input.catalog.cases.map((item) => {
      if (item.group === "blind_review") {
        return { ...item, subjectAddress: selectedSubjects[blindIndex++] };
      }
      if (item.caseId === "regression-tbl7") {
        return { ...item, subjectAddress: TBL7 };
      }
      if (item.caseId === "regression-tqr") {
        return { ...item, subjectAddress: TQR };
      }
      return { ...item, requiredProperties: [...item.requiredProperties] };
    })
  };
  const synthetic = new Map(
    input.syntheticCases.cases.map((item) => [item.caseId, item])
  );
  const sources = catalog.cases.map((item) => {
    const syntheticItem = synthetic.get(item.caseId);
    return syntheticItem
      ? syntheticSource(syntheticItem, input)
      : emptySource(item.caseId, item.subjectAddress, input);
  });
  if (sources.length !== 24 || new Set(sources.map((item) => item.caseId)).size !== 24) {
    throw new Error("FAILED_TECHNICAL:golden_capture_case_set_incomplete");
  }

  const selectionCore = {
    version: "golden-capture-selection-v2" as const,
    cutoff: input.selectionCutoff,
    selectedSubjects
  };
  const selectionManifest = {
    ...selectionCore,
    selectionSha256: canonicalSha256(selectionCore)
  };
  const sourceInventory = sources
    .map((source) => {
      const neutral = buildNeutralExport(source);
      return {
        caseId: source.caseId,
        sourceSha256: canonicalSha256(source),
        neutralBundleSha256: canonicalSha256(neutral.bundle),
        validatorReceiptSha256: canonicalSha256(neutral.receipt)
      };
    })
    .sort((left, right) => lexical(left.caseId, right.caseId));

  return {
    catalog,
    sources,
    selectionManifest,
    captureManifest: {
      version: "golden-capture-manifest-v2" as const,
      snapshot: input.snapshot,
      providerResponseSha256: input.providerResponseSha256,
      labelDatasetSha256: input.labelDatasetSha256,
      selectionSha256: selectionManifest.selectionSha256,
      sourceInventory
    }
  };
}

export async function publishCanonicalArtifactIdentically(
  root: string,
  relativePath: string,
  value: unknown
) {
  const expected = {
    relativePath,
    sha256: canonicalSha256(value),
    byteLength: Buffer.byteLength(canonicalJson(value), "utf8")
  };
  try {
    return await publishArtifactOnce(root, relativePath, value);
  } catch (error) {
    if ((error as Error).message !== "golden_artifact_already_exists") {
      throw error;
    }
  }
  try {
    await verifyPublishedArtifact(root, expected);
  } catch (error) {
    if ((error as Error).message === "golden_artifact_verification_failed") {
      throw new Error("golden_artifact_existing_content_differs");
    }
    throw error;
  }
  return expected;
}
