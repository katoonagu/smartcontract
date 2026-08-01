import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../forensics/canonicalJson";
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

type PendingGroupV1 = {
  readonly taskId: string;
  readonly attempt: number;
  readonly precommitSha256: string;
  readonly precommit: ServiceRoleShadowPrecommitReceiptV1;
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
} {
  if (!validRootText(input.runtimeCommit)) {
    throw new TypeError("service_role_shadow_runtime_commit_invalid");
  }
  const cache = new Map<string, {
    readonly snapshotHash: string;
    readonly statePromise: Promise<RuntimeState>;
    readonly fencePromise: Promise<{
      readonly sha256: string;
      readonly artifact: ServiceRoleShadowInputFenceV1;
    }>;
  }>();
  // ponytail: same-process handoff stays in memory; Task 7's bounded startup
  // sweep is the planned recovery path for durable precommits after a crash.
  const pendingGroups = new Map<string, PendingGroupV1>();

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

  const reconcileCheckpoint = async (reconciliation: {
    readonly task: UnifiedWorkerTask;
    readonly result: Extract<UnifiedChunkOutcome, { kind: "checkpoint" }>;
    readonly checkpointCommit: UnifiedCheckpointCommitResult;
    readonly signal: AbortSignal;
  }): Promise<void> => {
    const { task, checkpointCommit, signal } = reconciliation;
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
    const checkpoint = checkpointCommit.committedCheckpoint;
    if (checkpoint === null || typeof checkpoint !== "object" ||
      Array.isArray(checkpoint)) return;
    const committedDeltaHeadSha256 = (
      checkpoint as { deltaHeadSha256?: unknown }
    ).deltaHeadSha256;
    if (typeof committedDeltaHeadSha256 !== "string" ||
      !HASH.test(committedDeltaHeadSha256)) return;
    const committedEntries = [...ordered.committedEntries];
    for (let index = 0; index < committedEntries.length; index += 1) {
      const entry = committedEntries[index]!;
      if (
        !Number.isSafeInteger(entry.canonicalSequence) ||
        entry.canonicalSequence < 0 ||
        !validRootText(entry.taskId) ||
        !validRootText(entry.acceptedAttemptId) ||
        !HASH.test(entry.artifactSha256) ||
        (index > 0 && committedEntries[index - 1]!.canonicalSequence >=
          entry.canonicalSequence)
      ) return;
    }
    const committedCheckpointSha256 = fingerprintCanonicalArtifact(checkpoint);
    const candidates = [...pendingGroups.values()].filter((pending) =>
      pending.taskId === task.id &&
      pending.attempt === task.attempt &&
      pending.precommit.runId === task.runId
    );
    for (const pending of candidates) {
      if (signal.aborted) return;
      const matchingEntries = committedEntries.filter((entry) =>
        entry.artifactSha256 === pending.precommit.manifestSha256
      );
      if (matchingEntries.length !== 1) continue;
      let reconciled = false;
      try {
        reconciled = await input.db.transaction(async (client) => {
          if (signal.aborted) return false;
          const expectedHashes = [...new Set([
            pending.precommitSha256,
            pending.precommit.inputFenceSha256,
            pending.precommit.inputSetSha256,
            ...pending.precommit.profiles.map((profile) => profile.profileSha256)
          ])].sort(compareCodeUnits);
          const rows = await loadArtifactsByHashes(
            client,
            task.runId,
            expectedHashes
          );
          if (rows.length !== expectedHashes.length) return false;
          const byHash = new Map(rows.map((row) => [row.sha256, row]));
          const precommitRow = byHash.get(pending.precommitSha256);
          const fenceRow = byHash.get(pending.precommit.inputFenceSha256);
          const inputSetRow = byHash.get(pending.precommit.inputSetSha256);
          if (
            !precommitRow ||
            precommitRow.kind !== "service_role_shadow_precommit_receipt" ||
            precommitRow.schemaVersion !== "1" ||
            !fenceRow ||
            fenceRow.kind !== "service_role_shadow_input_fence" ||
            fenceRow.schemaVersion !== "1" ||
            !inputSetRow ||
            inputSetRow.kind !== "service_role_shadow_input_set" ||
            inputSetRow.schemaVersion !== "1"
          ) return false;
          const persistedPrecommit = parseServiceRoleShadowPrecommitReceiptV1({
            artifact: precommitRow.artifact,
            expectedSha256: pending.precommitSha256
          });
          if (canonicalizeArtifactJson(persistedPrecommit) !==
            canonicalizeArtifactJson(pending.precommit)) return false;
          const fence = parseServiceRoleShadowInputFenceV1({
            artifact: fenceRow.artifact,
            expectedSha256: pending.precommit.inputFenceSha256
          });
          const inputSet = parseServiceRoleShadowInputSetV1({
            artifact: inputSetRow.artifact,
            expectedSha256: pending.precommit.inputSetSha256
          });
          if (
            fence.runId !== task.runId ||
            fence.snapshotHash !== pending.precommit.snapshotHash ||
            fence.runtimeCommit !== input.runtimeCommit ||
            fence.outcome.kind !== "ready" ||
            fence.outcome.inputSetSha256 !== pending.precommit.inputSetSha256 ||
            inputSet.runId !== task.runId ||
            inputSet.snapshotHash !== pending.precommit.snapshotHash
          ) return false;
          for (const profile of pending.precommit.profiles) {
            const row = byHash.get(profile.profileSha256);
            if (
              !row ||
              row.kind !== "service_role_shadow_profile" ||
              row.schemaVersion !== "1" ||
              fingerprintCanonicalArtifact(row.artifact) !== profile.profileSha256
            ) return false;
          }

          let cursor: string | null = committedDeltaHeadSha256;
          const visited = new Set<string>();
          let candidateReachable = false;
          // ponytail: reconciliation walks one hash-indexed delta chain under
          // the caller's 1s signal; a persisted ancestry index is the upgrade
          // only if measured chains make this bounded read too expensive.
          while (cursor !== null && !visited.has(cursor)) {
            if (signal.aborted) return false;
            visited.add(cursor);
            const [deltaRow] = await loadArtifactsByHashes(
              client,
              task.runId,
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
              (typeof previous !== "string" || !HASH.test(previous))) {
              return false;
            }
            if (cursor === pending.precommit.candidateDeltaSha256) {
              candidateReachable = true;
              break;
            }
            cursor = previous as string | null;
          }
          if (!candidateReachable || signal.aborted) return false;
          const receipt = buildServiceRoleShadowRuntimeReceiptV1({
            runId: pending.precommit.runId,
            snapshotHash: pending.precommit.snapshotHash,
            runtimeCommit: input.runtimeCommit,
            traversalTaskId: task.id,
            traversalAttempt: task.attempt,
            inputFenceSha256: pending.precommit.inputFenceSha256,
            inputSetSha256: pending.precommit.inputSetSha256,
            compoundBindingKey: pending.precommit.compoundBindingKey,
            precommitSha256: pending.precommitSha256,
            manifestKey: pending.precommit.manifestKey,
            manifestSha256: pending.precommit.manifestSha256,
            acceptedPageArtifactHashes:
              pending.precommit.acceptedPageArtifactHashes,
            candidateCheckpointSha256:
              pending.precommit.candidateCheckpointSha256,
            candidateDeltaSha256: pending.precommit.candidateDeltaSha256,
            committedCheckpointSha256,
            committedDeltaHeadSha256,
            committedEntries,
            profiles: pending.precommit.profiles
          });
          await insertServiceRoleArtifact(client, {
            sha256: receipt.sha256,
            createdByRunId: task.runId,
            kind: "service_role_shadow_runtime_receipt",
            schemaVersion: "1",
            artifact: receipt.artifact
          });
          if (signal.aborted) {
            throw new Error("service_role_shadow_reconciliation_aborted");
          }
          return true;
        });
      } catch (error) {
        if (error instanceof TypeError) continue;
        throw error;
      }
      if (reconciled) pendingGroups.delete(pending.precommitSha256);
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
        pendingGroups.set(precommit.sha256, {
          taskId: group.taskId,
          attempt: group.attempt,
          precommitSha256: precommit.sha256,
          precommit: precommit.artifact
        });
      }
    }
  };
}
