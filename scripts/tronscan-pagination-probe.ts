import "dotenv/config";

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TRON_USDT_CONTRACT_ADDRESS } from "../src/parser/transactionParser";

type Direction = "related" | "incoming";
type KnownRowKind = "failed" | "reverted" | "approval";

type ProbeKind =
  | "offset"
  | "repeat"
  | "dense_window"
  | "end_walk"
  | "same_timestamp_boundary"
  | "incoming_cost"
  | "rps_ramp"
  | "known_failed"
  | "known_reverted"
  | "known_approval";

type DenseWindow = {
  startTimestamp: number;
  endTimestamp: number;
};

type KnownRowProbe = {
  rowKind: KnownRowKind;
  address: string;
  direction: Direction;
  start: number;
  limit: number;
  startTimestamp: number;
  endTimestamp: number;
  expectedTxId: string | null;
};

type Config = {
  address: string;
  incomingAddress: string | null;
  direction: Direction;
  baseUrl: URL;
  limit: number;
  startTimestamp: number;
  endTimestamp: number;
  denseWindows: DenseWindow[];
  outDir: string;
  repeatCount: number;
  endWalkPages: number;
  boundaryPages: number;
  requestSpacingMs: number;
  apiKeySlots: ApiKeySlot[];
  rpsRampTargets: number[];
  rpsRampRequestsPerTarget: number;
  rpsRampMaxConcurrency: number | null;
  incomingMinTimestamp: number | null;
  incomingMaxTimestamp: number | null;
  knownRowProbes: KnownRowProbe[];
  dryRun: boolean;
};

type ApiKeySlot = {
  apiKey: string | null;
  label: string;
  groupId: string;
};

type ProbeRequest = {
  kind: ProbeKind;
  label: string;
  sequence: string;
  address: string;
  direction: Direction;
  start: number;
  limit: number;
  startTimestamp: number;
  endTimestamp: number;
  targetRps?: number;
  knownRowKind?: KnownRowKind;
  expectedTxId?: string | null;
};

type FieldSummary = {
  eventIndexRows: number;
  logIndexRows: number;
  ordinalFallbackRows: number;
  eventTypes: string[];
  confirmedValues: string[];
  contractRetValues: string[];
  finalResultValues: string[];
  revertValues: string[];
  riskTransactionValues: string[];
  multipleTransferTransactionCount: number;
  indistinguishableTransferGroups: number;
};

type ProbeResult = {
  label: string;
  kind: ProbeKind;
  sequence: string;
  url: string;
  rawFile: string;
  apiKeyLabel: string;
  apiKeyGroup: string;
  httpStatus: number;
  actualRows: number;
  total: number | null;
  rangeTotal: number | null;
  rawResponseHash: string;
  canonicalTransferHash: string;
  oldestTimestamp: number | null;
  newestTimestamp: number | null;
  oldestBlockNumber: number | null;
  newestBlockNumber: number | null;
  duplicateTransferIds: string[];
  sameTimestampBoundaryCount: number;
  sameBlockBoundaryCount: number;
  knownRowKind: KnownRowKind | null;
  expectedTxId: string | null;
  expectedTxIdRows: number | null;
  emptyPageAfterNonEmptyWindow: boolean;
  latencyMs: number;
  error: string | null;
  fieldSummary: FieldSummary;
};

type PreviousSequenceResult = {
  hadNonEmptyPage: boolean;
  oldestTimestamp: number | null;
  oldestBlockNumber: number | null;
};

