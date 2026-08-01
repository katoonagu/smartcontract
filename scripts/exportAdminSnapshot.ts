import dotenv from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { adminConsoleHtml } from "../src/admin/adminConsole";
import { parseAdminSnapshotCliArgs } from "../src/admin/adminSnapshotCliArgs";
import { adminStaticSnapshotHtml, type AdminStaticSnapshotPayload, type AdminStaticSnapshotResponse } from "../src/admin/adminStaticSnapshot";
import { startAdminServer } from "../src/admin/adminServer";
import { closeDb, createDb, type Db } from "../src/storage/db";
import {
  findLatestSavedWalletRiskByAddresses,
  getForensicCheckJob,
  getForensicJobTargetedHistoryProgress,
  getWalletIntelligenceAddressDetail,
  listAdminForensicCheckJobs,
  listIndexedTronUsdtTransfersByHashes,
  listWalletIntelligenceAddressSummaries
} from "../src/storage/repositories";

dotenv.config();
if (process.env.DOTENV_CONFIG_PATH) dotenv.config({ path: process.env.DOTENV_CONFIG_PATH, override: false });
dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env"), override: false });

const snapshotToken = "local-admin-token";
const defaultJobsPath = "/admin/api/forensic-jobs?limit=50";
const defaultWalletIntelligencePath = "/admin/api/wallet-intelligence/addresses?limit=50&minUniqueSubjects=2";
const allWalletIntelligencePath = "/admin/api/wallet-intelligence/addresses?limit=50";

function databaseUrlFromEnvironment(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required. Set it or run with DOTENV_CONFIG_PATH pointing at the project .env.");
  }
  return databaseUrl;
}

function snapshotFileName(now: Date): string {
  return `admin-forensics-snapshot-${now.toISOString().replace(/[:.]/g, "-")}.html`;
}

function encodeQueryValue(value: string): string {
  return encodeURIComponent(value);
}

