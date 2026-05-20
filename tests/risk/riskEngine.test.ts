import { describe, expect, it } from "vitest";
import { calculateRisk } from "../../src/risk/riskEngine";

describe("calculateRisk", () => {
  it("returns LOW when no risk signals exist", () => {
    const report = calculateRisk({
      subjectAddress: "TSubject111111111111111111111111111111",
      labels: [],
      graphSignals: [],
      behaviorSignals: [],
      amlSignals: []
    });

    expect(report.level).toBe("LOW");
    expect(report.score).toBe(0);
    expect(report.reasons).toEqual([]);
  });

  it("returns CRITICAL for internal scam labels", () => {
    const report = calculateRisk({
      subjectAddress: "TSubject111111111111111111111111111111",
      labels: [
        {
          address: "TSubject111111111111111111111111111111",
          label: "scam",
          source: "service_admin",
          createdByTelegramId: "1",
          createdAt: new Date()
        }
      ],
      graphSignals: [],
      behaviorSignals: [],
      amlSignals: []
    });

    expect(report.level).toBe("CRITICAL");
    expect(report.score).toBeGreaterThanOrEqual(90);
    expect(report.reasons[0].code).toBe("internal_label_scam");
  });

  it("combines graph and behavior signals into HIGH", () => {
    const report = calculateRisk({
      subjectAddress: "TSubject111111111111111111111111111111",
      labels: [],
      graphSignals: [{ code: "risky_1_hop", message: "1-hop connection to risky address", scoreImpact: 35 }],
      behaviorSignals: [{ code: "split_pattern", message: "Repeated split transfers detected", scoreImpact: 30 }],
      amlSignals: []
    });

    expect(report.level).toBe("HIGH");
    expect(report.score).toBe(65);
    expect(report.reasons.map((reason) => reason.code)).toEqual(["risky_1_hop", "split_pattern"]);
  });
});
