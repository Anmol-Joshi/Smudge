const toggleBtn = document.getElementById("toggle");
const clearBtn = document.getElementById("clear");
const statusEl = document.getElementById("status");

let activeTabId = null;

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) =>
      resolve(tabs[0])
    );
  });
}

function sendToTab(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ error: chrome.runtime.lastError.message });
        return;
      }
      resolve(res || {});
    });
  });
}

function setUnavailable() {
  toggleBtn.disabled = true;
  clearBtn.disabled = true;
  statusEl.textContent =
    "Smudge can't run on this page. Try a regular website, or reload the tab if you just installed/updated the extension.";
}

function render(active) {
  toggleBtn.classList.toggle("active", active);
  toggleBtn.textContent = active ? "Turn Blur Mode Off" : "Turn Blur Mode On";
}

async function init() {
  const tab = await getActiveTab();
  if (!tab || !tab.id) {
    setUnavailable();
    return;
  }
  activeTabId = tab.id;

  const res = await sendToTab(activeTabId, { type: "GET_BLUR_MODE" });
  if (res.error) {
    setUnavailable();
    return;
  }
  render(res.active);
}

toggleBtn.addEventListener("click", async () => {
  if (activeTabId == null) return;
  const isActive = toggleBtn.classList.contains("active");
  const res = await sendToTab(activeTabId, {
    type: "SET_BLUR_MODE",
    active: !isActive,
  });
  if (res.error) {
    setUnavailable();
    return;
  }
  render(!isActive);
});

clearBtn.addEventListener("click", async () => {
  if (activeTabId == null) return;
  const res = await sendToTab(activeTabId, { type: "CLEAR_ALL" });
  if (res.error) setUnavailable();
});

init();
