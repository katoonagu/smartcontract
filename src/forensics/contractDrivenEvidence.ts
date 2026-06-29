import { TronWeb } from "tronweb";
import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import type {
  ApprovalDrainProvenanceProfile,
  ContractDrivenReceiverProfile,
  ContractDrivenTransferProfile,
  ForensicRouteEdge,
  ServiceClassification
} from "../types";

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
  const transferFromLike = isTransferFromLike(input.dominantMethod);
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

  if (input.exactApprovalDrainCount > 0) {
    return receiverClassification(
      "drainer_like_pattern",
      "drainer_receiver_collector",
      "hard",
      "Exact approval-drain receiver",
      drainerReasons(input),
      contractDrivenTxShare,
      contractDrivenAmountShare
    );
  }

  if (hasKnownService && (permitLike || transferFromLike)) {
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

function isTransferFromLike(method: string | null): boolean {
  return method?.toLowerCase().includes("transferfrom") === true;
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
  const reasons = isVerify20Like(input.dominantMethod)
    ? ["Verify20-like method with explicit source and receiver fields"]
    : ["Contract-driven method with explicit source and receiver fields"];
  if (input.exactApprovalDrainCount > 0) {
    reasons.push("Exact approval-drain evidence exists in this receiver campaign");
  }
  return reasons;
}

export type BuildContractDrivenEvidenceProfilesInput = {
  subjectAddress: string;
  edges: ForensicRouteEdge[];
  classifications?: Map<string, ServiceClassification | null>;
  approvalDrainProvenanceProfiles?: ApprovalDrainProvenanceProfile[];
  getTransaction?: (txHash: string) => Promise<unknown | null>;
  fetchEdgesForAddress?: (address: string) => Promise<ForensicRouteEdge[]>;
  maxTransactionInfoFetches?: number;
  maxSourceActivityChecks?: number;
};

export type BuildContractDrivenEvidenceProfilesResult = {
  receiverProfile: ContractDrivenReceiverProfile | null;
  transferProfiles: ContractDrivenTransferProfile[];
};

export async function buildContractDrivenEvidenceProfiles(
  input: BuildContractDrivenEvidenceProfilesInput
): Promise<BuildContractDrivenEvidenceProfilesResult> {
  const subject = normalizeAddress(input.subjectAddress);
  const incomingEdges = input.edges.filter((edge) =>
    normalizeAddress(edge.toAddress) === subject && amountRaw(edge.amountRaw) > 0n
  );
  const contractDrivenEdges = incomingEdges.filter(methodLooksContractDriven);
  if (contractDrivenEdges.length === 0) {
    return { receiverProfile: null, transferProfiles: [] };
  }

  const sortedContractEdges = [...contractDrivenEdges].sort(compareEdgesForProfile);
  const maxTxInfo = Math.max(0, input.maxTransactionInfoFetches ?? 30);
  const profileEdges = sortedContractEdges.slice(0, maxTxInfo);
  const maxSourceChecks = Math.max(0, input.maxSourceActivityChecks ?? Math.min(20, maxTxInfo));
  const exactApprovalDrainCount = exactApprovalCountForSubject(
    input.approvalDrainProvenanceProfiles ?? [],
    input.subjectAddress
  );

  let sourceChecks = 0;
  const transferProfiles: ContractDrivenTransferProfile[] = [];
  for (const edge of profileEdges) {
    const txInfo = input.getTransaction ? await input.getTransaction(edge.txHash).catch(() => null) : null;
    const movement = matchingUsdtMovement(txInfo, edge) ?? {
      sourceAddress: edge.fromAddress,
      receiverAddress: edge.toAddress,
      amountRaw: edge.amountRaw
    };
    const method = methodDisplay(methodText(txInfo) || edge.method);
    const contractAddress = calledContractAddress(txInfo);
    const contractClassification = contractAddress
      ? classificationFor(input.classifications, contractAddress)
      : null;
    const contractName = contractDisplayName(txInfo, contractClassification);
    let sourcePostDebitActivity: ContractDrivenTransferProfile["sourcePostDebitActivity"];
    if (input.fetchEdgesForAddress && sourceChecks < maxSourceChecks) {
      sourceChecks += 1;
      // ponytail: post-debit activity is budget/page limited; upgrade to indexed full-history windows for final victim confidence.
      const sourceEdges = await input.fetchEdgesForAddress(movement.sourceAddress).catch(() => []);
      sourcePostDebitActivity = buildSourcePostDebitActivity({
        sourceAddress: movement.sourceAddress,
        receiverAddress: movement.receiverAddress,
        currentTxHash: edge.txHash,
        currentTimestamp: edge.timestamp,
        debitAmountRaw: movement.amountRaw,
        edges: sourceEdges
      });
    }
    transferProfiles.push({
      txHash: edge.txHash,
      timestamp: edge.timestamp.toISOString(),
      amountRaw: movement.amountRaw,
      amount: formatUsdtAmount(movement.amountRaw),
      method,
      callerAddress: transferCaller(txInfo),
      operatorAddress: transferCaller(txInfo),
      contractAddress,
      spenderAddress: contractAddress,
      contractName,
      sourceAddress: movement.sourceAddress,
      victimAddress: movement.sourceAddress,
      receiverAddress: movement.receiverAddress,
      sourcePostDebitActivity
    });
  }

  const methods = contractDrivenEdges
    .map((edge) => methodDisplay(edge.method))
    .filter((method): method is string => Boolean(method));
  const dominantMethod = dominantString(methods);
  const contractNames = uniqueStrings(transferProfiles
    .map((profile) => profile.contractName)
    .filter((value): value is string => Boolean(value)));
  const knownServiceIdentity = uniqueStrings(transferProfiles.flatMap((profile) => {
    const values = [];
    if (profile.contractAddress) {
      const classification = classificationFor(input.classifications, profile.contractAddress);
      if (classification?.identity && classification.isBoundary) values.push(classification.identity);
    }
    return values;
  }))[0] ?? null;

  return {
    receiverProfile: {
      totalIncomingTxCount: incomingEdges.length,
      totalIncomingAmountRaw: sumEdgeAmounts(incomingEdges).toString(),
      contractDrivenIncomingTxCount: contractDrivenEdges.length,
      contractDrivenIncomingAmountRaw: sumEdgeAmounts(contractDrivenEdges).toString(),
      uniqueSourceCount: new Set(contractDrivenEdges.map((edge) => normalizeAddress(edge.fromAddress))).size,
      dominantMethod,
      contractNames,
      knownServiceIdentity,
      exactApprovalDrainCount
    },
    transferProfiles
  };
}

function compareEdgesForProfile(left: ForensicRouteEdge, right: ForensicRouteEdge): number {
  const amountOrder = compareBigintDesc(amountRaw(left.amountRaw), amountRaw(right.amountRaw));
  if (amountOrder !== 0) return amountOrder;
  return right.timestamp.getTime() - left.timestamp.getTime();
}

function methodLooksContractDriven(edge: ForensicRouteEdge): boolean {
  const method = edge.method.toLowerCase();
  return edge.edgeType === "transfer_from" ||
    method.includes("verify20") ||
    method.includes("permit") ||
    method.includes("transferfrom");
}

function methodDisplay(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.includes("verify20")) return "Verify20";
  if (lower.includes("permittransfer")) return "permitTransfer";
  if (lower.includes("permit")) return "permitTransfer";
  if (lower.includes("transferfrom") || lower.includes("23b872dd")) return "transferFrom";
  return raw;
}

