import "dotenv/config";
import { loadConfig } from "../src/config";
import { closeDb, createDb } from "../src/storage/db";
import {
  getAddressMetadata,
  getContractIntelligenceProfile,
  listIndexedTronUsdtTransfersForAddress
} from "../src/storage/repositories";
import type { BoundaryExposureDepth, BoundaryExposureFlow, BoundaryExposureProfile, ForensicRouteEdge, OperationalFlowProfile, ServiceClassification } from "../src/types";
import { boundaryProfilesToOperationalEdges, buildOperationalFlowProfile } from "../src/forensics/flowCounterpartyProfile";
import { indexedTransferToRouteEdge } from "../src/forensics/localTronUsdtIndex";
import { runMultiHopBoundaryExposureSearch } from "../src/forensics/multiHopBoundaryExposure";
import { parseOperationalReportCliArgs } from "../src/forensics/operationalReportCliArgs";
import { classifyServiceAddress } from "../src/forensics/serviceClassifier";

function formatRawUsdt(amountRaw: string): string {
  if (!/^\d+$/.test(amountRaw)) return amountRaw;
  const raw = BigInt(amountRaw);
  const whole = raw / 1_000_000n;
  const fraction = (raw % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction} USDT` : `${whole} USDT`;
}

function formatPercent(value: number | null): string {
  if (value === null) return "n/a";
  return `${Math.round(value * 100)}%`;
}

function levelFromScore(score: number): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  if (score >= 85) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 30) return "MEDIUM";
  return "LOW";
}

function pathForFlow(subjectAddress: string, flow: BoundaryExposureFlow): string {
  if (flow.direction === "outbound") {
    return [subjectAddress, ...(flow.viaAddresses ?? []), flow.boundaryAddress].join(" -> ");
  }
  return [flow.boundaryAddress, ...(flow.viaAddresses ?? []).slice().reverse(), subjectAddress].join(" -> ");
}

function txForFlow(flow: BoundaryExposureFlow): string {
  return flow.subjectTxHash === flow.boundaryTxHash
    ? flow.subjectTxHash
    : `${flow.subjectTxHash} -> ${flow.boundaryTxHash}`;
}

function dedupeEdges(edges: ForensicRouteEdge[]): ForensicRouteEdge[] {
  const result = new Map<string, ForensicRouteEdge>();
  for (const edge of edges) {
    result.set(`${edge.txHash}:${edge.fromAddress}:${edge.toAddress}:${edge.amountRaw}`, edge);
  }
  return [...result.values()];
}

function coveredSubjectTxHashes(profiles: BoundaryExposureProfile[]): Set<string> {
  return new Set(profiles.flatMap((profile) => profile.flows.map((flow) => flow.subjectTxHash)));
}

function printOperationalProfile(profile: OperationalFlowProfile): void {
  console.log(`Operational laundering pattern: ${profile.operationalScore}/100 (${levelFromScore(profile.operationalScore)})`);
  console.log("Taint evidence: not evaluated by this local report");
  console.log(`30d flow: incoming ${formatRawUsdt(profile.incomingVolumeRaw)}; outgoing ${formatRawUsdt(profile.outgoingVolumeRaw)}; preservation ${formatPercent(profile.inflowToOutflowRatio)}`);
  console.log(`Terminal liquidity outgoing: ${formatPercent(profile.terminalLiquidityOutgoingRatio)}`);
  console.log(`HTX/Huobi outgoing: ${formatPercent(profile.htxHuobiOutgoingRatio)}`);
  console.log(`Bridge/DEX/router outgoing: ${formatPercent(profile.bridgeDexRouterOutgoingRatio)}`);
  console.log(`Unknown contract outgoing: ${formatPercent(profile.unknownContractOutgoingRatio)}`);
  console.log("");
  console.log("Top outgoing counterparties:");
  if (profile.topOutgoingCounterparties.length === 0) {
    console.log("- none");
  }
  for (const counterparty of profile.topOutgoingCounterparties.slice(0, 10)) {
    console.log(`- ${counterparty.address} | ${counterparty.category ?? "none"} | ${counterparty.identity ?? "unknown"} | ${formatRawUsdt(counterparty.volumeRaw)} | ${formatPercent(counterparty.volumeRatio)}`);
  }
}

function printBoundaryPaths(subjectAddress: string, profiles: BoundaryExposureProfile[]): void {
  const flows = profiles
    .flatMap((profile) => profile.flows)
    .sort((left, right) =>
      left.direction.localeCompare(right.direction) ||
      left.depth - right.depth ||
      right.amountPreservationRatio - left.amountPreservationRatio
    );
  console.log("");
  console.log("Boundary paths:");
  if (flows.length === 0) {
    console.log("- none");
    return;
  }
  for (const flow of flows.slice(0, 20)) {
    const identity = flow.boundaryIdentity ?? flow.boundaryAddress;
    console.log(`- ${flow.direction} depth ${flow.depth} | ${flow.boundaryCategory} ${identity} | ${formatRawUsdt(flow.amountRaw)} | preservation ${formatPercent(flow.amountPreservationRatio)}`);
    console.log(`  path: ${pathForFlow(subjectAddress, flow)}`);
    console.log(`  tx: ${txForFlow(flow)}`);
  }
}

const args = parseOperationalReportCliArgs(process.argv.slice(2));

function databaseUrlFromEnvironment(): string {
  try {
    return loadConfig().databaseUrl;
  } catch (error) {
    if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
    throw error;
  }
}

const db = createDb(databaseUrlFromEnvironment());
const edgeCache = new Map<string, ForensicRouteEdge[]>();
const classificationCache = new Map<string, ServiceClassification | null>();

async function fetchEdgesForAddress(address: string): Promise<ForensicRouteEdge[]> {
  if (edgeCache.has(address)) return edgeCache.get(address) ?? [];
  const transfers = await listIndexedTronUsdtTransfersForAddress(db, {
    address,
    minTimestamp: args.windowStart,
    maxTimestamp: args.windowEnd,
    direction: "both",
    limit: 200,
    orderBy: "amount_desc"
  });
  const edges = transfers.map(indexedTransferToRouteEdge);
  edgeCache.set(address, edges);
  return edges;
}

async function getClassificationForAddress(address: string): Promise<ServiceClassification | null> {
  if (classificationCache.has(address)) return classificationCache.get(address) ?? null;
  const metadata = await getAddressMetadata(db, address, new Date());
  const contractProfile = metadata?.isContract
    ? await getContractIntelligenceProfile(db, address, new Date())
    : null;
  const classification = classifyServiceAddress({ address, metadata, contractProfile });
  classificationCache.set(address, classification);
  return classification;
}

try {
  const sourceEdges = await fetchEdgesForAddress(args.source);
  console.log(`Subject: ${args.source}`);
  console.log(`Window: ${args.windowStart.toISOString()} -> ${args.windowEnd.toISOString()}`);
  console.log(`Depth: ${args.depth}; beam: ${args.beamWidth}; max-addresses: ${args.maxAddressFetches}; min-preservation: ${args.minPreservation}`);
  if (sourceEdges.length === 0) {
    console.log("No indexed TRON USDT transfers found for the requested window. Live fast-check may still have data not present in the local offline index.");
    process.exitCode = 0;
  } else {
    const directCounterparties = new Set<string>();
    for (const edge of sourceEdges) {
      if (edge.fromAddress === args.source) directCounterparties.add(edge.toAddress);
      if (edge.toAddress === args.source) directCounterparties.add(edge.fromAddress);
    }
    await Promise.all([...directCounterparties].map((address) => getClassificationForAddress(address)));
    const boundaryProfiles = await Promise.all((["inbound", "outbound"] as const).map((direction) =>
      runMultiHopBoundaryExposureSearch({
        subjectAddress: args.source,
        direction,
        windowStart: args.windowStart,
        windowEnd: args.windowEnd,
        maxDepth: args.depth as BoundaryExposureDepth,
        beamWidth: args.beamWidth,
        maxAddressFetches: args.maxAddressFetches,
        minAmountPreservationRatio: args.minPreservation,
        fetchEdgesForAddress,
        getClassificationForAddress
      })
    ));
    const coveredTxHashes = coveredSubjectTxHashes(boundaryProfiles);
    const operationalEdges = dedupeEdges([
      ...sourceEdges.filter((edge) => !coveredTxHashes.has(edge.txHash)),
      ...boundaryProfilesToOperationalEdges({
        subjectAddress: args.source,
        profiles: boundaryProfiles
      })
    ]);
    const profile = buildOperationalFlowProfile({
      subjectAddress: args.source,
      windowStart: args.windowStart,
      windowEnd: args.windowEnd,
      edges: operationalEdges,
      classifications: classificationCache
    });

    printOperationalProfile(profile);
    printBoundaryPaths(args.source, boundaryProfiles);
    const stoppedReasons = [...new Set(boundaryProfiles.flatMap((item) => item.coverage?.stoppedReasons ?? []))];
    if (stoppedReasons.length > 0) {
      console.log("");
      console.log("Coverage and limits:");
      for (const reason of stoppedReasons) console.log(`- ${reason}`);
    }
  }
} finally {
  await closeDb(db);
}
