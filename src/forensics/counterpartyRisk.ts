import type {
  AddressLabel,
  CounterpartyRiskDirection,
  CounterpartyRiskProfile,
  ForensicRouteEdge,
  RiskLabel,
  RouteScoreFeature,
  ServiceClassification
} from "../types";
import { isGasFreeServiceFeeEdge } from "./gasFreeSettlement";

export type BuildCounterpartyRiskProfilesInput = {
  subjectAddress: string;
  edges: ForensicRouteEdge[];
  labelsByAddress: Map<string, AddressLabel[]>;
  classifications?: Map<string, ServiceClassification | null>;
  minMeaningfulRaw?: bigint;
  minMeaningfulRatio?: number;
  absoluteMeaningfulRaw?: bigint;
};

const DEFAULT_MIN_MEANINGFUL_RAW = 100_000_000n;
const DEFAULT_ABSOLUTE_MEANINGFUL_RAW = 10_000_000_000n;
const DEFAULT_MIN_MEANINGFUL_RATIO = 0.01;
const highRiskCounterpartyLabels = new Set<RiskLabel>(["darknet_exchange", "whitebit", "darknet_exchange_proximity"]);

function parseAmount(value: string): bigint {
  return /^\d+$/.test(value) ? BigInt(value) : 0n;
}

function ratio(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 0;
  return Number(numerator * 10_000n / denominator) / 10_000;
}

function compareRawDesc(left: string, right: string): number {
  const leftRaw = parseAmount(left);
  const rightRaw = parseAmount(right);
  if (leftRaw === rightRaw) return 0;
  return leftRaw > rightRaw ? -1 : 1;
}

function addFeature(features: RouteScoreFeature[], code: string, label: string, scoreImpact: number, value?: RouteScoreFeature["value"]): void {
  if (features.some((feature) => feature.code === code)) return;
  features.push({ code, label, scoreImpact, value });
}

function selectedLabel(labels: AddressLabel[] | undefined): RiskLabel | null {
  const active = labels ?? [];
  return active.find((label) => label.label === "darknet_exchange")?.label
    ?? active.find((label) => label.label === "whitebit")?.label
    ?? active.find((label) => label.label === "darknet_exchange_proximity")?.label
    ?? null;
}

function featureCodeForLabel(label: RiskLabel): string {
  if (label === "darknet_exchange") return "counterparty_direct_darknet_exchange";
  if (label === "whitebit") return "counterparty_direct_whitebit";
  return "counterparty_direct_darknet_exchange_proximity";
}

function featureLabelForLabel(label: RiskLabel): string {
  if (label === "darknet_exchange") return "Direct counterparty is a manually verified darknet exchange seed.";
  if (label === "whitebit") return "Direct counterparty is labeled WhiteBIT high-risk source.";
  return "Direct counterparty has a confirmed darknet exchange proximity marker.";
}

function isMeaningful(input: {
  amountRaw: bigint;
  volumeRatio: number;
  minMeaningfulRaw: bigint;
  minMeaningfulRatio: number;
  absoluteMeaningfulRaw: bigint;
}): boolean {
  if (input.amountRaw >= input.absoluteMeaningfulRaw) return true;
  return input.amountRaw >= input.minMeaningfulRaw && input.volumeRatio >= input.minMeaningfulRatio;
}

