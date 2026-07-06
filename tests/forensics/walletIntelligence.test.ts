import { describe, expect, it } from "vitest";
import type { ForensicCheckJob } from "../../src/storage/repositories";
import {
  WALLET_INTELLIGENCE_INDEX_VERSION,
  extractWalletIntelligenceFromJob,
  sourcePayloadHash,
  supportedWalletIntelligenceJob
} from "../../src/forensics/walletIntelligence";

function baseJob(overrides: Partial<ForensicCheckJob> = {}): ForensicCheckJob {
  return {
    id: "job-1",
    kind: "address_deep_check",
    subjectAddress: "TSubject111111111111111111111111111111",
    status: "completed",
    windowStart: new Date("2026-07-06T00:00:00.000Z"),
    windowEnd: new Date("2026-07-06T01:00:00.000Z"),
    priority: 100,
    chatId: "42",
    messageId: "77",
    requestedBy: "42",
    progressJson: {},
    resultJson: {},
    rawEvidenceIds: [],
    observationIds: [],
    lastError: null,
    createdAt: new Date("2026-07-06T00:00:00.000Z"),
    updatedAt: new Date("2026-07-06T01:00:00.000Z"),
    startedAt: new Date("2026-07-06T00:00:01.000Z"),
    completedAt: new Date("2026-07-06T01:00:00.000Z"),
    ...overrides
  };
}

