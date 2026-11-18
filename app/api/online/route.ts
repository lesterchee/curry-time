import { MemoryRoomStore, readRoomRequest, RedisRoomStore, RoomError, RoomService } from "../../../lib/room-server";

export const preferredRegion = "sin1";

const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
const service = url && token
  ? new RoomService(new RedisRoomStore(url, token))
  : process.env.VERCEL !== "1" && (process.env.NODE_ENV === "development" || process.env.CURRY_MEMORY_ROOMS === "1")
    ? new RoomService(new MemoryRoomStore())
    : null;

const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    const host = request.headers.get("host") ?? new URL(request.url).host;
    if (origin && new URL(origin).host !== host) throw new RoomError(403, "Open the game to join the room.");
    if (!service) throw new RoomError(503, "Online play is temporarily unavailable.");
    if (Number(request.headers.get("content-length")) > 2048) throw new RoomError(413, "That room request is too large.");
    const body = await request.text();
    if (body.length > 2048) throw new RoomError(413, "That room request is too large.");
    let data: unknown;
    try {
      data = JSON.parse(body);
    } catch {
      throw new RoomError(400, "That room request couldn’t be read.");
    }
    return Response.json(await service.handle(readRoomRequest(data)), { headers });
  } catch (error) {
    const message = error instanceof RoomError ? error.message : "The room is reconnecting. Try again.";
    return Response.json({ error: message }, { status: error instanceof RoomError ? error.status : 503, headers });
  }
}
