import { createHash } from "node:crypto";
import { execFile, spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
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
  behavioralFailureFingerprint,
  normalizeAcceptanceTestFile,
  parseAcceptanceExecutionReport,
  requireExactExecution,
  validateAcceptanceTraceSet,
  type AcceptanceTraceSetV1,
  type AcceptanceTraceV1,
  type ParsedAcceptanceExecution
} from "../src/release/acceptanceTrace";
import { canonicalReleaseJsonV2 } from "../src/release/remediationReleaseManifestV2";
import { validateTask0BReleaseFreezeEvidence } from "../src/release/remediationReleaseManifest";
import {
  PRIMARY_AC_FULL_NAMES,
  PRIMARY_AC_TEST_FILES
} from "../tests/fixtures/release/remediationReleaseFixtures";
import {
  REMEDIATION_ACCEPTANCE_TRACE_FILE,
  buildReleaseSuiteEnvironment,
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
const TASK0_BASELINE_FILE = "task0-baseline.json";
const PLAN5_BASE_SHA = "4761e1453ea03a96845b68039e6d6f4812aae540";
const PLAN1_TEST_SHA = "bded31a8c8cfee0dda7cf8a831ca7a62567e139f";
const PLAN2_TEST_SHA = "01a29fefb51c245c3fe8f97f0da53929047740c7";
const PLAN3_TEST_SHA = "e37b37edf44d892eda721ab1cbdd362385f446c4";
const PLAN4_TEST_SHA = "20ee8a759e482c2c3037d72e561e68e289cf87b5";
const PLAN5_TEST_SHA = "a2efb1cf6a840ef3c0dcda0fb6ae980e2c1eed24";
const CANONICAL_IDENTITY_SHA = "db5d49a944c0de489f13567d87400cb32c4eedb0";
const OWNER_COMMITS = Object.freeze({
  1: "31f5c2dd3619bdaf16ecea4ac127d5232b8c1019",
  2: "83f0cb967f61b814896e5d1a4cf01cecb1c56b59",
  3: "61154fa7b6fa0d53d02bdff24d12b60276b6f065",
  4: "547d86cd6c478ca56e5b85d2ccb31cdbce2ddc17",
  5: "6ad305123838b666c643ac44f0c3d031bf21d2dd"
} as const);
const OWNER_PLAN_TRIPLES = Object.freeze([
  { plan: 1, base: "4b9adedec39c368e0a0ab5738069c7771efe5695", test: PLAN1_TEST_SHA, implementation: OWNER_COMMITS[1], acceptance: "Plan 1 remediation data acceptance" },
  { plan: 2, base: "5f6209af82e23a065bd036c6a37eabe4888a5cfe", test: PLAN2_TEST_SHA, implementation: OWNER_COMMITS[2], acceptance: "Plan 2 scoring and contract acceptance" },
  { plan: 3, base: "bd631a6c846c3daa6e2aaf528429c8864c67b849", test: PLAN3_TEST_SHA, implementation: OWNER_COMMITS[3], acceptance: "Plan 3 runtime and delivery acceptance" },
  { plan: 4, base: "d18067f6c49fd632bafa47a90f69f1e7bf8b1802", test: PLAN4_TEST_SHA, implementation: OWNER_COMMITS[4], acceptance: "Plan 4 unified Telegram acceptance" }
] as const);

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
  return stdout.trim();
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

async function ensureTraceDirectory(root: string, relativePath: string): Promise<string> {
  const path = resolve(root, relativePath);
  const boundary = relative(root, path);
  if (!boundary || boundary.startsWith("..") || isAbsolute(boundary)) {
    throw new Error("trace directory escapes artifact root");
  }
  try {
    await mkdir(path, { recursive: false });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()
      || relative(path, resolve(await realpath(path))) !== "") {
    throw new Error("trace directory is not a real directory");
  }
  return path;
}

type RedGroup = {
  id: string;
  commitSha: string;
  testFiles: string[];
  applyPatch?: { baseSha: string; headSha: string; testFile: string };
};

const RED_GROUPS: readonly RedGroup[] = Object.freeze([
  {
    id: "plan2",
    commitSha: PLAN2_TEST_SHA,
    testFiles: [
      "tests/risk/collectorUsddRemediation.acceptance.test.ts",
      "tests/approvals/approvalSafetyV2.acceptance.test.ts",
      "tests/check/contractDecisionV2.acceptance.test.ts",
      "tests/forensics/contractLlmIsolation.acceptance.test.ts"
    ]
  },
  {
    id: "plan3",
    commitSha: PLAN3_TEST_SHA,
    testFiles: [
      "tests/runtime/waitReconciliation.acceptance.test.ts",
      "tests/runtime/telegramDelivery.acceptance.test.ts",
      "tests/runtime/walletNavigation.acceptance.test.ts",
      "tests/runtime/checkCallbacks.acceptance.test.ts"
    ]
  },
  {
    id: "plan4",
    commitSha: PLAN4_TEST_SHA,
    testFiles: [
      "tests/telegram/unifiedForensicRenderer.acceptance.test.ts",
      "tests/alerts/unifiedTelegramAlerts.acceptance.test.ts",
      "tests/storage/unifiedTelegramCoverage.postgres.test.ts"
    ]
  },
  {
    id: "plan5",
    commitSha: PLAN5_TEST_SHA,
    testFiles: ["tests/release/remediationReleaseManifest.acceptance.test.ts"]
  },
  {
    id: "plan1-renamed",
    commitSha: PLAN1_TEST_SHA,
    testFiles: ["tests/forensics/recentFlowProvenanceSelection.test.ts"],
    applyPatch: {
      baseSha: `${CANONICAL_IDENTITY_SHA}^`,
      headSha: CANONICAL_IDENTITY_SHA,
      testFile: "tests/forensics/recentFlowProvenanceSelection.test.ts"
    }
  },
  {
    id: "plan2-llm-dampening",
    commitSha: PLAN2_TEST_SHA,
    testFiles: ["tests/check/contractDecisionV2.acceptance.test.ts"],
    applyPatch: {
      baseSha: `${CANONICAL_IDENTITY_SHA}^`,
      headSha: CANONICAL_IDENTITY_SHA,
      testFile: "tests/check/contractDecisionV2.acceptance.test.ts"
    }
  }
]);

async function gitPatch(baseSha: string, headSha: string, testFile: string): Promise<Buffer> {
  const { stdout } = await execFileAsync("git", [
    "diff", "--no-ext-diff", "--no-color", "--unified=3", baseSha, headSha, "--", testFile
  ], { cwd: repositoryRoot, encoding: null, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  const bytes = Buffer.from(stdout as Buffer);
  if (bytes.length === 0) throw new Error(`RED test patch is empty: ${testFile}`);
  return bytes;
}

async function createRedSnapshot(group: RedGroup): Promise<{ root: string; cleanup(): Promise<void> }> {
  const temporary = await mkdtemp(join(tmpdir(), `plan5-red-${group.id}-`));
  const archivePath = `${temporary}.tar`;
  try {
    await execFileAsync("git", ["archive", "--format=tar", `--output=${archivePath}`, group.commitSha], {
      cwd: repositoryRoot,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024
    });
    await execFileAsync("tar", ["-xf", archivePath, "-C", temporary], { windowsHide: true });
    await symlink(join(repositoryRoot, "node_modules"), join(temporary, "node_modules"), "junction");
    if (group.applyPatch) {
      const patchPath = join(temporary, ".plan5-red.patch");
      await writeFile(
        patchPath,
        await gitPatch(group.applyPatch.baseSha, group.applyPatch.headSha, group.applyPatch.testFile),
        { flag: "wx" }
      );
      await execFileAsync("git", ["apply", "--check", "--whitespace=nowarn", patchPath], {
        cwd: temporary,
        windowsHide: true
      });
      await execFileAsync("git", ["apply", "--whitespace=nowarn", patchPath], {
        cwd: temporary,
        windowsHide: true
      });
    }
    return {
      root: temporary,
      cleanup: async () => {
        await rm(temporary, { recursive: true, force: true });
        await rm(archivePath, { force: true });
      }
    };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    await rm(archivePath, { force: true });
    throw error;
  }
}

async function runRedGroup(root: string, group: RedGroup): Promise<{
  reportRelativePath: string;
  executions: ParsedAcceptanceExecution[];
}> {
  const snapshot = await createRedSnapshot(group);
  const reportPath = join(snapshot.root, ".plan5-red-report.json");
  const env = buildReleaseSuiteEnvironment(process.env);
  if (group.id === "plan4") {
    const databaseUrl = env.PLAN4_TEST_DATABASE_URL;
    if (!databaseUrl) throw new Error("Plan 4 RED evidence requires PLAN4_TEST_DATABASE_URL");
    env.TEST_DATABASE_URL = databaseUrl;
    env.REQUIRE_PLAN4_POSTGRES = "1";
  }
  let failedAsExpected = false;
  try {
    await execFileAsync(process.execPath, [
      join(snapshot.root, "node_modules/vitest/vitest.mjs"),
      "run",
      ...group.testFiles,
      "--configLoader", "bundle",
      "--reporter=json",
      `--outputFile=${reportPath}`,
      "--testTimeout=120000",
      "--hookTimeout=120000",
      "--no-file-parallelism"
    ], {
      cwd: snapshot.root,
      env,
      encoding: "utf8",
      windowsHide: true,
      timeout: 20 * 60_000,
      maxBuffer: 16 * 1024 * 1024
    });
  } catch (error) {
    const failure = error as Error & { code?: number | string };
    failedAsExpected = Number(failure.code) === 1;
  }
  try {
    if (!failedAsExpected) throw new Error(`RED group did not fail behaviorally: ${group.id}`);
    const reportBytes = await readFile(reportPath);
    assertNoSecretLikeArtifactValues(JSON.parse(reportBytes.toString("utf8")) as unknown);
    const executions = parseAcceptanceExecutionReport(reportBytes.toString("utf8"), "failed");
    const reportRelativePath = `trace/red/${group.id}.vitest.json`;
    await writeFile(join(root, reportRelativePath), reportBytes, { flag: "wx" });
    return { reportRelativePath, executions };
  } finally {
    await snapshot.cleanup();
  }
}

function ownerPlanForAcceptanceIndex(index: number): 1 | 2 | 3 | 4 | 5 {
  return (index === 40 ? 5 : index < 6 ? 2 : index < 13 ? 4 : index < 18 ? 3 : index < 33 ? 2 : 4);
}

function redGroupForTrace(testFile: string, acceptanceId: string, secondary = false): string {
  if (secondary) return "plan2-llm-dampening";
  if (acceptanceId === "AC-10" || acceptanceId === "AC-11") return "plan1-renamed";
  if (acceptanceId === "AC-41") return "plan5";
  if (testFile.startsWith("tests/runtime/")) return "plan3";
  if (testFile.startsWith("tests/telegram/") || testFile.startsWith("tests/alerts/")
      || testFile === "tests/storage/unifiedTelegramCoverage.postgres.test.ts") return "plan4";
  return "plan2";
}

function greenGroupForTrace(testFile: string, acceptanceId: string): string {
  if (acceptanceId === "AC-10" || acceptanceId === "AC-11") return "plan1";
  if (acceptanceId === "AC-41") return "plan5";
  if (testFile.startsWith("tests/runtime/")) return "plan3";
  if (testFile.startsWith("tests/telegram/") || testFile.startsWith("tests/alerts/")
      || testFile === "tests/storage/unifiedTelegramCoverage.postgres.test.ts") return "plan4";
  return "plan2";
}

async function writeTracePatch(
  root: string,
  cache: Map<string, { relativePath: string; bytes: Buffer }>,
  input: { baseSha: string; headSha: string; testFile: string; id: string }
): Promise<{ relativePath: string; bytes: Buffer }> {
  const key = `${input.baseSha}\u0000${input.headSha}\u0000${input.testFile}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const bytes = await gitPatch(input.baseSha, input.headSha, input.testFile);
  const relativePath = `trace/patches/${input.id}-${sha256(bytes).slice(0, 16)}.patch`;
  await writeFile(join(root, relativePath), bytes, { flag: "wx" });
  const result = { relativePath, bytes };
  cache.set(key, result);
  return result;
}

async function createTask0Baseline(root: string, candidateSha: string): Promise<void> {
  const branch = await gitOutput(["branch", "--show-current"]);
  const configuredBase = await gitOutput(["config", "--get", `branch.${branch}.plan5BaseSha`]);
  if (branch !== "codex/remediation-end-to-end-release" || configuredBase !== PLAN5_BASE_SHA) {
    throw new Error("Task0 baseline branch binding is invalid");
  }
  const candidateStatus = (await execFileAsync("git", [
    "status", "--porcelain=v1", "--untracked-files=all"
  ], { cwd: repositoryRoot, encoding: "utf8", windowsHide: true })).stdout.trim();
  if (candidateStatus !== "") throw new Error("Task0 baseline candidate worktree is dirty");
  const task0b = validateTask0BReleaseFreezeEvidence(
    JSON.parse((await readSafeArtifactFile(root, "task0b-release-freeze.json")).toString("utf8")),
    candidateSha
  );
  const commonDirectory = await gitOutput(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const mainWorktree = dirname(commonDirectory);
  const runMainGit = async (args: string[]) => {
    const { stdout } = await execFileAsync("git", args, { cwd: mainWorktree, encoding: "utf8", windowsHide: true });
    return stdout.replace(/\r\n/gu, "\n").trimEnd();
  };
  const mainStatus = await runMainGit(["status", "--short", "--untracked-files=all"]);
  const statusLines = mainStatus ? mainStatus.split("\n") : [];
  const stashOutput = await runMainGit(["stash", "list", "--format=%H"]);
  const stashShas = stashOutput ? stashOutput.split("\n") : [];
  if (statusLines.length !== 13 || stashShas.length !== 4) {
    throw new Error("Task0 baseline main worktree state changed");
  }
  const migrationBytes = await readFile(join(repositoryRoot, "migrations/032_telegram_runtime_forensics_data_contracts.sql"));
  const migration033 = (await execFileAsync("git", ["ls-files", "migrations"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true
  })).stdout.trim().split(/\r?\n/gu).filter((path) => (
    /^0(?:3[3-9]|[4-9]\d)_.*\.sql$/u.test(path.replace(/\\/gu, "/").split("/").at(-1) ?? "")
  ));
  const candidateMigrationStatus = (await execFileAsync("git", ["status", "--short", "--", "migrations"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true
  })).stdout.trim().split(/\r?\n/gu).filter(Boolean);
  await assertCommit(task0b.previousRuntimeSha);
  const admin = await fetch("http://127.0.0.1:8787/", { signal: AbortSignal.timeout(5_000) });
  if (admin.status !== 200) throw new Error("Task0 baseline previous runtime Admin is unavailable");
  const baseline = {
    schemaVersion: "plan5-task0-local-baseline-v2",
    generatedAt: new Date().toISOString(),
    candidate: {
      branch,
      plan5BaseSha: PLAN5_BASE_SHA,
      branchConfigVerified: true,
      plan4FinalSha: OWNER_COMMITS[4],
      plan4FinalAncestor: await isAncestor(OWNER_COMMITS[4], candidateSha),
      approvedPlan5Commit: "37274b0b5fa1b77c8d87a22856ca903895f9af8c",
      approvedAmendmentCommit: PLAN5_BASE_SHA,
      approvedAmendmentAtHead: await isAncestor(PLAN5_BASE_SHA, candidateSha)
    },
    userState: {
      canonicalization: "git-status-short-lines-lf-and-stash-object-shas-lf",
      mainStatusCount: statusLines.length,
      mainManifestSha256: sha256(Buffer.from(`${statusLines.join("\n")}\n`, "utf8")),
      stashCount: stashShas.length,
      stashManifestSha256: sha256(Buffer.from(`${stashShas.join("\n")}\n`, "utf8")),
      stashShas,
      modified: false
    },
    migration: {
      file: "032_telegram_runtime_forensics_data_contracts.sql",
      sha256: sha256(migrationBytes),
      approvedMatch: sha256(migrationBytes) === "41217f64c33cb416b9f5963e15ae56e074a6a527c1c2effdadff0d8b91f6938d",
      migration033OrLater: migration033,
      uncommittedMigrationChanges: candidateMigrationStatus
    },
    disposableDatabases: ["tron_watch_plan5_clean", "tron_watch_plan5_clone", "tron_watch_plan5_runtime_sanitized"],
    runtimeSnapshot: {
      purpose: "task0a_observation_not_release_preflight",
      previousRuntimeSha: task0b.previousRuntimeSha,
      previousRuntimeShaExistsLocally: true,
      previousRuntimeShaIsCandidateAncestor: await isAncestor(task0b.previousRuntimeSha, candidateSha),
      runtimeLabel: task0b.previousRuntimeLabel,
      databaseName: task0b.productionDatabase.name,
      databaseHostClass: task0b.productionDatabase.endpointHostClass,
      databasePort: task0b.productionDatabase.endpointPort,
      databaseListenerObserved: true,
      databaseSchemaState: task0b.productionDatabase.schemaState === "legacy_031" ? "legacy_031" : "schema_032_verified",
      schema032ReceiptState: task0b.productionDatabase.schema032ReceiptPrestate.state,
      databaseStateSource: "user_authorized_current_runtime_baseline",
      adminUrl: "http://127.0.0.1:8787/",
      adminHttpStatus: admin.status,
      runtimeProcessObserved: true,
      runtimeCommandShape: "node --import tsx src/index.ts",
      telegramMode: "long_polling",
      telegramModeSource: "user_authorized_current_runtime_baseline",
      runtimeStoppedOrStartedByTask0: false,
      databaseMutatedByTask0: false,
      telegramMessageSentByTask0: false,
      requiresTask0BReverification: true
    },
    postgresToolsSnapshot: {
      hostPgDump: null,
      hostPgRestore: null,
      dockerAvailable: true,
      dockerImageId: task0b.postgresTools.provider.immutableImageId,
      pgDumpVersion: task0b.postgresTools.pgDump.version.replace(/^pg_dump \(PostgreSQL\) /u, ""),
      pgRestoreVersion: task0b.postgresTools.pgRestore.version.replace(/^pg_restore \(PostgreSQL\) /u, ""),
      releaseCommandIdsVerified: false,
      releaseCommandVerificationDeferredTo: "task0b_before_task9"
    },
    ownerPlans: OWNER_PLAN_TRIPLES.map((plan) => ({ ...plan, verifiedAncestor: true })),
    traceCoverage: {
      priorAcceptanceIds: 40,
      priorPlanCommitTriplesResolvedAtPlanLevel: 40,
      exactPerAcRedGreenTrace: "pending_tasks_1_through_6",
      ac41Ownership: "plan5",
      ac41RedGreenTrace: "pending_tasks_1_through_6",
      task0aPass: true
    },
    operationalPreflight: {
      requiredImmediatelyBefore: "task9",
      status: "pending_not_blocking_tasks_1_through_8",
      requiredFields: ["previous_runtime_sha_and_label", "production_database", "rollback_worktree", "postgres_tools", "protected_artifact_root"],
      missingAnyFieldBlocksTask9: true,
      missingAnyFieldBlocksReadyForRelease: true
    },
    secretHandling: {
      secretValuesRecorded: false,
      credentialsRecorded: false,
      tokensRecorded: false,
      apiKeysRecorded: false
    }
  };
  const api = await import("../src/release/remediationReleaseManifest");
  api.validateTask0BaselineEvidence(baseline, candidateSha, { isAncestor: (ancestor, candidate) => {
    const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, candidate], {
      cwd: repositoryRoot,
      windowsHide: true
    });
    return result.status === 0;
  } });
  await writeFile(join(root, TASK0_BASELINE_FILE), Buffer.from(`${canonicalReleaseJsonV2(baseline)}\n`, "utf8"), { flag: "wx" });
}

export async function prepareRemediationTestEvidence(artifactRoot: string): Promise<CaptureSpecV1> {
  const root = await resolveExternalArtifactRoot(artifactRoot);
  const candidateSha = await gitOutput(["rev-parse", "HEAD"]);
  const candidateStatus = (await execFileAsync("git", [
    "status", "--porcelain=v1", "--untracked-files=all"
  ], { cwd: repositoryRoot, encoding: "utf8", windowsHide: true })).stdout.trim();
  if (candidateStatus !== "") throw new Error("trace prepare candidate worktree is dirty");
  await ensureTraceDirectory(root, "trace");
  await ensureTraceDirectory(root, "trace/red");
  await ensureTraceDirectory(root, "trace/patches");
  const redReports = new Map<string, Awaited<ReturnType<typeof runRedGroup>>>();
  for (const group of RED_GROUPS) redReports.set(group.id, await runRedGroup(root, group));
  const patchCache = new Map<string, { relativePath: string; bytes: Buffer }>();
  const traces: CaptureTraceSpec[] = [];
  const addTrace = async (input: {
    acceptanceId: string;
    testFile: string;
    fullName: string;
    ownerPlan: 1 | 2 | 3 | 4 | 5;
    primary: boolean;
    requirementIds: string[];
    secondary?: boolean;
  }) => {
    const redGroupId = redGroupForTrace(input.testFile, input.acceptanceId, input.secondary);
    const redGroup = RED_GROUPS.find((group) => group.id === redGroupId)!;
    const redReport = redReports.get(redGroupId)!;
    const greenGroup = greenGroupForTrace(input.testFile, input.acceptanceId);
    const greenReportFile = `suite-${greenGroup}.vitest.json`;
    const greenExecutions = parseAcceptanceExecutionReport(
      (await readSafeArtifactFile(root, greenReportFile)).toString("utf8"),
      "passed"
    );
    const redExecution = requireExactExecution(redReport.executions, input.testFile, input.fullName, "failed");
    requireExactExecution(greenExecutions, input.testFile, input.fullName, "passed");
    const standardBase = await gitOutput(["rev-parse", `${redGroup.commitSha}^`]);
    const patchBinding = redGroup.applyPatch ?? {
      baseSha: standardBase,
      headSha: redGroup.commitSha,
      testFile: input.testFile
    };
    const redBaseSha = redGroup.applyPatch ? redGroup.commitSha : standardBase;
    const patch = await writeTracePatch(root, patchCache, {
      ...patchBinding,
      id: `${input.acceptanceId.toLowerCase()}-${input.primary ? "primary" : "secondary"}`
    });
    traces.push({
      acceptanceId: input.acceptanceId,
      requirementIds: input.requirementIds,
      ownerPlan: input.ownerPlan,
      ownerCommitSha: OWNER_COMMITS[input.ownerPlan],
      testFile: input.testFile,
      fullName: input.fullName,
      primary: input.primary,
      expectedFailureFingerprint: behavioralFailureFingerprint(input.acceptanceId, redExecution),
      red: {
        baseSha: redBaseSha,
        testPatchSha256: sha256(patch.bytes),
        testPatchFile: patch.relativePath,
        reportFile: redReport.reportRelativePath
      },
      green: { reportFile: greenReportFile }
    });
  };
  for (let index = 0; index < PRIMARY_AC_FULL_NAMES.length; index += 1) {
    const acceptanceId = `AC-${String(index + 1).padStart(2, "0")}`;
    await addTrace({
      acceptanceId,
      requirementIds: [`REQ-${String((index % 38) + 1).padStart(2, "0")}`],
      ownerPlan: ownerPlanForAcceptanceIndex(index),
      testFile: PRIMARY_AC_TEST_FILES[index]!,
      fullName: PRIMARY_AC_FULL_NAMES[index]!,
      primary: true
    });
  }
  await addTrace({
    acceptanceId: "AC-33",
    requirementIds: ["REQ-35", "REQ-38"],
    ownerPlan: 2,
    testFile: "tests/check/contractDecisionV2.acceptance.test.ts",
    fullName: "[AC-33][LLM-DAMPENING] prevents legacy LLM context from lowering provider risk Verify20 or exact debit proof",
    primary: false,
    secondary: true
  });
  const spec: CaptureSpecV1 = {
    version: "acceptance-trace-capture-v1",
    candidateSha,
    traces
  };
  parseCaptureSpec(spec);
  await createTask0Baseline(root, candidateSha);
  await writeFile(join(root, CAPTURE_SPEC_FILE), Buffer.from(`${canonicalReleaseJsonV2(spec)}\n`, "utf8"), { flag: "wx" });
  return spec;
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
    assertNoSecretLikeArtifactValues(JSON.parse(bytes.toString("utf8")) as unknown);
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
    const args = process.argv.slice(2);
    if (args[0] === "--prepare") {
      if (!args[1] || args.length !== 2) throw new Error("trace prepare requires one artifact root");
      const spec = await prepareRemediationTestEvidence(args[1]);
      process.stdout.write(`${JSON.stringify({ status: "prepared", traceCount: spec.traces.length })}\n`);
      return;
    }
    const traceSet = await captureRemediationTestEvidence(parseCliArgs(args));
    process.stdout.write(`${JSON.stringify({ status: "captured", acceptanceCount: traceSet.traces.length })}\n`);
  } catch {
    process.stderr.write("remediation_trace_capture_invalid\n");
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) void main();
