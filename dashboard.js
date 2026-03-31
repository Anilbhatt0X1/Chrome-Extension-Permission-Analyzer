// ─── DOM refs ─────────────────────────────────────────────────────────────────
const tableEl       = document.getElementById("table");
const searchEl      = document.getElementById("search");
const totalEl       = document.getElementById("total");
const foundEl       = document.getElementById("found");
const notFoundEl    = document.getElementById("notfound");
const statusEl      = document.getElementById("statusMsg");
const notFoundCount = document.getElementById("notfoundCount");
const matchCountEl  = document.getElementById("matchCount");

// ─── State ────────────────────────────────────────────────────────────────────
let allData       = [];
let notFoundIDs   = [];
let loadedFileIDs = [];
let scanComplete  = false;
let sortCol       = null;
let sortDir       = 1;   // 1 = asc, -1 = desc

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("notFoundToggle").addEventListener("click", toggleNotFound);
    document.getElementById("inputCardTitle").addEventListener("click", () => {
        document.getElementById("inputCard").classList.toggle("collapsed");
    });
    document.getElementById("downloadNotFoundBtn").addEventListener("click", downloadNotFound);
    document.getElementById("saveBtn").addEventListener("click", saveReport);
    document.getElementById("startBtn").addEventListener("click", startScan);
    document.getElementById("fileInput").addEventListener("change", onFileChange);
    document.getElementById("pasteInput").addEventListener("input", updateIDCount);
    searchEl.addEventListener("input", render);

    document.getElementById("saveCsvBtn").addEventListener("click", saveCSV);
    document.getElementById("scanInstalledBtn").addEventListener("click", scanInstalled);
    document.getElementById("detailClose").addEventListener("click", closeDetail);
    document.getElementById("detailOverlay").addEventListener("click", (e) => {
        if (e.target.id === "detailOverlay") closeDetail();
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeDetail();
    });
    document.querySelectorAll("th.sortable").forEach(th => {
        th.addEventListener("click", () => {
            const col = th.dataset.sort;
            if (sortCol === col) sortDir = -sortDir;
            else { sortCol = col; sortDir = 1; }
            render();
        });
    });

    // Delegated click — Download ZIP buttons + row detail panel
    tableEl.addEventListener("click", (e) => {
        const btn = e.target.closest(".btn-dl");
        if (btn) {
            const id = btn.dataset.id;
            if (!id) return;
            btn.disabled    = true;
            btn.textContent = "…";
            chrome.runtime.sendMessage({ action: "downloadZip", id }, (res) => {
                if (res && res.ok) {
                    btn.textContent = "Saved";
                } else {
                    btn.textContent = "Error";
                    btn.disabled = false;
                }
            });
            return;
        }
        // Row click → show detail panel
        const tr = e.target.closest("tr");
        if (!tr || !tr.dataset.id) return;
        const item = allData.find(r => r.id === tr.dataset.id);
        if (item) showDetail(item);
    });
});

chrome.storage.local.get(["notFoundIDs"], (res) => {
    if (res.notFoundIDs) notFoundIDs = res.notFoundIDs;
});

// ─── ID normalisation ─────────────────────────────────────────────────────────
// Accepts:
//   1. Plain 32-char extension ID          ihfmcbadakjehneaijebhpogkegajgnk
//   2. Chrome Web Store URL (new)          https://chromewebstore.google.com/detail/name/id
//   3. Chrome Web Store URL (old)          https://chrome.google.com/webstore/detail/name/id
//   4. Any URL containing a 32-char ID as the last path segment
//   5. Base64-encoded ID
function normalizeID(value) {
    value = value.trim();

    // ── 1. URL — extract the last 32-char [a-p] path segment ──────────────────
    if (value.startsWith("http://") || value.startsWith("https://")) {
        // Remove query string / hash, then grab path segments
        const clean    = value.split("?")[0].split("#")[0];
        const segments = clean.split("/").filter(Boolean);
        // Walk segments from the end; return the first valid extension ID
        for (let i = segments.length - 1; i >= 0; i--) {
            if (/^[a-p]{32}$/.test(segments[i])) return segments[i];
        }
        return null; // URL but no valid ID found
    }

    // ── 2. Plain 32-char extension ID ─────────────────────────────────────────
    if (/^[a-p]{32}$/.test(value)) return value;

    // ── 3. Base64-encoded ID ──────────────────────────────────────────────────
    try {
        const decoded = atob(value).trim();
        if (/^[a-p]{32}$/.test(decoded)) return decoded;
    } catch (e) { /* ignore invalid base64 */ }

    return null;
}

