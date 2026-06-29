export type ContractDrivenReceiverLevel =
  | "none"
  | "contract_driven_transfer"
  | "contract_driven_cluster"
  | "contract_driven_service_context"
  | "drainer_like_pattern"
  | "dominant_drainer_like_pattern";

export type ContractDrivenReceiverRole =
  | "unknown"
  | "collector"
  | "service_context"
  | "drainer_like_collector"
  | "drainer_receiver_collector";

export type ContractDrivenEvidenceStrength = "none" | "context" | "strong" | "hard";

export interface ContractDrivenReceiverInput {
  totalIncomingTxCount: number;
  totalIncomingAmountRaw: string | number | bigint | null | undefined;
  contractDrivenIncomingTxCount: number;
  contractDrivenIncomingAmountRaw: string | number | bigint | null | undefined;
  uniqueSourceCount: number;
  dominantMethod: string | null;
  contractNames: string[];
  knownServiceIdentity: string | null;
  exactApprovalDrainCount: number;
}

export interface ContractDrivenReceiverClassification {
  level: ContractDrivenReceiverLevel;
  primaryRole: ContractDrivenReceiverRole;
  evidenceStrength: ContractDrivenEvidenceStrength;
  label: string;
  reasons: string[];
  contractDrivenTxShare: number;
  contractDrivenAmountShare: number;
}

export type SourcePostDebitActivityStatus =
  | "not_checked"
  | "victim_like_source"
  | "minor_residual_activity"
  | "repeated_residual_collection"
  | "active_after_debit";

export interface SourcePostDebitActivityInput {
  debitAmountRaw: string | number | bigint | null | undefined;
  laterIncomingAmountRaw: string | number | bigint | null | undefined;
  laterOutgoingAmountRaw: string | number | bigint | null | undefined;
  laterTxCount: number;
  repeatedContractDrivenDebitToSameReceiver: boolean;
  checked: boolean;
}

export interface SourcePostDebitActivityClassification {
  status: SourcePostDebitActivityStatus;
  victimLike: boolean;
  label: string;
  reasons: string[];
  residualActivityRatio: number;
}

const DOMINANT_DRAINER_AMOUNT_RAW = 100000000000n;
const DRAINER_AMOUNT_RAW = 50000000000n;
const CLUSTER_AMOUNT_RAW = 10000000000n;
const MINOR_RESIDUAL_AMOUNT_RAW = 500000000n;
const RATIO_SCALE = 1000000000n;

export function classifyContractDrivenReceiver(input: ContractDrivenReceiverInput): ContractDrivenReceiverClassification {
  const contractAmount = amountRaw(input.contractDrivenIncomingAmountRaw);
  const totalAmount = amountRaw(input.totalIncomingAmountRaw);
  const contractDrivenTxShare = share(input.contractDrivenIncomingTxCount, input.totalIncomingTxCount);
  const contractDrivenAmountShare = amountShare(contractAmount, totalAmount);

  if (input.contractDrivenIncomingTxCount <= 0) {
    return receiverClassification(
      "none",
      "unknown",
      "none",
      "No contract-driven incoming",
      [],
      contractDrivenTxShare,
      contractDrivenAmountShare
    );
  }

  const verify20Like = isVerify20Like(input.dominantMethod);
  const permitLike = isPermitLike(input.dominantMethod);
  const hasKnownService = input.knownServiceIdentity !== null && input.knownServiceIdentity.trim() !== "";
  const dominantShare = hasTxShare(input.contractDrivenIncomingTxCount, input.totalIncomingTxCount, 2)
    || hasAmountShare(contractAmount, totalAmount, 2);
  const drainerShare = hasTxShare(input.contractDrivenIncomingTxCount, input.totalIncomingTxCount, 4)
    || hasAmountShare(contractAmount, totalAmount, 4);

  if (
    input.contractDrivenIncomingTxCount >= 25
    && input.uniqueSourceCount >= 10
    && contractAmount >= DOMINANT_DRAINER_AMOUNT_RAW
    && dominantShare
    && verify20Like
    && !hasKnownService
  ) {
    return receiverClassification(
      "dominant_drainer_like_pattern",
      input.exactApprovalDrainCount > 0 ? "drainer_receiver_collector" : "drainer_like_collector",
      input.exactApprovalDrainCount > 0 ? "hard" : "strong",
      "Likely drainer campaign",
      drainerReasons(input),
      contractDrivenTxShare,
      contractDrivenAmountShare
    );
  }

  if (
    input.contractDrivenIncomingTxCount >= 10
    && input.uniqueSourceCount >= 5
    && contractAmount >= DRAINER_AMOUNT_RAW
    && drainerShare
    && verify20Like
    && !hasKnownService
  ) {
    return receiverClassification(
      "drainer_like_pattern",
      input.exactApprovalDrainCount > 0 ? "drainer_receiver_collector" : "drainer_like_collector",
      input.exactApprovalDrainCount > 0 ? "hard" : "strong",
      "Drainer-like contract pattern",
      drainerReasons(input),
      contractDrivenTxShare,
      contractDrivenAmountShare
    );
  }

  if (hasKnownService && permitLike) {
    return receiverClassification(
      "contract_driven_service_context",
      "service_context",
      "context",
      "Service contract-driven flow",
      [`Known service identity: ${input.knownServiceIdentity}`],
      contractDrivenTxShare,
      contractDrivenAmountShare
    );
  }

  if (
    (input.contractDrivenIncomingTxCount >= 3 && input.uniqueSourceCount >= 2)
    || contractAmount >= CLUSTER_AMOUNT_RAW
  ) {
    return receiverClassification(
      "contract_driven_cluster",
      "collector",
      "strong",
      "Contract-driven incoming cluster",
      ["Multiple contract-driven incoming transfers"],
      contractDrivenTxShare,
      contractDrivenAmountShare
    );
  }

  return receiverClassification(
    "contract_driven_transfer",
    "collector",
    "context",
    "Contract-driven incoming",
    ["Contract-driven incoming transfer"],
    contractDrivenTxShare,
    contractDrivenAmountShare
  );
}

