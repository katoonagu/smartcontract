import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import pg from "pg";
import { fingerprintCanonicalArtifact } from "../../src/forensics/canonicalJson";
import {
  canonicalTronUsdtEventKey
} from "../../src/forensics/tronAddressAllTimeIndex";
import {
  runUnifiedDeepBranch,
  runUnifiedFastBranch,
  runUnifiedWhereBranch
} from "../../src/unifiedCheck/branchAdapters";
import type {
  AnalysisManifestV1,
  ChildAttemptArtifactV1
} from "../../src/unifiedCheck/contracts";
import {
  runUnifiedProductionFinalizationCycle
} from "../../src/unifiedCheck/productionFinalizer";
import {
  canonicalizeUnifiedDirectHistoryPages
} from "../../src/unifiedCheck/productionDirectHistory";
import type {
  UnifiedTraversalArtifactV1
} from "../../src/unifiedCheck/productionTraversal";
import type {
  UnifiedTransactionalQueryable
} from "../../src/unifiedCheck/repository";
import {
  buildUnifiedBranchInput
} from "../../src/unifiedCheck/requestService";
import {
  buildTraversalCoverage,
  traversalStateId,
  type TraversalStateV1
} from "../../src/unifiedCheck/traversal";
import type { IndexedTronUsdtTransfer } from "../../src/types";

const connectionString = process.env.TEST_DATABASE_URL;
const postgresDescribe = connectionString ? describe : describe.skip;
const SUBJECT = "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy";
const SOURCE = "TUpHuDkiCCmwaTZBHZvQdwWzGNm5t8J2b9";

