export type RunForensicJobBatchInput = {
  maxJobs: number;
  runSingleCycle(): Promise<boolean>;
};

export async function runForensicJobBatch(input: RunForensicJobBatchInput): Promise<number> {
  const maxJobs = Math.max(0, Math.floor(input.maxJobs));
  let handled = 0;
  for (let index = 0; index < maxJobs; index += 1) {
    const didHandleJob = await input.runSingleCycle();
    if (!didHandleJob) break;
    handled += 1;
  }
  return handled;
}
