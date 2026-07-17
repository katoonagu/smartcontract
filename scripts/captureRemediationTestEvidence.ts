import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  REMEDIATION_REQUIRED_ACCEPTANCE_IDS,
  REMEDIATION_REQUIRED_REQUIREMENT_IDS,
  assertNoSecretLikeArtifactValues
} from "../src/release/remediationReleaseManifest";
import {
  assertExpectedBehavioralRed,
  normalizeAcceptanceTestFile,
  parseAcceptanceExecutionReport,
  requireExactExecution,
  validateAcceptanceTraceSet,
  type AcceptanceTraceSetV1,
  type AcceptanceTraceV1,
  type ParsedAcceptanceExecution
} from "../src/release/acceptanceTrace";
import {
  REMEDIATION_ACCEPTANCE_TRACE_FILE,
  readSafeArtifactFile,
  resolveExternalArtifactRoot
} from "./verifyRemediationRelease";

type CaptureTraceSpec = {
  acceptanceId: string;
  requirementIds: string[];
  ownerPlan: 1 | 2 | 3 | 4 | 5;
  ownerCommitSha: string;
  testFile: string;
  fullName: string;
  primary: boolean;
  expectedFailureFingerprint: string;
  red: {
    baseSha: string;
    testPatchSha256: string;
    testPatchFile: string;
    reportFile: string;
  };
  green: {
    reportFile: string;
  };
};

type CaptureSpecV1 = {
  version: "acceptance-trace-capture-v1";
  candidateSha: string;
  traces: CaptureTraceSpec[];
};

type JsonRecord = Record<string, unknown>;

const execFileAsync = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const CAPTURE_SPEC_FILE = "acceptance-trace-capture.json";

function expectRecord(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as JsonRecord;
}

function expectExactKeys(record: JsonRecord, expected: readonly string[], label: string): void {
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} fields do not match the capture contract`);
  }
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function expectStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${label} must be a string array`);
  return [...value] as string[];
}

function expectRelativeArtifactPath(value: unknown, label: string): string {
  const path = expectString(value, label).replace(/\\/g, "/");
  if (isAbsolute(path) || path === ".." || path.startsWith("../") || path.includes("/../")) {
    throw new Error(`${label} escapes the artifact root`);
  }
  return path;
}

function parseCaptureTrace(value: unknown, index: number): CaptureTraceSpec {
  const trace = expectRecord(value, `traces[${index}]`);
  expectExactKeys(trace, [
    "acceptanceId",
    "requirementIds",
    "ownerPlan",
    "ownerCommitSha",
    "testFile",
    "fullName",
    "primary",
    "expectedFailureFingerprint",
    "red",
    "green"
  ], `traces[${index}]`);
  const red = expectRecord(trace.red, `traces[${index}].red`);
  expectExactKeys(red, ["baseSha", "testPatchSha256", "testPatchFile", "reportFile"], `traces[${index}].red`);
  const green = expectRecord(trace.green, `traces[${index}].green`);
  expectExactKeys(green, ["reportFile"], `traces[${index}].green`);
  if (!Number.isInteger(trace.ownerPlan) || ![1, 2, 3, 4, 5].includes(trace.ownerPlan as number)) {
    throw new Error(`traces[${index}].ownerPlan is invalid`);
  }
  if (typeof trace.primary !== "boolean") throw new Error(`traces[${index}].primary must be boolean`);
  return {
    acceptanceId: expectString(trace.acceptanceId, `traces[${index}].acceptanceId`),
    requirementIds: expectStringArray(trace.requirementIds, `traces[${index}].requirementIds`),
    ownerPlan: trace.ownerPlan as 1 | 2 | 3 | 4 | 5,
    ownerCommitSha: expectString(trace.ownerCommitSha, `traces[${index}].ownerCommitSha`),
    testFile: normalizeAcceptanceTestFile(expectString(trace.testFile, `traces[${index}].testFile`)),
    fullName: expectString(trace.fullName, `traces[${index}].fullName`),
    primary: trace.primary,
    expectedFailureFingerprint: expectString(
      trace.expectedFailureFingerprint,
      `traces[${index}].expectedFailureFingerprint`
    ),
    red: {
      baseSha: expectString(red.baseSha, `traces[${index}].red.baseSha`),
      testPatchSha256: expectString(red.testPatchSha256, `traces[${index}].red.testPatchSha256`),
      testPatchFile: expectRelativeArtifactPath(red.testPatchFile, `traces[${index}].red.testPatchFile`),
      reportFile: expectRelativeArtifactPath(red.reportFile, `traces[${index}].red.reportFile`)
    },
    green: {
      reportFile: expectRelativeArtifactPath(green.reportFile, `traces[${index}].green.reportFile`)
    }
  };
}

