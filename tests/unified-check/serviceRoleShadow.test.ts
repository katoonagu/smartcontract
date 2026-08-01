import { describe, expect, it } from "vitest";

import { fingerprintCanonicalArtifact } from "../../src/forensics/canonicalJson.js";
import { canonicalTronUsdtEventKey } from "../../src/forensics/tronAddressAllTimeIndex.js";
import {
  deriveServiceRoleShadowAcceptedHistoryBindingV1,
  maybeBuildServiceRoleShadowArtifactV1,
  parseServiceRoleShadowEventRoleMapV2,
  serviceRoleShadowCompoundBindingKeyV1,
  type ServiceRoleShadowAcceptedHistoryBindingV1,
  type ServiceRoleShadowEventRoleMapV1,
  type ServiceRoleShadowEventRoleMapV2
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

function bindingFixture() {
  const { state, events } = fixture();
  const binding = deriveServiceRoleShadowAcceptedHistoryBindingV1({
    state,
    acceptedHistoryEvents: events
  });
  const artifact: ServiceRoleShadowEventRoleMapV2 = {
    schemaVersion: "service-role-shadow-event-role-map-v2",
    policyVersion: "service-role-shadow-100-plus-100-v1",
    runId: "run-1",
    snapshotHash: HASH,
    addressHistoryManifestSha256: "b".repeat(64),
    sourceEventRoleMapV1Sha256: "c".repeat(64),
    evidenceBundleSha256: "d".repeat(64),
    binding,
    exactCoverage: { recent: 100, historical: 100, total: 200 },
    productionEffect: false
  };
  return { state, events, binding, artifact };
}

function replaceSamples(
  binding: ServiceRoleShadowAcceptedHistoryBindingV1,
  recent: readonly string[],
  historical: readonly string[]
): ServiceRoleShadowAcceptedHistoryBindingV1 {
  const sampledCanonicalEventIds = { recent, historical };
  return {
    ...binding,
    sampledCanonicalEventIds,
    sampledEventIdsSha256: fingerprintCanonicalArtifact(sampledCanonicalEventIds)
  };
}

function parseV2(artifact: unknown) {
  return parseServiceRoleShadowEventRoleMapV2({
    artifact,
    expectedSha256: fingerprintCanonicalArtifact(artifact)
  });
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
    expect(output?.sha256).toBe("7f51ea7d092d8a2d73bc003975e5a0848c7ea749d9c6eab2f3ecb9d72efcd799");
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

  it("uses the stricter seven-day cutoff from the oldest recent event", () => {
    const { input, events, map } = fixture();
    const anchorSeconds = events[0]!.blockTimestamp.getTime() / 1_000;
    const betweenCutoffs = event(500, anchorSeconds - 7 * 24 * 60 * 60 - 50);
    const expandedMap = {
      ...map,
      entries: [...map.entries, {
        canonicalEventId: canonicalTronUsdtEventKey(betweenCutoffs),
        role: "ordinary" as const,
        authority: "existing_hash_bound_economic_role_v1" as const,
        evidenceSha256: "c".repeat(64)
      }]
    };
    const output = maybeBuildServiceRoleShadowArtifactV1(input({
      acceptedHistory: { ...input().acceptedHistory, events: [...events, betweenCutoffs] },
      eventRoleMap: { sha256: fingerprintCanonicalArtifact(expandedMap), artifact: expandedMap }
    }));

    expect(output?.artifact.result.status).toBe("high_inferred_service");
    expect(output?.artifact.sampledCanonicalEventIds.historical)
      .not.toContain(canonicalTronUsdtEventKey(betweenCutoffs));
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
      expect(maybeBuildServiceRoleShadowArtifactV1(value)?.artifact.result).toMatchObject({
        status: "insufficient_data"
      });
    }
    expect(canonicalTronUsdtEventKey(events[0]!)).toBe(map.entries[0]!.canonicalEventId);
  });

  it("refuses role maps bound to the wrong snapshot or accepted manifest", () => {
    const { input, map } = fixture();
    for (const artifact of [
      { ...map, snapshotHash: "e".repeat(64) },
      { ...map, addressHistoryManifestSha256: "e".repeat(64) }
    ]) {
      expect(maybeBuildServiceRoleShadowArtifactV1(input({
        eventRoleMap: { sha256: fingerprintCanonicalArtifact(artifact), artifact }
      }))?.artifact.result).toMatchObject({
        status: "insufficient_data",
        insufficientReason: "source_binding_invalid"
      });
    }
  });

  it("derives an exact anchor and stable lexically sorted sample binding without mutating input", () => {
    const { state, events } = fixture();
    const acceptedHistoryEvents = [...events].reverse();
    const inputOrder = acceptedHistoryEvents.map((item) => canonicalTronUsdtEventKey(item));
    const binding = deriveServiceRoleShadowAcceptedHistoryBindingV1({ state, acceptedHistoryEvents });
    const anchor = events[0]!;

    expect(binding).toMatchObject({
      profiledAddress,
      direction: "backward",
      anchorBinding: {
        canonicalEventId: canonicalTronUsdtEventKey(anchor),
        blockNumber: anchor.blockNumber,
        timestamp: anchor.blockTimestamp.toISOString(),
        eventIndex: anchor.eventIndex,
        orderAuthority: "unique_block"
      }
    });
    expect(binding.sampledCanonicalEventIds.recent).toEqual(
      [...binding.sampledCanonicalEventIds.recent].sort()
    );
    expect(binding.sampledCanonicalEventIds.historical).toEqual(
      [...binding.sampledCanonicalEventIds.historical].sort()
    );
    expect(binding.sampledEventIdsSha256).toBe(
      fingerprintCanonicalArtifact(binding.sampledCanonicalEventIds)
    );
    expect(binding.sampledEventIdsSha256)
      .toBe("0cd2be614f30b72d3c1920490801a5c19779c2037ad2fbea76f2d7bdd41e61d7");
    expect(deriveServiceRoleShadowAcceptedHistoryBindingV1({
      state,
      acceptedHistoryEvents: events
    })).toEqual(binding);
    expect(acceptedHistoryEvents.map((item) => canonicalTronUsdtEventKey(item))).toEqual(inputOrder);
  });

  it("fails closed on unproven or incomplete accepted-history bindings", () => {
    const { state, events } = fixture();
    const cases: Array<[string, TraversalStateV1, readonly IndexedTronUsdtTransfer[]]> = [
      ["service_role_shadow_binding_anchor_unproven", { ...state, sourceEventIds: ["missing"] }, events],
      ["service_role_shadow_binding_recent_window_incomplete", state, events.slice(0, 99)],
      ["service_role_shadow_binding_historical_window_incomplete", state, events.slice(0, 199)],
      ["service_role_shadow_binding_order_unproven", state,
        events.map((item, index) => index === 1 ? { ...item, blockNumber: events[0]!.blockNumber } : item)],
      ["service_role_shadow_binding_duplicate", state, [...events, events[0]!]],
      ["service_role_shadow_binding_collision", state, [...events, { ...events[0]!, amountRaw: "2" }]]
    ];

    for (const [message, candidateState, acceptedHistoryEvents] of cases) {
      expect(() => deriveServiceRoleShadowAcceptedHistoryBindingV1({
        state: candidateState,
        acceptedHistoryEvents
      })).toThrowError(new TypeError(message));
    }
  });

  it("preserves V1 selection for an unsafe anchor event index but rejects the new binding", () => {
    const { input, state, events, map } = fixture();
    const negativeEvents = events.map((item, index) => index === 0
      ? { ...item, eventIndex: -1 }
      : item);
    const negativeState: TraversalStateV1 = {
      ...state,
      sourceEventIds: [canonicalTronUsdtEventKey(negativeEvents[0]!)]
    };
    const negativeMap: ServiceRoleShadowEventRoleMapV1 = {
      ...map,
      entries: negativeEvents.map((item) => ({
        canonicalEventId: canonicalTronUsdtEventKey(item),
        role: "ordinary",
        authority: "existing_hash_bound_economic_role_v1",
        evidenceSha256: "c".repeat(64)
      }))
    };
    const value = input({
      state: negativeState,
      acceptedHistory: { ...input().acceptedHistory, events: negativeEvents },
      eventRoleMap: {
        sha256: fingerprintCanonicalArtifact(negativeMap),
        artifact: negativeMap
      }
    });
    const output = maybeBuildServiceRoleShadowArtifactV1(value);

    expect(output?.artifact.result).toMatchObject({
      status: "high_inferred_service",
      insufficientReason: null
    });
    expect(output?.artifact.sampledCanonicalEventIds.recent).toHaveLength(100);
    expect(output?.artifact.sampledCanonicalEventIds.historical).toHaveLength(100);
    expect(output?.sha256).toBe(fingerprintCanonicalArtifact(output?.artifact));
    expect(maybeBuildServiceRoleShadowArtifactV1(value)).toEqual(output);
    expect(() => deriveServiceRoleShadowAcceptedHistoryBindingV1({
      state: negativeState,
      acceptedHistoryEvents: negativeEvents
    })).toThrowError(new TypeError("service_role_shadow_binding_anchor_event_index_invalid"));
  });

  it("rejects malformed V2-only state and sampled event identities", () => {
    const { state, events } = fixture();
    const invalidStates: Array<[TraversalStateV1, string]> = [
      [{ ...state, address: "" }, "service_role_shadow_binding_profiled_address_invalid"],
      [{ ...state, direction: "sideways" } as unknown as TraversalStateV1,
        "service_role_shadow_binding_direction_invalid"]
    ];
    for (const [candidateState, message] of invalidStates) {
      expect(() => deriveServiceRoleShadowAcceptedHistoryBindingV1({
        state: candidateState,
        acceptedHistoryEvents: events
      })).toThrowError(new TypeError(message));
    }

    const invalidSamples: readonly (readonly IndexedTronUsdtTransfer[])[] = [
      events.map((item, index) => index === 1 ? { ...item, eventIndex: -1 } : item),
      events.map((item, index) => index === 1 ? { ...item, txHash: "" } : item),
      events.map((item, index) => index === 1
        ? { ...item, txHash: 7 as unknown as string }
        : item)
    ];
    for (const acceptedHistoryEvents of invalidSamples) {
      expect(() => deriveServiceRoleShadowAcceptedHistoryBindingV1({
        state,
        acceptedHistoryEvents
      })).toThrowError(new TypeError("service_role_shadow_binding_sample_event_invalid"));
    }
  });

  it("parses an exact V2 wrapper and rejects a V1 body", () => {
    const { artifact } = bindingFixture();
    const { map } = fixture();

    expect(fingerprintCanonicalArtifact(artifact))
      .toBe("75fb374ad55a3aecac064c0dc50b06dcff199f0b522f391d28bd4327226c66e5");
    expect(parseV2(artifact)).toEqual(artifact);
    expect(() => parseV2(map)).toThrowError(
      new TypeError("service_role_shadow_event_role_map_v2_invalid")
    );
  });

  it("returns an owned deeply frozen wrapper immune to caller mutation", () => {
    const { artifact } = bindingFixture();
    const parsed = parseV2(artifact);
    const key = serviceRoleShadowCompoundBindingKeyV1(parsed);
    const originalRecentId = parsed.binding.sampledCanonicalEventIds.recent[0]!;

    expect(parsed).not.toBe(artifact);
    expect(parsed.binding).not.toBe(artifact.binding);
    expect(parsed.binding.anchorBinding).not.toBe(artifact.binding.anchorBinding);
    expect(parsed.binding.sampledCanonicalEventIds)
      .not.toBe(artifact.binding.sampledCanonicalEventIds);
    expect(parsed.binding.sampledCanonicalEventIds.recent)
      .not.toBe(artifact.binding.sampledCanonicalEventIds.recent);
    expect(parsed.binding.sampledCanonicalEventIds.historical)
      .not.toBe(artifact.binding.sampledCanonicalEventIds.historical);
    expect(parsed.exactCoverage).not.toBe(artifact.exactCoverage);
    for (const value of [
      parsed,
      parsed.binding,
      parsed.binding.anchorBinding,
      parsed.binding.sampledCanonicalEventIds,
      parsed.binding.sampledCanonicalEventIds.recent,
      parsed.binding.sampledCanonicalEventIds.historical,
      parsed.exactCoverage
    ]) {
      expect(Object.isFrozen(value)).toBe(true);
    }

    artifact.binding.profiledAddress = "TCallerMutation";
    artifact.binding.anchorBinding.blockNumber = 1;
    (artifact.binding.sampledCanonicalEventIds.recent as string[])[0] = "caller-mutated-event";
    expect(parsed.binding.profiledAddress).toBe(profiledAddress);
    expect(parsed.binding.anchorBinding.blockNumber).toBe(10_000);
    expect(parsed.binding.sampledCanonicalEventIds.recent[0]).toBe(originalRecentId);
    expect(serviceRoleShadowCompoundBindingKeyV1(artifact)).not.toBe(key);
    expect(serviceRoleShadowCompoundBindingKeyV1(parsed)).toBe(key);
    expect(Reflect.set(parsed.binding, "profiledAddress", "TFrozenMutation")).toBe(false);
    expect(Reflect.set(parsed.binding.sampledCanonicalEventIds.recent, 0, "frozen-mutated-event"))
      .toBe(false);
    expect(parsed.binding.profiledAddress).toBe(profiledAddress);
    expect(parsed.binding.sampledCanonicalEventIds.recent[0]).toBe(originalRecentId);
  });

  it("snapshots data descriptors without observing Proxy get races", () => {
    const { artifact, binding } = bindingFixture();
    let bindingGets = 0;
    const proxy = new Proxy(artifact, {
      get(target, property, receiver) {
        if (property === "binding") {
          bindingGets += 1;
          return { ...binding, profiledAddress: `TProxyRace-${bindingGets}` };
        }
        return Reflect.get(target, property, receiver);
      }
    });
    const parsed = parseServiceRoleShadowEventRoleMapV2({
      artifact: proxy,
      expectedSha256: "75fb374ad55a3aecac064c0dc50b06dcff199f0b522f391d28bd4327226c66e5"
    });

    expect(bindingGets).toBe(0);
    expect(parsed.binding.profiledAddress).toBe(profiledAddress);
    expect(fingerprintCanonicalArtifact(parsed))
      .toBe("75fb374ad55a3aecac064c0dc50b06dcff199f0b522f391d28bd4327226c66e5");
  });

  it("rejects duplicate or overlapping V2 samples even when their hashes match", () => {
    const { artifact, binding } = bindingFixture();
    const duplicateRecent = [...binding.sampledCanonicalEventIds.recent];
    duplicateRecent[1] = duplicateRecent[0]!;
    duplicateRecent.sort();
    const overlappingHistorical = [
      ...binding.sampledCanonicalEventIds.historical.slice(1),
      binding.sampledCanonicalEventIds.recent[0]!
    ].sort();

    for (const candidateBinding of [
      replaceSamples(binding, duplicateRecent, binding.sampledCanonicalEventIds.historical),
      replaceSamples(binding, binding.sampledCanonicalEventIds.recent, overlappingHistorical)
    ]) {
      expect(() => parseV2({ ...artifact, binding: candidateBinding })).toThrowError(
        new TypeError("service_role_shadow_event_role_map_v2_invalid")
      );
    }
  });

  it("strictly rejects extra, missing, typed, ordering, coverage, and hash violations", () => {
    const { artifact, binding } = bindingFixture();
    const { evidenceBundleSha256: _missing, ...missing } = artifact;
    const reversedRecent = [...binding.sampledCanonicalEventIds.recent].reverse();
    const invalid = [
      { ...artifact, extra: true },
      missing,
      { ...artifact, binding: { ...binding, anchorBinding: { ...binding.anchorBinding, extra: true } } },
      { ...artifact, binding: { ...binding, anchorBinding: { ...binding.anchorBinding, blockNumber: "1" } } },
      { ...artifact, binding: replaceSamples(binding, reversedRecent, binding.sampledCanonicalEventIds.historical) },
      { ...artifact, exactCoverage: { recent: 100, historical: 100, total: 199 } },
      { ...artifact, snapshotHash: HASH.toUpperCase() },
      { ...artifact, binding: { ...binding, sampledEventIdsSha256: "e".repeat(64) } }
    ];

    for (const candidate of invalid) {
      expect(() => parseV2(candidate)).toThrowError(
        new TypeError("service_role_shadow_event_role_map_v2_invalid")
      );
    }
    expect(() => parseServiceRoleShadowEventRoleMapV2({
      artifact,
      expectedSha256: "f".repeat(64)
    })).toThrowError(new TypeError("service_role_shadow_event_role_map_v2_invalid"));
    expect(() => parseServiceRoleShadowEventRoleMapV2({
      artifact,
      expectedSha256: HASH.toUpperCase()
    })).toThrowError(new TypeError("service_role_shadow_event_role_map_v2_invalid"));
  });

  it("rejects non-plain, accessor, and array-property containers", () => {
    const { artifact, binding } = bindingFixture();
    const inherited = Object.assign(Object.create({ inherited: true }), artifact);
    const accessor = { ...artifact };
    Object.defineProperty(accessor, "runId", {
      enumerable: true,
      get: () => artifact.runId
    });
    const recentWithExtra = [...binding.sampledCanonicalEventIds.recent];
    Object.assign(recentWithExtra, { extra: true });
    const extraArray = {
      ...artifact,
      binding: {
        ...binding,
        sampledCanonicalEventIds: {
          ...binding.sampledCanonicalEventIds,
          recent: recentWithExtra
        }
      }
    };

    for (const candidate of [inherited, accessor, extraArray]) {
      expect(() => parseServiceRoleShadowEventRoleMapV2({
        artifact: candidate,
        expectedSha256: "75fb374ad55a3aecac064c0dc50b06dcff199f0b522f391d28bd4327226c66e5"
      })).toThrowError(new TypeError("service_role_shadow_event_role_map_v2_invalid"));
    }
  });

  it("compound keys cannot collide across anchors or sampled sets", () => {
    const { artifact, binding, state, events } = bindingFixture();
    const key = serviceRoleShadowCompoundBindingKeyV1(artifact);
    const wrongAnchor = {
      ...binding,
      anchorBinding: {
        ...binding.anchorBinding,
        canonicalEventId: binding.sampledCanonicalEventIds.recent[1]!,
        blockNumber: binding.anchorBinding.blockNumber + 1
      }
    };
    const inserted = {
      ...event(300, events[0]!.blockTimestamp.getTime() / 1_000),
      txHash: "tx-derived-alternate",
      blockNumber: events[0]!.blockNumber + 1
    };
    const changedSamples = deriveServiceRoleShadowAcceptedHistoryBindingV1({
      state,
      acceptedHistoryEvents: [...events, inserted]
    });

    expect(key).toBe("be69d620aa27c80643c7a1c477ce8487574513c6b864f86c88f79d18f29c12a5");
    expect(changedSamples.sampledCanonicalEventIds.recent)
      .toContain(canonicalTronUsdtEventKey(inserted));
    expect(changedSamples.sampledCanonicalEventIds).not.toEqual(binding.sampledCanonicalEventIds);
    expect(serviceRoleShadowCompoundBindingKeyV1({ ...artifact, binding: wrongAnchor })).not.toBe(key);
    expect(serviceRoleShadowCompoundBindingKeyV1({ ...artifact, binding: changedSamples })).not.toBe(key);
    expect(parseV2({ ...artifact, binding: changedSamples }).binding).toEqual(changedSamples);
  });
});
