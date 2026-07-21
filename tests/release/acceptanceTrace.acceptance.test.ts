import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import {
  EXPECTED_ACCEPTANCE_OWNER_PLAN,
  EXPECTED_ACCEPTANCE_REQUIREMENT_IDS,
  buildAcceptanceTraceSet,
  cloneFixture
} from "../fixtures/release/remediationReleaseFixtures";

type ParsedExecution = {
  testFile: string;
  fullName: string;
  status: "failed";
  failureMessages: string[];
};

type TraceDependencies = { isAncestor(ownerCommitSha: string, candidateSha: string): boolean };
const PLAN4_FROZEN_TEST_SHA = "20ee8a759e482c2c3037d72e561e68e289cf87b5";

type ParsedLocalProductModuleAbsence = {
  testFile: string;
  missingProductModulePath: string;
  failureMessage: string;
};

type TraceApi = {
  validateAcceptanceTraceSet(value: unknown, dependencies: TraceDependencies): unknown;
  parseVitestJsonReport(value: unknown): Array<{ status: string }>;
  parseJUnitReport(value: string): Array<{ status: string }>;
  parseLocalProductModuleAbsenceReport(value: unknown): ParsedLocalProductModuleAbsence[];
  localProductModuleAbsenceFingerprint(
    acceptanceId: string,
    evidence: ParsedLocalProductModuleAbsence
  ): string;
  assertExpectedLocalProductModuleAbsentRed(evidence: ParsedLocalProductModuleAbsence, binding: {
    acceptanceId: string;
    testFile: string;
    fullName: string;
    expectedFailureFingerprint: string;
    missingProductModulePath: string;
    patchText: string;
    testPatchSha256: string;
  }): void;
  assertExpectedBehavioralRed(execution: ParsedExecution, binding: {
    acceptanceId: string;
    testFile: string;
    fullName: string;
    expectedFailureFingerprint: string;
    patchText: string;
    testPatchSha256: string;
  }): void;
};

async function loadTraceApi(): Promise<TraceApi> {
  const modulePath: string = "../../src/release/acceptanceTrace";
  try {
    const loaded = await import(/* @vite-ignore */ modulePath) as Partial<TraceApi>;
    if (typeof loaded.validateAcceptanceTraceSet !== "function"
        || typeof loaded.parseVitestJsonReport !== "function"
        || typeof loaded.parseJUnitReport !== "function"
        || typeof loaded.parseLocalProductModuleAbsenceReport !== "function"
        || typeof loaded.localProductModuleAbsenceFingerprint !== "function"
        || typeof loaded.assertExpectedLocalProductModuleAbsentRed !== "function"
        || typeof loaded.assertExpectedBehavioralRed !== "function") {
      throw new Error("validator export missing");
    }
    return loaded as TraceApi;
  } catch (error) {
    throw new Error("Plan 5 feature missing: typed acceptance trace validator", { cause: error });
  }
}

const fixtureAncestry: TraceDependencies = {
  isAncestor: (ancestorCommitSha, descendantCommitSha) => {
    if (ancestorCommitSha === descendantCommitSha) return true;
    const fixture = buildAcceptanceTraceSet();
    if (descendantCommitSha === fixture.candidateSha) {
      return fixture.ancestorCommitShas.includes(ancestorCommitSha)
        || fixture.traces.some((trace) => trace.red.testCommitSha === ancestorCommitSha);
    }
    return fixture.traces.some((trace) => (
      trace.red.testCommitSha === ancestorCommitSha && trace.ownerCommitSha === descendantCommitSha
    ));
  }
};

function expectedFailureFingerprint(acceptanceId: string, execution: ParsedExecution): string {
  const canonical = JSON.stringify({
    testFile: execution.testFile,
    fullName: execution.fullName,
    failureMessages: execution.failureMessages.map((message) => message.replace(/\s+/g, " ").trim())
  });
  return `expected_behavioral_assertion_${acceptanceId.toLowerCase()}_${createHash("sha256").update(canonical).digest("hex")}`;
}

it("[AC-41][TRACEABILITY] requires every REQ-01 through REQ-38 and AC-01 through AC-41 exactly once", async () => {
  const { validateAcceptanceTraceSet: validate } = await loadTraceApi();
  expect(() => validate(buildAcceptanceTraceSet(), fixtureAncestry)).not.toThrow();
  const invalid = [
    (trace: any) => { trace.requiredRequirementIds.pop(); },
    (trace: any) => { trace.requiredRequirementIds.push("REQ-38"); },
    (trace: any) => { trace.requiredAcceptanceIds.pop(); },
    (trace: any) => { trace.traces.pop(); },
    (trace: any) => { trace.traces.push(cloneFixture(trace.traces[0])); },
    (trace: any) => { trace.traces[0].acceptanceId = "AC-99"; }
  ];
  for (const mutate of invalid) {
    const trace: any = cloneFixture(buildAcceptanceTraceSet());
    mutate(trace);
    expect(() => validate(trace, fixtureAncestry)).toThrow();
  }
});

