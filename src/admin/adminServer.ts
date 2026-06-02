import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { URL } from "node:url";
import { authorizeAdminRequest } from "./adminAuth";
import { adminConsoleHtml } from "./adminConsole";
import { projectForensicJobGraph } from "./forensicsGraph";
import type {
  ForensicCheckJob,
  ForensicCheckJobKind,
  ForensicCheckJobStatus,
  ListAdminForensicCheckJobsInput
} from "../storage/repositories";

export type AdminServerConfig = {
  host: string;
  port: number;
  token: string | null;
};

export type AdminServerDeps = {
  config: AdminServerConfig;
  listJobs(input: ListAdminForensicCheckJobsInput): Promise<ForensicCheckJob[]>;
  getJob(id: string): Promise<ForensicCheckJob | null>;
};

export type RunningAdminServer = {
  url: string;
  close(): Promise<void>;
};

type JsonBody = Record<string, unknown>;
type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

const forensicCheckJobStatuses = new Set<ForensicCheckJobStatus>([
  "queued",
  "running",
  "partial",
  "completed",
  "failed",
  "cancelled"
]);
const forensicCheckJobKinds = new Set<ForensicCheckJobKind>([
  "address_deep_check",
  "where_is_money_check",
  "incoming_deposit_check"
]);

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

  return { ok: true, value: {
    limit: limit.value,
    offset: offset.value,
    status: status.value,
    kind: kind.value,
    subjectAddress: firstQueryValue(url, "subjectAddress")
  } };
}

function safeDecodeUriComponent(value: string): ParseResult<string> {
  try {
    return { ok: true, value: decodeURIComponent(value) };
  } catch {
    return { ok: false, message: "Invalid forensic job id." };
  }
}

function forensicJobApiMatch(pathname: string): ParseResult<{ id: string; action: "graph" | "raw" } | null> {
  const match = /^\/admin\/api\/forensic-jobs\/([^/]+)\/(graph|raw)$/.exec(pathname);
  if (!match) return { ok: true, value: null };
  const id = safeDecodeUriComponent(match[1]);
  if (!id.ok) return id;
  return {
    ok: true,
    value: {
      id: id.value,
      action: match[2] as "graph" | "raw"
    }
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
    writeJson(response, 200, { jobs });
    return;
  }

  const jobMatch = forensicJobApiMatch(url.pathname);
  if (!jobMatch.ok) {
    writeJson(response, 400, { error: jobMatch.message });
    return;
  }

  if (jobMatch.value) {
    const job = await deps.getJob(jobMatch.value.id);
    if (!job) {
      writeJson(response, 404, { error: "Forensic job not found." });
      return;
    }

    if (jobMatch.value.action === "raw") {
      writeJson(response, 200, { job });
      return;
    }

    const projection = projectForensicJobGraph(job);
    if (!projection.ok) {
      const statusCode = projection.status === "not_ready"
        ? 409
        : projection.status === "unsupported"
          ? 422
          : 500;
      writeJson(response, statusCode, { error: projection.message });
      return;
    }

    writeJson(response, 200, { graph: projection.graph });
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

  if (url.pathname === "/admin/forensics") {
    const auth = authorizeAdminRequest(request.headers.authorization, deps.config.token);
    if (!auth.ok) {
      writeJson(response, auth.statusCode, { error: auth.message });
      return;
    }

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
