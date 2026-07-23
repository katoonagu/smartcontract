import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import pg from "pg";
import {
  fingerprintCanonicalArtifact,
  fingerprintCanonicalJson
} from "../../src/forensics/canonicalJson";
import { commitMinimalUnifiedCheck } from "../../src/unifiedCheck/durableCompletion";
import {
  completeMinimalUnifiedCheck,
  type MinimalBranchResult
} from "../../src/unifiedCheck/orchestrator";
import type {
  UnifiedQueryable,
  UnifiedTransactionalQueryable
} from "../../src/unifiedCheck/repository";
import {
  finalizeUnifiedRun,
  insertUnifiedArtifact
} from "../../src/unifiedCheck/repository";
import {
  buildUnifiedBranchInput,
  type AnalysisRunRecord
} from "../../src/unifiedCheck/requestService";

const connectionString = process.env.TEST_DATABASE_URL;
const postgresDescribe = connectionString ? describe : describe.skip;
const ADDRESS = "TBL7SHuSwpXnK6fWfwuRWrbpBjSqCQscQy";

postgresDescribe("Unified Check durable B0 vertical slice", () => {
  it("atomically persists the completed hash chain and creates no delivery", async () => {
    const pool = new pg.Pool({ connectionString, max: 1 });
    const client = await pool.connect();
    const schema = `unifiedslice_${randomUUID().replaceAll("-", "")}`;
    const queryable: UnifiedQueryable = {
      query: (sql, values) => client.query(sql, values as unknown[])
    };
    const db: UnifiedTransactionalQueryable = {
      ...queryable,
      async transaction<T>(work: (tx: UnifiedQueryable) => Promise<T>): Promise<T> {
        await client.query("begin");
        try {
          const result = await work(queryable);
          await client.query("commit");
          return result;
        } catch (error) {
          await client.query("rollback").catch(() => undefined);
          throw error;
        }
      }
    };
    try {
      await client.query(`create schema "${schema}"`);
      await client.query(`set search_path to "${schema}"`);
      await client.query(await readFile("migrations/033_unified_wallet_check.sql", "utf8"));
      const snapshot = {
        version: "confirmed-wallet-snapshot-v1",
        schemaVersion: 1,
        chain: "tron",
        subjectAddress: ADDRESS,
        confirmedBlockNumber: "84713573",
        confirmedBlockHash: "b".repeat(64),
        timestamp: "2026-07-23T12:53:54.000Z",
        balances: {
          usdtRaw: "0",
          trxSun: "0",
          source: "fixture",
          consistency: "exact"
        }
      } as const;
      const snapshotHash = fingerprintCanonicalJson(snapshot);
      const manifest = {
        version: "analysis-manifest-v1",
        schemaVersion: 1,
        runId: "run-1",
        requestHash: "d".repeat(64),
        snapshotHash,
        chain: "tron",
        subjectAddress: ADDRESS,
        confirmedBlockNumber: snapshot.confirmedBlockNumber,
        confirmedBlockHash: snapshot.confirmedBlockHash,
        confirmedBlockTimestamp: snapshot.timestamp,
        labelDatasetSha256: "c".repeat(64),
        scoringPolicyVersion: "scoring-signal-matrix-v4",
        attributionPolicyVersion: "selected-attribution-policy-v1",
        traversalPolicyVersion: "snapshot-closure-v1",
        runtimeCommit: "candidate",
        databaseSchemaVersion: 33,
        paginationCutoffBlockNumber: snapshot.confirmedBlockNumber,
        paginationCutoffBlockHash: snapshot.confirmedBlockHash,
        branchArtifactHashes: Object.fromEntries(
          (["fast", "deep", "where"] as const).map((branchId) => [
            branchId,
            fingerprintCanonicalArtifact(buildUnifiedBranchInput(
              branchId,
              snapshotHash,
              {
                labelDatasetSha256: "c".repeat(64),
                scoringPolicyVersion: "scoring-signal-matrix-v4",
                attributionPolicyVersion: "selected-attribution-policy-v1",
                runtimeCommit: "candidate",
                schemaVersion: 33
              }
            ))
          ])
        ) as Record<"fast" | "deep" | "where", string>
      } as const;
      const manifestHash = fingerprintCanonicalJson(manifest);
      const run: AnalysisRunRecord = {
        id: "run-1",
        analysisKeySha256: "a".repeat(64),
        subjectAddress: ADDRESS,
        runPurpose: "synthetic_test",
        sideEffectPolicy: "isolated",
        status: "RUNNING",
        snapshotHash,
        snapshot,
        analysisManifestSha256: manifestHash,
        analysisManifest: manifest
      };
      await client.query(
        `insert into unified_check_runs (
          id, analysis_key_sha256, subject_address, status, run_purpose,
          side_effect_policy, analysis_manifest_sha256
        ) values ($1,$2,$3,'RUNNING','synthetic_test','isolated',$4)`,
        [run.id, run.analysisKeySha256, run.subjectAddress, manifestHash]
      );
      await client.query(
        `insert into unified_check_artifacts
          (sha256, created_by_run_id, kind, schema_version, artifact_json)
         values
          ($1,$2,'confirmed_snapshot','1',$3::jsonb),
          ($4,$2,'analysis_manifest','1',$5::jsonb)`,
        [
          snapshotHash,
          run.id,
          JSON.stringify(snapshot),
          manifestHash,
          JSON.stringify(manifest)
        ]
      );
      const branches: MinimalBranchResult[] =
        (["fast", "deep", "where"] as const).map((branchId, index) => ({
          branchId,
          attemptId: `attempt-${branchId}`,
          inputHash: manifest.branchArtifactHashes[branchId],
          status: "COMPLETED",
          output: { version: `${branchId}-fixture-v1`, findings: [] },
          createdAt: `2026-07-23T13:00:0${index}.000Z`
        }));
      const completed = await completeMinimalUnifiedCheck({
        run,
        branches,
        commit: (candidate) => commitMinimalUnifiedCheck({
          db,
          run,
          branches,
          candidate
        })
      });
      const persistedRun = (
        await client.query("select * from unified_check_runs where id = $1", [run.id])
      ).rows[0];
      expect(persistedRun?.status).toBe("COMPLETED");
      expect(persistedRun?.report_sha256).toBe(completed.hashes.report);
      expect(
        (await client.query(
          "select count(*)::int as count from unified_check_tasks where run_id = $1 and accepted_attempt_id is not null",
          [run.id]
        )).rows[0]?.count
      ).toBe(3);
      expect(
        (await client.query("select count(*)::int as count from unified_check_deliveries"))
          .rows[0]?.count
      ).toBe(0);

      const mismatchedEvidence = {
        ...completed.evidence,
        analysisManifestHash: "f".repeat(64)
      };
      const mismatchedEvidenceHash =
        fingerprintCanonicalArtifact(mismatchedEvidence);
      await insertUnifiedArtifact(queryable, {
        sha256: mismatchedEvidenceHash,
        createdByRunId: run.id,
        kind: "evidence_bundle",
        schemaVersion: "1",
        artifact: mismatchedEvidence
      });
      await client.query(
        "update unified_check_runs set status = 'FINALIZING' where id = $1",
        [run.id]
      );
      await expect(finalizeUnifiedRun(db, {
        runId: run.id,
        finalScore: 0,
        finalDecision: "ACCEPTABLE",
        evidenceBundleSha256: mismatchedEvidenceHash,
        traversalClosureSha256: completed.hashes.closure,
        scoringBundleSha256: completed.hashes.scoring,
        reportSha256: completed.hashes.report
      })).rejects.toThrow("unified_final_artifact_chain_mismatch");

      const danglingScoring = {
        ...completed.scoring,
        scoreAnchorHash: "f".repeat(64)
      };
      const danglingScoringHash =
        fingerprintCanonicalArtifact(danglingScoring);
      const danglingReport = {
        ...completed.report,
        scoringBundleHash: danglingScoringHash
      };
      const danglingReportHash = fingerprintCanonicalArtifact(danglingReport);
      await insertUnifiedArtifact(queryable, {
        sha256: danglingScoringHash,
        createdByRunId: run.id,
        kind: "scoring_bundle",
        schemaVersion: "1",
        artifact: danglingScoring
      });
      await insertUnifiedArtifact(queryable, {
        sha256: danglingReportHash,
        createdByRunId: run.id,
        kind: "unified_wallet_report",
        schemaVersion: "1",
        artifact: danglingReport
      });
      await expect(finalizeUnifiedRun(db, {
        runId: run.id,
        finalScore: 0,
        finalDecision: "ACCEPTABLE",
        evidenceBundleSha256: completed.hashes.evidence,
        traversalClosureSha256: completed.hashes.closure,
        scoringBundleSha256: danglingScoringHash,
        reportSha256: danglingReportHash
      })).rejects.toThrow("unified_linked_artifact_missing:score_anchor");

      await client.query(
        `update unified_check_tasks
            set status = 'CANCELLED', accepted_attempt_id = null
          where run_id = $1 and kind = 'where'`,
        [run.id]
      );
      await expect(finalizeUnifiedRun(db, {
        runId: run.id,
        finalScore: 0,
        finalDecision: "ACCEPTABLE",
        evidenceBundleSha256: completed.hashes.evidence,
        traversalClosureSha256: completed.hashes.closure,
        scoringBundleSha256: completed.hashes.scoring,
        reportSha256: completed.hashes.report
      })).rejects.toThrow(/unified_final_(accepted_attempt_mismatch|tasks_not_finalized)/u);
    } finally {
      await client.query("reset search_path");
      await client.query(`drop schema if exists "${schema}" cascade`);
      client.release();
      await pool.end();
    }
  });
});
