import { createHash } from "node:crypto";
import { posix } from "node:path";
import {
  REMEDIATION_REQUIRED_ACCEPTANCE_IDS,
  REMEDIATION_REQUIRED_REQUIREMENT_IDS,
  assertExactIdSet,
  assertNoSecretLikeArtifactValues
} from "./remediationReleaseManifest";

type AcceptanceTraceRedCommonV1 = {
  baseSha: string;
  testCommitSha: string;
  redExecutionCommitSha: string;
  testPatchSha256: string;
  vitestReportSha256: string;
  expectedFailureFingerprint: string;
  status: "failed_as_expected";
};

export type AcceptanceTraceRedV1 =
  | (AcceptanceTraceRedCommonV1 & { kind: "behavioral_assertion" })
  | (AcceptanceTraceRedCommonV1 & {
      kind: "local_product_module_absent";
      missingProductModulePath: string;
    });

export type AcceptanceTraceV1 = {
  acceptanceId: string;
  requirementIds: string[];
  ownerPlan: 1 | 2 | 3 | 4 | 5;
  ownerCommitSha: string;
  testFile: string;
  fullName: string;
  primary: boolean;
  red: AcceptanceTraceRedV1;
  green: {
    candidateSha: string;
    vitestReportSha256: string;
    status: "passed";
  };
};

export type AcceptanceExecutionStatus = "passed" | "failed" | "skipped" | "todo";

export type AcceptanceExecutionV1 = {
  testFile: string;
  fullName: string;
  status: AcceptanceExecutionStatus;
};

export type AcceptanceTraceSetV1 = {
  version: "acceptance-trace-set-v1";
  candidateSha: string;
  requiredRequirementIds: string[];
  requiredAcceptanceIds: string[];
  traces: AcceptanceTraceV1[];
  executions: AcceptanceExecutionV1[];
  ancestorCommitShas: string[];
};

export type ParsedAcceptanceExecution = AcceptanceExecutionV1 & { failureMessages: string[] };
export type AcceptanceReportOutcome = "passed" | "failed";

export type AcceptanceTraceDependencies = {
  isAncestor(ancestorCommitSha: string, descendantCommitSha: string): boolean;
  pathExistsAtCommit?(commitSha: string, productModulePath: string): boolean;
};

export type AcceptanceRedEvidenceBinding = {
  acceptanceId: string;
  testFile: string;
  fullName: string;
  expectedFailureFingerprint: string;
  patchText: string;
  testPatchSha256: string;
};

export type ParsedLocalProductModuleAbsence = {
  testFile: string;
  fullName: string | null;
  missingProductModulePath: string;
  failureMessage: string;
};

export type AcceptanceLocalProductModuleRedEvidenceBinding = AcceptanceRedEvidenceBinding & {
  missingProductModulePath: string;
};

type JsonRecord = Record<string, unknown>;

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const TEST_FILE = /^tests\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.test\.ts$/;
const BEHAVIORAL_FINGERPRINT = /^expected_behavioral_assertion_ac-\d{2}(?:_[a-z0-9-]+)*$/;
const LOCAL_PRODUCT_MODULE_FINGERPRINT = /^expected_local_product_module_absent_ac-\d{2}_[0-9a-f]{64}$/;
const LOCAL_PRODUCT_MODULE = /^src\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+$/;
export const REMEDIATION_PLAN4_FILE_LOAD_LOCAL_PRODUCT_MODULE_ABSENT_ACCEPTANCE_IDS = Object.freeze([
  "AC-07", "AC-08", "AC-09", "AC-12", "AC-13", "AC-27", "AC-39"
]);
export const REMEDIATION_PLAN2_ASSERTION_LOCAL_PRODUCT_MODULE_ABSENT_ACCEPTANCE_IDS = Object.freeze([
  "AC-03", "AC-04", "AC-05", "AC-06",
  "AC-19", "AC-22", "AC-23", "AC-25", "AC-26", "AC-28",
  "AC-29", "AC-30", "AC-31", "AC-32", "AC-33", "AC-36", "AC-37"
]);
export const REMEDIATION_LOCAL_PRODUCT_MODULE_ABSENT_ACCEPTANCE_IDS = Object.freeze([
  ...REMEDIATION_PLAN4_FILE_LOAD_LOCAL_PRODUCT_MODULE_ABSENT_ACCEPTANCE_IDS,
  ...REMEDIATION_PLAN2_ASSERTION_LOCAL_PRODUCT_MODULE_ABSENT_ACCEPTANCE_IDS
]);
export const REMEDIATION_PLAN2_FROZEN_TEST_SHA = "01a29fefb51c245c3fe8f97f0da53929047740c7";
export const REMEDIATION_PLAN4_FROZEN_TEST_SHA = "20ee8a759e482c2c3037d72e561e68e289cf87b5";
const PLAN2_TEST_BASE_SHA = "5f6209af82e23a065bd036c6a37eabe4888a5cfe";
const PLAN2_OWNER_SHA = "83f0cb967f61b814896e5d1a4cf01cecb1c56b59";
const PLAN2_USDD_TEST_PATCH_SHA256 = "51f0f59bacf095a8bba8620e9236064fcaec503205c2ebf295907009dbe89c93";
const PLAN2_APPROVAL_TEST_PATCH_SHA256 = "af99e8ed72dc377166dd8b88e58ba5a885eb73a0bf7784cf961478357a49210b";
const PLAN2_CONTRACT_TEST_PATCH_SHA256 = "57057592adcd5c0eaf340398a815cec92d9d945905c44101c62bb335c427c238";
const PLAN2_LLM_TEST_PATCH_SHA256 = "56efcdd404eebdaca3bce66e23639a2fe04f31bcb6808ff5cb0ecd6b6eec0c98";
const PLAN4_TEST_BASE_SHA = "d18067f6c49fd632bafa47a90f69f1e7bf8b1802";
const PLAN4_BEHAVIORAL_RED_SHA = "a0f74b3bd079d05bbfc9c35476daf9bac07e7d72";
const PLAN4_OWNER_SHA = "547d86cd6c478ca56e5b85d2ccb31cdbce2ddc17";
const PLAN4_ALERT_TEST_PATCH_SHA256 = "544fc122c2012bb27452659a795dadbbadcedc4930d54194442558d85737e2b2";
const PLAN4_RENDERER_TEST_PATCH_SHA256 = "c9a755269b1e3935bf8c6d71797e17493a57d4e55e6aa26b63c63c36494118e5";
const PLAN4_STORAGE_TEST_PATCH_SHA256 = "27aa2e5102bee4d1cbba5009f70c2cd2719ceab35c46e4764ab89a0c422ee771";