async function fetchSnapshotResponse(serverUrl: string, path: string): Promise<AdminStaticSnapshotResponse> {
  const response = await fetch(`${serverUrl}${path}`, {
    headers: { Authorization: `Bearer ${snapshotToken}` }
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

function jobsFromResponse(response: AdminStaticSnapshotResponse): Array<Record<string, unknown>> {
  if (response.status !== 200) {
    const message = response.body && typeof response.body === "object" && "error" in response.body
      ? String(response.body.error)
      : "request failed";
    throw new Error(`Admin jobs endpoint failed: ${message}`);
  }
  const body = response.body;
  if (!body || typeof body !== "object" || !Array.isArray((body as { jobs?: unknown }).jobs)) return [];
  return (body as { jobs: Array<Record<string, unknown>> }).jobs;
}

function walletIntelligenceAddressesFromResponse(response: AdminStaticSnapshotResponse): Array<Record<string, unknown>> {
  if (response.status !== 200) return [];
  const body = response.body;
  if (!body || typeof body !== "object" || !Array.isArray((body as { addresses?: unknown }).addresses)) return [];
  return (body as { addresses: Array<Record<string, unknown>> }).addresses;
}

async function collectRoleAssets(): Promise<Record<string, string>> {
  const files = {
    "/admin/assets/node-role/drainer.png": "drainer.png",
    "/admin/assets/node-role/victim.png": "victim.png",
    "/admin/assets/node-role/mule-transit.png": "mule-transit.png",
    "/admin/assets/node-role/collector.png": "collector.png"
  };
  const assets: Record<string, string> = {};
  for (const [path, fileName] of Object.entries(files)) {
    const body = await readFile(new URL(`../src/admin/assets/node-role/${fileName}`, import.meta.url));
    assets[path] = `data:image/png;base64,${body.toString("base64")}`;
  }
  return assets;
}

async function selectedJobsPath(db: Db, args: ReturnType<typeof parseAdminSnapshotCliArgs>): Promise<string> {
  if (args.jobId) {
    const job = await getForensicCheckJob(db, args.jobId);
    if (!job) throw new Error(`Forensic job not found: ${args.jobId}`);
    return `/admin/api/forensic-jobs?query=${encodeQueryValue(args.jobId)}&limit=1`;
  }
  if (args.address) {
    return `/admin/api/forensic-jobs?subjectAddress=${encodeQueryValue(args.address)}&limit=${args.limit}`;
  }
  return `/admin/api/forensic-jobs?limit=${args.limit}`;
}

async function collectStaticApi(db: Db, serverUrl: string, args: ReturnType<typeof parseAdminSnapshotCliArgs>): Promise<Record<string, AdminStaticSnapshotResponse>> {
  const api: Record<string, AdminStaticSnapshotResponse> = {};
  const jobsPath = await selectedJobsPath(db, args);
  const jobsResponse = await fetchSnapshotResponse(serverUrl, jobsPath);
  api[jobsPath] = jobsResponse;

  const jobs = jobsFromResponse(jobsResponse);
  if (jobs.length === 0) throw new Error("No forensic jobs found for the requested snapshot.");
  api[defaultJobsPath] = jobsPath === defaultJobsPath ? jobsResponse : { status: 200, body: { jobs } };

  for (const job of jobs) {
    const id = typeof job.id === "string" ? job.id : "";
    if (!id) continue;
    const graphPath = `/admin/api/forensic-jobs/${encodeQueryValue(id)}/graph`;
    api[graphPath] = await fetchSnapshotResponse(serverUrl, graphPath);
  }

  for (const limit of new Set([50, args.limit])) {
    const auditPath = `/admin/api/scoring-audit?limit=${limit}`;
    api[auditPath] = await fetchSnapshotResponse(serverUrl, auditPath);
  }

  const walletIntelligenceAddresses = new Map<string, Record<string, unknown>>();
  for (const walletIntelligencePath of [defaultWalletIntelligencePath, allWalletIntelligencePath]) {
    const walletIntelligenceResponse = await fetchSnapshotResponse(serverUrl, walletIntelligencePath);
    api[walletIntelligencePath] = walletIntelligenceResponse;
    for (const item of walletIntelligenceAddressesFromResponse(walletIntelligenceResponse)) {
      const address = typeof item.address === "string" ? item.address : "";
      if (address) walletIntelligenceAddresses.set(address, item);
    }
  }
  for (const address of walletIntelligenceAddresses.keys()) {
    const detailPath = `/admin/api/wallet-intelligence/addresses/${encodeQueryValue(address)}`;
    api[detailPath] = await fetchSnapshotResponse(serverUrl, detailPath);
  }

  return api;
}

async function buildSnapshotPayload(db: Db, serverUrl: string, args: ReturnType<typeof parseAdminSnapshotCliArgs>): Promise<AdminStaticSnapshotPayload> {
  const [api, assets] = await Promise.all([
    collectStaticApi(db, serverUrl, args),
    collectRoleAssets()
  ]);
  return {
    generatedAt: new Date().toISOString(),
    api,
    assets
  };
}

async function main(): Promise<void> {
  const args = parseAdminSnapshotCliArgs(process.argv.slice(2));
  const db = createDb(databaseUrlFromEnvironment());
  const server = await startAdminServer({
    config: { host: "127.0.0.1", port: 0, token: snapshotToken },
    listJobs: (input) => listAdminForensicCheckJobs(db, input),
    getJob: (id) => getForensicCheckJob(db, id),
    getTargetedHistoryProgressForJob: (jobId) => getForensicJobTargetedHistoryProgress(db, jobId),
    listIndexedUsdtTransfersByHashes: (txHashes) => listIndexedTronUsdtTransfersByHashes(db, txHashes),
    findLatestSavedWalletRiskByAddresses: (addresses) => findLatestSavedWalletRiskByAddresses(db, addresses),
    listWalletIntelligenceAddressSummaries: (input) => listWalletIntelligenceAddressSummaries(db, input),
    getWalletIntelligenceAddressDetail: (address) => getWalletIntelligenceAddressDetail(db, address)
  });

  try {
    const payload = await buildSnapshotPayload(db, server.url, args);
    const outPath = resolve(args.out ?? join(args.outDir, snapshotFileName(new Date(payload.generatedAt))));
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, `${adminStaticSnapshotHtml(adminConsoleHtml(), payload)}\n`, "utf8");
    console.log(`Snapshot written: ${outPath}`);
    console.log(`Open: ${pathToFileURL(outPath).href}`);
    console.log(`Captured endpoints: ${Object.keys(payload.api).length}`);
  } finally {
    await server.close();
    await closeDb(db);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
