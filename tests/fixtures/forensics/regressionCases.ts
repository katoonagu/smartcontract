import type { ForensicRouteEdge } from "../../../src/types";

export type SerializedForensicRouteEdge = Omit<ForensicRouteEdge, "timestamp"> & {
  timestamp: string;
};

export type OperationalLiquidityWhereIsMoneyCase = {
  name: string;
  subjectAddress: string;
  balanceRaw: string;
  windowStart: string;
  windowEnd: string;
  expectedDecision: "ACCEPTABLE";
  expectedRiskBand: "LOW-MEDIUM";
  expectedWalletRole: "operational_liquidity_wallet";
  expectedSelectedInboundTxCount: number;
  expectedMinOperationalLiquidityScore: number;
  edgesByAddress: Record<string, SerializedForensicRouteEdge[]>;
};

export const regressionCases = [
  {
    name: "Binance through clean EOA is acceptable",
    expectedDecision: "ACCEPTABLE",
    expectedProofLevel: "clean_source_proven"
  },
  {
    name: "HTX through clean EOA is high policy decline",
    expectedDecision: "DECLINE",
    expectedProofLevel: "exchange_policy_decline"
  },
  {
    name: "WhiteBIT small share is medium policy decline",
    expectedDecision: "DECLINE",
    expectedProofLevel: "exchange_policy_decline"
  },
  {
    name: "Unknown contract boundary is policy decline not scam proof",
    expectedDecision: "DECLINE",
    expectedProofLevel: "exchange_policy_decline"
  },
  {
    name: "Known DEX router approval with output is guarded, not drainer proof",
    expectedDecision: "DECLINE",
    expectedProofLevel: "exchange_policy_decline"
  },
  {
    name: "Wrapper transferFrom path to checked wallet is exact approval-drain decline",
    expectedDecision: "DECLINE",
    expectedProofLevel: "exact_approval_drain_provenance"
  },
  {
    name: "LLM timeout on uncertain contract is user decline with no cache",
    expectedDecision: "DECLINE",
    expectedProofLevel: "insufficient_coverage"
  },
  {
    name: "Fingerprint clone with different flow does not reuse drainer verdict",
    expectedDecision: "DECLINE",
    expectedProofLevel: "exchange_policy_decline"
  }
] as const;

