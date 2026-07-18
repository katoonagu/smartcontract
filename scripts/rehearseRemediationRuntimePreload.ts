import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { closeSync, constants as fsConstants, fstatSync, lstatSync, openSync, readSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import { resolve } from "node:path";
import tls from "node:tls";
import { pathToFileURL } from "node:url";

type RuntimeTarget = "candidate" | "previous";

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

function targetUrl(input: FetchInput): URL {
  if (input instanceof URL) return input;
  if (typeof input === "string") return new URL(input);
  return new URL(input.url);
}

function isLoopback(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
}

function bodyRecord(init: FetchInit): Record<string, unknown> {
  if (typeof init?.body !== "string") return {};
  const contentType = new Headers(init.headers).get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const value = JSON.parse(init.body) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }
  return Object.fromEntries(new URLSearchParams(init.body));
}

function telegramMethod(url: URL): string | null {
  if (url.hostname !== "api.telegram.org") return null;
  const match = /^\/bot[^/]+\/([^/]+)$/u.exec(url.pathname);
  return match?.[1] ?? null;
}

type ResponseConstructor = new (body?: string, init?: { status?: number; headers?: Record<string, string> }) => Response;

function telegramResponse(result: unknown, ResponseType: ResponseConstructor): Response {
  return new ResponseType(JSON.stringify({ ok: true, result }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function writeRecorder(path: string, target: RuntimeTarget, text: string): void {
  const maxBytes = 1024 * 1024;
  let previousCount = 0;
  let opened: number | undefined;
  let before: ReturnType<typeof lstatSync> | undefined;
  try {
    before = lstatSync(path);
    if (!before.isFile() || before.isSymbolicLink()) throw new Error("runtime_rehearsal_recorder_not_initialized_regular_file");
    if (before.size > maxBytes) throw new Error("runtime_rehearsal_recorder_too_large");
    opened = openSync(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const openedStat = fstatSync(opened);
    if (!openedStat.isFile() || openedStat.dev !== before.dev || openedStat.ino !== before.ino || openedStat.size !== before.size) {
      throw new Error("runtime_rehearsal_recorder_identity_changed");
    }
    const buffer = Buffer.alloc(Math.min(openedStat.size + 1, maxBytes + 1));
    let offset = 0;
    while (offset < buffer.length) {
      const bytesRead = readSync(opened, buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const afterRead = fstatSync(opened);
    if (afterRead.size > maxBytes) throw new Error("runtime_rehearsal_recorder_too_large");
    if (afterRead.dev !== openedStat.dev || afterRead.ino !== openedStat.ino || afterRead.size !== openedStat.size
        || offset !== afterRead.size) throw new Error("runtime_rehearsal_recorder_identity_changed");
    const previous = JSON.parse(buffer.subarray(0, offset).toString("utf8")) as Record<string, unknown>;
    if (previous.target !== target) throw new Error("runtime_rehearsal_recorder_target_mismatch");
    if (previous.version === "runtime-rehearsal-recorder-v1"
        && Number.isSafeInteger(previous.interceptedSendCount)
        && Number(previous.interceptedSendCount) >= 1) {
      previousCount = Number(previous.interceptedSendCount);
    } else if (previous.version !== "runtime-rehearsal-recorder-pending-v1") {
      throw new Error("runtime_rehearsal_recorder_state_invalid");
    }
  } finally {
    if (opened !== undefined) closeSync(opened);
  }
  const recorder = {
    version: "runtime-rehearsal-recorder-v1",
    target,
    interceptedSendCount: previousCount + 1,
    versionResponseText: text,
    versionResponseSha256: createHash("sha256").update(text, "utf8").digest("hex")
  };
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(recorder), { encoding: "utf8", flag: "wx" });
  try {
    const current = lstatSync(path);
    if (!current.isFile() || current.isSymbolicLink() || !before
        || current.dev !== before.dev || current.ino !== before.ino || current.size !== before.size) {
      throw new Error("runtime_rehearsal_recorder_identity_changed");
    }
    renameSync(temporary, path);
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* fail closed with original error */ }
    throw error;
  }
}

export function createRuntimeRehearsalFetch(input: {
  target: RuntimeTarget;
  recorderPath: string;
  originalFetch: typeof fetch;
  ResponseType?: ResponseConstructor;
}): typeof fetch {
  let updateSent = false;
  const ResponseType = input.ResponseType ?? Response;
  return (async (request: FetchInput, init?: FetchInit) => {
    const url = targetUrl(request);
    const method = telegramMethod(url);
    if (method) {
      if (method === "getMe") {
        return telegramResponse({ id: 424242, is_bot: true, first_name: "Plan5", username: "plan5_rehearsal_bot" }, ResponseType);
      }
      if (method === "getUpdates") {
        if (updateSent) {
          await new Promise<void>((resolve, reject) => {
            if (init?.signal?.aborted) {
              reject(new Error("runtime_rehearsal_get_updates_aborted"));
              return;
            }
            const finish = (operation: () => void) => {
              clearTimeout(timer);
              init?.signal?.removeEventListener("abort", onAbort);
              operation();
            };
            const onAbort = () => finish(() => reject(new Error("runtime_rehearsal_get_updates_aborted")));
            const timer = setTimeout(() => finish(resolve), 30_000);
            init?.signal?.addEventListener("abort", onAbort, { once: true });
          });
          return telegramResponse([], ResponseType);
        }
        updateSent = true;
        return telegramResponse([{
          update_id: 700001,
          message: {
            message_id: 1,
            date: 1_700_000_000,
            chat: { id: 424242, type: "private", first_name: "Plan5" },
            from: { id: 424242, is_bot: false, first_name: "Plan5", language_code: "ru" },
            text: "/version",
            entities: [{ offset: 0, length: 8, type: "bot_command" }]
          }
        }], ResponseType);
      }
      if (method === "sendMessage") {
        const body = bodyRecord(init);
        if (typeof body.text !== "string") throw new Error("runtime_rehearsal_version_response_missing");
        writeRecorder(input.recorderPath, input.target, body.text);
        return telegramResponse({
          message_id: 2,
          date: 1_700_000_001,
          chat: { id: 424242, type: "private" },
          text: body.text
        }, ResponseType);
      }
      return telegramResponse(true, ResponseType);
    }
    if (!isLoopback(url.hostname)) throw new Error("plan5_non_loopback_network_blocked");
    return input.originalFetch(request, init);
  }) as typeof fetch;
}

function isLocalIpcPath(path: string): boolean {
  return path.startsWith("/") || /^\\\\\.\\pipe\\/iu.test(path);
}

function snapshotSocketObject(value: object): Record<PropertyKey, unknown> {
  const snapshot: Record<PropertyKey, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) throw new Error("plan5_socket_target_invalid");
    Object.defineProperty(snapshot, key, {
      configurable: false,
      enumerable: descriptor.enumerable,
      writable: false,
      value: Reflect.get(value, key)
    });
  }
  return Object.freeze(snapshot);
}

function snapshotNormalizedSocketArgs(value: unknown[]): unknown[] {
  const normalized = value.map((item) => (
    typeof item === "object" && item !== null && !Array.isArray(item) ? snapshotSocketObject(item) : item
  ));
  for (const symbol of Object.getOwnPropertySymbols(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, symbol);
      if (!descriptor || !("value" in descriptor)) throw new Error("plan5_socket_target_invalid");
      Object.defineProperty(normalized, symbol, {
        configurable: false,
        enumerable: descriptor.enumerable,
        writable: false,
        value: descriptor.value
      });
  }
  return Object.freeze(normalized) as unknown as unknown[];
}

function snapshotSocketArgs(args: unknown[]): unknown[] {
  const result = args.map((item) => {
    if (Array.isArray(item)) return snapshotNormalizedSocketArgs(item);
    if (typeof item === "object" && item !== null) return snapshotSocketObject(item);
    return item;
  });
  return Object.freeze(result) as unknown as unknown[];
}

function assertSupplementalSocketOptions(args: unknown[]): void {
  for (const value of args.slice(1)) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
    const options = value as { host?: unknown; hostname?: unknown; path?: unknown; lookup?: unknown };
    if (options.lookup !== undefined) throw new Error("plan5_socket_target_invalid");
    if (options.path !== undefined && (typeof options.path !== "string" || !isLocalIpcPath(options.path))) {
      throw new Error("plan5_non_loopback_network_blocked");
    }
    for (const host of [options.hostname, options.host]) {
      if (host !== undefined && (typeof host !== "string" || !host || !isLoopback(host))) {
        throw new Error("plan5_non_loopback_network_blocked");
      }
    }
  }
}

function socketHost(args: unknown[], normalized = false): string | null {
  const first = args[0];
  if (Array.isArray(first)) {
    if (normalized || first.length < 1 || first.length > 2
        || (first.length === 2 && first[1] !== null && typeof first[1] !== "function")) {
      throw new Error("plan5_socket_target_invalid");
    }
    return socketHost(first, true);
  }
  assertSupplementalSocketOptions(args);
  if (typeof first === "number") return typeof args[1] === "string" ? args[1] : "localhost";
  if (typeof first === "object" && first !== null) {
    const options = first as { host?: unknown; hostname?: unknown; path?: unknown; port?: unknown; lookup?: unknown };
    if (options.lookup !== undefined) throw new Error("plan5_socket_target_invalid");
    if (options.path !== undefined) {
      if (typeof options.path !== "string" || options.port !== undefined || !isLocalIpcPath(options.path)) {
        throw new Error("plan5_non_loopback_network_blocked");
      }
      return null;
    }
    if (!Number.isSafeInteger(options.port) || Number(options.port) < 1 || Number(options.port) > 65_535) {
      throw new Error("plan5_socket_target_invalid");
    }
    const host = options.hostname ?? options.host ?? "localhost";
    if (typeof host !== "string" || !host) throw new Error("plan5_socket_target_invalid");
    return host;
  }
  if (typeof first === "string" && isLocalIpcPath(first)) return null;
  throw new Error("plan5_socket_target_invalid");
}

function guardSocket<T extends (...args: any[]) => any>(original: T): T {
  return function guardedSocket(this: unknown, ...args: Parameters<T>): ReturnType<T> {
    const stableArgs = snapshotAndValidateRuntimeSocketArgs(args);
    return original.apply(this, stableArgs as Parameters<T>);
  } as T;
}

export function snapshotAndValidateRuntimeSocketArgs(args: unknown[]): unknown[] {
  const stableArgs = snapshotSocketArgs(args);
  const host = socketHost(stableArgs);
  if (host !== null && !isLoopback(host)) throw new Error("plan5_non_loopback_network_blocked");
  return stableArgs;
}

export function installRuntimeRehearsalPreload(input: {
  target: RuntimeTarget;
  recorderPath: string;
  runtimeWorktree: string;
}): void {
  globalThis.fetch = createRuntimeRehearsalFetch({
    ...input,
    originalFetch: globalThis.fetch.bind(globalThis)
  });
  const netMutable = net as unknown as { connect: typeof net.connect; createConnection: typeof net.createConnection };
  const tlsMutable = tls as unknown as { connect: typeof tls.connect };
  const socketPrototype = net.Socket.prototype as unknown as { connect: typeof net.Socket.prototype.connect };
  netMutable.connect = guardSocket(netMutable.connect);
  netMutable.createConnection = guardSocket(netMutable.createConnection);
  tlsMutable.connect = guardSocket(tlsMutable.connect);
  socketPrototype.connect = guardSocket(socketPrototype.connect);

  const runtimeRequire = createRequire(pathToFileURL(resolve(input.runtimeWorktree, "package.json")));
  const grammyRequire = createRequire(runtimeRequire.resolve("grammy"));
  const nodeFetchEntry = grammyRequire.resolve("node-fetch");
  const originalNodeFetch = grammyRequire(nodeFetchEntry) as typeof fetch & {
    default: typeof fetch;
    Response: ResponseConstructor;
  };
  const cacheEntry = grammyRequire.cache[nodeFetchEntry];
  if (typeof originalNodeFetch !== "function" || originalNodeFetch.default !== originalNodeFetch
      || typeof originalNodeFetch.Response !== "function" || cacheEntry === undefined) {
    throw new Error("runtime_rehearsal_node_fetch_shape_unsupported");
  }
  const interceptedNodeFetch = createRuntimeRehearsalFetch({
    ...input,
    originalFetch: originalNodeFetch,
    ResponseType: originalNodeFetch.Response
  }) as typeof originalNodeFetch;
  for (const key of Reflect.ownKeys(originalNodeFetch)) {
    if (key === "default" || key === "length" || key === "name" || key === "prototype") continue;
    const descriptor = Object.getOwnPropertyDescriptor(originalNodeFetch, key);
    if (descriptor) Object.defineProperty(interceptedNodeFetch, key, descriptor);
  }
  Object.defineProperty(interceptedNodeFetch, "default", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: interceptedNodeFetch
  });
  cacheEntry.exports = interceptedNodeFetch;
}

if (process.env.PLAN5_RUNTIME_REHEARSAL_PRELOAD === "1") {
  const target = process.env.PLAN5_RUNTIME_REHEARSAL_TARGET;
  const recorderPath = process.env.PLAN5_RUNTIME_REHEARSAL_RECORDER;
  const runtimeWorktree = process.env.PLAN5_RUNTIME_REHEARSAL_WORKTREE;
  if ((target !== "candidate" && target !== "previous") || !recorderPath || !runtimeWorktree) {
    throw new Error("runtime_rehearsal_preload_configuration_invalid");
  }
  installRuntimeRehearsalPreload({ target, recorderPath, runtimeWorktree });
}
