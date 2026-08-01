import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MANUAL_TELEGRAM_ACCEPTANCE_CASES,
  assertTelegramUxAcceptanceSendAuthorized,
  buildTelegramUxAcceptanceManifest
} from "../../scripts/renderTelegramUxAcceptance";
import { REMEDIATION_TELEGRAM_GOLDEN_IDS } from "../fixtures/telegram/remediationTelegramGoldenMessages";

const EXPECTED_MANUAL_CASES = [
  { artifactId: "GOLDEN_FINAL_AML", fixtureIds: ["GOLDEN_FINAL_AML"], goldenIds: ["GOLDEN_FINAL_AML"], expectedRequirementIds: ["AC-07", "AC-08", "AC-09", "AC-13", "REQ-06", "REQ-15", "REQ-32"] },
  { artifactId: "GOLDEN_WHERE_PRELIMINARY", fixtureIds: ["GOLDEN_WHERE_PRELIMINARY"], goldenIds: ["GOLDEN_WHERE_PRELIMINARY"], expectedRequirementIds: ["AC-07", "AC-08", "AC-13", "REQ-12", "REQ-13", "REQ-14"] },
  { artifactId: "GOLDEN_NO_FINAL_TECHNICAL", fixtureIds: ["GOLDEN_NO_FINAL_TECHNICAL"], goldenIds: ["GOLDEN_NO_FINAL_TECHNICAL"], expectedRequirementIds: ["AC-08", "REQ-07", "REQ-34", "REQ-38"] },
  { artifactId: "GOLDEN_TRUE_NO_ACTIVITY", fixtureIds: ["GOLDEN_TRUE_NO_ACTIVITY"], goldenIds: ["GOLDEN_TRUE_NO_ACTIVITY"], expectedRequirementIds: ["AC-08", "AC-12", "REQ-31", "REQ-34"] },
  { artifactId: "GOLDEN_VERIFY20_ACTIVE_NO_DEBIT", fixtureIds: ["GOLDEN_VERIFY20_ACTIVE_NO_DEBIT"], goldenIds: ["GOLDEN_VERIFY20_ACTIVE_NO_DEBIT"], expectedRequirementIds: ["AC-08", "AC-20", "AC-21", "AC-27", "REQ-18", "REQ-20", "REQ-22"] },
  { artifactId: "GOLDEN_VERIFY20_EXACT_DEBIT", fixtureIds: ["GOLDEN_VERIFY20_EXACT_DEBIT"], goldenIds: ["GOLDEN_VERIFY20_EXACT_DEBIT"], expectedRequirementIds: ["AC-08", "AC-20", "AC-21", "AC-27", "REQ-18", "REQ-20", "REQ-22"] },
  { artifactId: "GOLDEN_BRIDGERS_ACTIVE", fixtureIds: ["GOLDEN_BRIDGERS_ACTIVE"], goldenIds: ["GOLDEN_BRIDGERS_ACTIVE"], expectedRequirementIds: ["AC-08", "AC-27", "REQ-18", "REQ-22"] },
  { artifactId: "GOLDEN_BRIDGERS_ZERO", fixtureIds: ["GOLDEN_BRIDGERS_ZERO"], goldenIds: ["GOLDEN_BRIDGERS_ZERO"], expectedRequirementIds: ["AC-08", "AC-27", "REQ-18", "REQ-22"] },
  { artifactId: "GOLDEN_BRIDGERS_ALLOWANCE_UNKNOWN", fixtureIds: ["GOLDEN_BRIDGERS_ALLOWANCE_UNKNOWN"], goldenIds: ["GOLDEN_BRIDGERS_ALLOWANCE_UNKNOWN"], expectedRequirementIds: ["AC-08", "AC-24", "AC-27", "REQ-18", "REQ-22"] },
  { artifactId: "GOLDEN_USDD_PSM", fixtureIds: ["GOLDEN_USDD_PSM"], goldenIds: ["GOLDEN_USDD_PSM"], expectedRequirementIds: ["AC-08", "REQ-09", "REQ-28", "REQ-32"] },
  { artifactId: "GOLDEN_GASFREE_ACCOUNT", fixtureIds: ["GOLDEN_GASFREE_ACCOUNT"], goldenIds: ["GOLDEN_GASFREE_ACCOUNT"], expectedRequirementIds: ["AC-08", "REQ-27", "REQ-32"] },
  { artifactId: "THJ_COLLECTOR_VARIANTS", fixtureIds: ["THJ_COLLECTOR_ONLY", "THJ_COLLECTOR_INDEPENDENT_SIGNAL"], goldenIds: [], expectedRequirementIds: ["AC-07", "AC-08", "REQ-09", "REQ-15", "REQ-28"] },
  { artifactId: "TKG_LOW_BALANCE_AND_COVERAGE", fixtureIds: ["TKG_LOW_BALANCE_LATEST_FIVE", "COVERAGE_24_10_14"], goldenIds: [], expectedRequirementIds: ["AC-08", "AC-12", "AC-13", "REQ-31", "REQ-34"] },
  { artifactId: "OFFICIAL_USDT_AND_PSM_OUTBOUND", fixtureIds: ["OFFICIAL_USDT_CONTRACT", "PSM_TWO_PERCENT_OUTBOUND"], goldenIds: [], expectedRequirementIds: ["AC-08", "REQ-09", "REQ-27", "REQ-28"] },
  { artifactId: "INCOMING_FAIL_CLOSED", fixtureIds: ["INCOMING_RETRY_INVALID_LEGACY_COVERAGE", "INVALID_ADDRESS_AND_ANCHOR"], goldenIds: [], expectedRequirementIds: ["AC-08", "AC-39", "REQ-07", "REQ-13", "REQ-14", "REQ-38"] }
] as const;

