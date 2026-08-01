import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../forensics/canonicalJson";
import { canonicalTronUsdtEventKey } from "../forensics/tronAddressAllTimeIndex";
import type { IndexedTronUsdtTransfer } from "../types";
import {
  addressHistoryManifestKey,
  buildAddressHistoryManifest,
  type AddressHistoryManifestV1
} from "./addressHistory";
import { parseAnalysisManifestV1 } from "./contracts";
import {
  parseServiceRoleEventEvidenceBundleV1,
  parseServiceRoleShadowEventRoleMapV1,
  type ServiceRoleEventEvidenceBundleV1
} from "./serviceRoleMapMaterialization";
import {
  deriveServiceRoleShadowAcceptedHistoryBindingV1,
  maybeBuildServiceRoleShadowArtifactV1,
  parseServiceRoleShadowEventRoleMapV2,
  serviceRoleShadowCompoundBindingKeyV1,
  type ServiceRoleShadowArtifactV1,
  type ServiceRoleShadowEventRoleMapV1,
  type ServiceRoleShadowEventRoleMapV2
} from "./serviceRoleShadow";
import type { AcceptedAddressHistoryShadowGroupInput } from "./productionTraversalCoordinator";
import type { UnifiedAddressHistoryPageArtifactV1 } from "./productionAddressHistory";
import type { UnifiedTraversalArtifactV1 } from "./productionTraversal";
import type {
  UnifiedCheckpointCommitResult,
  UnifiedChunkOutcome,
  UnifiedWorkerTask
} from "./worker";
import { traversalStateId } from "./traversal";
import {
  insertUnifiedArtifact,
  type UnifiedQueryable,
  type UnifiedTransactionalQueryable
} from "./repository";

const HASH = /^[0-9a-f]{64}$/u;
const POLICY_VERSION = "service-role-shadow-100-plus-100-v1" as const;

export type ServiceRoleShadowInputSetV1 = {
  schemaVersion: "service-role-shadow-input-set-v1";
  policyVersion: "service-role-shadow-100-plus-100-v1";
  runId: string;
  snapshotHash: string;
  roleMapV2Sha256s: readonly string[];
  productionEffect: false;
};

export type ServiceRoleShadowInputFenceV1 = {
  schemaVersion: "service-role-shadow-input-fence-v1";
  policyVersion: "service-role-shadow-100-plus-100-v1";
  runId: string;
  snapshotHash: string;
  runtimeCommit: string;
  outcome:
    | {
        kind: "ready";
        inputSetSha256: string;
        roleMapV2Sha256s: readonly string[];
      }
    | {
        kind: "unavailable";
        reason: "preload_timeout" | "malformed" | "conflict";
        observedRoleMapV2Sha256s: readonly string[] | null;
      };
  productionEffect: false;
};

export type ServiceRoleShadowMapLookupV1 =
  | { kind: "missing" }
  | {
      kind: "found";
      wrapperSha256: string;
      wrapper: ServiceRoleShadowEventRoleMapV2;
      sourceMapSha256: string;
      sourceMap: ServiceRoleShadowEventRoleMapV1;
    }
  | { kind: "conflict"; wrapperSha256s: readonly string[] };

export type ServiceRoleShadowPrecommitReceiptV1 = {
  readonly schemaVersion: "service-role-shadow-precommit-receipt-v1";
  readonly policyVersion: "service-role-shadow-100-plus-100-v1";
  readonly runId: string;
  readonly snapshotHash: string;
  readonly inputFenceSha256: string;
  readonly inputSetSha256: string;
  readonly manifestKey: string;
  readonly manifestSha256: string;
  readonly acceptedPageArtifactHashes: readonly string[];
  readonly candidateCheckpointSha256: string;
  readonly candidateDeltaSha256: string;
  readonly compoundBindingKey: string;
  readonly profiles: readonly {
    readonly traversalStateId: string;
    readonly shadowStateId: string;
    readonly profileSha256: string;
    readonly wrapperSha256: string;
  }[];
  readonly commitStatus: "unconfirmed";
  readonly productionEffect: false;
};

export type ServiceRoleShadowRuntimeReceiptV1 = {
  readonly schemaVersion: "service-role-shadow-runtime-receipt-v1";
  readonly policyVersion: "service-role-shadow-100-plus-100-v1";
  readonly runId: string;
  readonly snapshotHash: string;
  readonly runtimeCommit: string;
  readonly traversalTaskId: string;
  readonly traversalAttempt: number;
  readonly inputFenceSha256: string;
  readonly inputSetSha256: string;
  readonly compoundBindingKey: string;
  readonly precommitSha256: string;
  readonly manifestKey: string;
  readonly manifestSha256: string;
  readonly acceptedPageArtifactHashes: readonly string[];
  readonly candidateCheckpointSha256: string;
  readonly candidateDeltaSha256: string;
  readonly committedCheckpointSha256: string;
  readonly committedDeltaHeadSha256: string;
  readonly committedEntries: readonly {
    readonly canonicalSequence: number;
    readonly taskId: string;
    readonly acceptedAttemptId: string;
    readonly artifactSha256: string;
  }[];
  readonly profiles: ServiceRoleShadowPrecommitReceiptV1["profiles"];
  readonly commitStatus: "reconciled";
  readonly productionEffect: false;
};

export type ServiceRoleShadowRunSummaryV1 = {
  readonly schemaVersion: "service-role-shadow-run-summary-v1";
  readonly policyVersion: "service-role-shadow-100-plus-100-v1";
  readonly runId: string;
  readonly snapshotHash: string;
  readonly runtimeCommit: string;
  readonly inputFenceSha256: string;
  readonly acceptedTraversal: {
    readonly taskId: string;
    readonly acceptedAttemptId: string;
    readonly artifactSha256: string;
  };
  readonly groupReceiptSha256s: readonly string[];
  readonly counts: {
    readonly missing: number;
    readonly conflict: number;
    readonly malformed: number;
    readonly eligibleGroup: number;
    readonly eligibleProfile: number;
    readonly reconciledGroup: number;
    readonly reconciledProfile: number;
    readonly unreconciledGroup: number;
    readonly profileOrphan: number;
    readonly precommitOrphan: number;
  };
  readonly complete: boolean;
  readonly productionEffect: false;
};

type BoundArtifact<T> = {
  readonly artifact: T;
  readonly canonicalJson: string;
  readonly sha256: string;
};

function exactRecord(
  value: unknown,
  expectedKeys: readonly string[]
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("invalid_record");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("invalid_record");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<
    string,
    PropertyDescriptor | undefined
  >;
  const expected = new Set(expectedKeys);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== "string" || !expected.has(key))
  ) {
    throw new TypeError("invalid_record");
  }
  return Object.fromEntries(expectedKeys.map((key) => {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError("invalid_record");
    }
    return [key, descriptor.value];
  }));
}

function exactDenseArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError("invalid_array");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<
    string,
    PropertyDescriptor | undefined
  >;
  const length = value.length;
  const keys = Reflect.ownKeys(descriptors);
  const lengthDescriptor = descriptors.length;
  if (
    !Number.isSafeInteger(length) ||
    keys.length !== length + 1 ||
    !lengthDescriptor ||
    !("value" in lengthDescriptor) ||
    lengthDescriptor.value !== length ||
    lengthDescriptor.enumerable
  ) {
    throw new TypeError("invalid_array");
  }
  for (const key of keys) {
    if (key === "length") continue;
    const index = typeof key === "string" ? Number(key) : Number.NaN;
    const descriptor = typeof key === "string" ? descriptors[key] : undefined;
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= length ||
      String(index) !== key ||
      !descriptor ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    ) {
      throw new TypeError("invalid_array");
    }
  }
  return Array.from({ length }, (_, index) => {
    const descriptor = descriptors[String(index)]!;
    return descriptor.value;
  });
}

function ownedSortedStrings(value: unknown, hashesOnly: boolean): readonly string[] {
  const strings = exactDenseArray(value).map((item) => {
    if (typeof item !== "string" || item.length === 0 ||
      (hashesOnly && !HASH.test(item))) {
      throw new TypeError("invalid_strings");
    }
    return item;
  });
  for (let index = 1; index < strings.length; index += 1) {
    if (strings[index - 1]! >= strings[index]!) {
      throw new TypeError("invalid_strings");
    }
  }
  return Object.freeze([...strings]);
}

function validRootText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseInputSetUnchecked(input: {
  readonly artifact: unknown;
  readonly expectedSha256: string;
}): ServiceRoleShadowInputSetV1 {
  if (!HASH.test(input.expectedSha256)) throw new TypeError("invalid_hash");
  const root = exactRecord(input.artifact, [
    "schemaVersion",
    "policyVersion",
    "runId",
    "snapshotHash",
    "roleMapV2Sha256s",
    "productionEffect"
  ]);
  if (
    root.schemaVersion !== "service-role-shadow-input-set-v1" ||
    root.policyVersion !== POLICY_VERSION ||
    !validRootText(root.runId) ||
    typeof root.snapshotHash !== "string" ||
    !HASH.test(root.snapshotHash) ||
    root.productionEffect !== false
  ) {
    throw new TypeError("invalid_root");
  }
  const artifact = Object.freeze({
    schemaVersion: "service-role-shadow-input-set-v1" as const,
    policyVersion: POLICY_VERSION,
    runId: root.runId,
    snapshotHash: root.snapshotHash,
    roleMapV2Sha256s: ownedSortedStrings(root.roleMapV2Sha256s, true),
    productionEffect: false as const
  });
  if (fingerprintCanonicalArtifact(artifact) !== input.expectedSha256) {
    throw new TypeError("invalid_hash");
  }
  return artifact;
}

export function parseServiceRoleShadowInputSetV1(input: {
  readonly artifact: unknown;
  readonly expectedSha256: string;
}): ServiceRoleShadowInputSetV1 {
  try {
    return parseInputSetUnchecked(input);
  } catch {
    throw new TypeError("service_role_shadow_input_set_v1_invalid");
  }
}

function parseFenceUnchecked(input: {
  readonly artifact: unknown;
  readonly expectedSha256: string;
}): ServiceRoleShadowInputFenceV1 {
  if (!HASH.test(input.expectedSha256)) throw new TypeError("invalid_hash");
  const root = exactRecord(input.artifact, [
    "schemaVersion",
    "policyVersion",
    "runId",
    "snapshotHash",
    "runtimeCommit",
    "outcome",
    "productionEffect"
  ]);
  if (
    root.schemaVersion !== "service-role-shadow-input-fence-v1" ||
    root.policyVersion !== POLICY_VERSION ||
    !validRootText(root.runId) ||
    typeof root.snapshotHash !== "string" ||
    !HASH.test(root.snapshotHash) ||
    !validRootText(root.runtimeCommit) ||
    root.productionEffect !== false
  ) {
    throw new TypeError("invalid_root");
  }
  let rawOutcome: Record<string, unknown>;
  try {
    rawOutcome = exactRecord(root.outcome, [
      "kind", "inputSetSha256", "roleMapV2Sha256s"
    ]);
  } catch {
    rawOutcome = exactRecord(root.outcome, [
      "kind", "reason", "observedRoleMapV2Sha256s"
    ]);
  }
  let outcome: ServiceRoleShadowInputFenceV1["outcome"];
  if (rawOutcome.kind === "ready") {
    if (typeof rawOutcome.inputSetSha256 !== "string" ||
      !HASH.test(rawOutcome.inputSetSha256)) {
      throw new TypeError("invalid_ready");
    }
    outcome = Object.freeze({
      kind: "ready" as const,
      inputSetSha256: rawOutcome.inputSetSha256,
      roleMapV2Sha256s: ownedSortedStrings(rawOutcome.roleMapV2Sha256s, true)
    });
  } else {
    if (rawOutcome.kind !== "unavailable" ||
      !["preload_timeout", "malformed", "conflict"].includes(
        String(rawOutcome.reason)
      )) {
      throw new TypeError("invalid_unavailable");
    }
    const observed = rawOutcome.observedRoleMapV2Sha256s === null
      ? null
      : ownedSortedStrings(rawOutcome.observedRoleMapV2Sha256s, true);
    if (rawOutcome.reason === "preload_timeout" && observed !== null) {
      throw new TypeError("invalid_timeout");
    }
    if (rawOutcome.reason !== "preload_timeout" && observed === null) {
      throw new TypeError("invalid_observed");
    }
    outcome = Object.freeze({
      kind: "unavailable" as const,
      reason: rawOutcome.reason as "preload_timeout" | "malformed" | "conflict",
      observedRoleMapV2Sha256s: observed
    });
  }
  const artifact = Object.freeze({
    schemaVersion: "service-role-shadow-input-fence-v1" as const,
    policyVersion: POLICY_VERSION,
    runId: root.runId,
    snapshotHash: root.snapshotHash,
    runtimeCommit: root.runtimeCommit,
    outcome,
    productionEffect: false as const
  });
  if (fingerprintCanonicalArtifact(artifact) !== input.expectedSha256) {
    throw new TypeError("invalid_hash");
  }
  return artifact;
}

export function parseServiceRoleShadowInputFenceV1(input: {
  readonly artifact: unknown;
  readonly expectedSha256: string;
}): ServiceRoleShadowInputFenceV1 {
  try {
    return parseFenceUnchecked(input);
  } catch {
    throw new TypeError("service_role_shadow_input_fence_v1_invalid");
  }
}

function boundArtifact<T>(artifact: T): BoundArtifact<T> {
  const canonicalJson = canonicalizeArtifactJson(artifact);
  return Object.freeze({
    artifact,
    canonicalJson,
    sha256: fingerprintCanonicalArtifact(artifact)
  });
}

export function buildServiceRoleShadowInputSetV1(input: {
  readonly runId: string;
  readonly snapshotHash: string;
  readonly roleMapV2Sha256s: readonly string[];
}): BoundArtifact<ServiceRoleShadowInputSetV1> {
  const roleMapV2Sha256s = [...input.roleMapV2Sha256s].sort();
  const candidate = {
    schemaVersion: "service-role-shadow-input-set-v1" as const,
    policyVersion: POLICY_VERSION,
    runId: input.runId,
    snapshotHash: input.snapshotHash,
    roleMapV2Sha256s,
    productionEffect: false as const
  };
  const parsed = parseServiceRoleShadowInputSetV1({
    artifact: candidate,
    expectedSha256: fingerprintCanonicalArtifact(candidate)
  });
  return boundArtifact(parsed);
}

export function buildServiceRoleShadowInputFenceV1(input: {
  readonly runId: string;
  readonly snapshotHash: string;
  readonly runtimeCommit: string;
  readonly outcome: ServiceRoleShadowInputFenceV1["outcome"];
}): BoundArtifact<ServiceRoleShadowInputFenceV1> {
  const candidate = {
    schemaVersion: "service-role-shadow-input-fence-v1" as const,
    policyVersion: POLICY_VERSION,
    runId: input.runId,
    snapshotHash: input.snapshotHash,
    runtimeCommit: input.runtimeCommit,
    outcome: input.outcome.kind === "ready"
      ? {
          kind: "ready" as const,
          inputSetSha256: input.outcome.inputSetSha256,
          roleMapV2Sha256s: [...input.outcome.roleMapV2Sha256s].sort()
        }
      : {
          kind: "unavailable" as const,
          reason: input.outcome.reason,
          observedRoleMapV2Sha256s:
            input.outcome.observedRoleMapV2Sha256s === null
              ? null
              : [...input.outcome.observedRoleMapV2Sha256s].sort()
        },
    productionEffect: false as const
  };
  const parsed = parseServiceRoleShadowInputFenceV1({
    artifact: candidate,
    expectedSha256: fingerprintCanonicalArtifact(candidate)
  });
  return boundArtifact(parsed);
}

