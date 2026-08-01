import { createHash } from "node:crypto";
import { TronWeb } from "tronweb";
import type { ContractRiskContext } from "../approvals/contractIntelligence";
import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import type { ListTrc20ApprovalChangesInput, TronscanApprovalChange } from "../tron/tronClient";
import type {
  ApprovalDrainProvenanceProfile,
  ApprovalDrainReviewFinding,
  ApprovalDrainFalsePositiveGuard,
  ApprovalDrainSpenderResolution,
  ApprovalDrainSupportingFingerprint,
  ApprovalDrainTokenState,
  ForensicRouteEdge,
  RawEvidenceInput,
  RiskSignalObservationInput,
  RouteScoreFeature,
  ServiceCategory,
  ServiceClassification,
  StablecoinRestrictionProfile
} from "../types";
import { detectNormalServiceRoute, type NormalServiceRouteEvidence } from "./normalServiceRoute";
import { FORENSIC_ROUTE_POLICY_VERSION } from "./routeScorer";
import { extractServiceRouteEvidence, type ServiceRouteCategory } from "./serviceRouteEvidence";

export type ApprovalDrainLookupDeps = {
  getTransaction(txHash: string): Promise<unknown>;
  listTrc20ApprovalChanges(input: ListTrc20ApprovalChangesInput): Promise<TronscanApprovalChange[]>;
  getUsdtRestrictionStatus?(address: string, options?: { includeEventTimeline?: boolean }): Promise<StablecoinRestrictionProfile>;
};

export type BuildApprovalDrainProvenanceInput = {
  subjectAddress: string;
  edges: ForensicRouteEdge[];
  classifications?: Map<string, ServiceClassification | null>;
  contractProfiles?: Map<string, ContractRiskContext | null>;
  deps: ApprovalDrainLookupDeps;
  maxCandidates?: number;
  candidateRankingMode?: "amount_desc" | "suspicion_aware";
  approvalChangeLookupLimit?: number;
  minAmountPreservationRatio?: number;
};

export type ApprovalDrainProvenanceAnalysis = {
  profiles: ApprovalDrainProvenanceProfile[];
  reviewFindings: ApprovalDrainReviewFinding[];
};

const DEFAULT_MAX_CANDIDATES = 5;
const DEFAULT_APPROVAL_CHANGE_LOOKUP_LIMIT = 5;
const DEFAULT_MIN_AMOUNT_PRESERVATION_RATIO = 0.7;
const DEFAULT_ROUTE_LOOKAHEAD_MS = 24 * 60 * 60 * 1000;

