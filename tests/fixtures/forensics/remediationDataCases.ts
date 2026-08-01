import type {
  ApprovalAllowanceStateV2,
  ForensicRouteEdge,
  IndexedTronUsdtTransfer,
  TronAddressUsdtIndexState
} from "../../../src/types";
import type { ForensicCheckJob } from "../../../src/storage/repositories";
import type { SelectRecentFlowInput } from "../../../src/forensics/recentFlowProvenanceSelection";
import type { BuildIncomingDepositReportInput } from "../../../src/forensics/incomingDepositJob";
import type {
  DeepAddressForensicDeps,
  RunDeepAddressForensicCheckInput
} from "../../../src/check/deepForensicCheck";

const syntheticAddress = (character: string): string => `T${character.repeat(33)}`;

export const SYNTHETIC_TKG_SUBJECT: string = syntheticAddress("K");
// Deterministic checksum-valid synthetic TRON addresses derived from repeated 0xDD/0xEE payloads.
export const TNARA_OWNER = "TWCL826n2tBuoR7mp6oj5FzgitmfWSwCGZ";
export const APPROVAL_TX_HASH = "a".repeat(64);
export const NOW = new Date("2026-07-12T12:10:00.000Z");

const feeCollector = syntheticAddress("F");
const contractAccount = syntheticAddress("C");
const gasFreeAccount = syntheticAddress("G");
const counterpartyA = syntheticAddress("A");
const counterpartyB = syntheticAddress("B");
const counterpartyD = syntheticAddress("D");
const counterpartyE = syntheticAddress("E");
const counterpartyH = syntheticAddress("H");

function edge(
  txHash: string,
  fromAddress: string,
  toAddress: string,
  amountRaw: string,
  timestamp: string
): ForensicRouteEdge {
  return {
    id: txHash,
    txHash,
    fromAddress,
    toAddress,
    amountRaw,
    timestamp: new Date(timestamp),
    method: "transfer",
    edgeType: "normal_transfer"
  };
}

export const syntheticGasFreeFeeEdge: ForensicRouteEdge = edge(
  "tk-gasfree-fee",
  SYNTHETIC_TKG_SUBJECT,
  feeCollector,
  "1500000",
  "2026-07-12T12:06:30.000Z"
);

// Fully synthetic regression timeline. It must never be presented as observed on-chain evidence.
export const syntheticTkgEdges: ForensicRouteEdge[] = [
  edge("tk-in-305", counterpartyA, SYNTHETIC_TKG_SUBJECT, "305000000", "2026-07-12T12:09:00.000Z"),
  edge("tk-out-305", SYNTHETIC_TKG_SUBJECT, counterpartyB, "305000000", "2026-07-12T12:08:00.000Z"),
  edge("contract-principal", contractAccount, SYNTHETIC_TKG_SUBJECT, "47000000", "2026-07-12T12:07:00.000Z"),
  syntheticGasFreeFeeEdge,
  edge("gasfree-account-principal", gasFreeAccount, SYNTHETIC_TKG_SUBJECT, "23000000", "2026-07-12T12:06:00.000Z"),
  edge("tk-older-principal", SYNTHETIC_TKG_SUBJECT, counterpartyD, "12000000", "2026-07-12T12:05:00.000Z"),
  edge("tk-archived-principal", counterpartyE, SYNTHETIC_TKG_SUBJECT, "9000000", "2026-07-12T12:04:00.000Z")
];

export async function resolveSyntheticEconomicContext(routeEdge: ForensicRouteEdge): Promise<ForensicRouteEdge> {
  if (routeEdge.txHash !== syntheticGasFreeFeeEdge.txHash) return routeEdge;
  return { ...routeEdge, economicRole: "service_fee", economicProtocol: "tron_gasfree" };
}

export const contractPrincipalInput: SelectRecentFlowInput = {
  subjectAddress: SYNTHETIC_TKG_SUBJECT,
  currentBalanceRaw: "23791",
  edges: [
    edge("contract-principal", contractAccount, SYNTHETIC_TKG_SUBJECT, "47000000", "2026-07-12T12:07:00.000Z"),
    edge("gasfree-account-principal", gasFreeAccount, SYNTHETIC_TKG_SUBJECT, "23000000", "2026-07-12T12:06:00.000Z")
  ]
};

const MAX_UINT256 = (2n ** 256n - 1n).toString();
const tokenContract = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const spenderAddress = "TXka46PPwttNPWfFDPtt3GUodbPThyufaV";

