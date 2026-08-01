import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("migration 036 ordinary rollout configuration", () => {
  it("removes only release-receipt state and preserves durable rollout policy", () => {
    const sql = readFileSync(
      "migrations/036_remove_rollout_authority.sql",
      "utf8"
    );

    expect(sql).toContain("drop column rollout_receipt_sha256");
    expect(sql).toContain(
      "drop constraint unified_check_runs_rollout_receipt_sha256_check"
    );
    expect(sql).toContain("unified_check_runs_rollout_policy_shape_check");
    expect(sql).toContain("unified_reject_run_rollout_policy_mutation");
    expect(sql).not.toContain("new.rollout_receipt_sha256");
    for (const retained of [
      "rollout_stage",
      "rollout_bucket",
      "admission_policy",
      "provider_capacity_ceiling"
    ]) {
      expect(sql).toContain(retained);
    }
  });
});
