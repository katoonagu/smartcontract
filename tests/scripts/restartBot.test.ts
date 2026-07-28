import { describe, expect, it, vi } from "vitest";
import {
  restartBot,
  type RestartBotDependencies
} from "../../scripts/restartBot";
import type {
  UnifiedRuntimeInstanceV1
} from "../../src/unifiedCheck/runtimeHandoffRepository";

const oldCommit = "a".repeat(40);
const newCommit = "b".repeat(40);

function runtime(
  instanceId: string,
  state: UnifiedRuntimeInstanceV1["state"],
  overrides: Partial<UnifiedRuntimeInstanceV1> = {}
): UnifiedRuntimeInstanceV1 {
  return {
    instanceId,
    runtimeCommit: state === "ACTIVE" && instanceId === "new-runtime"
      ? newCommit
      : oldCommit,
    instanceLabel: `${instanceId}-${oldCommit.slice(0, 8)}`,
    state,
    startedAt: "2026-07-28T10:00:00.000Z",
    heartbeatAt: "2026-07-28T10:01:00.000Z",
    drainRequestedAt: state === "ACTIVE" ? null : "2026-07-28T10:01:00.000Z",
    drainDeadlineAt: state === "ACTIVE" ? null : "2026-07-28T12:01:00.000Z",
    telegramPollingReleasedAt: state === "DRAINING"
      ? "2026-07-28T10:01:01.000Z"
      : null,
    stoppedAt: null,
    failureReason: null,
    ...overrides
  };
}

function dependencies(): RestartBotDependencies {
  const child = { unref: vi.fn() };
  const stdout = { fd: 11, close: vi.fn(async () => undefined) };
  const stderr = { fd: 12, close: vi.fn(async () => undefined) };
  return {
    repositoryRoot: "C:\\repo",
    execPath: "C:\\node.exe",
    env: { EXISTING_SETTING: "kept" },
    now: () => new Date("2026-07-28T10:01:00.000Z"),
    getGitSha: vi.fn(async () => newCommit),
    loadActiveRuntime: vi.fn()
      .mockResolvedValueOnce(runtime("old-runtime", "ACTIVE"))
      .mockResolvedValueOnce(null)
      .mockResolvedValue(runtime("new-runtime", "ACTIVE")),
    loadRuntimeInstance: vi.fn(async () => runtime("old-runtime", "DRAINING")),
    requestDrain: vi.fn(async () => runtime("old-runtime", "DRAIN_REQUESTED")),
    ensureDirectory: vi.fn(async () => undefined),
    openLog: vi.fn()
      .mockResolvedValueOnce(stdout)
      .mockResolvedValueOnce(stderr),
    spawnProcess: vi.fn(() => child),
    readLog: vi.fn()
      .mockResolvedValueOnce("")
      .mockResolvedValue("bot_started\n"),
    delay: vi.fn(async () => undefined),
    writeLine: vi.fn(),
    pollIntervalMs: 10,
    releaseTimeoutMs: 30,
    startupTimeoutMs: 30
  };
}

describe("safe bot restart", () => {
  it("drains intake before starting exactly one verified replacement", async () => {
    const deps = dependencies();
    const result = await restartBot(deps);

    expect(deps.requestDrain).toHaveBeenCalledWith(
      "old-runtime",
      new Date("2026-07-28T10:01:00.000Z"),
      7_200_000
    );
    expect(deps.loadRuntimeInstance).toHaveBeenCalledWith("old-runtime");
    expect(deps.spawnProcess).toHaveBeenCalledOnce();
    expect(deps.spawnProcess).toHaveBeenCalledWith(
      "C:\\node.exe",
      ["--import", "tsx", "src/index.ts"],
      expect.objectContaining({
        cwd: "C:\\repo",
        detached: true,
        windowsHide: true,
        shell: false,
        stdio: ["ignore", 11, 12]
      })
    );
    const options = vi.mocked(deps.spawnProcess).mock.calls[0]?.[2];
    expect(options?.env).toMatchObject({
      RUNTIME_GIT_SHA: newCommit,
      RUNTIME_INSTANCE_LABEL: expect.stringContaining("bbbbbbbb"),
      EXISTING_SETTING: "kept"
    });
    expect(vi.mocked(deps.spawnProcess).mock.results[0]?.value.unref)
      .toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      oldInstanceId: "old-runtime",
      newInstanceId: "new-runtime",
      runtimeCommit: newCommit,
      drainDeadlineAt: "2026-07-28T12:01:00.000Z"
    });
  });

  it("refuses an unregistered legacy process without spawning or killing", async () => {
    const deps = dependencies();
    vi.mocked(deps.loadActiveRuntime).mockReset();
    vi.mocked(deps.loadActiveRuntime).mockResolvedValue(null);

    await expect(restartBot(deps)).rejects.toThrow(
      "legacy_runtime_requires_verified_manual_stop"
    );
    expect(deps.requestDrain).not.toHaveBeenCalled();
    expect(deps.spawnProcess).not.toHaveBeenCalled();
  });

  it("does not start a replacement before polling release is durable", async () => {
    const deps = dependencies();
    vi.mocked(deps.loadRuntimeInstance).mockResolvedValue(
      runtime("old-runtime", "DRAIN_REQUESTED")
    );

    await expect(restartBot(deps)).rejects.toThrow(
      "runtime_polling_release_timeout"
    );
    expect(deps.spawnProcess).not.toHaveBeenCalled();
  });
});
