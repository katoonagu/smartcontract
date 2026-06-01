import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { URL } from "node:url";
import { authorizeAdminRequest } from "./adminAuth";
import { adminConsoleHtml } from "./adminConsole";
import { projectForensicJobGraph } from "./forensicsGraph";
import type { ForensicCheckJob, ListAdminForensicCheckJobsInput } from "../storage/repositories";

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

function parseNonNegativeInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseListJobsInput(url: URL): ListAdminForensicCheckJobsInput {
  return {
    limit: parseNonNegativeInteger(firstQueryValue(url, "limit")),
    offset: parseNonNegativeInteger(firstQueryValue(url, "offset")),
    status: firstQueryValue(url, "status") as ListAdminForensicCheckJobsInput["status"],
    kind: firstQueryValue(url, "kind") as ListAdminForensicCheckJobsInput["kind"],
    subjectAddress: firstQueryValue(url, "subjectAddress")
  };
}

function forensicJobApiMatch(pathname: string): { id: string; action: "graph" | "raw" } | null {
  const match = /^\/admin\/api\/forensic-jobs\/([^/]+)\/(graph|raw)$/.exec(pathname);
  if (!match) return null;
  return {
    id: decodeURIComponent(match[1]),
    action: match[2] as "graph" | "raw"
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
    const jobs = await deps.listJobs(parseListJobsInput(url));
    writeJson(response, 200, { jobs });
    return;
  }

  const jobMatch = forensicJobApiMatch(url.pathname);
  if (jobMatch) {
    const job = await deps.getJob(jobMatch.id);
    if (!job) {
      writeJson(response, 404, { error: "Forensic job not found." });
      return;
    }

    if (jobMatch.action === "raw") {
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
