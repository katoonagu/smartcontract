import { describe, expect, it } from "vitest";
import {
  ADDRESS_POISONING_POLICY_VERSION,
  compareMatches,
  compareTronAddresses,
  detectAddressPoisoning,
  initialAddressPoisoningCheckStatus,
  rankAddressPoisoningMatches,
  type AddressPoisoningDetectionInput,
  type AddressPoisoningMatch,
  type AddressPoisoningTransfer
} from "../../src/monitor/addressPoisoning";
import {
  OFFICIAL_TRON_USDT_CONTRACT,
  THJ_POISONING_CASE,
  THJ_POST_LOSS_FACTS
} from "../fixtures/monitor/addressPoisoningCases";

const HOUR_MS = 60 * 60 * 1_000;

function incoming(overrides: Partial<AddressPoisoningTransfer> = {}): AddressPoisoningTransfer {
  return {
    txHash: THJ_POISONING_CASE.incomingTxHash,
    sender: THJ_POISONING_CASE.lookalike,
    receiver: THJ_POISONING_CASE.watchedWallet,
    amountRaw: THJ_POISONING_CASE.amountRaw,
    tokenContract: THJ_POISONING_CASE.tokenContract,
    tokenDecimals: THJ_POISONING_CASE.tokenDecimals,
    occurredAt: THJ_POISONING_CASE.incomingAt,
    ...overrides
  };
}

function outgoing(overrides: Partial<AddressPoisoningTransfer> = {}): AddressPoisoningTransfer {
  return {
    txHash: THJ_POISONING_CASE.outgoingTxHash,
    sender: THJ_POISONING_CASE.watchedWallet,
    receiver: THJ_POISONING_CASE.realRecipient,
    amountRaw: THJ_POISONING_CASE.amountRaw,
    tokenContract: THJ_POISONING_CASE.tokenContract,
    tokenDecimals: THJ_POISONING_CASE.tokenDecimals,
    occurredAt: THJ_POISONING_CASE.outgoingAt,
    ...overrides
  };
}

function detectionInput(overrides: Partial<AddressPoisoningDetectionInput> = {}): AddressPoisoningDetectionInput {
  return {
    incoming: incoming(),
    checkedTransfers: [outgoing()],
    coverage: "partial",
    suppression: null,
    ...overrides
  };
}

function addressWithSuffix(real: string, suffixLength: number, fill = "A"): string {
  return `T${fill.repeat(33 - suffixLength)}${real.slice(-suffixLength)}`;
}

function priorRelationship(overrides: Partial<AddressPoisoningTransfer> = {}): AddressPoisoningTransfer {
  return outgoing({
    txHash: "prior-direct-relation",
    receiver: THJ_POISONING_CASE.lookalike,
    amountRaw: "1",
    occurredAt: new Date(THJ_POISONING_CASE.incomingAt.getTime() - 1_000),
    ...overrides
  });
}