const EXACT_PLAN4_RED_LINEAGE: Readonly<Record<string, {
  kind: AcceptanceTraceRedV1["kind"];
  testFile: string;
  baseSha: string;
  testCommitSha: string;
  redExecutionCommitSha: string;
  ownerCommitSha: string;
  testPatchSha256: string;
  missingProductModulePath?: string;
}>> = Object.freeze({
  "AC-07": { kind: "local_product_module_absent", testFile: "tests/telegram/unifiedForensicRenderer.acceptance.test.ts", baseSha: PLAN4_TEST_BASE_SHA, testCommitSha: REMEDIATION_PLAN4_FROZEN_TEST_SHA, redExecutionCommitSha: REMEDIATION_PLAN4_FROZEN_TEST_SHA, ownerCommitSha: PLAN4_OWNER_SHA, testPatchSha256: PLAN4_RENDERER_TEST_PATCH_SHA256, missingProductModulePath: "src/telegram/forensicPresentation" },
  "AC-08": { kind: "local_product_module_absent", testFile: "tests/telegram/unifiedForensicRenderer.acceptance.test.ts", baseSha: PLAN4_TEST_BASE_SHA, testCommitSha: REMEDIATION_PLAN4_FROZEN_TEST_SHA, redExecutionCommitSha: REMEDIATION_PLAN4_FROZEN_TEST_SHA, ownerCommitSha: PLAN4_OWNER_SHA, testPatchSha256: PLAN4_RENDERER_TEST_PATCH_SHA256, missingProductModulePath: "src/telegram/forensicPresentation" },
  "AC-09": { kind: "local_product_module_absent", testFile: "tests/telegram/unifiedForensicRenderer.acceptance.test.ts", baseSha: PLAN4_TEST_BASE_SHA, testCommitSha: REMEDIATION_PLAN4_FROZEN_TEST_SHA, redExecutionCommitSha: REMEDIATION_PLAN4_FROZEN_TEST_SHA, ownerCommitSha: PLAN4_OWNER_SHA, testPatchSha256: PLAN4_RENDERER_TEST_PATCH_SHA256, missingProductModulePath: "src/telegram/forensicPresentation" },
  "AC-12": { kind: "local_product_module_absent", testFile: "tests/telegram/unifiedForensicRenderer.acceptance.test.ts", baseSha: PLAN4_TEST_BASE_SHA, testCommitSha: REMEDIATION_PLAN4_FROZEN_TEST_SHA, redExecutionCommitSha: REMEDIATION_PLAN4_FROZEN_TEST_SHA, ownerCommitSha: PLAN4_OWNER_SHA, testPatchSha256: PLAN4_RENDERER_TEST_PATCH_SHA256, missingProductModulePath: "src/telegram/forensicPresentation" },
  "AC-13": { kind: "local_product_module_absent", testFile: "tests/storage/unifiedTelegramCoverage.postgres.test.ts", baseSha: PLAN4_TEST_BASE_SHA, testCommitSha: REMEDIATION_PLAN4_FROZEN_TEST_SHA, redExecutionCommitSha: REMEDIATION_PLAN4_FROZEN_TEST_SHA, ownerCommitSha: PLAN4_OWNER_SHA, testPatchSha256: PLAN4_STORAGE_TEST_PATCH_SHA256, missingProductModulePath: "src/telegram/forensicPresentationAdapters" },
  "AC-20": { kind: "behavioral_assertion", testFile: "tests/alerts/unifiedTelegramAlerts.acceptance.test.ts", baseSha: PLAN4_TEST_BASE_SHA, testCommitSha: REMEDIATION_PLAN4_FROZEN_TEST_SHA, redExecutionCommitSha: PLAN4_BEHAVIORAL_RED_SHA, ownerCommitSha: PLAN4_OWNER_SHA, testPatchSha256: PLAN4_ALERT_TEST_PATCH_SHA256 },
  "AC-21": { kind: "behavioral_assertion", testFile: "tests/alerts/unifiedTelegramAlerts.acceptance.test.ts", baseSha: PLAN4_TEST_BASE_SHA, testCommitSha: REMEDIATION_PLAN4_FROZEN_TEST_SHA, redExecutionCommitSha: PLAN4_BEHAVIORAL_RED_SHA, ownerCommitSha: PLAN4_OWNER_SHA, testPatchSha256: PLAN4_ALERT_TEST_PATCH_SHA256 },
  "AC-24": { kind: "behavioral_assertion", testFile: "tests/alerts/unifiedTelegramAlerts.acceptance.test.ts", baseSha: PLAN4_TEST_BASE_SHA, testCommitSha: REMEDIATION_PLAN4_FROZEN_TEST_SHA, redExecutionCommitSha: PLAN4_BEHAVIORAL_RED_SHA, ownerCommitSha: PLAN4_OWNER_SHA, testPatchSha256: PLAN4_ALERT_TEST_PATCH_SHA256 },
  "AC-27": { kind: "local_product_module_absent", testFile: "tests/alerts/unifiedTelegramAlerts.acceptance.test.ts", baseSha: PLAN4_TEST_BASE_SHA, testCommitSha: REMEDIATION_PLAN4_FROZEN_TEST_SHA, redExecutionCommitSha: REMEDIATION_PLAN4_FROZEN_TEST_SHA, ownerCommitSha: PLAN4_OWNER_SHA, testPatchSha256: PLAN4_ALERT_TEST_PATCH_SHA256, missingProductModulePath: "src/telegram/forensicPresentationAdapters" },
  "AC-39": { kind: "local_product_module_absent", testFile: "tests/alerts/unifiedTelegramAlerts.acceptance.test.ts", baseSha: PLAN4_TEST_BASE_SHA, testCommitSha: REMEDIATION_PLAN4_FROZEN_TEST_SHA, redExecutionCommitSha: REMEDIATION_PLAN4_FROZEN_TEST_SHA, ownerCommitSha: PLAN4_OWNER_SHA, testPatchSha256: PLAN4_ALERT_TEST_PATCH_SHA256, missingProductModulePath: "src/telegram/forensicPresentationAdapters" }
});
type ExactAssertionLocalRedLineage = {
  testFile: string;
  fullName: string;
  primary: true;
  baseSha: string;
  testCommitSha: string;
  redExecutionCommitSha: string;
  ownerCommitSha: string;
  testPatchSha256: string;
  missingProductModulePath: string;
};

