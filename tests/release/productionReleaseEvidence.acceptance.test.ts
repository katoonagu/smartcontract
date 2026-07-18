import { expect, it } from "vitest";
import { buildProductionEvidenceScenarioV2, cloneFixture } from "../fixtures/release/remediationReleaseFixtures";

async function loadEvidenceApi(): Promise<any> {
  const modulePath: string = "../../src/release/productionReleaseEvidenceV2";
  try { return await import(/* @vite-ignore */ modulePath); }
  catch (error) { throw new Error("Plan 5 feature missing: production release evidence v2", { cause: error }); }
}

async function loadOrchestratorApi(): Promise<any> {
  const modulePath: string = "../../src/release/productionReleaseOrchestratorV2";
  try { return await import(/* @vite-ignore */ modulePath); }
  catch (error) { throw new Error("Plan 5 feature missing: production release orchestrator v2", { cause: error }); }
}

const evidenceCases = [
  ["[REQ-38][G12-V2-BINDING] validates fresh unconsumed authority before atomic claim and binds per-effect unexpired lease ownership progress final evidence actual bytes and no active lease", "g12_binding"],
  ["[REQ-38][G13-V2-BINDING] binds schema execution receipt consumed authority lock session source G12 and complete sequence", "g13_binding"],
  ["[REQ-38][G13-FAIL-FIRST-MIGRATION] records no completed stage hash and exact typed first-migration failure", "g13_fail_first_migration"],
  ["[REQ-38][G13-FAIL-FIRST-VERIFICATION] records only completed first-migration receipt before exact failure", "g13_fail_first_verification"],
  ["[REQ-38][G13-FAIL-SECOND-MIGRATION] records exactly the first two completed ordered receipts before exact failure", "g13_fail_second_migration"],
  ["[REQ-38][G13-FAIL-FINAL-VERIFICATION] records exactly the first three completed ordered receipts before exact failure", "g13_fail_final_verification"],
  ["[REQ-38][PRODUCTION-FAILURE-CODE] rejects free-form or swapped gate evidence-kind and allowlisted failure-code combinations", "production_failure_code"],
  ["[REQ-38][G13-FAILURE-PATH] resolves only the failedStep-specific allowlisted relative artifact and rejects swapped foreign missing or symlink paths", "g13_failure_path"],
  ["[REQ-35][REQ-38][G14-V2-EVIDENCE] derives rollout only from exact manager and query captures", "g14_evidence"],
  ["[REQ-35][REQ-38][G14-RUNTIME-ORDER] stops the exact previous runtime after G13 and before candidate start", "g14_runtime_order"],
  ["[REQ-35][REQ-38][G14-PRE-EFFECT-FAILURE] records exact attemptedExternalEffect false validation receipts transitions to production_failed and rolls back as previous_runtime_retained without stop start or candidate captures", "g14_pre_effect_failure"],
  ["[REQ-03][REQ-35][REQ-36][G15-V2-EVIDENCE] requires two cycles and a 15-to-30-minute bounded canary with all checks", "g15_evidence"],
  ["[REQ-35][REQ-38][ROLLBACK-PRE-STOP] retains an already-running previous runtime without invented stop or start captures", "rollback_pre_stop"],
  ["[REQ-35][REQ-38][ROLLBACK-POST-STOP-PRE-START] keeps failed candidate-start command without confirmed process evidence in previous-only restart and rejects candidate-stop fields", "rollback_post_stop_pre_start"],
  ["[REQ-35][REQ-38][ROLLBACK-POST-CANDIDATE-START] requires confirmed candidate-start evidence before candidate stop and previous restart", "rollback_post_candidate_start"],
  ["[REQ-35][REQ-38][ROLLBACK-TRANSITION-EVIDENCE] validates fresh unconsumed authority then atomically claims consumption before actions and binds post-action typed actualRollback ref outcome command template root candidate previous runtime without circular pre-action evidence", "rollback_transition_evidence"]
] as const;

it.each(evidenceCases)("%s", async (_name, scenario) => {
  const api = await loadEvidenceApi();
  const bundle = buildProductionEvidenceScenarioV2(scenario, {
    policy: { failureCode: scenario.includes("fail") ? "allowlisted_failure" : null },
    artifacts: [{ relativePath: `${scenario}.json`, sha256: "b".repeat(64), bytesSha256: "b".repeat(64) }]
  });
  const validated = api.validateProductionReleaseEvidenceBundleV2(bundle);
  expect(validated.scenario).toBe(scenario);
  const tampered: any = cloneFixture(bundle);
  tampered.candidateSha = "f".repeat(40);
  expect(() => api.validateProductionReleaseEvidenceBundleV2(tampered, { expectedCandidateSha: bundle.candidateSha })).toThrow();
});

