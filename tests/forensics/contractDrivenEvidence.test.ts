import { describe, expect, it, vi } from "vitest";
import { TronWeb } from "tronweb";
import {
  buildContractDrivenEvidenceProfiles,
  classifyContractDrivenReceiver,
  classifySourcePostDebitActivity
} from "../../src/forensics/contractDrivenEvidence";
import { TRON_USDT_CONTRACT_ADDRESS } from "../../src/parser/transactionParser";
import type { ForensicRouteEdge } from "../../src/types";

const gasFreeController = "TFFAMQLZybALaLb4uxHA9RBE7pxhUAjF3U";
const gasFreeAccount = "TRivmRsLwVRZETXqPdv98raFPHMkwuMnxP";
const gasFreeUser = "TW2Py9fWGc1HVXhejufX1stuwQ9N42Y8RE";
const gasFreeReceiver = "TMwjbNHpsVSjn93vtWtLnThHwhAJAnrWNq";
const gasFreeTlnt = "TLntW9Z59LYY5KEi9cmwk3PKjQga828ird";

const gasFreeUintWord = (value: bigint): string => value.toString(16).padStart(64, "0");
const gasFreeAddressWord = (address: string): string => TronWeb.address.toHex(address).slice(2).padStart(64, "0");

function gasFreePermitData(receiverAddress: string, value: bigint, maxFee: bigint): string {
  const signature = "11".repeat(65);
  return [
    "6f21b898",
    gasFreeAddressWord(TRON_USDT_CONTRACT_ADDRESS),
    gasFreeAddressWord(gasFreeUser),
    gasFreeAddressWord(receiverAddress),
    gasFreeUintWord(value),
    gasFreeUintWord(maxFee),
    gasFreeUintWord(1_800_000_000n),
    gasFreeUintWord(1n),
    gasFreeUintWord(9n),
    gasFreeUintWord(0x120n),
    gasFreeUintWord(65n),
    signature.padEnd(192, "0")
  ].join("");
}

function gasFreeTransferRow(toAddress: string, amountRaw: string) {
  return {
    from_address: gasFreeAccount,
    to_address: toAddress,
    amount_str: amountRaw,
    contract_address: TRON_USDT_CONTRACT_ADDRESS,
    tokenInfo: { tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenAbbr: "USDT", tokenType: "trc20" }
  };
}

function gasFreeTransaction(rows: unknown[], value = 97_000_000n, maxFee = 3_000_000n) {
  return {
    confirmed: true,
    contractRet: "SUCCESS",
    revert: false,
    contractData: {
      contract_address: gasFreeController,
      data: gasFreePermitData(gasFreeReceiver, value, maxFee)
    },
    trc20TransferInfo: rows,
    tokenTransferInfo: rows.map((row) => ({ ...(row as Record<string, unknown>) }))
  };
}

