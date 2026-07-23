import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APPROVED_PLAN_A_LOCK_COMMIT_SHA,
  APPROVED_PLAN_A_LOCK_TREE_SHA,
  APPROVED_PLAN_A_LOCKED_ROOT_TREE_SHA,
  APPROVED_LOCKED_GOLDEN_MANIFEST_SHA256,
  PLAN_A_GATE_RECEIPT_RELATIVE_PATH,
  UNIFIED_RELEASE_COMMANDS,
  validatePlanAGateReceiptV1,
  validateUnifiedReleaseCommandReceiptV1,
  validateUnifiedWalletReleaseGateReceiptV1
} from "../../src/release/unifiedReleaseGateReceipt";
import {
  readUnifiedReleaseCommandResult,
  unifiedReleaseNpmVersion,
  verifyPlanAApprovedGoldenRoot
} from "../../scripts/finalizeUnifiedReleaseGates";
import { unifiedReleaseCommandInvocation } from "../../scripts/runUnifiedReleaseGateCommand";
import { canonicalBytesV2 } from "../../src/release/releaseRootWriterStore";

const SHA = "a".repeat(64);
const CANDIDATE = "1".repeat(40);
const GENERATION = "unified-release-20260723";
const PLAN_A_SHA = "c".repeat(64);
const CWD_SHA = "d".repeat(64);

function commandReceipt(command = UNIFIED_RELEASE_COMMANDS[0]) {
  return {
    version: "unified-release-command-receipt-v1",
    candidateSha: CANDIDATE,
    releaseGenerationId: GENERATION,
    id: command.id,
    command: command.command,
    cwd: ".",
    cwdPhysicalSha256: CWD_SHA,
    startedAt: "2026-07-23T20:50:00.000Z",
    finishedAt: "2026-07-23T20:54:54.133Z",
    exitCode: 0,
    output: {
      relativePath: `${command.id}.log`,
      sha256: SHA,
      byteLength: 4
    },
    runtime: {
      nodeVersion: "v22.20.0",
      npmVersion: "11.6.4",
      platform: "win32",
      arch: "x64"
    }
  };
}

function unifiedReceipt() {
  return {
    version: "unified-wallet-release-gate-receipt-v1",
    candidateSha: CANDIDATE,
    releaseGenerationId: GENERATION,
    planAGate: {
      relativePath: PLAN_A_GATE_RECEIPT_RELATIVE_PATH,
      sha256: PLAN_A_SHA
    },
    lockedGoldenManifestSha256: APPROVED_LOCKED_GOLDEN_MANIFEST_SHA256,
    versions: {
      analysisManifest: "analysis-manifest-v1",
      attributionPolicy: "selected-attribution-policy-v1",
      comparator: "unified-wallet-comparator-v1",
      presentationManifest: "presentation-manifest-v1",
      renderer: "unified-telegram-renderer-v1",
      schemaVersion: 33,
      scoreAnchor: "score-anchor-v3",
      scoringPolicy: "scoring-signal-matrix-v4"
    },
    schema033: {
      filename: "033_unified_wallet_check.sql",
      checksumSha256: "d04f2aff20370a78862604c92ccbc6bf7c8b1024f95e03b4af2c8f018e701f7",
      catalogSha256: "e3f1b6152d488f9a8557085b977b2b548f963046966ff04b88a67c222f1acaa4",
      cleanVerificationReceiptSha256: SHA,
      cloneVerificationReceiptSha256: SHA
    },
    replayRootSha256: SHA,
    commands: UNIFIED_RELEASE_COMMANDS.map(({ id, command }) => ({
      id,
      command,
      exitCode: 0,
      outputSha256: SHA,
      provenanceReceiptSha256: SHA
    })),
    recordedAt: "2026-07-23T20:54:54.133Z"
  };
}

