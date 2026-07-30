import { describe, expect, it } from "vitest";

import {
  computeServiceWindowVectorV2,
  type ServiceBehaviorRowV2
} from "../../src/forensics/serviceBehaviorResearch.js";

function row(index: number, overrides: Partial<ServiceBehaviorRowV2> = {}): ServiceBehaviorRowV2 {
  return {
    canonicalEventId: `event-${index}`,
    blockNumber: index,
    transactionIndex: index,
    eventIndex: 0,
    occurredAtSeconds: 1_700_000_000 + index,
    direction: "incoming",
    counterpartyAddress: `counterparty-${index}`,
    amountRaw: 1n,
    valid: true,
    featureRole: "ordinary",
    ...overrides
  };
}

describe("service behavior research role and order authority", () => {
  it("excludes provider-risk rows from behavior features", () => {
    const vector = computeServiceWindowVectorV2([
      row(1, { featureRole: "provider_risk" }),
      row(2)
    ]);

    expect(vector.featureEligibleEventCount).toBe(1);
    expect(vector.incomingCount).toBe(1);
  });

  it("accepts unique-block order when exact positions are unavailable", () => {
    const vector = computeServiceWindowVectorV2([
      row(1, { transactionIndex: null, eventIndex: null, orderAuthority: "unique_block" }),
      row(2, { transactionIndex: null, eventIndex: null, orderAuthority: "unique_block" })
    ]);

    expect(vector.orderAuthoritative).toBe(true);
  });

  it("rejects unique-block order when selected rows share a block", () => {
    const vector = computeServiceWindowVectorV2([
      row(1, { blockNumber: 7, transactionIndex: null, eventIndex: null, orderAuthority: "unique_block" }),
      row(2, { blockNumber: 7, transactionIndex: null, eventIndex: null, orderAuthority: "unique_block" })
    ]);

    expect(vector.orderAuthoritative).toBe(false);
  });
});
