import { describe, expect, it } from "vitest";
import { createEvidenceId, createRiskCaseFile } from "../../src/forensics/riskCaseFile";

type RiskCaseFileInput = Parameters<typeof createRiskCaseFile>[0];

describe("RiskCaseFile", () => {
  it("creates stable evidence ids from type and source id", () => {
    expect(createEvidenceId("money_path", "tx-1")).toBe("money_path:tx-1");
    expect(createEvidenceId("contract_profile", "TContract")).toBe("contract_profile:TContract");
  });

  it("builds a where-is-money case file with internal and user decisions separated", () => {
    const caseFile = createRiskCaseFile({
      policyVersion: "test-policy",
      subject: {
        chain: "tron",
        address: "TSubject",
        asset: "USDT",
        mode: "where_is_money",
        requestedAmountRaw: "1000000000",
        currentBalanceRaw: "4982000000"
      },
      deterministicEvidence: [{
        id: "money_path:tx-1",
        type: "money_path",
        strength: "exact",
        txHash: "tx-1",
        facts: { fromAddress: "TSender", toAddress: "TSubject" }
      }],
      scoring: {
        internalDecision: "REVIEW",
        userDecision: "DECLINE",
        proofLevel: "insufficient_coverage",
        reasons: [{
          code: "insufficient_coverage",
          message: "Clean source is not proven due to limited coverage.",
          evidenceIds: ["money_path:tx-1"]
        }]
      },
      coverage: {
        status: "partial",
        fetchedAddressCount: 2,
        maxDepthReached: 1,
        providerErrors: [],
        missingData: ["sender history"]
      }
    });

    expect(caseFile.schemaVersion).toBe("risk-case-v1");
    expect(caseFile.scoring.internalDecision).toBe("REVIEW");
    expect(caseFile.scoring.userDecision).toBe("DECLINE");
    expect(caseFile.audit.evidenceIds).toEqual(["money_path:tx-1"]);
  });

  it("snapshots caller-owned input objects and arrays", () => {
    const input: RiskCaseFileInput = {
      policyVersion: "test-policy",
      subject: {
        chain: "tron",
        address: "TSubject",
        asset: "USDT",
        mode: "where_is_money",
        requestedAmountRaw: "1000000000",
        currentBalanceRaw: "4982000000"
      },
      deterministicEvidence: [{
        id: "money_path:tx-1",
        type: "money_path",
        strength: "exact",
        txHash: "tx-1",
        facts: { fromAddress: "TSender", toAddress: "TSubject" }
      }],
      scoring: {
        internalDecision: "REVIEW",
        userDecision: "DECLINE",
        proofLevel: "insufficient_coverage",
        reasons: [{
          code: "insufficient_coverage",
          message: "Clean source is not proven due to limited coverage.",
          evidenceIds: ["money_path:tx-1"]
        }]
      },
      coverage: {
        status: "partial",
        fetchedAddressCount: 2,
        maxDepthReached: 1,
        providerErrors: ["rate limited"],
        missingData: ["sender history"]
      }
    };

    const caseFile = createRiskCaseFile(input);

    input.subject.address = "TMutated";
    input.deterministicEvidence[0].id = "money_path:mutated";
    input.deterministicEvidence[0].facts.fromAddress = "TMutatedSender";
    input.deterministicEvidence.push({
      id: "money_path:tx-2",
      type: "money_path",
      strength: "context",
      txHash: "tx-2",
      facts: { fromAddress: "TOtherSender", toAddress: "TSubject" }
    });
    input.scoring.reasons[0].evidenceIds[0] = "money_path:mutated";
    input.coverage.providerErrors.push("provider down");
    input.coverage.missingData[0] = "mutated missing data";

    expect(caseFile.subject.address).toBe("TSubject");
    expect(caseFile.deterministicEvidence).toHaveLength(1);
    expect(caseFile.deterministicEvidence[0].id).toBe("money_path:tx-1");
    expect(caseFile.deterministicEvidence[0].facts.fromAddress).toBe("TSender");
    expect(caseFile.scoring.reasons[0].evidenceIds).toEqual(["money_path:tx-1"]);
    expect(caseFile.coverage.providerErrors).toEqual(["rate limited"]);
    expect(caseFile.coverage.missingData).toEqual(["sender history"]);
    expect(caseFile.audit.evidenceIds).toEqual(["money_path:tx-1"]);
  });

  it("rejects reasons that cite unknown evidence ids", () => {
    expect(() => createRiskCaseFile({
      policyVersion: "test-policy",
      subject: {
        chain: "tron",
        address: "TSubject",
        asset: "USDT",
        mode: "where_is_money"
      },
      deterministicEvidence: [{
        id: "money_path:tx-1",
        type: "money_path",
        strength: "exact",
        txHash: "tx-1",
        facts: { fromAddress: "TSender", toAddress: "TSubject" }
      }],
      scoring: {
        internalDecision: "REVIEW",
        userDecision: "DECLINE",
        proofLevel: "insufficient_coverage",
        reasons: [{
          code: "insufficient_coverage",
          message: "Clean source is not proven due to limited coverage.",
          evidenceIds: ["missing:evidence"]
        }]
      },
      coverage: {
        status: "partial",
        fetchedAddressCount: 2,
        maxDepthReached: 1,
        providerErrors: [],
        missingData: ["sender history"]
      }
    })).toThrow(/Unknown evidence id/);
  });
});
