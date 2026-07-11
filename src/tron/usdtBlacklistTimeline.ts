import { TronWeb } from "tronweb";
import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import type { TronScanBlacklistRow, UsdtBlacklistTimeline, UsdtBlacklistTimelineEvent } from "../types";

const ADDED_BLACKLIST_TOPIC = TronWeb.sha3("AddedBlackList(address)").toLowerCase();
const REMOVED_BLACKLIST_TOPIC = TronWeb.sha3("RemovedBlackList(address)").toLowerCase();
const TX_HASH_PATTERN = /^[0-9a-f]{64}$/i;
const MAX_UNIX_SECONDS = 9_999_999_999;
const TRON_MAINNET_GENESIS_MS = Date.UTC(2018, 5, 25);

type TimelineFailureReason = Exclude<UsdtBlacklistTimeline["failureReason"], null>;

export class BlacklistTimelineValidationError extends Error {
  constructor(
    readonly failureReason: TimelineFailureReason,
    message: string
  ) {
    super(message);
  }
}

export type VerifiedBlacklistTransaction = {
  txHash: string;
  timestampMs: number;
  blockNumber: number;
};

function objectRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function safeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function nonNegativeSafeInteger(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value)) return null;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) ? numeric : null;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

type AliasResolution<T> =
  | { present: false; value: null }
  | { present: true; value: T };

function resolveAliases<T>(
  record: Record<string, unknown>,
  aliases: readonly string[],
  parse: (value: unknown) => T | null
): AliasResolution<T> | null {
  let resolved: T | null = null;
  let present = false;
  for (const alias of aliases) {
    if (!hasOwn(record, alias)) continue;
    present = true;
    const parsed = parse(record[alias]);
    if (parsed === null || (resolved !== null && resolved !== parsed)) return null;
    resolved = parsed;
  }
  return present && resolved !== null
    ? { present: true, value: resolved }
    : { present: false, value: null };
}

function normalizeTronAddress(value: unknown): string | null {
  const raw = nonEmptyString(value);
  if (!raw) return null;
  try {
    if (raw.startsWith("T")) {
      const hex = TronWeb.address.toHex(raw);
      return /^41[0-9a-f]{40}$/i.test(hex) ? TronWeb.address.fromHex(hex) : null;
    }
    const hex = raw.replace(/^0x/i, "");
    if (/^[0-9a-f]{40}$/i.test(hex)) return TronWeb.address.fromHex(`41${hex}`);
    if (/^41[0-9a-f]{40}$/i.test(hex)) return TronWeb.address.fromHex(hex);
  } catch {
    return null;
  }
  return null;
}

function normalizedTxHash(value: unknown): string | null {
  const raw = nonEmptyString(value);
  return raw && TX_HASH_PATTERN.test(raw) ? raw.toLowerCase() : null;
}

function parseBlacklistRow(value: unknown): TronScanBlacklistRow | null {
  const row = objectRecord(value);
  if (!row) return null;
  const blackAddress = normalizeTronAddress(row.blackAddress);
  const tokenName = nonEmptyString(row.tokenName);
  const num = nonEmptyString(row.num);
  const time = safeInteger(row.time);
  const transHash = normalizedTxHash(row.transHash);
  const contractAddress = normalizeTronAddress(row.contractAddress);
  if (
    !blackAddress ||
    !tokenName ||
    !num ||
    time === null ||
    time < 0 ||
    time > MAX_UNIX_SECONDS ||
    !transHash ||
    !contractAddress
  ) {
    return null;
  }
  return { blackAddress, tokenName, num, time, transHash, contractAddress };
}

export function parseBlacklistRows(rows: unknown, expectedAddress: string): TronScanBlacklistRow[] {
  const address = normalizeTronAddress(expectedAddress);
  if (!address) throw new BlacklistTimelineValidationError("address_mismatch", "Expected blacklist address is malformed");
  if (!Array.isArray(rows)) throw new BlacklistTimelineValidationError("provider_failed", "Blacklist rows are malformed");

  const byTransaction = new Map<string, TronScanBlacklistRow>();
  for (const value of rows) {
    const row = parseBlacklistRow(value);
    if (!row) throw new BlacklistTimelineValidationError("provider_failed", "Blacklist row is malformed");
    if (row.blackAddress !== address) {
      throw new BlacklistTimelineValidationError("address_mismatch", "Blacklist row address mismatch");
    }
    if (row.contractAddress !== TRON_USDT_CONTRACT_ADDRESS) {
      throw new BlacklistTimelineValidationError("wrong_contract", "Blacklist row contract mismatch");
    }
    const existing = byTransaction.get(row.transHash);
    if (existing && JSON.stringify(existing) !== JSON.stringify(row)) {
      throw new BlacklistTimelineValidationError("provider_failed", "Blacklist row has an ambiguous duplicate transaction");
    }
    byTransaction.set(row.transHash, row);
  }
  return [...byTransaction.values()];
}

