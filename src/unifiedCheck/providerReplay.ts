import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../forensics/canonicalJson";

const HASH = /^[0-9a-f]{64}$/u;
const MAX_REPLAY_ITEMS = 10_000;
const MAX_REPLAY_RAW_BYTES = 16 * 1024 * 1024;
const MAX_REPLAY_ITEM_BYTES = 4 * 1024 * 1024;

export type UnifiedProviderReplayDeterminismV1 = {
  readonly runIdSeed: string;
  readonly taskIdSeed: string;
  readonly requestOrderingSeed: number;
  readonly providerConfigurationSha256: string;
  readonly labelDatasetSha256: string;
  readonly scoringPolicyVersion: string;
  readonly attributionPolicyVersion: string;
  readonly traversalPolicyVersion: string;
};

export type UnifiedProviderReplayRequestV1 = {
  readonly endpoint: string;
  readonly canonicalRequestSha256: string;
  readonly responseArtifactSha256: string;
};

export type UnifiedProviderReplayResponseV1 = {
  readonly responseArtifactSha256: string;
  readonly artifact: unknown;
};

export type UnifiedProviderReplayV1 = {
  readonly version: "unified-provider-replay-v1";
  readonly frozenAt: string;
  readonly frozenClockIso: string;
  readonly schemaVersion: 34;
  readonly sourceSnapshotSha256: string;
  readonly deterministic: UnifiedProviderReplayDeterminismV1;
  readonly requests: readonly UnifiedProviderReplayRequestV1[];
  readonly responses: readonly UnifiedProviderReplayResponseV1[];
  readonly expectedReplaySha256: string;
};

export type UnifiedProviderReplayUnsealedV1 = Omit<
  UnifiedProviderReplayV1,
  "version" | "expectedReplaySha256"
> & {
  readonly version?: "unified-provider-replay-v1";
};

export type UnifiedRollingOracleFactsV1 = {
  readonly canonicalFacts: {
    readonly version: "canonical-fact-inventory-v1";
    readonly facts: readonly Readonly<Record<string, unknown>>[];
  };
  readonly finalFrontier: readonly Readonly<Record<string, unknown>>[];
  readonly closureCertificate: {
    readonly version: "traversal-closure-certificate-v1";
    readonly schemaVersion: 1;
    readonly analysisManifestHash: string;
    readonly snapshotHash: string;
    readonly visitedStateHash: string;
    readonly frontierHash: string;
    readonly closed: true;
  };
  readonly score: number;
  readonly decision: "ACCEPTABLE" | "REVIEW" | "DECLINE";
  readonly evidenceBundleSha256: string;
  readonly traversalClosureSha256: string;
  readonly scoringBundleSha256: string;
  readonly reportSha256: string;
  readonly eligibleDeliveryIntentCount: number;
  readonly externalTelegramSends: number;
  readonly providerResponseArtifactSha256s: readonly string[];
  readonly committedSequenceCount: number;
  readonly duplicateCommitCount: number;
  readonly duplicateSequenceCount: number;
};

export type UnifiedRollingOracleReceiptV1 = {
  readonly version: "unified-rolling-oracle-receipt-v1";
  readonly generatedAt: string;
  readonly producerVersion: "unified-postgres-lifecycle-oracle-v1";
  readonly schemaVersion: 34;
  readonly replaySha256: string;
  readonly seed: number;
  readonly barrierFacts: UnifiedRollingOracleFactsV1;
  readonly rollingFacts: readonly {
    readonly capacity: number;
    readonly seed: number;
    readonly facts: UnifiedRollingOracleFactsV1;
  }[];
  readonly receiptSha256: string;
};

export type UnifiedRollingOracleReceiptUnsealedV1 = Omit<
  UnifiedRollingOracleReceiptV1,
  "version" | "receiptSha256"
> & {
  readonly version?: "unified-rolling-oracle-receipt-v1";
};

function object(
  value: unknown,
  code: string
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(code);
  }
  return value as Readonly<Record<string, unknown>>;
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  code: string
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    throw new TypeError(code);
  }
}

function iso(value: unknown, code: string): string {
  if (typeof value !== "string") throw new TypeError(code);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new TypeError(code);
  }
  return value;
}

function sha(value: unknown, code: string): string {
  if (typeof value !== "string" || !HASH.test(value)) {
    throw new TypeError(code);
  }
  return value;
}

function text(value: unknown, code: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > 512
  ) {
    throw new TypeError(code);
  }
  return value;
}

