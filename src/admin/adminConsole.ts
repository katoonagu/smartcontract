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
      font-family: Geist, "Segoe UI", ui-sans-serif, system-ui, -apple-system, sans-serif;
      --bg: #101214;
      --panel: #15191d;
      --panel-2: #0c0f12;
      --line: #2a3036;
      --line-strong: #3a434d;
      --text: #edf1f4;
      --muted: #9da8b2;
      --accent: #7aa2f7;
      --good: #8bd5a6;
      --warn: #f6c177;
      --bad: #ff6b6b;
      --bridge: #5bc7d8;
      --contract: #b59cff;
      --cex: #f7d774;
      --service: #7dd3c7;
      --bundle: #d7b2ff;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body { margin: 0; background: var(--bg); color: var(--text); overflow: hidden; }
    button, input, select { font: inherit; }
    button, select, input {
      background: var(--panel-2);
      color: var(--text);
      border: 1px solid var(--line-strong);
      border-radius: 6px;
    }
    button { padding: 8px 10px; cursor: pointer; transition: border-color .15s ease, background .15s ease, transform .08s ease; }
    button:hover { border-color: var(--accent); }
    button:active { transform: translateY(1px); }
    button.active { background: #23314a; border-color: var(--accent); }
    input, select { min-width: 0; padding: 8px 9px; }
    .shell { height: 100dvh; display: grid; grid-template-rows: auto 1fr; }
    .topbar {
      display: grid;
      grid-template-columns: minmax(220px, 1fr) auto;
      gap: 16px;
      align-items: center;
      min-height: 56px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--line);
      background: #171b1f;
    }
    .brand { display: flex; align-items: center; gap: 14px; min-width: 0; }
    .brand h1 { margin: 0; font-size: 17px; font-weight: 700; letter-spacing: 0; }
    .stats { display: flex; flex-wrap: wrap; gap: 6px; color: var(--muted); font-size: 12px; }
    .chip { border: 1px solid var(--line); border-radius: 999px; padding: 3px 8px; background: #111519; white-space: nowrap; }
    .token { display: flex; gap: 8px; align-items: center; }
    .token input { width: 280px; }
    .session-pill { color: var(--good); border: 1px solid rgba(139, 213, 166, .35); border-radius: 999px; padding: 5px 9px; font-size: 12px; white-space: nowrap; }
    .content {
      min-height: 0;
      display: grid;
      grid-template-columns: 390px minmax(420px, 1fr) 430px;
    }
    .jobs, .details {
      min-height: 0;
      overflow: auto;
      background: var(--panel);
    }
    .jobs { border-right: 1px solid var(--line); }
    .details { border-left: 1px solid var(--line); }
    .section-head {
      position: sticky;
      top: 0;
      z-index: 1;
      padding: 12px;
      border-bottom: 1px solid var(--line);
      background: rgba(21, 25, 29, .96);
    }
    .filters { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .filters .wide { grid-column: 1 / -1; }
    .toolbar-row { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
    .toolbar-row button { flex: 1; }
    .job-list { padding: 10px; }
    .job {
      width: 100%;
      display: grid;
      gap: 6px;
      text-align: left;
      background: #12161a;
      color: var(--text);
      border: 1px solid var(--line);
      border-radius: 7px;
      padding: 10px;
      margin-bottom: 8px;
      cursor: pointer;
    }
    .job:hover, .job.active { border-color: var(--accent); background: #161d26; }
    .job-title { display: flex; justify-content: space-between; gap: 10px; align-items: center; }
    .job strong { min-width: 0; font-size: 13px; overflow-wrap: anywhere; }
    .job span { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
    .status { font-size: 11px; border: 1px solid var(--line-strong); border-radius: 999px; padding: 2px 7px; text-transform: uppercase; }
    .status.completed, .status.partial { color: var(--good); border-color: rgba(139, 213, 166, .45); }
    .status.failed { color: var(--bad); border-color: rgba(255, 107, 107, .45); }
    .status.running, .status.queued { color: var(--warn); border-color: rgba(246, 193, 119, .45); }
    .workspace { min-width: 0; min-height: 0; display: grid; grid-template-rows: minmax(0, 1fr) 260px; }
    .canvas-wrap { position: relative; min-width: 0; overflow: hidden; background: #0b0e11; }
    .canvas-toolbar {
      position: absolute;
      top: 12px;
      left: 12px;
      right: 12px;
      z-index: 2;
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
      pointer-events: none;
    }
    .canvas-toolbar > * { pointer-events: auto; }
    .canvas-toolbar input { width: 220px; }
    .canvas-toolbar select { width: 130px; }
    .canvas-toolbar #amountMode { width: 165px; }
    .icon-btn { min-width: 36px; padding: 8px 9px; }
    .graph-meta { margin-left: auto; display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
    .transfer-panel { border-top: 1px solid var(--line); background: #11161b; overflow: hidden; }
    .tabbar { display: flex; gap: 6px; padding: 8px; border-bottom: 1px solid var(--line); }
    .tabbar button { padding: 7px 10px; }
    .transfer-table { height: calc(100% - 46px); overflow: auto; }
    .transfer-row, .transfer-head { min-width: 980px; width: 100%; display: grid; grid-template-columns: 150px 86px 130px 1fr 1fr 140px 90px 90px; gap: 8px; align-items: center; padding: 7px 10px; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; font-size: 12px; text-align: left; }
    .transfer-row.boundary, .transfer-head.boundary { grid-template-columns: 110px 1.2fr 130px 140px 150px 130px 1.5fr; }
    .transfer-row { cursor: pointer; background: transparent; }
    .transfer-row:hover { background: #17202a; }
    .transfer-head { color: var(--muted); text-transform: uppercase; font-size: 11px; position: sticky; top: 0; background: #11161b; z-index: 1; }
    .transfer-row span, .transfer-head span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .link { color: #8bb9ff; text-decoration: none; }
    .link:hover { text-decoration: underline; }
    svg { width: 100%; height: 100%; display: block; cursor: grab; }
    svg.dragging { cursor: grabbing; }
    .grid-line { stroke: #151a1f; stroke-width: 1; }
    .edge {
      stroke: #87919b;
      stroke-width: 2.6;
      fill: none;
      opacity: .9;
      cursor: pointer;
      vector-effect: non-scaling-stroke;
    }
    .edge.risk, .edge.decline { stroke: var(--bad); }
    .edge.review { stroke: var(--warn); }
    .edge.clean, .edge.acceptable { stroke: var(--good); }
    .edge.dim, .node.dim { opacity: .18; }
    .edge.selected { stroke-width: 5; opacity: 1; }
    .edge-group { cursor: pointer; }
    .amount-pill rect { fill: rgba(11, 14, 17, .94); stroke: rgba(217, 230, 242, .28); stroke-width: 1; rx: 5; vector-effect: non-scaling-stroke; }
    .amount-pill text { fill: #edf4fb; font-size: 10.5px; font-weight: 650; paint-order: stroke; stroke: rgba(11, 14, 17, .65); stroke-width: 1.8px; stroke-linejoin: round; }
    .stop-badge rect { fill: rgba(246, 193, 119, .95); stroke: #0b0e11; stroke-width: 1.5; rx: 4; vector-effect: non-scaling-stroke; }
    .stop-badge text { fill: #0b0e11; font-size: 9.5px; font-weight: 750; letter-spacing: 0; stroke: none; }
    .node { cursor: pointer; }
    .node circle { fill: #151a1f; stroke-width: 3; vector-effect: non-scaling-stroke; }
    .node.selected circle { stroke-width: 5; }
    .node text { font-size: 11.5px; font-weight: 650; fill: var(--text); paint-order: stroke; stroke: #0b0e11; stroke-width: 2px; stroke-linejoin: round; }
    .node .stop-badge text { paint-order: normal; stroke: transparent; stroke-width: 0; fill: #0b0e11; }
    .node-label-hidden text { display: none; }
    .details .section-head { display: grid; gap: 8px; }
    .details h2 { margin: 0; font-size: 15px; }
    .details-body { padding: 12px; }
    .metric-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .metric {
      border: 1px solid var(--line);
      border-radius: 7px;
      padding: 9px;
      background: #12161a;
      min-width: 0;
    }
    .metric.wide { grid-column: 1 / -1; }
    .metric label { display: block; color: var(--muted); font-size: 11px; margin-bottom: 4px; text-transform: uppercase; letter-spacing: .02em; }
    .metric div { overflow-wrap: anywhere; font-size: 13px; }
    .type-chip { display: inline-flex; align-items: center; min-height: 22px; border: 1px solid var(--line-strong); border-radius: 999px; padding: 2px 8px; font-size: 11px; font-weight: 700; color: var(--text); background: #10151b; }
    .type-chip.subject { color: #a8c3ff; border-color: rgba(122, 162, 247, .55); }
    .type-chip.wallet { color: #a8e6bd; border-color: rgba(139, 213, 166, .5); }
    .type-chip.boundary { color: #ffd29a; border-color: rgba(246, 193, 119, .65); }
    .type-chip.service { color: var(--service); border-color: rgba(125, 211, 199, .55); }
    .type-chip.cex { color: var(--cex); border-color: rgba(247, 215, 116, .58); }
    .type-chip.bridge { color: var(--bridge); border-color: rgba(91, 199, 216, .58); }
    .type-chip.contract { color: var(--contract); border-color: rgba(181, 156, 255, .58); }
    .type-chip.bundle { color: var(--bundle); border-color: rgba(215, 178, 255, .58); }
    .list-lines { display: grid; gap: 6px; }
    .list-lines div { font-size: 12px; color: var(--text); }
    .tx-lines { display: grid; gap: 8px; }
    .tx-line { display: grid; gap: 4px; padding-top: 8px; border-top: 1px solid var(--line); }
    .tx-line:first-child { padding-top: 0; border-top: 0; }
    .tx-main, .tx-meta { display: flex; justify-content: space-between; gap: 10px; min-width: 0; }
    .tx-main strong { font-size: 12px; overflow-wrap: anywhere; }
    .tx-main span, .tx-route, .tx-meta { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
    .tx-route { min-width: 0; }
    .muted { color: var(--muted); }
    .json-block { white-space: pre-wrap; overflow: auto; max-height: 380px; font-family: "JetBrains Mono", Consolas, monospace; font-size: 12px; line-height: 1.45; }
    details.metric summary { cursor: pointer; color: var(--muted); }
    .error { color: var(--bad); padding: 10px; }
    .empty { color: var(--muted); padding: 16px 10px; }
    .hint { color: var(--muted); font-size: 12px; line-height: 1.45; }
    @media (max-width: 1180px) {
      body { overflow: auto; }
      .shell { height: auto; min-height: 100dvh; }
      .content { grid-template-columns: 1fr; }
      .jobs, .details { border: 0; border-bottom: 1px solid var(--line); max-height: 52dvh; }
      .workspace { min-height: 90dvh; grid-template-rows: minmax(70dvh, 1fr) 260px; }
      .canvas-wrap { min-height: 70dvh; }
      .topbar { grid-template-columns: 1fr; }
      .token input { width: 100%; }
    }
  </style>
</head>
<body>
  <main class="shell" data-admin-console>
    <header class="topbar">
      <div class="brand">
        <h1>Admin Forensics Console</h1>
        <div class="stats" id="jobStats"></div>
      </div>
      <div class="token">
        <input id="token" type="password" placeholder="Bearer token" autocomplete="off">
        <span id="sessionState" class="session-pill">local session</span>
        <button id="load" type="button">Load</button>
      </div>
    </header>
    <section class="content">
      <aside class="jobs">
        <div class="section-head">
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
            <input id="subject" class="wide" placeholder="subject address">
            <select id="limit">
              <option value="20">20 latest</option>
              <option value="50" selected>50 latest</option>
              <option value="100">100 latest</option>
            </select>
            <button id="refresh" type="button">Refresh</button>
          </div>
          <div class="toolbar-row">
            <button id="autoRefresh" type="button">Auto off</button>
            <button id="clearFilters" type="button">Clear</button>
          </div>
        </div>
        <div id="jobs" class="job-list"></div>
      </aside>
      <section class="workspace">
        <section class="canvas-wrap">
          <div class="canvas-toolbar">
            <button id="zoomOut" class="icon-btn" type="button" title="Zoom out">-</button>
            <button id="zoomIn" class="icon-btn" type="button" title="Zoom in">+</button>
            <button id="fitGraph" type="button">Fit</button>
            <button id="clearSelection" type="button">Clear selection</button>
            <select id="layoutMode">
              <option value="layers">layers</option>
            </select>
            <select id="amountMode">
              <option value="important">Amounts: important</option>
              <option value="all">Amounts: all</option>
              <option value="off">Amounts: off</option>
            </select>
            <button id="toggleLabels" type="button">Labels on</button>
            <input id="graphSearch" placeholder="find node / tx / label">
            <div id="graphStats" class="graph-meta"></div>
          </div>
          <svg id="graph" role="img" aria-label="Forensics graph"></svg>
        </section>
        <section class="transfer-panel" data-transfer-tabs>
          <div class="tabbar">
            <button id="tabAll" class="active" type="button">All transfers</button>
            <button id="tabSelected" type="button">Selected path</button>
            <button id="tabStops" type="button">Boundary stops</button>
          </div>
          <div id="transferTable" class="transfer-table"></div>
        </section>
      </section>
      <aside class="details">
        <div class="section-head">
          <h2>Analysis</h2>
          <div class="hint" id="selectionHint">Select a completed or partial job.</div>
        </div>
        <div id="details" class="details-body empty">Select a completed or partial job.</div>
      </aside>
    </section>
  </main>
  <script>
    localStorage.removeItem("adminForensicsLayout");
    const defaultLocalToken = "local-admin-token";
    const state = {
      token: localStorage.getItem("adminForensicsToken") || defaultLocalToken,
      jobs: [],
      graph: null,
      selected: null,
      activeJobId: null,
      transform: { x: 0, y: 0, scale: 1 },
      layoutMode: "layers",
      amountMode: localStorage.getItem("adminForensicsAmountMode") || "important",
      labels: localStorage.getItem("adminForensicsLabels") !== "off",
      transferTab: "all",
      autoTimer: null,
      graphSearch: ""
    };
    const el = (id) => document.getElementById(id);
    const asArray = (value) => Array.isArray(value) ? value : [];
    const graphNodes = (graph) => asArray(graph?.nodes);
    const graphEdges = (graph) => asArray(graph?.edges);
    const graphPaths = (graph) => asArray(graph?.paths);
    const graphWeights = (graph) => asArray(graph?.weights);
    const graphEvidence = (graph) => asArray(graph?.evidence);
    const graphLimitations = (graph) => asArray(graph?.limitations);
    const graphSubject = (graph) => graph?.subject && typeof graph.subject === "object" ? graph.subject : { address: "unknown" };
    const graphSummary = (graph) => graph?.summary && typeof graph.summary === "object" ? graph.summary : { decision: "UNKNOWN", riskScore: null, riskLevel: null, coverageRatio: null };
    const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
    const short = (value, size = 6) => {
      const text = String(value ?? "");
      return text.length > size * 2 + 3 ? text.slice(0, size) + "..." + text.slice(-size) : text;
    };
    const iso = (value) => value ? String(value).replace(".000Z", "Z") : "";
    const classifyStatus = (value) => "status " + escapeHtml(String(value || "unknown").toLowerCase());
    const explorerLink = (url, label) => url ? '<a class="link" href="' + escapeHtml(url) + '" target="_blank" rel="noreferrer">' + escapeHtml(label) + '</a>' : escapeHtml(label);
    const transferEdges = () => graphEdges(state.graph);
    const tronscanAddressUrl = (address) => address && String(address).startsWith("T") ? "https://tronscan.org/#/address/" + encodeURIComponent(address) : "";
    const tronscanTxUrl = (txHash) => txHash ? "https://tronscan.org/#/transaction/" + encodeURIComponent(txHash) : "";
    function nodeById(nodeId) {
      return graphNodes(state.graph).find((node) => node.id === nodeId) || null;
    }
    function nodeAddress(node) {
      if (!node) return "";
      if (node.address) return node.address;
      return String(node.id || "").startsWith("addr:") ? String(node.id).slice(5) : "";
    }
    function nodeTronScanUrl(node) {
      return node?.tronScanUrl || tronscanAddressUrl(nodeAddress(node));
    }
    function edgeFromAddress(edge) {
      return edge?.fromAddress || nodeAddress(nodeById(edge?.fromNodeId)) || edge?.fromNodeId || "";
    }
    function edgeToAddress(edge) {
      return edge?.toAddress || nodeAddress(nodeById(edge?.toNodeId)) || edge?.toNodeId || "";
    }
    function edgeFromTronScanUrl(edge) {
      return edge?.fromTronScanUrl || tronscanAddressUrl(edgeFromAddress(edge));
    }
    function edgeToTronScanUrl(edge) {
      return edge?.toTronScanUrl || tronscanAddressUrl(edgeToAddress(edge));
    }
    function edgeTxTronScanUrl(edge) {
      return edge?.txTronScanUrl || tronscanTxUrl(edge?.txHash);
    }
    const api = async (path) => {
      const response = await fetch(path, { headers: { Authorization: "Bearer " + state.token } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Request failed");
      return body;
    };
    function setStatus(message) {
      el("selectionHint").textContent = message;
    }
    function requesterText(job) {
      return job.requesterUsername ? "@" + job.requesterUsername + " / " + (job.requestedBy || "no id") : job.requestedBy ? "tg:" + job.requestedBy : "system";
    }
    function selectedEdgeIds() {
      if (!state.selected) return new Set();
      if (state.selected.type === "edge") return new Set([state.selected.id]);
      if (state.selected.type === "node") {
        return new Set(graphEdges(state.graph).filter((edge) => edge.fromNodeId === state.selected.id || edge.toNodeId === state.selected.id).map((edge) => edge.id));
      }
      return new Set();
    }
    function setTransferTab(tab) {
      state.transferTab = tab;
      el("tabAll").classList.toggle("active", tab === "all");
      el("tabSelected").classList.toggle("active", tab === "selected");
      el("tabStops").classList.toggle("active", tab === "stops");
      renderTransferTabs();
    }
    function renderStats() {
      const counts = state.jobs.reduce((acc, job) => {
        acc.total += 1;
        acc[job.status] = (acc[job.status] || 0) + 1;
        return acc;
      }, { total: 0 });
      el("jobStats").innerHTML = [
        ["total", counts.total],
        ["completed", counts.completed || 0],
        ["partial", counts.partial || 0],
        ["failed", counts.failed || 0]
      ].map(([label, value]) => '<span class="chip">' + label + ': ' + value + '</span>').join("");
    }
    function renderJobs() {
      const root = el("jobs");
      renderStats();
      if (state.jobs.length === 0) {
        root.innerHTML = '<div class="empty">No jobs found. Check filters or run wallet checks first.</div>';
        return;
      }
      root.innerHTML = state.jobs.map((job) => {
        const active = job.id === state.activeJobId ? " active" : "";
        const requester = job.requesterUsername ? "@" + job.requesterUsername : job.requestedBy ? "tg:" + job.requestedBy : "system";
        return '<button type="button" class="job' + active + '" data-job-id="' + escapeHtml(job.id) + '">' +
          '<div class="job-title"><strong>' + escapeHtml(short(job.subjectAddress, 10)) + '</strong><span class="' + classifyStatus(job.status) + '">' + escapeHtml(job.status) + '</span></div>' +
          '<span>' + escapeHtml(job.kind) + '</span>' +
          '<span>requested by ' + escapeHtml(requester) + '</span>' +
          '<span>' + escapeHtml(iso(job.completedAt || job.updatedAt || job.createdAt)) + '</span>' +
          '<span>' + escapeHtml(job.id) + '</span>' +
          '</button>';
      }).join("");
      root.querySelectorAll("[data-job-id]").forEach((button) => button.addEventListener("click", () => loadGraph(button.getAttribute("data-job-id"))));
    }
    async function loadJobs() {
      state.token = el("token").value.trim();
      localStorage.setItem("adminForensicsToken", state.token);
      el("sessionState").textContent = state.token ? "session active" : "token missing";
      const params = new URLSearchParams();
      if (el("status").value) params.set("status", el("status").value);
      if (el("kind").value) params.set("kind", el("kind").value);
      if (el("subject").value.trim()) params.set("subjectAddress", el("subject").value.trim());
      params.set("limit", el("limit").value || "50");
      try {
        setStatus("Loading jobs...");
        const body = await api("/admin/api/forensic-jobs?" + params.toString());
        state.jobs = asArray(body.jobs);
        if (!state.jobs.some((job) => job.id === state.activeJobId)) {
          state.graph = null;
          state.selected = null;
          state.activeJobId = null;
        }
        renderJobs();
        renderGraph();
        renderDetails();
        renderTransferTabs();
        setStatus(state.jobs.length + " jobs loaded.");
      } catch (error) {
        el("jobs").innerHTML = '<div class="error">' + escapeHtml(error.message) + '<div class="hint">The local default token is already filled. If ADMIN_DASHBOARD_TOKEN differs, replace it once and press Load.</div></div>';
        setStatus("Job list failed.");
      }
    }
    async function loadGraph(jobId) {
      if (!jobId) return;
      try {
        setStatus("Loading graph...");
        const body = await api("/admin/api/forensic-jobs/" + encodeURIComponent(jobId) + "/graph");
        state.graph = body.graph;
        state.selected = null;
        state.activeJobId = jobId;
        state.transform = { x: 0, y: 0, scale: 1 };
        renderJobs();
        renderGraph();
        fitGraph();
        renderDetails();
        renderTransferTabs();
        setStatus("Graph loaded. Wheel to zoom, drag to pan.");
      } catch (error) {
        el("details").innerHTML = '<div class="error">' + escapeHtml(error.message) + '</div>';
        setStatus("Graph unavailable for this job.");
      }
    }
    function layout(graph) {
      const width = 1400;
      const height = 900;
      const sourceNodes = graphNodes(graph);
      const sourceEdges = graphEdges(graph);
      if (sourceNodes.length === 0) return { width, height, nodes: [], byId: new Map() };
      const subjectId = sourceNodes.find((node) => node.kind === "subject")?.id || sourceNodes[0]?.id;
      const adjacency = new Map(sourceNodes.map((node) => [node.id, []]));
      sourceEdges.forEach((edge) => {
        adjacency.get(edge.fromNodeId)?.push(edge.toNodeId);
        adjacency.get(edge.toNodeId)?.push(edge.fromNodeId);
      });
      const level = new Map([[subjectId, 0]]);
      const queue = [subjectId];
      for (let index = 0; index < queue.length; index += 1) {
        const current = queue[index];
        for (const next of adjacency.get(current) || []) {
          if (!level.has(next)) {
            level.set(next, (level.get(current) || 0) + 1);
            queue.push(next);
          }
        }
      }
      sourceNodes.forEach((node) => { if (!level.has(node.id)) level.set(node.id, 3); });
      const groups = new Map();
      sourceNodes.forEach((node) => {
        const value = level.get(node.id) || 0;
        if (!groups.has(value)) groups.set(value, []);
        groups.get(value).push(node);
      });
      const sortedLevels = Array.from(groups.keys()).sort((a, b) => a - b);
      const colGap = Math.max(260, width / Math.max(4, sortedLevels.length + 1));
      const nodes = [];
      sortedLevels.forEach((levelValue, column) => {
        const group = groups.get(levelValue);
        const rowGap = Math.max(90, height / (group.length + 1));
        group.forEach((node, row) => {
          nodes.push({ ...node, x: 120 + column * colGap, y: rowGap * (row + 1) });
        });
      });
      const byId = new Map(nodes.map((node) => [node.id, node]));
      return { width, height, nodes, byId };
    }
    function isSelectedConnected(id) {
      if (!state.selected) return true;
      if (state.selected.type === "node") {
        if (state.selected.id === id) return true;
        return graphEdges(state.graph).some((edge) => (edge.fromNodeId === id && edge.toNodeId === state.selected.id) || (edge.toNodeId === id && edge.fromNodeId === state.selected.id));
      }
      if (state.selected.type === "edge") {
        const edge = graphEdges(state.graph).find((item) => item.id === state.selected.id);
        return edge ? edge.fromNodeId === id || edge.toNodeId === id : true;
      }
      return true;
    }
    function matchesSearch(value) {
      if (!state.graphSearch) return true;
      return JSON.stringify(value).toLowerCase().includes(state.graphSearch);
    }
    function nodeMarker(node) {
      return String([
        node?.kind,
        node?.metadata?.category,
        node?.metadata?.serviceCategory,
        node?.metadata?.serviceType,
        node?.metadata?.sourceExposureKind,
        node?.metadata?.exposureSourceKey,
        node?.metadata?.rootSourceType,
        node?.metadata?.source,
        node?.metadata?.identity,
        node?.metadata?.stopReasons,
        node?.label
      ].filter(Boolean).join(" ")).toLowerCase();
    }
    function hasStopReason(node) {
      return Array.isArray(node?.metadata?.stopReasons) && node.metadata.stopReasons.length > 0;
    }
    function nodeDisplayKind(node) {
      if (!node) return "wallet";
      if (node.displayKind) return node.displayKind;
      const marker = nodeMarker(node);
      if (node.kind === "subject") return "subject_wallet";
      if (node.kind === "bundle") return "funding_bundle";
      if (node.kind === "stop") return "trace_stop";
      if (hasStopReason(node)) return "service_boundary";
      if (marker.includes("bridge")) return "bridge";
      if (marker.includes("cex") || marker.includes("exchange")) return "cex";
      if (marker.includes("adapter")) return "contract_adapter";
      if (marker.includes("router")) return "contract_router";
      if (marker.includes("dex")) return "dex_contract";
      if (marker.includes("contract")) return "smart_contract";
      if (node.kind === "service") return "service_boundary";
      if (node.kind === "contract") return "smart_contract";
      return "wallet";
    }
    function nodeDisplayLabel(node) {
      return node?.displayLabel ||
        node?.metadata?.identity ||
        node?.metadata?.exposureSourceLabel ||
        node?.metadata?.label ||
        node?.label ||
        node?.address ||
        node?.id ||
        "unknown";
    }
    function nodeColor(node) {
      const kind = nodeDisplayKind(node);
      if (kind === "subject_wallet") return "var(--accent)";
      if (node.riskLevel === "HIGH" || node.riskLevel === "CRITICAL") return "var(--bad)";
      if (kind === "trace_stop" || kind === "service_boundary") return "var(--warn)";
      if (kind === "bridge") return "var(--bridge)";
      if (kind === "smart_contract" || kind === "contract_adapter" || kind === "contract_router" || kind === "dex_contract") return "var(--contract)";
      if (kind === "cex") return "var(--cex)";
      if (kind === "funding_bundle") return "var(--bundle)";
      if (node.riskLevel === "MEDIUM") return "var(--warn)";
      return "var(--good)";
    }
    function nodeRadius(node) {
      const kind = nodeDisplayKind(node);
      if (kind === "subject_wallet") return 24;
      if (kind === "bridge" || kind === "cex" || kind === "smart_contract" || kind === "contract_adapter" || kind === "contract_router" || kind === "dex_contract") return 21;
      if (kind === "funding_bundle") return 22;
      return kind === "trace_stop" ? 18 : 20;
    }
    function stopBadgeReason(node) {
      const reasons = Array.isArray(node.metadata?.stopReasons) ? node.metadata.stopReasons : [];
      return reasons[0] || node.metadata?.lastStopReason || "";
    }
    function stopBadgeLabel(reason) {
      const labels = {
        weak_amount_or_time_continuity: "Weak continuity",
        no_previous_transfer: "No previous transfer",
        incoming_seen_but_below_continuity: "Previous transfers not matching",
        no_incoming_transfers_seen: "No previous incoming",
        incoming_history_not_fetched: "History not fully fetched",
        data_budget_exhausted: "Data budget",
        unlabeled_service_boundary: "Service boundary",
        decline_boundary_reached: "Decline boundary",
        risky_label_reached: "Risky label",
        allowlist_cex_reached: "Allowlisted CEX"
      };
      return labels[reason] || String(reason || "").replace(/_/g, " ");
    }
    function stopCategoryLabel(category) {
      const labels = {
        data_quality: "Data quality",
        continuity: "Continuity",
        terminal_boundary: "Terminal boundary",
        service_boundary: "Service boundary",
        unknown: "Unknown"
      };
      return labels[category] || labels.unknown;
    }
    function stopReasonTitle(reason) {
      return stopBadgeLabel(reason);
    }
    function stopNodeTitle(node) {
      return node?.metadata?.stopTitle || stopReasonTitle(node?.metadata?.reason || node?.label) || "Unknown";
    }
    function stopNodeMeaning(node) {
      return node?.metadata?.stopMeaning || "The trace stopped before reaching a complete provenance source.";
    }
    function stopNodeCategory(node) {
      return node?.metadata?.stopCategory || "unknown";
    }
    function stopScoreLabel(node) {
      const labels = {
        data_quality: "Path uncertainty penalty"
      };
      return node?.metadata?.scoreLabel || labels[stopNodeCategory(node)] || "Path contribution";
    }
    function stopScoreMeaning(node) {
      const meanings = {
        data_quality: "This is not wallet risk. It is a conservative path contribution because source provenance was not proven."
      };
      return node?.metadata?.scoreMeaning || meanings[stopNodeCategory(node)] || "This contribution belongs to the stopped path, not to a wallet by itself.";
    }
    function stopBadge(node, radius) {
      const reason = stopBadgeReason(node);
      if (!reason) return "";
      const label = stopBadgeLabel(reason);
      const width = Math.min(156, Math.max(80, String(label).length * 5.8 + 16));
      const x = radius - 5;
      const y = -radius - 20;
      return '<g class="stop-badge" transform="translate(' + x + ' ' + y + ')">' +
        '<title>Trace stopped: ' + escapeHtml(reason) + '</title>' +
        '<rect width="' + width + '" height="18"></rect>' +
        '<text x="8" y="12.5">' + escapeHtml(label) + '</text>' +
        '</g>';
    }
    function amountPill(label, x, y) {
      if (!label) return "";
      const width = Math.min(150, Math.max(70, String(label).length * 6.2 + 18));
      const text = String(label).length > 20 ? String(label).slice(0, 19) + "..." : String(label);
      return '<g class="amount-pill" transform="translate(' + (x - width / 2) + ' ' + (y - 10) + ')">' +
        '<title>' + escapeHtml(label) + '</title>' +
        '<rect width="' + width + '" height="20"></rect>' +
        '<text x="' + (width / 2) + '" y="14" text-anchor="middle">' + escapeHtml(text) + '</text>' +
        '</g>';
    }
    function pathForEdge(edgeId) {
      return graphPaths(state.graph).find((path) => asArray(path.edgeIds).includes(edgeId));
    }
    function pathForStopNode(node) {
      const pathId = node?.metadata?.pathId;
      if (!pathId) return null;
      return graphPaths(state.graph).find((path) => path.id === pathId) || null;
    }
    function lastRealEdgeForStop(node) {
      const edges = graphEdges(state.graph);
      const lastRealEdgeId = node?.metadata?.lastRealEdgeId;
      if (lastRealEdgeId) {
        const edge = edges.find((item) => item.id === lastRealEdgeId);
        if (edge && edge.type !== "stop") return edge;
      }
      const path = pathForStopNode(node);
      const edgeIds = asArray(path?.edgeIds);
      for (let index = edgeIds.length - 1; index >= 0; index -= 1) {
        const edge = edges.find((item) => item.id === edgeIds[index]);
        if (edge && edge.type !== "stop") return edge;
      }
      return null;
    }
    function formatRawUsdt(rawValue) {
      const amount = Number(rawValue) / 1000000;
      if (!Number.isFinite(amount) || amount <= 0) return "";
      if (amount >= 1000000) return trimNumber(amount / 1000000) + "M USDT";
      if (amount >= 1000) return trimNumber(amount / 1000) + "K USDT";
      return trimNumber(amount) + " USDT";
    }
    function rawBigInt(value) {
      if (typeof value !== "string" || !/^\\d+$/.test(value)) return null;
      try {
        return BigInt(value);
      } catch {
        return null;
      }
    }
    function rawShare(numeratorRaw, denominatorRaw) {
      const numerator = rawBigInt(numeratorRaw);
      const denominator = rawBigInt(denominatorRaw);
      if (numerator === null || denominator === null || denominator === 0n) return "n/a";
      return percent(Number(numerator) / Number(denominator));
    }
    function edgeAmount(edge) {
      const path = pathForEdge(edge?.id);
      return edge?.amountFormatted ||
        formatRawUsdt(edge?.amountRaw) ||
        path?.amountFormatted ||
        formatRawUsdt(path?.amountRaw) ||
        "";
    }
    function edgeOriginalAmount(edge) {
      return edge?.metadata?.originalAmountFormatted ||
        formatRawUsdt(edge?.metadata?.originalAmountRaw) ||
        edgeAmount(edge);
    }
    function edgeAllocatedAmount(edge) {
      return edge?.metadata?.usedAmountFormatted ||
        formatRawUsdt(edge?.metadata?.usedAmountRaw) ||
        edgeAmount(edge);
    }
    function edgeAnchorAmount(edge) {
      return edge?.metadata?.anchorAmountFormatted ||
        formatRawUsdt(edge?.metadata?.anchorAmountRaw) ||
        "";
    }
    function edgeHasAllocation(edge) {
      const original = edge?.metadata?.originalAmountRaw;
      const used = edge?.metadata?.usedAmountRaw;
      return typeof original === "string" && typeof used === "string" && original !== used;
    }
    function edgeCanvasAmountLabel(edge) {
      return edgeOriginalAmount(edge) || edgeAmount(edge);
    }
    function edgeShouldShowAmount(edge) {
      return edge?.type !== "stop" && edgeDisplayRole(edge) !== "stop";
    }
    function edgeDetailedAmountLabel(edge) {
      const used = edgeAllocatedAmount(edge);
      const original = edgeOriginalAmount(edge);
      if (!used && !original) return "";
      if (!edgeHasAllocation(edge)) return original || used;
      return original + " original; " + used + " used";
    }
    function edgeTime(edge) {
      return edge?.timestampFormatted || edge?.timestamp || "";
    }
    function formatDurationMs(value) {
      const duration = Number(value);
      if (!Number.isFinite(duration) || duration < 0) return "";
      if (duration === 0) return "0m";
      const minute = 60000;
      const hour = 60 * minute;
      const day = 24 * hour;
      if (duration >= day) {
        const days = Math.floor(duration / day);
        const hours = Math.floor((duration % day) / hour);
        return days + "d" + (hours > 0 ? " " + hours + "h" : "");
      }
      if (duration >= hour) {
        const hours = Math.floor(duration / hour);
        const minutes = Math.floor((duration % hour) / minute);
        return hours + "h" + (minutes > 0 ? " " + minutes + "m" : "");
      }
      return Math.max(1, Math.round(duration / minute)) + "m";
    }
    function edgeTxGap(edge) {
      return edge?.txGapFormatted || formatDurationMs(edge?.metadata?.txGapMs) || "";
    }
    function edgePathId(edge) {
      return edge?.pathId || edge?.metadata?.pathId || "";
    }
    function edgeDisplayRole(edge) {
      return edge?.displayRole || "real_transfer";
    }
    function edgeMeaning(edge) {
      const role = edgeDisplayRole(edge);
      if (role === "profile_context") return "Behavioral/service exposure context";
      if (role === "allocated_transfer") return "Money-origin provenance step with partial coverage allocation";
      if (role === "inferred_provenance") return "Inferred provenance step";
      if (role === "stop") return "Trace stop";
      return "Money-origin provenance step";
    }
    function edgeDirectionMeaning(edge) {
      const role = edgeDisplayRole(edge);
      const metadataDirection = edge?.metadata?.direction;
      if (role === "profile_context" && metadataDirection === "outbound") return "subject -> counterparty";
      if (role === "profile_context" && metadataDirection === "inbound") return "counterparty -> subject";
      return metadataDirection || edge?.direction || "n/a";
    }
    function canvasNodeLabel(node) {
      if (!node) return "";
      const kind = nodeDisplayKind(node);
      if (kind === "subject_wallet") return short(node.address || node.label || node.id, 6);
      if (kind === "bridge") return "Bridge";
      if (kind === "cex") return "CEX";
      if (kind === "contract_adapter") return "Adapter";
      if (kind === "contract_router") return "Router";
      if (kind === "dex_contract") return "DEX";
      if (kind === "smart_contract") return "Contract";
      if (kind === "service_boundary") return "Service";
      if (kind === "funding_bundle") return "Bundle";
      if (kind === "trace_stop") return node?.metadata?.stopCanvasLabel || stopBadgeLabel(node.metadata?.reason || node.label);
      return short(nodeDisplayLabel(node), 6);
    }
    function applyTransform() {
      const viewport = document.getElementById("graphViewport");
      if (viewport) viewport.setAttribute("transform", "translate(" + state.transform.x + " " + state.transform.y + ") scale(" + state.transform.scale + ")");
    }
    function renderGraph() {
      const svg = el("graph");
      if (!state.graph) {
        svg.innerHTML = "";
        el("graphStats").innerHTML = "";
        return;
      }
      const graph = state.graph;
      const placed = layout(graph);
      svg.setAttribute("viewBox", "0 0 " + placed.width + " " + placed.height);
      svg.classList.toggle("node-label-hidden", !state.labels);
      const grid = Array.from({ length: 15 }, (_, index) => '<path class="grid-line" d="M ' + (index * 100) + ' 0 L ' + (index * 100) + ' 1400 M 0 ' + (index * 100) + ' L 1800 ' + (index * 100) + '"></path>').join("");
      const edgeSvg = graphEdges(graph).map((edge) => {
        const from = placed.byId.get(edge.fromNodeId);
        const to = placed.byId.get(edge.toNodeId);
        if (!from || !to) return "";
        const selected = state.selected?.type === "edge" && state.selected.id === edge.id;
        const visible = matchesSearch(edge) && (!state.selected || selected || (state.selected.type === "node" && (edge.fromNodeId === state.selected.id || edge.toNodeId === state.selected.id)));
        const cls = "edge " + escapeHtml(edge.verdict) + (selected ? " selected" : "") + (visible ? "" : " dim");
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const length = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const fromOffset = nodeRadius(from) + 3;
        const toOffset = nodeRadius(to) + 7;
        const startX = from.x + (dx / length) * fromOffset;
        const startY = from.y + (dy / length) * fromOffset;
        const endX = to.x - (dx / length) * toOffset;
        const endY = to.y - (dy / length) * toOffset;
        const midX = (startX + endX) / 2;
        const midY = (startY + endY) / 2;
        const labelX = midX - (dy / length) * 14;
        const labelY = midY + (dx / length) * 14;
        const amountLabel = edgeShouldShowAmount(edge) ? edgeCanvasAmountLabel(edge) : "";
        const shouldShowAmount = edgeShouldShowAmount(edge) && (state.amountMode === "all" || (state.amountMode === "important" && amountLabel));
        const label = state.amountMode === "off" ? "" : shouldShowAmount ? amountLabel : "";
        const marker = ' marker-end="url(#edgeArrow)"';
        return '<g class="edge-group" data-edge-id="' + escapeHtml(edge.id) + '"><path class="' + cls + '" d="M ' + startX + ' ' + startY + ' L ' + endX + ' ' + endY + '"' + marker + '></path>' +
          amountPill(label, labelX, labelY) + '</g>';
      }).join("");
      const nodeSvg = placed.nodes.map((node) => {
        const selected = state.selected?.type === "node" && state.selected.id === node.id;
        const visible = matchesSearch(node) && isSelectedConnected(node.id);
        const cls = "node node-kind-" + escapeHtml(node.kind || "wallet") + (selected ? " selected" : "") + (visible ? "" : " dim");
        const radius = nodeRadius(node);
        return '<g class="' + cls + '" data-node-id="' + escapeHtml(node.id) + '" transform="translate(' + node.x + ' ' + node.y + ')">' +
          '<circle r="' + radius + '" stroke="' + nodeColor(node) + '"></circle>' +
          stopBadge(node, radius) +
          '<text y="' + (radius + 16) + '" text-anchor="middle">' + escapeHtml(canvasNodeLabel(node)) + '</text></g>';
      }).join("");
      const defs = '<defs><marker id="edgeArrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="userSpaceOnUse"><path class="edge-arrow" fill="#f6c177" opacity=".96" d="M 0 0 L 7 3.5 L 0 7 z"></path></marker></defs>';
      svg.innerHTML = defs + '<g id="graphViewport">' + grid + edgeSvg + nodeSvg + '</g>';
      applyTransform();
      svg.querySelectorAll("[data-node-id]").forEach((node) => node.addEventListener("click", (event) => {
        event.stopPropagation();
        selectNode(node.getAttribute("data-node-id"));
      }));
      svg.querySelectorAll("[data-edge-id]").forEach((edge) => edge.addEventListener("click", (event) => {
        event.stopPropagation();
        selectEdge(edge.getAttribute("data-edge-id"));
      }));
      el("graphStats").innerHTML = [
        ["nodes", placed.nodes.length],
        ["edges", graphEdges(graph).length],
        ["paths", graphPaths(graph).length],
        ["weights", graphWeights(graph).length]
      ].map(([label, value]) => '<span class="chip">' + label + ': ' + value + '</span>').join("");
    }
    function selectNode(nodeId) {
      state.selected = { type: "node", id: nodeId };
      renderGraph();
      renderDetails();
      renderTransferTabs();
    }
    function selectEdge(edgeId) {
      state.selected = { type: "edge", id: edgeId };
      renderGraph();
      renderDetails();
      renderTransferTabs();
    }
    function renderTransferTabs() {
      const root = el("transferTable");
      if (!state.graph) {
        root.innerHTML = '<div class="empty">Select a graph to inspect transfers.</div>';
        return;
      }
      if (state.transferTab === "stops") return renderBoundaryStops(root);
      const edges = state.transferTab === "selected"
        ? transferEdges().filter((edge) => selectedEdgeIds().has(edge.id))
        : transferEdges();
      if (edges.length === 0) {
        root.innerHTML = '<div class="empty">' + (state.transferTab === "selected" ? "Select an edge or node." : "No graph edges found.") + '</div>';
        return;
      }
      root.innerHTML = '<div class="transfer-head"><span>time</span><span>tx gap</span><span>amount</span><span>from</span><span>to</span><span>tx</span><span>path</span><span>verdict</span></div>' +
        edges.map((edge) => '<div role="button" tabindex="0" class="transfer-row" data-edge-id="' + escapeHtml(edge.id) + '">' +
          '<span>' + escapeHtml(edgeTime(edge) || "time n/a") + '</span>' +
          '<span title="' + escapeHtml(edge?.metadata?.txGapMs ?? "") + '">' + escapeHtml(edgeTxGap(edge) || "n/a") + '</span>' +
          '<span>' + escapeHtml(edgeDetailedAmountLabel(edge) || "amount n/a") + '</span>' +
          '<span>' + explorerLink(edgeFromTronScanUrl(edge), short(edgeFromAddress(edge), 7)) + '</span>' +
          '<span>' + explorerLink(edgeToTronScanUrl(edge), short(edgeToAddress(edge), 7)) + '</span>' +
          '<span>' + explorerLink(edgeTxTronScanUrl(edge), edge.txHash ? short(edge.txHash, 5) : "inferred") + '</span>' +
          '<span>' + escapeHtml(edgePathId(edge) || "n/a") + '</span>' +
          '<span>' + escapeHtml(edge.verdict || "unknown") + '</span>' +
          '</div>').join("");
      root.querySelectorAll("[data-edge-id]").forEach((row) => {
        row.addEventListener("click", (event) => {
          if (event.target instanceof Element && event.target.closest("a")) return;
          selectEdge(row.getAttribute("data-edge-id"));
        });
        row.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            selectEdge(row.getAttribute("data-edge-id"));
          }
        });
      });
    }
    function stopNodeForPath(path) {
      const stoppedAtNodeId = path?.stoppedAtNodeId;
      if (stoppedAtNodeId) {
        const node = graphNodes(state.graph).find((item) => item.id === stoppedAtNodeId);
        if (node) return node;
      }
      return graphNodes(state.graph).find((node) =>
        nodeDisplayKind(node) === "trace_stop" &&
        (node?.metadata?.pathId === path?.id || asArray(node?.metadata?.relatedPathIds).includes(path?.id))
      ) || null;
    }
    function boundaryStopTitle(path) {
      const node = stopNodeForPath(path);
      return node?.metadata?.stopTitle ||
        path?.stopReasonLabel ||
        stopBadgeLabel(node?.metadata?.reason || path?.stopReason || node?.label) ||
        "Unknown";
    }
    function boundaryStopType(path) {
      const node = stopNodeForPath(path);
      return stopCategoryLabel(node?.metadata?.stopCategory || path?.stopCategory || "unknown");
    }
    function boundaryStopContribution(path) {
      const node = stopNodeForPath(path);
      const category = node?.metadata?.stopCategory || path?.stopCategory || "unknown";
      const value = path?.riskContribution ?? node?.weight ?? "n/a";
      if (category === "data_quality") return "Uncertainty +" + value;
      if (category === "continuity") return "Continuity +" + value;
      return "Boundary +" + value;
    }
    function boundaryStopReachedTime(path) {
      const node = stopNodeForPath(path);
      const detail = asArray(node?.metadata?.stopDetails).find((item) => item.pathId === path?.id) || asArray(node?.metadata?.stopDetails)[0] || {};
      return typeof detail.reachedTargetHop === "boolean" ? (detail.reachedTargetHop ? "yes" : "no") : "n/a";
    }
    function boundaryStopHistoryChecked(path) {
      const node = stopNodeForPath(path);
      const detail = asArray(node?.metadata?.stopDetails).find((item) => item.pathId === path?.id) || asArray(node?.metadata?.stopDetails)[0] || {};
      const txCount = detail.totalFetchedTransferCount !== null && detail.totalFetchedTransferCount !== undefined ? detail.totalFetchedTransferCount : "n/a";
      const pages = detail.pagesChecked !== null && detail.pagesChecked !== undefined ? detail.pagesChecked : "n/a";
      return txCount + " tx / " + pages + " page(s)";
    }
    function boundaryStopLastHop(path) {
      const edge = lastRealEdgeForStop(stopNodeForPath(path));
      return (edgeTime(edge) || "time n/a") + " / " + (edgeCanvasAmountLabel(edge) || "amount n/a");
    }
    function renderBoundaryStops(root) {
      const paths = graphPaths(state.graph).filter((path) => path.stopReason);
      if (paths.length === 0) {
        root.innerHTML = '<div class="empty">No boundary stops found.</div>';
        return;
      }
      root.innerHTML = '<div class="transfer-head boundary"><span>path</span><span>stop</span><span>type</span><span>contribution</span><span>Reached required time</span><span>History checked</span><span>Last real hop</span></div>' +
        paths.map((path) => '<div role="button" tabindex="0" class="transfer-row boundary" data-stop-node-id="' + escapeHtml(stopNodeForPath(path)?.id || path.stoppedAtNodeId || "") + '">' +
          '<span>' + escapeHtml(path.id || "n/a") + '</span>' +
          '<span>' + escapeHtml(boundaryStopTitle(path)) + '</span>' +
          '<span>' + escapeHtml(boundaryStopType(path)) + '</span>' +
          '<span>' + escapeHtml(boundaryStopContribution(path)) + '</span>' +
          '<span>' + escapeHtml(boundaryStopReachedTime(path)) + '</span>' +
          '<span>' + escapeHtml(boundaryStopHistoryChecked(path)) + '</span>' +
          '<span>' + escapeHtml(boundaryStopLastHop(path)) + '</span>' +
          '</div>').join("");
      root.querySelectorAll("[data-stop-node-id]").forEach((row) => {
        const nodeId = row.getAttribute("data-stop-node-id");
        if (!nodeId) return;
        row.addEventListener("click", (event) => {
          if (event.target instanceof Element && event.target.closest("a")) return;
          selectNode(nodeId);
        });
        row.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            selectNode(nodeId);
          }
        });
      });
    }
    function renderDetails() {
      const root = el("details");
      const graph = state.graph;
      if (!graph) {
        root.className = "details-body empty";
        root.innerHTML = "Select a completed or partial job.";
        return;
      }
      root.className = "details-body";
      if (state.selected?.type === "node") {
        const node = graphNodes(graph).find((item) => item.id === state.selected.id);
        root.innerHTML = walletDetailBlock(node, graph);
        return;
      }
      if (state.selected?.type === "edge") {
        const edge = graphEdges(graph).find((item) => item.id === state.selected.id);
        root.innerHTML = transferDetailBlock(edge);
        return;
      }
      const subject = graphSubject(graph);
      const summary = graphSummary(graph);
      const activeJob = state.jobs.find((job) => job.id === state.activeJobId) || graph.job;
      root.innerHTML = '<div class="metric-grid">' +
        metric("Subject", subject.address || "unknown", "wide") +
        metric("Requested by", activeJob ? requesterText(activeJob) : "unknown", "wide") +
        metric("Decision", summary.decision || "UNKNOWN") +
        metric("Risk", (summary.riskScore ?? "n/a") + " / " + (summary.riskLevel ?? "unknown")) +
        metric("Coverage", percent(summary.coverageRatio)) +
        metric("Checked scope", summary.checkedScope || "n/a") +
        metric("Anchor coverage", percent(summary.anchorCoverageRatio)) +
        metric("Episode coverage", percent(summary.episodeCoverageRatio)) +
        metric("Drain episode", drainEpisodeSummary(summary), "wide") +
        metric("Layer summary", layerSummaryLine(summary), "wide") +
        metric("Projection mode", projectionMode(graph)) +
        listMetric("Projection gaps", projectionGapLines(graph), "No projection gaps stored.") +
        metric("Selected amount", summary.selectedAmountFormatted || summary.selectedAmountRaw || "n/a") +
        metric("Target/current", (summary.targetAmountFormatted || "n/a") + " / " + (summary.currentBalanceFormatted || "n/a")) +
        metric("Paths", graphPaths(graph).length) +
        metric("Evidence", graphEvidence(graph).length) +
        metric("Weights", graphWeights(graph).length) +
        metric("Limitations", graphLimitations(graph).map((item) => item?.label).filter(Boolean).join(", ") || "none", "wide") +
        listMetric("Why", asArray(summary.topReasons), "No top reasons stored.") +
        listMetric("Warnings", asArray(summary.warnings), "No warnings stored.") +
        listMetric("Stop reasons", stopReasonLines(summary), "No stopped paths.") +
        listMetric("Risk layers", riskLayerLines(summary), "No risk layers stored.") +
        rawBlock("Summary JSON", summary) +
        '</div>';
    }
    function percent(value) {
      return typeof value === "number" ? trimNumber(value * 100) + "%" : "n/a";
    }
    function trimNumber(value) {
      return Number(value).toFixed(2).replace(/\\.?0+$/, "");
    }
    function raw(value) {
      return value === null || value === undefined || value === "" ? "n/a" : String(value);
    }
    function drainEpisodeSummary(summary) {
      const episode = summary?.drainEpisode && typeof summary.drainEpisode === "object" ? summary.drainEpisode : null;
      if (!episode) return "none";
      return "total " + raw(episode.episodeOutgoingRaw) + "; bridge share " + percent(episode.bridgeOutgoingShare);
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
    function metric(label, value, cls = "") {
      return '<div class="metric ' + cls + '"><label>' + escapeHtml(label) + '</label><div>' + escapeHtml(value) + '</div></div>';
    }
    function metricHtml(label, html, cls = "") {
      return '<div class="metric ' + cls + '"><label>' + escapeHtml(label) + '</label><div>' + html + '</div></div>';
    }
    function rawBlock(label, value) {
      return '<details class="metric wide"><summary>' + escapeHtml(label) + '</summary><pre class="json-block">' + escapeHtml(JSON.stringify(value, null, 2)) + '</pre></details>';
    }
    function listHtml(items, empty) {
      const values = asArray(items).filter((item) => item !== null && item !== undefined && String(item).length > 0);
      if (values.length === 0) return '<span class="muted">' + escapeHtml(empty || "n/a") + '</span>';
      return '<div class="list-lines">' + values.map((item) => '<div>' + escapeHtml(item) + '</div>').join("") + '</div>';
    }
    function listMetric(label, items, empty) {
      return metricHtml(label, listHtml(items, empty), "wide");
    }
    function typeChip(label, cls) {
      return '<span class="type-chip ' + escapeHtml(cls || "wallet") + '">' + escapeHtml(label) + '</span>';
    }
    function semanticNodeType(node) {
      const kind = nodeDisplayKind(node);
      if (kind === "subject_wallet") return { label: "Subject wallet", cls: "subject" };
      if (kind === "bridge") return { label: "Bridge / service", cls: "bridge" };
      if (kind === "cex") return { label: "CEX / exchange", cls: "cex" };
      if (kind === "contract_adapter") return { label: "Contract / adapter", cls: "contract" };
      if (kind === "contract_router") return { label: "Contract / router", cls: "contract" };
      if (kind === "dex_contract") return { label: "DEX contract", cls: "contract" };
      if (kind === "smart_contract") return { label: "Smart contract", cls: "contract" };
      if (kind === "service_boundary") return { label: "Service boundary", cls: "service" };
      if (kind === "funding_bundle") return { label: "Funding bundle", cls: "bundle" };
      if (kind === "trace_stop") return { label: "Trace stop", cls: "boundary" };
      return { label: "Wallet", cls: "wallet" };
    }
    function nodeType(node) {
      const semantic = semanticNodeType(node);
      if (!node || !hasStopReason(node)) return semantic;
      const kind = nodeDisplayKind(node);
      if (kind === "service_boundary" || kind === "trace_stop") return semantic;
      if (semantic.cls === "wallet") return { label: "Boundary wallet", cls: "boundary" };
      return { label: semantic.label + " boundary", cls: semantic.cls };
    }
    function technicalNodeType(node) {
      if (!node) return "n/a";
      return [
        node.kind || "wallet",
        node.metadata?.category,
        node.metadata?.serviceCategory,
        node.metadata?.serviceType,
        node.metadata?.sourceExposureKind,
        node.metadata?.exposureSourceKey,
        node.metadata?.rootSourceType,
        node.metadata?.source
      ].filter((item, index, items) => item !== null && item !== undefined && String(item).length > 0 && items.indexOf(item) === index).join(" / ") || "wallet";
    }
    function technicalNodeName(node) {
      if (!node) return "n/a";
      return nodeDisplayLabel(node);
    }
    function stopReasonLines(summary) {
      return asArray(summary.stopReasonCounts).map((item) => (item.reason || "unknown") + " - " + (item.count || 0) + " path(s)");
    }
    function riskLayerLines(summary) {
      return asArray(summary.riskLayers).map((layer) => {
        const score = layer.score ?? layer.adjustedScore ?? layer.rawScore ?? "n/a";
        const proof = layer.proofLevel ? " / " + layer.proofLevel : "";
        return (layer.kind || "risk_layer") + ": " + score + proof;
      });
    }
    function pathLines(paths) {
      return asArray(paths).map((path) => {
        const formattedPathAmount = path.amountFormatted || formatRawUsdt(path.amountRaw);
        const amount = formattedPathAmount ? " / " + formattedPathAmount : "";
        const share = typeof path.amountShare === "number" ? " / share " + percent(path.amountShare) : "";
        const span = typeof path.timeSpanMs === "number" ? " / span " + formatDurationMs(path.timeSpanMs) : "";
        const stop = path.stopReason ? " / stop " + path.stopReason : "";
        return path.id + amount + " / risk " + (path.riskContribution ?? "n/a") + share + span + stop;
      });
    }
    function transferLines(edges) {
      return asArray(edges).map((edge) => {
        const amount = edgeDetailedAmountLabel(edge) || "amount n/a";
        const time = edgeTime(edge) || "time n/a";
        const gap = edgeTxGap(edge) ? " / gap " + edgeTxGap(edge) : "";
        const from = short(edgeFromAddress(edge), 5);
        const to = short(edgeToAddress(edge), 5);
        return amount + " / " + time + gap + " / " + from + " -> " + to;
      });
    }
    function transferListHtml(edges, empty) {
      const values = asArray(edges);
      if (values.length === 0) return '<span class="muted">' + escapeHtml(empty || "n/a") + '</span>';
      return '<div class="tx-lines">' + values.map((edge) => {
        const amount = edgeDetailedAmountLabel(edge) || "amount n/a";
        const time = edgeTime(edge) || "time n/a";
        const gap = edgeTxGap(edge);
        const from = explorerLink(edgeFromTronScanUrl(edge), short(edgeFromAddress(edge), 7));
        const to = explorerLink(edgeToTronScanUrl(edge), short(edgeToAddress(edge), 7));
        const tx = edgeTxTronScanUrl(edge)
          ? 'tx ' + explorerLink(edgeTxTronScanUrl(edge), short(edge.txHash, 6))
          : '<span class="muted">tx inferred</span>';
        return '<div class="tx-line">' +
          '<div class="tx-main"><strong>' + escapeHtml(amount) + '</strong><span>' + escapeHtml(time) + (gap ? ' / gap ' + escapeHtml(gap) : '') + '</span></div>' +
          '<div class="tx-route">' + from + ' -> ' + to + '</div>' +
          '<div class="tx-meta"><span>' + tx + '</span><span>' + escapeHtml(edge.verdict || "unknown") + '</span></div>' +
          '</div>';
      }).join("") + '</div>';
    }
    function transferListMetric(label, edges, empty) {
      return metricHtml(label, transferListHtml(edges, empty), "wide");
    }
    function weightLines(weights) {
      return asArray(weights).map((weight) => {
        const metadata = weight.metadata && typeof weight.metadata === "object" ? weight.metadata : {};
        const details = [raw(weight.value) + " / " + (weight.source || "unknown_source")];
        if (metadata.affectedAmountRaw || metadata.targetAmountRaw) {
          details.push("affected " + (formatRawUsdt(metadata.affectedAmountRaw) || raw(metadata.affectedAmountRaw)) + " / target " + (formatRawUsdt(metadata.targetAmountRaw) || raw(metadata.targetAmountRaw)));
        }
        if (typeof metadata.rawShare === "number" || typeof metadata.effectiveShare === "number") {
          details.push("share " + percent(metadata.rawShare) + " raw / " + percent(metadata.effectiveShare) + " effective");
        }
        if (metadata.shareCap !== undefined || metadata.shareFloor !== undefined) {
          details.push("cap " + raw(metadata.shareCap) + " / floor " + raw(metadata.shareFloor));
        }
        if (metadata.finalContribution !== undefined || metadata.sourceSeverity !== undefined) {
          details.push("contribution " + raw(metadata.finalContribution) + " from severity " + raw(metadata.sourceSeverity));
        }
        if (metadata.proofLevel || metadata.riskBand) {
          details.push("proof " + raw(metadata.proofLevel) + " / band " + raw(metadata.riskBand));
        }
        return (weight.label || weight.source || "weight") + ": " + details.join(" | ") + " / " + (weight.explanation || "no explanation");
      });
    }
    function firstStopDetail(node) {
      return asArray(node?.metadata?.stopDetails)[0] || {};
    }
    function stopHistoryLines(node) {
      const detail = firstStopDetail(node);
      const historySpan = typeof detail.historyDaysChecked === "number" ? trimNumber(detail.historyDaysChecked) + " day(s)" : "n/a";
      const pagesChecked = detail.pagesChecked !== null && detail.pagesChecked !== undefined ? detail.pagesChecked : "n/a";
      const historyTxChecked = detail.totalFetchedTransferCount !== null && detail.totalFetchedTransferCount !== undefined ? detail.totalFetchedTransferCount : "n/a";
      const reachedRequiredTime = typeof detail.reachedTargetHop === "boolean" ? (detail.reachedTargetHop ? "yes" : "no") : "n/a";
      return [
        "Required history cutoff: " + (iso(detail.targetTimestamp) || "n/a"),
        "Oldest fetched transfer: " + (iso(detail.oldestFetchedTransferAt) || "n/a"),
        "Reached required time: " + reachedRequiredTime,
        "History span checked: " + historySpan,
        "Pages checked: " + pagesChecked,
        "History tx checked: " + historyTxChecked
      ];
    }
    function rejectedCandidateReasonLabel(reason) {
      const labels = {
        after_target_timestamp: "after required hop time",
        amount_continuity_below_threshold: "amount continuity too weak",
        time_continuity_above_threshold: "time gap too large"
      };
      return labels[reason] || String(reason || "unknown").replace(/_/g, " ");
    }
    function rejectedCandidateLines(node) {
      return asArray(firstStopDetail(node).rejectedCandidates).slice(0, 5).map((candidate) => {
        const tx = candidate.txHash ? short(candidate.txHash, 6) : "unknown tx";
        const amount = formatRawUsdt(candidate.amountRaw) || candidate.amountRaw || "amount n/a";
        const time = iso(candidate.timestamp) || "time n/a";
        const reasons = asArray(candidate.reasons).map(rejectedCandidateReasonLabel).join(", ") || "reason n/a";
        return tx + " / " + amount + " / " + time + " / " + reasons;
      });
    }
    function stopDetailLines(details) {
      return asArray(details).map((detail) => {
        const gap = detail.gapUnavailable
          ? "Exact idle/time gap is not stored in evidence."
          : detail.gapDays !== null && detail.gapDays !== undefined
            ? "Stored gap: " + trimNumber(detail.gapDays) + " day(s)."
            : "Gap n/a.";
        const span = typeof detail.timeSpanMs === "number" && detail.timeSpanMs > 0 ? " Path span: " + trimNumber(detail.timeSpanMs / 86400000) + " day(s)." : "";
        const historyTx = typeof detail.totalFetchedTransferCount === "number" ? " History tx checked: " + detail.totalFetchedTransferCount + "." : "";
        const historyDays = typeof detail.historyDaysChecked === "number" ? " History span: " + trimNumber(detail.historyDaysChecked) + " day(s)." : "";
        const incoming = typeof detail.hadIncomingTransfers === "boolean" ? " Incoming seen: " + (detail.hadIncomingTransfers ? "yes" : "no") + "." : "";
        const reached = typeof detail.reachedTargetHop === "boolean" ? " Reached hop time: " + (detail.reachedTargetHop ? "yes" : "no") + "." : "";
        const source = detail.historySource ? " Source: " + detail.historySource + "." : "";
        const pages = detail.pagesChecked !== null && detail.pagesChecked !== undefined ? " Pages checked: " + detail.pagesChecked + "." : " Pages checked: n/a.";
        const rejectedItems = asArray(detail.rejectedCandidates).slice(0, 5);
        const rejected = rejectedItems.length > 0
          ? " Rejected candidates: " + rejectedItems.map((candidate) =>
            short(candidate.txHash || "unknown", 5) + " [" + asArray(candidate.reasons).join(", ") + "]"
          ).join("; ") + "."
          : "";
        return (detail.stopReason || "unknown") + " / path " + (detail.pathId || "n/a") + " / risk " + (detail.riskContribution ?? "n/a") + ". " + (detail.reason || detail.stopReasonExplanation || "") + " " + gap + span + historyTx + historyDays + incoming + reached + source + pages + rejected;
      });
    }
    function projectionMode(graph) {
      const kind = graph?.job?.kind;
      if (kind === "address_deep_check") return "Profile graph";
      if (kind === "where_is_money_check") return "Money-origin trace";
      if (kind === "incoming_deposit_check") return "Deposit-origin trace";
      return kind || "unknown";
    }
    function projectionGapLines(graph) {
      const kind = graph?.job?.kind;
      const summary = graphSummary(graph);
      const layer = summary.layerSummary && typeof summary.layerSummary === "object" ? summary.layerSummary : {};
      const edges = graphEdges(graph);
      const paths = graphPaths(graph);
      const limitations = graphLimitations(graph);
      if (kind === "address_deep_check") {
        const deep = layer.deepCoverage && typeof layer.deepCoverage === "object" ? layer.deepCoverage : {};
        const projected = layer.projectedProfiles && typeof layer.projectedProfiles === "object" ? layer.projectedProfiles : {};
        return [
          deep.transferEdges !== undefined ? "Raw transfer edges found: " + deep.transferEdges + (deep.sourceTransferPages !== undefined ? " across " + deep.sourceTransferPages + " source page(s)." : ".") : "",
          "Rendered profile edges: " + edges.length + " inferred edge(s).",
          "Projected profiles: counterparties " + (projected.directCounterpartyInteractionProfiles ?? 0) + ", services " + (projected.serviceExposureProfiles ?? 0) + ", inbound provenance " + (projected.inboundProvenancePaths ?? 0) + ".",
          "Raw transfer history is summarized into counterparty/service profiles here; full route tracing belongs to where_is_money_check or incoming_deposit_check."
        ];
      }
      if (kind === "where_is_money_check") {
        return [
          "Rendered origin paths: " + paths.length + "; graph edges: " + edges.length + ".",
          limitations.length > 0 ? "Stops/limits: " + limitations.map((item) => item.code).join(", ") + "." : "No stop limitations stored.",
          "Canvas edge labels show original transfer amounts; allocation is explained in transfer rows and transfer details."
        ];
      }
      if (kind === "incoming_deposit_check") {
        const funding = layer.fundingCoverage && typeof layer.fundingCoverage === "object" ? layer.fundingCoverage : {};
        return [
          "Rendered deposit origin paths: " + paths.length + "; graph edges: " + edges.length + ".",
          funding.depositFundingCoverageRatio !== undefined ? "Deposit funding coverage: " + percent(funding.depositFundingCoverageRatio) + "." : "",
          limitations.length > 0 ? "Stops/limits: " + limitations.map((item) => item.code).join(", ") + "." : "No stop limitations stored."
        ];
      }
      return [];
    }
    function bundleFunderLines(node) {
      return asArray(node?.metadata?.topFunders).map((funder, index) => {
        const amount = formatRawUsdt(funder.amountRaw) || funder.amountRaw || "amount n/a";
        const txCount = asArray(funder.txHashes).length;
        return "#" + (index + 1) + " " + (funder.address || "unknown") + " / " + amount + " / " + txCount + " tx";
      });
    }
    function bundleDetailBlock(node, graph) {
      const type = nodeType(node);
      const relatedEdgeIds = new Set(asArray(node.metadata?.relatedEdgeIds));
      const relatedPathIds = new Set(asArray(node.metadata?.relatedPathIds));
      const relatedEdges = graphEdges(graph).filter((edge) => relatedEdgeIds.has(edge.id) || edge.fromNodeId === node.id || edge.toNodeId === node.id);
      const relatedPaths = graphPaths(graph).filter((path) => relatedPathIds.has(path.id) || asArray(path.nodeIds).includes(node.id));
      const covered = formatRawUsdt(node.metadata?.coveredAmountRaw || node.metadata?.bundleAmountRaw) || node.metadata?.coveredAmountRaw || node.metadata?.bundleAmountRaw || "n/a";
      const target = formatRawUsdt(node.metadata?.expectedAmountRaw || node.metadata?.targetAmountRaw) || node.metadata?.expectedAmountRaw || node.metadata?.targetAmountRaw || "n/a";
      const tail = node.metadata?.smallTailAmountRaw ? formatRawUsdt(node.metadata.smallTailAmountRaw) || node.metadata.smallTailAmountRaw : "n/a";
      return '<div class="metric-grid">' +
        metricHtml("Selected", typeChip(type.label, type.cls)) +
        metric("Path", node.metadata?.pathId || "n/a") +
        metric("Coverage", percent(node.metadata?.coverageRatio)) +
        metric("Covered amount", covered) +
        metric("Target amount", target) +
        metric("Top funders", node.metadata?.funderCount ?? "n/a") +
        metric("Members", node.metadata?.memberCount ?? "n/a") +
        metric("Small tail", (node.metadata?.smallTailCount ?? 0) + " funder(s) / " + tail) +
        metric("Hop/target tx", node.metadata?.hopTxHash || node.metadata?.targetTxHash || "n/a", "wide") +
        listMetric("Top 3 funders", bundleFunderLines(node), "No top funders stored.") +
        listMetric("Path context", pathLines(relatedPaths), "No related paths in this graph.") +
        transferListMetric("Bundle edges", relatedEdges, "No related bundle edges.") +
        rawBlock("Funding bundle JSON", node) +
        '</div>';
    }
    function subjectReportBlock(node, graph) {
      const summary = graphSummary(graph);
      return metric("Decision", summary.decision || "UNKNOWN") +
        metric("Risk score", (summary.riskScore ?? "n/a") + " / " + (summary.riskLevel ?? "unknown")) +
        metric("Confidence", summary.confidence || "n/a") +
        metric("Coverage", percent(summary.coverageRatio)) +
        metric("Selected amount", summary.selectedAmountFormatted || summary.selectedAmountRaw || "n/a") +
        metric("Target/current", (summary.targetAmountFormatted || "n/a") + " / " + (summary.currentBalanceFormatted || "n/a")) +
        metric("Selected inbound tx", summary.selectedInboundTxCount ?? "n/a") +
        metric("Wallet role", summary.walletRole || "n/a") +
        metric("Projection mode", projectionMode(graph)) +
        listMetric("Projection gaps", projectionGapLines(graph), "No projection gaps stored.") +
        listMetric("Why", asArray(summary.topReasons), "No top reasons stored.") +
        listMetric("Warnings", asArray(summary.warnings), "No warnings stored.") +
        listMetric("Risk layers", riskLayerLines(summary), "No risk layers stored.") +
        listMetric("Stop reasons", stopReasonLines(summary), "No stopped paths.");
    }
    function traceStopDetailBlock(node, graph) {
      if (!node) return '<div class="empty">No trace stop found.</div>';
      const path = pathForStopNode(node);
      const lastEdge = lastRealEdgeForStop(node);
      const detail = firstStopDetail(node);
      const pathSpanMs = typeof path?.timeSpanMs === "number" ? path.timeSpanMs : detail.timeSpanMs;
      const pathSpan = typeof pathSpanMs === "number" ? formatDurationMs(pathSpanMs) : "n/a";
      const lastHopAmount = edgeDetailedAmountLabel(lastEdge) ||
        edgeCanvasAmountLabel(lastEdge) ||
        formatRawUsdt(node.metadata?.lastRealHopAmountRaw) ||
        node.metadata?.lastRealHopAmountRaw ||
        "n/a";
      const lastHopTime = edgeTime(lastEdge) || node.metadata?.lastRealHopTimestamp || "n/a";
      const stopAmount = node.metadata?.stopAmountLabel ||
        node.metadata?.stopAmountFormatted ||
        formatRawUsdt(node.metadata?.stopAmountRaw) ||
        node.metadata?.stopAmountRaw ||
        "not a transfer";
      return '<div class="metric-grid">' +
        metricHtml("Selected", typeChip("Trace stop", "boundary")) +
        metric("Stop type", stopCategoryLabel(stopNodeCategory(node))) +
        metric("Reason", stopNodeTitle(node), "wide") +
        metric("Meaning", stopNodeMeaning(node), "wide") +
        metric("Stop id", node.id || "n/a", "wide") +
        metric("Stop amount", stopAmount) +
        metric(stopScoreLabel(node), node.weight ?? "n/a") +
        metric("Score meaning", stopScoreMeaning(node), "wide") +
        metric("Path contribution band", node.metadata?.riskBand || path?.riskBand || path?.verdict || node.riskLevel || "n/a") +
        metric("Path", path?.id || node.metadata?.pathId || "n/a") +
        metric("Path span", pathSpan) +
        metric("Last real hop amount", lastHopAmount) +
        metric("Last real hop time", lastHopTime) +
        metric("Previous hop gap", edgeTxGap(lastEdge) || "n/a") +
        listMetric("History coverage", stopHistoryLines(node), "No history coverage stored.") +
        listMetric("Rejected candidates", rejectedCandidateLines(node), "No rejected candidates stored.") +
        listMetric("Trace stop", stopDetailLines(node.metadata?.stopDetails), "No trace stop details stored.") +
        rawBlock("Trace stop JSON", node) +
        '</div>';
    }
    function walletDetailBlock(node, graph) {
      if (!node) return '<div class="empty">No wallet found.</div>';
      if (node.kind === "stop" || nodeDisplayKind(node) === "trace_stop") return traceStopDetailBlock(node, graph);
      if (node.kind === "bundle") return bundleDetailBlock(node, graph);
      const type = nodeType(node);
      const relatedEdgeIds = new Set(asArray(node.metadata?.relatedEdgeIds));
      const relatedPathIds = new Set(asArray(node.metadata?.relatedPathIds));
      const relatedEdges = graphEdges(graph).filter((edge) => relatedEdgeIds.has(edge.id) || edge.fromNodeId === node.id || edge.toNodeId === node.id);
      const transactionEdges = relatedEdges.filter((edge) => edge.type === "transfer" || edgeAmount(edge) || edge.txHash || edgeTime(edge));
      const relatedPaths = graphPaths(graph).filter((path) => relatedPathIds.has(path.id) || asArray(path.nodeIds).includes(node.id));
      const relatedWeights = asArray(node.metadata?.relatedWeights);
      const incomingAmount = node.metadata?.incomingAmountFormatted || formatRawUsdt(node.metadata?.incomingAmountRaw) || "n/a";
      const outgoingAmount = node.metadata?.outgoingAmountFormatted || formatRawUsdt(node.metadata?.outgoingAmountRaw) || "n/a";
      return '<div class="metric-grid">' +
        metricHtml("Selected", typeChip(type.label, type.cls)) +
        metricHtml("Address", explorerLink(nodeTronScanUrl(node), node.address || node.id), "wide") +
        metric("Technical type", technicalNodeType(node)) +
        metric("Technical name", technicalNodeName(node)) +
        metric("Risk level", node.riskLevel || "n/a") +
        metric("Risk score", node.weight ?? "n/a") +
        metric("Visible incoming", incomingAmount) +
        metric("Visible outgoing", outgoingAmount) +
        metric("Connected transfers", node.metadata?.connectedTransferCount ?? relatedEdges.length) +
        metric("Related paths", relatedPaths.length) +
        (node.kind === "subject" ? subjectReportBlock(node, graph) : "") +
        listMetric("Path context", pathLines(relatedPaths), "No related paths in this graph.") +
        transferListMetric("Transactions", transactionEdges, "No related transactions in this graph.") +
        listMetric("Weights", weightLines(relatedWeights), "No related weights.") +
        listMetric("Trace stop", stopDetailLines(node.metadata?.stopDetails), "Trace did not stop on this wallet.") +
        rawBlock(type.label + " JSON", node) +
        '</div>';
    }
    function transferDetailBlock(edge) {
      if (!edge) return '<div class="empty">No transfer found.</div>';
      return '<div class="metric-grid">' +
        metricHtml("Selected", typeChip("Transfer", "service")) +
        metric("Meaning", edgeMeaning(edge)) +
        metric("Direction", edgeDirectionMeaning(edge)) +
        (edgeDisplayRole(edge) === "profile_context"
          ? metric("Proof scope", "This is not money-origin proof.", "wide")
          : "") +
        metric("Amount", edgeDetailedAmountLabel(edge) || "amount n/a") +
        metric("Used for checked amount", edgeHasAllocation(edge) ? edgeAllocatedAmount(edge) || "n/a" : "same as transfer") +
        metric("Original transfer amount", edgeOriginalAmount(edge) || "n/a") +
        metric("Target coverage amount", edgeAnchorAmount(edge) || "n/a") +
        metric("Used share of target", edgeHasAllocation(edge) ? rawShare(edge?.metadata?.usedAmountRaw, edge?.metadata?.anchorAmountRaw) : "n/a") +
        metric("Used share of transfer", edgeHasAllocation(edge) ? rawShare(edge?.metadata?.usedAmountRaw, edge?.metadata?.originalAmountRaw) : "n/a") +
        (edgeHasAllocation(edge)
          ? metric("Allocation note", "Only this portion of the larger transfer was counted toward the checked amount; the rest was not used in this path.", "wide")
          : "") +
        metric("Time", edgeTime(edge) || "time n/a") +
        metric("Tx gap from previous hop", edgeTxGap(edge) || "n/a") +
        metricHtml("From", explorerLink(edgeFromTronScanUrl(edge), edgeFromAddress(edge) || edge.fromNodeId), "wide") +
        metricHtml("To", explorerLink(edgeToTronScanUrl(edge), edgeToAddress(edge) || edge.toNodeId), "wide") +
        metricHtml("Tx hash", explorerLink(edgeTxTronScanUrl(edge), edge.txHash || "inferred"), "wide") +
        metric("Path", edgePathId(edge) || "n/a") +
        metric("Verdict", edge.verdict || "unknown") +
        metric("Weight", edge.weight ?? "n/a") +
        rawBlock("Transfer JSON", edge) +
        '</div>';
    }
    function fitGraph() {
      if (!state.graph) return;
      state.transform = { x: 0, y: 0, scale: 1 };
      applyTransform();
    }
    function zoom(multiplier) {
      state.transform.scale = Math.max(.25, Math.min(4, state.transform.scale * multiplier));
      applyTransform();
    }
    function initPanZoom() {
      const svg = el("graph");
      let drag = null;
      svg.addEventListener("mousedown", (event) => {
        drag = { x: event.clientX, y: event.clientY, startX: state.transform.x, startY: state.transform.y };
        svg.classList.add("dragging");
      });
      window.addEventListener("mousemove", (event) => {
        if (!drag) return;
        state.transform.x = drag.startX + (event.clientX - drag.x);
        state.transform.y = drag.startY + (event.clientY - drag.y);
        applyTransform();
      });
      window.addEventListener("mouseup", () => {
        drag = null;
        svg.classList.remove("dragging");
      });
      svg.addEventListener("wheel", (event) => {
        event.preventDefault();
        zoom(event.deltaY > 0 ? .9 : 1.1);
      }, { passive: false });
      svg.addEventListener("click", () => {
        state.selected = null;
        renderGraph();
        renderDetails();
        renderTransferTabs();
      });
    }
    function setAutoRefresh() {
      if (state.autoTimer) {
        clearInterval(state.autoTimer);
        state.autoTimer = null;
        el("autoRefresh").textContent = "Auto off";
        el("autoRefresh").classList.remove("active");
        return;
      }
      state.autoTimer = setInterval(loadJobs, 10000);
      el("autoRefresh").textContent = "Auto 10s";
      el("autoRefresh").classList.add("active");
    }
    el("token").value = state.token;
    el("layoutMode").value = state.layoutMode;
    el("amountMode").value = state.amountMode;
    el("toggleLabels").textContent = state.labels ? "Labels on" : "Labels off";
    el("load").addEventListener("click", loadJobs);
    el("refresh").addEventListener("click", loadJobs);
    el("autoRefresh").addEventListener("click", setAutoRefresh);
    el("clearFilters").addEventListener("click", () => {
      el("status").value = "";
      el("kind").value = "";
      el("subject").value = "";
      loadJobs();
    });
    el("zoomIn").addEventListener("click", () => zoom(1.18));
    el("zoomOut").addEventListener("click", () => zoom(.82));
    el("fitGraph").addEventListener("click", fitGraph);
    el("clearSelection").addEventListener("click", () => {
      state.selected = null;
      renderGraph();
      renderDetails();
      renderTransferTabs();
    });
    el("layoutMode").addEventListener("change", () => {
      state.layoutMode = el("layoutMode").value;
      localStorage.setItem("adminForensicsLayout", state.layoutMode);
      renderGraph();
      fitGraph();
    });
    el("amountMode").addEventListener("change", () => {
      state.amountMode = el("amountMode").value;
      localStorage.setItem("adminForensicsAmountMode", state.amountMode);
      renderGraph();
    });
    el("tabAll").addEventListener("click", () => setTransferTab("all"));
    el("tabSelected").addEventListener("click", () => setTransferTab("selected"));
    el("tabStops").addEventListener("click", () => setTransferTab("stops"));
    el("toggleLabels").addEventListener("click", () => {
      state.labels = !state.labels;
      localStorage.setItem("adminForensicsLabels", state.labels ? "on" : "off");
      el("toggleLabels").textContent = state.labels ? "Labels on" : "Labels off";
      renderGraph();
    });
    el("graphSearch").addEventListener("input", () => {
      state.graphSearch = el("graphSearch").value.trim().toLowerCase();
      renderGraph();
    });
    initPanZoom();
    renderTransferTabs();
    el("sessionState").textContent = state.token ? "session active" : "token missing";
    if (state.token) loadJobs();
  </script>
</body>
</html>`;
}