function buildSourcePostDebitActivity(input: {
  sourceAddress: string;
  receiverAddress: string;
  currentTxHash: string;
  currentTimestamp: Date;
  debitAmountRaw: string;
  edges: ForensicRouteEdge[];
}): NonNullable<ContractDrivenTransferProfile["sourcePostDebitActivity"]> {
  const source = normalizeAddress(input.sourceAddress);
  const receiver = normalizeAddress(input.receiverAddress);
  const laterEdges = input.edges.filter((edge) =>
    edge.txHash !== input.currentTxHash &&
    edge.timestamp.getTime() > input.currentTimestamp.getTime() &&
    (normalizeAddress(edge.fromAddress) === source || normalizeAddress(edge.toAddress) === source)
  );
  const laterIncoming = laterEdges
    .filter((edge) => normalizeAddress(edge.toAddress) === source)
    .reduce((sum, edge) => sum + amountRaw(edge.amountRaw), 0n);
  const laterOutgoing = laterEdges
    .filter((edge) => normalizeAddress(edge.fromAddress) === source)
    .reduce((sum, edge) => sum + amountRaw(edge.amountRaw), 0n);
  const repeatedContractDrivenDebitToSameReceiver = laterEdges.some((edge) =>
    normalizeAddress(edge.fromAddress) === source &&
    normalizeAddress(edge.toAddress) === receiver &&
    methodLooksContractDriven(edge)
  );
  return {
    checked: true,
    debitAmountRaw: input.debitAmountRaw,
    laterIncomingAmountRaw: laterIncoming.toString(),
    laterOutgoingAmountRaw: laterOutgoing.toString(),
    laterTxCount: laterEdges.length,
    repeatedContractDrivenDebitToSameReceiver
  };
}

