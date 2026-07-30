import { describe, expect, it } from "vitest";

import { fingerprintCanonicalArtifact } from "../../src/forensics/canonicalJson.js";
import { canonicalTronUsdtEventKey } from "../../src/forensics/tronAddressAllTimeIndex.js";
import { buildServiceRoleExactEvidenceCaptureManifestV1 } from "../../src/unifiedCheck/serviceRoleExactEvidenceCapture.js";
import type { IndexedTronUsdtTransfer } from "../../src/types.js";
import { traversalStateId, type TraversalStateV1 } from "../../src/unifiedCheck/traversal.js";

const HASH = "a".repeat(64);
const PAGE_A = "b".repeat(64);
const PAGE_B = "c".repeat(64);
const SUBJECT = "TJRabPrwbZy45sbavfcjinPJC18kjpRTv8";
const PROFILED = "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj";

function event(index: number, timestamp: number): IndexedTronUsdtTransfer {
  return {
    transferId: `transfer-${index}`,
    txHash: `ABC${index.toString(16).padStart(61, "0")}`,
    blockNumber: 20_000 - index,
    blockTimestamp: new Date(timestamp * 1_000),
    eventIndex: 0,
    provider: "tronscan",
    providerRowOrdinalInTx: index,
    fromAddress: `TX${index.toString().padStart(32, "1")}`,
    toAddress: PROFILED,
    amountRaw: "1000000",
    method: "transfer",
    eventType: "Transfer",
    callerAddress: null,
    contractRet: "SUCCESS",
    finalResult: "SUCCESS",
    reverted: false,
    riskTransaction: false,
    confirmed: true
  };
}

function fixture() {
  const recentStart = 1_720_000_000;
  const recent = Array.from({ length: 100 }, (_, index) => event(index, recentStart - index));
  const historical = Array.from({ length: 100 }, (_, index) =>
    event(index + 100, recentStart - 8 * 24 * 60 * 60 - index)
  );
  const events = [...recent, ...historical];
  const state = (suffix: string): TraversalStateV1 => ({
    address: PROFILED,
    direction: "backward",
    anchorTimestamp: recent[0]!.blockTimestamp.toISOString(),
    fundingEpisodeId: `episode-${suffix}`,
    allocatedAmountRaw: "1",
    sourceEventIds: ["source-z", canonicalTronUsdtEventKey(recent[0]!)]
  });
  const anchor = { timestamp: recent[0]!.blockTimestamp.toISOString(), sourceEventIds: ["source-z", canonicalTronUsdtEventKey(recent[0]!)] };
  const acceptedHistory = {
    manifestKey: "manifest-1",
    manifestSha256: HASH,
    pageArtifactHashes: [PAGE_B, PAGE_A],
    events
  };
  return {
    events,
    states: ["g", "f", "e", "d", "c", "b", "a"].map(state),
    input: (overrides: Record<string, unknown> = {}) => ({
      runId: "run-1",
      snapshotHash: HASH,
      subjectAddress: SUBJECT,
      states: ["g", "f", "e", "d", "c", "b", "a"].map(state),
      anchor,
      acceptedHistory,
      ...overrides
    })
  };
}

describe("service role exact evidence capture", () => {
  it("captures exact hundred-event windows using a lexical primary equivalent state", () => {
    const { input, states } = fixture();
    const output = buildServiceRoleExactEvidenceCaptureManifestV1(input());

    expect(output.artifact).toMatchObject({
      schemaVersion: "service-role-exact-evidence-capture-manifest-v1",
      policyVersion: "existing-hash-bound-economic-role-v1",
      profiledAddress: PROFILED,
      acceptedHistory: { pageArtifactHashes: [PAGE_A, PAGE_B] },
      provider: { chain: "tron", provider: "tronscan", endpoint: "transaction-info", schemaVersion: "schema1" }
    });
    expect(output.artifact.traversal.primaryStateId).toBe([...states]
      .map(traversalStateId).sort()[0]);
    expect(output.artifact.traversal.equivalentStateIds).toHaveLength(7);
    expect(output.artifact.traversal.equivalentStateIds).toEqual([...output.artifact.traversal.equivalentStateIds].sort());
    expect(output.artifact.traversal.sourceEventIds).toEqual([...output.artifact.traversal.sourceEventIds].sort());
    expect(output.artifact.recentCanonicalEventIds).toHaveLength(100);
    expect(output.artifact.historicalCanonicalEventIds).toHaveLength(100);
    expect(output.artifact.events).toHaveLength(200);
    expect(output.artifact.events.every((item) => item.txHash === item.txHash.toLowerCase())).toBe(true);
    expect(output.sha256).toBe(fingerprintCanonicalArtifact(output.artifact));
  });

  it("is deterministic across state, page, and event input order", () => {
    const { input, states, events } = fixture();
    const left = buildServiceRoleExactEvidenceCaptureManifestV1(input());
    const right = buildServiceRoleExactEvidenceCaptureManifestV1(input({
      states: [...states].reverse(),
      acceptedHistory: { ...input().acceptedHistory, pageArtifactHashes: [...input().acceptedHistory.pageArtifactHashes].reverse(), events: [...events].reverse() }
    }));
    expect(right).toEqual(left);
  });

  it.each([
    ["duplicate sampled ids", (input: ReturnType<ReturnType<typeof fixture>["input"]>) => ({
      ...input,
      acceptedHistory: { ...input.acceptedHistory, events: [...input.acceptedHistory.events, { ...input.acceptedHistory.events[0]! }] }
    })],
    ["sample mismatch", (input: ReturnType<ReturnType<typeof fixture>["input"]>) => ({
      ...input,
      states: [{ ...input.states[0]!, anchorTimestamp: new Date(Date.parse(input.anchor.timestamp) - 1_000).toISOString() }, ...input.states.slice(1)]
    })],
    ["wrong anchor", (input: ReturnType<ReturnType<typeof fixture>["input"]>) => ({ ...input, anchor: { ...input.anchor, timestamp: "2024-01-01T00:00:00.000Z" } })],
    ["self direction", (input: ReturnType<ReturnType<typeof fixture>["input"]>) => ({
      ...input, acceptedHistory: { ...input.acceptedHistory, events: input.acceptedHistory.events.map((item, index) => index === 0 ? { ...item, fromAddress: PROFILED } : item) }
    })],
    ["unrelated direction", (input: ReturnType<ReturnType<typeof fixture>["input"]>) => ({
      ...input, acceptedHistory: { ...input.acceptedHistory, events: input.acceptedHistory.events.map((item, index) => index === 0 ? { ...item, toAddress: SUBJECT } : item) }
    })],
    ["tampered canonical body", (input: ReturnType<ReturnType<typeof fixture>["input"]>) => ({
      ...input, acceptedHistory: { ...input.acceptedHistory, events: [...input.acceptedHistory.events, { ...input.acceptedHistory.events[0]!, amountRaw: "2" }] }
    })]
  ])("rejects %s", (_name, change) => {
    expect(() => buildServiceRoleExactEvidenceCaptureManifestV1(change(fixture().input()))).toThrow();
  });
});
