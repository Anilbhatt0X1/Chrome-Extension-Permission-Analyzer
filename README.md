# Chrome Analyzer
### Chrome Extension Permission Analyzer

> Batch-audit Chrome extension IDs — inspect permissions, host access, metadata, and source code directly from Google's CRX servers. No third-party services. No rate limits. No data leaks.

---

## Why We Built This

Chrome extensions run inside your browser with elevated trust. Many extensions request sweeping permissions — access to **all websites**, the ability to **read cookies**, **intercept network requests**, or **inject scripts** into every page you visit. Most users (and even developers) install extensions without ever reviewing what they actually have access to.

We built **Chrome Analyzer** because:

- **The Chrome Web Store UI hides the full picture.** The store shows a simplified permissions summary, but the raw `manifest.json` tells a different story — wildcard host permissions like `<all_urls>`, `*://*/*`, or domain-specific patterns are not prominently surfaced.

- **Security audits need bulk analysis.** When auditing a company's browser fleet, an IT or security team may need to scan hundreds of extension IDs at once. Going through each one manually on the Web Store is not practical.

- **Third-party scrapers are a risk.** Existing tools that fetch extension metadata rely on third-party APIs or scrape the Web Store — introducing rate limits, potential data logging, and a dependency you don't control.

- **Removed and unlisted extensions leave a footprint.** When an extension is pulled from the store, it disappears from the UI but may still be installed in browsers across your organization. Chrome Analyzer flags these so you know what's gone dark.

- **Researchers and pentesters need the source.** During a browser extension security review, being able to download the full ZIP of an extension in one click — without installing it — saves significant time.

**Chrome Analyzer fetches everything directly from Google's own CRX update endpoint** — the same one Chrome uses internally when it installs or updates extensions. No middlemen, no accounts, no API keys.

---

## Features

| Feature | Description |
|---------|-------------|
| **Batch scan** | Paste a list of IDs or URLs, or upload a `.txt` / `.csv` file |
| **Scan installed** | One click audits every extension currently installed in your browser |
| **Direct CRX fetch** | Pulls `manifest.json` straight from `clients2.google.com` — Google's own CDN |
| **Permission audit** | Shows host permissions and content script matches — wildcard domains, `<all_urls>`, specific sites |
| **Danger detection** | Auto-flags extensions with high-risk permissions (`cookies`, `webRequest`, `tabs`, `<all_urls>`, etc.) with a ⚠️ badge |
| **Row detail panel** | Click any row to open a slide-in panel showing all fields, API permissions, manifest version, and risk assessment |
| **Sort columns** | Click Extension ID, Name, or Version headers to sort ascending / descending |
| **Dynamic flags** | Search any domain or keyword to instantly highlight matching permissions |
| **Download ZIP** | Save any extension's full source code as a ZIP with one click |
| **Export HTML report** | Self-contained HTML report for offline review or sharing |
| **Export CSV** | Export results to `.csv` for Excel / Google Sheets analysis |
| **Not-found tracking** | Logs IDs with no CRX — removed, unlisted, or never published |
| **Collapsible input card** | Minimise the scan panel to reclaim screen space after starting a scan |
| **Paste + file combined** | Merge IDs from both sources; duplicates removed automatically |
| **URL input support** | Paste Chrome Web Store URLs directly — IDs extracted automatically |
| **Search with match count** | Filter by ID, name, version, description, or permission — shows "N of M" |
| **No third-party APIs** | 100% private; all requests go directly to Google |

---

## Installation

1. **Download or clone** this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked** and select the `Chrome-Extension-Permission-Analyzer/` folder
5. Click the **Chrome Analyzer** icon in the toolbar to open the dashboard

> Clicking the icon opens a full-page dashboard tab — there is no popup.

---

## Usage

### Step-by-step

1. **Open the dashboard** by clicking the Chrome Analyzer icon in the toolbar

2. **Provide extension IDs** using any method:
   - **Paste** into the text area — IDs, URLs, or a comma-separated mix
   - **Upload** a `.txt` or `.csv` file
   - Click **📋 Scan Installed** to automatically load every extension installed in your browser

3. Click **▶ Start Scan** — results stream in live as each extension is fetched

4. **Search** the results by ID, name, version, description, host permission, or content script domain
   - The **Flags** column highlights entries that match your query
   - A **match count** (e.g. `5 of 120`) appears next to the search box

5. **Sort** the table by clicking any of the Extension ID, Name, or Ver column headers — click again to reverse order

6. Look for **⚠️ Danger** badges in the Name column — these flag extensions with high-risk permissions automatically, no search query needed

7. **Click any row** to open the detail panel — shows all fields including API permissions, manifest version, and a full risk assessment

8. Click **Download ZIP** on any row to save that extension's full source code

9. Click **💾 Save Report** to export all results as a standalone HTML file

10. Click **📊 Save CSV** to export results to a spreadsheet-ready `.csv` file

11. Click **⬇ Not Found List** to save a plain-text list of missing IDs

12. Click the **🚀 Scan Extensions** title bar to collapse or expand the input panel

---

### Supported input formats

