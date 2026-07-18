export function runTakeoverCleanupOnlyProductionOperationLease(args: string[]): never {
  if (args.length !== 2 || !/^[0-9a-f]{64}$/u.test(args[0])) throw new Error("usage: release:production:lease:cleanup-only-takeover <old-lease-sha> <protected-artifact-root>");
  throw new Error("cleanup_only_takeover_requires_verified_store_context");
}
if (import.meta.url.endsWith(process.argv[1]?.replace(/\\/gu, "/") ?? "\0")) try { runTakeoverCleanupOnlyProductionOperationLease(process.argv.slice(2)); } catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; }
