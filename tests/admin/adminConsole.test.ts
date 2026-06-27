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
    expect(html).toContain("if (isCollapsedGroupNodeId(nodeId)) return;");
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

  it("keeps subject wallet identity separate from behavior role and shows deep-check coverage", () => {
    const html = adminConsoleHtml();
    const subjectBlock = html.slice(html.indexOf("function subjectReportBlock"), html.indexOf("function nodeIntelligenceEvidenceLabel"));
    const intelligenceBlock = html.slice(html.indexOf("function nodeIntelligenceBlock"), html.indexOf("function traceStopDetailBlock"));

    expect(subjectBlock).toContain("DeepCheck coverage");
    expect(subjectBlock).toContain("direct counterparties analyzed");
    expect(subjectBlock).toContain("counterparties expanded");
    expect(subjectBlock).toContain("transfer edges collected");
    expect(subjectBlock).toContain("extended addresses fetched");
    expect(intelligenceBlock).toContain("behavior marker, not final risk proof by itself");
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
    expect(html).toContain('cardLineHtml("From", endpointDetailLink(edge, "from"))');
    expect(html).toContain('cardLineHtml("To", endpointDetailLink(edge, "to"))');
    expect(html).toContain('cardLineHtml("Tx", txDetailLink(edgePrimaryTxHash(edge) || "inferred"))');
    expect(html).toContain("return amount + \" - \" + short(address, 7);");
    expect(html).toContain('explorerLink(edgeFromTronScanUrl(edge), short(edgeFromAddress(edge), 7))');
    expect(html).toContain('explorerLink(edgeToTronScanUrl(edge), short(edgeToAddress(edge), 7))');
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
    })).toBe("2 tx / 350 raw");
    expect(labelApi.edgeContextCanvasLabel({
      type: "service_boundary",
      metadata: { underlyingTransfers: [{}, {}] }
    })).toBe("2 tx");
    expect(labelApi.edgeCanvasAmountOrMissingLabel({
      type: "service_boundary",
      metadata: { evidenceType: "boundary_context" }
    })).toBe("Amount not available for this projected context edge.");
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

  it("routes dense address deep checks to wallet clusters with a temporary layout compatibility shim", () => {
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
    expect(html).toContain("Task 2 routing shim");
    expect(layoutBlock).toContain('if (mode === "wallet_clusters") return walletClusterLayout(sourceNodes, sourceEdges);');
    expect(layoutBlock).toContain('if (mode === "deep_branch_map") return deepBranchMapLayout(sourceNodes, sourceEdges);');
    expect(graphPresentationBlock).toContain('if (mode === "wallet_clusters" || mode === "deep_branch_map") {');
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

  it("builds a deep-check branch presentation with grouped low-priority branch nodes", () => {
    const html = adminConsoleHtml();
    const presentationBlock = html.slice(html.indexOf("function buildDeepBranchPresentation"), html.indexOf("function applyExpandedBundlePresentation"));
    const semanticAttrsBlock = html.slice(html.indexOf("function edgeSemanticAttrs"), html.indexOf("function renderGraph"));
    const renderBlock = html.slice(html.indexOf("function renderGraph"), html.indexOf("function isCollapsedGroupNodeId"));
    const graphPresentationBlock = html.slice(html.indexOf("function graphPresentation"), html.indexOf("function layout"));

    expect(html).toContain("function buildDeepBranchPresentation");
    expect(html).toContain("function deepBranchStep1NodeIds");
    expect(presentationBlock).toContain("const anchorByNodeId = new Map();");
    expect(presentationBlock).toContain("anchorByNodeId.get(node.id)");
    expect(presentationBlock).toContain("anchorByNodeId.get(hiddenNodeId)");
    expect(html).toContain("function deepBranchSummaryNode");
    expect(html).toContain("function graphLegendHtml");
    expect(html).toContain("function edgeSemanticAttrs");
    expect(html).toContain("function nodeSemanticAttrs");
    expect(html).toContain("Direct transfer");
    expect(html).toContain("Inferred/context");
    expect(html).toContain("Services");
    expect(html).toContain("Boundary stops");
    expect(html).toContain("Collapsed branches");
    expect(presentationBlock).toContain('metadata: {');
    expect(presentationBlock).toContain('deepBranchAnchorId');
    expect(presentationBlock).toContain('hiddenNodeIds');
    expect(presentationBlock).toContain('groupReason: "deep_branch_overview"');
    expect(presentationBlock).toContain('if (!state.servicesVisible && nodeIsServiceLike(node)) return false;');
    expect(presentationBlock).toContain('displayRole: "collapsed_group"');
    expect(semanticAttrsBlock).toContain('data-edge-role="');
    expect(semanticAttrsBlock).toContain('data-edge-directness="');
    expect(semanticAttrsBlock).toContain('data-node-display-kind="');
    expect(semanticAttrsBlock).toContain('data-deep-branch-anchor-id="');
    expect(renderBlock).toContain("edgeSemanticAttrs(edge, visualRole)");
    expect(renderBlock).toContain("nodeSemanticAttrs(node)");
    expect(renderBlock).toContain('graphLegendHtml(presentation.mode)');
    expect(graphPresentationBlock).toContain('if (mode === "wallet_clusters" || mode === "deep_branch_map") {');
  });

  it("executes default wallet clusters through deep-branch presentation semantics", () => {
    const html = adminConsoleHtml();
    const graphModeBlock = html.slice(html.indexOf("function graphIsDense"), html.indexOf("function buildDenseFanPresentation"));
    const presentationBlock = html.slice(html.indexOf("function deepBranchStep1NodeIds"), html.indexOf("function applyExpandedBundlePresentation"));
    const applyBlock = html.slice(html.indexOf("function applyExpandedBundlePresentation"), html.indexOf("function expandedBundleMemberNodes"));
    const graphPresentationBlock = html.slice(html.indexOf("function graphPresentation"), html.indexOf("function layout"));
    const edgeDirectnessBlock = html.slice(html.indexOf("function edgeDirectness"), html.indexOf("function edgeDirectionMeaning"));
    const renderOutputBlock = html.slice(html.indexOf("function graphLegendHtml"), html.indexOf("function renderGraph"));
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
      function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char] || char));
      }
      ${graphModeBlock}
      ${presentationBlock}
      ${applyBlock}
      ${graphPresentationBlock}
      ${edgeDirectnessBlock}
      ${renderOutputBlock}
      return { graphPresentation, edgeSemanticAttrs, nodeSemanticAttrs, graphLegendHtml };
    `)();
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

    const presentation = api.graphPresentation(nodes, edges);
    const group = presentation.nodes.find((node: { id?: string }) => node.id === "collapsed:deep:anchor");
    const collapsed = presentation.edges.find((edge: { metadata?: { sourceEdgeId?: string } }) => edge.metadata?.sourceEdgeId === "hidden-anchor");
    const nodeOutput = api.nodeSemanticAttrs(group);
    const edgeOutput = api.edgeSemanticAttrs(collapsed, "context");
    const legendOutput = api.graphLegendHtml(presentation.mode);

    expect(presentation.mode).toBe("wallet_clusters");
    expect(group).toMatchObject({
      kind: "group",
      displayKind: "collapsed_group",
      metadata: {
        deepBranchAnchorId: "anchor",
        hiddenNodeIds: ["hiddenSource"],
        groupReason: "deep_branch_overview",
      },
    });
    expect(edgeOutput).toContain('data-edge-role="context"');
    expect(edgeOutput).toContain('data-edge-display-role="collapsed_group"');
    expect(edgeOutput).toContain('data-edge-directness="inferred"');
    expect(nodeOutput).toContain('data-node-display-kind="collapsed_group"');
    expect(nodeOutput).toContain('data-deep-branch-anchor-id="anchor"');
    expect(legendOutput).toContain('data-graph-legend="wallet_clusters"');
    expect(legendOutput).toContain("Direct transfer");
    expect(legendOutput).toContain("Collapsed branches");
  });

  it("preserves collapsed deep-check edge direction when the hidden node is the transfer source", () => {
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
    const collapsed = presentation.edges.find((edge: { metadata?: { sourceEdgeId?: string } }) => edge.metadata?.sourceEdgeId === "hidden-anchor");

    expect(collapsed).toMatchObject({
      fromNodeId: "collapsed:deep:anchor",
      toNodeId: "anchor",
      displayRole: "collapsed_group",
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
    expect(html).toContain("function applyExpandedBundlePresentation");
    expect(html).toContain("function expandedBundleMemberNodes");
    expect(html).toContain("function expandedBundleMemberEdges");
    expect(html).toContain("return { ...applyExpandedBundlePresentation(presentation.nodes, presentation.edges), mode, dense };");
    expect(html).toContain("function expandSelectedGraphItem");
    expect(html).toContain('state.expandedBundleNodeIds.add(state.selected.id);');
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
    expect(loadGraphSuccessBlock).toContain("state.expandedBundleNodeIds.clear();");
    expect(loadGraphSuccessBlock.indexOf("state.expandedBundleNodeIds.clear();")).toBeGreaterThan(loadGraphSuccessBlock.indexOf("state.activeJobId = jobId;"));
  });

  it("formats bundle detail endpoints without exposing raw bundle ids", () => {
    const html = adminConsoleHtml();
    const externalBlock = html.slice(html.indexOf("function bundleExternalEdgeLines"), html.indexOf("function bundleDetailBlock"));
    const selectedEdgeCardBlock = html.slice(html.indexOf("function selectedEdgeCard"), html.indexOf("function renderSelectionCard"));
    const transferDetailBlock = html.slice(html.indexOf("function transferDetailBlock"), html.indexOf("function fitGraph"));

    expect(html).toContain("function edgePrimaryTxHash");
    expect(html).toContain('return edge?.txHash || asArray(edge?.metadata?.txHashes)[0] || "";');
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
    expect(selectedEdgeCardBlock).toContain('cardLineHtml("From", endpointDetailLink(edge, "from"))');
    expect(selectedEdgeCardBlock).toContain('cardLineHtml("To", endpointDetailLink(edge, "to"))');
    expect(transferDetailBlock).toContain('metricHtml("From", endpointDetailLink(edge, "from"), "wide")');
    expect(transferDetailBlock).toContain('metricHtml("To", endpointDetailLink(edge, "to"), "wide")');
    expect(selectedEdgeCardBlock).not.toContain('addressDetailLink(edgeToAddress(edge) || edge.toNodeId)');
    expect(transferDetailBlock).not.toContain("explorerLink(edgeToTronScanUrl(edge), edgeToAddress(edge) || edge.toNodeId)");
    expect(html).toContain('data-action="expand-bundle"');
    expect(html).toContain("function handleDetailActionClick");
    expect(html).toContain('if (action === "expand-bundle") {');
    expect(html).not.toContain('onclick="document.getElementById(&quot;expandSelected&quot;).click()"');
  });

  it("shows selected edge evidence type and projected context amount explanation", () => {
    const html = adminConsoleHtml();
    const selectedEdgeCardBlock = html.slice(html.indexOf("function selectedEdgeCard"), html.indexOf("function renderSelectionCard"));
    const transferDetailBlock = html.slice(html.indexOf("function transferDetailBlock"), html.indexOf("function fitGraph"));

    expect(selectedEdgeCardBlock).toContain('cardLine("Evidence type", edgeEvidenceTypeLabel(edge))');
    expect(transferDetailBlock).toContain('metric("Evidence type", edgeEvidenceTypeLabel(edge))');
    expect(transferDetailBlock).toContain('metric("Evidence meaning", edgeEvidenceMeaning(edge), "wide")');
    expect(transferDetailBlock).toContain('metric("Aggregate amount", edgeAggregateAmountLabel(edge) || "n/a")');
    expect(transferDetailBlock).toContain('metric("Transfer count", edgeAggregateTransferCount(edge) ?? "n/a")');
    expect(transferDetailBlock).toContain('listMetric("Underlying transactions", edgeUnderlyingTransferLines(edge), "No underlying transactions stored.")');
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

  it("reveals only the expanded deep-check branch group in place", () => {
    const html = adminConsoleHtml();
    const presentationBlock = html.slice(html.indexOf("function deepBranchStep1NodeIds"), html.indexOf("function applyExpandedBundlePresentation"));
    const api = new Function(
      "const state = { servicesVisible: true, expandedBundleNodeIds: new Set([\"collapsed:deep:anchor-a\"]) };\n" +
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
    expect(nodeIds.has("b-hidden")).toBe(false);
    expect(nodeIds.has("collapsed:deep:anchor-b")).toBe(true);
    expect(presentation.nodes.find((node: { id: string; metadata?: { deepBranchAnchorId?: string } }) => node.id === "a-hidden")?.metadata?.deepBranchAnchorId).toBe("anchor-a");
  });

  it("routes dense graphs between fan overview and show-all timeline layout", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function legacyFanLayout");
    expect(html).toContain("function denseFanLayout");
    expect(html).toContain("function timelineLaneLayout");
    expect(html).toContain("function graphPresentation");
    expect(html).toContain("presentation = buildDenseFanPresentation(rawVisibleNodes, rawVisibleEdges);");
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
    expect(html).toContain("const laneY = { incoming: height * 0.25, subject: height * 0.48, outgoing: height * 0.63, service: height * 0.78, context: height * 0.36 };");
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

  it("formats canvas edge time as readable UTC text and hides missing canvas time", () => {
    const html = adminConsoleHtml();
    const timeBlock = html.slice(html.indexOf("function canvasTimestampLabel"), html.indexOf("function edgeCanvasTimeLabel"));
    const edgeTimeBlock = html.slice(html.indexOf("function edgeCanvasTimeLabel"), html.indexOf("function edgeSpeedMs"));

    expect(html).toContain("const canvasMonthNames =");
    expect(html).toContain("function canvasTimestampLabel");
    expect(timeBlock).toContain('const includeYear = date.getUTCFullYear() !== new Date().getUTCFullYear();');
    expect(timeBlock).toContain('return (includeYear ? date.getUTCFullYear() + " " : "") + canvasMonthNames[date.getUTCMonth()] + " " + day + ", " + hour + ":" + minute;');
    expect(edgeTimeBlock).toContain('return canvasTimestampLabel(edge?.timestamp || edgeTime(edge));');
    expect(edgeTimeBlock).not.toContain('|| "time n/a"');
  });

  it("colors edge labels from their edge role and speed state", () => {
    const html = adminConsoleHtml();
    const pillBlock = html.slice(html.indexOf("function amountPill"), html.indexOf("function canvasNodeLabel"));
    const renderBlock = html.slice(html.indexOf("function renderGraph"), html.indexOf("function isCollapsedGroupNodeId"));

    expect(html).toContain("function edgeLabelRoleClass");
    expect(html).toContain(".amount-pill.label-role-incoming { --pill-accent: #8fe9af;");
    expect(html).toContain(".amount-pill.label-role-service { --pill-accent: #ffd36b;");
    expect(html).toContain(".amount-pill.label-role-stop { --pill-accent: #f6c177;");
    expect(html).toContain(".amount-pill.label-role-peer { --pill-accent: #f6c177;");
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
  });

  it("keeps local-orbit edge labels attached to separated curves", () => {
    const html = adminConsoleHtml();
    const labelBlock = html.slice(html.indexOf("function edgeLabelPoint"), html.indexOf("function edgeMarkerId"));
    const routeBlock = html.slice(html.indexOf("function buildEdgeRouteIndex"), html.indexOf("function edgeCurvePath"));

    expect(routeBlock).toContain("directionSign: sign");
    expect(routeBlock).toContain("sameDirectionIndex");
    expect(routeBlock).toContain("parallelOffset");
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
    expect(html).toContain('return "Amount not available for this projected context edge.";');
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
    expect(html).toContain('if (role === "peer") return 1.5;');
    expect(html).toContain('if (role === "context") return 1.8;');
    expect(html).toContain('return Math.max(2, Math.min(4.4, scaled));');
    expect(html).not.toContain("Math.min(8, scaled)");
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
    expect(html).toContain('const marker = \' marker-end="url(#\' + edgeMarkerId(visualRole) + \')"\'');
    expect(html).toContain(".node.selected.node-display-cex circle { filter: drop-shadow(0 0 14px rgba(247, 215, 116, .58)); }");
    expect(html).toContain("const shouldShowAmount = labelEnabled && edgeShouldShowCanvasAmount(edge);");
    expect(html).toContain("const shouldShowTime = labelEnabled && edgeShouldShowCanvasTime(edge);");
    expect(html).toContain("const speedClass = edgeSpeedClass(edge);");
    expect(html).toContain("const timeLabel = edgeCanvasTimeLabel(edge);");
    expect(html).toContain('const amountLines = labelEnabled ? [shouldShowAmount ? amountLabel : ""].filter(Boolean) : [];');
    expect(html).toContain('const timeLines = shouldShowTime ? [timeLabel] : [];');
    expect(html).toContain("const label = [...amountLines, ...timeLines];");
    expect(html).toContain("amountPill(label, labelItem.labelPoint.x, labelItem.labelPoint.y, speedClass, labelRoleClass)");
    expect(selectedEdgeCardBlock).toContain('cardLine("Full time", edgeTime(edge) || "time n/a")');
    expect(selectedEdgeCardBlock).toContain('cardLine("Tx gap", edgeTxGap(edge) || "n/a")');
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
        '        cardLine("Label", nodeDisplayLabel(node))'
    );
    expect(walletDetailBlock).toContain("function walletDetailBlock");
    expect(walletDetailBlock).not.toContain("Connected neighbors");
  });
});
