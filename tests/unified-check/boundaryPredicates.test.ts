import { describe, expect, it } from "vitest";
import {
  evaluateBoundaryV1,
  type BoundaryPredicateInputV1
} from "../../src/unifiedCheck/boundaryPredicates";
import type { FrozenLabelRecordV1 } from "../../src/unifiedCheck/frozenLabels";

const ADDRESS = "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy";
const AT = "2026-07-23T12:00:00.000Z";
const HASH = "a".repeat(64);
const STATE = {
  address: ADDRESS,
  direction: "backward" as const,
  anchorTimestamp: AT,
  fundingEpisodeId: "episode-1",
  allocatedAmountRaw: "1000000",
  sourceEventIds: ["tx:0"]
};

function label(
  overrides: Partial<FrozenLabelRecordV1> = {}
): FrozenLabelRecordV1 {
  return {
    address: ADDRESS,
    catalogEntryId: "cex:bybit",
    identity: "Bybit",
    category: "cex",
    strength: "verified_provider",
    authority: "tronscan_verified_metadata",
    validFrom: "2025-01-01T00:00:00.000Z",
    validTo: null,
    sourcePayloadSha256: HASH,
    terminalEligible: true,
    ...overrides
  };
}

function input(
  labels: readonly FrozenLabelRecordV1[],
  overrides: Partial<BoundaryPredicateInputV1> = {}
): BoundaryPredicateInputV1 {
  return {
    state: STATE,
    labels,
    route: {
      continuationProven: false,
      pooledEndpointProven: false,
      evidenceSha256: null
    },
    economicRole: null,
    restriction: null,
    structuralProof: null,
    eventTimestamp: AT,
    ...overrides
  };
}

describe("Unified evidence-only boundary predicates V1", () => {
  it("ends at an exact custodial CEX identity valid at event time", () => {
    expect(evaluateBoundaryV1(input([label()]))).toMatchObject({
      terminal: true,
      reason: "identified_service_boundary",
      predicateVersion: "unified-boundary-predicates-v1"
    });
  });

  it("ends at proved shared bridge liquidity only when continuation is absent", () => {
    const allbridge = label({
      catalogEntryId: "bridge:allbridge",
      identity: "Allbridge",
      category: "bridge"
    });
    expect(evaluateBoundaryV1(input([allbridge], {
      route: {
        continuationProven: false,
        pooledEndpointProven: true,
        evidenceSha256: "b".repeat(64)
      }
    }))).toMatchObject({
      terminal: true,
      reason: "shared_liquidity_boundary"
    });
    expect(evaluateBoundaryV1(input([allbridge], {
      route: {
        continuationProven: true,
        pooledEndpointProven: true,
        evidenceSha256: "b".repeat(64)
      }
    }))).toMatchObject({ terminal: false });
  });

  it("requires a proved economic role for the exact USDD PSM reserve", () => {
    const psm = label({
      address: "TSUYvQ5tdd3DijCD1uGunGLpftHuSZ12sQ",
      catalogEntryId: "protocol:usdd-psm",
      identity: "USDD PSM/GemJoin",
      category: "protocol",
      strength: "exact_registry",
      authority: "internal_service_registry"
    });
    expect(evaluateBoundaryV1(input([psm], {
      state: { ...STATE, address: psm.address },
      economicRole: {
        proven: true,
        role: "psm_reserve",
        evidenceSha256: "c".repeat(64)
      }
    }))).toMatchObject({
      terminal: true,
      reason: "contract_economic_boundary"
    });
    expect(evaluateBoundaryV1(input([psm], {
      state: { ...STATE, address: psm.address }
    }))).toMatchObject({ terminal: false });
  });

  it("uses only a restriction proven valid at transfer time", () => {
    expect(evaluateBoundaryV1(input([], {
      restriction: {
        validAtEvent: true,
        evidenceSha256: "d".repeat(64)
      }
    }))).toMatchObject({
      terminal: true,
      reason: "policy_or_restriction_boundary"
    });
  });

  it.each([
    ["unknown high-volume wallet", []],
    ["collector with 500 senders", []],
    ["keyword-only Bybit", [label({
      strength: "hint",
      authority: "classifier_hint",
      terminalEligible: false
    })]],
    ["generic contract metadata", [label({
      category: "protocol",
      catalogEntryId: "protocol:usdd-psm"
    })]]
  ] as const)("continues for %s", (_name, labels) => {
    expect(evaluateBoundaryV1(input(labels))).toMatchObject({
      terminal: false
    });
  });

  it("keeps a label created after the transfer as context only", () => {
    const decision = evaluateBoundaryV1(input([label({
      validFrom: "2026-07-24T00:00:00.000Z"
    })]));
    expect(decision).toMatchObject({ terminal: false });
    if (decision.terminal) return;
    expect(decision.contextEvidence).toContainEqual(
      expect.objectContaining({ kind: "label_not_valid_at_event" })
    );
  });

  it("does not accept runtime budgets as predicate inputs", () => {
    const withCoverage: BoundaryPredicateInputV1 = {
      ...input([]),
      // @ts-expect-error evidence predicates intentionally reject coverage.
      coverage: 0.1
    };
    const withDepth: BoundaryPredicateInputV1 = {
      ...input([]),
      // @ts-expect-error evidence predicates intentionally reject graph depth.
      depth: 500
    };
    expect(evaluateBoundaryV1(withCoverage)).toMatchObject({ terminal: false });
    expect(evaluateBoundaryV1(withDepth)).toMatchObject({ terminal: false });
  });
});