function groupedProfiles(input: {
  subjectAddress: string;
  edges: ForensicRouteEdge[];
  direction: CounterpartyRiskDirection;
  directionalVolumeRaw: bigint;
  labelsByAddress: Map<string, AddressLabel[]>;
  classifications?: Map<string, ServiceClassification | null>;
  minMeaningfulRaw: bigint;
  minMeaningfulRatio: number;
  absoluteMeaningfulRaw: bigint;
}): CounterpartyRiskProfile[] {
  const groups = new Map<string, ForensicRouteEdge[]>();
  for (const edge of input.edges) {
    const counterparty = input.direction === "inbound" ? edge.fromAddress : edge.toAddress;
    const current = groups.get(counterparty) ?? [];
    current.push(edge);
    groups.set(counterparty, current);
  }

  const profiles: CounterpartyRiskProfile[] = [];
  for (const [counterpartyAddress, edges] of groups) {
    const amountRaw = edges.reduce((sum, edge) => sum + parseAmount(edge.amountRaw), 0n);
    const volumeRatio = ratio(amountRaw, input.directionalVolumeRaw);
    const label = selectedLabel(input.labelsByAddress.get(counterpartyAddress));
    const classification = input.classifications?.get(counterpartyAddress) ?? null;
    const serviceCategory =
      classification?.isBoundary === true && classification.category !== "none"
        ? classification.category
        : null;
    const identity = classification?.identity ?? null;
    const meaningful = isMeaningful({
      amountRaw,
      volumeRatio,
      minMeaningfulRaw: input.minMeaningfulRaw,
      minMeaningfulRatio: input.minMeaningfulRatio,
      absoluteMeaningfulRaw: input.absoluteMeaningfulRaw
    });
    const features: RouteScoreFeature[] = [];
    let score = 0;

    if (label && highRiskCounterpartyLabels.has(label) && meaningful) {
      score = 80;
      addFeature(
        features,
        featureCodeForLabel(label),
        featureLabelForLabel(label),
        80,
        volumeRatio
      );
    } else if (label && highRiskCounterpartyLabels.has(label)) {
      addFeature(features, "counterparty_exposure_below_threshold", "Direct high-risk counterparty exposure is below meaningful volume thresholds.", 0, volumeRatio);
    } else if (serviceCategory !== null) {
      addFeature(features, "counterparty_service_boundary_context", "Direct counterparty is service/router/CEX/bridge infrastructure; this is context only.", 0, serviceCategory);
    }

    if (features.length === 0) continue;
    const sortedEdges = [...edges].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    profiles.push({
      subjectAddress: input.subjectAddress,
      direction: input.direction,
      counterpartyAddress,
      label,
      serviceCategory,
      identity,
      amountRaw: amountRaw.toString(),
      txCount: edges.length,
      volumeRatio,
      firstTransferAt: sortedEdges[0].timestamp.toISOString(),
      lastTransferAt: sortedEdges.at(-1)?.timestamp.toISOString() ?? sortedEdges[0].timestamp.toISOString(),
      txHashes: sortedEdges.map((edge) => edge.txHash),
      score,
      features
    });
  }

  return profiles.sort((a, b) => b.score - a.score || compareRawDesc(a.amountRaw, b.amountRaw));
}

export function buildCounterpartyRiskProfiles(input: BuildCounterpartyRiskProfilesInput): CounterpartyRiskProfile[] {
  const riskEligibleEdges = input.edges.filter((edge) => !isGasFreeServiceFeeEdge(edge));
  const incoming = riskEligibleEdges.filter((edge) => edge.toAddress === input.subjectAddress);
  const outgoing = riskEligibleEdges.filter((edge) => edge.fromAddress === input.subjectAddress);
  const incomingVolumeRaw = input.edges
    .filter((edge) => edge.toAddress === input.subjectAddress)
    .reduce((sum, edge) => sum + parseAmount(edge.amountRaw), 0n);
  const outgoingVolumeRaw = input.edges
    .filter((edge) => edge.fromAddress === input.subjectAddress)
    .reduce((sum, edge) => sum + parseAmount(edge.amountRaw), 0n);
  const options = {
    subjectAddress: input.subjectAddress,
    labelsByAddress: input.labelsByAddress,
    classifications: input.classifications,
    minMeaningfulRaw: input.minMeaningfulRaw ?? DEFAULT_MIN_MEANINGFUL_RAW,
    minMeaningfulRatio: input.minMeaningfulRatio ?? DEFAULT_MIN_MEANINGFUL_RATIO,
    absoluteMeaningfulRaw: input.absoluteMeaningfulRaw ?? DEFAULT_ABSOLUTE_MEANINGFUL_RAW
  };

  return [
    ...groupedProfiles({
      ...options,
      edges: incoming,
      direction: "inbound",
      directionalVolumeRaw: incomingVolumeRaw
    }),
    ...groupedProfiles({
      ...options,
      edges: outgoing,
      direction: "outbound",
      directionalVolumeRaw: outgoingVolumeRaw
    })
  ].sort((a, b) => b.score - a.score || compareRawDesc(a.amountRaw, b.amountRaw));
}
