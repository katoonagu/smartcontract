import {
  lstat,
  mkdir,
  readFile,
  readdir
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  compareAttributionPolicies,
  type AttributionInput
} from "./attribution";
import {
  publishArtifactOnce,
  verifyPublishedArtifact,
  type PublishedArtifact
} from "./artifactStore";
import { canonicalSha256 } from "./canonicalJson";
import {
  parseGoldenCaseCatalogV2,
  type GoldenCaseCatalogV2
} from "./contracts";
import {
  buildNeutralExport,
  type NeutralEvidenceBundleV2,
  type NeutralExportResultV2
} from "./neutralExport";
import {
  assertReviewsReadyForUnblind,
  canonicalEventFactId,
  lockReview,
  prepareReviewWorkspace,
  type LockedReviewV2,
  type SubmittedReviewV2
} from "./reviewWorkspace";
import {
  finalizeAdjudication,
  openAdjudication,
  type AdjudicationDraftV2,
  type FinalAdjudicationV2
} from "./adjudication";
import {
  lockGoldenManifest,
  parseComparatorContractV1,
  verifyLockedGoldenManifest,
  type LockedGoldenManifestV2
} from "./lockedManifest";

type Writable = {
  write(chunk: string | Uint8Array): unknown;
};

type CliIo = {
  stdout: Writable;
  stderr: Writable;
};

type Command =
  | "neutralize"
  | "prepare-review"
  | "lock-review"
  | "compare-attribution"
  | "open-adjudication"
  | "finalize-adjudication"
  | "lock-golden"
  | "verify";

const COMMAND_FLAGS: Record<Command, readonly string[]> = {
  neutralize: ["--input", "--output"],
  "prepare-review": ["--input", "--output", "--reviewer"],
  "lock-review": ["--input", "--output"],
  "compare-attribution": ["--input", "--output"],
  "open-adjudication": ["--input", "--output"],
  "finalize-adjudication": ["--input", "--output"],
  "lock-golden": ["--input", "--output"],
  verify: ["--input"]
};

function isCommand(value: string): value is Command {
  return Object.hasOwn(COMMAND_FLAGS, value);
}

function parseFlags(command: Command, args: string[]): Map<string, string> {
  const allowed = new Set(COMMAND_FLAGS[command]);
  const result = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === undefined || !flag.startsWith("--")) {
      throw new TypeError("golden_invalid_cli_argument");
    }
    if (!allowed.has(flag)) {
      throw new TypeError(`golden_unknown_flag:${flag}`);
    }
    if (result.has(flag)) {
      throw new TypeError(`golden_repeated_flag:${flag}`);
    }
    if (value === undefined || value.startsWith("--")) {
      throw new TypeError(`golden_missing_flag_value:${flag}`);
    }
    result.set(flag, value);
  }
  for (const flag of allowed) {
    if (!result.has(flag)) {
      throw new TypeError(`golden_missing_flag:${flag}`);
    }
  }
  return result;
}

function explicitPath(value: string): string {
  if (value.split(/[\\/]+/u).includes("..")) {
    throw new TypeError("golden_path_escape");
  }
  return resolve(value);
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function inputDirectory(value: string): Promise<string> {
  const path = explicitPath(value);
  const stat = await lstat(path).catch(() => undefined);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw new TypeError("golden_input_directory_invalid");
  }
  return path;
}

function isBelow(path: string, root: string): boolean {
  const relation = relative(root, path);
  return (
    relation.length === 0 ||
    (!relation.startsWith("..") && !isAbsolute(relation))
  );
}

async function outputDirectory(
  value: string,
  input: string,
  allowBelowInput = false
): Promise<string> {
  const path = explicitPath(value);
  if (!allowBelowInput && isBelow(path, input)) {
    throw new TypeError("golden_output_below_input");
  }
  if (await exists(path)) {
    throw new TypeError("golden_output_already_exists");
  }
  return path;
}

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function caseDirectories(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort();
}

