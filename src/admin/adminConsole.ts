export function adminConsoleHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Admin Forensics Console</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #111315;
      color: #edf0f2;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: #111315; }
    button, input, select { font: inherit; }
    button { background: #223047; color: #edf0f2; border: 1px solid #40516b; border-radius: 6px; padding: 8px 10px; cursor: pointer; }
    button:hover { border-color: #7aa2f7; }
    .shell { min-height: 100vh; display: grid; grid-template-rows: auto 1fr; }
    .topbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 16px; border-bottom: 1px solid #2a2f34; background: #171a1d; }
    .topbar h1 { font-size: 18px; margin: 0; letter-spacing: 0; }
    .token { display: flex; gap: 8px; align-items: center; }
    .token input { width: 260px; background: #0d0f11; color: #edf0f2; border: 1px solid #343a40; border-radius: 6px; padding: 8px; }
    .content { display: grid; grid-template-columns: 340px minmax(0, 1fr) 380px; min-height: 0; }
    .jobs, .details { border-right: 1px solid #2a2f34; padding: 12px; overflow: auto; }
    .details { border-right: 0; border-left: 1px solid #2a2f34; }
    .filters { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; }
    .filters input, .filters select { min-width: 0; background: #0d0f11; color: #edf0f2; border: 1px solid #343a40; border-radius: 6px; padding: 8px; }
    .job { width: 100%; text-align: left; background: #171a1d; color: #edf0f2; border: 1px solid #2a2f34; border-radius: 6px; padding: 10px; margin-bottom: 8px; cursor: pointer; }
    .job:hover, .job.active { border-color: #7aa2f7; }
    .job strong { display: block; font-size: 13px; overflow-wrap: anywhere; }
    .job span { display: block; color: #a8b0b8; font-size: 12px; margin-top: 4px; }
    .canvas-wrap { position: relative; overflow: hidden; background: #0d0f11; }
    svg { width: 100%; height: 100%; min-height: calc(100vh - 54px); display: block; }
    .node { cursor: pointer; }
    .edge { stroke: #6f7780; stroke-width: 2; fill: none; opacity: .9; cursor: pointer; }
    .edge.risk { stroke: #ff6b6b; }
    .edge.review { stroke: #f6c177; }
    .edge.clean { stroke: #8bd5a6; }
    .panel h2 { margin: 0 0 10px; font-size: 16px; }
    .metric { border: 1px solid #2a2f34; border-radius: 6px; padding: 10px; margin-bottom: 8px; background: #171a1d; white-space: pre-wrap; overflow-wrap: anywhere; }
    .metric label { display: block; color: #a8b0b8; font-size: 12px; margin-bottom: 4px; }
    .metric div { overflow-wrap: anywhere; }
    .error { color: #ff6b6b; padding: 8px 0; }
    .empty { color: #a8b0b8; padding: 16px 0; }
    @media (max-width: 980px) {
      .content { grid-template-columns: 1fr; }
      .jobs, .details { border: 0; border-bottom: 1px solid #2a2f34; }
      .topbar { align-items: stretch; flex-direction: column; }
      .token input { width: 100%; }
    }
  </style>
</head>
<body>
  <main class="shell" data-admin-console>
    <header class="topbar">
      <h1>Admin Forensics Console</h1>
      <div class="token">
        <input id="token" type="password" placeholder="Bearer token" autocomplete="off">
        <button id="load" type="button">Load</button>
      </div>
    </header>
    <section class="content">
      <aside class="jobs">
        <div class="filters">
          <select id="status">
            <option value="">all statuses</option>
            <option value="completed">completed</option>
            <option value="partial">partial</option>
            <option value="failed">failed</option>
            <option value="running">running</option>
            <option value="queued">queued</option>
            <option value="cancelled">cancelled</option>
          </select>
          <select id="kind">
            <option value="">all kinds</option>
            <option value="where_is_money_check">where-is-money</option>
            <option value="address_deep_check">address deep</option>
            <option value="incoming_deposit_check">incoming deposit</option>
          </select>
          <input id="subject" placeholder="subject address">
          <button id="refresh" type="button">Refresh</button>
        </div>
        <div id="jobs"></div>
      </aside>
      <section class="canvas-wrap">
        <svg id="graph" role="img" aria-label="Forensics graph"></svg>
      </section>
      <aside class="details panel">
        <h2>Analysis</h2>
        <div id="details" class="empty">Select a completed job.</div>
      </aside>
    </section>
  </main>
  <script>
    const state = { token: "", jobs: [], graph: null, selected: null };
    const el = (id) => document.getElementById(id);
    const asArray = (value) => Array.isArray(value) ? value : [];
    const graphNodes = (graph) => asArray(graph?.nodes);
    const graphEdges = (graph) => asArray(graph?.edges);
    const graphSubject = (graph) => graph?.subject && typeof graph.subject === "object" ? graph.subject : { address: "unknown" };
    const graphSummary = (graph) => graph?.summary && typeof graph.summary === "object" ? graph.summary : { decision: "UNKNOWN", riskScore: null, riskLevel: null, coverageRatio: null };
    const graphPaths = (graph) => asArray(graph?.paths);
    const graphLimitations = (graph) => asArray(graph?.limitations);
    const graphWeights = (graph) => asArray(graph?.weights);
    const api = async (path) => {
      const response = await fetch(path, { headers: { Authorization: "Bearer " + state.token } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Request failed");
      return body;
    };
    const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
    const compactNumber = (value) => {
      if (!Number.isFinite(value)) return "n/a";
      if (Math.abs(value) >= 1000000) return (value / 1000000).toFixed(value >= 10000000 ? 1 : 2).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1") + "M";
      if (Math.abs(value) >= 1000) return (value / 1000).toFixed(value >= 10000 ? 1 : 2).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1") + "K";
      return value.toFixed(value >= 10 ? 2 : 4).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
    };
    const formatRatio = (value) => typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) + "%" : "n/a";
    const formatPercent = (value) => formatRatio(value);
    const formatPrecisePercent = (value) => typeof value === "number" && Number.isFinite(value)
      ? (value * 100).toFixed(value > 0 && value < 0.1 ? 1 : 0).replace(/\.0$/, "") + "%"
      : "n/a";
    const formatAmount = (value) => {
      if (typeof value !== "string" || !value) return "n/a";
      if (/^\d+$/.test(value)) return compactNumber(Number(value) / 1000000) + " USDT (" + value + ")";
      return value;
    };
    const raw = (value) => value === null || value === undefined || value === "" ? "n/a" : String(value);
    function drainEpisodeSummary(summary) {
      const episode = summary?.drainEpisode && typeof summary.drainEpisode === "object" ? summary.drainEpisode : null;
      if (!episode) return "none";
      return "total " + raw(episode.episodeOutgoingRaw) + "; bridge share " + formatRatio(episode.bridgeOutgoingShare);
    }
    function layerSummaryLine(summary) {
      const layer = summary?.layerSummary && typeof summary.layerSummary === "object" ? summary.layerSummary : null;
      if (!layer) return "none";
      const where = layer.whereIsMoney && typeof layer.whereIsMoney === "object" ? layer.whereIsMoney : null;
      const fast = layer.fastCheck && typeof layer.fastCheck === "object" ? layer.fastCheck : null;
      const parts = [];
      if (where?.checkedScope) parts.push("where: " + where.checkedScope);
      if (fast?.score !== null && fast?.score !== undefined) parts.push("fast: " + fast.score);
      return parts.join("; ") || "available";
    }
    function renderJobs() {
      const root = el("jobs");
      if (state.jobs.length === 0) {
        root.innerHTML = '<div class="empty">No jobs found.</div>';
        return;
      }
      root.innerHTML = state.jobs.map((job) => '<button type="button" class="job" data-job-id="' + escapeHtml(job.id) + '"><strong>' + escapeHtml(job.subjectAddress) + '</strong><span>' + escapeHtml(job.kind) + ' - ' + escapeHtml(job.status) + '</span><span>' + escapeHtml(job.completedAt || job.updatedAt || "") + '</span></button>').join("");
      root.querySelectorAll("[data-job-id]").forEach((button) => button.addEventListener("click", () => loadGraph(button.getAttribute("data-job-id"))));
    }
    async function loadJobs() {
      state.token = el("token").value.trim();
      const params = new URLSearchParams();
      if (el("status").value) params.set("status", el("status").value);
      if (el("kind").value) params.set("kind", el("kind").value);
      if (el("subject").value.trim()) params.set("subjectAddress", el("subject").value.trim());
      try {
        const suffix = params.toString();
        const body = await api("/admin/api/forensic-jobs" + (suffix ? "?" + suffix : ""));
        state.jobs = body.jobs || [];
        state.graph = null;
        state.selected = null;
        renderJobs();
        renderGraph();
        renderDetails();
      } catch (error) {
        el("jobs").innerHTML = '<div class="error">' + escapeHtml(error.message) + '</div>';
      }
    }
    async function loadGraph(jobId) {
      if (!jobId) return;
      try {
        const body = await api("/admin/api/forensic-jobs/" + encodeURIComponent(jobId) + "/graph");
        state.graph = body.graph;
        state.selected = null;
        renderGraph();
        renderDetails();
      } catch (error) {
        el("details").innerHTML = '<div class="error">' + escapeHtml(error.message) + '</div>';
      }
    }
    function layout(graph) {
      const width = 900;
      const height = 620;
      const sourceNodes = graphNodes(graph);
      const nodes = sourceNodes.map((node, index) => {
        const angle = sourceNodes.length <= 1 ? 0 : (Math.PI * 2 * index) / sourceNodes.length;
        const radius = node.kind === "subject" ? 0 : 230;
        return { ...node, x: width / 2 + Math.cos(angle) * radius, y: height / 2 + Math.sin(angle) * radius };
      });
      const byId = new Map(nodes.map((node) => [node.id, node]));
      return { width, height, nodes, byId };
    }
    function renderGraph() {
      const svg = el("graph");
      if (!state.graph) {
        svg.innerHTML = "";
        return;
      }
      const graph = state.graph;
      const placed = layout(graph);
      svg.setAttribute("viewBox", "0 0 " + placed.width + " " + placed.height);
      const edgeSvg = graphEdges(graph).map((edge) => {
        const from = placed.byId.get(edge.fromNodeId);
        const to = placed.byId.get(edge.toNodeId);
        if (!from || !to) return "";
        const cls = "edge " + escapeHtml(edge.verdict);
        return '<path class="' + cls + '" data-edge-id="' + escapeHtml(edge.id) + '" d="M ' + from.x + ' ' + from.y + ' L ' + to.x + ' ' + to.y + '"></path>';
      }).join("");
      const nodeSvg = placed.nodes.map((node) => {
        const color = node.kind === "subject" ? "#7aa2f7" : node.kind === "stop" ? "#f6c177" : node.riskLevel === "HIGH" || node.riskLevel === "CRITICAL" ? "#ff6b6b" : "#8bd5a6";
        return '<g class="node" data-node-id="' + escapeHtml(node.id) + '" transform="translate(' + node.x + ' ' + node.y + ')"><circle r="20" fill="#171a1d" stroke="' + color + '" stroke-width="3"></circle><text y="38" text-anchor="middle" fill="#edf0f2" font-size="12">' + escapeHtml(String(node.label || node.id).slice(0, 10)) + '</text></g>';
      }).join("");
      svg.innerHTML = edgeSvg + nodeSvg;
      svg.querySelectorAll("[data-node-id]").forEach((node) => node.addEventListener("click", () => {
        state.selected = { type: "node", id: node.getAttribute("data-node-id") };
        renderDetails();
      }));
      svg.querySelectorAll("[data-edge-id]").forEach((edge) => edge.addEventListener("click", () => {
        state.selected = { type: "edge", id: edge.getAttribute("data-edge-id") };
        renderDetails();
      }));
    }
    function renderDetails() {
      const root = el("details");
      const graph = state.graph;
      if (!graph) {
        root.innerHTML = '<div class="empty">Select a completed job.</div>';
        return;
      }
      if (state.selected && state.selected.type === "node") {
        const node = graphNodes(graph).find((item) => item.id === state.selected.id);
        root.innerHTML = detailBlock("Node", node, graph);
        return;
      }
      if (state.selected && state.selected.type === "edge") {
        const edge = graphEdges(graph).find((item) => item.id === state.selected.id);
        root.innerHTML = detailBlock("Edge", edge, graph);
        return;
      }
      const subject = graphSubject(graph);
      const summary = graphSummary(graph);
      const paths = graphPaths(graph);
      const limitations = graphLimitations(graph);
      root.innerHTML = [
        metric("Subject", subject.address || "unknown"),
        metric("Decision", summary.decision || "UNKNOWN"),
        metric("Risk", (summary.riskScore ?? "n/a") + " / " + (summary.riskLevel ?? "unknown")),
        metric("Coverage", summary.coverageRatio ?? "n/a"),
        metric("Checked scope", summary.checkedScope || "n/a"),
        metric("Anchor coverage", formatRatio(summary.anchorCoverageRatio)),
        metric("Episode coverage", formatRatio(summary.episodeCoverageRatio)),
        metric("Drain episode", drainEpisodeSummary(summary)),
        metric("Layer summary", layerSummaryLine(summary)),
        metric("Paths", paths.length),
        metric("Limitations", limitations.map((item) => item.label).filter(Boolean).join(", ") || "none")
      ].join("");
    }
    function metric(label, value) {
      return '<div class="metric"><label>' + escapeHtml(label) + '</label><div>' + escapeHtml(value) + '</div></div>';
    }
    function detailRow(label, value) {
      return metric(label, value);
    }
    function detailRows(rows) {
      return rows.map((row) => detailRow(row[0], row[1])).join("");
    }
    function weightDetailValue(weight) {
      const metadata = weight.metadata && typeof weight.metadata === "object" ? weight.metadata : {};
      const parts = [weight.value + " / " + weight.source];
      const affected = metadata.affectedAmountRaw;
      const target = metadata.targetAmountRaw;
      if (affected || target) parts.push("affected " + formatAmount(affected) + " / target " + formatAmount(target));
      if (typeof metadata.rawShare === "number" || typeof metadata.effectiveShare === "number") {
        parts.push("share " + formatPrecisePercent(metadata.rawShare) + " raw / " + formatPrecisePercent(metadata.effectiveShare) + " effective");
      }
      if (metadata.shareCap !== undefined || metadata.shareFloor !== undefined) {
        parts.push("cap " + raw(metadata.shareCap) + " / floor " + raw(metadata.shareFloor));
      }
      if (metadata.finalContribution !== undefined || metadata.sourceSeverity !== undefined) {
        parts.push("contribution " + raw(metadata.finalContribution) + " from severity " + raw(metadata.sourceSeverity));
      }
      if (metadata.proofLevel || metadata.riskBand) {
        parts.push("proof " + raw(metadata.proofLevel) + " / band " + raw(metadata.riskBand));
      }
      return parts.join("\\n");
    }
    function detailBlock(title, value, graph) {
      if (!value) return '<div class="empty">No detail found.</div>';
      const selectedNode = title === "Node" ? value : null;
      const selectedEdge = title === "Edge" ? value : null;
      const selectedPath = selectedEdge
        ? graphPaths(graph).find((path) => asArray(path.edgeIds).includes(selectedEdge.id))
        : selectedNode
          ? graphPaths(graph).find((path) => asArray(path.nodeIds).includes(selectedNode.id))
          : null;
      const relatedWeights = graphWeights(graph).filter((weight) =>
        weight.nodeId === selectedNode?.id || weight.edgeId === selectedEdge?.id || weight.pathId === selectedPath?.id
      );
      const metadata = value.metadata && typeof value.metadata === "object" ? value.metadata : {};
      const rows = title === "Edge"
        ? [
            ["From", value.fromNodeId],
            ["To", value.toNodeId],
            ["Type", value.type],
            ["Tx", raw(value.txHash)],
            ["Original", formatAmount(metadata.originalAmountRaw ?? value.amountRaw)],
            ["Used", formatAmount(metadata.usedAmountRaw ?? value.amountRaw)],
            ["Coverage", value.amountShare === null ? "n/a" : formatPercent(value.amountShare)],
            ["Role", String(metadata.amountRole ?? "transfer")],
            ["Verdict", value.verdict]
          ]
        : [
            ["Address", raw(value.address)],
            ["Kind", value.kind],
            ["Risk", (value.weight ?? "n/a") + " / " + (value.riskLevel ?? "unknown")],
            ["Confidence", value.confidence ?? "n/a"]
          ];
      const weightRows = relatedWeights.map((weight) => [weight.label, weightDetailValue(weight)]);
      return [
        '<h2>' + escapeHtml(title) + '</h2>',
        detailRows(rows),
        weightRows.length > 0 ? '<h2>Weights</h2>' + detailRows(weightRows) : "",
        '<h2>JSON</h2><pre class="metric">' + escapeHtml(JSON.stringify(value, null, 2)) + '</pre>'
      ].join("");
    }
    el("load").addEventListener("click", loadJobs);
    el("refresh").addEventListener("click", loadJobs);
  </script>
</body>
</html>`;
}
