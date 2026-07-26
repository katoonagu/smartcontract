import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseUnifiedMemoryGateEvidenceV1,
  parseUnifiedWslMemorySampleV1,
  sealUnifiedMemoryGateEvidenceV1,
  satisfiesUnifiedProductionMemoryGate
} from "../../src/unifiedCheck/adaptiveBenchmarkEvidence";
import {
  canonicalizeArtifactJson
} from "../../src/forensics/canonicalJson";

const capturedAt = "2026-07-25T01:02:03.000Z";

function sample(
  phase: "before" | "during" | "after",
  overrides: Record<string, unknown> = {}
) {
  return parseUnifiedWslMemorySampleV1({
    phase,
    runId: "run-memory-1",
    scenarioId: "live:c1:dense_wallet",
    capturedAt,
    nodePid: 4242,
    vmmemWslOutput: "WorkingSet64\r\n2147483648\r\n",
    linuxMeminfo: [
      "MemTotal:       32768000 kB",
      "MemAvailable:   24576000 kB",
      "SwapTotal:       8388608 kB",
      "SwapFree:        8388608 kB"
    ].join("\n"),
    runtimeSnapshot: {
      rssBytes: 268_435_456,
      heapUsedBytes: 134_217_728
    },
    ...overrides
  });
}

describe("Unified WSL and target-Linux memory evidence", () => {
  it("captures a real local sample and skips cleanly when WSL diagnostics are unavailable", () => {
    const root = mkdtempSync(join(tmpdir(), "unified-wsl-memory-"));
    try {
      const runtimePath = join(root, "runtime.json");
      const memory = process.memoryUsage();
      writeFileSync(runtimePath, JSON.stringify({
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed
      }));

      const rawSample = execFileSync("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        resolve("scripts/captureUnifiedWslMemory.ps1"),
        "-RunId",
        "run-local-sample",
        "-ScenarioId",
        "local-wsl-smoke",
        "-Phase",
        "before",
        "-NodePid",
        String(process.pid),
        "-RuntimeSnapshotPath",
        runtimePath
      ], {
        cwd: resolve("."),
        encoding: "utf8",
        windowsHide: true,
        stdio: "pipe"
      });

      const parsed = JSON.parse(rawSample);
      expect(rawSample).toBe(canonicalizeArtifactJson(parsed));
      expect(parsed).toMatchObject({
        version: "unified-memory-sample-v1",
        runId: "run-local-sample",
        scenarioId: "local-wsl-smoke",
        phase: "before",
        nodePid: process.pid,
        runtime: {
          rssBytes: memory.rss,
          heapUsedBytes: memory.heapUsed
        }
      });
      expect(["captured", "skipped"]).toContain(
        parsed.localWslDiagnostic.status
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("parses canonical before/during/after inputs without treating host percentage as a leak verdict", () => {
    const parsed = sample("during");

    expect(parsed).toMatchObject({
      version: "unified-memory-sample-v1",
      phase: "during",
      runId: "run-memory-1",
      scenarioId: "live:c1:dense_wallet",
      capturedAt,
      nodePid: 4242,
      localWslDiagnostic: {
        status: "captured",
        vmmemWslWorkingSetBytes: 2_147_483_648,
        linuxMemAvailableBytes: 25_165_824_000,
        linuxSwapTotalBytes: 8_589_934_592,
        linuxSwapFreeBytes: 8_589_934_592
      },
      runtime: {
        rssBytes: 268_435_456,
        heapUsedBytes: 134_217_728
      }
    });
    expect(parsed).not.toHaveProperty("windowsMemoryPercent");
    expect(parsed).not.toHaveProperty("leak");
  });

  it("marks missing WSL as a diagnostic skip rather than a production pass", () => {
    const missing = sample("before", {
      vmmemWslOutput: null,
      linuxMeminfo: null
    });
    const sealed = sealUnifiedMemoryGateEvidenceV1({
      scope: "local_wsl_diagnostic",
      runId: "run-memory-1",
      scenarioId: "live:c1:dense_wallet",
      completedAt: capturedAt,
      samples: [missing],
      database: {
        latencyMs: null,
        checkpointLatencyMs: null
      },
      availableMemorySource: null,
      availableMemoryBytes: null,
      targetAttestation: null
    });

    expect(missing.localWslDiagnostic.status).toBe("skipped");
    expect(sealed.envelope.gateStatus).toBe("skipped");
    expect(satisfiesUnifiedProductionMemoryGate(sealed.envelope)).toBe(false);
  });

  it("allows only canonical target Linux/cgroup evidence with bounded post-run state to promote", () => {
    const sealed = sealUnifiedMemoryGateEvidenceV1({
      scope: "target_linux_cgroup_gate",
      runId: "run-memory-1",
      scenarioId: "live:c1:dense_wallet",
      completedAt: capturedAt,
      samples: [
        sample("before"),
        sample("during", {
          runtimeSnapshot: {
            rssBytes: 536_870_912,
            heapUsedBytes: 268_435_456
          }
        }),
        sample("after", {
          runtimeSnapshot: {
            rssBytes: 285_212_672,
            heapUsedBytes: 142_606_336
          }
        })
      ],
      database: {
        latencyMs: 12,
        checkpointLatencyMs: 18
      },
      availableMemorySource: "cgroup",
      availableMemoryBytes: 8_589_934_592,
      targetAttestation: {
        platform: "linux",
        measurement: "observed",
        processPid: 4242,
        processStartTimeTicks: "123456",
        executableSha256: "9".repeat(64),
        memorySourcePath: "/sys/fs/cgroup/memory.current",
        memorySourceArtifactSha256: "8".repeat(64)
      }
    });
    const parsed = parseUnifiedMemoryGateEvidenceV1(sealed.canonicalJson);

    expect(parsed.gateStatus).toBe("passed");
    expect(satisfiesUnifiedProductionMemoryGate(parsed)).toBe(true);
    expect(() => sealUnifiedMemoryGateEvidenceV1({
      ...parsed,
      targetAttestation: {
        ...parsed.targetAttestation!,
        measurement: "simulated" as never
      }
    })).toThrow("unified_memory_target_gate_failed");
  });
});
