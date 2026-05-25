import { addressBehaviorEffectiveScore } from "./addressBehavior";
import type { AddressBehaviorProfile, AddressExposureReport, ForensicRouteEdge, ForensicRoutePath, RouteSearchReport, ServiceExposureProfile } from "../types";

function formatDate(value: Date): string {
  return value.toISOString().replace(".000Z", "Z");
}

function formatRawUsdt(amountRaw: string): string {
  if (!/^\d+$/.test(amountRaw)) return amountRaw;
  const raw = BigInt(amountRaw);
  const whole = raw / 1_000_000n;
  const fraction = (raw % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction} USDT` : `${whole} USDT`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatDurationMs(value: number | null): string {
  if (value === null) return "none";
  const minute = 60_000;
  const hour = 60 * minute;
  if (value < minute) return `${Math.round(value / 1000)}s`;
  if (value < hour) return `${Math.round(value / minute)}m`;
  return `${Math.round(value / hour)}h`;
}

function formatEdge(edge: ForensicRouteEdge, index: number): string {
  return [
    `  ${index + 1}. ${edge.fromAddress} -> ${edge.toAddress}`,
    `     Tx: ${edge.txHash}`,
    `     Amount: ${formatRawUsdt(edge.amountRaw)}`,
    `     Time: ${formatDate(edge.timestamp)}`,
    `     Method: ${edge.method} (${edge.edgeType})`
  ].join("\n");
}

function formatPath(path: ForensicRoutePath): string {
  const reasons = path.reasons.length > 0
    ? path.reasons.map((reason) => `  - ${reason.message}`).join("\n")
    : "  - No positive route reasons found; candidate path requires manual review.";
  return [
    `Path #${path.rank}: ${path.pathAddresses.join(" -> ")}`,
    `Score: ${path.score}/100`,
    `Confidence: ${path.confidence}`,
    `Path id: ${path.id}`,
    `Raw evidence id: ${path.rawEvidenceId ?? "none"}`,
    "Why:",
    reasons,
    "Edges:",
    path.edges.map(formatEdge).join("\n")
  ].join("\n");
}

function formatServiceExposure(profile: ServiceExposureProfile): string {
  const topCounterparties = profile.topServiceCounterparties.length > 0
    ? profile.topServiceCounterparties.map((item) =>
      `  - ${item.address} (${item.category}${item.identity ? `, ${item.identity}` : ""}): ${formatRawUsdt(item.volumeRaw)} / ${item.txCount} tx`
    )
    : ["  - none"];
  const topMergedFlows = profile.topMergedServiceFlows.length > 0
    ? profile.topMergedServiceFlows.map((item) =>
      [
        `  - ${item.intermediateAddress} -> ${item.serviceAddress} (${item.category}${item.identity ? `, ${item.identity}` : ""})`,
        `    Incoming: ${formatRawUsdt(item.incomingRaw)} / ${item.sourceTxCount} tx`,
        `    Service exits: ${formatRawUsdt(item.outgoingServiceRaw)} / ${item.serviceTxCount} tx`,
        `    Amount preservation: ${formatPercent(item.amountPreservationRatio)}`,
        `    Window: ${item.firstSourceTransferAt} -> ${item.lastServiceTransferAt}`,
        "    merged service exposure candidate requires manual review"
      ].join("\n")
    )
    : ["  - none"];
  const features = profile.features.length > 0
    ? profile.features.map((item) => `  - ${item.label}; candidate exposure requires manual review`).join("\n")
    : "  - No service exposure reasons found.";
  return [
    "Service Exposure",
    `Subject: ${profile.subjectAddress}`,
    `Exposure score: ${profile.exposureScore}/100`,
    `Outgoing USDT: ${formatRawUsdt(profile.totalOutgoingRaw)} across ${profile.totalOutgoingCount} tx`,
    `Direct service volume: ${formatPercent(profile.directServiceVolumeRatio)}`,
    `Indirect service volume: ${formatPercent(profile.indirectServiceVolumeRatio)}`,
    `Merged service volume: ${formatPercent(profile.mergedServiceVolumeRatio)}`,
    `Combined service volume: ${formatPercent(profile.combinedServiceVolumeRatio)}`,
    `Dominant category: ${profile.dominantCategory ?? "none"}`,
    `Fastest service exit: ${formatDurationMs(profile.fastestServiceExitMs)}`,
    `Best amount preservation: ${profile.bestAmountPreservationRatio === null ? "none" : formatPercent(profile.bestAmountPreservationRatio)}`,
    "Top service counterparties:",
    ...topCounterparties,
    "Top merged service flows:",
    ...topMergedFlows,
    "Why:",
    features
  ].join("\n");
}

