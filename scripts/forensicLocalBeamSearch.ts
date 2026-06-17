import "dotenv/config";
import { parseLocalBeamSearchCliArgs } from "../src/forensics/localBeamSearchCliArgs";
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

function formatRawUsdt(amountRaw: string): string {
  if (!/^\d+$/.test(amountRaw)) return amountRaw;
  const raw = BigInt(amountRaw);
  const whole = raw / 1_000_000n;
  const fraction = (raw % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction} USDT` : `${whole} USDT`;
}

const args = parseLocalBeamSearchCliArgs(process.argv.slice(2));
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
