import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config";
import {
  canonicalizeArtifactJson,
  fingerprintCanonicalArtifact
} from "../src/forensics/canonicalJson";
import { SCORING_POLICY_V4 } from "../src/risk/scoringPolicyV4.generated";
import { closeDb, createDb } from "../src/storage/db";
import {
  checksumMigrationBytes,
  SCHEMA_032_FILENAME,
  SCHEMA_033_FILENAME,
  SCHEMA_034_FILENAME,
  SCHEMA_035_FILENAME,
  SCHEMA_036_FILENAME,
  verifyRequiredSchema036
} from "../src/storage/schemaMigrations";
import {
  buildUnifiedAdaptiveBenchmarkSelection,
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
import { SELECTED_ATTRIBUTION_POLICY } from "../src/unifiedCheck/selectedAttributionPolicy.generated";
import { createTronConfirmedSnapshotSource } from "../src/unifiedCheck/snapshot";
import type { UnifiedWatchdogRunV1 } from "../src/unifiedCheck/watchdog";
import {
  captureUnifiedAdaptiveBenchmarkObservationBestEffort,
  listUnifiedAdaptiveBenchmarkObservationArtifacts,
  listUnifiedAdaptiveBenchmarkScenarioSymptoms,
  type UnifiedAdaptiveBenchmarkRuntimeObservationArtifactV1,
  type UnifiedAdaptiveBenchmarkScenarioSymptomArtifactV1
} from "../src/unifiedCheck/adaptiveBenchmarkControl";

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

export async function runUnifiedWalletCanaryCli(
  args: readonly string[],
  runtime: {
    readonly emitResult?: boolean;
    readonly explicitBenchmarkScenarios?: readonly {
      readonly scenarioId: string;
      readonly subjectAddress: string;
      readonly locale: "ru" | "en";
    }[];
    readonly beforeBatchCreate?: (input: {
      readonly db: ReturnType<typeof createDb>;
      readonly providerConfigurationSha256: string;
    }) => Promise<void>;
    readonly onBatchReady?: (input: {
      readonly db: ReturnType<typeof createDb>;
      readonly runIds: readonly string[];
      readonly batchIdentitySha256: string;
      readonly selectionManifestSha256: string;
      readonly providerConfigurationSha256: string;
    }) => Promise<{
      readonly benchmarkControlSha256: string;
      release(): Promise<void>;
    }>;
    readonly onProgress?: (input: {
      readonly db: ReturnType<typeof createDb>;
      readonly runs: readonly UnifiedWatchdogRunV1[];
      readonly batchIdentitySha256: string;
      readonly benchmarkControlSha256: string | null;
    }) => Promise<void>;
  } = {}
): Promise<{
  readonly selectionManifestSha256: string;
  readonly batchIdentitySha256: string;
  readonly reportSha256: string;
  readonly candidateCommit: string;
  readonly outputDirectory: string;
  readonly benchmarkObservationArtifacts:
    readonly UnifiedAdaptiveBenchmarkRuntimeObservationArtifactV1[];
  readonly benchmarkScenarioSymptoms:
    readonly UnifiedAdaptiveBenchmarkScenarioSymptomArtifactV1[];
  readonly outcomes: readonly {
    readonly address: string;
    readonly outcome: string;
    readonly runId: string;
    readonly score: number | null;
    readonly decision: "ACCEPTABLE" | "REVIEW" | "DECLINE" | null;
    readonly evidenceBundleSha256: string | null;
    readonly traversalClosureSha256: string | null;
    readonly scoringBundleSha256: string | null;
    readonly reportSha256: string | null;
    readonly snapshot: {
      readonly blockNumber: string;
      readonly blockHash: string;
      readonly timestamp: string;
    };
    readonly labelDatasetSha256: string;
    readonly providerConfigurationSha256: string;
  }[];
  readonly report: import("../src/unifiedCheck/canary")
    .UnifiedCanaryBatchReportV1;
}> {
  const options = parseUnifiedCanaryCli(args, new Date());
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
    expectedWallets: runtime.explicitBenchmarkScenarios?.length ?? 8,
    perWalletDeadlineMinutes: 35,
    resume: options.resumeBatchIdentitySha256 !== null
  })}\n`);
  const db = createDb(config.databaseUrl);
  const transactionHost = createUnifiedPoolTransactionHost(db);
  let releaseBenchmarkControl: (() => Promise<void>) | null = null;
  let benchmarkControlSha256: string | null = null;
  try {
    const schema032Bytes = await readFile(
      new URL(`../migrations/${SCHEMA_032_FILENAME}`, import.meta.url)
    );
    const schema033Bytes = await readFile(
      new URL(`../migrations/${SCHEMA_033_FILENAME}`, import.meta.url)
    );
    const schema034Bytes = await readFile(
      new URL(`../migrations/${SCHEMA_034_FILENAME}`, import.meta.url)
    );
    const schema035Bytes = await readFile(
      new URL(`../migrations/${SCHEMA_035_FILENAME}`, import.meta.url)
    );
    const schema036Bytes = await readFile(
      new URL(`../migrations/${SCHEMA_036_FILENAME}`, import.meta.url)
    );
    const schemaVerification = await verifyRequiredSchema036(
      db,
      await checksumMigrationBytes(schema036Bytes),
      await checksumMigrationBytes(schema032Bytes),
      await checksumMigrationBytes(schema033Bytes),
      await checksumMigrationBytes(schema034Bytes),
      await checksumMigrationBytes(schema035Bytes)
    );
    const canary = options.resumeBatchIdentitySha256 === null
      ? await (async () => {
          const commonSelection = {
            cutoffAt: options.cutoffAt,
            candidateCommit: options.candidateCommit,
            databaseSchema: schemaVerification
          };
          const selectionManifest =
            runtime.explicitBenchmarkScenarios === undefined
              ? buildUnifiedCanarySelection({
                  rows: await loadUnifiedCanarySelectionRows(db, {
                    cutoffAt: options.cutoffAt
                  }),
                  ...commonSelection
                })
              : buildUnifiedAdaptiveBenchmarkSelection({
                  scenarios: runtime.explicitBenchmarkScenarios,
                  ...commonSelection
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
          await runtime.beforeBatchCreate?.({
            db,
            providerConfigurationSha256: providerConfiguration.sha256
          });
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
            rolloutPolicy: {
              stage: config.unifiedRollingRolloutStage,
              boundedUserCheckBasisPoints:
                config.unifiedRollingUserCheckBasisPoints,
              providerCapacityCeiling:
                config.unifiedProviderCapacityCeiling
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
    if (runtime.onBatchReady) {
      const benchmarkControl = await runtime.onBatchReady({
        db,
        runIds: canary.runs.map((run) => run.id),
        batchIdentitySha256: canary.batchIdentitySha256,
        selectionManifestSha256: canary.selectionManifestSha256,
        providerConfigurationSha256: providerConfiguration.sha256
      });
      benchmarkControlSha256 =
        benchmarkControl.benchmarkControlSha256;
      releaseBenchmarkControl = benchmarkControl.release;
    }
    let lastProgressAt = 0;
    let lastProgressSignature = "";
    const inspectWithProgress = async (): Promise<
      readonly UnifiedWatchdogRunV1[]
    > => {
      const runs = await listUnifiedWatchdogRuns(db, {
        limit: canary.runs.length,
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
      await runtime.onProgress?.({
        db,
        runs,
        batchIdentitySha256: canary.batchIdentitySha256,
        benchmarkControlSha256
      });
      return runs;
    };
    const report = await runUnifiedCanaryHarness({
      runs: canary.runs,
      candidateCommit: options.candidateCommit,
      selectionManifestSha256: canary.selectionManifestSha256,
      batchIdentitySha256: canary.batchIdentitySha256,
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
      },
      expectedRunCount: canary.runs.length
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
    const outputBindings = new Map((await db.query(
      `select run.id, run.evidence_bundle_sha256,
              run.traversal_closure_sha256,
              run.scoring_bundle_sha256, run.report_sha256,
              manifest.artifact_json as analysis_manifest
         from unified_check_runs run
         join unified_check_artifacts manifest
           on manifest.sha256 = run.analysis_manifest_sha256
          and manifest.kind = 'analysis_manifest'
        where run.id = any($1::text[])`,
      [canary.runs.map((run) => run.id)]
    )).rows.map((row) => [String(row.id), row]));
    const observationControlSha256 = benchmarkControlSha256;
    const benchmarkObservationArtifacts = observationControlSha256 === null
      ? []
      : (await captureUnifiedAdaptiveBenchmarkObservationBestEffort({
          capture: () => listUnifiedAdaptiveBenchmarkObservationArtifacts({
            db,
            controlSha256: observationControlSha256,
            runIds: canary.runs.map((run) => run.id)
          }),
          onError(error) {
            process.stderr.write(`${JSON.stringify({
              event: "unified_canary_benchmark_observation_export_failed",
              error: error instanceof Error ? error.message : String(error)
            })}\n`);
          }
        })) ?? [];
    const benchmarkScenarioSymptoms = observationControlSha256 === null
      ? []
      : (await captureUnifiedAdaptiveBenchmarkObservationBestEffort({
          capture: () => listUnifiedAdaptiveBenchmarkScenarioSymptoms({
            db,
            controlSha256: observationControlSha256,
            runIds: canary.runs.map((run) => run.id)
          }),
          onError(error) {
            process.stderr.write(`${JSON.stringify({
              event: "unified_canary_benchmark_symptom_export_failed",
              error: error instanceof Error ? error.message : String(error)
            })}\n`);
          }
        })) ?? [];
    const result = {
      selectionManifestSha256: canary.selectionManifestSha256,
      batchIdentitySha256: canary.batchIdentitySha256,
      reportSha256,
      candidateCommit: options.candidateCommit,
      outputDirectory,
      benchmarkObservationArtifacts,
      benchmarkScenarioSymptoms,
      outcomes: report.results.map((item) => ({
        address: item.subjectAddress,
        outcome: item.outcome,
        runId: item.runId,
        score: item.score,
        decision: item.decision,
        evidenceBundleSha256:
          outputBindings.get(item.runId)?.evidence_bundle_sha256 ?? null,
        traversalClosureSha256:
          outputBindings.get(item.runId)?.traversal_closure_sha256 ?? null,
        scoringBundleSha256:
          outputBindings.get(item.runId)?.scoring_bundle_sha256 ?? null,
        reportSha256:
          outputBindings.get(item.runId)?.report_sha256 ?? null,
        snapshot: {
          blockNumber: String(
            outputBindings.get(item.runId)?.analysis_manifest
              ?.confirmedBlockNumber
          ),
          blockHash: String(
            outputBindings.get(item.runId)?.analysis_manifest
              ?.confirmedBlockHash
          ),
          timestamp: String(
            outputBindings.get(item.runId)?.analysis_manifest
              ?.confirmedBlockTimestamp
          )
        },
        labelDatasetSha256: String(
          outputBindings.get(item.runId)?.analysis_manifest
            ?.labelDatasetSha256
        ),
        providerConfigurationSha256: providerConfiguration.sha256
      }))
    };
    if (runtime.emitResult !== false) {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    }
    return {
      ...result,
      report
    };
  } finally {
    try {
      await releaseBenchmarkControl?.();
    } finally {
      await closeDb(db);
    }
  }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  await runUnifiedWalletCanaryCli(process.argv.slice(2));
}
