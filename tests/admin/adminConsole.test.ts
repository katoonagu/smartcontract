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
    expect(html).toContain(".overlay-panel.jobs-panel { left: 12px; width: var(--left-rail-width); }");
    expect(html).toContain(".overlay-panel.analytics-panel { right: 12px; width: var(--right-rail-width); }");
    expect(html).toContain('const statLabel = (value, label) => value + " " + label + (value === 1 ? "" : "s");');
    expect(html).toContain("const graphStatsText = [");
    expect(html).not.toContain(".graph-action-row #amountMode { width: 142px; }");
    expect(html).not.toContain(".graph-action-row #amountMode { width: 160px; }");
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
    expect(html).toContain("densityMode: initialGraphViewMode()");
    expect(html).toContain("peerLinksVisible: localStorage.getItem(\"adminForensicsPeerLinks\") !== \"off\"");
    expect(html).toContain("function setDensityMode");
    expect(html).toContain("function syncDenseGraphControls");
    expect(html).toContain('el("densityMode").addEventListener("click", () => {');
    expect(html).toContain('el("peerLinksMode").addEventListener("click", () => {');
    expect(html).toContain('localStorage.setItem("adminForensicsGraphViewMode", state.densityMode);');
    expect(html).toContain('localStorage.setItem("adminForensicsPeerLinks", state.peerLinksVisible ? "on" : "off");');
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

  it("defaults dense incoming and where-is-money graphs to step orbit mode", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("adminForensicsGraphViewMode");
    expect(html).toContain('if (mode === "show_all") return "show_all";');
    expect(html).toContain('if (mode === "fan") return "fan";');
    expect(html).toContain('if (graphKindSupportsStepOrbit(state.graph?.job?.kind)) return "step_orbit";');
    expect(html).toContain('return "fan";');
    expect(html).toContain("function graphKindSupportsStepOrbit");
    expect(html).toContain('return kind === "incoming_deposit_check" || kind === "where_is_money_check";');
    expect(html).toContain("function buildStepOrbitPresentation");
    expect(html).toContain("function stepOrbitLayout");
    expect(html).toContain('if (dense && mode === "step_orbit") return stepOrbitLayout(sourceNodes, sourceEdges);');
    expect(html).toContain('densityButton.textContent = mode === "step_orbit" ? "Step orbit" : mode === "show_all" ? "Show all raw" : "Fan overview";');
    expect(html).toContain('"Step orbit"');
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

  it("shows funding bundles as expandable groups with right-rail internals", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("expandedBundleNodeIds: new Set()");
    expect(html).toContain("renderedNodesById: new Map()");
    expect(html).toContain("renderedEdgesById: new Map()");
    expect(html).toContain('id="expandSelected"');
    expect(html).toContain("function bundleCanvasLabel");
    expect(html).toContain('return "Group: " + memberCount + " wallets";');
    expect(html).toContain("function bundleSubLabel");
    expect(html).toContain("function expandedBundleMemberNodes");
    expect(html).toContain("function expandedBundleMemberEdges");
    expect(html).toContain("function expandSelectedGraphItem");
    expect(html).toContain('state.expandedBundleNodeIds.add(state.selected.id);');
    expect(html).toContain("function edgeById");
    expect(html).toContain("return graphNodes(state.graph).find((node) => node.id === nodeId) || state.renderedNodesById.get(nodeId) || null;");
    expect(html).toContain("return graphEdges(state.graph).find((edge) => edge.id === edgeId) || state.renderedEdgesById.get(edgeId) || null;");
    expect(html).toContain("state.renderedNodesById = new Map(placed.nodes.map((node) => [node.id, node]));");
    expect(html).toContain("state.renderedEdgesById = new Map(visibleEdges.map((edge) => [edge.id, edge]));");
    expect(html).toContain("function bundleInternalEdgeLines");
    expect(html).toContain("Internal transfers were not found in saved graph data.");
    expect(html).toContain("This is a group, not a wallet.");
    expect(html).toContain("Expand bundle");
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
    expect(html).toContain('return String(nodeId || "").startsWith("collapsed:") || String(nodeId || "").startsWith("step:");');
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
    expect(html).toContain('if (edgeIsPeerLink(edge)) return false;');
    expect(html).toContain('if (edgeDisplayRole(edge) === "collapsed_group") return false;');
    expect(html).toContain('if (edgeDisplayRole(edge) === "bundle_member") return false;');
    expect(html).toContain('if (edgeVisualRole(edge) === "context") return false;');
    expect(html).toContain("function edgeCanvasTimeLabel");
    expect(html).toContain('if (hold) return "hold " + hold;');
    expect(html).toContain('if (span) return "span " + span;');
    expect(html).toContain('if (gap) return "gap " + gap;');
    expect(html).toContain('return shortTimestamp(edge?.timestamp || edgeTime(edge)) || "time n/a";');
    expect(html).toContain("const shouldShowAmount = edgeShouldShowCanvasAmount(edge)");
    expect(html).toContain("const timeLabel = edgeCanvasTimeLabel(edge);");
    expect(html).toContain("const label = state.amountMode === \"off\"");
    expect(html).toContain("? []");
    expect(html).toContain(": [shouldShowAmount ? amountLabel : \"\", shouldShowAmount ? timeLabel : \"\"].filter(Boolean);");
    expect(selectedEdgeCardBlock).toContain('cardLine("Full time", edgeTime(edge) || "time n/a")');
    expect(selectedEdgeCardBlock).toContain('cardLine("Tx gap", edgeTxGap(edge) || "n/a")');
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