function parseCaptureSpec(value: unknown): CaptureSpecV1 {
  assertNoSecretLikeArtifactValues(value);
  const spec = expectRecord(value, "capture spec");
  expectExactKeys(spec, ["version", "candidateSha", "traces"], "capture spec");
  if (spec.version !== "acceptance-trace-capture-v1") throw new Error("capture spec version is invalid");
  if (!Array.isArray(spec.traces)) throw new Error("capture spec traces must be an array");
  return {
    version: "acceptance-trace-capture-v1",
    candidateSha: expectString(spec.candidateSha, "candidateSha"),
    traces: spec.traces.map(parseCaptureTrace)
  };
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function gitOutput(args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", [...args], { cwd: repositoryRoot, windowsHide: true });
  return stdout.trim().toLowerCase();
}

async function assertCommit(sha: string): Promise<void> {
  const resolved = await gitOutput(["rev-parse", "--verify", `${sha}^{commit}`]);
  if (resolved !== sha) throw new Error("commit SHA does not resolve exactly");
}

async function isAncestor(ancestor: string, candidate: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["merge-base", "--is-ancestor", ancestor, candidate], {
      cwd: repositoryRoot,
      windowsHide: true
    });
    return true;
  } catch {
    return false;
  }
}

async function assertPatchAppliesToBase(baseSha: string, patchBytes: Buffer): Promise<void> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "remediation-trace-"));
  const temporaryIndex = join(temporaryDirectory, "index");
  const temporaryPatch = join(temporaryDirectory, "test.patch");
  const env = { ...process.env, GIT_INDEX_FILE: temporaryIndex };
  try {
    await writeFile(temporaryPatch, patchBytes, { flag: "wx" });
    await execFileAsync("git", ["read-tree", baseSha], { cwd: repositoryRoot, env, windowsHide: true });
    await execFileAsync("git", ["apply", "--check", "--cached", "--whitespace=nowarn", temporaryPatch], {
      cwd: repositoryRoot,
      env,
      windowsHide: true
    });
  } catch {
    throw new Error("test patch is not applicable to its recorded RED base");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function safeWriteTrace(root: string, traceSet: AcceptanceTraceSetV1): Promise<void> {
  const output = resolve(root, REMEDIATION_ACCEPTANCE_TRACE_FILE);
  const path = relative(root, output);
  if (!path || path.startsWith("..") || isAbsolute(path)) throw new Error("trace output escapes artifact root");
  try {
    const metadata = await lstat(output);
    if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error("trace output is not a regular file");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await writeFile(output, `${JSON.stringify(traceSet, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

export async function captureRemediationTestEvidence(artifactRoot: string): Promise<AcceptanceTraceSetV1> {
  const root = await resolveExternalArtifactRoot(artifactRoot);
  const spec = parseCaptureSpec(JSON.parse((await readSafeArtifactFile(root, CAPTURE_SPEC_FILE)).toString("utf8")) as unknown);
  const headSha = await gitOutput(["rev-parse", "HEAD"]);
  if (spec.candidateSha !== headSha) throw new Error("capture candidate SHA is not the checked-out HEAD");
  await assertCommit(spec.candidateSha);

  const reportCache = new Map<string, { bytes: Buffer; executions: ParsedAcceptanceExecution[] }>();
  const readReport = async (
    path: string,
    expectedOutcome: "passed" | "failed"
  ): Promise<{ bytes: Buffer; executions: ParsedAcceptanceExecution[] }> => {
    const cacheKey = `${expectedOutcome}\u0000${path}`;
    const cached = reportCache.get(cacheKey);
    if (cached) return cached;
    const bytes = await readSafeArtifactFile(root, path);
    const parsed = { bytes, executions: parseAcceptanceExecutionReport(bytes.toString("utf8"), expectedOutcome) };
    reportCache.set(cacheKey, parsed);
    return parsed;
  };

  const traces: AcceptanceTraceV1[] = [];
  const executions = [] as AcceptanceTraceSetV1["executions"];
  const verifiedAncestry = new Set<string>();
  for (const item of spec.traces) {
    await Promise.all([assertCommit(item.ownerCommitSha), assertCommit(item.red.baseSha)]);
    if (!await isAncestor(item.ownerCommitSha, spec.candidateSha)) {
      throw new Error(`${item.acceptanceId} owner commit is not an ancestor of candidate`);
    }
    verifiedAncestry.add(`${item.ownerCommitSha}\u0000${spec.candidateSha}`);
    if (!await isAncestor(item.red.baseSha, item.ownerCommitSha)) {
      throw new Error(`${item.acceptanceId} RED base is not an ancestor of owner commit`);
    }
    const [patchBytes, redReport, greenReport] = await Promise.all([
      readSafeArtifactFile(root, item.red.testPatchFile),
      readReport(item.red.reportFile, "failed"),
      readReport(item.green.reportFile, "passed")
    ]);
    const redExecution = requireExactExecution(redReport.executions, item.testFile, item.fullName, "failed");
    const patchText = patchBytes.toString("utf8");
    assertExpectedBehavioralRed(redExecution, {
      acceptanceId: item.acceptanceId,
      testFile: item.testFile,
      fullName: item.fullName,
      expectedFailureFingerprint: item.expectedFailureFingerprint,
      patchText,
      testPatchSha256: item.red.testPatchSha256
    });
    await assertPatchAppliesToBase(item.red.baseSha, patchBytes);
    requireExactExecution(greenReport.executions, item.testFile, item.fullName, "passed");
    traces.push({
      acceptanceId: item.acceptanceId,
      requirementIds: item.requirementIds,
      ownerPlan: item.ownerPlan,
      ownerCommitSha: item.ownerCommitSha,
      testFile: item.testFile,
      fullName: item.fullName,
      primary: item.primary,
      red: {
        baseSha: item.red.baseSha,
        testPatchSha256: sha256(patchBytes),
        vitestReportSha256: sha256(redReport.bytes),
        expectedFailureFingerprint: item.expectedFailureFingerprint,
        status: "failed_as_expected"
      },
      green: {
        candidateSha: spec.candidateSha,
        vitestReportSha256: sha256(greenReport.bytes),
        status: "passed"
      }
    });
    executions.push({ testFile: item.testFile, fullName: item.fullName, status: "passed" });
  }

  const traceSet = validateAcceptanceTraceSet({
    version: "acceptance-trace-set-v1",
    candidateSha: spec.candidateSha,
    requiredRequirementIds: [...REMEDIATION_REQUIRED_REQUIREMENT_IDS],
    requiredAcceptanceIds: [...REMEDIATION_REQUIRED_ACCEPTANCE_IDS],
    traces,
    executions,
    ancestorCommitShas: [...new Set(traces.map((trace) => trace.ownerCommitSha))]
  }, {
    isAncestor: (ownerCommitSha, candidateSha) => verifiedAncestry.has(`${ownerCommitSha}\u0000${candidateSha}`)
  });
  await safeWriteTrace(root, traceSet);
  return traceSet;
}

function parseCliArgs(argv: readonly string[]): string {
  if (argv.length === 1 && argv[0]) return argv[0];
  if (argv.length !== 2 || argv[0] !== "--artifact-root" || !argv[1]) {
    throw new Error("trace capture requires one explicit --artifact-root");
  }
  return argv[1];
}

async function main(): Promise<void> {
  try {
    const traceSet = await captureRemediationTestEvidence(parseCliArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify({ status: "captured", acceptanceCount: traceSet.traces.length })}\n`);
  } catch {
    process.stderr.write("remediation_trace_capture_invalid\n");
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) void main();
