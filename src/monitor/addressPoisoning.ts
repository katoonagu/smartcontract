import type { WalletAlertMode } from "../types";

export const ADDRESS_POISONING_POLICY_VERSION = "address-poisoning-v1";

const MAX_MATCH_ELAPSED_MS = 24 * 60 * 60 * 1_000;
const TRON_BASE58_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

export type RawTokenAmount = string | bigint;
export type AddressPoisoningCoverage = "complete" | "partial";
export type AddressSimilarityStrength = "strong" | "moderate" | "none";
export type AddressPoisoningClassification = "CRITICAL" | "HIGH";

export interface AddressSimilarity {
  rawPrefixLength: number;
  meaningfulPrefixLength: number;
  suffixLength: number;
  combinedPrefixSuffixMatch: boolean;
  strength: AddressSimilarityStrength;
}

export interface AddressPoisoningTransfer {
  txHash: string;
  sender: string;
  receiver: string;
  amountRaw: RawTokenAmount;
  tokenContract: string;
  tokenDecimals: number;
  occurredAt: Date;
}

export type AddressPoisoningSuppression =
  | { kind: "trusted_sender"; address: string }
  | { kind: "authoritative_service"; address: string };

export interface AddressPoisoningSenderAccount {
  createdAt?: Date | null;
}

export interface AddressPoisoningDetectionInput {
  incoming: AddressPoisoningTransfer;
  checkedTransfers: readonly AddressPoisoningTransfer[];
  coverage: AddressPoisoningCoverage;
  suppression: AddressPoisoningSuppression | null;
  senderAccount?: AddressPoisoningSenderAccount | null;
}

export interface AddressPoisoningMatch {
  classification: AddressPoisoningClassification;
  genuineRecipient: string;
  outgoingTxHash: string;
  outgoingAt: Date;
  outgoingAmountRaw: string;
  rawPrefixLength: number;
  meaningfulPrefixLength: number;
  suffixLength: number;
  combinedPrefixSuffixMatch: boolean;
  exactAmount: boolean;
  elapsedMs: number;
}

export type AddressPoisoningDetectionResult =
  | { kind: "candidate"; primary: AddressPoisoningMatch; secondary: AddressPoisoningMatch[] }
  | {
    kind: "clear";
    reason: "complete_no_match" | "trusted_sender" | "authoritative_service" | "prior_relationship";
  }
  | { kind: "inconclusive"; reason: "partial_no_match" | "invalid_input" };

export interface InitialAddressPoisoningCheckInput {
  amountRaw: RawTokenAmount;
  sender: string;
  receiver: string;
  eventAt: Date;
  now: Date;
  realtimeMaxAgeMs: number;
  maxAmountRaw: RawTokenAmount;
  alertMode: WalletAlertMode;
}

export type InitialAddressPoisoningCheckResult =
  | { status: "pending"; reason: null }
  | { status: "skipped" | "skipped_backfill"; reason: string };

function isValidTronAddress(value: string): boolean {
  return TRON_BASE58_ADDRESS.test(value);
}

function commonPrefixLength(left: string, right: string): number {
  let length = 0;
  while (length < left.length && length < right.length && left[length] === right[length]) length += 1;
  return length;
}

function commonSuffixLength(left: string, right: string): number {
  let length = 0;
  while (
    length < left.length
    && length < right.length
    && left[left.length - 1 - length] === right[right.length - 1 - length]
  ) length += 1;
  return length;
}

