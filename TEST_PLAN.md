# Smudge — Test Plan

Manifest V3 Chrome extension. Three surfaces to cover: the content script
(`content.js`, the actual blur/box engine), the background service worker
(`background.js`, install-time onboarding), and the popup (`popup.html`/`popup.js`,
the on/off switch).

## Automated (Puppeteer) — `tests/run.js`

Loads the unpacked extension into a real Chromium instance and drives it against
a local static fixture page served on two different hostnames (`localhost` and
`127.0.0.1`) to test per-domain storage isolation. Runs with `npm test`.

| # | Case | What it proves |
|---|------|-----------------|
| 1 | Extension loads | `manifest.json` is valid; background service worker starts; `chrome.runtime.getManifest().name === "Smudge"` |
| 2 | Content script injects | `GET_BLUR_MODE` message round-trips on a fresh page load — content script attached its listener |
| 3 | Blur mode toggle | `SET_BLUR_MODE {active:true}` sets `cursor:crosshair` on `<body>` and shows the `.sb-hint` onboarding toast |
| 4 | Click-to-blur | Clicking an element in blur mode adds `.sb-blurred`; clicking it again removes it (toggle, not one-way) |
| 5 | Drag-to-box | Dragging past the 5px threshold creates a `.sb-box` overlay positioned/sized to match the drag rectangle |
| 6 | Click box removes it | Clicking an existing `.sb-box` deletes it (and only it) |
| 7 | Persistence across reload | Blurred element + box survive a full page reload, restored from `chrome.storage.local` keyed by `sb_blurred_<hostname>` |
| 8 | Clear All | `CLEAR_ALL` strips every `.sb-blurred` class and `.sb-box` element, and resets storage to `{elements:[],boxes:[]}` |
| 9 | Cross-domain isolation | Blurring on `localhost` does not affect or appear on `127.0.0.1` — separate storage keys, separate DOM state |
| 10 | Graceful failure on script-less tabs | Messaging a tab with no content script (e.g. a `chrome://` page) surfaces `chrome.runtime.lastError` instead of hanging — this is the exact path `popup.js`'s `setUnavailable()` depends on |

Tests 3–9 drive the content script the same way the popup does — via
`chrome.tabs.sendMessage` — but issued from the background service worker context
instead of by rendering `popup.html`. This sidesteps a real flakiness source:
Puppeteer has no built-in way to click a toolbar action icon, and opening
`popup.html` as a plain tab changes which tab Chrome considers "active," which
`popup.js`'s own `chrome.tabs.query({active:true, currentWindow:true})` depends
on. Driving the same messages directly exercises identical code paths in
`content.js` without that timing hazard.

## Manual — popup chrome (not automated)

These need an actual toolbar click, so they're a 2-minute manual pass after
loading the unpacked extension in `chrome://extensions`:

1. Click the Smudge icon on a normal page → popup shows "Turn Blur Mode On" (red).
2. Click it → button flips to "Turn Blur Mode Off" (green), page shows the hint toast.
3. Click "Clear All Blurs Here" with nothing blurred → no error.
4. Click the icon on a `chrome://` or Web Store page → both buttons disabled,
   red "Smudge can't run on this page" message shown.
5. Fresh install → a Welcome tab (`welcome.html`) opens automatically.

## Out of scope for now

- Cross-browser (Edge/Brave) — same Chromium engine, low risk, not tested.
- Visual regression on the blur/box CSS (`backdrop-filter` rendering) — needs
  pixel-diffing, not worth it pre-launch.
- Chrome Web Store review-time checks (CWS policy compliance) — separate pass
  before submission.

## Running it

```bash
npm install   # once
npm test
```
