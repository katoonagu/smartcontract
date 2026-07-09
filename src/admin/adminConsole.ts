export function adminConsoleHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Admin Forensics Console</title>
  <link rel="icon" href="data:,">
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
      --surface-canvas: #080c11;
      --surface-grid: rgba(255, 255, 255, .032);
      --surface-panel: #0d1217;
      --surface-panel-strong: #11171d;
      --surface-panel-raised: rgba(13, 18, 23, .94);
      --surface-muted: #151b21;
      --border-subtle: #25303a;
      --border-strong: #34424f;
      --text-primary: #e3ebf2;
      --text-secondary: #a8b4bf;
      --text-tertiary: #6f7d89;
      --semantic-money-in: #6fcf97;
      --semantic-money-out: #df6b75;
      --semantic-context: #9aa6b3;
      --semantic-grouped: #c4b1f2;
      --semantic-contract: #c982a6;
      --semantic-boundary: #d6b15f;
      --semantic-service: #7fc8c0;
      --semantic-cex: #e1c46a;
      --semantic-review: #f1c67d;
      --semantic-risk: #f08a95;
      --semantic-ok: #9bd8b1;
      --focus-ring: rgba(127, 169, 221, .72);
      --shadow-raised: 0 18px 46px rgba(0, 0, 0, .34);
      --radius-panel: 8px;
      --radius-control: 6px;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      overflow: hidden;
      font-variant-numeric: tabular-nums;
    }
    body.graph-interacting, body.graph-interacting * { user-select: none; }
    button, input, select { font: inherit; }
    button, select, input {
      background: var(--panel-2);
      color: var(--text);
      border: 1px solid var(--line-strong);
      border-radius: var(--radius-control);
    }
    button:focus-visible, select:focus-visible, input:focus-visible {
      outline: 2px solid var(--focus-ring);
      outline-offset: 2px;
    }
    button {
      padding: 8px 10px;
      cursor: pointer;
      transition: border-color .15s ease, background .15s ease, transform .08s ease, color .15s ease;
    }
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
    .top-nav { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .top-nav a {
      display: inline-flex;
      align-items: center;
      min-height: 30px;
      padding: 5px 9px;
      border: 1px solid var(--line);
      border-radius: 6px;
      color: var(--text-secondary);
      text-decoration: none;
      font-size: 12px;
      background: #111519;
    }
    .top-nav a:hover, .top-nav a.active {
      border-color: var(--accent);
      color: var(--text);
      background: #1c2636;
    }
    .stats { display: flex; flex-wrap: wrap; gap: 6px; color: var(--muted); font-size: 12px; }
    .chip { border: 1px solid var(--line); border-radius: 999px; padding: 3px 8px; background: #111519; white-space: nowrap; }
    .status-chip-decision {
      border-color: rgba(241, 198, 125, .46);
      background: rgba(28, 19, 10, .78);
      color: var(--semantic-review);
    }
    .status-chip-risk {
      border-color: rgba(240, 138, 149, .42);
      background: rgba(26, 11, 15, .78);
      color: var(--semantic-risk);
    }
    .status-chip-coverage {
      border-color: rgba(112, 168, 188, .46);
      background: rgba(9, 20, 25, .78);
      color: #9fd7e8;
    }
    .status-chip-evidence {
      border-color: rgba(196, 177, 242, .42);
      background: rgba(20, 15, 30, .78);
      color: var(--semantic-grouped);
    }
    .graph-legend { display: grid; gap: 6px; min-width: 0; }
    .graph-legend-card { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 10px; min-width: 0; }
    .legend-chip { display: inline-flex; gap: 5px; align-items: center; min-width: 0; color: var(--text-secondary); font-size: 12px; line-height: 1.25; }
    .legend-swatch { width: 16px; height: 0; border-top: 2px solid #87919b; }
    .legend-swatch.direct { border-color: #8fe9af; }
    .legend-swatch.direct-context { border-color: var(--semantic-context); border-top-style: dashed; opacity: .78; }
    .legend-swatch.second-hop { border-color: #7fc8c0; border-top-style: dashed; }
    .legend-swatch.inferred { border-color: #aab5c2; border-top-style: dashed; }
    .legend-swatch.extended { border-color: #9fd7e8; border-top-style: dashed; }
    .legend-swatch.cross { border-color: #c3ced9; border-top-style: dotted; }
    .legend-swatch.service { border-color: #ffd36b; }
    .legend-swatch.boundary { border-color: #f6c177; border-top-style: dashed; }
    .legend-swatch.contract { border-color: var(--semantic-contract); border-top-style: dashed; }
    .legend-swatch.group { border-color: #d7b2ff; border-top-style: dashed; }
    .legend-swatch.where-route { border-color: var(--semantic-money-in); }
    .legend-swatch.where-exact { border-color: #8fe9af; }
    .legend-swatch.where-probable { border-color: #aab5c2; border-top-style: dashed; opacity: .76; }
    .legend-swatch.where-caveat { border-color: #f6c177; border-top-style: dashed; opacity: .76; }
    .legend-swatch.where-service { border-color: #ffd36b; border-top-style: dashed; opacity: .78; }
    .legend-swatch.where-grouped { border-color: var(--semantic-grouped); border-top-style: dotted; opacity: .78; }
    .legend-swatch.grouped-tail { border-color: var(--semantic-grouped); border-top-style: dotted; }
    .legend-swatch.queued { border-color: var(--warn); border-top-style: dotted; opacity: .78; }
    .legend-swatch.stopped { border-color: var(--warn); border-top-style: dashed; opacity: .78; }
    .token { display: flex; gap: 8px; align-items: center; }
    .token input { width: 280px; }
    .session-pill { color: var(--good); border: 1px solid rgba(139, 213, 166, .35); border-radius: 999px; padding: 5px 9px; font-size: 12px; white-space: nowrap; }
    .content.graph-first-content {
      min-height: 0;
      display: block;
    }
    .wallet-intel-workspace {
      height: calc(100dvh - 56px);
      min-height: 0;
      overflow: hidden;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      gap: 12px;
      padding: 12px;
      background: var(--surface-canvas);
    }
    .wallet-intel-head {
      display: grid;
      gap: 10px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
    }
    .wallet-intel-title-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: start;
    }
    .wallet-intel-title-row h2 { margin: 0; font-size: 16px; }
    .wallet-intel-warning { color: var(--warn); font-size: 12px; }
    .wallet-intel-filters {
      display: grid;
      grid-template-columns: minmax(190px, 1.3fr) minmax(150px, .8fr) minmax(170px, .9fr) minmax(150px, .8fr) minmax(190px, 1fr) auto;
      gap: 8px;
      align-items: end;
    }
    .wallet-intel-filters label { display: grid; gap: 4px; color: var(--muted); font-size: 11px; }
    .wallet-intel-filters input, .wallet-intel-filters select { width: 100%; }
    .wallet-intel-presets {
      grid-column: 1 / -1;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .wallet-intel-presets button.active {
      border-color: var(--accent);
      color: var(--text-primary);
      background: rgba(127, 169, 221, .14);
    }
    .wallet-intel-body {
      min-height: 0;
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(320px, 420px);
      gap: 12px;
    }
    .wallet-intel-table, .wallet-intel-drawer {
      min-height: 0;
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
    }
    .wallet-intel-table table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 12px;
    }
    .wallet-intel-table th, .wallet-intel-table td {
      padding: 8px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
      overflow-wrap: anywhere;
    }
    .wallet-intel-table th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: var(--panel-2);
      color: var(--muted);
      font-size: 11px;
    }
    .wallet-intel-table tr[data-wallet-intel-address] { cursor: pointer; }
    .wallet-intel-table tr[data-wallet-intel-address]:hover, .wallet-intel-table tr.active { background: rgba(122, 162, 247, .08); }
    .wallet-intel-address-button {
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--accent);
      text-align: left;
      overflow-wrap: anywhere;
    }
    .wallet-intel-kind {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 3px 8px;
      border: 1px solid var(--border-muted, var(--line));
      color: var(--text-secondary);
      font-size: 11px;
      white-space: nowrap;
    }
    .wallet-intel-kind.unknown {
      border-color: rgba(127, 169, 221, .6);
      color: var(--accent);
    }
    .wallet-intel-kind.infra {
      border-color: rgba(214, 177, 95, .55);
      color: var(--semantic-boundary);
    }
    .wallet-intel-drawer { padding: 12px; display: grid; align-content: start; gap: 12px; font-size: 12px; }
    .wallet-intel-section { display: grid; gap: 7px; padding-top: 10px; border-top: 1px solid var(--line); }
    .wallet-intel-section:first-child { padding-top: 0; border-top: 0; }
    .wallet-intel-section h3 { margin: 0; font-size: 13px; }
    .wallet-intel-meta { display: grid; gap: 5px; }
    .wallet-intel-line { display: grid; grid-template-columns: minmax(110px, .7fr) minmax(0, 1.3fr); gap: 8px; }
    .wallet-intel-line span:first-child { color: var(--muted); }
    .wallet-intel-pills { display: flex; flex-wrap: wrap; gap: 5px; }
    .wallet-intel-pill { border: 1px solid var(--line); border-radius: 999px; padding: 2px 7px; background: var(--panel-2); color: var(--text-secondary); font-size: 11px; }
    .wallet-intel-list { display: grid; gap: 6px; }
    .wallet-intel-item { display: grid; gap: 4px; padding: 7px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel-2); }
    .wallet-intel-tx { display: grid; gap: 3px; }
    .wallet-intel-ego-graph {
      min-height: 180px;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--panel-2);
    }
    .wallet-intel-ego-graph svg { display: block; width: 100%; height: auto; }
    .wallet-intel-ego-edge { stroke: var(--semantic-context); stroke-width: 2; stroke-linecap: round; opacity: .9; }
    .wallet-intel-ego-edge-label { fill: var(--text-secondary); font-size: 10px; paint-order: stroke; stroke: var(--panel-2); stroke-width: 3px; }
    .wallet-intel-ego-node circle { fill: var(--surface-panel); stroke: var(--accent); stroke-width: 1.5; }
    .wallet-intel-ego-node.selected circle { fill: rgba(127, 169, 221, .16); stroke: var(--accent); }
    .wallet-intel-ego-node text { fill: var(--text-primary); font-size: 10px; text-anchor: middle; }
    .theft-reports-workspace {
      height: calc(100dvh - 56px);
      min-height: 0;
      overflow: hidden;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      gap: 12px;
      padding: 12px;
      background: var(--surface-canvas);
    }
    .theft-reports-head {
      display: grid;
      gap: 10px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
    }
    .theft-reports-title-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: start;
    }
    .theft-reports-title-row h2 { margin: 0; font-size: 16px; }
    .theft-reports-warning { color: var(--warn); font-size: 12px; max-width: 460px; text-align: right; }
    .theft-reports-filters {
      display: grid;
      grid-template-columns: minmax(220px, 1.5fr) minmax(170px, .8fr) minmax(170px, .8fr) minmax(120px, .5fr) auto;
      gap: 8px;
      align-items: end;
    }
    .theft-reports-filters label { display: grid; gap: 4px; color: var(--muted); font-size: 11px; }
    .theft-reports-body {
      min-height: 0;
      display: grid;
      grid-template-columns: minmax(360px, 480px) minmax(0, 1fr);
      gap: 12px;
    }
    .theft-reports-list, .theft-report-detail {
      min-height: 0;
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
    }
    .theft-report-row {
      display: grid;
      gap: 7px;
      width: 100%;
      padding: 10px;
      border: 0;
      border-bottom: 1px solid var(--line);
      background: transparent;
      color: var(--text);
      text-align: left;
      cursor: pointer;
    }
    .theft-report-row:hover, .theft-report-row.active { background: rgba(122, 162, 247, .08); }
    .theft-report-title { display: flex; justify-content: space-between; gap: 10px; align-items: center; }
    .theft-report-amount { font-weight: 700; color: var(--text-primary); }
    .theft-report-meta { display: flex; flex-wrap: wrap; gap: 6px; color: var(--text-secondary); font-size: 12px; }
    .theft-report-card { display: grid; gap: 12px; padding: 12px; }
    .theft-report-section {
      display: grid;
      gap: 8px;
      padding-top: 12px;
      border-top: 1px solid var(--line);
    }
    .theft-report-section:first-child { padding-top: 0; border-top: 0; }
    .theft-report-section h3 { margin: 0; font-size: 13px; }
    .theft-report-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .theft-report-field { display: grid; gap: 3px; font-size: 12px; min-width: 0; }
    .theft-report-field span { color: var(--muted); font-size: 11px; }
    .theft-report-field strong, .theft-report-field code { overflow-wrap: anywhere; }
    .theft-report-note {
      width: 100%;
      min-height: 92px;
      resize: vertical;
      padding: 8px 9px;
      border: 1px solid var(--line-strong);
      border-radius: var(--radius-control);
      background: var(--panel-2);
      color: var(--text);
      font: inherit;
    }
    .theft-report-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .button-like {
      display: inline-flex;
      align-items: center;
      min-height: 32px;
      padding: 6px 10px;
      border: 1px solid var(--line);
      border-radius: 6px;
      color: var(--text);
      background: #121820;
      text-decoration: none;
      font-size: 12px;
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
        radial-gradient(circle at 50% 42%, rgba(95, 132, 184, .12), transparent 34%),
        linear-gradient(var(--surface-grid) 1px, transparent 1px),
        linear-gradient(90deg, var(--surface-grid) 1px, transparent 1px),
        var(--surface-canvas);
      background-size: auto, 72px 72px, 72px 72px, auto;
    }
    .graph-topbar {
      position: absolute;
      top: 12px;
      left: calc(var(--left-rail-width) + 24px);
      right: calc(var(--right-rail-width) + 24px);
      z-index: 4;
      display: grid;
      grid-template-columns: minmax(260px, 1fr) minmax(240px, 360px);
      gap: 10px;
      align-items: center;
      pointer-events: none;
    }
    .case-header {
      align-items: stretch;
    }
    .graph-topbar > *, .graph-action-row > *, .graph-tool-rail > *, .timeline-panel > *, .transfer-panel > *, .overlay-panel > * { pointer-events: auto; }
    .active-job-summary, .graph-meta, .timeline-panel {
      border: 1px solid rgba(58, 67, 77, .82);
      border-radius: 8px;
      background: rgba(13, 17, 22, .86);
      box-shadow: 0 18px 45px rgba(0, 0, 0, .24);
      backdrop-filter: blur(10px);
    }
    .active-job-summary { min-width: 0; padding: 7px 10px; display: grid; grid-template-columns: minmax(0, 1fr) minmax(220px, auto); gap: 3px 10px; align-items: center; }
    .active-job-summary strong { min-width: 0; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .active-job-summary .hint { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .active-job-summary .stats { grid-column: 2; grid-row: 1 / span 2; justify-content: flex-end; overflow: hidden; }
    .graph-search-box {
      display: grid;
      gap: 3px;
      padding: 7px 9px;
      border: 1px solid rgba(58, 67, 77, .82);
      border-radius: 8px;
      background: rgba(13, 17, 22, .86);
      box-shadow: 0 18px 45px rgba(0, 0, 0, .24);
      backdrop-filter: blur(10px);
    }
    .graph-search-label {
      color: var(--muted);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: .08em;
      line-height: 1;
      text-transform: uppercase;
    }
    .graph-search-box input {
      width: 100%;
      height: 26px;
      padding: 0;
      border: 0;
      background: transparent;
    }
    .graph-action-row {
      position: absolute;
      top: 76px;
      left: calc(var(--left-rail-width) + 24px);
      right: calc(var(--right-rail-width) + 24px);
      z-index: 4;
      min-height: 40px;
      box-sizing: border-box;
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 8px;
      align-items: start;
      pointer-events: auto;
      border: 1px solid rgba(58, 67, 77, .82);
      border-radius: 8px;
      background: rgba(13, 17, 22, .86);
      box-shadow: 0 18px 45px rgba(0, 0, 0, .24);
      backdrop-filter: blur(10px);
      padding: 7px 8px;
    }
    .workbench-control-rail {
      align-content: start;
    }
    .graph-control-group {
      display: flex;
      gap: 6px;
      align-items: stretch;
      flex-wrap: wrap;
      min-width: 0;
    }
    .graph-control-section {
      min-width: 0;
      min-height: 32px;
      display: inline-flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 5px;
      flex: 0 1 auto;
      padding: 3px;
      border: 1px solid rgba(58, 67, 77, .68);
      border-radius: 8px;
      background: rgba(8, 11, 15, .5);
    }
    .graph-control-section.is-wide { flex: 1 1 360px; }
    .control-label {
      padding: 0 5px;
      color: var(--muted);
      font-size: 10px;
      line-height: 1;
      letter-spacing: 0;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .graph-action-row button, .graph-action-row select {
      height: 28px;
      padding: 0 9px;
      background: rgba(12, 15, 18, .92);
      max-width: 100%;
      white-space: nowrap;
    }
    .graph-action-row button.active {
      border-color: rgba(127, 169, 221, .78);
      background: rgba(28, 48, 78, .6);
      color: #eef5ff;
    }
    .graph-action-row #txLabelMode { width: 160px; }
    .graph-action-row #walletLabelMode { width: 180px; }
    .graph-action-row #flowMode { width: 128px; }
    .analytics-graph-context {
      display: grid;
      gap: 7px;
      padding: 9px;
      border: 1px solid rgba(58, 67, 77, .72);
      border-radius: 8px;
      background: rgba(8, 11, 15, .46);
    }
    .analytics-graph-context[hidden] { display: none; }
    .analytics-graph-context .graph-meta {
      min-height: 0;
      padding: 0;
      display: grid;
      grid-template-columns: 1fr;
      gap: 6px;
      align-items: start;
      border: 0;
      background: transparent;
      box-shadow: none;
      backdrop-filter: none;
    }
    .analytics-graph-context .graph-meta .chip {
      min-width: 0;
      border-radius: 6px;
      padding: 5px 7px;
      background: rgba(12, 17, 22, .72);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: normal;
    }
    .analytics-graph-context .graph-legend {
      display: grid;
      justify-content: stretch;
      gap: 6px;
    }
    .analytics-graph-context .graph-legend:empty,
    .analytics-graph-context .graph-meta:empty { display: none; }
    .overlay-panel {
      position: absolute;
      z-index: 5;
      top: 12px;
      bottom: 12px;
      width: min(390px, calc(100vw - 24px));
      display: none;
      overflow: hidden;
      border: 1px solid rgba(58, 67, 77, .88);
      border-radius: 8px;
      background: rgba(21, 25, 29, .9);
      box-shadow: 0 22px 60px rgba(0, 0, 0, .36);
      backdrop-filter: blur(12px);
    }
    .overlay-panel.open { display: grid; grid-template-rows: auto minmax(0, 1fr); }
    .overlay-panel.jobs-panel { left: 12px; width: var(--left-rail-width); }
    .overlay-panel.analytics-panel { right: 12px; width: var(--right-rail-width); }
    .evidence-rail-region {
      display: none;
    }
    .evidence-rail-region.open {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
    }
    .overlay-panel.scoring-audit-panel { left: calc(var(--left-rail-width) + 24px); width: min(460px, calc(100vw - var(--left-rail-width) - var(--right-rail-width) - 48px)); }
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
      grid-template-rows: auto auto minmax(0, 1fr);
      gap: 10px;
      align-content: start;
      overflow: hidden;
      padding: 12px;
    }
    .analytics-body .details-body {
      padding: 0;
      min-height: 0;
      overflow: auto;
    }
    .selection-card.analytics-selection-card {
      position: static;
      width: 100%;
      max-height: min(40dvh, 420px);
      overflow: auto;
      display: none;
      border: 1px solid #28364a;
      border-radius: 8px;
      background: rgba(12, 17, 25, .94);
      box-shadow: none;
      padding: 12px;
    }
    .selection-card.analytics-selection-card.open { display: block; }
    .selection-card h3 { margin: 0 0 8px; font-size: 14px; }
    .selection-card .card-line { display: grid; grid-template-columns: minmax(92px, .72fr) minmax(0, 1.28fr); align-items: start; gap: 10px; padding: 6px 0; border-top: 1px solid rgba(42, 48, 54, .7); font-size: 12px; }
    .selection-card .card-line:first-of-type { border-top: 0; }
    .selection-card .card-line > span { min-width: 0; }
    .selection-card .card-line strong { min-width: 0; text-align: right; overflow-wrap: anywhere; word-break: break-word; line-height: 1.35; }
    .selection-card .card-line.card-block { display: grid; grid-template-columns: 1fr; gap: 8px; }
    .selection-card .card-line.card-block strong { text-align: left; font-weight: 600; }
    .selection-card .card-block-body { min-width: 0; }
    .selection-card .card-note { margin-top: 8px; color: var(--muted); font-size: 12px; line-height: 1.45; }
    .selected-flow-review { display: grid; gap: 10px; }
    .selected-flow-header {
      display: grid;
      gap: 7px;
      padding: 10px;
      border: 1px solid rgba(52, 66, 79, .86);
      border-radius: var(--radius-panel);
      background: rgba(8, 12, 17, .72);
    }
    .selected-flow-title { font-size: 13px; font-weight: 750; overflow-wrap: anywhere; }
    .selected-flow-timeline, .selected-flow-route, .selected-flow-day-meta, .selected-flow-tx-meta {
      color: var(--text-secondary);
      font-size: 11px;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    .selected-flow-route {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
      align-items: center;
      gap: 8px;
    }
    .selected-flow-tx-route {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
      align-items: center;
      gap: 8px;
    }
    .selected-flow-entity { min-width: 0; display: grid; gap: 1px; }
    .entity-primary { color: var(--text); font-size: 12px; font-weight: 750; overflow-wrap: anywhere; }
    .entity-secondary { color: var(--text-tertiary); font-size: 10px; line-height: 1.25; overflow-wrap: anywhere; }
    .selected-flow-days { display: grid; gap: 9px; }
    .selected-flow-day { display: grid; gap: 5px; }
    .selected-flow-day-head {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      padding: 0 1px;
      color: var(--text-tertiary);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .selected-flow-day-rows { display: grid; gap: 5px; }
    .selected-flow-tx-row {
      display: grid;
      gap: 4px;
      padding: 8px;
      border: 1px solid rgba(42, 48, 54, .78);
      border-radius: 6px;
      background: rgba(13, 18, 23, .72);
      color: var(--text);
      text-decoration: none;
    }
    .selected-flow-tx-row.is-clickable { cursor: pointer; }
    .selected-flow-tx-row.is-clickable:hover,
    .selected-flow-tx-row.is-clickable:focus { border-color: rgba(122, 162, 247, .62); background: rgba(20, 29, 42, .82); outline: none; }
    .selected-flow-tx-main { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; font-weight: 700; }
    .selected-flow-action { color: var(--semantic-contract); font-size: 11px; font-weight: 700; }
    .selected-flow-limit { color: var(--text-tertiary); font-size: 11px; display: flex; align-items: center; gap: 8px; }
    .selected-flow-limit button { padding: 4px 7px; font-size: 11px; }
    .selected-flow-empty { color: var(--muted); font-size: 12px; line-height: 1.4; }
    .selected-flow-aggregate-only {
      display: grid;
      gap: 8px;
      padding: 10px;
      border: 1px solid rgba(52, 66, 79, .72);
      border-radius: var(--radius-panel);
      background: rgba(12, 17, 25, .66);
      color: var(--text-secondary);
      font-size: 12px;
      line-height: 1.45;
    }
    .selected-flow-aggregate-only strong { color: var(--text); font-size: 13px; }
    .selected-flow-aggregate-only .muted { color: var(--muted); }
    .selected-flow-debug {
      border: 1px solid rgba(42, 48, 54, .72);
      border-radius: var(--radius-panel);
      background: rgba(8, 12, 17, .54);
      color: var(--text-secondary);
      font-size: 12px;
    }
    .selected-flow-debug summary {
      cursor: pointer;
      padding: 8px 10px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .06em;
      text-transform: uppercase;
    }
    .selected-flow-debug-grid {
      display: grid;
      grid-template-columns: minmax(96px, auto) minmax(0, 1fr);
      gap: 6px 10px;
      padding: 0 10px 10px;
    }
    .selected-flow-debug-grid span { color: var(--muted); }
    .selected-flow-debug-grid strong { min-width: 0; overflow-wrap: anywhere; font-weight: 600; color: var(--text-secondary); }
    .selected-flow-debug-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 0 10px 10px;
    }
    .selected-flow-debug-actions button { padding: 5px 8px; font-size: 11px; background: rgba(12, 15, 18, .82); }
    .analyst-intro {
      display: grid;
      gap: 8px;
      padding: 10px;
      margin-bottom: 10px;
      border: 1px solid rgba(52, 66, 79, .86);
      border-radius: var(--radius-panel);
      background: rgba(8, 12, 17, .72);
    }
    .metric-grid > .analyst-intro { grid-column: 1 / -1; }
    .analyst-intro-kicker {
      color: var(--text-tertiary);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .analyst-intro p {
      margin: 0;
      color: var(--text-secondary);
      font-size: 12px;
      line-height: 1.45;
    }
    .analyst-badge-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .analyst-badge {
      display: inline-flex;
      align-items: center;
      min-height: 22px;
      padding: 3px 7px;
      border: 1px solid rgba(52, 66, 79, .88);
      border-radius: 4px;
      background: rgba(13, 18, 23, .78);
      color: var(--text-secondary);
      font-size: 11px;
      font-weight: 650;
      white-space: nowrap;
    }
    .analyst-badge-money { border-color: rgba(111, 207, 151, .38); color: var(--semantic-money-in); }
    .analyst-badge-context { border-color: rgba(154, 166, 179, .38); color: var(--semantic-context); }
    .analyst-badge-boundary { border-color: rgba(214, 177, 95, .42); color: var(--semantic-boundary); }
    .analyst-badge-contract { border-color: rgba(201, 130, 166, .42); color: var(--semantic-contract); }
    .analyst-badge-grouped { border-color: rgba(196, 177, 242, .42); color: var(--semantic-grouped); }
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
    .jobs-queue-head { display: grid; gap: 10px; }
    .jobs-queue-tabs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
    .jobs-queue-tab {
      min-width: 0;
      height: 30px;
      padding: 0 7px;
      color: var(--text-secondary);
      background: rgba(8, 11, 15, .72);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .jobs-queue-tab.active {
      border-color: rgba(122, 162, 247, .78);
      background: rgba(28, 48, 78, .54);
      color: #eef5ff;
    }
    .jobs-search-row { display: grid; grid-template-columns: minmax(0, 1fr); }
    .jobs-filter-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .jobs-action-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .jobs-result-summary { color: var(--muted); font-size: 11px; line-height: 1.35; }
    .toolbar-row { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
    .toolbar-row button { flex: 1; }
    .job-list { display: grid; gap: 8px; padding: 10px; }
    .job {
      width: 100%;
      display: grid;
      gap: 7px;
      text-align: left;
      background: #12161a;
      color: var(--text);
      border: 1px solid var(--line);
      border-radius: 7px;
      padding: 10px;
      cursor: pointer;
    }
    .job:hover, .job.active { border-color: var(--accent); background: #161d26; }
    .job-title { display: flex; justify-content: space-between; gap: 10px; align-items: center; }
    .job-address { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 760; color: var(--text); }
    .job-meta-row { display: flex; flex-wrap: wrap; gap: 5px; min-width: 0; }
    .job-pill { display: inline-flex; max-width: 100%; border: 1px solid rgba(58, 67, 77, .76); border-radius: 999px; padding: 2px 7px; color: var(--text-secondary); background: rgba(8, 11, 15, .46); font-size: 11px; line-height: 1.35; }
    .job-pill strong { font-weight: 750; color: var(--text); }
    .job-kind-pill { border-color: rgba(122, 162, 247, .42); color: #bcd1ff; }
    .job-risk-high { border-color: rgba(240, 138, 149, .5); color: var(--semantic-risk); }
    .job-risk-low { border-color: rgba(139, 213, 166, .44); color: var(--semantic-ok); }
    .job-line { color: var(--muted); font-size: 11px; line-height: 1.35; overflow-wrap: anywhere; }
    .job-line strong { color: var(--text-secondary); font-weight: 650; }
    .job-id-line { color: var(--text-tertiary); font-size: 10.5px; }
    .status { font-size: 11px; border: 1px solid var(--line-strong); border-radius: 999px; padding: 2px 7px; text-transform: uppercase; }
    .status.completed, .status.partial { color: var(--good); border-color: rgba(139, 213, 166, .45); }
    .status.failed { color: var(--bad); border-color: rgba(255, 107, 107, .45); }
    .status.running, .status.queued { color: var(--warn); border-color: rgba(246, 193, 119, .45); }
    .graph-tool-rail {
      position: absolute;
      top: 150px;
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
      z-index: 1;
      min-width: 0;
      overflow: hidden;
    }
    .graph-canvas-region {
      isolation: isolate;
    }
    .timeline-panel {
      position: absolute;
      left: calc(var(--left-rail-width) + 24px);
      right: calc(var(--right-rail-width) + 24px);
      bottom: 12px;
      z-index: 4;
      padding: 12px 14px;
    }
    .timeline-region {
      min-height: 150px;
    }
    .timeline-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      margin-bottom: 10px;
    }
    .activity-timeline {
      position: relative;
      min-height: 102px;
      display: grid;
      grid-template-rows: minmax(64px, 1fr) auto auto;
      gap: 5px;
      overflow: hidden;
      padding: 10px 0 2px;
      border-top: 1px solid rgba(58, 67, 77, .58);
    }
    .timeline-bars {
      min-height: 64px;
      display: flex;
      align-items: end;
      gap: 3px;
      background:
        linear-gradient(180deg, rgba(255, 255, 255, .045) 1px, transparent 1px) 0 16px / 100% 18px,
        linear-gradient(90deg, transparent, rgba(122, 162, 247, .08), transparent);
    }
    .timeline-axis, .timeline-legend {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      color: var(--text-tertiary);
      font-size: 11px;
      line-height: 1.25;
      min-width: 0;
    }
    .timeline-axis span, .timeline-legend span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .timeline-axis strong { color: var(--text-secondary); font-weight: 600; }
    .timeline-legend { color: var(--text-secondary); justify-content: flex-start; }
    .timeline-legend span::before {
      content: "";
      display: inline-block;
      width: 8px;
      height: 8px;
      margin-right: 6px;
      border-radius: 2px;
      background: linear-gradient(180deg, rgba(139, 213, 166, .9), rgba(91, 199, 216, .8));
    }
    .timeline-bars .timeline-bar {
      flex: 1 1 8px;
      min-width: 5px;
      height: var(--bucket-height, 6px);
      padding: 0;
      align-self: end;
      border: 1px solid rgba(123, 180, 215, .24);
      border-radius: 4px 4px 1px 1px;
      background: rgba(84, 143, 175, .36);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, .08);
      opacity: .74;
    }
    .timeline-bars .timeline-bar.empty {
      border-color: rgba(111, 125, 137, .18);
      background: rgba(111, 125, 137, .18);
      opacity: .42;
    }
    .timeline-bars .timeline-bar.low { background: linear-gradient(180deg, rgba(106, 177, 206, .52), rgba(66, 129, 158, .5)); }
    .timeline-bars .timeline-bar.medium { background: linear-gradient(180deg, rgba(122, 162, 247, .72), rgba(91, 199, 216, .62)); opacity: .9; }
    .timeline-bars .timeline-bar.hot { background: linear-gradient(180deg, rgba(139, 213, 166, .9), rgba(91, 199, 216, .8)); opacity: 1; }
    .timeline-bars .timeline-bar.active {
      outline: 2px solid rgba(237, 241, 244, .92);
      outline-offset: 1px;
      border-color: rgba(237, 241, 244, .78);
      opacity: 1;
    }
    .transfer-panel {
      position: absolute;
      left: calc(var(--left-rail-width) + 24px);
      right: calc(var(--right-rail-width) + 24px);
      bottom: 132px;
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
    .tabbar { display: flex; gap: 6px; align-items: center; padding: 8px 50px 8px 8px; border-bottom: 1px solid var(--line); }
    .tabbar button { padding: 7px 10px; }
    .tabbar .transfer-close { position: absolute; top: 8px; right: 8px; z-index: 4; min-width: 34px; height: 34px; padding: 0; }
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
    .edge-hitbox {
      fill: none;
      stroke: transparent;
      stroke-width: 16;
      opacity: 0;
      cursor: pointer;
      pointer-events: stroke;
      vector-effect: non-scaling-stroke;
      stroke-linecap: round;
    }
    .edge-flow-incoming { stroke: var(--semantic-money-in); }
    .edge-flow-outgoing { stroke: var(--semantic-money-out); }
    .edge-flow-context { stroke: #8d97a8; stroke-dasharray: 7 9; opacity: .52; }
    .edge.edge-deep-wallet-transfer { stroke: rgba(141, 151, 168, .68); stroke-dasharray: 7 9; opacity: .68; }
    .edge.edge-deep-direct-context { stroke: rgba(154, 166, 179, .66); stroke-dasharray: 7 9; opacity: .64; }
    .edge.edge-deep-second-hop { stroke: rgba(127, 200, 192, .78); stroke-dasharray: 5 6; opacity: .78; }
    .edge.edge-deep-extended-path { stroke: rgba(159, 215, 232, .76); stroke-dasharray: 9 7; opacity: .76; }
    .edge.edge-deep-cross-wallet { stroke: rgba(195, 206, 217, .72); stroke-dasharray: 2 7; opacity: .76; }
    .edge.edge-deep-grouped-tail { stroke: var(--semantic-grouped); stroke-dasharray: 2 6; opacity: .74; }
    .edge.edge-second-layer-queued { stroke: rgba(246, 193, 119, .72); stroke-dasharray: 2 8; opacity: .64; }
    .edge.edge-second-layer-stopped { stroke: rgba(246, 193, 119, .78); stroke-dasharray: 4 8; opacity: .72; }
    .edge.edge-deep-grouped-transfer { stroke: rgba(178, 163, 224, .78); stroke-dasharray: 8 8; opacity: .74; }
    .edge.edge-deep-grouped-transfer.selected { stroke: #d8c7ff; opacity: .98; filter: drop-shadow(0 0 12px rgba(190, 170, 255, .34)); }
    .edge.edge-contract-trigger-context { stroke: var(--semantic-contract); stroke-dasharray: 6 8; opacity: .72; }
    .edge.edge-contract-trigger-context.selected { stroke: #ffc0dc; stroke-dasharray: 6 8; opacity: .98; filter: drop-shadow(0 0 10px rgba(220, 102, 154, .34)); }
    .edge.edge-contract-driven-transfer { stroke: rgba(202, 120, 166, .84); stroke-dasharray: none; opacity: .84; }
    .edge.edge-contract-driven-transfer.selected { stroke: #ffc0dc; stroke-dasharray: none; opacity: .98; filter: drop-shadow(0 0 12px rgba(220, 102, 154, .36)); }
    .edge.edge-incoming-wallet-transfer { stroke: rgba(141, 151, 168, .68); stroke-dasharray: 7 9; opacity: .68; }
    .edge.edge-incoming-wallet-transfer.selected { stroke: #cdd6e1; opacity: .98; filter: drop-shadow(0 0 10px rgba(170, 181, 194, .28)); }
    .edge.edge-where-exact-funding { stroke: var(--semantic-money-in); stroke-dasharray: none; opacity: .9; }
    .edge.edge-where-probable-funding { stroke: rgba(170, 181, 194, .72); stroke-dasharray: 7 9; opacity: .68; }
    .edge.edge-where-source-caveat { stroke: rgba(246, 193, 119, .78); stroke-dasharray: 4 8; opacity: .72; }
    .edge.edge-where-service-boundary { stroke: rgba(255, 211, 107, .76); stroke-dasharray: 6 8; opacity: .76; }
    .edge.edge-where-grouped-candidate { stroke: var(--semantic-grouped); stroke-dasharray: 2 6; opacity: .74; }
    .edge.edge-reciprocal-flow { stroke: rgba(164, 154, 202, .72); stroke-dasharray: 5 7; opacity: .76; filter: drop-shadow(0 0 7px rgba(164, 154, 202, .24)); }
    .edge.edge-deep-wallet-transfer.edge-reciprocal-flow { stroke: rgba(141, 151, 168, .68); stroke-dasharray: 7 9; opacity: .68; filter: drop-shadow(0 0 7px rgba(164, 154, 202, .18)); }
    .edge.edge-deep-wallet-transfer.edge-reciprocal-flow.selected { opacity: 1; filter: drop-shadow(0 0 12px rgba(125, 166, 255, .42)) drop-shadow(0 0 7px rgba(164, 154, 202, .18)); }
    .edge.edge-deep-grouped-transfer.edge-reciprocal-flow { stroke: var(--semantic-grouped); stroke-dasharray: 8 8; opacity: .72; }
    .edge.edge-deep-grouped-transfer.edge-reciprocal-flow.selected { stroke: #d8c7ff; opacity: .98; filter: drop-shadow(0 0 12px rgba(190, 170, 255, .34)); }
    .edge-flow-service { stroke: #ffd36b; }
    .edge.edge-service-cex { stroke: rgba(226, 192, 101, .72); stroke-dasharray: 6 8; opacity: .74; }
    .edge.edge-service-bridge { stroke: rgba(111, 166, 222, .72); stroke-dasharray: 6 8; opacity: .74; }
    .edge.edge-service-dex { stroke: rgba(185, 143, 255, .72); stroke-dasharray: 6 8; opacity: .74; }
    .edge.edge-service-contract { stroke: rgba(198, 126, 154, .72); stroke-dasharray: 6 8; opacity: .74; }
    .edge.edge-service-context { stroke: rgba(177, 189, 203, .68); stroke-dasharray: 6 8; opacity: .7; }
    .edge-flow-self { stroke: #8d97a8; }
    .edge-flow-stop { stroke: #f6c177; stroke-dasharray: 4 7; }
    .edge.edge-residual-caveat { opacity: .54; stroke-dasharray: 3 9; }
    .edge-flow-peer { stroke: rgba(141, 151, 168, .64); stroke-dasharray: 7 9; opacity: .68; }
    .edge.edge-flow-peer.selected { stroke: #cdd6e1; stroke-dasharray: 7 9; opacity: .98; }
    .edge.edge-deep-grouped-transfer,
    .edge.edge-flow-peer.edge-deep-grouped-transfer,
    .edge.edge-flow-service.edge-deep-grouped-transfer,
    .edge.edge-flow-incoming.edge-deep-grouped-transfer,
    .edge.edge-flow-outgoing.edge-deep-grouped-transfer {
      stroke: var(--semantic-grouped);
      stroke-dasharray: 8 8;
      opacity: .72;
    }
    .edge.risk, .edge.decline { opacity: .96; }
    .edge.review { opacity: .92; }
    .edge.clean, .edge.acceptable { opacity: .9; }
    .edge.dim, .node.dim { opacity: .16; }
    .edge.timeline-context { opacity: .18; }
    .edge.timeline-focus { opacity: 1; filter: drop-shadow(0 0 13px rgba(125, 190, 220, .5)); }
    .node.timeline-context { opacity: .28; }
    .node.timeline-focus { opacity: 1; }
    .edge.selected { opacity: 1; filter: drop-shadow(0 0 12px rgba(125, 166, 255, .42)); }
    .edge.edge-speed-strong { filter: drop-shadow(0 0 10px rgba(237, 244, 251, .58)); }
    .edge.edge-speed-medium { filter: drop-shadow(0 0 8px rgba(237, 244, 251, .42)); }
    .edge.edge-speed-soft { filter: drop-shadow(0 0 7px rgba(237, 244, 251, .26)); }
    .edge.edge-speed-faint { filter: drop-shadow(0 0 5px rgba(237, 244, 251, .16)); }
    .edge.edge-flow-incoming.edge-speed-strong { filter: drop-shadow(0 0 11px rgba(123, 226, 166, .56)); }
    .edge.edge-flow-incoming.edge-speed-medium { filter: drop-shadow(0 0 9px rgba(123, 226, 166, .38)); }
    .edge.edge-flow-incoming.edge-speed-soft { filter: drop-shadow(0 0 7px rgba(123, 226, 166, .24)); }
    .edge.edge-flow-service.edge-speed-strong,
    .edge.edge-flow-stop.edge-speed-strong { filter: drop-shadow(0 0 10px rgba(246, 193, 119, .46)); }
    .edge.edge-flow-peer.edge-speed-strong { filter: drop-shadow(0 0 8px rgba(170, 181, 194, .28)); }
    .edge.selected.edge-speed-strong { filter: drop-shadow(0 0 12px rgba(237, 244, 251, .72)); }
    .edge-group { cursor: pointer; }
    .amount-pill { --pill-accent: rgba(195, 206, 217, .8); --pill-glow: rgba(237, 244, 251, .18); }
    .amount-pill rect { fill: rgba(11, 14, 17, .9); stroke: transparent; stroke-width: 0; rx: 5; vector-effect: non-scaling-stroke; }
    .amount-pill text { font-size: 10.5px; font-weight: 500; paint-order: stroke; stroke: rgba(11, 14, 17, .7); stroke-width: 1.5px; stroke-linejoin: round; }
    .amount-pill .amount-line { fill: #ffffff; font-weight: 500; }
    .amount-pill .time-line { fill: var(--pill-accent); font-size: 9.5px; font-weight: 560; }
    .amount-pill.label-role-incoming { --pill-accent: #8fe9af; --pill-glow: rgba(123, 226, 166, .32); }
    .amount-pill.label-role-outgoing { --pill-accent: #ff9ba4; --pill-glow: rgba(255, 132, 142, .26); }
    .amount-pill.label-role-service { --pill-accent: #ffd36b; --pill-glow: rgba(255, 211, 107, .32); }
    .amount-pill.label-role-stop { --pill-accent: #f6c177; --pill-glow: rgba(246, 193, 119, .34); }
    .amount-pill.label-role-peer { --pill-accent: #c3ced9; --pill-glow: rgba(170, 181, 194, .2); }
    .amount-pill.label-role-grouped { --pill-accent: #d8c7ff; --pill-glow: rgba(190, 170, 255, .28); }
    .amount-pill.label-role-context { --pill-accent: #aab5c2; --pill-glow: rgba(170, 181, 194, .18); }
    .amount-pill.edge-speed-strong { filter: drop-shadow(0 0 8px var(--pill-glow)); }
    .amount-pill.edge-speed-medium { filter: drop-shadow(0 0 6px var(--pill-glow)); }
    .amount-pill.edge-speed-faint { filter: drop-shadow(0 0 4px var(--pill-glow)); }
    .stop-badge rect { fill: rgba(246, 193, 119, .95); stroke: #0b0e11; stroke-width: 1.5; rx: 4; vector-effect: non-scaling-stroke; }
    .stop-badge text { fill: #0b0e11; font-size: 9.5px; font-weight: 750; letter-spacing: 0; stroke: none; }
    .node { cursor: pointer; }
    .node circle { fill: #303846; stroke-width: 2.2; vector-effect: non-scaling-stroke; filter: drop-shadow(0 8px 8px rgba(0, 0, 0, .36)); }
    .node.selected circle { stroke-width: 4; filter: drop-shadow(0 0 10px rgba(122, 162, 247, .5)); }
    .node.selected.node-display-wallet circle { filter: drop-shadow(0 0 12px rgba(139, 213, 166, .42)); }
    .node.selected.node-display-cex circle { filter: drop-shadow(0 0 14px rgba(247, 215, 116, .58)); }
    .node.selected.node-display-bridge circle { filter: drop-shadow(0 0 14px rgba(91, 167, 255, .55)); }
    .node.selected.node-display-funding_bundle circle { filter: drop-shadow(0 0 14px rgba(215, 178, 255, .55)); }
    .node.selected.node-display-service_boundary circle,
    .node.selected.node-display-trace_stop circle { filter: drop-shadow(0 0 14px rgba(246, 193, 119, .52)); }
    .node.selected.node-display-smart_contract circle,
    .node.selected.node-display-contract_adapter circle,
    .node.selected.node-display-contract_router circle,
    .node.selected.node-display-dex_contract circle { filter: drop-shadow(0 0 14px rgba(181, 156, 255, .55)); }
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
    .node-residual-caveat { opacity: .72; }
    .node-display-funding_bundle circle { fill: #322843; stroke: var(--bundle); }
    .node-role-mark { pointer-events: none; }
    .node-role-mark .role-chip { fill: rgba(13, 18, 25, .82); stroke-width: 1.7; }
    .node-role-mark .role-ring { fill: none; stroke-width: 1.5; }
    .node-role-mark .role-icon { pointer-events: none; }
    .node-role-drainer .role-ring-outer { stroke: rgba(175, 177, 190, .58); }
    .node-role-drainer .role-ring-inner { stroke: rgba(139, 31, 44, .72); }
    .node-role-drainer .role-chip { fill: rgba(24, 7, 10, .9); stroke: #8b1f2c; filter: drop-shadow(0 0 9px rgba(139, 31, 44, .45)); }
    .node-role-victim { filter: drop-shadow(0 0 7px rgba(197, 29, 36, .34)); }
    .node-role-mule_transit .role-ring-outer { stroke: rgba(170, 206, 218, .68); }
    .node-role-mule_transit .role-ring-inner { stroke: rgba(45, 214, 199, .78); }
    .node-role-mule_transit .role-chip { fill: rgba(45, 214, 199, .8); stroke: #9bdad6; filter: drop-shadow(0 0 8px rgba(45, 214, 199, .32)); }
    .node-role-collector .role-ring-outer { stroke: rgba(185, 177, 220, .72); }
    .node-role-collector .role-ring-inner { stroke: rgba(155, 111, 255, .82); }
    .node-role-collector .role-chip { fill: rgba(118, 49, 235, .86); stroke: #bfa7ff; filter: drop-shadow(0 0 8px rgba(155, 111, 255, .42)); }
    .node.role-marked circle { filter: drop-shadow(0 0 10px rgba(237, 244, 251, .18)) drop-shadow(0 8px 8px rgba(0, 0, 0, .36)); }
    .node text { font-size: 11.5px; font-weight: 650; fill: var(--text); paint-order: stroke; stroke: #0b0e11; stroke-width: 2px; stroke-linejoin: round; }
    .node-sublabel { fill: var(--muted); font-size: 10px; font-weight: 700; paint-order: stroke; stroke: #081018; stroke-width: 3px; stroke-linejoin: round; }
    .node .stop-badge text { paint-order: normal; stroke: transparent; stroke-width: 0; fill: #0b0e11; }
    .service-glyph { fill: #fff; font-size: 12px; font-weight: 800; pointer-events: none; paint-order: normal; stroke: transparent; stroke-width: 0; }
    .node-label-hidden .node-label { display: none; }
    .node.label-hidden .node-label,
    .node.label-hidden .node-sublabel { display: none; }
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
    .list-lines div, .list-lines span { font-size: 12px; color: var(--text); }
    .counterparty-lines { display: grid; gap: 7px; }
    .counterparty-row {
      display: grid;
      grid-template-columns: minmax(92px, auto) minmax(0, 1fr);
      gap: 8px;
      align-items: baseline;
      font-size: 12px;
      padding: 3px 4px;
      border-radius: 6px;
    }
    .counterparty-row[role="button"] { cursor: pointer; }
    .counterparty-row[role="button"]:hover, .counterparty-row[role="button"]:focus-visible { background: rgba(122, 162, 247, .08); outline: 1px solid rgba(122, 162, 247, .32); }
    .counterparty-row.selected { background: rgba(139, 213, 166, .08); outline: 1px solid rgba(139, 213, 166, .32); }
    .counterparty-row strong { color: var(--text); font-size: 12px; white-space: nowrap; }
    .counterparty-row span { min-width: 0; overflow-wrap: anywhere; color: var(--text-secondary); }
    .counterparty-row .link { font-weight: 650; }
    .counterparty-row small { display: block; margin-top: 2px; color: var(--text-tertiary); font-size: 11px; }
    .tx-lines { display: grid; gap: 8px; }
    .tx-line { display: grid; gap: 4px; padding-top: 8px; border-top: 1px solid var(--line); }
    .tx-line:first-child { padding-top: 0; border-top: 0; }
    .tx-line.tx-card { gap: 6px; padding: 8px; border: 1px solid rgba(42, 48, 54, .86); border-radius: 7px; background: rgba(8, 12, 17, .62); }
    .tx-line.tx-card:first-child { border-top: 1px solid rgba(42, 48, 54, .86); }
    .tx-main, .tx-meta { display: flex; justify-content: space-between; gap: 10px; min-width: 0; }
    .tx-main strong { font-size: 12px; font-weight: 700; overflow-wrap: anywhere; color: var(--text); }
    .tx-main span, .tx-route, .tx-meta { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
    .tx-main .tx-time { flex: 0 0 auto; color: #b7c5d8; text-align: right; white-space: nowrap; }
    .tx-route { min-width: 0; }
    .tx-route.compact { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 6px; }
    .tx-route.compact .link { display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; vertical-align: bottom; white-space: nowrap; }
    .tx-route.compact .tx-arrow { color: var(--muted); }
    .tx-meta.compact { align-items: center; color: var(--muted); }
    .tx-meta.compact > div { min-width: 0; }
    .tx-verdict { color: var(--muted); font-size: 11px; text-transform: lowercase; }
    .tx-gap-chip { display: inline-flex; border: 1px solid rgba(122, 162, 247, .26); border-radius: 999px; padding: 1px 6px; color: #b7c5d8; background: rgba(122, 162, 247, .08); font-size: 11px; white-space: nowrap; }
    .tx-links { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 2px; }
    .tx-chip { display: inline-flex; max-width: 100%; border: 1px solid rgba(58, 67, 77, .92); border-radius: 999px; padding: 2px 7px; background: rgba(8, 11, 15, .78); font-size: 11px; }
    .tx-chip .link { max-width: 118px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tx-summary-note { color: var(--muted); font-size: 11px; line-height: 1.35; }
    .audit-row { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 8px; align-items: start; padding: 7px 0; border-top: 1px solid var(--line); font-size: 12px; }
    .audit-row:first-child { border-top: 0; }
    .audit-row span, .audit-row strong { min-width: 0; overflow-wrap: anywhere; }
    .muted { color: var(--muted); }
    .json-block { white-space: pre-wrap; overflow: auto; max-height: 380px; font-family: "JetBrains Mono", Consolas, monospace; font-size: 12px; line-height: 1.45; }
    details.metric summary { cursor: pointer; color: var(--muted); }
    details.compact-details summary {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: center;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .06em;
      text-transform: uppercase;
    }
    details.compact-details summary span {
      color: var(--text-tertiary);
      font-weight: 600;
      letter-spacing: 0;
      text-transform: none;
      white-space: nowrap;
    }
    details.compact-details .list-lines { margin-top: 8px; display: grid; gap: 5px; }
    .error { color: var(--bad); padding: 10px; }
    .empty { color: var(--muted); padding: 16px 10px; }
    .hint { color: var(--muted); font-size: 12px; line-height: 1.45; }
    .compat-hidden { display: none; }
    @media (max-width: 1680px) {
      .graph-action-row { gap: 6px; padding: 6px; }
      .graph-control-group { gap: 5px; }
      .graph-control-section { gap: 4px; padding: 2px; }
      .graph-action-row button, .graph-action-row select { padding: 0 7px; flex: 0 0 auto; }
      .graph-action-row #txLabelMode { width: 150px; }
      .graph-action-row #walletLabelMode { width: 166px; }
      .graph-action-row #flowMode { width: 116px; }
    }
    @media (max-width: 1280px) {
      .control-label { display: none; }
      .graph-control-section.is-wide { flex-basis: 280px; }
    }
    @media (max-width: 900px) {
      .wallet-intel-workspace {
        height: auto;
        min-height: calc(100dvh - 56px);
        overflow: visible;
      }
      .wallet-intel-title-row {
        display: grid;
      }
      .wallet-intel-filters {
        grid-template-columns: 1fr;
      }
      .wallet-intel-body {
        grid-template-columns: 1fr;
      }
      .theft-reports-filters, .theft-reports-body, .theft-report-grid {
        grid-template-columns: 1fr;
      }
      .theft-reports-warning { text-align: left; }
    }
    @media (max-width: 1180px) {
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
      .graph-stage { inset: 0; }
      .timeline-panel, .transfer-panel {
        left: 12px;
        right: 12px;
      }
      .graph-control-group { flex-wrap: wrap; }
      .graph-control-section { flex: 1 1 260px; }
      .overlay-panel { top: 264px; bottom: auto; max-height: 360px; }
      .overlay-panel.jobs-panel { left: 12px; right: auto; }
      .overlay-panel.analytics-panel { left: 12px; right: auto; }
      .overlay-panel.analytics-panel { top: calc(264px + 372px); }
      .overlay-panel.scoring-audit-panel { left: 12px; width: var(--left-rail-width); top: calc(264px + 744px); }
      .graph-tool-rail { top: 264px; }
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
        <nav class="top-nav" aria-label="Admin workspaces">
          <a href="/admin/forensics" data-workspace-link>Forensics</a>
          <a href="/admin/wallet-intelligence" data-workspace-link>Wallet Intelligence</a>
          <a href="/admin/theft-reports" data-workspace-link>Заявки о краже</a>
        </nav>
        <div class="stats" id="jobStats"></div>
      </div>
      <div class="token">
        <input id="token" type="password" placeholder="Bearer token" autocomplete="off">
        <span id="sessionState" class="session-pill">local session</span>
        <button id="load" type="button">Load</button>
      </div>
    </header>
    <section class="content graph-first-content" data-graph-first-shell>
      <section class="graph-workspace" data-workbench-shell>
        <div class="case-header graph-topbar" data-case-header>
          <div id="activeJobSummary" class="active-job-summary">
            <strong>Case brief</strong>
            <div class="hint" id="selectionHint">Select a completed or partial job to inspect evidence.</div>
          </div>
          <label class="graph-search-box">
            <span class="graph-search-label">Find</span>
            <input id="graphSearch" placeholder="node / tx / label">
          </label>
        </div>
        <div class="graph-action-row workbench-control-rail" data-control-rail>
          <div class="graph-control-group">
            <div class="graph-control-section">
              <span class="control-label">Panels</span>
              <button id="toggleJobs" type="button">Jobs</button>
              <button id="toggleAnalytics" type="button">Analytics</button>
              <button id="toggleScoringAudit" type="button">Scoring audit</button>
            </div>
            <div class="graph-control-section">
              <span class="control-label">Flow</span>
              <select id="flowMode">
                <option value="all">All flows</option>
                <option value="incoming">Incoming</option>
                <option value="outgoing">Outgoing</option>
                <option value="self">Self</option>
              </select>
            </div>
            <div class="graph-control-section is-wide">
              <span class="control-label">Labels</span>
              <select id="txLabelMode">
                <option value="auto">Tx labels: auto</option>
                <option value="all">Tx labels: all</option>
                <option value="important">Tx labels: important</option>
                <option value="selected">Tx labels: selected</option>
                <option value="off">Tx labels: off</option>
              </select>
              <select id="walletLabelMode">
                <option value="smart">Wallet labels: smart</option>
                <option value="all">Wallet labels: all</option>
                <option value="important">Wallet labels: important</option>
                <option value="off">Wallet labels: off</option>
              </select>
            </div>
            <div class="graph-control-section">
              <span class="control-label">View</span>
              <button id="densityMode" type="button">View: Fan overview</button>
              <button id="roleMarksMode" type="button">Role marks on</button>
              <button id="peerLinksMode" type="button">Peer links on</button>
              <button id="servicesMode" type="button">Services on</button>
            </div>
            <div class="graph-control-section">
              <span class="control-label">Graph</span>
              <button id="expandSelected" type="button">Expand selected</button>
              <button id="refreshSecondLayer" type="button">Refresh 2nd layer</button>
              <button id="toolResetLayout" type="button">Reset layout</button>
            </div>
          </div>
        </div>
        <aside id="jobsPanel" class="overlay-panel jobs-panel open" data-overlay="jobs">
          <div class="overlay-head">
            <h2>Jobs</h2>
            <button id="closeJobs" class="icon-btn" type="button" title="Close jobs">x</button>
          </div>
          <div class="overlay-body">
            <div class="compact-section-head">
              <div class="jobs-queue-head">
                <div class="jobs-queue-tabs" role="group" aria-label="Job queue view">
                  <button id="jobsModeAll" class="jobs-queue-tab active" type="button">All</button>
                  <button id="jobsModeRunning" class="jobs-queue-tab" type="button">Running</button>
                  <button id="jobsModeReview" class="jobs-queue-tab" type="button">Needs review</button>
                </div>
                <div class="jobs-search-row">
                  <input id="subject" placeholder="Find address, tx, or job id">
                </div>
                <div class="jobs-filter-row">
                <select id="status">
                  <option value="">Status: all</option>
                  <option value="completed">completed</option>
                  <option value="partial">partial</option>
                  <option value="failed">failed</option>
                  <option value="running">running</option>
                  <option value="queued">queued</option>
                  <option value="cancelled">cancelled</option>
                </select>
                <select id="kind">
                  <option value="">Check: all</option>
                  <option value="address_fast_check">Fast check</option>
                  <option value="where_is_money_check">Where is money</option>
                  <option value="address_deep_check">DeepCheck</option>
                  <option value="incoming_deposit_check">Incoming deposit</option>
                </select>
                </div>
                <div class="jobs-action-row">
                <select id="limit">
                  <option value="20">20 latest</option>
                  <option value="50" selected>50 latest</option>
                  <option value="100">100 latest</option>
                </select>
                <button id="refresh" type="button">Refresh</button>
                <button id="autoRefresh" type="button">Auto off</button>
                <button id="clearFilters" type="button">Clear</button>
                </div>
                <div id="jobsResultSummary" class="jobs-result-summary">No jobs loaded.</div>
              </div>
            </div>
            <div id="jobs" class="job-list"></div>
          </div>
        </aside>
        <aside id="caseBriefPanel" class="overlay-panel analytics-panel evidence-rail-region open" data-overlay="analytics" data-evidence-rail>
          <div class="overlay-head">
            <h2>Analytics</h2>
            <button id="closeAnalytics" class="icon-btn" type="button" title="Close analytics">x</button>
          </div>
          <div class="overlay-body analytics-body">
            <div class="selection-card analytics-selection-card" id="selectionCard"></div>
            <div class="analytics-graph-context" hidden>
              <div id="graphStats" class="graph-meta"></div>
              <div id="graphLegend" class="graph-legend"></div>
            </div>
            <div id="caseBrief" class="details-body empty">Select a completed or partial job to inspect evidence.</div>
          </div>
        </aside>
        <aside id="scoringAuditPanel" class="overlay-panel scoring-audit-panel" data-overlay="scoring-audit">
          <div class="overlay-head">
            <h2>Scoring audit</h2>
            <button id="closeScoringAudit" class="icon-btn" type="button" title="Close scoring audit">x</button>
          </div>
          <div id="scoringAudit" class="overlay-body analytics-body empty">Open scoring audit to load the latest report.</div>
        </aside>
        <div class="graph-tool-rail">
          <button id="toolFitGraph" class="icon-btn" type="button" title="Fit graph">Fit</button>
          <button id="zoomIn" class="icon-btn" type="button" title="Zoom in">+</button>
          <button id="zoomOut" class="icon-btn" type="button" title="Zoom out">-</button>
          <button id="toolToggleLabels" class="icon-btn" type="button" title="Toggle labels">Aa</button>
          <button id="toolResetView" class="icon-btn" type="button" title="Reset view">Reset</button>
          <button id="clearSelection" class="icon-btn" type="button" title="Clear selection">Clear selection</button>
        </div>
        <section class="graph-stage graph-canvas-region" data-graph-region>
          <svg id="graph" role="img" aria-label="Forensics graph"></svg>
        </section>
        <section class="transfer-panel collapsed" data-transfer-drawer data-transfer-tabs>
          <div class="tabbar">
            <button id="tabAll" class="active" type="button">All transfers</button>
            <button id="tabSelected" type="button">Selected evidence</button>
            <button id="tabStops" type="button">Boundary stops</button>
            <button id="closeTransferDrawer" class="transfer-close" type="button" title="Close transfer details">x</button>
          </div>
          <div id="transferTable" class="transfer-table"></div>
        </section>
        <section class="timeline-panel timeline-region" data-timeline-region>
          <div class="timeline-head">
            <div>
              <strong>Activity timeline</strong>
              <div class="hint" id="timelineHint">Select a graph to inspect transfer timing.</div>
            </div>
            <button id="toggleTransfers" type="button">Open transfer list</button>
          </div>
          <div id="activityTimeline" class="activity-timeline"></div>
        </section>
        <select id="layoutMode" class="compat-hidden">
          <option value="layers">layers</option>
        </select>
        <button id="toggleLabels" class="compat-hidden" type="button">Labels on</button>
        <button id="fitGraph" class="compat-hidden" type="button">Fit</button>
        <aside class="details" aria-hidden="true">
          <div id="details" class="details-body empty">Select a completed or partial job to inspect evidence.</div>
        </aside>
      </section>
      <section id="walletIntelligenceWorkspace" class="wallet-intel-workspace" data-wallet-intelligence-workspace hidden>
        <div class="wallet-intel-head">
          <div class="wallet-intel-title-row">
            <div>
              <h2>Wallet Intelligence</h2>
              <div class="hint" id="walletIntelStatus">Load indexed wallet intelligence addresses.</div>
            </div>
            <div class="wallet-intel-warning">This is analyst context, not scoring evidence.</div>
          </div>
          <div class="wallet-intel-filters">
            <div class="wallet-intel-presets" role="group" aria-label="Wallet Intelligence presets">
              <button type="button" data-wallet-intel-preset="intersections" class="active">Intersections</button>
              <button type="button" data-wallet-intel-preset="requesters">By requesters</button>
              <button type="button" data-wallet-intel-preset="unknown_repeated">Unknown repeated</button>
              <button type="button" data-wallet-intel-preset="known_infrastructure">Known infrastructure</button>
              <button type="button" data-wallet-intel-preset="all">All sightings</button>
            </div>
            <label>Address
              <input id="walletIntelAddress" placeholder="Address contains">
            </label>
            <label>Mode
              <select id="walletIntelMode">
                <option value="">All modes</option>
                <option value="address_deep_check">DeepCheck</option>
                <option value="where_is_money_check">Where is money</option>
                <option value="incoming_deposit_check">Incoming deposit</option>
              </select>
            </label>
            <label>Tag
              <select id="walletIntelTag">
                <option value="">All tags</option>
                <option value="repeated_cross_run_address">repeated_cross_run_address</option>
                <option value="high_activity_wallet">high_activity_wallet</option>
                <option value="large_liquidity_wallet">large_liquidity_wallet</option>
                <option value="possible_service_or_exchange_like">possible_service_or_exchange_like</option>
                <option value="known_service_or_exchange">known_service_or_exchange</option>
                <option value="cross_mode_seen">cross_mode_seen</option>
              </select>
            </label>
            <label>Requester
              <input id="walletIntelRequester" placeholder="user or id">
            </label>
            <label>Subject address
              <input id="walletIntelSubjectAddress" placeholder="Checked subject">
            </label>
            <label>Min subjects
              <input id="walletIntelMinSubjects" inputmode="numeric" placeholder="2">
            </label>
            <label>Min requesters
              <input id="walletIntelMinRequesters" inputmode="numeric" placeholder="2">
            </label>
            <label>Max depth
              <input id="walletIntelMaxDepth" inputmode="numeric" placeholder="2">
            </label>
            <label>Service
              <input id="walletIntelServiceCategory" placeholder="cex, bridge">
            </label>
            <label>Status
              <select id="walletIntelJobStatus">
                <option value="">Any status</option>
                <option value="completed">Completed</option>
                <option value="partial">Partial</option>
              </select>
            </label>
            <button id="walletIntelReload" type="button">Reload</button>
          </div>
        </div>
        <div class="wallet-intel-body">
          <div id="walletIntelTable" class="wallet-intel-table"></div>
          <aside id="walletIntelDrawer" class="wallet-intel-drawer">
            <div class="empty">Select an address to inspect requesters, source jobs, and first edges.</div>
          </aside>
        </div>
      </section>
      <section id="theftReportsWorkspace" class="theft-reports-workspace" data-theft-reports-workspace hidden>
        <div class="theft-reports-head">
          <div class="theft-reports-title-row">
            <div>
              <h2>Заявки о краже</h2>
              <div class="hint" id="theftReportsStatus">Предварительные сообщения пользователей. Загрузите заявки для внутренней обработки.</div>
            </div>
            <div class="theft-reports-warning">Внутренняя обработка. Заявка не является доказательством кражи.</div>
          </div>
          <div id="theftReportsStats" class="stats"></div>
          <div class="theft-reports-filters">
            <label>Поиск
              <input id="theftReportsSearch" placeholder="Адрес, tx, user id, комментарий">
            </label>
            <label>Статус обработки
              <select id="theftReportsAdminStatus">
                <option value="">Все статусы</option>
                <option value="new">Новая</option>
                <option value="awaiting_payment">Ждет оплату</option>
                <option value="awaiting_documents">Ждет документы</option>
                <option value="in_progress">В работе</option>
                <option value="escalated">Передано / эскалация</option>
                <option value="closed">Закрыта</option>
                <option value="cancelled">Отменена</option>
              </select>
            </label>
            <label>Статус бота
              <select id="theftReportsBotStatus">
                <option value="">Все bot status</option>
                <option value="draft">draft</option>
                <option value="awaiting_deposit">awaiting_deposit</option>
                <option value="deposit_confirmed">deposit_confirmed</option>
                <option value="documents_requested">documents_requested</option>
                <option value="cancelled">cancelled</option>
              </select>
            </label>
            <label>Лимит
              <select id="theftReportsLimit">
                <option value="20">20</option>
                <option value="50" selected>50</option>
                <option value="100">100</option>
              </select>
            </label>
            <button id="theftReportsReload" type="button">Обновить</button>
          </div>
        </div>
        <div class="theft-reports-body">
          <div id="theftReportsList" class="theft-reports-list"></div>
          <aside id="theftReportDetail" class="theft-report-detail">
            <div class="empty">Выберите заявку для просмотра и внутренней обработки.</div>
          </aside>
        </div>
      </section>
    </section>
  </main>
  <script>
    localStorage.removeItem("adminForensicsLayout");
    const defaultLocalToken = "local-admin-token";
    function initialGraphViewMode() {
      const graphViewMode = localStorage.getItem("adminForensicsGraphViewMode");
      const legacyDensityMode = localStorage.getItem("adminForensicsDensityMode");
      localStorage.removeItem("adminForensicsDensityMode");
      if (graphViewMode !== null) return graphViewMode;
      if (legacyDensityMode === "show_all") {
        localStorage.setItem("adminForensicsGraphViewMode", "show_all");
        return "show_all";
      }
      return "auto";
    }
    const state = {
      token: localStorage.getItem("adminForensicsToken") || defaultLocalToken,
      jobs: [],
      graph: null,
      selected: null,
      activeJobId: null,
      transform: { x: 0, y: 0, scale: 1 },
      layoutMode: "layers",
      txLabelMode: localStorage.getItem("adminForensicsTxLabelMode") || localStorage.getItem("adminForensicsAmountMode") || "auto",
      walletLabelMode: localStorage.getItem("adminForensicsWalletLabelMode") || "smart",
      densityMode: initialGraphViewMode(),
      peerLinksVisible: localStorage.getItem("adminForensicsPeerLinks") !== "off",
      roleMarksVisible: localStorage.getItem("adminForensicsRoleMarks") !== "off",
      labels: localStorage.getItem("adminForensicsLabels") !== "off",
      transferTab: "all",
      analyticsOpen: true,
      scoringAuditOpen: false,
      scoringAudit: null,
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
      jobQueueMode: "all",
      pendingOpenJobId: null,
      nodeDrag: null,
      lastNodeClick: null,
      suppressNextGraphClick: false,
      suppressGraphClickTimer: null,
      renderedNodePositions: new Map(),
      renderedNodesById: new Map(),
      renderedEdgesById: new Map(),
      expandedBundleNodeIds: new Set(),
      expandedSelectedFlowEdgeIds: new Set(),
      walletIntel: { addresses: [], activeAddress: null, detail: null, loading: false, error: null, preset: "intersections" },
      theftReports: { reports: [], activeId: null, detail: null, loading: false, error: null, savePending: false, searchTimer: null, listRequestSeq: 0, detailRequestSeq: 0 }
    };
    if (!["all", "incoming", "outgoing", "self"].includes(state.flowMode)) state.flowMode = "all";
    if (!["auto", "fan", "show_all", "step_orbit", "deep_branch_map", "full_evidence", "compact_summary"].includes(state.densityMode)) state.densityMode = "auto";
    if (!["auto", "all", "important", "selected", "off"].includes(state.txLabelMode)) state.txLabelMode = "auto";
    if (!["smart", "all", "important", "off"].includes(state.walletLabelMode)) state.walletLabelMode = "smart";
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
    function graphRiskClarity(graph) {
      const summary = graphSummary(graph);
      return summary.riskClarity && typeof summary.riskClarity === "object" ? summary.riskClarity : null;
    }
    function clarityLine(value, fallback) {
      return value === null || value === undefined || value === "" ? fallback : String(value);
    }
    function clarityMetricHtml(clarity) {
      if (!clarity) {
        return metric("Coverage status", "unknown") +
          metric("Evidence", "unknown") +
          metric("Policy", "unknown");
      }
      const finalRisk = typeof clarity.finalRiskScore === "number" && Number.isFinite(clarity.finalRiskScore)
        ? String(clarity.finalRiskScore) + " / " + clarityLine(clarity.riskLevel, "unknown")
        : "n/a";
      return metric("Final risk", finalRisk) +
        metric("Coverage status", clarityLine(clarity.coverageStatus, "unknown")) +
        metric("Confidence", typeof clarity.confidenceScore === "number" && Number.isFinite(clarity.confidenceScore) ? String(clarity.confidenceScore) : "n/a") +
        metric("Evidence", clarityLine(clarity.evidenceClass, "unknown")) +
        metric("Decision status", clarityLine(clarity.decisionStatus, "unknown")) +
        metric("Policy", clarityLine(clarity.policyVersion, "unknown")) +
        listMetric("Risk clarity notes", Array.isArray(clarity.displayNotes) ? clarity.displayNotes : [], "No clarity notes.");
    }
    function caseBriefClarityHtml(clarity) {
      if (!clarity) {
        return metric("Coverage", "unknown") +
          metric("Evidence strength", "unknown") +
          metric("Confidence", "n/a") +
          metric("Policy result", "unknown");
      }
      return metric("Coverage", clarityLine(clarity.coverageStatus, "unknown")) +
        metric("Evidence strength", clarityLine(clarity.evidenceClass, "unknown")) +
        metric("Confidence", typeof clarity.confidenceScore === "number" && Number.isFinite(clarity.confidenceScore) ? String(clarity.confidenceScore) : "n/a") +
        metric("Policy result", clarityLine(clarity.decisionStatus, "unknown"));
    }
    const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
    const short = (value, size = 6) => {
      const text = String(value ?? "");
      return text.length > size * 2 + 3 ? text.slice(0, size) + "..." + text.slice(-size) : text;
    };
    const iso = (value) => value ? String(value).replace(".000Z", "Z") : "";
    const classifyStatus = (value) => "status " + escapeHtml(String(value || "unknown").toLowerCase());
    function targetedHistoryRecord(job) {
      return job?.targetedHistory && typeof job.targetedHistory === "object" ? job.targetedHistory : null;
    }
    function targetedHistoryStates(history) {
      return Array.isArray(history?.states) ? history.states : [];
    }
    function candidateWindowSummary(job) {
      const targeted = job?.targetedIndex && typeof job.targetedIndex === "object" ? job.targetedIndex : {};
      const history = targetedHistoryRecord(job) || {};
      return targeted.candidateWindows || history.candidateWindows || null;
    }
    function isLiveJob(job) {
      return job?.status === "queued" || job?.status === "running";
    }
    function isCheckingCandidateWindows(job) {
      return isLiveJob(job) && (job?.jobPhase === "checking_candidate_windows" ||
        job?.targetedIndex?.phase === "checking_candidate_windows" ||
        candidateWindowSummary(job)?.pending > 0);
    }
    function isCheckingBalanceFormingSlice(job) {
      return isLiveJob(job) && (job?.jobPhase === "checking_balance_forming_slice" ||
        job?.balanceFormingSlice?.phase === "checking_balance_forming_slice");
    }
    function isWaitingForTargetedIndex(job) {
      return isLiveJob(job) && (isCheckingCandidateWindows(job) ||
        job?.jobPhase === "waiting_for_targeted_index" ||
        job?.targetedIndex?.phase === "waiting_for_targeted_index" ||
        (job?.status === "queued" && targetedHistoryRecord(job)?.waitingCount > 0));
    }
    function jobDisplayStatus(job) {
      if (isCheckingBalanceFormingSlice(job)) {
        return { label: "CHECKING: BALANCE SLICE", classValue: "checking-balance-slice" };
      }
      if (isCheckingCandidateWindows(job)) {
        return { label: "CHECKING: CANDIDATE WINDOWS", classValue: "checking-candidate-windows" };
      }
      if (isWaitingForTargetedIndex(job)) {
        return { label: "WAITING: TARGETED INDEX", classValue: "waiting-targeted-index" };
      }
      const status = String(job?.status || "unknown");
      return { label: status, classValue: status };
    }
    function ratioPercent(value) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return null;
      return (numeric * 100).toFixed(2).replace(/\.?0+$/, "") + "%";
    }
    function activeTargetedState(history) {
      const states = targetedHistoryStates(history);
      return states.find((state) => state?.status === "running") ||
        states.find((state) => state?.status === "queued") ||
        states.find((state) => state?.waitStatus === "waiting") ||
        states[0] ||
        null;
    }
    function jobLiveProgressLines(job) {
      if (isCheckingBalanceFormingSlice(job)) {
        const slice = job?.balanceFormingSlice && typeof job.balanceFormingSlice === "object" ? job.balanceFormingSlice : {};
        const lines = ["Checking bounded balance-forming slice, not broad targeted indexing"];
        if (slice.address) lines.push("Hop address: " + short(slice.address, 6));
        if (slice.targetTxHash) lines.push("Hop tx: " + short(slice.targetTxHash, 8));
        if (slice.status) lines.push("Slice status: " + String(slice.status).replace(/_/g, " "));
        if (slice.coverageRatio !== null && slice.coverageRatio !== undefined) lines.push("coverage " + ratioPercent(slice.coverageRatio));
        if (slice.fetchedPageCount !== null && slice.fetchedPageCount !== undefined) lines.push("pages " + slice.fetchedPageCount);
        if (slice.fetchedTransferCount !== null && slice.fetchedTransferCount !== undefined) lines.push("transfers " + slice.fetchedTransferCount);
        if (slice.reason) lines.push("reason " + String(slice.reason).replace(/_/g, " "));
        return lines;
      }
      if (!isWaitingForTargetedIndex(job)) return [];
      const targeted = job?.targetedIndex && typeof job.targetedIndex === "object" ? job.targetedIndex : {};
      const history = targetedHistoryRecord(job) || {};
      const state = activeTargetedState(history) || {};
      const lines = [];
      const windows = candidateWindowSummary(job);
      if (isCheckingCandidateWindows(job) && windows) {
        lines.push("Checking candidate windows: " + (windows.complete || 0) + "/" + (windows.total || 0) + " complete");
        if (targeted.broadFallback) lines.push("Broad fallback: " + String(targeted.broadFallback).replace(/_/g, " "));
      }
      const address = state.address || targeted.waitingForAddress || targeted.lastIndexedAddress || targeted.waitingFor?.address || "";
      if (address) lines.push("Indexing history: " + short(address, 6));
      const pages = state.fetchedPageCount ?? history.fetchedPageCount ?? targeted.pagesFetched;
      const budget = state.budgetPages ?? history.maxBudgetPages ?? targeted.budgetPages;
      if (pages !== null && pages !== undefined) lines.push("pages " + pages + (budget !== null && budget !== undefined ? " / budget " + budget : ""));
      const uniqueHashes = state.uniqueCanonicalHashCount ?? history.uniqueCanonicalHashCount;
      const repeat = ratioPercent(state.repeatRatio ?? history.repeatRatio);
      if (uniqueHashes !== null && uniqueHashes !== undefined) lines.push("unique hashes " + uniqueHashes + (repeat ? " / repeat " + repeat : ""));
      const oldest = state.oldestTransferAt || history.oldestTransferAt || targeted.oldestFetchedTransferAt;
      if (oldest) lines.push("oldest " + oldest);
      if (state.lockOwner || state.lockedUntil) lines.push("lock " + (state.lockOwner || "unknown") + (state.lockedUntil ? " until " + state.lockedUntil : ""));
      lines.push("states q/r/c/p/f: " +
        (history.queuedCount ?? 0) + "/" +
        (history.runningCount ?? 0) + "/" +
        (history.completeCount ?? 0) + "/" +
        (history.partialCount ?? 0) + "/" +
        (history.failedCount ?? 0));
      lines.push("provider errors 429/403/5xx: " +
        (history.rateLimitedCount ?? targeted.rateLimitedCount ?? 0) + "/" +
        (history.forbiddenCount ?? targeted.forbiddenCount ?? 0) + "/" +
        (history.serverErrorCount ?? targeted.serverErrorCount ?? 0));
      return lines;
    }
    const explorerLink = (url, label) => url ? '<a class="link" data-explorer-link="true" href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(label) + '</a>' : escapeHtml(label);
    const transferEdges = () => graphEdges(state.graph).filter((edge) => edge?.type !== "stop" && edgeDisplayRole(edge) !== "stop");
    const tronscanAddressUrl = (address) => address && String(address).startsWith("T") ? "https://tronscan.org/#/address/" + encodeURIComponent(address) : "";
    const tronscanTxUrl = (txHash) => txHash ? "https://tronscan.org/#/transaction/" + encodeURIComponent(txHash) : "";
    function graphAddressFromNodeId(value) {
      const text = String(value || "");
      return text.startsWith("addr:") ? text.slice(5) : "";
    }
    function nodeById(nodeId) {
      return graphNodes(state.graph).find((node) => node.id === nodeId) || state.renderedNodesById.get(nodeId) || null;
    }
    function edgeById(edgeId) {
      return graphEdges(state.graph).find((edge) => edge.id === edgeId) || state.renderedEdgesById.get(edgeId) || null;
    }
    function nodeAddress(node) {
      if (!node) return "";
      if (node.address) return node.address;
      return graphAddressFromNodeId(node.id);
    }
    function nodeTronScanUrl(node) {
      return node?.tronScanUrl || tronscanAddressUrl(nodeAddress(node));
    }
    function edgeFromAddress(edge) {
      return edge?.fromAddress || nodeAddress(nodeById(edge?.fromNodeId)) || graphAddressFromNodeId(edge?.fromNodeId) || edge?.fromNodeId || "";
    }
    function edgeToAddress(edge) {
      return edge?.toAddress || nodeAddress(nodeById(edge?.toNodeId)) || graphAddressFromNodeId(edge?.toNodeId) || edge?.toNodeId || "";
    }
    function edgeFromTronScanUrl(edge) {
      return edge?.fromTronScanUrl || tronscanAddressUrl(edgeFromAddress(edge));
    }
    function edgeToTronScanUrl(edge) {
      return edge?.toTronScanUrl || tronscanAddressUrl(edgeToAddress(edge));
    }
    function edgeEvidenceEndpoint(edge, side) {
      const transfer = asArray(edge?.metadata?.underlyingTransfers).find((item) => item && typeof item === "object") || {};
      if (side === "from") {
        return transfer?.fromAddress || transfer?.sourceAddress || edge?.metadata?.sourceAddress || edge?.metadata?.victimAddress || edgeFromAddress(edge);
      }
      return transfer?.toAddress || transfer?.receiverAddress || edge?.metadata?.receiverAddress || edgeToAddress(edge);
    }
    function edgeHasAggregatedTxEvidence(edge) {
      if (edge?.txHash) return false;
      const txHashes = asArray(edge?.metadata?.txHashes);
      const underlyingTransfers = asArray(edge?.metadata?.underlyingTransfers);
      const count = Number(edge?.metadata?.aggregateTransferCount ?? edge?.metadata?.transferCount ?? edge?.metadata?.txCount);
      return edge?.metadata?.evidenceType === "grouped_transfers" ||
        txHashes.length > 1 ||
        underlyingTransfers.length > 1 ||
        (Number.isFinite(count) && count > 1);
    }
    function edgePrimaryTxHash(edge) {
      if (edge?.txHash) return edge.txHash;
      if (edgeHasAggregatedTxEvidence(edge)) return "";
      return asArray(edge?.metadata?.txHashes)[0] || "";
    }
    function edgeTxHashes(edge) {
      const hashes = [];
      if (edge?.txHash) hashes.push(edge.txHash);
      asArray(edge?.metadata?.txHashes).forEach((hash) => hashes.push(hash));
      asArray(edge?.metadata?.profileTxHashes).forEach((hash) => hashes.push(hash));
      asArray(edge?.metadata?.underlyingTransfers).forEach((transfer) => {
        if (transfer?.txHash) hashes.push(transfer.txHash);
      });
      return [...new Set(hashes.filter((hash) => typeof hash === "string" && hash.length > 0))];
    }
    function txHashLinksHtml(txHashes, limit = 80) {
      const values = asArray(txHashes).filter((hash) => typeof hash === "string" && hash.length > 0);
      if (values.length === 0) return '<span class="muted">No tx hashes stored.</span>';
      const visible = values.slice(0, limit);
      const hidden = values.length - visible.length;
      return '<div class="tx-links">' + visible.map((hash) =>
        '<span class="tx-chip">' + explorerLink(tronscanTxUrl(hash), short(hash, 8)) + '</span>'
      ).join("") + (hidden > 0 ? '<span class="tx-chip muted">+' + hidden + ' more</span>' : "") + '</div>';
    }
    function edgeTxTronScanUrl(edge) {
      return edge?.txTronScanUrl || tronscanTxUrl(edgePrimaryTxHash(edge));
    }
    function edgePrimaryTxDetailHtml(edge) {
      const txHash = edgePrimaryTxHash(edge);
      return txHash ? txDetailLink(txHash) : '<span class="muted">See transaction list below.</span>';
    }
    async function api(path, options = {}) {
      const response = await fetch(path, {
        ...options,
        headers: {
          "content-type": "application/json",
          ...(options.headers || {}),
          Authorization: "Bearer " + state.token
        }
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Request failed");
      return body;
    }
    function setStatus(message) {
      el("selectionHint").textContent = message;
    }
    function walletIntelligenceActive() {
      return window.location.pathname === "/admin/wallet-intelligence";
    }
    function theftReportsActive() {
      return window.location.pathname === "/admin/theft-reports";
    }
    function activeWorkspacePath() {
      if (walletIntelligenceActive()) return "/admin/wallet-intelligence";
      if (theftReportsActive()) return "/admin/theft-reports";
      return "/admin/forensics";
    }
    function syncWorkspaceVisibility() {
      const walletActive = walletIntelligenceActive();
      const theftActive = theftReportsActive();
      const graphShell = document.querySelector("[data-workbench-shell]");
      const walletShell = document.querySelector("[data-wallet-intelligence-workspace]");
      const theftShell = document.querySelector("[data-theft-reports-workspace]");
      if (graphShell) graphShell.hidden = walletActive || theftActive;
      if (walletShell) walletShell.hidden = !walletActive;
      if (theftShell) theftShell.hidden = !theftActive;
      document.querySelectorAll("[data-workspace-link]").forEach((link) => {
        const active = link.getAttribute("href") === activeWorkspacePath();
        link.classList.toggle("active", active);
        if (active) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      });
    }
    function setWalletIntelligenceStatus(message) {
      el("walletIntelStatus").textContent = message;
      if (walletIntelligenceActive()) setStatus(message);
    }
    function walletIntelText(value, fallback = "n/a") {
      return value === null || value === undefined || value === "" ? fallback : String(value);
    }
    function walletIntelAmount(rawValue) {
      if (rawValue === null || rawValue === undefined || rawValue === "") return "n/a";
      return formatRawUsdt(rawValue) || String(rawValue);
    }
    function walletIntelTime(value) {
      return formatJobTime(value) || walletIntelText(value);
    }
    function walletIntelKnownInfrastructure(item) {
      const tags = asArray(item?.tags);
      const services = asArray(item?.serviceCategories);
      const labels = asArray(item?.labelHints);
      if (tags.includes("known_service_or_exchange")) return true;
      if (services.length > 0) return true;
      return labels.some((label) => /binance|bybit|bitget|bridge|router|exchange|cex/i.test(String(label || "")));
    }
    function walletIntelDepthText(item) {
      const minDepth = item?.minDepth;
      const maxDepth = item?.maxDepth;
      if (minDepth === null || minDepth === undefined || maxDepth === null || maxDepth === undefined) return "n/a";
      return String(minDepth) === String(maxDepth) ? String(minDepth) : String(minDepth) + "-" + String(maxDepth);
    }
    function walletIntelModesText(item) {
      const modes = asArray(item?.modes).map(humanCheckKind).filter(Boolean);
      return modes.length ? modes.join(" + ") : "mode n/a";
    }
    function walletIntelWhyInteresting(item) {
      const subjectCount = Number(item?.uniqueSubjectCount || 0);
      const requesterCount = Number(item?.uniqueRequesterCount || 0);
      const prefix = walletIntelKnownInfrastructure(item)
        ? "Known infrastructure context"
        : subjectCount >= 2
          ? "Seen in " + subjectCount + " subjects"
          : requesterCount >= 2
            ? "Seen across " + requesterCount + " requesters"
            : "Single-context sighting";
      const requesterText = subjectCount >= 2 ? ", " + requesterCount + " requesters" : "";
      return prefix + requesterText + ", " + walletIntelModesText(item) + ", depth " + walletIntelDepthText(item);
    }
    function walletIntelPresetFilters(preset) {
      if (preset === "intersections") return { minUniqueSubjects: "2" };
      if (preset === "requesters") return { minUniqueRequesters: "2" };
      if (preset === "unknown_repeated") return { minUniqueSubjects: "2", tag: "repeated_cross_run_address" };
      if (preset === "known_infrastructure") return { tag: "known_service_or_exchange" };
      if (preset === "cross_mode") return { tag: "cross_mode_seen" };
      if (preset === "low_depth") return { maxDepth: "2", minUniqueSubjects: "2" };
      return {};
    }
    function applyWalletIntelPreset(preset) {
      state.walletIntel.preset = preset || "intersections";
      const filters = walletIntelPresetFilters(state.walletIntel.preset);
      el("walletIntelMinSubjects").value = filters.minUniqueSubjects || "";
      el("walletIntelMinRequesters").value = filters.minUniqueRequesters || "";
      el("walletIntelMaxDepth").value = filters.maxDepth || "";
      el("walletIntelTag").value = filters.tag || "";
      document.querySelectorAll("[data-wallet-intel-preset]").forEach((button) => {
        button.classList.toggle("active", button.getAttribute("data-wallet-intel-preset") === state.walletIntel.preset);
      });
    }
    function walletIntelAddressLink(address) {
      return address ? explorerLink(tronscanAddressUrl(address), short(address, 8)) : '<span class="muted">address n/a</span>';
    }
    function walletIntelJobLink(jobId) {
      return jobId ? '<a class="link" href="/admin/forensics?job=' + encodeURIComponent(jobId) + '">' + escapeHtml(short(jobId, 8)) + '</a>' : '<span class="muted">job n/a</span>';
    }
    function tagPills(values, empty = "none") {
      const items = asArray(values).filter((value) => value !== null && value !== undefined && value !== "");
      if (items.length === 0) return '<span class="muted">' + escapeHtml(empty) + '</span>';
      return '<div class="wallet-intel-pills">' + items.map((value) => '<span class="wallet-intel-pill">' + escapeHtml(value) + '</span>').join("") + '</div>';
    }
    function walletIntelLine(label, value) {
      return '<div class="wallet-intel-line"><span>' + escapeHtml(label) + '</span><strong>' + value + '</strong></div>';
    }
    function renderWalletIntelligenceTable() {
      const root = el("walletIntelTable");
      if (state.walletIntel.loading) {
        root.innerHTML = '<div class="empty">Loading wallet intelligence addresses...</div>';
        return;
      }
      if (state.walletIntel.error && state.walletIntel.addresses.length === 0) {
        root.innerHTML = '<div class="error">' + escapeHtml(state.walletIntel.error) + '</div>';
        return;
      }
      if (state.walletIntel.addresses.length === 0) {
        root.innerHTML = '<div class="empty">No wallet intelligence addresses loaded.</div>';
        return;
      }
      const rows = state.walletIntel.addresses.map((item) => {
        const infra = walletIntelKnownInfrastructure(item);
        const active = item.address === state.walletIntel.activeAddress ? ' class="active"' : "";
        return '<tr' + active + ' data-wallet-intel-address="' + escapeHtml(item.address) + '">' +
          '<td><button type="button" class="wallet-intel-address-button" data-wallet-intel-address="' + escapeHtml(item.address) + '">' + escapeHtml(short(item.address, 8)) + '</button><div class="muted">' + escapeHtml(item.address) + '</div></td>' +
          '<td><span class="wallet-intel-kind ' + (infra ? "infra" : "unknown") + '">' + escapeHtml(infra ? "Known infrastructure" : "Investigate") + '</span><div class="muted">' + tagPills(item.serviceCategories, "No service") + '</div></td>' +
          '<td>' + escapeHtml(walletIntelWhyInteresting(item)) + '</td>' +
          '<td>' + tagPills(item.tags, "No tags") + '</td>' +
          '<td>' + tagPills(item.modes, "No modes") + '</td>' +
          '<td>' + escapeHtml(walletIntelText(item.uniqueSubjectCount, "0")) + '</td>' +
          '<td>' + escapeHtml(walletIntelText(item.uniqueRequesterCount, "0")) + '</td>' +
          '<td>' + escapeHtml(walletIntelText(item.jobCount, "0") + " / " + walletIntelText(item.occurrenceCount, "0")) + '</td>' +
          '<td>' + escapeHtml(walletIntelText(item.minDepth) + " - " + walletIntelText(item.maxDepth)) + '</td>' +
          '<td>' + escapeHtml(walletIntelText(item.distinctTxCount, "0")) + '</td>' +
          '<td>' + escapeHtml(walletIntelAmount(item.distinctAmountRaw)) + '</td>' +
          '<td>' + escapeHtml(walletIntelTime(item.firstSeenAt)) + '</td>' +
          '<td>' + escapeHtml(walletIntelTime(item.lastSeenAt)) + '</td>' +
          '</tr>';
      }).join("");
      root.innerHTML = '<table><thead><tr>' +
        '<th>Address</th><th>Class</th><th>Why interesting</th><th>Tags</th><th>Modes</th><th>Subjects</th><th>Requesters</th><th>Jobs / occurrences</th><th>Depth</th><th>Distinct tx</th><th>Distinct amount</th><th>First seen</th><th>Last seen</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>';
    }
    async function loadWalletIntelligenceAddresses() {
      state.token = el("token").value.trim();
      localStorage.setItem("adminForensicsToken", state.token);
      el("sessionState").textContent = state.token ? "session active" : "token missing";
      const params = new URLSearchParams();
      params.set("limit", "50");
      const filters = [
        ["address", el("walletIntelAddress").value.trim()],
        ["mode", el("walletIntelMode").value],
        ["tag", el("walletIntelTag").value],
        ["requester", el("walletIntelRequester").value.trim()],
        ["subjectAddress", el("walletIntelSubjectAddress").value.trim()],
        ["minUniqueSubjects", el("walletIntelMinSubjects").value.trim()],
        ["minUniqueRequesters", el("walletIntelMinRequesters").value.trim()],
        ["maxDepth", el("walletIntelMaxDepth").value.trim()],
        ["serviceCategory", el("walletIntelServiceCategory").value.trim()],
        ["jobStatus", el("walletIntelJobStatus").value]
      ];
      filters.forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      state.walletIntel.loading = true;
      state.walletIntel.error = null;
      renderWalletIntelligenceTable();
      renderWalletIntelligenceDrawer();
      try {
        setWalletIntelligenceStatus("Loading wallet intelligence addresses...");
        const body = await api("/admin/api/wallet-intelligence/addresses?" + params.toString());
        state.walletIntel.addresses = asArray(body.addresses);
        if (!state.walletIntel.addresses.some((item) => item.address === state.walletIntel.activeAddress)) {
          state.walletIntel.activeAddress = null;
          state.walletIntel.detail = null;
        }
        state.walletIntel.loading = false;
        renderWalletIntelligenceTable();
        renderWalletIntelligenceDrawer();
        setWalletIntelligenceStatus(state.walletIntel.addresses.length + " wallet intelligence addresses loaded.");
      } catch (error) {
        state.walletIntel.loading = false;
        state.walletIntel.error = error?.message || "Wallet intelligence load failed.";
        state.walletIntel.addresses = [];
        state.walletIntel.activeAddress = null;
        state.walletIntel.detail = null;
        renderWalletIntelligenceTable();
        renderWalletIntelligenceDrawer();
        setWalletIntelligenceStatus("Wallet intelligence load failed.");
      }
    }
    async function openWalletIntelligenceAddress(address) {
      if (!address) return;
      state.walletIntel.activeAddress = address;
      state.walletIntel.detail = null;
      state.walletIntel.error = null;
      renderWalletIntelligenceTable();
      renderWalletIntelligenceDrawer();
      try {
        setWalletIntelligenceStatus("Loading wallet intelligence address detail...");
        const body = await api("/admin/api/wallet-intelligence/addresses/" + encodeURIComponent(address));
        state.walletIntel.detail = body.detail || null;
        renderWalletIntelligenceDrawer();
        setWalletIntelligenceStatus("Wallet intelligence address loaded.");
      } catch (error) {
        state.walletIntel.error = error?.message || "Wallet intelligence detail failed.";
        renderWalletIntelligenceDrawer();
        setWalletIntelligenceStatus("Wallet intelligence detail failed.");
      }
    }
    function walletIntelGraphNodeLabel(value) {
      return short(walletIntelText(value, "unknown"), 6);
    }
    function walletIntelGraphEdgeColor(edge) {
      const direction = String(edge?.moneyDirection || edge?.direction || edge?.edgeRole || "").toLowerCase();
      if (direction.includes("incoming") || direction === "in") return "var(--semantic-money-in)";
      if (direction.includes("outgoing") || direction === "out") return "var(--semantic-money-out)";
      if (String(edge?.sourceKind || "").toLowerCase().includes("service")) return "var(--semantic-service)";
      return "var(--semantic-context)";
    }
    function renderWalletIntelFocusedGraph(detail, address) {
      const centerAddress = walletIntelText(address, "selected");
      const centerKey = String(centerAddress).toLowerCase();
      const edges = asArray(detail?.edges).filter((edge) => {
        const fromKey = String(walletIntelText(edge?.fromAddress, "")).toLowerCase();
        const toKey = String(walletIntelText(edge?.toAddress, "")).toLowerCase();
        return fromKey && toKey && (fromKey === centerKey || toKey === centerKey);
      }).slice(0, 12);
      if (edges.length === 0) return '<div class="empty">No stored edges for focused graph.</div>';

      const nodes = [{ key: centerKey, value: centerAddress, selected: true }];
      const seen = new Set([centerKey]);
      edges.forEach((edge) => {
        [edge.fromAddress, edge.toAddress].forEach((value) => {
          const text = walletIntelText(value, "");
          const key = String(text).toLowerCase();
          if (!text || seen.has(key) || nodes.length >= 9) return;
          seen.add(key);
          nodes.push({ key, value: text, selected: false });
        });
      });

      const width = 360;
      const height = 190;
      const center = { x: width / 2, y: height / 2 };
      const positions = new Map();
      const peerCount = Math.max(nodes.length - 1, 1);
      nodes.forEach((node, index) => {
        if (index === 0) {
          positions.set(node.key, center);
          return;
        }
        const angle = -Math.PI / 2 + (2 * Math.PI * (index - 1)) / peerCount;
        positions.set(node.key, {
          x: Math.round(center.x + Math.cos(angle) * 125),
          y: Math.round(center.y + Math.sin(angle) * 62)
        });
      });

      const edgeHtml = edges.map((edge) => {
        const fromKey = String(walletIntelText(edge.fromAddress, "")).toLowerCase();
        const toKey = String(walletIntelText(edge.toAddress, "")).toLowerCase();
        const from = positions.get(fromKey);
        const to = positions.get(toKey);
        if (!from || !to || fromKey === toKey) return "";
        const label = walletIntelAmount(edge.amountRaw);
        const labelX = Math.round((from.x + to.x) / 2);
        const labelY = Math.round((from.y + to.y) / 2) - 7;
        return '<line class="wallet-intel-ego-edge" x1="' + from.x + '" y1="' + from.y + '" x2="' + to.x + '" y2="' + to.y + '" style="stroke: ' + walletIntelGraphEdgeColor(edge) + '"></line>' +
          '<text class="wallet-intel-ego-edge-label" x="' + labelX + '" y="' + labelY + '" text-anchor="middle">' + escapeHtml(label) + '</text>';
      }).join("");
      const nodeHtml = nodes.map((node) => {
        const point = positions.get(node.key);
        return '<g class="wallet-intel-ego-node' + (node.selected ? " selected" : "") + '" transform="translate(' + point.x + " " + point.y + ')">' +
          '<title>' + escapeHtml(node.value) + '</title>' +
          '<circle r="18"></circle>' +
          '<text y="4">' + escapeHtml(walletIntelGraphNodeLabel(node.value)) + '</text>' +
          '</g>';
      }).join("");
      return '<div class="wallet-intel-ego-graph"><svg viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="Focused Wallet Intelligence graph">' +
        edgeHtml + nodeHtml +
        '</svg></div>';
    }
    function renderWalletIntelligenceDrawer() {
      const root = el("walletIntelDrawer");
      const address = state.walletIntel.activeAddress;
      if (!address) {
        root.innerHTML = '<div class="empty">Select an address to inspect requesters, source jobs, and first edges.</div>';
        return;
      }
      if (state.walletIntel.error && !state.walletIntel.detail) {
        root.innerHTML = '<div class="error">' + escapeHtml(state.walletIntel.error) + '</div>';
        return;
      }
      const detail = state.walletIntel.detail;
      if (!detail) {
        root.innerHTML = '<div class="empty">Loading address detail...</div>';
        return;
      }
      const summary = detail.summary || {};
      const requesters = asArray(detail.requesters);
      const jobs = asArray(detail.jobs);
      const sightings = asArray(detail.sightings).slice(0, 50);
      const edges = asArray(detail.edges).slice(0, 25);
      const summaryHtml = '<section class="wallet-intel-section"><h3>Summary</h3><div class="wallet-intel-meta">' +
        walletIntelLine("Address", walletIntelAddressLink(summary.address || address)) +
        walletIntelLine("Unique subjects", escapeHtml(walletIntelText(summary.uniqueSubjectCount, "0"))) +
        walletIntelLine("Unique requesters", escapeHtml(walletIntelText(summary.uniqueRequesterCount, "0"))) +
        walletIntelLine("Jobs", escapeHtml(walletIntelText(summary.jobCount, "0") + " (" + walletIntelText(summary.completedJobCount, "0") + " completed, " + walletIntelText(summary.partialJobCount, "0") + " partial)")) +
        walletIntelLine("Occurrences", escapeHtml(walletIntelText(summary.occurrenceCount, "0"))) +
        walletIntelLine("Depth", escapeHtml(walletIntelText(summary.minDepth) + " - " + walletIntelText(summary.maxDepth))) +
        walletIntelLine("Distinct tx", escapeHtml(walletIntelText(summary.distinctTxCount, "0"))) +
        walletIntelLine("Distinct amount", escapeHtml(walletIntelAmount(summary.distinctAmountRaw))) +
        walletIntelLine("First seen", escapeHtml(walletIntelTime(summary.firstSeenAt))) +
        walletIntelLine("Last seen", escapeHtml(walletIntelTime(summary.lastSeenAt))) +
        walletIntelLine("Modes", tagPills(summary.modes, "No modes")) +
        walletIntelLine("Tags", tagPills(summary.tags, "No tags")) +
        walletIntelLine("Services", tagPills(summary.serviceCategories, "No service categories")) +
        walletIntelLine("Labels", tagPills(summary.labelHints, "No labels")) +
        '</div></section>';
      const focusedGraphHtml = '<section class="wallet-intel-section"><h3>Focused graph</h3>' +
        renderWalletIntelFocusedGraph(detail, summary.address || address) +
        '</section>';
      const requesterHtml = '<section class="wallet-intel-section"><h3>Requesters</h3><div class="wallet-intel-list">' +
        (requesters.length ? requesters.map((requester) => '<div class="wallet-intel-item">' +
          walletIntelLine("requestedBy", escapeHtml(walletIntelText(requester.requestedBy))) +
          walletIntelLine("telegramUserId", escapeHtml(walletIntelText(requester.telegramUserId))) +
          walletIntelLine("username", escapeHtml(walletIntelText(requester.username))) +
          walletIntelLine("chatId", escapeHtml(walletIntelText(requester.chatId))) +
          walletIntelLine("messageId", escapeHtml(walletIntelText(requester.messageId))) +
          walletIntelLine("locale", escapeHtml(walletIntelText(requester.locale))) +
          walletIntelLine("jobCount", escapeHtml(walletIntelText(requester.jobCount, "0"))) +
          '</div>').join("") : '<div class="empty">No requesters stored.</div>') +
        '</div></section>';
      const jobsHtml = '<section class="wallet-intel-section"><h3>Source jobs</h3><div class="wallet-intel-list">' +
        (jobs.length ? jobs.map((job) => '<div class="wallet-intel-item">' +
          walletIntelLine("Job", walletIntelJobLink(job.jobId)) +
          walletIntelLine("Mode", escapeHtml(humanCheckKind(job.jobKind))) +
          walletIntelLine("Status", escapeHtml(walletIntelText(job.jobStatus))) +
          walletIntelLine("Subject", walletIntelAddressLink(job.subjectAddress)) +
          walletIntelLine("Completed", escapeHtml(walletIntelTime(job.completedAt))) +
          '</div>').join("") : '<div class="empty">No source jobs stored.</div>') +
        '</div></section>';
      const sightingsHtml = '<section class="wallet-intel-section"><h3>Sightings</h3><div class="wallet-intel-list wallet-intel-tx">' +
        (sightings.length ? sightings.map((sighting) => {
          const tx = sighting.txHash ? explorerLink(tronscanTxUrl(sighting.txHash), short(sighting.txHash, 8)) : '<span class="muted">tx n/a</span>';
          return '<div class="wallet-intel-item">' +
            walletIntelLine("Source job", walletIntelJobLink(sighting.jobId)) +
            walletIntelLine("Subject", walletIntelAddressLink(sighting.subjectAddress)) +
            walletIntelLine("Tx", tx) +
            walletIntelLine("Amount", escapeHtml(walletIntelAmount(sighting.amountRaw))) +
            walletIntelLine("Mode", escapeHtml(humanCheckKind(sighting.jobKind))) +
            walletIntelLine("Role", escapeHtml(walletIntelText(sighting.role))) +
            walletIntelLine("Source", escapeHtml(walletIntelText(sighting.sourceKind))) +
            walletIntelLine("Depth/path", escapeHtml(walletIntelText(sighting.depth) + " / " + walletIntelText(sighting.pathId))) +
            walletIntelLine("First seen", escapeHtml(walletIntelTime(sighting.firstSeenAt))) +
            walletIntelLine("Last seen", escapeHtml(walletIntelTime(sighting.lastSeenAt))) +
            '</div>';
        }).join("") : '<div class="empty">No sightings stored.</div>') +
        '</div></section>';
      const edgesHtml = '<section class="wallet-intel-section"><h3>First edges</h3><div class="wallet-intel-list wallet-intel-tx">' +
        (edges.length ? edges.map((edge) => {
          const tx = edge.txHash ? explorerLink(tronscanTxUrl(edge.txHash), short(edge.txHash, 8)) : '<span class="muted">tx n/a</span>';
          return '<div class="wallet-intel-item">' +
            walletIntelLine("Tx", tx) +
            walletIntelLine("From", walletIntelAddressLink(edge.fromAddress)) +
            walletIntelLine("To", walletIntelAddressLink(edge.toAddress)) +
            walletIntelLine("Amount", escapeHtml(walletIntelAmount(edge.amountRaw))) +
            walletIntelLine("Time", escapeHtml(walletIntelTime(edge.timestamp))) +
            walletIntelLine("Mode", escapeHtml(humanCheckKind(edge.jobKind))) +
            walletIntelLine("Role", escapeHtml(walletIntelText(edge.edgeRole))) +
            walletIntelLine("Source", escapeHtml(walletIntelText(edge.sourceKind))) +
            walletIntelLine("Depth/path", escapeHtml(walletIntelText(edge.depth) + " / " + walletIntelText(edge.pathId))) +
            '</div>';
        }).join("") : '<div class="empty">No edges stored.</div>') +
        '</div></section>';
      root.innerHTML = summaryHtml + focusedGraphHtml + requesterHtml + jobsHtml + sightingsHtml + edgesHtml;
    }
    const theftReportAdminStatusLabels = {
      new: "Новая",
      awaiting_payment: "Ждет оплату",
      awaiting_documents: "Ждет документы",
      in_progress: "В работе",
      escalated: "Передано / эскалация",
      closed: "Закрыта",
      cancelled: "Отменена"
    };
    function theftReportAdminStatusLabel(value) {
      return theftReportAdminStatusLabels[value] || value || "n/a";
    }
    function setTheftReportsStatus(message) {
      el("theftReportsStatus").textContent = message;
      if (theftReportsActive()) setStatus(message);
    }
    function theftReportTime(value) {
      return formatJobTime(value) || (value ? String(value) : "n/a");
    }
    function theftReportAddressLink(address) {
      return address ? explorerLink(tronscanAddressUrl(address), short(address, 8)) : '<span class="muted">адрес не указан</span>';
    }
    function theftReportTxLink(txHash) {
      return txHash ? explorerLink(tronscanTxUrl(txHash), short(txHash, 8)) : '<span class="muted">tx не указан</span>';
    }
    function theftReportField(label, value) {
      return '<div class="theft-report-field"><span>' + escapeHtml(label) + '</span><strong>' + value + '</strong></div>';
    }
    function theftReportCopyBlock(report) {
      return [
        "Заявка о краже: " + (report.id || ""),
        "Статус обработки: " + theftReportAdminStatusLabel(report.adminStatus),
        "Статус бота: " + (report.status || ""),
        "Telegram ID: " + (report.telegramUserId || ""),
        "Кошелек клиента: " + (report.victimAddress || ""),
        "Получатель: " + (report.reportedScamAddress || ""),
        "Сумма: " + (report.amountUsdt || "") + " USDT",
        "Tx: " + (report.txHash || ""),
        "Комментарий: " + (report.comment || ""),
        "Внутренняя заметка: " + (report.adminNote || "")
      ].join("\\n");
    }
    function renderTheftReportsStats() {
      const counts = state.theftReports.reports.reduce((acc, report) => {
        const key = report.adminStatus || "unknown";
        acc.total += 1;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, { total: 0 });
      el("theftReportsStats").innerHTML = [
        ["Всего", counts.total],
        ["Новые", counts.new || 0],
        ["Ждут документы", counts.awaiting_documents || 0],
        ["В работе", counts.in_progress || 0],
        ["Закрыты", counts.closed || 0]
      ].map(([label, value]) => '<span class="chip">' + escapeHtml(label) + ': ' + escapeHtml(value) + '</span>').join("");
    }
    function renderTheftReportsList() {
      const root = el("theftReportsList");
      renderTheftReportsStats();
      if (state.theftReports.loading) {
        root.innerHTML = '<div class="empty">Загружаем заявки...</div>';
        return;
      }
      if (state.theftReports.error && state.theftReports.reports.length === 0) {
        root.innerHTML = '<div class="error">' + escapeHtml(state.theftReports.error) + '</div>';
        return;
      }
      if (state.theftReports.reports.length === 0) {
        root.innerHTML = '<div class="empty">Заявок по текущим фильтрам нет.</div>';
        return;
      }
      root.innerHTML = state.theftReports.reports.map((report) => {
        const active = report.id === state.theftReports.activeId ? " active" : "";
        const statusClass = classifyStatus(report.adminStatus === "closed" ? "completed" : report.adminStatus === "cancelled" ? "failed" : "review");
        return '<button type="button" class="theft-report-row' + active + '" data-theft-report-id="' + escapeHtml(report.id) + '">' +
          '<div class="theft-report-title"><span class="theft-report-amount">' + escapeHtml((report.amountUsdt || "0") + " USDT") + '</span><span class="' + statusClass + '">' + escapeHtml(theftReportAdminStatusLabel(report.adminStatus)) + '</span></div>' +
          '<div class="theft-report-meta"><span>бот: ' + escapeHtml(report.status || "n/a") + '</span><span>tg:' + escapeHtml(report.telegramUserId || "n/a") + '</span><span>' + escapeHtml(theftReportTime(report.adminUpdatedAt || report.updatedAt || report.createdAt)) + '</span></div>' +
          '<div class="job-line"><strong>Кошелек клиента:</strong> ' + escapeHtml(short(report.victimAddress, 8)) + '</div>' +
          '<div class="job-line"><strong>Получатель:</strong> ' + escapeHtml(short(report.reportedScamAddress, 8)) + '</div>' +
          '</button>';
      }).join("");
      root.querySelectorAll("[data-theft-report-id]").forEach((button) => {
        button.addEventListener("click", () => openTheftReport(button.getAttribute("data-theft-report-id") || ""));
      });
    }
    async function loadTheftReports() {
      const requestSeq = ++state.theftReports.listRequestSeq;
      state.token = el("token").value.trim();
      localStorage.setItem("adminForensicsToken", state.token);
      el("sessionState").textContent = state.token ? "session active" : "token missing";
      const params = new URLSearchParams();
      if (el("theftReportsSearch").value.trim()) params.set("query", el("theftReportsSearch").value.trim());
      if (el("theftReportsAdminStatus").value) params.set("adminStatus", el("theftReportsAdminStatus").value);
      if (el("theftReportsBotStatus").value) params.set("botStatus", el("theftReportsBotStatus").value);
      params.set("limit", el("theftReportsLimit").value || "50");
      state.theftReports.loading = true;
      state.theftReports.error = null;
      renderTheftReportsList();
      renderTheftReportDetail();
      try {
        setTheftReportsStatus("Загружаем заявки...");
        const body = await api("/admin/api/theft-reports?" + params.toString());
        if (requestSeq !== state.theftReports.listRequestSeq) return;
        state.theftReports.reports = asArray(body.reports);
        const activeReport = state.theftReports.reports.find((report) => report.id === state.theftReports.activeId);
        if (activeReport) {
          state.theftReports.detailRequestSeq += 1;
          state.theftReports.detail = activeReport;
        } else {
          state.theftReports.detailRequestSeq += 1;
          state.theftReports.activeId = state.theftReports.reports[0]?.id || null;
          state.theftReports.detail = state.theftReports.reports[0] || null;
        }
        state.theftReports.loading = false;
        renderTheftReportsList();
        renderTheftReportDetail();
        setTheftReportsStatus(state.theftReports.reports.length + " заявок загружено.");
      } catch (error) {
        if (requestSeq !== state.theftReports.listRequestSeq) return;
        state.theftReports.loading = false;
        state.theftReports.error = error?.message || "Не удалось загрузить заявки.";
        state.theftReports.reports = [];
        state.theftReports.activeId = null;
        state.theftReports.detail = null;
        renderTheftReportsList();
        renderTheftReportDetail();
        setTheftReportsStatus("Не удалось загрузить заявки.");
      }
    }
    async function openTheftReport(reportId) {
      if (!reportId) return;
      const requestSeq = ++state.theftReports.detailRequestSeq;
      state.theftReports.activeId = reportId;
      state.theftReports.detail = state.theftReports.reports.find((report) => report.id === reportId) || null;
      renderTheftReportsList();
      renderTheftReportDetail();
      try {
        const body = await api("/admin/api/theft-reports/" + encodeURIComponent(reportId));
        if (requestSeq !== state.theftReports.detailRequestSeq || state.theftReports.activeId !== reportId) return;
        state.theftReports.detail = body.report || state.theftReports.detail;
        renderTheftReportDetail();
      } catch (error) {
        if (requestSeq !== state.theftReports.detailRequestSeq || state.theftReports.activeId !== reportId) return;
        state.theftReports.error = error?.message || "Не удалось загрузить заявку.";
        renderTheftReportDetail();
      }
    }
    function renderTheftReportDetail() {
      const root = el("theftReportDetail");
      const report = state.theftReports.detail;
      if (state.theftReports.loading && !report) {
        root.innerHTML = '<div class="empty">Загружаем выбранную заявку...</div>';
        return;
      }
      if (!report) {
        root.innerHTML = '<div class="empty">Выберите заявку для просмотра и внутренней обработки.</div>';
        return;
      }
      const copyText = escapeHtml(theftReportCopyBlock(report));
      root.innerHTML = '<div class="theft-report-card">' +
        '<section class="theft-report-section"><h3>Факты транзакции</h3><div class="theft-report-grid">' +
          theftReportField("Кошелек клиента", theftReportAddressLink(report.victimAddress)) +
          theftReportField("Заявленный получатель", theftReportAddressLink(report.reportedScamAddress)) +
          theftReportField("Tx", theftReportTxLink(report.txHash)) +
          theftReportField("Сумма", escapeHtml((report.amountUsdt || "0") + " USDT")) +
        '</div></section>' +
        '<section class="theft-report-section"><h3>Пользователь</h3><div class="theft-report-grid">' +
          theftReportField("Telegram ID", escapeHtml(report.telegramUserId || "n/a")) +
          theftReportField("Комментарий", escapeHtml(report.comment || "не указан")) +
        '</div></section>' +
        '<section class="theft-report-section"><h3>Оплата / бот</h3><div class="theft-report-grid">' +
          theftReportField("Статус бота", escapeHtml(report.status || "n/a")) +
          theftReportField("Кошелек оплаты", report.depositAddress ? theftReportAddressLink(report.depositAddress) : escapeHtml("не настроен")) +
          theftReportField("Сумма к оплате", escapeHtml((report.depositAmountUsdt || "0") + " USDT")) +
          theftReportField("Создана", escapeHtml(theftReportTime(report.createdAt))) +
          theftReportField("Обновлена", escapeHtml(theftReportTime(report.updatedAt))) +
          theftReportField("Обновлено админом", escapeHtml(theftReportTime(report.adminUpdatedAt))) +
        '</div></section>' +
        '<section class="theft-report-section"><h3>Внутренняя обработка</h3>' +
          '<label class="theft-report-field"><span>Статус обработки</span><select id="theftReportAdminStateSelect">' +
            Object.entries(theftReportAdminStatusLabels).map(([value, label]) => '<option value="' + escapeHtml(value) + '"' + (report.adminStatus === value ? " selected" : "") + '>' + escapeHtml(label) + '</option>').join("") +
          '</select></label>' +
          '<label class="theft-report-field"><span>Внутренняя заметка</span><textarea id="theftReportAdminNote" class="theft-report-note" maxlength="2000">' + escapeHtml(report.adminNote || "") + '</textarea></label>' +
          '<div class="theft-report-actions"><button id="theftReportSaveState" type="button">Сохранить</button></div>' +
        '</section>' +
        '<section class="theft-report-section"><h3>Действия</h3><div class="theft-report-actions">' +
          '<button type="button" data-copy-text="' + copyText + '">Копировать данные</button>' +
          '<a class="button-like" href="/admin/forensics?subjectAddress=' + encodeURIComponent(report.victimAddress || "") + '">Клиент в Forensics</a>' +
          '<a class="button-like" href="/admin/forensics?subjectAddress=' + encodeURIComponent(report.reportedScamAddress || "") + '">Получатель в Forensics</a>' +
          '<a class="button-like" href="/admin/wallet-intelligence?subjectAddress=' + encodeURIComponent(report.victimAddress || "") + '">Клиент в Wallet Intelligence</a>' +
          '<a class="button-like" href="/admin/wallet-intelligence?subjectAddress=' + encodeURIComponent(report.reportedScamAddress || "") + '">Получатель в Wallet Intelligence</a>' +
          '<a class="button-like" href="' + escapeHtml(tronscanTxUrl(report.txHash || "")) + '" target="_blank" rel="noopener noreferrer">Tx в TronScan</a>' +
        '</div></section>' +
      '</div>';
      const saveButton = document.getElementById("theftReportSaveState");
      if (saveButton) saveButton.addEventListener("click", saveTheftReportAdminState);
    }
    async function saveTheftReportAdminState() {
      const report = state.theftReports.detail;
      if (!report || state.theftReports.savePending) return;
      const select = el("theftReportAdminStateSelect");
      const note = el("theftReportAdminNote");
      state.theftReports.savePending = true;
      state.theftReports.listRequestSeq += 1;
      state.theftReports.detailRequestSeq += 1;
      state.theftReports.loading = false;
      renderTheftReportsList();
      renderTheftReportDetail();
      try {
        setTheftReportsStatus("Сохраняем внутренний статус...");
        const body = await api("/admin/api/theft-reports/" + encodeURIComponent(report.id) + "/admin-state", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ adminStatus: select.value, adminNote: note.value })
        });
        const updatedReport = body.report || report;
        state.theftReports.reports = state.theftReports.reports.map((item) => item.id === report.id ? updatedReport : item);
        if (state.theftReports.activeId === report.id) {
          state.theftReports.detail = updatedReport;
        }
        renderTheftReportsList();
        renderTheftReportDetail();
        setTheftReportsStatus("Внутренний статус сохранен.");
      } catch (error) {
        setTheftReportsStatus(error?.message || "Не удалось сохранить внутренний статус.");
      } finally {
        state.theftReports.savePending = false;
      }
    }
    function activeJob() {
      return state.jobs.find((job) => job.id === state.activeJobId) || null;
    }
    function requesterText(job) {
      return job.requesterUsername ? "@" + job.requesterUsername + " / " + (job.requestedBy || "no id") : job.requestedBy ? "tg:" + job.requestedBy : "system";
    }
    function selectedEdgeIds() {
      if (!state.selected) return new Set();
      if (state.selected.type === "edge") return new Set([state.selected.id]);
      if (state.selected.type === "node") {
        const edges = [...graphEdges(state.graph), ...state.renderedEdgesById.values()];
        return new Set(edges.filter((edge) => edge.fromNodeId === state.selected.id || edge.toNodeId === state.selected.id).map((edge) => edge.id));
      }
      return new Set();
    }
    function effectiveTxLabelMode() {
      if (state.graph?.job?.kind === "address_deep_check" && state.txLabelMode === "auto") return "all";
      if (state.txLabelMode === "auto") return "important";
      return state.txLabelMode;
    }
    function edgeIsWhereSelectedRouteTransfer(edge) {
      if (state.graph?.job?.kind !== "where_is_money_check") return false;
      if (edge?.type !== "transfer") return false;
      const role = edgeDisplayRole(edge);
      if (role !== "real_transfer" && role !== "allocated_transfer") return false;
      if (!edgeShouldShowCanvasAmount(edge)) return false;
      const metadata = edge?.metadata || {};
      return metadata.graphDirection === "path_step" ||
        metadata.amountRole === "funding_candidate" ||
        metadata.whereFundingRole === "exact_funding_candidate" ||
        metadata.visibilityReason === "selected_exact_funding_candidate";
    }
    function selectedEdgeLabelVisible(edge) {
      const selected = selectedEdgeIds();
      return selected.has(edge.id) || selected.has(edge?.metadata?.pathId) || edgeIsWhereSelectedRouteTransfer(edge);
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
      if (name === "scoringAudit") state.scoringAuditOpen = open;
      if (name === "jobs") state.jobsOpen = open;
      syncGraphFirstControls();
    }
    function setTransferDrawer(open) {
      state.transfersOpen = open;
      syncGraphFirstControls();
    }
    function setDensityMode(mode) {
      state.densityMode = ["show_all", "fan", "step_orbit", "deep_branch_map", "full_evidence", "compact_summary"].includes(mode) ? mode : "auto";
      state.timelineRange = null;
      localStorage.setItem("adminForensicsGraphViewMode", state.densityMode);
      if (state.densityMode !== "show_all") reconcileSelectionWithDensityMode();
      syncDenseGraphControls();
      renderGraph();
      renderCaseBrief();
      renderDetails();
      renderSelectionCard();
      renderActivityTimeline();
      renderTransferTabs();
    }
    function syncDenseGraphControls() {
      const densityButton = el("densityMode");
      const peerButton = el("peerLinksMode");
      if (densityButton) {
        const rawEdges = filteredGraphEdges();
        const connectedNodeIds = new Set();
        rawEdges.forEach((edge) => {
          if (edge?.fromNodeId) connectedNodeIds.add(edge.fromNodeId);
          if (edge?.toNodeId) connectedNodeIds.add(edge.toNodeId);
        });
        const rawNodes = graphNodes(state.graph).filter((node) => node.kind === "subject" || connectedNodeIds.has(node.id));
        const mode = state.graph ? graphDisplayMode(rawNodes, rawEdges) : state.densityMode;
        const label = mode === "full_evidence" ? "Full evidence" : mode === "wallet_clusters" || mode === "step_orbit" ? "Compact summary" : mode === "deep_branch_map" || mode === "flow_map" || mode === "show_all" ? "Investigative view" : "Fan overview";
        densityButton.textContent = "View: " + label;
        densityButton.classList.toggle("active", mode === "full_evidence" || mode === "wallet_clusters" || mode === "step_orbit" || mode === "deep_branch_map" || mode === "flow_map" || mode === "show_all");
        densityButton.title = label + ". Click to cycle graph presentation modes; current flow/service filters still apply.";
      }
      if (peerButton) peerButton.textContent = state.peerLinksVisible ? "Peer links on" : "Peer links off";
    }
    function syncGraphFirstControls() {
      const analyticsPanel = el("caseBriefPanel");
      const jobsPanel = el("jobsPanel");
      const scoringAuditPanel = el("scoringAuditPanel");
      const transferPanel = document.querySelector("[data-transfer-drawer]");
      if (analyticsPanel) analyticsPanel.classList.toggle("open", state.analyticsOpen);
      if (jobsPanel) jobsPanel.classList.toggle("open", state.jobsOpen);
      if (scoringAuditPanel) scoringAuditPanel.classList.toggle("open", state.scoringAuditOpen);
      if (transferPanel) transferPanel.classList.toggle("collapsed", !state.transfersOpen);
      el("toggleAnalytics").classList.toggle("active", state.analyticsOpen);
      el("toggleScoringAudit").classList.toggle("active", state.scoringAuditOpen);
      el("toggleJobs").classList.toggle("active", state.jobsOpen);
      el("toggleTransfers").classList.toggle("active", state.transfersOpen);
      el("toolToggleLabels").classList.toggle("active", state.labels);
      el("toolToggleLabels").textContent = state.labels ? "Aa" : "A-";
      el("toggleLabels").textContent = state.labels ? "Labels on" : "Labels off";
      el("flowMode").value = state.flowMode;
      el("servicesMode").classList.toggle("active", state.servicesVisible);
      el("servicesMode").textContent = state.servicesVisible ? "Services on" : "Services off";
      el("roleMarksMode").classList.toggle("active", state.roleMarksVisible);
      el("roleMarksMode").textContent = state.roleMarksVisible ? "Role marks on" : "Role marks off";
      const refreshSecondLayerButton = el("refreshSecondLayer");
      const activeJob = state.jobs.find((job) => job.id === state.activeJobId) || state.graph?.job || null;
      const canRefreshSecondLayer = Boolean(state.activeJobId && state.graph?.job?.kind === "address_deep_check" && activeJob?.status === "completed");
      refreshSecondLayerButton.disabled = !canRefreshSecondLayer;
      refreshSecondLayerButton.textContent = canRefreshSecondLayer ? "Refresh 2nd layer" : "2nd layer unavailable";
      refreshSecondLayerButton.title = canRefreshSecondLayer ? "Refresh second layer from completed local indexes." : "Requires a completed DeepCheck job.";
    }
    function clearGraphState() {
      state.graph = null;
      state.selected = null;
      state.activeJobId = null;
      state.timelineRange = null;
      state.transform = { x: 0, y: 0, scale: 1 };
      state.renderedNodePositions = new Map();
      state.renderedNodesById = new Map();
      state.renderedEdgesById = new Map();
      state.expandedBundleNodeIds.clear();
      state.lastNodeClick = null;
    }
    function caseStatusChip(label, value, cls) {
      const text = value === null || value === undefined || value === "" ? "unknown" : String(value);
      return '<span class="chip status-chip-' + escapeHtml(cls) + '">' + escapeHtml(label + ": " + text) + '</span>';
    }
    function caseHeaderStatusChips(graph, summary) {
      const clarity = graphRiskClarity(graph);
      const coverage = clarityLine(clarity?.coverageStatus || percent(summary.coverageRatio), analystMissingCopy("coverage"));
      const evidence = clarityLine(clarity?.evidenceClass, String(graphEvidence(graph).length));
      return '<div class="stats">' +
        caseStatusChip("Decision", summary.decision || "UNKNOWN", "decision") +
        caseStatusChip("Risk", (summary.riskScore ?? "n/a") + " / " + (summary.riskLevel ?? "unknown"), "risk") +
        caseStatusChip("Evidence", evidence, "evidence") +
        caseStatusChip("Coverage", coverage, "coverage") +
        '</div>';
    }
    function humanCheckKind(kind) {
      if (kind === "address_fast_check") return "Fast check";
      if (kind === "address_deep_check") return "DeepCheck";
      if (kind === "where_is_money_check") return "Where is money";
      if (kind === "incoming_deposit_check") return "Incoming deposit";
      return String(kind || "unknown").replace(/_/g, " ");
    }
    function caseBriefIntroText(graph) {
      if (graph?.job?.kind === "address_deep_check") {
        return "Shows the wallet profile, campaign context, and contract-triggered evidence. Money amounts belong to real transfer edges; contract context explains why those transfers matter.";
      }
      if (graph?.job?.kind === "where_is_money_check") {
        return "Traces where the wallet's balance-forming funds came from. Service boundaries and caveats explain where the trace legitimately stops.";
      }
      if (graph?.job?.kind === "incoming_deposit_check") {
        return "Traces the selected deposit and the sender path that funded it.";
      }
      if (graph?.job?.kind === "address_fast_check") {
        return "Fast triage view. It shows direct counterparties from the bounded first pass; use DeepCheck or Where is money for provenance.";
      }
      return "Select a node, edge, group, service, or boundary to inspect the supporting facts.";
    }
    function renderCaseBrief() {
      const root = el("caseBrief");
      const summaryRoot = el("activeJobSummary");
      const graph = state.graph;
      if (!graph) {
        root.className = "overlay-body details-body empty";
        root.innerHTML = "Select a completed or partial job to inspect evidence.";
        summaryRoot.innerHTML = '<strong>Case brief</strong><div class="hint" id="selectionHint">Select a completed or partial job to inspect evidence.</div>';
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
        '<div class="hint" id="selectionHint">' + escapeHtml(selectedLine) + '</div>' +
        caseHeaderStatusChips(graph, summary);
      const noSelectionIntro = state.selected ? "" : analystIntroBlock("Case summary", caseBriefIntroText(graph), [
        analystBadge(caseBriefModeLine(graph), "context")
      ]);
      root.innerHTML = noSelectionIntro + '<div class="metric-grid">' +
        metricHtml("Subject", addressDetailLink(subject.address || "unknown"), "wide") +
        metric("Check", humanCheckKind(jobKind) + " / " + jobStatus, "wide") +
        metric("Risk", (summary.riskScore ?? "n/a") + " / " + (summary.riskLevel ?? "unknown")) +
        metric("Decision", summary.decision || "UNKNOWN") +
        caseBriefClarityHtml(graphRiskClarity(graph)) +
        htmlListMetric("Largest incoming", caseBriefTopIncoming(), "No incoming profile edges.") +
        htmlListMetric("Largest outgoing", caseBriefTopOutgoing(), "No outgoing profile edges.") +
        htmlListMetric("Top services", caseBriefTopServices(), "No service transaction edges.") +
        metric("Boundary stops", String(caseBriefStopCount())) +
        detailsMetric("Projection gaps", projectionGapLines(graph), "No projection gaps stored.") +
        strictProvenanceLines(summary) +
        targetedIndexLines(summary) +
        whereFundingCandidateLines(summary) +
        '</div>';
      attachCaseBriefEdgeHandlers(root);
    }
    function attachCaseBriefEdgeHandlers(root) {
      root.querySelectorAll("[data-case-brief-edge-id]").forEach((row) => {
        row.addEventListener("click", (event) => {
          if (event.target instanceof Element && event.target.closest("a")) return;
          selectEdge(row.getAttribute("data-case-brief-edge-id"));
        });
        row.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            if (event.target instanceof Element && event.target.closest("a")) return;
            event.preventDefault();
            selectEdge(row.getAttribute("data-case-brief-edge-id"));
          }
        });
      });
    }
    function auditValue(source, keys) {
      const object = source && typeof source === "object" ? source : {};
      for (const key of keys) {
        if (object[key] !== null && object[key] !== undefined) return object[key];
      }
      return "n/a";
    }
    function auditRows(report) {
      return asArray(report?.rows).concat(asArray(report?.firstRows), asArray(report?.items), asArray(report?.jobs)).slice(0, 8);
    }
    function sourceAttributionLine(row) {
      const summary = row?.sourceAttribution && typeof row.sourceAttribution === "object" ? row.sourceAttribution : null;
      const candidate = summary?.topSourceCandidate && typeof summary.topSourceCandidate === "object" ? summary.topSourceCandidate : null;
      if (!summary || !candidate) return "";
      const share = typeof summary.topSourceShare === "number" && Number.isFinite(summary.topSourceShare) ? Math.round(summary.topSourceShare * 100) + "%" : "share n/a";
      return "Source attribution: " + raw(candidate.label || candidate.address || "unknown") + " " + share + " " + raw(summary.pathStrength || "unknown");
    }
    function auditRowLine(row) {
      const score = auditValue(row, ["finalScore", "score", "riskScore", "auditScore", "scoringScore"]);
      const production = auditValue(row, ["productionDecision", "production", "decision"]);
      const audit = auditValue(row, ["auditDecision", "shadowDecision", "scoringDecision"]);
      const subject = auditValue(row, ["jobId", "subjectAddress", "address"]);
      const sourceAttribution = sourceAttributionLine(row);
      return '<div class="audit-row"><strong>' + escapeHtml(score) + '</strong><span>' + escapeHtml(production) + ' -> ' + escapeHtml(audit) + '<br><span class="muted">' + escapeHtml(subject) + '</span>' + (sourceAttribution ? '<br><span class="muted">' + escapeHtml(sourceAttribution) + '</span>' : '') + '</span></div>';
    }
    function shadowComparisonLine(comparison) {
      const current = auditValue(comparison, ["currentDecision"]);
      const candidate = auditValue(comparison, ["candidateDecision"]);
      const delta = auditValue(comparison, ["delta"]);
      return String(current) + " -> " + String(candidate) + " (delta: " + raw(delta) + ")";
    }
    function renderScoringAudit() {
      const root = el("scoringAudit");
      if (!root) return;
      const report = state.scoringAudit && typeof state.scoringAudit === "object" ? state.scoringAudit : null;
      if (!report) {
        root.className = "overlay-body analytics-body empty";
        root.innerHTML = "Open scoring audit to load the latest report.";
        return;
      }
      const cohort = report.cohorts || {};
      const shadowComparisons = asArray(report.shadowComparisons);
      const rows = auditRows(report);
      root.className = "overlay-body analytics-body";
      root.innerHTML = '<div class="metric-grid">' +
        metric("Total jobs", auditValue(report, ["totalJobs", "total", "jobCount"])) +
        metric("High score + partial coverage", auditValue(cohort, ["high_score_partial_coverage"])) +
        metric("Acceptable limited coverage", auditValue(cohort, ["acceptable_limited_coverage"])) +
        metric("Decline without hard evidence", auditValue(cohort, ["decline_without_hard_evidence"])) +
        metric("Audit-only decision", "INSUFFICIENT_COVERAGE", "wide") +
        metricHtml("Shadow scoring", shadowComparisons.length ? listHtml(shadowComparisons.map(shadowComparisonLine), "No shadow scoring comparisons.") : '<span class="muted">No shadow scoring comparisons.</span>', "wide") +
        metricHtml("Rows", rows.length ? '<div class="list-lines">' + rows.map(auditRowLine).join("") + '</div>' : '<span class="muted">No audit rows.</span>', "wide") +
        '</div>';
    }
    async function loadScoringAudit() {
      state.token = el("token").value.trim();
      localStorage.setItem("adminForensicsToken", state.token);
      el("sessionState").textContent = state.token ? "session active" : "token missing";
      const params = new URLSearchParams();
      params.set("limit", el("limit").value || "50");
      const root = el("scoringAudit");
      if (root) {
        root.className = "overlay-body analytics-body empty";
        root.innerHTML = "Loading scoring audit...";
      }
      try {
        const body = await api("/admin/api/scoring-audit?" + params.toString());
        state.scoringAudit = body.report;
        renderScoringAudit();
        setStatus("Scoring audit loaded.");
      } catch (error) {
        state.scoringAudit = null;
        if (root) root.innerHTML = '<div class="error">' + escapeHtml(error.message || "Scoring audit failed.") + '</div>';
        setStatus("Scoring audit failed.");
      }
    }
    function briefEdgeAmountValue(edge) {
      const raw = rawBigInt(edge?.metadata?.usedAmountRaw || edge?.amountRaw || edge?.metadata?.originalAmountRaw || edge?.metadata?.amountRaw);
      return raw === null ? 0 : Number(raw > 9007199254740991n ? 9007199254740991n : raw);
    }
    function caseBriefEdgeTxCountLabel(edge) {
      const count = edgeAggregateTransferCount(edge) || edgeTxHashes(edge).length || (edgePrimaryTxHash(edge) ? 1 : 0);
      return count > 0 ? count + " tx" : "";
    }
    function caseBriefTxLabelHtml(edge) {
      const hashes = edgeTxHashes(edge);
      const txHash = edgePrimaryTxHash(edge) || hashes[0] || "";
      const count = caseBriefEdgeTxCountLabel(edge);
      if (!txHash) return count ? escapeHtml(count) : "";
      const prefix = count && count !== "1 tx" ? count + " - tx " : "tx ";
      return escapeHtml(prefix) + explorerLink(tronscanTxUrl(txHash), short(txHash, 5));
    }
    function formatBriefEdgeHtml(edge) {
      const amount = edgeCanvasAmountLabel(edge) || edgeDetailedAmountLabel(edge) || "amount n/a";
      const address = edgeFlowDirection(edge) === "incoming" ? edgeFromAddress(edge) : edgeToAddress(edge);
      const direction = edgeFlowDirection(edge) === "incoming" ? "from " : "to ";
      const linkedAddress = address ? explorerLink(tronscanAddressUrl(address), short(address, 7)) : '<span class="muted">address n/a</span>';
      const time = edgeTime(edge) || canvasTimestampLabel(edge?.timestamp || edge?.timestampIso || edge?.time);
      const tx = caseBriefTxLabelHtml(edge);
      const detail = [time ? escapeHtml(time) : "", tx].filter(Boolean).join(" - ");
      const selected = state.selected?.type === "edge" && state.selected.id === edge?.id ? " selected" : "";
      return '<div role="button" tabindex="0" class="counterparty-row counterparty-edge-row' + selected + '" data-case-brief-edge-id="' + escapeHtml(edge?.id || "") + '" title="Select this graph transfer"><strong>' + escapeHtml(amount) + '</strong><span>' +
        escapeHtml(direction) + linkedAddress +
        (detail ? '<small>' + detail + '</small>' : "") +
        '</span></div>';
    }
    function caseBriefTopIncoming() {
      return filteredTransferEdges()
        .filter((edge) => edgeFlowDirection(edge) === "incoming")
        .sort((a, b) => briefEdgeAmountValue(b) - briefEdgeAmountValue(a))
        .slice(0, 5)
        .map(formatBriefEdgeHtml);
    }
    function caseBriefTopOutgoing() {
      return filteredTransferEdges()
        .filter((edge) => edgeFlowDirection(edge) === "outgoing")
        .sort((a, b) => briefEdgeAmountValue(b) - briefEdgeAmountValue(a))
        .slice(0, 5)
        .map(formatBriefEdgeHtml);
    }
    function serviceEdgesForCaseBrief(node) {
      return filteredTransferEdges()
        .filter((edge) => edge?.fromNodeId === node?.id || edge?.toNodeId === node?.id)
        .sort((a, b) => briefEdgeAmountValue(b) - briefEdgeAmountValue(a));
    }
    function formatBriefServiceEdgeHtml(node, edge) {
      const amount = edgeAggregateAmountLabel(edge) || edgeDetailedAmountLabel(edge) || edgeCanvasAmountLabel(edge) || "amount n/a";
      const serviceAddress = nodeAddress(node);
      const serviceLabel = canvasNodeLabel(node) || short(serviceAddress || node?.id || "service", 7);
      const service = serviceAddress
        ? explorerLink(tronscanAddressUrl(serviceAddress), serviceLabel + " - " + short(serviceAddress, 6))
        : escapeHtml(serviceLabel);
      const counterpartyNodeId = edge?.fromNodeId === node?.id ? edge?.toNodeId : edge?.fromNodeId;
      const counterpartyAddress = nodeAddress(nodeById(counterpartyNodeId)) || graphAddressFromNodeId(counterpartyNodeId) || counterpartyNodeId || "";
      const direction = edge?.fromNodeId === node?.id ? "to " : "from ";
      const counterparty = counterpartyAddress
        ? explorerLink(tronscanAddressUrl(counterpartyAddress), short(counterpartyAddress, 7))
        : '<span class="muted">counterparty n/a</span>';
      const txCount = caseBriefEdgeTxCountLabel(edge) || "tx n/a";
      const tx = caseBriefTxLabelHtml(edge);
      const time = edgeTime(edge) || canvasTimestampLabel(edge?.timestamp || edge?.timestampIso || edge?.time);
      const detail = [txCount, time ? escapeHtml(time) : "", tx].filter(Boolean).join(" - ");
      const selected = state.selected?.type === "edge" && state.selected.id === edge?.id ? " selected" : "";
      return '<div role="button" tabindex="0" class="counterparty-row counterparty-edge-row' + selected + '" data-case-brief-edge-id="' + escapeHtml(edge?.id || "") + '" title="Select this service transaction"><strong>' + escapeHtml(amount) + '</strong><span>' +
        service + '<small>' + escapeHtml(direction) + counterparty + (detail ? ' - ' + detail : "") + '</small>' +
        '</span></div>';
    }
    function caseBriefTopServices() {
      const rows = new Map();
      graphNodes(state.graph).filter(nodeIsServiceLike).forEach((node) => {
        serviceEdgesForCaseBrief(node).forEach((edge) => {
          if (!rows.has(edge.id)) rows.set(edge.id, { node, edge });
        });
      });
      return Array.from(rows.values())
        .sort((a, b) => briefEdgeAmountValue(b.edge) - briefEdgeAmountValue(a.edge))
        .slice(0, 8)
        .map((item) => formatBriefServiceEdgeHtml(item.node, item.edge));
    }
    function caseBriefStopCount() {
      return graphPaths(state.graph).filter((path) => path.stopReason).length;
    }
    function caseBriefModeLine(graph) {
      if (graph?.job?.kind === "address_deep_check") return "DeepCheck profile";
      if (graph?.job?.kind === "where_is_money_check") return "Money-origin trace";
      if (graph?.job?.kind === "incoming_deposit_check") return "Deposit trace";
      if (graph?.job?.kind === "address_fast_check") return "Fast triage";
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
    function graphPresentationForEdges(edges) {
      const rawConnectedNodeIds = new Set();
      edges.forEach((edge) => {
        if (edge?.fromNodeId) rawConnectedNodeIds.add(edge.fromNodeId);
        if (edge?.toNodeId) rawConnectedNodeIds.add(edge.toNodeId);
      });
      const rawVisibleNodes = graphNodes(state.graph).filter((node) => node.kind === "subject" || rawConnectedNodeIds.has(node.id));
      return graphPresentation(rawVisibleNodes, edges);
    }
    function presentationTransferEdges(edges) {
      return graphPresentationForEdges(edges).edges.filter((edge) =>
        edge?.type !== "stop" &&
        edgeDisplayRole(edge) !== "stop" &&
        edge?.type !== "collapsed_group" &&
        edgeDisplayRole(edge) !== "collapsed_group"
      );
    }
    function timelineSourceTransferEdges() {
      return presentationTransferEdges(graphEdges(state.graph).filter((edge) =>
        edgePassesFlowFilter(edge) &&
        edgePassesServiceFilter(edge) &&
        edgePassesPeerLinkFilter(edge)
      ));
    }
    function activityTimelineBuckets(edges, bucketCount = 48) {
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
    function timelineDateLabel(timestamp) {
      return formatJobTime(new Date(timestamp).toISOString()) || new Date(timestamp).toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    }
    function timelineRangeLabel(start, end) {
      const startLabel = timelineDateLabel(start);
      const endLabel = timelineDateLabel(end);
      return startLabel === endLabel ? startLabel : startLabel + " - " + endLabel;
    }
    function timelineBucketDurationLabel(start, end) {
      const minutes = Math.max(1, Math.round((end - start) / 60000));
      if (minutes < 60) return minutes + "m bucket";
      const hours = Math.round(minutes / 60);
      if (hours < 48) return hours + "h bucket";
      return Math.round(hours / 24) + "d bucket";
    }
    function timelineBucketTitle(bucket) {
      const amount = bucket.amount > 0 ? " / " + (formatRawUsdt(String(Math.round(bucket.amount))) || String(Math.round(bucket.amount))) : "";
      return timelineRangeLabel(bucket.start, bucket.end) + " / " + bucket.count + " transfer" + (bucket.count === 1 ? "" : "s") + amount;
    }
    function flowModeLabel(mode) {
      if (mode === "incoming") return "Incoming only";
      if (mode === "outgoing") return "Outgoing only";
      if (mode === "self") return "Self transfers";
      return "All visible transfers";
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
    function edgeIsTimelineFocused(edge) {
      return Boolean(state.timelineRange && edgePassesTimelineRange(edge));
    }
    function filteredTransferEdges() {
      return presentationTransferEdges(filteredGraphEdges());
    }
    function selectTimelineBucket(index) {
      const buckets = activityTimelineBuckets(timelineSourceTransferEdges());
      const bucket = buckets[index];
      state.timelineRange = bucket && state.timelineRange?.index !== index ? { start: bucket.start, end: bucket.end, index, isLast: bucket.isLast } : null;
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
        hint.textContent = timelineEmptyCopy();
        return;
      }
      const buckets = activityTimelineBuckets(timelineSourceTransferEdges());
      if (buckets.length === 0) {
        root.innerHTML = "";
        hint.textContent = timelineEmptyCopy();
        return;
      }
      const maxValue = Math.max(1, ...buckets.map((bucket) => bucket.amount || bucket.count));
      const bars = buckets.map((bucket) => {
        const value = bucket.amount || bucket.count;
        const normalized = bucket.count === 0 ? 0 : Math.sqrt(value / maxValue);
        const height = bucket.count === 0 ? 6 : Math.max(14, Math.round(12 + normalized * 56));
        const active = state.timelineRange?.index === bucket.index ? " active" : "";
        const volume = bucket.count === 0 ? " empty" : value >= maxValue * .78 ? " hot" : value >= maxValue * .32 ? " medium" : " low";
        const title = timelineBucketTitle(bucket);
        return '<button type="button" class="timeline-bar' + volume + active + '" data-timeline-index="' + bucket.index + '" style="--bucket-height:' + height + 'px" title="' + escapeHtml(title) + '" aria-label="' + escapeHtml(title) + '"></button>';
      }).join("");
      const firstBucket = buckets[0];
      const lastBucket = buckets[buckets.length - 1];
      const bucketLabel = timelineBucketDurationLabel(firstBucket.start, firstBucket.end);
      root.innerHTML =
        '<div class="timeline-bars">' + bars + '</div>' +
        '<div class="timeline-axis" aria-label="Timeline axis">' +
          '<span>Oldest <strong>' + escapeHtml(timelineDateLabel(firstBucket.start)) + '</strong></span>' +
          '<span>Step <strong>' + escapeHtml(bucketLabel) + '</strong></span>' +
          '<span>Newest <strong>' + escapeHtml(timelineDateLabel(lastBucket.end)) + '</strong></span>' +
        '</div>' +
        '<div class="timeline-legend"><span>Each bar is a time bucket; height shows visible transfer amount, or transfer count when amount is missing.</span></div>';
      root.querySelectorAll("[data-timeline-index]").forEach((button) => {
        button.addEventListener("click", () => selectTimelineBucket(Number(button.getAttribute("data-timeline-index"))));
      });
      if (state.timelineRange) {
        hint.textContent = "Timeline focus: " + timelineRangeLabel(state.timelineRange.start, state.timelineRange.end) + ". Flow filter: " + flowModeLabel(state.flowMode) + ". Context stays visible.";
      } else {
        const count = timelineSourceTransferEdges().length;
        hint.textContent = count + " transfer" + (count === 1 ? "" : "s") + " available. Flow filter: " + flowModeLabel(state.flowMode) + ". Click a time bucket to focus graph flow.";
      }
    }
    function jobQueueModeLabel(mode) {
      if (mode === "running") return "Running";
      if (mode === "review") return "Needs review";
      return "All";
    }
    function jobPassesQueueMode(job) {
      if (state.jobQueueMode === "running") {
        return job.status === "running" || job.status === "queued" || isWaitingForTargetedIndex(job);
      }
      if (state.jobQueueMode === "review") {
        return job.status === "partial" || job.status === "failed" || job.status === "cancelled";
      }
      return true;
    }
    function visibleJobsForQueue() {
      return state.jobs.filter(jobPassesQueueMode);
    }
    function syncJobQueueModeControls() {
      const all = el("jobsModeAll");
      const running = el("jobsModeRunning");
      const review = el("jobsModeReview");
      if (all) all.classList.toggle("active", state.jobQueueMode === "all");
      if (running) running.classList.toggle("active", state.jobQueueMode === "running");
      if (review) review.classList.toggle("active", state.jobQueueMode === "review");
    }
    function setJobQueueMode(mode) {
      state.jobQueueMode = ["all", "running", "review"].includes(mode) ? mode : "all";
      renderJobs();
    }
    function formatJobTime(value) {
      if (!value) return "";
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) return iso(value);
      const now = new Date();
      const sameDay = date.toDateString() === now.toDateString();
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      const day = sameDay ? "today" : date.toDateString() === yesterday.toDateString() ? "yesterday" : date.toLocaleDateString([], { month: "short", day: "2-digit" });
      return day + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    function formatJobDuration(ms) {
      if (!Number.isFinite(ms) || ms < 0) return "";
      const minutes = Math.max(1, Math.round(ms / 60000));
      if (minutes < 60) return minutes + "m";
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      return hours + "h" + (rest ? " " + rest + "m" : "");
    }
    function jobDurationLabel(job) {
      const started = job.startedAt ? new Date(job.startedAt).getTime() : null;
      if (!started || !Number.isFinite(started)) return "";
      const endValue = job.completedAt || job.updatedAt || null;
      const ended = endValue ? new Date(endValue).getTime() : Date.now();
      const duration = formatJobDuration(ended - started);
      if (!duration) return "";
      return (job.status === "running" || job.status === "queued") ? "running " + duration : "duration " + duration;
    }
    function jobRiskClass(job) {
      const level = String(job.riskLevel || "").toLowerCase();
      if (level === "high" || level === "critical" || Number(job.riskScore) >= 60) return " job-risk-high";
      if (level === "low" || Number(job.riskScore) <= 30) return " job-risk-low";
      return "";
    }
    function jobRiskLabel(job) {
      if (typeof job.riskScore === "number" && Number.isFinite(job.riskScore)) {
        return "Risk " + job.riskScore + (job.riskLevel ? " / " + job.riskLevel : "");
      }
      if (job.status === "running" || job.status === "queued") return "Risk pending";
      return "Risk n/a";
    }
    function jobCoverageLabel(job) {
      const value = job.coverageStatus || job.technicalStatus || "";
      if (value) return "Coverage " + value;
      if (job.status === "completed") return "Coverage complete";
      if (job.status === "partial") return "Coverage partial";
      return "";
    }
    function jobProgressLine(job, liveProgress, searchContext) {
      if (liveProgress.length > 0) return "<strong>Current step:</strong> " + escapeHtml(liveProgress[0]);
      if (job.lastError) return "<strong>Why here:</strong> " + escapeHtml(job.lastError);
      if (job.status === "partial") return "<strong>Why here:</strong> Partial evidence or coverage limit. Open Analytics for details.";
      if (job.status === "failed") return "<strong>Why here:</strong> Job failed before a graph could be completed.";
      if (job.status === "running" || job.status === "queued") return "<strong>Current step:</strong> waiting for worker progress.";
      if (searchContext) return "<strong>Context:</strong> " + escapeHtml(searchContext);
      if (job.decision) return "<strong>Decision:</strong> " + escapeHtml(job.decision);
      return "";
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
      syncJobQueueModeControls();
      const visibleJobs = visibleJobsForQueue();
      const summary = el("jobsResultSummary");
      if (summary) {
        summary.textContent = state.jobs.length === 0
          ? "No jobs loaded."
          : jobQueueModeLabel(state.jobQueueMode) + ": " + visibleJobs.length + " of " + state.jobs.length + " loaded jobs";
      }
      if (state.jobs.length === 0) {
        root.innerHTML = '<div class="empty">No jobs found. Check filters or run wallet checks first.</div>';
        return;
      }
      if (visibleJobs.length === 0) {
        root.innerHTML = '<div class="empty">No jobs match this queue view.</div>';
        return;
      }
      root.innerHTML = visibleJobs.map((job) => {
        const active = job.id === state.activeJobId ? " active" : "";
        const displayStatus = jobDisplayStatus(job);
        const liveProgress = jobLiveProgressLines(job);
        const requester = job.requesterUsername ? "@" + job.requesterUsername : job.requestedBy ? "tg:" + job.requestedBy : "system";
        const searchContext = [
          job.watchedWallet ? "wallet " + short(job.watchedWallet, 8) : "",
          job.sender ? "sender " + short(job.sender, 8) : "",
          job.depositTxHash ? "tx " + short(job.depositTxHash, 8) : ""
        ].filter(Boolean).join(" · ");
        const updated = formatJobTime(job.completedAt || job.updatedAt || job.createdAt);
        const started = formatJobTime(job.startedAt || job.createdAt);
        const duration = jobDurationLabel(job);
        const coverage = jobCoverageLabel(job);
        const progressLine = jobProgressLine(job, liveProgress, searchContext);
        return '<button type="button" class="job' + active + '" data-job-id="' + escapeHtml(job.id) + '">' +
          '<div class="job-title"><span class="job-address">' + escapeHtml(short(job.subjectAddress, 10)) + '</span><span class="' + classifyStatus(displayStatus.classValue) + '">' + escapeHtml(displayStatus.label) + '</span></div>' +
          '<div class="job-meta-row">' +
            '<span class="job-pill job-kind-pill">' + escapeHtml(humanCheckKind(job.kind)) + '</span>' +
            '<span class="job-pill' + jobRiskClass(job) + '">' + escapeHtml(jobRiskLabel(job)) + '</span>' +
            (coverage ? '<span class="job-pill">' + escapeHtml(coverage) + '</span>' : '') +
            (duration ? '<span class="job-pill">' + escapeHtml(duration) + '</span>' : '') +
          '</div>' +
          '<div class="job-line"><strong>Updated:</strong> ' + escapeHtml(updated || "time n/a") + (started ? ' · <strong>Started:</strong> ' + escapeHtml(started) : "") + '</div>' +
          '<div class="job-line"><strong>Requested by:</strong> ' + escapeHtml(requester) + '</div>' +
          (progressLine ? '<div class="job-line">' + progressLine + '</div>' : '') +
          '<div class="job-id-line">job ' + escapeHtml(short(job.id, 8)) + '</div>' +
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
          : state.activeJobId
            ? null
            : state.jobs.find((job) => job.status === "completed" || job.status === "partial") || null;
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
      if (walletIntelligenceActive()) {
        applyWalletIntelPreset(params.get("preset") || "intersections");
        el("walletIntelAddress").value = params.get("address") || params.get("q") || "";
        el("walletIntelRequester").value = params.get("requester") || "";
        el("walletIntelSubjectAddress").value = params.get("subjectAddress") || "";
        setSelectFromUrl("walletIntelMode", params.get("mode") || "");
        if (params.has("tag")) setSelectFromUrl("walletIntelTag", params.get("tag") || "");
        if (params.has("minUniqueSubjects")) el("walletIntelMinSubjects").value = params.get("minUniqueSubjects") || "";
        if (params.has("minUniqueRequesters")) el("walletIntelMinRequesters").value = params.get("minUniqueRequesters") || "";
        if (params.has("maxDepth")) el("walletIntelMaxDepth").value = params.get("maxDepth") || "";
        el("walletIntelServiceCategory").value = params.get("serviceCategory") || "";
        setSelectFromUrl("walletIntelJobStatus", params.get("jobStatus") || "");
      }
      if (theftReportsActive()) {
        el("theftReportsSearch").value = params.get("query") || params.get("q") || "";
        setSelectFromUrl("theftReportsAdminStatus", params.get("adminStatus") || "");
        setSelectFromUrl("theftReportsBotStatus", params.get("botStatus") || "");
        setSelectFromUrl("theftReportsLimit", params.get("limit") || "");
      }
      const jobId = params.get("jobId") || params.get("job") || "";
      if (jobId) state.pendingOpenJobId = jobId;
    }
    async function refreshSecondLayer() {
      const jobId = state.activeJobId;
      const activeJob = state.jobs.find((job) => job.id === jobId) || state.graph?.job || null;
      if (!jobId || state.graph?.job?.kind !== "address_deep_check" || activeJob?.status !== "completed") {
        setStatus("Select a completed DeepCheck job before refreshing second layer.");
        return;
      }
      try {
        setStatus("Refreshing DeepCheck second layer...");
        const body = await api("/admin/api/forensic-jobs/" + encodeURIComponent(jobId) + "/refresh-second-layer", { method: "POST" });
        const result = body?.result && typeof body.result === "object" ? body.result : {};
        const status = result.status ? " (" + result.status + ")" : "";
        setStatus("DeepCheck second layer refreshed" + status + ".");
        await loadGraph(jobId);
      } catch (error) {
        setStatus("DeepCheck second layer refresh failed: " + (error?.message || "request failed"));
      }
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
        state.expandedBundleNodeIds.clear();
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
        syncDenseGraphControls();
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
    function collapsedGroupLayoutSide(groupKind) {
      return groupKind === "incoming" || groupKind === "outgoing" || groupKind === "service" || groupKind === "context" ? groupKind : "";
    }
    function nodeLayoutSide(node, subjectId, edges) {
      if (node.id === subjectId) return "subject";
      if (nodeDisplayKind(node) === "collapsed_group") {
        const groupSide = collapsedGroupLayoutSide(node?.metadata?.groupKind);
        if (groupSide) return groupSide;
      }
      if (nodeIsServiceLike(node)) return "service";
      const incoming = edges.some((edge) => edge.toNodeId === subjectId && edge.fromNodeId === node.id);
      const outgoing = edges.some((edge) => edge.fromNodeId === subjectId && edge.toNodeId === node.id);
      if (incoming && !outgoing) return "incoming";
      if (outgoing && !incoming) return "outgoing";
      if (incoming && outgoing) return "self";
      return "context";
    }
    function stepOrbitRole(node, subjectId, edges) {
      if (!node) return "context";
      if (node.id === subjectId) return "subject";
      if (nodeDisplayKind(node) === "funding_bundle") return "funding";
      if (nodeDisplayKind(node) === "collapsed_group") {
        const role = node?.metadata?.stepOrbitRole || node?.metadata?.clusterRole || "";
        if (role === "source" || role === "funding" || role === "service" || role === "stop" || role === "context") return role;
        const groupKind = collapsedGroupLayoutSide(node?.metadata?.groupKind);
        if (groupKind === "incoming") return "source";
        if (groupKind === "service") return "service";
        if (groupKind === "outgoing") return "context";
        return "context";
      }
      if (nodeDisplayKind(node) === "trace_stop") return "stop";
      if (nodeIsServiceLike(node)) return "service";
      const side = nodeLayoutSide(node, subjectId, edges);
      if (side === "incoming") return "source";
      if (side === "outgoing") return "context";
      return "context";
    }
    function nodeIsSmartContractLaneNode(node) {
      if (!node) return false;
      const kind = nodeDisplayKind(node);
      return node.kind === "contract" ||
        kind === "contract" ||
        kind === "smart_contract" ||
        kind === "contract_adapter" ||
        kind === "contract_router" ||
        kind === "dex_contract" ||
        node?.metadata?.role === "contract_driven_contract";
    }
    function walletClusterNodeRole(node, subjectId, edges) {
      if (!node) return "intermediate";
      if (node.id === subjectId || node.kind === "subject") return "subject";
      if (nodeIsSmartContractLaneNode(node)) return "contract";
      const cluster = node?.metadata?.deepCheckWalletCluster || {};
      const clusterType = String(cluster.nodeType || "");
      if (clusterType === "boundary" || nodeIsServiceLike(node)) return "boundary";
      if (clusterType === "history_stop" || nodeDisplayKind(node) === "trace_stop") return "stop";
      if (clusterType === "funding_cluster" || nodeDisplayKind(node) === "funding_bundle" || nodeDisplayKind(node) === "collapsed_group") return "group";
      const incoming = edges.some((edge) => edge.toNodeId === subjectId && edge.fromNodeId === node.id);
      const outgoing = edges.some((edge) => edge.fromNodeId === subjectId && edge.toNodeId === node.id);
      if (incoming && !outgoing) return "source";
      if (outgoing && !incoming) return "outgoing";
      return "intermediate";
    }
    function importantClusterNodes(nodes, edges, limit) {
      return new Set(rankNodesByImportance(nodes, edges).slice(0, limit).map((node) => node.id));
    }
    function stepOrbitSummaryNode(id, label, hiddenNodes, groupKind, stepOrbitRole, groupReason) {
      const count = hiddenNodes.length;
      return {
        id,
        kind: "group",
        displayKind: "collapsed_group",
        label: "Group: " + count + " " + label,
        weight: count,
        metadata: {
          groupKind,
          collapsedCount: count,
          clusterSummary: true,
          stepOrbitRole,
          uiCollapsedGroup: true,
          realGroupKind: "ui_collapsed_display_group",
          groupReason,
          hiddenNodeIds: hiddenNodes.map((node) => node.id)
        }
      };
    }
    function stableNodeSort(a, b) {
      const aWeight = Number(a.weight || a.score || a.metadata?.volumeRaw || 0);
      const bWeight = Number(b.weight || b.score || b.metadata?.volumeRaw || 0);
      if (bWeight !== aWeight) return bWeight - aWeight;
      return String(a.id).localeCompare(String(b.id));
    }
    function graphIsDense(nodes, edges) {
      return nodes.length > 32 || edges.length > 50;
    }
    function graphKindUsesFlowMap(kind) {
      return kind === "incoming_deposit_check" || kind === "where_is_money_check";
    }
    function graphKindUsesRouteFocusedFlowMap(kind) {
      return kind === "where_is_money_check";
    }
    function graphKindUsesDeepBranchMap(kind) {
      return kind === "address_deep_check";
    }
    function graphKindSupportsFullEvidence(kind) {
      return kind === "address_deep_check" || kind === "where_is_money_check";
    }
    function graphKindUsesFullEvidenceByDefault(kind) {
      return kind === "address_deep_check";
    }
    function graphKindUsesWalletClusters(kind) {
      return kind === "address_deep_check";
    }
    function graphKindSupportsStepOrbit(kind) {
      return graphKindUsesFlowMap(kind) || graphKindUsesDeepBranchMap(kind);
    }
    function graphDisplayMode(nodes, edges) {
      const mode = state.densityMode;
      if (mode === "full_evidence" && graphKindSupportsFullEvidence(state.graph?.job?.kind)) return "full_evidence";
      if (mode === "compact_summary" && graphKindUsesWalletClusters(state.graph?.job?.kind)) return "wallet_clusters";
      if (mode === "compact_summary" && graphKindUsesRouteFocusedFlowMap(state.graph?.job?.kind)) return "step_orbit";
      if (mode === "show_all" && !graphKindSupportsFullEvidence(state.graph?.job?.kind)) return "show_all";
      if (mode === "deep_branch_map" && graphKindUsesDeepBranchMap(state.graph?.job?.kind)) return "deep_branch_map";
      if (mode === "fan") return "fan";
      if (graphKindUsesFullEvidenceByDefault(state.graph?.job?.kind)) return "full_evidence";
      if (graphKindUsesWalletClusters(state.graph?.job?.kind)) return "wallet_clusters";
      if (graphKindUsesFlowMap(state.graph?.job?.kind)) return "flow_map";
      if (!graphIsDense(nodes, edges)) return "show_all";
      if (graphKindSupportsStepOrbit(state.graph?.job?.kind)) return "step_orbit";
      return "fan";
    }
    function collapsedEdgeTxHashes(edge) {
      const hashes = [];
      if (edge?.txHash) hashes.push(String(edge.txHash));
      if (Array.isArray(edge?.metadata?.txHashes)) edge.metadata.txHashes.forEach((hash) => hash && hashes.push(String(hash)));
      if (Array.isArray(edge?.metadata?.profileTxHashes)) edge.metadata.profileTxHashes.forEach((hash) => hash && hashes.push(String(hash)));
      return [...new Set(hashes)];
    }
    function collapsedEdgeAmountRaw(edge) {
      return edge?.metadata?.usedAmountRaw || edge?.amountRaw || edge?.metadata?.amountRaw || edge?.metadata?.originalAmountRaw || null;
    }
    function collapsedEdgeDirection(edge) {
      return edge?.metadata?.direction || edge?.direction || null;
    }
    function collapsedEdgeMoneyDirection(edge) {
      const moneyDirection = edge?.metadata?.moneyDirection || edge?.moneyDirection || null;
      if (moneyDirection) return moneyDirection;
      const direction = collapsedEdgeDirection(edge);
      if (direction === "inbound" || direction === "incoming") return "inbound_to_subject";
      if (direction === "outbound" || direction === "outgoing") return "outbound_from_subject";
      return null;
    }
    function addRawAmount(left, right) {
      const leftRaw = rawBigInt(left);
      const rightRaw = rawBigInt(right);
      if (leftRaw === null) return right || left || null;
      if (rightRaw === null) return left || right || null;
      return String(leftRaw + rightRaw);
    }
    function collapsedGroupAggregateEdges(sourceEdges, visibleIds, hiddenNodeToGroupId, groupKindById) {
      const collapsedEdgeByKey = new Map();
      sourceEdges.forEach((edge) => {
        const fromVisible = visibleIds.has(edge.fromNodeId);
        const toVisible = visibleIds.has(edge.toNodeId);
        if (fromVisible && toVisible) return;
        const fromNodeId = fromVisible ? edge.fromNodeId : hiddenNodeToGroupId.get(edge.fromNodeId);
        const toNodeId = toVisible ? edge.toNodeId : hiddenNodeToGroupId.get(edge.toNodeId);
        if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) return;
        const groupKind = groupKindById.get(fromNodeId) || groupKindById.get(toNodeId) || "context";
        const aggregateKey = fromNodeId + "->" + toNodeId + ":collapsed_group";
        const hiddenNodeIds = [fromVisible ? null : edge.fromNodeId, toVisible ? null : edge.toNodeId].filter(Boolean);
        const hiddenEdgeIds = edge?.id ? [edge.id] : [];
        const txHashes = collapsedEdgeTxHashes(edge);
        const amountRaw = collapsedEdgeAmountRaw(edge);
        const direction = collapsedEdgeDirection(edge);
        const moneyDirection = collapsedEdgeMoneyDirection(edge);
        const current = collapsedEdgeByKey.get(aggregateKey);
        if (current) {
          current.weight += edge.weight || 1;
          current.metadata.hiddenNodeIds = [...new Set([...current.metadata.hiddenNodeIds, ...hiddenNodeIds])];
          current.metadata.hiddenEdgeIds = [...new Set([...current.metadata.hiddenEdgeIds, ...hiddenEdgeIds])];
          current.metadata.sourceEdgeIds = current.metadata.hiddenEdgeIds;
          current.metadata.sourceEdgeCount = current.metadata.hiddenEdgeIds.length;
          current.metadata.txHashes = [...new Set([...current.metadata.txHashes, ...txHashes])];
          current.amountRaw = addRawAmount(current.amountRaw, amountRaw);
          current.metadata.amountRaw = current.amountRaw;
          if (!current.metadata.direction && direction) current.metadata.direction = direction;
          if (!current.metadata.moneyDirection && moneyDirection) current.metadata.moneyDirection = moneyDirection;
          return;
        }
        collapsedEdgeByKey.set(aggregateKey, {
          id: "collapsed-edge:" + aggregateKey.replace(/[^a-zA-Z0-9:_-]/g, "_"),
          fromNodeId,
          toNodeId,
          type: "collapsed_group",
          displayRole: "collapsed_group",
          verdict: "review",
          weight: edge.weight || 1,
          amountRaw,
          txHash: txHashes[0] || null,
          metadata: {
            groupKind,
            hiddenNodeIds,
            hiddenEdgeIds,
            sourceEdgeId: hiddenEdgeIds[0] || null,
            sourceEdgeIds: hiddenEdgeIds,
            sourceEdgeCount: hiddenEdgeIds.length,
            txHashes,
            amountRaw,
            direction,
            moneyDirection,
            aggregateExternalEdge: true
          }
        });
      });
      return [...collapsedEdgeByKey.values()];
    }
    function buildDenseFanPresentation(nodes, edges) {
      const subject = nodes.find((node) => node.kind === "subject") || nodes[0];
      if (!subject) return { nodes, edges };
      const subjectId = subject.id;
      const incoming = nodes.filter((node) => node.id !== subjectId && nodeLayoutSide(node, subjectId, edges) === "incoming");
      const outgoing = nodes.filter((node) => node.id !== subjectId && nodeLayoutSide(node, subjectId, edges) === "outgoing");
      const services = nodes.filter((node) => node.id !== subjectId && nodeIsServiceLike(node));
      const context = nodes.filter((node) =>
        node.id !== subjectId &&
        !incoming.includes(node) &&
        !outgoing.includes(node) &&
        !services.includes(node)
      );
      const keepIncoming = new Set(rankNodesByImportance(incoming, edges).slice(0, 8).map((node) => node.id));
      const keepOutgoing = new Set(rankNodesByImportance(outgoing, edges).slice(0, 8).map((node) => node.id));
      const keepServices = new Set(rankNodesByImportance(services, edges).slice(0, 8).map((node) => node.id));
      const keepContext = new Set(rankNodesByImportance(context, edges).slice(0, 6).map((node) => node.id));
      const keptIds = new Set([subjectId, ...keepIncoming, ...keepOutgoing, ...keepServices, ...keepContext]);
      const hiddenIncoming = incoming.filter((node) => !keptIds.has(node.id));
      const hiddenOutgoing = outgoing.filter((node) => !keptIds.has(node.id));
      const hiddenServices = services.filter((node) => !keptIds.has(node.id));
      const hiddenContext = context.filter((node) => !keptIds.has(node.id));
      const visualNodes = nodes.filter((node) => keptIds.has(node.id));
      const visualEdges = edges.filter((edge) => keptIds.has(edge.fromNodeId) && keptIds.has(edge.toNodeId));
      const hiddenNodeToGroupId = new Map();
      const groupKindById = new Map();
      const groupEntries = [];
      const groupIdByKey = {
        incoming: "collapsed:incoming",
        outgoing: "collapsed:outgoing",
        service: "collapsed:service",
        context: "collapsed:context"
      };
      const addGroup = (key, label, hidden, groupKind) => {
        if (hidden.length === 0) return;
        const groupId = groupIdByKey[key] || "collapsed:" + key;
        hidden.forEach((node) => hiddenNodeToGroupId.set(node.id, groupId));
        groupKindById.set(groupId, groupKind);
        groupEntries.push({ key, groupId, groupKind });
        visualNodes.push(collapsedGroupNode(groupId, label, hidden.length, 0, 0, groupKind, {
          hiddenNodeIds: hidden.map((node) => node.id)
        }));
      };
      addGroup("incoming", "small funders", hiddenIncoming, "incoming");
      addGroup("outgoing", "small outgoing", hiddenOutgoing, "outgoing");
      addGroup("service", "services", hiddenServices, "service");
      addGroup("context", "context", hiddenContext, "context");
      const visibleIds = new Set(visualNodes.map((node) => node.id));
      const aggregateEdges = collapsedGroupAggregateEdges(edges, visibleIds, hiddenNodeToGroupId, groupKindById);
      const externallyLinkedGroupIds = new Set();
      aggregateEdges.forEach((edge) => {
        if (String(edge.fromNodeId || "").startsWith("collapsed:")) externallyLinkedGroupIds.add(edge.fromNodeId);
        if (String(edge.toNodeId || "").startsWith("collapsed:")) externallyLinkedGroupIds.add(edge.toNodeId);
        visualEdges.push(edge);
      });
      groupEntries.forEach((entry) => {
        if (!externallyLinkedGroupIds.has(entry.groupId)) visualEdges.push(collapsedGroupEdge(entry.key, subjectId, entry.groupId, entry.groupKind));
      });
      return { nodes: visualNodes, edges: visualEdges };
    }
    function buildStepOrbitPresentation(nodes, edges) {
      const subject = nodes.find((node) => node.kind === "subject") || nodes[0];
      if (!subject) return { nodes, edges };
      const subjectId = subject.id;
      const roles = { source: [], funding: [], subject: [subject], service: [], stop: [], context: [] };
      nodes.forEach((node) => {
        if (node.id === subjectId) return;
        const role = stepOrbitRole(node, subjectId, edges);
        roles[role].push(node);
      });
      const keepSource = importantClusterNodes(roles.source, edges, 10);
      const keepFunding = importantClusterNodes(roles.funding, edges, 12);
      const keepService = importantClusterNodes(roles.service, edges, state.servicesVisible ? 10 : 0);
      const keepStop = importantClusterNodes(roles.stop, edges, 8);
      const keepContext = importantClusterNodes(roles.context, edges, 8);
      const keptIds = new Set([subjectId, ...keepSource, ...keepFunding, ...keepService, ...keepStop, ...keepContext]);
      const visualNodes = nodes.filter((node) => keptIds.has(node.id));
      const visualEdges = edges.filter((edge) => keptIds.has(edge.fromNodeId) && keptIds.has(edge.toNodeId));
      const hiddenNodeToGroupId = new Map();
      const groupKindById = new Map();
      const groupEntries = [];
      const addSummary = (id, label, hiddenNodes, groupKind, role, reason) => {
        if (hiddenNodes.length === 0) return;
        if (!state.servicesVisible && role === "service") return;
        const groupNode = stepOrbitSummaryNode(id, label, hiddenNodes, groupKind, role, reason);
        hiddenNodes.forEach((node) => hiddenNodeToGroupId.set(node.id, id));
        groupKindById.set(id, groupKind);
        groupEntries.push({ key: id.replace("step:", "step-"), groupId: id, groupKind });
        visualNodes.push(groupNode);
      };
      addSummary("step:source", "source wallets", roles.source.filter((node) => !keptIds.has(node.id)), "incoming", "source", "Lower-priority source wallets were collapsed to keep the money route readable.");
      addSummary("step:funding", "funding groups", roles.funding.filter((node) => !keptIds.has(node.id)), "context", "funding", "Lower-priority funding groups were collapsed; real funding bundles remain distinguishable in the right rail.");
      addSummary("step:service", "services", roles.service.filter((node) => !keptIds.has(node.id)), "service", "service", "Lower-priority service-like endpoints were collapsed.");
      addSummary("step:stop", "boundary stops", roles.stop.filter((node) => !keptIds.has(node.id)), "context", "stop", "Lower-priority boundary stops were collapsed.");
      addSummary("step:context", "context wallets", roles.context.filter((node) => !keptIds.has(node.id)), "context", "context", "Lower-priority context wallets were collapsed.");
      const visibleIds = new Set(visualNodes.map((node) => node.id));
      const aggregateEdges = collapsedGroupAggregateEdges(edges, visibleIds, hiddenNodeToGroupId, groupKindById);
      const externallyLinkedGroupIds = new Set();
      aggregateEdges.forEach((edge) => {
        if (String(edge.fromNodeId || "").startsWith("step:")) externallyLinkedGroupIds.add(edge.fromNodeId);
        if (String(edge.toNodeId || "").startsWith("step:")) externallyLinkedGroupIds.add(edge.toNodeId);
        visualEdges.push(edge);
      });
      groupEntries.forEach((entry) => {
        if (!externallyLinkedGroupIds.has(entry.groupId)) visualEdges.push(collapsedGroupEdge(entry.key, subjectId, entry.groupId, entry.groupKind));
      });
      return { nodes: visualNodes, edges: visualEdges };
    }
    function deepBranchStep1NodeIds(nodes, edges, subjectId) {
      const ids = new Set();
      edges.forEach((edge) => {
        if (edge.fromNodeId === subjectId && edge.toNodeId) ids.add(edge.toNodeId);
        if (edge.toNodeId === subjectId && edge.fromNodeId) ids.add(edge.fromNodeId);
      });
      return new Set(nodes.filter((node) => ids.has(node.id)).sort(stableNodeSort).map((node) => node.id));
    }
    function buildDeepBranchPresentation(nodes, edges) {
      const subject = nodes.find((node) => node.kind === "subject") || nodes[0];
      if (!subject) return { nodes, edges };
      const subjectId = subject.id;
      const step1Ids = deepBranchStep1NodeIds(nodes, edges, subjectId);
      const anchorByNodeId = new Map();
      const explicitAnchorNodeIds = new Set();
      nodes.forEach((node) => {
        const anchorId = node?.metadata?.deepBranchAnchorId || subjectId;
        if (anchorId !== subjectId) explicitAnchorNodeIds.add(node.id);
        anchorByNodeId.set(node.id, anchorId);
      });
      edges.forEach((edge) => {
        if (step1Ids.has(edge.fromNodeId) && anchorByNodeId.get(edge.toNodeId) === subjectId && !explicitAnchorNodeIds.has(edge.toNodeId) && !step1Ids.has(edge.toNodeId) && edge.toNodeId !== subjectId) {
          anchorByNodeId.set(edge.toNodeId, edge.fromNodeId);
        }
        if (step1Ids.has(edge.toNodeId) && anchorByNodeId.get(edge.fromNodeId) === subjectId && !explicitAnchorNodeIds.has(edge.fromNodeId) && !step1Ids.has(edge.fromNodeId) && edge.fromNodeId !== subjectId) {
          anchorByNodeId.set(edge.fromNodeId, edge.toNodeId);
        }
      });
      const keepByAnchor = new Map();
      const hiddenByAnchor = new Map();
      const keptIds = new Set([subjectId, ...step1Ids]);
      nodes
        .filter((node) => node.id !== subjectId && !step1Ids.has(node.id))
        .sort(stableNodeSort)
        .forEach((node) => {
          if (!state.servicesVisible && nodeIsServiceLike(node)) return false;
          const anchorId = anchorByNodeId.get(node.id) || subjectId;
          const role = deepLocalOrbitRole(node);
          const protectedNode = role === "service" || role === "stop" || role === "group";
          const key = anchorId + ":" + role;
          const keptForKey = keepByAnchor.get(key) || 0;
          if (protectedNode || keptForKey < 2) {
            keepByAnchor.set(key, keptForKey + 1);
            keptIds.add(node.id);
            return true;
          }
          const hidden = hiddenByAnchor.get(anchorId) || [];
          hidden.push(node);
          hiddenByAnchor.set(anchorId, hidden);
          return false;
        });
      const visualNodes = nodes
        .filter((node) => keptIds.has(node.id))
        .map((node) => {
          const anchorId = anchorByNodeId.get(node.id) || subjectId;
          return {
            ...node,
            metadata: { ...node.metadata, deepBranchAnchorId: anchorId }
          };
        });

      hiddenByAnchor.forEach((hidden, anchorId) => {
        if (hidden.length === 0) return;
        hidden.forEach((node) => {
          keptIds.add(node.id);
          visualNodes.push({
            ...node,
            metadata: { ...node.metadata, deepBranchAnchorId: anchorId }
          });
        });
      });

      const visualEdges = edges.filter((edge) => keptIds.has(edge.fromNodeId) && keptIds.has(edge.toNodeId));

      return { nodes: visualNodes, edges: visualEdges };
    }
    function buildWalletClusterPresentation(rawNodes, rawEdges) {
      const subjectId = rawNodes.find((node) => node.kind === "subject")?.id || rawNodes[0]?.id || "";
      if (!subjectId) return { nodes: rawNodes, edges: rawEdges };
      const important = importantClusterNodes(rawNodes, rawEdges, 72);
      const roleByNodeId = new Map(rawNodes.map((node) => [node.id, walletClusterNodeRole(node, subjectId, rawEdges)]));
      const isOrdinaryWalletRole = (nodeId) => {
        const role = roleByNodeId.get(nodeId);
        return role === "source" || role === "intermediate" || role === "subject" || role === "outgoing";
      };
      const chainWalletIds = new Set([subjectId]);
      let frontier = new Set([subjectId]);
      for (let hop = 0; hop < 2; hop += 1) {
        const next = new Set();
        rawEdges.forEach((edge) => {
          if (!isOrdinaryWalletRole(edge.fromNodeId) || !isOrdinaryWalletRole(edge.toNodeId)) return;
          if (frontier.has(edge.fromNodeId) && !chainWalletIds.has(edge.toNodeId)) next.add(edge.toNodeId);
          if (frontier.has(edge.toNodeId) && !chainWalletIds.has(edge.fromNodeId)) next.add(edge.fromNodeId);
        });
        if (next.size === 0) break;
        next.forEach((nodeId) => chainWalletIds.add(nodeId));
        frontier = next;
      }
      const kept = [];
      const hiddenByRole = new Map();

      [...rawNodes].sort(stableNodeSort).forEach((node) => {
        const role = roleByNodeId.get(node.id) || walletClusterNodeRole(node, subjectId, rawEdges);
        // ponytail: keep all contract nodes visible; upgrade to contract hub collapse if campaigns exceed lane scale.
        const keep = node.id === subjectId ||
          chainWalletIds.has(node.id) ||
          role === "contract" ||
          role === "boundary" ||
          role === "stop" ||
          role === "group" ||
          important.has(node.id);
        if (keep || state.expandedBundleNodeIds.has(node.id)) {
          kept.push({
            ...node,
            metadata: {
              ...node.metadata,
              walletClusterRole: role
            }
          });
          return;
        }
        const bucket = hiddenByRole.get(role) || [];
        bucket.push(node);
        hiddenByRole.set(role, bucket);
      });

      const groups = [];
      const hiddenNodeToGroupId = new Map();
      const groupKindById = new Map();
      hiddenByRole.forEach((hiddenNodes, role) => {
        if (hiddenNodes.length === 0) return;
        const groupId = "collapsed:wallet_cluster:" + role;
        hiddenNodes.forEach((node) => hiddenNodeToGroupId.set(node.id, groupId));
        groupKindById.set(groupId, role);
        groups.push({
          id: groupId,
          kind: "group",
          displayKind: "collapsed_group",
          label: "Group: " + hiddenNodes.length + " wallets",
          weight: hiddenNodes.length,
          metadata: {
            walletClusterSummary: true,
            walletClusterRole: role,
            groupKind: role,
            collapsedCount: hiddenNodes.length,
            hiddenNodeIds: hiddenNodes.map((node) => node.id),
            groupReason: "wallet_cluster_overview",
            uiCollapsedGroup: true,
            realGroupKind: "ui_collapsed_wallet_cluster_group"
          }
        });
      });

      const visibleIds = new Set([...kept, ...groups].map((node) => node.id));
      const edges = rawEdges.filter((edge) => visibleIds.has(edge.fromNodeId) && visibleIds.has(edge.toNodeId));
      const sourceEdgeById = new Map(rawEdges.filter((edge) => edge?.id).map((edge) => [edge.id, edge]));
      const aggregateEdges = collapsedGroupAggregateEdges(rawEdges, visibleIds, hiddenNodeToGroupId, groupKindById)
        .map((edge) => {
          const sourceEdgeIds = Array.isArray(edge?.metadata?.sourceEdgeIds)
            ? edge.metadata.sourceEdgeIds
            : Array.isArray(edge?.metadata?.hiddenEdgeIds)
              ? edge.metadata.hiddenEdgeIds
              : [];
          const sourceDisplayRoles = [...new Set(sourceEdgeIds
            .map((edgeId) => {
              const sourceEdge = sourceEdgeById.get(edgeId);
              return sourceEdge?.displayRole || sourceEdge?.type || null;
            })
            .filter(Boolean))];
          const id = String(edge?.id || "").startsWith("collapsed-edge:wallet_cluster:")
            ? edge.id
            : String(edge?.id || "").replace(/^collapsed-edge:/, "collapsed-edge:wallet_cluster:");
          return {
            ...edge,
            id,
            metadata: {
              ...edge.metadata,
              walletClusterSummary: true,
              sourceDisplayRole: sourceDisplayRoles[0] || null,
              sourceDisplayRoles
            }
          };
        });
      aggregateEdges.forEach((edge) => edges.push(edge));
      return { nodes: [...kept, ...groups], edges };
    }
    function applyBundleMemberVisibility(nodes, edges) {
      const hiddenMemberNodeIds = new Set();
      const keptEdges = [];
      edges.forEach((edge) => {
        const bundleNodeId = edge?.metadata?.bundleNodeId || "";
        const isStoredMemberEdge = edge?.metadata?.bundleRole === "top_funder";
        const syntheticBundleNodeId = edge?.metadata?.parentBundleId || "";
        const isSyntheticMemberEdge = String(edge?.id || "").startsWith("bundle-member-edge:") || edge?.displayRole === "bundle_member";
        if (isSyntheticMemberEdge && !state.expandedBundleNodeIds.has(syntheticBundleNodeId)) {
          if (edge?.fromNodeId) hiddenMemberNodeIds.add(edge.fromNodeId);
          if (edge?.toNodeId && String(edge.toNodeId).startsWith("bundle-member:")) hiddenMemberNodeIds.add(edge.toNodeId);
          return;
        }
        if (!isStoredMemberEdge || state.expandedBundleNodeIds.has(bundleNodeId)) {
          keptEdges.push(edge);
          return;
        }
        if (edge?.fromNodeId) hiddenMemberNodeIds.add(edge.fromNodeId);
      });
      const connectedNodeIds = new Set();
      keptEdges.forEach((edge) => {
        if (edge?.fromNodeId) connectedNodeIds.add(edge.fromNodeId);
        if (edge?.toNodeId) connectedNodeIds.add(edge.toNodeId);
      });
      return {
        nodes: nodes.filter((node) => {
          const syntheticBundleNodeId = node?.metadata?.parentBundleId || "";
          const isSyntheticMemberNode = String(node?.id || "").startsWith("bundle-member:") || node?.metadata?.bundleMember === true;
          if (isSyntheticMemberNode && !state.expandedBundleNodeIds.has(syntheticBundleNodeId)) return false;
          return !hiddenMemberNodeIds.has(node.id) || connectedNodeIds.has(node.id) || node.kind === "subject";
        }),
        edges: keptEdges
      };
    }
    function applyExpandedBundlePresentation(nodes, edges) {
      const visible = applyBundleMemberVisibility(nodes, edges);
      const visualNodes = [...visible.nodes];
      const visualEdges = [...visible.edges];
      const nodeIds = new Set(visualNodes.map((node) => node.id));
      const edgeIds = new Set(visualEdges.map((edge) => edge.id));
      const storedMemberEdgesByBundleId = new Set(visualEdges
        .filter((edge) => edge?.metadata?.bundleRole === "top_funder" && edge?.metadata?.bundleNodeId)
        .map((edge) => edge.metadata.bundleNodeId));
      visualNodes.filter((node) => state.expandedBundleNodeIds.has(node.id)).forEach((bundleNode) => {
        if (storedMemberEdgesByBundleId.has(bundleNode.id)) return;
        const memberNodes = expandedBundleMemberNodes(bundleNode);
        const memberEdges = expandedBundleMemberEdges(bundleNode, memberNodes);
        memberNodes.forEach((member) => {
          if (nodeIds.has(member.id)) return;
          nodeIds.add(member.id);
          visualNodes.push(member);
        });
        memberEdges.forEach((edge) => {
          if (edgeIds.has(edge.id)) return;
          edgeIds.add(edge.id);
          visualEdges.push(edge);
        });
      });
      return { nodes: visualNodes, edges: visualEdges };
    }
    function expandedBundleMemberNodes(bundleNode) {
      return asArray(bundleNode?.metadata?.topFunders).map((funder, index) => ({
        id: "bundle-member:" + bundleNode.id + ":" + index,
        kind: "wallet",
        displayKind: "wallet",
        address: funder.address || null,
        label: funder.address || "bundle member",
        weight: Number(funder.amountRaw || 0),
        metadata: { parentBundleId: bundleNode.id, bundleMember: true, amountRaw: funder.amountRaw || null, txHashes: asArray(funder.txHashes) }
      }));
    }
    function expandedBundleMemberEdges(bundleNode, memberNodes) {
      return memberNodes.map((member) => ({
        id: "bundle-member-edge:" + member.id,
        fromNodeId: member.id,
        toNodeId: bundleNode.id,
        type: "inferred_provenance",
        displayRole: "bundle_member",
        amountRaw: member.metadata?.amountRaw || null,
        txHash: asArray(member.metadata?.txHashes)[0] || null,
        timestamp: null,
        verdict: "unknown",
        weight: member.weight || 1,
        metadata: { parentBundleId: bundleNode.id, direction: "inbound" }
      }));
    }
    function nodeImportanceScore(node, edges) {
      const directWeight = Number(node.weight || node.score || 0);
      const relatedRaw = edges.reduce((total, edge) => {
        if (edge.fromNodeId !== node.id && edge.toNodeId !== node.id) return total;
        const raw = rawBigInt(edge?.metadata?.usedAmountRaw || edge?.amountRaw || edge?.metadata?.originalAmountRaw);
        return total + (raw === null ? 0 : Number(raw > 9007199254740991n ? 9007199254740991n : raw));
      }, 0);
      const serviceBoost = nodeIsServiceLike(node) ? 1000000 : 0;
      const stopBoost = nodeDisplayKind(node) === "trace_stop" ? 900000 : 0;
      return directWeight * 1000 + relatedRaw + serviceBoost + stopBoost;
    }
    function rankNodesByImportance(nodes, edges) {
      return [...nodes].sort((a, b) => {
        const score = nodeImportanceScore(b, edges) - nodeImportanceScore(a, edges);
        return score !== 0 ? score : String(a.id).localeCompare(String(b.id));
      });
    }
    function collapsedGroupNode(id, label, count, xHint, yHint, groupKind, metadata = {}) {
      return {
        id,
        kind: "group",
        displayKind: "collapsed_group",
        label: "+" + count + " " + label,
        weight: count,
        metadata: { groupKind, collapsedCount: count, xHint, yHint, ...metadata }
      };
    }
    function collapsedGroupEdge(id, fromNodeId, toNodeId, groupKind) {
      const edgeFromNodeId = groupKind === "incoming" ? toNodeId : fromNodeId;
      const edgeToNodeId = groupKind === "incoming" ? fromNodeId : toNodeId;
      return {
        id: "collapsed-edge:" + id,
        fromNodeId: edgeFromNodeId,
        toNodeId: edgeToNodeId,
        type: "collapsed_group",
        displayRole: "collapsed_group",
        verdict: "review",
        weight: 1,
        metadata: { groupKind }
      };
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
    function flowMapPathNodeIds(path, edgeById) {
      const explicit = asArray(path?.nodeIds).filter(Boolean);
      if (explicit.length > 0) return explicit;
      const ids = [];
      asArray(path?.edgeIds).forEach((edgeId) => {
        const edge = edgeById.get(edgeId);
        if (!edge) return;
        if (edge.fromNodeId && ids[ids.length - 1] !== edge.fromNodeId) ids.push(edge.fromNodeId);
        if (edge.toNodeId) ids.push(edge.toNodeId);
      });
      return ids;
    }
    function flowMapPathIsResidualCaveat(path) {
      const label = String(path?.stopReasonLabel || path?.metadata?.stopTitle || path?.stopReason || "").toLowerCase();
      return path?.metadata?.residualUnresolvedBelowMateriality === true ||
        label.includes("residual source caveat") ||
        label.includes("residual caveat");
    }
    function flowMapOrderedPathItems(pathItems) {
      if (!graphKindUsesRouteFocusedFlowMap(state.graph?.job?.kind)) return pathItems;
      return [...pathItems].sort((a, b) => {
        const residualDelta = Number(flowMapPathIsResidualCaveat(a.path)) - Number(flowMapPathIsResidualCaveat(b.path));
        if (residualDelta !== 0) return residualDelta;
        const lengthDelta = b.nodeIds.length - a.nodeIds.length;
        if (lengthDelta !== 0) return lengthDelta;
        const shareDelta = Number(b.path?.amountShare || 0) - Number(a.path?.amountShare || 0);
        if (shareDelta !== 0) return shareDelta;
        const edgeDelta = asArray(b.path?.edgeIds).length - asArray(a.path?.edgeIds).length;
        return edgeDelta !== 0 ? edgeDelta : a.index - b.index;
      });
    }
    function flowMapPathLaneYByIndex(pathItems, mainY, pathGapY, height) {
      const laneYByIndex = new Map();
      if (!graphKindUsesRouteFocusedFlowMap(state.graph?.job?.kind)) return laneYByIndex;
      const primaryItems = pathItems.filter((item) => !flowMapPathIsResidualCaveat(item.path));
      const residualItems = pathItems.filter((item) => flowMapPathIsResidualCaveat(item.path));
      primaryItems.forEach((item, primaryIndex) => {
        const laneOffset = primaryIndex === 0 ? 0 : Math.ceil(primaryIndex / 2) * (primaryIndex % 2 === 0 ? -1 : 1);
        laneYByIndex.set(item.index, mainY + laneOffset * pathGapY * .58);
      });
      residualItems.forEach((item, residualIndex) => {
        const row = Math.floor(residualIndex / 3);
        const column = residualIndex % 3;
        laneYByIndex.set(item.index, height * .76 + row * 76 + (column - 1) * 42);
      });
      return laneYByIndex;
    }
    function flowMapPathItems(sourceNodes, sourceEdges) {
      const nodeById = new Map(sourceNodes.map((node) => [node.id, node]));
      const edgeById = new Map(sourceEdges.map((edge) => [edge.id, edge]));
      const items = graphPaths(state.graph)
        .map((path, index) => ({
          path,
          index,
          nodeIds: flowMapPathNodeIds(path, edgeById)
            .filter((nodeId) => {
              const node = nodeById.get(nodeId);
              if (!node) return false;
              const kind = nodeDisplayKind(node);
              return kind !== "funding_bundle" && kind !== "trace_stop" && !nodeIsServiceLike(node);
            })
        }))
        .filter((item) => item.nodeIds.length > 1);
      return flowMapOrderedPathItems(items);
    }
    function flowMapConnectedPlacedNodes(node, sourceEdges, placedById) {
      return sourceEdges
        .filter((edge) => edge.fromNodeId === node.id || edge.toNodeId === node.id)
        .map((edge) => edge.fromNodeId === node.id ? placedById.get(edge.toNodeId) : placedById.get(edge.fromNodeId))
        .filter(Boolean);
    }
    function flowMapBundleAnchor(node, sourceEdges, placedById) {
      const connected = flowMapConnectedPlacedNodes(node, sourceEdges, placedById);
      if (connected.length > 0) return connected[0];
      const parent = placedById.get(node?.metadata?.parentBundleId);
      return parent || null;
    }
    function flowMapStopSide(node) {
      const text = String(node?.metadata?.reason || node?.metadata?.stopTitle || node?.label || "").toLowerCase();
      return text.includes("previous") || text.includes("source") || text.includes("history") ? "left" : "right";
    }
    function flowMapBundleLaneSide(anchor, mainY, slot) {
      return 1;
    }
    function flowMapLayout(sourceNodes, sourceEdges) {
      const pathItems = flowMapPathItems(sourceNodes, sourceEdges);
      if (pathItems.length === 0) return stepOrbitLayout(sourceNodes, sourceEdges);

      const maxPathLength = Math.max(2, ...pathItems.map((item) => item.nodeIds.length));
      const routeFocused = graphKindUsesRouteFocusedFlowMap(state.graph?.job?.kind);
      const residualPathCount = routeFocused ? pathItems.filter((item) => flowMapPathIsResidualCaveat(item.path)).length : 0;
      const primaryPathCount = routeFocused ? pathItems.length - residualPathCount : pathItems.length;
      const visualPathRows = routeFocused
        ? Math.max(3, Math.min(4, primaryPathCount) + Math.ceil(residualPathCount / 3))
        : Math.max(pathItems.length, pathItems.length <= 2 ? 3 : pathItems.length);
      const compactLane = !routeFocused && pathItems.length <= 2;
      const pathStepWidth = compactLane ? 170 : 210;
      const width = Math.max(1680, 680 + maxPathLength * pathStepWidth + sourceNodes.length * 10);
      const height = Math.max(920, 620 + visualPathRows * 170 + sourceNodes.length * 5);
      const pathStartX = 260;
      const pathEndX = width * 0.72;
      const mainY = height * 0.44;
      const peerLaneY = height * 0.20;
      const bundleLaneGap = compactLane ? 210 : 180;
      const stopLeftX = 120;
      const stopRightX = width - 150;
      const stopColumnGap = 190;
      const pathGapY = Math.max(170, Math.min(260, height * 0.17));
      const pathStepX = maxPathLength > 1 ? (pathEndX - pathStartX) / (maxPathLength - 1) : 0;
      const pathWaveAmplitude = compactLane ? Math.min(220, Math.max(110, height * .12)) : 0;
      const subjectId = sourceNodes.find((node) => node.kind === "subject")?.id || sourceNodes[0]?.id || "";
      const sourceById = new Map(sourceNodes.map((node) => [node.id, node]));
      const pathTargets = new Map();
      const pathLaneYByIndex = flowMapPathLaneYByIndex(pathItems, mainY, pathGapY, height);

      pathItems.forEach((item, pathIndex) => {
        const pathY = pathLaneYByIndex.get(item.index) ?? mainY + (pathIndex - (pathItems.length - 1) / 2) * pathGapY;
        item.nodeIds.forEach((nodeId, nodeIndex) => {
          const progress = maxPathLength > 1 ? nodeIndex / (maxPathLength - 1) : 0;
          const waveY = pathWaveAmplitude ? Math.sin(progress * Math.PI * 2 - Math.PI / 5) * pathWaveAmplitude : 0;
          const staggerY = pathWaveAmplitude && nodeIndex % 2 ? pathWaveAmplitude * .18 : 0;
          const target = { x: pathStartX + nodeIndex * pathStepX, y: pathY + waveY + staggerY };
          const existing = pathTargets.get(nodeId) || [];
          existing.push(target);
          pathTargets.set(nodeId, existing);
        });
      });

      const nodes = [];
      const placedById = new Map();
      pathTargets.forEach((targets, nodeId) => {
        const node = sourceById.get(nodeId);
        if (!node) return;
        const maxX = Math.max(...targets.map((target) => target.x));
        const rightmostTargets = targets.filter((target) => Math.abs(target.x - maxX) < 1);
        const averageY = rightmostTargets.reduce((total, target) => total + target.y, 0) / rightmostTargets.length;
        const placed = { ...node, x: maxX, y: averageY };
        nodes.push(placed);
        placedById.set(nodeId, placed);
      });

      const stopNodes = [];
      const bundleNodes = [];
      const bundleMemberNodes = [];
      const serviceNodes = [];
      const peerNodes = [];
      sourceNodes.forEach((node) => {
        if (placedById.has(node.id)) return;
        const kind = nodeDisplayKind(node);
        if (kind === "trace_stop") stopNodes.push(node);
        else if (String(node.id || "").startsWith("bundle-member:")) bundleMemberNodes.push(node);
        else if (kind === "funding_bundle") bundleNodes.push(node);
        else if (nodeIsServiceLike(node)) serviceNodes.push(node);
        else peerNodes.push(node);
      });

      const bundleSlotByAnchor = new Map();
      bundleNodes.sort(stableNodeSort).forEach((node, index) => {
        const anchor = flowMapBundleAnchor(node, sourceEdges, placedById);
        const key = anchor?.id || "free";
        const slot = bundleSlotByAnchor.get(key) || 0;
        bundleSlotByAnchor.set(key, slot + 1);
        const bundleSide = flowMapBundleLaneSide(anchor, mainY, slot);
        const x = anchor ? anchor.x + 96 + (slot % 3) * 126 : width * 0.52 + (slot % 4 - 1.5) * 150;
        const y = anchor ? anchor.y + bundleLaneGap * bundleSide + Math.floor(slot / 3) * 92 * bundleSide : mainY + bundleLaneGap * bundleSide + Math.floor(slot / 4) * 92 * bundleSide;
        const placed = { ...node, x, y };
        nodes.push(placed);
        placedById.set(node.id, placed);
      });

      const memberSlotByBundle = new Map();
      bundleMemberNodes.sort(stableNodeSort).forEach((node, index) => {
        const parentId = node?.metadata?.parentBundleId || "";
        const parent = placedById.get(parentId);
        const slot = memberSlotByBundle.get(parentId) || 0;
        memberSlotByBundle.set(parentId, slot + 1);
        const side = parent && parent.y < mainY ? -1 : 1;
        const angle = (side < 0 ? 0.65 : -0.65) + slot * 0.34;
        const radius = 96 + Math.floor(slot / 6) * 42;
        const x = parent ? parent.x + Math.cos(angle) * radius : width * 0.42 + (index % 5) * 82;
        const y = parent ? parent.y + side * (72 + Math.abs(Math.sin(angle) * radius)) : mainY + side * (270 + Math.floor(index / 5) * 72);
        const placed = { ...node, x, y };
        nodes.push(placed);
        placedById.set(node.id, placed);
      });

      peerNodes.sort(stableNodeSort).forEach((node, index) => {
        const connected = flowMapConnectedPlacedNodes(node, sourceEdges, placedById);
        const averageX = connected.length > 0
          ? connected.reduce((total, item) => total + item.x, 0) / connected.length
          : pathStartX + (index + 1) * ((pathEndX - pathStartX) / Math.max(2, peerNodes.length + 1));
        const row = index % 3;
        const placed = {
          ...node,
          x: averageX + ((index % 2) ? 46 : -46),
          y: peerLaneY + row * 78
        };
        nodes.push(placed);
        placedById.set(node.id, placed);
      });

      const serviceColumnGap = 104;
      const serviceColumns = 3;
      const serviceBaseX = Math.min(width - 180 - serviceColumnGap * (serviceColumns - 1), pathEndX + 220);
      serviceNodes.sort(stableNodeSort).forEach((node, index) => {
        const placed = {
          ...node,
          x: serviceBaseX + (index % serviceColumns) * serviceColumnGap,
          y: height * 0.32 + Math.floor(index / serviceColumns) * 98
        };
        nodes.push(placed);
        placedById.set(node.id, placed);
      });

      const stopSlotByAnchor = new Map();
      stopNodes.sort(stableNodeSort).forEach((node, index) => {
        const side = flowMapStopSide(node);
        const related = flowMapConnectedPlacedNodes(node, sourceEdges, placedById)[0];
        const key = related?.id || side;
        const slot = stopSlotByAnchor.get(key) || 0;
        stopSlotByAnchor.set(key, slot + 1);
        const x = related ? (side === "left" ? Math.max(stopLeftX, related.x - stopColumnGap) : Math.min(stopRightX, related.x + stopColumnGap)) : (side === "left" ? stopLeftX : stopRightX);
        const placed = {
          ...node,
          x,
          y: related ? related.y + 96 + (slot % 3) * 58 : mainY + 120 + (index - (stopNodes.length - 1) / 2) * 92
        };
        nodes.push(placed);
        placedById.set(node.id, placed);
      });

      const fixedNodeIds = new Set([subjectId].filter(Boolean));
      const relaxedNodes = relaxNodeCollisions(nodes, fixedNodeIds, 64);
      const boundedNodes = constrainLayoutNodes(relaxedNodes, width, height, fixedNodeIds);
      return { width, height, nodes: boundedNodes, byId: new Map(boundedNodes.map((node) => [node.id, node])) };
    }
    function deepFullEvidenceEdgeRelationship(edge) {
      return String(edge?.metadata?.relationship || edge?.metadata?.source || edge?.relationship || edge?.source || edge?.type || "");
    }
    function deepFullEvidenceRing(nodes, centerX, centerY, radiusX, radiusY, startAngle = -Math.PI, endAngle = Math.PI) {
      const sorted = [...nodes].sort(stableNodeSort);
      if (sorted.length === 0) return [];
      const span = endAngle - startAngle;
      return sorted.map((node, index) => {
        const angle = startAngle + span * ((index + .5) / sorted.length);
        return {
          ...node,
          x: centerX + Math.cos(angle) * radiusX,
          y: centerY + Math.sin(angle) * radiusY
        };
      });
    }
    function deepFullEvidenceLayoutRole(node, subjectId, directIds, secondIds) {
      const kind = nodeDisplayKind(node);
      if (node.id === subjectId || node.kind === "subject") return "subject";
      if (kind === "trace_stop") return "stop";
      if (kind === "funding_bundle" || node.kind === "bundle" || node.kind === "group" || node.displayKind === "collapsed_group") return "group";
      if (nodeIsSmartContractLaneNode(node)) return "contract";
      if (nodeIsServiceLike(node)) return "service";
      if (directIds.has(node.id)) return "direct";
      if (secondIds.has(node.id)) return "second";
      return "context";
    }
    function deepFullEvidenceLayout(sourceNodes, sourceEdges) {
      const subjectId = sourceNodes.find((node) => node.kind === "subject")?.id || sourceNodes[0]?.id || "";
      const subject = sourceNodes.find((node) => node.id === subjectId) || sourceNodes[0];
      if (!subject) return { width: 2200, height: 1400, nodes: [], byId: new Map() };
      const directIds = new Set();
      sourceEdges.forEach((edge) => {
        const relationship = deepFullEvidenceEdgeRelationship(edge);
        if (edge.fromNodeId === subjectId && edge.toNodeId) directIds.add(edge.toNodeId);
        if (edge.toNodeId === subjectId && edge.fromNodeId) directIds.add(edge.fromNodeId);
        if (relationship === "direct_subject_edge") {
          if (edge.fromNodeId && edge.fromNodeId !== subjectId) directIds.add(edge.fromNodeId);
          if (edge.toNodeId && edge.toNodeId !== subjectId) directIds.add(edge.toNodeId);
        }
      });
      const secondIds = new Set();
      sourceEdges.forEach((edge) => {
        const relationship = deepFullEvidenceEdgeRelationship(edge);
        if (!relationship.includes("second_hop")) return;
        [edge.fromNodeId, edge.toNodeId].forEach((nodeId) => {
          if (nodeId && nodeId !== subjectId && !directIds.has(nodeId)) secondIds.add(nodeId);
        });
      });
      const width = Math.max(3600, 1500 + Math.min(sourceNodes.length, 360) * 12);
      const height = Math.max(2300, 1200 + Math.ceil(Math.min(sourceNodes.length, 360) / 24) * 120);
      const centerX = width * .50;
      const centerY = height * .50;
      const lanes = { subject: [], direct: [], second: [], service: [], contract: [], group: [], stop: [], context: [] };
      sourceNodes.forEach((node) => {
        const role = deepFullEvidenceLayoutRole(node, subjectId, directIds, secondIds);
        (lanes[role] || lanes.context).push(node);
      });
      const nodes = [
        { ...subject, x: centerX, y: centerY },
        ...deepFullEvidenceRing(lanes.direct.filter((node) => node.id !== subjectId), centerX, centerY, width * .18, height * .18, -Math.PI * .92, Math.PI * .92),
        ...deepFullEvidenceRing(lanes.second, centerX, centerY, width * .38, height * .34, -Math.PI * .98, Math.PI * .98),
        ...arrangeCluster(lanes.service, width * .82, height * .24, width * .10, height * .10, -2.8, .4),
        ...arrangeCluster(lanes.contract, width * .78, height * .78, width * .10, height * .10, -2.6, .5),
        ...arrangeCluster(lanes.group, width * .50, height * .88, width * .32, height * .08, -Math.PI, 0),
        ...arrangeCluster(lanes.stop, width * .16, height * .78, width * .10, height * .10, -2.4, .8),
        ...arrangeCluster(lanes.context, width * .18, height * .24, width * .12, height * .12, -2.4, .8)
      ];
      const fixedNodeIds = new Set([subjectId, ...lanes.direct.map((node) => node.id)]);
      const relaxedNodes = relaxNodeCollisions(nodes, fixedNodeIds, 50);
      const boundedNodes = constrainLayoutNodes(relaxedNodes, width, height, fixedNodeIds);
      return { width, height, nodes: boundedNodes, byId: new Map(boundedNodes.map((node) => [node.id, node])) };
    }
    function deepBranchMapLayout(sourceNodes, sourceEdges) {
      const subjectId = sourceNodes.find((node) => node.kind === "subject")?.id || sourceNodes[0]?.id || "";
      const subject = sourceNodes.find((node) => node.id === subjectId) || sourceNodes[0];
      if (!subject) return { width: 1700, height: 980, nodes: [], byId: new Map() };
      // ponytail: deterministic slots cap fan readability; upgrade path is per-branch lane packing if branches exceed overview scale.
      const rolePressure = sourceNodes.reduce((counts, node) => {
        const role = deepBranchLayoutRole(node);
        if (role === "contract") counts.contract += 1;
        else if (role === "service") counts.service += 1;
        else if (role === "stop") counts.stop += 1;
        else if (role === "group") counts.group += 1;
        return counts;
      }, { contract: 0, service: 0, stop: 0, group: 0 });
      const protectedPressure = Math.max(rolePressure.contract, rolePressure.service, rolePressure.stop, rolePressure.group);
      const width = Math.max(2100, 1280 + Math.min(sourceNodes.length, 120) * 10, 2100 + protectedPressure * 18);
      const height = Math.max(1260, 860 + Math.ceil(Math.min(sourceNodes.length, 120) / 16) * 76, 1260 + protectedPressure * 10);
      const subjectX = width * 0.50;
      const subjectY = height * 0.50;
      const nodes = [];
      const placedById = new Map();
      const sourceById = new Map(sourceNodes.map((node) => [node.id, node]));
      const subjectPlaced = { ...subject, x: subjectX, y: subjectY };
      nodes.push(subjectPlaced);
      placedById.set(subjectId, subjectPlaced);

      const step1 = sourceNodes
        .filter((node) => node.id !== subjectId && deepBranchLayoutRole(node) !== "contract" && !node?.metadata?.parentBundleId && (node?.metadata?.deepBranchAnchorId || subjectId) === subjectId)
        .sort(stableNodeSort);
      const incoming = step1.filter((node) => nodeLayoutSide(node, subjectId, sourceEdges) === "incoming");
      const outgoing = step1.filter((node) => nodeLayoutSide(node, subjectId, sourceEdges) !== "incoming");
      arrangeCluster(incoming, subjectX - 360, subjectY, 260, 420, -1.65, 1.35).forEach((node) => {
        nodes.push(node);
        placedById.set(node.id, node);
      });
      arrangeCluster(outgoing, subjectX + 380, subjectY, 280, 430, -1.35, 1.65).forEach((node) => {
        nodes.push(node);
        placedById.set(node.id, node);
      });

      const slotByAnchorRole = new Map();
      sourceNodes
        .filter((node) => !placedById.has(node.id))
        .sort((a, b) =>
          Number(Boolean(a?.metadata?.parentBundleId)) - Number(Boolean(b?.metadata?.parentBundleId)) ||
          stableNodeSort(a, b)
        )
        .forEach((node) => {
          const role = deepBranchLayoutRole(node);
          const anchorCandidates = deepBranchAnchorCandidates(node, sourceById, subjectId);
          const anchor = anchorCandidates.map((anchorId) => placedById.get(anchorId)).find(Boolean) || placedById.get(subjectId) || subjectPlaced;
          const key = anchor.id + ":" + role;
          const slot = slotByAnchorRole.get(key) || 0;
          slotByAnchorRole.set(key, slot + 1);
          const point = deepBranchPoint(anchor, slot, role);
          const placed = { ...node, x: point.x, y: point.y };
          nodes.push(placed);
          placedById.set(node.id, placed);
        });

      const fixedNodeIds = new Set([subjectId, ...step1.map((node) => node.id)]);
      const relaxedNodes = relaxNodeCollisions(nodes, fixedNodeIds, 58);
      const boundedNodes = constrainLayoutNodes(relaxedNodes, width, height, fixedNodeIds);
      return { width, height, nodes: boundedNodes, byId: new Map(boundedNodes.map((node) => [node.id, node])) };
    }
    function deepBranchAnchorCandidates(node, sourceById, subjectId) {
      const anchorId = node?.metadata?.deepBranchAnchorId || subjectId;
      const parentId = node?.metadata?.parentBundleId || "";
      const parent = parentId ? sourceById.get(parentId) : null;
      if (!parentId) return [anchorId];
      const parentBranchAnchorId = parent?.metadata?.deepBranchAnchorId || "";
      const parentIsBranchGroup = parent?.displayKind === "collapsed_group" || parent?.metadata?.groupReason === "deep_branch_overview";
      const candidates = parentIsBranchGroup ? [parentBranchAnchorId, parentId, anchorId] : [parentId, parentBranchAnchorId, anchorId];
      return candidates.filter(Boolean);
    }
    function deepBranchLayoutRole(node) {
      const kind = nodeDisplayKind(node);
      if (kind === "trace_stop") return "stop";
      if (nodeIsSmartContractLaneNode(node)) return "contract";
      if (nodeIsServiceLike(node)) return "service";
      if (node.kind === "group" || node.displayKind === "collapsed_group") return "group";
      return "wallet";
    }
    function deepBranchPoint(anchor, slot, role) {
      const ring = Math.floor(slot / 6);
      const localSlot = slot % 6;
      const baseAngle = role === "contract" ? 1.05 : role === "service" ? -0.75 : role === "stop" ? 1.75 : role === "group" ? 1.45 : -2.35;
      const angle = baseAngle + (localSlot - 2.5) * 0.34 + ring * 0.12;
      const radiusX = role === "contract" ? 230 : role === "service" ? 210 : role === "stop" ? 250 : role === "group" ? 176 : 154;
      const radiusY = role === "contract" ? 230 : role === "service" ? 130 : role === "stop" ? 150 : role === "group" ? 145 : 136;
      return {
        x: anchor.x + Math.cos(angle) * (radiusX + ring * 54),
        y: anchor.y + Math.sin(angle) * (radiusY + ring * 42)
      };
    }
    function uniqueNodeIds(ids) {
      const seen = new Set();
      return ids.filter((id) => {
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    }
    function deepLocalOrbitSpineNodeIds(sourceNodes, sourceEdges) {
      const pathItems = flowMapPathItems(sourceNodes, sourceEdges);
      if (pathItems.length > 0) {
        const ranked = [...pathItems].sort((a, b) =>
          b.nodeIds.length - a.nodeIds.length ||
          Number(b.path?.riskContribution || 0) - Number(a.path?.riskContribution || 0) ||
          a.index - b.index
        );
        return uniqueNodeIds(ranked[0].nodeIds);
      }
      const subjectId = sourceNodes.find((node) => node.kind === "subject")?.id || sourceNodes[0]?.id || "";
      const direct = sourceNodes
        .filter((node) => node.id !== subjectId)
        .filter((node) => sourceEdges.some((edge) => edge.fromNodeId === node.id || edge.toNodeId === node.id))
        .sort((a, b) => nodeImportanceScore(b, sourceEdges) - nodeImportanceScore(a, sourceEdges))
        .slice(0, 8)
        .map((node) => node.id);
      return uniqueNodeIds(subjectId ? [subjectId, ...direct] : direct);
    }
    function deepLocalOrbitRole(node) {
      const kind = nodeDisplayKind(node);
      if (kind === "trace_stop") return "stop";
      if (kind === "funding_bundle" || node.kind === "group" || node.displayKind === "collapsed_group") return "group";
      if (nodeIsServiceLike(node)) return "service";
      return "peer";
    }
    function deepLocalOrbitAnchorFor(node, sourceEdges, placedById, subjectId) {
      const parent = placedById.get(node?.metadata?.parentBundleId);
      if (parent) return parent;
      const connected = flowMapConnectedPlacedNodes(node, sourceEdges, placedById)
        .sort((a, b) => {
          if (a.id === subjectId) return 1;
          if (b.id === subjectId) return -1;
          return Math.abs(a.x - b.x) || String(a.id).localeCompare(String(b.id));
        });
      return connected[0] || placedById.get(subjectId) || [...placedById.values()][0] || null;
    }
    function deepLocalOrbitPoint(anchor, slot, role, width, height) {
      const baseX = anchor?.x ?? width * 0.5;
      const baseY = anchor?.y ?? height * 0.5;
      const ring = Math.floor(slot / 5);
      const localSlot = slot % 5;
      const radiusX = role === "service" ? 176 : role === "stop" ? 210 : role === "group" ? 150 : 126;
      const radiusY = role === "service" ? 108 : role === "stop" ? 116 : role === "group" ? 128 : 112;
      const roleBaseAngle = role === "peer" ? -2.2 : role === "group" ? 1.28 : role === "service" ? -0.34 : 0.34;
      const angle = roleBaseAngle + (localSlot - 2) * 0.42 + ring * 0.16;
      return {
        x: baseX + Math.cos(angle) * (radiusX + ring * 46),
        y: baseY + Math.sin(angle) * (radiusY + ring * 38)
      };
    }
    function deepLocalOrbitLayout(sourceNodes, sourceEdges) {
      const spineNodeIds = deepLocalOrbitSpineNodeIds(sourceNodes, sourceEdges);
      if (spineNodeIds.length === 0) return flowMapLayout(sourceNodes, sourceEdges);
      const subjectId = sourceNodes.find((node) => node.kind === "subject")?.id || spineNodeIds[0] || "";
      const sourceById = new Map(sourceNodes.map((node) => [node.id, node]));
      const spineNodes = spineNodeIds.map((id) => sourceById.get(id)).filter(Boolean);
      const width = Math.max(1480, 520 + spineNodes.length * 190 + Math.min(sourceNodes.length, 80) * 4);
      const height = Math.max(940, 700 + Math.ceil(Math.min(sourceNodes.length, 80) / 18) * 90);
      const startX = 180;
      const endX = width - 220;
      const centerY = height * 0.48;
      const stepX = spineNodes.length > 1 ? (endX - startX) / (spineNodes.length - 1) : 0;
      const subjectIndex = Math.max(0, spineNodes.findIndex((node) => node.id === subjectId));
      const subjectTargetX = Math.min(width - 280, Math.max(startX, width * 0.62));
      const rawStartX = subjectId && subjectIndex >= 0 ? subjectTargetX - subjectIndex * stepX : startX;
      const boundedStartX = clampLayoutValue(rawStartX, startX, Math.max(startX, endX - stepX * Math.max(0, spineNodes.length - 1)));
      const nodes = [];
      const placedById = new Map();
      spineNodes.forEach((node, index) => {
        const wave = Math.sin(index * 0.85) * 64;
        const placed = {
          ...node,
          x: boundedStartX + index * stepX,
          y: centerY + wave
        };
        nodes.push(placed);
        placedById.set(node.id, placed);
      });
      const slotByAnchorRole = new Map();
      sourceNodes
        .filter((node) => !placedById.has(node.id))
        .sort(stableNodeSort)
        .forEach((node) => {
          const role = deepLocalOrbitRole(node);
          const anchor = deepLocalOrbitAnchorFor(node, sourceEdges, placedById, subjectId);
          const key = (anchor?.id || "free") + ":" + role;
          const slot = slotByAnchorRole.get(key) || 0;
          slotByAnchorRole.set(key, slot + 1);
          const point = deepLocalOrbitPoint(anchor, slot, role, width, height);
          const placed = { ...node, x: point.x, y: point.y };
          nodes.push(placed);
          placedById.set(node.id, placed);
        });
      const fixedNodeIds = new Set([subjectId, ...spineNodeIds].filter(Boolean));
      const relaxedNodes = relaxNodeCollisions(nodes, fixedNodeIds, 44);
      const boundedNodes = constrainLayoutNodes(relaxedNodes, width, height, fixedNodeIds);
      return { width, height, nodes: boundedNodes, byId: new Map(boundedNodes.map((node) => [node.id, node])) };
    }
    function legacyFanLayout(sourceNodes, sourceEdges) {
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
    function denseFanLayout(sourceNodes, sourceEdges) {
      const width = 1900;
      const height = 1120;
      if (sourceNodes.length === 0) return { width, height, nodes: [], byId: new Map() };
      const subjectId = sourceNodes.find((node) => node.kind === "subject")?.id || sourceNodes[0]?.id;
      const subjectX = width * 0.50;
      const subjectY = height * 0.50;
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
        ...arrangeCluster(incomingNodes, width * 0.23, subjectY, 390, 470, -1.42, 1.42),
        ...arrangeCluster(outgoingNodes, width * 0.79, subjectY, 430, 500, -1.55, 1.55),
        ...arrangeCluster(serviceNodes, width * 0.66, subjectY + 150, 430, 250, -2.20, .30),
        ...arrangeCluster(contextNodes, width * 0.45, subjectY + 235, 420, 260, -2.80, -.55)
      ];
      const fixedNodeIds = new Set([subjectId]);
      const relaxedNodes = relaxNodeCollisions(nodes, fixedNodeIds, 34);
      const boundedNodes = constrainLayoutNodes(relaxedNodes, width, height, fixedNodeIds);
      const byId = new Map(boundedNodes.map((node) => [node.id, node]));
      return { width, height, nodes: boundedNodes, byId };
    }
    function timelineLaneLayout(sourceNodes, sourceEdges) {
      const width = Math.max(1900, 680 + sourceNodes.length * 34);
      const height = 1160;
      if (sourceNodes.length === 0) return { width, height, nodes: [], byId: new Map() };
      const subjectId = sourceNodes.find((node) => node.kind === "subject")?.id || sourceNodes[0]?.id;
      const laneY = {
        incoming: height * 0.25,
        subject: height * 0.48,
        outgoing: height * 0.63,
        service: height * 0.78,
        contract: height * 0.88,
        context: height * 0.36
      };
      const sorted = rankNodesByImportance(sourceNodes, sourceEdges).reverse();
      const xPadding = 220;
      const xSpacing = sourceNodes.length > 1 ? (width - xPadding * 2) / (sourceNodes.length - 1) : 0;
      const nodes = sorted.map((node, index) => {
        const side = node.id === subjectId ? "subject" : nodeIsSmartContractLaneNode(node) ? "contract" : nodeLayoutSide(node, subjectId, sourceEdges);
        const lane = side === "incoming" || side === "outgoing" || side === "service" || side === "contract" || side === "subject" ? side : "context";
        const x = xPadding + index * xSpacing;
        const rowOffset = (index % 5 - 2) * 34;
        return {
          ...node,
          x: node.id === subjectId ? width * 0.52 : x,
          y: laneY[lane] + (node.id === subjectId ? 0 : rowOffset)
        };
      });
      const fixedNodeIds = new Set([subjectId]);
      const relaxedNodes = relaxNodeCollisions(nodes, fixedNodeIds, 20);
      const boundedNodes = constrainLayoutNodes(relaxedNodes, width, height, fixedNodeIds);
      return { width, height, nodes: boundedNodes, byId: new Map(boundedNodes.map((node) => [node.id, node])) };
    }
    function arrangeStepOrbitLane(nodes, x, centerY, gap, role) {
      const sorted = [...nodes].sort(stableNodeSort);
      const count = sorted.length;
      const startY = centerY - ((count - 1) * gap) / 2;
      return sorted.map((node, index) => {
        const orbitOffset = ((index % 3) - 1) * 26;
        const roleOffset = role === "service" ? -18 : role === "stop" ? 18 : 0;
        return {
          ...node,
          x: x + orbitOffset,
          y: startY + index * gap + roleOffset
        };
      });
    }
    function stepOrbitLayout(sourceNodes, sourceEdges) {
      const width = 2450;
      const height = 1360;
      if (sourceNodes.length === 0) return { width, height, nodes: [], byId: new Map() };
      const subjectId = sourceNodes.find((node) => node.kind === "subject")?.id || sourceNodes[0]?.id;
      const laneX = { source: width * 0.15, funding: width * 0.36, subject: width * 0.56, service: width * 0.78, stop: width * 0.91, context: width * 0.29 };
      const laneY = { source: height * 0.48, funding: height * 0.48, subject: height * 0.48, service: height * 0.35, stop: height * 0.62, context: height * 0.72 };
      const laneNodes = { source: [], funding: [], subject: [], service: [], stop: [], context: [] };
      sourceNodes.forEach((node) => {
        const role = stepOrbitRole(node, subjectId, sourceEdges);
        laneNodes[role].push(node);
      });
      const nodes = [
        ...arrangeStepOrbitLane(laneNodes.source, laneX.source, laneY.source, 112, "source"),
        ...arrangeStepOrbitLane(laneNodes.funding, laneX.funding, laneY.funding, 108, "funding"),
        ...arrangeStepOrbitLane(laneNodes.context, laneX.context, laneY.context, 100, "context"),
        ...arrangeStepOrbitLane(laneNodes.subject, laneX.subject, laneY.subject, 100, "subject"),
        ...arrangeStepOrbitLane(laneNodes.service, laneX.service, laneY.service, 102, "service"),
        ...arrangeStepOrbitLane(laneNodes.stop, laneX.stop, laneY.stop, 96, "stop")
      ];
      const fixedNodeIds = new Set([subjectId]);
      const relaxedNodes = relaxNodeCollisions(nodes, fixedNodeIds, 56);
      const boundedNodes = constrainLayoutNodes(relaxedNodes, width, height, fixedNodeIds);
      return { width, height, nodes: boundedNodes, byId: new Map(boundedNodes.map((node) => [node.id, node])) };
    }
    function arrangeWalletClusterLane(nodes, x, centerY, gap, role) {
      const sorted = [...nodes].sort(stableNodeSort);
      const startY = centerY - ((sorted.length - 1) * gap) / 2;
      return sorted.map((node, index) => {
        const bend = ((index % 4) - 1.5) * 22;
        const roleOffset = role === "boundary" ? -20 : role === "stop" ? 24 : role === "group" ? 46 : 0;
        return {
          ...node,
          x: x + bend,
          y: startY + index * gap + roleOffset
        };
      });
    }
    function walletClusterLayout(sourceNodes, sourceEdges) {
      const width = Math.max(2300, 1500 + Math.min(sourceNodes.length, 120) * 8);
      const height = Math.max(1300, 900 + Math.ceil(Math.min(sourceNodes.length, 120) / 16) * 72);
      if (sourceNodes.length === 0) return { width, height, nodes: [], byId: new Map() };
      const subjectId = sourceNodes.find((node) => node.kind === "subject")?.id || sourceNodes[0]?.id;
      const laneX = {
        source: width * 0.16,
        intermediate: width * 0.36,
        subject: width * 0.56,
        outgoing: width * 0.74,
        contract: width * 0.48,
        boundary: width * 0.88,
        stop: width * 0.91,
        group: width * 0.40
      };
      const laneY = {
        source: height * 0.48,
        intermediate: height * 0.48,
        subject: height * 0.48,
        outgoing: height * 0.48,
        contract: height * 0.84,
        boundary: height * 0.34,
        stop: height * 0.64,
        group: height * 0.72
      };
      const laneNodes = { source: [], intermediate: [], subject: [], outgoing: [], contract: [], boundary: [], stop: [], group: [] };
      sourceNodes.forEach((node) => {
        const role = walletClusterNodeRole(node, subjectId, sourceEdges);
        (laneNodes[role] || laneNodes.intermediate).push(node);
      });
      const nodes = [
        ...arrangeWalletClusterLane(laneNodes.source, laneX.source, laneY.source, 118, "source"),
        ...arrangeWalletClusterLane(laneNodes.intermediate, laneX.intermediate, laneY.intermediate, 110, "intermediate"),
        ...arrangeWalletClusterLane(laneNodes.group, laneX.group, laneY.group, 108, "group"),
        ...arrangeWalletClusterLane(laneNodes.subject, laneX.subject, laneY.subject, 100, "subject"),
        ...arrangeWalletClusterLane(laneNodes.outgoing, laneX.outgoing, laneY.outgoing, 110, "outgoing"),
        ...arrangeWalletClusterLane(laneNodes.contract, laneX.contract, laneY.contract, 96, "contract"),
        ...arrangeWalletClusterLane(laneNodes.boundary, laneX.boundary, laneY.boundary, 98, "boundary"),
        ...arrangeWalletClusterLane(laneNodes.stop, laneX.stop, laneY.stop, 92, "stop")
      ];
      const fixedNodeIds = new Set([subjectId]);
      const relaxedNodes = relaxNodeCollisions(nodes, fixedNodeIds, 64);
      const boundedNodes = constrainLayoutNodes(relaxedNodes, width, height, fixedNodeIds);
      return { width, height, nodes: boundedNodes, byId: new Map(boundedNodes.map((node) => [node.id, node])) };
    }
    function graphFirstLayout(sourceNodes, sourceEdges, mode = graphDisplayMode(sourceNodes, sourceEdges), dense = graphIsDense(sourceNodes, sourceEdges)) {
      if (mode === "full_evidence") return deepFullEvidenceLayout(sourceNodes, sourceEdges);
      if (mode === "wallet_clusters") return walletClusterLayout(sourceNodes, sourceEdges);
      if (mode === "deep_branch_map") return deepBranchMapLayout(sourceNodes, sourceEdges);
      if (mode === "deep_local_orbit") return deepLocalOrbitLayout(sourceNodes, sourceEdges);
      if (mode === "flow_map") return flowMapLayout(sourceNodes, sourceEdges);
      if (mode === "show_all" && (dense || graphKindUsesFlowMap(state.graph?.job?.kind) || graphKindUsesDeepBranchMap(state.graph?.job?.kind))) return timelineLaneLayout(sourceNodes, sourceEdges);
      if (dense && mode === "step_orbit") return stepOrbitLayout(sourceNodes, sourceEdges);
      if (dense && mode === "fan") return denseFanLayout(sourceNodes, sourceEdges);
      return legacyFanLayout(sourceNodes, sourceEdges);
    }
    function graphPresentation(rawVisibleNodes, rawVisibleEdges) {
      const dense = graphIsDense(rawVisibleNodes, rawVisibleEdges);
      const mode = graphDisplayMode(rawVisibleNodes, rawVisibleEdges);
      if (mode === "full_evidence") return { nodes: rawVisibleNodes, edges: rawVisibleEdges, mode, dense: false };
      const bundleVisible = applyBundleMemberVisibility(rawVisibleNodes, rawVisibleEdges);
      let presentation = { nodes: bundleVisible.nodes, edges: bundleVisible.edges };
      if (mode === "wallet_clusters") {
        presentation = buildWalletClusterPresentation(bundleVisible.nodes, bundleVisible.edges);
      } else if (mode === "deep_branch_map") {
        presentation = buildDeepBranchPresentation(bundleVisible.nodes, bundleVisible.edges);
      } else if (dense && mode === "step_orbit") {
        presentation = buildStepOrbitPresentation(bundleVisible.nodes, bundleVisible.edges);
      } else if (dense && mode === "fan") {
        presentation = buildDenseFanPresentation(bundleVisible.nodes, bundleVisible.edges);
      }
      return { ...applyExpandedBundlePresentation(presentation.nodes, presentation.edges), mode, dense };
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
        return [...graphEdges(state.graph), ...state.renderedEdgesById.values()].some((edge) => (edge.fromNodeId === id && edge.toNodeId === state.selected.id) || (edge.toNodeId === id && edge.fromNodeId === state.selected.id));
      }
      if (state.selected.type === "edge") {
        const edge = edgeById(state.selected.id);
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
    function boundaryIdentityOf(value) {
      const identity = value?.metadata?.boundaryIdentity || value?.boundaryIdentity;
      return identity && typeof identity === "object" ? identity : null;
    }
    function boundaryIdentityName(value) {
      const identity = boundaryIdentityOf(value);
      return identity?.displayName ||
        value?.metadata?.boundaryEntityName ||
        (typeof value?.metadata?.boundaryIdentity === "string" ? value.metadata.boundaryIdentity : "") ||
        (typeof value?.boundaryIdentity === "string" ? value.boundaryIdentity : "") ||
        "";
    }
    function boundaryIdentityCategoryLabel(value) {
      const identity = boundaryIdentityOf(value);
      return identity?.categoryLabel || value?.metadata?.boundaryCategoryLabel || "";
    }
    function boundaryIdentityConfidenceLabel(value) {
      const identity = boundaryIdentityOf(value);
      return identity?.confidence || value?.metadata?.boundaryIdentityConfidence || "unknown";
    }
    function nodeDisplayKindIsServiceLike(kind) {
      return kind === "bridge" || kind === "cex" || kind === "contract_adapter" || kind === "contract_router" || kind === "dex_contract" || kind === "smart_contract" || kind === "service_boundary";
    }
    function nodeDisplayKind(node) {
      if (!node) return "wallet";
      if (node.displayKind) return node.displayKind;
      const marker = nodeMarker(node);
      if (node.kind === "subject") return "subject_wallet";
      if (node.kind === "group" || node.displayKind === "collapsed_group") return "collapsed_group";
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
      const kind = nodeDisplayKind(node);
      return (nodeDisplayKindIsServiceLike(kind) ? boundaryIdentityName(node) : "") ||
        node?.displayLabel ||
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
    function amountPillMetrics(label) {
      const lines = (Array.isArray(label) ? label : [label])
        .filter((value) => value !== null && value !== undefined && String(value).length > 0)
        .map((value) => String(value));
      if (lines.length === 0) return null;
      const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
      const width = Math.min(166, Math.max(70, longest * 6.2 + 18));
      const height = lines.length > 1 ? 34 : 20;
      const yOffset = lines.length > 1 ? 17 : 10;
      return { lines, width, height, yOffset };
    }
    function amountPill(label, x, y, speedClass = "", roleClass = "") {
      const metrics = amountPillMetrics(label);
      if (!metrics) return "";
      const { lines, width, height, yOffset } = metrics;
      const textLines = lines.slice(0, 2).map((line, index) => {
        const text = line.length > 22 ? line.slice(0, 21) + "..." : line;
        const className = index > 0 ? ' class="time-line"' : ' class="amount-line"';
        const textY = lines.length > 1 ? 13 + index * 13 : 14;
        return '<text' + className + ' x="' + (width / 2) + '" y="' + textY + '" text-anchor="middle">' + escapeHtml(text) + '</text>';
      }).join("");
      const className = "amount-pill" + (speedClass ? " " + escapeHtml(speedClass) : "") + (roleClass ? " " + escapeHtml(roleClass) : "");
      return '<g class="' + className + '" transform="translate(' + (x - width / 2) + ' ' + (y - 10) + ')">' +
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
    function compactAmountLabel(label) {
      const match = String(label || "").match(/^([0-9.]+)([KMB])? USDT$/);
      if (!match) return label || "";
      const amount = Number(match[1]);
      if (!Number.isFinite(amount)) return label || "";
      const suffix = match[2] || "";
      if (suffix) return trimNumber(amount) + suffix;
      if (amount >= 1000) return trimNumber(amount / 1000) + "K";
      return trimNumber(amount);
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
      if (edge?.metadata?.boundaryContextOnly === true) return "";
      const path = pathForEdge(edge?.id);
      return edge?.amountFormatted ||
        formatRawUsdt(edge?.amountRaw) ||
        path?.amountFormatted ||
        formatRawUsdt(path?.amountRaw) ||
        "";
    }
    function edgeOriginalAmount(edge) {
      if (edge?.metadata?.boundaryContextOnly === true) return "";
      return edge?.metadata?.originalAmountFormatted ||
        formatRawUsdt(edge?.metadata?.originalAmountRaw) ||
        edgeAmount(edge);
    }
    function edgeAllocatedAmount(edge) {
      if (edge?.metadata?.boundaryContextOnly === true) return "";
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
      if (edge?.metadata?.boundaryContextOnly === true) return "";
      return edgeOriginalAmount(edge) || edgeAmount(edge);
    }
    function edgeCanvasAmountOnlyLabel(edge) {
      if (edge?.metadata?.boundaryContextOnly === true) return "";
      return compactAmountLabel(edgeOriginalAmount(edge) || edgeAmount(edge));
    }
    function edgeCanvasTransferCount(edge) {
      if (edge?.metadata?.boundaryContextOnly === true) return null;
      const aggregate = edgeAggregateTransferCount(edge);
      if (aggregate && aggregate > 1) return aggregate;
      const txHashCount = typeof edgeTxHashes === "function"
        ? edgeTxHashes(edge).length
        : (Array.isArray(edge?.metadata?.txHashes) ? edge.metadata.txHashes.length : edge?.txHash ? 1 : 0);
      return txHashCount > 1 ? txHashCount : null;
    }
    function edgeCanvasLabel(edge) {
      if (edge?.metadata?.boundaryContextOnly === true) return "";
      const amount = edgeCanvasAmountOnlyLabel(edge);
      const count = edgeCanvasTransferCount(edge);
      if (count && count > 1 && amount) return count + " tx - " + amount;
      if (count && count > 1) return count + " tx";
      return amount;
    }
    function edgeEvidenceType(edge) {
      if (edge?.metadata?.evidenceType) return String(edge.metadata.evidenceType);
      if (edge?.type === "stop" || edgeDisplayRole(edge) === "stop") return "trace_stop";
      if (edgeDisplayRole(edge) === "profile_context") return "profile_context";
      if (edge?.type === "service_boundary") return "boundary_context";
      if (edge?.type === "transfer") {
        const count = edgeAggregateTransferCount(edge);
        return count && count > 1 ? "grouped_transfers" : "direct_transfer";
      }
      return "unknown";
    }
    function edgeAggregateAmountLabel(edge) {
      if (edge?.metadata?.boundaryContextOnly === true) return "";
      return edge?.metadata?.aggregateAmountFormatted ||
        edge?.metadata?.totalAmountFormatted ||
        edge?.metadata?.boundaryAmountFormatted ||
        formatRawUsdt(edge?.metadata?.aggregateAmountRaw) ||
        formatRawUsdt(edge?.metadata?.totalAmountRaw) ||
        formatRawUsdt(edge?.metadata?.boundaryAmountRaw) ||
        "";
    }
    function edgeAggregateTransferCount(edge) {
      if (edge?.metadata?.boundaryContextOnly === true) return null;
      const count = Number(edge?.metadata?.aggregateTransferCount ?? edge?.metadata?.transferCount ?? edge?.metadata?.txCount);
      if (Number.isFinite(count) && count > 0) return count;
      const transfers = asArray(edge?.metadata?.underlyingTransfers);
      return transfers.length > 0 ? transfers.length : null;
    }
    function edgeHasTransferRows(edge) {
      if (edge?.metadata?.boundaryContextOnly === true) return false;
      if (edge?.metadata?.evidenceType === "boundary_context_only") return false;
      const evidenceType = String(edge?.metadata?.evidenceType || "");
      if (
        evidenceType === "contract_trigger_context" ||
        evidenceType === "contract_call_context" ||
        evidenceType === "debit_authority_context" ||
        evidenceType === "approval_drain_contract_call" ||
        evidenceType === "approval_drain_spender_authority"
      ) return false;
      if (edgeHasAggregatedTxEvidence(edge) && edgeTxHashes(edge).length > 0) return true;
      if (Array.isArray(edge?.metadata?.underlyingTransfers) && edge.metadata.underlyingTransfers.length > 0) return true;
      return Boolean(edge?.txHash && edge.txHash !== "inferred");
    }
    function edgeHasStoredMoneyEvidence(edge) {
      if (edge?.metadata?.boundaryContextOnly === true) return false;
      if (edge?.metadata?.evidenceType === "boundary_context_only") return false;
      if (edge?.txHash) return true;
      if (asArray(edge?.metadata?.underlyingTransfers).length > 0) return true;
      if (edge?.metadata?.evidenceType === "approval_drain_transfer") return true;
      const count = edgeAggregateTransferCount(edge);
      const amount = edgeAggregateAmountLabel(edge) || edgeCanvasLabel(edge);
      return Boolean(count && amount);
    }
    function boundaryOnlyCopy() {
      return "Investigation boundary only. No money-flow edge is stored for this relationship.";
    }
    function edgeContextCanvasLabel(edge) {
      if (edge?.metadata?.boundaryContextOnly === true) return "";
      const type = edgeEvidenceType(edge);
      if (type !== "boundary_context" && type !== "grouped_transfers" && type !== "contract_driven_transfer" && type !== "profile_context") return "";
      if (!edgeIsGroupedContextEvidence(edge)) return "";
      const amount = edgeAggregateAmountLabel(edge) || edgeCanvasAmountOnlyLabel(edge);
      const count = edgeAggregateTransferCount(edge);
      if (count && amount) return count + " tx - " + amount;
      if (amount) return amount;
      if (count) return count + " tx";
      return "";
    }
    function edgeCanvasAmountOrMissingLabel(edge) {
      if (edge?.metadata?.boundaryContextOnly === true) return boundaryOnlyCopy();
      const boundary = edgeBoundarySummaryLabel(edge);
      if (boundary) return boundary;
      const context = typeof edgeContextCanvasLabel === "function" ? edgeContextCanvasLabel(edge) : "";
      if (context) return context;
      const amount = typeof edgeCanvasLabel === "function" ? edgeCanvasLabel(edge) : "";
      if (amount) return amount;
      const type = typeof edgeEvidenceType === "function"
        ? edgeEvidenceType(edge)
        : edge?.metadata?.evidenceType
          ? String(edge.metadata.evidenceType)
          : edge?.type === "service_boundary"
            ? "boundary_context"
            : "";
      if (type === "boundary_context") {
        return typeof boundaryOnlyCopy === "function"
          ? boundaryOnlyCopy()
          : "Investigation boundary only. No money-flow edge is stored for this relationship.";
      }
      if (type === "boundary_context_only") return boundaryOnlyCopy();
      if (type === "boundary_context" || type === "profile_context") {
        return "Context only; no stored transaction evidence.";
      }
      return "amount n/a";
    }
    function edgeBoundarySummaryLabel(edge) {
      const type = typeof edgeEvidenceType === "function"
        ? edgeEvidenceType(edge)
        : edge?.metadata?.evidenceType
          ? String(edge.metadata.evidenceType)
          : edge?.type === "service_boundary"
            ? "boundary_context"
            : "";
      if (type !== "boundary_context" && type !== "grouped_transfers") return "";
      if (edge?.metadata?.boundaryContextOnly === true) return "";
      if (!edgeIsGroupedContextEvidence(edge)) return "";
      const entity = typeof boundaryIdentityName === "function"
        ? boundaryIdentityName(edge)
        : edge?.metadata?.boundaryEntityName || "";
      const count = typeof edgeAggregateTransferCount === "function"
        ? edgeAggregateTransferCount(edge)
        : Number(edge?.metadata?.aggregateTransferCount ?? edge?.metadata?.transferCount ?? edge?.metadata?.txCount);
      const aggregateAmount = typeof edgeAggregateAmountLabel === "function"
        ? edgeAggregateAmountLabel(edge)
        : edge?.metadata?.aggregateAmountFormatted ||
          edge?.metadata?.totalAmountFormatted ||
          edge?.metadata?.boundaryAmountFormatted ||
          formatRawUsdt(edge?.metadata?.aggregateAmountRaw) ||
          formatRawUsdt(edge?.metadata?.totalAmountRaw) ||
          formatRawUsdt(edge?.metadata?.boundaryAmountRaw) ||
          "";
      const amount = aggregateAmount ||
        (typeof edgeAmount === "function"
          ? edgeAmount(edge)
          : edge?.amountFormatted || formatRawUsdt(edge?.amountRaw) || "");
      const parts = [];
      if (entity) parts.push(entity);
      if (Number.isFinite(count) && count > 0) parts.push(count + " tx");
      if (amount) parts.push(amount);
      const hasStoredMoneyEvidence = typeof edgeHasStoredMoneyEvidence === "function"
        ? edgeHasStoredMoneyEvidence(edge)
        : Boolean((Number.isFinite(count) && count > 0) || amount);
      if (parts.length === 1 && entity && !hasStoredMoneyEvidence) return "";
      return parts.length > 0 ? parts.join(" - ") : "";
    }
    function edgeIsGroupedContextEvidence(edge) {
      if (edge?.metadata?.boundaryContextOnly === true) return false;
      if (edge?.metadata?.evidenceType === "grouped_transfers") return true;
      const transfers = typeof asArray === "function"
        ? asArray(edge?.metadata?.underlyingTransfers)
        : Array.isArray(edge?.metadata?.underlyingTransfers)
          ? edge.metadata.underlyingTransfers
          : [];
      if (transfers.length > 1) return true;
      const hashes = typeof edgeTxHashes === "function"
        ? edgeTxHashes(edge)
        : [
            ...(Array.isArray(edge?.metadata?.txHashes) ? edge.metadata.txHashes : []),
            ...(Array.isArray(edge?.metadata?.profileTxHashes) ? edge.metadata.profileTxHashes : []),
            ...(edge?.txHash ? [edge.txHash] : [])
          ].filter((hash) => typeof hash === "string" && hash.length > 0);
      if ([...new Set(hashes)].length > 1) return true;
      const count = typeof edgeAggregateTransferCount === "function"
        ? edgeAggregateTransferCount(edge)
        : Number(edge?.metadata?.aggregateTransferCount ?? edge?.metadata?.transferCount ?? edge?.metadata?.txCount);
      return Boolean(count && count > 1);
    }
    function edgeIsDeepCheckRelationshipProjection(edge) {
      const evidenceType = String(edge?.metadata?.evidenceType || "");
      const source = String(edge?.metadata?.source || "");
      return evidenceType === "deepcheck_relationship_second_hop" ||
        evidenceType === "deepcheck_extended_path" ||
        source === "deepcheck_relationship_second_hop" ||
        source === "deepcheck_extended_path";
    }
    function edgeIsContractContextProjection(edge) {
      const evidenceType = String(edge?.metadata?.evidenceType || "");
      return evidenceType === "contract_trigger_context" ||
        evidenceType === "contract_call_context" ||
        evidenceType === "debit_authority_context" ||
        evidenceType === "approval_drain_contract_call" ||
        evidenceType === "approval_drain_spender_authority";
    }
    function edgeIsCanvasContextProjection(edge) {
      return edgeIsDeepCheckRelationshipProjection(edge) || edgeIsContractContextProjection(edge);
    }
    function edgeHasCanvasAmountLabel(edge) {
      if (edgeIsCanvasContextProjection(edge)) return false;
      return Boolean(edgeCanvasLabel(edge) || edgeBoundarySummaryLabel(edge) || edgeContextCanvasLabel(edge));
    }
    function edgeShouldShowAmount(edge) {
      return edge?.type !== "stop" && edgeDisplayRole(edge) !== "stop";
    }
    function edgeShouldShowCanvasAmount(edge) {
      if (!edgeShouldShowAmount(edge)) return false;
      if (edgeDisplayRole(edge) === "collapsed_group") return false;
      if (edgeDisplayRole(edge) === "bundle_member") return false;
      if (edgeIsCanvasContextProjection(edge)) return false;
      return true;
    }
    function edgeShouldShowImportantCanvasAmount(edge) {
      return edgeShouldShowCanvasAmount(edge) && edgeHasCanvasAmountLabel(edge);
    }
    function edgeShouldShowCanvasTime(edge) {
      if (edge?.type === "stop" || edgeDisplayRole(edge) === "stop") return false;
      if (edgeDisplayRole(edge) === "collapsed_group") return false;
      if (edgeDisplayRole(edge) === "bundle_member") return false;
      if (edgeIsCanvasContextProjection(edge)) return false;
      return true;
    }
    function edgeDetailedAmountLabel(edge) {
      if (edge?.metadata?.boundaryContextOnly === true) return "";
      const used = edgeAllocatedAmount(edge);
      const original = edgeOriginalAmount(edge);
      if (!used && !original) return "";
      if (!edgeHasAllocation(edge)) return original || used;
      return original + " original; " + used + " used";
    }
    function edgeTime(edge) {
      const raw = edge?.timestampFormatted || edge?.timestamp || edge?.timestampIso || edge?.metadata?.timestampFormatted || edge?.metadata?.timestamp || edge?.metadata?.timestampIso || "";
      return canvasTimestampLabel(raw) || raw;
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
    const canvasMonthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    function canvasTimestampLabel(value) {
      if (!value) return "";
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) return "";
      const day = String(date.getUTCDate()).padStart(2, "0");
      const hour = String(date.getUTCHours()).padStart(2, "0");
      const minute = String(date.getUTCMinutes()).padStart(2, "0");
      const includeYear = date.getUTCFullYear() !== new Date().getUTCFullYear();
      return (includeYear ? date.getUTCFullYear() + " " : "") + canvasMonthNames[date.getUTCMonth()] + " " + day + ", " + hour + ":" + minute;
    }
    function edgeGroupedPeriodLabel(edge) {
      if (!edgeIsGroupedContextEvidence(edge)) return "";
      const times = asArray(edge?.metadata?.underlyingTransfers)
        .map((item) => item?.timestamp)
        .filter(Boolean)
        .map((value) => ({ value, time: new Date(value).getTime() }))
        .filter((item) => Number.isFinite(item.time))
        .sort((a, b) => a.time - b.time);
      if (times.length === 0) return "";
      const first = canvasTimestampLabel(times[0].value);
      const last = canvasTimestampLabel(times[times.length - 1].value);
      if (!first || !last) return "";
      return first === last ? first : first + " - " + last;
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
    function edgeCanvasTimeLabel(edge) {
      const groupedPeriod = edgeGroupedPeriodLabel(edge);
      if (groupedPeriod) return groupedPeriod;
      if (edgeIsGroupedContextEvidence(edge)) return "";
      const hold = formatDurationMs(edge?.metadata?.holdMs ?? edge?.metadata?.holdBeforeNextMs);
      if (hold) return "hold " + hold;
      const span = formatDurationMs(edge?.metadata?.timeSpanMs ?? edge?.timeSpanMs);
      if (span) return "span " + span;
      const gap = edgeTxGap(edge);
      if (gap) return "gap " + gap;
      return canvasTimestampLabel(edge?.timestamp || edgeTime(edge));
    }
    function edgeSpeedMs(edge) {
      const ms = Number(edge?.metadata?.txGapMs ?? edge?.metadata?.holdMs ?? edge?.metadata?.holdBeforeNextMs ?? edge?.metadata?.timeSpanMs ?? edge?.timeSpanMs);
      return Number.isFinite(ms) && ms >= 0 ? ms : null;
    }
    function edgeSpeedClass(edge) {
      const ms = edgeSpeedMs(edge);
      if (ms === null) return "";
      if (ms <= 15 * 60000) return "edge-speed-strong";
      if (ms <= 60 * 60000) return "edge-speed-medium";
      if (ms <= 6 * 60 * 60000) return "edge-speed-soft";
      if (ms <= 24 * 60 * 60000) return "edge-speed-faint";
      return "";
    }
    function edgeLabelRoleClass(edge) {
      if (edgeIsGroupedContextEvidence(edge)) return "label-role-grouped";
      const role = edgeVisualRole(edge);
      if (role === "incoming") return "label-role-incoming";
      if (role === "outgoing") return "label-role-outgoing";
      if (role === "service") return "label-role-service";
      if (role === "stop") return "label-role-stop";
      if (role === "peer") return "label-role-peer";
      return "label-role-context";
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
    function edgeMoneyFlowDirection(edge) {
      const value = String(edge?.metadata?.moneyDirection || edge?.moneyDirection || "").toLowerCase();
      if (!value) return "";
      if (value === "inbound_to_subject" || value === "incoming" || value === "inbound" || value === "source_provenance" || value === "funding_source") return "incoming";
      if (value === "outbound_from_subject" || value === "outgoing" || value === "outbound" || value === "forward_flow") return "outgoing";
      if (value === "context" || value === "service") return "self";
      return "";
    }
    function edgeFlowDirection(edge) {
      const metadata = edge?.metadata || {};
      const moneyDirection = edgeMoneyFlowDirection(edge);
      if (moneyDirection) return moneyDirection;
      const groupDirection = collapsedGroupLayoutSide(metadata?.groupKind);
      if (edgeDisplayRole(edge) === "collapsed_group") {
        return groupDirection === "incoming" || groupDirection === "outgoing" ? groupDirection : "self";
      }
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
    function serviceEdgeTone(edge) {
      const endpointKinds = [nodeDisplayKind(nodeById(edge?.fromNodeId)), nodeDisplayKind(nodeById(edge?.toNodeId))];
      if (endpointKinds.includes("cex")) return "cex";
      if (endpointKinds.includes("bridge")) return "bridge";
      if (endpointKinds.includes("dex_contract") || endpointKinds.includes("contract_router")) return "dex";
      if (endpointKinds.includes("smart_contract") || endpointKinds.includes("contract_adapter")) return "contract";
      if (endpointKinds.includes("service_boundary")) return "context";
      return "";
    }
    function edgePassesServiceFilter(edge) {
      if (state.servicesVisible) return true;
      const from = nodeById(edge?.fromNodeId);
      const to = nodeById(edge?.toNodeId);
      return !nodeIsServiceLike(from) && !nodeIsServiceLike(to);
    }
    function graphFullEvidenceModeActive() {
      if (!state.graph) return false;
      return graphDisplayMode(graphNodes(state.graph), graphEdges(state.graph)) === "full_evidence";
    }
    function visibleGraphPathCount(paths, nodeIds, edgeIds) {
      return asArray(paths).filter((path) => {
        const pathNodeIds = asArray(path?.nodeIds);
        const pathEdgeIds = asArray(path?.edgeIds);
        const nodesVisible = pathNodeIds.length === 0 || pathNodeIds.every((nodeId) => nodeIds.has(nodeId));
        const edgesVisible = pathEdgeIds.length === 0 || pathEdgeIds.every((edgeId) => edgeIds.has(edgeId));
        return nodesVisible && edgesVisible;
      }).length;
    }
    function setGraphContextVisible(visible) {
      const context = el("graphStats").closest(".analytics-graph-context");
      if (context) context.hidden = !visible;
    }
    function filteredGraphEdges() {
      return graphEdges(state.graph).filter((edge) =>
        edgePassesFlowFilter(edge) &&
        edgePassesServiceFilter(edge) &&
        edgePassesPeerLinkFilter(edge)
      );
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
        if (state.selected && state.densityMode !== "show_all") reconcileSelectionWithDensityMode();
        return;
      }
      if (state.selected.type === "node") {
        const selectedNodeVisible = visibleGraphNodeIds().has(state.selected.id);
        if (!selectedNodeVisible) state.selected = null;
      }
      if (state.selected && state.densityMode !== "show_all") reconcileSelectionWithDensityMode();
    }
    function reconcileSelectionWithDensityMode() {
      if (!state.selected || !state.graph) return;
      const rawVisibleEdges = filteredGraphEdges();
      const rawConnectedNodeIds = new Set();
      rawVisibleEdges.forEach((edge) => {
        if (edge?.fromNodeId) rawConnectedNodeIds.add(edge.fromNodeId);
        if (edge?.toNodeId) rawConnectedNodeIds.add(edge.toNodeId);
      });
      const rawVisibleNodes = graphNodes(state.graph).filter((node) => node.kind === "subject" || rawConnectedNodeIds.has(node.id));
      const presentation = graphPresentation(rawVisibleNodes, rawVisibleEdges);
      const visibleNodeIds = new Set(presentation.nodes.map((node) => node.id));
      const visibleEdgeIds = new Set(presentation.edges.map((edge) => edge.id));
      if (state.selected.type === "node" && !visibleNodeIds.has(state.selected.id)) {
        state.selected = null;
        return;
      }
      if (state.selected.type === "edge" && !visibleEdgeIds.has(state.selected.id)) state.selected = null;
    }
    function graphSubjectNodeId() {
      return graphNodes(state.graph).find((node) => node.kind === "subject")?.id || "";
    }
    function edgeIsPeerLink(edge) {
      const subjectId = graphSubjectNodeId();
      if (!subjectId || !edge?.fromNodeId || !edge?.toNodeId) return false;
      const from = nodeById(edge.fromNodeId);
      const to = nodeById(edge.toNodeId);
      if (nodeIsServiceLike(from) || nodeIsServiceLike(to)) return false;
      return edge?.fromNodeId !== subjectId && edge?.toNodeId !== subjectId;
    }
    function edgePassesPeerLinkFilter(edge) {
      if (!state.peerLinksVisible && edgeIsPeerLink(edge)) return false;
      return true;
    }
    function edgeIsSelectionRelated(edge) {
      if (!state.selected) return true;
      if (state.selected.type === "edge") return state.selected.id === edge.id;
      if (state.selected.type === "node") return edge.fromNodeId === state.selected.id || edge.toNodeId === state.selected.id;
      return true;
    }
    function edgeVisualRole(edge) {
      const role = edgeDisplayRole(edge);
      const groupRole = collapsedGroupLayoutSide(edge?.metadata?.groupKind);
      if (role === "collapsed_group") return groupRole === "service" ? "service" : groupRole || "context";
      if (role === "stop") return "stop";
      if (role === "profile_context" || role === "inferred_provenance") return "context";
      if (edge?.metadata?.evidenceType === "contract_driven_transfer") return "context";
      if (edgeIsPeerLink(edge)) return "peer";
      const from = nodeById(edge?.fromNodeId);
      const to = nodeById(edge?.toNodeId);
      if (nodeIsServiceLike(from) || nodeIsServiceLike(to)) return "service";
      if (state.graph?.job?.kind === "address_deep_check") return "context";
      const moneyDirection = edgeMoneyFlowDirection(edge);
      if (moneyDirection === "incoming" || moneyDirection === "outgoing") return moneyDirection;
      return edgeFlowDirection(edge);
    }
    function edgeExtraClass(edge, visualRole) {
      const classes = [];
      const evidenceType = edge?.metadata?.evidenceType;
      const relationship = edge?.metadata?.relationship;
      const secondLayerStatus = edge?.metadata?.secondLayerStatus;
      const isGroupedTail = edge?.metadata?.source === "deepcheck_relationship_second_hop" && relationship === "grouped_tail";
      const whereFundingRole = edge?.metadata?.whereFundingRole;
      if (edge?.metadata?.residualUnresolvedBelowMateriality === true) classes.push("edge-residual-caveat");
      if (whereFundingRole === "exact_funding_candidate") classes.push("edge-where-exact-funding");
      if (whereFundingRole === "probable_funding_context") classes.push("edge-where-probable-funding");
      if (whereFundingRole === "unresolved_source_caveat" || whereFundingRole === "pre_existing_balance_caveat") classes.push("edge-where-source-caveat");
      if (whereFundingRole === "service_boundary") classes.push("edge-where-service-boundary");
      if (whereFundingRole === "grouped_candidate_tail") classes.push("edge-where-grouped-candidate");
      if (evidenceType === "contract_trigger_context") classes.push("edge-contract-trigger-context");
      if (evidenceType === "contract_driven_transfer") classes.push("edge-contract-driven-transfer");
      const groupedContext = evidenceType !== "contract_trigger_context" &&
        evidenceType !== "contract_driven_transfer" &&
        !isGroupedTail &&
        edgeIsGroupedContextEvidence(edge);
      if (groupedContext) classes.push("edge-deep-grouped-transfer");
      if (
        visualRole === "service" &&
        evidenceType !== "contract_trigger_context" &&
        evidenceType !== "contract_driven_transfer"
      ) {
        const serviceTone = serviceEdgeTone(edge);
        if (serviceTone) classes.push("edge-service-" + serviceTone);
      }
      if (
        state.graph?.job?.kind === "incoming_deposit_check" &&
        (visualRole === "context" || visualRole === "peer") &&
        evidenceType !== "contract_trigger_context" &&
        evidenceType !== "contract_driven_transfer" &&
        edge?.type === "transfer" &&
        !groupedContext
      ) {
        classes.push("edge-incoming-wallet-transfer");
      }
      if (
        state.graph?.job?.kind === "address_deep_check" &&
        visualRole === "context" &&
        evidenceType !== "contract_trigger_context" &&
        evidenceType !== "contract_driven_transfer"
      ) {
        const role = edgeDisplayRole(edge);
        const source = edge?.metadata?.source;
        const count = edgeAggregateTransferCount(edge);
        if (groupedContext) {
          // Grouped styling is applied across all graph modes above.
        } else if (evidenceType === "deepcheck_relationship_second_hop" && relationship === "direct_subject_edge") {
          classes.push("edge-deep-direct-context");
        } else if (evidenceType === "deepcheck_relationship_second_hop" && relationship === "second_hop_edge") {
          classes.push("edge-deep-second-hop");
        } else if (evidenceType === "deepcheck_relationship_second_hop" && relationship === "cross_wallet_edge") {
          classes.push("edge-deep-cross-wallet");
        } else if (isGroupedTail) {
          classes.push("edge-deep-grouped-tail");
        } else if (source === "deepcheck_extended_path" && edge?.metadata?.relationship === "cross_wallet_edge") {
          classes.push("edge-deep-cross-wallet");
        } else if (source === "deepcheck_extended_path") {
          classes.push("edge-deep-extended-path");
        } else if (source === "directCounterpartyInteractionProfile" && count && count > 1) {
          classes.push("edge-deep-grouped-transfer");
        } else if (source === "directCounterpartyInteractionProfile") {
          classes.push("edge-deep-wallet-transfer");
        } else if (evidenceType === "grouped_transfers") {
          classes.push("edge-deep-grouped-transfer");
        } else if (
          role === "real_transfer" ||
          role === "allocated_transfer"
        ) {
          classes.push("edge-deep-wallet-transfer");
        }
      }
      if (secondLayerStatus === "queued" || secondLayerStatus === "not_indexed" || edge?.metadata?.queued === true) {
        classes.push("edge-second-layer-queued");
      } else if (
        typeof secondLayerStatus === "string" && secondLayerStatus.startsWith("stopped") ||
        Boolean(edge?.metadata?.stopReason || edge?.metadata?.limitationCode)
      ) {
        classes.push("edge-second-layer-stopped");
      }
      if (edge?.metadata?.reciprocalFlow === true) classes.push("edge-reciprocal-flow");
      return classes.length ? " " + classes.join(" ") : "";
    }
    function edgeStrokeWidth(edge) {
      const role = edgeVisualRole(edge);
      const evidenceType = edge?.metadata?.evidenceType;
      if (evidenceType === "contract_trigger_context") return 1.25;
      if (role === "peer") return 1.2;
      if (role === "context") return 1.25;
      if (role === "stop") return 1.45;
      const raw = Number(edge?.amountRaw || edge?.metadata?.amountRaw || edge?.weight || 0);
      if (!Number.isFinite(raw) || raw <= 0) return 1.45;
      const scaled = 1.25 + Math.log10(raw + 10) * 0.14;
      return Math.max(1.45, Math.min(2.8, scaled));
    }
    function edgePairKey(edge) {
      const from = String(edge?.fromNodeId || "");
      const to = String(edge?.toNodeId || "");
      return from <= to ? from + "↔" + to : to + "↔" + from;
    }
    function edgeDirectionSign(edge) {
      const from = String(edge?.fromNodeId || "");
      const to = String(edge?.toNodeId || "");
      return from <= to ? 1 : -1;
    }
    function edgeRouteRank(edge) {
      if (edgeIsGroupedContextEvidence(edge)) return 30;
      const type = edgeEvidenceType(edge);
      if (type === "profile_context" || edgeDisplayRole(edge) === "profile_context") return 20;
      if (type === "boundary_context" || edge?.type === "service_boundary") return 25;
      return 10;
    }
    function buildEdgeRouteIndex(edges) {
      const groups = new Map();
      edges.forEach((edge) => {
        const key = edgePairKey(edge);
        const group = groups.get(key) || [];
        group.push(edge);
        groups.set(key, group);
      });
      const routes = new Map();
      groups.forEach((group) => {
        const byDirection = new Map();
        group.forEach((edge) => {
          const sign = edgeDirectionSign(edge);
          const bucket = byDirection.get(sign) || [];
          bucket.push(edge);
          byDirection.set(sign, bucket);
        });
        byDirection.forEach((bucket, sign) => {
          const sorted = [...bucket].sort((left, right) =>
            edgeRouteRank(left) - edgeRouteRank(right) ||
            String(left.id || "").localeCompare(String(right.id || ""))
          );
          const offsetStep = sorted.length > 2 ? 0.12 : 0.16;
          sorted.forEach((edge, sameDirectionIndex) => {
            routes.set(edge.id, {
              pairCount: group.length,
              directionSign: sign,
              sameDirectionIndex,
              sameDirectionCount: sorted.length,
              routeRank: edgeRouteRank(edge),
              parallelOffset: (sameDirectionIndex - (sorted.length - 1) / 2) * offsetStep
            });
          });
        });
      });
      return routes;
    }
    function edgeRouteFor(edge, edgeRouteIndex) {
      return edgeRouteIndex.get(edge?.id) || {
        pairCount: 1,
        directionSign: edgeDirectionSign(edge),
        sameDirectionIndex: 0,
        sameDirectionCount: 1,
        parallelOffset: 0
      };
    }
    function edgeCurveControlPoint(startX, startY, endX, endY, edge, route = null) {
      const dx = endX - startX;
      const dy = endY - startY;
      const role = edgeVisualRole(edge);
      const baseCurve = edgeFlowDirection(edge) === "incoming" ? -0.18 : 0.18;
      const coordinateSign = startX < endX || (startX === endX && startY <= endY) ? 1 : -1;
      const routeCurve = route && route.pairCount > 1
        ? route.directionSign * coordinateSign * 0.28 + route.parallelOffset
        : baseCurve;
      const curve = (role === "peer" || role === "stop" ? routeCurve * 1.3 : routeCurve);
      return {
        x: (startX + endX) / 2 - dy * curve,
        y: (startY + endY) / 2 + dx * curve
      };
    }
    function edgeCurvePath(startX, startY, endX, endY, edge, route = null) {
      const dx = endX - startX;
      const dy = endY - startY;
      const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      if (distance < 80) return "M " + startX + " " + startY + " L " + endX + " " + endY;
      const control = edgeCurveControlPoint(startX, startY, endX, endY, edge, route);
      return "M " + startX + " " + startY + " Q " + control.x + " " + control.y + " " + endX + " " + endY;
    }
    function nodeVisualClass(node) {
      return "node-display-" + nodeDisplayKind(node) + (node?.metadata?.residualUnresolvedBelowMateriality === true ? " node-residual-caveat" : "");
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
      const evidenceType = edgeEvidenceType(edge);
      const whereFundingRole = edge?.metadata?.whereFundingRole || evidenceType;
      if (whereFundingRole === "exact_funding_candidate") return "Saved source-provenance transfer that funds the selected route hop";
      if (whereFundingRole === "probable_funding_context") return "Amount/time funding candidate from incomplete coverage; context only";
      if (whereFundingRole === "pre_existing_balance_caveat" || whereFundingRole === "unresolved_source_caveat") return "Where could not prove a funding transfer for this hop";
      if (whereFundingRole === "service_boundary") return "Funding provenance reached a service boundary";
      if (whereFundingRole === "grouped_candidate_tail") return "Additional lower-ranked funding candidates grouped for readability";
      if (evidenceType === "contract_driven_transfer") return "Smart-contract-driven USDT movement";
      if (evidenceType === "contract_trigger_context") return "Contract trigger context";
      if (evidenceType === "contract_call_context") return "Contract call context";
      if (evidenceType === "debit_authority_context") return "Spender authority context";
      if (evidenceType === "approval_drain_transfer") return "Smart-contract-driven USDT movement";
      if (evidenceType === "approval_drain_contract_call") return "Operator called drainer/spender contract";
      if (evidenceType === "approval_drain_spender_authority") return "Approval-drain authority context";
      if (evidenceType === "boundary_context_only") return "Investigation stop";
      if (role === "profile_context") return "Behavioral/service exposure context";
      if (role === "allocated_transfer") return "Money-origin provenance step with partial coverage allocation";
      if (role === "inferred_provenance") return "Inferred provenance step";
      if (role === "stop") return "Trace stop";
      return "Money-origin provenance step";
    }
    function edgeIsGroupedBoundaryEvidence(edge) {
      if (edgeEvidenceType(edge) !== "grouped_transfers") return false;
      const cluster = edge?.metadata?.deepCheckWalletCluster?.edgeType;
      return cluster === "grouped_real_transfers" ||
        edge?.type === "service_boundary" ||
        edge?.metadata?.evidenceClass === "service_boundary_context" ||
        edge?.metadata?.skippedReason === "service_boundary_context";
    }
    function edgeEvidenceTypeLabel(edge) {
      const type = edgeEvidenceType(edge);
      const whereFundingRole = edge?.metadata?.whereFundingRole || type;
      if (whereFundingRole === "exact_funding_candidate") return "Exact funding candidate";
      if (whereFundingRole === "probable_funding_context") return "Probable funding context";
      if (whereFundingRole === "pre_existing_balance_caveat") return "Pre-existing balance caveat";
      if (whereFundingRole === "unresolved_source_caveat") return "Unresolved source caveat";
      if (whereFundingRole === "service_boundary") return "Service boundary";
      if (whereFundingRole === "grouped_candidate_tail") return "Grouped funding candidates";
      if (type === "direct_transfer") return "Direct transfer";
      if (type === "contract_driven_transfer") return "Contract-driven USDT transfer";
      if (type === "contract_trigger_context") return "Contract trigger context";
      if (type === "contract_call_context") return "Contract call context";
      if (type === "debit_authority_context") return "Spender authority context";
      if (type === "grouped_transfers") return typeof edgeIsGroupedBoundaryEvidence === "function" && edgeIsGroupedBoundaryEvidence(edge) ? "Grouped boundary evidence" : "Grouped transfers";
      if (type === "approval_drain_transfer") return "Contract-driven USDT transfer";
      if (type === "approval_drain_contract_call") return "Contract call context";
      if (type === "approval_drain_spender_authority") return "Spender authority context";
      if (type === "boundary_context_only") return "Investigation stop";
      if (edge?.metadata?.evidenceTypeLabel) return String(edge.metadata.evidenceTypeLabel);
      if (type === "boundary_context") return "Boundary context";
      if (type === "deepcheck_extended_path") return "DeepCheck extended path";
      if (type === "profile_context") return "Profile context";
      if (type === "trace_stop") return "Trace stop";
      return "Unknown evidence";
    }
    function graphHasWalletClusterContext() {
      return typeof state !== "undefined" &&
        typeof graphKindUsesWalletClusters === "function" &&
        graphKindUsesWalletClusters(state.graph?.job?.kind);
    }
    function walletClusterNodeHasContext(node) {
      return Boolean(node?.metadata?.walletClusterRole ||
        node?.metadata?.deepCheckWalletCluster ||
        node?.metadata?.walletClusterSummary === true ||
        graphHasWalletClusterContext());
    }
    function walletClusterEdgeHasContext(edge) {
      return Boolean(edge?.metadata?.deepCheckWalletCluster ||
        edge?.metadata?.walletClusterSummary === true ||
        graphHasWalletClusterContext());
    }
    function walletClusterNodeRoleLabel(node) {
      if (!walletClusterNodeHasContext(node)) return "";
      const fallbackRole = node?.kind === "subject"
        ? "subject"
        : node?.kind === "group" || node?.kind === "bundle"
          ? "group"
          : "";
      const role = String(node?.metadata?.walletClusterRole || node?.metadata?.deepCheckWalletCluster?.nodeType || fallbackRole);
      if (role === "subject" || role === "subject_wallet") return "Checked wallet";
      if (role === "source") return "Source wallet";
      if (role === "intermediate" || role === "ordinary_wallet") return "Intermediate wallet";
      if (role === "outgoing") return "Outgoing wallet";
      if (role === "contract") return "Smart-contract lane";
      if (role === "boundary") return "Service/boundary";
      if (role === "stop" || role === "history_stop") return "Investigation stop";
      if (role === "group" || role === "funding_cluster") return "Wallet group";
      return "";
    }
    function walletClusterEdgeLabel(edge) {
      const edgeType = String(edge?.metadata?.deepCheckWalletCluster?.edgeType || "");
      const evidenceType = String(edge?.metadata?.evidenceType || "");
      if (evidenceType === "contract_driven_transfer") return "Contract-driven transfer";
      if (evidenceType === "contract_trigger_context") return "Contract trigger context";
      if (evidenceType === "approval_drain_transfer") return "Contract-driven transfer";
      if (evidenceType === "approval_drain_contract_call" || evidenceType === "approval_drain_spender_authority") return "Drainer contract context";
      if (evidenceType === "boundary_context_only") return "Investigation stop";
      if (evidenceType === "deepcheck_extended_path") return edge?.metadata?.relationship === "cross_wallet_edge" ? "Extended cross-wallet path" : "Extended path";
      if (edgeType === "proven_transaction") return "Proven transaction";
      if (edgeType === "grouped_real_transfers" || edgeType === "grouped_transfers") return typeof edgeIsGroupedBoundaryEvidence === "function" && edgeIsGroupedBoundaryEvidence(edge) ? "Grouped boundary evidence" : "Grouped/collapsed transfers";
      if (edgeType === "profile_context") return "Peer/context";
      if (edgeType === "context_boundary") return "Service/boundary context";
      if (edgeType === "history_stop") return "History stop";
      if (!walletClusterEdgeHasContext(edge)) return "";
      if (edge?.metadata?.walletClusterSummary === true || edge?.displayRole === "collapsed_group" || edge?.type === "collapsed_group") return "Grouped/collapsed transfers";
      if (edge?.displayRole === "profile_context" || edge?.metadata?.evidenceType === "profile_context" || (typeof edgeIsPeerLink === "function" && edgeIsPeerLink(edge))) return "Peer/context";
      if (edge?.type === "service_boundary" || edge?.metadata?.evidenceType === "boundary_context") return "Service/boundary context";
      if (edge?.type === "stop" || edge?.displayRole === "stop" || edge?.metadata?.evidenceType === "trace_stop") return "History stop";
      if (edge?.metadata?.evidenceType === "grouped_transfers") return "Grouped/collapsed transfers";
      if (edge?.metadata?.evidenceType === "direct_transfer" || edge?.type === "transfer" || edge?.txHash) return "Proven transaction";
      return "";
    }
    function walletClusterRelationshipLabel(edge) {
      const relationship = String(edge?.metadata?.deepCheckWalletCluster?.relationship || "");
      const evidenceType = String(edge?.metadata?.evidenceType || "");
      if (evidenceType === "contract_driven_transfer") return "Smart contract -> receiver transfer";
      if (evidenceType === "contract_trigger_context") return "Source wallet -> spender contract";
      if (evidenceType === "approval_drain_transfer") return "Victim -> receiver via smart contract";
      if (evidenceType === "approval_drain_contract_call") return "Operator -> drainer contract";
      if (evidenceType === "approval_drain_spender_authority") return "Victim -> spender contract authority";
      if (evidenceType === "boundary_context_only") return "Investigation stop";
      if (evidenceType === "deepcheck_extended_path") return edge?.metadata?.relationship === "cross_wallet_edge" ? "Wallet-to-wallet extended path" : "Subject extended path";
      if (relationship === "wallet_to_wallet") return "Wallet-to-wallet";
      if (relationship === "subject_neighborhood") return "Subject neighborhood";
      if (typeof edgeIsGroupedBoundaryEvidence === "function" && edgeIsGroupedBoundaryEvidence(edge)) return "Grouped service/boundary transfer evidence";
      if (relationship === "shared_service_or_boundary") return "Shared service/boundary context - not proof of common ownership";
      if (relationship === "investigation_stop") return "Investigation stop";
      if (!walletClusterEdgeHasContext(edge)) return "";
      if (edge?.metadata?.walletClusterSummary === true || edge?.displayRole === "collapsed_group" || edge?.type === "collapsed_group") return "Collapsed wallet group";
      if (edge?.type === "service_boundary" || edge?.metadata?.evidenceType === "boundary_context") return "Shared service/boundary context - not proof of common ownership";
      if (edge?.type === "stop" || edge?.displayRole === "stop" || edge?.metadata?.evidenceType === "trace_stop") return "Investigation stop";
      if (edge?.displayRole === "profile_context" || edge?.metadata?.evidenceType === "profile_context" || (typeof edgeIsPeerLink === "function" && edgeIsPeerLink(edge))) return "Peer/context";
      if (edge?.type === "transfer" || edge?.txHash) return "Wallet-to-wallet";
      return "";
    }
    function walletClusterNodeContextNote(node) {
      if (node?.metadata?.walletClusterRole === "contract") {
        return "This smart contract is shown as graph context for contract-driven movement; it is not a wallet or proof of common ownership.";
      }
      if (node?.kind === "group" || node?.kind === "bundle" || nodeDisplayKind(node) === "collapsed_group" || nodeDisplayKind(node) === "funding_bundle") {
        return "This group summarizes DeepCheck graph context; it is not a wallet or a standalone completed wallet check.";
      }
      return "This wallet was observed in the DeepCheck graph. A role here explains graph context; it is not a standalone completed wallet check unless the right rail says so.";
    }
    function edgeEvidenceMeaning(edge) {
      if (edge?.metadata?.evidenceMeaning) return String(edge.metadata.evidenceMeaning);
      const type = edgeEvidenceType(edge);
      if (type === "direct_transfer") return "A real on-chain transfer exists between these endpoints.";
      if (type === "grouped_transfers") return typeof edgeIsGroupedBoundaryEvidence === "function" && edgeIsGroupedBoundaryEvidence(edge)
        ? "DeepCheck stored grouped transfer evidence for this service or boundary relationship."
        : "Multiple real transfers are grouped into this visible connection.";
      if (type === "contract_driven_transfer") return "USDT moved into the receiver through a smart-contract call. The source wallet is shown in the transaction evidence, not as a direct wallet-transfer line.";
      if (type === "contract_trigger_context") return "This source wallet was debited through the spender contract. The receiver-side inflow is grouped on the contract-to-wallet edge.";
      if (type === "contract_call_context") return "This line explains which caller invoked the contract for the transfer. It is not a token transfer.";
      if (type === "debit_authority_context") return "This line explains spender authority context. It is not a normal money transfer.";
      if (type === "approval_drain_transfer") return "A real USDT Transfer event exists, but it was produced by a smart-contract call rather than a normal wallet transfer.";
      if (type === "approval_drain_contract_call") return "This line explains which operator called the spender contract for the drain transaction. It is not a token transfer.";
      if (type === "approval_drain_spender_authority") return "This line explains spender/approval authority context between the drainer contract and the victim. It is not a token transfer.";
      if (type === "boundary_context_only") return "Investigation stop, not a stored money transfer";
      if (type === "boundary_context") return "DeepCheck reached service, exchange, bridge, DEX, or contract infrastructure while expanding wallet context. This is context, not proof of common ownership.";
      if (type === "deepcheck_extended_path") return "This edge is projected from a path already saved by DeepCheck. It shows stored consecutive addresses only, not a new backend check.";
      if (type === "profile_context") return "This relationship comes from a summarized behavior or exposure profile, not one direct transfer.";
      if (type === "trace_stop") return "The investigation stopped here because the next step could not be proven with available data.";
      return "Evidence details are not classified for this edge.";
    }
    function edgeUnderlyingTransferLines(edge) {
      return asArray(edge?.metadata?.underlyingTransfers).slice(0, 20).map((item) => {
        const amount = formatRawUsdt(item?.amountRaw) || item?.amountRaw || "amount not stored";
        const time = canvasTimestampLabel(item?.timestamp) || item?.timestamp || "time not stored";
        const tx = item?.txHash ? " / tx " + short(item.txHash, 10) : "";
        const role = item?.role ? " / " + item.role : "";
        return amount + " / " + time + tx + role;
      });
    }
    function edgeMergedBoundaryContextLines(edge) {
      return asArray(edge?.metadata?.mergedBoundaryContexts).slice(0, 10).map((item) => {
        const entity = item?.boundaryEntityName || item?.identity || item?.boundaryAddress || "Boundary context";
        const type = item?.boundaryCategoryLabel || item?.category || "service";
        const amount = formatRawUsdt(item?.aggregateAmountRaw) || item?.aggregateAmountRaw || "amount not stored";
        const subjectTx = item?.subjectTxHash ? " / subject tx " + short(item.subjectTxHash, 10) : "";
        const boundaryTx = item?.boundaryTxHash ? " / boundary tx " + short(item.boundaryTxHash, 10) : "";
        return entity + " / " + type + " / " + amount + subjectTx + boundaryTx;
      });
    }
    function edgeDirectness(edge) {
      const role = edgeDisplayRole(edge);
      return role === "profile_context" || role === "inferred_provenance" || role === "collapsed_group" || role === "bundle_member" ? "inferred" : "direct";
    }
    function edgeDirectionMeaning(edge) {
      const role = edgeDisplayRole(edge);
      const metadataDirection = edge?.metadata?.direction;
      const evidenceType = edgeEvidenceType(edge);
      if (evidenceType === "contract_driven_transfer") return "spender contract -> receiver";
      if (evidenceType === "contract_trigger_context") return "source -> spender contract";
      if (evidenceType === "contract_call_context") return "caller -> contract";
      if (evidenceType === "debit_authority_context") return "spender contract -> source";
      if (evidenceType === "approval_drain_transfer") return "victim -> receiver";
      if (evidenceType === "approval_drain_contract_call") return "operator -> spender contract";
      if (evidenceType === "approval_drain_spender_authority") return "victim -> spender contract";
      if (role === "profile_context" && metadataDirection === "outbound") return "subject -> counterparty";
      if (role === "profile_context" && metadataDirection === "inbound") return "counterparty -> subject";
      return metadataDirection || edge?.direction || "n/a";
    }
    function bundleMemberCount(node) {
      const value = Number(node?.metadata?.memberCount ?? node?.metadata?.funderCount ?? asArray(node?.metadata?.topFunders).length);
      return Number.isFinite(value) && value > 0 ? value : 0;
    }
    function bundleCanvasLabel(node) {
      const memberCount = bundleMemberCount(node);
      if (memberCount > 0) return "Group: " + memberCount + " wallets";
      return "Group";
    }
    function bundleSubLabel(node) {
      const amount = formatRawUsdt(node?.metadata?.coveredAmountRaw || node?.metadata?.bundleAmountRaw || node?.metadata?.targetAmountRaw);
      const txCount = Number(node?.metadata?.txCount ?? asArray(node?.metadata?.txHashes).length);
      return [amount, Number.isFinite(txCount) && txCount > 0 ? txCount + " tx" : ""].filter(Boolean).join(" / ");
    }
    function canvasNodeLabel(node) {
      if (!node) return "";
      const kind = nodeDisplayKind(node);
      if (kind === "subject_wallet") return short(node.address || node.label || node.id, 6);
      const boundaryName = boundaryIdentityName(node);
      if (boundaryName && nodeDisplayKindIsServiceLike(kind)) {
        return String(boundaryIdentityConfidenceLabel(node)).toLowerCase() === "low" ? boundaryName + "?" : boundaryName;
      }
      if (kind === "bridge") return "Bridge";
      if (kind === "cex") return "CEX";
      if (kind === "contract_adapter") return "Adapter";
      if (kind === "contract_router") return "Router";
      if (kind === "dex_contract") return "DEX";
      if (kind === "smart_contract") return "Contract";
      if (kind === "service_boundary") return "Service";
      if (kind === "funding_bundle") return bundleCanvasLabel(node);
      if (kind === "trace_stop") return node?.metadata?.stopCanvasLabel || stopBadgeLabel(node.metadata?.reason || node.label);
      if (kind === "collapsed_group") return node.label || "Group";
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
    function nodeLabelBox(node, placed) {
      const label = canvasNodeLabel(node);
      const width = Math.max(46, Math.min(150, String(label).length * 6.2));
      const labelAttrs = nodeLabelAttrs(node, placed);
      const x = node.x + Number(labelAttrs.x || 0);
      const y = node.y + Number(labelAttrs.y || 0) - 12;
      return { left: x - width / 2, right: x + width / 2, top: y, bottom: y + 18 };
    }
    function nodeHasSemanticLabel(node) {
      const kind = nodeDisplayKind(node);
      return nodeIsServiceLike(node) || kind === "funding_bundle" || kind === "collapsed_group" || kind === "trace_stop";
    }
    function nodeHasSmartLabel(node) {
      return node.kind === "subject" || nodeHasSemanticLabel(node);
    }
    function nodeCanvasLabelVisible(node, importantIds, displayMode) {
      if (state.walletLabelMode === "all") return true;
      if (state.walletLabelMode === "off") return nodeHasSemanticLabel(node);
      if (state.walletLabelMode === "important") {
        return nodeHasSmartLabel(node) || importantIds.has(node.id) || state.selected?.id === node.id;
      }
      if (displayMode !== "deep_branch_map" && displayMode !== "wallet_clusters") return true;
      return nodeHasSmartLabel(node) || importantIds.has(node.id) || state.selected?.id === node.id;
    }
    function visibleNodeLabelIds(nodes, edges, placed = { nodes, byId: new Map(nodes.map((node) => [node.id, node])) }) {
      const displayMode = graphDisplayMode(nodes, edges);
      const importantIds = new Set(rankNodesByImportance(nodes, edges).slice(0, 28).map((node) => node.id));
      const nodeById = new Map(nodes.map((node) => [node.id, node]));
      const connectedImportantIds = new Set();
      edges.forEach((edge) => {
        const fromImportant = importantIds.has(edge?.fromNodeId);
        const toImportant = importantIds.has(edge?.toNodeId);
        const fromNode = nodeById.get(edge?.fromNodeId);
        const toNode = nodeById.get(edge?.toNodeId);
        if (fromImportant && fromNode?.kind !== "subject" && edge?.toNodeId) connectedImportantIds.add(edge.toNodeId);
        if (toImportant && toNode?.kind !== "subject" && edge?.fromNodeId) connectedImportantIds.add(edge.fromNodeId);
      });
      connectedImportantIds.forEach((id) => importantIds.add(id));
      const labels = [];
      const visible = new Set();
      nodes.forEach((node) => {
        if (!nodeCanvasLabelVisible(node, importantIds, displayMode)) return;
        const box = nodeLabelBox(node, placed);
        const protectedLabel = nodeHasSmartLabel(node) || importantIds.has(node.id) || state.selected?.id === node.id;
        const collides = labels.some((item) => boxesOverlap(box, item, 6));
        if (!collides || protectedLabel || state.walletLabelMode === "all") {
          labels.push(box);
          visible.add(node.id);
        }
      });
      return visible;
    }
    function applyTransform() {
      const viewport = document.getElementById("graphViewport");
      if (viewport) viewport.setAttribute("transform", "translate(" + state.transform.x + " " + state.transform.y + ") scale(" + state.transform.scale + ")");
    }
    function setGraphInteracting(active) {
      document.body.classList.toggle("graph-interacting", !!active);
    }
    function edgeLabelPoint(startX, startY, endX, endY, edge, route = null) {
      const dx = endX - startX;
      const dy = endY - startY;
      const length = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const useCurve = length >= 80;
      const control = useCurve ? edgeCurveControlPoint(startX, startY, endX, endY, edge, route) : null;
      const t = edgeVisualRole(edge) === "stop" ? 0.58 : 0.52;
      const pointX = control ? (1 - t) * (1 - t) * startX + 2 * (1 - t) * t * control.x + t * t * endX : (startX + endX) / 2;
      const pointY = control ? (1 - t) * (1 - t) * startY + 2 * (1 - t) * t * control.y + t * t * endY : (startY + endY) / 2;
      const tangentX = control ? 2 * (1 - t) * (control.x - startX) + 2 * t * (endX - control.x) : dx;
      const tangentY = control ? 2 * (1 - t) * (control.y - startY) + 2 * t * (endY - control.y) : dy;
      const tangentLength = Math.max(1, Math.sqrt(tangentX * tangentX + tangentY * tangentY));
      const labelNormalOffset = Math.max(16, Math.min(24, length * 0.045));
      const role = edgeVisualRole(edge);
      const side = role === "stop" || role === "peer" ? -1 : 1;
      return {
        x: pointX - (tangentY / tangentLength) * labelNormalOffset * side,
        y: pointY + (tangentX / tangentLength) * labelNormalOffset * side
      };
    }
    function labelBox(item) {
      const metrics = item.metrics;
      return {
        left: item.labelPoint.x - metrics.width / 2,
        right: item.labelPoint.x + metrics.width / 2,
        top: item.labelPoint.y - metrics.yOffset,
        bottom: item.labelPoint.y - metrics.yOffset + metrics.height
      };
    }
    function boxesOverlap(a, b, padding = 6) {
      return a.left < b.right + padding &&
        a.right > b.left - padding &&
        a.top < b.bottom + padding &&
        a.bottom > b.top - padding;
    }
    function labelIntersectsNode(item, node) {
      const radius = nodeRadius(node) + 14;
      const nodeBox = {
        left: node.x - radius,
        right: node.x + radius,
        top: node.y - radius,
        bottom: node.y + radius
      };
      return boxesOverlap(labelBox(item), nodeBox, 4);
    }
    function avoidEdgeLabelCollisions(items, nodes) {
      const placedBoxes = [];
      const shifts = [0, -28, 28, -52, 52, -78, 78, -106, 106, -138, 138];
      return items.map((item) => {
        for (const shift of shifts) {
          const candidate = { ...item, labelPoint: { x: item.labelPoint.x, y: item.labelPoint.y + shift } };
          const box = labelBox(candidate);
          const hitsNode = nodes.some((node) => labelIntersectsNode(candidate, node));
          const hitsLabel = placedBoxes.some((placed) => boxesOverlap(box, placed, 8));
          if (!hitsNode && !hitsLabel) {
            placedBoxes.push(box);
            return candidate;
          }
        }
        placedBoxes.push(labelBox(item));
        return item;
      });
    }
    function edgeMarkerId(edge, visualRole) {
      if (edgeIsGroupedContextEvidence(edge)) return "edgeArrowGrouped";
      if (visualRole === "incoming") return "edgeArrowIncoming";
      if (visualRole === "outgoing") return "edgeArrowOutgoing";
      if (visualRole === "service") return "edgeArrowService";
      if (visualRole === "stop") return "edgeArrowStop";
      if (visualRole === "peer") return "edgeArrowPeer";
      return "edgeArrowContext";
    }
    function edgeMarkerDefs() {
      const marker = (id, color, opacity = ".96") =>
        '<marker id="' + id + '" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="userSpaceOnUse">' +
        '<path fill="' + color + '" opacity="' + opacity + '" d="M 0 0 L 7 3.5 L 0 7 z"></path>' +
        '</marker>';
      return '<defs>' +
        marker("edgeArrowIncoming", "#8fe9af") +
        marker("edgeArrowOutgoing", "#ff9ba4") +
        marker("edgeArrowService", "#ffd36b") +
        marker("edgeArrowStop", "#f6c177") +
        marker("edgeArrowPeer", "#c3ced9", ".72") +
        marker("edgeArrowGrouped", "#d8c7ff", ".86") +
        marker("edgeArrowContext", "#aab5c2", ".55") +
        '</defs>';
    }
    function graphLegendHtml(mode) {
      const item = (cls, label) => '<span class="legend-chip"><span class="legend-swatch ' + cls + '"></span>' + label + '</span>';
      if (state.graph?.job?.kind === "where_is_money_check") {
        return '<div class="graph-legend-card" data-graph-legend="where_funding_candidates">' +
          item("where-route", "Selected route") +
          item("where-exact", "Exact funding") +
          item("where-probable", "Probable funding context") +
          item("where-caveat", "Unresolved / pre-existing caveat") +
          item("where-service", "Service boundary") +
          item("where-grouped", "Grouped candidates") +
          '</div>';
      }
      if (mode === "wallet_clusters") {
        return '<div class="graph-legend-card" data-graph-legend="wallet_clusters">' +
          item("direct", "Real money flow") +
          item("group", "Grouped transfers") +
          item("inferred", "Context / peer") +
          item("service", "Service / CEX") +
          item("boundary", "Boundary stop") +
          item("contract", "Contract context") +
          '</div>';
      }
      if (mode !== "deep_branch_map") return "";
      return '<div class="graph-legend-card" data-graph-legend="deep_branch_map">' +
        item("direct-context", "Direct subject context") +
        item("second-hop", "Second-hop edge") +
        item("extended", "Extended path edge") +
        item("cross", "Cross-wallet edge") +
        item("grouped-tail", "Grouped tail") +
        item("queued", "Queued / not indexed") +
        item("boundary", "Service / stopped edge") +
        item("contract", "Contract context") +
        '</div>';
    }
    function edgeSemanticAttrs(edge, visualRole) {
      return ' data-edge-role="' + escapeHtml(visualRole) + '" data-edge-display-role="' + escapeHtml(edgeDisplayRole(edge)) + '" data-edge-directness="' + escapeHtml(edgeDirectness(edge)) + '"';
    }
    function nodeSemanticAttrs(node) {
      return ' data-node-display-kind="' + escapeHtml(nodeDisplayKind(node)) + '" data-deep-branch-anchor-id="' + escapeHtml(node?.metadata?.deepBranchAnchorId || "") + '"';
    }
    function nodeIntelligence(node) {
      const value = node?.metadata?.nodeIntelligence;
      return value && typeof value === "object" ? value : null;
    }
    function nodeRole(node) {
      const role = String(nodeIntelligence(node)?.role || "");
      return ["drainer", "victim", "mule_transit", "collector"].includes(role) ? role : "";
    }
    function nodeRoleTitle(node, role) {
      const intelligence = nodeIntelligence(node);
      return intelligence?.label || role.replace(/_/g, " ");
    }
    const nodeRoleIconHrefs = {
      drainer: "/admin/assets/node-role/drainer.png",
      victim: "/admin/assets/node-role/victim.png",
      mule_transit: "/admin/assets/node-role/mule-transit.png",
      collector: "/admin/assets/node-role/collector.png"
    };
    function nodeRoleIconHref(role) {
      return nodeRoleIconHrefs[role] || "";
    }
    function nodeRoleImage(role, size) {
      const half = size / 2;
      return '<image class="role-icon" href="' + nodeRoleIconHref(role) + '" x="-' + half + '" y="-' + half + '" width="' + size + '" height="' + size + '" preserveAspectRatio="xMidYMid meet"></image>';
    }
    function nodeRoleChip(role, radius, title, iconRatio) {
      const outerRingRadius = Math.max(10, radius - 2.2);
      const innerRingRadius = Math.max(8, radius - 4.4);
      const chipRadius = Math.max(7, radius - 6.4);
      const iconSize = Math.max(14, chipRadius * 2 * iconRatio);
      return '<g class="node-role-mark node-role-' + escapeHtml(role) + '">' + title +
        '<circle class="role-ring role-ring-outer" r="' + outerRingRadius + '"></circle>' +
        '<circle class="role-ring role-ring-inner" r="' + innerRingRadius + '"></circle>' +
        '<circle class="role-chip" r="' + chipRadius + '"></circle>' +
        nodeRoleImage(role, iconSize) +
        '</g>';
    }
    function nodeRoleMarkSvg(node, radius) {
      if (!state.roleMarksVisible) return "";
      const role = nodeRole(node);
      if (!role) return "";
      const title = '<title>' + escapeHtml(nodeRoleTitle(node, role)) + '</title>';
      if (role === "victim") {
        const size = Math.max(20, radius * 2.45);
        return '<g class="node-role-mark node-role-victim">' + title +
          nodeRoleImage(role, size) +
          '</g>';
      }
      if (role === "drainer") {
        return nodeRoleChip(role, radius, title, .92);
      }
      if (role === "mule_transit") {
        return nodeRoleChip(role, radius, title, .82);
      }
      if (role === "collector") {
        return nodeRoleChip(role, radius, title, .9);
      }
      return "";
    }
    function renderGraph() {
      const svg = el("graph");
      if (!state.graph) {
        state.renderedNodePositions = new Map();
        state.renderedNodesById = new Map();
        state.renderedEdgesById = new Map();
        svg.innerHTML = "";
        el("graphStats").innerHTML = "";
        el("graphLegend").innerHTML = "";
        setGraphContextVisible(false);
        return;
      }
      setGraphContextVisible(true);
      const graph = state.graph;
      const rawVisibleEdges = filteredGraphEdges();
      const rawConnectedNodeIds = new Set();
      rawVisibleEdges.forEach((edge) => {
        if (edge?.fromNodeId) rawConnectedNodeIds.add(edge.fromNodeId);
        if (edge?.toNodeId) rawConnectedNodeIds.add(edge.toNodeId);
      });
      const rawVisibleNodes = graphNodes(graph).filter((node) => node.kind === "subject" || rawConnectedNodeIds.has(node.id));
      const presentation = graphPresentation(rawVisibleNodes, rawVisibleEdges);
      const visibleEdges = presentation.edges;
      const visibleNodes = presentation.nodes;
      const placed = applyNodePositionOverrides(graphFirstLayout(visibleNodes, visibleEdges, presentation.mode, presentation.dense));
      const timelineFocusEdgeIds = new Set();
      const timelineFocusNodeIds = new Set();
      if (state.timelineRange) {
        visibleEdges.forEach((edge) => {
          if (!edgeIsTimelineFocused(edge)) return;
          timelineFocusEdgeIds.add(edge.id);
          if (edge?.fromNodeId) timelineFocusNodeIds.add(edge.fromNodeId);
          if (edge?.toNodeId) timelineFocusNodeIds.add(edge.toNodeId);
        });
        const subject = visibleNodes.find((node) => node.kind === "subject");
        if (subject?.id) timelineFocusNodeIds.add(subject.id);
      }
      state.renderedNodePositions = new Map(placed.nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
      state.renderedNodesById = new Map(placed.nodes.map((node) => [node.id, node]));
      state.renderedEdgesById = new Map(visibleEdges.map((edge) => [edge.id, edge]));
      svg.setAttribute("viewBox", "0 0 " + placed.width + " " + placed.height);
      svg.classList.toggle("node-label-hidden", !state.labels);
      const grid = Array.from({ length: 15 }, (_, index) => '<path class="grid-line" d="M ' + (index * 100) + ' 0 L ' + (index * 100) + ' 1400 M 0 ' + (index * 100) + ' L 1800 ' + (index * 100) + '"></path>').join("");
      const edgeRouteIndex = buildEdgeRouteIndex(visibleEdges);
      const txLabelMode = effectiveTxLabelMode();
      const edgeRenderItems = visibleEdges.map((edge) => {
        const from = placed.byId.get(edge.fromNodeId);
        const to = placed.byId.get(edge.toNodeId);
        if (!from || !to) return null;
        const route = edgeRouteFor(edge, edgeRouteIndex);
        const selected = state.selected?.type === "edge" && state.selected.id === edge.id;
        const relatedToSelection = edgeIsSelectionRelated(edge);
        const visible = matchesSearch(edge) && (!state.selected || selected || relatedToSelection);
        const visualRole = edgeVisualRole(edge);
        const speedClass = edgeSpeedClass(edge);
        const timelineClass = state.timelineRange ? (timelineFocusEdgeIds.has(edge.id) ? " timeline-focus" : " timeline-context") : "";
        const cls = "edge edge-flow-" + escapeHtml(visualRole) + edgeExtraClass(edge, visualRole) + " " + escapeHtml(edge.verdict) + (speedClass ? " " + speedClass : "") + (selected ? " selected" : "") + timelineClass + (visible ? "" : " dim");
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const length = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const fromOffset = nodeRadius(from) + 3;
        const toOffset = nodeRadius(to) + 7;
        const startX = from.x + (dx / length) * fromOffset;
        const startY = from.y + (dy / length) * fromOffset;
        const endX = to.x - (dx / length) * toOffset;
        const endY = to.y - (dy / length) * toOffset;
        const labelPoint = edgeLabelPoint(startX, startY, endX, endY, edge, route);
        const amountLabel = edgeCanvasAmountOrMissingLabel(edge);
        const timeLabel = edgeCanvasTimeLabel(edge);
        const selectedLabel = txLabelMode === "selected" && selectedEdgeLabelVisible(edge);
        const importantLabel = txLabelMode === "important" && edgeShouldShowImportantCanvasAmount(edge);
        const allLabel = txLabelMode === "all";
        const labelEnabled = txLabelMode !== "off" && (allLabel || importantLabel || selectedLabel);
        const shouldShowAmount = labelEnabled && edgeShouldShowCanvasAmount(edge);
        const shouldShowTime = labelEnabled && edgeShouldShowCanvasTime(edge);
        const amountLines = labelEnabled ? [shouldShowAmount ? amountLabel : ""].filter(Boolean) : [];
        const timeLines = shouldShowTime ? [timeLabel] : [];
        const label = [...amountLines, ...timeLines];
        const labelRoleClass = edgeLabelRoleClass(edge);
        const metrics = amountPillMetrics(label);
        return { edge, route, cls, visualRole, speedClass, startX, startY, endX, endY, label, labelPoint, labelRoleClass, metrics };
      }).filter(Boolean);
      const edgeLabelItems = edgeRenderItems.filter((item) => item.metrics);
      const placedEdgeLabelItems = avoidEdgeLabelCollisions(edgeLabelItems, placed.nodes);
      const placedEdgeLabelById = new Map(placedEdgeLabelItems.map((item) => [item.edge.id, item]));
      const visibleLabelIds = visibleNodeLabelIds(placed.nodes, visibleEdges, placed);
      const edgeSvg = edgeRenderItems.map((item) => {
        const { edge, route, cls, visualRole, speedClass, startX, startY, endX, endY, label, labelRoleClass } = item;
        const labelItem = placedEdgeLabelById.get(edge.id) || item;
        const marker = ' marker-end="url(#' + edgeMarkerId(edge, visualRole) + ')"';
        const pathD = edgeCurvePath(startX, startY, endX, endY, edge, route);
        return '<g class="edge-group" data-edge-id="' + escapeHtml(edge.id) + '"' + edgeSemanticAttrs(edge, visualRole) + '><path class="edge-hitbox" d="' + pathD + '"></path><path class="' + cls + '" style="stroke-width:' + edgeStrokeWidth(edge) + '" d="' + pathD + '"' + marker + '></path>' +
          amountPill(label, labelItem.labelPoint.x, labelItem.labelPoint.y, speedClass, labelRoleClass) + '</g>';
      }).join("");
      const nodeSvg = placed.nodes.map((node) => {
        const selected = state.selected?.type === "node" && state.selected.id === node.id;
        const visible = matchesSearch(node) && isSelectedConnected(node.id);
        const role = nodeRole(node);
        const roleClass = state.roleMarksVisible && role ? " role-marked node-role-" + escapeHtml(role) : "";
        const timelineClass = state.timelineRange ? (timelineFocusNodeIds.has(node.id) ? " timeline-focus" : " timeline-context") : "";
        const cls = "node node-kind-" + escapeHtml(node.kind || "wallet") + " " + escapeHtml(nodeVisualClass(node)) + roleClass + (selected ? " selected" : "") + timelineClass + (visible ? "" : " dim") + (visibleLabelIds.has(node.id) ? "" : " label-hidden");
        const radius = nodeRadius(node);
        const glyph = serviceGlyph(node);
        return '<g class="' + cls + '" data-node-id="' + escapeHtml(node.id) + '"' + nodeSemanticAttrs(node) + ' transform="translate(' + node.x + ' ' + node.y + ')">' +
          '<circle r="' + radius + '"></circle>' +
          nodeRoleMarkSvg(node, radius) +
          (glyph ? '<text class="service-glyph" y="4" text-anchor="middle">' + escapeHtml(glyph) + '</text>' : '') +
          stopBadge(node, radius) +
          (() => {
            const label = nodeLabelAttrs(node, placed);
            const subLabel = nodeDisplayKind(node) === "funding_bundle" ? bundleSubLabel(node) : "";
            return '<text class="node-label" x="' + label.x + '" y="' + label.y + '" text-anchor="' + label.anchor + '">' + escapeHtml(canvasNodeLabel(node)) + '</text>' +
              (subLabel ? '<text class="node-sublabel" x="' + label.x + '" y="' + (label.y + 15) + '" text-anchor="' + label.anchor + '">' + escapeHtml(subLabel) + '</text>' : '') +
              '</g>';
          })();
      }).join("");
      const defs = edgeMarkerDefs();
      svg.innerHTML = defs + '<g id="graphViewport">' + grid + edgeSvg + nodeSvg + '</g>';
      applyTransform();
      svg.querySelectorAll("[data-node-id]").forEach((node) => {
        node.addEventListener("click", (event) => {
          if (consumeSuppressedGraphClick()) {
            event.stopPropagation();
            return;
          }
          const nodeId = node.getAttribute("data-node-id");
          event.stopPropagation();
          const clickAt = Number(event.timeStamp || Date.now());
          const previousClick = state.lastNodeClick;
          const isDoubleClick = previousClick?.nodeId === nodeId && clickAt - previousClick.at <= 350;
          state.lastNodeClick = isDoubleClick ? null : { nodeId, at: clickAt };
          if (isDoubleClick) {
            event.preventDefault();
            toggleNodeExpansion(nodeId);
            return;
          }
          selectNode(nodeId);
          if (isCollapsedGroupNodeId(nodeId)) setStatus("Selected display group. Use Expand selected to show the raw graph.");
        });
        node.addEventListener("mousedown", (event) => {
          const nodeId = node.getAttribute("data-node-id");
          startNodeDrag(event, nodeId);
        });
      });
      svg.querySelectorAll("[data-edge-id]").forEach((edge) => edge.addEventListener("click", (event) => {
        event.stopPropagation();
        selectEdge(edge.getAttribute("data-edge-id"));
      }));
      const statLabel = (value, label) => value + " " + label + (value === 1 ? "" : "s");
      const placedNodeIds = new Set(placed.nodes.map((node) => node.id));
      const visibleEdgeIds = new Set(visibleEdges.map((edge) => edge.id));
      const visiblePathCount = visibleGraphPathCount(graphPaths(graph), placedNodeIds, visibleEdgeIds);
      const hiddenNodeCount = Math.max(0, graphNodes(graph).length - placed.nodes.length);
      const hiddenEdgeCount = Math.max(0, graphEdges(graph).length - visibleEdges.length);
      const hiddenGraphStatsText = hiddenNodeCount > 0 || hiddenEdgeCount > 0 ? "Hidden by view/filter: " + hiddenNodeCount + " nodes / " + hiddenEdgeCount + " edges" : "";
      const totalGraphStatsText = "Total: " + statLabel(graphNodes(graph).length, "node") + ", " + statLabel(graphEdges(graph).length, "link") + ", " + statLabel(graphPaths(graph).length, "path");
      const visibleGraphStatsText = "Visible: " + statLabel(placed.nodes.length, "node") + ", " + statLabel(visibleEdges.length, "link") + ", " + statLabel(visiblePathCount, "path");
      const weightStatsText = "Score weights: " + graphWeights(graph).length;
      const graphStatsTitle = [
        visibleGraphStatsText,
        totalGraphStatsText,
        ...(hiddenGraphStatsText ? [hiddenGraphStatsText] : []),
        weightStatsText
      ].join(" · ");
      const graphStatsChips = [
        visibleGraphStatsText,
        totalGraphStatsText,
        ...(hiddenGraphStatsText ? [hiddenGraphStatsText] : []),
        weightStatsText
      ];
      el("graphStats").innerHTML = graphStatsChips
        .map((text) => '<span class="chip" title="' + escapeHtml(graphStatsTitle) + '">' + escapeHtml(text) + '</span>')
        .join("");
      el("graphLegend").innerHTML = graphLegendHtml(presentation.mode);
    }
    function isCollapsedGroupNodeId(nodeId) {
      return String(nodeId || "").startsWith("collapsed:") || String(nodeId || "").startsWith("step:");
    }
    function isDeepBranchGroupNodeId(nodeId) {
      return String(nodeId || "").startsWith("collapsed:deep:");
    }
    function expandCollapsedGroup() {
      state.selected = null;
      setDensityMode("show_all");
      setStatus("Expanded collapsed graph groups.");
    }
    function toggleNodeExpansion(nodeId) {
      if (!nodeId) return false;
      state.selected = { type: "node", id: nodeId };
      const node = nodeById(nodeId);
      if (nodeDisplayKind(node) !== "funding_bundle" && !isDeepBranchGroupNodeId(nodeId) && !isCollapsedGroupNodeId(nodeId)) return false;
      if (nodeDisplayKind(node) === "funding_bundle" && state.expandedBundleNodeIds.has(nodeId)) {
        state.expandedBundleNodeIds.delete(nodeId);
        setStatus("Collapsed selected funding bundle.");
        renderGraph();
        renderDetails();
        renderSelectionCard();
        renderTransferTabs();
        return true;
      }
      expandSelectedGraphItem();
      return true;
    }
    function expandSelectedGraphItem() {
      if (!state.selected) {
        setStatus("Select a group, bundle, or boundary first.");
        return;
      }
      if (state.selected.type === "edge") {
        const edge = edgeById(state.selected.id);
        if (!edge || (!edgeHasAggregatedTxEvidence(edge) && edgeTxHashes(edge).length === 0)) {
          setStatus("No stored transaction expansion for this selected edge.");
          return;
        }
        setTransferDrawer(true);
        setTransferTab("selected");
        setStatus("Showing selected transaction evidence.");
        renderSelectionCard();
        renderDetails();
        return;
      }
      if (state.selected.type !== "node") {
        setStatus("Select a group, bundle, or boundary first.");
        return;
      }
      if (isDeepBranchGroupNodeId(state.selected.id)) {
        const selectedGroup = nodeById(state.selected.id);
        const revealedNodeId = asArray(selectedGroup?.metadata?.hiddenNodeIds)[0] || "";
        state.expandedBundleNodeIds.add(state.selected.id);
        state.selected = revealedNodeId ? { type: "node", id: revealedNodeId } : null;
        setStatus("Expanded selected deep-check branch group.");
        renderGraph();
        renderDetails();
        renderSelectionCard();
        renderTransferTabs();
        return;
      }
      if (isCollapsedGroupNodeId(state.selected.id)) {
        expandCollapsedGroup();
        return;
      }
      const node = nodeById(state.selected.id);
      if (nodeDisplayKind(node) === "trace_stop") {
        setTransferTab("stops");
        setStatus("Boundary/context details are shown in the right rail. No stored raw expansion is available for this item.");
        renderSelectionCard();
        renderDetails();
        return;
      }
      if (node?.kind === "service" || node?.kind === "contract" || nodeDisplayKind(node) === "service_boundary") {
        setStatus("Boundary/context details are shown in the right rail. No stored raw expansion is available for this item.");
        renderSelectionCard();
        renderDetails();
        return;
      }
      if (nodeDisplayKind(node) !== "funding_bundle") {
        setStatus("No stored expansion data for this item. The right rail shows the available summary evidence.");
        return;
      }
      if (state.expandedBundleNodeIds.has(state.selected.id)) {
        state.expandedBundleNodeIds.delete(state.selected.id);
        setStatus("Collapsed selected funding bundle.");
      } else {
        state.expandedBundleNodeIds.add(state.selected.id);
        setStatus("Expanded selected funding bundle.");
      }
      renderGraph();
      renderDetails();
      renderSelectionCard();
      renderTransferTabs();
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
    function transferTimestampMs(item) {
      const raw = item?.timestamp || item?.time || item?.blockTimestamp || item?.block_timestamp || item?.date || "";
      const time = new Date(raw).getTime();
      return Number.isFinite(time) ? time : null;
    }
    function transferTableTimeLabel(value) {
      if (!value || value === "time n/a" || value === "n/a") return "time n/a";
      const timestamp = typeof value === "string" ? Date.parse(value) : Number(value);
      if (!Number.isFinite(timestamp)) return "time n/a";
      const date = new Date(timestamp);
      const currentYear = new Date().getUTCFullYear();
      const year = date.getUTCFullYear();
      const month = canvasMonthNames[date.getUTCMonth()];
      const day = String(date.getUTCDate()).padStart(2, "0");
      const hour = String(date.getUTCHours()).padStart(2, "0");
      const minute = String(date.getUTCMinutes()).padStart(2, "0");
      return year === currentYear
        ? month + " " + day + ", " + hour + ":" + minute
        : year + " " + month + " " + day + ", " + hour + ":" + minute;
    }
    function transferTableGapLabel(value, index) {
      if (value && value !== "n/a") return String(value);
      return index === 0 ? "start" : "n/a";
    }
    function transferRowTxGap(item, previousItem) {
      const explicit = item?.txGap || item?.gap || item?.txGapFormatted || formatDurationMs(item?.txGapMs ?? item?.gapMs);
      if (explicit && explicit !== "n/a") return explicit;
      if (!previousItem) return "n/a";
      const currentMs = transferTimestampMs(item);
      const previousMs = transferTimestampMs(previousItem);
      if (currentMs === null || previousMs === null) return "n/a";
      return formatDurationMs(currentMs - previousMs) || "n/a";
    }
    function edgeTransferEvidenceRows(edge) {
      if (!edgeHasTransferRows(edge)) return [];
      const transfers = asArray(edge?.metadata?.underlyingTransfers).filter((item) => item && typeof item === "object");
      if (transfers.length > 0) {
        return transfers.map((item, index) => ({
          amount: formatRawUsdt(item?.amountRaw) || item?.amountRaw || "amount n/a",
          time: item?.timestamp || "time n/a",
          txGap: index === 0 ? edgeTxGap(edge) || transferRowTxGap(item, transfers[index - 1]) : transferRowTxGap(item, transfers[index - 1]),
          fromAddress: item?.fromAddress || item?.sourceAddress || edgeFromAddress(edge),
          toAddress: item?.toAddress || item?.receiverAddress || edgeToAddress(edge),
          txHash: item?.txHash || "",
          path: edgePathId(edge) || "n/a",
          verdict: edge?.verdict || "unknown"
        }));
      }
      if (!edgeHasAggregatedTxEvidence(edge)) return [];
      const hashes = edgeTxHashes(edge);
      return hashes.map((txHash, index) => ({
        amount: hashes.length === 1 ? edgeDetailedAmountLabel(edge) || edgeAggregateAmountLabel(edge) || "amount n/a" : "amount n/a",
        time: hashes.length === 1 ? edge?.timestamp || edge?.timestampIso || edge?.metadata?.timestamp || edge?.metadata?.timestampIso || "time n/a" : "time n/a",
        txGap: index === 0 ? edgeTxGap(edge) || "n/a" : "n/a",
        fromAddress: edgeFromAddress(edge),
        toAddress: edgeToAddress(edge),
        txHash,
        path: edgePathId(edge) || "n/a",
        verdict: edge?.verdict || "unknown"
      }));
    }
    function transferEvidenceRowsHtml(rows, parentEdgeId) {
      return '<div class="transfer-head"><span>time</span><span>tx gap</span><span>amount</span><span>from</span><span>to</span><span>tx</span><span>path</span><span>verdict</span></div>' +
        rows.map((row, index) => '<div role="button" tabindex="0" class="transfer-row" data-edge-id="' + escapeHtml(parentEdgeId) + '">' +
          '<span>' + escapeHtml(transferTableTimeLabel(row.time)) + '</span>' +
          '<span>' + escapeHtml(transferTableGapLabel(row.txGap, index)) + '</span>' +
          '<span>' + escapeHtml(row.amount || "amount n/a") + '</span>' +
          '<span>' + explorerLink(tronscanAddressUrl(row.fromAddress), short(row.fromAddress || "from n/a", 7)) + '</span>' +
          '<span>' + explorerLink(tronscanAddressUrl(row.toAddress), short(row.toAddress || "to n/a", 7)) + '</span>' +
          '<span>' + (row.txHash ? explorerLink(tronscanTxUrl(row.txHash), short(row.txHash, 5)) : '<span class="muted">tx n/a</span>') + '</span>' +
          '<span>' + escapeHtml(row.path || "n/a") + '</span>' +
          '<span>' + escapeHtml(row.verdict || "unknown") + '</span>' +
          '</div>').join("");
    }
    function transferTableEmptyCopy() {
      if (!state.graph) return "Select a completed or partial job to inspect evidence.";
      if (state.transferTab === "selected" && !state.selected) return "Select an edge, node, or path to inspect related transfers.";
      if (state.transferTab === "selected") return "No transfer evidence is stored for this selection.";
      if (state.transferTab === "stops") return "No boundary stops are stored for this graph.";
      if (state.timelineRange) return "No transfers are stored in the selected timeline bucket.";
      return "No transfers match the current filters.";
    }
    function timelineEmptyCopy() {
      if (!state.graph) return "Select a graph to inspect transfer timing.";
      return "No timestamped transfer activity is stored for the current filters.";
    }
    function renderTransferTabs() {
      const root = el("transferTable");
      if (!state.graph) {
        root.innerHTML = '<div class="empty">' + escapeHtml(transferTableEmptyCopy()) + '</div>';
        return;
      }
      if (state.transferTab === "stops") return renderBoundaryStops(root);
      const filteredEdges = filteredTransferEdges().filter(edgePassesTimelineRange).filter(edgeHasTransferRows);
      const selected = selectedEdgeIds();
      if (state.transferTab === "selected" && state.selected?.type === "edge") {
        const selectedEdge = edgeById(state.selected.id);
        const transferRows = edgeTransferEvidenceRows(selectedEdge);
        if (transferRows.length > 0) {
          root.innerHTML = transferEvidenceRowsHtml(transferRows, state.selected.id);
          root.querySelectorAll("[data-edge-id]").forEach((row) => {
            row.addEventListener("click", (event) => {
              if (event.target instanceof Element && event.target.closest("a")) return;
              selectEdge(row.getAttribute("data-edge-id"));
            });
            row.addEventListener("keydown", (event) => {
              if (event.key === "Enter" || event.key === " ") {
                if (event.target instanceof Element && event.target.closest("a")) return;
                event.preventDefault();
                selectEdge(row.getAttribute("data-edge-id"));
              }
            });
          });
          return;
        }
      }
      const edges = state.transferTab === "selected"
        ? filteredEdges.filter((edge) => selected.has(edge.id))
        : filteredEdges;
      if (edges.length === 0) {
        root.innerHTML = '<div class="empty">' + escapeHtml(transferTableEmptyCopy()) + '</div>';
        return;
      }
      root.innerHTML = '<div class="transfer-head"><span>time</span><span>tx gap</span><span>amount</span><span>from</span><span>to</span><span>tx</span><span>path</span><span>verdict</span></div>' +
        edges.map((edge, index) => '<div role="button" tabindex="0" class="transfer-row" data-edge-id="' + escapeHtml(edge.id) + '">' +
          '<span>' + escapeHtml(transferTableTimeLabel(edge?.timestamp || edge?.timestampIso || edge?.metadata?.timestamp || edge?.metadata?.timestampIso || "time n/a")) + '</span>' +
          '<span title="' + escapeHtml(edge?.metadata?.txGapMs ?? "") + '">' + escapeHtml(transferTableGapLabel(edgeTxGap(edge), index)) + '</span>' +
          '<span>' + escapeHtml(edgeDetailedAmountLabel(edge) || "amount n/a") + '</span>' +
          '<span>' + explorerLink(tronscanAddressUrl(edgeEvidenceEndpoint(edge, "from")), short(edgeEvidenceEndpoint(edge, "from"), 7)) + '</span>' +
          '<span>' + explorerLink(tronscanAddressUrl(edgeEvidenceEndpoint(edge, "to")), short(edgeEvidenceEndpoint(edge, "to"), 7)) + '</span>' +
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
        root.innerHTML = '<div class="empty">' + escapeHtml(transferTableEmptyCopy()) + '</div>';
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
        root.innerHTML = "Select a completed or partial job to inspect evidence.";
        return;
      }
      root.className = "details-body";
      if (state.selected?.type === "node") {
        const node = nodeById(state.selected.id);
        root.innerHTML = walletDetailBlock(node, graph);
        return;
      }
      if (state.selected?.type === "edge") {
        const edge = edgeById(state.selected.id);
        root.innerHTML = transferDetailBlock(edge);
        return;
      }
      const subject = graphSubject(graph);
      const summary = graphSummary(graph);
      const activeJob = state.jobs.find((job) => job.id === state.activeJobId) || graph.job;
      const noSelectionIntro = analystIntroBlock("No graph evidence is selected.", "Select a node, edge, group, service, or boundary to inspect what it means and which raw facts support it.", [
        analystBadge("case summary", "context")
      ]);
      root.innerHTML = noSelectionIntro + '<div class="metric-grid">' +
        metric("Subject", subject.address || "unknown", "wide") +
        metric("Requested by", activeJob ? requesterText(activeJob) : "unknown", "wide") +
        metric("Decision", summary.decision || "UNKNOWN") +
        metric("Risk", (summary.riskScore ?? "n/a") + " / " + (summary.riskLevel ?? "unknown")) +
        clarityMetricHtml(graphRiskClarity(graph)) +
        metric("Graph meaning", "Graph is evidence navigation, not proof by itself.", "wide") +
        metric("Coverage", percent(summary.coverageRatio)) +
        metric("Checked scope", summary.checkedScope || "n/a") +
        metric("Anchor coverage", percent(summary.anchorCoverageRatio)) +
        metric("Episode coverage", percent(summary.episodeCoverageRatio)) +
        metric("Drain episode", drainEpisodeSummary(summary), "wide") +
        metric("Layer summary", layerSummaryLine(summary), "wide") +
        metric("Projection mode", projectionMode(graph)) +
        listMetric("Projection gaps", projectionGapLines(graph), "No projection gaps stored.") +
        listMetric("Path timing", pathTimingLines(graph), "No path timing stored.") +
        strictProvenanceLines(summary) +
        targetedIndexLines(summary) +
        whereFundingCandidateLines(summary) +
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
    function analystMissingCopy(kind = "value") {
      if (kind === "time") return "time not stored";
      if (kind === "tx") return "tx hash not stored";
      if (kind === "amount") return "amount not stored";
      if (kind === "coverage") return "coverage not available";
      if (kind === "directTransfer") return "no direct transfer tx stored";
      if (kind === "checked") return "not checked";
      if (kind === "legacy") return "legacy graph data";
      return "not stored";
    }
    function analystEvidenceKind(edge) {
      const type = edgeEvidenceType(edge);
      if (type === "contract_driven_transfer" || type === "approval_drain_transfer") return "Contract-driven movement";
      if (type === "contract_trigger_context" || type === "contract_call_context" || type === "debit_authority_context" || type === "approval_drain_contract_call" || type === "approval_drain_spender_authority") return "Contract context";
      if (edgeIsGroupedContextEvidence(edge)) return "Grouped transfers";
      if (type === "boundary_context" || type === "boundary_context_only" || edge?.type === "service_boundary") return "Service or boundary exposure";
      if (type === "profile_context" || edgeDisplayRole(edge) === "profile_context") return "Context evidence";
      if (type === "direct_transfer" || edgeDisplayRole(edge) === "real_transfer") return "Money flow";
      return "Evidence";
    }
    function analystEvidenceMeaning(edge) {
      const type = edgeEvidenceType(edge);
      if (type === "contract_driven_transfer" || type === "approval_drain_transfer") {
        return "USDT moved through a smart-contract-driven transfer. Read caller, contract, source, and receiver before treating it like a normal wallet send.";
      }
      if (type === "contract_trigger_context" || type === "contract_call_context" || type === "debit_authority_context" || type === "approval_drain_contract_call" || type === "approval_drain_spender_authority") {
        return "This is smart-contract call context. It explains how the contract scene was triggered; it is not a normal wallet-to-wallet transfer by itself.";
      }
      if (edgeIsGroupedContextEvidence(edge)) {
        return "Several real transfers are summarized into one edge. This is money-flow evidence when tx hashes or grouped transfer rows are stored.";
      }
      if (type === "boundary_context" || type === "boundary_context_only" || edge?.type === "service_boundary") {
        return "This is service or boundary context. Public-chain continuity stops or changes meaning here unless stronger follow-on evidence exists.";
      }
      if (type === "profile_context" || edgeDisplayRole(edge) === "profile_context") {
        return "This is behavioral or profile context, not a direct money-flow claim by itself.";
      }
      if (type === "direct_transfer" || edgeDisplayRole(edge) === "real_transfer") {
        return "This edge represents a real transfer stored in the graph.";
      }
      return "This graph item is stored evidence for the selected investigation.";
    }
    function analystEvidenceBadgeClass(edge) {
      const type = edgeEvidenceType(edge);
      if (type === "contract_driven_transfer" || type === "approval_drain_transfer" || type.includes("contract") || type.includes("approval_drain")) return "contract";
      if (edgeIsGroupedContextEvidence(edge)) return "grouped";
      if (type.includes("boundary")) return "boundary";
      if (type.includes("profile") || edgeDisplayRole(edge) === "profile_context") return "context";
      return "money";
    }
    function selectedFlowTransferRows(edge) {
      const transfers = asArray(edge?.metadata?.underlyingTransfers)
        .filter((item) => item && typeof item === "object")
        .map((item, index) => {
          const timestamp = selectedFlowTimestampValue(item);
          const timestampMs = selectedFlowTimestampMs(timestamp);
          const amountRaw = item.amountRaw || item.quant || item.valueRaw || "";
          const amount = formatRawUsdt(amountRaw) || item.amountFormatted || item.amount || amountRaw || "amount unknown";
          const action = selectedFlowAction(item, edge);
          return {
            index,
            amountRaw,
            amount,
            timestamp,
            timestampMs: timestampMs === null ? Number.MAX_SAFE_INTEGER : timestampMs,
            timeLabel: canvasTimestampLabel(timestamp) || "time unknown",
            dayKey: selectedFlowDateKey(timestamp),
            fromAddress: item.fromAddress || item.sourceAddress || (typeof edgeEvidenceEndpoint === "function" ? edgeEvidenceEndpoint(edge, "from") : "") || edgeFromAddress(edge),
            toAddress: item.toAddress || item.receiverAddress || (typeof edgeEvidenceEndpoint === "function" ? edgeEvidenceEndpoint(edge, "to") : "") || edgeToAddress(edge),
            txHash: item.txHash || item.transactionHash || "",
            txGap: item.txGap && item.txGap !== "n/a" ? item.txGap : "",
            action
          };
        });
      return transfers.sort((a, b) => (a.timestampMs - b.timestampMs) || (a.index - b.index));
    }
    function selectedFlowTimestampValue(transfer) {
      return transfer?.timestamp ||
        transfer?.time ||
        transfer?.blockTime ||
        transfer?.fullTime ||
        transfer?.createdAt ||
        transfer?.blockTimestamp ||
        transfer?.block_ts ||
        transfer?.block_time ||
        "";
    }
    function selectedFlowTimestampMs(value) {
      const raw = value && typeof value === "object"
        ? value?.timestamp || value?.time || value?.blockTimestamp || value?.block_timestamp || value?.block_ts || value?.date || ""
        : value;
      if (!raw) return null;
      const time = new Date(raw).getTime();
      return Number.isFinite(time) ? time : null;
    }
    function selectedFlowDateKey(value) {
      const time = selectedFlowTimestampMs(value);
      if (time === null) return "time-unknown";
      return new Date(time).toISOString().slice(0, 10);
    }
    function selectedFlowDateLabel(dayKey) {
      if (dayKey === "time-unknown") return "Time unknown";
      return canvasTimestampLabel(dayKey + "T00:00:00.000Z").replace(", 00:00", "");
    }
    function selectedFlowAction(transfer, edge) {
      const raw = String(transfer?.action || transfer?.method || transfer?.methodName || transfer?.functionName || transfer?.event || transfer?.role || "").trim();
      const evidenceType = edgeEvidenceType(edge);
      const lower = raw.toLowerCase();
      const statusText = String(transfer?.status ?? transfer?.result ?? transfer?.contractRet ?? "").toLowerCase();
      const failed = transfer?.success === false || statusText.includes("fail") || statusText.includes("error") || statusText.includes("revert");
      if (failed) return { label: "Failed tx", quiet: false, meaningful: true, raw: raw || statusText };
      if (lower.includes("approve") || lower.includes("approval")) return { label: "Approval to spend USDT", quiet: false, meaningful: true, raw: raw || "approval" };
      if (lower.includes("transferfrom")) return { label: "Contract transfer", quiet: false, meaningful: true, raw: raw || "transferFrom" };
      if (lower.includes("sellgem")) return { label: "Contract call: sellGem", quiet: false, meaningful: true, raw };
      if (evidenceType === "contract_driven_transfer" || evidenceType === "approval_drain_transfer") return { label: "Contract transfer", quiet: false, meaningful: true, raw };
      if (lower.includes("swap")) return { label: "Swap", quiet: false, meaningful: true, raw };
      if (lower.includes("mint")) return { label: "Mint", quiet: false, meaningful: true, raw };
      if (lower.includes("burn")) return { label: "Burn", quiet: false, meaningful: true, raw };
      if (!raw) return { label: "Action unknown", quiet: true, meaningful: false, raw: "" };
      if (lower === "transfer" || lower.startsWith("transfer(")) return { label: "Transfer", quiet: true, meaningful: false, raw };
      return { label: "Action unknown", quiet: false, meaningful: true, raw };
    }
    function selectedFlowDayGroups(rows) {
      const groups = [];
      rows.forEach((row) => {
        let group = groups.find((item) => item.dayKey === row.dayKey);
        if (!group) {
          group = { dayKey: row.dayKey, rows: [] };
          groups.push(group);
        }
        group.rows.push(row);
      });
      return groups;
    }
    function selectedFlowCountLabel(edge, rows) {
      const count = rows.length || edgeAggregateTransferCount(edge) || edgeTxHashes(edge).length || 1;
      const hasMixedActions = rows.some((row) => row.action && row.action.quiet === false);
      const contractRoute = edgeEvidenceType(edge) === "contract_driven_transfer" || edgeEvidenceType(edge) === "approval_drain_transfer";
      const noun = contractRoute ? "contract transfer" : hasMixedActions ? "tx" : "transfer";
      return count + " " + noun + (count === 1 || noun === "tx" ? "" : "s") + (hasMixedActions ? " · mixed actions" : "");
    }
    function selectedFlowAmountLabel(edge, rows) {
      const rowTotal = asArray(rows).reduce((total, row) => {
        const value = String(row?.amountRaw || "").trim();
        if (!/^\\d+$/.test(value)) return total;
        return total + Number(value);
      }, 0);
      return edgeAggregateAmountLabel(edge) || (rowTotal > 0 ? formatRawUsdt(String(rowTotal)) : "") || edgeDetailedAmountLabel(edge) || edgeCanvasAmountLabel(edge) || "amount unknown";
    }
    function selectedFlowTimeRange(rows, edge) {
      const timedRows = rows.filter((row) => row.timestampMs !== Number.MAX_SAFE_INTEGER);
      if (timedRows.length > 0) {
        const first = timedRows[0].timeLabel;
        const last = timedRows[timedRows.length - 1].timeLabel;
        return first === last ? first : first + " -> " + last;
      }
      const fallback = edgeTime(edge);
      return canvasTimestampLabel(fallback) || fallback || "time unknown";
    }
    function selectedFlowDirectionLabel(edge) {
      const direction = edgeFlowDirection(edge);
      if (edgeEvidenceType(edge) === "contract_driven_transfer" || edgeEvidenceType(edge) === "approval_drain_transfer") return "Contract route";
      if (direction === "incoming") return "Incoming";
      if (direction === "outgoing") return "Outgoing";
      return "Flow";
    }
    function selectedFlowHeaderModel(edge, rows) {
      const countLabel = selectedFlowCountLabel(edge, rows);
      const amountLabel = selectedFlowAmountLabel(edge, rows);
      const directionLabel = selectedFlowDirectionLabel(edge);
      const timeRange = selectedFlowTimeRange(rows, edge);
      const txHashes = edgeTxHashes(edge);
      return {
        countLabel,
        amountLabel,
        directionLabel,
        timeRange,
        aggregateOnly: rows.length === 0 && txHashes.length > 0,
        txHashes,
        hashes: txHashes,
        title: selectedFlowCountLabel(edge, rows) + " · " + selectedFlowAmountLabel(edge, rows),
        timeLine: selectedFlowDirectionLabel(edge) + " · " + selectedFlowTimeRange(rows, edge)
      };
    }
    function selectedFlowHasAggregateOnly(edge, rows) {
      return asArray(rows).length === 0 && edgeTxHashes(edge).length > 0;
    }
    function selectedFlowNodeByAddress(address) {
      const value = String(address || "");
      if (!value) return null;
      const direct = typeof nodeById === "function" ? nodeById("addr:" + value) : null;
      if (direct) return direct;
      if (typeof graphNodes !== "function" || typeof state === "undefined") return null;
      return graphNodes(state.graph).find((node) => nodeAddress(node) === value) || null;
    }
    function selectedFlowEntityKindLabel(node) {
      const kind = nodeDisplayKind(node);
      if (kind === "subject_wallet") return "Subject wallet";
      if (kind === "funding_bundle") return "Funding bundle";
      if (kind === "cex") return "CEX";
      if (kind === "bridge") return "Bridge";
      if (kind === "smart_contract") return "Contract";
      if (kind === "contract_adapter") return "Contract";
      if (kind === "contract_router") return "Contract";
      if (kind === "dex_contract") return "DEX";
      if (kind === "service_boundary") return boundaryIdentityCategoryLabel(node) || "service";
      return kind === "wallet" ? "Wallet" : kind.replace(/_/g, " ");
    }
    function selectedFlowUsefulNodeLabel(node, address) {
      const label = String(nodeDisplayLabel(node) || "").trim();
      if (!label || label === "unknown") return "";
      const nodeId = String(node?.id || "");
      if (label === nodeId || label === String(address || "")) return "";
      return label;
    }
    function selectedFlowEntityLabel(nodeId, address, side) {
      const node = (nodeId && typeof nodeById === "function" ? nodeById(nodeId) : null) ||
        selectedFlowNodeByAddress(address) ||
        (address && typeof nodeById === "function" ? nodeById("addr:" + address) : null);
      const resolvedAddress = String(address || nodeAddress(node) || graphAddressFromNodeId(nodeId) || "");
      const kind = nodeDisplayKind(node);
      const kindLabel = node ? selectedFlowEntityKindLabel(node) : "";
      const shortAddress = resolvedAddress ? short(resolvedAddress, 7) : "";
      if (kind === "subject_wallet" || node?.kind === "subject" || side === "subject") {
        return { primary: "Subject wallet", secondary: shortAddress, address: resolvedAddress, node, kind };
      }
      if (kind === "smart_contract" || node?.kind === "contract") {
        return { primary: "Contract", secondary: shortAddress, address: resolvedAddress, node, kind };
      }
      if (kind === "funding_bundle") {
        const count = Number(node?.metadata?.memberCount ?? node?.metadata?.funderCount ?? asArray(node?.metadata?.topFunders).length);
        return {
          primary: "Funding bundle",
          secondary: Number.isFinite(count) && count > 0 ? count + " wallets" : shortAddress,
          address: resolvedAddress,
          node,
          kind
        };
      }
      const label = node && (nodeIsServiceLike(node) || kind === "cex" || kind === "service_boundary")
        ? selectedFlowUsefulNodeLabel(node, resolvedAddress)
        : "";
      if (label) {
        return {
          primary: label,
          secondary: [kindLabel, shortAddress].filter(Boolean).join(" · "),
          address: resolvedAddress,
          node,
          kind
        };
      }
      const fallback = shortAddress || String(nodeId || address || "unknown");
      return { primary: fallback, secondary: "", address: resolvedAddress, node, kind };
    }
    function selectedFlowEntityHtml(nodeId, address, side) {
      const entity = selectedFlowEntityLabel(nodeId, address, side);
      const primary = entity.address
        ? explorerLink(tronscanAddressUrl(entity.address), entity.primary)
        : escapeHtml(entity.primary);
      return '<span class="selected-flow-entity">' +
        '<span class="entity-primary">' + primary + '</span>' +
        (entity.secondary ? '<span class="entity-secondary">' + escapeHtml(entity.secondary) + '</span>' : "") +
        '</span>';
    }
    function selectedFlowHeaderHtml(edge, rows) {
      const model = selectedFlowHeaderModel(edge, rows);
      const from = edgeEvidenceEndpoint(edge, "from") || edgeFromAddress(edge) || "from unknown";
      const to = edgeEvidenceEndpoint(edge, "to") || edgeToAddress(edge) || "to unknown";
      return '<div class="selected-flow-header">' +
        '<div class="selected-flow-title">' + escapeHtml(model.title) + '</div>' +
        '<div class="selected-flow-timeline">' + escapeHtml(model.timeLine) + '</div>' +
        '<div class="selected-flow-route">' +
        selectedFlowEntityHtml(edge?.fromNodeId, from, "from") +
        '<span aria-hidden="true">-&gt;</span>' +
        selectedFlowEntityHtml(edge?.toNodeId, to, "to") +
        '</div>' +
        '</div>';
    }
    function selectedFlowDayAmountLabel(group) {
      const total = asArray(group?.rows).reduce((sum, row) => {
        const value = String(row?.amountRaw || "").trim();
        return /^\\d+$/.test(value) ? sum + BigInt(value) : sum;
      }, 0n);
      return total > 0n ? formatRawUsdt(String(total)) : "";
    }
    function selectedFlowEdgeExpansionKey(edge) {
      return String(edge?.id || edge?.metadata?.pathId || edge?.pathId || "");
    }
    function selectedFlowRowsExpanded(edge) {
      const key = selectedFlowEdgeExpansionKey(edge);
      return !!key && typeof state !== "undefined" && state.expandedSelectedFlowEdgeIds?.has(key);
    }
    function selectedFlowDayHeadLabel(group) {
      const parts = [selectedFlowDateLabel(group.dayKey), String(group.rows.length) + " tx"];
      const amount = selectedFlowDayAmountLabel(group);
      if (amount) parts.push(amount);
      return parts.join(" · ");
    }
    function selectedFlowTransactionListHtml(edge, rows) {
      const allRows = asArray(rows);
      const capped = allRows.length > 100 && !selectedFlowRowsExpanded(edge);
      const visibleRows = capped ? allRows.slice(0, 100) : allRows;
      const groups = selectedFlowDayGroups(visibleRows);
      if (groups.length === 0) {
        return '<div class="selected-flow-empty">No per-transaction rows stored for this flow.</div>';
      }
      const expansionKey = selectedFlowEdgeExpansionKey(edge);
      const limit = capped
        ? '<div class="selected-flow-limit"><span>Showing first 100 of ' + escapeHtml(String(allRows.length)) + ' tx</span><button type="button" data-action="show-selected-flow-all" data-selected-flow-edge-id="' + escapeHtml(expansionKey) + '">Show all</button></div>'
        : "";
      return '<div class="selected-flow-days">' + limit + groups.map((group) => {
        return '<section class="selected-flow-day">' +
          '<div class="selected-flow-day-head"><span>' + escapeHtml(selectedFlowDayHeadLabel(group)) + '</span></div>' +
          '<div class="selected-flow-day-rows">' + group.rows.map(selectedFlowTxRowHtml).join("") + '</div>' +
          '</section>';
      }).join("") + '</div>';
    }
    function selectedFlowAggregateOnlyHtml(edge) {
      return '<div class="selected-flow-aggregate-only">' +
        '<strong>Details not stored</strong>' +
        '<div>Rerun check to load per-tx details</div>' +
        '<div class="muted">This saved graph has tx hashes and total amount, but no per-tx rows.</div>' +
        txHashLinksHtml(edgeTxHashes(edge)) +
        '</div>';
    }
    function selectedFlowPrimaryBodyHtml(edge, rows) {
      if (asArray(rows).length > 0) return selectedFlowTransactionListHtml(edge, rows);
      if (selectedFlowHasAggregateOnly(edge, rows)) return selectedFlowAggregateOnlyHtml(edge);
      return '<div class="selected-flow-empty">No per-transaction rows stored for this flow.</div>';
    }
    function selectedFlowDebugRow(label, value) {
      return '<span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value || "n/a") + '</strong>';
    }
    function selectedFlowDebugHtml(edge, rows) {
      const txHashCount = edgeTxHashes(edge).length;
      const source = edge?.metadata?.source || edge?.metadata?.historySource || edge?.source || "saved graph";
      const rawJson = JSON.stringify(edge, null, 2);
      return '<details class="selected-flow-debug">' +
        '<summary>Debug</summary>' +
        '<div class="selected-flow-debug-grid">' +
        selectedFlowDebugRow("Evidence type", edgeEvidenceType(edge)) +
        selectedFlowDebugRow("Meaning", analystEvidenceMeaning(edge)) +
        selectedFlowDebugRow("Path", edgePathId(edge) || "n/a") +
        selectedFlowDebugRow("Display role", edgeDisplayRole(edge)) +
        selectedFlowDebugRow("Stored tx hashes count", String(txHashCount)) +
        selectedFlowDebugRow("Has underlying transfers", asArray(rows).length > 0 ? "yes" : "no") +
        selectedFlowDebugRow("Source", source) +
        selectedFlowDebugRow("Risk scope", "not evaluated for this flow") +
        '</div>' +
        '<div class="selected-flow-debug-actions">' +
        '<button type="button" data-copy-text="' + escapeHtml(edge?.id || "") + '">Copy edge id</button>' +
        '<button type="button" data-copy-text="' + escapeHtml(rawJson) + '">Copy raw JSON</button>' +
        '</div>' +
        '</details>';
    }
    function selectedFlowTxRowHtml(row) {
      const txHash = row?.txHash || "";
      const txUrl = txHash ? tronscanTxUrl(txHash) : "";
      const open = txUrl
        ? '<div class="selected-flow-tx-row is-clickable" role="link" tabindex="0" data-selected-flow-tx-url="' + escapeHtml(txUrl) + '">'
        : '<div class="selected-flow-tx-row">';
      const close = '</div>';
      const txLabel = txHash ? short(txHash, 8) : "tx unknown";
      const txHtml = txHash ? explorerLink(txUrl, txLabel) : escapeHtml(txLabel);
      const action = row?.action?.meaningful && !row.action.quiet
        ? '<div class="selected-flow-action">Action: ' + escapeHtml(row.action.label) + '</div>'
        : "";
      return open +
        '<div class="selected-flow-tx-main"><span>' + escapeHtml(row?.amount || "amount unknown") + '</span><span>' + escapeHtml(row?.timeLabel || "time unknown") + '</span></div>' +
        '<div class="selected-flow-tx-route">' +
        selectedFlowEntityHtml(row?.fromNodeId, row?.fromAddress, "from") +
        '<span aria-hidden="true">-&gt;</span>' +
        selectedFlowEntityHtml(row?.toNodeId, row?.toAddress, "to") +
        '</div>' +
        '<div class="selected-flow-tx-meta">' + txHtml + (row?.txGap ? ' / ' + escapeHtml(row.txGap) : "") + '</div>' +
        action +
        close;
    }
    function cardLine(label, value) {
      return '<div class="card-line"><span class="muted">' + escapeHtml(label) + '</span><strong>' + escapeHtml(value || "n/a") + '</strong></div>';
    }
    function cardLineHtml(label, html) {
      return '<div class="card-line"><span class="muted">' + escapeHtml(label) + '</span><strong>' + html + '</strong></div>';
    }
    function cardBlockHtml(label, html) {
      return '<div class="card-line card-block"><span class="muted">' + escapeHtml(label) + '</span><div class="card-block-body">' + html + '</div></div>';
    }
    function analystBadge(label, cls = "evidence") {
      return '<span class="analyst-badge analyst-badge-' + escapeHtml(cls) + '">' + escapeHtml(label) + '</span>';
    }
    function analystIntroBlock(title, text, badges = []) {
      const badgeHtml = asArray(badges).filter(Boolean).join("");
      return '<div class="analyst-intro">' +
        '<div class="analyst-intro-kicker">' + escapeHtml(title) + '</div>' +
        (badgeHtml ? '<div class="analyst-badge-row">' + badgeHtml + '</div>' : "") +
        '<p>' + escapeHtml(text || analystMissingCopy()) + '</p>' +
        '</div>';
    }
    function analystRawFactsBlock(title, rows) {
      const rowHtml = asArray(rows).filter(Boolean).join("");
      if (!rowHtml) return "";
      return cardBlockHtml(title, '<div class="metric-grid">' + rowHtml + '</div>');
    }
    function analystMetricRawFactsBlock(title, rows) {
      return section(title, asArray(rows).filter(Boolean));
    }
    function nodeAnalystMeaning(node) {
      if (!node) return "No node is selected.";
      if (node.kind === "subject") return "This is the checked subject wallet for the active forensic job.";
      if (node.kind === "bundle" || nodeDisplayKind(node) === "funding_bundle") return "This saved funding bundle summarizes several funding inputs so the route stays readable.";
      if (nodeDisplayKind(node) === "collapsed_group") return "This display group collapses lower-priority graph items. Expand it to inspect stored members.";
      if (nodeIsServiceLike(node)) return "This service or boundary node explains where public-chain continuity changes meaning. It is not proof of common ownership by itself.";
      if (node.kind === "wallet") return "This wallet appears because it is connected to the observed graph. Its local risk is only known when this panel shows stored evidence.";
      return "This node is stored graph context for the active investigation.";
    }
    function addressDetailLink(address) {
      const value = graphAddressFromNodeId(address) || address || "n/a";
      return explorerLink(tronscanAddressUrl(value), value);
    }
    function txDetailLink(txHash) {
      const value = txHash || "inferred";
      return explorerLink(tronscanTxUrl(value === "inferred" ? "" : value), value);
    }
    function edgeEndpointLabel(edge, nodeId, fallback) {
      if (String(nodeId || "").startsWith("bundle:")) return "Funding bundle";
      const node = nodeById(nodeId);
      if (nodeDisplayKind(node) === "funding_bundle") return bundleCanvasLabel(node) || "Funding bundle";
      return fallback || nodeDisplayLabel(node) || String(nodeId || "unknown");
    }
    function endpointDetailLink(edge, side) {
      const nodeId = side === "from" ? edge?.fromNodeId : edge?.toNodeId;
      const fallback = side === "from" ? edgeFromAddress(edge) : edgeToAddress(edge);
      const label = edgeEndpointLabel(edge, nodeId, fallback);
      return tronscanAddressUrl(graphAddressFromNodeId(label) || label) ? addressDetailLink(label) : escapeHtml(label);
    }
    function connectedNeighborLines(node) {
      if (!node) return [];
      return filteredTransferEdges()
        .filter((edge) => edgeIsPeerLink(edge) && (edge.fromNodeId === node.id || edge.toNodeId === node.id))
        .slice(0, 12)
        .map((edge) => {
          const otherNodeId = edge.fromNodeId === node.id ? edge.toNodeId : edge.fromNodeId;
          const other = nodeById(otherNodeId);
          const otherAddress = nodeAddress(other) || otherNodeId;
          const amount = edgeDetailedAmountLabel(edge) || edgeCanvasAmountLabel(edge) || "amount n/a";
          const time = edgeTime(edge) || "time n/a";
          const tx = txDetailLink(edge.txHash || "inferred");
          return addressDetailLink(otherAddress) + " / " + escapeHtml(amount) + " / " + escapeHtml(time) + " / " + tx;
        });
    }
    function selectedNodeTransferEdges(node) {
      if (!node) return [];
      return filteredTransferEdges()
        .filter(edgeHasTransferRows)
        .filter((edge) => edge.fromNodeId === node.id || edge.toNodeId === node.id)
        .sort((a, b) => {
          const aTime = new Date(a?.timestamp || a?.metadata?.lastSeen || a?.metadata?.firstSeen || 0).getTime();
          const bTime = new Date(b?.timestamp || b?.metadata?.lastSeen || b?.metadata?.firstSeen || 0).getTime();
          return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
        });
    }
    function selectedNodeTransferBlock(node) {
      const edges = selectedNodeTransferEdges(node);
      if (edges.length === 0) return "";
      const visible = edges.slice(0, 60);
      const note = edges.length > visible.length
        ? '<div class="tx-summary-note">Showing first ' + visible.length + ' of ' + edges.length + ' visible transfer/context edges. Use the Transfers drawer for the full table.</div>'
        : "";
      return cardBlockHtml("Counterparty transfers", transferListHtml(visible, "No related transactions in this graph.") + note);
    }
    function savedWalletRiskHtml(node) {
      const risk = node?.metadata?.savedWalletRisk;
      if (!risk) return "";
      return cardBlockHtml("Saved wallet risk",
        '<div class="card-line"><span class="muted">Risk</span><strong>' + escapeHtml(risk.risk ?? "n/a") + '</strong></div>' +
        '<div class="card-line"><span class="muted">Role</span><strong>' + escapeHtml(risk.role || "unknown") + '</strong></div>' +
        '<div class="card-line"><span class="muted">Evidence</span><strong>' + escapeHtml(risk.evidence || "n/a") + '</strong></div>' +
        '<div class="card-line"><span class="muted">Source check</span><strong>' + escapeHtml(risk.kind || "n/a") + '</strong></div>');
    }
    function secondLayerStatusBlock(node) {
      const metadata = node?.metadata || {};
      const status = metadata.secondLayerStatus;
      const stopReason = metadata.stopReason;
      const limitationCode = metadata.limitationCode;
      if (!status && !stopReason && !limitationCode) return "";
      return cardBlockHtml("DeepCheck second layer",
        cardLine("Status", status || "n/a") +
        cardLine("Stop reason", stopReason || "n/a") +
        cardLine("Limitation", limitationCode || "n/a"));
    }
    function selectedNodeCard(node) {
      if (!node) return "";
      const type = nodeType(node);
      const clusterRole = walletClusterNodeRoleLabel(node);
      const clusterNote = clusterRole
        ? cardLine("DeepCheck wallet-cluster role", clusterRole) +
          '<div class="card-note">' + escapeHtml(walletClusterNodeContextNote(node)) + '</div>'
        : "";
      return '<h3>Selected node</h3>' +
        cardLine("Type", type.label) +
        cardLineHtml("Address", addressDetailLink(nodeAddress(node) || node.id)) +
        cardLineHtml("Connected neighbors", internalLinkListHtml(connectedNeighborLines(node), "No connected neighbor links.")) +
        selectedNodeTransferBlock(node) +
        cardLine("Label", nodeDisplayLabel(node)) +
        savedWalletRiskHtml(node) +
        secondLayerStatusBlock(node) +
        clusterNote +
        cardLine("Technical type", technicalNodeType(node));
    }
    function reciprocalFlowHtml(edge) {
      if (edge?.metadata?.reciprocalFlow !== true) return "";
      const pairKey = edge?.metadata?.reciprocalPairKey || "n/a";
      const relatedEdgeCount = asArray(edge?.metadata?.reciprocalEdgeIds).length;
      return cardBlockHtml("Reciprocal flow",
        '<div class="card-note">This pair moved funds in both directions. Treat it as circular evidence, not as a clean source resolution.</div>' +
        '<div class="card-line"><span class="muted">Pair</span><strong>' + escapeHtml(pairKey) + '</strong></div>' +
        '<div class="card-line"><span class="muted">Related edges</span><strong>' + escapeHtml(relatedEdgeCount) + '</strong></div>');
    }
    function sourcePostDebitActivityLabel(value) {
      if (!value || typeof value !== "object") return "not checked";
      const classification = value.classification && typeof value.classification === "object"
        ? value.classification
        : value;
      return classification.label || classification.status || (value.checked === true ? "checked" : "not checked");
    }
    function contractDrivenDetailBlock(edge) {
      const type = edgeEvidenceType(edge);
      if (
        type !== "contract_driven_transfer" &&
        type !== "approval_drain_transfer" &&
        type !== "contract_trigger_context"
      ) return "";
      const metadata = edge?.metadata || {};
      const relatedDebitTx = metadata.relatedDebitTxHash || metadata.debitTxHash || metadata.txHash || edge?.txHash || "";
      const proofLevel = metadata.proofLevel || (type === "contract_trigger_context" ? "context" : "n/a");
      const meaning = type === "contract_trigger_context"
        ? "Source debit routed through this spender contract. Open the transaction list to inspect the debit event."
        : type === "contract_driven_transfer"
          ? "USDT moved into the receiver through a smart-contract call. The source wallet is shown in the transaction evidence, not as a direct wallet-transfer line."
          : "USDT moved by smart-contract call";
      return cardBlockHtml("Contract-driven evidence",
        metric("Meaning", meaning, "wide") +
        metric("Method", metadata.method || "method n/a") +
        metricHtml("Caller/operator", addressDetailLink(metadata.callerAddress || metadata.operatorAddress || "")) +
        metricHtml("Spender contract", addressDetailLink(metadata.spenderAddress || metadata.contractAddress || "")) +
        metricHtml("Source wallet", addressDetailLink(metadata.sourceAddress || metadata.victimAddress || "")) +
        metricHtml("Receiver", addressDetailLink(metadata.receiverAddress || edgeToAddress(edge) || "")) +
        metricHtml("Tx", edgePrimaryTxDetailHtml(edge), "wide") +
        (relatedDebitTx ? metricHtml("Related debit tx", txDetailLink(relatedDebitTx), "wide") : "") +
        metric("Amount", edgeDetailedAmountLabel(edge) || edgeCanvasAmountLabel(edge) || "amount n/a") +
        metric("Time", edgeTime(edge) || "time n/a") +
        metric("Proof level", proofLevel) +
        metric("Source activity", sourcePostDebitActivityLabel(metadata.sourcePostDebitActivity), "wide")
      );
    }
    function selectedEdgeCard(edge) {
      if (!edge) return "";
      const rows = selectedFlowTransferRows(edge);
      return '<h3>Selected flow</h3>' +
        '<div class="selected-flow-review">' +
        selectedFlowHeaderHtml(edge, rows) +
        selectedFlowPrimaryBodyHtml(edge, rows) +
        reciprocalFlowHtml(edge) +
        selectedFlowDebugHtml(edge, rows) +
        '</div>';
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
        root.innerHTML = selectedEdgeCardBlock(edgeById(state.selected.id));
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
    function section(title, lines) {
      const body = asArray(lines).filter(Boolean).join("");
      return body ? metricHtml(title, '<div class="metric-grid">' + body + '</div>', "wide") : "";
    }
    function nodeHasOwnRisk(node) {
      const metadata = node?.metadata || {};
      return Boolean(
        metadata.savedWalletRisk ||
        metadata.walletRisk ||
        metadata.counterpartyRisk ||
        metadata.riskScope === "wallet" ||
        metadata.riskScope === "counterparty"
      );
    }
    function nodeRiskMetricBlock(node) {
      if (!nodeHasOwnRisk(node)) return "";
      const metadata = node?.metadata || {};
      if (metadata.savedWalletRisk) {
        const risk = metadata.savedWalletRisk;
        return section("Wallet risk", [
          metric("Risk score", risk.risk ?? risk.score ?? risk.riskScore ?? "n/a"),
          risk.level || risk.riskLevel ? metric("Risk level", risk.level || risk.riskLevel) : "",
          risk.role || risk.category || risk.kind ? metric("Role", risk.role || risk.category || risk.kind) : "",
          risk.evidence || risk.reason ? metric("Evidence", risk.evidence || risk.reason, "wide") : "",
          risk.source || risk.kind ? metric("Source", risk.source || risk.kind) : ""
        ]);
      }
      const risk = metadata.walletRisk || metadata.counterpartyRisk || {};
      const hasRiskScope = metadata.riskScope === "wallet" || metadata.riskScope === "counterparty";
      const title = metadata.counterpartyRisk || metadata.riskScope === "counterparty" ? "Counterparty risk" : "Wallet risk";
      return section(title, [
        metric("Risk", risk.risk ?? risk.riskLevel ?? risk.level ?? node.riskLevel ?? "n/a"),
        metric("Risk score", risk.score ?? risk.riskScore ?? risk.weight ?? (hasRiskScope ? node.weight : "n/a") ?? "n/a"),
        risk.role || risk.category || risk.kind ? metric("Role", risk.role || risk.category || risk.kind) : "",
        risk.evidence || risk.reason || risk.source ? metric("Evidence", risk.evidence || risk.reason || risk.source, "wide") : ""
      ]);
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
    function htmlListMetric(label, items, empty) {
      const values = asArray(items).filter((item) => item !== null && item !== undefined && String(item).length > 0);
      if (values.length === 0) return metricHtml(label, '<span class="muted">' + escapeHtml(empty || "n/a") + '</span>', "wide");
      return metricHtml(label, '<div class="counterparty-lines">' + values.map((item) => String(item)).join("") + '</div>', "wide");
    }
    function detailsMetric(label, items, empty) {
      const values = asArray(items).filter((item) => item !== null && item !== undefined && String(item).length > 0);
      if (values.length === 0) return "";
      return '<details class="metric wide compact-details"><summary>' + escapeHtml(label) + '<span>' + values.length + '</span></summary>' +
        listHtml(values, empty) +
        '</details>';
    }
    function strictProvenanceLines(summary) {
      const layer = summary?.layerSummary || {};
      const strict = layer.strictProvenance || null;
      const metrics = layer.strictBenchmarkMetrics || null;
      if (!strict && !metrics) return "";
      const lines = [];
      if (strict) {
        lines.push("Strict provenance: " + (strict.phase || "running"));
        lines.push("Score valid: " + (strict.scoreValid === true ? "true" : strict.scoreValid === false ? "false" : "pending"));
        if (strict.scoreBlockedReason) lines.push("Blocked reason: " + strict.scoreBlockedReason);
        if (strict.coveredHopCount !== null && strict.coveredHopCount !== undefined && strict.totalHopCount !== null && strict.totalHopCount !== undefined) {
          lines.push("Hop coverage: " + strict.coveredHopCount + "/" + strict.totalHopCount);
        }
      }
      if (metrics) {
        if (metrics.effectiveRps !== null && metrics.effectiveRps !== undefined) lines.push("Effective RPS: " + trimNumber(metrics.effectiveRps));
        if (metrics.requestCount !== null && metrics.requestCount !== undefined) lines.push("Requests: " + metrics.requestCount);
        if (metrics.apiMs !== null && metrics.apiMs !== undefined) lines.push("API time: " + trimNumber(metrics.apiMs / 1000) + "s");
        if (metrics.dbWriteMs !== null && metrics.dbWriteMs !== undefined) lines.push("DB write time: " + trimNumber(metrics.dbWriteMs / 1000) + "s");
        if (metrics.dbReadMs !== null && metrics.dbReadMs !== undefined) lines.push("DB read time: " + trimNumber(metrics.dbReadMs / 1000) + "s");
        if (metrics.traceMs !== null && metrics.traceMs !== undefined) lines.push("Trace time: " + trimNumber(metrics.traceMs / 1000) + "s");
        if (metrics.scoringMs !== null && metrics.scoringMs !== undefined) lines.push("Scoring time: " + trimNumber(metrics.scoringMs / 1000) + "s");
      }
      return detailsMetric("Strict benchmark", lines, "");
    }
    function targetedIndexLines(summary) {
      const layer = summary?.layerSummary || {};
      const targeted = layer.targetedIndex || null;
      const history = layer.targetedHistory || null;
      const balanceSlice = layer.balanceFormingSlice || null;
      if (!targeted && !history && !balanceSlice) return "";
      const lines = [];
      if (balanceSlice) {
        lines.push("Balance-forming slice: " + (balanceSlice.phase || balanceSlice.status || "running"));
        lines.push("Mode: bounded live slice, not broad targeted indexing");
        if (balanceSlice.address) lines.push("Hop address: " + balanceSlice.address);
        if (balanceSlice.targetTxHash) lines.push("Hop tx: " + balanceSlice.targetTxHash);
        if (balanceSlice.targetTimestamp) lines.push("Target timestamp: " + balanceSlice.targetTimestamp);
        if (balanceSlice.coverageRatio !== null && balanceSlice.coverageRatio !== undefined) lines.push("Coverage: " + percent(balanceSlice.coverageRatio));
        if (balanceSlice.coveredAmountRaw) lines.push("Covered amount: " + raw(balanceSlice.coveredAmountRaw));
        if (balanceSlice.fetchedPageCount !== null && balanceSlice.fetchedPageCount !== undefined) lines.push("Pages: " + balanceSlice.fetchedPageCount);
        if (balanceSlice.fetchedTransferCount !== null && balanceSlice.fetchedTransferCount !== undefined) lines.push("Transfers: " + balanceSlice.fetchedTransferCount);
        if (balanceSlice.reason) lines.push("Reason: " + String(balanceSlice.reason).replace(/_/g, " "));
        if (balanceSlice.providerCapHit !== null && balanceSlice.providerCapHit !== undefined) lines.push("Provider cap hit: " + (balanceSlice.providerCapHit ? "yes" : "no"));
        if (balanceSlice.budgetExhausted !== null && balanceSlice.budgetExhausted !== undefined) lines.push("Budget exhausted: " + (balanceSlice.budgetExhausted ? "yes" : "no"));
      }
      if (targeted?.phase === "waiting_for_targeted_index") lines.push("Waiting for targeted history, not stuck");
      if (targeted) {
        if (targeted.phase === "checking_candidate_windows") {
          const windows = targeted.candidateWindows || history?.candidateWindows || {};
          lines.push("Checking candidate windows: " + (windows.complete || 0) + "/" + (windows.total || 0) + " complete");
          if (windows.queued !== null && windows.queued !== undefined) lines.push("Candidate windows queued: " + windows.queued);
          if (windows.running !== null && windows.running !== undefined) lines.push("Candidate windows running: " + windows.running);
          if (windows.terminal !== null && windows.terminal !== undefined) lines.push("Candidate windows terminal: " + windows.terminal);
          if (targeted.broadFallback) lines.push("Broad fallback: " + String(targeted.broadFallback).replace(/_/g, " "));
        }
        lines.push("Targeted index: " + (targeted.phase || "running"));
        if (targeted.waitingForAddress) lines.push("Waiting address: " + targeted.waitingForAddress);
        if (targeted.waitingForTargetTimestamp) lines.push("Target timestamp: " + targeted.waitingForTargetTimestamp);
        if (targeted.requiredFor) lines.push("Required for: " + targeted.requiredFor);
        if (targeted.lastIndexStatus) lines.push("Last index status: " + targeted.lastIndexStatus);
        if (targeted.statusReason) lines.push("Status reason: " + targeted.statusReason);
        if (targeted.pagesFetched !== null && targeted.pagesFetched !== undefined) lines.push("Pages: " + targeted.pagesFetched);
        if (targeted.transfersFetched !== null && targeted.transfersFetched !== undefined) lines.push("Transfers: " + targeted.transfersFetched);
        if (targeted.uniqueCanonicalHashCount !== null && targeted.uniqueCanonicalHashCount !== undefined) {
          lines.push("Unique hashes: " + targeted.uniqueCanonicalHashCount + (targeted.repeatRatio !== null && targeted.repeatRatio !== undefined ? " / repeat " + ratioPercent(targeted.repeatRatio) : ""));
        }
        if (targeted.oldestFetchedTransferAt) lines.push("Oldest fetched: " + targeted.oldestFetchedTransferAt);
        if (targeted.newestFetchedTransferAt) lines.push("Newest fetched: " + targeted.newestFetchedTransferAt);
        if (targeted.budgetPages !== null && targeted.budgetPages !== undefined) lines.push("Budget pages: " + targeted.budgetPages);
        if (targeted.attemptCount !== null && targeted.attemptCount !== undefined) lines.push("Attempt: " + targeted.attemptCount + "/" + (targeted.maxAttempts || "?"));
        if (targeted.retryCount !== null && targeted.retryCount !== undefined) lines.push("Retries: " + targeted.retryCount);
        if (targeted.requestCount !== null && targeted.requestCount !== undefined) lines.push("Requests: " + targeted.requestCount);
        if (targeted.rateLimitedCount !== null && targeted.rateLimitedCount !== undefined) lines.push("429/rate limits: " + targeted.rateLimitedCount);
        if (targeted.forbiddenCount !== null && targeted.forbiddenCount !== undefined) lines.push("403: " + targeted.forbiddenCount);
        if (targeted.serverErrorCount !== null && targeted.serverErrorCount !== undefined) lines.push("5xx: " + targeted.serverErrorCount);
        if (targeted.providerCapHit !== null && targeted.providerCapHit !== undefined) lines.push("Provider cap hit: " + (targeted.providerCapHit ? "yes" : "no"));
        if (targeted.budgetExhausted !== null && targeted.budgetExhausted !== undefined) lines.push("Budget exhausted: " + (targeted.budgetExhausted ? "yes" : "no"));
      }
      if (history) {
        const states = asArray(history.states);
        const total = history.totalTargetedStates ?? states.length;
        lines.push("States: total " + total +
          ", queued " + (history.queuedCount ?? 0) +
          ", running " + (history.runningCount ?? 0) +
          ", complete " + (history.completeCount ?? 0) +
          ", partial " + (history.partialCount ?? 0) +
          ", failed " + (history.failedCount ?? 0));
        if (history.fetchedPageCount !== null && history.fetchedPageCount !== undefined) lines.push("Total pages: " + history.fetchedPageCount);
        if (history.fetchedTransferCount !== null && history.fetchedTransferCount !== undefined) lines.push("Total transfers: " + history.fetchedTransferCount);
        if (history.uniqueCanonicalHashCount !== null && history.uniqueCanonicalHashCount !== undefined) {
          lines.push("Unique hashes: " + history.uniqueCanonicalHashCount + (history.repeatRatio !== null && history.repeatRatio !== undefined ? " / repeat " + ratioPercent(history.repeatRatio) : ""));
        }
        if (history.oldestTransferAt) lines.push("Oldest reached: " + history.oldestTransferAt);
        if (history.newestTransferAt) lines.push("Newest seen: " + history.newestTransferAt);
        if (history.maxBudgetPages !== null && history.maxBudgetPages !== undefined) lines.push("Max budget pages: " + history.maxBudgetPages);
        if (history.requestCount !== null && history.requestCount !== undefined) lines.push("Total requests: " + history.requestCount);
        if (history.rateLimitedCount !== null && history.rateLimitedCount !== undefined) lines.push("Total 429/rate limits: " + history.rateLimitedCount);
        if (history.forbiddenCount !== null && history.forbiddenCount !== undefined) lines.push("Total 403: " + history.forbiddenCount);
        if (history.serverErrorCount !== null && history.serverErrorCount !== undefined) lines.push("Total 5xx: " + history.serverErrorCount);
        if (history.providerCapHit !== null && history.providerCapHit !== undefined) lines.push("Any provider cap hit: " + (history.providerCapHit ? "yes" : "no"));
        if (history.budgetExhausted !== null && history.budgetExhausted !== undefined) lines.push("Any budget exhausted: " + (history.budgetExhausted ? "yes" : "no"));
        if (history.providerInconsistent !== null && history.providerInconsistent !== undefined) lines.push("Any provider inconsistent: " + (history.providerInconsistent ? "yes" : "no"));
        if (history.staleRunningCount) lines.push("Stale running locks: " + history.staleRunningCount);
        states.slice(0, 8).forEach((state) => {
          if (!state || typeof state !== "object") return;
          const address = state.address || "unknown";
          const status = state.status || state.waitStatus || "unknown";
          const reason = state.statusReason || "no_reason";
          lines.push("State: " + address + " / " + status + " / " + reason);
          const stateProgress = [];
          if (state.fetchedPageCount !== null && state.fetchedPageCount !== undefined) stateProgress.push(state.fetchedPageCount + " pages");
          if (state.fetchedTransferCount !== null && state.fetchedTransferCount !== undefined) stateProgress.push(state.fetchedTransferCount + " transfers");
          if (state.uniqueCanonicalHashCount !== null && state.uniqueCanonicalHashCount !== undefined) stateProgress.push(state.uniqueCanonicalHashCount + " unique hashes");
          if (state.repeatRatio !== null && state.repeatRatio !== undefined) stateProgress.push("repeat " + ratioPercent(state.repeatRatio));
          if (state.budgetPages !== null && state.budgetPages !== undefined) stateProgress.push("budget " + state.budgetPages);
          if (stateProgress.length > 0) lines.push("State progress: " + stateProgress.join(", "));
          if (state.oldestTransferAt || state.newestTransferAt) lines.push("State dates: " + (state.oldestTransferAt || "?") + " -> " + (state.newestTransferAt || "?"));
          if (state.attemptCount !== null && state.attemptCount !== undefined) lines.push("State attempt: " + state.attemptCount + "/" + (state.maxAttempts || "?"));
          if (state.retryCount !== null && state.retryCount !== undefined) lines.push("State retries: " + state.retryCount);
          if (state.lockOwner || state.lockedUntil) lines.push("Lock: " + (state.lockOwner || "unknown") + " until " + (state.lockedUntil || "unknown"));
          if (state.nextRunAt) lines.push("Next retry: " + state.nextRunAt);
          if (state.lastError) lines.push("Last error: " + state.lastError);
        });
        if (states.length > 8) lines.push("More states: " + (states.length - 8));
      }
      return detailsMetric("Targeted history", lines, "");
    }
    function whereFundingCandidateLines(summary) {
      const layer = summary?.layerSummary || {};
      const visibility = layer.whereFundingCandidateVisibility || null;
      if (!visibility) return "";
      const lines = [];
      lines.push("Exact funding candidates shown " + (visibility.exactShownCount ?? 0) + "/" + (visibility.exactTotalCount ?? 0));
      lines.push("Probable candidates shown " + (visibility.probableShownCount ?? 0) + "/" + (visibility.probableTotalCount ?? 0));
      lines.push("Grouped low-signal candidates " + (visibility.groupedHiddenCount ?? 0));
      lines.push("Unresolved source caveats " + (visibility.unresolvedCaveatCount ?? 0));
      lines.push("Pre-existing balance caveats " + (visibility.preExistingBalanceCaveatCount ?? 0));
      lines.push("Service boundaries " + (visibility.serviceBoundaryCount ?? 0));
      lines.push("Max proven route depth " + (visibility.maxProvenRouteDepth ?? 0));
      return detailsMetric("Where funding candidates", lines, "");
    }
    function internalLinkListHtml(items, empty) {
      const values = asArray(items).filter((item) => item !== null && item !== undefined && String(item).length > 0);
      if (values.length === 0) return '<span class="muted">' + escapeHtml(empty || "n/a") + '</span>';
      return '<span class="list-lines">' + values.map((item) => '<span>' + String(item) + '</span>').join("") + '</span>';
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
    function transferObjectListHtml(transfers, empty) {
      const values = asArray(transfers).filter((item) => item && typeof item === "object");
      if (values.length === 0) return '<span class="muted">' + escapeHtml(empty || "No transfer rows stored.") + '</span>';
      return '<div class="tx-lines">' + values.map((item) => {
        const amount = formatRawUsdt(item?.amountRaw) || item?.amountRaw || "amount n/a";
        const time = canvasTimestampLabel(item?.timestamp) || item?.timestamp || "time n/a";
        const from = item?.fromAddress ? explorerLink(tronscanAddressUrl(item.fromAddress), short(item.fromAddress, 7)) : '<span class="muted">from n/a</span>';
        const to = item?.toAddress ? explorerLink(tronscanAddressUrl(item.toAddress), short(item.toAddress, 7)) : '<span class="muted">to n/a</span>';
        const tx = item?.txHash ? explorerLink(tronscanTxUrl(item.txHash), short(item.txHash, 8)) : '<span class="muted">tx n/a</span>';
        return '<div class="tx-line tx-card">' +
          '<div class="tx-main"><strong>' + escapeHtml(amount) + '</strong><span class="tx-time">' + escapeHtml(time) + '</span></div>' +
          '<div class="tx-route compact"><span>' + from + '</span><span class="tx-arrow">&rarr;</span><span>' + to + '</span></div>' +
          '<div class="tx-meta compact"><div><span>tx ' + tx + '</span></div><span class="tx-verdict">' + escapeHtml(item?.role || item?.method || "") + '</span></div>' +
          '</div>';
      }).join("") + '</div>';
    }
    function edgeTransactionEvidenceHtml(edge) {
      const transfers = asArray(edge?.metadata?.underlyingTransfers);
      if (transfers.length > 0) return transferObjectListHtml(transfers, "No underlying transfer rows stored.");
      const hashes = edgeTxHashes(edge);
      if (hashes.length === 0) return '<span class="muted">No tx hashes stored.</span>';
      const count = edgeAggregateTransferCount(edge) || hashes.length;
      const amount = edgeAggregateAmountLabel(edge) || edgeDetailedAmountLabel(edge) || edgeCanvasAmountLabel(edge) || "amount n/a";
      const time = edgeTime(edge) || "time n/a";
      const summary = count + " tx - " + amount + " - " + time;
      const note = edgeHasAggregatedTxEvidence(edge)
        ? '<div class="tx-summary-note">Grouped connection: this old/result edge stores tx hashes and aggregate amount. Per-tx amounts may require a rerun or stored transfer rows.</div>'
        : "";
      return '<div class="tx-lines"><div class="tx-line">' +
        '<div class="tx-main"><strong>' + escapeHtml(summary) + '</strong></div>' +
        '<div class="tx-route">' + endpointDetailLink(edge, "from") + ' -> ' + endpointDetailLink(edge, "to") + '</div>' +
        txHashLinksHtml(hashes) +
        note +
        '</div></div>';
    }
    function transferListHtml(edges, empty) {
      const values = asArray(edges);
      if (values.length === 0) return '<span class="muted">' + escapeHtml(empty || "n/a") + '</span>';
      return '<div class="tx-lines">' + values.map((edge) => {
        const amount = edgeDetailedAmountLabel(edge) || "amount n/a";
        const time = canvasTimestampLabel(edge?.timestamp || edgeTime(edge)) || edgeTime(edge) || "time n/a";
        const gap = edgeTxGap(edge);
        const from = explorerLink(edgeFromTronScanUrl(edge), short(edgeFromAddress(edge), 7));
        const to = explorerLink(edgeToTronScanUrl(edge), short(edgeToAddress(edge), 7));
        const txHash = edgePrimaryTxHash(edge);
        const tx = txHash
          ? '<span>tx ' + explorerLink(edgeTxTronScanUrl(edge), short(txHash, 6)) + '</span>'
          : txHashLinksHtml(edgeTxHashes(edge), 20);
        return '<div class="tx-line tx-card">' +
          '<div class="tx-main"><strong>' + escapeHtml(amount) + '</strong><span class="tx-time">' + escapeHtml(time) + '</span></div>' +
          '<div class="tx-route compact"><span>' + from + '</span><span class="tx-arrow">&rarr;</span><span>' + to + '</span></div>' +
          '<div class="tx-meta compact"><div>' + tx + '</div><span class="tx-verdict">' + escapeHtml(edge.verdict || "unknown") + '</span></div>' +
          (gap ? '<div><span class="tx-gap-chip">gap ' + escapeHtml(gap) + '</span></div>' : '') +
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
    function bundleInternalEdgeLines(node, graph) {
      const relatedEdgeIds = new Set(asArray(node?.metadata?.relatedEdgeIds));
      const memberAddresses = new Set(asArray(node?.metadata?.topFunders).map((item) => item.address).filter(Boolean));
      const edges = graphEdges(graph).filter((edge) => {
        const fromAddress = edgeFromAddress(edge);
        const toAddress = edgeToAddress(edge);
        if (relatedEdgeIds.has(edge.id) && memberAddresses.has(fromAddress) && memberAddresses.has(toAddress)) return true;
        return memberAddresses.has(fromAddress) && memberAddresses.has(toAddress);
      });
      return edges.map((edge) => {
        const amount = edgeDetailedAmountLabel(edge) || edgeAmount(edge) || "amount n/a";
        const time = edgeTime(edge) || "time n/a";
        return short(edgeFromAddress(edge), 7) + " -> " + short(edgeToAddress(edge), 7) + " / " + amount + " / " + time;
      });
    }
    function bundleExternalEdgeLines(node, graph) {
      const relatedEdgeIds = new Set(asArray(node?.metadata?.relatedEdgeIds));
      return graphEdges(graph)
        .filter((edge) => relatedEdgeIds.has(edge.id) || edge.fromNodeId === node.id || edge.toNodeId === node.id)
        .map((edge) => {
          const amount = edgeDetailedAmountLabel(edge) || edgeAmount(edge) || "amount n/a";
          const from = bundleEndpointLabel(node, edge.fromNodeId, edgeFromAddress(edge));
          const to = bundleEndpointLabel(node, edge.toNodeId, edgeToAddress(edge));
          const txHash = edgePrimaryTxHash(edge);
          const tx = txHash ? " / tx " + short(txHash, 7) : "";
          return short(from, 7) + " -> " + short(to, 7) + " / " + amount + tx;
        });
    }
    function bundleEndpointLabel(node, nodeId, fallback) {
      if (nodeId === node?.id || String(nodeId || "").startsWith("bundle:")) return "Funding bundle";
      return fallback || nodeDisplayLabel(nodeById(nodeId)) || String(nodeId || "unknown");
    }
    function groupKindExplanation(node) {
      if (node?.metadata?.uiCollapsedGroup === true) return "This is a UI-collapsed display group, not a wallet.";
      if (nodeDisplayKind(node) === "funding_bundle") return "This is a saved funding bundle, not a wallet.";
      return "This is a graph group, not a wallet.";
    }
    function groupHiddenNodeLines(node) {
      return asArray(node?.metadata?.hiddenNodeIds).slice(0, 40).map((nodeId) => {
        const hidden = nodeById(nodeId);
        return (hidden ? canvasNodeLabel(hidden) : short(nodeId, 7)) + " / " + nodeId;
      });
    }
    function groupDetailBlock(node, graph) {
      const count = node?.metadata?.collapsedCount ?? node?.metadata?.memberCount ?? "n/a";
      return '<div class="metric-grid">' +
        analystIntroBlock("What this group means", groupKindExplanation(node), [
          analystBadge("Display group", "grouped")
        ]) +
        metricHtml("Selected", typeChip("Display group", "bundle")) +
        metric("Meaning", groupKindExplanation(node), "wide") +
        metric("Why grouped", node?.metadata?.groupReason || "Lower-priority nodes were grouped so the route remains readable.", "wide") +
        metric("Group type", node?.metadata?.realGroupKind || "ui_collapsed_display_group") +
        metric("Members", count) +
        metric("Role", node?.metadata?.stepOrbitRole || node?.metadata?.clusterRole || "context") +
        metric("Expansion rule", "Deep-check context can only expand stored groups, bundles, and known links.", "wide") +
        '<button type="button" class="wide detail-action" data-action="expand-bundle">Expand selected</button>' +
        listMetric("Wallets/stops inside", groupHiddenNodeLines(node), "No hidden node list stored.") +
        listMetric("Known internal links", bundleInternalEdgeLines(node, graph), "Internal transfers were not found in saved graph data.") +
        listMetric("External links", bundleExternalEdgeLines(node, graph), "No external links stored.") +
        rawBlock("Group JSON", node) +
        '</div>';
    }
    function bundleDetailBlock(node, graph) {
      const type = nodeType(node);
      const relatedPathIds = new Set(asArray(node.metadata?.relatedPathIds));
      const relatedPaths = graphPaths(graph).filter((path) => relatedPathIds.has(path.id) || asArray(path.nodeIds).includes(node.id));
      const covered = formatRawUsdt(node.metadata?.coveredAmountRaw || node.metadata?.bundleAmountRaw) || node.metadata?.coveredAmountRaw || node.metadata?.bundleAmountRaw || "n/a";
      const target = formatRawUsdt(node.metadata?.expectedAmountRaw || node.metadata?.targetAmountRaw) || node.metadata?.expectedAmountRaw || node.metadata?.targetAmountRaw || "n/a";
      const tail = node.metadata?.smallTailAmountRaw ? formatRawUsdt(node.metadata.smallTailAmountRaw) || node.metadata.smallTailAmountRaw : "n/a";
      return '<div class="metric-grid">' +
        analystIntroBlock("What this bundle means", groupKindExplanation(node), [
          analystBadge("Funding bundle", "grouped")
        ]) +
        metricHtml("Selected", typeChip(type.label, type.cls)) +
        metric("Meaning", groupKindExplanation(node), "wide") +
        metric("Path", node.metadata?.pathId || "n/a") +
        metric("Coverage", percent(node.metadata?.coverageRatio)) +
        metric("Covered amount", covered) +
        metric("Target amount", target) +
        metric("Top funders", node.metadata?.funderCount ?? "n/a") +
        metric("Members", node.metadata?.memberCount ?? "n/a") +
        metric("Small tail", (node.metadata?.smallTailCount ?? 0) + " funder(s) / " + tail) +
        metric("Hop/target tx", node.metadata?.hopTxHash || node.metadata?.targetTxHash || "n/a", "wide") +
        '<button type="button" class="wide detail-action" data-action="expand-bundle">Expand bundle</button>' +
        listMetric("Top funders", bundleFunderLines(node), "No top funders stored.") +
        listMetric("Known internal links", bundleInternalEdgeLines(node, graph), "Internal transfers were not found in saved graph data.") +
        listMetric("External links", bundleExternalEdgeLines(node, graph), "No external links stored.") +
        listMetric("Path context", pathLines(relatedPaths), "No related paths in this graph.") +
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
        listMetric("DeepCheck coverage", deepCheckCoverageLines(summary), "No DeepCheck coverage summary stored.") +
        listMetric("Projection gaps", projectionGapLines(graph), "No projection gaps stored.") +
        listMetric("Path timing", pathTimingLines(graph), "No path timing stored.") +
        listMetric("Why", asArray(summary.topReasons), "No top reasons stored.") +
        listMetric("Warnings", asArray(summary.warnings), "No warnings stored.") +
        listMetric("Risk layers", riskLayerLines(summary), "No risk layers stored.") +
        listMetric("Stop reasons", stopReasonLines(summary), "No stopped paths.");
    }
    function deepCheckCoverageLines(summary) {
      const coverage = summary?.layerSummary?.deepCheckCoverage;
      if (!coverage || typeof coverage !== "object") return [];
      const lines = [];
      if (coverage.directCounterpartiesAnalyzed !== null && coverage.directCounterpartiesAnalyzed !== undefined) {
        lines.push(coverage.directCounterpartiesAnalyzed + " direct counterparties analyzed");
      }
      if (coverage.directCounterpartiesExpanded !== null && coverage.directCounterpartiesExpanded !== undefined) {
        lines.push(coverage.directCounterpartiesExpanded + " counterparties expanded");
      }
      if (coverage.transferEdgesCollected !== null && coverage.transferEdgesCollected !== undefined) {
        lines.push(coverage.transferEdgesCollected + " transfer edges collected");
      }
      if (coverage.directWalletsCount !== null && coverage.directWalletsCount !== undefined) {
        lines.push(coverage.directWalletsCount + " direct wallets counted");
      }
      if (coverage.renderedDirectEdges !== null && coverage.renderedDirectEdges !== undefined) {
        lines.push(coverage.renderedDirectEdges + " direct subject edges rendered");
      }
      if (coverage.extendedPathsCount !== null && coverage.extendedPathsCount !== undefined) {
        lines.push(coverage.extendedPathsCount + " saved extended paths");
      }
      if (coverage.renderedExtendedEdges !== null && coverage.renderedExtendedEdges !== undefined) {
        lines.push(coverage.renderedExtendedEdges + " extended path edges rendered");
      }
      if (coverage.maxSavedDepth !== null && coverage.maxSavedDepth !== undefined) {
        lines.push("Max saved path depth: " + coverage.maxSavedDepth);
      }
      if (coverage.stopReasonsCount !== null && coverage.stopReasonsCount !== undefined) {
        lines.push(coverage.stopReasonsCount + " saved stop reasons / limitations");
      }
      if (coverage.extendedAddressesFetched !== null && coverage.extendedAddressesFetched !== undefined) {
        lines.push(coverage.extendedAddressesFetched + " extended addresses fetched");
      }
      if (coverage.boundaryStopCount !== null && coverage.boundaryStopCount !== undefined) {
        lines.push(coverage.boundaryStopCount + " expansion stops / limitations");
      }
      if (coverage.metadataEnrichmentLimited) {
        lines.push("service metadata enrichment was limited");
      }
      const allTime = coverage.allTimeCoverage && typeof coverage.allTimeCoverage === "object"
        ? coverage.allTimeCoverage
        : null;
      const hasValue = (value) => value !== null && value !== undefined;
      if (allTime) {
        const indexParts = [];
        if (hasValue(allTime.mode)) indexParts.push("mode " + allTime.mode);
        if (hasValue(allTime.subjectIndexStatus)) indexParts.push("status " + allTime.subjectIndexStatus);
        if (hasValue(allTime.subjectCoverageMode)) indexParts.push("coverage " + allTime.subjectCoverageMode);
        if (hasValue(allTime.subjectAllTimeComplete)) {
          indexParts.push(allTime.subjectAllTimeComplete ? "complete" : "not complete");
        }
        if (indexParts.length > 0) lines.push("All-time subject index: " + indexParts.join(", "));
        if (hasValue(allTime.subjectTransfersFetched)) {
          lines.push("All-time subject transfers fetched: " + allTime.subjectTransfersFetched);
        }
        if (hasValue(allTime.subjectUniqueDirectWallets)) {
          lines.push("All-time direct wallets: " + allTime.subjectUniqueDirectWallets);
        }

        const hardEvidenceParts = [];
        if (hasValue(allTime.directWalletsHardEvidenceChecked)) {
          hardEvidenceParts.push(allTime.directWalletsHardEvidenceChecked + " checked");
        }
        if (hasValue(allTime.directWalletsHardEvidenceLiveChecked)) {
          hardEvidenceParts.push(allTime.directWalletsHardEvidenceLiveChecked + " live checked");
        }
        if (hasValue(allTime.directHardEvidenceStatus)) {
          hardEvidenceParts.push("status " + allTime.directHardEvidenceStatus);
        }
        if (hardEvidenceParts.length > 0) {
          lines.push("Direct hard evidence: " + hardEvidenceParts.join(", "));
        }

        if (hasValue(allTime.providerCapHit) || hasValue(allTime.providerInconsistent)) {
          const providerFlags = [];
          if (allTime.providerCapHit) providerFlags.push("provider cap hit");
          if (allTime.providerInconsistent) providerFlags.push("provider inconsistent");
          lines.push("Provider flags: " + (providerFlags.join(", ") || "none"));
        }

      }
      const secondLayerPaths = hasValue(coverage.secondLayerRelationshipPaths)
        ? coverage.secondLayerRelationshipPaths
        : allTime && hasValue(allTime.secondLayerRelationshipPaths)
          ? allTime.secondLayerRelationshipPaths
          : null;
      const secondLayerGroups = hasValue(coverage.secondLayerRelationshipGroups)
        ? coverage.secondLayerRelationshipGroups
        : allTime && hasValue(allTime.secondLayerRelationshipGroups)
          ? allTime.secondLayerRelationshipGroups
          : null;
      const secondLayerQueued = hasValue(coverage.secondLayerQueued)
        ? coverage.secondLayerQueued
        : allTime && hasValue(allTime.secondLayerQueued)
          ? allTime.secondLayerQueued
          : null;
      const secondLayerComplete = hasValue(coverage.secondLayerComplete)
        ? coverage.secondLayerComplete
        : allTime && hasValue(allTime.secondLayerComplete)
          ? allTime.secondLayerComplete
          : null;
      if ([secondLayerPaths, secondLayerGroups, secondLayerQueued, secondLayerComplete].some(hasValue)) {
        lines.push("Second-layer relationships: paths " + raw(secondLayerPaths) +
          ", groups " + raw(secondLayerGroups) +
          ", queued " + raw(secondLayerQueued) +
          ", complete " + raw(secondLayerComplete));
      }
      return lines;
    }
    function nodeIntelligenceEvidenceLabel(value) {
      if (value === "hard") return "Hard evidence";
      if (value === "behavior") return "Behavior marker";
      if (value === "context") return "Context marker";
      return "n/a";
    }
    function nodeIntelligenceBlock(node) {
      const intelligence = node?.metadata?.nodeIntelligence;
      if (!intelligence || typeof intelligence !== "object") {
        return metric("Node role", "No role marker", "wide");
      }

      const evidence = nodeIntelligenceEvidenceLabel(intelligence.evidenceStrength);
      const confidence = intelligence.confidence === null || intelligence.confidence === undefined
        ? "n/a"
        : String(intelligence.confidence);
      const safetyNote = intelligence.evidenceStrength === "hard"
        ? ""
        : " This is a behavior marker, not final risk proof by itself.";

      return metricHtml("Node role", typeChip(intelligence.label || intelligence.role || "Role", "wallet"), "wide") +
        metric("Evidence", evidence + " - confidence " + confidence, "wide") +
        metric("Role source", intelligence.source || "unknown", "wide") +
        metric("Why", (intelligence.explanation || "No explanation stored.") + safetyNote, "wide") +
        listMetric("Role signals", asArray(intelligence.signals), "No source signals stored.");
    }
    function localWalletProfile(node) {
      const value = node?.metadata?.localRiskProfile;
      return value && typeof value === "object" ? value : null;
    }
    function localWalletProfileBlock(node) {
      if (!node || node.kind !== "wallet") return "";
      const profile = localWalletProfile(node);
      if (!profile) {
        return section("Local wallet profile", [
          metric("Local risk", "unknown"),
          metric("Why", "Connected by the observed graph; no local risk evidence is stored for this wallet.", "wide"),
          metric("Source", "DeepCheck"),
          metric("Scope", "observed graph")
        ]);
      }
      const risk = profile.localRisk === null || profile.localRisk === undefined ? "unknown" : profile.localRisk;
      const reason = profile.reason ||
        (risk === "unknown" ? "No local risk evidence is stored for this wallet." : "Stored local wallet-risk profile.");
      return section("Local wallet profile", [
        metric("Local risk", risk),
        metric("Why", reason, "wide"),
        metric("Source", profile.source || "DeepCheck"),
        metric("Source mode", profile.sourceMode || "unknown"),
        metric("Scope", profile.scope || "observed graph"),
        metric("Relationship", profile.relationshipType || "observed graph"),
        metric("Amount share", profile.amountShare === null || profile.amountShare === undefined ? "n/a" : percent(Number(profile.amountShare))),
        metric("Tx count", profile.txCount ?? "n/a"),
        metric("Freshness", profile.freshness || "n/a")
      ]);
    }
    function drainerCampaignBlock(node) {
      const campaign = node?.metadata?.drainerCampaign;
      if (!campaign || typeof campaign !== "object") return "";
      return section("Drainer campaign evidence", [
        metric("Contract-driven transfers", campaign.txCount ?? "n/a"),
        metric("Victims", campaign.victimCount ?? "n/a"),
        metric("Spender contracts", campaign.spenderContractCount ?? "n/a"),
        metric("Operators", campaign.operatorCount ?? "n/a"),
        metric("Total amount", formatRawUsdt(campaign.totalAmountRaw) || raw(campaign.totalAmountRaw)),
        metric("First seen", campaign.firstSeen || "n/a"),
        metric("Last seen", campaign.lastSeen || "n/a"),
        listMetric("Drain txs", asArray(campaign.drainTxHashes), "No drain tx hashes stored.")
      ]);
    }
    function traceStopReasonCode(node) {
      return node?.metadata?.stopReason ||
        node?.metadata?.reason ||
        node?.metadata?.stoppedReason ||
        (node ? stopBadgeReason(node) : "") ||
        node?.label ||
        "";
    }
    function traceStopBoolean(node, key) {
      const direct = node?.metadata?.[key];
      if (typeof direct === "boolean") return direct;
      const detail = firstStopDetail(node);
      return typeof detail?.[key] === "boolean" ? detail[key] : null;
    }
    function traceStopInvestigationHistoryLabel(node) {
      const value = traceStopBoolean(node, "historyFullyFetched");
      if (value === true) return "Complete";
      if (value === false) return "Incomplete";
      return "Unknown";
    }
    function traceStopHopSufficiencyLabel(node) {
      const value = traceStopBoolean(node, "enoughHistoryForHop");
      if (value === true) return "Enough for displayed hop";
      if (value === false) return "Not enough to continue";
      return "Unknown";
    }
    function traceStopBoundaryCopyHtml(node) {
      return cardBlockHtml("Investigation stop",
        '<div class="metric-grid">' +
        metric("Investigation history", traceStopInvestigationHistoryLabel(node)) +
        metric("This hop", traceStopHopSufficiencyLabel(node)) +
        metric("Meaning", "Not a money-flow edge. This is a data/continuation boundary.", "wide") +
        '</div>'
      );
    }
    function traceStopCoverageExplanation(node) {
      const reason = traceStopReasonCode(node);
      if (reason === "incoming_history_not_fetched") {
        return "We found a transfer into the checked wallet, then tried to inspect the sender's earlier funding. The fetched incoming history did not give enough evidence to prove where that sender got the money. This is a coverage limit, not proof of bad origin.";
      }
      if (reason === "service_boundary" || reason === "unlabeled_service_boundary") {
        return "The trace reached service, exchange, bridge, DEX, or contract infrastructure. Public-chain wallet-to-wallet continuity stops here unless there is stronger source evidence.";
      }
      if (reason === "data_budget_exhausted") {
        return "The trace stopped because the configured fetch budget was reached before a stronger source conclusion was found.";
      }
      if (reason === "no_previous_transfer" || reason === "no_incoming_transfers_seen") {
        return "The trace did not find a reliable earlier incoming funding transfer before this hop.";
      }
      return "The investigation stopped here because the next step could not be proven with available graph data.";
    }
    function traceStopPossibleCauseLines(node) {
      const reason = traceStopReasonCode(node);
      if (reason !== "incoming_history_not_fetched") return [];
      return [
        "the address is very active",
        "the provider or index did not return the needed part of history",
        "the page or request budget was reached",
        "no reliable earlier funding transfer was found before the hop being checked"
      ];
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
        traceStopBoundaryCopyHtml(node) +
        metric("Meaning", stopNodeMeaning(node), "wide") +
        metric("Coverage explanation", traceStopCoverageExplanation(node), "wide") +
        listMetric("Possible causes", traceStopPossibleCauseLines(node), "No specific cause list stored.") +
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
    function boundaryIdentityEvidenceText(value) {
      const identity = boundaryIdentityOf(value) || (value && typeof value === "object" ? value : null);
      const evidence = asArray(identity?.evidence).filter((item) => item !== null && item !== undefined && String(item).length > 0);
      return evidence.length > 0 ? evidence.join(" / ") : "No identity evidence stored.";
    }
    function boundaryIdentitySourceLabel(value) {
      const identity = boundaryIdentityOf(value) || (value && typeof value === "object" ? value : null);
      return identity?.source || value?.metadata?.boundaryIdentitySource || "unknown";
    }
    function boundaryMeaningLabel(value) {
      const identity = boundaryIdentityOf(value) || (value && typeof value === "object" ? value : null);
      const summary = value?.metadata?.boundaryEvidenceSummary && typeof value.metadata.boundaryEvidenceSummary === "object"
        ? value.metadata.boundaryEvidenceSummary
        : {};
      const category = String(
        identity?.category ||
        value?.metadata?.boundaryCategory ||
        summary.category ||
        asArray(summary.categories)[0] ||
        value?.displayKind ||
        ""
      ).toLowerCase();
      if (category === "cex" || category === "hot_wallet") return "Exchange/service boundary. Public-chain continuity after this point is limited.";
      if (category === "bridge" || category === "bridge_pool") return "Bridge boundary. Chain continuity needs explicit follow-on evidence.";
      if (category === "dex" || category === "router" || category === "swap_adapter") return "DEX/router boundary. This is service context, not direct ownership proof.";
      if (category === "unknown_contract" || category === "contract") return "Contract boundary. Manual review is required before treating this as clean or dirty.";
      return "Service boundary context. This is not proof of common ownership by itself.";
    }
    function boundaryObservedSummary(node) {
      const summary = node?.metadata?.boundaryEvidenceSummary && typeof node.metadata.boundaryEvidenceSummary === "object"
        ? node.metadata.boundaryEvidenceSummary
        : {};
      const transferCount = summary.transferCount ??
        summary.aggregateTransferCount ??
        node?.metadata?.connectedTransferCount ??
        (asArray(summary.underlyingTransfers).length || "n/a");
      const amountRaw = summary.totalAmountRaw ??
        summary.boundaryAmountRaw ??
        node?.metadata?.boundaryAmountRaw ??
        node?.metadata?.volumeRaw ??
        node?.metadata?.incomingAmountRaw ??
        node?.metadata?.outgoingAmountRaw;
      const directions = asArray(summary.directions);
      const depths = asArray(summary.depths);
      const direction = summary.direction ?? (directions.length > 0 ? directions.join(" / ") : node?.metadata?.direction ?? "n/a");
      const depth = summary.depth ?? (depths.length > 0 ? depths.join(" / ") : node?.metadata?.depth ?? "n/a");
      return metric("Observed transfers", transferCount) +
        metric("Observed amount", formatRawUsdt(amountRaw) || raw(amountRaw)) +
        metric("Direction", direction) +
        metric("Depth", depth);
    }
    function boundaryIdentityBlock(
      node,
      title = "Boundary identity",
      meaningLabel = "Boundary meaning",
      name = boundaryIdentityName(node),
      category = boundaryIdentityCategoryLabel(node),
      confidence = boundaryIdentityConfidenceLabel(node)
    ) {
      const identity = boundaryIdentityOf(node);
      if (!identity && !nodeIsServiceLike(node)) return "";
      return section(title, [
        metric("Entity", name || nodeDisplayLabel(node) || "unknown"),
        metric("Type", category || technicalNodeType(node) || "unknown"),
        metric("Confidence", confidence || "unknown"),
        metric("Source", boundaryIdentitySourceLabel(node)),
        metric("Evidence", boundaryIdentityEvidenceText(node), "wide"),
        metric(meaningLabel, boundaryMeaningLabel(node), "wide"),
        boundaryObservedSummary(node)
      ]);
    }
    function walletDetailBlock(node, graph) {
      if (!node) return '<div class="empty">No wallet found.</div>';
      if (node.kind === "stop" || nodeDisplayKind(node) === "trace_stop") return traceStopDetailBlock(node, graph);
      if (nodeDisplayKind(node) === "collapsed_group") return groupDetailBlock(node, graph);
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
      const clusterRole = walletClusterNodeRoleLabel(node);
      const clusterNote = clusterRole
        ? metric("DeepCheck wallet-cluster role", clusterRole, "wide") +
          metric("Wallet-cluster note", walletClusterNodeContextNote(node), "wide")
        : "";
      return '<div class="metric-grid">' +
        analystIntroBlock("Why this node appears", nodeAnalystMeaning(node), [
          analystBadge(type.label, nodeIsServiceLike(node) ? "boundary" : node.kind === "bundle" ? "grouped" : "context")
        ]) +
        metricHtml("Selected", typeChip(type.label, type.cls)) +
        nodeIntelligenceBlock(node) +
        nodeRiskMetricBlock(node) +
        localWalletProfileBlock(node) +
        drainerCampaignBlock(node) +
        metricHtml("Address", addressDetailLink(nodeAddress(node) || node.id), "wide") +
        boundaryIdentityBlock(node, "Boundary identity", "Boundary meaning", boundaryIdentityName(node), boundaryIdentityCategoryLabel(node), boundaryIdentityConfidenceLabel(node)) +
        clusterNote +
        metric("Technical type", technicalNodeType(node)) +
        metric("Technical name", technicalNodeName(node)) +
        metric("Visible incoming", incomingAmount) +
        metric("Visible outgoing", outgoingAmount) +
        metric("Connected transfers", node.metadata?.connectedTransferCount ?? relatedEdges.length) +
        metric("Related paths", relatedPaths.length) +
        (node.kind === "subject" ? subjectReportBlock(node, graph) : "") +
        listMetric("Path context", pathLines(relatedPaths), "No related paths in this graph.") +
        transferListMetric("Transactions", transactionEdges, "No related transactions in this graph.") +
        listMetric("Weights", weightLines(relatedWeights), "No related weights.") +
        listMetric("Trace stop", stopDetailLines(node.metadata?.stopDetails), "Trace did not stop on this wallet.") +
        analystMetricRawFactsBlock(type.label + " raw facts", [
          metric("Technical type", technicalNodeType(node)),
          metric("Technical name", technicalNodeName(node)),
          metric("Related paths", relatedPaths.length)
        ]) +
        rawBlock(type.label + " JSON", node) +
        '</div>';
    }
    function transferDetailBlock(edge) {
      if (!edge) return '<div class="empty">No transfer found.</div>';
      const walletClusterEdge = walletClusterEdgeLabel(edge);
      const walletClusterRelationship = walletClusterRelationshipLabel(edge);
      const walletClusterBlock = walletClusterEdge || walletClusterRelationship
        ? metric("Wallet-cluster evidence", walletClusterEdge || "Graph context") +
          metric("Wallet-cluster relationship", walletClusterRelationship || "Context relationship")
        : "";
      const isBoundaryContextEdge = edgeEvidenceType(edge) === "boundary_context" || edge?.type === "service_boundary";
      const isGroupedBoundaryEvidence = typeof edgeIsGroupedBoundaryEvidence === "function" && edgeIsGroupedBoundaryEvidence(edge);
      const boundaryUnderlyingTransfers = isBoundaryContextEdge || isGroupedBoundaryEvidence ? edgeUnderlyingTransferLines(edge) : [];
      const boundaryEvidenceBlock = isBoundaryContextEdge || isGroupedBoundaryEvidence
        ? section(isGroupedBoundaryEvidence ? "Grouped boundary evidence" : "Boundary evidence", [
          metric("Entity", boundaryIdentityName(edge) || "unknown"),
          metric("Type", boundaryIdentityCategoryLabel(edge) || edgeEvidenceTypeLabel(edge)),
          metric("Relationship", isGroupedBoundaryEvidence ? "Grouped boundary evidence" : "Projected context"),
          metric("Meaning", edgeEvidenceMeaning(edge), "wide"),
          metric("Aggregate amount", edgeAggregateAmountLabel(edge) || "Investigation boundary only. No money-flow edge is stored for this relationship."),
          metric("Transfer count", edgeAggregateTransferCount(edge) ?? "n/a"),
          listMetric("Underlying transfers", boundaryUnderlyingTransfers, isGroupedBoundaryEvidence
            ? "Detailed tx rows are not stored for this grouped boundary evidence."
            : "This context edge was projected from service/boundary evidence, but no individual underlying transactions were stored for this visible edge.")
        ])
        : "";
      const mergedBoundaryContexts = Array.isArray(edge?.metadata?.mergedBoundaryContexts)
        ? edge.metadata.mergedBoundaryContexts
        : [];
      const mergedBoundaryContextBlock = mergedBoundaryContexts.length > 0
        ? section("Related boundary context", [
          metric("Meaning", "This visible line is the real USDT transfer event. DeepCheck also used it as one hop in service/boundary context.", "wide"),
          listMetric("Boundary paths", edgeMergedBoundaryContextLines(edge), "No related boundary context.")
        ])
        : "";
      return '<div class="metric-grid">' +
        metricHtml("Selected", typeChip("Transfer", "service")) +
        walletClusterBlock +
        whereFundingCandidateBlock(edge) +
        boundaryEvidenceBlock +
        mergedBoundaryContextBlock +
        contractDrivenDetailBlock(edge) +
        reciprocalFlowHtml(edge) +
        metric("Evidence type", edgeEvidenceTypeLabel(edge)) +
        metric("Evidence meaning", edgeEvidenceMeaning(edge), "wide") +
        metric("Tronscan note", edge.txHash ? "Graph uses the USDT transfer event. Tronscan header may show the smart-contract caller instead." : "n/a", "wide") +
        metric("Aggregate amount", edgeAggregateAmountLabel(edge) || (isBoundaryContextEdge ? "Investigation boundary only. No money-flow edge is stored for this relationship." : "n/a")) +
        metric("Transfer count", edgeAggregateTransferCount(edge) ?? "n/a") +
        metricHtml("Underlying transactions", edgeTransactionEvidenceHtml(edge), "wide") +
        metric("Meaning", edgeMeaning(edge)) +
        metric("Direction", edgeDirectionMeaning(edge)) +
        (edgeDisplayRole(edge) === "profile_context"
          ? metric("Proof scope", "This is not money-origin proof.", "wide")
          : "") +
        metric("Amount", edgeDetailedAmountLabel(edge) || (isBoundaryContextEdge ? "Investigation boundary only. No money-flow edge is stored for this relationship." : "amount n/a")) +
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
        metricHtml("From", endpointDetailLink(edge, "from"), "wide") +
        metricHtml("To", endpointDetailLink(edge, "to"), "wide") +
        metricHtml("Tx hash", edgePrimaryTxDetailHtml(edge), "wide") +
        metric("Path", edgePathId(edge) || "n/a") +
        metric("Verdict", edge.verdict || "unknown") +
        metric("Weight", edge.weight ?? "n/a") +
        rawBlock("Transfer JSON", edge) +
        '</div>';
    }
    function whereFundingCandidateBlock(edge) {
      const role = edge?.metadata?.whereFundingRole || "";
      if (!role) return "";
      const targetHop = [
        edge?.metadata?.targetFromAddress || "",
        edge?.metadata?.targetToAddress || ""
      ].filter(Boolean).map((value) => short(value, 8)).join(" -> ");
      return section("Where funding candidate", [
        metric("Funding proof", edgeEvidenceTypeLabel(edge)),
        metric("Proof class", edge?.metadata?.proofClass || "n/a"),
        metric("Target hop", targetHop || "n/a", "wide"),
        metricHtml("Target tx", edge?.metadata?.targetTxHash ? txDetailLink(edge.metadata.targetTxHash) : escapeHtml("n/a"), "wide"),
        metric("Coverage ratio", edge?.metadata?.candidateCoverageRatio ?? "n/a"),
        metric("Amount continuity", edge?.metadata?.amountContinuity || "n/a"),
        metric("Stop reason", edge?.metadata?.stopReason || "n/a", "wide"),
        metric("Visibility", edge?.metadata?.visibilityReason || "n/a", "wide"),
        metric("Grouped hidden", edge?.metadata?.hiddenCount ?? "n/a")
      ]);
    }
    function selectedEdgeCardBlock(edge) {
      return selectedEdgeCard(edge);
    }
    function fitGraph() {
      if (!state.graph) return;
      const positions = [...state.renderedNodePositions.values()];
      if (positions.length === 0) {
        state.transform = { x: 0, y: 0, scale: 1 };
        applyTransform();
        return;
      }
      const svg = el("graph");
      const viewBox = svg.viewBox.baseVal;
      const minX = Math.min(...positions.map((point) => point.x));
      const maxX = Math.max(...positions.map((point) => point.x));
      const minY = Math.min(...positions.map((point) => point.y));
      const maxY = Math.max(...positions.map((point) => point.y));
      const padding = graphKindUsesDeepBranchMap(state.graph?.job?.kind) ? 120 : 180;
      const boundsWidth = Math.max(1, maxX - minX + padding * 2);
      const boundsHeight = Math.max(1, maxY - minY + padding * 2);
      const rawScale = Math.min(viewBox.width / boundsWidth, viewBox.height / boundsHeight) * .88;
      const minScale = graphKindUsesDeepBranchMap(state.graph?.job?.kind) ? .08 : .25;
      const maxFitScale = graphKindUsesDeepBranchMap(state.graph?.job?.kind) ? 3.5 : 2.4;
      const scale = Math.max(minScale, Math.min(maxFitScale, rawScale));
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      state.transform = {
        x: viewBox.width / 2 - centerX * scale,
        y: viewBox.height / 2 - centerY * scale,
        scale
      };
      applyTransform();
    }
    function svgPointFromClient(event) {
      const svg = el("graph");
      const rect = svg.getBoundingClientRect();
      const viewBox = svg.viewBox.baseVal;
      return {
        x: viewBox.x + ((event.clientX - rect.left) / Math.max(1, rect.width)) * viewBox.width,
        y: viewBox.y + ((event.clientY - rect.top) / Math.max(1, rect.height)) * viewBox.height
      };
    }
    function zoomAtClientPoint(event, multiplier) {
      const previousScale = state.transform.scale;
      const nextScale = Math.max(.08, Math.min(14, previousScale * multiplier));
      const svgPoint = svgPointFromClient(event);
      const svgX = svgPoint.x;
      const svgY = svgPoint.y;
      const graphPoint = {
        x: (svgX - state.transform.x) / previousScale,
        y: (svgY - state.transform.y) / previousScale
      };
      state.transform.x = svgX - graphPoint.x * nextScale;
      state.transform.y = svgY - graphPoint.y * nextScale;
      state.transform.scale = nextScale;
      applyTransform();
    }
    function zoom(multiplier) {
      const svg = el("graph");
      const rect = svg.getBoundingClientRect();
      zoomAtClientPoint({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }, multiplier);
    }
    function graphPointFromClient(event) {
      const point = svgPointFromClient(event);
      return {
        x: (point.x - state.transform.x) / state.transform.scale,
        y: (point.y - state.transform.y) / state.transform.scale
      };
    }
    function clientDeltaToGraphDelta(svg, deltaX, deltaY) {
      const rect = svg.getBoundingClientRect();
      const viewBox = svg.viewBox.baseVal;
      return {
        x: (deltaX / Math.max(1, rect.width)) * viewBox.width,
        y: (deltaY / Math.max(1, rect.height)) * viewBox.height
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
      setGraphInteracting(true);
      el("graph").classList.add("dragging");
    }
    function edgeGeometry(edge, placedById, edgeRouteIndex) {
      const from = placedById.get(edge.fromNodeId);
      const to = placedById.get(edge.toNodeId);
      if (!from || !to) return null;
      const route = edgeRouteFor(edge, edgeRouteIndex);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const fromOffset = nodeRadius(from) + 3;
      const toOffset = nodeRadius(to) + 7;
      const startX = from.x + (dx / length) * fromOffset;
      const startY = from.y + (dy / length) * fromOffset;
      const endX = to.x - (dx / length) * toOffset;
      const endY = to.y - (dy / length) * toOffset;
      const labelPoint = edgeLabelPoint(startX, startY, endX, endY, edge, route);
      const labelX = labelPoint.x;
      const labelY = labelPoint.y;
      return { startX, startY, endX, endY, labelX, labelY, route };
    }
    function updateConnectedEdgeDom(nodeId) {
      const placedById = new Map(state.renderedNodesById);
      state.renderedNodePositions.forEach((position, id) => {
        const node = placedById.get(id);
        if (node) placedById.set(id, { ...node, x: position.x, y: position.y });
      });
      const edgeRouteIndex = buildEdgeRouteIndex([...state.renderedEdgesById.values()]);
      state.renderedEdgesById.forEach((edge) => {
        if (edge.fromNodeId !== nodeId && edge.toNodeId !== nodeId) return;
        const geometry = edgeGeometry(edge, placedById, edgeRouteIndex);
        if (!geometry) return;
        const path = document.querySelector('[data-edge-id="' + CSS.escape(edge.id) + '"] path.edge');
        const pathD = edgeCurvePath(geometry.startX, geometry.startY, geometry.endX, geometry.endY, edge, geometry.route);
        if (path) path.setAttribute("d", pathD);
        const hitbox = document.querySelector('[data-edge-id="' + CSS.escape(edge.id) + '"] path.edge-hitbox');
        if (hitbox) hitbox.setAttribute("d", pathD);
        const pill = document.querySelector('[data-edge-id="' + CSS.escape(edge.id) + '"] .amount-pill');
        const width = Number(pill?.querySelector("rect")?.getAttribute("width") || 0);
        if (pill && Number.isFinite(width)) pill.setAttribute("transform", "translate(" + (geometry.labelX - width / 2) + " " + (geometry.labelY - 10) + ")");
      });
    }
    function updateDraggedNodeDom(nodeId, x, y) {
      const node = document.querySelector('[data-node-id="' + CSS.escape(nodeId) + '"]');
      if (node) node.setAttribute("transform", "translate(" + x + " " + y + ")");
      updateConnectedEdgeDom(nodeId);
    }
    function updateNodeDrag(event) {
      if (!state.nodeDrag) return false;
      event.preventDefault();
      const point = graphPointFromClient(event);
      const nextX = point.x + state.nodeDrag.offsetX;
      const nextY = point.y + state.nodeDrag.offsetY;
      state.nodeDrag.moved = true;
      state.renderedNodePositions.set(state.nodeDrag.nodeId, { x: nextX, y: nextY });
      updateDraggedNodeDom(state.nodeDrag.nodeId, nextX, nextY);
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
      const nodeId = state.nodeDrag.nodeId;
      const position = state.renderedNodePositions.get(nodeId);
      if (moved && position) saveNodePositionOverride(nodeId, position.x, position.y);
      state.nodeDrag = null;
      if (moved) suppressNextGraphClick();
      el("graph").classList.remove("dragging");
      setGraphInteracting(false);
      return moved;
    }
    function initPanZoom() {
      const svg = el("graph");
      let drag = null;
      svg.addEventListener("mousedown", (event) => {
        if (event.target instanceof Element && event.target.closest("[data-node-id]")) return;
        event.preventDefault();
        drag = { x: event.clientX, y: event.clientY, startX: state.transform.x, startY: state.transform.y };
        setGraphInteracting(true);
        svg.classList.add("dragging");
      });
      window.addEventListener("mousemove", (event) => {
        if (updateNodeDrag(event)) return;
        if (!drag) return;
        event.preventDefault();
        const delta = clientDeltaToGraphDelta(svg, event.clientX - drag.x, event.clientY - drag.y);
        state.transform.x = drag.startX + delta.x;
        state.transform.y = drag.startY + delta.y;
        applyTransform();
      });
      window.addEventListener("mouseup", () => {
        const nodeMoved = finishNodeDrag();
        drag = null;
        setGraphInteracting(false);
        svg.classList.remove("dragging");
        if (nodeMoved) renderGraph();
      });
      svg.addEventListener("wheel", (event) => {
        event.preventDefault();
        zoomAtClientPoint(event, event.deltaY > 0 ? .86 : 1.16);
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
    function handleDetailActionClick(event) {
      const action = event.target instanceof Element ? event.target.closest("[data-action]")?.getAttribute("data-action") : "";
      if (action === "expand-bundle") {
        event.preventDefault();
        expandSelectedGraphItem();
        return;
      }
      if (action === "show-selected-flow-all") {
        event.preventDefault();
        const button = event.target instanceof Element ? event.target.closest("[data-selected-flow-edge-id]") : null;
        const key = button?.getAttribute("data-selected-flow-edge-id") || (state.selected?.type === "edge" ? state.selected.id : "");
        if (key) state.expandedSelectedFlowEdgeIds.add(key);
        renderSelectionCard();
      }
    }
    function selectedFlowTxRowEventTarget(event) {
      const target = event.target instanceof Element ? event.target : null;
      const row = target?.closest("[data-selected-flow-tx-url]");
      if (!(row instanceof HTMLElement) || !target || !row.contains(target)) return null;
      const interactive = target.closest("a, button, input, select, textarea, summary, [data-action], [data-copy-text], [role='button']");
      if (interactive && interactive !== row && row.contains(interactive)) return null;
      return row;
    }
    function openSelectedFlowTxRow(row) {
      const url = row.getAttribute("data-selected-flow-tx-url") || "";
      if (!url) return;
      window.open(url, "_blank", "noopener,noreferrer");
    }
    function handleSelectedFlowTxRowClick(event) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const row = selectedFlowTxRowEventTarget(event);
      if (!row) return;
      event.preventDefault();
      openSelectedFlowTxRow(row);
    }
    function handleSelectedFlowTxRowKeydown(event) {
      if (event.defaultPrevented || (event.key !== "Enter" && event.key !== " ")) return;
      const row = selectedFlowTxRowEventTarget(event);
      if (!row) return;
      event.preventDefault();
      openSelectedFlowTxRow(row);
    }
    document.addEventListener("click", async (event) => {
      const copyButton = event.target instanceof Element ? event.target.closest("[data-copy-text]") : null;
      if (copyButton) {
        event.preventDefault();
        event.stopPropagation();
        const value = copyButton.getAttribute("data-copy-text") || "";
        if (!navigator.clipboard?.writeText) {
          setStatus("Clipboard unavailable.");
          return;
        }
        try {
          await navigator.clipboard.writeText(value);
          setStatus("Copied to clipboard.");
        } catch (error) {
          setStatus("Copy failed.");
        }
        return;
      }
      const anchor = event.target instanceof Element ? event.target.closest("[data-explorer-link]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      window.open(anchor.href, "_blank", "noopener,noreferrer");
    });
    el("token").value = state.token;
    el("layoutMode").value = state.layoutMode;
    el("txLabelMode").value = state.txLabelMode;
    el("walletLabelMode").value = state.walletLabelMode;
    el("flowMode").value = state.flowMode;
    syncWorkspaceVisibility();
    syncDenseGraphControls();
    syncGraphFirstControls();
    renderScoringAudit();
    el("details").addEventListener("click", handleDetailActionClick);
    el("selectionCard").addEventListener("click", handleDetailActionClick);
    el("selectionCard").addEventListener("click", handleSelectedFlowTxRowClick);
    el("selectionCard").addEventListener("keydown", handleSelectedFlowTxRowKeydown);
    el("load").addEventListener("click", () => {
      syncWorkspaceVisibility();
      if (walletIntelligenceActive()) loadWalletIntelligenceAddresses();
      else if (theftReportsActive()) loadTheftReports();
      else loadJobs();
    });
    el("walletIntelReload").addEventListener("click", loadWalletIntelligenceAddresses);
    document.querySelectorAll("[data-wallet-intel-preset]").forEach((button) => {
      button.addEventListener("click", () => {
        applyWalletIntelPreset(button.getAttribute("data-wallet-intel-preset") || "intersections");
        loadWalletIntelligenceAddresses();
      });
    });
    el("walletIntelTable").addEventListener("click", (event) => {
      const row = event.target instanceof Element ? event.target.closest("[data-wallet-intel-address]") : null;
      if (!row) return;
      openWalletIntelligenceAddress(row.getAttribute("data-wallet-intel-address") || "");
    });
    el("theftReportsReload").addEventListener("click", loadTheftReports);
    el("theftReportsAdminStatus").addEventListener("change", loadTheftReports);
    el("theftReportsBotStatus").addEventListener("change", loadTheftReports);
    el("theftReportsLimit").addEventListener("change", loadTheftReports);
    el("theftReportsSearch").addEventListener("input", () => {
      if (state.theftReports.searchTimer) clearTimeout(state.theftReports.searchTimer);
      state.theftReports.searchTimer = setTimeout(() => {
        state.theftReports.searchTimer = null;
        loadTheftReports();
      }, 250);
    });
    el("theftReportsSearch").addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      loadTheftReports();
    });
    el("refresh").addEventListener("click", loadJobs);
    el("jobsModeAll").addEventListener("click", () => setJobQueueMode("all"));
    el("jobsModeRunning").addEventListener("click", () => setJobQueueMode("running"));
    el("jobsModeReview").addEventListener("click", () => setJobQueueMode("review"));
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
      state.jobQueueMode = "all";
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
    el("toggleScoringAudit").addEventListener("click", () => {
      const open = !state.scoringAuditOpen;
      setOverlay("scoringAudit", open);
      if (open) loadScoringAudit();
    });
    el("closeScoringAudit").addEventListener("click", () => setOverlay("scoringAudit", false));
    el("toggleJobs").addEventListener("click", () => setOverlay("jobs", !state.jobsOpen));
    el("closeJobs").addEventListener("click", () => setOverlay("jobs", false));
    el("toggleTransfers").addEventListener("click", () => setTransferDrawer(!state.transfersOpen));
    const closeTransferDrawerButton = document.getElementById("closeTransferDrawer");
    if (closeTransferDrawerButton) {
      closeTransferDrawerButton.addEventListener("click", () => setTransferDrawer(false));
    }
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
    el("txLabelMode").addEventListener("change", () => {
      state.txLabelMode = el("txLabelMode").value;
      localStorage.setItem("adminForensicsTxLabelMode", state.txLabelMode);
      renderGraph();
      renderActivityTimeline();
      renderTransferTabs();
    });
    el("walletLabelMode").addEventListener("change", () => {
      state.walletLabelMode = el("walletLabelMode").value;
      localStorage.setItem("adminForensicsWalletLabelMode", state.walletLabelMode);
      renderGraph();
    });
    el("roleMarksMode").addEventListener("click", () => {
      state.roleMarksVisible = !state.roleMarksVisible;
      localStorage.setItem("adminForensicsRoleMarks", state.roleMarksVisible ? "on" : "off");
      syncGraphFirstControls();
      renderGraph();
    });
    el("densityMode").addEventListener("click", () => {
      const current = state.densityMode;
      if (graphKindSupportsFullEvidence(state.graph?.job?.kind)) {
        const nodes = graphNodes(state.graph);
        const edges = graphEdges(state.graph);
        const mode = state.graph ? graphDisplayMode(nodes, edges) : current;
        if (graphKindUsesWalletClusters(state.graph?.job?.kind)) {
          setDensityMode(mode === "full_evidence" ? "deep_branch_map" : mode === "deep_branch_map" ? "compact_summary" : "full_evidence");
        } else {
          setDensityMode(mode === "full_evidence" ? "compact_summary" : mode === "step_orbit" ? "auto" : "full_evidence");
        }
      } else {
        setDensityMode(current === "show_all" ? "auto" : "show_all");
      }
    });
    el("expandSelected").addEventListener("click", expandSelectedGraphItem);
    el("refreshSecondLayer").addEventListener("click", refreshSecondLayer);
    el("peerLinksMode").addEventListener("click", () => {
      state.peerLinksVisible = !state.peerLinksVisible;
      state.timelineRange = null;
      localStorage.setItem("adminForensicsPeerLinks", state.peerLinksVisible ? "on" : "off");
      syncDenseGraphControls();
      reconcileSelectionWithFilters();
      renderGraph();
      renderCaseBrief();
      renderDetails();
      renderSelectionCard();
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
    renderWalletIntelligenceTable();
    renderWalletIntelligenceDrawer();
    renderTheftReportsList();
    renderTheftReportDetail();
    el("sessionState").textContent = state.token ? "session active" : "token missing";
    applyInitialUrlFilters();
    if (state.token) {
      if (walletIntelligenceActive()) loadWalletIntelligenceAddresses();
      else if (theftReportsActive()) loadTheftReports();
      else loadJobs();
    }
  </script>
</body>
</html>`;
}
