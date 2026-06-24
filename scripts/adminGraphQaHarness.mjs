import { startAdminServer } from "../src/admin/adminServer.ts";

function date(value) {
  return new Date(value);
}

function job(overrides = {}) {
  return {
    id: "job-where-1",
    kind: "where_is_money_check",
    subjectAddress: "TYDaeoSFuipFoJ2bzVdJ8daG457emWqQPC",
    status: "completed",
    windowStart: date("2026-06-01T00:00:00.000Z"),
    windowEnd: date("2026-06-02T00:00:00.000Z"),
    priority: 100,
    chatId: null,
    messageId: null,
    requestedBy: "qa",
    requesterUsername: "qa_admin",
    progressJson: {},
    resultJson: {},
    rawEvidenceIds: ["raw-qa"],
    observationIds: ["obs-qa"],
    lastError: null,
    createdAt: date("2026-06-01T00:00:00.000Z"),
    updatedAt: date("2026-06-01T01:00:00.000Z"),
    startedAt: date("2026-06-01T00:00:05.000Z"),
    completedAt: date("2026-06-01T01:00:00.000Z"),
    ...overrides
  };
}

const sourcePolicyShareDetail = {
  scope: "where_is_money",
  targetAmountRaw: "46000000000",
  affectedAmountRaw: "4060000000",
  rawShare: 0.08826086956521739,
  effectiveShare: 0.08826086956521739,
  sourceSeverity: 75,
  shareCap: 30,
  finalContribution: 24
};

const jobs = [
  job({
    id: "job-where-1",
    kind: "where_is_money_check",
    resultJson: {
      subjectAddress: "TYDaeoSFuipFoJ2bzVdJ8daG457emWqQPC",
      riskScore: 72,
      decision: "REVIEW",
      coverage: { coverageRatio: 0.82, selectedAmountRaw: "420000000", targetAmountRaw: "500000000" },
      assessment: { decision: "REVIEW", riskScore: 72, provenanceConfidence: 66, reasons: ["QA where-is-money path"] },
      originPaths: [{
        verdict: "REVIEW",
        stoppedReason: "service_boundary",
        riskScoreContribution: 31,
        amountRaw: "420000000",
        txHashes: ["tx-qa-1", "tx-qa-2"],
        addresses: [
          "TSource1111111111111111111111111111111",
          "TInter111111111111111111111111111111",
          "TYDaeoSFuipFoJ2bzVdJ8daG457emWqQPC"
        ]
      }]
    }
  }),
  job({
    id: "job-deep-1",
    kind: "address_deep_check",
    resultJson: {
      subjectAddress: "TYDaeoSFuipFoJ2bzVdJ8daG457emWqQPC",
      counterpartyRiskProfiles: [],
      directCounterpartyInteractionProfiles: [{
        counterpartyAddress: "TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s",
        direction: "outbound",
        volumeRaw: "1285313840000",
        volumeRatio: 0.1704,
        txCount: 8,
        evidenceClass: "service_boundary_context",
        skippedReason: "service_boundary_context",
        serviceCategory: "bridge",
        identity: "Bridgers:Cross-chain Bridge",
        scoreContribution: 0,
        txHashes: []
      }],
      serviceExposureProfiles: [{
        exposureScore: 65,
        serviceType: "bridge",
        identity: "Bridgers:Cross-chain Bridge",
        topServiceCounterparties: [{
          address: "TPwezUWpEGmFBENNWJHwXHRG1D2NCEEt5s",
          category: "bridge",
          identity: "Bridgers:Cross-chain Bridge",
          volumeRaw: "1285313840000",
          txCount: 8
        }],
        topMergedServiceFlows: []
      }],
      inboundProvenancePaths: [],
      coverage: { transferEdges: 8 }
    }
  }),
  job({
    id: "job-incoming-1",
    kind: "incoming_deposit_check",
    subjectAddress: "TSender1111111111111111111111111111111",
    progressJson: {
      watchedWallet: "TReceiver111111111111111111111111111111",
      sender: "TSender1111111111111111111111111111111",
      depositTxHash: "deposit-tx",
      amountRaw: "46000000000",
      timestamp: "2026-06-02T09:46:39.000Z"
    },
    resultJson: {
      decision: "ACCEPTABLE",
      depositRiskScore: 24,
      originCoverage: 1,
      originPaths: [{
        verdict: "ACCEPTABLE",
        score: 24,
        sourcePolicy: "bridge_router_dex",
        balanceShare: 0.08826086956521739,
        pathAddresses: [
          "TBridge111111111111111111111111111111",
          "TSender1111111111111111111111111111111",
          "TReceiver111111111111111111111111111111"
        ],
        txHashes: ["bridge-tx", "deposit-tx"],
        steps: [
          {
            txHash: "bridge-tx",
            fromAddress: "TBridge111111111111111111111111111111",
            toAddress: "TSender1111111111111111111111111111111",
            amountRaw: "4060000000",
            timestamp: "2026-06-02T09:40:00.000Z"
          },
          {
            txHash: "deposit-tx",
            fromAddress: "TSender1111111111111111111111111111111",
            toAddress: "TReceiver111111111111111111111111111111",
            amountRaw: "46000000000",
            timestamp: "2026-06-02T09:46:39.000Z"
          }
        ],
        amountCoverageRatio: 1,
        sourcePolicyShareDetail,
        reasons: ["Bridge exposure is a minority of this deposit."]
      }],
      sourcePolicyEvidence: [{
        kind: "bridge_router_dex",
        aggregateShare: 0.08826086956521739,
        effectiveShare: 0.08826086956521739,
        pathCount: 1,
        score: 24,
        riskBand: "LOW-MEDIUM",
        proofLevel: "exchange_policy_context",
        reasons: ["Bridge exposure is 8.8% raw / 8.8% effective."],
        shareDetail: sourcePolicyShareDetail
      }]
    }
  }),
  job({
    id: "job-fast-unsupported",
    kind: "address_fast_check",
    resultJson: {
      subjectAddress: "TYDaeoSFuipFoJ2bzVdJ8daG457emWqQPC",
      decision: "REVIEW",
      riskScore: 30
    }
  })
];

function matchesQuery(item, query) {
  if (!query) return true;
  const haystack = [
    item.id,
    item.kind,
    item.subjectAddress,
    item.progressJson?.depositTxHash,
    item.progressJson?.watchedWallet,
    item.progressJson?.sender
  ].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(String(query).toLowerCase());
}

const server = await startAdminServer({
  config: { host: "127.0.0.1", port: 8799, token: "local-admin-token" },
  listJobs: async (input) => jobs
    .filter((item) => !input.status || item.status === input.status)
    .filter((item) => !input.kind || item.kind === input.kind)
    .filter((item) => !input.subjectAddress || item.subjectAddress === input.subjectAddress)
    .filter((item) => matchesQuery(item, input.query))
    .slice(input.offset || 0, (input.offset || 0) + (input.limit || 50)),
  getJob: async (id) => jobs.find((item) => item.id === id) || null
});

console.log(`QA_ADMIN_URL=${server.url}/admin/forensics`);

process.on("SIGTERM", async () => {
  await server.close();
  process.exit(0);
});
process.on("SIGINT", async () => {
  await server.close();
  process.exit(0);
});

await new Promise(() => {});
