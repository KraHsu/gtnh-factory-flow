import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { createEmptyProject } from "@/examples";
import type { LivePlan } from "@/lib/live/ops";
import { docKey, type ServerFrame } from "@/lib/live/protocol";
import { ROOM_PROTOCOL, type RoomAdmission } from "@/lib/rooms/types";
import { resetMemoryTokens } from "@/lib/server/memory-rate";
import { LiveService } from "../service";
import { createRoomHttp } from "./http";
import { roomIdentity } from "./iam";
import { RoomStore } from "./store";

const ORIGIN = "http://127.0.0.1:3097";
const owner = { username: "owner", name: "房主" };
const disposers: Array<() => Promise<void> | void> = [];
const directories: string[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  for (const stop of disposers.splice(0).reverse()) await stop();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
  resetMemoryTokens();
});

function directory() {
  const value = mkdtempSync(path.join(tmpdir(), "gtnh-rooms-"));
  directories.push(value);
  return value;
}

async function start(root = directory()) {
  const store = new RoomStore(path.join(root, "rooms.sqlite3"));
  const handler = createRoomHttp({
    store,
    origins: [ORIGIN],
    identity: async (request) => (request.headers["x-test-owner"] === "yes" ? owner : undefined),
    refreshMembers: (doc) => service.refreshMembers(doc),
    dropDocument: (doc) => service.dropDocument(doc),
  });
  const service = new LiveService({
    store: store.planStore(),
    journalDir: path.join(root, "journal"),
    allowedOrigins: [ORIGIN],
    httpHandler: handler,
    timing: { lingerMs: 30 },
    authenticate: async (request) => {
      const [protocol, token] = (request.headers["sec-websocket-protocol"] ?? "")
        .split(",")
        .map((value) => value.trim());
      const guest = protocol === ROOM_PROTOCOL ? store.guest(token ?? "") : undefined;
      return guest ? { id: guest.id as string, username: guest.nickname as string } : undefined;
    },
    log: () => undefined,
  });
  const port = await service.start(0);
  let stopped = false;
  disposers.push(async () => {
    if (!stopped) {
      await service.stop();
      store.close();
    }
  });
  return {
    store,
    service,
    root,
    request: async (
      route: string,
      body?: unknown,
      asOwner = false,
      method = body === undefined ? "GET" : "POST",
      origin = ORIGIN,
    ) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/rooms${route}`, {
        method,
        headers: {
          Origin: origin,
          ...(asOwner ? { "x-test-owner": "yes" } : {}),
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    },
    connect: async (admission: RoomAdmission) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/live`, [ROOM_PROTOCOL, admission.token], {
        headers: { Origin: ORIGIN },
      });
      sockets.push(ws);
      const frames: ServerFrame[] = [];
      ws.on("message", (value) => frames.push(JSON.parse(value.toString()) as ServerFrame));
      await once(ws, "open");
      const next = async <T extends ServerFrame["t"]>(
        kind: T,
      ): Promise<Extract<ServerFrame, { t: T }>> => {
        const deadline = Date.now() + 4000;
        while (Date.now() < deadline) {
          const index = frames.findIndex((frame) => frame.t === kind);
          if (index >= 0) return frames.splice(index, 1)[0] as Extract<ServerFrame, { t: T }>;
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        throw new Error(`No ${kind} frame: ${JSON.stringify(frames)}`);
      };
      ws.send(JSON.stringify({ t: "hello", v: 1, client: "web" }));
      expect((await next("welcome")).you.username).toBe(admission.user.username);
      const doc = docKey(admission.room.ownerId, admission.room.designId);
      ws.send(JSON.stringify({ t: "join", doc }));
      const snapshot = await next("snapshot");
      return {
        ws,
        frames,
        next,
        snapshot,
        doc,
        send: (frame: unknown) => ws.send(JSON.stringify(frame)),
      };
    },
    crash: async () => {
      await service.crash();
      store.close();
      stopped = true;
    },
  };
}