type WallClockCadenceOptions<T> = {
  items: readonly T[];
  targetRps: number;
  maxConcurrency: number;
  runItem: (item: T, index: number) => Promise<void>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

function usage(): string {
  return [
    "Usage:",
    "  node --import tsx scripts/tronscan-pagination-probe.ts --address <TRON_ADDRESS> [options]",
    "",
    "Required:",
    "  --address <addr>                         Address for relatedAddress probes, or TRONSCAN_PROBE_ADDRESS.",
    "",
    "Common options:",
    "  --start-timestamp <ms|ISO>               Inclusive lower timestamp. Default: 0.",
    "  --end-timestamp <ms|ISO>                 Inclusive upper timestamp. Default: now.",
    "  --base-url <https-url>                   Default: TRONSCAN_BASE_URL or https://apilist.tronscanapi.com.",
    "  --direction related|incoming             Default: related.",
    "  --out-dir <dir>                          Default: logs/tronscan-probe.",
    "  --request-spacing-ms <ms>                Delay between normal probe requests. Default: 250.",
    "  --dense-window <start:end>               Extra range window; may be repeated. Values are ms or ISO.",
    "  --rps-ramp <rps,rps>                     Optional wall-clock RPS ramp targets.",
    "  --rps-ramp-requests <n>                  Requests per RPS target. Default: 10.",
    "  --rps-ramp-max-concurrency <n>           Max in-flight ramp requests. Default: ceil(target RPS * 2).",
    "  --incoming-address <addr>                Enables incoming cost comparison probes.",
    "  --incoming-min-timestamp <ms|ISO>         Lower bound for incoming cost comparison.",
    "  --incoming-max-timestamp <ms|ISO>         Upper bound for incoming cost comparison.",
    "  --known-failed-row <probe>                Dedicated failed-row probe; may be repeated.",
    "  --known-reverted-row <probe>              Dedicated reverted-row probe; may be repeated.",
    "  --known-approval-row <probe>              Dedicated approval-row probe; may be repeated.",
    "                                           Probe format: address,start,end[,direction[,offset[,limit[,txid]]]].",
    "  --dry-run                                Write planned request summary without calling TronScan.",
    "",
    "Env:",
    "  TRONSCAN_API_KEY                         Comma-separated key pool.",
    "  TRONSCAN_API_KEY_GROUPS                  group:key1,key2;other:key3, matching production config syntax.",
    "  TRONSCAN_PROBE_RPS_RAMP_MAX_CONCURRENCY  Optional max in-flight ramp requests."
  ].join("\n");
}

function parseArgs(argv: string[]): Config {
  const values = new Map<string, string[]>();
  const flags = new Set<string>();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }
    if (arg === "--help" || arg === "-h" || arg === "--dry-run") {
      flags.add(arg);
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${arg} requires a value`);
    }
    const list = values.get(arg) ?? [];
    list.push(value);
    values.set(arg, list);
    i += 1;
  }

  if (flags.has("--help") || flags.has("-h")) {
    console.log(usage());
    process.exit(0);
  }

  const address = first(values, "--address") ?? process.env.TRONSCAN_PROBE_ADDRESS?.trim();
  if (!address) {
    throw new Error("Missing --address or TRONSCAN_PROBE_ADDRESS");
  }

  const baseUrl = parseHttpsUrl(
    first(values, "--base-url") ?? process.env.TRONSCAN_BASE_URL ?? "https://apilist.tronscanapi.com",
    "--base-url"
  );
  const direction = parseDirection(first(values, "--direction") ?? process.env.TRONSCAN_PROBE_DIRECTION ?? "related");
  const limit = parseInteger(first(values, "--limit") ?? process.env.TRONSCAN_PROBE_LIMIT ?? "50", "--limit", 1, 200);
  const startTimestamp = parseTimestamp(first(values, "--start-timestamp") ?? process.env.TRONSCAN_PROBE_START_TIMESTAMP ?? "0", "--start-timestamp");
  const endTimestamp = parseTimestamp(first(values, "--end-timestamp") ?? process.env.TRONSCAN_PROBE_END_TIMESTAMP ?? String(Date.now()), "--end-timestamp");
  if (startTimestamp > endTimestamp) {
    throw new Error("--start-timestamp must be less than or equal to --end-timestamp");
  }

  const incomingAddress = first(values, "--incoming-address") ?? process.env.TRONSCAN_PROBE_INCOMING_ADDRESS ?? null;
  const incomingMinTimestampRaw = first(values, "--incoming-min-timestamp") ?? process.env.TRONSCAN_PROBE_INCOMING_MIN_TIMESTAMP;
  const incomingMaxTimestampRaw = first(values, "--incoming-max-timestamp") ?? process.env.TRONSCAN_PROBE_INCOMING_MAX_TIMESTAMP;
  const incomingMinTimestamp = incomingMinTimestampRaw ? parseTimestamp(incomingMinTimestampRaw, "--incoming-min-timestamp") : null;
  const incomingMaxTimestamp = incomingMaxTimestampRaw ? parseTimestamp(incomingMaxTimestampRaw, "--incoming-max-timestamp") : null;
  if ((incomingMinTimestamp === null) !== (incomingMaxTimestamp === null)) {
    throw new Error("--incoming-min-timestamp and --incoming-max-timestamp must be supplied together");
  }
  if (incomingMinTimestamp !== null && incomingMaxTimestamp !== null && incomingMinTimestamp > incomingMaxTimestamp) {
    throw new Error("--incoming-min-timestamp must be less than or equal to --incoming-max-timestamp");
  }

  const denseWindows = [
    ...all(values, "--dense-window"),
    ...splitComma(process.env.TRONSCAN_PROBE_DENSE_WINDOWS)
  ].map(parseDenseWindow);
  const knownRowProbes = [
    ...all(values, "--known-failed-row").map((value) => parseKnownRowProbe("failed", value, direction, limit)),
    ...all(values, "--known-reverted-row").map((value) => parseKnownRowProbe("reverted", value, direction, limit)),
    ...all(values, "--known-approval-row").map((value) => parseKnownRowProbe("approval", value, direction, limit))
  ];

  return {
    address,
    incomingAddress,
    direction,
    baseUrl,
    limit,
    startTimestamp,
    endTimestamp,
    denseWindows,
    outDir: first(values, "--out-dir") ?? process.env.TRONSCAN_PROBE_OUT_DIR ?? path.join("logs", "tronscan-probe"),
    repeatCount: parseInteger(first(values, "--repeat-count") ?? process.env.TRONSCAN_PROBE_REPEAT_COUNT ?? "5", "--repeat-count", 1, 20),
    endWalkPages: parseInteger(first(values, "--end-walk-pages") ?? process.env.TRONSCAN_PROBE_END_WALK_PAGES ?? "5", "--end-walk-pages", 1, 50),
    boundaryPages: parseInteger(first(values, "--boundary-pages") ?? process.env.TRONSCAN_PROBE_BOUNDARY_PAGES ?? "3", "--boundary-pages", 1, 20),
    requestSpacingMs: parseInteger(first(values, "--request-spacing-ms") ?? process.env.TRONSCAN_PROBE_REQUEST_SPACING_MS ?? "250", "--request-spacing-ms", 0, 60_000),
    apiKeySlots: parseApiKeySlots(process.env.TRONSCAN_API_KEY, process.env.TRONSCAN_API_KEY_GROUPS),
    rpsRampTargets: splitComma(first(values, "--rps-ramp") ?? process.env.TRONSCAN_PROBE_RPS_RAMP).map((value) => parsePositiveNumber(value, "--rps-ramp")),
    rpsRampRequestsPerTarget: parseInteger(first(values, "--rps-ramp-requests") ?? process.env.TRONSCAN_PROBE_RPS_RAMP_REQUESTS ?? "10", "--rps-ramp-requests", 1, 500),
    rpsRampMaxConcurrency: parseOptionalInteger(first(values, "--rps-ramp-max-concurrency") ?? process.env.TRONSCAN_PROBE_RPS_RAMP_MAX_CONCURRENCY, "--rps-ramp-max-concurrency", 1, 500),
    incomingMinTimestamp,
    incomingMaxTimestamp,
    knownRowProbes,
    dryRun: flags.has("--dry-run")
  };
}

function first(values: Map<string, string[]>, key: string): string | undefined {
  return values.get(key)?.[0];
}

function all(values: Map<string, string[]>, key: string): string[] {
  return values.get(key) ?? [];
}

function splitComma(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseDirection(value: string): Direction {
  if (value === "related" || value === "incoming") return value;
  throw new Error("--direction must be related or incoming");
}

function parseHttpsUrl(rawValue: string, name: string): URL {
  const url = new URL(rawValue);
  if (url.protocol !== "https:") {
    throw new Error(`${name} must use https`);
  }
  return url;
}

function parseInteger(rawValue: string, name: string, min: number, max: number): number {
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be a safe integer between ${min} and ${max}`);
  }
  return value;
}

function parseOptionalInteger(rawValue: string | undefined, name: string, min: number, max: number): number | null {
  return rawValue === undefined ? null : parseInteger(rawValue, name, min, max);
}