describe("compareTronAddresses", () => {
  it("does not count the universal leading T as a meaningful prefix", () => {
    expect(compareTronAddresses(THJ_POISONING_CASE.realRecipient, THJ_POISONING_CASE.lookalike)).toEqual({
      rawPrefixLength: 1,
      meaningfulPrefixLength: 0,
      suffixLength: 6,
      combinedPrefixSuffixMatch: false,
      strength: "strong"
    });
  });

  it("classifies six meaningful prefix characters as strong without suffix help", () => {
    const real = THJ_POISONING_CASE.realRecipient;
    const candidate = `T${real.slice(1, 7)}${"A".repeat(27)}`;

    expect(compareTronAddresses(real, candidate)).toEqual({
      rawPrefixLength: 7,
      meaningfulPrefixLength: 6,
      suffixLength: 0,
      combinedPrefixSuffixMatch: false,
      strength: "strong"
    });
  });

  it("classifies exactly five meaningful prefix characters as moderate without suffix help", () => {
    const real = THJ_POISONING_CASE.realRecipient;
    const candidate = `T${real.slice(1, 6)}${"A".repeat(28)}`;

    expect(compareTronAddresses(real, candidate)).toEqual({
      rawPrefixLength: 6,
      meaningfulPrefixLength: 5,
      suffixLength: 0,
      combinedPrefixSuffixMatch: false,
      strength: "moderate"
    });
  });

  it("never treats an identical address as a visual match", () => {
    expect(compareTronAddresses(THJ_POISONING_CASE.realRecipient, THJ_POISONING_CASE.realRecipient)).toEqual({
      rawPrefixLength: 34,
      meaningfulPrefixLength: 33,
      suffixLength: 34,
      combinedPrefixSuffixMatch: false,
      strength: "none"
    });
  });

  it("rejects strings that are not fixed valid TRON base58 addresses", () => {
    expect(compareTronAddresses("T0-not-base58", THJ_POISONING_CASE.lookalike)).toEqual({
      rawPrefixLength: 0,
      meaningfulPrefixLength: 0,
      suffixLength: 0,
      combinedPrefixSuffixMatch: false,
      strength: "none"
    });
  });

  it("recognizes the combined meaningful-prefix and suffix strong rule", () => {
    const real = "THDppXpzBV14Wp9o47zkDRjpLvZSCd58Fg";
    const candidate = `T${real.slice(1, 4)}${"A".repeat(26)}${real.slice(-4)}`;

    expect(compareTronAddresses(real, candidate)).toMatchObject({
      rawPrefixLength: 4,
      meaningfulPrefixLength: 3,
      suffixLength: 4,
      combinedPrefixSuffixMatch: true,
      strength: "strong"
    });
  });
});

