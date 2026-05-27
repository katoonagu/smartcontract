import { TRON_USDT_CONTRACT_ADDRESS } from "../parser/transactionParser";
import { selectBalanceFormingTransfers } from "../forensics/balanceFormingTransfers";
import { combineMoneyOriginDecision } from "../forensics/moneyOriginPolicy";
import { traceMoneyOriginPath } from "../forensics/moneyOriginTrace";
import type {
  AddressLabel,
  ForensicRouteEdge,
  RiskReport,
  ServiceClassification,
  WhereIsMoneyReport
} from "../types";

export type WhereIsMoneyDeps = {
  getTrc20Balance(address: string, tokenContractAddress: string): Promise<string | null>;
  fetchEdgesForAddress(address: string): Promise<ForensicRouteEdge[]>;
  getLabelsForAddress(address: string): Promise<AddressLabel[]>;
  getClassificationForAddress(address: string): Promise<ServiceClassification | null>;
  getFastWalletRisk?(address: string): Promise<RiskReport | null>;
};

export type RunWhereIsMoneyCheckInput = {
  sourceAddress: string;
  windowStart: Date;
  windowEnd: Date;
  maxDepth?: number;
  beamWidth?: number;
  maxAddressFetches?: number;
  maxEdgesPerAddress?: number;
};

const DEFAULT_MAX_DEPTH = 7;
const DEFAULT_BEAM_WIDTH = 8;
const DEFAULT_MAX_ADDRESS_FETCHES = 60;
const DEFAULT_MAX_EDGES_PER_ADDRESS = 40;

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
    decision: "REVIEW",
    riskScore: Math.max(45, input.fastWalletRisk?.score ?? 0),
    decisionReasons: input.notes,
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

function fastRiskDecisionScore(report: RiskReport | null): number {
  if (!report) return 0;
  return report.score >= 85 ? report.score : 0;
}

function windowEdges(edges: ForensicRouteEdge[], input: RunWhereIsMoneyCheckInput): ForensicRouteEdge[] {
  return edges.filter((edge) => edge.timestamp >= input.windowStart && edge.timestamp <= input.windowEnd);
}

export async function runWhereIsMoneyCheck(
  deps: WhereIsMoneyDeps,
  input: RunWhereIsMoneyCheckInput
): Promise<WhereIsMoneyReport> {
  const maxDepth = input.maxDepth ?? DEFAULT_MAX_DEPTH;
  const beamWidth = input.beamWidth ?? DEFAULT_BEAM_WIDTH;
  const maxAddressFetches = input.maxAddressFetches ?? DEFAULT_MAX_ADDRESS_FETCHES;
  const maxEdgesPerAddress = input.maxEdgesPerAddress ?? DEFAULT_MAX_EDGES_PER_ADDRESS;
  const fastWalletRisk = await deps.getFastWalletRisk?.(input.sourceAddress) ?? null;
  const currentBalanceRaw = await deps.getTrc20Balance(input.sourceAddress, TRON_USDT_CONTRACT_ADDRESS).catch(() => null);
  const sourceEdges = windowEdges(await deps.fetchEdgesForAddress(input.sourceAddress).catch(() => []), input);
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

  const fetchedAddresses = new Set<string>([input.sourceAddress]);
  const fetchEdgesForAddress = async (address: string): Promise<ForensicRouteEdge[]> => {
    fetchedAddresses.add(address);
    return windowEdges(await deps.fetchEdgesForAddress(address), input);
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
  const combined = combineMoneyOriginDecision(originPaths);
  const fastScore = fastRiskDecisionScore(fastWalletRisk);
  const riskScore = Math.max(combined.riskScore, fastScore);
  const fastDecline = fastScore >= 85;
  const decision = fastDecline ? "DECLINE" : combined.decision;
  const decisionReasons = fastDecline && fastWalletRisk
    ? [
        `Fast wallet check is ${fastWalletRisk.level} ${fastWalletRisk.score}/100 from exact or critical evidence.`,
        ...combined.decisionReasons
      ]
    : combined.decisionReasons;

  return {
    subjectAddress: input.sourceAddress,
    currentUsdtBalanceRaw: currentBalanceRaw,
    fastWalletRisk,
    balanceFormingTransfers: selection.transfers,
    originPaths,
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
