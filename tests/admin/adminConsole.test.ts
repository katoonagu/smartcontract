import { describe, expect, it } from "vitest";
import { adminConsoleHtml } from "../../src/admin/adminConsole";

describe("adminConsoleHtml", () => {
  it("renders the graph-first investigation shell", () => {
    const html = adminConsoleHtml();

    expect(html).toContain('data-admin-console');
    expect(html).toContain('data-graph-first-shell');
    expect(html).toContain('data-overlay="case-brief"');
    expect(html).toContain('data-overlay="jobs"');
    expect(html).toContain('id="toggleCaseBrief"');
    expect(html).toContain('id="toggleJobs"');
    expect(html).toContain('id="activityTimeline"');
    expect(html).toContain('id="toggleTransfers"');
    expect(html).toContain('data-transfer-drawer');
    expect(html).toContain('id="toolFitGraph"');
    expect(html).toContain('id="toolToggleLabels"');
    expect(html).toContain('id="toolResetView"');
    expect(html).toContain('id="flowMode"');
    expect(html).toContain('id="servicesMode"');
    expect(html).toContain('id="groupSmallWallets"');
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
    expect(html).toContain("function edgePassesFlowFilter");
    expect(html).toContain("function nodeIsServiceLike");
    expect(html).toContain("function edgePassesServiceFilter");
    expect(html).toContain("function filteredGraphEdges");
    expect(html).toContain("function filteredTransferEdges");
    expect(html).toContain('metadata?.direction === "inbound"');
    expect(html).toContain('metadata?.direction === "outbound"');
    expect(html).toContain('state.flowMode === "incoming"');
    expect(html).toContain('state.flowMode === "outgoing"');
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

  it("contains deterministic graph-first cluster layout helpers", () => {
    const html = adminConsoleHtml();

    expect(html).toContain("function graphFirstLayout");
    expect(html).toContain("function nodeLayoutSide");
    expect(html).toContain("function arrangeCluster");
    expect(html).toContain("incomingNodes");
    expect(html).toContain("outgoingNodes");
    expect(html).toContain("serviceNodes");
    expect(html).toContain("subjectX");
    expect(html).toContain("subjectY");
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
});