async function jsonFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        !entry.isSymbolicLink() &&
        entry.name.endsWith(".json")
    )
    .map((entry) => entry.name)
    .sort();
}

function attributionInput(
  bundle: NeutralEvidenceBundleV2
): AttributionInput {
  const inbound = bundle.events
    .filter((event) => event.to === bundle.subjectAddress)
    .map((event) => ({
      eventId: canonicalEventFactId(event),
      amountRaw: event.amountRaw,
      timestamp: event.timestamp
    }));
  return {
    selectedAmountRaw: inbound
      .reduce((sum, event) => sum + BigInt(event.amountRaw), 0n)
      .toString(),
    inbound
  };
}

async function readNeutralExport(
  root: string,
  caseId: string
): Promise<NeutralExportResultV2> {
  return (await json(
    join(root, caseId, "neutral-export.json")
  )) as NeutralExportResultV2;
}

async function neutralize(input: string, output: string): Promise<void> {
  const catalog = parseGoldenCaseCatalogV2(
    await json(join(input, "case-catalog.json"))
  );
  const expectedFiles = new Set(
    catalog.cases.map((item) => `${item.caseId}.json`)
  );
  const actualFiles = (await jsonFiles(input)).filter(
    (name) => name !== "case-catalog.json"
  );
  if (
    actualFiles.length !== expectedFiles.size ||
    actualFiles.some((name) => !expectedFiles.has(name))
  ) {
    throw new TypeError("golden_source_case_set_incomplete");
  }
  await mkdir(output);
  await publishArtifactOnce(output, "case-catalog.json", catalog);
  for (const descriptor of catalog.cases) {
    const source = await json(join(input, `${descriptor.caseId}.json`));
    const result = buildNeutralExport(source);
    if (
      result.bundle.caseId !== descriptor.caseId ||
      result.bundle.subjectAddress !== descriptor.subjectAddress
    ) {
      throw new TypeError(
        `golden_source_descriptor_mismatch:${descriptor.caseId}`
      );
    }
    await publishArtifactOnce(
      output,
      `${descriptor.caseId}/neutral-export.json`,
      result
    );
  }
}

async function compareAttribution(
  input: string,
  output: string
): Promise<void> {
  await mkdir(output);
  for (const caseId of await caseDirectories(input)) {
    const neutral = await readNeutralExport(input, caseId);
    await publishArtifactOnce(
      output,
      `${caseId}.json`,
      compareAttributionPolicies(attributionInput(neutral.bundle))
    );
  }
}

async function prepareReview(
  input: string,
  output: string,
  reviewerId: string
): Promise<void> {
  await mkdir(output);
  for (const caseId of await caseDirectories(input)) {
    const neutral = await readNeutralExport(input, caseId);
    await prepareReviewWorkspace(
      join(output, caseId),
      reviewerId,
      neutral,
      compareAttributionPolicies(attributionInput(neutral.bundle))
    );
  }
}

async function lockReviews(input: string, output: string): Promise<void> {
  await mkdir(output);
  for (const caseId of await caseDirectories(input)) {
    const locked = await lockReview(join(input, caseId));
    const {
      reviewSha256: _reviewSha256,
      artifact: _artifact,
      ...submitted
    } = locked;
    await publishArtifactOnce(
      output,
      `${caseId}/submitted-review.json`,
      submitted
    );
  }
}

async function readLockedReview(
  root: string,
  caseId: string
): Promise<LockedReviewV2> {
  const path = join(root, caseId, "submitted-review.json");
  const bytes = await readFile(path);
  const review = JSON.parse(bytes.toString("utf8")) as SubmittedReviewV2;
  const reviewSha256 = canonicalSha256(review);
  return {
    ...review,
    reviewSha256,
    artifact: {
      relativePath: `${caseId}/submitted-review.json`,
      sha256: reviewSha256,
      byteLength: bytes.byteLength
    }
  };
}