const EXACT_PLAN2_ASSERTION_LOCAL_RED_LINEAGE: Readonly<Record<string, ExactAssertionLocalRedLineage>> = Object.freeze({
  "AC-03": { testFile: "tests/risk/collectorUsddRemediation.acceptance.test.ts", fullName: "[AC-03] scores 2 percent outbound USDD PSM with direction adjustment", primary: true, baseSha: PLAN2_TEST_BASE_SHA, testCommitSha: REMEDIATION_PLAN2_FROZEN_TEST_SHA, redExecutionCommitSha: REMEDIATION_PLAN2_FROZEN_TEST_SHA, ownerCommitSha: PLAN2_OWNER_SHA, testPatchSha256: PLAN2_USDD_TEST_PATCH_SHA256, missingProductModulePath: "src/risk/usddPsmExposure" },
  "AC-04": { testFile: "tests/risk/collectorUsddRemediation.acceptance.test.ts", fullName: "[AC-04] scores 83 percent direct inbound USDD PSM at top tier", primary: true, baseSha: PLAN2_TEST_BASE_SHA, testCommitSha: REMEDIATION_PLAN2_FROZEN_TEST_SHA, redExecutionCommitSha: REMEDIATION_PLAN2_FROZEN_TEST_SHA, ownerCommitSha: PLAN2_OWNER_SHA, testPatchSha256: PLAN2_USDD_TEST_PATCH_SHA256, missingProductModulePath: "src/risk/usddPsmExposure" },
  "AC-05": { testFile: "tests/risk/collectorUsddRemediation.acceptance.test.ts", fullName: "[AC-05] halves historical Deep USDD PSM and caps modifier at 12", primary: true, baseSha: PLAN2_TEST_BASE_SHA, testCommitSha: REMEDIATION_PLAN2_FROZEN_TEST_SHA, redExecutionCommitSha: REMEDIATION_PLAN2_FROZEN_TEST_SHA, ownerCommitSha: PLAN2_OWNER_SHA, testPatchSha256: PLAN2_USDD_TEST_PATCH_SHA256, missingProductModulePath: "src/risk/usddPsmExposure" },
  "AC-06": { testFile: "tests/risk/collectorUsddRemediation.acceptance.test.ts", fullName: "[AC-06] keeps label-only or discontinuous USDD PSM unscored", primary: true, baseSha: PLAN2_TEST_BASE_SHA, testCommitSha: REMEDIATION_PLAN2_FROZEN_TEST_SHA, redExecutionCommitSha: REMEDIATION_PLAN2_FROZEN_TEST_SHA, ownerCommitSha: PLAN2_OWNER_SHA, testPatchSha256: PLAN2_USDD_TEST_PATCH_SHA256, missingProductModulePath: "src/risk/usddPsmExposure" },
  "AC-19": { testFile: "tests/approvals/approvalSafetyV2.acceptance.test.ts", fullName: "[AC-19] scores confirmed unlimited Verify20 approval at CRITICAL 90", primary: true, baseSha: PLAN2_TEST_BASE_SHA, testCommitSha: REMEDIATION_PLAN2_FROZEN_TEST_SHA, redExecutionCommitSha: REMEDIATION_PLAN2_FROZEN_TEST_SHA, ownerCommitSha: PLAN2_OWNER_SHA, testPatchSha256: PLAN2_APPROVAL_TEST_PATCH_SHA256, missingProductModulePath: "src/approvals/approvalSafetyAssessment" },
  "AC-22": { testFile: "tests/approvals/approvalSafetyV2.acceptance.test.ts", fullName: "[AC-22] caps one selector or provider name at review context", primary: true, baseSha: PLAN2_TEST_BASE_SHA, testCommitSha: REMEDIATION_PLAN2_FROZEN_TEST_SHA, redExecutionCommitSha: REMEDIATION_PLAN2_FROZEN_TEST_SHA, ownerCommitSha: PLAN2_OWNER_SHA, testPatchSha256: PLAN2_APPROVAL_TEST_PATCH_SHA256, missingProductModulePath: "src/approvals/approvalSafetyAssessment" },
  "AC-23": { testFile: "tests/approvals/approvalSafetyV2.acceptance.test.ts", fullName: "[AC-23] removes active threat after confirmed zero allowance", primary: true, baseSha: PLAN2_TEST_BASE_SHA, testCommitSha: REMEDIATION_PLAN2_FROZEN_TEST_SHA, redExecutionCommitSha: REMEDIATION_PLAN2_FROZEN_TEST_SHA, ownerCommitSha: PLAN2_OWNER_SHA, testPatchSha256: PLAN2_APPROVAL_TEST_PATCH_SHA256, missingProductModulePath: "src/approvals/approvalSafetyAssessment" },
  "AC-25": { testFile: "tests/approvals/approvalSafetyV2.acceptance.test.ts", fullName: "[AC-25] recognizes exact Bridgers 66-second 91.103009 session as LOW 10", primary: true, baseSha: PLAN2_TEST_BASE_SHA, testCommitSha: REMEDIATION_PLAN2_FROZEN_TEST_SHA, redExecutionCommitSha: REMEDIATION_PLAN2_FROZEN_TEST_SHA, ownerCommitSha: PLAN2_OWNER_SHA, testPatchSha256: PLAN2_APPROVAL_TEST_PATCH_SHA256, missingProductModulePath: "src/approvals/approvalSafetyAssessment" },
  "AC-26": { testFile: "tests/approvals/approvalSafetyV2.acceptance.test.ts", fullName: "[AC-26] refuses service-session dampener for tag-only evidence", primary: true, baseSha: PLAN2_TEST_BASE_SHA, testCommitSha: REMEDIATION_PLAN2_FROZEN_TEST_SHA, redExecutionCommitSha: REMEDIATION_PLAN2_FROZEN_TEST_SHA, ownerCommitSha: PLAN2_OWNER_SHA, testPatchSha256: PLAN2_APPROVAL_TEST_PATCH_SHA256, missingProductModulePath: "src/approvals/approvalSafetyAssessment" },
  "AC-28": { testFile: "tests/approvals/approvalSafetyV2.acceptance.test.ts", fullName: "[AC-28] removes transaction expiration from approval risk", primary: true, baseSha: PLAN2_TEST_BASE_SHA, testCommitSha: REMEDIATION_PLAN2_FROZEN_TEST_SHA, redExecutionCommitSha: REMEDIATION_PLAN2_FROZEN_TEST_SHA, ownerCommitSha: PLAN2_OWNER_SHA, testPatchSha256: PLAN2_APPROVAL_TEST_PATCH_SHA256, missingProductModulePath: "src/approvals/approvalSafetyAssessment" },
  "AC-29": { testFile: "tests/check/contractDecisionV2.acceptance.test.ts", fullName: "[AC-29] resolves official TRON USDT at LOW 0 without LLM", primary: true, baseSha: PLAN2_TEST_BASE_SHA, testCommitSha: REMEDIATION_PLAN2_FROZEN_TEST_SHA, redExecutionCommitSha: REMEDIATION_PLAN2_FROZEN_TEST_SHA, ownerCommitSha: PLAN2_OWNER_SHA, testPatchSha256: PLAN2_CONTRACT_TEST_PATCH_SHA256, missingProductModulePath: "src/forensics/contractDecision" },
  "AC-30": { testFile: "tests/check/contractDecisionV2.acceptance.test.ts", fullName: "[AC-30] resolves GasFree Account at LOW 10 without LLM and keeps flows eligible", primary: true, baseSha: PLAN2_TEST_BASE_SHA, testCommitSha: REMEDIATION_PLAN2_FROZEN_TEST_SHA, redExecutionCommitSha: REMEDIATION_PLAN2_FROZEN_TEST_SHA, ownerCommitSha: PLAN2_OWNER_SHA, testPatchSha256: PLAN2_CONTRACT_TEST_PATCH_SHA256, missingProductModulePath: "src/forensics/contractDecision" },
  "AC-31": { testFile: "tests/check/contractDecisionV2.acceptance.test.ts", fullName: "[AC-31] keeps exact Bridgers approval session LOW instead of decline", primary: true, baseSha: PLAN2_TEST_BASE_SHA, testCommitSha: REMEDIATION_PLAN2_FROZEN_TEST_SHA, redExecutionCommitSha: REMEDIATION_PLAN2_FROZEN_TEST_SHA, ownerCommitSha: PLAN2_OWNER_SHA, testPatchSha256: PLAN2_CONTRACT_TEST_PATCH_SHA256, missingProductModulePath: "src/forensics/contractDecision" },
  "AC-32": { testFile: "tests/check/contractDecisionV2.acceptance.test.ts", fullName: "[AC-32] keeps known-service unlimited approval without session at REVIEW 45", primary: true, baseSha: PLAN2_TEST_BASE_SHA, testCommitSha: REMEDIATION_PLAN2_FROZEN_TEST_SHA, redExecutionCommitSha: REMEDIATION_PLAN2_FROZEN_TEST_SHA, ownerCommitSha: PLAN2_OWNER_SHA, testPatchSha256: PLAN2_CONTRACT_TEST_PATCH_SHA256, missingProductModulePath: "src/forensics/contractDecision" },
  "AC-33": { testFile: "tests/check/contractDecisionV2.acceptance.test.ts", fullName: "[AC-33] prevents service-context dampening of provider risk Verify20 or debit proof", primary: true, baseSha: PLAN2_TEST_BASE_SHA, testCommitSha: REMEDIATION_PLAN2_FROZEN_TEST_SHA, redExecutionCommitSha: REMEDIATION_PLAN2_FROZEN_TEST_SHA, ownerCommitSha: PLAN2_OWNER_SHA, testPatchSha256: PLAN2_CONTRACT_TEST_PATCH_SHA256, missingProductModulePath: "src/forensics/contractDecision" },
  "AC-36": { testFile: "tests/forensics/contractLlmIsolation.acceptance.test.ts", fullName: "[AC-36][LLM-LEGACY] keeps cached citations as audit-only payload", primary: true, baseSha: PLAN2_TEST_BASE_SHA, testCommitSha: REMEDIATION_PLAN2_FROZEN_TEST_SHA, redExecutionCommitSha: REMEDIATION_PLAN2_FROZEN_TEST_SHA, ownerCommitSha: PLAN2_OWNER_SHA, testPatchSha256: PLAN2_LLM_TEST_PATCH_SHA256, missingProductModulePath: "src/forensics/contractDecision" },
  "AC-37": { testFile: "tests/forensics/contractLlmIsolation.acceptance.test.ts", fullName: "[AC-37][LLM-DISABLED] keeps risky or uncited legacy verdict out of fresh decisions", primary: true, baseSha: PLAN2_TEST_BASE_SHA, testCommitSha: REMEDIATION_PLAN2_FROZEN_TEST_SHA, redExecutionCommitSha: REMEDIATION_PLAN2_FROZEN_TEST_SHA, ownerCommitSha: PLAN2_OWNER_SHA, testPatchSha256: PLAN2_LLM_TEST_PATCH_SHA256, missingProductModulePath: "src/forensics/contractDecision" }
});
const INFRASTRUCTURE_FAILURE = /(?:syntaxerror|failed to load|cannot find (?:module|package)|module not found|import error|failed to resolve import|typescript|typecheck|\bts\d{4}\b|fixture|environment|test environment|setup file|config(?:uration)? error|worker exited|out of memory|password authentication failed|role .+ does not exist|database .+ does not exist|no pg_hba\.conf entry|\b(?:econn(?:refused|reset|aborted)|etimedout|enotfound|ehostunreach|enetunreach|eai_again)\b|getaddrinfo|connection refused|connect etimedout|could not connect to server|server closed the connection unexpectedly|terminating connection|connection terminated unexpectedly|connection reset by peer|socket hang up|permission denied for (?:database|schema|relation)|must be owner of|remaining connection slots|too many clients|database system is (?:starting up|shutting down|in recovery mode))/i;