describe("detectAddressPoisoning", () => {
  it("exports the versioned deterministic policy", () => {
    expect(ADDRESS_POISONING_POLICY_VERSION).toBe("address-poisoning-v1");
  });

  it("detects the verified THJ six-character exact-amount lure as CRITICAL under partial coverage", () => {
    const result = detectAddressPoisoning(detectionInput());

    expect(result).toMatchObject({
      kind: "candidate",
      primary: {
        classification: "CRITICAL",
        meaningfulPrefixLength: 0,
        suffixLength: 6,
        exactAmount: true,
        elapsedMs: 45_000,
        outgoingTxHash: THJ_POISONING_CASE.outgoingTxHash
      },
      secondary: []
    });
    expect(JSON.stringify(result)).not.toContain(THJ_POST_LOSS_FACTS.lossTxHash);
    expect(JSON.stringify(result)).not.toContain(THJ_POST_LOSS_FACTS.psmTxHash);
  });

  it.each([
    ["unparseable raw amount", { amountRaw: "not-an-integer" }],
    ["zero raw amount", { amountRaw: "0" }],
    ["invalid event date", { occurredAt: new Date(Number.NaN) }],
    ["invalid sender address", { sender: "not-a-tron-address" }],
    ["invalid receiver address", { receiver: "not-a-tron-address" }],
    ["self transfer", { sender: THJ_POISONING_CASE.watchedWallet }],
    ["invalid token contract", { tokenContract: "not-a-tron-contract" }],
    ["negative token decimals", { tokenDecimals: -1 }],
    ["fractional token decimals", { tokenDecimals: 1.5 }],
    ["empty transaction hash", { txHash: "" }]
  ] satisfies Array<[string, Partial<AddressPoisoningTransfer>]>) (
    "returns invalid_input instead of clear for complete coverage with %s",
    (_name, incomingOverride) => {
      expect(detectAddressPoisoning(detectionInput({
        incoming: incoming(incomingOverride),
        checkedTransfers: [],
        coverage: "complete"
      }))).toEqual({ kind: "inconclusive", reason: "invalid_input" });
    }
  );

  it("classifies a five-character suffix match as HIGH", () => {
    const fiveCharacterLookalike = addressWithSuffix(THJ_POISONING_CASE.realRecipient, 5);
    const result = detectAddressPoisoning(detectionInput({ incoming: incoming({ sender: fiveCharacterLookalike }) }));

    expect(result).toMatchObject({
      kind: "candidate",
      primary: { classification: "HIGH", suffixLength: 5, exactAmount: true }
    });
  });

  it("ignores otherwise matching outgoing transfers more than 24 hours earlier", () => {
    const result = detectAddressPoisoning(detectionInput({
      checkedTransfers: [outgoing({ occurredAt: new Date(THJ_POISONING_CASE.incomingAt.getTime() - 24 * HOUR_MS - 1) })],
      coverage: "complete"
    }));

    expect(result).toEqual({ kind: "clear", reason: "complete_no_match" });
  });

  it.each([
    ["zero elapsed time", 0],
    ["exactly 24 hours", 24 * HOUR_MS]
  ])("includes the %s boundary in CRITICAL eligibility", (_name, elapsedMs) => {
    const result = detectAddressPoisoning(detectionInput({
      checkedTransfers: [outgoing({
        occurredAt: new Date(THJ_POISONING_CASE.incomingAt.getTime() - elapsedMs)
      })]
    }));

    expect(result).toMatchObject({
      kind: "candidate",
      primary: { classification: "CRITICAL", elapsedMs }
    });
  });

  it.each([
    ["token contract", { tokenContract: "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj" }],
    ["token decimals", { tokenDecimals: 18 }]
  ])("does not compare transfers with a different %s", (_name, transferOverride) => {
    const result = detectAddressPoisoning(detectionInput({
      checkedTransfers: [outgoing(transferOverride)],
      coverage: "complete"
    }));

    expect(result).toEqual({ kind: "clear", reason: "complete_no_match" });
  });

  it("ignores future transfers", () => {
    const result = detectAddressPoisoning(detectionInput({
      checkedTransfers: [outgoing({ occurredAt: new Date(THJ_POISONING_CASE.incomingAt.getTime() + 1) })],
      coverage: "complete"
    }));

    expect(result).toEqual({ kind: "clear", reason: "complete_no_match" });
  });

  it("clears a sender when the wallet sent to it exactly 24 hours earlier in the same token", () => {
    expect(detectAddressPoisoning(detectionInput({
      checkedTransfers: [outgoing(), priorRelationship({
        occurredAt: new Date(THJ_POISONING_CASE.incomingAt.getTime() - 24 * HOUR_MS)
      })]
    }))).toEqual({ kind: "clear", reason: "prior_relationship" });
  });

  it("does not suppress from a relationship older than 24 hours by one millisecond", () => {
    expect(detectAddressPoisoning(detectionInput({
      checkedTransfers: [outgoing(), priorRelationship({
        occurredAt: new Date(THJ_POISONING_CASE.incomingAt.getTime() - 24 * HOUR_MS - 1)
      })]
    })).kind).toBe("candidate");
  });

  it.each([
    ["token contract", { tokenContract: "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj" }],
    ["token decimals", { tokenDecimals: 18 }]
  ] satisfies Array<[string, Partial<AddressPoisoningTransfer>]>) (
    "does not suppress from a prior relationship with mismatched %s",
    (_name, relationshipOverride) => {
      expect(detectAddressPoisoning(detectionInput({
        checkedTransfers: [outgoing(), priorRelationship(relationshipOverride)]
      })).kind).toBe("candidate");
    }
  );

  it.each([
    ["equal-time", 0],
    ["future", -1]
  ] as const)("does not suppress from an %s relationship", (_name, elapsedMs) => {
    expect(detectAddressPoisoning(detectionInput({
      checkedTransfers: [outgoing(), priorRelationship({
        occurredAt: new Date(THJ_POISONING_CASE.incomingAt.getTime() - elapsedMs)
      })]
    })).kind).toBe("candidate");
  });

  it("does not suppress from an invalid prior relationship transfer", () => {
    expect(detectAddressPoisoning(detectionInput({
      checkedTransfers: [outgoing(), priorRelationship({ txHash: "" })]
    })).kind).toBe("candidate");
  });

  it("does not treat an earlier incoming transfer from the sender as a prior outgoing relationship", () => {
    expect(detectAddressPoisoning(detectionInput({
      checkedTransfers: [outgoing(), priorRelationship({
        sender: THJ_POISONING_CASE.lookalike,
        receiver: THJ_POISONING_CASE.watchedWallet
      })]
    })).kind).toBe("candidate");
  });

  it("returns clear for a complete negative lookup", () => {
    expect(detectAddressPoisoning(detectionInput({
      checkedTransfers: [],
      coverage: "complete"
    }))).toEqual({ kind: "clear", reason: "complete_no_match" });
  });

  it("keeps a negative partial lookup inconclusive", () => {
    expect(detectAddressPoisoning(detectionInput({
      checkedTransfers: [],
      coverage: "partial"
    }))).toEqual({ kind: "inconclusive", reason: "partial_no_match" });
  });

  it.each(["trusted_sender", "authoritative_service"] as const)("honors typed %s suppression", (kind) => {
    expect(detectAddressPoisoning(detectionInput({
      suppression: { kind, address: THJ_POISONING_CASE.lookalike }
    }))).toEqual({ kind: "clear", reason: kind });
  });

  it("does not suppress from free text or provider labels", () => {
    for (const suppression of [
      { kind: "free_text", label: "trusted sender" },
      { kind: "provider_label", label: "Binance" }
    ]) {
      const result = detectAddressPoisoning(detectionInput({
        suppression: suppression as never
      }));
      expect(result.kind).toBe("candidate");
    }
  });

  it("does not let missing account-creation metadata affect a positive match", () => {
    expect(detectAddressPoisoning({
      ...detectionInput(),
      senderAccount: { createdAt: null }
    }).kind).toBe("candidate");
  });

  it("does not collapse distinct raw BigInt amounts that Number cannot distinguish", () => {
    const incomingAmount = 9_007_199_254_740_992n;
    const outgoingAmount = 9_007_199_254_740_993n;
    expect(Number(incomingAmount)).toBe(Number(outgoingAmount));

    const result = detectAddressPoisoning(detectionInput({
      incoming: incoming({ amountRaw: incomingAmount }),
      checkedTransfers: [outgoing({ amountRaw: outgoingAmount })]
    }));

    expect(result).toMatchObject({
      kind: "candidate",
      primary: { classification: "HIGH", exactAmount: false }
    });
  });

  it("selects a stable primary and secondary order across multiple matches", () => {
    const sender = "TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const incomingAt = new Date("2026-07-01T12:47:42.000Z");
    const match = (fill: string, suffixLength: number, secondsEarlier: number, amountRaw: string, txHash: string) => outgoing({
      txHash,
      receiver: addressWithSuffix(sender, suffixLength, fill),
      amountRaw,
      occurredAt: new Date(incomingAt.getTime() - secondsEarlier * 1_000)
    });
    const transfers = [
      match("B", 6, 60, THJ_POISONING_CASE.amountRaw, "critical-older"),
      match("C", 8, 10, "999", "high-more-characters"),
      match("D", 6, 30, THJ_POISONING_CASE.amountRaw, "critical-primary")
    ];
    const input = detectionInput({ incoming: incoming({ sender, occurredAt: incomingAt }), checkedTransfers: transfers });
    const forward = detectAddressPoisoning(input);
    const reverse = detectAddressPoisoning({ ...input, checkedTransfers: [...transfers].reverse() });

    expect(forward).toMatchObject({
      kind: "candidate",
      primary: { outgoingTxHash: "critical-primary" },
      secondary: [
        { outgoingTxHash: "critical-older" },
        { outgoingTxHash: "high-more-characters" }
      ]
    });
    expect(reverse).toEqual(forward);
  });
});

