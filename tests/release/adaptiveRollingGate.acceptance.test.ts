import { generateKeyPairSync, sign } from "node:crypto";
import {
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalAdaptiveRollingReceiptPayload,
  APPROVED_ADAPTIVE_RELEASE_KEY_ID,
  APPROVED_ADAPTIVE_RELEASE_PUBLIC_KEY_PEM,
  sealUnifiedAdaptiveRollingReleaseReceiptV1,
  validateUnifiedAdaptiveRollingReleaseReceiptV1,
  type UnifiedAdaptiveRollingReleaseReceiptV1
} from "../../src/release/unifiedReleaseGateReceipt";
import {
  APPROVED_SCHEMA_034_CATALOG_SHA256,
  APPROVED_SCHEMA_034_CHECKSUM,
  APPROVED_SCHEMA_035_CATALOG_SHA256,
  APPROVED_SCHEMA_035_CHECKSUM
} from "../../src/release/unifiedReleaseGateReceipt";
import {
  sealUnifiedMemoryGateEvidenceV1
} from "../../src/unifiedCheck/adaptiveBenchmarkEvidence";
import {
  selectUnifiedRunAdmissionPolicy
} from "../../src/unifiedCheck/rolloutPolicy";
import {
  loadUnifiedVerifiedRolloutAuthority,
  resolveUnifiedVerifiedRolloutAuthority
} from "../../src/unifiedCheck/rolloutAuthority";
import {
  unifiedAdaptiveBenchmarkInvocation
} from "../../scripts/runUnifiedReleaseGateCommand";
import {
  readUnifiedAdaptivePromotionReceipt
} from "../../scripts/finalizeUnifiedReleaseGates";

const SHA = "a".repeat(64);
const CANDIDATE = "1".repeat(40);
const GENERATION = "unified-release-20260725";
const WALLETS = [
  "TPCP7B17wCeybFDvsnU4AWqQotT46J5nZV",
  "TFWGukC9eWTfg4DYtQAzwuAK5XV85rVYJr",
  "TXcNjPjdWzv96kwN8r13tAYNMgsVUSXVhd"
] as const;
const keys = generateKeyPairSync("ed25519");
const publicKeyPem = keys.publicKey.export({
  format: "pem",
  type: "spki"
}).toString();

function targetMemoryEvidence() {
  return sealUnifiedMemoryGateEvidenceV1({
    scope: "target_linux_cgroup_gate",
    runId: "memory-run",
    scenarioId: "target-linux-live-capacity-1",
    completedAt: "2026-07-25T00:10:00.000Z",
    samples: ["before", "during", "after"].map((phase, index) => ({
      version: "unified-memory-sample-v1" as const,
      phase: phase as "before" | "during" | "after",
      runId: "memory-run",
      scenarioId: "target-linux-live-capacity-1",
      capturedAt: `2026-07-25T00:0${index}:00.000Z`,
      nodePid: 42,
      localWslDiagnostic: {
        status: "skipped" as const,
        vmmemWslWorkingSetBytes: null,
        linuxMemAvailableBytes: null,
        linuxSwapTotalBytes: null,
        linuxSwapFreeBytes: null
      },
      runtime: {
        rssBytes: 256_000_000 + index,
        heapUsedBytes: 128_000_000 + index
      }
    })),
    database: {
      latencyMs: 10,
      checkpointLatencyMs: 12
    },
    availableMemorySource: "cgroup",
    availableMemoryBytes: 8_589_934_592,
    targetAttestation: {
      platform: "linux",
      measurement: "observed",
      processPid: 42,
      processStartTimeTicks: "123456",
      executableSha256: "9".repeat(64),
      memorySourcePath: "/sys/fs/cgroup/memory.current",
      memorySourceArtifactSha256: "8".repeat(64)
    }
  }).envelope;
}