it("[AC-41][TRACE-LINEAGE] enforces the exact semantic AC requirement and owner-plan table", async () => {
  const { validateAcceptanceTraceSet: validate } = await loadTraceApi();
  const fixture = buildAcceptanceTraceSet();
  const byId = new Map(fixture.traces.map((trace) => [trace.acceptanceId, trace]));
  expect(byId.get("AC-01")?.requirementIds).toEqual(["REQ-15", "REQ-16"]);
  expect(byId.get("AC-10")?.ownerPlan).toBe(1);
  expect(byId.get("AC-20")?.ownerPlan).toBe(4);
  expect(byId.get("AC-34")?.ownerPlan).toBe(2);
  expect(byId.get("AC-41")?.requirementIds).toEqual(["REQ-38"]);
  expect(Object.keys(EXPECTED_ACCEPTANCE_OWNER_PLAN)).toHaveLength(41);
  expect(Object.keys(EXPECTED_ACCEPTANCE_REQUIREMENT_IDS)).toHaveLength(41);

  const invalid = [
    (trace: any) => { trace.traces[0].requirementIds = ["REQ-01"]; },
    (trace: any) => { trace.traces[11].requirementIds = [...trace.traces[11].requirementIds].reverse(); },
    (trace: any) => { trace.traces[9].ownerPlan = 4; },
    (trace: any) => { trace.traces[19].ownerPlan = 2; },
    (trace: any) => { trace.traces[33].ownerPlan = 4; },
    (trace: any) => { trace.traces[40].ownerPlan = 2; }
  ];
  for (const mutate of invalid) {
    const trace: any = cloneFixture(fixture);
    mutate(trace);
    expect(() => validate(trace, fixtureAncestry)).toThrow(/requirement IDs|ownerPlan/);
  }
});

it("[AC-41][EXECUTION] requires every exact AC fullName to execute and pass without skip or todo", async () => {
  const api = await loadTraceApi();
  const { validateAcceptanceTraceSet: validate } = api;
  const invalid = [
    (trace: any) => { trace.executions.pop(); },
    (trace: any) => { trace.executions[0].status = "failed"; },
    (trace: any) => { trace.executions[0].status = "skipped"; },
    (trace: any) => { trace.executions[0].status = "todo"; },
    (trace: any) => { trace.executions[0].fullName += " filtered"; },
    (trace: any) => { trace.executions.push(cloneFixture(trace.executions[0])); }
  ];
  for (const mutate of invalid) {
    const trace: any = cloneFixture(buildAcceptanceTraceSet());
    mutate(trace);
    expect(() => validate(trace, fixtureAncestry)).toThrow();
  }

  const target = buildAcceptanceTraceSet().traces[0];
  const passedAssertion = {
    ancestorTitles: ["nested suite"],
    fullName: `nested suite ${target.fullName}`,
    title: target.fullName,
    status: "passed",
    failureMessages: []
  };
  const validJson = {
    success: true,
    numFailedTestSuites: 0,
    numFailedTests: 0,
    testResults: [{ name: target.testFile, assertionResults: [passedAssertion] }]
  };
  expect(api.parseVitestJsonReport(validJson)).toEqual([{
    testFile: target.testFile,
    fullName: target.fullName,
    status: "passed",
    failureMessages: []
  }]);
  const executionGaps: string[] = [];
  try {
    api.parseVitestJsonReport({
      ...validJson,
      success: false,
      numFailedTestSuites: 1,
      numFailedTests: 1
    });
    executionGaps.push("Vitest aggregate failure was accepted");
  } catch {}

  const passedTestcase = `<testcase file="${target.testFile}" name="${target.fullName}"/>`;
  const validJunit = `<testsuites tests="1" failures="0" errors="0"><testsuite tests="1" failures="0" errors="0">${passedTestcase}</testsuite></testsuites>`;
  expect(api.parseJUnitReport(validJunit)).toHaveLength(1);
  const invalidJunit = [
    ["JUnit testsuites failure count was accepted", `<testsuites tests="1" failures="1" errors="0"><testsuite tests="1" failures="0" errors="0">${passedTestcase}</testsuite></testsuites>`],
    ["JUnit testsuite error count was accepted", `<testsuites tests="1" failures="0" errors="0"><testsuite tests="1" failures="0" errors="1">${passedTestcase}</testsuite></testsuites>`],
    ["JUnit self-closing failure was accepted", `<testsuites><testsuite>${passedTestcase}<testcase file="${target.testFile}" name="other"><failure/></testcase></testsuite></testsuites>`],
    ["JUnit failure body was accepted", `<testsuites><testsuite>${passedTestcase}<testcase file="${target.testFile}" name="other"><failure>assertion</failure></testcase></testsuite></testsuites>`],
    ["JUnit self-closing error was accepted", `<testsuites><testsuite>${passedTestcase}<testcase file="${target.testFile}" name="other"><error/></testcase></testsuite></testsuites>`],
    ["JUnit error body was accepted", `<testsuites><testsuite>${passedTestcase}<testcase file="${target.testFile}" name="other"><error>runtime</error></testcase></testsuite></testsuites>`]
  ] as const;
  for (const [message, report] of invalidJunit) {
    try {
      api.parseJUnitReport(report);
      executionGaps.push(message);
    } catch {}
  }
  expect(executionGaps, executionGaps.join("; ")).toEqual([]);
});

