import { canonicalSha256 } from "../golden-pilot-v2/canonicalJson";
import {
  buildPureGoldenCapture,
  publishCanonicalArtifactIdentically,
  selectBlindSubjects,
  type GoldenCaptureInput
} from "./capture";

type QueryResult = { rows: Array<Record<string, unknown>> };

export type GoldenCaptureDatabase = {
  query(text: string, values?: readonly unknown[]): Promise<QueryResult>;
};

type SnapshotResult = {
  snapshot: GoldenCaptureInput["snapshot"];
  rawResponse: unknown;
};

type TransferRow = {
  txHash: string;
  blockNumber: string;
  timestamp: string;
  eventIndex: string;
  from: string;
  to: string;
  amountRaw: string;
};

type ApprovalRow = {
  txHash: string;
  timestamp: string;
  eventIndex: string;
  owner: string;
  spender: string;
  amountRaw: string;
  isUnlimited: boolean;
};

type LabelRow = {
  address: string;
  label: string;
  authority: string;
  observedAt: string;
};

const REGRESSION_SUBJECTS = [
  "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy",
  "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP"
] as const;
const USDT = "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj";

const SELECTION_SQL = `
SELECT
  id AS "jobId",
  subject_address AS "subjectAddress",
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
  chat_id AS "chatId",
  requested_by AS "requestedBy"
FROM forensic_check_jobs
WHERE created_at <= $1::timestamptz
  AND (chat_id IS NOT NULL OR requested_by ~ '^[0-9]+$')
ORDER BY created_at DESC, subject_address ASC, id ASC
`.trim();

const TRANSFERS_SQL = `
SELECT
  tx_hash AS "txHash",
  block_number::text AS "blockNumber",
  to_char(block_timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "timestamp",
  event_index::text AS "eventIndex",
  from_address AS "from",
  to_address AS "to",
  amount_raw AS "amountRaw"
FROM tron_usdt_transfers
WHERE confirmed = TRUE
  AND reverted = FALSE
  AND block_number <= $2::bigint
  AND block_timestamp <= $3::timestamptz
  AND (from_address = ANY($1::text[]) OR to_address = ANY($1::text[]))
ORDER BY block_number ASC, event_index ASC, tx_hash ASC
`.trim();

const APPROVALS_SQL = `
SELECT
  tx_hash AS "txHash",
  to_char(block_timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "timestamp",
  event_index::text AS "eventIndex",
  owner_address AS "owner",
  spender_address AS "spender",
  amount_raw AS "amountRaw",
  is_unlimited AS "isUnlimited"
FROM tron_usdt_approvals
WHERE block_number <= $2::bigint
  AND block_timestamp <= $3::timestamptz
  AND owner_address = ANY($1::text[])
ORDER BY block_number ASC, event_index ASC, tx_hash ASC
`.trim();

const LABELS_SQL = `
SELECT
  address,
  label,
  source AS authority,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "observedAt"
FROM address_labels
WHERE address = ANY($1::text[])
ORDER BY address ASC, label ASC, source ASC
`.trim();

const METADATA_SQL = `
SELECT
  address,
  name,
  tag,
  to_char(fetched_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "observedAt"
FROM address_metadata
WHERE address = ANY($1::text[])
  AND (name IS NOT NULL OR tag IS NOT NULL)
ORDER BY address ASC
`.trim();

function rows<T>(result: QueryResult): T[] {
  return result.rows as T[];
}

function evidenceRef(row: TransferRow): string {
  return `${row.txHash}:${row.eventIndex}:trc20_transfer`;
}

function labelsForSubject(
  subject: string,
  transfers: TransferRow[],
  labels: LabelRow[]
) {
  const refs = new Map<string, string[]>();
  for (const transfer of transfers) {
    if (transfer.from !== subject && transfer.to !== subject) continue;
    const counterparty = transfer.from === subject ? transfer.to : transfer.from;
    const values = refs.get(counterparty) ?? [];
    values.push(evidenceRef(transfer));
    refs.set(counterparty, values);
  }
  return labels
    .filter(({ address }) => refs.has(address))
    .map((row) => ({
      address: row.address,
      label: row.label,
      category:
        row.authority === "tronscan-metadata" ? "service_metadata" : row.label,
      authority: row.authority,
      validFrom: null,
      validTo: null,
      evidenceRefs: [...new Set(refs.get(row.address) ?? [])].sort()
    }))
    .sort(
      (left, right) =>
        left.address.localeCompare(right.address) ||
        left.label.localeCompare(right.label) ||
        left.authority.localeCompare(right.authority)
    );
}

