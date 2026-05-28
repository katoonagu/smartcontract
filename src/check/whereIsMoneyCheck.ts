import { TronWeb } from "tronweb";
import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import type { ContractRiskContext } from "../approvals/contractIntelligence";
import { selectBalanceFormingTransfers } from "../forensics/balanceFormingTransfers";
import { buildApprovalDrainProvenanceAnalysis } from "../forensics/approvalDrainProvenance";
import {
  applyContractLlmVerdictsToDecision,
  buildContractAnalysisCaseFiles,
  createUnavailableContractLlmVerdict,
  hashContractAnalysisCaseFile
} from "../forensics/contractLlmVerdict";
import { buildMoneyOriginSenderInteractionProfile } from "../forensics/moneyOriginInteractions";
import { combineMoneyOriginDecision } from "../forensics/moneyOriginPolicy";
import { traceMoneyOriginPath } from "../forensics/moneyOriginTrace";
import type { ListTrc20ApprovalChangesInput, TronscanApprovalChange } from "../tron/tronClient";
import type {
  AddressLabel,
  ContractAnalysisCaseFile,
  ContractLlmVerdictSummary,
  ExchangeDecision,
  ForensicRouteEdge,
  ProofLevel,
  RiskReport,
  ServiceClassification,
  StablecoinRestrictionProfile,
  BalanceFormingSelection,
  BalanceFormingTransfer,
  WhereIsMoneyReport
} from "../types";
import { userDecisionFromInternal } from "../risk/proofLevels";

export type WhereIsMoneyDeps = {
  getTrc20Balance(address: string, tokenContractAddress: string): Promise<string | null>;
  fetchEdgesForAddress(address: string): Promise<ForensicRouteEdge[]>;
  fetchLatestEdgesForAddress?(address: string, limit: number): Promise<ForensicRouteEdge[]>;
  getLabelsForAddress(address: string): Promise<AddressLabel[]>;
  getClassificationForAddress(address: string): Promise<ServiceClassification | null>;
  getFastWalletRisk?(address: string): Promise<RiskReport | null>;
  getTransaction?(txHash: string): Promise<unknown>;
  listTrc20ApprovalChanges?(input: ListTrc20ApprovalChangesInput): Promise<TronscanApprovalChange[]>;
  getUsdtRestrictionStatus?(address: string, options?: { includeEventTimeline?: boolean }): Promise<StablecoinRestrictionProfile>;
  getContractIntelligenceProfile?(address: string): Promise<ContractRiskContext | null>;
  analyzeContractLlmCaseFiles?(caseFiles: ContractAnalysisCaseFile[]): Promise<ContractLlmVerdictSummary[]>;
};

export type RunWhereIsMoneyCheckInput = {
  sourceAddress?: string;
  subjectAddress?: string;
  mode?: "where_is_money" | "transaction_check";
  requestedAmountRaw?: string | null;
  seedTransfers?: BalanceFormingTransfer[];
  windowStart: Date;
  windowEnd: Date;
  maxDepth?: number;
  beamWidth?: number;
  maxAddressFetches?: number;
  maxEdgesPerAddress?: number;
  recentFallbackMinTransferCount?: number;
  recentFallbackTransferLimit?: number;
};

const DEFAULT_MAX_DEPTH = 7;
const DEFAULT_BEAM_WIDTH = 8;
const DEFAULT_MAX_ADDRESS_FETCHES = 60;
const DEFAULT_MAX_EDGES_PER_ADDRESS = 40;
const DEFAULT_RECENT_FALLBACK_MIN_TRANSFER_COUNT = 60;
const DEFAULT_RECENT_FALLBACK_TRANSFER_LIMIT = 60;
const APPROVAL_DRAIN_SERVICE_PROFILE_CATEGORIES = new Set<ServiceClassification["category"]>([
  "router",
  "dex",
  "bridge",
  "bridge_pool",
  "swap_adapter",
  "unknown_contract"
]);

