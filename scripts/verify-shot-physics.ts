import assert from "node:assert/strict";
import { test } from "node:test";
import { newMatch, recordShot, SHOTS_PER_PLAYER } from "../lib/match";
import {
  BALL_RADIUS,
  createFlight,
  FLOOR_Y,
  getShotConfig,
  GREEN_HIGH,
  GREEN_LOW,
  shotPowerAt,
  stepFlight,
  type ShotEvent,
  type ShotKind,
} from "../lib/physics";

function shoot(kind: ShotKind, power: number, hz: number) {
  const cfg = getShotConfig(kind);
  const flight = createFlight(cfg, power);
  const contacts: { event: ShotEvent; x: number; y: number; vx: number; vy: number }[] = [];
  for (let frame = 0; !flight.outcome && frame < 5 * hz; frame++) {
    stepFlight(flight, cfg, 1 / hz, (event) => contacts.push({ event, ...flight.ball }));
  }
  assert.ok(flight.outcome, "Every shot should resolve");
  return { cfg, flight, contacts };
}

test("the charge meter gives about half a second in green on each pass", () => {
  for (let elapsed = 430; elapsed <= 930; elapsed++) {
    for (const sample of [elapsed, 2320 - elapsed]) {
      const power = shotPowerAt(sample);
      assert.ok(power >= GREEN_LOW && power <= GREEN_HIGH);
    }
  }
  assert.equal(shotPowerAt(0), 0);
  assert.equal(shotPowerAt(1160), 100);
  assert.equal(shotPowerAt(2320), 0);
});

for (const kind of ["free-throw", "three-pointer"] as const) {
  test(`${kind}: every green release physically clears the rim at multiple refresh rates`, () => {
    for (const hz of [30, 60, 120, 144]) {
      for (let power = GREEN_LOW; power <= GREEN_HIGH; power++) {
        const { cfg, flight, contacts } = shoot(kind, power, hz);
        const throughNet = contacts.filter(({ event }) => event === "net");
        assert.equal(flight.outcome, "swish", `${power}% at ${hz} Hz`);
        assert.equal(throughNet.length, 1);
        assert.ok(throughNet[0].y > cfg.rimY + BALL_RADIUS);
        assert.ok(Math.abs(throughNet[0].x - cfg.rimX) < 20, "The ball must emerge under the net");
        assert.equal(contacts[1]?.event, "floor");
      }
    }
  });

  test(`${kind}: the ball banks, rebounds and misses according to its contacts`, () => {
    const bank = shoot(kind, 90, 60);
    assert.equal(bank.flight.outcome, "rim-in");
    assert.ok(bank.contacts.find(({ event, vx }) => event === "board" && vx < 0));
    assert.deepEqual(bank.contacts.slice(0, 2).map(({ event }) => event), ["board", "net"]);

    const rimOut = shoot(kind, 54, 60);
    assert.equal(rimOut.flight.outcome, "rim-out");
    assert.equal(rimOut.contacts[0].event, "rim");
    assert.ok(rimOut.contacts[0].vy < 0);
    assert.ok(rimOut.contacts.find(({ event, vy, y }) => event === "floor" && vy < 0 && y + BALL_RADIUS === FLOOR_Y));

    assert.equal(shoot(kind, 15, 60).flight.outcome, "air-ball");
    assert.equal(shoot(kind, 100, 60).flight.outcome, "air-ball");
  });
}

test("a head-to-head shot affects exactly the active player's score and total attempts", () => {
  let match = newMatch();
  for (let round = 0; round < SHOTS_PER_PLAYER; round++) {
    match = recordShot({ ...match, turn: 0 }, 3);
    match = recordShot({ ...match, turn: 1 }, round === 0 ? 3 : 0);
  }
  assert.deepEqual(match.players, [{ score: 15, shots: 5 }, { score: 3, shots: 5 }]);
  assert.equal(recordShot(match, 3), match);
});
