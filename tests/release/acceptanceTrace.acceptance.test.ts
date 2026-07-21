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

type TraceApi = {
  validateAcceptanceTraceSet(value: unknown, dependencies: TraceDependencies): unknown;
  parseVitestJsonReport(value: unknown): Array<{ status: string }>;
  parseJUnitReport(value: string): Array<{ status: string }>;
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
        || typeof loaded.assertExpectedBehavioralRed !== "function") {
      throw new Error("validator export missing");
    }
    return loaded as TraceApi;
  } catch (error) {
    throw new Error("Plan 5 feature missing: typed acceptance trace validator", { cause: error });
  }
}

const fixtureAncestry: TraceDependencies = {
  isAncestor: (ownerCommitSha, candidateSha) => {
    const fixture = buildAcceptanceTraceSet();
    return candidateSha === fixture.candidateSha && fixture.ancestorCommitShas.includes(ownerCommitSha);
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
    (trace: any) => { trace.traces[0].red.baseSha = "bad"; },
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