const allowanceBase = {
  ownerAddress: TNARA_OWNER,
  tokenContract,
  spenderAddress,
  observedApprovalTxHash: APPROVAL_TX_HASH,
  source: "official_usdt_allowance" as const
};

export const maxAllowanceState: ApprovalAllowanceStateV2 = {
  ...allowanceBase,
  version: "approval-allowance-v2",
  state: "confirmed_active" as const,
  confirmedAllowanceRaw: MAX_UINT256,
  isUnlimited: true,
  confirmedAt: "2026-07-12T12:00:00.000Z",
  freshUntil: "2026-07-12T12:15:00.000Z",
  lastAttemptAt: "2026-07-12T12:00:00.000Z",
  failureCode: null
};

export const zeroAllowanceState: ApprovalAllowanceStateV2 = {
  ...allowanceBase,
  version: "approval-allowance-v2",
  state: "confirmed_zero" as const,
  confirmedAllowanceRaw: "0",
  isUnlimited: false,
  confirmedAt: "2026-07-12T12:00:00.000Z",
  freshUntil: "2026-07-12T12:15:00.000Z",
  lastAttemptAt: "2026-07-12T12:00:00.000Z",
  failureCode: null
};

export const failedAllowanceState: ApprovalAllowanceStateV2 = {
  ...allowanceBase,
  version: "approval-allowance-v2",
  state: "failed" as const,
  confirmedAllowanceRaw: null,
  isUnlimited: null,
  confirmedAt: null,
  freshUntil: null,
  lastAttemptAt: "2026-07-12T12:00:00.000Z",
  failureCode: "provider_unavailable" as const
};

export const expiredAllowanceState: ApprovalAllowanceStateV2 = {
  ...allowanceBase,
  version: "approval-allowance-v2",
  state: "stale" as const,
  confirmedAllowanceRaw: MAX_UINT256,
  isUnlimited: null,
  confirmedAt: "2026-07-12T11:30:00.000Z",
  freshUntil: "2026-07-12T11:45:00.000Z",
  lastAttemptAt: "2026-07-12T11:30:00.000Z",
  failureCode: null,
};

const incomingJob: ForensicCheckJob = {
  id: "synthetic-incoming-job",
  kind: "incoming_deposit_check",
  subjectAddress: counterpartyH,
  status: "running",
  windowStart: new Date("2026-07-12T11:00:00.000Z"),
  windowEnd: NOW,
  priority: 100,
  chatId: null,
  messageId: null,
  requestedBy: "synthetic-test",
  progressJson: {},
  resultJson: {},
  rawEvidenceIds: [],
  observationIds: [],
  lastError: null,
  createdAt: new Date("2026-07-12T12:00:00.000Z"),
  updatedAt: new Date("2026-07-12T12:00:00.000Z"),
  startedAt: new Date("2026-07-12T12:00:00.000Z"),
  completedAt: null
};

export const incomingCoverageFixture: BuildIncomingDepositReportInput = {
  deps: {
    listIndexedUsdtTransfersForAddress: async () => [],
    listRelatedTrc20Transfers: async () => [],
    getLabelsForAddress: async () => [],
    getClassificationForAddress: async () => null,
    getContractIntelligenceProfile: async () => null,
    getTransaction: async () => ({}),
    getUsdtRestrictionStatus: async () => null
  },
  job: incomingJob,
  depositTxHash: "incoming-deposit-synthetic",
  watchedWallet: SYNTHETIC_TKG_SUBJECT,
  sender: counterpartyH,
  amountRaw: "1000000000",
  timestamp: new Date("2026-07-12T12:05:00.000Z")
};

const deepInboundEdges: ForensicRouteEdge[] = [
  edge("deep-inbound-1", counterpartyA, SYNTHETIC_TKG_SUBJECT, "400000000", "2026-07-12T12:03:00.000Z"),
  edge("deep-inbound-2", counterpartyB, SYNTHETIC_TKG_SUBJECT, "350000000", "2026-07-12T12:02:00.000Z"),
  edge("deep-inbound-3", counterpartyD, SYNTHETIC_TKG_SUBJECT, "250000000", "2026-07-12T12:01:00.000Z")
];

const deepIndexedInbound: IndexedTronUsdtTransfer[] = deepInboundEdges.map((item, index) => ({
  txHash: item.txHash,
  blockNumber: 100 + index,
  blockTimestamp: item.timestamp,
  eventIndex: index,
  fromAddress: item.fromAddress,
  toAddress: item.toAddress,
  amountRaw: item.amountRaw,
  method: "transfer",
  callerAddress: null,
  contractRet: "SUCCESS",
  confirmed: true
}));