function parsePrecommitUnchecked(input: {
  readonly artifact: unknown;
  readonly expectedSha256: string;
}): ServiceRoleShadowPrecommitReceiptV1 {
  if (!HASH.test(input.expectedSha256)) throw new TypeError("invalid_hash");
  const root = exactRecord(input.artifact, [
    "schemaVersion",
    "policyVersion",
    "runId",
    "snapshotHash",
    "inputFenceSha256",
    "inputSetSha256",
    "manifestKey",
    "manifestSha256",
    "acceptedPageArtifactHashes",
    "candidateCheckpointSha256",
    "candidateDeltaSha256",
    "compoundBindingKey",
    "profiles",
    "commitStatus",
    "productionEffect"
  ]);
  if (
    root.schemaVersion !== "service-role-shadow-precommit-receipt-v1" ||
    root.policyVersion !== POLICY_VERSION ||
    !validRootText(root.runId) ||
    !validRootText(root.manifestKey) ||
    root.commitStatus !== "unconfirmed" ||
    root.productionEffect !== false ||
    [
      root.snapshotHash,
      root.inputFenceSha256,
      root.inputSetSha256,
      root.manifestSha256,
      root.candidateCheckpointSha256,
      root.candidateDeltaSha256,
      root.compoundBindingKey
    ].some((value) => typeof value !== "string" || !HASH.test(value))
  ) {
    throw new TypeError("invalid_root");
  }
  const pageHashes = exactDenseArray(root.acceptedPageArtifactHashes).map((value) => {
    if (typeof value !== "string" || !HASH.test(value)) {
      throw new TypeError("invalid_page_hash");
    }
    return value;
  });
  if (new Set(pageHashes).size !== pageHashes.length) {
    throw new TypeError("invalid_page_hash");
  }
  const profiles = exactDenseArray(root.profiles).map((value) => {
    const profile = exactRecord(value, [
      "traversalStateId",
      "shadowStateId",
      "profileSha256",
      "wrapperSha256"
    ]);
    if ([
      profile.traversalStateId,
      profile.shadowStateId,
      profile.profileSha256,
      profile.wrapperSha256
    ].some((field) => typeof field !== "string" || !HASH.test(field))) {
      throw new TypeError("invalid_profile");
    }
    return Object.freeze({
      traversalStateId: profile.traversalStateId as string,
      shadowStateId: profile.shadowStateId as string,
      profileSha256: profile.profileSha256 as string,
      wrapperSha256: profile.wrapperSha256 as string
    });
  });
  if (profiles.length === 0) throw new TypeError("invalid_profile");
  for (let index = 1; index < profiles.length; index += 1) {
    if (profiles[index - 1]!.traversalStateId >= profiles[index]!.traversalStateId) {
      throw new TypeError("invalid_profile_order");
    }
  }
  const artifact = Object.freeze({
    schemaVersion: "service-role-shadow-precommit-receipt-v1" as const,
    policyVersion: POLICY_VERSION,
    runId: root.runId,
    snapshotHash: root.snapshotHash as string,
    inputFenceSha256: root.inputFenceSha256 as string,
    inputSetSha256: root.inputSetSha256 as string,
    manifestKey: root.manifestKey,
    manifestSha256: root.manifestSha256 as string,
    acceptedPageArtifactHashes: Object.freeze([...pageHashes]),
    candidateCheckpointSha256: root.candidateCheckpointSha256 as string,
    candidateDeltaSha256: root.candidateDeltaSha256 as string,
    compoundBindingKey: root.compoundBindingKey as string,
    profiles: Object.freeze(profiles),
    commitStatus: "unconfirmed" as const,
    productionEffect: false as const
  });
  if (fingerprintCanonicalArtifact(artifact) !== input.expectedSha256) {
    throw new TypeError("invalid_hash");
  }
  return artifact;
}

export function parseServiceRoleShadowPrecommitReceiptV1(input: {
  readonly artifact: unknown;
  readonly expectedSha256: string;
}): ServiceRoleShadowPrecommitReceiptV1 {
  try {
    return parsePrecommitUnchecked(input);
  } catch {
    throw new TypeError("service_role_shadow_precommit_receipt_v1_invalid");
  }
}

export function buildServiceRoleShadowPrecommitReceiptV1(input: Omit<
  ServiceRoleShadowPrecommitReceiptV1,
  "schemaVersion" | "policyVersion" | "commitStatus" | "productionEffect"
>): BoundArtifact<ServiceRoleShadowPrecommitReceiptV1> {
  const candidate = {
    schemaVersion: "service-role-shadow-precommit-receipt-v1" as const,
    policyVersion: POLICY_VERSION,
    ...input,
    acceptedPageArtifactHashes: [...input.acceptedPageArtifactHashes],
    profiles: [...input.profiles].sort((left, right) =>
      compareCodeUnits(left.traversalStateId, right.traversalStateId)
    ),
    commitStatus: "unconfirmed" as const,
    productionEffect: false as const
  };
  const parsed = parseServiceRoleShadowPrecommitReceiptV1({
    artifact: candidate,
    expectedSha256: fingerprintCanonicalArtifact(candidate)
  });
  return boundArtifact(parsed);
}

function parseRuntimeReceiptUnchecked(input: {
  readonly artifact: unknown;
  readonly expectedSha256: string;
}): ServiceRoleShadowRuntimeReceiptV1 {
  if (!HASH.test(input.expectedSha256)) throw new TypeError("invalid_hash");
  const root = exactRecord(input.artifact, [
    "schemaVersion",
    "policyVersion",
    "runId",
    "snapshotHash",
    "runtimeCommit",
    "traversalTaskId",
    "traversalAttempt",
    "inputFenceSha256",
    "inputSetSha256",
    "compoundBindingKey",
    "precommitSha256",
    "manifestKey",
    "manifestSha256",
    "acceptedPageArtifactHashes",
    "candidateCheckpointSha256",
    "candidateDeltaSha256",
    "committedCheckpointSha256",
    "committedDeltaHeadSha256",
    "committedEntries",
    "profiles",
    "commitStatus",
    "productionEffect"
  ]);
  if (
    root.schemaVersion !== "service-role-shadow-runtime-receipt-v1" ||
    root.policyVersion !== POLICY_VERSION ||
    !validRootText(root.runId) ||
    !validRootText(root.runtimeCommit) ||
    !validRootText(root.traversalTaskId) ||
    !Number.isSafeInteger(root.traversalAttempt) ||
    (root.traversalAttempt as number) < 1 ||
    !validRootText(root.manifestKey) ||
    root.commitStatus !== "reconciled" ||
    root.productionEffect !== false ||
    [
      root.snapshotHash,
      root.inputFenceSha256,
      root.inputSetSha256,
      root.compoundBindingKey,
      root.precommitSha256,
      root.manifestSha256,
      root.candidateCheckpointSha256,
      root.candidateDeltaSha256,
      root.committedCheckpointSha256,
      root.committedDeltaHeadSha256
    ].some((value) => typeof value !== "string" || !HASH.test(value))
  ) {
    throw new TypeError("invalid_root");
  }
  const acceptedPageArtifactHashes = exactDenseArray(
    root.acceptedPageArtifactHashes
  ).map((value) => {
    if (typeof value !== "string" || !HASH.test(value)) {
      throw new TypeError("invalid_page_hash");
    }
    return value;
  });
  if (new Set(acceptedPageArtifactHashes).size !==
    acceptedPageArtifactHashes.length) {
    throw new TypeError("invalid_page_hash");
  }
  const committedEntries = exactDenseArray(root.committedEntries).map((value) => {
    const entry = exactRecord(value, [
      "canonicalSequence",
      "taskId",
      "acceptedAttemptId",
      "artifactSha256"
    ]);
    if (
      !Number.isSafeInteger(entry.canonicalSequence) ||
      (entry.canonicalSequence as number) < 0 ||
      !validRootText(entry.taskId) ||
      !validRootText(entry.acceptedAttemptId) ||
      typeof entry.artifactSha256 !== "string" ||
      !HASH.test(entry.artifactSha256)
    ) {
      throw new TypeError("invalid_committed_entry");
    }
    return Object.freeze({
      canonicalSequence: entry.canonicalSequence as number,
      taskId: entry.taskId,
      acceptedAttemptId: entry.acceptedAttemptId,
      artifactSha256: entry.artifactSha256
    });
  });
  if (committedEntries.length === 0) {
    throw new TypeError("invalid_committed_entry");
  }
  for (let index = 1; index < committedEntries.length; index += 1) {
    if (committedEntries[index - 1]!.canonicalSequence >=
      committedEntries[index]!.canonicalSequence) {
      throw new TypeError("invalid_committed_entry_order");
    }
  }
  const profiles = exactDenseArray(root.profiles).map((value) => {
    const profile = exactRecord(value, [
      "traversalStateId",
      "shadowStateId",
      "profileSha256",
      "wrapperSha256"
    ]);
    if ([
      profile.traversalStateId,
      profile.shadowStateId,
      profile.profileSha256,
      profile.wrapperSha256
    ].some((field) => typeof field !== "string" || !HASH.test(field))) {
      throw new TypeError("invalid_profile");
    }
    return Object.freeze({
      traversalStateId: profile.traversalStateId as string,
      shadowStateId: profile.shadowStateId as string,
      profileSha256: profile.profileSha256 as string,
      wrapperSha256: profile.wrapperSha256 as string
    });
  });
  if (profiles.length === 0) throw new TypeError("invalid_profile");
  for (let index = 1; index < profiles.length; index += 1) {
    if (profiles[index - 1]!.traversalStateId >=
      profiles[index]!.traversalStateId) {
      throw new TypeError("invalid_profile_order");
    }
  }
  const artifact = Object.freeze({
    schemaVersion: "service-role-shadow-runtime-receipt-v1" as const,
    policyVersion: POLICY_VERSION,
    runId: root.runId,
    snapshotHash: root.snapshotHash as string,
    runtimeCommit: root.runtimeCommit,
    traversalTaskId: root.traversalTaskId,
    traversalAttempt: root.traversalAttempt as number,
    inputFenceSha256: root.inputFenceSha256 as string,
    inputSetSha256: root.inputSetSha256 as string,
    compoundBindingKey: root.compoundBindingKey as string,
    precommitSha256: root.precommitSha256 as string,
    manifestKey: root.manifestKey,
    manifestSha256: root.manifestSha256 as string,
    acceptedPageArtifactHashes: Object.freeze([
      ...acceptedPageArtifactHashes
    ]),
    candidateCheckpointSha256: root.candidateCheckpointSha256 as string,
    candidateDeltaSha256: root.candidateDeltaSha256 as string,
    committedCheckpointSha256: root.committedCheckpointSha256 as string,
    committedDeltaHeadSha256: root.committedDeltaHeadSha256 as string,
    committedEntries: Object.freeze(committedEntries),
    profiles: Object.freeze(profiles),
    commitStatus: "reconciled" as const,
    productionEffect: false as const
  });
  if (fingerprintCanonicalArtifact(artifact) !== input.expectedSha256) {
    throw new TypeError("invalid_hash");
  }
  return artifact;
}

export function parseServiceRoleShadowRuntimeReceiptV1(input: {
  readonly artifact: unknown;
  readonly expectedSha256: string;
}): ServiceRoleShadowRuntimeReceiptV1 {
  try {
    return parseRuntimeReceiptUnchecked(input);
  } catch {
    throw new TypeError("service_role_shadow_runtime_receipt_v1_invalid");
  }
}

export function buildServiceRoleShadowRuntimeReceiptV1(input: Omit<
  ServiceRoleShadowRuntimeReceiptV1,
  "schemaVersion" | "policyVersion" | "commitStatus" | "productionEffect"
>): BoundArtifact<ServiceRoleShadowRuntimeReceiptV1> {
  const candidate = {
    schemaVersion: "service-role-shadow-runtime-receipt-v1" as const,
    policyVersion: POLICY_VERSION,
    ...input,
    acceptedPageArtifactHashes: [...input.acceptedPageArtifactHashes],
    committedEntries: [...input.committedEntries].sort((left, right) =>
      left.canonicalSequence - right.canonicalSequence
    ),
    profiles: [...input.profiles].sort((left, right) =>
      compareCodeUnits(left.traversalStateId, right.traversalStateId)
    ),
    commitStatus: "reconciled" as const,
    productionEffect: false as const
  };
  const parsed = parseServiceRoleShadowRuntimeReceiptV1({
    artifact: candidate,
    expectedSha256: fingerprintCanonicalArtifact(candidate)
  });
  return boundArtifact(parsed);
}

const SUMMARY_COUNT_KEYS = [
  "missing",
  "conflict",
  "malformed",
  "eligibleGroup",
  "eligibleProfile",
  "reconciledGroup",
  "reconciledProfile",
  "unreconciledGroup",
  "profileOrphan",
  "precommitOrphan"
] as const;

function parseRunSummaryUnchecked(input: {
  readonly artifact: unknown;
  readonly expectedSha256: string;
}): ServiceRoleShadowRunSummaryV1 {
  if (!HASH.test(input.expectedSha256)) throw new TypeError("invalid_hash");
  const root = exactRecord(input.artifact, [
    "schemaVersion",
    "policyVersion",
    "runId",
    "snapshotHash",
    "runtimeCommit",
    "inputFenceSha256",
    "acceptedTraversal",
    "groupReceiptSha256s",
    "counts",
    "complete",
    "productionEffect"
  ]);
  if (
    root.schemaVersion !== "service-role-shadow-run-summary-v1" ||
    root.policyVersion !== POLICY_VERSION ||
    !validRootText(root.runId) ||
    !validRootText(root.runtimeCommit) ||
    typeof root.snapshotHash !== "string" ||
    !HASH.test(root.snapshotHash) ||
    typeof root.inputFenceSha256 !== "string" ||
    !HASH.test(root.inputFenceSha256) ||
    typeof root.complete !== "boolean" ||
    root.productionEffect !== false
  ) {
    throw new TypeError("invalid_root");
  }
  const traversal = exactRecord(root.acceptedTraversal, [
    "taskId", "acceptedAttemptId", "artifactSha256"
  ]);
  if (
    !validRootText(traversal.taskId) ||
    !validRootText(traversal.acceptedAttemptId) ||
    typeof traversal.artifactSha256 !== "string" ||
    !HASH.test(traversal.artifactSha256)
  ) {
    throw new TypeError("invalid_traversal");
  }
  const groupReceiptSha256s = ownedSortedStrings(
    root.groupReceiptSha256s,
    true
  );
  const rawCounts = exactRecord(root.counts, SUMMARY_COUNT_KEYS);
  const counts = Object.freeze(Object.fromEntries(SUMMARY_COUNT_KEYS.map((key) => {
    const value = rawCounts[key];
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
      throw new TypeError("invalid_count");
    }
    return [key, value];
  })) as ServiceRoleShadowRunSummaryV1["counts"]);
  if (
    counts.reconciledGroup > counts.eligibleGroup ||
    counts.reconciledProfile > counts.eligibleProfile ||
    counts.reconciledGroup + counts.unreconciledGroup !== counts.eligibleGroup ||
    groupReceiptSha256s.length !== counts.reconciledGroup
  ) {
    throw new TypeError("invalid_count_relation");
  }
  const complete = counts.reconciledGroup >= 1 &&
    counts.reconciledGroup === counts.eligibleGroup &&
    counts.reconciledProfile === counts.eligibleProfile &&
    counts.missing === 0 &&
    counts.conflict === 0 &&
    counts.malformed === 0 &&
    counts.unreconciledGroup === 0 &&
    counts.profileOrphan === 0 &&
    counts.precommitOrphan === 0;
  if (root.complete !== complete) throw new TypeError("invalid_complete");
  const artifact = Object.freeze({
    schemaVersion: "service-role-shadow-run-summary-v1" as const,
    policyVersion: POLICY_VERSION,
    runId: root.runId,
    snapshotHash: root.snapshotHash,
    runtimeCommit: root.runtimeCommit,
    inputFenceSha256: root.inputFenceSha256,
    acceptedTraversal: Object.freeze({
      taskId: traversal.taskId,
      acceptedAttemptId: traversal.acceptedAttemptId,
      artifactSha256: traversal.artifactSha256
    }),
    groupReceiptSha256s,
    counts,
    complete,
    productionEffect: false as const
  });
  if (fingerprintCanonicalArtifact(artifact) !== input.expectedSha256) {
    throw new TypeError("invalid_hash");
  }
  return artifact;
}

