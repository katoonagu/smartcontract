import { TRON_USDT_CONTRACT_ADDRESS, type RawTronscanTrc20Transfer } from "../parser/transactionParser";
import { calculateRisk, type RiskSignal } from "../risk/riskEngine";
import type { AddressLabel, RiskReport } from "../types";
import type { TronscanAccount } from "../tron/tronClient";

const SUN_DECIMALS = 6;
const USDT_DECIMALS = 6;
const VERY_NEW_VOLUME_MICRO = 10000n * 10n ** BigInt(USDT_DECIMALS);
const NEW_HIGH_VOLUME_MICRO = 50000n * 10n ** BigInt(USDT_DECIMALS);

export type AccountMetrics = {
  trxBalanceSun: bigint;
  trxBalanceTrx: string;
  usdtBalanceMicro: bigint;
  usdtBalanceUsdt: string;
  walletCreatedAt: Date | null;
  walletAgeDays: number | null;
  incomingTxCount: number | null;
  outgoingTxCount: number | null;
  totalTxCount: number | null;
  trxUsd: number | null;
};

export type ParseAccountMetricsOptions = {
  now?: Date;
};

export type UsdtTransferFlowMetrics = {
  inMicro: bigint;
  outMicro: bigint;
  volumeMicro: bigint;
  inUsdt: string;
  outUsdt: string;
  volumeUsdt: string;
  transferCount: number;
};

export type FeeSummary = {
  feeSun: bigint;
  feeTrx: string;
  feeUsd: string | null;
};

export type SafetyConfidence = {
  level: "limited";
  checked: string[];
  notConnected: string[];
};

export type RiskModuleStatus = {
  code:
    | "internal_labels"
    | "wallet_activity"
    | "incoming_monitor"
    | "aml_providers"
    | "hop_graph"
    | "behavior_patterns"
    | "approvals_security"
    | "bridge_tracing"
    | "case_forensics";
  label: string;
  status: "active" | "limited" | "not_connected" | "planned";
};

export type WalletSafetyReport = RiskReport & {
  confidence: SafetyConfidence;
  modules: RiskModuleStatus[];
};

export type CalculateWalletSafetyInput = {
  address: string;
  labels: AddressLabel[];
  walletAgeDays: number | null;
  thirtyDayUsdtVolumeMicro: bigint | string | number;
};

export type WalletMetricConsistency =
  | "snapshot_exact"
  | "snapshot_reconstructed"
  | "profile_only";

export type WalletAmountAggregate = {
  key: string;
  amountRaw: string;
  transferCount: number;
  factIds: string[];
};

export type WalletMetrics = {
  version: "unified-wallet-metrics-v1";
  asOfBlock: string;
  observedAt: string;
  consistency: Exclude<WalletMetricConsistency, "profile_only">;
  profile: {
    createdAt: string | null;
    firstUsdtActivityAt: string | null;
    lastUsdtActivityAt: string | null;
    incomingUsdtTransferCount: number;
    outgoingUsdtTransferCount: number;
    snapshotUsdtBalanceRaw: string;
    snapshotTrxBalanceSun: string;
    liveBalanceObservation: null | {
      usdtBalanceRaw: string;
      trxBalanceSun: string;
      asOfBlock: string | null;
      observedAt: string;
      consistency: WalletMetricConsistency;
    };
  };
  scoreDrivers: Array<{
    code: string;
    factIds: string[];
    collapsedFactCount: number;
  }>;
  currentBalanceAttribution: {
    scope: "current_balance_attribution";
    denominatorRaw: string;
    rows: WalletAmountAggregate[];
  };
  outgoingMovement: {
    scope: "all_direct_outgoing_to_snapshot";
    denominatorRaw: string;
    rows: WalletAmountAggregate[];
  };
  serviceLinks: Array<{
    service: string;
    address: string;
    direction: "incoming" | "outgoing";
    directness: "direct" | "indirect";
    amountRaw: string;
    denominatorRaw: string;
    transferCount: number;
    factIds: string[];
  }>;
  contractsAndApprovals: Array<{
    code: string;
    counterparty: string | null;
    amountRaw: string | null;
    factIds: string[];
  }>;
  behaviorAndConnections: Array<{
    code: string;
    role: string;
    factIds: string[];
    collapsedFactCount: number;
  }>;
  coverage: Array<{
    direction: "backward" | "forward";
    selectionPpm: number;
    tracePpm: number;
    identifiedPpm: number;
    unknownBoundaryPpm: number;
    untracedPpm: number;
  }>;
  principalInboundEvents: Array<{
    eventId: string;
    txHash: string;
    timestamp: string;
    fromAddress: string;
    amountRaw: string;
    factIds: string[];
  }>;
  negativeFacts: Array<{
    code: string;
    scope: string;
    scopeStatus: "COMPLETED" | "INCOMPLETE" | "NOT_APPLICABLE";
    factIds: string[];
  }>;
};

