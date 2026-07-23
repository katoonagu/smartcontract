import type { FrozenEvidenceSourceV2 } from "../../../tools/golden-pilot-v2/neutralExport";

const SUBJECT = "T9yD14Nj9j7xAB4dbGeiX9h8unkKLxmGkn";
const SOURCE = "T9yD14Nj9j7xAB4dbGeiX9h8unkKT76qbH";
const DESTINATION = "T9yD14Nj9j7xAB4dbGeiX9h8unkKawPyGg";
const SPENDER = "T9yD14Nj9j7xAB4dbGeiX9h8unkKi6mJHp";
const USDT = "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj";

export function validFrozenSource(
  overrides: Record<string, unknown> = {}
): FrozenEvidenceSourceV2 & Record<string, unknown> {
  return {
    version: "frozen-evidence-source-v2",
    caseId: "synthetic-one-legitimate-transfer",
    subjectAddress: SUBJECT,
    snapshot: {
      chain: "tron",
      confirmedBlockNumber: "100",
      confirmedBlockHash: "f".repeat(64),
      timestamp: "2026-07-23T00:00:00.000Z",
      labelDatasetSha256: "1".repeat(64)
    },
    events: [
      {
        txHash: "a".repeat(64),
        eventIndex: "0",
        tokenContract: USDT,
        from: SOURCE,
        to: SUBJECT,
        amountRaw: "2000000",
        timestamp: "2026-07-22T23:59:58.000Z",
        blockNumber: "99",
        factType: "trc20_transfer"
      },
      {
        txHash: "b".repeat(64),
        eventIndex: "0",
        tokenContract: USDT,
        from: SUBJECT,
        to: DESTINATION,
        amountRaw: "1000000",
        timestamp: "2026-07-22T23:59:59.000Z",
        blockNumber: "100",
        factType: "trc20_transfer"
      }
    ],
    stateFacts: [
      {
        factType: "account_created",
        subject: SUBJECT,
        object: null,
        role: "subject",
        effectiveAt: "2026-07-01T00:00:00.000Z",
        evidenceRefs: ["account-snapshot:100"]
      }
    ],
    labels: [
      {
        address: SOURCE,
        label: "Known exchange",
        category: "centralized_exchange",
        authority: "frozen-label-dataset",
        validFrom: "2026-01-01T00:00:00.000Z",
        validTo: null,
        evidenceRefs: ["label:source:1"]
      }
    ],
    approvals: [
      {
        owner: SUBJECT,
        spender: SPENDER,
        tokenContract: USDT,
        amountRaw: "0",
        txHash: "c".repeat(64),
        eventIndex: "0",
        timestamp: "2026-07-22T23:59:57.000Z"
      }
    ],
    ...overrides
  } as FrozenEvidenceSourceV2 & Record<string, unknown>;
}
