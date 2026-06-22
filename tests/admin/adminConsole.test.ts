import { describe, expect, it } from "vitest";
import { adminConsoleHtml } from "../../src/admin/adminConsole";

describe("adminConsoleHtml", () => {
  it("renders the graph-first investigation shell", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("data-admin-console");
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
    expect(html).toContain("jobsOpen: true");
    expect(html).toContain("analyticsOpen: true");
    expect(html).toContain(".overlay-panel.jobs-panel { left: 12px;");
    expect(html).toContain(".overlay-panel.analytics-panel { right: 12px;");
    expect(html).toContain(".graph-action-row");
    expect(html).toContain("grid-template-columns: auto minmax(8px, 1fr) auto");
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
    expect(html).toContain('cardLineHtml("From", addressDetailLink(edgeFromAddress(edge) || edge.fromNodeId))');
    expect(html).toContain('cardLineHtml("To", addressDetailLink(edgeToAddress(edge) || edge.toNodeId))');
    expect(html).toContain('cardLineHtml("Tx", txDetailLink(edge.txHash || "inferred"))');
    expect(html).toContain("return amount + \" - \" + short(address, 7);");
    expect(html).toContain('explorerLink(edgeFromTronScanUrl(edge), short(edgeFromAddress(edge), 7))');
    expect(html).toContain('explorerLink(edgeToTronScanUrl(edge), short(edgeToAddress(edge), 7))');
  });

  it("keeps desktop graph toolbar compact and stacks only on narrow screens", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("@media (max-width: 1440px)");
    expect(html).toContain(`@media (max-width: 1680px) {
      .graph-action-row { gap: 6px; padding: 4px 6px; }
      .graph-control-group { gap: 5px; }
      .graph-action-row button, .graph-action-row select { padding: 0 7px; flex: 0 0 auto; }
      .graph-action-row #amountMode { width: 180px; }
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
    expect(html).not.toContain("@media (max-width: 1180px)");
    expect(html).toContain('const statLabel = (value, label) => value + " " + label + (value === 1 ? "" : "s");');
    expect(html).toContain("const graphStatsText = [");
    expect(html).not.toContain(".graph-action-row #amountMode { width: 142px; }");
    expect(html).not.toContain(".graph-action-row #amountMode { width: 160px; }");
    expect(html).toContain('const graphStatsTitle = [');
    expect(html).toContain('"N" + placed.nodes.length');
    expect(html).toContain('"W" + graphWeights(graph).length');
    expect(html).toContain('title="\' + escapeHtml(graphStatsTitle) + \'"');
    expect(html).toContain(".graph-action-row {\n        top: 128px;");
    expect(html).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(html).toContain(".graph-control-group { flex-wrap: wrap; }");
    expect(html).toContain(".overlay-panel { top: 224px; max-height: 360px; }");
    expect(html).toContain(".overlay-panel.analytics-panel { left: 12px; right: auto; }");
    expect(html).toContain(".overlay-panel.analytics-panel { top: calc(224px + 372px); }");
    expect(html).toContain('class="overlay-body analytics-body"');
    expect(html).toContain('class="selection-card analytics-selection-card" id="selectionCard"');
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
    expect(html).toContain("densityMode: localStorage.getItem(\"adminForensicsDensityMode\") || \"fan\"");
    expect(html).toContain("peerLinksVisible: localStorage.getItem(\"adminForensicsPeerLinks\") !== \"off\"");
    expect(html).toContain("function setDensityMode");
    expect(html).toContain("function syncDenseGraphControls");
    expect(html).toContain('el("densityMode").addEventListener("click", () => {');
    expect(html).toContain('el("peerLinksMode").addEventListener("click", () => {');
    expect(html).toContain('localStorage.setItem("adminForensicsDensityMode", state.densityMode);');
    expect(html).toContain('localStorage.setItem("adminForensicsPeerLinks", state.peerLinksVisible ? "on" : "off");');
  });

  it("contains deterministic dense fan presentation helpers", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function graphIsDense");
    expect(html).toContain("return nodes.length > 32 || edges.length > 50;");
    expect(html).toContain("function graphDisplayMode");
    expect(html).toContain('return state.densityMode === "show_all" ? "show_all" : "fan";');
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

  it("routes dense graphs between fan overview and show-all timeline layout", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function legacyFanLayout");
    expect(html).toContain("function denseFanLayout");
    expect(html).toContain("function timelineLaneLayout");
    expect(html).toContain("function graphPresentation");
    expect(html).toContain("return { ...buildDenseFanPresentation(rawVisibleNodes, rawVisibleEdges), mode, dense };");
    expect(html).toContain('function graphFirstLayout(sourceNodes, sourceEdges, mode = graphDisplayMode(sourceNodes, sourceEdges), dense = graphIsDense(sourceNodes, sourceEdges))');
    expect(html).toContain('if (dense && mode === "show_all") return timelineLaneLayout(sourceNodes, sourceEdges);');
    expect(html).toContain('if (dense && mode === "fan") return denseFanLayout(sourceNodes, sourceEdges);');
    expect(html).toContain("return legacyFanLayout(sourceNodes, sourceEdges);");
    expect(html).toContain("function isCollapsedGroupNodeId");
    expect(html).toContain("function expandCollapsedGroup");
    expect(html).toContain("if (isCollapsedGroupNodeId(nodeId)) {");
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

  it("contains peer-link classification and selected-neighbor highlighting", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function graphSubjectNodeId");
    expect(html).toContain("function edgeIsPeerLink");
    expect(html).toContain("return edge?.fromNodeId !== subjectId && edge?.toNodeId !== subjectId;");
    expect(html).toContain("function edgePassesPeerLinkFilter");
    expect(html).toContain("if (!state.peerLinksVisible && edgeIsPeerLink(edge)) return false;");
    expect(html).toContain("function edgeIsSelectionRelated");
    expect(html).toContain('edge-flow-peer');
    expect(html).toContain(".edge-flow-peer");
    expect(html).toContain(".edge-flow-peer.selected");
  });
});
