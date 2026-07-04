import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { URL } from "node:url";
import { authorizeAdminRequest } from "./adminAuth";
import { adminConsoleHtml } from "./adminConsole";
import { projectForensicJobGraph, type AdminForensicsGraph, type AdminForensicsNode } from "./forensicsGraph";
import { buildScoringAuditReport } from "../forensics/scoringAuditReport";
import { buildScoringAuditRow } from "../risk/scoringAudit";
import type {
  ForensicCheckJob,
  ForensicCheckJobKind,
  ForensicCheckJobStatus,
  ListAdminForensicCheckJobsInput,
  SavedWalletRiskSummary
} from "../storage/repositories";
import type { IndexedTronUsdtTransfer } from "../types";

export type AdminServerConfig = {
  host: string;
  port: number;
  token: string | null;
};

export type AdminServerDeps = {
  config: AdminServerConfig;
  listJobs(input: ListAdminForensicCheckJobsInput): Promise<ForensicCheckJob[]>;
  getJob(id: string): Promise<ForensicCheckJob | null>;
  createStrictProvenanceBenchmarkJob?(input: {
    subjectAddress: string;
  }): Promise<ForensicCheckJob>;
  getTargetedHistoryProgressForJob?(jobId: string): Promise<Record<string, unknown> | null>;
  listIndexedUsdtTransfersByHashes?(txHashes: string[]): Promise<IndexedTronUsdtTransfer[]>;
  findLatestSavedWalletRiskByAddresses?(addresses: string[]): Promise<Map<string, SavedWalletRiskSummary>>;
  refreshDeepCheckSecondLayer?(jobId: string): Promise<unknown>;
};

export type RunningAdminServer = {
  url: string;
  close(): Promise<void>;
};

type JsonBody = Record<string, unknown>;
type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

type AdminForensicJobSummary = Pick<
  ForensicCheckJob,
  | "id"
  | "kind"
  | "subjectAddress"
  | "status"
  | "windowStart"
  | "windowEnd"
  | "priority"
  | "lastError"
  | "createdAt"
  | "updatedAt"
  | "startedAt"
  | "completedAt"
> & {
  depositTxHash?: string;
  watchedWallet?: string;
  sender?: string;
  jobPhase?: string;
  targetedIndex?: Record<string, unknown>;
  targetedHistory?: Record<string, unknown>;
};

const forensicCheckJobStatuses = new Set<ForensicCheckJobStatus>([
  "queued",
  "running",
  "partial",
  "completed",
  "failed",
  "cancelled"
]);
const forensicCheckJobKinds = new Set<ForensicCheckJobKind>([
  "address_fast_check",
  "address_deep_check",
  "where_is_money_check",
  "incoming_deposit_check"
]);
const nodeRoleAssetUrls = new Map<string, URL>([
  ["drainer", new URL("./assets/node-role/drainer.png", import.meta.url)],
  ["victim", new URL("./assets/node-role/victim.png", import.meta.url)],
  ["mule-transit", new URL("./assets/node-role/mule-transit.png", import.meta.url)],
  ["collector", new URL("./assets/node-role/collector.png", import.meta.url)]
]);
const tronAddressPattern = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

function writeJson(response: ServerResponse, statusCode: number, body: JsonBody): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(body));
}

function writeHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(html);
}

function writeRedirect(response: ServerResponse, location: string): void {
  response.writeHead(302, {
    location,
    "cache-control": "no-store"
  });
  response.end();
}

async function writeNodeRoleAsset(response: ServerResponse, pathname: string): Promise<boolean> {
  const match = /^\/admin\/assets\/node-role\/([a-z-]+)\.png$/.exec(pathname);
  if (!match) return false;

  const assetUrl = nodeRoleAssetUrls.get(match[1]);
  if (!assetUrl) {
    writeJson(response, 404, { error: "Admin asset not found." });
    return true;
  }

  const body = await readFile(assetUrl);
  response.writeHead(200, {
    "content-type": "image/png",
    "cache-control": "public, max-age=86400"
  });
  response.end(body);
  return true;
}

function firstQueryValue(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key);
  return value && value.length > 0 ? value : undefined;
}

function parseNonNegativeInteger(value: string | undefined, label: "limit" | "offset"): ParseResult<number | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed >= 0) {
    return { ok: true, value: parsed };
  }
  return { ok: false, message: `Invalid forensic job ${label}.` };
}

function parseStatus(value: string | undefined): ParseResult<ForensicCheckJobStatus | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (forensicCheckJobStatuses.has(value as ForensicCheckJobStatus)) {
    return { ok: true, value: value as ForensicCheckJobStatus };
  }
  return { ok: false, message: "Invalid forensic job status filter." };
}