export function parseServiceRoleShadowRunSummaryV1(input: {
  readonly artifact: unknown;
  readonly expectedSha256: string;
}): ServiceRoleShadowRunSummaryV1 {
  try {
    return parseRunSummaryUnchecked(input);
  } catch {
    throw new TypeError("service_role_shadow_run_summary_v1_invalid");
  }
}

export function buildServiceRoleShadowRunSummaryV1(input: Omit<
  ServiceRoleShadowRunSummaryV1,
  "schemaVersion" | "policyVersion" | "productionEffect"
>): BoundArtifact<ServiceRoleShadowRunSummaryV1> {
  const candidate = {
    schemaVersion: "service-role-shadow-run-summary-v1" as const,
    policyVersion: POLICY_VERSION,
    ...input,
    groupReceiptSha256s: [...new Set(input.groupReceiptSha256s)]
      .sort(compareCodeUnits),
    productionEffect: false as const
  };
  const parsed = parseServiceRoleShadowRunSummaryV1({
    artifact: candidate,
    expectedSha256: fingerprintCanonicalArtifact(candidate)
  });
  return boundArtifact(parsed);
}

type StoredArtifactRow = {
  readonly sha256: string;
  readonly createdByRunId: string;
  readonly kind: string;
  readonly schemaVersion: string;
  readonly artifact: unknown;
};

type ValidatedRoleMap = {
  readonly wrapperSha256: string;
  readonly wrapper: ServiceRoleShadowEventRoleMapV2;
  readonly sourceMapSha256: string;
  readonly sourceMap: ServiceRoleShadowEventRoleMapV1;
};

type RuntimeState = {
  readonly fence: BoundArtifact<ServiceRoleShadowInputFenceV1>;
  readonly mapsByCompoundBindingKey: ReadonlyMap<string, readonly ValidatedRoleMap[]>;
};

type PendingGroupTokenV1 = {
  readonly runId: string;
  readonly taskId: string;
  readonly attempt: number;
  readonly precommitSha256: string;
};

type PendingAttemptV1 = {
  readonly groups: Map<string, PendingGroupTokenV1>;
  expires: ReturnType<typeof setTimeout> | null;
};

type ExistingFenceResolution =
  | { readonly kind: "none" }
  | { readonly kind: "reuse"; readonly state: RuntimeState }
  | {
      readonly kind: "unavailable";
      readonly reason: "malformed" | "conflict";
      readonly observedRoleMapV2Sha256s: readonly string[];
    };

type UnavailableReason = "preload_timeout" | "malformed" | "conflict";

class FencePublicationRequest extends Error {
  readonly reason: UnavailableReason;
  readonly observedRoleMapV2Sha256s: readonly string[] | null;

  constructor(
    reason: UnavailableReason,
    observedRoleMapV2Sha256s: readonly string[] | null
  ) {
    super("service_role_shadow_fence_publication_requested");
    this.name = "FencePublicationRequest";
    this.reason = reason;
    this.observedRoleMapV2Sha256s = observedRoleMapV2Sha256s === null
      ? null
      : Object.freeze([...new Set(observedRoleMapV2Sha256s)].sort());
  }
}

class ServiceRoleArtifactInsertConflict extends Error {
  constructor() {
    super("service_role_shadow_artifact_insert_conflict");
    this.name = "ServiceRoleArtifactInsertConflict";
  }
}

function storedArtifactRow(value: Record<string, unknown>): StoredArtifactRow {
  if (
    typeof value.sha256 !== "string" ||
    typeof value.created_by_run_id !== "string" ||
    typeof value.kind !== "string" ||
    typeof value.schema_version !== "string" ||
    !("artifact_json" in value)
  ) {
    throw new TypeError("service_role_shadow_stored_artifact_invalid");
  }
  return {
    sha256: value.sha256,
    createdByRunId: value.created_by_run_id,
    kind: value.kind,
    schemaVersion: value.schema_version,
    artifact: value.artifact_json
  };
}

function emptyMapIndex(): ReadonlyMap<string, readonly ValidatedRoleMap[]> {
  return new Map<string, readonly ValidatedRoleMap[]>();
}

function indexMaps(
  maps: readonly ValidatedRoleMap[]
): ReadonlyMap<string, readonly ValidatedRoleMap[]> {
  const mutable = new Map<string, ValidatedRoleMap[]>();
  for (const map of maps) {
    const key = serviceRoleShadowCompoundBindingKeyV1(map.wrapper);
    const values = mutable.get(key) ?? [];
    values.push(map);
    mutable.set(key, values);
  }
  return new Map([...mutable].map(([key, values]) => [
    key,
    Object.freeze([...values].sort((left, right) =>
      left.wrapperSha256 < right.wrapperSha256
        ? -1
        : left.wrapperSha256 > right.wrapperSha256 ? 1 : 0))
  ]));
}

function validateRuntimeInput(input: {
  readonly runId: string;
  readonly snapshotHash: string;
}): void {
  if (!validRootText(input.runId)) {
    throw new TypeError("service_role_shadow_runtime_run_id_invalid");
  }
  if (!HASH.test(input.snapshotHash)) {
    throw new TypeError("service_role_shadow_runtime_snapshot_invalid");
  }
}

function timeoutError(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  const message = (error as { message?: unknown }).message;
  if (typeof message !== "string") return false;
  return code === "57014"
    ? /due to statement timeout/iu.test(message)
    : code === "55P03" && /due to lock timeout/iu.test(message);
}

async function setPreloadDeadlines(client: UnifiedQueryable): Promise<void> {
  await client.query("SET LOCAL lock_timeout = '1000ms'");
  await client.query("SET LOCAL statement_timeout = '1000ms'");
}

async function takeRunAdvisoryLock(
  client: UnifiedQueryable,
  runId: string
): Promise<void> {
  await client.query(
    "select pg_advisory_xact_lock(hashtextextended($1::text, 0))",
    [`service-role-shadow-input-fence-v1:${runId}`]
  );
}

async function validateRunSnapshot(
  client: UnifiedQueryable,
  input: { readonly runId: string; readonly snapshotHash: string },
  lockRun: boolean
): Promise<void> {
  const result = await client.query(
    `select run.id,
            run.subject_address,
            run.analysis_manifest_sha256,
            artifact.sha256 as artifact_sha256,
            artifact.kind as artifact_kind,
            artifact.schema_version as artifact_schema_version,
            artifact.artifact_json
       from unified_check_runs run
       join unified_check_artifacts artifact
         on artifact.sha256 = run.analysis_manifest_sha256
        and artifact.created_by_run_id = run.id
        and artifact.kind = 'analysis_manifest'
        and artifact.schema_version = '1'
      where run.id = $1${lockRun ? "\n      for update of run" : ""}`,
    [input.runId]
  );
  const row = result.rows[0];
  if (!row || result.rows.length !== 1 ||
    row.id !== input.runId ||
    typeof row.subject_address !== "string" ||
    typeof row.analysis_manifest_sha256 !== "string" ||
    !HASH.test(row.analysis_manifest_sha256) ||
    row.artifact_sha256 !== row.analysis_manifest_sha256 ||
    row.artifact_kind !== "analysis_manifest" ||
    row.artifact_schema_version !== "1" ||
    fingerprintCanonicalArtifact(row.artifact_json) !== row.analysis_manifest_sha256) {
    throw new TypeError("service_role_shadow_runtime_run_binding_invalid");
  }
  const manifestCandidate = row.artifact_json;
  const manifestSnapshot = manifestCandidate !== null &&
      typeof manifestCandidate === "object" &&
      !Array.isArray(manifestCandidate)
    ? (manifestCandidate as Record<string, unknown>).snapshotHash
    : null;
  if (manifestSnapshot !== input.snapshotHash) {
    throw new TypeError("service_role_shadow_runtime_snapshot_mismatch");
  }
  parseAnalysisManifestV1(manifestCandidate, {
    runId: input.runId,
    subjectAddress: row.subject_address,
    snapshotHash: input.snapshotHash
  });
}

async function loadArtifactsByHashes(
  client: UnifiedQueryable,
  runId: string,
  sha256s: readonly string[]
): Promise<StoredArtifactRow[]> {
  if (sha256s.length === 0) return [];
  const rows = (await client.query(
    `select sha256, created_by_run_id, kind, schema_version, artifact_json
       from unified_check_artifacts
      where sha256 = any($1::text[])
        and created_by_run_id = $2
      order by sha256`,
    [sha256s, runId]
  )).rows.map(storedArtifactRow);
  return rows;
}

function validateSourceClosure(input: {
  readonly wrapperSha256: string;
  readonly wrapper: ServiceRoleShadowEventRoleMapV2;
  readonly sourceMapSha256: string;
  readonly sourceMap: ServiceRoleShadowEventRoleMapV1;
  readonly evidenceBundleSha256: string;
  readonly evidenceBundle: ServiceRoleEventEvidenceBundleV1;
}): ValidatedRoleMap {
  const { wrapper, sourceMap, evidenceBundle } = input;
  if (
    sourceMap.runId !== wrapper.runId ||
    sourceMap.snapshotHash !== wrapper.snapshotHash ||
    sourceMap.addressHistoryManifestSha256 !== wrapper.addressHistoryManifestSha256 ||
    evidenceBundle.runId !== wrapper.runId ||
    evidenceBundle.snapshotHash !== wrapper.snapshotHash ||
    evidenceBundle.addressHistoryManifestSha256 !== wrapper.addressHistoryManifestSha256
  ) {
    throw new TypeError("service_role_shadow_source_binding_invalid");
  }
  const sampledIds = [
    ...wrapper.binding.sampledCanonicalEventIds.recent,
    ...wrapper.binding.sampledCanonicalEventIds.historical
  ];
  const sampled = new Set(sampledIds);
  const mapEntries = new Map<string, ServiceRoleShadowEventRoleMapV1["entries"][number]>();
  for (const entry of sourceMap.entries) {
    if (entry.evidenceSha256 !== input.evidenceBundleSha256 ||
      mapEntries.has(entry.canonicalEventId)) {
      throw new TypeError("service_role_shadow_source_map_invalid");
    }
    mapEntries.set(entry.canonicalEventId, entry);
  }
  const bundleEntries = new Map<string, ServiceRoleEventEvidenceBundleV1["entries"][number]>();
  for (const entry of evidenceBundle.entries) {
    if (bundleEntries.has(entry.canonicalEventId)) {
      throw new TypeError("service_role_shadow_evidence_bundle_invalid");
    }
    bundleEntries.set(entry.canonicalEventId, entry);
  }
  if (
    sampled.size !== 200 ||
    mapEntries.size !== 200 ||
    bundleEntries.size !== 200 ||
    sampledIds.some((canonicalEventId) => {
      const mapEntry = mapEntries.get(canonicalEventId);
      const bundleEntry = bundleEntries.get(canonicalEventId);
      return !mapEntry || !bundleEntry || mapEntry.role !== bundleEntry.role;
    }) ||
    [...mapEntries].some(([canonicalEventId]) => !sampled.has(canonicalEventId)) ||
    [...bundleEntries].some(([canonicalEventId]) => !sampled.has(canonicalEventId))
  ) {
    throw new TypeError("service_role_shadow_source_closure_invalid");
  }
  return Object.freeze({
    wrapperSha256: input.wrapperSha256,
    wrapper,
    sourceMapSha256: input.sourceMapSha256,
    sourceMap
  });
}

async function validateWrapperRows(
  client: UnifiedQueryable,
  input: {
    readonly runId: string;
    readonly snapshotHash: string;
    readonly expectedWrapperSha256s: readonly string[];
    readonly wrapperRows: readonly StoredArtifactRow[];
  }
): Promise<ValidatedRoleMap[]> {
  if (
    input.wrapperRows.length !== input.expectedWrapperSha256s.length ||
    new Set(input.expectedWrapperSha256s).size !== input.expectedWrapperSha256s.length
  ) {
    throw new TypeError("service_role_shadow_wrapper_set_invalid");
  }
  const expected = new Set(input.expectedWrapperSha256s);
  const wrappers = input.wrapperRows.map((row) => {
    if (
      !expected.has(row.sha256) ||
      row.createdByRunId !== input.runId ||
      row.kind !== "service_role_event_role_map" ||
      row.schemaVersion !== "2" ||
      fingerprintCanonicalArtifact(row.artifact) !== row.sha256
    ) {
      throw new TypeError("service_role_shadow_wrapper_invalid");
    }
    const wrapper = parseServiceRoleShadowEventRoleMapV2({
      artifact: row.artifact,
      expectedSha256: row.sha256
    });
    if (wrapper.runId !== input.runId || wrapper.snapshotHash !== input.snapshotHash) {
      throw new TypeError("service_role_shadow_wrapper_binding_invalid");
    }
    return { row, wrapper };
  });
  const sourceHashes = [...new Set(wrappers.flatMap(({ wrapper }) => [
    wrapper.sourceEventRoleMapV1Sha256,
    wrapper.evidenceBundleSha256
  ]))].sort();
  const sourceRows = await loadArtifactsByHashes(client, input.runId, sourceHashes);
  const sources = new Map(sourceRows.map((row) => [row.sha256, row]));
  if (sources.size !== sourceHashes.length) {
    throw new TypeError("service_role_shadow_source_missing");
  }
  return wrappers.map(({ row, wrapper }) => {
    const sourceRow = sources.get(wrapper.sourceEventRoleMapV1Sha256);
    const bundleRow = sources.get(wrapper.evidenceBundleSha256);
    if (!sourceRow || !bundleRow ||
      sourceRow.kind !== "service_role_event_role_map" ||
      sourceRow.schemaVersion !== "1" ||
      bundleRow.kind !== "service_role_event_evidence_bundle" ||
      bundleRow.schemaVersion !== "1" ||
      fingerprintCanonicalArtifact(sourceRow.artifact) !== sourceRow.sha256 ||
      fingerprintCanonicalArtifact(bundleRow.artifact) !== bundleRow.sha256) {
      throw new TypeError("service_role_shadow_source_invalid");
    }
    return validateSourceClosure({
      wrapperSha256: row.sha256,
      wrapper,
      sourceMapSha256: sourceRow.sha256,
      sourceMap: parseServiceRoleShadowEventRoleMapV1(sourceRow.artifact),
      evidenceBundleSha256: bundleRow.sha256,
      evidenceBundle: parseServiceRoleEventEvidenceBundleV1(bundleRow.artifact)
    });
  });
}

async function loadValidatedMapsByHashes(
  client: UnifiedQueryable,
  input: {
    readonly runId: string;
    readonly snapshotHash: string;
    readonly wrapperSha256s: readonly string[];
  }
): Promise<ValidatedRoleMap[]> {
  const wrapperRows = await loadArtifactsByHashes(
    client,
    input.runId,
    input.wrapperSha256s
  );
  return validateWrapperRows(client, {
    runId: input.runId,
    snapshotHash: input.snapshotHash,
    expectedWrapperSha256s: input.wrapperSha256s,
    wrapperRows
  });
}

async function loadInputSet(
  client: UnifiedQueryable,
  input: {
    readonly runId: string;
    readonly snapshotHash: string;
    readonly inputSetSha256: string;
    readonly roleMapV2Sha256s: readonly string[];
  }
): Promise<ServiceRoleShadowInputSetV1> {
  const rows = await loadArtifactsByHashes(client, input.runId, [input.inputSetSha256]);
  const row = rows[0];
  if (!row || rows.length !== 1 ||
    row.kind !== "service_role_shadow_input_set" ||
    row.schemaVersion !== "1" ||
    fingerprintCanonicalArtifact(row.artifact) !== row.sha256) {
    throw new TypeError("service_role_shadow_input_set_stored_invalid");
  }
  const inputSet = parseServiceRoleShadowInputSetV1({
    artifact: row.artifact,
    expectedSha256: row.sha256
  });
  if (
    inputSet.runId !== input.runId ||
    inputSet.snapshotHash !== input.snapshotHash ||
    canonicalizeArtifactJson(inputSet.roleMapV2Sha256s) !==
      canonicalizeArtifactJson(input.roleMapV2Sha256s)
  ) {
    throw new TypeError("service_role_shadow_input_set_binding_invalid");
  }
  return inputSet;
}

