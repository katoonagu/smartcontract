import type { AddressLabel, ForensicRouteEdge, InboundProvenancePath, InboundProvenanceProfile, RouteScoreFeature, ServiceClassification } from "../types";
import { isGasFreeServiceFeeEdge } from "./gasFreeSettlement";

export type BuildInboundProvenanceProfileInput = {
  subjectAddress: string;
  edges: ForensicRouteEdge[];
  labelsByAddress: Map<string, AddressLabel[]>;
  classifications?: Map<string, ServiceClassification | null>;
  minAmountPreservationRatio?: number;
};

const DEFAULT_MIN_AMOUNT_PRESERVATION_RATIO = 0.7;
const criticalLabels = new Set<AddressLabel["label"]>([
  "scam",
  "stolen_funds",
  "phishing",
  "mixer_like",
  "risky_contract",
  "whitebit",
  "darknet_exchange"
]);

function edgeAmount(edge: ForensicRouteEdge): bigint {
  return /^\d+$/.test(edge.amountRaw) ? BigInt(edge.amountRaw) : 0n;
}

function ratio(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 0;
  return Number(numerator * 10_000n / denominator) / 10_000;
}

function preservationRatio(left: bigint, right: bigint): number {
  if (left <= 0n || right <= 0n) return 0;
  return left <= right ? ratio(left, right) : ratio(right, left);
}

function criticalLabel(labels: AddressLabel[] | undefined): AddressLabel | null {
  const activeLabels = labels ?? [];
  return activeLabels.find((label) => label.label === "darknet_exchange") ?? activeLabels.find((label) => criticalLabels.has(label.label)) ?? null;
}

function isDarknetExchange(label: AddressLabel | null): boolean {
  return label?.label === "darknet_exchange";
}

function isBoundaryAllowedHighRiskLabel(label: AddressLabel | null): boolean {
  return label?.label === "darknet_exchange" || label?.label === "whitebit";
}

function isBoundary(classification: ServiceClassification | null | undefined): boolean {
  return Boolean(classification && classification.category !== "none" && classification.isBoundary);
}

function addFeature(features: RouteScoreFeature[], code: string, label: string, scoreImpact: number, value?: string | number): void {
  if (features.some((feature) => feature.code === code)) return;
  features.push({ code, label, scoreImpact, value });
}