export async function captureGoldenPilotV2(input: {
  db: GoldenCaptureDatabase;
  getConfirmedSnapshot(): Promise<SnapshotResult>;
  catalog: GoldenCaptureInput["catalog"];
  syntheticCases: GoldenCaptureInput["syntheticCases"];
  selectionCutoff: string;
}) {
  const confirmed = await input.getConfirmedSnapshot();
  const providerResponseSha256 = canonicalSha256(confirmed.rawResponse);
  let began = false;
  try {
    await input.db.query("BEGIN READ ONLY");
    began = true;
    const readOnly = await input.db.query("SHOW transaction_read_only");
    if (readOnly.rows[0]?.transaction_read_only !== "on") {
      throw new Error(
        "FAILED_TECHNICAL:golden_capture_database_not_read_only"
      );
    }
    const selectionRows = (
      await input.db.query(SELECTION_SQL, [input.selectionCutoff])
    ).rows;
    const blindSubjects = selectBlindSubjects(
      selectionRows,
      input.selectionCutoff
    );
    const subjects = [...blindSubjects, ...REGRESSION_SUBJECTS];
    const bounds = [
      subjects,
      confirmed.snapshot.confirmedBlockNumber,
      confirmed.snapshot.timestamp
    ] as const;
    const transfers = rows<TransferRow>(
      await input.db.query(TRANSFERS_SQL, bounds)
    );
    const approvals = rows<ApprovalRow>(
      await input.db.query(APPROVALS_SQL, bounds)
    );
    const counterparties = [
      ...new Set(
        transfers.flatMap(({ from, to }) => [from, to]).concat(
          approvals.flatMap(({ owner, spender }) => [owner, spender])
        )
      )
    ].sort();
    const directLabels = rows<LabelRow>(
      await input.db.query(LABELS_SQL, [counterparties])
    );
    const metadata = rows<{
      address: string;
      name: string | null;
      tag: string | null;
      observedAt: string;
    }>(await input.db.query(METADATA_SQL, [counterparties]));
    const metadataLabels: LabelRow[] = metadata.flatMap((row) =>
      [...new Set([row.name, row.tag].filter((value): value is string => Boolean(value)))]
        .sort()
        .map((label) => ({
          address: row.address,
          label,
          authority: "tronscan-metadata",
          observedAt: row.observedAt
        }))
    );
    const labelEntries = [...directLabels, ...metadataLabels].sort(
      (left, right) =>
        left.address.localeCompare(right.address) ||
        left.label.localeCompare(right.label) ||
        left.authority.localeCompare(right.authority)
    );
    const labelDatasetCore = {
      version: "golden-label-dataset-v2" as const,
      snapshot: confirmed.snapshot,
      entries: labelEntries
    };
    const labelDataset = {
      ...labelDatasetCore,
      sha256: canonicalSha256(labelDatasetCore)
    };
    const evidenceBySubject = Object.fromEntries(
      subjects.map((subject) => {
        const subjectTransfers = transfers.filter(
          ({ from, to }) => from === subject || to === subject
        );
        const subjectApprovals = approvals.filter(
          ({ owner }) => owner === subject
        );
        return [
          subject,
          {
            events: subjectTransfers.map((row) => ({
              txHash: row.txHash,
              eventIndex: row.eventIndex,
              tokenContract: USDT,
              from: row.from,
              to: row.to,
              amountRaw: row.amountRaw,
              timestamp: row.timestamp,
              blockNumber: row.blockNumber,
              factType: "trc20_transfer"
            })),
            stateFacts: subjectApprovals
              .filter(({ isUnlimited }) => isUnlimited)
              .map((row) => ({
                factType: "unlimited_approval",
                subject: row.owner,
                object: row.spender,
                role: "approval_owner",
                effectiveAt: row.timestamp,
                evidenceRefs: [
                  `${row.txHash}:${row.eventIndex}:trc20_approval`
                ]
              })),
            labels: labelsForSubject(subject, subjectTransfers, labelEntries),
            approvals: subjectApprovals.map((row) => ({
              owner: row.owner,
              spender: row.spender,
              tokenContract: USDT,
              amountRaw: row.amountRaw,
              txHash: row.txHash,
              eventIndex: row.eventIndex,
              timestamp: row.timestamp
            }))
          }
        ];
      })
    );
    const capture = buildPureGoldenCapture({
      catalog: input.catalog,
      syntheticCases: input.syntheticCases,
      selectionRows,
      selectionCutoff: input.selectionCutoff,
      snapshot: confirmed.snapshot,
      providerResponseSha256,
      labelDatasetSha256: labelDataset.sha256,
      evidenceBySubject
    });
    const querySha256 = canonicalSha256([
      SELECTION_SQL,
      TRANSFERS_SQL,
      APPROVALS_SQL,
      LABELS_SQL,
      METADATA_SQL
    ]);
    return {
      capture,
      labelDataset,
      provenanceManifest: {
        version: "golden-capture-provenance-v2" as const,
        snapshot: confirmed.snapshot,
        selectionCutoff: input.selectionCutoff,
        database: {
          transactionReadOnly: true as const,
          querySha256
        },
        provider: {
          kind: "tron-solidity-confirmed-block" as const,
          responseSha256: providerResponseSha256
        },
        labelDatasetSha256: labelDataset.sha256
      }
    };
  } finally {
    if (began) await input.db.query("ROLLBACK");
  }
}

export async function publishGoldenCaptureV2(
  root: string,
  result: Awaited<ReturnType<typeof captureGoldenPilotV2>>
) {
  const artifacts = await Promise.all([
    publishCanonicalArtifactIdentically(
      root,
      "source/case-catalog.json",
      result.capture.catalog
    ),
    ...result.capture.sources.map((source) =>
      publishCanonicalArtifactIdentically(
        root,
        `source/${source.caseId}.json`,
        source
      )
    ),
    publishCanonicalArtifactIdentically(
      root,
      "capture/selection-manifest.json",
      result.capture.selectionManifest
    ),
    publishCanonicalArtifactIdentically(
      root,
      "capture/capture-manifest.json",
      result.capture.captureManifest
    ),
    publishCanonicalArtifactIdentically(
      root,
      "capture/label-dataset.json",
      result.labelDataset
    ),
    publishCanonicalArtifactIdentically(
      root,
      "capture/label-dataset-manifest.json",
      {
        version: "golden-label-dataset-manifest-v2",
        contentSha256: result.labelDataset.sha256,
        entryCount: result.labelDataset.entries.length,
        snapshot: result.labelDataset.snapshot
      }
    ),
    publishCanonicalArtifactIdentically(
      root,
      "capture/provenance-manifest.json",
      result.provenanceManifest
    )
  ]);
  return artifacts.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
}
