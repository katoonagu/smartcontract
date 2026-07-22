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

type TraceDependencies = {
  isAncestor(ownerCommitSha: string, candidateSha: string): boolean;
  pathExistsAtCommit?(commitSha: string, productModulePath: string): boolean;
};
const PLAN4_FROZEN_TEST_SHA = "20ee8a759e482c2c3037d72e561e68e289cf87b5";
const PLAN4_TEST_BASE_SHA = "d18067f6c49fd632bafa47a90f69f1e7bf8b1802";
const PLAN4_BEHAVIORAL_RED_SHA = "a0f74b3bd079d05bbfc9c35476daf9bac07e7d72";
const PLAN4_OWNER_SHA = "547d86cd6c478ca56e5b85d2ccb31cdbce2ddc17";
const PLAN4_ALERT_TEST_PATCH_SHA256 = "544fc122c2012bb27452659a795dadbbadcedc4930d54194442558d85737e2b2";
const PLAN4_RENDERER_TEST_PATCH_SHA256 = "c9a755269b1e3935bf8c6d71797e17493a57d4e55e6aa26b63c63c36494118e5";
const PLAN2_FROZEN_TEST_SHA = "01a29fefb51c245c3fe8f97f0da53929047740c7";
const PLAN2_TEST_BASE_SHA = "5f6209af82e23a065bd036c6a37eabe4888a5cfe";
const PLAN2_OWNER_SHA = "83f0cb967f61b814896e5d1a4cf01cecb1c56b59";
const PLAN2_USDD_TEST_PATCH_SHA256 = "51f0f59bacf095a8bba8620e9236064fcaec503205c2ebf295907009dbe89c93";

type ParsedLocalProductModuleAbsence = {
  testFile: string;
  fullName: string | null;
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
  assertBehavioralRedExecution(execution: ParsedExecution): void;
};

type CaptureApi = {
  redGroupForTrace(testFile: string, acceptanceId: string, secondary?: boolean): string;
  redPatchApplicationArgs(redGroupId: string): string[];
  buildRedGroupEnvironment(groupId: string, source: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
  assertPlan3FrozenRedExecutions(executions: readonly ParsedExecution[]): void;
  assertPlan3PinnedDatabaseIdentity(input: {
    containerId: string;
    containerName: string;
    imageId: string;
    systemIdentifier: string;
  }): void;
  buildCaptureRedSpec(input: {
    kind: "behavioral_assertion" | "local_product_module_absent";
    baseSha: string;
    testCommitSha: string;
    redExecutionCommitSha: string;
    testPatchSha256: string;
    testPatchFile: string;
    reportFile: string;
    missingProductModulePath?: string;
  }): Record<string, unknown>;
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
        || typeof loaded.assertExpectedBehavioralRed !== "function"
        || typeof loaded.assertBehavioralRedExecution !== "function") {
      throw new Error("validator export missing");
    }
    return loaded as TraceApi;
  } catch (error) {
    throw new Error("Plan 5 feature missing: typed acceptance trace validator", { cause: error });
  }
}

