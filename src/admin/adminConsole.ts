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
    .content.graph-first-content {
      min-height: 0;
      display: block;
    }
    .graph-workspace {
      --left-rail-width: 330px;
      --right-rail-width: 380px;
      --rail-gap: 12px;
      position: relative;
      height: calc(100dvh - 56px);
      min-height: 0;
      overflow: hidden;
      background:
        radial-gradient(circle at 50% 42%, rgba(122, 162, 247, .12), transparent 34%),
        linear-gradient(rgba(255, 255, 255, .035) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255, 255, 255, .035) 1px, transparent 1px),
        #080b0f;
      background-size: auto, 72px 72px, 72px 72px, auto;
    }
    .graph-topbar {
      position: absolute;
      top: 12px;
      left: calc(var(--left-rail-width) + 24px);
      right: calc(var(--right-rail-width) + 24px);
      z-index: 4;
      display: grid;
      grid-template-columns: minmax(260px, 1fr) minmax(220px, 320px);
      gap: 10px;
      align-items: center;
      pointer-events: none;
    }
    .graph-topbar > *, .graph-action-row > *, .graph-tool-rail > *, .timeline-panel > *, .transfer-panel > *, .overlay-panel > * { pointer-events: auto; }
    .active-job-summary, .graph-meta, .timeline-panel {
      border: 1px solid rgba(58, 67, 77, .82);
      border-radius: 8px;
      background: rgba(13, 17, 22, .86);
      box-shadow: 0 18px 45px rgba(0, 0, 0, .24);
      backdrop-filter: blur(10px);
    }
    .active-job-summary { padding: 10px 12px; display: grid; gap: 4px; }
    .active-job-summary strong { font-size: 13px; overflow-wrap: anywhere; }
    .graph-topbar input { width: 100%; background: rgba(12, 15, 18, .92); }
    .graph-action-row {
      position: absolute;
      top: 64px;
      left: calc(var(--left-rail-width) + 24px);
      right: calc(var(--right-rail-width) + 24px);
      z-index: 4;
      min-height: 40px;
      display: grid;
      grid-template-columns: auto minmax(8px, 1fr) auto;
      gap: 10px;
      align-items: center;
      pointer-events: none;
      border: 1px solid rgba(58, 67, 77, .82);
      border-radius: 8px;
      background: rgba(13, 17, 22, .86);
      box-shadow: 0 18px 45px rgba(0, 0, 0, .24);
      backdrop-filter: blur(10px);
      padding: 5px 8px;
    }
    .graph-control-group {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: nowrap;
      min-width: 0;
    }
    .graph-action-row button, .graph-action-row select {
      height: 30px;
      padding: 0 10px;
      background: rgba(12, 15, 18, .92);
      white-space: nowrap;
    }
    .graph-action-row #amountMode { width: 165px; }
    .graph-action-row #flowMode { width: 140px; }
    .graph-action-row .graph-meta {
      grid-column: 3;
      min-height: 30px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 6px;
      flex-wrap: nowrap;
      border: 0;
      background: transparent;
      box-shadow: none;
      backdrop-filter: none;
    }
    .overlay-panel {
      position: absolute;
      z-index: 5;
      top: 116px;
      width: min(390px, calc(100vw - 24px));
      max-height: calc(100dvh - 132px);
      display: none;
      overflow: hidden;
      border: 1px solid rgba(58, 67, 77, .88);
      border-radius: 8px;
      background: rgba(21, 25, 29, .94);
      box-shadow: 0 22px 60px rgba(0, 0, 0, .36);
      backdrop-filter: blur(12px);
    }
    .overlay-panel.open { display: grid; grid-template-rows: auto minmax(0, 1fr); }
    .overlay-panel.jobs-panel { left: 12px; width: var(--left-rail-width); }
    .overlay-panel.analytics-panel { right: 12px; width: var(--right-rail-width); }
    .overlay-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 11px 12px;
      border-bottom: 1px solid var(--line);
    }
    .overlay-head h2 { margin: 0; font-size: 14px; }
    .overlay-body { min-height: 0; overflow: auto; }
    .analytics-body {
      display: grid;
      gap: 10px;
      align-content: start;
      padding: 12px;
    }
    .analytics-body .details-body {
      padding: 0;
    }
    .selection-card.analytics-selection-card {
      position: static;
      width: 100%;
      display: none;
      border: 1px solid #28364a;
      border-radius: 8px;
      background: rgba(12, 17, 25, .94);
      box-shadow: none;
      padding: 12px;
    }
    .selection-card.analytics-selection-card.open { display: block; }
    .selection-card h3 { margin: 0 0 8px; font-size: 14px; }
    .selection-card .card-line { display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; border-top: 1px solid rgba(42, 48, 54, .7); font-size: 12px; }
    .selection-card .card-line:first-of-type { border-top: 0; }
    .selection-card .card-line strong { min-width: 0; text-align: right; overflow-wrap: anywhere; }
    .selection-card .card-note { margin-top: 8px; color: var(--muted); font-size: 12px; line-height: 1.45; }
    .compact-section-head {
      position: static;
      padding: 12px;
      border-bottom: 1px solid var(--line);
      background: rgba(21, 25, 29, .82);
    }
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
    .graph-tool-rail {
      position: absolute;
      top: 136px;
      right: 12px;
      z-index: 4;
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: none;
    }
    .graph-tool-rail button { min-width: 38px; background: rgba(12, 15, 18, .92); }
    .icon-btn { min-width: 36px; padding: 8px 9px; }
    .graph-meta { min-height: 40px; padding: 8px; display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
    .graph-stage {
      position: absolute;
      inset: 0;
      min-width: 0;
      overflow: hidden;
    }
    .timeline-panel {
      position: absolute;
      left: 12px;
      right: 12px;
      bottom: 12px;
      z-index: 4;
      padding: 10px 12px;
    }
    .timeline-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      margin-bottom: 8px;
    }
    .activity-timeline { height: 54px; display: flex; align-items: end; gap: 4px; overflow: hidden; }
    .activity-timeline .timeline-bar { flex: 1 1 10px; min-width: 6px; padding: 0; border: 0; align-self: end; border-radius: 3px 3px 0 0; background: linear-gradient(180deg, var(--accent), var(--bridge)); }
    .activity-timeline .timeline-bar.active { outline: 2px solid rgba(237, 241, 244, .88); outline-offset: 1px; }
    .transfer-panel {
      position: absolute;
      left: 12px;
      right: 12px;
      bottom: 96px;
      z-index: 5;
      height: min(320px, calc(100dvh - 220px));
      border: 1px solid rgba(58, 67, 77, .88);
      border-radius: 8px;
      background: rgba(17, 22, 27, .96);
      overflow: hidden;
      box-shadow: 0 22px 60px rgba(0, 0, 0, .36);
      backdrop-filter: blur(12px);
    }
    .transfer-panel.collapsed { display: none; }
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
      fill: none;
      stroke: #87919b;
      opacity: .88;
      cursor: pointer;
      vector-effect: non-scaling-stroke;
      stroke-linecap: round;
    }
    .edge-flow-incoming { stroke: #62d28f; }
    .edge-flow-outgoing { stroke: #ff5966; }
    .edge-flow-context { stroke: #8d97a8; stroke-dasharray: 7 9; opacity: .52; }
    .edge-flow-service { stroke: #ffd36b; }
    .edge-flow-self { stroke: #8d97a8; }
    .edge-flow-stop { stroke: #f6c177; stroke-dasharray: 4 7; }
    .edge.risk, .edge.decline { stroke: var(--bad); }
    .edge.review { stroke: var(--warn); }
    .edge.clean, .edge.acceptable { stroke: var(--good); }
    .edge.dim, .node.dim { opacity: .16; }
    .edge.selected { opacity: 1; filter: drop-shadow(0 0 8px rgba(122, 162, 247, .42)); }
    .edge-group { cursor: pointer; }
    .amount-pill rect { fill: rgba(11, 14, 17, .94); stroke: rgba(217, 230, 242, .28); stroke-width: 1; rx: 5; vector-effect: non-scaling-stroke; }
    .amount-pill text { fill: #edf4fb; font-size: 10.5px; font-weight: 650; paint-order: stroke; stroke: rgba(11, 14, 17, .65); stroke-width: 1.8px; stroke-linejoin: round; }
    .amount-pill .time-line { fill: #f6c177; font-size: 9.5px; font-weight: 700; }
    .stop-badge rect { fill: rgba(246, 193, 119, .95); stroke: #0b0e11; stroke-width: 1.5; rx: 4; vector-effect: non-scaling-stroke; }
    .stop-badge text { fill: #0b0e11; font-size: 9.5px; font-weight: 750; letter-spacing: 0; stroke: none; }
    .node { cursor: pointer; }
    .node circle { fill: #303846; stroke-width: 2.2; vector-effect: non-scaling-stroke; filter: drop-shadow(0 8px 8px rgba(0, 0, 0, .36)); }
    .node.selected circle { stroke-width: 4; filter: drop-shadow(0 0 10px rgba(122, 162, 247, .5)); }
    .node-display-subject_wallet circle { fill: #171f31; stroke: var(--accent); stroke-width: 3.4; }
    .node-display-wallet circle { fill: #303846; stroke: #788394; }
    .node-display-cex circle { fill: #473131; stroke: var(--cex); }
    .node-display-bridge circle { fill: #133c72; stroke: #5aa7ff; }
    .node-display-smart_contract circle,
    .node-display-contract_adapter circle,
    .node-display-contract_router circle,
    .node-display-dex_contract circle { fill: #312845; stroke: var(--contract); }
    .node-display-service_boundary circle { fill: #3d3422; stroke: var(--warn); }
    .node-display-trace_stop circle { fill: #3d3422; stroke: var(--warn); stroke-dasharray: 4 5; }
    .node-display-funding_bundle circle { fill: #322843; stroke: var(--bundle); }
    .node text { font-size: 11.5px; font-weight: 650; fill: var(--text); paint-order: stroke; stroke: #0b0e11; stroke-width: 2px; stroke-linejoin: round; }
    .node .stop-badge text { paint-order: normal; stroke: transparent; stroke-width: 0; fill: #0b0e11; }
    .service-glyph { fill: #fff; font-size: 12px; font-weight: 800; pointer-events: none; paint-order: normal; stroke: transparent; stroke-width: 0; }
    .node-label-hidden .node-label { display: none; }
    .details { display: none; }
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
    .compat-hidden { display: none; }
    @media (max-width: 1680px) {
      .graph-action-row {
        grid-template-columns: minmax(0, 1fr);
      }
      .graph-control-group { flex-wrap: wrap; }
      .graph-action-row .graph-meta {
        grid-column: 1;
        justify-content: flex-start;
        flex-wrap: wrap;
      }
    }
    @media (max-width: 1440px) {
      body { overflow: auto; }
      .shell { height: auto; min-height: 100dvh; }
      .graph-workspace {
        --left-rail-width: min(330px, calc(100vw - 24px));
        --right-rail-width: min(380px, calc(100vw - 24px));
        min-height: 980px;
        height: calc(100dvh - 56px);
      }
      .graph-topbar {
        left: 12px;
        right: 12px;
        grid-template-columns: 1fr;
      }
      .graph-action-row {
        top: 128px;
        left: 12px;
        right: 12px;
        grid-template-columns: minmax(0, 1fr);
      }
      .graph-control-group { flex-wrap: wrap; }
      .graph-action-row .graph-meta {
        grid-column: 1;
        justify-content: flex-start;
        flex-wrap: wrap;
      }
      .overlay-panel { top: 224px; max-height: 360px; }
      .overlay-panel.jobs-panel { left: 12px; right: auto; }
      .overlay-panel.analytics-panel { left: 12px; right: auto; }
      .overlay-panel.analytics-panel { top: calc(224px + 372px); }
      .graph-tool-rail { top: 224px; }
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
    <section class="content graph-first-content" data-graph-first-shell>
      <section class="graph-workspace">
        <div class="graph-topbar">
          <div id="activeJobSummary" class="active-job-summary">
            <strong>Case brief</strong>
            <div class="hint" id="selectionHint">Select a completed or partial job.</div>
          </div>
          <input id="graphSearch" placeholder="find node / tx / label">
        </div>
        <div class="graph-action-row">
          <div class="graph-control-group">
            <button id="toggleJobs" type="button">Jobs</button>
            <button id="toggleAnalytics" type="button">Analytics</button>
            <select id="flowMode">
              <option value="all">All flows</option>
              <option value="incoming">Incoming</option>
              <option value="outgoing">Outgoing</option>
              <option value="self">Self</option>
            </select>
            <select id="amountMode">
              <option value="important">Amounts: important</option>
              <option value="all">Amounts: all</option>
              <option value="off">Amounts: off</option>
            </select>
            <button id="servicesMode" type="button">Services on</button>
            <button id="toolResetLayout" type="button">Reset layout</button>
          </div>
          <div id="graphStats" class="graph-meta"></div>
        </div>
        <aside id="jobsPanel" class="overlay-panel jobs-panel open" data-overlay="jobs">
          <div class="overlay-head">
            <h2>Jobs</h2>
            <button id="closeJobs" class="icon-btn" type="button" title="Close jobs">x</button>
          </div>
          <div class="overlay-body">
            <div class="compact-section-head">
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
                  <option value="address_fast_check">address fast</option>
                  <option value="where_is_money_check">where-is-money</option>
                  <option value="address_deep_check">address deep</option>
                  <option value="incoming_deposit_check">incoming deposit</option>
                </select>
                <input id="subject" class="wide" placeholder="job id / address / tx hash / watched wallet">
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
          </div>
        </aside>
        <aside id="caseBriefPanel" class="overlay-panel analytics-panel open" data-overlay="analytics">
          <div class="overlay-head">
            <h2>Analytics</h2>
            <button id="closeAnalytics" class="icon-btn" type="button" title="Close analytics">x</button>
          </div>
          <div class="overlay-body analytics-body">
            <div class="selection-card analytics-selection-card" id="selectionCard"></div>
            <div id="caseBrief" class="details-body empty">Select a completed or partial job.</div>
          </div>
        </aside>
        <div class="graph-tool-rail">
          <button id="toolFitGraph" class="icon-btn" type="button" title="Fit graph">Fit</button>
          <button id="zoomIn" class="icon-btn" type="button" title="Zoom in">+</button>
          <button id="zoomOut" class="icon-btn" type="button" title="Zoom out">-</button>
          <button id="toolToggleLabels" class="icon-btn" type="button" title="Toggle labels">Aa</button>
          <button id="toolResetView" class="icon-btn" type="button" title="Reset view">Reset</button>
          <button id="clearSelection" class="icon-btn" type="button" title="Clear selection">Clear selection</button>
        </div>
        <section class="graph-stage">
          <svg id="graph" role="img" aria-label="Forensics graph"></svg>
        </section>
        <section class="transfer-panel collapsed" data-transfer-drawer data-transfer-tabs>
          <div class="tabbar">
            <button id="tabAll" class="active" type="button">All transfers</button>
            <button id="tabSelected" type="button">Selected path</button>
            <button id="tabStops" type="button">Boundary stops</button>
          </div>
          <div id="transferTable" class="transfer-table"></div>
        </section>
        <section class="timeline-panel">
          <div class="timeline-head">
            <div>
              <strong>Activity timeline</strong>
              <div class="hint" id="timelineHint">Select a graph to inspect transfers.</div>
            </div>
            <button id="toggleTransfers" type="button">Transfers</button>
          </div>
          <div id="activityTimeline" class="activity-timeline"></div>
        </section>
        <select id="layoutMode" class="compat-hidden">
          <option value="layers">layers</option>
        </select>
        <button id="toggleLabels" class="compat-hidden" type="button">Labels on</button>
        <button id="fitGraph" class="compat-hidden" type="button">Fit</button>
        <aside class="details" aria-hidden="true">
          <div id="details" class="details-body empty">Select a completed or partial job.</div>
        </aside>
      </section>
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
      analyticsOpen: true,
      jobsOpen: true,
      transfersOpen: false,
      flowMode: localStorage.getItem("adminForensicsFlowMode") || "all",
      servicesVisible: localStorage.getItem("adminForensicsServices") !== "off",
      timelineRange: null,
      autoTimer: null,
      graphSearch: "",
      jobsRequestSeq: 0,
      graphRequestSeq: 0,
      jobsSearchTimer: null,
      pendingOpenJobId: null,
      nodeDrag: null,
      suppressNextGraphClick: false,
      suppressGraphClickTimer: null,
      renderedNodePositions: new Map()
    };
    if (!["all", "incoming", "outgoing", "self"].includes(state.flowMode)) state.flowMode = "all";
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
    const transferEdges = () => graphEdges(state.graph).filter((edge) => edge?.type !== "stop" && edgeDisplayRole(edge) !== "stop");
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
    function setOverlay(name, open) {
      if (name === "analytics") state.analyticsOpen = open;
      if (name === "jobs") state.jobsOpen = open;
      syncGraphFirstControls();
    }
    function setTransferDrawer(open) {
      state.transfersOpen = open;
      syncGraphFirstControls();
    }
    function syncGraphFirstControls() {
      const analyticsPanel = el("caseBriefPanel");
      const jobsPanel = el("jobsPanel");
      const transferPanel = document.querySelector("[data-transfer-drawer]");
      if (analyticsPanel) analyticsPanel.classList.toggle("open", state.analyticsOpen);
      if (jobsPanel) jobsPanel.classList.toggle("open", state.jobsOpen);
      if (transferPanel) transferPanel.classList.toggle("collapsed", !state.transfersOpen);
      el("toggleAnalytics").classList.toggle("active", state.analyticsOpen);
      el("toggleJobs").classList.toggle("active", state.jobsOpen);
      el("toggleTransfers").classList.toggle("active", state.transfersOpen);
      el("toolToggleLabels").classList.toggle("active", state.labels);
      el("toolToggleLabels").textContent = state.labels ? "Aa" : "A-";
      el("toggleLabels").textContent = state.labels ? "Labels on" : "Labels off";
      el("flowMode").value = state.flowMode;
      el("servicesMode").classList.toggle("active", state.servicesVisible);
      el("servicesMode").textContent = state.servicesVisible ? "Services on" : "Services off";
    }
    function clearGraphState() {
      state.graph = null;
      state.selected = null;
      state.activeJobId = null;
      state.timelineRange = null;
      state.transform = { x: 0, y: 0, scale: 1 };
      state.renderedNodePositions = new Map();
    }
    function renderCaseBrief() {
      const root = el("caseBrief");
      const summaryRoot = el("activeJobSummary");
      const graph = state.graph;
      if (!graph) {
        root.className = "overlay-body details-body empty";
        root.innerHTML = "Select a completed or partial job.";
        summaryRoot.innerHTML = '<strong>Case brief</strong><div class="hint" id="selectionHint">Select a completed or partial job.</div>';
        return;
      }
      root.className = "overlay-body details-body";
      const subject = graphSubject(graph);
      const summary = graphSummary(graph);
      const activeJob = state.jobs.find((job) => job.id === state.activeJobId) || graph.job;
      const jobKind = graph.job?.kind || activeJob?.kind || "unknown";
      const jobStatus = graph.job?.status || activeJob?.status || "unknown";
      const selectedLine = state.selected
        ? state.selected.type + ": " + state.selected.id
        : "graph summary";
      summaryRoot.innerHTML = '<strong>' + escapeHtml(short(subject.address || state.activeJobId || "Case brief", 12) + " - " + short(jobKind, 12)) + '</strong>' +
        '<div class="hint" id="selectionHint">' + escapeHtml(selectedLine) + '</div>';
      root.innerHTML = '<div class="metric-grid">' +
        metricHtml("Subject", addressDetailLink(subject.address || "unknown"), "wide") +
        metric("Job", jobKind + " / " + jobStatus, "wide") +
        metric("Risk", (summary.riskScore ?? "n/a") + " / " + (summary.riskLevel ?? "unknown")) +
        metric("Decision", summary.decision || "UNKNOWN") +
        metric("Mode", caseBriefModeLine(graph), "wide") +
        listMetric("Top incoming", caseBriefTopIncoming(), "No incoming profile edges.") +
        listMetric("Top outgoing", caseBriefTopOutgoing(), "No outgoing profile edges.") +
        listMetric("Top services", caseBriefTopServices(), "No service nodes.") +
        metric("Boundary stops", String(caseBriefStopCount())) +
        listMetric("Projection gaps", projectionGapLines(graph), "No projection gaps stored.") +
        '</div>';
    }
    function briefEdgeAmountValue(edge) {
      const raw = rawBigInt(edge?.metadata?.usedAmountRaw || edge?.amountRaw || edge?.metadata?.originalAmountRaw || edge?.metadata?.amountRaw);
      return raw === null ? 0 : Number(raw > 9007199254740991n ? 9007199254740991n : raw);
    }
    function formatBriefEdge(edge) {
      const amount = edgeCanvasAmountLabel(edge) || edgeDetailedAmountLabel(edge) || "amount n/a";
      const address = edgeFlowDirection(edge) === "incoming" ? edgeFromAddress(edge) : edgeToAddress(edge);
      return amount + " - " + short(address, 7);
    }
    function caseBriefTopIncoming() {
      return filteredTransferEdges()
        .filter((edge) => edgeFlowDirection(edge) === "incoming")
        .sort((a, b) => briefEdgeAmountValue(b) - briefEdgeAmountValue(a))
        .slice(0, 5)
        .map(formatBriefEdge);
    }
    function caseBriefTopOutgoing() {
      return filteredTransferEdges()
        .filter((edge) => edgeFlowDirection(edge) === "outgoing")
        .sort((a, b) => briefEdgeAmountValue(b) - briefEdgeAmountValue(a))
        .slice(0, 5)
        .map(formatBriefEdge);
    }
    function caseBriefTopServices() {
      return graphNodes(state.graph)
        .filter(nodeIsServiceLike)
        .slice(0, 8)
        .map((node) => canvasNodeLabel(node) + " - " + short(nodeAddress(node) || node.id, 6));
    }
    function caseBriefStopCount() {
      return graphPaths(state.graph).filter((path) => path.stopReason).length;
    }
    function caseBriefModeLine(graph) {
      if (graph?.job?.kind === "address_deep_check") return "Profile/context graph. This is not money-origin proof.";
      if (graph?.job?.kind === "where_is_money_check") return "Money-origin trace.";
      if (graph?.job?.kind === "incoming_deposit_check") return "Deposit-origin trace.";
      if (graph?.job?.kind === "address_fast_check") return "Fast direct-neighborhood profile.";
      return projectionMode(graph);
    }
    function edgeTimestampMs(edge) {
      const value = edge?.timestamp || edge?.timestampIso || edge?.time || edge?.metadata?.timestamp || edge?.metadata?.timestampIso || edge?.metadata?.time;
      if (!value) return null;
      const date = new Date(value);
      return Number.isFinite(date.getTime()) ? date.getTime() : null;
    }
    function timelineAmountValue(edge) {
      const raw = rawBigInt(edge?.metadata?.usedAmountRaw || edge?.amountRaw || edge?.metadata?.amountRaw || edge?.metadata?.originalAmountRaw);
      return raw === null ? 0 : Number(raw > 9007199254740991n ? 9007199254740991n : raw);
    }
    function timelineSourceTransferEdges() {
      return transferEdges().filter((edge) => edgePassesFlowFilter(edge) && edgePassesServiceFilter(edge));
    }
    function activityTimelineBuckets(edges, bucketCount = 32) {
      const dated = edges
        .map((edge) => ({ edge, timestamp: edgeTimestampMs(edge) }))
        .filter((item) => item.timestamp !== null);
      if (dated.length === 0) return [];
      const min = Math.min(...dated.map((item) => item.timestamp));
      const max = Math.max(...dated.map((item) => item.timestamp));
      const span = Math.max(1, max - min);
      const buckets = Array.from({ length: bucketCount }, (_, index) => ({
        index,
        start: min + span * index / bucketCount,
        end: min + span * (index + 1) / bucketCount,
        isLast: index === bucketCount - 1,
        count: 0,
        amount: 0
      }));
      dated.forEach((item) => {
        const index = Math.min(bucketCount - 1, Math.floor(((item.timestamp - min) / span) * bucketCount));
        const bucket = buckets[index];
        bucket.count += 1;
        bucket.amount += timelineAmountValue(item.edge);
      });
      return buckets;
    }
    function selectedTimelineBucket() {
      if (!state.timelineRange) return null;
      return state.timelineRange;
    }
    function edgePassesTimelineRange(edge) {
      const range = selectedTimelineBucket();
      if (!range) return true;
      const timestamp = edgeTimestampMs(edge);
      if (timestamp === null) return false;
      if (timestamp < range.start) return false;
      return range.isLast ? timestamp <= range.end : timestamp < range.end;
    }
    function filteredTransferEdges() {
      return timelineSourceTransferEdges().filter(edgePassesTimelineRange);
    }
    function selectTimelineBucket(index) {
      const buckets = activityTimelineBuckets(timelineSourceTransferEdges());
      const bucket = buckets[index];
      state.timelineRange = bucket && state.timelineRange?.index !== index ? { start: bucket.start, end: bucket.end, index, isLast: bucket.isLast } : null;
      reconcileSelectionWithFilters();
      renderGraph();
      renderCaseBrief();
      renderDetails();
      renderSelectionCard();
      renderActivityTimeline();
      renderTransferTabs();
    }
    function renderActivityTimeline() {
      const root = el("activityTimeline");
      const hint = el("timelineHint");
      if (!state.graph) {
        root.innerHTML = "";
        hint.textContent = "Select a graph to inspect activity.";
        return;
      }
      const buckets = activityTimelineBuckets(timelineSourceTransferEdges());
      if (buckets.length === 0) {
        root.innerHTML = "";
        hint.textContent = "No timestamped transfer activity in this graph.";
        return;
      }
      const maxValue = Math.max(1, ...buckets.map((bucket) => bucket.amount || bucket.count));
      root.innerHTML = buckets.map((bucket) => {
        const value = bucket.amount || bucket.count;
        const height = bucket.count === 0 ? 4 : Math.max(8, Math.round((value / maxValue) * 48));
        const active = state.timelineRange?.index === bucket.index ? " active" : "";
        const title = new Date(bucket.start).toISOString() + " / " + bucket.count + " transfer" + (bucket.count === 1 ? "" : "s");
        return '<button type="button" class="timeline-bar' + active + '" data-timeline-index="' + bucket.index + '" style="height:' + height + 'px" title="' + escapeHtml(title) + '"></button>';
      }).join("");
      root.querySelectorAll("[data-timeline-index]").forEach((button) => {
        button.addEventListener("click", () => selectTimelineBucket(Number(button.getAttribute("data-timeline-index"))));
      });
      if (state.timelineRange) {
        hint.textContent = "Timeline filter: " + new Date(state.timelineRange.start).toISOString() + " to " + new Date(state.timelineRange.end).toISOString() + ".";
      } else {
        const count = timelineSourceTransferEdges().length;
        hint.textContent = count + " transfer" + (count === 1 ? "" : "s") + " available; click a bucket to filter.";
      }
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
        const searchContext = [
          job.watchedWallet ? "wallet " + short(job.watchedWallet, 8) : "",
          job.sender ? "sender " + short(job.sender, 8) : "",
          job.depositTxHash ? "tx " + short(job.depositTxHash, 8) : ""
        ].filter(Boolean).join(" · ");
        return '<button type="button" class="job' + active + '" data-job-id="' + escapeHtml(job.id) + '">' +
          '<div class="job-title"><strong>' + escapeHtml(short(job.subjectAddress, 10)) + '</strong><span class="' + classifyStatus(job.status) + '">' + escapeHtml(job.status) + '</span></div>' +
          '<span>' + escapeHtml(job.kind) + '</span>' +
          (searchContext ? '<span>' + escapeHtml(searchContext) + '</span>' : '') +
          '<span>requested by ' + escapeHtml(requester) + '</span>' +
          '<span>' + escapeHtml(iso(job.completedAt || job.updatedAt || job.createdAt)) + '</span>' +
          '<span>' + escapeHtml(job.id) + '</span>' +
          '</button>';
      }).join("");
      root.querySelectorAll("[data-job-id]").forEach((button) => button.addEventListener("click", () => loadGraph(button.getAttribute("data-job-id"))));
    }
    async function loadJobs() {
      const requestSeq = ++state.jobsRequestSeq;
      state.token = el("token").value.trim();
      localStorage.setItem("adminForensicsToken", state.token);
      el("sessionState").textContent = state.token ? "session active" : "token missing";
      const params = new URLSearchParams();
      if (el("status").value) params.set("status", el("status").value);
      if (el("kind").value) params.set("kind", el("kind").value);
      if (el("subject").value.trim()) params.set("query", el("subject").value.trim());
      params.set("limit", el("limit").value || "50");
      try {
        setStatus("Loading jobs...");
        const body = await api("/admin/api/forensic-jobs?" + params.toString());
        if (requestSeq !== state.jobsRequestSeq) return;
        state.jobs = asArray(body.jobs);
        if (!state.jobs.some((job) => job.id === state.activeJobId)) {
          state.graph = null;
          state.selected = null;
          state.activeJobId = null;
        }
        renderJobs();
        renderGraph();
        renderCaseBrief();
        renderActivityTimeline();
        syncGraphFirstControls();
        renderDetails();
        renderSelectionCard();
        renderTransferTabs();
        setStatus(state.jobs.length + " jobs loaded.");
        const pendingJob = state.pendingOpenJobId
          ? state.jobs.find((job) => job.id === state.pendingOpenJobId)
          : state.jobs.length === 1 ? state.jobs[0] : null;
        if (pendingJob && state.activeJobId !== pendingJob.id) {
          state.pendingOpenJobId = null;
          loadGraph(pendingJob.id);
        }
      } catch (error) {
        if (requestSeq !== state.jobsRequestSeq) return;
        clearGraphState();
        renderGraph();
        renderCaseBrief();
        renderActivityTimeline();
        renderDetails();
        renderSelectionCard();
        renderTransferTabs();
        syncGraphFirstControls();
        el("jobs").innerHTML = '<div class="error">' + escapeHtml(error.message) + '<div class="hint">The local default token is already filled. If ADMIN_DASHBOARD_TOKEN differs, replace it once and press Load.</div></div>';
        setStatus("Job list failed.");
      }
    }
    function scheduleLoadJobs(delay = 350) {
      if (state.jobsSearchTimer) clearTimeout(state.jobsSearchTimer);
      state.jobsSearchTimer = setTimeout(() => {
        state.jobsSearchTimer = null;
        loadJobs();
      }, delay);
    }
    function setSelectFromUrl(id, value) {
      if (!value) return;
      const select = el(id);
      const options = Array.from(select.options || []);
      if (options.some((option) => option.value === value)) select.value = value;
    }
    function applyInitialUrlFilters() {
      const params = new URLSearchParams(window.location.search);
      const query = params.get("query") || params.get("q") || params.get("subjectAddress") || "";
      if (query) el("subject").value = query;
      setSelectFromUrl("status", params.get("status") || "");
      setSelectFromUrl("kind", params.get("kind") || "");
      setSelectFromUrl("limit", params.get("limit") || "");
      const jobId = params.get("jobId") || params.get("job") || "";
      if (jobId) state.pendingOpenJobId = jobId;
    }
    async function loadGraph(jobId) {
      if (!jobId) return;
      const requestSeq = ++state.graphRequestSeq;
      try {
        setStatus("Loading graph...");
        const body = await api("/admin/api/forensic-jobs/" + encodeURIComponent(jobId) + "/graph");
        if (requestSeq !== state.graphRequestSeq) return;
        state.graph = body.graph;
        state.selected = null;
        state.activeJobId = jobId;
        state.timelineRange = null;
        state.transform = { x: 0, y: 0, scale: 1 };
        renderJobs();
        renderGraph();
        renderCaseBrief();
        renderActivityTimeline();
        fitGraph();
        renderDetails();
        renderSelectionCard();
        renderTransferTabs();
        setStatus("Graph loaded. Wheel to zoom, drag to pan.");
      } catch (error) {
        if (requestSeq !== state.graphRequestSeq) return;
        const message = error?.message || "Graph request failed";
        clearGraphState();
        renderJobs();
        renderGraph();
        renderCaseBrief();
        renderActivityTimeline();
        renderDetails();
        renderSelectionCard();
        renderTransferTabs();
        syncGraphFirstControls();
        el("details").className = "details-body";
        el("details").innerHTML = '<div class="error">' + escapeHtml(message) + '</div>';
        el("caseBrief").className = "overlay-body details-body";
        el("caseBrief").innerHTML = '<div class="error">' + escapeHtml(message) + '</div>';
        setStatus("Graph unavailable for this job.");
      }
    }
    function nodeLayoutSide(node, subjectId, edges) {
      if (node.id === subjectId) return "subject";
      if (nodeIsServiceLike(node)) return "service";
      const incoming = edges.some((edge) => edge.toNodeId === subjectId && edge.fromNodeId === node.id);
      const outgoing = edges.some((edge) => edge.fromNodeId === subjectId && edge.toNodeId === node.id);
      if (incoming && !outgoing) return "incoming";
      if (outgoing && !incoming) return "outgoing";
      if (incoming && outgoing) return "self";
      return "context";
    }
    function stableNodeSort(a, b) {
      const aWeight = Number(a.weight || a.score || a.metadata?.volumeRaw || 0);
      const bWeight = Number(b.weight || b.score || b.metadata?.volumeRaw || 0);
      if (bWeight !== aWeight) return bWeight - aWeight;
      return String(a.id).localeCompare(String(b.id));
    }
    function arrangeCluster(nodes, centerX, centerY, radiusX, radiusY, startAngle, endAngle) {
      const sorted = [...nodes].sort(stableNodeSort);
      const count = Math.max(1, sorted.length);
      const laneCount = count > 42 ? 5 : count > 24 ? 4 : 3;
      return sorted.map((node, index) => {
        const ratio = count === 1 ? 0.5 : index / (count - 1);
        const angle = startAngle + (endAngle - startAngle) * ratio;
        const ring = 1 + (index % laneCount) * 0.16 + Math.floor(index / laneCount) * 0.015;
        return {
          ...node,
          x: centerX + Math.cos(angle) * radiusX * ring,
          y: centerY + Math.sin(angle) * radiusY * ring
        };
      });
    }
    function relaxNodeCollisions(nodes, fixedNodeIds, iterations = 26) {
      const placed = nodes.map((node) => ({ ...node }));
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        for (let i = 0; i < placed.length; i += 1) {
          for (let j = i + 1; j < placed.length; j += 1) {
            const a = placed[i];
            const b = placed[j];
            const minGap = nodeRadius(a) + nodeRadius(b) + 38;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const distance = Math.sqrt(dx * dx + dy * dy) || 1;
            if (distance >= minGap) continue;
            const push = (minGap - distance) / 2;
            const ux = dx / distance;
            const uy = dy / distance;
            const aFixed = fixedNodeIds.has(a.id);
            const bFixed = fixedNodeIds.has(b.id);
            if (!aFixed) {
              a.x -= ux * (bFixed ? push * 2 : push);
              a.y -= uy * (bFixed ? push * 2 : push);
            }
            if (!bFixed) {
              b.x += ux * (aFixed ? push * 2 : push);
              b.y += uy * (aFixed ? push * 2 : push);
            }
          }
        }
      }
      return placed;
    }
    function clampLayoutValue(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }
    function constrainLayoutNodes(nodes, width, height, fixedNodeIds) {
      return nodes.map((node) => {
        if (fixedNodeIds.has(node.id)) return node;
        const radius = nodeRadius(node);
        const xPadding = radius + 128;
        const yPadding = radius + 58;
        return {
          ...node,
          x: clampLayoutValue(node.x, xPadding, width - xPadding),
          y: clampLayoutValue(node.y, yPadding, height - yPadding)
        };
      });
    }
    function graphFirstLayout(sourceNodes, sourceEdges) {
      const width = 1700;
      const height = 1040;
      if (sourceNodes.length === 0) return { width, height, nodes: [], byId: new Map() };
      const subjectId = sourceNodes.find((node) => node.kind === "subject")?.id || sourceNodes[0]?.id;
      const subjectX = width * 0.52;
      const subjectY = height * 0.47;
      const subject = sourceNodes.find((node) => node.id === subjectId) || sourceNodes[0];
      const incomingNodes = [];
      const outgoingNodes = [];
      const serviceNodes = [];
      const contextNodes = [];
      sourceNodes.forEach((node) => {
        if (node.id === subjectId) return;
        const side = nodeLayoutSide(node, subjectId, sourceEdges);
        if (side === "incoming") incomingNodes.push(node);
        else if (side === "outgoing") outgoingNodes.push(node);
        else if (side === "service") serviceNodes.push(node);
        else contextNodes.push(node);
      });
      const nodes = [
        { ...subject, x: subjectX, y: subjectY },
        ...arrangeCluster(incomingNodes, width * 0.25, subjectY, 290, 350, -1.38, 1.38),
        ...arrangeCluster(outgoingNodes, width * 0.80, subjectY, 305, 365, -1.72, 1.62),
        ...arrangeCluster(serviceNodes, width * 0.60, subjectY + 170, 470, 230, -2.85, .30),
        ...arrangeCluster(contextNodes, width * 0.52, subjectY + 285, 410, 210, -2.82, -.32)
      ];
      const fixedNodeIds = new Set([subjectId]);
      const relaxedNodes = relaxNodeCollisions(nodes, fixedNodeIds);
      const boundedNodes = constrainLayoutNodes(relaxedNodes, width, height, fixedNodeIds);
      const byId = new Map(boundedNodes.map((node) => [node.id, node]));
      return { width, height, nodes: boundedNodes, byId };
    }
    function layout(graph) {
      return graphFirstLayout(graphNodes(graph), graphEdges(graph));
    }
    function nodePositionStorageKey() {
      return state.activeJobId ? "adminForensicsNodePositions:" + state.activeJobId : "";
    }
    function loadNodePositionOverrides() {
      const key = nodePositionStorageKey();
      if (!key) return {};
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || "{}");
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch {
        return {};
      }
    }
    function saveNodePositionOverride(nodeId, x, y) {
      const key = nodePositionStorageKey();
      if (!key || !nodeId || !Number.isFinite(x) || !Number.isFinite(y)) return;
      const overrides = loadNodePositionOverrides();
      overrides[nodeId] = { x, y };
      localStorage.setItem(key, JSON.stringify(overrides));
    }
    function clearNodePositionOverrides() {
      const key = nodePositionStorageKey();
      if (key) localStorage.removeItem(key);
      renderGraph();
    }
    function applyNodePositionOverrides(placed) {
      const overrides = loadNodePositionOverrides();
      const nodes = placed.nodes.map((node) => {
        const override = overrides[node.id];
        if (!override || !Number.isFinite(override.x) || !Number.isFinite(override.y)) return node;
        return { ...node, x: override.x, y: override.y };
      });
      return { ...placed, nodes, byId: new Map(nodes.map((node) => [node.id, node])) };
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
      if (node.kind === "stop" || kind === "trace_stop") return "var(--warn)";
      if (node.riskLevel === "HIGH" || node.riskLevel === "CRITICAL") return "var(--bad)";
      if (kind === "service_boundary") return "var(--warn)";
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
      return node.metadata?.reason || reasons[0] || node.metadata?.lastStopReason || "";
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
      const lines = (Array.isArray(label) ? label : [label])
        .filter((value) => value !== null && value !== undefined && String(value).length > 0)
        .map((value) => String(value));
      if (lines.length === 0) return "";
      const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
      const width = Math.min(166, Math.max(70, longest * 6.2 + 18));
      const height = lines.length > 1 ? 34 : 20;
      const yOffset = lines.length > 1 ? 17 : 10;
      const textLines = lines.slice(0, 2).map((line, index) => {
        const text = line.length > 22 ? line.slice(0, 21) + "..." : line;
        const className = index > 0 ? ' class="time-line"' : "";
        const textY = lines.length > 1 ? 13 + index * 13 : 14;
        return '<text' + className + ' x="' + (width / 2) + '" y="' + textY + '" text-anchor="middle">' + escapeHtml(text) + '</text>';
      }).join("");
      return '<g class="amount-pill" transform="translate(' + (x - width / 2) + ' ' + (y - 10) + ')">' +
        '<title>' + escapeHtml(lines.join(" / ")) + '</title>' +
        '<rect width="' + width + '" height="' + height + '" y="' + (10 - yOffset) + '"></rect>' +
        textLines +
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
    function shortTimestamp(value) {
      if (!value) return "";
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) return "";
      const month = String(date.getUTCMonth() + 1).padStart(2, "0");
      const day = String(date.getUTCDate()).padStart(2, "0");
      const hour = String(date.getUTCHours()).padStart(2, "0");
      const minute = String(date.getUTCMinutes()).padStart(2, "0");
      return month + "-" + day + " " + hour + ":" + minute + "Z";
    }
    function formatDurationMs(value) {
      if (value === null || value === undefined || value === "") return "";
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
    function edgeTimeConnectionLabel(edge) {
      const gap = edgeTxGap(edge);
      if (gap) return "gap " + gap;
      return shortTimestamp(edge?.timestamp || edgeTime(edge));
    }
    function edgePathId(edge) {
      return edge?.pathId || edge?.metadata?.pathId || "";
    }
    function edgeDisplayRole(edge) {
      return edge?.displayRole || "real_transfer";
    }
    function pathFlowDirection(edge, subjectId) {
      const pathId = edgePathId(edge);
      if (!subjectId || (!pathId && !edge?.id)) return null;
      const path = graphPaths(state.graph).find((item) =>
        (pathId && item.id === pathId) || asArray(item.edgeIds).includes(edge.id)
      );
      if (!path) return null;
      const pathEdgeIds = new Set(asArray(path.edgeIds));
      const pathEdges = graphEdges(state.graph).filter((item) =>
        pathEdgeIds.has(item.id) && item.type !== "stop" && edgeDisplayRole(item) !== "stop"
      );
      const hasIncomingSubjectEdge = pathEdges.some((item) => item.toNodeId === subjectId);
      const hasOutgoingSubjectEdge = pathEdges.some((item) => item.fromNodeId === subjectId);
      if (hasIncomingSubjectEdge && !hasOutgoingSubjectEdge) return "incoming";
      if (hasOutgoingSubjectEdge && !hasIncomingSubjectEdge) return "outgoing";
      const pathNodeIds = asArray(path.nodeIds);
      const subjectIndex = pathNodeIds.indexOf(subjectId);
      if (subjectIndex > 0 && subjectIndex < pathNodeIds.length - 1) {
        const fromIndex = pathNodeIds.indexOf(edge?.fromNodeId);
        const toIndex = pathNodeIds.indexOf(edge?.toNodeId);
        if (fromIndex >= 0 && toIndex >= 0) {
          const minEdgeIndex = Math.min(fromIndex, toIndex);
          const maxEdgeIndex = Math.max(fromIndex, toIndex);
          if (maxEdgeIndex <= subjectIndex) return "incoming";
          if (minEdgeIndex >= subjectIndex) return "outgoing";
        }
      }
      if (subjectIndex === 0 || subjectIndex === pathNodeIds.length - 1) {
        return subjectIndex === pathNodeIds.length - 1 ? "incoming" : "outgoing";
      }
      return null;
    }
    function edgeFlowDirection(edge) {
      const metadata = edge?.metadata || {};
      if (metadata?.direction === "inbound" || edge?.direction === "inbound" || edge?.direction === "incoming") return "incoming";
      if (metadata?.direction === "outbound" || edge?.direction === "outbound" || edge?.direction === "outgoing") return "outgoing";
      if (metadata?.direction === "service" || edge?.direction === "service") return "self";
      const subjectId = graphNodes(state.graph).find((node) => node.kind === "subject")?.id || "";
      const pathDirection = pathFlowDirection(edge, subjectId);
      if (pathDirection) return pathDirection;
      if (subjectId && edge?.toNodeId === subjectId) return "incoming";
      if (subjectId && edge?.fromNodeId === subjectId) return "outgoing";
      return "self";
    }
    function edgePassesFlowFilter(edge) {
      if (state.flowMode === "all") return true;
      if (state.flowMode === "incoming") return edgeFlowDirection(edge) === "incoming";
      if (state.flowMode === "outgoing") return edgeFlowDirection(edge) === "outgoing";
      if (state.flowMode === "self") return edgeFlowDirection(edge) === "self";
      return true;
    }
    function nodeIsServiceLike(node) {
      const kind = nodeDisplayKind(node);
      return kind === "bridge" ||
        kind === "cex" ||
        kind === "smart_contract" ||
        kind === "contract_adapter" ||
        kind === "contract_router" ||
        kind === "dex_contract" ||
        kind === "service_boundary";
    }
    function edgePassesServiceFilter(edge) {
      if (state.servicesVisible) return true;
      const from = nodeById(edge?.fromNodeId);
      const to = nodeById(edge?.toNodeId);
      return !nodeIsServiceLike(from) && !nodeIsServiceLike(to);
    }
    function filteredGraphEdges() {
      return graphEdges(state.graph).filter((edge) => edgePassesFlowFilter(edge) && edgePassesServiceFilter(edge) && edgePassesTimelineRange(edge));
    }
    function visibleGraphNodeIds() {
      const ids = new Set();
      const subject = graphNodes(state.graph).find((node) => node.kind === "subject");
      if (subject?.id) ids.add(subject.id);
      filteredGraphEdges().forEach((edge) => {
        if (edge?.fromNodeId) ids.add(edge.fromNodeId);
        if (edge?.toNodeId) ids.add(edge.toNodeId);
      });
      return ids;
    }
    function reconcileSelectionWithFilters() {
      if (!state.selected || !state.graph) return;
      if (state.selected.type === "edge") {
        const selectedEdgeVisible = filteredGraphEdges().some((edge) => edge.id === state.selected.id);
        if (!selectedEdgeVisible) state.selected = null;
        return;
      }
      if (state.selected.type === "node") {
        const selectedNodeVisible = visibleGraphNodeIds().has(state.selected.id);
        if (!selectedNodeVisible) state.selected = null;
      }
    }
    function edgeVisualRole(edge) {
      const role = edgeDisplayRole(edge);
      if (role === "stop") return "stop";
      if (role === "profile_context" || role === "inferred_provenance") return "context";
      const from = nodeById(edge?.fromNodeId);
      const to = nodeById(edge?.toNodeId);
      if (nodeIsServiceLike(from) || nodeIsServiceLike(to)) return "service";
      return edgeFlowDirection(edge);
    }
    function edgeStrokeWidth(edge) {
      const raw = Number(edge?.amountRaw || edge?.metadata?.amountRaw || edge?.weight || 0);
      if (!Number.isFinite(raw) || raw <= 0) return 1.6;
      const scaled = Math.log10(raw + 10) * 0.7;
      return Math.max(1.4, Math.min(8, scaled));
    }
    function edgeCurvePath(startX, startY, endX, endY, edge) {
      const dx = endX - startX;
      const dy = endY - startY;
      const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const curve = edgeFlowDirection(edge) === "incoming" ? -0.18 : 0.18;
      const cx = (startX + endX) / 2 - dy * curve;
      const cy = (startY + endY) / 2 + dx * curve;
      if (distance < 80) return "M " + startX + " " + startY + " L " + endX + " " + endY;
      return "M " + startX + " " + startY + " Q " + cx + " " + cy + " " + endX + " " + endY;
    }
    function nodeVisualClass(node) {
      return "node-display-" + nodeDisplayKind(node);
    }
    function serviceGlyph(node) {
      const kind = nodeDisplayKind(node);
      if (kind === "bridge") return "<>";
      if (kind === "cex") return "CEX";
      if (kind === "dex_contract") return "DEX";
      if (kind === "contract_router") return "R";
      if (kind === "contract_adapter") return "A";
      if (kind === "smart_contract") return "{}";
      return "";
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
    function nodeLabelAttrs(node, placed) {
      const subject = placed.nodes.find((item) => item.kind === "subject") || placed.nodes[0] || { x: 0, y: 0 };
      const radius = nodeRadius(node);
      const dx = node.x - subject.x;
      const dy = node.y - subject.y;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 80) {
        return {
          x: dx > 0 ? radius + 10 : -radius - 10,
          y: 4,
          anchor: dx > 0 ? "start" : "end"
        };
      }
      return {
        x: 0,
        y: dy < 0 ? -radius - 10 : radius + 16,
        anchor: "middle"
      };
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
      const visibleEdges = filteredGraphEdges();
      const connectedNodeIds = new Set();
      visibleEdges.forEach((edge) => {
        if (edge?.fromNodeId) connectedNodeIds.add(edge.fromNodeId);
        if (edge?.toNodeId) connectedNodeIds.add(edge.toNodeId);
      });
      const visibleNodes = graphNodes(graph).filter((node) => node.kind === "subject" || connectedNodeIds.has(node.id));
      const placed = applyNodePositionOverrides(graphFirstLayout(visibleNodes, visibleEdges));
      state.renderedNodePositions = new Map(placed.nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
      svg.setAttribute("viewBox", "0 0 " + placed.width + " " + placed.height);
      svg.classList.toggle("node-label-hidden", !state.labels);
      const grid = Array.from({ length: 15 }, (_, index) => '<path class="grid-line" d="M ' + (index * 100) + ' 0 L ' + (index * 100) + ' 1400 M 0 ' + (index * 100) + ' L 1800 ' + (index * 100) + '"></path>').join("");
      const edgeSvg = visibleEdges.map((edge) => {
        const from = placed.byId.get(edge.fromNodeId);
        const to = placed.byId.get(edge.toNodeId);
        if (!from || !to) return "";
        const selected = state.selected?.type === "edge" && state.selected.id === edge.id;
        const visible = matchesSearch(edge) && (!state.selected || selected || (state.selected.type === "node" && (edge.fromNodeId === state.selected.id || edge.toNodeId === state.selected.id)));
        const visualRole = edgeVisualRole(edge);
        const cls = "edge edge-flow-" + escapeHtml(visualRole) + " " + escapeHtml(edge.verdict) + (selected ? " selected" : "") + (visible ? "" : " dim");
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
        const timeLabel = edgeShouldShowAmount(edge) ? edgeTimeConnectionLabel(edge) : "";
        const label = state.amountMode === "off"
          ? []
          : [shouldShowAmount ? amountLabel : "", timeLabel].filter(Boolean);
        const marker = ' marker-end="url(#edgeArrow)"';
        const pathD = edgeCurvePath(startX, startY, endX, endY, edge);
        return '<g class="edge-group" data-edge-id="' + escapeHtml(edge.id) + '"><path class="' + cls + '" style="stroke-width:' + edgeStrokeWidth(edge) + '" d="' + pathD + '"' + marker + '></path>' +
          amountPill(label, labelX, labelY) + '</g>';
      }).join("");
      const nodeSvg = placed.nodes.map((node) => {
        const selected = state.selected?.type === "node" && state.selected.id === node.id;
        const visible = matchesSearch(node) && isSelectedConnected(node.id);
        const cls = "node node-kind-" + escapeHtml(node.kind || "wallet") + " " + escapeHtml(nodeVisualClass(node)) + (selected ? " selected" : "") + (visible ? "" : " dim");
        const radius = nodeRadius(node);
        const glyph = serviceGlyph(node);
        return '<g class="' + cls + '" data-node-id="' + escapeHtml(node.id) + '" transform="translate(' + node.x + ' ' + node.y + ')">' +
          '<circle r="' + radius + '"></circle>' +
          (glyph ? '<text class="service-glyph" y="4" text-anchor="middle">' + escapeHtml(glyph) + '</text>' : '') +
          stopBadge(node, radius) +
          (() => {
            const label = nodeLabelAttrs(node, placed);
            return '<text class="node-label" x="' + label.x + '" y="' + label.y + '" text-anchor="' + label.anchor + '">' + escapeHtml(canvasNodeLabel(node)) + '</text></g>';
          })();
      }).join("");
      const defs = '<defs><marker id="edgeArrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="userSpaceOnUse"><path class="edge-arrow" fill="#f6c177" opacity=".96" d="M 0 0 L 7 3.5 L 0 7 z"></path></marker></defs>';
      svg.innerHTML = defs + '<g id="graphViewport">' + grid + edgeSvg + nodeSvg + '</g>';
      applyTransform();
      svg.querySelectorAll("[data-node-id]").forEach((node) => {
        node.addEventListener("click", (event) => {
          if (consumeSuppressedGraphClick()) {
            event.stopPropagation();
            return;
          }
          event.stopPropagation();
          selectNode(node.getAttribute("data-node-id"));
        });
        node.addEventListener("mousedown", (event) => startNodeDrag(event, node.getAttribute("data-node-id")));
      });
      svg.querySelectorAll("[data-edge-id]").forEach((edge) => edge.addEventListener("click", (event) => {
        event.stopPropagation();
        selectEdge(edge.getAttribute("data-edge-id"));
      }));
      el("graphStats").innerHTML = [
        ["nodes", placed.nodes.length],
        ["edges", visibleEdges.length],
        ["paths", graphPaths(graph).length],
        ["weights", graphWeights(graph).length]
      ].map(([label, value]) => '<span class="chip">' + label + ': ' + value + '</span>').join("");
    }
    function selectNode(nodeId) {
      state.selected = { type: "node", id: nodeId };
      renderGraph();
      renderCaseBrief();
      renderDetails();
      renderSelectionCard();
      renderTransferTabs();
    }
    function selectEdge(edgeId) {
      state.selected = { type: "edge", id: edgeId };
      renderGraph();
      renderCaseBrief();
      renderDetails();
      renderSelectionCard();
      renderTransferTabs();
    }
    function renderTransferTabs() {
      const root = el("transferTable");
      if (!state.graph) {
        root.innerHTML = '<div class="empty">Select a graph to inspect transfers.</div>';
        return;
      }
      if (state.transferTab === "stops") return renderBoundaryStops(root);
      const filteredEdges = filteredTransferEdges();
      const selected = selectedEdgeIds();
      const edges = state.transferTab === "selected"
        ? filteredEdges.filter((edge) => selected.has(edge.id))
        : filteredEdges;
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
        listMetric("Path timing", pathTimingLines(graph), "No path timing stored.") +
        (graph.job?.kind === "address_fast_check"
          ? listMetric("Fast check scope", ["Fast check graph shows direct counterparties and nearby service boundaries collected during the bounded fast pass."], "") + fastCheckTopMetrics(summary)
          : "") +
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
    function cardLine(label, value) {
      return '<div class="card-line"><span class="muted">' + escapeHtml(label) + '</span><strong>' + escapeHtml(value || "n/a") + '</strong></div>';
    }
    function cardLineHtml(label, html) {
      return '<div class="card-line"><span class="muted">' + escapeHtml(label) + '</span><strong>' + html + '</strong></div>';
    }
    function addressDetailLink(address) {
      const value = address || "n/a";
      return explorerLink(tronscanAddressUrl(value), value);
    }
    function txDetailLink(txHash) {
      const value = txHash || "inferred";
      return explorerLink(tronscanTxUrl(value === "inferred" ? "" : value), value);
    }
    function selectedNodeCard(node) {
      if (!node) return "";
      const type = nodeType(node);
      return '<h3>Selected node</h3>' +
        cardLine("Type", type.label) +
        cardLineHtml("Address", addressDetailLink(nodeAddress(node) || node.id)) +
        cardLine("Label", nodeDisplayLabel(node)) +
        cardLine("Technical type", technicalNodeType(node));
    }
    function selectedEdgeCard(edge) {
      if (!edge) return "";
      const role = edgeDisplayRole(edge);
      const note = role === "profile_context"
        ? '<div class="card-note">This is not money-origin proof. It is behavioral/service exposure context.</div>'
        : "";
      return '<h3>Selected flow</h3>' +
        cardLine("Meaning", edgeMeaning(edge)) +
        cardLine("Direction", edgeDirectionMeaning(edge)) +
        cardLine("Amount", edgeDetailedAmountLabel(edge) || edgeCanvasAmountLabel(edge)) +
        cardLineHtml("From", addressDetailLink(edgeFromAddress(edge) || edge.fromNodeId)) +
        cardLineHtml("To", addressDetailLink(edgeToAddress(edge) || edge.toNodeId)) +
        cardLineHtml("Tx", txDetailLink(edge.txHash || "inferred")) +
        cardLine("Path", edgePathId(edge) || "n/a") +
        note;
    }
    function renderSelectionCard() {
      const root = el("selectionCard");
      if (!root || !state.graph || !state.selected) {
        if (root) {
          root.classList.remove("open");
          root.innerHTML = "";
        }
        return;
      }
      root.classList.add("open");
      if (state.selected.type === "node") {
        root.innerHTML = selectedNodeCard(nodeById(state.selected.id));
        return;
      }
      if (state.selected.type === "edge") {
        root.innerHTML = selectedEdgeCard(graphEdges(state.graph).find((edge) => edge.id === state.selected.id));
        return;
      }
      root.classList.remove("open");
      root.innerHTML = "";
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
    function fastCheckTops(summary) {
      const layer = summary?.layerSummary && typeof summary.layerSummary === "object" ? summary.layerSummary : {};
      const tops = layer.fastCheckTops && typeof layer.fastCheckTops === "object" ? layer.fastCheckTops : {};
      return {
        incoming: asArray(tops.incoming),
        outgoing: asArray(tops.outgoing),
        services: asArray(tops.services)
      };
    }
    function fastTopLine(item) {
      const identity = item?.identity || short(item?.address || "unknown");
      const amount = item?.volumeRaw ? raw(item.volumeRaw) : "amount n/a";
      const ratio = typeof item?.volumeRatio === "number" ? percent(item.volumeRatio) : "ratio n/a";
      const txCount = typeof item?.txCount === "number" ? item.txCount + " tx" : "tx n/a";
      const category = item?.category || "wallet";
      const hint = item?.selectedAsDeepPriorityHint ? " / deep hint" : "";
      return identity + " / " + amount + " raw / " + ratio + " / " + txCount + " / " + category + hint;
    }
    function fastCheckTopMetrics(summary) {
      const tops = fastCheckTops(summary);
      return listMetric("Top incoming", tops.incoming.map(fastTopLine), "No fast incoming tops stored.") +
        listMetric("Top outgoing", tops.outgoing.map(fastTopLine), "No fast outgoing tops stored.") +
        listMetric("Top services", tops.services.map(fastTopLine), "No fast service tops stored.");
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
      if (kind === "address_fast_check") return "Fast check graph";
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
      if (kind === "address_fast_check") {
        return [
          "Fast check graph shows direct counterparties and nearby service boundaries collected during the bounded fast pass.",
          "Rendered fast-top paths: " + paths.length + "; graph edges: " + edges.length + ".",
          limitations.length > 0 ? "Missing follow-up checks: " + limitations.map((item) => item.code).join(", ") + "." : ""
        ];
      }
      if (kind === "address_deep_check") {
        const deep = layer.deepCoverage && typeof layer.deepCoverage === "object" ? layer.deepCoverage : {};
        const projected = layer.projectedProfiles && typeof layer.projectedProfiles === "object" ? layer.projectedProfiles : {};
        return [
          deep.transferEdges !== undefined ? "Raw transfer edges found: " + deep.transferEdges + (deep.sourceTransferPages !== undefined ? " across " + deep.sourceTransferPages + " source page(s)." : ".") : "",
          "Rendered profile edges: " + edges.length + " inferred edge(s).",
          "Projected profiles: counterparties " + (projected.directCounterpartyInteractionProfiles ?? 0) + ", services " + (projected.serviceExposureProfiles ?? 0) + ", inbound provenance " + (projected.inboundProvenancePaths ?? 0) + ", boundary flows " + (projected.boundaryExposureFlows ?? 0) + ", boundary stops " + (projected.expansionBoundaryStops ?? 0) + ".",
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
    function pathTimingLines(graph) {
      const edgesById = new Map(graphEdges(graph).map((edge) => [edge.id, edge]));
      return graphPaths(graph).map((path) => {
        const edges = asArray(path.edgeIds)
          .map((edgeId) => edgesById.get(edgeId))
          .filter((edge) => edge && edge.type !== "stop" && edgeDisplayRole(edge) !== "stop");
        const timestamps = edges
          .map((edge) => edgeTimestampMs(edge))
          .filter((value) => typeof value === "number");
        if (timestamps.length === 0) return "";
        const first = Math.min(...timestamps);
        const last = Math.max(...timestamps);
        const gaps = edges
          .map((edge) => edge?.metadata?.txGapMs)
          .filter((value) => typeof value === "number" && Number.isFinite(value) && value >= 0);
        const fastest = gaps.length > 0 ? Math.min(...gaps) : null;
        const slowest = gaps.length > 0 ? Math.max(...gaps) : null;
        const rapid = gaps.filter((value) => value <= 30 * 60000).length;
        const span = typeof path.timeSpanMs === "number" ? path.timeSpanMs : Math.abs(last - first);
        return [
          path.id || "path",
          "span " + formatDurationMs(span),
          "first " + shortTimestamp(new Date(first).toISOString()),
          "last " + shortTimestamp(new Date(last).toISOString()),
          fastest !== null ? "Fastest hop " + formatDurationMs(fastest) : "",
          slowest !== null ? "Slowest hop " + formatDurationMs(slowest) : "",
          gaps.length > 0 ? "rapid hops <=30m: " + rapid + "/" + gaps.length : ""
        ].filter(Boolean).join(" / ");
      }).filter(Boolean);
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
        listMetric("Path timing", pathTimingLines(graph), "No path timing stored.") +
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
    function graphPointFromClient(event) {
      const svg = el("graph");
      const rect = svg.getBoundingClientRect();
      const viewBox = svg.viewBox.baseVal;
      const svgX = viewBox.x + ((event.clientX - rect.left) / Math.max(1, rect.width)) * viewBox.width;
      const svgY = viewBox.y + ((event.clientY - rect.top) / Math.max(1, rect.height)) * viewBox.height;
      return {
        x: (svgX - state.transform.x) / state.transform.scale,
        y: (svgY - state.transform.y) / state.transform.scale
      };
    }
    function startNodeDrag(event, nodeId) {
      if (!nodeId) return;
      event.preventDefault();
      event.stopPropagation();
      const current = state.renderedNodePositions.get(nodeId);
      if (!current) return;
      const point = graphPointFromClient(event);
      state.nodeDrag = {
        nodeId,
        offsetX: current.x - point.x,
        offsetY: current.y - point.y,
        moved: false
      };
      el("graph").classList.add("dragging");
    }
    function updateNodeDrag(event) {
      if (!state.nodeDrag) return false;
      const point = graphPointFromClient(event);
      const nextX = point.x + state.nodeDrag.offsetX;
      const nextY = point.y + state.nodeDrag.offsetY;
      state.nodeDrag.moved = true;
      saveNodePositionOverride(state.nodeDrag.nodeId, nextX, nextY);
      // ponytail: Re-rendering on drag is simple and acceptable for admin-sized SVGs; upgrade to direct path mutation if drag becomes visibly slow.
      renderGraph();
      return true;
    }
    function suppressNextGraphClick() {
      state.suppressNextGraphClick = true;
      if (state.suppressGraphClickTimer) window.clearTimeout(state.suppressGraphClickTimer);
      state.suppressGraphClickTimer = window.setTimeout(() => {
        state.suppressNextGraphClick = false;
        state.suppressGraphClickTimer = null;
      }, 150);
    }
    function consumeSuppressedGraphClick() {
      if (!state.suppressNextGraphClick) return false;
      state.suppressNextGraphClick = false;
      if (state.suppressGraphClickTimer) window.clearTimeout(state.suppressGraphClickTimer);
      state.suppressGraphClickTimer = null;
      return true;
    }
    function finishNodeDrag() {
      if (!state.nodeDrag) return false;
      const moved = state.nodeDrag.moved;
      state.nodeDrag = null;
      if (moved) suppressNextGraphClick();
      el("graph").classList.remove("dragging");
      return moved;
    }
    function initPanZoom() {
      const svg = el("graph");
      let drag = null;
      svg.addEventListener("mousedown", (event) => {
        if (event.target instanceof Element && event.target.closest("[data-node-id]")) return;
        drag = { x: event.clientX, y: event.clientY, startX: state.transform.x, startY: state.transform.y };
        svg.classList.add("dragging");
      });
      window.addEventListener("mousemove", (event) => {
        if (updateNodeDrag(event)) return;
        if (!drag) return;
        state.transform.x = drag.startX + (event.clientX - drag.x);
        state.transform.y = drag.startY + (event.clientY - drag.y);
        applyTransform();
      });
      window.addEventListener("mouseup", () => {
        const nodeMoved = finishNodeDrag();
        drag = null;
        svg.classList.remove("dragging");
        if (nodeMoved) renderGraph();
      });
      svg.addEventListener("wheel", (event) => {
        event.preventDefault();
        zoom(event.deltaY > 0 ? .9 : 1.1);
      }, { passive: false });
      svg.addEventListener("click", () => {
        if (consumeSuppressedGraphClick()) {
          return;
        }
        state.selected = null;
        renderGraph();
        renderCaseBrief();
        renderDetails();
        renderSelectionCard();
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
    function toggleGraphLabels() {
      state.labels = !state.labels;
      localStorage.setItem("adminForensicsLabels", state.labels ? "on" : "off");
      syncGraphFirstControls();
      renderGraph();
    }
    el("token").value = state.token;
    el("layoutMode").value = state.layoutMode;
    el("amountMode").value = state.amountMode;
    el("flowMode").value = state.flowMode;
    syncGraphFirstControls();
    el("load").addEventListener("click", loadJobs);
    el("refresh").addEventListener("click", loadJobs);
    el("status").addEventListener("change", loadJobs);
    el("kind").addEventListener("change", loadJobs);
    el("limit").addEventListener("change", loadJobs);
    el("subject").addEventListener("input", () => scheduleLoadJobs());
    el("subject").addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      loadJobs();
    });
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
    el("toolFitGraph").addEventListener("click", fitGraph);
    el("toolResetView").addEventListener("click", () => {
      state.transform = { x: 0, y: 0, scale: 1 };
      fitGraph();
      applyTransform();
    });
    el("toolResetLayout").addEventListener("click", clearNodePositionOverrides);
    el("toggleAnalytics").addEventListener("click", () => setOverlay("analytics", !state.analyticsOpen));
    el("closeAnalytics").addEventListener("click", () => setOverlay("analytics", false));
    el("toggleJobs").addEventListener("click", () => setOverlay("jobs", !state.jobsOpen));
    el("closeJobs").addEventListener("click", () => setOverlay("jobs", false));
    el("toggleTransfers").addEventListener("click", () => setTransferDrawer(!state.transfersOpen));
    el("clearSelection").addEventListener("click", () => {
      state.selected = null;
      renderGraph();
      renderCaseBrief();
      renderDetails();
      renderSelectionCard();
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
      renderActivityTimeline();
      renderTransferTabs();
    });
    el("tabAll").addEventListener("click", () => setTransferTab("all"));
    el("tabSelected").addEventListener("click", () => setTransferTab("selected"));
    el("tabStops").addEventListener("click", () => setTransferTab("stops"));
    el("toggleLabels").addEventListener("click", toggleGraphLabels);
    el("toolToggleLabels").addEventListener("click", toggleGraphLabels);
    el("flowMode").addEventListener("change", () => {
      state.flowMode = el("flowMode").value;
      state.timelineRange = null;
      localStorage.setItem("adminForensicsFlowMode", state.flowMode);
      syncGraphFirstControls();
      reconcileSelectionWithFilters();
      renderGraph();
      renderCaseBrief();
      renderDetails();
      renderSelectionCard();
      renderActivityTimeline();
      renderTransferTabs();
    });
    el("servicesMode").addEventListener("click", () => {
      state.servicesVisible = !state.servicesVisible;
      state.timelineRange = null;
      localStorage.setItem("adminForensicsServices", state.servicesVisible ? "on" : "off");
      syncGraphFirstControls();
      reconcileSelectionWithFilters();
      renderGraph();
      renderCaseBrief();
      renderDetails();
      renderSelectionCard();
      renderActivityTimeline();
      renderTransferTabs();
    });
    el("graphSearch").addEventListener("input", () => {
      state.graphSearch = el("graphSearch").value.trim().toLowerCase();
      renderGraph();
    });
    initPanZoom();
    renderTransferTabs();
    el("sessionState").textContent = state.token ? "session active" : "token missing";
    applyInitialUrlFilters();
    if (state.token) loadJobs();
  </script>
</body>
</html>`;
}
