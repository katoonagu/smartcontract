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
  ForensicRouteEdge,
  RiskReport,
  ServiceClassification,
  StablecoinRestrictionProfile,
  WhereIsMoneyReport
} from "../types";

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
  sourceAddress: string;
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

function fallbackReviewReport(input: {
  sourceAddress: string;
  currentBalanceRaw: string | null;
  fastWalletRisk: RiskReport | null;
  maxDepth: number;
  notes: string[];
}): WhereIsMoneyReport {
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
    decision: "DECLINE",
    riskScore: Math.max(65, input.fastWalletRisk?.score ?? 0),
    decisionReasons: input.notes.map((note) =>
      `Clean source could not be proven; exchange policy declines this wallet by safe default. ${note}`
    ),
    coverage: {
      selectedInboundTxCount: 0,
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

export async function runWhereIsMoneyCheck(
  deps: WhereIsMoneyDeps,
  input: RunWhereIsMoneyCheckInput
): Promise<WhereIsMoneyReport> {
  const maxDepth = input.maxDepth ?? DEFAULT_MAX_DEPTH;
  const beamWidth = input.beamWidth ?? DEFAULT_BEAM_WIDTH;
  const maxAddressFetches = input.maxAddressFetches ?? DEFAULT_MAX_ADDRESS_FETCHES;
  const maxEdgesPerAddress = input.maxEdgesPerAddress ?? DEFAULT_MAX_EDGES_PER_ADDRESS;
  const fallbackMinTransferCount = input.recentFallbackMinTransferCount ?? DEFAULT_RECENT_FALLBACK_MIN_TRANSFER_COUNT;
  const fallbackTransferLimit = input.recentFallbackTransferLimit ?? DEFAULT_RECENT_FALLBACK_TRANSFER_LIMIT;
  const fastWalletRisk = await deps.getFastWalletRisk?.(input.sourceAddress) ?? null;
  const currentBalanceRaw = await deps.getTrc20Balance(input.sourceAddress, TRON_USDT_CONTRACT_ADDRESS).catch(() => null);
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
  const sourceEdges = await fetchCachedEdgesForAddress(input.sourceAddress);
  const selection = selectBalanceFormingTransfers({
    subjectAddress: input.sourceAddress,
    currentBalanceRaw,
    edges: sourceEdges
  });

  if (selection.transfers.length === 0) {
    return fallbackReviewReport({
      sourceAddress: input.sourceAddress,
      currentBalanceRaw,
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
      subjectAddress: input.sourceAddress,
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
      subjectAddress: input.sourceAddress,
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
    const edgeAddresses = new Set([...edgeCache.values()]
      .flatMap((edges) => edges.flatMap((edge) => [edge.fromAddress, edge.toAddress])));
    await Promise.all([...edgeAddresses].map((address) => getCachedClassification(address)));
    const approvalDrainAnalysis = await buildApprovalDrainProvenanceAnalysis({
      subjectAddress: input.sourceAddress,
      edges: dedupeEdges([...edgeCache.values()].flat()),
      classifications,
      deps: {
        getTransaction: deps.getTransaction,
        listTrc20ApprovalChanges: deps.listTrc20ApprovalChanges,
        getUsdtRestrictionStatus: deps.getUsdtRestrictionStatus
      },
      maxCandidates: Math.max(5, selection.transfers.length * 3),
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
      subjectAddress: input.sourceAddress,
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
      subjectAddress: input.sourceAddress,
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
    subjectAddress: input.sourceAddress,
    currentUsdtBalanceRaw: currentBalanceRaw,
    fastWalletRisk,
    balanceFormingTransfers: selection.transfers,
    originPaths,
    senderInteractionProfiles,
    approvalDrainProvenanceProfiles,
    approvalDrainReviewFindings,
    contractLlmVerdicts,
    decision,
    riskScore,
    decisionReasons,
    coverage: {
      selectedInboundTxCount: selection.transfers.length,
      selectedInboundVolumeRaw: selection.selectedVolumeRaw,
      currentBalanceCoverageRatio: selection.currentBalanceCoverageRatio,
      maxDepth,
      fetchedAddressCount: fetchedAddresses.size,
      partial: selection.partial || originPaths.some((path) => path.verdict === "REVIEW"),
      notes: [
        "Balance-forming approximation: latest inbound USDT flows sufficient to explain the current wallet balance.",
        ...selection.notes,
        ...originPaths
          .filter((path) => path.verdict === "REVIEW")
          .map((path) => `${path.balanceTransferTxHash}: ${path.reasons[0]}`)
      ]
    }
  };
}