async function loadFenceRows(
  client: UnifiedQueryable,
  runId: string
): Promise<StoredArtifactRow[]> {
  return (await client.query(
    `select sha256, created_by_run_id, kind, schema_version, artifact_json
       from unified_check_artifacts
      where created_by_run_id = $1
        and kind = 'service_role_shadow_input_fence'
        and schema_version = '1'
      order by sha256`,
    [runId]
  )).rows.map(storedArtifactRow);
}

function observedFromFences(
  fences: readonly ServiceRoleShadowInputFenceV1[]
): readonly string[] {
  return Object.freeze([...new Set(fences.flatMap((fence) =>
    fence.outcome.kind === "ready"
      ? [...fence.outcome.roleMapV2Sha256s]
      : [...(fence.outcome.observedRoleMapV2Sha256s ?? [])]
  ))].sort());
}

async function resolveExistingFence(
  client: UnifiedQueryable,
  input: {
    readonly runId: string;
    readonly snapshotHash: string;
    readonly runtimeCommit: string;
  }
): Promise<ExistingFenceResolution> {
  const rows = await loadFenceRows(client, input.runId);
  if (rows.length === 0) return { kind: "none" };
  const valid: Array<{
    readonly row: StoredArtifactRow;
    readonly fence: ServiceRoleShadowInputFenceV1;
  }> = [];
  for (const row of rows) {
    try {
      if (
        row.createdByRunId !== input.runId ||
        row.kind !== "service_role_shadow_input_fence" ||
        row.schemaVersion !== "1" ||
        fingerprintCanonicalArtifact(row.artifact) !== row.sha256
      ) continue;
      const fence = parseServiceRoleShadowInputFenceV1({
        artifact: row.artifact,
        expectedSha256: row.sha256
      });
      if (fence.runId !== input.runId || fence.snapshotHash !== input.snapshotHash) {
        continue;
      }
      valid.push({ row, fence });
    } catch {
      continue;
    }
  }
  const observedRoleMapV2Sha256s = observedFromFences(valid.map(({ fence }) => fence));
  if (rows.length !== 1 || valid.length !== 1 ||
    valid[0]!.fence.runtimeCommit !== input.runtimeCommit) {
    return {
      kind: "unavailable",
      reason: "conflict",
      observedRoleMapV2Sha256s
    };
  }
  const existing = valid[0]!;
  if (existing.fence.outcome.kind === "unavailable") {
    return {
      kind: "reuse",
      state: {
        fence: boundArtifact(existing.fence),
        mapsByCompoundBindingKey: emptyMapIndex()
      }
    };
  }
  try {
    await loadInputSet(client, {
      runId: input.runId,
      snapshotHash: input.snapshotHash,
      inputSetSha256: existing.fence.outcome.inputSetSha256,
      roleMapV2Sha256s: existing.fence.outcome.roleMapV2Sha256s
    });
    const maps = await loadValidatedMapsByHashes(client, {
      runId: input.runId,
      snapshotHash: input.snapshotHash,
      wrapperSha256s: existing.fence.outcome.roleMapV2Sha256s
    });
    return {
      kind: "reuse",
      state: {
        fence: boundArtifact(existing.fence),
        mapsByCompoundBindingKey: indexMaps(maps)
      }
    };
  } catch (error) {
    if (timeoutError(error) || !(error instanceof TypeError)) throw error;
    return {
      kind: "unavailable",
      reason: "conflict",
      observedRoleMapV2Sha256s
    };
  }
}

async function persistFence(
  client: UnifiedQueryable,
  input: {
    readonly runId: string;
    readonly snapshotHash: string;
    readonly runtimeCommit: string;
    readonly outcome: ServiceRoleShadowInputFenceV1["outcome"];
    readonly maps?: readonly ValidatedRoleMap[];
  }
): Promise<RuntimeState> {
  const fence = buildServiceRoleShadowInputFenceV1(input);
  await insertServiceRoleArtifact(client, {
    sha256: fence.sha256,
    createdByRunId: input.runId,
    kind: "service_role_shadow_input_fence",
    schemaVersion: "1",
    artifact: fence.artifact
  });
  return {
    fence,
    mapsByCompoundBindingKey: indexMaps(input.maps ?? [])
  };
}

async function insertServiceRoleArtifact(
  client: UnifiedQueryable,
  input: {
    readonly sha256: string;
    readonly createdByRunId: string;
    readonly kind: string;
    readonly schemaVersion: string;
    readonly artifact: unknown;
  }
): Promise<void> {
  let rawRow: unknown;
  try {
    rawRow = await insertUnifiedArtifact(client, input);
  } catch (error) {
    if (error instanceof Error && error.message === "unified_artifact_conflict") {
      throw new ServiceRoleArtifactInsertConflict();
    }
    throw error;
  }
  try {
    const row = storedArtifactRow(rawRow as Record<string, unknown>);
    if (
      row.sha256 !== input.sha256 ||
      row.createdByRunId !== input.createdByRunId ||
      row.kind !== input.kind ||
      row.schemaVersion !== input.schemaVersion ||
      fingerprintCanonicalArtifact(row.artifact) !== input.sha256 ||
      canonicalizeArtifactJson(row.artifact) !== canonicalizeArtifactJson(input.artifact)
    ) {
      throw new TypeError("inserted_artifact_mismatch");
    }
  } catch {
    throw new ServiceRoleArtifactInsertConflict();
  }
}

async function scanAndPublish(
  client: UnifiedQueryable,
  input: {
    readonly runId: string;
    readonly snapshotHash: string;
    readonly runtimeCommit: string;
  }
): Promise<RuntimeState> {
  const rawRows = (await client.query(
    `select sha256, created_by_run_id, kind, schema_version, artifact_json
       from unified_check_artifacts
      where created_by_run_id = $1
        and kind = 'service_role_event_role_map'
        and schema_version = '2'
      order by sha256`,
    [input.runId]
  )).rows;
  const observedRoleMapV2Sha256s = [...new Set(rawRows.flatMap((row) =>
    typeof row.sha256 === "string" && HASH.test(row.sha256) ? [row.sha256] : []
  ))].sort();
  if (rawRows.some((row) =>
    typeof row.sha256 !== "string" || !HASH.test(row.sha256))) {
    throw new FencePublicationRequest("malformed", observedRoleMapV2Sha256s);
  }
  let maps: ValidatedRoleMap[];
  try {
    const wrapperRows = rawRows.map(storedArtifactRow);
    maps = await validateWrapperRows(client, {
      runId: input.runId,
      snapshotHash: input.snapshotHash,
      expectedWrapperSha256s: observedRoleMapV2Sha256s,
      wrapperRows
    });
  } catch (error) {
    if (timeoutError(error)) throw error;
    if (!(error instanceof TypeError)) throw error;
    throw new FencePublicationRequest("malformed", observedRoleMapV2Sha256s);
  }
  const inputSet = buildServiceRoleShadowInputSetV1({
    runId: input.runId,
    snapshotHash: input.snapshotHash,
    roleMapV2Sha256s: observedRoleMapV2Sha256s
  });
  try {
    await insertServiceRoleArtifact(client, {
      sha256: inputSet.sha256,
      createdByRunId: input.runId,
      kind: "service_role_shadow_input_set",
      schemaVersion: "1",
      artifact: inputSet.artifact
    });
    return await persistFence(client, {
      ...input,
      outcome: {
        kind: "ready",
        inputSetSha256: inputSet.sha256,
        roleMapV2Sha256s: inputSet.artifact.roleMapV2Sha256s
      },
      maps
    });
  } catch (error) {
    if (error instanceof ServiceRoleArtifactInsertConflict) {
      throw new FencePublicationRequest("conflict", observedRoleMapV2Sha256s);
    }
    throw error;
  }
}

async function initializeNormally(
  db: UnifiedTransactionalQueryable,
  input: {
    readonly runId: string;
    readonly snapshotHash: string;
    readonly runtimeCommit: string;
  }
): Promise<RuntimeState> {
  return db.transaction(async (client) => {
    await setPreloadDeadlines(client);
    await takeRunAdvisoryLock(client, input.runId);
    await validateRunSnapshot(client, input, true);
    const existing = await resolveExistingFence(client, input);
    if (existing.kind === "reuse") return existing.state;
    if (existing.kind === "unavailable") {
      throw new FencePublicationRequest(
        existing.reason,
        existing.observedRoleMapV2Sha256s
      );
    }
    return scanAndPublish(client, input);
  });
}

async function publishUnavailable(
  db: UnifiedTransactionalQueryable,
  input: {
    readonly runId: string;
    readonly snapshotHash: string;
    readonly runtimeCommit: string;
  },
  request: FencePublicationRequest
): Promise<RuntimeState> {
  return db.transaction(async (client) => {
    await setPreloadDeadlines(client);
    await takeRunAdvisoryLock(client, input.runId);
    await validateRunSnapshot(client, input, false);
    const existing = await resolveExistingFence(client, input);
    if (existing.kind === "reuse") return existing.state;
    if (existing.kind === "unavailable") {
      return persistFence(client, {
        ...input,
        outcome: {
          kind: "unavailable",
          reason: existing.reason,
          observedRoleMapV2Sha256s: existing.observedRoleMapV2Sha256s
        }
      });
    }
    return persistFence(client, {
      ...input,
      outcome: {
        kind: "unavailable",
        reason: request.reason,
        observedRoleMapV2Sha256s: request.observedRoleMapV2Sha256s
      }
    });
  });
}

const PUBLICATION_ATTEMPTS = 2;
const DEFAULT_PENDING_GROUP_RETENTION_MS = 120_000;
const MAX_PENDING_ATTEMPTS = 512;
const RECONCILIATION_STATEMENT_DEADLINE_MS = 500;
// ponytail: PostgreSQL 16 has no transaction_timeout; the earlier monotonic
// budget plus one short in-flight statement leaves rollback/release headroom
// under the public second. Use transaction_timeout after a PostgreSQL 17 gate.
const RECOVERY_SWEEP_BUDGET_MS = 700;
const RECOVERY_STATEMENT_DEADLINE_MS = 150;

type RecoverySweepBudget = {
  readonly deadlineAtMs: number;
  readonly signal: AbortSignal;
};

function assertRecoverySweepBudget(budget: RecoverySweepBudget): void {
  if (budget.signal.aborted || performance.now() >= budget.deadlineAtMs) {
    throw new Error("service_role_shadow_recovery_budget_exhausted");
  }
}

function recoveryBudgetedClient(
  client: UnifiedQueryable,
  budget: RecoverySweepBudget
): UnifiedQueryable {
  return {
    async query(sql, values) {
      assertRecoverySweepBudget(budget);
      const result = await client.query(sql, values);
      assertRecoverySweepBudget(budget);
      return result;
    }
  };
}

function pendingAttemptKey(input: {
  readonly runId: string;
  readonly taskId: string;
  readonly attempt: number;
}): string {
  return JSON.stringify([input.runId, input.taskId, input.attempt]);
}

async function setReconciliationDeadlines(
  client: UnifiedQueryable,
  deadlineMs = RECONCILIATION_STATEMENT_DEADLINE_MS
): Promise<void> {
  await client.query(
    `SET LOCAL lock_timeout = '${deadlineMs}ms'`
  );
  await client.query(
    `SET LOCAL statement_timeout = '${deadlineMs}ms'`
  );
}

type CommittedPlannerEntryV1 = ServiceRoleShadowRuntimeReceiptV1[
  "committedEntries"
][number];

function validateCommittedEntries(
  value: readonly CommittedPlannerEntryV1[]
): readonly CommittedPlannerEntryV1[] | null {
  const entries = [...value];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (
      !Number.isSafeInteger(entry.canonicalSequence) ||
      entry.canonicalSequence < 0 ||
      !validRootText(entry.taskId) ||
      !validRootText(entry.acceptedAttemptId) ||
      !HASH.test(entry.artifactSha256) ||
      (index > 0 && entries[index - 1]!.canonicalSequence >=
        entry.canonicalSequence)
    ) return null;
  }
  return entries;
}

async function loadCommittedPlannerInventoryV1(
  client: UnifiedQueryable,
  runId: string,
  assertActive?: () => void
): Promise<{
  readonly rows: readonly Record<string, unknown>[];
  readonly entries: readonly CommittedPlannerEntryV1[];
} | null> {
  const rows = (await client.query(
    `select planner.canonical_sequence,
            task.id as task_id,
            task.kind as task_kind,
            task.logical_key,
            task.accepted_attempt_id,
            attempt.artifact_sha256
       from unified_check_planner_entries planner
       join unified_check_tasks task
         on task.run_id = planner.run_id
        and task.id = planner.task_id
       join unified_check_attempts attempt
         on attempt.id = task.accepted_attempt_id
        and attempt.task_id = task.id
      where planner.run_id = $1
        and planner.planner_state = 'committed'
        and task.status = 'COMPLETED'
        and task.cancellation_requested_at is null
      order by planner.canonical_sequence`,
    [runId]
  )).rows;
  const entries = validateCommittedEntries(rows.map((row) => {
    assertActive?.();
    return {
      canonicalSequence: Number(row.canonical_sequence),
      taskId: String(row.task_id),
      acceptedAttemptId: String(row.accepted_attempt_id),
      artifactSha256: String(row.artifact_sha256)
    };
  }));
  assertActive?.();
  return entries === null ? null : { rows, entries };
}

async function isReachableTraversalDeltaV1(input: {
  readonly client: UnifiedQueryable;
  readonly runId: string;
  readonly headSha256: string;
  readonly candidateSha256: string;
  readonly signal: AbortSignal;
}): Promise<boolean> {
  if (!HASH.test(input.headSha256) || !HASH.test(input.candidateSha256)) {
    return false;
  }
  let cursor: string | null = input.headSha256;
  const visited = new Set<string>();
  // ponytail: the hash-indexed walk is bounded by the caller's 500 ms DB
  // deadline; add an ancestry index only if measured recovery chains need it.
  while (cursor !== null && !visited.has(cursor)) {
    if (input.signal.aborted) return false;
    visited.add(cursor);
    const [deltaRow] = await loadArtifactsByHashes(
      input.client,
      input.runId,
      [cursor]
    );
    if (
      !deltaRow ||
      deltaRow.kind !== "traversal_delta" ||
      deltaRow.schemaVersion !== "1" ||
      fingerprintCanonicalArtifact(deltaRow.artifact) !== cursor ||
      deltaRow.artifact === null ||
      typeof deltaRow.artifact !== "object" ||
      Array.isArray(deltaRow.artifact) ||
      (deltaRow.artifact as { version?: unknown }).version !==
        "unified-traversal-delta-v1"
    ) return false;
    const previous = (
      deltaRow.artifact as { previousDeltaHash?: unknown }
    ).previousDeltaHash;
    if (previous !== null &&
      (typeof previous !== "string" || !HASH.test(previous))) return false;
    if (cursor === input.candidateSha256) return true;
    cursor = previous as string | null;
  }
  return false;
}

