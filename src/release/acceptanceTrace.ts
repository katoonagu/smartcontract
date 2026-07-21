import { createHash } from "node:crypto";
import {
  REMEDIATION_REQUIRED_ACCEPTANCE_IDS,
  REMEDIATION_REQUIRED_REQUIREMENT_IDS,
  assertExactIdSet,
  assertNoSecretLikeArtifactValues
} from "./remediationReleaseManifest";

export type AcceptanceTraceV1 = {
  acceptanceId: string;
  requirementIds: string[];
  ownerPlan: 1 | 2 | 3 | 4 | 5;
  ownerCommitSha: string;
  testFile: string;
  fullName: string;
  primary: boolean;
  red: {
    baseSha: string;
    testPatchSha256: string;
    vitestReportSha256: string;
    expectedFailureFingerprint: string;
    status: "failed_as_expected";
  };
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
  isAncestor(ownerCommitSha: string, candidateSha: string): boolean;
};

export type AcceptanceRedEvidenceBinding = {
  acceptanceId: string;
  testFile: string;
  fullName: string;
  expectedFailureFingerprint: string;
  patchText: string;
  testPatchSha256: string;
};

type JsonRecord = Record<string, unknown>;

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const TEST_FILE = /^tests\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.test\.ts$/;
const BEHAVIORAL_FINGERPRINT = /^expected_behavioral_assertion_ac-\d{2}(?:_[a-z0-9-]+)*$/;
const INFRASTRUCTURE_FAILURE = /(?:syntaxerror|failed to load|cannot find (?:module|package)|module not found|import error|failed to resolve import|typescript|typecheck|\bts\d{4}\b|fixture|environment|test environment|setup file|config(?:uration)? error|worker exited|out of memory)/i;

const EXPECTED_OWNER_PLAN = new Map<string, 1 | 2 | 3 | 4 | 5>(
  REMEDIATION_REQUIRED_ACCEPTANCE_IDS.map((acceptanceId, index) => [
    acceptanceId,
    (index === 40 ? 5 : index < 6 ? 2 : index < 13 ? 4 : index < 18 ? 3 : index < 33 ? 2 : 4) as 1 | 2 | 3 | 4 | 5
  ])
);

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
  if (requirementIds.length === 0 || new Set(requirementIds).size !== requirementIds.length
      || requirementIds.some((id) => !REMEDIATION_REQUIRED_REQUIREMENT_IDS.includes(id))) {
    throw new Error(`${acceptanceId} requirement IDs are invalid`);
  }
  if (!Number.isInteger(trace.ownerPlan) || ![1, 2, 3, 4, 5].includes(trace.ownerPlan as number)) {
    throw new Error(`${acceptanceId} ownerPlan is invalid`);
  }
  const ownerPlan = trace.ownerPlan as 1 | 2 | 3 | 4 | 5;
  if (ownerPlan !== EXPECTED_OWNER_PLAN.get(acceptanceId)) throw new Error(`${acceptanceId} ownerPlan is incorrect`);
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
  expectExactKeys(red, [
    "baseSha",
    "testPatchSha256",
    "vitestReportSha256",
    "expectedFailureFingerprint",
    "status"
  ], `${acceptanceId}.red`);
  const baseSha = expectSha40(red.baseSha, `${acceptanceId}.red.baseSha`);
  if (baseSha === candidateSha) throw new Error(`${acceptanceId} RED base cannot be the candidate`);
  const testPatchSha256 = expectSha256(red.testPatchSha256, `${acceptanceId}.red.testPatchSha256`);
  const redReportSha256 = expectSha256(red.vitestReportSha256, `${acceptanceId}.red.vitestReportSha256`);
  const expectedFailureFingerprint = expectString(
    red.expectedFailureFingerprint,
    `${acceptanceId}.red.expectedFailureFingerprint`
  );
  if (!BEHAVIORAL_FINGERPRINT.test(expectedFailureFingerprint)
      || !expectedFailureFingerprint.includes(acceptanceId.toLowerCase())
      || INFRASTRUCTURE_FAILURE.test(expectedFailureFingerprint)) {
    throw new Error(`${acceptanceId} RED fingerprint is not an expected behavioral assertion`);
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
    red: {
      baseSha,
      testPatchSha256,
      vitestReportSha256: redReportSha256,
      expectedFailureFingerprint,
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

export function assertExpectedBehavioralRed(
  execution: ParsedAcceptanceExecution,
  binding?: AcceptanceRedEvidenceBinding
): void {
  if (!binding) throw new Error("RED evidence requires patch and fingerprint binding");
  if (execution.status !== "failed" || execution.failureMessages.length === 0) {
    throw new Error("RED evidence must be a failed execution with a failure message");
  }
  if (execution.failureMessages.some((message) => INFRASTRUCTURE_FAILURE.test(message))) {
    throw new Error("RED evidence is an import, syntax, type, fixture, or environment failure");
  }
  if (normalizeAcceptanceTestFile(execution.testFile) !== normalizeAcceptanceTestFile(binding.testFile)
      || execution.fullName !== binding.fullName) {
    throw new Error("RED execution does not match the declared exact file/fullName");
  }
  assertAcceptancePatchBinding(binding);
  if (behavioralFailureFingerprint(binding.acceptanceId, execution) !== binding.expectedFailureFingerprint) {
    throw new Error("RED failure fingerprint does not match the exact behavioral assertion");
  }
}
