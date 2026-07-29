import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Case = {
  readonly id: string;
  readonly evidenceClass: string;
  readonly rawEvidenceRef?: string;
  readonly [key: string]: unknown;
};

type Corpus = {
  readonly schemaVersion: string;
  readonly ledgerCases: readonly Case[];
  readonly serviceCases: readonly Case[];
  readonly adverseCases: readonly Case[];
};

const fixtureUrl = new URL(
  "../fixtures/forensics/forensic-model-offline-corpus-v1.json",
  import.meta.url
);
const corpus = JSON.parse(readFileSync(fixtureUrl, "utf8")) as Corpus;
const cases = [
  ...corpus.ledgerCases,
  ...corpus.serviceCases,
  ...corpus.adverseCases
];

function collectAmountRawValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(collectAmountRawValues);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) =>
    /amountRaw$/iu.test(key)
      ? [child, ...collectAmountRawValues(child)]
      : collectAmountRawValues(child)
  );
}

type FeatureVector = {
  physicalRowCount: number;
  canonicalEventCount: number;
  featureEligibleEventCount: number;
  incomingCount: number;
  outgoingCount: number;
  uniqueSenders: number;
  uniqueRecipients: number;
  uniqueCounterparties: number;
  largestCounterparty: { count: number; shareDenominator: number };
  dominantDirection: "incoming" | "outgoing";
  dominantDirectionCount: number;
  uniqueDominantCounterparties: number;
  dominantShareDenominator: number;
  medianDominantDirectionGapSeconds: { numerator: number; denominator: number };
  maxDominantDirectionEventsPerHour: number;
  activeUtcHourOfDayCount: number;
  dominantExactAmount: { amountRaw: string; count: number; shareDenominator: number };
  observedStartTimestamp: string;
  observedEndTimestamp: string;
  observedWindowDurationSeconds: number;
  recordedPredicate: Record<"C" | "B" | "G" | "H" | "R" | "X" | "P", boolean>;
};

function recomputePredicate(vector: FeatureVector): FeatureVector["recordedPredicate"] {
  const medianAtMost = (seconds: number) =>
    vector.medianDominantDirectionGapSeconds.numerator <=
      seconds * vector.medianDominantDirectionGapSeconds.denominator;
  const C = vector.dominantDirectionCount >= 20 && (
    medianAtMost(120) || vector.maxDominantDirectionEventsPerHour >= 15
  );
  const B = vector.uniqueCounterparties >= 25 &&
    vector.uniqueCounterparties * 5 >= vector.featureEligibleEventCount &&
    vector.largestCounterparty.count * 2 <= vector.largestCounterparty.shareDenominator;
  const G = (
    vector.dominantDirectionCount * 10 >= vector.dominantShareDenominator * 7 &&
    vector.uniqueDominantCounterparties >= 20
  ) || (vector.uniqueSenders >= 10 && vector.uniqueRecipients >= 10);
  const H = vector.activeUtcHourOfDayCount >= 12;
  const R = vector.dominantExactAmount.count >= 10 &&
    vector.dominantExactAmount.count * 10 >= vector.dominantExactAmount.shareDenominator;
  const X = vector.dominantDirectionCount >= 80 &&
    vector.dominantDirectionCount * 10 >= vector.dominantShareDenominator * 8 &&
    vector.uniqueDominantCounterparties >= 80 && (
      medianAtMost(15) || vector.maxDominantDirectionEventsPerHour >= 80
    );
  return { C, B, G, H, R, X, P: C && B && G && (H || R || X) };
}

function expectReplayableFeatureVector(vector: FeatureVector): void {
  expect(vector.physicalRowCount).toBeGreaterThanOrEqual(vector.canonicalEventCount);
  expect(vector.canonicalEventCount).toBeGreaterThanOrEqual(vector.featureEligibleEventCount);
  expect(vector.incomingCount + vector.outgoingCount).toBe(vector.featureEligibleEventCount);
  expect(vector.uniqueCounterparties).toBeLessThanOrEqual(
    vector.uniqueSenders + vector.uniqueRecipients
  );
  expect(vector.largestCounterparty.shareDenominator).toBe(vector.featureEligibleEventCount);
  expect(vector.largestCounterparty.count).toBeLessThanOrEqual(vector.featureEligibleEventCount);
  expect(vector.dominantDirectionCount).toBe(Math.max(vector.incomingCount, vector.outgoingCount));
  expect(vector.uniqueDominantCounterparties).toBe(
    vector.dominantDirection === "incoming" ? vector.uniqueSenders : vector.uniqueRecipients
  );
  expect(vector.dominantShareDenominator).toBe(vector.featureEligibleEventCount);
  expect([1, 2]).toContain(vector.medianDominantDirectionGapSeconds.denominator);
  expect(vector.dominantExactAmount.amountRaw).toMatch(/^(0|[1-9]\d*)$/u);
  expect(vector.dominantExactAmount.shareDenominator).toBe(vector.dominantDirectionCount);
  expect(vector.dominantExactAmount.count).toBeLessThanOrEqual(vector.dominantDirectionCount);
  expect(Date.parse(vector.observedEndTimestamp) - Date.parse(vector.observedStartTimestamp))
    .toBe(vector.observedWindowDurationSeconds * 1_000);
  expect(vector.recordedPredicate).toEqual(recomputePredicate(vector));
}