describe("Unified release gate receipts", () => {
  it("pins the Plan-A control hashes and exact candidate", async () => {
    const receipt = validatePlanAGateReceiptV1({
      version: "plan-a-gate-receipt-v1",
      candidateSha: CANDIDATE,
      approvalAuthority: {
        commitSha: APPROVED_PLAN_A_LOCK_COMMIT_SHA,
        repositoryTreeSha: APPROVED_PLAN_A_LOCK_TREE_SHA,
        lockedRootTreeSha: APPROVED_PLAN_A_LOCKED_ROOT_TREE_SHA
      },
      artifacts: {
        caseCatalogSha256: "acdcaadc9866dc90c74d9f718774f813e3b4fd71a325322de883202642b041d1",
        comparatorContractSha256: "b6572108512d6349c0bae6ed1365b9146db6661595903141c97160dea58a0b83",
        lockedGoldenManifestSha256: APPROVED_LOCKED_GOLDEN_MANIFEST_SHA256,
        lockedManifestDescriptorSha256: "f64afca8698f49581ed52893f028996d32807aa8c986c17b948674212f90fe30",
        protocolSha256: "2b00227d25620a2da8a13bc1a17db2465aaa96f8ba7673c1bbf338583d130865"
      },
      commands: [
        {
          id: "full_test", command: "npm test", exitCode: 0, outputSha256: SHA,
          provenanceReceiptSha256: SHA
        },
        {
          id: "typecheck", command: "npm run typecheck", exitCode: 0, outputSha256: SHA,
          provenanceReceiptSha256: SHA
        },
        {
          id: "locked_verify",
          command: "node --import tsx scripts/tronUsdtGoldenPilotV2.ts verify --input docs/audit/2026-07-system-audit/golden-v2/locked",
          exitCode: 0,
          outputSha256: SHA,
          provenanceReceiptSha256: SHA
        }
      ],
      recordedAt: "2026-07-23T20:54:54.133Z",
      runtime: { nodeVersion: "v22.20.0", npmVersion: "11.6.4" },
      selectedAttributionPolicy: "proportional"
    }, { candidateSha: CANDIDATE });

    expect(receipt.artifacts.lockedGoldenManifestSha256)
      .toBe(APPROVED_LOCKED_GOLDEN_MANIFEST_SHA256);
  });

  it("accepts only the exact candidate, generation, versions and successful command set", () => {
    expect(validateUnifiedWalletReleaseGateReceiptV1(unifiedReceipt(), {
      candidateSha: CANDIDATE,
      releaseGenerationId: GENERATION,
      planAGateReceiptSha256: PLAN_A_SHA
    })).toEqual(unifiedReceipt());
  });

  it("rejects a self-consistent Golden replacement or incomplete command set", () => {
    expect(() => validateUnifiedWalletReleaseGateReceiptV1({
      ...unifiedReceipt(),
      lockedGoldenManifestSha256: "b".repeat(64)
    }, { candidateSha: CANDIDATE, releaseGenerationId: GENERATION,
      planAGateReceiptSha256: PLAN_A_SHA }))
      .toThrow(/locked_golden_manifest/i);

    expect(() => validateUnifiedWalletReleaseGateReceiptV1({
      ...unifiedReceipt(),
      commands: unifiedReceipt().commands.slice(1)
    }, { candidateSha: CANDIDATE, releaseGenerationId: GENERATION,
      planAGateReceiptSha256: PLAN_A_SHA }))
      .toThrow(/commands/i);
  });

  it("binds each command result to canonical candidate/runtime provenance", () => {
    const receipt = commandReceipt();
    expect(validateUnifiedReleaseCommandReceiptV1(receipt, {
      candidateSha: CANDIDATE,
      releaseGenerationId: GENERATION,
      expected: UNIFIED_RELEASE_COMMANDS[0],
      cwdPhysicalSha256: CWD_SHA
    })).toEqual(receipt);
    expect(() => validateUnifiedReleaseCommandReceiptV1({
      ...receipt,
      candidateSha: "2".repeat(40)
    }, {
      candidateSha: CANDIDATE,
      releaseGenerationId: GENERATION,
      expected: UNIFIED_RELEASE_COMMANDS[0],
      cwdPhysicalSha256: CWD_SHA
    })).toThrow(/identity/i);
  });

  it("rejects a log without its candidate-bound canonical command receipt", async () => {
    const root = mkdtempSync(join(tmpdir(), "unified-command-receipt-"));
    try {
      writeFileSync(join(root, "full_test.log"), "pass", { flag: "wx" });
      await expect(readUnifiedReleaseCommandResult(root, UNIFIED_RELEASE_COMMANDS[0], {
        candidateSha: CANDIDATE,
        releaseGenerationId: GENERATION,
        cwdPhysicalSha256: CWD_SHA
      })).rejects.toThrow();

      const receipt = commandReceipt();
      receipt.output.sha256 = createHash("sha256").update("pass").digest("hex");
      writeFileSync(
        join(root, "full_test.command-receipt-v1.json"),
        canonicalBytesV2(receipt),
        { flag: "wx" }
      );
      await expect(readUnifiedReleaseCommandResult(root, UNIFIED_RELEASE_COMMANDS[0], {
        candidateSha: CANDIDATE,
        releaseGenerationId: GENERATION,
        cwdPhysicalSha256: CWD_SHA
      })).resolves.toMatchObject({
        id: "full_test",
        outputSha256: receipt.output.sha256
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("roots the Golden lock in the immutable pre-candidate adjudication commit", () => {
    expect(verifyPlanAApprovedGoldenRoot(APPROVED_PLAN_A_LOCK_COMMIT_SHA))
      .toMatchObject({
        commitSha: APPROVED_PLAN_A_LOCK_COMMIT_SHA,
        repositoryTreeSha: APPROVED_PLAN_A_LOCK_TREE_SHA,
        lockedRootTreeSha: APPROVED_PLAN_A_LOCKED_ROOT_TREE_SHA
      });
    expect(() => verifyPlanAApprovedGoldenRoot("2".repeat(40))).toThrow(/authority|approved/i);
  });

  it("uses a shell-free Windows npm entry point that Node can spawn", () => {
    const command = unifiedReleaseCommandInvocation("full_test");
    if (process.platform === "win32") {
      expect(command.executable).toBe(process.execPath);
      expect(command.args[0]).toMatch(/npm[\\/]bin[\\/]npm-cli\.js$/u);
    } else {
      expect(command).toEqual({ executable: "npm", args: ["test"] });
    }
    expect(unifiedReleaseNpmVersion()).toMatch(/^\d+\.\d+\.\d+$/u);
  });
});
