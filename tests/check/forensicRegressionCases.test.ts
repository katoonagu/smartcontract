import { describe, expect, it } from "vitest";
import { runWhereIsMoneyCheck } from "../../src/check/whereIsMoneyCheck";
import type { ForensicRouteEdge, RiskReport } from "../../src/types";
import {
  type OperationalLiquidityWhereIsMoneyCase,
  operationalLiquidityWhereIsMoneyCases,
  type SerializedForensicRouteEdge,
  regressionCases
} from "../fixtures/forensics/regressionCases";

function fixtureEdgesByAddress(caseItem: OperationalLiquidityWhereIsMoneyCase): Map<string, ForensicRouteEdge[]> {
  const entries = Object.entries(caseItem.edgesByAddress) as Array<[string, SerializedForensicRouteEdge[]]>;
  return new Map(entries.map(([address, edges]) => [
    address,
    edges.map((edge) => ({
      ...edge,
      amountRaw: (BigInt(edge.amountRaw) * 20n).toString(),
      timestamp: new Date(edge.timestamp)
    }))
  ]));
}

function lowFastWalletRisk(subjectAddress: string): RiskReport {
  return {
    subjectAddress,
    level: "LOW",
    score: 0,
    reasons: []
  };
}

describe("forensic regression corpus", () => {
  it("contains the minimum architecture regression cases", () => {
    expect(regressionCases.map((item) => item.name)).toEqual([
      "Binance through clean EOA is acceptable",
      "HTX through clean EOA is high policy decline",
      "WhiteBIT small share is medium policy decline",
      "Unknown contract hop continues to the final Binance boundary",
      "Known DEX router approval with output is guarded, not drainer proof",
      "Wrapper transferFrom path to checked wallet is exact approval-drain decline",
      "LLM timeout on uncertain contract is user decline with no cache",
      "Fingerprint clone with different flow does not reuse drainer verdict"
    ]);
  });

  it.each(operationalLiquidityWhereIsMoneyCases)(
    "keeps $name calibrated as ordinary operational liquidity",
    async (caseItem) => {
      const edgesByAddress = fixtureEdgesByAddress(caseItem);
      const report = await runWhereIsMoneyCheck({
        getTrc20Balance: async () => caseItem.balanceRaw,
        fetchEdgesForAddress: async (address) => edgesByAddress.get(address) ?? [],
        getLabelsForAddress: async () => [],
        getClassificationForAddress: async () => null,
        getFastWalletRisk: async () => lowFastWalletRisk(caseItem.subjectAddress)
      }, {
        sourceAddress: caseItem.subjectAddress,
        windowStart: new Date(caseItem.windowStart),
        windowEnd: new Date(caseItem.windowEnd)
      });

      expect(report.userDecision ?? report.decision).toBe(caseItem.expectedDecision);
      expect(report.assessment.riskBand).toBe(caseItem.expectedRiskBand);
      expect(report.proofLevel).toBe("operational_liquidity_context");
      expect(report.assessment.walletRole).toBe(caseItem.expectedWalletRole);
      expect(report.assessment.hardBadEvidence).toEqual([]);
      expect(report.riskScore).toBeGreaterThanOrEqual(25);
      expect(report.riskScore).toBeLessThanOrEqual(40);
      expect(report.coverage.selectedInboundTxCount).toBe(caseItem.expectedSelectedInboundTxCount);
      expect(report.coverage.provenanceScope).toBe("recent_flow");
      expect(report.coverage.currentBalanceCoverageRatio).toBe(0);
      expect(report.coverage.coverageRatio).toBe(1);
      expect(report.coverage.dataScopeNote).toContain("Low-balance recent-flow mode");
      expect(report.coverage.notes.join(" ")).toContain("Recent-flow approximation");
      expect(report.coverage.notes.join(" ")).toContain("current balance is low");
      expect(report.originPaths).toHaveLength(caseItem.expectedSelectedInboundTxCount);
      expect(report.originPaths.every((path) => path.verdict === "REVIEW")).toBe(true);
      expect(report.originPaths.every((path) => path.rootSourceType === "incomplete")).toBe(true);
      expect(report.originPaths.every((path) =>
        path.stoppedReason === "weak_amount_or_time_continuity" ||
        path.stoppedReason === "no_previous_transfer" ||
        path.stoppedReason === "pre_existing_balance_possible"
      )).toBe(true);
      expect(Math.max(...report.originPaths.map((path) => path.riskScoreContribution))).toBeLessThanOrEqual(35);
      expect(report.senderInteractionProfiles).toHaveLength(caseItem.expectedSelectedInboundTxCount);
      expect(report.assessment.operationalLiquidityScore).toBeGreaterThanOrEqual(caseItem.expectedMinOperationalLiquidityScore);
      expect(report.assessment.reasons.join(" ")).toContain("operational/liquidity wallet");
      expect(report.assessment.warnings.join(" ")).toContain("Recent-flow coverage is wallet-flow context, not current-balance provenance.");
    }
  );
});