function boundedCanonicalItem(value: unknown): string {
  const canonical = canonicalizeArtifactJson(value);
  if (Buffer.byteLength(canonical, "utf8") > MAX_REPLAY_ITEM_BYTES) {
    throw new TypeError("unified_provider_replay_item_bytes_limit");
  }
  return canonical;
}

function replayHash(
  envelope: Omit<UnifiedProviderReplayV1, "expectedReplaySha256">
): string {
  return fingerprintCanonicalArtifact(envelope);
}

function compareRequests(
  left: UnifiedProviderReplayRequestV1,
  right: UnifiedProviderReplayRequestV1
): number {
  return left.canonicalRequestSha256.localeCompare(
    right.canonicalRequestSha256
  ) || left.endpoint.localeCompare(right.endpoint);
}

function validateEnvelope(value: unknown): UnifiedProviderReplayV1 {
  const envelope = object(
    value,
    "unified_provider_replay_envelope_invalid"
  );
  exactKeys(envelope, [
    "version",
    "frozenAt",
    "frozenClockIso",
    "schemaVersion",
    "sourceSnapshotSha256",
    "deterministic",
    "requests",
    "responses",
    "expectedReplaySha256"
  ], "unified_provider_replay_envelope_invalid");
  if (envelope.version !== "unified-provider-replay-v1") {
    throw new TypeError("unified_provider_replay_version_invalid");
  }
  if (envelope.schemaVersion !== 34) {
    throw new TypeError("unified_provider_replay_schema_invalid");
  }
  const deterministic = object(
    envelope.deterministic,
    "unified_provider_replay_determinism_invalid"
  );
  exactKeys(deterministic, [
    "runIdSeed",
    "taskIdSeed",
    "requestOrderingSeed",
    "providerConfigurationSha256",
    "labelDatasetSha256",
    "scoringPolicyVersion",
    "attributionPolicyVersion",
    "traversalPolicyVersion"
  ], "unified_provider_replay_determinism_invalid");
  if (
    !Number.isSafeInteger(deterministic.requestOrderingSeed) ||
    Number(deterministic.requestOrderingSeed) < 0
  ) {
    throw new TypeError("unified_provider_replay_order_seed_invalid");
  }
  const validatedDeterminism: UnifiedProviderReplayDeterminismV1 = {
    runIdSeed: text(
      deterministic.runIdSeed,
      "unified_provider_replay_run_seed_invalid"
    ),
    taskIdSeed: text(
      deterministic.taskIdSeed,
      "unified_provider_replay_task_seed_invalid"
    ),
    requestOrderingSeed: Number(deterministic.requestOrderingSeed),
    providerConfigurationSha256: sha(
      deterministic.providerConfigurationSha256,
      "unified_provider_replay_provider_config_invalid"
    ),
    labelDatasetSha256: sha(
      deterministic.labelDatasetSha256,
      "unified_provider_replay_label_dataset_invalid"
    ),
    scoringPolicyVersion: text(
      deterministic.scoringPolicyVersion,
      "unified_provider_replay_scoring_policy_invalid"
    ),
    attributionPolicyVersion: text(
      deterministic.attributionPolicyVersion,
      "unified_provider_replay_attribution_policy_invalid"
    ),
    traversalPolicyVersion: text(
      deterministic.traversalPolicyVersion,
      "unified_provider_replay_traversal_policy_invalid"
    )
  };
  if (
    !Array.isArray(envelope.requests) ||
    envelope.requests.length < 1 ||
    envelope.requests.length > MAX_REPLAY_ITEMS
  ) {
    throw new TypeError("unified_provider_replay_requests_invalid");
  }
  if (
    !Array.isArray(envelope.responses) ||
    envelope.responses.length > MAX_REPLAY_ITEMS
  ) {
    throw new TypeError("unified_provider_replay_responses_invalid");
  }

  const requestIdentities = new Set<string>();
  const referencedResponses = new Set<string>();
  const requests = envelope.requests.map((raw): UnifiedProviderReplayRequestV1 => {
    const row = object(raw, "unified_provider_replay_request_invalid");
    boundedCanonicalItem(row);
    exactKeys(row, [
      "endpoint",
      "canonicalRequestSha256",
      "responseArtifactSha256"
    ], "unified_provider_replay_request_invalid");
    const canonicalRequestSha256 = sha(
      row.canonicalRequestSha256,
      "unified_provider_replay_request_hash_invalid"
    );
    if (requestIdentities.has(canonicalRequestSha256)) {
      throw new Error("unified_provider_replay_request_duplicate");
    }
    requestIdentities.add(canonicalRequestSha256);
    const responseArtifactSha256 = sha(
      row.responseArtifactSha256,
      "unified_provider_replay_response_hash_invalid"
    );
    referencedResponses.add(responseArtifactSha256);
    return {
      endpoint: text(
        row.endpoint,
        "unified_provider_replay_endpoint_invalid"
      ),
      canonicalRequestSha256,
      responseArtifactSha256
    };
  });
  if (requests.some((row, index) =>
    index > 0 && compareRequests(requests[index - 1]!, row) > 0
  )) {
    throw new Error("unified_provider_replay_request_order_invalid");
  }

  const responseHashes = new Set<string>();
  const responses = envelope.responses.map((raw): UnifiedProviderReplayResponseV1 => {
    const row = object(raw, "unified_provider_replay_response_invalid");
    boundedCanonicalItem(row);
    exactKeys(row, [
      "responseArtifactSha256",
      "artifact"
    ], "unified_provider_replay_response_invalid");
    const responseArtifactSha256 = sha(
      row.responseArtifactSha256,
      "unified_provider_replay_response_hash_invalid"
    );
    if (responseHashes.has(responseArtifactSha256)) {
      throw new Error("unified_provider_replay_response_duplicate");
    }
    responseHashes.add(responseArtifactSha256);
    if (
      fingerprintCanonicalArtifact(row.artifact) !== responseArtifactSha256
    ) {
      throw new Error("unified_provider_replay_response_hash_mismatch");
    }
    return { responseArtifactSha256, artifact: row.artifact };
  });
  if (responses.some((row, index) =>
    index > 0 &&
    responses[index - 1]!.responseArtifactSha256.localeCompare(
      row.responseArtifactSha256
    ) > 0
  )) {
    throw new Error("unified_provider_replay_response_order_invalid");
  }
  for (const responseSha256 of referencedResponses) {
    if (!responseHashes.has(responseSha256)) {
      throw new Error("unified_provider_replay_response_missing");
    }
  }
  for (const responseSha256 of responseHashes) {
    if (!referencedResponses.has(responseSha256)) {
      throw new Error("unified_provider_replay_response_unreferenced");
    }
  }

  const validated: UnifiedProviderReplayV1 = {
    version: "unified-provider-replay-v1",
    frozenAt: iso(
      envelope.frozenAt,
      "unified_provider_replay_frozen_at_invalid"
    ),
    frozenClockIso: iso(
      envelope.frozenClockIso,
      "unified_provider_replay_clock_invalid"
    ),
    schemaVersion: 34,
    sourceSnapshotSha256: sha(
      envelope.sourceSnapshotSha256,
      "unified_provider_replay_snapshot_hash_invalid"
    ),
    deterministic: validatedDeterminism,
    requests,
    responses,
    expectedReplaySha256: sha(
      envelope.expectedReplaySha256,
      "unified_provider_replay_hash_invalid"
    )
  };
  const {
    expectedReplaySha256: _expectedReplaySha256,
    ...hashInput
  } = validated;
  if (replayHash(hashInput) !== validated.expectedReplaySha256) {
    throw new Error("unified_provider_replay_hash_mismatch");
  }
  return validated;
}

