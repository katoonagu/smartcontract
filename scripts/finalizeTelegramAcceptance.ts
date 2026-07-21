import { createHash } from "node:crypto";
import { link, lstat, mkdir, readFile, readdir, realpath, unlink, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import type { DeepAddressForensicReport } from "../src/check/deepForensicCheck";
import type { SmartContractCheckReport } from "../src/check/smartContractCheck";
import {
  formatDeepForensicUserDeliveryReport,
  formatSmartContractCheckReport,
  formatWhereIsMoneyUserDeliveryReport
} from "../src/bot/createBot";
import { formatIncomingDepositRiskAlert, formatUserApprovalAlert } from "../src/alerts/formatters";
import {
  canonicalizeJson,
  createPendingForensicTelegramDelivery,
  isForensicTelegramDeliveryV1,
  isTelegramMessagePayloadV1
} from "../src/forensics/telegramDelivery";
import {
  assertNoSecretLikeArtifactValues,
  validateTask0BReleaseFreezeEvidence,
  validateTask0BReleaseRevalidationEvidence
} from "../src/release/remediationReleaseManifest";
import { readCurrentTask0BReleaseRevalidation } from "./captureTask0BPreflight";
import {
  claimNextForensicCheckJob,
  completeForensicCheckJob,
  createOrReuseForensicCheckJob,
  getForensicCheckJob,
  type ForensicCheckJob,
  type ForensicCheckJobKind
} from "../src/storage/repositories";
import {
  checksumMigrationBytes,
  REQUIRED_SCHEMA_FILENAME,
  verifyRequiredSchema032
} from "../src/storage/schemaMigrations";
import { renderTelegramTechnicalResult } from "../src/telegram/technicalResult";
import { buildContractDecisionEvidenceV1, resolveContractDecisionV2 } from "../src/forensics/contractDecision";
import { TRON_USDT_CONTRACT_ADDRESS } from "../src/parser/transactionParser";
import type { IncomingDepositRiskReport, TelegramMessagePayloadV1, WhereIsMoneyReport } from "../src/types";
import {
  MANUAL_TELEGRAM_ACCEPTANCE_CASES,
  assertTelegramUxAcceptanceSendAuthorized
} from "./renderTelegramUxAcceptance";
import { readSafeArtifactFile, resolveExternalArtifactRoot } from "./verifyRemediationRelease";
import { buildSchema032DatabaseFingerprint } from "./verifySchema032";
import {
  PERSISTED_COVERAGE_WHERE_REPORT,
  remediationTelegramUxCase,
  type RemediationTelegramUxSourceV1
} from "../tests/fixtures/telegram/remediationTelegramUxCases";
import { REMEDIATION_TELEGRAM_GOLDEN_MESSAGES } from "../tests/fixtures/telegram/remediationTelegramGoldenMessages";

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const SCREENSHOT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.png$/;
const RECORDING_CHAT = "recording_disabled";
const REQUESTED_BY = "plan5_manual_telegram";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_IEND = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

type JsonRecord = Record<string, unknown>;
type DbLike = {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
};

export type ManualTelegramMessageRecordV1 = {
  id: string;
  scenarioId: string;
  candidateSha: string;
  runtimeLabel: string;
  checkedWallet: string;
  jobId: string;
  telegramMessageId: number;
  payloadSha256: string;
  screenshotFilename: string;
  screenshotSha256: string;
  requirementIds: string[];
  result: "pass";
};

export type ManualTelegramScenarioSummaryV1 = {
  scenarioId: string;
  candidateSha: string;
  runtimeLabel: string;
  messageRecordIds: string[];
  fixtureIds: string[];
  goldenIds: string[];
  requirementIds: string[];
  reviewer: string;
  reviewedAt: string;
  result: "pass";
};

export type ManualTelegramAcceptanceV1 = {
  version: "manual-telegram-acceptance-v1";
  candidateSha: string;
  messageRecords: ManualTelegramMessageRecordV1[];
  scenarioSummaries: ManualTelegramScenarioSummaryV1[];
};

type CandidateDraftMessage = {
  id: string;
  artifactId: string;
  fixtureId: string;
  goldenId: string | null;
  requirementIds: string[];
  checkedWallet: string;
  productionPath: "where" | "deep" | "incoming" | "approval" | "contract" | "technical";
  payload: TelegramMessagePayloadV1;
  payloadSha256: string;
  delivery: ReturnType<typeof createPendingForensicTelegramDelivery>;
};

function fingerprintTelegramMessageContent(payload: TelegramMessagePayloadV1): string {
  return createHash("sha256").update(canonicalizeJson({
    text: payload.text,
    parseMode: payload.parseMode,
    replyMarkup: payload.replyMarkup
  })).digest("hex");
}

export type ManualTelegramCandidateDraftV1 = {
  version: "manual-telegram-candidate-draft-v1";
  candidateSha: string;
  runtimeLabel: string;
  transport: "recording_disabled";
  goldenComparisons: 11;
  scenarios: Array<{
    artifactId: string;
    fixtureIds: string[];
    goldenIds: string[];
    requirementIds: string[];
  }>;
  messages: CandidateDraftMessage[];
};

export type ManualTelegramCandidateRunV1 = Omit<ManualTelegramCandidateDraftV1, "version" | "messages"> & {
  version: "manual-telegram-candidate-run-v1";
  messages: Array<CandidateDraftMessage & { jobId: string; createdAt: string }>;
};

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as JsonRecord;
}

