import { describe, expect, it } from "vitest";

import { fingerprintCanonicalArtifact } from "../../src/forensics/canonicalJson.js";
import { canonicalTronUsdtEventKey } from "../../src/forensics/tronAddressAllTimeIndex.js";
import {
  maybeBuildServiceRoleShadowArtifactV1,
  type ServiceRoleShadowEventRoleMapV1
} from "../../src/unifiedCheck/serviceRoleShadow.js";
import type { IndexedTronUsdtTransfer } from "../../src/types.js";
import type { TraversalStateV1 } from "../../src/unifiedCheck/traversal.js";

const HASH = "a".repeat(64);
const profiledAddress = "TProfiled";
const subjectAddress = "TSubject";

function event(index: number, timestamp: number): IndexedTronUsdtTransfer {
  return {
    txHash: `tx-${index}`,
    blockNumber: 10_000 - index,
    blockTimestamp: new Date(timestamp * 1_000),
    eventIndex: 0,
    fromAddress: `TSender-${index}`,
    toAddress: profiledAddress,
    amountRaw: "1000000",
    method: "transfer",
    eventType: "Transfer",
    callerAddress: null,
    contractRet: "SUCCESS",
    finalResult: "SUCCESS",
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
  const state: TraversalStateV1 = {
    address: profiledAddress,
    direction: "backward",
    anchorTimestamp: recent[0]!.blockTimestamp.toISOString(),
    fundingEpisodeId: "episode-1",
    allocatedAmountRaw: "1",
    sourceEventIds: [canonicalTronUsdtEventKey(recent[0]!)]
  };
  const map: ServiceRoleShadowEventRoleMapV1 = {
    schemaVersion: "service-role-shadow-event-role-map-v1",
    runId: "run-1",
    snapshotHash: HASH,
    addressHistoryManifestSha256: "b".repeat(64),
    entries: events.map((item) => ({
      canonicalEventId: canonicalTronUsdtEventKey(item),
      role: "ordinary",
      authority: "existing_hash_bound_economic_role_v1",
      evidenceSha256: "c".repeat(64)
    }))
  };
  return {
    state,
    events,
    map,
    input: (overrides: Record<string, unknown> = {}) => ({
      mode: "service-role-shadow-100-plus-100-v1" as const,
      runId: "run-1",
      snapshotHash: HASH,
      subjectAddress,
      state,
      acceptedHistory: {
        manifestKey: "manifest-1",
        manifestSha256: "b".repeat(64),
        pageArtifactHashes: ["d".repeat(64)],
        events
      },
      eventRoleMap: { sha256: fingerprintCanonicalArtifact(map), artifact: map },
      ...overrides
    })
  };
}

describe("service role shadow accepted-history reconstruction", () => {
  it("does nothing when disabled", () => {
    const { input } = fixture();
    expect(maybeBuildServiceRoleShadowArtifactV1({ ...input(), mode: "disabled" })).toBeNull();
  });

  it("reconstructs two exact hundred-event windows from hash-bound roles", () => {
    const { input } = fixture();
    const output = maybeBuildServiceRoleShadowArtifactV1(input());

    expect(output?.artifact.result).toMatchObject({
      status: "high_inferred_service",
      insufficientReason: null
    });
    expect(output?.artifact.sampledCanonicalEventIds.recent).toHaveLength(100);
    expect(output?.artifact.sampledCanonicalEventIds.historical).toHaveLength(100);
    expect(output?.artifact.source).toMatchObject({
      boundaryPageAuthority: false,
      physicalPageRequestHashes: []
    });
    expect(output?.sha256).toBe(fingerprintCanonicalArtifact(output?.artifact));
  });

  it("can record a non-service profile without production meaning", () => {
    const { input, events } = fixture();
    const output = maybeBuildServiceRoleShadowArtifactV1(input({
      acceptedHistory: {
        ...input().acceptedHistory,
        events: events.map((item, index) => index % 2 === 0
          ? { ...item, amountRaw: String(index + 1) }
          : { ...item, amountRaw: String(index + 1), fromAddress: profiledAddress, toAddress: `TRecipient-${index}` }
        )
      }
    }));

    expect(output?.artifact.result.status).toBe("non_service_profile");
    expect(output?.artifact.productionEffect).toBe(false);
  });

  it("does not top up an incomplete recent or historical window", () => {
    const { input, events } = fixture();
    for (const trimmed of [events.slice(0, 99), events.slice(0, 199)]) {
      const output = maybeBuildServiceRoleShadowArtifactV1(input({
        acceptedHistory: { ...input().acceptedHistory, events: trimmed }
      }));
      expect(output?.artifact.result).toMatchObject({ status: "insufficient_data" });
    }
  });

  it("refuses checked subjects, unproven anchors, same-block order, and source collisions", () => {
    const { input, state, events } = fixture();
    const cases = [
      input({ state: { ...state, address: subjectAddress } }),
      input({ state: { ...state, sourceEventIds: ["missing"] } }),
      input({ acceptedHistory: { ...input().acceptedHistory, events: events.map((item, index) => ({ ...item, blockNumber: index < 2 ? 1 : item.blockNumber })) } }),
      input({ acceptedHistory: { ...input().acceptedHistory, events: [...events, { ...events[0]!, amountRaw: "2" }] } })
    ];

    for (const value of cases) {
      expect(maybeBuildServiceRoleShadowArtifactV1(value)?.artifact.result.status).toBe("insufficient_data");
    }
  });

  it("refuses missing, tampered, wrongly bound, missing, duplicate, and conflicting roles", () => {
    const { input, map, events } = fixture();
    const variants = [
      input({ eventRoleMap: null }),
      input({ eventRoleMap: { sha256: HASH, artifact: map } }),
      input({ eventRoleMap: { sha256: fingerprintCanonicalArtifact({ ...map, runId: "other" }), artifact: { ...map, runId: "other" } } }),
      input({ eventRoleMap: { sha256: fingerprintCanonicalArtifact({ ...map, entries: map.entries.slice(1) }), artifact: { ...map, entries: map.entries.slice(1) } } }),
      input({ eventRoleMap: { sha256: fingerprintCanonicalArtifact({ ...map, entries: [...map.entries, map.entries[0]!] }), artifact: { ...map, entries: [...map.entries, map.entries[0]!] } } }),
      input({ eventRoleMap: { sha256: fingerprintCanonicalArtifact({ ...map, entries: [...map.entries, { ...map.entries[0]!, role: "provider_risk" as const }] }), artifact: { ...map, entries: [...map.entries, { ...map.entries[0]!, role: "provider_risk" as const }] } } })
    ];

    for (const value of variants) {
      expect(maybeBuildServiceRoleShadowArtifactV1(value)?.artifact.result.status).toBe("insufficient_data");
    }
    expect(canonicalTronUsdtEventKey(events[0]!)).toBe(map.entries[0]!.canonicalEventId);
  });
});