it("[AC-41][RED-PROVENANCE] requires owner commit expected RED and candidate GREEN evidence for every AC", async () => {
  const api = await loadTraceApi();
  const { validateAcceptanceTraceSet: validate } = api;
  const invalid = [
    (trace: any) => { trace.traces[0].ownerCommitSha = "f".repeat(40); },
    (trace: any) => { trace.traces[0].red.kind = "environment_failure"; },
    (trace: any) => { trace.traces[0].red.baseSha = "bad"; },
    (trace: any) => { trace.traces[0].red.testCommitSha = "bad"; },
    (trace: any) => { trace.traces[0].red.redExecutionCommitSha = "bad"; },
    (trace: any) => { trace.traces[0].red.testPatchSha256 = "bad"; },
    (trace: any) => { trace.traces[0].red.vitestReportSha256 = "bad"; },
    (trace: any) => { trace.traces[0].red.expectedFailureFingerprint = "fixture import error"; },
    (trace: any) => { trace.traces[0].red.status = "failed"; },
    (trace: any) => { trace.traces[0].green.candidateSha = "f".repeat(40); },
    (trace: any) => { trace.traces[0].green.vitestReportSha256 = "bad"; },
    (trace: any) => { trace.traces[0].green.status = "skipped"; }
  ];
  for (const mutate of invalid) {
    const trace: any = cloneFixture(buildAcceptanceTraceSet());
    mutate(trace);
    expect(() => validate(trace, fixtureAncestry)).toThrow();
  }

  const gaps: string[] = [];
  const forged: any = cloneFixture(buildAcceptanceTraceSet());
  const forgedOwner = "e".repeat(40);
  forged.traces[0].ownerCommitSha = forgedOwner;
  forged.ancestorCommitShas.push(forgedOwner);
  try {
    validate(forged, {
      isAncestor: (ownerCommitSha, candidateSha) => ownerCommitSha !== forgedOwner
        && fixtureAncestry.isAncestor(ownerCommitSha, candidateSha)
    });
    gaps.push("artifact ancestry was trusted");
  } catch {}

  const trace = buildAcceptanceTraceSet().traces[0];
  const expectedExecution: ParsedExecution = {
    testFile: trace.testFile,
    fullName: trace.fullName,
    status: "failed",
    failureMessages: ["AssertionError: expected 35 to be 55"]
  };
  const fingerprint = expectedFailureFingerprint(trace.acceptanceId, expectedExecution);
  const boundPatch = [
    `diff --git a/${trace.testFile} b/${trace.testFile}`,
    `--- a/${trace.testFile}`,
    `+++ b/${trace.testFile}`,
    "@@ -1,0 +1,1 @@",
    `+it(\"${trace.fullName}\", () => expect(35).toBe(55));`
  ].join("\n");
  const unrelatedPatch = boundPatch.replaceAll(trace.testFile, "tests/release/unrelated.acceptance.test.ts");
  try {
    api.assertExpectedBehavioralRed(expectedExecution, {
      acceptanceId: trace.acceptanceId,
      testFile: trace.testFile,
      fullName: trace.fullName,
      expectedFailureFingerprint: fingerprint,
      patchText: unrelatedPatch,
      testPatchSha256: createHash("sha256").update(unrelatedPatch).digest("hex")
    });
    gaps.push("unrelated patch was accepted");
  } catch {}
  try {
    api.assertExpectedBehavioralRed({
      ...expectedExecution,
      failureMessages: ["AssertionError: expected unrelated behavior to pass"]
    }, {
      acceptanceId: trace.acceptanceId,
      testFile: trace.testFile,
      fullName: trace.fullName,
      expectedFailureFingerprint: fingerprint,
      patchText: boundPatch,
      testPatchSha256: createHash("sha256").update(boundPatch).digest("hex")
    });
    gaps.push("unrelated RED assertion was accepted");
  } catch {}
  expect(gaps, gaps.join("; ")).toEqual([]);
});

