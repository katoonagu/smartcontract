import { describe, expect, it } from "vitest";
import type { AddressLabel } from "../../src/types";
import { CURRENT_RISK_POLICY_VERSION, evaluateAddressRisk } from "../../src/risk/evaluation";

const subjectAddress = "TSubject111111111111111111111111111111";
const labelDate = new Date("2026-05-21T00:00:00.000Z");

function label(input: Partial<AddressLabel> = {}): AddressLabel {
  return {
    address: subjectAddress,
    label: "scam",
    source: "service_admin",
    createdByTelegramId: "9001",
    createdAt: labelDate,
    ...input
  };
}

describe("evaluateAddressRisk", () => {
  it("creates raw evidence and an observation for a service-admin scam label", () => {
    const evaluation = evaluateAddressRisk({
      context: { subjectAddress, observedTransactionHash: "tx-1" },
      labels: [label()]
    });

    expect(evaluation.report.level).toBe("CRITICAL");
    expect(evaluation.report.reasons[0]).toMatchObject({
      code: "internal_label_scam",
      source: "service_admin",
      confidence: "high",
      severity: "critical"
    });
    expect(evaluation.rawEvidence).toEqual([
      expect.objectContaining({
        source: "service_admin",
        sourceType: "internal_label",
        chain: "tron",
        address: subjectAddress,
        observedTransactionHash: "tx-1",
        evidenceJson: expect.objectContaining({ label: "scam", createdByTelegramId: "9001" })
      })
    ]);
    expect(evaluation.observations).toEqual([
      expect.objectContaining({
        subjectChain: "tron",
        subjectAddress,
        observedTransactionHash: "tx-1",
        signalGroup: "internal_label",
        code: "internal_label_scam",
        scoreImpact: 90,
        policyVersion: CURRENT_RISK_POLICY_VERSION,
        rawEvidenceId: evaluation.rawEvidence[0].id
      })
    ]);
  });

  it("stores trusted label mitigation as an observation while final score stays at zero", () => {
    const evaluation = evaluateAddressRisk({
      context: { subjectAddress },
      labels: [label({ label: "trusted" })],
      graphSignals: [{ code: "weak_graph", message: "Weak graph exposure", scoreImpact: 20, source: "graph_v0" }]
    });

    expect(evaluation.report.score).toBe(0);
    expect(evaluation.observations.map((observation) => observation.code)).toEqual(["weak_graph", "internal_label_trusted"]);
    expect(evaluation.observations.find((observation) => observation.code === "internal_label_trusted")).toMatchObject({
      scoreImpact: -40,
      severity: "info"
    });
  });

  it("stores system-derived darknet exchange proximity as high-confidence high-severity label evidence", () => {
    const evaluation = evaluateAddressRisk({
      context: { subjectAddress },
      labels: [
        label({
          label: "darknet_exchange_proximity" as any,
          source: "system",
          createdByTelegramId: null
        })
      ]
    });

    expect(evaluation.report).toMatchObject({
      level: "HIGH",
      score: 60
    });
    expect(evaluation.report.reasons[0]).toMatchObject({
      code: "internal_label_darknet_exchange_proximity",
      confidence: "high",
      severity: "high"
    });
    expect(evaluation.observations[0]).toMatchObject({
      code: "internal_label_darknet_exchange_proximity",
      scoreImpact: 60,
      confidence: "high",
      severity: "high",
      source: "system"
    });
  });

  it("stores system-derived approval-drain proximity as high-confidence high-severity label evidence", () => {
    const evaluation = evaluateAddressRisk({
      context: { subjectAddress },
      labels: [
        label({
          label: "approval_drain_proximity",
          source: "system",
          createdByTelegramId: null
        })
      ]
    });

    expect(evaluation.report).toMatchObject({
      level: "HIGH",
      score: 80
    });
    expect(evaluation.report.reasons[0]).toMatchObject({
      code: "internal_label_approval_drain_proximity",
      confidence: "high",
      severity: "high"
    });
    expect(evaluation.observations[0]).toMatchObject({
      code: "internal_label_approval_drain_proximity",
      scoreImpact: 80,
      confidence: "high",
      severity: "high",
      source: "system"
    });
  });

  it("stores manual WhiteBIT labels as critical exact internal evidence", () => {
    const evaluation = evaluateAddressRisk({
      context: { subjectAddress },
      labels: [
        label({
          label: "whitebit",
          source: "service_admin",
          createdByTelegramId: "9001"
        })
      ]
    });

    expect(evaluation.report).toMatchObject({
      level: "CRITICAL",
      score: 90
    });
    expect(evaluation.report.reasons[0]).toMatchObject({
      code: "internal_label_whitebit",
      confidence: "high",
      severity: "critical"
    });
    expect(evaluation.observations[0]).toMatchObject({
      code: "internal_label_whitebit",
      scoreImpact: 90,
      confidence: "high",
      severity: "critical",
      source: "service_admin"
    });
  });

  it("represents behavior signal metadata as a behavior observation", () => {
    const evaluation = evaluateAddressRisk({
      context: { subjectAddress, policyVersion: "test-policy" },
      labels: [],
      behaviorSignals: [
        {
          code: "fast_transit",
          message: "Fast transit pattern detected",
          scoreImpact: 30,
          source: "behavior_detector_v0",
          confidence: "medium",
          severity: "high",
          evidenceRef: "evidence-fast-transit"
        }
      ]
    });

    expect(evaluation.observations).toEqual([
      expect.objectContaining({
        signalGroup: "behavior",
        code: "fast_transit",
        source: "behavior_detector_v0",
        confidence: "medium",
        severity: "high",
        policyVersion: "test-policy",
        rawEvidenceId: "evidence-fast-transit"
      })
    ]);
  });

  it("generates stable ids for the same evidence input", () => {
    const first = evaluateAddressRisk({ context: { subjectAddress }, labels: [label()] });
    const second = evaluateAddressRisk({ context: { subjectAddress }, labels: [label()] });

    expect(second.rawEvidence[0].id).toBe(first.rawEvidence[0].id);
    expect(second.observations[0].id).toBe(first.observations[0].id);
  });
});
