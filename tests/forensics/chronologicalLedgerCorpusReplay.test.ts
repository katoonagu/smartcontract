import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { replayChronologicalLedgerCorpusV1 } from "../../src/forensics/chronologicalLedgerCorpusReplay.js";
import { loadForensicModelOfflineCorpusV1 } from "../fixtures/forensics/loadForensicModelCorpus.js";

const EXPECTED_CASE_IDS = [
  "debit-over-inventory-control",
  "exact-self-transfer-control",
  "identity-collision-control",
  "integer-remainder-control",
  "missing-order-control",
  "pacgy-recorded-chronology",
  "pacgy-synthetic-zero-opening-control"
] as const;

const EXPECTED_ACTUALS = {
  "debit-over-inventory-control": {
    state: "unresolved",
    reason: "outgoing_exceeds_reconstructed_inventory",
    authoritative: false,
    targetRaw: "0",
    coveredRaw: "0",
    allocations: []
  },
  "exact-self-transfer-control": {
    state: "complete",
    reason: null,
    authoritative: true,
    targetRaw: "10",
    coveredRaw: "10",
    allocations: [{
      lotId: "receipt:in-10:0",
      sourceEventId: "receipt:in-10:0",
      sourceAddress: "funder",
      usedAmountRaw: "10",
      sourceOriginalRaw: "10"
    }]
  },
  "identity-collision-control": {
    state: "unresolved",
    reason: "canonical_event_identity_unresolved",
    authoritative: false,
    targetRaw: "0",
    coveredRaw: "0",
    allocations: []
  },
  "integer-remainder-control": {
    state: "complete",
    reason: null,
    authoritative: true,
    targetRaw: "2",
    coveredRaw: "2",
    allocations: [{
      lotId: "receipt:in-a:0",
      sourceEventId: "receipt:in-a:0",
      sourceAddress: "a",
      usedAmountRaw: "1",
      sourceOriginalRaw: "1"
    }, {
      lotId: "receipt:in-b:0",
      sourceEventId: "receipt:in-b:0",
      sourceAddress: "b",
      usedAmountRaw: "1",
      sourceOriginalRaw: "2"
    }]
  },
  "missing-order-control": {
    state: "unresolved",
    reason: "temporal_order_unresolved",
    authoritative: false,
    targetRaw: "0",
    coveredRaw: "0",
    allocations: []
  },
  "pacgy-recorded-chronology": {
    state: "unresolved",
    reason: "history_incomplete_before_anchor",
    authoritative: false,
    targetRaw: "0",
    coveredRaw: "0",
    allocations: []
  },
  "pacgy-synthetic-zero-opening-control": {
    state: "complete",
    reason: null,
    authoritative: true,
    targetRaw: "180000000",
    coveredRaw: "180000000",
    allocations: [{
      lotId: "receipt:in-300:0",
      sourceEventId: "receipt:in-300:0",
      sourceAddress: "old",
      usedAmountRaw: "180000000",
      sourceOriginalRaw: "300000000"
    }]
  }
} as const;

describe("chronological ledger corpus replay v1", () => {
  it("executes exactly the seven frozen ledger cases", () => {
    const replay = replayChronologicalLedgerCorpusV1(loadForensicModelOfflineCorpusV1());

    expect(replay.caseResults.map(({ caseId }) => caseId).sort()).toEqual(EXPECTED_CASE_IDS);
    expect(replay.caseResults).toHaveLength(7);
    expect(replay.mismatches).toEqual([]);
    expect(Object.fromEntries(replay.caseResults.map(({ caseId, actual }) => [caseId, actual])))
      .toEqual(EXPECTED_ACTUALS);
  });

  it("keeps real PacGy recorded and unresolved while synthetic arithmetic stays separate", () => {
    const corpus = loadForensicModelOfflineCorpusV1();
    const real = corpus.ledgerCases.find(({ id }) => id === "pacgy-recorded-chronology");
    const synthetic = corpus.ledgerCases.find(
      ({ id }) => id === "pacgy-synthetic-zero-opening-control"
    );
    const replay = replayChronologicalLedgerCorpusV1(corpus);

    expect(real).toMatchObject({
      evidenceClass: "recorded_calibration_vector",
      replayInput: { historyCompleteness: "partial", events: [] },
      recordedNonAuthoritativeCalibration: {
        targetRaw: "180000000",
        coveredRaw: "180000000",
        sourceOriginalRaw: "300000000",
        sourceUtilizedRaw: "180000000"
      }
    });
    expect(synthetic).toMatchObject({ evidenceClass: "synthetic_edge_case" });
    expect(replay.caseResults.find(({ caseId }) => caseId === real?.id)?.actual)
      .toEqual(EXPECTED_ACTUALS["pacgy-recorded-chronology"]);
  });

  it("reports invalid and mismatched frozen ledger expectations distinctly", () => {
    const corpus = loadForensicModelOfflineCorpusV1();
    const invalid = structuredClone(corpus) as typeof corpus & {
      ledgerCases: Array<Record<string, unknown>>;
    };
    invalid.ledgerCases[0]!.expectedActual = { state: "complete" };
    expect(replayChronologicalLedgerCorpusV1(invalid).mismatches).toContainEqual({
      caseId: invalid.ledgerCases[0]!.id,
      code: "ledger_expectation_invalid"
    });

    const unequal = structuredClone(corpus) as typeof corpus & {
      ledgerCases: Array<Record<string, unknown>>;
    };
    const expected = unequal.ledgerCases[0]!.expectedActual as Record<string, unknown>;
    expected.coveredRaw = "1";
    expect(replayChronologicalLedgerCorpusV1(unequal).mismatches).toContainEqual({
      caseId: unequal.ledgerCases[0]!.id,
      code: "ledger_expectation_mismatch"
    });
  });

  it("runs the ledger-only CLI as a 7/7 gate and rejects unknown groups", () => {
    const success = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "scripts/replayForensicModelCorpus.ts",
      "--group",
      "ledger"
    ], { cwd: process.cwd(), encoding: "utf8" });
    expect(success.status).toBe(0);
    expect(success.stderr).toBe("");
    const report = JSON.parse(success.stdout) as {
      matched: boolean;
      expectationMismatches: unknown[];
      result: { ledgerCases: unknown[] };
    };
    expect(report.matched).toBe(true);
    expect(report.expectationMismatches).toEqual([]);
    expect(report.result.ledgerCases).toHaveLength(7);

    const invalid = spawnSync(process.execPath, [
      "--import",
      "tsx",
      "scripts/replayForensicModelCorpus.ts",
      "--group",
      "unknown"
    ], { cwd: process.cwd(), encoding: "utf8" });
    expect(invalid.status).toBe(2);
    expect(invalid.stderr).toContain("forensic_replay_group_invalid");
  });
});
