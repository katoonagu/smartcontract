import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  open,
  realpath
} from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
  validateUnifiedAdaptiveRollingReleaseReceiptV1,
  type UnifiedAdaptiveRollingReleaseReceiptV1
} from "../release/unifiedReleaseGateReceipt";
import type { UnifiedRollingRolloutStage } from "./rolloutPolicy";

export type UnifiedVerifiedRolloutAuthority = {
  readonly stage: UnifiedRollingRolloutStage;
  readonly providerCapacityCeiling: number;
  readonly receiptSha256: string | null;
};

const ALLOWED_NARROWING: Readonly<Record<
  UnifiedRollingRolloutStage,
  readonly UnifiedRollingRolloutStage[]
>> = {
  global_barrier: ["global_barrier"],
  isolated_rolling: ["global_barrier", "isolated_rolling"],
  bounded_user_check: [
    "global_barrier",
    "isolated_rolling",
    "bounded_user_check"
  ],
  rolling_default: [
    "global_barrier",
    "isolated_rolling",
    "bounded_user_check",
    "rolling_default"
  ]
};

export function resolveUnifiedVerifiedRolloutAuthority(input: {
  readonly configuredStage: UnifiedRollingRolloutStage;
  readonly configuredProviderCapacityCeiling: number;
  readonly receipt: UnifiedAdaptiveRollingReleaseReceiptV1 | null;
  readonly receiptSha256: string | null;
}): UnifiedVerifiedRolloutAuthority {
  if (input.receipt === null) {
    if (
      input.receiptSha256 !== null ||
      input.configuredStage !== "global_barrier" ||
      input.configuredProviderCapacityCeiling !== 1
    ) {
      throw new Error("unified_rollout_receipt_required");
    }
    return {
      stage: "global_barrier",
      providerCapacityCeiling: 1,
      receiptSha256: null
    };
  }
  if (
    !/^[0-9a-f]{64}$/u.test(input.receiptSha256 ?? "") ||
    !ALLOWED_NARROWING[input.receipt.authorizedStage].includes(
      input.configuredStage
    ) ||
    !Number.isSafeInteger(
      input.configuredProviderCapacityCeiling
    ) ||
    input.configuredProviderCapacityCeiling < 1 ||
    input.configuredProviderCapacityCeiling >
      input.receipt.verifiedCapacityCeiling
  ) {
    throw new Error("unified_rollout_receipt_config_mismatch");
  }
  return {
    stage: input.configuredStage,
    providerCapacityCeiling:
      input.configuredProviderCapacityCeiling,
    receiptSha256: input.receiptSha256
  };
}

export async function loadUnifiedVerifiedRolloutAuthority(input: {
  readonly receiptPath: string | null;
  readonly candidateSha: string;
  readonly expectedReleaseGenerationId: string | null;
  readonly configuredStage: UnifiedRollingRolloutStage;
  readonly configuredProviderCapacityCeiling: number;
}): Promise<UnifiedVerifiedRolloutAuthority> {
  if (input.receiptPath === null) {
    return resolveUnifiedVerifiedRolloutAuthority({
      configuredStage: input.configuredStage,
      configuredProviderCapacityCeiling:
        input.configuredProviderCapacityCeiling,
      receipt: null,
      receiptSha256: null
    });
  }
  if (!isAbsolute(input.receiptPath)) {
    throw new Error("unified_rollout_receipt_path_invalid");
  }
  if (input.expectedReleaseGenerationId === null) {
    throw new Error("unified_adaptive_release_identity_invalid");
  }
  const target = resolve(input.receiptPath);
  const before = await lstat(target);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size < 1 ||
    before.size > 4 * 1024 * 1024 ||
    resolve(await realpath(target)) !== target
  ) {
    throw new Error("unified_rollout_receipt_file_invalid");
  }
  const handle = await open(
    target,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
  );
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size ||
      opened.mtimeMs !== before.mtimeMs ||
      opened.ctimeMs !== before.ctimeMs
    ) {
      throw new Error("unified_rollout_receipt_identity_changed");
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs ||
      bytes.length !== opened.size
    ) {
      throw new Error("unified_rollout_receipt_identity_changed");
    }
    const raw = JSON.parse(bytes.toString("utf8")) as {
      releaseGenerationId?: unknown;
    };
    if (typeof raw.releaseGenerationId !== "string") {
      throw new Error("unified_rollout_receipt_identity_invalid");
    }
    const receipt = validateUnifiedAdaptiveRollingReleaseReceiptV1(
      raw,
      {
        candidateSha: input.candidateSha,
        releaseGenerationId: input.expectedReleaseGenerationId
      },
      bytes
    );
    return resolveUnifiedVerifiedRolloutAuthority({
      configuredStage: input.configuredStage,
      configuredProviderCapacityCeiling:
        input.configuredProviderCapacityCeiling,
      receipt,
      receiptSha256: createHash("sha256")
        .update(bytes)
        .digest("hex")
    });
  } finally {
    await handle.close();
  }
}
