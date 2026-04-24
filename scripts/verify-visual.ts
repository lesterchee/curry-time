import { chromium, Browser, Page, BrowserContext } from "playwright";

const URL = "https://curry-time.vercel.app/";

interface PageErrorInfo {
  pageErrors: string[];
  consoleErrors: string[];
  consoleWarnings: string[];
}

interface ViewportConfig {
  name: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  hasTouch: boolean;
}

const VIEWPORTS: ViewportConfig[] = [
  {
    name: "ipad-portrait",
    width: 1024,
    height: 1366,
    deviceScaleFactor: 2,
    hasTouch: true,
  },
  {
    name: "iphone-landscape",
    width: 844,
    height: 390,
    deviceScaleFactor: 3,
    hasTouch: true,
  },
];

function attachErrorLoggers(page: Page, bucket: PageErrorInfo) {
  page.on("pageerror", (err) => {
    bucket.pageErrors.push(err.message);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      bucket.consoleErrors.push(msg.text());
    } else if (msg.type() === "warning") {
      bucket.consoleWarnings.push(msg.text());
    }
  });
}

async function clickButtonByText(page: Page, text: string, timeoutMs = 10000) {
  const locator = page.getByText(text, { exact: false }).first();
  await locator.waitFor({ state: "visible", timeout: timeoutMs });
  await locator.click({ force: true });
}

async function runViewport(browser: Browser, vp: ViewportConfig) {
  console.log(`\n=== Viewport: ${vp.name} (${vp.width}x${vp.height}) ===`);

  const context: BrowserContext = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.deviceScaleFactor,
    hasTouch: vp.hasTouch,
    isMobile: false,
  });
  const page = await context.newPage();

  const errors: PageErrorInfo = {
    pageErrors: [],
    consoleErrors: [],
    consoleWarnings: [],
  };
  attachErrorLoggers(page, errors);

  await page.goto(URL, { waitUntil: "networkidle" });
  await clickButtonByText(page, "▶ PLAY");
  await clickButtonByText(page, "Kayden Stark");
  await clickButtonByText(page, "FREE THROW");

  // Wait for canvas + assets.
  await page.waitForTimeout(600);

  const screenShotPath = `/tmp/curry-${vp.name}-shot-screen.png`;
  await page.screenshot({ path: screenShotPath, fullPage: true });
  console.log(`Saved: ${screenShotPath}`);

  // Take a shot at canvas center with 485ms hold (perfect-timing sweet spot).
  const canvas = page.locator("canvas").first();
  await canvas.waitFor({ state: "visible", timeout: 10000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas bounding box is null");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(485);
  await page.mouse.up();

  // Wait for ball flight + banner.
  await page.waitForTimeout(1800);

  const swishPath = `/tmp/curry-${vp.name}-swish-screen.png`;
  await page.screenshot({ path: swishPath, fullPage: true });
  console.log(`Saved: ${swishPath}`);

  await context.close();

  if (
    errors.pageErrors.length === 0 &&
    errors.consoleErrors.length === 0
  ) {
    console.log(`[${vp.name}] No page errors or console errors captured.`);
  } else {
    console.log(
      `[${vp.name}] Page errors (${errors.pageErrors.length}):`
    );
    for (const e of errors.pageErrors) console.log("  - " + e);
    console.log(
      `[${vp.name}] Console errors (${errors.consoleErrors.length}):`
    );
    for (const e of errors.consoleErrors) console.log("  - " + e);
  }
  if (errors.consoleWarnings.length > 0) {
    console.log(
      `[${vp.name}] Console warnings (${errors.consoleWarnings.length}):`
    );
    for (const w of errors.consoleWarnings) console.log("  - " + w);
  }
}

async function run() {
  const browser: Browser = await chromium.launch({ headless: true });
  try {
    for (const vp of VIEWPORTS) {
      await runViewport(browser, vp);
    }
  } finally {
    await browser.close();
  }
  console.log("\n=== Done ===\n");
}

run().catch((err) => {
  console.error("Visual verification script crashed:", err);
  process.exit(1);
});
