import { describe, expect, it, vi } from "vitest";
import {
  buildContractDrivenEvidenceProfiles,
  classifyContractDrivenReceiver,
  classifySourcePostDebitActivity
} from "../../src/forensics/contractDrivenEvidence";
import type { ForensicRouteEdge } from "../../src/types";

describe("contract-driven evidence", () => {
  it("classifies the TS3ga Verify20 receiver campaign as drainer-like", () => {
    const classification = classifyContractDrivenReceiver({
      totalIncomingTxCount: 175,
      totalIncomingAmountRaw: "968500000000",
      contractDrivenIncomingTxCount: 168,
      contractDrivenIncomingAmountRaw: "959200000000",
      uniqueSourceCount: 168,
      dominantMethod: "Verify20",
      contractNames: ["VerifyAccount"],
      knownServiceIdentity: null,
      exactApprovalDrainCount: 1
    });

    expect(classification).toMatchObject({
      level: "dominant_drainer_like_pattern",
      primaryRole: "drainer_receiver_collector",
      evidenceStrength: "hard",
      label: "Likely drainer campaign"
    });
    expect(classification.contractDrivenTxShare).toBeGreaterThan(0.95);
    expect(classification.contractDrivenAmountShare).toBeGreaterThan(0.98);
    expect(classification.reasons).toContain("Verify20-like method with explicit source and receiver fields");
    expect(classification.reasons).toContain("Exact approval-drain evidence exists in this receiver campaign");
  });

  it("classifies the TPdrEz Verify20 receiver campaign as a drainer receiver collector", () => {
    expect(classifyContractDrivenReceiver({
      totalIncomingTxCount: 112,
      totalIncomingAmountRaw: "437600000000",
      contractDrivenIncomingTxCount: 97,
      contractDrivenIncomingAmountRaw: "322100000000",
      uniqueSourceCount: 97,
      dominantMethod: "Verify20",
      contractNames: ["VerifyAccount"],
      knownServiceIdentity: null,
      exactApprovalDrainCount: 1
    })).toMatchObject({
      level: "dominant_drainer_like_pattern",
      primaryRole: "drainer_receiver_collector"
    });
  });

  it("does not classify one Verify20 transfer as drainer by method name alone", () => {
    expect(classifyContractDrivenReceiver({
      totalIncomingTxCount: 5,
      totalIncomingAmountRaw: "12000000000",
      contractDrivenIncomingTxCount: 1,
      contractDrivenIncomingAmountRaw: "1000000000",
      uniqueSourceCount: 1,
      dominantMethod: "Verify20",
      contractNames: ["VerifyAccount"],
      knownServiceIdentity: null,
      exactApprovalDrainCount: 0
    })).toMatchObject({
      level: "contract_driven_transfer",
      primaryRole: "collector",
      evidenceStrength: "context",
      label: "Contract-driven incoming"
    });
  });

  it("keeps permitTransfer with known service identity in service context", () => {
    expect(classifyContractDrivenReceiver({
      totalIncomingTxCount: 224,
      totalIncomingAmountRaw: "5390000000000",
      contractDrivenIncomingTxCount: 5,
      contractDrivenIncomingAmountRaw: "314600000000",
      uniqueSourceCount: 5,
      dominantMethod: "permitTransfer",
      contractNames: ["GasFree"],
      knownServiceIdentity: "GasFree Account",
      exactApprovalDrainCount: 0
    })).toMatchObject({
      level: "contract_driven_service_context",
      primaryRole: "service_context",
      evidenceStrength: "context",
      label: "Service contract-driven flow"
    });
  });

  it("keeps transferFrom with known service identity in service context", () => {
    expect(classifyContractDrivenReceiver({
      totalIncomingTxCount: 224,
      totalIncomingAmountRaw: "5390000000000",
      contractDrivenIncomingTxCount: 5,
      contractDrivenIncomingAmountRaw: "314600000000",
      uniqueSourceCount: 5,
      dominantMethod: "transferFrom",
      contractNames: ["KnownRouter"],
      knownServiceIdentity: "Known Service",
      exactApprovalDrainCount: 0
    })).toMatchObject({
      level: "contract_driven_service_context",
      primaryRole: "service_context",
      evidenceStrength: "context",
      label: "Service contract-driven flow"
    });
  });

  it("preserves exact approval-drain evidence for known-service transferFrom", () => {
    const classification = classifyContractDrivenReceiver({
      totalIncomingTxCount: 5,
      totalIncomingAmountRaw: "12000000000",
      contractDrivenIncomingTxCount: 1,
      contractDrivenIncomingAmountRaw: "1000000000",
      uniqueSourceCount: 1,
      dominantMethod: "transferFrom",
      contractNames: ["KnownRouter"],
      knownServiceIdentity: "Known Service",
      exactApprovalDrainCount: 1
    });

    expect(classification).toMatchObject({
      level: "drainer_like_pattern",
      primaryRole: "drainer_receiver_collector",
      evidenceStrength: "hard",
      label: "Exact approval-drain receiver"
    });
    expect(classification.reasons).toContain("Exact approval-drain evidence exists in this receiver campaign");
  });

  it("classifies no later USDT activity after a large debit as victim-like", () => {
    expect(classifySourcePostDebitActivity({
      debitAmountRaw: "50100000000",
      laterIncomingAmountRaw: "0",
      laterOutgoingAmountRaw: "0",
      laterTxCount: 0,
      repeatedContractDrivenDebitToSameReceiver: false,
      checked: true
    })).toMatchObject({
      status: "victim_like_source",
      victimLike: true,
      label: "No later USDT activity"
    });
  });

  it("keeps minor residual activity after large debits victim-like", () => {
    for (const sample of [
      { debitAmountRaw: "50100000000", laterAmountRaw: "296000000" },
      { debitAmountRaw: "16000000000", laterAmountRaw: "20980000" },
      { debitAmountRaw: "12700000000", laterAmountRaw: "5000000" }
    ]) {
      const classification = classifySourcePostDebitActivity({
        debitAmountRaw: sample.debitAmountRaw,
        laterIncomingAmountRaw: sample.laterAmountRaw,
        laterOutgoingAmountRaw: sample.laterAmountRaw,
        laterTxCount: 2,
        repeatedContractDrivenDebitToSameReceiver: false,
        checked: true
      });

      expect(classification).toMatchObject({
        status: "minor_residual_activity",
        victimLike: true,
        label: "Only minor residual activity"
      });
      expect(classification.residualActivityRatio).toBeGreaterThan(0);
      expect(classification.residualActivityRatio).toBeLessThanOrEqual(0.05);
    }
  });

  it("classifies repeated residual collection as victim-like", () => {
    expect(classifySourcePostDebitActivity({
      debitAmountRaw: "41400000000",
      laterIncomingAmountRaw: "47000000",
      laterOutgoingAmountRaw: "47000000",
      laterTxCount: 4,
      repeatedContractDrivenDebitToSameReceiver: true,
      checked: true
    })).toMatchObject({
      status: "repeated_residual_collection",
      victimLike: true,
      label: "Repeated residual collection"
    });
  });

  it("treats nullish and malformed raw amounts as zero", () => {
    expect(classifyContractDrivenReceiver({
      totalIncomingTxCount: 2,
      totalIncomingAmountRaw: null,
      contractDrivenIncomingTxCount: 2,
      contractDrivenIncomingAmountRaw: undefined,
      uniqueSourceCount: 1,
      dominantMethod: "Verify20",
      contractNames: ["VerifyAccount"],
      knownServiceIdentity: null,
      exactApprovalDrainCount: 0
    })).toMatchObject({
      level: "contract_driven_transfer",
      contractDrivenTxShare: 1,
      contractDrivenAmountShare: 0
    });

    expect(classifySourcePostDebitActivity({
      debitAmountRaw: undefined,
      laterIncomingAmountRaw: "not-a-raw-amount",
      laterOutgoingAmountRaw: null,
      laterTxCount: 1,
      repeatedContractDrivenDebitToSameReceiver: false,
      checked: true
    })).toMatchObject({
      status: "victim_like_source",
      victimLike: true,
      residualActivityRatio: 0
    });
  });

  it("bounds exported shares and ratios for inconsistent input data", () => {
    const classifyInconsistentReceiver = () => classifyContractDrivenReceiver({
      totalIncomingTxCount: 2,
      totalIncomingAmountRaw: "1000",
      contractDrivenIncomingTxCount: 10,
      contractDrivenIncomingAmountRaw: "2000",
      uniqueSourceCount: 1,
      dominantMethod: "transfer",
      contractNames: [],
      knownServiceIdentity: null,
      exactApprovalDrainCount: 0
    });

    expect(classifyInconsistentReceiver).not.toThrow();

    const receiver = classifyInconsistentReceiver();
    const source = classifySourcePostDebitActivity({
      debitAmountRaw: "1000",
      laterIncomingAmountRaw: "2000",
      laterOutgoingAmountRaw: "500",
      laterTxCount: 2,
      repeatedContractDrivenDebitToSameReceiver: false,
      checked: true
    });

    expect(Number.isFinite(receiver.contractDrivenTxShare)).toBe(true);
    expect(receiver.contractDrivenTxShare).toBeGreaterThanOrEqual(0);
    expect(receiver.contractDrivenTxShare).toBeLessThanOrEqual(1);
    expect(Number.isFinite(receiver.contractDrivenAmountShare)).toBe(true);
    expect(receiver.contractDrivenAmountShare).toBeGreaterThanOrEqual(0);
    expect(receiver.contractDrivenAmountShare).toBeLessThanOrEqual(1);
    expect(Number.isFinite(source.residualActivityRatio)).toBe(true);
    expect(source.residualActivityRatio).toBeGreaterThanOrEqual(0);
    expect(source.residualActivityRatio).toBeLessThanOrEqual(1);
  });

  it("keeps all contract-driven transfer profiles while bounding expensive enrichment", async () => {
    const subjectAddress = "TS3gaCollector";
    const edges: ForensicRouteEdge[] = Array.from({ length: 40 }, (_, index) => ({
      id: `edge-${index}`,
      fromAddress: `TSource${index}`,
      toAddress: subjectAddress,
      txHash: `tx-${index}`,
      amountRaw: `${(index + 1) * 1_000_000}`,
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, index)),
      method: "Verify20(address,address,uint256)",
      edgeType: "transfer_from"
    }));
    const getTransaction = vi.fn(async () => null);
    const fetchEdgesForAddress = vi.fn(async () => []);

    const result = await buildContractDrivenEvidenceProfiles({
      subjectAddress,
      edges,
      getTransaction,
      fetchEdgesForAddress,
      maxTransactionInfoFetches: 2
    });

    expect(result.transferProfiles).toHaveLength(40);
    expect(getTransaction).toHaveBeenCalledTimes(2);
    expect(fetchEdgesForAddress).toHaveBeenCalledTimes(2);
    expect(result.transferProfiles.map((profile) => profile.method)).toEqual(Array(40).fill("Verify20"));
  });

  it("treats any non-transfer smart-contract method as contract-driven incoming evidence", async () => {
    const subjectAddress = "TGenericSmartReceiver111111111111";
    const sourceAddress = "TGenericSmartSource11111111111111";
    const contractAddress = "TGenericSmartContract11111111111";
    const txHash = "tx-generic-smart-contract";

    const result = await buildContractDrivenEvidenceProfiles({
      subjectAddress,
      edges: [{
        id: "edge-generic-smart-contract",
        fromAddress: sourceAddress,
        toAddress: subjectAddress,
        txHash,
        amountRaw: "4200000000",
        timestamp: new Date("2026-06-29T10:00:00.000Z"),
        method: "withdraw(address,address,uint256)",
        edgeType: "normal_transfer"
      }],
      getTransaction: async () => ({
        ownerAddress: "TGenericSmartCaller11111111111111",
        contractData: {
          contract_address: contractAddress,
          function_selector: "withdraw(address,address,uint256)"
        },
        trigger_info: { methodName: "withdraw" },
        trc20TransferInfo: [{
          from_address: sourceAddress,
          to_address: subjectAddress,
          quant: "4200000000",
          tokenInfo: { tokenAbbr: "USDT", tokenType: "trc20" }
        }]
      })
    });

    expect(result.receiverProfile).toMatchObject({
      totalIncomingTxCount: 1,
      contractDrivenIncomingTxCount: 1,
      dominantMethod: "withdraw(address,address,uint256)"
    });
    expect(result.transferProfiles).toEqual([
      expect.objectContaining({
        txHash,
        amountRaw: "4200000000",
        method: "withdraw(address,address,uint256)",
        contractAddress,
        sourceAddress,
        receiverAddress: subjectAddress
      })
    ]);
  });

  it("does not treat standard transfer signatures as contract-driven evidence", async () => {
    const subjectAddress = "TPlainTransferReceiver111111111111";
    const edges: ForensicRouteEdge[] = [
      {
        id: "edge-transfer-signature",
        fromAddress: "TPlainTransferSource1111111111111",
        toAddress: subjectAddress,
        txHash: "tx-transfer-signature",
        amountRaw: "1000000",
        timestamp: new Date("2026-06-29T10:00:00.000Z"),
        method: "transfer(address,uint256)",
        edgeType: "normal_transfer"
      },
      {
        id: "edge-transfer-selector",
        fromAddress: "TPlainTransferSelector11111111111",
        toAddress: subjectAddress,
        txHash: "tx-transfer-selector",
        amountRaw: "2000000",
        timestamp: new Date("2026-06-29T10:01:00.000Z"),
        method: "transfer a9059cbb",
        edgeType: "normal_transfer"
      }
    ];

    const result = await buildContractDrivenEvidenceProfiles({ subjectAddress, edges });

    expect(result.receiverProfile).toBeNull();
    expect(result.transferProfiles).toEqual([]);
  });
});