function exactKeys(value: JsonRecord, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} fields do not match the contract`);
  }
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error(`${label} must be a string array`);
  }
  if (new Set(value).size !== value.length) throw new Error(`${label} contains duplicates`);
  return [...value];
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function iso(value: unknown, label: string): string {
  const text = string(value, label);
  const date = new Date(text);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== text) throw new Error(`${label} must be UTC ISO time`);
  return text;
}

function fullSha(value: unknown, pattern: RegExp, label: string): string {
  const text = string(value, label);
  if (!pattern.test(text)) throw new Error(`${label} is invalid`);
  return text;
}

function currentLevel(score: number): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  return score >= 85 ? "CRITICAL" : score >= 70 ? "HIGH" : score >= 35 ? "MEDIUM" : "LOW";
}

function syntheticJob(source: RemediationTelegramUxSourceV1, kind: ForensicCheckJobKind, status: ForensicCheckJob["status"]): ForensicCheckJob {
  const at = new Date(source.evaluatedAt);
  return {
    id: `plan5-manual-${kind}`,
    kind,
    subjectAddress: source.checkedWalletAddress,
    status,
    windowStart: at,
    windowEnd: at,
    priority: 100,
    chatId: null,
    messageId: null,
    requestedBy: REQUESTED_BY,
    progressJson: { locale: source.locale },
    resultJson: {},
    rawEvidenceIds: [],
    observationIds: [],
    lastError: null,
    createdAt: at,
    updatedAt: at,
    startedAt: at,
    completedAt: status === "completed" || status === "partial" ? at : null
  };
}

function sourceWhereReport(source: RemediationTelegramUxSourceV1): WhereIsMoneyReport {
  const anchor = source.kind === "deep_context" && source.scoreAnchorV2
    ? { ...source.scoreAnchorV2, mode: "unified" as const }
    : source.scoreAnchorV2;
  const narrativeFacts = source.kind === "deep_context"
    ? source.narrativeFactsV2.map((fact) => fact.mode === "deep" ? { ...fact, mode: "unified" as const } : fact)
    : source.narrativeFactsV2;
  const technical = source.resultState === "technical_limit" || source.technicalLimitTextKey !== null;
  const trueNoActivity = narrativeFacts.some((fact) => fact.factTextKey === "true_no_principal_activity");
  const coverageV2 = trueNoActivity ? {
    version: "forensic-coverage-v2" as const,
    scope: "recent_flow" as const,
    availableInboundTxCount: 0,
    selectedInboundTxCount: 0,
    excludedInboundTxCount: 0,
    selectedAmountRaw: "0",
    tracedAmountRaw: "0",
    tracedShare: null,
    unresolvedAmountRaw: "0",
    unresolvedShare: null,
    exclusions: [],
    limitations: [],
    completeness: "complete" as const
  } : source.coverageV2 ?? undefined;
  const report: WhereIsMoneyReport = {
    ...PERSISTED_COVERAGE_WHERE_REPORT,
    subjectAddress: source.checkedWalletAddress,
    riskScore: anchor?.score ?? 0,
    decision: anchor?.decision ?? "REVIEW",
    userDecision: anchor?.decision ?? "NO_FINAL_DECISION",
    internalDecision: anchor?.decision ?? "REVIEW",
    scoreValid: anchor !== null,
    scoreBlockedReason: anchor || !technical ? null : "provider_cap_unresolved",
    technicalStatus: anchor || !technical ? null : "provider_limited",
    coverageV2,
    scoreAnchorV2: anchor ?? undefined,
    narrativeFactsV2: narrativeFacts,
    scoringEvidenceV2: source.scoringEvidenceV2,
    assessment: {
      ...PERSISTED_COVERAGE_WHERE_REPORT.assessment,
      riskScore: anchor?.score ?? 0,
      decision: anchor?.decision ?? "REVIEW"
    }
  };
  if (trueNoActivity) report.recentFlowPrincipalTransfers = [];
  if (!anchor && source.technicalLimitTextKey) {
    // The Telegram presentation contract has one release-only technical key
    // that predates the narrower persisted Where enum.
    (report as unknown as { scoreBlockedReason: string }).scoreBlockedReason = source.technicalLimitTextKey;
  }
  return report;
}

function renderWhere(source: RemediationTelegramUxSourceV1): string {
  const report = sourceWhereReport(source);
  const preliminary = source.kind === "where_preliminary";
  const job = syntheticJob(source, "where_is_money_check", preliminary ? "partial" : "completed");
  const deepJob = preliminary
    ? { ...syntheticJob(source, "address_deep_check", "queued"), status: "queued" as const }
    : null;
  return formatWhereIsMoneyUserDeliveryReport(job, report, preliminary ? "partial" : "completed", deepJob, {
    locale: source.locale
  }).text;
}

function renderDeep(source: RemediationTelegramUxSourceV1): string {
  const deepJob = syntheticJob(source, "address_deep_check", "completed");
  const whereReport = sourceWhereReport(source);
  const whereJob = {
    ...syntheticJob(source, "where_is_money_check", "completed"),
    resultJson: {
      subjectAddress: source.checkedWalletAddress,
      scoringPolicyVersion: "scoring-signal-matrix-v3",
      whereIsMoneyReport: whereReport
    }
  };
  const report = {
    scoringPolicyVersion: "scoring-signal-matrix-v3",
    subjectAddress: source.checkedWalletAddress,
    coverageV2: whereReport.coverageV2,
    scoreAnchorV2: source.scoreAnchorV2 ?? undefined,
    narrativeFactsV2: source.narrativeFactsV2,
    scoringEvidenceV2: source.scoringEvidenceV2
  } as unknown as DeepAddressForensicReport;
  return formatDeepForensicUserDeliveryReport(deepJob, report, "completed", whereJob, { locale: source.locale }).text;
}

function renderApproval(source: RemediationTelegramUxSourceV1): string {
  const approval = source.approvalInput;
  if (!approval) throw new Error("approval fixture is missing typed input");
  return formatUserApprovalAlert({
    locale: source.locale,
    watchedWallet: approval.assessment.subjectAddress,
    token: "USDT",
    spender: approval.assessment.allowance.spenderAddress,
    spenderType: "contract",
    allowanceType: approval.assessment.allowance.isUnlimited ? "unlimited" : "finite",
    allowanceAmount: approval.assessment.allowance.confirmedAllowanceRaw ?? undefined,
    approvalAt: new Date(source.evaluatedAt),
    expirationAt: new Date("2036-07-16T12:00:00.000Z"),
    approvalTxHash: approval.assessment.allowance.observedApprovalTxHash ?? "a".repeat(64),
    report: {
      subjectAddress: approval.assessment.subjectAddress,
      level: approval.assessment.level === "UNKNOWN" ? "HIGH" : approval.assessment.level,
      score: approval.assessment.score ?? 0,
      reasons: []
    },
    approvalPresentationInput: approval,
    approvalPresentationEvaluatedAt: new Date(source.evaluatedAt)
  }).text;
}

export function renderManualContractFixtureForRelease(
  source: RemediationTelegramUxSourceV1,
  dependencies: {
    buildEvidence: typeof buildContractDecisionEvidenceV1;
    resolveDecision: typeof resolveContractDecisionV2;
  } = {
    buildEvidence: buildContractDecisionEvidenceV1,
    resolveDecision: resolveContractDecisionV2
  }
): string {
  const fixtureDecision = source.contractDecision;
  if (!fixtureDecision) throw new Error("contract fixture is missing deterministic decision");
  const metadata = {
    address: source.checkedWalletAddress,
    source: "tronscan" as const,
    name: "release fixture",
    tag: "release fixture",
    isContract: true,
    verified: true,
    accountType: 2,
    rawJson: {},
    fetchedAt: new Date(source.evaluatedAt),
    expiresAt: new Date(source.evaluatedAt)
  };
  const canonicalEvidence = dependencies.buildEvidence({
    subjectAddress: source.checkedWalletAddress,
    metadata,
    serviceClassification: null,
    contractProfile: null,
    approvalSafetyAssessments: []
  });
  const canonicalDecision = dependencies.resolveDecision({
    subjectAddress: source.checkedWalletAddress,
    metadata,
    serviceClassification: null,
    contractProfile: null,
    approvalSafetyAssessments: [],
    evidence: canonicalEvidence
  });
  const officialUsdtSubject = source.checkedWalletAddress === TRON_USDT_CONTRACT_ADDRESS;
  const canonicalOfficialUsdt = canonicalDecision?.deterministic.authority === "official_registry" &&
    canonicalDecision.deterministic.score === 0 &&
    canonicalDecision.deterministic.evidenceIds.length === 1 &&
    canonicalDecision.deterministic.evidenceIds[0] === "registry:official-tron-usdt" &&
    canonicalEvidence.some((row) => row.id === "registry:official-tron-usdt" &&
      row.kind === "official_registry" && row.subjectAddress === TRON_USDT_CONTRACT_ADDRESS);
  if (officialUsdtSubject && !canonicalOfficialUsdt) {
    throw new Error("manual official USDT canonical evidence missing");
  }
  const decision = officialUsdtSubject ? canonicalDecision! : fixtureDecision;
  const evidenceKind = {
    exact_debit: "exact_debit",
    provider_risk: "provider_risk",
    verify20_fingerprint: "verify20_fingerprint",
    official_registry: "official_registry",
    gasfree_account: "gasfree_role",
    known_service_session: "service_action",
    context: "metadata_context"
  }[decision.deterministic.authority] as import("../src/types").ContractDecisionEvidenceV1["kind"];
  const report = {
    subjectAddress: source.checkedWalletAddress,
    decision: decision.deterministic.decision,
    decisionScope: "contract_safety",
    riskScore: decision.deterministic.score,
    riskLevel: decision.deterministic.level,
    metadata,
    contractProfile: null,
    relatedApprovals: [],
    llmVerdict: null,
    exactDrainProven: false,
    verify20Fingerprint: {
      matched: false,
      selectors: [],
      blockedByTrustedService: true,
      missingSelectors: [],
      mismatchedSelectors: []
    },
    serviceLabel: null,
    activityLabel: "normal",
    reasons: [],
    limitations: [],
    contractDecisionV2: decision,
    contractDecisionEvidenceV1: officialUsdtSubject ? canonicalEvidence : decision.deterministic.evidenceIds.map((id) => ({
      id,
      kind: evidenceKind,
      subjectAddress: source.checkedWalletAddress,
      spenderAddress: null,
      tokenContract: null
    }))
  } as unknown as SmartContractCheckReport;
  return formatSmartContractCheckReport(report, { locale: source.locale }).text;
}

function renderIncoming(source: RemediationTelegramUxSourceV1, jobId: string): { text: string; replyMarkup: Record<string, unknown> | null } {
  const anchor = source.scoreAnchorV2;
  const report = {
    scoringPolicyVersion: "scoring-signal-matrix-v3",
    scoreValid: anchor !== null,
    scoreBlockedReason: anchor ? null : "provider_error",
    technicalStatus: anchor ? "completed" : "provider_error",
    decision: anchor?.decision ?? "NO_FINAL_DECISION",
    depositRiskScore: anchor?.score ?? null,
    observedContextScore: anchor?.score ?? 0,
    riskBand: anchor ? currentLevel(anchor.score) : "MEDIUM",
    fastSenderRisk: null,
    originPaths: [],
    originCoverage: 0,
    fundingCoverage: { depositFundingCoverageRatio: 0, cleanSourceCoverageRatio: 0, exactContinuityCoverageRatio: 0 },
    corridorSummary: null,
    provenanceConfidence: 0,
    dataQuality: "partial",
    senderRole: "unknown",
    coverageV2: source.coverageV2 ?? undefined,
    hardBadEvidence: [],
    contractVerdicts: [],
    unifiedRiskSummary: {
      scoreAnchorV2: anchor,
      narrativeFactsV2: source.narrativeFactsV2,
      scoringEvidenceV2: source.scoringEvidenceV2,
      finalLevel: source.amlPresentation?.level ?? "MEDIUM",
      scoreValid: anchor !== null,
      finalScore: anchor?.score ?? null,
      finalDecision: anchor?.decision ?? "NO_FINAL_DECISION"
    },
    reasons: [],
    warnings: []
  } as unknown as IncomingDepositRiskReport;
  const rendered = formatIncomingDepositRiskAlert({
    jobId,
    amount: "1",
    watchedWallet: source.checkedWalletAddress,
    sender: source.checkedWalletAddress,
    txHash: "b".repeat(64),
    timestamp: new Date(source.evaluatedAt),
    locale: source.locale,
    report
  });
  return {
    text: rendered.text,
    replyMarkup: rendered.replyMarkup === null
      ? null
      : JSON.parse(JSON.stringify(rendered.replyMarkup)) as Record<string, unknown>
  };
}

function renderProductionFixture(source: RemediationTelegramUxSourceV1, jobId: string): {
  text: string;
  replyMarkup: Record<string, unknown> | null;
  productionPath: CandidateDraftMessage["productionPath"];
} {
  if (source.kind === "where_preliminary" || source.kind === "wallet_final") {
    return { text: renderWhere(source), replyMarkup: null, productionPath: "where" };
  }
  if (source.kind === "deep_context") return { text: renderDeep(source), replyMarkup: null, productionPath: "deep" };
  if (source.kind === "incoming_deposit") return { ...renderIncoming(source, jobId), productionPath: "incoming" };
  if (source.kind === "approval_safety") return { text: renderApproval(source), replyMarkup: null, productionPath: "approval" };
  if (source.kind === "contract_safety") return { text: renderManualContractFixtureForRelease(source), replyMarkup: null, productionPath: "contract" };
  // Exercise the authoritative technical boundary and require the full Where
  // path to preserve that boundary while adding its typed coverage supplement.
  const technical = renderTelegramTechnicalResult({
    checkedWalletAddress: source.checkedWalletAddress,
    locale: source.locale,
    evaluatedAt: new Date(source.evaluatedAt),
    reason: "provider_history_unavailable"
  });
  const text = renderWhere(source);
  const technicalLines = technical.split("\n").filter((line) => line.length > 0);
  if (technicalLines.some((line) => !text.includes(line))) {
    throw new Error("manual_technical_boundary_not_preserved");
  }
  return { text, replyMarkup: null, productionPath: "technical" };
}

function deliveryKind(path: CandidateDraftMessage["productionPath"]): Exclude<ForensicCheckJobKind, "address_fast_check"> {
  return path === "where" ? "where_is_money_check"
    : path === "incoming" ? "incoming_deposit_check"
      : "address_deep_check";
}

export async function buildManualTelegramCandidateDraft(input: {
  candidateSha: string;
  runtimeLabel: string;
}): Promise<ManualTelegramCandidateDraftV1> {
  const candidateSha = fullSha(input.candidateSha, SHA40, "candidateSha");
  const runtimeLabel = string(input.runtimeLabel, "runtimeLabel");
  if (!runtimeLabel.includes(candidateSha.slice(0, 8))) throw new Error("runtimeLabel does not bind candidateSha");
  const messages: CandidateDraftMessage[] = [];
  let goldenComparisons = 0;
  for (const definition of MANUAL_TELEGRAM_ACCEPTANCE_CASES) {
    for (const fixtureId of definition.fixtureIds) {
      const fixture = remediationTelegramUxCase(fixtureId);
      const id = `candidate-message-${String(messages.length + 1).padStart(2, "0")}`;
      const rendered = renderProductionFixture(fixture.source, id);
      const goldenId = definition.goldenIds.find((id) => id === fixtureId) ?? null;
      if (goldenId) {
        if (rendered.text !== REMEDIATION_TELEGRAM_GOLDEN_MESSAGES[goldenId]) {
          throw new Error(`manual_golden_production_path_mismatch:${goldenId}`);
        }
        goldenComparisons += 1;
      }
      const payload: TelegramMessagePayloadV1 = {
        version: "telegram-message-payload-v1",
        chatId: RECORDING_CHAT,
        text: rendered.text,
        parseMode: "HTML",
        replyMarkup: rendered.replyMarkup
      };
      if (!isTelegramMessagePayloadV1(payload)) throw new Error(`manual_payload_invalid:${fixtureId}`);
      messages.push({
        id,
        artifactId: definition.artifactId,
        fixtureId,
        goldenId,
        requirementIds: [...definition.expectedRequirementIds],
        checkedWallet: fixture.source.checkedWalletAddress,
        productionPath: rendered.productionPath,
        payload,
        payloadSha256: fingerprintTelegramMessageContent(payload),
        delivery: createPendingForensicTelegramDelivery({
          jobId: id,
          kind: deliveryKind(rendered.productionPath),
          payload,
          effect: null
        })
      });
    }
  }
  if (messages.length !== 19 || goldenComparisons !== 11 || MANUAL_TELEGRAM_ACCEPTANCE_CASES.length !== 15) {
    throw new Error("manual candidate draft count mismatch");
  }
  return {
    version: "manual-telegram-candidate-draft-v1",
    candidateSha,
    runtimeLabel,
    transport: "recording_disabled",
    goldenComparisons: 11,
    scenarios: MANUAL_TELEGRAM_ACCEPTANCE_CASES.map((definition) => ({
      artifactId: definition.artifactId,
      fixtureIds: [...definition.fixtureIds],
      goldenIds: [...definition.goldenIds],
      requirementIds: [...definition.expectedRequirementIds]
    })),
    messages
  };
}

export function bindManualTelegramCandidateRun(
  draft: ManualTelegramCandidateDraftV1,
  jobs: Array<{ fixtureId: string; jobId: string; createdAt: string }>
): ManualTelegramCandidateRunV1 {
  if (jobs.length !== draft.messages.length) throw new Error("manual job binding count mismatch");
  const byFixture = new Map(jobs.map((job) => [job.fixtureId, job]));
  if (byFixture.size !== jobs.length) throw new Error("manual job fixture binding duplicated");
  const messages = draft.messages.map((message) => {
    const job = byFixture.get(message.fixtureId);
    if (!job || !IDENTIFIER.test(job.jobId)) throw new Error(`manual job binding missing:${message.fixtureId}`);
    const rendered = renderProductionFixture(remediationTelegramUxCase(message.fixtureId).source, job.jobId);
    const payload: TelegramMessagePayloadV1 = {
      version: "telegram-message-payload-v1",
      chatId: RECORDING_CHAT,
      text: rendered.text,
      parseMode: "HTML",
      replyMarkup: rendered.replyMarkup
    };
    if (!isTelegramMessagePayloadV1(payload)) throw new Error(`manual bound payload invalid:${message.fixtureId}`);
    return {
      ...message,
      productionPath: rendered.productionPath,
      payload,
      payloadSha256: fingerprintTelegramMessageContent(payload),
      delivery: createPendingForensicTelegramDelivery({
        jobId: job.jobId,
        kind: deliveryKind(rendered.productionPath),
        payload,
        effect: null
      }),
      jobId: job.jobId,
      createdAt: iso(job.createdAt, "manual job createdAt")
    };
  });
  if (new Set(messages.map((message) => message.jobId)).size !== messages.length) throw new Error("manual job IDs duplicated");
  return { ...draft, version: "manual-telegram-candidate-run-v1", messages };
}

function parseMessage(value: unknown, index: number, candidateSha: string, runtimeLabel: string): ManualTelegramMessageRecordV1 {
  const item = record(value, `messageRecords[${index}]`);
  exactKeys(item, [
    "id", "scenarioId", "candidateSha", "runtimeLabel", "checkedWallet", "jobId", "telegramMessageId",
    "payloadSha256", "screenshotFilename", "screenshotSha256", "requirementIds", "result"
  ], `messageRecords[${index}]`);
  const screenshotFilename = string(item.screenshotFilename, `messageRecords[${index}].screenshotFilename`);
  if (!SCREENSHOT.test(screenshotFilename) || basename(screenshotFilename) !== screenshotFilename) {
    throw new Error("screenshotFilename must be a safe PNG basename");
  }
  if (item.candidateSha !== candidateSha || item.runtimeLabel !== runtimeLabel || item.result !== "pass") {
    throw new Error("manual message candidate/runtime/result binding mismatch");
  }
  if (!Number.isSafeInteger(item.telegramMessageId) || (item.telegramMessageId as number) <= 0) {
    throw new Error("telegramMessageId must be positive");
  }
  return {
    id: string(item.id, "message id"),
    scenarioId: string(item.scenarioId, "message scenarioId"),
    candidateSha,
    runtimeLabel,
    checkedWallet: string(item.checkedWallet, "checkedWallet"),
    jobId: string(item.jobId, "jobId"),
    telegramMessageId: item.telegramMessageId as number,
    payloadSha256: fullSha(item.payloadSha256, SHA256, "payloadSha256"),
    screenshotFilename,
    screenshotSha256: fullSha(item.screenshotSha256, SHA256, "screenshotSha256"),
    requirementIds: stringArray(item.requirementIds, "message requirementIds"),
    result: "pass"
  };
}

function parseScenario(value: unknown, index: number, candidateSha: string, runtimeLabel: string): ManualTelegramScenarioSummaryV1 {
  const item = record(value, `scenarioSummaries[${index}]`);
  exactKeys(item, [
    "scenarioId", "candidateSha", "runtimeLabel", "messageRecordIds", "fixtureIds", "goldenIds",
    "requirementIds", "reviewer", "reviewedAt", "result"
  ], `scenarioSummaries[${index}]`);
  if (item.candidateSha !== candidateSha || item.runtimeLabel !== runtimeLabel || item.result !== "pass") {
    throw new Error("manual scenario candidate/runtime/result binding mismatch");
  }
  return {
    scenarioId: string(item.scenarioId, "scenarioId"),
    candidateSha,
    runtimeLabel,
    messageRecordIds: stringArray(item.messageRecordIds, "scenario messageRecordIds"),
    fixtureIds: stringArray(item.fixtureIds, "scenario fixtureIds"),
    goldenIds: stringArray(item.goldenIds, "scenario goldenIds"),
    requirementIds: stringArray(item.requirementIds, "scenario requirementIds"),
    reviewer: string(item.reviewer, "scenario reviewer"),
    reviewedAt: iso(item.reviewedAt, "scenario reviewedAt"),
    result: "pass"
  };
}

export function validateManualTelegramAcceptance(
  value: unknown,
  expected: { candidateSha: string; runtimeLabel: string; goldenIds: readonly string[] }
): ManualTelegramAcceptanceV1 {
  assertNoSecretLikeArtifactValues(value);
  const root = record(value, "manual Telegram acceptance");
  exactKeys(root, ["version", "candidateSha", "messageRecords", "scenarioSummaries"], "manual Telegram acceptance");
  if (root.version !== "manual-telegram-acceptance-v1") throw new Error("manual Telegram acceptance version invalid");
  const candidateSha = fullSha(root.candidateSha, SHA40, "candidateSha");
  if (candidateSha !== expected.candidateSha || !expected.runtimeLabel.includes(candidateSha.slice(0, 8))) {
    throw new Error("manual Telegram candidate binding mismatch");
  }
  if (!Array.isArray(root.messageRecords) || root.messageRecords.length !== 19 ||
      !Array.isArray(root.scenarioSummaries) || root.scenarioSummaries.length !== 15) {
    throw new Error("manual Telegram evidence requires 19 messages and 15 scenarios");
  }
  const messages = root.messageRecords.map((item, index) => parseMessage(item, index, candidateSha, expected.runtimeLabel));
  const scenarios = root.scenarioSummaries.map((item, index) => parseScenario(item, index, candidateSha, expected.runtimeLabel));
  for (const values of [
    messages.map((item) => item.id), messages.map((item) => item.jobId),
    messages.map((item) => String(item.telegramMessageId)), messages.map((item) => item.screenshotFilename)
  ]) if (new Set(values).size !== values.length) throw new Error("manual Telegram message identity duplicated");
  const byId = new Map(messages.map((message) => [message.id, message]));
  for (let index = 0; index < MANUAL_TELEGRAM_ACCEPTANCE_CASES.length; index += 1) {
    const definition = MANUAL_TELEGRAM_ACCEPTANCE_CASES[index]!;
    const scenario = scenarios[index]!;
    if (scenario.scenarioId !== definition.artifactId ||
        !sameArray(scenario.fixtureIds, definition.fixtureIds) ||
        !sameArray(scenario.goldenIds, definition.goldenIds) ||
        !sameArray(scenario.requirementIds, definition.expectedRequirementIds) ||
        scenario.messageRecordIds.length !== definition.fixtureIds.length) {
      throw new Error(`manual scenario exact binding mismatch:${definition.artifactId}`);
    }
    const bound = scenario.messageRecordIds.map((id) => byId.get(id));
    if (bound.some((item) => !item) || bound.some((item) => item!.scenarioId !== definition.artifactId ||
        !sameArray(item!.requirementIds, definition.expectedRequirementIds))) {
      throw new Error(`manual message cross-reference mismatch:${definition.artifactId}`);
    }
  }
  const referenced = scenarios.flatMap((scenario) => scenario.messageRecordIds);
  if (referenced.length !== messages.length || new Set(referenced).size !== messages.length) {
    throw new Error("manual message records must be referenced exactly once");
  }
  const goldenIds = scenarios.flatMap((scenario) => scenario.goldenIds);
  if (!sameArray(goldenIds, expected.goldenIds) || goldenIds.length !== 11) {
    throw new Error("manual Telegram evidence requires the exact 11 golden comparisons");
  }
  return {
    version: "manual-telegram-acceptance-v1",
    candidateSha,
    messageRecords: messages,
    scenarioSummaries: scenarios
  };
}

function validateRun(run: ManualTelegramCandidateRunV1, candidateSha: string, runtimeLabel: string): void {
  if (run.version !== "manual-telegram-candidate-run-v1" || run.candidateSha !== candidateSha ||
      run.runtimeLabel !== runtimeLabel || run.transport !== "recording_disabled" ||
      run.messages.length !== 19 || run.scenarios.length !== 15 || run.goldenComparisons !== 11) {
    throw new Error("manual candidate run binding invalid");
  }
  for (const message of run.messages) {
    if (!isTelegramMessagePayloadV1(message.payload) || message.payload.chatId !== RECORDING_CHAT ||
        fingerprintTelegramMessageContent(message.payload) !== message.payloadSha256 ||
        message.delivery.payload.text !== message.payload.text || message.delivery.state.status !== "pending") {
      throw new Error(`manual candidate payload invalid:${message.fixtureId}`);
    }
  }
}

export function validateManualTelegramCandidateRun(
  value: unknown,
  expectedCandidateSha: string,
  expectedRuntimeLabel?: string
): ManualTelegramCandidateRunV1 {
  const root = record(value, "manual Telegram candidate run");
  exactKeys(root, [
    "version", "candidateSha", "runtimeLabel", "transport", "goldenComparisons", "scenarios", "messages"
  ], "manual Telegram candidate run");
  const candidateSha = fullSha(root.candidateSha, SHA40, "candidate run SHA");
  const runtimeLabel = string(root.runtimeLabel, "candidate run runtimeLabel");
  if (candidateSha !== expectedCandidateSha || !runtimeLabel.includes(candidateSha.slice(0, 8)) ||
      (expectedRuntimeLabel !== undefined && runtimeLabel !== expectedRuntimeLabel) ||
      !Array.isArray(root.scenarios) || !Array.isArray(root.messages)) {
    throw new Error("manual Telegram candidate run identity invalid");
  }
  for (const [index, scenarioValue] of root.scenarios.entries()) {
    const scenario = record(scenarioValue, `candidate scenario[${index}]`);
    exactKeys(scenario, ["artifactId", "fixtureIds", "goldenIds", "requirementIds"], `candidate scenario[${index}]`);
  }
  for (const [index, messageValue] of root.messages.entries()) {
    const message = record(messageValue, `candidate message[${index}]`);
    exactKeys(message, [
      "id", "artifactId", "fixtureId", "goldenId", "requirementIds", "checkedWallet", "productionPath",
      "payload", "payloadSha256", "delivery", "jobId", "createdAt"
    ], `candidate message[${index}]`);
    const path = string(message.productionPath, "candidate productionPath") as CandidateDraftMessage["productionPath"];
    if (!["where", "deep", "incoming", "approval", "contract", "technical"].includes(path) ||
        !IDENTIFIER.test(string(message.jobId, "candidate jobId")) ||
        !SHA256.test(string(message.payloadSha256, "candidate payloadSha256"))) {
      throw new Error(`manual candidate message identity invalid:${index}`);
    }
    iso(message.createdAt, "candidate job createdAt");
    if (!isForensicTelegramDeliveryV1(message.delivery, deliveryKind(path))) {
      throw new Error(`manual candidate delivery invalid:${index}`);
    }
  }
  const run = value as ManualTelegramCandidateRunV1;
  validateRun(run, candidateSha, runtimeLabel);
  assertNoSecretLikeArtifactValues({
    version: run.version,
    candidateSha: run.candidateSha,
    runtimeLabel: run.runtimeLabel,
    transport: run.transport,
    goldenComparisons: run.goldenComparisons,
    scenarios: run.scenarios,
    messages: run.messages.map((message) => ({
      id: message.id,
      artifactId: message.artifactId,
      fixtureId: message.fixtureId,
      goldenId: message.goldenId,
      requirementIds: message.requirementIds,
      checkedWallet: message.checkedWallet,
      productionPath: message.productionPath,
      text: message.payload.text,
      parseMode: message.payload.parseMode,
      replyMarkup: message.payload.replyMarkup,
      payloadSha256: message.payloadSha256,
      jobId: message.jobId,
      createdAt: message.createdAt
    }))
  });
  return run;
}

async function assertRunMatchesProductionDraft(run: ManualTelegramCandidateRunV1): Promise<void> {
  const draft = await buildManualTelegramCandidateDraft({
    candidateSha: run.candidateSha,
    runtimeLabel: run.runtimeLabel
  });
  if (JSON.stringify(run.scenarios) !== JSON.stringify(draft.scenarios)) {
    throw new Error("manual candidate scenarios do not match production draft");
  }
  for (let index = 0; index < draft.messages.length; index += 1) {
    const actual = run.messages[index];
    const draftMessage = draft.messages[index]!;
    if (!actual) throw new Error(`manual candidate production draft mismatch:${draftMessage.fixtureId}`);
    const expected = bindManualTelegramCandidateRun({ ...draft, messages: [draftMessage] }, [{
      fixtureId: draftMessage.fixtureId,
      jobId: actual.jobId,
      createdAt: actual.createdAt
    }]).messages[0]!;
    if (!actual || actual.id !== expected.id || actual.artifactId !== expected.artifactId ||
        actual.fixtureId !== expected.fixtureId || actual.goldenId !== expected.goldenId ||
        actual.checkedWallet !== expected.checkedWallet || actual.productionPath !== expected.productionPath ||
        !sameArray(actual.requirementIds, expected.requirementIds) ||
        actual.payloadSha256 !== expected.payloadSha256 ||
        JSON.stringify(actual.payload) !== JSON.stringify(expected.payload) ||
        JSON.stringify(actual.delivery) !== JSON.stringify(expected.delivery)) {
      throw new Error(`manual candidate production draft mismatch:${expected.fixtureId}`);
    }
  }
}

type ManualSendJournalRecord = {
  candidateSha: string;
  runtimeLabel: string;
  jobId: string;
  telegramMessageId: number;
  payloadSha256: string;
};

async function readCompleteManualSendJournal(
  root: string,
  run: ManualTelegramCandidateRunV1
): Promise<Map<string, ManualSendJournalRecord>> {
  const directory = `manual-send-${run.candidateSha}`;
  const journalPath = resolve(root, directory);
  const journalStat = await lstat(journalPath);
  if (!journalStat.isDirectory() || journalStat.isSymbolicLink() ||
      (await realpath(journalPath)).toLowerCase() !== journalPath.toLowerCase()) {
    throw new Error("manual send journal directory is unsafe");
  }
  const expectedFilenames = [
    ...run.messages.map((_, index) => `${String(index + 1).padStart(2, "0")}.json`),
    "complete.json"
  ].sort();
  const filenames = (await readdir(journalPath)).sort();
  if (!sameArray(filenames, expectedFilenames)) throw new Error("manual send journal file set is incomplete or foreign");
  const complete = record(parseJson(await readSafeArtifactFile(root, `${directory}/complete.json`)), "manual send complete journal");
  exactKeys(complete, ["candidateSha", "runtimeLabel", "messageCount"], "manual send complete journal");
  if (complete.candidateSha !== run.candidateSha || complete.runtimeLabel !== run.runtimeLabel || complete.messageCount !== 19) {
    throw new Error("manual send journal is partial or foreign");
  }
  const records = new Map<string, ManualSendJournalRecord>();
  const telegramIds = new Set<number>();
  for (let index = 0; index < run.messages.length; index += 1) {
    const expected = run.messages[index]!;
    const raw = record(parseJson(await readSafeArtifactFile(
      root,
      `${directory}/${String(index + 1).padStart(2, "0")}.json`
    )), `manual send journal[${index}]`);
    exactKeys(raw, ["candidateSha", "runtimeLabel", "jobId", "telegramMessageId", "payloadSha256"], `manual send journal[${index}]`);
    if (raw.candidateSha !== run.candidateSha || raw.runtimeLabel !== run.runtimeLabel ||
        raw.jobId !== expected.jobId || raw.payloadSha256 !== expected.payloadSha256 ||
        !Number.isSafeInteger(raw.telegramMessageId) || (raw.telegramMessageId as number) <= 0 ||
        telegramIds.has(raw.telegramMessageId as number)) {
      throw new Error(`manual send journal binding mismatch:${expected.fixtureId}`);
    }
    telegramIds.add(raw.telegramMessageId as number);
    records.set(expected.jobId, raw as ManualSendJournalRecord);
  }
  return records;
}

export async function finalizeManualTelegramAcceptance(
  value: unknown,
  expected: {
    candidateSha: string;
    runtimeLabel: string;
    goldenIds: readonly string[];
    candidateRun: ManualTelegramCandidateRunV1;
    artifactRoot: string;
  }
): Promise<ManualTelegramAcceptanceV1> {
  const parsed = validateManualTelegramAcceptance(value, expected);
  validateRun(expected.candidateRun, expected.candidateSha, expected.runtimeLabel);
  await assertRunMatchesProductionDraft(expected.candidateRun);
  const root = await resolveExternalArtifactRoot(expected.artifactRoot);
  const sendJournal = await readCompleteManualSendJournal(root, expected.candidateRun);
  const byScenario = new Map<string, ManualTelegramMessageRecordV1[]>();
  for (const message of parsed.messageRecords) {
    const list = byScenario.get(message.scenarioId) ?? [];
    list.push(message);
    byScenario.set(message.scenarioId, list);
  }
  for (const definition of MANUAL_TELEGRAM_ACCEPTANCE_CASES) {
    const records = byScenario.get(definition.artifactId) ?? [];
    const runMessages = expected.candidateRun.messages.filter((message) => message.artifactId === definition.artifactId);
    for (let index = 0; index < definition.fixtureIds.length; index += 1) {
      const recordValue = records[index];
      const runMessage = runMessages[index];
      if (!recordValue || !runMessage || runMessage.fixtureId !== definition.fixtureIds[index] ||
          recordValue.jobId !== runMessage.jobId || recordValue.checkedWallet !== runMessage.checkedWallet ||
          recordValue.payloadSha256 !== runMessage.payloadSha256 ||
          sendJournal.get(runMessage.jobId)?.telegramMessageId !== recordValue.telegramMessageId) {
        throw new Error(`manual candidate message binding mismatch:${definition.fixtureIds[index]}`);
      }
      const screenshot = await readSafeArtifactFile(root, recordValue.screenshotFilename);
      if (screenshot.length < PNG_SIGNATURE.length || screenshot.length > MAX_SCREENSHOT_BYTES ||
          !screenshot.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
          !screenshot.subarray(-PNG_IEND.length).equals(PNG_IEND) ||
          createHash("sha256").update(screenshot).digest("hex") !== recordValue.screenshotSha256) {
        throw new Error(`manual screenshot hash mismatch:${recordValue.screenshotFilename}`);
      }
    }
  }
  return parsed;
}

type ManualTask0BVerificationInput = {
  task0bEvidence: unknown;
  candidateStartEvidence: unknown;
  evaluatedAt: string;
  databaseUrl: string;
  currentTask0B?: { evidence: unknown; freeze: unknown };
};

function validateManualTask0B(
  input: ManualTask0BVerificationInput,
  candidateSha: string,
  evaluatedAt: string
) {
  const task0b = validateTask0BReleaseFreezeEvidence(
    input.task0bEvidence,
    candidateSha,
    input.currentTask0B ? undefined : evaluatedAt
  );
  if (input.currentTask0B) {
    validateTask0BReleaseRevalidationEvidence(
      input.currentTask0B.evidence,
      task0b,
      input.currentTask0B.freeze,
      evaluatedAt
    );
  }
  return task0b;
}

export async function seedManualTelegramCandidateJobs(
  db: DbLike,
  draft: ManualTelegramCandidateDraftV1,
  input: ManualTask0BVerificationInput
): Promise<ManualTelegramCandidateRunV1> {
  const evaluatedAt = iso(input.evaluatedAt, "manual evaluatedAt");
  const task0b = validateManualTask0B(input, draft.candidateSha, evaluatedAt);
  validateManualCandidateStartEvidence(input.candidateStartEvidence, draft, task0b);
  await verifyManualDatabaseIdentity(db, input.databaseUrl, task0b);
  const migrationBytes = await readFile(new URL(`../migrations/${REQUIRED_SCHEMA_FILENAME}`, import.meta.url));
  const checksum = await checksumMigrationBytes(migrationBytes);
  await verifyRequiredSchema032(db as never, checksum);
  const jobs: Array<{ fixtureId: string; jobId: string; createdAt: string }> = [];
  await db.query("begin");
  try {
    await db.query("select pg_advisory_xact_lock(hashtext('plan5_manual_telegram_seed'))");
    const conflicting = await db.query(`select id from forensic_check_jobs
      where status in ('queued', 'running') and priority >= $1 and requested_by is distinct from $2
      limit 1`, [2_000_000_000, REQUESTED_BY]);
    if (conflicting.rows.length > 0) throw new Error("manual synthetic jobs would conflict with another claimable job");
    const previous = await db.query("select id from forensic_check_jobs where requested_by = $1 limit 1", [REQUESTED_BY]);
    if (previous.rows.length > 0) throw new Error("manual synthetic jobs already exist");
    for (let index = 0; index < draft.messages.length; index += 1) {
      const message = draft.messages[index]!;
      const end = new Date(Date.parse(evaluatedAt) + index + 1);
      const created = await createOrReuseForensicCheckJob(db as never, {
        kind: deliveryKind(message.productionPath),
        subjectAddress: message.checkedWallet,
        windowStart: new Date(end.getTime() - 1),
        windowEnd: end,
        priority: 2_000_000_000,
        chatId: null,
        requestedBy: REQUESTED_BY,
        progressJson: { locale: "ru", manualArtifactId: message.artifactId, manualFixtureId: message.fixtureId }
      });
      const claimed = await claimNextForensicCheckJob(db as never, { kinds: [created.kind] });
      if (!claimed || claimed.id !== created.id) throw new Error("manual synthetic job claim mismatch");
      const boundMessage = bindManualTelegramCandidateRun({ ...draft, messages: [message] }, [{
        fixtureId: message.fixtureId,
        jobId: claimed.id,
        createdAt: claimed.createdAt.toISOString()
      }]).messages[0]!;
      const completed = await completeForensicCheckJob(db as never, {
        id: claimed.id,
        status: "completed",
        progressJson: {
          ...claimed.progressJson,
          jobPhase: "completed",
          plan5ManualTelegramAcceptance: {
            artifactId: boundMessage.artifactId,
            fixtureId: boundMessage.fixtureId,
            candidateSha: draft.candidateSha,
            runtimeLabel: draft.runtimeLabel
          }
        },
        resultJson: {
          manualTelegramAcceptance: {
            transport: "recording_disabled",
            artifactId: boundMessage.artifactId,
            fixtureId: boundMessage.fixtureId,
            candidateSha: draft.candidateSha,
            runtimeLabel: draft.runtimeLabel,
            payloadSha256: boundMessage.payloadSha256,
            payload: boundMessage.payload,
            delivery: boundMessage.delivery
          }
        },
        rawEvidenceIds: [],
        observationIds: [],
        lastError: null
      });
      if (!completed) throw new Error("manual synthetic job completion failed");
      const saved = await getForensicCheckJob(db as never, claimed.id);
      if (!saved || saved.status !== "completed" || saved.progressJson.telegramDelivery !== undefined ||
          saved.createdAt.getTime() <= Date.parse(task0b.freezeCutoff)) {
        throw new Error("manual synthetic job terminal binding invalid");
      }
      jobs.push({ fixtureId: message.fixtureId, jobId: saved.id, createdAt: saved.createdAt.toISOString() });
    }
    await db.query("commit");
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  }
  return bindManualTelegramCandidateRun(draft, jobs);
}

type Task0BBinding = ReturnType<typeof validateTask0BReleaseFreezeEvidence>;

function validateManualCandidateStartEvidence(
  value: unknown,
  candidate: { candidateSha: string; runtimeLabel: string },
  task0b: Task0BBinding
): void {
  const evidence = record(value, "manual candidate start evidence");
  exactKeys(evidence, [
    "version", "runtimeSha", "runtimeLabel", "commandId", "redactedTemplateSha256", "exitCode"
  ], "manual candidate start evidence");
  if (evidence.version !== "runtime-start-command-evidence-v1" ||
      evidence.runtimeSha !== candidate.candidateSha || evidence.runtimeLabel !== candidate.runtimeLabel ||
      evidence.commandId !== task0b.candidateStartCommandId ||
      evidence.redactedTemplateSha256 !== task0b.candidateStartTemplateSha256 || evidence.exitCode !== 0) {
    throw new Error("manual candidate runtime start evidence mismatch");
  }
}

async function verifyManualDatabaseIdentity(db: DbLike, databaseUrlValue: string, task0b: Task0BBinding): Promise<void> {
  const databaseUrl = new URL(string(databaseUrlValue, "manual databaseUrl"));
  const hostname = databaseUrl.hostname.toLowerCase();
  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ""));
  if (!["127.0.0.1", "::1", "[::1]", "localhost"].includes(hostname) ||
      databaseName !== task0b.databaseName || databaseName !== "tron_watch_plan5_runtime_sanitized") {
    throw new Error("manual jobs require loopback runtime_sanitized database URL");
  }
  const identity = await db.query(`select current_database() as database_name,
    current_setting('server_version_num') as server_version_num,
    (select oid::text from pg_database where datname = current_database()) as database_oid,
    (pg_control_system()).system_identifier::text as system_identifier`);
  const row = identity.rows[0];
  if (identity.rows.length !== 1 || row?.database_name !== databaseName) {
    throw new Error("manual runtime_sanitized database identity mismatch");
  }
  const fingerprint = buildSchema032DatabaseFingerprint({
    databaseEndpoint: `${hostname}:${databaseUrl.port || "5432"}`,
    systemIdentifier: String(row.system_identifier),
    databaseName,
    databaseOid: String(row.database_oid),
    serverVersion: String(row.server_version_num)
  });
  if (fingerprint !== task0b.databaseFingerprintSha256) {
    throw new Error("manual runtime_sanitized database fingerprint mismatch");
  }
}

export async function verifyManualTelegramCandidateJobs(
  db: DbLike,
  run: ManualTelegramCandidateRunV1,
  input: ManualTask0BVerificationInput
): Promise<void> {
  const evaluatedAt = iso(input.evaluatedAt, "manual verification evaluatedAt");
  const task0b = validateManualTask0B(input, run.candidateSha, evaluatedAt);
  validateManualCandidateStartEvidence(input.candidateStartEvidence, run, task0b);
  await verifyManualDatabaseIdentity(db, input.databaseUrl, task0b);
  const migrationBytes = await readFile(new URL(`../migrations/${REQUIRED_SCHEMA_FILENAME}`, import.meta.url));
  await verifyRequiredSchema032(db as never, await checksumMigrationBytes(migrationBytes));
  const ids = run.messages.map((message) => message.jobId);
  const population = await db.query("select id from forensic_check_jobs where requested_by = $1 order by id", [REQUESTED_BY]);
  const populationIds = population.rows.map((row) => String(row.id)).sort();
  const expectedIds = [...ids].sort();
  if (!sameArray(populationIds, expectedIds)) {
    throw new Error("manual candidate job population mismatch");
  }
  const result = await db.query(`select id, subject_address, status, requested_by, created_at, progress_json, result_json
    from forensic_check_jobs where id = any($1::text[])`, [ids]);
  if (result.rows.length !== run.messages.length) throw new Error("manual candidate job row count mismatch");
  const rows = new Map(result.rows.map((row) => [String(row.id), row]));
  for (const message of run.messages) {
    const row = rows.get(message.jobId);
    const progress = row?.progress_json as JsonRecord | undefined;
    const saved = (row?.result_json as JsonRecord | undefined)?.manualTelegramAcceptance as JsonRecord | undefined;
    const checks: Record<string, boolean> = {
      row: Boolean(row),
      subject: row?.subject_address === message.checkedWallet,
      status: row?.status === "completed",
      owner: row?.requested_by === REQUESTED_BY,
      createdAt: row ? new Date(row.created_at).toISOString() === message.createdAt : false,
      cutoff: row ? new Date(row.created_at).getTime() > Date.parse(task0b.freezeCutoff) : false,
      nonclaimable: progress?.telegramDelivery === undefined,
      phase: progress?.jobPhase === "completed",
      transport: saved?.transport === "recording_disabled",
      candidate: saved?.candidateSha === run.candidateSha,
      runtime: saved?.runtimeLabel === run.runtimeLabel,
      artifact: saved?.artifactId === message.artifactId,
      fixture: saved?.fixtureId === message.fixtureId,
      payloadHash: saved?.payloadSha256 === message.payloadSha256,
      payload: saved?.payload !== undefined && canonicalizeJson(saved.payload) === canonicalizeJson(message.payload),
      delivery: saved?.delivery !== undefined && canonicalizeJson(saved.delivery) === canonicalizeJson(message.delivery)
    };
    const failures = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
    if (failures.length > 0) throw new Error(`manual candidate job binding mismatch:${message.fixtureId}:${failures.join(",")}`);
  }
}

async function writeExclusiveAtomic(path: string, bytes: Buffer): Promise<void> {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, bytes, { flag: "wx" });
  try {
    await link(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

export async function persistManualTelegramCandidateRun(
  value: unknown,
  input: { artifactRoot: string; candidateSha: string; runtimeLabel: string }
): Promise<void> {
  const run = validateManualTelegramCandidateRun(value, input.candidateSha, input.runtimeLabel);
  await assertRunMatchesProductionDraft(run);
  const root = await resolveExternalArtifactRoot(input.artifactRoot);
  await writeExclusiveAtomic(
    join(root, "manual-telegram-candidate-run.json"),
    Buffer.from(`${JSON.stringify(run)}\n`)
  );
}

export async function sendManualTelegramCandidateRunOnce(
  run: ManualTelegramCandidateRunV1,
  input: {
    artifactRoot: string;
    allowSend: string | undefined;
    botToken: string | undefined;
    testChatId: string | undefined;
    productionBotToken: string | undefined;
    productionChatIds: readonly string[];
    sendMessage?: (input: {
      token: string;
      chatId: string;
      payload: TelegramMessagePayloadV1;
    }) => Promise<{ messageId: number }>;
  }
): Promise<Array<{ jobId: string; telegramMessageId: number; payloadSha256: string }>> {
  validateRun(run, run.candidateSha, run.runtimeLabel);
  await assertRunMatchesProductionDraft(run);
  assertTelegramUxAcceptanceSendAuthorized({
    sendRequested: true,
    allowSend: input.allowSend,
    botToken: input.botToken,
    testChatId: input.testChatId,
    productionChatIds: input.productionChatIds,
    productionBotToken: input.productionBotToken,
    productionReferencesRequired: true
  });
  const token = input.botToken!.trim();
  const chatId = input.testChatId!.trim();
  const root = await resolveExternalArtifactRoot(input.artifactRoot);
  const journalRoot = join(root, `manual-send-${run.candidateSha}`);
  await mkdir(journalRoot, { recursive: false });
  const sender = input.sendMessage ?? (async ({ token: botToken, chatId: target, payload }) => {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        chat_id: target,
        text: payload.text,
        parse_mode: payload.parseMode,
        reply_markup: payload.replyMarkup,
        link_preview_options: { is_disabled: true }
      })
    });
    if (!response.ok) throw new Error("manual Telegram send failed");
    const body = await response.json() as { ok?: unknown; result?: { message_id?: unknown } };
    const messageId = body.result?.message_id;
    if (body.ok !== true || !Number.isSafeInteger(messageId) || (messageId as number) <= 0) {
      throw new Error("manual Telegram response invalid");
    }
    return { messageId: messageId as number };
  });
  const records: Array<{ jobId: string; telegramMessageId: number; payloadSha256: string }> = [];
  for (const [index, message] of run.messages.entries()) {
    const sent = await sender({
      token,
      chatId,
      payload: { ...message.payload, chatId }
    });
    if (!Number.isSafeInteger(sent.messageId) || sent.messageId <= 0) throw new Error("manual Telegram message id invalid");
    const persisted = {
      candidateSha: run.candidateSha,
      runtimeLabel: run.runtimeLabel,
      jobId: message.jobId,
      telegramMessageId: sent.messageId,
      payloadSha256: message.payloadSha256
    };
    assertNoSecretLikeArtifactValues(persisted);
    await writeExclusiveAtomic(
      join(journalRoot, `${String(index + 1).padStart(2, "0")}.json`),
      Buffer.from(`${JSON.stringify(persisted)}\n`)
    );
    records.push({ jobId: message.jobId, telegramMessageId: sent.messageId, payloadSha256: message.payloadSha256 });
  }
  await writeExclusiveAtomic(
    join(journalRoot, "complete.json"),
    Buffer.from(`${JSON.stringify({
      candidateSha: run.candidateSha,
      runtimeLabel: run.runtimeLabel,
      messageCount: records.length
    })}\n`)
  );
  return records;
}

function parseJson(bytes: Buffer): unknown {
  try { return JSON.parse(bytes.toString("utf8")) as unknown; } catch { throw new Error("manual evidence JSON invalid"); }
}

type ManualTelegramCommandAction = "prepare" | "send" | "finalize";
type ManualTelegramCommandEnvironment = Partial<Record<
  | "PLAN5_TELEGRAM_MANUAL_ACTION"
  | "PLAN5_SCHEMA_RUNTIME_SANITIZED_DATABASE_URL"
  | "PLAN4_TELEGRAM_ALLOW_SEND"
  | "PLAN4_TELEGRAM_TEST_BOT_TOKEN"
  | "PLAN4_TELEGRAM_TEST_CHAT_ID"
  | "BOT_TOKEN"
  | "SERVICE_ADMIN_TG_IDS",
  string
>>;

export type ManualTelegramCommandOperations = {
  prepare(artifactRoot: string, env: ManualTelegramCommandEnvironment): Promise<void>;
  send(artifactRoot: string, env: ManualTelegramCommandEnvironment): Promise<void>;
  finalize(artifactRoot: string, env: ManualTelegramCommandEnvironment): Promise<void>;
};

async function manualCandidateIdentity(root: string): Promise<{
  candidateSha: string;
  runtimeLabel: string;
  candidateStartEvidence: unknown;
}> {
  const candidateStartEvidence = parseJson(await readSafeArtifactFile(root, "runtime-candidate-start-evidence.json"));
  return {
    candidateSha: fullSha(requiredCandidateStartField(candidateStartEvidence, "runtimeSha"), SHA40, "candidate runtimeSha"),
    runtimeLabel: requiredCandidateStartField(candidateStartEvidence, "runtimeLabel"),
    candidateStartEvidence
  };
}

async function recoverManualTelegramCandidateRun(
  db: DbLike,
  draft: ManualTelegramCandidateDraftV1,
  input: ManualTask0BVerificationInput
): Promise<ManualTelegramCandidateRunV1 | null> {
  const existing = await db.query(`select id, created_at, progress_json
    from forensic_check_jobs where requested_by = $1 order by id`, [REQUESTED_BY]);
  if (existing.rows.length === 0) return null;
  if (existing.rows.length !== draft.messages.length) {
    throw new Error("manual candidate recovery requires the exact terminal job set");
  }
  const jobs = existing.rows.map((row) => {
    const progress = record(row.progress_json, "manual recovery progress");
    return {
      fixtureId: string(progress.manualFixtureId, "manual recovery fixtureId"),
      jobId: string(row.id, "manual recovery jobId"),
      createdAt: new Date(row.created_at).toISOString()
    };
  });
  const run = bindManualTelegramCandidateRun(draft, jobs);
  await verifyManualTelegramCandidateJobs(db, run, input);
  return run;
}

async function prepareManualTelegramCommand(
  artifactRoot: string,
  env: ManualTelegramCommandEnvironment
): Promise<void> {
  const root = await resolveExternalArtifactRoot(artifactRoot);
  const identity = await manualCandidateIdentity(root);
  const task0bEvidence = parseJson(await readSafeArtifactFile(root, "task0b-release-freeze.json"));
  const databaseUrl = env.PLAN5_SCHEMA_RUNTIME_SANITIZED_DATABASE_URL;
  if (!databaseUrl) throw new Error("manual command runtime_sanitized database URL missing");
  const runPath = join(root, "manual-telegram-candidate-run.json");
  const runAlreadyExists = await lstat(runPath).then(
    () => true,
    (error: NodeJS.ErrnoException) => error.code === "ENOENT" ? false : Promise.reject(error)
  );
  const draft = await buildManualTelegramCandidateDraft(identity);
  const evaluatedAt = new Date().toISOString();
  const currentTask0B = await readCurrentTask0BReleaseRevalidation(root, evaluatedAt);
  if (canonicalizeJson(task0bEvidence) !== canonicalizeJson(currentTask0B.frozen)) {
    throw new Error("manual Task0B artifact differs from current immutable freeze binding");
  }
  const verification = {
    task0bEvidence,
    candidateStartEvidence: identity.candidateStartEvidence,
    evaluatedAt,
    databaseUrl,
    currentTask0B
  };
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    if (runAlreadyExists) {
      const run = await loadManualTelegramRun(root);
      await verifyManualTelegramCandidateJobs(db, run, verification);
      return;
    }
    const run = await recoverManualTelegramCandidateRun(db, draft, verification) ??
      await seedManualTelegramCandidateJobs(db, draft, verification);
    await persistManualTelegramCandidateRun(run, {
      artifactRoot: root,
      candidateSha: identity.candidateSha,
      runtimeLabel: identity.runtimeLabel
    });
  } finally {
    await db.end().catch(() => undefined);
  }
}

async function loadManualTelegramRun(root: string): Promise<ManualTelegramCandidateRunV1> {
  const identity = await manualCandidateIdentity(root);
  return validateManualTelegramCandidateRun(
    parseJson(await readSafeArtifactFile(root, "manual-telegram-candidate-run.json")),
    identity.candidateSha,
    identity.runtimeLabel
  );
}

async function sendManualTelegramCommand(
  artifactRoot: string,
  env: ManualTelegramCommandEnvironment
): Promise<void> {
  const root = await resolveExternalArtifactRoot(artifactRoot);
  const run = await loadManualTelegramRun(root);
  const currentTask0B = await readCurrentTask0BReleaseRevalidation(root, new Date().toISOString());
  if (currentTask0B.frozen.candidateSha !== run.candidateSha) {
    throw new Error("manual send candidate differs from current immutable freeze binding");
  }
  await sendManualTelegramCandidateRunOnce(run, {
    artifactRoot: root,
    allowSend: env.PLAN4_TELEGRAM_ALLOW_SEND,
    botToken: env.PLAN4_TELEGRAM_TEST_BOT_TOKEN,
    testChatId: env.PLAN4_TELEGRAM_TEST_CHAT_ID,
    productionBotToken: env.BOT_TOKEN,
    productionChatIds: (env.SERVICE_ADMIN_TG_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean)
  });
}

async function finalizeManualTelegramAtRoot(
  artifactRoot: string,
  candidateSha: string,
  runtimeLabel: string,
  env: ManualTelegramCommandEnvironment
): Promise<void> {
  const root = await resolveExternalArtifactRoot(artifactRoot);
  const candidateStartEvidence = parseJson(await readSafeArtifactFile(root, "runtime-candidate-start-evidence.json"));
  if (requiredCandidateStartField(candidateStartEvidence, "runtimeSha") !== candidateSha ||
      requiredCandidateStartField(candidateStartEvidence, "runtimeLabel") !== runtimeLabel) {
    throw new Error("manual finalizer candidate runtime mismatch");
  }
  const runBytes = await readSafeArtifactFile(root, "manual-telegram-candidate-run.json");
  const run = validateManualTelegramCandidateRun(parseJson(runBytes), candidateSha, runtimeLabel);
  const task0bEvidence = parseJson(await readSafeArtifactFile(root, "task0b-release-freeze.json"));
  const databaseUrl = env.PLAN5_SCHEMA_RUNTIME_SANITIZED_DATABASE_URL;
  if (!databaseUrl) throw new Error("manual finalizer runtime_sanitized database URL missing");
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const evaluatedAt = new Date().toISOString();
    const currentTask0B = await readCurrentTask0BReleaseRevalidation(root, evaluatedAt);
    if (canonicalizeJson(task0bEvidence) !== canonicalizeJson(currentTask0B.frozen)) {
      throw new Error("manual Task0B artifact differs from current immutable freeze binding");
    }
    await verifyManualTelegramCandidateJobs(db, run, {
      task0bEvidence,
      candidateStartEvidence,
      evaluatedAt,
      databaseUrl,
      currentTask0B
    });
  } finally {
    await db.end().catch(() => undefined);
  }
  const pending = await readSafeArtifactFile(root, "manual-telegram-acceptance.pending.json");
  const finalized = await finalizeManualTelegramAcceptance(parseJson(pending), {
    candidateSha,
    runtimeLabel,
    goldenIds: MANUAL_TELEGRAM_ACCEPTANCE_CASES.flatMap((item) => item.goldenIds),
    candidateRun: run,
    artifactRoot: root
  });
  await writeExclusiveAtomic(join(root, "manual-telegram-acceptance.json"), Buffer.from(`${JSON.stringify(finalized)}\n`));
}

async function finalizeManualTelegramCommand(
  artifactRoot: string,
  env: ManualTelegramCommandEnvironment
): Promise<void> {
  const root = await resolveExternalArtifactRoot(artifactRoot);
  const identity = await manualCandidateIdentity(root);
  await finalizeManualTelegramAtRoot(root, identity.candidateSha, identity.runtimeLabel, env);
}

const DEFAULT_MANUAL_TELEGRAM_COMMAND_OPERATIONS: ManualTelegramCommandOperations = {
  prepare: prepareManualTelegramCommand,
  send: sendManualTelegramCommand,
  finalize: finalizeManualTelegramCommand
};

export async function runManualTelegramCommand(
  args: readonly string[],
  env: ManualTelegramCommandEnvironment,
  operations: ManualTelegramCommandOperations = DEFAULT_MANUAL_TELEGRAM_COMMAND_OPERATIONS
): Promise<ManualTelegramCommandAction> {
  if (args.length !== 1 || !args[0] || args[0].startsWith("--")) {
    throw new Error("manual Telegram command requires exactly one artifact root");
  }
  const action = env.PLAN5_TELEGRAM_MANUAL_ACTION ?? "prepare";
  if (action !== "prepare" && action !== "send" && action !== "finalize") {
    throw new Error("manual Telegram command action invalid");
  }
  if (action === "send") {
    assertTelegramUxAcceptanceSendAuthorized({
      sendRequested: true,
      allowSend: env.PLAN4_TELEGRAM_ALLOW_SEND,
      botToken: env.PLAN4_TELEGRAM_TEST_BOT_TOKEN,
      testChatId: env.PLAN4_TELEGRAM_TEST_CHAT_ID,
      productionBotToken: env.BOT_TOKEN,
      productionChatIds: (env.SERVICE_ADMIN_TG_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean),
      productionReferencesRequired: true
    });
  }
  await operations[action](args[0], env);
  return action;
}

async function finalizerMain(): Promise<void> {
  const args = process.argv.slice(2);
  const allowed = new Set(["--artifact-root", "--runtime-label", "--candidate-sha"]);
  const entries = new Map<string, string>();
  if (args.length === 3 && args.every((value) => !value.startsWith("--"))) {
    entries.set("--artifact-root", args[0]!);
    entries.set("--candidate-sha", args[1]!);
    entries.set("--runtime-label", args[2]!);
  } else {
    if (args.length !== 6 || args.some((value, index) => index % 2 === 0 && !allowed.has(value))) {
      throw new Error("manual finalizer arguments invalid");
    }
    for (let index = 0; index < args.length; index += 2) {
      const flag = args[index]!;
      if (entries.has(flag)) throw new Error("manual finalizer arguments duplicated");
      entries.set(flag, args[index + 1] ?? "");
    }
  }
  if (entries.size !== allowed.size) throw new Error("manual finalizer arguments missing");
  const candidateSha = entries.get("--candidate-sha")!;
  const runtimeLabel = entries.get("--runtime-label")!;
  await finalizeManualTelegramAtRoot(entries.get("--artifact-root")!, candidateSha, runtimeLabel, process.env);
}

function requiredCandidateStartField(value: unknown, field: string): string {
  const result = record(value, "candidate start evidence")[field];
  return string(result, `candidate start ${field}`);
}

const invoked = process.argv[1] ? resolve(process.argv[1]) : "";
if (invoked === fileURLToPath(import.meta.url)) {
  const execution = process.env.npm_lifecycle_event === "release:telegram:manual"
    ? runManualTelegramCommand(process.argv.slice(2), process.env)
    : finalizerMain();
  execution.catch(() => {
    process.stderr.write("manual_telegram_acceptance_invalid\n");
    process.exitCode = 1;
  });
}
