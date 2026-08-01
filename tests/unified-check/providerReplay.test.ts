import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  createUnifiedProviderReplayRecorderV1,
  createUnifiedProviderReplayerV1,
  canonicalJsonFilePayload,
  compareUnifiedReplayOracleFacts,
  parseUnifiedRollingOracleReceiptV1,
  parseUnifiedProviderReplayV1,
  sealUnifiedRollingOracleReceiptV1,
  sealUnifiedProviderReplayV1,
  type UnifiedProviderReplayV1
} from "../../src/unifiedCheck/providerReplay";
import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../../src/forensics/canonicalJson";

const metadata = {
  frozenAt: "2026-07-24T12:00:00.000Z",
  frozenClockIso: "2026-07-24T12:00:00.000Z",
  schemaVersion: 34 as const,
  sourceSnapshotSha256: "a".repeat(64),
  deterministic: {
    runIdSeed: "replay-run-v1",
    taskIdSeed: "replay-task-v1",
    requestOrderingSeed: 24072026,
    providerConfigurationSha256: "b".repeat(64),
    labelDatasetSha256: "c".repeat(64),
    scoringPolicyVersion: "scoring-signal-matrix-v4",
    attributionPolicyVersion: "selected-attribution-policy-v1",
    traversalPolicyVersion: "snapshot-closure-v1"
  }
};

function request(cursor: string | null) {
  return {
    version: "provider-request-identity-v1",
    endpoint: "/api/token_trc20/transfers",
    address: "TPCP7B17wCeybFDvsnU4AWqQotT46J5nZV",
    cursor
  };
}

function sealed(): {
  envelope: UnifiedProviderReplayV1;
  canonicalJson: string;
} {
  const canonicalRequest = request(null);
  const responseArtifact = {
    version: "provider-response-v1",
    page: 1,
    transfers: [{ transactionId: "tx-1", amountRaw: "1000000" }]
  };
  return sealUnifiedProviderReplayV1({
    ...metadata,
    requests: [{
      endpoint: canonicalRequest.endpoint,
      canonicalRequestSha256:
        fingerprintCanonicalArtifact(canonicalRequest),
      responseArtifactSha256:
        fingerprintCanonicalArtifact(responseArtifact)
    }],
    responses: [{
      responseArtifactSha256:
        fingerprintCanonicalArtifact(responseArtifact),
      artifact: responseArtifact
    }]
  });
}

function reseal(
  envelope: Omit<UnifiedProviderReplayV1, "expectedReplaySha256">
): string {
  return sealUnifiedProviderReplayV1(envelope).canonicalJson;
}

function oracleFacts() {
  return {
    canonicalFacts: {
      version: "canonical-fact-inventory-v1",
      facts: [{
        version: "canonical-fact-v1",
        id: "1".repeat(64),
        profile: "state",
        factType: "neutral_no_observed_risk",
        subject: "TPCP7B17wCeybFDvsnU4AWqQotT46J5nZV",
        subjectRole: "subject",
        lane: "neutral",
        strength: "exact",
        sourceBranches: ["fast"],
        directness: "direct",
        timing: "current",
        payload: null
      }]
    },
    finalFrontier: [],
    closureCertificate: {
      version: "traversal-closure-certificate-v1",
      schemaVersion: 1,
      analysisManifestHash: "2".repeat(64),
      snapshotHash: "3".repeat(64),
      visitedStateHash: "4".repeat(64),
      frontierHash: "5".repeat(64),
      closed: true
    },
    score: 0,
    decision: "ACCEPTABLE",
    evidenceBundleSha256: "6".repeat(64),
    traversalClosureSha256: "7".repeat(64),
    scoringBundleSha256: "8".repeat(64),
    reportSha256: "9".repeat(64),
    eligibleDeliveryIntentCount: 1,
    externalTelegramSends: 0,
    providerResponseArtifactSha256s: ["a".repeat(64)],
    committedSequenceCount: 1,
    duplicateCommitCount: 0,
    duplicateSequenceCount: 0
  } as const;
}

