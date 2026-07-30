import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  apportionRawLargestRemainderV1,
  canonicalizeChronologicalLedgerEventsV1,
  runChronologicalProportionalLedgerV1,
  selectLedgerProvenanceV1,
  type LedgerEventV1,
  type LedgerLotV1,
  type SnapshotBalanceWitnessV1
} from "../../src/forensics/chronologicalProportionalLedger.js";
import {
  classifyServiceBehavior100Plus100V2,
  computeServiceWindowVectorV2,
  evaluateServiceWindowPredicateV2,
  type CompleteServiceWindowVectorV2,
  type ServiceBehaviorRowV2,
  type ServiceWindowVectorV2
} from "../../src/forensics/serviceBehaviorResearch.js";
import {
  evaluateExactDrainerSceneV1,
  replayOfflineForensicModelCorpusV1,
  type ExactDrainerSceneInputV1,
  type OfflineCorpusV1
} from "../../src/forensics/offlineForensicModelReplay.js";
import { detectVerify20Fingerprint } from "../../src/forensics/verify20Fingerprint.js";

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

const completeFingerprintMethods = {
  "5082dd12": "Verify20(address,address,address,uint256)",
  "fc61dd23": "Verify10(address,uint256)",
  "ea4418d9": "withdrawAllTrxTo(address)",
  "f2fde38b": "transferOwnership(address)"
} as const;

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

  it("includes the named TQr and TXc service controls without promoting sparse records", () => {
    expect(corpus.serviceCases).toHaveLength(24);
    expect(corpus.serviceCases.slice(0, 22).map(({ id }) => id)).toEqual([
      "w8srl-two-window-calibration",
      "csv-SqPaM9",
      "csv-hQBSuW",
      "csv-owfnme",
      "csv-cKQz2J",
      "csv-eXDwoq",
      "csv-m7MWZv",
      "csv-JJpBXh",
      "csv-H14eaf",
      "csv-EMCMLc",
      "csv-DbNGMf",
      "csv-Yw8Pet",
      "csv-A94s8d",
      "csv-Fa5pk8",
      "csv-aEGqTr",
      "csv-Riiwed",
      "csv-q98cdn",
      "csv-k1Hjbo",
      "csv-r7RZVx",
      "csv-axRTDo",
      "csv-oqZ4dZ",
      "csv-ujBwhV"
    ]);

    const tqr = corpus.serviceCases.find(({ id }) => id === "tqr-d7nzp-recorded-control");
    expect(tqr).toMatchObject({
      evidenceClass: "recorded_calibration_vector",
      address: "TQrNKbdG7LwwQ2FqD6iHgvsNJeaVKD7NzP",
      rawProviderPagesFrozen: false,
      authoritativeWouldAction: null,
      behaviorClassification: "non_service_profile",
      estimatedWouldAction: "continue_full",
      recordedPartialVector: {
        cadencePredicate: false,
        checkedSubject: true,
        currentHtxTaggedCounterpartiesObserved: true,
        eventTimeLabelAuthorityProven: false
      },
      source: {
        kind: "manual_corpus_replay_summary",
        capturedDate: "2026-07-29",
        runtimeInput: false
      }
    });

    const txc = corpus.serviceCases.find(({ id }) => id === "txc-vusxvhd-recorded-control");
    expect(txc).toMatchObject({
      evidenceClass: "recorded_calibration_vector",
      address: "TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd",
      rawProviderPagesFrozen: false,
      authoritativeWouldAction: null,
      behaviorClassification: "insufficient_data",
      estimatedWouldAction: "continue_full",
      recordedPartialVector: {
        recentObservedRowCount: 73,
        historicalBaselineState: "empty"
      },
      source: {
        kind: "manual_corpus_replay_summary",
        capturedDate: "2026-07-29",
        runtimeInput: false
      }
    });

    for (const control of [tqr, txc]) {
      expect(control?.sourceRef).toBe(
        "docs/superpowers/specs/2026-07-29-service-boundary-sampling-amendment-design.md#результат-ручного-replay-2026-07-29"
      );
      expect(control?.researchAction).toBeUndefined();
      expect(control?.rawEvidenceRef).toBeUndefined();
      expect(control?.limitations).toEqual(expect.arrayContaining([
        "raw_provider_rows_not_persisted",
        "full_feature_vector_not_recorded"
      ]));
      for (const forbiddenField of [
        "windows",
        "observedVector",
        "rawFeaturesRecent",
        "rawFeaturesHistorical",
        "rawRows",
        "frozenRow",
        "frozenRows"
      ]) {
        expect(control).not.toHaveProperty(forbiddenField);
      }
      expect(control?.source).toMatchObject({
        refs: [
          {
            file: "docs/superpowers/verification/2026-07-29-forensic-model-manual-corpus-replay.md",
            line: expect.any(Number)
          },
          {
            file: "docs/superpowers/specs/2026-07-29-service-boundary-sampling-amendment-design.md",
            line: expect.any(Number)
          }
        ]
      });
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
      subjectAddress: string;
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
        txHash: string;
        logIndex: number;
        amountRaw: string;
        expectedTemporalClass: string;
        occurredAt: string | null;
        tokenContract: string;
        fromAddress: string;
        toAddress: string;
        confirmed: boolean;
        successful: boolean;
      }[];
      timelineEvents: readonly {
        txHash: string;
        logIndex: number;
        occurredAt: string;
        eventKind: "added" | "removed";
        subjectAddress: string;
        tokenContract: string;
        confirmed: boolean;
        successful: boolean;
      }[];
      partitions: Record<string, string>;
    };
    const hasExactSubjectSide = (transfers: typeof blacklist.principalTransfers) =>
      transfers.every((transfer) =>
        Number(transfer.fromAddress === blacklist.subjectAddress) +
          Number(transfer.toAddress === blacklist.subjectAddress) === 1
      );
    expect(blacklist.subjectAddress).toBe("synthetic-subject");
    expect(blacklist.subjectAddress).not.toBe(blacklist.listedAddress);
    expect(hasExactSubjectSide(blacklist.principalTransfers)).toBe(true);
    expect(hasExactSubjectSide([...blacklist.principalTransfers].reverse())).toBe(true);
    expect(blacklist.principalTransfers).toHaveLength(3);
    const blacklistEvidenceRows = [
      ...blacklist.principalTransfers,
      ...blacklist.timelineEvents
    ];
    expect(blacklistEvidenceRows).toHaveLength(5);
    for (const row of blacklistEvidenceRows) {
      expect(row.txHash).toMatch(/^[0-9a-f]{64}$/u);
      expect(row.logIndex).toBe(0);
    }
    expect(new Set(blacklistEvidenceRows.map(({ txHash, logIndex }) => `${txHash}:${logIndex}`)).size)
      .toBe(5);
    expect(blacklist.principalTransfers.map(({
      occurredAt,
      tokenContract,
      fromAddress,
      toAddress,
      amountRaw,
      confirmed,
      successful,
      expectedTemporalClass
    }) => ({
      occurredAt,
      tokenContract,
      fromAddress,
      toAddress,
      amountRaw,
      confirmed,
      successful,
      expectedTemporalClass
    }))).toEqual([
      {
        occurredAt: "2026-01-01T00:00:00.000Z",
        tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        fromAddress: "synthetic-subject",
        toAddress: "synthetic-listed-counterparty",
        amountRaw: "900000",
        confirmed: true,
        successful: true,
        expectedTemporalClass: "before_activation"
      },
      {
        occurredAt: "2026-01-03T00:00:00.000Z",
        tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        fromAddress: "synthetic-subject",
        toAddress: "synthetic-listed-counterparty",
        amountRaw: "100000",
        confirmed: true,
        successful: true,
        expectedTemporalClass: "active_at_event"
      },
      {
        occurredAt: null,
        tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        fromAddress: "synthetic-subject",
        toAddress: "synthetic-listed-counterparty",
        amountRaw: "50000",
        confirmed: true,
        successful: true,
        expectedTemporalClass: "unknown_time"
      }
    ]);
    expect(blacklist.timelineEvents.map(({
      occurredAt,
      tokenContract,
      subjectAddress,
      eventKind,
      confirmed,
      successful
    }) => ({
      occurredAt,
      tokenContract,
      subjectAddress,
      eventKind,
      confirmed,
      successful
    }))).toEqual([
      {
        occurredAt: "2026-01-02T00:00:00.000Z",
        tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        subjectAddress: "synthetic-listed-counterparty",
        eventKind: "added",
        confirmed: true,
        successful: true
      },
      {
        occurredAt: "2026-01-04T00:00:00.000Z",
        tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        subjectAddress: "synthetic-listed-counterparty",
        eventKind: "removed",
        confirmed: true,
        successful: true
      }
    ]);
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
    expect(detectVerify20Fingerprint({
      methodMap: Object.fromEntries(methodOnly.methodEvidence.methodMap.map(({ selector, signature }) =>
        [selector, signature]
      )),
      topMethods: []
    })).toMatchObject({
      matched: false,
      selectors: [],
      missingSelectors: Object.keys(completeFingerprintMethods)
    });
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
    expect(complete.methodEvidence.methodMap).toEqual(
      Object.entries(completeFingerprintMethods).map(([selector, signature]) => ({ selector, signature }))
    );
    expect(detectVerify20Fingerprint({
      methodMap: Object.fromEntries(complete.methodEvidence.methodMap.map(({ selector, signature }) =>
        [selector, signature]
      )),
      topMethods: []
    })).toEqual({
      matched: true,
      selectors: Object.keys(completeFingerprintMethods),
      blockedByTrustedService: false,
      missingSelectors: [],
      mismatchedSelectors: []
    });
    expect(complete.transferFromCall.selector).toBe("5082dd12");
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

const sevenDaysSeconds = 7 * 24 * 60 * 60;

function serviceVector(
  overrides: Partial<CompleteServiceWindowVectorV2> = {}
): CompleteServiceWindowVectorV2 {
  return {
    kind: "complete",
    physicalRowCount: 100,
    canonicalEventCount: 100,
    featureEligibleEventCount: 100,
    invalidPhysicalRowCount: 0,
    collisionPhysicalRowCount: 0,
    duplicatePhysicalRowCount: 0,
    poisoningOnlyEventCount: 0,
    gasFreeFeeEventCount: 0,
    gasFreePrincipalEventCount: 0,
    incomingCount: 20,
    outgoingCount: 80,
    uniqueSenders: 20,
    uniqueRecipients: 80,
    uniqueCounterparties: 100,
    largestCounterpartyCount: 1,
    largestCounterpartyShareDenominator: 100,
    dominantDirection: "outgoing",
    dominantDirectionCount: 80,
    uniqueDominantCounterparties: 80,
    dominantShareDenominator: 100,
    medianDominantDirectionGapSeconds: { numerator: 15, denominator: 1 },
    maxDominantDirectionEventsPerHour: 80,
    activeUtcHourOfDayCount: 12,
    dominantExactAmountRaw: 1_000n,
    dominantExactAmountCount: 10,
    dominantExactAmountShareDenominator: 80,
    observedStartSeconds: 10 * sevenDaysSeconds,
    observedEndSeconds: 10 * sevenDaysSeconds + 86_400,
    observedWindowDurationSeconds: 86_400,
    orderAuthoritative: true,
    ...overrides
  };
}

function serviceRow(
  index: number,
  startSeconds: number,
  overrides: Partial<ServiceBehaviorRowV2> = {}
): ServiceBehaviorRowV2 {
  const outgoing = index < 80;
  return {
    canonicalEventId: `event-${index}`,
    blockNumber: index + 1,
    transactionIndex: 0,
    eventIndex: 0,
    occurredAtSeconds: outgoing
      ? startSeconds + index
      : startSeconds + (index - 79) * 3_600,
    direction: outgoing ? "outgoing" : "incoming",
    counterpartyAddress: `counterparty-${index}`,
    amountRaw: outgoing ? 1_000n : BigInt(index + 1),
    valid: true,
    featureRole: "ordinary",
    ...overrides
  };
}

function serviceRows(startSeconds: number): ServiceBehaviorRowV2[] {
  return Array.from({ length: 100 }, (_, index) => serviceRow(index, startSeconds));
}

function recordedServiceVector(
  vector: FeatureVector,
  orderAuthoritative = false
): CompleteServiceWindowVectorV2 {
  return serviceVector({
    physicalRowCount: vector.physicalRowCount,
    canonicalEventCount: vector.canonicalEventCount,
    featureEligibleEventCount: vector.featureEligibleEventCount,
    duplicatePhysicalRowCount: vector.physicalRowCount - vector.canonicalEventCount,
    incomingCount: vector.incomingCount,
    outgoingCount: vector.outgoingCount,
    uniqueSenders: vector.uniqueSenders,
    uniqueRecipients: vector.uniqueRecipients,
    uniqueCounterparties: vector.uniqueCounterparties,
    largestCounterpartyCount: vector.largestCounterparty.count,
    largestCounterpartyShareDenominator: vector.largestCounterparty.shareDenominator,
    dominantDirection: vector.dominantDirection,
    dominantDirectionCount: vector.dominantDirectionCount,
    uniqueDominantCounterparties: vector.uniqueDominantCounterparties,
    dominantShareDenominator: vector.dominantShareDenominator,
    medianDominantDirectionGapSeconds: {
      numerator: vector.medianDominantDirectionGapSeconds.numerator,
      denominator: vector.medianDominantDirectionGapSeconds.denominator === 2 ? 2 : 1
    },
    maxDominantDirectionEventsPerHour: vector.maxDominantDirectionEventsPerHour,
    activeUtcHourOfDayCount: vector.activeUtcHourOfDayCount,
    dominantExactAmountRaw: BigInt(vector.dominantExactAmount.amountRaw),
    dominantExactAmountCount: vector.dominantExactAmount.count,
    dominantExactAmountShareDenominator: vector.dominantExactAmount.shareDenominator,
    observedStartSeconds: Date.parse(vector.observedStartTimestamp) / 1_000,
    observedEndSeconds: Date.parse(vector.observedEndTimestamp) / 1_000,
    observedWindowDurationSeconds: vector.observedWindowDurationSeconds,
    orderAuthoritative
  });
}

function passesServicePredicate(vector: ServiceWindowVectorV2): boolean {
  const predicate = evaluateServiceWindowPredicateV2(vector);
  return predicate.C && predicate.B && predicate.G && (predicate.H || predicate.R || predicate.X);
}

describe("service behavior research v2 predicates", () => {
  it("applies the inclusive C threshold and rejects one unit below", () => {
    expect(evaluateServiceWindowPredicateV2(serviceVector({
      dominantDirectionCount: 20,
      medianDominantDirectionGapSeconds: { numerator: 120, denominator: 1 },
      maxDominantDirectionEventsPerHour: 14
    })).C).toBe(true);
    expect(evaluateServiceWindowPredicateV2(serviceVector({
      dominantDirectionCount: 19,
      medianDominantDirectionGapSeconds: { numerator: 120, denominator: 1 },
      maxDominantDirectionEventsPerHour: 14
    })).C).toBe(false);
  });

  it("applies every inclusive B boundary and rejects one unit beyond it", () => {
    expect(evaluateServiceWindowPredicateV2(serviceVector({
      featureEligibleEventCount: 125,
      uniqueCounterparties: 25,
      largestCounterpartyCount: 62,
      largestCounterpartyShareDenominator: 125
    })).B).toBe(true);
    expect(evaluateServiceWindowPredicateV2(serviceVector({
      featureEligibleEventCount: 125,
      uniqueCounterparties: 24,
      largestCounterpartyCount: 62,
      largestCounterpartyShareDenominator: 125
    })).B).toBe(false);
    expect(evaluateServiceWindowPredicateV2(serviceVector({
      featureEligibleEventCount: 126,
      uniqueCounterparties: 25,
      largestCounterpartyCount: 62,
      largestCounterpartyShareDenominator: 126
    })).B).toBe(false);
    expect(evaluateServiceWindowPredicateV2(serviceVector({
      featureEligibleEventCount: 125,
      uniqueCounterparties: 25,
      largestCounterpartyCount: 63,
      largestCounterpartyShareDenominator: 125
    })).B).toBe(false);
  });

  it("applies both inclusive G branches and rejects one unit below", () => {
    expect(evaluateServiceWindowPredicateV2(serviceVector({
      dominantDirectionCount: 70,
      dominantShareDenominator: 100,
      uniqueDominantCounterparties: 20,
      uniqueSenders: 9,
      uniqueRecipients: 9
    })).G).toBe(true);
    expect(evaluateServiceWindowPredicateV2(serviceVector({
      dominantDirectionCount: 69,
      dominantShareDenominator: 100,
      uniqueDominantCounterparties: 20,
      uniqueSenders: 9,
      uniqueRecipients: 9
    })).G).toBe(false);
    expect(evaluateServiceWindowPredicateV2(serviceVector({
      dominantDirectionCount: 50,
      uniqueDominantCounterparties: 19,
      uniqueSenders: 10,
      uniqueRecipients: 10
    })).G).toBe(true);
    expect(evaluateServiceWindowPredicateV2(serviceVector({
      dominantDirectionCount: 50,
      uniqueDominantCounterparties: 19,
      uniqueSenders: 9,
      uniqueRecipients: 10
    })).G).toBe(false);
  });

  it("applies the inclusive H threshold and rejects one unit below", () => {
    expect(evaluateServiceWindowPredicateV2(serviceVector({ activeUtcHourOfDayCount: 12 })).H)
      .toBe(true);
    expect(evaluateServiceWindowPredicateV2(serviceVector({ activeUtcHourOfDayCount: 11 })).H)
      .toBe(false);
  });

  it("applies both inclusive R boundaries and rejects one unit below", () => {
    expect(evaluateServiceWindowPredicateV2(serviceVector({
      dominantDirectionCount: 100,
      dominantExactAmountCount: 10,
      dominantExactAmountShareDenominator: 100
    })).R).toBe(true);
    expect(evaluateServiceWindowPredicateV2(serviceVector({
      dominantDirectionCount: 100,
      dominantExactAmountCount: 9,
      dominantExactAmountShareDenominator: 100
    })).R).toBe(false);
    expect(evaluateServiceWindowPredicateV2(serviceVector({
      dominantDirectionCount: 101,
      dominantExactAmountCount: 10,
      dominantExactAmountShareDenominator: 101
    })).R).toBe(false);
  });

  it("applies every inclusive X boundary and rejects one unit below", () => {
    const threshold = serviceVector({
      dominantDirectionCount: 80,
      dominantShareDenominator: 100,
      uniqueDominantCounterparties: 80,
      medianDominantDirectionGapSeconds: { numerator: 15, denominator: 1 },
      maxDominantDirectionEventsPerHour: 79
    });
    expect(evaluateServiceWindowPredicateV2(threshold).X).toBe(true);
    expect(evaluateServiceWindowPredicateV2(serviceVector({
      ...threshold,
      dominantDirectionCount: 79
    })).X).toBe(false);
    expect(evaluateServiceWindowPredicateV2(serviceVector({
      ...threshold,
      featureEligibleEventCount: 101
    })).X).toBe(false);
    expect(evaluateServiceWindowPredicateV2(serviceVector({
      ...threshold,
      uniqueDominantCounterparties: 79
    })).X).toBe(false);
    expect(evaluateServiceWindowPredicateV2(serviceVector({
      ...threshold,
      medianDominantDirectionGapSeconds: { numerator: 16, denominator: 1 }
    })).X).toBe(false);
  });

  it("compares an even median using the exact central-gap sum", () => {
    expect(evaluateServiceWindowPredicateV2(serviceVector({
      dominantDirectionCount: 20,
      medianDominantDirectionGapSeconds: { numerator: 240, denominator: 2 },
      maxDominantDirectionEventsPerHour: 14
    })).C).toBe(true);
    expect(evaluateServiceWindowPredicateV2(serviceVector({
      dominantDirectionCount: 20,
      medianDominantDirectionGapSeconds: { numerator: 241, denominator: 2 },
      maxDominantDirectionEventsPerHour: 14
    })).C).toBe(false);
  });

  it("makes C, R, and X false for an incoming/outgoing tie", () => {
    const rows = Array.from({ length: 100 }, (_, index) => serviceRow(index, 0, {
      direction: index < 50 ? "outgoing" : "incoming",
      occurredAtSeconds: index,
      amountRaw: 1_000n
    }));
    const vector = computeServiceWindowVectorV2(rows);

    expect(vector).toMatchObject({
      incomingCount: 50,
      outgoingCount: 50,
      dominantDirection: null,
      dominantDirectionCount: 0,
      medianDominantDirectionGapSeconds: null,
      dominantExactAmountCount: 0
    });
    expect(evaluateServiceWindowPredicateV2(vector)).toMatchObject({
      C: false,
      R: false,
      X: false
    });
  });

  it("uses every eligible event as the largest-counterparty denominator", () => {
    const rows = Array.from({ length: 100 }, (_, index) => serviceRow(index, 0, {
      direction: index < 51 ? "outgoing" : "incoming",
      counterpartyAddress: index < 51 ? `recipient-${index}` : "repeat-sender"
    }));
    const vector = computeServiceWindowVectorV2(rows);

    expect(vector).toMatchObject({
      featureEligibleEventCount: 100,
      largestCounterpartyCount: 49,
      largestCounterpartyShareDenominator: 100
    });
    expect(evaluateServiceWindowPredicateV2(vector).B).toBe(true);
  });
});

describe("service behavior research v2 windows", () => {
  it("consumes at most 100 physical rows and is invariant to authoritative permutation", () => {
    const rows = [...serviceRows(0), serviceRow(100, 0)];
    const forward = computeServiceWindowVectorV2(rows);
    const reversed = computeServiceWindowVectorV2([...rows].reverse());

    expect(forward).toEqual(reversed);
    expect(forward).toMatchObject({
      physicalRowCount: 100,
      canonicalEventCount: 100,
      featureEligibleEventCount: 100,
      observedWindowDurationSeconds: 72_000,
      orderAuthoritative: true
    });
  });

  it("does not let an unauthoritative 101st row weaken the retained window", () => {
    const rows = [
      ...serviceRows(0),
      serviceRow(100, 0, { transactionIndex: null })
    ];
    const vector = computeServiceWindowVectorV2(rows);

    expect(vector).toMatchObject({
      physicalRowCount: 100,
      canonicalEventCount: 100,
      orderAuthoritative: true
    });
  });

  it("marks missing or conflicting canonical order as unauthoritative", () => {
    const missing = serviceRows(0);
    missing[0] = { ...missing[0]!, transactionIndex: null };
    expect(computeServiceWindowVectorV2(missing).orderAuthoritative).toBe(false);

    const conflicting = serviceRows(0);
    conflicting[1] = {
      ...conflicting[1]!,
      blockNumber: conflicting[0]!.blockNumber,
      transactionIndex: conflicting[0]!.transactionIndex,
      eventIndex: conflicting[0]!.eventIndex
    };
    expect(computeServiceWindowVectorV2(conflicting).orderAuthoritative).toBe(false);
  });

  it("does not top up a duplicate after the fixed 100 physical rows", () => {
    const unique = serviceRows(0).slice(0, 99);
    const vector = computeServiceWindowVectorV2([...unique, { ...unique[0]! }]);

    expect(vector).toMatchObject({
      physicalRowCount: 100,
      canonicalEventCount: 99,
      duplicatePhysicalRowCount: 1
    });
  });

  it("preserves invalid and collision inventory without positive features", () => {
    const invalidRows = serviceRows(0);
    invalidRows[99] = { ...invalidRows[99]!, valid: false };
    expect(computeServiceWindowVectorV2(invalidRows)).toMatchObject({
      physicalRowCount: 100,
      canonicalEventCount: 99,
      featureEligibleEventCount: 99,
      invalidPhysicalRowCount: 1
    });

    const collisionRows = serviceRows(0).slice(0, 98);
    const first = serviceRow(98, 0, { canonicalEventId: "collision" });
    const second = { ...first, amountRaw: first.amountRaw + 1n };
    expect(computeServiceWindowVectorV2([...collisionRows, first, second])).toMatchObject({
      physicalRowCount: 100,
      canonicalEventCount: 98,
      featureEligibleEventCount: 98,
      collisionPhysicalRowCount: 2
    });
  });

  it("excludes poisoning and GasFree fees but includes GasFree principal", () => {
    const rows = serviceRows(0);
    rows[0] = { ...rows[0]!, featureRole: "poisoning_only" };
    rows[1] = { ...rows[1]!, featureRole: "gasfree_fee" };
    rows[2] = { ...rows[2]!, featureRole: "gasfree_principal" };
    const vector = computeServiceWindowVectorV2(rows);

    expect(vector).toMatchObject({
      physicalRowCount: 100,
      canonicalEventCount: 100,
      featureEligibleEventCount: 98,
      poisoningOnlyEventCount: 1,
      gasFreeFeeEventCount: 1,
      gasFreePrincipalEventCount: 1,
      outgoingCount: 78
    });
  });
});

describe("service behavior 100 plus 100 research classification v2", () => {
  const historical = serviceVector({
    observedStartSeconds: 0,
    observedEndSeconds: 86_400
  });
  const recent = serviceVector({
    observedStartSeconds: 86_400 + sevenDaysSeconds,
    observedEndSeconds: 86_400 + sevenDaysSeconds + 86_400
  });

  it("requires both independent windows to pass the predicate", () => {
    expect(classifyServiceBehavior100Plus100V2({
      recent,
      historical,
      exactRoleConflict: false
    }).status).toBe("high_inferred_service");
    expect(classifyServiceBehavior100Plus100V2({
      recent: serviceVector({ ...recent, activeUtcHourOfDayCount: 11, dominantExactAmountCount: 9,
        dominantDirectionCount: 79, uniqueDominantCounterparties: 79,
        medianDominantDirectionGapSeconds: { numerator: 16, denominator: 1 },
        maxDominantDirectionEventsPerHour: 14 }),
      historical,
      exactRoleConflict: false
    }).status).toBe("non_service_profile");
  });

  it("returns insufficient data for fewer than 100 canonical events or missing order", () => {
    expect(classifyServiceBehavior100Plus100V2({
      recent: serviceVector({ ...recent, canonicalEventCount: 99 }),
      historical,
      exactRoleConflict: false
    }).status).toBe("insufficient_data");
    expect(classifyServiceBehavior100Plus100V2({
      recent: serviceVector({ ...recent, orderAuthoritative: false }),
      historical,
      exactRoleConflict: false
    }).status).toBe("insufficient_data");
    expect(classifyServiceBehavior100Plus100V2({
      recent: serviceVector({ ...recent, physicalRowCount: 101, canonicalEventCount: 101 }),
      historical,
      exactRoleConflict: false
    }).status).toBe("insufficient_data");
  });

  it("returns insufficient data for overlap or less than seven-day separation", () => {
    expect(classifyServiceBehavior100Plus100V2({
      recent: serviceVector({ ...recent, observedStartSeconds: historical.observedEndSeconds! }),
      historical,
      exactRoleConflict: false
    }).status).toBe("insufficient_data");
    expect(classifyServiceBehavior100Plus100V2({
      recent: serviceVector({
        ...recent,
        observedStartSeconds: historical.observedEndSeconds! + sevenDaysSeconds - 1
      }),
      historical,
      exactRoleConflict: false
    }).status).toBe("insufficient_data");
    expect(classifyServiceBehavior100Plus100V2({
      recent: serviceVector({
        ...recent,
        observedStartSeconds: historical.observedEndSeconds! + sevenDaysSeconds
      }),
      historical,
      exactRoleConflict: false
    }).status).toBe("high_inferred_service");
  });

  it("keeps the sparse TXc control honest while classifying it insufficient", () => {
    const txc = corpus.serviceCases.find(({ id }) => id === "txc-vusxvhd-recorded-control")!;
    const txcRecent: ServiceWindowVectorV2 = {
      kind: "incomplete",
      physicalRowCount: 73,
      canonicalEventCount: 73,
      orderAuthoritative: false,
      observedStartSeconds: null,
      observedEndSeconds: null
    };
    const txcHistorical: ServiceWindowVectorV2 = {
      kind: "incomplete",
      physicalRowCount: 0,
      canonicalEventCount: 0,
      orderAuthoritative: false,
      observedStartSeconds: null,
      observedEndSeconds: null
    };
    const result = classifyServiceBehavior100Plus100V2({
      recent: txcRecent,
      historical: txcHistorical,
      exactRoleConflict: false
    });

    expect(txc).toMatchObject({
      evidenceClass: "recorded_calibration_vector",
      behaviorClassification: "insufficient_data",
      recordedPartialVector: {
        recentObservedRowCount: 73,
        historicalBaselineState: "empty"
      }
    });
    expect(result).toEqual({
      status: "insufficient_data",
      recentVector: txcRecent,
      historicalVector: txcHistorical,
      recentPredicates: { C: false, B: false, G: false, H: false, R: false, X: false },
      historicalPredicates: { C: false, B: false, G: false, H: false, R: false, X: false }
    });
  });

  it("does not promote sparse D7NzP evidence into the full classifier", () => {
    const tqr = corpus.serviceCases.find(({ id }) => id === "tqr-d7nzp-recorded-control")!;
    expect(tqr).toMatchObject({
      evidenceClass: "recorded_calibration_vector",
      behaviorClassification: "non_service_profile",
      recordedPartialVector: { cadencePredicate: false }
    });
    expect(tqr.limitations).toEqual(expect.arrayContaining([
      "full_feature_vector_not_recorded",
      "checked_subject_cannot_be_inferred_boundary"
    ]));
  });

  it("replays W8SRL as a recorded two-window high control", () => {
    const w8srl = corpus.serviceCases.find(({ id }) => id === "w8srl-two-window-calibration")!;
    const windows = w8srl.windows as FeatureVector[];
    const result = classifyServiceBehavior100Plus100V2({
      recent: recordedServiceVector(windows[0]!, true),
      historical: recordedServiceVector(windows[1]!, true),
      exactRoleConflict: false
    });

    expect(w8srl.evidenceClass).toBe("recorded_calibration_vector");
    expect(result.status).toBe("high_inferred_service");
  });

  it("returns role conflict for the exact Binance authority control", () => {
    const binance = corpus.adverseCases.find(({ id }) => id === "exact-binance-label")!;
    expect(binance).toMatchObject({
      evidenceClass: "exact_frozen_rows",
      expectedClassification: "exact_service_label"
    });
    expect(classifyServiceBehavior100Plus100V2({
      recent,
      historical,
      exactRoleConflict: true
    }).status).toBe("role_conflict");
  });

  it("matches every complete recorded calibration predicate without upgrading evidence", () => {
    const completeControls = corpus.serviceCases.filter(({ observedVector }) => observedVector);
    expect(completeControls).toHaveLength(21);

    for (const control of completeControls) {
      const observed = control.observedVector as FeatureVector;
      const actual = evaluateServiceWindowPredicateV2(recordedServiceVector(observed));
      const { P, ...recorded } = observed.recordedPredicate;
      expect(actual, control.address as string).toEqual(recorded);
      expect(passesServicePredicate(recordedServiceVector(observed)), control.address as string)
        .toBe(P);
      expect(control.evidenceClass).toBe("recorded_calibration_vector");
    }

    const sh14eaf = completeControls.find(({ address }) =>
      (address as string).endsWith("SH14eaf")
    )!;
    expect(passesServicePredicate(recordedServiceVector(sh14eaf.observedVector as FeatureVector)))
      .toBe(false);

    for (const suffix of ["q98cdn", "aEGqTr"]) {
      const extreme = completeControls.find(({ address }) =>
        (address as string).endsWith(suffix)
      )!;
      expect(evaluateServiceWindowPredicateV2(
        recordedServiceVector(extreme.observedVector as FeatureVector)
      )).toMatchObject({ X: true });
    }
  });
});

const subjectAddress = "subject";
const ledgerSnapshot = {
  snapshotBlockNumber: 100,
  snapshotBlockHash: "snapshot-block-hash",
  snapshotEvidenceRef: "fixture:snapshot"
} as const;

function ledgerEvent(input: Partial<LedgerEventV1> & {
  canonicalEventId: string | null;
  blockNumber: number;
  fromAddress: string;
  toAddress: string;
  amountRaw: bigint;
}): LedgerEventV1 {
  return {
    providerEventIds: [`provider:${input.canonicalEventId ?? input.blockNumber}`],
    txHash: `tx:${input.canonicalEventId ?? input.blockNumber}`,
    transactionIndex: 0,
    eventIndex: 0,
    eventIndexAuthority: "receipt_log_index",
    occurredAtMs: input.blockNumber * 1_000,
    ...input
  };
}

function lot(lotId: string, remainingRaw: bigint): LedgerLotV1 {
  return {
    lotId,
    sourceEventId: lotId,
    sourceAddress: `source:${lotId}`,
    originalRaw: remainingRaw,
    remainingRaw
  };
}

function balanceWitness(
  amountRaw: bigint,
  overrides: Partial<SnapshotBalanceWitnessV1> = {}
): SnapshotBalanceWitnessV1 {
  return {
    amountRaw,
    pinned: true,
    independent: true,
    subjectAddress,
    snapshotBlockNumber: ledgerSnapshot.snapshotBlockNumber,
    snapshotBlockHash: ledgerSnapshot.snapshotBlockHash,
    evidenceRef: "fixture:independent-balance",
    ...overrides
  };
}

describe("chronological proportional ledger v1", () => {
  const zeroOpeningEvents = [
    ledgerEvent({ canonicalEventId: "in-300", blockNumber: 1, fromAddress: "funder-old", toAddress: subjectAddress, amountRaw: 300n }),
    ledgerEvent({ canonicalEventId: "out-70", blockNumber: 2, fromAddress: subjectAddress, toAddress: "recipient-70", amountRaw: 70n }),
    ledgerEvent({ canonicalEventId: "out-12", blockNumber: 3, fromAddress: subjectAddress, toAddress: "recipient-12", amountRaw: 12n }),
    ledgerEvent({ canonicalEventId: "out-180", blockNumber: 4, fromAddress: subjectAddress, toAddress: "recipient-180", amountRaw: 180n }),
    ledgerEvent({ canonicalEventId: "out-38", blockNumber: 5, fromAddress: subjectAddress, toAddress: "recipient-38", amountRaw: 38n })
  ] as const;

  it("covers the exact 180 episode while using 180 of the original 300 lot", () => {
    const ledger = runChronologicalProportionalLedgerV1({
      subjectAddress,
      ...ledgerSnapshot,
      historyCompleteness: "genesis_complete",
      openingBalanceRaw: 0n,
      events: zeroOpeningEvents
    });
    const selection = selectLedgerProvenanceV1({
      ledger,
      purpose: "exact_episode",
      exactEventId: "receipt:tx:out-180:0"
    });

    expect(ledger.state).toBe("complete");
    expect(selection).toMatchObject({
      state: "complete",
      targetRaw: 180n,
      coveredRaw: 180n,
      allocations: [{ lotId: "receipt:tx:in-300:0", amountRaw: 180n }]
    });
    expect(selection.allocations[0]).toMatchObject({
      sourceOriginalRaw: 300n,
      sourceUtilizedRaw: 180n
    });
  });

  it("keeps the recorded PacGy fixture unresolved without authoritative opening history", () => {
    const recorded = corpus.ledgerCases.find(({ id }) => id === "pacgy-recorded-chronology");
    const result = runChronologicalProportionalLedgerV1({
      subjectAddress,
      ...ledgerSnapshot,
      historyCompleteness: "partial",
      openingBalanceRaw: 0n,
      events: []
    });

    expect(recorded?.expectedAuthoritativeState).toBe("history_incomplete");
    expect(result).toMatchObject({ state: "unresolved", reason: "history_incomplete" });
  });

  it("is invariant to provider row permutation after canonical ordering", () => {
    const forward = runChronologicalProportionalLedgerV1({
      subjectAddress,
      ...ledgerSnapshot,
      historyCompleteness: "genesis_complete",
      openingBalanceRaw: 0n,
      events: zeroOpeningEvents
    });
    const reversed = runChronologicalProportionalLedgerV1({
      subjectAddress,
      ...ledgerSnapshot,
      historyCompleteness: "genesis_complete",
      openingBalanceRaw: 0n,
      events: [...zeroOpeningEvents].reverse()
    });

    expect(reversed).toEqual(forward);
  });

  it("dedupes exact receipt identity and preserves provider aliases", () => {
    const first = ledgerEvent({
      canonicalEventId: "caller:a",
      providerEventIds: ["provider:a"],
      txHash: "TX-1",
      blockNumber: 1,
      fromAddress: "funder",
      toAddress: subjectAddress,
      amountRaw: 5n
    });
    const result = canonicalizeChronologicalLedgerEventsV1([
      first,
      { ...first, canonicalEventId: "caller:b", providerEventIds: ["provider:b"] }
    ]);

    expect(result).toMatchObject({ state: "complete" });
    expect(result.events).toEqual([{
      ...first,
      canonicalEventId: "receipt:tx-1:0",
      txHash: "tx-1",
      providerEventIds: ["provider:a", "provider:b"]
    }]);
  });

  it("rejects conflicting payloads under one canonical identity", () => {
    const first = ledgerEvent({ canonicalEventId: "caller:a", txHash: "same-receipt", blockNumber: 1, fromAddress: "a", toAddress: subjectAddress, amountRaw: 5n });
    const events = [
      first,
      { ...first, canonicalEventId: "caller:b", providerEventIds: ["provider:b"], amountRaw: 7n }
    ];
    expect(canonicalizeChronologicalLedgerEventsV1(events)).toMatchObject({
      state: "unresolved",
      reason: "identity_collision",
      canonicalEventId: "receipt:same-receipt:0"
    });
    expect(runChronologicalProportionalLedgerV1({
      subjectAddress,
      ...ledgerSnapshot,
      historyCompleteness: "genesis_complete",
      openingBalanceRaw: 0n,
      events
    })).toMatchObject({
      state: "unresolved",
      reason: "identity_collision",
      totalIncomingRaw: 0n
    });
  });

  it("gives receipt collisions deterministic precedence over unresolved synthetic identity", () => {
    const receipt = ledgerEvent({ canonicalEventId: "caller:a", txHash: "collision", blockNumber: 1, fromAddress: "a", toAddress: subjectAddress, amountRaw: 5n });
    const collision = { ...receipt, canonicalEventId: "caller:b", amountRaw: 7n };
    const unresolved = ledgerEvent({
      canonicalEventId: "synthetic",
      txHash: "synthetic",
      blockNumber: 2,
      eventIndexAuthority: "provider_synthetic",
      fromAddress: "b",
      toAddress: subjectAddress,
      amountRaw: 3n
    });
    const forward = canonicalizeChronologicalLedgerEventsV1([unresolved, receipt, collision]);
    const reversed = canonicalizeChronologicalLedgerEventsV1([collision, receipt, unresolved]);

    expect(forward).toEqual(reversed);
    expect(forward).toMatchObject({
      state: "unresolved",
      reason: "identity_collision",
      canonicalEventId: "receipt:collision:0"
    });
  });

  it("rejects synthetic-only event identity", () => {
    expect(canonicalizeChronologicalLedgerEventsV1([
      ledgerEvent({
        canonicalEventId: null,
        blockNumber: 1,
        eventIndex: 99,
        eventIndexAuthority: "provider_synthetic",
        fromAddress: "a",
        toAddress: subjectAddress,
        amountRaw: 5n
      })
    ])).toMatchObject({ state: "unresolved", reason: "identity_unresolved" });
  });

  it("rejects missing authoritative same-block transaction order", () => {
    expect(canonicalizeChronologicalLedgerEventsV1([
      ledgerEvent({ canonicalEventId: "in", blockNumber: 10, transactionIndex: null, fromAddress: "a", toAddress: subjectAddress, amountRaw: 10n }),
      ledgerEvent({ canonicalEventId: "out", blockNumber: 10, transactionIndex: 1, fromAddress: subjectAddress, toAddress: "b", amountRaw: 8n })
    ])).toMatchObject({ state: "unresolved", reason: "order_unresolved", blockNumber: 10 });
  });

  it("does not use a shared transaction hash to replace missing same-block transaction order", () => {
    expect(canonicalizeChronologicalLedgerEventsV1([
      ledgerEvent({
        canonicalEventId: "same-tx:0",
        txHash: "same-tx",
        blockNumber: 10,
        transactionIndex: null,
        eventIndex: 0,
        fromAddress: "a",
        toAddress: subjectAddress,
        amountRaw: 10n
      }),
      ledgerEvent({
        canonicalEventId: "same-tx:1",
        txHash: "same-tx",
        blockNumber: 10,
        transactionIndex: null,
        eventIndex: 1,
        fromAddress: subjectAddress,
        toAddress: "b",
        amountRaw: 8n
      })
    ])).toMatchObject({ state: "unresolved", reason: "order_unresolved", blockNumber: 10 });
  });

  it("rejects one transaction hash mapped to different transaction positions", () => {
    const events = [
      ledgerEvent({
        canonicalEventId: "caller:0",
        txHash: "shared-tx",
        blockNumber: 10,
        transactionIndex: 0,
        eventIndex: 0,
        fromAddress: "a",
        toAddress: subjectAddress,
        amountRaw: 5n
      }),
      ledgerEvent({
        canonicalEventId: "caller:1",
        txHash: "shared-tx",
        blockNumber: 10,
        transactionIndex: 1,
        eventIndex: 1,
        fromAddress: "b",
        toAddress: subjectAddress,
        amountRaw: 7n
      })
    ];
    const forward = canonicalizeChronologicalLedgerEventsV1(events);
    const reversed = canonicalizeChronologicalLedgerEventsV1([...events].reverse());

    expect(reversed).toEqual(forward);
    expect(forward).toMatchObject({
      state: "unresolved",
      reason: "order_unresolved",
      blockNumber: 10
    });
  });

  it("rejects different transaction hashes mapped to one block transaction slot", () => {
    const events = [
      ledgerEvent({
        canonicalEventId: "caller:a",
        txHash: "tx-a",
        blockNumber: 10,
        transactionIndex: 0,
        eventIndex: 0,
        fromAddress: "a",
        toAddress: subjectAddress,
        amountRaw: 5n
      }),
      ledgerEvent({
        canonicalEventId: "caller:b",
        txHash: "tx-b",
        blockNumber: 10,
        transactionIndex: 0,
        eventIndex: 1,
        fromAddress: "b",
        toAddress: subjectAddress,
        amountRaw: 7n
      })
    ];
    const forward = canonicalizeChronologicalLedgerEventsV1(events);
    const reversed = canonicalizeChronologicalLedgerEventsV1([...events].reverse());

    expect(reversed).toEqual(forward);
    expect(forward).toMatchObject({
      state: "unresolved",
      reason: "order_unresolved",
      blockNumber: 10
    });
  });

  it("breaks equal largest-remainder ties by canonical lot ID", () => {
    expect(apportionRawLargestRemainderV1(1n, [lot("b", 1n), lot("a", 1n)]))
      .toEqual([
        { lotId: "a", amountRaw: 1n },
        { lotId: "b", amountRaw: 0n }
      ]);
  });

  it("uses code-unit order for Unicode lot ID ties independent of input order", () => {
    const composed = "\u00e9";
    const decomposed = "e\u0301";
    const expected = [
      { lotId: decomposed, amountRaw: 1n },
      { lotId: composed, amountRaw: 0n }
    ];

    expect(apportionRawLargestRemainderV1(1n, [lot(composed, 1n), lot(decomposed, 1n)]))
      .toEqual(expected);
    expect(apportionRawLargestRemainderV1(1n, [lot(decomposed, 1n), lot(composed, 1n)]))
      .toEqual(expected);
  });

  it("treats exact self-transfer as a balance and provenance no-op", () => {
    const result = runChronologicalProportionalLedgerV1({
      subjectAddress,
      ...ledgerSnapshot,
      historyCompleteness: "genesis_complete",
      openingBalanceRaw: 0n,
      events: [
        ledgerEvent({ canonicalEventId: "in", blockNumber: 1, fromAddress: "funder", toAddress: subjectAddress, amountRaw: 10n }),
        ledgerEvent({ canonicalEventId: "self", blockNumber: 2, fromAddress: subjectAddress, toAddress: subjectAddress, amountRaw: 7n })
      ]
    });

    expect(result).toMatchObject({ state: "complete", remainingRaw: 10n, totalOutgoingRaw: 0n });
    expect(result.consumptionVectors).toEqual([]);
    expect(result.lots).toHaveLength(1);
  });

  it("invalidates the whole ledger when a debit exceeds inventory", () => {
    const result = runChronologicalProportionalLedgerV1({
      subjectAddress,
      ...ledgerSnapshot,
      historyCompleteness: "genesis_complete",
      openingBalanceRaw: 0n,
      events: [
        ledgerEvent({ canonicalEventId: "in", blockNumber: 1, fromAddress: "funder", toAddress: subjectAddress, amountRaw: 10n }),
        ledgerEvent({ canonicalEventId: "out", blockNumber: 2, fromAddress: subjectAddress, toAddress: "recipient", amountRaw: 11n })
      ]
    });

    expect(result).toMatchObject({
      state: "unresolved",
      reason: "debit_exceeds_inventory",
      unresolvedRaw: 1n,
      authoritative: false
    });
    expect(selectLedgerProvenanceV1({ ledger: result, purpose: "exact_episode", exactEventId: "receipt:tx:out:0" }))
      .toMatchObject({ state: "unresolved", reason: "debit_exceeds_inventory" });
  });

  it("requires a matching pinned independent witness for balance projections", () => {
    const ledger = runChronologicalProportionalLedgerV1({
      subjectAddress,
      ...ledgerSnapshot,
      historyCompleteness: "genesis_complete",
      openingBalanceRaw: 0n,
      events: [ledgerEvent({ canonicalEventId: "in", blockNumber: 1, fromAddress: "funder", toAddress: subjectAddress, amountRaw: 10n })]
    });

    expect(ledger).toMatchObject({ subjectAddress, ...ledgerSnapshot });
    expect(selectLedgerProvenanceV1({ ledger, purpose: "current_balance" }))
      .toMatchObject({ state: "unresolved", reason: "balance_witness_missing" });
    expect(selectLedgerProvenanceV1({ ledger, purpose: "amount_only", requestedAmountRaw: 5n }))
      .toMatchObject({ state: "unresolved", reason: "balance_witness_missing" });
    expect(selectLedgerProvenanceV1({
      ledger,
      purpose: "current_balance",
      snapshotBalanceWitness: balanceWitness(10n, { subjectAddress: "other-subject" })
    })).toMatchObject({ state: "unresolved", reason: "balance_witness_binding_mismatch" });
    expect(selectLedgerProvenanceV1({
      ledger,
      purpose: "amount_only",
      requestedAmountRaw: 5n,
      snapshotBalanceWitness: balanceWitness(10n, { snapshotBlockNumber: 101 })
    })).toMatchObject({ state: "unresolved", reason: "balance_witness_binding_mismatch" });
    expect(selectLedgerProvenanceV1({
      ledger,
      purpose: "amount_only",
      requestedAmountRaw: 5n,
      snapshotBalanceWitness: balanceWitness(10n, { snapshotBlockHash: "other-hash" })
    })).toMatchObject({ state: "unresolved", reason: "balance_witness_binding_mismatch" });
    expect(selectLedgerProvenanceV1({
      ledger,
      purpose: "amount_only",
      requestedAmountRaw: 5n,
      snapshotBalanceWitness: balanceWitness(10n, { evidenceRef: "" })
    })).toMatchObject({ state: "unresolved", reason: "balance_witness_missing" });
    expect(selectLedgerProvenanceV1({
      ledger,
      purpose: "amount_only",
      requestedAmountRaw: 5n,
      snapshotBalanceWitness: balanceWitness(9n)
    })).toMatchObject({ state: "unresolved", reason: "snapshot_balance_mismatch" });
    expect(selectLedgerProvenanceV1({
      ledger,
      purpose: "amount_only",
      requestedAmountRaw: 5n,
      snapshotBalanceWitness: balanceWitness(10n)
    })).toMatchObject({ state: "complete", targetRaw: 5n, coveredRaw: 5n });
  });

  it("rejects events after the ledger snapshot before allocation or episode selection", () => {
    const ledger = runChronologicalProportionalLedgerV1({
      subjectAddress,
      ...ledgerSnapshot,
      historyCompleteness: "genesis_complete",
      openingBalanceRaw: 0n,
      events: [ledgerEvent({
        canonicalEventId: "after-snapshot",
        blockNumber: ledgerSnapshot.snapshotBlockNumber + 1,
        fromAddress: "funder",
        toAddress: subjectAddress,
        amountRaw: 10n
      })]
    });

    expect(ledger).toMatchObject({
      state: "unresolved",
      reason: "snapshot_inconsistent",
      authoritative: false,
      totalIncomingRaw: 0n,
      remainingRaw: 0n
    });
    expect(selectLedgerProvenanceV1({
      ledger,
      purpose: "current_balance",
      snapshotBalanceWitness: balanceWitness(10n)
    })).toMatchObject({ state: "unresolved", reason: "snapshot_inconsistent" });
    expect(selectLedgerProvenanceV1({
      ledger,
      purpose: "exact_episode",
      exactEventId: "receipt:tx:after-snapshot:0"
    })).toMatchObject({ state: "unresolved", reason: "snapshot_inconsistent" });
  });

  it("does not make exact episode selection depend on a current live balance", () => {
    const ledger = runChronologicalProportionalLedgerV1({
      subjectAddress,
      ...ledgerSnapshot,
      historyCompleteness: "genesis_complete",
      openingBalanceRaw: 0n,
      events: zeroOpeningEvents
    });
    const selection = selectLedgerProvenanceV1({
      ledger,
      purpose: "exact_episode",
      exactEventId: "receipt:tx:out-180:0",
      snapshotBalanceWitness: balanceWitness(999n, {
        pinned: false,
        independent: false,
        subjectAddress: "other-subject",
        snapshotBlockNumber: 999,
        snapshotBlockHash: "other-hash",
        evidenceRef: ""
      })
    });

    expect(selection).toMatchObject({ state: "complete", targetRaw: 180n, coveredRaw: 180n });
  });

  it("retains an exact-red contributor below the ordinary 95 percent cutoff", () => {
    const ledger = runChronologicalProportionalLedgerV1({
      subjectAddress,
      ...ledgerSnapshot,
      historyCompleteness: "genesis_complete",
      openingBalanceRaw: 0n,
      events: [
        ledgerEvent({ canonicalEventId: "lot-94", blockNumber: 1, fromAddress: "ordinary-a", toAddress: subjectAddress, amountRaw: 94n }),
        ledgerEvent({ canonicalEventId: "lot-5", blockNumber: 2, fromAddress: "ordinary-b", toAddress: subjectAddress, amountRaw: 5n }),
        ledgerEvent({ canonicalEventId: "lot-red-1", blockNumber: 3, fromAddress: "red", toAddress: subjectAddress, amountRaw: 1n })
      ]
    });
    const selection = selectLedgerProvenanceV1({
      ledger,
      purpose: "current_balance",
      snapshotBalanceWitness: balanceWitness(100n),
      exactRedContributorLotIds: ["receipt:tx:lot-red-1:0"]
    });

    expect(selection.deepSelectedLotIds).toEqual([
      "receipt:tx:lot-94:0",
      "receipt:tx:lot-5:0",
      "receipt:tx:lot-red-1:0"
    ]);
  });

  it("conserves integer value across deterministic replay cases", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const incomingA = BigInt(seed * 3 + 1);
      const incomingB = BigInt(seed * 2 + 3);
      const outgoing = BigInt(seed % Number(incomingA + incomingB));
      const result = runChronologicalProportionalLedgerV1({
        subjectAddress,
        ...ledgerSnapshot,
        historyCompleteness: "genesis_complete",
        openingBalanceRaw: 0n,
        events: [
          ledgerEvent({ canonicalEventId: `a-${seed}`, blockNumber: 1, fromAddress: "a", toAddress: subjectAddress, amountRaw: incomingA }),
          ledgerEvent({ canonicalEventId: `b-${seed}`, blockNumber: 2, fromAddress: "b", toAddress: subjectAddress, amountRaw: incomingB }),
          ledgerEvent({ canonicalEventId: `out-${seed}`, blockNumber: 3, fromAddress: subjectAddress, toAddress: "recipient", amountRaw: outgoing })
        ]
      });

      expect(result.state).toBe("complete");
      expect(result.totalIncomingRaw).toBe(result.totalOutgoingRaw + result.remainingRaw);
      expect(result.consumptionVectors.flatMap((item) => item.allocations)
        .every((item) => item.amountRaw >= 0n)).toBe(true);
    }
  });
});

