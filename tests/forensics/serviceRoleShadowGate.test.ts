import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { replayServiceRoleShadowGateV1 } from "../../src/forensics/serviceRoleShadowGate.js";

const corpus = JSON.parse(readFileSync(
  new URL("../fixtures/forensics/forensic-model-offline-corpus-v1.json", import.meta.url), "utf8"
));
const reconstructionFixture = JSON.parse(readFileSync(
  new URL("../fixtures/forensics/service-role-shadow-reconstruction-v1.json", import.meta.url), "utf8"
));

describe("Stage C service-role shadow admission gate", () => {
  it("emits the exact typed receipt with honest evidence limitations", () => {
    const receipt = replayServiceRoleShadowGateV1({ corpus, reconstructedFixture: reconstructionFixture });

    expect(receipt).toMatchObject({
      schemaVersion: "service-role-shadow-gate-v1",
      service: { numerator: 24, denominator: 24 },
      adverse: { numerator: 6, denominator: 6 },
      reconstructedAcceptedHistories: 1,
      mismatches: []
    });
    expect(receipt.cases).toHaveLength(30);
    expect(new Set(receipt.cases.map(({ id }) => id)).size).toBe(30);
    expect(receipt.cases.find(({ id }) => id === "w8srl-two-window-calibration")).toMatchObject({
      evaluation: "recorded_vector_replay",
      evidenceLimitations: expect.arrayContaining(["recorded_calibration_vector_not_raw_pages"])
    });
    expect(receipt.cases.find(({ id }) => id === "tqr-d7nzp-recorded-control")).toMatchObject({
      evaluation: "sparse_guard_replay",
      evidenceLimitations: expect.arrayContaining(["checked_subject_guard_only"])
    });
    expect(receipt.cases.find(({ id }) => id === "txc-vusxvhd-recorded-control")).toMatchObject({
      evaluation: "partial_observation_replay",
      evidenceLimitations: expect.arrayContaining(["partial_73_rows_not_two_windows"])
    });
    for (const id of ["csv-q98cdn", "csv-aEGqTr", "csv-H14eaf"]) {
      expect(receipt.cases.find((item) => item.id === id)).toMatchObject({
        evaluation: "expectation_integrity_only",
        evidenceLimitations: expect.arrayContaining(["whole_export_not_real_100_plus_100_windows"])
      });
    }
    expect(receipt.cases.filter(({ evaluation }) => evaluation === "expectation_integrity_only")).toHaveLength(20);
    for (const id of ["exact-binance-label", "exact-htx-label"]) {
      expect(receipt.cases.find((item) => item.id === id)).toMatchObject({
        evaluation: "exact_assertion_replay",
        evidenceLimitations: expect.arrayContaining(["offline_only_no_runtime_eligibility"])
      });
    }
    expect(receipt.cases.filter(({ suite }) => suite === "adverse")).toHaveLength(6);
    expect(receipt.cases.every(({ evidenceLimitations }) => evidenceLimitations.length > 0)).toBe(true);
  });

  it("turns red when accepted reconstruction bindings or case identity are tampered", () => {
    const variants = [
      { ...reconstructionFixture, sourceSha256: "0".repeat(64) },
      { ...reconstructionFixture, eventSpec: { ...reconstructionFixture.eventSpec, anchorSeconds: 1 } },
      { ...reconstructionFixture, eventSpec: { ...reconstructionFixture.eventSpec, authority: "unbound" } },
      { ...reconstructionFixture, caseId: "duplicate-case" }
    ];

    for (const fixture of variants) {
      const receipt = replayServiceRoleShadowGateV1({ corpus, reconstructedFixture: fixture });
      expect(receipt.mismatches.length).toBeGreaterThan(0);
    }
  });

  it("uses the pure reconstruction adapter rather than duplicating its classifier", () => {
    const source = readFileSync(new URL("../../src/forensics/serviceRoleShadowGate.ts", import.meta.url), "utf8");
    expect(source).toContain('from "../unifiedCheck/serviceRoleShadow"');
    expect(source).not.toContain('from "./serviceBehaviorResearch"');
  });
});