function parseKind(value: string | undefined): ParseResult<ForensicCheckJobKind | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (forensicCheckJobKinds.has(value as ForensicCheckJobKind)) {
    return { ok: true, value: value as ForensicCheckJobKind };
  }
  return { ok: false, message: "Invalid forensic job kind filter." };
}

function parseListJobsInput(url: URL): ParseResult<ListAdminForensicCheckJobsInput> {
  const limit = parseNonNegativeInteger(firstQueryValue(url, "limit"), "limit");
  if (!limit.ok) return limit;
  const offset = parseNonNegativeInteger(firstQueryValue(url, "offset"), "offset");
  if (!offset.ok) return offset;
  const status = parseStatus(firstQueryValue(url, "status"));
  if (!status.ok) return status;
  const kind = parseKind(firstQueryValue(url, "kind"));
  if (!kind.ok) return kind;

  const input: ListAdminForensicCheckJobsInput = {
    limit: limit.value,
    offset: offset.value,
    status: status.value,
    kind: kind.value,
    subjectAddress: firstQueryValue(url, "subjectAddress")
  };
  const query = firstQueryValue(url, "query") ?? firstQueryValue(url, "q");
  if (query) input.query = query;
  return { ok: true, value: input };
}

function stringProgressField(job: ForensicCheckJob, key: string): string | undefined {
  const value = job.progressJson[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function recordProgressField(job: ForensicCheckJob, key: string): Record<string, unknown> | undefined {
  const value = job.progressJson[key];
  return isRecord(value) ? value : undefined;
}

function safeDecodeUriComponent(value: string): ParseResult<string> {
  try {
    return { ok: true, value: decodeURIComponent(value) };
  } catch {
    return { ok: false, message: "Invalid forensic job id." };
  }
}

function forensicJobApiMatch(pathname: string): ParseResult<{ id: string; action: "graph" | "raw" | "refresh-second-layer" } | null> {
  const match = /^\/admin\/api\/forensic-jobs\/([^/]+)\/(graph|raw|refresh-second-layer)$/.exec(pathname);
  if (!match) return { ok: true, value: null };
  const id = safeDecodeUriComponent(match[1]);
  if (!id.ok) return id;
  return {
    ok: true,
    value: {
      id: id.value,
      action: match[2] as "graph" | "raw" | "refresh-second-layer"
    }
  };
}

function summarizeForensicJob(job: ForensicCheckJob): AdminForensicJobSummary {
  return {
    id: job.id,
    kind: job.kind,
    subjectAddress: job.subjectAddress,
    status: job.status,
    windowStart: job.windowStart,
    windowEnd: job.windowEnd,
    priority: job.priority,
    lastError: job.lastError,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    depositTxHash: stringProgressField(job, "depositTxHash"),
    watchedWallet: stringProgressField(job, "watchedWallet"),
    sender: stringProgressField(job, "sender"),
    jobPhase: stringProgressField(job, "jobPhase"),
    targetedIndex: recordProgressField(job, "targetedIndex"),
    targetedHistory: recordProgressField(job, "targetedHistory")
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function withTargetedHistoryProgress(
  job: ForensicCheckJob,
  deps: AdminServerDeps
): Promise<ForensicCheckJob> {
  if (!deps.getTargetedHistoryProgressForJob || job.kind !== "where_is_money_check") return job;
  const jobPhase = stringProgressField(job, "jobPhase");
  const targetedPhase = recordProgressField(job, "targetedIndex")?.phase;
  const phase = typeof targetedPhase === "string" && targetedPhase.length > 0 ? targetedPhase : jobPhase;
  if (phase !== "waiting_for_targeted_index" && phase !== "checking_candidate_windows") return job;

  const targetedHistory = await deps.getTargetedHistoryProgressForJob(job.id);
  if (!targetedHistory) return job;
  return {
    ...job,
    progressJson: {
      ...job.progressJson,
      targetedHistory
    }
  };
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  const parsed = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error("JSON body must be an object.");
  return parsed;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function lowerAddress(value: string | null): string {
  return (value ?? "").toLowerCase();
}

function indexedTransferForProfile(
  transfer: IndexedTronUsdtTransfer,
  input: { subjectAddress: string; counterpartyAddress: string; direction: string | null }
): boolean {
  const from = lowerAddress(transfer.fromAddress);
  const to = lowerAddress(transfer.toAddress);
  const subject = lowerAddress(input.subjectAddress);
  const counterparty = lowerAddress(input.counterpartyAddress);
  if (!subject || !counterparty) return false;
  if (input.direction === "inbound") return from === counterparty && to === subject;
  if (input.direction === "outbound") return from === subject && to === counterparty;
  return (from === counterparty && to === subject) || (from === subject && to === counterparty);
}

function directCounterpartyProfileTxHashes(job: ForensicCheckJob): string[] {
  const result = isRecord(job.resultJson) ? job.resultJson : null;
  if (!result) return [];
  const profiles = Array.isArray(result.directCounterpartyInteractionProfiles)
    ? result.directCounterpartyInteractionProfiles
    : [];
  const hashes: string[] = [];
  for (const profile of profiles) {
    if (!isRecord(profile)) continue;
    const storedTransfers = Array.isArray(profile.transfers) ? profile.transfers : [];
    if (storedTransfers.length > 0) continue;
    hashes.push(...stringArrayField(profile, "txHashes"));
  }
  return [...new Set(hashes)];
}

async function enrichDirectCounterpartyTransfers(
  job: ForensicCheckJob,
  deps: AdminServerDeps
): Promise<ForensicCheckJob> {
  const loadTransfers = deps.listIndexedUsdtTransfersByHashes;
  if (!loadTransfers || job.kind !== "address_deep_check") return job;

  const txHashes = directCounterpartyProfileTxHashes(job);
  if (txHashes.length === 0 || !isRecord(job.resultJson)) return job;

  const transfers = await loadTransfers(txHashes);
  if (transfers.length === 0) return job;

  const transfersByHash = new Map<string, IndexedTronUsdtTransfer[]>();
  for (const transfer of transfers) {
    const current = transfersByHash.get(transfer.txHash) ?? [];
    current.push(transfer);
    transfersByHash.set(transfer.txHash, current);
  }

  const result = job.resultJson;
  const subjectAddress = stringField(result.subjectAddress) ?? job.subjectAddress;
  const profiles = Array.isArray(result.directCounterpartyInteractionProfiles)
    ? result.directCounterpartyInteractionProfiles
    : [];
  let changed = false;
  const enrichedProfiles = profiles.map((profile) => {
    if (!isRecord(profile)) return profile;
    if (Array.isArray(profile.transfers) && profile.transfers.length > 0) return profile;
    const counterpartyAddress = stringField(profile.counterpartyAddress) ?? stringField(profile.address);
    if (!counterpartyAddress) return profile;
    const direction = stringField(profile.direction);
    const profileTransfers = stringArrayField(profile, "txHashes").flatMap((txHash) =>
      (transfersByHash.get(txHash) ?? [])
        .filter((transfer) => indexedTransferForProfile(transfer, { subjectAddress, counterpartyAddress, direction }))
        .map((transfer) => ({
          txHash: transfer.txHash,
          fromAddress: transfer.fromAddress,
          toAddress: transfer.toAddress,
          amountRaw: transfer.amountRaw,
          timestamp: transfer.blockTimestamp.toISOString(),
          method: transfer.method,
          edgeType: transfer.method === "transferFrom" ? "transfer_from" : "normal_transfer"
        }))
    );
    if (profileTransfers.length === 0) return profile;
    changed = true;
    return { ...profile, transfers: profileTransfers };
  });

  if (!changed) return job;
  return {
    ...job,
    resultJson: {
      ...result,
      directCounterpartyInteractionProfiles: enrichedProfiles
    }
  };
}

function nodeSavedRiskAddress(node: AdminForensicsNode): string | null {
  return stringField(node.address) ?? stringField(node.metadata?.address);
}

async function enrichSavedWalletRisk(
  graph: AdminForensicsGraph,
  job: ForensicCheckJob,
  deps: AdminServerDeps
): Promise<AdminForensicsGraph> {
  const loadSavedRisk = deps.findLatestSavedWalletRiskByAddresses;
  if (!loadSavedRisk) return graph;

  const subject = job.subjectAddress.toLowerCase();
  const addresses = graph.nodes
    .map(nodeSavedRiskAddress)
    .filter((address): address is string => typeof address === "string" && address.toLowerCase() !== subject);
  const uniqueAddresses = [...new Set(addresses)];
  if (uniqueAddresses.length === 0) return graph;

  const savedRiskByAddress = await loadSavedRisk(uniqueAddresses);
  if (savedRiskByAddress.size === 0) return graph;

  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const address = nodeSavedRiskAddress(node);
      if (!address || address.toLowerCase() === subject) return node;
      const savedWalletRisk = savedRiskByAddress.get(address);
      if (!savedWalletRisk) return node;
      return {
        ...node,
        metadata: {
          ...node.metadata,
          savedWalletRisk
        }
      };
    })
  };
}

async function handleApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  deps: AdminServerDeps
): Promise<void> {
  const auth = authorizeAdminRequest(request.headers.authorization, deps.config.token);
  if (!auth.ok) {
    writeJson(response, auth.statusCode, { error: auth.message });
    return;
  }

  if (url.pathname === "/admin/api/strict-provenance-benchmark") {
    if (request.method !== "POST") {
      writeJson(response, 405, { error: "Method not allowed." });
      return;
    }
    if (!deps.createStrictProvenanceBenchmarkJob) {
      writeJson(response, 501, { error: "Strict provenance benchmark creation is not configured." });
      return;
    }
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(request);
    } catch {
      writeJson(response, 400, { error: "Invalid JSON body." });
      return;
    }
    const subjectAddress = stringField(body.subjectAddress);
    if (!subjectAddress || !tronAddressPattern.test(subjectAddress)) {
      writeJson(response, 400, { error: "Invalid TRON subject address." });
      return;
    }
    const job = await deps.createStrictProvenanceBenchmarkJob({ subjectAddress });
    writeJson(response, 201, { job: summarizeForensicJob(job) });
    return;
  }

  const jobMatch = forensicJobApiMatch(url.pathname);
  if (!jobMatch.ok) {
    writeJson(response, 400, { error: jobMatch.message });
    return;
  }

  if (jobMatch.value?.action === "refresh-second-layer") {
    if (request.method !== "POST") {
      writeJson(response, 405, { error: "Method not allowed." });
      return;
    }
    if (!deps.refreshDeepCheckSecondLayer) {
      writeJson(response, 501, { error: "DeepCheck second-layer refresh is not configured." });
      return;
    }
    const result = await deps.refreshDeepCheckSecondLayer(jobMatch.value.id);
    writeJson(response, 200, { ok: true, result });
    return;
  }

  if (request.method !== "GET") {
    writeJson(response, 405, { error: "Method not allowed." });
    return;
  }

  if (url.pathname === "/admin/api/forensic-jobs") {
    const input = parseListJobsInput(url);
    if (!input.ok) {
      writeJson(response, 400, { error: input.message });
      return;
    }

    const jobs = await deps.listJobs(input.value);
    const enrichedJobs = await Promise.all(jobs.map((job) => withTargetedHistoryProgress(job, deps)));
    writeJson(response, 200, { jobs: enrichedJobs.map(summarizeForensicJob) });
    return;
  }

  if (url.pathname === "/admin/api/scoring-audit") {
    const input = parseListJobsInput(url);
    if (!input.ok) {
      writeJson(response, 400, { error: input.message });
      return;
    }

    const jobs = await deps.listJobs(input.value);
    writeJson(response, 200, {
      report: buildScoringAuditReport(jobs.map(buildScoringAuditRow), new Date())
    });
    return;
  }

  if (jobMatch.value) {
    const loadedJob = await deps.getJob(jobMatch.value.id);
    const job = loadedJob ? await withTargetedHistoryProgress(loadedJob, deps) : null;
    if (!job) {
      writeJson(response, 404, { error: "Forensic job not found." });
      return;
    }

    if (jobMatch.value.action === "raw") {
      writeJson(response, 200, { job });
      return;
    }

    const projection = projectForensicJobGraph(await enrichDirectCounterpartyTransfers(job, deps));
    if (!projection.ok) {
      const statusCode = projection.status === "not_ready"
        ? 409
        : projection.status === "unsupported"
          ? 422
          : 500;
      writeJson(response, statusCode, { error: projection.message });
      return;
    }

    const graph = await enrichSavedWalletRisk(projection.graph, job, deps);
    writeJson(response, 200, { graph });
    return;
  }

  writeJson(response, 404, { error: "Not found." });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  deps: AdminServerDeps
): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);

  if (request.method === "GET" && await writeNodeRoleAsset(response, url.pathname)) {
    return;
  }

  if (url.pathname === "/" || url.pathname === "/admin" || url.pathname === "/admin/") {
    if (request.method !== "GET") {
      writeJson(response, 405, { error: "Method not allowed." });
      return;
    }
    writeRedirect(response, "/admin/forensics");
    return;
  }

  if (url.pathname === "/admin/forensics") {
    if (request.method !== "GET") {
      writeJson(response, 405, { error: "Method not allowed." });
      return;
    }
    writeHtml(response, adminConsoleHtml());
    return;
  }

  if (url.pathname.startsWith("/admin/api/")) {
    await handleApiRequest(request, response, url, deps);
    return;
  }

  writeJson(response, 404, { error: "Not found." });
}

export async function startAdminServer(deps: AdminServerDeps): Promise<RunningAdminServer> {
  const server = createServer((request, response) => {
    handleRequest(request, response, deps).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unexpected admin server error.";
      writeJson(response, 500, { error: message });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(deps.config.port, deps.config.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const host = address.address.includes(":") ? `[${address.address}]` : address.address;
  return {
    url: `http://${host}:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    })
  };
}