export function canonicalJsonFilePayload(fileBytes: string): string {
  if (fileBytes.endsWith("\r\n")) return fileBytes.slice(0, -2);
  if (fileBytes.endsWith("\n")) return fileBytes.slice(0, -1);
  return fileBytes;
}

export function parseUnifiedProviderReplayV1(
  rawCanonicalJson: string
): UnifiedProviderReplayV1 {
  if (
    Buffer.byteLength(rawCanonicalJson, "utf8") > MAX_REPLAY_RAW_BYTES
  ) {
    throw new TypeError("unified_provider_replay_bytes_limit");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawCanonicalJson);
  } catch {
    throw new TypeError("unified_provider_replay_json_invalid");
  }
  if (canonicalizeArtifactJson(parsed) !== rawCanonicalJson) {
    throw new Error("unified_provider_replay_noncanonical");
  }
  return validateEnvelope(parsed);
}

export function sealUnifiedProviderReplayV1(
  input: UnifiedProviderReplayUnsealedV1
): { readonly envelope: UnifiedProviderReplayV1; readonly canonicalJson: string } {
  if (
    input.version !== undefined &&
    input.version !== "unified-provider-replay-v1"
  ) {
    throw new TypeError("unified_provider_replay_version_invalid");
  }
  if (
    input.requests.length < 1 ||
    input.requests.length > MAX_REPLAY_ITEMS ||
    input.responses.length > MAX_REPLAY_ITEMS
  ) {
    throw new TypeError("unified_provider_replay_item_count_limit");
  }
  for (const row of input.requests) boundedCanonicalItem(row);
  for (const row of input.responses) boundedCanonicalItem(row);
  const requests = [...input.requests].sort(compareRequests);
  const responses = [...input.responses].sort((left, right) =>
    left.responseArtifactSha256.localeCompare(right.responseArtifactSha256)
  );
  const hashInput: Omit<UnifiedProviderReplayV1, "expectedReplaySha256"> = {
    version: "unified-provider-replay-v1",
    frozenAt: input.frozenAt,
    frozenClockIso: input.frozenClockIso,
    schemaVersion: input.schemaVersion,
    sourceSnapshotSha256: input.sourceSnapshotSha256,
    deterministic: input.deterministic,
    requests,
    responses
  };
  const envelope = validateEnvelope({
    ...hashInput,
    expectedReplaySha256: replayHash(hashInput)
  });
  const canonicalJson = canonicalizeArtifactJson(envelope);
  if (Buffer.byteLength(canonicalJson, "utf8") > MAX_REPLAY_RAW_BYTES) {
    throw new TypeError("unified_provider_replay_bytes_limit");
  }
  return {
    envelope,
    canonicalJson
  };
}