// ─── File upload ──────────────────────────────────────────────────────────────
async function onFileChange(e) {
    const file = e.target.files[0];
    if (!file) { loadedFileIDs = []; updateIDCount(); return; }

    const text = await file.text();
    let raw = text.replace(/,/g, "\n");
    loadedFileIDs = raw.split(/\r?\n/)
        .map(x => x.trim())
        .filter(Boolean)
        .map(normalizeID)
        .filter(Boolean);

    updateIDCount();
}

// ─── Collect IDs from both sources ────────────────────────────────────────────
function collectIDs() {
    const pasteText = document.getElementById("pasteInput").value;
    let raw = pasteText.replace(/,/g, "\n");
    const pasteIDs = raw.split(/\r?\n/)
        .map(x => x.trim())
        .filter(Boolean)
        .map(normalizeID)
        .filter(Boolean);

    return [...new Set([...loadedFileIDs, ...pasteIDs])].sort();
}

function updateIDCount() {
    const ids = collectIDs();
    const el = document.getElementById("idCount");
    el.textContent = ids.length > 0
        ? `${ids.length} ID${ids.length !== 1 ? "s" : ""} ready`
        : "";
}

// ─── Start Scan ───────────────────────────────────────────────────────────────
function startScan() {
    const ids = collectIDs();
    if (ids.length === 0) {
        alert("No valid extension IDs found.\nPaste IDs into the text box or upload a .txt / .csv file.");
        return;
    }

    // Reset display state
    allData      = [];
    notFoundIDs  = [];
    scanComplete = false;

    tableEl.innerHTML         = "";
    totalEl.textContent       = "0";
    foundEl.textContent       = "0";
    notFoundEl.textContent    = "0";
    notFoundCount.textContent = "0";
    matchCountEl.textContent  = "";
    statusEl.textContent      = `Starting scan for ${ids.length} ID${ids.length !== 1 ? "s" : ""}…`;

    const btn = document.getElementById("startBtn");
    btn.disabled    = true;
    btn.textContent = "Scanning…";

    chrome.runtime.sendMessage({ action: "startScan", ids });
}

// ─── Messages from background ─────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "update") {
        allData.push(msg.data);
        render();
    }
    if (msg.type === "done") {
        scanComplete = true;
        statusEl.textContent = `Scan complete — ${allData.length} processed`;
        const btn = document.getElementById("startBtn");
        btn.disabled    = false;
        btn.textContent = "\u25B6 Start Scan";
        render();
    }
});

