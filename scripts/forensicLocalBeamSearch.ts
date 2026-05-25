import "dotenv/config";
import { indexedTransferToRouteEdge } from "../src/forensics/localTronUsdtIndex";
import { runTemporalBeamSearch } from "../src/forensics/temporalBeamSearch";
import { classifyServiceAddress } from "../src/forensics/serviceClassifier";
import { loadConfig } from "../src/config";
import { closeDb, createDb } from "../src/storage/db";
import {
  getAddressMetadata,
  getContractIntelligenceProfile,
  listAddressLabels,
  listIndexedTronUsdtTransfersForAddress
} from "../src/storage/repositories";

function parseArgs(argv: string[]): {
  source: string;
  direction: "inbound" | "outbound";
  start: Date;
  end: Date;
  depth: number;
  beamWidth: number;
  maxAddressFetches: number;
} {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key.startsWith("--") || value === undefined || value.startsWith("--")) continue;
    values.set(key, value);
    i += 1;
  }
  const source = values.get("--source");
  if (!source) {
    throw new Error("Usage: npm run forensic:beam -- --source <TRON-address> [--direction inbound|outbound] [--start ISO] [--end ISO] [--depth 7]");
  }
  const direction = values.get("--direction") ?? "inbound";
  if (direction !== "inbound" && direction !== "outbound") {
    throw new Error("--direction must be inbound or outbound");
  }
  const end = values.get("--end") ? new Date(values.get("--end") as string) : new Date();
  const start = values.get("--start") ? new Date(values.get("--start") as string) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  const depth = Number(values.get("--depth") ?? "7");
  const beamWidth = Number(values.get("--beam") ?? "10");
  const maxAddressFetches = Number(values.get("--max-addresses") ?? "150");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    throw new Error("--start and --end must be valid dates, and start must be before end");
  }
  if (!Number.isSafeInteger(depth) || depth < 1 || depth > 7) throw new Error("--depth must be an integer between 1 and 7");
  if (!Number.isSafeInteger(beamWidth) || beamWidth < 1 || beamWidth > 50) throw new Error("--beam must be an integer between 1 and 50");
  if (!Number.isSafeInteger(maxAddressFetches) || maxAddressFetches < 1) throw new Error("--max-addresses must be a positive integer");
  return { source, direction, start, end, depth, beamWidth, maxAddressFetches };
}

function formatRawUsdt(amountRaw: string): string {
  if (!/^\d+$/.test(amountRaw)) return amountRaw;
  const raw = BigInt(amountRaw);
  const whole = raw / 1_000_000n;
  const fraction = (raw % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction} USDT` : `${whole} USDT`;
}

const args = parseArgs(process.argv.slice(2));
const config = loadConfig();
const db = createDb(config.databaseUrl);

try {
  const profile = await runTemporalBeamSearch({
    subjectAddress: args.source,
    direction: args.direction,
    windowStart: args.start,
    windowEnd: args.end,
    maxDepth: args.depth,
    beamWidth: args.beamWidth,
    maxAddressFetches: args.maxAddressFetches,
    fetchEdgesForAddress: async (address) => {
      const transfers = await listIndexedTronUsdtTransfersForAddress(db, {
        address,
        minTimestamp: args.start,
        maxTimestamp: args.end,
        limit: 200,
        direction: "both"
      });
      return transfers.map(indexedTransferToRouteEdge);
    },
    getLabelsForAddress: (address) => listAddressLabels(db, address),
    getClassificationForAddress: async (address) => {
      const metadata = await getAddressMetadata(db, address, new Date());
      const contractProfile = metadata?.isContract
        ? await getContractIntelligenceProfile(db, address, new Date())
        : null;
      return classifyServiceAddress({ address, metadata, contractProfile });
    }
  });

  console.log(`Subject: ${profile.subjectAddress}`);
  console.log(`Direction: ${profile.direction}`);
  console.log(`Score: ${profile.score}/100`);
  console.log(`Matched volume: ${formatRawUsdt(profile.matchedVolumeRaw)} (${Math.round(profile.matchedVolumeRatio * 100)}%)`);
  console.log(`Coverage: ${profile.coverage.fetchedAddressCount} addresses, max depth ${profile.coverage.maxDepthReached}`);
  if (profile.coverage.stoppedReasons.length > 0) {
    console.log("Stopped reasons:");
    for (const reason of profile.coverage.stoppedReasons) console.log(`- ${reason}`);
  }
  console.log("Top candidates:");
  for (const path of profile.paths.slice(0, args.beamWidth)) {
    console.log(`- depth ${path.depth} | ${path.evidenceStrength} | ${path.candidateScore}/100 | ${formatRawUsdt(path.amountRaw)} | ${Math.round(path.amountPreservationRatio * 100)}%`);
    console.log(`  path: ${path.pathAddresses.join(" -> ")}`);
    console.log(`  tx: ${path.txHashes.join(" -> ")}`);
    if (path.label) console.log(`  label: ${path.label} at ${path.labelAddress}`);
    if (path.boundaryCategory) console.log(`  boundary: ${path.boundaryCategory}`);
  }
} finally {
  await closeDb(db);
}