function normalizedTopic(value: unknown): string | null {
  const raw = nonEmptyString(value)?.replace(/^0x/i, "").toLowerCase();
  return raw && /^[0-9a-f]{64}$/.test(raw) ? `0x${raw}` : null;
}

function addressFromTopic(value: unknown): string | null {
  const topic = normalizedTopic(value);
  return topic && topic.slice(2, 26) === "0".repeat(24)
    ? normalizeTronAddress(topic.slice(-40))
    : null;
}

function eventKindFromName(value: unknown): UsdtBlacklistTimelineEvent["eventKind"] | null {
  if (value === "AddedBlackList") return "added";
  if (value === "RemovedBlackList") return "removed";
  return null;
}

function eventKindFromSignature(value: unknown): UsdtBlacklistTimelineEvent["eventKind"] | null {
  if (value === "AddedBlackList(address)") return "added";
  if (value === "RemovedBlackList(address)") return "removed";
  return null;
}

function eventKindFromTopic(value: unknown): UsdtBlacklistTimelineEvent["eventKind"] | null {
  const topic = normalizedTopic(value);
  if (topic === ADDED_BLACKLIST_TOPIC) return "added";
  if (topic === REMOVED_BLACKLIST_TOPIC) return "removed";
  return null;
}

function eventTimestamp(value: unknown): string | null {
  const timestamp = safeInteger(value);
  if (timestamp === null || timestamp < TRON_MAINNET_GENESIS_MS) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function eventSuccess(event: Record<string, unknown>): boolean {
  const values: unknown[] = [];
  for (const alias of ["contractRet", "contract_ret"] as const) {
    if (hasOwn(event, alias)) values.push(event[alias]);
  }
  if (hasOwn(event, "receipt")) {
    const receipt = objectRecord(event.receipt);
    if (!receipt) return false;
    if (hasOwn(receipt, "result")) values.push(receipt.result);
  }
  let success: string | null = null;
  for (const value of values) {
    const parsed = nonEmptyString(value)?.toUpperCase() ?? null;
    if (!parsed || (success !== null && success !== parsed)) return false;
    success = parsed;
  }
  return event.confirmed === true && success === "SUCCESS";
}

function verifyEvent(value: unknown, expectedAddress: string): UsdtBlacklistTimelineEvent | null {
  const event = objectRecord(value);
  if (!event || !eventSuccess(event)) return null;
  const contractAddress = resolveAliases(
    event,
    ["contract_address", "contractAddress", "address"],
    normalizeTronAddress
  );
  if (!contractAddress?.present || contractAddress.value !== TRON_USDT_CONTRACT_ADDRESS) return null;

  const topics = event.topics;
  const topicsPresent = hasOwn(event, "topics");
  if (topicsPresent && !Array.isArray(topics)) return null;
  if (Array.isArray(topics) && topics.length !== 2) return null;
  const topicKind = topicsPresent && Array.isArray(topics) ? eventKindFromTopic(topics[0]) : null;
  const namedKind = resolveAliases(event, ["event_name", "eventName"], eventKindFromName);
  const signatureKind = resolveAliases(event, ["event"], eventKindFromSignature);
  if (!namedKind || !signatureKind) return null;
  if (Array.isArray(topics) && !topicKind) return null;
  if (namedKind.present && topicKind && namedKind.value !== topicKind) return null;
  const eventKind = topicKind ?? namedKind.value ?? signatureKind.value;
  if (signatureKind.present && eventKind && signatureKind.value !== eventKind) return null;
  if (!eventKind) return null;

  const result = hasOwn(event, "result") ? objectRecord(event.result) : null;
  if (hasOwn(event, "result") && !result) return null;
  const decodedUser = result && hasOwn(result, "_user") ? normalizeTronAddress(result._user) : null;
  const topicUser = Array.isArray(topics) ? addressFromTopic(topics[1]) : null;
  if (result && hasOwn(result, "_user") && !decodedUser) return null;
  if (Array.isArray(topics) && !topicUser) return null;
  if (decodedUser && topicUser && decodedUser !== topicUser) return null;
  if ((topicUser ?? decodedUser) !== expectedAddress) return null;

  const txHash = resolveAliases(event, ["transaction_id", "transactionId", "transaction"], normalizedTxHash);
  const blockNumber = resolveAliases(event, ["block_number", "blockNumber"], safeInteger);
  const logIndex = resolveAliases(event, ["event_index", "log_index", "eventIndex", "logIndex"], nonNegativeSafeInteger);
  const occurredAt = resolveAliases(event, ["block_timestamp", "blockTimestamp", "blockTimeStamp"], eventTimestamp);
  if (
    !txHash?.present ||
    !blockNumber?.present || blockNumber.value < 0 ||
    !logIndex?.present || logIndex.value < 0 ||
    !occurredAt?.present
  ) return null;

  return {
    eventKind,
    occurredAt: occurredAt.value,
    txHash: txHash.value,
    tokenContract: TRON_USDT_CONTRACT_ADDRESS,
    blockNumber: blockNumber.value,
    logIndex: logIndex.value,
    verification: "verified_contract_log"
  };
}

export function verifyBlacklistEvent(events: unknown, address: string): UsdtBlacklistTimelineEvent | null {
  const expectedAddress = normalizeTronAddress(address);
  if (!expectedAddress || !Array.isArray(events)) return null;
  const verified = events
    .map((event) => verifyEvent(event, expectedAddress))
    .filter((event): event is UsdtBlacklistTimelineEvent => event !== null);
  return verified.length === 1 ? verified[0] : null;
}

export function verifyBlacklistTransaction(
  value: unknown,
  row: TronScanBlacklistRow
): VerifiedBlacklistTransaction | null {
  const transaction = objectRecord(value);
  if (!transaction) return null;
  const txHash = normalizedTxHash(transaction.hash);
  const timestampMs = safeInteger(transaction.timestamp);
  const blockNumber = safeInteger(transaction.block);
  if (
    txHash !== row.transHash ||
    transaction.confirmed !== true ||
    transaction.revert !== false ||
    nonEmptyString(transaction.contractRet)?.toUpperCase() !== "SUCCESS" ||
    timestampMs === null ||
    timestampMs < TRON_MAINNET_GENESIS_MS ||
    Math.floor(timestampMs / 1000) !== row.time ||
    blockNumber === null ||
    blockNumber < 0
  ) {
    return null;
  }
  return { txHash, timestampMs, blockNumber };
}

export function verifyBlacklistEventForRow(
  events: unknown,
  address: string,
  row: TronScanBlacklistRow,
  transaction: VerifiedBlacklistTransaction
): UsdtBlacklistTimelineEvent | null {
  if (!Array.isArray(events)) return null;
  const normalizedEvents = events.map((value) => {
    const event = objectRecord(value);
    if (!event) return value;
    const receipt = objectRecord(event.receipt);
    const hasSuccess = hasOwn(event, "contractRet") ||
      hasOwn(event, "contract_ret") ||
      (receipt ? hasOwn(receipt, "result") : false);
    return {
      ...event,
      ...(hasOwn(event, "confirmed") ? {} : { confirmed: true }),
      ...(hasSuccess ? {} : { contractRet: "SUCCESS" })
    };
  });
  const event = verifyBlacklistEvent(normalizedEvents, address);
  if (!event) return null;
  if (
    event.txHash !== row.transHash ||
    event.blockNumber !== transaction.blockNumber ||
    Math.floor(Date.parse(event.occurredAt) / 1000) !== row.time ||
    Date.parse(event.occurredAt) !== transaction.timestampMs
  ) {
    return null;
  }
  return event;
}

export function sortBlacklistTimelineEvents(
  events: readonly UsdtBlacklistTimelineEvent[]
): UsdtBlacklistTimelineEvent[] | null {
  const sorted = [...events].sort((left, right) =>
    (left.blockNumber ?? -1) - (right.blockNumber ?? -1) ||
    (left.logIndex ?? -1) - (right.logIndex ?? -1)
  );
  for (let index = 1; index < sorted.length; index++) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (
      previous.blockNumber === null ||
      previous.logIndex === null ||
      current.blockNumber === null ||
      current.logIndex === null ||
      Date.parse(previous.occurredAt) > Date.parse(current.occurredAt) ||
      (
        previous.txHash !== current.txHash &&
        previous.blockNumber === current.blockNumber &&
        previous.logIndex === current.logIndex
      )
    ) {
      return null;
    }
  }
  return sorted;
}

export function reconstructedBlacklistState(events: readonly UsdtBlacklistTimelineEvent[]): boolean {
  return events.at(-1)?.eventKind === "added";
}