export function createUnifiedProviderReplayRecorderV1(
  metadata: Omit<
    UnifiedProviderReplayUnsealedV1,
    "version" | "requests" | "responses"
  >
) {
  const requests = new Map<string, UnifiedProviderReplayRequestV1>();
  const responses = new Map<string, UnifiedProviderReplayResponseV1>();
  let aggregateItemBytes = 0;
  return {
    record(input: {
      readonly endpoint: string;
      readonly canonicalRequest: unknown;
      readonly responseArtifact: unknown;
    }): UnifiedProviderReplayRequestV1 {
      boundedCanonicalItem(input.canonicalRequest);
      const responseCanonical = boundedCanonicalItem(input.responseArtifact);
      const canonicalRequestSha256 =
        fingerprintCanonicalArtifact(input.canonicalRequest);
      const responseArtifactSha256 =
        fingerprintCanonicalArtifact(input.responseArtifact);
      const existing = requests.get(canonicalRequestSha256);
      if (existing) {
        if (
          existing.endpoint !== input.endpoint ||
          existing.responseArtifactSha256 !== responseArtifactSha256
        ) {
          throw new Error("unified_provider_replay_response_conflict");
        }
        return existing;
      }
      if (requests.size >= MAX_REPLAY_ITEMS) {
        throw new Error("unified_provider_replay_item_count_limit");
      }
      if (
        !responses.has(responseArtifactSha256) &&
        responses.size >= MAX_REPLAY_ITEMS
      ) {
        throw new Error("unified_provider_replay_item_count_limit");
      }
      const requestRow = {
        endpoint: text(
          input.endpoint,
          "unified_provider_replay_endpoint_invalid"
        ),
        canonicalRequestSha256,
        responseArtifactSha256
      };
      const requestBytes = Buffer.byteLength(
        canonicalizeArtifactJson(requestRow),
        "utf8"
      );
      const responseBytes = responses.has(responseArtifactSha256)
        ? 0
        : Buffer.byteLength(responseCanonical, "utf8");
      if (
        aggregateItemBytes + requestBytes + responseBytes >
          MAX_REPLAY_RAW_BYTES
      ) {
        throw new Error("unified_provider_replay_bytes_limit");
      }
      requests.set(canonicalRequestSha256, requestRow);
      responses.set(responseArtifactSha256, {
        responseArtifactSha256,
        artifact: input.responseArtifact
      });
      aggregateItemBytes += requestBytes + responseBytes;
      return requestRow;
    },
    seal() {
      return sealUnifiedProviderReplayV1({
        ...metadata,
        schemaVersion: metadata.schemaVersion,
        requests: [...requests.values()],
        responses: [...responses.values()]
      });
    }
  };
}