async function openAdjudications(
  input: string,
  output: string
): Promise<void> {
  const reviewerRoots = (await caseDirectories(input))
    .filter((name) => name.startsWith("locked-reviewer-"))
    .sort();
  if (reviewerRoots.length !== 2) {
    throw new TypeError("golden_two_locked_reviewer_roots_required");
  }
  const leftRoot = join(input, reviewerRoots[0]!);
  const rightRoot = join(input, reviewerRoots[1]!);
  const leftCases = await caseDirectories(leftRoot);
  const rightCases = await caseDirectories(rightRoot);
  if (JSON.stringify(leftCases) !== JSON.stringify(rightCases)) {
    throw new TypeError("golden_locked_review_case_set_mismatch");
  }
  await mkdir(output);
  for (const caseId of leftCases) {
    const draft = openAdjudication([
      await readLockedReview(leftRoot, caseId),
      await readLockedReview(rightRoot, caseId)
    ]);
    await publishArtifactOnce(output, `${caseId}.json`, draft);
  }
}

async function finalizeAdjudications(
  input: string,
  output: string
): Promise<void> {
  await mkdir(output);
  for (const name of await jsonFiles(input)) {
    const draft = (await json(join(input, name))) as AdjudicationDraftV2;
    const final = finalizeAdjudication(draft);
    await publishArtifactOnce(
      output,
      `${final.caseId}/adjudication.json`,
      final
    );
  }
}

async function publishControl(
  input: string,
  output: string,
  name: string
): Promise<PublishedArtifact> {
  return publishArtifactOnce(
    output,
    `control/${name}`,
    await json(join(input, "control", name))
  );
}

async function lockGolden(input: string, output: string): Promise<void> {
  await mkdir(output);
  const protocol = await publishControl(
    input,
    output,
    "protocol.json"
  );
  const caseCatalog = await publishControl(
    input,
    output,
    "case-catalog.json"
  );
  const comparatorContract = await publishControl(
    input,
    output,
    "comparator-contract.json"
  );
  parseComparatorContractV1(
    await json(join(input, "control", "comparator-contract.json"))
  );
  const catalog = parseGoldenCaseCatalogV2(
    await json(join(input, "control", "case-catalog.json"))
  );
  const lockRequest = (await json(
    join(input, "lock-request.json")
  )) as {
    lockedAt: string;
    lockedBy: string;
  };
  const cases = [];
  for (const descriptor of catalog.cases) {
    const caseId = descriptor.caseId;
    const neutral = await readNeutralExport(join(input, "neutral"), caseId);
    const neutralBundle = await publishArtifactOnce(
      output,
      `cases/${caseId}/neutral-bundle.json`,
      neutral.bundle
    );
    const provenanceManifest = await publishArtifactOnce(
      output,
      `cases/${caseId}/provenance-manifest.json`,
      neutral.manifest
    );
    const validatorReceipt = await publishArtifactOnce(
      output,
      `cases/${caseId}/validator-receipt.json`,
      neutral.receipt
    );
    const reviewerA = await publishArtifactOnce(
      output,
      `cases/${caseId}/reviewer-a.json`,
      await json(
        join(
          input,
          "locked-reviewer-a",
          caseId,
          "submitted-review.json"
        )
      )
    );
    const reviewerB = await publishArtifactOnce(
      output,
      `cases/${caseId}/reviewer-b.json`,
      await json(
        join(
          input,
          "locked-reviewer-b",
          caseId,
          "submitted-review.json"
        )
      )
    );
    const adjudication = await publishArtifactOnce(
      output,
      `cases/${caseId}/adjudication.json`,
      await json(
        join(input, "adjudicated", caseId, "adjudication.json")
      )
    );
    cases.push({
      caseId,
      neutralBundle,
      provenanceManifest,
      validatorReceipt,
      reviewerArtifacts: [reviewerA, reviewerB] as [
        PublishedArtifact,
        PublishedArtifact
      ],
      adjudication
    });
  }
  const locked = await lockGoldenManifest({
    root: output,
    outputRelativePath: "locked-manifest.json",
    protocol,
    caseCatalog,
    comparatorContract,
    cases,
    lockedAt: lockRequest.lockedAt,
    lockedBy: lockRequest.lockedBy
  });
  await publishArtifactOnce(
    output,
    "locked-manifest-descriptor.json",
    locked.artifact
  );
}