function proofLevelFromWhereDecision(input: {
  decision: ExchangeDecision;
  decisionReasons: string[];
}): ProofLevel {
  const reasonText = input.decisionReasons.join(" ").toLowerCase();
  const hasExchangePolicySignal = reasonText.includes("whitebit") ||
    reasonText.includes("htx") ||
    reasonText.includes("huobi") ||
    reasonText.includes("boundary");
  const hasNegatedScamProofSignal = reasonText.includes("not direct scam proof") ||
    reasonText.includes("not a blacklist/scam claim") ||
    reasonText.includes("without direct taint evidence");
  if (reasonText.includes("approval-drain") || reasonText.includes("transferfrom")) {
    return "exact_approval_drain_provenance";
  }
  if (input.decision === "ACCEPTABLE") {
    return "clean_source_proven";
  }
  if (reasonText.includes("ai contract verdict")) {
    return "llm_assisted_suspicion";
  }
  if (
    reasonText.includes("exact or critical evidence") ||
    (reasonText.includes("taint") && !hasNegatedScamProofSignal) ||
    (reasonText.includes("blacklist") && !hasNegatedScamProofSignal) ||
    reasonText.includes("blacklisted") ||
    reasonText.includes("stolen_funds") ||
    reasonText.includes("stolen funds") ||
    reasonText.includes("phishing") ||
    reasonText.includes("darknet") ||
    (reasonText.includes("scam") && !hasExchangePolicySignal && !hasNegatedScamProofSignal)
  ) {
    return "exact_scam_or_taint_proof";
  }
  if (hasExchangePolicySignal) {
    return "exchange_policy_decline";
  }
  if (
    reasonText.includes("coverage") ||
    reasonText.includes("no previous inbound") ||
    reasonText.includes("limited") ||
    reasonText.includes("could not be proven") ||
    reasonText.includes("unavailable")
  ) {
    return "insufficient_coverage";
  }
  return "insufficient_coverage";
}

function whereDecisionFields(decision: ExchangeDecision, decisionReasons: string[]): Pick<WhereIsMoneyReport, "internalDecision" | "userDecision" | "proofLevel"> {
  return {
    internalDecision: decision,
    userDecision: userDecisionFromInternal(decision),
    proofLevel: proofLevelFromWhereDecision({ decision, decisionReasons })
  };
}

function fallbackReviewReport(input: {
  sourceAddress: string;
  currentBalanceRaw: string | null;
  requestedAmountRaw?: string | null;
  targetAmountRaw: string;
  fastWalletRisk: RiskReport | null;
  maxDepth: number;
  notes: string[];
}): WhereIsMoneyReport {
  const decision: ExchangeDecision = "DECLINE";
  const decisionReasons = input.notes.map((note) =>
    `Clean source could not be proven; exchange policy declines this wallet by safe default. ${note}`
  );
  return {
    subjectAddress: input.sourceAddress,
    currentUsdtBalanceRaw: input.currentBalanceRaw,
    fastWalletRisk: input.fastWalletRisk,
    balanceFormingTransfers: [],
    originPaths: [],
    senderInteractionProfiles: [],
    approvalDrainProvenanceProfiles: [],
    approvalDrainReviewFindings: [],
    contractLlmVerdicts: [],
    decision,
    ...whereDecisionFields(decision, decisionReasons),
    riskScore: Math.max(65, input.fastWalletRisk?.score ?? 0),
    decisionReasons,
    coverage: {
      selectedInboundTxCount: 0,
      currentBalanceRaw: input.currentBalanceRaw,
      requestedAmountRaw: input.requestedAmountRaw ?? null,
      targetAmountRaw: input.targetAmountRaw,
      selectedAmountRaw: "0",
      coverageRatio: 0,
      selectedInboundVolumeRaw: "0",
      currentBalanceCoverageRatio: 0,
      maxDepth: input.maxDepth,
      fetchedAddressCount: 0,
      partial: true,
      notes: input.notes
    }
  };
}

