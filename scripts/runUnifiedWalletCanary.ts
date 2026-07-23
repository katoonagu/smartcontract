import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { resolve } from "node:path";
import { loadConfig } from "../src/config";
import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../src/forensics/canonicalJson";
import { SCORING_POLICY_V4 } from "../src/risk/scoringPolicyV4.generated";
import { closeDb, createDb } from "../src/storage/db";
import {
  checksumMigrationBytes,
  REQUIRED_SCHEMA_FILENAME,
  SCHEMA_032_FILENAME,
  verifyRequiredSchema033
} from "../src/storage/schemaMigrations";
import {
  buildUnifiedCanaryProviderConfiguration,
  buildUnifiedCanarySelection,
  parseUnifiedCanaryCli,
  prepareUnifiedCanaryBatch,
  runUnifiedCanaryHarness,
  verifyUnifiedCanaryDiagnosticHypothesis
} from "../src/unifiedCheck/canary";
import {
  buildPresentationManifest,
  renderUnifiedWalletPresentation
} from "../src/unifiedCheck/presentation";
import {
  auditUnifiedCanaryIsolation,
  createUnifiedCanaryBatch,
  createUnifiedPoolTransactionHost,
  insertUnifiedArtifact,
  listUnifiedWatchdogRuns,
  loadUnifiedCanaryBatchByIdentity,
  loadUnifiedCanarySelectionRows,
  persistUnifiedCanaryBlocker,
  reconcileUnifiedCanaryCancelledLeases,
  reconcileUnifiedCanaryTechnicalFailures
} from "../src/unifiedCheck/repository";
import type { UnifiedWalletDossierV1 } from "../src/unifiedCheck/report";
import { getActiveCheckGeneration } from "../src/unifiedCheck/rolloutFence";
import { SELECTED_ATTRIBUTION_POLICY } from "../src/unifiedCheck/selectedAttributionPolicy.generated";
import { createTronConfirmedSnapshotSource } from "../src/unifiedCheck/snapshot";
import type { UnifiedWatchdogRunV1 } from "../src/unifiedCheck/watchdog";