async function reconcileDurablePrecommitV1(input: {
  readonly client: UnifiedQueryable;
  readonly runtimeCommit: string;
  readonly runId: string;
  readonly traversalTaskId: string;
  readonly traversalAttempt: number;
  readonly precommitSha256: string;
  readonly committedCheckpoint: unknown;
  readonly committedEntries: readonly CommittedPlannerEntryV1[];
  readonly signal: AbortSignal;
}): Promise<string | null> {
  if (input.signal.aborted) return null;
  const checkpoint = input.committedCheckpoint;
  if (checkpoint === null || typeof checkpoint !== "object" ||
    Array.isArray(checkpoint)) return null;
  const committedDeltaHeadSha256 = (
    checkpoint as { deltaHeadSha256?: unknown }
  ).deltaHeadSha256;
  if (typeof committedDeltaHeadSha256 !== "string" ||
    !HASH.test(committedDeltaHeadSha256)) return null;
  const committedEntries = validateCommittedEntries(input.committedEntries);
  if (committedEntries === null) return null;
  const [precommitRow] = await loadArtifactsByHashes(
    input.client,
    input.runId,
    [input.precommitSha256]
  );
  if (
    !precommitRow ||
    precommitRow.kind !== "service_role_shadow_precommit_receipt" ||
    precommitRow.schemaVersion !== "1"
  ) return null;
  const precommit = parseServiceRoleShadowPrecommitReceiptV1({
    artifact: precommitRow.artifact,
    expectedSha256: input.precommitSha256
  });
  if (precommit.runId !== input.runId) return null;
  const matchingEntries = committedEntries.filter((entry) =>
    entry.artifactSha256 === precommit.manifestSha256
  );
  if (matchingEntries.length !== 1 || input.signal.aborted) return null;
  const expectedHashes = [...new Set([
    precommit.inputFenceSha256,
    precommit.inputSetSha256,
    ...precommit.profiles.map((profile) => profile.profileSha256)
  ])].sort(compareCodeUnits);
  const rows = await loadArtifactsByHashes(
    input.client,
    input.runId,
    expectedHashes
  );
  if (rows.length !== expectedHashes.length) return null;
  const byHash = new Map(rows.map((row) => [row.sha256, row]));
  const fenceRow = byHash.get(precommit.inputFenceSha256);
  const inputSetRow = byHash.get(precommit.inputSetSha256);
  if (
    !fenceRow ||
    fenceRow.kind !== "service_role_shadow_input_fence" ||
    fenceRow.schemaVersion !== "1" ||
    !inputSetRow ||
    inputSetRow.kind !== "service_role_shadow_input_set" ||
    inputSetRow.schemaVersion !== "1"
  ) return null;
  const fence = parseServiceRoleShadowInputFenceV1({
    artifact: fenceRow.artifact,
    expectedSha256: precommit.inputFenceSha256
  });
  const inputSet = parseServiceRoleShadowInputSetV1({
    artifact: inputSetRow.artifact,
    expectedSha256: precommit.inputSetSha256
  });
  if (
    fence.runId !== input.runId ||
    fence.snapshotHash !== precommit.snapshotHash ||
    fence.runtimeCommit !== input.runtimeCommit ||
    fence.outcome.kind !== "ready" ||
    fence.outcome.inputSetSha256 !== precommit.inputSetSha256 ||
    inputSet.runId !== input.runId ||
    inputSet.snapshotHash !== precommit.snapshotHash
  ) return null;
  for (const profile of precommit.profiles) {
    const row = byHash.get(profile.profileSha256);
    if (
      !row ||
      row.kind !== "service_role_shadow_profile" ||
      row.schemaVersion !== "1" ||
      fingerprintCanonicalArtifact(row.artifact) !== profile.profileSha256
    ) return null;
  }

  if (!await isReachableTraversalDeltaV1({
    client: input.client,
    runId: input.runId,
    headSha256: committedDeltaHeadSha256,
    candidateSha256: precommit.candidateDeltaSha256,
    signal: input.signal
  }) || input.signal.aborted) return null;
  const receipt = buildServiceRoleShadowRuntimeReceiptV1({
    runId: precommit.runId,
    snapshotHash: precommit.snapshotHash,
    runtimeCommit: input.runtimeCommit,
    traversalTaskId: input.traversalTaskId,
    traversalAttempt: input.traversalAttempt,
    inputFenceSha256: precommit.inputFenceSha256,
    inputSetSha256: precommit.inputSetSha256,
    compoundBindingKey: precommit.compoundBindingKey,
    precommitSha256: input.precommitSha256,
    manifestKey: precommit.manifestKey,
    manifestSha256: precommit.manifestSha256,
    acceptedPageArtifactHashes: precommit.acceptedPageArtifactHashes,
    candidateCheckpointSha256: precommit.candidateCheckpointSha256,
    candidateDeltaSha256: precommit.candidateDeltaSha256,
    committedCheckpointSha256: fingerprintCanonicalArtifact(checkpoint),
    committedDeltaHeadSha256,
    committedEntries,
    profiles: precommit.profiles
  });
  await insertServiceRoleArtifact(input.client, {
    sha256: receipt.sha256,
    createdByRunId: input.runId,
    kind: "service_role_shadow_runtime_receipt",
    schemaVersion: "1",
    artifact: receipt.artifact
  });
  if (input.signal.aborted) {
    throw new Error("service_role_shadow_reconciliation_aborted");
  }
  return receipt.sha256;
}

type AcceptedTraversalInventoryV1 = {
  readonly taskId: string;
  readonly acceptedAttemptId: string;
  readonly artifactSha256: string;
  readonly analysisManifestSha256: string;
  readonly subjectAddress: string;
  readonly snapshotHash: string;
  readonly states: readonly Parameters<typeof traversalStateId>[0][];
};

function parseAcceptedTraversalInventoryV1(input: {
  readonly row: Record<string, unknown>;
  readonly runId: string;
  readonly assertActive?: () => void;
}): AcceptedTraversalInventoryV1 {
  input.assertActive?.();
  if (
    !validRootText(input.row.task_id) ||
    !validRootText(input.row.accepted_attempt_id) ||
    typeof input.row.artifact_sha256 !== "string" ||
    !HASH.test(input.row.artifact_sha256) ||
    typeof input.row.analysis_manifest_sha256 !== "string" ||
    !HASH.test(input.row.analysis_manifest_sha256) ||
    !validRootText(input.row.subject_address)
  ) throw new TypeError("service_role_shadow_traversal_authority_invalid");
  const artifact = exactRecord(input.row.artifact_json, [
    "version",
    "schemaVersion",
    "runId",
    "analysisManifestHash",
    "snapshotHash",
    "visitedStates",
    "frontier",
    "terminalStates",
    "supersededStateIds",
    "eligibleEventIds",
    "eligibleEventCount",
    "directionCount",
    "fundingEpisodeCount",
    "expandedStateCount",
    "allocatedInputRaw",
    "terminalRaw",
    "residualRaw",
    "backwardCoverage",
    "forwardCoverage",
    "closed"
  ]);
  if (
    artifact.version !== "unified-traversal-artifact-v1" ||
    artifact.schemaVersion !== 1 ||
    artifact.runId !== input.runId ||
    artifact.analysisManifestHash !== input.row.analysis_manifest_sha256 ||
    typeof artifact.snapshotHash !== "string" ||
    !HASH.test(artifact.snapshotHash) ||
    artifact.closed !== true ||
    exactDenseArray(artifact.frontier).length !== 0 ||
    fingerprintCanonicalArtifact(input.row.artifact_json) !==
      input.row.artifact_sha256
  ) throw new TypeError("service_role_shadow_traversal_artifact_invalid");
  const states = exactDenseArray(artifact.visitedStates).map((value) => {
    input.assertActive?.();
    const state = exactRecord(value, [
      "address",
      "direction",
      "anchorTimestamp",
      "fundingEpisodeId",
      "allocatedAmountRaw",
      "sourceEventIds"
    ]);
    if (
      !validRootText(state.address) ||
      (state.direction !== "backward" && state.direction !== "forward") ||
      !validRootText(state.anchorTimestamp) ||
      !validRootText(state.fundingEpisodeId) ||
      typeof state.allocatedAmountRaw !== "string" ||
      !/^(0|[1-9][0-9]*)$/u.test(state.allocatedAmountRaw)
    ) throw new TypeError("service_role_shadow_traversal_state_invalid");
    const sourceEventIds = exactDenseArray(state.sourceEventIds).map((id) => {
      input.assertActive?.();
      if (!validRootText(id)) {
        throw new TypeError("service_role_shadow_traversal_state_invalid");
      }
      return id;
    });
    if (new Set(sourceEventIds).size !== sourceEventIds.length) {
      throw new TypeError("service_role_shadow_traversal_state_invalid");
    }
    const parsed = Object.freeze({
      address: state.address,
      direction: state.direction,
      anchorTimestamp: state.anchorTimestamp,
      fundingEpisodeId: state.fundingEpisodeId,
      allocatedAmountRaw: state.allocatedAmountRaw,
      sourceEventIds: Object.freeze([...sourceEventIds])
    });
    traversalStateId(parsed);
    return parsed;
  });
  if (new Set(states.map(traversalStateId)).size !== states.length) {
    throw new TypeError("service_role_shadow_traversal_state_duplicate");
  }
  return Object.freeze({
    taskId: input.row.task_id,
    acceptedAttemptId: input.row.accepted_attempt_id,
    artifactSha256: input.row.artifact_sha256,
    analysisManifestSha256: input.row.analysis_manifest_sha256,
    subjectAddress: input.row.subject_address,
    snapshotHash: artifact.snapshotHash,
    states: Object.freeze(states)
  });
}

type AcceptedHistoryInventoryV1 = {
  readonly entry: CommittedPlannerEntryV1;
  readonly manifestKey: string;
  readonly manifestSha256: string;
  readonly pageArtifactHashes: readonly string[];
  readonly address: string;
  readonly events: readonly IndexedTronUsdtTransfer[];
};

const SERVICE_PROFILE_INSUFFICIENT_REASONS = new Set([
  "checked_subject_excluded",
  "anchor_unproven",
  "recent_window_incomplete",
  "historical_window_incomplete",
  "order_unproven",
  "role_map_missing",
  "role_authority_missing",
  "role_authority_conflict",
  "source_binding_invalid"
]);

const COMPLETE_VECTOR_NUMBER_KEYS = [
  "physicalRowCount",
  "canonicalEventCount",
  "featureEligibleEventCount",
  "invalidPhysicalRowCount",
  "collisionPhysicalRowCount",
  "duplicatePhysicalRowCount",
  "poisoningOnlyEventCount",
  "gasFreeFeeEventCount",
  "gasFreePrincipalEventCount",
  "incomingCount",
  "outgoingCount",
  "uniqueSenders",
  "uniqueRecipients",
  "uniqueCounterparties",
  "largestCounterpartyCount",
  "largestCounterpartyShareDenominator",
  "dominantDirectionCount",
  "uniqueDominantCounterparties",
  "dominantShareDenominator",
  "maxDominantDirectionEventsPerHour",
  "activeUtcHourOfDayCount",
  "dominantExactAmountCount",
  "dominantExactAmountShareDenominator",
  "observedWindowDurationSeconds"
] as const;

function strictProfileStrings(input: unknown, options?: {
  readonly hash?: boolean;
  readonly sorted?: boolean;
  readonly nonEmpty?: boolean;
}): readonly string[] {
  const values = exactDenseArray(input).map((value) => {
    if (!validRootText(value) || (options?.hash === true && !HASH.test(value))) {
      throw new TypeError("invalid_profile_array");
    }
    return value;
  });
  if (options?.nonEmpty === true && values.length === 0) {
    throw new TypeError("invalid_profile_array");
  }
  if (new Set(values).size !== values.length) {
    throw new TypeError("invalid_profile_array");
  }
  if (options?.sorted === true && values.some((value, index) =>
    index > 0 && values[index - 1]! >= value
  )) throw new TypeError("invalid_profile_array");
  return values;
}

function validateProfilePredicates(value: unknown): void {
  const predicates = exactRecord(value, ["C", "B", "G", "H", "R", "X"]);
  if (Object.values(predicates).some((predicate) => typeof predicate !== "boolean")) {
    throw new TypeError("invalid_profile_predicates");
  }
}

function validateProfileVector(value: unknown): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("invalid_profile_vector");
  }
  const kind = (value as { kind?: unknown }).kind;
  if (kind === "incomplete") {
    const vector = exactRecord(value, [
      "kind",
      "physicalRowCount",
      "canonicalEventCount",
      "orderAuthoritative",
      "observedStartSeconds",
      "observedEndSeconds"
    ]);
    if (
      !Number.isSafeInteger(vector.physicalRowCount) ||
      (vector.physicalRowCount as number) < 0 ||
      !Number.isSafeInteger(vector.canonicalEventCount) ||
      (vector.canonicalEventCount as number) < 0 ||
      typeof vector.orderAuthoritative !== "boolean" ||
      ![vector.observedStartSeconds, vector.observedEndSeconds].every((item) =>
        item === null || Number.isSafeInteger(item)
      )
    ) throw new TypeError("invalid_profile_vector");
    return;
  }
  const vector = exactRecord(value, [
    "kind",
    ...COMPLETE_VECTOR_NUMBER_KEYS,
    "dominantDirection",
    "medianDominantDirectionGapSeconds",
    "dominantExactAmountRaw",
    "observedStartSeconds",
    "observedEndSeconds",
    "orderAuthoritative"
  ]);
  if (
    vector.kind !== "complete" ||
    COMPLETE_VECTOR_NUMBER_KEYS.some((key) =>
      !Number.isSafeInteger(vector[key]) || (vector[key] as number) < 0
    ) ||
    !["incoming", "outgoing", null].includes(
      vector.dominantDirection as "incoming" | "outgoing" | null
    ) ||
    (vector.dominantExactAmountRaw !== null &&
      (typeof vector.dominantExactAmountRaw !== "string" ||
        !/^(0|[1-9][0-9]*)$/u.test(vector.dominantExactAmountRaw))) ||
    ![vector.observedStartSeconds, vector.observedEndSeconds].every((item) =>
      item === null || Number.isSafeInteger(item)
    ) ||
    typeof vector.orderAuthoritative !== "boolean"
  ) throw new TypeError("invalid_profile_vector");
  if (vector.medianDominantDirectionGapSeconds !== null) {
    const median = exactRecord(vector.medianDominantDirectionGapSeconds, [
      "numerator", "denominator"
    ]);
    if (!Number.isSafeInteger(median.numerator) ||
      (median.numerator as number) < 0 ||
      (median.denominator !== 1 && median.denominator !== 2)) {
      throw new TypeError("invalid_profile_vector");
    }
  }
}

function isStrictServiceRoleShadowProfileV1(input: {
  readonly row: StoredArtifactRow;
  readonly runId: string;
  readonly snapshotHash: string;
}): boolean {
  try {
    if (
      input.row.kind !== "service_role_shadow_profile" ||
      input.row.schemaVersion !== "1" ||
      fingerprintCanonicalArtifact(input.row.artifact) !== input.row.sha256
    ) return false;
    const root = exactRecord(input.row.artifact, [
      "schemaVersion",
      "policyVersion",
      "runId",
      "snapshotHash",
      "subjectAddress",
      "profiledAddress",
      "traversalStateId",
      "anchor",
      "source",
      "sampledCanonicalEventIds",
      "result",
      "productionEffect"
    ]);
    if (
      root.schemaVersion !== "service-role-shadow-profile-v1" ||
      root.policyVersion !== POLICY_VERSION ||
      root.runId !== input.runId ||
      root.snapshotHash !== input.snapshotHash ||
      !validRootText(root.subjectAddress) ||
      !validRootText(root.profiledAddress) ||
      typeof root.traversalStateId !== "string" ||
      !HASH.test(root.traversalStateId) ||
      root.productionEffect !== false
    ) return false;
    const anchor = exactRecord(root.anchor, ["timestamp", "sourceEventIds"]);
    const anchorTime = typeof anchor.timestamp === "string"
      ? new Date(anchor.timestamp)
      : null;
    if (anchorTime === null || Number.isNaN(anchorTime.getTime()) ||
      anchorTime.toISOString() !== anchor.timestamp) return false;
    strictProfileStrings(anchor.sourceEventIds, { sorted: true });
    const source = exactRecord(root.source, [
      "evidenceClass",
      "manifestKey",
      "manifestSha256",
      "acceptedPageArtifactHashes",
      "eventRoleMapSha256",
      "physicalPageRequestHashes",
      "boundaryPageAuthority"
    ]);
    if (
      source.evidenceClass !== "accepted_history_reconstruction" ||
      !validRootText(source.manifestKey) ||
      typeof source.manifestSha256 !== "string" ||
      !HASH.test(source.manifestSha256) ||
      (source.eventRoleMapSha256 !== null &&
        (typeof source.eventRoleMapSha256 !== "string" ||
          !HASH.test(source.eventRoleMapSha256))) ||
      exactDenseArray(source.physicalPageRequestHashes).length !== 0 ||
      source.boundaryPageAuthority !== false
    ) return false;
    strictProfileStrings(source.acceptedPageArtifactHashes, {
      hash: true,
      nonEmpty: true
    });
    const sampled = exactRecord(root.sampledCanonicalEventIds, [
      "recent", "historical"
    ]);
    strictProfileStrings(sampled.recent);
    strictProfileStrings(sampled.historical);
    const result = exactRecord(root.result, [
      "status", "insufficientReason", "classifier"
    ]);
    if (result.classifier === null) {
      return result.status === "insufficient_data" &&
        typeof result.insufficientReason === "string" &&
        SERVICE_PROFILE_INSUFFICIENT_REASONS.has(result.insufficientReason);
    }
    const classifier = exactRecord(result.classifier, [
      "status",
      "recentVector",
      "historicalVector",
      "recentPredicates",
      "historicalPredicates"
    ]);
    if (
      result.insufficientReason !== null ||
      result.status !== classifier.status ||
      ![
        "high_inferred_service",
        "non_service_profile",
        "insufficient_data",
        "role_conflict"
      ].includes(classifier.status as string)
    ) return false;
    validateProfileVector(classifier.recentVector);
    validateProfileVector(classifier.historicalVector);
    validateProfilePredicates(classifier.recentPredicates);
    validateProfilePredicates(classifier.historicalPredicates);
    return true;
  } catch {
    return false;
  }
}