export const REMEDIATION_ACCEPTANCE_OWNER_PLAN: Readonly<Record<string, 1 | 2 | 3 | 4 | 5>> = {
  "AC-01": 2, "AC-02": 2, "AC-03": 2, "AC-04": 2, "AC-05": 2, "AC-06": 2,
  "AC-07": 4, "AC-08": 4, "AC-09": 4,
  "AC-10": 1, "AC-11": 1,
  "AC-12": 4, "AC-13": 4,
  "AC-14": 3, "AC-15": 3, "AC-16": 3, "AC-17": 3, "AC-18": 3,
  "AC-19": 2, "AC-20": 4, "AC-21": 4, "AC-22": 2, "AC-23": 2, "AC-24": 4,
  "AC-25": 2, "AC-26": 2, "AC-27": 4, "AC-28": 2, "AC-29": 2, "AC-30": 2,
  "AC-31": 2, "AC-32": 2, "AC-33": 2, "AC-34": 2, "AC-35": 2, "AC-36": 2,
  "AC-37": 2, "AC-38": 2, "AC-39": 4, "AC-40": 2,
  "AC-41": 5
};

export const REMEDIATION_ACCEPTANCE_REQUIREMENT_IDS: Readonly<Record<string, readonly string[]>> = {
  "AC-01": ["REQ-15", "REQ-16"],
  "AC-02": ["REQ-15", "REQ-16", "REQ-17"],
  "AC-03": ["REQ-28", "REQ-29"],
  "AC-04": ["REQ-28", "REQ-29"],
  "AC-05": ["REQ-28", "REQ-29"],
  "AC-06": ["REQ-28", "REQ-29"],
  "AC-07": ["REQ-06", "REQ-09", "REQ-15", "REQ-32"],
  "AC-08": ["REQ-05", "REQ-08", "REQ-32"],
  "AC-09": ["REQ-32", "REQ-33"],
  "AC-10": ["REQ-30"],
  "AC-11": ["REQ-02", "REQ-30"],
  "AC-12": ["REQ-03", "REQ-04", "REQ-07", "REQ-12", "REQ-13", "REQ-14", "REQ-34"],
  "AC-13": ["REQ-03", "REQ-04", "REQ-10", "REQ-11", "REQ-19", "REQ-31"],
  "AC-14": ["REQ-35"],
  "AC-15": ["REQ-35"],
  "AC-16": ["REQ-03", "REQ-05", "REQ-36"],
  "AC-17": ["REQ-37"],
  "AC-18": ["REQ-37"],
  "AC-19": ["REQ-18", "REQ-19", "REQ-20"],
  "AC-20": ["REQ-08", "REQ-18", "REQ-20"],
  "AC-21": ["REQ-20"],
  "AC-22": ["REQ-20"],
  "AC-23": ["REQ-19", "REQ-20"],
  "AC-24": ["REQ-18", "REQ-19", "REQ-20"],
  "AC-25": ["REQ-18", "REQ-21"],
  "AC-26": ["REQ-21"],
  "AC-27": ["REQ-18", "REQ-22"],
  "AC-28": ["REQ-22"],
  "AC-29": ["REQ-23", "REQ-24", "REQ-27"],
  "AC-30": ["REQ-01", "REQ-23", "REQ-24", "REQ-27"],
  "AC-31": ["REQ-18", "REQ-21", "REQ-24"],
  "AC-32": ["REQ-18", "REQ-21", "REQ-24"],
  "AC-33": ["REQ-20", "REQ-23", "REQ-25", "REQ-27"],
  "AC-34": ["REQ-23", "REQ-25", "REQ-26", "REQ-27"],
  "AC-35": ["REQ-23", "REQ-25", "REQ-26", "REQ-27"],
  "AC-36": ["REQ-25", "REQ-26", "REQ-27"],
  "AC-37": ["REQ-23", "REQ-25", "REQ-26", "REQ-27"],
  "AC-38": ["REQ-23", "REQ-25", "REQ-26"],
  "AC-39": ["REQ-05", "REQ-06", "REQ-07", "REQ-14", "REQ-25", "REQ-27", "REQ-32"],
  "AC-40": ["REQ-23", "REQ-24", "REQ-25", "REQ-27"],
  "AC-41": ["REQ-38"]
};

function expectRecord(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function expectExactKeys(record: JsonRecord, expected: readonly string[], label: string): void {
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} fields do not match the approved contract`);
  }
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

function expectSha40(value: unknown, label: string): string {
  const sha = expectString(value, label);
  if (!SHA40.test(sha)) throw new Error(`${label} must be a full lowercase commit SHA`);
  return sha;
}

function expectSha256(value: unknown, label: string): string {
  const hash = expectString(value, label);
  if (!SHA256.test(hash)) throw new Error(`${label} must be a full lowercase SHA-256`);
  return hash;
}

function expectStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be a string array`);
  }
  return [...value] as string[];
}

export function normalizeAcceptanceTestFile(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const testsIndex = normalized.lastIndexOf("/tests/");
  const relative = testsIndex >= 0 ? normalized.slice(testsIndex + 1) : normalized.replace(/^\.\//, "");
  if (!TEST_FILE.test(relative) || relative.includes("../")) throw new Error("test file is outside the approved tests tree");
  return relative;
}

export function normalizeLocalProductModulePath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!LOCAL_PRODUCT_MODULE.test(normalized)
      || normalized.split("/").some((segment) => segment === "." || segment === "..")
      || /[?#\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error("missing path is not a local product module under src");
  }
  return normalized;
}

