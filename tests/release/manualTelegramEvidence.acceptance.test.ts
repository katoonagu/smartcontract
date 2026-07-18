import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { expect, it } from "vitest";
import { remediationTelegramUxCase } from "../fixtures/telegram/remediationTelegramUxCases";
import {
  CANDIDATE_SHA,
  COMMAND_TEMPLATE_SHA256,
  MANUAL_GOLDEN_IDS,
  RUNTIME_LABEL,
  buildManualTelegramAcceptance,
  buildTask0BReleaseFreezeEvidence,
  cloneFixture
} from "../fixtures/release/remediationReleaseFixtures";

type ManualApi = {
  validateManualTelegramAcceptance(value: unknown, expected: { candidateSha: string; runtimeLabel: string; goldenIds: readonly string[] }): unknown;
  buildManualTelegramCandidateDraft(input: { candidateSha: string; runtimeLabel: string }): Promise<any>;
  bindManualTelegramCandidateRun(draft: unknown, jobs: Array<{ fixtureId: string; jobId: string; createdAt: string }>): unknown;
  persistManualTelegramCandidateRun(run: unknown, input: { artifactRoot: string; candidateSha: string; runtimeLabel: string }): Promise<void>;
  finalizeManualTelegramAcceptance(value: unknown, expected: {
    candidateSha: string;
    runtimeLabel: string;
    goldenIds: readonly string[];
    candidateRun: unknown;
    artifactRoot: string;
  }): Promise<unknown>;
  seedManualTelegramCandidateJobs(db: any, draft: unknown, input: {
    task0bEvidence: unknown;
    candidateStartEvidence: unknown;
    evaluatedAt: string;
    databaseUrl: string;
  }): Promise<any>;
  verifyManualTelegramCandidateJobs(db: any, run: unknown, input: {
    task0bEvidence: unknown;
    candidateStartEvidence: unknown;
    evaluatedAt: string;
    databaseUrl: string;
  }): Promise<void>;
  sendManualTelegramCandidateRunOnce(run: unknown, input: {
    artifactRoot: string;
    allowSend: string;
    botToken: string;
    testChatId: string;
    productionBotToken: string;
    productionChatIds: string[];
    sendMessage(input: unknown): Promise<{ messageId: number }>;
  }): Promise<Array<{ telegramMessageId: number }>>;
  runManualTelegramCommand(
    args: readonly string[],
    env: Record<string, string | undefined>,
    operations?: {
      prepare(root: string): Promise<void>;
      send(root: string): Promise<void>;
      finalize(root: string): Promise<void>;
    }
  ): Promise<"prepare" | "send" | "finalize">;
  renderManualContractFixtureForRelease(source: unknown, dependencies?: {
    buildEvidence(input: unknown): unknown[];
    resolveDecision(input: unknown): null;
  }): string;
};

async function loadApi(): Promise<ManualApi> {
  const loaded = await import("../../scripts/finalizeTelegramAcceptance") as Partial<ManualApi>;
  for (const name of [
    "validateManualTelegramAcceptance",
    "buildManualTelegramCandidateDraft",
    "bindManualTelegramCandidateRun",
    "persistManualTelegramCandidateRun",
    "finalizeManualTelegramAcceptance",
    "seedManualTelegramCandidateJobs",
    "verifyManualTelegramCandidateJobs",
    "sendManualTelegramCandidateRunOnce",
    "runManualTelegramCommand",
    "renderManualContractFixtureForRelease"
  ] as const) if (typeof loaded[name] !== "function") throw new Error(`${name} export missing`);
  return loaded as ManualApi;
}

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