export function compareTronAddresses(real: string, candidate: string): AddressSimilarity {
  if (!isValidTronAddress(real) || !isValidTronAddress(candidate)) {
    return {
      rawPrefixLength: 0,
      meaningfulPrefixLength: 0,
      suffixLength: 0,
      combinedPrefixSuffixMatch: false,
      strength: "none"
    };
  }

  const rawPrefixLength = commonPrefixLength(real, candidate);
  const meaningfulPrefixLength = Math.max(0, rawPrefixLength - 1);
  const suffixLength = commonSuffixLength(real, candidate);
  if (real === candidate) {
    return {
      rawPrefixLength,
      meaningfulPrefixLength,
      suffixLength,
      combinedPrefixSuffixMatch: false,
      strength: "none"
    };
  }

  const combinedPrefixSuffixMatch = suffixLength >= 4 && meaningfulPrefixLength >= 3;
  const strong = suffixLength >= 6 || meaningfulPrefixLength >= 6 || combinedPrefixSuffixMatch;
  const moderate = !strong && (suffixLength === 5 || meaningfulPrefixLength === 5);
  return {
    rawPrefixLength,
    meaningfulPrefixLength,
    suffixLength,
    combinedPrefixSuffixMatch,
    strength: strong ? "strong" : moderate ? "moderate" : "none"
  };
}

function classificationRank(value: AddressPoisoningMatch): number {
  return value.classification === "CRITICAL" ? 2 : 1;
}

function compareRawStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareMatches(a: AddressPoisoningMatch, b: AddressPoisoningMatch): number {
  return classificationRank(b) - classificationRank(a)
    || (b.meaningfulPrefixLength + b.suffixLength) - (a.meaningfulPrefixLength + a.suffixLength)
    || Number(b.exactAmount) - Number(a.exactAmount)
    || a.elapsedMs - b.elapsedMs
    || b.outgoingAt.getTime() - a.outgoingAt.getTime()
    || compareRawStrings(a.outgoingTxHash, b.outgoingTxHash)
    || compareRawStrings(a.genuineRecipient, b.genuineRecipient)
    || compareRawStrings(a.outgoingAmountRaw, b.outgoingAmountRaw);
}

export function rankAddressPoisoningMatches(
  matches: readonly AddressPoisoningMatch[]
): AddressPoisoningMatch[] {
  return [...matches].sort(compareMatches);
}

function parseRawAmount(value: RawTokenAmount): bigint | null {
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (!/^\d+$/.test(value)) return null;
  return BigInt(value);
}

function validTransferToken(transfer: AddressPoisoningTransfer): boolean {
  return isValidTronAddress(transfer.tokenContract)
    && Number.isInteger(transfer.tokenDecimals)
    && transfer.tokenDecimals >= 0;
}

function isValidPoisoningTransfer(transfer: AddressPoisoningTransfer): boolean {
  const amount = parseRawAmount(transfer.amountRaw);
  return isValidTronAddress(transfer.sender)
    && isValidTronAddress(transfer.receiver)
    && transfer.sender !== transfer.receiver
    && validTransferToken(transfer)
    && amount !== null
    && amount > 0n
    && transfer.occurredAt instanceof Date
    && Number.isFinite(transfer.occurredAt.getTime())
    && typeof transfer.txHash === "string"
    && transfer.txHash.trim().length > 0;
}

function isEarlierDirectRelationship(
  transfer: AddressPoisoningTransfer,
  incoming: AddressPoisoningTransfer
): boolean {
  if (!isValidPoisoningTransfer(transfer)) return false;
  const elapsedMs = incoming.occurredAt.getTime() - transfer.occurredAt.getTime();
  return transfer.sender === incoming.receiver
    && transfer.receiver === incoming.sender
    && transfer.tokenContract === incoming.tokenContract
    && transfer.tokenDecimals === incoming.tokenDecimals
    && elapsedMs > 0
    && elapsedMs <= MAX_MATCH_ELAPSED_MS;
}

function exactSuppressionReason(
  suppression: AddressPoisoningSuppression | null,
  suspiciousSender: string
): "trusted_sender" | "authoritative_service" | null {
  if (!suppression || suppression.address !== suspiciousSender) return null;
  if (suppression.kind === "trusted_sender" || suppression.kind === "authoritative_service") {
    return suppression.kind;
  }
  return null;
}