function parseTrace(value: unknown, candidateSha: string, ancestorCommitShas: ReadonlySet<string>, index: number): AcceptanceTraceV1 {
  const trace = expectRecord(value, `traces[${index}]`);
  expectExactKeys(trace, [
    "acceptanceId",
    "requirementIds",
    "ownerPlan",
    "ownerCommitSha",
    "testFile",
    "fullName",
    "primary",
    "red",
    "green"
  ], `traces[${index}]`);
  const acceptanceId = expectString(trace.acceptanceId, `traces[${index}].acceptanceId`);
  if (!REMEDIATION_REQUIRED_ACCEPTANCE_IDS.includes(acceptanceId)) {
    throw new Error(`${acceptanceId} is not an approved acceptance ID`);
  }
  const requirementIds = expectStringArray(trace.requirementIds, `traces[${index}].requirementIds`);
  const expectedRequirementIds = REMEDIATION_ACCEPTANCE_REQUIREMENT_IDS[acceptanceId];
  if (!expectedRequirementIds || requirementIds.length !== expectedRequirementIds.length
      || requirementIds.some((id, requirementIndex) => id !== expectedRequirementIds[requirementIndex])) {
    throw new Error(`${acceptanceId} requirement IDs are incorrect`);
  }
  if (!Number.isInteger(trace.ownerPlan) || ![1, 2, 3, 4, 5].includes(trace.ownerPlan as number)) {
    throw new Error(`${acceptanceId} ownerPlan is invalid`);
  }
  const ownerPlan = trace.ownerPlan as 1 | 2 | 3 | 4 | 5;
  if (ownerPlan !== REMEDIATION_ACCEPTANCE_OWNER_PLAN[acceptanceId]) {
    throw new Error(`${acceptanceId} ownerPlan is incorrect`);
  }
  const ownerCommitSha = expectSha40(trace.ownerCommitSha, `${acceptanceId}.ownerCommitSha`);
  if (!ancestorCommitShas.has(ownerCommitSha) || ownerCommitSha === candidateSha) {
    throw new Error(`${acceptanceId} owner commit is not a recorded candidate ancestor`);
  }
  const testFile = normalizeAcceptanceTestFile(expectString(trace.testFile, `${acceptanceId}.testFile`));
  const fullName = expectString(trace.fullName, `${acceptanceId}.fullName`);
  if (!fullName.startsWith(`[${acceptanceId}]`) || /[\u0000-\u001f\u007f]/.test(fullName)) {
    throw new Error(`${acceptanceId} fullName must begin with its own acceptance token`);
  }
  if (typeof trace.primary !== "boolean") throw new Error(`${acceptanceId} primary must be boolean`);

  const red = expectRecord(trace.red, `${acceptanceId}.red`);
  const redKind = expectString(red.kind, `${acceptanceId}.red.kind`);
  if (redKind !== "behavioral_assertion" && redKind !== "local_product_module_absent") {
    throw new Error(`${acceptanceId} RED kind is invalid`);
  }
  expectExactKeys(red, redKind === "behavioral_assertion" ? [
    "kind", "baseSha", "testCommitSha", "redExecutionCommitSha", "testPatchSha256", "vitestReportSha256",
    "expectedFailureFingerprint", "status"
  ] : [
    "kind", "baseSha", "testCommitSha", "redExecutionCommitSha", "testPatchSha256", "vitestReportSha256",
    "expectedFailureFingerprint", "missingProductModulePath", "status"
  ], `${acceptanceId}.red`);
  const baseSha = expectSha40(red.baseSha, `${acceptanceId}.red.baseSha`);
  if (baseSha === candidateSha) throw new Error(`${acceptanceId} RED base cannot be the candidate`);
  const testCommitSha = expectSha40(red.testCommitSha, `${acceptanceId}.red.testCommitSha`);
  if (testCommitSha === candidateSha || testCommitSha === ownerCommitSha) {
    throw new Error(`${acceptanceId} frozen test commit must precede owner and candidate commits`);
  }
  const redExecutionCommitSha = expectSha40(
    red.redExecutionCommitSha,
    `${acceptanceId}.red.redExecutionCommitSha`
  );
  if (redExecutionCommitSha === candidateSha || redExecutionCommitSha === ownerCommitSha) {
    throw new Error(`${acceptanceId} RED execution commit must precede owner and candidate commits`);
  }
  const testPatchSha256 = expectSha256(red.testPatchSha256, `${acceptanceId}.red.testPatchSha256`);
  const redReportSha256 = expectSha256(red.vitestReportSha256, `${acceptanceId}.red.vitestReportSha256`);
  const expectedFailureFingerprint = expectString(
    red.expectedFailureFingerprint,
    `${acceptanceId}.red.expectedFailureFingerprint`
  );
  if (redKind === "behavioral_assertion") {
    if (!BEHAVIORAL_FINGERPRINT.test(expectedFailureFingerprint)
        || !expectedFailureFingerprint.includes(acceptanceId.toLowerCase())
        || INFRASTRUCTURE_FAILURE.test(expectedFailureFingerprint)) {
      throw new Error(`${acceptanceId} RED fingerprint is not an expected behavioral assertion`);
    }
  } else {
    if (!REMEDIATION_LOCAL_PRODUCT_MODULE_ABSENT_ACCEPTANCE_IDS.includes(acceptanceId)) {
      throw new Error(`${acceptanceId} is not approved for local product module RED`);
    }
    if (!LOCAL_PRODUCT_MODULE_FINGERPRINT.test(expectedFailureFingerprint)
        || !expectedFailureFingerprint.includes(acceptanceId.toLowerCase())) {
      throw new Error(`${acceptanceId} RED fingerprint is not an exact local product module absence`);
    }
    const frozenTestSha = REMEDIATION_PLAN4_FILE_LOAD_LOCAL_PRODUCT_MODULE_ABSENT_ACCEPTANCE_IDS.includes(acceptanceId)
      ? REMEDIATION_PLAN4_FROZEN_TEST_SHA
      : REMEDIATION_PLAN2_FROZEN_TEST_SHA;
    if (testCommitSha !== frozenTestSha) {
      throw new Error(`${acceptanceId} local product module RED must use its exact approved frozen test commit`);
    }
    if (redExecutionCommitSha !== frozenTestSha) {
      throw new Error(`${acceptanceId} local product module RED must execute at its exact approved frozen test commit`);
    }
  }
  const missingProductModulePath = redKind === "local_product_module_absent"
    ? normalizeLocalProductModulePath(expectString(
        red.missingProductModulePath,
        `${acceptanceId}.red.missingProductModulePath`
      ))
    : undefined;
  const exactPlan4Lineage = EXACT_PLAN4_RED_LINEAGE[acceptanceId];
  if (exactPlan4Lineage && (
    ownerCommitSha !== exactPlan4Lineage.ownerCommitSha
      || redKind !== exactPlan4Lineage.kind
      || testFile !== exactPlan4Lineage.testFile
      || baseSha !== exactPlan4Lineage.baseSha
      || testCommitSha !== exactPlan4Lineage.testCommitSha
      || redExecutionCommitSha !== exactPlan4Lineage.redExecutionCommitSha
      || testPatchSha256 !== exactPlan4Lineage.testPatchSha256
      || missingProductModulePath !== exactPlan4Lineage.missingProductModulePath
  )) {
    throw new Error(`${acceptanceId} RED evidence does not match its exact approved RED lineage`);
  }
  const exactPlan2Lineage = EXACT_PLAN2_ASSERTION_LOCAL_RED_LINEAGE[acceptanceId];
  if (exactPlan2Lineage && (
    ownerCommitSha !== exactPlan2Lineage.ownerCommitSha
      || redKind !== "local_product_module_absent"
      || testFile !== exactPlan2Lineage.testFile
      || fullName !== exactPlan2Lineage.fullName
      || trace.primary !== exactPlan2Lineage.primary
      || baseSha !== exactPlan2Lineage.baseSha
      || testCommitSha !== exactPlan2Lineage.testCommitSha
      || redExecutionCommitSha !== exactPlan2Lineage.redExecutionCommitSha
      || testPatchSha256 !== exactPlan2Lineage.testPatchSha256
      || missingProductModulePath !== exactPlan2Lineage.missingProductModulePath
  )) {
    throw new Error(`${acceptanceId} RED evidence does not match its exact approved Plan 2 assertion lineage`);
  }
  if (red.status !== "failed_as_expected") throw new Error(`${acceptanceId} RED status is invalid`);

  const green = expectRecord(trace.green, `${acceptanceId}.green`);
  expectExactKeys(green, ["candidateSha", "vitestReportSha256", "status"], `${acceptanceId}.green`);
  const greenCandidateSha = expectSha40(green.candidateSha, `${acceptanceId}.green.candidateSha`);
  if (greenCandidateSha !== candidateSha) throw new Error(`${acceptanceId} GREEN candidate SHA is foreign`);
  const greenReportSha256 = expectSha256(green.vitestReportSha256, `${acceptanceId}.green.vitestReportSha256`);
  if (green.status !== "passed") throw new Error(`${acceptanceId} GREEN status is invalid`);

  return {
    acceptanceId,
    requirementIds,
    ownerPlan,
    ownerCommitSha,
    testFile,
    fullName,
    primary: trace.primary,
    red: redKind === "behavioral_assertion" ? {
      kind: "behavioral_assertion",
      baseSha,
      testCommitSha,
      redExecutionCommitSha,
      testPatchSha256,
      vitestReportSha256: redReportSha256,
      expectedFailureFingerprint,
      status: "failed_as_expected"
    } : {
      kind: "local_product_module_absent",
      baseSha,
      testCommitSha,
      redExecutionCommitSha,
      testPatchSha256,
      vitestReportSha256: redReportSha256,
      expectedFailureFingerprint,
      missingProductModulePath: missingProductModulePath!,
      status: "failed_as_expected"
    },
    green: {
      candidateSha: greenCandidateSha,
      vitestReportSha256: greenReportSha256,
      status: "passed"
    }
  };
}

