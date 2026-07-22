import { createHash } from "node:crypto";
import { execFile, spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import {
  REMEDIATION_REQUIRED_ACCEPTANCE_IDS,
  REMEDIATION_REQUIRED_REQUIREMENT_IDS,
  assertNoSecretLikeArtifactValues
} from "../src/release/remediationReleaseManifest";
import {
  assertExpectedLocalProductModuleAbsentRed,
  assertExpectedBehavioralRed,
  assertBehavioralRedExecution,
  behavioralFailureFingerprint,
  localProductModuleAbsenceFingerprint,
  normalizeAcceptanceTestFile,
  normalizeLocalProductModulePath,
  parseAcceptanceExecutionReport,
  parseLocalProductModuleAbsenceReport,
  REMEDIATION_ACCEPTANCE_OWNER_PLAN,
  REMEDIATION_ACCEPTANCE_REQUIREMENT_IDS,
  REMEDIATION_LOCAL_PRODUCT_MODULE_ABSENT_ACCEPTANCE_IDS,
  REMEDIATION_PLAN2_ASSERTION_LOCAL_PRODUCT_MODULE_ABSENT_ACCEPTANCE_IDS,
  REMEDIATION_PLAN2_FROZEN_TEST_SHA,
  REMEDIATION_PLAN4_FILE_LOAD_LOCAL_PRODUCT_MODULE_ABSENT_ACCEPTANCE_IDS,
  REMEDIATION_PLAN4_FROZEN_TEST_SHA,
  requireExactExecution,
  validateAcceptanceTraceSet,
  type AcceptanceTraceSetV1,
  type AcceptanceTraceV1,
  type ParsedLocalProductModuleAbsence,
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
    kind: "behavioral_assertion";
    baseSha: string;
    testCommitSha: string;
    redExecutionCommitSha: string;
    testPatchSha256: string;
    testPatchFile: string;
    reportFile: string;
  } | {
    kind: "local_product_module_absent";
    baseSha: string;
    testCommitSha: string;
    redExecutionCommitSha: string;
    testPatchSha256: string;
    testPatchFile: string;
    reportFile: string;
    missingProductModulePath: string;
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

type CaptureRedSpecInput = Omit<Extract<CaptureTraceSpec["red"], { kind: "behavioral_assertion" }>, "kind"> & {
  kind: "behavioral_assertion";
} | Omit<Extract<CaptureTraceSpec["red"], { kind: "local_product_module_absent" }>, "kind"> & {
  kind: "local_product_module_absent";
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
const PLAN5_TEST_SHA = "a2efb1cf6a840ef3c0dcda0fb6ae980e2c1eed24";
const PLAN4_BEHAVIORAL_RED_SHA = "a0f74b3bd079d05bbfc9c35476daf9bac07e7d72";
const PLAN3_FROZEN_DATABASE_URL = "postgresql://tron:tron@127.0.0.1:55432/tron_watch_plan3";
const PLAN3_RED_NODE_IMAGE = "node@sha256:5647be709086c696ff32edaaf1c70cd26d1da6ab2b39c32f3c7b4c4a31957e37";
const PLAN3_RED_NODE_IMAGE_ID = "sha256:5647be709086c696ff32edaaf1c70cd26d1da6ab2b39c32f3c7b4c4a31957e37";
const PLAN3_RED_POSTGRES_IMAGE = "postgres:16-alpine";
const PLAN3_RED_POSTGRES_IMAGE_ID = "sha256:4e6e670bb069649261c9c18031f0aded7bb249a5b6664ddec29c013a89310d50";
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
  { plan: 4, base: "d18067f6c49fd632bafa47a90f69f1e7bf8b1802", test: REMEDIATION_PLAN4_FROZEN_TEST_SHA, implementation: OWNER_COMMITS[4], acceptance: "Plan 4 unified Telegram acceptance" }
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
  const redKind = expectString(red.kind, `traces[${index}].red.kind`);
  if (redKind !== "behavioral_assertion" && redKind !== "local_product_module_absent") {
    throw new Error(`traces[${index}].red.kind is invalid`);
  }
  expectExactKeys(red, redKind === "behavioral_assertion" ? [
    "kind", "baseSha", "testCommitSha", "redExecutionCommitSha", "testPatchSha256", "testPatchFile", "reportFile"
  ] : [
    "kind", "baseSha", "testCommitSha", "redExecutionCommitSha", "testPatchSha256", "testPatchFile", "reportFile",
    "missingProductModulePath"
  ], `traces[${index}].red`);
  const green = expectRecord(trace.green, `traces[${index}].green`);
  expectExactKeys(green, ["reportFile"], `traces[${index}].green`);
  if (!Number.isInteger(trace.ownerPlan) || ![1, 2, 3, 4, 5].includes(trace.ownerPlan as number)) {
    throw new Error(`traces[${index}].ownerPlan is invalid`);
  }
  if (typeof trace.primary !== "boolean") throw new Error(`traces[${index}].primary must be boolean`);
  const acceptanceId = expectString(trace.acceptanceId, `traces[${index}].acceptanceId`);
  const testCommitSha = expectString(red.testCommitSha, `traces[${index}].red.testCommitSha`);
  const redExecutionCommitSha = expectString(
    red.redExecutionCommitSha,
    `traces[${index}].red.redExecutionCommitSha`
  );
  if (redKind === "local_product_module_absent") {
    const frozenTestSha = REMEDIATION_PLAN4_FILE_LOAD_LOCAL_PRODUCT_MODULE_ABSENT_ACCEPTANCE_IDS.includes(acceptanceId)
      ? REMEDIATION_PLAN4_FROZEN_TEST_SHA
      : REMEDIATION_PLAN2_ASSERTION_LOCAL_PRODUCT_MODULE_ABSENT_ACCEPTANCE_IDS.includes(acceptanceId)
        ? REMEDIATION_PLAN2_FROZEN_TEST_SHA
        : null;
    if (!frozenTestSha || testCommitSha !== frozenTestSha || redExecutionCommitSha !== frozenTestSha) {
      throw new Error(`traces[${index}] local product module RED is outside the exact approved frozen set`);
    }
  }
  return {
    acceptanceId,
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
    red: redKind === "behavioral_assertion" ? {
      kind: "behavioral_assertion",
      baseSha: expectString(red.baseSha, `traces[${index}].red.baseSha`),
      testCommitSha,
      redExecutionCommitSha,
      testPatchSha256: expectString(red.testPatchSha256, `traces[${index}].red.testPatchSha256`),
      testPatchFile: expectRelativeArtifactPath(red.testPatchFile, `traces[${index}].red.testPatchFile`),
      reportFile: expectRelativeArtifactPath(red.reportFile, `traces[${index}].red.reportFile`)
    } : {
      kind: "local_product_module_absent",
      baseSha: expectString(red.baseSha, `traces[${index}].red.baseSha`),
      testCommitSha,
      redExecutionCommitSha,
      testPatchSha256: expectString(red.testPatchSha256, `traces[${index}].red.testPatchSha256`),
      testPatchFile: expectRelativeArtifactPath(red.testPatchFile, `traces[${index}].red.testPatchFile`),
      reportFile: expectRelativeArtifactPath(red.reportFile, `traces[${index}].red.reportFile`),
      missingProductModulePath: normalizeLocalProductModulePath(expectString(
        red.missingProductModulePath,
        `traces[${index}].red.missingProductModulePath`
      ))
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

export function buildCaptureRedSpec(input: CaptureRedSpecInput): CaptureTraceSpec["red"] {
  const common = {
    baseSha: input.baseSha,
    testCommitSha: input.testCommitSha,
    redExecutionCommitSha: input.redExecutionCommitSha,
    testPatchSha256: input.testPatchSha256,
    testPatchFile: input.testPatchFile,
    reportFile: input.reportFile
  };
  return input.kind === "behavioral_assertion"
    ? { kind: "behavioral_assertion", ...common }
    : {
        kind: "local_product_module_absent",
        ...common,
        missingProductModulePath: input.missingProductModulePath
      };
}

async function gitOutput(args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", [...args], { cwd: repositoryRoot, windowsHide: true });
  return stdout.trim();
}

async function dockerOutput(args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("docker", [...args], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
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

async function productModuleBlobAtCommit(commitSha: string, productModulePath: string): Promise<string | null> {
  const normalized = normalizeLocalProductModulePath(productModulePath);
  const candidates = /\.[A-Za-z0-9]+$/.test(normalized) ? [normalized] : [
    `${normalized}.ts`, `${normalized}.tsx`, `${normalized}.js`, `${normalized}.mjs`, `${normalized}.cjs`,
    `${normalized}/index.ts`, `${normalized}/index.tsx`, `${normalized}/index.js`
  ];
  const matches: string[] = [];
  for (const candidate of candidates) {
    try {
      const type = await gitOutput(["cat-file", "-t", `${commitSha}:${candidate}`]);
      if (type === "blob") matches.push(candidate);
    } catch {}
  }
  if (matches.length > 1) throw new Error("local product module path resolves to multiple Git blobs");
  return matches[0] ?? null;
}

async function assertLocalProductModuleLineage(input: {
  testCommitSha: string;
  redExecutionCommitSha: string;
  ownerCommitSha: string;
  candidateSha: string;
  missingProductModulePath: string;
}): Promise<void> {
  if (input.redExecutionCommitSha !== input.testCommitSha) {
    throw new Error("local product module RED must execute at its exact frozen test commit");
  }
  if (!await isAncestor(input.testCommitSha, input.ownerCommitSha)) {
    throw new Error("frozen test commit is not an ancestor of owner commit");
  }
  if (!await isAncestor(input.ownerCommitSha, input.candidateSha)) {
    throw new Error("owner commit is not an ancestor of candidate");
  }
  const [atTest, atOwner, atCandidate] = await Promise.all([
    productModuleBlobAtCommit(input.testCommitSha, input.missingProductModulePath),
    productModuleBlobAtCommit(input.ownerCommitSha, input.missingProductModulePath),
    productModuleBlobAtCommit(input.candidateSha, input.missingProductModulePath)
  ]);
  if (atTest !== null) throw new Error("local product module exists at frozen test commit");
  if (atOwner === null) throw new Error("local product module is absent at owner commit");
  if (atCandidate === null) throw new Error("local product module is absent at candidate");
  if (atOwner !== atCandidate) throw new Error("local product module resolves to different owner and candidate paths");
}

export function redPatchApplicationArgs(redGroupId: string): string[] {
  return redGroupId === "plan1-renamed" ? ["-C0"] : [];
}

async function assertPatchAppliesToBase(baseSha: string, patchBytes: Buffer, redGroupId: string): Promise<void> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "remediation-trace-"));
  const temporaryIndex = join(temporaryDirectory, "index");
  const temporaryPatch = join(temporaryDirectory, "test.patch");
  const env = { ...process.env, GIT_INDEX_FILE: temporaryIndex };
  try {
    await writeFile(temporaryPatch, patchBytes, { flag: "wx" });
    await execFileAsync("git", ["read-tree", baseSha], { cwd: repositoryRoot, env, windowsHide: true });
    await execFileAsync("git", [
      "apply", "--check", "--cached", "--whitespace=nowarn", ...redPatchApplicationArgs(redGroupId), temporaryPatch
    ], {
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
  testCommitSha?: string;
  testFiles: string[];
  testPatch?: {
    baseSha: string;
    headSha: string;
    testFile: string;
    recordedBaseSha: string;
    applyToSnapshot: boolean;
  };
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
    commitSha: REMEDIATION_PLAN4_FROZEN_TEST_SHA,
    testFiles: [
      "tests/telegram/unifiedForensicRenderer.acceptance.test.ts",
      "tests/alerts/unifiedTelegramAlerts.acceptance.test.ts",
      "tests/storage/unifiedTelegramCoverage.postgres.test.ts"
    ]
  },
  {
    id: "plan4-alert-behavioral",
    commitSha: PLAN4_BEHAVIORAL_RED_SHA,
    testCommitSha: REMEDIATION_PLAN4_FROZEN_TEST_SHA,
    testFiles: ["tests/alerts/unifiedTelegramAlerts.acceptance.test.ts"],
    testPatch: {
      baseSha: "d18067f6c49fd632bafa47a90f69f1e7bf8b1802",
      headSha: REMEDIATION_PLAN4_FROZEN_TEST_SHA,
      testFile: "tests/alerts/unifiedTelegramAlerts.acceptance.test.ts",
      recordedBaseSha: "d18067f6c49fd632bafa47a90f69f1e7bf8b1802",
      applyToSnapshot: false
    }
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
    testPatch: {
      baseSha: `${CANONICAL_IDENTITY_SHA}^`,
      headSha: CANONICAL_IDENTITY_SHA,
      testFile: "tests/forensics/recentFlowProvenanceSelection.test.ts",
      recordedBaseSha: PLAN1_TEST_SHA,
      applyToSnapshot: true
    }
  },
  {
    id: "plan2-llm-dampening",
    commitSha: PLAN2_TEST_SHA,
    testFiles: ["tests/check/contractDecisionV2.acceptance.test.ts"],
    testPatch: {
      baseSha: `${CANONICAL_IDENTITY_SHA}^`,
      headSha: CANONICAL_IDENTITY_SHA,
      testFile: "tests/check/contractDecisionV2.acceptance.test.ts",
      recordedBaseSha: PLAN2_TEST_SHA,
      applyToSnapshot: true
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
    if (group.id !== "plan3") {
      await symlink(join(repositoryRoot, "node_modules"), join(temporary, "node_modules"), "junction");
    }
    if (group.testPatch?.applyToSnapshot) {
      const patchPath = join(temporary, ".plan5-red.patch");
      await writeFile(
        patchPath,
        await gitPatch(group.testPatch.baseSha, group.testPatch.headSha, group.testPatch.testFile),
        { flag: "wx" }
      );
      await execFileAsync("git", [
        "apply", "--check", "--whitespace=nowarn", ...redPatchApplicationArgs(group.id), patchPath
      ], {
        cwd: temporary,
        windowsHide: true
      });
      await execFileAsync("git", [
        "apply", "--whitespace=nowarn", ...redPatchApplicationArgs(group.id), patchPath
      ], {
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

type Plan3DisposableDatabaseBinding = {
  directUrl: string;
  databaseIp: string;
  networkName: string;
};

async function inspectPlan3DisposableDatabase(directUrl: string): Promise<Plan3DisposableDatabaseBinding> {
  const target = new URL(directUrl);
  const targetPort = Number(target.port || 5432);
  const database = decodeURIComponent(target.pathname.slice(1));
  if ((target.protocol !== "postgres:" && target.protocol !== "postgresql:")
      || target.hostname !== "127.0.0.1" || target.search || target.hash
      || database !== "tron_watch_plan3" || !target.username || !target.password
      || !Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65_535 || targetPort === 55_999) {
    throw new Error("Plan 3 RED evidence requires the exact disposable database endpoint");
  }
  const containerIds = (await dockerOutput([
    "ps", "--filter", `publish=${targetPort}`, "--format", "{{.ID}}"
  ])).split(/\r?\n/).filter(Boolean);
  if (containerIds.length !== 1) throw new Error("Plan 3 RED database endpoint does not resolve to one disposable container");
  const inspected = JSON.parse(await dockerOutput(["inspect", containerIds[0]])) as unknown;
  if (!Array.isArray(inspected) || inspected.length !== 1) throw new Error("Plan 3 RED database container inspection is invalid");
  const container = expectRecord(inspected[0], "Plan 3 RED database container");
  const state = expectRecord(container.State, "Plan 3 RED database state");
  const config = expectRecord(container.Config, "Plan 3 RED database config");
  const hostConfig = expectRecord(container.HostConfig, "Plan 3 RED database HostConfig");
  const portBindings = expectRecord(hostConfig.PortBindings, "Plan 3 RED database port bindings");
  const postgresBindings = portBindings["5432/tcp"];
  if (state.Status !== "running" || config.Image !== PLAN3_RED_POSTGRES_IMAGE
      || container.Image !== PLAN3_RED_POSTGRES_IMAGE_ID
      || !Array.isArray(postgresBindings) || postgresBindings.length !== 1) {
    throw new Error("Plan 3 RED database container identity is invalid");
  }
  const published = expectRecord(postgresBindings[0], "Plan 3 RED database published endpoint");
  if (published.HostIp !== "127.0.0.1" || published.HostPort !== String(targetPort)) {
    throw new Error("Plan 3 RED database published endpoint does not match PLAN3_TEST_DATABASE_URL");
  }
  if (await dockerOutput(["image", "inspect", PLAN3_RED_POSTGRES_IMAGE, "--format", "{{.Id}}"])
      !== PLAN3_RED_POSTGRES_IMAGE_ID) {
    throw new Error("Plan 3 RED PostgreSQL image identity is invalid");
  }
  const networkSettings = expectRecord(container.NetworkSettings, "Plan 3 RED database NetworkSettings");
  const networks = expectRecord(networkSettings.Networks, "Plan 3 RED database networks");
  const networkEntries = Object.entries(networks);
  if (networkEntries.length !== 1) throw new Error("Plan 3 RED database network is ambiguous");
  const [networkName, networkValue] = networkEntries[0];
  const databaseNetwork = expectRecord(networkValue, "Plan 3 RED database network");
  const databaseIp = expectString(databaseNetwork.IPAddress, "Plan 3 RED database IPAddress");
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(databaseIp)) throw new Error("Plan 3 RED database IP is invalid");
  return { directUrl, databaseIp, networkName };
}

async function runPlan3FrozenRedInContainer(
  snapshotRoot: string,
  group: RedGroup,
  env: NodeJS.ProcessEnv
): Promise<void> {
  const directUrl = env.PLAN3_TEST_DATABASE_URL;
  if (!directUrl) throw new Error("Plan 3 RED evidence requires PLAN3_TEST_DATABASE_URL");
  const binding = await inspectPlan3DisposableDatabase(directUrl);
  if (await dockerOutput(["image", "inspect", PLAN3_RED_NODE_IMAGE, "--format", "{{.Id}}"])
      !== PLAN3_RED_NODE_IMAGE_ID) {
    throw new Error("Plan 3 RED Node image identity is invalid");
  }
  const admin = new Client({ connectionString: binding.directUrl, connectionTimeoutMillis: 5_000, query_timeout: 5_000 });
  let connected = false;
  let roleCreated = false;
  let primaryError: unknown;
  const cleanupErrors: unknown[] = [];
  try {
    await admin.connect();
    connected = true;
    const identity = await admin.query<{
      database_name: string;
      actor: string;
      server_address: string;
      server_port: string;
      superuser: boolean;
      system_identifier: string;
    }>(`
      select current_database() as database_name,
             current_user as actor,
             host(inet_server_addr()) as server_address,
             current_setting('port') as server_port,
             (select rolsuper from pg_roles where rolname = current_user) as superuser,
             (select system_identifier::text from pg_control_system()) as system_identifier
    `);
    const row = identity.rows[0];
    const identityMismatches = !row ? ["missing-row"] : [
      row.database_name === "tron_watch_plan3" ? null : "database",
      row.actor === decodeURIComponent(new URL(binding.directUrl).username) ? null : "actor",
      row.server_address === binding.databaseIp ? null : "server-address",
      row.server_port === "5432" ? null : "server-port",
      row.superuser === true ? null : "superuser",
      /^\d+$/.test(row.system_identifier) ? null : "system-identifier"
    ].filter((value): value is string => value !== null);
    if (identityMismatches.length > 0) {
      throw new Error(`Plan 3 RED database runtime identity is invalid: ${identityMismatches.join(",")}`);
    }
    const frozenRole = await admin.query("select rolname from pg_roles where rolname = 'tron'");
    if (frozenRole.rowCount !== 0) throw new Error("Plan 3 RED frozen test role already exists");
    await admin.query("create role tron login password 'tron' nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls");
    roleCreated = true;
    await admin.query("grant create on database tron_watch_plan3 to tron");

    const proxyCode = `const net=require("node:net");net.createServer(c=>{const u=net.connect(5432,"${binding.databaseIp}");c.on("error",()=>u.destroy());u.on("error",()=>c.destroy());c.pipe(u).pipe(c)}).listen(55432,"127.0.0.1")`;
    // ponytail: immutable Plan 3 pins Windows-reserved 55432; isolate that legacy endpoint in the pinned Node container.
    const command = [
      "set -u",
      "npm ci --no-audit --no-fund >/dev/null 2>&1 || exit 90",
      `node -e '${proxyCode}' & proxy_pid=$!`,
      `node node_modules/vitest/vitest.mjs run ${group.testFiles.join(" ")} --configLoader bundle --reporter=json --outputFile=/work/.plan5-red-report.json --testTimeout=120000 --hookTimeout=120000 --no-file-parallelism`,
      "code=$?",
      "kill $proxy_pid",
      "wait $proxy_pid 2>/dev/null || true",
      "exit $code"
    ].join("; ");
    await execFileAsync("docker", [
      "run", "--rm", "--network", binding.networkName,
      "--env", "REQUIRE_PLAN3_POSTGRES=1",
      "--env", `PLAN3_TEST_DATABASE_URL=${PLAN3_FROZEN_DATABASE_URL}`,
      "--env", `TEST_DATABASE_URL=${PLAN3_FROZEN_DATABASE_URL}`,
      "--volume", `${snapshotRoot}:/work`,
      "--workdir", "/work",
      PLAN3_RED_NODE_IMAGE,
      "bash", "-lc", command
    ], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 20 * 60_000,
      maxBuffer: 16 * 1024 * 1024
    });
  } catch (error) {
    primaryError = error;
  } finally {
    if (connected && roleCreated) {
      try {
        await admin.query("revoke create on database tron_watch_plan3 from tron");
        await admin.query("drop role tron");
        const remaining = await admin.query("select rolname from pg_roles where rolname = 'tron'");
        if (remaining.rowCount !== 0) throw new Error("Plan 3 RED frozen test role cleanup failed");
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (connected) {
      try {
        await admin.end();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
  }
  if (primaryError && cleanupErrors.length > 0) {
    throw new AggregateError([primaryError, ...cleanupErrors], "Plan 3 RED execution and disposable role cleanup failed");
  }
  if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, "Plan 3 RED disposable role cleanup failed");
  if (primaryError) throw primaryError;
}

export function assertPlan3FrozenRedExecutions(executions: readonly ParsedAcceptanceExecution[]): void {
  const failedExecutions = executions.filter((execution) => execution.status === "failed");
  if (failedExecutions.length === 0) throw new Error("Plan 3 RED report has no failed executions");
  for (const execution of failedExecutions) {
    try {
      assertBehavioralRedExecution(execution);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown RED classification failure";
      throw new Error(`Plan 3 RED execution is not behavioral: ${reason}; ${execution.testFile} :: ${execution.fullName}`, {
        cause: error
      });
    }
  }
  for (const acceptanceId of ["AC-14", "AC-15"] as const) {
    const index = Number(acceptanceId.slice(3)) - 1;
    requireExactExecution(
      executions,
      PRIMARY_AC_TEST_FILES[index]!,
      PRIMARY_AC_FULL_NAMES[index]!,
      "failed"
    );
  }
}

function assertPlan3SuiteFailuresAreBehavioral(report: unknown): void {
  const root = expectRecord(report, "Plan 3 RED report");
  if (!Array.isArray(root.testResults)) throw new Error("Plan 3 RED report testResults are invalid");
  for (const [index, resultValue] of root.testResults.entries()) {
    const result = expectRecord(resultValue, `Plan 3 RED testResults[${index}]`);
    if (typeof result.message !== "string" || result.message.trim().length === 0) continue;
    assertBehavioralRedExecution({
      testFile: expectString(result.name, `Plan 3 RED testResults[${index}].name`),
      fullName: `[PLAN3-SUITE-${index}]`,
      status: "failed",
      failureMessages: [result.message]
    });
  }
}

async function runRedGroup(root: string, group: RedGroup): Promise<{
  reportRelativePath: string;
  executions: ParsedAcceptanceExecution[];
  localProductModuleAbsences: ParsedLocalProductModuleAbsence[];
}> {
  const env = buildRedGroupEnvironment(group.id, process.env);
  const snapshot = await createRedSnapshot(group);
  const reportPath = join(snapshot.root, ".plan5-red-report.json");
  let failedAsExpected = false;
  try {
    if (group.id === "plan3") {
      await runPlan3FrozenRedInContainer(snapshot.root, group, env);
    } else await execFileAsync(process.execPath, [
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
    if (!failedAsExpected) throw error;
  }
  try {
    if (!failedAsExpected) throw new Error(`RED group did not fail behaviorally: ${group.id}`);
    const reportBytes = await readFile(reportPath);
    const report = JSON.parse(reportBytes.toString("utf8")) as unknown;
    assertNoSecretLikeArtifactValues(report);
    let executions: ParsedAcceptanceExecution[] = [];
    try {
      executions = parseAcceptanceExecutionReport(report, "failed");
    } catch {}
    if (group.id === "plan3") {
      assertPlan3FrozenRedExecutions(executions);
      assertPlan3SuiteFailuresAreBehavioral(report);
    }
    const localProductModuleAbsences = ["plan2", "plan2-llm-dampening", "plan4"].includes(group.id)
      ? parseLocalProductModuleAbsenceReport(report)
      : [];
    if (executions.length === 0 && localProductModuleAbsences.length === 0) {
      throw new Error(`RED group has no exact behavioral or local product evidence: ${group.id}`);
    }
    const reportRelativePath = `trace/red/${group.id}.vitest.json`;
    await writeFile(join(root, reportRelativePath), reportBytes, { flag: "wx" });
    return { reportRelativePath, executions, localProductModuleAbsences };
  } finally {
    await snapshot.cleanup();
  }
}

export async function preflightRemediationRedGroup(groupId: string): Promise<{
  groupId: string;
  executions: number;
  localProductModuleAbsences: number;
}> {
  const group = RED_GROUPS.find((candidate) => candidate.id === groupId);
  if (!group) throw new Error("RED preflight group is not approved");
  const temporary = await mkdtemp(join(tmpdir(), `plan5-red-preflight-${groupId}-`));
  try {
    await mkdir(join(temporary, "trace/red"), { recursive: true });
    const result = await runRedGroup(temporary, group);
    return {
      groupId,
      executions: result.executions.length,
      localProductModuleAbsences: result.localProductModuleAbsences.length
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export function buildRedGroupEnvironment(groupId: string, source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = buildReleaseSuiteEnvironment(source);
  const databasePlan = groupId === "plan3" ? 3 : groupId === "plan4" ? 4 : null;
  if (databasePlan === null) return env;
  const databaseUrl = env[`PLAN${databasePlan}_TEST_DATABASE_URL`];
  if (!databaseUrl) throw new Error(`Plan ${databasePlan} RED evidence requires PLAN${databasePlan}_TEST_DATABASE_URL`);
  env.TEST_DATABASE_URL = databasePlan === 3 ? PLAN3_FROZEN_DATABASE_URL : databaseUrl;
  env[`REQUIRE_PLAN${databasePlan}_POSTGRES`] = "1";
  return env;
}

export function redGroupForTrace(testFile: string, acceptanceId: string, secondary = false): string {
  if (secondary) return "plan2-llm-dampening";
  if (acceptanceId === "AC-10" || acceptanceId === "AC-11") return "plan1-renamed";
  if (acceptanceId === "AC-41") return "plan5";
  if (["AC-20", "AC-21", "AC-24"].includes(acceptanceId)) return "plan4-alert-behavioral";
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
    requireExactExecution(greenExecutions, input.testFile, input.fullName, "passed");
    const standardBase = await gitOutput(["rev-parse", `${redGroup.commitSha}^`]);
    const patchBinding = redGroup.testPatch ?? {
      baseSha: standardBase,
      headSha: redGroup.commitSha,
      testFile: input.testFile,
      recordedBaseSha: standardBase,
      applyToSnapshot: false
    };
    const redBaseSha = patchBinding.recordedBaseSha;
    const testCommitSha = redGroup.testCommitSha ?? redGroup.commitSha;
    if (!await isAncestor(testCommitSha, redGroup.commitSha)
        || !await isAncestor(redGroup.commitSha, OWNER_COMMITS[input.ownerPlan])
        || !await isAncestor(OWNER_COMMITS[input.ownerPlan], candidateSha)) {
      throw new Error(`${input.acceptanceId} RED test/execution/owner/candidate lineage is invalid`);
    }
    const patch = await writeTracePatch(root, patchCache, {
      ...patchBinding,
      id: `${input.acceptanceId.toLowerCase()}-${input.primary ? "primary" : "secondary"}`
    });
    const redExecutions = redReport.executions.filter((execution) => (
      execution.testFile === input.testFile && execution.fullName === input.fullName
    ));
    const localAbsences = redReport.localProductModuleAbsences.filter((evidence) => (
      evidence.testFile === input.testFile
        && (evidence.fullName === input.fullName || evidence.fullName === null)
    ));
    const approvedAssertionLocal = REMEDIATION_PLAN2_ASSERTION_LOCAL_PRODUCT_MODULE_ABSENT_ACCEPTANCE_IDS
      .includes(input.acceptanceId) && localAbsences.every((evidence) => evidence.fullName === input.fullName);
    const approvedFileLoadLocal = REMEDIATION_PLAN4_FILE_LOAD_LOCAL_PRODUCT_MODULE_ABSENT_ACCEPTANCE_IDS
      .includes(input.acceptanceId) && localAbsences.every((evidence) => evidence.fullName === null);
    let red: CaptureTraceSpec["red"];
    let expectedFailureFingerprint: string;
    if (localAbsences.length === 1 && (approvedAssertionLocal || approvedFileLoadLocal)) {
      const evidence = localAbsences[0];
      expectedFailureFingerprint = localProductModuleAbsenceFingerprint(input.acceptanceId, evidence);
      assertExpectedLocalProductModuleAbsentRed(evidence, {
        acceptanceId: input.acceptanceId,
        testFile: input.testFile,
        fullName: input.fullName,
        expectedFailureFingerprint,
        missingProductModulePath: evidence.missingProductModulePath,
        patchText: patch.bytes.toString("utf8"),
        testPatchSha256: sha256(patch.bytes)
      });
      await assertLocalProductModuleLineage({
        testCommitSha,
        redExecutionCommitSha: redGroup.commitSha,
        ownerCommitSha: OWNER_COMMITS[input.ownerPlan],
        candidateSha,
        missingProductModulePath: evidence.missingProductModulePath
      });
      red = buildCaptureRedSpec({
        kind: "local_product_module_absent",
        baseSha: redBaseSha,
        testCommitSha,
        redExecutionCommitSha: redGroup.commitSha,
        testPatchSha256: sha256(patch.bytes),
        testPatchFile: patch.relativePath,
        reportFile: redReport.reportRelativePath,
        missingProductModulePath: evidence.missingProductModulePath
      });
    } else if (redExecutions.length === 1) {
      const redExecution = requireExactExecution(redReport.executions, input.testFile, input.fullName, "failed");
      expectedFailureFingerprint = behavioralFailureFingerprint(input.acceptanceId, redExecution);
      assertExpectedBehavioralRed(redExecution, {
        acceptanceId: input.acceptanceId,
        testFile: input.testFile,
        fullName: input.fullName,
        expectedFailureFingerprint,
        patchText: patch.bytes.toString("utf8"),
        testPatchSha256: sha256(patch.bytes)
      });
      red = buildCaptureRedSpec({
        kind: "behavioral_assertion",
        baseSha: redBaseSha,
        testCommitSha,
        redExecutionCommitSha: redGroup.commitSha,
        testPatchSha256: sha256(patch.bytes),
        testPatchFile: patch.relativePath,
        reportFile: redReport.reportRelativePath
      });
    } else throw new Error(`${input.acceptanceId} has no approved exact RED evidence`);
    if (redBaseSha !== testCommitSha) {
      const exactTestPatch = await gitPatch(redBaseSha, testCommitSha, input.testFile);
      if (!exactTestPatch.equals(patch.bytes)) {
        throw new Error(`${input.acceptanceId} RED patch is not the exact frozen test patch`);
      }
    }
    traces.push({
      acceptanceId: input.acceptanceId,
      requirementIds: input.requirementIds,
      ownerPlan: input.ownerPlan,
      ownerCommitSha: OWNER_COMMITS[input.ownerPlan],
      testFile: input.testFile,
      fullName: input.fullName,
      primary: input.primary,
      expectedFailureFingerprint,
      red,
      green: { reportFile: greenReportFile }
    });
  };
  for (let index = 0; index < PRIMARY_AC_FULL_NAMES.length; index += 1) {
    const acceptanceId = `AC-${String(index + 1).padStart(2, "0")}`;
    await addTrace({
      acceptanceId,
      requirementIds: [...REMEDIATION_ACCEPTANCE_REQUIREMENT_IDS[acceptanceId]!],
      ownerPlan: REMEDIATION_ACCEPTANCE_OWNER_PLAN[acceptanceId]!,
      testFile: PRIMARY_AC_TEST_FILES[index]!,
      fullName: PRIMARY_AC_FULL_NAMES[index]!,
      primary: true
    });
  }
  await addTrace({
    acceptanceId: "AC-33",
    requirementIds: [...REMEDIATION_ACCEPTANCE_REQUIREMENT_IDS["AC-33"]!],
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

  const reportCache = new Map<string, {
    bytes: Buffer;
    executions: ParsedAcceptanceExecution[];
    localProductModuleAbsences: ParsedLocalProductModuleAbsence[];
  }>();
  const readReport = async (
    path: string,
    expectedOutcome: "passed" | "failed",
    redKind?: CaptureTraceSpec["red"]["kind"]
  ): Promise<{
    bytes: Buffer;
    executions: ParsedAcceptanceExecution[];
    localProductModuleAbsences: ParsedLocalProductModuleAbsence[];
  }> => {
    const cacheKey = `${expectedOutcome}\u0000${redKind ?? "green"}\u0000${path}`;
    const cached = reportCache.get(cacheKey);
    if (cached) return cached;
    const bytes = await readSafeArtifactFile(root, path);
    const report = JSON.parse(bytes.toString("utf8")) as unknown;
    assertNoSecretLikeArtifactValues(report);
    const parsed = redKind === "local_product_module_absent" ? {
      bytes,
      executions: [],
      localProductModuleAbsences: parseLocalProductModuleAbsenceReport(report)
    } : {
      bytes,
      executions: parseAcceptanceExecutionReport(report, expectedOutcome),
      localProductModuleAbsences: []
    };
    reportCache.set(cacheKey, parsed);
    return parsed;
  };

  const traces: AcceptanceTraceV1[] = [];
  const executions = [] as AcceptanceTraceSetV1["executions"];
  const verifiedAncestry = new Set<string>();
  const verifiedPathStates = new Map<string, boolean>();
  for (const item of spec.traces) {
    await Promise.all([
      assertCommit(item.ownerCommitSha),
      assertCommit(item.red.baseSha),
      assertCommit(item.red.testCommitSha),
      assertCommit(item.red.redExecutionCommitSha)
    ]);
    if (!await isAncestor(item.ownerCommitSha, spec.candidateSha)) {
      throw new Error(`${item.acceptanceId} owner commit is not an ancestor of candidate`);
    }
    verifiedAncestry.add(`${item.ownerCommitSha}\u0000${spec.candidateSha}`);
    if (!await isAncestor(item.red.testCommitSha, item.red.redExecutionCommitSha)) {
      throw new Error(`${item.acceptanceId} test commit is not an ancestor of RED execution commit`);
    }
    verifiedAncestry.add(`${item.red.testCommitSha}\u0000${item.red.redExecutionCommitSha}`);
    if (!await isAncestor(item.red.redExecutionCommitSha, item.ownerCommitSha)) {
      throw new Error(`${item.acceptanceId} RED execution commit is not an ancestor of owner commit`);
    }
    verifiedAncestry.add(`${item.red.redExecutionCommitSha}\u0000${item.ownerCommitSha}`);
    if (!await isAncestor(item.red.baseSha, item.ownerCommitSha)) {
      throw new Error(`${item.acceptanceId} RED base is not an ancestor of owner commit`);
    }
    const [patchBytes, redReport, greenReport] = await Promise.all([
      readSafeArtifactFile(root, item.red.testPatchFile),
      readReport(item.red.reportFile, "failed", item.red.kind),
      readReport(item.green.reportFile, "passed")
    ]);
    const patchText = patchBytes.toString("utf8");
    if (item.red.kind === "behavioral_assertion") {
      const redExecution = requireExactExecution(redReport.executions, item.testFile, item.fullName, "failed");
      assertExpectedBehavioralRed(redExecution, {
        acceptanceId: item.acceptanceId,
        testFile: item.testFile,
        fullName: item.fullName,
        expectedFailureFingerprint: item.expectedFailureFingerprint,
        patchText,
        testPatchSha256: item.red.testPatchSha256
      });
    } else {
      if (!REMEDIATION_LOCAL_PRODUCT_MODULE_ABSENT_ACCEPTANCE_IDS.includes(item.acceptanceId)) {
        throw new Error(`${item.acceptanceId} is not approved for local product module RED`);
      }
      const missingProductModulePath = item.red.missingProductModulePath;
      const localEvidence = redReport.localProductModuleAbsences.filter((evidence) => (
        evidence.testFile === item.testFile
          && evidence.missingProductModulePath === missingProductModulePath
          && (evidence.fullName === item.fullName || (
            evidence.fullName === null
              && REMEDIATION_PLAN4_FILE_LOAD_LOCAL_PRODUCT_MODULE_ABSENT_ACCEPTANCE_IDS.includes(item.acceptanceId)
          ))
      ));
      if (localEvidence.length !== 1) {
        throw new Error(`${item.acceptanceId} local product module RED is not exact and unique`);
      }
      assertExpectedLocalProductModuleAbsentRed(localEvidence[0], {
        acceptanceId: item.acceptanceId,
        testFile: item.testFile,
        fullName: item.fullName,
        expectedFailureFingerprint: item.expectedFailureFingerprint,
        missingProductModulePath,
        patchText,
        testPatchSha256: item.red.testPatchSha256
      });
      await assertLocalProductModuleLineage({
        testCommitSha: item.red.testCommitSha,
        redExecutionCommitSha: item.red.redExecutionCommitSha,
        ownerCommitSha: item.ownerCommitSha,
        candidateSha: spec.candidateSha,
        missingProductModulePath
      });
      verifiedPathStates.set(`${item.red.testCommitSha}\u0000${missingProductModulePath}`, false);
      verifiedPathStates.set(`${item.ownerCommitSha}\u0000${missingProductModulePath}`, true);
      verifiedPathStates.set(`${spec.candidateSha}\u0000${missingProductModulePath}`, true);
    }
    await assertPatchAppliesToBase(
      item.red.baseSha,
      patchBytes,
      redGroupForTrace(item.testFile, item.acceptanceId, !item.primary)
    );
    if (item.red.baseSha !== item.red.testCommitSha) {
      const exactTestPatch = await gitPatch(item.red.baseSha, item.red.testCommitSha, item.testFile);
      if (!exactTestPatch.equals(patchBytes)) {
        throw new Error(`${item.acceptanceId} RED patch is not the exact frozen test patch`);
      }
    }
    requireExactExecution(greenReport.executions, item.testFile, item.fullName, "passed");
    traces.push({
      acceptanceId: item.acceptanceId,
      requirementIds: item.requirementIds,
      ownerPlan: item.ownerPlan,
      ownerCommitSha: item.ownerCommitSha,
      testFile: item.testFile,
      fullName: item.fullName,
      primary: item.primary,
      red: item.red.kind === "behavioral_assertion" ? {
        kind: "behavioral_assertion",
        baseSha: item.red.baseSha,
        testCommitSha: item.red.testCommitSha,
        redExecutionCommitSha: item.red.redExecutionCommitSha,
        testPatchSha256: sha256(patchBytes),
        vitestReportSha256: sha256(redReport.bytes),
        expectedFailureFingerprint: item.expectedFailureFingerprint,
        status: "failed_as_expected"
      } : {
        kind: "local_product_module_absent",
        baseSha: item.red.baseSha,
        testCommitSha: item.red.testCommitSha,
        redExecutionCommitSha: item.red.redExecutionCommitSha,
        testPatchSha256: sha256(patchBytes),
        vitestReportSha256: sha256(redReport.bytes),
        expectedFailureFingerprint: item.expectedFailureFingerprint,
        missingProductModulePath: item.red.missingProductModulePath,
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
    isAncestor: (ancestorCommitSha, descendantCommitSha) => (
      verifiedAncestry.has(`${ancestorCommitSha}\u0000${descendantCommitSha}`)
    ),
    pathExistsAtCommit: (commitSha, productModulePath) => {
      const key = `${commitSha}\u0000${productModulePath}`;
      if (!verifiedPathStates.has(key)) throw new Error("unverified product module path state");
      return verifiedPathStates.get(key)!;
    }
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