function unsignedReceipt(
  capacity4: "verified" | "unverified" = "verified"
): Omit<UnifiedAdaptiveRollingReleaseReceiptV1, "approval"> {
  return {
    version: "unified-adaptive-rolling-release-receipt-v1" as const,
    candidateSha: CANDIDATE,
    releaseGenerationId: GENERATION,
    authorizedStage: "rolling_default" as const,
    recordedAt: "2026-07-25T00:20:00.000Z",
    schema034: {
      checksumSha256: APPROVED_SCHEMA_034_CHECKSUM,
      catalogSha256: APPROVED_SCHEMA_034_CATALOG_SHA256,
      structuralGatePassed: true as const
    },
    schema035: {
      checksumSha256: APPROVED_SCHEMA_035_CHECKSUM,
      catalogSha256: APPROVED_SCHEMA_035_CATALOG_SHA256,
      structuralGatePassed: true as const
    },
    frozenReplay: {
      evidenceIndexSha256: SHA,
      oracleReceiptSha256: "b".repeat(64),
      exactEquivalent: true as const,
      logicalCapacities: [1, 4, 8, 16, 32, 100] as const
    },
    transactionalRecovery: {
      evidenceSha256: "c".repeat(64),
      retryPassed: true as const,
      restartPassed: true as const,
      duplicateCommits: 0,
      duplicateDeliveryIntents: 0
    },
    live: {
      capacity1EvidenceSha256: "d".repeat(64),
      capacity4: capacity4 === "verified"
        ? {
            status: "verified" as const,
            evidenceSha256: "e".repeat(64),
            auditedIndependentGroups: 4
          }
        : {
            status: "unverified" as const,
            reason: "independent_groups_not_audited"
          },
      wallets: WALLETS.map((subjectAddress, index) => ({
        subjectAddress,
        score: index * 10,
        decision: "REVIEW" as const,
        closureComplete: true as const,
        evidenceBundleSha256: String(index + 1).repeat(64),
        traversalClosureSha256: String(index + 4).repeat(64),
        scoringBundleSha256: String(index + 7).repeat(64),
        reportSha256: String(index + 1).repeat(64)
      })),
      externalTelegramSends: 0
    },
    targetLinuxMemory: targetMemoryEvidence(),
    hotFallback: {
      evidenceSha256: "f".repeat(64),
      rollingToBarrierPassed: true as const,
      samePlannerCommitPath: true as const,
      unleasedTailDeAdmitted: true as const,
      leasedChunksFinishedBounded: true as const
    },
    binaryRollback: {
      pre034BinaryHot: false as const,
      retainSchema034: true as const,
      destructiveDownMigration: false as const,
      orderedSteps: [
        "close_generation_to_new_claims",
        "drain_or_block_active_rolling_runs",
        "stop_new_runtime",
        "start_old_binary",
        "retain_migration_034"
      ] as const
    },
    verifiedCapacityCeiling: capacity4 === "verified" ? 4 : 1
  };
}

function signedReceipt(capacity4: "verified" | "unverified" = "verified") {
  const body = unsignedReceipt(capacity4);
  const signatureBase64 = sign(
    null,
    canonicalAdaptiveRollingReceiptPayload(body),
    keys.privateKey
  ).toString("base64");
  return sealUnifiedAdaptiveRollingReleaseReceiptV1({
    ...body,
    approval: {
      algorithm: "ed25519",
      keyId: APPROVED_ADAPTIVE_RELEASE_KEY_ID,
      signatureBase64
    }
  });
}

