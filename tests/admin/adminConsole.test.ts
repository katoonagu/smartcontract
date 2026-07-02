import { describe, expect, it } from "vitest";
import { adminConsoleHtml } from "../../src/admin/adminConsole";

function adminClarityHelpers() {
  const html = adminConsoleHtml();
  const helperBlock = html.match(/function graphRiskClarity\(graph\) \{[\s\S]*?\n    \}(?=\n    const escapeHtml)/)?.[0] || "";
  const escapeHtml = (value: unknown) =>
    String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);
  const metric = (label: unknown, value: unknown) => '<div data-metric="' + escapeHtml(label) + '">' + escapeHtml(value) + "</div>";
  const listMetric = (label: unknown, values: unknown[], fallback: unknown) =>
    '<div data-list="' + escapeHtml(label) + '">' + (values.length ? values : [fallback]).map(escapeHtml).join("|") + "</div>";
  const graphSummary = (graph: { summary?: unknown }) => graph?.summary && typeof graph.summary === "object" ? graph.summary : {};

  expect(helperBlock).not.toBe("");
  return new Function("metric", "listMetric", "graphSummary", helperBlock + "\nreturn { graphRiskClarity, clarityMetricHtml };")(
    metric,
    listMetric,
    graphSummary,
  ) as {
    graphRiskClarity(graph: unknown): unknown;
    clarityMetricHtml(clarity: unknown): string;
  };
}

