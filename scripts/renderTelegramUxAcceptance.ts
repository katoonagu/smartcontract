import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { adaptTelegramForensicResult } from "../src/telegram/forensicPresentationAdapters";
import { renderTelegramForensicResult } from "../src/telegram/forensicResultRenderer";
import {
  REMEDIATION_TELEGRAM_UX_CASES,
  remediationTelegramUxCase
} from "../tests/fixtures/telegram/remediationTelegramUxCases";
import {
  REMEDIATION_TELEGRAM_GOLDEN_MESSAGES,
  type RemediationTelegramGoldenId
} from "../tests/fixtures/telegram/remediationTelegramGoldenMessages";

export type ManualTelegramAcceptanceCase = {
  artifactId: string;
  fixtureIds: readonly string[];
  goldenIds: readonly RemediationTelegramGoldenId[];
  expectedRequirementIds: readonly string[];
};

export const MANUAL_TELEGRAM_ACCEPTANCE_CASES = [
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
] as const satisfies readonly ManualTelegramAcceptanceCase[];

type BuildManifestInput = {
  candidateSha: string;
  locale: "ru" | "en";
  reviewer: string;
  runId?: string;
};

export type TelegramUxAcceptanceManifest = {
  version: "plan4-telegram-ux-manual-v1";
  candidateSha: string;
  runId: string | null;
  locale: "ru" | "en";
  status: "manual acceptance pending";
  records: Array<{
    artifactId: string;
    candidateSha: string;
    locale: "ru" | "en";
    reviewer: string;
    result: "pending";
    fixtureIds: string[];
    goldenIds: string[];
    expectedRequirementIds: string[];
    screenshotFilename: string;
    checkedWallets: Array<{ fixtureId: string; address: string }>;
  }>;
};

function candidateSha(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(normalized)) throw new Error("candidate_sha_invalid");
  return normalized;
}

export function buildTelegramUxAcceptanceManifest(input: BuildManifestInput): TelegramUxAcceptanceManifest {
  const sha = candidateSha(input.candidateSha);
  const reviewer = input.reviewer.trim();
  if (!reviewer) throw new Error("reviewer_required");
  const runId = input.runId?.trim() ?? null;
  if (runId !== null && !/^[0-9]{8}t[0-9]{9}z-[0-9a-f-]{36}$/.test(runId)) {
    throw new Error("run_id_invalid");
  }
  return {
    version: "plan4-telegram-ux-manual-v1",
    candidateSha: sha,
    runId,
    locale: input.locale,
    status: "manual acceptance pending",
    records: MANUAL_TELEGRAM_ACCEPTANCE_CASES.map((definition) => ({
      artifactId: definition.artifactId,
      candidateSha: sha,
      locale: input.locale,
      reviewer,
      result: "pending",
      fixtureIds: [...definition.fixtureIds],
      goldenIds: [...definition.goldenIds],
      expectedRequirementIds: [...definition.expectedRequirementIds],
      screenshotFilename: `${definition.artifactId.toLowerCase()}.png`,
      checkedWallets: definition.fixtureIds.map((fixtureId) => ({
        fixtureId,
        address: remediationTelegramUxCase(fixtureId).source.checkedWalletAddress
      }))
    }))
  };
}

export type ManualSendAuthorizationInput = {
  sendRequested: boolean;
  allowSend: string | undefined;
  botToken: string | undefined;
  testChatId: string | undefined;
  productionChatIds: readonly string[];
  productionBotToken?: string | undefined;
  productionReferencesRequired?: boolean;
};

function canonicalTelegramChatId(value: string): string | null {
  const normalized = value.trim();
  if (!/^-?[1-9][0-9]*$/.test(normalized)) return null;
  try {
    return BigInt(normalized).toString();
  } catch {
    return null;
  }
}

export function assertTelegramUxAcceptanceSendAuthorized(input: ManualSendAuthorizationInput): void {
  if (!input.sendRequested) throw new Error("--send is required");
  if (input.allowSend !== "1") throw new Error("PLAN4_TELEGRAM_ALLOW_SEND must equal 1");
  const token = input.botToken?.trim();
  if (!token) throw new Error("PLAN4_TELEGRAM_TEST_BOT_TOKEN is required");
  const chatId = input.testChatId?.trim();
  if (!chatId) throw new Error("PLAN4_TELEGRAM_TEST_CHAT_ID is required");
  const productionToken = input.productionBotToken?.trim();
  const productionChats = input.productionChatIds.map((value) => value.trim()).filter(Boolean);
  if (input.productionReferencesRequired && !productionToken) {
    throw new Error("production BOT_TOKEN reference is required");
  }
  if (input.productionReferencesRequired && productionChats.length === 0) {
    throw new Error("production SERVICE_ADMIN_TG_IDS references are required");
  }
  if (productionToken && token === productionToken) {
    throw new Error("production bot token is forbidden");
  }
  if (input.productionReferencesRequired) {
    const canonicalTestChat = canonicalTelegramChatId(chatId);
    if (canonicalTestChat === null) throw new Error("PLAN4_TELEGRAM_TEST_CHAT_ID must be a canonical numeric chat ID");
    const canonicalProductionChats = productionChats.map(canonicalTelegramChatId);
    if (canonicalProductionChats.some((value) => value === null)) {
      throw new Error("production SERVICE_ADMIN_TG_IDS reference is invalid");
    }
    if (canonicalProductionChats.includes(canonicalTestChat)) throw new Error("production chat is forbidden");
    return;
  }
  if (productionChats.includes(chatId)) {
    throw new Error("production chat is forbidden");
  }
}

