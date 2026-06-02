import type { ForensicCheckJob, ForensicCheckJobStatus } from "../storage/repositories";

export type AdminForensicsDecision = "ACCEPTABLE" | "REVIEW" | "DECLINE" | "UNKNOWN";
export type AdminForensicsRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type AdminForensicsConfidence = "low" | "medium" | "high";

export type AdminForensicsJobSummary = {
  id: string;
  kind: ForensicCheckJob["kind"];
  status: Extract<ForensicCheckJobStatus, "partial" | "completed" | "failed">;
  subjectAddress: string;
  windowStart: string;
  windowEnd: string;
  startedAt: string | null;
  completedAt: string | null;
  requestedBy: string | null;
};

export type AdminForensicsAddressSummary = {
  address: string;
  displayLabel: string | null;
  knownLabels: string[];
  role: "checked_wallet" | "sender" | "receiver" | "unknown";
};

export type AdminForensicsSummary = {
  decision: AdminForensicsDecision;
  riskScore: number | null;
  riskLevel: AdminForensicsRiskLevel | null;
  confidence: AdminForensicsConfidence | null;
  coverageRatio: number | null;
  checkedScope: string | null;
  anchorCoverageRatio: number | null;
  episodeCoverageRatio: number | null;
  drainEpisode: Record<string, unknown> | null;
  layerSummary: Record<string, unknown> | null;
  selectedAmountRaw: string | null;
  targetAmountRaw: string | null;
  topReasons: string[];
};

export type AdminForensicsNode = {
  id: string;
  address: string | null;
  kind: "subject" | "wallet" | "service" | "contract" | "label" | "stop";
  label: string;
  riskLevel: AdminForensicsRiskLevel | null;
  confidence: AdminForensicsConfidence | null;
  weight: number | null;
  metadata: Record<string, unknown>;
};

export type AdminForensicsEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  type: "transfer" | "inferred_provenance" | "approval" | "service_boundary" | "stop";
  amountRaw: string | null;
  amountShare: number | null;
  txHash: string | null;
  timestamp: string | null;
  weight: number | null;
  verdict: "clean" | "review" | "risk" | "unknown";
  evidenceIds: string[];
  metadata: Record<string, unknown>;
};

export type AdminForensicsPath = {
  id: string;
  nodeIds: string[];
  edgeIds: string[];
  verdict: AdminForensicsDecision;
  riskContribution: number;
  amountRaw: string | null;
  amountShare: number | null;
  stoppedAtNodeId: string | null;
  stopReason: string | null;
  evidenceIds: string[];
};

export type AdminForensicsWeight = {
  id: string;
  source: string;
  label: string;
  value: number;
  direction: "raises_risk" | "lowers_risk" | "context";
  pathId: string | null;
  nodeId: string | null;
  edgeId: string | null;
  explanation: string;
};

export type AdminForensicsLimitation = {
  code: string;
  label: string;
  severity: "info" | "review" | "blocking";
  pathId: string | null;
  explanation: string;
};

export type AdminForensicsEvidenceRef = {
  id: string;
  source: string;
  label: string;
  nodeIds: string[];
  edgeIds: string[];
  pathIds: string[];
};

export type AdminForensicsGraph = {
  job: AdminForensicsJobSummary;
  subject: AdminForensicsAddressSummary;
  summary: AdminForensicsSummary;
  nodes: AdminForensicsNode[];
  edges: AdminForensicsEdge[];
  paths: AdminForensicsPath[];
  weights: AdminForensicsWeight[];
  limitations: AdminForensicsLimitation[];
  evidence: AdminForensicsEvidenceRef[];
};