function gasFreeEdge(input: {
  id: string;
  toAddress: string;
  amountRaw: string;
  at?: string;
}): ForensicRouteEdge {
  return {
    id: input.id,
    txHash: "tx-gasfree-settlement",
    fromAddress: gasFreeAccount,
    toAddress: input.toAddress,
    amountRaw: input.amountRaw,
    timestamp: new Date(input.at ?? "2026-07-10T00:00:00.000Z"),
    method: "permitTransfer",
    edgeType: "transfer_from"
  };
}

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
    expect(result.campaignSummary).toMatchObject({
      incomingTxTotal: 40,
      txInfoEnrichedIncomingTx: 2,
      campaignClassificationStatus: "partial",
      countsAreLowerBounds: true,
      txInfoUnavailableTxCount: 2,
      wrapperDrivenIncomingTxCount: 40
    });
  });

  it("classifies exact GasFree principal and fee movements without campaign context", async () => {
    const transaction = gasFreeTransaction([
      gasFreeTransferRow(gasFreeReceiver, "97000000"),
      gasFreeTransferRow(gasFreeTlnt, "3000000")
    ]);
    const getTransaction = vi.fn(async () => transaction);
    const principal = await buildContractDrivenEvidenceProfiles({
      subjectAddress: gasFreeReceiver,
      edges: [
        gasFreeEdge({ id: "principal-1", toAddress: gasFreeReceiver, amountRaw: "97000000" }),
        gasFreeEdge({ id: "principal-2", toAddress: gasFreeReceiver, amountRaw: "97000000", at: "2026-07-10T00:00:01.000Z" })
      ],
      getTransaction
    });
    const fee = await buildContractDrivenEvidenceProfiles({
      subjectAddress: gasFreeTlnt,
      edges: [gasFreeEdge({ id: "fee", toAddress: gasFreeTlnt, amountRaw: "3000000" })],
      getTransaction: async () => transaction
    });

    expect(getTransaction).toHaveBeenCalledTimes(1);
    expect(principal.transferProfiles[0]).toMatchObject({
      classification: "gasfree_principal",
      economicRole: "principal",
      economicProtocol: "tron_gasfree",
      countsAsDrainerContext: false
    });
    expect(fee.transferProfiles[0]).toMatchObject({
      classification: "gasfree_service_fee",
      economicRole: "service_fee",
      economicProtocol: "tron_gasfree",
      countsAsDrainerContext: false
    });
    expect(principal.campaignSummary?.campaignClusters).toHaveLength(0);
    expect(fee.campaignSummary?.campaignClusters).toHaveLength(0);
    expect([
      ...principal.transferProfiles,
      ...fee.transferProfiles
    ].flatMap((profile) => [profile.sourceAddress, profile.receiverAddress])).not.toContain(gasFreeUser);
  });

  it("reads amount_str from contract-driven transfer rows", async () => {
    const subjectAddress = "TAmountStrReceiver11111111111111111";
    const sourceAddress = "TAmountStrSource1111111111111111111";
    const result = await buildContractDrivenEvidenceProfiles({
      subjectAddress,
      edges: [{
        id: "amount-str-edge",
        txHash: "amount-str-tx",
        fromAddress: sourceAddress,
        toAddress: subjectAddress,
        amountRaw: "1000000",
        timestamp: new Date("2026-07-10T00:00:00.000Z"),
        method: "Verify20",
        edgeType: "transfer_from"
      }],
      getTransaction: async () => ({
        contractData: { contract_address: "TAmountStrContract111111111111111" },
        trigger_info: { methodName: "Verify20" },
        trc20TransferInfo: [{
          from_address: sourceAddress,
          to_address: subjectAddress,
          amount_str: "2000000",
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          tokenInfo: { tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenAbbr: "USDT" }
        }]
      })
    });

    expect(result.transferProfiles[0]?.amountRaw).toBe("2000000");
  });

  it("uses the first non-empty transfer alias instead of concatenating fallback rows", async () => {
    const subjectAddress = "TAliasReceiver11111111111111111111";
    const authoritativeSource = "TAuthoritativeSource111111111111111";
    const fallbackSource = "TFallbackSource111111111111111111111";
    const result = await buildContractDrivenEvidenceProfiles({
      subjectAddress,
      edges: [{
        id: "alias-edge",
        txHash: "alias-tx",
        fromAddress: authoritativeSource,
        toAddress: subjectAddress,
        amountRaw: "1000000",
        timestamp: new Date("2026-07-10T00:00:00.000Z"),
        method: "Verify20",
        edgeType: "transfer_from"
      }],
      getTransaction: async () => {
        const row = (fromAddress: string) => ({
          from_address: fromAddress,
          to_address: subjectAddress,
          amount_str: "1000000",
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          tokenInfo: { tokenId: TRON_USDT_CONTRACT_ADDRESS, tokenAbbr: "USDT" }
        });
        return {
          contractData: { contract_address: "TAliasContract111111111111111111" },
          trigger_info: { methodName: "Verify20" },
          transfersAllList: [row(authoritativeSource)],
          transfers: [row(fallbackSource)]
        };
      }
    });

    expect(result.transferProfiles[0]).toMatchObject({ sourceAddress: authoritativeSource });
  });

  it("keeps all-fetched null tx-info campaign counts as lower bounds", async () => {
    const subjectAddress = "TNullTxInfoCampaignReceiver111111";
    const edges: ForensicRouteEdge[] = [0, 1].map((index) => ({
      id: `edge-null-tx-info-${index}`,
      fromAddress: `TNullTxInfoCampaignSource${index}`,
      toAddress: subjectAddress,
      txHash: `tx-null-info-${index}`,
      amountRaw: `${(index + 1) * 1_000_000}`,
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, index)),
      method: "Verify20(address,address,uint256)",
      edgeType: "transfer_from"
    }));
    const getTransaction = vi.fn(async () => null);

    const result = await buildContractDrivenEvidenceProfiles({
      subjectAddress,
      edges,
      getTransaction,
      maxTransactionInfoFetches: 2
    });

    expect(getTransaction).toHaveBeenCalledTimes(2);
    expect(result.campaignSummary).toMatchObject({
      incomingTxTotal: 2,
      txInfoEnrichedIncomingTx: 2,
      txInfoUnavailableTxCount: 2,
      campaignClassificationStatus: "partial",
      countsAreLowerBounds: true
    });
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
      },
      {
        id: "edge-transfer-named-params",
        fromAddress: "TPlainTransferNamedParams11111111",
        toAddress: subjectAddress,
        txHash: "tx-transfer-named-params",
        amountRaw: "3000000",
        timestamp: new Date("2026-06-29T10:02:00.000Z"),
        method: "transfer(address _to,uint256 _value)",
        edgeType: "normal_transfer"
      }
    ];

    const result = await buildContractDrivenEvidenceProfiles({ subjectAddress, edges });

    expect(result.receiverProfile).toBeNull();
    expect(result.transferProfiles).toEqual([]);
  });

  it("does not treat doubled standard transfer method text as contract-driven evidence", async () => {
    const subjectAddress = "TPlainTransferReceiver222222222222";
    const result = await buildContractDrivenEvidenceProfiles({
      subjectAddress,
      edges: [{
        id: "edge-transfer-doubled-method",
        fromAddress: "TPlainTransferSource22222222222222",
        toAddress: subjectAddress,
        txHash: "tx-transfer-doubled-method",
        amountRaw: "1500000",
        timestamp: new Date("2026-06-29T10:03:00.000Z"),
        method: "transfer transfer(address _to,uint256 _value)",
        edgeType: "normal_transfer"
      }],
      getTransaction: async () => ({
        ownerAddress: "TPlainTransferSource22222222222222",
        contractData: {
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          function_selector: "transfer(address _to,uint256 _value)"
        },
        trigger_info: {
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          methodName: "transfer"
        },
        trc20TransferInfo: [{
          from_address: "TPlainTransferSource22222222222222",
          to_address: subjectAddress,
          quant: "1500000",
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          tokenInfo: {
            tokenAbbr: "USDT",
            tokenId: TRON_USDT_CONTRACT_ADDRESS,
            tokenType: "trc20"
          }
        }]
      })
    });

    expect(result.receiverProfile).toBeNull();
    expect(result.transferProfiles).toEqual([]);
    expect(result).toMatchObject({
      campaignSummary: {
        incomingTxTotal: 1,
        txInfoEnrichedIncomingTx: 1,
        plainUsdtTransferTxCount: 1,
        wrapperDrivenIncomingTxCount: 0,
        countsAreLowerBounds: false,
        campaignClassificationStatus: "complete"
      }
    });
  });

  it("classifies canonical USDT transaction-info transfer as plain, not wrapper-driven", async () => {
    const subjectAddress = "TPlainTransferReceiver333333333333";
    const result = await buildContractDrivenEvidenceProfiles({
      subjectAddress,
      edges: [{
        id: "edge-canonical-usdt",
        fromAddress: "TPlainTransferSource33333333333333",
        toAddress: subjectAddress,
        txHash: "tx-canonical-usdt-transfer",
        amountRaw: "4200000",
        timestamp: new Date("2026-06-29T10:04:00.000Z"),
        method: "transfer",
        edgeType: "normal_transfer"
      }],
      getTransaction: async () => ({
        ownerAddress: "TPlainTransferSource33333333333333",
        contractData: {
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          function_selector: "transfer(address,uint256)"
        },
        trigger_info: {
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          methodName: "transfer"
        },
        trc20TransferInfo: [{
          from_address: "TPlainTransferSource33333333333333",
          to_address: subjectAddress,
          quant: "4200000",
          contract_address: TRON_USDT_CONTRACT_ADDRESS,
          tokenInfo: {
            tokenAbbr: "USDT",
            tokenId: TRON_USDT_CONTRACT_ADDRESS,
            tokenType: "trc20"
          }
        }]
      })
    });

    expect(result.receiverProfile).toBeNull();
    expect(result.transferProfiles).toEqual([]);
    expect(result).toMatchObject({
      campaignSummary: {
        incomingTxTotal: 1,
        plainUsdtTransferTxCount: 1,
        wrapperDrivenIncomingTxCount: 0
      }
    });
  });

  it("marks plain-looking incoming tx as unavailable when transaction info fetch returns null", async () => {
    const subjectAddress = "TUnavailableTransferReceiver111111";
    const result = await buildContractDrivenEvidenceProfiles({
      subjectAddress,
      edges: [{
        id: "edge-unavailable-transfer",
        fromAddress: "TUnavailableTransferSource1111111",
        toAddress: subjectAddress,
        txHash: "tx-unavailable-transfer",
        amountRaw: "1200000",
        timestamp: new Date("2026-06-29T10:04:30.000Z"),
        method: "transfer",
        edgeType: "normal_transfer"
      }],
      getTransaction: async () => null
    });

    expect(result.receiverProfile).toBeNull();
    expect(result.transferProfiles).toEqual([]);
    expect(result).toMatchObject({
      campaignSummary: {
        incomingTxTotal: 1,
        txInfoEnrichedIncomingTx: 1,
        plainUsdtTransferTxCount: 0,
        wrapperDrivenIncomingTxCount: 0,
        txInfoUnavailableTxCount: 1,
        countsAreLowerBounds: true,
        campaignClassificationStatus: "partial"
      }
    });
  });

  it("preserves method-prefiltered mode while default tx-info classification covers plain-looking wrapper calls", async () => {
    const subjectAddress = "TLegacyWhereReceiver11111111111";
    const sourceAddress = "TLegacyWhereSource11111111111111";
    const contractAddress = "TVerify20Contract111111111111111";
    const edge: ForensicRouteEdge = {
      id: "edge-plain-looking-verify20",
      fromAddress: sourceAddress,
      toAddress: subjectAddress,
      txHash: "tx-plain-looking-verify20",
      amountRaw: "9100000",
      timestamp: new Date("2026-06-29T10:05:00.000Z"),
      method: "transfer",
      edgeType: "normal_transfer"
    };
    const getTransaction = vi.fn(async () => ({
      ownerAddress: "TLegacyCaller11111111111111111",
      contractData: {
        contract_address: contractAddress,
        function_selector: "Verify20(address,address,uint256)"
      },
      trigger_info: {
        contract_address: contractAddress,
        methodName: "Verify20"
      },
      trc20TransferInfo: [{
        from_address: sourceAddress,
        to_address: subjectAddress,
        quant: "9100000",
        tokenInfo: { tokenAbbr: "USDT", tokenType: "trc20" }
      }]
    }));

    const defaultResult = await buildContractDrivenEvidenceProfiles({
      subjectAddress,
      edges: [edge],
      getTransaction
    });

    expect(defaultResult.receiverProfile).toMatchObject({
      contractDrivenIncomingTxCount: 1,
      dominantMethod: "Verify20"
    });

    getTransaction.mockClear();
    const methodPrefilteredResult = await buildContractDrivenEvidenceProfiles({
      subjectAddress,
      edges: [edge],
      getTransaction,
      incomingClassificationMode: "method_prefiltered"
    });

    expect(getTransaction).not.toHaveBeenCalled();
    expect(methodPrefilteredResult.receiverProfile).toBeNull();
    expect(methodPrefilteredResult.transferProfiles).toEqual([]);
    expect(methodPrefilteredResult.campaignSummary).toBeNull();
  });
});