function parsePositiveNumber(rawValue: string, name: string): number {
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must contain positive numbers`);
  }
  return value;
}

function parseTimestamp(rawValue: string, name: string): number {
  const value = rawValue.trim();
  if (/^\d+$/.test(value)) {
    const timestamp = Number(value);
    if (Number.isSafeInteger(timestamp)) return timestamp;
  }
  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) return parsed;
  throw new Error(`${name} must be a millisecond timestamp or ISO date`);
}

function parseDenseWindow(rawValue: string): DenseWindow {
  const separator = rawValue.indexOf(":");
  if (separator <= 0 || separator === rawValue.length - 1) {
    throw new Error("--dense-window must use <start:end>");
  }
  const startTimestamp = parseTimestamp(rawValue.slice(0, separator), "--dense-window start");
  const endTimestamp = parseTimestamp(rawValue.slice(separator + 1), "--dense-window end");
  if (startTimestamp > endTimestamp) {
    throw new Error("--dense-window start must be less than or equal to end");
  }
  return { startTimestamp, endTimestamp };
}

function parseKnownRowProbe(rowKind: KnownRowKind, rawValue: string, defaultDirection: Direction, defaultLimit: number): KnownRowProbe {
  const flag = knownRowFlag(rowKind);
  const parts = rawValue.split(",").map((part) => part.trim());
  if (parts.length < 3 || parts.length > 7) {
    throw new Error(`${flag} must use address,start,end[,direction[,offset[,limit[,txid]]]]`);
  }

  const [address, rawStartTimestamp, rawEndTimestamp, rawDirection, rawStart, rawLimit, rawExpectedTxId] = parts;
  if (!address) throw new Error(`${flag} requires a non-empty address`);

  const startTimestamp = parseTimestamp(rawStartTimestamp, `${flag} start`);
  const endTimestamp = parseTimestamp(rawEndTimestamp, `${flag} end`);
  if (startTimestamp > endTimestamp) {
    throw new Error(`${flag} start must be less than or equal to end`);
  }

  return {
    rowKind,
    address,
    direction: rawDirection ? parseDirection(rawDirection) : defaultDirection,
    start: rawStart ? parseInteger(rawStart, `${flag} offset`, 0, 10_000) : 0,
    limit: rawLimit ? parseInteger(rawLimit, `${flag} limit`, 1, 200) : defaultLimit,
    startTimestamp,
    endTimestamp,
    expectedTxId: rawExpectedTxId || null
  };
}

function knownRowFlag(rowKind: KnownRowKind): string {
  return `--known-${rowKind}-row`;
}

function parseApiKeySlots(rawKeys: string | undefined, rawGroups: string | undefined): ApiKeySlot[] {
  const apiKeys = [...new Set(splitComma(rawKeys))];
  if (apiKeys.length === 0) {
    return [{ apiKey: null, label: "no_key", groupId: "default" }];
  }

  const groupByKey = new Map<string, string>();
  const groupValue = rawGroups?.trim();
  if (groupValue) {
    for (const rawGroup of groupValue.split(";")) {
      if (rawGroup.trim().length === 0) continue;
      const separator = rawGroup.indexOf(":");
      if (separator <= 0 || separator === rawGroup.length - 1) {
        throw new Error("TRONSCAN_API_KEY_GROUPS must use group:key1,key2 entries separated by semicolons");
      }
      const groupId = rawGroup.slice(0, separator).trim();
      for (const apiKey of splitComma(rawGroup.slice(separator + 1))) {
        if (!apiKeys.includes(apiKey)) {
          throw new Error("TRONSCAN_API_KEY_GROUPS contains a key not present in TRONSCAN_API_KEY");
        }
        if (!groupByKey.has(apiKey)) {
          groupByKey.set(apiKey, groupId || "default");
        }
      }
    }
  }

  return apiKeys.map((apiKey, index) => ({
    apiKey,
    label: `key_${index + 1}_${hashText(apiKey).slice(0, 8)}`,
    groupId: groupByKey.get(apiKey) ?? "default"
  }));
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function buildInitialRequests(config: Config): ProbeRequest[] {
  const base = {
    address: config.address,
    direction: config.direction,
    limit: config.limit,
    startTimestamp: config.startTimestamp,
    endTimestamp: config.endTimestamp
  };
  const offsetStarts = [0, 50, 9_950, 10_000];
  const requests: ProbeRequest[] = offsetStarts.map((start) => ({
    ...base,
    kind: "offset" as const,
    label: `offset_start_${start}`,
    sequence: "offset",
    start
  }));

  for (let i = 0; i < config.repeatCount; i += 1) {
    requests.push({
      ...base,
      kind: "repeat",
      label: `repeat_start_0_${i + 1}`,
      sequence: "repeat_start_0",
      start: 0
    });
  }

  const denseWindows = config.denseWindows.length > 0
    ? config.denseWindows
    : [{ startTimestamp: config.startTimestamp, endTimestamp: config.endTimestamp }];
  denseWindows.forEach((window, index) => {
    for (const start of [0, 9_950, 10_000]) {
      requests.push({
        ...base,
        kind: "dense_window",
        label: `dense_window_${index + 1}_start_${start}`,
        sequence: `dense_window_${index + 1}`,
        start,
        startTimestamp: window.startTimestamp,
        endTimestamp: window.endTimestamp
      });
    }
  });

  if (config.incomingAddress && config.incomingMinTimestamp !== null && config.incomingMaxTimestamp !== null) {
    requests.push({
      ...base,
      kind: "incoming_cost",
      label: "incoming_cost_zero_to_max",
      sequence: "incoming_cost",
      address: config.incomingAddress,
      direction: "incoming",
      start: 0,
      startTimestamp: 0,
      endTimestamp: config.incomingMaxTimestamp
    });
    requests.push({
      ...base,
      kind: "incoming_cost",
      label: "incoming_cost_min_to_max",
      sequence: "incoming_cost",
      address: config.incomingAddress,
      direction: "incoming",
      start: 0,
      startTimestamp: config.incomingMinTimestamp,
      endTimestamp: config.incomingMaxTimestamp
    });
  }

  config.knownRowProbes.forEach((probe, index) => {
    requests.push({
      ...base,
      kind: knownProbeKind(probe.rowKind),
      label: `known_${probe.rowKind}_${index + 1}`,
      sequence: `known_${probe.rowKind}`,
      address: probe.address,
      direction: probe.direction,
      start: probe.start,
      limit: probe.limit,
      startTimestamp: probe.startTimestamp,
      endTimestamp: probe.endTimestamp,
      knownRowKind: probe.rowKind,
      expectedTxId: probe.expectedTxId
    });
  });

  for (const targetRps of config.rpsRampTargets) {
    for (let i = 0; i < config.rpsRampRequestsPerTarget; i += 1) {
      requests.push({
        ...base,
        kind: "rps_ramp",
        label: `rps_${formatNumberForLabel(targetRps)}_${i + 1}`,
        sequence: `rps_${formatNumberForLabel(targetRps)}`,
        start: (i % 4) * 50,
        targetRps
      });
    }
  }

  return requests;
}

function knownProbeKind(rowKind: KnownRowKind): ProbeKind {
  if (rowKind === "failed") return "known_failed";
  if (rowKind === "reverted") return "known_reverted";
  return "known_approval";
}

function formatNumberForLabel(value: number): string {
  return String(value).replace(/[^0-9a-z]+/gi, "_");
}

function buildUrl(config: Config, request: ProbeRequest): URL {
  const url = new URL("/api/token_trc20/transfers", config.baseUrl);
  if (request.direction === "incoming") {
    url.searchParams.set("toAddress", request.address);
  } else {
    url.searchParams.set("relatedAddress", request.address);
  }
  url.searchParams.set("contract_address", TRON_USDT_CONTRACT_ADDRESS);
  url.searchParams.set("confirm", "0");
  url.searchParams.set("limit", String(request.limit));
  url.searchParams.set("start", String(request.start));
  url.searchParams.set("start_timestamp", String(request.startTimestamp));
  url.searchParams.set("end_timestamp", String(request.endTimestamp));
  url.searchParams.set("sort", "-timestamp");
  return url;
}

async function runProbe(
  config: Config,
  runDir: string,
  request: ProbeRequest,
  requestIndex: number,
  previous: PreviousSequenceResult | undefined
): Promise<ProbeResult> {
  const url = buildUrl(config, request);
  const keySlot = config.apiKeySlots[requestIndex % config.apiKeySlots.length];
  const headers = new Headers();
  if (keySlot.apiKey) headers.set("TRON-PRO-API-KEY", keySlot.apiKey);

  const startedAt = process.hrtime.bigint();
  let httpStatus = 0;
  let rawText = "";
  let fetchError: string | null = null;

  if (config.dryRun) {
    rawText = JSON.stringify({ dry_run: true, url: redactUrl(url).toString() });
  } else {
    try {
      const response = await fetch(url, { headers });
      httpStatus = response.status;
      rawText = await response.text();
    } catch (error) {
      fetchError = error instanceof Error ? error.message : String(error);
      rawText = JSON.stringify({ error: fetchError });
    }
  }

  const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  const rawResponseHash = hashText(rawText);
  const json = parseJson(rawText);
  const rows = transferRows(json);
  const timestamps = rows.map(transferTimestamp).filter((value): value is number => value !== null);
  const blockNumbers = rows.map(transferBlockNumber).filter((value): value is number => value !== null);
  const oldestTimestamp = timestamps.length > 0 ? Math.min(...timestamps) : null;
  const newestTimestamp = timestamps.length > 0 ? Math.max(...timestamps) : null;
  const oldestBlockNumber = blockNumbers.length > 0 ? Math.min(...blockNumbers) : null;
  const newestBlockNumber = blockNumbers.length > 0 ? Math.max(...blockNumbers) : null;
  const duplicateTransferIds = duplicateIds(rows.map(baseTransferId));
  const sameTimestampBoundaryCount = previous?.oldestTimestamp === null || previous?.oldestTimestamp === undefined
    ? 0
    : rows.filter((row) => transferTimestamp(row) === previous.oldestTimestamp).length;
  const sameBlockBoundaryCount = previous?.oldestBlockNumber === null || previous?.oldestBlockNumber === undefined
    ? 0
    : rows.filter((row) => transferBlockNumber(row) === previous.oldestBlockNumber).length;
  const expectedTxId = request.expectedTxId ?? null;
  const expectedTxIdRows = expectedTxId === null
    ? null
    : rows.filter((row) => transferTxId(row) === stablePart(expectedTxId)).length;
  const result: ProbeResult = {
    label: request.label,
    kind: request.kind,
    sequence: request.sequence,
    url: redactUrl(url).toString(),
    rawFile: "",
    apiKeyLabel: keySlot.label,
    apiKeyGroup: keySlot.groupId,
    httpStatus,
    actualRows: rows.length,
    total: topLevelInteger(json, "total"),
    rangeTotal: topLevelInteger(json, "rangeTotal"),
    rawResponseHash,
    canonicalTransferHash: hashText(JSON.stringify(rows.map(canonicalTransfer))),
    oldestTimestamp,
    newestTimestamp,
    oldestBlockNumber,
    newestBlockNumber,
    duplicateTransferIds,
    sameTimestampBoundaryCount,
    sameBlockBoundaryCount,
    knownRowKind: request.knownRowKind ?? null,
    expectedTxId,
    expectedTxIdRows,
    emptyPageAfterNonEmptyWindow: previous?.hadNonEmptyPage === true && rows.length === 0,
    latencyMs,
    error: fetchError,
    fieldSummary: summarizeFields(rows)
  };

  const fileName = `${String(requestIndex + 1).padStart(3, "0")}_${sanitizeFileName(request.label)}.json`;
  result.rawFile = path.join(runDir, fileName);
  await writeFile(result.rawFile, rawText, "utf8");

  return result;
}

async function buildProbeErrorResult(
  config: Config,
  runDir: string,
  request: ProbeRequest,
  requestIndex: number,
  error: unknown
): Promise<ProbeResult> {
  const url = buildUrl(config, request);
  const keySlot = config.apiKeySlots[requestIndex % config.apiKeySlots.length];
  const message = errorMessage(error);
  const rawText = JSON.stringify({ error: message });
  const rawResponseHash = hashText(rawText);
  const fileName = `${String(requestIndex + 1).padStart(3, "0")}_${sanitizeFileName(request.label)}.json`;
  const rawFile = path.join(runDir, fileName);
  await writeFile(rawFile, rawText, "utf8");

  return {
    label: request.label,
    kind: request.kind,
    sequence: request.sequence,
    url: redactUrl(url).toString(),
    rawFile,
    apiKeyLabel: keySlot.label,
    apiKeyGroup: keySlot.groupId,
    httpStatus: 0,
    actualRows: 0,
    total: null,
    rangeTotal: null,
    rawResponseHash,
    canonicalTransferHash: hashText("[]"),
    oldestTimestamp: null,
    newestTimestamp: null,
    oldestBlockNumber: null,
    newestBlockNumber: null,
    duplicateTransferIds: [],
    sameTimestampBoundaryCount: 0,
    sameBlockBoundaryCount: 0,
    knownRowKind: request.knownRowKind ?? null,
    expectedTxId: request.expectedTxId ?? null,
    expectedTxIdRows: request.expectedTxId ? 0 : null,
    emptyPageAfterNonEmptyWindow: false,
    latencyMs: 0,
    error: message,
    fieldSummary: emptyFieldSummary()
  };
}

function emptyFieldSummary(): FieldSummary {
  return {
    eventIndexRows: 0,
    logIndexRows: 0,
    ordinalFallbackRows: 0,
    eventTypes: [],
    confirmedValues: [],
    contractRetValues: [],
    finalResultValues: [],
    revertValues: [],
    riskTransactionValues: [],
    multipleTransferTransactionCount: 0,
    indistinguishableTransferGroups: 0
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}

function parseJson(rawText: string): unknown {
  try {
    return JSON.parse(rawText);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function transferRows(json: unknown): Record<string, unknown>[] {
  const candidates = Array.isArray(json)
    ? json
    : isRecord(json)
      ? [json.data, json.token_transfers, json.transfers, json.rows]
      : [];
  const rows = candidates.find(Array.isArray) ?? [];
  return rows.filter(isRecord);
}

function topLevelInteger(json: unknown, field: string): number | null {
  if (!isRecord(json)) return null;
  return integerField(json[field]);
}

function integerField(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function stringField(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return null;
}

function nestedRecord(row: Record<string, unknown>, field: string): Record<string, unknown> | null {
  return isRecord(row[field]) ? row[field] : null;
}

function transferTimestamp(row: Record<string, unknown>): number | null {
  return integerField(
    row.block_ts
      ?? row.block_timestamp
      ?? row.blockTimestamp
      ?? row.timestamp
      ?? row.date_created
      ?? row.time
  );
}

function transferBlockNumber(row: Record<string, unknown>): number | null {
  return integerField(
    row.block
      ?? row.blockNumber
      ?? row.block_number
      ?? row.blockNum
      ?? row.block_num
      ?? row.blockId
      ?? row.block_id
  );
}

function transferTxId(row: Record<string, unknown>): string {
  return stablePart(row.transaction_id ?? row.transactionId ?? row.transactionHash ?? row.hash ?? row.txID);
}

function transferFrom(row: Record<string, unknown>): string {
  return stablePart(row.from_address ?? row.fromAddress ?? row.from);
}

function transferTo(row: Record<string, unknown>): string {
  return stablePart(row.to_address ?? row.toAddress ?? row.to);
}

function transferAmount(row: Record<string, unknown>): string {
  return stablePart(row.quant ?? row.amount_str ?? row.amount ?? row.value);
}

function transferContract(row: Record<string, unknown>): string {
  const tokenInfo = nestedRecord(row, "tokenInfo") ?? nestedRecord(row, "token_info");
  return stablePart(row.contract_address ?? row.contractAddress ?? tokenInfo?.tokenId ?? tokenInfo?.address);
}

function transferEventIndex(row: Record<string, unknown>): string {
  return stablePart(row.event_index ?? row.eventIndex ?? row.event_id ?? row.eventId);
}

function transferLogIndex(row: Record<string, unknown>): string {
  return stablePart(row.log_index ?? row.logIndex);
}

function baseTransferId(row: Record<string, unknown>): string {
  return [
    transferTxId(row),
    transferFrom(row),
    transferTo(row),
    transferAmount(row),
    transferContract(row),
    stablePart(transferTimestamp(row))
  ].join(":");
}

function canonicalTransfer(row: Record<string, unknown>, index: number): Record<string, string> {
  const eventIndex = transferEventIndex(row);
  const logIndex = transferLogIndex(row);
  return {
    transaction_id: transferTxId(row),
    from_address: transferFrom(row),
    to_address: transferTo(row),
    amount_raw: transferAmount(row),
    contract_address: transferContract(row),
    timestamp: stablePart(transferTimestamp(row)),
    event_index: eventIndex,
    log_index: logIndex,
    ordinal_fallback: eventIndex || logIndex ? "" : String(index)
  };
}

function stablePart(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function duplicateIds(ids: string[]): string[] {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id);
}

function summarizeFields(rows: Record<string, unknown>[]): FieldSummary {
  const txCounts = new Map<string, number>();
  const fallbackCounts = new Map<string, number>();
  for (const row of rows) {
    const txId = transferTxId(row);
    if (txId) txCounts.set(txId, (txCounts.get(txId) ?? 0) + 1);
    const eventIndex = transferEventIndex(row);
    const logIndex = transferLogIndex(row);
    if (!eventIndex && !logIndex) {
      const baseId = baseTransferId(row);
      fallbackCounts.set(baseId, (fallbackCounts.get(baseId) ?? 0) + 1);
    }
  }

  return {
    eventIndexRows: rows.filter((row) => transferEventIndex(row) !== "").length,
    logIndexRows: rows.filter((row) => transferLogIndex(row) !== "").length,
    ordinalFallbackRows: rows.filter((row) => transferEventIndex(row) === "" && transferLogIndex(row) === "").length,
    eventTypes: uniqueValues(rows.map((row) => row.event_type ?? row.eventType ?? row.event_name ?? row.eventName)),
    confirmedValues: uniqueValues(rows.map((row) => row.confirmed)),
    contractRetValues: uniqueValues(rows.map((row) => row.contractRet ?? row.contract_ret)),
    finalResultValues: uniqueValues(rows.map((row) => row.finalResult ?? row.final_result)),
    revertValues: uniqueValues(rows.map((row) => row.revert)),
    riskTransactionValues: uniqueValues(rows.map((row) => row.riskTransaction ?? row.risk_transaction)),
    multipleTransferTransactionCount: [...txCounts.values()].filter((count) => count > 1).length,
    indistinguishableTransferGroups: [...fallbackCounts.values()].filter((count) => count > 1).length
  };
}

function uniqueValues(values: unknown[]): string[] {
  return [...new Set(values.map(stringField).filter((value): value is string => value !== null))].sort();
}

function redactUrl(url: URL): URL {
  const copy = new URL(url.toString());
  return copy;
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 120);
}

function timestampIso(value: number | null): string {
  return value === null ? "" : new Date(value).toISOString();
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runWallClockCadence<T>(options: WallClockCadenceOptions<T>): Promise<PromiseSettledResult<void>[]> {
  if (!Number.isFinite(options.targetRps) || options.targetRps <= 0) {
    throw new Error("targetRps must be a positive number");
  }
  if (!Number.isSafeInteger(options.maxConcurrency) || options.maxConcurrency < 1) {
    throw new Error("maxConcurrency must be a positive safe integer");
  }

  const now = options.now ?? (() => performance.now());
  const delay = options.sleep ?? sleep;
  const startedAt = now();
  const intervalMs = 1000 / options.targetRps;
  const active = new Set<Promise<void>>();
  const runs: Promise<void>[] = [];

  for (let i = 0; i < options.items.length; i += 1) {
    const dueAt = startedAt + i * intervalMs;
    await delay(Math.max(0, dueAt - now()));

    while (active.size >= options.maxConcurrency) {
      await Promise.race(active);
    }

    let run: Promise<void>;
    try {
      run = options.runItem(options.items[i], i);
    } catch (error) {
      run = Promise.reject(error);
    }
    let activeRun: Promise<void>;
    activeRun = run.then(() => undefined, () => undefined).finally(() => active.delete(activeRun));
    active.add(activeRun);
    runs.push(run);
  }

  return Promise.allSettled(runs);
}

function nextPreviousState(current: PreviousSequenceResult | undefined, result: ProbeResult): PreviousSequenceResult {
  return {
    hadNonEmptyPage: current?.hadNonEmptyPage === true || result.actualRows > 0,
    oldestTimestamp: result.oldestTimestamp ?? current?.oldestTimestamp ?? null,
    oldestBlockNumber: result.oldestBlockNumber ?? current?.oldestBlockNumber ?? null
  };
}

function resolveRpsRampMaxConcurrency(targetRps: number, configuredMaxConcurrency: number | null, requestCount: number): number {
  const derivedMaxConcurrency = Math.max(1, Math.ceil(targetRps * 2));
  const requestedMaxConcurrency = configuredMaxConcurrency ?? derivedMaxConcurrency;
  return Math.max(1, Math.min(requestCount, requestedMaxConcurrency));
}

function logProbeResult(result: ProbeResult): void {
  console.log(`${result.label}: status=${result.httpStatus} rows=${result.actualRows} rangeTotal=${result.rangeTotal ?? ""} latency_ms=${Math.round(result.latencyMs)}`);
}

async function runRequests(config: Config, runDir: string, requests: ProbeRequest[]): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  const previousBySequence = new Map<string, PreviousSequenceResult>();

  for (let i = 0; i < requests.length;) {
    const request = requests[i];
    if (request.kind === "rps_ramp" && request.targetRps !== undefined) {
      const rampRequests = collectRpsRampTargetRequests(requests, i);
      const rampResults = await runRpsRampTarget(config, runDir, rampRequests, i, previousBySequence);
      for (const result of rampResults) {
        results.push(result);
        const previous = previousBySequence.get(result.sequence);
        previousBySequence.set(result.sequence, nextPreviousState(previous, result));
        logProbeResult(result);
      }
      i += rampRequests.length;
      continue;
    }

    if (i > 0) {
      await sleep(config.requestSpacingMs);
    }

    const previous = previousBySequence.get(request.sequence);
    const result = await runProbe(config, runDir, request, i, previous);
    results.push(result);
    previousBySequence.set(request.sequence, nextPreviousState(previous, result));
    logProbeResult(result);
    i += 1;
  }

  return results;
}

function collectRpsRampTargetRequests(requests: ProbeRequest[], startIndex: number): ProbeRequest[] {
  const targetRps = requests[startIndex].targetRps;
  const rampRequests: ProbeRequest[] = [];
  for (let i = startIndex; i < requests.length; i += 1) {
    const request = requests[i];
    if (request.kind !== "rps_ramp" || request.targetRps !== targetRps) break;
    rampRequests.push(request);
  }
  return rampRequests;
}

async function runRpsRampTarget(
  config: Config,
  runDir: string,
  requests: ProbeRequest[],
  firstRequestIndex: number,
  previousBySequence: Map<string, PreviousSequenceResult>
): Promise<ProbeResult[]> {
  const targetRps = requests[0]?.targetRps;
  if (targetRps === undefined) return [];

  const maxConcurrency = resolveRpsRampMaxConcurrency(targetRps, config.rpsRampMaxConcurrency, requests.length);
  const results = new Map<number, ProbeResult>();
  console.log(`${requests[0].sequence}: target_rps=${targetRps} requests=${requests.length} max_concurrency=${maxConcurrency}`);

  const settled = await runWallClockCadence({
    items: requests,
    targetRps,
    maxConcurrency,
    runItem: async (request, offset) => {
      const requestIndex = firstRequestIndex + offset;
      const previous = previousBySequence.get(request.sequence);
      results.set(offset, await runProbe(config, runDir, request, requestIndex, previous));
    }
  });

  return Promise.all(settled.map(async (result, offset) => {
    if (result.status === "fulfilled") {
      return results.get(offset) ?? buildProbeErrorResult(config, runDir, requests[offset], firstRequestIndex + offset, new Error("Ramp request finished without a result"));
    }
    return buildProbeErrorResult(config, runDir, requests[offset], firstRequestIndex + offset, result.reason);
  }));
}

async function runEndWalkAndBoundary(config: Config, runDir: string, initialResults: ProbeResult[]): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  const seed = initialResults.find((result) => result.label === "offset_start_0" && result.oldestTimestamp !== null);
  if (!seed || seed.oldestTimestamp === null) return results;

  let requestIndex = initialResults.length;
  let endTimestamp = seed.oldestTimestamp;
  let previous: PreviousSequenceResult | undefined;

  for (let i = 0; i < config.endWalkPages; i += 1) {
    await sleep(config.requestSpacingMs);
    const request: ProbeRequest = {
      kind: "end_walk",
      label: `end_walk_${i + 1}_end_${endTimestamp}`,
      sequence: "end_walk",
      address: config.address,
      direction: config.direction,
      start: 0,
      limit: config.limit,
      startTimestamp: config.startTimestamp,
      endTimestamp
    };
    const result = await runProbe(config, runDir, request, requestIndex, previous);
    requestIndex += 1;
    results.push(result);
    console.log(`${result.label}: status=${result.httpStatus} rows=${result.actualRows} rangeTotal=${result.rangeTotal ?? ""} latency_ms=${Math.round(result.latencyMs)}`);

    const nextEndTimestamp = result.oldestTimestamp;
    previous = nextPreviousState(previous, result);
    if (nextEndTimestamp === null) break;
    if (nextEndTimestamp >= endTimestamp) {
      // ponytail: stop instead of inventing a tie-breaker; upgrade path is timestamp+transfer_id pagination.
      break;
    }
    endTimestamp = nextEndTimestamp;
  }

  const boundaryTimestamp = seed.oldestTimestamp;
  previous = undefined;
  for (let i = 0; i < config.boundaryPages; i += 1) {
    await sleep(config.requestSpacingMs);
    const start = i * config.limit;
    const request: ProbeRequest = {
      kind: "same_timestamp_boundary",
      label: `same_timestamp_boundary_start_${start}`,
      sequence: "same_timestamp_boundary",
      address: config.address,
      direction: config.direction,
      start,
      limit: config.limit,
      startTimestamp: boundaryTimestamp,
      endTimestamp: boundaryTimestamp
    };
    const result = await runProbe(config, runDir, request, requestIndex, previous);
    requestIndex += 1;
    results.push(result);
    previous = nextPreviousState(previous, result);
    console.log(`${result.label}: status=${result.httpStatus} rows=${result.actualRows} rangeTotal=${result.rangeTotal ?? ""} latency_ms=${Math.round(result.latencyMs)}`);
    if (result.actualRows === 0) break;
  }

  return results;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}

function statusBucket(status: number): "429" | "403" | "5xx" | null {
  if (status === 429) return "429";
  if (status === 403) return "403";
  if (status >= 500 && status <= 599) return "5xx";
  return null;
}

function formatNullable(value: number | null): string {
  return value === null ? "" : String(value);
}

function markdownEscape(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function buildMarkdownSummary(config: Config, runDir: string, results: ProbeResult[]): string {
  const latencies = results.map((result) => result.latencyMs);
  const p50 = percentile(latencies, 0.5);
  const p95 = percentile(latencies, 0.95);
  const errorCounts = new Map<string, number>();
  for (const result of results) {
    const bucket = statusBucket(result.httpStatus);
    if (!bucket) continue;
    const key = `${result.apiKeyGroup}/${result.apiKeyLabel}/${bucket}`;
    errorCounts.set(key, (errorCounts.get(key) ?? 0) + 1);
  }

  const repeatResults = results.filter((result) => result.sequence === "repeat_start_0");
  const repeatRawHashCount = new Set(repeatResults.map((result) => result.rawResponseHash)).size;
  const repeatCanonicalHashCount = new Set(repeatResults.map((result) => result.canonicalTransferHash)).size;
  const fieldRows = results.flatMap((result) => result.fieldSummary);
  const eventIndexRows = fieldRows.reduce((sum, item) => sum + item.eventIndexRows, 0);
  const logIndexRows = fieldRows.reduce((sum, item) => sum + item.logIndexRows, 0);
  const ordinalFallbackRows = fieldRows.reduce((sum, item) => sum + item.ordinalFallbackRows, 0);
  const multipleTransferTransactionCount = fieldRows.reduce((sum, item) => sum + item.multipleTransferTransactionCount, 0);
  const indistinguishableTransferGroups = fieldRows.reduce((sum, item) => sum + item.indistinguishableTransferGroups, 0);
  const eventTypes = uniqueSorted(fieldRows.flatMap((item) => item.eventTypes));
  const confirmedValues = uniqueSorted(fieldRows.flatMap((item) => item.confirmedValues));
  const contractRetValues = uniqueSorted(fieldRows.flatMap((item) => item.contractRetValues));
  const finalResultValues = uniqueSorted(fieldRows.flatMap((item) => item.finalResultValues));
  const revertValues = uniqueSorted(fieldRows.flatMap((item) => item.revertValues));
  const riskTransactionValues = uniqueSorted(fieldRows.flatMap((item) => item.riskTransactionValues));
  const sameTimestampBoundaryTotal = results.reduce((sum, result) => sum + result.sameTimestampBoundaryCount, 0);
  const sameBlockBoundaryTotal = results.reduce((sum, result) => sum + result.sameBlockBoundaryCount, 0);
  const knownRowResults = results.filter((result) => result.knownRowKind !== null);
  const incomingCost = results.filter((result) => result.sequence === "incoming_cost");

  const lines = [
    "# TronScan USDT Pagination Probe Summary",
    "",
    `Run directory: \`${markdownEscape(runDir)}\``,
    `Generated at: ${new Date().toISOString()}`,
    "",
    "## Config",
    "",
    `- endpoint: \`${config.baseUrl.origin}/api/token_trc20/transfers\``,
    `- address: \`${config.address}\``,
    `- direction: \`${config.direction}\``,
    `- token contract: \`${TRON_USDT_CONTRACT_ADDRESS}\``,
    `- limit: \`${config.limit}\``,
    `- start_timestamp: \`${config.startTimestamp}\` (${timestampIso(config.startTimestamp)})`,
    `- end_timestamp: \`${config.endTimestamp}\` (${timestampIso(config.endTimestamp)})`,
    `- api key slots: \`${config.apiKeySlots.length}\``,
    `- rps ramp max concurrency: \`${config.rpsRampMaxConcurrency ?? "derived"}\``,
    `- known row probes: \`${config.knownRowProbes.length}\``,
    `- dry_run: \`${config.dryRun}\``,
    "",
    "## Latency",
    "",
    `- p50 latency ms: \`${p50 === null ? "" : Math.round(p50)}\``,
    `- p95 latency ms: \`${p95 === null ? "" : Math.round(p95)}\``,
    "",
    "## Boundary Coverage",
    "",
    `- same timestamp boundary rows: \`${sameTimestampBoundaryTotal}\``,
    `- same block boundary rows: \`${sameBlockBoundaryTotal}\``,
    "",
    "## Pages",
    "",
    "| label | status | rows | total | rangeTotal | raw_response_hash | canonical_transfer_hash | oldest_timestamp | newest_timestamp | oldest_block_number | newest_block_number | duplicate_transfer_ids | same_timestamp_boundary_count | same_block_boundary_count | known_row_kind | expected_tx_id_rows | empty_after_non_empty | key/group | latency_ms |",
    "| --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- | --- | ---: |",
    ...results.map((result) => [
      markdownEscape(result.label),
      String(result.httpStatus),
      String(result.actualRows),
      formatNullable(result.total),
      formatNullable(result.rangeTotal),
      result.rawResponseHash.slice(0, 16),
      result.canonicalTransferHash.slice(0, 16),
      timestampIso(result.oldestTimestamp),
      timestampIso(result.newestTimestamp),
      formatNullable(result.oldestBlockNumber),
      formatNullable(result.newestBlockNumber),
      String(result.duplicateTransferIds.length),
      String(result.sameTimestampBoundaryCount),
      String(result.sameBlockBoundaryCount),
      result.knownRowKind ?? "",
      formatNullable(result.expectedTxIdRows),
      String(result.emptyPageAfterNonEmptyWindow),
      markdownEscape(`${result.apiKeyGroup}/${result.apiKeyLabel}`),
      String(Math.round(result.latencyMs))
    ].join(" | ")).map((row) => `| ${row} |`),
    "",
    "## 429/403/5xx Counts By Key/Group",
    "",
    errorCounts.size === 0 ? "- none" : "",
    ...[...errorCounts.entries()].map(([key, count]) => `- \`${key}\`: ${count}`),
    "",
    "## Repeated Page Stability",
    "",
    `- repeated page fetches: \`${repeatResults.length}\``,
    `- unique raw_response_hash values: \`${repeatRawHashCount}\``,
    `- unique canonical_transfer_hash values: \`${repeatCanonicalHashCount}\``,
    "",
    "## Transfer Field Shape",
    "",
    `- rows with event_index/eventIndex: \`${eventIndexRows}\``,
    `- rows with log_index/logIndex: \`${logIndexRows}\``,
    `- rows requiring ordinal fallback: \`${ordinalFallbackRows}\``,
    `- transactions with multiple sampled rows: \`${multipleTransferTransactionCount}\``,
    `- indistinguishable fallback groups: \`${indistinguishableTransferGroups}\``,
    `- event_type values: \`${eventTypes.join(", ")}\``,
    `- confirmed values: \`${confirmedValues.join(", ")}\``,
    `- contractRet values: \`${contractRetValues.join(", ")}\``,
    `- finalResult values: \`${finalResultValues.join(", ")}\``,
    `- revert values: \`${revertValues.join(", ")}\``,
    `- riskTransaction values: \`${riskTransactionValues.join(", ")}\``,
    "",
    "## Dedicated Known Row Probes",
    "",
    knownRowResults.length === 0
      ? "- not run; supply --known-failed-row, --known-reverted-row, or --known-approval-row."
      : knownRowResults.map((result) => `- ${result.label}: kind=${result.knownRowKind}, rows=${result.actualRows}, expected_tx_id=${result.expectedTxId ?? ""}, expected_tx_id_rows=${formatNullable(result.expectedTxIdRows)}, event_type=${result.fieldSummary.eventTypes.join(", ")}, confirmed=${result.fieldSummary.confirmedValues.join(", ")}, contractRet=${result.fieldSummary.contractRetValues.join(", ")}, finalResult=${result.fieldSummary.finalResultValues.join(", ")}, revert=${result.fieldSummary.revertValues.join(", ")}, riskTransaction=${result.fieldSummary.riskTransactionValues.join(", ")}`).join("\n"),
    "",
    "## Incoming Cost Comparison",
    "",
    incomingCost.length === 0
      ? "- not run; supply --incoming-address, --incoming-min-timestamp, and --incoming-max-timestamp."
      : incomingCost.map((result) => `- ${result.label}: rows=${result.actualRows}, total=${formatNullable(result.total)}, rangeTotal=${formatNullable(result.rangeTotal)}, latency_ms=${Math.round(result.latencyMs)}`).join("\n"),
    "",
    "## Raw Files",
    "",
    ...results.map((result) => `- ${result.label}: \`${path.relative(runDir, result.rawFile)}\``)
  ];

  return lines.filter((line) => line !== "").join("\n") + "\n";
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function buildJsonSummary(config: Config, runDir: string, results: ProbeResult[]): string {
  return JSON.stringify({
    generated_at: new Date().toISOString(),
    run_dir: runDir,
    endpoint: `${config.baseUrl.origin}/api/token_trc20/transfers`,
    address: config.address,
    direction: config.direction,
    limit: config.limit,
    start_timestamp: config.startTimestamp,
    end_timestamp: config.endTimestamp,
    api_key_slots: config.apiKeySlots.length,
    rps_ramp_max_concurrency: config.rpsRampMaxConcurrency,
    known_row_probes: config.knownRowProbes.map((probe) => ({
      row_kind: probe.rowKind,
      address: probe.address,
      direction: probe.direction,
      start: probe.start,
      limit: probe.limit,
      start_timestamp: probe.startTimestamp,
      end_timestamp: probe.endTimestamp,
      expected_tx_id: probe.expectedTxId
    })),
    dry_run: config.dryRun,
    p50_latency_ms: percentile(results.map((result) => result.latencyMs), 0.5),
    p95_latency_ms: percentile(results.map((result) => result.latencyMs), 0.95),
    same_timestamp_boundary_count: results.reduce((sum, result) => sum + result.sameTimestampBoundaryCount, 0),
    same_block_boundary_count: results.reduce((sum, result) => sum + result.sameBlockBoundaryCount, 0),
    results: results.map((result) => ({
      label: result.label,
      kind: result.kind,
      sequence: result.sequence,
      url: result.url,
      raw_file: path.relative(runDir, result.rawFile),
      http_status: result.httpStatus,
      actual_rows: result.actualRows,
      total: result.total,
      rangeTotal: result.rangeTotal,
      raw_response_hash: result.rawResponseHash,
      canonical_transfer_hash: result.canonicalTransferHash,
      oldest_timestamp: result.oldestTimestamp,
      newest_timestamp: result.newestTimestamp,
      oldest_block_number: result.oldestBlockNumber,
      newest_block_number: result.newestBlockNumber,
      duplicate_transfer_ids: result.duplicateTransferIds,
      same_timestamp_boundary_count: result.sameTimestampBoundaryCount,
      same_block_boundary_count: result.sameBlockBoundaryCount,
      known_row_kind: result.knownRowKind,
      expected_tx_id: result.expectedTxId,
      expected_tx_id_rows: result.expectedTxIdRows,
      empty_page_after_non_empty_window: result.emptyPageAfterNonEmptyWindow,
      api_key_label: result.apiKeyLabel,
      api_key_group: result.apiKeyGroup,
      latency_ms: result.latencyMs,
      error: result.error,
      field_summary: result.fieldSummary
    }))
  }, null, 2);
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.resolve(config.outDir, runId);
  await mkdir(runDir, { recursive: true });

  const initialRequests = buildInitialRequests(config);
  const initialResults = await runRequests(config, runDir, initialRequests);
  const walkResults = config.dryRun ? [] : await runEndWalkAndBoundary(config, runDir, initialResults);
  const results = [...initialResults, ...walkResults];

  await writeFile(path.join(runDir, "summary.md"), buildMarkdownSummary(config, runDir, results), "utf8");
  await writeFile(path.join(runDir, "summary.json"), buildJsonSummary(config, runDir, results), "utf8");

  console.log(`summary=${path.join(runDir, "summary.md")}`);
}

function isMainModule(): boolean {
  return process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  await main().catch((error) => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  });
}