const deepCompleteIndexState: TronAddressUsdtIndexState = {
  address: SYNTHETIC_TKG_SUBJECT,
  tokenContract,
  coverageMode: "all_time",
  coverageKind: "provider_windowed",
  targetTimestamp: null,
  status: "complete",
  statusReason: "complete_provider_windowed",
  provider: "tronscan",
  totalReported: 3,
  fetchedTransferCount: 3,
  uniqueCounterpartyCount: 3,
  newestTransferAt: deepInboundEdges[0].timestamp,
  oldestTransferAt: deepInboundEdges[2].timestamp,
  coveredUntilTimestamp: deepInboundEdges[2].timestamp,
  fetchedPageCount: 1,
  plannedPageCount: 1,
  currentEndTimestamp: null,
  providerCapHit: false,
  budgetExhausted: false,
  providerInconsistent: false,
  priority: 100,
  nextRunAt: NOW,
  attemptCount: 1,
  maxAttempts: 5,
  retryCount: 0,
  lastError: null,
  lastErrorClass: null,
  lastSuccessfulPageAt: NOW,
  queuedReason: "synthetic_deep_coverage",
  requestedByJobId: "synthetic-deep-job",
  lockedAt: null,
  lockedUntil: null,
  heartbeatAt: null,
  lockOwner: null,
  budgetPages: null,
  budgetSeconds: null,
  completedAt: NOW,
  createdAt: NOW,
  updatedAt: NOW
};

export const deepCoverageDeps: DeepAddressForensicDeps = {
  tronClient: {
    listRelatedTrc20Transfers: async () => deepInboundEdges.map((item) => ({
      transaction_id: item.txHash,
      from_address: item.fromAddress,
      to_address: item.toAddress,
      quant: item.amountRaw,
      block_ts: item.timestamp.getTime(),
      confirmed: true,
      contractRet: "SUCCESS",
      contract_address: tokenContract
    }))
  },
  listIndexedUsdtTransfersForAddress: async () => deepIndexedInbound,
  getAddressUsdtIndexState: async () => deepCompleteIndexState,
  getLabelsForAddress: async () => []
};

export const deepCoverageInput: RunDeepAddressForensicCheckInput = {
  sourceAddress: SYNTHETIC_TKG_SUBJECT,
  windowStart: new Date("2026-07-11T00:00:00.000Z"),
  windowEnd: NOW,
  pageLimit: 10,
  maxPagesPerAddress: 1,
  maxExpandedIntermediates: 0,
  metadataFetchLimit: 0,
  contractProfileFetchLimit: 0,
  maxInboundSenders: 0,
  runProfile: "production_full",
  allTimeMode: "strict",
  allTimeSubjectIndexState: deepCompleteIndexState
};

export const legacyIncomingReport = {
  originCoverage: 0.83,
  originPaths: [],
  targetedHistoryCoverage: undefined
};

export const legacyDeepReportWithoutCoverageV2 = {
  coverage: {
    sourceTransferPages: 1,
    inboundSendersExpanded: 2,
    transferEdges: 3
  }
};

const psmReserve = "TSUYvQ5tdd3DijCD1uGunGLpftHuSZ12sQ";
const routeBase = {
  subjectAddress: SYNTHETIC_TKG_SUBJECT,
  reserveAddress: psmReserve,
  serviceId: "usdd_psm_gemjoin" as const,
  selectedAmountRaw: "1000000000",
  hopCount: 1 as const,
  serviceIdentityExact: true,
  amountContinuityExact: true,
  mode: "where" as const,
  evidenceIds: ["psm:synthetic-route"]
};

export const exactOutboundTwoPercentInput = {
  ...routeBase,
  direction: "outbound_to_psm" as const,
  amountRaw: "20000000"
};

export const exactInboundEightyThreePercentInput = {
  ...routeBase,
  direction: "inbound_from_psm" as const,
  amountRaw: "830000000"
};

export const labelOnlyInput = {
  ...exactOutboundTwoPercentInput,
  serviceIdentityExact: false,
  providerLabel: "USDD: PSM GemJoin (USDT)",
  evidenceIds: ["psm:provider-label-only"]
};

export const discontinuousInput = {
  ...exactInboundEightyThreePercentInput,
  amountContinuityExact: false,
  evidenceIds: ["psm:discontinuous"]
};
