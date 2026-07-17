import { execFileSync } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REMEDIATION_PRE_RELEASE_GATE_IDS,
  REMEDIATION_PRODUCTION_GATE_IDS,
  type ReleaseGateId,
  type ReleaseGateState,
  validateRemediationReleaseManifest
} from "../src/release/remediationReleaseManifest";
import { validateAcceptanceTraceSet } from "../src/release/acceptanceTrace";

export const REMEDIATION_RELEASE_MANIFEST_FILE = "release-manifest.json";
export const REMEDIATION_ACCEPTANCE_TRACE_FILE = "acceptance-trace.json";

export type RemediationReleaseVerificationPhase = "manifest" | "pre-manual" | "readiness" | "released" | "rolled-back";

type SanitizedVerificationResult = {
  overall: string;
  gates: Array<{ id: ReleaseGateId; state: ReleaseGateState }>;
};

const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

export async function resolveExternalArtifactRoot(input: string): Promise<string> {
  if (!input.trim()) throw new Error("artifact root is required");
  const requested = resolve(input);
  const metadata = await lstat(requested);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("artifact root must be a real directory");
  const physical = resolve(await realpath(requested));
  if (physical.toLowerCase() !== requested.toLowerCase()) throw new Error("artifact root cannot traverse a symlink");
  if (isInside(repositoryRoot, physical)) throw new Error("artifact root must be outside the repository");
  return physical;
}

export async function readSafeArtifactFile(root: string, relativePath: string): Promise<Buffer> {
  if (!relativePath || isAbsolute(relativePath)) throw new Error("artifact path must be relative");
  const target = resolve(root, relativePath);
  if (!isInside(root, target) || target === root) throw new Error("artifact path escapes its root");
  const metadata = await lstat(target);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("artifact must be a regular file");
  if (metadata.size > MAX_ARTIFACT_BYTES) throw new Error("artifact exceeds the size limit");
  const physical = resolve(await realpath(target));
  if (!isInside(root, physical) || physical.toLowerCase() !== target.toLowerCase()) {
    throw new Error("artifact path traverses a symlink or escapes its root");
  }
  return readFile(target);
}

function parseJson(bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error("artifact is not valid JSON");
  }
}

function isVerifiedGitAncestor(ownerCommitSha: string, candidateSha: string): boolean {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ownerCommitSha, candidateSha], {
      cwd: repositoryRoot,
      stdio: "ignore",
      windowsHide: true
    });
    return true;
  } catch {
    return false;
  }
}

function gateStates(result: SanitizedVerificationResult): Map<ReleaseGateId, ReleaseGateState> {
  return new Map(result.gates.map((gate) => [gate.id, gate.state]));
}

function requireGateState(
  states: ReadonlyMap<ReleaseGateId, ReleaseGateState>,
  ids: readonly ReleaseGateId[],
  allowed: ReadonlySet<ReleaseGateState>
): void {
  if (ids.some((id) => !allowed.has(states.get(id)!))) throw new Error("required release gate is invalid for this phase");
}

function assertPhase(result: SanitizedVerificationResult, phase: RemediationReleaseVerificationPhase): void {
  if (phase === "manifest") return;
  const states = gateStates(result);
  if (phase === "pre-manual") {
    const automated = REMEDIATION_PRE_RELEASE_GATE_IDS.filter((id) => id !== "G05_TELEGRAM");
    requireGateState(states, automated, new Set(["passed"]));
    requireGateState(states, ["G05_TELEGRAM"], new Set(["pending"]));
    requireGateState(states, REMEDIATION_PRODUCTION_GATE_IDS, new Set(["pending"]));
    if (result.overall !== "not_ready") throw new Error("pre-manual manifest must remain not_ready");
    return;
  }
  if (phase === "readiness") {
    requireGateState(states, REMEDIATION_PRE_RELEASE_GATE_IDS, new Set(["passed"]));
    requireGateState(states, REMEDIATION_PRODUCTION_GATE_IDS, new Set(["pending"]));
    if (result.overall !== "ready_for_release") throw new Error("readiness phase is not ready_for_release");
    return;
  }
  if (phase === "released") {
    requireGateState(states, [...REMEDIATION_PRE_RELEASE_GATE_IDS, ...REMEDIATION_PRODUCTION_GATE_IDS], new Set(["passed"]));
    if (result.overall !== "released") throw new Error("released phase is not released");
    return;
  }
  if (result.overall !== "rolled_back") throw new Error("rolled-back phase is not rolled_back");
}

export async function verifyRemediationReleaseArtifacts(
  artifactRoot: string,
  phase: RemediationReleaseVerificationPhase = "manifest"
): Promise<SanitizedVerificationResult> {
  const root = await resolveExternalArtifactRoot(artifactRoot);
  const [manifestBytes, traceBytes] = await Promise.all([
    readSafeArtifactFile(root, REMEDIATION_RELEASE_MANIFEST_FILE),
    readSafeArtifactFile(root, REMEDIATION_ACCEPTANCE_TRACE_FILE)
  ]);
  const manifest = validateRemediationReleaseManifest(parseJson(manifestBytes));
  const trace = validateAcceptanceTraceSet(parseJson(traceBytes), { isAncestor: isVerifiedGitAncestor });
  if (manifest.candidateSha !== trace.candidateSha) throw new Error("release manifest and trace candidate SHAs differ");
  const result: SanitizedVerificationResult = {
    overall: manifest.overall,
    gates: manifest.gates.map(({ id, state }) => ({ id, state }))
  };
  assertPhase(result, phase);
  return result;
}

function parseCliArgs(argv: readonly string[]): { artifactRoot: string; phase: RemediationReleaseVerificationPhase } {
  const phases: readonly RemediationReleaseVerificationPhase[] = [
    "manifest",
    "pre-manual",
    "readiness",
    "released",
    "rolled-back"
  ];
  // npm 11 strips unknown option names after `npm run ... --`; keep its value-only argv shape compatible with the approved runbook.
  if (argv.length === 1) return { artifactRoot: argv[0], phase: "manifest" };
  if (argv.length === 2 && phases.includes(argv[0] as RemediationReleaseVerificationPhase)) {
    return { artifactRoot: argv[1], phase: argv[0] as RemediationReleaseVerificationPhase };
  }
  let artifactRoot: string | undefined;
  let phase: RemediationReleaseVerificationPhase = "manifest";
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--artifact-root" && artifactRoot === undefined) {
      artifactRoot = argv[++index];
      if (!artifactRoot) throw new Error("artifact root is required");
    } else if (argument === "--phase") {
      const value = argv[++index] as RemediationReleaseVerificationPhase | undefined;
      if (!value || !phases.includes(value)) {
        throw new Error("release verification phase is invalid");
      }
      phase = value;
    } else {
      throw new Error("release verifier accepts one explicit artifact root and one optional phase");
    }
  }
  if (!artifactRoot) throw new Error("artifact root is required");
  return { artifactRoot, phase };
}

async function main(): Promise<void> {
  try {
    const { artifactRoot, phase } = parseCliArgs(process.argv.slice(2));
    const result = await verifyRemediationReleaseArtifacts(artifactRoot, phase);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write("remediation_release_invalid\n");
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) void main();
