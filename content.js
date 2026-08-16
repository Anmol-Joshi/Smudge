(function () {
  const domain = location.hostname;
  const storageKey = `sb_blurred_${domain}`;
  const DRAG_THRESHOLD = 5; // px of movement before a click becomes a drag

  let blurModeActive = false;
  let hoveredEl = null;
  let dragState = null; // { startX, startY, previewEl, downTarget }

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

  function getState() {
    return new Promise((resolve) => {
      chrome.storage.local.get([storageKey], (result) => {
        resolve(result[storageKey] || { elements: [], boxes: [] });
      });
    });
  }

  function saveState(state) {
    chrome.storage.local.set({ [storageKey]: state });
  }

  function makeBoxEl(box) {
    const div = document.createElement("div");
    div.className = "sb-box";
    div.dataset.sbBoxId = box.id;
    div.style.left = `${box.left}px`;
    div.style.top = `${box.top}px`;
    div.style.width = `${box.width}px`;
    div.style.height = `${box.height}px`;
    document.body.appendChild(div);
    return div;
  }

  async function restoreState() {
    const state = await getState();
    state.elements.forEach((path) => {
      const el = resolvePath(path);
      if (el) el.classList.add("sb-blurred");
    });
    state.boxes.forEach((box) => makeBoxEl(box));
  }

  async function toggleElementBlur(el) {
    const path = getPath(el);
    el.classList.toggle("sb-blurred");
    const isBlurred = el.classList.contains("sb-blurred");
    const state = await getState();
    state.elements = isBlurred
      ? [...new Set([...state.elements, path])]
      : state.elements.filter((p) => p !== path);
    saveState(state);
  }

  async function addBox(rect) {
    const box = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      left: Math.round(rect.left + window.scrollX),
      top: Math.round(rect.top + window.scrollY),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    makeBoxEl(box);
    const state = await getState();
    state.boxes = [...state.boxes, box];
    saveState(state);
  }

  async function removeBox(boxEl) {
    const id = boxEl.dataset.sbBoxId;
    boxEl.remove();
    const state = await getState();
    state.boxes = state.boxes.filter((b) => b.id !== id);
    saveState(state);
  }

  function onMouseOver(e) {
    if (!blurModeActive || dragState) return;
    if (e.target.classList.contains("sb-box")) return;
    if (hoveredEl) hoveredEl.classList.remove("sb-hover-outline");
    hoveredEl = e.target;
    hoveredEl.classList.add("sb-hover-outline");
  }

  function onMouseOut(e) {
    if (!blurModeActive) return;
    e.target.classList.remove("sb-hover-outline");
  }

  function onMouseDown(e) {
    if (!blurModeActive) return;
    e.preventDefault();
    e.stopPropagation();
    dragState = {
      startX: e.clientX,
      startY: e.clientY,
      downTarget: e.target,
      previewEl: null,
    };
  }

  function onMouseMove(e) {
    if (!dragState) return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    if (!dragState.previewEl && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      const preview = document.createElement("div");
      preview.className = "sb-drawing";
      document.body.appendChild(preview);
      dragState.previewEl = preview;
    }
    if (dragState.previewEl) {
      const left = Math.min(dragState.startX, e.clientX);
      const top = Math.min(dragState.startY, e.clientY);
      const width = Math.abs(dx);
      const height = Math.abs(dy);
      Object.assign(dragState.previewEl.style, {
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
      });
    }
  }

  function onMouseUp(e) {
    if (!dragState) return;
    const wasDrag = !!dragState.previewEl;
    if (wasDrag) {
      const rect = dragState.previewEl.getBoundingClientRect();
      dragState.previewEl.remove();
      if (rect.width > DRAG_THRESHOLD && rect.height > DRAG_THRESHOLD) {
        addBox(rect);
      }
    } else {
      const target = dragState.downTarget;
      if (target.classList.contains("sb-box")) {
        removeBox(target);
      } else {
        toggleElementBlur(target);
      }
    }
    dragState = null;
  }

  function showHint() {
    const existing = document.querySelector(".sb-hint");
    if (existing) existing.remove();
    const hint = document.createElement("div");
    hint.className = "sb-hint";
    hint.textContent =
      "Blur Mode is on — click anything to blur it, or drag to draw a box. Click a blurred item again to remove it.";
    document.body.appendChild(hint);
    setTimeout(() => hint.remove(), 6000);
  }

  function setBlurMode(active) {
    blurModeActive = active;
    if (!active && hoveredEl) {
      hoveredEl.classList.remove("sb-hover-outline");
      hoveredEl = null;
    }
    document.body.style.cursor = active ? "crosshair" : "";
    if (active) showHint();
  }

  async function clearAll() {
    document
      .querySelectorAll(".sb-blurred")
      .forEach((el) => el.classList.remove("sb-blurred"));
    document.querySelectorAll(".sb-box").forEach((el) => el.remove());
    saveState({ elements: [], boxes: [] });
  }

  document.addEventListener("mouseover", onMouseOver, true);
  document.addEventListener("mouseout", onMouseOut, true);
  document.addEventListener("mousedown", onMouseDown, true);
  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("mouseup", onMouseUp, true);

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

  restoreState();
})();