function hash(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function task0bEvidence(evaluatedAt: string, databaseFingerprintSha256 = "e".repeat(64)) {
  const evaluatedAtMs = Date.parse(evaluatedAt);
  const observedAt = new Date(evaluatedAtMs - 60_000).toISOString();
  return buildTask0BReleaseFreezeEvidence({ observedAt, databaseFingerprintSha256 });
}

function candidateStartEvidence() {
  return {
    version: "runtime-start-command-evidence-v1",
    runtimeSha: CANDIDATE_SHA,
    runtimeLabel: RUNTIME_LABEL,
    commandId: "runtime_sanitized_rehearsal",
    redactedTemplateSha256: COMMAND_TEMPLATE_SHA256.runtime_sanitized_rehearsal,
    exitCode: 0
  };
}

const MINIMAL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

async function strictEvidence(api: ManualApi, suppliedRun?: any) {
  const draft = await api.buildManualTelegramCandidateDraft({ candidateSha: CANDIDATE_SHA, runtimeLabel: RUNTIME_LABEL });
  const candidateRun: any = suppliedRun ?? api.bindManualTelegramCandidateRun(draft, draft.messages.map((message: any, index: number) => ({
    fixtureId: message.fixtureId,
    jobId: `synthetic-job-${String(index + 1).padStart(2, "0")}`,
    createdAt: "2026-07-18T12:00:00.000Z"
  })));
  const artifactRoot = await mkdtemp(join(tmpdir(), "plan5-telegram-evidence-"));
  const messageRecords: any[] = [];
  for (const [index, message] of candidateRun.messages.entries()) {
    const screenshot = MINIMAL_PNG;
    const storedFilename = `${message.id}.png`;
    await writeFile(join(artifactRoot, storedFilename), screenshot);
    messageRecords.push({
      id: `message-${String(index + 1).padStart(2, "0")}`,
      scenarioId: message.artifactId,
      candidateSha: CANDIDATE_SHA,
      runtimeLabel: RUNTIME_LABEL,
      checkedWallet: message.checkedWallet,
      jobId: message.jobId,
      telegramMessageId: 1001 + index,
      payloadSha256: message.payloadSha256,
      screenshotFilename: storedFilename,
      screenshotSha256: hash(screenshot),
      requirementIds: message.requirementIds,
      result: "pass"
    });
  }
  const scenarioSummaries = candidateRun.scenarios.map((scenario: any, index: number) => ({
    scenarioId: scenario.artifactId,
    candidateSha: CANDIDATE_SHA,
    runtimeLabel: RUNTIME_LABEL,
    messageRecordIds: messageRecords.filter((record) => record.scenarioId === scenario.artifactId).map((record) => record.id),
    fixtureIds: scenario.fixtureIds,
    goldenIds: scenario.goldenIds,
    requirementIds: scenario.requirementIds,
    reviewer: "release-reviewer",
    reviewedAt: `2026-07-18T12:${String(index).padStart(2, "0")}:00.000Z`,
    result: "pass"
  }));
  return { draft, candidateRun, artifactRoot, evidence: {
    version: "manual-telegram-acceptance-v1",
    candidateSha: CANDIDATE_SHA,
    messageRecords,
    scenarioSummaries
  } };
}

it("[REQ-32][PLAN5-MANUAL-BINDING] binds the exact 15 artifacts 19 production-path payloads and 11 goldens", async () => {
  const api = await loadApi();
  const built = await strictEvidence(api);
  try {
    expect(built.candidateRun.scenarios).toHaveLength(15);
    expect(built.candidateRun.messages).toHaveLength(19);
    expect(built.candidateRun.goldenComparisons).toBe(11);
    expect(new Set(built.draft.messages.map((message: any) => message.productionPath))).toEqual(new Set([
      "where", "deep", "incoming", "approval", "contract", "technical"
    ]));
    const rendered = new Map<string, any>(built.candidateRun.messages.map((message: any) => [message.fixtureId, message]));
    expect(rendered.get("THJ_COLLECTOR_ONLY").payload.text).toMatch(/35\/100[\s\S]*Доступно 18[\s\S]*относятся 18/);
    expect(rendered.get("THJ_COLLECTOR_INDEPENDENT_SIGNAL").payload.text).toMatch(/55\/100[\s\S]*Доступно 18[\s\S]*относятся 18/);
    expect(rendered.get("TKG_LOW_BALANCE_LATEST_FIVE").payload.text).toMatch(/35\/100[\s\S]*305 USDT[\s\S]*Доступно 5[\s\S]*относятся 5/);
    expect(rendered.get("PSM_TWO_PERCENT_OUTBOUND").payload.text).toMatch(/22\/100[\s\S]*2%/);
    expect(rendered.get("OFFICIAL_USDT_CONTRACT").payload.text).toMatch(/0\/100[\s\S]*реестр/);
    const thjSource = remediationTelegramUxCase("THJ_COLLECTOR_ONLY").source;
    const thjFact = thjSource.narrativeFactsV2[0]!;
    expect(thjSource.coverageV2?.selectedAmountRaw).toBe("421930000000");
    const thjTotal = BigInt(thjSource.coverageV2!.selectedAmountRaw!);
    expect((BigInt(thjFact.amountRaw!) * 10_000n + thjTotal / 2n) / thjTotal).toBe(6_700n);
    expect(thjFact.share).toBe(0.67);
    const psmSource = remediationTelegramUxCase("PSM_TWO_PERCENT_OUTBOUND").source;
    const psmFact = psmSource.narrativeFactsV2[0]!;
    expect(BigInt(psmFact.amountRaw!) * 100n / BigInt(psmSource.coverageV2!.selectedAmountRaw!)).toBe(2n);
    const officialSource = remediationTelegramUxCase("OFFICIAL_USDT_CONTRACT").source;
    expect(officialSource.contractDecision?.deterministic.evidenceIds).not.toContain("registry:official-tron-usdt");
    expect(() => api.renderManualContractFixtureForRelease(officialSource, {
      buildEvidence: () => [],
      resolveDecision: () => null
    })).toThrow(/canonical evidence missing/);
    const incoming = rendered.get("INCOMING_RETRY_INVALID_LEGACY_COVERAGE");
    expect(incoming.payload.text).toContain("Проверка входящего перевода");
    expect(JSON.stringify(incoming.payload.replyMarkup)).toContain(incoming.jobId);
    const invalid = rendered.get("INVALID_ADDRESS_AND_ANCHOR").payload.text;
    expect(invalid).toContain("Общее число доступных переводов в этом результате не сохранено");
    expect(invalid).not.toMatch(/100%|Доступно 10/);
    await expect(api.finalizeManualTelegramAcceptance(built.evidence, {
      candidateSha: CANDIDATE_SHA,
      runtimeLabel: RUNTIME_LABEL,
      goldenIds: MANUAL_GOLDEN_IDS,
      candidateRun: built.candidateRun,
      artifactRoot: built.artifactRoot
    })).rejects.toThrow();
    let sent = 0;
    await api.sendManualTelegramCandidateRunOnce(built.candidateRun, {
      artifactRoot: built.artifactRoot,
      allowSend: "1",
      botToken: "123456:AAPlan5DedicatedTestToken",
      testChatId: "-100111",
      productionBotToken: "654321:AAProductionReferenceToken",
      productionChatIds: ["-100999"],
      async sendMessage() { sent += 1; return { messageId: 1000 + sent }; }
    });
    expect(sent).toBe(19);
    await expect(api.finalizeManualTelegramAcceptance(built.evidence, {
      candidateSha: CANDIDATE_SHA,
      runtimeLabel: RUNTIME_LABEL,
      goldenIds: MANUAL_GOLDEN_IDS,
      candidateRun: built.candidateRun,
      artifactRoot: built.artifactRoot
    })).resolves.toMatchObject({ candidateSha: CANDIDATE_SHA });
    await writeFile(join(built.artifactRoot, "manual-telegram-acceptance.json"), `${JSON.stringify(built.evidence)}\n`);
    await api.persistManualTelegramCandidateRun(built.candidateRun, {
      artifactRoot: built.artifactRoot,
      candidateSha: CANDIDATE_SHA,
      runtimeLabel: RUNTIME_LABEL
    });
    await expect(api.persistManualTelegramCandidateRun(built.candidateRun, {
      artifactRoot: built.artifactRoot,
      candidateSha: CANDIDATE_SHA,
      runtimeLabel: RUNTIME_LABEL
    })).rejects.toThrow();

    for (const mutate of [
      (value: any) => { value.messageRecords[0].jobId = "foreign-job"; },
      (value: any) => { value.messageRecords[0].payloadSha256 = "f".repeat(64); },
      (value: any) => { value.messageRecords[1].telegramMessageId = value.messageRecords[0].telegramMessageId; },
      (value: any) => { value.scenarioSummaries[0].fixtureIds = ["foreign-fixture"]; },
      (value: any) => { value.scenarioSummaries[0].goldenIds = []; }
    ]) {
      const changed: any = cloneFixture(built.evidence);
      mutate(changed);
      await expect(api.finalizeManualTelegramAcceptance(changed, {
        candidateSha: CANDIDATE_SHA,
        runtimeLabel: RUNTIME_LABEL,
        goldenIds: MANUAL_GOLDEN_IDS,
        candidateRun: built.candidateRun,
        artifactRoot: built.artifactRoot
      })).rejects.toThrow();
    }

    const firstJournalPath = join(built.artifactRoot, `manual-send-${CANDIDATE_SHA}`, "01.json");
    const firstJournal = await readFile(firstJournalPath);
    const foreignJournal = JSON.parse(firstJournal.toString("utf8"));
    foreignJournal.payloadSha256 = "f".repeat(64);
    await writeFile(firstJournalPath, `${JSON.stringify(foreignJournal)}\n`);
    await expect(api.finalizeManualTelegramAcceptance(built.evidence, {
      candidateSha: CANDIDATE_SHA,
      runtimeLabel: RUNTIME_LABEL,
      goldenIds: MANUAL_GOLDEN_IDS,
      candidateRun: built.candidateRun,
      artifactRoot: built.artifactRoot
    })).rejects.toThrow(/journal/i);
    await writeFile(firstJournalPath, firstJournal);
    const extraJournalPath = join(built.artifactRoot, `manual-send-${CANDIDATE_SHA}`, "20.json");
    await writeFile(extraJournalPath, firstJournal);
    await expect(api.finalizeManualTelegramAcceptance(built.evidence, {
      candidateSha: CANDIDATE_SHA,
      runtimeLabel: RUNTIME_LABEL,
      goldenIds: MANUAL_GOLDEN_IDS,
      candidateRun: built.candidateRun,
      artifactRoot: built.artifactRoot
    })).rejects.toThrow(/journal/i);
    await rm(extraJournalPath);

    const screenshot = built.evidence.messageRecords[0].screenshotFilename;
    await writeFile(join(built.artifactRoot, screenshot), "changed screenshot");
    await expect(api.finalizeManualTelegramAcceptance(built.evidence, {
      candidateSha: CANDIDATE_SHA,
      runtimeLabel: RUNTIME_LABEL,
      goldenIds: MANUAL_GOLDEN_IDS,
      candidateRun: built.candidateRun,
      artifactRoot: built.artifactRoot
    })).rejects.toThrow(/screenshot/i);
    await rm(join(built.artifactRoot, screenshot));
    await expect(api.finalizeManualTelegramAcceptance(built.evidence, {
      candidateSha: CANDIDATE_SHA,
      runtimeLabel: RUNTIME_LABEL,
      goldenIds: MANUAL_GOLDEN_IDS,
      candidateRun: built.candidateRun,
      artifactRoot: built.artifactRoot
    })).rejects.toThrow();
  } finally {
    await rm(built.artifactRoot, { recursive: true, force: true });
  }
});

it("[REQ-32][PLAN5-MANUAL-SENDER] sends one guarded non-production batch and leaves a no-secret partial-run fence", async () => {
  const api = await loadApi();
  const built = await strictEvidence(api);
  let calls = 0;
  const partialRoot = await mkdtemp(join(tmpdir(), "plan5-telegram-partial-"));
  try {
    const foreignRun: any = cloneFixture(built.candidateRun);
    foreignRun.messages[0].checkedWallet = "TForeignWalletBindingMustFailBeforeSend";
    await expect(api.sendManualTelegramCandidateRunOnce(foreignRun, {
      artifactRoot: built.artifactRoot,
      allowSend: "1",
      botToken: "123456:AAPlan5DedicatedTestToken",
      testChatId: "-100111",
      productionBotToken: "654321:AAProductionReferenceToken",
      productionChatIds: ["-100999"],
      async sendMessage() { calls += 1; return { messageId: 1900 + calls }; }
    })).rejects.toThrow(/production draft/i);
    expect(calls).toBe(0);
    await expect(api.sendManualTelegramCandidateRunOnce(built.candidateRun, {
      artifactRoot: partialRoot,
      allowSend: "1",
      botToken: "123456:AAPlan5DedicatedTestToken",
      testChatId: "-100111",
      productionBotToken: "654321:AAProductionReferenceToken",
      productionChatIds: ["-100999"],
      async sendMessage() {
        calls += 1;
        if (calls === 4) throw new Error("injected send failure");
        return { messageId: 1800 + calls };
      }
    })).rejects.toThrow(/injected send failure/);
    expect(calls).toBe(4);
    await expect(api.sendManualTelegramCandidateRunOnce(built.candidateRun, {
      artifactRoot: partialRoot,
      allowSend: "1",
      botToken: "123456:AAPlan5DedicatedTestToken",
      testChatId: "-100111",
      productionBotToken: "654321:AAProductionReferenceToken",
      productionChatIds: ["-100999"],
      async sendMessage() { calls += 1; return { messageId: 1900 + calls }; }
    })).rejects.toThrow();
    expect(calls).toBe(4);
    calls = 0;
    const records = await api.sendManualTelegramCandidateRunOnce(built.candidateRun, {
      artifactRoot: built.artifactRoot,
      allowSend: "1",
      botToken: "123456:AAPlan5DedicatedTestToken",
      testChatId: "-100111",
      productionBotToken: "654321:AAProductionReferenceToken",
      productionChatIds: ["-100999"],
      async sendMessage() { calls += 1; return { messageId: 2000 + calls }; }
    });
    expect(records).toHaveLength(19);
    expect(calls).toBe(19);
    await expect(api.sendManualTelegramCandidateRunOnce(built.candidateRun, {
      artifactRoot: built.artifactRoot,
      allowSend: "1",
      botToken: "123456:AAPlan5DedicatedTestToken",
      testChatId: "-100111",
      productionBotToken: "654321:AAProductionReferenceToken",
      productionChatIds: ["-100999"],
      async sendMessage() { calls += 1; return { messageId: 3000 + calls }; }
    })).rejects.toThrow();
    expect(calls).toBe(19);
    expect(JSON.stringify(records)).not.toMatch(/token|chat|response/i);
  } finally {
    await rm(built.artifactRoot, { recursive: true, force: true });
    await rm(partialRoot, { recursive: true, force: true });
  }
});

it("[REQ-32][PLAN5-MANUAL-NETWORK] creates recording-disabled delivery evidence with zero Telegram calls", async () => {
  const api = await loadApi();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; throw new Error("network forbidden"); }) as typeof fetch;
  try {
    const draft = await api.buildManualTelegramCandidateDraft({ candidateSha: CANDIDATE_SHA, runtimeLabel: RUNTIME_LABEL });
    expect(draft.transport).toBe("recording_disabled");
    expect(draft.messages).toHaveLength(19);
    expect(draft.messages.every((message: any) => message.delivery.state.status === "pending"
      && message.delivery.payload.chatId === "recording_disabled")).toBe(true);
    expect(calls).toBe(0);
    let databaseCalls = 0;
    await expect(api.seedManualTelegramCandidateJobs({
      async query() { databaseCalls += 1; throw new Error("database must not be reached"); }
    }, draft, {
      task0bEvidence: task0bEvidence(new Date().toISOString()),
      candidateStartEvidence: candidateStartEvidence(),
      evaluatedAt: new Date().toISOString(),
      databaseUrl: "postgresql://test:test@db.example.invalid:5432/tron_watch_plan5_runtime_sanitized"
    })).rejects.toThrow(/loopback/i);
    expect(databaseCalls).toBe(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

it("[REQ-32][PLAN5-MANUAL-CLI] wires the allowlisted prepare/send/finalize state machine and defaults to zero-send prepare", async () => {
  const api = await loadApi();
  const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  expect(packageJson.scripts["release:telegram:manual"]).toBe("node --import tsx scripts/finalizeTelegramAcceptance.ts");
  const calls: string[] = [];
  const operations = {
    async prepare(root: string) { calls.push(`prepare:${root}`); },
    async send(root: string) { calls.push(`send:${root}`); },
    async finalize(root: string) { calls.push(`finalize:${root}`); }
  };
  const root = "C:/protected/plan5-artifacts";

  await expect(api.runManualTelegramCommand([root], {}, operations)).resolves.toBe("prepare");
  expect(calls).toEqual([`prepare:${root}`]);
  await expect(api.runManualTelegramCommand([root], {
    PLAN5_TELEGRAM_MANUAL_ACTION: "send"
  }, operations)).rejects.toThrow(/ALLOW_SEND/);
  expect(calls).toHaveLength(1);
  await expect(api.runManualTelegramCommand([root], {
    PLAN5_TELEGRAM_MANUAL_ACTION: "send",
    PLAN4_TELEGRAM_ALLOW_SEND: "1",
    PLAN4_TELEGRAM_TEST_BOT_TOKEN: "123456:AAPlan5DedicatedTestToken",
    PLAN4_TELEGRAM_TEST_CHAT_ID: "-100111",
    BOT_TOKEN: "654321:AAProductionReferenceToken",
    SERVICE_ADMIN_TG_IDS: "-100999"
  }, operations)).resolves.toBe("send");
  await expect(api.runManualTelegramCommand([root], {
    PLAN5_TELEGRAM_MANUAL_ACTION: "finalize"
  }, operations)).resolves.toBe("finalize");
  expect(calls).toEqual([`prepare:${root}`, `send:${root}`, `finalize:${root}`]);
  await expect(api.runManualTelegramCommand([root], {
    PLAN5_TELEGRAM_MANUAL_ACTION: "retry"
  }, operations)).rejects.toThrow(/action invalid/);
  await expect(api.runManualTelegramCommand([], {}, operations)).rejects.toThrow(/exactly one artifact root/);
});

const requirePostgres = process.env.REQUIRE_PLAN5_POSTGRES === "1";
const postgresIt = requirePostgres ? it : it.skip;

postgresIt("[REQ-32][PLAN5-MANUAL-POSTGRES] persists 19 terminal synthetic jobs without claimable Telegram delivery", async () => {
  const databaseUrl = process.env.PLAN5_SCHEMA_RUNTIME_SANITIZED_DATABASE_URL;
  if (!databaseUrl) throw new Error("PLAN5_SCHEMA_RUNTIME_SANITIZED_DATABASE_URL is required");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  let run: any;
  let built: Awaited<ReturnType<typeof strictEvidence>> | undefined;
  try {
    const api = await loadApi();
    const draft = await api.buildManualTelegramCandidateDraft({ candidateSha: CANDIDATE_SHA, runtimeLabel: RUNTIME_LABEL });
    const evaluatedAt = new Date().toISOString();
    const identity = await client.query(`select current_database() as database_name,
      current_setting('server_version_num') as server_version_num,
      (select oid::text from pg_database where datname = current_database()) as database_oid,
      (pg_control_system()).system_identifier::text as system_identifier`);
    const endpoint = new URL(databaseUrl);
    const { buildSchema032DatabaseFingerprint } = await import("../../scripts/verifySchema032");
    const databaseFingerprintSha256 = buildSchema032DatabaseFingerprint({
      databaseEndpoint: `${endpoint.hostname}:${endpoint.port || "5432"}`,
      systemIdentifier: String(identity.rows[0].system_identifier),
      databaseName: String(identity.rows[0].database_name),
      databaseOid: String(identity.rows[0].database_oid),
      serverVersion: String(identity.rows[0].server_version_num)
    });
    const freeze = task0bEvidence(evaluatedAt, databaseFingerprintSha256);
    const start = candidateStartEvidence();
    run = await api.seedManualTelegramCandidateJobs(client, draft, {
      task0bEvidence: freeze,
      candidateStartEvidence: start,
      evaluatedAt,
      databaseUrl
    });
    expect(run.messages).toHaveLength(19);
    const rows = await client.query(`select id, status, requested_by,
      progress_json ? 'telegramDelivery' as claimable,
      result_json#>>'{manualTelegramAcceptance,transport}' as transport
      from forensic_check_jobs where id = any($1::text[]) order by id`, [run.messages.map((message: any) => message.jobId)]);
    expect(rows.rows).toHaveLength(19);
    expect(rows.rows.every((row) => row.status === "completed" && row.requested_by === "plan5_manual_telegram"
      && row.claimable === false && row.transport === "recording_disabled")).toBe(true);
    await expect(api.verifyManualTelegramCandidateJobs(client, run, {
      task0bEvidence: freeze,
      candidateStartEvidence: start,
      evaluatedAt,
      databaseUrl
    })).resolves.toBeUndefined();
    const badFreeze: any = cloneFixture(freeze);
    badFreeze.databaseFingerprintSha256 = "f".repeat(64);
    await expect(api.verifyManualTelegramCandidateJobs(client, run, {
      task0bEvidence: badFreeze,
      candidateStartEvidence: start,
      evaluatedAt,
      databaseUrl
    })).rejects.toThrow(/fingerprint/i);
    const badStart: any = cloneFixture(start);
    badStart.runtimeLabel = "foreign-runtime";
    await expect(api.verifyManualTelegramCandidateJobs(client, run, {
      task0bEvidence: freeze,
      candidateStartEvidence: badStart,
      evaluatedAt,
      databaseUrl
    })).rejects.toThrow(/runtime/i);
    built = await strictEvidence(api, run);
    await writeFile(join(built.artifactRoot, "task0b-release-freeze.json"), `${JSON.stringify(freeze)}\n`);
    await writeFile(join(built.artifactRoot, "runtime-candidate-start-evidence.json"), `${JSON.stringify(start)}\n`);
    await expect(api.runManualTelegramCommand([built.artifactRoot], {
      PLAN5_SCHEMA_RUNTIME_SANITIZED_DATABASE_URL: databaseUrl
    })).resolves.toBe("prepare");
    const recoveredRun = JSON.parse(await readFile(join(built.artifactRoot, "manual-telegram-candidate-run.json"), "utf8"));
    expect(recoveredRun.messages.map((message: any) => message.jobId)).toEqual(run.messages.map((message: any) => message.jobId));
    await expect(api.runManualTelegramCommand([built.artifactRoot], {
      PLAN5_SCHEMA_RUNTIME_SANITIZED_DATABASE_URL: databaseUrl
    })).resolves.toBe("prepare");
    let sent = 0;
    await api.sendManualTelegramCandidateRunOnce(run, {
      artifactRoot: built.artifactRoot,
      allowSend: "1",
      botToken: "123456:AAPlan5DedicatedTestToken",
      testChatId: "-100111",
      productionBotToken: "654321:AAProductionReferenceToken",
      productionChatIds: ["-100999"],
      async sendMessage() { sent += 1; return { messageId: 1000 + sent }; }
    });
    await writeFile(join(built.artifactRoot, "manual-telegram-acceptance.json"), `${JSON.stringify(built.evidence)}\n`);
    const releaseVerifier = await import("../../scripts/verifyRemediationRelease");
    await expect(releaseVerifier.validateManualTelegramArtifactForRelease(
      built.artifactRoot,
      CANDIDATE_SHA
    )).resolves.toBeUndefined();
    const extraJobId = "plan5-manual-extra-population";
    await client.query(`insert into forensic_check_jobs (
      id, kind, subject_address, status, window_start, window_end, priority, chat_id, message_id,
      requested_by, progress_json, result_json, raw_evidence_ids, observation_ids, last_error,
      started_at, completed_at, created_at, updated_at
    ) select $1, kind, subject_address, status, window_start, window_end, priority, chat_id, message_id,
      requested_by, progress_json, result_json, raw_evidence_ids, observation_ids, last_error,
      started_at, completed_at, created_at, updated_at
      from forensic_check_jobs where id = $2`, [extraJobId, run.messages[0].jobId]);
    await expect(api.runManualTelegramCommand([built.artifactRoot], {
      PLAN5_SCHEMA_RUNTIME_SANITIZED_DATABASE_URL: databaseUrl
    })).rejects.toThrow(/population mismatch/);
    await client.query("delete from forensic_check_jobs where id = $1", [extraJobId]);
    await client.query("delete from forensic_check_jobs where id = $1", [run.messages[0].jobId]);
    await expect(api.runManualTelegramCommand([built.artifactRoot], {
      PLAN5_SCHEMA_RUNTIME_SANITIZED_DATABASE_URL: databaseUrl
    })).rejects.toThrow(/population mismatch/);
  } finally {
    if (run) await client.query("delete from forensic_check_jobs where id = any($1::text[])", [run.messages.map((message: any) => message.jobId)]).catch(() => undefined);
    await client.end();
    if (built) await rm(built.artifactRoot, { recursive: true, force: true });
  }
});