describe("adaptive rolling promotion gate", () => {
  it("rejects a complete receipt signed by a foreign release key", () => {
    const sealed = signedReceipt();
    expect(() => validateUnifiedAdaptiveRollingReleaseReceiptV1(
      JSON.parse(sealed.canonicalJson),
      {
        candidateSha: CANDIDATE,
        releaseGenerationId: GENERATION
      },
      Buffer.from(sealed.canonicalJson, "utf8")
    )).toThrow("unified_adaptive_approval_signature_invalid");
  });

  it("fails closed on missing replay, target memory, Telegram, fallback, or signature evidence", () => {
    for (const mutate of [
      (receipt: any) => { receipt.frozenReplay.exactEquivalent = false; },
      (receipt: any) => { receipt.targetLinuxMemory.scope = "local_wsl_diagnostic"; },
      (receipt: any) => { receipt.live.externalTelegramSends = 1; },
      (receipt: any) => { receipt.hotFallback.rollingToBarrierPassed = false; },
      (receipt: any) => { receipt.approval.signatureBase64 = Buffer.alloc(64).toString("base64"); }
    ]) {
      const receipt = structuredClone(signedReceipt().envelope);
      mutate(receipt);
      expect(() => validateUnifiedAdaptiveRollingReleaseReceiptV1(receipt, {
        candidateSha: CANDIDATE,
        releaseGenerationId: GENERATION
      })).toThrow();
    }
  });

  it("keeps an honest capacity-one ceiling when four independent groups are unverified", () => {
    const sealed = signedReceipt("unverified");
    expect(sealed.envelope.verifiedCapacityCeiling).toBe(1);
    expect(() => sealUnifiedAdaptiveRollingReleaseReceiptV1({
      ...sealed.envelope,
      verifiedCapacityCeiling: 4
    })).toThrow("unified_adaptive_capacity_ceiling_invalid");
  });

  it("uses the verified receipt as authority and lets config only narrow it", () => {
    const receipt = signedReceipt().envelope;
    expect(resolveUnifiedVerifiedRolloutAuthority({
      configuredStage: "bounded_user_check",
      configuredProviderCapacityCeiling: 1,
      receipt,
      receiptSha256: "7".repeat(64)
    })).toEqual({
      stage: "bounded_user_check",
      providerCapacityCeiling: 1,
      receiptSha256: "7".repeat(64)
    });
    expect(() => resolveUnifiedVerifiedRolloutAuthority({
      configuredStage: "rolling_default",
      configuredProviderCapacityCeiling: 100,
      receipt,
      receiptSha256: "7".repeat(64)
    })).toThrow("unified_rollout_receipt_config_mismatch");
    expect(() => resolveUnifiedVerifiedRolloutAuthority({
      configuredStage: "rolling_default",
      configuredProviderCapacityCeiling: 1,
      receipt: null,
      receiptSha256: null
    })).toThrow("unified_rollout_receipt_required");
    expect(resolveUnifiedVerifiedRolloutAuthority({
      configuredStage: "global_barrier",
      configuredProviderCapacityCeiling: 1,
      receipt: null,
      receiptSha256: null
    })).toMatchObject({
      stage: "global_barrier",
      providerCapacityCeiling: 1
    });
  });

  it("lets a bounded-user receipt narrow to isolated rolling without widening", () => {
    const receipt = {
      ...signedReceipt().envelope,
      authorizedStage: "bounded_user_check" as const
    };

    expect(resolveUnifiedVerifiedRolloutAuthority({
      configuredStage: "isolated_rolling",
      configuredProviderCapacityCeiling: 1,
      receipt,
      receiptSha256: "7".repeat(64)
    })).toMatchObject({
      stage: "isolated_rolling",
      providerCapacityCeiling: 1
    });
    expect(() => resolveUnifiedVerifiedRolloutAuthority({
      configuredStage: "rolling_default",
      configuredProviderCapacityCeiling: 1,
      receipt,
      receiptSha256: "7".repeat(64)
    })).toThrow("unified_rollout_receipt_config_mismatch");
  });

  it("rejects a signed receipt issued for a different active generation", async () => {
    const root = mkdtempSync(join(tmpdir(), "adaptive-generation-root-"));
    const receiptPath = join(root, "adaptive-rolling-release-receipt-v1.json");
    try {
      writeFileSync(receiptPath, signedReceipt().canonicalJson);

      await expect(loadUnifiedVerifiedRolloutAuthority({
        receiptPath,
        candidateSha: CANDIDATE,
        expectedReleaseGenerationId: "unified-release-20260725-next",
        configuredStage: "rolling_default",
        configuredProviderCapacityCeiling: 4
      })).rejects.toThrow("unified_adaptive_release_identity_invalid");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("selects explicit work-conserving rollout stages for new runs only", () => {
    const isolated = {
      runId: "isolated-1",
      runPurpose: "release_canary" as const,
      sideEffectPolicy: "isolated" as const,
      createdUnderSchemaVersion: 35
    };
    expect(selectUnifiedRunAdmissionPolicy({
      stage: "global_barrier",
      boundedUserCheckBasisPoints: 0,
      ...isolated
    })).toBe("barrier");
    expect(selectUnifiedRunAdmissionPolicy({
      stage: "isolated_rolling",
      boundedUserCheckBasisPoints: 0,
      ...isolated
    })).toBe("rolling");
    expect(selectUnifiedRunAdmissionPolicy({
      stage: "bounded_user_check",
      boundedUserCheckBasisPoints: 10_000,
      ...isolated,
      runId: "user-1",
      runPurpose: "user_check",
      sideEffectPolicy: "authoritative"
    })).toBe("rolling");
    expect(selectUnifiedRunAdmissionPolicy({
      stage: "rolling_default",
      boundedUserCheckBasisPoints: 0,
      ...isolated,
      createdUnderSchemaVersion: 34
    })).toBe("barrier");
  });

  it("uses a shell-free direct Node benchmark invocation on PowerShell hosts", () => {
    const invocation = unifiedAdaptiveBenchmarkInvocation([
      "--mode",
      "replay",
      "--capacity",
      "1,4,8,16,32,100"
    ]);

    expect(invocation).toEqual({
      executable: process.execPath,
      args: [
        "--import",
        "tsx",
        "scripts/runUnifiedAdaptiveBenchmark.ts",
        "--mode",
        "replay",
        "--capacity",
        "1,4,8,16,32,100"
      ]
    });
    expect(invocation.executable).not.toMatch(/npm\.ps1$/iu);
  });

  it("rejects foreign, path-selected, and symlinked authority material", async () => {
    const root = mkdtempSync(join(tmpdir(), "adaptive-release-root-"));
    try {
      const sealed = signedReceipt();
      writeFileSync(
        join(root, "adaptive-rolling-promotion-approval-v1.json"),
        sealed.canonicalJson,
        { flag: "wx" }
      );
      writeFileSync(
        join(root, "adaptive-rolling-authority-public-key.pem"),
        publicKeyPem,
        { flag: "wx" }
      );

      await expect(readUnifiedAdaptivePromotionReceipt(root, {
        candidateSha: CANDIDATE,
        releaseGenerationId: GENERATION
      })).rejects.toThrow("unified_adaptive_release_public_key_invalid");

      rmSync(
        join(root, "adaptive-rolling-authority-public-key.pem")
      );
      const pinned = join(root, "pinned.pem");
      writeFileSync(
        pinned,
        APPROVED_ADAPTIVE_RELEASE_PUBLIC_KEY_PEM,
        { flag: "wx" }
      );
      symlinkSync(
        pinned,
        join(root, "adaptive-rolling-authority-public-key.pem")
      );
      await expect(readUnifiedAdaptivePromotionReceipt(root, {
        candidateSha: CANDIDATE,
        releaseGenerationId: GENERATION
      })).rejects.toThrow(/symlink|file_invalid/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