export function createUnifiedProviderReplayerV1(rawCanonicalJson: string): {
  readonly frozenClockIso: string;
  readonly sourceSnapshotSha256: string;
  readonly replaySha256: string;
  replayByIdentity(input: {
    readonly endpoint: string;
    readonly canonicalRequestSha256: string;
  }): unknown;
  replay(input: {
    readonly endpoint: string;
    readonly canonicalRequest: unknown;
  }): unknown;
} {
  const envelope = parseUnifiedProviderReplayV1(rawCanonicalJson);
  const responses = new Map(envelope.responses.map((row) => [
    row.responseArtifactSha256,
    deepFreezeCanonicalJson(row.artifact)
  ]));
  const requests = new Map(envelope.requests.map((row) => [
    `${row.endpoint}\0${row.canonicalRequestSha256}`,
    row.responseArtifactSha256
  ]));
  return {
    frozenClockIso: envelope.frozenClockIso,
    sourceSnapshotSha256: envelope.sourceSnapshotSha256,
    replaySha256: envelope.expectedReplaySha256,
    replayByIdentity(input) {
      const identity = sha(
        input.canonicalRequestSha256,
        "unified_provider_replay_request_hash_invalid"
      );
      const responseSha256 = requests.get(`${input.endpoint}\0${identity}`);
      if (!responseSha256) {
        throw new Error("unified_provider_replay_request_missing");
      }
      const artifact = responses.get(responseSha256);
      if (artifact === undefined) {
        throw new Error("unified_provider_replay_response_missing");
      }
      return artifact;
    },
    replay(input) {
      const identity = fingerprintCanonicalArtifact(input.canonicalRequest);
      const responseSha256 = requests.get(`${input.endpoint}\0${identity}`);
      if (!responseSha256) {
        throw new Error("unified_provider_replay_request_missing");
      }
      const artifact = responses.get(responseSha256);
      if (artifact === undefined) {
        throw new Error("unified_provider_replay_response_missing");
      }
      return artifact;
    }
  };
}

function deepFreezeCanonicalJson(value: unknown): unknown {
  const canonicalClone = JSON.parse(canonicalizeArtifactJson(value)) as unknown;
  const freeze = (node: unknown): unknown => {
    if (node === null || typeof node !== "object" || Object.isFrozen(node)) {
      return node;
    }
    for (const child of Object.values(node)) freeze(child);
    return Object.freeze(node);
  };
  return freeze(canonicalClone);
}

function canonicalPath(parent: string, key: string | number): string {
  if (typeof key === "number") return `${parent}[${key}]`;
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key)
    ? `${parent}.${key}`
    : `${parent}[${JSON.stringify(key)}]`;
}

function firstDifference(
  left: unknown,
  right: unknown,
  path: string
): string | null {
  if (Object.is(left, right)) return null;
  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      if (index >= left.length || index >= right.length) {
        return canonicalPath(path, index);
      }
      const difference = firstDifference(
        left[index],
        right[index],
        canonicalPath(path, index)
      );
      if (difference !== null) return difference;
    }
    return null;
  }
  if (
    left !== null &&
    right !== null &&
    typeof left === "object" &&
    typeof right === "object" &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const leftRecord = left as Readonly<Record<string, unknown>>;
    const rightRecord = right as Readonly<Record<string, unknown>>;
    const keys = [...new Set([
      ...Object.keys(leftRecord),
      ...Object.keys(rightRecord)
    ])].sort();
    for (const key of keys) {
      if (!(key in leftRecord) || !(key in rightRecord)) {
        return canonicalPath(path, key);
      }
      const difference = firstDifference(
        leftRecord[key],
        rightRecord[key],
        canonicalPath(path, key)
      );
      if (difference !== null) return difference;
    }
    return null;
  }
  return path;
}

export function compareUnifiedReplayOracleFacts(
  expected: unknown,
  actual: unknown
): {
  readonly equivalent: boolean;
  readonly firstDifferingCanonicalPath: string | null;
} {
  const normalizedExpected = JSON.parse(canonicalizeArtifactJson(expected));
  const normalizedActual = JSON.parse(canonicalizeArtifactJson(actual));
  const firstDifferingCanonicalPath = firstDifference(
    normalizedExpected,
    normalizedActual,
    "$"
  );
  return {
    equivalent: firstDifferingCanonicalPath === null,
    firstDifferingCanonicalPath
  };
}

const ROLLING_ORACLE_CAPACITIES = [1, 4, 8, 16, 32, 100] as const;