function stableId(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function objectField(value: unknown): Record<string, unknown> | null {
  return isObjectRecord(value) ? value : null;
}

function arrayField(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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

function normalizedTronAddress(value: string): string | null {
  const address = value.trim();
  if (!address) return null;
  try {
    const hex = /^41[0-9a-fA-F]{40}$/.test(address)
      ? address
      : /^0x[0-9a-fA-F]{40}$/.test(address)
        ? `41${address.slice(2)}`
        : TronWeb.address.toHex(address);
    if (!/^41[0-9a-fA-F]{40}$/.test(hex)) return null;
    return TronWeb.address.fromHex(hex);
  } catch {
    return null;
  }
}

function sameTronAddress(left: string, right: string): boolean {
  const normalizedLeft = normalizedTronAddress(left);
  const normalizedRight = normalizedTronAddress(right);
  return normalizedLeft !== null && normalizedRight !== null
    ? normalizedLeft === normalizedRight
    : left.trim() === right.trim();
}

export function isAuthoritativeDirectApprovalDrainProfile(
  profile: ApprovalDrainProvenanceProfile,
  checkedSubjectAddress: string
): boolean {
  return profile.evidenceStrength === "exact_approval_and_transfer_from" &&
    profile.hopDepth === 0 &&
    sameTronAddress(profile.firstReceiverAddress, profile.subjectAddress) &&
    sameTronAddress(profile.subjectAddress, checkedSubjectAddress);
}

export function approvalDrainProfileEvidenceIds(profile: ApprovalDrainProvenanceProfile): string[] {
  return [...new Set([profile.approvalTxHash, profile.drainTxHash, ...profile.pathTxHashes])];
}

export function sameApprovalDrainProfileIdentity(
  left: ApprovalDrainProvenanceProfile,
  right: ApprovalDrainProvenanceProfile
): boolean {
  return sameTronAddress(left.subjectAddress, right.subjectAddress) &&
    sameTronAddress(left.victimAddress, right.victimAddress) &&
    sameTronAddress(left.spenderAddress, right.spenderAddress) &&
    sameTronAddress(left.firstReceiverAddress, right.firstReceiverAddress) &&
    left.hopDepth === right.hopDepth &&
    left.approvalTxHash === right.approvalTxHash &&
    left.drainTxHash === right.drainTxHash &&
    left.evidenceStrength === right.evidenceStrength &&
    left.pathTxHashes.length === right.pathTxHashes.length &&
    left.pathTxHashes.every((value, index) => value === right.pathTxHashes[index]) &&
    left.pathAddresses.length === right.pathAddresses.length &&
    left.pathAddresses.every((value, index) => sameTronAddress(value, right.pathAddresses[index] ?? ""));
}

function isPersistedApprovalDrainProvenanceProfile(value: unknown): value is ApprovalDrainProvenanceProfile {
  if (typeof value !== "object" || value === null) return false;
  const profile = value as Record<string, unknown>;
  return typeof profile.victimAddress === "string" &&
    typeof profile.approvalTxHash === "string" &&
    typeof profile.drainTxHash === "string" &&
    typeof profile.spenderAddress === "string" &&
    typeof profile.firstReceiverAddress === "string" &&
    typeof profile.subjectAddress === "string" &&
    (profile.hopDepth === 0 || profile.hopDepth === 1 || profile.hopDepth === 2) &&
    typeof profile.amountRaw === "string" &&
    typeof profile.amountPreservationRatio === "number" && Number.isFinite(profile.amountPreservationRatio) &&
    typeof profile.approvalAt === "string" &&
    typeof profile.drainAt === "string" &&
    Array.isArray(profile.pathTxHashes) && profile.pathTxHashes.every((item) => typeof item === "string") &&
    Array.isArray(profile.pathAddresses) && profile.pathAddresses.every((item) => typeof item === "string") &&
    typeof profile.score === "number" && Number.isFinite(profile.score) &&
    (profile.evidenceStrength === "exact_approval_and_transfer_from" || profile.evidenceStrength === "route_linked") &&
    (profile.subjectTokenState === null || typeof profile.subjectTokenState === "object") &&
    (profile.victimTokenState === null || typeof profile.victimTokenState === "object") &&
    Array.isArray(profile.features);
}

export function authoritativeApprovalDrainEvidenceBinding(input: {
  checkedSubjectAddress: string;
  profile: ApprovalDrainProvenanceProfile;
  rawEvidence: RawEvidenceInput[];
  observations: RiskSignalObservationInput[];
}): { rawEvidenceId: string; observationId: string } | null {
  if (!isAuthoritativeDirectApprovalDrainProfile(input.profile, input.checkedSubjectAddress)) return null;
  const observedHash = input.profile.pathTxHashes.at(-1) ?? input.profile.drainTxHash;
  const raw = input.rawEvidence.find((evidence) => {
    const embedded = evidence.evidenceJson.approvalDrainProvenanceProfile;
    return evidence.source === "forensic_route_search" &&
      evidence.sourceType === "detector_output" &&
      evidence.chain === "tron" &&
      evidence.address !== null && sameTronAddress(evidence.address, input.checkedSubjectAddress) &&
      evidence.txHash === input.profile.drainTxHash &&
      evidence.observedTransactionHash === observedHash &&
      isPersistedApprovalDrainProvenanceProfile(embedded) &&
      isAuthoritativeDirectApprovalDrainProfile(embedded, input.checkedSubjectAddress) &&
      sameApprovalDrainProfileIdentity(input.profile, embedded);
  });
  if (!raw) return null;
  const observation = input.observations.find((item) =>
    item.code === "forensic_approval_drain_provenance" &&
    item.subjectChain === "tron" &&
    sameTronAddress(item.subjectAddress, input.checkedSubjectAddress) &&
    item.rawEvidenceId === raw.id &&
    item.observedTransactionHash === observedHash
  );
  return observation ? { rawEvidenceId: raw.id, observationId: observation.id } : null;
}

export function isApprovalDrainEvidenceRefBoundToDirectProfile(input: {
  checkedSubjectAddress: string;
  evidenceRef: string;
  profiles: ApprovalDrainProvenanceProfile[];
  rawEvidence?: RawEvidenceInput[];
  observations?: RiskSignalObservationInput[];
}): boolean {
  const evidenceRef = input.evidenceRef.trim();
  if (!evidenceRef) return false;
  return input.profiles.some((profile) => {
    if (!isAuthoritativeDirectApprovalDrainProfile(profile, input.checkedSubjectAddress)) return false;
    const binding = authoritativeApprovalDrainEvidenceBinding({
      checkedSubjectAddress: input.checkedSubjectAddress,
      profile,
      rawEvidence: input.rawEvidence ?? [],
      observations: input.observations ?? []
    });
    return binding?.rawEvidenceId === evidenceRef;
  });
}

function edgeAmount(edge: ForensicRouteEdge): bigint {
  return /^\d+$/.test(edge.amountRaw) ? BigInt(edge.amountRaw) : 0n;
}

function rawAmount(value: string): bigint {
  return /^\d+$/.test(value) ? BigInt(value) : 0n;
}

function ratio(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 0;
  return Number(numerator * 10_000n / denominator) / 10_000;
}

function balancedPreservationRatio(left: bigint, right: bigint): number {
  if (left <= 0n || right <= 0n) return 0;
  const smaller = left < right ? left : right;
  const larger = left > right ? left : right;
  return ratio(smaller, larger);
}

function minBigint(values: bigint[]): bigint {
  return values.reduce((min, value) => value < min ? value : min);
}

function sumEdges(edges: ForensicRouteEdge[]): bigint {
  return edges.reduce((sum, edge) => sum + edgeAmount(edge), 0n);
}

function compareBigintDesc(a: bigint, b: bigint): number {
  if (a === b) return 0;
  return a > b ? -1 : 1;
}

function compareApprovalDrainCandidates(left: ForensicRouteEdge, right: ForensicRouteEdge): number {
  const rankOrder = approvalDrainCandidateRank(right) - approvalDrainCandidateRank(left);
  if (rankOrder !== 0) return rankOrder;
  const amountOrder = compareBigintDesc(edgeAmount(left), edgeAmount(right));
  if (amountOrder !== 0) return amountOrder;
  const timestampOrder = right.timestamp.getTime() - left.timestamp.getTime();
  if (timestampOrder !== 0) return timestampOrder;
  const txHashOrder = left.txHash.localeCompare(right.txHash);
  if (txHashOrder !== 0) return txHashOrder;
  const idOrder = left.id.localeCompare(right.id);
  if (idOrder !== 0) return idOrder;
  const fromOrder = left.fromAddress.localeCompare(right.fromAddress);
  if (fromOrder !== 0) return fromOrder;
  return left.toAddress.localeCompare(right.toAddress);
}

function approvalDrainCandidateRank(edge: ForensicRouteEdge): number {
  const method = edge.method.trim().toLowerCase();
  let rank = 0;
  if (edge.edgeType === "transfer_from") rank += 100;
  if (method.includes("verify20")) rank += 80;
  if (method.includes("transferfrom") || method.includes("23b872dd")) rank += 70;
  if (method.includes("permit")) rank += 40;
  if (method.length > 0 && !methodLooksPlainTransfer(method)) rank += 10;
  return rank;
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

function transactionOperator(transactionInfo: unknown): string | null {
  return transferCaller(transactionInfo);
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

function methodLooksLikeTransferFrom(text: string): boolean {
  const normalized = text.toLowerCase();
  return normalized.includes("transferfrom") || normalized.includes("23b872dd");
}

function methodLooksPlainTransfer(method: string): boolean {
  const normalized = normalizeTransferMethod(method);
  return normalized === "transfer" ||
    normalized === "transfer(address,uint256)" ||
    normalized === "a9059cbb" ||
    normalized === "transfera9059cbb" ||
    normalized === "transfer(address,uint256)a9059cbb";
}

function normalizeTransferMethod(method: string): string {
  const compact = method.trim().toLowerCase().replace(/\s+/g, "");
  const withoutNamedParams = compact.replace(
    /transfer\(address[a-z0-9_]*,uint256[a-z0-9_]*\)/g,
    "transfer(address,uint256)"
  );
  return withoutNamedParams.replace(/^transfertransfer\(/, "transfer(");
}

function resolveSpender(input: {
  transactionInfo: unknown;
  drainEdge: ForensicRouteEdge;
}): {
  spenderAddress: string | null;
  operatorAddress: string | null;
  spenderResolution: ApprovalDrainSpenderResolution;
  calledContractAddress: string | null;
  methodText: string;
} {
  const operatorAddress = transactionOperator(input.transactionInfo);
  const contractAddress = calledContractAddress(input.transactionInfo);
  const text = methodText(input.transactionInfo) || input.drainEdge.method;
  if (contractAddress && contractAddress !== TRON_USDT_CONTRACT_ADDRESS) {
    return {
      spenderAddress: contractAddress,
      operatorAddress,
      spenderResolution: "wrapper_contract",
      calledContractAddress: contractAddress,
      methodText: text
    };
  }
  if (
    operatorAddress &&
    input.drainEdge.edgeType === "transfer_from"
  ) {
    return {
      spenderAddress: operatorAddress,
      operatorAddress,
      spenderResolution: "direct_usdt_owner",
      calledContractAddress: contractAddress,
      methodText: text
    };
  }
  return {
    spenderAddress: null,
    operatorAddress,
    spenderResolution: "unknown",
    calledContractAddress: contractAddress,
    methodText: text
  };
}

function classificationGuard(
  code: ApprovalDrainFalsePositiveGuard["code"],
  address: string,
  classification: ServiceClassification | null | undefined
): ApprovalDrainFalsePositiveGuard | null {
  if (!isBoundary(classification)) return null;
  const role = code.replace(/_/g, " ");
  return {
    code,
    label: `Approval-drain auto-decline blocked by ${role}.`,
    address,
    category: classification?.category ?? null,
    identity: classification?.identity ?? null
  };
}

function boundaryGuardsForPath(input: {
  subjectAddress: string;
  spenderAddress: string | null;
  firstReceiverAddress: string;
  pathEdges: ForensicRouteEdge[];
  classifications?: Map<string, ServiceClassification | null>;
}): ApprovalDrainFalsePositiveGuard[] {
  const guards = [
    input.spenderAddress
      ? classificationGuard("spender_service_boundary", input.spenderAddress, input.classifications?.get(input.spenderAddress))
      : null,
    classificationGuard("subject_service_boundary", input.subjectAddress, input.classifications?.get(input.subjectAddress)),
    classificationGuard("receiver_service_boundary", input.firstReceiverAddress, input.classifications?.get(input.firstReceiverAddress))
  ];
  const intermediateAddresses = new Set(input.pathEdges
    .flatMap((edge) => [edge.fromAddress, edge.toAddress])
    .filter((address) => address !== input.subjectAddress && address !== input.firstReceiverAddress));
  for (const address of intermediateAddresses) {
    guards.push(classificationGuard("intermediate_service_boundary", address, input.classifications?.get(address)));
  }
  return guards.filter((guard): guard is ApprovalDrainFalsePositiveGuard => guard !== null);
}

function tokenTransferRows(transactionInfo: unknown): Record<string, unknown>[] {
  const tx = isObjectRecord(transactionInfo) ? transactionInfo : null;
  const rows = [
    ...arrayField(tx?.trc20TransferInfo),
    ...arrayField(tx?.tokenTransferInfo),
    ...arrayField(tx?.transfers)
  ];
  return rows.filter(isObjectRecord);
}

function transferTokenContract(row: Record<string, unknown>): string | null {
  const tokenInfo = objectField(row.tokenInfo);
  return stringField(row.contract_address ?? row.contractAddress ?? tokenInfo?.tokenId);
}

function transferTokenSymbol(row: Record<string, unknown>): string | null {
  const tokenInfo = objectField(row.tokenInfo);
  return stringField(row.tokenAbbr ?? row.tokenSymbol ?? tokenInfo?.tokenAbbr);
}

function transferRawAmount(row: Record<string, unknown>): string | null {
  const value = row.amount_str ?? row.amountStr ?? row.quant ?? row.amount ?? row.value;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.trunc(value).toString();
  return stringField(value);
}

function transferAddressMatches(row: Record<string, unknown>, addresses: Set<string>): boolean {
  const from = stringField(row.from_address ?? row.fromAddress);
  const to = stringField(row.to_address ?? row.toAddress);
  return Boolean((from && addresses.has(from)) || (to && addresses.has(to)));
}

function verifiedContractEvidence(
  classification: ServiceClassification | null | undefined,
  profile: ContractRiskContext | null | undefined
): boolean {
  if (profile?.isVerified === true || profile?.verified === true) return true;
  return (classification?.evidence ?? []).some((item) => /verified[_\s-]?contract|verified[:=\s]+true/i.test(item));
}

function serviceTagsForEvidence(
  classification: ServiceClassification | null | undefined,
  profile: ContractRiskContext | null | undefined
): string[] {
  return [
    ...(classification?.evidence ?? []),
    profile?.serviceTag ?? null,
    profile?.publicTag ?? null,
    ...(profile?.providerTags ?? []).map((tag) => tag.label),
    ...(profile?.publicTags ?? []).map((tag) => tag.label)
  ].filter((value): value is string => Boolean(value && value.length > 0));
}

function methodLooksLikeSwapOrBridge(text: string): boolean {
  return /swap|bridge|deposit|withdraw|redeem|route|exacttokens|cross.?chain/i.test(text);
}

function rowAddress(row: Record<string, unknown>, field: "from" | "to"): string | null {
  return stringField(field === "from" ? row.from_address ?? row.fromAddress : row.to_address ?? row.toAddress);
}

function transferTokenLooksLikeUsdt(row: Record<string, unknown>): boolean {
  const tokenInfo = objectField(row.tokenInfo);
  return [
    transferTokenContract(row),
    transferTokenSymbol(row),
    stringField(row.symbol),
    stringField(row.tokenName),
    stringField(tokenInfo?.name),
    stringField(tokenInfo?.tokenName),
    stringField(tokenInfo?.tokenId)
  ].some((value) => value === TRON_USDT_CONTRACT_ADDRESS || /^usdt$/i.test(value ?? "") || /tether/i.test(value ?? ""));
}

function hasMatchingUsdtMovement(input: {
  transactionInfo: unknown;
  drainEdge: ForensicRouteEdge;
}): boolean {
  const expectedAmount = edgeAmount(input.drainEdge);
  if (expectedAmount <= 0n) return false;
  return tokenTransferRows(input.transactionInfo).some((row) => {
    if (!transferTokenLooksLikeUsdt(row)) return false;
    if (rowAddress(row, "from") !== input.drainEdge.fromAddress || rowAddress(row, "to") !== input.drainEdge.toAddress) return false;
    const amount = transferRawAmount(row);
    if (!amount) return false;
    return balancedPreservationRatio(rawAmount(amount), expectedAmount) >= 0.995;
  });
}

function hasPairedAssetOutputToVictim(input: {
  transactionInfo: unknown;
  victimAddress: string;
  serviceAddress: string | null;
  firstReceiverAddress: string;
}): boolean {
  return tokenTransferRows(input.transactionInfo).some((row) => {
    const tokenContract = transferTokenContract(row);
    if (!tokenContract || tokenContract === TRON_USDT_CONTRACT_ADDRESS) return false;
    if (rowAddress(row, "to") !== input.victimAddress) return false;
    const from = rowAddress(row, "from");
    return from === input.serviceAddress || from === input.firstReceiverAddress;
  });
}

function normalServiceRouteEvidence(input: {
  transactionInfo: unknown;
  drainEdge: ForensicRouteEdge;
  spenderAddress: string;
  classifications?: Map<string, ServiceClassification | null>;
  contractProfiles?: Map<string, ContractRiskContext | null>;
  methodText: string;
}): NormalServiceRouteEvidence {
  const serviceClassification = input.classifications?.get(input.spenderAddress) ?? null;
  const receiverClassification = input.classifications?.get(input.drainEdge.toAddress) ?? null;
  const contractProfile = input.contractProfiles?.get(input.spenderAddress) ?? null;
  const pairedAssetOutputObserved = hasPairedAssetOutputToVictim({
    transactionInfo: input.transactionInfo,
    victimAddress: input.drainEdge.fromAddress,
    serviceAddress: input.spenderAddress,
    firstReceiverAddress: input.drainEdge.toAddress
  });
  const receiverIsPoolOrBridge = receiverClassification?.category === "bridge_pool" ||
    receiverClassification?.category === "bridge" ||
    receiverClassification?.category === "dex";

  return {
    serviceCategory: serviceClassification?.category ?? null,
    serviceIdentity: serviceClassification?.identity ?? null,
    verifiedContract: verifiedContractEvidence(serviceClassification, contractProfile),
    serviceTags: serviceTagsForEvidence(serviceClassification, contractProfile),
    pairedAssetOutputObserved,
    economicOutputToVictimObserved: pairedAssetOutputObserved,
    swapOrBridgeMethodObserved: methodLooksLikeSwapOrBridge(input.methodText),
    receiverIsPoolOrBridge,
    directUnknownCollectorReceiver: receiverClassification?.category === "unknown_contract"
  };
}

function normalServiceRouteGuard(input: {
  spenderAddress: string;
  evidence: NormalServiceRouteEvidence;
}): ApprovalDrainFalsePositiveGuard {
  return {
    code: "service_boundary_route",
    label: "Approval-drain auto-decline blocked by known service route with economic output.",
    address: input.spenderAddress,
    category: input.evidence.serviceCategory,
    identity: input.evidence.serviceIdentity
  };
}

function mapServiceRouteCategoryToServiceCategory(category: ServiceRouteCategory | null): ServiceCategory | null {
  switch (category) {
    case "cross_chain_bridge":
    case "bridge_aggregator":
      return "bridge";
    case "dex_router_or_swap_aggregator":
      return "dex";
    case "stablecoin_or_wrapped_asset_protocol":
      return "protocol";
    case "gasless_or_smart_account_service":
      return "service";
    case "unknown_service_route":
      return "unknown_contract";
    default:
      return null;
  }
}

function supportingFingerprints(input: {
  transactionInfo: unknown;
  drainEdge: ForensicRouteEdge;
  resolution: ReturnType<typeof resolveSpender>;
  amountPreservationRatio: number | null;
}): ApprovalDrainSupportingFingerprint[] {
  const fingerprints: ApprovalDrainSupportingFingerprint[] = [];
  if (
    input.resolution.spenderResolution === "wrapper_contract" &&
    input.resolution.methodText &&
    !methodLooksLikeTransferFrom(input.resolution.methodText)
  ) {
    fingerprints.push({
      code: "misleading_wrapper_method",
      label: "Wrapper method name does not disclose USDT transferFrom behavior.",
      value: input.resolution.methodText
    });
  }
  const relatedAddresses = new Set([
    input.drainEdge.fromAddress,
    input.drainEdge.toAddress,
    input.resolution.spenderAddress ?? "",
    input.resolution.operatorAddress ?? ""
  ].filter((value) => value.length > 0));
  const marker = tokenTransferRows(input.transactionInfo).find((row) => {
    const tokenContract = transferTokenContract(row);
    return tokenContract &&
      tokenContract !== TRON_USDT_CONTRACT_ADDRESS &&
      transferAddressMatches(row, relatedAddresses);
  });
  if (marker) {
    fingerprints.push({
      code: "nearby_non_usdt_token_transfer",
      label: "Nearby non-USDT token transfer observed around the drain transaction.",
      value: transferTokenSymbol(marker) ?? transferTokenContract(marker)
    });
  }
  if (input.amountPreservationRatio !== null && input.amountPreservationRatio >= 0.95) {
    fingerprints.push({
      code: "amount_preservation",
      label: "Most of the drained amount is preserved on the route to the checked wallet.",
      value: input.amountPreservationRatio
    });
  }
  return fingerprints;
}

function isBoundary(classification: ServiceClassification | null | undefined): boolean {
  return Boolean(classification && classification.category !== "none" && classification.isBoundary);
}

function isValidApprovalChange(change: TronscanApprovalChange, input: {
  ownerAddress: string;
  spenderAddress: string;
  drainAt: Date;
  drainAmountRaw: string;
}): boolean {
  if (change.ownerAddress !== input.ownerAddress) return false;
  if (change.spenderAddress !== input.spenderAddress) return false;
  if (change.tokenContract !== TRON_USDT_CONTRACT_ADDRESS) return false;
  if (change.confirmed !== true) return false;
  if (change.contractRet && change.contractRet !== "SUCCESS") return false;
  if (change.timestamp.getTime() > input.drainAt.getTime()) return false;
  if (change.isUnlimited) return true;
  return rawAmount(change.amountRaw) >= rawAmount(input.drainAmountRaw);
}

function newestValidApproval(changes: TronscanApprovalChange[], input: {
  ownerAddress: string;
  spenderAddress: string;
  drainAt: Date;
  drainAmountRaw: string;
}): TronscanApprovalChange | null {
  return changes
    .filter((change) => isValidApprovalChange(change, input))
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0] ?? null;
}

function scoreForHopDepth(hopDepth: 0 | 1 | 2): number {
  if (hopDepth === 0) return 90;
  if (hopDepth === 1) return 80;
  return 70;
}

function tokenState(profile: StablecoinRestrictionProfile | null, address: string): ApprovalDrainTokenState | null {
  if (!profile) return null;
  return {
    address,
    balanceRaw: profile.balanceRaw,
    isBlacklisted: profile.isBlacklisted,
    blockedBalanceRaw: profile.isBlacklisted ? profile.balanceRaw : null,
    checkedAt: profile.checkedAt
  };
}

async function resolveTokenState(
  deps: ApprovalDrainLookupDeps,
  address: string
): Promise<ApprovalDrainTokenState | null> {
  const profile = await deps.getUsdtRestrictionStatus?.(address, { includeEventTimeline: false }).catch(() => null) ?? null;
  return tokenState(profile, address);
}

function findPathFromReceiverToSubject(input: {
  firstReceiverAddress: string;
  subjectAddress: string;
  drainAt: Date;
  drainAmount: bigint;
  edges: ForensicRouteEdge[];
  classifications?: Map<string, ServiceClassification | null>;
  minAmountPreservationRatio: number;
}): {
  hopDepth: 0 | 1 | 2;
  edges: ForensicRouteEdge[];
  amountRaw: string;
  amountPreservationRatio: number;
  routeAddresses: string[];
} | null {
  if (isBoundary(input.classifications?.get(input.subjectAddress))) {
    return null;
  }
  if (input.firstReceiverAddress === input.subjectAddress) {
    return {
      hopDepth: 0,
      edges: [],
      amountRaw: input.drainAmount.toString(),
      amountPreservationRatio: 1,
      routeAddresses: [input.firstReceiverAddress]
    };
  }
  if (isBoundary(input.classifications?.get(input.firstReceiverAddress))) {
    return null;
  }

  const candidates: Array<{
    hopDepth: 1 | 2;
    edges: ForensicRouteEdge[];
    amountRaw: string;
    amountPreservationRatio: number;
    routeAddresses: string[];
  }> = [];
  const latestRouteAt = input.drainAt.getTime() + DEFAULT_ROUTE_LOOKAHEAD_MS;
  const outgoing = input.edges
    .filter((edge) =>
      edge.fromAddress === input.firstReceiverAddress &&
      edge.timestamp.getTime() >= input.drainAt.getTime() &&
      edge.timestamp.getTime() <= latestRouteAt
    )
    .sort((a, b) => compareBigintDesc(edgeAmount(a), edgeAmount(b)));

  const directToSubject = outgoing
    .filter((edge) => edge.toAddress === input.subjectAddress)
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  if (directToSubject.length > 0) {
    candidates.push({
      hopDepth: 1,
      edges: directToSubject,
      amountRaw: sumEdges(directToSubject).toString(),
      routeAddresses: [input.firstReceiverAddress, input.subjectAddress],
      amountPreservationRatio: balancedPreservationRatio(sumEdges(directToSubject), input.drainAmount)
    });
  }

  const intermediateAddresses = [...new Set(outgoing
    .filter((edge) => edge.toAddress !== input.subjectAddress)
    .map((edge) => edge.toAddress))];
  for (const intermediateAddress of intermediateAddresses) {
    if (isBoundary(input.classifications?.get(intermediateAddress))) continue;
    const firstLegEdges = outgoing.filter((edge) => edge.toAddress === intermediateAddress);
    const firstLegAt = firstLegEdges
      .map((edge) => edge.timestamp.getTime())
      .sort((a, b) => a - b)[0] ?? input.drainAt.getTime();
    const secondHop = input.edges
      .filter((edge) =>
        edge.fromAddress === intermediateAddress &&
        edge.toAddress === input.subjectAddress &&
        edge.timestamp.getTime() >= firstLegAt &&
        edge.timestamp.getTime() <= latestRouteAt
      )
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    if (secondHop.length > 0) {
      const preservedAmount = minBigint([sumEdges(firstLegEdges), sumEdges(secondHop)]);
      candidates.push({
        hopDepth: 2,
        edges: [...firstLegEdges, ...secondHop],
        amountRaw: sumEdges(secondHop).toString(),
        routeAddresses: [input.firstReceiverAddress, intermediateAddress, input.subjectAddress],
        amountPreservationRatio: balancedPreservationRatio(preservedAmount, input.drainAmount)
      });
    }
  }

  const best = candidates
    .filter((candidate) => candidate.amountPreservationRatio >= input.minAmountPreservationRatio)
    .sort((a, b) => b.amountPreservationRatio - a.amountPreservationRatio)[0] ?? null;
  if (!best) return null;
  return {
    hopDepth: best.hopDepth,
    edges: best.edges,
    amountRaw: best.amountRaw,
    amountPreservationRatio: best.amountPreservationRatio,
    routeAddresses: best.routeAddresses
  };
}

function featuresForProfile(input: {
  hopDepth: 0 | 1 | 2;
  amountPreservationRatio: number;
  score: number;
}): RouteScoreFeature[] {
  const features: RouteScoreFeature[] = [{
    code: "approval_drain_exact_transfer_from",
    label: "Exact USDT approval-drain transferFrom root was found.",
    scoreImpact: input.score
  }];
  if (input.hopDepth === 0) {
    features.push({
      code: "approval_drain_direct_receiver",
      label: "Checked address is the first receiver after the transferFrom drain.",
      scoreImpact: 0
    });
  } else {
    features.push({
      code: "approval_drain_route_linked",
      label: `Checked address is linked to the approval-drain receiver within ${input.hopDepth} hop(s).`,
      scoreImpact: 0,
      value: input.hopDepth
    });
  }
  if (input.amountPreservationRatio >= 0.95) {
    features.push({
      code: "approval_drain_amount_preserved",
      label: "The linked route preserves most of the drained USDT amount.",
      scoreImpact: 0,
      value: input.amountPreservationRatio
    });
  }
  return features;
}

function clusterFingerprints(
  profile: ApprovalDrainProvenanceProfile,
  profiles: ApprovalDrainProvenanceProfile[]
): ApprovalDrainSupportingFingerprint[] {
  if (profiles.length < 2) return [];
  const fingerprints: ApprovalDrainSupportingFingerprint[] = [{
    code: "multiple_exact_approval_drain_profiles",
    label: "Multiple exact approval-drain profiles were found in the same checked balance context.",
    value: profiles.length
  }];
  const sameSpenderCount = profiles.filter((item) => item.spenderAddress === profile.spenderAddress).length;
  if (sameSpenderCount > 1) {
    fingerprints.push({
      code: "same_spender_cluster",
      label: "Multiple exact approval-drain profiles share the same approved spender.",
      value: sameSpenderCount
    });
  }
  const sameReceiverCount = profiles.filter((item) => item.firstReceiverAddress === profile.firstReceiverAddress).length;
  if (sameReceiverCount > 1) {
    fingerprints.push({
      code: "same_receiver_cluster",
      label: "Multiple exact approval-drain profiles share the same first receiver.",
      value: sameReceiverCount
    });
  }
  return fingerprints;
}

export async function buildApprovalDrainProvenanceAnalysis(
  input: BuildApprovalDrainProvenanceInput
): Promise<ApprovalDrainProvenanceAnalysis> {
  const maxCandidates = input.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const approvalChangeLookupLimit = input.approvalChangeLookupLimit ?? DEFAULT_APPROVAL_CHANGE_LOOKUP_LIMIT;
  const minAmountPreservationRatio = input.minAmountPreservationRatio ?? DEFAULT_MIN_AMOUNT_PRESERVATION_RATIO;
  const compareCandidates = input.candidateRankingMode === "suspicion_aware"
    ? compareApprovalDrainCandidates
    : (a: ForensicRouteEdge, b: ForensicRouteEdge) => compareBigintDesc(edgeAmount(a), edgeAmount(b));
  const drainCandidates = input.edges
    .filter((edge) => edgeAmount(edge) > 0n)
    .sort(compareCandidates)
    .slice(0, maxCandidates);
  const profiles: ApprovalDrainProvenanceProfile[] = [];
  const reviewFindings: ApprovalDrainReviewFinding[] = [];

  for (const drainEdge of drainCandidates) {
    const transactionInfo = await input.deps.getTransaction(drainEdge.txHash).catch(() => null);
    const resolution = resolveSpender({ transactionInfo, drainEdge });
    const baseFingerprints = supportingFingerprints({
      transactionInfo,
      drainEdge,
      resolution,
      amountPreservationRatio: null
    });
    if (!resolution.spenderAddress) {
      if (drainEdge.edgeType === "transfer_from") {
        reviewFindings.push({
          victimAddress: drainEdge.fromAddress,
          drainTxHash: drainEdge.txHash,
          spenderAddress: null,
          operatorAddress: resolution.operatorAddress,
          spenderResolution: resolution.spenderResolution,
          firstReceiverAddress: drainEdge.toAddress,
          subjectAddress: input.subjectAddress,
          reason: "spender_unknown",
          falsePositiveGuards: [],
          supportingFingerprints: baseFingerprints
        });
      }
      continue;
    }

    const approvalChanges = await input.deps.listTrc20ApprovalChanges({
      ownerAddress: drainEdge.fromAddress,
      spenderAddress: resolution.spenderAddress,
      contractAddress: TRON_USDT_CONTRACT_ADDRESS,
      start: 0,
      limit: approvalChangeLookupLimit
    }).catch(() => []);
    const approval = newestValidApproval(approvalChanges, {
      ownerAddress: drainEdge.fromAddress,
      spenderAddress: resolution.spenderAddress,
      drainAt: drainEdge.timestamp,
      drainAmountRaw: drainEdge.amountRaw
    });
    const spenderMatched = Boolean(approval && approval.spenderAddress === resolution.spenderAddress);
    const matchingUsdtMovement = hasMatchingUsdtMovement({ transactionInfo, drainEdge });
    const sourceIsBoundary = isBoundary(input.classifications?.get(drainEdge.fromAddress));
    const transferFromConfirmed =
      (
        drainEdge.edgeType === "transfer_from" &&
        (resolution.spenderResolution === "direct_usdt_owner" || methodLooksLikeTransferFrom(resolution.methodText))
      ) ||
      (
        resolution.spenderResolution === "wrapper_contract" &&
        spenderMatched &&
        matchingUsdtMovement &&
        !sourceIsBoundary
      );
    const serviceRouteEvidence = extractServiceRouteEvidence({
      subjectAddress: input.subjectAddress,
      transactionInfo,
      contractProfile: input.contractProfiles?.get(resolution.spenderAddress ?? drainEdge.toAddress) ?? null,
      approvalDrainProof: {
        approveFound: Boolean(approval),
        transferFromConfirmed: transferFromConfirmed === true,
        spenderMatched: spenderMatched === true
      }
    });
    if (serviceRouteEvidence.kind !== "none" && serviceRouteEvidence.drainProof !== "proven") {
      reviewFindings.push({
        victimAddress: drainEdge.fromAddress,
        drainTxHash: drainEdge.txHash,
        spenderAddress: resolution.spenderAddress,
        operatorAddress: resolution.operatorAddress,
        spenderResolution: resolution.spenderResolution,
        firstReceiverAddress: drainEdge.toAddress,
        subjectAddress: input.subjectAddress,
        reason: "service_boundary_guard",
        falsePositiveGuards: [{
          code: "service_boundary_route",
          label: `Approval-drain auto-decline blocked by ${serviceRouteEvidence.identity ?? "service-route"} context.`,
          address: resolution.spenderAddress ?? drainEdge.toAddress,
          category: mapServiceRouteCategoryToServiceCategory(serviceRouteEvidence.category),
          identity: serviceRouteEvidence.identity
        }],
        supportingFingerprints: []
      });
      continue;
    }
    if (!approval) {
      if (drainEdge.edgeType === "transfer_from" || resolution.spenderResolution === "wrapper_contract") {
        reviewFindings.push({
          victimAddress: drainEdge.fromAddress,
          drainTxHash: drainEdge.txHash,
          spenderAddress: resolution.spenderAddress,
          operatorAddress: resolution.operatorAddress,
          spenderResolution: resolution.spenderResolution,
          firstReceiverAddress: drainEdge.toAddress,
          subjectAddress: input.subjectAddress,
          reason: "approval_not_found",
          falsePositiveGuards: [],
          supportingFingerprints: baseFingerprints
        });
      }
      continue;
    }

    const normalRouteEvidence = normalServiceRouteEvidence({
      transactionInfo,
      drainEdge,
      spenderAddress: resolution.spenderAddress,
      classifications: input.classifications,
      contractProfiles: input.contractProfiles,
      methodText: resolution.methodText
    });
    const serviceRoute = detectNormalServiceRoute(normalRouteEvidence);
    if (serviceRoute.guarded) {
      reviewFindings.push({
        victimAddress: drainEdge.fromAddress,
        drainTxHash: drainEdge.txHash,
        spenderAddress: resolution.spenderAddress,
        operatorAddress: resolution.operatorAddress,
        spenderResolution: resolution.spenderResolution,
        firstReceiverAddress: drainEdge.toAddress,
        subjectAddress: input.subjectAddress,
        reason: "service_boundary_guard",
        falsePositiveGuards: [normalServiceRouteGuard({
          spenderAddress: resolution.spenderAddress,
          evidence: normalRouteEvidence
        })],
        supportingFingerprints: baseFingerprints
      });
      continue;
    }

    const path = findPathFromReceiverToSubject({
      firstReceiverAddress: drainEdge.toAddress,
      subjectAddress: input.subjectAddress,
      drainAt: drainEdge.timestamp,
      drainAmount: edgeAmount(drainEdge),
      edges: input.edges,
      classifications: input.classifications,
      minAmountPreservationRatio
    });
    const guards = boundaryGuardsForPath({
      subjectAddress: input.subjectAddress,
      spenderAddress: resolution.spenderAddress,
      firstReceiverAddress: drainEdge.toAddress,
      pathEdges: path?.edges ?? [],
      classifications: input.classifications
    });
    if (!path || guards.length > 0) {
      reviewFindings.push({
        victimAddress: drainEdge.fromAddress,
        drainTxHash: drainEdge.txHash,
        spenderAddress: resolution.spenderAddress,
        operatorAddress: resolution.operatorAddress,
        spenderResolution: resolution.spenderResolution,
        firstReceiverAddress: drainEdge.toAddress,
        subjectAddress: input.subjectAddress,
        reason: guards.length > 0 ? "service_boundary_guard" : "path_not_proven",
        falsePositiveGuards: guards,
        supportingFingerprints: baseFingerprints
      });
      continue;
    }

    const score = scoreForHopDepth(path.hopDepth);
    const subjectTokenState = await resolveTokenState(input.deps, input.subjectAddress);
    const victimTokenState = await resolveTokenState(input.deps, drainEdge.fromAddress);
    const fingerprints = supportingFingerprints({
      transactionInfo,
      drainEdge,
      resolution,
      amountPreservationRatio: path.amountPreservationRatio
    });
    profiles.push({
      victimAddress: drainEdge.fromAddress,
      approvalTxHash: approval.txHash,
      drainTxHash: drainEdge.txHash,
      spenderAddress: resolution.spenderAddress,
      operatorAddress: resolution.operatorAddress,
      spenderResolution: resolution.spenderResolution,
      falsePositiveGuards: [],
      supportingFingerprints: fingerprints,
      firstReceiverAddress: drainEdge.toAddress,
      subjectAddress: input.subjectAddress,
      hopDepth: path.hopDepth,
      amountRaw: path.amountRaw,
      amountPreservationRatio: path.amountPreservationRatio,
      approvalAt: approval.timestamp.toISOString(),
      drainAt: drainEdge.timestamp.toISOString(),
      pathTxHashes: [drainEdge.txHash, ...path.edges.map((edge) => edge.txHash)],
      pathAddresses: [drainEdge.fromAddress, ...path.routeAddresses],
      score,
      evidenceStrength: path.hopDepth === 0 ? "exact_approval_and_transfer_from" : "route_linked",
      subjectTokenState,
      victimTokenState,
      features: featuresForProfile({
        hopDepth: path.hopDepth,
        amountPreservationRatio: path.amountPreservationRatio,
        score
      })
    });
  }

  const sortedProfiles = profiles.sort((a, b) =>
    b.score === a.score
      ? b.amountPreservationRatio - a.amountPreservationRatio
      : b.score - a.score
  );
  for (const profile of sortedProfiles) {
    profile.supportingFingerprints = [
      ...(profile.supportingFingerprints ?? []),
      ...clusterFingerprints(profile, sortedProfiles)
    ];
  }
  return { profiles: sortedProfiles, reviewFindings };
}

export async function buildApprovalDrainProvenanceProfiles(
  input: BuildApprovalDrainProvenanceInput
): Promise<ApprovalDrainProvenanceProfile[]> {
  return (await buildApprovalDrainProvenanceAnalysis(input)).profiles;
}

export async function buildApprovalDrainProvenanceProfile(
  input: BuildApprovalDrainProvenanceInput
): Promise<ApprovalDrainProvenanceProfile | null> {
  return (await buildApprovalDrainProvenanceProfiles(input))[0] ?? null;
}

export function rawEvidenceForApprovalDrainProvenance(input: {
  subjectAddress: string;
  windowStart: Date;
  windowEnd: Date;
  profile: ApprovalDrainProvenanceProfile;
}): RawEvidenceInput {
  return {
    id: stableId([
      "forensic_approval_drain_provenance_raw",
      input.subjectAddress,
      input.profile.approvalTxHash,
      input.profile.drainTxHash,
      input.windowStart.toISOString(),
      input.windowEnd.toISOString()
    ]),
    source: "forensic_route_search",
    sourceType: "detector_output",
    chain: "tron",
    address: input.subjectAddress,
    txHash: input.profile.drainTxHash,
    observedTransactionHash: input.profile.pathTxHashes.at(-1) ?? input.profile.drainTxHash,
    evidenceJson: {
      approvalDrainProvenanceProfile: input.profile,
      windowStart: input.windowStart.toISOString(),
      windowEnd: input.windowEnd.toISOString()
    }
  };
}

export function observationForApprovalDrainProvenance(input: {
  subjectAddress: string;
  profile: ApprovalDrainProvenanceProfile;
  rawEvidenceId: string;
}): RiskSignalObservationInput {
  const exact = isAuthoritativeDirectApprovalDrainProfile(input.profile, input.subjectAddress);
  const code = exact
    ? "forensic_approval_drain_provenance"
    : "forensic_route_linked_approval_pattern";
  return {
    id: stableId([
      `${code}_observation`,
      input.subjectAddress,
      input.profile.approvalTxHash,
      input.profile.drainTxHash,
      FORENSIC_ROUTE_POLICY_VERSION
    ]),
    subjectChain: "tron",
    subjectAddress: input.subjectAddress,
    subjectTxHash: null,
    observedTransactionHash: input.profile.pathTxHashes.at(-1) ?? input.profile.drainTxHash,
    signalGroup: "approval",
    code,
    message: exact
      ? "Funds are connected to an exact approval-drain flow within 2 hops."
      : "Route-linked approval-drain context found without exact approval-drain proof.",
    scoreImpact: exact ? 90 : Math.min(80, input.profile.score),
    confidence: "high",
    severity: exact ? "critical" : "high",
    source: "approval_drain_provenance",
    policyVersion: FORENSIC_ROUTE_POLICY_VERSION,
    rawEvidenceId: input.rawEvidenceId
  };
}
