import assert from "node:assert/strict";
import { chromium, type CDPSession, type Page } from "playwright";
import { SHOTS_PER_PLAYER } from "../lib/match";

const url = process.env.CURRY_URL ?? "http://127.0.0.1:3141";

async function openOnline(page: Page) {
  await page.goto(url);
  await page.getByRole("button", { name: "Mute", exact: true }).tap();
  await page.getByRole("button", { name: "2 players" }).tap();
  await page.getByRole("button", { name: "Two phones" }).tap();
}

async function join(page: Page, name: "Kayden" | "Owen") {
  await openOnline(page);
  await page.getByRole("button", { name, exact: true }).tap();
  await page.getByRole("textbox", { name: "Room code" }).fill("owen");
  await page.getByRole("button", { name: "Join game" }).tap();
  await page.getByRole("heading", { name: "Online shootout" }).waitFor();
  await page.getByText(`You’re ${name}`, { exact: false }).waitFor();
}

async function shoot(page: Page, touch: CDPSession, made: boolean) {
  const area = await page.getByRole("button", { name: "Hold to shoot" }).boundingBox();
  assert.ok(area);
  const touchPoints = [{ x: area.x + area.width / 2, y: area.y + area.height / 2 }];
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints });
  if (made) await page.getByRole("button", { name: "Let go now!" }).waitFor();
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function seeScore(page: Page, points: string[], shots: number[]) {
  await Promise.all(points.map(async (point, index) => {
    const row = page.locator(`[data-player="${index + 1}"]`);
    await row.locator("[data-duel-score]").filter({ hasText: new RegExp(`^${point}$`) }).waitFor();
    await row.getByText(`${shots[index]}/${SHOTS_PER_PLAYER} shots`, { exact: false }).waitFor();
  }));
}

async function release(page: Page) {
  // Testing uses real seats. Release only the seats owned by these test browsers.
  const lobby = page.getByRole("button", { name: "Leave room", exact: true });
  const court = page.getByRole("button", { name: "Menu", exact: true });
  if (await lobby.isVisible()) await lobby.tap({ timeout: 4000 });
  else if (await court.isVisible()) await court.tap({ timeout: 4000 });
  else return;
  await page.getByRole("button", { name: "Two phones" }).waitFor({ timeout: 10_000 });
}

async function main() {
  const browser = await chromium.launch({ channel: process.env.CURRY_BROWSER });
  const errors: string[] = [];
  const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" as const };
  const kayden = await browser.newPage(phone);
  const owen = await browser.newPage({ ...phone, viewport: { width: 393, height: 852 } });
  assert.notEqual(kayden.context(), owen.context());
  for (const page of [kayden, owen]) page.on("pageerror", (error) => errors.push(error.message));

  try {
    await Promise.all([join(kayden, "Kayden"), join(owen, "Owen")]);
    await kayden.getByRole("button", { name: "Ready", exact: true }).tap();
    await kayden.getByRole("button", { name: "Waiting for Owen" }).waitFor();
    assert.equal(await kayden.locator("canvas").count(), 0);
    await owen.getByRole("button", { name: "Ready", exact: true }).tap();
    await kayden.getByRole("button", { name: "Hold to shoot" }).waitFor();
    await owen.getByRole("button", { name: "Wait for your turn" }).waitFor();

    const players = [kayden, owen];
    const touch = await Promise.all(players.map((page) => page.context().newCDPSession(page)));
    for (let turn = 0; turn < 2 * SHOTS_PER_PLAYER; turn++) {
      const active = turn % 2;
      const score = ["1", "0"];
      const shots = [Math.ceil((turn + 1) / 2), Math.floor((turn + 1) / 2)];
      await shoot(players[active], touch[active], turn === 0);
      if (turn === 0) {
        await owen.getByRole("button", { name: "Shooting…" }).waitFor();
        await owen.getByRole("status").filter({ hasText: "SWISH!" }).waitFor();
      }
      await Promise.all(players.map((page) => seeScore(page, score, shots)));
      if (turn === 1) {
        await openOnline(owen);
        await owen.getByLabel("Basketball court").waitFor();
        await seeScore(owen, score, shots);
        await owen.getByRole("button", { name: "Wait for your turn" }).waitFor();
      }
    }

    for (const page of players) {
      const result = page.getByRole("status").filter({ hasText: "Michelangelo Kayden wins!" });
      await result.waitFor();
      assert.match(await result.innerText(), /Final score · 1–0/i);
    }
    await owen.getByRole("button", { name: "Rematch" }).tap();
    await Promise.all(players.map((page) => page.getByRole("button", { name: "Ready", exact: true }).waitFor()));
    await Promise.all(players.map(release));
    assert.deepEqual(errors, []);
    console.log("Two independent phone sessions joined with owen, watched shared shots, reconnected, and finished 1–0 before a shared rematch.");
  } finally {
    const cleanup = await Promise.allSettled([release(kayden), release(owen)]);
    for (const result of cleanup) if (result.status === "rejected") console.error(String(result.reason));
    await browser.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
