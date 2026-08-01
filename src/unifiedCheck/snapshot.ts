import { fingerprintCanonicalArtifact } from "../forensics/canonicalJson";
import { TronWeb } from "tronweb";

const HASH = /^[0-9a-f]{64}$/u;
const RAW = /^(0|[1-9][0-9]*)$/u;

export type SnapshotSource = {
  latestConfirmedBlock(): Promise<{
    number: string;
    hash: string;
    timestamp: string;
  }>;
  snapshotBalances(address: string, blockNumber: string): Promise<{
    usdtRaw: string | null;
    trxSun: string | null;
    source: string;
    consistency: "exact" | "reconstructed" | "unavailable";
  }>;
};

export type ConfirmedWalletSnapshotV1 = {
  readonly version: "confirmed-wallet-snapshot-v1";
  readonly schemaVersion: 1;
  readonly chain: "tron";
  readonly subjectAddress: string;
  readonly confirmedBlockNumber: string;
  readonly confirmedBlockHash: string;
  readonly timestamp: string;
  readonly balances: {
    readonly usdtRaw: string | null;
    readonly trxSun: string | null;
    readonly source: string;
    readonly consistency: "exact" | "reconstructed" | "unavailable";
  };
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown, code: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(code);
  }
  return value as JsonRecord;
}

function rawInteger(value: unknown, code: string): string {
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  ) {
    return String(value);
  }
  if (typeof value === "string" && RAW.test(value)) return value;
  throw new Error(code);
}

async function postJson(
  fetchFn: typeof fetch,
  url: URL,
  body: unknown,
  fullNodeApiKey: string | undefined,
  timeoutMs: number
): Promise<JsonRecord> {
  const headers = new Headers({ "content-type": "application/json" });
  if (fullNodeApiKey) headers.set("TRON-PRO-API-KEY", fullNodeApiKey);
  const response = await fetchFn(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) {
    throw new Error(`unified_snapshot_provider_http_${response.status}`);
  }
  return record(await response.json(), "unified_snapshot_provider_malformed");
}

export function createTronConfirmedSnapshotSource(input: {
  fullNodeBaseUrl: URL;
  fullNodeApiKey?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}): SnapshotSource {
  if (input.fullNodeBaseUrl.protocol !== "https:") {
    throw new TypeError("unified_snapshot_provider_requires_https");
  }
  const fetchFn = input.fetchFn ?? fetch;
  const timeoutMs = input.timeoutMs ?? 10_000;
  const call = (path: string, body: unknown) =>
    postJson(
      fetchFn,
      new URL(path, input.fullNodeBaseUrl),
      body,
      input.fullNodeApiKey,
      timeoutMs
    );
  return {
    async latestConfirmedBlock() {
      const response = await call("/walletsolidity/getnowblock", {});
      const header = record(
        response.block_header,
        "unified_snapshot_block_header_missing"
      );
      const rawData = record(
        header.raw_data,
        "unified_snapshot_block_data_missing"
      );
      const hash = String(response.blockID ?? "").toLowerCase();
      const timestampMs = Number(
        rawInteger(rawData.timestamp, "unified_snapshot_block_timestamp_invalid")
      );
      return {
        number: rawInteger(
          rawData.number,
          "unified_snapshot_block_number_invalid"
        ),
        hash,
        timestamp: new Date(timestampMs).toISOString()
      };
    },
    async snapshotBalances(address, blockNumber) {
      if (!TronWeb.isAddress(address)) {
        throw new TypeError("unified_invalid_subject_address");
      }
      if (!RAW.test(blockNumber)) {
        throw new TypeError("unified_invalid_snapshot_block");
      }
      // ponytail: walletsolidity balance methods do not accept an as-of block.
      // A later direct-history reconstruction may fill this profile; reporting
      // the moving solidified head as block-bound state would be false evidence.
      return {
        usdtRaw: null,
        trxSun: null,
        source: "tron-walletsolidity-pinned-state-unavailable",
        consistency: "unavailable"
      };
    }
  };
}

function canonicalTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new TypeError("unified_invalid_snapshot_timestamp");
  }
  return value;
}

function nullableRaw(value: string | null, code: string): string | null {
  if (value !== null && !RAW.test(value)) throw new TypeError(code);
  return value;
}

export async function acquireConfirmedWalletSnapshot(
  source: SnapshotSource,
  subjectAddress: string
): Promise<{ snapshot: ConfirmedWalletSnapshotV1; sha256: string }> {
  if (!TronWeb.isAddress(subjectAddress)) {
    throw new TypeError("unified_invalid_subject_address");
  }
  const block = await source.latestConfirmedBlock();
  if (!RAW.test(block.number) || block.number === "0") {
    throw new TypeError("unified_invalid_snapshot_block");
  }
  if (!HASH.test(block.hash)) throw new TypeError("unified_invalid_snapshot_hash");
  const balances = await source.snapshotBalances(subjectAddress, block.number);
  if (!balances.source.trim()) throw new TypeError("unified_invalid_snapshot_source");
  const snapshot: ConfirmedWalletSnapshotV1 = {
    version: "confirmed-wallet-snapshot-v1",
    schemaVersion: 1,
    chain: "tron",
    subjectAddress,
    confirmedBlockNumber: block.number,
    confirmedBlockHash: block.hash,
    timestamp: canonicalTimestamp(block.timestamp),
    balances: {
      usdtRaw: nullableRaw(balances.usdtRaw, "unified_invalid_usdt_balance"),
      trxSun: nullableRaw(balances.trxSun, "unified_invalid_trx_balance"),
      source: balances.source,
      consistency: balances.consistency
    }
  };
  return { snapshot, sha256: fingerprintCanonicalArtifact(snapshot) };
}
