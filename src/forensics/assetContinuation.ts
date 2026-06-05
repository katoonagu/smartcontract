import { TRON_USDT_CONTRACT_ADDRESS, type RawTronscanTrc20Transfer } from "../parser/transactionParser";
import type {
  AddressLabel,
  AssetContinuationDestinationRisk,
  AssetContinuationProfile,
  AssetContinuationTokenQuality
} from "../types";

export type BuildAssetContinuationProfilesInput = {
  subjectAddress: string;
  usdtTransfers: RawTronscanTrc20Transfer[];
  allTokenTransfers: RawTronscanTrc20Transfer[];
  getLabelsForAddress(address: string): Promise<AddressLabel[]>;
};

const HIGH_RISK_LABELS = new Set<AddressLabel["label"]>([
  "scam",
  "reported_scam",
  "stolen_funds",
  "phishing",
  "mixer_like",
  "risky_contract",
  "darknet_exchange"
]);

const SAME_EPISODE_WINDOW_MS = 10 * 60 * 1000;
const RAPID_CONTINUATION_MS = 60 * 1000;
const LARGE_USDT_AMOUNT_RAW = 100_000_000_000n;

function isSuccessfulTransfer(transfer: RawTronscanTrc20Transfer): boolean {
  if (transfer.confirmed !== true) return false;
  if (transfer.revert === true) return false;
  if (transfer.contractRet !== undefined && transfer.contractRet !== "SUCCESS") return false;
  if (transfer.finalResult !== undefined && transfer.finalResult !== "SUCCESS") return false;
  if (transfer.status !== undefined && transfer.status !== 0 && transfer.status !== "0" && transfer.status !== "SUCCESS") {
    return false;
  }
  return true;
}

function normalizedTokenType(transfer: RawTronscanTrc20Transfer): string | null {
  const type = transfer.tokenInfo?.tokenType;
  return typeof type === "string" ? type.trim().toLowerCase() : null;
}

function tokenContract(transfer: RawTronscanTrc20Transfer): string | null {
  const contract = transfer.contract_address ?? transfer.tokenInfo?.tokenId ?? null;
  return typeof contract === "string" && contract.trim().length > 0 ? contract.trim() : null;
}

function isOfficialUsdtTransfer(transfer: RawTronscanTrc20Transfer): boolean {
  const contract = tokenContract(transfer);
  if (contract !== TRON_USDT_CONTRACT_ADDRESS) return false;
  const type = normalizedTokenType(transfer);
  return type === null || type === "trc20";
}

function tokenQuality(transfer: RawTronscanTrc20Transfer): AssetContinuationTokenQuality {
  const contract = tokenContract(transfer);
  const symbol = transfer.tokenInfo?.tokenAbbr?.trim() ?? "";
  const name = transfer.tokenInfo?.tokenName?.trim() ?? "";
  const type = normalizedTokenType(transfer);

  if (!contract || !symbol) return "unknown";
  if (type !== null && type !== "trc20") return "unknown";
  if (name) return "verified";
  return "known";
}

function tokenSymbol(transfer: RawTronscanTrc20Transfer): string {
  const symbol = transfer.tokenInfo?.tokenAbbr?.trim();
  if (symbol) return symbol;
  return tokenContract(transfer) ?? "TRC20";
}

function transferTimestamp(transfer: RawTronscanTrc20Transfer): number | null {
  return Number.isFinite(transfer.block_ts) ? transfer.block_ts : null;
}

