import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { characters } from "../data/characters";

const baseUrl = process.env.CURRY_URL ?? "http://127.0.0.1:3139";
const screenshotDir = process.env.CURRY_SCREENSHOTS;
const initialBest = 7;

async function expectText(page: Page, selector: string, expected: string) {
  await page.locator(selector).filter({ hasText: new RegExp(`^${expected}$`) }).waitFor();
}

async function capture(page: Page, name: string) {
  if (screenshotDir) await page.screenshot({ path: join(screenshotDir, `${name}.png`) });
}

async function openGame(page: Page) {
  await page.goto(baseUrl);
  await page.getByRole("heading", { name: "CURRY TIME." }).waitFor();
  await page.getByRole("button", { name: "Mute", exact: true }).click();
  await page.getByRole("button", { name: "Unmute", exact: true }).waitFor();
}

async function verifyDesktop(page: Page) {
  await openGame(page);
  await capture(page, "title-desktop");
  await page.getByRole("button", { name: "Play now" }).click();
  await page.getByRole("heading", { name: "PICK YOUR BALLER" }).waitFor();
  for (const player of characters) {
    const card = page.getByRole("button", { name: new RegExp(player.name) });
    const hasArt = await card.locator("img").evaluate(async (image: HTMLImageElement) => {
      await image.decode();
      return image.naturalWidth > 0;
    });
    assert.ok(hasArt, `Missing art for ${player.name}`);
  }
  await capture(page, "lineup-desktop");

  await page.getByRole("button", { name: /Michelangelo Kayden Best 7/ }).click();
  await page.getByRole("heading", { name: "PICK YOUR SHOT" }).waitFor();
  await capture(page, "shots-desktop");
  await page.getByRole("button", { name: /Free throw/ }).click();
  const canvas = page.getByLabel("Basketball court");
  await canvas.waitFor();
  await expectText(page, "[data-best]", String(initialBest));
  await page.locator(".game-shell").focus();
  await capture(page, "court-desktop");

  await page.keyboard.down("Space");
  await page.waitForTimeout(480);
  await page.keyboard.up("Space");
  await page.getByRole("status").filter({ hasText: "SWISH!" }).waitFor();
  await expectText(page, "[data-score]", "1");
  await expectText(page, "[data-streak]", "1");
  await capture(page, "swish-desktop");

  await page.getByRole("button", { name: "Shoot again" }).click();
  await expectText(page, "[data-score]", "1");
  const box = await canvas.boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(1, 1);
  await page.mouse.up();
  await page.getByRole("status").filter({ hasText: "AIR BALL!" }).waitFor();
  await expectText(page, "[data-streak]", "0");
  await expectText(page, "[data-score]", "1");

  await page.getByRole("button", { name: /Change shot/ }).click();
  await page.getByRole("button", { name: /Three-pointer/ }).click();
  await expectText(page, "[data-score]", "0");
  await expectText(page, "[data-best]", String(initialBest));
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("heading", { name: "CURRY TIME." }).waitFor();
}

async function verifyPhone(page: Page) {
  await openGame(page);
  await capture(page, "title-phone");
  await page.getByRole("button", { name: "Leonardo Owen", exact: true }).click();
  await page.getByRole("button", { name: /Three-pointer/ }).click();
  const button = page.getByRole("button", { name: "Hold to shoot" });
  await button.waitFor();
  const courtBox = await page.locator(".arena").boundingBox();
  const canvasBox = await page.getByLabel("Basketball court").boundingBox();
  assert.ok(courtBox && canvasBox && canvasBox.height > courtBox.height * 0.95, "Portrait court should fill the game area");
  await capture(page, "court-phone");
  const session = await page.context().newCDPSession(page);
  const area = await button.boundingBox();
  assert.ok(area);
  const touchPoints = [{ x: area.x + area.width / 2, y: area.y + area.height / 2 }];
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints });
  await page.getByRole("button", { name: "Release to shoot" }).waitFor();
  await session.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  await page.getByRole("button", { name: "Hold to shoot" }).waitFor();
  await expectText(page, "[data-score]", "0");

  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints });
  await page.waitForTimeout(480);
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.getByRole("status").filter({ hasText: "SPLASH!" }).waitFor();
  await expectText(page, "[data-score]", "3");
  await expectText(page, "[data-best]", "3");
  await expectText(page, "[data-streak]", "1");
  await capture(page, "splash-phone");
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: "Play now" }).tap();
  await page.getByRole("button", { name: /Leonardo Owen Best 3/ }).waitFor();

  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByRole("button", { name: /Jayson Tatum/ }).click();
  await page.getByRole("button", { name: /Free throw/ }).click();
  const landscapeCanvas = await page.getByLabel("Basketball court").boundingBox();
  const landscapeControls = await page.getByRole("button", { name: "Hold to shoot" }).boundingBox();
  assert.ok(landscapeCanvas && landscapeCanvas.height > 150);
  assert.ok(landscapeControls && landscapeControls.y + landscapeControls.height <= 390);
  await capture(page, "court-landscape");
}

async function main() {
  if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
  const browser = await chromium.launch({ channel: process.env.CURRY_BROWSER });
  const errors: string[] = [];
  try {
    const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    await desktop.addInitScript((best) => {
      localStorage.setItem("curry-time:high-scores", JSON.stringify({ "kayden-stark": best }));
    }, initialBest);
    desktop.on("pageerror", (error) => errors.push(error.message));
    await verifyDesktop(desktop);

    const phone = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      reducedMotion: "reduce",
    });
    phone.on("pageerror", (error) => errors.push(error.message));
    await verifyPhone(phone);
    assert.deepEqual(errors, []);
    console.log("Night Court passed desktop and phone checks for lineup, navigation, shots, scores and saved records.");
  } finally {
    await browser.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