function parseExecution(value: unknown, index: number): AcceptanceExecutionV1 {
  const execution = expectRecord(value, `executions[${index}]`);
  expectExactKeys(execution, ["testFile", "fullName", "status"], `executions[${index}]`);
  const testFile = normalizeAcceptanceTestFile(expectString(execution.testFile, `executions[${index}].testFile`));
  const fullName = expectString(execution.fullName, `executions[${index}].fullName`);
  const status = expectString(execution.status, `executions[${index}].status`) as AcceptanceExecutionStatus;
  if (!["passed", "failed", "skipped", "todo"].includes(status)) throw new Error("execution status is invalid");
  return { testFile, fullName, status };
}

function executionKey(execution: Pick<AcceptanceExecutionV1, "testFile" | "fullName">): string {
  return `${execution.testFile}\u0000${execution.fullName}`;
}

export function validateAcceptanceTraceSet(
  value: unknown,
  dependencies?: AcceptanceTraceDependencies
): AcceptanceTraceSetV1 {
  if (!dependencies || typeof dependencies.isAncestor !== "function") {
    throw new Error("acceptance trace validation requires a trusted Git ancestry verifier");
  }
  assertNoSecretLikeArtifactValues(value);
  const traceSet = expectRecord(value, "acceptance trace set");
  expectExactKeys(traceSet, [
    "version",
    "candidateSha",
    "requiredRequirementIds",
    "requiredAcceptanceIds",
    "traces",
    "executions",
    "ancestorCommitShas"
  ], "acceptance trace set");
  if (traceSet.version !== "acceptance-trace-set-v1") throw new Error("acceptance trace set version is invalid");
  const candidateSha = expectSha40(traceSet.candidateSha, "candidateSha");
  const requiredRequirementIds = assertExactIdSet(
    traceSet.requiredRequirementIds,
    REMEDIATION_REQUIRED_REQUIREMENT_IDS,
    "requiredRequirementIds"
  );
  const requiredAcceptanceIds = assertExactIdSet(
    traceSet.requiredAcceptanceIds,
    REMEDIATION_REQUIRED_ACCEPTANCE_IDS,
    "requiredAcceptanceIds"
  );
  const ancestorCommitShas = expectStringArray(traceSet.ancestorCommitShas, "ancestorCommitShas");
  if (ancestorCommitShas.length === 0 || new Set(ancestorCommitShas).size !== ancestorCommitShas.length) {
    throw new Error("ancestorCommitShas must contain unique commits");
  }
  ancestorCommitShas.forEach((sha, index) => expectSha40(sha, `ancestorCommitShas[${index}]`));
  if (!Array.isArray(traceSet.traces)) throw new Error("traces must be an array");
  const ancestorSet = new Set(ancestorCommitShas);
  const traces = traceSet.traces.map((trace, index) => parseTrace(trace, candidateSha, ancestorSet, index));
  for (const ownerCommitSha of new Set(traces.map((trace) => trace.ownerCommitSha))) {
    let isAncestor = false;
    try {
      isAncestor = dependencies.isAncestor(ownerCommitSha, candidateSha);
    } catch {
      isAncestor = false;
    }
    if (!isAncestor) throw new Error("owner commit is not a verified Git ancestor of the candidate");
  }
  for (const trace of traces) {
    let testPrecedesExecution = false;
    let executionPrecedesOwner = false;
    try {
      testPrecedesExecution = dependencies.isAncestor(
        trace.red.testCommitSha,
        trace.red.redExecutionCommitSha
      );
      executionPrecedesOwner = dependencies.isAncestor(trace.red.redExecutionCommitSha, trace.ownerCommitSha);
    } catch {
      testPrecedesExecution = false;
      executionPrecedesOwner = false;
    }
    if (!testPrecedesExecution) {
      throw new Error(`${trace.acceptanceId} test commit is not a verified Git ancestor of RED execution commit`);
    }
    if (!executionPrecedesOwner) {
      throw new Error(`${trace.acceptanceId} RED execution commit is not a verified Git ancestor of owner commit`);
    }
    if (trace.red.kind !== "local_product_module_absent") continue;
    if (typeof dependencies.pathExistsAtCommit !== "function") {
      throw new Error("local product module lineage requires a trusted Git path verifier");
    }
    let existsAtTest: boolean;
    let existsAtOwner: boolean;
    let existsAtCandidate: boolean;
    try {
      existsAtTest = dependencies.pathExistsAtCommit(trace.red.testCommitSha, trace.red.missingProductModulePath);
      existsAtOwner = dependencies.pathExistsAtCommit(trace.ownerCommitSha, trace.red.missingProductModulePath);
      existsAtCandidate = dependencies.pathExistsAtCommit(candidateSha, trace.red.missingProductModulePath);
    } catch {
      throw new Error(`${trace.acceptanceId} local product module lineage could not be verified`);
    }
    if (existsAtTest) throw new Error(`${trace.acceptanceId} local product module must be absent at the frozen test commit`);
    if (!existsAtOwner) throw new Error(`${trace.acceptanceId} local product module is absent at owner commit`);
    if (!existsAtCandidate) throw new Error(`${trace.acceptanceId} local product module is absent at candidate`);
  }
  const traceNames = traces.map((trace) => trace.fullName);
  if (new Set(traceNames).size !== traceNames.length) throw new Error("trace fullName values must be unique");

  for (const acceptanceId of REMEDIATION_REQUIRED_ACCEPTANCE_IDS) {
    const matching = traces.filter((trace) => trace.acceptanceId === acceptanceId);
    if (matching.filter((trace) => trace.primary).length !== 1) {
      throw new Error(`${acceptanceId} must have exactly one primary trace`);
    }
  }
  const coveredRequirements = new Set(traces.flatMap((trace) => trace.requirementIds));
  if (REMEDIATION_REQUIRED_REQUIREMENT_IDS.some((id) => !coveredRequirements.has(id))) {
    throw new Error("trace set does not cover every required requirement ID");
  }

  if (!Array.isArray(traceSet.executions)) throw new Error("executions must be an array");
  const executions = traceSet.executions.map(parseExecution);
  const executionKeys = executions.map(executionKey);
  if (new Set(executionKeys).size !== executionKeys.length) throw new Error("execution evidence contains duplicates");
  const traceKeys = traces.map(executionKey);
  if (executions.length !== traces.length || traceKeys.some((key) => !executionKeys.includes(key))) {
    throw new Error("execution evidence must match every exact trace fullName and file");
  }
  if (executions.some((execution) => execution.status !== "passed")) {
    throw new Error("every acceptance execution must pass without skip or todo");
  }

  return {
    version: "acceptance-trace-set-v1",
    candidateSha,
    requiredRequirementIds,
    requiredAcceptanceIds,
    traces,
    executions,
    ancestorCommitShas
  };
}

function reportStatus(value: unknown): AcceptanceExecutionStatus {
  if (value === "passed") return "passed";
  if (value === "failed") return "failed";
  if (value === "todo") return "todo";
  if (value === "pending" || value === "skipped" || value === "disabled") return "skipped";
  throw new Error("test report contains an unknown execution status");
}