function exactApprovalCountForSubject(profiles: ApprovalDrainProvenanceProfile[], subjectAddress: string): number {
  const subject = normalizeAddress(subjectAddress);
  return profiles.filter((profile) =>
    normalizeAddress(profile.subjectAddress) === subject ||
    normalizeAddress(profile.firstReceiverAddress) === subject
  ).length;
}

function sumEdgeAmounts(edges: ForensicRouteEdge[]): bigint {
  return edges.reduce((sum, edge) => sum + amountRaw(edge.amountRaw), 0n);
}

function compareBigintDesc(left: bigint, right: bigint): number {
  if (left === right) return 0;
  return left > right ? -1 : 1;
}

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function dominantString(values: Array<string | null>): string | null {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
}

function classificationFor(
  classifications: Map<string, ServiceClassification | null> | undefined,
  address: string
): ServiceClassification | null {
  return classifications?.get(address) ?? classifications?.get(normalizeAddress(address)) ?? null;
}

function contractDisplayName(transactionInfo: unknown, classification: ServiceClassification | null): string | null {
  if (classification?.identity) return classification.identity;
  const tx = isObjectRecord(transactionInfo) ? transactionInfo : null;
  const contractData = objectField(tx?.contractData);
  const contractInfo = objectField(tx?.contractInfo) ?? objectField(contractData?.contractInfo);
  return stringField(contractInfo?.name) ??
    stringField(contractInfo?.contractName) ??
    stringField(contractData?.name);
}

function matchingUsdtMovement(
  transactionInfo: unknown,
  edge: ForensicRouteEdge
): { sourceAddress: string; receiverAddress: string; amountRaw: string } | null {
  const rows = tokenTransferRows(transactionInfo);
  const edgeTo = normalizeAddress(edge.toAddress);
  const edgeAmountRaw = amountRaw(edge.amountRaw);
  const row = rows.find((candidate) => {
    if (!transferTokenLooksLikeUsdt(candidate)) return false;
    const toAddress = rowAddress(candidate, "to");
    if (!toAddress || normalizeAddress(toAddress) !== edgeTo) return false;
    const raw = transferRawAmount(candidate);
    return raw === null || edgeAmountRaw === 0n || raw === edgeAmountRaw;
  }) ?? rows.find((candidate) => {
    const toAddress = rowAddress(candidate, "to");
    return transferTokenLooksLikeUsdt(candidate) && toAddress !== null && normalizeAddress(toAddress) === edgeTo;
  });
  if (!row) return null;
  const sourceAddress = rowAddress(row, "from");
  const receiverAddress = rowAddress(row, "to");
  const raw = transferRawAmount(row);
  if (!sourceAddress || !receiverAddress) return null;
  return {
    sourceAddress,
    receiverAddress,
    amountRaw: raw?.toString() ?? edge.amountRaw
  };
}

function tokenTransferRows(transactionInfo: unknown): unknown[] {
  const tx = isObjectRecord(transactionInfo) ? transactionInfo : null;
  return [
    ...arrayField(tx?.trc20TransferInfo),
    ...arrayField(tx?.trc20TransferInfoList),
    ...arrayField(tx?.tokenTransferInfo),
    ...arrayField(tx?.tokenTransferInfoList),
    ...arrayField(tx?.transfers)
  ];
}

