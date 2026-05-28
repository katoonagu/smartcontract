import { describe, expect, it } from "vitest";
import { createEvidenceId, createRiskCaseFile } from "../../src/forensics/riskCaseFile";

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
});
