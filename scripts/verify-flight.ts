import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const URL = "https://curry-time.vercel.app/";

async function main() {
  await mkdir("/tmp/flight", { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1024, height: 700 },
    deviceScaleFactor: 1,
    hasTouch: true,
  });
  const page = await ctx.newPage();

  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  page.on("console", (m) => {
    if (m.type() === "error") console.log("[console.error]", m.text());
  });

  await page.goto(URL, { waitUntil: "networkidle" });
  await page.getByText("▶ PLAY").first().click({ force: true });
  await page.getByText("Kayden Stark").first().click({ force: true });
  await page.getByText("FREE THROW").first().click({ force: true });
  await page.waitForTimeout(2000);

  const canvas = page.locator("canvas").first();
  await canvas.waitFor({ state: "visible" });
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(485);
  await page.mouse.up();

  // Capture every 120ms for the next 2 seconds.
  const frames: string[] = [];
  for (let i = 0; i < 17; i++) {
    const ms = i * 120;
    await page.waitForTimeout(120);
    const path = `/tmp/flight/frame-${String(ms + 120).padStart(4, "0")}.png`;
    await page.screenshot({ path, fullPage: false });
    frames.push(path);
  }
  console.log(`Captured ${frames.length} frames`);
  for (const f of frames) console.log("  " + f);

  await ctx.close();
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