export function detectAddressPoisoning(
  input: AddressPoisoningDetectionInput
): AddressPoisoningDetectionResult {
  if (!isValidPoisoningTransfer(input.incoming)) {
    return { kind: "inconclusive", reason: "invalid_input" };
  }

  const watchedWallet = input.incoming.receiver;
  const suspiciousSender = input.incoming.sender;
  const suppressionReason = exactSuppressionReason(input.suppression, suspiciousSender);
  if (suppressionReason) return { kind: "clear", reason: suppressionReason };

  const incomingAtMs = input.incoming.occurredAt.getTime();
  if (input.checkedTransfers.some((transfer) => isEarlierDirectRelationship(transfer, input.incoming))) {
    return { kind: "clear", reason: "prior_relationship" };
  }

  const incomingAmount = parseRawAmount(input.incoming.amountRaw);
  const matches: AddressPoisoningMatch[] = [];
  if (incomingAmount !== null) {
    for (const transfer of input.checkedTransfers) {
      if (!isValidPoisoningTransfer(transfer)) continue;
      const outgoingAtMs = transfer.occurredAt.getTime();
      const elapsedMs = incomingAtMs - outgoingAtMs;
      if (
        transfer.sender !== watchedWallet
        || transfer.receiver === watchedWallet
        || transfer.tokenContract !== input.incoming.tokenContract
        || transfer.tokenDecimals !== input.incoming.tokenDecimals
        || elapsedMs < 0
        || elapsedMs > MAX_MATCH_ELAPSED_MS
      ) continue;

      const similarity = compareTronAddresses(transfer.receiver, suspiciousSender);
      if (similarity.strength === "none") continue;
      const outgoingAmount = parseRawAmount(transfer.amountRaw);
      if (outgoingAmount === null) continue;
      const exactAmount = outgoingAmount === incomingAmount;
      matches.push({
        classification: similarity.strength === "strong" && exactAmount ? "CRITICAL" : "HIGH",
        genuineRecipient: transfer.receiver,
        outgoingTxHash: transfer.txHash,
        outgoingAt: transfer.occurredAt,
        outgoingAmountRaw: outgoingAmount.toString(),
        rawPrefixLength: similarity.rawPrefixLength,
        meaningfulPrefixLength: similarity.meaningfulPrefixLength,
        suffixLength: similarity.suffixLength,
        combinedPrefixSuffixMatch: similarity.combinedPrefixSuffixMatch,
        exactAmount,
        elapsedMs
      });
    }
  }

  const ranked = rankAddressPoisoningMatches(matches);
  if (ranked.length > 0) {
    return { kind: "candidate", primary: ranked[0], secondary: ranked.slice(1) };
  }
  return input.coverage === "complete"
    ? { kind: "clear", reason: "complete_no_match" }
    : { kind: "inconclusive", reason: "partial_no_match" };
}

export function initialAddressPoisoningCheckStatus(
  input: InitialAddressPoisoningCheckInput
): InitialAddressPoisoningCheckResult {
  const eventAtMs = input.eventAt.getTime();
  const nowMs = input.now.getTime();
  if (
    !Number.isFinite(eventAtMs)
    || !Number.isFinite(nowMs)
    || !Number.isFinite(input.realtimeMaxAgeMs)
    || input.realtimeMaxAgeMs < 0
    || eventAtMs > nowMs
  ) return { status: "skipped", reason: "invalid_input" };

  if (nowMs - eventAtMs > input.realtimeMaxAgeMs) {
    return { status: "skipped_backfill", reason: "older_than_realtime_window" };
  }
  if (input.alertMode === "paused") return { status: "skipped", reason: "paused" };
  if (!isValidTronAddress(input.sender) || !isValidTronAddress(input.receiver)) {
    return { status: "skipped", reason: "invalid_input" };
  }
  if (input.sender === input.receiver) return { status: "skipped", reason: "self_transfer" };

  const amount = parseRawAmount(input.amountRaw);
  const maxAmount = parseRawAmount(input.maxAmountRaw);
  if (amount === null || maxAmount === null) return { status: "skipped", reason: "invalid_input" };
  if (amount === 0n) return { status: "skipped", reason: "zero_amount" };
  if (amount > maxAmount) return { status: "skipped", reason: "above_max_amount" };
  return { status: "pending", reason: null };
}
