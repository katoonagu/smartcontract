import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import {
  canonicalJson,
  canonicalSha256
} from "../golden-pilot-v2/canonicalJson";
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

type CaptureInput = {
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
};

const TBL7 = "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy";
const TQR = "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP";
const USDT = "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj";
const PEER = "T9yD14Nj9j7xAB4dbGeiX9h8unkKv2TRTS";
const BLACKLIST = "T9yD14Nj9j7xAB4dbGeiX9h8unkL2ynyg7";

function lexical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function selectBlindSubjects(
  rows: CaptureInput["selectionRows"],
  cutoff: string
): string[] {
  const eligible = rows
    .map((row) => ({
      address: requiredString(row.subjectAddress),
      createdAt: requiredString(row.createdAt),
      userOriginated: row.chatId != null || row.requestedBy != null
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
        lexical(right.createdAt, left.createdAt) ||
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
  input: CaptureInput
): FrozenEvidenceSourceV2 {
  return {
    version: "frozen-evidence-source-v2",
    caseId,
    subjectAddress,
    snapshot: {
      chain: "tron",
      ...input.snapshot,
      labelDatasetSha256: input.labelDatasetSha256
    },
    events: [],
    stateFacts: [],
    labels: [],
    approvals: []
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
  input: CaptureInput
): FrozenEvidenceSourceV2 {
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
      source.events.push(event(item, BLACKLIST, item.subjectAddress));
      source.labels.push({
        address: BLACKLIST,
        label: "Frozen at event",
        category: "blacklist",
        authority: "golden-synthetic-v2",
        validFrom: item.timestamp,
        validTo: null,
        evidenceRefs: [ref]
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
      source.stateFacts.push(fact("dense_fan_in_fan_out", "subject", "500"));
      return source;
    case "synthetic-500-pages":
      source.stateFacts.push(fact("direct_history_pages", "subject", "500"));
      return source;
    case "synthetic-duplicates":
      source.events.push(event(item, PEER, item.subjectAddress));
      source.stateFacts.push(fact("duplicate_evidence_idempotent", "subject"));
      return source;
    case "synthetic-reorder":
      source.events.push(event(item, PEER, item.subjectAddress));
      source.stateFacts.push(fact("reordered_evidence_idempotent", "subject"));
      return source;
    case "synthetic-restart":
      source.events.push(event(item, PEER, item.subjectAddress));
      source.stateFacts.push(fact("restart_deterministic", "subject"));
      return source;
    case "synthetic-key-exhaustion":
      source.stateFacts.push(fact("provider_key_exhaustion", "provider"));
      return source;
    case "synthetic-ambiguous-delivery":
      source.stateFacts.push(fact("ambiguous_delivery", "delivery"));
      return source;
    default:
      throw new TypeError(`golden_unknown_synthetic_case:${item.caseId}`);
  }
}

export function buildPureGoldenCapture(input: CaptureInput) {
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
  if (
    relativePath.length === 0 ||
    relativePath.includes("\\") ||
    relativePath.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new TypeError("golden_artifact_path_invalid");
  }
  const absoluteRoot = resolve(root);
  const destination = resolve(absoluteRoot, ...relativePath.split("/"));
  if (destination !== absoluteRoot && !destination.startsWith(`${absoluteRoot}${sep}`)) {
    throw new TypeError("golden_artifact_path_invalid");
  }
  const bytes = Buffer.from(canonicalJson(value), "utf8");
  try {
    const existing = await readFile(destination);
    if (!existing.equals(bytes)) {
      throw new Error("golden_artifact_existing_content_differs");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
  }
  const info = await stat(destination);
  return {
    relativePath,
    sha256: canonicalSha256(value),
    byteLength: info.size
  };
}