function expectNonnegativeCount(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label} must be a nonnegative integer`);
  return value as number;
}

export function parseVitestJsonReport(
  value: unknown,
  expectedOutcome: AcceptanceReportOutcome = "passed"
): ParsedAcceptanceExecution[] {
  const report = expectRecord(value, "Vitest JSON report");
  if (typeof report.success !== "boolean") throw new Error("Vitest JSON report has no aggregate success state");
  const failedSuites = expectNonnegativeCount(report.numFailedTestSuites, "numFailedTestSuites");
  const failedTests = expectNonnegativeCount(report.numFailedTests, "numFailedTests");
  const aggregatePassed = report.success && failedSuites === 0 && failedTests === 0;
  const aggregateFailed = !report.success && (failedSuites > 0 || failedTests > 0);
  if (expectedOutcome === "passed" ? !aggregatePassed : !aggregateFailed) {
    throw new Error(`Vitest aggregate result does not match expected ${expectedOutcome} evidence`);
  }
  if (!Array.isArray(report.testResults)) throw new Error("Vitest JSON report has no testResults array");
  const executions: ParsedAcceptanceExecution[] = [];
  for (const [resultIndex, resultValue] of report.testResults.entries()) {
    const result = expectRecord(resultValue, `testResults[${resultIndex}]`);
    const testFile = normalizeAcceptanceTestFile(expectString(result.name, `testResults[${resultIndex}].name`));
    if (!Array.isArray(result.assertionResults)) throw new Error("Vitest test result has no assertionResults array");
    for (const [assertionIndex, assertionValue] of result.assertionResults.entries()) {
      const assertion = expectRecord(assertionValue, `assertionResults[${assertionIndex}]`);
      const reportFullName = expectString(assertion.fullName, `assertionResults[${assertionIndex}].fullName`);
      let fullName = reportFullName;
      if (assertion.title !== undefined || assertion.ancestorTitles !== undefined) {
        const title = expectString(assertion.title, `assertionResults[${assertionIndex}].title`);
        const ancestorTitles = expectStringArray(
          assertion.ancestorTitles,
          `assertionResults[${assertionIndex}].ancestorTitles`
        );
        if ([...ancestorTitles, title].join(" ") !== reportFullName) {
          throw new Error("Vitest assertion title lineage does not match fullName");
        }
        fullName = title;
      }
      const failureMessages = assertion.failureMessages === undefined
        ? []
        : expectStringArray(assertion.failureMessages, `assertionResults[${assertionIndex}].failureMessages`);
      executions.push({
        testFile,
        fullName,
        status: reportStatus(assertion.status),
        failureMessages
      });
    }
  }
  if (executions.length === 0) throw new Error("Vitest JSON report contains no executed tests");
  return executions;
}

export function parseLocalProductModuleAbsenceReport(value: unknown): ParsedLocalProductModuleAbsence[] {
  const report = expectRecord(value, "Vitest JSON report");
  if (report.success !== false) throw new Error("local product module RED report must fail");
  const failedSuites = expectNonnegativeCount(report.numFailedTestSuites, "numFailedTestSuites");
  const failedTests = expectNonnegativeCount(report.numFailedTests, "numFailedTests");
  if (failedSuites === 0) throw new Error("local product module RED report has no failed suites");
  if (!Array.isArray(report.testResults) || report.testResults.length === 0) {
    throw new Error("local product module RED report has no failed test files");
  }
  const evidence: ParsedLocalProductModuleAbsence[] = [];
  const parseFailureMessage = (failureMessage: string, testFile: string) => {
    const matches = [...failureMessage.matchAll(
      /(?:^|\n)(?:Error:\s*)?Cannot find module (['"])([^'"\r\n]+)\1 imported from (['"]?)([^'"\r\n]+)\3(?=\r?$)/gm
    )];
    if (matches.length !== 1) {
      if (matches.length > 1) throw new Error("RED evidence contains more than one local module-absence message");
      return null;
    }
    const remainder = failureMessage.replace(matches[0][0], "");
    if (INFRASTRUCTURE_FAILURE.test(remainder)) {
      throw new Error("RED evidence contains an additional generic import, dependency, or environment failure");
    }
    const specifier = matches[0][2].replace(/\\/g, "/");
    const importer = normalizeAcceptanceTestFile(matches[0][4]);
    if (importer !== testFile) throw new Error("missing module importer does not match the failed test file");
    const missingProductModulePath = normalizeLocalProductModulePath(specifier.startsWith("/src/")
      ? specifier.slice(1)
      : posix.normalize(posix.join(posix.dirname(testFile), specifier)));
    if (!specifier.startsWith("/src/") && !specifier.startsWith("./") && !specifier.startsWith("../")) {
      throw new Error("missing module specifier is not an exact local product import");
    }
    return {
      missingProductModulePath,
      failureMessage: matches[0][0].replace(/^\n/, "").trim()
    };
  };
  const fileLoadMode = failedTests === 0;
  for (const [resultIndex, value] of report.testResults.entries()) {
    const result = expectRecord(value, `testResults[${resultIndex}]`);
    const testFile = normalizeAcceptanceTestFile(expectString(result.name, `testResults[${resultIndex}].name`));
    if (!Array.isArray(result.assertionResults)) throw new Error("local product module RED has no assertionResults array");
    if (fileLoadMode) {
      if (result.status !== "failed" || result.assertionResults.length !== 0) {
        throw new Error("file-load local product module RED must contain only failed files with zero test executions");
      }
      const failureMessage = expectString(result.message, `testResults[${resultIndex}].message`);
      const parsed = parseFailureMessage(failureMessage, testFile);
      if (!parsed) throw new Error("RED evidence is not an exact local product module absence");
      evidence.push({ testFile, fullName: null, ...parsed });
      continue;
    }
    for (const [assertionIndex, assertionValue] of result.assertionResults.entries()) {
      const assertion = expectRecord(assertionValue, `assertionResults[${assertionIndex}]`);
      if (assertion.status !== "failed") continue;
      const reportFullName = expectString(assertion.fullName, `assertionResults[${assertionIndex}].fullName`);
      const title = expectString(assertion.title, `assertionResults[${assertionIndex}].title`);
      const ancestorTitles = expectStringArray(
        assertion.ancestorTitles,
        `assertionResults[${assertionIndex}].ancestorTitles`
      );
      if ([...ancestorTitles, title].join(" ") !== reportFullName) {
        throw new Error("Vitest assertion title lineage does not match fullName");
      }
      const failureMessages = expectStringArray(
        assertion.failureMessages,
        `assertionResults[${assertionIndex}].failureMessages`
      );
      const local = [] as Array<{ missingProductModulePath: string; failureMessage: string }>;
      for (const failureMessage of failureMessages) {
        const parsed = parseFailureMessage(failureMessage, testFile);
        if (parsed) local.push(parsed);
        else if (INFRASTRUCTURE_FAILURE.test(failureMessage)) {
          throw new Error("RED evidence contains a generic import, dependency, or environment failure");
        }
      }
      if (local.length > 1) throw new Error("assertion contains more than one local module-absence message");
      if (local.length === 1) evidence.push({ testFile, fullName: title, ...local[0] });
    }
  }
  if (fileLoadMode && evidence.length !== failedSuites) {
    throw new Error("local product module RED failed-suite count does not match exact file evidence");
  }
  if (evidence.length === 0) throw new Error("RED report contains no exact local product module absence");
  return evidence;
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function xmlAttributes(value: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of value.matchAll(/([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attributes[match[1]] = decodeXml(match[2] ?? match[3] ?? "");
  }
  return attributes;
}

export function parseJUnitReport(
  xml: string,
  expectedOutcome: AcceptanceReportOutcome = "passed"
): ParsedAcceptanceExecution[] {
  if (typeof xml !== "string" || !/<testsuites?\b/i.test(xml)) throw new Error("JUnit report is not XML test output");
  let aggregateFailureCount = 0;
  for (const suite of xml.matchAll(/<testsuites?\b([^>]*)>/gi)) {
    const attributes = xmlAttributes(suite[1]);
    for (const name of ["failures", "errors"] as const) {
      if (attributes[name] === undefined) continue;
      if (!/^\d+$/.test(attributes[name])) throw new Error(`JUnit ${name} count is invalid`);
      aggregateFailureCount += Number(attributes[name]);
    }
  }
  const hasFailureElement = /<(?:failure|error)\b/i.test(xml);
  const aggregatePassed = aggregateFailureCount === 0 && !hasFailureElement;
  if ((expectedOutcome === "passed") !== aggregatePassed) {
    throw new Error(`JUnit aggregate result does not match expected ${expectedOutcome} evidence`);
  }
  const executions: ParsedAcceptanceExecution[] = [];
  // ponytail: Vitest emits flat testcase elements; use an XML tokenizer if nested testcase content is ever introduced.
  for (const match of xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/gi)) {
    const attributes = xmlAttributes(match[1]);
    const body = match[2] ?? "";
    const rawFile = attributes.file ?? attributes.classname ?? attributes.className;
    if (!rawFile) throw new Error("JUnit testcase is missing its test file binding");
    const fullName = attributes.name;
    if (!fullName) throw new Error("JUnit testcase is missing its exact fullName");
    const failure = body.match(/<(failure|error)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/i);
    const skipped = /<skipped\b/i.test(body);
    const todo = skipped && /\btodo\b/i.test(body);
    executions.push({
      testFile: normalizeAcceptanceTestFile(rawFile),
      fullName: decodeXml(fullName),
      status: failure ? "failed" : todo ? "todo" : skipped ? "skipped" : "passed",
      failureMessages: failure
        ? [decodeXml((failure[3] || xmlAttributes(failure[2]).message || `${failure[1]} reported`).replace(/<[^>]+>/g, " ").trim())]
        : []
    });
  }
  if (executions.length === 0) throw new Error("JUnit report contains no testcase elements");
  return executions;
}

export function parseAcceptanceExecutionReport(
  value: string | unknown,
  expectedOutcome: AcceptanceReportOutcome = "passed"
): ParsedAcceptanceExecution[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("<")) return parseJUnitReport(trimmed, expectedOutcome);
    try {
      return parseVitestJsonReport(JSON.parse(trimmed) as unknown, expectedOutcome);
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error("test evidence is neither Vitest JSON nor JUnit XML");
      throw error;
    }
  }
  return parseVitestJsonReport(value, expectedOutcome);
}

export function requireExactExecution(
  executions: readonly ParsedAcceptanceExecution[],
  testFile: string,
  fullName: string,
  expectedStatus: "passed" | "failed"
): ParsedAcceptanceExecution {
  const normalizedFile = normalizeAcceptanceTestFile(testFile);
  const matching = executions.filter((execution) => execution.testFile === normalizedFile && execution.fullName === fullName);
  if (matching.length !== 1) throw new Error("test report must contain the exact file/fullName exactly once");
  if (matching[0].status !== expectedStatus) throw new Error(`test report expected ${expectedStatus} execution`);
  return matching[0];
}

export function behavioralFailureFingerprint(
  acceptanceId: string,
  execution: Pick<ParsedAcceptanceExecution, "testFile" | "fullName" | "failureMessages">
): string {
  if (!REMEDIATION_REQUIRED_ACCEPTANCE_IDS.includes(acceptanceId)) throw new Error("acceptance ID is not approved");
  const canonical = JSON.stringify({
    testFile: normalizeAcceptanceTestFile(execution.testFile),
    fullName: execution.fullName,
    failureMessages: execution.failureMessages.map((message) => message.replace(/\s+/g, " ").trim())
  });
  return `expected_behavioral_assertion_${acceptanceId.toLowerCase()}_${createHash("sha256").update(canonical).digest("hex")}`;
}

export function localProductModuleAbsenceFingerprint(
  acceptanceId: string,
  evidence: ParsedLocalProductModuleAbsence
): string {
  if (!REMEDIATION_REQUIRED_ACCEPTANCE_IDS.includes(acceptanceId)) throw new Error("acceptance ID is not approved");
  const canonical = JSON.stringify({
    testFile: normalizeAcceptanceTestFile(evidence.testFile),
    fullName: evidence.fullName,
    missingProductModulePath: normalizeLocalProductModulePath(evidence.missingProductModulePath),
    failureMessage: evidence.failureMessage.replace(/\\/g, "/").replace(/\s+/g, " ").trim()
  });
  return `expected_local_product_module_absent_${acceptanceId.toLowerCase()}_${createHash("sha256").update(canonical).digest("hex")}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function assertAcceptancePatchBinding(binding: AcceptanceRedEvidenceBinding): void {
  const testFile = normalizeAcceptanceTestFile(binding.testFile);
  if (!binding.fullName.startsWith(`[${binding.acceptanceId}]`)) {
    throw new Error("patch fullName is not bound to its acceptance ID");
  }
  const patchHash = createHash("sha256").update(binding.patchText).digest("hex");
  if (!SHA256.test(binding.testPatchSha256) || patchHash !== binding.testPatchSha256) {
    throw new Error("test patch does not match its recorded SHA-256");
  }
  if (/[\u0000\ufffd]/.test(binding.patchText) || /GIT binary patch|Binary files .* differ/i.test(binding.patchText)) {
    throw new Error("test patch must be a textual unified diff");
  }
  const expectedHeader = new RegExp(`^diff --git a/${escapeRegExp(testFile)} b/${escapeRegExp(testFile)}$`, "m");
  const diffHeaders = [...binding.patchText.matchAll(/^diff --git a\/(.+) b\/(.+)$/gm)];
  if (diffHeaders.length === 0 || !expectedHeader.test(binding.patchText)
      || diffHeaders.some((match) => match[1] !== testFile || match[2] !== testFile)) {
    throw new Error("test patch must target only the declared test file");
  }
  const fileMarkers = [...binding.patchText.matchAll(/^(?:---|\+\+\+) (.+)$/gm)].map((match) => match[1]);
  const allowedMarkers = new Set([`a/${testFile}`, `b/${testFile}`, "/dev/null"]);
  if (fileMarkers.length < 2 || fileMarkers.some((marker) => !allowedMarkers.has(marker))) {
    throw new Error("test patch file markers are not bound to the declared test file");
  }
  const addedLines = binding.patchText.split(/\r?\n/).filter((line) => line.startsWith("+") && !line.startsWith("+++"));
  if (!addedLines.some((line) => line.includes(binding.fullName))) {
    throw new Error("test patch does not add the declared exact fullName");
  }
}

