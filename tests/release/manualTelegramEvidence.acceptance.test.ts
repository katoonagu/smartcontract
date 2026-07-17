import { expect, it } from "vitest";
import {
  CANDIDATE_SHA,
  MANUAL_GOLDEN_IDS,
  RUNTIME_LABEL,
  buildManualTelegramAcceptance,
  cloneFixture
} from "../fixtures/release/remediationReleaseFixtures";

type ManualApi = {
  validateManualTelegramAcceptance(value: unknown, expected: { candidateSha: string; runtimeLabel: string; goldenIds: readonly string[] }): unknown;
};

it("[REQ-32][PLAN5-MANUAL] requires 19 message records 15 scenario summaries and 11 golden comparisons", async () => {
  const modulePath: string = "../../scripts/finalizeTelegramAcceptance";
  let api: ManualApi;
  try {
    const loaded = await import(/* @vite-ignore */ modulePath) as Partial<ManualApi>;
    if (typeof loaded.validateManualTelegramAcceptance !== "function") throw new Error("validator export missing");
    api = loaded as ManualApi;
  } catch (error) {
    throw new Error("Plan 5 feature missing: manual Telegram release evidence validator", { cause: error });
  }
  const expected = { candidateSha: CANDIDATE_SHA, runtimeLabel: RUNTIME_LABEL, goldenIds: MANUAL_GOLDEN_IDS };
  const valid = buildManualTelegramAcceptance();
  expect(valid.messageRecords).toHaveLength(19);
  expect(valid.scenarioSummaries).toHaveLength(15);
  expect(new Set(valid.scenarioSummaries.flatMap((item) => item.goldenIds)).size).toBe(11);
  expect(() => api.validateManualTelegramAcceptance(valid, expected)).not.toThrow();

  const invalid = [
    (value: any) => { value.messageRecords.pop(); },
    (value: any) => { value.messageRecords.push(cloneFixture(value.messageRecords[0])); },
    (value: any) => { value.scenarioSummaries.pop(); },
    (value: any) => { value.scenarioSummaries[10].goldenIds = []; },
    (value: any) => { value.scenarioSummaries[11].goldenIds = ["EXTRA_GOLDEN"]; },
    (value: any) => { value.messageRecords[0].candidateSha = "f".repeat(40); },
    (value: any) => { value.messageRecords[0].runtimeLabel = "foreign-runtime"; },
    (value: any) => { value.messageRecords[0].jobId = ""; },
    (value: any) => { value.messageRecords[0].telegramMessageId = 0; },
    (value: any) => { value.messageRecords[0].payloadSha256 = "changed"; },
    (value: any) => { value.messageRecords[0].screenshotFilename = ""; },
    (value: any) => { value.messageRecords[0].screenshotSha256 = "changed"; },
    (value: any) => { value.messageRecords[0].result = "fail"; },
    (value: any) => { value.scenarioSummaries[0].reviewer = ""; },
    (value: any) => { value.scenarioSummaries[0].reviewedAt = "pending"; },
    (value: any) => { value.scenarioSummaries[0].result = "fail"; },
    (value: any) => { value.scenarioSummaries[0].audit = { token: "123456789:AAExampleTokenValue" }; }
  ];
  for (const mutate of invalid) {
    const value: any = cloneFixture(valid);
    mutate(value);
    expect(() => api.validateManualTelegramAcceptance(value, expected)).toThrow();
  }
});