it("[AC-41][RED-PROVENANCE] accepts only exact local src module absence evidence", async () => {
  const api = await loadTraceApi();
  const trace = buildAcceptanceTraceSet().traces[6];
  const missingProductModulePath = "src/telegram/forensicPresentation";
  const failureMessage = `Cannot find module '../../src/telegram/forensicPresentation' imported from C:/frozen/${trace.testFile}`;
  const report = {
    success: false,
    numFailedTestSuites: 1,
    numFailedTests: 0,
    testResults: [{
      name: `C:/frozen/${trace.testFile}`,
      status: "failed",
      message: failureMessage,
      assertionResults: []
    }]
  };
  const evidence = api.parseLocalProductModuleAbsenceReport(report)[0];
  expect(evidence).toEqual({ testFile: trace.testFile, missingProductModulePath, failureMessage });
  const fingerprint = api.localProductModuleAbsenceFingerprint(trace.acceptanceId, evidence);
  const patchText = [
    `diff --git a/${trace.testFile} b/${trace.testFile}`,
    `--- a/${trace.testFile}`,
    `+++ b/${trace.testFile}`,
    "@@ -1,0 +1,1 @@",
    `+it("${trace.fullName}", () => expect(render()).toBeDefined());`
  ].join("\n");
  const binding = {
    acceptanceId: trace.acceptanceId,
    testFile: trace.testFile,
    fullName: trace.fullName,
    expectedFailureFingerprint: fingerprint,
    missingProductModulePath,
    patchText,
    testPatchSha256: createHash("sha256").update(patchText).digest("hex")
  };
  expect(() => api.assertExpectedLocalProductModuleAbsentRed(evidence, binding)).not.toThrow();

  const invalidReports = [
    { ...report, testResults: [{ ...report.testResults[0], message: "Cannot find package 'vitest' imported from C:/frozen/tests/release/example.test.ts" }] },
    { ...report, testResults: [{ ...report.testResults[0], message: `Cannot find module '../../../package.json' imported from C:/frozen/${trace.testFile}` }] },
    { ...report, testResults: [{ ...report.testResults[0], message: `Cannot find module '../../src/telegram/forensicPresentation' imported from C:/frozen/tests/release/foreign.test.ts` }] },
    { ...report, testResults: [{ ...report.testResults[0], message: "Error: test environment unavailable" }] },
    { ...report, testResults: [{ ...report.testResults[0], assertionResults: [{ status: "failed" }] }] }
  ];
  for (const invalid of invalidReports) {
    expect(() => api.parseLocalProductModuleAbsenceReport(invalid)).toThrow();
  }
  expect(() => api.assertExpectedLocalProductModuleAbsentRed(evidence, {
    ...binding,
    missingProductModulePath: "src/telegram/forensicPresentationAdapters"
  })).toThrow();
  expect(() => api.assertExpectedLocalProductModuleAbsentRed(evidence, {
    ...binding,
    expectedFailureFingerprint: `expected_local_product_module_absent_${trace.acceptanceId.toLowerCase()}_${"0".repeat(64)}`
  })).toThrow();
});

