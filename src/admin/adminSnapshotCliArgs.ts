export type AdminSnapshotCliArgs = {
  address?: string;
  jobId?: string;
  limit: 20 | 50 | 100;
  out?: string;
  outDir: string;
};

const validLimits = new Set([20, 50, 100]);

function nextValue(argv: string[], index: number, name: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

export function parseAdminSnapshotCliArgs(argv: string[]): AdminSnapshotCliArgs {
  const args: AdminSnapshotCliArgs = {
    limit: 50,
    outDir: "artifacts/admin-snapshots"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--address") {
      args.address = nextValue(argv, index, arg);
      index += 1;
    } else if (arg === "--job") {
      args.jobId = nextValue(argv, index, arg);
      index += 1;
    } else if (arg === "--limit") {
      const limit = Number(nextValue(argv, index, arg));
      if (!validLimits.has(limit)) throw new Error("--limit must be 20, 50, or 100.");
      args.limit = limit as AdminSnapshotCliArgs["limit"];
      index += 1;
    } else if (arg === "--out") {
      args.out = nextValue(argv, index, arg);
      index += 1;
    } else if (arg === "--out-dir") {
      args.outDir = nextValue(argv, index, arg);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (args.address && args.jobId) throw new Error("Use --address or --job, not both.");
  return args;
}
