import { describe, expect, it, vi } from "vitest";
import { runForensicJobBatch } from "../../src/forensics/forensicJobBatch";

describe("runForensicJobBatch", () => {
  it("processes up to the configured maximum number of jobs", async () => {
    const runSingleCycle = vi.fn(async () => true);

    const handled = await runForensicJobBatch({ maxJobs: 3, runSingleCycle });

    expect(handled).toBe(3);
    expect(runSingleCycle).toHaveBeenCalledTimes(3);
  });

  it("stops when the queue is empty", async () => {
    const runSingleCycle = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const handled = await runForensicJobBatch({ maxJobs: 3, runSingleCycle });

    expect(handled).toBe(1);
    expect(runSingleCycle).toHaveBeenCalledTimes(2);
  });
});
