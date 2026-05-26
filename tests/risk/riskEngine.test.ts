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

  it("returns CRITICAL for manually confirmed darknet exchange labels", () => {
    const report = calculateRisk({
      subjectAddress: "TYFkLfEzv5eYgAxANwdGd26KyQwRZYiqtV",
      labels: [
        {
          address: "TYFkLfEzv5eYgAxANwdGd26KyQwRZYiqtV",
          label: "darknet_exchange" as any,
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
    expect(report.reasons[0]).toMatchObject({
      code: "internal_label_darknet_exchange",
      message: "Internal label: darknet_exchange"
    });
  });

  it("returns HIGH for system-derived darknet exchange proximity labels", () => {
    const report = calculateRisk({
      subjectAddress: "TSubject111111111111111111111111111111",
      labels: [
        {
          address: "TSubject111111111111111111111111111111",
          label: "darknet_exchange_proximity" as any,
          source: "system",
          createdByTelegramId: null,
          createdAt: new Date()
        }
      ],
      graphSignals: [],
      behaviorSignals: [],
      amlSignals: []
    });

    expect(report.level).toBe("HIGH");
    expect(report.score).toBe(60);
    expect(report.reasons[0]).toMatchObject({
      code: "internal_label_darknet_exchange_proximity",
      message: "Derived high-risk marker: confirmed on-chain exposure to known darknet exchange seed within 2 hops.",
      scoreImpact: 60
    });
  });

  it("returns HIGH for system-derived approval-drain proximity labels", () => {
    const report = calculateRisk({
      subjectAddress: "TSubject111111111111111111111111111111",
      labels: [
        {
          address: "TSubject111111111111111111111111111111",
          label: "approval_drain_proximity",
          source: "system",
          createdByTelegramId: null,
          createdAt: new Date()
        }
      ],
      graphSignals: [],
      behaviorSignals: [],
      amlSignals: []
    });

    expect(report.level).toBe("HIGH");
    expect(report.score).toBe(80);
    expect(report.reasons[0]).toMatchObject({
      code: "internal_label_approval_drain_proximity",
      message: "Derived high-risk marker: exact upstream approval-drain provenance linked to this address."
    });
  });

  it("allows exact approval-drain provenance to keep its /100 score impact", () => {
    const report = calculateRisk({
      subjectAddress: "TSubject111111111111111111111111111111",
      labels: [],
      graphSignals: [
        {
          code: "forensic_approval_drain_provenance",
          message: "Funds are connected to an exact approval-drain flow within 2 hops.",
          scoreImpact: 80,
          source: "approval_drain_provenance",
          confidence: "high",
          severity: "high"
        }
      ],
      behaviorSignals: [],
      amlSignals: []
    });

    expect(report.score).toBe(80);
    expect(report.level).toBe("HIGH");
    expect(report.reasons[0]).toMatchObject({
      code: "forensic_approval_drain_provenance",
      scoreImpact: 80
    });
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
    expect(report.score).toBe(60);
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

    expect(report.score).toBe(20);
    expect(report.level).toBe("LOW");
    expect(report.reasons.map((reason) => reason.code)).toEqual(["huge"]);
  });

  it("allows exact stablecoin blacklist contract state to produce CRITICAL risk", () => {
    const report = calculateRisk({
      subjectAddress: "TSubject111111111111111111111111111111",
      labels: [],
      graphSignals: [],
      behaviorSignals: [],
      amlSignals: [
        {
          code: "stablecoin_usdt_blacklisted",
          message: "Official TRON USDT contract blacklist state is active for this address.",
          scoreImpact: 90,
          source: "stablecoin_contract",
          confidence: "high",
          severity: "critical"
        }
      ]
    });

    expect(report.score).toBe(90);
    expect(report.level).toBe("CRITICAL");
    expect(report.reasons[0]).toMatchObject({
      code: "stablecoin_usdt_blacklisted",
      scoreImpact: 90
    });
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

  it("preserves signal metadata in risk reasons", () => {
    const report = calculateRisk({
      subjectAddress: "TSubject111111111111111111111111111111",
      labels: [],
      graphSignals: [
        {
          code: "risky_1_hop",
          message: "1-hop exposure to risky address",
          scoreImpact: 35,
          source: "graph_v0",
          confidence: "medium",
          severity: "high",
          evidenceRef: "evidence-1"
        }
      ],
      behaviorSignals: [],
      amlSignals: []
    });

    expect(report.reasons[0]).toMatchObject({
      code: "risky_1_hop",
      source: "graph_v0",
      confidence: "medium",
      severity: "high",
      evidenceRef: "evidence-1"
    });
  });
});