function nonNegativeInteger(value: unknown, code: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new TypeError(code);
  }
  return value;
}

function stringArray(
  value: unknown,
  code: string,
  minimumLength = 0,
  unique = true
): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length < minimumLength ||
    value.length > MAX_REPLAY_ITEMS
  ) {
    throw new TypeError(code);
  }
  const parsed = value.map((item) => text(item, code));
  if (unique && new Set(parsed).size !== parsed.length) {
    throw new TypeError(code);
  }
  return parsed;
}

function validateCanonicalFact(
  value: unknown
): Readonly<Record<string, unknown>> {
  const code = "unified_rolling_oracle_receipt_facts_invalid";
  const fact = object(value, code);
  exactKeys(fact, [
    "version",
    "id",
    "profile",
    "factType",
    "subject",
    "subjectRole",
    "lane",
    "strength",
    "sourceBranches",
    "directness",
    "timing",
    "payload"
  ], code);
  if (
    fact.version !== "canonical-fact-v1" ||
    !["event", "state", "path"].includes(String(fact.profile)) ||
    !["hard", "pattern", "context", "neutral"].includes(
      String(fact.lane)
    ) ||
    !["exact", "corroborated", "contextual"].includes(
      String(fact.strength)
    ) ||
    !["direct", "indirect"].includes(String(fact.directness)) ||
    !["at_event", "later", "current", "unknown"].includes(
      String(fact.timing)
    )
  ) {
    throw new TypeError(code);
  }
  sha(fact.id, code);
  text(fact.factType, code);
  text(fact.subject, code);
  text(fact.subjectRole, code);
  const sourceBranches = stringArray(fact.sourceBranches, code, 1);
  if (sourceBranches.some((branch) =>
    !["fast", "where", "deep"].includes(branch)
  )) {
    throw new TypeError(code);
  }
  return fact;
}

function validateFrontierState(
  value: unknown
): Readonly<Record<string, unknown>> {
  const code = "unified_rolling_oracle_receipt_facts_invalid";
  const state = object(value, code);
  exactKeys(state, [
    "address",
    "direction",
    "anchorTimestamp",
    "fundingEpisodeId",
    "allocatedAmountRaw",
    "sourceEventIds"
  ], code);
  text(state.address, code);
  if (state.direction !== "backward" && state.direction !== "forward") {
    throw new TypeError(code);
  }
  iso(state.anchorTimestamp, code);
  text(state.fundingEpisodeId, code);
  if (
    typeof state.allocatedAmountRaw !== "string" ||
    !/^(?:0|[1-9][0-9]*)$/u.test(state.allocatedAmountRaw)
  ) {
    throw new TypeError(code);
  }
  stringArray(state.sourceEventIds, code);
  return state;
}

