import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseGoldenCaseCatalogV2,
  parseGoldenProtocolV2,
  parseSyntheticCasesV2
} from "../../tools/golden-pilot-v2/contracts";

const projectRoot = join(import.meta.dirname, "..", "..");
const controlRoot = join(
  projectRoot,
  "docs",
  "audit",
  "2026-07-system-audit",
  "golden-v2"
);

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

describe("Golden V2 strict contracts", () => {
  it("parses the locked protocol and exact case groups", async () => {
    const protocol = parseGoldenProtocolV2(
      await json(join(controlRoot, "protocol.json"))
    );
    const catalog = parseGoldenCaseCatalogV2(
      await json(join(controlRoot, "case-catalog.json"))
    );

    expect(catalog.groups.map((group) => group.kind)).toEqual([
      "blind_review",
      "regression",
      "synthetic_property_performance"
    ]);
    expect(
      catalog.groups.find((group) => group.kind === "regression")?.caseIds
    ).toEqual(["regression-tbl7", "regression-tqr"]);
    expect(protocol.attributionCandidates).toEqual([
      "fifo",
      "lifo",
      "proportional"
    ]);
    expect(protocol.exactScoresAllowedBeforeAdjudication).toBe(false);
  });

  it("rejects unknown keys, duplicate IDs and pre-adjudication answers", () => {
    const descriptor = {
      caseId: "case-one",
      group: "blind_review",
      subjectAddress: "T9yD14Nj9j7xAB4dbGeiX9h8unkKLxmGkn",
      sourceArtifact: "frozen/case-one.json",
      requiredProperties: ["scope_wallet"]
    };
    const catalog = {
      version: "golden-case-catalog-v2",
      groups: [
        { kind: "blind_review", caseIds: ["case-one"] },
        { kind: "regression", caseIds: [] },
        { kind: "synthetic_property_performance", caseIds: [] }
      ],
      cases: [descriptor]
    };

    expect(() =>
      parseGoldenCaseCatalogV2({
        ...catalog,
        cases: [{ ...descriptor, expectedScore: 12 }]
      })
    ).toThrow("golden_unknown_key:expectedScore");
    expect(() =>
      parseGoldenCaseCatalogV2({
        ...catalog,
        cases: [{ ...descriptor, decision: "ACCEPTABLE" }]
      })
    ).toThrow("golden_unknown_key:decision");
    expect(() =>
      parseGoldenCaseCatalogV2({
        ...catalog,
        groups: [
          { kind: "blind_review", caseIds: ["case-one", "case-one"] },
          { kind: "regression", caseIds: [] },
          { kind: "synthetic_property_performance", caseIds: [] }
        ]
      })
    ).toThrow("golden_duplicate_case_id:case-one");
    expect(() =>
      parseGoldenCaseCatalogV2({
        ...catalog,
        cases: [{ ...descriptor, subjectAddress: "T-not-a-tron-address" }]
      })
    ).toThrow("golden_invalid_tron_address");
    expect(() =>
      parseGoldenCaseCatalogV2({
        ...catalog,
        cases: [{ ...descriptor, requiredProperties: ["made_up_property"] }]
      })
    ).toThrow("golden_unknown_required_property:made_up_property");
  });

  it("rejects non-canonical raw amounts, timestamps and tx hashes", async () => {
    const fixturePath = join(
      projectRoot,
      "tests",
      "fixtures",
      "golden-v2",
      "synthetic-cases.json"
    );
    const fixture = (await json(fixturePath)) as {
      cases: Array<Record<string, unknown>>;
    };
    expect(parseSyntheticCasesV2(fixture).cases.length).toBeGreaterThan(10);

    const first = fixture.cases[0]!;
    expect(() =>
      parseSyntheticCasesV2({
        ...fixture,
        cases: [{ ...first, amountRaw: "1.5" }, ...fixture.cases.slice(1)]
      })
    ).toThrow("golden_invalid_decimal_string");
    expect(() =>
      parseSyntheticCasesV2({
        ...fixture,
        cases: [
          { ...first, timestamp: "2026-07-23 00:00:00" },
          ...fixture.cases.slice(1)
        ]
      })
    ).toThrow("golden_invalid_iso_utc_timestamp");
    expect(() =>
      parseSyntheticCasesV2({
        ...fixture,
        cases: [
          { ...first, timestamp: "2026-02-30T00:00:00.000Z" },
          ...fixture.cases.slice(1)
        ]
      })
    ).toThrow("golden_invalid_iso_utc_timestamp");
    expect(() =>
      parseSyntheticCasesV2({
        ...fixture,
        cases: [
          { ...first, txHash: "A".repeat(64) },
          ...fixture.cases.slice(1)
        ]
      })
    ).toThrow("golden_invalid_lowercase_tx_hash");
  });
});