| Format | Example |
|--------|---------|
| Plain extension ID | `kiccamanopmmlpcjlgcdejodagakdiko` |
| Chrome Web Store URL (new) | `https://chromewebstore.google.com/detail/name/id` |
| Chrome Web Store URL (old) | `https://chrome.google.com/webstore/detail/name/id` |
| Base64-encoded ID | `aWhmbWNiYWRha2plaG5lYWlqZWJocG9na2VnYWpnbms=` |
| Comma-separated | `id1,id2,id3` |
| One per line (txt/csv) | Standard list file |
| Mixed in any combination | File + paste merged, deduped, sorted |

---

## Danger Detection

Chrome Analyzer automatically flags extensions as ⚠️ **Dangerous** when their manifest declares any of the following:

**High-risk API permissions**

| Permission | Risk |
|-----------|------|
| `cookies` | Read and write cookies for any site |
| `webRequest` / `webRequestBlocking` | Intercept and modify all network traffic |
| `tabs` | Access URLs and titles of all open tabs |
| `history` | Read full browser history |
| `management` | List, enable, disable, or uninstall other extensions |
| `debugger` | Attach a debugger to any tab |
| `nativeMessaging` | Communicate with native applications on the host OS |
| `proxy` | Control browser proxy settings |
| `privacy` | Modify browser privacy settings |
| `contentSettings` | Change per-site content settings |

**Wildcard host patterns**

| Pattern | Scope |
|---------|-------|
| `<all_urls>` | All URLs |
| `*://*/*` | All HTTP and HTTPS URLs |
| `http://*/*` | All HTTP URLs |
| `https://*/*` | All HTTPS URLs |

> The danger flag is always visible — it does not require a search query to appear.

---

## How It Works

### Fetch pipeline

```
Extension ID  (or Chrome Web Store URL)
    │
    │  extract 32-char ID from URL if needed
    ▼
Fetch CRX from clients2.google.com/
    │
    ▼
Verify magic bytes  "Cr24"  (0x43 0x72 0x32 0x34)
    │  invalid → NOT FOUND, skip to next ID
    ▼
Strip CRX header  →  extract embedded ZIP
    │
    ▼
Parse ZIP in pure JavaScript (no libraries)
  · Find EOCD record       (signature 0x06054B50)
  · Walk Central Directory (signature 0x02014B50)
  · Locate manifest.json entry
  · Decompress with DecompressionStream("deflate-raw") if needed
    │
    ▼
Extract fields: name, version, manifest_version, description,
                permissions, host_permissions, content_scripts_matches
    │
    ▼
Run danger analysis → flag high-risk permissions
    │
    ▼
Stream result to dashboard in real time
```

### CRX binary format

```
CRX v2:  [magic 4B][version 4B][keyLen 4B][sigLen 4B][key][sig][ZIP…]
CRX v3:  [magic 4B][version 4B][headerLen 4B][protobuf header][ZIP…]
```

### Concurrency

Up to **5 IDs are fetched in parallel** (configurable via `MAX_CONCURRENT` in `background.js`).

---

## File Structure

```
chrome-ext/
├── manifest.json        MV3 extension manifest
├── background.js        Service worker — CRX fetch, ZIP parsing, downloads
├── dashboard.html       Full-page dashboard UI
├── dashboard.js         Dashboard logic — input, scan, render, search, sort, export
├── icons/
│   ├── icon.svg         Master icon source
│   ├── icon16.png       ← generated
│   ├── icon32.png       ← generated
│   ├── icon48.png       ← generated
│   └── icon128.png      ← generated
├── popup.html           (legacy — no longer used)
├── popup.js             (legacy — no longer used)
├── README.md            This file
└── LICENSE              MIT licence
```

---

## Permissions

| Permission | Why it's needed |
|-----------|-----------------|
| `storage` | Persists not-found IDs across sessions so you don't lose your history |
| `downloads` | Saves ZIP files, HTML reports, and CSV exports to your Downloads folder |
| `management` | Lists installed extensions for the one-click Scan Installed feature |
| `*://clients2.google.com/*` | Fetches CRX packages from Google's own CDN |
| `*://clients2.googleusercontent.com/*` | Alternative Google CDN endpoint for some CRX deliveries |

---

## Privacy

- **No data leaves your browser** except to `clients2.google.com` (Google's CDN — the same server Chrome itself uses)
- **No account, no API key, no sign-up** required
- **No analytics or telemetry** of any kind
- All state is stored in `chrome.storage.local` — your browser only, never synced externally

---

## Use Cases

- **Security teams** auditing which extensions are installed across a browser fleet and what they can access
- **Developers** reviewing competitor or partner extensions before integrating or trusting them
- **Researchers** investigating extensions for supply-chain risks, data exfiltration patterns, or overly broad permissions
- **IT administrators** identifying removed/unlisted extensions that may still be deployed
- **Bug bounty hunters** examining extension source code without installing unknown software

---

## Contributing

Pull requests are welcome. Please open an issue first to discuss any significant changes.

1. Fork the repository
2. Create a feature branch — `git checkout -b feature/my-feature`
3. Commit your changes
4. Open a Pull Request

---

## License

[MIT](LICENSE) — free to use, modify, and distribute.