describe("adminConsoleHtml", () => {
  it("renders the graph-first investigation shell", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("data-admin-console");
    expect(html).toContain('<link rel="icon" href="data:,">');
    expect(html).toContain("data-graph-first-shell");
    expect(html).toContain('data-overlay="jobs"');
    expect(html).toContain('data-overlay="analytics"');
    expect(html).toContain('id="toggleJobs"');
    expect(html).toContain('id="toggleAnalytics"');
    expect(html).toContain('id="activityTimeline"');
    expect(html).toContain('id="toggleTransfers"');
    expect(html).toContain("data-transfer-drawer");
    expect(html).toContain('id="toolFitGraph"');
    expect(html).toContain('id="toolToggleLabels"');
    expect(html).toContain('id="toolResetView"');
    expect(html).toContain('id="toolResetLayout"');
    expect(html).toContain('id="flowMode"');
    expect(html).toContain('id="servicesMode"');
    expect(html).toContain("Final risk");
    expect(html).toContain("Coverage status");
    expect(html).toContain("Evidence");
    expect(html).toContain("Policy");
    expect(html).toContain("Graph is evidence navigation, not proof by itself.");
    expect(html).toContain("jobsOpen: true");
    expect(html).toContain("analyticsOpen: true");
    expect(html).toContain(".overlay-panel.jobs-panel { left: 12px;");
    expect(html).toContain(".overlay-panel.analytics-panel { right: 12px;");
    expect(html).toContain(".graph-action-row");
    expect(html).toContain("grid-template-columns: minmax(0, 1fr) max-content");
    expect(html).toContain(".graph-control-group { gap: 5px; flex-wrap: wrap; }");
    expect(html).toContain(".graph-action-row .graph-meta");
    expect(html).toContain("pointer-events: none;");
    expect(html).not.toContain('id="groupSmallWallets"');
    expect(html).not.toContain("adminForensicsGroupSmallWallets");
  });

  it("defines analyst workbench design tokens and interaction states", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("--surface-canvas: #080c11;");
    expect(html).toContain("--surface-panel: #0d1217;");
    expect(html).toContain("--surface-panel-strong: #11171d;");
    expect(html).toContain("--text-primary: #e3ebf2;");
    expect(html).toContain("--text-secondary: #a8b4bf;");
    expect(html).toContain("--semantic-money-in: #6fcf97;");
    expect(html).toContain("--semantic-money-out: #df6b75;");
    expect(html).toContain("--semantic-grouped: #c4b1f2;");
    expect(html).toContain("--semantic-contract: #c982a6;");
    expect(html).toContain("--semantic-boundary: #d6b15f;");
    expect(html).toContain("--focus-ring: rgba(127, 169, 221, .72);");
    expect(html).toContain("font-variant-numeric: tabular-nums;");
    expect(html).toContain("button:focus-visible, select:focus-visible, input:focus-visible");
    expect(html).toContain("outline: 2px solid var(--focus-ring);");
    expect(html).toContain(".status-chip-decision");
    expect(html).toContain(".status-chip-risk");
    expect(html).toContain(".status-chip-coverage");
    expect(html).toContain(".status-chip-evidence");
    expect(html).not.toContain("#000000");
  });

  it("renders analyst workbench shell zones without changing control ids", () => {
    const html = adminConsoleHtml();

    expect(html).toContain('data-workbench-shell');
    expect(html).toContain('data-case-header');
    expect(html).toContain('data-control-rail');
    expect(html).toContain('data-graph-region');
    expect(html).toContain('data-evidence-rail');
    expect(html).toContain('data-timeline-region');
    expect(html).toContain('class="case-header');
    expect(html).toContain('class="graph-action-row workbench-control-rail"');
    expect(html).toContain('class="overlay-panel analytics-panel evidence-rail-region open"');
    expect(html).toContain('class="graph-stage graph-canvas-region"');
    expect(html).toContain('class="timeline-panel timeline-region"');

    expect(html).toContain('id="toggleJobs"');
    expect(html).toContain('id="toggleAnalytics"');
    expect(html).toContain('id="toggleScoringAudit"');
    expect(html).toContain('id="flowMode"');
    expect(html).toContain('id="txLabelMode"');
    expect(html).toContain('id="walletLabelMode"');
    expect(html).toContain('id="roleMarksMode"');
    expect(html).toContain('id="expandSelected"');
    expect(html).toContain('id="servicesMode"');
  });

  it("keeps graph-first browser helpers available", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function setOverlay");
    expect(html).toContain("function renderCaseBrief");
    expect(html).toContain("function renderActivityTimeline");
    expect(html).toContain("function setTransferDrawer");
    expect(html).toContain("function graphFirstLayout");
    expect(html).toContain("function edgeVisualRole");
    expect(html).toContain("function edgeStrokeWidth");
  });

  it("contains the scoring audit panel shell", () => {
    const html = adminConsoleHtml();
    const renderBlock = html.match(/function renderScoringAudit\(\) \{[\s\S]*?\n    \}(?=\n    async function loadScoringAudit)/)?.[0] || "";

    expect(html).toContain("Scoring audit");
    expect(html).toContain("/admin/api/scoring-audit");
    expect(html).toContain("High score + partial coverage");
    expect(html).toContain("Shadow scoring");
    expect(html).toContain("Source attribution");
    expect(html).toContain("INSUFFICIENT_COVERAGE");
    expect(html).toContain("function renderScoringAudit");
    expect(html).toContain("function sourceAttributionLine");
    expect(renderBlock).toContain('report.cohorts');
    expect(html).toContain("sourceAttributionLine(row)");
    expect(html).toContain("row.sourceAttribution");
    expect(renderBlock).toContain('"high_score_partial_coverage"');
    expect(renderBlock).toContain('"acceptable_limited_coverage"');
    expect(renderBlock).toContain('"decline_without_hard_evidence"');
    expect(renderBlock).toContain('report.shadowComparisons');
    expect(html).toContain('["finalScore", "score", "riskScore", "auditScore", "scoringScore"]');
    expect(html).toContain('["currentDecision"]');
    expect(html).toContain('["candidateDecision"]');
  });

  it("renders risk clarity helpers with safe numeric fallbacks and escaped notes", () => {
    const { graphRiskClarity, clarityMetricHtml } = adminClarityHelpers();
    const missingHtml = clarityMetricHtml(graphRiskClarity({ summary: {} }));
    const partialHtml = clarityMetricHtml({
      coverageStatus: "",
      displayNotes: ["<b>unsafe</b>"],
      evidenceClass: undefined,
      finalRiskScore: undefined,
      confidenceScore: Number.NaN,
      decisionStatus: null,
      policyVersion: undefined,
    });

    expect(missingHtml).toContain('data-metric="Coverage status">unknown');
    expect(missingHtml).toContain('data-metric="Evidence">unknown');
    expect(missingHtml).toContain('data-metric="Policy">unknown');
    expect(partialHtml).toContain('data-metric="Final risk">n/a');
    expect(partialHtml).toContain('data-metric="Confidence">n/a');
    expect(partialHtml).toContain("&lt;b&gt;unsafe&lt;/b&gt;");
    expect(partialHtml).not.toContain("<b>unsafe</b>");
    expect(partialHtml).not.toContain("undefined");
  });

  it("contains semantic flow filtering helpers", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function edgeFlowDirection");
    expect(html).toContain("function pathFlowDirection");
    expect(html).toContain("function edgePassesFlowFilter");
    expect(html).toContain("function nodeIsServiceLike");
    expect(html).toContain("function edgePassesServiceFilter");
    expect(html).toContain("function filteredGraphEdges");
    expect(html).toContain("function filteredTransferEdges");
    expect(html).toContain('metadata?.direction === "inbound"');
    expect(html).toContain('metadata?.direction === "outbound"');
    expect(html).toContain('state.flowMode === "incoming"');
    expect(html).toContain('state.flowMode === "outgoing"');
    expect(html).toContain("asArray(item.edgeIds).includes(edge.id)");
    expect(html).toContain("pathNodeIds.indexOf(subjectId)");
    expect(html).toContain("pathNodeIds.indexOf(edge?.fromNodeId)");
    expect(html).toContain("maxEdgeIndex <= subjectIndex");
    expect(html).toContain("minEdgeIndex >= subjectIndex");
    expect(html).toContain('subjectIndex === pathNodeIds.length - 1 ? "incoming" : "outgoing"');
    expect(html).toContain('metadata?.direction === "service"');
  });

  it("clears stale graph state when graph loading fails", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function clearGraphState");
    expect(html).toContain("graphRequestSeq: 0");
    expect(html).toContain("const requestSeq = ++state.graphRequestSeq");
    expect(html).toContain("if (requestSeq !== state.graphRequestSeq) return;");
    expect(html).toContain("clearGraphState();");
    expect(html).toContain('state.transform = { x: 0, y: 0, scale: 1 }');
    expect(html).toContain("renderJobs();");
    expect(html).toContain("renderGraph();");
    expect(html).toContain("Graph unavailable for this job.");
  });

  it("clears stale graph state when job list loading fails", () => {
    const html = adminConsoleHtml();
    const jobListFailureBlock =
      html.match(
        /catch \(error\) \{\n        if \(requestSeq !== state\.jobsRequestSeq\) return;[\s\S]*?setStatus\("Job list failed\."\);/,
      )?.[0] || "";

    expect(jobListFailureBlock).not.toBe("");
    expect(jobListFailureBlock).toContain("clearGraphState();");
    expect(jobListFailureBlock).toContain("renderCaseBrief();");
    expect(jobListFailureBlock).toContain("renderTransferTabs();");
  });

  it("auto-opens the first usable job after loading job history", () => {
    const html = adminConsoleHtml();
    const loadJobsBlock = html.match(/async function loadJobs\(\) \{[\s\S]*?\n    \}/)?.[0] || "";

    expect(loadJobsBlock).toContain("const pendingJob = state.pendingOpenJobId");
    expect(loadJobsBlock).toContain("state.activeJobId");
    expect(loadJobsBlock).toContain('state.jobs.find((job) => job.status === "completed" || job.status === "partial")');
    expect(loadJobsBlock).not.toContain("state.jobs.length === 1 ? state.jobs[0] : null");
  });

  it("contains case brief summary helpers", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function caseBriefTopIncoming");
    expect(html).toContain("function caseBriefTopOutgoing");
    expect(html).toContain("function caseBriefTopServices");
    expect(html).toContain("Top incoming");
    expect(html).toContain("Top outgoing");
    expect(html).toContain("Top services");
    expect(html).toContain("Boundary stops");
    expect(html).toContain("Profile/context graph");
  });

  it("contains semantic edge and node visual helpers", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function edgeVisualRole");
    expect(html).toContain("function edgeStrokeWidth");
    expect(html).toContain("function edgeCurvePath");
    expect(html).toContain("function nodeVisualClass");
    expect(html).toContain('edge-flow-incoming');
    expect(html).toContain('edge-flow-outgoing');
    expect(html).toContain('edge-flow-context');
    expect(html).toContain('edge-flow-self');
    expect(html).toContain('.edge.risk');
    expect(html).toContain('.edge.review');
    expect(html).toContain('.node-label-hidden .node-label');
    expect(html).toContain('class="node-label"');
    expect(html).toContain('node-display-cex');
    expect(html).toContain('node-display-bridge');
  });

  it("contains shared canvas labels for grouped transaction counts", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function edgeCanvasTransferCount");
    expect(html).toContain('return count + " tx - " + amount;');
    expect(html).toContain("edgeTxHashes(edge).length");
  });

  it("reconciles hidden graph selections after flow filters", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function reconcileSelectionWithFilters");
    expect(html).toContain("selectedEdgeVisible");
    expect(html).toContain("selectedNodeVisible");
    expect(html).toContain("state.selected = null");
    expect((html.match(/reconcileSelectionWithFilters\(\);/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it("contains deterministic graph-first layout helpers with collision reduction", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function graphFirstLayout");
    expect(html).toContain("const width = 1700;");
    expect(html).toContain("const height = 1040;");
    expect(html).toContain("function nodeLayoutSide");
    expect(html).toContain("function arrangeCluster");
    expect(html).toContain("function relaxNodeCollisions");
    expect(html).toContain("function constrainLayoutNodes");
    expect(html).toContain("function clampLayoutValue");
    expect(html).toContain("function nodeLabelAttrs");
    expect(html).toContain("incomingNodes");
    expect(html).toContain("outgoingNodes");
    expect(html).toContain("serviceNodes");
    expect(html).toContain("contextNodes");
    expect(html).toContain("const fixedNodeIds = new Set([subjectId])");
    expect(html).toContain("const xPadding = radius + 128;");
    expect(html).toContain("const yPadding = radius + 58;");
    expect(html).toContain("relaxNodeCollisions(nodes, fixedNodeIds)");
    expect(html).toContain("const boundedNodes = constrainLayoutNodes(relaxedNodes, width, height, fixedNodeIds);");
    expect(html).toContain("return { width, height, nodes: boundedNodes, byId };");
  });

  it("contains per-job node drag and saved layout helpers", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("nodeDrag: null");
    expect(html).toContain("suppressNextGraphClick: false");
    expect(html).toContain("suppressGraphClickTimer: null");
    expect(html).toContain("renderedNodePositions: new Map()");
    expect(html).toContain("function nodePositionStorageKey");
    expect(html).toContain("function loadNodePositionOverrides");
    expect(html).toContain("function saveNodePositionOverride");
    expect(html).toContain("function clearNodePositionOverrides");
    expect(html).toContain("function graphPointFromClient");
    expect(html).toContain("function startNodeDrag");
    expect(html).toContain("function updateNodeDrag");
    expect(html).toContain("function suppressNextGraphClick");
    expect(html).toContain("function finishNodeDrag");
    expect(html).toContain("function consumeSuppressedGraphClick");
    expect(html).toContain("state.suppressGraphClickTimer = window.setTimeout(() => {");
    expect(html).toContain("state.suppressNextGraphClick = false;");
    expect(html).toContain("state.suppressGraphClickTimer = null;");
    expect(html).toContain("}, 150);");
    expect(html).toContain("if (moved) suppressNextGraphClick();");
    expect((html.match(/if \(consumeSuppressedGraphClick\(\)\) \{/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("state.suppressNextGraphClick = false;");
    expect(html).toContain('data-node-id="');
    expect(html).toContain('node.addEventListener("mousedown", (event) => {');
    expect(html).not.toContain("if (isCollapsedGroupNodeId(nodeId)) return;");
    expect(html).toContain("startNodeDrag(event, nodeId);");
    expect(html).toContain('el("toolResetLayout").addEventListener("click", clearNodePositionOverrides)');
  });

  it("updates pan and node drag without selecting text or rerendering the full svg on every mousemove", () => {
    const html = adminConsoleHtml();
    const updateDragBlock = html.slice(html.indexOf("function updateNodeDrag"), html.indexOf("function suppressNextGraphClick"));
    const initPanBlock = html.slice(html.indexOf("function initPanZoom"), html.indexOf("function setAutoRefresh"));

    expect(html).toContain("body.graph-interacting, body.graph-interacting * { user-select: none;");
    expect(html).toContain("function setGraphInteracting");
    expect(html).toContain("function clientDeltaToGraphDelta");
    expect(html).toContain("function updateDraggedNodeDom");
    expect(html).toContain("function updateConnectedEdgeDom");
    expect(html).toContain('const pill = document.querySelector(\'[data-edge-id="\' + CSS.escape(edge.id) + \'"] .amount-pill\');');
    expect(html).toContain('pill.setAttribute("transform", "translate(" + (geometry.labelX - width / 2) + " " + (geometry.labelY - 10) + ")");');
    expect(updateDragBlock).toContain("updateDraggedNodeDom(state.nodeDrag.nodeId, nextX, nextY);");
    expect(updateDragBlock).toContain("state.renderedNodePositions.set(state.nodeDrag.nodeId, { x: nextX, y: nextY });");
    expect(updateDragBlock).not.toContain("renderGraph();");
    expect(initPanBlock).toContain("event.preventDefault();");
    expect(initPanBlock).toContain("setGraphInteracting(true);");
    expect(initPanBlock).toContain("setGraphInteracting(false);");
    expect(initPanBlock).toContain("const delta = clientDeltaToGraphDelta(svg, event.clientX - drag.x, event.clientY - drag.y);");
    expect(initPanBlock).toContain("state.transform.x = drag.startX + delta.x;");
    expect(initPanBlock).toContain("state.transform.y = drag.startY + delta.y;");
  });

  it("contains activity timeline bucket helpers", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function edgeTimestampMs");
    expect(html).toContain("function activityTimelineBuckets");
    expect(html).toContain("function selectedTimelineBucket");
    expect(html).toContain("function selectTimelineBucket");
    expect(html).toContain("state.timelineRange");
    expect(html).toContain("timestamp === null) return false");
    expect(html).toContain("timestamp < range.end");
    expect(html).toContain("range.isLast");
    expect(html).toContain("isLast: index === bucketCount - 1");
    expect(html).toContain("timeline-bar");
    expect(html).toContain("data-timeline-index");
  });

  it("contains graph-first selected node and flow cards", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function renderSelectionCard");
    expect(html).toContain("function selectedNodeCard");
    expect(html).toContain("function selectedEdgeCard");
    expect(html).toContain("Selected flow");
    expect(html).toContain("Selected node");
    expect(html).toContain("Meaning");
    expect(html).toContain("This is not money-origin proof");
  });

  it("leads selected evidence panels with analyst explanations before raw facts", () => {
    const html = adminConsoleHtml();
    const selectedEdgeCardBlock = html.slice(html.indexOf("function selectedEdgeCard"), html.indexOf("function renderSelectionCard"));
    const walletDetailBlock = html.slice(html.indexOf("function walletDetailBlock"), html.indexOf("function transferDetailBlock"));
    const groupDetailBlock = html.slice(html.indexOf("function groupDetailBlock"), html.indexOf("function bundleDetailBlock"));
    const bundleDetailBlock = html.slice(html.indexOf("function bundleDetailBlock"), html.indexOf("function subjectReportBlock"));
    const metricRawFactsBlock = html.slice(html.indexOf("function analystMetricRawFactsBlock"), html.indexOf("function nodeAnalystMeaning"));

    expect(html).toContain("function analystIntroBlock");
    expect(html).toContain("function analystBadge");
    expect(html).toContain("function analystRawFactsBlock");
    expect(html).toContain("function analystMetricRawFactsBlock");
    expect(html).toContain(".metric-grid > .analyst-intro { grid-column: 1 / -1; }");

    expect(selectedEdgeCardBlock).toContain("selectedFlowHeaderHtml(edge, rows)");
    expect(selectedEdgeCardBlock).toContain("selectedFlowPrimaryBodyHtml(edge, rows)");
    expect(selectedEdgeCardBlock).toContain("selectedFlowDebugHtml(edge, rows)");
    expect(selectedEdgeCardBlock).not.toContain('analystIntroBlock("What this means"');
    expect(selectedEdgeCardBlock).not.toContain('analystRawFactsBlock("Raw facts"');

    expect(walletDetailBlock).toContain('analystIntroBlock("Why this node appears"');
    expect(walletDetailBlock).toContain('analystMetricRawFactsBlock(type.label + " raw facts"');
    expect(walletDetailBlock).not.toContain('analystRawFactsBlock(type.label + " raw facts"');
    expect(metricRawFactsBlock).toContain("return section(title, asArray(rows).filter(Boolean));");

    expect(groupDetailBlock).toContain('analystIntroBlock("What this group means"');
    expect(bundleDetailBlock).toContain('analystIntroBlock("What this bundle means"');
  });

  it("shows saved wallet risk in selected node details", () => {
    const html = adminConsoleHtml();
    const selectedNodeCardBlock = html.slice(html.indexOf("function selectedNodeCard"), html.indexOf("function reciprocalFlowHtml"));

    expect(html).toContain("function savedWalletRiskHtml");
    expect(selectedNodeCardBlock).toContain("savedWalletRiskHtml(node)");
    expect(html).toContain("Saved wallet risk");
    expect(html).toContain("Source check");
    expect(html).toContain("risk.role || \"unknown\"");
    expect(html).toContain("risk.evidence || \"n/a\"");
  });

  it("does not show subject risk as selected-flow or non-subject wallet risk", () => {
    const html = adminConsoleHtml();
    const selectedEdgeCardBlock = html.slice(html.indexOf("function selectedEdgeCard"), html.indexOf("function renderSelectionCard"));
    const walletDetailBlock = html.slice(html.indexOf("function walletDetailBlock"), html.indexOf("function transferDetailBlock"));

    expect(selectedEdgeCardBlock).not.toContain("graphSummary");
    expect(selectedEdgeCardBlock).not.toContain("subjectReportBlock");
    expect(selectedEdgeCardBlock).not.toContain("summary.riskScore");
    expect(selectedEdgeCardBlock).not.toContain('metric("Risk"');
    expect(selectedEdgeCardBlock).not.toContain('metric("Risk score"');
    expect(selectedEdgeCardBlock).not.toContain('metric("Risk level"');

    expect(html).toContain("function nodeHasOwnRisk");
    expect(walletDetailBlock).toContain("nodeRiskMetricBlock(node)");
    expect(walletDetailBlock).not.toContain('metric("Risk level", node.riskLevel || "n/a")');
    expect(walletDetailBlock).not.toContain('metric("Risk score", node.weight ?? "n/a")');

    expect(html).not.toContain("function savedWalletRiskMetricBlock");
    const helperBlock = html.slice(html.indexOf("function nodeHasOwnRisk"), html.indexOf("function rawBlock"));
    const escapeHtml = (value: unknown) =>
      String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);
    const api = new Function(
      "escapeHtml",
      `
      function metric(label, value, cls = "") { return '<div data-metric="' + escapeHtml(label) + '" class="' + escapeHtml(cls) + '">' + escapeHtml(value) + '</div>'; }
      function metricHtml(label, body, cls = "") { return '<section data-section="' + escapeHtml(label) + '" class="' + escapeHtml(cls) + '">' + body + '</section>'; }
      function asArray(value) { return Array.isArray(value) ? value : []; }
      function section(title, lines) { const body = asArray(lines).filter(Boolean).join(""); return body ? metricHtml(title, '<div>' + body + '</div>', "wide") : ""; }
      ${helperBlock}
      return { nodeHasOwnRisk, nodeRiskMetricBlock };
      `
    )(escapeHtml) as {
      nodeHasOwnRisk(node: unknown): boolean;
      nodeRiskMetricBlock(node: unknown): string;
    };

    expect(api.nodeHasOwnRisk({ kind: "wallet", weight: 88, riskLevel: "high" })).toBe(false);
    expect(api.nodeRiskMetricBlock({ kind: "wallet", weight: 88, riskLevel: "high" })).toBe("");
    expect(api.nodeHasOwnRisk({ kind: "wallet", metadata: { savedWalletRisk: { risk: "high" } } })).toBe(true);
    expect(api.nodeRiskMetricBlock({ kind: "wallet", metadata: { savedWalletRisk: { risk: "high" } } })).toContain("Wallet risk");
    const savedRiskHtml = api.nodeRiskMetricBlock({
      kind: "wallet",
      weight: 88,
      metadata: { savedWalletRisk: { risk: 31, level: "medium", role: "source", evidence: "saved review", source: "manual" } }
    });
    expect(savedRiskHtml).toContain('data-metric="Risk score"');
    expect(savedRiskHtml).toContain(">31</div>");
    expect(savedRiskHtml).toContain('data-metric="Risk level"');
    expect(savedRiskHtml).toContain(">medium</div>");
    expect(savedRiskHtml).not.toContain(">88</div>");
  });

  it("splits trace stop copy into investigation history and hop sufficiency", () => {
    const html = adminConsoleHtml();
    const helperBlock = html.slice(html.indexOf("function traceStopInvestigationHistoryLabel"), html.indexOf("function traceStopCoverageExplanation"));
    const stopDetailBlock = html.slice(html.indexOf("function traceStopDetailBlock"), html.indexOf("function boundaryIdentityEvidenceText"));

    expect(html).toContain("function traceStopInvestigationHistoryLabel");
    expect(html).toContain("function traceStopHopSufficiencyLabel");
    expect(helperBlock).toContain("Complete");
    expect(helperBlock).toContain("Incomplete");
    expect(helperBlock).toContain("Enough for displayed hop");
    expect(helperBlock).toContain("Not enough to continue");
    expect(helperBlock).toContain("Unknown");
    expect(helperBlock).toContain("cardBlockHtml(\"Investigation stop\"");
    expect(stopDetailBlock).toContain("traceStopBoundaryCopyHtml(node)");
    expect(helperBlock).toContain("Investigation history");
    expect(helperBlock).toContain("This hop");
    expect(helperBlock).toContain("Meaning");
    expect(helperBlock).toContain("Not a money-flow edge. This is a data/continuation boundary.");
  });

  it("keeps subject wallet identity separate from behavior role and shows deep-check coverage", () => {
    const html = adminConsoleHtml();
    const subjectBlock = html.slice(html.indexOf("function subjectReportBlock"), html.indexOf("function nodeIntelligenceEvidenceLabel"));
    const intelligenceBlock = html.slice(html.indexOf("function nodeIntelligenceBlock"), html.indexOf("function traceStopDetailBlock"));

    expect(subjectBlock).toContain("DeepCheck coverage");
    expect(subjectBlock).toContain("direct counterparties analyzed");
    expect(subjectBlock).toContain("counterparties expanded");
    expect(subjectBlock).toContain("transfer edges collected");
    expect(subjectBlock).toContain("extended addresses fetched");
    expect(subjectBlock).toContain("All-time subject index");
    expect(subjectBlock).toContain("All-time direct wallets");
    expect(subjectBlock).toContain("Direct hard evidence");
    expect(subjectBlock).toContain("Provider flags");
    expect(subjectBlock).toContain("Second layer indexing");
    expect(intelligenceBlock).toContain("behavior marker, not final risk proof by itself");
  });

  it("renders all-time deep-check coverage lines for the right rail", () => {
    const html = adminConsoleHtml();
    const helperBlock = html.slice(html.indexOf("function raw(value)"), html.indexOf("function nodeIntelligenceEvidenceLabel"));

    expect(helperBlock).toContain("function deepCheckCoverageLines");
    const api = new Function(helperBlock + "\nreturn { deepCheckCoverageLines };")() as {
      deepCheckCoverageLines(summary: unknown): string[];
    };

    expect(api.deepCheckCoverageLines({
      layerSummary: {
        deepCheckCoverage: {
          directCounterpartiesAnalyzed: 87,
          allTimeCoverage: {
            mode: "strict",
            subjectIndexStatus: "complete",
            subjectCoverageMode: "all_time",
            subjectAllTimeComplete: true,
            subjectTransfersFetched: 4321,
            subjectUniqueDirectWallets: 87,
            directWalletsHardEvidenceChecked: 87,
            directWalletsHardEvidenceLiveChecked: 25,
            directHardEvidenceStatus: "live_budget_exhausted",
            directWalletsQueuedForIndexing: 0,
            secondLayerActiveBudget: 0,
            secondLayerQueued: 0,
            secondLayerComplete: 0,
            providerCapHit: false,
            providerInconsistent: true
          }
        }
      }
    })).toEqual(expect.arrayContaining([
      "87 direct counterparties analyzed",
      "All-time subject index: mode strict, status complete, coverage all_time, complete",
      "All-time subject transfers fetched: 4321",
      "All-time direct wallets: 87",
      "Direct hard evidence: 87 checked, 25 live checked, status live_budget_exhausted",
      "Provider flags: provider inconsistent",
      "Second layer indexing: budget 0, direct queued 0, queued 0, complete 0"
    ]));
  });

  it("shows full clickable addresses in analytics details while keeping dense views shortened", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function addressDetailLink");
    expect(html).toContain("function graphAddressFromNodeId");
    expect(html).toContain('return text.startsWith("addr:") ? text.slice(5) : "";');
    expect(html).toContain('const value = graphAddressFromNodeId(address) || address || "n/a";');
    expect(html).toContain('return edge?.fromAddress || nodeAddress(nodeById(edge?.fromNodeId)) || graphAddressFromNodeId(edge?.fromNodeId) || edge?.fromNodeId || "";');
    expect(html).toContain("function cardLineHtml");
    expect(html).toContain('metricHtml("Subject", addressDetailLink(subject.address || "unknown"), "wide")');
    expect(html).toContain('metricHtml("Address", addressDetailLink(nodeAddress(node) || node.id), "wide")');
    expect(html).toContain('cardLineHtml("Address", addressDetailLink(nodeAddress(node) || node.id))');
    expect(html).toContain("function endpointDetailLink");
    expect(html).toContain("return tronscanAddressUrl(graphAddressFromNodeId(label) || label) ? addressDetailLink(label) : escapeHtml(label);");
    expect(html).toContain('metricHtml("From", endpointDetailLink(edge, "from"), "wide")');
    expect(html).toContain('metricHtml("To", endpointDetailLink(edge, "to"), "wide")');
    expect(html).toContain('metricHtml("Tx hash", edgePrimaryTxDetailHtml(edge), "wide")');
    expect(html).toContain('metricHtml("Underlying transactions", edgeTransactionEvidenceHtml(edge), "wide")');
    expect(html).toContain("return amount + \" - \" + short(address, 7);");
    expect(html).toContain("function edgeEvidenceEndpoint");
    expect(html).toContain('transfer?.fromAddress || transfer?.sourceAddress');
    expect(html).toContain('transfer?.toAddress || transfer?.receiverAddress');
    expect(html).toContain('explorerLink(tronscanAddressUrl(edgeEvidenceEndpoint(edge, "from")), short(edgeEvidenceEndpoint(edge, "from"), 7))');
    expect(html).toContain('explorerLink(tronscanAddressUrl(edgeEvidenceEndpoint(edge, "to")), short(edgeEvidenceEndpoint(edge, "to"), 7))');
  });

  it("uses underlying transfer endpoints for contract-driven transfer table rows", () => {
    const html = adminConsoleHtml();
    const helperBlock = html.slice(html.indexOf("function edgeEvidenceEndpoint"), html.indexOf("function edgeHasAggregatedTxEvidence"));
    const edgeEvidenceEndpoint = new Function(
      "function asArray(value) { return Array.isArray(value) ? value : []; }\n" +
        "function edgeFromAddress() { return 'TContract'; }\n" +
        "function edgeToAddress() { return 'TReceiver'; }\n" +
        helperBlock +
        "; return edgeEvidenceEndpoint;"
    )() as (edge: unknown, side: "from" | "to") => string;

    const edge = {
      fromNodeId: "addr:TContract",
      toNodeId: "addr:TReceiver",
      metadata: {
        evidenceType: "contract_driven_transfer",
        underlyingTransfers: [{
          sourceAddress: "TSource",
          receiverAddress: "TReceiver"
        }]
      }
    };

    expect(edgeEvidenceEndpoint(edge, "from")).toBe("TSource");
    expect(edgeEvidenceEndpoint(edge, "to")).toBe("TReceiver");
  });

  it("maps missing data and evidence classes to analyst-readable copy", () => {
    const html = adminConsoleHtml();
    const helperBlock = html.slice(
      html.indexOf("function analystMissingCopy"),
      html.indexOf("function cardLine(")
    );
    expect(helperBlock).toContain("function analystMissingCopy");
    expect(helperBlock).toContain("function analystEvidenceKind");
    expect(helperBlock).toContain("function analystEvidenceMeaning");
    expect(helperBlock).toContain("function analystEvidenceBadgeClass");

    const api = new Function(
      'function edgeEvidenceType(edge) { return edge?.metadata?.evidenceType || edge?.evidenceType || "direct_transfer"; }' +
      'function edgeDisplayRole(edge) { return edge?.displayRole || "real_transfer"; }' +
      'function edgeIsGroupedContextEvidence(edge) { return edge?.metadata?.evidenceType === "grouped_transfers" || (Array.isArray(edge?.metadata?.underlyingTransfers) && edge.metadata.underlyingTransfers.length > 1); }' +
      helperBlock +
      '; return { analystMissingCopy, analystEvidenceKind, analystEvidenceMeaning, analystEvidenceBadgeClass };'
    )() as {
      analystMissingCopy(kind?: string): string;
      analystEvidenceKind(edge: any): string;
      analystEvidenceMeaning(edge: any): string;
      analystEvidenceBadgeClass(edge: any): string;
    };

    expect(api.analystMissingCopy("time")).toBe("time not stored");
    expect(api.analystMissingCopy("tx")).toBe("tx hash not stored");
    expect(api.analystMissingCopy("amount")).toBe("amount not stored");
    expect(api.analystMissingCopy("coverage")).toBe("coverage not available");
    expect(api.analystMissingCopy()).toBe("not stored");

    expect(api.analystEvidenceKind({ metadata: { evidenceType: "grouped_transfers" } })).toBe("Grouped transfers");
    expect(api.analystEvidenceKind({ metadata: { evidenceType: "contract_driven_transfer", underlyingTransfers: [{}, {}] } })).toBe("Contract-driven movement");
    expect(api.analystEvidenceKind({ metadata: { evidenceType: "approval_drain_transfer", underlyingTransfers: [{}, {}] } })).toBe("Contract-driven movement");
    expect(api.analystEvidenceKind({ metadata: { evidenceType: "profile_context" } })).toBe("Context evidence");
    expect(api.analystEvidenceKind({ metadata: { evidenceType: "contract_trigger_context" } })).toBe("Contract context");
    expect(api.analystEvidenceKind({ metadata: { evidenceType: "approval_drain_contract_call" } })).toBe("Contract context");
    expect(api.analystEvidenceKind({ metadata: { evidenceType: "approval_drain_spender_authority" } })).toBe("Contract context");
    expect(api.analystEvidenceKind({ type: "service_boundary", metadata: { evidenceType: "boundary_context" } })).toBe("Service or boundary exposure");

    expect(api.analystEvidenceMeaning({ metadata: { evidenceType: "grouped_transfers" } })).toContain("summarized into one edge");
    expect(api.analystEvidenceMeaning({ metadata: { evidenceType: "contract_driven_transfer", underlyingTransfers: [{}, {}] } })).toContain("smart-contract-driven transfer");
    expect(api.analystEvidenceMeaning({ metadata: { evidenceType: "approval_drain_transfer", underlyingTransfers: [{}, {}] } })).toContain("smart-contract-driven transfer");
    expect(api.analystEvidenceMeaning({ metadata: { evidenceType: "profile_context" } })).toContain("not a direct money-flow claim");
    expect(api.analystEvidenceMeaning({ metadata: { evidenceType: "contract_trigger_context" } })).toContain("smart-contract call context");
    expect(api.analystEvidenceMeaning({ metadata: { evidenceType: "approval_drain_contract_call" } })).toContain("smart-contract call context");
    expect(api.analystEvidenceMeaning({ metadata: { evidenceType: "approval_drain_spender_authority" } })).toContain("smart-contract call context");
    expect(api.analystEvidenceBadgeClass({ metadata: { evidenceType: "contract_driven_transfer", underlyingTransfers: [{}, {}] } })).toBe("contract");
    expect(api.analystEvidenceBadgeClass({ metadata: { evidenceType: "approval_drain_transfer", underlyingTransfers: [{}, {}] } })).toBe("contract");
    expect(api.analystEvidenceBadgeClass({ metadata: { evidenceType: "grouped_transfers" } })).toBe("grouped");
  });

  it("builds selected-flow review rows oldest first and groups them by day", () => {
    const html = adminConsoleHtml();
    const helperBlock = html.slice(
      html.indexOf("function selectedFlowTransferRows"),
      html.indexOf("function cardLine(")
    );

    expect(helperBlock).toContain("function selectedFlowTransferRows");
    expect(helperBlock).toContain("function selectedFlowDayGroups");
    expect(helperBlock).toContain("function selectedFlowHeaderModel");

    const api = new Function(`
      const canvasMonthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      function asArray(value) { return Array.isArray(value) ? value : []; }
      function escapeHtml(value) { return String(value ?? ""); }
      function short(value, size = 6) { const text = String(value ?? ""); return text.length > size * 2 + 3 ? text.slice(0, size) + "..." + text.slice(-size) : text; }
      function canvasTimestampLabel(value) {
        if (!value) return "";
        const date = new Date(value);
        if (!Number.isFinite(date.getTime())) return "";
        const day = String(date.getUTCDate()).padStart(2, "0");
        const hour = String(date.getUTCHours()).padStart(2, "0");
        const minute = String(date.getUTCMinutes()).padStart(2, "0");
        return canvasMonthNames[date.getUTCMonth()] + " " + day + ", " + hour + ":" + minute;
      }
      function formatRawUsdt(value) { return value ? String(Number(value) / 1000000).replace(/\\.0$/, "") + " USDT" : ""; }
      function edgeDetailedAmountLabel() { return ""; }
      function edgeCanvasAmountLabel() { return ""; }
      function edgeAggregateAmountLabel(edge) { return edge?.metadata?.aggregateAmountFormatted || ""; }
      function edgeAggregateTransferCount(edge) { return edge?.metadata?.aggregateTransferCount || edge?.metadata?.txCount || null; }
      function edgeTxHashes(edge) { return edge?.metadata?.txHashes || []; }
      function edgeTime(edge) { return edge?.timestamp || edge?.metadata?.lastSeen || ""; }
      function edgeFlowDirection() { return "outgoing"; }
      function edgeEvidenceType(edge) { return edge?.metadata?.evidenceType || "direct_transfer"; }
      function edgeFromAddress(edge) { return edge?.fromAddress || "TFrom111111111111111111111111111111"; }
      function edgeToAddress(edge) { return edge?.toAddress || "TTo111111111111111111111111111111"; }
      function edgeTxGap() { return ""; }
      function nodeById() { return null; }
      function nodeAddress() { return ""; }
      function nodeDisplayLabel() { return ""; }
      function nodeDisplayKind() { return "wallet"; }
      function nodeIsServiceLike() { return false; }
      function graphAddressFromNodeId(value) { return String(value || "").startsWith("addr:") ? String(value).slice(5) : ""; }
      ${helperBlock}
      return { selectedFlowTransferRows, selectedFlowDayGroups, selectedFlowHeaderModel, selectedFlowAction };
    `)() as {
      selectedFlowTransferRows(edge: any): Array<{
        txHash: string;
        amount: string;
        timeLabel: string;
        timestampMs: number;
        dayKey: string;
        action: { label: string; quiet: boolean; meaningful: boolean; raw?: string };
        aggregateOnly?: boolean;
        hashOnly?: boolean;
      }>;
      selectedFlowDayGroups(rows: Array<{ dayKey: string; amountRaw?: string }>): Array<{ dayKey: string; rows: unknown[] }>;
      selectedFlowHeaderModel(edge: any, rows: unknown[]): {
        title: string;
        timeLine: string;
        countLabel: string;
        amountLabel: string;
        directionLabel: string;
        timeRange: string;
        aggregateOnly: boolean;
        txHashes: string[];
        hashes: string[];
      };
      selectedFlowAction(transfer: any, edge: any): { label: string; quiet: boolean; meaningful: boolean };
    };

    const edge = {
      metadata: {
        evidenceType: "grouped_transfers",
        aggregateAmountFormatted: "2.04M USDT",
        aggregateTransferCount: 3,
        underlyingTransfers: [
          { amountRaw: "2000000", fullTime: "2026-07-01T14:20:00.000Z", fromAddress: "TFromA", toAddress: "TToA", txHash: "tx-new", method: "transfer" },
          { amountRaw: "500000000000", blockTime: "2026-06-24T15:08:00.000Z", fromAddress: "TFromA", toAddress: "TToA", txHash: "tx-old", method: "Approval" },
          { amountRaw: "1000000", createdAt: "2026-06-24T16:00:00.000Z", fromAddress: "TFromA", toAddress: "TToA", txHash: "tx-mid" },
          { amountRaw: "3000000", fromAddress: "TFromA", toAddress: "TToA", txHash: "tx-edge-time" }
        ]
      },
      timestamp: "2026-06-25T10:30:00.000Z"
    };

    const rows = api.selectedFlowTransferRows(edge);
    expect(rows.map((row) => row.txHash)).toEqual(["tx-old", "tx-mid", "tx-new", "tx-edge-time"]);
    expect(rows.map((row) => row.dayKey)).toEqual(["2026-06-24", "2026-06-24", "2026-07-01", "time-unknown"]);
    expect(rows.find((row) => row.txHash === "tx-edge-time")).toMatchObject({
      timeLabel: "time unknown",
      dayKey: "time-unknown",
      timestampMs: Number.MAX_SAFE_INTEGER
    });
    expect(api.selectedFlowDayGroups(rows).map((group) => [group.dayKey, group.rows.length])).toEqual([
      ["2026-06-24", 2],
      ["2026-07-01", 1],
      ["time-unknown", 1]
    ]);
    expect(rows.find((row) => row.txHash === "tx-new")?.action).toEqual({ label: "Transfer", quiet: true, meaningful: false, raw: "transfer" });
    expect(rows[0].action.quiet).toBe(false);
    expect(rows[0].action.meaningful).toBe(true);
    expect(rows[0].action.label).toContain("Approval");
    expect(api.selectedFlowAction({ method: "sellGem(uint256)", result: "SUCCESS" }, edge)).toMatchObject({
      label: "Contract call: sellGem",
      quiet: false,
      meaningful: true
    });
    expect(api.selectedFlowAction({ method: "transfer", success: false }, edge)).toMatchObject({
      label: "Failed tx",
      quiet: false,
      meaningful: true
    });

    const header = api.selectedFlowHeaderModel(edge, rows);
    expect(header.countLabel).toContain("4 tx");
    expect(header.countLabel).toContain("mixed actions");
    expect(header.amountLabel).toBe("2.04M USDT");
    expect(header.directionLabel).toBe("Outgoing");
    expect(header.timeRange).toBe("Jun 24, 15:08 -> Jul 01, 14:20");
    expect(header.aggregateOnly).toBe(false);
    expect(header.title).toContain("4 tx");
    expect(header.title).toContain("2.04M USDT");
    expect(header.timeLine).toContain("Outgoing");
    expect(header.timeLine).toContain("Jun 24, 15:08 -> Jul 01, 14:20");

    const aggregateEdge = {
      fromAddress: "TAggregateFrom",
      toAddress: "TAggregateTo",
      timestamp: "2026-06-26T08:00:00.000Z",
      metadata: {
        evidenceType: "grouped_transfers",
        aggregateAmountFormatted: "9 USDT",
        aggregateTransferCount: 2,
        txHashes: ["hash-a", "hash-b"]
      }
    };
    const aggregateRows = api.selectedFlowTransferRows(aggregateEdge);
    expect(aggregateRows).toEqual([]);
    const aggregateHeader = api.selectedFlowHeaderModel(aggregateEdge, aggregateRows);
    expect(aggregateHeader).toMatchObject({
      countLabel: "2 transfers",
      amountLabel: "9 USDT",
      directionLabel: "Outgoing",
      timeRange: "Jun 26, 08:00",
      aggregateOnly: true,
      txHashes: ["hash-a", "hash-b"],
      hashes: ["hash-a", "hash-b"]
    });

    const fallbackEdge = {
      metadata: {
        evidenceType: "grouped_transfers",
        underlyingTransfers: [
          { amountRaw: "2000000", timestamp: "2026-06-24T15:08:00.000Z", txHash: "fallback-a" },
          { amountRaw: "3000000", timestamp: "2026-06-24T16:08:00.000Z", txHash: "fallback-b" },
          { amountRaw: "not-numeric", timestamp: "2026-06-24T17:08:00.000Z", txHash: "fallback-c" }
        ]
      }
    };
    const fallbackRows = api.selectedFlowTransferRows(fallbackEdge);
    expect(api.selectedFlowHeaderModel(fallbackEdge, fallbackRows).amountLabel).toBe("5 USDT");
    expect(html.match(/function transferTimestampMs/g) ?? []).toHaveLength(1);
    expect(helperBlock).toContain("function selectedFlowTimestampMs");
    expect(helperBlock).not.toContain("function transferTimestampMs");
  });

  it("formats selected-flow entities label-first", () => {
    const html = adminConsoleHtml();
    const helperBlock = html.slice(
      html.indexOf("function selectedFlowTransferRows"),
      html.indexOf("function cardLine(")
    );
    const nodes = new Map<string, any>();
    nodes.set("subject", { id: "subject", kind: "subject", address: "TSubjectWallet11111111111111111111111" });
    nodes.set("contract", { id: "contract", kind: "contract", address: "TContractWallet111111111111111111111" });
    nodes.set("kucoin", {
      id: "kucoin",
      displayKind: "cex",
      address: "TKuCoinWallet1111111111111111111111",
      metadata: { boundaryIdentity: { displayName: "KuCoin", categoryLabel: "CEX" } }
    });

    const api = new Function("nodes", `
      function asArray(value) { return Array.isArray(value) ? value : []; }
      function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
      function short(value, size = 6) { const text = String(value ?? ""); return text.length > size * 2 + 3 ? text.slice(0, size) + "..." + text.slice(-size) : text; }
      const tronscanAddressUrl = (address) => address && String(address).startsWith("T") ? "https://tronscan.org/#/address/" + encodeURIComponent(address) : "";
      function explorerLink(href, label) { return href ? '<a href="' + escapeHtml(href) + '">' + escapeHtml(label) + '</a>' : escapeHtml(label); }
      function graphAddressFromNodeId(value) { return String(value || "").startsWith("addr:") ? String(value).slice(5) : ""; }
      function nodeById(nodeId) { return nodes.get(nodeId) || null; }
      function nodeAddress(node) { return node?.address || graphAddressFromNodeId(node?.id) || ""; }
      function nodeDisplayKind(node) {
        if (!node) return "wallet";
        if (node.displayKind) return node.displayKind;
        if (node.kind === "subject") return "subject_wallet";
        if (node.kind === "contract") return "smart_contract";
        return node.kind || "wallet";
      }
      function nodeDisplayLabel(node) { return node?.metadata?.boundaryIdentity?.displayName || node?.displayLabel || node?.label || node?.address || node?.id || ""; }
      function nodeIsServiceLike(node) { return ["bridge", "cex", "smart_contract", "contract_adapter", "contract_router", "dex_contract", "service_boundary"].includes(nodeDisplayKind(node)); }
      function boundaryIdentityCategoryLabel(node) { return node?.metadata?.boundaryIdentity?.categoryLabel || node?.metadata?.boundaryCategoryLabel || ""; }
      ${helperBlock}
      return { selectedFlowEntityLabel, selectedFlowEntityHtml };
    `)(nodes) as {
      selectedFlowEntityLabel(nodeId: string, address: string, side?: string): { primary: string; secondary: string; address: string };
      selectedFlowEntityHtml(nodeId: string, address: string, side?: string): string;
    };

    expect(api.selectedFlowEntityLabel("kucoin", "TKuCoinWallet1111111111111111111111")).toMatchObject({
      primary: "KuCoin",
      secondary: "CEX · TKuCoin...1111111"
    });
    expect(api.selectedFlowEntityLabel("subject", "TSubjectWallet11111111111111111111111")).toMatchObject({
      primary: "Subject wallet",
      secondary: "TSubjec...1111111"
    });
    expect(api.selectedFlowEntityLabel("contract", "TContractWallet111111111111111111111")).toMatchObject({
      primary: "Contract",
      secondary: "TContra...1111111"
    });
    expect(api.selectedFlowEntityLabel("", "TFallbackWallet111111111111111111111")).toMatchObject({
      primary: "TFallba...1111111",
      secondary: ""
    });
    expect(api.selectedFlowEntityHtml("kucoin", "TKuCoinWallet1111111111111111111111")).toContain("https://tronscan.org/#/address/TKuCoinWallet1111111111111111111111");
  });

  it("renders selected flow as transaction review", () => {
    const html = adminConsoleHtml();
    const helperBlock = html.slice(
      html.indexOf("function selectedFlowTransferRows"),
      html.indexOf("function cardLine(")
    );
    const selectedEdgeCardBlock = html.slice(html.indexOf("function selectedEdgeCard"), html.indexOf("function renderSelectionCard"));

    expect(html).toContain("function selectedFlowHeaderHtml");
    expect(html).toContain("function selectedFlowTransactionListHtml");
    expect(html).toContain("function selectedFlowTxRowHtml");
    expect(selectedEdgeCardBlock).toContain("const rows = selectedFlowTransferRows(edge);");
    expect(selectedEdgeCardBlock).toContain("selectedFlowHeaderHtml(edge, rows)");
    expect(selectedEdgeCardBlock).toContain("selectedFlowPrimaryBodyHtml(edge, rows)");
    expect(selectedEdgeCardBlock).toContain("selectedFlowDebugHtml(edge, rows)");
    expect(selectedEdgeCardBlock).not.toContain('analystIntroBlock("What this means"');
    expect(selectedEdgeCardBlock).not.toContain('cardLine("Evidence type"');
    expect(selectedEdgeCardBlock).not.toContain('cardLine("Meaning"');
    expect(selectedEdgeCardBlock).not.toContain('cardLine("Direction"');
    expect(selectedEdgeCardBlock).not.toContain('analystRawFactsBlock("Raw facts"');

    const api = new Function(`
      const canvasMonthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      function asArray(value) { return Array.isArray(value) ? value : []; }
      function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
      function short(value, size = 6) { const text = String(value ?? ""); return text.length > size * 2 + 3 ? text.slice(0, size) + "..." + text.slice(-size) : text; }
      function canvasTimestampLabel(value) {
        if (!value) return "";
        const date = new Date(value);
        if (!Number.isFinite(date.getTime())) return "";
        const day = String(date.getUTCDate()).padStart(2, "0");
        const hour = String(date.getUTCHours()).padStart(2, "0");
        const minute = String(date.getUTCMinutes()).padStart(2, "0");
        return canvasMonthNames[date.getUTCMonth()] + " " + day + ", " + hour + ":" + minute;
      }
      function formatRawUsdt(value) { return value ? String(Number(value) / 1000000).replace(/\\.0$/, "") + " USDT" : ""; }
      const tronscanTxUrl = (txHash) => txHash ? "https://tronscan.org/#/transaction/" + encodeURIComponent(txHash) : "";
      function txHashLinksHtml(txHashes) { return txHashes.map((hash) => '<a href="' + escapeHtml(tronscanTxUrl(hash)) + '">' + escapeHtml(hash) + '</a>').join(", "); }
      function edgeDetailedAmountLabel() { return ""; }
      function edgeCanvasAmountLabel() { return ""; }
      function edgeAggregateAmountLabel() { return ""; }
      function edgeAggregateTransferCount() { return null; }
      function edgeTxHashes(edge) { return edge?.metadata?.txHashes || []; }
      function edgeTime(edge) { return edge?.timestamp || ""; }
      function edgeFlowDirection() { return "outgoing"; }
      function edgeEvidenceType(edge) { return edge?.metadata?.evidenceType || "direct_transfer"; }
      function edgeFromAddress(edge) { return edge?.fromAddress || "TFromFallback"; }
      function edgeToAddress(edge) { return edge?.toAddress || "TToFallback"; }
      function edgeEvidenceEndpoint(edge, side) { return side === "from" ? edgeFromAddress(edge) : edgeToAddress(edge); }
      const tronscanAddressUrl = (address) => address && String(address).startsWith("T") ? "https://tronscan.org/#/address/" + encodeURIComponent(address) : "";
      const explorerLink = (url, label) => url ? '<a class="link" data-explorer-link="true" href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(label) + '</a>' : escapeHtml(label);
      function graphAddressFromNodeId(value) { return String(value || "").startsWith("addr:") ? String(value).slice(5) : ""; }
      const nodeMap = new Map([
        ["subject", { id: "subject", kind: "subject", address: "TFromEdge" }],
        ["kucoin", { id: "kucoin", displayKind: "cex", address: "TToEdge", metadata: { boundaryIdentity: { displayName: "KuCoin", categoryLabel: "CEX" } } }],
        ["addr:TFromA", { id: "addr:TFromA", kind: "subject", address: "TFromA" }],
        ["addr:TToA", { id: "addr:TToA", displayKind: "cex", address: "TToA", metadata: { boundaryIdentity: { displayName: "KuCoin", categoryLabel: "CEX" } } }]
      ]);
      function nodeById(nodeId) { return nodeMap.get(nodeId) || null; }
      function nodeAddress(node) { return node?.address || graphAddressFromNodeId(node?.id) || ""; }
      function nodeDisplayKind(node) {
        if (!node) return "wallet";
        if (node.displayKind) return node.displayKind;
        if (node.kind === "subject") return "subject_wallet";
        return node?.kind || "wallet";
      }
      function nodeDisplayLabel(node) { return node?.metadata?.boundaryIdentity?.displayName || node?.displayLabel || node?.label || node?.address || node?.id || ""; }
      function nodeIsServiceLike(node) { return ["bridge", "cex", "smart_contract", "contract_adapter", "contract_router", "dex_contract", "service_boundary"].includes(nodeDisplayKind(node)); }
      function boundaryIdentityCategoryLabel(node) { return node?.metadata?.boundaryIdentity?.categoryLabel || node?.metadata?.boundaryCategoryLabel || ""; }
      ${helperBlock}
      return { selectedFlowTransferRows, selectedFlowHeaderHtml, selectedFlowTransactionListHtml, selectedFlowPrimaryBodyHtml, selectedFlowTxRowHtml };
    `)() as {
      selectedFlowTransferRows(edge: any): any[];
      selectedFlowHeaderHtml(edge: any, rows: any[]): string;
      selectedFlowTransactionListHtml(edge: any, rows: any[]): string;
      selectedFlowPrimaryBodyHtml(edge: any, rows: any[]): string;
      selectedFlowTxRowHtml(row: any): string;
    };

    const edge = {
      fromNodeId: "subject",
      toNodeId: "kucoin",
      fromAddress: "TFromEdge",
      toAddress: "TToEdge",
      metadata: {
        underlyingTransfers: [
          { amountRaw: "1000000", timestamp: "2026-06-24T15:08:00.000Z", fromAddress: "TFromA", toAddress: "TToA", txHash: "tx-action", method: "sellGem(uint256)" },
          { amountRaw: "2000000", timestamp: "2026-06-24T16:08:00.000Z", fromAddress: "TFromB", toAddress: "TToB", txHash: "tx-transfer", method: "transfer" }
        ]
      }
    };
    const rows = api.selectedFlowTransferRows(edge);
    const headerHtml = api.selectedFlowHeaderHtml(edge, rows);
    const listHtml = api.selectedFlowTransactionListHtml(edge, rows);
    const actionRowHtml = api.selectedFlowTxRowHtml(rows[0]);
    const transferRowHtml = api.selectedFlowTxRowHtml(rows[1]);
    const unknownTxHtml = api.selectedFlowTxRowHtml({ ...rows[1], txHash: "" });
    const aggregateOnlyHtml = api.selectedFlowPrimaryBodyHtml({
      metadata: { txHashes: ["hash-a", "hash-b"] },
      timestamp: "2026-06-26T08:00:00.000Z"
    }, []);

    expect(headerHtml).toContain("selected-flow-header");
    expect(headerHtml).toContain("2 tx");
    expect(headerHtml).toContain("Outgoing");
    expect(headerHtml).toContain("Jun 24, 15:08 -&gt; Jun 24, 16:08");
    expect(headerHtml).toContain("TFromEdge");
    expect(headerHtml).toContain("TToEdge");
    expect(headerHtml).toContain("entity-primary");
    expect(headerHtml).toContain("entity-secondary");
    expect(headerHtml).toContain("Subject wallet");
    expect(headerHtml).toContain("KuCoin");
    expect(headerHtml).toContain("CEX");
    expect(listHtml).toContain("selected-flow-day");
    expect(listHtml).toContain("Jun 24 · 2 tx · 3 USDT");
    expect(listHtml).toContain("selected-flow-tx-row");
    expect(actionRowHtml).toContain('<div class="selected-flow-tx-row is-clickable" role="link" tabindex="0" data-selected-flow-tx-url="https://tronscan.org/#/transaction/tx-action">');
    expect(actionRowHtml).not.toMatch(/^<a class="selected-flow-tx-row"/);
    expect(actionRowHtml).toContain('href="https://tronscan.org/#/transaction/tx-action"');
    expect(actionRowHtml).toContain('target="_blank"');
    expect(actionRowHtml).toContain('rel="noopener noreferrer"');
    expect(actionRowHtml).toContain("entity-primary");
    expect(actionRowHtml).toContain("Subject wallet");
    expect(actionRowHtml).toContain("KuCoin");
    expect(actionRowHtml).toContain("TFromA");
    expect(actionRowHtml).toContain("https://tronscan.org/#/address/TFromA");
    expect(actionRowHtml).toContain("Action:");
    expect(actionRowHtml).toContain("Contract call: sellGem");
    expect(transferRowHtml).not.toContain("Action:");
    expect(unknownTxHtml).toContain("tx unknown");
    expect(unknownTxHtml).not.toContain("https://tronscan.org/#/transaction/");
    expect(unknownTxHtml).not.toContain('data-selected-flow-tx-url=');
    expect(unknownTxHtml).not.toContain('role="link"');
    expect(unknownTxHtml).not.toContain('tabindex="0"');
    expect(aggregateOnlyHtml).toContain("Details not stored");
    expect(aggregateOnlyHtml).toContain("Rerun check to load per-tx details");
    expect(aggregateOnlyHtml).toContain("hash-a");
    expect(aggregateOnlyHtml).toContain("hash-b");
    expect(aggregateOnlyHtml).toContain("https://tronscan.org/#/transaction/hash-a");
    expect(aggregateOnlyHtml).not.toContain("selected-flow-tx-row");
    expect(html).toContain(".selected-flow-tx-row.is-clickable:hover");
    expect(html).toContain(".selected-flow-tx-row.is-clickable:focus");
    expect(html).not.toContain(".selected-flow-tx-row:hover");
    expect(html).not.toContain(".selected-flow-tx-row:focus-within");
    expect(html).not.toContain("a.selected-flow-tx-row:focus-visible");
    expect(html).toContain("function handleSelectedFlowTxRowClick(event)");
    expect(html).toContain("function handleSelectedFlowTxRowKeydown(event)");
    expect(html).toContain('target.closest("a, button');
    expect(html).toContain('window.open(url, "_blank", "noopener,noreferrer")');

    const manyRows = Array.from({ length: 101 }, (_, index) => ({
      amountRaw: "1000000",
      amount: "1 USDT",
      timeLabel: "Jun 24, 15:08",
      dayKey: "2026-06-24",
      fromAddress: "TFromA",
      toAddress: "TToA",
      txHash: "tx-" + index,
      action: { meaningful: false, quiet: true, label: "Transfer" }
    }));
    const cappedHtml = api.selectedFlowTransactionListHtml({ id: "edge-1" }, manyRows);
    expect(cappedHtml).toContain("Showing first 100 of 101 tx");
    expect(cappedHtml).toContain("Show all");
    expect((cappedHtml.match(/selected-flow-tx-row/g) || []).length).toBe(100);
  });

  it("aggregate-only selected flow shows rerun copy and collapsed debug", () => {
    const html = adminConsoleHtml();
    const helperBlock = html.slice(
      html.indexOf("function selectedFlowTransferRows"),
      html.indexOf("function cardLine(")
    );
    const selectedEdgeCardBlock = html.slice(html.indexOf("function selectedEdgeCard"), html.indexOf("function renderSelectionCard"));

    expect(selectedEdgeCardBlock).toContain("selectedFlowPrimaryBodyHtml(edge, rows)");
    expect(selectedEdgeCardBlock).toContain("selectedFlowDebugHtml(edge, rows)");

    const api = new Function(`
      const canvasMonthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      function asArray(value) { return Array.isArray(value) ? value : []; }
      function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
      function short(value, size = 6) { const text = String(value ?? ""); return text.length > size * 2 + 3 ? text.slice(0, size) + "..." + text.slice(-size) : text; }
      function canvasTimestampLabel() { return ""; }
      function formatRawUsdt(value) { return value ? String(Number(value) / 1000000).replace(/\\.0$/, "") + " USDT" : ""; }
      const tronscanTxUrl = (txHash) => txHash ? "https://tronscan.org/#/transaction/" + encodeURIComponent(txHash) : "";
      function explorerLink(href, label) { return '<a href="' + escapeHtml(href) + '" data-explorer-link>' + escapeHtml(label) + '</a>'; }
      function txHashLinksHtml(txHashes, limit = 80) { return '<div class="tx-links">' + txHashes.slice(0, limit).map((hash) => '<span class="tx-chip">' + explorerLink(tronscanTxUrl(hash), short(hash, 8)) + '</span>').join("") + '</div>'; }
      function edgeDetailedAmountLabel() { return ""; }
      function edgeCanvasAmountLabel() { return ""; }
      function edgeAggregateAmountLabel() { return ""; }
      function edgeAggregateTransferCount() { return null; }
      function edgeTxHashes(edge) { return edge?.metadata?.txHashes || []; }
      function edgeTime(edge) { return edge?.timestamp || ""; }
      function edgeFlowDirection() { return "outgoing"; }
      function edgeEvidenceType(edge) { return edge?.metadata?.evidenceType || "grouped_transfers"; }
      function edgeDisplayRole(edge) { return edge?.metadata?.displayRole || "real_transfer"; }
      function edgePathId(edge) { return edge?.metadata?.pathId || ""; }
      function edgeFromAddress(edge) { return edge?.fromAddress || "TFromFallback"; }
      function edgeToAddress(edge) { return edge?.toAddress || "TToFallback"; }
      function edgeEvidenceEndpoint(edge, side) { return side === "from" ? edgeFromAddress(edge) : edgeToAddress(edge); }
      function analystEvidenceMeaning(edge) { return edge?.metadata?.meaning || "Several real transfers are summarized into one edge."; }
      ${helperBlock}
      return { selectedFlowTransferRows, selectedFlowAggregateOnlyHtml, selectedFlowPrimaryBodyHtml, selectedFlowDebugHtml };
    `)() as {
      selectedFlowTransferRows(edge: any): any[];
      selectedFlowAggregateOnlyHtml(edge: any): string;
      selectedFlowPrimaryBodyHtml(edge: any, rows: any[]): string;
      selectedFlowDebugHtml(edge: any, rows: any[]): string;
    };

    const edge = {
      id: "edge-aggregate",
      fromAddress: "TFromEdge",
      toAddress: "TToEdge",
      metadata: {
        evidenceType: "grouped_transfers",
        displayRole: "real_transfer",
        pathId: "path:direct_counterparty:8",
        source: "saved_graph",
        txHashes: ["hash-a", "hash-b"]
      }
    };
    const rows = api.selectedFlowTransferRows(edge);
    const primaryHtml = api.selectedFlowPrimaryBodyHtml(edge, rows);
    const debugHtml = api.selectedFlowDebugHtml(edge, rows);

    expect(primaryHtml).toContain("Details not stored");
    expect(primaryHtml).toContain("Rerun check to load per-tx details");
    expect(primaryHtml).toContain("This saved graph has tx hashes and total amount, but no per-tx rows.");
    expect(primaryHtml).toContain("hash-a");
    expect(primaryHtml).toContain("hash-b");
    expect(primaryHtml).toContain("https://tronscan.org/#/transaction/hash-a");
    expect(primaryHtml).not.toContain("selected-flow-tx-row");
    expect(primaryHtml).not.toContain("path:direct_counterparty:8");

    expect(debugHtml).toContain("<details");
    expect(debugHtml).toContain("<summary>Debug</summary>");
    expect(debugHtml).toContain("Path");
    expect(debugHtml).toContain("path:direct_counterparty:8");
    expect(debugHtml).toContain("Stored tx hashes count");
    expect(debugHtml).toContain(">2<");
    expect(debugHtml).toContain("Source");
    expect(debugHtml).toContain("saved_graph");
    expect(debugHtml).toContain("Risk scope");
    expect(debugHtml).toContain("not evaluated for this flow");
    expect(debugHtml).toContain("Copy edge id");
    expect(debugHtml).toContain("Copy raw JSON");

    expect(html).toContain("[data-copy-text]");
    expect(html).toContain("navigator.clipboard.writeText");
  });

  it("keeps desktop graph toolbar compact and stacks only on narrow screens", () => {
    const html = adminConsoleHtml();

    expect(html).not.toContain("@media (max-width: 1440px)");
    expect(html).toContain("@media (max-width: 1180px)");
    expect(html).toContain(`@media (max-width: 1680px) {
      .graph-action-row { gap: 6px; padding: 4px 6px; }
      .graph-control-group { gap: 5px; flex-wrap: wrap; }
      .graph-action-row button, .graph-action-row select { padding: 0 7px; flex: 0 0 auto; }
      .graph-action-row #txLabelMode { width: 160px; }
      .graph-action-row #walletLabelMode { width: 180px; }
      .graph-action-row #flowMode { width: 120px; }
      .graph-action-row .graph-meta .chip { padding: 3px 6px; font-size: 11px; }
    }`);
    expect(html).toContain(`@media (max-width: 1560px) {
      .graph-action-row {
        grid-template-columns: minmax(0, 1fr);
      }
      .graph-control-group { flex-wrap: wrap; }
      .graph-action-row .graph-meta {
        grid-column: 1;
        justify-content: flex-start;
        flex-wrap: wrap;
      }
    }`);
    expect(html).not.toContain(`@media (max-width: 1680px) {
      .graph-action-row {
        grid-template-columns: minmax(0, 1fr);
      }`);
    expect(html).toContain(".overlay-panel.jobs-panel { left: 12px; width: var(--left-rail-width); }");
    expect(html).toContain(".overlay-panel.analytics-panel { right: 12px; width: var(--right-rail-width); }");
    expect(html).toContain('const statLabel = (value, label) => value + " " + label + (value === 1 ? "" : "s");');
    expect(html).toContain("const graphStatsText = [");
    expect(html).not.toContain(".graph-action-row #amountMode");
    expect(html).toContain('const graphStatsTitle = [');
    expect(html).toContain('"N" + placed.nodes.length');
    expect(html).toContain('"W" + graphWeights(graph).length');
    expect(html).toContain('title="\' + escapeHtml(graphStatsTitle) + \'"');
    expect(html).toContain(".graph-stage {\n      position: absolute;\n      top: 184px;");
    expect(html).toContain("right: calc(var(--right-rail-width) + 24px);\n      bottom: 164px;\n      left: calc(var(--left-rail-width) + 24px);");
    expect(html).toContain(".timeline-panel {\n      position: absolute;\n      left: calc(var(--left-rail-width) + 24px);");
    expect(html).toContain(".transfer-panel {\n      position: absolute;\n      left: calc(var(--left-rail-width) + 24px);");
    expect(html).toContain(".graph-action-row {\n        top: 128px;");
    expect(html).toContain(".graph-stage { top: 224px; left: 12px; right: 12px; }");
    expect(html).toContain(".timeline-panel, .transfer-panel {\n        left: 12px;\n        right: 12px;\n      }");
    expect(html).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(html).toContain(".graph-control-group { flex-wrap: wrap; }");
    expect(html).toContain(".overlay-panel { top: 224px; max-height: 360px; }");
    expect(html).toContain(".overlay-panel.analytics-panel { left: 12px; right: auto; }");
    expect(html).toContain(".overlay-panel.analytics-panel { top: calc(224px + 372px); }");
    expect(html).toContain('class="overlay-body analytics-body"');
    expect(html).toContain('class="selection-card analytics-selection-card" id="selectionCard"');
  });

  it("keeps graph stats and legend from overlapping topbar controls", () => {
    const html = adminConsoleHtml();
    const actionRowCss = html.slice(html.indexOf(".graph-action-row {"), html.indexOf(".overlay-panel {"));
    const renderBlock = html.slice(html.indexOf("function renderGraph"), html.indexOf("function isCollapsedGroupNodeId"));

    expect(html).toContain('<div id="graphStats" class="graph-meta"></div>');
    expect(html).toContain('<div id="graphLegend" class="graph-legend"></div>');
    expect(actionRowCss).toContain(".graph-control-group");
    expect(actionRowCss).toContain("min-width: 0;");
    expect(actionRowCss).toContain("flex-wrap: wrap;");
    expect(actionRowCss).toContain("max-height: 108px;");
    expect(actionRowCss).toContain("overflow-y: auto;");
    expect(actionRowCss).toContain(".graph-action-row .graph-legend {");
    expect(actionRowCss).toContain(".graph-action-row .graph-legend:empty { display: none; }");
    expect(html).toContain("@media (max-width: 1280px)");
    expect(html).toContain(".graph-action-row .graph-meta,\n      .graph-action-row .graph-legend");
    expect(html).toContain("@media (max-width: 1180px)");
    expect(html).toContain("max-height: 84px;");
    expect(renderBlock).toContain('el("graphStats").innerHTML = "";');
    expect(renderBlock).toContain('el("graphLegend").innerHTML = "";');
    expect(renderBlock).toContain('el("graphStats").innerHTML = \'<span class="chip"');
    expect(renderBlock).toContain('el("graphLegend").innerHTML = graphLegendHtml(presentation.mode);');
  });

  it("keeps selected details inside the analytics rail", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("analytics-selection-card");
    expect(html).toContain('<div class="selection-card analytics-selection-card" id="selectionCard"></div>');
    expect(html).toContain(".analytics-selection-card {");
    expect(html).toContain(".analytics-selection-card.open { display: block;");
    expect(html).toContain(".selection-card .card-line strong { min-width: 0; text-align: right; overflow-wrap: anywhere; }");
    expect(html).not.toContain("right: 82px;");
    expect(html).not.toContain("top: 112px;");
    expect(html).not.toContain("max-height: calc(100dvh - 330px)");
  });

  it("contains dense graph fan controls and peer-link state", () => {
    const html = adminConsoleHtml();

    expect(html).toContain('id="densityMode"');
    expect(html).toContain('id="peerLinksMode"');
    expect(html).toContain('id="roleMarksMode"');
    expect(html).toContain("densityMode: initialGraphViewMode()");
    expect(html).toContain("peerLinksVisible: localStorage.getItem(\"adminForensicsPeerLinks\") !== \"off\"");
    expect(html).toContain("roleMarksVisible: localStorage.getItem(\"adminForensicsRoleMarks\") !== \"off\"");
    expect(html).toContain("function setDensityMode");
    expect(html).toContain("function syncDenseGraphControls");
    expect(html).toContain('el("densityMode").addEventListener("click", () => {');
    expect(html).toContain('el("peerLinksMode").addEventListener("click", () => {');
    expect(html).toContain('el("roleMarksMode").addEventListener("click", () => {');
    expect(html).toContain('localStorage.setItem("adminForensicsGraphViewMode", state.densityMode);');
    expect(html).toContain('localStorage.setItem("adminForensicsPeerLinks", state.peerLinksVisible ? "on" : "off");');
    expect(html).toContain('localStorage.setItem("adminForensicsRoleMarks", state.roleMarksVisible ? "on" : "off");');
  });

  it("renders node intelligence role marks inside graph nodes by default", () => {
    const html = adminConsoleHtml();
    const renderBlock = html.slice(html.indexOf("function renderGraph"), html.indexOf("function isCollapsedGroupNodeId"));

    expect(html).toContain("function nodeRoleMarkSvg");
    expect(html).toContain(".node-role-drainer .role-chip");
    expect(html).toContain("/admin/assets/node-role/drainer.png");
    expect(html).toContain("/admin/assets/node-role/victim.png");
    expect(html).toContain("/admin/assets/node-role/mule-transit.png");
    expect(html).toContain("/admin/assets/node-role/collector.png");
    expect(html).toContain(".node-role-victim");
    expect(html).toContain(".node-role-mule_transit .role-chip");
    expect(html).toContain(".node-role-collector .role-chip");
    expect(renderBlock).toContain("nodeRoleMarkSvg(node, radius)");
    expect(renderBlock).toContain("role-marked node-role-");
  });

  it("renders local wallet profile explanations without implying clean missing data", () => {
    const html = adminConsoleHtml();
    const walletBlock = html.slice(html.indexOf("function localWalletProfile"), html.indexOf("function traceStopReasonCode"));

    expect(html).toContain("function localWalletProfileBlock");
    expect(walletBlock).toContain("Local wallet profile");
    expect(walletBlock).toContain("Connected by the observed graph; no local risk evidence is stored for this wallet.");
    expect(walletBlock).toContain("No local risk evidence is stored for this wallet.");
    expect(walletBlock).toContain("Source mode");
    expect(walletBlock).toContain("observed graph");
    expect(html).toContain("localWalletProfileBlock(node)");
  });

  it("renders drainer campaign evidence in selected node details", () => {
    const html = adminConsoleHtml();
    const campaignBlock = html.slice(html.indexOf("function drainerCampaignBlock"), html.indexOf("function traceStopReasonCode"));

    expect(html).toContain("function drainerCampaignBlock");
    expect(campaignBlock).toContain("Drainer campaign evidence");
    expect(campaignBlock).toContain("Contract-driven transfers");
    expect(campaignBlock).toContain("Victims");
    expect(campaignBlock).toContain("Spender contracts");
    expect(campaignBlock).toContain("Drain txs");
    expect(html).toContain("drainerCampaignBlock(node)");
  });

  it("renders deep-check transaction and wallet label controls", () => {
    const html = adminConsoleHtml();

    expect(html).toContain('<select id="txLabelMode">');
    expect(html).toContain('<option value="auto">Tx labels: auto</option>');
    expect(html).toContain('<option value="all">Tx labels: all</option>');
    expect(html).toContain('<option value="important">Tx labels: important</option>');
    expect(html).toContain('<option value="selected">Tx labels: selected</option>');
    expect(html).toContain('<option value="off">Tx labels: off</option>');
    expect(html).toContain('<select id="walletLabelMode">');
    expect(html).toContain('<option value="smart">Wallet labels: smart</option>');
    expect(html).toContain('<option value="all">Wallet labels: all</option>');
    expect(html).toContain('<option value="important">Wallet labels: important</option>');
    expect(html).toContain('<option value="off">Wallet labels: off</option>');
  });

  it("defaults deep-check services on and automatic transaction labels to all", () => {
    const html = adminConsoleHtml();
    const stateBlock = html.slice(html.indexOf("const state ="), html.indexOf("if (!"));
    const renderBlock = html.slice(html.indexOf("function renderGraph"), html.indexOf("function isCollapsedGroupNodeId"));

    expect(stateBlock).toContain('servicesVisible: localStorage.getItem("adminForensicsServices") !== "off"');
    expect(stateBlock).toContain('txLabelMode: localStorage.getItem("adminForensicsTxLabelMode") || localStorage.getItem("adminForensicsAmountMode") || "auto"');
    expect(stateBlock).toContain('walletLabelMode: localStorage.getItem("adminForensicsWalletLabelMode") || "smart"');
    expect(html).toContain("function effectiveTxLabelMode");
    expect(html).toContain('if (state.graph?.job?.kind === "address_deep_check" && state.txLabelMode === "auto") return "all";');
    expect(renderBlock).toContain("const txLabelMode = effectiveTxLabelMode();");
    expect(renderBlock).toContain("const labelEnabled = txLabelMode !== \"off\"");
    expect(renderBlock).toContain("const shouldShowTime = labelEnabled && edgeShouldShowCanvasTime(edge);");
  });

  it("keeps legacy amount label mode storage as tx label mode fallback", () => {
    const html = adminConsoleHtml();
    const stateBlock = html.slice(html.indexOf("const state ="), html.indexOf("if (!"));

    expect(stateBlock).toContain('txLabelMode: localStorage.getItem("adminForensicsTxLabelMode") || localStorage.getItem("adminForensicsAmountMode") || "auto"');
    expect(html).toContain('if (!["auto", "all", "important", "selected", "off"].includes(state.txLabelMode)) state.txLabelMode = "auto";');
  });

  it("does not show missing amount fallback for important transaction labels", () => {
    const html = adminConsoleHtml();
    const renderBlock = html.slice(html.indexOf("function renderGraph"), html.indexOf("function isCollapsedGroupNodeId"));
    const amountBlock = html.slice(html.indexOf("function edgeAmount"), html.indexOf("function edgeShouldShowAmount"));
    const showBlock = html.slice(html.indexOf("function edgeShouldShowAmount"), html.indexOf("function edgeShouldShowCanvasTime"));
    const labelApi = new Function(
      "function pathForEdge() { return null; }" +
        "function formatRawUsdt() { return ''; }" +
        "function edgeDisplayRole(edge) { return edge?.displayRole || ''; }" +
        "function compactAmountLabel(label) { return label || ''; }" +
        "function asArray(value) { return Array.isArray(value) ? value : []; }" +
        amountBlock +
        showBlock +
        "return { edgeHasCanvasAmountLabel, edgeShouldShowImportantCanvasAmount, edgeCanvasAmountOrMissingLabel };",
    )();

    expect(html).toContain("function edgeHasCanvasAmountLabel");
    expect(html).toContain("function edgeShouldShowImportantCanvasAmount");
    expect(renderBlock).toContain('const importantLabel = txLabelMode === "important" && edgeShouldShowImportantCanvasAmount(edge);');
    expect(labelApi.edgeHasCanvasAmountLabel({ type: "transfer" })).toBe(false);
    expect(labelApi.edgeShouldShowImportantCanvasAmount({ type: "transfer" })).toBe(false);
    expect(labelApi.edgeCanvasAmountOrMissingLabel({ type: "transfer" })).toBe("amount n/a");
    expect(labelApi.edgeShouldShowImportantCanvasAmount({ type: "transfer", amountFormatted: "12 USDT" })).toBe(true);
  });

  it("keeps direct transfer missing amount label unchanged for ordinary transfers", () => {
    const html = adminConsoleHtml();
    const helperBlock = html.match(/function edgeCanvasAmountOrMissingLabel\(edge\) \{[\s\S]*?\n    \}(?=\n    function edgeCanvasTimeLabel)/)?.[0] || "";

    expect(helperBlock).not.toBe("");

    const api = new Function(
      "edgeBoundarySummaryLabel",
      "edgeAmount",
      "edgeContextCanvasLabel",
      "edgeCanvasLabel",
      "edgeEvidenceType",
      helperBlock + "\nreturn { edgeCanvasAmountOrMissingLabel };"
    )(
      () => "",
      () => "",
      () => "",
      () => "",
      () => ""
    ) as {
      edgeCanvasAmountOrMissingLabel(edge: unknown): string;
    };

    expect(api.edgeCanvasAmountOrMissingLabel({ type: "transfer", metadata: {} })).toBe("amount n/a");
  });

  it("labels boundary context with aggregate tx count and amount when available", () => {
    const html = adminConsoleHtml();
    const amountBlock = html.slice(html.indexOf("function edgeAmount"), html.indexOf("function edgeShouldShowAmount"));
    const labelApi = new Function(
      "function pathForEdge() { return null; }" +
        "function formatRawUsdt(value) { return value ? value + ' raw' : ''; }" +
        "function edgeDisplayRole(edge) { return edge?.displayRole || ''; }" +
        "function compactAmountLabel(label) { return label || ''; }" +
        "function asArray(value) { return Array.isArray(value) ? value : []; }" +
        amountBlock +
        "return { edgeContextCanvasLabel, edgeCanvasAmountOrMissingLabel };",
    )();

    expect(labelApi.edgeContextCanvasLabel({
      type: "service_boundary",
      metadata: { aggregateTransferCount: 2, aggregateAmountRaw: "350" }
    })).toBe("2 tx - 350 raw");
    expect(labelApi.edgeContextCanvasLabel({
      type: "service_boundary",
      metadata: { underlyingTransfers: [{}, {}] }
    })).toBe("2 tx");
    expect(labelApi.edgeContextCanvasLabel({
      type: "transfer",
      metadata: {
        evidenceType: "grouped_transfers",
        aggregateTransferCount: 2,
        aggregateAmountRaw: "3000000000",
        underlyingTransfers: [{}, {}]
      }
    })).toBe("2 tx - 3000000000 raw");
    expect(labelApi.edgeContextCanvasLabel({
      type: "transfer",
      metadata: {
        evidenceType: "contract_driven_transfer",
        aggregateTransferCount: 3,
        aggregateAmountRaw: "6000000",
        underlyingTransfers: [{}, {}, {}]
      }
    })).toBe("3 tx - 6000000 raw");
    expect(labelApi.edgeCanvasAmountOrMissingLabel({
      type: "inferred_provenance",
      displayRole: "profile_context",
      amountRaw: "19020000000",
      metadata: {
        txCount: 5,
        underlyingTransfers: [{}, {}, {}, {}, {}]
      }
    })).toBe("5 tx - 19020000000 raw");
    expect(labelApi.edgeCanvasAmountOrMissingLabel({
      type: "service_boundary",
      metadata: { evidenceType: "boundary_context" }
    })).toBe("Investigation boundary only. No money-flow edge is stored for this relationship.");
  });

  it("labels single service-boundary transfers like ordinary transfers", () => {
    const html = adminConsoleHtml();
    const amountBlockStart = html.indexOf("function edgeAmount");
    const amountBlock = html.slice(amountBlockStart, html.indexOf("function edgeTime", amountBlockStart));
    const boundaryHelpers = html.match(/function boundaryIdentityOf\(value\) \{[\s\S]*?\n    \}(?=\n    function nodeDisplayKind)/)?.[0] || "";

    expect(amountBlock).not.toBe("");
    expect(boundaryHelpers).not.toBe("");

    const api = new Function(
      "pathForEdge",
      "formatRawUsdt",
      "compactAmountLabel",
      "asArray",
      "edgeDisplayRole",
      boundaryHelpers + "\n" + amountBlock + "\nreturn { edgeCanvasAmountOrMissingLabel };"
    )(
      () => null,
      (value: unknown) => value === "1000000000" ? "1K USDT" : "",
      (value: unknown) => value || "",
      (value: unknown) => Array.isArray(value) ? value : [],
      () => "profile_context"
    ) as {
      edgeCanvasAmountOrMissingLabel(edge: unknown): string;
    };

    const edge = {
      type: "service_boundary",
      txHash: "single-service-tx",
      amountRaw: "1000000000",
      metadata: {
        evidenceType: "boundary_context",
        aggregateAmountRaw: "1000000000",
        aggregateTransferCount: 1,
        boundaryIdentity: {
          displayName: "Bybit",
          category: "cex",
          categoryLabel: "CEX",
          confidence: "high",
          source: "known_cex_rule",
          evidence: ["identity:Bybit"],
          isBoundary: true
        }
      }
    };

    expect(api.edgeCanvasAmountOrMissingLabel(edge)).toBe("1K USDT");
    const directEdge = {
      type: "transfer",
      amountRaw: "1000000000",
      metadata: {
        source: "directCounterpartyInteractionProfile",
        underlyingTransfers: [{ txHash: "single-direct-tx" }]
      }
    };
    expect(api.edgeCanvasAmountOrMissingLabel(directEdge)).toBe("1K USDT");
    expect(api.edgeCanvasAmountOrMissingLabel(directEdge)).not.toContain("1 tx");
  });

  it("summarizes grouped boundary evidence with entity, tx count, and amount", () => {
    const html = adminConsoleHtml();
    const helperBlock = html.match(/function edgeCanvasAmountOrMissingLabel\(edge\) \{[\s\S]*?\n    \}(?=\n    function edgeCanvasTimeLabel)/)?.[0] || "";
    const boundaryHelpers = html.match(/function boundaryIdentityOf\(value\) \{[\s\S]*?\n    \}(?=\n    function nodeDisplayKind)/)?.[0] || "";

    expect(helperBlock).not.toBe("");
    expect(boundaryHelpers).not.toBe("");

    const api = new Function(
      "formatRawUsdt",
      boundaryHelpers + "\n" + helperBlock + "\nreturn { edgeCanvasAmountOrMissingLabel };"
    )(
      (value: unknown) => value === "332800000000"
        ? "332.8K USDT"
        : value === "1285313840000"
          ? "1.28M USDT"
          : ""
    ) as {
      edgeCanvasAmountOrMissingLabel(edge: unknown): string;
    };

    const edge = {
      type: "service_boundary",
      metadata: {
        evidenceType: "boundary_context",
        aggregateAmountRaw: "332800000000",
        aggregateTransferCount: 12,
        boundaryIdentity: {
          displayName: "Bybit",
          category: "cex",
          categoryLabel: "CEX",
          confidence: "high",
          source: "known_cex_rule",
          evidence: ["identity:Bybit"],
          isBoundary: true
        }
      }
    };

    expect(api.edgeCanvasAmountOrMissingLabel(edge)).toBe("Bybit - 12 tx - 332.8K USDT");
    expect(api.edgeCanvasAmountOrMissingLabel({
      type: "service_boundary",
      metadata: {
        evidenceType: "grouped_transfers",
        aggregateAmountRaw: "1285313840000",
        aggregateTransferCount: 8
      }
    })).toBe("8 tx - 1.28M USDT");
  });

  it("uses context-only copy for amount-only boundary context without tx evidence", () => {
    const html = adminConsoleHtml();
    const amountBlockStart = html.indexOf("function edgeAmount");
    const amountBlock = html.slice(amountBlockStart, html.indexOf("function edgeTime", amountBlockStart));
    const boundaryHelpers = html.match(/function boundaryIdentityOf\(value\) \{[\s\S]*?\n    \}(?=\n    function nodeDisplayKind)/)?.[0] || "";

    expect(amountBlock).not.toBe("");
    expect(boundaryHelpers).not.toBe("");

    const api = new Function(
      "pathForEdge",
      "formatRawUsdt",
      "compactAmountLabel",
      "asArray",
      "edgeDisplayRole",
      boundaryHelpers + "\n" + amountBlock + "\nreturn { edgeAmount, edgeOriginalAmount, edgeCanvasAmountOrMissingLabel, edgeCanvasLabel, edgeHasCanvasAmountLabel, edgeDetailedAmountLabel };"
    )(
      () => null,
      (value: unknown) => value === "25000000000" ? "25K USDT" : "",
      (value: unknown) => value || "",
      (value: unknown) => Array.isArray(value) ? value : [],
      () => "profile_context"
    ) as {
      edgeAmount(edge: unknown): string;
      edgeOriginalAmount(edge: unknown): string;
      edgeCanvasAmountOrMissingLabel(edge: unknown): string;
      edgeCanvasLabel(edge: unknown): string;
      edgeHasCanvasAmountLabel(edge: unknown): boolean;
      edgeDetailedAmountLabel(edge: unknown): string;
    };

    const edge = {
      type: "service_boundary",
      amountRaw: "25000000000",
      metadata: {
        evidenceType: "boundary_context",
        boundaryContextOnly: true,
        aggregateTransferCount: 1,
        aggregateAmountRaw: "25000000000",
        boundaryIdentity: {
          displayName: "Exchange",
          category: "cex",
          categoryLabel: "CEX",
          confidence: "high",
          source: "known_cex_rule",
          evidence: ["identity:Exchange"],
          isBoundary: true
        }
      }
    };

    const label = api.edgeCanvasAmountOrMissingLabel(edge);
    expect(label).toBe("Investigation boundary only. No money-flow edge is stored for this relationship.");
    expect(label).not.toContain("1 tx");
    expect(label).not.toContain("25K USDT");
    expect(api.edgeCanvasLabel(edge)).toBe("");
    expect(api.edgeHasCanvasAmountLabel(edge)).toBe(false);
    expect(api.edgeDetailedAmountLabel(edge)).toBe("");
    expect(api.edgeAmount(edge)).toBe("");
    expect(api.edgeOriginalAmount(edge)).toBe("");
  });

  it("keeps context-only boundary edges out of transfer evidence rows", () => {
    const html = adminConsoleHtml();
    const helperStart = html.indexOf("function edgeHasTransferRows");
    const helperEnd = html.indexOf("function edgeHasStoredMoneyEvidence", helperStart);
    const rowBlock = html.slice(html.indexOf("function edgeTransferEvidenceRows"), html.indexOf("function transferEvidenceRowsHtml"));
    const renderTabsBlock = html.slice(html.indexOf("function renderTransferTabs"), html.indexOf("function stopNodeForPath"));
    const selectedNodeBlock = html.slice(html.indexOf("function selectedNodeTransferEdges"), html.indexOf("function selectedNodeTransferBlock"));

    expect(helperStart).toBeGreaterThan(-1);
    expect(helperEnd).toBeGreaterThan(helperStart);
    expect(rowBlock).toContain("edgeHasTransferRows(edge)");
    expect(renderTabsBlock).toContain("filteredTransferEdges().filter(edgeHasTransferRows)");
    expect(selectedNodeBlock).toContain(".filter(edgeHasTransferRows)");
    if (helperStart < 0 || helperEnd <= helperStart) return;

    const api = new Function(
      "edgeHasAggregatedTxEvidence",
      "edgeTxHashes",
      html.slice(helperStart, helperEnd) + "\nreturn { edgeHasTransferRows };"
    )(
      (edge: { metadata?: { evidenceType?: string; txHashes?: unknown[]; txCount?: number } }) =>
        edge?.metadata?.evidenceType === "grouped_transfers" ||
        Number(edge?.metadata?.txCount || 0) > 1,
      (edge: { metadata?: { txHashes?: unknown[] } }) => Array.isArray(edge?.metadata?.txHashes) ? edge.metadata.txHashes : []
    ) as {
      edgeHasTransferRows(edge: unknown): boolean;
    };

    expect(api.edgeHasTransferRows({
      metadata: { boundaryContextOnly: true, underlyingTransfers: [{ txHash: "stored" }] }
    })).toBe(false);
    expect(api.edgeHasTransferRows({
      metadata: { evidenceType: "boundary_context_only", underlyingTransfers: [{ txHash: "stored" }] }
    })).toBe(false);
    expect(api.edgeHasTransferRows({
      txHash: "debit-tx",
      metadata: { evidenceType: "contract_trigger_context", underlyingTransfers: [{ txHash: "stored" }] }
    })).toBe(true);
    expect(api.edgeHasTransferRows({
      metadata: { evidenceType: "contract_driven_transfer", underlyingTransfers: [{ txHash: "stored" }] }
    })).toBe(true);
    expect(api.edgeHasTransferRows({
      metadata: { evidenceType: "boundary_context", underlyingTransfers: [{ txHash: "stored" }] }
    })).toBe(true);
    expect(api.edgeHasTransferRows({
      metadata: { evidenceType: "grouped_transfers", txHashes: ["tx-a", "tx-b"], txCount: 2 }
    })).toBe(true);
    expect(api.edgeHasTransferRows({ txHash: "inferred", metadata: {} })).toBe(false);
    expect(api.edgeHasTransferRows({ txHash: "real-tx", metadata: {} })).toBe(true);
  });

  it("renders contract trigger source debit amount chips", () => {
    const html = adminConsoleHtml();
    const amountVisibilityBlock = html.slice(html.indexOf("function edgeShouldShowAmount"), html.indexOf("function edgeShouldShowImportantCanvasAmount"));

    expect(amountVisibilityBlock).not.toBe("");

    const api = new Function(
      "function edgeDisplayRole(edge) { return edge?.displayRole || 'context'; }\n" +
        amountVisibilityBlock +
        "\nreturn { edgeShouldShowCanvasAmount };"
    )() as {
      edgeShouldShowCanvasAmount(edge: unknown): boolean;
    };

    expect(api.edgeShouldShowCanvasAmount({
      amountRaw: "1000000",
      metadata: { evidenceType: "contract_trigger_context" }
    })).toBe(true);
    expect(api.edgeShouldShowCanvasAmount({
      amountRaw: "1000000",
      metadata: { evidenceType: "contract_driven_transfer" }
    })).toBe(true);
    expect(api.edgeShouldShowCanvasAmount({
      amountRaw: "1000000",
      metadata: { evidenceType: "approval_drain_transfer" }
    })).toBe(true);
  });

  it("keeps grouped aggregate transaction evidence visible in transfer rows", () => {
    const html = adminConsoleHtml();
    const helperBlock = html.slice(html.indexOf("function edgeHasTransferRows"), html.indexOf("function edgeHasStoredMoneyEvidence"));
    const rowsBlock = html.slice(html.indexOf("function edgeTransferEvidenceRows"), html.indexOf("function transferEvidenceRowsHtml"));

    expect(helperBlock).toContain("function edgeHasTransferRows");
    expect(rowsBlock).toContain("function edgeTransferEvidenceRows");

    const api = new Function(
      "function edgeHasAggregatedTxEvidence(edge) { return edge?.metadata?.evidenceType === 'grouped_transfers'; }\n" +
        "function edgeTxHashes(edge) { return Array.isArray(edge?.metadata?.txHashes) ? edge.metadata.txHashes : []; }\n" +
        "function asArray(value) { return Array.isArray(value) ? value : []; }\n" +
        "function formatRawUsdt(value) { return value ? value + ' raw' : ''; }\n" +
        "function edgeTxGap() { return 'n/a'; }\n" +
        "function transferRowTxGap() { return 'n/a'; }\n" +
        "function edgeFromAddress() { return 'TFrom'; }\n" +
        "function edgeToAddress() { return 'TTo'; }\n" +
        "function edgePathId() { return 'path-a'; }\n" +
        "function edgeDetailedAmountLabel() { return ''; }\n" +
        "function edgeAggregateAmountLabel() { return '2K USDT'; }\n" +
        helperBlock +
        rowsBlock +
        "; return { edgeHasTransferRows, edgeTransferEvidenceRows };"
    )() as {
      edgeHasTransferRows(edge: unknown): boolean;
      edgeTransferEvidenceRows(edge: unknown): Array<{ txHash: string; amount: string; fromAddress: string; toAddress: string }>;
    };
    const edge = {
      metadata: { evidenceType: "grouped_transfers", txHashes: ["tx-a", "tx-b"], txCount: 2 },
      verdict: "review"
    };

    expect(api.edgeHasTransferRows(edge)).toBe(true);
    expect(api.edgeTransferEvidenceRows(edge).map((row) => row.txHash)).toEqual(["tx-a", "tx-b"]);
    expect(api.edgeTransferEvidenceRows({
      metadata: { evidenceType: "boundary_context_only", txHashes: ["tx-a"], txCount: 1 }
    })).toEqual([]);
    expect(api.edgeTransferEvidenceRows({
      txHash: "contract-driven-tx",
      metadata: {
        evidenceType: "contract_driven_transfer",
        underlyingTransfers: [{
          sourceAddress: "TVictimSource",
          receiverAddress: "TReceiverWallet",
          amountRaw: "1000000",
          timestamp: "2026-06-28T00:00:00.000Z",
          txHash: "contract-driven-tx"
        }]
      }
    })).toEqual([
      expect.objectContaining({
        fromAddress: "TVictimSource",
        toAddress: "TReceiverWallet",
        txHash: "contract-driven-tx"
      })
    ]);
  });

  it("describes context-only boundary edges without amount not available copy", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("boundary_context_only");
    expect(html).toContain("Investigation stop");
    expect(html).not.toContain("amount not available");
  });

  it("formats grouped boundary underlying transfers with amount, time, tx, and role", () => {
    const html = adminConsoleHtml();
    const helperBlock = html.match(/function edgeUnderlyingTransferLines\(edge\) \{[\s\S]*?\n    \}(?=\n    function edgeDirectness)/)?.[0] || "";

    expect(helperBlock).not.toBe("");

    const api = new Function(
      "asArray",
      "formatRawUsdt",
      "canvasTimestampLabel",
      "short",
      helperBlock + "\nreturn { edgeUnderlyingTransferLines };"
    )(
      (value: unknown) => Array.isArray(value) ? value : [],
      (value: unknown) => value === "25000000000" ? "25K USDT" : "",
      (value: unknown) => value === "2026-06-23T12:44:00.000Z" ? "Jun 23, 12:44" : "",
      (value: string) => value.slice(0, 10)
    ) as {
      edgeUnderlyingTransferLines(edge: unknown): string[];
    };

    expect(api.edgeUnderlyingTransferLines({
      metadata: {
        underlyingTransfers: [
          {
            txHash: "abcdef123456",
            amountRaw: "25000000000",
            timestamp: "2026-06-23T12:44:00.000Z",
            role: "boundary_hop"
          }
        ]
      }
    })).toEqual(["25K USDT / Jun 23, 12:44 / tx abcdef1234 / boundary_hop"]);
    expect(api.edgeUnderlyingTransferLines({
      metadata: {
        underlyingTransfers: [
          {
            txHash: "abcdef123456",
            role: "boundary_hop"
          }
        ]
      }
    })).toEqual(["amount not stored / time not stored / tx abcdef1234 / boundary_hop"]);
  });

  it("keeps deep-check wallet labels smart instead of hiding every address", () => {
    const html = adminConsoleHtml();
    const renderBlock = html.slice(html.indexOf("function renderGraph"), html.indexOf("function isCollapsedGroupNodeId"));
    const labelBlock = html.slice(html.indexOf("function nodeLabelBox"), html.indexOf("function applyTransform"));

    expect(html).toContain("function nodeCanvasLabelVisible");
    expect(html).toContain("function visibleNodeLabelIds");
    expect(labelBlock).toContain('if (state.walletLabelMode === "all") return true;');
    expect(labelBlock).toContain('if (state.walletLabelMode === "off")');
    expect(labelBlock).toContain('if (state.walletLabelMode === "important")');
    expect(renderBlock).toContain("const visibleLabelIds = visibleNodeLabelIds(placed.nodes, visibleEdges, placed);");
    expect(renderBlock).toContain('visibleLabelIds.has(node.id) ? "" : " label-hidden"');
    expect(html).toContain(".node.label-hidden .node-label");
    expect(html).toContain(".node.label-hidden .node-sublabel");
  });

  it("uses boundary identity for service canvas labels", () => {
    const html = adminConsoleHtml();
    const helperBlock = html.match(/function nodeMarker\(node\) \{[\s\S]*?\n    \}(?=\n    function nodeColor)/)?.[0] || "";
    const labelBlock = html.match(/function canvasNodeLabel\(node\) \{[\s\S]*?\n    \}(?=\n    function nodeLabelAttrs)/)?.[0] || "";

    expect(helperBlock).not.toBe("");
    expect(labelBlock).not.toBe("");

    const api = new Function(
      "short",
      "asArray",
      "formatRawUsdt",
      helperBlock + "\n" + labelBlock + "\nreturn { nodeDisplayKind, nodeDisplayLabel, canvasNodeLabel };"
    )(
      (value: string) => value.length > 10 ? value.slice(0, 6) + "..." + value.slice(-4) : value,
      (value: unknown) => Array.isArray(value) ? value : [],
      () => ""
    ) as {
      nodeDisplayLabel(node: unknown): string;
      canvasNodeLabel(node: unknown): string;
    };

    const node = {
      kind: "service",
      displayKind: "cex",
      label: "CEX",
      metadata: {
        boundaryIdentity: {
          displayName: "Bybit",
          category: "cex",
          categoryLabel: "CEX",
          confidence: "high",
          source: "known_cex_rule",
          evidence: ["identity:Bybit"],
          isBoundary: true
        }
      }
    };

    expect(api.nodeDisplayLabel(node)).toBe("Bybit");
    expect(api.canvasNodeLabel(node)).toBe("Bybit");
  });

  it("shows boundary identity details in selected node right rail", () => {
    const html = adminConsoleHtml();
    const block = html.match(/function walletDetailBlock\(node, graph\) \{[\s\S]*?\n    \}(?=\n    function transferDetailBlock)/)?.[0] || "";

    expect(block).toContain("Boundary identity");
    expect(block).toContain("boundaryIdentityName(node)");
    expect(block).toContain("boundaryIdentityCategoryLabel(node)");
    expect(block).toContain("boundaryIdentityConfidenceLabel(node)");
    expect(block).toContain("Boundary meaning");
  });

  it("wallet nodes do not use boundary identity", () => {
    const html = adminConsoleHtml();
    const helperBlock = html.match(/function nodeMarker\(node\) \{[\s\S]*?\n    \}(?=\n    function nodeColor)/)?.[0] || "";
    const labelBlock = html.match(/function canvasNodeLabel\(node\) \{[\s\S]*?\n    \}(?=\n    function nodeLabelAttrs)/)?.[0] || "";

    expect(helperBlock).not.toBe("");
    expect(labelBlock).not.toBe("");

    const api = new Function(
      "short",
      "asArray",
      "formatRawUsdt",
      helperBlock + "\n" + labelBlock + "\nreturn { canvasNodeLabel };"
    )(
      (value: string) => value.length > 10 ? value.slice(0, 6) + "..." + value.slice(-4) : value,
      (value: unknown) => Array.isArray(value) ? value : [],
      () => ""
    ) as {
      canvasNodeLabel(node: unknown): string;
    };

    expect(api.canvasNodeLabel({
      kind: "wallet",
      address: "TViaWallet111111111111111111111111",
      metadata: {
        boundaryIdentity: {
          displayName: "Binance-Hot 6"
        }
      }
    })).toBe("TViaWa...1111");
  });

  it("filters smart wallet labels while preserving subject, service, group, and high-value labels", () => {
    const html = adminConsoleHtml();
    const nodeMarkerBlock = html.slice(html.indexOf("function nodeMarker"), html.indexOf("function hasStopReason"));
    const nodeKindBlock = html.slice(html.indexOf("function hasStopReason"), html.indexOf("function nodeColor"));
    const canvasLabelBlock = html.slice(html.indexOf("function bundleMemberCount"), html.indexOf("function applyTransform"));
    const labelApi = new Function(
      "const state = { walletLabelMode: \"smart\", selected: null, graph: { job: { kind: \"address_deep_check\" } } };" +
        "function graphDisplayMode() { return \"deep_branch_map\"; }" +
        "const short = (value, size = 6) => String(value || '').slice(0, size);" +
        "function nodeAddress(node) { return node?.address || ''; }" +
        "function nodeDisplayLabel(node) { return node?.label || node?.address || node?.id || ''; }" +
        "function nodeIsServiceLike(node) { return ['service', 'bridge', 'cex', 'boundary'].includes(node?.kind) || ['bridge', 'cex', 'service_boundary'].includes(node?.displayKind); }" +
        "function nodeImportanceScore(node) { return Number(node.weight || 0); }" +
        "function rankNodesByImportance(nodes, edges) { return [...nodes].sort((a, b) => nodeImportanceScore(b, edges) - nodeImportanceScore(a, edges) || String(a.id).localeCompare(String(b.id))); }" +
        "function nodeRadius() { return 16; }" +
        "function nodeLabelAttrs() { return { x: 0, y: 16, anchor: 'middle' }; }" +
        "function boxesOverlap(a, b, padding = 6) { return a.left < b.right + padding && a.right > b.left - padding && a.top < b.bottom + padding && a.bottom > b.top - padding; }" +
        nodeMarkerBlock +
        nodeKindBlock +
        "function bundleCanvasLabel() { return \"Bundle\"; }" +
        "function bundleSubLabel() { return \"\"; }" +
        "function stopBadgeLabel() { return \"Stop\"; }" +
        canvasLabelBlock +
        "return { state, visibleNodeLabelIds, canvasNodeLabel };",
    )();
    const nodes = [
      { id: "subject", kind: "subject", address: "TSUBJECT111111", x: 0, y: 0 },
      { id: "service", kind: "service", label: "Exchange", x: 0, y: 0 },
      { id: "group", kind: "group", displayKind: "collapsed_group", label: "+8 wallets", x: 0, y: 0 },
      { id: "high", kind: "wallet", address: "THIGH1111111", weight: 50, x: 0, y: 0 },
      ...Array.from({ length: 28 }, (_, index) => ({
        id: "filler-" + index,
        kind: "wallet",
        address: "TFILLER" + index,
        weight: 49 - index,
        x: 0,
        y: 0,
      })),
      { id: "low", kind: "wallet", address: "TLOW11111111", weight: 1, x: 300, y: 300 },
    ];

    const visible = labelApi.visibleNodeLabelIds(nodes, []);
    expect(visible.has("subject")).toBe(true);
    expect(visible.has("service")).toBe(true);
    expect(visible.has("group")).toBe(true);
    expect(visible.has("high")).toBe(true);
    expect(visible.has("low")).toBe(false);
    expect(labelApi.canvasNodeLabel(nodes.find((node) => node.id === "low"))).toBe("TLOW11");
  });

  it("smart hides non-colliding ordinary deep wallet labels", () => {
    const html = adminConsoleHtml();
    const nodeMarkerBlock = html.slice(html.indexOf("function nodeMarker"), html.indexOf("function hasStopReason"));
    const nodeKindBlock = html.slice(html.indexOf("function hasStopReason"), html.indexOf("function nodeColor"));
    const canvasLabelBlock = html.slice(html.indexOf("function bundleMemberCount"), html.indexOf("function applyTransform"));
    const labelApi = new Function(
      "const state = { walletLabelMode: \"smart\", selected: null, graph: { job: { kind: \"address_deep_check\" } } };" +
        "function graphDisplayMode() { return \"deep_branch_map\"; }" +
        "const short = (value, size = 6) => String(value || '').slice(0, size);" +
        "function nodeAddress(node) { return node?.address || ''; }" +
        "function nodeDisplayLabel(node) { return node?.label || node?.address || node?.id || ''; }" +
        "function nodeIsServiceLike(node) { return ['service', 'bridge', 'cex', 'boundary'].includes(node?.kind) || ['bridge', 'cex', 'service_boundary'].includes(node?.displayKind); }" +
        "function nodeImportanceScore(node) { return Number(node.weight || 0); }" +
        "function rankNodesByImportance(nodes, edges) { return [...nodes].sort((a, b) => nodeImportanceScore(b, edges) - nodeImportanceScore(a, edges) || String(a.id).localeCompare(String(b.id))); }" +
        "function nodeRadius() { return 16; }" +
        "function nodeLabelAttrs() { return { x: 0, y: 16, anchor: 'middle' }; }" +
        "function boxesOverlap(a, b, padding = 6) { return a.left < b.right + padding && a.right > b.left - padding && a.top < b.bottom + padding && a.bottom > b.top - padding; }" +
        nodeMarkerBlock +
        nodeKindBlock +
        "function bundleCanvasLabel() { return \"Bundle\"; }" +
        "function bundleSubLabel() { return \"\"; }" +
        "function stopBadgeLabel() { return \"Stop\"; }" +
        canvasLabelBlock +
        "return { visibleNodeLabelIds };",
    )();
    const nodes = [
      { id: "subject", kind: "subject", address: "TSUBJECT111111", x: 0, y: 0 },
      { id: "service", kind: "service", label: "Exchange", x: 80, y: 0 },
      { id: "group", kind: "group", displayKind: "collapsed_group", label: "+8 wallets", x: 160, y: 0 },
      { id: "high", kind: "wallet", address: "THIGH1111111", weight: 100, x: 240, y: 0 },
      ...Array.from({ length: 28 }, (_, index) => ({
        id: "filler-" + index,
        kind: "wallet",
        address: "TFILLER" + index,
        weight: 99 - index,
        x: 400 + index * 80,
        y: 0,
      })),
      { id: "low", kind: "wallet", address: "TLOW11111111", weight: 1, x: 5000, y: 5000 },
    ];

    const visible = labelApi.visibleNodeLabelIds(nodes, []);
    expect(visible.has("subject")).toBe(true);
    expect(visible.has("service")).toBe(true);
    expect(visible.has("group")).toBe(true);
    expect(visible.has("high")).toBe(true);
    expect(visible.has("low")).toBe(false);
  });

  it("wallet clusters use deep-branch smart wallet label suppression", () => {
    const html = adminConsoleHtml();
    const nodeMarkerBlock = html.slice(html.indexOf("function nodeMarker"), html.indexOf("function hasStopReason"));
    const nodeKindBlock = html.slice(html.indexOf("function hasStopReason"), html.indexOf("function nodeColor"));
    const displayModeBlock = html.slice(html.indexOf("function graphIsDense"), html.indexOf("function buildDenseFanPresentation"));
    const canvasLabelBlock = html.slice(html.indexOf("function bundleMemberCount"), html.indexOf("function applyTransform"));
    const labelApi = new Function(
      "const state = { walletLabelMode: \"smart\", selected: null, densityMode: \"auto\", graph: { job: { kind: \"address_deep_check\" } } };" +
        "const short = (value, size = 6) => String(value || '').slice(0, size);" +
        "function nodeAddress(node) { return node?.address || ''; }" +
        "function nodeDisplayLabel(node) { return node?.label || node?.address || node?.id || ''; }" +
        "function nodeIsServiceLike(node) { return ['service', 'bridge', 'cex', 'boundary'].includes(node?.kind) || ['bridge', 'cex', 'service_boundary'].includes(node?.displayKind); }" +
        "function nodeImportanceScore(node) { return Number(node.weight || 0); }" +
        "function rankNodesByImportance(nodes, edges) { return [...nodes].sort((a, b) => nodeImportanceScore(b, edges) - nodeImportanceScore(a, edges) || String(a.id).localeCompare(String(b.id))); }" +
        "function nodeRadius() { return 16; }" +
        "function nodeLabelAttrs() { return { x: 0, y: 16, anchor: 'middle' }; }" +
        "function boxesOverlap(a, b, padding = 6) { return a.left < b.right + padding && a.right > b.left - padding && a.top < b.bottom + padding && a.bottom > b.top - padding; }" +
        nodeMarkerBlock +
        nodeKindBlock +
        displayModeBlock +
        "function bundleCanvasLabel() { return \"Bundle\"; }" +
        "function bundleSubLabel() { return \"\"; }" +
        "function stopBadgeLabel() { return \"Stop\"; }" +
        canvasLabelBlock +
        "return { visibleNodeLabelIds, graphDisplayMode };",
    )();
    const nodes = [
      { id: "subject", kind: "subject", address: "TSUBJECT111111", x: 0, y: 0 },
      { id: "service", kind: "service", label: "Exchange", x: 80, y: 0 },
      { id: "group", kind: "group", displayKind: "collapsed_group", label: "+8 wallets", x: 160, y: 0 },
      { id: "high", kind: "wallet", address: "THIGH1111111", weight: 100, x: 240, y: 0 },
      ...Array.from({ length: 28 }, (_, index) => ({
        id: "filler-" + index,
        kind: "wallet",
        address: "TFILLER" + index,
        weight: 99 - index,
        x: 400 + index * 80,
        y: 0,
      })),
      { id: "low", kind: "wallet", address: "TLOW11111111", weight: 1, x: 5000, y: 5000 },
    ];

    expect(labelApi.graphDisplayMode(nodes, [])).toBe("wallet_clusters");
    const visible = labelApi.visibleNodeLabelIds(nodes, []);
    expect(visible.has("subject")).toBe(true);
    expect(visible.has("service")).toBe(true);
    expect(visible.has("group")).toBe(true);
    expect(visible.has("high")).toBe(true);
    expect(visible.has("low")).toBe(false);
  });

  it("smart does not promote every low-value wallet adjacent to the subject", () => {
    const html = adminConsoleHtml();
    const nodeMarkerBlock = html.slice(html.indexOf("function nodeMarker"), html.indexOf("function hasStopReason"));
    const nodeKindBlock = html.slice(html.indexOf("function hasStopReason"), html.indexOf("function nodeColor"));
    const canvasLabelBlock = html.slice(html.indexOf("function bundleMemberCount"), html.indexOf("function applyTransform"));
    const labelApi = new Function(
      "const state = { walletLabelMode: \"smart\", selected: null, graph: { job: { kind: \"address_deep_check\" } } };" +
        "function graphDisplayMode() { return \"deep_branch_map\"; }" +
        "const short = (value, size = 6) => String(value || '').slice(0, size);" +
        "function nodeAddress(node) { return node?.address || ''; }" +
        "function nodeDisplayLabel(node) { return node?.label || node?.address || node?.id || ''; }" +
        "function nodeIsServiceLike(node) { return ['service', 'bridge', 'cex', 'boundary'].includes(node?.kind) || ['bridge', 'cex', 'service_boundary'].includes(node?.displayKind); }" +
        "function nodeImportanceScore(node) { return Number(node.weight || 0); }" +
        "function rankNodesByImportance(nodes, edges) { return [...nodes].sort((a, b) => nodeImportanceScore(b, edges) - nodeImportanceScore(a, edges) || String(a.id).localeCompare(String(b.id))); }" +
        "function nodeRadius() { return 16; }" +
        "function nodeLabelAttrs() { return { x: 0, y: 16, anchor: 'middle' }; }" +
        "function boxesOverlap(a, b, padding = 6) { return a.left < b.right + padding && a.right > b.left - padding && a.top < b.bottom + padding && a.bottom > b.top - padding; }" +
        nodeMarkerBlock +
        nodeKindBlock +
        "function bundleCanvasLabel() { return \"Bundle\"; }" +
        "function bundleSubLabel() { return \"\"; }" +
        "function stopBadgeLabel() { return \"Stop\"; }" +
        canvasLabelBlock +
        "return { visibleNodeLabelIds };",
    )();
    const lowWallets = Array.from({ length: 40 }, (_, index) => ({
      id: "low-" + index,
      kind: "wallet",
      address: "TLOW" + index,
      weight: 40 - index,
      x: 500 + index * 90,
      y: 5000,
    }));
    const nodes = [
      { id: "subject", kind: "subject", address: "TSUBJECT111111", weight: 1000, x: 0, y: 0 },
      ...lowWallets,
    ];
    const edges = lowWallets.map((node, index) => ({
      id: "edge-" + index,
      fromNodeId: "subject",
      toNodeId: node.id,
    }));

    const visible = labelApi.visibleNodeLabelIds(nodes, edges);
    const visibleLowWallets = lowWallets.filter((node) => visible.has(node.id));
    expect(visible.has("subject")).toBe(true);
    expect(visibleLowWallets.length).toBeLessThan(lowWallets.length);
  });

  it("uses the real placed layout for node label collision boxes", () => {
    const html = adminConsoleHtml();
    const nodeMarkerBlock = html.slice(html.indexOf("function nodeMarker"), html.indexOf("function hasStopReason"));
    const nodeKindBlock = html.slice(html.indexOf("function hasStopReason"), html.indexOf("function nodeColor"));
    const canvasLabelBlock = html.slice(html.indexOf("function bundleMemberCount"), html.indexOf("function applyTransform"));
    const labelApi = new Function(
      "const state = { walletLabelMode: \"smart\", selected: null };" +
        "const short = (value, size = 6) => String(value || '').slice(0, size);" +
        "function nodeAddress(node) { return node?.address || ''; }" +
        "function nodeDisplayLabel(node) { return node?.label || node?.address || node?.id || ''; }" +
        "function nodeIsServiceLike(node) { return ['service', 'bridge', 'cex', 'boundary'].includes(node?.kind) || ['bridge', 'cex', 'service_boundary'].includes(node?.displayKind); }" +
        "function nodeRadius() { return 16; }" +
        "function boxesOverlap(a, b, padding = 6) { return a.left < b.right + padding && a.right > b.left - padding && a.top < b.bottom + padding && a.bottom > b.top - padding; }" +
        nodeMarkerBlock +
        nodeKindBlock +
        "function bundleCanvasLabel() { return \"Bundle\"; }" +
        "function bundleSubLabel() { return \"\"; }" +
        "function stopBadgeLabel() { return \"Stop\"; }" +
        canvasLabelBlock +
        "return { nodeLabelBox };",
    )();
    const subject = { id: "subject", kind: "subject", address: "TSUBJECT111111", x: 1000, y: 100 };
    const wallet = { id: "wallet", kind: "wallet", address: "TWALLET111111", x: 1150, y: 400 };
    const placed = { nodes: [subject, wallet], byId: new Map([["subject", subject], ["wallet", wallet]]) };

    const box = labelApi.nodeLabelBox(wallet, placed);
    expect(box.left).toBe(1127);
    expect(box.top).toBe(420);
  });

  it("non-deep default smart labels do not crash and preserve ordinary wallet labels", () => {
    const html = adminConsoleHtml();
    const nodeMarkerBlock = html.slice(html.indexOf("function nodeMarker"), html.indexOf("function hasStopReason"));
    const nodeKindBlock = html.slice(html.indexOf("function hasStopReason"), html.indexOf("function nodeColor"));
    const displayModeBlock = html.slice(html.indexOf("function graphIsDense"), html.indexOf("function buildDenseFanPresentation"));
    const canvasLabelBlock = html.slice(html.indexOf("function bundleMemberCount"), html.indexOf("function applyTransform"));
    const labelApi = new Function(
      "const state = { walletLabelMode: \"smart\", selected: null, densityMode: \"auto\", graph: { job: { kind: \"manual_review\" } } };" +
        "const short = (value, size = 6) => String(value || '').slice(0, size);" +
        "function nodeAddress(node) { return node?.address || ''; }" +
        "function nodeDisplayLabel(node) { return node?.label || node?.address || node?.id || ''; }" +
        "function nodeIsServiceLike(node) { return ['service', 'bridge', 'cex', 'boundary'].includes(node?.kind) || ['bridge', 'cex', 'service_boundary'].includes(node?.displayKind); }" +
        "function nodeImportanceScore(node) { return Number(node.weight || 0); }" +
        "function rankNodesByImportance(nodes, edges) { return [...nodes].sort((a, b) => nodeImportanceScore(b, edges) - nodeImportanceScore(a, edges) || String(a.id).localeCompare(String(b.id))); }" +
        "function nodeRadius() { return 16; }" +
        "function nodeLabelAttrs() { return { x: 0, y: 16, anchor: 'middle' }; }" +
        "function boxesOverlap(a, b, padding = 6) { return a.left < b.right + padding && a.right > b.left - padding && a.top < b.bottom + padding && a.bottom > b.top - padding; }" +
        nodeMarkerBlock +
        nodeKindBlock +
        displayModeBlock +
        "function bundleCanvasLabel() { return \"Bundle\"; }" +
        "function bundleSubLabel() { return \"\"; }" +
        "function stopBadgeLabel() { return \"Stop\"; }" +
        canvasLabelBlock +
        "return { visibleNodeLabelIds };",
    )();
    const nodes = [
      { id: "subject", kind: "subject", address: "TSUBJECT111111", x: 0, y: 0 },
      { id: "wallet", kind: "wallet", address: "TWALLET111111", weight: 1, x: 5000, y: 5000 },
    ];

    expect(() => labelApi.visibleNodeLabelIds(nodes, [])).not.toThrow();
    const visible = labelApi.visibleNodeLabelIds(nodes, []);
    expect(visible.has("subject")).toBe(true);
    expect(visible.has("wallet")).toBe(true);
  });

  it("honors all and off wallet label modes", () => {
    const html = adminConsoleHtml();
    const nodeMarkerBlock = html.slice(html.indexOf("function nodeMarker"), html.indexOf("function hasStopReason"));
    const nodeKindBlock = html.slice(html.indexOf("function hasStopReason"), html.indexOf("function nodeColor"));
    const canvasLabelBlock = html.slice(html.indexOf("function bundleMemberCount"), html.indexOf("function applyTransform"));
    const labelApi = new Function(
      "const state = { walletLabelMode: \"all\", selected: null, graph: { job: { kind: \"address_deep_check\" } } };" +
        "function graphDisplayMode() { return \"deep_branch_map\"; }" +
        "const short = (value, size = 6) => String(value || '').slice(0, size);" +
        "function nodeAddress(node) { return node?.address || ''; }" +
        "function nodeDisplayLabel(node) { return node?.label || node?.address || node?.id || ''; }" +
        "function nodeIsServiceLike(node) { return ['service', 'bridge', 'cex', 'boundary'].includes(node?.kind) || ['bridge', 'cex', 'service_boundary'].includes(node?.displayKind); }" +
        "function nodeImportanceScore(node) { return Number(node.weight || 0); }" +
        "function rankNodesByImportance(nodes, edges) { return [...nodes].sort((a, b) => nodeImportanceScore(b, edges) - nodeImportanceScore(a, edges) || String(a.id).localeCompare(String(b.id))); }" +
        "function nodeRadius() { return 16; }" +
        "function nodeLabelAttrs() { return { x: 0, y: 16, anchor: 'middle' }; }" +
        "function boxesOverlap(a, b, padding = 6) { return a.left < b.right + padding && a.right > b.left - padding && a.top < b.bottom + padding && a.bottom > b.top - padding; }" +
        nodeMarkerBlock +
        nodeKindBlock +
        "function bundleCanvasLabel() { return \"Bundle\"; }" +
        "function bundleSubLabel() { return \"\"; }" +
        "function stopBadgeLabel() { return \"Stop\"; }" +
        canvasLabelBlock +
        "return { state, visibleNodeLabelIds };",
    )();
    const nodes = [
      { id: "subject", kind: "subject", address: "TSUBJECT111111", x: 0, y: 0 },
      { id: "wallet", kind: "wallet", address: "TWALLET111111", x: 0, y: 0 },
      { id: "service", kind: "service", label: "Exchange", x: 0, y: 0 },
      { id: "group", kind: "group", displayKind: "collapsed_group", label: "+8 wallets", x: 0, y: 0 },
    ];

    expect(labelApi.visibleNodeLabelIds(nodes, []).has("wallet")).toBe(true);
    labelApi.state.walletLabelMode = "off";
    const offVisible = labelApi.visibleNodeLabelIds(nodes, []);
    expect(offVisible.has("wallet")).toBe(false);
    expect(offVisible.has("subject")).toBe(false);
    expect(offVisible.has("service")).toBe(true);
    expect(offVisible.has("group")).toBe(true);
  });

  it("off hides subject wallet labels while keeping service and group semantic labels", () => {
    const html = adminConsoleHtml();
    const nodeMarkerBlock = html.slice(html.indexOf("function nodeMarker"), html.indexOf("function hasStopReason"));
    const nodeKindBlock = html.slice(html.indexOf("function hasStopReason"), html.indexOf("function nodeColor"));
    const displayModeBlock = html.slice(html.indexOf("function graphIsDense"), html.indexOf("function buildDenseFanPresentation"));
    const canvasLabelBlock = html.slice(html.indexOf("function bundleMemberCount"), html.indexOf("function applyTransform"));
    const labelApi = new Function(
      "const state = { walletLabelMode: \"off\", selected: null, densityMode: \"auto\", graph: { job: { kind: \"address_deep_check\" } } };" +
        "const short = (value, size = 6) => String(value || '').slice(0, size);" +
        "function nodeAddress(node) { return node?.address || ''; }" +
        "function nodeDisplayLabel(node) { return node?.label || node?.address || node?.id || ''; }" +
        "function nodeIsServiceLike(node) { return ['service', 'bridge', 'cex', 'boundary'].includes(node?.kind) || ['bridge', 'cex', 'service_boundary'].includes(node?.displayKind); }" +
        "function nodeImportanceScore(node) { return Number(node.weight || 0); }" +
        "function rankNodesByImportance(nodes, edges) { return [...nodes].sort((a, b) => nodeImportanceScore(b, edges) - nodeImportanceScore(a, edges) || String(a.id).localeCompare(String(b.id))); }" +
        "function nodeRadius() { return 16; }" +
        "function nodeLabelAttrs() { return { x: 0, y: 16, anchor: 'middle' }; }" +
        "function boxesOverlap(a, b, padding = 6) { return a.left < b.right + padding && a.right > b.left - padding && a.top < b.bottom + padding && a.bottom > b.top - padding; }" +
        nodeMarkerBlock +
        nodeKindBlock +
        displayModeBlock +
        "function bundleCanvasLabel() { return \"Bundle\"; }" +
        "function bundleSubLabel() { return \"\"; }" +
        "function stopBadgeLabel() { return \"Stop\"; }" +
        canvasLabelBlock +
        "return { visibleNodeLabelIds };",
    )();
    const nodes = [
      { id: "subject", kind: "subject", address: "TSUBJECT111111", x: 0, y: 0 },
      { id: "service", kind: "service", label: "Exchange", x: 200, y: 0 },
      { id: "group", kind: "group", displayKind: "collapsed_group", label: "+8 wallets", x: 400, y: 0 },
    ];

    const visible = labelApi.visibleNodeLabelIds(nodes, []);
    expect(visible.has("subject")).toBe(false);
    expect(visible.has("service")).toBe(true);
    expect(visible.has("group")).toBe(true);
  });

  it("off hides selected ordinary wallet labels while keeping semantic labels", () => {
    const html = adminConsoleHtml();
    const nodeMarkerBlock = html.slice(html.indexOf("function nodeMarker"), html.indexOf("function hasStopReason"));
    const nodeKindBlock = html.slice(html.indexOf("function hasStopReason"), html.indexOf("function nodeColor"));
    const canvasLabelBlock = html.slice(html.indexOf("function bundleMemberCount"), html.indexOf("function applyTransform"));
    const labelApi = new Function(
      "const state = { walletLabelMode: \"off\", selected: { type: \"node\", id: \"wallet\" }, graph: { job: { kind: \"address_deep_check\" } } };" +
        "function graphDisplayMode() { return \"deep_branch_map\"; }" +
        "const short = (value, size = 6) => String(value || '').slice(0, size);" +
        "function nodeAddress(node) { return node?.address || ''; }" +
        "function nodeDisplayLabel(node) { return node?.label || node?.address || node?.id || ''; }" +
        "function nodeIsServiceLike(node) { return ['service', 'bridge', 'cex', 'boundary'].includes(node?.kind) || ['bridge', 'cex', 'service_boundary'].includes(node?.displayKind); }" +
        "function nodeImportanceScore(node) { return Number(node.weight || 0); }" +
        "function rankNodesByImportance(nodes, edges) { return [...nodes].sort((a, b) => nodeImportanceScore(b, edges) - nodeImportanceScore(a, edges) || String(a.id).localeCompare(String(b.id))); }" +
        "function nodeRadius() { return 16; }" +
        "function nodeLabelAttrs() { return { x: 0, y: 16, anchor: 'middle' }; }" +
        "function boxesOverlap(a, b, padding = 6) { return a.left < b.right + padding && a.right > b.left - padding && a.top < b.bottom + padding && a.bottom > b.top - padding; }" +
        nodeMarkerBlock +
        nodeKindBlock +
        "function bundleCanvasLabel() { return \"Bundle\"; }" +
        "function bundleSubLabel() { return \"\"; }" +
        "function stopBadgeLabel() { return \"Stop\"; }" +
        canvasLabelBlock +
        "return { visibleNodeLabelIds };",
    )();
    const nodes = [
      { id: "wallet", kind: "wallet", address: "TWALLET111111", x: 0, y: 0 },
      { id: "service", kind: "service", label: "Exchange", x: 200, y: 0 },
      { id: "group", kind: "group", displayKind: "collapsed_group", label: "+8 wallets", x: 400, y: 0 },
    ];

    const visible = labelApi.visibleNodeLabelIds(nodes, []);
    expect(visible.has("wallet")).toBe(false);
    expect(visible.has("service")).toBe(true);
    expect(visible.has("group")).toBe(true);
  });

  it("keeps non-deep graph defaults on important transaction labels and existing flow routing", () => {
    const html = adminConsoleHtml();
    const txLabelBlock = html.slice(html.indexOf("function effectiveTxLabelMode"), html.indexOf("function selectedEdgeLabelVisible"));
    const kindBlock = html.slice(html.indexOf("function graphKindUsesFlowMap"), html.indexOf("function buildDenseFanPresentation"));

    expect(txLabelBlock).toContain('if (state.txLabelMode === "auto") return "important";');
    expect(kindBlock).toContain('return kind === "incoming_deposit_check" || kind === "where_is_money_check";');
    expect(kindBlock).toContain("function graphKindUsesWalletClusters");
    expect(kindBlock).toContain('return kind === "address_deep_check";');
    expect(kindBlock).toContain('if (graphKindUsesWalletClusters(state.graph?.job?.kind)) return "wallet_clusters";');
    expect(kindBlock).toContain('if (graphKindUsesFlowMap(state.graph?.job?.kind)) return "flow_map";');
  });

  it("keeps provenance flow map controls compatible with raw expansion services and bundles", () => {
    const html = adminConsoleHtml();

    expect(html).toContain('el("densityMode").addEventListener("click", () => {');
    expect(html).toContain("const current = state.densityMode;");
    expect(html).toContain('if (graphKindUsesWalletClusters(state.graph?.job?.kind)) {');
    expect(html).toContain('setDensityMode(current === "auto" ? "deep_branch_map" : current === "deep_branch_map" ? "show_all" : "auto");');
    expect(html).toContain('setDensityMode(current === "show_all" ? "auto" : "show_all");');
    expect(html).toContain('if (mode === "show_all" && (dense || graphKindUsesFlowMap(state.graph?.job?.kind) || graphKindUsesDeepBranchMap(state.graph?.job?.kind))) return timelineLaneLayout(sourceNodes, sourceEdges);');
    expect(html).toContain('el("servicesMode").addEventListener("click", () => {');
    expect(html).toContain('state.servicesVisible = !state.servicesVisible;');
    expect(html).toContain('edgePassesServiceFilter(edge)');
    expect(html).toContain('state.expandedBundleNodeIds.add(state.selected.id);');
    expect(html).toContain('state.expandedBundleNodeIds.delete(state.selected.id);');
    expect(html).toContain("flowMapBundleAnchor(node, sourceEdges, placedById)");
    expect(html).toContain("String(node.id || \"\").startsWith(\"bundle-member:\")");
  });

  it("migrates legacy density mode storage to graph view mode defaults", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function initialGraphViewMode");
    expect(html).toContain('const graphViewMode = localStorage.getItem("adminForensicsGraphViewMode");');
    expect(html).toContain('const legacyDensityMode = localStorage.getItem("adminForensicsDensityMode");');
    expect(html).toContain('localStorage.removeItem("adminForensicsDensityMode");');
    expect(html).toContain("if (graphViewMode !== null) return graphViewMode;");
    expect(html).toContain('if (legacyDensityMode === "show_all") {');
    expect(html).toContain('localStorage.setItem("adminForensicsGraphViewMode", "show_all");');
    expect(html).toContain('return "show_all";');
    expect(html).toContain('return "auto";');
  });

  it("defaults incoming and where-is-money provenance graphs to flow map mode", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("adminForensicsGraphViewMode");
    expect(html).toContain('if (mode === "show_all") return "show_all";');
    expect(html).toContain('if (mode === "deep_branch_map" && graphKindUsesDeepBranchMap(state.graph?.job?.kind)) return "deep_branch_map";');
    expect(html).toContain('if (mode === "fan") return "fan";');
    expect(html).toContain('if (graphKindUsesWalletClusters(state.graph?.job?.kind)) return "wallet_clusters";');
    expect(html).toContain('if (graphKindUsesFlowMap(state.graph?.job?.kind)) return "flow_map";');
    expect(html).toContain('if (!graphIsDense(nodes, edges)) return "show_all";');
    expect(html).toContain('return "fan";');
    expect(html).toContain("function graphKindUsesFlowMap");
    expect(html).toContain('return kind === "incoming_deposit_check" || kind === "where_is_money_check";');
    expect(html).toContain("function flowMapLayout");
    expect(html).toContain('if (mode === "flow_map") return flowMapLayout(sourceNodes, sourceEdges);');
    expect(html).toContain('if (mode === "show_all" && (dense || graphKindUsesFlowMap(state.graph?.job?.kind) || graphKindUsesDeepBranchMap(state.graph?.job?.kind))) return timelineLaneLayout(sourceNodes, sourceEdges);');
    expect(html).toContain('densityButton.textContent = mode === "wallet_clusters" ? "Wallet clusters" : mode === "deep_branch_map" ? "Deep branch map" : mode === "flow_map" ? "Flow map" : mode === "step_orbit" ? "Step orbit" : mode === "show_all" ? "Show all raw" : "Fan overview";');
    expect(html).toContain('"Flow map"');

    const graphDisplayModeBlock = html.slice(html.indexOf("function graphDisplayMode"), html.indexOf("function buildDenseFanPresentation"));
    expect(graphDisplayModeBlock.indexOf('if (mode === "show_all") return "show_all";')).toBeGreaterThanOrEqual(0);
    expect(graphDisplayModeBlock.indexOf('if (mode === "deep_branch_map" && graphKindUsesDeepBranchMap(state.graph?.job?.kind)) return "deep_branch_map";')).toBeGreaterThan(graphDisplayModeBlock.indexOf('if (mode === "show_all") return "show_all";'));
    expect(graphDisplayModeBlock.indexOf('if (mode === "fan") return "fan";')).toBeGreaterThan(graphDisplayModeBlock.indexOf('if (mode === "deep_branch_map" && graphKindUsesDeepBranchMap(state.graph?.job?.kind)) return "deep_branch_map";'));
    expect(graphDisplayModeBlock.indexOf('if (graphKindUsesWalletClusters(state.graph?.job?.kind)) return "wallet_clusters";')).toBeGreaterThan(graphDisplayModeBlock.indexOf('if (mode === "fan") return "fan";'));
    expect(graphDisplayModeBlock.indexOf('if (graphKindUsesFlowMap(state.graph?.job?.kind)) return "flow_map";')).toBeGreaterThan(graphDisplayModeBlock.indexOf('if (graphKindUsesWalletClusters(state.graph?.job?.kind)) return "wallet_clusters";'));
    expect(graphDisplayModeBlock.indexOf('if (!graphIsDense(nodes, edges)) return "show_all";')).toBeGreaterThan(graphDisplayModeBlock.indexOf('if (graphKindUsesFlowMap(state.graph?.job?.kind)) return "flow_map";'));
  });

  it("routes dense address deep checks to wallet clusters before deep branch map", () => {
    const html = adminConsoleHtml();
    const graphModeBlock = html.slice(html.indexOf("function graphIsDense"), html.indexOf("function buildDenseFanPresentation"));
    const graphDisplayModeBlock = html.slice(html.indexOf("function graphDisplayMode"), html.indexOf("function buildDenseFanPresentation"));
    const graphFirstLayoutIndex = html.indexOf("function graphFirstLayout");
    const layoutBlock = html.slice(graphFirstLayoutIndex, html.indexOf("function graphPresentation", graphFirstLayoutIndex));
    const graphPresentationBlock = html.slice(html.indexOf("function graphPresentation"), html.indexOf("function layout"));
    const controlsBlock = html.slice(html.indexOf("function syncDenseGraphControls"), html.indexOf("function syncGraphFirstControls"));
    const clickBlock = html.slice(html.indexOf('el("densityMode").addEventListener("click", () => {'), html.indexOf('el("expandSelected").addEventListener'));
    const api = new Function(`
      let state = { densityMode: "auto", graph: { job: { kind: "address_deep_check" } } };
      ${graphModeBlock}
      return {
        graphKindUsesWalletClusters,
        graphKindUsesFlowMap,
        graphDisplayMode,
        setState(next) { state = next; }
      };
    `)();
    const sparseNodes = [{ id: "subject", kind: "subject" }];
    const sparseEdges: unknown[] = [];

    expect(html).toContain("function graphKindUsesDeepBranchMap");
    expect(graphDisplayModeBlock).toContain('if (mode === "deep_branch_map" && graphKindUsesDeepBranchMap(state.graph?.job?.kind)) return "deep_branch_map";');
    expect(graphDisplayModeBlock).toContain('if (graphKindUsesWalletClusters(state.graph?.job?.kind)) return "wallet_clusters";');
    expect(api.graphKindUsesWalletClusters("address_deep_check")).toBe(true);
    expect(api.graphKindUsesWalletClusters("incoming_deposit_check")).toBe(false);
    expect(api.graphKindUsesWalletClusters("where_is_money_check")).toBe(false);
    expect(api.graphDisplayMode(sparseNodes, sparseEdges)).toBe("wallet_clusters");
    api.setState({ densityMode: "deep_branch_map", graph: { job: { kind: "address_deep_check" } } });
    expect(api.graphDisplayMode(sparseNodes, sparseEdges)).toBe("deep_branch_map");
    api.setState({ densityMode: "show_all", graph: { job: { kind: "address_deep_check" } } });
    expect(api.graphDisplayMode(sparseNodes, sparseEdges)).toBe("show_all");
    api.setState({ densityMode: "fan", graph: { job: { kind: "address_deep_check" } } });
    expect(api.graphDisplayMode(sparseNodes, sparseEdges)).toBe("fan");
    api.setState({ densityMode: "auto", graph: { job: { kind: "incoming_deposit_check" } } });
    expect(api.graphDisplayMode(sparseNodes, sparseEdges)).toBe("flow_map");
    api.setState({ densityMode: "auto", graph: { job: { kind: "where_is_money_check" } } });
    expect(api.graphDisplayMode(sparseNodes, sparseEdges)).toBe("flow_map");
    api.setState({ densityMode: "deep_branch_map", graph: { job: { kind: "incoming_deposit_check" } } });
    expect(api.graphDisplayMode(sparseNodes, sparseEdges)).toBe("flow_map");
    api.setState({ densityMode: "deep_branch_map", graph: { job: { kind: "where_is_money_check" } } });
    expect(api.graphDisplayMode(sparseNodes, sparseEdges)).toBe("flow_map");
    expect(html).toContain("function walletClusterLayout");
    expect(layoutBlock).toContain('if (mode === "wallet_clusters") return walletClusterLayout(sourceNodes, sourceEdges);');
    expect(layoutBlock).toContain('if (mode === "deep_branch_map") return deepBranchMapLayout(sourceNodes, sourceEdges);');
    expect(graphPresentationBlock).toContain('if (mode === "wallet_clusters") {');
    expect(graphPresentationBlock).toContain('} else if (mode === "deep_branch_map") {');
    expect(controlsBlock).toContain('mode === "wallet_clusters" ? "Wallet clusters"');
    expect(clickBlock).toContain('setDensityMode(current === "auto" ? "deep_branch_map" : current === "deep_branch_map" ? "show_all" : "auto");');
  });

  it("keeps deep branch map available as a manual address-deep mode", () => {
    const html = adminConsoleHtml();
    const kindBlock = html.slice(html.indexOf("function graphKindUsesFlowMap"), html.indexOf("function buildDenseFanPresentation"));
    const graphFirstLayoutIndex = html.indexOf("function graphFirstLayout");
    const layoutBlock = html.slice(graphFirstLayoutIndex, html.indexOf("function graphPresentation", graphFirstLayoutIndex));
    const controlsBlock = html.slice(html.indexOf("function syncDenseGraphControls"), html.indexOf("function syncGraphFirstControls"));

    expect(html).toContain("function graphKindUsesDeepBranchMap");
    expect(kindBlock).toContain('return kind === "incoming_deposit_check" || kind === "where_is_money_check";');
    expect(kindBlock).toContain('return kind === "address_deep_check";');
    expect(kindBlock).toContain('if (mode === "deep_branch_map" && graphKindUsesDeepBranchMap(state.graph?.job?.kind)) return "deep_branch_map";');
    expect(kindBlock).toContain('if (graphKindUsesWalletClusters(state.graph?.job?.kind)) return "wallet_clusters";');
    expect(layoutBlock).toContain('if (mode === "deep_branch_map") return deepBranchMapLayout(sourceNodes, sourceEdges);');
    expect(layoutBlock).toContain('if (mode === "flow_map") return flowMapLayout(sourceNodes, sourceEdges);');
    expect(controlsBlock).toContain('mode === "deep_branch_map" ? "Deep branch map"');
    expect(kindBlock).not.toContain('kind === "incoming_deposit_check" || kind === "where_is_money_check" || kind === "address_deep_check"');
  });

  it("builds step orbit presentation with real groups and ui-collapsed groups separated", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function stepOrbitRole");
    expect(html).toContain("function buildStepOrbitPresentation");
    expect(html).toContain("function stepOrbitSummaryNode");
    expect(html).toContain('displayKind: "collapsed_group"');
    expect(html).toContain("uiCollapsedGroup: true");
    expect(html).toContain("realGroupKind");
    expect(html).toContain("groupReason");
    expect(html).toContain("step:source");
    expect(html).toContain("step:funding");
    expect(html).toContain("step:service");
    expect(html).toContain("step:stop");
    expect(html).toContain('if (!state.servicesVisible && role === "service") return;');
    expect(html).toContain("state.expandedBundleNodeIds.has(node.id)");
  });

  it("does not classify ordinary outgoing wallets as services in step orbit mode", () => {
    const html = adminConsoleHtml();
    const stepOrbitRoleBlock = html.slice(html.indexOf("function stepOrbitRole"), html.indexOf("function importantClusterNodes"));

    expect(stepOrbitRoleBlock).toContain('if (nodeIsServiceLike(node)) return "service";');
    expect(stepOrbitRoleBlock).toContain('if (side === "outgoing") return "context";');
    expect(stepOrbitRoleBlock).toContain('if (groupKind === "outgoing") return "context";');
    expect(stepOrbitRoleBlock).not.toContain('if (side === "outgoing") return "service";');
    expect(stepOrbitRoleBlock).not.toContain('if (groupKind === "outgoing" || groupKind === "service") return "service";');
  });

  it("lays out step orbit graphs by investigation step with boundary and services separated", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function stepOrbitLayout");
    expect(html).toContain("const width = 2450;");
    expect(html).toContain("const height = 1360;");
    expect(html).toContain("const laneX = { source: width * 0.15, funding: width * 0.36, subject: width * 0.56, service: width * 0.78, stop: width * 0.91, context: width * 0.29 };");
    expect(html).toContain("const laneY = { source: height * 0.48, funding: height * 0.48, subject: height * 0.48, service: height * 0.35, stop: height * 0.62, context: height * 0.72 };");
    expect(html).toContain("function arrangeStepOrbitLane");
    expect(html).toContain("function relaxNodeCollisions");
    expect(html).toContain("relaxNodeCollisions(nodes, fixedNodeIds, 56)");
    expect(html).toContain("constrainLayoutNodes(relaxedNodes, width, height, fixedNodeIds)");
    expect(html).toContain('if (dense && mode === "step_orbit") return stepOrbitLayout(sourceNodes, sourceEdges);');
  });

  it("lays out provenance flow maps as routed paths with bundles peers and stops separated", () => {
    const html = adminConsoleHtml();
    const flowMapLayoutBlock = html.slice(html.indexOf("function flowMapBundleLaneSide"), html.indexOf("function legacyFanLayout"));

    expect(html).toContain("function flowMapPathNodeIds");
    expect(html).toContain("function flowMapPathItems");
    expect(html).toContain("function flowMapBundleAnchor");
    expect(html).toContain("function flowMapConnectedPlacedNodes");
    expect(html).toContain("function flowMapStopSide");
    expect(html).toContain("function flowMapBundleLaneSide");
    expect(html).toContain("function flowMapLayout");
    expect(html).toContain("const compactLane = pathItems.length <= 2;");
    expect(html).toContain("const pathStepWidth = compactLane ? 170 : 210;");
    expect(html).toContain("const width = Math.max(1680, 680 + maxPathLength * pathStepWidth + sourceNodes.length * 10);");
    expect(html).toContain("const height = Math.max(920, 620 + Math.max(pathItems.length, compactLane ? 3 : pathItems.length) * 170 + sourceNodes.length * 5);");
    expect(html).toContain("const pathStartX = 260;");
    expect(html).toContain("const pathEndX = width * 0.72;");
    expect(html).toContain("const mainY = height * 0.44;");
    expect(html).toContain("const peerLaneY = height * 0.20;");
    expect(html).toContain("const bundleLaneGap = compactLane ? 210 : 180;");
    expect(html).toContain("const stopLeftX = 120;");
    expect(html).toContain("const stopRightX = width - 150;");
    expect(html).toContain("const stopColumnGap = 190;");
    expect(html).toContain("const pathWaveAmplitude = compactLane ? Math.min(220, Math.max(110, height * .12)) : 0;");
    expect(html).toContain("const fixedNodeIds = new Set([subjectId].filter(Boolean));");
    expect(html).toContain("relaxNodeCollisions(nodes, fixedNodeIds, 64)");
    expect(html).toContain("constrainLayoutNodes(relaxedNodes, width, height, fixedNodeIds)");
    expect(flowMapLayoutBlock).toContain("const progress = maxPathLength > 1 ? nodeIndex / (maxPathLength - 1) : 0;");
    expect(flowMapLayoutBlock).toContain("const waveY = pathWaveAmplitude ? Math.sin(progress * Math.PI * 2 - Math.PI / 5) * pathWaveAmplitude : 0;");
    expect(flowMapLayoutBlock).toContain("const target = { x: pathStartX + nodeIndex * pathStepX, y: pathY + waveY + staggerY };");
    expect(flowMapLayoutBlock).toContain("const maxX = Math.max(...targets.map((target) => target.x));");
    expect(flowMapLayoutBlock).toContain("const rightmostTargets = targets.filter((target) => Math.abs(target.x - maxX) < 1);");
    expect(flowMapLayoutBlock).toContain("const averageY = rightmostTargets.reduce((total, target) => total + target.y, 0) / rightmostTargets.length;");
    expect(flowMapLayoutBlock).toContain("function flowMapBundleLaneSide");
    expect(flowMapLayoutBlock).toContain("const bundleSide = flowMapBundleLaneSide(anchor, mainY, slot);");
    expect(flowMapLayoutBlock).toContain("const bundleLaneGap = compactLane ? 210 : 180;");
    expect(flowMapLayoutBlock).toContain("const x = anchor ? anchor.x + 96 + (slot % 3) * 126 : width * 0.52 + (slot % 4 - 1.5) * 150;");
    expect(flowMapLayoutBlock).toContain("const y = anchor ? anchor.y + bundleLaneGap * bundleSide + Math.floor(slot / 3) * 92 * bundleSide : mainY + bundleLaneGap * bundleSide + Math.floor(slot / 4) * 92 * bundleSide;");
    expect(flowMapLayoutBlock).toContain("const side = parent && parent.y < mainY ? -1 : 1;");
    expect(flowMapLayoutBlock).toContain("const y = parent ? parent.y + side * (72 + Math.abs(Math.sin(angle) * radius)) : mainY + side * (270 + Math.floor(index / 5) * 72);");
    expect(flowMapLayoutBlock).toContain("const serviceColumnGap = 104;");
    expect(flowMapLayoutBlock).toContain("const serviceColumns = 3;");
    expect(flowMapLayoutBlock).toContain("const serviceBaseX = Math.min(width - 180 - serviceColumnGap * (serviceColumns - 1), pathEndX + 220);");
    expect(flowMapLayoutBlock).toContain('const x = related ? (side === "left" ? Math.max(stopLeftX, related.x - stopColumnGap) : Math.min(stopRightX, related.x + stopColumnGap)) : (side === "left" ? stopLeftX : stopRightX);');
    expect(flowMapLayoutBlock).not.toContain('x: side === "left" ? stopLeftX : stopRightX,');
    expect(flowMapLayoutBlock).not.toContain("width * 0.82 + (index % 4) * 112");
    expect(flowMapLayoutBlock).not.toContain("const pathNodeIds = new Set(pathItems.flatMap");
  });

  it("lays out address deep checks as a route spine with local orbit branches", () => {
    const html = adminConsoleHtml();
    const localOrbitBlock = html.slice(html.indexOf("function uniqueNodeIds"), html.indexOf("function legacyFanLayout"));

    expect(html).toContain("function deepLocalOrbitSpineNodeIds");
    expect(html).toContain("function deepLocalOrbitAnchorFor");
    expect(html).toContain("function deepLocalOrbitRole");
    expect(html).toContain("function deepLocalOrbitPoint");
    expect(html).toContain("function deepLocalOrbitLayout");
    expect(localOrbitBlock).toContain("function uniqueNodeIds");
    expect(localOrbitBlock).toContain("return uniqueNodeIds(ranked[0].nodeIds);");
    expect(localOrbitBlock).toContain("const spineNodeIds = deepLocalOrbitSpineNodeIds(sourceNodes, sourceEdges);");
    expect(localOrbitBlock).toContain("const subjectTargetX = Math.min(width - 280, Math.max(startX, width * 0.62));");
    expect(localOrbitBlock).toContain("const boundedStartX = clampLayoutValue");
    expect(localOrbitBlock).toContain("x: boundedStartX + index * stepX");
    expect(localOrbitBlock).toContain("const anchor = deepLocalOrbitAnchorFor(node, sourceEdges, placedById, subjectId);");
    expect(localOrbitBlock).toContain("const point = deepLocalOrbitPoint(anchor, slot, role, width, height);");
    expect(localOrbitBlock).toContain("role === \"group\"");
    expect(localOrbitBlock).toContain("role === \"service\"");
    expect(localOrbitBlock).toContain("role === \"stop\"");
    expect(localOrbitBlock).toContain("role === \"peer\"");
    expect(localOrbitBlock).toContain("relaxNodeCollisions(nodes, fixedNodeIds, 44)");
    expect(localOrbitBlock).toContain("constrainLayoutNodes(relaxedNodes, width, height, fixedNodeIds)");
    expect(localOrbitBlock).not.toContain("const deltaX = targetX - subject.x;");
  });

  it("lays out deep-check branches around their owning counterparties", () => {
    const html = adminConsoleHtml();
    const layoutBlock = html.slice(html.indexOf("function deepBranchMapLayout"), html.indexOf("function deepLocalOrbitSpineNodeIds"));

    expect(html).toContain("function deepBranchMapLayout");
    expect(html).toContain("function deepBranchLayoutRole");
    expect(html).toContain("function deepBranchPoint");
    expect(layoutBlock).toContain("const subjectX = width * 0.50;");
    expect(layoutBlock).toContain("const anchorId = node?.metadata?.deepBranchAnchorId || subjectId;");
    expect(layoutBlock).toContain("slotByAnchorRole");
    expect(layoutBlock).toContain('role === "service"');
    expect(layoutBlock).toContain('role === "stop"');
    expect(layoutBlock).toContain("relaxNodeCollisions(nodes, fixedNodeIds");
    expect(layoutBlock).not.toContain("return deepLocalOrbitLayout(sourceNodes, sourceEdges);");
  });

  it("keeps deep-check branch layouts compact and anchored by branch metadata", () => {
    const html = adminConsoleHtml();
    const layoutBlock = html.slice(html.indexOf("function arrangeCluster"), html.indexOf("function legacyFanLayout"));
    const api = new Function(
      "const state = { graph: null };\n" +
      "function stableNodeSort(a, b) {\n" +
        "  const aWeight = Number(a.weight || a.score || a.metadata?.volumeRaw || 0);\n" +
        "  const bWeight = Number(b.weight || b.score || b.metadata?.volumeRaw || 0);\n" +
        "  if (bWeight !== aWeight) return bWeight - aWeight;\n" +
        "  return String(a.id).localeCompare(String(b.id));\n" +
        "}\n" +
        "function nodeDisplayKind(node) { return node?.displayKind || node?.kind || \"wallet\"; }\n" +
        "function nodeIsServiceLike(node) { return [\"bridge\", \"cex\", \"smart_contract\", \"contract_adapter\", \"contract_router\", \"dex_contract\", \"service_boundary\"].includes(nodeDisplayKind(node)); }\n" +
        "function nodeIsSmartContractLaneNode() { return false; }\n" +
        "function nodeRadius(node) { return node?.kind === \"subject\" ? 31 : node?.kind === \"group\" || node?.displayKind === \"collapsed_group\" ? 29 : nodeIsServiceLike(node) ? 27 : 23; }\n" +
        "function nodeLayoutSide(node, subjectId, edges) {\n" +
        "  if (nodeIsServiceLike(node)) return \"service\";\n" +
        "  const incoming = edges.some((edge) => edge.fromNodeId === node.id && edge.toNodeId === subjectId);\n" +
        "  return incoming ? \"incoming\" : \"outgoing\";\n" +
        "}\n" +
        "function graphPaths() { return []; }\n" +
        "function asArray(value) { return Array.isArray(value) ? value : []; }\n" +
        "function nodeImportanceScore(node) { return Number(node.weight || 0); }\n" +
        layoutBlock +
        "; return { deepBranchMapLayout };",
    )();
    const branchChildren = Array.from({ length: 24 }, (_, index) => ({
      id: `a-child-${index}`,
      kind: index === 20 ? "group" : "wallet",
      displayKind: index === 20 ? "collapsed_group" : undefined,
      weight: 24 - index,
      metadata: { deepBranchAnchorId: "anchor-a" },
    }));
    const serviceChildren = Array.from({ length: 8 }, (_, index) => ({
      id: `service-${index}`,
      kind: "wallet",
      displayKind: "cex",
      weight: 12 - index,
      metadata: { deepBranchAnchorId: "anchor-b" },
    }));
    const stopChildren = Array.from({ length: 8 }, (_, index) => ({
      id: `stop-${index}`,
      kind: "wallet",
      displayKind: "trace_stop",
      weight: 8 - index,
      metadata: { deepBranchAnchorId: "anchor-b" },
    }));
    const nodes = [
      { id: "subject", kind: "subject", weight: 100 },
      { id: "anchor-a", kind: "wallet", weight: 80, metadata: { deepBranchAnchorId: "subject" } },
      { id: "anchor-b", kind: "wallet", weight: 70, metadata: { deepBranchAnchorId: "subject" } },
      { id: "bundle-a", kind: "group", displayKind: "funding_bundle", weight: 64, metadata: { deepBranchAnchorId: "anchor-a" } },
      { id: "bundle-member-a", kind: "wallet", weight: 65, metadata: { parentBundleId: "bundle-a", bundleMember: true } },
      ...branchChildren,
      ...serviceChildren,
      ...stopChildren,
    ];
    const edges = [
      { id: "subject-anchor-a", fromNodeId: "subject", toNodeId: "anchor-a" },
      { id: "anchor-b-subject", fromNodeId: "anchor-b", toNodeId: "subject" },
    ];

    const placed = api.deepBranchMapLayout(nodes, edges);
    const byId = placed.byId;
    const subject = byId.get("subject");
    const anchorA = byId.get("anchor-a");
    const anchorB = byId.get("anchor-b");
    const bundleA = byId.get("bundle-a");
    const bundleMemberA = byId.get("bundle-member-a");
    const childA = byId.get("a-child-0");
    const service = byId.get("service-0");
    const stop = byId.get("stop-0");
    const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
    const minDistance = placed.nodes.reduce((min: number, node: { id: string; x: number; y: number }, index: number) => {
      const nextMin = placed.nodes.slice(index + 1).reduce((innerMin: number, other: { x: number; y: number }) => Math.min(innerMin, distance(node, other)), min);
      return nextMin;
    }, Infinity);

    expect(placed.width).toBeLessThanOrEqual(2600);
    expect(placed.height).toBeLessThanOrEqual(1600);
    expect(Math.abs(subject.x - placed.width * 0.5)).toBeLessThan(1);
    expect(distance(childA, anchorA)).toBeLessThan(distance(childA, subject));
    expect(distance(childA, anchorA)).toBeLessThan(distance(childA, anchorB));
    expect(distance(bundleMemberA, bundleA)).toBeLessThan(distance(bundleMemberA, subject));
    expect(distance(bundleMemberA, anchorA)).toBeLessThan(distance(bundleMemberA, subject));
    expect(service.y).toBeLessThan(anchorB.y);
    expect(stop.y).toBeGreaterThan(anchorB.y);
    expect(minDistance).toBeGreaterThan(36);
  });

  it("keeps dense protected deep-check branch lanes from clamping into overlaps", () => {
    const html = adminConsoleHtml();
    const layoutBlock = html.slice(html.indexOf("function arrangeCluster"), html.indexOf("function legacyFanLayout"));
    const api = new Function(
      "const state = { graph: null };\n" +
      "function stableNodeSort(a, b) {\n" +
        "  const aWeight = Number(a.weight || a.score || a.metadata?.volumeRaw || 0);\n" +
        "  const bWeight = Number(b.weight || b.score || b.metadata?.volumeRaw || 0);\n" +
        "  if (bWeight !== aWeight) return bWeight - aWeight;\n" +
        "  return String(a.id).localeCompare(String(b.id));\n" +
        "}\n" +
        "function nodeDisplayKind(node) { return node?.displayKind || node?.kind || \"wallet\"; }\n" +
        "function nodeIsServiceLike(node) { return [\"bridge\", \"cex\", \"smart_contract\", \"contract_adapter\", \"contract_router\", \"dex_contract\", \"service_boundary\"].includes(nodeDisplayKind(node)); }\n" +
        "function nodeIsSmartContractLaneNode() { return false; }\n" +
        "function nodeRadius(node) { return node?.kind === \"subject\" ? 31 : node?.kind === \"group\" || node?.displayKind === \"collapsed_group\" ? 29 : nodeIsServiceLike(node) ? 27 : 23; }\n" +
        "function nodeLayoutSide(node, subjectId, edges) {\n" +
        "  if (nodeIsServiceLike(node)) return \"service\";\n" +
        "  const incoming = edges.some((edge) => edge.fromNodeId === node.id && edge.toNodeId === subjectId);\n" +
        "  return incoming ? \"incoming\" : \"outgoing\";\n" +
        "}\n" +
        "function graphPaths() { return []; }\n" +
        "function asArray(value) { return Array.isArray(value) ? value : []; }\n" +
        "function nodeImportanceScore(node) { return Number(node.weight || 0); }\n" +
        layoutBlock +
        "; return { deepBranchMapLayout };",
    )();
    const serviceNodes = Array.from({ length: 74 }, (_, index) => ({
      id: `dense-service-${index}`,
      kind: "wallet",
      displayKind: index % 2 ? "cex" : "bridge",
      weight: 300 - index,
      metadata: { deepBranchAnchorId: "anchor" },
    }));
    const stopNodes = Array.from({ length: 74 }, (_, index) => ({
      id: `dense-stop-${index}`,
      kind: "wallet",
      displayKind: "trace_stop",
      weight: 220 - index,
      metadata: { deepBranchAnchorId: "anchor" },
    }));
    const groupNodes = Array.from({ length: 36 }, (_, index) => ({
      id: `dense-group-${index}`,
      kind: "group",
      displayKind: "collapsed_group",
      weight: 120 - index,
      metadata: { deepBranchAnchorId: "anchor" },
    }));
    const nodes = [
      { id: "subject", kind: "subject", weight: 1000 },
      { id: "anchor", kind: "wallet", weight: 900, metadata: { deepBranchAnchorId: "subject" } },
      ...serviceNodes,
      ...stopNodes,
      ...groupNodes,
    ];
    const edges = [{ id: "subject-anchor", fromNodeId: "subject", toNodeId: "anchor" }];

    const placed = api.deepBranchMapLayout(nodes, edges);
    const protectedNodes = placed.nodes.filter((node: { id: string }) => node.id.startsWith("dense-"));
    const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
    const minCenterGap = protectedNodes.reduce((min: number, node: { x: number; y: number }, index: number) => {
      return protectedNodes.slice(index + 1).reduce((innerMin: number, other: { x: number; y: number }) => Math.min(innerMin, distance(node, other)), min);
    }, Infinity);
    const coordinateKeys = new Set(protectedNodes.map((node: { x: number; y: number }) => `${Math.round(node.x)}:${Math.round(node.y)}`));

    expect(placed.width).toBeLessThanOrEqual(4200);
    expect(placed.height).toBeLessThanOrEqual(2600);
    expect(coordinateKeys.size).toBe(protectedNodes.length);
    expect(minCenterGap).toBeGreaterThan(38);
  });

  it("builds a deep-check branch presentation without synthetic collapsed deep branch nodes", () => {
    const html = adminConsoleHtml();
    const presentationBlock = html.slice(html.indexOf("function buildDeepBranchPresentation"), html.indexOf("function buildWalletClusterPresentation"));
    const semanticAttrsBlock = html.slice(html.indexOf("function edgeSemanticAttrs"), html.indexOf("function renderGraph"));
    const renderBlock = html.slice(html.indexOf("function renderGraph"), html.indexOf("function isCollapsedGroupNodeId"));
    const graphPresentationBlock = html.slice(html.indexOf("function graphPresentation"), html.indexOf("function layout"));
    const deepLegendBlock = html.slice(html.indexOf('data-graph-legend="deep_branch_map"'), html.indexOf("function edgeSemanticAttrs"));

    expect(html).toContain("function buildDeepBranchPresentation");
    expect(html).toContain("function deepBranchStep1NodeIds");
    expect(presentationBlock).toContain("const anchorByNodeId = new Map();");
    expect(presentationBlock).toContain("anchorByNodeId.get(node.id)");
    expect(presentationBlock).not.toContain("anchorByNodeId.get(hiddenNodeId)");
    expect(html).not.toContain("function deepBranchSummaryNode");
    expect(html).toContain("function graphLegendHtml");
    expect(html).toContain("function edgeSemanticAttrs");
    expect(html).toContain("function nodeSemanticAttrs");
    expect(deepLegendBlock).toContain('data-graph-legend="deep_branch_map"');
    expect(deepLegendBlock).toContain("Real money flow");
    expect(deepLegendBlock).toContain("Grouped transfers");
    expect(deepLegendBlock).toContain("Context / peer");
    expect(deepLegendBlock).toContain("Service / CEX");
    expect(deepLegendBlock).toContain("Boundary stop");
    expect(deepLegendBlock).toContain("Contract context");
    expect(presentationBlock).toContain('metadata: {');
    expect(presentationBlock).toContain('deepBranchAnchorId');
    expect(presentationBlock).not.toContain('hiddenNodeIds');
    expect(presentationBlock).not.toContain('groupReason: "deep_branch_overview"');
    expect(presentationBlock).toContain('if (!state.servicesVisible && nodeIsServiceLike(node)) return false;');
    expect(presentationBlock).not.toContain('displayRole: "collapsed_group"');
    expect(semanticAttrsBlock).toContain('data-edge-role="');
    expect(semanticAttrsBlock).toContain('data-edge-directness="');
    expect(semanticAttrsBlock).toContain('data-node-display-kind="');
    expect(semanticAttrsBlock).toContain('data-deep-branch-anchor-id="');
    expect(renderBlock).toContain("edgeSemanticAttrs(edge, visualRole)");
    expect(renderBlock).toContain("nodeSemanticAttrs(node)");
    expect(renderBlock).toContain('graphLegendHtml(presentation.mode)');
    expect(graphPresentationBlock).toContain('} else if (mode === "deep_branch_map") {');
  });

  it("builds wallet cluster presentation with ordinary wallets separated from boundaries", () => {
    const html = adminConsoleHtml();
    const walletLayoutStart = html.includes("function arrangeWalletClusterLane")
      ? html.indexOf("function arrangeWalletClusterLane")
      : html.indexOf("function walletClusterLayout");
    const graphModeBlock = html.slice(html.indexOf("function graphIsDense"), html.indexOf("function buildDenseFanPresentation"));
    const presentationBlock = html.slice(html.indexOf("function walletClusterNodeRole"), html.indexOf("function applyExpandedBundlePresentation"));
    const layoutBlock = html.slice(walletLayoutStart, html.indexOf("function graphFirstLayout"));
    const graphPresentationBlock = html.slice(html.indexOf("function graphPresentation"), html.indexOf("function layout"));

    expect(html).toContain("function walletClusterNodeRole");
    expect(html).toContain("function buildWalletClusterPresentation");
    expect(html).toContain("function walletClusterLayout");
    expect(presentationBlock).toContain('walletClusterSummary: true');
    expect(presentationBlock).toContain('groupReason: "wallet_cluster_overview"');
    expect(layoutBlock).toContain('const laneNodes = { source: [], intermediate: [], subject: [], outgoing: [], contract: [], boundary: [], stop: [], group: [] };');
    expect(layoutBlock).toContain('walletClusterNodeRole(node, subjectId, sourceEdges)');
    expect(layoutBlock).toContain('relaxNodeCollisions(nodes, fixedNodeIds, 64)');
    expect(graphPresentationBlock).toContain('if (mode === "wallet_clusters") {');

    const api = new Function(`
      const state = {
        densityMode: "auto",
        servicesVisible: true,
        expandedBundleNodeIds: new Set(),
        graph: { job: { kind: "address_deep_check" } }
      };
      function stableNodeSort(a, b) {
        const aWeight = Number(a.weight || a.score || a.metadata?.volumeRaw || 0);
        const bWeight = Number(b.weight || b.score || b.metadata?.volumeRaw || 0);
        if (bWeight !== aWeight) return bWeight - aWeight;
        return String(a.id).localeCompare(String(b.id));
      }
      function nodeDisplayKind(node) {
        if (!node) return "wallet";
        if (node.displayKind) return node.displayKind;
        if (node.kind === "subject") return "subject_wallet";
        if (node.kind === "group") return "collapsed_group";
        return node.kind || "wallet";
      }
      function nodeIsServiceLike(node) {
        const kind = nodeDisplayKind(node);
        return kind === "bridge" || kind === "cex" || kind === "smart_contract" || kind === "contract_adapter" || kind === "contract_router" || kind === "dex_contract" || kind === "service_boundary";
      }
      function deepLocalOrbitRole(node) {
        const kind = nodeDisplayKind(node);
        if (kind === "trace_stop") return "stop";
        if (kind === "funding_bundle" || node.kind === "group" || node.displayKind === "collapsed_group") return "group";
        if (nodeIsServiceLike(node)) return "service";
        return "peer";
      }
      function edgeDisplayRole(edge) {
        return edge?.displayRole || "real_transfer";
      }
      function rawBigInt() {
        return null;
      }
      function nodeImportanceScore(node) {
        return Number(node.weight || node.score || 0);
      }
      function rankNodesByImportance(nodes, edges) {
        return [...nodes].sort((a, b) => nodeImportanceScore(b, edges) - nodeImportanceScore(a, edges) || String(a.id).localeCompare(String(b.id)));
      }
      function applyExpandedBundlePresentation(nodes, edges) {
        return { nodes, edges };
      }
      function deepBranchMapLayout(sourceNodes) {
        return { width: 1, height: 1, nodes: sourceNodes.map((node) => ({ ...node, x: 0, y: 0 })), byId: new Map() };
      }
      function nodeRadius(node) {
        return node.kind === "subject" ? 46 : 34;
      }
      function relaxNodeCollisions(nodes) {
        return nodes;
      }
      function constrainLayoutNodes(nodes) {
        return nodes;
      }
      ${graphModeBlock}
      ${presentationBlock}
      ${layoutBlock}
      ${graphPresentationBlock}
      return { walletClusterNodeRole, buildWalletClusterPresentation, walletClusterLayout, graphPresentation };
    `)();
    const nodes = [
      { id: "subject", kind: "subject", weight: 100 },
      { id: "source", kind: "wallet", weight: 90, metadata: { deepCheckWalletCluster: { nodeType: "ordinary_wallet" } } },
      { id: "intermediate", kind: "wallet", weight: 0, metadata: { deepCheckWalletCluster: { nodeType: "ordinary_wallet" } } },
      { id: "outgoing", kind: "wallet", weight: 80, metadata: { deepCheckWalletCluster: { nodeType: "ordinary_wallet" } } },
      { id: "cex", kind: "service", displayKind: "cex", weight: 2, metadata: { deepCheckWalletCluster: { nodeType: "boundary" } } },
      { id: "stop", kind: "stop", displayKind: "trace_stop", weight: 1, metadata: { deepCheckWalletCluster: { nodeType: "history_stop" } } },
      { id: "bundle", kind: "group", displayKind: "funding_bundle", weight: 1, metadata: { deepCheckWalletCluster: { nodeType: "funding_cluster" } } },
      { id: "contract", kind: "contract", weight: 3, metadata: { role: "contract_driven_contract" } },
      ...Array.from({ length: 78 }, (_, index) => ({
        id: "small-" + index,
        kind: "wallet",
        weight: 78 - index,
        metadata: { deepCheckWalletCluster: { nodeType: "ordinary_wallet" } },
      })),
    ];
    const edges = [
      { id: "source-subject", fromNodeId: "source", toNodeId: "subject" },
      { id: "intermediate-source", fromNodeId: "intermediate", toNodeId: "source" },
      { id: "subject-outgoing", fromNodeId: "subject", toNodeId: "outgoing" },
      { id: "outgoing-cex", fromNodeId: "outgoing", toNodeId: "cex" },
      { id: "intermediate-stop", fromNodeId: "intermediate", toNodeId: "stop" },
      { id: "bundle-source", fromNodeId: "bundle", toNodeId: "source" },
      { id: "source-contract", fromNodeId: "source", toNodeId: "contract", metadata: { evidenceType: "contract_trigger_context" } },
      ...Array.from({ length: 78 }, (_, index) => ({
        id: "small-" + index + "-intermediate",
        fromNodeId: "small-" + index,
        toNodeId: "intermediate",
      })),
      { id: "small-76-intermediate-duplicate", fromNodeId: "small-76", toNodeId: "intermediate" },
    ];

    expect(api.walletClusterNodeRole(nodes[1], "subject", edges)).toBe("source");
    expect(api.walletClusterNodeRole(nodes[2], "subject", edges)).toBe("intermediate");
    expect(api.walletClusterNodeRole(nodes[3], "subject", edges)).toBe("outgoing");
    expect(api.walletClusterNodeRole(nodes[4], "subject", edges)).toBe("boundary");
    expect(api.walletClusterNodeRole(nodes[5], "subject", edges)).toBe("stop");
    expect(api.walletClusterNodeRole(nodes[6], "subject", edges)).toBe("group");
    expect(api.walletClusterNodeRole(nodes.find((node) => node.id === "contract"), "subject", edges)).toBe("contract");

    const presentation = api.graphPresentation(nodes, edges);
    const byId = new Map(presentation.nodes.map((node: { id: string }) => [node.id, node]));
    const group = presentation.nodes.find((node: { metadata?: { walletClusterSummary?: boolean } }) => node.metadata?.walletClusterSummary);
    const collapsedEdges = presentation.edges.filter((edge: { fromNodeId?: string; toNodeId?: string; displayRole?: string }) =>
      edge.fromNodeId === "collapsed:wallet_cluster:intermediate" &&
      edge.toNodeId === "intermediate" &&
      edge.displayRole === "collapsed_group"
    );
    const collapsedEdge = collapsedEdges[0];

    expect(presentation.mode).toBe("wallet_clusters");
    expect(byId.get("source")).toMatchObject({ metadata: { walletClusterRole: "source" } });
    expect(byId.get("intermediate")).toMatchObject({ metadata: { walletClusterRole: "intermediate" } });
    expect(byId.get("outgoing")).toMatchObject({ metadata: { walletClusterRole: "outgoing" } });
    expect(byId.get("cex")).toMatchObject({ metadata: { walletClusterRole: "boundary" } });
    expect(byId.get("stop")).toMatchObject({ metadata: { walletClusterRole: "stop" } });
    expect(byId.get("bundle")).toMatchObject({ metadata: { walletClusterRole: "group" } });
    expect(byId.get("contract")).toMatchObject({ metadata: { walletClusterRole: "contract" } });
    expect(group).toMatchObject({
      kind: "group",
      displayKind: "collapsed_group",
      metadata: {
        walletClusterSummary: true,
        walletClusterRole: "intermediate",
        groupReason: "wallet_cluster_overview",
      },
    });
    expect(collapsedEdge).toMatchObject({
      fromNodeId: "collapsed:wallet_cluster:intermediate",
      toNodeId: "intermediate",
      type: "collapsed_group",
      displayRole: "collapsed_group",
      metadata: {
        groupKind: "intermediate",
        walletClusterSummary: true,
      },
    });
    expect(collapsedEdges).toHaveLength(1);
    expect(collapsedEdge.metadata.sourceEdgeIds).toEqual(expect.arrayContaining(["small-76-intermediate-duplicate", "small-77-intermediate"]));
    expect(collapsedEdge.metadata.sourceEdgeCount).toBe(collapsedEdge.metadata.sourceEdgeIds.length);
    expect(collapsedEdge.metadata.sourceEdgeCount).toBeGreaterThan(1);
    expect(collapsedEdge.metadata.sourceEdgeId).toBe(collapsedEdge.metadata.sourceEdgeIds[0]);
    expect(presentation.nodes.some((node: { metadata?: { groupReason?: string } }) => node.metadata?.groupReason === "deep_branch_overview")).toBe(false);

    const placed = api.walletClusterLayout(nodes.slice(0, 8), edges.slice(0, 7));
    const placedById = new Map(placed.nodes.map((node: { id: string }) => [node.id, node]));
    const subject = placedById.get("subject") as { x: number; y: number };
    const source = placedById.get("source") as { x: number; y: number };
    const intermediate = placedById.get("intermediate") as { x: number; y: number };
    const outgoing = placedById.get("outgoing") as { x: number; y: number };
    const boundary = placedById.get("cex") as { x: number; y: number };
    const stop = placedById.get("stop") as { x: number; y: number };
    const fundingGroup = placedById.get("bundle") as { x: number; y: number };
    const contract = placedById.get("contract") as { x: number; y: number };

    expect(source.x).toBeLessThan(subject.x);
    expect(intermediate.x).toBeLessThan(subject.x);
    expect(outgoing.x).toBeGreaterThan(subject.x);
    expect(boundary.x).toBeGreaterThan(outgoing.x);
    expect(stop.x).toBeGreaterThan(outgoing.x);
    expect(boundary.y).toBeLessThan(subject.y);
    expect(stop.y).toBeGreaterThan(subject.y);
    expect(fundingGroup.y).toBeGreaterThan(subject.y);
    expect(contract.y).toBeGreaterThan(subject.y);
  });

  it("classifies smart-contract scene nodes for a dedicated lane", () => {
    const html = adminConsoleHtml();
    const helperStart = html.indexOf("function nodeIsSmartContractLaneNode");
    const helperEnd = html.indexOf("function walletClusterNodeRole");

    expect(helperStart).toBeGreaterThan(-1);
    expect(helperEnd).toBeGreaterThan(helperStart);

    const helperBlock = html.slice(helperStart, helperEnd);

    const api = new Function(`
      function nodeDisplayKind(node) {
        if (!node) return "wallet";
        if (node.displayKind) return node.displayKind;
        if (node.kind === "subject") return "subject_wallet";
        return node.kind || "wallet";
      }
      ${helperBlock}
      return { nodeIsSmartContractLaneNode };
    `)() as {
      nodeIsSmartContractLaneNode(node: unknown): boolean;
    };

    const nodesById = new Map<string, unknown>([
      ["source", { id: "source", kind: "wallet" }],
      ["subject", { id: "subject", kind: "subject" }],
      ["plainContract", { id: "plainContract", kind: "contract" }],
      ["smartDisplay", { id: "smartDisplay", kind: "service", displayKind: "smart_contract" }],
      ["roleContract", { id: "roleContract", kind: "wallet", metadata: { role: "contract_driven_contract" } }],
    ]);

    expect(api.nodeIsSmartContractLaneNode(nodesById.get("source"))).toBe(false);
    expect(api.nodeIsSmartContractLaneNode(nodesById.get("plainContract"))).toBe(true);
    expect(api.nodeIsSmartContractLaneNode(nodesById.get("smartDisplay"))).toBe(true);
    expect(api.nodeIsSmartContractLaneNode(nodesById.get("roleContract"))).toBe(true);
  });

  it("keeps smart-contract nodes in separate lanes across wallet clusters, deep branch map, and show all raw", () => {
    const html = adminConsoleHtml();
    const helperStart = html.indexOf("function nodeIsSmartContractLaneNode");
    const helperEnd = html.indexOf("function walletClusterNodeRole");
    const graphModeBlock = html.slice(html.indexOf("function graphIsDense"), html.indexOf("function buildDenseFanPresentation"));
    const presentationBlock = html.slice(html.indexOf("function walletClusterNodeRole"), html.indexOf("function applyExpandedBundlePresentation"));
    const walletLayoutBlock = html.slice(html.indexOf("function arrangeWalletClusterLane"), html.indexOf("function graphFirstLayout"));
    const deepBranchBlock = html.slice(html.indexOf("function deepBranchMapLayout"), html.indexOf("function uniqueNodeIds"));
    const timelineBlock = html.slice(html.indexOf("function timelineLaneLayout"), html.indexOf("function arrangeStepOrbitLane"));

    expect(helperStart).toBeGreaterThan(-1);
    expect(helperEnd).toBeGreaterThan(helperStart);
    expect(walletLayoutBlock).toContain("contract");
    expect(deepBranchBlock).toContain("contract");
    expect(timelineBlock).toContain("contract");

    const helperBlock = html.slice(helperStart, helperEnd);
    const api = new Function(`
      const state = {
        densityMode: "auto",
        servicesVisible: true,
        expandedBundleNodeIds: new Set(),
        graph: { job: { kind: "address_deep_check" } }
      };
      function stableNodeSort(a, b) {
        const aWeight = Number(a.weight || a.score || a.metadata?.volumeRaw || 0);
        const bWeight = Number(b.weight || b.score || b.metadata?.volumeRaw || 0);
        if (bWeight !== aWeight) return bWeight - aWeight;
        return String(a.id).localeCompare(String(b.id));
      }
      function nodeDisplayKind(node) {
        if (!node) return "wallet";
        if (node.displayKind) return node.displayKind;
        if (node.kind === "subject") return "subject_wallet";
        if (node.kind === "group") return "collapsed_group";
        return node.kind || "wallet";
      }
      function nodeIsServiceLike(node) {
        const kind = nodeDisplayKind(node);
        return kind === "bridge" || kind === "cex" || kind === "smart_contract" || kind === "contract_adapter" || kind === "contract_router" || kind === "dex_contract" || kind === "service_boundary";
      }
      function nodeLayoutSide(node, subjectId, edges) {
        if (node.id === subjectId) return "subject";
        if (nodeIsServiceLike(node)) return "service";
        const incoming = edges.some((edge) => edge.toNodeId === subjectId && edge.fromNodeId === node.id);
        const outgoing = edges.some((edge) => edge.fromNodeId === subjectId && edge.toNodeId === node.id);
        if (incoming && !outgoing) return "incoming";
        if (outgoing && !incoming) return "outgoing";
        return "context";
      }
      function edgeDisplayRole(edge) {
        return edge?.displayRole || "real_transfer";
      }
      function rawBigInt() {
        return null;
      }
      function nodeImportanceScore(node) {
        return Number(node.weight || node.score || 0);
      }
      function rankNodesByImportance(nodes, edges) {
        return [...nodes].sort((a, b) => nodeImportanceScore(b, edges) - nodeImportanceScore(a, edges) || String(a.id).localeCompare(String(b.id)));
      }
      function applyExpandedBundlePresentation(nodes, edges) {
        return { nodes, edges };
      }
      function arrangeCluster(nodes, centerX, centerY, radiusX, radiusY) {
        return [...nodes].sort(stableNodeSort).map((node, index) => ({ ...node, x: centerX + index * 10, y: centerY + index * 10 }));
      }
      function nodeRadius(node) {
        return node.kind === "subject" ? 46 : 34;
      }
      function relaxNodeCollisions(nodes) {
        return nodes;
      }
      function constrainLayoutNodes(nodes) {
        return nodes;
      }
      ${graphModeBlock}
      ${helperBlock}
      ${presentationBlock}
      ${walletLayoutBlock}
      ${deepBranchBlock}
      ${timelineBlock}
      return { walletClusterNodeRole, buildWalletClusterPresentation, walletClusterLayout, deepBranchMapLayout, timelineLaneLayout };
    `)() as {
      walletClusterNodeRole(node: unknown, subjectId: string, edges: unknown[]): string;
      buildWalletClusterPresentation(nodes: unknown[], edges: unknown[]): { nodes: Array<{ id: string; metadata?: Record<string, unknown> }>; edges: unknown[] };
      walletClusterLayout(nodes: unknown[], edges: unknown[]): { nodes: Array<{ id: string; x: number; y: number }> };
      deepBranchMapLayout(nodes: unknown[], edges: unknown[]): { nodes: Array<{ id: string; x: number; y: number }> };
      timelineLaneLayout(nodes: unknown[], edges: unknown[]): { nodes: Array<{ id: string; x: number; y: number }> };
    };

    const nodes = [
      { id: "source", kind: "wallet", weight: 90 },
      { id: "contract", kind: "contract", weight: 80, metadata: { role: "contract_driven_contract" } },
      { id: "subject", kind: "subject", weight: 100 },
      { id: "peer", kind: "wallet", weight: 70 },
    ];
    const edges = [
      { id: "source-contract", fromNodeId: "source", toNodeId: "contract", metadata: { evidenceType: "contract_trigger_context" } },
      { id: "contract-subject", fromNodeId: "contract", toNodeId: "subject", metadata: { evidenceType: "contract_driven_transfer" } },
      { id: "peer-subject", fromNodeId: "peer", toNodeId: "subject", metadata: { evidenceType: "grouped_transfers" } },
    ];

    expect(api.walletClusterNodeRole(nodes[1], "subject", edges)).toBe("contract");

    const presentation = api.buildWalletClusterPresentation(nodes, edges);
    expect(presentation.nodes.find((node) => node.id === "contract")).toMatchObject({
      metadata: { walletClusterRole: "contract" },
    });

    const walletLayout = api.walletClusterLayout(nodes, edges);
    const walletById = new Map(walletLayout.nodes.map((node) => [node.id, node]));
    expect(walletById.get("contract")?.y).toBeGreaterThan(walletById.get("subject")?.y || 0);
    expect(walletById.get("contract")?.y).toBeGreaterThan(walletById.get("source")?.y || 0);

    const branchLayout = api.deepBranchMapLayout(nodes, edges);
    const branchById = new Map(branchLayout.nodes.map((node) => [node.id, node]));
    expect(branchById.get("contract")?.y).toBeGreaterThan(branchById.get("subject")?.y || 0);

    const rawLayout = api.timelineLaneLayout(nodes, edges);
    const rawById = new Map(rawLayout.nodes.map((node) => [node.id, node]));
    expect(rawById.get("contract")?.y).toBeGreaterThan(rawById.get("subject")?.y || 0);
    expect(rawById.get("contract")?.y).toBeGreaterThan(rawById.get("peer")?.y || 0);
  });

  it("preserves deep-check edge direction without replacing hidden branch nodes", () => {
    const html = adminConsoleHtml();
    const presentationBlock = html.slice(html.indexOf("function deepBranchStep1NodeIds"), html.indexOf("function applyExpandedBundlePresentation"));
    const api = new Function(
      "const state = { servicesVisible: true };\n" +
        "function stableNodeSort(a, b) {\n" +
        "  const aWeight = Number(a.weight || a.score || a.metadata?.volumeRaw || 0);\n" +
        "  const bWeight = Number(b.weight || b.score || b.metadata?.volumeRaw || 0);\n" +
        "  if (bWeight !== aWeight) return bWeight - aWeight;\n" +
        "  return String(a.id).localeCompare(String(b.id));\n" +
        "}\n" +
        "function nodeIsServiceLike() { return false; }\n" +
        "function nodeDisplayKind(node) { return node.displayKind || node.kind || \"wallet\"; }\n" +
        "function deepLocalOrbitRole(node) {\n" +
        "  const kind = nodeDisplayKind(node);\n" +
        "  if (kind === \"trace_stop\") return \"stop\";\n" +
        "  if (kind === \"funding_bundle\" || node.kind === \"group\" || node.displayKind === \"collapsed_group\") return \"group\";\n" +
        "  if (nodeIsServiceLike(node)) return \"service\";\n" +
        "  return \"peer\";\n" +
        "}\n" +
        presentationBlock +
        "; return { buildDeepBranchPresentation };",
    )();
    const nodes = [
      { id: "subject", kind: "subject", weight: 100 },
      { id: "anchor", kind: "wallet", weight: 50 },
      { id: "keep1", kind: "wallet", weight: 30 },
      { id: "keep2", kind: "wallet", weight: 20 },
      { id: "hiddenSource", kind: "wallet", weight: 10 },
    ];
    const edges = [
      { id: "subject-anchor", fromNodeId: "subject", toNodeId: "anchor" },
      { id: "anchor-keep1", fromNodeId: "anchor", toNodeId: "keep1" },
      { id: "anchor-keep2", fromNodeId: "anchor", toNodeId: "keep2" },
      { id: "hidden-anchor", fromNodeId: "hiddenSource", toNodeId: "anchor" },
    ];

    const presentation = api.buildDeepBranchPresentation(nodes, edges);
    const edge = presentation.edges.find((candidate: { id?: string }) => candidate.id === "hidden-anchor");
    const nodeIds = new Set(presentation.nodes.map((node: { id: string }) => node.id));

    expect(nodeIds.has("hiddenSource")).toBe(true);
    expect(nodeIds.has("collapsed:deep:anchor")).toBe(false);
    expect(edge).toMatchObject({
      fromNodeId: "hiddenSource",
      toNodeId: "anchor",
    });
  });

  it("preserves explicit deep branch anchors through presentation and layout", () => {
    const html = adminConsoleHtml();
    const presentationBlock = html.slice(html.indexOf("function deepBranchStep1NodeIds"), html.indexOf("function applyExpandedBundlePresentation"));
    const layoutBlock = html.slice(html.indexOf("function arrangeCluster"), html.indexOf("function legacyFanLayout"));
    const api = new Function(
      "const state = { servicesVisible: true, graph: null };\n" +
        "function stableNodeSort(a, b) {\n" +
        "  const aWeight = Number(a.weight || a.score || a.metadata?.volumeRaw || 0);\n" +
        "  const bWeight = Number(b.weight || b.score || b.metadata?.volumeRaw || 0);\n" +
        "  if (bWeight !== aWeight) return bWeight - aWeight;\n" +
        "  return String(a.id).localeCompare(String(b.id));\n" +
        "}\n" +
        "function nodeDisplayKind(node) { return node?.displayKind || node?.kind || \"wallet\"; }\n" +
        "function nodeIsServiceLike(node) { return [\"bridge\", \"cex\", \"smart_contract\", \"contract_adapter\", \"contract_router\", \"dex_contract\", \"service_boundary\"].includes(nodeDisplayKind(node)); }\n" +
        "function nodeIsSmartContractLaneNode() { return false; }\n" +
        "function nodeRadius(node) { return node?.kind === \"subject\" ? 31 : node?.kind === \"group\" || node?.displayKind === \"collapsed_group\" ? 29 : nodeIsServiceLike(node) ? 27 : 23; }\n" +
        "function nodeLayoutSide(node, subjectId, edges) {\n" +
        "  if (nodeIsServiceLike(node)) return \"service\";\n" +
        "  const incoming = edges.some((edge) => edge.fromNodeId === node.id && edge.toNodeId === subjectId);\n" +
        "  return incoming ? \"incoming\" : \"outgoing\";\n" +
        "}\n" +
        "function graphPaths() { return []; }\n" +
        "function asArray(value) { return Array.isArray(value) ? value : []; }\n" +
        "function nodeImportanceScore(node) { return Number(node.weight || 0); }\n" +
        "function deepLocalOrbitRole(node) {\n" +
        "  const kind = nodeDisplayKind(node);\n" +
        "  if (kind === \"trace_stop\") return \"stop\";\n" +
        "  if (kind === \"funding_bundle\" || node.kind === \"group\" || node.displayKind === \"collapsed_group\") return \"group\";\n" +
        "  if (nodeIsServiceLike(node)) return \"service\";\n" +
        "  return \"peer\";\n" +
        "}\n" +
        presentationBlock +
        layoutBlock +
        "; return { buildDeepBranchPresentation, deepBranchMapLayout };",
    )();
    const nodes = [
      { id: "subject", kind: "subject", weight: 100 },
      { id: "anchor-a", kind: "wallet", weight: 80 },
      { id: "anchor-b", kind: "wallet", weight: 70 },
      { id: "deep-child", kind: "wallet", weight: 60, metadata: { deepBranchAnchorId: "anchor-b" } },
    ];
    const edges = [
      { id: "subject-anchor-a", fromNodeId: "subject", toNodeId: "anchor-a" },
      { id: "subject-anchor-b", fromNodeId: "subject", toNodeId: "anchor-b" },
      { id: "anchor-a-deep-child", fromNodeId: "anchor-a", toNodeId: "deep-child" },
    ];

    const presentation = api.buildDeepBranchPresentation(nodes, edges);
    const child = presentation.nodes.find((node: { id?: string }) => node.id === "deep-child");
    const placed = api.deepBranchMapLayout(presentation.nodes, presentation.edges);
    const byId = placed.byId;
    const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

    expect(child?.metadata?.deepBranchAnchorId).toBe("anchor-b");
    expect(distance(byId.get("deep-child"), byId.get("anchor-b"))).toBeLessThan(distance(byId.get("deep-child"), byId.get("subject")));
  });

  it("shows funding bundles as expandable groups with right-rail internals", () => {
    const html = adminConsoleHtml();
    const walletDetailBlock = html.slice(html.indexOf("function walletDetailBlock"), html.indexOf("function transferDetailBlock"));

    expect(html).toContain("expandedBundleNodeIds: new Set()");
    expect(html).toContain("renderedNodesById: new Map()");
    expect(html).toContain("renderedEdgesById: new Map()");
    expect(html).toContain('id="expandSelected"');
    expect(html).toContain("function bundleCanvasLabel");
    expect(html).toContain('return "Group: " + memberCount + " wallets";');
    expect(html).toContain("function bundleSubLabel");
    expect(html).toContain("function applyBundleMemberVisibility");
    expect(html).toContain("function applyExpandedBundlePresentation");
    expect(html).toContain("function expandedBundleMemberNodes");
    expect(html).toContain("function expandedBundleMemberEdges");
    expect(html).toContain("const bundleVisible = applyBundleMemberVisibility(rawVisibleNodes, rawVisibleEdges);");
    expect(html).toContain("buildWalletClusterPresentation(bundleVisible.nodes, bundleVisible.edges)");
    expect(html).toContain("return { ...applyExpandedBundlePresentation(presentation.nodes, presentation.edges), mode, dense };");
    expect(html).toContain("function expandSelectedGraphItem");
    expect(html).toContain('state.expandedBundleNodeIds.add(state.selected.id);');
    expect(html).toContain('state.expandedBundleNodeIds.delete(state.selected.id);');
    expect(html).toContain('setStatus("Collapsed selected funding bundle.");');
    expect(html).toContain("function edgeById");
    expect(html).toContain("return graphNodes(state.graph).find((node) => node.id === nodeId) || state.renderedNodesById.get(nodeId) || null;");
    expect(html).toContain("return graphEdges(state.graph).find((edge) => edge.id === edgeId) || state.renderedEdgesById.get(edgeId) || null;");
    expect(html).toContain("state.renderedNodesById = new Map(placed.nodes.map((node) => [node.id, node]));");
    expect(html).toContain("state.renderedEdgesById = new Map(visibleEdges.map((edge) => [edge.id, edge]));");
    expect(html).toContain("function groupDetailBlock");
    expect(html).toContain("function groupKindExplanation");
    expect(html).toContain("function groupHiddenNodeLines");
    expect(html).toContain("This is a UI-collapsed display group, not a wallet.");
    expect(html).toContain("This is a saved funding bundle, not a wallet.");
    expect(html).toContain("function bundleInternalEdgeLines");
    expect(html).toContain("Known internal links");
    expect(html).toContain("External links");
    expect(html).toContain("Internal transfers were not found in saved graph data.");
    expect(walletDetailBlock).toContain('if (nodeDisplayKind(node) === "collapsed_group") return groupDetailBlock(node, graph);');
    expect(html).toContain('setStatus("No stored expansion data for this item. The right rail shows the available summary evidence.");');
    expect(html).toContain("Deep-check context can only expand stored groups, bundles, and known links.");
    expect(html).toContain('setStatus("Select a group, bundle, or boundary first.");');
    expect(html).toContain('setStatus("Boundary/context details are shown in the right rail. No stored raw expansion is available for this item.");');
    expect(html).toContain("Expand bundle");
  });

  it("hides stored funding bundle members while collapsed and shows them once when expanded", () => {
    const html = adminConsoleHtml();
    const presentationBlock = html.slice(html.indexOf("function applyBundleMemberVisibility"), html.indexOf("function nodeImportanceScore"));

    expect(presentationBlock).toContain("function applyBundleMemberVisibility");
    expect(presentationBlock).toContain('edge?.metadata?.bundleRole === "top_funder"');
    expect(presentationBlock).toContain("state.expandedBundleNodeIds.has(bundleNodeId)");
    expect(presentationBlock).toContain("storedMemberEdgesByBundleId");

    const api = new Function(`
      const state = { expandedBundleNodeIds: new Set() };
      function asArray(value) { return Array.isArray(value) ? value : []; }
      ${presentationBlock}
      return { applyExpandedBundlePresentation, state };
    `)() as {
      applyExpandedBundlePresentation(nodes: any[], edges: any[]): { nodes: any[]; edges: any[] };
      state: { expandedBundleNodeIds: Set<string> };
    };

    const nodes = [
      { id: "bundle", kind: "bundle", displayKind: "funding_bundle", metadata: { topFunders: [{ address: "TFunder", amountRaw: "100", txHashes: ["tx-fund"] }] } },
      { id: "target", kind: "wallet", address: "TTarget", metadata: {} },
      { id: "funder", kind: "wallet", address: "TFunder", metadata: {} }
    ];
    const edges = [
      { id: "member", fromNodeId: "funder", toNodeId: "bundle", metadata: { bundleNodeId: "bundle", bundleRole: "top_funder" } },
      { id: "target", fromNodeId: "bundle", toNodeId: "target", metadata: { bundleNodeId: "bundle", bundleRole: "bundle_to_hop" } }
    ];

    let presentation = api.applyExpandedBundlePresentation(nodes, edges);
    expect(presentation.edges.map((edge) => edge.id)).toEqual(["target"]);
    expect(presentation.nodes.map((node) => node.id)).toEqual(["bundle", "target"]);

    api.state.expandedBundleNodeIds.add("bundle");
    presentation = api.applyExpandedBundlePresentation(nodes, edges);
    expect(presentation.edges.map((edge) => edge.id).sort()).toEqual(["member", "target"]);
    expect(presentation.nodes.map((node) => node.id).sort()).toEqual(["bundle", "funder", "target"]);
    expect(presentation.nodes.filter((node) => String(node.id).startsWith("bundle-member:"))).toHaveLength(0);

    api.state.expandedBundleNodeIds.delete("bundle");
    presentation = api.applyExpandedBundlePresentation(
      [
        ...nodes,
        { id: "bundle-member:bundle:0", kind: "wallet", address: "TFunder", metadata: { parentBundleId: "bundle", bundleMember: true } }
      ],
      [
        ...edges,
        { id: "bundle-member-edge:bundle-member:bundle:0", fromNodeId: "bundle-member:bundle:0", toNodeId: "bundle", metadata: { parentBundleId: "bundle" } }
      ]
    );
    expect(presentation.nodes.map((node) => node.id)).toEqual(["bundle", "target"]);
    expect(presentation.edges.map((edge) => edge.id)).toEqual(["target"]);

    presentation = api.applyExpandedBundlePresentation(
      [
        nodes[0],
        nodes[1],
        { id: "bundle-member:bundle:orphan", kind: "wallet", address: "TOrphan", metadata: { parentBundleId: "bundle", bundleMember: true } }
      ],
      [edges[1]]
    );
    expect(presentation.nodes.map((node) => node.id)).toEqual(["bundle", "target"]);
    expect(presentation.edges.map((edge) => edge.id)).toEqual(["target"]);
  });

  it("toggles funding bundle expansion on double-click", () => {
    const html = adminConsoleHtml();
    const graphBlock = html.slice(html.indexOf('svg.querySelectorAll("[data-node-id]")'), html.indexOf('svg.querySelectorAll("[data-edge-id]")'));
    const expandBlock = html.slice(html.indexOf("function toggleNodeExpansion"), html.indexOf("function selectNode"));

    expect(graphBlock).toContain("const previousClick = state.lastNodeClick;");
    expect(graphBlock).toContain("const isDoubleClick = previousClick?.nodeId === nodeId && clickAt - previousClick.at <= 350;");
    expect(graphBlock).toContain("state.lastNodeClick = isDoubleClick ? null : { nodeId, at: clickAt };");
    expect(graphBlock).not.toContain('node.addEventListener("dblclick"');
    expect(graphBlock).toContain("toggleNodeExpansion(nodeId)");
    expect(expandBlock).toContain("function toggleNodeExpansion");
    expect(expandBlock).toContain("state.expandedBundleNodeIds.delete(nodeId)");
    expect(expandBlock).toContain("state.expandedBundleNodeIds.delete(state.selected.id)");
    expect(expandBlock).toContain("Collapsed selected funding bundle.");
  });

  it("explains non-expandable boundary context instead of silently doing nothing", () => {
    const html = adminConsoleHtml();
    const expandBlock = html.slice(html.indexOf("function expandSelectedGraphItem"), html.indexOf("function selectNode"));

    expect(expandBlock).toContain("Boundary/context details are shown in the right rail. No stored raw expansion is available for this item.");
    expect(expandBlock).toContain("No stored expansion data for this item. The right rail shows the available summary evidence.");
  });

  it("clears expanded funding bundle state when graph data changes", () => {
    const html = adminConsoleHtml();
    const clearGraphStateBlock = html.slice(html.indexOf("function clearGraphState"), html.indexOf("function renderCaseBrief"));
    const loadGraphSuccessBlock =
      html.match(/async function loadGraph\(jobId\) \{[\s\S]*?setStatus\("Graph loaded\. Wheel to zoom, drag to pan\."\);/)?.[0] || "";

    expect(clearGraphStateBlock).toContain("state.expandedBundleNodeIds.clear();");
    expect(clearGraphStateBlock).toContain("state.lastNodeClick = null;");
    expect(loadGraphSuccessBlock).toContain("state.expandedBundleNodeIds.clear();");
    expect(loadGraphSuccessBlock.indexOf("state.expandedBundleNodeIds.clear();")).toBeGreaterThan(loadGraphSuccessBlock.indexOf("state.activeJobId = jobId;"));
  });

  it("formats bundle detail endpoints without exposing raw bundle ids", () => {
    const html = adminConsoleHtml();
    const externalBlock = html.slice(html.indexOf("function bundleExternalEdgeLines"), html.indexOf("function bundleDetailBlock"));
    const selectedEdgeCardBlock = html.slice(html.indexOf("function selectedEdgeCard"), html.indexOf("function renderSelectionCard"));
    const transferDetailBlock = html.slice(html.indexOf("function transferDetailBlock"), html.indexOf("function fitGraph"));

    expect(html).toContain("function edgePrimaryTxHash");
    expect(html).toContain("function edgeHasAggregatedTxEvidence");
    expect(html).toContain("function bundleEndpointLabel");
    expect(html).toContain('if (nodeId === node?.id || String(nodeId || "").startsWith("bundle:")) return "Funding bundle";');
    expect(externalBlock).toContain("bundleEndpointLabel(node, edge.fromNodeId, edgeFromAddress(edge))");
    expect(externalBlock).toContain("bundleEndpointLabel(node, edge.toNodeId, edgeToAddress(edge))");
    expect(externalBlock).toContain("const txHash = edgePrimaryTxHash(edge);");
    expect(externalBlock).toContain('const tx = txHash ? " / tx " + short(txHash, 7) : "";');
    expect(html).toContain("function edgeEndpointLabel");
    expect(html).toContain("function endpointDetailLink");
    expect(html).toContain('if (String(nodeId || "").startsWith("bundle:")) return "Funding bundle";');
    expect(html).toContain('if (nodeDisplayKind(node) === "funding_bundle") return bundleCanvasLabel(node) || "Funding bundle";');
    expect(selectedEdgeCardBlock).toContain("selectedFlowHeaderHtml(edge, rows)");
    expect(selectedEdgeCardBlock).not.toContain('cardLineHtml("From", endpointDetailLink(edge, "from"))');
    expect(selectedEdgeCardBlock).not.toContain('cardLineHtml("To", endpointDetailLink(edge, "to"))');
    expect(transferDetailBlock).toContain('metricHtml("From", endpointDetailLink(edge, "from"), "wide")');
    expect(transferDetailBlock).toContain('metricHtml("To", endpointDetailLink(edge, "to"), "wide")');
    expect(selectedEdgeCardBlock).not.toContain('addressDetailLink(edgeToAddress(edge) || edge.toNodeId)');
    expect(transferDetailBlock).not.toContain("explorerLink(edgeToTronScanUrl(edge), edgeToAddress(edge) || edge.toNodeId)");
    expect(html).toContain('data-action="expand-bundle"');
    expect(html).toContain("function handleDetailActionClick");
    expect(html).toContain('if (action === "expand-bundle") {');
    expect(html).not.toContain('onclick="document.getElementById(&quot;expandSelected&quot;).click()"');
  });

  it("does not link grouped direct-counterparty aggregates to an arbitrary first tx hash", () => {
    const html = adminConsoleHtml();
    const helperBlock = html.slice(html.indexOf("function edgeHasAggregatedTxEvidence"), html.indexOf("function edgeTxTronScanUrl"));

    expect(helperBlock).toContain("function edgePrimaryTxHash");

    const api = new Function(
      "function asArray(value) { return Array.isArray(value) ? value : []; }" +
      helperBlock +
      "\nreturn { edgePrimaryTxHash, edgeHasAggregatedTxEvidence };"
    )() as {
      edgePrimaryTxHash(edge: unknown): string;
      edgeHasAggregatedTxEvidence(edge: unknown): boolean;
    };

    const groupedEdge = {
      txHash: null,
      metadata: {
        source: "directCounterpartyInteractionProfile",
        txHashes: ["tx-900", "tx-1100"],
        txCount: 2
      }
    };
    const singleEdge = {
      txHash: null,
      metadata: {
        source: "directCounterpartyInteractionProfile",
        txHashes: ["tx-only"],
        txCount: 1
      }
    };

    expect(api.edgeHasAggregatedTxEvidence(groupedEdge)).toBe(true);
    expect(api.edgePrimaryTxHash(groupedEdge)).toBe("");
    expect(api.edgeHasAggregatedTxEvidence(singleEdge)).toBe(false);
    expect(api.edgePrimaryTxHash(singleEdge)).toBe("tx-only");
    expect(api.edgePrimaryTxHash({ txHash: "real-tx", metadata: { txHashes: ["tx-ignored"], txCount: 2 } })).toBe("real-tx");
  });

  it("shows selected edge evidence type and projected context amount explanation", () => {
    const html = adminConsoleHtml();
    const selectedEdgeCardBlock = html.slice(html.indexOf("function selectedEdgeCard"), html.indexOf("function renderSelectionCard"));
    const transferDetailBlock = html.slice(html.indexOf("function transferDetailBlock"), html.indexOf("function fitGraph"));
    const helperBlock = html.slice(html.indexOf("function edgeMeaning"), html.indexOf("function bundleMemberCount"));

    expect(selectedEdgeCardBlock).not.toContain('cardLine("Evidence type", edgeEvidenceTypeLabel(edge))');
    expect(transferDetailBlock).toContain('metric("Evidence type", edgeEvidenceTypeLabel(edge))');
    expect(transferDetailBlock).toContain('metric("Evidence meaning", edgeEvidenceMeaning(edge), "wide")');
    expect(transferDetailBlock).toContain('metric("Aggregate amount", edgeAggregateAmountLabel(edge) || (isBoundaryContextEdge ? "Investigation boundary only. No money-flow edge is stored for this relationship." : "n/a"))');
    expect(transferDetailBlock).toContain('metric("Transfer count", edgeAggregateTransferCount(edge) ?? "n/a")');
    expect(transferDetailBlock).toContain('metricHtml("Underlying transactions", edgeTransactionEvidenceHtml(edge), "wide")');
    expect(transferDetailBlock).toContain('metricHtml("Tx hash", edgePrimaryTxDetailHtml(edge), "wide")');
    expect(transferDetailBlock).toContain("contractDrivenDetailBlock(edge)");
    expect(helperBlock).toContain("Smart-contract-driven USDT movement");
    expect(helperBlock).toContain("Operator called drainer/spender contract");
    expect(helperBlock).toContain("Victim -> receiver via smart contract");
  });

  it("renders contract-driven transfer evidence details in the selected flow panel", () => {
    const html = adminConsoleHtml();
    const helperBlock = html.slice(html.indexOf("function edgeEvidenceTypeLabel"), html.indexOf("function edgeUnderlyingTransferLines"));
    const directionBlock = html.slice(html.indexOf("function edgeDirectionMeaning"), html.indexOf("function bundleMemberCount"));
    const selectedEdgeCardBlock = html.slice(html.indexOf("function selectedEdgeCard"), html.indexOf("function renderSelectionCard"));
    const detailStart = html.indexOf("function contractDrivenDetailBlock");
    const detailBlock = html.slice(detailStart, html.indexOf("function selectedEdgeCard"));
    const executableDetailBlock = html.slice(html.indexOf("function sourcePostDebitActivityLabel"), html.indexOf("function selectedEdgeCard"));

    expect(detailStart).toBeGreaterThan(-1);
    expect(helperBlock).toContain('if (type === "contract_driven_transfer") return "Contract-driven USDT transfer";');
    expect(helperBlock).toContain('if (type === "contract_call_context") return "Contract call context";');
    expect(helperBlock).toContain('if (type === "debit_authority_context") return "Spender authority context";');
    expect(helperBlock).toContain('if (type === "contract_driven_transfer") return "USDT moved into the receiver through a smart-contract call. The source wallet is shown in the transaction evidence, not as a direct wallet-transfer line.";');
    expect(directionBlock).toContain('if (evidenceType === "contract_driven_transfer") return "spender contract -> receiver";');
    expect(html).toContain("function sourcePostDebitActivityLabel");
    expect(detailBlock).toContain('cardBlockHtml("Contract-driven evidence"');
    expect(detailBlock).toContain("USDT moved into the receiver through a smart-contract call. The source wallet is shown in the transaction evidence, not as a direct wallet-transfer line.");
    expect(detailBlock).toContain('metricHtml("Source wallet", addressDetailLink');
    expect(detailBlock).toContain('metricHtml("Spender contract", addressDetailLink');
    expect(detailBlock).toContain('metricHtml("Receiver", addressDetailLink');
    expect(detailBlock).toContain('metric("Method", metadata.method || "method n/a")');
    expect(detailBlock).toContain('metricHtml("Caller/operator", addressDetailLink');
    expect(detailBlock).toContain('metricHtml("Tx", edgePrimaryTxDetailHtml(edge), "wide")');
    expect(detailBlock).toContain('metric("Amount", edgeDetailedAmountLabel(edge) || edgeCanvasAmountLabel(edge) || "amount n/a")');
    expect(detailBlock).toContain('metric("Time", edgeTime(edge) || "time n/a")');
    expect(detailBlock).toContain('metric("Source activity", sourcePostDebitActivityLabel(metadata.sourcePostDebitActivity), "wide")');
    expect(selectedEdgeCardBlock).not.toContain("contractDrivenDetailBlock(edge)");

    const panelApi = new Function(`
      function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
      function edgeEvidenceType(edge) { return edge?.metadata?.evidenceType || ""; }
      function cardBlockHtml(label, html) { return '<section data-block="' + escapeHtml(label) + '">' + html + '</section>'; }
      function metric(label, value, cls = "") { return '<div data-metric="' + escapeHtml(label) + '" class="' + escapeHtml(cls) + '">' + escapeHtml(value) + '</div>'; }
      function metricHtml(label, html, cls = "") { return '<div data-metric="' + escapeHtml(label) + '" class="' + escapeHtml(cls) + '">' + html + '</div>'; }
      function addressDetailLink(address) { return '<a data-address="' + escapeHtml(address || "n/a") + '">' + escapeHtml(address || "n/a") + '</a>'; }
      function txDetailLink(txHash) { return '<a data-tx="' + escapeHtml(txHash || "inferred") + '">' + escapeHtml(txHash || "inferred") + '</a>'; }
      function edgePrimaryTxDetailHtml(edge) { return txDetailLink(edge?.txHash || "inferred"); }
      function edgeDetailedAmountLabel() { return "1.23 USDT"; }
      function edgeCanvasAmountLabel() { return ""; }
      function edgeTime() { return "Jun 25, 09:49"; }
      ${executableDetailBlock}
      return { contractDrivenDetailBlock };
    `)() as {
      contractDrivenDetailBlock(edge: unknown): string;
    };
    const edges = [
      {
        txHash: "contract-driven-tx",
        metadata: {
          evidenceType: "contract_driven_transfer",
          method: "transferFrom",
          callerAddress: "TCaller",
          spenderAddress: "TContract",
          sourceAddress: "TSource",
          receiverAddress: "TReceiver",
          sourcePostDebitActivity: { classification: { label: "quiet after debit" } }
        }
      },
      {
        metadata: {
          evidenceType: "approval_drain_transfer",
          method: "transferFrom",
          operatorAddress: "TOperator",
          spenderAddress: "TSpender",
          victimAddress: "TVictim",
          receiverAddress: "TReceiverDrain",
          sourcePostDebitActivity: { status: "checked" }
        }
      }
    ];

    for (const edge of edges) {
      const detailHtml = panelApi.contractDrivenDetailBlock(edge);

      expect(detailHtml).toContain("Contract-driven evidence");
      expect(detailHtml).toContain('data-metric="Meaning"');
      if (edge.metadata.evidenceType === "contract_driven_transfer") {
        expect(detailHtml).toContain("USDT moved into the receiver through a smart-contract call. The source wallet is shown in the transaction evidence, not as a direct wallet-transfer line.");
      }
      expect(detailHtml).toContain('data-metric="Method"');
      expect(detailHtml).toContain("transferFrom");
      expect(detailHtml).toContain('data-metric="Caller/operator"');
      expect(detailHtml).toContain('data-metric="Spender contract"');
      expect(detailHtml).toContain('data-metric="Source wallet"');
      expect(detailHtml).toContain('data-metric="Receiver"');
      expect(detailHtml).toContain('data-metric="Tx"');
      expect(detailHtml).toContain('data-metric="Amount"');
      expect(detailHtml).toContain("1.23 USDT");
      expect(detailHtml).toContain('data-metric="Time"');
      expect(detailHtml).toContain("Jun 25, 09:49");
      expect(detailHtml).toContain('data-metric="Source activity"');
      expect(detailHtml).toContain('data-metric="Proof level" class="">n/a');
    }
    expect(panelApi.contractDrivenDetailBlock(edges[0])).toContain("TCaller");
    expect(panelApi.contractDrivenDetailBlock(edges[0])).toContain("TContract");
    expect(panelApi.contractDrivenDetailBlock(edges[0])).toContain("TSource");
    expect(panelApi.contractDrivenDetailBlock(edges[0])).toContain("TReceiver");
    expect(panelApi.contractDrivenDetailBlock(edges[0])).toContain("quiet after debit");
    expect(panelApi.contractDrivenDetailBlock(edges[1])).toContain("TOperator");
    expect(panelApi.contractDrivenDetailBlock(edges[1])).toContain("TSpender");
    expect(panelApi.contractDrivenDetailBlock(edges[1])).toContain("TVictim");
    expect(panelApi.contractDrivenDetailBlock(edges[1])).toContain("TReceiverDrain");
    expect(panelApi.contractDrivenDetailBlock(edges[1])).toContain("checked");
  });

  it("renders contract trigger context as source debit contract evidence", () => {
    const html = adminConsoleHtml();
    const helperBlock = html.slice(html.indexOf("function edgeMeaning"), html.indexOf("function bundleMemberCount"));
    const detailBlock = html.slice(html.indexOf("function sourcePostDebitActivityLabel"), html.indexOf("function selectedEdgeCard"));
    const selectedEdgeCardBlock = html.slice(html.indexOf("function selectedEdgeCard"), html.indexOf("function renderSelectionCard"));
    const wrapperBlock = html.match(/function selectedEdgeCardBlock\(edge\) \{[\s\S]*?\n    \}/)?.[0] || "";
    const extraClassBlock = html.slice(html.indexOf("function edgeExtraClass"), html.indexOf("function edgeStrokeWidth"));
    const contextCssBlock = html.slice(html.indexOf(".edge.edge-contract-trigger-context"), html.indexOf(".edge-flow-service"));

    expect(helperBlock).toContain('if (type === "contract_trigger_context") return "Contract trigger context";');
    expect(helperBlock).toContain("This source wallet was debited through the spender contract. The receiver-side inflow is grouped on the contract-to-wallet edge.");
    expect(helperBlock).toContain('if (evidenceType === "contract_trigger_context") return "source -> spender contract";');
    expect(detailBlock).toContain('type !== "contract_trigger_context"');
    expect(detailBlock).toContain("Source debit routed through this spender contract. Open the transaction list to inspect the debit event.");
    expect(detailBlock).toContain('metricHtml("Related debit tx", txDetailLink(relatedDebitTx), "wide")');
    expect(detailBlock).toContain('const proofLevel = metadata.proofLevel || (type === "contract_trigger_context" ? "context" : "n/a");');
    expect(detailBlock).toContain('metric("Proof level", proofLevel)');
    expect(selectedEdgeCardBlock).not.toContain("contractDrivenDetailBlock(edge)");
    expect(extraClassBlock).toContain('if (evidenceType === "contract_trigger_context") classes.push("edge-contract-trigger-context");');
    expect(extraClassBlock.indexOf('if (evidenceType === "contract_trigger_context")')).toBeLessThan(
      extraClassBlock.indexOf('if (source === "directCounterpartyInteractionProfile" && count && count > 1) {')
    );
    expect(contextCssBlock).toContain("stroke: var(--semantic-contract);");
    expect(contextCssBlock).toMatch(/stroke-dasharray: 6 8/);
    expect(contextCssBlock).toContain("opacity: .72;");
    expect(contextCssBlock).toContain(".edge.edge-contract-driven-transfer");

    const helperApi = new Function(`
      function edgeEvidenceType(edge) { return edge?.metadata?.evidenceType || ""; }
      function edgeDisplayRole(edge) { return edge?.displayRole || "real_transfer"; }
      ${helperBlock}
      return { edgeEvidenceTypeLabel, edgeMeaning, edgeEvidenceMeaning, edgeDirectionMeaning };
    `)() as {
      edgeEvidenceTypeLabel(edge: unknown): string;
      edgeMeaning(edge: unknown): string;
      edgeEvidenceMeaning(edge: unknown): string;
      edgeDirectionMeaning(edge: unknown): string;
    };
    const edge = {
      txHash: "edge-tx",
      metadata: {
        evidenceType: "contract_trigger_context",
        source: "directCounterpartyInteractionProfile",
        method: "transferFrom",
        callerAddress: "TCaller",
        contractAddress: "TContract",
        sourceAddress: "TSource",
        receiverAddress: "TReceiver",
        relatedDebitTxHash: "debit-tx",
        sourcePostDebitActivity: { classification: { label: "quiet after debit" } }
      }
    };

    expect(helperApi.edgeEvidenceTypeLabel(edge)).toBe("Contract trigger context");
    expect(helperApi.edgeMeaning(edge)).toBe("Contract trigger context");
    expect(helperApi.edgeEvidenceMeaning(edge)).toBe("This source wallet was debited through the spender contract. The receiver-side inflow is grouped on the contract-to-wallet edge.");
    expect(helperApi.edgeDirectionMeaning(edge)).toBe("source -> spender contract");

    const classApi = new Function(`
      const state = { graph: { job: { kind: "address_deep_check" } } };
      function edgeDisplayRole(edge) { return edge?.displayRole || "real_transfer"; }
      function edgeAggregateTransferCount(edge) { return edge?.metadata?.aggregateTransferCount || 1; }
      function edgeIsGroupedContextEvidence(edge) { return edge?.metadata?.evidenceType === "grouped_transfers" || Number(edge?.metadata?.aggregateTransferCount || 0) > 1; }
      ${extraClassBlock}
      return { edgeExtraClass };
    `)() as { edgeExtraClass(edge: unknown, visualRole: string): string };

    expect(classApi.edgeExtraClass(edge, "context")).toBe(" edge-contract-trigger-context");
    expect(classApi.edgeExtraClass(edge, "context")).not.toContain("edge-deep-wallet-transfer");
    expect(classApi.edgeExtraClass(edge, "service")).toBe(" edge-contract-trigger-context");
    expect(classApi.edgeExtraClass({
      type: "transfer",
      metadata: {
        evidenceType: "contract_driven_transfer",
        source: "contractDrivenTransferProfile"
      }
    }, "context")).toBe(" edge-contract-driven-transfer");
    expect(classApi.edgeExtraClass({
      type: "transfer",
      metadata: {
        evidenceType: "contract_driven_transfer",
        source: "directCounterpartyInteractionProfile",
        aggregateTransferCount: 2
      }
    }, "context")).not.toContain("edge-deep-grouped-transfer");

    const panelApi = new Function(`
      function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
      function edgeEvidenceType(edge) { return edge?.metadata?.evidenceType || ""; }
      function cardLine(label, value) { return '<div data-line="' + escapeHtml(label) + '">' + escapeHtml(value || "n/a") + '</div>'; }
      function cardLineHtml(label, html) { return '<div data-line="' + escapeHtml(label) + '">' + html + '</div>'; }
      function cardBlockHtml(label, html) { return '<section data-block="' + escapeHtml(label) + '">' + html + '</section>'; }
      function asArray(value) { return Array.isArray(value) ? value : value === null || value === undefined ? [] : [value]; }
      function analystBadge(label) { return '<span>' + escapeHtml(label) + '</span>'; }
      function analystIntroBlock(title, text, badges = []) { return '<div data-intro="' + escapeHtml(title) + '">' + asArray(badges).join("") + escapeHtml(text || "") + '</div>'; }
      function analystRawFactsBlock(title, rows) { return cardBlockHtml(title, asArray(rows).filter(Boolean).join("")); }
      function analystEvidenceKind() { return "Contract context"; }
      function analystEvidenceMeaning(edge) { return edgeEvidenceMeaning(edge); }
      function analystEvidenceBadgeClass() { return "contract"; }
      function edgeIsGroupedContextEvidence() { return false; }
      function edgeDisplayRole() { return "profile_context"; }
      function metric(label, value, cls = "") { return '<div data-metric="' + escapeHtml(label) + '" class="' + escapeHtml(cls) + '">' + escapeHtml(value) + '</div>'; }
      function metricHtml(label, html, cls = "") { return '<div data-metric="' + escapeHtml(label) + '" class="' + escapeHtml(cls) + '">' + html + '</div>'; }
      function addressDetailLink(address) { return '<a>' + escapeHtml(address || "n/a") + '</a>'; }
      function txDetailLink(txHash) { return '<a>' + escapeHtml(txHash || "inferred") + '</a>'; }
      function walletClusterEdgeLabel() { return ""; }
      function walletClusterRelationshipLabel() { return ""; }
      function edgeEvidenceTypeLabel() { return "Contract trigger context"; }
      function edgeEvidenceMeaning() { return "Source debit routed through this spender contract. Open the transaction list to inspect the debit event."; }
      function edgeMeaning() { return "Contract trigger context"; }
      function edgeDirectionMeaning() { return "source -> spender contract"; }
      function edgeDetailedAmountLabel() { return ""; }
      function edgeCanvasAmountLabel() { return ""; }
      function boundaryOnlyCopy() { return "boundary"; }
      function edgeTime() { return "time n/a"; }
      function edgeTxGap() { return "n/a"; }
      function endpointDetailLink(edge, side) { return side; }
      function edgePrimaryTxDetailHtml() { return "tx"; }
      function edgeTransactionEvidenceHtml() { return "evidence"; }
      function selectedFlowTransferRows() { return []; }
      function selectedFlowHeaderHtml() { return '<div>flow header</div>'; }
      function selectedFlowTransactionListHtml() { return '<div>flow rows</div>'; }
      function selectedFlowPrimaryBodyHtml() { return '<div>flow rows</div>'; }
      function selectedFlowDebugHtml() { return '<details><summary>Debug</summary></details>'; }
      function reciprocalFlowHtml() { return ""; }
      function edgePathId() { return "path-a"; }
      ${detailBlock}
      ${selectedEdgeCardBlock}
      ${wrapperBlock}
      return { contractDrivenDetailBlock, selectedEdgeCardBlock };
    `)() as {
      contractDrivenDetailBlock(edge: unknown): string;
      selectedEdgeCardBlock(edge: unknown): string;
    };
    const detailHtml = panelApi.contractDrivenDetailBlock(edge);
    const selectedHtml = panelApi.selectedEdgeCardBlock(edge);

    expect(detailHtml).toContain("Contract-driven evidence");
    expect(detailHtml).toContain("Source debit routed through this spender contract. Open the transaction list to inspect the debit event.");
    expect(detailHtml).toContain("transferFrom");
    expect(detailHtml).toContain("TCaller");
    expect(detailHtml).toContain("TContract");
    expect(detailHtml).toContain("TSource");
    expect(detailHtml).toContain("TReceiver");
    expect(detailHtml).toContain("debit-tx");
    expect(detailHtml).toContain('data-metric="Proof level" class="">context');
    expect(detailHtml).toContain("quiet after debit");
    expect(selectedHtml).not.toContain("Source debit routed through this spender contract. Open the transaction list to inspect the debit event.");
    expect(selectedHtml).toContain("flow header");
  });

  it("assigns category-colored classes to service context edges", () => {
    const html = adminConsoleHtml();
    const cssBlock = html.slice(html.indexOf(".edge.edge-service-cex"), html.indexOf(".node.selected.node-display-cex"));
    const serviceClassBlock = html.slice(html.indexOf("function serviceEdgeTone"), html.indexOf("function edgeStrokeWidth"));

    expect(cssBlock).toContain(".edge.edge-service-cex");
    expect(cssBlock).toContain(".edge.edge-service-bridge");
    expect(cssBlock).toContain(".edge.edge-service-dex");
    expect(cssBlock).toContain(".edge.edge-service-contract");
    expect(cssBlock).toContain(".edge.edge-service-context");

    const classApi = new Function(`
      const state = { graph: { job: { kind: "where_is_money_check" } } };
      const nodes = new Map([
        ["wallet", { displayKind: "wallet" }],
        ["cex", { displayKind: "cex" }],
        ["bridge", { displayKind: "bridge" }],
        ["dex", { displayKind: "contract_router" }],
        ["contract", { displayKind: "smart_contract" }],
        ["service", { displayKind: "service_boundary" }]
      ]);
      function nodeById(id) { return nodes.get(id) || null; }
      function nodeDisplayKind(node) { return node?.displayKind || "wallet"; }
      function edgeAggregateTransferCount(edge) { return edge?.metadata?.aggregateTransferCount || 1; }
      function edgeDisplayRole(edge) { return edge?.displayRole || "real_transfer"; }
      function edgeIsGroupedContextEvidence(edge) { return edge?.metadata?.evidenceType === "grouped_transfers" || Number(edge?.metadata?.aggregateTransferCount || 0) > 1; }
      ${serviceClassBlock}
      return { edgeExtraClass };
    `)() as { edgeExtraClass(edge: unknown, visualRole: string): string };

    expect(classApi.edgeExtraClass({ fromNodeId: "cex", toNodeId: "wallet", metadata: {} }, "service")).toContain("edge-service-cex");
    expect(classApi.edgeExtraClass({ fromNodeId: "wallet", toNodeId: "bridge", metadata: {} }, "service")).toContain("edge-service-bridge");
    expect(classApi.edgeExtraClass({ fromNodeId: "dex", toNodeId: "wallet", metadata: {} }, "service")).toContain("edge-service-dex");
    expect(classApi.edgeExtraClass({ fromNodeId: "contract", toNodeId: "wallet", metadata: {} }, "service")).toContain("edge-service-contract");
    expect(classApi.edgeExtraClass({ fromNodeId: "service", toNodeId: "wallet", metadata: {} }, "service")).toContain("edge-service-context");
    expect(classApi.edgeExtraClass({
      fromNodeId: "contract",
      toNodeId: "wallet",
      metadata: { evidenceType: "contract_driven_transfer" }
    }, "service")).toBe(" edge-contract-driven-transfer");
  });

  it("keeps incoming deposit directed transfers colored by direction", () => {
    const html = adminConsoleHtml();
    const extraClassBlock = html.slice(html.indexOf("function edgeExtraClass"), html.indexOf("function edgeStrokeWidth"));

    expect(extraClassBlock).toContain('(visualRole === "context" || visualRole === "peer")');

    const classApi = new Function(`
      const state = { graph: { job: { kind: "incoming_deposit_check" } } };
      function edgeDisplayRole(edge) { return edge?.displayRole || "real_transfer"; }
      function edgeAggregateTransferCount(edge) { return edge?.metadata?.aggregateTransferCount || null; }
      function edgeIsGroupedContextEvidence(edge) { return edge?.metadata?.evidenceType === "grouped_transfers" || Number(edge?.metadata?.aggregateTransferCount || 0) > 1; }
      ${extraClassBlock}
      return { edgeExtraClass };
    `)() as { edgeExtraClass(edge: unknown, visualRole: string): string };

    const edge = { type: "transfer", metadata: {} };
    expect(classApi.edgeExtraClass(edge, "incoming")).toBe("");
    expect(classApi.edgeExtraClass(edge, "outgoing")).toBe("");
    expect(classApi.edgeExtraClass(edge, "context")).toBe(" edge-incoming-wallet-transfer");
    expect(classApi.edgeExtraClass(edge, "peer")).toBe(" edge-incoming-wallet-transfer");
  });

  it("explains boundary context edges without stored transfer evidence", () => {
    const html = adminConsoleHtml();
    const block = html.match(/function transferDetailBlock\(edge\) \{[\s\S]*?\n    \}(?=\n    function selectedEdgeCardBlock)/)?.[0] || "";

    expect(block).toContain("Projected context");
    expect(block).toContain("no individual underlying transactions were stored");
    expect(block).toContain("Investigation boundary only. No money-flow edge is stored for this relationship.");
    expect(block).toContain("Grouped boundary evidence");
    expect(block).toContain("Detailed tx rows are not stored");
  });

  it("uses analyst workbench graph legend categories", () => {
    const html = adminConsoleHtml();
    const legendBlock = html.slice(html.indexOf("function graphLegendHtml"), html.indexOf("function edgeSemanticAttrs"));
    const walletLegendBlock = legendBlock.slice(legendBlock.indexOf('data-graph-legend="wallet_clusters"'), legendBlock.indexOf('data-graph-legend="deep_branch_map"'));
    const deepLegendBlock = legendBlock.slice(legendBlock.indexOf('data-graph-legend="deep_branch_map"'));

    expect(walletLegendBlock).toContain('item("direct", "Real money flow")');
    expect(walletLegendBlock).toContain('item("group", "Grouped transfers")');
    expect(walletLegendBlock).toContain('item("inferred", "Context / peer")');
    expect(walletLegendBlock).toContain('item("service", "Service / CEX")');
    expect(walletLegendBlock).toContain('item("boundary", "Boundary stop")');
    expect(walletLegendBlock).toContain('item("contract", "Contract context")');
    expect(deepLegendBlock).toContain('item("direct", "Real money flow")');
    expect(deepLegendBlock).toContain('item("group", "Grouped transfers")');
    expect(deepLegendBlock).toContain('item("inferred", "Context / peer")');
    expect(deepLegendBlock).toContain('item("service", "Service / CEX")');
    expect(deepLegendBlock).toContain('item("boundary", "Boundary stop")');
    expect(deepLegendBlock).toContain('item("contract", "Contract context")');

    expect(html).toContain(".legend-swatch.contract");
    expect(html).toContain("border-color: var(--semantic-contract);");
    expect(html).toContain(".edge-flow-incoming { stroke: var(--semantic-money-in); }");
    expect(html).toContain(".edge-flow-outgoing { stroke: var(--semantic-money-out); }");
    expect(html).toContain(".edge.edge-deep-grouped-transfer");
    expect(html).toContain("stroke: var(--semantic-grouped);");
  });

  it("tokenizes grouped reciprocal edge styling", () => {
    const html = adminConsoleHtml();
    const groupedReciprocalCssBlock = html.slice(
      html.indexOf(".edge.edge-deep-grouped-transfer.edge-reciprocal-flow"),
      html.indexOf(".edge.edge-deep-grouped-transfer.edge-reciprocal-flow.selected")
    );

    expect(groupedReciprocalCssBlock).toContain(".edge.edge-deep-grouped-transfer.edge-reciprocal-flow");
    expect(groupedReciprocalCssBlock).toContain("stroke: var(--semantic-grouped);");
    expect(groupedReciprocalCssBlock).toContain("opacity: .72;");
  });

  it("explains wallet cluster evidence in legend and selected details", () => {
    const html = adminConsoleHtml();
    const legendBlock = html.slice(html.indexOf("function graphLegendHtml"), html.indexOf("function edgeSemanticAttrs"));
    const helperBlock = html.slice(html.indexOf("function edgeEvidenceTypeLabel"), html.indexOf("function edgeUnderlyingTransferLines"));
    const selectedNodeCardBlock = html.slice(html.indexOf("function selectedNodeCard"), html.indexOf("function selectedEdgeCard"));
    const selectedEdgeCardBlock = html.slice(html.indexOf("function selectedEdgeCard"), html.indexOf("function renderSelectionCard"));
    const walletDetailBlock = html.slice(html.indexOf("function walletDetailBlock"), html.indexOf("function transferDetailBlock"));
    const transferDetailBlock = html.slice(html.indexOf("function transferDetailBlock"), html.indexOf("function fitGraph"));

    expect(legendBlock).toContain('data-graph-legend="wallet_clusters"');
    expect(legendBlock).toContain("Real money flow");
    expect(legendBlock).toContain("Grouped transfers");
    expect(legendBlock).toContain("Context / peer");
    expect(legendBlock).toContain("Service / CEX");
    expect(legendBlock).toContain("Boundary stop");
    expect(legendBlock).toContain("Contract context");
    expect(html).toContain("function walletClusterNodeRoleLabel");
    expect(html).toContain("function walletClusterEdgeLabel");
    expect(html).toContain("function walletClusterRelationshipLabel");
    expect(selectedNodeCardBlock).toContain('cardLine("DeepCheck wallet-cluster role", clusterRole)');
    expect(selectedNodeCardBlock).toContain("escapeHtml(walletClusterNodeContextNote(node))");
    expect(walletDetailBlock).toContain('metric("DeepCheck wallet-cluster role", clusterRole, "wide")');
    expect(walletDetailBlock).toContain('metric("Wallet-cluster note", walletClusterNodeContextNote(node), "wide")');
    expect(html).toContain("This wallet was observed in the DeepCheck graph.");
    expect(html).toContain("A role here explains graph context; it is not a standalone completed wallet check unless the right rail says so.");
    expect(html).toContain("This is context, not proof of common ownership.");
    expect(selectedEdgeCardBlock).not.toContain('cardLine("Wallet-cluster evidence", walletClusterEdge || "Graph context")');
    expect(selectedEdgeCardBlock).not.toContain('cardLine("Wallet-cluster relationship", walletClusterRelationship || "Context relationship")');
    expect(transferDetailBlock).toContain('metric("Wallet-cluster evidence", walletClusterEdge || "Graph context")');
    expect(transferDetailBlock).toContain('metric("Wallet-cluster relationship", walletClusterRelationship || "Context relationship")');

    const api = new Function(`
      const state = { graph: { job: { kind: "address_deep_check" } } };
      function graphKindUsesWalletClusters(kind) { return kind === "address_deep_check"; }
      function nodeDisplayKind(node) { return node?.displayKind || node?.kind || "wallet"; }
      ${helperBlock}
      return { walletClusterNodeRoleLabel, walletClusterNodeContextNote, walletClusterEdgeLabel, walletClusterRelationshipLabel };
    `)();

    expect(api.walletClusterNodeRoleLabel({ metadata: { walletClusterRole: "source" } })).toBe("Source wallet");
    expect(api.walletClusterNodeRoleLabel({ metadata: { walletClusterRole: "contract" } })).toBe("Smart-contract lane");
    expect(api.walletClusterNodeContextNote({ metadata: { walletClusterRole: "contract" } })).toBe("This smart contract is shown as graph context for contract-driven movement; it is not a wallet or proof of common ownership.");
    expect(api.walletClusterNodeRoleLabel({ metadata: { deepCheckWalletCluster: { nodeType: "ordinary_wallet" } } })).toBe("Intermediate wallet");
    expect(api.walletClusterNodeRoleLabel({ metadata: { deepCheckWalletCluster: { nodeType: "boundary" } } })).toBe("Service/boundary");
    expect(api.walletClusterNodeRoleLabel({ metadata: { deepCheckWalletCluster: { nodeType: "history_stop" } } })).toBe("Investigation stop");
    expect(api.walletClusterEdgeLabel({ metadata: { deepCheckWalletCluster: { edgeType: "proven_transaction" } } })).toBe("Proven transaction");
    expect(api.walletClusterEdgeLabel({ type: "transfer", txHash: "ctx-transfer", metadata: { evidenceType: "contract_driven_transfer" } })).toBe("Contract-driven transfer");
    expect(api.walletClusterRelationshipLabel({ type: "transfer", txHash: "ctx-transfer", metadata: { evidenceType: "contract_driven_transfer" } })).toBe("Smart contract -> receiver transfer");
    expect(api.walletClusterEdgeLabel({ type: "transfer", txHash: "ctx-trigger", metadata: { evidenceType: "contract_trigger_context" } })).toBe("Contract trigger context");
    expect(api.walletClusterRelationshipLabel({ type: "transfer", txHash: "ctx-trigger", metadata: { evidenceType: "contract_trigger_context" } })).toBe("Source wallet -> spender contract");
    expect(api.walletClusterEdgeLabel({ displayRole: "collapsed_group", metadata: { walletClusterSummary: true } })).toBe("Grouped/collapsed transfers");
    expect(api.walletClusterEdgeLabel({ displayRole: "profile_context" })).toBe("Peer/context");
    expect(api.walletClusterEdgeLabel({ type: "service_boundary" })).toBe("Service/boundary context");
    expect(api.walletClusterEdgeLabel({ type: "stop" })).toBe("History stop");
    expect(api.walletClusterRelationshipLabel({ metadata: { deepCheckWalletCluster: { relationship: "shared_service_or_boundary" } } })).toBe("Shared service/boundary context - not proof of common ownership");
  });

  it("does not show wallet cluster evidence for generic non-wallet-cluster transfer details", () => {
    const html = adminConsoleHtml();
    const helperBlock = html.slice(html.indexOf("function edgeEvidenceTypeLabel"), html.indexOf("function edgeUnderlyingTransferLines"));
    const reciprocalFlowBlock = html.slice(html.indexOf("function reciprocalFlowHtml"), html.indexOf("function selectedEdgeCard"));
    const selectedEdgeCardBlock = html.slice(html.indexOf("function selectedEdgeCard"), html.indexOf("function renderSelectionCard"));
    const transferDetailBlock = html.slice(html.indexOf("function transferDetailBlock"), html.indexOf("function fitGraph"));
    const api = new Function(`
      const state = { graph: { job: { kind: "incoming_deposit_check" } } };
      function escapeHtml(value) { return String(value ?? ""); }
      function cardLine(label, value) { return '<div>' + label + ':' + (value || 'n/a') + '</div>'; }
      function cardLineHtml(label, html) { return '<div>' + label + ':' + html + '</div>'; }
      function cardBlockHtml(label, html) { return '<section>' + label + ':' + html + '</section>'; }
      function analystMissingCopy(kind = "value") { return kind === "time" ? "time not stored" : "not stored"; }
      function asArray(value) { return Array.isArray(value) ? value : value === null || value === undefined ? [] : [value]; }
      function analystBadge(label) { return '<span>' + escapeHtml(label) + '</span>'; }
      function analystIntroBlock(title, text, badges = []) { return '<div>' + title + ':' + asArray(badges).join("") + (text || "") + '</div>'; }
      function analystRawFactsBlock(title, rows) { return cardBlockHtml(title, asArray(rows).filter(Boolean).join("")); }
      function analystEvidenceKind() { return "Money flow"; }
      function analystEvidenceMeaning(edge) { return edgeEvidenceMeaning(edge); }
      function analystEvidenceBadgeClass() { return "money"; }
      function edgeIsGroupedContextEvidence() { return false; }
      function metric(label, value) { return '<div>' + label + ':' + (value || 'n/a') + '</div>'; }
      function metricHtml(label, html) { return '<div>' + label + ':' + html + '</div>'; }
      function typeChip(label) { return label; }
      function listMetric(label) { return '<div>' + label + '</div>'; }
      function rawBlock(label) { return '<details>' + label + '</details>'; }
      function edgeDisplayRole(edge) { return edge?.displayRole || "real_transfer"; }
      function edgeAggregateTransferCount() { return null; }
      function edgeEvidenceType(edge) {
        if (edge?.metadata?.evidenceType) return String(edge.metadata.evidenceType);
        if (edge?.type === "transfer") return "direct_transfer";
        return "unknown";
      }
      function edgeMeaning() { return "Money-origin provenance step"; }
      function edgeDirectionMeaning() { return "incoming"; }
      function edgeDetailedAmountLabel() { return "1 USDT"; }
      function edgeCanvasAmountLabel() { return "1 USDT"; }
      function edgeTime() { return "2026-06-01T00:00:00.000Z"; }
      function edgeTxGap() { return ""; }
      function endpointDetailLink(edge, side) { return side === "from" ? edge.fromNodeId : edge.toNodeId; }
      function txDetailLink(txHash) { return txHash; }
      function edgePrimaryTxHash(edge) { return edge.txHash || ""; }
      function edgePrimaryTxDetailHtml(edge) { return edgePrimaryTxHash(edge) || "See transaction list below."; }
      function edgeTransactionEvidenceHtml() { return "tx evidence"; }
      function edgePathId() { return ""; }
      function edgeAggregateAmountLabel() { return ""; }
      function edgeUnderlyingTransferLines() { return []; }
      function selectedFlowTransferRows() { return []; }
      function selectedFlowHeaderHtml() { return '<div>flow header</div>'; }
      function selectedFlowTransactionListHtml() { return '<div>flow rows</div>'; }
      function selectedFlowPrimaryBodyHtml() { return '<div>flow rows</div>'; }
      function selectedFlowDebugHtml() { return '<details><summary>Debug</summary></details>'; }
      function edgeHasAllocation() { return false; }
      function edgeAllocatedAmount() { return ""; }
      function edgeOriginalAmount() { return ""; }
      function edgeAnchorAmount() { return ""; }
      function rawShare() { return "n/a"; }
      function nodeDisplayKind(node) { return node?.displayKind || node?.kind || "wallet"; }
      function graphKindUsesWalletClusters(kind) { return kind === "address_deep_check"; }
      ${helperBlock}
      ${reciprocalFlowBlock}
      ${selectedEdgeCardBlock}
      ${transferDetailBlock}
      return { selectedEdgeCard, transferDetailBlock, walletClusterEdgeLabel, walletClusterRelationshipLabel };
    `)();
    const edge = {
      id: "generic-transfer",
      type: "transfer",
      fromNodeId: "source",
      toNodeId: "subject",
      txHash: "generic-tx",
      metadata: {},
    };

    expect(api.walletClusterEdgeLabel(edge)).toBe("");
    expect(api.walletClusterRelationshipLabel(edge)).toBe("");
    expect(api.selectedEdgeCard(edge)).not.toContain("Wallet-cluster evidence");
    expect(api.selectedEdgeCard(edge)).not.toContain("Wallet-cluster relationship");
    expect(api.transferDetailBlock(edge)).not.toContain("Wallet-cluster evidence");
    expect(api.transferDetailBlock(edge)).not.toContain("Wallet-cluster relationship");
  });

  it("explains incoming history not fetched as a coverage limit", () => {
    const html = adminConsoleHtml();
    const traceStopBlock = html.slice(html.indexOf("function traceStopDetailBlock"), html.indexOf("function walletDetailBlock"));

    expect(html).toContain("function traceStopCoverageExplanation");
    expect(html).toContain("function traceStopPossibleCauseLines");
    expect(traceStopBlock).toContain('metric("Coverage explanation", traceStopCoverageExplanation(node), "wide")');
    expect(html).toContain("We found a transfer into the checked wallet");
    expect(html).toContain("This is a coverage limit, not proof of bad origin.");
    expect(html).toContain("the address is very active");
    expect(html).toContain("the page or request budget was reached");
  });

  it("fits the graph viewport from rendered node bounds", () => {
    const html = adminConsoleHtml();
    const fitGraphBlock = html.slice(html.indexOf("function fitGraph"), html.indexOf("function zoomAtClientPoint"));
    const zoomBlock = html.slice(html.indexOf("function zoomAtClientPoint"), html.indexOf("function graphPointFromClient"));
    const panZoomBlock = html.slice(html.indexOf("function initPanZoom"), html.indexOf("function setAutoRefresh"));

    expect(fitGraphBlock).toContain("const positions = [...state.renderedNodePositions.values()];");
    expect(fitGraphBlock).toContain("const padding = graphKindUsesDeepBranchMap(state.graph?.job?.kind) ? 120 : 180;");
    expect(fitGraphBlock).toContain("const minScale = graphKindUsesDeepBranchMap(state.graph?.job?.kind) ? .08 : .25;");
    expect(fitGraphBlock).toContain("const maxFitScale = graphKindUsesDeepBranchMap(state.graph?.job?.kind) ? 3.5 : 2.4;");
    expect(fitGraphBlock).toContain("const scale = Math.max(minScale, Math.min(maxFitScale, rawScale));");
    expect(zoomBlock).toContain("function zoomAtClientPoint(event, multiplier)");
    expect(zoomBlock).toContain("const nextScale = Math.max(.08, Math.min(14, previousScale * multiplier));");
    expect(zoomBlock).toContain("state.transform.x = svgX - graphPoint.x * nextScale;");
    expect(zoomBlock).toContain("state.transform.y = svgY - graphPoint.y * nextScale;");
    expect(panZoomBlock).toContain("zoomAtClientPoint(event, event.deltaY > 0 ? .86 : 1.16);");
  });

  it("syncs dense graph controls after graph load updates the graph", () => {
    const html = adminConsoleHtml();
    const loadGraphSuccessBlock =
      html.match(/async function loadGraph\(jobId\) \{[\s\S]*?setStatus\("Graph loaded\. Wheel to zoom, drag to pan\."\);/)?.[0] || "";

    expect(loadGraphSuccessBlock).toContain("state.graph = body.graph;");
    expect(loadGraphSuccessBlock).toContain("renderGraph();");
    expect(loadGraphSuccessBlock).toContain("syncDenseGraphControls();");
    expect(loadGraphSuccessBlock.indexOf("syncDenseGraphControls();")).toBeGreaterThan(loadGraphSuccessBlock.indexOf("state.graph = body.graph;"));
  });

  it("contains deterministic dense fan presentation helpers", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function graphIsDense");
    expect(html).toContain("return nodes.length > 32 || edges.length > 50;");
    expect(html).toContain("function graphDisplayMode");
    expect(html).toContain('if (graphKindUsesFlowMap(state.graph?.job?.kind)) return "flow_map";');
    expect(html).toContain('if (!graphIsDense(nodes, edges)) return "show_all";');
    expect(html).toContain("function nodeImportanceScore");
    expect(html).toContain("function rankNodesByImportance");
    expect(html).toContain("function collapsedGroupNode");
    expect(html).toContain("function collapsedGroupEdge");
    expect(html).toContain("function buildDenseFanPresentation");
    expect(html).toContain("collapsed:incoming");
    expect(html).toContain("collapsed:outgoing");
    expect(html).toContain("collapsed:service");
    expect(html).toContain("collapsed-edge:");
  });

  it("orients incoming collapsed group edges toward the subject", () => {
    const html = adminConsoleHtml();
    const collapsedGroupEdgeBlock = html.slice(html.indexOf("function collapsedGroupEdge"), html.indexOf("function arrangeCluster"));

    expect(collapsedGroupEdgeBlock).toContain('const edgeFromNodeId = groupKind === "incoming" ? toNodeId : fromNodeId;');
    expect(collapsedGroupEdgeBlock).toContain('const edgeToNodeId = groupKind === "incoming" ? fromNodeId : toNodeId;');
    expect(collapsedGroupEdgeBlock).toContain("fromNodeId: edgeFromNodeId");
    expect(collapsedGroupEdgeBlock).toContain("toNodeId: edgeToNodeId");
  });

  it("clears stale collapsed selection before expanding groups to show-all", () => {
    const html = adminConsoleHtml();
    const expandBlock = html.slice(html.indexOf("function expandCollapsedGroup"), html.indexOf("function expandSelectedGraphItem"));
    const api = new Function(
      "const state = { selected: { type: \"node\", id: \"collapsed:deep:anchor\" } };\n" +
        "const calls = [];\n" +
        "function setDensityMode(mode) { calls.push([\"mode\", mode, state.selected]); }\n" +
        "function setStatus(message) { calls.push([\"status\", message, state.selected]); }\n" +
        expandBlock +
        "; expandCollapsedGroup(); return { state, calls };",
    )();

    expect(api.state.selected).toBeNull();
    expect(api.calls).toEqual([
      ["mode", "show_all", null],
      ["status", "Expanded collapsed graph groups.", null],
    ]);
  });

  it("expands selected deep branch groups without forcing show-all raw mode", () => {
    const html = adminConsoleHtml();
    const expandBlock = html.slice(html.indexOf("function isCollapsedGroupNodeId"), html.indexOf("function selectNode"));
    const api = new Function(
      "const state = { selected: { type: \"node\", id: \"collapsed:deep:anchor\" }, expandedBundleNodeIds: new Set() };\n" +
        "const calls = [];\n" +
        "function asArray(value) { return Array.isArray(value) ? value : []; }\n" +
        "function nodeById(nodeId) { calls.push([\"nodeById\", nodeId]); return { id: nodeId, metadata: { hiddenNodeIds: [\"hidden-a\", \"hidden-b\"] } }; }\n" +
        "function setDensityMode(mode) { calls.push([\"density\", mode]); }\n" +
        "function setStatus(message) { calls.push([\"status\", message]); }\n" +
        "function renderGraph() { calls.push([\"graph\"]); }\n" +
        "function renderDetails() { calls.push([\"details\"]); }\n" +
        "function renderSelectionCard() { calls.push([\"selection\"]); }\n" +
        "function renderTransferTabs() { calls.push([\"transfers\"]); }\n" +
        expandBlock +
        "; expandSelectedGraphItem(); return { state, calls };",
    )();

    expect(api.state.expandedBundleNodeIds.has("collapsed:deep:anchor")).toBe(true);
    expect(api.state.selected).toEqual({ type: "node", id: "hidden-a" });
    expect(api.calls).not.toContainEqual(["density", "show_all"]);
    expect(api.calls).toEqual([
      ["nodeById", "collapsed:deep:anchor"],
      ["status", "Expanded selected deep-check branch group."],
      ["graph"],
      ["details"],
      ["selection"],
      ["transfers"],
    ]);
  });

  it("opens selected edge transaction evidence from Expand selected", () => {
    const html = adminConsoleHtml();
    const expandBlock = html.slice(html.indexOf("function isCollapsedGroupNodeId"), html.indexOf("function selectNode"));
    const selectedEdgeRowsBlock = html.slice(
      html.indexOf('if (state.transferTab === "selected" && state.selected?.type === "edge")'),
      html.indexOf('const edges = state.transferTab === "selected"')
    );
    const evidenceRowsBlock = html.slice(html.indexOf("function edgeTransferEvidenceRows"), html.indexOf("function transferEvidenceRowsHtml"));
    const selectedEdgeKeydownBlock = selectedEdgeRowsBlock.slice(selectedEdgeRowsBlock.indexOf('row.addEventListener("keydown", (event) => {'));
    const api = new Function(
      "const state = { selected: { type: \"edge\", id: \"edge:direct_counterparty:0\" }, transfersOpen: false, transferTab: \"all\" };\n" +
        "const calls = [];\n" +
        "function asArray(value) { return Array.isArray(value) ? value : []; }\n" +
        "function edgeById(edgeId) { calls.push([\"edgeById\", edgeId]); return { id: edgeId, metadata: { evidenceType: \"grouped_transfers\", txHashes: [\"tx-a\", \"tx-b\"], txCount: 2 } }; }\n" +
        "function edgeHasAggregatedTxEvidence(edge) { return edge?.metadata?.evidenceType === \"grouped_transfers\"; }\n" +
        "function edgeTxHashes(edge) { return asArray(edge?.metadata?.txHashes); }\n" +
        "function setTransferDrawer(open) { state.transfersOpen = open; calls.push([\"drawer\", open]); }\n" +
        "function setTransferTab(tab) { state.transferTab = tab; calls.push([\"tab\", tab]); renderTransferTabs(); }\n" +
        "function setStatus(message) { calls.push([\"status\", message]); }\n" +
        "function renderGraph() { calls.push([\"graph\"]); }\n" +
        "function renderDetails() { calls.push([\"details\"]); }\n" +
        "function renderSelectionCard() { calls.push([\"selection\"]); }\n" +
        "function renderTransferTabs() { calls.push([\"transfers\"]); }\n" +
        expandBlock +
        "; expandSelectedGraphItem(); return { state, calls };",
    )();

    expect(api.state.transfersOpen).toBe(true);
    expect(api.state.transferTab).toBe("selected");
    expect(api.calls).toEqual([
      ["edgeById", "edge:direct_counterparty:0"],
      ["drawer", true],
      ["tab", "selected"],
      ["transfers"],
      ["status", "Showing selected transaction evidence."],
      ["selection"],
      ["details"],
    ]);
    expect(evidenceRowsBlock).toContain("function edgeTransferEvidenceRows");
    expect(evidenceRowsBlock).toContain("metadata?.underlyingTransfers");
    expect(evidenceRowsBlock).toContain('time: item?.timestamp || "time n/a"');
    expect(evidenceRowsBlock).toContain("fromAddress: item?.fromAddress");
    expect(evidenceRowsBlock).toContain("toAddress: item?.toAddress");
    expect(evidenceRowsBlock).toContain('txHash: item?.txHash || ""');
    expect(evidenceRowsBlock).toContain("const hashes = edgeTxHashes(edge);");
    expect(selectedEdgeRowsBlock).toContain("const transferRows = edgeTransferEvidenceRows(selectedEdge);");
    expect(selectedEdgeRowsBlock).toContain('row.addEventListener("keydown", (event) => {');
    expect(selectedEdgeRowsBlock).toContain('if (event.key === "Enter" || event.key === " ") {');
    expect(selectedEdgeKeydownBlock).toContain('if (event.target instanceof Element && event.target.closest("a")) return;');
    expect(selectedEdgeKeydownBlock).toContain("event.preventDefault();");
    expect(selectedEdgeKeydownBlock).toContain('selectEdge(row.getAttribute("data-edge-id"));');
    expect(selectedEdgeKeydownBlock.indexOf('if (event.target instanceof Element && event.target.closest("a")) return;')).toBeLessThan(
      selectedEdgeKeydownBlock.indexOf("event.preventDefault();")
    );
  });

  it("lets the transfer drawer be closed from inside the expanded panel", () => {
    const html = adminConsoleHtml();
    const transferPanelBlock = html.slice(html.indexOf('<section class="transfer-panel'), html.indexOf('<section class="timeline-panel'));
    const listenerBlock = html.slice(html.indexOf('el("toggleTransfers").addEventListener'), html.indexOf('el("clearSelection").addEventListener'));

    expect(transferPanelBlock).toContain('id="closeTransferDrawer"');
    expect(transferPanelBlock).toContain('title="Close transfer details"');
    expect(html).toContain(".tabbar .transfer-close { position: absolute; top: 8px; right: 8px;");
    expect(listenerBlock).toContain('const closeTransferDrawerButton = document.getElementById("closeTransferDrawer");');
    expect(listenerBlock).toContain('closeTransferDrawerButton.addEventListener("click", () => setTransferDrawer(false));');
  });

  it("uses analyst copy for timeline transfer and no-selection states", () => {
    const html = adminConsoleHtml();
    const caseHeaderBlock = html.slice(html.indexOf('<div id="activeJobSummary"'), html.indexOf('<input id="graphSearch"'));
    const caseBriefBlock = html.slice(html.indexOf('<div id="caseBrief"'), html.indexOf('<aside id="scoringAuditPanel"'));
    const renderCaseBriefBlock = html.slice(html.indexOf("function renderCaseBrief"), html.indexOf("function auditValue"));
    const renderDetailsBlock = html.slice(html.indexOf("function renderDetails"), html.indexOf("function cardLine("));
    const transferEmptyCopyBlock = html.slice(html.indexOf("function transferTableEmptyCopy"), html.indexOf("function timelineEmptyCopy"));
    const transferPanelBlock = html.slice(html.indexOf('<section class="transfer-panel'), html.indexOf('<section class="timeline-panel'));
    const timelineBlock = html.slice(html.indexOf('<section class="timeline-panel'), html.indexOf('<select id="layoutMode"'));

    expect(caseHeaderBlock).toContain("Select a completed or partial job to inspect evidence.");
    expect(caseBriefBlock).toContain("Select a completed or partial job to inspect evidence.");
    expect(renderCaseBriefBlock).toContain("Select a completed or partial job to inspect evidence.");
    expect(html).toContain("function caseHeaderStatusChips");
    expect(html).toContain("function caseStatusChip");
    expect(renderCaseBriefBlock).toContain('caseHeaderStatusChips(graph, summary)');
    expect(html).toContain('caseStatusChip("Decision"');
    expect(html).toContain('caseStatusChip("Risk"');
    expect(html).toContain('caseStatusChip("Evidence"');
    expect(html).toContain('caseStatusChip("Coverage"');
    expect(renderCaseBriefBlock).toContain('const noSelectionIntro = state.selected ? "" : analystIntroBlock("No graph evidence is selected",');
    expect(renderCaseBriefBlock).toContain('analystIntroBlock("No graph evidence is selected",');
    expect(renderCaseBriefBlock).toContain("root.innerHTML = noSelectionIntro + '<div class=\"metric-grid\">");
    expect(renderCaseBriefBlock.indexOf("const noSelectionIntro")).toBeLessThan(renderCaseBriefBlock.indexOf("root.innerHTML = noSelectionIntro"));
    expect(renderDetailsBlock).toContain("Select a completed or partial job to inspect evidence.");
    expect(renderDetailsBlock).toContain("No graph evidence is selected.");
    expect(transferPanelBlock).toContain("Selected evidence");
    expect(timelineBlock).toContain("Activity timeline");
    expect(timelineBlock).toContain("Open transfer list");
    expect(timelineBlock).toContain("Select a graph to inspect transfer timing.");
    expect(html).toContain("function transferTableEmptyCopy");
    expect(html).toContain("function timelineEmptyCopy");
    expect(transferEmptyCopyBlock).toContain('if (state.transferTab === "selected" && !state.selected)');
    expect(transferEmptyCopyBlock).toContain("No transfer evidence is stored for this selection.");
    expect(html).toContain("No transfers match the current filters.");
    expect(html).toContain("Select an edge, node, or path to inspect related transfers.");
  });

  it("calculates tx gaps for expanded underlying transfer rows", () => {
    const html = adminConsoleHtml();
    const helperStart = html.indexOf("function transferTimestampMs");
    expect(helperStart).toBeGreaterThan(-1);
    const evidenceRowsBlock = html.slice(helperStart, html.indexOf("function transferEvidenceRowsHtml"));
    const rows = new Function(
      "const edge = { id: 'edge-a', metadata: { txGapMs: 3600000, underlyingTransfers: [\n" +
        "  { amountRaw: '1000000', timestamp: '2026-06-25T09:49:00.000Z', txGap: 'n/a', fromAddress: 'TA', toAddress: 'TB', txHash: 'a'.repeat(64) },\n" +
        "  { amountRaw: '2000000', timestamp: '2026-06-25T09:54:30.000Z', txGap: 'n/a', fromAddress: 'TA', toAddress: 'TB', txHash: 'b'.repeat(64) }\n" +
        "] } };\n" +
        "function asArray(value) { return Array.isArray(value) ? value : []; }\n" +
        "function formatRawUsdt(value) { return String(Number(value) / 1000000) + ' USDT'; }\n" +
        "function formatDurationMs(ms) { if (ms === null || ms === undefined || ms === '') return ''; return Math.round(ms / 60000) + 'm'; }\n" +
        "function edgeTxGap(edge) { return edge?.metadata?.txGapMs === 3600000 ? '1h' : ''; }\n" +
        "function edgeFromAddress() { return 'TA'; }\n" +
        "function edgeToAddress() { return 'TB'; }\n" +
        "function edgePathId() { return 'path-a'; }\n" +
        "function edgeHasTransferRows() { return true; }\n" +
        "function edgeHasAggregatedTxEvidence() { return false; }\n" +
        "function edgeTxHashes() { return []; }\n" +
        evidenceRowsBlock +
        "; return edgeTransferEvidenceRows(edge);"
    )();

    expect(rows.map((row: { txGap: string }) => row.txGap)).toEqual(["1h", "6m"]);
  });

  it("formats transfer drawer time and labels the first displayed gap", () => {
    const html = adminConsoleHtml();
    const timeHelpers = html.slice(html.indexOf("const canvasMonthNames"), html.indexOf("function edgeGroupedPeriodLabel"));
    const drawerHelpers = html.slice(html.indexOf("function transferTableTimeLabel"), html.indexOf("function transferRowTxGap"));
    const api = new Function(
      timeHelpers +
        drawerHelpers +
        "; return { transferTableTimeLabel, transferTableGapLabel };"
    )() as {
      transferTableTimeLabel(value: string): string;
      transferTableGapLabel(value: string, index: number): string;
    };

    expect(api.transferTableTimeLabel("2026-02-16T09:23:51.000Z")).toBe("Feb 16, 09:23");
    expect(api.transferTableTimeLabel("2025-06-25T09:49:03.000Z")).toBe("2025 Jun 25, 09:49");
    expect(api.transferTableGapLabel("n/a", 0)).toBe("start");
    expect(api.transferTableGapLabel("5d 3h", 1)).toBe("5d 3h");
  });

  it("keeps deep-check branch nodes visible instead of adding synthetic collapsed deep groups", () => {
    const html = adminConsoleHtml();
    const presentationBlock = html.slice(html.indexOf("function deepBranchStep1NodeIds"), html.indexOf("function applyExpandedBundlePresentation"));
    const api = new Function(
      "const state = { servicesVisible: true, expandedBundleNodeIds: new Set() };\n" +
        "function stableNodeSort(a, b) {\n" +
        "  const aWeight = Number(a.weight || a.score || a.metadata?.volumeRaw || 0);\n" +
        "  const bWeight = Number(b.weight || b.score || b.metadata?.volumeRaw || 0);\n" +
        "  if (bWeight !== aWeight) return bWeight - aWeight;\n" +
        "  return String(a.id).localeCompare(String(b.id));\n" +
        "}\n" +
        "function nodeIsServiceLike() { return false; }\n" +
        "function nodeDisplayKind(node) { return node.displayKind || node.kind || \"wallet\"; }\n" +
        "function deepLocalOrbitRole(node) {\n" +
        "  const kind = nodeDisplayKind(node);\n" +
        "  if (kind === \"trace_stop\") return \"stop\";\n" +
        "  if (kind === \"funding_bundle\" || node.kind === \"group\" || node.displayKind === \"collapsed_group\") return \"group\";\n" +
        "  if (nodeIsServiceLike(node)) return \"service\";\n" +
        "  return \"peer\";\n" +
        "}\n" +
        presentationBlock +
        "; return { buildDeepBranchPresentation };",
    )();
    const nodes = [
      { id: "subject", kind: "subject", weight: 1000 },
      { id: "anchor-a", kind: "wallet", weight: 900 },
      { id: "anchor-b", kind: "wallet", weight: 800 },
      { id: "a-keep-1", kind: "wallet", weight: 700 },
      { id: "a-keep-2", kind: "wallet", weight: 600 },
      { id: "a-hidden", kind: "wallet", weight: 500 },
      { id: "b-keep-1", kind: "wallet", weight: 400 },
      { id: "b-keep-2", kind: "wallet", weight: 300 },
      { id: "b-hidden", kind: "wallet", weight: 200 },
    ];
    const edges = [
      { id: "subject-anchor-a", fromNodeId: "subject", toNodeId: "anchor-a" },
      { id: "subject-anchor-b", fromNodeId: "subject", toNodeId: "anchor-b" },
      { id: "anchor-a-keep-1", fromNodeId: "anchor-a", toNodeId: "a-keep-1" },
      { id: "anchor-a-keep-2", fromNodeId: "anchor-a", toNodeId: "a-keep-2" },
      { id: "anchor-a-hidden", fromNodeId: "anchor-a", toNodeId: "a-hidden" },
      { id: "anchor-b-keep-1", fromNodeId: "anchor-b", toNodeId: "b-keep-1" },
      { id: "anchor-b-keep-2", fromNodeId: "anchor-b", toNodeId: "b-keep-2" },
      { id: "anchor-b-hidden", fromNodeId: "anchor-b", toNodeId: "b-hidden" },
    ];

    const presentation = api.buildDeepBranchPresentation(nodes, edges);
    const nodeIds = new Set(presentation.nodes.map((node: { id: string }) => node.id));

    expect(nodeIds.has("a-hidden")).toBe(true);
    expect(nodeIds.has("collapsed:deep:anchor-a")).toBe(false);
    expect(nodeIds.has("b-hidden")).toBe(true);
    expect(nodeIds.has("collapsed:deep:anchor-b")).toBe(false);
    expect(presentation.nodes.find((node: { id: string; metadata?: { deepBranchAnchorId?: string } }) => node.id === "a-hidden")?.metadata?.deepBranchAnchorId).toBe("anchor-a");
    expect(presentation.nodes.find((node: { id: string; metadata?: { deepBranchAnchorId?: string } }) => node.id === "b-hidden")?.metadata?.deepBranchAnchorId).toBe("anchor-b");
  });

  it("routes dense graphs between fan overview and show-all timeline layout", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function legacyFanLayout");
    expect(html).toContain("function denseFanLayout");
    expect(html).toContain("function timelineLaneLayout");
    expect(html).toContain("function graphPresentation");
    expect(html).toContain("presentation = buildDenseFanPresentation(bundleVisible.nodes, bundleVisible.edges);");
    expect(html).toContain("return { ...applyExpandedBundlePresentation(presentation.nodes, presentation.edges), mode, dense };");
    expect(html).toContain('function graphFirstLayout(sourceNodes, sourceEdges, mode = graphDisplayMode(sourceNodes, sourceEdges), dense = graphIsDense(sourceNodes, sourceEdges))');
    expect(html).toContain('if (mode === "show_all" && (dense || graphKindUsesFlowMap(state.graph?.job?.kind) || graphKindUsesDeepBranchMap(state.graph?.job?.kind))) return timelineLaneLayout(sourceNodes, sourceEdges);');
    expect(html).toContain('if (dense && mode === "fan") return denseFanLayout(sourceNodes, sourceEdges);');
    expect(html).toContain("return legacyFanLayout(sourceNodes, sourceEdges);");
    expect(html).toContain("function isCollapsedGroupNodeId");
    expect(html).toContain('return String(nodeId || "").startsWith("collapsed:") || String(nodeId || "").startsWith("step:");');
    expect(html).toContain("function expandCollapsedGroup");
    expect(html).toContain('if (isCollapsedGroupNodeId(nodeId)) setStatus("Selected display group. Use Expand selected to show the raw graph.");');
    expect(html).toContain('if (isCollapsedGroupNodeId(state.selected.id)) {');
    expect(html).toContain("state.selected = null;");
    expect(html).toContain('setDensityMode("show_all");');
    expect(html).toContain("const width = Math.max(1900, 680 + sourceNodes.length * 34);");
    expect(html).toContain("contract: height * 0.88");
    expect(html).toContain("function collapsedGroupLayoutSide");
    expect(html).toContain('if (nodeDisplayKind(node) === "collapsed_group") {');
    expect(html).toContain("const groupSide = collapsedGroupLayoutSide(node?.metadata?.groupKind);");
    expect(html).toContain("if (groupSide) return groupSide;");
    expect(html).toContain("const groupRole = collapsedGroupLayoutSide(edge?.metadata?.groupKind);");
    expect(html).toContain('if (role === "collapsed_group") return groupRole === "service" ? "service" : groupRole || "context";');
    expect(html).toContain("const xPadding = 220;");
    expect(html).toContain("const xSpacing = sourceNodes.length > 1 ? (width - xPadding * 2) / (sourceNodes.length - 1) : 0;");
    expect(html).toContain("const x = xPadding + index * xSpacing;");
    expect(html).not.toContain("1400 / Math.max(1, sourceNodes.length)");
  });

  it("reconciles selection when collapsed density modes hide selected items", () => {
    const html = adminConsoleHtml();
    const reconcileFiltersBlock = html.slice(html.indexOf("function reconcileSelectionWithFilters"), html.indexOf("function reconcileSelectionWithDensityMode"));
    const setDensityModeBlock = html.slice(html.indexOf("function setDensityMode"), html.indexOf("function syncDenseGraphControls"));
    const reconcileBlock = html.slice(html.indexOf("function reconcileSelectionWithDensityMode"), html.indexOf("function graphSubjectNodeId"));

    expect(html).toContain("function reconcileSelectionWithDensityMode");
    expect((reconcileFiltersBlock.match(/state\.densityMode !== "show_all"/g) || []).length).toBe(2);
    expect(reconcileFiltersBlock).not.toContain('state.densityMode === "fan"');
    expect(setDensityModeBlock).toContain("state.timelineRange = null;");
    expect(setDensityModeBlock).toContain('if (state.densityMode !== "show_all") reconcileSelectionWithDensityMode();');
    expect(setDensityModeBlock).toContain("renderActivityTimeline();");
    expect(reconcileBlock).toContain("const rawVisibleEdges = filteredGraphEdges();");
    expect(reconcileBlock).toContain("const presentation = graphPresentation(rawVisibleNodes, rawVisibleEdges);");
    expect(reconcileBlock).toContain("const visibleNodeIds = new Set(presentation.nodes.map((node) => node.id));");
    expect(reconcileBlock).toContain("const visibleEdgeIds = new Set(presentation.edges.map((edge) => edge.id));");
    expect(reconcileBlock).toContain('if (state.selected.type === "node" && !visibleNodeIds.has(state.selected.id)) {');
    expect(reconcileBlock).toContain("state.selected = null;\n        return;");
    expect(reconcileBlock).toContain('if (state.selected.type === "edge" && !visibleEdgeIds.has(state.selected.id)) state.selected = null;');
  });

  it("contains peer-link classification and selected-neighbor highlighting", () => {
    const html = adminConsoleHtml();
    const filteredGraphEdgesBlock = html.slice(html.indexOf("function filteredGraphEdges"), html.indexOf("function visibleGraphNodeIds"));
    const peerToggleBlock = html.match(/el\("peerLinksMode"\)\.addEventListener\("click", \(\) => \{[\s\S]*?\n    \}\);/)?.[0] || "";
    const peerCssBlock = html.slice(html.indexOf(".edge-flow-peer {"), html.indexOf(".edge.edge-deep-grouped-transfer,"));

    expect(html).toContain("function graphSubjectNodeId");
    expect(html).toContain("function edgeIsPeerLink");
    expect(html).toContain("return edge?.fromNodeId !== subjectId && edge?.toNodeId !== subjectId;");
    expect(html).toContain("if (nodeIsServiceLike(from) || nodeIsServiceLike(to)) return false;");
    expect(html).toContain("function edgePassesPeerLinkFilter");
    expect(html).toContain("if (!state.peerLinksVisible && edgeIsPeerLink(edge)) return false;");
    expect(filteredGraphEdgesBlock).toContain("edgePassesPeerLinkFilter(edge)");
    expect(html).toContain("function edgeIsSelectionRelated");
    expect(html).toContain('if (edgeIsPeerLink(edge)) return "peer";');
    expect(html).toContain("const relatedToSelection = edgeIsSelectionRelated(edge);");
    expect(html).toContain("const visible = matchesSearch(edge) && (!state.selected || selected || relatedToSelection);");
    expect(peerToggleBlock).toContain("state.timelineRange = null;");
    expect(peerToggleBlock).toContain("reconcileSelectionWithFilters();\n      renderGraph();");
    expect(peerToggleBlock).toContain("renderActivityTimeline();");
    expect(html).toContain('edge-flow-peer');
    expect(html).toContain(".edge-flow-peer");
    expect(html).toContain(".edge.edge-flow-peer.selected");
    expect(peerCssBlock).toContain("stroke: rgba(141, 151, 168, .64)");
    expect(peerCssBlock).toContain("stroke-dasharray: 7 9");
    expect(peerCssBlock).not.toContain("rgba(246, 193, 119, .58)");
    expect(html).toContain(".amount-pill.label-role-peer { --pill-accent: #c3ced9;");
  });

  it("keeps transfer rows and timeline aligned with the visible graph presentation", () => {
    const html = adminConsoleHtml();
    const timelineSourceBlock = html.slice(html.indexOf("function timelineSourceTransferEdges"), html.indexOf("function activityTimelineBuckets"));
    const filteredTransfersBlock = html.slice(html.indexOf("function filteredTransferEdges"), html.indexOf("function selectTimelineBucket"));

    expect(html).toContain("function graphPresentationForEdges");
    expect(html).toContain("function presentationTransferEdges");
    expect(html).toContain('edge?.type !== "stop"');
    expect(html).toContain('edgeDisplayRole(edge) !== "collapsed_group"');
    expect(timelineSourceBlock).toContain("return presentationTransferEdges(graphEdges(state.graph).filter((edge) =>");
    expect(timelineSourceBlock).toContain("edgePassesPeerLinkFilter(edge)");
    expect(filteredTransfersBlock).toContain("return presentationTransferEdges(filteredGraphEdges());");
  });

  it("branches direct counterparty edge styling between single and grouped transfers", () => {
    const html = adminConsoleHtml();
    const extraClassBlock = html.slice(html.indexOf("function edgeExtraClass"), html.indexOf("function edgeStrokeWidth"));
    const groupedCssBlock = html.slice(html.indexOf(".edge.edge-flow-peer.edge-deep-grouped-transfer"), html.indexOf(".edge.risk"));
    const groupedBranch = 'if (source === "directCounterpartyInteractionProfile" && count && count > 1) {';
    const singleBranch = 'if (source === "directCounterpartyInteractionProfile") {';

    expect(extraClassBlock).not.toBe("");
    expect(extraClassBlock).toContain("const groupedContext =");
    expect(groupedCssBlock).toContain(".edge.edge-flow-peer.edge-deep-grouped-transfer");
    expect(html).toContain('typeof edgeTxHashes === "function"');
    expect(html).toContain("if ([...new Set(hashes)].length > 1) return true;");
    expect(extraClassBlock).toContain(groupedBranch);
    expect(extraClassBlock).toContain(singleBranch);
    expect(extraClassBlock.indexOf(groupedBranch)).toBeLessThan(extraClassBlock.indexOf(singleBranch));
    expect(extraClassBlock).toContain('classes.push("edge-deep-grouped-transfer");');
    expect(extraClassBlock).toContain('classes.push("edge-deep-wallet-transfer");');

    const classApi = new Function(`
      const state = { graph: { job: { kind: "where_is_money_check" } } };
      function edgeDisplayRole(edge) { return edge?.displayRole || "real_transfer"; }
      function edgeAggregateTransferCount(edge) { return edge?.metadata?.aggregateTransferCount || null; }
      function edgeIsGroupedContextEvidence(edge) {
        const hashes = [...new Set([...(edge?.metadata?.txHashes || []), ...(edge?.metadata?.profileTxHashes || []), ...(edge?.txHash ? [edge.txHash] : [])])];
        return edge?.metadata?.evidenceType === "grouped_transfers" || Number(edge?.metadata?.aggregateTransferCount || 0) > 1 || hashes.length > 1;
      }
      ${extraClassBlock}
      return { edgeExtraClass };
    `)() as { edgeExtraClass(edge: unknown, visualRole: string): string };

    expect(classApi.edgeExtraClass({
      type: "transfer",
      metadata: {
        evidenceType: "grouped_transfers",
        txCount: 5
      }
    }, "peer")).toBe(" edge-deep-grouped-transfer");
    expect(classApi.edgeExtraClass({
      type: "transfer",
      metadata: {
        txHashes: ["tx-a", "tx-b", "tx-c", "tx-d", "tx-e"]
      }
    }, "peer")).toBe(" edge-deep-grouped-transfer");
  });

  it("marks reciprocal flow edges as circular evidence in styling and selected details", () => {
    const html = adminConsoleHtml();
    const extraClassBlock = html.slice(html.indexOf("function edgeExtraClass"), html.indexOf("function edgeStrokeWidth"));
    const reciprocalFlowBlock = html.slice(html.indexOf("function reciprocalFlowHtml"), html.indexOf("function selectedEdgeCard"));
    const selectedEdgeCardBlock = html.slice(html.indexOf("function selectedEdgeCard"), html.indexOf("function renderSelectionCard"));
    const reciprocalCssBlock = html.slice(html.indexOf(".edge.edge-reciprocal-flow"), html.indexOf(".edge-flow-service"));

    expect(html).toContain(".edge-reciprocal-flow");
    expect(html).toContain("function reciprocalFlowHtml(edge)");
    expect(reciprocalFlowBlock).toContain("edge?.metadata?.reciprocalFlow");
    expect(reciprocalCssBlock).toMatch(/\.edge\.edge-deep-wallet-transfer\.edge-reciprocal-flow \{[^}]*stroke: rgba\(141, 151, 168, \.68\);[^}]*stroke-dasharray: 7 9;[^}]*filter: drop-shadow/);
    expect((selectedEdgeCardBlock.match(/reciprocalFlowHtml\(edge\)/g) || []).length).toBe(1);
    expect(extraClassBlock).toContain("edge-reciprocal-flow");

    const reciprocalApi = new Function(`
      function asArray(value) { return Array.isArray(value) ? value : []; }
      function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
      function cardBlockHtml(label, html) { return '<section><h4>' + escapeHtml(label) + '</h4>' + html + '</section>'; }
      ${reciprocalFlowBlock}
      return { reciprocalFlowHtml };
    `)() as { reciprocalFlowHtml(edge: unknown): string };
    const reciprocalHtml = reciprocalApi.reciprocalFlowHtml({
      metadata: {
        reciprocalFlow: true,
        reciprocalPairKey: "pair-a",
        reciprocalEdgeIds: ["edge-a", "edge-b"]
      }
    });

    expect(reciprocalApi.reciprocalFlowHtml({ metadata: { reciprocalFlow: false } })).toBe("");
    expect(reciprocalHtml).toContain("Reciprocal flow");
    expect(reciprocalHtml).toContain("pair-a");
    expect(reciprocalHtml).toContain("Related edges");
    expect(reciprocalHtml).toContain(">2<");
    expect(reciprocalHtml).toContain("This pair moved funds in both directions. Treat it as circular evidence, not as a clean source resolution.");

    const classApi = new Function(`
      const state = { graph: { job: { kind: "address_deep_check" } } };
      function edgeDisplayRole(edge) { return edge?.displayRole || "real_transfer"; }
      function edgeAggregateTransferCount(edge) { return edge?.metadata?.aggregateTransferCount || null; }
      function edgeIsGroupedContextEvidence(edge) { return edge?.metadata?.evidenceType === "grouped_transfers" || Number(edge?.metadata?.aggregateTransferCount || 0) > 1; }
      ${extraClassBlock}
      return { edgeExtraClass };
    `)() as { edgeExtraClass(edge: unknown, visualRole: string): string };

    expect(classApi.edgeExtraClass({
      metadata: {
        source: "directCounterpartyInteractionProfile",
        aggregateTransferCount: 2,
        reciprocalFlow: true
      }
    }, "context")).toBe(" edge-deep-grouped-transfer edge-reciprocal-flow");
    expect(classApi.edgeExtraClass({ metadata: { reciprocalFlow: true } }, "incoming")).toBe(" edge-reciprocal-flow");
  });

  it("formats canvas edge time as readable UTC text and hides missing canvas time", () => {
    const html = adminConsoleHtml();
    const timeBlock = html.slice(html.indexOf("function canvasTimestampLabel"), html.indexOf("function edgeCanvasTimeLabel"));
    const edgeTimeBlock = html.slice(html.indexOf("function edgeCanvasTimeLabel"), html.indexOf("function edgeSpeedMs"));

    expect(html).toContain("const canvasMonthNames =");
    expect(html).toContain("function canvasTimestampLabel");
    expect(html).toContain("function edgeGroupedPeriodLabel");
    expect(timeBlock).toContain('const includeYear = date.getUTCFullYear() !== new Date().getUTCFullYear();');
    expect(timeBlock).toContain('return (includeYear ? date.getUTCFullYear() + " " : "") + canvasMonthNames[date.getUTCMonth()] + " " + day + ", " + hour + ":" + minute;');
    expect(timeBlock).toContain("asArray(edge?.metadata?.underlyingTransfers)");
    expect(timeBlock).toContain("canvasTimestampLabel(times[0].value)");
    expect(timeBlock).toContain('return first === last ? first : first + " - " + last;');
    expect(edgeTimeBlock).toContain("const groupedPeriod = edgeGroupedPeriodLabel(edge);");
    expect(edgeTimeBlock).toContain("if (groupedPeriod) return groupedPeriod;");
    expect(edgeTimeBlock).toContain("if (edgeIsGroupedContextEvidence(edge)) return \"\";");
    expect(edgeTimeBlock).toContain('return canvasTimestampLabel(edge?.timestamp || edgeTime(edge));');
    expect(edgeTimeBlock).not.toContain('|| "time n/a"');

    const timeApi = new Function(
      "asArray",
      "function edgeAggregateTransferCount(edge) { return Number(edge?.metadata?.aggregateTransferCount || 0) || (Array.isArray(edge?.metadata?.underlyingTransfers) ? edge.metadata.underlyingTransfers.length : null); }" +
        "function edgeIsGroupedContextEvidence(edge) { if (edge?.metadata?.evidenceType === \"grouped_transfers\") return true; const transfers = asArray(edge?.metadata?.underlyingTransfers); if (transfers.length > 1) return true; const count = edgeAggregateTransferCount(edge); return Boolean(count && count > 1); }" +
        "function edgeTime(edge) { return edge?.timestampFormatted || edge?.timestamp || ''; }" +
        html.slice(html.indexOf("const canvasMonthNames"), html.indexOf("function edgeSpeedMs")) +
        "return { edgeGroupedPeriodLabel, edgeCanvasTimeLabel };"
    )((value: unknown) => Array.isArray(value) ? value : []) as {
      edgeGroupedPeriodLabel(edge: unknown): string;
      edgeCanvasTimeLabel(edge: unknown): string;
    };

    const currentYear = new Date().getUTCFullYear();
    const groupedEdge = {
      timestamp: currentYear + "-06-30T00:00:00.000Z",
      metadata: {
        evidenceType: "grouped_transfers",
        underlyingTransfers: [
          { timestamp: currentYear + "-06-23T12:44:00.000Z" },
          { timestamp: currentYear + "-06-24T13:05:00.000Z" }
        ]
      }
    };
    expect(timeApi.edgeGroupedPeriodLabel(groupedEdge)).toBe("Jun 23, 12:44 - Jun 24, 13:05");
    expect(timeApi.edgeCanvasTimeLabel(groupedEdge)).toBe("Jun 23, 12:44 - Jun 24, 13:05");
    expect(timeApi.edgeCanvasTimeLabel({
      timestamp: currentYear + "-06-23T12:44:00.000Z",
      metadata: {
        source: "directCounterpartyInteractionProfile",
        underlyingTransfers: [{ timestamp: currentYear + "-06-23T12:44:00.000Z" }]
      }
    })).toBe("Jun 23, 12:44");
    expect(timeApi.edgeCanvasTimeLabel({
      timestamp: currentYear + "-06-30T00:00:00.000Z",
      metadata: {
        evidenceType: "grouped_transfers",
        underlyingTransfers: [{ txHash: "missing-time-a" }, { txHash: "missing-time-b" }]
      }
    })).toBe("");
  });

  it("colors edge labels from their edge role and speed state", () => {
    const html = adminConsoleHtml();
    const pillBlock = html.slice(html.indexOf("function amountPill"), html.indexOf("function canvasNodeLabel"));
    const renderBlock = html.slice(html.indexOf("function renderGraph"), html.indexOf("function isCollapsedGroupNodeId"));

    expect(html).toContain("function edgeLabelRoleClass");
    expect(html).toContain(".amount-pill.label-role-incoming { --pill-accent: #8fe9af;");
    expect(html).toContain(".amount-pill.label-role-service { --pill-accent: #ffd36b;");
    expect(html).toContain(".amount-pill.label-role-stop { --pill-accent: #f6c177;");
    expect(html).toContain(".amount-pill.label-role-peer { --pill-accent: #c3ced9;");
    expect(html).toContain(".amount-pill.label-role-grouped { --pill-accent: #d8c7ff;");
    expect(html).toContain('if (edgeIsGroupedContextEvidence(edge)) return "label-role-grouped";');
    expect(html).not.toContain('class="pill-accent"');
    expect(pillBlock).toContain('roleClass = ""');
    expect(pillBlock).toContain('const className = "amount-pill" +');
    expect(renderBlock).toContain("const labelRoleClass = edgeLabelRoleClass(edge);");
    expect(renderBlock).toContain("amountPill(label, labelItem.labelPoint.x, labelItem.labelPoint.y, speedClass, labelRoleClass)");
  });

  it("places edge labels near the routed edge midpoint instead of floating far away", () => {
    const html = adminConsoleHtml();
    const renderBlock = html.slice(html.indexOf("function renderGraph"), html.indexOf("function isCollapsedGroupNodeId"));

    expect(html).toContain("function edgeLabelPoint");
    expect(html).toContain("function edgeCurveControlPoint");
    expect(html).toContain("const labelNormalOffset = Math.max(16, Math.min(24, length * 0.045));");
    expect(html).toContain("const pointX = control ?");
    expect(renderBlock).toContain("const labelPoint = edgeLabelPoint(startX, startY, endX, endY, edge, route);");
    expect(renderBlock).not.toContain("const labelX = midX - (dy / length) * 14;");
    expect(renderBlock).not.toContain("const labelY = midY + (dx / length) * 14;");
  });

  it("routes opposite-direction edges between the same wallets on separate arcs", () => {
    const html = adminConsoleHtml();
    const renderBlock = html.slice(html.indexOf("function renderGraph"), html.indexOf("function isCollapsedGroupNodeId"));
    const routeBlock = html.slice(html.indexOf("function edgePairKey"), html.indexOf("function edgeCurvePath"));

    expect(html).toContain("function edgePairKey");
    expect(html).toContain("function buildEdgeRouteIndex");
    expect(html).toContain("function edgeRouteFor");
    expect(routeBlock).toContain("directionSign");
    expect(routeBlock).toContain("sameDirectionIndex");
    expect(routeBlock).toContain("sameDirectionCount");
    expect(routeBlock).toContain("parallelOffset");
    expect(routeBlock).toContain("function edgeRouteRank");
    expect(routeBlock).toContain("routeRank: edgeRouteRank(edge)");
    expect(routeBlock).toContain("const offsetStep = sorted.length > 2 ? 0.12 : 0.16;");
    expect(html).toContain("function edgeCurveControlPoint(startX, startY, endX, endY, edge, route = null)");
    expect(html).toContain("function edgeCurvePath(startX, startY, endX, endY, edge, route = null)");
    expect(html).toContain("function edgeLabelPoint(startX, startY, endX, endY, edge, route = null)");
    expect(renderBlock).toContain("const edgeRouteIndex = buildEdgeRouteIndex(visibleEdges);");
    expect(renderBlock).toContain("const route = edgeRouteFor(edge, edgeRouteIndex);");
    expect(renderBlock).toContain("const labelPoint = edgeLabelPoint(startX, startY, endX, endY, edge, route);");
    expect(renderBlock).toContain("const pathD = edgeCurvePath(startX, startY, endX, endY, edge, route);");

    const routeApi = new Function(
      'function edgeVisualRole() { return "outgoing"; }' +
      'function edgeFlowDirection() { return "outgoing"; }' +
      'function edgeIsGroupedContextEvidence(edge) { return edge?.metadata?.evidenceType === "grouped_transfers"; }' +
      'function edgeEvidenceType(edge) { return edge?.metadata?.evidenceType || "direct_transfer"; }' +
      'function edgeDisplayRole(edge) { return edge?.displayRole || "real_transfer"; }' +
      routeBlock +
      "; return { buildEdgeRouteIndex, edgeRouteFor, edgeCurveControlPoint };"
    )();
    const forward = { id: "forward", fromNodeId: "a", toNodeId: "b" };
    const reverse = { id: "reverse", fromNodeId: "b", toNodeId: "a" };
    const routeIndex = routeApi.buildEdgeRouteIndex([forward, reverse]);
    const forwardPoint = routeApi.edgeCurveControlPoint(0, 0, 100, 0, forward, routeApi.edgeRouteFor(forward, routeIndex));
    const reversePoint = routeApi.edgeCurveControlPoint(100, 0, 0, 0, reverse, routeApi.edgeRouteFor(reverse, routeIndex));

    expect(forwardPoint.y).toBeGreaterThan(0);
    expect(reversePoint.y).toBeLessThan(0);

    const single = { id: "single", fromNodeId: "a", toNodeId: "b", metadata: {} };
    const grouped = { id: "grouped", fromNodeId: "a", toNodeId: "b", metadata: { evidenceType: "grouped_transfers" } };
    const layeredIndex = routeApi.buildEdgeRouteIndex([grouped, single]);
    const singleRoute = routeApi.edgeRouteFor(single, layeredIndex);
    const groupedRoute = routeApi.edgeRouteFor(grouped, layeredIndex);
    expect(singleRoute.routeRank).toBeLessThan(groupedRoute.routeRank);
    expect(groupedRoute.parallelOffset - singleRoute.parallelOffset).toBeCloseTo(0.16);
    const singlePoint = routeApi.edgeCurveControlPoint(0, 0, 100, 0, single, singleRoute);
    const groupedPoint = routeApi.edgeCurveControlPoint(0, 0, 100, 0, grouped, groupedRoute);
    expect(groupedPoint.y - singlePoint.y).toBeGreaterThan(12);
  });

  it("keeps local-orbit edge labels attached to separated curves", () => {
    const html = adminConsoleHtml();
    const labelBlock = html.slice(html.indexOf("function edgeLabelPoint"), html.indexOf("function edgeMarkerId"));
    const routeBlock = html.slice(html.indexOf("function buildEdgeRouteIndex"), html.indexOf("function edgeCurvePath"));

    expect(routeBlock).toContain("directionSign: sign");
    expect(routeBlock).toContain("sameDirectionIndex");
    expect(routeBlock).toContain("parallelOffset");
    expect(routeBlock).toContain("edgeRouteRank(left) - edgeRouteRank(right)");
    expect(labelBlock).toContain("const t = edgeVisualRole(edge) === \"stop\" ? 0.58 : 0.52;");
    expect(labelBlock).toContain("const role = edgeVisualRole(edge);");
    expect(labelBlock).toContain("const side = role === \"stop\" || role === \"peer\" ? -1 : 1;");
    expect(labelBlock).toContain("function avoidEdgeLabelCollisions");
    expect(labelBlock).toContain("const shifts = [0, -28, 28, -52, 52, -78, 78, -106, 106, -138, 138];");
  });

  it("keeps edge labels honest and avoids label-node overlaps on the canvas", () => {
    const html = adminConsoleHtml();
    const renderBlock = html.slice(html.indexOf("function renderGraph"), html.indexOf("function isCollapsedGroupNodeId"));

    expect(html).toContain("function edgeCanvasAmountOrMissingLabel");
    expect(html).toContain('return "Context only; no stored transaction evidence.";');
    expect(html).toContain("function edgeMergedBoundaryContextLines");
    expect(html).toContain("Related boundary context");
    expect(html).toContain("Graph uses the USDT transfer event. Tronscan header may show the smart-contract caller instead.");
    expect(html).toContain("function avoidEdgeLabelCollisions");
    expect(html).toContain("function labelIntersectsNode");
    expect(renderBlock).toContain("const edgeLabelItems =");
    expect(renderBlock).toContain("const placedEdgeLabelItems = avoidEdgeLabelCollisions(edgeLabelItems, placed.nodes);");
  });

  it("caps edge thickness and shows compact honest time on canvas labels", () => {
    const html = adminConsoleHtml();
    const selectedEdgeCardBlock = html.slice(html.indexOf("function selectedEdgeCard"), html.indexOf("function renderSelectionCard"));

    expect(html).toContain("function compactAmountLabel");
    expect(html).toContain("return trimNumber(amount / 1000) + \"K\";");
    expect(html).toContain("function edgeCanvasLabel");
    expect(html).toContain("return compactAmountLabel(edgeOriginalAmount(edge) || edgeAmount(edge));");
    expect(html).toContain("function edgeStrokeWidth");
    expect(html).toContain('if (evidenceType === "contract_trigger_context") return 1.25;');
    expect(html).toContain('if (role === "peer") return 1.2;');
    expect(html).toContain('if (role === "context") return 1.25;');
    expect(html).toContain('return Math.max(1.45, Math.min(2.8, scaled));');
    expect(html).not.toContain("Math.min(8, scaled)");
    expect(html).not.toContain("Math.min(4.4, scaled)");
    const strokeBlock = html.slice(html.indexOf("function edgeStrokeWidth"), html.indexOf("function edgePairKey"));
    const strokeApi = new Function(
      "function edgeVisualRole(edge) { return edge?.visualRole || 'incoming'; }" +
        strokeBlock +
        "return { edgeStrokeWidth };"
    )() as { edgeStrokeWidth(edge: unknown): number };
    expect(strokeApi.edgeStrokeWidth({
      visualRole: "service",
      amountRaw: "500000000000",
      metadata: { evidenceType: "contract_trigger_context" }
    })).toBe(1.25);
    expect(strokeApi.edgeStrokeWidth({
      visualRole: "incoming",
      amountRaw: "500000000000"
    })).toBeLessThanOrEqual(2.8);
    expect(html).toContain("function edgeShouldShowCanvasAmount");
    expect(html).toContain("function edgeShouldShowCanvasTime");
    expect(html).toContain('if (edgeDisplayRole(edge) === "collapsed_group") return false;');
    expect(html).toContain('if (edgeDisplayRole(edge) === "bundle_member") return false;');
    expect(html).not.toContain('if (edgeIsPeerLink(edge)) return false;');
    expect(html).not.toContain('if (edgeVisualRole(edge) === "context") return false;');
    expect(html).toContain('if (edge?.type === "stop" || edgeDisplayRole(edge) === "stop") return false;');
    expect(html).toContain("function edgeCanvasTimeLabel");
    expect(html).toContain('if (hold) return "hold " + hold;');
    expect(html).toContain('if (span) return "span " + span;');
    expect(html).toContain('if (gap) return "gap " + gap;');
    expect(html).toContain('return canvasTimestampLabel(edge?.timestamp || edgeTime(edge));');
    expect(html).toContain(".amount-pill rect { fill: rgba(11, 14, 17, .9); stroke: transparent;");
    expect(html).toContain(".amount-pill .amount-line { fill: #ffffff; font-weight: 500;");
    expect(html).toContain(".amount-pill .time-line { fill: var(--pill-accent); font-size: 9.5px; font-weight: 560;");
    expect(html).toContain("function edgeSpeedClass");
    expect(html).toContain('if (ms <= 15 * 60000) return "edge-speed-strong";');
    expect(html).toContain('if (ms <= 60 * 60000) return "edge-speed-medium";');
    expect(html).toContain('if (ms <= 6 * 60 * 60000) return "edge-speed-soft";');
    expect(html).toContain('if (ms <= 24 * 60 * 60000) return "edge-speed-faint";');
    expect(html).toContain(".edge.edge-speed-strong { filter: drop-shadow(0 0 10px rgba(237, 244, 251, .58)); }");
    expect(html).toContain(".edge.selected { opacity: 1; filter: drop-shadow(0 0 12px rgba(125, 166, 255, .42)); }");
    expect(html).toContain(".amount-pill.edge-speed-faint { filter: drop-shadow(0 0 4px var(--pill-glow)); }");
    expect(html).toContain("function edgeMarkerDefs");
    expect(html).toContain('marker("edgeArrowIncoming", "#8fe9af")');
    expect(html).toContain('marker("edgeArrowPeer", "#c3ced9", ".72")');
    expect(html).toContain('marker("edgeArrowGrouped", "#d8c7ff", ".86")');
    expect(html).toContain('if (edgeIsGroupedContextEvidence(edge)) return "edgeArrowGrouped";');
    expect(html).not.toContain('marker("edgeArrowPeer", "#f6c177"');
    expect(html).toContain('const marker = \' marker-end="url(#\' + edgeMarkerId(edge, visualRole) + \')"\'');
    expect(html).toContain(".node.selected.node-display-cex circle { filter: drop-shadow(0 0 14px rgba(247, 215, 116, .58)); }");
    expect(html).toContain("const shouldShowAmount = labelEnabled && edgeShouldShowCanvasAmount(edge);");
    expect(html).toContain("const shouldShowTime = labelEnabled && edgeShouldShowCanvasTime(edge);");
    expect(html).toContain("const speedClass = edgeSpeedClass(edge);");
    expect(html).toContain("const timeLabel = edgeCanvasTimeLabel(edge);");
    expect(html).toContain('const amountLines = labelEnabled ? [shouldShowAmount ? amountLabel : ""].filter(Boolean) : [];');
    expect(html).toContain('const timeLines = shouldShowTime ? [timeLabel] : [];');
    expect(html).toContain("const label = [...amountLines, ...timeLines];");
    expect(html).toContain("amountPill(label, labelItem.labelPoint.x, labelItem.labelPoint.y, speedClass, labelRoleClass)");
    expect(selectedEdgeCardBlock).not.toContain('cardLine("Full time", edgeTime(edge) || analystMissingCopy("time"))');
    expect(selectedEdgeCardBlock).not.toContain('cardLine("Tx gap", edgeTxGap(edge) || analystMissingCopy("time"))');
  });

  it("keeps canvas time labels visible when amount labels are off", () => {
    const html = adminConsoleHtml();

    expect(html).toContain('const amountLines = labelEnabled ? [shouldShowAmount ? amountLabel : ""].filter(Boolean) : [];');
    expect(html).toContain('const timeLines = shouldShowTime ? [timeLabel] : [];');
    expect(html).toContain("const label = [...amountLines, ...timeLines];");
    expect(html).toContain(".amount-pill .amount-line { fill: #ffffff; font-weight: 500;");
    expect(html).toContain(".amount-pill rect { fill: rgba(11, 14, 17, .9); stroke: transparent;");
  });

  it("shows selected node connected neighbors in the analytics rail", () => {
    const html = adminConsoleHtml();
    const connectedNeighborLinesBlock = html.slice(html.indexOf("function connectedNeighborLines"), html.indexOf("function selectedNodeCard"));
    const selectedNodeCardBlock = html.slice(html.indexOf("function selectedNodeCard"), html.indexOf("function selectedEdgeCard"));
    const walletDetailBlock = html.slice(html.indexOf("function walletDetailBlock"), html.indexOf("function transferDetailBlock"));

    expect(html).toContain("function connectedNeighborLines");
    expect(html).toContain("edgeIsPeerLink(edge)");
    expect(connectedNeighborLinesBlock).toContain("return filteredTransferEdges()");
    expect(html).toContain("addressDetailLink(otherAddress)");
    expect(html).toContain("txDetailLink(edge.txHash || \"inferred\")");
    expect(html).toContain("function internalLinkListHtml");
    expect(selectedNodeCardBlock).toContain("function selectedNodeCard");
    expect(selectedNodeCardBlock).toContain(
      'cardLineHtml("Address", addressDetailLink(nodeAddress(node) || node.id)) +\n' +
        '        cardLineHtml("Connected neighbors", internalLinkListHtml(connectedNeighborLines(node), "No connected neighbor links.")) +\n' +
        '        selectedNodeTransferBlock(node) +\n' +
        '        cardLine("Label", nodeDisplayLabel(node))'
    );
    expect(walletDetailBlock).toContain("function walletDetailBlock");
    expect(walletDetailBlock).not.toContain("Connected neighbors");
  });
});