function validateRollingOracleFacts(
  value: unknown
): UnifiedRollingOracleFactsV1 {
  boundedCanonicalItem(value);
  const code = "unified_rolling_oracle_receipt_facts_invalid";
  const facts = object(value, code);
  exactKeys(facts, [
    "canonicalFacts",
    "finalFrontier",
    "closureCertificate",
    "score",
    "decision",
    "evidenceBundleSha256",
    "traversalClosureSha256",
    "scoringBundleSha256",
    "reportSha256",
    "eligibleDeliveryIntentCount",
    "externalTelegramSends",
    "providerResponseArtifactSha256s",
    "committedSequenceCount",
    "duplicateCommitCount",
    "duplicateSequenceCount"
  ], code);
  const inventory = object(facts.canonicalFacts, code);
  exactKeys(inventory, ["version", "facts"], code);
  if (
    inventory.version !== "canonical-fact-inventory-v1" ||
    !Array.isArray(inventory.facts) ||
    inventory.facts.length < 1 ||
    inventory.facts.length > MAX_REPLAY_ITEMS
  ) {
    throw new TypeError(code);
  }
  const canonicalFacts = {
    version: "canonical-fact-inventory-v1" as const,
    facts: inventory.facts.map(validateCanonicalFact)
  };
  if (
    !Array.isArray(facts.finalFrontier) ||
    facts.finalFrontier.length > MAX_REPLAY_ITEMS
  ) {
    throw new TypeError(code);
  }
  const finalFrontier = facts.finalFrontier.map(validateFrontierState);
  const closure = object(facts.closureCertificate, code);
  exactKeys(closure, [
    "version",
    "schemaVersion",
    "analysisManifestHash",
    "snapshotHash",
    "visitedStateHash",
    "frontierHash",
    "closed"
  ], code);
  if (
    closure.version !== "traversal-closure-certificate-v1" ||
    closure.schemaVersion !== 1 ||
    closure.closed !== true
  ) {
    throw new TypeError(code);
  }
  const closureCertificate = {
    version: "traversal-closure-certificate-v1" as const,
    schemaVersion: 1 as const,
    analysisManifestHash: sha(closure.analysisManifestHash, code),
    snapshotHash: sha(closure.snapshotHash, code),
    visitedStateHash: sha(closure.visitedStateHash, code),
    frontierHash: sha(closure.frontierHash, code),
    closed: true as const
  };
  const score = nonNegativeInteger(facts.score, code);
  if (score > 100) throw new TypeError(code);
  if (!["ACCEPTABLE", "REVIEW", "DECLINE"].includes(
    String(facts.decision)
  )) {
    throw new TypeError(code);
  }
  const providerResponseArtifactSha256s = stringArray(
    facts.providerResponseArtifactSha256s,
    code,
    1,
    false
  ).map((value) => sha(value, code));
  const eligibleDeliveryIntentCount = nonNegativeInteger(
    facts.eligibleDeliveryIntentCount,
    code
  );
  const externalTelegramSends = nonNegativeInteger(
    facts.externalTelegramSends,
    code
  );
  const committedSequenceCount = nonNegativeInteger(
    facts.committedSequenceCount,
    code
  );
  const duplicateCommitCount = nonNegativeInteger(
    facts.duplicateCommitCount,
    code
  );
  const duplicateSequenceCount = nonNegativeInteger(
    facts.duplicateSequenceCount,
    code
  );
  if (
    eligibleDeliveryIntentCount < 1 ||
    externalTelegramSends !== 0 ||
    committedSequenceCount !== providerResponseArtifactSha256s.length ||
    duplicateCommitCount > committedSequenceCount ||
    duplicateSequenceCount > committedSequenceCount
  ) {
    throw new TypeError(code);
  }
  return {
    canonicalFacts,
    finalFrontier,
    closureCertificate,
    score,
    decision: facts.decision as UnifiedRollingOracleFactsV1["decision"],
    evidenceBundleSha256: sha(facts.evidenceBundleSha256, code),
    traversalClosureSha256: sha(facts.traversalClosureSha256, code),
    scoringBundleSha256: sha(facts.scoringBundleSha256, code),
    reportSha256: sha(facts.reportSha256, code),
    eligibleDeliveryIntentCount,
    externalTelegramSends,
    providerResponseArtifactSha256s,
    committedSequenceCount,
    duplicateCommitCount,
    duplicateSequenceCount
  };
}

function validateRollingOracleReceiptFields(
  value: unknown
): Omit<UnifiedRollingOracleReceiptV1, "receiptSha256"> {
  const receipt = object(
    value,
    "unified_rolling_oracle_receipt_invalid"
  );
  exactKeys(receipt, [
    "version",
    "generatedAt",
    "producerVersion",
    "schemaVersion",
    "replaySha256",
    "seed",
    "barrierFacts",
    "rollingFacts"
  ], "unified_rolling_oracle_receipt_shape_invalid");
  if (receipt.version !== "unified-rolling-oracle-receipt-v1") {
    throw new TypeError("unified_rolling_oracle_receipt_version_invalid");
  }
  if (
    receipt.producerVersion !==
    "unified-postgres-lifecycle-oracle-v1"
  ) {
    throw new TypeError("unified_rolling_oracle_receipt_producer_invalid");
  }
  if (receipt.schemaVersion !== 34) {
    throw new TypeError("unified_rolling_oracle_receipt_schema_invalid");
  }
  if (
    typeof receipt.seed !== "number" ||
    !Number.isSafeInteger(receipt.seed) ||
    receipt.seed <= 0
  ) {
    throw new TypeError("unified_rolling_oracle_receipt_seed_invalid");
  }
  if (
    !Array.isArray(receipt.rollingFacts) ||
    receipt.rollingFacts.length !== ROLLING_ORACLE_CAPACITIES.length
  ) {
    throw new TypeError("unified_rolling_oracle_receipt_capacity_invalid");
  }
  const barrierFacts = validateRollingOracleFacts(receipt.barrierFacts);
  const rollingFacts = receipt.rollingFacts.map((item, index) => {
    const row = object(
      item,
      "unified_rolling_oracle_receipt_row_invalid"
    );
    exactKeys(row, [
      "capacity",
      "seed",
      "facts"
    ], "unified_rolling_oracle_receipt_row_invalid");
    if (row.capacity !== ROLLING_ORACLE_CAPACITIES[index]) {
      throw new TypeError("unified_rolling_oracle_receipt_capacity_invalid");
    }
    if (row.seed !== Number(receipt.seed) + Number(row.capacity)) {
      throw new TypeError("unified_rolling_oracle_receipt_seed_invalid");
    }
    const facts = validateRollingOracleFacts(row.facts);
    const comparison = compareUnifiedReplayOracleFacts(
      barrierFacts,
      facts
    );
    if (!comparison.equivalent) {
      throw new Error(
        "unified_rolling_oracle_receipt_mismatch:" +
        `capacity=${row.capacity}:path=` +
        comparison.firstDifferingCanonicalPath
      );
    }
    return {
      capacity: row.capacity as number,
      seed: row.seed as number,
      facts
    };
  });
  return {
    version: "unified-rolling-oracle-receipt-v1",
    generatedAt: iso(
      receipt.generatedAt,
      "unified_rolling_oracle_receipt_clock_invalid"
    ),
    producerVersion: "unified-postgres-lifecycle-oracle-v1",
    schemaVersion: 34,
    replaySha256: sha(
      receipt.replaySha256,
      "unified_rolling_oracle_receipt_replay_hash_invalid"
    ),
    seed: receipt.seed,
    barrierFacts,
    rollingFacts
  };
}

