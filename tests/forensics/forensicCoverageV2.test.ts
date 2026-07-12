import { describe, expect, it } from "vitest";
import {
  adaptLegacyDeepCoverageV2,
  adaptLegacyIncomingCoverageV2,
  adaptLegacyWhereCoverageV2,
  buildDeepCoverageV2,
  buildIncomingCoverageV2,
  buildForensicCoverageV2,
  validateForensicCoverageV2
} from "../../src/forensics/forensicCoverageV2";
import type { IncomingDepositInput, IncomingDepositRiskReport } from "../../src/types";
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
      tracedShare: null,
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

  it("[REQ-31][AC-13] rejects stored shares or completeness without exact authority", () => {
    const exact = buildForensicCoverageV2(canonicalInput());
    expect(() => validateForensicCoverageV2({
      ...exact,
      tracedAmountRaw: null,
      tracedShare: 0.83,
      unresolvedAmountRaw: null,
      unresolvedShare: null,
      completeness: "unknown"
    })).toThrow(/shares/);
    expect(() => validateForensicCoverageV2({ ...exact, completeness: "complete" })).toThrow(/completeness/);
    expect(() => validateForensicCoverageV2({
      ...exact,
      scope: "current_balance",
      selectedAmountRaw: null,
      tracedAmountRaw: null,
      tracedShare: null,
      unresolvedAmountRaw: null,
      unresolvedShare: null,
      completeness: "complete"
    })).toThrow(/completeness/);
  });

  it("[REQ-31][AC-13] accepts every canonical shared exclusion reason", () => {
    const exactZero = buildForensicCoverageV2({
      scope: "current_balance",
      availableInboundTxCount: 0,
      selectedInboundTxCount: 0,
      selectedAmountRaw: "0",
      tracedAmountRaw: "0",
      exclusions: [],
      limitations: []
    });
    for (const reason of ["provider_history_unavailable", "local_materialization_failed"] as const) {
      expect(validateForensicCoverageV2({
        ...exactZero,
        exclusions: [{
          reason,
          direction: null,
          txCount: 0,
          amountRaw: null,
          evidenceIds: [`coverage:canonical:${reason}`]
        }]
      }).exclusions[0]?.reason).toBe(reason);
    }
  });

  it("[REQ-31][AC-13][INCOMING] classifies only typed blockers and gives targeted blockers precedence", () => {
    const deposit: IncomingDepositInput = {
      txHash: "incoming-typed-blocker",
      watchedWallet: "TWatched11111111111111111111111111111",
      sender: "TSender111111111111111111111111111111",
      amountRaw: "1000000",
      timestamp: new Date("2026-07-12T12:00:00.000Z")
    };
    const base = {
      originPaths: [],
      technicalStatus: "completed",
      scoreBlockedReason: null
    } as unknown as IncomingDepositRiskReport;
    expect(buildIncomingCoverageV2({ deposit, report: base }).limitations).toEqual([]);
    expect(buildIncomingCoverageV2({
      deposit,
      report: {
        ...base,
        technicalStatus: "provider_error",
        targetedHistoryCoverage: {
          selectedDepositTxHash: deposit.txHash,
          sender: deposit.sender,
          hopCount: 1,
          completeHopCount: 0,
          partialHopCount: 1,
          pagesFetched: 1,
          transfersFetched: 1,
          firstBlockingReason: "local_index_read_failed",
          firstBlockingTechnicalStatus: "local_data_error",
          firstBlockingAddress: deposit.sender
        }
      }
    }).limitations).toEqual([{
      reason: "local_materialization_failed",
      evidenceIds: ["incoming:coverage:local_data_error"]
    }]);
  });

  it("[REQ-31][AC-13][INCOMING] finds a later exact raw-bound funding bundle and ignores rounded continuity", () => {
    const deposit: IncomingDepositInput = {
      txHash: "incoming-exact-bundle",
      watchedWallet: "TWatched22222222222222222222222222222",
      sender: "TSender222222222222222222222222222222",
      amountRaw: "1000000",
      timestamp: new Date("2026-07-12T12:00:00.000Z")
    };
    const depositStep = {
      txHash: deposit.txHash,
      fromAddress: deposit.sender,
      toAddress: deposit.watchedWallet,
      amountRaw: deposit.amountRaw,
      timestamp: deposit.timestamp.toISOString(),
      method: "transfer",
      edgeType: "normal_transfer" as const
    };
    const targetStep = {
      ...depositStep,
      txHash: "bundle-target",
      fromAddress: "TFunderTarget2222222222222222222222222",
      toAddress: deposit.sender,
      amountRaw: "1200000"
    };
    const validBundle = {
      targetTxHash: targetStep.txHash,
      targetFromAddress: targetStep.fromAddress,
      targetToAddress: targetStep.toAddress,
      targetAmountRaw: targetStep.amountRaw,
      bundleAmountRaw: "1100000",
      bundleCoverageRatio: 0.9167,
      windowStart: "2026-07-12T11:00:00.000Z",
      windowEnd: "2026-07-12T12:00:00.000Z",
      fundingTxHashes: ["funding-exact"],
      fundingAddresses: ["TFunderExact222222222222222222222222"],
      fundingFunders: [{
        address: "TFunderExact222222222222222222222222",
        amountRaw: "1100000",
        txHashes: ["funding-exact"]
      }]
    };
    const path = (bundle: typeof validBundle, steps = [targetStep, depositStep]) => ({
      steps,
      txHashes: steps.map((step) => step.txHash),
      fundingBundles: [bundle],
      amountContinuity: "weak"
    });
    const report = {
      originPaths: [
        path({ ...validBundle, targetAmountRaw: "01200000" }),
        path(validBundle)
      ],
      technicalStatus: "completed"
    } as unknown as IncomingDepositRiskReport;
    const coverage = buildIncomingCoverageV2({ deposit, report });
    expect(coverage.tracedAmountRaw).toBe("1000000");
    expect(coverage.tracedShare).toBe(1);
    expect(coverage.completeness).toBe("complete");
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

  it("[REQ-31][AC-13][DEEP] keeps a truncated local all-time materialization unknown", async () => {
    const exactReader = deepCoverageDeps.listIndexedUsdtTransfersForAddress!;
    const report = await runDeepAddressForensicCheck({
      ...deepCoverageDeps,
      listIndexedUsdtTransfersForAddress: async (...args) => (await exactReader(...args)).slice(0, 2)
    }, deepCoverageInput);
    expect(report.coverageV2).toMatchObject({
      availableInboundTxCount: null,
      excludedInboundTxCount: null,
      selectedInboundTxCount: 2,
      completeness: "partial",
      limitations: [{
        reason: "local_materialization_failed",
        evidenceIds: ["deep:coverage:local-materialization"]
      }]
    });
  });

  it("[REQ-31][AC-13][DEEP] excludes a subject self-transfer from the direct inbound count", () => {
    const inbound = {
      id: "deep-real-inbound",
      txHash: "deep-real-inbound",
      fromAddress: "TDeepSender111111111111111111111111111",
      toAddress: "TDeepSubject11111111111111111111111111",
      amountRaw: "1000000",
      timestamp: new Date("2026-07-12T12:00:00.000Z"),
      method: "transfer",
      edgeType: "normal_transfer" as const
    };
    const coverage = buildDeepCoverageV2({
      subjectAddress: inbound.toAddress,
      sourceEdges: [inbound, {
        ...inbound,
        id: "deep-self-transfer",
        txHash: "deep-self-transfer",
        fromAddress: inbound.toAddress
      }],
      subjectAllTimeComplete: true,
      authoritativeCoverageExact: true,
      localMaterializationExact: true,
      authoritativeTransferCount: 2,
      providerCapHit: false,
      providerInconsistent: false
    });
    expect(coverage).toMatchObject({
      availableInboundTxCount: 1,
      selectedInboundTxCount: 1,
      excludedInboundTxCount: 0,
      completeness: "complete"
    });
  });

  it("[REQ-38][DATA] returns null for legacy Incoming or Deep coverage without a defensible denominator", () => {
    expect(adaptLegacyIncomingCoverageV2({ report: legacyIncomingReport, seed: null })).toBeNull();
    expect(adaptLegacyDeepCoverageV2(legacyDeepReportWithoutCoverageV2)).toBeNull();
  });
});
