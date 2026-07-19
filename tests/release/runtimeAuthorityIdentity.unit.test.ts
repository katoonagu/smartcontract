import { describe, expect, it } from "vitest";
import { runtimeAuthorityFilename } from "../../scripts/manageTask0BRuntime";

describe("production runtime authority artifact identity", () => {
  it("keeps fresh rollback attempts with the same generation and command in distinct files", () => {
    const first = runtimeAuthorityFilename("generation-123456", "runtime_manager_rollback_previous",
      "a".repeat(64));
    const second = runtimeAuthorityFilename("generation-123456", "runtime_manager_rollback_previous",
      "b".repeat(64));
    expect(first).not.toBe(second);
    expect(first).toContain("a".repeat(64));
    expect(second).toContain("b".repeat(64));
  });
});
