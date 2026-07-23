import { SCORING_POLICY_V4 } from "./scoringPolicyV4.generated";
import type {
  MatrixScoringResultV4,
  ScoringFactV4
} from "./scoringSignalMatrixV4";

export type ScoreAnchorV3 = {
  readonly version: "score-anchor-v3";
  readonly policyVersion: "scoring-signal-matrix-v4";
  readonly subjectAddress: string;
  readonly mode: "unified";
  readonly score: number;
  readonly decision: "ACCEPTABLE" | "REVIEW" | "DECLINE";
  readonly matrixRow: string;
  readonly evidenceClass: string;
  readonly proofLevel: string;
  readonly authority: string;
  readonly canonicalFactIds: readonly string[];
  readonly primaryFactIds: readonly string[];
  readonly preferredFactId: string;
  readonly lockedGoldenManifestSha256: string;
};

const BINDING_ERROR = "score_anchor_v3_fact_binding_failed";
const ROWS = new Map<string, typeof SCORING_POLICY_V4.rows[number]>(
  SCORING_POLICY_V4.rows.map((row) => [row.rowId, row])
);

function fail(): never {
  throw new Error(BINDING_ERROR);
}

function orderedUnique(values: readonly string[]): boolean {
  return values.length > 0 &&
    values.every((value) => value.length > 0) &&
    new Set(values).size === values.length &&
    values.every((value, index) =>
      index === 0 || values[index - 1]!.localeCompare(value) < 0
    );
}

export function buildScoreAnchorV3(input: {
  readonly subjectAddress: string;
  readonly matrix: MatrixScoringResultV4;
}): ScoreAnchorV3 {
  if (input.subjectAddress.length === 0 ||
    input.matrix.policyVersion !== "scoring-signal-matrix-v4") {
    fail();
  }
  const row = ROWS.get(input.matrix.matrixRow);
  if (
    row === undefined ||
    row.exactScore !== input.matrix.score ||
    row.expectedDecision !== input.matrix.decision
  ) {
    fail();
  }
  const anchor: ScoreAnchorV3 = {
    version: "score-anchor-v3",
    policyVersion: "scoring-signal-matrix-v4",
    subjectAddress: input.subjectAddress,
    mode: "unified",
    score: input.matrix.score,
    decision: input.matrix.decision,
    matrixRow: input.matrix.matrixRow,
    evidenceClass: input.matrix.evidenceClass,
    proofLevel: input.matrix.proofLevel,
    authority: input.matrix.authority,
    canonicalFactIds: [...input.matrix.canonicalFactIds],
    primaryFactIds: [...input.matrix.primaryFactIds],
    preferredFactId: input.matrix.preferredFactId,
    lockedGoldenManifestSha256:
      input.matrix.lockedGoldenManifestSha256
  };
  return validateScoreAnchorV3({
    anchor,
    subjectAddress: input.subjectAddress,
    facts: input.matrix.facts,
    activeAnchors: [anchor]
  });
}

export function validateScoreAnchorV3(input: {
  readonly anchor: ScoreAnchorV3;
  readonly subjectAddress: string;
  readonly facts: readonly ScoringFactV4[];
  readonly activeAnchors: readonly ScoreAnchorV3[];
}): ScoreAnchorV3 {
  const { anchor } = input;
  const row = ROWS.get(anchor.matrixRow);
  const factIds = [...input.facts.map((fact) => fact.id)].sort();
  if (
    anchor.version !== "score-anchor-v3" ||
    anchor.policyVersion !== "scoring-signal-matrix-v4" ||
    anchor.mode !== "unified" ||
    anchor.subjectAddress !== input.subjectAddress ||
    !Number.isSafeInteger(anchor.score) ||
    anchor.score < 0 ||
    anchor.score > 100 ||
    row === undefined ||
    row.exactScore !== anchor.score ||
    row.expectedDecision !== anchor.decision ||
    anchor.lockedGoldenManifestSha256 !==
      SCORING_POLICY_V4.lockedGoldenManifestSha256 ||
    input.activeAnchors.length !== 1 ||
    input.activeAnchors[0] !== anchor ||
    !orderedUnique(anchor.canonicalFactIds) ||
    !orderedUnique(anchor.primaryFactIds) ||
    JSON.stringify(anchor.canonicalFactIds) !== JSON.stringify(factIds) ||
    !anchor.primaryFactIds.every((id) =>
      anchor.canonicalFactIds.includes(id)
    ) ||
    !anchor.primaryFactIds.includes(anchor.preferredFactId) ||
    input.facts.some((fact) => fact.subject !== input.subjectAddress)
  ) {
    fail();
  }
  return anchor;
}