async function writeImmutable(path: string, content: string): Promise<void> {
  try {
    await writeFile(path, content, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (await readFile(path, "utf8") !== content) {
      throw new Error(`unified_canary_output_mismatch:${path}`);
    }
  }
}

async function main(): Promise<void> {
  const options = parseUnifiedCanaryCli(process.argv.slice(2), new Date());
  const outputDirectory = resolve(options.outputDirectory);
  const diagnosticHypothesis = options.diagnosticHypothesisPath === null
    ? null
    : verifyUnifiedCanaryDiagnosticHypothesis(JSON.parse(
      await readFile(resolve(options.diagnosticHypothesisPath), "utf8")
    ));
  const config = loadConfig();
  const providerConfiguration =
    buildUnifiedCanaryProviderConfiguration({
      tronscanBaseUrl: config.tronscanBaseUrl,
      tronFullNodeBaseUrl: config.tronFullNodeBaseUrl,
      timeoutMs: config.tronscanTimeoutMs,
      retryAttempts: config.tronscanRetryAttempts,
      retryBaseDelayMs: config.tronscanRetryBaseDelayMs,
      rateLimitCooldownMs: config.tronscanRateLimitCooldownMs,
      maxInFlight: config.tronscanMaxInFlight ?? 20,
      maxInFlightPerGroup: config.tronscanGroupMaxInFlight ?? 2,
      requestMinIntervalMs: config.tronscanRequestMinIntervalMs,
      globalRequestMinIntervalMs:
        config.tronscanGlobalRequestMinIntervalMs,
      transferRequestMinIntervalMs:
        config.tronscanTransferRequestMinIntervalMs,
      approvalRequestMinIntervalMs:
        config.tronscanApprovalRequestMinIntervalMs,
      contractRequestMinIntervalMs:
        config.tronscanContractRequestMinIntervalMs,
      fullNodeRequestMinIntervalMs:
        config.tronscanFullNodeRequestMinIntervalMs,
      tronGridRequestMinIntervalMs: config.tronGridRequestMinIntervalMs,
      accountGroupRequestMinIntervalMs:
        config.tronscanAccountGroupRequestMinIntervalMs,
      tronscanKeyCount: config.tronscanApiKeys.length,
      fullNodeKeyConfigured: Boolean(config.tronFullNodeApiKey),
      groups: config.tronscanApiKeyGroups.map((group) => ({
        groupId: group.groupId,
        keyCount: group.apiKeys.length
      }))
    });
  if (!config.runtimeGitSha) {
    throw new Error("unified_canary_runtime_git_sha_required");
  }
  if (config.runtimeGitSha.toLowerCase() !== options.candidateCommit) {
    throw new Error("unified_canary_candidate_runtime_mismatch");
  }
  const commandStartedAt = Date.now();
  process.stderr.write(`${JSON.stringify({
    event: "unified_canary_started",
    candidateCommit: options.candidateCommit,
    expectedWallets: 8,
    perWalletDeadlineMinutes: 35,
    resume: options.resumeBatchIdentitySha256 !== null
  })}\n`);
  const db = createDb(config.databaseUrl);
  const transactionHost = createUnifiedPoolTransactionHost(db);
  try {
    const schema032Bytes = await readFile(
      new URL(`../migrations/${SCHEMA_032_FILENAME}`, import.meta.url)
    );
    const schema033Bytes = await readFile(
      new URL(`../migrations/${REQUIRED_SCHEMA_FILENAME}`, import.meta.url)
    );
    const schemaVerification = await verifyRequiredSchema033(
      db,
      await checksumMigrationBytes(schema033Bytes),
      await checksumMigrationBytes(schema032Bytes)
    );
    const activeGeneration = await getActiveCheckGeneration(db);
    if (
      activeGeneration.deliveryGeneration !== "unified" ||
      activeGeneration.runtimeCommit.toLowerCase() !== options.candidateCommit
    ) {
      throw new Error("unified_canary_active_generation_mismatch");
    }
    const canary = options.resumeBatchIdentitySha256 === null
      ? await (async () => {
          const rows = await loadUnifiedCanarySelectionRows(db, {
            cutoffAt: options.cutoffAt
          });
          const selectionManifest = buildUnifiedCanarySelection({
            rows,
            cutoffAt: options.cutoffAt,
            candidateCommit: options.candidateCommit,
            activeGeneration: {
              generationId: activeGeneration.generationId,
              activatedAt: activeGeneration.activatedAt,
              runtimeCommit: options.candidateCommit
            },
            databaseSchema: schemaVerification
          });
          const labelRows = (
            await db.query(
              `select address, label, label as category, source as provider,
                      created_at as observed_at
                 from address_labels
                union all
               select address, label, category, provider, updated_at as observed_at
                 from address_labels_cache
                where chain = 'tron'
                order by address, category, label, provider, observed_at`
            )
          ).rows.map((row) => ({
            address: String(row.address),
            label: String(row.label),
            category: String(row.category),
            provider: String(row.provider),
            observedAt: new Date(String(row.observed_at)).toISOString()
          }));
          const labelDataset = {
            version: "unified-label-dataset-v1" as const,
            rows: labelRows
          };
          const labelDatasetSha256 =
            fingerprintCanonicalArtifact(labelDataset);
          await db.query(
            `insert into unified_label_datasets (sha256, dataset_json)
             values ($1,$2::jsonb)
             on conflict (sha256) do nothing`,
            [labelDatasetSha256, JSON.stringify(labelDataset)]
          );
          const prepared = await prepareUnifiedCanaryBatch({
            selectionManifest,
            snapshotSource: createTronConfirmedSnapshotSource({
              fullNodeBaseUrl: config.tronFullNodeBaseUrl,
              fullNodeApiKey: config.tronFullNodeApiKey,
              timeoutMs: config.tronscanTimeoutMs
            }),
            versions: {
              labelDatasetSha256,
              scoringPolicyVersion: SCORING_POLICY_V4.version,
              attributionPolicyVersion: SELECTED_ATTRIBUTION_POLICY.version,
              runtimeCommit: options.candidateCommit,
              schemaVersion: schemaVerification.version
            },
            diagnosticHypothesis,
            providerConfiguration,
            repository: {
              createBatch: (input) =>
                createUnifiedCanaryBatch(transactionHost, input)
            },
            createId: randomUUID
          });
          return {
            ...prepared,
            selectionManifest,
            runs: selectionManifest.selected.map((item, index) => ({
              ...prepared.runs[index]!,
              subjectAddress: item.subjectAddress,
              locale: item.locale
            }))
          };
        })()
      : await loadUnifiedCanaryBatchByIdentity(db, {
          batchIdentitySha256: options.resumeBatchIdentitySha256
        });
    if (
      canary.batchIdentity.candidateCommit !== options.candidateCommit ||
      canary.batchIdentity.databaseSchemaVersion !==
        schemaVerification.version ||
      canary.selectionManifest.source.activeGenerationId !==
        activeGeneration.generationId ||
      canary.batchIdentity.providerConfiguration.sha256 !==
        providerConfiguration.sha256 ||
      (
        diagnosticHypothesis !== null &&
        canary.batchIdentity.diagnosticHypothesis?.sha256 !==
          diagnosticHypothesis.sha256
      )
    ) {
      throw new Error("unified_canary_resume_provenance_mismatch");
    }
    process.stderr.write(`${JSON.stringify({
      event: "unified_canary_batch_ready",
      batchIdentitySha256: canary.batchIdentitySha256,
      selectionManifestSha256: canary.selectionManifestSha256,
      wallets: canary.runs.length
    })}\n`);
    let lastProgressAt = 0;
    let lastProgressSignature = "";
    const inspectWithProgress = async (): Promise<
      readonly UnifiedWatchdogRunV1[]
    > => {
      const runs = await listUnifiedWatchdogRuns(db, {
        limit: 8,
        runIds: canary.runs.map((run) => run.id)
      });
      const statusCounts = Object.fromEntries(
        [...new Set(runs.map((run) => run.status))].sort().map((status) => [
          status,
          runs.filter((run) => run.status === status).length
        ])
      );
      const taskStatusCounts = Object.fromEntries(
        [...new Set(runs.flatMap((run) =>
          run.tasks.map((task) => task.status)
        ))].sort().map((status) => [
          status,
          runs.flatMap((run) => run.tasks)
            .filter((task) => task.status === status).length
        ])
      );
      const phases = runs
        .filter((run) =>
          run.status !== "COMPLETED" &&
          run.status !== "FAILED_TECHNICAL"
        )
        .map((run) => ({
          runId: run.id,
          status: run.status,
          tasks: run.tasks
            .filter((task) => task.status !== "COMPLETED")
            .map((task) => `${task.kind}:${task.status}`)
        }));
      const signature = canonicalizeArtifactJson({
        statusCounts,
        taskStatusCounts,
        phases
      });
      const observedAt = Date.now();
      if (
        signature !== lastProgressSignature ||
        observedAt - lastProgressAt >= 30_000
      ) {
        process.stderr.write(`${JSON.stringify({
          event: "unified_canary_progress",
          elapsedSeconds: Math.floor(
            (observedAt - commandStartedAt) / 1_000
          ),
          statusCounts,
          taskStatusCounts,
          phases
        })}\n`);
        lastProgressAt = observedAt;
        lastProgressSignature = signature;
      }
      return runs;
    };
    const report = await runUnifiedCanaryHarness({
      runs: canary.runs,
      candidateCommit: options.candidateCommit,
      selectionManifestSha256: canary.selectionManifestSha256,
      batchIdentitySha256: canary.batchIdentitySha256,
      activeGeneration: {
        generationId: activeGeneration.generationId,
        activatedAt: activeGeneration.activatedAt
      },
      now: () => new Date(),
      inspect: inspectWithProgress,
      async advance() {
        await reconcileUnifiedCanaryTechnicalFailures(transactionHost);
        await reconcileUnifiedCanaryCancelledLeases(db);
        await delay(1_000);
      },
      persistBlocker: (value) =>
        persistUnifiedCanaryBlocker(transactionHost, value),
      isolationAudit: () => auditUnifiedCanaryIsolation(db, {
        runIds: canary.runs.map((run) => run.id)
      }),
      async loadCompletedPresentation({ runId, locale }) {
        const run = (
          await db.query(
            "select report_sha256 from unified_check_runs where id = $1",
            [runId]
          )
        ).rows[0];
        const reportRow = run && (
          await db.query(
            `select artifact_json from unified_check_artifacts
              where sha256 = $1 and kind = 'unified_wallet_report'`,
            [run.report_sha256]
          )
        ).rows[0];
        if (!reportRow) throw new Error("unified_canary_report_missing");
        const dossier = reportRow.artifact_json as UnifiedWalletDossierV1;
        const presentation = renderUnifiedWalletPresentation({
          report: dossier,
          manifest: buildPresentationManifest(dossier, locale)
        });
        const envelope = {
          version: "unified-canary-presentation-v1" as const,
          runId,
          presentation
        };
        await insertUnifiedArtifact(db, {
          sha256: fingerprintCanonicalArtifact(envelope),
          createdByRunId: runId,
          kind: "canary_presentation",
          schemaVersion: "1",
          artifact: envelope
        });
        const scoreDrivers = dossier.sections.find(
          (section) => section.kind === "score_drivers"
        );
        return {
          html: presentation.artifact.html,
          htmlHash: presentation.artifact.htmlHash,
          evidenceAggregates: dossier.sections.filter((section) => [
            "score_drivers",
            "balance_formation",
            "outgoing_movement",
            "services_boundaries",
            "contracts_approvals",
            "behavior_connections"
          ].includes(section.kind)),
          scoreReasons: scoreDrivers?.rows.map((row) => row.code) ?? []
        };
      }
    });
    const reportSha256 = fingerprintCanonicalArtifact(report);
    await insertUnifiedArtifact(db, {
      sha256: reportSha256,
      createdByRunId: canary.runs[0]!.id,
      kind: "canary_batch_report",
      schemaVersion: "1",
      artifact: report
    });
    await mkdir(outputDirectory, { recursive: true });
    await writeImmutable(
      resolve(outputDirectory, "selection-manifest.json"),
      `${canonicalizeArtifactJson(canary.selectionManifest)}\n`
    );
    await writeImmutable(
      resolve(outputDirectory, "batch-identity.json"),
      `${canonicalizeArtifactJson(canary.batchIdentity)}\n`
    );
    await writeImmutable(
      resolve(outputDirectory, "batch-report.json"),
      `${canonicalizeArtifactJson({
        reportSha256,
        report
      })}\n`
    );
    process.stdout.write(`${JSON.stringify({
      selectionManifestSha256: canary.selectionManifestSha256,
      batchIdentitySha256: canary.batchIdentitySha256,
      reportSha256,
      candidateCommit: options.candidateCommit,
      outputDirectory,
      outcomes: report.results.map((item) => ({
        address: item.subjectAddress,
        outcome: item.outcome
      }))
    })}\n`);
  } finally {
    await closeDb(db);
  }
}

await main();