function exactDrainerScene(
  overrides: Partial<ExactDrainerSceneInputV1> = {}
): ExactDrainerSceneInputV1 {
  const call = {
    txHash: "scene-drain-tx",
    contractAddress: "scene-spender",
    selector: "5082dd12",
    tokenContract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    fromAddress: "scene-victim",
    toAddress: "scene-receiver",
    receiverAddress: "scene-receiver",
    amountRaw: "669000000",
    confirmed: true,
    successful: true
  };
  return {
    methodContractAddress: "scene-spender",
    methodMap: completeFingerprintMethods,
    topMethods: [],
    serviceLabel: null,
    relevantCall: call,
    movement: {
      txHash: call.txHash,
      tokenContract: call.tokenContract,
      fromAddress: call.fromAddress,
      toAddress: call.toAddress,
      amountRaw: call.amountRaw,
      confirmed: true,
      successful: true
    },
    ...overrides
  };
}

const officialUsdt = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const canonicalHash = (hex: string) => hex.repeat(64);

function blacklistEvent(overrides: Record<string, unknown> = {}) {
  return {
    eventKind: "added",
    occurredAt: "2026-01-02T00:00:00.000Z",
    txHash: canonicalHash("a"),
    tokenContract: officialUsdt,
    subjectAddress: "listed",
    logIndex: 0,
    confirmed: true,
    successful: true,
    ...overrides
  };
}