postgresDescribe("Unified production finalizer", () => {
  it("commits one dossier and one pending delivery after every child is accepted", async () => {
    const pool = new pg.Pool({ connectionString, max: 1 });
    const client = await pool.connect();
    const schema = `unifiedfinal_${randomUUID().replaceAll("-", "")}`;
    const query = (sql: string, values?: readonly unknown[]) =>
      client.query(sql, values as unknown[]);
    const db: UnifiedTransactionalQueryable = {
      query,
      async transaction<T>(
        work: (tx: { query: typeof query }) => Promise<T>
      ): Promise<T> {
        await client.query("begin");
        try {
          const result = await work({ query });
          await client.query("commit");
          return result;
        } catch (error) {
          await client.query("rollback");
          throw error;
        }
      }
    };
    try {
      await client.query(`create schema "${schema}"`);
      await client.query(`set search_path to "${schema}"`);
      await client.query(
        await readFile("migrations/033_unified_wallet_check.sql", "utf8")
      );
      const snapshot = {
        version: "confirmed-wallet-snapshot-v1",
        schemaVersion: 1,
        chain: "tron",
        subjectAddress: SUBJECT,
        confirmedBlockNumber: "100",
        confirmedBlockHash: "a".repeat(64),
        timestamp: "2026-07-23T13:00:00.000Z",
        balances: {
          usdtRaw: null,
          trxSun: null,
          source: "fixture",
          consistency: "unavailable"
        }
      } as const;
      const snapshotHash = fingerprintCanonicalArtifact(snapshot);
      const labelDataset = {
        version: "unified-label-dataset-v1",
        rows: []
      } as const;
      const versions = {
        labelDatasetSha256: fingerprintCanonicalArtifact(labelDataset),
        scoringPolicyVersion: "scoring-signal-matrix-v4",
        attributionPolicyVersion: "selected-attribution-policy-v1",
        traversalPolicyVersion: "snapshot-closure-v1" as const,
        runtimeCommit: "candidate",
        schemaVersion: 33
      };
      const manifest: AnalysisManifestV1 = {
        version: "analysis-manifest-v1",
        schemaVersion: 1,
        runId: "run-1",
        requestHash: "c".repeat(64),
        snapshotHash,
        chain: "tron",
        subjectAddress: SUBJECT,
        confirmedBlockNumber: "100",
        confirmedBlockHash: "a".repeat(64),
        confirmedBlockTimestamp: "2026-07-23T13:00:00.000Z",
        labelDatasetSha256: versions.labelDatasetSha256,
        scoringPolicyVersion: versions.scoringPolicyVersion,
        attributionPolicyVersion: versions.attributionPolicyVersion,
        traversalPolicyVersion: "snapshot-closure-v1",
        runtimeCommit: versions.runtimeCommit,
        databaseSchemaVersion: 33,
        paginationCutoffBlockNumber: "100",
        paginationCutoffBlockHash: "a".repeat(64),
        branchArtifactHashes: Object.fromEntries(
          (["fast", "where", "deep"] as const).map((branch) => [
            branch,
            fingerprintCanonicalArtifact(
              buildUnifiedBranchInput(branch, snapshotHash, versions)
            )
          ])
        ) as Record<"fast" | "where" | "deep", string>
      };
      const manifestHash = fingerprintCanonicalArtifact(manifest);
      const event: IndexedTronUsdtTransfer = {
        txHash: "d".repeat(64),
        blockNumber: 90,
        blockTimestamp: new Date("2026-07-23T12:00:00.000Z"),
        eventIndex: 0,
        fromAddress: SOURCE,
        toAddress: SUBJECT,
        amountRaw: "10000000",
        method: "transfer",
        callerAddress: null,
        contractRet: "SUCCESS",
        confirmed: true
      };
      const pageArtifact = {
        version: "unified-direct-history-page-v1",
        schemaVersion: 1,
        runId: "run-1",
        providerPageHash: "e".repeat(64),
        events: [{
          ...event,
          blockTimestamp: event.blockTimestamp.toISOString()
        }]
      } as const;
      const pageHash = fingerprintCanonicalArtifact(pageArtifact);
      const canonicalDirect = canonicalizeUnifiedDirectHistoryPages([
        pageArtifact
      ]);
      const historyArtifact = {
        version: "unified-direct-history-v1",
        schemaVersion: 1,
        runId: "run-1",
        analysisManifestHash: manifestHash,
        snapshotHash,
        pageArtifactHashes: [pageHash],
        eventIndexHash: canonicalDirect.eventIndexHash,
        eventCount: canonicalDirect.eventCount,
        reachedAccountCreation: true
      } as const;
      const historyHash = fingerprintCanonicalArtifact(historyArtifact);
      const traversalState: TraversalStateV1 = {
        address: SOURCE,
        direction: "backward",
        anchorTimestamp: event.blockTimestamp.toISOString(),
        fundingEpisodeId: canonicalTronUsdtEventKey(event),
        allocatedAmountRaw: event.amountRaw,
        sourceEventIds: [canonicalTronUsdtEventKey(event)]
      };
      const zeroCoverage = buildTraversalCoverage({
        selectedAmountRaw: "0",
        tracedAmountRaw: "0",
        identifiedAmountRaw: "0",
        unknownBoundaryRaw: "0"
      });
      const backwardCoverage = buildTraversalCoverage({
        selectedAmountRaw: event.amountRaw,
        tracedAmountRaw: event.amountRaw,
        identifiedAmountRaw: "0",
        unknownBoundaryRaw: event.amountRaw
      });
      const traversalArtifact: UnifiedTraversalArtifactV1 = {
        version: "unified-traversal-artifact-v1",
        schemaVersion: 1,
        runId: "run-1",
        analysisManifestHash: manifestHash,
        snapshotHash,
        visitedStates: [traversalState],
        frontier: [],
        terminalStates: [{
          stateId: traversalStateId(traversalState),
          address: SOURCE,
          direction: "backward",
          fundingEpisodeId: traversalState.fundingEpisodeId,
          anchorTimestamp: traversalState.anchorTimestamp,
          amountRaw: event.amountRaw,
          reason: "history_exhausted_to_account_creation",
          evidenceHash: fingerprintCanonicalArtifact([
            "terminal-evidence",
            traversalStateId(traversalState)
          ]),
          labels: [],
          sourceEventIds: traversalState.sourceEventIds
        }],
        supersededStateIds: [],
        eligibleEventIds: [],
        eligibleEventCount: 0,
        directionCount: 1,
        fundingEpisodeCount: 1,
        expandedStateCount: 0,
        allocatedInputRaw: event.amountRaw,
        terminalRaw: event.amountRaw,
        residualRaw: "0",
        backwardCoverage,
        forwardCoverage: zeroCoverage,
        closed: true
      };
      const traversalHash = fingerprintCanonicalArtifact(
        traversalArtifact
      );
      await query(
        `insert into unified_check_runs (
          id, analysis_key_sha256, subject_address, status, run_purpose,
          side_effect_policy, analysis_manifest_sha256
        ) values ('run-1',$1,$2,'RUNNING','user_check','authoritative',$3)`,
        ["1".repeat(64), SUBJECT, manifestHash]
      );
      await query(
        `insert into unified_label_datasets (sha256, dataset_json)
         values ($1,$2::jsonb)`,
        [
          versions.labelDatasetSha256,
          JSON.stringify(labelDataset)
        ]
      );
      await query(
        `insert into unified_check_requests (
          id, request_correlation_id, run_id, subject_address, chat_id,
          message_thread_id, locale, run_purpose, side_effect_policy, status,
          accepted_at
        ) values (
          'request-1','correlation-1','run-1',$1,'42','','ru',
          'user_check','authoritative','ATTACHED',now()
        )`,
        [SUBJECT]
      );
      const baseArtifacts = [
        [snapshotHash, "confirmed_snapshot", snapshot],
        [manifestHash, "analysis_manifest", manifest],
        [pageHash, "direct_history_page", pageArtifact],
        [historyHash, "direct_history", historyArtifact],
        [traversalHash, "traversal_result", traversalArtifact]
      ] as const;
      for (const [sha256, kind, artifact] of baseArtifacts) {
        await query(
          `insert into unified_check_artifacts (
            sha256, created_by_run_id, kind, schema_version, artifact_json
          ) values ($1,'run-1',$2,'1',$3::jsonb)`,
          [sha256, kind, JSON.stringify(artifact)]
        );
      }
      await query(
        `insert into unified_check_tasks (
          id, run_id, kind, status, priority_lane, attempt,
          accepted_attempt_id, logical_key
        ) values (
          'task-history','run-1','direct_history','COMPLETED',
          'interactive',1,null,'main'
        )`
      );
      await query(
        `insert into unified_check_attempts (
          id, task_id, attempt, artifact_sha256, completed_at
        ) values ('attempt-history','task-history',1,$1,now())`,
        [historyHash]
      );
      await query(
        `update unified_check_tasks
            set accepted_attempt_id = 'attempt-history'
          where id = 'task-history'`
      );
      await query(
        `insert into unified_check_tasks (
          id, run_id, kind, status, priority_lane, attempt,
          accepted_attempt_id, logical_key
        ) values (
          'task-traversal','run-1','traversal','COMPLETED',
          'interactive',1,null,'main'
        )`
      );
      await query(
        `insert into unified_check_attempts (
          id, task_id, attempt, artifact_sha256, completed_at
        ) values ('attempt-traversal','task-traversal',1,$1,now())`,
        [traversalHash]
      );
      await query(
        `update unified_check_tasks
            set accepted_attempt_id = 'attempt-traversal'
          where id = 'task-traversal'`
      );
      const context = {
        runId: "run-1",
        manifest,
        directHistoryArtifactSha256: historyHash,
        directEvents: [event],
        labelsDatasetSha256: manifest.labelDatasetSha256,
        deliveryAuthority: false as const
      };
      const runners = {
        fast: runUnifiedFastBranch,
        where: runUnifiedWhereBranch,
        deep: runUnifiedDeepBranch
      };
      for (const [index, branchId] of (
        ["fast", "where", "deep"] as const
      ).entries()) {
        const output = await runners[branchId]({
          context,
          analyze: async () => ({
            evidence: [],
            facts: [],
            patterns: [],
            boundaries: [],
            roles: [],
            candidates: []
          })
        });
        const outputHash = fingerprintCanonicalArtifact(output);
        const attempt: ChildAttemptArtifactV1 = {
          version: "child-attempt-artifact-v1",
          schemaVersion: 1,
          runId: "run-1",
          branchId,
          attemptId: `attempt-${branchId}`,
          previousAttemptHash: null,
          inputHash: manifest.branchArtifactHashes[branchId],
          outputHash,
          status: "COMPLETED",
          createdAt: `2026-07-23T13:01:0${index}.000Z`
        };
        const attemptHash = fingerprintCanonicalArtifact(attempt);
        for (const [hash, kind, artifact] of [
          [outputHash, `${branchId}_branch_output`, output],
          [attemptHash, "child_attempt", attempt]
        ] as const) {
          await query(
            `insert into unified_check_artifacts (
              sha256, created_by_run_id, kind, schema_version, artifact_json
            ) values ($1,'run-1',$2,'1',$3::jsonb)`,
            [hash, kind, JSON.stringify(artifact)]
          );
        }
        await query(
          `insert into unified_check_tasks (
            id, run_id, kind, status, priority_lane, attempt,
            accepted_attempt_id, logical_key
          ) values ($1,'run-1',$2,'COMPLETED','interactive',1,null,'main')`,
          [`task-${branchId}`, branchId]
        );
        await query(
          `insert into unified_check_attempts (
            id, task_id, attempt, artifact_sha256, completed_at
          ) values ($1,$2,1,$3,now())`,
          [`attempt-${branchId}`, `task-${branchId}`, attemptHash]
        );
        await query(
          `update unified_check_tasks set accepted_attempt_id = $2 where id = $1`,
          [`task-${branchId}`, `attempt-${branchId}`]
        );
      }

      await expect(runUnifiedProductionFinalizationCycle({
        db,
        runtimeCommit: "candidate",
        providerConfigurationSha256: "e".repeat(64),
        now: () => new Date("2026-07-23T13:02:00.000Z"),
        createId: () => "delivery-1"
      })).resolves.toEqual({ finalized: true, runId: "run-1" });
      const run = (
        await query("select * from unified_check_runs where id = 'run-1'")
      ).rows[0];
      expect(run).toMatchObject({
        status: "COMPLETED",
        final_score: 0,
        final_decision: "ACCEPTABLE"
      });
      const deliveries = (
        await query("select * from unified_check_deliveries")
      ).rows;
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]).toMatchObject({
        request_id: "request-1",
        status: "PENDING"
      });
    } finally {
      await client.query(`drop schema if exists "${schema}" cascade`);
      client.release();
      await pool.end();
    }
  });
});