const createBody = () => ({
  name: "测试工厂",
  password: "room-password-123",
  nickname: "房主昵称",
  plan: createEmptyProject(),
});

describe("persistent password rooms", () => {
  it("keeps an empty room on disk after the last browser leaves and lets a new visitor continue it", async () => {
    const app = await start();
    const admission = (await app.request("", createBody(), true)).body as RoomAdmission;
    const client = await app.connect(admission);
    client.send({
      t: "ops",
      doc: client.doc,
      base: 0,
      cid: "before-everyone-left",
      ops: [{ o: "meta", f: { description: "saved while online" } }],
    });
    await client.next("ops");
    client.ws.close();
    await once(client.ws, "close");
    const deadline = Date.now() + 3000;
    while (app.service.stats.rooms && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    expect(app.service.stats.rooms).toBe(0);
    expect((await app.request("", undefined, true)).body.rooms).toHaveLength(1);
    const visitor = (
      await app.request("/join", {
        code: admission.room.code,
        password: createBody().password,
        nickname: "后来的人",
      })
    ).body as RoomAdmission;
    expect((visitor.plan as LivePlan).description).toBe("saved while online");
    expect((await app.connect(visitor)).snapshot.seq).toBe(1);
  });

  it("requires IAM only for creation and management, rejects cross-origin and malformed requests, and never discloses passwords", async () => {
    const app = await start();
    expect((await app.request("", createBody())).status).toBe(401);
    expect((await app.request("", createBody(), true, "POST", "https://evil.test")).status).toBe(
      403,
    );
    expect((await app.request("", { ...createBody(), nickname: "\u202e" }, true)).status).toBe(400);
    expect((await app.request("", { ...createBody(), password: "tiny" }, true)).status).toBe(400);
    const created = await app.request("", createBody(), true);
    expect(created.status).toBe(201);
    const admission = created.body as RoomAdmission;
    expect(admission.room.code).toMatch(/^\d{8}$/);
    expect(JSON.stringify(admission.room)).not.toContain("password");
    const stored = app.store.db
      .prepare("SELECT password_hash,password_salt FROM rooms WHERE code=?")
      .get(admission.room.code)!;
    expect(stored.password_hash).not.toBe(createBody().password);
    const wrong = await app.request("/join", {
      code: admission.room.code,
      password: "wrong",
      nickname: "访客",
    });
    const missing = await app.request("/join", {
      code: "00000000",
      password: "wrong",
      nickname: "访客",
    });
    expect(wrong).toEqual(missing);
    expect(
      (
        await app.request("/join", {
          code: admission.room.code,
          password: createBody().password,
          nickname: "",
        })
      ).status,
    ).toBe(400);
    expect((await app.request(`/${admission.room.code}`, undefined, false, "DELETE")).status).toBe(
      401,
    );
    expect((await app.request("", undefined, true)).body.rooms).toHaveLength(1);
    expect((await app.request("/resume", { token: "forged" })).status).toBe(401);
  });

  it("lets guests edit after the owner disconnects, shows nicknamed cursors, and restores acknowledged edits after a crash", async () => {
    const app = await start();
    const first = (await app.request("", createBody(), true)).body as RoomAdmission;
    const host = await app.connect(first);
    const second = (
      await app.request("/join", {
        code: first.room.code,
        password: createBody().password,
        nickname: "工程师乙",
      })
    ).body as RoomAdmission;
    const guest = await app.connect(second);
    guest.send({ t: "presence", doc: guest.doc, cursor: { x: 80, y: 160 }, sel: [] });
    expect(await host.next("presence")).toMatchObject({
      who: second.user.id,
      cursor: { x: 80, y: 160 },
    });
    expect(guest.snapshot.present.map((person) => person.username)).toContain("工程师乙");
    host.ws.close();
    await once(host.ws, "close");
    guest.send({
      t: "ops",
      doc: guest.doc,
      base: 0,
      cid: "guest-offline-host-edit",
      ops: [{ o: "meta", f: { description: "房主离线后编辑" } }],
    });
    expect(await guest.next("ops")).toMatchObject({ seq: 1, cid: "guest-offline-host-edit" });
    await app.crash();
    const reopened = await start(app.root);
    const restored = (await reopened.request("/resume", { token: second.token }))
      .body as RoomAdmission;
    expect((restored.plan as LivePlan).description).toBe("房主离线后编辑");
    const resumed = await reopened.connect(restored);
    expect(resumed.snapshot.seq).toBe(1);
    // Resending an acknowledged operation after a restart must not apply it twice.
    resumed.send({
      t: "ops",
      doc: resumed.doc,
      base: 0,
      cid: "guest-offline-host-edit",
      ops: [{ o: "meta", f: { description: "房主离线后编辑" } }],
    });
    expect((await resumed.next("ops")).seq).toBe(1);
    expect((await reopened.request("", undefined, true)).body.rooms).toHaveLength(1);
  });

  it("scopes credentials to one room, revokes departed guests, expires credentials and closes rooms for everyone", async () => {
    const app = await start();
    const first = (await app.request("", createBody(), true)).body as RoomAdmission;
    const other = (await app.request("", { ...createBody(), name: "别的房间" }, true))
      .body as RoomAdmission;
    const a = await app.connect(first);
    a.send({ t: "join", doc: docKey(other.room.ownerId, other.room.designId) });
    expect(await a.next("error")).toMatchObject({ code: "forbidden" });
    expect((await app.request("/leave", { token: first.token })).status).toBe(200);
    expect(await a.next("kicked")).toMatchObject({ reason: "unshared" });
    expect(app.store.guest(first.token)).toBeUndefined();
    app.store.db.prepare("UPDATE room_guests SET expires_at=0 WHERE id=?").run(other.user.id);
    expect((await app.request("/resume", { token: other.token })).status).toBe(401);
    const joined = (
      await app.request("/join", {
        code: other.room.code,
        password: createBody().password,
        nickname: "访客",
      })
    ).body as RoomAdmission;
    const b = await app.connect(joined);
    expect((await app.request(`/${other.room.code}`, undefined, true, "DELETE")).status).toBe(200);
    expect(await b.next("kicked")).toMatchObject({ reason: "deleted" });
    expect(app.store.guest(joined.token)).toBeUndefined();
    expect(
      (
        await app.request("/join", {
          code: other.room.code,
          password: createBody().password,
          nickname: "访客",
        })
      ).status,
    ).toBe(403);
  });
});

describe("IAM room owner verification", () => {
  const request = (cookie?: string) =>
    ({
      headers: { cookie, "remote-user": "forged", "remote-groups": "owner" },
    }) as unknown as IncomingMessage;
  it("validates only the IAM cookie with the local identity provider, never caller identity headers", async () => {
    let called = false;
    expect(
      await roomIdentity(request(), async () => {
        called = true;
        throw new Error();
      }),
    ).toBeUndefined();
    expect(called).toBe(false);
    const identity = await roomIdentity(
      request("other=secret; __Secure-krahsu-iam=real"),
      async (url, init) => {
        expect(url).toBe("http://127.0.0.1:9091/auth/api/authz/auth-request");
        expect((init!.headers as Record<string, string>).Cookie).toBe("__Secure-krahsu-iam=real");
        expect((init!.headers as Record<string, string>)["X-Original-URL"]).toBe(
          "https://iam.krahsu.top/api/overview",
        );
        return new Response("", {
          status: 200,
          headers: { "remote-user": "owner", "remote-name": "Owner", "remote-groups": "owner" },
        });
      },
    );
    expect(identity).toEqual({ username: "owner", name: "Owner" });
    expect(
      await roomIdentity(
        request("__Secure-krahsu-iam=x"),
        async () => new Response("", { status: 401 }),
      ),
    ).toBeUndefined();
    await expect(
      roomIdentity(request("__Secure-krahsu-iam=x"), async () => {
        throw new Error("down");
      }),
    ).rejects.toMatchObject({ status: 503 });
  });
});