export function classifySourcePostDebitActivity(input: SourcePostDebitActivityInput): SourcePostDebitActivityClassification {
  const laterIncoming = amountRaw(input.laterIncomingAmountRaw);
  const laterOutgoing = amountRaw(input.laterOutgoingAmountRaw);
  // ponytail: use the larger side to avoid double-counting residual churn; upgrade to per-tx deltas if direction matters.
  const laterTotal = laterIncoming > laterOutgoing ? laterIncoming : laterOutgoing;
  const debitAmount = amountRaw(input.debitAmountRaw);
  const residualActivityRatio = amountShare(laterTotal, debitAmount);

  if (!input.checked) {
    return sourceClassification("not_checked", false, "Source activity not checked", [], residualActivityRatio);
  }

  if (input.repeatedContractDrivenDebitToSameReceiver) {
    return sourceClassification("repeated_residual_collection", true, "Repeated residual collection", [
      "Repeated contract-driven debit to the same receiver"
    ], residualActivityRatio);
  }

  if (input.laterTxCount <= 0 || laterTotal === 0n) {
    return sourceClassification("victim_like_source", true, "No later USDT activity", [], residualActivityRatio);
  }

  if (laterTotal <= MINOR_RESIDUAL_AMOUNT_RAW && debitAmount > 0n && laterTotal * 20n <= debitAmount) {
    return sourceClassification("minor_residual_activity", true, "Only minor residual activity", [
      "Later activity is at most 5% of the debit"
    ], residualActivityRatio);
  }

  return sourceClassification("active_after_debit", false, "Active after debit", [], residualActivityRatio);
}

function receiverClassification(
  level: ContractDrivenReceiverLevel,
  primaryRole: ContractDrivenReceiverRole,
  evidenceStrength: ContractDrivenEvidenceStrength,
  label: string,
  reasons: string[],
  contractDrivenTxShare: number,
  contractDrivenAmountShare: number
): ContractDrivenReceiverClassification {
  return { level, primaryRole, evidenceStrength, label, reasons, contractDrivenTxShare, contractDrivenAmountShare };
}

function sourceClassification(
  status: SourcePostDebitActivityStatus,
  victimLike: boolean,
  label: string,
  reasons: string[],
  residualActivityRatio: number
): SourcePostDebitActivityClassification {
  return { status, victimLike, label, reasons, residualActivityRatio };
}

function isVerify20Like(method: string | null): boolean {
  return method?.toLowerCase().includes("verify20") === true;
}

function isPermitLike(method: string | null): boolean {
  return method?.toLowerCase().includes("permit") === true;
}

function hasTxShare(part: number, total: number, denominator: number): boolean {
  return total > 0 && part * denominator >= total;
}

function hasAmountShare(part: bigint, total: bigint, denominator: bigint | number): boolean {
  return total > 0n && part * BigInt(denominator) >= total;
}

function amountRaw(value: string | number | bigint | null | undefined): bigint {
  if (typeof value === "bigint") return value >= 0n ? value : 0n;
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : 0n;
  if (typeof value !== "string") return 0n;

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return 0n;

  try {
    return BigInt(trimmed);
  } catch {
    return 0n;
  }
}

function share(part: number, total: number): number {
  return clampShare(total > 0 ? part / total : 0);
}

function amountShare(part: bigint, total: bigint): number {
  if (total <= 0n || part <= 0n) return 0;
  if (part >= total) return 1;
  return clampShare(Number((part * RATIO_SCALE) / total) / Number(RATIO_SCALE));
}

function clampShare(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function drainerReasons(input: ContractDrivenReceiverInput): string[] {
  const reasons = ["Verify20-like method with explicit source and receiver fields"];
  if (input.exactApprovalDrainCount > 0) {
    reasons.push("Exact approval-drain evidence exists in this receiver campaign");
  }
  return reasons;
}