async function descriptorFor(
  root: string,
  relativePath: string,
  sha256: string
): Promise<PublishedArtifact> {
  const bytes = await readFile(join(root, ...relativePath.split("/")));
  return {
    relativePath,
    sha256,
    byteLength: bytes.byteLength
  };
}

async function verifyLocked(root: string): Promise<{
  manifest: LockedGoldenManifestV2;
  manifestSha256: string;
}> {
  const manifestDescriptor = (await json(
    join(root, "locked-manifest-descriptor.json")
  )) as PublishedArtifact;
  const manifest = await verifyLockedGoldenManifest(
    root,
    manifestDescriptor
  );
  for (const [path, expectedHash] of [
    ["control/protocol.json", manifest.protocolSha256],
    ["control/case-catalog.json", manifest.caseCatalogSha256],
    [
      "control/comparator-contract.json",
      manifest.comparatorContractSha256
    ]
  ] as const) {
    await verifyPublishedArtifact(
      root,
      await descriptorFor(root, path, expectedHash)
    );
  }
  for (const item of manifest.cases) {
    for (const [name, expectedHash] of [
      ["neutral-bundle.json", item.neutralBundleSha256],
      ["provenance-manifest.json", item.provenanceManifestSha256],
      ["validator-receipt.json", item.validatorReceiptSha256],
      ["adjudication.json", item.adjudicationSha256]
    ] as const) {
      const path = `cases/${item.caseId}/${name}`;
      await verifyPublishedArtifact(
        root,
        await descriptorFor(root, path, expectedHash)
      );
    }
    const actualReviewerHashes = [];
    for (const name of ["reviewer-a.json", "reviewer-b.json"]) {
      const value = await json(join(root, "cases", item.caseId, name));
      actualReviewerHashes.push(canonicalSha256(value));
    }
    if (
      JSON.stringify(actualReviewerHashes.sort()) !==
      JSON.stringify([...item.reviewerHashes].sort())
    ) {
      throw new TypeError("golden_locked_reviewer_hash_mismatch");
    }
  }
  return { manifest, manifestSha256: manifestDescriptor.sha256 };
}

async function dispatch(
  command: Command,
  flags: Map<string, string>,
  io: CliIo
): Promise<void> {
  const input = await inputDirectory(flags.get("--input")!);
  if (command === "verify") {
    const verified = await verifyLocked(input);
    io.stdout.write(
      [
        `locked manifest sha256: ${verified.manifestSha256}`,
        `selected attribution policy: ${verified.manifest.selectedAttributionPolicy}`,
        `cases: ${verified.manifest.cases.length}`,
        "golden-v2 verified",
        ""
      ].join("\n")
    );
    return;
  }
  const output = await outputDirectory(
    flags.get("--output")!,
    input,
    command === "open-adjudication"
  );
  if (command === "neutralize") {
    await neutralize(input, output);
  } else if (command === "compare-attribution") {
    await compareAttribution(input, output);
  } else if (command === "prepare-review") {
    await prepareReview(input, output, flags.get("--reviewer")!);
  } else if (command === "lock-review") {
    await lockReviews(input, output);
  } else if (command === "open-adjudication") {
    await openAdjudications(input, output);
  } else if (command === "finalize-adjudication") {
    await finalizeAdjudications(input, output);
  } else {
    await lockGolden(input, output);
  }
}

export async function runGoldenPilotCli(
  args: string[],
  io: CliIo
): Promise<number> {
  try {
    const command = args[0];
    if (command === undefined || !isCommand(command)) {
      throw new TypeError(`golden_unknown_command:${command ?? ""}`);
    }
    const flags = parseFlags(command, args.slice(1));
    await dispatch(command, flags, io);
    return 0;
  } catch (error) {
    io.stderr.write(
      `golden-v2 error: ${
        error instanceof Error ? error.message : String(error)
      }\n`
    );
    return 1;
  }
}
