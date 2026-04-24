import { chromium, Browser, Page, BrowserContext } from "playwright";
import * as fs from "fs";
import * as path from "path";

const URL = "https://curry-time.vercel.app/";

interface PageErrorInfo {
  pageErrors: string[];
  consoleErrors: string[];
}

function attachErrorLoggers(page: Page, bucket: PageErrorInfo) {
  page.on("pageerror", (err) => {
    bucket.pageErrors.push(err.message);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      bucket.consoleErrors.push(msg.text());
    }
  });
}

async function clickButtonByText(page: Page, text: string, timeoutMs = 10000) {
  const locator = page.getByText(text, { exact: false }).first();
  await locator.waitFor({ state: "visible", timeout: timeoutMs });
  await locator.click({ force: true });
}

async function run() {
  const seriesDir = "/tmp/series";
  if (!fs.existsSync(seriesDir)) fs.mkdirSync(seriesDir, { recursive: true });
  // Clean any old frames in series dir
  for (const f of fs.readdirSync(seriesDir)) {
    if (f.startsWith("f") && f.endsWith(".png")) {
      fs.unlinkSync(path.join(seriesDir, f));
    }
  }

  const browser: Browser = await chromium.launch({ headless: true });
  const errors: PageErrorInfo = { pageErrors: [], consoleErrors: [] };

  try {
    const context: BrowserContext = await browser.newContext({
      viewport: { width: 1024, height: 1366 },
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: false,
    });
    const page = await context.newPage();
    attachErrorLoggers(page, errors);

    await page.goto(URL, { waitUntil: "networkidle" });
    await clickButtonByText(page, "▶ PLAY");
    await clickButtonByText(page, "Kayden Stark");
    await clickButtonByText(page, "FREE THROW");

    // Wait for canvas + assets to load.
    await page.waitForTimeout(2500);

    const canvas = page.locator("canvas").first();
    await canvas.waitFor({ state: "visible", timeout: 10000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error("Canvas bounding box is null");
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;

    // Start hold at t=0.
    await page.mouse.move(x, y);
    await page.mouse.down();

    // Frame A — charging (200ms into hold, still charging meter).
    await page.waitForTimeout(200);
    const frameA = "/tmp/frame-A-charging.png";
    await page.screenshot({ path: frameA, fullPage: false });
    console.log(`Saved: ${frameA}`);

    // Complete hold — total of 485ms (need 285ms more).
    await page.waitForTimeout(285);
    await page.mouse.up();
    const releaseTs = Date.now();
    console.log(`Released at t=${releaseTs}`);

    // Dense sampling: every ~80ms for 30 iterations (~2.4s total).
    const totalFrames = 30;
    const intervalMs = 80;
    for (let i = 1; i <= totalFrames; i++) {
      const nn = i.toString().padStart(2, "0");
      const frameStart = Date.now();
      const framePath = `${seriesDir}/f${nn}.png`;
      await page.screenshot({ path: framePath, fullPage: false });
      const elapsedSinceRelease = Date.now() - releaseTs;
      console.log(`f${nn}.png captured at +${elapsedSinceRelease}ms`);
      const elapsed = Date.now() - frameStart;
      const wait = intervalMs - elapsed;
      if (wait > 0) await page.waitForTimeout(wait);
    }

    console.log("Series capture complete. Browser will remain open until close below.");

    // Don't close browser yet (per instructions) — but we do close after returning control
    // to the caller (this script). We finalize cleanup below.
    await context.close();
  } finally {
    await browser.close();
  }

  console.log(`\n=== Error summary ===`);
  console.log(`Page errors: ${errors.pageErrors.length}`);
  for (const e of errors.pageErrors) console.log("  - " + e);
  console.log(`Console errors: ${errors.consoleErrors.length}`);
  for (const e of errors.consoleErrors) console.log("  - " + e);
  console.log("\n=== Capture Done ===\n");
}

run().catch((err) => {
  console.error("verify-5frames script crashed:", err);
  process.exit(1);
});
