(function () {
  const domain = location.hostname;
  const storageKey = `sb_blurred_${domain}`;

  let blurModeActive = false;
  let hoveredEl = null;

  function getPath(el) {
    const path = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      const parent = node.parentElement;
      if (!parent) break;
      const index = Array.prototype.indexOf.call(parent.children, node);
      path.unshift(`${node.tagName}:${index}`);
      node = parent;
    }
    return path.join(">");
  }

  function resolvePath(path) {
    if (!path) return null;
    const steps = path.split(">");
    let node = document.body;
    for (const step of steps) {
      const [, indexStr] = step.split(":");
      const index = parseInt(indexStr, 10);
      if (!node || !node.children[index]) return null;
      node = node.children[index];
    }
    return node;
  }

  function getBlurredPaths() {
    return new Promise((resolve) => {
      chrome.storage.local.get([storageKey], (result) => {
        resolve(result[storageKey] || []);
      });
    });
  }

  function saveBlurredPaths(paths) {
    chrome.storage.local.set({ [storageKey]: paths });
  }

  async function restoreBlurredElements() {
    const paths = await getBlurredPaths();
    paths.forEach((path) => {
      const el = resolvePath(path);
      if (el) el.classList.add("sb-blurred");
    });
  }

  async function toggleBlur(el) {
    const path = getPath(el);
    el.classList.toggle("sb-blurred");
    const isBlurred = el.classList.contains("sb-blurred");
    const paths = await getBlurredPaths();
    const next = isBlurred
      ? [...new Set([...paths, path])]
      : paths.filter((p) => p !== path);
    saveBlurredPaths(next);
  }

  function onMouseOver(e) {
    if (!blurModeActive) return;
    if (hoveredEl) hoveredEl.classList.remove("sb-hover-outline");
    hoveredEl = e.target;
    hoveredEl.classList.add("sb-hover-outline");
  }

  function onMouseOut(e) {
    if (!blurModeActive) return;
    e.target.classList.remove("sb-hover-outline");
  }

  function onClick(e) {
    if (!blurModeActive) return;
    e.preventDefault();
    e.stopPropagation();
    toggleBlur(e.target);
  }

  function setBlurMode(active) {
    blurModeActive = active;
    if (!active && hoveredEl) {
      hoveredEl.classList.remove("sb-hover-outline");
      hoveredEl = null;
    }
    document.body.style.cursor = active ? "crosshair" : "";
  }

  async function clearAll() {
    document
      .querySelectorAll(".sb-blurred")
      .forEach((el) => el.classList.remove("sb-blurred"));
    saveBlurredPaths([]);
  }

  document.addEventListener("mouseover", onMouseOver, true);
  document.addEventListener("mouseout", onMouseOut, true);
  document.addEventListener("click", onClick, true);

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "SET_BLUR_MODE") {
      setBlurMode(msg.active);
      sendResponse({ ok: true });
    } else if (msg.type === "GET_BLUR_MODE") {
      sendResponse({ active: blurModeActive });
    } else if (msg.type === "CLEAR_ALL") {
      clearAll();
      sendResponse({ ok: true });
    }
    return true;
  });

  restoreBlurredElements();
})();