async function loadAcceptedHistoryInventoryV1(input: {
  readonly client: UnifiedQueryable;
  readonly runId: string;
  readonly snapshotHash: string;
  readonly row: Record<string, unknown>;
  readonly assertActive?: () => void;
}): Promise<AcceptedHistoryInventoryV1> {
  input.assertActive?.();
  const entry: CommittedPlannerEntryV1 = {
    canonicalSequence: Number(input.row.canonical_sequence),
    taskId: String(input.row.task_id),
    acceptedAttemptId: String(input.row.accepted_attempt_id),
    artifactSha256: String(input.row.artifact_sha256)
  };
  if (validateCommittedEntries([entry]) === null ||
    !validRootText(input.row.logical_key)) {
    throw new TypeError("service_role_shadow_history_authority_invalid");
  }
  const [manifestRow] = await loadArtifactsByHashes(
    input.client,
    input.runId,
    [entry.artifactSha256]
  );
  if (
    !manifestRow ||
    manifestRow.kind !== "address_history_manifest" ||
    manifestRow.schemaVersion !== "1" ||
    fingerprintCanonicalArtifact(manifestRow.artifact) !== entry.artifactSha256
  ) throw new TypeError("service_role_shadow_history_manifest_invalid");
  const manifest = manifestRow.artifact as Partial<AddressHistoryManifestV1>;
  if (
    manifest.version !== "unified-address-history-manifest-v1" ||
    manifest.schemaVersion !== 1 ||
    manifest.chain !== "tron" ||
    manifest.snapshotHash !== input.snapshotHash ||
    typeof manifest.tokenContract !== "string" ||
    typeof manifest.address !== "string" ||
    typeof manifest.providerRequestVersion !== "string" ||
    typeof manifest.key !== "string" ||
    manifest.key !== input.row.logical_key ||
    !Array.isArray(manifest.pageArtifactHashes) ||
    typeof manifest.rawRowCount !== "number" ||
    typeof manifest.duplicateCount !== "number" ||
    manifest.exhaustion === undefined
  ) throw new TypeError("service_role_shadow_history_manifest_invalid");
  const pageHashes = manifest.pageArtifactHashes;
  const pageRows = await loadArtifactsByHashes(
    input.client,
    input.runId,
    pageHashes
  );
  if (pageRows.length !== pageHashes.length) {
    throw new TypeError("service_role_shadow_history_page_invalid");
  }
  const pagesByHash = new Map(pageRows.map((row) => [row.sha256, row]));
  const byEventId = new Map<string, IndexedTronUsdtTransfer>();
  let rawRowCount = 0;
  for (const pageSha256 of pageHashes) {
    input.assertActive?.();
    const row = pagesByHash.get(pageSha256);
    if (
      !row ||
      row.kind !== "address_history_page" ||
      row.schemaVersion !== "1" ||
      fingerprintCanonicalArtifact(row.artifact) !== pageSha256
    ) throw new TypeError("service_role_shadow_history_page_invalid");
    const page = row.artifact as Partial<UnifiedAddressHistoryPageArtifactV1>;
    if (
      page.version !== "unified-address-history-page-v1" ||
      page.schemaVersion !== 1 ||
      page.runId !== input.runId ||
      page.manifestKey !== manifest.key ||
      typeof page.providerPageHash !== "string" ||
      !HASH.test(page.providerPageHash) ||
      !Number.isSafeInteger(page.rawRowCount) ||
      (page.rawRowCount ?? -1) < 0 ||
      !Array.isArray(page.events)
    ) throw new TypeError("service_role_shadow_history_page_invalid");
    rawRowCount += page.rawRowCount as number;
    for (const serialized of page.events) {
      input.assertActive?.();
      const blockTimestamp = new Date(serialized.blockTimestamp);
      if (Number.isNaN(blockTimestamp.getTime()) ||
        blockTimestamp.toISOString() !== serialized.blockTimestamp) {
        throw new TypeError("service_role_shadow_history_page_invalid");
      }
      const event = { ...serialized, blockTimestamp } as IndexedTronUsdtTransfer;
      const eventId = canonicalTronUsdtEventKey(event);
      const prior = byEventId.get(eventId);
      if (prior && fingerprintCanonicalArtifact(prior) !==
        fingerprintCanonicalArtifact(event)) {
        throw new TypeError("service_role_shadow_history_event_conflict");
      }
      byEventId.set(eventId, event);
    }
  }
  const eventEntries = [...byEventId.entries()].sort(([left], [right]) =>
    compareCodeUnits(left, right)
  );
  const rebuilt = buildAddressHistoryManifest({
    chain: "tron",
    snapshotHash: input.snapshotHash,
    tokenContract: manifest.tokenContract,
    address: manifest.address,
    providerRequestVersion: manifest.providerRequestVersion,
    pageArtifactHashes: pageHashes,
    canonicalEventIds: eventEntries.map(([eventId]) => eventId),
    rawRowCount,
    duplicateCount: manifest.duplicateCount,
    exhaustion: manifest.exhaustion
  });
  if (
    addressHistoryManifestKey(rebuilt) !== manifest.key ||
    fingerprintCanonicalArtifact(rebuilt) !== entry.artifactSha256
  ) throw new TypeError("service_role_shadow_history_manifest_invalid");
  return Object.freeze({
    entry,
    manifestKey: rebuilt.key,
    manifestSha256: entry.artifactSha256,
    pageArtifactHashes: Object.freeze([...rebuilt.pageArtifactHashes]),
    address: rebuilt.address,
    events: Object.freeze(eventEntries.map(([, event]) => event))
  });
}

async function validateRuntimeReceiptClosureV1(input: {
  readonly client: UnifiedQueryable;
  readonly runtimeCommit: string;
  readonly runId: string;
  readonly traversalTaskId: string;
  readonly traversalAttempt: number;
  readonly currentCheckpoint: unknown;
  readonly currentEntries: readonly CommittedPlannerEntryV1[];
  readonly receiptRow: StoredArtifactRow;
  readonly precommitSha256?: string;
  readonly signal: AbortSignal;
}): Promise<ServiceRoleShadowRuntimeReceiptV1 | null> {
  try {
    if (
      input.receiptRow.kind !== "service_role_shadow_runtime_receipt" ||
      input.receiptRow.schemaVersion !== "1" ||
      fingerprintCanonicalArtifact(input.receiptRow.artifact) !==
        input.receiptRow.sha256
    ) return null;
    const receipt = parseServiceRoleShadowRuntimeReceiptV1({
      artifact: input.receiptRow.artifact,
      expectedSha256: input.receiptRow.sha256
    });
    if (
      receipt.runId !== input.runId ||
      receipt.runtimeCommit !== input.runtimeCommit ||
      receipt.traversalTaskId !== input.traversalTaskId ||
      receipt.traversalAttempt !== input.traversalAttempt ||
      (input.precommitSha256 !== undefined &&
        receipt.precommitSha256 !== input.precommitSha256)
    ) return null;
    const checkpoint = input.currentCheckpoint;
    if (checkpoint === null || typeof checkpoint !== "object" ||
      Array.isArray(checkpoint)) return null;
    const currentHead = (checkpoint as { deltaHeadSha256?: unknown })
      .deltaHeadSha256;
    if (typeof currentHead !== "string" || !HASH.test(currentHead)) return null;
    const currentEntries = new Map(input.currentEntries.map((entry) => [
      entry.canonicalSequence,
      entry
    ]));
    if (!receipt.committedEntries.every((entry) =>
      canonicalizeArtifactJson(currentEntries.get(entry.canonicalSequence)) ===
        canonicalizeArtifactJson(entry)
    )) return null;
    const [precommitRow] = await loadArtifactsByHashes(
      input.client,
      input.runId,
      [receipt.precommitSha256]
    );
    if (
      !precommitRow ||
      precommitRow.kind !== "service_role_shadow_precommit_receipt" ||
      precommitRow.schemaVersion !== "1"
    ) return null;
    const precommit = parseServiceRoleShadowPrecommitReceiptV1({
      artifact: precommitRow.artifact,
      expectedSha256: receipt.precommitSha256
    });
    if (
      precommit.runId !== input.runId ||
      receipt.snapshotHash !== precommit.snapshotHash ||
      receipt.inputFenceSha256 !== precommit.inputFenceSha256 ||
      receipt.inputSetSha256 !== precommit.inputSetSha256 ||
      receipt.compoundBindingKey !== precommit.compoundBindingKey ||
      receipt.manifestKey !== precommit.manifestKey ||
      receipt.manifestSha256 !== precommit.manifestSha256 ||
      receipt.candidateCheckpointSha256 !==
        precommit.candidateCheckpointSha256 ||
      receipt.candidateDeltaSha256 !== precommit.candidateDeltaSha256 ||
      canonicalizeArtifactJson(receipt.acceptedPageArtifactHashes) !==
        canonicalizeArtifactJson(precommit.acceptedPageArtifactHashes) ||
      canonicalizeArtifactJson(receipt.profiles) !==
        canonicalizeArtifactJson(precommit.profiles) ||
      receipt.committedEntries.filter((entry) =>
        entry.artifactSha256 === precommit.manifestSha256
      ).length !== 1
    ) return null;
    const closureHashes = [...new Set([
      precommit.inputFenceSha256,
      precommit.inputSetSha256,
      ...precommit.acceptedPageArtifactHashes,
      ...precommit.profiles.map((profile) => profile.profileSha256)
    ])].sort(compareCodeUnits);
    const closureRows = await loadArtifactsByHashes(
      input.client,
      input.runId,
      closureHashes
    );
    if (closureRows.length !== closureHashes.length) return null;
    const closureByHash = new Map(closureRows.map((row) => [row.sha256, row]));
    const fenceRow = closureByHash.get(precommit.inputFenceSha256);
    const inputSetRow = closureByHash.get(precommit.inputSetSha256);
    if (
      !fenceRow ||
      fenceRow.kind !== "service_role_shadow_input_fence" ||
      fenceRow.schemaVersion !== "1" ||
      !inputSetRow ||
      inputSetRow.kind !== "service_role_shadow_input_set" ||
      inputSetRow.schemaVersion !== "1"
    ) return null;
    const fence = parseServiceRoleShadowInputFenceV1({
      artifact: fenceRow.artifact,
      expectedSha256: precommit.inputFenceSha256
    });
    const inputSet = parseServiceRoleShadowInputSetV1({
      artifact: inputSetRow.artifact,
      expectedSha256: precommit.inputSetSha256
    });
    if (
      fence.runId !== input.runId ||
      fence.snapshotHash !== precommit.snapshotHash ||
      fence.runtimeCommit !== input.runtimeCommit ||
      fence.outcome.kind !== "ready" ||
      fence.outcome.inputSetSha256 !== precommit.inputSetSha256 ||
      inputSet.runId !== input.runId ||
      inputSet.snapshotHash !== precommit.snapshotHash ||
      !precommit.profiles.every((profile) => {
        const row = closureByHash.get(profile.profileSha256);
        return row?.kind === "service_role_shadow_profile" &&
          row.schemaVersion === "1" &&
          fingerprintCanonicalArtifact(row.artifact) === profile.profileSha256;
      })
    ) return null;
    if (!await isReachableTraversalDeltaV1({
      client: input.client,
      runId: input.runId,
      headSha256: currentHead,
      candidateSha256: receipt.committedDeltaHeadSha256,
      signal: input.signal
    })) return null;
    if (!await isReachableTraversalDeltaV1({
      client: input.client,
      runId: input.runId,
      headSha256: receipt.committedDeltaHeadSha256,
      candidateSha256: receipt.candidateDeltaSha256,
      signal: input.signal
    })) return null;
    if (
      currentHead === receipt.committedDeltaHeadSha256 &&
      fingerprintCanonicalArtifact(checkpoint) !== receipt.committedCheckpointSha256
    ) return null;
    return receipt;
  } catch {
    return null;
  }
}

async function convergeUnavailable(
  db: UnifiedTransactionalQueryable,
  input: {
    readonly runId: string;
    readonly snapshotHash: string;
    readonly runtimeCommit: string;
  },
  request: FencePublicationRequest
): Promise<RuntimeState> {
  // ponytail: Two one-second publication attempts cap an externally held lock at
  // about two seconds; scheduler-owned retry is the upgrade path, while cache
  // eviction lets a later caller retry until that owner exists.
  for (let attempt = 1; attempt <= PUBLICATION_ATTEMPTS; attempt += 1) {
    try {
      return await publishUnavailable(db, input, request);
    } catch (error) {
      if (!timeoutError(error) || attempt === PUBLICATION_ATTEMPTS) throw error;
    }
  }
  throw new Error("service_role_shadow_publication_attempts_exhausted");
}

async function initializeState(
  db: UnifiedTransactionalQueryable,
  input: {
    readonly runId: string;
    readonly snapshotHash: string;
    readonly runtimeCommit: string;
  }
): Promise<RuntimeState> {
  let request: FencePublicationRequest;
  try {
    return await initializeNormally(db, input);
  } catch (error) {
    if (error instanceof FencePublicationRequest) {
      request = error;
    } else if (timeoutError(error)) {
      request = new FencePublicationRequest("preload_timeout", null);
    } else {
      throw error;
    }
  }
  return convergeUnavailable(db, input, request);
}