describe("match ranking", () => {
  const base: AddressPoisoningMatch = {
    classification: "HIGH",
    genuineRecipient: THJ_POISONING_CASE.realRecipient,
    outgoingTxHash: "same-hash",
    outgoingAt: THJ_POISONING_CASE.outgoingAt,
    outgoingAmountRaw: "1",
    rawPrefixLength: 1,
    meaningfulPrefixLength: 0,
    suffixLength: 5,
    combinedPrefixSuffixMatch: false,
    exactAmount: false,
    elapsedMs: 45_000
  };

  it("prefers more total matched characters when classification ties", () => {
    const fewerCharacters = { ...base, meaningfulPrefixLength: 1 };
    const moreCharacters = { ...base, meaningfulPrefixLength: 2 };

    expect(rankAddressPoisoningMatches([fewerCharacters, moreCharacters])[0])
      .toBe(moreCharacters);
  });

  it("prefers exact amount after classification and total matched characters tie", () => {
    const inexactAmount = { ...base, exactAmount: false };
    const exactAmount = { ...base, exactAmount: true };

    expect(rankAddressPoisoningMatches([inexactAmount, exactAmount])[0])
      .toBe(exactAmount);
  });

  it("prefers smaller elapsed time after preceding rank fields tie", () => {
    const longerElapsed = { ...base, elapsedMs: 60_000 };
    const shorterElapsed = { ...base, elapsedMs: 30_000 };

    expect(rankAddressPoisoningMatches([longerElapsed, shorterElapsed])[0])
      .toBe(shorterElapsed);
  });

  it("prefers newer outgoing time after preceding rank fields tie", () => {
    const olderOutgoing = { ...base, outgoingAt: new Date("2026-07-01T12:00:00.000Z") };
    const newerOutgoing = { ...base, outgoingAt: new Date("2026-07-01T12:01:00.000Z") };

    expect(rankAddressPoisoningMatches([olderOutgoing, newerOutgoing])[0])
      .toBe(newerOutgoing);
  });

  it("uses the documented final lexical transaction-hash tie breaker without mutating input", () => {
    const input = [{ ...base, outgoingTxHash: "b-hash" }, { ...base, outgoingTxHash: "a-hash" }];

    expect(compareMatches(input[0], input[1])).toBeGreaterThan(0);
    expect(rankAddressPoisoningMatches(input).map((match) => match.outgoingTxHash)).toEqual(["a-hash", "b-hash"]);
    expect(input.map((match) => match.outgoingTxHash)).toEqual(["b-hash", "a-hash"]);
  });

  it("uses genuine recipient as a deterministic raw-code-unit tie breaker for duplicate hashes", () => {
    const lexicalFirst = { ...base, genuineRecipient: THJ_POISONING_CASE.lookalike };
    const lexicalSecond = { ...base, genuineRecipient: THJ_POISONING_CASE.realRecipient };
    const forward = rankAddressPoisoningMatches([lexicalSecond, lexicalFirst]);
    const reverse = rankAddressPoisoningMatches([lexicalFirst, lexicalSecond]);

    expect(forward[0].genuineRecipient).toBe(THJ_POISONING_CASE.lookalike);
    expect(reverse[0].genuineRecipient).toBe(THJ_POISONING_CASE.lookalike);
  });
});

