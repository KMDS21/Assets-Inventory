const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
let token = localStorage.getItem("af_token") || "",
  me = null,
  data = null,
  page = "overview";
const THEME_KEY = "af_theme";
function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem(THEME_KEY, t);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", t === "light" ? "#f4f7fc" : "#0b1220");
  const btn = $("#themeToggle");
  if (btn) {
    btn.textContent = t === "light" ? "☾" : "☼";
    btn.title = t === "light" ? "Switch to dark theme" : "Switch to light theme";
  }
}
$("#themeToggle").onclick = () =>
  applyTheme(
    document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light"
  );
applyTheme(localStorage.getItem(THEME_KEY) || "light");
const labels = {
  PENDING_APPROVAL: "Pending approval",
  CHANGES_REQUESTED: "Changes requested",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  ISSUED: "Issued",
  PARTIALLY_ISSUED: "Partially issued",
  OUTSIDE: "Outside premises",
  AWAITING_RECEIPT: "Awaiting receipt",
  PARTIAL_RETURN: "Partial return",
  RECEIVED_PENDING_CLOSE: "Received · pending close",
  CLOSED: "Closed",
  DISCREPANCY_OPEN: "Discrepancy open",
};
const roleNames = {
  SUPER_ADMIN: "Super administrator",
  COMPANY_ADMIN: "Company administrator",
  MANAGER: "Department manager",
  EMPLOYEE: "Employee / requester",
  STORES_IT: "Stores / IT officer",
  SECURITY: "Security officer",
  AUDITOR: "Auditor",
};
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const initials = (s) =>
  (s || "AF")
    .split(/\s+/)
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toUpperCase();
const fmtDate = (s) =>
  s
    ? new Date(s).toLocaleDateString(undefined, {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";
const fmtTime = (s) =>
  s
    ? new Date(s).toLocaleString(undefined, {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const statusClass = (s) =>
  ["APPROVED", "ISSUED", "CLOSED", "RECEIVED_PENDING_CLOSE"].includes(s)
    ? "green"
    : ["PENDING_APPROVAL", "AWAITING_RECEIPT", "PARTIAL_RETURN"].includes(s)
      ? "amber"
      : ["REJECTED", "DISCREPANCY_OPEN"].includes(s)
        ? "red"
        : ["OUTSIDE", "PARTIALLY_ISSUED"].includes(s)
          ? "blue"
          : ["CHANGES_REQUESTED"].includes(s)
            ? "purple"
            : "gray";
const pill = (s) =>
  `<span class="status ${statusClass(s)}">${esc(labels[s] || s || "—")}</span>`;
function toast(msg, type = "success") {
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = msg;
  $("#toastRoot").append(el);
  setTimeout(() => el.remove(), 3600);
}
async function api(url, opts = {}) {
  const res = await fetch("/api" + url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(opts.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Request failed");
  return body;
}
async function refresh() {
  data = await api("/bootstrap");
  me = data.user;
  $("#userName").textContent = me.name;
  $("#userRole").textContent = roleNames[me.role] || me.role;
  $("#userAvatar").textContent = initials(me.name);
  $("#topAvatar").textContent = initials(me.name);
  $("#movementCount").textContent = data.movements.length;
  render();
}
function showApp() {
  $("#loginView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
}
function showLogin() {
  $("#appView").classList.add("hidden");
  $("#loginView").classList.remove("hidden");
}
$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#loginError").textContent = "";
  try {
    const r = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: $("#email").value,
        password: $("#password").value,
      }),
    });
    token = r.token;
    localStorage.setItem("af_token", token);
    await refresh();
    showApp();
  } catch (err) {
    $("#loginError").textContent = err.message;
  }
});
$("#logoutBtn").onclick = () => {
  token = "";
  localStorage.removeItem("af_token");
  showLogin();
};
$("#nav").addEventListener("click", (e) => {
  const b = e.target.closest("[data-page]");
  if (!b) return;
  page = b.dataset.page;
  $$(".nav-item").forEach((x) => x.classList.toggle("active", x === b));
  render();
});
function can(...r) {
  return (
    r.includes(me.role) || ["SUPER_ADMIN", "COMPANY_ADMIN"].includes(me.role)
  );
}
function heading(title, sub, action = "") {
  return `<div class="page-heading"><div><h1>${title}</h1><p>${sub}</p></div><div class="heading-actions">${action}</div></div>`;
}
function stat(label, value, foot, icon, accent = "") {
  return `<div class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon" style="${accent}">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-foot">${foot}</div></div>`;
}
function movementTable(rows, compact = false) {
  if (!rows.length)
    return `<div class="empty"><div class="empty-icon">⇄</div>No movement records found.</div>`;
  return `<div class="table-wrap"><table><thead><tr><th>Movement reference</th><th>Requested by</th><th>Destination</th><th>Return due</th><th>Assets</th><th>Status</th><th></th></tr></thead><tbody>${rows.map((m) => `<tr><td><span class="ref">${esc(m.reference)}</span><div class="tiny muted">${fmtDate(m.created_at)}</div></td><td>${esc(m.requester_name)}</td><td>${esc(m.destination)}</td><td>${fmtDate(m.expected_return)}</td><td>${m.item_count ?? "—"}</td><td>${pill(m.status)}</td><td><button class="btn small" onclick="openMovement(${m.id})">View</button></td></tr>`).join("")}</tbody></table></div>`;
}
function render() {
  if (!data) return;
  const names = {
    overview: "Overview",
    movements: "Asset movements",
    assets: "Asset register",
    gate: "Security gate",
    cases: "Discrepancies",
    audit: "Audit trail",
    reports: "Reports",
  };
  $("#pageCrumb").textContent = names[page];
  const root = $("#pageContent");
  if (page === "overview") root.innerHTML = renderOverview();
  if (page === "movements") root.innerHTML = renderMovements();
  if (page === "assets") root.innerHTML = renderAssets();
  if (page === "gate") root.innerHTML = renderGate();
  if (page === "cases") root.innerHTML = renderCases();
  if (page === "audit") root.innerHTML = renderAudit();
  if (page === "reports") root.innerHTML = renderReports();
}
function renderOverview() {
  const s = data.stats;
  const recent = data.movements.slice(0, 6),
    activity = data.audit.slice(0, 6);
  return `${heading(`Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, ${esc(me.name.split(" ")[0])}.`, "Here is what is happening across your asset movements today.", can("EMPLOYEE", "MANAGER") ? '<button class="btn primary" onclick="newRequest()">＋ New movement request</button>' : "")}<div class="stats-grid">${stat("REGISTERED ASSETS", s.totalAssets, "Across this company", "▣")}${stat("AVAILABLE ASSETS", s.available, "Ready for allocation", "◉", "color:var(--ico-green);background:var(--green-bg)")}${stat("ASSETS OUTSIDE", s.outside, "Currently beyond the gate", "⇢", "color:var(--link-fg)")}${stat("PENDING APPROVALS", s.pending, "Awaiting manager decision", "◷", "color:var(--amber-fg);background:var(--amber-bg)")}</div><div class="content-grid"><section class="panel"><div class="panel-head"><div><h3>Recent asset movements</h3><p>Track requests across the full movement lifecycle</p></div><button class="text-link" onclick="go('movements')">View all movements →</button></div>${movementTable(recent, true)}</section><section class="panel"><div class="panel-head"><div><h3>Activity timeline</h3><p>Latest recorded actions</p></div><button class="text-link" onclick="go('audit')">Full audit →</button></div><div class="activity-list">${
    activity.length
      ? activity
          .map(
            (a) =>
              `<div class="activity"><div class="activity-dot">◷</div><div><b>${esc(
                a.action
                  .replaceAll("_", " ")
                  .toLowerCase()
                  .replace(/^./, (x) => x.toUpperCase()),
              )}</b><p>${esc(a.user_name || "System")} ${a.reference ? "· " + esc(a.reference) : ""}</p><time>${fmtTime(a.created_at)}</time></div></div>`,
          )
          .join("")
      : '<div class="empty">No activity recorded yet.</div>'
  }</div></section></div><section class="panel"><div class="panel-head"><div><h3>Movement control process</h3><p>Four controlled stages · one movement reference from request to receipt</p></div><span class="tag">WORKFLOW OVERVIEW</span></div><div class="workflow-strip"><div class="workflow-step"><div class="step-no">01 / AUTHORISE</div><b>Request & approve</b><span>Submit assets, purpose, destination and return date. Manager approves scope.</span></div><div class="workflow-step"><div class="step-no">02 / RELEASE</div><b>Collect & exit</b><span>Stores / IT confirms handover. Security independently validates pass and barcodes.</span></div><div class="workflow-step"><div class="step-no">03 / RETURN</div><b>Return & enter</b><span>Security scans actual returning assets. Full and partial returns are supported.</span></div><div class="workflow-step"><div class="step-no">04 / RECONCILE</div><b>Receive & close</b><span>Stores / IT inspects condition and accessories. Close only when all issues are resolved.</span></div></div></section>`;
}
function go(p) {
  page = p;
  $$(".nav-item").forEach((x) =>
    x.classList.toggle("active", x.dataset.page === p),
  );
  render();
}
function renderMovements() {
  let rows = data.movements;
  return `${heading("Asset movements", "A single reference tracks every request, issue, gate scan and return.", can("EMPLOYEE", "MANAGER") ? '<button class="btn primary" onclick="newRequest()">＋ New movement request</button>' : "")}<div class="toolbar"><div class="searchbox"><span>⌕</span><input id="movementSearch" placeholder="Search reference, requester or destination…" oninput="filterRows()"></div><select class="filter-select" id="statusFilter" onchange="filterRows()"><option value="">All statuses</option>${Object.entries(
    labels,
  )
    .map(([k, v]) => `<option value="${k}">${v}</option>`)
    .join(
      "",
    )}</select></div><section class="panel" id="movementTable">${movementTable(rows)}</section>`;
}
function filterRows() {
  const q = ($("#movementSearch")?.value || "").toLowerCase(),
    st = $("#statusFilter")?.value || "";
  const rows = data.movements.filter(
    (m) =>
      (!st || m.status === st) &&
      [m.reference, m.requester_name, m.destination]
        .join(" ")
        .toLowerCase()
        .includes(q),
  );
  $("#movementTable").innerHTML = movementTable(rows);
}
function renderAssets() {
  return `${heading("Asset register", "Manage identifiable equipment and its current availability.", can("STORES_IT") ? '<button class="btn primary" onclick="newAsset()">＋ Add asset</button>' : "")}<div class="toolbar"><div class="searchbox"><span>⌕</span><input id="assetSearch" placeholder="Search tag, asset name or serial number…" oninput="filterAssets()"></div><select class="filter-select" id="assetStatus" onchange="filterAssets()"><option value="">All asset states</option><option>AVAILABLE</option><option>ALLOCATED</option><option>OUTSIDE</option><option>QUARANTINE</option></select></div><section class="panel" id="assetTable">${assetTable(data.assets)}</section>`;
}
function assetTable(rows) {
  return rows.length
    ? `<div class="table-wrap"><table><thead><tr><th>Asset tag</th><th>Asset description</th><th>Category</th><th>Serial number</th><th>Condition</th><th>Current state</th></tr></thead><tbody>${rows.map((a) => `<tr><td class="ref">${esc(a.asset_tag)}</td><td>${esc(a.name)}</td><td>${esc(a.category || "—")}</td><td>${esc(a.serial_no || "—")}</td><td>${esc(a.condition)}</td><td>${pill(a.status === "AVAILABLE" ? "APPROVED" : a.status === "OUTSIDE" ? "OUTSIDE" : a.status === "QUARANTINE" ? "DISCREPANCY_OPEN" : "ISSUED")}</td></tr>`).join("")}</tbody></table></div>`
    : '<div class="empty">No assets registered.</div>';
}
function filterAssets() {
  const q = $("#assetSearch").value.toLowerCase(),
    s = $("#assetStatus").value;
  $("#assetTable").innerHTML = assetTable(
    data.assets.filter(
      (a) =>
        (!s || a.status === s) &&
        [a.asset_tag, a.name, a.serial_no, a.category]
          .join(" ")
          .toLowerCase()
          .includes(q),
    ),
  );
}
function renderGate() {
  return `${heading("Security gate", "Independently verify the live movement pass and each asset barcode.")}<div class="content-grid"><section class="panel"><div class="panel-head"><div><h3>Gate scan console</h3><p>Exit and return entry validation</p></div><span class="status blue">SECURITY CONTROL</span></div><div class="field"><label>Scan type</label><select id="gateType"><option value="EXIT">Security exit</option><option value="RETURN_ENTRY">Return entry</option></select></div><div class="field" style="margin-top:13px"><label>Movement pass reference</label><input id="gatePass" placeholder="Scan or enter AM-YYYYMMDD-XXXXX"></div><div class="field" style="margin-top:13px"><label>Asset barcode(s)</label><textarea id="gateTags" placeholder="Scan one asset tag per line or separate with commas"></textarea><small>Only assets in the approved and issued movement can pass the exit control.</small></div><div class="field" style="margin-top:13px"><label>Gate / location</label><input id="gateLocation" value="Main Security Gate"></div><button class="btn primary" style="margin-top:16px" onclick="submitGate()">Validate & record scan →</button><div id="gateResult"></div></section><section class="panel"><div class="panel-head"><div><h3>Gate control rules</h3><p>Validation applied to each scan</p></div></div><div class="activity-list"><div class="activity"><div class="activity-dot">01</div><div><b>Live pass validation</b><p>Movement reference must match the original live record.</p></div></div><div class="activity"><div class="activity-dot">02</div><div><b>Asset-level verification</b><p>Each barcode must match an issued item in the approved movement.</p></div></div><div class="activity"><div class="activity-dot">03</div><div><b>Duplicate prevention</b><p>Already exited or unapproved items are rejected.</p></div></div><div class="activity"><div class="activity-dot">04</div><div><b>Independent event log</b><p>Operator, date, time, location and result are retained.</p></div></div></div></section></div><section class="panel"><div class="panel-head"><div><h3>Movements requiring gate action</h3><p>Approved items ready for exit or assets returning to premises</p></div></div>${movementTable(data.movements.filter((m) => ["ISSUED", "PARTIALLY_ISSUED", "OUTSIDE", "AWAITING_RECEIPT", "PARTIAL_RETURN"].includes(m.status)))}</section>`;
}
function renderCases() {
  return `${heading("Discrepancy management", "Resolve shortages, damage, missing accessories and unmatched scans.")}<section class="panel"><div class="panel-head"><div><h3>Discrepancy cases</h3><p>Movement remains open until every issue is resolved</p></div><span class="status amber">${data.cases.filter((c) => c.status === "OPEN").length} OPEN</span></div>${data.cases.length ? data.cases.map((c) => `<div class="case-card"><div style="display:flex;justify-content:space-between;gap:10px"><h4>${esc(c.asset_tag || "Asset")} · ${esc(c.asset_name || "Movement discrepancy")}</h4>${c.status === "OPEN" ? '<span class="status red">OPEN</span>' : '<span class="status green">RESOLVED</span>'}</div><p>${esc(c.issue)} · ${esc(c.reference)} · Opened by ${esc(c.opened_by_name || "—")} · ${fmtDate(c.created_at)}</p>${c.status === "OPEN" && can("STORES_IT", "MANAGER") ? `<button class="btn small success" onclick="resolveCase(${c.id})">Resolve case</button>` : `<div class="tiny muted">${c.status === "RESOLVED" ? "Resolution: " + esc(c.resolution) : ""}</div>`}</div>`).join("") : '<div class="empty">No discrepancy cases recorded.</div>'}</section>`;
}
function renderAudit() {
  return `${heading("Audit trail", "An append-only record of approvals, handovers, scans and corrections.")}<section class="panel"><div class="panel-head"><div><h3>System activity log</h3><p>Operator · action · movement reference · timestamp</p></div><span class="tag">LATEST 100 EVENTS</span></div>${data.audit.length ? `<div class="table-wrap"><table><thead><tr><th>Timestamp</th><th>Operator</th><th>Action</th><th>Movement</th><th>Details</th></tr></thead><tbody>${data.audit.map((a) => `<tr><td>${fmtTime(a.created_at)}</td><td>${esc(a.user_name || "System")}</td><td>${esc(a.action.replaceAll("_", " "))}</td><td class="ref">${esc(a.reference || "—")}</td><td>${esc(a.details || "—")}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty">No audit events recorded.</div>'}</section>`;
}
function renderReports() {
  const statuses = data.movements.reduce(
      (o, m) => ((o[m.status] = (o[m.status] || 0) + 1), o),
      {},
    ),
    assets = data.assets.reduce(
      (o, a) => ((o[a.status] = (o[a.status] || 0) + 1), o),
      {},
    );
  const bars = (obj) =>
    Object.entries(obj)
      .map(
        ([k, v]) =>
          `<div class="report-row"><span>${esc(labels[k] || k)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(3, (v / Math.max(...Object.values(obj), 1)) * 100)}%"></div></div><strong>${v}</strong></div>`,
      )
      .join("");
  return `${heading("Reports & analytics", "Movement status, asset availability and exception oversight.", '<button class="btn" onclick="window.print()">↧ Print report</button>')}<div class="stats-grid">${stat("TOTAL MOVEMENTS", data.movements.length, "All recorded requests", "⇄")}${stat("OVERDUE RETURNS", data.stats.overdue, "Past expected return date", "◷")}${stat("OPEN DISCREPANCIES", data.stats.openCases, "Require action", "⚑")}${stat("OUTSIDE PREMISES", data.stats.outside, "Not yet received by Stores / IT", "⇢")}</div><div class="content-grid"><section class="panel"><div class="panel-head"><div><h3>Movements by status</h3><p>Current movement lifecycle distribution</p></div></div><div class="report-bars">${bars(statuses) || "No data"}</div></section><section class="panel"><div class="panel-head"><div><h3>Asset availability</h3><p>Current asset register state</p></div></div><div class="report-bars">${bars(assets) || "No data"}</div></section></div><section class="panel"><div class="panel-head"><div><h3>Overdue & outstanding movements</h3><p>Items that need follow-up</p></div></div>${movementTable(data.movements.filter((m) => m.status !== "CLOSED" && new Date(m.expected_return) < new Date()))}</section>`;
}
function modal(title, sub, body, foot = "", wide = false) {
  $("#modalRoot").innerHTML =
    `<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><div class="modal ${wide ? "wide" : ""}"><div class="modal-head"><div><h2>${title}</h2><p>${sub}</p></div><button class="close-btn" onclick="closeModal()">×</button></div><div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ""}</div></div>`;
}
function closeModal() {
  $("#modalRoot").innerHTML = "";
}
async function newRequest() {
  const available = data.assets.filter((a) => a.status === "AVAILABLE");
  modal(
    "Create movement request",
    "Provide the movement purpose, destination, return date and asset list.",
    `<div class="form-grid"><div class="field full"><label>Purpose of movement *</label><input id="reqPurpose" placeholder="e.g. Client site installation"></div><div class="field"><label>Destination *</label><input id="reqDestination" placeholder="Office / site / location"></div><div class="field"><label>Expected return date *</label><input id="reqReturn" type="date" min="${new Date().toISOString().slice(0, 10)}"></div><div class="field full"><label>Select assets *</label><div class="asset-pick-list">${available.map((a) => `<label class="asset-pick"><input type="checkbox" value="${a.id}" class="reqAsset"> <b>${esc(a.asset_tag)}</b> · ${esc(a.name)}<span>${esc(a.category)}</span></label>`).join("") || '<div class="empty">No available assets</div>'}</div></div><div class="field full"><label>Accessories / items accompanying the asset (optional)</label><input id="reqAccessories" placeholder="e.g. Charger, bag, power adapter"></div></div>`,
    `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="submitRequest()">Submit for approval →</button>`,
  );
}
async function submitRequest() {
  const items = $$(".reqAsset:checked").map((x) => ({
    asset_id: Number(x.value),
    accessories: $("#reqAccessories").value,
  }));
  try {
    await api("/movements", {
      method: "POST",
      body: JSON.stringify({
        purpose: $("#reqPurpose").value,
        destination: $("#reqDestination").value,
        expected_return: $("#reqReturn").value,
        items,
      }),
    });
    closeModal();
    await refresh();
    go("movements");
    toast("Movement request submitted for approval");
  } catch (e) {
    toast(e.message, "error");
  }
}
async function newAsset() {
  modal(
    "Register a new asset",
    "Create a unique barcode identity for an asset.",
    `<div class="form-grid"><div class="field"><label>Asset tag / barcode *</label><input id="assetTag" placeholder="AST-1007"></div><div class="field"><label>Asset name *</label><input id="assetName" placeholder="Dell Latitude laptop"></div><div class="field"><label>Category</label><input id="assetCategory" placeholder="Laptop"></div><div class="field"><label>Serial number</label><input id="assetSerial" placeholder="Manufacturer serial"></div></div>`,
    `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveAsset()">Save asset</button>`,
  );
}
async function saveAsset() {
  try {
    await api("/assets", {
      method: "POST",
      body: JSON.stringify({
        asset_tag: $("#assetTag").value,
        name: $("#assetName").value,
        category: $("#assetCategory").value,
        serial_no: $("#assetSerial").value,
      }),
    });
    closeModal();
    await refresh();
    toast("Asset registered");
  } catch (e) {
    toast(e.message, "error");
  }
}
async function openMovement(id) {
  try {
    const d = await api("/movements/" + id),
      m = d.movement,
      items = d.items;
    let actions = "";
    if (m.status === "PENDING_APPROVAL" && can("MANAGER"))
      actions = `<button class="btn danger" onclick="decide(${id},'REJECT')">Reject</button><button class="btn" onclick="decide(${id},'CHANGES')">Return for changes</button><button class="btn success" onclick="decide(${id},'APPROVE')">Approve request</button>`;
    if (["APPROVED", "PARTIALLY_ISSUED"].includes(m.status) && can("STORES_IT"))
      actions += `<button class="btn primary" onclick="issueMovement(${id})">Confirm collection</button>`;
    if (
      ["RECEIVED_PENDING_CLOSE", "PARTIAL_RETURN"].includes(m.status) &&
      can("STORES_IT", "MANAGER")
    )
      actions += `<button class="btn success" onclick="closeMovement(${id})">Close movement</button>`;
    const body = `<div class="detail-grid"><div class="detail-box"><small>Movement reference</small><b class="ref">${esc(m.reference)}</b></div><div class="detail-box"><small>Current status</small>${pill(m.status)}</div><div class="detail-box"><small>Requested by</small><b>${esc(m.requester_name)}</b></div><div class="detail-box"><small>Destination</small><b>${esc(m.destination)}</b></div><div class="detail-box"><small>Expected return</small><b>${fmtDate(m.expected_return)}</b></div><div class="detail-box"><small>Approver</small><b>${esc(m.approver_name || "Pending")}</b></div></div><div class="scan-box" style="display:flex;align-items:center;gap:16px"><div style="flex:1"><b>Scannable movement pass</b><p>Security scans this pass and each asset barcode. The pass is linked to the live movement record.</p><b class="ref">${esc(m.reference)}</b></div><img id="passQr" alt="Movement pass QR code" style="width:104px;height:104px;background:#fff;padding:5px;border-radius:7px" /></div><div class="field"><label>Purpose</label><div class="tag">${esc(m.purpose)}</div></div><div class="panel-head" style="margin-top:20px"><div><h3>Movement item reconciliation</h3><p>Asset-level status, scan and receipt tracking</p></div></div><div class="table-wrap"><table><thead><tr><th>Asset</th><th>Accessories</th><th>Issue condition</th><th>Item status</th><th>Return condition</th></tr></thead><tbody>${items.map((i) => `<tr><td><b>${esc(i.asset_tag)}</b><div class="tiny muted">${esc(i.asset_name)}</div></td><td>${esc(i.accessories || "—")}</td><td>${esc(i.issue_condition || "—")}</td><td>${pill(i.item_status === "RECEIVED" || i.item_status === "RESOLVED" ? "CLOSED" : i.item_status === "OUTSIDE" ? "OUTSIDE" : i.item_status === "DISCREPANCY_OPEN" ? "DISCREPANCY_OPEN" : i.item_status === "ENTERED" ? "AWAITING_RECEIPT" : "ISSUED")}</td><td>${esc(i.return_condition || "—")}</td></tr>`).join("")}</tbody></table></div><div class="panel-head" style="margin-top:20px"><div><h3>Scan history</h3><p>Recorded collection, exit, entry and receipt events</p></div></div>${d.scans.length ? d.scans.map((s) => `<div class="activity" style="margin:10px 0"><div class="activity-dot">⌁</div><div><b>${esc(s.scan_type)} · ${esc(s.scanned_value)}</b><p>${esc(s.operator_name)} · ${esc(s.location)} · ${esc(s.result)}</p><time>${fmtTime(s.created_at)}</time></div></div>`).join("") : '<div class="tiny muted">No scan events recorded.</div>'}`;
    modal(
      esc(m.reference),
      "Movement record · " + esc(m.requester_name),
      body,
      `<button class="btn" onclick="closeModal()">Close</button>${actions}`,
      true,
    );
    try {
      const pass = await api(`/movements/${id}/pass`);
      const img = $("#passQr");
      if (img) img.src = pass.qr;
    } catch {
      const img = $("#passQr");
      if (img) img.style.display = "none";
    }
  } catch (e) {
    toast(e.message, "error");
  }
}
async function decide(id, decision) {
  let note = "";
  if (decision !== "APPROVE") {
    note =
      prompt(
        decision === "REJECT" ? "Reason for rejection:" : "Changes required:",
      ) || "";
    if (!note) return;
  } else if (
    !confirm("Approve this movement request and preserve the approved scope?")
  )
    return;
  try {
    await api(`/movements/${id}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision, note }),
    });
    closeModal();
    await refresh();
    toast("Approval decision recorded");
  } catch (e) {
    toast(e.message, "error");
  }
}
async function issueMovement(id) {
  try {
    const d = await api("/movements/" + id),
      items = d.items.filter((i) => i.item_status === "REQUESTED");
    const body = `<div class="scan-box"><b>Collection verification</b><p>Stores / IT must scan the movement pass and each physical asset. Confirm only assets physically handed over to the user.</p></div><div class="field"><label>Movement pass</label><input id="issuePass" value="${esc(d.movement.reference)}" readonly></div><div class="asset-pick-list" style="margin-top:12px">${items.map((i) => `<label class="asset-pick"><input type="checkbox" class="issueItem" value="${i.id}" checked><b>${esc(i.asset_tag)}</b> · ${esc(i.asset_name)}<span>Condition <select class="issueCondition" data-id="${i.id}" style="width:90px;padding:5px"><option>Good</option><option>Fair</option><option>Damaged</option></select></span></label>`).join("")}</div><div class="field" style="margin-top:12px"><label>Stores / IT location</label><input id="issueLocation" value="Stores / IT counter"></div>`;
    modal(
      "Confirm asset collection",
      "Record handover before Security can authorize exit.",
      body,
      `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="submitIssue(${id})">Confirm handover</button>`,
    );
  } catch (e) {
    toast(e.message, "error");
  }
}
async function submitIssue(id) {
  const items = $$(".issueItem:checked").map((x) => ({
    item_id: Number(x.value),
    condition: $(`.issueCondition[data-id="${x.value}"]`).value,
    asset_tag: data.assets.find((a) => false)?.asset_tag,
    location: $("#issueLocation").value,
  }));
  try {
    await api(`/movements/${id}/issue`, {
      method: "POST",
      body: JSON.stringify({ items }),
    });
    closeModal();
    await refresh();
    toast("Collection recorded. Movement is ready for security exit.");
  } catch (e) {
    toast(e.message, "error");
  }
}
async function submitGate() {
  const tags = $("#gateTags")
    .value.split(/[\n,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  try {
    const r = await api(
      "/movements/" + (await findMovementId($("#gatePass").value)) + "/gate",
      {
        method: "POST",
        body: JSON.stringify({
          scan_type: $("#gateType").value,
          pass: $("#gatePass").value.trim(),
          asset_tags: tags,
          location: $("#gateLocation").value,
        }),
      },
    );
    $("#gateResult").innerHTML =
      `<div class="status green" style="margin-top:14px">${esc(r.message)}</div>`;
    await refresh();
    toast(r.message);
  } catch (e) {
    $("#gateResult").innerHTML =
      `<div class="error-text">${esc(e.message)}</div>`;
    toast(e.message, "error");
  }
}
async function findMovementId(pass) {
  const m = data.movements.find((x) => x.reference === pass.trim());
  if (!m) throw new Error("Movement reference not found");
  return m.id;
}
async function resolveCase(id) {
  const resolution = prompt(
    "Enter resolution details (recovered, repaired, authorised loss/disposal, etc.):",
  );
  if (!resolution) return;
  try {
    await api(`/cases/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ resolution }),
    });
    await refresh();
    toast("Discrepancy resolved");
  } catch (e) {
    toast(e.message, "error");
  }
}
async function closeMovement(id) {
  if (
    !confirm(
      "Confirm all assets and discrepancies are reconciled and close this movement?",
    )
  )
    return;
  try {
    await api(`/movements/${id}/close`, { method: "POST" });
    closeModal();
    await refresh();
    toast("Movement closed successfully");
  } catch (e) {
    toast(e.message, "error");
  }
}
// Receive / inspect entered assets through the movement details action.
window.receiveMovement = async function (id) {
  try {
    const d = await api("/movements/" + id),
      items = d.items.filter((i) => i.item_status === "ENTERED");
    if (!items.length)
      throw new Error("No assets are awaiting physical receipt");
    const body = `<div class="scan-box"><b>Stores / IT receipt inspection</b><p>Only assets already scanned at Security return entry can be credited as received. Record condition and any shortage or damage.</p></div>${items.map((i) => `<div class="case-card"><label class="asset-pick"><input type="checkbox" class="receiveItem" value="${i.id}" checked><b>${esc(i.asset_tag)}</b> · ${esc(i.asset_name)}</label><div class="form-grid" style="margin-top:10px"><div class="field"><label>Condition</label><select id="cond-${i.id}"><option>Good</option><option>Fair</option><option>Damaged</option></select></div><div class="field"><label>Discrepancy (leave blank if acceptable)</label><input id="disc-${i.id}" placeholder="Missing charger / damaged screen…"></div></div></div>`).join("")}`;
    modal(
      "Receive and inspect returned assets",
      "Confirm physical receipt per actual asset.",
      body,
      `<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="submitReceive(${id})">Record receipt</button>`,
    );
  } catch (e) {
    toast(e.message, "error");
  }
};
window.submitReceive = async function (id) {
  const items = $$(".receiveItem:checked").map((x) => ({
    item_id: Number(x.value),
    condition: $("#cond-" + x.value).value,
    discrepancy: $("#disc-" + x.value).value,
  }));
  try {
    await api(`/movements/${id}/receive`, {
      method: "POST",
      body: JSON.stringify({ items }),
    });
    closeModal();
    await refresh();
    toast("Return inspection recorded");
  } catch (e) {
    toast(e.message, "error");
  }
};
// Add receive action to movement details for authorized receiving roles.
const oldOpen = openMovement;
openMovement = async function (id) {
  await oldOpen(id);
  const m = data.movements.find((x) => x.id === id);
  if (
    m &&
    can("STORES_IT") &&
    ["AWAITING_RECEIPT", "PARTIAL_RETURN"].includes(m.status)
  ) {
    const f = $(".modal-foot");
    if (f)
      f.insertAdjacentHTML(
        "afterbegin",
        `<button class="btn primary" onclick="receiveMovement(${id})">Receive / inspect</button>`,
      );
  }
};
$$(".nav-item").forEach((x) => x.addEventListener("click", () => {}));
(async () => {
  if (token) {
    try {
      await refresh();
      showApp();
    } catch {
      token = "";
      localStorage.removeItem("af_token");
      showLogin();
    }
  } else showLogin();
})();
