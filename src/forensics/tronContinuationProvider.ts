import type { CrossChainAddress, CrossChainEvidenceRef } from "../types";
import {
  TRON_USDT_CONTRACT_ADDRESS,
  type RawTronscanTrc20Transfer
} from "../parser/transactionParser";
import { classifyContinuationEdge } from "./bridgeContinuationScorer";
import { crossChainEvidenceId } from "./crossChainEvidence";
import type {
  ChainContinuationProvider,
  CrossChainContinuationEdge,
  CrossChainContinuationSeed
} from "./crossChainContinuationTypes";

type TronTransferQueryOptions = {
  start: number;
  limit: number;
  minTimestamp?: number;
  endTimestamp?: number;
};

type TronContinuationClient = {
  listRelatedTrc20Transfers(
    address: string,
    options: TronTransferQueryOptions
  ): Promise<RawTronscanTrc20Transfer[]>;
};

type CreateTronUsdtContinuationProviderInput = {
  tronClient: TronContinuationClient;
};

function address(value: string | null | undefined): CrossChainAddress | null {
  if (!value?.trim()) return null;
  return { chain: "tron", chainId: "tron-mainnet", address: value };
}

function evidence(txHash: string): CrossChainEvidenceRef {
  return {
    id: crossChainEvidenceId("local", "tron", txHash, "token_transfer"),
    provider: "local",
    payloadId: null,
    confidence: "weak"
  };
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function queryOptions(seed: CrossChainContinuationSeed): TronTransferQueryOptions {
  const options: TronTransferQueryOptions = {
    start: 0,
    limit: 50
  };
  const start = parseTime(seed.timeWindow?.start);
  const end = parseTime(seed.timeWindow?.end);

  if (start !== null) options.minTimestamp = start;
  if (end !== null) options.endTimestamp = end;
  return options;
}

function isOfficialUsdtTransfer(transfer: RawTronscanTrc20Transfer): boolean {
  const contractAddress = transfer.contract_address ?? transfer.tokenInfo?.tokenId;
  if (contractAddress !== TRON_USDT_CONTRACT_ADDRESS) return false;
  if (transfer.tokenInfo?.tokenType === undefined) return true;
  if (typeof transfer.tokenInfo.tokenType !== "string") return false;
  return transfer.tokenInfo.tokenType.toLowerCase() === "trc20";
}

function isSuccessfulTransfer(transfer: RawTronscanTrc20Transfer): boolean {
  if (transfer.confirmed !== true) return false;
  if (transfer.revert === true) return false;
  if (transfer.contractRet && transfer.contractRet !== "SUCCESS") return false;
  if (transfer.finalResult && transfer.finalResult !== "SUCCESS") return false;
  if (transfer.status !== undefined && transfer.status !== 0 && transfer.status !== "0" && transfer.status !== "SUCCESS") {
    return false;
  }
  return true;
}

function isValidAmount(value: string): boolean {
  return /^\d+$/.test(value);
}

function timestamp(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function stablePart(value: string | number | null | undefined): string {
  return String(value ?? "").toLowerCase();
}

function transferFingerprint(transfer: RawTronscanTrc20Transfer): string {
  return [
    transfer.transaction_id,
    transfer.from_address,
    transfer.to_address,
    transfer.contract_address ?? transfer.tokenInfo?.tokenId,
    transfer.quant,
    transfer.block_ts
  ].map(stablePart).join(":");
}

function withFingerprintOccurrences<T>(
  rows: T[],
  fingerprint: (row: T) => string
): Array<{ row: T; occurrence: number }> {
  const counts = new Map<string, number>();
  return rows.map((row) => {
    const key = fingerprint(row);
    const occurrence = counts.get(key) ?? 0;
    counts.set(key, occurrence + 1);
    return { row, occurrence };
  });
}

function edgeFromTransfer(
  transfer: RawTronscanTrc20Transfer,
  occurrence: number
): CrossChainContinuationEdge | null {
  if (!transfer.transaction_id?.trim()) return null;
  if (!address(transfer.from_address) || !address(transfer.to_address)) return null;
  if (!isOfficialUsdtTransfer(transfer)) return null;
  if (!isSuccessfulTransfer(transfer)) return null;
  if (!isValidAmount(transfer.quant)) return null;

  const transferTimestamp = timestamp(transfer.block_ts);
  if (!transferTimestamp) return null;

  return {
    id: [
      "tron-continuation",
      "usdt",
      transfer.transaction_id,
      transfer.from_address,
      transfer.to_address,
      transfer.quant,
      "occurrence",
      occurrence.toString()
    ].join(":"),
    edgeType: "token_transfer",
    source: address(transfer.from_address),
    destination: address(transfer.to_address),
    txHash: transfer.transaction_id,
    amountRaw: transfer.quant,
    assetSymbol: "USDT",
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    timestamp: transferTimestamp,
    protocol: "TRON USDT",
    evidenceRefs: [evidence(transfer.transaction_id)],
    labels: ["TRON USDT"],
    continuationEvidenceClass: "weak_candidate",
    score: 0,
    reasons: []
  };
}

export function createTronUsdtContinuationProvider(
  input: CreateTronUsdtContinuationProviderInput
): ChainContinuationProvider {
  return {
    chain: "tron",

    async listEdgesForAddress(query) {
      const transfers = await query.budget.run(
        "local",
        `continuation:tron-usdt:${query.address.address.toLowerCase()}`,
        () => input.tronClient.listRelatedTrc20Transfers(query.address.address, queryOptions(query.seed))
      );

      return withFingerprintOccurrences(transfers, transferFingerprint)
        .map(({ row, occurrence }) => edgeFromTransfer(row, occurrence))
        .filter((edge): edge is CrossChainContinuationEdge => edge !== null)
        .map((edge) => classifyContinuationEdge(query.seed, edge));
    }
  };
}
