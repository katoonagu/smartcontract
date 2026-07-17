import { expect, it } from "vitest";
import { buildAcceptanceTraceSet, cloneFixture } from "../fixtures/release/remediationReleaseFixtures";

type TraceApi = { validateAcceptanceTraceSet(value: unknown): unknown };

async function loadTraceApi(): Promise<TraceApi> {
  const modulePath: string = "../../src/release/acceptanceTrace";
  try {
    const loaded = await import(/* @vite-ignore */ modulePath) as Partial<TraceApi>;
    if (typeof loaded.validateAcceptanceTraceSet !== "function") throw new Error("validator export missing");
    return loaded as TraceApi;
  } catch (error) {
    throw new Error("Plan 5 feature missing: typed acceptance trace validator", { cause: error });
  }
}

it("[AC-41][TRACEABILITY] requires every REQ-01 through REQ-38 and AC-01 through AC-41 exactly once", async () => {
  const { validateAcceptanceTraceSet: validate } = await loadTraceApi();
  expect(() => validate(buildAcceptanceTraceSet())).not.toThrow();
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
    expect(() => validate(trace)).toThrow();
  }
});

it("[AC-41][EXECUTION] requires every exact AC fullName to execute and pass without skip or todo", async () => {
  const { validateAcceptanceTraceSet: validate } = await loadTraceApi();
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
    expect(() => validate(trace)).toThrow();
  }
});

it("[AC-41][RED-PROVENANCE] requires owner commit expected RED and candidate GREEN evidence for every AC", async () => {
  const { validateAcceptanceTraceSet: validate } = await loadTraceApi();
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
    expect(() => validate(trace)).toThrow();
  }
});