// ─── Render ───────────────────────────────────────────────────────────────────
function render() {
    tableEl.innerHTML = "";

    let found = 0, notFound = 0;
    const notFoundList = [];
    const q = searchEl.value.toLowerCase().trim();

    allData.forEach(r => {
        if (!r.found) {
            notFound++;
            if (!notFoundIDs.includes(r.id)) notFoundIDs.push(r.id);
            notFoundList.push(r.id);
        } else {
            found++;
        }
    });

    chrome.storage.local.set({ notFoundIDs });

    totalEl.textContent       = allData.length;
    foundEl.textContent       = found;
    notFoundEl.textContent    = notFound;
    notFoundCount.textContent = notFound;

    if (!scanComplete && allData.length > 0) {
        statusEl.textContent = `Scanning… ${allData.length} processed so far`;
    }

    // Not-found box
    const box = document.getElementById("notFoundBox");
    if (notFoundList.length > 0) {
        box.innerHTML     = notFoundList.map(id => `<div>${esc(id)}</div>`).join("");
        box.style.display = "block";
    } else {
        box.innerHTML = "<div>No missing extensions yet</div>";
    }

    // Filter rows by search query — host permissions + content scripts
    const filtered = allData.filter(r => {
        if (!q) return true;
        const hostPerms = toArr(r.host_permissions).join(", ");
        const csMatches = toArr(r.content_scripts_matches).join(", ");
        return (
            r.id.includes(q) ||
            (r.name        || "").toLowerCase().includes(q) ||
            (r.version     || "").toLowerCase().includes(q) ||
            (r.description || "").toLowerCase().includes(q) ||
            hostPerms.toLowerCase().includes(q) ||
            csMatches.toLowerCase().includes(q)
        );
    });

    // Sort
    if (sortCol) {
        filtered.sort((a, b) => {
            let va = a[sortCol] || "";
            let vb = b[sortCol] || "";
            if (typeof va === "string") va = va.toLowerCase();
            if (typeof vb === "string") vb = vb.toLowerCase();
            if (va < vb) return -sortDir;
            if (va > vb) return  sortDir;
            return 0;
        });
    }

    // Match count shown only when a query is active
    if (q) {
        matchCountEl.textContent =
            `${filtered.length} match${filtered.length !== 1 ? "es" : ""}` +
            (filtered.length !== allData.length ? ` of ${allData.length}` : "");
    } else {
        matchCountEl.textContent = "";
    }

    // Update sort header indicators
    document.querySelectorAll("th.sortable").forEach(th => {
        th.classList.remove("sort-asc", "sort-desc");
        const arrow = th.querySelector(".sort-arrow");
        if (th.dataset.sort === sortCol) {
            th.classList.add(sortDir === 1 ? "sort-asc" : "sort-desc");
            if (arrow) arrow.textContent = sortDir === 1 ? "↑" : "↓";
        } else {
            if (arrow) arrow.textContent = "⇅";
        }
    });

    // Render rows
    let sno = 0;
    filtered.forEach(r => {
        sno++;
        const tr = document.createElement("tr");
        if (!r.found) tr.className = "row-notfound";
        tr.dataset.id = r.id;

        const dangerBadge = isDangerous(r) && r.found
            ? `<div><span class="danger-flag">⚠️ Danger</span></div>`
            : "";

        tr.innerHTML = `
            <td class="col-sno">${sno}</td>
            <td class="col-id">${esc(r.id)}</td>
            <td class="col-name">${esc(r.name)}${dangerBadge}</td>
            <td class="col-ver">${esc(r.version)}</td>
            <td class="col-desc">${esc(r.description)}</td>
            <td class="col-perm">${renderBadges(toArr(r.host_permissions),        "host")}</td>
            <td class="col-perm">${renderBadges(toArr(r.content_scripts_matches), "cs")}</td>
            <td class="col-flags">${renderFlags(r, q)}</td>
            <td><button class="btn-dl" data-id="${esc(r.id)}"${!r.found ? " disabled" : ""}>Download ZIP</button></td>
        `;
        tableEl.appendChild(tr);
    });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function esc(s) {
    if (!s) return "";
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

// Normalise a permission array field — handles both array and legacy comma-string
function toArr(val) {
    if (Array.isArray(val)) return val;
    if (typeof val === "string") return val.split(", ").filter(Boolean);
    return [];
}

// Build a single typed badge
// type: "host" | "cs" | "war"
function badge(type, text) {
    const cls   = type === "host" ? "badge-host" : type === "cs" ? "badge-cs" : "badge-war";
    const label = type === "host" ? "H"          : type === "cs" ? "CS"       : "WAR";
    return `<span class="badge ${cls}"><span class="badge-type">${label}</span>${esc(text)}</span>`;
}

// Render a column's full list of badges as a vertical stack
function renderBadges(arr, type) {
    if (!arr || arr.length === 0) return "<span style='color:#cbd5e1;font-size:11px'>None</span>";
    const items = arr.map(v => badge(type, v)).join("");
    return `<div class="perm-list">${items}</div>`;
}

// Render Flags column — matched items from host_permissions + content_scripts, colour-coded
function renderFlags(r, q) {
    if (!q) return "";
    const items = [
        ...toArr(r.host_permissions).filter(p => p.toLowerCase().includes(q)).map(p => badge("host", p)),
        ...toArr(r.content_scripts_matches).filter(p => p.toLowerCase().includes(q)).map(p => badge("cs", p))
    ];
    if (items.length === 0) return "";
    return `<div class="perm-list">${items.join("")}</div>`;
}

function toggleNotFound() {
    const box    = document.getElementById("notFoundBox");
    const toggle = document.getElementById("notFoundToggle");
    const show   = box.style.display === "none" || !box.style.display;
    box.style.display = show ? "block" : "none";
    toggle.classList.toggle("open", show);
}

function downloadNotFound() {
    const blob = new Blob([notFoundIDs.join("\n")], { type: "text/plain" });
    const a    = document.createElement("a");
    a.href     = URL.createObjectURL(blob);
    a.download = "not_found_ids.txt";
    a.click();
}

// ─── Save HTML report ─────────────────────────────────────────────────────────
function saveReport() {
    const q = searchEl.value.toLowerCase().trim();
    let sno = 0;

    // Build flag text (plain prefixed list) for the static export
    function flagsText(r) {
        if (!q) return "";
        const matched = [
            ...toArr(r.host_permissions).filter(p => p.toLowerCase().includes(q)).map(p => "[H] " + p),
            ...toArr(r.content_scripts_matches).filter(p => p.toLowerCase().includes(q)).map(p => "[CS] " + p)
        ];
        return matched.join(", ");
    }

    const rows = allData.map(r => {
        sno++;
        return `
        <tr${!r.found ? ' style="color:#bbb;font-style:italic"' : ''}>
            <td style="text-align:center;color:#999;font-size:11px">${sno}</td>
            <td style="font-family:monospace;font-size:10px">${esc(r.id)}</td>
            <td style="font-weight:700">${esc(r.name)}</td>
            <td style="white-space:nowrap">${esc(r.version)}</td>
            <td>${esc(r.description)}</td>
            <td>${esc(toArr(r.host_permissions).join("\n") || "—")}</td>
            <td>${esc(toArr(r.content_scripts_matches).join("\n") || "—")}</td>
            <td>${esc(flagsText(r))}</td>
        </tr>`;
    }).join("");

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>Chrome Analyzer Report</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;padding:24px;font-size:13px;background:#f1f5f9;color:#1e293b}
h2{font-size:20px;font-weight:800;margin-bottom:16px}
.stats{display:flex;gap:16px;flex-wrap:wrap;padding:12px 16px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:16px}
.stats span{font-weight:700;font-size:13px}
.legend{margin-bottom:10px;font-size:12px;color:#64748b}
table{border-collapse:collapse;width:100%;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.07)}
th{background:#f1f5f9;padding:10px 12px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#64748b;text-align:left;white-space:nowrap;border-bottom:2px solid #e2e8f0}
td{border-bottom:1px solid #f1f5f9;padding:8px 12px;font-size:11px;vertical-align:top;white-space:pre-wrap;word-break:break-word}
</style></head><body>
<h2>Chrome Analyzer — Extension Permission Report</h2>
<div class="stats">
  <span>📦 Total: ${totalEl.textContent}</span>
  <span style="color:#10b981">✅ Found: ${foundEl.textContent}</span>
  <span style="color:#ef4444">❌ Not Found: ${notFoundEl.textContent}</span>
  ${q ? `<span style="color:#6366f1">🔍 Filter: &ldquo;${esc(q)}&rdquo; &mdash; ${matchCountEl.textContent}</span>` : ""}
</div>
<div class="legend">Flags: [H] = host_permissions &nbsp;&nbsp;|&nbsp;&nbsp; [CS] = content_scripts matches</div>
<table><thead><tr>
  <th>#</th><th>Extension ID</th><th>Name</th><th>Version</th><th>Description</th>
  <th>Host Permissions</th><th>Content Scripts</th><th>Flags (search match)</th>
</tr></thead><tbody>${rows}</tbody></table>
</body></html>`;

    const blob = new Blob([html], { type: "text/html" });
    const a    = document.createElement("a");
    a.href     = URL.createObjectURL(blob);
    a.download = "chrome_analyzer_report.html";
    a.click();
}

// ─── Dangerous permission detection ───────────────────────────────────────────
const DANGER_PERMS = new Set([
    "cookies", "webRequest", "webRequestBlocking", "tabs",
    "history", "management", "debugger", "nativeMessaging",
    "proxy", "privacy", "contentSettings"
]);
const DANGER_HOSTS = ["<all_urls>", "*://*/*", "http://*/*", "https://*/*"];

function isDangerous(r) {
    if (toArr(r.permissions).some(p => DANGER_PERMS.has(p))) return true;
    if (toArr(r.host_permissions).some(p => DANGER_HOSTS.includes(p))) return true;
    if (toArr(r.content_scripts_matches).some(p => DANGER_HOSTS.includes(p))) return true;
    return false;
}

// ─── Scan installed extensions ────────────────────────────────────────────────
function scanInstalled() {
    const btn = document.getElementById("scanInstalledBtn");
    btn.disabled    = true;
    btn.textContent = "Loading…";

    chrome.management.getAll((exts) => {
        btn.disabled    = false;
        btn.textContent = "📋 Scan Installed";

        const ids = (exts || [])
            .filter(e => e.id !== chrome.runtime.id)
            .map(e => e.id);

        if (ids.length === 0) {
            alert("No installed extensions found.");
            return;
        }

        document.getElementById("pasteInput").value = ids.join("\n");
        updateIDCount();
        document.getElementById("inputCard").classList.remove("collapsed");
        startScan();
    });
}

// ─── Save CSV ─────────────────────────────────────────────────────────────────
function saveCSV() {
    if (allData.length === 0) { alert("No data to export. Run a scan first."); return; }

    function csvCell(val) {
        const s = (val == null) ? "" : String(val);
        if (s.includes(",") || s.includes("\"") || s.includes("\n") || s.includes("\r")) {
            return "\"" + s.replace(/"/g, "\"\"") + "\"";
        }
        return s;
    }

    const cols = ["ID", "Name", "Version", "Description",
                  "Host Permissions", "Content Scripts", "Dangerous", "Found"];
    const rows = allData.map(r => [
        r.id,
        r.name,
        r.version,
        r.description,
        toArr(r.host_permissions).join("; "),
        toArr(r.content_scripts_matches).join("; "),
        isDangerous(r) ? "YES" : "no",
        r.found ? "YES" : "no"
    ].map(csvCell).join(","));

    const csv  = [cols.join(","), ...rows].join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const a    = document.createElement("a");
    a.href     = URL.createObjectURL(blob);
    a.download = "chrome_analyzer_report.csv";
    a.click();
}

// ─── Row detail panel ─────────────────────────────────────────────────────────
function showDetail(r) {
    document.getElementById("detailTitle").textContent = r.name || r.id;

    function detailRow(label, value, mono = true) {
        return `<div class="detail-row">
            <div class="detail-row-label">${label}</div>
            <div class="detail-row-value${mono ? "" : " plain"}">${esc(String(value ?? "—"))}</div>
        </div>`;
    }

    function permSection(title, arr, type) {
        const inner = arr.length
            ? `<div class="detail-perm-list">${arr.map(p => badge(type, p)).join("")}</div>`
            : `<span style="color:#94a3b8;font-size:11px">None</span>`;
        return `<div class="detail-section">
            <div class="detail-section-title">${title}</div>
            ${inner}
        </div>`;
    }

    const dangerous = isDangerous(r);
    const perms     = toArr(r.permissions);
    const hosts     = toArr(r.host_permissions);
    const cs        = toArr(r.content_scripts_matches);

    document.getElementById("detailBody").innerHTML = `
        <div class="detail-section">
            <div class="detail-section-title">Identity</div>
            ${detailRow("Extension ID", r.id)}
            ${detailRow("Name", r.name, false)}
            ${detailRow("Version", r.version)}
            ${detailRow("Manifest Version", r.manifest_version ?? "—")}
            ${detailRow("Status", r.found ? "✅ Found" : "❌ Not Found", false)}
        </div>
        <div class="detail-section">
            <div class="detail-section-title">Risk Assessment</div>
            <div style="font-size:13px;font-weight:700;padding:4px 0;color:${dangerous ? "var(--red)" : "var(--green)"}">
                ${dangerous ? "⚠️ Dangerous permissions detected" : "✅ No high-risk permissions"}
            </div>
        </div>
        <div class="detail-section">
            <div class="detail-section-title">Description</div>
            <div class="detail-row-value plain">${esc(r.description || "—")}</div>
        </div>
        ${permSection("API Permissions", perms, "host")}
        ${permSection("Host Permissions", hosts, "host")}
        ${permSection("Content Script Matches", cs, "cs")}
    `;

    document.getElementById("detailOverlay").style.display = "flex";
}

function closeDetail() {
    document.getElementById("detailOverlay").style.display = "none";
}