export const operationalLiquidityWhereIsMoneyCases = [
  {
    name: "tey_like_two_sender_operational_wallet",
    subjectAddress: "TTeYSubject11111111111111111111111111",
    balanceRaw: "200000000",
    windowStart: "2026-05-01T00:00:00.000Z",
    windowEnd: "2026-05-24T00:00:00.000Z",
    expectedDecision: "ACCEPTABLE",
    expectedRiskBand: "LOW-MEDIUM",
    expectedWalletRole: "operational_liquidity_wallet",
    expectedSelectedInboundTxCount: 2,
    expectedMinOperationalLiquidityScore: 65,
    edgesByAddress: {
      TTeYSubject11111111111111111111111111: [
        { id: "tx-tey-a-subject", txHash: "tx-tey-a-subject", fromAddress: "TTeYSenderA1111111111111111111111111", toAddress: "TTeYSubject11111111111111111111111111", amountRaw: "100000000", timestamp: "2026-05-22T10:00:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tey-b-subject", txHash: "tx-tey-b-subject", fromAddress: "TTeYSenderB1111111111111111111111111", toAddress: "TTeYSubject11111111111111111111111111", amountRaw: "100000000", timestamp: "2026-05-22T10:05:00.000Z", method: "transfer", edgeType: "normal_transfer" }
      ],
      TTeYSenderA1111111111111111111111111: [
        { id: "tx-tey-a-in-1", txHash: "tx-tey-a-in-1", fromAddress: "TTeYFunderA111111111111111111111111", toAddress: "TTeYSenderA1111111111111111111111111", amountRaw: "90000000", timestamp: "2026-05-20T08:00:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tey-a-in-2", txHash: "tx-tey-a-in-2", fromAddress: "TTeYFunderA222222222222222222222222", toAddress: "TTeYSenderA1111111111111111111111111", amountRaw: "80000000", timestamp: "2026-05-20T09:00:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tey-a-in-3", txHash: "tx-tey-a-in-3", fromAddress: "TTeYFunderA111111111111111111111111", toAddress: "TTeYSenderA1111111111111111111111111", amountRaw: "70000000", timestamp: "2026-05-21T08:00:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tey-a-out-1", txHash: "tx-tey-a-out-1", fromAddress: "TTeYSenderA1111111111111111111111111", toAddress: "TTeYSinkA11111111111111111111111111", amountRaw: "70000000", timestamp: "2026-05-20T10:00:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tey-a-out-2", txHash: "tx-tey-a-out-2", fromAddress: "TTeYSenderA1111111111111111111111111", toAddress: "TTeYSinkA22222222222222222222222222", amountRaw: "60000000", timestamp: "2026-05-20T11:00:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tey-a-out-3", txHash: "tx-tey-a-out-3", fromAddress: "TTeYSenderA1111111111111111111111111", toAddress: "TTeYSinkA11111111111111111111111111", amountRaw: "50000000", timestamp: "2026-05-21T10:00:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tey-a-subject", txHash: "tx-tey-a-subject", fromAddress: "TTeYSenderA1111111111111111111111111", toAddress: "TTeYSubject11111111111111111111111111", amountRaw: "100000000", timestamp: "2026-05-22T10:00:00.000Z", method: "transfer", edgeType: "normal_transfer" }
      ],
      TTeYSenderB1111111111111111111111111: [
        { id: "tx-tey-b-in-1", txHash: "tx-tey-b-in-1", fromAddress: "TTeYFunderB111111111111111111111111", toAddress: "TTeYSenderB1111111111111111111111111", amountRaw: "95000000", timestamp: "2026-05-20T08:30:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tey-b-in-2", txHash: "tx-tey-b-in-2", fromAddress: "TTeYFunderB222222222222222222222222", toAddress: "TTeYSenderB1111111111111111111111111", amountRaw: "85000000", timestamp: "2026-05-20T09:30:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tey-b-in-3", txHash: "tx-tey-b-in-3", fromAddress: "TTeYFunderB111111111111111111111111", toAddress: "TTeYSenderB1111111111111111111111111", amountRaw: "75000000", timestamp: "2026-05-21T08:30:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tey-b-out-1", txHash: "tx-tey-b-out-1", fromAddress: "TTeYSenderB1111111111111111111111111", toAddress: "TTeYSinkB11111111111111111111111111", amountRaw: "75000000", timestamp: "2026-05-20T10:30:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tey-b-out-2", txHash: "tx-tey-b-out-2", fromAddress: "TTeYSenderB1111111111111111111111111", toAddress: "TTeYSinkB22222222222222222222222222", amountRaw: "65000000", timestamp: "2026-05-20T11:30:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tey-b-out-3", txHash: "tx-tey-b-out-3", fromAddress: "TTeYSenderB1111111111111111111111111", toAddress: "TTeYSinkB11111111111111111111111111", amountRaw: "45000000", timestamp: "2026-05-21T10:30:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tey-b-subject", txHash: "tx-tey-b-subject", fromAddress: "TTeYSenderB1111111111111111111111111", toAddress: "TTeYSubject11111111111111111111111111", amountRaw: "100000000", timestamp: "2026-05-22T10:05:00.000Z", method: "transfer", edgeType: "normal_transfer" }
      ]
    }
  },
  {
    name: "tvz_like_multi_sender_operational_wallet",
    subjectAddress: "TTVzSubject11111111111111111111111111",
    balanceRaw: "300000000",
    windowStart: "2026-05-01T00:00:00.000Z",
    windowEnd: "2026-05-24T00:00:00.000Z",
    expectedDecision: "ACCEPTABLE",
    expectedRiskBand: "LOW-MEDIUM",
    expectedWalletRole: "operational_liquidity_wallet",
    expectedSelectedInboundTxCount: 3,
    expectedMinOperationalLiquidityScore: 65,
    edgesByAddress: {
      TTVzSubject11111111111111111111111111: [
        { id: "tx-tvz-a-subject", txHash: "tx-tvz-a-subject", fromAddress: "TTVzSenderA1111111111111111111111111", toAddress: "TTVzSubject11111111111111111111111111", amountRaw: "125000000", timestamp: "2026-05-22T09:00:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tvz-b-subject", txHash: "tx-tvz-b-subject", fromAddress: "TTVzSenderB1111111111111111111111111", toAddress: "TTVzSubject11111111111111111111111111", amountRaw: "95000000", timestamp: "2026-05-22T09:20:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tvz-c-subject", txHash: "tx-tvz-c-subject", fromAddress: "TTVzSenderC1111111111111111111111111", toAddress: "TTVzSubject11111111111111111111111111", amountRaw: "80000000", timestamp: "2026-05-22T09:40:00.000Z", method: "transfer", edgeType: "normal_transfer" }
      ],
      TTVzSenderA1111111111111111111111111: [
        { id: "tx-tvz-a-in-1", txHash: "tx-tvz-a-in-1", fromAddress: "TTVzFunderA111111111111111111111111", toAddress: "TTVzSenderA1111111111111111111111111", amountRaw: "130000000", timestamp: "2026-05-21T07:30:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tvz-a-in-2", txHash: "tx-tvz-a-in-2", fromAddress: "TTVzFunderA222222222222222222222222", toAddress: "TTVzSenderA1111111111111111111111111", amountRaw: "90000000", timestamp: "2026-05-21T08:30:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tvz-a-out-1", txHash: "tx-tvz-a-out-1", fromAddress: "TTVzSenderA1111111111111111111111111", toAddress: "TTVzSinkA11111111111111111111111111", amountRaw: "60000000", timestamp: "2026-05-21T10:00:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tvz-a-out-2", txHash: "tx-tvz-a-out-2", fromAddress: "TTVzSenderA1111111111111111111111111", toAddress: "TTVzSinkA22222222222222222222222222", amountRaw: "35000000", timestamp: "2026-05-21T11:00:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tvz-a-subject", txHash: "tx-tvz-a-subject", fromAddress: "TTVzSenderA1111111111111111111111111", toAddress: "TTVzSubject11111111111111111111111111", amountRaw: "125000000", timestamp: "2026-05-22T09:00:00.000Z", method: "transfer", edgeType: "normal_transfer" }
      ],
      TTVzSenderB1111111111111111111111111: [
        { id: "tx-tvz-b-in-1", txHash: "tx-tvz-b-in-1", fromAddress: "TTVzFunderB111111111111111111111111", toAddress: "TTVzSenderB1111111111111111111111111", amountRaw: "100000000", timestamp: "2026-05-21T07:40:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tvz-b-in-2", txHash: "tx-tvz-b-in-2", fromAddress: "TTVzFunderB222222222222222222222222", toAddress: "TTVzSenderB1111111111111111111111111", amountRaw: "70000000", timestamp: "2026-05-21T08:40:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tvz-b-out-1", txHash: "tx-tvz-b-out-1", fromAddress: "TTVzSenderB1111111111111111111111111", toAddress: "TTVzSinkB11111111111111111111111111", amountRaw: "50000000", timestamp: "2026-05-21T10:10:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tvz-b-out-2", txHash: "tx-tvz-b-out-2", fromAddress: "TTVzSenderB1111111111111111111111111", toAddress: "TTVzSinkB22222222222222222222222222", amountRaw: "30000000", timestamp: "2026-05-21T11:10:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tvz-b-subject", txHash: "tx-tvz-b-subject", fromAddress: "TTVzSenderB1111111111111111111111111", toAddress: "TTVzSubject11111111111111111111111111", amountRaw: "95000000", timestamp: "2026-05-22T09:20:00.000Z", method: "transfer", edgeType: "normal_transfer" }
      ],
      TTVzSenderC1111111111111111111111111: [
        { id: "tx-tvz-c-in-1", txHash: "tx-tvz-c-in-1", fromAddress: "TTVzFunderC111111111111111111111111", toAddress: "TTVzSenderC1111111111111111111111111", amountRaw: "85000000", timestamp: "2026-05-21T07:50:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tvz-c-in-2", txHash: "tx-tvz-c-in-2", fromAddress: "TTVzFunderC222222222222222222222222", toAddress: "TTVzSenderC1111111111111111111111111", amountRaw: "65000000", timestamp: "2026-05-21T08:50:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tvz-c-out-1", txHash: "tx-tvz-c-out-1", fromAddress: "TTVzSenderC1111111111111111111111111", toAddress: "TTVzSinkC11111111111111111111111111", amountRaw: "45000000", timestamp: "2026-05-21T10:20:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tvz-c-out-2", txHash: "tx-tvz-c-out-2", fromAddress: "TTVzSenderC1111111111111111111111111", toAddress: "TTVzSinkC22222222222222222222222222", amountRaw: "25000000", timestamp: "2026-05-21T11:20:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tvz-c-subject", txHash: "tx-tvz-c-subject", fromAddress: "TTVzSenderC1111111111111111111111111", toAddress: "TTVzSubject11111111111111111111111111", amountRaw: "80000000", timestamp: "2026-05-22T09:40:00.000Z", method: "transfer", edgeType: "normal_transfer" }
      ]
    }
  },
  {
    name: "tts_like_large_many_sender_partial_operational_wallet",
    subjectAddress: "TTTsSubject11111111111111111111111111",
    balanceRaw: "500000000",
    windowStart: "2026-05-01T00:00:00.000Z",
    windowEnd: "2026-05-24T00:00:00.000Z",
    expectedDecision: "ACCEPTABLE",
    expectedRiskBand: "LOW-MEDIUM",
    expectedWalletRole: "operational_liquidity_wallet",
    expectedSelectedInboundTxCount: 4,
    expectedMinOperationalLiquidityScore: 65,
    edgesByAddress: {
      TTTsSubject11111111111111111111111111: [
        { id: "tx-tts-a-subject", txHash: "tx-tts-a-subject", fromAddress: "TTTsSenderA1111111111111111111111111", toAddress: "TTTsSubject11111111111111111111111111", amountRaw: "140000000", timestamp: "2026-05-22T08:00:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tts-b-subject", txHash: "tx-tts-b-subject", fromAddress: "TTTsSenderB1111111111111111111111111", toAddress: "TTTsSubject11111111111111111111111111", amountRaw: "130000000", timestamp: "2026-05-22T08:15:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tts-c-subject", txHash: "tx-tts-c-subject", fromAddress: "TTTsSenderC1111111111111111111111111", toAddress: "TTTsSubject11111111111111111111111111", amountRaw: "120000000", timestamp: "2026-05-22T08:30:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tts-d-subject", txHash: "tx-tts-d-subject", fromAddress: "TTTsSenderD1111111111111111111111111", toAddress: "TTTsSubject11111111111111111111111111", amountRaw: "110000000", timestamp: "2026-05-22T08:45:00.000Z", method: "transfer", edgeType: "normal_transfer" }
      ],
      TTTsSenderA1111111111111111111111111: [
        { id: "tx-tts-a-in-1", txHash: "tx-tts-a-in-1", fromAddress: "TTTsFunderA111111111111111111111111", toAddress: "TTTsSenderA1111111111111111111111111", amountRaw: "150000000", timestamp: "2026-05-21T06:00:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tts-a-in-2", txHash: "tx-tts-a-in-2", fromAddress: "TTTsFunderA222222222222222222222222", toAddress: "TTTsSenderA1111111111111111111111111", amountRaw: "90000000", timestamp: "2026-05-21T07:00:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tts-a-out-1", txHash: "tx-tts-a-out-1", fromAddress: "TTTsSenderA1111111111111111111111111", toAddress: "TTTsSinkA11111111111111111111111111", amountRaw: "70000000", timestamp: "2026-05-21T09:00:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tts-a-out-2", txHash: "tx-tts-a-out-2", fromAddress: "TTTsSenderA1111111111111111111111111", toAddress: "TTTsSinkA22222222222222222222222222", amountRaw: "45000000", timestamp: "2026-05-21T10:00:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tts-a-subject", txHash: "tx-tts-a-subject", fromAddress: "TTTsSenderA1111111111111111111111111", toAddress: "TTTsSubject11111111111111111111111111", amountRaw: "140000000", timestamp: "2026-05-22T08:00:00.000Z", method: "transfer", edgeType: "normal_transfer" }
      ],
      TTTsSenderB1111111111111111111111111: [
        { id: "tx-tts-b-in-1", txHash: "tx-tts-b-in-1", fromAddress: "TTTsFunderB111111111111111111111111", toAddress: "TTTsSenderB1111111111111111111111111", amountRaw: "135000000", timestamp: "2026-05-21T06:15:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tts-b-in-2", txHash: "tx-tts-b-in-2", fromAddress: "TTTsFunderB222222222222222222222222", toAddress: "TTTsSenderB1111111111111111111111111", amountRaw: "85000000", timestamp: "2026-05-21T07:15:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tts-b-out-1", txHash: "tx-tts-b-out-1", fromAddress: "TTTsSenderB1111111111111111111111111", toAddress: "TTTsSinkB11111111111111111111111111", amountRaw: "65000000", timestamp: "2026-05-21T09:15:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tts-b-out-2", txHash: "tx-tts-b-out-2", fromAddress: "TTTsSenderB1111111111111111111111111", toAddress: "TTTsSinkB22222222222222222222222222", amountRaw: "35000000", timestamp: "2026-05-21T10:15:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tts-b-subject", txHash: "tx-tts-b-subject", fromAddress: "TTTsSenderB1111111111111111111111111", toAddress: "TTTsSubject11111111111111111111111111", amountRaw: "130000000", timestamp: "2026-05-22T08:15:00.000Z", method: "transfer", edgeType: "normal_transfer" }
      ],
      TTTsSenderC1111111111111111111111111: [
        { id: "tx-tts-c-in-1", txHash: "tx-tts-c-in-1", fromAddress: "TTTsFunderC111111111111111111111111", toAddress: "TTTsSenderC1111111111111111111111111", amountRaw: "125000000", timestamp: "2026-05-21T06:30:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tts-c-in-2", txHash: "tx-tts-c-in-2", fromAddress: "TTTsFunderC222222222222222222222222", toAddress: "TTTsSenderC1111111111111111111111111", amountRaw: "80000000", timestamp: "2026-05-21T07:30:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tts-c-out-1", txHash: "tx-tts-c-out-1", fromAddress: "TTTsSenderC1111111111111111111111111", toAddress: "TTTsSinkC11111111111111111111111111", amountRaw: "60000000", timestamp: "2026-05-21T09:30:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tts-c-out-2", txHash: "tx-tts-c-out-2", fromAddress: "TTTsSenderC1111111111111111111111111", toAddress: "TTTsSinkC22222222222222222222222222", amountRaw: "30000000", timestamp: "2026-05-21T10:30:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tts-c-subject", txHash: "tx-tts-c-subject", fromAddress: "TTTsSenderC1111111111111111111111111", toAddress: "TTTsSubject11111111111111111111111111", amountRaw: "120000000", timestamp: "2026-05-22T08:30:00.000Z", method: "transfer", edgeType: "normal_transfer" }
      ],
      TTTsSenderD1111111111111111111111111: [
        { id: "tx-tts-d-in-1", txHash: "tx-tts-d-in-1", fromAddress: "TTTsFunderD111111111111111111111111", toAddress: "TTTsSenderD1111111111111111111111111", amountRaw: "115000000", timestamp: "2026-05-21T06:45:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tts-d-in-2", txHash: "tx-tts-d-in-2", fromAddress: "TTTsFunderD222222222222222222222222", toAddress: "TTTsSenderD1111111111111111111111111", amountRaw: "75000000", timestamp: "2026-05-21T07:45:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tts-d-out-1", txHash: "tx-tts-d-out-1", fromAddress: "TTTsSenderD1111111111111111111111111", toAddress: "TTTsSinkD11111111111111111111111111", amountRaw: "55000000", timestamp: "2026-05-21T09:45:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tts-d-out-2", txHash: "tx-tts-d-out-2", fromAddress: "TTTsSenderD1111111111111111111111111", toAddress: "TTTsSinkD22222222222222222222222222", amountRaw: "25000000", timestamp: "2026-05-21T10:45:00.000Z", method: "transfer", edgeType: "normal_transfer" },
        { id: "tx-tts-d-subject", txHash: "tx-tts-d-subject", fromAddress: "TTTsSenderD1111111111111111111111111", toAddress: "TTTsSubject11111111111111111111111111", amountRaw: "110000000", timestamp: "2026-05-22T08:45:00.000Z", method: "transfer", edgeType: "normal_transfer" }
      ]
    }
  }
] as const satisfies readonly OperationalLiquidityWhereIsMoneyCase[];
