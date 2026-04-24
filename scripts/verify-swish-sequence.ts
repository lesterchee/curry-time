import { chromium, Browser, Page, BrowserContext } from "playwright";

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
    await page.waitForTimeout(2000);

    const canvas = page.locator("canvas").first();
    await canvas.waitFor({ state: "visible", timeout: 10000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error("Canvas bounding box is null");
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;

    // Start hold at t=0.
    await page.mouse.move(x, y);
    await page.mouse.down();

    // Frame A — charging (t=200ms into hold, meter still ramping, ball in hand).
    await page.waitForTimeout(200);
    const frameA = "/tmp/swish-a-charging.png";
    await page.screenshot({ path: frameA, fullPage: false });
    console.log(`Saved: ${frameA}`);

    // Hold until total = 485ms (need 285ms more).
    await page.waitForTimeout(285);
    await page.mouse.up();

    // Frame B — mid-arc (500ms after release).
    await page.waitForTimeout(500);
    const frameB = "/tmp/swish-b-midarc.png";
    await page.screenshot({ path: frameB, fullPage: false });
    console.log(`Saved: ${frameB}`);

    // Frame C — at rim (650ms after release, so 150ms after B).
    await page.waitForTimeout(150);
    const frameC = "/tmp/swish-c-at-rim.png";
    await page.screenshot({ path: frameC, fullPage: false });
    console.log(`Saved: ${frameC}`);

    // Frame D — below rim (900ms after release, so 250ms after C).
    await page.waitForTimeout(250);
    const frameD = "/tmp/swish-d-below-rim.png";
    await page.screenshot({ path: frameD, fullPage: false });
    console.log(`Saved: ${frameD}`);

    // Frame E — resolved (2200ms after release, so 1300ms after D).
    await page.waitForTimeout(1300);
    const frameE = "/tmp/swish-e-resolved.png";
    await page.screenshot({ path: frameE, fullPage: false });
    console.log(`Saved: ${frameE}`);

    await context.close();
  } finally {
    await browser.close();
  }

  console.log(`\n=== Error summary ===`);
  console.log(`Page errors: ${errors.pageErrors.length}`);
  for (const e of errors.pageErrors) console.log("  - " + e);
  console.log(`Console errors: ${errors.consoleErrors.length}`);
  for (const e of errors.consoleErrors) console.log("  - " + e);

  console.log("\n=== Done ===\n");
}

run().catch((err) => {
  console.error("Swish sequence verification script crashed:", err);
  process.exit(1);
});
