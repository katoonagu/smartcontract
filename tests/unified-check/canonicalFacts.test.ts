import { describe, expect, it } from "vitest";
import {
  canonicalFactId,
  canonicalizeEvidenceFacts,
  type CanonicalFactInput
} from "../../src/unifiedCheck/canonicalFacts";

const event = (
  sourceBranch: "fast" | "where" | "deep",
  overrides: Partial<CanonicalFactInput> = {}
): CanonicalFactInput => ({
  profile: "event",
  chain: "tron",
  tokenContract: "USDT",
  txHash: "a".repeat(64),
  eventIndex: 7,
  factType: "blacklisted_at_transfer",
  subject: "subject",
  counterparty: "counterparty",
  subjectRole: "receiver",
  lane: "hard",
  strength: "exact",
  sourceBranch,
  directness: "direct",
  timing: "at_event",
  ...overrides
} as CanonicalFactInput);

describe("Unified canonical facts", () => {
  it("deduplicates one on-chain event across Fast/Where/Deep by event index", () => {
    const result = canonicalizeEvidenceFacts({
      facts: [event("fast"), event("where"), event("deep")]
    });
    expect(result.inventory.facts).toHaveLength(1);
    expect(result.inventory.facts[0]?.sourceBranches).toEqual([
      "deep",
      "fast",
      "where"
    ]);
    expect(result.conflictReceipt.superseded).toHaveLength(2);
    expect(canonicalFactId(event("fast", { eventIndex: 8 })))
      .not.toBe(canonicalFactId(event("fast")));
  });

  it("never collision-merges profiles, roles, timing or directness semantics", () => {
    const state = {
      profile: "state",
      chain: "tron",
      factType: "counterparty_later_frozen",
      subject: "subject",
      counterpartyOrObject: "counterparty",
      subjectRole: "receiver",
      effectiveAt: "2026-07-23T12:00:00.000Z",
      snapshotBlock: "84713573",
      lane: "context",
      strength: "exact",
      sourceBranch: "deep",
      directness: "direct",
      timing: "later"
    } as const;
    const path = {
      profile: "path",
      chain: "tron",
      orderedEventFactIds: [canonicalFactId(event("fast"))],
      factType: "indirect_blacklist_relation",
      subject: "subject",
      subjectRole: "receiver",
      lane: "context",
      strength: "corroborated",
      sourceBranch: "where",
      directness: "indirect",
      timing: "at_event"
    } as const;
    const ids = [
      canonicalFactId(event("fast")),
      canonicalFactId(state),
      canonicalFactId(path),
      canonicalFactId(event("fast", { subjectRole: "victim" })),
      canonicalFactId(event("fast", { subjectRole: "drainer" }))
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses typed sentinels and retains hard evidence over safe context", () => {
    const withoutOptional = event("fast", {
      tokenContract: null,
      counterparty: null
    });
    expect(canonicalFactId(withoutOptional)).toMatch(/^[0-9a-f]{64}$/u);
    const result = canonicalizeEvidenceFacts({
      facts: [
        event("deep"),
        event("fast", { lane: "context", strength: "contextual" })
      ]
    });
    expect(result.inventory.facts[0]).toMatchObject({
      lane: "hard",
      strength: "exact"
    });
    expect(result.conflictReceipt.superseded[0]?.reason)
      .toBe("stronger_projection_retained");
  });

  it("creates a composite only from correlated unknown behavior", () => {
    const unknown = {
      profile: "state",
      chain: "tron",
      subject: "subject",
      counterpartyOrObject: null,
      subjectRole: "subject",
      effectiveAt: null,
      snapshotBlock: "84713573",
      lane: "neutral",
      strength: "exact",
      sourceBranch: "where",
      directness: "direct",
      timing: "current"
    } as const;
    const alone = canonicalizeEvidenceFacts({
      facts: [{ ...unknown, factType: "unknown_source" }]
    });
    expect(alone.inventory.facts.map((fact) => fact.factType))
      .not.toContain("unknown_with_correlated_pattern");
    const correlated = canonicalizeEvidenceFacts({
      facts: [
        { ...unknown, factType: "unknown_source" },
        { ...unknown, factType: "mass_fan_in", lane: "pattern" },
        { ...unknown, factType: "rapid_forwarding", lane: "pattern" },
        { ...unknown, factType: "high_concentration", lane: "pattern" }
      ]
    });
    expect(correlated.inventory.facts.map((fact) => fact.factType))
      .toContain("unknown_with_correlated_pattern");
  });

  it("is invariant to input reorder/duplicates and suppresses incomplete negatives", () => {
    const facts = [
      event("fast"),
      event("deep"),
      event("where", {
        factType: "no_blacklist_relation",
        lane: "neutral",
        negative: true,
        scopeStatus: "INCOMPLETE"
      })
    ];
    const left = canonicalizeEvidenceFacts({ facts });
    const right = canonicalizeEvidenceFacts({
      facts: [facts[2]!, facts[1]!, facts[0]!, facts[0]!]
    });
    expect(right.inventoryHash).toBe(left.inventoryHash);
    expect(right.inventory.facts.map((fact) => fact.factType))
      .not.toContain("no_blacklist_relation");
    expect(right.conflictReceipt.superseded.map((item) => item.reason))
      .toContain("negative_scope_incomplete");
  });
});
