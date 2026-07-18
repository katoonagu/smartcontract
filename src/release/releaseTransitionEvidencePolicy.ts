export const RELEASE_TRANSITION_EVIDENCE_POLICY_V2 = Object.freeze({
  production_failed: Object.freeze({
    relativePath: "production-failure-evidence-v2.json",
    kind: "production_failure_evidence",
    schemaVersion: "production-failure-evidence-v2"
  }),
  rollback_rolled_back: Object.freeze({
    relativePath: "production-rollback-evidence-v2.json",
    kind: "actual_rollback_evidence",
    schemaVersion: "production-rollback-evidence-v2"
  })
} as const);