it("[AC-41][RED-LINEAGE] binds local module absence to test, owner, and candidate commits", async () => {
  const { validateAcceptanceTraceSet: validate } = await loadTraceApi();
  const fixture: any = cloneFixture(buildAcceptanceTraceSet());
  const target = fixture.traces[6];
  const path = "src/telegram/forensicPresentation";
  const evidence: ParsedLocalProductModuleAbsence = {
    testFile: target.testFile,
    missingProductModulePath: path,
    failureMessage: `Cannot find module '../../src/telegram/forensicPresentation' imported from C:/frozen/${target.testFile}`
  };
  target.red.kind = "local_product_module_absent";
  target.red.testCommitSha = PLAN4_FROZEN_TEST_SHA;
  target.red.redExecutionCommitSha = PLAN4_FROZEN_TEST_SHA;
  target.red.missingProductModulePath = path;
  target.red.expectedFailureFingerprint = (await loadTraceApi())
    .localProductModuleAbsenceFingerprint(target.acceptanceId, evidence);

  const dependency = (override?: (commitSha: string, productPath: string) => boolean) => ({
    isAncestor: (ancestorCommitSha: string, descendantCommitSha: string) => (
      ancestorCommitSha === PLAN4_FROZEN_TEST_SHA
        && (descendantCommitSha === target.ownerCommitSha || descendantCommitSha === fixture.candidateSha)
    ) || fixtureAncestry.isAncestor(ancestorCommitSha, descendantCommitSha),
    pathExistsAtCommit: override ?? ((commitSha: string, productPath: string) => (
      productPath === path && commitSha !== target.red.testCommitSha
    ))
  });
  expect(() => validate(fixture, dependency())).not.toThrow();
  expect(() => validate(fixture, dependency((commitSha, productPath) => (
    productPath === path && [target.red.testCommitSha, target.ownerCommitSha, fixture.candidateSha].includes(commitSha)
  )))).toThrow(/absent at the frozen test commit/);
  expect(() => validate(fixture, dependency((commitSha, productPath) => (
    productPath === path && commitSha === fixture.candidateSha
  )))).toThrow(/owner commit/);
  expect(() => validate(fixture, dependency((commitSha, productPath) => (
    productPath === path && commitSha === target.ownerCommitSha
  )))).toThrow(/candidate/);

  const foreign: any = cloneFixture(fixture);
  foreign.traces[6].red.missingProductModulePath = "node_modules/vitest";
  expect(() => validate(foreign, dependency())).toThrow(/local product module/);
  const wrongFrozenCommit: any = cloneFixture(fixture);
  wrongFrozenCommit.traces[6].red.testCommitSha = "a".repeat(40);
  expect(() => validate(wrongFrozenCommit, dependency())).toThrow(/exact frozen Plan 4 test commit/);
  const wrongLocalExecutionCommit: any = cloneFixture(fixture);
  wrongLocalExecutionCommit.traces[6].red.redExecutionCommitSha = "a".repeat(40);
  expect(() => validate(wrongLocalExecutionCommit, dependency())).toThrow(/execute at the exact frozen Plan 4 test commit/);
  const unauthorized: any = cloneFixture(fixture);
  const unauthorizedTarget = unauthorized.traces[0];
  const unauthorizedEvidence: ParsedLocalProductModuleAbsence = {
    testFile: unauthorizedTarget.testFile,
    missingProductModulePath: path,
    failureMessage: `Cannot find module '../../src/telegram/forensicPresentation' imported from C:/frozen/${unauthorizedTarget.testFile}`
  };
  unauthorizedTarget.red.kind = "local_product_module_absent";
  unauthorizedTarget.red.redExecutionCommitSha = PLAN4_FROZEN_TEST_SHA;
  unauthorizedTarget.red.missingProductModulePath = path;
  unauthorizedTarget.red.expectedFailureFingerprint = (await loadTraceApi())
    .localProductModuleAbsenceFingerprint(unauthorizedTarget.acceptanceId, unauthorizedEvidence);
  expect(() => validate(unauthorized, dependency())).toThrow(/not approved for local product module RED/);
  expect(() => validate(fixture, {
    ...dependency(),
    isAncestor: (ancestorCommitSha: string, descendantCommitSha: string) => (
      descendantCommitSha === target.ownerCommitSha && ancestorCommitSha === target.red.testCommitSha
        ? false
        : dependency().isAncestor(ancestorCommitSha, descendantCommitSha)
    )
  })).toThrow(/RED execution commit is not a verified Git ancestor/);

  const behavioralExecution: any = cloneFixture(buildAcceptanceTraceSet());
  behavioralExecution.traces[19].red.redExecutionCommitSha = "b".repeat(40);
  expect(() => validate(behavioralExecution, {
    ...fixtureAncestry,
    isAncestor: (ancestorCommitSha: string, descendantCommitSha: string) => (
      ancestorCommitSha === "a".repeat(40) && descendantCommitSha === "b".repeat(40)
        ? true
        : ancestorCommitSha === "b".repeat(40) && descendantCommitSha === behavioralExecution.traces[19].ownerCommitSha
          ? false
          : fixtureAncestry.isAncestor(ancestorCommitSha, descendantCommitSha)
    )
  })).toThrow(/RED execution commit is not a verified Git ancestor/);
});
