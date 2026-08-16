const toggleBtn = document.getElementById("toggle");
const clearBtn = document.getElementById("clear");

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) =>
      resolve(tabs[0])
    );
  });
}

async function refreshState() {
  const tab = await getActiveTab();
  chrome.tabs.sendMessage(tab.id, { type: "GET_BLUR_MODE" }, (res) => {
    if (chrome.runtime.lastError || !res) return;
    render(res.active);
  });
}

function render(active) {
  toggleBtn.classList.toggle("active", active);
  toggleBtn.textContent = active ? "Turn Blur Mode Off" : "Turn Blur Mode On";
}

toggleBtn.addEventListener("click", async () => {
  const tab = await getActiveTab();
  const isActive = toggleBtn.classList.contains("active");
  chrome.tabs.sendMessage(
    tab.id,
    { type: "SET_BLUR_MODE", active: !isActive },
    () => render(!isActive)
  );
});

clearBtn.addEventListener("click", async () => {
  const tab = await getActiveTab();
  chrome.tabs.sendMessage(tab.id, { type: "CLEAR_ALL" });
});

refreshState();