async function loadCaptureApi(): Promise<CaptureApi> {
  const modulePath: string = "../../scripts/captureRemediationTestEvidence";
  const loaded = await import(/* @vite-ignore */ modulePath) as Partial<CaptureApi>;
  if (typeof loaded.redGroupForTrace !== "function"
      || typeof loaded.redPatchApplicationArgs !== "function"
      || typeof loaded.buildRedGroupEnvironment !== "function"
      || typeof loaded.assertPlan3FrozenRedExecutions !== "function"
      || typeof loaded.assertPlan3PinnedDatabaseIdentity !== "function"
      || typeof loaded.buildCaptureRedSpec !== "function") {
    throw new Error("Plan 5 feature missing: trace producer RED routing");
  }
  return loaded as CaptureApi;
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
      (trace.red.testCommitSha === ancestorCommitSha
        && trace.red.redExecutionCommitSha === descendantCommitSha)
      || (trace.red.redExecutionCommitSha === ancestorCommitSha
        && trace.ownerCommitSha === descendantCommitSha)
    ));
  },
  pathExistsAtCommit: (commitSha, productModulePath) => {
    const fixture = buildAcceptanceTraceSet();
    return fixture.traces.some((trace) => trace.red.kind === "local_product_module_absent"
      && trace.red.missingProductModulePath === productModulePath
      && (commitSha === trace.ownerCommitSha || commitSha === fixture.candidateSha));
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

it("[AC-41][RED-PROVENANCE] rejects database and transport failures as behavioral RED", async () => {
  const api = await loadTraceApi();
  const execution: ParsedExecution = {
    testFile: "tests/runtime/waitReconciliation.acceptance.test.ts",
    fullName: "[AC-14] reconciles and claims an all-ready parent exactly once",
    status: "failed",
    failureMessages: ["error: password authentication failed for user tron"]
  };
  expect(() => api.assertBehavioralRedExecution(execution)).toThrow(/infrastructure|environment/i);
  expect(() => api.assertBehavioralRedExecution({
    ...execution,
    failureMessages: ["AssertionError: expected resume_ready to be unchanged"]
  })).not.toThrow();
  for (const message of [
    "getaddrinfo ENOTFOUND disposable-db",
    "connect EHOSTUNREACH 172.17.0.3:5432",
    "error: permission denied for schema plan3_wait_probe"
  ]) {
    expect(() => api.assertBehavioralRedExecution({ ...execution, failureMessages: [message] }))
      .toThrow(/infrastructure|environment/i);
  }
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
  expect(evidence).toEqual({ testFile: trace.testFile, fullName: null, missingProductModulePath, failureMessage });
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

it("[AC-41][RED-PLAN2] accepts only assertion-bound absence of the exact local src product module", async () => {
  const api = await loadTraceApi();
  const trace = buildAcceptanceTraceSet().traces[2];
  const missingProductModulePath = "src/risk/usddPsmExposure";
  const failureMessage = `Cannot find module '/src/risk/usddPsmExposure' imported from C:/frozen/${trace.testFile}`;
  const assertion = {
    ancestorTitles: ["USDD PSM remediation acceptance contract"],
    fullName: `USDD PSM remediation acceptance contract ${trace.fullName}`,
    title: trace.fullName,
    status: "failed",
    failureMessages: [failureMessage]
  };
  const report = {
    success: false,
    numFailedTestSuites: 1,
    numFailedTests: 1,
    testResults: [{
      name: `C:/frozen/${trace.testFile}`,
      status: "failed",
      message: "",
      assertionResults: [assertion]
    }]
  };
  const evidence = api.parseLocalProductModuleAbsenceReport(report)[0];
  expect(evidence).toEqual({
    testFile: trace.testFile,
    fullName: trace.fullName,
    missingProductModulePath,
    failureMessage
  });
  const patchText = [
    `diff --git a/${trace.testFile} b/${trace.testFile}`,
    `--- a/${trace.testFile}`,
    `+++ b/${trace.testFile}`,
    "@@ -1,0 +1,1 @@",
    `+it("${trace.fullName}", () => expect(score()).toBe(55));`
  ].join("\n");
  const binding = {
    acceptanceId: trace.acceptanceId,
    testFile: trace.testFile,
    fullName: trace.fullName,
    expectedFailureFingerprint: api.localProductModuleAbsenceFingerprint(trace.acceptanceId, evidence),
    missingProductModulePath,
    patchText,
    testPatchSha256: createHash("sha256").update(patchText).digest("hex")
  };
  expect(() => api.assertExpectedLocalProductModuleAbsentRed(evidence, binding)).not.toThrow();
  expect(() => api.assertExpectedLocalProductModuleAbsentRed(evidence, {
    ...binding,
    fullName: "[AC-03] unrelated assertion"
  })).toThrow(/fullName/);
  const mixedBehavioralMessages = {
    ...report,
    testResults: [{
      ...report.testResults[0],
      assertionResults: [{
        ...assertion,
        failureMessages: [
          "AssertionError: expected provider calls to be zero",
          failureMessage,
          "AssertionError: expected deterministic result"
        ]
      }]
    }]
  };
  expect(api.parseLocalProductModuleAbsenceReport(mixedBehavioralMessages)).toEqual([evidence]);

  const invalidReports = [
    { ...report, testResults: [{ ...report.testResults[0], assertionResults: [{ ...assertion, failureMessages: ["Cannot find package 'vitest' imported from C:/frozen/tests/release/example.test.ts"] }] }] },
    { ...report, testResults: [{ ...report.testResults[0], assertionResults: [{ ...assertion, failureMessages: [`Cannot find module '/package.json' imported from C:/frozen/${trace.testFile}`] }] }] },
    { ...report, testResults: [{ ...report.testResults[0], assertionResults: [{ ...assertion, failureMessages: [`Cannot find module '/src/risk/usddPsmExposure' imported from C:/frozen/tests/release/foreign.test.ts`] }] }] },
    { ...report, testResults: [{ ...report.testResults[0], assertionResults: [{ ...assertion, failureMessages: [failureMessage, failureMessage] }] }] },
    { ...report, testResults: [{ ...report.testResults[0], assertionResults: [{ ...assertion, fullName: trace.fullName }] }] }
  ];
  for (const invalid of invalidReports) {
    expect(() => api.parseLocalProductModuleAbsenceReport(invalid)).toThrow();
  }
});

it("[AC-41][RED-PLAN2-LINEAGE] pins all 17 assertion-bound absences to their exact frozen lineage", async () => {
  const { validateAcceptanceTraceSet: validate } = await loadTraceApi();
  const fixture: any = cloneFixture(buildAcceptanceTraceSet());
  const localPlan2 = fixture.traces.filter((trace: any) => (
    trace.ownerPlan === 2 && trace.red.kind === "local_product_module_absent"
  ));
  expect(localPlan2.map((trace: any) => trace.acceptanceId)).toEqual([
    "AC-03", "AC-04", "AC-05", "AC-06", "AC-19", "AC-22", "AC-23", "AC-25", "AC-26", "AC-28",
    "AC-29", "AC-30", "AC-31", "AC-32", "AC-33", "AC-36", "AC-37"
  ]);
  expect(() => validate(fixture, fixtureAncestry)).not.toThrow();
  const target = fixture.traces[2];
  expect(target).toMatchObject({
    acceptanceId: "AC-03",
    ownerCommitSha: PLAN2_OWNER_SHA,
    testFile: "tests/risk/collectorUsddRemediation.acceptance.test.ts",
    fullName: "[AC-03] scores 2 percent outbound USDD PSM with direction adjustment",
    primary: true,
    red: {
      kind: "local_product_module_absent",
      baseSha: PLAN2_TEST_BASE_SHA,
      testCommitSha: PLAN2_FROZEN_TEST_SHA,
      redExecutionCommitSha: PLAN2_FROZEN_TEST_SHA,
      testPatchSha256: PLAN2_USDD_TEST_PATCH_SHA256,
      missingProductModulePath: "src/risk/usddPsmExposure"
    }
  });
  const mutations = [
    (trace: any) => { trace.traces[2].fullName = "[AC-03] foreign assertion"; },
    (trace: any) => { trace.traces[2].primary = false; },
    (trace: any) => { trace.traces[2].red.baseSha = "b".repeat(40); },
    (trace: any) => { trace.traces[2].red.testCommitSha = "a".repeat(40); },
    (trace: any) => { trace.traces[2].red.redExecutionCommitSha = "a".repeat(40); },
    (trace: any) => { trace.traces[2].red.testPatchSha256 = "0".repeat(64); },
    (trace: any) => { trace.traces[2].red.missingProductModulePath = "src/risk/foreignModule"; },
    (trace: any) => {
      trace.traces[2].red.kind = "behavioral_assertion";
      trace.traces[2].red.expectedFailureFingerprint = "expected_behavioral_assertion_ac-03";
      delete trace.traces[2].red.missingProductModulePath;
    }
  ];
  for (const mutate of mutations) {
    const invalid: any = cloneFixture(fixture);
    mutate(invalid);
    expect(() => validate(invalid, fixtureAncestry)).toThrow();
  }
});

it("[AC-41][RED-LINEAGE] binds local module absence to test, owner, and candidate commits", async () => {
  const { validateAcceptanceTraceSet: validate } = await loadTraceApi();
  const fixture: any = cloneFixture(buildAcceptanceTraceSet());
  const target = fixture.traces[6];
  const path = "src/telegram/forensicPresentation";
  const evidence: ParsedLocalProductModuleAbsence = {
    testFile: target.testFile,
    fullName: null,
    missingProductModulePath: path,
    failureMessage: `Cannot find module '../../src/telegram/forensicPresentation' imported from C:/frozen/${target.testFile}`
  };
  target.red.kind = "local_product_module_absent";
  target.red.baseSha = PLAN4_TEST_BASE_SHA;
  target.red.testCommitSha = PLAN4_FROZEN_TEST_SHA;
  target.red.redExecutionCommitSha = PLAN4_FROZEN_TEST_SHA;
  target.red.testPatchSha256 = PLAN4_RENDERER_TEST_PATCH_SHA256;
  target.red.missingProductModulePath = path;
  target.red.expectedFailureFingerprint = (await loadTraceApi())
    .localProductModuleAbsenceFingerprint(target.acceptanceId, evidence);

  const dependency = (override?: (commitSha: string, productPath: string) => boolean) => ({
    isAncestor: (ancestorCommitSha: string, descendantCommitSha: string) => (
      ancestorCommitSha === PLAN4_FROZEN_TEST_SHA
        && (descendantCommitSha === target.ownerCommitSha || descendantCommitSha === fixture.candidateSha)
    ) || fixtureAncestry.isAncestor(ancestorCommitSha, descendantCommitSha),
    pathExistsAtCommit: (commitSha: string, productPath: string) => (
      override && productPath === path
        ? override(commitSha, productPath)
        : fixtureAncestry.pathExistsAtCommit!(commitSha, productPath)
    )
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
  expect(() => validate(wrongFrozenCommit, dependency())).toThrow(/exact approved frozen test commit/);
  const wrongLocalExecutionCommit: any = cloneFixture(fixture);
  wrongLocalExecutionCommit.traces[6].red.redExecutionCommitSha = "a".repeat(40);
  expect(() => validate(wrongLocalExecutionCommit, dependency())).toThrow(/execute at its exact approved frozen test commit/);
  const wrongLocalBase: any = cloneFixture(fixture);
  wrongLocalBase.traces[6].red.baseSha = "b".repeat(40);
  expect(() => validate(wrongLocalBase, dependency())).toThrow(/exact approved RED lineage/);
  const wrongLocalPatch: any = cloneFixture(fixture);
  wrongLocalPatch.traces[6].red.testPatchSha256 = "0".repeat(64);
  expect(() => validate(wrongLocalPatch, dependency())).toThrow(/exact approved RED lineage/);
  const behavioralSubstitution: any = cloneFixture(fixture);
  behavioralSubstitution.traces[6].red.kind = "behavioral_assertion";
  behavioralSubstitution.traces[6].red.expectedFailureFingerprint = "expected_behavioral_assertion_ac-07";
  delete behavioralSubstitution.traces[6].red.missingProductModulePath;
  expect(() => validate(behavioralSubstitution, dependency())).toThrow(/exact approved RED lineage/);
  expect(target.ownerCommitSha).toBe(PLAN4_OWNER_SHA);
  const ownerSubstitution: any = cloneFixture(fixture);
  const forgedOwner = "e".repeat(40);
  ownerSubstitution.traces[6].ownerCommitSha = forgedOwner;
  ownerSubstitution.ancestorCommitShas.push(forgedOwner);
  expect(() => validate(ownerSubstitution, {
    isAncestor: (ancestorCommitSha: string, descendantCommitSha: string) => (
      (ancestorCommitSha === forgedOwner && descendantCommitSha === fixture.candidateSha)
      || (ancestorCommitSha === PLAN4_FROZEN_TEST_SHA && descendantCommitSha === forgedOwner)
      || dependency().isAncestor(ancestorCommitSha, descendantCommitSha)
    ),
    pathExistsAtCommit: (commitSha: string, productPath: string) => productPath === path
      ? commitSha !== PLAN4_FROZEN_TEST_SHA
      : fixtureAncestry.pathExistsAtCommit!(commitSha, productPath)
  })).toThrow(/exact approved RED lineage/);
  const unauthorized: any = cloneFixture(fixture);
  const unauthorizedTarget = unauthorized.traces[0];
  const unauthorizedEvidence: ParsedLocalProductModuleAbsence = {
    testFile: unauthorizedTarget.testFile,
    fullName: null,
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

  for (const acceptanceNumber of [20, 21, 24]) {
    const behavioral: any = cloneFixture(buildAcceptanceTraceSet());
    const behavioralTarget = behavioral.traces[acceptanceNumber - 1];
    behavioralTarget.red.baseSha = PLAN4_TEST_BASE_SHA;
    behavioralTarget.red.testCommitSha = PLAN4_FROZEN_TEST_SHA;
    behavioralTarget.red.redExecutionCommitSha = PLAN4_BEHAVIORAL_RED_SHA;
    behavioralTarget.red.testPatchSha256 = PLAN4_ALERT_TEST_PATCH_SHA256;
    const behavioralDependency = {
      pathExistsAtCommit: fixtureAncestry.pathExistsAtCommit,
      isAncestor: (ancestorCommitSha: string, descendantCommitSha: string) => (
        ancestorCommitSha === PLAN4_FROZEN_TEST_SHA && descendantCommitSha === PLAN4_BEHAVIORAL_RED_SHA
      ) || (
        ancestorCommitSha === PLAN4_BEHAVIORAL_RED_SHA && descendantCommitSha === behavioralTarget.ownerCommitSha
      ) || fixtureAncestry.isAncestor(ancestorCommitSha, descendantCommitSha)
    };
    expect(() => validate(behavioral, behavioralDependency)).not.toThrow();
    const wrongBehavioralExecution: any = cloneFixture(behavioral);
    wrongBehavioralExecution.traces[acceptanceNumber - 1].red.redExecutionCommitSha = "b".repeat(40);
    expect(() => validate(wrongBehavioralExecution, behavioralDependency)).toThrow(/exact approved RED lineage/);
    const wrongBehavioralPatch: any = cloneFixture(behavioral);
    wrongBehavioralPatch.traces[acceptanceNumber - 1].red.testPatchSha256 = "0".repeat(64);
    expect(() => validate(wrongBehavioralPatch, behavioralDependency)).toThrow(/exact approved RED lineage/);
  }
});

it("[AC-41][RED-PRODUCER] routes behavioral Plan 4 RED separately and emits complete local capture records", async () => {
  const api = await loadCaptureApi();
  const alerts = "tests/alerts/unifiedTelegramAlerts.acceptance.test.ts";
  for (const acceptanceId of ["AC-20", "AC-21", "AC-24"]) {
    expect(api.redGroupForTrace(alerts, acceptanceId)).toBe("plan4-alert-behavioral");
  }
  for (const acceptanceId of ["AC-27", "AC-39"]) {
    expect(api.redGroupForTrace(alerts, acceptanceId)).toBe("plan4");
  }
  expect(api.redPatchApplicationArgs("plan1-renamed")).toEqual(["-C0"]);
  for (const redGroupId of [
    "plan1", "plan2", "plan3", "plan4", "plan4-alert-behavioral", "plan5", "plan2-llm-dampening"
  ]) {
    expect(api.redPatchApplicationArgs(redGroupId)).toEqual([]);
  }
  const plan3DatabaseUrl = "postgresql://release:redacted@127.0.0.1:56001/tron_watch_plan3";
  const plan3Environment = api.buildRedGroupEnvironment("plan3", {
    PLAN3_TEST_DATABASE_URL: plan3DatabaseUrl
  });
  expect(plan3Environment.PLAN3_TEST_DATABASE_URL).toBe(plan3DatabaseUrl);
  expect(plan3Environment.TEST_DATABASE_URL).toBe("postgresql://tron:tron@127.0.0.1:55432/tron_watch_plan3");
  expect(plan3Environment.REQUIRE_PLAN3_POSTGRES).toBe("1");
  expect(() => api.buildRedGroupEnvironment("plan3", {})).toThrow(/PLAN3_TEST_DATABASE_URL/);
  expect(() => api.buildRedGroupEnvironment("plan3", {
    PLAN3_TEST_DATABASE_URL: "postgresql://release:redacted@db.example:56001/tron_watch_plan3"
  })).toThrow(/exact disposable/i);
  expect(() => api.buildRedGroupEnvironment("plan3", {
    PLAN3_TEST_DATABASE_URL: "postgresql://release:redacted@127.0.0.1:56001/tron_watch"
  })).toThrow(/exact disposable/i);
  const plan3Execution = {
    testFile: "tests/runtime/waitReconciliation.acceptance.test.ts",
    fullName: "[AC-14] reconciles and claims an all-ready parent exactly once",
    status: "failed" as const,
    failureMessages: [
      "Error: Plan 3 feature missing: reconcileWaitingForensicCheckJobs\n"
      + "    at loadPlan3WaitRepository (/work/tests/runtime/waitReconciliation.acceptance.test.ts:46:11)"
    ]
  };
  expect(() => api.assertPlan3FrozenRedExecutions([
    plan3Execution,
    {
      ...plan3Execution,
      fullName: "[AC-15] resumes mixed ready-terminal waits through technical path"
    }
  ])).not.toThrow();
  expect(() => api.assertPlan3FrozenRedExecutions([
    plan3Execution,
    {
      ...plan3Execution,
      fullName: "[AC-15] resumes mixed ready-terminal waits through technical path",
      failureMessages: ["connect ECONNREFUSED 172.17.0.3:5432"]
    }
  ])).toThrow(/infrastructure|environment/i);
  expect(() => api.assertPlan3FrozenRedExecutions([
    { ...plan3Execution, failureMessages: ["AssertionError: expected 1 to be 2"] },
    {
      ...plan3Execution,
      fullName: "[AC-15] resumes mixed ready-terminal waits through technical path"
    }
  ])).toThrow(/exact frozen behavioral failure/i);
  for (const message of [
    "getaddrinfo ENOTFOUND disposable-db",
    "connect EHOSTUNREACH 172.17.0.3:5432",
    "error: permission denied for schema plan3_wait_probe"
  ]) {
    expect(() => api.assertPlan3FrozenRedExecutions([
      plan3Execution,
      {
        testFile: "tests/runtime/checkCallbacks.acceptance.test.ts",
        fullName: "[REQ-37][CALLBACK-ACK] acknowledges non-poison callbacks before database work",
        status: "failed",
        failureMessages: [message]
      },
      {
        ...plan3Execution,
        fullName: "[AC-15] resumes mixed ready-terminal waits through technical path"
      }
    ])).toThrow(/infrastructure|environment|unclassified/i);
  }
  const pinnedDatabase = {
    containerId: "fbb25bec0cfa79a35efddb287f3ae9ba1921fb645558b0b48dfce8b45d60d39e",
    containerName: "/plan5-release-pg-f97549bc",
    imageId: "sha256:4e6e670bb069649261c9c18031f0aded7bb249a5b6664ddec29c013a89310d50",
    systemIdentifier: "7664744009044738089"
  };
  expect(() => api.assertPlan3PinnedDatabaseIdentity(pinnedDatabase)).not.toThrow();
  for (const replacement of [
    { ...pinnedDatabase, containerId: "0".repeat(64) },
    { ...pinnedDatabase, containerName: "/replacement-plan3-postgres" },
    { ...pinnedDatabase, systemIdentifier: "7664744009044738090" }
  ]) {
    expect(() => api.assertPlan3PinnedDatabaseIdentity(replacement)).toThrow(/exact pinned disposable database/i);
  }
  const local = api.buildCaptureRedSpec({
    kind: "local_product_module_absent",
    baseSha: PLAN4_TEST_BASE_SHA,
    testCommitSha: PLAN4_FROZEN_TEST_SHA,
    redExecutionCommitSha: PLAN4_FROZEN_TEST_SHA,
    testPatchSha256: PLAN4_RENDERER_TEST_PATCH_SHA256,
    testPatchFile: "trace/patches/ac-07.patch",
    reportFile: "trace/red/plan4.vitest.json",
    missingProductModulePath: "src/telegram/forensicPresentation"
  });
  expect(local).toEqual({
    kind: "local_product_module_absent",
    baseSha: PLAN4_TEST_BASE_SHA,
    testCommitSha: PLAN4_FROZEN_TEST_SHA,
    redExecutionCommitSha: PLAN4_FROZEN_TEST_SHA,
    testPatchSha256: PLAN4_RENDERER_TEST_PATCH_SHA256,
    testPatchFile: "trace/patches/ac-07.patch",
    reportFile: "trace/red/plan4.vitest.json",
    missingProductModulePath: "src/telegram/forensicPresentation"
  });
});