export type AdminForensicsProjectionResult =
  | { ok: true; graph: AdminForensicsGraph }
  | { ok: false; status: "not_ready" | "unsupported" | "malformed"; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function arrayField(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

function riskLevelFromScore(score: number | null): AdminForensicsRiskLevel | null {
  if (score === null) return null;
  if (score >= 85) return "CRITICAL";
  if (score >= 65) return "HIGH";
  if (score >= 35) return "MEDIUM";
  return "LOW";
}

function confidenceFromNumber(value: number | null): AdminForensicsConfidence | null {
  if (value === null) return null;
  if (value >= 70) return "high";
  if (value >= 40) return "medium";
  return "low";
}

function decision(value: unknown): AdminForensicsDecision {
  return value === "ACCEPTABLE" || value === "REVIEW" || value === "DECLINE" ? value : "UNKNOWN";
}

function completedJobSummary(job: ForensicCheckJob): AdminForensicsJobSummary | null {
  if (job.status !== "completed" && job.status !== "partial" && job.status !== "failed") return null;
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    subjectAddress: job.subjectAddress,
    windowStart: job.windowStart.toISOString(),
    windowEnd: job.windowEnd.toISOString(),
    startedAt: iso(job.startedAt),
    completedAt: iso(job.completedAt),
    requestedBy: job.requestedBy
  };
}

function nodeId(address: string): string {
  return `addr:${address}`;
}

function stopNodeId(pathIndex: number, reason: string): string {
  return `stop:${pathIndex}:${reason}`;
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] {
  return arrayField(record, key).filter((value): value is string => typeof value === "string" && value.length > 0);
}

function recordArrayField(record: Record<string, unknown>, key: string): Record<string, unknown>[] {
  return arrayField(record, key).filter(isRecord);
}

function recordField(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}

function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-6)}` : address;
}

function edgeVerdict(value: unknown): AdminForensicsEdge["verdict"] {
  if (value === "ACCEPTABLE" || value === "clean") return "clean";
  if (value === "REVIEW" || value === "review") return "review";
  if (value === "DECLINE" || value === "risk") return "risk";
  return "unknown";
}

function firstNumber(...values: Array<number | null>): number | null {
  return values.find((value): value is number => value !== null) ?? null;
}

function firstString(...values: Array<string | null>): string | null {
  return values.find((value): value is string => value !== null) ?? null;
}

function whereIsMoneyResultFromJob(job: ForensicCheckJob): Record<string, unknown> | null {
  if (!isRecord(job.resultJson)) return null;
  const nested = job.resultJson["whereIsMoneyReport"];
  return isRecord(nested) ? nested : job.resultJson;
}

function evidenceRefs(
  allEvidenceIds: string[],
  paths: AdminForensicsPath[],
  edges: AdminForensicsEdge[]
): AdminForensicsEvidenceRef[] {
  const refs = new Map<string, AdminForensicsEvidenceRef>();
  const ensureRef = (id: string): AdminForensicsEvidenceRef => {
    const existing = refs.get(id);
    if (existing) return existing;
    const ref = {
      id,
      source: "raw_evidence",
      label: id,
      nodeIds: [],
      edgeIds: [],
      pathIds: []
    };
    refs.set(id, ref);
    return ref;
  };
  const appendUnique = (target: string[], values: string[]): void => {
    values.forEach((value) => {
      if (!target.includes(value)) target.push(value);
    });
  };

  allEvidenceIds.forEach((id) => ensureRef(id));
  paths.forEach((path) => {
    path.evidenceIds.forEach((evidenceId) => {
      const ref = ensureRef(evidenceId);
      appendUnique(ref.pathIds, [path.id]);
      appendUnique(ref.nodeIds, path.nodeIds);
      appendUnique(ref.edgeIds, path.edgeIds);
    });
  });
  edges.forEach((edge) => {
    edge.evidenceIds.forEach((evidenceId) => {
      const ref = ensureRef(evidenceId);
      appendUnique(ref.edgeIds, [edge.id]);
      appendUnique(ref.nodeIds, [edge.fromNodeId, edge.toNodeId]);
    });
  });

  return Array.from(refs.values());
}

function projectWhereIsMoneyJob(
  job: ForensicCheckJob,
  summary: AdminForensicsJobSummary
): AdminForensicsProjectionResult {
  const topLevelResult = isRecord(job.resultJson) ? job.resultJson : null;
  const result = whereIsMoneyResultFromJob(job);
  if (!result) {
    return {
      ok: false,
      status: "malformed",
      message: "Forensic graph cannot be projected from malformed job result JSON."
    };
  }

  const assessment = isRecord(result["assessment"]) ? result["assessment"] : {};
  const coverage = isRecord(result["coverage"]) ? result["coverage"] : {};
  const subjectAddress = stringField(result, "subjectAddress") ?? (topLevelResult ? stringField(topLevelResult, "subjectAddress") : null) ?? job.subjectAddress;
  const riskScore = firstNumber(numberField(result, "riskScore"), numberField(assessment, "riskScore"));
  const confidence = confidenceFromNumber(firstNumber(
    numberField(assessment, "provenanceConfidence"),
    numberField(result, "provenanceConfidence")
  ));
  const coverageRatio = firstNumber(
    numberField(coverage, "coverageRatio"),
    numberField(coverage, "currentBalanceCoverageRatio")
  );
  const originPaths = recordArrayField(result, "originPaths");
  const evidenceIds = job.rawEvidenceIds;

  const nodesById = new Map<string, AdminForensicsNode>();
  const edges: AdminForensicsEdge[] = [];
  const paths: AdminForensicsPath[] = [];
  const weights: AdminForensicsWeight[] = [];
  const limitations: AdminForensicsLimitation[] = [];

  const upsertAddressNode = (
    address: string,
    kind: AdminForensicsNode["kind"],
    metadata: Record<string, unknown> = {}
  ): string => {
    const id = nodeId(address);
    const existing = nodesById.get(id);
    if (existing) {
      if (existing.kind !== "subject" && kind === "subject") existing.kind = "subject";
      existing.metadata = { ...existing.metadata, ...metadata };
      return id;
    }
    nodesById.set(id, {
      id,
      address,
      kind,
      label: shortAddress(address),
      riskLevel: kind === "subject" ? riskLevelFromScore(riskScore) : null,
      confidence: kind === "subject" ? confidence : null,
      weight: null,
      metadata
    });
    return id;
  };

  const subjectNodeId = upsertAddressNode(subjectAddress, "subject");

  originPaths.forEach((item, pathIndex) => {
    const pathId = `path:${pathIndex}`;
    const pathEvidenceIds = stringArrayField(item, "evidenceIds");
    const steps = recordArrayField(item, "steps");
    const addresses = stringArrayField(item, "addresses");
    const pathAddresses = stringArrayField(item, "pathAddresses");
    const rootSourceAddress = stringField(item, "rootSourceAddress");
    const addressChain = addresses.length > 0
      ? addresses
      : pathAddresses.length > 0
        ? pathAddresses
        : [
            ...(rootSourceAddress ? [rootSourceAddress] : []),
            ...steps.flatMap((step) => [
              stringField(step, "fromAddress"),
              stringField(step, "toAddress")
            ]).filter((address): address is string => address !== null)
          ];
    const uniqueAddressChain = Array.from(new Set(addressChain.length > 0 ? addressChain : [subjectAddress]));
    const pathNodeIds = uniqueAddressChain.map((address) =>
      upsertAddressNode(address, address === subjectAddress ? "subject" : "wallet")
    );
    const txHashes = stringArrayField(item, "txHashes");
    const pathEdgeIds: string[] = [];
    const amountRaw = firstString(stringField(item, "amountRaw"), stringField(item, "selectedAmountRaw"));
    const amountShare = firstNumber(numberField(item, "balanceShare"), numberField(item, "amountShare"));
    const verdict = decision(item["verdict"]);
    const riskContribution = numberField(item, "riskScoreContribution") ?? 0;

    if (steps.length > 0) {
      steps.forEach((step, stepIndex) => {
        const fromAddress = stringField(step, "fromAddress");
        const toAddress = stringField(step, "toAddress");
        if (!fromAddress || !toAddress) return;
        const fromNodeId = upsertAddressNode(fromAddress, fromAddress === subjectAddress ? "subject" : "wallet");
        const toNodeId = upsertAddressNode(toAddress, toAddress === subjectAddress ? "subject" : "wallet");
        const edgeId = `edge:${pathIndex}:${stepIndex}`;
        edges.push({
          id: edgeId,
          fromNodeId,
          toNodeId,
          type: "transfer",
          amountRaw: stringField(step, "amountRaw") ?? amountRaw,
          amountShare,
          txHash: stringField(step, "txHash") ?? txHashes[stepIndex] ?? null,
          timestamp: stringField(step, "timestamp"),
          weight: riskContribution,
          verdict: edgeVerdict(item["verdict"]),
          evidenceIds: pathEvidenceIds,
          metadata: { pathId }
        });
        pathEdgeIds.push(edgeId);
      });
    } else {
      for (let index = 0; index < uniqueAddressChain.length - 1; index += 1) {
        const edgeId = `edge:${pathIndex}:${index}`;
        edges.push({
          id: edgeId,
          fromNodeId: nodeId(uniqueAddressChain[index]),
          toNodeId: nodeId(uniqueAddressChain[index + 1]),
          type: "transfer",
          amountRaw,
          amountShare,
          txHash: txHashes[index] ?? null,
          timestamp: null,
          weight: riskContribution,
          verdict: edgeVerdict(item["verdict"]),
          evidenceIds: pathEvidenceIds,
          metadata: { pathId }
        });
        pathEdgeIds.push(edgeId);
      }
    }

    const stoppedReason = stringField(item, "stoppedReason");
    let stoppedAtNodeId: string | null = null;
    if (stoppedReason) {
      stoppedAtNodeId = stopNodeId(pathIndex, stoppedReason);
      nodesById.set(stoppedAtNodeId, {
        id: stoppedAtNodeId,
        address: null,
        kind: "stop",
        label: stoppedReason,
        riskLevel: riskLevelFromScore(riskContribution),
        confidence: null,
        weight: riskContribution,
        metadata: { reason: stoppedReason, pathId }
      });
      const priorNodeId = pathNodeIds[pathNodeIds.length - 1] ?? subjectNodeId;
      const edgeId = `edge:${pathIndex}:stop`;
      edges.push({
        id: edgeId,
        fromNodeId: priorNodeId,
        toNodeId: stoppedAtNodeId,
        type: "stop",
        amountRaw: null,
        amountShare: null,
        txHash: null,
        timestamp: null,
        weight: riskContribution,
        verdict: edgeVerdict(item["verdict"]),
        evidenceIds: pathEvidenceIds,
        metadata: { reason: stoppedReason, pathId }
      });
      pathEdgeIds.push(edgeId);
      limitations.push({
        code: stoppedReason,
        label: stoppedReason,
        severity: verdict === "DECLINE" ? "blocking" : "review",
        pathId,
        explanation: `Origin path stopped at ${stoppedReason}.`
      });
    }

    weights.push({
      id: `weight:${pathIndex}:risk`,
      source: "origin_path",
      label: "Path risk contribution",
      value: riskContribution,
      direction: riskContribution > 0 ? "raises_risk" : "context",
      pathId,
      nodeId: stoppedAtNodeId,
      edgeId: pathEdgeIds[0] ?? null,
      explanation: stringArrayField(item, "reasons")[0] ?? "Origin path risk contribution."
    });
    paths.push({
      id: pathId,
      nodeIds: stoppedAtNodeId ? [...pathNodeIds, stoppedAtNodeId] : pathNodeIds,
      edgeIds: pathEdgeIds,
      verdict,
      riskContribution,
      amountRaw,
      amountShare,
      stoppedAtNodeId,
      stopReason: stoppedReason,
      evidenceIds: pathEvidenceIds
    });
  });

  return {
    ok: true,
    graph: {
      job: summary,
      subject: {
        address: subjectAddress,
        displayLabel: null,
        knownLabels: [],
        role: "checked_wallet"
      },
      summary: {
        decision: decision(result["decision"] ?? assessment["decision"]),
        riskScore,
        riskLevel: riskLevelFromScore(riskScore),
        confidence,
        coverageRatio,
        checkedScope: stringField(coverage, "checkedScope"),
        anchorCoverageRatio: numberField(coverage, "anchorCoverageRatio"),
        episodeCoverageRatio: numberField(coverage, "episodeCoverageRatio"),
        drainEpisode: recordField(coverage, "drainEpisode"),
        layerSummary: recordField(result, "layerSummary"),
        selectedAmountRaw: stringField(coverage, "selectedAmountRaw"),
        targetAmountRaw: stringField(coverage, "targetAmountRaw"),
        topReasons: stringArrayField(assessment, "reasons")
      },
      nodes: Array.from(nodesById.values()),
      edges,
      paths,
      weights,
      limitations,
      evidence: evidenceRefs(evidenceIds, paths, edges)
    }
  };
}

function projectAddressDeepJob(
  job: ForensicCheckJob,
  summary: AdminForensicsJobSummary
): AdminForensicsProjectionResult {
  const result = isRecord(job.resultJson) ? job.resultJson : null;
  if (!result) {
    return {
      ok: false,
      status: "malformed",
      message: "Forensic graph cannot be projected from malformed job result JSON."
    };
  }

  const subjectAddress = stringField(result, "subjectAddress") ?? job.subjectAddress;
  const coverage = isRecord(result["coverage"]) ? result["coverage"] : {};
  const counterpartyProfiles = recordArrayField(result, "counterpartyRiskProfiles");
  const serviceProfiles = recordArrayField(result, "serviceExposureProfiles");

  const nodesById = new Map<string, AdminForensicsNode>();
  const edges: AdminForensicsEdge[] = [];
  const paths: AdminForensicsPath[] = [];
  const weights: AdminForensicsWeight[] = [];

  const upsertNode = (
    address: string,
    kind: AdminForensicsNode["kind"],
    metadata: Record<string, unknown> = {}
  ): string => {
    const id = nodeId(address);
    const existing = nodesById.get(id);
    if (existing) {
      if (existing.kind !== "subject" && kind === "subject") existing.kind = "subject";
      existing.metadata = { ...existing.metadata, ...metadata };
      return id;
    }
    nodesById.set(id, {
      id,
      address,
      kind,
      label: shortAddress(address),
      riskLevel: null,
      confidence: null,
      weight: null,
      metadata
    });
    return id;
  };

  const subjectNodeId = upsertNode(subjectAddress, "subject");

  counterpartyProfiles.forEach((profile, index) => {
    const counterpartyAddress = stringField(profile, "counterpartyAddress") ?? stringField(profile, "address");
    if (!counterpartyAddress) return;

    const score = numberField(profile, "score") ?? 0;
    const profileEvidenceIds = stringArrayField(profile, "evidenceIds");
    const counterpartyNodeId = upsertNode(counterpartyAddress, "wallet", {
      label: stringField(profile, "label"),
      direction: stringField(profile, "direction"),
      score
    });
    const direction = stringField(profile, "direction");
    const fromNodeId = direction === "outbound" ? subjectNodeId : counterpartyNodeId;
    const toNodeId = direction === "outbound" ? counterpartyNodeId : subjectNodeId;
    const pathId = `path:counterparty:${index}`;
    const edgeId = `edge:counterparty:${index}`;

    edges.push({
      id: edgeId,
      fromNodeId,
      toNodeId,
      type: "inferred_provenance",
      amountRaw: stringField(profile, "amountRaw"),
      amountShare: numberField(profile, "amountShare"),
      txHash: stringField(profile, "txHash"),
      timestamp: stringField(profile, "timestamp"),
      weight: score,
      verdict: edgeVerdict(profile["verdict"]),
      evidenceIds: profileEvidenceIds,
      metadata: {
        label: stringField(profile, "label"),
        direction
      }
    });
    paths.push({
      id: pathId,
      nodeIds: [fromNodeId, toNodeId],
      edgeIds: [edgeId],
      verdict: decision(profile["verdict"]),
      riskContribution: score,
      amountRaw: stringField(profile, "amountRaw"),
      amountShare: numberField(profile, "amountShare"),
      stoppedAtNodeId: null,
      stopReason: null,
      evidenceIds: profileEvidenceIds
    });
    weights.push({
      id: `weight:counterparty:${index}`,
      source: "counterparty_risk_profile",
      label: stringField(profile, "label") ?? "Counterparty risk profile",
      value: score,
      direction: score > 0 ? "raises_risk" : "context",
      pathId,
      nodeId: counterpartyNodeId,
      edgeId,
      explanation: stringField(profile, "label") ?? "Counterparty risk profile."
    });
  });

  serviceProfiles.forEach((profile, index) => {
    const score = firstNumber(numberField(profile, "exposureScore"), numberField(profile, "score")) ?? 0;
    const serviceNodeIds: string[] = [];
    const upsertServiceNode = (
      address: string | null,
      category: string | null,
      identity: string | null,
      metadata: Record<string, unknown>
    ): void => {
      if (!address) return;
      const serviceNodeId = upsertNode(address, "service", {
        ...metadata,
        category,
        identity,
        score
      });
      const node = nodesById.get(serviceNodeId);
      if (node) node.label = identity ?? category ?? shortAddress(address);
      serviceNodeIds.push(serviceNodeId);
    };

    upsertServiceNode(
      stringField(profile, "serviceAddress") ?? stringField(profile, "address"),
      stringField(profile, "serviceType"),
      stringField(profile, "identity"),
      { source: "serviceExposureProfile" }
    );
    recordArrayField(profile, "topServiceCounterparties").forEach((counterparty) => {
      upsertServiceNode(
        stringField(counterparty, "address"),
        stringField(counterparty, "category"),
        stringField(counterparty, "identity"),
        {
          source: "topServiceCounterparties",
          volumeRaw: stringField(counterparty, "volumeRaw"),
          txCount: numberField(counterparty, "txCount")
        }
      );
    });
    recordArrayField(profile, "topMergedServiceFlows").forEach((flow) => {
      upsertServiceNode(
        stringField(flow, "serviceAddress"),
        stringField(flow, "category"),
        stringField(flow, "identity"),
        {
          source: "topMergedServiceFlows",
          intermediateAddress: stringField(flow, "intermediateAddress"),
          incomingRaw: stringField(flow, "incomingRaw"),
          outgoingServiceRaw: stringField(flow, "outgoingServiceRaw"),
          sourceTxCount: numberField(flow, "sourceTxCount"),
          serviceTxCount: numberField(flow, "serviceTxCount")
        }
      );
    });

    weights.push({
      id: `weight:service:${index}`,
      source: "service_exposure_profile",
      label: stringField(profile, "serviceType") ?? stringField(profile, "dominantCategory") ?? "Service exposure",
      value: score,
      direction: "context",
      pathId: null,
      nodeId: serviceNodeIds[0] ?? null,
      edgeId: null,
      explanation: stringField(profile, "serviceType") ?? stringField(profile, "dominantCategory")
        ? `Exposure to ${stringField(profile, "serviceType") ?? stringField(profile, "dominantCategory")}.`
        : "Service exposure profile."
    });
  });

  return {
    ok: true,
    graph: {
      job: summary,
      subject: {
        address: subjectAddress,
        displayLabel: null,
        knownLabels: [],
        role: "checked_wallet"
      },
      summary: {
        decision: "UNKNOWN",
        riskScore: null,
        riskLevel: null,
        confidence: null,
        coverageRatio: numberField(coverage, "coverageRatio"),
        checkedScope: null,
        anchorCoverageRatio: null,
        episodeCoverageRatio: null,
        drainEpisode: null,
        layerSummary: null,
        selectedAmountRaw: null,
        targetAmountRaw: null,
        topReasons: []
      },
      nodes: Array.from(nodesById.values()),
      edges,
      paths,
      weights,
      limitations: [],
      evidence: evidenceRefs(job.rawEvidenceIds, paths, edges)
    }
  };
}

function projectIncomingDepositJob(
  job: ForensicCheckJob,
  summary: AdminForensicsJobSummary
): AdminForensicsProjectionResult {
  const progress = isRecord(job.progressJson) ? job.progressJson : {};
  const result = isRecord(job.resultJson) ? job.resultJson : {};
  const senderAddress = stringField(progress, "sender") ?? job.subjectAddress;
  const receiverAddress = firstString(
    stringField(progress, "watchedWallet"),
    stringField(progress, "receiver")
  );
  if (!senderAddress || !receiverAddress) {
    return {
      ok: false,
      status: "malformed",
      message: "Incoming deposit graph requires both sender and receiver wallet addresses."
    };
  }
  const riskScore = firstNumber(numberField(result, "depositRiskScore"), numberField(result, "riskScore"));
  const senderNodeId = nodeId(senderAddress);
  const receiverNodeId = nodeId(receiverAddress);
  const edgeId = "edge:deposit:0";
  const pathId = "path:deposit:0";
  const nodesById = new Map<string, AdminForensicsNode>();
  nodesById.set(senderNodeId, {
    id: senderNodeId,
    address: senderAddress,
    kind: "subject",
    label: shortAddress(senderAddress),
    riskLevel: riskLevelFromScore(riskScore),
    confidence: confidenceFromNumber(riskScore),
    weight: riskScore,
    metadata: { role: "sender" }
  });
  if (receiverNodeId === senderNodeId) {
    const senderNode = nodesById.get(senderNodeId);
    if (senderNode) senderNode.metadata = { ...senderNode.metadata, receiverRole: "receiver" };
  } else {
    nodesById.set(receiverNodeId, {
      id: receiverNodeId,
      address: receiverAddress,
      kind: "wallet",
      label: shortAddress(receiverAddress),
      riskLevel: null,
      confidence: null,
      weight: null,
      metadata: { role: "receiver" }
    });
  }
  const nodes: AdminForensicsNode[] = Array.from(nodesById.values());
  const edges: AdminForensicsEdge[] = [
    {
      id: edgeId,
      fromNodeId: senderNodeId,
      toNodeId: receiverNodeId,
      type: "transfer",
      amountRaw: stringField(progress, "amountRaw"),
      amountShare: null,
      txHash: stringField(progress, "depositTxHash") ?? stringField(progress, "txHash"),
      timestamp: stringField(progress, "timestamp"),
      weight: riskScore,
      verdict: edgeVerdict(result["decision"]),
      evidenceIds: [],
      metadata: {}
    }
  ];
  const paths: AdminForensicsPath[] = [
    {
      id: pathId,
      nodeIds: [senderNodeId, receiverNodeId],
      edgeIds: [edgeId],
      verdict: decision(result["decision"]),
      riskContribution: riskScore ?? 0,
      amountRaw: stringField(progress, "amountRaw"),
      amountShare: null,
      stoppedAtNodeId: null,
      stopReason: null,
      evidenceIds: []
    }
  ];
  const weights: AdminForensicsWeight[] = [
    {
      id: "weight:deposit:risk",
      source: "incoming_deposit",
      label: "Deposit risk score",
      value: riskScore ?? 0,
      direction: riskScore !== null && riskScore > 0 ? "raises_risk" : "context",
      pathId,
      nodeId: senderNodeId,
      edgeId,
      explanation: "Incoming deposit risk score."
    }
  ];

  return {
    ok: true,
    graph: {
      job: summary,
      subject: {
        address: senderAddress,
        displayLabel: null,
        knownLabels: [],
        role: "sender"
      },
      summary: {
        decision: decision(result["decision"]),
        riskScore,
        riskLevel: riskLevelFromScore(riskScore),
        confidence: confidenceFromNumber(riskScore),
        coverageRatio: null,
        checkedScope: null,
        anchorCoverageRatio: null,
        episodeCoverageRatio: null,
        drainEpisode: null,
        layerSummary: null,
        selectedAmountRaw: stringField(progress, "amountRaw"),
        targetAmountRaw: null,
        topReasons: stringArrayField(result, "reasons")
      },
      nodes,
      edges,
      paths,
      weights,
      limitations: [],
      evidence: evidenceRefs(job.rawEvidenceIds, paths, edges)
    }
  };
}

export function projectForensicJobGraph(job: ForensicCheckJob): AdminForensicsProjectionResult {
  const summary = completedJobSummary(job);
  if (!summary) {
    return {
      ok: false,
      status: "not_ready",
      message: "Forensic graph is available after the job completes."
    };
  }
  if (job.kind === "where_is_money_check") {
    return projectWhereIsMoneyJob(job, summary);
  }
  if (job.kind === "address_deep_check") {
    return projectAddressDeepJob(job, summary);
  }
  if (job.kind === "incoming_deposit_check") {
    return projectIncomingDepositJob(job, summary);
  }
  return {
    ok: false,
    status: "unsupported",
    message: `Graph projection is not implemented for ${job.kind}.`
  };
}
