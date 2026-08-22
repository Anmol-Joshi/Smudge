const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const puppeteer = require("puppeteer");

const EXT_PATH = path.resolve(__dirname, "..");
const FIXTURE = fs.readFileSync(
  path.join(__dirname, "fixtures", "page.html"),
  "utf8"
);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(FIXTURE);
    });
    server.listen(0, "0.0.0.0", () => resolve(server));
  });
}

async function getExtensionId(browser) {
  const target = await browser.waitForTarget(
    (t) => t.type() === "service_worker" && t.url().includes("background.js")
  );
  return target.url().split("/")[2];
}

async function sendToTab(worker, urlSubstring, message) {
  return worker.evaluate(
    (urlSubstring, message) =>
      new Promise((resolve) => {
        chrome.tabs.query({}, (tabs) => {
          const tab = tabs.find((t) => t.url && t.url.includes(urlSubstring));
          if (!tab) {
            resolve({ error: "no matching tab" });
            return;
          }
          chrome.tabs.sendMessage(tab.id, message, (res) => {
            if (chrome.runtime.lastError) {
              resolve({ error: chrome.runtime.lastError.message });
              return;
            }
            resolve(res || {});
          });
        });
      }),
    urlSubstring,
    message
  );
}

async function main() {
  const server = await startServer();
  const port = server.address().port;
  const urlA = `http://localhost:${port}/page.html`;
  const urlB = `http://127.0.0.1:${port}/page.html`;

  const browser = await puppeteer.launch({
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      "--no-sandbox",
    ],
  });

  const results = [];
  async function test(name, fn) {
    try {
      await fn();
      results.push({ name, ok: true });
      console.log(`  ok  - ${name}`);
    } catch (err) {
      results.push({ name, ok: false, err });
      console.log(`FAIL  - ${name}`);
      console.log(`        ${err.message}`);
    }
  }

  try {
    const extensionId = await getExtensionId(browser);
    const swTarget = await browser.waitForTarget(
      (t) => t.type() === "service_worker" && t.url().includes(extensionId)
    );
    const worker = await swTarget.worker();

    await test("1. extension loads with correct manifest", async () => {
      const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
      assert(manifest.name === "Smudge", "manifest name mismatch");
      assert(manifest.manifest_version === 3, "expected MV3");
    });

    const page = await browser.newPage();
    await page.goto(urlA, { waitUntil: "networkidle0" });

    await test("2. content script injects and responds", async () => {
      const res = await sendToTab(worker, "page.html", { type: "GET_BLUR_MODE" });
      assert(res.error === undefined, `unexpected error: ${res.error}`);
      assert(res.active === false, "blur mode should start off");
    });

    await test("3. SET_BLUR_MODE activates crosshair + hint", async () => {
      const res = await sendToTab(worker, "page.html", {
        type: "SET_BLUR_MODE",
        active: true,
      });
      assert(res.ok === true, "expected ok response");
      const cursor = await page.evaluate(() => document.body.style.cursor);
      assert(cursor === "crosshair", `expected crosshair cursor, got ${cursor}`);
      const hint = await page.$(".sb-hint");
      assert(hint !== null, "expected onboarding hint to appear");
    });

    await test("4. click toggles blur on then off", async () => {
      const el = await page.$("#target-el");
      const box = await el.boundingBox();
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;

      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.up();
      let blurred = await page.$eval("#target-el", (e) =>
        e.classList.contains("sb-blurred")
      );
      assert(blurred === true, "expected element to be blurred after click");

      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.up();
      blurred = await page.$eval("#target-el", (e) =>
        e.classList.contains("sb-blurred")
      );
      assert(blurred === false, "expected element to be un-blurred after second click");

      // leave it blurred for the persistence test later
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.up();
    });

    await test("5. drag draws a box overlay", async () => {
      const area = await page.$("#open-area");
      const box = await area.boundingBox();
      const startX = box.x + 20;
      const startY = box.y + 20;
      const endX = box.x + 120;
      const endY = box.y + 90;

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 30, startY + 20, { steps: 5 });
      await page.mouse.move(endX, endY, { steps: 5 });
      await page.mouse.up();

      const boxEl = await page.$(".sb-box");
      assert(boxEl !== null, "expected a .sb-box element to be created");
      const rect = await boxEl.evaluate((el) => ({
        left: parseInt(el.style.left, 10),
        top: parseInt(el.style.top, 10),
        width: parseInt(el.style.width, 10),
        height: parseInt(el.style.height, 10),
      }));
      assert(rect.width > 50 && rect.width < 150, `unexpected box width ${rect.width}`);
      assert(rect.height > 40 && rect.height < 110, `unexpected box height ${rect.height}`);
    });

    await test("6. clicking a box removes only that box", async () => {
      const boxEl = await page.$(".sb-box");
      const rect = await boxEl.boundingBox();
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;

      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.up();

      const remaining = await page.$$(".sb-box");
      assert(remaining.length === 0, "expected box to be removed");
    });

    await test("7. state persists across reload", async () => {
      // ensure the element is blurred (it may already be, from test 4)
      // and draw a box, so there's state to persist
      const alreadyBlurred = await page.$eval("#target-el", (e) =>
        e.classList.contains("sb-blurred")
      );
      if (!alreadyBlurred) {
        const el = await page.$("#target-el");
        const ebox = await el.boundingBox();
        await page.mouse.move(ebox.x + ebox.width / 2, ebox.y + ebox.height / 2);
        await page.mouse.down();
        await page.mouse.up();
      }

      const area = await page.$("#open-area");
      const abox = await area.boundingBox();
      await page.mouse.move(abox.x + 10, abox.y + 10);
      await page.mouse.down();
      await page.mouse.move(abox.x + 80, abox.y + 60, { steps: 5 });
      await page.mouse.up();

      const before = await page.$$eval(".sb-blurred, .sb-box", (els) => els.length);
      assert(before === 2, `expected 2 blurred/box elements before reload, got ${before}`);

      await page.reload({ waitUntil: "networkidle0" });

      const blurredAfter = await page.$eval("#target-el", (e) =>
        e.classList.contains("sb-blurred")
      );
      assert(blurredAfter === true, "expected blur to survive reload");
      const boxesAfter = await page.$$(".sb-box");
      assert(boxesAfter.length === 1, `expected 1 box after reload, got ${boxesAfter.length}`);
    });

    await test("8. CLEAR_ALL wipes DOM and storage", async () => {
      const res = await sendToTab(worker, "page.html", { type: "CLEAR_ALL" });
      assert(res.ok === true, "expected ok response");

      const remaining = await page.$$eval(".sb-blurred, .sb-box", (els) => els.length);
      assert(remaining === 0, `expected 0 blurred/box elements, got ${remaining}`);

      const stored = await worker.evaluate(
        () => new Promise((resolve) => {
          chrome.storage.local.get(null, (all) => resolve(all));
        })
      );
      const key = Object.keys(stored).find((k) => k.startsWith("sb_blurred_"));
      assert(key !== undefined, "expected a storage key to exist");
      assert(stored[key].elements.length === 0, "expected elements to be cleared");
      assert(stored[key].boxes.length === 0, "expected boxes to be cleared");
    });

    await test("9. cross-domain isolation", async () => {
      // blur something on hostname A
      await sendToTab(worker, "page.html", { type: "SET_BLUR_MODE", active: true });
      const el = await page.$("#target-el");
      const ebox = await el.boundingBox();
      await page.mouse.move(ebox.x + ebox.width / 2, ebox.y + ebox.height / 2);
      await page.mouse.down();
      await page.mouse.up();

      // open hostname B fresh
      const pageB = await browser.newPage();
      await pageB.goto(urlB, { waitUntil: "networkidle0" });
      const blurredOnB = await pageB.$eval("#target-el", (e) =>
        e.classList.contains("sb-blurred")
      );
      assert(blurredOnB === false, "hostname B should not see hostname A's blur state");

      const stored = await worker.evaluate(
        () => new Promise((resolve) => {
          chrome.storage.local.get(null, (all) => resolve(all));
        })
      );
      assert(
        "sb_blurred_localhost" in stored,
        "expected a separate storage key for localhost"
      );
      assert(
        !("sb_blurred_127.0.0.1" in stored) ||
          stored["sb_blurred_127.0.0.1"].elements.length === 0,
        "127.0.0.1 storage should be empty/absent"
      );

      await pageB.close();
    });

    await test("10. messaging a tab with no content script fails gracefully", async () => {
      const errPage = await browser.newPage();
      await errPage.goto("chrome://extensions", { waitUntil: "domcontentloaded" });
      const res = await sendToTab(worker, "chrome://extensions", {
        type: "GET_BLUR_MODE",
      });
      assert(res.error !== undefined, "expected a runtime.lastError to surface");
      await errPage.close();
    });
  } finally {
    await browser.close();
    server.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Test run crashed:", err);
  process.exitCode = 1;
});