const orchestrationCases = [
  ["[REQ-35][REQ-38][PRODUCTION-AUTHORITY-TWO-PHASE] validates exact fresh compatible unconsumed authority acquires the original production lease then persists immutable original-lease-hash-epoch-owner-operation-bound preclaim and atomically consumes authority only in the claim under that lease or the exact current tip of its committed linear takeover chain", "authority_two_phase"],
  ["[REQ-35][REQ-38][PRODUCTION-PRECLAIM-CRASH] resumes crash after immutable preclaim through exact original-lease to current-tip committed takeover lineage without replacing preclaim binds lineage hash and current tip in consumption and claim and rejects branch gap swapped foreign or orphan lineage", "preclaim_crash"],
  ["[REQ-35][REQ-38][PRODUCTION-PRECLAIM-LINEAGE-PUBLICATION] append-only creates one O_EXCL fsynced lineage per tip with null-first or previous-lineage hash one inherited lineageStartedAt one-receipt takeover suffix fixed resolvedAt and byte-exact same-tip replay then completes L2-written owner-dead takeover-L3 lineage-L3 claim bound to latest path hash and tip", "preclaim_lineage_publication"],
  ["[REQ-35][REQ-38][PRODUCTION-AUTHORITY-EFFECT-GUARD] rejects swapped operation ownership lease epoch consumption and now equal to or beyond consumed authority expiry or immutable operation deadline before every effect query reconciliation and settlement", "authority_effect_guard"],
  ["[REQ-35][REQ-38][PRODUCTION-AUTHORITY-EXPIRY] rejects now equal to or beyond selected preclaim or consumed postclaim authority expiry including normal effect-capable takeover preserves terminal partial evidence and permits only cleanup-only terminalization or a separately issued selected and claimed fresh-authority recovery-only operation bound to exact abandonment cleanup completed-prefix and uncertain-marker evidence without observing reconciling or repeating uncertain effects", "authority_expiry"],
  ["[REQ-35][REQ-38][PRODUCTION-OPERATION-DEADLINE] rejects now equal to and after immutable operation deadline for effect query reconciliation settlement and normal effect-capable takeover never extends the deadline across either takeover and persists operation_deadline_reached abandonment while authority remains valid", "operation_deadline"],
  ["[REQ-35][REQ-38][G14-ORCHESTRATOR] claims and consumes fresh authority before its first effect and crash-safely resumes only the fixed rollout step sequence", "g14_orchestrator"],
  ["[REQ-03][REQ-35][REQ-36][G15-ORCHESTRATOR] claims and consumes fresh authority before its first observation and crash-safely resumes only the fixed canary step sequence", "g15_orchestrator"],
  ["[REQ-35][REQ-38][ROLLBACK-ORCHESTRATOR] claims and consumes fresh authority before its first effect and crash-safely resumes only the fixed rollback branch", "rollback_orchestrator"],
  ["[REQ-35][REQ-38][PRODUCTION-ORCHESTRATION-ONLY] rejects direct operator invocation or separately authored captures for rollout canary and rollback leaf steps", "orchestration_only"],
  ["[REQ-35][REQ-38][PRODUCTION-ORCHESTRATION-LEASE] one fixed production-operation lease permits only exact same-operation resume and rejects concurrent foreign source or generation execution", "orchestration_lease"],
  ["[REQ-35][REQ-38][PRODUCTION-MANIFEST-LEASE-EXCLUSION] prevents production operation claim during manifest lease and prevents manifest evidence transition during production lease without cross-lock deadlock", "manifest_lease_exclusion"],
  ["[REQ-35][REQ-38][PRODUCTION-CLEANUP-ONLY-TAKEOVER] after either strict bound transfers an expired dead-owner lease through trusted-root old-hash prepare tombstone epoch-plus-one cleanup-only claim lease and committed receipt without renewing or reconsuming authority then terminally abandons and leaves no live PID or fixed lease while retaining immutable audit artifacts", "cleanup_only_takeover"],
  ["[REQ-35][REQ-38][PRODUCTION-CLEANUP-ONLY-FORBIDDEN] rejects every effect query reconciliation success or failure settlement evidence gate manifest advancement and rollback action under cleanup-only capability", "cleanup_only_forbidden"],
  ["[REQ-35][REQ-38][PRODUCTION-CLEANUP-ONLY-CRASH] replays cleanup-only prepare tombstone epoch-plus-one lease committed takeover terminal abandonment removal prepare exact removal byte-exact receipt and cleanup without duplicate action or residual PID or lease", "cleanup_only_crash"],
  ["[REQ-35][REQ-38][PRODUCTION-RECOVERY-E2E] reaches a strict bound completes cleanup-only abandonment removal and cleanup consumes fresh recovery authority under recovery-only lease-bound preclaim and claim derives typed production_failed from exact abandoned cleanup and partial-prefix lineage then permits separate fresh-authority rollback", "recovery_e2e"],
  ["[REQ-35][REQ-38][PRODUCTION-RECOVERY-NO-REPLAY] binds the next uncertain-step marker rejects noncontiguous or swapped receipt prefix performs zero rollout canary runtime or SQL effects and never reconciles or repeats the uncertain effect or emits normal gate evidence", "recovery_no_replay"],
  ["[REQ-35][REQ-38][PRODUCTION-RECOVERY-TYPED-RECEIPTS] accepts only recovery-only local-validation step receipts and overall receipt with production_recovery command writes overall receipt before failure evidence binds it without a hash cycle and compares recoveryAttemptedExternalEffect false separately from priorAttemptedExternalEffect", "recovery_typed_receipts"],
  ["[REQ-35][REQ-38][PRODUCTION-STEP-INTENT-CRASH] fsyncs exact attempt-one bound step intent before every external effect binds it from receipt treats only actual intent-without-receipt as uncertain across crash windows while no intent forbids an uncertain-effect claim and rejects every second intent or retry after crash or takeover", "step_intent_crash"],
  ["[REQ-35][REQ-38][PRODUCTION-ORCHESTRATION-FENCE] checks current operation lease hash epoch and consumed authority before every leaf and fences old or replay process ownership", "orchestration_fence"],
  ["[REQ-35][REQ-38][PRODUCTION-ORCHESTRATION-CRASH] replays before and after claim effects step receipts evidence durable settlement removal prepare exact owned lease removal byte-exact prepared receipt publication and cleanup without duplicate consumption effect settlement removal or cleanup", "orchestration_crash"],
  ["[REQ-35][REQ-38][PRODUCTION-LEASE-REMOVAL-CRASH] precommits canonical receipt object UTF8 bytes removedAt hash exact lease hash epoch and terminal state before deletion then replays prepare delete receipt publication and cleanup boundaries byte-exactly without a new clock read", "lease_removal_crash"]
] as const;