function transferCaller(transactionInfo: unknown): string | null {
  const tx = isObjectRecord(transactionInfo) ? transactionInfo : null;
  const contractData = objectField(tx?.contractData);
  const triggerInfo = objectField(tx?.trigger_info);
  const rawData = objectField(tx?.raw_data);
  const rawContract = objectField(arrayField(rawData?.contract)[0]);
  const rawParameter = objectField(rawContract?.parameter);
  const rawValue = objectField(rawParameter?.value);
  return tronAddressField(
    tx?.ownerAddress ??
    tx?.owner_address ??
    contractData?.ownerAddress ??
    contractData?.owner_address ??
    triggerInfo?.ownerAddress ??
    triggerInfo?.owner_address ??
    rawValue?.owner_address
  );
}

function calledContractAddress(transactionInfo: unknown): string | null {
  const tx = isObjectRecord(transactionInfo) ? transactionInfo : null;
  const contractData = objectField(tx?.contractData);
  const triggerInfo = objectField(tx?.trigger_info);
  const rawData = objectField(tx?.raw_data);
  const rawContract = objectField(arrayField(rawData?.contract)[0]);
  const rawParameter = objectField(rawContract?.parameter);
  const rawValue = objectField(rawParameter?.value);
  return tronAddressField(
    tx?.contractAddress ??
    tx?.contract_address ??
    contractData?.contractAddress ??
    contractData?.contract_address ??
    triggerInfo?.contractAddress ??
    triggerInfo?.contract_address ??
    rawValue?.contract_address
  );
}

function methodText(transactionInfo: unknown): string {
  const tx = isObjectRecord(transactionInfo) ? transactionInfo : null;
  const contractData = objectField(tx?.contractData);
  const triggerInfo = objectField(tx?.trigger_info);
  return [
    stringField(triggerInfo?.methodName),
    stringField(triggerInfo?.method),
    stringField(triggerInfo?.methodId),
    stringField(contractData?.function_selector),
    stringField(tx?.method),
    stringField(tx?.methodName)
  ].filter((value): value is string => Boolean(value)).join(" ");
}

function rowAddress(row: unknown, direction: "from" | "to"): string | null {
  const record = objectField(row);
  if (!record) return null;
  return tronAddressField(
    direction === "from"
      ? record.from_address ?? record.fromAddress ?? record.from
      : record.to_address ?? record.toAddress ?? record.to
  );
}

function transferRawAmount(row: unknown): bigint | null {
  const record = objectField(row);
  if (!record) return null;
  const value = record.quant ?? record.amount ?? record.value ?? record.rawAmount;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return BigInt(value.trim());
  return null;
}

function transferTokenLooksLikeUsdt(row: unknown): boolean {
  const record = objectField(row);
  if (!record) return false;
  const tokenInfo = objectField(record.tokenInfo);
  const contract = tronAddressField(record.contract_address ?? record.contractAddress ?? tokenInfo?.tokenId);
  const symbol = stringField(tokenInfo?.tokenAbbr) ?? stringField(tokenInfo?.symbol) ?? stringField(record.tokenSymbol);
  return contract === TRON_USDT_CONTRACT_ADDRESS || symbol?.toUpperCase() === "USDT";
}

function tronAddressField(value: unknown): string | null {
  const raw = stringField(value);
  if (!raw) return null;
  const normalized = raw.trim();
  if (/^41[0-9a-fA-F]{40}$/.test(normalized)) {
    try {
      return TronWeb.address.fromHex(normalized);
    } catch {
      return null;
    }
  }
  return normalized;
}

function objectField(value: unknown): Record<string, unknown> | null {
  return isObjectRecord(value) ? value : null;
}

function arrayField(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatUsdtAmount(raw: string): string | null {
  const amount = amountRaw(raw);
  if (amount <= 0n) return null;
  const whole = Number(amount / 1_000_000n);
  if (whole >= 1_000_000) return `${trimDecimal(whole / 1_000_000)}M USDT`;
  if (whole >= 1_000) return `${trimDecimal(whole / 1_000)}K USDT`;
  const fraction = Number(amount % 1_000_000n) / 1_000_000;
  return `${trimDecimal(whole + fraction)} USDT`;
}

function trimDecimal(value: number): string {
  return value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}