async function buildContractProfilesForCaseFiles(input: {
  caseFiles: ContractAnalysisCaseFile[];
  getContractIntelligenceProfile?: (address: string) => Promise<ContractRiskContext | null>;
}): Promise<Map<string, ContractRiskContext | null>> {
  const profiles = new Map<string, ContractRiskContext | null>();
  if (!input.getContractIntelligenceProfile) return profiles;
  await Promise.all(input.caseFiles.map(async (caseFile) => {
    if (!caseFile.contractAddress || profiles.has(caseFile.contractAddress)) return;
    const profile = await input.getContractIntelligenceProfile?.(caseFile.contractAddress).catch(() => null) ?? null;
    profiles.set(caseFile.contractAddress, profile);
  }));
  return profiles;
}

function objectField(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function arrayField(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function tronAddressField(value: unknown): string | null {
  const raw = stringField(value);
  if (!raw) return null;
  if (/^41[0-9a-fA-F]{40}$/.test(raw)) {
    try {
      return TronWeb.address.fromHex(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

function approvalDrainCandidateAmount(edge: ForensicRouteEdge): bigint {
  return /^\d+$/.test(edge.amountRaw) ? BigInt(edge.amountRaw) : 0n;
}

function compareApprovalDrainCandidateAmountDesc(a: ForensicRouteEdge, b: ForensicRouteEdge): number {
  const left = approvalDrainCandidateAmount(a);
  const right = approvalDrainCandidateAmount(b);
  if (left === right) return 0;
  return left > right ? -1 : 1;
}

function contractCandidatesFromTransaction(transactionInfo: unknown): string[] {
  const tx = objectField(transactionInfo);
  const contractData = objectField(tx?.contractData);
  const triggerInfo = objectField(tx?.trigger_info);
  const rawData = objectField(tx?.raw_data);
  const rawContract = objectField(arrayField(rawData?.contract)[0]);
  const rawParameter = objectField(rawContract?.parameter);
  const rawValue = objectField(rawParameter?.value);
  return [...new Set([
    tronAddressField(tx?.ownerAddress),
    tronAddressField(tx?.owner_address),
    tronAddressField(contractData?.ownerAddress),
    tronAddressField(contractData?.owner_address),
    tronAddressField(triggerInfo?.ownerAddress),
    tronAddressField(triggerInfo?.owner_address),
    tronAddressField(rawValue?.owner_address),
    tronAddressField(tx?.contractAddress),
    tronAddressField(tx?.contract_address),
    tronAddressField(contractData?.contractAddress),
    tronAddressField(contractData?.contract_address),
    tronAddressField(triggerInfo?.contractAddress),
    tronAddressField(triggerInfo?.contract_address),
    tronAddressField(rawValue?.contract_address)
  ].filter((address): address is string => Boolean(address && address !== TRON_USDT_CONTRACT_ADDRESS)))];
}

async function buildApprovalDrainContractProfiles(input: {
  edges: ForensicRouteEdge[];
  classifications: Map<string, ServiceClassification | null>;
  getCachedClassification(address: string): Promise<ServiceClassification | null>;
  getTransaction: (txHash: string) => Promise<unknown>;
  getContractIntelligenceProfile?: (address: string) => Promise<ContractRiskContext | null>;
  maxCandidates: number;
}): Promise<Map<string, ContractRiskContext | null>> {
  const profiles = new Map<string, ContractRiskContext | null>();
  if (!input.getContractIntelligenceProfile) return profiles;

  const maybeFetchProfile = async (address: string): Promise<void> => {
    if (profiles.has(address)) return;
    const classification = await input.getCachedClassification(address).catch(() => null);
    if (!classification || !APPROVAL_DRAIN_SERVICE_PROFILE_CATEGORIES.has(classification.category)) return;
    const profile = await input.getContractIntelligenceProfile?.(address).catch(() => null) ?? null;
    profiles.set(address, profile);
  };

  await Promise.all([...input.classifications.entries()]
    .filter(([, classification]) => classification && APPROVAL_DRAIN_SERVICE_PROFILE_CATEGORIES.has(classification.category))
    .map(([address]) => maybeFetchProfile(address)));

  const transactionCandidates = input.edges
    .filter((edge) => approvalDrainCandidateAmount(edge) > 0n)
    .sort(compareApprovalDrainCandidateAmountDesc)
    .slice(0, input.maxCandidates);
  const discoveredAddresses = await Promise.all(transactionCandidates.map(async (edge) => {
    const tx = await input.getTransaction(edge.txHash).catch(() => null);
    return contractCandidatesFromTransaction(tx);
  }));
  await Promise.all([...new Set(discoveredAddresses.flat())].map((address) => maybeFetchProfile(address)));
  return profiles;
}

function unavailableVerdictsForCaseFiles(caseFiles: ContractAnalysisCaseFile[]): ContractLlmVerdictSummary[] {
  return caseFiles.map((caseFile) => createUnavailableContractLlmVerdict({
    contractAddress: caseFile.contractAddress,
    caseFileHash: hashContractAnalysisCaseFile(caseFile),
    providerLabel: "disabled",
    model: "disabled",
    error: "llm disabled"
  }));
}

function fastRiskDecisionScore(report: RiskReport | null): number {
  if (!report) return 0;
  return report.score >= 85 ? report.score : 0;
}

function contractLlmCandidateAddresses(input: {
  originPaths: WhereIsMoneyReport["originPaths"];
  approvalDrainProvenanceProfiles: WhereIsMoneyReport["approvalDrainProvenanceProfiles"];
  approvalDrainReviewFindings: NonNullable<WhereIsMoneyReport["approvalDrainReviewFindings"]>;
}): string[] {
  const addresses = new Set<string>();
  for (const path of input.originPaths) {
    if (path.rootSourceAddress) addresses.add(path.rootSourceAddress);
    if (path.rootSourceType === "decline_boundary" || path.stoppedReason === "unlabeled_service_boundary" || path.verdict !== "ACCEPTABLE") {
      for (const address of path.pathAddresses) addresses.add(address);
    }
  }
  for (const profile of input.approvalDrainProvenanceProfiles) {
    addresses.add(profile.spenderAddress);
  }
  for (const finding of input.approvalDrainReviewFindings) {
    if (finding.spenderAddress) addresses.add(finding.spenderAddress);
  }
  return [...addresses];
}

function windowEdges(edges: ForensicRouteEdge[], input: RunWhereIsMoneyCheckInput): ForensicRouteEdge[] {
  return edges.filter((edge) => edge.timestamp >= input.windowStart && edge.timestamp <= input.windowEnd);
}

function dedupeEdges(edges: ForensicRouteEdge[]): ForensicRouteEdge[] {
  const byKey = new Map<string, ForensicRouteEdge>();
  for (const edge of edges) {
    byKey.set(`${edge.txHash}:${edge.fromAddress}:${edge.toAddress}:${edge.amountRaw}`, edge);
  }
  return [...byKey.values()];
}

function sumRawAmounts(values: string[]): string {
  return values.reduce((sum, value) => sum + (/^\d+$/.test(value) ? BigInt(value) : 0n), 0n).toString();
}

function seededBalanceFormingSelection(input: {
  seedTransfers: BalanceFormingTransfer[];
  currentBalanceRaw: string | null;
  requestedAmountRaw?: string | null;
}): BalanceFormingSelection {
  const selectedAmountRaw = sumRawAmounts(input.seedTransfers.map((transfer) => transfer.amountRaw));
  const targetAmountRaw = input.requestedAmountRaw ?? selectedAmountRaw;
  return {
    transfers: input.seedTransfers,
    currentBalanceRaw: input.currentBalanceRaw ?? "0",
    requestedAmountRaw: input.requestedAmountRaw ?? null,
    targetAmountRaw,
    selectedAmountRaw,
    coverageRatio: 1,
    selectedVolumeRaw: selectedAmountRaw,
    currentBalanceCoverageRatio: input.currentBalanceRaw && /^\d+$/.test(input.currentBalanceRaw) && BigInt(input.currentBalanceRaw) > 0n
      ? Math.min(Number(BigInt(selectedAmountRaw) * 1_000_000n / BigInt(input.currentBalanceRaw)) / 1_000_000, 1)
      : 1,
    partial: false,
    selectionMethod: "requested_amount",
    notes: ["Transaction check: balance-forming transfer was supplied from the checked transaction."]
  };
}

export async function runWhereIsMoneyCheck(
  deps: WhereIsMoneyDeps,
  input: RunWhereIsMoneyCheckInput
): Promise<WhereIsMoneyReport> {
  const sourceAddress = input.subjectAddress ?? input.sourceAddress;
  if (!sourceAddress) {
    throw new Error("runWhereIsMoneyCheck requires sourceAddress or subjectAddress");
  }
  const maxDepth = input.maxDepth ?? DEFAULT_MAX_DEPTH;
  const beamWidth = input.beamWidth ?? DEFAULT_BEAM_WIDTH;
  const maxAddressFetches = input.maxAddressFetches ?? DEFAULT_MAX_ADDRESS_FETCHES;
  const maxEdgesPerAddress = input.maxEdgesPerAddress ?? DEFAULT_MAX_EDGES_PER_ADDRESS;
  const fallbackMinTransferCount = input.recentFallbackMinTransferCount ?? DEFAULT_RECENT_FALLBACK_MIN_TRANSFER_COUNT;
  const fallbackTransferLimit = input.recentFallbackTransferLimit ?? DEFAULT_RECENT_FALLBACK_TRANSFER_LIMIT;
  const fastWalletRisk = await deps.getFastWalletRisk?.(sourceAddress) ?? null;
  const currentBalanceRaw = await deps.getTrc20Balance(sourceAddress, TRON_USDT_CONTRACT_ADDRESS).catch(() => null);
  const fetchedAddresses = new Set<string>();
  const edgeCache = new Map<string, ForensicRouteEdge[]>();
  const fetchCachedEdgesForAddress = async (address: string): Promise<ForensicRouteEdge[]> => {
    const cached = edgeCache.get(address);
    if (cached) return cached;
    fetchedAddresses.add(address);
    const fetchedEdges = await deps.fetchEdgesForAddress(address).catch(() => []);
    const windowedEdges = windowEdges(fetchedEdges, input);
    const shouldUseFallback = fallbackMinTransferCount > 0 &&
      fallbackTransferLimit > 0 &&
      windowedEdges.length < fallbackMinTransferCount;
    const latestEdges = shouldUseFallback
      ? await (deps.fetchLatestEdgesForAddress?.(address, fallbackTransferLimit) ?? Promise.resolve(fetchedEdges)).catch(() => [])
      : [];
    const edges = dedupeEdges([...windowedEdges, ...latestEdges]);
    edgeCache.set(address, edges);
    return edges;
  };
  const selection = input.seedTransfers
    ? seededBalanceFormingSelection({
        seedTransfers: input.seedTransfers,
        currentBalanceRaw,
        requestedAmountRaw: input.requestedAmountRaw
      })
    : selectBalanceFormingTransfers({
        subjectAddress: sourceAddress,
        currentBalanceRaw,
        requestedAmountRaw: input.requestedAmountRaw,
        edges: await fetchCachedEdgesForAddress(sourceAddress)
      });

  if (selection.transfers.length === 0) {
    return fallbackReviewReport({
      sourceAddress,
      currentBalanceRaw,
      requestedAmountRaw: selection.requestedAmountRaw,
      targetAmountRaw: selection.targetAmountRaw,
      fastWalletRisk,
      maxDepth,
      notes: selection.notes.length > 0 ? selection.notes : ["No balance-forming inbound USDT transfers were available; manual review required."]
    });
  }

  const fetchEdgesForAddress = async (address: string): Promise<ForensicRouteEdge[]> => {
    return fetchCachedEdgesForAddress(address);
  };

  const originPaths = await Promise.all(selection.transfers.map((balanceTransfer) =>
    traceMoneyOriginPath({
      subjectAddress: sourceAddress,
      balanceTransfer,
      maxDepth,
      beamWidth,
      maxAddressFetches,
      maxEdgesPerAddress,
      fetchEdgesForAddress,
      getLabelsForAddress: deps.getLabelsForAddress,
      getClassificationForAddress: deps.getClassificationForAddress
    })
  ));
  const senderInteractionProfiles = await Promise.all(selection.transfers.map(async (balanceTransfer) =>
    buildMoneyOriginSenderInteractionProfile({
      subjectAddress: sourceAddress,
      balanceTransfer,
      edges: await fetchCachedEdgesForAddress(balanceTransfer.fromAddress)
    })
  ));
  let approvalDrainProvenanceProfiles: WhereIsMoneyReport["approvalDrainProvenanceProfiles"] = [];
  let approvalDrainReviewFindings: NonNullable<WhereIsMoneyReport["approvalDrainReviewFindings"]> = [];
  const classifications = new Map<string, ServiceClassification | null>();
  const getCachedClassification = async (address: string): Promise<ServiceClassification | null> => {
    if (classifications.has(address)) return classifications.get(address) ?? null;
    const classification = await deps.getClassificationForAddress(address).catch(() => null);
    classifications.set(address, classification);
    return classification;
  };
  if (deps.getTransaction && deps.listTrc20ApprovalChanges) {
    const approvalEdges = dedupeEdges([...edgeCache.values()].flat());
    const maxApprovalCandidates = Math.max(5, selection.transfers.length * 3);
    const edgeAddresses = new Set([...edgeCache.values()]
      .flatMap((edges) => edges.flatMap((edge) => [edge.fromAddress, edge.toAddress])));
    await Promise.all([...edgeAddresses].map((address) => getCachedClassification(address)));
    const contractProfiles = await buildApprovalDrainContractProfiles({
      edges: approvalEdges,
      classifications,
      getCachedClassification,
      getTransaction: deps.getTransaction,
      getContractIntelligenceProfile: deps.getContractIntelligenceProfile,
      maxCandidates: maxApprovalCandidates
    });
    const approvalDrainAnalysis = await buildApprovalDrainProvenanceAnalysis({
      subjectAddress: sourceAddress,
      edges: approvalEdges,
      classifications,
      contractProfiles,
      deps: {
        getTransaction: deps.getTransaction,
        listTrc20ApprovalChanges: deps.listTrc20ApprovalChanges,
        getUsdtRestrictionStatus: deps.getUsdtRestrictionStatus
      },
      maxCandidates: maxApprovalCandidates,
      approvalChangeLookupLimit: 10
    }).catch(() => ({ profiles: [], reviewFindings: [] }));
    approvalDrainProvenanceProfiles = approvalDrainAnalysis.profiles;
    approvalDrainReviewFindings = approvalDrainAnalysis.reviewFindings;
  }
  const combined = combineMoneyOriginDecision(originPaths);
  const fastScore = fastRiskDecisionScore(fastWalletRisk);
  const approvalDrainScore = approvalDrainProvenanceProfiles[0]?.score ?? 0;
  let riskScore = Math.max(combined.riskScore, fastScore, approvalDrainScore);
  const fastDecline = fastScore >= 85;
  const approvalDrainDecline = approvalDrainScore >= 70;
  let decision = fastDecline || approvalDrainDecline ? "DECLINE" : combined.decision;
  let decisionReasons = [
    ...(fastDecline && fastWalletRisk
      ? [`Fast wallet check is ${fastWalletRisk.level} ${fastWalletRisk.score}/100 from exact or critical evidence.`]
      : []),
    ...(approvalDrainDecline
      ? [`Balance-forming path contains exact approval-drain transferFrom evidence (${approvalDrainProvenanceProfiles.length} profile(s)).`]
      : []),
    ...combined.decisionReasons
  ];
  let contractLlmVerdicts: ContractLlmVerdictSummary[] = [];
  const needsContractLlmForDecision = !fastDecline &&
    !approvalDrainDecline &&
    (decision === "REVIEW" || approvalDrainReviewFindings.length > 0);
  const shouldBuildContractLlmReport = Boolean(deps.analyzeContractLlmCaseFiles || needsContractLlmForDecision);
  if (shouldBuildContractLlmReport) {
    const candidateAddresses = contractLlmCandidateAddresses({
      originPaths,
      approvalDrainProvenanceProfiles,
      approvalDrainReviewFindings
    });
    await Promise.all(candidateAddresses.map((address) => getCachedClassification(address)));
    const preliminaryCaseFiles = buildContractAnalysisCaseFiles({
      subjectAddress: sourceAddress,
      currentUsdtBalanceRaw: currentBalanceRaw,
      balanceFormingTransfers: selection.transfers,
      originPaths,
      senderInteractionProfiles,
      approvalDrainProvenanceProfiles,
      approvalDrainReviewFindings,
      classifications
    });
    const contractProfiles = await buildContractProfilesForCaseFiles({
      caseFiles: preliminaryCaseFiles,
      getContractIntelligenceProfile: deps.getContractIntelligenceProfile
    });
    const caseFiles = buildContractAnalysisCaseFiles({
      subjectAddress: sourceAddress,
      currentUsdtBalanceRaw: currentBalanceRaw,
      balanceFormingTransfers: selection.transfers,
      originPaths,
      senderInteractionProfiles,
      approvalDrainProvenanceProfiles,
      approvalDrainReviewFindings,
      classifications,
      contractProfiles
    });
    if (caseFiles.length > 0) {
      contractLlmVerdicts = deps.analyzeContractLlmCaseFiles
        ? await deps.analyzeContractLlmCaseFiles(caseFiles).catch(() => unavailableVerdictsForCaseFiles(caseFiles))
        : unavailableVerdictsForCaseFiles(caseFiles);
      if (needsContractLlmForDecision) {
        const adjusted = applyContractLlmVerdictsToDecision({
          deterministicDecision: decision === "ACCEPTABLE" && approvalDrainReviewFindings.length > 0 ? "REVIEW" : decision,
          deterministicRiskScore: riskScore,
          deterministicReasons: decisionReasons,
          verdicts: contractLlmVerdicts,
          riskyMoneyPath: approvalDrainReviewFindings.length > 0 || originPaths.some((path) => path.verdict !== "ACCEPTABLE")
        });
        decision = adjusted.decision;
        riskScore = adjusted.riskScore;
        decisionReasons = adjusted.decisionReasons;
      }
    }
  }
  if (decision === "REVIEW") {
    decision = "DECLINE";
    riskScore = Math.max(riskScore, 65);
    decisionReasons = [
      "Clean source could not be proven; exchange policy declines this wallet by safe default.",
      ...decisionReasons
    ];
  }

  return {
    subjectAddress: sourceAddress,
    currentUsdtBalanceRaw: currentBalanceRaw,
    fastWalletRisk,
    balanceFormingTransfers: selection.transfers,
    originPaths,
    senderInteractionProfiles,
    approvalDrainProvenanceProfiles,
    approvalDrainReviewFindings,
    contractLlmVerdicts,
    decision,
    ...whereDecisionFields(decision, decisionReasons),
    riskScore,
    decisionReasons,
    coverage: {
      selectedInboundTxCount: selection.transfers.length,
      currentBalanceRaw,
      requestedAmountRaw: selection.requestedAmountRaw,
      targetAmountRaw: selection.targetAmountRaw,
      selectedAmountRaw: selection.selectedAmountRaw,
      coverageRatio: selection.coverageRatio,
      selectedInboundVolumeRaw: selection.selectedVolumeRaw,
      currentBalanceCoverageRatio: selection.currentBalanceCoverageRatio,
      maxDepth,
      fetchedAddressCount: fetchedAddresses.size,
      partial: selection.partial || originPaths.some((path) => path.verdict === "REVIEW"),
      notes: [
        selection.selectionMethod === "requested_amount"
          ? "Balance-forming approximation: latest inbound USDT flows sufficient to cover the requested amount."
          : "Balance-forming approximation: latest inbound USDT flows sufficient to explain the current wallet balance.",
        ...selection.notes,
        ...originPaths
          .filter((path) => path.verdict === "REVIEW")
          .map((path) => `${path.balanceTransferTxHash}: ${path.reasons[0]}`)
      ]
    }
  };
}