export function createServiceRoleShadowRuntimeV1(input: {
  readonly db: UnifiedTransactionalQueryable;
  readonly runtimeCommit: string;
  readonly pendingGroupRetentionMs?: number;
}): {
  loadInputFence(run: {
    readonly runId: string;
    readonly snapshotHash: string;
  }): Promise<{
    readonly sha256: string;
    readonly artifact: ServiceRoleShadowInputFenceV1;
  }>;
  lookupMap(lookup: {
    readonly runId: string;
    readonly snapshotHash: string;
    readonly compoundBindingKey: string;
  }): Promise<ServiceRoleShadowMapLookupV1>;
  observeAcceptedAddressHistoryGroup(
    group: AcceptedAddressHistoryShadowGroupInput
  ): Promise<void>;
  reconcileCheckpoint(reconciliation: {
    readonly task: UnifiedWorkerTask;
    readonly result: Extract<UnifiedChunkOutcome, { kind: "checkpoint" }>;
    readonly checkpointCommit: UnifiedCheckpointCommitResult;
    readonly signal: AbortSignal;
  }): Promise<void>;
  summarizeRun(summary: {
    readonly runId: string;
    readonly signal: AbortSignal;
  }): Promise<BoundArtifact<ServiceRoleShadowRunSummaryV1> | null>;
  reconcileCommittedServiceRoleShadowRunsV1(input: {
    readonly signal: AbortSignal;
  }): Promise<void>;
} {
  if (!validRootText(input.runtimeCommit)) {
    throw new TypeError("service_role_shadow_runtime_commit_invalid");
  }
  const pendingGroupRetentionMs = input.pendingGroupRetentionMs ??
    DEFAULT_PENDING_GROUP_RETENTION_MS;
  if (
    !Number.isSafeInteger(pendingGroupRetentionMs) ||
    pendingGroupRetentionMs < 1 ||
    pendingGroupRetentionMs > 2_147_483_647
  ) {
    throw new TypeError("service_role_shadow_pending_retention_invalid");
  }
  const cache = new Map<string, {
    readonly snapshotHash: string;
    readonly statePromise: Promise<RuntimeState>;
    readonly fencePromise: Promise<{
      readonly sha256: string;
      readonly artifact: ServiceRoleShadowInputFenceV1;
    }>;
  }>();
  // ponytail: at most 512 live task attempts remain in memory for twice the
  // worker lease; Task 7's durable sweep recovers expirations and overflow.
  const pendingAttempts = new Map<string, PendingAttemptV1>();

  const retirePendingAttempt = (key: string): void => {
    const pending = pendingAttempts.get(key);
    if (!pending) return;
    if (pending.expires !== null) clearTimeout(pending.expires);
    pendingAttempts.delete(key);
  };

  const retainPendingGroup = (group: {
    readonly runId: string;
    readonly taskId: string;
    readonly attempt: number;
    readonly precommitSha256: string;
  }): void => {
    const key = pendingAttemptKey(group);
    let pending = pendingAttempts.get(key);
    if (pending) {
      if (pending.expires !== null) clearTimeout(pending.expires);
      pendingAttempts.delete(key);
    } else {
      if (pendingAttempts.size >= MAX_PENDING_ATTEMPTS) {
        const oldestKey = pendingAttempts.keys().next().value as
          | string
          | undefined;
        if (oldestKey !== undefined) retirePendingAttempt(oldestKey);
      }
      pending = {
        groups: new Map(),
        expires: null
      };
    }
    pending.groups.set(group.precommitSha256, {
      runId: group.runId,
      taskId: group.taskId,
      attempt: group.attempt,
      precommitSha256: group.precommitSha256
    });
    pending.expires = setTimeout(() => {
      if (pendingAttempts.get(key) === pending) retirePendingAttempt(key);
    }, pendingGroupRetentionMs);
    pending.expires.unref?.();
    pendingAttempts.set(key, pending);
  };

  const cacheEntry = (run: {
    readonly runId: string;
    readonly snapshotHash: string;
  }) => {
    validateRuntimeInput(run);
    const existing = cache.get(run.runId);
    if (existing) {
      if (existing.snapshotHash !== run.snapshotHash) {
        throw new TypeError("service_role_shadow_runtime_snapshot_mismatch");
      }
      return existing;
    }
    const statePromise = initializeState(input.db, {
      ...run,
      runtimeCommit: input.runtimeCommit
    });
    const fencePromise = statePromise.then(({ fence }) => Object.freeze({
      sha256: fence.sha256,
      artifact: fence.artifact
    }));
    void fencePromise.catch(() => undefined);
    const created = { snapshotHash: run.snapshotHash, statePromise, fencePromise };
    cache.set(run.runId, created);
    void statePromise.catch(() => {
      if (cache.get(run.runId) === created) cache.delete(run.runId);
    });
    return created;
  };

  const lookupMap = async (lookup: {
    readonly runId: string;
    readonly snapshotHash: string;
    readonly compoundBindingKey: string;
  }): Promise<ServiceRoleShadowMapLookupV1> => {
    if (!HASH.test(lookup.compoundBindingKey)) {
      throw new TypeError("service_role_shadow_compound_binding_key_invalid");
    }
    const state = await cacheEntry(lookup).statePromise;
    const maps = state.mapsByCompoundBindingKey.get(lookup.compoundBindingKey) ?? [];
    if (maps.length === 0) return Object.freeze({ kind: "missing" as const });
    if (maps.length > 1) {
      return Object.freeze({
        kind: "conflict" as const,
        wrapperSha256s: Object.freeze(maps.map(({ wrapperSha256 }) => wrapperSha256))
      });
    }
    const map = maps[0]!;
    return Object.freeze({
      kind: "found" as const,
      wrapperSha256: map.wrapperSha256,
      wrapper: map.wrapper,
      sourceMapSha256: map.sourceMapSha256,
      sourceMap: map.sourceMap
    });
  };

  const summarizeRunWithBudget = async (summaryInput: {
    readonly runId: string;
    readonly signal: AbortSignal;
    readonly recoveryBudget?: RecoverySweepBudget;
  }): Promise<BoundArtifact<ServiceRoleShadowRunSummaryV1> | null> => {
    if (!validRootText(summaryInput.runId)) {
      throw new TypeError("service_role_shadow_summary_run_id_invalid");
    }
    if (summaryInput.signal.aborted) return null;
    const assertActive = () => {
      if (summaryInput.recoveryBudget !== undefined) {
        assertRecoverySweepBudget(summaryInput.recoveryBudget);
      } else if (summaryInput.signal.aborted) {
        throw new Error("service_role_shadow_summary_aborted");
      }
    };
    return input.db.transaction(async (rawClient) => {
      const client = summaryInput.recoveryBudget === undefined
        ? rawClient
        : recoveryBudgetedClient(rawClient, summaryInput.recoveryBudget);
      await setReconciliationDeadlines(
        client,
        summaryInput.recoveryBudget === undefined
          ? RECONCILIATION_STATEMENT_DEADLINE_MS
          : RECOVERY_STATEMENT_DEADLINE_MS
      );
      assertActive();
      const traversalRows = (await client.query(
        `select task.id as task_id,
                task.attempt as traversal_attempt,
                task.accepted_attempt_id,
                task.checkpoint_json,
                attempt.artifact_sha256,
                run.analysis_manifest_sha256,
                run.subject_address,
                artifact.artifact_json
           from unified_check_tasks task
           join unified_check_runs run on run.id = task.run_id
           join unified_check_attempts attempt
             on attempt.id = task.accepted_attempt_id
            and attempt.task_id = task.id
            and attempt.attempt = task.attempt
           join unified_check_artifacts artifact
             on artifact.sha256 = attempt.artifact_sha256
            and artifact.created_by_run_id = task.run_id
            and artifact.kind = 'traversal_result'
            and artifact.schema_version = '1'
          where task.run_id = $1
            and task.kind = 'traversal'
            and task.status = 'COMPLETED'
            and task.cancellation_requested_at is null`,
        [summaryInput.runId]
      )).rows;
      if (traversalRows.length !== 1) return null;
      const traversal = parseAcceptedTraversalInventoryV1({
        row: traversalRows[0]!,
        runId: summaryInput.runId,
        assertActive
      });
      await validateRunSnapshot(client, {
        runId: summaryInput.runId,
        snapshotHash: traversal.snapshotHash
      }, false);
      const fenceResolution = await resolveExistingFence(client, {
        runId: summaryInput.runId,
        snapshotHash: traversal.snapshotHash,
        runtimeCommit: input.runtimeCommit
      });
      if (fenceResolution.kind !== "reuse") return null;
      const runtimeState = fenceResolution.state;
      const fence = runtimeState.fence;

      const shadowRows = (await client.query(
        `select sha256,created_by_run_id,kind,schema_version,artifact_json
           from unified_check_artifacts
          where created_by_run_id = $1
            and kind in (
              'service_role_shadow_profile',
              'service_role_shadow_precommit_receipt',
              'service_role_shadow_runtime_receipt'
            )
          order by kind,sha256`,
        [summaryInput.runId]
      )).rows.map(storedArtifactRow);
      const planner = await loadCommittedPlannerInventoryV1(
        client,
        summaryInput.runId,
        assertActive
      );
      if (planner === null) return null;
      const { rows: plannerRows, entries: committedEntries } = planner;

      let missing = 0;
      let conflict = 0;
      let malformed = 0;
      type EligibleGroup = {
        readonly compoundBindingKey: string;
        readonly history: AcceptedHistoryInventoryV1;
        readonly profiles: ServiceRoleShadowPrecommitReceiptV1["profiles"];
      };
      const eligibleGroups: EligibleGroup[] = [];
      const historyRows = plannerRows.filter((row) => {
        assertActive();
        return row.task_kind === "address_history";
      });
      const historiesByAddress = new Map<string, AcceptedHistoryInventoryV1[]>();
      const malformedHistoryAddresses = new Set<string>();
      for (const historyRow of historyRows) {
        assertActive();
        try {
          const history = await loadAcceptedHistoryInventoryV1({
            client,
            runId: summaryInput.runId,
            snapshotHash: traversal.snapshotHash,
            row: historyRow,
            assertActive
          });
          const current = historiesByAddress.get(history.address) ?? [];
          current.push(history);
          historiesByAddress.set(history.address, current);
        } catch {
          const [row] = await loadArtifactsByHashes(client, summaryInput.runId, [
            String(historyRow.artifact_sha256)
          ]);
          const address = row?.artifact !== null &&
              typeof row?.artifact === "object" &&
              !Array.isArray(row.artifact) &&
              validRootText((row.artifact as { address?: unknown }).address)
            ? String((row.artifact as { address: string }).address)
            : null;
          if (address === null) malformed += 1;
          else malformedHistoryAddresses.add(address);
        }
      }
      const statesByAddressDirection = new Map<
        string,
        typeof traversal.states[number][]
      >();
      for (const state of traversal.states) {
        assertActive();
        if (state.address === traversal.subjectAddress) continue;
        const key = JSON.stringify([state.address, state.direction]);
        const states = statesByAddressDirection.get(key) ?? [];
        states.push(state);
        statesByAddressDirection.set(key, states);
      }
      for (const [, states] of [...statesByAddressDirection]
        .sort(([left], [right]) => compareCodeUnits(left, right))) {
        assertActive();
        const address = states[0]!.address;
        if (malformedHistoryAddresses.has(address)) {
          malformed += 1;
          continue;
        }
        const histories = historiesByAddress.get(address) ?? [];
        if (histories.length === 0) {
          missing += 1;
          continue;
        }
        if (histories.length !== 1) {
          conflict += 1;
          continue;
        }
        const history = histories[0]!;
        const derived = new Map<string, typeof states>();
        let groupMalformed = false;
        for (const state of states) {
          assertActive();
          try {
            const binding = deriveServiceRoleShadowAcceptedHistoryBindingV1({
              state,
              acceptedHistoryEvents: history.events
            });
            const key = serviceRoleShadowCompoundBindingKeyV1({
              runId: summaryInput.runId,
              snapshotHash: traversal.snapshotHash,
              addressHistoryManifestSha256: history.manifestSha256,
              binding
            });
            const current = derived.get(key) ?? [];
            derived.set(key, [...current, state]);
          } catch {
            groupMalformed = true;
          }
        }
        if (groupMalformed) malformed += 1;
        for (const [compoundBindingKey, groupStates] of derived) {
          assertActive();
          if (fence.artifact.outcome.kind === "unavailable") {
            if (fence.artifact.outcome.reason === "preload_timeout") missing += 1;
            else if (fence.artifact.outcome.reason === "conflict") conflict += 1;
            else malformed += 1;
            continue;
          }
          const maps = runtimeState.mapsByCompoundBindingKey.get(
            compoundBindingKey
          ) ?? [];
          if (maps.length === 0) {
            missing += 1;
            continue;
          }
          if (maps.length !== 1) {
            conflict += 1;
            continue;
          }
          const map = maps[0]!;
          const profiles: Array<
            ServiceRoleShadowPrecommitReceiptV1["profiles"][number]
          > = [];
          for (const state of [...groupStates].sort((left, right) =>
            compareCodeUnits(traversalStateId(left), traversalStateId(right))
          )) {
            assertActive();
            const built = maybeBuildServiceRoleShadowArtifactV1({
              mode: POLICY_VERSION,
              runId: summaryInput.runId,
              snapshotHash: traversal.snapshotHash,
              subjectAddress: traversal.subjectAddress,
              state,
              acceptedHistory: {
                manifestKey: history.manifestKey,
                manifestSha256: history.manifestSha256,
                pageArtifactHashes: history.pageArtifactHashes,
                events: history.events
              },
              eventRoleMap: {
                sha256: map.sourceMapSha256,
                artifact: map.sourceMap
              }
            });
            if (built === null || built.artifact.result.insufficientReason !== null) {
              continue;
            }
            profiles.push(Object.freeze({
              traversalStateId: traversalStateId(state),
              shadowStateId: built.artifact.traversalStateId,
              profileSha256: fingerprintCanonicalArtifact(built.artifact),
              wrapperSha256: map.wrapperSha256
            }));
          }
          if (profiles.length > 0) {
            eligibleGroups.push({
              compoundBindingKey,
              history,
              profiles: Object.freeze(profiles)
            });
          }
        }
      }
      eligibleGroups.sort((left, right) =>
        compareCodeUnits(left.compoundBindingKey, right.compoundBindingKey)
      );

      const precommitRows = shadowRows.filter((row) => {
        assertActive();
        return row.kind === "service_role_shadow_precommit_receipt" &&
          row.schemaVersion === "1";
      });
      const precommits: Array<{
        readonly sha256: string;
        readonly artifact: ServiceRoleShadowPrecommitReceiptV1;
      }> = [];
      for (const row of precommitRows) {
        assertActive();
        try {
          const artifact = parseServiceRoleShadowPrecommitReceiptV1({
            artifact: row.artifact,
            expectedSha256: row.sha256
          });
          if (artifact.runId === summaryInput.runId) {
            precommits.push({ sha256: row.sha256, artifact });
          }
        } catch {
          // Invalid post-input artifacts are neither accepted input
          // classification nor valid orphans. The eligible group remains
          // unreconciled unless another strict closure succeeds.
        }
      }
      const receiptRows = shadowRows.filter((row) => {
        assertActive();
        return row.kind === "service_role_shadow_runtime_receipt" &&
          row.schemaVersion === "1";
      });
      const validatedReceipts: Array<{
        readonly sha256: string;
        readonly artifact: ServiceRoleShadowRuntimeReceiptV1;
      }> = [];
      for (const row of receiptRows) {
        assertActive();
        const artifact = await validateRuntimeReceiptClosureV1({
          client,
          runtimeCommit: input.runtimeCommit,
          runId: summaryInput.runId,
          traversalTaskId: traversal.taskId,
          traversalAttempt: Number(traversalRows[0]!.traversal_attempt),
          currentCheckpoint: traversalRows[0]!.checkpoint_json,
          currentEntries: committedEntries,
          receiptRow: row,
          signal: summaryInput.signal
        });
        if (artifact !== null) {
          validatedReceipts.push({ sha256: row.sha256, artifact });
        }
      }
      const expectedProfiles = new Set(eligibleGroups.flatMap((group) => {
        assertActive();
        return group.profiles.map((profile) => profile.profileSha256);
      }));
      const profileOrphan = shadowRows.filter((row) => {
        assertActive();
        return isStrictServiceRoleShadowProfileV1({
          row,
          runId: summaryInput.runId,
          snapshotHash: traversal.snapshotHash
        }) &&
          !expectedProfiles.has(row.sha256);
      }).length;
      const referencedPrecommits = new Set<string>();
      const groupReceiptSha256s: string[] = [];
      let reconciledGroup = 0;
      let reconciledProfile = 0;
      let unreconciledGroup = 0;
      for (const group of eligibleGroups) {
        assertActive();
        const matchingPrecommits = precommits.filter(({ artifact }) => {
          assertActive();
          return artifact.snapshotHash === traversal.snapshotHash &&
          artifact.inputFenceSha256 === fence.sha256 &&
          fence.artifact.outcome.kind === "ready" &&
          artifact.inputSetSha256 === fence.artifact.outcome.inputSetSha256 &&
          artifact.manifestKey === group.history.manifestKey &&
          artifact.manifestSha256 === group.history.manifestSha256 &&
          artifact.compoundBindingKey === group.compoundBindingKey &&
          canonicalizeArtifactJson(artifact.acceptedPageArtifactHashes) ===
            canonicalizeArtifactJson(group.history.pageArtifactHashes) &&
          canonicalizeArtifactJson(artifact.profiles) ===
            canonicalizeArtifactJson(group.profiles);
        });
        if (matchingPrecommits.length !== 1) {
          if (matchingPrecommits.length > 1) {
            referencedPrecommits.add(matchingPrecommits[0]!.sha256);
          }
          unreconciledGroup += 1;
          continue;
        }
        referencedPrecommits.add(matchingPrecommits[0]!.sha256);
        const validReceipts = validatedReceipts.filter(({ artifact }) => {
          assertActive();
          return artifact.compoundBindingKey === group.compoundBindingKey &&
            matchingPrecommits.some((candidate) =>
              candidate.sha256 === artifact.precommitSha256
            ) &&
            canonicalizeArtifactJson(artifact.profiles) ===
              canonicalizeArtifactJson(group.profiles) &&
            artifact.committedEntries.filter((entry) =>
              entry.artifactSha256 === group.history.manifestSha256
            ).length === 1;
        });
        if (validReceipts.length === 1) {
          reconciledGroup += 1;
          reconciledProfile += group.profiles.length;
          groupReceiptSha256s.push(validReceipts[0]!.sha256);
        } else {
          unreconciledGroup += 1;
        }
      }
      const precommitOrphan = precommits.filter(({ sha256 }) => {
        assertActive();
        return !referencedPrecommits.has(sha256);
      }).length;
      const counts = {
        missing,
        conflict,
        malformed,
        eligibleGroup: eligibleGroups.length,
        eligibleProfile: expectedProfiles.size,
        reconciledGroup,
        reconciledProfile,
        unreconciledGroup,
        profileOrphan,
        precommitOrphan
      };
      const complete = fence.artifact.outcome.kind === "ready" &&
        reconciledGroup >= 1 &&
        missing === 0 &&
        conflict === 0 &&
        malformed === 0 &&
        unreconciledGroup === 0 &&
        profileOrphan === 0 &&
        precommitOrphan === 0 &&
        reconciledProfile === expectedProfiles.size;
      const summary = buildServiceRoleShadowRunSummaryV1({
        runId: summaryInput.runId,
        snapshotHash: traversal.snapshotHash,
        runtimeCommit: input.runtimeCommit,
        inputFenceSha256: fence.sha256,
        acceptedTraversal: {
          taskId: traversal.taskId,
          acceptedAttemptId: traversal.acceptedAttemptId,
          artifactSha256: traversal.artifactSha256
        },
        groupReceiptSha256s,
        counts,
        complete
      });
      await insertServiceRoleArtifact(client, {
        sha256: summary.sha256,
        createdByRunId: summaryInput.runId,
        kind: "service_role_shadow_run_summary",
        schemaVersion: "1",
        artifact: summary.artifact
      });
      assertActive();
      return summary;
    });
  };

  const summarizeRun = (summaryInput: {
    readonly runId: string;
    readonly signal: AbortSignal;
  }) => summarizeRunWithBudget(summaryInput);

  const reconcileCheckpoint = async (reconciliation: {
    readonly task: UnifiedWorkerTask;
    readonly result: Extract<UnifiedChunkOutcome, { kind: "checkpoint" }>;
    readonly checkpointCommit: UnifiedCheckpointCommitResult;
    readonly signal: AbortSignal;
  }): Promise<void> => {
    const { task, checkpointCommit, signal } = reconciliation;
    const attemptKey = pendingAttemptKey({
      runId: task.runId,
      taskId: task.id,
      attempt: task.attempt
    });
    const pendingAttempt = pendingAttempts.get(attemptKey);
    if (!pendingAttempt) return;
    const candidates = [...pendingAttempt.groups.values()];
    try {
      const ordered = checkpointCommit.orderedCommit;
      if (
        signal.aborted ||
        task.kind !== "traversal" ||
        !checkpointCommit.checkpointed ||
        checkpointCommit.committedTaskStatus !== "QUEUED" ||
        checkpointCommit.committedCheckpoint === null ||
        ordered === null ||
        !ordered.applied ||
        ordered.runId !== task.runId
      ) {
        return;
      }
      for (const pending of candidates) {
        if (signal.aborted) return;
        if (
          pending.runId !== task.runId ||
          pending.taskId !== task.id ||
          pending.attempt !== task.attempt
        ) continue;
        try {
          await input.db.transaction(async (client) => {
            await setReconciliationDeadlines(client);
            await reconcileDurablePrecommitV1({
              client,
              runtimeCommit: input.runtimeCommit,
              runId: task.runId,
              traversalTaskId: task.id,
              traversalAttempt: task.attempt,
              precommitSha256: pending.precommitSha256,
              committedCheckpoint: checkpointCommit.committedCheckpoint,
              committedEntries: ordered.committedEntries,
              signal
            });
          });
        } catch (error) {
          if (error instanceof TypeError) continue;
          throw error;
        }
      }
    } finally {
      retirePendingAttempt(attemptKey);
    }
  };

  const reconcileCommittedServiceRoleShadowRunsV1 = async (recoveryInput: {
    readonly signal: AbortSignal;
  }): Promise<void> => {
    if (recoveryInput.signal.aborted) return;
    const controller = new AbortController();
    const relayAbort = () => controller.abort();
    recoveryInput.signal.addEventListener("abort", relayAbort, { once: true });
    const budget: RecoverySweepBudget = {
      deadlineAtMs: performance.now() + RECOVERY_SWEEP_BUDGET_MS,
      signal: controller.signal
    };
    const timeout = setTimeout(() => controller.abort(), RECOVERY_SWEEP_BUDGET_MS);
    timeout.unref?.();
    const completedRunIds = new Set<string>();
    try {
      await input.db.transaction(async (rawClient) => {
        const client = recoveryBudgetedClient(rawClient, budget);
        await setReconciliationDeadlines(client, RECOVERY_STATEMENT_DEADLINE_MS);
        assertRecoverySweepBudget(budget);
        // One run-level query selects possible durable crash-window work. The
        // artifact table has no kind index; Task 7 deliberately does not add a
        // migration for a bounded once-at-startup shadow sweep.
        const candidates = (await client.query(
          `select task.id as task_id,
                  task.run_id,
                  task.status,
                  task.attempt,
                  task.checkpoint_json,
                  precommit.sha256 as precommit_sha256
             from unified_check_tasks task
             join unified_check_artifacts precommit
               on precommit.created_by_run_id = task.run_id
              and precommit.kind = 'service_role_shadow_precommit_receipt'
              and precommit.schema_version = '1'
             where task.kind = 'traversal'
               and task.status in ('QUEUED','COMPLETED')
               and task.cancellation_requested_at is null
            union all
            select task.id as task_id,
                   task.run_id,
                   task.status,
                   task.attempt,
                   task.checkpoint_json,
                   null::text as precommit_sha256
              from unified_check_tasks task
             where task.kind = 'traversal'
               and task.status = 'COMPLETED'
               and task.cancellation_requested_at is null
             order by run_id,precommit_sha256 nulls last`,
          []
        )).rows;
        for (const candidate of candidates) {
          assertRecoverySweepBudget(budget);
          const runId = String(candidate.run_id);
          if (candidate.status === "COMPLETED") {
            completedRunIds.add(runId);
          }
          if (candidate.precommit_sha256 === null) continue;
          const planner = await loadCommittedPlannerInventoryV1(
            client,
            runId,
            () => assertRecoverySweepBudget(budget)
          );
          if (planner === null) continue;
          const committedEntries = planner.entries;
          const receiptRows = (await client.query(
            `select sha256,created_by_run_id,kind,schema_version,artifact_json
               from unified_check_artifacts
              where created_by_run_id = $1
                and kind = 'service_role_shadow_runtime_receipt'
                and schema_version = '1'
              order by sha256`,
            [runId]
          )).rows.map(storedArtifactRow);
          let alreadyReconciled = false;
          for (const receiptRow of receiptRows) {
            assertRecoverySweepBudget(budget);
            const valid = await validateRuntimeReceiptClosureV1({
              client,
              runtimeCommit: input.runtimeCommit,
              runId,
              traversalTaskId: String(candidate.task_id),
              traversalAttempt: Number(candidate.attempt),
              currentCheckpoint: candidate.checkpoint_json,
              currentEntries: committedEntries,
              receiptRow,
              precommitSha256: String(candidate.precommit_sha256),
              signal: controller.signal
            });
            assertRecoverySweepBudget(budget);
            if (valid !== null) {
              alreadyReconciled = true;
              break;
            }
          }
          if (alreadyReconciled) continue;
          try {
            await reconcileDurablePrecommitV1({
              client,
              runtimeCommit: input.runtimeCommit,
              runId,
              traversalTaskId: String(candidate.task_id),
              traversalAttempt: Number(candidate.attempt),
              precommitSha256: String(candidate.precommit_sha256),
              committedCheckpoint: candidate.checkpoint_json,
              committedEntries,
              signal: controller.signal
            });
          } catch (error) {
            if (!(error instanceof TypeError)) throw error;
          }
          assertRecoverySweepBudget(budget);
        }
      });
      for (const runId of [...completedRunIds].sort(compareCodeUnits)) {
        assertRecoverySweepBudget(budget);
        await summarizeRunWithBudget({
          runId,
          signal: controller.signal,
          recoveryBudget: budget
        });
      }
    } finally {
      clearTimeout(timeout);
      recoveryInput.signal.removeEventListener("abort", relayAbort);
    }
  };

  return {
    loadInputFence(run) {
      try {
        return cacheEntry(run).fencePromise;
      } catch (error) {
        return Promise.reject(error);
      }
    },
    lookupMap,
    reconcileCheckpoint,
    summarizeRun,
    reconcileCommittedServiceRoleShadowRunsV1,
    async observeAcceptedAddressHistoryGroup(group) {
      if (
        !validRootText(group.taskId) ||
        !Number.isSafeInteger(group.attempt) ||
        group.attempt < 1 ||
        !validRootText(group.runId) ||
        !HASH.test(group.snapshotHash) ||
        !validRootText(group.subjectAddress) ||
        !validRootText(group.manifestKey) ||
        !HASH.test(group.manifestSha256) ||
        !HASH.test(group.candidateDeltaSha256) ||
        group.acceptedPageArtifactHashes.some((hash) => !HASH.test(hash)) ||
        new Set(group.acceptedPageArtifactHashes).size !==
          group.acceptedPageArtifactHashes.length ||
        group.candidateCheckpoint.deltaHeadSha256 !==
          group.candidateDeltaSha256
      ) {
        throw new TypeError("service_role_shadow_observer_input_invalid");
      }
      if (group.signal.aborted) return;
      const fence = await cacheEntry(group).fencePromise;
      if (group.signal.aborted || fence.artifact.outcome.kind !== "ready") return;

      type ProfileCandidate = {
        readonly traversalStateId: string;
        readonly shadowStateId: string;
        readonly wrapperSha256: string;
        readonly profile: BoundArtifact<ServiceRoleShadowArtifactV1>;
      };
      const candidatesByCompoundKey = new Map<string, ProfileCandidate[]>();
      const sortedStates = [...group.states].sort((left, right) =>
        compareCodeUnits(traversalStateId(left), traversalStateId(right))
      );
      for (const state of sortedStates) {
        if (group.signal.aborted) return;
        if (state.address === group.subjectAddress) continue;
        let binding: ReturnType<
          typeof deriveServiceRoleShadowAcceptedHistoryBindingV1
        >;
        try {
          binding = deriveServiceRoleShadowAcceptedHistoryBindingV1({
            state,
            acceptedHistoryEvents: group.events
          });
        } catch {
          continue;
        }
        const compoundBindingKey = serviceRoleShadowCompoundBindingKeyV1({
          runId: group.runId,
          snapshotHash: group.snapshotHash,
          addressHistoryManifestSha256: group.manifestSha256,
          binding
        });
        const lookup = await lookupMap({
          runId: group.runId,
          snapshotHash: group.snapshotHash,
          compoundBindingKey
        });
        if (group.signal.aborted) return;
        if (lookup.kind !== "found") continue;
        const built = maybeBuildServiceRoleShadowArtifactV1({
          mode: POLICY_VERSION,
          runId: group.runId,
          snapshotHash: group.snapshotHash,
          subjectAddress: group.subjectAddress,
          state,
          acceptedHistory: {
            manifestKey: group.manifestKey,
            manifestSha256: group.manifestSha256,
            pageArtifactHashes: group.acceptedPageArtifactHashes,
            events: group.events
          },
          eventRoleMap: {
            sha256: lookup.sourceMapSha256,
            artifact: lookup.sourceMap
          }
        });
        if (built === null || built.artifact.result.insufficientReason !== null) {
          continue;
        }
        const candidate: ProfileCandidate = {
          traversalStateId: traversalStateId(state),
          shadowStateId: built.artifact.traversalStateId,
          wrapperSha256: lookup.wrapperSha256,
          profile: boundArtifact(built.artifact)
        };
        const values = candidatesByCompoundKey.get(compoundBindingKey) ?? [];
        values.push(candidate);
        candidatesByCompoundKey.set(compoundBindingKey, values);
      }

      for (const [compoundBindingKey, candidates] of [...candidatesByCompoundKey]
        .sort(([left], [right]) => compareCodeUnits(left, right))) {
        if (group.signal.aborted) return;
        const ordered = [...candidates].sort((left, right) =>
          compareCodeUnits(left.traversalStateId, right.traversalStateId)
        );
        const precommit = buildServiceRoleShadowPrecommitReceiptV1({
          runId: group.runId,
          snapshotHash: group.snapshotHash,
          inputFenceSha256: fence.sha256,
          inputSetSha256: fence.artifact.outcome.inputSetSha256,
          manifestKey: group.manifestKey,
          manifestSha256: group.manifestSha256,
          acceptedPageArtifactHashes: group.acceptedPageArtifactHashes,
          candidateCheckpointSha256: fingerprintCanonicalArtifact(
            group.candidateCheckpoint
          ),
          candidateDeltaSha256: group.candidateDeltaSha256,
          compoundBindingKey,
          profiles: ordered.map((candidate) => ({
            traversalStateId: candidate.traversalStateId,
            shadowStateId: candidate.shadowStateId,
            profileSha256: candidate.profile.sha256,
            wrapperSha256: candidate.wrapperSha256
          }))
        });
        await input.db.transaction(async (client) => {
          for (const candidate of ordered) {
            if (group.signal.aborted) {
              throw new Error("service_role_shadow_observer_aborted");
            }
            await insertServiceRoleArtifact(client, {
              sha256: candidate.profile.sha256,
              createdByRunId: group.runId,
              kind: "service_role_shadow_profile",
              schemaVersion: "1",
              artifact: candidate.profile.artifact
            });
          }
          if (group.signal.aborted) {
            throw new Error("service_role_shadow_observer_aborted");
          }
          await insertServiceRoleArtifact(client, {
            sha256: precommit.sha256,
            createdByRunId: group.runId,
            kind: "service_role_shadow_precommit_receipt",
            schemaVersion: "1",
            artifact: precommit.artifact
          });
          if (group.signal.aborted) {
            throw new Error("service_role_shadow_observer_aborted");
          }
        });
        if (group.signal.aborted) return;
        retainPendingGroup({
          runId: group.runId,
          taskId: group.taskId,
          attempt: group.attempt,
          precommitSha256: precommit.sha256
        });
      }
    }
  };
}
