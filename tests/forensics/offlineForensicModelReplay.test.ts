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
    }
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
});