function formatAddressBehavior(profile: AddressBehaviorProfile): string {
  const features = profile.features.length > 0
    ? profile.features.map((item) => `  - ${item.label}`).join("\n")
    : "  - No address behavior reasons found.";
  const topOutgoing = profile.topOutgoingCounterpartyAddress
    ? [
        `Top outgoing counterparty: ${profile.topOutgoingCounterpartyAddress}`,
        `  ${formatRawUsdt(profile.topOutgoingCounterpartyRaw ?? "0")} / ${profile.topOutgoingCounterpartyTxCount} tx / ${formatPercent(profile.topOutgoingCounterpartyRatio)}`
      ]
    : ["Top outgoing counterparty: none"];

  return [
    "Address Behavior",
    `Subject: ${profile.subjectAddress}`,
    `Behavior score: ${addressBehaviorEffectiveScore(profile)}/30`,
    `Incoming USDT: ${formatRawUsdt(profile.incomingVolumeRaw)} across ${profile.incomingTxCount} tx`,
    `Outgoing USDT: ${formatRawUsdt(profile.outgoingVolumeRaw)} across ${profile.outgoingTxCount} tx`,
    `Inflow/outflow preservation: ${profile.inflowToOutflowRatio === null ? "none" : formatPercent(profile.inflowToOutflowRatio)}`,
    `Service drain: ${formatPercent(profile.drainToServiceRatio)}`,
    `First outgoing after incoming: ${formatDurationMs(profile.timeToFirstOutgoingMs)}`,
    `First service exit after incoming: ${formatDurationMs(profile.timeToFirstServiceExitMs)}`,
    `Fan-in/out: ${profile.uniqueIncomingCounterparties}/${profile.uniqueOutgoingCounterparties}`,
    ...topOutgoing,
    "Why:",
    features
  ].join("\n");
}

export function formatForensicRouteReport(report: RouteSearchReport, options: { dryRun?: boolean } = {}): string {
  const header = [
    "Forensic Route Search",
    `Case: ${report.case.id}`,
    `Status: ${report.case.status}${options.dryRun ? " (DRY RUN - not saved)" : ""}`,
    `Source: ${report.case.sourceAddress}`,
    `Target: ${report.case.targetAddress}`,
    `Amount: ${report.case.amountUsdt ?? "not provided"}`,
    `Window: ${formatDate(report.case.windowStart)} -> ${formatDate(report.case.windowEnd)}`
  ];
  const pathText = report.paths.length > 0
    ? report.paths.map(formatPath).join("\n\n")
    : "No candidate paths found within configured caps.";
  const serviceExposure = report.serviceExposureProfiles.length > 0
    ? report.serviceExposureProfiles.map(formatServiceExposure).join("\n\n")
    : "";
  const missing = report.missingChecks.length > 0
    ? ["Missing / partial checks:", ...report.missingChecks.map((item) => `- ${item}`)]
    : [];
  const saved = options.dryRun
    ? []
    : [
        "Saved:",
        `- Case row: ${report.case.id}`,
        `- Path rows: ${report.paths.map((path) => path.id).join(", ") || "none"}`,
        `- Evidence rows: ${report.rawEvidence.map((item) => item.id).join(", ") || "none"}`
      ];
  return [...header, "", pathText, "", serviceExposure, "", ...missing, ...saved].filter((line) => line !== "").join("\n");
}

export function formatAddressExposureReport(report: AddressExposureReport, options: { dryRun?: boolean } = {}): string {
  const header = [
    "Address Service Exposure",
    `Status: report-only${options.dryRun ? " (DRY RUN - not saved)" : ""}`,
    `Subject: ${report.subjectAddress}`,
    `Window: ${formatDate(report.windowStart)} -> ${formatDate(report.windowEnd)}`
  ];
  const serviceExposure = report.serviceExposureProfiles.length > 0
    ? report.serviceExposureProfiles.map(formatServiceExposure).join("\n\n")
    : "No service exposure profile was produced.";
  const addressBehavior = report.addressBehaviorProfiles.length > 0
    ? report.addressBehaviorProfiles.map(formatAddressBehavior).join("\n\n")
    : "";
  const missing = report.missingChecks.length > 0
    ? ["Missing / partial checks:", ...report.missingChecks.map((item) => `- ${item}`)]
    : [];
  return [...header, "", serviceExposure, "", addressBehavior, "", ...missing].filter((line) => line !== "").join("\n");
}
