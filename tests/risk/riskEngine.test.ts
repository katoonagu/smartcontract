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

  it("does not let trusted or false positive labels suppress critical internal risk labels", () => {
    const report = calculateRisk({
      subjectAddress: "TSubject111111111111111111111111111111",
      labels: [
        {
          address: "TSubject111111111111111111111111111111",
          label: "scam",
          source: "service_admin",
          createdByTelegramId: "1",
          createdAt: new Date()
        },
        {
          address: "TSubject111111111111111111111111111111",
          label: "false_positive",
          source: "service_admin",
          createdByTelegramId: "2",
          createdAt: new Date()
        }
      ],
      graphSignals: [],
      behaviorSignals: [],
      amlSignals: []
    });

    expect(report.level).toBe("CRITICAL");
    expect(report.score).toBe(90);
    expect(report.reasons.map((reason) => reason.code)).toEqual(["internal_label_scam"]);
  });

  it("lets trusted labels mitigate non-critical signals", () => {
    const report = calculateRisk({
      subjectAddress: "TSubject111111111111111111111111111111",
      labels: [
        {
          address: "TSubject111111111111111111111111111111",
          label: "trusted",
          source: "service_admin",
          createdByTelegramId: "1",
          createdAt: new Date()
        }
      ],
      graphSignals: [{ code: "risky_1_hop", message: "1-hop connection to risky address", scoreImpact: 35 }],
      behaviorSignals: [],
      amlSignals: []
    });

    expect(report.level).toBe("LOW");
    expect(report.score).toBe(0);
  });

  it("sanitizes invalid and excessive external score impacts", () => {
    const report = calculateRisk({
      subjectAddress: "TSubject111111111111111111111111111111",
      labels: [],
      graphSignals: [{ code: "invalid", message: "Invalid provider score", scoreImpact: Number.NaN }],
      behaviorSignals: [{ code: "huge", message: "Huge provider score", scoreImpact: 999 }],
      amlSignals: [{ code: "negative", message: "Negative provider score", scoreImpact: -999 }]
    });

    expect(report.score).toBe(50);
    expect(report.level).toBe("MEDIUM");
    expect(report.reasons.map((reason) => reason.code)).toEqual(["huge"]);
  });

  it("sorts reasons by score impact descending", () => {
    const report = calculateRisk({
      subjectAddress: "TSubject111111111111111111111111111111",
      labels: [],
      graphSignals: [{ code: "small", message: "Small signal", scoreImpact: 5 }],
      behaviorSignals: [{ code: "large", message: "Large signal", scoreImpact: 45 }],
      amlSignals: [{ code: "medium", message: "Medium signal", scoreImpact: 20 }]
    });

    expect(report.reasons.map((reason) => reason.code)).toEqual(["large", "medium", "small"]);
  });
});
