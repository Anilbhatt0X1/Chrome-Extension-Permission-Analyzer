document.getElementById("startBtn").onclick = async () => {
    const file = document.getElementById("fileInput").files[0];
    if (!file) return alert("Upload file");

    const text = await file.text();

    // 🔥 SAME LOGIC FOR TXT + CSV

    // Step 1: normalize everything (comma → newline)
    let raw = text.replace(/,/g, "\n");

    // Step 2: split lines
    let ids = raw.split(/\r?\n/)
        .map(x => x.trim())
        .filter(Boolean)
        .map(normalizeID)
        .filter(Boolean);

    // Step 3: remove duplicates
    ids = [...new Set(ids)];

    // Step 4: sort
    ids.sort();

    alert(`Loaded ${ids.length} unique extensions`);

    chrome.runtime.sendMessage({
        action: "startScan",
        ids
    });
};

// 🔥 NORMALIZE FUNCTION (same as before)
function normalizeID(value) {
    value = value.trim();

    // already valid chrome extension ID
    if (/^[a-p]{32}$/.test(value)) {
        return value;
    }

    // try base64 decode
    try {
        const decoded = atob(value).trim();

        if (/^[a-p]{32}$/.test(decoded)) {
            return decoded;
        }
    } catch (e) {
        // ignore invalid base64
    }

    return null;
}