type RenderedMessage = {
  artifactId: string;
  fixtureId: string;
  expectedRequirementIds: string[];
  goldenId: RemediationTelegramGoldenId | null;
  checkedWallet: { address: string; display: string; url: string | null };
  locale: "ru" | "en";
  html: string;
};

function artifactStem(artifactId: string, fixtureId: string): string {
  return `${artifactId}--${fixtureId}`.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

function renderAcceptanceMessages(): { messages: RenderedMessage[]; goldenComparisons: number } {
  const knownFixtureIds = new Set(REMEDIATION_TELEGRAM_UX_CASES.map((fixture) => fixture.id));
  const messages: RenderedMessage[] = [];
  let goldenComparisons = 0;
  for (const definition of MANUAL_TELEGRAM_ACCEPTANCE_CASES) {
    for (const fixtureId of definition.fixtureIds) {
      if (!knownFixtureIds.has(fixtureId)) throw new Error(`manual_fixture_missing:${fixtureId}`);
      const fixture = remediationTelegramUxCase(fixtureId);
      const adapted = adaptTelegramForensicResult(fixture.source);
      const html = renderTelegramForensicResult(adapted);
      const goldenId = definition.goldenIds.find((id) => id === fixtureId) ?? null;
      if (goldenId) {
        goldenComparisons += 1;
        if (html !== REMEDIATION_TELEGRAM_GOLDEN_MESSAGES[goldenId]) {
          throw new Error(`manual_golden_mismatch:${goldenId}`);
        }
      }
      messages.push({
        artifactId: definition.artifactId,
        fixtureId,
        expectedRequirementIds: [...definition.expectedRequirementIds],
        goldenId,
        checkedWallet: { ...adapted.checkedWallet },
        locale: adapted.locale,
        html
      });
    }
  }
  if (MANUAL_TELEGRAM_ACCEPTANCE_CASES.length !== 15 || messages.length !== 19 || goldenComparisons !== 11) {
    throw new Error("manual_acceptance_case_count_mismatch");
  }
  return { messages, goldenComparisons };
}

async function writeArtifacts(
  root: string,
  manifest: TelegramUxAcceptanceManifest,
  messages: readonly RenderedMessage[]
): Promise<void> {
  const messagesRoot = resolve(root, "messages");
  await mkdir(messagesRoot, { recursive: true });
  await writeFile(resolve(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  for (const message of messages) {
    const stem = artifactStem(message.artifactId, message.fixtureId);
    await writeFile(resolve(messagesRoot, `${stem}.html`), message.html, "utf8");
    await writeFile(resolve(messagesRoot, `${stem}.json`), `${JSON.stringify(message, null, 2)}\n`, "utf8");
  }
}

async function sendTelegramHtmlSequentially(
  token: string,
  chatId: string,
  messages: readonly RenderedMessage[]
): Promise<void> {
  for (const message of messages) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({
          chat_id: chatId,
          text: message.html,
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true }
        })
      });
      if (!response.ok) throw new Error("telegram_test_send_failed");
    } catch {
      throw new Error("telegram_test_send_failed");
    }
  }
}

function currentGitSha(): string {
  return candidateSha(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }));
}

function productionChatIds(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map((value) => value.trim()).filter(Boolean);
}

function acceptanceRunId(now = new Date()): string {
  const timestamp = now.toISOString().replace(/[-:.]/g, "").toLowerCase();
  return `${timestamp}-${randomUUID()}`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sendRequested = args.includes("--send");
  const dryRunRequested = args.length === 0 || args.includes("--dry-run");
  if (args.some((arg) => arg !== "--send" && arg !== "--dry-run") || (sendRequested && dryRunRequested)) {
    throw new Error("usage: renderTelegramUxAcceptance.ts [--dry-run|--send]");
  }

  const sha = currentGitSha();
  const runId = acceptanceRunId();
  const manifest = buildTelegramUxAcceptanceManifest({ candidateSha: sha, locale: "ru", reviewer: "pending", runId });
  const { messages, goldenComparisons } = renderAcceptanceMessages();
  const artifactRoot = resolve(process.cwd(), ".tmp", "plan4", "manual", sha, runId);
  await writeArtifacts(artifactRoot, manifest, messages);

  if (sendRequested) {
    const authorization: ManualSendAuthorizationInput = {
      sendRequested,
      allowSend: process.env.PLAN4_TELEGRAM_ALLOW_SEND,
      botToken: process.env.PLAN4_TELEGRAM_TEST_BOT_TOKEN,
      testChatId: process.env.PLAN4_TELEGRAM_TEST_CHAT_ID,
      productionChatIds: productionChatIds(process.env.SERVICE_ADMIN_TG_IDS),
      productionBotToken: process.env.BOT_TOKEN,
      productionReferencesRequired: true
    };
    assertTelegramUxAcceptanceSendAuthorized(authorization);
    await sendTelegramHtmlSequentially(authorization.botToken!.trim(), authorization.testChatId!.trim(), messages);
  }

  process.stdout.write(
    `Plan 4 Telegram UX acceptance: ${MANUAL_TELEGRAM_ACCEPTANCE_CASES.length} cases, ${messages.length} messages, ${goldenComparisons} golden comparisons; manual acceptance pending.\n`
  );
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "manual_acceptance_failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
