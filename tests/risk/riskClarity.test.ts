import { describe, expect, it } from "vitest";
import {
  buildRiskClaritySummary,
  riskClarityLevelFromScore,
  type RiskClarityInput
} from "../../src/risk/riskClarity";

function baseInput(overrides: Partial<RiskClarityInput> = {}): RiskClarityInput {
  return {
    kind: "address_deep_check",
    executionStatus: "completed",
    finalRiskScore: 70,
    explicitDecision: "DECLINE",
    missingChecks: [],
    coveragePartial: false,
    fetchedAddressCount: 8,
    hardEvidenceObserved: false,
    evidenceHints: ["service exposure profile"],
    ...overrides
  };
}

describe("risk clarity summary", () => {
  it("uses unified wallet risk thresholds", () => {
    expect(riskClarityLevelFromScore(null)).toBeNull();
    expect(riskClarityLevelFromScore(29)).toBe("LOW");
    expect(riskClarityLevelFromScore(30)).toBe("MEDIUM");
    expect(riskClarityLevelFromScore(60)).toBe("HIGH");
    expect(riskClarityLevelFromScore(85)).toBe("CRITICAL");
  });

  it("keeps completed execution separate from partial coverage", () => {
    const clarity = buildRiskClaritySummary(baseInput({
      missingChecks: ["provider timeout"],
      coveragePartial: false
    }));

    expect(clarity.executionStatus).toBe("completed");
    expect(clarity.coverageStatus).toBe("partial");
    expect(clarity.coverageScore).toBe(70);
    expect(clarity.limitations).toContain("provider timeout");
  });

  it("marks sparse provenance as limited without changing job execution status", () => {
    const clarity = buildRiskClaritySummary(baseInput({
      kind: "where_is_money_check",
      fetchedAddressCount: 1,
      coveragePartial: true,
      missingChecks: []
    }));

    expect(clarity.executionStatus).toBe("completed");
    expect(clarity.coverageStatus).toBe("limited");
    expect(clarity.coverageScore).toBe(45);
  });

  it("explains high contextual risk without hard evidence", () => {
    const clarity = buildRiskClaritySummary(baseInput({
      finalRiskScore: 72,
      hardEvidenceObserved: false,
      evidenceHints: ["counterparty context"]
    }));

    expect(clarity.decisionStatus).toBe("decline");
    expect(clarity.evidenceClass).toBe("contextual");
    expect(clarity.displayNotes).toContain("High contextual risk; no hard evidence observed.");
  });

  it("does not call an acceptable partial result clean", () => {
    const clarity = buildRiskClaritySummary(baseInput({
      finalRiskScore: 20,
      explicitDecision: "ACCEPTABLE",
      missingChecks: ["service boundary reached"]
    }));

    expect(clarity.decisionStatus).toBe("acceptable");
    expect(clarity.coverageStatus).toBe("partial");
    expect(clarity.displayNotes).toContain("No material risk found in available data; this is not a guarantee of clean history.");
  });
});
