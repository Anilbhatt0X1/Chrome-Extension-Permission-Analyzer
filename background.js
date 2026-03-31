// ─── Constants ────────────────────────────────────────────────────────────────
const CRX_BASE     = "https://clients2.google.com/service/update2/crx";
const MAX_CONCURRENT = 5;

// ─── State ────────────────────────────────────────────────────────────────────
let results       = [];
let processedIDs  = new Set();
let activeFetches = 0;
let dashboardTabId = null;

// ─── Open dashboard when icon is clicked ──────────────────────────────────────
chrome.action.onClicked.addListener(() => {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});

// ─── Entry point ──────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "startScan") {
        results       = [];
        processedIDs.clear();
        activeFetches = 0;
        // dashboard is already open — use its tab id from sender
        dashboardTabId = sender.tab.id;
        processQueue([...msg.ids], sender.tab.id);
    }

    if (msg.action === "downloadZip") {
        downloadZip(msg.id).then((ok) => sendResponse({ ok }));
        return true; // keep message channel open for async response
    }
});

// ─── Single ZIP download ──────────────────────────────────────────────────────
async function downloadZip(id) {
    try {
        const ver = getBrowserVersion();
        if (!ver) return false;

        const url = `${CRX_BASE}?response=redirect&prodversion=${ver}` +
                    `&x=id%3D${id}%26installsource%3Dondemand%26uc&acceptformat=crx2,crx3`;

        const response = await fetch(url);
        if (!response.ok) return false;

        const buffer = await response.arrayBuffer();

        const magic = new Uint8Array(buffer, 0, 4);
        if (magic[0] !== 0x43 || magic[1] !== 0x72 ||
            magic[2] !== 0x32 || magic[3] !== 0x34) return false;

        const zipBuffer = crxToZip(buffer);
        if (!zipBuffer) return false;

        const blob    = new Blob([zipBuffer], { type: "application/zip" });
        const dataUrl = await blobToDataUrl(blob);

        chrome.downloads.download({ url: dataUrl, filename: id + ".zip" });
        return true;
    } catch (e) {
        return false;
    }
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader  = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// ─── Queue runner ─────────────────────────────────────────────────────────────
function processQueue(queue, tabId) {
    if (queue.length === 0 && activeFetches === 0) {
        chrome.tabs.sendMessage(tabId, { type: "done", results });
        return;
    }

    while (activeFetches < MAX_CONCURRENT && queue.length > 0) {
        const id = queue.shift();
        activeFetches++;

        processOne(id, tabId).then(() => {
            activeFetches--;
            processQueue(queue, tabId);
        });
    }
}

// ─── Per-ID pipeline ──────────────────────────────────────────────────────────
async function processOne(id, tabId) {
    if (processedIDs.has(id)) return;
    processedIDs.add(id);

    const manifest = await fetchManifest(id);
    const info     = extractInfo(id, manifest);
    const data     = analyze(info);

    results.push(data);
    chrome.tabs.sendMessage(tabId, { type: "update", data });
}

// ─── CRX → ZIP → manifest.json ────────────────────────────────────────────────
async function fetchManifest(id) {
    const ver = getBrowserVersion();
    if (!ver) return null;

    const url = `${CRX_BASE}?response=redirect&prodversion=${ver}` +
                `&x=id%3D${id}%26installsource%3Dondemand%26uc&acceptformat=crx2,crx3`;
    try {
        const response = await fetch(url);
        if (!response.ok) return null;

        const buffer = await response.arrayBuffer();

        // Verify CRX magic "Cr24" (0x43 0x72 0x32 0x34)
        const magic = new Uint8Array(buffer, 0, 4);
        if (magic[0] !== 0x43 || magic[1] !== 0x72 ||
            magic[2] !== 0x32 || magic[3] !== 0x34) return null;

        const zipBuffer = crxToZip(buffer);
        if (!zipBuffer) return null;

        return await readManifestFromZip(zipBuffer);
    } catch (e) {
        return null;
    }
}

function getBrowserVersion() {
    const m = navigator.userAgent.match(
        /Chrom(?:e|ium)\/([0-9]+)\.([0-9]+)\.([0-9]+)\.([0-9]+)/
    );
    return m ? `${m[1]}.${m[2]}.${m[3]}.${m[4]}` : null;
}

function crxToZip(buffer) {
    const arr = new Uint8Array(buffer);
    let offset;

    if (arr[4] === 2) {
        // CRX v2: 16-byte header + key + sig
        const key = arr[8]  + (arr[9]  << 8) + (arr[10] << 16) + (arr[11] << 24);
        const sig = arr[12] + (arr[13] << 8) + (arr[14] << 16) + (arr[15] << 24);
        offset = 16 + key + sig;
    } else {
        // CRX v3: 12-byte header + key (unsigned)
        const key = arr[8] + (arr[9] << 8) + (arr[10] << 16) + (arr[11] << 24 >>> 0);
        offset = 12 + key;
    }

    if (!offset || offset >= buffer.byteLength) return null;
    return buffer.slice(offset);
}

async function readManifestFromZip(zipBuffer) {
    try {
        const view = new DataView(zipBuffer);
        const arr  = new Uint8Array(zipBuffer);
        const dec  = new TextDecoder();

        // Find End-of-Central-Directory record (signature 0x06054B50)
        let eocd = -1;
        for (let i = arr.length - 22; i >= 0; i--) {
            if (view.getUint32(i, true) === 0x06054B50) { eocd = i; break; }
        }
        if (eocd === -1) return null;

        const cdOffset = view.getUint32(eocd + 16, true);
        const cdSize   = view.getUint32(eocd + 12, true);

        // Walk Central Directory to find manifest.json
        let pos = cdOffset;
        while (pos < cdOffset + cdSize) {
            if (view.getUint32(pos, true) !== 0x02014B50) break;

            const compression    = view.getUint16(pos + 10, true);
            const compressedSize = view.getUint32(pos + 20, true);
            const fileNameLen    = view.getUint16(pos + 28, true);
            const extraLen       = view.getUint16(pos + 30, true);
            const commentLen     = view.getUint16(pos + 32, true);
            const localOffset    = view.getUint32(pos + 42, true);
            const fileName       = dec.decode(arr.slice(pos + 46, pos + 46 + fileNameLen));

            if (fileName === "manifest.json") {
                const lfnLen     = view.getUint16(localOffset + 26, true);
                const lfExtraLen = view.getUint16(localOffset + 28, true);
                const dataStart  = localOffset + 30 + lfnLen + lfExtraLen;
                const compressed = arr.slice(dataStart, dataStart + compressedSize);

                if (compression === 0) {
                    return dec.decode(compressed);
                } else if (compression === 8) {
                    const ds     = new DecompressionStream("deflate-raw");
                    const writer = ds.writable.getWriter();
                    writer.write(compressed);
                    writer.close();
                    const reader = ds.readable.getReader();
                    const chunks = [];
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        chunks.push(value);
                    }
                    const total  = chunks.reduce((a, c) => a + c.byteLength, 0);
                    const result = new Uint8Array(total);
                    let off = 0;
                    for (const c of chunks) { result.set(c, off); off += c.byteLength; }
                    return dec.decode(result);
                }
                return null;
            }
            pos += 46 + fileNameLen + extraLen + commentLen;
        }
        return null;
    } catch (e) {
        return null;
    }
}