export function buildInboundProvenanceProfile(input: BuildInboundProvenanceProfileInput): InboundProvenanceProfile {
  const minPreservation = input.minAmountPreservationRatio ?? DEFAULT_MIN_AMOUNT_PRESERVATION_RATIO;
  const riskEligibleEdges = input.edges.filter((edge) => !isGasFreeServiceFeeEdge(edge));
  const incoming = riskEligibleEdges
    .filter((edge) => edge.toAddress === input.subjectAddress)
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const incomingVolume = input.edges
    .filter((edge) => edge.toAddress === input.subjectAddress)
    .reduce((sum, edge) => sum + edgeAmount(edge), 0n);
  const paths: InboundProvenancePath[] = [];
  const features: RouteScoreFeature[] = [];
  const boundaryNotes: string[] = [];
  let directFound = false;
  let twoHopFound = false;
  let darknetDirectFound = false;
  let darknetTwoHopFound = false;
  let whitebitDirectFound = false;
  let whitebitTwoHopFound = false;
  let matchedInboundVolume = 0n;

  for (const directEdge of incoming) {
    const directLabel = criticalLabel(input.labelsByAddress.get(directEdge.fromAddress));
    const directClassification = input.classifications?.get(directEdge.fromAddress) ?? null;
    if (isBoundary(directClassification) && !isBoundaryAllowedHighRiskLabel(directLabel)) {
      const note = `Funds reached service/CEX/bridge boundary ${directEdge.fromAddress} (${directClassification?.category}); public-chain continuity should not be assumed.`;
      if (!boundaryNotes.includes(note)) boundaryNotes.push(note);
      addFeature(features, "inbound_provenance_service_boundary", "Inbound source is a service/CEX/bridge boundary; public-chain continuity should not be assumed.", 0);
      continue;
    }

    if (directLabel) {
      if (isDarknetExchange(directLabel)) {
        darknetDirectFound = true;
      } else if (directLabel.label === "whitebit") {
        whitebitDirectFound = true;
      } else {
        directFound = true;
      }
      matchedInboundVolume += edgeAmount(directEdge);
      paths.push({
        depth: 1,
        sourceAddress: directEdge.fromAddress,
        viaAddresses: [],
        label: directLabel.label,
        amountRaw: directEdge.amountRaw,
        amountPreservationRatio: 1,
        firstTransferAt: directEdge.timestamp.toISOString(),
        lastTransferAt: directEdge.timestamp.toISOString(),
        txHashes: [directEdge.txHash]
      });
      if (isDarknetExchange(directLabel)) {
        addFeature(features, "inbound_provenance_darknet_exchange_direct", "Confirmed on-chain exposure to known darknet exchange seed within 2 hops.", 50);
      } else if (directLabel.label === "whitebit") {
        addFeature(features, "inbound_provenance_whitebit_direct", "Inbound provenance candidate from WhiteBIT high-risk source; manual review required.", 50);
      } else {
        addFeature(features, "inbound_provenance_direct_labeled_source", "Inbound provenance candidate from directly labeled source; manual review required.", 40);
      }
      continue;
    }

    const upstreamEdges = riskEligibleEdges
      .filter((edge) => edge.toAddress === directEdge.fromAddress && edge.timestamp.getTime() <= directEdge.timestamp.getTime())
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    for (const upstreamEdge of upstreamEdges) {
      const upstreamLabel = criticalLabel(input.labelsByAddress.get(upstreamEdge.fromAddress));
      const upstreamClassification = input.classifications?.get(upstreamEdge.fromAddress) ?? null;
      if (isBoundary(upstreamClassification) && !isBoundaryAllowedHighRiskLabel(upstreamLabel)) continue;
      if (!upstreamLabel) continue;
      const amountPreservationRatio = preservationRatio(edgeAmount(upstreamEdge), edgeAmount(directEdge));
      if (amountPreservationRatio < minPreservation) continue;

      if (isDarknetExchange(upstreamLabel)) {
        darknetTwoHopFound = true;
      } else if (upstreamLabel.label === "whitebit") {
        whitebitTwoHopFound = true;
      } else {
        twoHopFound = true;
      }
      matchedInboundVolume += edgeAmount(directEdge);
      paths.push({
        depth: 2,
        sourceAddress: upstreamEdge.fromAddress,
        viaAddresses: [directEdge.fromAddress],
        label: upstreamLabel.label,
        amountRaw: directEdge.amountRaw,
        amountPreservationRatio,
        firstTransferAt: upstreamEdge.timestamp.toISOString(),
        lastTransferAt: directEdge.timestamp.toISOString(),
        txHashes: [upstreamEdge.txHash, directEdge.txHash]
      });
      if (isDarknetExchange(upstreamLabel)) {
        addFeature(features, "inbound_provenance_darknet_exchange_two_hop", "Confirmed on-chain exposure to known darknet exchange seed within 2 hops.", 45);
      } else if (upstreamLabel.label === "whitebit") {
        addFeature(features, "inbound_provenance_whitebit_two_hop", "Inbound provenance candidate from WhiteBIT high-risk source within two hops; manual review required.", 45);
      } else {
        addFeature(features, "inbound_provenance_two_hop_labeled_source", "Inbound provenance candidate from labeled source within two hops; manual review required.", 30);
      }
      if (amountPreservationRatio >= 0.95) {
        addFeature(
          features,
          isDarknetExchange(upstreamLabel) ? "inbound_provenance_darknet_exchange_amount_preserved" : "inbound_provenance_amount_preserved",
          "Inbound path preserves most of the USDT amount.",
          0,
          amountPreservationRatio
        );
      }
      if (directEdge.timestamp.getTime() - upstreamEdge.timestamp.getTime() <= 60 * 60 * 1000) {
        addFeature(features, "inbound_provenance_fast_transit", "Inbound path moved through the intermediate address quickly.", 0);
      }
      break;
    }
  }

  return {
    subjectAddress: input.subjectAddress,
    incomingVolumeRaw: incomingVolume.toString(),
    matchedInboundVolumeRaw: matchedInboundVolume.toString(),
    paths,
    boundaryNotes,
    score: darknetDirectFound || whitebitDirectFound ? 50 : darknetTwoHopFound || whitebitTwoHopFound ? 45 : directFound ? 40 : twoHopFound ? 30 : 0,
    features
  };
}
