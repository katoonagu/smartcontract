import { fingerprintCanonicalJson } from "../forensics/canonicalJson";

const HASH = /^[0-9a-f]{64}$/u;
const RAW = /^(0|[1-9][0-9]*)$/u;
const TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/u;

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
  if (!TRON_ADDRESS.test(subjectAddress)) {
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
  return { snapshot, sha256: fingerprintCanonicalJson(snapshot) };
}