export function assertBehavioralRedExecution(execution: ParsedAcceptanceExecution): void {
  if (execution.status !== "failed" || execution.failureMessages.length === 0) {
    throw new Error("RED evidence must be a failed execution with a failure message");
  }
  if (execution.failureMessages.some((message) => INFRASTRUCTURE_FAILURE.test(message))) {
    throw new Error("RED evidence is an infrastructure or environment failure");
  }
}

export function assertExpectedBehavioralRed(
  execution: ParsedAcceptanceExecution,
  binding?: AcceptanceRedEvidenceBinding
): void {
  if (!binding) throw new Error("RED evidence requires patch and fingerprint binding");
  assertBehavioralRedExecution(execution);
  if (normalizeAcceptanceTestFile(execution.testFile) !== normalizeAcceptanceTestFile(binding.testFile)
      || execution.fullName !== binding.fullName) {
    throw new Error("RED execution does not match the declared exact file/fullName");
  }
  assertAcceptancePatchBinding(binding);
  if (behavioralFailureFingerprint(binding.acceptanceId, execution) !== binding.expectedFailureFingerprint) {
    throw new Error("RED failure fingerprint does not match the exact behavioral assertion");
  }
}

export function assertExpectedLocalProductModuleAbsentRed(
  evidence: ParsedLocalProductModuleAbsence,
  binding?: AcceptanceLocalProductModuleRedEvidenceBinding
): void {
  if (!binding) throw new Error("local product module RED requires patch, path, and fingerprint binding");
  if (normalizeAcceptanceTestFile(evidence.testFile) !== normalizeAcceptanceTestFile(binding.testFile)) {
    throw new Error("local product module RED does not match the declared test file");
  }
  if (REMEDIATION_PLAN2_ASSERTION_LOCAL_PRODUCT_MODULE_ABSENT_ACCEPTANCE_IDS.includes(binding.acceptanceId)) {
    if (evidence.fullName !== binding.fullName) {
      throw new Error("assertion-bound local product module RED fullName does not match binding");
    }
  } else if (REMEDIATION_PLAN4_FILE_LOAD_LOCAL_PRODUCT_MODULE_ABSENT_ACCEPTANCE_IDS.includes(binding.acceptanceId)) {
    if (evidence.fullName !== null) throw new Error("file-load local product module RED cannot claim an assertion fullName");
  } else {
    throw new Error("acceptance ID is not approved for local product module RED");
  }
  const evidencePath = normalizeLocalProductModulePath(evidence.missingProductModulePath);
  const bindingPath = normalizeLocalProductModulePath(binding.missingProductModulePath);
  if (evidencePath !== bindingPath) throw new Error("local product module RED path does not match binding");
  assertAcceptancePatchBinding(binding);
  if (localProductModuleAbsenceFingerprint(binding.acceptanceId, evidence) !== binding.expectedFailureFingerprint) {
    throw new Error("local product module RED fingerprint does not match exact evidence");
  }
}
