import type { IncomingMessage } from "node:http";
import { factoryProjectSchema } from "@/lib/model/schemas";
import { takeMemoryToken } from "@/lib/server/memory-rate";
import { docKey } from "@/lib/live/protocol";
import type { LivePlan } from "@/lib/live/ops";
import { ROOM_CODE, type RoomIdentity } from "@/lib/rooms/types";
import { RoomError, roomNickname, type RoomStore } from "./store";
import { roomIdentity } from "./iam";

const MAX_BODY = 3 * 1024 * 1024;
async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BODY) throw new RoomError(413, "This plan is too large for a room.");
    chunks.push(bytes);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new RoomError(400, "Invalid room request.");
  }
}

export interface RoomHttpOptions {
  store: RoomStore;
  origins: string[];
  identity?: (request: IncomingMessage) => Promise<RoomIdentity | undefined>;
  refreshMembers: (doc: string) => Promise<void>;
  dropDocument: (doc: string) => Promise<void>;
}

export function createRoomHttp(options: RoomHttpOptions) {
  const identity = options.identity ?? roomIdentity;
  const owner = async (request: IncomingMessage) => {
    const user = await identity(request);
    if (!user) throw new RoomError(401, "Sign in with IAM to create or manage rooms.");
    return user;
  };
  const token = (body: Record<string, unknown>) => {
    if (typeof body.token !== "string" || body.token.length > 128)
      throw new RoomError(401, "Your room session expired. Join again with your nickname.");
    return body.token;
  };
  return async (
    request: IncomingMessage,
  ): Promise<{ status: number; body: unknown } | undefined> => {
    const url = new URL(request.url ?? "/", "http://rooms.local");
    if (url.pathname !== "/api/rooms" && !url.pathname.startsWith("/api/rooms/")) return undefined;
    const method = request.method ?? "GET";
    try {
      if (method !== "GET" && !options.origins.includes(request.headers.origin ?? ""))
        throw new RoomError(403, "Open the planner before using rooms.");
      const address = request.headers["x-client-ip"] ?? request.socket.remoteAddress ?? "unknown";
      if (!takeMemoryToken(`rooms:http:${address}`, 120, 60_000))
        throw new RoomError(429, "Too many room requests. Try again shortly.");
      if (method === "GET" && url.pathname === "/api/rooms/identity")
        return { status: 200, body: { user: (await identity(request)) ?? null } };
      if (method === "GET" && url.pathname === "/api/rooms")
        return { status: 200, body: { rooms: options.store.list(await owner(request)) } };
      if (method === "POST" && url.pathname === "/api/rooms") {
        const user = await owner(request);
        if (!takeMemoryToken(`rooms:create:${user.username}`, 10, 60 * 60_000))
          throw new RoomError(429, "Too many rooms created. Try again later.");
        const body = await readBody(request);
        const nickname = roomNickname(body.nickname);
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name || [...name].length > 80)
          throw new RoomError(400, "Enter a room name of 1–80 characters.");
        const plan = factoryProjectSchema.safeParse(body.plan);
        if (!plan.success) throw new RoomError(400, "The plan could not be opened in a room.");
        const admission = await options.store.create(
          user,
          name,
          body.password as string,
          nickname,
          plan.data as unknown as LivePlan,
          body.remember === true,
        );
        return { status: 201, body: admission };
      }
      if (method === "POST" && url.pathname === "/api/rooms/join") {
        const body = await readBody(request);
        const code = typeof body.code === "string" ? body.code.trim() : "";
        const nickname = roomNickname(body.nickname);
        if (
          !ROOM_CODE.test(code) ||
          typeof body.password !== "string" ||
          body.password.length > 128
        )
          throw new RoomError(400, "Enter the 8-digit room number, password and your nickname.");
        if (
          !takeMemoryToken(`rooms:join:${address}:${code}`, 10, 5 * 60_000) ||
          !takeMemoryToken(`rooms:join:${address}`, 30, 60_000)
        )
          throw new RoomError(429, "Too many join attempts. Try again in a few minutes.");
        const admission = await options.store.join(
          code,
          body.password,
          nickname,
          body.remember === true,
        );
        await options.refreshMembers(docKey(admission.room.ownerId, admission.room.designId));
        return { status: 200, body: admission };
      }
      if (method === "POST" && url.pathname === "/api/rooms/resume") {
        const body = await readBody(request);
        return { status: 200, body: options.store.resume(token(body), body.remember === true) };
      }
      if (method === "POST" && url.pathname === "/api/rooms/leave") {
        const body = await readBody(request);
        const doc = options.store.leave(token(body));
        if (doc) await options.refreshMembers(doc);
        return { status: 200, body: { ok: true } };
      }
      if (method === "DELETE" && /^\/api\/rooms\/\d{8}$/.test(url.pathname)) {
        const doc = options.store.closeRoom(await owner(request), url.pathname.split("/").at(-1)!);
        await options.dropDocument(doc);
        return { status: 200, body: { ok: true } };
      }
      return { status: 404, body: { error: "Room not found." } };
    } catch (error) {
      return error instanceof RoomError
        ? { status: error.status, body: { error: error.message } }
        : { status: 503, body: { error: "The room service is unavailable. Try again shortly." } };
    }
  };
}
