import { describe, expect, it, vi } from "vitest";
import { createUnifiedPoolTransactionHost } from "../../src/unifiedCheck/repository";

describe("Unified PostgreSQL transaction host", () => {
  it("releases a checked-out client when BEGIN fails", async () => {
    const beginError = new Error("connection closed");
    const release = vi.fn();
    const host = createUnifiedPoolTransactionHost({
      query: vi.fn(async () => ({ rows: [] })),
      connect: vi.fn(async () => ({
        query: vi.fn(async () => {
          throw beginError;
        }),
        release
      }))
    });
    await expect(host.transaction(async () => "never"))
      .rejects.toThrow("connection closed");
    expect(release).toHaveBeenCalledWith(beginError);
  });

  it("rolls back and destroys the client when rollback also fails", async () => {
    const rollbackError = new Error("rollback failed");
    const release = vi.fn();
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error("work failed"))
      .mockRejectedValueOnce(rollbackError);
    const host = createUnifiedPoolTransactionHost({
      query: vi.fn(async () => ({ rows: [] })),
      connect: vi.fn(async () => ({ query, release }))
    });
    await expect(host.transaction(async (client) => {
      await client.query("work");
    })).rejects.toThrow("work failed");
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      "begin",
      "work",
      "rollback"
    ]);
    expect(release).toHaveBeenCalledWith(rollbackError);
  });
});