export function sealUnifiedRollingOracleReceiptV1(
  input: UnifiedRollingOracleReceiptUnsealedV1
): {
  readonly envelope: UnifiedRollingOracleReceiptV1;
  readonly canonicalJson: string;
} {
  const normalized = JSON.parse(canonicalizeArtifactJson({
    version: input.version ?? "unified-rolling-oracle-receipt-v1",
    generatedAt: input.generatedAt,
    producerVersion: input.producerVersion,
    schemaVersion: input.schemaVersion,
    replaySha256: input.replaySha256,
    seed: input.seed,
    barrierFacts: input.barrierFacts,
    rollingFacts: input.rollingFacts
  }));
  const withoutHash = validateRollingOracleReceiptFields(normalized);
  const envelope: UnifiedRollingOracleReceiptV1 = {
    ...withoutHash,
    receiptSha256: fingerprintCanonicalArtifact(withoutHash)
  };
  const canonicalJson = canonicalizeArtifactJson(envelope);
  if (Buffer.byteLength(canonicalJson, "utf8") > MAX_REPLAY_RAW_BYTES) {
    throw new TypeError("unified_rolling_oracle_receipt_bytes_limit");
  }
  return {
    envelope,
    canonicalJson
  };
}

export function parseUnifiedRollingOracleReceiptV1(
  rawCanonicalJson: string
): UnifiedRollingOracleReceiptV1 {
  if (Buffer.byteLength(rawCanonicalJson, "utf8") > MAX_REPLAY_RAW_BYTES) {
    throw new TypeError("unified_rolling_oracle_receipt_bytes_limit");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawCanonicalJson);
  } catch {
    throw new TypeError("unified_rolling_oracle_receipt_json_invalid");
  }
  if (canonicalizeArtifactJson(parsed) !== rawCanonicalJson) {
    throw new TypeError("unified_rolling_oracle_receipt_noncanonical");
  }
  const receipt = object(
    parsed,
    "unified_rolling_oracle_receipt_invalid"
  );
  exactKeys(receipt, [
    "version",
    "generatedAt",
    "producerVersion",
    "schemaVersion",
    "replaySha256",
    "seed",
    "barrierFacts",
    "rollingFacts",
    "receiptSha256"
  ], "unified_rolling_oracle_receipt_shape_invalid");
  const {
    receiptSha256: _receiptSha256,
    ...withoutHash
  } = receipt;
  const validated = validateRollingOracleReceiptFields(withoutHash);
  const receiptSha256 = sha(
    receipt.receiptSha256,
    "unified_rolling_oracle_receipt_hash_invalid"
  );
  if (fingerprintCanonicalArtifact(validated) !== receiptSha256) {
    throw new Error("unified_rolling_oracle_receipt_hash_mismatch");
  }
  return {
    ...validated,
    receiptSha256
  };
}