describe("wallet intelligence extraction", () => {
  it("supports only completed or partial DeepCheck, Where, and Incoming jobs", () => {
    expect(supportedWalletIntelligenceJob(baseJob())).toBe(true);
    expect(supportedWalletIntelligenceJob(baseJob({ kind: "where_is_money_check" }))).toBe(true);
    expect(supportedWalletIntelligenceJob(baseJob({ kind: "incoming_deposit_check" }))).toBe(true);
    expect(supportedWalletIntelligenceJob(baseJob({ kind: "address_fast_check" }))).toBe(false);
    expect(supportedWalletIntelligenceJob(baseJob({ status: "running" }))).toBe(false);
    expect(WALLET_INTELLIGENCE_INDEX_VERSION).toBe(1);
  });

  it("hashes result payload plus relevant incoming progress fields", () => {
    const first = sourcePayloadHash(baseJob({
      kind: "incoming_deposit_check",
      resultJson: { originPaths: [] },
      progressJson: { depositTxHash: "tx-1", sender: "TSender", watchedWallet: "TWallet" }
    }));
    const second = sourcePayloadHash(baseJob({
      kind: "incoming_deposit_check",
      resultJson: { originPaths: [] },
      progressJson: { depositTxHash: "tx-2", sender: "TSender", watchedWallet: "TWallet" }
    }));

    expect(first).not.toBe(second);
  });

  it("extracts DeepCheck direct counterparties and second-layer paths", () => {
    const extracted = extractWalletIntelligenceFromJob(baseJob({
      resultJson: {
        subjectAddress: "TSubject111111111111111111111111111111",
        directCounterpartyInteractionProfiles: [{
          subjectAddress: "TSubject111111111111111111111111111111",
          direction: "inbound",
          counterpartyAddress: "TDirect1111111111111111111111111111111",
          volumeRaw: "1000000",
          txCount: 1,
          firstSeen: "2026-07-06T00:10:00.000Z",
          lastSeen: "2026-07-06T00:10:00.000Z",
          txHashes: ["tx-direct"],
          transfers: [{
            txHash: "tx-direct",
            fromAddress: "TDirect1111111111111111111111111111111",
            toAddress: "TSubject111111111111111111111111111111",
            amountRaw: "1000000",
            timestamp: "2026-07-06T00:10:00.000Z",
            method: "transfer",
            edgeType: "normal_transfer"
          }],
          serviceCategory: null,
          identity: null,
          snapshot: {},
          interactionWeight: 1,
          scoreContribution: 0,
          evidenceClass: "behavior",
          skippedReason: null
        }],
        secondLayerRelationshipProfiles: {
          paths: [{
            id: "second-path-1",
            directWalletAddress: "TDirect1111111111111111111111111111111",
            secondHopAddress: "TSecond1111111111111111111111111111111",
            pathAddresses: [
              "TSubject111111111111111111111111111111",
              "TDirect1111111111111111111111111111111",
              "TSecond1111111111111111111111111111111"
            ],
            txHashes: ["tx-second"],
            amountRaw: "2000000",
            firstSeen: "2026-07-06T00:20:00.000Z",
            lastSeen: "2026-07-06T00:20:00.000Z",
            evidence: [{
              txHash: "tx-second",
              fromAddress: "TSecond1111111111111111111111111111111",
              toAddress: "TDirect1111111111111111111111111111111",
              amountRaw: "2000000",
              timestamp: "2026-07-06T00:20:00.000Z"
            }]
          }],
          groups: []
        }
      }
    }));

    expect(extracted.run.jobKind).toBe("address_deep_check");
    expect(extracted.sightings.map((item) => item.address)).toContain("TDirect1111111111111111111111111111111");
    expect(extracted.sightings.map((item) => item.address)).toContain("TSecond1111111111111111111111111111111");
    expect(extracted.edges.map((item) => item.txHash)).toEqual(expect.arrayContaining(["tx-direct", "tx-second"]));
  });

  it("extracts Where origin steps and source provenance context", () => {
    const extracted = extractWalletIntelligenceFromJob(baseJob({
      kind: "where_is_money_check",
      resultJson: {
        originPaths: [{
          pathAddresses: ["TSource1111111111111111111111111111111", "TSubject111111111111111111111111111111"],
          txHashes: ["tx-where"],
          steps: [{
            txHash: "tx-where",
            fromAddress: "TSource1111111111111111111111111111111",
            toAddress: "TSubject111111111111111111111111111111",
            amountRaw: "3000000",
            timestamp: "2026-07-06T00:30:00.000Z",
            method: "transfer",
            edgeType: "normal_transfer"
          }],
          sourceProvenance: [{
            mode: "source_provenance",
            targetTxHash: "tx-where",
            targetFromAddress: "TSource1111111111111111111111111111111",
            targetToAddress: "TSubject111111111111111111111111111111",
            targetTimestamp: "2026-07-06T00:30:00.000Z",
            targetAmountRaw: "3000000",
            proofClass: "probable",
            coveredAmountRaw: "3000000",
            coverageRatio: 1,
            amountContinuity: "strong",
            stopReason: null,
            fundingBundle: null,
            coverageWindow: { startTimestamp: null, endTimestamp: "2026-07-06T00:30:00.000Z", complete: false, capped: true, providerInconsistent: false },
            reasons: ["capped_window"]
          }]
        }]
      }
    }));

    expect(extracted.sightings.some((item) => item.sourceKind === "where_source_provenance")).toBe(true);
    expect(extracted.edges[0]).toMatchObject({ txHash: "tx-where", edgeRole: "transfer" });
  });

  it("extracts Incoming origin paths and funding bundles", () => {
    const extracted = extractWalletIntelligenceFromJob(baseJob({
      kind: "incoming_deposit_check",
      progressJson: {
        depositTxHash: "tx-deposit",
        watchedWallet: "TWatched11111111111111111111111111111",
        sender: "TSender1111111111111111111111111111111"
      },
      resultJson: {
        originPaths: [{
          pathAddresses: ["TFunder111111111111111111111111111111", "TSender1111111111111111111111111111111"],
          txHashes: ["tx-fund"],
          steps: [{
            txHash: "tx-fund",
            fromAddress: "TFunder111111111111111111111111111111",
            toAddress: "TSender1111111111111111111111111111111",
            amountRaw: "4000000",
            timestamp: "2026-07-06T00:40:00.000Z",
            method: "transfer",
            edgeType: "normal_transfer"
          }],
          fundingBundles: [{
            targetTxHash: "tx-fund",
            fundingAddresses: ["TFunder111111111111111111111111111111"],
            fundingFunders: [{
              address: "TUpstream11111111111111111111111111111",
              amountRaw: "4000000",
              txHashes: ["tx-upstream"]
            }]
          }]
        }]
      }
    }));

    expect(extracted.sightings.map((item) => item.address)).toContain("TUpstream11111111111111111111111111111");
    expect(extracted.sightings.some((item) => item.sourceKind === "incoming_funding_bundle")).toBe(true);
  });

  it("keeps tags neutral and never emits risk terms", () => {
    const extracted = extractWalletIntelligenceFromJob(baseJob({
      resultJson: {
        directCounterpartyInteractionProfiles: [{
          counterpartyAddress: "TDirect1111111111111111111111111111111",
          serviceCategory: "cex",
          txCount: 50,
          volumeRaw: "1000000000000"
        }]
      }
    }));
    const serialized = JSON.stringify(extracted);

    expect(serialized).not.toContain("suspicious");
    expect(serialized).not.toContain("dirty");
    expect(serialized).not.toContain("risk_score");
  });
});
