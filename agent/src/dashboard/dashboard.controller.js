const express = require("express");
const router = express.Router();
const { getStats } = require("./dashboard.service");

router.get("/stats", async (req, res) => {
  try {
    res.json(await getStats());
  } catch (err) {
    console.error("Error computing dashboard stats:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/", (req, res) => {
  res.type("html").send(DASHBOARD_HTML);
});

const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>devops-agent — incident dashboard</title>
<style>
  :root {
    color-scheme: light;
    --surface-1:      #fcfcfb;
    --page:           #f9f9f7;
    --text-primary:   #0b0b0b;
    --text-secondary: #52514e;
    --text-muted:     #898781;
    --gridline:       #e1e0d9;
    --baseline:       #c3c2b7;
    --border:         rgba(11,11,11,0.10);
    --series-1:       #2a78d6;
    --status-good:    #0ca30c;
    --status-warning: #fab219;
    --status-serious: #ec835a;
    --status-critical:#d03b3b;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      color-scheme: dark;
      --surface-1:      #1a1a19;
      --page:           #0d0d0d;
      --text-primary:   #ffffff;
      --text-secondary: #c3c2b7;
      --text-muted:     #898781;
      --gridline:       #2c2c2a;
      --baseline:       #383835;
      --border:         rgba(255,255,255,0.10);
      --series-1:       #3987e5;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    background: var(--page);
    color: var(--text-primary);
  }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 20px; font-weight: 600; margin: 0 0 4px; }
  .subtitle { color: var(--text-secondary); font-size: 14px; margin: 0 0 28px; }
  .kpi-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 12px;
    margin-bottom: 28px;
  }
  .tile {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 16px;
  }
  .tile .label { font-size: 12px; color: var(--text-secondary); margin-bottom: 6px; }
  .tile .value { font-size: 28px; font-weight: 600; line-height: 1.1; }
  .tile .footnote { font-size: 11px; color: var(--text-muted); margin-top: 4px; }
  .charts { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 28px; }
  @media (max-width: 720px) { .charts { grid-template-columns: 1fr; } }
  .panel {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 20px;
  }
  .panel h2 { font-size: 14px; font-weight: 600; margin: 0 0 16px; }
  .bar-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
  .bar-row:last-child { margin-bottom: 0; }
  .bar-label {
    width: 150px; flex-shrink: 0; font-size: 12px; color: var(--text-secondary);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .bar-track { flex: 1; height: 24px; background: var(--gridline); border-radius: 4px; position: relative; }
  .bar-fill {
    height: 24px; border-radius: 4px 0 0 4px; min-width: 4px;
    display: flex; align-items: center; justify-content: flex-end;
  }
  .bar-fill.full-rounded { border-radius: 4px; }
  .bar-value { font-size: 12px; color: var(--text-primary); font-weight: 600; padding-right: 8px; }
  .bar-value.outside { color: var(--text-secondary); padding-left: 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td {
    text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--gridline);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 280px;
  }
  th { color: var(--text-muted); font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; }
  td.num { font-variant-numeric: tabular-nums; }
  .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
  .empty { color: var(--text-muted); font-size: 13px; padding: 12px 0; }
  .table-scroll { overflow-x: auto; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>devops-agent — incident dashboard</h1>
    <p class="subtitle">Live view over the Postgres incident log. Refreshes on page load.</p>

    <div class="kpi-row" id="kpi-row"></div>

    <div class="charts">
      <div class="panel">
        <h2>Incidents by outcome</h2>
        <div id="status-chart"></div>
      </div>
      <div class="panel">
        <h2>Incidents by diagnosed category</h2>
        <div id="action-type-chart"></div>
      </div>
    </div>

    <div class="panel">
      <h2>Recent incidents</h2>
      <div class="table-scroll">
        <table id="recent-table">
          <thead>
            <tr><th>ID</th><th>Time</th><th>Status</th><th>Category</th><th>Confidence</th><th>Cost</th><th>Root cause</th></tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
  </div>

<script>
const STATUS_META = {
  applied:                          { label: "Auto-fixed & merged",       color: "var(--status-good)" },
  escalated:                        { label: "Escalated (low confidence/cost)", color: "var(--status-warning)" },
  rolled_back:                      { label: "Applied, then rolled back", color: "var(--status-serious)" },
  apply_error:                      { label: "Apply error",               color: "var(--status-critical)" },
  pending_approval:                 { label: "Awaiting approval",         color: "var(--text-muted)" },
  approved_manual_action_required:  { label: "Approved, manual action needed", color: "var(--text-muted)" },
  rejected:                         { label: "Rejected by human",         color: "var(--text-muted)" },
  diagnosed:                        { label: "Diagnosed (pre-guardrails)", color: "var(--text-muted)" },
};

function metaFor(status) {
  return STATUS_META[status] || { label: status, color: "var(--text-muted)" };
}

function fmtMoney(n) {
  if (n == null) return "—";
  return "$" + n.toFixed(4);
}

function fmtSeconds(s) {
  if (s == null) return "no resolved incidents yet";
  if (s < 60) return s.toFixed(0) + "s";
  return (s / 60).toFixed(1) + "m";
}

function renderKpiRow(stats) {
  const tiles = [
    { label: "Total incidents", value: stats.totalIncidents.toLocaleString() },
    { label: "Auto-fixed & merged", value: stats.autoFixed.toLocaleString() },
    { label: "Escalated to human", value: stats.escalated.toLocaleString() },
    { label: "Avg cost / incident", value: fmtMoney(stats.avgCostUsd) },
    {
      label: "Avg time-to-fix",
      value: fmtSeconds(stats.avgTimeToFixSeconds),
      footnote: stats.avgTimeToFixSampleSize ? "n=" + stats.avgTimeToFixSampleSize + " applied incident" + (stats.avgTimeToFixSampleSize === 1 ? "" : "s") : null,
    },
  ];
  document.getElementById("kpi-row").innerHTML = tiles.map(t => \`
    <div class="tile">
      <div class="label">\${t.label}</div>
      <div class="value">\${t.value}</div>
      \${t.footnote ? \`<div class="footnote">\${t.footnote}</div>\` : ""}
    </div>
  \`).join("");
}

function renderBarChart(containerId, rows, key, colorFn) {
  const el = document.getElementById(containerId);
  if (!rows.length) { el.innerHTML = '<div class="empty">No data yet.</div>'; return; }
  const max = Math.max(...rows.map(r => r.count));
  el.innerHTML = rows.map(r => {
    const pct = Math.max((r.count / max) * 100, 4);
    const label = key === "status" ? metaFor(r.status).label : (r.action_type || "(none)");
    const color = colorFn(r);
    const title = label + ": " + r.count;
    return \`
      <div class="bar-row" title="\${title}">
        <div class="bar-label">\${label}</div>
        <div class="bar-track">
          <div class="bar-fill" style="width:\${pct}%; background:\${color};">
            \${pct > 20 ? \`<span class="bar-value">\${r.count}</span>\` : ""}
          </div>
          \${pct <= 20 ? \`<span class="bar-value outside" style="position:absolute; left:calc(\${pct}% + 4px); top:2px;">\${r.count}</span>\` : ""}
        </div>
      </div>
    \`;
  }).join("");
}

function renderRecentTable(rows) {
  const tbody = document.querySelector("#recent-table tbody");
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">No incidents yet.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(r => {
    const meta = metaFor(r.status);
    const time = new Date(r.created_at).toLocaleString();
    return \`
      <tr>
        <td class="num">#\${r.id}</td>
        <td>\${time}</td>
        <td><span class="status-dot" style="background:\${meta.color}"></span>\${meta.label}</td>
        <td>\${r.action_type || "—"}</td>
        <td class="num">\${r.confidence != null ? r.confidence + "%" : "—"}</td>
        <td class="num">\${fmtMoney(r.cost_usd)}</td>
        <td title="\${(r.root_cause || "").replace(/"/g, '&quot;')}">\${r.root_cause || "—"}</td>
      </tr>
    \`;
  }).join("");
}

async function main() {
  const res = await fetch("/dashboard/stats");
  const stats = await res.json();

  renderKpiRow(stats);
  renderBarChart("status-chart", stats.byStatus, "status", r => metaFor(r.status).color);
  renderBarChart("action-type-chart", stats.byActionType, "action_type", () => "var(--series-1)");
  renderRecentTable(stats.recentIncidents);
}

main().catch(err => {
  document.querySelector(".wrap").insertAdjacentHTML("beforeend", '<p style="color:var(--status-critical)">Failed to load dashboard data: ' + err.message + '</p>');
});
</script>
</body>
</html>`;

module.exports = router;
