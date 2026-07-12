import { describe, expect, it } from "vitest";
import {
  adaptLegacyDeepCoverageV2,
  adaptLegacyIncomingCoverageV2,
  adaptLegacyWhereCoverageV2,
  buildForensicCoverageV2,
  validateForensicCoverageV2
} from "../../src/forensics/forensicCoverageV2";
import { buildIncomingDepositReport } from "../../src/forensics/incomingDepositJob";
import { runDeepAddressForensicCheck } from "../../src/check/deepForensicCheck";
import {
  deepCoverageDeps,
  deepCoverageInput,
  incomingCoverageFixture,
  legacyDeepReportWithoutCoverageV2,
  legacyIncomingReport
} from "../fixtures/forensics/remediationDataCases";

const canonicalInput = () => ({
  scope: "requested_amount" as const,
  availableInboundTxCount: 24,
  selectedInboundTxCount: 10,
  selectedAmountRaw: "1000000000",
  tracedAmountRaw: "830000000",
  exclusions: [{
    reason: "different_selected_scope" as const,
    direction: "incoming" as const,
    txCount: 14,
    amountRaw: null,
    evidenceIds: ["coverage:scope:14"]
  }],
  limitations: []
});

describe("ForensicCoverageV2", () => {
  it("[REQ-31][AC-13] persists available selected excluded and unresolved coverage", () => {
    expect(buildForensicCoverageV2(canonicalInput())).toEqual({
      version: "forensic-coverage-v2",
      scope: "requested_amount",
      availableInboundTxCount: 24,
      selectedInboundTxCount: 10,
      excludedInboundTxCount: 14,
      selectedAmountRaw: "1000000000",
      tracedAmountRaw: "830000000",
      tracedShare: 0.83,
      unresolvedAmountRaw: "170000000",
      unresolvedShare: 0.17,
      completeness: "partial",
      exclusions: [{
        reason: "different_selected_scope",
        direction: "incoming",
        txCount: 14,
        amountRaw: null,
        evidenceIds: ["coverage:scope:14"]
      }],
      limitations: []
    });
  });

  it("[REQ-38][AC-13] adapts legacy coverage without inventing a denominator", () => {
    const result = adaptLegacyWhereCoverageV2({
      selectedInboundTxCount: 10,
      selectedInboundVolumeRaw: "1000000000",
      currentBalanceCoverageRatio: 0.83,
      coverageRatio: 0.83,
      maxDepth: 3,
      fetchedAddressCount: 4,
      partial: true,
      notes: []
    });

    expect(result).toMatchObject({
      version: "forensic-coverage-v2",
      selectedInboundTxCount: 10,
      selectedAmountRaw: "1000000000",
      tracedShare: 0.83,
      completeness: "unknown"
    });
    expect(result.availableInboundTxCount).toBeNull();
    expect(result.excludedInboundTxCount).toBeNull();
    expect(result.unresolvedAmountRaw).toBeNull();
    expect(result.unresolvedShare).toBeNull();
  });

  it("[REQ-03][REQ-10][DATA] stores a local materialization failure only as a limitation", () => {
    const result = buildForensicCoverageV2({
      scope: "current_balance",
      availableInboundTxCount: null,
      selectedInboundTxCount: 1,
      selectedAmountRaw: "1000000",
      tracedAmountRaw: null,
      exclusions: [],
      limitations: [{
        reason: "local_materialization_failed",
        evidenceIds: ["coverage:local-read-failed"]
      }]
    });

    expect(result.limitations).toEqual([{ reason: "local_materialization_failed", evidenceIds: ["coverage:local-read-failed"] }]);
    expect(result.exclusions).toEqual([]);
    expect(result).not.toHaveProperty("riskScore");
  });

  it.each([
    ["negative count", { ...canonicalInput(), selectedInboundTxCount: -1 }],
    ["fractional count", { ...canonicalInput(), selectedInboundTxCount: 1.5 }],
    ["noncanonical raw", { ...canonicalInput(), selectedAmountRaw: "01" }],
    ["selected beyond available", { ...canonicalInput(), selectedInboundTxCount: 25 }],
    ["traced beyond selected", { ...canonicalInput(), tracedAmountRaw: "1000000001" }],
    ["duplicate evidence id", {
      ...canonicalInput(),
      limitations: [{ reason: "local_materialization_failed", evidenceIds: ["coverage:scope:14"] }]
    }],
    ["exclusion sum mismatch", {
      ...canonicalInput(),
      exclusions: [{ reason: "different_selected_scope", direction: "incoming", txCount: 13, amountRaw: null, evidenceIds: ["coverage:scope:13"] }]
    }]
  ])("rejects %s", (_name, value) => {
    expect(() => validateForensicCoverageV2(buildForensicCoverageV2(value as never))).toThrow();
  });

  it("[REQ-31][AC-13][INCOMING] persists transaction-seed CoverageV2 on a new Incoming report", async () => {
    const report = await buildIncomingDepositReport(incomingCoverageFixture);
    expect(report.coverageV2).toMatchObject({
      scope: "transaction_seed",
      availableInboundTxCount: 1,
      selectedInboundTxCount: 1,
      excludedInboundTxCount: 0,
      selectedAmountRaw: "1000000000"
    });
  });

  it("[REQ-31][AC-13][DEEP] persists deep-history CoverageV2 from collected inbound edges", async () => {
    const report = await runDeepAddressForensicCheck(deepCoverageDeps, deepCoverageInput);
    expect(report.coverageV2).toMatchObject({
      scope: "deep_history",
      availableInboundTxCount: 3,
      selectedInboundTxCount: 3,
      excludedInboundTxCount: 0
    });
  });

  it("[REQ-38][DATA] returns null for legacy Incoming or Deep coverage without a defensible denominator", () => {
    expect(adaptLegacyIncomingCoverageV2({ report: legacyIncomingReport, seed: null })).toBeNull();
    expect(adaptLegacyDeepCoverageV2(legacyDeepReportWithoutCoverageV2)).toBeNull();
  });
});