const REQUIRED_MANUAL_CASE_IDS = EXPECTED_MANUAL_CASES.map((item) => item.artifactId);

const REQUIRED_GOLDEN_IDS = [
  "GOLDEN_FINAL_AML",
  "GOLDEN_WHERE_PRELIMINARY",
  "GOLDEN_NO_FINAL_TECHNICAL",
  "GOLDEN_TRUE_NO_ACTIVITY",
  "GOLDEN_VERIFY20_ACTIVE_NO_DEBIT",
  "GOLDEN_VERIFY20_EXACT_DEBIT",
  "GOLDEN_BRIDGERS_ACTIVE",
  "GOLDEN_BRIDGERS_ZERO",
  "GOLDEN_BRIDGERS_ALLOWANCE_UNKNOWN",
  "GOLDEN_USDD_PSM",
  "GOLDEN_GASFREE_ACCOUNT"
] as const;

const README_PATH = fileURLToPath(new URL(
  "../../docs/superpowers/verification/plan4-telegram-ux/README.md",
  import.meta.url
));
const HARNESS_PATH = fileURLToPath(new URL("../../scripts/renderTelegramUxAcceptance.ts", import.meta.url));

type ManualCaseDefinition = {
  artifactId: string;
  fixtureIds: readonly string[];
  goldenIds: readonly string[];
  expectedRequirementIds: readonly string[];
};
type ManualManifestRecord = {
  artifactId: string;
  candidateSha: string;
  locale: string;
  reviewer: string;
  result: string;
  fixtureIds: string[];
  goldenIds: string[];
  expectedRequirementIds: string[];
  screenshotFilename: string;
};
type ManualSendAuthorizationInput = {
  sendRequested: boolean;
  allowSend: string | undefined;
  botToken: string | undefined;
  testChatId: string | undefined;
  productionChatIds: string[];
};

