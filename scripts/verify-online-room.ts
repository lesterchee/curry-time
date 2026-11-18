import assert from "node:assert/strict";
import { test } from "node:test";
import { type RoomAction, type Seat } from "../lib/online";
import { MemoryRoomStore, readRoomRequest, RoomService } from "../lib/room-server";

const kayden = { seat: 0 as Seat, token: "a".repeat(32) };
const owen = { seat: 1 as Seat, token: "b".repeat(32) };

function fixture() {
  let now = 1_000_000;
  const store = new MemoryRoomStore();
  const service = new RoomService(store, () => now);
  return {
    pass: (ms: number) => { now += ms; },
    call: async (identity: typeof kayden, action: RoomAction) => service.handle(readRoomRequest({ ...identity, ...action })),
  };
}

test("the code opens two seats and rejects a third phone in an active seat", async () => {
  const { call } = fixture();
  await assert.rejects(() => call(kayden, { action: "join", code: "other" }), { status: 400 });
  await Promise.all([call(kayden, { action: "join", code: " Owen " }), call(owen, { action: "join", code: "owen" })]);
  const room = await call(owen, { action: "sync" });
  assert.deepEqual(room.seats, [{ present: true, ready: false }, { present: true, ready: false }]);
  assert.ok(!JSON.stringify(room).includes("tokenHash"));
  await assert.rejects(
    () => call({ ...owen, token: "c".repeat(32) }, { action: "join", code: "owen" }),
    { status: 409 },
  );
});

test("both phones ready up, alternate authoritative shots, and share the result and rematch", async () => {
  const { call } = fixture();
  await call(kayden, { action: "join", code: "owen" });
  await call(owen, { action: "join", code: "owen" });
  assert.equal((await call(kayden, { action: "ready" })).phase, "lobby");
  assert.equal((await call(owen, { action: "mode", shotKind: "three-pointer" })).seats[0].ready, false);
  await Promise.all([call(owen, { action: "ready" }), call(kayden, { action: "ready" })]);
  const room = await call(owen, { action: "sync" });
  assert.equal(room.phase, "playing");
  const shot = { action: "shoot", id: room.id, number: 1, power: 70 } as const;
  await assert.rejects(() => call(owen, shot), { status: 409 });
  const duplicate = await Promise.all([call(kayden, shot), call(kayden, shot)]);
  assert.equal(duplicate[0].revision, duplicate[1].revision);
  assert.equal(duplicate[0].lastShot?.outcome, "swish");
  assert.deepEqual(duplicate[0].match.players, [{ score: 3, shots: 1 }, { score: 0, shots: 0 }]);

  for (let number = 2; number <= 10; number++) {
    const identity = number % 2 === 0 ? owen : kayden;
    await call(identity, { ...shot, number, power: identity === owen ? 20 : 70 });
  }
  const final = await call(kayden, { action: "sync" });
  assert.equal(final.phase, "finished");
  assert.deepEqual(final, await call(owen, { action: "sync" }));
  assert.deepEqual(final.match.players, [{ score: 15, shots: 5 }, { score: 0, shots: 5 }]);
  const rematch = await call(owen, { action: "rematch", id: room.id });
  assert.notEqual(rematch.id, room.id);
  assert.equal(rematch.phase, "lobby");
  assert.equal(rematch.seats[0].ready, false);
  assert.equal(rematch.seats[1].ready, false);
  await assert.rejects(() => call(kayden, shot), { status: 409 });
});

test("an absent phone pauses play and its original session resumes the match", async () => {
  const { call, pass } = fixture();
  await call(kayden, { action: "join", code: "owen" });
  await call(owen, { action: "join", code: "owen" });
  await call(kayden, { action: "ready" });
  const started = await call(owen, { action: "ready" });
  const shot = { action: "shoot", id: started.id, number: 1, power: 70 } as const;
  pass(46_000);
  assert.equal((await call(kayden, { action: "sync" })).seats[1].present, false);
  await assert.rejects(() => call(kayden, shot), { status: 409 });
  assert.equal((await call(owen, { action: "sync" })).id, started.id);
  assert.equal((await call(kayden, shot)).match.players[0].score, 1);
  await call(kayden, { action: "leave" });
  await call(owen, { action: "leave" });
  await assert.rejects(() => call(owen, { action: "sync" }), { status: 401 });
  const fresh = await call(kayden, { action: "join", code: "owen" });
  assert.equal(fresh.phase, "lobby");
  assert.equal(fresh.lastShot, null);
});