function isNonEmptyAddress(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function outgoingEventKey(transfer: RawTronscanTrc20Transfer, contract: string): string {
  return [transfer.transaction_id, contract, transfer.to_address, transfer.quant].join(":");
}

function parseRawAmount(value: string | null | undefined): bigint | null {
  if (!value || !/^\d+$/.test(value)) return null;
  return BigInt(value);
}

function scoreProfile(input: {
  destinationRisk: AssetContinuationDestinationRisk;
  tokenQuality: AssetContinuationTokenQuality;
  elapsedMs: number | null;
  sourceAmountRaw: string | null;
}): number {
  if (input.tokenQuality === "unknown") return 40;

  let score = input.tokenQuality === "verified" ? 65 : 60;
  if (input.elapsedMs !== null && input.elapsedMs >= 0 && input.elapsedMs <= RAPID_CONTINUATION_MS) score += 5;

  const sourceAmount = parseRawAmount(input.sourceAmountRaw);
  if (sourceAmount !== null && sourceAmount >= LARGE_USDT_AMOUNT_RAW) score += 5;

  if (input.destinationRisk === "service_boundary") score += 5;
  if (input.destinationRisk === "provider_risk") score += 15;
  if (input.destinationRisk === "internal_label") score += 17;

  return Math.min(84, Math.max(0, score));
}

async function destinationRisk(input: {
  address: string;
  transfer: RawTronscanTrc20Transfer;
  getLabelsForAddress(address: string): Promise<AddressLabel[]>;
}): Promise<AssetContinuationDestinationRisk> {
  const labels = await input.getLabelsForAddress(input.address).catch((): AddressLabel[] => []);
  if (labels.some((label) => HIGH_RISK_LABELS.has(label.label))) return "internal_label";
  if (input.transfer.riskTransaction === true) return "provider_risk";
  if (input.transfer.toAddressIsContract === true) return "service_boundary";
  return "unknown";
}

function profileReason(input: {
  destinationRisk: AssetContinuationDestinationRisk;
  tokenQuality: AssetContinuationTokenQuality;
  tokenSymbol: string;
}): string {
  if (input.tokenQuality === "unknown") {
    return `USDT movement continued through ${input.tokenSymbol}, but token metadata is incomplete or not TRC20.`;
  }
  if (input.destinationRisk === "unknown") {
    return `USDT movement continued through ${input.tokenSymbol}.`;
  }
  return `USDT movement continued through ${input.tokenSymbol} to a ${input.destinationRisk} destination.`;
}

function isStronglyCorrelatedInbound(input: {
  usdtOut: RawTronscanTrc20Transfer;
  usdtOutTime: number;
  inbound: RawTronscanTrc20Transfer;
}): boolean {
  if (input.inbound.to_address !== input.usdtOut.from_address) return false;
  const inboundTime = transferTimestamp(input.inbound);
  if (inboundTime === null) return false;
  if (inboundTime < input.usdtOutTime) return false;
  if (inboundTime - input.usdtOutTime > SAME_EPISODE_WINDOW_MS) return false;
  return input.inbound.from_address === input.usdtOut.to_address ||
    input.inbound.transaction_id === input.usdtOut.transaction_id;
}

export async function buildAssetContinuationProfiles(
  input: BuildAssetContinuationProfilesInput
): Promise<AssetContinuationProfile[]> {
  const usdtOutTransfers = input.usdtTransfers
    .filter((transfer) =>
      isSuccessfulTransfer(transfer) &&
      isOfficialUsdtTransfer(transfer) &&
      transfer.from_address === input.subjectAddress &&
      transfer.to_address !== input.subjectAddress &&
      isNonEmptyAddress(transfer.to_address)
    );

  const nonUsdtTransfers = input.allTokenTransfers
    .filter((transfer) =>
      isSuccessfulTransfer(transfer) &&
      !isOfficialUsdtTransfer(transfer) &&
      tokenContract(transfer) !== null
    );

  const profiles: AssetContinuationProfile[] = [];
  const seen = new Set<string>();
  const usedOutgoing = new Set<string>();

  for (const usdtOut of usdtOutTransfers) {
    const usdtOutTime = transferTimestamp(usdtOut);
    if (usdtOutTime === null) continue;

    const inboundCandidates = nonUsdtTransfers
      .filter((inbound) => isStronglyCorrelatedInbound({ usdtOut, usdtOutTime, inbound }))
      .sort((left, right) => {
        const leftDistance = (transferTimestamp(left) ?? 0) - usdtOutTime;
        const rightDistance = (transferTimestamp(right) ?? 0) - usdtOutTime;
        if (leftDistance !== rightDistance) return leftDistance - rightDistance;
        return left.transaction_id.localeCompare(right.transaction_id);
      });

    for (const inbound of inboundCandidates) {
      const continuationContract = tokenContract(inbound);
      const inboundTime = transferTimestamp(inbound);
      if (!continuationContract || inboundTime === null) continue;

      const outgoing = nonUsdtTransfers
        .filter((transfer) => {
          if (transfer.from_address !== input.subjectAddress) return false;
          if (!isNonEmptyAddress(transfer.to_address)) return false;
          if (transfer.to_address === input.subjectAddress) return false;
          if (tokenContract(transfer) !== continuationContract) return false;
          if (usedOutgoing.has(outgoingEventKey(transfer, continuationContract))) return false;
          const timestamp = transferTimestamp(transfer);
          return timestamp !== null &&
            timestamp >= inboundTime &&
            timestamp - inboundTime <= SAME_EPISODE_WINDOW_MS;
        })
        .sort((left, right) => {
          const leftTimestamp = transferTimestamp(left) ?? 0;
          const rightTimestamp = transferTimestamp(right) ?? 0;
          if (leftTimestamp !== rightTimestamp) return leftTimestamp - rightTimestamp;
          return left.transaction_id.localeCompare(right.transaction_id);
        })[0] ?? null;

      if (!outgoing) continue;

      const profileKey = [inbound.transaction_id, outgoing.transaction_id, continuationContract].join(":");
      if (seen.has(profileKey)) continue;
      seen.add(profileKey);
      usedOutgoing.add(outgoingEventKey(outgoing, continuationContract));

      const outgoingTime = transferTimestamp(outgoing);
      const elapsedMs = outgoingTime !== null ? outgoingTime - inboundTime : null;
      const quality = tokenQuality(inbound);
      const risk = await destinationRisk({
        address: outgoing.to_address,
        transfer: outgoing,
        getLabelsForAddress: input.getLabelsForAddress
      });
      const symbol = tokenSymbol(inbound);
      const score = scoreProfile({
        destinationRisk: risk,
        tokenQuality: quality,
        elapsedMs,
        sourceAmountRaw: usdtOut.quant
      });

      profiles.push({
        subjectAddress: input.subjectAddress,
        sourceAsset: "USDT",
        continuationAssetSymbol: symbol,
        continuationTokenContract: continuationContract,
        conversionTxHash: inbound.transaction_id,
        outgoingTxHash: outgoing.transaction_id,
        protocolAddress: usdtOut.to_address,
        destinationAddress: outgoing.to_address,
        destinationRisk: risk,
        elapsedMs,
        sourceAmountRaw: usdtOut.quant,
        continuationAmountRaw: outgoing.quant,
        tokenQuality: quality,
        score,
        evidenceClass: "asset_continuation",
        reasons: [
          profileReason({
            destinationRisk: risk,
            tokenQuality: quality,
            tokenSymbol: symbol
          })
        ]
      });
    }
  }

  return profiles
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      return left.conversionTxHash.localeCompare(right.conversionTxHash);
    })
    .slice(0, 5);
}