describe("initialAddressPoisoningCheckStatus", () => {
  const now = new Date("2026-07-01T13:00:00.000Z");
  const base = {
    amountRaw: "10000000",
    sender: THJ_POISONING_CASE.lookalike,
    receiver: THJ_POISONING_CASE.watchedWallet,
    eventAt: new Date(now.getTime() - 1_000),
    now,
    realtimeMaxAgeMs: HOUR_MS,
    maxAmountRaw: "100000000",
    alertMode: "realtime" as const
  };

  it("marks an eligible realtime event pending", () => {
    expect(initialAddressPoisoningCheckStatus(base)).toEqual({ status: "pending", reason: null });
  });

  it("classifies an older event as backfill before other eligibility gates", () => {
    expect(initialAddressPoisoningCheckStatus({
      ...base,
      amountRaw: "0",
      eventAt: new Date(now.getTime() - HOUR_MS - 1)
    })).toEqual({ status: "skipped_backfill", reason: "older_than_realtime_window" });
  });

  it.each([
    ["paused", { alertMode: "paused" as const }, "paused"],
    ["self transfer", { sender: THJ_POISONING_CASE.watchedWallet }, "self_transfer"],
    ["zero amount", { amountRaw: "0" }, "zero_amount"],
    ["above maximum", { amountRaw: "100000001" }, "above_max_amount"],
    ["invalid sender", { sender: "not-a-tron-address" }, "invalid_input"],
    ["invalid amount", { amountRaw: "1.5" }, "invalid_input"],
    ["future event", { eventAt: new Date(now.getTime() + 1) }, "invalid_input"]
  ])("skips %s", (_name, overrides, reason) => {
    expect(initialAddressPoisoningCheckStatus({ ...base, ...overrides })).toEqual({ status: "skipped", reason });
  });

  it.each(["risk_only", "digest"] as const)("keeps security checks pending in %s mode", (alertMode) => {
    expect(initialAddressPoisoningCheckStatus({ ...base, alertMode })).toEqual({ status: "pending", reason: null });
  });
});