type TokenBalanceRecord = {
  tokenId?: unknown;
  token_id?: unknown;
  contract_address?: unknown;
  contractAddress?: unknown;
  balance?: unknown;
  quantity?: unknown;
  amount?: unknown;
  tokenPriceInTrx?: unknown;
  tokenInfo?: {
    tokenId?: unknown;
    tokenPriceInTrx?: unknown;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseUnsignedInteger(value: unknown): bigint | null {
  if (typeof value === "bigint") {
    return value >= 0n ? value : null;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    return BigInt(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    return BigInt(trimmed);
  }
  return null;
}

function parseSafeNonNegativeInteger(value: unknown): number | null {
  const parsed = parseUnsignedInteger(value);
  if (parsed === null || parsed > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(parsed);
}

function formatUnits(value: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = value % divisor;
  if (fraction === 0n) return whole.toString();
  const fractionText = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fractionText}`;
}

function trimFixed(value: string): string {
  return value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

function parseTimestampMs(value: unknown): Date | null {
  const timestamp = parseSafeNonNegativeInteger(value);
  if (timestamp === null) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function calculateWalletAgeDays(createdAt: Date | null, now: Date): number | null {
  if (!createdAt) return null;
  const diffMs = now.getTime() - createdAt.getTime();
  if (!Number.isFinite(diffMs)) return null;
  return Math.max(0, Math.floor(diffMs / 86_400_000));
}

function findOfficialUsdtBalance(account: TronscanAccount): TokenBalanceRecord | null {
  const balances = Array.isArray(account.trc20token_balances)
    ? account.trc20token_balances
    : Array.isArray(account.tokenBalances)
      ? account.tokenBalances
      : [];

  for (const candidate of balances) {
    if (!isRecord(candidate)) continue;
    const balance = candidate as TokenBalanceRecord;
    const tokenId =
      balance.tokenId ??
      balance.token_id ??
      balance.contract_address ??
      balance.contractAddress ??
      balance.tokenInfo?.tokenId;
    if (tokenId === TRON_USDT_CONTRACT_ADDRESS) {
      return balance;
    }
  }

  return null;
}

function parsePositiveNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function parseUsdtBalanceMicro(balance: TokenBalanceRecord | null): bigint {
  if (!balance) return 0n;
  return parseUnsignedInteger(balance.balance ?? balance.quantity ?? balance.amount) ?? 0n;
}

function parseTrxUsd(balance: TokenBalanceRecord | null): number | null {
  if (!balance) return null;
  const tokenPriceInTrx = parsePositiveNumber(balance.tokenPriceInTrx ?? balance.tokenInfo?.tokenPriceInTrx);
  if (tokenPriceInTrx === null) return null;
  return 1 / tokenPriceInTrx;
}

export function parseAccountMetrics(
  account: TronscanAccount,
  options: ParseAccountMetricsOptions = {}
): AccountMetrics {
  const officialUsdtBalance = findOfficialUsdtBalance(account);
  const trxBalanceSun = parseUnsignedInteger(account.balance) ?? 0n;
  const usdtBalanceMicro = parseUsdtBalanceMicro(officialUsdtBalance);
  const walletCreatedAt = parseTimestampMs(account.date_created);

  return {
    trxBalanceSun,
    trxBalanceTrx: formatUnits(trxBalanceSun, SUN_DECIMALS),
    usdtBalanceMicro,
    usdtBalanceUsdt: formatUnits(usdtBalanceMicro, USDT_DECIMALS),
    walletCreatedAt,
    walletAgeDays: calculateWalletAgeDays(walletCreatedAt, options.now ?? new Date()),
    incomingTxCount: parseSafeNonNegativeInteger(account.transactions_in),
    outgoingTxCount: parseSafeNonNegativeInteger(account.transactions_out),
    totalTxCount: parseSafeNonNegativeInteger(account.totalTransactionCount),
    trxUsd: parseTrxUsd(officialUsdtBalance)
  };
}

function isOfficialUsdtTransfer(raw: RawTronscanTrc20Transfer): boolean {
  const tokenId = raw.contract_address ?? raw.tokenInfo?.tokenId;
  return tokenId === TRON_USDT_CONTRACT_ADDRESS;
}

function isSuccessfulTransfer(raw: RawTronscanTrc20Transfer): boolean {
  if (raw.confirmed !== true) return false;
  if (raw.revert === true) return false;
  if (raw.contractRet !== undefined && raw.contractRet !== "SUCCESS") return false;
  if (raw.finalResult !== undefined && raw.finalResult !== "SUCCESS") return false;
  if (raw.status !== undefined && raw.status !== 0 && raw.status !== "0" && raw.status !== "SUCCESS") return false;
  return true;
}

export function calculateUsdtTransferFlow(
  walletAddress: string,
  transfers: RawTronscanTrc20Transfer[]
): UsdtTransferFlowMetrics {
  let inMicro = 0n;
  let outMicro = 0n;
  let transferCount = 0;

  for (const transfer of transfers) {
    if (!isOfficialUsdtTransfer(transfer)) continue;
    if (!isSuccessfulTransfer(transfer)) continue;
    const amount = parseUnsignedInteger(transfer.quant);
    if (amount === null) continue;

    let matchedWallet = false;
    if (transfer.to_address === walletAddress) {
      inMicro += amount;
      matchedWallet = true;
    }
    if (transfer.from_address === walletAddress) {
      outMicro += amount;
      matchedWallet = true;
    }
    if (matchedWallet) {
      transferCount += 1;
    }
  }

  const volumeMicro = inMicro + outMicro;
  return {
    inMicro,
    outMicro,
    volumeMicro,
    inUsdt: formatUnits(inMicro, USDT_DECIMALS),
    outUsdt: formatUnits(outMicro, USDT_DECIMALS),
    volumeUsdt: formatUnits(volumeMicro, USDT_DECIMALS),
    transferCount
  };
}

function isSuccessfulTransaction(record: Record<string, unknown>): boolean {
  if (record.confirmed === false) return false;
  if (record.revert === true) return false;

  for (const field of ["contractRet", "finalResult", "result"]) {
    const value = record[field];
    if (value !== undefined && value !== "SUCCESS") return false;
  }

  const status = record.status;
  if (status !== undefined && status !== 0 && status !== "0" && status !== "SUCCESS") return false;
  return true;
}

function extractFeeSun(record: Record<string, unknown>): bigint | null {
  const cost = record.cost;
  if (!isRecord(cost)) return null;
  return parseUnsignedInteger(cost.fee);
}

function formatUsdFromTrxAmount(trxAmount: string, trxUsd: number | null | undefined): string | null {
  if (trxUsd === null || trxUsd === undefined || !Number.isFinite(trxUsd) || trxUsd <= 0) return null;
  const trx = Number(trxAmount);
  if (!Number.isFinite(trx)) return null;
  return trimFixed((trx * trxUsd).toFixed(6));
}

export function calculateFeeSummary(
  walletAddress: string,
  transactions: unknown[],
  options: { trxUsd?: number | null } = {}
): FeeSummary {
  let feeSun = 0n;

  for (const transaction of transactions) {
    if (!isRecord(transaction)) continue;
    if (transaction.ownerAddress !== walletAddress) continue;
    if (!isSuccessfulTransaction(transaction)) continue;
    const fee = extractFeeSun(transaction);
    if (fee === null) continue;
    feeSun += fee;
  }

  const feeTrx = formatUnits(feeSun, SUN_DECIMALS);
  return {
    feeSun,
    feeTrx,
    feeUsd: formatUsdFromTrxAmount(feeTrx, options.trxUsd)
  };
}

function buildActivitySignals(walletAgeDays: number | null, volumeMicro: bigint): RiskSignal[] {
  if (walletAgeDays === null) return [];

  const signals: RiskSignal[] = [];
  if (walletAgeDays < 30 && volumeMicro > NEW_HIGH_VOLUME_MICRO) {
    signals.push({
      code: "new_wallet_high_volume",
      message: "Wallet age under 30 days with more than 50,000 USDT 30d volume",
      scoreImpact: 20
    });
  }
  if (walletAgeDays < 7 && volumeMicro > VERY_NEW_VOLUME_MICRO) {
    signals.push({
      code: "very_new_wallet_active",
      message: "Wallet age under 7 days with more than 10,000 USDT 30d volume",
      scoreImpact: 20
    });
  }

  return signals;
}

export function calculateWalletSafetyReport(input: CalculateWalletSafetyInput): WalletSafetyReport {
  const volumeMicro = parseUnsignedInteger(input.thirtyDayUsdtVolumeMicro) ?? 0n;
  const labels = input.labels.filter((label) => label.address === input.address);
  const report = calculateRisk({
    subjectAddress: input.address,
    labels,
    graphSignals: [],
    behaviorSignals: buildActivitySignals(input.walletAgeDays, volumeMicro),
    amlSignals: []
  });

  return {
    ...report,
    confidence: {
      level: "limited",
      checked: ["internal labels", "wallet age", "30d activity", "incoming monitor", "USDT approvals"],
      notConnected: ["AML", "graph proximity"]
    },
    modules: [
      { code: "internal_labels", label: "Internal labels", status: "active" },
      { code: "wallet_activity", label: "Wallet activity", status: "limited" },
      { code: "incoming_monitor", label: "Incoming monitor", status: "active" },
      { code: "aml_providers", label: "AML providers", status: "not_connected" },
      { code: "hop_graph", label: "Hop1/Hop2 graph", status: "planned" },
      { code: "behavior_patterns", label: "Behavioral patterns", status: "planned" },
      { code: "approvals_security", label: "Approvals/security", status: "limited" },
      { code: "bridge_tracing", label: "Bridge tracing", status: "planned" },
      { code: "case_forensics", label: "Case forensics", status: "planned" }
    ]
  };
}

function validIsoTimestamp(value: string | null): boolean {
  if (value === null) return true;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function validRaw(value: string): boolean {
  return /^(0|[1-9][0-9]*)$/u.test(value);
}

function validFactIds(values: string[]): boolean {
  return values.length > 0 &&
    values.every((value) => value.length > 0) &&
    new Set(values).size === values.length;
}

function validCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validPpm(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000;
}

export function canonicalizeUnifiedWalletMetrics(
  input: WalletMetrics
): WalletMetrics {
  if (
    input.version !== "unified-wallet-metrics-v1" ||
    !validRaw(input.asOfBlock) ||
    !validIsoTimestamp(input.observedAt) ||
    !validIsoTimestamp(input.profile.createdAt) ||
    !validIsoTimestamp(input.profile.firstUsdtActivityAt) ||
    !validIsoTimestamp(input.profile.lastUsdtActivityAt) ||
    !validCount(input.profile.incomingUsdtTransferCount) ||
    !validCount(input.profile.outgoingUsdtTransferCount) ||
    !validRaw(input.profile.snapshotUsdtBalanceRaw) ||
    !validRaw(input.profile.snapshotTrxBalanceSun)
  ) {
    throw new TypeError("unified_wallet_metrics_invalid");
  }
  const live = input.profile.liveBalanceObservation;
  if (
    live !== null &&
    (
      !validRaw(live.usdtBalanceRaw) ||
      !validRaw(live.trxBalanceSun) ||
      (live.asOfBlock !== null && !validRaw(live.asOfBlock)) ||
      !validIsoTimestamp(live.observedAt) ||
      (live.consistency === "profile_only" && live.asOfBlock !== null)
    )
  ) {
    throw new TypeError("unified_wallet_metrics_live_balance_invalid");
  }
  const aggregates = [
    ...input.currentBalanceAttribution.rows,
    ...input.outgoingMovement.rows
  ];
  if (
    input.currentBalanceAttribution.scope !== "current_balance_attribution" ||
    input.outgoingMovement.scope !== "all_direct_outgoing_to_snapshot" ||
    !validRaw(input.currentBalanceAttribution.denominatorRaw) ||
    !validRaw(input.outgoingMovement.denominatorRaw) ||
    aggregates.some((item) =>
      item.key.length === 0 ||
      !validRaw(item.amountRaw) ||
      !validCount(item.transferCount) ||
      !validFactIds(item.factIds)
    ) ||
    input.scoreDrivers.some((item) =>
      item.code.length === 0 ||
      !validCount(item.collapsedFactCount) ||
      item.collapsedFactCount === 0 ||
      !validFactIds(item.factIds)
    ) ||
    input.serviceLinks.some((item) =>
      item.service.length === 0 ||
      item.address.length === 0 ||
      !validRaw(item.amountRaw) ||
      !validRaw(item.denominatorRaw) ||
      !validCount(item.transferCount) ||
      !validFactIds(item.factIds)
    ) ||
    input.contractsAndApprovals.some((item) =>
      item.code.length === 0 ||
      (item.amountRaw !== null && !validRaw(item.amountRaw)) ||
      !validFactIds(item.factIds)
    ) ||
    input.behaviorAndConnections.some((item) =>
      item.code.length === 0 ||
      item.role.length === 0 ||
      !validCount(item.collapsedFactCount) ||
      item.collapsedFactCount === 0 ||
      !validFactIds(item.factIds)
    ) ||
    input.coverage.some((item) =>
      ![
        item.selectionPpm,
        item.tracePpm,
        item.identifiedPpm,
        item.unknownBoundaryPpm,
        item.untracedPpm
      ].every(validPpm)
    ) ||
    input.principalInboundEvents.some((item) =>
      item.eventId.length === 0 ||
      !/^[a-f0-9]{64}$/u.test(item.txHash) ||
      !validIsoTimestamp(item.timestamp) ||
      item.fromAddress.length === 0 ||
      !validRaw(item.amountRaw) ||
      !validFactIds(item.factIds)
    ) ||
    input.negativeFacts.some((item) =>
      item.code.length === 0 ||
      item.scope.length === 0 ||
      !validFactIds(item.factIds)
    )
  ) {
    throw new TypeError("unified_wallet_metrics_invalid");
  }
  return structuredClone(input);
}
