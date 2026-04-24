import { chromium, Browser, Page, BrowserContext } from "playwright";

const URL = "https://curry-time.vercel.app/";

const MAKE_OUTCOMES = new Set(["SWISH", "SPLASH", "LUCKY"]);
const MISS_OUTCOMES = new Set(["SO CLOSE", "AIR BALL", "BRICK", "OFF THE RIM", "RIM OUT"]);
const ALL_OUTCOMES = [
  "SWISH",
  "SPLASH",
  "LUCKY",
  "SO CLOSE",
  "AIR BALL",
  "BRICK",
  "OFF THE RIM",
  "RIM OUT",
];

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
  // `force: true` because many arcade-style buttons use CSS animations (anim-pulse)
  // which Playwright considers "not stable". The animation is purely cosmetic.
  await locator.click({ force: true });
}

async function waitForCanvas(page: Page) {
  await page.locator("canvas").first().waitFor({ state: "visible", timeout: 10000 });
  return page.locator("canvas").first();
}

async function readBodyText(page: Page): Promise<string> {
  return await page.evaluate(() => document.body.innerText);
}

function parseOutcome(bodyText: string): string {
  // Check outcomes longest-first to prefer SO CLOSE over CLOSE, etc.
  const sorted = [...ALL_OUTCOMES].sort((a, b) => b.length - a.length);
  for (const outcome of sorted) {
    if (bodyText.includes(outcome)) return outcome;
  }
  return "UNKNOWN";
}

async function takeShot(
  page: Page,
  holdMs: number
): Promise<{ outcome: string; bodyText: string }> {
  const canvas = await waitForCanvas(page);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas bounding box is null");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(holdMs);
  await page.mouse.up();

  // Wait for banner to appear / ball flight to finish.
  await page.waitForTimeout(2000);

  const bodyText = await readBodyText(page);
  const outcome = parseOutcome(bodyText);
  return { outcome, bodyText };
}

async function clickShootAgain(page: Page) {
  // After a shot, a "SHOOT AGAIN" button appears. Click it to reset.
  const btn = page.getByText("SHOOT AGAIN", { exact: false }).first();
  await btn.waitFor({ state: "visible", timeout: 8000 });
  await btn.click({ force: true });
  // Give the UI a moment to reset.
  await page.waitForTimeout(400);
}

async function startFromTitle(page: Page) {
  await page.goto(URL, { waitUntil: "networkidle" });
  await clickButtonByText(page, "PLAY");
  await clickButtonByText(page, "Kayden Stark");
}

async function selectFreeThrow(page: Page) {
  await clickButtonByText(page, "FREE THROW");
}

async function selectThreePointer(page: Page) {
  await clickButtonByText(page, "THREE POINTER");
}

async function goBackToShotSelect(page: Page) {
  // Click the top-left shot indicator button — it toggles back to shot select.
  const locator = page.getByText(/(FT · 1PT|3PT · 3PT)/).first();
  await locator.waitFor({ state: "visible", timeout: 5000 });
  await locator.click({ force: true });
  await page.waitForTimeout(400);
}

async function run() {
  const browser: Browser = await chromium.launch({ headless: true });
  const context: BrowserContext = await browser.newContext({
    viewport: { width: 1024, height: 1366 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: false,
  });
  const page = await context.newPage();

  const errors: PageErrorInfo = { pageErrors: [], consoleErrors: [] };
  attachErrorLoggers(page, errors);

  // --- Start: Title → Character → Free Throw ---
  await startFromTitle(page);
  await selectFreeThrow(page);

  // --- Test 1: 10 Free Throws at 485ms (perfect timing) ---
  const ftResults: string[] = [];
  for (let i = 0; i < 10; i++) {
    const { outcome } = await takeShot(page, 485);
    ftResults.push(outcome);
    await clickShootAgain(page);
  }
  const ftMakes = ftResults.filter((o) => MAKE_OUTCOMES.has(o)).length;

  // --- Test 2: switch to 3-pointer, 10 shots at 485ms ---
  await goBackToShotSelect(page);
  await selectThreePointer(page);

  const tpResults: string[] = [];
  for (let i = 0; i < 10; i++) {
    const { outcome } = await takeShot(page, 485);
    tpResults.push(outcome);
    await clickShootAgain(page);
  }
  const tpMakes = tpResults.filter((o) => MAKE_OUTCOMES.has(o)).length;

  // --- Test 3: early release (100ms hold) ---
  const early = await takeShot(page, 100);
  await clickShootAgain(page);

  // --- Test 4: late release (700ms hold) ---
  const late = await takeShot(page, 700);
  await clickShootAgain(page);

  // Capture what localStorage high-scores looks like BEFORE reload.
  const highScoresBefore = await page.evaluate(() => {
    try {
      return window.localStorage.getItem("curry-time:high-scores");
    } catch {
      return null;
    }
  });

  // --- Test 6: verify high score persists across reload ---
  await page.goto(URL, { waitUntil: "networkidle" });
  await clickButtonByText(page, "PLAY");
  // Now on character-select screen. Look at Kayden card body text.
  // Wait for Kayden to be visible.
  await page.getByText("Kayden Stark", { exact: false }).first().waitFor({ state: "visible" });
  const characterScreenBody = await readBodyText(page);
  // Look for "HIGH: <n>" pattern anywhere.
  const highMatch = characterScreenBody.match(/HIGH[^0-9]{0,5}(\d+)/);
  const highScorePersisted = !!highMatch;
  const highScoreValue = highMatch ? parseInt(highMatch[1], 10) : null;

  await browser.close();

  // --- Report ---
  console.log("\n=== Curry Time Verification Report ===\n");
  console.log(`FT make rate (485ms hold): ${ftMakes}/10`);
  console.log(`  outcomes: ${ftResults.join(", ")}`);
  console.log(`3P make rate (485ms hold): ${tpMakes}/10`);
  console.log(`  outcomes: ${tpResults.join(", ")}`);
  console.log(`Early release (100ms): ${early.outcome}`);
  console.log(`Late release  (700ms): ${late.outcome}`);
  console.log(`High score persisted: ${highScorePersisted ? "yes" : "no"}`);
  if (highScoreValue !== null) console.log(`  HIGH value on Kayden card: ${highScoreValue}`);
  console.log(`  localStorage[curry-time:high-scores] = ${highScoresBefore}`);
  if (errors.pageErrors.length === 0 && errors.consoleErrors.length === 0) {
    console.log("No page errors or console errors captured.");
  } else {
    console.log(`Page errors (${errors.pageErrors.length}):`);
    for (const e of errors.pageErrors) console.log("  - " + e);
    console.log(`Console errors (${errors.consoleErrors.length}):`);
    for (const e of errors.consoleErrors) console.log("  - " + e);
  }
  console.log("");
}

run().catch((err) => {
  console.error("Verification script crashed:", err);
  process.exit(1);
});