describe("Unified frozen provider replay V1", () => {
  it("parses only canonical bytes and serves bounded responses without a network seam", () => {
    const fixture = sealed();
    const parsed = parseUnifiedProviderReplayV1(fixture.canonicalJson);
    const replay = createUnifiedProviderReplayerV1(fixture.canonicalJson);

    const {
      expectedReplaySha256: _expectedReplaySha256,
      ...hashInput
    } = parsed;
    expect(parsed.expectedReplaySha256).toBe(
      fingerprintCanonicalArtifact(hashInput)
    );
    expect(replay.replay({
      endpoint: "/api/token_trc20/transfers",
      canonicalRequest: request(null)
    })).toEqual({
      version: "provider-response-v1",
      page: 1,
      transfers: [{ transactionId: "tx-1", amountRaw: "1000000" }]
    });
    expect(Object.keys(replay).sort()).toEqual([
      "frozenClockIso",
      "replay",
      "replayByIdentity",
      "replaySha256",
      "sourceSnapshotSha256"
    ]);
    expect(() => parseUnifiedProviderReplayV1(
      `${fixture.canonicalJson}\n`
    )).toThrow("unified_provider_replay_noncanonical");
  });

  it("returns isolated deeply frozen canonical response snapshots", () => {
    const replay = createUnifiedProviderReplayerV1(sealed().canonicalJson);
    const first = replay.replay({
      endpoint: "/api/token_trc20/transfers",
      canonicalRequest: request(null)
    }) as {
      page: number;
      transfers: Array<{ amountRaw: string }>;
    };

    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.transfers)).toBe(true);
    expect(Object.isFrozen(first.transfers[0])).toBe(true);
    expect(() => {
      first.transfers[0]!.amountRaw = "tampered";
    }).toThrow();

    expect(replay.replay({
      endpoint: "/api/token_trc20/transfers",
      canonicalRequest: request(null)
    })).toEqual({
      version: "provider-response-v1",
      page: 1,
      transfers: [{ transactionId: "tx-1", amountRaw: "1000000" }]
    });
  });

  it("rejects invalid envelope fields and hashes", () => {
    const { envelope } = sealed();
    expect(() => reseal({ ...envelope, version: "wrong" as never }))
      .toThrow("unified_provider_replay_version_invalid");
    expect(() => reseal({ ...envelope, schemaVersion: 33 as never }))
      .toThrow("unified_provider_replay_schema_invalid");
    expect(() => reseal({ ...envelope, frozenClockIso: "yesterday" }))
      .toThrow("unified_provider_replay_clock_invalid");
    expect(() => reseal({ ...envelope, sourceSnapshotSha256: "bad" }))
      .toThrow("unified_provider_replay_snapshot_hash_invalid");
    expect(() => reseal({
      ...envelope,
      requests: [{
        ...envelope.requests[0]!,
        canonicalRequestSha256: "bad"
      }]
    })).toThrow("unified_provider_replay_request_hash_invalid");
  });

  it("rejects duplicate requests, missing or unreferenced responses, and response tampering", () => {
    const { envelope } = sealed();
    expect(() => reseal({
      ...envelope,
      requests: [...envelope.requests, envelope.requests[0]!]
    })).toThrow("unified_provider_replay_request_duplicate");
    expect(() => reseal({
      ...envelope,
      responses: []
    })).toThrow("unified_provider_replay_response_missing");

    const extraArtifact = { version: "provider-response-v1", page: 99 };
    expect(() => reseal({
      ...envelope,
      responses: [...envelope.responses, {
        responseArtifactSha256:
          fingerprintCanonicalArtifact(extraArtifact),
        artifact: extraArtifact
      }]
    })).toThrow("unified_provider_replay_response_unreferenced");

    expect(() => reseal({
      ...envelope,
      responses: [{
        ...envelope.responses[0]!,
        artifact: { tampered: true }
      }]
    })).toThrow("unified_provider_replay_response_hash_mismatch");
  });

  it("rejects a replay hash mismatch after otherwise valid canonical parsing", () => {
    const { envelope } = sealed();
    const tampered = {
      ...envelope,
      expectedReplaySha256: "f".repeat(64)
    };
    expect(() => parseUnifiedProviderReplayV1(
      canonicalizeArtifactJson(tampered)
    )).toThrow("unified_provider_replay_hash_mismatch");
  });

  it("records each canonical identity once, reuses identical responses, and rejects mutation", () => {
    const recorder = createUnifiedProviderReplayRecorderV1(metadata);
    const response = { version: "provider-response-v1", rows: [1, 2] };
    const first = recorder.record({
      endpoint: "/api/token_trc20/transfers",
      canonicalRequest: request(null),
      responseArtifact: response
    });
    const repeated = recorder.record({
      endpoint: "/api/token_trc20/transfers",
      canonicalRequest: request(null),
      responseArtifact: response
    });

    expect(repeated).toEqual(first);
    expect(recorder.seal().envelope.requests).toHaveLength(1);
    expect(recorder.seal().envelope.responses).toHaveLength(1);
    expect(() => recorder.record({
      endpoint: "/api/token_trc20/transfers",
      canonicalRequest: request(null),
      responseArtifact: { version: "provider-response-v1", rows: [3] }
    })).toThrow("unified_provider_replay_response_conflict");
  });

  it.each([
    ["{}", "{}"],
    ["{}\n", "{}"],
    ["{}\r\n", "{}"],
    ["{}\n\n", "{}\n"]
  ] as const)("removes one file line ending from %j", (bytes, expected) => {
    expect(canonicalJsonFilePayload(bytes)).toBe(expected);
  });

  it("ships a canonical, non-empty multi-page and multi-branch replay fixture", async () => {
    const fileBytes = await readFile(
      "tests/fixtures/unified-wallet/adaptive-rolling-provider-replay.json",
      "utf8"
    );
    const raw = canonicalJsonFilePayload(fileBytes);
    expect(
      fileBytes === `${raw}\n` || fileBytes === `${raw}\r\n`
    ).toBe(true);
    expect(canonicalizeArtifactJson(JSON.parse(raw))).toBe(raw);
    const parsed = parseUnifiedProviderReplayV1(raw);
    expect(parsed.requests.length).toBeGreaterThanOrEqual(6);
    expect(new Set(parsed.requests.map((row) => row.endpoint)).size)
      .toBeGreaterThanOrEqual(2);
    expect(parsed.responses.some((row) =>
      JSON.stringify(row.artifact).includes("nextCursor")
    )).toBe(true);
    expect(parsed.responses.every((row) =>
      canonicalizeArtifactJson(row.artifact) !== "{}"
    )).toBe(true);
  });

  it("reports the first differing canonical oracle path and detects a mutation", () => {
    const expected = {
      canonicalFacts: [{ id: "fact-1", payload: { amountRaw: "10" } }],
      hashes: { evidence: "a".repeat(64) }
    };
    expect(compareUnifiedReplayOracleFacts(expected, expected)).toEqual({
      equivalent: true,
      firstDifferingCanonicalPath: null
    });
    expect(compareUnifiedReplayOracleFacts(expected, {
      ...expected,
      canonicalFacts: [{
        id: "fact-1",
        payload: { amountRaw: "11" }
      }]
    })).toEqual({
      equivalent: false,
      firstDifferingCanonicalPath: "$.canonicalFacts[0].payload.amountRaw"
    });
  });

  it("seals only an exact immutable PostgreSQL lifecycle oracle receipt", () => {
    const facts = oracleFacts();
    const sealedReceipt = sealUnifiedRollingOracleReceiptV1({
      generatedAt: metadata.frozenClockIso,
      producerVersion: "unified-postgres-lifecycle-oracle-v1",
      schemaVersion: 34,
      replaySha256: sealed().envelope.expectedReplaySha256,
      seed: 24072026,
      barrierFacts: facts,
      rollingFacts: [1, 4, 8, 16, 32, 100].map((capacity) => ({
        capacity,
        seed: 24072026 + capacity,
        facts
      }))
    });

    expect(parseUnifiedRollingOracleReceiptV1(
      sealedReceipt.canonicalJson
    )).toEqual(sealedReceipt.envelope);
    expect(() => parseUnifiedRollingOracleReceiptV1(
      `${sealedReceipt.canonicalJson}\n`
    )).toThrow("unified_rolling_oracle_receipt_noncanonical");
    expect(() => sealUnifiedRollingOracleReceiptV1({
      ...sealedReceipt.envelope,
      rollingFacts: sealedReceipt.envelope.rollingFacts.map((row) =>
        row.capacity === 16
          ? {
              ...row,
              facts: {
                ...facts,
                eligibleDeliveryIntentCount: 2
              }
            }
          : row
      )
    })).toThrow(
      "unified_rolling_oracle_receipt_mismatch:" +
      "capacity=16:path=$.eligibleDeliveryIntentCount"
    );
  });

  it("rejects empty, extra, missing, or mistyped canonical oracle facts", () => {
    const facts = oracleFacts();
    const receipt = (barrierFacts: unknown) => ({
      generatedAt: metadata.frozenClockIso,
      producerVersion: "unified-postgres-lifecycle-oracle-v1" as const,
      schemaVersion: 34 as const,
      replaySha256: sealed().envelope.expectedReplaySha256,
      seed: 24072026,
      barrierFacts,
      rollingFacts: [1, 4, 8, 16, 32, 100].map((capacity) => ({
        capacity,
        seed: 24072026 + capacity,
        facts: barrierFacts
      }))
    });

    expect(() => sealUnifiedRollingOracleReceiptV1(
      receipt({}) as never
    )).toThrow("unified_rolling_oracle_receipt_facts_invalid");
    expect(() => sealUnifiedRollingOracleReceiptV1(receipt({
      ...facts,
      unexpected: true
    }) as never)).toThrow("unified_rolling_oracle_receipt_facts_invalid");
    const {
      reportSha256: _reportSha256,
      ...missing
    } = facts;
    expect(() => sealUnifiedRollingOracleReceiptV1(
      receipt(missing) as never
    )).toThrow("unified_rolling_oracle_receipt_facts_invalid");
    expect(() => sealUnifiedRollingOracleReceiptV1(receipt({
      ...facts,
      canonicalFacts: {
        ...facts.canonicalFacts,
        facts: []
      }
    }) as never)).toThrow("unified_rolling_oracle_receipt_facts_invalid");
    expect(() => sealUnifiedRollingOracleReceiptV1(receipt({
      ...facts,
      score: "0"
    }) as never)).toThrow("unified_rolling_oracle_receipt_facts_invalid");
    expect(() => sealUnifiedRollingOracleReceiptV1(receipt({
      ...facts,
      providerResponseArtifactSha256s: []
    }) as never)).toThrow("unified_rolling_oracle_receipt_facts_invalid");
  });

  it("bounds raw bytes and individual artifacts before parsing or recording", () => {
    expect(() => parseUnifiedProviderReplayV1(
      " ".repeat(16 * 1024 * 1024 + 1)
    )).toThrow("unified_provider_replay_bytes_limit");

    const recorder = createUnifiedProviderReplayRecorderV1(metadata);
    expect(() => recorder.record({
      endpoint: "/oversized",
      canonicalRequest: { id: 1 },
      responseArtifact: { payload: "x".repeat(4 * 1024 * 1024 + 1) }
    })).toThrow("unified_provider_replay_item_bytes_limit");

    expect(() => parseUnifiedRollingOracleReceiptV1(
      " ".repeat(16 * 1024 * 1024 + 1)
    )).toThrow("unified_rolling_oracle_receipt_bytes_limit");
    const oversizedFacts = {
      ...oracleFacts(),
      canonicalFacts: {
        ...oracleFacts().canonicalFacts,
        facts: [{
          ...oracleFacts().canonicalFacts.facts[0],
          payload: "x".repeat(4 * 1024 * 1024 + 1)
        }]
      }
    };
    expect(() => sealUnifiedRollingOracleReceiptV1({
      generatedAt: metadata.frozenClockIso,
      producerVersion: "unified-postgres-lifecycle-oracle-v1",
      schemaVersion: 34,
      replaySha256: sealed().envelope.expectedReplaySha256,
      seed: 24072026,
      barrierFacts: oversizedFacts,
      rollingFacts: [1, 4, 8, 16, 32, 100].map((capacity) => ({
        capacity,
        seed: 24072026 + capacity,
        facts: oversizedFacts
      }))
    } as never)).toThrow("unified_provider_replay_item_bytes_limit");
  });

  it("stops recorder aggregate growth before a sealed replay can exceed 16 MiB", () => {
    const recorder = createUnifiedProviderReplayRecorderV1(metadata);
    for (let index = 0; index < 4; index += 1) {
      recorder.record({
        endpoint: "/aggregate",
        canonicalRequest: { index },
        responseArtifact: {
          index,
          payload: "x".repeat(3_500_000)
        }
      });
    }
    expect(() => recorder.record({
      endpoint: "/aggregate",
      canonicalRequest: { index: 4 },
      responseArtifact: {
        index: 4,
        payload: "x".repeat(3_500_000)
      }
    })).toThrow("unified_provider_replay_bytes_limit");
  });

  it("bounds recorder growth before inserting another request identity", () => {
    const recorder = createUnifiedProviderReplayRecorderV1(metadata);
    for (let index = 0; index < 10_000; index += 1) {
      recorder.record({
        endpoint: "/bounded",
        canonicalRequest: { index },
        responseArtifact: { shared: true }
      });
    }
    expect(() => recorder.record({
      endpoint: "/bounded",
      canonicalRequest: { index: 10_000 },
      responseArtifact: { shared: true }
    })).toThrow("unified_provider_replay_item_count_limit");
  });
});