// ─── Data extraction ──────────────────────────────────────────────────────────
function extractInfo(id, manifestJson) {
    if (!manifestJson) {
        return {
            id, found: false,
            name: "NOT FOUND", version: "-",
            manifest_version: "-",
            description: "-",
            permissions: [], host_permissions: [],
            content_scripts_matches: [], web_accessible_resources: []
        };
    }
    try {
        const m = JSON.parse(manifestJson);

        // ── content_scripts: flatten all matches arrays, deduplicate ──────────
        let csMatches = [];
        if (Array.isArray(m.content_scripts)) {
            m.content_scripts.forEach(cs => {
                if (Array.isArray(cs.matches)) csMatches = csMatches.concat(cs.matches);
            });
            csMatches = [...new Set(csMatches)];
        }

        // ── web_accessible_resources ──────────────────────────────────────────
        // MV2: array of strings
        // MV3: array of { resources: [...], matches: [...] }
        let warResources = [];
        if (Array.isArray(m.web_accessible_resources)) {
            m.web_accessible_resources.forEach(entry => {
                if (typeof entry === "string") {
                    warResources.push(entry);
                } else if (entry && Array.isArray(entry.resources)) {
                    warResources = warResources.concat(entry.resources);
                }
            });
            warResources = [...new Set(warResources)];
        }

        return {
            id, found: true,
            name:                     m.name             || "N/A",
            version:                  m.version          || "N/A",
            manifest_version:         m.manifest_version || 2,
            description:              m.description      || "N/A",
            permissions:              Array.isArray(m.permissions)      ? m.permissions      : [],
            host_permissions:         Array.isArray(m.host_permissions) ? m.host_permissions : [],
            content_scripts_matches:  csMatches,
            web_accessible_resources: warResources
        };
    } catch (e) {
        return {
            id, found: false,
            name: "PARSE ERROR", version: "-",
            description: "-",
            permissions: [], host_permissions: [],
            content_scripts_matches: [], web_accessible_resources: []
        };
    }
}

// ─── Analysis ─────────────────────────────────────────────────────────────────
function analyze(info) {
    return {
        ...info   // host_permissions, content_scripts_matches, web_accessible_resources all passed through as arrays
    };
}