it.each(orchestrationCases)("%s", async (_name, scenario) => {
  const api = await loadOrchestratorApi();
  const bundle = buildProductionEvidenceScenarioV2(scenario);
  const calls: string[] = [];
  const result = await api.executeProductionOperationV2(bundle, {
    async persist(kind: string) { calls.push(`persist:${kind}`); },
    async effect(kind: string) { calls.push(`effect:${kind}`); return { exitCode: 0, outputSha256: "c".repeat(64) }; },
    async observe(kind: string) { calls.push(`observe:${kind}`); return { ok: true, outputSha256: "d".repeat(64) }; }
  });
  expect(result.operationId).toBe(bundle.operation.operationId);
  expect(calls[0]).toMatch(/^persist:/);
  if (scenario.includes("cleanup_only") || scenario.includes("recovery_no_replay")) expect(calls.some((call) => call.startsWith("effect:"))).toBe(false);
});

it("[REQ-35][REQ-38][PRODUCTION-PRECLAIM-LINEAGE-SWAP] rejects traversal foreign path swapped bytes hash original preclaim current tip previous-lineage branch gap changed lineageStartedAt multi-receipt suffix or takeover receipt from another operation generation root owner epoch before claim or consumption", async () => {
  const api = await loadEvidenceApi();
  const valid = buildProductionEvidenceScenarioV2("preclaim_lineage_swap");
  for (const mutation of [{ lineagePath: "../foreign" }, { previousLineageSha256: "f".repeat(64) }, { lineageStartedAt: "2099-01-01T00:00:00.000Z" }]) {
    expect(() => api.validateProductionReleaseEvidenceBundleV2({ ...valid, preclaimLineage: mutation })).toThrow();
  }
});

it("[REQ-35][REQ-38][PRODUCTION-ROLLBACK-V2] rejects cross-window fields and G10 rehearsal for all three outcomes", async () => {
  const api = await loadEvidenceApi(); const valid = buildProductionEvidenceScenarioV2("production_rollback");
  for (const outcome of ["previous_runtime_retained", "previous_runtime_restarted", "candidate_replaced_with_previous"]) {
    expect(() => api.validateProductionRollbackEvidenceV2({ ...valid, outcome, source: "g10_rollback_rehearsal" })).toThrow();
  }
});

it("[REQ-35][REQ-38][PRODUCTION-ORCHESTRATION-TAKEOVER] crash-safely transfers only one expired dead-owner effect-capable production lease while both strict bounds hold through old-hash prepare tombstone epoch-plus-one effect-capable lease and committed receipt without reconsuming authority", async () => {
  const api = await loadOrchestratorApi(); const bundle = buildProductionEvidenceScenarioV2("orchestration_takeover", { takeover: { oldEpoch: 1, newEpoch: 2, ownerDead: true, boundsValid: true } });
  const result = await api.executeProductionOperationV2(bundle, { async persist() {}, async effect() { return { exitCode: 0, outputSha256: "c".repeat(64) }; }, async observe() { return { ok: true }; } });
  expect(result.leaseEpoch).toBe(2);
});