describe("forensic model offline corpus v1", () => {
  it("has the frozen schema and honest evidence classes", () => {
    expect(corpus.schemaVersion).toBe("forensic-model-offline-corpus-v1");
    expect(corpus.ledgerCases.length).toBeGreaterThan(0);
    expect(corpus.serviceCases.length).toBeGreaterThan(0);
    expect(corpus.adverseCases.length).toBeGreaterThan(0);

    expect(new Set(cases.map(({ id }) => id)).size).toBe(cases.length);
    for (const item of cases) {
      expect([
        "exact_frozen_rows",
        "recorded_calibration_vector",
        "synthetic_edge_case"
      ]).toContain(item.evidenceClass);
      if (item.evidenceClass === "exact_frozen_rows") {
        expect(item.rawEvidenceRef).toEqual(expect.any(String));
        expect(item.rawEvidenceRef).not.toHaveLength(0);
      }
    }
  });

  it("stores every raw amount as a canonical unsigned decimal string", () => {
    const amounts = collectAmountRawValues(corpus);
    expect(amounts.length).toBeGreaterThan(0);
    for (const amount of amounts) {
      expect(typeof amount).toBe("string");
      expect(amount).toMatch(/^(0|[1-9]\d*)$/u);
    }
  });

  it("keeps real observations distinct from authoritative replay", () => {
    const w8srl = corpus.serviceCases.find(({ id }) => id === "w8srl-two-window-calibration");
    expect(w8srl?.evidenceClass).toBe("recorded_calibration_vector");
    expect(w8srl).toMatchObject({
      authoritativeWouldAction: null,
      windows: [
        { kind: "recent", physicalRowCount: 100, incomingCount: 12, outgoingCount: 88 },
        { kind: "historical", physicalRowCount: 100, incomingCount: 20, outgoingCount: 80 }
      ]
    });

    const pacgy = corpus.ledgerCases.find(({ id }) => id === "pacgy-recorded-chronology");
    expect(pacgy).toMatchObject({
      evidenceClass: "recorded_calibration_vector",
      historyCompleteness: {
        providerExhaustionProven: false,
        zeroOpeningWitnessProven: false
      },
      expectedAuthoritativeState: "history_incomplete",
      currentBalanceObservation: {
        amountRaw: "82700000",
        authority: "diagnostic_non_pinned",
        expectedState: "unresolved"
      },
      duplicateReceiptBinding: {
        providerAliasCount: 2,
        providerEventIndexIsCanonical: false,
        canonicalIdentity: {
          txHash: "676a97390c99f997e3c9af9a57e8c684c7b6253710e8b009950f73b8b25fe7ca",
          officialUsdtLogOrdinal: 0,
          officialUsdtLogCount: 1,
          authority: "full_node_receipt"
        }
      }
    });
    const receiptBinding = pacgy?.duplicateReceiptBinding as {
      canonicalIdentity: unknown;
      providerAliases: readonly {
        provider: string;
        transferId: string;
        eventIndex: number;
        boundCanonicalIdentity: unknown;
      }[];
    };
    expect(receiptBinding.providerAliases).toHaveLength(2);
    expect(new Set(receiptBinding.providerAliases.map((alias) =>
      `${alias.provider}:${alias.transferId}:${alias.eventIndex}`
    )).size).toBe(2);
    for (const alias of receiptBinding.providerAliases) {
      expect(alias.provider).not.toHaveLength(0);
      expect(alias.transferId).not.toHaveLength(0);
      expect(Number.isSafeInteger(alias.eventIndex)).toBe(true);
      expect(alias.boundCanonicalIdentity).toEqual(receiptBinding.canonicalIdentity);
    }
    expect(corpus.ledgerCases).toContainEqual(expect.objectContaining({
      id: "pacgy-synthetic-zero-opening-control",
      evidenceClass: "synthetic_edge_case",
      openingBalanceRaw: "0"
    }));
  });

  it("embeds 21 unique CSV controls as non-runtime calibration vectors", () => {
    const controls = corpus.serviceCases.filter(({ calibrationSet }) =>
      calibrationSet === "csv-addresses-2026-07-26"
    );
    expect(controls).toHaveLength(21);
    expect(new Set(controls.map(({ address }) => address)).size).toBe(21);
    for (const control of controls) {
      expect(control).toMatchObject({
        evidenceClass: "recorded_calibration_vector",
        source: {
          kind: "tronscan_csv_export",
          capturedDate: "2026-07-26",
          runtimeInput: false
        }
      });
      expect((control.source as { fileName: string }).fileName).toMatch(/^Transfers_20260726.*\.csv$/u);
      expect((control.source as { sha256: string }).sha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(control.source).toMatchObject({
        classification: "whole_export_x_calibration_non_authoritative"
      });
      expectReplayableFeatureVector(control.observedVector as FeatureVector);
    }
  });

  it("freezes replayable W8SRL window feature inputs", () => {
    const w8srl = corpus.serviceCases.find(({ id }) => id === "w8srl-two-window-calibration") as unknown as {
      windows: readonly (FeatureVector & { kind: "recent" | "historical"; source: unknown })[];
    };
    expect(w8srl.windows).toHaveLength(2);
    for (const window of w8srl.windows) {
      expect(window.source).toMatchObject({
        classification: "recovered_fixed_cutoff_provider_vector",
        rawPagesPersisted: false
      });
      expectReplayableFeatureVector(window);
    }
    const recent = w8srl.windows.find(({ kind }) => kind === "recent") as FeatureVector;
    const historical = w8srl.windows.find(({ kind }) => kind === "historical") as FeatureVector;
    const separationMilliseconds = Date.parse(recent.observedStartTimestamp) -
      Date.parse(historical.observedEndTimestamp);
    expect(separationMilliseconds).toBeGreaterThan(0);
    expect(separationMilliseconds).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 * 1_000);
  });

  it("freezes the required arithmetic and adverse controls", () => {
    expect(corpus.ledgerCases.map(({ id }) => id)).toEqual(expect.arrayContaining([
      "integer-remainder-control",
      "exact-self-transfer-control",
      "identity-collision-control",
      "missing-order-control",
      "debit-over-inventory-control"
    ]));

    expect(corpus.adverseCases.map(({ id }) => id)).toEqual(expect.arrayContaining([
      "exact-binance-label",
      "exact-htx-label",
      "event-time-blacklist-partitions",
      "gasfree-principal-fee-classification",
      "drainer-method-only",
      "drainer-complete-evidence"
    ]));
    expect(corpus.adverseCases.find(({ id }) => id === "gasfree-principal-fee-classification"))
      .toMatchObject({ ledgerExecutionCase: false });

    const collision = corpus.ledgerCases.find(({ id }) => id === "identity-collision-control") as unknown as {
      expectedState: string;
      events: readonly {
        canonicalIdentity: unknown;
        amountRaw: string;
      }[];
    };
    expect(collision.expectedState).toBe("identity_collision");
    expect(collision.events).toHaveLength(2);
    expect(collision.events[0]?.canonicalIdentity).toEqual(collision.events[1]?.canonicalIdentity);
    expect(collision.events[0]?.amountRaw).not.toBe(collision.events[1]?.amountRaw);
  });

  it("freezes internally consistent adverse replay scenes", () => {
    const blacklist = corpus.adverseCases.find(({ id }) => id === "event-time-blacklist-partitions") as unknown as {
      tokenContract: string;
      listedAddress: string;
      timelineEvidence: {
        verificationStatus: string;
        historyComplete: boolean;
        canonicalOrderVerified: boolean;
        coverageStartTimestamp: string;
        coverageEndTimestamp: string;
      };
      principalTransfers: readonly {
        amountRaw: string;
        expectedTemporalClass: string;
        occurredAt: string | null;
        tokenContract: string;
        toAddress: string;
        confirmed: boolean;
        successful: boolean;
      }[];
      timelineEvents: readonly {
        occurredAt: string;
        eventKind: "added" | "removed";
        subjectAddress: string;
        tokenContract: string;
        confirmed: boolean;
        successful: boolean;
      }[];
      partitions: Record<string, string>;
    };
    expect(blacklist.principalTransfers).toHaveLength(3);
    expect(blacklist.timelineEvents).toContainEqual(expect.objectContaining({
      eventKind: "added", confirmed: true, successful: true
    }));
    expect(blacklist.timelineEvents).toContainEqual(expect.objectContaining({
      eventKind: "removed", confirmed: true, successful: true
    }));
    expect(blacklist.timelineEvidence).toMatchObject({
      verificationStatus: "verified",
      historyComplete: true,
      canonicalOrderVerified: true
    });
    const coverageStart = Date.parse(blacklist.timelineEvidence.coverageStartTimestamp);
    const coverageEnd = Date.parse(blacklist.timelineEvidence.coverageEndTimestamp);
    const timeline = [...blacklist.timelineEvents]
      .filter((event) =>
        event.confirmed &&
        event.successful &&
        event.subjectAddress === blacklist.listedAddress &&
        event.tokenContract === blacklist.tokenContract
      )
      .sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt));
    const deriveTemporalClass = (transfer: typeof blacklist.principalTransfers[number]) => {
      if (
        transfer.occurredAt === null ||
        blacklist.timelineEvidence.verificationStatus !== "verified" ||
        !blacklist.timelineEvidence.historyComplete ||
        !blacklist.timelineEvidence.canonicalOrderVerified
      ) return "unknown_time";
      const occurredAt = Date.parse(transfer.occurredAt);
      if (occurredAt < coverageStart || occurredAt > coverageEnd) return "unknown_time";
      let active = false;
      for (const event of timeline) {
        if (Date.parse(event.occurredAt) > occurredAt) break;
        active = event.eventKind === "added";
      }
      return active ? "active_at_event" : "before_activation";
    };
    const classified = blacklist.principalTransfers.map((transfer) => ({
      ...transfer,
      derivedTemporalClass: deriveTemporalClass(transfer)
    }));
    expect(classified.map(({ derivedTemporalClass }) => derivedTemporalClass)).toEqual(
      blacklist.principalTransfers.map(({ expectedTemporalClass }) => expectedTemporalClass)
    );
    expect(classified.every((row) =>
      row.confirmed &&
      row.successful &&
      row.tokenContract === blacklist.tokenContract &&
      row.toAddress === blacklist.listedAddress
    )).toBe(true);
    const partitionSum = (temporalClass: string) => classified
      .filter((row) => row.derivedTemporalClass === temporalClass)
      .reduce((sum, row) => sum + BigInt(row.amountRaw), 0n).toString();
    expect(partitionSum("before_activation")).toBe(blacklist.partitions.beforeActivationAmountRaw);
    expect(partitionSum("active_at_event")).toBe(blacklist.partitions.activeAtEventAmountRaw);
    expect(partitionSum("unknown_time")).toBe(blacklist.partitions.unknownTimeAmountRaw);
    expect(blacklist.principalTransfers.find(({ expectedTemporalClass }) => expectedTemporalClass === "unknown_time")?.occurredAt)
      .toBeNull();

    const gasFree = corpus.adverseCases.find(({ id }) => id === "gasfree-principal-fee-classification") as unknown as {
      ledgerExecutionCase: boolean;
      transactionInfo: {
        confirmed: boolean;
        contractRet: string;
        revert: boolean;
        status: number;
        contractData: { contract_address: string; data: string };
        trc20TransferInfo: readonly {
          from_address: string;
          to_address: string;
          amount_str: string;
          contract_address: string;
          status: number;
          tokenInfo: { tokenId: string; tokenAbbr: string; tokenType: string };
        }[];
      };
      settlement: { principalAmountRaw: string; feeAmountRaw: string };
      replayEdges: readonly {
        fromAddress: string;
        toAddress: string;
        amountRaw: string;
        economicRole: "principal" | "service_fee";
        economicProtocol: "tron_gasfree";
      }[];
    };
    expect(gasFree.ledgerExecutionCase).toBe(false);
    expect(gasFree.transactionInfo).toMatchObject({
      confirmed: true,
      contractRet: "SUCCESS",
      revert: false,
      status: 0
    });
    expect(gasFree.transactionInfo.contractData.data).toMatch(/^6f21b898[0-9a-f]+$/u);
    expect(gasFree.transactionInfo.contractData.data).toHaveLength(840);
    expect(gasFree.transactionInfo.trc20TransferInfo).toHaveLength(2);
    expect(gasFree.replayEdges.map(({ economicRole }) => economicRole)).toEqual([
      "principal",
      "service_fee"
    ]);
    expect(gasFree.replayEdges.every(({ economicProtocol }) => economicProtocol === "tron_gasfree"))
      .toBe(true);
    expect(gasFree.transactionInfo.trc20TransferInfo.map((row) => ({
      fromAddress: row.from_address,
      toAddress: row.to_address,
      amountRaw: row.amount_str
    }))).toEqual(gasFree.replayEdges.map(({ economicProtocol: _protocol, economicRole: _role, ...edge }) => edge));
    expect(gasFree.transactionInfo.trc20TransferInfo.every((row) =>
      row.status === 0 &&
      row.contract_address === row.tokenInfo.tokenId &&
      row.tokenInfo.tokenAbbr === "USDT" &&
      row.tokenInfo.tokenType === "trc20"
    )).toBe(true);
    expect(gasFree.replayEdges[0]?.amountRaw).toBe(gasFree.settlement.principalAmountRaw);
    expect(gasFree.replayEdges[1]?.amountRaw).toBe(gasFree.settlement.feeAmountRaw);

    const methodOnly = corpus.adverseCases.find(({ id }) => id === "drainer-method-only") as unknown as {
      observed: { methodId: string };
      expectedExactDrainerAuthority: boolean;
      methodEvidence: {
        contractAddress: string;
        bytecodeFingerprint: string;
        methodMap: readonly { selector: string; signature: string }[];
      };
      approvalCall: null;
      transferFromCall: null;
      movement: null;
    };
    expect(methodOnly.methodEvidence.bytecodeFingerprint).toMatch(/^synthetic:sha256:[0-9a-f]{64}$/u);
    expect(methodOnly.methodEvidence.methodMap).toEqual([{
      selector: methodOnly.observed.methodId,
      signature: "transferFrom(address,address,uint256)"
    }]);
    expect(methodOnly.expectedExactDrainerAuthority).toBe(false);
    expect(methodOnly.approvalCall).toBeNull();
    expect(methodOnly.transferFromCall).toBeNull();
    expect(methodOnly.movement).toBeNull();

    const complete = corpus.adverseCases.find(({ id }) => id === "drainer-complete-evidence") as unknown as {
      methodEvidence: {
        contractAddress: string;
        bytecodeFingerprint: string;
        methodMap: readonly { selector: string; signature: string }[];
      };
      approvalCall: { txHash: string; tokenContract: string; ownerAddress: string; spenderAddress: string; amountRaw: string; confirmed: boolean; successful: boolean };
      transferFromCall: { txHash: string; contractAddress: string; selector: string; tokenContract: string; fromAddress: string; toAddress: string; receiverAddress: string; amountRaw: string; confirmed: boolean; successful: boolean };
      movement: { txHash: string; tokenContract: string; fromAddress: string; toAddress: string; amountRaw: string; confirmed: boolean; successful: boolean };
    };
    expect(complete.methodEvidence.bytecodeFingerprint).toMatch(/^synthetic:sha256:[0-9a-f]{64}$/u);
    expect(complete.methodEvidence.methodMap).toEqual([{
      selector: complete.transferFromCall.selector,
      signature: "transferFrom(address,address,uint256)"
    }]);
    expect(complete.approvalCall).toMatchObject({ confirmed: true, successful: true });
    expect(complete.transferFromCall).toMatchObject({ confirmed: true, successful: true });
    expect(complete.approvalCall.spenderAddress).toBe(complete.methodEvidence.contractAddress);
    expect(complete.transferFromCall.contractAddress).toBe(complete.methodEvidence.contractAddress);
    expect(complete.transferFromCall.receiverAddress).toBe(complete.movement.toAddress);
    expect(complete.movement).toEqual(expect.objectContaining({
      txHash: complete.transferFromCall.txHash,
      tokenContract: complete.transferFromCall.tokenContract,
      fromAddress: complete.transferFromCall.fromAddress,
      toAddress: complete.transferFromCall.toAddress,
      amountRaw: complete.transferFromCall.amountRaw,
      confirmed: true,
      successful: true
    }));
    expect(complete.approvalCall.tokenContract).toBe(complete.transferFromCall.tokenContract);
    expect(complete.approvalCall.ownerAddress).toBe(complete.transferFromCall.fromAddress);
    expect(BigInt(complete.approvalCall.amountRaw)).toBeGreaterThanOrEqual(BigInt(complete.transferFromCall.amountRaw));
  });
});