describe("manual Plan 4 Telegram acceptance manifest", () => {
  it("[PLAN4][MANUAL-MANIFEST] enumerates all 15 required manual cases and exactly 11 golden IDs", () => {
    const definitions = (MANUAL_TELEGRAM_ACCEPTANCE_CASES as readonly ManualCaseDefinition[]).map((item) => ({
      artifactId: item.artifactId,
      fixtureIds: item.fixtureIds,
      goldenIds: item.goldenIds,
      expectedRequirementIds: item.expectedRequirementIds
    }));
    expect(definitions).toEqual(EXPECTED_MANUAL_CASES);
    expect(REMEDIATION_TELEGRAM_GOLDEN_IDS).toEqual(REQUIRED_GOLDEN_IDS);

    const manifest = buildTelegramUxAcceptanceManifest({
      candidateSha: "1".repeat(40),
      locale: "ru",
      reviewer: "pending"
    }) as { records: ManualManifestRecord[] };
    expect(manifest.records).toHaveLength(15);
    expect(manifest.records.map((item) => ({
      artifactId: item.artifactId,
      fixtureIds: item.fixtureIds,
      goldenIds: item.goldenIds,
      expectedRequirementIds: item.expectedRequirementIds
    }))).toEqual(EXPECTED_MANUAL_CASES);
    for (const record of manifest.records) {
      expect(record).toMatchObject({
        candidateSha: "1".repeat(40),
        locale: "ru",
        reviewer: "pending",
        result: "pending"
      });
      expect(record.screenshotFilename).toMatch(/^[a-z0-9_-]+\.png$/);
    }
  });

  it("[PLAN4][MANUAL-NO-PRODUCTION] refuses production chats and requires every explicit send guard", async () => {
    const authorized: ManualSendAuthorizationInput = {
      sendRequested: true,
      allowSend: "1",
      botToken: "sanitized-test-token",
      testChatId: "sanitized-plan4-test-chat",
      productionChatIds: ["sanitized-production-chat"]
    };
    const rejected: Array<[string, ManualSendAuthorizationInput]> = [
      ["--send", { ...authorized, sendRequested: false }],
      ["PLAN4_TELEGRAM_ALLOW_SEND", { ...authorized, allowSend: undefined }],
      ["PLAN4_TELEGRAM_TEST_BOT_TOKEN", { ...authorized, botToken: undefined }],
      ["PLAN4_TELEGRAM_TEST_CHAT_ID", { ...authorized, testChatId: undefined }],
      ["production", { ...authorized, testChatId: "sanitized-production-chat" }]
    ];
    for (const [expectedMessage, input] of rejected) {
      expect(() => assertTelegramUxAcceptanceSendAuthorized(input), expectedMessage).toThrow(expectedMessage);
    }
    expect(() => assertTelegramUxAcceptanceSendAuthorized(authorized)).not.toThrow();

    const harness = await readFile(HARNESS_PATH, "utf8");
    expect(harness).toContain("--send");
    expect(harness).toContain("PLAN4_TELEGRAM_TEST_BOT_TOKEN");
    expect(harness).toContain("PLAN4_TELEGRAM_TEST_CHAT_ID");
    expect(harness).toContain("PLAN4_TELEGRAM_ALLOW_SEND");
    expect(harness).not.toMatch(/startPolling|bot\.start\(|TEST_BOT_TOKEN\s*=\s*["'][^"']+["']/);
  });

  it("[PLAN4][MANUAL-DOCS] documents redacted artifacts and the review record without claiming production release", async () => {
    const readme = await readFile(README_PATH, "utf8");

    for (const id of REQUIRED_MANUAL_CASE_IDS) expect(readme).toContain(id);
    for (const field of [
      "candidate SHA",
      "fixture ID",
      "REQ/AC",
      "reviewer",
      "result",
      "screenshot"
    ]) expect(readme.toLowerCase()).toContain(field.toLowerCase());
    expect(readme).toContain(".tmp/plan4/manual/");
    expect(readme).toMatch(/production.*(?:не|not).*(?:измен|touch|release)/i);
  });
});