function blacklistTransfer(overrides: Record<string, unknown> = {}) {
  return {
    txHash: canonicalHash("b"),
    logIndex: 0,
    occurredAt: "2026-01-03T00:00:00.000Z",
    tokenContract: officialUsdt,
    fromAddress: "subject",
    toAddress: "listed",
    amountRaw: "1",
    confirmed: true,
    successful: true,
    ...overrides
  };
}

function minimalReplayCorpus(
  overrides: Partial<OfflineCorpusV1> = {}
): OfflineCorpusV1 {
  return {
    schemaVersion: "forensic-model-offline-corpus-v1",
    ledgerCases: [],
    serviceCases: [],
    adverseCases: [],
    ...overrides
  };
}

describe("offline forensic model replay v1", () => {
  it("requires the full unblocked fingerprint and one exact successful movement", () => {
    expect(evaluateExactDrainerSceneV1(exactDrainerScene())).toEqual({
      classification: "exact_drainer_red",
      red: true,
      reason: "exact_call_and_movement_confirmed"
    });

    const methodOnly = exactDrainerScene({ relevantCall: null, movement: null });
    expect(evaluateExactDrainerSceneV1(methodOnly)).toMatchObject({
      classification: "context_only",
      red: false,
      reason: "exact_call_missing"
    });
    expect(evaluateExactDrainerSceneV1(exactDrainerScene({
      relevantCall: { ...exactDrainerScene().relevantCall!, successful: false }
    }))).toMatchObject({ red: false, reason: "exact_call_not_successful" });
    expect(evaluateExactDrainerSceneV1(exactDrainerScene({
      relevantCall: { ...exactDrainerScene().relevantCall!, confirmed: false }
    }))).toMatchObject({ red: false, reason: "exact_call_not_confirmed" });
    expect(evaluateExactDrainerSceneV1(exactDrainerScene({
      movement: { ...exactDrainerScene().movement!, amountRaw: "669000001" }
    }))).toMatchObject({ red: false, reason: "movement_mismatch" });
    const otherToken = "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj";
    expect(evaluateExactDrainerSceneV1(exactDrainerScene({
      relevantCall: { ...exactDrainerScene().relevantCall!, tokenContract: otherToken },
      movement: { ...exactDrainerScene().movement!, tokenContract: otherToken }
    }))).toMatchObject({ red: false, reason: "token_not_official_usdt" });
    expect(evaluateExactDrainerSceneV1(exactDrainerScene({
      serviceLabel: "trusted exact service"
    }))).toMatchObject({ red: false, reason: "trusted_service_guard" });

    expect(JSON.stringify(evaluateExactDrainerSceneV1(exactDrainerScene())))
      .not.toMatch(/Verify20|transferFrom/u);
  });

  it("validates raw amounts before fingerprint and trusted-service early returns", () => {
    expect(() => evaluateExactDrainerSceneV1(exactDrainerScene({
      methodMap: {},
      relevantCall: { ...exactDrainerScene().relevantCall!, amountRaw: "01" }
    }))).toThrow("offline_corpus_amount_raw_invalid");
    expect(() => evaluateExactDrainerSceneV1(exactDrainerScene({
      serviceLabel: "trusted exact service",
      movement: { ...exactDrainerScene().movement!, amountRaw: "01" }
    }))).toThrow("offline_corpus_amount_raw_invalid");
  });

  it("reuses event-time provider authority and keeps HTX role plus adverse semantics", () => {
    const result = replayOfflineForensicModelCorpusV1(corpus as OfflineCorpusV1);
    const binance = result.adverseCases.find(({ id }) => id === "exact-binance-label");
    const htx = result.adverseCases.find(({ id }) => id === "exact-htx-label");

    expect(binance).toMatchObject({
      evidenceClass: "exact_frozen_rows",
      kind: "service_label",
      serviceRole: "cex:binance",
      inferredClassifierBypassed: true,
      adverse: false,
      atValidityStart: "eligible",
      beforeValidityStart: "label_not_valid_at_event"
    });
    expect(htx).toMatchObject({
      evidenceClass: "exact_frozen_rows",
      kind: "service_label",
      serviceRole: "cex:htx-huobi",
      inferredClassifierBypassed: true,
      adverse: true,
      atValidityStart: "eligible",
      beforeValidityStart: "label_not_valid_at_event"
    });
  });

  it("keeps blacklist time partitions and GasFree principal separate from its fee", () => {
    const result = replayOfflineForensicModelCorpusV1(corpus as OfflineCorpusV1);
    const blacklist = result.adverseCases.find(({ id }) => id === "event-time-blacklist-partitions");
    const gasFree = result.adverseCases.find(({ id }) => id === "gasfree-principal-fee-classification");

    expect(blacklist).toMatchObject({
      kind: "blacklist_timeline",
      beforeEventAmountRaw: "900000",
      beforeActivationAmountRaw: "900000",
      activeAtEventAmountRaw: "100000",
      unknownAmountRaw: "50000",
      hardEvidenceAmountRaw: "100000",
      partitions: {
        before_event: "900000",
        active_at_event: "100000",
        unknown: "50000"
      }
    });
    expect(gasFree).toMatchObject({
      kind: "gasfree_settlement",
      settlementDetected: true,
      ledgerExecuted: false,
      principalAmountRaw: "4691000000",
      serviceFeeAmountRaw: "1500000",
      principalRole: "aml_money_path",
      serviceFeeRole: "accounting_only_consumption",
      principalFeatureEligible: true,
      serviceFeeFeatureEligible: false,
      principalCounterparties: [{
        address: "TMwjbNHpsVSjn93vtWtLnThHwhAJAnrWNq",
        direction: "outbound",
        amountRaw: "4691000000"
      }]
    });
  });

  it("partitions grouped same-transaction timestamp conflicts as unknown once", () => {
    const result = replayOfflineForensicModelCorpusV1(minimalReplayCorpus({
      adverseCases: [{
        id: "event-time-blacklist-partitions",
        evidenceClass: "synthetic_edge_case",
        subjectAddress: "subject",
        listedAddress: "listed",
        principalTransfers: [
          {
            ...blacklistTransfer(),
            txHash: canonicalHash("1"),
            logIndex: 0,
            occurredAt: "2026-01-01T00:00:00.000Z",
            amountRaw: "40"
          },
          {
            ...blacklistTransfer(),
            txHash: canonicalHash("1"),
            logIndex: 1,
            occurredAt: "2026-01-03T00:00:00.000Z",
            amountRaw: "60"
          }
        ],
        timelineEvents: [blacklistEvent()]
      }]
    }));

    expect(result.adverseCases[0]).toMatchObject({
      beforeEventAmountRaw: "0",
      activeAtEventAmountRaw: "0",
      unknownAmountRaw: "100",
      partitions: { before_event: "0", active_at_event: "0", unknown: "100" }
    });
  });

  it("restores grouped blacklist times by counterparty and direction identity", () => {
    const activeAt = "2026-01-03T00:00:00.000Z";
    const result = replayOfflineForensicModelCorpusV1(minimalReplayCorpus({
      adverseCases: [{
        id: "event-time-blacklist-partitions",
        evidenceClass: "synthetic_edge_case",
        subjectAddress: "subject",
        principalTransfers: [
          {
            ...blacklistTransfer(),
            txHash: canonicalHash("2"),
            logIndex: 0,
            occurredAt: "2026-01-01T00:00:00.000Z",
            toAddress: "counterparty-b",
            amountRaw: "10"
          },
          {
            ...blacklistTransfer(),
            txHash: canonicalHash("2"),
            logIndex: 1,
            occurredAt: activeAt,
            toAddress: "counterparty-b",
            amountRaw: "10"
          },
          ...[2, 3, 4].map((logIndex) => ({
            ...blacklistTransfer(),
            txHash: canonicalHash("2"),
            logIndex,
            occurredAt: activeAt,
            fromAddress: "counterparty-a",
            toAddress: "subject",
            amountRaw: "10"
          }))
        ],
        listedAddress: "counterparty-a",
        timelineEvents: [blacklistEvent({ subjectAddress: "counterparty-a" })]
      }]
    }));

    expect(result.adverseCases[0]).toMatchObject({
      beforeEventAmountRaw: "0",
      activeAtEventAmountRaw: "30",
      unknownAmountRaw: "0",
      unmatchedCounterpartyAmountRaw: "20",
      partitions: { before_event: "0", active_at_event: "30", unknown: "0" }
    });
  });

  it("binds mixed-direction blacklist replay to the explicit subject under permutation", () => {
    const transfers = [
      {
        ...blacklistTransfer(),
        txHash: canonicalHash("3"),
        logIndex: 0,
        occurredAt: "2026-01-03T00:00:00.000Z",
        fromAddress: "subject",
        toAddress: "listed",
        amountRaw: "30"
      },
      {
        ...blacklistTransfer(),
        txHash: canonicalHash("4"),
        logIndex: 0,
        occurredAt: "2026-01-01T00:00:00.000Z",
        fromAddress: "listed",
        toAddress: "subject",
        amountRaw: "20"
      }
    ];
    const replay = (principalTransfers: typeof transfers) =>
      replayOfflineForensicModelCorpusV1(minimalReplayCorpus({
        adverseCases: [{
          id: "event-time-blacklist-partitions",
          evidenceClass: "synthetic_edge_case",
          subjectAddress: "subject",
          listedAddress: "listed",
          principalTransfers,
          timelineEvents: [blacklistEvent()]
        }]
      })).adverseCases[0];

    const expected = {
      beforeEventAmountRaw: "20",
      activeAtEventAmountRaw: "30",
      unknownAmountRaw: "0",
      partitions: { before_event: "20", active_at_event: "30", unknown: "0" }
    };
    expect(replay(transfers)).toMatchObject(expected);
    expect(replay([...transfers].reverse())).toEqual(replay(transfers));
  });

  it.each([
    ["missing subject", { subjectAddress: undefined }],
    ["blank subject", { subjectAddress: "   " }],
    ["subject equals listed", { subjectAddress: "listed" }],
    ["subject on neither endpoint", {
      principalTransfers: [{
        ...blacklistTransfer(),
        txHash: canonicalHash("5"),
        logIndex: 0,
        occurredAt: "2026-01-03T00:00:00.000Z",
        fromAddress: "outside-a",
        toAddress: "outside-b",
        amountRaw: "1"
      }]
    }],
    ["subject on both endpoints", {
      principalTransfers: [{
        ...blacklistTransfer(),
        txHash: canonicalHash("6"),
        logIndex: 0,
        occurredAt: "2026-01-03T00:00:00.000Z",
        fromAddress: "subject",
        toAddress: "subject",
        amountRaw: "1"
      }]
    }]
  ] as const)("rejects %s blacklist subject binding", (_name, overrides) => {
    expect(() => replayOfflineForensicModelCorpusV1(minimalReplayCorpus({
      adverseCases: [{
        id: "event-time-blacklist-partitions",
        evidenceClass: "synthetic_edge_case",
        subjectAddress: "subject",
        listedAddress: "listed",
        principalTransfers: [{
          ...blacklistTransfer()
        }],
        timelineEvents: [],
        ...overrides
      }]
    }))).toThrow("offline_corpus_blacklist_subject_invalid");
  });

  it("represents every broad direct counterparty in both directions and retains second-hop red", () => {
    const result = replayOfflineForensicModelCorpusV1(minimalReplayCorpus({
      broadScopeCases: [{
        id: "broad-synthetic",
        evidenceClass: "synthetic_edge_case",
        subjectAddress: "subject",
        directEdges: [
          { id: "in-a", txHash: "in-a", direction: "inbound", counterpartyAddress: "a", amountRaw: "7", occurredAt: "2026-01-01T00:00:00.000Z" },
          { id: "out-a", txHash: "out-a", direction: "outbound", counterpartyAddress: "a", amountRaw: "5", occurredAt: "2026-01-01T00:00:01.000Z" },
          { id: "in-b", txHash: "in-b", direction: "inbound", counterpartyAddress: "b", amountRaw: "3", occurredAt: "2026-01-01T00:00:02.000Z" },
          { id: "out-b", txHash: "out-b", direction: "outbound", counterpartyAddress: "b", amountRaw: "2", occurredAt: "2026-01-01T00:00:03.000Z" }
        ],
        secondHopRedBranches: [{
          branchId: "red-b-c",
          directCounterpartyAddress: "b",
          secondHopAddress: "c",
          evidenceId: "exact-red-c",
          amountRaw: "1"
        }]
      }]
    }));

    expect(result.broadScopeCases).toEqual([{
      id: "broad-synthetic",
      evidenceClass: "synthetic_edge_case",
      shallowProbe: [
        { address: "a", directions: ["inbound", "outbound"], amountRaw: "12" },
        { address: "b", directions: ["inbound", "outbound"], amountRaw: "5" }
      ],
      secondHopRedBranches: [{
        branchId: "red-b-c",
        directCounterpartyAddress: "b",
        secondHopAddress: "c",
        evidenceId: "exact-red-c",
        amountRaw: "1"
      }]
    }]);
  });

  it("retains a red contributor outside the ordinary 95 percent selection", () => {
    const input = minimalReplayCorpus({
      ledgerCases: [{
        id: "red-below-95",
        evidenceClass: "synthetic_edge_case",
        replayInput: {
          subjectAddress: "subject",
          snapshotBlockNumber: 10,
          snapshotBlockHash: "snapshot",
          snapshotEvidenceRef: "synthetic",
          historyCompleteness: "genesis_complete",
          openingBalanceRaw: "0",
          events: [
            ["in-90", "funder-90", "90000000", 1],
            ["in-5", "funder-5", "5000000", 2],
            ["in-4", "funder-4", "4000000", 3],
            ["in-red", "funder-red", "1000000", 4]
          ].map(([eventId, sourceAddress, amountRaw, blockNumber]) => ({
            canonicalEventId: null,
            providerEventIds: [eventId],
            txHash: eventId,
            blockNumber,
            transactionIndex: 0,
            eventIndex: 0,
            eventIndexAuthority: "receipt_log_index",
            occurredAtMs: Number(blockNumber) * 1_000,
            fromAddress: sourceAddress,
            toAddress: "subject",
            amountRaw
          }))
        },
        query: {
          purpose: "current_balance",
          snapshotBalanceWitness: {
            amountRaw: "100000000",
            pinned: true,
            independent: true,
            subjectAddress: "subject",
            snapshotBlockNumber: 10,
            snapshotBlockHash: "snapshot",
            evidenceRef: "synthetic-balance"
          },
          exactRedContributorLotIds: ["receipt:in-red:0"]
        }
      }]
    });
    const [replay] = replayOfflineForensicModelCorpusV1(input).ledgerCases;

    expect(replay).toMatchObject({
      state: "complete",
      targetRaw: "100000000",
      coveredRaw: "100000000"
    });
    expect(replay?.deepSelectedLotIds).toContain("receipt:in-red:0");
  });

  it("returns JSON-safe corpus facts without upgrading recorded evidence", () => {
    const result = replayOfflineForensicModelCorpusV1(corpus as OfflineCorpusV1);
    expect(result.schemaVersion).toBe("offline-forensic-model-replay-v1");
    expect(result.ledgerCases).toHaveLength(corpus.ledgerCases.length);
    expect(result.serviceCases).toHaveLength(corpus.serviceCases.length);
    expect(result.adverseCases).toHaveLength(corpus.adverseCases.length);
    expect(result.serviceCases.find(({ id }) => id === "w8srl-two-window-calibration"))
      .toMatchObject({ evidenceClass: "recorded_calibration_vector", replayAuthority: "recorded_vector" });
    expect(result.serviceCases.find(({ id }) => id === "tqr-d7nzp-recorded-control"))
      .toMatchObject({ evidenceClass: "recorded_calibration_vector", state: "expectation_level" });
    expect(result.serviceCases.find(({ id }) => id === "txc-vusxvhd-recorded-control"))
      .toMatchObject({ evidenceClass: "recorded_calibration_vector", state: "insufficient_data" });
    expect(result.adverseCases.find(({ id }) => id === "drainer-method-only"))
      .toMatchObject({ kind: "drainer_scene", red: false, reason: "fingerprint_incomplete" });
    expect(result.adverseCases.find(({ id }) => id === "drainer-complete-evidence"))
      .toMatchObject({
        kind: "drainer_scene",
        classification: "exact_drainer_red",
        red: true,
        reason: "exact_call_and_movement_confirmed"
      });
    expect(result.dataGaps).toEqual(expect.arrayContaining([
      { caseId: "pacgy-recorded-chronology", code: "history_incomplete" },
      { caseId: "tqr-d7nzp-recorded-control", code: "recorded_partial_vector" },
      { caseId: "txc-vusxvhd-recorded-control", code: "insufficient_service_windows" }
    ]));
    expect(result.dataGaps).not.toContainEqual({
      caseId: "drainer-complete-evidence",
      code: "verify20_fingerprint_incomplete"
    });
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(JSON.stringify(result)).not.toMatch(/\d+n\b/u);
  });

  it.each([
    ["non-canonical hash", { txHash: "not-a-hash" }],
    ["wrong token", { tokenContract: "other-token" }],
    ["wrong listed subject", { subjectAddress: "other-listed" }],
    ["unconfirmed", { confirmed: false }],
    ["unsuccessful", { successful: false }]
  ])("fails closed on %s blacklist timeline evidence", (_name, eventOverrides) => {
    expect(() => replayOfflineForensicModelCorpusV1(minimalReplayCorpus({
      adverseCases: [{
        id: "event-time-blacklist-partitions",
        evidenceClass: "synthetic_edge_case",
        subjectAddress: "subject",
        listedAddress: "listed",
        principalTransfers: [blacklistTransfer()],
        timelineEvents: [blacklistEvent(eventOverrides)]
      }]
    }))).toThrow("offline_corpus_blacklist_timeline_invalid");
  });

  it("preserves authoritative blacklist identity and applies it only to the listed group", () => {
    const event = blacklistEvent({ blockNumber: 99, logIndex: 7 });
    const result = replayOfflineForensicModelCorpusV1(minimalReplayCorpus({
      adverseCases: [{
        id: "event-time-blacklist-partitions",
        evidenceClass: "synthetic_edge_case",
        subjectAddress: "subject",
        listedAddress: "listed",
        principalTransfers: [
          blacklistTransfer({ amountRaw: "30" }),
          blacklistTransfer({ txHash: canonicalHash("c"), toAddress: "unrelated", amountRaw: "20" })
        ],
        timelineEvents: [event]
      }]
    })).adverseCases[0];

    expect(result).toMatchObject({
      activeAtEventAmountRaw: "30",
      unmatchedCounterpartyAmountRaw: "20",
      timelineEvents: [{
        txHash: canonicalHash("a"),
        logIndex: 7,
        blockNumber: 99,
        tokenContract: officialUsdt,
        occurredAt: "2026-01-02T00:00:00.000Z"
      }]
    });
  });

  it("deduplicates case-insensitive raw identities and keeps missing-time replay permutation-stable", () => {
    const duplicate = blacklistTransfer({ txHash: canonicalHash("d"), amountRaw: "7" });
    const missing = blacklistTransfer({ txHash: canonicalHash("e"), occurredAt: null, amountRaw: "5" });
    const replay = (principalTransfers: readonly Record<string, unknown>[]) =>
      replayOfflineForensicModelCorpusV1(minimalReplayCorpus({
        adverseCases: [{
          id: "event-time-blacklist-partitions",
          evidenceClass: "synthetic_edge_case",
          subjectAddress: "subject",
          listedAddress: "listed",
          principalTransfers,
          timelineEvents: [blacklistEvent()]
        }]
      })).adverseCases[0];
    const transfers = [duplicate, { ...duplicate, txHash: canonicalHash("D") }, missing];

    expect(replay(transfers)).toMatchObject({ activeAtEventAmountRaw: "7", unknownAmountRaw: "5" });
    expect(replay([...transfers].reverse())).toEqual(replay(transfers));
  });

  it("fails closed on conflicting transfer and timeline identities", () => {
    const replay = (principalTransfers: readonly Record<string, unknown>[], timelineEvents: readonly Record<string, unknown>[]) =>
      replayOfflineForensicModelCorpusV1(minimalReplayCorpus({
        adverseCases: [{
          id: "event-time-blacklist-partitions",
          evidenceClass: "synthetic_edge_case",
          subjectAddress: "subject",
          listedAddress: "listed",
          principalTransfers,
          timelineEvents
        }]
      }));
    const transfer = blacklistTransfer();
    expect(() => replay([transfer, { ...transfer, amountRaw: "2" }], [blacklistEvent()]))
      .toThrow("offline_corpus_blacklist_identity_invalid");
    const event = blacklistEvent();
    expect(() => replay([transfer], [event, { ...event, eventKind: "removed" }]))
      .toThrow("offline_corpus_blacklist_timeline_invalid");
  });

  it("keeps wall-clock ties at blacklist addition and removal unresolved", () => {
    const result = replayOfflineForensicModelCorpusV1(minimalReplayCorpus({
      adverseCases: [{
        id: "event-time-blacklist-partitions",
        evidenceClass: "synthetic_edge_case",
        subjectAddress: "subject",
        listedAddress: "listed",
        principalTransfers: [
          blacklistTransfer({
            txHash: canonicalHash("1"),
            occurredAt: "2026-01-01T00:00:00.000Z",
            amountRaw: "1"
          }),
          blacklistTransfer({
            txHash: canonicalHash("2"),
            occurredAt: "2026-01-02T00:00:00.000Z",
            amountRaw: "2"
          }),
          blacklistTransfer({
            txHash: canonicalHash("3"),
            occurredAt: "2026-01-03T00:00:00.000Z",
            amountRaw: "3"
          })
        ],
        timelineEvents: [
          blacklistEvent(),
          blacklistEvent({
            eventKind: "removed",
            txHash: canonicalHash("f"),
            occurredAt: "2026-01-03T00:00:00.000Z"
          })
        ]
      }]
    })).adverseCases[0];

    expect(result).toMatchObject({
      beforeEventAmountRaw: "1",
      activeAtEventAmountRaw: "0",
      unknownAmountRaw: "5",
      hardEvidenceAmountRaw: "0"
    });
  });

  it("fails repeated blacklist lifecycles closed without promoting transfers", () => {
    const result = replayOfflineForensicModelCorpusV1(minimalReplayCorpus({
      adverseCases: [{
        id: "event-time-blacklist-partitions",
        evidenceClass: "synthetic_edge_case",
        subjectAddress: "subject",
        listedAddress: "listed",
        principalTransfers: [blacklistTransfer({ amountRaw: "9" })],
        timelineEvents: [
          blacklistEvent(),
          blacklistEvent({ txHash: canonicalHash("f"), occurredAt: "2026-01-02T01:00:00.000Z" })
        ]
      }]
    })).adverseCases[0];

    expect(result).toMatchObject({
      beforeEventAmountRaw: "0",
      activeAtEventAmountRaw: "0",
      unknownAmountRaw: "9",
      hardEvidenceAmountRaw: "0"
    });
  });

  it("fails a canonically non-ordered blacklist lifecycle closed", () => {
    const result = replayOfflineForensicModelCorpusV1(minimalReplayCorpus({
      adverseCases: [{
        id: "event-time-blacklist-partitions",
        evidenceClass: "synthetic_edge_case",
        subjectAddress: "subject",
        listedAddress: "listed",
        principalTransfers: [blacklistTransfer({
          occurredAt: "2026-01-02T12:00:00.000Z",
          amountRaw: "9"
        })],
        timelineEvents: [
          blacklistEvent({ blockNumber: 20 }),
          blacklistEvent({
            eventKind: "removed",
            txHash: canonicalHash("f"),
            blockNumber: 10,
            occurredAt: "2026-01-03T00:00:00.000Z"
          })
        ]
      }]
    })).adverseCases[0];

    expect(result).toMatchObject({ activeAtEventAmountRaw: "0", unknownAmountRaw: "9" });
  });

  it("binds GasFree replay edges by exact role and movement, independent of row order", () => {
    const base = structuredClone(corpus) as unknown as OfflineCorpusV1;
    const gasFree = (base.adverseCases as unknown as Record<string, unknown>[])
      .find(({ id }) => id === "gasfree-principal-fee-classification")!;
    const replayEdges = gasFree.replayEdges as Record<string, unknown>[];
    gasFree.replayEdges = [...replayEdges].reverse();
    const permuted = replayOfflineForensicModelCorpusV1(base).adverseCases
      .find(({ id }) => id === "gasfree-principal-fee-classification");
    const canonical = replayOfflineForensicModelCorpusV1(corpus as OfflineCorpusV1).adverseCases
      .find(({ id }) => id === "gasfree-principal-fee-classification");
    expect(permuted).toEqual(canonical);

    const tampered = structuredClone(base);
    const tamperedCase = (tampered.adverseCases as unknown as Record<string, unknown>[])
      .find(({ id }) => id === "gasfree-principal-fee-classification")!;
    (tamperedCase.replayEdges as Record<string, unknown>[])[0]!.amountRaw = "1";
    expect(() => replayOfflineForensicModelCorpusV1(tampered))
      .toThrow("offline_corpus_gasfree_edges_invalid");
  });

  it("requires the drainer call contract to match the fingerprinted contract", () => {
    expect(evaluateExactDrainerSceneV1(exactDrainerScene({
      relevantCall: { ...exactDrainerScene().relevantCall!, contractAddress: "other-spender" }
    }))).toMatchObject({ red: false, reason: "spender_contract_mismatch" });
    const tronAddress = "TCLgK89AnXbC9rewvhNb9UgXCc2qJJpBXh";
    expect(evaluateExactDrainerSceneV1(exactDrainerScene({
      methodContractAddress: tronAddress,
      relevantCall: {
        ...exactDrainerScene().relevantCall!,
        contractAddress: `t${tronAddress.slice(1)}`
      }
    }))).toMatchObject({ red: false, reason: "spender_contract_mismatch" });
  });

  it.each([
    ["label created later", { observedVector: { observedEndTimestamp: "2026-07-19T00:00:00.000Z" } }],
    ["missing anchor", {}]
  ])("does not bypass service inference for %s", (_name, serviceFields) => {
    const exactLabel = corpus.adverseCases.find(({ id }) => id === "exact-binance-label")!;
    const result = replayOfflineForensicModelCorpusV1(minimalReplayCorpus({
      serviceCases: [{
        id: "service-time-authority",
        evidenceClass: "recorded_calibration_vector",
        address: "TCLgK89AnXbC9rewvhNb9UgXCc2qJJpBXh",
        ...serviceFields
      }],
      adverseCases: [exactLabel as OfflineCorpusV1["adverseCases"][number]]
    })).serviceCases[0];

    expect(result).not.toMatchObject({ state: "exact_service_role" });
  });

  it("derives exact-role conflicts independent of row order and ignores an unproved flag", () => {
    const binance = structuredClone(corpus.adverseCases.find(({ id }) => id === "exact-binance-label")!) as Record<string, unknown>;
    const htx = structuredClone(corpus.adverseCases.find(({ id }) => id === "exact-htx-label")!) as Record<string, unknown>;
    const address = ((binance.frozenRow as Record<string, unknown>).address as string);
    (htx.frozenRow as Record<string, unknown>).address = address;
    const service = {
      id: "derived-role-conflict",
      evidenceClass: "recorded_calibration_vector" as const,
      address,
      anchorTimestamp: "2026-07-26T00:00:00.000Z",
      exactRoleConflict: false
    };
    const replay = (adverseCases: readonly Record<string, unknown>[]) =>
      replayOfflineForensicModelCorpusV1(minimalReplayCorpus({
        serviceCases: [service],
        adverseCases: adverseCases as unknown as OfflineCorpusV1["adverseCases"]
      }));
    const forward = replay([binance, htx]);
    const reverse = replay([htx, binance]);

    expect(forward.serviceCases[0]).toMatchObject({
      state: "role_conflict",
      exactRoleResolution: "role_conflict",
      inferredClassifierBypassed: false
    });
    expect(reverse.serviceCases).toEqual(forward.serviceCases);
    expect(reverse.dataGaps).toEqual(forward.dataGaps);

    const oneRole = replayOfflineForensicModelCorpusV1(minimalReplayCorpus({
      serviceCases: [{ ...service, id: "unproved-role-conflict", exactRoleConflict: true }],
      adverseCases: [binance as OfflineCorpusV1["adverseCases"][number]]
    }));
    expect(oneRole.serviceCases[0]).toMatchObject({ state: "exact_service_role" });
  });

  it.each([
    ["synthetic evidence", (item: Record<string, unknown>) => { item.evidenceClass = "synthetic_edge_case"; }],
    ["missing raw ref", (item: Record<string, unknown>) => { delete item.rawEvidenceRef; }],
    ["wrong authority", (item: Record<string, unknown>) => {
      (item.frozenRow as Record<string, unknown>).authority = "claimed";
    }],
    ["wrong category", (item: Record<string, unknown>) => {
      (item.frozenRow as Record<string, unknown>).category = "unknown";
    }],
    ["invalid validity", (item: Record<string, unknown>) => {
      (item.frozenRow as Record<string, unknown>).validTo = "2026-07-20T08:05:34.930Z";
    }]
  ])("does not manufacture exact provider authority from %s", (_name, mutate) => {
    const label = structuredClone(corpus.adverseCases.find(({ id }) => id === "exact-binance-label")!) as Record<string, unknown>;
    mutate(label);
    const result = replayOfflineForensicModelCorpusV1(minimalReplayCorpus({
      serviceCases: [{
        id: "provider-authority-consumer",
        evidenceClass: "recorded_calibration_vector",
        address: "TCLgK89AnXbC9rewvhNb9UgXCc2qJJpBXh",
        anchorTimestamp: "2026-07-26T00:00:00.000Z"
      }],
      adverseCases: [label as OfflineCorpusV1["adverseCases"][number]]
    }));

    expect(result.adverseCases[0]).toMatchObject({ authoritative: false });
    expect(result.serviceCases[0]).not.toMatchObject({ state: "exact_service_role" });
    expect(result.dataGaps).toContainEqual({
      caseId: "exact-binance-label",
      code: "provider_label_authority_missing"
    });
  });

  it("rejects conflicting normalized method selectors independent of row order", () => {
    const scene = structuredClone(corpus.adverseCases
      .find(({ id }) => id === "drainer-complete-evidence")!) as Record<string, unknown>;
    const methods = (scene.methodEvidence as Record<string, unknown>).methodMap as Record<string, unknown>[];
    methods.push({ selector: "0X5082DD12", signature: "evil(address)" });
    const replay = () => replayOfflineForensicModelCorpusV1(minimalReplayCorpus({
      adverseCases: [scene as OfflineCorpusV1["adverseCases"][number]]
    }));

    expect(replay).toThrow("offline_corpus_drainer_method_map_conflict");
    methods.reverse();
    expect(replay).toThrow("offline_corpus_drainer_method_map_conflict");
    methods[0] = { selector: "5082dd1", signature: "evil(address)" };
    expect(replay).toThrow("offline_corpus_drainer_invalid");
  });

  it("rejects duplicate IDs, unknown adverse IDs, and unbound broad red branches", () => {
    expect(() => replayOfflineForensicModelCorpusV1(minimalReplayCorpus({
      ledgerCases: [{ id: "duplicate", evidenceClass: "synthetic_edge_case" }],
      serviceCases: [{ id: "duplicate", evidenceClass: "synthetic_edge_case" }]
    }))).toThrow("offline_corpus_duplicate_case_id");
    expect(() => replayOfflineForensicModelCorpusV1(minimalReplayCorpus({
      adverseCases: [{ id: "gasfree-principle-fee-classification", evidenceClass: "synthetic_edge_case" }]
    }))).toThrow("offline_corpus_adverse_case_unknown");
    expect(() => replayOfflineForensicModelCorpusV1(minimalReplayCorpus({
      broadScopeCases: [{
        id: "unbound-red",
        evidenceClass: "synthetic_edge_case",
        subjectAddress: "subject",
        directEdges: [],
        secondHopRedBranches: [{
          branchId: "red",
          directCounterpartyAddress: "missing",
          secondHopAddress: "red-address",
          evidenceId: "evidence",
          amountRaw: "1"
        }]
      }]
    }))).toThrow("offline_corpus_broad_red_branch_unbound");
  });

  it("rejects internally inconsistent recorded service vectors", () => {
    const serviceCase = structuredClone(corpus.serviceCases
      .find(({ id }) => id === "w8srl-two-window-calibration")!) as Record<string, unknown>;
    const firstWindow = (serviceCase.windows as Record<string, unknown>[])[0]!;
    const predicate = firstWindow.recordedPredicate as Record<string, boolean>;
    predicate.C = !predicate.C;
    predicate.P = predicate.C && predicate.B && predicate.G &&
      (predicate.H || predicate.R || predicate.X);

    expect(() => replayOfflineForensicModelCorpusV1(minimalReplayCorpus({
      serviceCases: [serviceCase as OfflineCorpusV1["serviceCases"][number]]
    }))).toThrow("offline_corpus_service_vector_invalid");
    const exactService = structuredClone(corpus.serviceCases
      .find(({ id }) => id === "csv-JJpBXh")!) as Record<string, unknown>;
    const exactPredicate = (exactService.observedVector as Record<string, unknown>)
      .recordedPredicate as Record<string, boolean>;
    exactPredicate.B = !exactPredicate.B;
    exactPredicate.P = exactPredicate.C && exactPredicate.B && exactPredicate.G &&
      (exactPredicate.H || exactPredicate.R || exactPredicate.X);
    expect(() => replayOfflineForensicModelCorpusV1(minimalReplayCorpus({
      serviceCases: [exactService as OfflineCorpusV1["serviceCases"][number]],
      adverseCases: [corpus.adverseCases.find(({ id }) => id === "exact-binance-label") as
        OfflineCorpusV1["adverseCases"][number]]
    }))).toThrow("offline_corpus_service_vector_invalid");
    expect(() => replayOfflineForensicModelCorpusV1(minimalReplayCorpus({
      serviceCases: [{
        id: "one-window-only",
        evidenceClass: "recorded_calibration_vector",
        windows: [{}]
      }]
    }))).toThrow("offline_corpus_service_vector_invalid");
  });

  it("reports a data gap when an exact service role lacks an event anchor", () => {
    const exactLabel = corpus.adverseCases.find(({ id }) => id === "exact-binance-label")!;
    const result = replayOfflineForensicModelCorpusV1(minimalReplayCorpus({
      serviceCases: [{
        id: "missing-service-anchor",
        evidenceClass: "recorded_calibration_vector",
        address: "TCLgK89AnXbC9rewvhNb9UgXCc2qJJpBXh"
      }],
      adverseCases: [exactLabel as OfflineCorpusV1["adverseCases"][number]]
    }));

    expect(result.dataGaps).toContainEqual({
      caseId: "missing-service-anchor",
      code: "exact_service_role_anchor_missing"
    });
  });

  it("derives data gaps from replay evidence instead of case IDs", () => {
    const completeLedger = {
      id: "pacgy-recorded-chronology",
      evidenceClass: "synthetic_edge_case" as const,
      replayInput: {
        subjectAddress: "subject",
        snapshotBlockNumber: 1,
        snapshotBlockHash: "snapshot",
        snapshotEvidenceRef: "synthetic",
        historyCompleteness: "genesis_complete",
        openingBalanceRaw: "0",
        events: []
      },
      query: { purpose: "amount_only", requestedAmountRaw: "0" }
    };
    const completeService = structuredClone(corpus.serviceCases
      .find(({ id }) => id === "w8srl-two-window-calibration")!) as Record<string, unknown>;
    completeService.id = "tqr-d7nzp-recorded-control";
    completeService.evidenceClass = "exact_frozen_rows";
    completeService.rawProviderPagesFrozen = true;
    const result = replayOfflineForensicModelCorpusV1(minimalReplayCorpus({
      ledgerCases: [completeLedger as OfflineCorpusV1["ledgerCases"][number]],
      serviceCases: [completeService as OfflineCorpusV1["serviceCases"][number]]
    }));

    expect(result.dataGaps).toEqual([]);
  });

  it("projects declared second-hop fields and remains JSON-safe with unknown bigint input", () => {
    const result = replayOfflineForensicModelCorpusV1(minimalReplayCorpus({
      broadScopeCases: [{
        id: "projected-red",
        evidenceClass: "synthetic_edge_case",
        subjectAddress: "subject",
        directEdges: [{
          id: "direct",
          txHash: "direct",
          direction: "outbound",
          counterpartyAddress: "listed",
          amountRaw: "1",
          occurredAt: "2026-01-01T00:00:00.000Z"
        }],
        secondHopRedBranches: [{
          branchId: "red",
          directCounterpartyAddress: "listed",
          secondHopAddress: "red-address",
          evidenceId: "evidence",
          amountRaw: "1",
          extra: { unsafe: 1n }
        } as never]
      }]
    }));

    expect(result.broadScopeCases[0]?.secondHopRedBranches).toEqual([{
      branchId: "red",
      directCounterpartyAddress: "listed",
      secondHopAddress: "red-address",
      evidenceId: "evidence",
      amountRaw: "1"
    }]);
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("rejects an unknown schema and non-canonical raw amount at the replay boundary", () => {
    expect(() => replayOfflineForensicModelCorpusV1({
      ...minimalReplayCorpus(),
      schemaVersion: "wrong"
    } as OfflineCorpusV1)).toThrow("offline_corpus_schema_invalid");
    expect(() => replayOfflineForensicModelCorpusV1(minimalReplayCorpus({
      ledgerCases: [{
        id: "bad-amount",
        evidenceClass: "synthetic_edge_case",
        amountRaw: "01"
      }]
    }))).toThrow("offline_corpus_amount_raw_invalid");
  });
});
