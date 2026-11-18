import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { characters } from "../data/characters";
import { SHOTS_PER_PLAYER } from "../lib/match";

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
  await page.getByRole("button", { name: "Keep holding" }).waitFor();
  await session.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  await page.getByRole("button", { name: "Hold to shoot" }).waitFor();
  await expectText(page, "[data-score]", "0");

  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints });
  await page.getByRole("button", { name: "Let go now!" }).waitFor();
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

async function verifyDuel(page: Page) {
  await openGame(page);
  await page.getByRole("button", { name: "2 players" }).tap();
  await page.getByRole("heading", { name: "PLAYER 1, PICK YOUR BALLER" }).waitFor();
  await page.getByRole("button", { name: /Michelangelo Kayden/ }).tap();
  await page.getByRole("heading", { name: "PLAYER 2, PICK YOUR BALLER" }).waitFor();
  await page.getByRole("button", { name: "Back", exact: true }).tap();
  await page.getByRole("heading", { name: "PLAYER 1, PICK YOUR BALLER" }).waitFor();
  await page.getByRole("button", { name: /Michelangelo Kayden/ }).tap();
  await page.getByRole("button", { name: /Leonardo Owen/ }).tap();
  await page.getByRole("button", { name: /Three-pointer/ }).tap();

  const artRequests = characters.flatMap(({ shot }) => ["set", "follow"].map(async (pose) => {
    const response = await page.request.get(new URL(`/arcade/shots/${shot.art}-${pose}.webp`, baseUrl).href);
    assert.equal(response.status(), 200, `${shot.art} ${pose} art must load`);
    assert.equal(response.headers()["content-type"], "image/webp");
  }));
  await Promise.all(artRequests);

  const device = await page.context().newCDPSession(page);
  for (let round = 0; round < 2 * SHOTS_PER_PLAYER; round++) {
    const active = round % 2 + 1;
    const turn = page.locator(`[data-player="${active}"][data-turn="true"]`);
    await turn.waitFor();
    const area = await page.getByRole("button", { name: "Hold to shoot" }).boundingBox();
    assert.ok(area);
    const touchPoints = [{ x: area.x + area.width / 2, y: area.y + area.height / 2 }];
    await device.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints });
    if (round === 0) {
      await page.waitForTimeout(590);
      await device.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(125);
      await capture(page, "duel-follow-through");
      await page.getByRole("status").filter({ hasText: "SPLASH!" }).waitFor();
      await expectText(page, '[data-player="1"] [data-duel-score]', "3");
    } else {
      await device.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }

    if (round < 2 * SHOTS_PER_PLAYER - 1) {
      await page.getByRole("button", { name: "Next player" }).tap();
    }
  }

  const result = page.getByRole("status").filter({ hasText: "Michelangelo Kayden wins!" });
  await result.waitFor();
  assert.match(await result.innerText(), /Final score · 3–0/i);
  assert.equal(await page.getByText("5/5 shots", { exact: false }).count(), 2);
  assert.deepEqual(await page.evaluate(() => localStorage.getItem("curry-time:high-scores")), null);
  await capture(page, "duel-final");
  await page.getByRole("button", { name: "Rematch", exact: true }).tap();
  await page.locator('[data-player="1"][data-turn="true"]').waitFor();
  assert.deepEqual(await page.locator("[data-duel-score]").allTextContents(), ["0", "0"]);
  await page.getByRole("button", { name: "Hold to shoot" }).waitFor();
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

    const duel = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    duel.on("pageerror", (error) => errors.push(error.message));
    await verifyDuel(duel);
    assert.deepEqual(errors, []);
    console.log("Night Court passed solo and two-player checks for both shot types, mobile inputs, records, and a full match and rematch.");
  } finally {
    await browser.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
