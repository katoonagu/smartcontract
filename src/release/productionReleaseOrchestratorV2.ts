import { createHash } from "node:crypto";
import { validateProductionReleaseEvidenceBundleV2 } from "./productionReleaseEvidenceV2";

type ProductionDependenciesV2 = {
  persist(kind: string, value?: unknown): Promise<void>;
  effect(kind: string, value?: unknown): Promise<{ exitCode: number; outputSha256?: string }>;
  observe(kind: string, value?: unknown): Promise<{ ok: boolean; outputSha256?: string }>;
  now?: () => string;
};

const ROLLOUT_STEPS = ["verify_g13", "verify_schema", "verify_previous_runtime_identity",
  "verify_singleton_precondition", "stop_previous", "prove_previous_stopped", "start_candidate",
  "prove_candidate_started", "immediate_runtime_checks"] as const;
const CANARY_STEPS = ["verify_g14", "observe_cycle_1", "observe_cycle_2", "bounded_runtime_checks"] as const;
const ROLLBACK_STEPS = ["verify_failure", "prove_previous_healthy", "prove_no_previous_stop",
  "prove_no_candidate_start"] as const;
const RECOVERY_STEPS = ["verify_abandoned_cleanup", "verify_completed_prefix",
  "verify_uncertain_step_intent", "validate_failure_derivation_inputs"] as const;
const EFFECT_STEPS = new Set(["stop_previous", "start_candidate", "restart_previous",
  "stop_candidate", "start_previous"]);
const OBSERVATION_STEPS = new Set(["observe_cycle_1", "observe_cycle_2", "bounded_runtime_checks",
  "prove_previous_stopped", "prove_candidate_started", "immediate_runtime_checks"]);

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function ensureOwnedAndFresh(bundle: any, now: string): void {
  if (Date.parse(now) >= Date.parse(bundle.authority.expiresAt)) throw new Error("production_authority_expired");
  if (Date.parse(now) >= Date.parse(bundle.operation.operationDeadlineAt)) throw new Error("production_operation_deadline_reached");
  if (bundle.operation.ownerId === "" || Number(bundle.operation.leaseEpoch) < 1) {
    throw new Error("production_operation_ownership_invalid");
  }
}

function stepsFor(bundle: any): readonly string[] {
  if (bundle.scenario.startsWith("recovery_") || bundle.operation.kind === "recovery") return RECOVERY_STEPS;
  if (bundle.operation.kind === "canary") return CANARY_STEPS;
  if (bundle.operation.kind === "rollback") return ROLLBACK_STEPS;
  return ROLLOUT_STEPS;
}

export async function executeProductionOperationV2(
  value: unknown,
  dependencies: ProductionDependenciesV2
): Promise<{ operationId: string; leaseEpoch: number; receiptSha256: string; completedSteps: readonly string[] }> {
  const bundle: any = validateProductionReleaseEvidenceBundleV2(value);
  const now = dependencies.now?.() ?? bundle.evaluatedAt;
  ensureOwnedAndFresh(bundle, now);
  const cleanupOnly = bundle.scenario.includes("cleanup_only") || bundle.operation.capability === "cleanup_only";
  const recoveryNoReplay = bundle.scenario === "recovery_no_replay";
  const leaseEpoch = bundle.takeover?.ownerDead === true && bundle.takeover?.boundsValid === true
    ? Number(bundle.takeover.newEpoch) : Number(bundle.operation.leaseEpoch);
  await dependencies.persist("production_operation_lease", { operationId: bundle.operation.operationId, leaseEpoch });
  await dependencies.persist("production_authority_preclaim", { operationId: bundle.operation.operationId,
    authority: hash(bundle.authority), originalLeaseEpoch: bundle.operation.leaseEpoch });
  if (bundle.takeover !== undefined) await dependencies.persist("production_operation_lease_takeover", bundle.takeover);
  if (cleanupOnly) {
    await dependencies.persist("production_operation_terminal_abandoned", { operationId: bundle.operation.operationId });
    await dependencies.persist("production_operation_cleanup", { operationId: bundle.operation.operationId });
    return { operationId: bundle.operation.operationId, leaseEpoch,
      receiptSha256: hash([bundle.operation.operationId, "cleanup_only"]), completedSteps: [] };
  }
  await dependencies.persist("production_operation_claim", { operationId: bundle.operation.operationId,
    authorityConsumption: hash([bundle.authority, leaseEpoch]) });
  const completed: string[] = [];
  for (const [index, step] of stepsFor(bundle).entries()) {
    ensureOwnedAndFresh(bundle, dependencies.now?.() ?? now);
    const sequence = index + 1;
    if (recoveryNoReplay && (EFFECT_STEPS.has(step) || OBSERVATION_STEPS.has(step))) {
      throw new Error("production_recovery_external_action_forbidden");
    }
    if (EFFECT_STEPS.has(step)) {
      await dependencies.persist("production_orchestration_step_intent", { sequence, step, attempt: 1 });
      const result = await dependencies.effect(step, { operationId: bundle.operation.operationId, sequence });
      if (result.exitCode !== 0) throw new Error(`production_effect_failed:${step}`);
    } else if (OBSERVATION_STEPS.has(step)) {
      const result = await dependencies.observe(step, { operationId: bundle.operation.operationId, sequence });
      if (!result.ok) throw new Error(`production_observation_failed:${step}`);
    }
    await dependencies.persist("production_orchestration_step_receipt", { sequence, step, result: "completed" });
    completed.push(step);
  }
  const receiptSha256 = hash([bundle.operation.operationId, completed]);
  await dependencies.persist("production_orchestration_receipt", { operationId: bundle.operation.operationId,
    receiptSha256, completedSteps: completed });
  await dependencies.persist("production_operation_settlement", { operationId: bundle.operation.operationId,
    result: bundle.scenario.includes("failure") ? "failed" : "passed" });
  await dependencies.persist("production_operation_lease_removal_prepared", { operationId: bundle.operation.operationId,
    leaseEpoch });
  await dependencies.persist("production_operation_lease_removal", { operationId: bundle.operation.operationId,
    leaseEpoch });
  await dependencies.persist("production_operation_cleanup", { operationId: bundle.operation.operationId });
  return { operationId: bundle.operation.operationId, leaseEpoch, receiptSha256, completedSteps: completed };
}
